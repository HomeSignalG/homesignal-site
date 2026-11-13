-- Tab 20 · Weekly Report: research requests answered by Perplexity's API automatically (founder, 2026-11-13: "automatically").
-- DDL of record. Needs weekly-1-base.sql and weekly-2-topic-queue.sql (+ 2a). Independent of files 3-7.
--
-- What it does: a research request written by "Send to research" / "Prepare research request" is sent, word for word, to
-- Perplexity's API by homesignal-ingest .github/workflows/weekly-perplexity.yml (every 15 minutes), and the answer is saved
-- as a weekly_research_answers row (provider 'perplexity', mode 'api'). Nothing else changes: the answer is an AI draft,
-- recorded as such; turning it into sources and findings is still files 3+ (not applied).
--
-- Cost guards, all here, in the database, so no worker can exceed them:
--   * one answer per request: a request that has an answer (pasted or API) is never sent again;
--   * at most 3 attempts per request; a call with no result after 15 minutes counts as a failed attempt;
--   * at most 20 calls started in any 24 hours, across every request;
--   * only requests from the last 14 days whose report edition is still open.
-- Nothing here is readable or writable by anon or authenticated, except the one admin reader at the bottom.
begin;

-- ── an API answer is a second way an answer arrives ──
alter table public.weekly_research_answers drop constraint if exists weekly_research_answers_mode_check;
alter table public.weekly_research_answers add constraint weekly_research_answers_mode_check check (mode in ('manual_paste', 'api'));

-- ── every API call, kept: what was asked, what came back, what it cost, or why it failed ──
create table if not exists public.weekly_perplexity_calls (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.weekly_research_requests (id),
  attempt integer not null check (attempt between 1 and 3),
  model text not null check (char_length(model) between 1 and 80),
  request_sha256 text not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  answer_id uuid references public.weekly_research_answers (id),
  citations jsonb,
  search_results jsonb,
  usage jsonb,
  error text check (error is null or char_length(error) <= 2000),
  unique (request_id, attempt),
  check ((status = 'done') = (answer_id is not null)),
  check ((status = 'running') = (finished_at is null))
);
create unique index if not exists weekly_perplexity_calls_one_running on public.weekly_perplexity_calls (request_id) where status = 'running';

-- One row: the worker's last check, so the page can say whether the connection is set up and working.
create table if not exists public.weekly_perplexity_sync (
  id boolean primary key default true check (id),
  last_run_at timestamptz,
  last_outcome text check (last_outcome in ('ok', 'no_key', 'error')),
  last_error text check (last_error is null or char_length(last_error) <= 2000)
);

do $$
declare t text;
begin
  foreach t in array array['weekly_perplexity_calls', 'weekly_perplexity_sync'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- The requests Perplexity may still be asked about, oldest first. A request qualifies only while: it has no answer, no call
-- is running for it, it has fewer than 3 calls, it is at most 14 days old, and a lead was handed to research with it for an
-- edition that is still open.
create or replace function public.weekly_perplexity_due() returns setof public.weekly_research_requests
language sql stable security definer set search_path = public as $$
  select q.* from public.weekly_research_requests q
  where q.created_at > now() - interval '14 days'
    and not exists (select 1 from public.weekly_research_answers a where a.request_id = q.id)
    and not exists (select 1 from public.weekly_perplexity_calls c where c.request_id = q.id and c.status = 'running')
    and (select count(*) from public.weekly_perplexity_calls c where c.request_id = q.id) < 3
    and exists (select 1 from public.weekly_topic_lead_events h join public.weekly_editions e on e.id = h.edition_id
                where h.request_id = q.id and h.kind = 'handoff' and e.closed_at is null)
  order by q.created_at, q.id
$$;

-- Claim one request: mark stale calls failed, refuse past the daily cap, start the next attempt. Service role only.
create or replace function public.weekly_perplexity_claim(p_model text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.weekly_research_requests; n integer; c uuid; started integer;
begin
  if p_model is null or p_model !~ '^[a-z0-9][a-z0-9._-]{0,79}$' then
    raise exception 'bad model name' using errcode = '22023';
  end if;
  lock table public.weekly_perplexity_calls in share row exclusive mode;
  update public.weekly_perplexity_calls set status = 'failed', finished_at = now(),
         error = 'no result was recorded within 15 minutes'
   where status = 'running' and started_at < now() - interval '15 minutes';
  select count(*) into started from public.weekly_perplexity_calls where started_at > now() - interval '24 hours';
  if started >= 20 then
    return jsonb_build_object('claimed', false, 'reason', 'daily_cap', 'started_24h', started);
  end if;
  select * into q from public.weekly_perplexity_due() limit 1;
  if q.id is null then return jsonb_build_object('claimed', false, 'reason', 'nothing_due'); end if;
  select coalesce(max(attempt), 0) + 1 into n from public.weekly_perplexity_calls where request_id = q.id;
  insert into public.weekly_perplexity_calls (request_id, attempt, model, request_sha256)
  values (q.id, n, p_model, q.request_sha256) returning id into c;
  return jsonb_build_object('claimed', true, 'call_id', c, 'request_id', q.id, 'attempt', n, 'model', p_model,
    'request_text', q.request_text, 'request_sha256', q.request_sha256);
end $$;

-- Record Perplexity's answer for a running call. Refuses an empty or oversized answer, a call that is not running, and a
-- request that already has an answer (the call is then marked failed, so it is never retried).
create or replace function public.weekly_perplexity_record(p_call uuid, p_answer text, p_citations jsonb default null,
  p_search_results jsonb default null, p_usage jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.weekly_perplexity_calls; a uuid;
begin
  select * into c from public.weekly_perplexity_calls where id = p_call for update;
  if c.id is null then raise exception 'no such call' using errcode = '22023'; end if;
  if c.status <> 'running' then raise exception 'this call is %; nothing was recorded', c.status using errcode = '55006'; end if;
  if p_answer is null or char_length(btrim(p_answer)) = 0 or char_length(p_answer) > 200000 then
    raise exception 'the answer must be 1 to 200000 characters' using errcode = '22023';
  end if;
  if exists (select 1 from public.weekly_research_answers x where x.request_id = c.request_id) then
    update public.weekly_perplexity_calls set status = 'failed', finished_at = now(),
           error = 'the request already had an answer; this one was not saved' where id = c.id;
    return jsonb_build_object('recorded', false, 'reason', 'already_answered');
  end if;
  insert into public.weekly_research_answers (request_id, provider, mode, raw_text, pasted_by)
  values (c.request_id, 'perplexity', 'api', p_answer, 'system:perplexity-api:' || c.model) returning id into a;
  update public.weekly_perplexity_calls set status = 'done', finished_at = now(), answer_id = a,
         citations = p_citations, search_results = p_search_results, usage = p_usage where id = c.id;
  return jsonb_build_object('recorded', true, 'answer_id', a);
end $$;

create or replace function public.weekly_perplexity_fail(p_call uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.weekly_perplexity_calls set status = 'failed', finished_at = now(),
         error = left(coalesce(nullif(btrim(p_error), ''), 'failed'), 2000)
   where id = p_call and status = 'running';
end $$;

create or replace function public.weekly_perplexity_heartbeat(p_outcome text, p_error text default null) returns void
language sql security definer set search_path = public as $$
  insert into public.weekly_perplexity_sync (id, last_run_at, last_outcome, last_error)
  values (true, now(), p_outcome, left(p_error, 2000))
  on conflict (id) do update set last_run_at = excluded.last_run_at, last_outcome = excluded.last_outcome,
                                 last_error = excluded.last_error
$$;

-- Admin reader for the page: the connection's last check, and per request its calls and its newest answer.
create or replace function public.hs_weekly_perplexity_status(p_requests uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  return jsonb_build_object(
    'sync', (select to_jsonb(s) - 'id' from public.weekly_perplexity_sync s),
    'started_24h', (select count(*) from public.weekly_perplexity_calls where started_at > now() - interval '24 hours'),
    'requests', coalesce((select jsonb_object_agg(r.id, jsonb_build_object(
        'due', exists (select 1 from public.weekly_perplexity_due() d where d.id = r.id),
        'calls', coalesce((select jsonb_agg(jsonb_build_object('attempt', c.attempt, 'model', c.model, 'status', c.status,
                   'started_at', c.started_at, 'finished_at', c.finished_at, 'error', c.error, 'citations', c.citations,
                   'search_results', c.search_results, 'usage', c.usage, 'answer_id', c.answer_id) order by c.attempt)
                 from public.weekly_perplexity_calls c where c.request_id = r.id), '[]'::jsonb),
        'answer', (select jsonb_build_object('id', a.id, 'mode', a.mode, 'raw_text', a.raw_text, 'saved_at', a.pasted_at)
                   from public.weekly_research_answers a where a.request_id = r.id order by a.pasted_at desc, a.id desc limit 1)))
      from public.weekly_research_requests r where r.id = any (coalesce(p_requests, '{}'::uuid[]))), '{}'::jsonb));
end $$;

do $$
declare f text;
begin
  foreach f in array array['weekly_perplexity_due()', 'weekly_perplexity_claim(text)',
    'weekly_perplexity_record(uuid,text,jsonb,jsonb,jsonb)', 'weekly_perplexity_fail(uuid,text)',
    'weekly_perplexity_heartbeat(text,text)', 'hs_weekly_perplexity_status(uuid[])'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['weekly_perplexity_claim(text)', 'weekly_perplexity_record(uuid,text,jsonb,jsonb,jsonb)',
    'weekly_perplexity_fail(uuid,text)', 'weekly_perplexity_heartbeat(text,text)'] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  execute 'grant execute on function public.hs_weekly_perplexity_status(uuid[]) to authenticated';
end $$;

commit;

-- Tab 16 (YouTube Videos): the founder's own video suggestions (founder, 2026-10-28:
-- "both 16 and 17 need a suggest tab because they both render different style videos").
--
-- Tab 16 videos are the Public Records format (homesignal-ingest/video): one development record whose public
-- documents are read, quoted and narrated. Tab 17 is the Impact Stories format, fed by Hot Topics
-- (docs/impact-discovery.sql, hs_impact_discovery_suggest). The two pipelines pick their subjects differently,
-- so each tab keeps its own queue; nothing here touches impact_discovery_candidates.
--
-- A suggestion is a REQUEST, never evidence: links are where to start looking. A video is still made only from
-- the record's own fetched documents and passes video/validate.py like any other (homesignal-ingest
-- video/README.md stage 1 takes founder suggestions first).
--
-- Status: waiting (new) -> picked (a session took it) -> made (its project slug is filled) | declined (with a
-- reason, e.g. the record has no documents) | withdrawn (the founder took it back). Sessions update a row with
-- the service role; the page can only add and withdraw.
--
-- Make video (founder, 2026-10-30: "is a button missing to have it generate?"): the button queues ONE run per
-- suggestion and starts homesignal-ingest video-suggestion-run.yml at once. Claude Code on the founder's Claude plan
-- (no paid API, no database key) finds and fetches the record, writes the project, and the run checks it with untouched
-- code, puts it on main, builds it and uploads it to this tab for review. The run records the outcome here: made (the
-- video is waiting for review in the list), declined (the record cannot support a video yet, with the reason) or
-- failed (the suggestion goes back to waiting). Nothing here approves or publishes.
--
-- Additive and idempotent: run it twice and nothing changes.

create table if not exists public.youtube_video_suggestions (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 5 and 300),
  place         text check (place is null or char_length(place) <= 200),
  links         jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),
  note          text check (note is null or char_length(note) <= 2000),
  status        text not null default 'waiting'
                check (status in ('waiting', 'picked', 'made', 'declined', 'withdrawn')),
  status_note   text check (status_note is null or char_length(status_note) <= 2000),
  project_slug  text check (project_slug is null or project_slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  submitted_by  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint youtube_video_suggestions_made_has_slug check (status <> 'made' or project_slug is not null)
);

-- One open suggestion per title, so a double click never queues the same video twice.
create unique index if not exists youtube_video_suggestions_open_title
  on public.youtube_video_suggestions (lower(btrim(title)))
  where status in ('waiting', 'picked');

alter table public.youtube_video_suggestions enable row level security;
revoke all on public.youtube_video_suggestions from public, anon, authenticated;

-- Add a suggestion (admin only).
create or replace function public.hs_youtube_video_suggest(p_topic jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); t text := btrim(coalesce(p_topic->>'title', ''));
        pl text := nullif(btrim(coalesce(p_topic->>'place', '')), '');
        note text := nullif(btrim(coalesce(p_topic->>'note', '')), ''); links jsonb := '[]'::jsonb; u text;
        r public.youtube_video_suggestions%rowtype;
begin
  if char_length(t) < 5 or char_length(t) > 300 then
    raise exception 'Give the video a subject of 5 to 300 characters.' using errcode = '22023';
  end if;
  if pl is not null and char_length(pl) > 200 then raise exception 'The place is longer than 200 characters.' using errcode = '22023'; end if;
  if note is not null and char_length(note) > 2000 then raise exception 'The note is longer than 2,000 characters.' using errcode = '22023'; end if;
  if p_topic ? 'links' and jsonb_typeof(p_topic->'links') <> 'array' then raise exception 'Links must be a list.' using errcode = '22023'; end if;
  for u in select distinct btrim(x) from jsonb_array_elements_text(coalesce(p_topic->'links', '[]'::jsonb)) x where btrim(x) <> '' loop
    if u !~* '^https?://[^\s/?#]+\.[^\s/?#]+(/\S*)?$' or char_length(u) > 1000 then
      raise exception 'This is not a web link (it must start with http:// or https://): %', left(u, 120) using errcode = '22023';
    end if;
    links := links || to_jsonb(u);
  end loop;
  if jsonb_array_length(links) > 20 then raise exception 'At most 20 links per suggestion.' using errcode = '22023'; end if;
  if exists (select 1 from public.youtube_video_suggestions s
             where lower(btrim(s.title)) = lower(t) and s.status in ('waiting', 'picked')) then
    raise exception 'You already suggested this video and it is still open.' using errcode = '23505';
  end if;
  insert into public.youtube_video_suggestions (title, place, links, note, submitted_by)
  values (t, pl, links, note, e) returning * into r;
  return to_jsonb(r);
end $$;

-- Withdraw an open suggestion (admin only). A suggestion already made or declined stays as it is.
create or replace function public.hs_youtube_video_suggestion_withdraw(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); r public.youtube_video_suggestions%rowtype;
begin
  update public.youtube_video_suggestions
     set status = 'withdrawn', updated_at = now()
   where id = p_id and status in ('waiting', 'picked')
  returning * into r;
  if r.id is null then
    raise exception 'That suggestion is not open any more.' using errcode = '22023';
  end if;
  return to_jsonb(r);
end $$;

revoke all on function public.hs_youtube_video_suggest(jsonb) from public, anon;
revoke all on function public.hs_youtube_video_suggestion_withdraw(uuid) from public, anon;
grant execute on function public.hs_youtube_video_suggest(jsonb) to authenticated;
grant execute on function public.hs_youtube_video_suggestion_withdraw(uuid) to authenticated;


-- ── Make video ────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.youtube_video_suggestion_runs (
  id            uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.youtube_video_suggestions(id),
  status        text not null default 'queued' check (status in ('queued', 'working', 'made', 'declined', 'failed')),
  requested_by  text not null,
  requested_at  timestamptz not null default now(),
  attempts      integer not null default 0,
  claimed_at    timestamptz,
  completed_at  timestamptz,
  prev_status   text,
  summary       text check (summary is null or char_length(summary) <= 2000),
  next_step     text check (next_step is null or char_length(next_step) <= 300),
  project_slug  text check (project_slug is null or project_slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  constraint youtube_video_suggestion_runs_made_has_slug check (status <> 'made' or project_slug is not null)
);
create unique index if not exists youtube_video_suggestion_runs_one_active
  on public.youtube_video_suggestion_runs (suggestion_id) where status in ('queued', 'working');
alter table public.youtube_video_suggestion_runs enable row level security;
revoke all on public.youtube_video_suggestion_runs from public, anon, authenticated;

-- The newest run of a suggestion, as the page shows it. A run claimed more than 5 hours ago and not finished is 'stalled'
-- (making, building and uploading a video takes up to about 3 hours); pressing Make video again starts it again.
create or replace function public._hs_yvs_run(p_suggestion uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'status', case when r.status = 'working' and r.claimed_at < now() - interval '5 hours' then 'stalled' else r.status end,
           'requested_at', r.requested_at, 'claimed_at', r.claimed_at, 'completed_at', r.completed_at, 'attempts', r.attempts,
           'summary', r.summary, 'next_step', r.next_step, 'project_slug', r.project_slug)
    from public.youtube_video_suggestion_runs r where r.suggestion_id = p_suggestion order by r.requested_at desc limit 1
$$;

-- Starts the job for a run (homesignal-ingest video-suggestion-run.yml, on main). Never raises on a missing credential:
-- the run is recorded failed with a readable reason, so the page shows it instead of a run that never moves.
create or replace function public._hs_yvs_dispatch(p_run uuid)
returns void language plpgsql security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare _pat text;
begin
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then
    update public.youtube_video_suggestion_runs set status = 'failed', completed_at = now(),
      summary = 'The video could not start because no GitHub credential is stored. Nothing was lost. Press Make video again once it is restored.'
     where id = p_run and status = 'queued';
    return;
  end if;
  perform net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/video-suggestion-run.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('run', p_run::text)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-video-suggestions', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000);
end $$;

-- The founder's Make video button. A second press while the run is queued, or stalled, starts the job again (the first
-- start may have been lost; a second job cannot claim a run the first already took); while it is working, it returns it.
create or replace function public.hs_youtube_video_suggestion_make(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.youtube_video_suggestions%rowtype; r public.youtube_video_suggestion_runs%rowtype;
begin
  select * into s from public.youtube_video_suggestions where id = p_id for update;
  if not found then raise exception 'no such suggestion' using errcode = 'P0002'; end if;
  if s.status not in ('waiting', 'picked') then
    raise exception 'This suggestion is %, so there is nothing to make.', s.status using errcode = '55000';
  end if;
  select * into r from public.youtube_video_suggestion_runs where suggestion_id = p_id and status in ('queued', 'working');
  if found then
    if r.status = 'queued' or r.claimed_at < now() - interval '5 hours' then perform public._hs_yvs_dispatch(r.id); end if;
    return jsonb_build_object('existing', true, 'run', public._hs_yvs_run(p_id));
  end if;
  insert into public.youtube_video_suggestion_runs (suggestion_id, requested_by, prev_status)
  values (p_id, e, s.status) returning * into r;
  perform public._hs_yvs_dispatch(r.id);
  return jsonb_build_object('existing', false, 'run', public._hs_yvs_run(p_id));
end $$;

-- The job's door (service role only, through homesignal-ingest scripts/video_suggestion_cli.py).
create or replace function public.youtube_video_suggestion_claim(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.youtube_video_suggestion_runs%rowtype; s public.youtube_video_suggestions%rowtype;
begin
  select * into r from public.youtube_video_suggestion_runs where id = p_run for update;
  if not found then raise exception 'no such run' using errcode = 'P0002'; end if;
  if not (r.status = 'queued' or (r.status = 'working' and r.claimed_at < now() - interval '5 hours')) then
    raise exception 'run is % and cannot be claimed', r.status using errcode = '55000';
  end if;
  select * into s from public.youtube_video_suggestions where id = r.suggestion_id for update;
  if r.attempts >= 3 or s.status not in ('waiting', 'picked') then
    update public.youtube_video_suggestion_runs set status = 'failed', completed_at = now(),
           summary = case when r.attempts >= 3 then 'Three attempts did not finish. Press Make video to try again.'
                          else 'The suggestion was closed, so the video run stopped.' end
     where id = r.id;
    raise exception 'run cannot be worked' using errcode = '55000';
  end if;
  update public.youtube_video_suggestion_runs set status = 'working', claimed_at = now(), attempts = attempts + 1 where id = r.id;
  update public.youtube_video_suggestions set status = 'picked', updated_at = now() where id = s.id;
  return jsonb_build_object('ok', true, 'run', r.id,
    'suggestion', jsonb_build_object('id', s.id, 'title', s.title, 'place', s.place, 'links', s.links, 'note', s.note));
end $$;

-- Finish a run. p_payload: {status: made|declined|failed, summary, next_step, project_slug}. made needs the slug the
-- video was uploaded under; a failed run puts the suggestion back where it was. A suggestion the founder withdrew while
-- the run worked stays withdrawn.
create or replace function public.youtube_video_suggestion_complete(p_run uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.youtube_video_suggestion_runs%rowtype; st text := p_payload->>'status';
        slug text := nullif(btrim(coalesce(p_payload->>'project_slug', '')), '');
        summ text := left(nullif(btrim(p_payload->>'summary'), ''), 2000);
        nxt text := left(nullif(btrim(p_payload->>'next_step'), ''), 300);
begin
  select * into r from public.youtube_video_suggestion_runs where id = p_run for update;
  if not found then raise exception 'no such run' using errcode = 'P0002'; end if;
  if r.status <> 'working' then raise exception 'run is %, not working', r.status using errcode = '55000'; end if;
  if st not in ('made', 'declined', 'failed') then raise exception 'bad status' using errcode = '22023'; end if;
  if summ is null then raise exception 'say what was done' using errcode = '22023'; end if;
  if st = 'made' and (slug is null or slug !~ '^[a-z0-9][a-z0-9-]{1,80}$') then raise exception 'made needs the project slug' using errcode = '22023'; end if;
  update public.youtube_video_suggestion_runs set status = st, completed_at = now(), summary = summ, next_step = nxt,
         project_slug = case when st = 'made' then slug end
   where id = r.id;
  update public.youtube_video_suggestions set updated_at = now(),
         status = case st when 'made' then 'made' when 'declined' then 'declined' else coalesce(r.prev_status, 'waiting') end,
         project_slug = case when st = 'made' then slug else project_slug end,
         status_note = case when st = 'failed' then status_note else left(summ || coalesce(' ' || nxt, ''), 2000) end
   where id = r.suggestion_id and status = 'picked';
  return jsonb_build_object('ok', true, 'status', st);
end $$;

-- List (admin only): open ones first, then newest, each with its newest Make video run. Withdrawn ones older than 30
-- days are left out.
create or replace function public.hs_youtube_video_suggestions_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  return coalesce((
    select jsonb_agg(to_jsonb(s) || jsonb_build_object('run', public._hs_yvs_run(s.id))
                     order by (s.status in ('waiting', 'picked')) desc, s.created_at desc)
    from public.youtube_video_suggestions s
    where s.status <> 'withdrawn' or s.updated_at > now() - interval '30 days'
  ), '[]'::jsonb);
end $$;

revoke all on function public._hs_yvs_run(uuid) from public, anon, authenticated;
revoke all on function public._hs_yvs_dispatch(uuid) from public, anon, authenticated;
revoke all on function public.hs_youtube_video_suggestion_make(uuid) from public, anon;
revoke all on function public.youtube_video_suggestion_claim(uuid) from public, anon, authenticated;
revoke all on function public.youtube_video_suggestion_complete(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.hs_youtube_video_suggestions_list() from public, anon;
grant execute on function public.hs_youtube_video_suggestion_make(uuid) to authenticated;
grant execute on function public.hs_youtube_video_suggestions_list() to authenticated;
grant execute on function public.youtube_video_suggestion_claim(uuid) to service_role;
grant execute on function public.youtube_video_suggestion_complete(uuid, jsonb) to service_role;

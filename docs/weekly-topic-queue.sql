-- Tab 20 · Weekly Report, TOPIC QUEUE AND RESEARCH HANDOFF: DDL of record. PREPARED, NOT APPLIED TO PRODUCTION.
-- Apply AFTER docs/weekly-stage2-slice.sql (it uses that file's tables and helpers). Idempotent: safe to apply twice.
-- Re-applying the Stage 2 file afterwards changes nothing here (this file touches no Stage 2 table or function).
--
-- Why it exists: a story lead, or a public promise to cover something, was kept nowhere between a social post and the
-- research for a video. This file keeps them, and ties each one to the report edition and the research request it led to.
--
--   capture a lead (title only is enough) -> assign it to a report edition -> send it to research (ONE research request,
--   linked for good) -> a person records its outcome in that edition (included / deferred / dropped) -> the edition
--   records OUR video's URL and publication date.
--
-- Three tables, nothing else is stored:
--   weekly_editions            one report edition: series, category, an identifier, reporting period start and end,
--                              its closure, and our published video (URL + date). Nothing requires one edition per week.
--   weekly_topic_leads         a lead: what a person captured. Editable, never deleted.
--   weekly_topic_lead_events   append-only history: captured / edited / assigned / handoff / disposition, and the
--                              explicit link between a script or title version and an edition (version_linked).
--
-- Rules this file enforces (test/weekly_stage2_pg/topic_queue.sql proves each one, with mutations):
--   - Nothing is readable or writable by anon or authenticated directly (RLS on, no grant). People act through the
--     admin-only functions below (public._hs_is_admin).
--   - A lead is saved with a title alone. An edition is needed to send it to research, not to capture it.
--   - PROMISED PUBLICLY is its own fact: true only when the URL of the PUBLISHED post that made the promise is recorded,
--     with its exact wording. Wording without a post URL is a draft and is never a commitment. Once recorded, the
--     commitment is never changed or removed. It records that a promise was made; it says nothing about whether the
--     story's claims are true.
--   - SEND TO RESEARCH runs in one transaction: it assigns the lead to the edition, writes one research request (the same
--     table hs_weekly_request_research writes) and records the link. If any part fails, nothing changes: the lead keeps
--     its exact prior state, including an assignment it already had. A repeated call for the same lead and edition
--     returns the request already made.
--   - STATUS is derived, never typed in: captured · queued_for_research (request written, no answer pasted) ·
--     researching (answer pasted, ingest not finished) · ready_for_editorial_review (ingest finished) ·
--     included · published (included in an edition that records our video URL and date) · deferred · dropped.
--     "Researched", "included" and "published" are three different facts.
--   - A lead's disposition in an EARLIER edition is kept apart from its CURRENT assignment. A deferred or dropped lead
--     has no current assignment, stays in the carry-forward view with its disposition and reason, and can be assigned
--     to a later edition and researched again (a new request for that edition).
--   - Deferring or dropping a publicly promised lead needs a reason.
--   - APPROVAL GATE: a script approval, or a title's publication approval, is refused while a lead ASSIGNED TO THAT
--     VERSION'S EDITION has no disposition. The edition is the one a person explicitly linked to the version or to a
--     version it descends from (parent / depends_on); it is never guessed from a title or a date. A version with no
--     linked edition is not gated, and leads that are not assigned to that edition never block it. Nothing here makes
--     a promised lead be included.
--   - CLOSING an edition ends its editorial decisions: every assigned lead must have a disposition first, and after
--     closing no lead can be assigned, sent to research or re-decided in it. An edition can close without a published
--     video (a reason is required then); its deferred leads stay in carry-forward with their reasons.
--   - PUBLICATION needs both our video's URL and its publication date, is recorded once, and is refused for a URL that
--     is one of a lead's own source, social-post or commitment URLs: a source story or a social post is not our video.
--   - Nothing here posts anywhere, starts a job, or calls a paid service.

begin;

-- ── tables ───────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_editions (
  id uuid primary key default gen_random_uuid(),
  series text not null default 'QUALITY-of-LIFE Weekly Report' check (char_length(series) between 3 and 120),
  stream text not null default 'news',
  topic text not null,                                    -- the report category (a Local News topic)
  edition_key text not null unique check (edition_key ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  period_start date not null,
  period_end date not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by text,
  close_reason text check (char_length(close_reason) <= 1000),
  video_url text check (video_url ~ '^https://[^\s]+$' and char_length(video_url) <= 2000),
  published_on date,
  publication_recorded_by text,
  publication_recorded_at timestamptz,
  constraint weekly_editions_period_ck check (period_end >= period_start),
  constraint weekly_editions_topic_fk foreign key (stream, topic) references public.alert_topic_catalog (stream, topic),
  constraint weekly_editions_closed_ck check ((closed_at is null) = (closed_by is null)),
  -- published means BOTH our video's URL and its publication date
  constraint weekly_editions_publication_ck check (
    (video_url is null) = (published_on is null) and (video_url is null) = (publication_recorded_by is null)
    and (video_url is null) = (publication_recorded_at is null))
);

create table if not exists public.weekly_topic_leads (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  stream text not null default 'news',
  topic text,                                             -- report category; may be empty at capture
  location text check (char_length(location) <= 300),
  source_urls text[] not null default '{}' check (cardinality(source_urls) <= 30),
  social_post_url text check (social_post_url ~ '^https?://[^\s]+$' and char_length(social_post_url) <= 2000),
  notes text check (char_length(notes) <= 6000),
  why_it_matters text check (char_length(why_it_matters) <= 2000),
  questions text[] not null default '{}' check (cardinality(questions) <= 30),
  intended_edition_id uuid references public.weekly_editions (id),
  intended_date date,
  -- the commitment: wording alone is a draft; the published post's URL is what records a public promise
  commitment_wording text check (char_length(commitment_wording) between 1 and 2000),
  commitment_post_url text check (commitment_post_url ~ '^https?://[^\s]+$' and char_length(commitment_post_url) <= 2000),
  promised_publicly boolean generated always as (commitment_post_url is not null) stored,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_topic_leads_topic_fk foreign key (stream, topic) references public.alert_topic_catalog (stream, topic),
  constraint weekly_topic_leads_commitment_ck check (commitment_post_url is null or commitment_wording is not null)
);

create table if not exists public.weekly_topic_lead_events (
  id bigserial primary key,
  kind text not null check (kind in ('captured', 'edited', 'assigned', 'handoff', 'disposition', 'version_linked')),
  lead_id uuid references public.weekly_topic_leads (id),
  edition_id uuid references public.weekly_editions (id),
  request_id uuid references public.weekly_research_requests (id),
  version_id uuid references public.weekly_scripts (id),
  disposition text check (disposition in ('included', 'deferred', 'dropped')),
  reason text check (char_length(reason) <= 1000),
  detail jsonb,
  actor text not null,
  created_at timestamptz not null default now(),
  constraint weekly_topic_lead_events_shape_ck check (
    case kind
      when 'captured' then lead_id is not null and edition_id is null
      when 'edited' then lead_id is not null and edition_id is null
      when 'assigned' then lead_id is not null and edition_id is not null
      when 'handoff' then lead_id is not null and edition_id is not null
      when 'disposition' then lead_id is not null and edition_id is not null
      when 'version_linked' then lead_id is null and edition_id is not null
    end),
  constraint weekly_topic_lead_events_request_ck check ((kind = 'handoff') = (request_id is not null)),
  constraint weekly_topic_lead_events_disposition_ck check ((kind = 'disposition') = (disposition is not null)),
  constraint weekly_topic_lead_events_version_ck check ((kind = 'version_linked') = (version_id is not null))
);
-- one assignment and one research request per lead and edition; one request is never handed to two leads;
-- a version is linked to one edition
create unique index if not exists weekly_topic_lead_events_assigned_uq on public.weekly_topic_lead_events (lead_id, edition_id) where kind = 'assigned';
create unique index if not exists weekly_topic_lead_events_handoff_uq on public.weekly_topic_lead_events (lead_id, edition_id) where kind = 'handoff';
create unique index if not exists weekly_topic_lead_events_request_uq on public.weekly_topic_lead_events (request_id) where kind = 'handoff';
create unique index if not exists weekly_topic_lead_events_version_uq on public.weekly_topic_lead_events (version_id) where kind = 'version_linked';
create index if not exists weekly_topic_lead_events_lead_ix on public.weekly_topic_lead_events (lead_id, id);
create index if not exists weekly_topic_lead_events_edition_ix on public.weekly_topic_lead_events (edition_id, kind);

-- ── guards ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- An edition's identity never changes. Two things are filled, once each: its closure and its publication.
create or replace function public.weekly_editions_guard() returns trigger language plpgsql as $$
declare close_cols text[] := array['closed_at', 'closed_by', 'close_reason'];
        pub_cols text[] := array['video_url', 'published_on', 'publication_recorded_by', 'publication_recorded_at'];
begin
  if tg_op = 'DELETE' then raise exception 'weekly_editions is never deleted from' using errcode = '55000'; end if;
  if old.closed_at is null and new.closed_at is not null and (to_jsonb(new) - close_cols) = (to_jsonb(old) - close_cols) then return new; end if;
  if old.video_url is null and new.video_url is not null and (to_jsonb(new) - pub_cols) = (to_jsonb(old) - pub_cols) then return new; end if;
  raise exception 'an edition is only closed once and published once; nothing else about it changes' using errcode = '55000';
end $$;

-- A lead is never deleted, and a recorded public commitment is never changed or removed.
create or replace function public.weekly_topic_leads_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'weekly_topic_leads is never deleted from' using errcode = '55000'; end if;
  if old.commitment_post_url is not null and (new.commitment_post_url is distinct from old.commitment_post_url
       or new.commitment_wording is distinct from old.commitment_wording) then
    raise exception 'a recorded public commitment is never changed or removed' using errcode = '55000';
  end if;
  if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'a lead''s identity never changes' using errcode = '55000';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  drop trigger if exists weekly_editions_guard on public.weekly_editions;
  create trigger weekly_editions_guard before update or delete on public.weekly_editions for each row execute function public.weekly_editions_guard();
  drop trigger if exists weekly_topic_leads_guard on public.weekly_topic_leads;
  create trigger weekly_topic_leads_guard before update or delete on public.weekly_topic_leads for each row execute function public.weekly_topic_leads_guard();
  drop trigger if exists weekly_topic_lead_events_append_only on public.weekly_topic_lead_events;
  create trigger weekly_topic_lead_events_append_only before update or delete on public.weekly_topic_lead_events
    for each row execute function public.weekly_append_only();
  foreach t in array array['weekly_editions', 'weekly_topic_leads', 'weekly_topic_lead_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
  revoke all on sequence public.weekly_topic_lead_events_id_seq from public, anon, authenticated;
end $$;

-- ── derived state ────────────────────────────────────────────────────────────────────────────────────────────────
-- Each (lead, edition) assignment with its newest disposition and its research request.
create or replace function public.weekly_lead_assignments(p_lead uuid)
returns table (edition_id uuid, assigned_id bigint, assigned_at timestamptz, request_id uuid, disposition text, reason text,
               disposed_id bigint, disposed_at timestamptz, disposed_by text)
language sql stable security definer set search_path = public as $$
  select a.edition_id, a.id, a.created_at, h.request_id, d.disposition, d.reason, d.id, d.created_at, d.actor
  from public.weekly_topic_lead_events a
  left join public.weekly_topic_lead_events h on h.kind = 'handoff' and h.lead_id = a.lead_id and h.edition_id = a.edition_id
  left join lateral (select x.* from public.weekly_topic_lead_events x where x.kind = 'disposition' and x.lead_id = a.lead_id
                     and x.edition_id = a.edition_id order by x.id desc limit 1) d on true
  where a.kind = 'assigned' and a.lead_id = p_lead
$$;

-- Where the research for one request stands. Never "verified": only whether an answer was pasted and its ingest finished.
create or replace function public.weekly_request_research_status(p_request uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when a.id is null then jsonb_build_object('status', 'queued_for_research')
    when r.status = 'done' then jsonb_build_object('status', 'ready_for_editorial_review', 'answer_id', a.id)
    else jsonb_build_object('status', 'researching', 'answer_id', a.id, 'run_status', r.status, 'run_error', r.error)
  end
  from (select p_request as rid) q
  left join lateral (select x.id from public.weekly_research_answers x where x.request_id = q.rid order by x.pasted_at desc, x.id desc limit 1) a on true
  left join lateral (select x.status, x.error from public.weekly_runs x where x.kind = 'research_ingest' and x.input ->> 'answer_id' = a.id::text
                     order by x.created_at desc, x.id desc limit 1) r on true
$$;

create or replace function public.weekly_edition_json(p_edition uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'series', e.series, 'topic', e.topic, 'edition_key', e.edition_key,
    'period_start', e.period_start, 'period_end', e.period_end, 'closed', e.closed_at is not null, 'closed_at', e.closed_at,
    'close_reason', e.close_reason, 'published', e.video_url is not null, 'video_url', e.video_url, 'published_on', e.published_on)
  from public.weekly_editions e where e.id = p_edition
$$;

-- A lead's state: its status, its current assignment (if any), and what happened to it in earlier editions.
create or replace function public.weekly_lead_state(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cur record; last record; st text; research jsonb; hist jsonb; l public.weekly_topic_leads;
begin
  select * into l from public.weekly_topic_leads where id = p_lead;
  if l.id is null then return null; end if;
  -- current assignment: the one not ended by a deferral or a drop
  select a.* into cur from public.weekly_lead_assignments(p_lead) a
    where a.disposition is null or a.disposition = 'included' order by a.assigned_id desc limit 1;
  -- the newest ended one (kept apart from the current assignment)
  select a.* into last from public.weekly_lead_assignments(p_lead) a
    where a.disposition in ('deferred', 'dropped') order by a.disposed_id desc limit 1;
  if cur.edition_id is not null then
    if cur.request_id is not null then research := public.weekly_request_research_status(cur.request_id); end if;
    st := case
      when cur.disposition = 'included' and (select video_url is not null from public.weekly_editions where id = cur.edition_id) then 'published'
      when cur.disposition = 'included' then 'included'
      when cur.request_id is null then 'captured'
      else research ->> 'status' end;
  else
    st := coalesce(last.disposition, 'captured');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('edition', public.weekly_edition_json(a.edition_id), 'assigned_at', a.assigned_at,
      'request_id', a.request_id, 'disposition', a.disposition, 'reason', a.reason, 'disposed_at', a.disposed_at, 'disposed_by', a.disposed_by,
      'current', cur.edition_id is not null and a.edition_id = cur.edition_id) order by a.assigned_id), '[]'::jsonb)
    into hist from public.weekly_lead_assignments(p_lead) a;
  return jsonb_build_object(
    'status', st,
    'promised_publicly', l.promised_publicly,
    -- a commitment is resolved when our video was published with the lead in it, or a person dropped it with a reason
    'commitment_resolved', l.promised_publicly and st in ('published', 'dropped'),
    'assigned', cur.edition_id is not null,
    'current', case when cur.edition_id is not null then jsonb_build_object('edition', public.weekly_edition_json(cur.edition_id),
        'request_id', cur.request_id, 'disposition', cur.disposition, 'research', research) end,
    'last_disposition', case when last.edition_id is not null then jsonb_build_object('edition', public.weekly_edition_json(last.edition_id),
        'disposition', last.disposition, 'reason', last.reason, 'disposed_at', last.disposed_at) end,
    'editions', hist);
end $$;

-- Leads assigned to an edition that still have no disposition there.
create or replace function public.weekly_edition_unresolved(p_edition uuid) returns table (lead_id uuid, title text)
language sql stable security definer set search_path = public as $$
  select l.id, l.title from public.weekly_topic_lead_events a join public.weekly_topic_leads l on l.id = a.lead_id
  where a.kind = 'assigned' and a.edition_id = p_edition
    and not exists (select 1 from public.weekly_topic_lead_events d where d.kind = 'disposition' and d.lead_id = a.lead_id and d.edition_id = a.edition_id)
  order by a.id
$$;

-- The edition a version belongs to: the one explicitly linked to it, or to the nearest version it descends from
-- (its parent, or the version it was written from). Never read from a title or a date.
create or replace function public.weekly_version_edition(p_version uuid) returns uuid
language sql stable security definer set search_path = public as $$
  with recursive up (id, depth) as (
    select p_version, 0
    union
    select x.pid, up.depth + 1 from up join public.weekly_scripts s on s.id = up.id
      cross join lateral (values (s.parent_id), (s.depends_on)) x (pid) where x.pid is not null and up.depth < 60)
  select e.edition_id from up join public.weekly_topic_lead_events e on e.kind = 'version_linked' and e.version_id = up.id
  order by up.depth, e.id limit 1
$$;

-- ── the approval gate ────────────────────────────────────────────────────────────────────────────────────────────
-- A script approval, or a title's publication approval, is refused while a lead assigned to that version's edition has
-- no disposition. A version with no linked edition is not gated.
create or replace function public.weekly_edition_approval_gate() returns trigger language plpgsql security definer set search_path = public as $$
declare st text; ed uuid; n integer; names text; k text;
begin
  select stage into st from public.weekly_scripts where id = new.script_id;
  if not (st = 'script' or (st = 'title' and new.approval_kind = 'publication')) then return new; end if;
  ed := public.weekly_version_edition(new.script_id);
  if ed is null then return new; end if;
  select count(*), string_agg(u.title, '; ') into n, names from public.weekly_edition_unresolved(ed) u;
  if n > 0 then
    select edition_key into k from public.weekly_editions where id = ed;
    raise exception '% lead(s) assigned to edition % have no disposition yet (included, deferred or dropped): %', n, k, left(names, 600)
      using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists weekly_edition_approval_gate on public.weekly_script_approvals;
create trigger weekly_edition_approval_gate before insert on public.weekly_script_approvals
  for each row execute function public.weekly_edition_approval_gate();

-- ── admin functions ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public._wk_urls(p jsonb, p_what text) returns text[]
language plpgsql immutable as $$
declare out text[] := '{}'; u text;
begin
  if p is null or jsonb_typeof(p) = 'null' then return out; end if;
  if jsonb_typeof(p) <> 'array' then raise exception '% is a list', p_what using errcode = '22023'; end if;
  for u in select btrim(x) from jsonb_array_elements_text(p) x loop
    if u = '' then continue; end if;
    if u !~ '^https?://[^\s]+$' or char_length(u) > 2000 then raise exception '% holds something that is not a web address: %', p_what, left(u, 80) using errcode = '22023'; end if;
    if not u = any (out) then out := out || u; end if;
  end loop;
  return out;
end $$;

-- Save a lead. A new lead needs a title and nothing else; an existing lead changes only the fields that are sent.
-- p_fields keys: title, topic, location, source_urls[], social_post_url, notes, why_it_matters, questions[],
--                intended_edition_id, intended_date, commitment_wording, commitment_post_url
create or replace function public.hs_weekly_lead_save(p_lead uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); l public.weekly_topic_leads; k text; f jsonb := coalesce(p_fields, '{}'::jsonb);
        allowed text[] := array['title', 'topic', 'location', 'source_urls', 'social_post_url', 'notes', 'why_it_matters', 'questions',
                                'intended_edition_id', 'intended_date', 'commitment_wording', 'commitment_post_url'];
        isnew boolean := p_lead is null; q text[];
begin
  if jsonb_typeof(f) <> 'object' then raise exception 'the lead''s fields are an object' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(f) loop
    if not k = any (allowed) then raise exception 'unknown lead field: %', k using errcode = '22023'; end if;
  end loop;
  if isnew then
    if btrim(coalesce(f ->> 'title', '')) = '' then raise exception 'a lead needs a title' using errcode = '22023'; end if;
    insert into public.weekly_topic_leads (title, created_by) values (btrim(f ->> 'title'), e) returning * into l;
  else
    select * into l from public.weekly_topic_leads where id = p_lead for update;
    if l.id is null then raise exception 'unknown lead' using errcode = '22023'; end if;
  end if;
  if f ? 'title' then
    if btrim(coalesce(f ->> 'title', '')) = '' then raise exception 'a lead needs a title' using errcode = '22023'; end if;
    l.title := btrim(f ->> 'title');
  end if;
  if f ? 'topic' then l.topic := nullif(btrim(coalesce(f ->> 'topic', '')), ''); end if;
  if f ? 'location' then l.location := nullif(btrim(coalesce(f ->> 'location', '')), ''); end if;
  if f ? 'source_urls' then l.source_urls := public._wk_urls(f -> 'source_urls', 'source URLs'); end if;
  if f ? 'social_post_url' then l.social_post_url := nullif(btrim(coalesce(f ->> 'social_post_url', '')), ''); end if;
  if f ? 'notes' then l.notes := nullif(btrim(coalesce(f ->> 'notes', '')), ''); end if;
  if f ? 'why_it_matters' then l.why_it_matters := nullif(btrim(coalesce(f ->> 'why_it_matters', '')), ''); end if;
  if f ? 'questions' then
    if jsonb_typeof(f -> 'questions') not in ('array', 'null') then raise exception 'the questions are a list' using errcode = '22023'; end if;
    select coalesce(array_agg(btrim(x)), '{}') into q from jsonb_array_elements_text(case when jsonb_typeof(f -> 'questions') = 'array' then f -> 'questions' else '[]'::jsonb end) x
      where btrim(x) <> '';
    if exists (select 1 from unnest(q) x where char_length(x) > 500) then raise exception 'a question is at most 500 characters' using errcode = '22023'; end if;
    l.questions := q;
  end if;
  if f ? 'intended_edition_id' then l.intended_edition_id := nullif(f ->> 'intended_edition_id', '')::uuid; end if;
  if f ? 'intended_date' then l.intended_date := nullif(f ->> 'intended_date', '')::date; end if;
  if f ? 'commitment_wording' then l.commitment_wording := nullif(btrim(coalesce(f ->> 'commitment_wording', '')), ''); end if;
  if f ? 'commitment_post_url' then l.commitment_post_url := nullif(btrim(coalesce(f ->> 'commitment_post_url', '')), ''); end if;
  if l.commitment_post_url is not null and l.commitment_wording is null then
    raise exception 'a public commitment needs its exact wording as well as the published post''s address' using errcode = '22023';
  end if;
  if l.topic is not null and not exists (select 1 from public.alert_topic_catalog c where c.stream = 'news' and c.topic = l.topic) then
    raise exception 'unknown report category: %', l.topic using errcode = '22023';
  end if;
  if l.intended_edition_id is not null and not exists (select 1 from public.weekly_editions where id = l.intended_edition_id) then
    raise exception 'unknown edition' using errcode = '22023';
  end if;
  update public.weekly_topic_leads set title = l.title, topic = l.topic, location = l.location, source_urls = l.source_urls,
    social_post_url = l.social_post_url, notes = l.notes, why_it_matters = l.why_it_matters, questions = l.questions,
    intended_edition_id = l.intended_edition_id, intended_date = l.intended_date, commitment_wording = l.commitment_wording,
    commitment_post_url = l.commitment_post_url, updated_at = now() where id = l.id;
  insert into public.weekly_topic_lead_events (kind, lead_id, detail, actor)
    values (case when isnew then 'captured' else 'edited' end, l.id, jsonb_build_object('fields', (select coalesce(jsonb_agg(x order by x), '[]') from jsonb_object_keys(f) x)), e);
  return jsonb_build_object('lead_id', l.id, 'state', public.weekly_lead_state(l.id));
end $$;

-- A report edition: series, category, reporting period and an identifier. The period defaults to seven days; nothing
-- requires one edition per series per week. p_key is the identifier; left empty, one is made from the category and start.
create or replace function public.hs_weekly_edition_create(p_topic text, p_period_start date, p_period_end date default null,
  p_series text default null, p_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); k text := nullif(btrim(coalesce(p_key, '')), ''); base text; n integer := 1; id uuid;
        pe date := coalesce(p_period_end, p_period_start + 6);
begin
  if p_period_start is null then raise exception 'an edition needs its reporting period start' using errcode = '22023'; end if;
  if pe < p_period_start then raise exception 'the reporting period ends before it starts' using errcode = '22023'; end if;
  if not exists (select 1 from public.alert_topic_catalog c where c.stream = 'news' and c.topic = p_topic) then
    raise exception 'unknown report category: %', p_topic using errcode = '22023';
  end if;
  if k is null then
    base := btrim(regexp_replace(lower(p_topic), '[^a-z0-9]+', '-', 'g'), '-') || '-' || to_char(p_period_start, 'YYYY-MM-DD');
    k := base;
    while exists (select 1 from public.weekly_editions where edition_key = k) loop n := n + 1; k := base || '-' || n; end loop;
  elsif k !~ '^[a-z0-9][a-z0-9-]{2,80}$' then
    raise exception 'an edition identifier is lowercase letters, digits and hyphens' using errcode = '22023';
  elsif exists (select 1 from public.weekly_editions where edition_key = k) then
    raise exception 'an edition with the identifier % already exists', k using errcode = '23505';
  end if;
  insert into public.weekly_editions (series, topic, edition_key, period_start, period_end, created_by)
    values (coalesce(nullif(btrim(coalesce(p_series, '')), ''), 'QUALITY-of-LIFE Weekly Report'), p_topic, k, p_period_start, pe, e) returning weekly_editions.id into id;
  return public.weekly_edition_json(id);
end $$;

-- Shared by assign and send-to-research. Returns true when it wrote the assignment, false when it already existed.
create or replace function public._wk_lead_assign(p_lead uuid, p_edition uuid, p_actor text) returns boolean
language plpgsql security definer set search_path = public as $$
declare l public.weekly_topic_leads; ed public.weekly_editions; a record; other record;
begin
  select * into l from public.weekly_topic_leads where id = p_lead for update;   -- one writer per lead at a time
  if l.id is null then raise exception 'unknown lead' using errcode = '22023'; end if;
  select * into ed from public.weekly_editions where id = p_edition;
  if ed.id is null then raise exception 'choose a report edition first' using errcode = '22023'; end if;
  select * into a from public.weekly_lead_assignments(p_lead) x where x.edition_id = p_edition;
  if a.edition_id is not null then
    if a.disposition in ('deferred', 'dropped') then
      raise exception 'this lead was % in edition %; assign it to another edition', a.disposition, ed.edition_key using errcode = '22023';
    end if;
    return false;
  end if;
  if ed.closed_at is not null then raise exception 'edition % is closed', ed.edition_key using errcode = '55000'; end if;
  if l.topic is not null and l.topic <> ed.topic then
    raise exception 'this lead is filed under "%"; edition % is a "%" report', l.topic, ed.edition_key, ed.topic using errcode = '22023';
  end if;
  select x.* into other from public.weekly_lead_assignments(p_lead) x where x.disposition is null or x.disposition = 'included' limit 1;
  if other.edition_id is not null then
    raise exception 'this lead is already assigned to edition %; defer or drop it there first',
      (select edition_key from public.weekly_editions where id = other.edition_id) using errcode = '55006';
  end if;
  insert into public.weekly_topic_lead_events (kind, lead_id, edition_id, actor) values ('assigned', p_lead, p_edition, p_actor);
  return true;
end $$;

create or replace function public.hs_weekly_lead_assign(p_lead uuid, p_edition uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); wrote boolean;
begin
  wrote := public._wk_lead_assign(p_lead, p_edition, e);
  return jsonb_build_object('lead_id', p_lead, 'edition_id', p_edition, 'existing', not wrote, 'state', public.weekly_lead_state(p_lead));
end $$;

-- The research request a lead becomes. Everything in it is a lead, not evidence, and it says so.
create or replace function public.weekly_lead_request_text(p_lead uuid, p_edition uuid, p_answer_format text default null) returns text
language sql stable security definer set search_path = public as $$
  select 'Research lead for the ' || ed.series || ' (' || ed.topic || '), edition ' || ed.edition_key || ', reporting period ' ||
      ed.period_start || ' to ' || ed.period_end || '.' || E'\n' ||
    'Lead: ' || l.title || E'\n' ||
    case when l.location is not null then 'Location: ' || l.location || E'\n' else '' end ||
    case when l.why_it_matters is not null then 'Why this matters to residents'' quality of life: ' || l.why_it_matters || E'\n' else '' end ||
    case when cardinality(l.questions) > 0 then E'\nQuestions the research must answer:\n' ||
      (select string_agg(i || '. ' || q, E'\n' order by i) from unnest(l.questions) with ordinality t (q, i)) || E'\n' else '' end ||
    case when cardinality(l.source_urls) > 0 then E'\nWhere the lead came from (starting points to check, not evidence):\n' ||
      (select string_agg('- ' || u, E'\n' order by i) from unnest(l.source_urls) with ordinality t (u, i)) || E'\n' else '' end ||
    case when l.social_post_url is not null then 'Social post about it: ' || l.social_post_url || E'\n' else '' end ||
    case when l.notes is not null then E'\nNotes:\n' || l.notes || E'\n' else '' end ||
    E'\nPublic coverage commitment: ' || case
      when l.commitment_post_url is not null then 'PROMISED PUBLICLY in a published post (' || l.commitment_post_url || '): "' || l.commitment_wording || '"'
      when l.commitment_wording is not null then 'drafted, not published: "' || l.commitment_wording || '"'
      else 'none recorded' end || E'\n' ||
    E'\nEvery statement above is an unverified lead. Find the primary records, say what is established and what is not, ' ||
    'and say plainly if the lead cannot be confirmed. A promise to cover this is not a reason to confirm it.' ||
    case when nullif(btrim(coalesce(p_answer_format, '')), '') is not null then E'\n\n' || btrim(p_answer_format) else '' end
  from public.weekly_topic_leads l, public.weekly_editions ed where l.id = p_lead and ed.id = p_edition
$$;

-- SEND TO RESEARCH. One transaction: assignment (if new), one research request, and the link between them. A failure
-- leaves everything as it was. A repeated call for the same lead and edition returns the request already made.
-- p_answer_format: the answer-format instructions the Weekly Report screen adds to every request (kept in one place there).
create or replace function public.hs_weekly_lead_send_to_research(p_lead uuid, p_edition uuid, p_answer_format text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); ed public.weekly_editions; had uuid; rq uuid; txt text;
begin
  if p_edition is null then raise exception 'choose a report edition first' using errcode = '22023'; end if;
  perform 1 from public.weekly_topic_leads where id = p_lead for update;
  if not found then raise exception 'unknown lead' using errcode = '22023'; end if;
  select request_id into had from public.weekly_topic_lead_events where kind = 'handoff' and lead_id = p_lead and edition_id = p_edition;
  if had is not null then
    return jsonb_build_object('lead_id', p_lead, 'edition_id', p_edition, 'request_id', had, 'existing', true, 'state', public.weekly_lead_state(p_lead));
  end if;
  perform public._wk_lead_assign(p_lead, p_edition, e);
  select * into ed from public.weekly_editions where id = p_edition;
  if ed.closed_at is not null then raise exception 'edition % is closed', ed.edition_key using errcode = '55000'; end if;
  txt := public.weekly_lead_request_text(p_lead, p_edition, p_answer_format);
  if char_length(txt) > 20000 then
    raise exception 'the research request would be % characters; the limit is 20000. Shorten the notes.', char_length(txt) using errcode = '22023';
  end if;
  insert into public.weekly_research_requests (topic, request_text, created_by) values (ed.topic, txt, e) returning id into rq;
  insert into public.weekly_topic_lead_events (kind, lead_id, edition_id, request_id, actor) values ('handoff', p_lead, p_edition, rq, e);
  return jsonb_build_object('lead_id', p_lead, 'edition_id', p_edition, 'request_id', rq, 'existing', false, 'state', public.weekly_lead_state(p_lead));
end $$;

-- A person's outcome for a lead IN ONE EDITION: included, deferred or dropped. Deferring or dropping a publicly
-- promised lead needs a reason. Nothing makes a promised lead be included.
create or replace function public.hs_weekly_lead_disposition(p_lead uuid, p_edition uuid, p_disposition text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); l public.weekly_topic_leads; ed public.weekly_editions; a record; r text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into l from public.weekly_topic_leads where id = p_lead for update;
  if l.id is null then raise exception 'unknown lead' using errcode = '22023'; end if;
  select * into ed from public.weekly_editions where id = p_edition;
  if ed.id is null then raise exception 'unknown edition' using errcode = '22023'; end if;
  if p_disposition not in ('included', 'deferred', 'dropped') then
    raise exception 'a disposition is included, deferred or dropped' using errcode = '22023';
  end if;
  select * into a from public.weekly_lead_assignments(p_lead) x where x.edition_id = p_edition;
  if a.edition_id is null then raise exception 'this lead is not assigned to edition %', ed.edition_key using errcode = '22023'; end if;
  if ed.closed_at is not null then raise exception 'edition % is closed; its decisions stand', ed.edition_key using errcode = '55000'; end if;
  if l.promised_publicly and p_disposition in ('deferred', 'dropped') and char_length(coalesce(r, '')) < 10 then
    raise exception 'this lead was promised publicly: say why it is % (at least 10 characters)', p_disposition using errcode = '22023';
  end if;
  if a.disposition in ('deferred', 'dropped') and p_disposition = 'included'
     and exists (select 1 from public.weekly_lead_assignments(p_lead) x where x.edition_id <> p_edition and (x.disposition is null or x.disposition = 'included')) then
    raise exception 'this lead is now assigned to another edition' using errcode = '55006';
  end if;
  insert into public.weekly_topic_lead_events (kind, lead_id, edition_id, disposition, reason, actor)
    values ('disposition', p_lead, p_edition, p_disposition, r, e);
  return jsonb_build_object('lead_id', p_lead, 'edition_id', p_edition, 'state', public.weekly_lead_state(p_lead));
end $$;

-- Link a script or title version to an edition, explicitly. Versions made from it later belong to the same edition.
create or replace function public.hs_weekly_edition_link_version(p_edition uuid, p_version uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); ed public.weekly_editions; v public.weekly_scripts; has uuid;
begin
  select * into ed from public.weekly_editions where id = p_edition;
  if ed.id is null then raise exception 'unknown edition' using errcode = '22023'; end if;
  select * into v from public.weekly_scripts where id = p_version;
  if v.id is null then raise exception 'unknown version' using errcode = '22023'; end if;
  if v.topic <> ed.topic then raise exception 'that version is a "%" draft; edition % is a "%" report', v.topic, ed.edition_key, ed.topic using errcode = '22023'; end if;
  has := public.weekly_version_edition(p_version);
  if has = p_edition then return jsonb_build_object('edition_id', p_edition, 'version_id', p_version, 'existing', true); end if;
  if has is not null then
    raise exception 'that version already belongs to edition %', (select edition_key from public.weekly_editions where id = has) using errcode = '22023';
  end if;
  if ed.closed_at is not null then raise exception 'edition % is closed', ed.edition_key using errcode = '55000'; end if;
  insert into public.weekly_topic_lead_events (kind, edition_id, version_id, actor) values ('version_linked', p_edition, p_version, e);
  return jsonb_build_object('edition_id', p_edition, 'version_id', p_version, 'existing', false);
end $$;

-- Close an edition: its editorial decisions are final. Every assigned lead needs a disposition first. An edition may
-- close with no published video; a reason is required then. Deferred leads stay in carry-forward.
create or replace function public.hs_weekly_edition_close(p_edition uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); ed public.weekly_editions; n integer; names text; r text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into ed from public.weekly_editions where id = p_edition for update;
  if ed.id is null then raise exception 'unknown edition' using errcode = '22023'; end if;
  if ed.closed_at is not null then raise exception 'edition % is already closed', ed.edition_key using errcode = '55000'; end if;
  select count(*), string_agg(u.title, '; ') into n, names from public.weekly_edition_unresolved(p_edition) u;
  if n > 0 then
    raise exception '% lead(s) assigned to this edition have no disposition yet (included, deferred or dropped): %', n, left(names, 600) using errcode = '22023';
  end if;
  if ed.video_url is null and char_length(coalesce(r, '')) < 10 then
    raise exception 'this edition has no published video: say why it is closing (at least 10 characters)' using errcode = '22023';
  end if;
  update public.weekly_editions set closed_at = now(), closed_by = e, close_reason = r where id = p_edition;
  return public.weekly_edition_json(p_edition);
end $$;

-- Record OUR published video for an edition: its URL and its publication date, both, once. A lead's source story,
-- social post or commitment post is not our video and is refused.
create or replace function public.hs_weekly_edition_publish(p_edition uuid, p_video_url text, p_published_on date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); ed public.weekly_editions; u text := nullif(btrim(coalesce(p_video_url, '')), ''); n integer; names text;
begin
  select * into ed from public.weekly_editions where id = p_edition for update;
  if ed.id is null then raise exception 'unknown edition' using errcode = '22023'; end if;
  if ed.video_url is not null then raise exception 'edition % already records its published video', ed.edition_key using errcode = '55000'; end if;
  if u is null or p_published_on is null then
    raise exception 'publication needs both our video''s address and its publication date' using errcode = '22023';
  end if;
  if u !~ '^https://[^\s]+$' or char_length(u) > 2000 then raise exception 'the video address is an https address' using errcode = '22023'; end if;
  if p_published_on > current_date + 1 then raise exception 'the publication date is in the future' using errcode = '22023'; end if;
  if exists (select 1 from public.weekly_topic_leads l where u = any (l.source_urls) or u = l.social_post_url or u = l.commitment_post_url) then
    raise exception 'that address is a lead''s source or social post, not our published video' using errcode = '22023';
  end if;
  select count(*), string_agg(x.title, '; ') into n, names from public.weekly_edition_unresolved(p_edition) x;
  if n > 0 then
    raise exception '% lead(s) assigned to this edition have no disposition yet (included, deferred or dropped): %', n, left(names, 600) using errcode = '22023';
  end if;
  update public.weekly_editions set video_url = u, published_on = p_published_on, publication_recorded_by = e, publication_recorded_at = now()
    where id = p_edition;
  return public.weekly_edition_json(p_edition);
end $$;

-- Read model for the queue screen. p_edition picks the edition for the "assigned to this edition" view.
create or replace function public.hs_weekly_topic_queue(p_edition uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := public._hs_is_admin(); leads jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'topic', l.topic, 'location', l.location,
      'source_urls', to_jsonb(l.source_urls), 'social_post_url', l.social_post_url, 'notes', l.notes, 'why_it_matters', l.why_it_matters,
      'questions', to_jsonb(l.questions), 'intended_edition_id', l.intended_edition_id, 'intended_date', l.intended_date,
      'commitment_wording', l.commitment_wording, 'commitment_post_url', l.commitment_post_url, 'promised_publicly', l.promised_publicly,
      'created_at', l.created_at, 'updated_at', l.updated_at, 'state', s.st,
      'request', case when s.st -> 'current' ->> 'request_id' is not null then
        (select jsonb_build_object('id', q.id, 'topic', q.topic, 'request_text', q.request_text, 'created_at', q.created_at)
         from public.weekly_research_requests q where q.id = (s.st -> 'current' ->> 'request_id')::uuid) end)
      order by l.created_at, l.id), '[]'::jsonb)
    into leads from public.weekly_topic_leads l cross join lateral (select public.weekly_lead_state(l.id) as st) s;
  return jsonb_build_object(
    'note', 'Statuses are derived from what was recorded. A lead, a source story or a social post is not evidence, and none of them shows that our video was published.',
    'selected_edition', p_edition,
    'categories', (select coalesce(jsonb_agg(c.topic order by c.topic), '[]'::jsonb) from public.alert_topic_catalog c where c.stream = 'news'),
    'editions', (select coalesce(jsonb_agg(public.weekly_edition_json(ed.id) || jsonb_build_object(
        'assigned', (select count(*) from public.weekly_topic_lead_events a where a.kind = 'assigned' and a.edition_id = ed.id),
        'unresolved', (select coalesce(jsonb_agg(jsonb_build_object('lead_id', u.lead_id, 'title', u.title)), '[]'::jsonb) from public.weekly_edition_unresolved(ed.id) u),
        'linked_versions', (select coalesce(jsonb_agg(jsonb_build_object('version_id', v.version_id, 'stage', w.stage, 'linked_at', v.created_at) order by v.id), '[]'::jsonb)
                            from public.weekly_topic_lead_events v join public.weekly_scripts w on w.id = v.version_id
                            where v.kind = 'version_linked' and v.edition_id = ed.id))
        order by ed.period_start desc, ed.created_at desc), '[]'::jsonb) from public.weekly_editions ed),
    'leads', leads,
    'views', jsonb_build_object(
      'inbox', (select coalesce(jsonb_agg(x -> 'id'), '[]'::jsonb) from jsonb_array_elements(leads) x
                where not (x -> 'state' ->> 'assigned')::boolean and x -> 'state' ->> 'status' = 'captured'),
      'promised', (select coalesce(jsonb_agg(x -> 'id'), '[]'::jsonb) from jsonb_array_elements(leads) x
                   where (x ->> 'promised_publicly')::boolean and not (x -> 'state' ->> 'commitment_resolved')::boolean),
      -- every lead ever assigned to the selected edition, with its outcome there
      'edition', (select coalesce(jsonb_agg(jsonb_build_object('lead_id', x -> 'id', 'disposition', h ->> 'disposition', 'reason', h ->> 'reason',
                    'current', (h ->> 'current')::boolean)), '[]'::jsonb)
                  from jsonb_array_elements(leads) x cross join lateral jsonb_array_elements(x -> 'state' -> 'editions') h
                  where p_edition is not null and h -> 'edition' ->> 'id' = p_edition::text),
      'research', (select coalesce(jsonb_agg(x -> 'id'), '[]'::jsonb) from jsonb_array_elements(leads) x
                   where x -> 'state' ->> 'status' in ('queued_for_research', 'researching', 'ready_for_editorial_review')),
      'deferred', (select coalesce(jsonb_agg(x -> 'id'), '[]'::jsonb) from jsonb_array_elements(leads) x where x -> 'state' ->> 'status' = 'deferred'),
      'published', (select coalesce(jsonb_agg(x -> 'id'), '[]'::jsonb) from jsonb_array_elements(leads) x where x -> 'state' ->> 'status' = 'published')));
end $$;

-- ── grants ───────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['weekly_editions_guard()', 'weekly_topic_leads_guard()', 'weekly_lead_assignments(uuid)',
    'weekly_request_research_status(uuid)', 'weekly_edition_json(uuid)', 'weekly_lead_state(uuid)', 'weekly_edition_unresolved(uuid)',
    'weekly_version_edition(uuid)', 'weekly_edition_approval_gate()', '_wk_urls(jsonb,text)', '_wk_lead_assign(uuid,uuid,text)',
    'weekly_lead_request_text(uuid,uuid,text)', 'hs_weekly_lead_save(uuid,jsonb)', 'hs_weekly_edition_create(text,date,date,text,text)',
    'hs_weekly_lead_assign(uuid,uuid)', 'hs_weekly_lead_send_to_research(uuid,uuid,text)', 'hs_weekly_lead_disposition(uuid,uuid,text,text)',
    'hs_weekly_edition_link_version(uuid,uuid)', 'hs_weekly_edition_close(uuid,text)', 'hs_weekly_edition_publish(uuid,text,date)',
    'hs_weekly_topic_queue(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['hs_weekly_lead_save(uuid,jsonb)', 'hs_weekly_edition_create(text,date,date,text,text)',
    'hs_weekly_lead_assign(uuid,uuid)', 'hs_weekly_lead_send_to_research(uuid,uuid,text)', 'hs_weekly_lead_disposition(uuid,uuid,text,text)',
    'hs_weekly_edition_link_version(uuid,uuid)', 'hs_weekly_edition_close(uuid,text)', 'hs_weekly_edition_publish(uuid,text,date)',
    'hs_weekly_topic_queue(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;

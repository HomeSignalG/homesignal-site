-- IMPACT STORIES AUTO-DISCOVERY (Tab 17, "Hot Topics — Automatically Discovered"), 2026-10-27.
-- Requires docs/impact-stories.sql (applied first: it owns impact_stories, the job queue and the origin column).
--
-- Chain:
--   pg_cron impact-discovery-tick (every 10 min) or the founder's Scan Now
--     -> a row in impact_discovery_scans -> pg_net dispatch of homesignal-ingest `impact-discovery-scan.yml`
--     -> impact/discovery/scan.py reads Bluesky's API, scores, clusters, and reports through the service-role functions
--        impact_discovery_scan_claim / _record / _finish.
--   A scheduled Claude Code research session (homesignal-ingest impact/discovery/RESEARCH.md) researches the strongest
--   nominated topic, writes a verified source pack (impact/sources/<slug>, held to the same word-for-word evidence check as
--   video/projects) and a V3 draft, merges them, and calls impact_discovery_research + impact_discovery_prepare.
--   impact_discovery_prepare creates the Impact Story (origin 'auto_discovery') and queues Check Sources; the tick then runs
--   Analyze and Generate. The story is labelled "Auto-discovered — Ready for Review". Nothing further is automatic.
--
-- GUARANTEES (each pinned by test/impact_discovery_pg/):
--   * additive: new tables and functions only; impact_stories gains two columns in impact-stories.sql;
--   * every table is RLS-on with no grants; the browser reaches data only through admin-gated SECURITY DEFINER functions;
--     everything the runner and the research session call is service_role only;
--   * a Bluesky post is a discovery signal, never evidence: a topic is 'verified' only when a source pack slug is recorded,
--     and a story is created only from a verified topic. A topic with no independent source is never nominated;
--   * a failed scan stores its error and NO candidate rows; the overview reports the failure, never a zero that looks clean;
--   * at most max_prepare_per_scan stories are prepared per scan (default 1), never two for one topic or one source pack;
--   * nothing here approves a narrative, renders, or publishes. The approval, render and media gates are unchanged.
begin;

-- ── settings (one row) ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.impact_discovery_settings (
  id                    boolean primary key default true check (id),
  scan_enabled          boolean not null default true,
  scan_times            text[]  not null default array['08:00', '14:00'],          -- local times in scan_tz
  scan_tz               text    not null default 'America/Los_Angeles',
  window_hours          integer not null default 72  check (window_hours between 6 and 720),
  target_replies        integer not null default 20  check (target_replies between 0 and 100000),
  target_likes          integer not null default 50  check (target_likes between 0 and 1000000),
  target_reposts        integer not null default 10  check (target_reposts between 0 and 100000),
  nominate_score        integer not null default 80  check (nominate_score between 0 and 100),
  max_prepare_per_scan  integer not null default 1   check (max_prepare_per_scan between 0 and 5),
  experimental_enabled  boolean not null default true,   -- show the Broader Public Accountability track
  experimental_auto     boolean not null default false,  -- may that track be prepared automatically? (default: never)
  learning_enabled      boolean not null default true,
  updated_at            timestamptz not null default now(),
  updated_by            text
);
insert into public.impact_discovery_settings (id) values (true) on conflict (id) do nothing;
alter table public.impact_discovery_settings enable row level security;
revoke all on public.impact_discovery_settings from public, anon, authenticated;

-- ── terms the scanner learned (expansion) or the founder added; the seed vocabulary lives in impact/discovery/config.py ─
create table if not exists public.impact_discovery_terms (
  id          bigserial primary key,
  category    text not null check (category ~ '^[a-z_]{2,40}$'),
  term        text not null check (char_length(term) between 2 and 80),
  origin      text not null check (origin in ('expanded', 'founder')),
  active      boolean not null default true,
  hits        integer not null default 0,
  last_hit_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists impact_discovery_terms_uniq on public.impact_discovery_terms (category, lower(term));
alter table public.impact_discovery_terms enable row level security;
revoke all on public.impact_discovery_terms from public, anon, authenticated;

-- ── scans ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.impact_discovery_scans (
  id                    uuid primary key default gen_random_uuid(),
  trigger               text not null check (trigger in ('scheduled', 'manual')),
  slot_key              text unique,                 -- scheduled scans only: '<local date>|<HH:MM>', so a slot runs once
  requested_by          text not null,
  status                text not null default 'queued' check (status in ('queued', 'running', 'success', 'partial', 'failed')),
  created_at            timestamptz not null default now(),
  started_at            timestamptz,
  finished_at           timestamptz,
  dispatch_request_id   bigint,
  posts_examined        integer,
  queries_run           integer,
  api_calls             integer,
  clusters              integer,
  candidates_qualified  integer,
  candidates_nominated  integer,
  rate_limited          boolean not null default false,
  errors                jsonb not null default '[]'::jsonb,
  stats                 jsonb not null default '{}'::jsonb
);
create index if not exists impact_discovery_scans_created on public.impact_discovery_scans (created_at desc);
alter table public.impact_discovery_scans enable row level security;
revoke all on public.impact_discovery_scans from public, anon, authenticated;

-- ── candidates: one real-world event (a cluster of posts), never one post ──────────────────────────────
create table if not exists public.impact_discovery_candidates (
  id                  uuid primary key default gen_random_uuid(),
  cluster_key         text not null unique,
  category            text not null,
  track               text not null check (track in ('core', 'experimental')),
  title               text not null,
  place               text,
  subject             text,
  lead_uri            text not null,
  lead_url            text not null check (lead_url ~ '^https://bsky\.app/profile/'),
  lead_author         text,
  lead_created_at     timestamptz,
  post_uris           text[] not null default '{}',
  link_keys           text[] not null default '{}',
  related             jsonb not null default '[]'::jsonb,     -- [{uri, url, author, created_at, replies, reposts, likes}]
  metrics             jsonb not null default '{}'::jsonb,     -- observed, never estimated
  score               integer not null default 0 check (score between 0 and 100),
  score_parts         jsonb not null default '{}'::jsonb,
  reasons             jsonb not null default '[]'::jsonb,     -- why it ranked where it did (plain sentences)
  evidence_status     text not null default 'social_only'
                      check (evidence_status in ('social_only', 'leads_found', 'researching', 'verified', 'insufficient')),
  evidence            jsonb not null default '{}'::jsonb,     -- {leads:[{url,domain,kind,title}], sources:[...], missing:[...], unverified:[...]}
  concept             jsonb not null default '{}'::jsonb,     -- {fear, anger, motivation, hook, affected, opening_visual, first3s, verified}
  coverage            jsonb not null default '{}'::jsonb,     -- {state, county, place, zip_pages, communities}
  related_candidates  uuid[] not null default '{}',
  duplicate_of        uuid references public.impact_discovery_candidates(id),
  status              text not null default 'open'
                      check (status in ('open', 'nominated', 'researching', 'preparing', 'ready_for_review',
                                        'insufficient', 'rejected', 'dismissed', 'excluded', 'stale')),
  status_note         text,
  decided_by          text,
  decided_at          timestamptz,
  source_slug         text check (source_slug is null or source_slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  story_id            uuid references public.impact_stories(id),
  first_scan_id       uuid references public.impact_discovery_scans(id),
  last_scan_id        uuid references public.impact_discovery_scans(id),
  nominated_scan_id   uuid references public.impact_discovery_scans(id),
  discovered_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  last_verified_at    timestamptz,
  updated_at          timestamptz not null default now()
);
create index if not exists impact_discovery_candidates_rank on public.impact_discovery_candidates (status, score desc);
create index if not exists impact_discovery_candidates_posts on public.impact_discovery_candidates using gin (post_uris);
create index if not exists impact_discovery_candidates_links on public.impact_discovery_candidates using gin (link_keys);
create unique index if not exists impact_discovery_candidates_one_story on public.impact_discovery_candidates (story_id) where story_id is not null;
alter table public.impact_discovery_candidates enable row level security;
revoke all on public.impact_discovery_candidates from public, anon, authenticated;

-- ── observed metrics over time (append-only; velocity and "is the discussion continuing" come from here) ─
create table if not exists public.impact_discovery_post_metrics (
  id            bigserial primary key,
  candidate_id  uuid not null references public.impact_discovery_candidates(id),
  scan_id       uuid not null references public.impact_discovery_scans(id),
  post_uri      text not null,
  replies       integer not null,
  reposts       integer not null,
  likes         integer not null,
  quotes        integer not null default 0,
  observed_at   timestamptz not null default now()
);
create index if not exists impact_discovery_post_metrics_c on public.impact_discovery_post_metrics (candidate_id, observed_at);
alter table public.impact_discovery_post_metrics enable row level security;
revoke all on public.impact_discovery_post_metrics from public, anon, authenticated;

-- ── exclusions: "Exclude Similar Topics", and anything the founder never wants to see ────────────────
create table if not exists public.impact_discovery_exclusions (
  id          bigserial primary key,
  kind        text not null check (kind in ('similar', 'term', 'author', 'domain', 'category')),
  value       jsonb not null,            -- similar: {category, terms[], link_keys[]}; term/author/domain/category: {value}
  reason      text,
  active      boolean not null default true,
  created_by  text not null,
  created_at  timestamptz not null default now()
);
alter table public.impact_discovery_exclusions enable row level security;
revoke all on public.impact_discovery_exclusions from public, anon, authenticated;

create table if not exists public.impact_discovery_events (
  id            bigserial primary key,
  candidate_id  uuid references public.impact_discovery_candidates(id),
  scan_id       uuid references public.impact_discovery_scans(id),
  kind          text not null,
  detail        jsonb not null default '{}'::jsonb,
  actor         text not null,
  at            timestamptz not null default now()
);
alter table public.impact_discovery_events enable row level security;
revoke all on public.impact_discovery_events from public, anon, authenticated;
drop trigger if exists impact_discovery_events_append_only on public.impact_discovery_events;
create trigger impact_discovery_events_append_only before update or delete on public.impact_discovery_events
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_discovery_post_metrics_append_only on public.impact_discovery_post_metrics;
create trigger impact_discovery_post_metrics_append_only before update or delete on public.impact_discovery_post_metrics
  for each row execute function public._hs_is_append_only();

-- ── helpers ──────────────────────────────────────────────────────────────────────────────────────────
create or replace function public._hs_id_event(p_candidate uuid, p_scan uuid, p_kind text, p_detail jsonb, p_actor text)
returns void language sql security definer set search_path = public as $$
  insert into public.impact_discovery_events (candidate_id, scan_id, kind, detail, actor)
  values (p_candidate, p_scan, p_kind, coalesce(p_detail, '{}'::jsonb), p_actor)
$$;

-- The next scheduled scan time (timestamptz) after p_now, from the settings' local times. Null when scanning is off.
create or replace function public._hs_id_next_scan(p_now timestamptz default now())
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare st public.impact_discovery_settings%rowtype; d date; t text; best timestamptz; c timestamptz;
begin
  select * into st from public.impact_discovery_settings where id;
  if not found or not st.scan_enabled or coalesce(array_length(st.scan_times, 1), 0) = 0 then return null; end if;
  d := (p_now at time zone st.scan_tz)::date;
  for i in 0..1 loop
    foreach t in array st.scan_times loop
      c := ((d + i)::timestamp + t::time) at time zone st.scan_tz;
      if c > p_now and (best is null or c < best) then best := c; end if;
    end loop;
  end loop;
  return best;
end $$;

-- The one place a scan run is requested. A missing credential fails the scan with a readable reason; never silent.
create or replace function public._hs_id_dispatch(p_scan uuid)
returns void language plpgsql security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare _pat text; _req bigint;
begin
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then
    update public.impact_discovery_scans set status = 'failed', finished_at = now(),
      errors = errors || jsonb_build_array(jsonb_build_object('kind', 'dispatch',
        'message', 'The scan could not start because no GitHub credential is stored. Nothing was scanned.'))
     where id = p_scan;
    return;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/impact-discovery-scan.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('scan_id', p_scan::text)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-impact-discovery', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000) into _req;
  update public.impact_discovery_scans set dispatch_request_id = _req where id = p_scan;
end $$;

-- A scan that never started (GitHub refused the dispatch, or no runner claimed it within 20 minutes) is failed with the
-- reason, so the dashboard shows it instead of "running" forever.
create or replace function public._hs_id_reap()
returns void language plpgsql security definer set search_path to 'public', 'net', 'pg_temp' as $$
declare r record; code int;
begin
  for r in select * from public.impact_discovery_scans where status = 'queued' loop
    code := null;
    if r.dispatch_request_id is not null then
      select status_code into code from net._http_response where id = r.dispatch_request_id;
    end if;
    if code is not null and (code < 200 or code >= 300) then
      update public.impact_discovery_scans set status = 'failed', finished_at = now(),
        errors = errors || jsonb_build_array(jsonb_build_object('kind', 'dispatch', 'message',
          'GitHub refused to start the scan (HTTP ' || code || '). Nothing was scanned.')) where id = r.id;
    elsif r.created_at < now() - interval '20 minutes' then
      update public.impact_discovery_scans set status = 'failed', finished_at = now(),
        errors = errors || jsonb_build_array(jsonb_build_object('kind', 'dispatch', 'message',
          'No runner started the scan within 20 minutes. Nothing was scanned.')) where id = r.id;
    end if;
  end loop;
  update public.impact_discovery_scans set status = 'failed', finished_at = now(),
         errors = errors || jsonb_build_array(jsonb_build_object('kind', 'timeout', 'message', 'The scan stopped reporting for 45 minutes.'))
   where status = 'running' and started_at < now() - interval '45 minutes';
end $$;

create or replace function public._hs_id_queue_scan(p_trigger text, p_slot_key text, p_actor text)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  insert into public.impact_discovery_scans (trigger, slot_key, requested_by) values (p_trigger, p_slot_key, p_actor)
  on conflict (slot_key) do nothing returning id into sid;
  if sid is null then return null; end if;
  perform public._hs_id_event(null, sid, 'scan_queued', jsonb_build_object('trigger', p_trigger, 'slot', p_slot_key), p_actor);
  perform public._hs_id_dispatch(sid);
  return sid;
end $$;

-- Per-category result of published discovery stories, from first-party attribution only (never likes or followers).
-- A story's links carry utm_campaign = 'impact-<first 8 of its id>' (homesignal-ingest impact/variants.py).
create or replace function public._hs_id_performance()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  with st as (
    select s.id story_id, c.category, c.track, 'impact-' || left(s.id::text, 8) campaign
      from public.impact_stories s join public.impact_discovery_candidates c on c.id = s.discovery_candidate_id),
  v as (select st.story_id, count(distinct t.visitor_id) visits from st join public.acquisition_touch t
          on t.subject_type = 'visitor' and not t.is_internal and t.utm_campaign = st.campaign group by 1),
  a as (select st.story_id, t.user_id from st join public.acquisition_touch t
          on t.subject_type = 'account' and not t.is_internal and t.utm_campaign = st.campaign and t.user_id is not null),
  rp as (select a.story_id, count(*) reports, count(*) filter (where exists
           (select 1 from public.brokerage_paid_credit p where p.report_id = rs.report_id)) paid
           from a join public.report_snapshot rs on (select ra.user_id from public._report_account(rs.report_id, rs.generated_at) ra) = a.user_id
          group by 1),
  per as (
    select st.category, st.track, count(*) stories,
           count(*) filter (where coalesce(v.visits, 0) > 0) stories_with_visits,
           coalesce(sum(v.visits), 0) visits,
           (select count(*) from a where a.story_id = any(array_agg(st.story_id))) registrations,
           coalesce(sum(rp.reports), 0) reports, coalesce(sum(rp.paid), 0) paid_reports
      from st left join v on v.story_id = st.story_id left join rp on rp.story_id = st.story_id
     group by st.category, st.track)
  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'track', track, 'stories', stories,
           'stories_with_visits', stories_with_visits, 'visits', visits, 'registrations', registrations,
           'reports', reports, 'paid_reports', paid_reports,
           'youtube_retention', 'not_collected', 'shorts_stayed_to_watch', 'not_collected', 'bluesky_engagement', 'not_collected')
           order by category), '[]'::jsonb) into r from per;
  return r;
exception when undefined_table or undefined_function then
  return jsonb_build_array(jsonb_build_object('error', 'Attribution tables are not available, so performance is not measured.'));
end $$;

-- Learned score adjustment per category, in points (-5..5). Zero until a category has 3 stories with attributed visits
-- AND the whole programme has at least 50 attributed visits: a ranking is never moved by a handful of clicks.
create or replace function public._hs_id_learning()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare perf jsonb; tot_v numeric := 0; tot_r numeric := 0; out jsonb := '{}'::jsonb; e jsonb; rate numeric; base numeric;
begin
  if not coalesce((select learning_enabled from public.impact_discovery_settings where id), false) then return out; end if;
  perf := public._hs_id_performance();
  if jsonb_typeof(perf) <> 'array' or perf->0 ? 'error' then return out; end if;
  select coalesce(sum((x->>'visits')::numeric), 0), coalesce(sum((x->>'registrations')::numeric + (x->>'reports')::numeric), 0)
    into tot_v, tot_r from jsonb_array_elements(perf) x;
  if tot_v < 50 then return out; end if;
  base := tot_r / tot_v;
  for e in select * from jsonb_array_elements(perf) loop
    if (e->>'stories_with_visits')::int >= 3 and (e->>'visits')::numeric > 0 then
      rate := ((e->>'registrations')::numeric + (e->>'reports')::numeric) / (e->>'visits')::numeric;
      out := out || jsonb_build_object(e->>'category',
        greatest(-5, least(5, round(case when base = 0 then case when rate > 0 then 5 else 0 end else 5 * (rate - base) / base end))));
    end if;
  end loop;
  return out;
end $$;

-- ── founder functions (authenticated; every one checks the dashboard allowlist) ───────────────────────
create or replace function public.hs_impact_discovery_overview(p_show_closed boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st public.impact_discovery_settings%rowtype; last_ok public.impact_discovery_scans%rowtype; latest public.impact_discovery_scans%rowtype;
begin
  perform public._hs_is_admin();
  select * into st from public.impact_discovery_settings where id;
  select * into latest from public.impact_discovery_scans order by created_at desc limit 1;
  select * into last_ok from public.impact_discovery_scans where status in ('success', 'partial') order by finished_at desc limit 1;
  return jsonb_build_object(
    'settings', to_jsonb(st),
    'latest_scan', case when latest.id is null then null else to_jsonb(latest) end,
    'last_success', case when last_ok.id is null then null else to_jsonb(last_ok) end,
    'next_scan_at', public._hs_id_next_scan(now()),
    'recent_scans', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from
        (select * from public.impact_discovery_scans order by created_at desc limit 8) x), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'place', c.place, 'subject', c.subject, 'category', c.category, 'track', c.track,
        'lead_url', c.lead_url, 'lead_author', c.lead_author, 'lead_created_at', c.lead_created_at,
        'related', c.related, 'metrics', c.metrics, 'score', c.score, 'score_parts', c.score_parts, 'reasons', c.reasons,
        'evidence_status', c.evidence_status, 'evidence', c.evidence, 'concept', c.concept, 'coverage', c.coverage,
        'related_candidates', c.related_candidates, 'duplicate_of', c.duplicate_of, 'status', c.status, 'status_note', c.status_note,
        'source_slug', c.source_slug, 'story_id', c.story_id, 'discovered_at', c.discovered_at, 'last_seen_at', c.last_seen_at,
        'last_verified_at', c.last_verified_at)
        order by (c.track = 'core') desc, c.score desc, c.last_seen_at desc)
      from (select * from public.impact_discovery_candidates c
             where p_show_closed or c.status not in ('rejected', 'dismissed', 'excluded', 'stale')
             order by c.score desc limit 60) c), '[]'::jsonb),
    'exclusions', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.impact_discovery_exclusions x where x.active), '[]'::jsonb),
    'performance', public._hs_id_performance(),
    'learning', public._hs_id_learning());
end $$;

create or replace function public.hs_impact_discovery_scan_now()
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); busy public.impact_discovery_scans%rowtype; sid uuid;
begin
  perform public._hs_id_reap();
  select * into busy from public.impact_discovery_scans where status in ('queued', 'running') order by created_at desc limit 1;
  if found then
    return jsonb_build_object('scan_id', busy.id, 'status', busy.status, 'existing', true,
      'message', 'A scan is already ' || busy.status || '. Its results will appear here.');
  end if;
  if exists (select 1 from public.impact_discovery_scans where trigger = 'manual' and created_at > now() - interval '5 minutes') then
    raise exception 'A scan was started less than 5 minutes ago. Wait a moment before scanning again.' using errcode = '55000';
  end if;
  sid := public._hs_id_queue_scan('manual', null, e);
  return jsonb_build_object('scan_id', sid, 'status', (select status from public.impact_discovery_scans where id = sid), 'existing', false);
end $$;

-- reject (not a story), dismiss (not now), exclude_similar (and never show topics like it), restore (back to the list)
create or replace function public.hs_impact_discovery_decide(p_candidate uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); c public.impact_discovery_candidates%rowtype; terms jsonb;
begin
  if p_action not in ('reject', 'dismiss', 'exclude_similar', 'restore') then raise exception 'bad action' using errcode = '22023'; end if;
  select * into c from public.impact_discovery_candidates where id = p_candidate for update;
  if not found then raise exception 'no such topic' using errcode = 'P0002'; end if;
  if p_action = 'restore' then
    update public.impact_discovery_candidates set status = case when story_id is not null then 'preparing' else 'open' end,
           status_note = null, decided_by = e, decided_at = now(), updated_at = now() where id = c.id;
    update public.impact_discovery_exclusions set active = false where value->>'candidate_id' = c.id::text;
  else
    if c.status in ('preparing', 'ready_for_review') then
      raise exception 'This topic already has an Impact Story. Archive the story instead.' using errcode = '55000';
    end if;
    update public.impact_discovery_candidates set status = case p_action when 'reject' then 'rejected' when 'dismiss' then 'dismissed' else 'excluded' end,
           status_note = nullif(btrim(p_note), ''), decided_by = e, decided_at = now(), updated_at = now() where id = c.id;
    if p_action = 'exclude_similar' then
      terms := coalesce(c.score_parts->'key_terms', '[]'::jsonb);
      insert into public.impact_discovery_exclusions (kind, value, reason, created_by)
      values ('similar', jsonb_build_object('candidate_id', c.id, 'category', c.category, 'terms', terms,
              'link_keys', to_jsonb(c.link_keys), 'title', c.title), nullif(btrim(p_note), ''), e);
    end if;
  end if;
  perform public._hs_id_event(c.id, null, 'decision', jsonb_build_object('action', p_action, 'note', p_note), e);
  return jsonb_build_object('ok', true, 'status', (select status from public.impact_discovery_candidates where id = c.id));
end $$;

-- Create (or open) the Impact Story for a verified topic, by hand. The same rules as automatic preparation: only a verified
-- topic with a recorded source pack, and never a second story for one topic or one source pack.
create or replace function public.hs_impact_discovery_open_story(p_candidate uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  return public._hs_id_create_story(p_candidate, e, false);
end $$;

create or replace function public.hs_impact_discovery_settings_save(p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); t text; times text[];
begin
  if p_settings ? 'scan_times' then
    select coalesce(array_agg(x order by x), '{}') into times from jsonb_array_elements_text(p_settings->'scan_times') x;
    foreach t in array times loop
      if t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Scan times are HH:MM (24-hour): %', t using errcode = '22023'; end if;
    end loop;
    if array_length(times, 1) > 6 then raise exception 'At most 6 scans a day.' using errcode = '22023'; end if;
  end if;
  if p_settings ? 'scan_tz' and not exists (select 1 from pg_timezone_names where name = p_settings->>'scan_tz') then
    raise exception 'Unknown time zone %', p_settings->>'scan_tz' using errcode = '22023';
  end if;
  update public.impact_discovery_settings set
    scan_enabled = coalesce((p_settings->>'scan_enabled')::boolean, scan_enabled),
    scan_times = coalesce(times, scan_times),
    scan_tz = coalesce(p_settings->>'scan_tz', scan_tz),
    window_hours = coalesce((p_settings->>'window_hours')::int, window_hours),
    target_replies = coalesce((p_settings->>'target_replies')::int, target_replies),
    target_likes = coalesce((p_settings->>'target_likes')::int, target_likes),
    target_reposts = coalesce((p_settings->>'target_reposts')::int, target_reposts),
    nominate_score = coalesce((p_settings->>'nominate_score')::int, nominate_score),
    max_prepare_per_scan = coalesce((p_settings->>'max_prepare_per_scan')::int, max_prepare_per_scan),
    experimental_enabled = coalesce((p_settings->>'experimental_enabled')::boolean, experimental_enabled),
    experimental_auto = coalesce((p_settings->>'experimental_auto')::boolean, experimental_auto),
    learning_enabled = coalesce((p_settings->>'learning_enabled')::boolean, learning_enabled),
    updated_at = now(), updated_by = e
  where id;
  perform public._hs_id_event(null, null, 'settings_saved', p_settings, e);
  return to_jsonb((select s from public.impact_discovery_settings s where id));
end $$;

-- ── shared: create the story for a verified topic ───────────────────────────────────────────────────────
create or replace function public._hs_id_create_story(p_candidate uuid, p_actor text, p_auto boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.impact_discovery_candidates%rowtype; s public.impact_stories%rowtype; st public.impact_discovery_settings%rowtype;
        n int; job jsonb; other uuid;
begin
  select * into c from public.impact_discovery_candidates where id = p_candidate for update;
  if not found then raise exception 'no such topic' using errcode = 'P0002'; end if;
  if c.story_id is not null then
    return jsonb_build_object('story_id', c.story_id, 'existing', true);
  end if;
  if c.evidence_status <> 'verified' or c.source_slug is null then
    raise exception 'This topic has no verified source pack yet, so no story can be written from it. %',
      coalesce('Missing: ' || (select string_agg(x, '; ') from jsonb_array_elements_text(c.evidence->'missing') x), '') using errcode = '55000';
  end if;
  if c.status in ('rejected', 'dismissed', 'excluded') then
    raise exception 'This topic was %. Restore it first.', c.status using errcode = '55000';
  end if;
  select * into s from public.impact_stories where (video_slug = c.source_slug or discovery_candidate_id = c.id) and archived_at is null limit 1;
  if found then   -- the story already exists in the library: never create a second
    select id into other from public.impact_discovery_candidates where story_id = s.id and id <> c.id;
    if other is not null then   -- another topic already owns it: this one is the same event
      update public.impact_discovery_candidates set duplicate_of = other, status_note = 'Same source pack as another topic.',
             updated_at = now() where id = c.id;
      perform public._hs_id_event(c.id, null, 'duplicate_of', jsonb_build_object('candidate_id', other, 'story_id', s.id), p_actor);
      return jsonb_build_object('story_id', s.id, 'existing', true, 'duplicate_of', other);
    end if;
    -- an existing story is the founder's: link it, never drive its jobs
    update public.impact_discovery_candidates set story_id = s.id, status = 'ready_for_review',
           status_note = 'This story is already in the library.', updated_at = now() where id = c.id;
    update public.impact_stories set discovery_candidate_id = coalesce(discovery_candidate_id, c.id) where id = s.id;
    return jsonb_build_object('story_id', s.id, 'existing', true);
  end if;
  if p_auto then
    select * into st from public.impact_discovery_settings where id;
    if c.track = 'experimental' and not st.experimental_auto then
      raise exception 'Broader public accountability topics are not prepared automatically.' using errcode = '55000';
    end if;
    select count(*) into n from public.impact_discovery_candidates x
     where x.nominated_scan_id is not distinct from c.nominated_scan_id and x.story_id is not null and x.id <> c.id
       and exists (select 1 from public.impact_stories y where y.id = x.story_id and y.origin = 'auto_discovery');
    if n >= st.max_prepare_per_scan then
      raise exception 'This scan already prepared % stor%(limit %).', n, case when n = 1 then 'y ' else 'ies ' end, st.max_prepare_per_scan using errcode = '55000';
    end if;
  end if;
  insert into public.impact_stories (video_slug, title, place, created_by, origin, discovery_candidate_id)
  values (c.source_slug, left(c.title, 200), c.place, p_actor, 'auto_discovery', c.id) returning * into s;
  perform public._hs_is_event(s.id, 'created', jsonb_build_object('video_slug', c.source_slug, 'discovery_candidate_id', c.id,
          'bluesky', c.lead_url, 'auto', p_auto), p_actor);
  update public.impact_discovery_candidates set story_id = s.id, status = 'preparing', updated_at = now() where id = c.id;
  perform public._hs_id_event(c.id, null, 'story_created', jsonb_build_object('story_id', s.id, 'auto', p_auto), p_actor);
  job := public._hs_is_request(s.id, 'pack', 'all', false, p_actor);
  return jsonb_build_object('story_id', s.id, 'existing', false, 'job', job);
end $$;

-- ── service-role functions (the scan runner and the research session) ────────────────────────────────
create or replace function public.impact_discovery_scan_claim(p_scan uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sc public.impact_discovery_scans%rowtype; st public.impact_discovery_settings%rowtype;
begin
  select * into sc from public.impact_discovery_scans where id = p_scan for update;
  if not found or sc.status not in ('queued') then
    return jsonb_build_object('claimed', false, 'status', coalesce(sc.status, 'missing'));
  end if;
  update public.impact_discovery_scans set status = 'running', started_at = now() where id = p_scan;
  select * into st from public.impact_discovery_settings where id;
  return jsonb_build_object('claimed', true, 'scan_id', p_scan, 'settings', to_jsonb(st),
    'terms', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'term', term, 'origin', origin)) from public.impact_discovery_terms where active), '[]'::jsonb),
    'exclusions', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'value', value)) from public.impact_discovery_exclusions where active), '[]'::jsonb),
    'open', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'cluster_key', cluster_key, 'category', category, 'title', title, 'place', place,
              'lead_uri', lead_uri, 'post_uris', post_uris, 'link_keys', link_keys, 'status', status, 'key_terms', score_parts->'key_terms',
              'last_seen_at', last_seen_at))
              from public.impact_discovery_candidates where last_seen_at > now() - interval '14 days'), '[]'::jsonb),
    'learning', public._hs_id_learning());
end $$;

-- Place coverage for scoring: which ZIP pages a (state, county, city) mention resolves to.
create or replace function public.impact_discovery_coverage(p_places jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb := '[]'::jsonb; p jsonb; st text; co text; ci text; n int; cn int;
begin
  for p in select * from jsonb_array_elements(coalesce(p_places, '[]'::jsonb)) loop
    st := upper(nullif(btrim(p->>'state'), '')); co := nullif(btrim(p->>'county'), ''); ci := nullif(btrim(p->>'city'), '');
    n := 0; cn := 0;
    if st is not null then
      select count(*) into cn from public.communities where level = 'zip' and upper(state) = st;
      select count(*) into n from public.communities z
       where z.level = 'zip' and upper(z.state) = st
         and ((co is not null and lower(regexp_replace(z.county, '\s+(county|parish|borough|census area)$', '', 'i'))
                                  = lower(regexp_replace(co, '\s+(county|parish|borough|census area)$', '', 'i')))
           or (ci is not null and z.name ilike ci || ' (%'));
    end if;
    out := out || jsonb_build_array(jsonb_build_object('state', st, 'county', co, 'city', ci, 'zip_pages', n, 'state_zip_pages', cn));
  end loop;
  return out;
end $$;

-- Record one scan's candidates. A candidate that matches an existing one (same cluster key, a shared post, or a shared
-- link) updates it; a founder decision (rejected/dismissed/excluded) or a story is never undone by a scan.
create or replace function public.impact_discovery_scan_record(p_scan uuid, p_candidates jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sc public.impact_discovery_scans%rowtype; st public.impact_discovery_settings%rowtype; x jsonb; c public.impact_discovery_candidates%rowtype;
        uris text[]; links text[]; nominate boolean; take boolean; ins int := 0; upd int := 0; nom int := 0; m jsonb; ev text;
begin
  select * into sc from public.impact_discovery_scans where id = p_scan;
  if not found or sc.status <> 'running' then raise exception 'scan is not running' using errcode = '55000'; end if;
  select * into st from public.impact_discovery_settings where id;
  for x in select * from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) loop
    if coalesce(x->>'lead_url', '') !~ '^https://bsky\.app/profile/' then raise exception 'candidate without a Bluesky link' using errcode = '22023'; end if;
    select coalesce(array_agg(v), '{}') into uris from jsonb_array_elements_text(coalesce(x->'post_uris', '[]')) v;
    select coalesce(array_agg(v), '{}') into links from jsonb_array_elements_text(coalesce(x->'link_keys', '[]')) v;
    ev := case when x->>'evidence_status' in ('social_only', 'leads_found') then x->>'evidence_status' else 'social_only' end;
    -- never nominated without an independent source; experimental topics only when allowed to be prepared
    nominate := (x->>'score')::int >= st.nominate_score and ev = 'leads_found' and coalesce((x->>'timely')::boolean, false)
                and (x->>'track' = 'core' or st.experimental_auto);
    select * into c from public.impact_discovery_candidates
     where cluster_key = x->>'cluster_key' or post_uris && uris or (cardinality(links) > 0 and link_keys && links)
     order by (cluster_key = x->>'cluster_key') desc, discovered_at limit 1 for update;
    if not found then
      insert into public.impact_discovery_candidates (cluster_key, category, track, title, place, subject, lead_uri, lead_url, lead_author,
        lead_created_at, post_uris, link_keys, related, metrics, score, score_parts, reasons, evidence_status, evidence, concept, coverage,
        related_candidates, status, first_scan_id, last_scan_id, nominated_scan_id, last_seen_at)
      values (x->>'cluster_key', x->>'category', x->>'track', left(x->>'title', 300), x->>'place', x->>'subject', x->>'lead_uri', x->>'lead_url',
        x->>'lead_author', (x->>'lead_created_at')::timestamptz, uris, links, coalesce(x->'related', '[]'), coalesce(x->'metrics', '{}'),
        (x->>'score')::int, coalesce(x->'score_parts', '{}'), coalesce(x->'reasons', '[]'), ev, coalesce(x->'evidence', '{}'),
        coalesce(x->'concept', '{}'), coalesce(x->'coverage', '{}'),
        coalesce((select array_agg(v::uuid) from jsonb_array_elements_text(coalesce(x->'related_candidates', '[]')) v), '{}'),
        case when nominate then 'nominated' when coalesce((x->>'timely')::boolean, false) then 'open' else 'stale' end,
        p_scan, p_scan, case when nominate then p_scan end, now())
      returning * into c;
      ins := ins + 1;
      perform public._hs_id_event(c.id, p_scan, 'discovered', jsonb_build_object('score', c.score, 'status', c.status), 'scanner');
    else
      -- a different cluster that shares a post or link is the same event: its posts join this topic, and its evaluation
      -- replaces this one's only if it scored higher (a weaker duplicate never demotes a nominated topic)
      take := c.cluster_key = x->>'cluster_key' or (x->>'score')::int > c.score;
      if not take then
        nominate := c.status = 'nominated';
        update public.impact_discovery_candidates set
          post_uris = (select array(select distinct u from unnest(c.post_uris || uris) u)),
          link_keys = (select array(select distinct u from unnest(c.link_keys || links) u)),
          related = c.related || coalesce(x->'related', '[]'), last_scan_id = p_scan, last_seen_at = now(), updated_at = now()
        where id = c.id returning * into c;
      else
      update public.impact_discovery_candidates set
        category = x->>'category', track = x->>'track', title = left(x->>'title', 300), place = coalesce(x->>'place', place),
        subject = coalesce(x->>'subject', subject),
        lead_uri = x->>'lead_uri', lead_url = x->>'lead_url', lead_author = x->>'lead_author', lead_created_at = (x->>'lead_created_at')::timestamptz,
        post_uris = (select array(select distinct u from unnest(c.post_uris || uris) u)),
        link_keys = (select array(select distinct u from unnest(c.link_keys || links) u)),
        related = coalesce(x->'related', related), metrics = coalesce(x->'metrics', metrics),
        score = (x->>'score')::int, score_parts = coalesce(x->'score_parts', score_parts), reasons = coalesce(x->'reasons', reasons),
        -- research outcomes are never downgraded by a scan
        evidence_status = case when evidence_status in ('researching', 'verified', 'insufficient') then evidence_status else ev end,
        evidence = case when evidence_status in ('researching', 'verified', 'insufficient') then evidence || jsonb_build_object('leads', x->'evidence'->'leads')
                        else coalesce(x->'evidence', evidence) end,
        concept = case when coalesce((concept->>'verified')::boolean, false) then concept else coalesce(x->'concept', concept) end,
        coverage = coalesce(x->'coverage', coverage),
        related_candidates = coalesce((select array_agg(v::uuid) from jsonb_array_elements_text(coalesce(x->'related_candidates', '[]')) v), related_candidates),
        status = case
                   when status in ('rejected', 'dismissed', 'excluded', 'researching', 'preparing', 'ready_for_review', 'insufficient') then status
                   when status = 'nominated' and not coalesce((x->>'timely')::boolean, false) then 'stale'
                   when nominate then 'nominated'
                   when status = 'nominated' then 'open'
                   when coalesce((x->>'timely')::boolean, false) then 'open' else 'stale' end,
        nominated_scan_id = case when nominate and status in ('open', 'stale') then p_scan else nominated_scan_id end,
        last_scan_id = p_scan, last_seen_at = now(), updated_at = now()
      where id = c.id returning * into c;
      end if;
      upd := upd + 1;
    end if;
    if c.status = 'nominated' then nom := nom + 1; end if;
    for m in select * from jsonb_array_elements(coalesce(x->'related', '[]')) loop
      insert into public.impact_discovery_post_metrics (candidate_id, scan_id, post_uri, replies, reposts, likes, quotes)
      values (c.id, p_scan, m->>'uri', coalesce((m->>'replies')::int, 0), coalesce((m->>'reposts')::int, 0),
              coalesce((m->>'likes')::int, 0), coalesce((m->>'quotes')::int, 0));
    end loop;
  end loop;
  return jsonb_build_object('inserted', ins, 'updated', upd, 'nominated', nom);
end $$;

create or replace function public.impact_discovery_scan_finish(p_scan uuid, p_status text, p_stats jsonb, p_errors jsonb, p_terms jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t jsonb; n int;
begin
  if p_status not in ('success', 'partial', 'failed') then raise exception 'bad status' using errcode = '22023'; end if;
  update public.impact_discovery_scans set status = p_status, finished_at = now(),
    posts_examined = (p_stats->>'posts_examined')::int, queries_run = (p_stats->>'queries_run')::int,
    api_calls = (p_stats->>'api_calls')::int, clusters = (p_stats->>'clusters')::int,
    candidates_qualified = (p_stats->>'candidates_qualified')::int,
    candidates_nominated = (select count(*) from public.impact_discovery_candidates where nominated_scan_id = p_scan),
    rate_limited = coalesce((p_stats->>'rate_limited')::boolean, false),
    errors = errors || coalesce(p_errors, '[]'::jsonb), stats = coalesce(p_stats, '{}'::jsonb)
  where id = p_scan and status = 'running';
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'reason', 'scan is not running'); end if;
  for t in select * from jsonb_array_elements(coalesce(p_terms, '[]'::jsonb)) loop
    insert into public.impact_discovery_terms (category, term, origin, hits, last_hit_at)
    values (t->>'category', left(t->>'term', 80), 'expanded', coalesce((t->>'hits')::int, 1), now())
    on conflict (category, lower(term)) do update set hits = public.impact_discovery_terms.hits + excluded.hits, last_hit_at = now();
  end loop;
  perform public._hs_id_event(null, p_scan, 'scan_' || p_status, coalesce(p_stats, '{}'::jsonb) || jsonb_build_object('errors', p_errors), 'scanner');
  return jsonb_build_object('ok', true);
end $$;

-- The research session reports what it found. 'verified' needs the slug of a merged source pack (impact/sources/<slug>);
-- 'insufficient' needs the list of what is missing. A verified concept replaces the scanner's provisional one.
create or replace function public.impact_discovery_research(p_candidate uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.impact_discovery_candidates%rowtype; outcome text := p_payload->>'outcome';
begin
  if outcome not in ('researching', 'verified', 'insufficient') then raise exception 'bad outcome' using errcode = '22023'; end if;
  select * into c from public.impact_discovery_candidates where id = p_candidate for update;
  if not found then raise exception 'no such topic' using errcode = 'P0002'; end if;
  if c.status in ('rejected', 'dismissed', 'excluded') then raise exception 'the founder closed this topic (%)', c.status using errcode = '55000'; end if;
  if outcome = 'verified' and coalesce(p_payload->>'source_slug', '') !~ '^[a-z0-9][a-z0-9-]{0,80}$' then
    raise exception 'verified needs the source pack slug' using errcode = '22023';
  end if;
  if outcome = 'insufficient' and jsonb_array_length(coalesce(p_payload->'evidence'->'missing', '[]')) = 0 then
    raise exception 'insufficient needs the list of missing evidence' using errcode = '22023';
  end if;
  update public.impact_discovery_candidates set
    evidence_status = outcome,
    evidence = c.evidence || coalesce(p_payload->'evidence', '{}'::jsonb),
    concept = case when p_payload ? 'concept' then p_payload->'concept' || jsonb_build_object('verified', outcome = 'verified') else concept end,
    title = coalesce(left(p_payload->>'title', 300), title), place = coalesce(p_payload->>'place', place),
    source_slug = case when outcome = 'verified' then p_payload->>'source_slug' else source_slug end,
    status = case when status in ('preparing', 'ready_for_review') then status
                  when outcome = 'researching' then 'researching' when outcome = 'insufficient' then 'insufficient' else status end,
    status_note = coalesce(p_payload->>'note', status_note),
    last_verified_at = case when outcome <> 'researching' then now() else last_verified_at end, updated_at = now()
  where id = c.id;
  perform public._hs_id_event(c.id, null, 'research_' || outcome, p_payload - 'concept', 'research');
  return jsonb_build_object('ok', true, 'status', (select status from public.impact_discovery_candidates where id = c.id));
end $$;

create or replace function public.impact_discovery_prepare(p_candidate uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public._hs_id_create_story(p_candidate, 'auto-discovery', true);
end $$;

-- Every 10 minutes (pg_cron): start a scheduled scan that is due, fail scans that never started, and walk each automatically
-- prepared story through Check Sources -> Analyze -> Generate. It never approves, renders or publishes.
create or replace function public.impact_discovery_tick(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare st public.impact_discovery_settings%rowtype; t text; local_d date; due timestamptz; started int := 0; adv int := 0;
        s record; v public.impact_story_versions%rowtype; lj public.impact_story_jobs%rowtype;
begin
  perform public._hs_id_reap();
  select * into st from public.impact_discovery_settings where id;
  if st.scan_enabled then
    local_d := (p_now at time zone st.scan_tz)::date;
    foreach t in array st.scan_times loop
      due := (local_d::timestamp + t::time) at time zone st.scan_tz;
      -- a slot is started at most once, and only within 3 hours of its time (a long outage never fires a burst)
      if p_now >= due and p_now < due + interval '3 hours' then
        if public._hs_id_queue_scan('scheduled', local_d::text || '|' || t, 'schedule') is not null then started := started + 1; end if;
      end if;
    end loop;
  end if;
  for s in select x.*, c.id cid from public.impact_stories x join public.impact_discovery_candidates c on c.story_id = x.id
            where x.origin = 'auto_discovery' and x.archived_at is null and c.status = 'preparing' loop
    if exists (select 1 from public.impact_story_jobs where story_id = s.id and status in ('queued', 'running')) then continue; end if;
    select * into lj from public.impact_story_jobs where story_id = s.id order by created_at desc limit 1;
    if lj.status = 'failed' then continue; end if;          -- shown on the story; a person decides about a failure
    select * into v from public.impact_story_versions where story_id = s.id and version = s.current_version;
    if s.pack is null then continue; end if;
    begin
      if s.current_version = 0 then
        perform public._hs_is_request(s.id, 'analyze', 'all', false, 'auto-discovery'); adv := adv + 1;
      elsif v.body->'main' is null and v.body->'arc' is not null and v.body->'outline' is not null then
        perform public._hs_is_request(s.id, 'generate', 'all', false, 'auto-discovery'); adv := adv + 1;
      end if;
    exception when others then   -- the same gate the founder's button meets refused it: say why, once, and stop advancing
      if (select status_note from public.impact_discovery_candidates where id = s.cid) is distinct from sqlerrm then
        update public.impact_discovery_candidates set status_note = sqlerrm, updated_at = now() where id = s.cid;
        perform public._hs_id_event(s.cid, null, 'auto_advance_blocked', jsonb_build_object('story_id', s.id, 'reason', sqlerrm), 'auto-discovery');
      end if;
      continue;
    end;
    if v.body->'main' is not null then
      update public.impact_discovery_candidates set status = 'ready_for_review', updated_at = now() where id = s.cid;
      perform public._hs_id_event(s.cid, null, 'ready_for_review', jsonb_build_object('story_id', s.id, 'version', s.current_version), 'auto-discovery');
      perform public._hs_is_event(s.id, 'auto_discovery_ready', jsonb_build_object('version', s.current_version), 'auto-discovery');
    end if;
  end loop;
  return jsonb_build_object('scans_started', started, 'stories_advanced', adv);
end $$;

-- ── grants ───────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._hs_id_event(uuid, uuid, text, jsonb, text)', 'public._hs_id_next_scan(timestamptz)', 'public._hs_id_dispatch(uuid)',
    'public._hs_id_reap()', 'public._hs_id_queue_scan(text, text, text)', 'public._hs_id_performance()', 'public._hs_id_learning()',
    'public._hs_id_create_story(uuid, text, boolean)', 'public.impact_discovery_tick(timestamptz)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array[
    'public.hs_impact_discovery_overview(boolean)', 'public.hs_impact_discovery_scan_now()',
    'public.hs_impact_discovery_decide(uuid, text, text)', 'public.hs_impact_discovery_open_story(uuid)',
    'public.hs_impact_discovery_settings_save(jsonb)'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  foreach f in array array['public.impact_discovery_scan_claim(uuid)', 'public.impact_discovery_coverage(jsonb)',
    'public.impact_discovery_scan_record(uuid, jsonb)', 'public.impact_discovery_scan_finish(uuid, text, jsonb, jsonb, jsonb)',
    'public.impact_discovery_research(uuid, jsonb)', 'public.impact_discovery_prepare(uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;

-- ── schedule (only where pg_cron exists; the disposable test database has none) ──────────────────────
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'impact-discovery-tick';
    perform cron.schedule('impact-discovery-tick', '*/10 * * * *', 'select public.impact_discovery_tick()');
  end if;
end $$;

commit;

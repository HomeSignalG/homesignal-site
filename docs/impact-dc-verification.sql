-- TAB 17 · DATA-CENTER PROJECT CHECK (2026-11-12, stages 2 and 3). PROPOSED · NOT APPLIED TO PRODUCTION.
--
-- For every Hot Topics candidate in category data_centers, a verification job works out which project the topic is
-- about, where Map 1 draws it, its status, its documents and whether its Map 1 link works, and keeps the result.
-- The worker is scripts/impact-dc-verify.mjs (homesignal-site, .github/workflows/impact-dc-verify.yml). This file is
-- the queue, the result store and every trigger that makes a result out of date.
--
-- WHAT MAKES A RESULT OUT OF DATE (each one is wired here, and each is tested in test/impact_dc_verification_pg):
--   1. The topic changes: trigger impact_dc_verification_topic_trg on impact_discovery_candidates (title, place, subject,
--      post_uris, link_keys, evidence, coverage, category, status). A data-center topic is queued; a change to anything
--      the check reads invalidates its result.
--   2. A document decision: trigger impact_dc_verification_document_trg on map1_project_document_decision. Every result
--      for that project is invalidated and re-queued.
--   3. The project's status, location, name or source changes, or it is merged into another entity: there is no cheap
--      event for this (the data-center resolvers rewrite thousands of rows an hour and are another workstream's tables),
--      so impact_dc_verification_detect_changes(limit) re-reads the project's facts through public.impact_dc_project_facts
--      (Map 1's own readers) and compares them with the fingerprint stored at the last success. A merge shows up as a new
--      map key for the same project key. It runs when called; NO SCHEDULE IS CREATED HERE (see the end of this file).
--   4. Age: a result older than 48 hours is stale (impact_dc_verification_max_age), whatever else happened.
--
-- STALE-RESULT POLICY (impact_dc_verification_view):
--   A result is CURRENT only when it exists, nothing invalidated it after the run that produced it started, it is at most
--   48 hours old, and no attempt has failed since. Otherwise it is STALE, with the reasons listed. The project link counts
--   as available and the reply as ready ONLY on a current result. A stale result is still returned, labelled stale, with
--   the time of the last successful check.
--
-- RETRIES: a failed or expired attempt is retried after 5 minutes, then 30 minutes; after 3 failed attempts the job
--   stops (status gave_up) until the next trigger or a manual Recheck. One job per candidate (primary key), at most one
--   claimed run at a time (status running + lease); a trigger while running sets rerun_requested, and the job is queued
--   again when that run ends.
--
-- Nothing here changes a project, approves a document or posts anything. Depends on docs/impact-discovery.sql,
-- docs/map1-project-link.sql, docs/map1-dc-publication.sql and docs/n5-generation-publish.sql (geo.n5_serving_membership).

create table if not exists public.impact_dc_verification (
  candidate_id         uuid primary key references public.impact_discovery_candidates(id),
  status               text not null default 'queued' check (status in ('queued','running','done','gave_up','retired')),
  attempts             integer not null default 0,
  next_attempt_at      timestamptz not null default now(),
  lease_expires_at     timestamptz,
  current_run          uuid,
  rerun_requested      boolean not null default false,
  queued_reason        text,
  topic_fingerprint    text,
  invalidated_at       timestamptz,
  invalidated_reason   text,
  last_success_at      timestamptz,
  last_success_run_started_at timestamptz,
  result               jsonb,
  result_project_key   text,
  result_zip           text,
  result_facts         jsonb,
  last_attempt_at      timestamptz,
  last_error           text,
  updated_at           timestamptz not null default now()
);
create index if not exists impact_dc_verification_due_idx on public.impact_dc_verification (status, next_attempt_at);
create index if not exists impact_dc_verification_project_idx on public.impact_dc_verification (result_project_key);

create table if not exists public.impact_dc_verification_runs (
  run_id        uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references public.impact_dc_verification(candidate_id),
  reason        text,
  worker        text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  outcome       text not null default 'running' check (outcome in ('running','succeeded','failed','expired')),
  error         text,
  result        jsonb
);
create index if not exists impact_dc_verification_runs_cand_idx on public.impact_dc_verification_runs (candidate_id, started_at desc);

alter table public.impact_dc_verification      enable row level security;
alter table public.impact_dc_verification_runs enable row level security;
revoke all on public.impact_dc_verification, public.impact_dc_verification_runs from anon, authenticated;

create or replace function public.impact_dc_verification_max_age() returns interval language sql immutable as $$ select interval '48 hours' $$;
create or replace function public.impact_dc_verification_backoff(p_attempts integer) returns interval language sql immutable as $$
  select case when p_attempts <= 1 then interval '5 minutes' else interval '30 minutes' end $$;

-- The candidate fields the check reads. A change to any of them is a change to the question.
create or replace function public.impact_dc_topic_fingerprint(c public.impact_discovery_candidates)
returns text language sql immutable as $$
  select md5(concat_ws(chr(31), c.category, c.title, c.place, c.subject, array_to_string(c.post_uris, chr(30)),
                       array_to_string(c.link_keys, chr(30)), c.evidence::text, c.coverage::text))
$$;

-- Queue (or re-queue) one candidate. Never two jobs: a running job is marked rerun_requested instead.
create or replace function public._hs_dcv_enqueue(p_candidate uuid, p_reason text, p_reset boolean default false)
returns text language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare v public.impact_dc_verification%rowtype;
begin
  insert into public.impact_dc_verification (candidate_id, status, queued_reason, next_attempt_at)
  values (p_candidate, 'queued', p_reason, now())
  on conflict (candidate_id) do nothing;
  select * into v from public.impact_dc_verification where candidate_id = p_candidate for update;
  if v.status = 'running' then
    update public.impact_dc_verification set rerun_requested = true, queued_reason = p_reason, updated_at = now()
     where candidate_id = p_candidate;
    return 'running';
  end if;
  update public.impact_dc_verification
     set status = 'queued', queued_reason = p_reason,
         next_attempt_at = case when status = 'queued' then least(next_attempt_at, now()) else now() end,
         attempts = case when p_reset or status <> 'queued' then 0 else attempts end,
         updated_at = now()
   where candidate_id = p_candidate;
  return 'queued';
end $fn$;

create or replace function public._hs_dcv_invalidate(p_candidate uuid, p_reason text)
returns void language sql security definer set search_path to 'public', 'pg_temp' as $fn$
  update public.impact_dc_verification set invalidated_at = now(), invalidated_reason = p_reason, updated_at = now()
   where candidate_id = p_candidate;
$fn$;

-- The ZIP pages of a topic's places. The SAME place rule as public.impact_discovery_coverage (state, then county with the
-- county/parish/borough/census-area suffix ignored, or a ZIP page named "<city> (ZIP)"); the pg suite checks the two agree.
create or replace function public.impact_dc_topic_zips(p_places jsonb)
returns text[] language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select coalesce(array_agg(distinct zc order by zc), '{}')
    from jsonb_array_elements(case when jsonb_typeof(p_places) = 'array' then p_places else '[]'::jsonb end) p
    cross join lateral (select upper(nullif(btrim(p->>'state'), '')) st, nullif(btrim(p->>'county'), '') co,
                               nullif(btrim(p->>'city'), '') ci) q
    join public.communities z on z.level = 'zip' and upper(z.state) = q.st
     and ((q.co is not null and lower(regexp_replace(z.county, '\s+(county|parish|borough|census area)$', '', 'i'))
                              = lower(regexp_replace(q.co, '\s+(county|parish|borough|census area)$', '', 'i')))
       or (q.ci is not null and z.name ilike q.ci || ' (%'))
    cross join lateral unnest(z.zip_codes) zc
   where zc ~ '^[0-9]{5}$'
$fn$;
revoke all on function public.impact_dc_topic_zips(jsonb) from public;
grant execute on function public.impact_dc_topic_zips(jsonb) to service_role;

-- The topic's places. Hot Topics' coverage places when it computed them; otherwise the place text when it reads
-- "<county or city>, <two-letter state>" (2026-11-13: two topics carried no coverage places, e.g. "Box Elder County, UT").
create or replace function public.impact_dc_topic_places(p_coverage jsonb, p_place text)
returns jsonb language sql immutable set search_path to 'public', 'pg_temp' as $fn$
  select case
    when jsonb_typeof(p_coverage->'places') = 'array' and jsonb_array_length(p_coverage->'places') > 0 then p_coverage->'places'
    when p_place ~ '^\s*[^,]+,\s*[A-Za-z]{2}\s*$' then
      jsonb_build_array(jsonb_build_object(
        'state', upper(btrim(split_part(p_place, ',', 2))),
        'county', case when btrim(split_part(p_place, ',', 1)) ~* '\s(county|parish|borough|census area)$'
                       then btrim(split_part(p_place, ',', 1)) end,
        'city', case when btrim(split_part(p_place, ',', 1)) !~* '\s(county|parish|borough|census area)$'
                     then btrim(split_part(p_place, ',', 1)) end))
    else '[]'::jsonb end
$fn$;
revoke all on function public.impact_dc_topic_places(jsonb, text) from public;
grant execute on function public.impact_dc_topic_places(jsonb, text) to service_role;

-- The two-letter states of a topic's places.
create or replace function public.impact_dc_topic_states(p_places jsonb)
returns text[] language sql immutable set search_path to 'public', 'pg_temp' as $fn$
  select coalesce(array_agg(distinct st order by st), '{}')
    from jsonb_array_elements(case when jsonb_typeof(p_places) = 'array' then p_places else '[]'::jsonb end) p
    cross join lateral (select upper(nullif(btrim(p->>'state'), '')) st) q
   where st ~ '^[A-Z]{2}$'
$fn$;
revoke all on function public.impact_dc_topic_states(jsonb) from public;
grant execute on function public.impact_dc_topic_states(jsonb) to service_role;

-- STATEWIDE NAME POINTS (2026-11-13). Most topics name only a state ("Minnesota"), whose ZIP pages are far too many to
-- read one by one, so the county rule above finds nothing. This lists every data-center point in those states that
-- Map 1 could draw, with its NAMES and the ZIP page it falls in, so the worker can pick the few ZIPs whose project the
-- topic names. It is only a way to choose ZIPs: the worker still reads map1_dc_zip_members for them, and only a project
-- that reader returns, matched by NAME, can be linked. Names: every current observation of a canonical entity (an
-- entity can carry several), and the compatibility layer's own name.
create or replace function public.impact_dc_state_name_points(p_states text[])
returns table(zip text, project_name text, developer_or_operator text)
language plpgsql stable security definer set search_path to 'public', 'geo', 'pg_temp' set jit to 'off' as $fn$
begin
  return query
  with st as (select distinct upper(s) s from unnest(coalesce(p_states, '{}')) s where upper(s) ~ '^[A-Z]{2}$'),
  pages as (select distinct zc
              from public.communities z cross join lateral unnest(z.zip_codes) zc
             where z.level = 'zip' and upper(z.state) in (select s from st) and zc ~ '^[0-9]{5}$'),
  -- each point's ZCTA through the boundary index, then kept only when that ZCTA is one of the states' ZIP pages;
  -- placed first, named second, so only entities in those pages are joined to their names
  ents as materialized (
    select z.zc, ge.canonical_entity_id
      from public.dc_entity_geography ge
      join public.dc_canonical_entity e on e.canonical_entity_id = ge.canonical_entity_id
       and e.superseded_by is null and e.classification = 'CONFIRMED_DC'
      cross join lateral (select b.zcta5::text zc from geo.zcta_boundary b
                           where b.geom && ST_SetSRID(ST_MakePoint(ge.lng, ge.lat), 4269)
                             and ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(ge.lng, ge.lat), 4269)) limit 1) z
     where ge.geography_status = 'RESOLVED' and ge.geometry_type = 'POINT' and z.zc in (select zc from pages)),
  canon as (
    select n.zc, o.source_native_name as name, nullif(btrim(o.source_native_operator), '') as op
      from ents n
      join public.dc_entity_observation eo on eo.canonical_entity_id = n.canonical_entity_id
      join public.dc_current_observation cx on cx.home_signal_observation_id = eo.home_signal_observation_id
      join public.dc_source_observation o on o.home_signal_observation_id = eo.home_signal_observation_id),
  compat as materialized (
    select z.zc, r.project_name as name, nullif(btrim(r.developer_or_operator), '') as op
      from public.national_dc_records r
      cross join lateral (select b.zcta5::text zc from geo.zcta_boundary b
                           where b.geom && ST_SetSRID(ST_MakePoint(r.lng, r.lat), 4269)
                             and ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(r.lng, r.lat), 4269)) limit 1) z
     where r.map_eligible and z.zc in (select zc from pages))
  select distinct u.zc, u.name, u.op from (select * from canon union all select * from compat) u where u.name is not null;
end $fn$;
revoke all on function public.impact_dc_state_name_points(text[]) from public;
grant execute on function public.impact_dc_state_name_points(text[]) to service_role;

-- 1. TOPIC CHANGES
create or replace function public.impact_dc_verification_topic_change()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare fp text := public.impact_dc_topic_fingerprint(new); old_fp text;
begin
  if new.category <> 'data_centers' or new.status in ('rejected','dismissed','excluded') or new.duplicate_of is not null then
    -- no longer a data-center topic to check: its job stops (the last result stays, for the record)
    update public.impact_dc_verification set status = 'retired', rerun_requested = false, updated_at = now()
     where candidate_id = new.id and status in ('queued', 'gave_up', 'done');
    update public.impact_dc_verification set rerun_requested = false, updated_at = now()
     where candidate_id = new.id and status = 'running';
    return null;
  end if;
  select topic_fingerprint into old_fp from public.impact_dc_verification where candidate_id = new.id;
  if found and old_fp is not distinct from fp then
    return null;                       -- nothing the check reads changed (score, metrics, last_seen ...)
  end if;
  perform public._hs_dcv_enqueue(new.id, case when old_fp is null then 'topic_new' else 'topic_changed' end, true);
  if old_fp is not null then perform public._hs_dcv_invalidate(new.id, 'The topic changed.'); end if;
  update public.impact_dc_verification set topic_fingerprint = fp where candidate_id = new.id;
  return null;
end $fn$;
drop trigger if exists impact_dc_verification_topic_trg on public.impact_discovery_candidates;
create trigger impact_dc_verification_topic_trg
  after insert or update of title, place, subject, post_uris, link_keys, evidence, coverage, category, status, duplicate_of
  on public.impact_discovery_candidates for each row execute function public.impact_dc_verification_topic_change();

-- 2. DOCUMENT DECISIONS
create or replace function public.impact_dc_verification_document_change()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare pk text; r record;
begin
  select project_key into pk from public.map1_project_document where document_id = new.document_id;
  for r in select candidate_id from public.impact_dc_verification where result_project_key = pk loop
    perform public._hs_dcv_invalidate(r.candidate_id, 'A document for this project was ' || new.decision || '.');
    perform public._hs_dcv_enqueue(r.candidate_id, 'document_' || new.decision, true);
  end loop;
  return null;
end $fn$;
drop trigger if exists impact_dc_verification_document_trg on public.map1_project_document_decision;
create trigger impact_dc_verification_document_trg after insert on public.map1_project_document_decision
  for each row execute function public.impact_dc_verification_document_change();

-- 3. PROJECT FACTS, read through Map 1's own readers. The worker stores this at success; the detector compares.
create or replace function public.impact_dc_project_facts(p_project_key text, p_zip text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'geo', 'pg_temp' as $fn$
declare loc jsonb := public.map1_project_locate(p_project_key, p_zip); z text; mk text; f jsonb := '{}'::jsonb; r record;
begin
  if loc->>'state' <> 'found' then
    return jsonb_build_object('state', loc->>'state');
  end if;
  z := loc->>'zip'; mk := loc->>'map_key';
  if mk like 'n5:%' then
    select p.name, p.status, p.lat, p.lng into r from public.app_projects p
     where p.zip = z and p.record_kind = 'development' and p.source_key = substr(mk, 4) order by p.id limit 1;
    if found then f := jsonb_build_object('name', r.name, 'status', r.status, 'lat', r.lat, 'lng', r.lng); end if;
  else
    select m.project_name, m.map_status, m.raw_status, m.lat, m.lng, m.location_text, m.source_url into r
      from public.map1_dc_zip_members(z) m where m.source_key = mk limit 1;
    if found then f := jsonb_build_object('name', r.project_name, 'status', r.map_status, 'raw_status', r.raw_status,
      'lat', r.lat, 'lng', r.lng, 'location_text', r.location_text, 'source_url', r.source_url); end if;
  end if;
  return jsonb_build_object('state', 'found', 'zip', z, 'zips', loc->'zips', 'map_key', mk) || f;
end $fn$;
revoke all on function public.impact_dc_project_facts(text, text) from public;
grant execute on function public.impact_dc_project_facts(text, text) to service_role;

create or replace function public.impact_dc_verification_detect_changes(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare r record; now_f jsonb; changed int := 0; aged int := 0; checked int := 0;
begin
  for r in select * from public.impact_dc_verification
            where result_project_key is not null and status in ('done', 'gave_up')
            order by last_success_at nulls first limit greatest(1, least(p_limit, 500)) loop
    checked := checked + 1;
    now_f := public.impact_dc_project_facts(r.result_project_key, r.result_zip);
    if now_f is distinct from r.result_facts then
      perform public._hs_dcv_invalidate(r.candidate_id, case
        when now_f->>'state' <> 'found' then 'The project is no longer found on Map 1 (' || coalesce(now_f->>'state', '?') || ').'
        when now_f->>'map_key' is distinct from r.result_facts->>'map_key' then 'The project was merged or re-keyed.'
        when now_f->>'zip' is distinct from r.result_facts->>'zip' then 'The project moved to another ZIP.'
        when now_f->>'status' is distinct from r.result_facts->>'status' then 'The project''s status changed.'
        else 'The project''s published details changed.' end);
      perform public._hs_dcv_enqueue(r.candidate_id, 'project_changed', true);
      changed := changed + 1;
    elsif r.last_success_at < now() - public.impact_dc_verification_max_age() then
      perform public._hs_dcv_enqueue(r.candidate_id, 'max_age', true);
      aged := aged + 1;
    end if;
  end loop;
  return jsonb_build_object('checked', checked, 'changed', changed, 'requeued_for_age', aged);
end $fn$;
revoke all on function public.impact_dc_verification_detect_changes(integer) from public;
grant execute on function public.impact_dc_verification_detect_changes(integer) to service_role;

-- ── the worker's three calls (service role) ───────────────────────────────────────────────────────
-- Claim due jobs. An expired lease counts as a failed attempt.
create or replace function public.impact_dc_verification_claim(p_worker text, p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare r record; out jsonb := '[]'::jsonb; rid uuid;
begin
  for r in select * from public.impact_dc_verification
            where status = 'running' and lease_expires_at < now() for update skip locked loop
    update public.impact_dc_verification_runs set outcome = 'expired', finished_at = now(),
           error = 'The worker stopped before finishing.' where run_id = r.current_run and outcome = 'running';
    perform public._hs_dcv_after_failure(r.candidate_id, 'The worker stopped before finishing.');
  end loop;
  for r in select v.*, c.title, c.place, c.subject, c.coverage, c.evidence, c.lead_url, c.related, c.link_keys, c.discovered_at
             from public.impact_dc_verification v join public.impact_discovery_candidates c on c.id = v.candidate_id
            where v.status = 'queued' and v.next_attempt_at <= now()
              and c.category = 'data_centers' and c.status not in ('rejected','dismissed','excluded') and c.duplicate_of is null
            order by v.next_attempt_at, v.candidate_id
            limit greatest(1, least(p_limit, 20)) for update of v skip locked loop
    insert into public.impact_dc_verification_runs (candidate_id, reason, worker) values (r.candidate_id, r.queued_reason, p_worker)
    returning run_id into rid;
    update public.impact_dc_verification set status = 'running', current_run = rid, lease_expires_at = now() + interval '15 minutes',
           rerun_requested = false, last_attempt_at = now(), updated_at = now() where candidate_id = r.candidate_id;
    out := out || jsonb_build_array(jsonb_build_object('run_id', rid, 'candidate_id', r.candidate_id, 'reason', r.queued_reason,
      'candidate', jsonb_build_object('title', r.title, 'place', r.place, 'subject', r.subject, 'coverage', r.coverage,
        'evidence', r.evidence, 'lead_url', r.lead_url, 'related', r.related, 'link_keys', to_jsonb(r.link_keys),
        'discovered_at', r.discovered_at,
        'zips', to_jsonb(public.impact_dc_topic_zips(public.impact_dc_topic_places(r.coverage, r.place))),
        'states', to_jsonb(public.impact_dc_topic_states(public.impact_dc_topic_places(r.coverage, r.place)))),
      'previous_project_key', r.result_project_key));
  end loop;
  return out;
end $fn$;

create or replace function public._hs_dcv_after_failure(p_candidate uuid, p_error text)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare v public.impact_dc_verification%rowtype;
begin
  select * into v from public.impact_dc_verification where candidate_id = p_candidate for update;
  update public.impact_dc_verification
     set attempts = v.attempts + 1, last_error = p_error, current_run = null, lease_expires_at = null,
         status = case when v.rerun_requested then 'queued' when v.attempts + 1 >= 3 then 'gave_up' else 'queued' end,
         next_attempt_at = case when v.rerun_requested then now() else now() + public.impact_dc_verification_backoff(v.attempts + 1) end,
         rerun_requested = false, updated_at = now()
   where candidate_id = p_candidate;
end $fn$;

create or replace function public.impact_dc_verification_fail(p_run uuid, p_error text)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare c uuid;
begin
  update public.impact_dc_verification_runs set outcome = 'failed', finished_at = now(), error = left(coalesce(p_error, 'failed'), 1000)
   where run_id = p_run and outcome = 'running' returning candidate_id into c;
  if c is null then raise exception 'no running run %', p_run using errcode = 'P0002'; end if;
  perform public._hs_dcv_after_failure(c, left(coalesce(p_error, 'failed'), 1000));
end $fn$;

-- Record a successful check. The facts fingerprint is taken HERE, from the same function the detector uses.
create or replace function public.impact_dc_verification_record(p_run uuid, p_result jsonb)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare c uuid; started timestamptz; v public.impact_dc_verification%rowtype; pk text; z text;
begin
  if jsonb_typeof(p_result) <> 'object' or p_result->>'outcome' not in
     ('verified','needs_review','missing_documentation','missing_website_connection','check_failed') then
    raise exception 'result must carry one of the five outcomes' using errcode = '22023';
  end if;
  update public.impact_dc_verification_runs set outcome = 'succeeded', finished_at = now(), result = p_result
   where run_id = p_run and outcome = 'running' returning candidate_id, started_at into c, started;
  if c is null then raise exception 'no running run %', p_run using errcode = 'P0002'; end if;
  select * into v from public.impact_dc_verification where candidate_id = c for update;
  pk := p_result->'match'->>'project_key'; z := p_result->'match'->>'zip';
  update public.impact_dc_verification
     set result = p_result, last_success_at = now(), last_success_run_started_at = started,
         result_project_key = pk, result_zip = z,
         result_facts = case when pk is null then null else public.impact_dc_project_facts(pk, z) end,
         last_error = null, attempts = 0, current_run = null, lease_expires_at = null,
         status = case when v.rerun_requested then 'queued' else 'done' end,
         next_attempt_at = now(), rerun_requested = false, updated_at = now()
   where candidate_id = c;
end $fn$;

revoke all on function public.impact_dc_verification_claim(text, integer), public.impact_dc_verification_fail(uuid, text),
  public.impact_dc_verification_record(uuid, jsonb), public._hs_dcv_after_failure(uuid, text),
  public._hs_dcv_enqueue(uuid, text, boolean), public._hs_dcv_invalidate(uuid, text) from public;
grant execute on function public.impact_dc_verification_claim(text, integer), public.impact_dc_verification_fail(uuid, text),
  public.impact_dc_verification_record(uuid, jsonb) to service_role;

-- ── what Tab 17 reads (admin), and the manual Recheck ─────────────────────────────────────────────
-- The one definition of current / stale and of link availability and reply readiness.
create or replace function public.impact_dc_verification_view(v public.impact_dc_verification)
returns jsonb language sql stable as $fn$
  with s as (
    select array_remove(array[
      case when v.result is null then null
           when v.invalidated_at is not null and v.invalidated_at >= v.last_success_run_started_at
             then 'Changed since the last check: ' || coalesce(v.invalidated_reason, 'something it depends on changed.') end,
      case when v.result is not null and v.last_success_at < now() - public.impact_dc_verification_max_age()
             then 'The last successful check is more than 48 hours old.' end,
      case when v.result is not null and v.last_attempt_at > v.last_success_at and v.last_error is not null
             then 'The latest check failed: ' || v.last_error end
    ], null) as reasons)
  select jsonb_build_object(
    'candidate_id', v.candidate_id,
    'job', jsonb_build_object('status', v.status, 'attempts', v.attempts, 'next_attempt_at', v.next_attempt_at,
                              'last_attempt_at', v.last_attempt_at, 'last_error', v.last_error, 'rerun_requested', v.rerun_requested),
    'freshness', case when v.result is null then 'none' when cardinality(s.reasons) = 0 then 'current' else 'stale' end,
    'stale_reasons', to_jsonb(s.reasons),
    'last_success_at', v.last_success_at,
    'result', v.result,
    'link_available', v.result is not null and cardinality(s.reasons) = 0 and coalesce((v.result->'link'->>'available')::boolean, false),
    'reply_ready', v.result is not null and cardinality(s.reasons) = 0 and coalesce((v.result->'reply'->>'ready')::boolean, false))
  from s
$fn$;

create or replace function public.hs_impact_dc_verification_state(p_candidates uuid[])
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  perform public._hs_is_admin();
  return coalesce((select jsonb_agg(public.impact_dc_verification_view(v) || jsonb_build_object('reply_edit', public.impact_dc_reply_edit(v))
                            order by v.candidate_id)
                     from public.impact_dc_verification v where v.candidate_id = any(p_candidates[1:200])), '[]'::jsonb);
end $fn$;

create or replace function public.hs_impact_dc_verification_recheck(p_candidate uuid)
returns text language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  perform public._hs_is_admin();
  if not exists (select 1 from public.impact_discovery_candidates where id = p_candidate and category = 'data_centers') then
    raise exception 'not a data-center topic' using errcode = 'P0002';
  end if;
  return public._hs_dcv_enqueue(p_candidate, 'manual', true);
end $fn$;
revoke all on function public.hs_impact_dc_verification_state(uuid[]), public.hs_impact_dc_verification_recheck(uuid) from public;
grant execute on function public.hs_impact_dc_verification_state(uuid[]), public.hs_impact_dc_verification_recheck(uuid) to authenticated;

-- ── Stage 3: what the Tab 17 tile saves and reviews ───────────────────────────────────────────────
-- SAVED REPLY EDITS. The founder's own wording is kept until the founder changes it: a new check never overwrites it. Each save
-- records the project link and the project facts it was written against, so the tile can say when either has changed since.
-- Append-only; the newest row is the edit in force; a row with no text means "use the suggested reply again".
create table if not exists public.impact_dc_reply_edits (
  id            bigserial primary key,
  candidate_id  uuid not null references public.impact_dc_verification(candidate_id),
  text          text check (text is null or (char_length(btrim(text)) between 1 and 1200)),
  link_at_save  text,
  facts_at_save text,
  saved_by      text not null,
  saved_at      timestamptz not null default now()
);
create index if not exists impact_dc_reply_edits_cand_idx on public.impact_dc_reply_edits (candidate_id, id desc);
alter table public.impact_dc_reply_edits enable row level security;
revoke all on public.impact_dc_reply_edits from anon, authenticated;
create or replace function public.impact_dc_reply_edits_frozen() returns trigger language plpgsql as $fn$
begin raise exception 'saved reply edits are append-only' using errcode = '55000'; end $fn$;
drop trigger if exists impact_dc_reply_edits_frozen_trg on public.impact_dc_reply_edits;
create trigger impact_dc_reply_edits_frozen_trg before update or delete on public.impact_dc_reply_edits
  for each row execute function public.impact_dc_reply_edits_frozen();

create or replace function public.hs_impact_dc_reply_save(p_candidate uuid, p_text text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare v public.impact_dc_verification%rowtype; who text := public._hs_is_admin(); t text := nullif(btrim(p_text), '');
begin
  select * into v from public.impact_dc_verification where candidate_id = p_candidate;
  if not found then raise exception 'this topic has no project check' using errcode = 'P0002'; end if;
  if t is not null and char_length(t) > 1200 then raise exception 'the reply is too long' using errcode = '22001'; end if;
  insert into public.impact_dc_reply_edits (candidate_id, text, link_at_save, facts_at_save, saved_by)
  values (p_candidate, t, v.result->'link'->>'url', md5(coalesce(v.result_facts::text, '')), who);
  return jsonb_build_object('saved', true, 'cleared', t is null);
end $fn$;

-- The edit in force, and whether the link or the project facts moved since it was saved.
create or replace function public.impact_dc_reply_edit(v public.impact_dc_verification)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select case when e.text is null then null else jsonb_build_object(
    'text', e.text, 'saved_at', e.saved_at, 'saved_by', e.saved_by,
    'link_changed', e.link_at_save is distinct from (v.result->'link'->>'url'),
    'facts_changed', e.facts_at_save is distinct from md5(coalesce(v.result_facts::text, '')),
    'has_current_link', (v.result->'link'->>'url') is not null and position((v.result->'link'->>'url') in e.text) > 0) end
  from (select * from public.impact_dc_reply_edits where candidate_id = v.candidate_id order by id desc limit 1) e
$fn$;

-- DOCUMENT REVIEW. Every document on file for a project, with its current state (pending, approved, rejected, revoked).
-- Approving means the document belongs to the project and may be shown on Map 1. It never changes the project's status.
create or replace function public.hs_impact_dc_project_documents(p_project_key text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  perform public._hs_is_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('document_id', d.document_id, 'url', d.url, 'title', d.title,
      'publisher', d.publisher, 'doc_kind', d.doc_kind, 'doc_date', d.doc_date, 'doc_date_label', d.doc_date_label,
      'supports', d.supports, 'proposed_by', d.proposed_by, 'proposed_at', d.created_at,
      'state', public.map1_project_document_current(d.document_id)) order by d.created_at, d.document_id)
    from public.map1_project_document d where d.project_key = p_project_key), '[]'::jsonb);
end $fn$;
revoke all on function public.hs_impact_dc_reply_save(uuid, text), public.impact_dc_reply_edit(public.impact_dc_verification),
  public.hs_impact_dc_project_documents(text) from public;
grant execute on function public.hs_impact_dc_reply_save(uuid, text), public.hs_impact_dc_project_documents(text) to authenticated;

-- ── starting the worker (NOT SCHEDULED HERE) ───────────────────────────────────────────────────────
-- impact_dc_verification_tick() runs the change detector and dispatches the worker when a job is due, at most once in
-- 10 minutes. Enabling it is a separate, approved step:
--   select cron.schedule('impact-dc-verification', '*/10 * * * *', 'select public.impact_dc_verification_tick()');
create table if not exists public.impact_dc_verification_dispatches (
  dispatched_at timestamptz primary key default now(),
  request_id    bigint,
  note          text
);
alter table public.impact_dc_verification_dispatches enable row level security;
revoke all on public.impact_dc_verification_dispatches from anon, authenticated;

create or replace function public.impact_dc_verification_tick()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $fn$
declare det jsonb; due int; pat text; req bigint;
begin
  det := public.impact_dc_verification_detect_changes(50);
  select count(*) into due from public.impact_dc_verification
   where (status = 'queued' and next_attempt_at <= now()) or (status = 'running' and lease_expires_at < now());
  if due = 0 or exists (select 1 from public.impact_dc_verification_dispatches where dispatched_at > now() - interval '10 minutes') then
    return det || jsonb_build_object('due', due, 'dispatched', false);
  end if;
  select decrypted_secret into pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if pat is null or btrim(pat) = '' then
    insert into public.impact_dc_verification_dispatches (note) values ('no GitHub credential stored; nothing dispatched');
    return det || jsonb_build_object('due', due, 'dispatched', false, 'error', 'no credential');
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-site/actions/workflows/impact-dc-verify.yml/dispatches',
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || pat, 'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-impact-dc-verify', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000) into req;
  insert into public.impact_dc_verification_dispatches (request_id, note) values (req, due || ' job(s) due');
  return det || jsonb_build_object('due', due, 'dispatched', true);
end $fn$;
revoke all on function public.impact_dc_verification_tick() from public;

-- Existing data-center topics are queued once, by the topic trigger's own rule (touching nothing they store).
insert into public.impact_dc_verification (candidate_id, status, queued_reason, topic_fingerprint)
select c.id, 'queued', 'backfill', public.impact_dc_topic_fingerprint(c)
  from public.impact_discovery_candidates c
 where c.category = 'data_centers' and c.status not in ('rejected','dismissed','excluded') and c.duplicate_of is null
on conflict (candidate_id) do nothing;

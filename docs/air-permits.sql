-- AIR PERMITS & FILINGS (founder requirement, 2026-11-21): a first-class Map 1 / ZIP-page / report layer, the
-- equal of "Water rights filings", backed by ONE shared national ingestion function and per-authority sources.
--
-- ⛔ NOT APPLIED. Applied only after review, through the replica dry-run rule (CLAUDE.md §7.11: a production dry
-- run runs no DDL in production). Additive only: new tables and functions, nothing existing is touched.
--
-- THREE ENTITIES, KEPT APART (never merged, never counted twice):
--   * the REGULATED FACILITY  -> facility_ref (agency regulated-entity id, e.g. TCEQ RN) + facility_name on a record;
--   * the DEVELOPMENT PROJECT -> a development dossier / app_projects row. A record carries project_link_ref ONLY
--     when a reviewer linked it (written by the review path, never by an adapter). Nothing here counts it as a
--     development project, so linking never inflates a development count;
--   * the PERMIT RECORD       -> one row per authorization/action (air_permit_records), with its dated history in
--     air_permit_record_observations. An air authorization is never an approval of the whole project.
--
-- ONE WRITE PATH. Every authority adapter (TCEQ first, CARB/FDEP/... later) calls public.air_permits_ingest(source,
-- records, complete). The function, not the adapter, enforces: source registered and ACTIVE, https official link,
-- a stable id, a permit or project number, a controlled action_kind, a point only with its stated basis, history
-- written only when a field changed (idempotent), and "complete" only for a whole read that clears the anti-
-- truncation floor. A source that is not active cannot write at all.
--
-- COVERAGE IS DATA, NOT A GUESS. air_permit_sources states, per authority, what it covers (permit types, geography
-- in coverage_note) and its access_status: active | blocked | not_built. The reader says one of:
--   complete / unavailable (stale or last read failed) / not_measured / not_covered / blocked.
-- "blocked" and "not_covered" and "unavailable" are NEVER "no air permits".
--
-- TEXAS (first authority). tx_tceq_nsr is registered BLOCKED: the only list that enumerates TCEQ air projects
-- (www2.tceq.texas.gov/airperm) answers robots.txt "Disallow: /" (read 2026-11-21), and data.texas.gov has no air
-- dataset. No adapter may be activated against it. Switching it to 'active' is one reviewed UPDATE once a compliant
-- discovery route exists (docs/air-permit-coverage-audit-2026-11-21 in homesignal-ingest).

create table if not exists public.air_permit_sources (
  source          text primary key,
  state           text not null,
  authority       text not null,
  agency          text not null,
  permit_types    text[] not null default '{}',
  coverage_note   text,
  access_status   text not null default 'not_built' check (access_status in ('active', 'blocked', 'not_built')),
  access_note     text,
  record_page     text,
  max_age_hours   int  not null default 48 check (max_age_hours between 1 and 24 * 31),
  expected_min    int  not null default 1 check (expected_min >= 1)
);

create table if not exists public.air_permit_states (
  state   text primary key,
  name    text not null,
  status  text not null default 'not_checked' check (status in ('loaded', 'blocked', 'not_checked')),
  source  text references public.air_permit_sources (source),
  note    text
);

create table if not exists public.air_permit_runs (
  run_id           bigserial primary key,
  source           text not null references public.air_permit_sources (source),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  outcome          text not null default 'running' check (outcome in ('running', 'complete', 'partial', 'incomplete', 'failed')),
  records_read     int  not null default 0,
  records_rejected int  not null default 0,
  records_changed  int  not null default 0,
  reject_reasons   jsonb not null default '{}'::jsonb,
  detail           text
);

create table if not exists public.air_permit_records (
  record_id          text primary key,                       -- <source>:<source_record_id>, stable
  source             text not null references public.air_permit_sources (source),
  state              text not null,
  permit_no          text,                                   -- permit / registration number as the agency writes it
  project_no         text,                                   -- the agency's project / application number
  facility_ref       text,                                   -- regulated-entity id (TCEQ RN)
  facility_name      text,
  applicant          text,                                   -- as published; the reader shows organisations only
  permit_type        text,
  action_kind        text not null check (action_kind in
                       ('application', 'registration', 'proposed_action', 'issued', 'modification', 'renewal', 'amendment', 'other')),
  status             text,                                   -- the agency's own word
  received_on        date,
  action_on          date,
  effective_on       date,
  expires_on         date,
  comment_until      date,                                   -- public-comment deadline, only when the source states one
  record_url         text not null check (record_url ~ '^https://[^[:space:]"''<>]+$'),
  doc_urls           jsonb not null default '[]'::jsonb,
  county             text,
  lat                double precision,
  lng                double precision,
  location_basis     text check (location_basis in ('source_point', 'geocoded_address', 'reviewed_point')),
  project_link_ref   text,                                   -- set ONLY by a reviewed link; nothing here counts it
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  removed_from_source_at timestamptz,
  fingerprint        text not null,
  constraint air_permit_number_present check (permit_no is not null or project_no is not null),
  constraint air_permit_point_has_basis check ((lat is null) = (lng is null) and ((lat is null) = (location_basis is null))),
  constraint air_permit_point_in_range check (lat is null or (lat between -90 and 90 and lng between -180 and 180))
);
create index if not exists air_permit_records_current_latlng_idx
  on public.air_permit_records (lat, lng) where removed_from_source_at is null and lat is not null;
create index if not exists air_permit_records_state_idx on public.air_permit_records (source, county)
  where removed_from_source_at is null;

create table if not exists public.air_permit_record_observations (
  id           bigserial primary key,
  record_id    text not null references public.air_permit_records (record_id),
  run_id       bigint references public.air_permit_runs (run_id),
  observed_at  timestamptz not null default now(),
  action_kind  text not null,
  status       text,
  fields       jsonb not null,
  fingerprint  text not null
);
create index if not exists air_permit_obs_record_idx on public.air_permit_record_observations (record_id, id);

-- history is append-only
create or replace function public.air_permit_obs_frozen() returns trigger language plpgsql as $f$
begin raise exception 'air_permit_record_observations is append-only' using errcode = '55000'; end $f$;
drop trigger if exists air_permit_obs_frozen_trg on public.air_permit_record_observations;
create trigger air_permit_obs_frozen_trg before update or delete on public.air_permit_record_observations
  for each row execute function public.air_permit_obs_frozen();

-- A VERIFIED facility shape for a record: a boundary or parcel footprint the agency's own record (or a reviewer, citing evidence) establishes.
-- Never a city, ZIP or county location; those have no basis here. A record may own several parcels; it is still ONE record.
create table if not exists public.air_permit_footprints (
  record_id    text not null references public.air_permit_records (record_id),
  feature_id   text not null,
  geom         geometry(MultiPolygon, 4326) not null check (st_isvalid(geom)),
  basis        text not null check (basis in ('verified_boundary', 'verified_parcel')),
  evidence_ref text not null check (evidence_ref ~ '^https://[^[:space:]"''<>]+$'),
  verified_by  text not null check (btrim(verified_by) <> ''),
  verified_at  timestamptz not null default now(),
  primary key (record_id, feature_id)
);
create index if not exists air_permit_footprints_geom_gix on public.air_permit_footprints using gist (geom);
alter table public.air_permit_footprints enable row level security;
alter table public.air_permit_sources enable row level security;
alter table public.air_permit_states enable row level security;
alter table public.air_permit_runs enable row level security;
alter table public.air_permit_records enable row level security;
alter table public.air_permit_record_observations enable row level security;
revoke all on public.air_permit_sources, public.air_permit_states, public.air_permit_runs,
  public.air_permit_records, public.air_permit_footprints, public.air_permit_record_observations from public, anon, authenticated;
revoke all on sequence public.air_permit_runs_run_id_seq, public.air_permit_record_observations_id_seq from public, anon, authenticated;

insert into public.air_permit_sources (source, state, authority, agency, permit_types, coverage_note, access_status, access_note, record_page)
values ('tx_tceq_nsr', 'TX', 'Texas Commission on Environmental Quality', 'Texas Commission on Environmental Quality',
        array['New Source Review permits', 'standard permit registrations', 'permits by rule (not listed by TCEQ)'],
        'Statewide New Source Review project status. Not yet read.',
        'blocked',
        'The only list of TCEQ air projects (www2.tceq.texas.gov/airperm) sends robots.txt "Disallow: /"; the Texas open-data portal carries no air dataset. Checked 2026-11-21.',
        'https://www.tceq.texas.gov/permitting/air/air_status_permits.html')
on conflict (source) do nothing;
insert into public.air_permit_states (state, name, status, source, note)
values ('TX', 'Texas', 'blocked', 'tx_tceq_nsr', 'TCEQ NSR project list cannot be read by a program (robots.txt).')
on conflict (state) do nothing;

-- A person is never named: only organisations are shown (same rule as water rights).
create or replace function public.air_permits_display_applicant(p_name text)
returns text language sql immutable set search_path to 'pg_temp' as $fn$
  select case
    when p_name is null or btrim(p_name) = '' then null
    when p_name ~* '\m(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co|ltd|lp|llp|pllc|partnership|association|assn|district|authority|energy|power|resources|utilities|technologies|holdings|city|town|county|state|united states|department|university|college|school|bureau)\M'
      then p_name
    else 'Individual applicant'
  end
$fn$;

-- ONE shape for a list of records, used by both readers. p_zip_member stamps each point with the polygon verdict.
create or replace function public.air_permit_records_json(p_recs public.air_permit_records[], p_zip_member boolean)
returns jsonb language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select coalesce(jsonb_agg(f order by f ->> 'action_on' desc nulls last, f ->> 'received_on' desc nulls last, f ->> 'record_id' collate "C"), '[]'::jsonb)
    from (select jsonb_strip_nulls(jsonb_build_object(
                   'record_id', r.record_id, 'source', r.source, 'state', r.state,
                   'permit_no', r.permit_no, 'project_no', r.project_no,
                   'facility_ref', r.facility_ref, 'facility_name', r.facility_name,
                   'applicant', public.air_permits_display_applicant(r.applicant),
                   'permit_type', r.permit_type, 'action_kind', r.action_kind, 'status', r.status,
                   'received_on', r.received_on, 'action_on', r.action_on, 'effective_on', r.effective_on,
                   'expires_on', r.expires_on, 'comment_until', r.comment_until,
                   'record_url', r.record_url,
                   'doc_urls', (select coalesce(jsonb_agg(u), '[]'::jsonb) from jsonb_array_elements_text(r.doc_urls) u where u ~ '^https://[^[:space:]"''<>]+$'),
                   'location_basis', r.location_basis,
                   'project_link_ref', r.project_link_ref,
                   'points', case when r.lat is null then '[]'::jsonb
                             else jsonb_build_array(jsonb_build_object('lat', r.lat, 'lng', r.lng)
                                    || case when p_zip_member then jsonb_build_object('zip_membership', 'member') else '{}'::jsonb end) end)) f
            from unnest(p_recs) r) x
$fn$;

-- THE WRITE PATH: every authority adapter calls this and nothing else writes the tables.
create or replace function public.air_permits_ingest(p_source text, p_records jsonb, p_complete boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  src public.air_permit_sources; v_run bigint; rec jsonb; v_id text; v_fp text; v_fields jsonb; v_old text;
  v_lat double precision; v_lng double precision; v_basis text; v_kind text;
  v_read int := 0; v_rej int := 0; v_chg int := 0; v_why text; v_reasons jsonb := '{}'::jsonb;
  v_seen text[] := '{}'; v_outcome text; v_removed int := 0;
  v_rd date; v_ad date; v_ed date; v_xd date; v_cd date;
begin
  select * into src from public.air_permit_sources where source = p_source;
  if src.source is null then raise exception 'unknown air-permit source %', p_source using errcode = '22023'; end if;
  if src.access_status <> 'active' then
    raise exception 'air-permit source % is % and may not write: %', p_source, src.access_status, coalesce(src.access_note, '') using errcode = '55000';
  end if;
  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'records must be a json array' using errcode = '22023';
  end if;
  insert into public.air_permit_runs (source) values (p_source) returning run_id into v_run;

  for rec in select * from jsonb_array_elements(p_records) loop
    v_read := v_read + 1; v_why := null;
    v_kind := rec ->> 'action_kind';
    begin
      v_lat := nullif(rec ->> 'lat', '')::double precision; v_lng := nullif(rec ->> 'lng', '')::double precision;
      v_rd := nullif(rec ->> 'received_on', '')::date; v_ad := nullif(rec ->> 'action_on', '')::date;
      v_ed := nullif(rec ->> 'effective_on', '')::date; v_xd := nullif(rec ->> 'expires_on', '')::date;
      v_cd := nullif(rec ->> 'comment_until', '')::date;
    exception when others then v_why := 'bad_value'; end;
    v_basis := rec ->> 'location_basis';
    if v_why is null then
      v_why := case
        when coalesce(btrim(rec ->> 'source_record_id'), '') = '' then 'no_record_id'
        when coalesce(btrim(rec ->> 'permit_no'), '') = '' and coalesce(btrim(rec ->> 'project_no'), '') = '' then 'no_permit_or_project_no'
        when coalesce(rec ->> 'record_url', '') !~ '^https://[^[:space:]"''<>]+$' then 'no_https_record_url'
        when v_kind is null or v_kind not in ('application', 'registration', 'proposed_action', 'issued', 'modification', 'renewal', 'amendment', 'other') then 'bad_action_kind'
        when (v_lat is null) <> (v_lng is null) then 'half_a_point'
        when v_lat is not null and (v_lat not between -90 and 90 or v_lng not between -180 and 180) then 'point_out_of_range'
        when v_lat is not null and coalesce(v_basis, '') not in ('source_point', 'geocoded_address', 'reviewed_point') then 'point_without_basis'
        when v_lat is null and v_basis is not null then 'basis_without_point'
        else null end;
    end if;
    if v_why is not null then
      v_rej := v_rej + 1;
      v_reasons := jsonb_set(v_reasons, array[v_why], to_jsonb(coalesce((v_reasons ->> v_why)::int, 0) + 1));
      continue;
    end if;
    v_id := p_source || ':' || btrim(rec ->> 'source_record_id');
    v_seen := v_seen || v_id;
    v_fields := jsonb_strip_nulls(jsonb_build_object(
      'permit_no', nullif(btrim(rec ->> 'permit_no'), ''), 'project_no', nullif(btrim(rec ->> 'project_no'), ''),
      'facility_ref', nullif(btrim(rec ->> 'facility_ref'), ''), 'facility_name', nullif(btrim(rec ->> 'facility_name'), ''),
      'applicant', nullif(btrim(rec ->> 'applicant'), ''), 'permit_type', nullif(btrim(rec ->> 'permit_type'), ''),
      'action_kind', v_kind, 'status', nullif(btrim(rec ->> 'status'), ''),
      'received_on', v_rd, 'action_on', v_ad, 'effective_on', v_ed, 'expires_on', v_xd, 'comment_until', v_cd,
      'record_url', rec ->> 'record_url', 'doc_urls', coalesce(rec -> 'doc_urls', '[]'::jsonb),
      'county', nullif(btrim(rec ->> 'county'), ''), 'lat', v_lat, 'lng', v_lng, 'location_basis', v_basis));
    v_fp := md5(v_fields::text);
    select fingerprint into v_old from public.air_permit_records where record_id = v_id;
    if v_old is distinct from v_fp then
      insert into public.air_permit_records (record_id, source, state, permit_no, project_no, facility_ref, facility_name, applicant,
        permit_type, action_kind, status, received_on, action_on, effective_on, expires_on, comment_until, record_url, doc_urls,
        county, lat, lng, location_basis, fingerprint)
      values (v_id, p_source, src.state, v_fields ->> 'permit_no', v_fields ->> 'project_no', v_fields ->> 'facility_ref', v_fields ->> 'facility_name',
        v_fields ->> 'applicant', v_fields ->> 'permit_type', v_kind, v_fields ->> 'status', v_rd, v_ad, v_ed, v_xd, v_cd,
        rec ->> 'record_url', coalesce(rec -> 'doc_urls', '[]'::jsonb), v_fields ->> 'county', v_lat, v_lng, v_basis, v_fp)
      on conflict (record_id) do update set
        permit_no = excluded.permit_no, project_no = excluded.project_no, facility_ref = excluded.facility_ref,
        facility_name = excluded.facility_name, applicant = excluded.applicant, permit_type = excluded.permit_type,
        action_kind = excluded.action_kind, status = excluded.status, received_on = excluded.received_on,
        action_on = excluded.action_on, effective_on = excluded.effective_on, expires_on = excluded.expires_on,
        comment_until = excluded.comment_until, record_url = excluded.record_url, doc_urls = excluded.doc_urls,
        county = excluded.county, lat = excluded.lat, lng = excluded.lng, location_basis = excluded.location_basis,
        fingerprint = excluded.fingerprint, last_seen_at = now(), removed_from_source_at = null;
      insert into public.air_permit_record_observations (record_id, run_id, action_kind, status, fields, fingerprint)
      values (v_id, v_run, v_kind, v_fields ->> 'status', v_fields, v_fp);
      v_chg := v_chg + 1;
    else
      update public.air_permit_records set last_seen_at = now(), removed_from_source_at = null where record_id = v_id;
    end if;
  end loop;

  -- "complete" only for a whole read that wrote every record it saw and clears the floor. A short or
  -- rejecting read never marks anything removed and never refreshes the source's freshness.
  v_outcome := case when not p_complete then 'incomplete'
                    when v_read < src.expected_min then 'incomplete'
                    when v_rej > 0 then 'partial'
                    else 'complete' end;
  if v_outcome = 'complete' then
    update public.air_permit_records set removed_from_source_at = now()
     where source = p_source and removed_from_source_at is null and record_id <> all (v_seen);
    get diagnostics v_removed = row_count;
  end if;
  update public.air_permit_runs set finished_at = now(), outcome = v_outcome, records_read = v_read,
         records_rejected = v_rej, records_changed = v_chg, reject_reasons = v_reasons,
         detail = case when v_outcome = 'incomplete' then 'not marked complete; nothing marked removed' end
   where run_id = v_run;
  return jsonb_build_object('run_id', v_run, 'outcome', v_outcome, 'read', v_read, 'rejected', v_rej,
                            'changed', v_chg, 'removed', v_removed, 'reject_reasons', v_reasons);
end
$fn$;

-- The page's reader. Statuses: complete | unavailable | not_measured | not_covered | blocked.
create or replace function public.air_permits_for_zip(p_zip text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'geo', 'pg_temp'
as $fn$
declare
  v_state text; v_county text; st public.air_permit_states; src public.air_permit_sources;
  v_last timestamptz; v_geom geometry; v_box box2d; v_status text; v_pts public.air_permit_records[]; v_unloc int;
  v_base jsonb;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then raise exception 'invalid zip' using errcode = '22023'; end if;
  select c.state, c.county into v_state, v_county from public.communities c
   where c.level = 'zip' and c.zip_codes @> array[p_zip] limit 1;
  if v_state is null then return jsonb_build_object('zip', p_zip, 'status', 'not_covered', 'records', '[]'::jsonb); end if;
  select * into st from public.air_permit_states where state = v_state;
  if st.state is null or st.status = 'not_checked' then
    return jsonb_build_object('zip', p_zip, 'state', v_state, 'state_name', st.name, 'status', 'not_covered', 'records', '[]'::jsonb);
  end if;
  select * into src from public.air_permit_sources where source = st.source;
  v_base := jsonb_build_object('zip', p_zip, 'state', v_state, 'state_name', st.name, 'agency', src.agency,
                               'permit_types', to_jsonb(src.permit_types), 'coverage_note', src.coverage_note);
  if st.status = 'blocked' or src.access_status <> 'active' then
    return v_base || jsonb_build_object('status', 'blocked', 'blocked_note', src.access_note, 'records', '[]'::jsonb);
  end if;
  select max(finished_at) into v_last from public.air_permit_runs where source = src.source and outcome = 'complete';
  v_geom := geo.zip_membership_boundary(p_zip);
  if v_geom is null then
    return v_base || jsonb_build_object('status', 'not_measured', 'checked_at', v_last, 'records', '[]'::jsonb);
  end if;
  v_status := case when v_last is null or v_last < now() - make_interval(hours => src.max_age_hours) then 'unavailable' else 'complete' end;
  v_box := box2d(v_geom);
  select array_agg(r) into v_pts
    from public.air_permit_records r
   where r.source = src.source and r.removed_from_source_at is null and r.lat is not null
     and r.lat between st_ymin(v_box) and st_ymax(v_box) and r.lng between st_xmin(v_box) and st_xmax(v_box)
     and geo.zip_point_membership_in(v_geom, r.lat, r.lng) = 'member';
  -- records in this ZIP's county the source states WITHOUT a point: counted, never placed, never guessed
  select count(*) into v_unloc from public.air_permit_records r
   where r.source = src.source and r.removed_from_source_at is null and r.lat is null
     and v_county is not null and upper(r.county) = upper(v_county);
  return v_base || jsonb_build_object('status', v_status, 'checked_at', v_last,
                                      'unlocated_in_county', v_unloc,
                                      'records', public.air_permit_records_json(v_pts, true));
end
$fn$;

-- Map 1 ADDRESS MODE: records whose point lies within the circle, from every active source.
create or replace function public.map1_air_permits_near(p_lat double precision, p_lng double precision, p_radius_mi double precision,
                                                         p_state text default null, p_county text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare v_pts public.air_permit_records[]; v_sources jsonb; v_matches jsonb; v_unloc integer;
        v_meters double precision; v_hg geometry; v_home geography; v_dlat double precision; v_dlng double precision;
begin
  if p_lat is null or p_lng is null or p_radius_mi is null or p_lat not between -90 and 90
     or p_lng not between -180 and 180 or p_radius_mi <= 0 or p_radius_mi > 20 then
    raise exception 'invalid point or radius' using errcode = '22023';
  end if;
  v_meters := p_radius_mi * 1609.344;
  v_hg := st_setsrid(st_makepoint(p_lng, p_lat), 4326); v_home := v_hg::geography;
  v_dlat := p_radius_mi / 69.0 * 1.1; v_dlng := p_radius_mi / (69.0 * greatest(cos(radians(p_lat)), 0.0001)) * 1.1;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'source', s.source, 'state', st.state, 'state_name', st.name, 'agency', s.agency,
           'permit_types', to_jsonb(s.permit_types), 'checked_at', r.last,
           'status', case when s.access_status <> 'active' or st.status = 'blocked' then 'blocked'
                          when r.last is null or r.last < now() - make_interval(hours => s.max_age_hours) then 'unavailable'
                          else 'complete' end)) order by s.source collate "C"), '[]'::jsonb)
    into v_sources
    from public.air_permit_states st
    join public.air_permit_sources s on s.source = st.source
    left join lateral (select max(x.finished_at) as last from public.air_permit_runs x where x.source = s.source and x.outcome = 'complete') r on true
   where st.status in ('loaded', 'blocked');
  -- THE RULE (the same predicate n5_projects_within_radius applies to development geometry: ST_DWithin on the TRUE geometry, as geography,
  -- so a shape that only partly crosses the radius is in): a record with a verified footprint is judged by that footprint ALONE,
  -- over all its parcels; a record with only a point is judged by that point. One row per record either way.
  with fp_hit as (
    select f.record_id, min(st_distance(f.geom::geography, v_home)) as d
      from public.air_permit_footprints f
     where f.geom && st_expand(v_hg, v_dlng, v_dlat) and st_dwithin(f.geom::geography, v_home, v_meters)
     group by f.record_id
  ), pt_hit as (
    select w.record_id, st_distance(st_setsrid(st_makepoint(w.lng, w.lat), 4326)::geography, v_home) as d
      from public.air_permit_records w
     where w.lat is not null and not exists (select 1 from public.air_permit_footprints x where x.record_id = w.record_id)
       and w.lat between p_lat - p_radius_mi / 69.0 * 1.1 and p_lat + p_radius_mi / 69.0 * 1.1
       and w.lng between p_lng - v_dlng and p_lng + v_dlng
       and st_dwithin(st_setsrid(st_makepoint(w.lng, w.lat), 4326)::geography, v_home, v_meters)
  ), m as (
    select record_id, d, 'footprint'::text as by from fp_hit union all select record_id, d, 'point'::text from pt_hit
  )
  select array_agg(w order by w.record_id),
         jsonb_object_agg(m.record_id, jsonb_build_object('matched_by', m.by, 'distance_mi', round((m.d / 1609.344)::numeric, 3)))
    into v_pts, v_matches
    from m
    join public.air_permit_records w on w.record_id = m.record_id and w.removed_from_source_at is null
    join public.air_permit_sources s on s.source = w.source and s.access_status = 'active';
  -- records the source states WITHOUT any location (no point, no footprint): counted for the subject's county, never placed or guessed
  if p_state is not null and p_county is not null then
    select count(*) into v_unloc from public.air_permit_records w
      join public.air_permit_sources s on s.source = w.source and s.access_status = 'active'
     where w.removed_from_source_at is null and w.lat is null and upper(w.state) = upper(p_state) and upper(w.county) = upper(p_county)
       and not exists (select 1 from public.air_permit_footprints x where x.record_id = w.record_id);
  end if;
  return jsonb_strip_nulls(jsonb_build_object('status', 'complete', 'sources', v_sources,
           'records', public.air_permit_records_json(v_pts, false), 'matches', coalesce(v_matches, '{}'::jsonb),
           'unlocated_in_county', v_unloc, 'unlocated_county', case when v_unloc is not null then p_county end));
end
$fn$;

-- Reviewed write of a record's footprint (service_role only). Replaces that record's footprints in one statement set.
-- p_features: jsonb array of {"feature_id": text, "geometry": GeoJSON Polygon|MultiPolygon}. No features, a bad shape,
-- an unknown record or a basis outside the two verified kinds raises: nothing is half-written.
create or replace function public.air_permit_footprint_set(p_record text, p_basis text, p_evidence text, p_by text, p_features jsonb)
returns integer language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare f jsonb; g geometry; n integer := 0;
begin
  if not exists (select 1 from public.air_permit_records where record_id = p_record) then raise exception 'unknown record' using errcode = '22023'; end if;
  if p_basis not in ('verified_boundary', 'verified_parcel') then raise exception 'basis must be verified_boundary or verified_parcel' using errcode = '22023'; end if;
  if p_features is null or jsonb_typeof(p_features) <> 'array' or jsonb_array_length(p_features) = 0 then raise exception 'features required' using errcode = '22023'; end if;
  delete from public.air_permit_footprints where record_id = p_record;
  for f in select * from jsonb_array_elements(p_features) loop
    g := st_setsrid(st_geomfromgeojson((f -> 'geometry')::text), 4326);
    if geometrytype(g) not in ('POLYGON', 'MULTIPOLYGON') then raise exception 'footprint must be a polygon' using errcode = '22023'; end if;
    insert into public.air_permit_footprints (record_id, feature_id, geom, basis, evidence_ref, verified_by)
      values (p_record, coalesce(nullif(f ->> 'feature_id', ''), 'f' || (n + 1)), st_multi(g), p_basis, p_evidence, p_by);
    n := n + 1;
  end loop;
  return n;
end
$fn$;

revoke all on function public.air_permit_footprint_set(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.air_permit_obs_frozen() from public, anon, authenticated;
revoke all on function public.air_permits_ingest(text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.air_permits_display_applicant(text) from public, anon, authenticated;
revoke all on function public.air_permit_records_json(public.air_permit_records[], boolean) from public, anon, authenticated;
revoke all on function public.air_permits_for_zip(text) from public;
revoke all on function public.map1_air_permits_near(double precision, double precision, double precision, text, text) from public;
grant execute on function public.air_permits_ingest(text, jsonb, boolean) to service_role;
grant execute on function public.air_permit_footprint_set(text, text, text, text, jsonb) to service_role;
grant execute on function public.air_permits_for_zip(text) to anon, authenticated, service_role;
grant execute on function public.map1_air_permits_near(double precision, double precision, double precision, text, text) to anon, authenticated, service_role;

-- ── ROLLBACK (by hand; keeps nothing it did not create) ──────────────────────────────────────
-- drop function public.air_permit_footprint_set(text, text, text, text, jsonb), public.map1_air_permits_near(double precision, double precision, double precision, text, text), public.air_permits_for_zip(text),
--   public.air_permits_ingest(text, jsonb, boolean), public.air_permit_records_json(public.air_permit_records[], boolean),
--   public.air_permits_display_applicant(text), public.air_permit_obs_frozen() cascade;
-- drop table public.air_permit_footprints, public.air_permit_record_observations, public.air_permit_records, public.air_permit_runs, public.air_permit_states, public.air_permit_sources;

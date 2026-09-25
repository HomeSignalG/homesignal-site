-- ============================================================================
-- N5 generation-publication suite — PRODUCTION PRE-STATE, at test scale.
--
-- Every table below carries the columns and constraints production carries, read back
-- 2026-09-25 (information_schema / pg_constraint). Every function marked LIVE is the
-- pg_get_functiondef read-back of production on 2026-09-25, verbatim: the migration's
-- splice runs against these exact texts. Objects marked STUB exist only so the splice
-- has every reader it names; their bodies are minimal and say so.
-- ============================================================================
create extension if not exists postgis;
create schema if not exists geo;
create schema if not exists preservation;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------- lifecycle tables
create table geo.n5_generation (
  generation_id text primary key,
  snapshot_id   text,
  cutoff        timestamptz,
  state         text check (state in ('BUILDING','VALIDATING','READY','ACTIVE','SUPERSEDED','FAILED','ACTIVE_LEGACY')),
  opened_at     timestamptz default now(),
  activated_at  timestamptz,
  superseded_at timestamptz,
  zips_expected integer,
  zips_done     integer,
  note          text);
create unique index n5_generation_one_serving on geo.n5_generation
  ((state = any (array['ACTIVE','ACTIVE_LEGACY']))) where (state = any (array['ACTIVE','ACTIVE_LEGACY']));

create table geo.n5_generation_unresolved (
  generation_id text references geo.n5_generation(generation_id) on delete cascade,
  source_key text, zip text, reason_code text, detail jsonb,
  recorded_at timestamptz default now(),
  primary key (generation_id, source_key));

create table geo.n5_generation_reconcile (
  generation_id text, chunk_key text, expected_keys bigint, accounted_resolved bigint,
  accounted_unresolved bigint, unaccounted bigint, computed_at timestamptz default now(),
  primary key (generation_id, chunk_key));

create table geo.n5_shard (
  snapshot_id text, z3 char(3), projects bigint, pairs bigint, zips integer, checksum numeric,
  state text default 'pending' check (state in ('pending','running','done','halted')),
  started_at timestamptz, finished_at timestamptz, detail jsonb, generation_id text,
  claimed_by text, claim_expires_at timestamptz, attempts integer default 0,
  primary key (snapshot_id, z3));

create table preservation.app_project_identity (
  snapshot_id text, app_project_id uuid, zip text, source_key text, source_seq smallint,
  registry_id text, record_kind text, source_ref text, submitted_at date,
  lat double precision, lng double precision, identity_hash bytea, content_hash bytea,
  primary key (snapshot_id, app_project_id));

-- ---------------------------------------------------------------- geometry evidence
create table geo.n5_geom (
  source_key text, registry_id text, feature_id text, outcome smallint,
  geom geometry, invalid_reason text, first_z3 char(3), recovered_at timestamptz default now(),
  provenance text, verdict_snapshot_id text,
  primary key (source_key, feature_id),
  check ((outcome = 1 and geom is not null) or outcome <> 1),
  check (provenance in ('recovered_authoritative','proven_stored_point')),
  check ((provenance = 'proven_stored_point') = (verdict_snapshot_id is not null)),
  check ((provenance = 'proven_stored_point') = (feature_id = 'pt:1')));
create index n5_geom_gix on geo.n5_geom using gist (geom);

create table geo.n5_point_reject (
  source_key text primary key, registry_id text,
  reason text check (reason in ('NO_REGISTRY_VERDICT','NULL_COORD','NULL_ISLAND','OUTSIDE_JURISDICTION','INVALID_COORD','MULTI_COORD_UNRESOLVED')),
  detail jsonb, rejected_at timestamptz default now(), lat double precision, lng double precision,
  observed_in_z3 char(3), verdict_snapshot_id text);

create table geo.n5_accepted_source (registry_id text, treatment text, projects bigint, pairs bigint);

-- ---------------------------------------------------------------- the four serving-plane tables (pre-migration keys)
create table geo.n5_boundary_membership (
  zcta5 char(5) not null, source_key text not null, provenance text not null, run_id text not null,
  found_at timestamptz not null default now(),
  primary key (zcta5, source_key));

create table geo.zip_authoritative_membership (
  zcta5 char(5) not null, source_key text not null, lat double precision, lng double precision,
  point_rule text not null, clip_dim smallint, feature_count integer not null, geom_family text not null,
  run_id text not null, computed_at timestamptz not null default now(),
  record_kind text default 'development' check (record_kind in ('development','facility')),
  generation_id text,
  primary key (zcta5, source_key));

create table geo.zip_authoritative_marker (
  zcta5 char(5) not null, source_key text not null, marker_seq int not null,
  lat double precision not null, lng double precision not null, marker_rule text not null,
  family text, dim smallint, run_id text not null, computed_at timestamptz not null default now(),
  record_kind text default 'development' check (record_kind in ('development','facility')),
  generation_id text,
  primary key (zcta5, source_key, marker_seq));

create table geo.maps_zip_geography_status (
  zip char(5) primary key,
  status text not null check (status in ('boundary_complete','not_measured')),
  membership_rows integer not null check (membership_rows >= 0),
  completed_at timestamptz, run_id text, note text, cutover boolean default false,
  generation_id text);

-- ---------------------------------------------------------------- public inputs
create table public.canonical_zip_registry (zip text primary key);
create table public.app_projects (
  id uuid primary key default gen_random_uuid(), community_id uuid, zip text, name text, type text,
  status text, stage text, developer text, size text, investment text, jobs text, submitted_at date,
  lat double precision, lng double precision, impact_score int, impact_dimensions jsonb, lens text,
  source_ref text, created_at timestamptz default now(), record_kind text, registry_id text,
  facility_env jsonb, date_kind text, company_esg jsonb, address text, start_date date, end_date date,
  scope_text text, parties jsonb, provenance jsonb, source_key text, source_key_basis text,
  source_seq smallint, last_seen_at timestamptz, type_raw text);
create table public.app_zip_geography_cutover (
  zip char(5) primary key, enabled boolean, membership_rows int, marker_rows int, set_fingerprint text,
  frozen_at timestamptz, enabled_at timestamptz, note text, production_geography_verified_at timestamptz);

-- ---------------------------------------------------------------- LIVE: rep point (scripts/n5_unit_a_shadow.py ddl)
create or replace function geo.n5_rep_point(g geometry)
returns table (pt geometry, rule text)
language plpgsql immutable parallel safe
set search_path = public, pg_temp
as $fn$
declare c geometry; d int;
begin
  if g is null or ST_IsEmpty(g) then
    pt := null; rule := 'EMPTY_CLIP'; return next; return;
  end if;
  d := ST_Dimension(g);
  if d = 2 then
    c := ST_CollectionExtract(g, 3);
    if c is null or ST_IsEmpty(c) then pt := null; rule := 'EMPTY_CLIP'; return next; return; end if;
    pt := ST_PointOnSurface(c);
    rule := 'POLYGON_POINT_ON_SURFACE';
  elsif d = 1 then
    c := ST_CollectionExtract(g, 2);
    if c is null or ST_IsEmpty(c) then pt := null; rule := 'EMPTY_CLIP'; return next; return; end if;
    select ST_LineInterpolatePoint(dmp.geom, 0.5) into pt
      from ST_Dump(c) dmp
     order by ST_Length(dmp.geom) desc, ST_AsBinary(dmp.geom) asc
     limit 1;
    rule := 'LINE_MIDPOINT_LONGEST';
  else
    c := ST_CollectionExtract(g, 1);
    if c is null or ST_IsEmpty(c) then pt := null; rule := 'EMPTY_CLIP'; return next; return; end if;
    select dmp.geom into pt from ST_Dump(c) dmp order by ST_X(dmp.geom), ST_Y(dmp.geom) limit 1;
    rule := 'POINT_MIN_XY';
  end if;
  if pt is null then rule := 'UNRESOLVED'; end if;
  return next;
end $fn$;

-- ---------------------------------------------------------------- LIVE (pre-migration): the completion invariant
create or replace function geo.n5_assert_shadow_complete() returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare z char(5); want int; got int; expect int;
begin
  z := coalesce(new.zip, old.zip);
  select s.membership_rows into want from geo.maps_zip_geography_status s where s.zip = z and s.status = 'boundary_complete';
  if want is null then return null; end if;
  select count(*) into got  from geo.zip_authoritative_membership m where m.zcta5 = z;
  select count(*) into expect from geo.n5_boundary_membership b where b.zcta5 = z;
  if got <> want then
    raise exception 'UNIT A INVARIANT: zip % is boundary_complete with % shadow membership rows, declared %', z, got, want;
  end if;
  if want <> expect then
    raise exception 'UNIT A INVARIANT: zip % declares % rows but authoritative membership holds %', z, want, expect;
  end if;
  return null;
end $fn$;
create constraint trigger zz_shadow_complete_status
  after insert or update on geo.maps_zip_geography_status
  deferrable initially deferred
  for each row execute function geo.n5_assert_shadow_complete();

-- ---------------------------------------------------------------- LIVE: expected input
create or replace function public.n5_expected_captured(p_snapshot_id text)
 returns table(source_key text, zip text, source_seq smallint, registry_id text, lat double precision, lng double precision, app_project_id uuid)
 language sql
 stable
as $function$
  select i.source_key, i.zip, i.source_seq, i.registry_id, i.lat, i.lng, i.app_project_id
    from preservation.app_project_identity i
   where i.snapshot_id = p_snapshot_id
     and i.record_kind = 'development'
     and i.source_key is not null
     and i.zip is not null
     and i.zip ~ '^[0-9]{5}$'
     and split_part(i.source_key, ':', 1) <> 'epa_frs';
$function$;

-- STUB: the live integrity checks read app_projects at production scale; the suite's
-- subject is publication, so this returns the live signature with every check passing.
create or replace function public.n5_expected_input_integrity()
 returns table(check_name text, ok boolean, detail text)
 language sql stable
as $$ select 'fixture_stub'::text, true, 'integrity checks are not the subject of this suite'::text $$;

-- ---------------------------------------------------------------- LIVE: reconcile (pre-migration — cross-prefix defect)
CREATE OR REPLACE FUNCTION geo.n5_reconcile_chunk(p_generation_id text, p_chunk_key text)
 RETURNS geo.n5_generation_reconcile
 LANGUAGE plpgsql
 SET search_path TO 'geo', 'public', 'pg_temp'
AS $function$
declare
  g     geo.n5_generation;
  out   geo.n5_generation_reconcile;
  n_cap bigint;
  lo    text;
  hi    text;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id;
  if not found then
    raise exception 'n5_reconcile_chunk: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if p_chunk_key !~ '^[0-9]{1,5}$' then
    raise exception 'n5_reconcile_chunk: chunk_key must be a ZIP prefix, got %', p_chunk_key using errcode = '22023';
  end if;
  lo := rpad(p_chunk_key, 5, '0');
  hi := rpad(p_chunk_key, 5, '9');
  select count(*) into n_cap
    from preservation.app_project_identity i
   where i.snapshot_id = g.snapshot_id and i.record_kind = 'development';
  if n_cap = 0 then
    raise exception 'n5_reconcile_chunk: generation % has no captured expected set for snapshot % — refusing a vacuous chunk',
      p_generation_id, g.snapshot_id using errcode = '22023';
  end if;
  with expected as (
    select distinct e.source_key
      from public.n5_expected_captured(g.snapshot_id) e
     where e.zip >= lo and e.zip <= hi
  ),
  resolved as (
    select distinct m.source_key
      from geo.zip_authoritative_membership m
     where m.generation_id = p_generation_id
       and m.record_kind = 'development'
       and m.zcta5 >= lo and m.zcta5 <= hi
  ),
  unres as (
    select distinct u.source_key
      from geo.n5_generation_unresolved u
     where u.generation_id = p_generation_id
       and u.zip is not null and u.zip >= lo and u.zip <= hi
  )
  insert into geo.n5_generation_reconcile as r
    (generation_id, chunk_key, expected_keys, accounted_resolved, accounted_unresolved, unaccounted, computed_at)
  select p_generation_id, p_chunk_key,
         (select count(*) from expected),
         (select count(*) from expected x where exists (select 1 from resolved v where v.source_key = x.source_key)),
         (select count(*) from expected x where exists (select 1 from unres   v where v.source_key = x.source_key)),
         (select count(*) from expected x
           where not exists (select 1 from resolved v where v.source_key = x.source_key)
             and not exists (select 1 from unres   v where v.source_key = x.source_key)),
         now()
  on conflict (generation_id, chunk_key) do update
    set expected_keys        = excluded.expected_keys,
        accounted_resolved   = excluded.accounted_resolved,
        accounted_unresolved = excluded.accounted_unresolved,
        unaccounted          = excluded.unaccounted,
        computed_at          = excluded.computed_at
  returning * into out;
  return out;
end
$function$;

-- ---------------------------------------------------------------- LIVE: activate (pre-migration)
CREATE OR REPLACE FUNCTION geo.n5_generation_activate(p_generation_id text, p_expected_chunks text[])
 RETURNS geo.n5_generation
 LANGUAGE plpgsql
 SET search_path TO 'geo', 'public', 'pg_temp'
AS $function$
declare
  g            geo.n5_generation;
  n_chunks     int;
  n_missing    int;
  n_unaccount  bigint;
  n_expected   bigint;
  integ        record;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id for update;
  if not found then
    raise exception 'activate: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if g.state <> 'READY' then
    raise exception 'activate: generation % is %, not READY', p_generation_id, g.state using errcode = '22023';
  end if;
  if p_expected_chunks is null or array_length(p_expected_chunks, 1) is null then
    raise exception 'activate: no expected chunk set declared' using errcode = '22023';
  end if;
  n_chunks := array_length(p_expected_chunks, 1);
  select count(*) into n_missing
    from unnest(p_expected_chunks) c(k)
   where not exists (select 1 from geo.n5_generation_reconcile r
                      where r.generation_id = p_generation_id and r.chunk_key = c.k);
  if n_missing > 0 then
    raise exception 'activate: % of % declared chunks have no reconciliation row', n_missing, n_chunks using errcode = '22023';
  end if;
  select coalesce(sum(r.unaccounted), 0), coalesce(sum(r.expected_keys), 0)
    into n_unaccount, n_expected
    from geo.n5_generation_reconcile r
   where r.generation_id = p_generation_id
     and r.chunk_key = any (p_expected_chunks);
  if n_unaccount > 0 then
    raise exception 'activate: INV-1 violated — % of % expected source_keys have no accounted outcome', n_unaccount, n_expected using errcode = '22023';
  end if;
  if n_expected = 0 then
    raise exception 'activate: reconciliation covered 0 expected records — refusing a vacuous pass' using errcode = '22023';
  end if;
  for integ in select * from public.n5_expected_input_integrity() loop
    if not integ.ok then
      raise exception 'activate: source integrity check % failed — %', integ.check_name, integ.detail using errcode = '22023';
    end if;
  end loop;
  update geo.n5_generation
     set state = 'SUPERSEDED', superseded_at = now()
   where state in ('ACTIVE','ACTIVE_LEGACY') and generation_id <> p_generation_id;
  update geo.n5_generation
     set state = 'ACTIVE', activated_at = now()
   where generation_id = p_generation_id
  returning * into g;
  return g;
end
$function$;

-- ---------------------------------------------------------------- LIVE: the Map 1 ZIP-mode read
CREATE OR REPLACE FUNCTION public.app_zip_projects_markers(p_zip text, p_kind text DEFAULT 'development'::text, p_authoritative boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'geo', 'pg_temp'
 SET statement_timeout TO '25s'
AS $function$
declare
  v_projects jsonb;
  v_markers  jsonb;
  v_status   text;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then
    raise exception 'invalid zip' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('development', 'facility') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;

  if not p_authoritative then
    select coalesce(jsonb_agg(
             s.j || jsonb_build_object('project_ref', s.ref)
             order by s.k_date desc nulls last, s.k_name asc nulls last, s.k_id), '[]'::jsonb)
      into v_projects
      from (select to_jsonb(p) as j,
                   coalesce(p.source_key, '') || '#' || coalesce(p.source_seq, 0)::text as ref,
                   case when p_kind = 'facility' then null else p.submitted_at end as k_date,
                   case when p_kind = 'facility' then p.name else null end as k_name,
                   p.id as k_id
              from public.app_projects p
             where p.zip = p_zip and p.record_kind = p_kind) s;

    select coalesce(jsonb_agg(jsonb_build_object(
             'project_ref', coalesce(p.source_key, '') || '#' || coalesce(p.source_seq, 0)::text,
             'marker_seq', 1, 'lat', p.lat, 'lng', p.lng,
             'marker_rule', 'LEGACY_ROW_POINT') order by p.id), '[]'::jsonb)
      into v_markers
      from public.app_projects p
     where p.zip = p_zip and p.record_kind = p_kind
       and p.lat is not null and p.lng is not null;

    return jsonb_build_object('mode', 'legacy', 'zip', p_zip, 'status', 'legacy',
                              'projects', v_projects, 'markers', v_markers);
  end if;

  select s.status into v_status
    from geo.maps_zip_geography_status s where s.zip = p_zip;

  -- The absence of authoritative geography must NEVER read as an authoritative zero.
  -- facility geography for this ZIP does not exist yet: say so, never a measured zero.
  if p_kind = 'facility' and not exists (
       select 1 from geo.zip_authoritative_membership mm
        where mm.zcta5 = p_zip and mm.record_kind = 'facility') then
    v_status := 'not_measured';
  end if;

  if v_status is distinct from 'boundary_complete' then
    return jsonb_build_object('mode', 'authoritative', 'zip', p_zip,
                              'status', coalesce(v_status, 'unknown'),
                              'projects', null, 'markers', null);
  end if;

  -- One project per (ZIP, source_key) membership; the descriptive row is the lowest stable id.
  -- The field set is a CONTRACT - see docs/n5-unit-a4-delivery-contract.sql and
  -- test/zip-auth-rpc-field-contract.test.mjs. type_raw is in it because Rule 5 reads it.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'project_ref', a.source_key,
             'name', a.name, 'type', a.type, 'type_raw', a.type_raw,
             'status', a.status, 'submitted_at', a.submitted_at,
             'date_kind', a.date_kind, 'source_ref', a.source_ref,
             'registry_id', a.registry_id,
             'impact_score', a.impact_score, 'impact_dimensions', a.impact_dimensions)
           order by a.submitted_at desc nulls last, a.id), '[]'::jsonb)
    into v_projects
    from geo.zip_authoritative_membership mm
    join lateral (
      select mm.source_key, p.id, p.name, p.type, p.type_raw, p.status,
             p.submitted_at, p.date_kind, p.source_ref, p.registry_id,
             p.impact_score, p.impact_dimensions
        from public.app_projects p
       where p.source_key = mm.source_key
         and p.record_kind = p_kind
       order by p.id asc
       limit 1) a on true
   where mm.zcta5 = p_zip and mm.record_kind = p_kind;

  select coalesce(jsonb_agg(jsonb_build_object(
           'project_ref', k.source_key, 'marker_seq', k.marker_seq,
           'lat', k.lat, 'lng', k.lng, 'marker_rule', k.marker_rule)
           order by k.source_key, k.marker_seq), '[]'::jsonb)
    into v_markers
    from geo.zip_authoritative_marker k
   where k.zcta5 = p_zip and k.record_kind = p_kind;

  return jsonb_build_object('mode', 'authoritative', 'zip', p_zip,
                            'status', v_status,
                            'membership_count', (select count(*) from geo.zip_authoritative_membership mm where mm.zcta5 = p_zip and mm.record_kind = p_kind),
                            'marker_count', jsonb_array_length(v_markers),
                            'project_count', jsonb_array_length(v_projects),
                            'projects', v_projects, 'markers', v_markers);
end
$function$;
grant execute on function public.app_zip_projects_markers(text, text, boolean) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- LIVE: the community-page authoritative read
CREATE OR REPLACE FUNCTION public.app_authoritative_projects_for_zip(p_zip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'geo', 'pg_temp'
AS $function$
declare
  v_out        jsonb;
  v_zip        char(5);
  n_membership int;
  n_projects   int;
  n_markers    int;
  n_expected_k int;
  n_bad        int;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then
    raise exception 'invalid zip' using errcode = '22023';
  end if;

  v_zip := p_zip;

  select count(*) into n_membership
    from geo.zip_authoritative_membership where zcta5 = v_zip;
  select count(*) into n_expected_k
    from geo.zip_authoritative_marker where zcta5 = v_zip;

  with m as (
    select mm.source_key, mm.lat, mm.lng, mm.point_rule
      from geo.zip_authoritative_membership mm
     where mm.zcta5 = v_zip),
  k as (
    select kk.source_key,
           jsonb_agg(jsonb_build_object('marker_seq', kk.marker_seq, 'lat', kk.lat,
                                        'lng', kk.lng, 'marker_rule', kk.marker_rule)
                     order by kk.marker_seq) as markers,
           count(*) as n
      from geo.zip_authoritative_marker kk
     where kk.zcta5 = v_zip
     group by kk.source_key)
  select coalesce(jsonb_agg(
           coalesce(to_jsonb(a.*), '{}'::jsonb)
             || jsonb_build_object(
                  'zip', p_zip, 'lat', m.lat, 'lng', m.lng,
                  'source_key', m.source_key, 'project_ref', m.source_key,
                  'authoritative', true, 'point_rule', m.point_rule,
                  'attributes_missing', (a.source_key is null),
                  'name', a.name, 'type', a.type, 'status', a.status, 'stage', a.stage,
                  'submitted_at', a.submitted_at, 'address', a.address,
                  'developer', a.developer, 'scope_text', a.scope_text,
                  'source_ref', a.source_ref, 'registry_id', a.registry_id,
                  '_markers', coalesce(k.markers, '[]'::jsonb))
           order by a.submitted_at desc nulls last, a.id, m.source_key), '[]'::jsonb),
         count(*), coalesce(sum(k.n), 0)
    into v_out, n_projects, n_markers
    from m
    left join lateral (
      select p.* from public.app_projects p
       where p.source_key = m.source_key and p.record_kind = 'development'
       order by p.id asc limit 1) a on true
    left join k on k.source_key = m.source_key;

  if n_projects <> n_membership then
    raise exception 'AUTHORITATIVE INVARIANT: zip % returned % projects for % memberships',
      p_zip, n_projects, n_membership using errcode = 'data_exception';
  end if;
  if n_markers <> n_expected_k then
    raise exception 'AUTHORITATIVE INVARIANT: zip % returned % markers, relation holds %',
      p_zip, n_markers, n_expected_k using errcode = 'data_exception';
  end if;
  select count(*) into n_bad from jsonb_array_elements(v_out) e
   where coalesce(e->>'source_key','') = ''
      or not (e ? 'name' and e ? 'type' and e ? 'status' and e ? 'stage'
              and e ? 'submitted_at' and e ? 'address' and e ? 'developer'
              and e ? 'scope_text' and e ? 'source_ref' and e ? 'registry_id');
  if n_bad > 0 then
    raise exception 'AUTHORITATIVE INVARIANT: zip % has % project(s) missing required fields',
      p_zip, n_bad using errcode = 'data_exception';
  end if;
  select count(*) into n_bad from (
    select e->>'source_key' sk from jsonb_array_elements(v_out) e group by 1 having count(*) > 1) d;
  if n_bad > 0 then
    raise exception 'AUTHORITATIVE INVARIANT: zip % has % duplicate project source_key(s)',
      p_zip, n_bad using errcode = 'data_exception';
  end if;
  select count(*) into n_bad from (
    select e->>'source_key' sk, mk->>'marker_seq' ms
      from jsonb_array_elements(v_out) e, jsonb_array_elements(e->'_markers') mk
     group by 1,2 having count(*) > 1) d;
  if n_bad > 0 then
    raise exception 'AUTHORITATIVE INVARIANT: zip % has % duplicate (source_key, marker_seq)',
      p_zip, n_bad using errcode = 'data_exception';
  end if;

  return v_out;
end
$function$;

-- ---------------------------------------------------------------- LIVE: the community-page gate
CREATE OR REPLACE FUNCTION public.app_projects_for_zip(p_zip text, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'geo', 'pg_temp'
AS $function$
declare
  v jsonb;
  v_status text;
begin
  if p_kind = 'development' then
    select s.status into v_status
      from geo.maps_zip_geography_status s
     where s.zip = p_zip;

    if coalesce(v_status, '') <> 'boundary_complete' then
      return jsonb_build_object(
        'unavailable', true,
        'zip_geography_status', coalesce(v_status, 'unknown'),
        'projects', null);
    end if;

    if exists (select 1 from public.app_zip_geography_cutover c
                where c.zip = p_zip and c.enabled) then
      return public.app_authoritative_projects_for_zip(p_zip);
    end if;

    return jsonb_build_object(
      'unavailable', true,
      'zip_geography_status', 'boundary_complete_not_cut_over',
      'projects', null);
  end if;

  select coalesce(jsonb_agg(s.j order by s.k_date desc nulls last, s.k_name asc nulls last, s.k_id), '[]'::jsonb)
    into v
  from (
    select to_jsonb(p) as j,
           case when p_kind = 'facility' then null else p.submitted_at end as k_date,
           case when p_kind = 'facility' then p.name else null end       as k_name,
           p.id                                                          as k_id
    from public.app_projects p
    where p.zip = p_zip
      and p.record_kind = p_kind
      and p_kind in ('development', 'facility')
  ) s;
  return v;
end
$function$;

-- ---------------------------------------------------------------- LIVE: resident-facing geography state (granted to anon)
create view public.app_zip_geography_state as
 SELECT r.zip,
        CASE
            WHEN (c.enabled AND (c.production_geography_verified_at IS NOT NULL)) THEN 'authoritative'::text
            WHEN (s.status = 'not_measured'::text) THEN 'not_measured'::text
            ELSE 'pending'::text
        END AS geography_state
   FROM ((canonical_zip_registry r
     LEFT JOIN app_zip_geography_cutover c ON (((c.zip)::text = r.zip)))
     LEFT JOIN geo.maps_zip_geography_status s ON (((s.zip)::text = r.zip)));
grant select on public.app_zip_geography_state to anon, authenticated, service_role;

-- ---------------------------------------------------------------- STUBS: readers the splice must reach
-- Minimal bodies with the live signatures. The live dc_resident_lineage_ledger carries
-- security_invoker=true, so the stub does too: the splice must preserve it.
create view public.dc_resident_lineage_ledger with (security_invoker = true) as
  select s.zip from geo.maps_zip_geography_status s where s.status = 'boundary_complete';

create or replace function geo.refresh_maps_zip_export() returns table(zips integer, bucket_sum integer)
language sql stable as $$ select count(*)::int, count(*)::int from geo.maps_zip_geography_status s $$;
create or replace function geo.n5_shadow_projects_for_zip(p_zip text, p_kind text) returns jsonb
language sql stable as $$ select to_jsonb(count(*)) from geo.zip_authoritative_membership m where m.zcta5 = p_zip $$;
create or replace function geo.n5_a3_projects_one_pass(p_zip text) returns jsonb
language sql stable as $$ select to_jsonb(count(*)) from geo.zip_authoritative_membership m where m.zcta5 = p_zip $$;
create or replace function geo.n5_a3_bench_one(p_zip text, p_pass integer, p_run text) returns void
language sql as $$ select from geo.zip_authoritative_marker k where k.zcta5 = p_zip limit 1 $$;
create or replace function geo.n5_authoritative_test_for_zip(p_zip text) returns jsonb
language sql stable as $$ select to_jsonb(count(*)) from geo.zip_authoritative_marker k where k.zcta5 = p_zip $$;

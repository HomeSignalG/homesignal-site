-- ============================================================================
-- UNIT A — the authoritative SHADOW read product. DDL of record.
-- Applied 2026-09-03 from scripts/n5_unit_a_shadow.py (workflow mode `n5-unit-a`),
-- parked here per CLAUDE.md §1 source-of-truth #3.
--
-- WHAT IT IS. For every canonical ZIP inside a COMPLETED acquisition prefix it records
-- (a) which development projects authoritative geometry places on that ZIP page and
-- (b) ONE deterministic representative point per (ZIP, project), derived from that
-- project's geometry clipped to that ZCTA.
--
-- WHAT IT IS NOT. It does not touch public.app_projects_for_zip (read_path_md5 stays
-- ec1b01ae4485ad2c59b9f946c9d565b6), any page, the sitemap, indexability, the canonical
-- ZIP registry, geo.n5_association, geo.n5_boundary_membership or geo.n5_geom.
--
-- WHY IT LIVES IN `geo` RATHER THAN `public`. The design proposed public relations for
-- the eventual cutover. Unit A is tighter on purpose: schema `geo` has ZERO grants to
-- anon/authenticated/PUBLIC and those roles have no USAGE on it, so the shadow product
-- is unreachable from a browser BY CONSTRUCTION rather than by a policy someone could
-- edit later. Exposing it is then a deliberate, reviewable act inside Unit B.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The representative-point rule. ONE implementation, so no caller can drift from it.
-- Deterministic by construction: every choice is broken by an explicit ORDER BY.
--
-- WHY THE POINT IS DERIVED AND NEVER BORROWED FROM app_projects: `source_seq` is a
-- PER-ZIP ordinal, not a stable identity for a part of a multi-coordinate project.
-- Measured over the authoritative corpus, 5,116 of 7,136 (source_key, source_seq)
-- groups carry MORE THAN ONE coordinate across ZIPs (max 35), while only 2 disagree on
-- name. Descriptive attributes are safely borrowable across ZIPs; the coordinate is not.
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
    pt := ST_PointOnSurface(c);          -- INSIDE the polygon; a centroid need not be
    rule := 'POLYGON_POINT_ON_SURFACE';
  elsif d = 1 then
    c := ST_CollectionExtract(g, 2);
    if c is null or ST_IsEmpty(c) then pt := null; rule := 'EMPTY_CLIP'; return next; return; end if;
    select ST_LineInterpolatePoint(dmp.geom, 0.5) into pt
      from ST_Dump(c) dmp
     order by ST_Length(dmp.geom) desc, ST_AsBinary(dmp.geom) asc
     limit 1;                            -- ON the line, half way along its longest clipped part
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
revoke all on function geo.n5_rep_point(geometry) from public;   -- Postgres grants EXECUTE to
-- PUBLIC by default on every new function. anon/authenticated have no USAGE on `geo`, so this
-- was unreachable either way — but a default grant left in place is how a hole appears the day
-- someone grants schema usage for an unrelated reason.

-- ---------------------------------------------------------------------------
create table if not exists geo.zip_authoritative_membership (
  zcta5         char(5) not null,
  source_key    text    not null,
  lat           double precision,        -- NULL is allowed and reported, never guessed
  lng           double precision,
  point_rule    text    not null,        -- which branch above produced the point
  clip_dim      smallint,                -- dimension of the clipped geometry
  feature_count integer not null,        -- how many n5_geom features contributed
  geom_family   text    not null,        -- ST_MultiLineString | ST_MultiPolygon | ST_Point
  run_id        text    not null,
  computed_at   timestamptz not null default now(),
  primary key (zcta5, source_key)        -- duplication is impossible by construction
);
alter table geo.zip_authoritative_membership enable row level security;

create table if not exists geo.maps_zip_geography_status (
  zip             char(5) primary key,
  status          text not null check (status in ('boundary_complete','not_measured')),
  membership_rows integer not null check (membership_rows >= 0),
  completed_at    timestamptz,
  run_id          text,
  note            text                   -- e.g. NO_ZCTA_IN_TIGER_2025
);
alter table geo.maps_zip_geography_status enable row level security;

-- ---------------------------------------------------------------------------
-- THE ATOMIC-COMPLETION INVARIANT.
-- A measured ZERO is a VALID complete state (27 ZIPs have one), so "complete implies
-- rows exist" would be the wrong invariant and would reject honest data. What is right:
-- a completed ZIP's shadow count must EQUAL what the authoritative membership holds.
-- DEFERRABLE INITIALLY DEFERRED, so a partial load fails at COMMIT rather than being
-- visible in between.
create or replace function geo.n5_assert_shadow_complete() returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare z char(5); want int; got int; expect int;
begin
  z := coalesce(new.zip, old.zip);
  select s.membership_rows into want from geo.maps_zip_geography_status s
   where s.zip = z and s.status = 'boundary_complete';
  if want is null then return null; end if;
  select count(*) into got from geo.zip_authoritative_membership m where m.zcta5 = z;
  select count(*) into expect from geo.n5_boundary_membership b where b.zcta5 = z;
  if got <> want then
    raise exception 'UNIT A INVARIANT: zip % is boundary_complete with % shadow membership rows, declared %', z, got, want;
  end if;
  if want <> expect then
    raise exception 'UNIT A INVARIANT: zip % declares % rows but authoritative membership holds %', z, want, expect;
  end if;
  return null;
end $fn$;
revoke all on function geo.n5_assert_shadow_complete() from public;

drop trigger if exists zz_shadow_complete_status on geo.maps_zip_geography_status;
create constraint trigger zz_shadow_complete_status
  after insert or update on geo.maps_zip_geography_status
  deferrable initially deferred
  for each row execute function geo.n5_assert_shadow_complete();

-- ---------------------------------------------------------------------------
-- THE SHADOW READ. Same logical shape as public.app_projects_for_zip's development
-- branch, WITHOUT touching that function.
--
-- IT NEVER FALLS BACK. For a not-measured ZIP it reports the status and returns
-- records:null — it does not run the legacy query to make comparison convenient. The
-- comparison harness queries production separately, which is the only way the two
-- answers stay independent.
--
-- Descriptive fields are borrowed from ONE deterministically chosen app_projects row
-- (last_seen_at desc, id asc). Measured: 1,791 of 1,875 authoritative projects have a
-- single descriptive variant; the 84 that differ are resolved uniquely by that rule
-- (0 residual ties, 0 NULL last_seen_at). `zip`, `lat` and `lng` are OVERRIDDEN from
-- the authoritative membership, never carried from the borrowed row.
create or replace function geo.n5_shadow_projects_for_zip(p_zip text, p_kind text)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $fn$
declare st text; want int; got int; res jsonb;
begin
  if p_kind is distinct from 'development' then
    raise exception 'UNIT A: only p_kind=development is in scope; facilities are untouched';
  end if;
  select s.status, s.membership_rows into st, want
    from geo.maps_zip_geography_status s where s.zip = p_zip;
  if st is null then st := 'not_measured'; end if;
  if st <> 'boundary_complete' then
    return jsonb_build_object('status', st, 'records', null);
  end if;
  select count(*) into got from geo.zip_authoritative_membership m where m.zcta5 = p_zip;
  if got <> want then
    raise exception 'UNIT A FAIL-CLOSED: zip % declares % authoritative rows, shadow holds %', p_zip, want, got;
  end if;
  select coalesce(jsonb_agg(x.j order by x.k_date desc nulls last, x.k_id), '[]'::jsonb) into res
  from (
    select to_jsonb(a.*)
             || jsonb_build_object('zip', p_zip, 'lat', m.lat, 'lng', m.lng,
                                   'authoritative', true, 'point_rule', m.point_rule,
                                   'attributes_missing', (a.id is null)) as j,
           a.submitted_at as k_date, a.id as k_id
      from geo.zip_authoritative_membership m
      left join lateral (
        select p.* from public.app_projects p
         where p.source_key = m.source_key and p.record_kind = 'development'
         order by p.last_seen_at desc nulls last, p.id asc
         limit 1
      ) a on true
     where m.zcta5 = p_zip
  ) x;
  return jsonb_build_object('status', 'boundary_complete', 'records', res);
end $fn$;
revoke all on function geo.n5_shadow_projects_for_zip(text,text) from public;

-- ---------------------------------------------------------------------------
-- RECEIPTS, 2026-09-03 (run 33780955987, 64 s; idempotency re-run 33781557995):
--   428 canonical ZIPs in the 13 completed prefixes
--     = 364 boundary_complete (337 with membership + 27 measured zero)
--     +  64 not_measured, note NO_ZCTA_IN_TIGER_2025
--   5,845 membership rows / 1,875 projects; 0 points unresolved; 0 missing attributes
--   point rules: POLYGON_POINT_ON_SURFACE 3,312 · LINE_MIDPOINT_LONGEST 2,532 · POINT_MIN_XY 1
--   membership md5 ff09ed6d59b3a436bf0a8c9ca6f5eaa9 · order-free sum 12606586842651
--   status md5     66abb4e62d60f95cc9eb81ae66d33a81
--   sizes: membership 1,432 kB · status 104 kB · scratch dropped
--
-- ROLLBACK (Unit A leaves nothing to undo elsewhere):
--   drop function if exists geo.n5_shadow_projects_for_zip(text,text);
--   drop trigger if exists zz_shadow_complete_status on geo.maps_zip_geography_status;
--   drop table if exists geo.zip_authoritative_membership;
--   drop table if exists geo.maps_zip_geography_status;
--   drop function if exists geo.n5_assert_shadow_complete();
--   drop function if exists geo.n5_rep_point(geometry);

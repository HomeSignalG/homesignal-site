-- =====================================================================================
-- ZIP MEMBERSHIP — EXECUTABLE ADVERSARIAL SUITE (docs/zip-membership-canonical.sql)
--
-- Runs the SHIPPED functions (the canonical predicate and the national ZIP-mode read). Every expected answer below is a
-- HARD-CODED constant derived from the synthetic polygon's geometry by hand, never computed
-- by the code under test. Output: one row per check in _zm_result (check, pass, detail).
--
-- THE SYNTHETIC ZIP (SRID 4269). A 0.4° x 0.4° square (~21 x 28 mi) with a rectangular NOTCH
-- cut from its east edge into the centre, so proximity and membership DISAGREE:
--
--   (-100.00,40.40) ┌──────────────────┐ (-99.60,40.40)
--                   │                  │
--                   │        C ┌───────┘ 40.22       C = (-99.80, 40.20), the "home"
--                   │         B│  NOTCH               centre a radius rule would use
--                   │          └───────┐ 40.18
--                   │                  │
--   (-100.00,40.00) └──────────────────┘ (-99.60,40.00)
--                                 x = -99.82 is the notch's west wall
--
--   A (-99.98, 40.38)  INSIDE,  12.4 mi from C  -> member   (a 5-mile rule EXCLUDES it)
--   B (-99.79, 40.20)  OUTSIDE (in the notch), 0.53 mi from C -> outside (a 5-mile rule ADMITS it)
--   E (-100.00, 40.10) ON the west edge          -> member   (boundary-inclusive contract)
--   D (-99.00, 41.00)  far outside               -> outside
--   N  no coordinates                            -> no_coordinates
-- =====================================================================================

create temp table if not exists _zm_result (n serial, check_name text, pass boolean, detail text);
truncate _zm_result;

create temp table if not exists _zm_poly as
select ST_Multi(ST_GeomFromText(
  'POLYGON((-100 40, -99.6 40, -99.6 40.18, -99.82 40.18, -99.82 40.22, -99.6 40.22, -99.6 40.4, -100 40.4, -100 40))',
  4269))::geometry(MultiPolygon, 4269) as geom;

create temp table if not exists _zm_pts (k text primary key, lat double precision, lng double precision, want text);
truncate _zm_pts;
insert into _zm_pts values
  ('A', 40.38, -99.98,  'member'),
  ('B', 40.20, -99.79,  'outside'),
  ('E', 40.10, -100.00, 'member'),
  ('D', 41.00, -99.00,  'outside'),
  ('N', null,  null,    'no_coordinates');

-- ── 0. THE PREMISE: the suite discriminates membership from proximity. Distances use an
--    independent haversine written HERE (not the code under test) from the hard-coded centre.
insert into _zm_result(check_name, pass, detail)
select 'P0 premise: A is >5 mi from the centre and B is <5 mi from it',
       a_mi > 5 and b_mi < 5, format('A=%s mi B=%s mi', round(a_mi::numeric,2), round(b_mi::numeric,2))
  from (select
    3958.8*2*asin(sqrt(power(sin(radians(40.38-40.20)/2),2)+cos(radians(40.20))*cos(radians(40.38))*power(sin(radians(-99.98+99.80)/2),2))) a_mi,
    3958.8*2*asin(sqrt(power(sin(radians(40.20-40.20)/2),2)+cos(radians(40.20))*cos(radians(40.20))*power(sin(radians(-99.79+99.80)/2),2))) b_mi) q;

-- ── 1. THE PREDICATE, directly.
insert into _zm_result(check_name, pass, detail)
select 'T1 predicate ' || p.k || ' -> ' || p.want,
       geo.zip_point_membership_in(z.geom, p.lat, p.lng) is not distinct from p.want,
       geo.zip_point_membership_in(z.geom, p.lat, p.lng)
  from _zm_pts p, _zm_poly z;

insert into _zm_result(check_name, pass, detail)
select 'T1b no boundary is not_measured for every point that has coordinates',
       bool_and(geo.zip_point_membership_in(null, p.lat, p.lng) = 'not_measured'), null
  from _zm_pts p where p.lat is not null;

-- ── 2. THE BOUNDARY ACCESSOR + by-ZIP form, on the configured ZIPs.
-- UPDATE-then-INSERT, never an upsert: production's table carries further NOT NULL provenance
-- columns, so a production run (inside a rolled-back transaction) must only ever UPDATE an
-- existing row's geometry, while the disposable fixture has no row and takes the INSERT.
update geo.zcta_boundary b set geom = z.geom from _zm_cfg c, _zm_poly z where b.zcta5 = c.zip_with;
insert into geo.zcta_boundary (zcta5, geom)
select c.zip_with, z.geom from _zm_cfg c, _zm_poly z
 where not exists (select 1 from geo.zcta_boundary b where b.zcta5 = c.zip_with);
delete from geo.zcta_boundary where zcta5 = (select zip_without from _zm_cfg);

insert into _zm_result(check_name, pass, detail)
select 'T2 by-ZIP ' || p.k || ' -> ' || p.want,
       geo.zip_point_membership(c.zip_with, p.lat, p.lng) is not distinct from p.want,
       geo.zip_point_membership(c.zip_with, p.lat, p.lng)
  from _zm_pts p, _zm_cfg c;
insert into _zm_result(check_name, pass, detail)
select 'T2b a ZIP with no boundary is not_measured — never a radius substitute',
       geo.zip_point_membership(c.zip_without, 40.38, -99.98) = 'not_measured'
   and geo.zip_point_membership(c.zip_without, 40.20, -99.79) = 'not_measured',
       geo.zip_point_membership(c.zip_without, 40.20, -99.79)
  from _zm_cfg c;

-- ── 3. THE NATIONAL PLANE — retrieval by polygon extent, membership by the predicate.
delete from public.national_dc_records where source_key like 'zmtest:%';
insert into public.national_dc_records
  (source_name, source_key, source_record_id, osm_type, source_url, project_name, raw_status,
   normalized_status, project_type, lat, lng, location_precision, map_eligible)
select s.name, 'zmtest:' || s.name || ':' || p.k, p.k, 'way', 'https://example.test/n/' || p.k,
       'DC ' || p.k, 'operational', 'operational', s.ptype, p.lat, p.lng, 'precise_location', true
  from _zm_pts p, (values ('OpenStreetMap','datacenter'), ('Compute Atlas','hyperscale campus'),
                          ('Epoch AI','ai datacenter'), ('Future Feed','zz-future-type')) s(name, ptype)
 where p.k in ('A','B','E','D');
-- an INELIGIBLE record inside the polygon must never be served
insert into public.national_dc_records
  (source_key, source_record_id, osm_type, source_url, raw_status, normalized_status, lat, lng,
   location_precision, map_eligible, map_exclusion_reason)
values ('zmtest:ineligible:A', 'A', 'way', 'https://example.test/n/x', 'planned', 'planned', 40.38, -99.98,
        'precise_location', false, 'suite: ineligible control');

create temp table if not exists _zm_natl as select * from public.national_dc_zip_members('00000') limit 0;
truncate _zm_natl;
insert into _zm_natl select n.* from _zm_cfg c, lateral public.national_dc_zip_members(c.zip_with) n
 where n.source_key like 'zmtest:%';

insert into _zm_result(check_name, pass, detail)
select 'T5 national: A (inside, 12.4 mi out) and E (edge) served from EVERY source; B and D never',
       (select string_agg(source_key, ',' order by source_key collate "C") from _zm_natl) =
       'zmtest:Compute Atlas:A,zmtest:Compute Atlas:E,zmtest:Epoch AI:A,zmtest:Epoch AI:E,zmtest:Future Feed:A,zmtest:Future Feed:E,zmtest:OpenStreetMap:A,zmtest:OpenStreetMap:E',
       (select string_agg(source_key, ',' order by source_key collate "C") from _zm_natl);
insert into _zm_result(check_name, pass, detail)
select 'T5b national: every served row carries verdict member and NO distance',
       bool_and(zip_membership = 'member' and distance_mi is null) and count(*) > 0, count(*)::text
  from _zm_natl;
insert into _zm_result(check_name, pass, detail)
select 'T5c national: an ineligible record is never served',
       not exists (select 1 from _zm_natl where source_key = 'zmtest:ineligible:A'), null;
insert into _zm_result(check_name, pass, detail)
select 'T5d national: a ZIP with no boundary serves NOTHING (Fix 29 — not a circle)',
       not exists (select 1 from _zm_cfg c, lateral public.national_dc_zip_members(c.zip_without) n
                    where n.source_key like 'zmtest:%'), null;

-- A check that evaluates to NULL is a FAILURE, never a silent non-answer (a bool_and over
-- absent stamps is NULL — measured: that is how the Fix-28-only mutation first slipped a check).
select check_name, coalesce(pass, false) as pass, detail from _zm_result order by n;

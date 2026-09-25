-- =====================================================================================
-- ATLAS COORDINATE VALIDATION — A PUBLISHER'S OWN ADDRESS CHECKS ITS OWN POINT
-- Exercises the SHIPPED chain end to end on a DISPOSABLE PostGIS (never production):
--   docs/dc-step3d-derived-location.sql, docs/dc-step3a-canonical-identity.sql,
--   docs/dc-step3b-canonical-geography.sql, docs/map1-dc-publication.sql and the writer's own
--   queue + load SQL (psql variables :queuesql, :loadsql, :qfile).
-- Every fixture is an ATLAS-ONLY facility (no other source states its address), i.e. exactly the
-- population #1324 left unvalidated. One Epoch record sits nearby as an identity control.
-- Two deployments, checked separately:
--   PHASE A  Atlas derivations are ACQUIRED (queued, derived, loaded) but the extraction is NOT
--            admitted: every canonical decision, every Map 1 row and every identity row must be
--            byte-identical to the state with no Atlas derivation at all.
--   PHASE D  the reviewed admission is simulated (the suite redefines dc_derived_address_admitted
--            exactly as the one-line production switch would): the SAME general rules decide.
-- Expected answers are HARD-CODED constants. Fixture names live HERE only.
-- Output: one row per check (check|pass|detail); a NULL pass is a failure.
-- =====================================================================================
\set ON_ERROR_STOP 1
create temp table if not exists _r (n serial, check_name text, pass boolean, detail text);
truncate _r;

-- ── ZCTAs (SRID 4269) ────────────────────────────────────────────────────────────────
-- 99921 / 99924: ONE square split along its diagonal, so each triangle's bounding box contains the
-- other triangle (a membership rule that is not the polygon publishes on the wrong page).
-- 99922: a square with a HOLE that belongs to no ZCTA (a nearest-ZIP rule would fill it).
delete from geo.zcta_boundary;
insert into geo.zcta_boundary (zcta5, geom) values
 ('99921', ST_Multi(ST_GeomFromText('POLYGON((-100.3 45,-100.0 45,-100.0 45.3,-100.3 45))', 4269))),
 ('99924', ST_Multi(ST_GeomFromText('POLYGON((-100.3 45,-100.0 45.3,-100.3 45.3,-100.3 45))', 4269))),
 ('99922', ST_Multi(ST_GeomFromText('POLYGON((-100 45,-99.7 45,-99.7 45.3,-100 45.3,-100 45),(-99.9 45.1,-99.8 45.1,-99.8 45.2,-99.9 45.2,-99.9 45.1))', 4269)));
delete from public.national_dc_records;

insert into public.dc_acquisition_run (id, source_key, distribution_key, run_seq) values
 ('00000000-0000-0000-0000-0000000aa001', 'compute_atlas', 'facilities', 1),
 ('00000000-0000-0000-0000-0000000ee001', 'epoch_ai', 'data_centers', 1);

-- Production-shaped Atlas record: the address lives in raw_payload.location (and, identically, in
-- source_native_address -- measured 2026-09-24: 2,187/2,187 equal).
create or replace function pg_temp.atlas(p_name text, p_lat float8, p_lng float8, p_notes text,
    p_street text default null, p_city text default null, p_state text default 'SD',
    p_postal text default null)
returns uuid language sql as $$
  with loc as (select jsonb_strip_nulls(jsonb_build_object('street', p_street, 'city', p_city,
                   'state', p_state, 'postalCode', p_postal)) l)
  insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key,
      publisher_record_id, raw_payload, source_native_name, source_native_type, source_native_status,
      source_native_operator, source_native_address, source_native_lat, source_native_lon,
      source_native_precision)
  select '00000000-0000-0000-0000-0000000aa001', 'compute_atlas', 'facilities',
      lower(replace(p_name, ' ', '-')),
      jsonb_strip_nulls(jsonb_build_object('notes', p_notes, 'confidence', 'confirmed',
          'location', loc.l || jsonb_build_object('lat', p_lat, 'lon', p_lng, 'precision', 'exact'),
          'sources', jsonb_build_array(jsonb_build_object('url', 'https://example.org/' || lower(replace(p_name, ' ', '-')))))),
      p_name, 'data_center', 'operational', p_name || ' Operator',
      loc.l, p_lat, p_lng, 'exact'
    from loc
  returning home_signal_observation_id $$;

-- [A1] its own address geocodes 0.75 km from its point: inside the calibrated 2 km bound
select pg_temp.atlas('Corrob Atlas', 45.0512, -100.1012, 'Coordinates are the building footprint centroid.',
                     '10 Corrob Road', 'Corrobton', 'SD', '57003');
-- [A2, the Lancaster shape, Atlas-only] a point 314 m inside 99921 whose OWN street address geocodes
-- 4.2 km away in 99922; the provider's ZIP names the point's own polygon (a provider-ZIP rule would
-- wrongly settle it)
select pg_temp.atlas('Far Atlas', 45.1012, -100.0040, null, '216 Far Road', 'Farville', 'SD');
-- [A3] 17 km apart and BOTH inside 99921: the same ZIP is not corroboration
select pg_temp.atlas('Same Zip Atlas', 45.0212, -100.2512, 'Coordinates are the parcel centroid.',
                     '300 Same Road', 'Sameton', 'SD', '57004');
-- [A4] the ladder matched nothing: absence of evidence is not evidence against the point
select pg_temp.atlas('Failed Atlas', 45.0312, -100.1512, null, '1 Failed Way', 'Failton', 'SD');
-- [A5] two provider candidates, the "match" 11.8 km away: never chosen, never a veto
select pg_temp.atlas('Ambiguous Atlas', 45.0412, -100.2012, null, '1772 145th Street', 'Rosemount', 'SD');
-- [A6/A7/A8] a road with no house number, a house-number range, no street: never geocoded
select pg_temp.atlas('Vague Atlas', 45.0612, -100.1212, null, 'Airport Road', 'Rockingham', 'SD');
select pg_temp.atlas('Range Atlas', 45.0712, -100.1312, null, '4250-4320 Messenger Loop NW', 'Los Lunas', 'SD', '57005');
select pg_temp.atlas('Blank Atlas', 45.0812, -100.1412, null, null, 'Blankville', 'SD');
-- [A9] the publisher says its pin is a town centroid; its street address geocodes cleanly in 99922
select pg_temp.atlas('Town Atlas', 45.1500, -99.7500, 'Coordinates are Testburg city centroid.',
                     '400 Town Road', 'Testburg', 'SD', '57006');
-- [A10] two buildings, one stated street address, both pinned to a town centroid
select pg_temp.atlas('Hub Hall A', 45.2112, -99.7212, 'Coordinates are Hubville city centroid.',
                     '700 Hub Road', 'Hubville', 'SD', '57002');
select pg_temp.atlas('Hub Hall B', 45.2212, -99.7312, 'Coordinates are Hubville city centroid.',
                     '700 Hub Road', 'Hubville', 'SD', '57002');
-- [A11] a site point in 99922's hole: in no ZCTA
select pg_temp.atlas('Hole Atlas', 45.1512, -99.8512, null);
-- [A12] a site point in 99924, 1.3 km from the diagonal and 9.5 km from 99921's centroid
select pg_temp.atlas('Diag Atlas', 45.1012, -100.2212, null);

-- an Epoch record near Corrob Atlas (identity control: K3 already surfaces it before admission)
insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key, raw_payload,
    source_native_name, source_native_operator, source_native_address)
values ('00000000-0000-0000-0000-0000000ee001', 'epoch_ai', 'data_centers',
    jsonb_build_object('Name', 'Near Epoch', 'Address', '55 Near Road, Corrobton, SD 57003',
                       'Country', 'United States', 'Owner', 'Near Tenant',
                       'Selected Sources', '- [a](https://example.org/epoch/near)' || chr(10)),
    'Near Epoch', 'Near Tenant',
    jsonb_build_object('Address', '55 Near Road, Corrobton, SD 57003', 'Country', 'United States'));

create temp table _src_fp as
select md5(string_agg(t::text, ',' order by t.home_signal_observation_id)) fp from public.dc_source_observation t;

-- ── the queue, as the writer reads it: the WHOLE queue, then one batch of 2 ─────────────
\o :qfile
\i :queuesql
\o
create temp table _q_all (j text);
\set cp '\\copy _q_all(j) from ' :'qfile'
:cp
\set dcg_batch 2
\o :qfile
\i :queuesql
\o
\unset dcg_batch
create temp table _q_batch (n serial, j text);
\set cp '\\copy _q_batch(j) from ' :'qfile'
:cp

-- ── the writer's derivations (as the production ladder returns them) ───────────────────
create temp table _dcg_all as
select jsonb_build_object('geocoder_query', q, 'canonical_addr', upper(q),
    'ladder_version', 'production-ladder-v1', 'provider', p, 'match_type', mt, 'lat', la, 'lng', ln,
    'matched_address', ma, 'provider_candidates', c, 'provider_matched_addresses', '[]'::jsonb,
    'run_ref', 'suite') j, src from (values
 ('55 Near Road, Corrobton, SD 57003', 'census_onelineaddress', 'range_interpolated', 45.0800, -100.0800, '55 NEAR RD, CORROBTON, SD, 57003', 1, 'epoch'),
 ('10 Corrob Road, Corrobton, SD 57003', 'census_onelineaddress', 'range_interpolated', 45.0570, -100.1060, '10 CORROB RD, CORROBTON, SD, 57003', 1, 'atlas'),
 ('216 Far Road, Farville, SD', 'census_onelineaddress', 'range_interpolated', 45.1012, -99.9500, '216 FAR RD, FARVILLE, SD, 99921', 1, 'atlas'),
 ('300 Same Road, Sameton, SD 57004', 'census_onelineaddress', 'range_interpolated', 45.0212, -100.0312, '300 SAME RD, SAMETON, SD, 57004', 1, 'atlas'),
 ('1 Failed Way, Failton, SD', 'none', 'failed', null, null, null, null, 'atlas'),
 ('1772 145th Street, Rosemount, SD', 'census_onelineaddress', 'range_interpolated', 45.0412, -100.0512, '1772 145TH ST E, ROSEMOUNT, SD, 57010', 2, 'atlas'),
 ('400 Town Road, Testburg, SD 57006', 'census_onelineaddress', 'range_interpolated', 45.2500, -99.7600, '400 TOWN RD, TESTBURG, SD, 57006', 1, 'atlas'),
 ('700 Hub Road, Hubville, SD 57002', 'census_onelineaddress', 'range_interpolated', 45.2150, -99.7650, '700 HUB RD, HUBVILLE, SD, 57002', 1, 'atlas'),
 ('9 Not Queued Road, Nowhere, SD 57009', 'census_onelineaddress', 'range_interpolated', 45.0500, -100.0500, '9 NOT QUEUED RD, NOWHERE, SD, 57009', 1, 'atlas')
) v(q, p, mt, la, ln, ma, c, src);

create or replace function pg_temp.snap_geo() returns text language sql as $$
  select md5(coalesce(string_agg(concat_ws('|', canonical_entity_id, geography_status, geometry_type,
             positional_uncertainty_m, ST_AsText(geom), lat, lng, coordinate_decimals, authority_source_key,
             authority_observation_id, publisher_precision, quality_flags::text, rule_key, rule_version,
             provenance::text), ',' order by canonical_entity_id), '')) from public.dc_entity_geography $$;
create or replace function pg_temp.snap_pages() returns text language sql as $$
  select md5(coalesce(string_agg(concat_ws('|', z.zcta5, m.source_key, m.lat, m.lng, m.map_status, m.quality_flags::text),
             ',' order by z.zcta5, m.source_key), ''))
    from geo.zcta_boundary z cross join lateral public.map1_dc_zip_members(z.zcta5) m $$;
create or replace function pg_temp.snap_identity() returns text language sql as $$
  select md5(concat_ws('#',
    (select string_agg(concat_ws('|', canonical_entity_id, entity_grain, classification, superseded_by), ',' order by canonical_entity_id) from public.dc_canonical_entity),
    (select string_agg(concat_ws('|', canonical_entity_id, home_signal_observation_id, link_rule_key), ',' order by home_signal_observation_id) from public.dc_entity_observation),
    (select string_agg(concat_ws('|', observation_a, observation_b, candidate_rule_key, decision_state, decision_rule_key), ',' order by observation_a, observation_b, candidate_rule_key) from public.dc_identity_decision),
    (select string_agg(concat_ws('|', canonical_entity_id, other_entity_id, candidate_rule_key), ',' order by canonical_entity_id, other_entity_id, candidate_rule_key) from public.dc_entity_identity_open))) $$;

-- ── STEP 0: every admitted (Epoch) derivation, NO Atlas derivation ─────────────────────
create temp table _dcg_in (j jsonb);
insert into _dcg_in select j from _dcg_all where src = 'epoch';
\i :loadsql
select count(*) >= 0 from public.dc_resolve_canonical(true, false);
select count(*) >= 0 from public.dc_resolve_geography(true);
create temp table _s0 as select pg_temp.snap_geo() g, pg_temp.snap_pages() p, pg_temp.snap_identity() i;
create temp table _pages0 as select z.zcta5 zip, m.* from geo.zcta_boundary z cross join lateral public.map1_dc_zip_members(z.zcta5) m;

-- ── PHASE A: the Atlas derivations are acquired through the SAME writer; not admitted ───
truncate _dcg_in;
insert into _dcg_in select j from _dcg_all where src = 'atlas';
\i :loadsql
create temp table _dp_a as select source_key, admitted from public.dc_observation_derived_point;
create temp table _a1 as select * from public.dc_resolve_canonical(true, false);
create temp table _a2 as select * from public.dc_resolve_geography(true);
create temp table _s1 as select pg_temp.snap_geo() g, pg_temp.snap_pages() p, pg_temp.snap_identity() i;

-- ── PHASE D: the reviewed admission (the one-line production switch) ─────────────────
create or replace function public.dc_derived_address_admitted(p_source_key text, p_distribution_key text)
returns boolean language sql immutable set search_path to 'public', 'pg_temp'
as $$ select (p_source_key, p_distribution_key) in (('epoch_ai', 'data_centers'), ('compute_atlas', 'facilities')) $$;
create temp table _d1 as select * from public.dc_resolve_canonical(true, false);
create temp table _g1 as select * from public.dc_resolve_geography(true);
create temp table _g2 as select * from public.dc_resolve_geography(true);
create temp table _s2 as select pg_temp.snap_geo() g, pg_temp.snap_pages() p, pg_temp.snap_identity() i;
create temp table _pages2 as select z.zcta5 zip, m.* from geo.zcta_boundary z cross join lateral public.map1_dc_zip_members(z.zcta5) m;

create or replace function pg_temp.ent(p_name text) returns uuid language sql as $$
  select eo.canonical_entity_id from public.dc_entity_observation eo
    join public.dc_current_observation c using (home_signal_observation_id)
   where c.source_native_name = p_name order by c.home_signal_observation_id limit 1 $$;
create or replace function pg_temp.geo(p_name text) returns public.dc_entity_geography language sql as $$
  select g.* from public.dc_entity_geography g where g.canonical_entity_id = pg_temp.ent(p_name) $$;
create or replace function pg_temp.dp(p_name text) returns public.dc_observation_derived_point language sql as $$
  select d.* from public.dc_observation_derived_point d
    join public.dc_current_observation c using (home_signal_observation_id)
   where c.source_native_name = p_name order by d.home_signal_observation_id limit 1 $$;
create or replace function pg_temp.pages_of(p_name text, p_phase text default 'D') returns text language sql as $$
  select coalesce(string_agg(zip, ',' order by zip), '-')
    from (select zip, canonical_entity_id from _pages0 where p_phase = '0'
          union all select zip, canonical_entity_id from _pages2 where p_phase = 'D') p
   where p.canonical_entity_id = pg_temp.ent(p_name) $$;
create or replace function pg_temp.g(p_name text) returns text language sql as $$
  select g.geography_status || '/' || g.rule_key || ' ' || coalesce(g.lat::text, '-') || ',' || coalesce(g.lng::text, '-')
         || ' ' || g.quality_flags::text from pg_temp.geo(p_name) g $$;

-- ── Z. ZERO HUMAN ────────────────────────────────────────────────────────────────────
insert into _r (check_name, pass, detail)
select 'Z01 no human decision exists anywhere: no review table, no reviewed decision or link, no override',
       to_regclass('public.dc_identity_review') is null
   and not exists (select 1 from public.dc_identity_decision where decision_rule_key like 'REVIEWED%')
   and not exists (select 1 from public.dc_entity_observation where link_rule_key like 'REVIEWED%')
   and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname ~ '(review|override|manual)' and c.relkind in ('r', 'v')),
       null;

-- ── V. EXTRACTION + POLICY ───────────────────────────────────────────────────────────
insert into _r select nextval('_r_n_seq'), 'V01 the Atlas extraction composes the publisher''s own fields, the calibration''s shape, nothing guessed',
       (pg_temp.dp('Corrob Atlas')).geocoder_query = '10 Corrob Road, Corrobton, SD 57003'
   and (pg_temp.dp('Far Atlas')).geocoder_query = '216 Far Road, Farville, SD'
   and (select address_line from public.dc_publisher_stated_address('compute_atlas', 'facilities',
          '{"location":{"street":"  2480  W Twin Buttes Road ","state":"AZ","postalCode":"85629"}}')) = '2480 W Twin Buttes Road, AZ 85629'
   and (select extraction from public.dc_publisher_stated_address('some_new_source', 'x', '{}')) = 'NO_RULE',
       (pg_temp.dp('Corrob Atlas')).geocoder_query || ' / ' || (pg_temp.dp('Far Atlas')).geocoder_query;

insert into _r select nextval('_r_n_seq'), 'V02 vague, range and blank Atlas addresses fail closed before any geocoder call (one generic policy)',
       string_agg(n || '=' || coalesce((pg_temp.dp(n)).input_quality, 'NULL'), ', ' order by n)
         = 'Blank Atlas=BLANK, Corrob Atlas=GEOCODABLE, Hole Atlas=BLANK, Range Atlas=HOUSE_NUMBER_RANGE, Vague Atlas=NO_HOUSE_NUMBER',
       string_agg(n || '=' || coalesce((pg_temp.dp(n)).input_quality, 'NULL'), ', ' order by n)
  from unnest(array['Vague Atlas', 'Range Atlas', 'Blank Atlas', 'Hole Atlas', 'Corrob Atlas']) n;

insert into _r select nextval('_r_n_seq'), 'V03 the policy is the SAME for every source: identical lines get identical verdicts from Epoch and Atlas',
       not exists (
         select 1 from unnest(array['Airport Road, Rockingham, SD', '4250-4320 Messenger Loop NW, Los Lunas, SD 57005',
                                    '13360 Miller Rd NW', '10 Corrob Road, Corrobton, SD 57003', '']) l
          where (select row(input_quality, geocoder_query) from public.dc_geocode_input('epoch_ai', 'data_centers',
                   jsonb_build_object('Address', l, 'Country', 'United States')))
                is distinct from
                (select row(input_quality, geocoder_query) from public.dc_geocodable_site_address(l))),
       null;

insert into _r select nextval('_r_n_seq'), 'V04 the queue: 8 geocodable queries, nothing ineligible; a batch takes ADMITTED work first, then "C" order',
       (select count(*) from _q_all) = 8
   and not exists (select 1 from _q_all where j like '%Airport Road%' or j like '%4250-4320%')
   and (select count(*) from _q_batch) = 2
   and (select j::jsonb->>'geocoder_query' from _q_batch where n = 1) = '55 Near Road, Corrobton, SD 57003'
   and (select j::jsonb->>'geocoder_query' from _q_batch where n = 2) = '1 Failed Way, Failton, SD',   -- "C": '1 ' < '10'
       (select count(*)::text from _q_all) || ' / ' || (select string_agg(j::jsonb->>'geocoder_query', ' ; ' order by n) from _q_batch);

insert into _r select nextval('_r_n_seq'), 'V05 the load writes only queued queries, append-only; publisher evidence is untouched (fingerprint)',
       not exists (select 1 from public.dc_address_geocode where geocoder_query like '9 Not Queued%')
   and (select count(*) from public.dc_address_geocode) = 8
   and (select count(*) from public.dc_address_geocode where provider not in ('census_onelineaddress', 'none')) = 0
   and (select fp from _src_fp) = (select md5(string_agg(t::text, ',' order by t.home_signal_observation_id)) from public.dc_source_observation t),
       (select count(*)::text from public.dc_address_geocode);

insert into _r select nextval('_r_n_seq'), 'V06 Atlas derivations are judged by the SAME output rule, and recorded NOT admitted',
       (pg_temp.dp('Corrob Atlas')).verdict = 'ACCEPTED'
   and (pg_temp.dp('Failed Atlas')).verdict = 'REJECTED_NO_MATCH'
   and (pg_temp.dp('Ambiguous Atlas')).verdict = 'REJECTED_AMBIGUOUS'
   and (pg_temp.dp('Far Atlas')).verdict = 'ACCEPTED'
   and (select bool_and(not admitted) from _dp_a where source_key = 'compute_atlas')   -- as loaded (Phase A)
   and (select bool_and(admitted) from _dp_a where source_key = 'epoch_ai'),
       (pg_temp.dp('Ambiguous Atlas')).verdict;

-- ── PHASE A: ACQUISITION IS INERT ────────────────────────────────────────────────────
insert into _r select nextval('_r_n_seq'), 'V07 PHASE A: with every Atlas derivation loaded but not admitted, geography, Map 1 and identity are byte-identical to the state with none',
       s0.g = s1.g and s0.p = s1.p and s0.i = s1.i
   and (select value from _a2 where metric = 'ROWS_WRITTEN') = '0',
       'geo ' || (s0.g = s1.g) || ' pages ' || (s0.p = s1.p) || ' identity ' || (s0.i = s1.i)
       || ' written ' || (select value from _a2 where metric = 'ROWS_WRITTEN')
  from _s0 s0, _s1 s1;

insert into _r select nextval('_r_n_seq'), 'V08 PHASE A: the non-control Atlas pages are exactly the publisher points (Far/Same Zip still published, Town still withheld)',
       pg_temp.pages_of('Far Atlas', '0') = '99921' and pg_temp.pages_of('Same Zip Atlas', '0') = '99921'
   and pg_temp.pages_of('Town Atlas', '0') = '-' and pg_temp.pages_of('Corrob Atlas', '0') = '99921',
       pg_temp.pages_of('Far Atlas', '0') || ' ' || pg_temp.pages_of('Town Atlas', '0');

-- ── PHASE D: THE SAME GENERAL RULES DECIDE ───────────────────────────────────────────
insert into _r select nextval('_r_n_seq'), 'V09 [corroborated] a derived point within 2 km confirms the publisher site point: SAME point, one marker, flag CORROBORATED',
       pg_temp.g('Corrob Atlas') = 'RESOLVED/PUBLISHER_POINT 45.0512,-100.1012 {CORROBORATED_BY_DERIVED_ADDRESS}'
   and pg_temp.pages_of('Corrob Atlas') = '99921',
       pg_temp.g('Corrob Atlas') || ' pages=' || pg_temp.pages_of('Corrob Atlas');

insert into _r select nextval('_r_n_seq'), 'V10 [Lancaster, Atlas-only] its OWN address 4.2 km away: fails closed, NOT moved to the derived point, not settled by the provider ZIP',
       (pg_temp.geo('Far Atlas')).geography_status = 'GEOGRAPHY_UNRESOLVED'
   and (pg_temp.geo('Far Atlas')).rule_key = 'SOURCES_DISAGREE'
   and (pg_temp.geo('Far Atlas')).quality_flags @> array['DERIVED_ADDRESS_BEYOND_UNCERTAINTY']
   and (pg_temp.geo('Far Atlas')).geom is null
   and pg_temp.pages_of('Far Atlas') = '-',
       pg_temp.g('Far Atlas') || ' pages=' || pg_temp.pages_of('Far Atlas');

insert into _r select nextval('_r_n_seq'), 'V11 [same ZIP is not proof] 17 km apart, BOTH inside 99921: still SOURCES_DISAGREE, no marker',
       (select count(*) from geo.zcta_boundary z where z.zcta5 = '99921'
          and ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(-100.2512, 45.0212), 4269))
          and ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(-100.0312, 45.0212), 4269))) = 1
   and (pg_temp.geo('Same Zip Atlas')).rule_key = 'SOURCES_DISAGREE'
   and pg_temp.pages_of('Same Zip Atlas') = '-',
       pg_temp.g('Same Zip Atlas');

insert into _r select nextval('_r_n_seq'), 'V12 [absence is not evidence] failed, ambiguous, vague, range and blank addresses leave the publisher site point exactly as it was',
       bool_and(pg_temp.g(n) = 'RESOLVED/PUBLISHER_POINT ' || (pg_temp.geo(n)).lat || ',' || (pg_temp.geo(n)).lng || ' {}'
                and pg_temp.pages_of(n) = '99921' and pg_temp.pages_of(n, '0') = '99921'),
       string_agg(n || ':' || pg_temp.g(n), '; ')
  from unnest(array['Failed Atlas', 'Ambiguous Atlas', 'Vague Atlas', 'Range Atlas', 'Blank Atlas']) n;

insert into _r select nextval('_r_n_seq'), 'V13 [town-centroid pin] the publisher''s own address places it: DERIVED_ADDRESS_POINT, 2,000 m, the whole disk inside 99922',
       (pg_temp.geo('Town Atlas')).geography_status = 'RESOLVED'
   and (pg_temp.geo('Town Atlas')).rule_key = 'DERIVED_ADDRESS_POINT'
   and (pg_temp.geo('Town Atlas')).lat = 45.25 and (pg_temp.geo('Town Atlas')).lng = -99.76
   and (pg_temp.geo('Town Atlas')).positional_uncertainty_m = 2000
   and pg_temp.pages_of('Town Atlas') = '99922' and pg_temp.pages_of('Town Atlas', '0') = '-',
       pg_temp.g('Town Atlas') || ' pages=' || pg_temp.pages_of('Town Atlas');

insert into _r select nextval('_r_n_seq'), 'V14 [no duplicate facility] two buildings at one stated address are never both placed on it',
       (pg_temp.geo('Hub Hall A')).rule_key = 'DERIVED_ADDRESS_SHARED'
   and (pg_temp.geo('Hub Hall B')).rule_key = 'DERIVED_ADDRESS_SHARED'
   and pg_temp.pages_of('Hub Hall A') = '-' and pg_temp.pages_of('Hub Hall B') = '-'
   and pg_temp.ent('Hub Hall A') <> pg_temp.ent('Hub Hall B'),
       (pg_temp.geo('Hub Hall A')).rule_key || '/' || (pg_temp.geo('Hub Hall B')).rule_key;

insert into _r select nextval('_r_n_seq'), 'V15 [identity is upstream] loading and admitting Atlas derivations changed NO entity, link, decision or open question',
       s0.i = s2.i
   and (select value from _d1 where metric = 'ENTITIES_MINTED') = '0'
   and (select value from _d1 where metric = 'OBSERVATIONS_RELINKED') = '0'
   and exists (select 1 from public.dc_entity_identity_open),   -- control: the open set is not vacuous
       'identity ' || (s0.i = s2.i) || ' ' ||
       (select string_agg(metric || '=' || value, ' ') from _d1 where metric in ('ENTITIES_MINTED', 'OBSERVATIONS_RELINKED'))
  from _s0 s0, _s2 s2;

insert into _r select nextval('_r_n_seq'), 'V16 [ONE polygon membership] every marker sits on exactly the ZIP whose polygon covers its canonical point, once; the hole and the other triangle carry nothing extra',
       not exists (
         select 1 from _pages2 p join public.dc_entity_geography g using (canonical_entity_id)
          where not exists (select 1 from geo.zcta_boundary z where z.zcta5 = p.zip
                              and ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4269))))
   and (select count(*) from _pages2) = (select count(distinct canonical_entity_id) from _pages2)
   and pg_temp.pages_of('Hole Atlas') = '-' and pg_temp.pages_of('Diag Atlas') = '99924'
   and (select string_agg(zip || ':' || project_name, ';' order by zip, project_name) from _pages2)
       = '99921:Ambiguous Atlas;99921:Blank Atlas;99921:Corrob Atlas;99921:Failed Atlas;99921:Range Atlas;99921:Vague Atlas;99922:Town Atlas;99924:Diag Atlas',
       (select string_agg(zip || ':' || project_name, ';' order by zip, project_name) from _pages2);

insert into _r select nextval('_r_n_seq'), 'V17 the national delta of admission is exactly: 2 withheld (conflict), 1 placed (town pin), nothing moved',
       (select string_agg(x, ';' order by x) from (
          select 'REMOVED ' || b.project_name x from _pages0 b
           where not exists (select 1 from _pages2 a where a.canonical_entity_id is not distinct from b.canonical_entity_id and a.zip = b.zip)
          union all
          select 'ADDED ' || a.project_name from _pages2 a
           where not exists (select 1 from _pages0 b where b.canonical_entity_id is not distinct from a.canonical_entity_id and b.zip = a.zip)
          union all
          select 'MOVED ' || a.project_name from _pages2 a join _pages0 b using (canonical_entity_id)
           where a.zip = b.zip and (a.lat, a.lng) is distinct from (b.lat, b.lng)) s)
       = 'ADDED Town Atlas;REMOVED Far Atlas;REMOVED Same Zip Atlas',
       (select string_agg(x, ';' order by x) from (
          select 'REMOVED ' || b.project_name x from _pages0 b
           where not exists (select 1 from _pages2 a where a.canonical_entity_id is not distinct from b.canonical_entity_id and a.zip = b.zip)
          union all
          select 'ADDED ' || a.project_name from _pages2 a
           where not exists (select 1 from _pages0 b where b.canonical_entity_id is not distinct from a.canonical_entity_id and b.zip = a.zip)
          union all
          select 'MOVED ' || a.project_name from _pages2 a join _pages0 b using (canonical_entity_id)
           where a.zip = b.zip and (a.lat, a.lng) is distinct from (b.lat, b.lng)) s);

insert into _r select nextval('_r_n_seq'), 'V18 idempotent: a second geography run writes nothing; every row is rule_version 5',
       (select value from _g2 where metric = 'ROWS_WRITTEN') = '0'
   and not exists (select 1 from public.dc_entity_geography where rule_version <> 5),
       (select value from _g2 where metric = 'ROWS_WRITTEN');

insert into _r select nextval('_r_n_seq'), 'V19 derived evidence never enters publisher evidence: every Atlas publisher point and payload is unchanged',
       (select fp from _src_fp) = (select md5(string_agg(t::text, ',' order by t.home_signal_observation_id)) from public.dc_source_observation t),
       null;

select check_name, coalesce(pass, false), coalesce(detail, '') from _r order by n;

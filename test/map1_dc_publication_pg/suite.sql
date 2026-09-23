-- =====================================================================================
-- MAP 1 DATA-CENTRE PUBLICATION CONTRACT — EXECUTABLE ADVERSARIAL SUITE
-- (docs/map1-dc-publication.sql, public.map1_dc_zip_members)
--
-- Uses the SAME notched synthetic ZIP as test/zip_membership_pg/suite.sql (SRID 4269):
--   a 0.4° square (-100..-99.6, 40..40.4) with a notch cut from its east edge,
--   x > -99.82 and 40.18 < y < 40.22. 99901 carries that polygon; 99902 has NO boundary.
-- Every expected answer below is a HARD-CODED constant, never computed by the code under test.
-- Output: one row per check (check, pass, detail); a NULL pass counts as a failure.
-- =====================================================================================

create temp table if not exists _pb_result (n serial, check_name text, pass boolean, detail text);
truncate _pb_result;

-- the synthetic polygon on 99901, no boundary on 99902 (same UPDATE-then-INSERT as the sibling suite)
create temp table if not exists _pb_poly as
select ST_Multi(ST_GeomFromText(
  'POLYGON((-100 40, -99.6 40, -99.6 40.18, -99.82 40.18, -99.82 40.22, -99.6 40.22, -99.6 40.4, -100 40.4, -100 40))',
  4269))::geometry(MultiPolygon, 4269) as geom;
update geo.zcta_boundary b set geom = z.geom from _zm_cfg c, _pb_poly z where b.zcta5 = c.zip_with;
insert into geo.zcta_boundary (zcta5, geom)
select c.zip_with, z.geom from _zm_cfg c, _pb_poly z
 where not exists (select 1 from geo.zcta_boundary b where b.zcta5 = c.zip_with);
delete from geo.zcta_boundary where zcta5 = (select zip_without from _zm_cfg);

insert into public.dc_source values
  ('compute_atlas', 'Compute Atlas', 'CC BY 4.0'),
  ('future_feed',   'Future Feed',   'CC BY 4.0')
on conflict (source_key) do nothing;

-- One canonical entity with one authority observation and its geography.
create or replace function pg_temp.mk(p_name text, p_src text, p_cls text, p_gstatus text,
                                      p_lat double precision, p_lng double precision,
                                      p_status text, p_url text, p_superseded boolean default false)
returns void language plpgsql as $$
declare v_obs uuid; v_ent uuid;
begin
  insert into public.dc_source_observation (source_key, raw_payload, source_native_name,
      source_native_status, source_native_address, source_native_lat, source_native_lon,
      source_native_precision)
  values (p_src,
          case when p_url is null then '{"sources": []}'::jsonb
               else jsonb_build_object('sources', jsonb_build_array(
                      jsonb_build_object('url', 'not a url'), jsonb_build_object('url', p_url))) end,
          p_name, p_status, jsonb_build_object('city', 'Testville', 'state', 'ZZ'),
          p_lat, p_lng, 'exact')
  returning home_signal_observation_id into v_obs;
  insert into public.dc_canonical_entity (classification) values (p_cls)
  returning canonical_entity_id into v_ent;
  if p_superseded then
    update public.dc_canonical_entity set superseded_by = v_ent
     where canonical_entity_id = v_ent;   -- any non-null successor marks it superseded
  end if;
  insert into public.dc_entity_geography (canonical_entity_id, geography_status, geometry_type,
      geom, lat, lng, authority_observation_id, publisher_precision, quality_flags)
  values (v_ent, p_gstatus,
          case when p_gstatus = 'RESOLVED' then 'POINT' end,
          case when p_gstatus = 'RESOLVED' then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) end,
          p_lat, p_lng, v_obs, 'exact',
          case when p_gstatus = 'GEOGRAPHY_UNRESOLVED' then array['ROUNDED_COORDINATES','PUBLISHER_CLAIMS_EXACT'] else '{}' end);
end $$;

truncate public.dc_entity_geography, public.dc_canonical_entity, public.dc_source_observation;
delete from public.national_dc_records where source_key like 'pbtest:%';

select pg_temp.mk('PUB inside far',        'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.38, -99.98, 'operational',        'https://example.test/a');
select pg_temp.mk('PUB proposed',          'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.05, -99.70, 'proposed',           'https://example.test/f');
select pg_temp.mk('PUB under construction','compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.30, -99.90, 'under_construction', 'https://example.test/g');
select pg_temp.mk('PUB permitted',         'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.31, -99.91, 'permitted',          'https://example.test/p');
select pg_temp.mk('PUB future source',     'future_feed',   'CONFIRMED_DC', 'RESOLVED', 40.12, -99.95, 'operational',        'https://example.test/ff');
select pg_temp.mk('PUB twin one',          'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.15, -99.85, 'operational',        'https://example.test/t1');
select pg_temp.mk('PUB twin two',          'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.15, -99.85, 'operational',        'https://example.test/t2');
select pg_temp.mk('NO notch outside',      'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.20, -99.79, 'operational',        'https://example.test/b');
select pg_temp.mk('NO non dc',             'compute_atlas', 'NON_DC',       'RESOLVED', 40.37, -99.97, 'operational',        'https://example.test/n');
select pg_temp.mk('NO candidate',          'compute_atlas', 'DC_CANDIDATE', 'RESOLVED', 40.36, -99.96, 'operational',        'https://example.test/c');
select pg_temp.mk('NO unresolved rounded', 'compute_atlas', 'CONFIRMED_DC', 'GEOGRAPHY_UNRESOLVED', 40.3, -99.8, 'proposed', 'https://example.test/u');
select pg_temp.mk('NO not a site',         'compute_atlas', 'CONFIRMED_DC', 'NOT_A_SITE',  40.25, -99.93, 'operational',        'https://example.test/s');
select pg_temp.mk('NO cancelled',          'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.26, -99.94, 'cancelled',          'https://example.test/x');
select pg_temp.mk('NO status absent',      'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.27, -99.94, null,                 'https://example.test/y');
select pg_temp.mk('NO url',                'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.28, -99.94, 'operational',        null);
select pg_temp.mk('NO superseded',         'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.29, -99.94, 'operational',        'https://example.test/z', true);

-- legacy OSM compatibility rows
insert into public.national_dc_records
  (source_key, source_record_id, osm_type, source_url, project_name, raw_status, normalized_status,
   lat, lng, location_precision, map_eligible, map_exclusion_reason)
values
  -- IDENTICAL coordinates to exactly one published entity, one-to-one -> suppressed as the same facility
  ('pbtest:dup',     '1', 'way', 'https://example.test/o1', 'OSM same facility',  'operational', 'operational', 40.38, -99.98, 'precise_location', true, null),
  -- 50 m from a published entity: NOT a match, kept
  ('pbtest:near',    '2', 'way', 'https://example.test/o2', 'OSM fifty metres',   'operational', 'operational', 40.05045, -99.70, 'precise_location', true, null),
  -- inside, nothing canonical near it: kept
  ('pbtest:alone',   '3', 'way', 'https://example.test/o3', 'OSM alone',          'under_construction', 'under_construction', 40.22, -99.95, 'approximate_campus_area', true, null),
  -- identical to TWO published entities: ambiguous, kept
  ('pbtest:amb',     '4', 'way', 'https://example.test/o4', 'OSM ambiguous',      'operational', 'operational', 40.15, -99.85, 'precise_location', true, null),
  -- outside the ZIP (in the notch)
  ('pbtest:out',     '5', 'way', 'https://example.test/o5', 'OSM outside',        'operational', 'operational', 40.21, -99.78, 'precise_location', true, null),
  -- ineligible
  ('pbtest:inelig',  '6', 'way', 'https://example.test/o6', 'OSM ineligible',     'operational', 'operational', 40.10, -99.99, 'precise_location', false, 'suite control'),
  -- eligible but a lifecycle outside the one map
  ('pbtest:planned', '7', 'way', 'https://example.test/o7', 'OSM planned',        'planned',     'planned',     40.11, -99.99, 'precise_location', true, null);

create temp table _pb_before as
select (select count(*) from public.dc_canonical_entity) e, (select count(*) from public.dc_entity_geography) g,
       (select count(*) from public.dc_source_observation) o, (select count(*) from public.national_dc_records) r;

create temp table _pb_out as select * from public.map1_dc_zip_members((select zip_with from _zm_cfg));
create temp table _pb_out2 as select * from public.map1_dc_zip_members((select zip_with from _zm_cfg));

insert into _pb_result(check_name, pass, detail)
select 'S1 exactly the eligible, in-ZIP population publishes (canonical + kept compatibility rows)',
       string_agg(project_name, ' | ' order by project_name collate "C") =
       'OSM alone | OSM ambiguous | OSM fifty metres | PUB future source | PUB inside far | PUB permitted | PUB proposed | PUB twin one | PUB twin two | PUB under construction',
       string_agg(project_name, ' | ' order by project_name collate "C")
  from _pb_out;

insert into _pb_result(check_name, pass, detail)
select 'S2 NON_DC, DC_CANDIDATE, unresolved, NOT_A_SITE, cancelled, status-less, URL-less and superseded never publish',
       not exists (select 1 from _pb_out where project_name like 'NO %'),
       (select string_agg(project_name, ',') from _pb_out where project_name like 'NO %');

insert into _pb_result(check_name, pass, detail)
select 'S3 the rounded "exact" point stays unpublished — publisher precision is not geographic authority',
       not exists (select 1 from _pb_out where lat = 40.3 and lng = -99.8), null;

insert into _pb_result(check_name, pass, detail)
select 'S4 map_status is the ONE lifecycle map (proposed is Proposed, never Approved)',
       string_agg(project_name || '=' || map_status, ',' order by project_name collate "C") =
       'OSM alone=Approved,OSM ambiguous=Operating,OSM fifty metres=Operating,PUB future source=Operating,PUB inside far=Operating,PUB permitted=Approved,PUB proposed=Proposed,PUB twin one=Operating,PUB twin two=Operating,PUB under construction=Approved',
       string_agg(project_name || '=' || map_status, ',' order by project_name collate "C")
  from _pb_out;

insert into _pb_result(check_name, pass, detail)
select 'S5 every row is a member verdict with no distance',
       bool_and(zip_membership = 'member' and distance_mi is null) and count(*) > 0, count(*)::text
  from _pb_out;

insert into _pb_result(check_name, pass, detail)
select 'S6 one marker per record: no source_key twice, no canonical entity twice',
       count(*) = count(distinct source_key)
   and count(canonical_entity_id) = count(distinct canonical_entity_id), count(*)::text
  from _pb_out;

insert into _pb_result(check_name, pass, detail)
select 'S7 the identical-coordinate one-to-one OSM duplicate is suppressed; near, ambiguous and alone OSM rows are kept',
       not exists (select 1 from _pb_out where source_key = 'pbtest:dup')
   and (select count(*) from _pb_out where source_key in ('pbtest:near','pbtest:amb','pbtest:alone')
          and publication_basis = 'legacy_osm_compat') = 3, null;

insert into _pb_result(check_name, pass, detail)
select 'S8 source independence: a canonical entity from a source the function has never heard of publishes',
       exists (select 1 from _pb_out where project_name = 'PUB future source'
                 and publication_basis = 'canonical' and source_name = 'Future Feed'), null;

insert into _pb_result(check_name, pass, detail)
select 'S9 every row carries its source, licence and a real record URL (the first http(s) evidence URL)',
       bool_and(source_name is not null and source_licence is not null and source_url ~ '^https?://')
   and (select source_url from _pb_out where project_name = 'PUB inside far') = 'https://example.test/a',
       null
  from _pb_out;

insert into _pb_result(check_name, pass, detail)
select 'S10 a ZIP with NO boundary returns NOTHING — no centroid, radius or neighbour substitute',
       not exists (select 1 from _zm_cfg c, lateral public.map1_dc_zip_members(c.zip_without) m), null;

insert into _pb_result(check_name, pass, detail)
select 'S11 idempotent: a second read returns the identical set',
       (select md5(string_agg(t::text, '|' order by t::text collate "C")) from _pb_out t) =
       (select md5(string_agg(t::text, '|' order by t::text collate "C")) from _pb_out2 t), null;

insert into _pb_result(check_name, pass, detail)
select 'S12 reading publishes nothing and writes nothing (no entity, geography, observation or record minted)',
       b.e = (select count(*) from public.dc_canonical_entity)
   and b.g = (select count(*) from public.dc_entity_geography)
   and b.o = (select count(*) from public.dc_source_observation)
   and b.r = (select count(*) from public.national_dc_records), null
  from _pb_before b;

insert into _pb_result(check_name, pass, detail)
select 'S13 anon may execute the ONE contract (SECURITY DEFINER) and may read NO private table',
       has_function_privilege('anon', 'public.map1_dc_zip_members(text)', 'execute')
   and (select prosecdef from pg_proc where oid = 'public.map1_dc_zip_members(text)'::regprocedure)
   and not has_table_privilege('anon', 'public.dc_canonical_entity', 'select')
   and not has_table_privilege('anon', 'public.dc_entity_geography', 'select')
   and not has_table_privilege('anon', 'public.dc_source_observation', 'select')
   and not has_table_privilege('anon', 'public.national_dc_records', 'select'), null;

select check_name, coalesce(pass, false) as pass, detail from _pb_result order by n;

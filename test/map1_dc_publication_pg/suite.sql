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
-- a NEIGHBOUR sharing 99901's whole west edge (x = -100), for the edge-ambiguity check
delete from geo.zcta_boundary where zcta5 = '99903';
insert into geo.zcta_boundary (zcta5, geom)
select '99903', ST_Multi(ST_GeomFromText(
  'POLYGON((-100.4 40, -100 40, -100 40.4, -100.4 40.4, -100.4 40))', 4269))::geometry(MultiPolygon, 4269);

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
  insert into public.dc_entity_observation (home_signal_observation_id, canonical_entity_id)
  values (v_obs, v_ent);
  insert into public.dc_entity_geography (canonical_entity_id, geography_status, geometry_type,
      geom, lat, lng, authority_observation_id, publisher_precision, quality_flags)
  values (v_ent, p_gstatus,
          case when p_gstatus = 'RESOLVED' then 'POINT' end,
          case when p_gstatus = 'RESOLVED' then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) end,
          p_lat, p_lng, v_obs, 'exact',
          case when p_gstatus = 'GEOGRAPHY_UNRESOLVED' then array['ROUNDED_COORDINATES','PUBLISHER_CLAIMS_EXACT'] else '{}' end);
end $$;

truncate public.dc_entity_geography, public.dc_entity_observation, public.dc_canonical_entity, public.dc_source_observation;
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
select pg_temp.mk('PUB status absent',     'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.27, -99.94, null,                 'https://example.test/y');
select pg_temp.mk('NO url',                'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.28, -99.94, 'operational',        null);
-- exactly ON the edge 99901 shares with 99903: a member of both, so it must publish on neither
select pg_temp.mk('NO shared edge',        'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 40.33, -100.0, 'operational',        'https://example.test/e');
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
       'OSM alone | OSM ambiguous | OSM fifty metres | PUB future source | PUB inside far | PUB permitted | PUB proposed | PUB status absent | PUB twin one | PUB twin two | PUB under construction',
       string_agg(project_name, ' | ' order by project_name collate "C")
  from _pb_out;

insert into _pb_result(check_name, pass, detail)
select 'S2 NON_DC, DC_CANDIDATE, unresolved, NOT_A_SITE, cancelled, URL-less and superseded never publish',
       not exists (select 1 from _pb_out where project_name like 'NO %'),
       (select string_agg(project_name, ',') from _pb_out where project_name like 'NO %');

insert into _pb_result(check_name, pass, detail)
select 'S3 the rounded "exact" point stays unpublished — publisher precision is not geographic authority',
       not exists (select 1 from _pb_out where lat = 40.3 and lng = -99.8), null;

insert into _pb_result(check_name, pass, detail)
select 'S4 map_status is the ONE lifecycle map (proposed is Proposed, never Approved; no stated lifecycle is Unknown, never invented)',
       string_agg(project_name || '=' || map_status, ',' order by project_name collate "C") =
       'OSM alone=Approved,OSM ambiguous=Operating,OSM fifty metres=Operating,PUB future source=Operating,PUB inside far=Operating,PUB permitted=Approved,PUB proposed=Proposed,PUB status absent=Unknown,PUB twin one=Operating,PUB twin two=Operating,PUB under construction=Approved',
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

insert into _pb_result(check_name, pass, detail)
select 'S14 a point on an edge two ZCTAs share publishes on NEITHER page (fails closed, no nearest-ZIP pick)',
       -- positive control first: the point really is a boundary member of both polygons
       (select count(*) from geo.zcta_boundary z
         where ST_Intersects(z.geom, ST_SetSRID(ST_MakePoint(-100.0, 40.33), 4269))) = 2
   and geo.zip_point_membership_in((select geom from geo.zcta_boundary where zcta5 = '99903'), 40.33, -100.0) = 'member'
   and not exists (select 1 from _pb_out where project_name = 'NO shared edge')
   and not exists (select 1 from public.map1_dc_zip_members('99903') m where m.project_name = 'NO shared edge'),
       null;

-- =====================================================================================
-- SAME BUILDING, NEARBY (founder ruling 2026-10-23): a second synthetic ZIP so S1-S14 are untouched.
-- 99904 is the square (-90..-89.6, 30..30.4); 99905 is its east neighbour, used only to hold a
-- canonical twin that is NOT on 99904's page. At 30 N, 0.001 deg lat = 111 m, 0.001 deg lng = 96 m.
-- =====================================================================================
delete from geo.zcta_boundary where zcta5 in ('99904', '99905');
insert into geo.zcta_boundary (zcta5, geom) values
  ('99904', ST_Multi(ST_GeomFromText('POLYGON((-90 30, -89.6 30, -89.6 30.4, -90 30.4, -90 30))', 4269))),
  ('99905', ST_Multi(ST_GeomFromText('POLYGON((-89.6 30, -89.2 30, -89.2 30.4, -89.6 30.4, -89.6 30))', 4269)));

select pg_temp.mk('Digital Realty IAD55', 'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 30.050, -89.90, 'operational', 'https://example.test/s1');
select pg_temp.mk('Acme Data Center',     'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 30.060, -89.90, 'operational', 'https://example.test/s2');
select pg_temp.mk('Vantage WA12',         'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 30.070, -89.90, 'operational', 'https://example.test/s3');
select pg_temp.mk('Stack POR03',          'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 30.080, -89.90, 'operational', 'https://example.test/s4a');
select pg_temp.mk('Stack POR03',          'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 30.0803, -89.90, 'operational', 'https://example.test/s4b');
select pg_temp.mk('Far Co FAR1',          'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 30.090, -89.90, 'operational', 'https://example.test/s5');
select pg_temp.mk('Edge Co ED1',          'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 30.100, -89.59995, 'operational', 'https://example.test/s6');
select pg_temp.mk('Dual Co DU1',          'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 30.110, -89.90, 'operational', 'https://example.test/s7');
select pg_temp.mk('Equinix SV1',          'compute_atlas', 'CONFIRMED_DC', 'RESOLVED', 30.120, -89.90, 'operational', 'https://example.test/s8');
update public.dc_source_observation set source_native_operator = 'Digital Realty' where source_native_name = 'Digital Realty IAD55';
update public.dc_source_observation set source_native_operator = 'Vantage Data Centers' where source_native_name = 'Vantage WA12';
update public.dc_source_observation set source_native_operator = 'Equinix' where source_native_name = 'Equinix SV1';

insert into public.national_dc_records
  (source_key, source_record_id, osm_type, source_url, project_name, developer_or_operator, raw_status,
   normalized_status, lat, lng, location_precision, map_eligible, map_exclusion_reason)
values
  -- a shared site code, brand by the operator, 56 m: hidden
  ('pbtest:ss-code',  '11', 'way', 'https://example.test/x1', 'IAD55',                        'Digital Realty',       'operational', 'operational', 30.0505, -89.90, 'precise_location', true, null),
  -- the same name once the bracket is dropped, 100 m: hidden
  ('pbtest:ss-name',  '12', 'way', 'https://example.test/x2', 'Acme Data Center (Building 1)', null,                   'operational', 'operational', 30.0609, -89.90, 'precise_location', true, null),
  -- one operator, 56 m, a DIFFERENT code: kept
  ('pbtest:ss-wa13',  '13', 'way', 'https://example.test/x3', 'Vantage WA13',                  'Vantage Data Centers', 'operational', 'operational', 30.0705, -89.90, 'precise_location', true, null),
  -- two canonical twins: ambiguous, kept
  ('pbtest:ss-amb',   '14', 'way', 'https://example.test/x4', 'Stack POR03',                   null,                   'operational', 'operational', 30.0801, -89.90, 'precise_location', true, null),
  -- the same name 189 m away: kept
  ('pbtest:ss-far',   '15', 'way', 'https://example.test/x5', 'Far Co FAR1',                   null,                   'operational', 'operational', 30.0917, -89.90, 'precise_location', true, null),
  -- its twin is 82 m away, inside this page's 1e-4 retrieval margin but drawn on ANOTHER page (99905): kept here
  ('pbtest:ss-edge',  '16', 'way', 'https://example.test/x6', 'Edge Co ED1',                   null,                   'operational', 'operational', 30.100, -89.6008, 'precise_location', true, null),
  -- two OSM pins name one canonical pin: ambiguous, both kept
  ('pbtest:ss-dua',   '17', 'way', 'https://example.test/x7', 'Dual Co DU1',                   null,                   'operational', 'operational', 30.1103, -89.90, 'precise_location', true, null),
  ('pbtest:ss-dub',   '18', 'way', 'https://example.test/x8', 'Dual Co DU1',                   null,                   'operational', 'operational', 30.1097, -89.90, 'precise_location', true, null),
  -- one brand, 56 m, a different code: kept (Equinix SV1 / SV5)
  ('pbtest:ss-sv5',   '19', 'way', 'https://example.test/x9', 'Equinix SV5',                   'Equinix',              'operational', 'operational', 30.1205, -89.90, 'precise_location', true, null);

create temp table _ss_out as select * from public.map1_dc_zip_members('99904');

insert into _pb_result(check_name, pass, detail)
select 'S15 same building nearby: a shared site code (IAD55) and the same name without its bracket hide the OSM pin',
       not exists (select 1 from _ss_out where source_key in ('pbtest:ss-code', 'pbtest:ss-name'))
   and exists (select 1 from _ss_out where project_name = 'Digital Realty IAD55' and publication_basis = 'canonical')
   and exists (select 1 from _ss_out where project_name = 'Acme Data Center' and publication_basis = 'canonical'),
       (select string_agg(source_key, ',' order by source_key collate "C") from _ss_out where publication_basis = 'legacy_osm_compat');

insert into _pb_result(check_name, pass, detail)
select 'S16 distinct buildings of one operator stay separate: Vantage WA12/WA13 and Equinix SV1/SV5 (different codes)',
       (select count(*) from _ss_out where source_key in ('pbtest:ss-wa13', 'pbtest:ss-sv5')) = 2, null;

insert into _pb_result(check_name, pass, detail)
select 'S17 ambiguous pairings keep every marker: two canonical twins (Stack POR03) or two OSM twins (Dual Co DU1)',
       (select count(*) from _ss_out where source_key in ('pbtest:ss-amb', 'pbtest:ss-dua', 'pbtest:ss-dub')) = 3
   and (select count(*) from _ss_out where project_name = 'Stack POR03' and publication_basis = 'canonical') = 2, null;

insert into _pb_result(check_name, pass, detail)
select 'S18 the same name beyond 150 m is kept',
       exists (select 1 from _ss_out where source_key = 'pbtest:ss-far'), null;

insert into _pb_result(check_name, pass, detail)
select 'S19 a twin drawn on ANOTHER page never hides a pin here (Edge Co ED1: twin on 99905, OSM pin kept on 99904)',
       exists (select 1 from _ss_out where source_key = 'pbtest:ss-edge')
   and not exists (select 1 from _ss_out where project_name = 'Edge Co ED1' and publication_basis = 'canonical')
   and exists (select 1 from public.map1_dc_zip_members('99905') m where m.project_name = 'Edge Co ED1'), null;

insert into _pb_result(check_name, pass, detail)
select 'S20 the name rule on its own: brand AND (name or code), never distance',
       public.dc_names_same_site('IAD55', 'Digital Realty', 'Digital Realty IAD55', 'Digital Realty')
   and public.dc_names_same_site('Acme Data Center (Building 1)', null, 'Acme Data Center', null)
   and not public.dc_names_same_site('Vantage WA13', 'Vantage', 'Vantage WA12', 'Vantage')
   and not public.dc_names_same_site('Acme IAD55', null, 'Other IAD55', null)
   and not public.dc_names_same_site(null, 'Same Op', null, 'Same Op')
   and not public.dc_names_same_site(null, null, null, null)
   and not has_function_privilege('anon', 'public.dc_names_same_site(text,text,text,text)', 'execute'), null;

select check_name, coalesce(pass, false) as pass, detail from _pb_result order by n;

-- OFFICIAL DOCUMENTS PR 1: the BEFORE state. Applied after the shipped DC chain and BEFORE
-- docs/official-documents-map-gate.sql, so the snapshot it records is what Map 1 and the canonical tables
-- hold with no official-documents code at all. Fixture names live here only (design T-26).
\set ON_ERROR_STOP 1

-- ZCTAs (SRID 4269), far from each other so no identity net reaches across fixtures
delete from geo.zcta_boundary;
insert into geo.zcta_boundary (zcta5, geom) values
 ('99921', ST_Multi(ST_GeomFromText('POLYGON((-97.6 40,-97.3 40,-97.3 40.3,-97.6 40.3,-97.6 40))', 4269))),
 ('99922', ST_Multi(ST_GeomFromText('POLYGON((-90.2 35,-89.9 35,-89.9 35.3,-90.2 35.3,-90.2 35))', 4269))),
 ('99923', ST_Multi(ST_GeomFromText('POLYGON((-104.3 44,-104.0 44,-104.0 44.3,-104.3 44.3,-104.3 44))', 4269))),
 ('99924', ST_Multi(ST_GeomFromText('POLYGON((-110.3 38,-110.0 38,-110.0 38.3,-110.3 38.3,-110.3 38))', 4269))),
 ('99925', ST_Multi(ST_GeomFromText('POLYGON((-80.3 33,-80.0 33,-80.0 33.3,-80.3 33.3,-80.3 33))', 4269)));
delete from public.national_dc_records;
create table if not exists public.canonical_zip_registry (zip text primary key);
insert into public.canonical_zip_registry select zcta5 from geo.zcta_boundary on conflict do nothing;

insert into public.dc_acquisition_run (id, source_key, distribution_key, run_seq) values
 ('00000000-0000-0000-0000-00000000a101', 'compute_atlas', 'facilities', 1);

create or replace function pg_temp.atlas(p_name text, p_pid text, p_lat float8, p_lng float8,
    p_operator text, p_city text, p_state text, p_street text, p_postal text, p_status text default 'operational')
returns uuid language sql as $$
  insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key,
      publisher_record_id, raw_payload, source_native_name, source_native_type, source_native_status,
      source_native_operator, source_native_address, source_native_lat, source_native_lon, source_native_precision)
  values ('00000000-0000-0000-0000-00000000a101', 'compute_atlas', 'facilities', p_pid,
      jsonb_build_object('confidence', 'confirmed',
                         'sources', jsonb_build_array(jsonb_build_object('url', 'https://example.org/atlas/' || p_pid))),
      p_name, 'data_center', p_status, p_operator,
      jsonb_build_object('city', p_city, 'state', p_state, 'street', p_street, 'postalCode', p_postal),
      p_lat, p_lng, 'exact')
  returning home_signal_observation_id $$;

-- an operating data centre (a later document only ALTERS it)
select pg_temp.atlas('Fixture Campus Alpha', 'fixture-alpha', 40.1500, -97.4500, 'Alpha Operator',
                     'Alphaton', 'NE', '100 Server Way', '99921');
-- an operating campus (a later document proposes an EXPANSION on the same site)
select pg_temp.atlas('Fixture Campus Beta', 'fixture-beta', 35.1500, -90.0500, 'Beta Operator',
                     'Betaton', 'TN', '200 Rack Road', '99922');
-- an unrelated operating data centre nothing touches
select pg_temp.atlas('Fixture Campus Gamma', 'fixture-gamma', 33.1500, -80.1500, 'Gamma Operator',
                     'Gammaton', 'SC', '300 Cooling Lane', '99925');

select count(*) >= 0 from public.dc_resolve_canonical(true, false);
select count(*) >= 0 from public.dc_resolve_geography(true);

-- THE FINGERPRINTS (claims rules 8/9: md5 over rows ordered collate "C"). Volatile clocks are left out;
-- every decision column is in.
create or replace function public._od_fp() returns table(k text, fp text, n bigint)
language sql as $$
  select 'entity', md5(coalesce(string_agg(x, ',' order by x collate "C"), '')), count(*)
    from (select concat_ws('|', canonical_entity_id, classification, classification_conflict, observation_count,
                           source_count, superseded_by) x from public.dc_canonical_entity) e
  union all
  select 'link', md5(coalesce(string_agg(x, ',' order by x collate "C"), '')), count(*)
    from (select concat_ws('|', canonical_entity_id, home_signal_observation_id, source_key,
                           observation_classification, link_rule_key) x from public.dc_entity_observation) l
  union all
  select 'geography', md5(coalesce(string_agg(x, ',' order by x collate "C"), '')), count(*)
    from (select concat_ws('|', canonical_entity_id, geography_status, geometry_type, lat, lng,
                           authority_observation_id, quality_flags::text) x from public.dc_entity_geography) g
  union all
  select 'map1', md5(coalesce(string_agg(x, ',' order by x collate "C"), '')), count(*)
    from (select concat_ws('|', r.zip, m.source_key, m.project_name, m.map_status, m.lat, m.lng,
                           m.canonical_entity_id, m.publication_basis, m.source_url) x
            from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m) z
$$;

drop table if exists public._od_before;
create table public._od_before as select * from public._od_fp();

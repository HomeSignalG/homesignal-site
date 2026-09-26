-- =====================================================================================
-- THE OPENSTREETMAP LAYER'S ADDRESS CHECK — each OSM pin against its OWN stated address
-- Exercises the SHIPPED chain end to end on a DISPOSABLE PostGIS (never production):
--   docs/dc-step3d-derived-location.sql (extraction + dc_osm_derived_point + the ONE queue),
--   docs/dc-step3b-canonical-geography.sql (dc_osm_address_check, the shared conflict rule),
--   docs/map1-dc-publication.sql and the writer's own queue + load SQL (:queuesql, :loadsql, :qfile).
-- OpenStreetMap is a SEPARATE layer (founder, 2026-09-26): it is checked with the shared rules and
-- never merged into the canonical tables, never moves a pin, and changes nothing on Map 1.
-- Expected answers are HARD-CODED constants. Fixture names live HERE only.
-- Output: one row per check (check|pass|detail); a NULL pass is a failure.
-- =====================================================================================
\set ON_ERROR_STOP 1
create temp table if not exists _r (n serial, check_name text, pass boolean, detail text);
truncate _r;

-- one ZCTA (SRID 4269) holding every fixture
delete from geo.zcta_boundary;
insert into geo.zcta_boundary (zcta5, geom) values
 ('99931', ST_Multi(ST_GeomFromText('POLYGON((-101 45,-100.5 45,-100.5 45.5,-101 45.5,-101 45))', 4269)));
delete from public.national_dc_records;

-- Production-shaped OSM row (docs/national-dc-plane.sql): tags live in raw_tags.
create or replace function pg_temp.osm(p_n int, p_name text, p_lat float8, p_lng float8, p_precision text,
    p_tags jsonb, p_eligible boolean default true)
returns void language sql as $$
  insert into public.national_dc_records (source_key, source_record_id, osm_type, source_url, project_name,
      raw_status, normalized_status, lat, lng, location_precision, raw_tags, map_eligible, map_exclusion_reason)
  values ('osm:way/' || p_n, 'way/' || p_n, 'way', 'https://www.openstreetmap.org/way/' || p_n, p_name,
      'operational', 'operational', p_lat, p_lng, p_precision,
      p_tags || jsonb_build_object('telecom', 'data_center', 'name', p_name), p_eligible,
      case when p_eligible then null else 'fixture: not map eligible' end) $$;
create or replace function pg_temp.addr(p_no text, p_street text, p_city text, p_state text default 'SD',
    p_postcode text default '57031', p_country text default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('addr:housenumber', p_no, 'addr:street', p_street,
      'addr:city', p_city, 'addr:state', p_state, 'addr:postcode', p_postcode, 'addr:country', p_country)) $$;

-- [O1] its own address geocodes ~680 m from its pin: inside the calibrated 2 km bound
select pg_temp.osm(1, 'Corrob OSM', 45.10, -100.90, 'precise_location', pg_temp.addr('20', 'Osm Road', 'Osmton', 'SD', '57031', 'US'));
-- [O2] a mapped outline whose own address geocodes ~3.9 km away
select pg_temp.osm(2, 'Far OSM', 45.20, -100.90, 'approximate_campus_area', pg_temp.addr('30', 'Far Lane', 'Farton'));
-- [O3] the ladder matched nothing: absence of evidence is not evidence against the pin
select pg_temp.osm(3, 'Failed OSM', 45.30, -100.90, 'precise_location', pg_temp.addr('40', 'Fail Way', 'Failton'));
-- [O4] no address tags at all
select pg_temp.osm(4, 'Blank OSM', 45.35, -100.90, 'precise_location', '{}'::jsonb);
-- [O5] the record itself says it is outside the United States
select pg_temp.osm(5, 'Canada OSM', 45.12, -100.60, 'precise_location', pg_temp.addr('5', 'Maple Street', 'Toronto', 'ON', 'M5V 2T6', 'CA'));
-- [O6] a project AREA is not a site claim: geocoded, never judged
select pg_temp.osm(6, 'Area OSM', 45.40, -100.90, 'approximate_project_area', pg_temp.addr('60', 'Area Road', 'Areaton'));
-- [O7] not map eligible: never queued, never derived
select pg_temp.osm(7, 'Hidden OSM', 45.45, -100.90, 'precise_location', pg_temp.addr('70', 'Hidden Road', 'Hideton'), false);
-- [O8] a street with no locality: the one policy refuses it
select pg_temp.osm(8, 'Nolocal OSM', 45.15, -100.70, 'precise_location', pg_temp.addr('80', 'Road Street', null, null, null));
-- [O9] the SAME stated address as a Compute Atlas record: one query, one derivation, both read it
select pg_temp.osm(9, 'Shared OSM', 45.25, -100.70, 'precise_location', pg_temp.addr('10', 'Shared Road', 'Sharedton'));

insert into public.dc_acquisition_run (id, source_key, distribution_key, run_seq) values
 ('00000000-0000-0000-0000-00000000a931', 'compute_atlas', 'facilities', 1);
insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key,
    publisher_record_id, raw_payload, source_native_name, source_native_type, source_native_status,
    source_native_operator, source_native_address, source_native_lat, source_native_lon, source_native_precision)
select '00000000-0000-0000-0000-00000000a931', 'compute_atlas', 'facilities', 'shared-atlas',
    jsonb_build_object('confidence', 'confirmed',
        'location', l || jsonb_build_object('lat', 45.26, 'lon', -100.71, 'precision', 'exact'),
        'sources', jsonb_build_array(jsonb_build_object('url', 'https://example.org/shared-atlas'))),
    'Shared Atlas', 'data_center', 'operational', 'Shared Operator', l, 45.26, -100.71, 'exact'
  from (select jsonb_build_object('street', '10 Shared Road', 'city', 'Sharedton', 'state', 'SD', 'postalCode', '57031') l) x;

create temp table _nat_fp as
select md5(string_agg(t::text, ',' order by t.source_key collate "C")) fp from public.national_dc_records t;
create temp table _obs_fp as
select md5(string_agg(t::text, ',' order by t.home_signal_observation_id)) fp from public.dc_source_observation t;

-- ── before any derivation ────────────────────────────────────────────────────────────
create temp table _chk0 as select * from public.dc_osm_address_check;

-- ── the queue, as the writer reads it ────────────────────────────────────────────────
\o :qfile
\i :queuesql
\o
create temp table _q_all (j text);
\set cp '\\copy _q_all(j) from ' :'qfile'
:cp
create temp table _queue_view as select * from public.dc_geocode_queue;

-- ── the writer's derivations (as the production ladder returns them) ─────────────────
create temp table _dcg_all as
select jsonb_build_object('geocoder_query', q, 'canonical_addr', upper(q),
    'ladder_version', 'production-ladder-v1', 'provider', p, 'match_type', mt, 'lat', la, 'lng', ln,
    'matched_address', ma, 'provider_candidates', c, 'provider_matched_addresses', '[]'::jsonb,
    'run_ref', 'osm-suite') j, grp from (values
 ('20 Osm Road, Osmton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.1050, -100.9050, '20 OSM RD, OSMTON, SD, 57031', 1, 'osm'),
 ('30 Far Lane, Farton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.2000, -100.8500, '30 FAR LN, FARTON, SD, 57031', 1, 'osm'),
 ('40 Fail Way, Failton, SD 57031', 'none', 'failed', null, null, null, null, 'osm'),
 ('60 Area Road, Areaton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.4010, -100.9010, '60 AREA RD, ARETON, SD, 57031', 1, 'osm'),
 ('70 Hidden Road, Hideton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.4500, -100.9000, '70 HIDDEN RD, HIDETON, SD, 57031', 1, 'osm'),
 ('10 Shared Road, Sharedton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.2505, -100.7005, '10 SHARED RD, SHAREDTON, SD, 57031', 1, 'shared')
) v(q, p, mt, la, ln, ma, c, grp);

create or replace function pg_temp.snap_geo() returns text language sql as $$
  select md5(coalesce(string_agg(concat_ws('|', canonical_entity_id, geography_status, geometry_type,
             positional_uncertainty_m, ST_AsText(geom), lat, lng, authority_source_key,
             authority_observation_id, quality_flags::text, rule_key, rule_version,
             provenance::text), ',' order by canonical_entity_id), '')) from public.dc_entity_geography $$;
create or replace function pg_temp.snap_pages() returns text language sql as $$
  select md5(coalesce(string_agg(m::text, ',' order by m::text collate "C"), ''))
    from geo.zcta_boundary z cross join lateral public.map1_dc_zip_members(z.zcta5) m $$;
create or replace function pg_temp.snap_identity() returns text language sql as $$
  select md5(concat_ws('#',
    (select string_agg(concat_ws('|', canonical_entity_id, entity_grain, classification, superseded_by), ',' order by canonical_entity_id) from public.dc_canonical_entity),
    (select string_agg(concat_ws('|', canonical_entity_id, home_signal_observation_id, link_rule_key), ',' order by home_signal_observation_id) from public.dc_entity_observation))) $$;

-- ── STEP 0: the canonical pipeline as it stands, no OSM derivation ───────────────────
select count(*) >= 0 from public.dc_resolve_canonical(true, false);
select count(*) >= 0 from public.dc_resolve_geography(true);
create temp table _s0 as select pg_temp.snap_geo() g, pg_temp.snap_pages() p, pg_temp.snap_identity() i;
create temp table _pages0 as select m.* from geo.zcta_boundary z cross join lateral public.map1_dc_zip_members(z.zcta5) m;

-- ── STEP 1: the OSM-only derivations, through the SAME writer load ───────────────────
create temp table _dcg_in (j jsonb);
insert into _dcg_in select j from _dcg_all where grp = 'osm';
\i :loadsql
select count(*) >= 0 from public.dc_resolve_canonical(true, false);
select count(*) >= 0 from public.dc_resolve_geography(true);
create temp table _s1 as select pg_temp.snap_geo() g, pg_temp.snap_pages() p, pg_temp.snap_identity() i;
create temp table _chk1 as select * from public.dc_osm_address_check;

-- ── STEP 2: the address both layers state ────────────────────────────────────────────
truncate _dcg_in;
insert into _dcg_in select j from _dcg_all where grp = 'shared';
\i :loadsql
create temp table _chk2 as select * from public.dc_osm_address_check;

create or replace function pg_temp.o(p_name text) returns text language sql as $$
  select c.check_outcome from _chk2 c join public.national_dc_records r on r.id = c.osm_record_id
   where r.project_name = p_name $$;

-- ── W. EXTRACTION + POLICY ───────────────────────────────────────────────────────────
insert into _r (check_name, pass, detail)
select 'W01 the OSM extraction composes the record''s OWN addr:* tags; a non-US record says so; nothing guessed',
       (select row(extraction, address_line) from public.dc_publisher_stated_address('openstreetmap', 'telecom_data_center',
            pg_temp.addr('20', 'Osm Road', 'Osmton', 'SD', '57031', 'US')))
         = row('STATED'::text, '20 Osm Road, Osmton, SD 57031'::text)
   and (select row(extraction, address_line) from public.dc_publisher_stated_address('openstreetmap', 'telecom_data_center',
            pg_temp.addr('30', 'Far Lane', 'Farton')))
         = row('STATED'::text, '30 Far Lane, Farton, SD 57031'::text)
   and (select extraction from public.dc_publisher_stated_address('openstreetmap', 'telecom_data_center',
            pg_temp.addr('5', 'Maple Street', 'Toronto', 'ON', 'M5V 2T6', 'CA'))) = 'NOT_US'
   and (select row(extraction, address_line) from public.dc_publisher_stated_address('openstreetmap', 'telecom_data_center',
            jsonb_build_object('addr:street', 'Osm Road', 'addr:city', 'Osmton', 'addr:state', 'SD')))
         = row('STATED'::text, ''::text)
   and (select extraction from public.dc_publisher_stated_address('openstreetmap', 'other_distribution',
            pg_temp.addr('20', 'Osm Road', 'Osmton'))) = 'NO_RULE',
       null;

insert into _r (check_name, pass, detail)
select 'W02 the policy is the SAME for OSM as for every source: one line, one verdict',
       not exists (select 1 from public.national_dc_records r
                    cross join lateral public.dc_publisher_stated_address('openstreetmap', 'telecom_data_center', r.raw_tags) x
                    cross join lateral public.dc_geocode_input('openstreetmap', 'telecom_data_center', r.raw_tags) gi
                    where x.extraction = 'STATED'
                      and row(gi.input_quality, gi.geocoder_query) is distinct from
                          (select row(input_quality, geocoder_query) from public.dc_geocodable_site_address(x.address_line))),
       (select string_agg(r.project_name || '=' || gi.input_quality, ' ' order by r.project_name)
          from public.national_dc_records r
         cross join lateral public.dc_geocode_input('openstreetmap', 'telecom_data_center', r.raw_tags) gi);

insert into _r (check_name, pass, detail)
select 'W03 ONE queue: every map-eligible geocodable OSM address, the shared address once, nothing ineligible',
       (select count(*) from _q_all) = 5
   and (select array_agg(j::jsonb->>'geocoder_query' order by j::jsonb->>'geocoder_query' collate "C") from _q_all)
       = array['10 Shared Road, Sharedton, SD 57031', '20 Osm Road, Osmton, SD 57031', '30 Far Lane, Farton, SD 57031',
               '40 Fail Way, Failton, SD 57031', '60 Area Road, Areaton, SD 57031']::text[]
   and (select array_agg(geocoder_query order by geocoder_query collate "C") from _queue_view)
       = array['10 Shared Road, Sharedton, SD 57031', '20 Osm Road, Osmton, SD 57031', '30 Far Lane, Farton, SD 57031',
               '40 Fail Way, Failton, SD 57031', '60 Area Road, Areaton, SD 57031']::text[]
   and (select bool_and(admitted = (geocoder_query = '10 Shared Road, Sharedton, SD 57031')) from _queue_view),
       (select count(*)::text || ' queued: ' || string_agg(geocoder_query || '(' || admitted || ')', ' ; ' order by geocoder_query collate "C") from _queue_view);

insert into _r (check_name, pass, detail)
select 'W04 the load writes only queued OSM queries: the ineligible record''s derivation is refused',
       (select count(*) from public.dc_address_geocode where run_ref = 'osm-suite') = 5
   and not exists (select 1 from public.dc_address_geocode where geocoder_query = '70 Hidden Road, Hideton, SD 57031')
   and (select count(*) from public.dc_address_geocode where geocoder_query = '10 Shared Road, Sharedton, SD 57031') = 1,
       (select string_agg(geocoder_query, ' ; ' order by geocoder_query collate "C") from public.dc_address_geocode);

-- ── the check outcomes ───────────────────────────────────────────────────────────────
insert into _r (check_name, pass, detail)
select 'W05 before any derivation every geocodable pin is UNCHECKED_NOT_YET_GEOCODED, never judged',
       (select count(*) from _chk0 where input_quality = 'GEOCODABLE') = 6
   and not exists (select 1 from _chk0 where input_quality = 'GEOCODABLE' and check_outcome <> 'UNCHECKED_NOT_YET_GEOCODED')
   and not exists (select 1 from _chk0 where check_outcome in ('CORROBORATED', 'SOURCES_DISAGREE')),
       (select string_agg(distinct check_outcome, ' ') from _chk0);

insert into _r (check_name, pass, detail)
select 'W06 [corroborated] its own address ~680 m from its pin: CORROBORATED by the shared conflict rule',
       pg_temp.o('Corrob OSM') = 'CORROBORATED'
   and (select distance_m between 600 and 760 from _chk2 c join public.national_dc_records r on r.id = c.osm_record_id
         where r.project_name = 'Corrob OSM')
   and (select verdict = 'ACCEPTED' and positional_uncertainty_m = 2000 and osm_claim_class = 'PUBLISHER_SITE'
          from _chk2 c join public.national_dc_records r on r.id = c.osm_record_id where r.project_name = 'Corrob OSM'),
       pg_temp.o('Corrob OSM');

insert into _r (check_name, pass, detail)
select 'W07 [disagree] a mapped outline whose own address is ~3.9 km away: SOURCES_DISAGREE',
       pg_temp.o('Far OSM') = 'SOURCES_DISAGREE'
   and (select distance_m > 2000 from _chk2 c join public.national_dc_records r on r.id = c.osm_record_id
         where r.project_name = 'Far OSM'),
       pg_temp.o('Far OSM');

insert into _r (check_name, pass, detail)
select 'W08 [absence is not evidence] no match, no address, not US, no locality, an area claim: UNCHECKED_*, never a verdict against the pin',
       pg_temp.o('Failed OSM') = 'UNCHECKED_REJECTED_NO_MATCH'
   and pg_temp.o('Blank OSM') = 'UNCHECKED_BLANK'
   and pg_temp.o('Canada OSM') = 'UNCHECKED_NOT_US'
   and pg_temp.o('Nolocal OSM') = 'UNCHECKED_NO_LOCALITY'
   and pg_temp.o('Area OSM') = 'UNCHECKED_NO_SITE_CLAIM',
       concat_ws(' ', pg_temp.o('Failed OSM'), pg_temp.o('Blank OSM'), pg_temp.o('Canada OSM'),
                 pg_temp.o('Nolocal OSM'), pg_temp.o('Area OSM'));

insert into _r (check_name, pass, detail)
select 'W09 [one geocoder, one cache] the address both layers state has ONE derivation, read by both',
       pg_temp.o('Shared OSM') = 'CORROBORATED'
   and (select c.derivation_id from _chk2 c join public.national_dc_records r on r.id = c.osm_record_id
         where r.project_name = 'Shared OSM')
       = (select d.derivation_id from public.dc_observation_derived_point d
           join public.dc_current_observation o using (home_signal_observation_id)
          where o.source_native_name = 'Shared Atlas'),
       pg_temp.o('Shared OSM');

insert into _r (check_name, pass, detail)
select 'W10 OSM is NOT admitted: every OSM row reports admitted = false; Atlas and Epoch remain admitted',
       not public.dc_derived_address_admitted('openstreetmap', 'telecom_data_center')
   and public.dc_derived_address_admitted('compute_atlas', 'facilities')
   and public.dc_derived_address_admitted('epoch_ai', 'data_centers')
   and not exists (select 1 from _chk2 where admitted),
       null;

-- ── separate layer: nothing merges, nothing moves, Map 1 unchanged ───────────────────
insert into _r (check_name, pass, detail)
select 'W11 [Map 1 unchanged] loading every OSM derivation left geography, identity and every Map 1 row byte-identical',
       (select g from _s0) = (select g from _s1)
   and (select i from _s0) = (select i from _s1)
   and (select p from _s0) = (select p from _s1)
   and (select count(*) from _pages0 where publication_basis = 'legacy_osm_compat') = 8,   -- control: OSM is on the page
       (select count(*)::text || ' OSM rows on 99931' from _pages0 where publication_basis = 'legacy_osm_compat');

insert into _r (check_name, pass, detail)
select 'W12 [never merged] no OSM record enters the canonical pipeline: no observation, no derived-point row, no entity',
       not exists (select 1 from public.dc_source_observation where source_key ilike '%openstreetmap%' or source_key ilike 'osm%')
   and not exists (select 1 from public.dc_observation_derived_point where source_key ilike '%openstreetmap%' or source_key ilike 'osm%')
   and (select count(*) from public.dc_entity_observation) = (select count(*) from public.dc_source_observation),   -- control: one Atlas record, linked
       (select count(*)::text || ' canonical links' from public.dc_entity_observation);

insert into _r (check_name, pass, detail)
select 'W13 [never moved] every OSM pin and tag is exactly as loaded; publisher observations are untouched',
       (select md5(string_agg(t::text, ',' order by t.source_key collate "C")) from public.national_dc_records t) = (select fp from _nat_fp)
   and (select md5(string_agg(t::text, ',' order by t.home_signal_observation_id)) from public.dc_source_observation t) = (select fp from _obs_fp)
   and not exists (select 1 from _chk2 c join public.national_dc_records r on r.id = c.osm_record_id
                    where c.osm_lat is distinct from r.lat or c.osm_lng is distinct from r.lng),
       null;

insert into _r (check_name, pass, detail)
select 'W14 the Map 1 reader does not read the OSM check (it is evidence only until an automated-gated change)',
       (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'map1_dc_zip_members') !~ 'dc_osm_(derived_point|address_check)'
   and (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'map1_dc_zip_members') ~ 'national_dc_records',   -- control
       null;

insert into _r (check_name, pass, detail)
select 'W15 service-role only: anon and authenticated can read neither OSM view',
       not has_table_privilege('anon', 'public.dc_osm_derived_point', 'select')
   and not has_table_privilege('authenticated', 'public.dc_osm_derived_point', 'select')
   and not has_table_privilege('anon', 'public.dc_osm_address_check', 'select')
   and not has_table_privilege('authenticated', 'public.dc_osm_address_check', 'select'),
       null;

select check_name, coalesce(pass, false), coalesce(detail, '') from _r order by n;

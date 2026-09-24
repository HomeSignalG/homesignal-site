-- =====================================================================================
-- EPOCH CANONICAL GEOGRAPHY — ZERO-HUMAN END-TO-END ADVERSARIAL SUITE
-- Exercises the SHIPPED files end to end on a DISPOSABLE PostGIS:
--   docs/dc-step3d-derived-location.sql, docs/dc-step3a-canonical-identity.sql,
--   docs/dc-step3b-canonical-geography.sql, docs/map1-dc-publication.sql, and the writer's
--   own load SQL (psql variable :loadsql, default docs/dc-geocode-observations-load.sql).
-- NO PERSON IS IN THIS LOOP: there is no review table, no hand-entered pair, no manual SQL
-- adjudication and no facility-specific override. Acquisition -> record identity -> derivation ->
-- automatic identity -> geography -> lifecycle -> ZIP membership -> map1_dc_zip_members, run by
-- the scheduled functions alone, twice (idempotency), after a second acquisition that brings new
-- evidence (automatic re-evaluation).
-- Every expected answer is a HARD-CODED constant. Fixture names (Ellendale, CoreWeave, Colossus
-- ...) live HERE only; production files may not branch on them.
-- Output: one row per check (check|pass|detail); a NULL pass is a failure.
-- =====================================================================================
\set ON_ERROR_STOP 1
create temp table if not exists _r (n serial, check_name text, pass boolean, detail text);
truncate _r;

-- ── ZCTAs (SRID 4269). 99911 and 99912 share the meridian -99.0. ──────────────────────
delete from geo.zcta_boundary;
insert into geo.zcta_boundary (zcta5, geom) values
 ('99911', ST_Multi(ST_GeomFromText('POLYGON((-99.5 46,-99 46,-99 46.5,-99.5 46.5,-99.5 46))', 4269))),
 ('99912', ST_Multi(ST_GeomFromText('POLYGON((-99 46,-98.5 46,-98.5 46.5,-99 46.5,-99 46))', 4269))),
 ('99913', ST_Multi(ST_GeomFromText('POLYGON((-97.6 40,-97.3 40,-97.3 40.3,-97.6 40.3,-97.6 40))', 4269))),
 ('99914', ST_Multi(ST_GeomFromText('POLYGON((-90.2 35,-89.9 35,-89.9 35.3,-90.2 35.3,-90.2 35))', 4269))),
 ('99915', ST_Multi(ST_GeomFromText('POLYGON((-95.9 41,-95.6 41,-95.6 41.3,-95.9 41.3,-95.9 41))', 4269))),
 ('99916', ST_Multi(ST_GeomFromText('POLYGON((-96.3 41,-96.0 41,-96.0 41.3,-96.3 41.3,-96.3 41))', 4269))),
 -- 99918 / 99919 share an edge (-104.0), far from every other fixture (no identity recall net
 -- reaches them): the canonical geography authority fixtures, observed in isolation
 ('99918', ST_Multi(ST_GeomFromText('POLYGON((-104.3 44,-104.0 44,-104.0 44.3,-104.3 44.3,-104.3 44))', 4269))),
 ('99919', ST_Multi(ST_GeomFromText('POLYGON((-104.0 44,-103.7 44,-103.7 44.3,-104.0 44.3,-104.0 44))', 4269)));
delete from public.national_dc_records;

-- ── runs ─────────────────────────────────────────────────────────────────────────────
insert into public.dc_acquisition_run (id, source_key, distribution_key, run_seq) values
 ('00000000-0000-0000-0000-00000000a001', 'compute_atlas', 'facilities', 1),
 ('00000000-0000-0000-0000-00000000e000', 'epoch_ai', 'data_centers', 0);

create or replace function pg_temp.atlas(p_name text, p_pid text, p_lat float8, p_lng float8,
    p_notes text, p_operator text, p_city text, p_state text,
    p_street text default null, p_postal text default null, p_status text default 'operational',
    p_type text default 'data_center')
returns uuid language sql as $$
  insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key,
      publisher_record_id, raw_payload, source_native_name, source_native_type, source_native_status,
      source_native_operator, source_native_address, source_native_lat, source_native_lon,
      source_native_precision)
  values ('00000000-0000-0000-0000-00000000a001', 'compute_atlas', 'facilities', p_pid,
      jsonb_build_object('notes', p_notes, 'confidence', 'confirmed',
                         'sources', jsonb_build_array(jsonb_build_object('url', 'https://example.org/' || p_pid))),
      p_name, p_type, p_status, p_operator,
      jsonb_strip_nulls(jsonb_build_object('city', p_city, 'state', p_state, 'street', p_street, 'postalCode', p_postal)),
      p_lat, p_lng, 'exact')
  returning home_signal_observation_id $$;

-- Production-shaped Epoch record: NO lifecycle (measured 2026-09-24: 92/92 status NULL) and its
-- citations as the publisher's own "Selected Sources" markdown. p_cited = false drops them.
create or replace function pg_temp.epoch(p_run uuid, p_name text, p_address text,
    p_operator text default null, p_country text default 'United States', p_cited boolean default true)
returns uuid language sql as $$
  insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key,
      raw_payload, source_native_name, source_native_status, source_native_operator,
      source_native_address)
  values (p_run, 'epoch_ai', 'data_centers',
      jsonb_build_object('Name', p_name, 'Address', p_address, 'Country', p_country, 'Owner', p_operator)
        || case when p_cited
                then jsonb_build_object('Selected Sources',
                        '- [Operator announcement](https://example.org/epoch/' || replace(p_name, ' ', '-') || ')' || chr(10))
                else '{}'::jsonb end,
      p_name, null, p_operator,
      jsonb_build_object('Address', p_address, 'Country', p_country))
  returning home_signal_observation_id $$;

-- ── ATLAS ────────────────────────────────────────────────────────────────────────────
-- Ellendale: the publisher's own words say this point is the town centroid; it ALSO states the
-- site's street address, which Epoch states too (tenant vs operator: CoreWeave vs Applied Digital).
select pg_temp.atlas('Applied Digital Polaris Forge 1', 'applied-digital-polaris-forge-1-ellendale-nd',
    46.25, -99.25, 'Campus is 400 MW. Coordinates are Ellendale city centroid; exact site unpublished.',
    'Applied Digital Corporation', 'Ellendale', 'ND', '9685 87th Avenue Southeast', null, 'under_construction');
select pg_temp.atlas('Google Council Bluffs Data Center', 'google-council-bluffs', 41.15, -95.75,
    'Coordinates are the county auditor parcel centroid.', 'Google', 'Council Bluffs', 'IA', null, '51503');
select pg_temp.atlas('Colossus 2 (Whitehaven)', 'xai-colossus-2', 35.15, -90.05,
    'Coordinates are the building footprint centroid.', 'xAI', 'Memphis', 'TN', '5400 Tulane Road');
select pg_temp.atlas('Minihard', 'xai-minihard', 35.16, -90.06,
    'Coordinates are the building footprint centroid.', 'xAI', 'Memphis', 'TN', '5414 Tulane Road');
select pg_temp.atlas('Site Point Campus', 'site-point-campus', 40.28, -97.35,
    'Coordinates are the parcel centroid.', 'Site Operator', 'Northtown', 'KS', '500 Far Road');
select pg_temp.atlas('Meta Hyperion', 'meta-hyperion', 32.5, -91.5,
    'Coordinates are the parcel centroid.', 'Meta', 'Holly Ridge', 'LA');
select pg_temp.atlas('Pine Hollow DC', 'pine-hollow', 41.15, -96.15,
    'Coordinates are the building footprint centroid.', 'Pine Op', 'Pinetown', 'IA', '44 Pine Hollow Rd');
select pg_temp.atlas('Hub Campus Hall A', 'hub-hall-a', 40.26, -97.45,
    'Coordinates are the building footprint centroid.', 'Hub Op', 'Hubtown', 'KS', '700 Hub Road');
select pg_temp.atlas('Hub Campus Hall B', 'hub-hall-b', 40.262, -97.452,
    'Coordinates are the building footprint centroid.', 'Hub Op', 'Hubtown', 'KS', '700 Hub Road');
select pg_temp.atlas('Twin Park Building 1', 'twin-park-1', 41.1012, -96.1012,
    'Coordinates are the building footprint centroid.', 'Twin Op', 'Parkville', 'KS', '31 Park Road');
select pg_temp.atlas('Gone Campus', 'gone-campus', 40.2001, -97.4001,
    'Coordinates are the parcel centroid.', 'Gone Op', 'Goneville', 'KS', '77 Gone Road', null, 'cancelled');
select pg_temp.atlas('Late DC', 'late-dc', 40.29, -97.58,
    'Coordinates are the building footprint centroid.', 'Late Op', 'Latetown', 'KS', '600 Late Road');
-- a power plant at a data centre's address: two kinds of facility can share an address
select pg_temp.atlas('Grid Station', 'grid-station', 40.6012, -97.1012,
    'Coordinates are the plant footprint centroid.', 'Grid Utility', 'Gridville', 'KS', '88 Grid Road',
    null, 'operational', 'power_generation');
-- the same street line, but the two records state different postal codes
select pg_temp.atlas('Postal Park', 'postal-park', 40.7012, -97.2012,
    'Coordinates are the building footprint centroid.', 'Postal Op', 'Postville', 'KS', '12 Postal Road', '66010');

-- ── CANONICAL GEOGRAPHY AUTHORITY (rule_version 4): a publisher SITE point + another source's
-- DERIVED address point of the SAME facility (both records state the same street address)
-- [A/H] the derived point 1.5 km away: inside its calibrated 2 km bound -> it corroborates
select pg_temp.atlas('Corroborated DC', 'corroborated-dc', 44.1012, -104.2012,
    'Coordinates are the building footprint centroid.', 'Corrob Op', 'Corrob', 'KS', '41 Corrob Road');
-- [G] the two points 1.5 km apart on either side of a ZCTA edge: the ZIPs do not vote
select pg_temp.atlas('Border DC', 'border-dc', 44.1512, -104.0088,
    'Coordinates are the building footprint centroid.', 'Border Op', 'Borderton', 'KS', '52 Border Road');
-- [B, the Lancaster shape] a 4-decimal "exact" point 17 m from a ZCTA edge with no location note,
-- whose OWN street address geocodes 4.4 km away in the next ZCTA; the geocoder's ZIP names the
-- publisher point's polygon (so a provider-ZIP tie-break would wrongly settle it)
select pg_temp.atlas('Far Address DC', 'far-address-dc', 44.0510, -104.0002,
    null, 'Far Op', 'Farville', 'KS', '216 Far Address Road', null, 'planned');

-- ── EPOCH run 0 (history once run 1 lands) ───────────────────────────────────────────
select pg_temp.epoch('00000000-0000-0000-0000-00000000e000', 'CoreWeave Ellendale ND',
    '9685 87th Ave SE, Ellendale, ND 58436', 'CoreWeave');
select pg_temp.epoch('00000000-0000-0000-0000-00000000e000', 'Colossus 2',
    '5420 Tulane Rd, Memphis, TN 38109', 'xAI');
-- the address is not yet stated: nothing links it to Atlas "Late DC" today
select pg_temp.epoch('00000000-0000-0000-0000-00000000e000', 'Late Campus', 'Latetown, KS', 'Late Op');

select count(*) >= 0 as resolved_run0 from public.dc_resolve_canonical(true, false);

-- a LEGACY fork, as rule version 1 left it: two entities for the same Epoch name, one per run
insert into public.dc_acquisition_run (id, source_key, distribution_key, run_seq) values
 ('00000000-0000-0000-0000-00000000e0f0', 'epoch_ai', 'data_centers', -1);
create temp table _legacy (legacy_entity uuid, legacy_obs uuid);
with o as (select pg_temp.epoch('00000000-0000-0000-0000-00000000e0f0', 'CoreWeave Ellendale ND',
                                '9685 87th Ave SE, Ellendale, ND 58436', 'CoreWeave') oid),
     e as (insert into public.dc_canonical_entity (entity_grain, classification, rule_version,
                                                   observation_count, source_count, created_at)
           values ('SITE', 'CONFIRMED_DC', 1, 1, 1, now() + interval '1 hour') returning canonical_entity_id),
     l as (insert into public.dc_entity_observation (canonical_entity_id, home_signal_observation_id, source_key,
               distribution_key, observation_classification, classification_rule_key, classification_evidence, link_rule_key)
           select e.canonical_entity_id, o.oid, 'epoch_ai', 'data_centers', 'CONFIRMED_DC',
                  'EPOCH_DISTRIBUTION_SCOPE_IS_DATA_CENTERS', '{}'::jsonb, 'SINGLETON_NO_PUBLISHER_RECORD_ID'
             from o, e returning canonical_entity_id, home_signal_observation_id)
insert into _legacy select canonical_entity_id, home_signal_observation_id from l;

create temp table _e0 as
select o.source_native_name nm, eo.canonical_entity_id from public.dc_entity_observation eo
  join public.dc_source_observation o using (home_signal_observation_id)
 where o.acquisition_run_id = '00000000-0000-0000-0000-00000000e000';

-- ── EPOCH run 1 (current) ────────────────────────────────────────────────────────────
insert into public.dc_acquisition_run (id, source_key, distribution_key, run_seq) values
 ('00000000-0000-0000-0000-00000000e001', 'epoch_ai', 'data_centers', 1);
\set E '\'00000000-0000-0000-0000-00000000e001\''
select pg_temp.epoch(:E, 'CoreWeave Ellendale ND', '9685 87th Ave SE, Ellendale, ND 58436', 'CoreWeave');
select pg_temp.epoch(:E, 'Colossus 2', '5420 Tulane Rd, Memphis, TN 38109', 'xAI');
select pg_temp.epoch(:E, 'Google Council Bluffs (East)', '10410 Bunge Ave, Council Bluffs, IA 51503', 'Google');
select pg_temp.epoch(:E, 'Site Point Epoch', '500 Far Rd, Northtown, KS 66000', 'Site Operator');
select pg_temp.epoch(:E, 'Pine Hollow', '44 Pine Hollow Road, Pinetown, IA 51000', 'Pine Tenant');
select pg_temp.epoch(:E, 'Hub Campus', '700 Hub Rd, Hubtown, KS 66002', 'Hub Tenant');
select pg_temp.epoch(:E, 'Twin Park Building 2', '31 Park Rd, Parkville, KS 66004', 'Twin Op');
select pg_temp.epoch(:E, 'Gone Campus', '77 Gone Rd, Goneville, KS 66006', 'Gone Op');
select pg_temp.epoch(:E, 'Late Campus', '600 Late Rd, Latetown, KS 66003', 'Late Op');
select pg_temp.epoch(:E, 'Solo Campus', '100 Prairie Rd, Testville, KS 66001', 'Solo');
select pg_temp.epoch(:E, 'Corroborated Epoch', '41 Corrob Rd, Corrob, KS 66020', 'Corrob Tenant');
select pg_temp.epoch(:E, 'Border Epoch', '52 Border Rd, Borderton, KS 66021', 'Border Tenant');
select pg_temp.epoch(:E, 'Far Address Epoch', '216 Far Address Rd, Farville, KS 66022', 'Far Tenant');
select pg_temp.epoch(:E, 'Grid Campus', '88 Grid Rd, Gridville, KS 66012', 'Grid Tenant');
select pg_temp.epoch(:E, 'Postal Park Epoch', '12 Postal Rd, Postville, KS 66011', 'Postal Op');
select pg_temp.epoch(:E, 'Uncited Campus', '800 Quiet Rd, Quietville, ND 58400', 'Quiet', 'United States', false);
select pg_temp.epoch(:E, 'Edge Campus', '300 Line Rd, Oakes, ND 58474', 'Edge');
select pg_temp.epoch(:E, 'Anthropic Lake Site', '7725 Lake Rd, Barker, NY 14012', 'Anthropic');
select pg_temp.epoch(:E, 'Core42 Lake Site', '7725 Lake Rd, Barker, NY 14012', 'Core42');
select pg_temp.epoch(:E, 'Meta Hyperion', 'Holly Ridge, LA 71269', 'Meta');
select pg_temp.epoch(:E, 'Blank Address', '');
select pg_temp.epoch(:E, 'City Only', 'Cheyenne, WY 82007, USA');
select pg_temp.epoch(:E, 'Zip Only', '82007');
select pg_temp.epoch(:E, 'Road Only', 'Co Rd 42, Montgomery, AL 36105, USA');
select pg_temp.epoch(:E, 'No Locality', '13360 Miller Rd NW');
select pg_temp.epoch(:E, 'Number Range', '14436-14998 Fairview Rd, Springfield, NE 68059, USA');
select pg_temp.epoch(:E, 'Geocode Failed', '1 Meta Way, Gallatin, TN 37066');
select pg_temp.epoch(:E, 'Zip Centroid', '2 Zip Rd, Testville, KS 66001');
select pg_temp.epoch(:E, 'County Centroid', '3 County Rd, Testville, KS 66001');
select pg_temp.epoch(:E, 'Ambiguous', '1772 145th St, Rosemount, MN 55068');
select pg_temp.epoch(:E, 'House Diverges', '1401 Meadow Pkwy, Chester, VA 23836');
select pg_temp.epoch(:E, 'State Diverges', '5 State Rd, Testville, KS 66001');
select pg_temp.epoch(:E, 'Twin Name', '9 Twin Rd, Testville, KS 66001');
select pg_temp.epoch(:E, 'Twin Name', '10 Twin Rd, Testville, KS 66001');
select pg_temp.epoch(:E, 'Offshore', 'Valhallarbraut 868, 262 Reykjanesbaer, Iceland', null, 'Iceland');

-- ── the writer's derivations, loaded through the writer's OWN load SQL ─────────────────
create temp table _dcg_in (j jsonb);
insert into _dcg_in select jsonb_build_object('geocoder_query', q, 'canonical_addr', upper(q),
    'ladder_version', 'production-ladder-v1', 'provider', p, 'match_type', mt, 'lat', la, 'lng', ln,
    'matched_address', ma, 'provider_candidates', c, 'provider_matched_addresses', '[]'::jsonb,
    'run_ref', 'suite') from (values
 ('9685 87th Ave SE, Ellendale, ND 58436', 'census_onelineaddress', 'range_interpolated', 46.30, -99.20, '9685 87TH AVE SE, ELLENDALE, ND, 58436', 1),
 ('5420 Tulane Rd, Memphis, TN 38109', 'census_onelineaddress', 'range_interpolated', 35.155, -90.055, '5420 TULANE RD, MEMPHIS, TN, 38109', 1),
 ('10410 Bunge Ave, Council Bluffs, IA 51503', 'census_onelineaddress', 'range_interpolated', 41.151, -95.751, '10410 BUNGE AVE, COUNCIL BLUFFS, IA, 51503', 1),
 ('500 Far Rd, Northtown, KS 66000', 'census_onelineaddress', 'range_interpolated', 40.22, -97.35, '500 FAR RD, NORTHTOWN, KS, 66000', 1),
 ('44 Pine Hollow Road, Pinetown, IA 51000', 'census_onelineaddress', 'range_interpolated', 41.1505, -96.1505, '44 PINE HOLLOW RD, PINETOWN, IA, 51000', 1),
 ('700 Hub Rd, Hubtown, KS 66002', 'census_onelineaddress', 'range_interpolated', 40.2605, -97.4505, '700 HUB RD, HUBTOWN, KS, 66002', 1),
 ('31 Park Rd, Parkville, KS 66004', 'census_onelineaddress', 'range_interpolated', 41.101, -96.101, '31 PARK RD, PARKVILLE, KS, 66004', 1),
 ('77 Gone Rd, Goneville, KS 66006', 'census_onelineaddress', 'range_interpolated', 40.2002, -97.4002, '77 GONE RD, GONEVILLE, KS, 66006', 1),
 ('600 Late Rd, Latetown, KS 66003', 'census_onelineaddress', 'range_interpolated', 40.2901, -97.5801, '600 LATE RD, LATETOWN, KS, 66003', 1),
 ('100 Prairie Rd, Testville, KS 66001', 'census_onelineaddress', 'range_interpolated', 40.05, -97.55, '100 PRAIRIE RD, TESTVILLE, KS, 99912', 1),
 ('800 Quiet Rd, Quietville, ND 58400', 'census_onelineaddress', 'range_interpolated', 46.05, -98.80, '800 QUIET RD, QUIETVILLE, ND, 58400', 1),
 ('300 Line Rd, Oakes, ND 58474', 'census_onelineaddress', 'range_interpolated', 46.10, -99.01, '300 LINE RD, OAKES, ND, 99911', 1),
 ('7725 Lake Rd, Barker, NY 14012', 'census_onelineaddress', 'range_interpolated', 46.40, -99.40, '7725 LAKE RD, BARKER, NY, 14012', 1),
 ('1 Meta Way, Gallatin, TN 37066', 'none', 'failed', null, null, null, null),
 ('2 Zip Rd, Testville, KS 66001', 'some_rung', 'zip_centroid', 40.10, -97.50, '2 ZIP RD, TESTVILLE, KS, 66001', 1),
 ('3 County Rd, Testville, KS 66001', 'some_rung', 'county_centroid', 40.12, -97.48, '3 COUNTY RD, TESTVILLE, KS, 66001', 1),
 ('1772 145th St, Rosemount, MN 55068', 'census_onelineaddress', 'range_interpolated', 40.13, -97.52, '1772 145TH ST E, ROSEMOUNT, MN, 55068', 2),
 ('1401 Meadow Pkwy, Chester, VA 23836', 'census_onelineaddress', 'range_interpolated', 40.16, -97.53, '1400 MEADOW PKWY, CHESTER, VA, 23836', 1),
 ('5 State Rd, Testville, KS 66001', 'census_onelineaddress', 'range_interpolated', 40.17, -97.54, '5 STATE RD, TESTVILLE, MO, 66001', 1),
 ('9 Twin Rd, Testville, KS 66001', 'census_onelineaddress', 'range_interpolated', 40.08, -97.58, '9 TWIN RD, TESTVILLE, KS, 99913', 1),
 ('10 Twin Rd, Testville, KS 66001', 'census_onelineaddress', 'range_interpolated', 40.09, -97.40, '10 TWIN RD, TESTVILLE, KS, 99913', 1),
 ('41 Corrob Rd, Corrob, KS 66020', 'census_onelineaddress', 'range_interpolated', 44.1147, -104.2012, '41 CORROB RD, CORROB, KS, 66020', 1),
 ('52 Border Rd, Borderton, KS 66021', 'census_onelineaddress', 'range_interpolated', 44.1512, -103.9912, '52 BORDER RD, BORDERTON, KS, 66021', 1),
 ('216 Far Address Rd, Farville, KS 66022', 'census_onelineaddress', 'range_interpolated', 44.0615, -103.9500, '216 FAR ADDRESS RD, FARVILLE, KS, 99918', 1),
 -- a query nobody queued: the load must refuse it
 ('999 Not Queued Rd, Nowhere, KS 66001', 'census_onelineaddress', 'range_interpolated', 40.11, -97.44, '999 NOT QUEUED RD, NOWHERE, KS, 66001', 1)
) v(q, p, mt, la, ln, ma, c);

create temp table _queue_before as select geocoder_query from public.dc_geocode_queue;
\i :loadsql

-- ── the scheduled resolvers, twice each (idempotency) ────────────────────────────────
create temp table _c1 as select * from public.dc_resolve_canonical(true, false);
create temp table _c2 as select * from public.dc_resolve_canonical(true, false);
create temp table _g1 as select * from public.dc_resolve_geography(true);
create temp table _g2 as select * from public.dc_resolve_geography(true);

create or replace function pg_temp.ent(p_name text, p_source text default 'epoch_ai') returns uuid
language sql as $$
  select eo.canonical_entity_id from public.dc_entity_observation eo
    join public.dc_current_observation c using (home_signal_observation_id)
   where c.source_native_name = p_name and c.source_key = p_source
   order by c.home_signal_observation_id limit 1 $$;
create or replace function pg_temp.geo(p_name text, p_source text default 'epoch_ai')
returns public.dc_entity_geography language sql as $$
  select g.* from public.dc_entity_geography g where g.canonical_entity_id = pg_temp.ent(p_name, p_source) $$;
create or replace function pg_temp.page(p_zip text) returns table(project_name text, lat float8, lng float8,
    map_status text, developer_or_operator text, source_name text, source_url text, canonical_entity_id uuid)
language sql as $$ select project_name, lat, lng, map_status, developer_or_operator, source_name, source_url, canonical_entity_id
                     from public.map1_dc_zip_members(p_zip) where publication_basis = 'canonical' $$;
create or replace function pg_temp.allpages() returns table(zip text, project_name text, map_status text,
    canonical_entity_id uuid)
language sql as $$ select z.zcta5, m.project_name, m.map_status, m.canonical_entity_id
                     from geo.zcta_boundary z cross join lateral pg_temp.page(z.zcta5) m $$;
create or replace function pg_temp.verdict(p_name text) returns text language sql as $$
  select d.verdict from public.dc_observation_derived_point d
    join public.dc_current_observation c using (home_signal_observation_id)
   where c.source_native_name = p_name order by d.home_signal_observation_id limit 1 $$;
create or replace function pg_temp.iq(p_name text) returns text language sql as $$
  select d.input_quality from public.dc_observation_derived_point d
    join public.dc_current_observation c using (home_signal_observation_id)
   where c.source_native_name = p_name limit 1 $$;
create or replace function pg_temp.idstate(p_name text, p_source text default 'epoch_ai') returns text language sql as $$
  select string_agg(distinct r.identity_state, ',') from public.dc_record_identity r
    join public.dc_current_observation c using (home_signal_observation_id)
   where c.source_native_name = p_name and c.source_key = p_source $$;

-- ── Z. THE ZERO-HUMAN PRECONDITION ───────────────────────────────────────────────────
insert into _r (check_name, pass, detail)
select 'Z01 no human decision exists anywhere: no review table, no reviewed decision, no reviewed link',
       to_regclass('public.dc_identity_review') is null
   and not exists (select 1 from public.dc_identity_decision where decision_rule_key like 'REVIEWED%')
   and not exists (select 1 from public.dc_entity_observation where link_rule_key like 'REVIEWED%'),
       coalesce(to_regclass('public.dc_identity_review')::text, 'no review table');

insert into _r select nextval('_r_n_seq'), 'Z02 every current record ended in an AUTOMATIC identity state (none waits for a person)',
       not exists (select 1 from public.dc_record_identity
                    where identity_state not in ('AUTO_CONFIRMED_MATCH', 'AUTO_CONFIRMED_DISTINCT', 'IDENTITY_UNRESOLVED'))
   and (select count(*) from public.dc_record_identity) = (select count(*) from public.dc_current_observation),
       (select string_agg(s || '=' || n, ' ' order by s) from (select identity_state s, count(*) n
          from public.dc_record_identity group by 1) x);

-- ── INPUT RULE ───────────────────────────────────────────────────────────────────────
insert into _r select nextval('_r_n_seq'), 'E01 input quality is decided before any geocoder call',
       string_agg(n || '=' || coalesce(pg_temp.iq(n), 'NULL'), ', ' order by n) =
       'Blank Address=BLANK, City Only=NO_HOUSE_NUMBER, Meta Hyperion=NO_HOUSE_NUMBER, No Locality=NO_LOCALITY, Number Range=HOUSE_NUMBER_RANGE, Offshore=NOT_US, Road Only=NO_HOUSE_NUMBER, Solo Campus=GEOCODABLE, Zip Only=NO_HOUSE_NUMBER',
       string_agg(n || '=' || coalesce(pg_temp.iq(n), 'NULL'), ', ' order by n)
  from unnest(array['Blank Address','City Only','Zip Only','Road Only','No Locality','Number Range',
                    'Offshore','Meta Hyperion','Solo Campus']) n;

insert into _r select nextval('_r_n_seq'), 'E02 the queue held exactly the 26 distinct geocodable queries (and nothing ineligible)',
       (select count(*) from _queue_before) = 26
   and not exists (select 1 from _queue_before where geocoder_query in ('13360 Miller Rd NW', '82007', ''))
   and exists (select 1 from _queue_before where geocoder_query = '100 Prairie Rd, Testville, KS 66001'),
       (select count(*)::text from _queue_before);

insert into _r select nextval('_r_n_seq'), 'E03 the load SQL refuses a query the database did not queue',
       not exists (select 1 from public.dc_address_geocode where geocoder_query like '999 Not Queued%')
   and (select count(*) from public.dc_address_geocode) = 24,
       (select count(*)::text from public.dc_address_geocode);

insert into _r select nextval('_r_n_seq'), 'E04 no derived coordinate was written into publisher evidence',
       not exists (select 1 from public.dc_source_observation
                    where source_key = 'epoch_ai' and (source_native_lat is not null or source_native_lon is not null)),
       (select count(*)::text from public.dc_source_observation where source_key = 'epoch_ai' and source_native_lat is not null);

do $$ begin
  begin
    update public.dc_address_geocode set lat = 0 where true;
    insert into _r (check_name, pass, detail) values ('E05 derivations are append-only', false, 'UPDATE succeeded');
  exception when others then
    insert into _r (check_name, pass, detail) values ('E05 derivations are append-only', sqlerrm like '%append-only%', sqlerrm);
  end;
end $$;

-- ── OUTPUT QUALITY ───────────────────────────────────────────────────────────────────
insert into _r select nextval('_r_n_seq'), 'E06 every non-site geocode result is rejected, by name',
       string_agg(n || '=' || coalesce(pg_temp.verdict(n), 'NULL'), ', ' order by n) =
       'Ambiguous=REJECTED_AMBIGUOUS, County Centroid=REJECTED_AREA_CENTROID, Geocode Failed=REJECTED_NO_MATCH, House Diverges=REJECTED_MATCH_DIVERGES, Solo Campus=ACCEPTED, State Diverges=REJECTED_MATCH_DIVERGES, Zip Centroid=REJECTED_AREA_CENTROID',
       string_agg(n || '=' || coalesce(pg_temp.verdict(n), 'NULL'), ', ' order by n)
  from unnest(array['Geocode Failed','Zip Centroid','County Centroid','Ambiguous','House Diverges',
                    'State Diverges','Solo Campus']) n;

insert into _r select nextval('_r_n_seq'), 'E07 an unknown match type is never a site',
       (select verdict from public.dc_derived_point_verdict('street_segment', 1, '1 A St, X, KS 66001',
             '1 A ST, X, KS, 66001', 40.0, -97.0)) = 'REJECTED_UNKNOWN_MATCH_TYPE', null;

insert into _r select nextval('_r_n_seq'), 'E08 every rejected or ungeocodable record stays UNRESOLVED with no point',
       count(*) = 14 and bool_and(g.geography_status = 'GEOGRAPHY_UNRESOLVED' and g.geom is null),
       string_agg(n || ':' || coalesce(g.geography_status, 'none') || '/' || coalesce(g.rule_key, ''), ', ')
  from unnest(array['Geocode Failed','Zip Centroid','County Centroid','Ambiguous','House Diverges',
                    'State Diverges','Blank Address','City Only','Zip Only','Road Only','No Locality',
                    'Number Range','Offshore','Meta Hyperion']) n
  cross join lateral pg_temp.geo(n) g;

-- ── EPOCH-ONLY: AUTOMATIC DISPOSITION, TRUTHFUL LIFECYCLE ────────────────────────────
insert into _r select nextval('_r_n_seq'), 'E09 Epoch-only accepted point, no candidate -> AUTO_CONFIRMED_DISTINCT, RESOLVED from DERIVED evidence',
       pg_temp.idstate('Solo Campus') = 'AUTO_CONFIRMED_DISTINCT'
   and g.geography_status = 'RESOLVED' and g.rule_key = 'DERIVED_ADDRESS_POINT' and g.lat = 40.05
   and g.lng = -97.55 and g.positional_uncertainty_m = 2000 and g.publisher_precision is null
   and 'DERIVED_ADDRESS_POINT' = any (g.quality_flags) and g.rule_version = 4,
       pg_temp.idstate('Solo Campus') || ' ' || g.geography_status || '/' || g.rule_key || ' ' || g.lat || ',' || g.lng
  from pg_temp.geo('Solo Campus') g;

insert into _r select nextval('_r_n_seq'), 'E10 [M9] membership is the POLYGON (99913), never the provider ZIP (99912)',
       (select count(*) from pg_temp.page('99913') where project_name = 'Solo Campus') = 1
   and (select count(*) from pg_temp.page('99912') where project_name = 'Solo Campus') = 0,
       (select string_agg(project_name, ',') from pg_temp.page('99913'));

insert into _r select nextval('_r_n_seq'), 'E11 [M10] a source that states NO lifecycle publishes as Unknown -- never a fabricated Operating -- and cites its own source',
       (select string_agg(map_status || '|' || source_name || '|' || source_url, ';') from pg_temp.page('99913') where project_name = 'Solo Campus')
         = 'Unknown|Epoch AI|https://example.org/epoch/Solo-Campus',
       (select string_agg(map_status || '|' || source_name || '|' || coalesce(source_url, 'NULL'), ';')
          from pg_temp.page('99913') where project_name = 'Solo Campus');

insert into _r select nextval('_r_n_seq'), 'E12 [M15] a derived point within its error of a ZCTA edge is on NEITHER page',
       (select geography_status from pg_temp.geo('Edge Campus')) = 'RESOLVED'
   and not exists (select 1 from pg_temp.page('99911') where project_name = 'Edge Campus')
   and not exists (select 1 from pg_temp.page('99912') where project_name = 'Edge Campus'),
       null;

insert into _r select nextval('_r_n_seq'), 'E13 two records at ONE address: neither is placed by it; each is still automatically decided',
       (select rule_key from pg_temp.geo('Anthropic Lake Site')) = 'DERIVED_ADDRESS_SHARED'
   and (select rule_key from pg_temp.geo('Core42 Lake Site')) = 'DERIVED_ADDRESS_SHARED'
   and pg_temp.idstate('Anthropic Lake Site') = 'AUTO_CONFIRMED_DISTINCT'
   and not exists (select 1 from pg_temp.allpages() where project_name like '%Lake Site'),
       (select rule_key from pg_temp.geo('Anthropic Lake Site'));

insert into _r select nextval('_r_n_seq'), 'E14 an Epoch-only record with no citation is withheld, never published uncited',
       (select geography_status from pg_temp.geo('Uncited Campus')) = 'RESOLVED'
   and not exists (select 1 from pg_temp.allpages() where project_name = 'Uncited Campus'),
       null;

-- ── WEAK EVIDENCE NEVER MERGES; IT RESOLVES TO IDENTITY_UNRESOLVED BY ITSELF ─────────
insert into _r select nextval('_r_n_seq'), 'E15 [M2 M3 M4] 12 m away, same ZIP, no address match -> IDENTITY_UNRESOLVED; Epoch HELD; ONE marker',
       pg_temp.idstate('Google Council Bluffs (East)') = 'IDENTITY_UNRESOLVED'
   and (select rule_key from pg_temp.geo('Google Council Bluffs (East)')) = 'IDENTITY_UNRESOLVED'
   and (select string_agg(project_name, ';') from pg_temp.page('99915')) = 'Google Council Bluffs Data Center',
       (select string_agg(project_name, ';') from pg_temp.page('99915'));

insert into _r select nextval('_r_n_seq'), 'E16 [M5 M6 M7] same city, same operator, same name: none of them merges',
       pg_temp.idstate('Colossus 2') = 'IDENTITY_UNRESOLVED'
   and pg_temp.ent('Colossus 2') not in (pg_temp.ent('Colossus 2 (Whitehaven)', 'compute_atlas'), pg_temp.ent('Minihard', 'compute_atlas'))
   and pg_temp.idstate('Meta Hyperion') = 'IDENTITY_UNRESOLVED'
   and pg_temp.ent('Meta Hyperion') <> pg_temp.ent('Meta Hyperion', 'compute_atlas')
   and (select count(*) from pg_temp.page('99914')) = 2,
       pg_temp.idstate('Colossus 2') || '/' || pg_temp.idstate('Meta Hyperion');

insert into _r select nextval('_r_n_seq'), 'E17 [M8] numbered siblings at one unique address do not merge (Building 1 vs Building 2)',
       pg_temp.idstate('Twin Park Building 2') = 'IDENTITY_UNRESOLVED'
   and pg_temp.ent('Twin Park Building 2') <> pg_temp.ent('Twin Park Building 1', 'compute_atlas')
   and exists (select 1 from public.dc_identity_decision
                where decision_rule_key = 'EXACT_ADDRESS_SIBLING_DESIGNATION_CONFLICT')
   and (select string_agg(project_name, ';' order by project_name) from pg_temp.page('99916'))
       = 'Pine Hollow DC;Twin Park Building 1',
       (select string_agg(project_name, ';' order by project_name) from pg_temp.page('99916'));

insert into _r select nextval('_r_n_seq'), 'E18 a campus address shared by two Atlas buildings does not single one out: no merge',
       pg_temp.idstate('Hub Campus') = 'IDENTITY_UNRESOLVED'
   and exists (select 1 from public.dc_identity_decision where decision_rule_key = 'EXACT_ADDRESS_SHARED_WITHIN_SOURCE')
   and pg_temp.ent('Hub Campus') not in (pg_temp.ent('Hub Campus Hall A', 'compute_atlas'), pg_temp.ent('Hub Campus Hall B', 'compute_atlas')),
       pg_temp.idstate('Hub Campus');

insert into _r select nextval('_r_n_seq'), 'E33 the same street line is not enough when the kinds of facility or the stated postal codes differ',
       exists (select 1 from public.dc_identity_decision where decision_rule_key = 'EXACT_ADDRESS_NOT_BOTH_DATA_CENTRES')
   and exists (select 1 from public.dc_identity_decision where decision_rule_key = 'EXACT_ADDRESS_POSTAL_CONFLICT')
   and pg_temp.ent('Grid Campus') <> pg_temp.ent('Grid Station', 'compute_atlas')
   and pg_temp.ent('Postal Park Epoch') <> pg_temp.ent('Postal Park', 'compute_atlas')
   and pg_temp.idstate('Grid Campus') = 'AUTO_CONFIRMED_DISTINCT'
   and pg_temp.idstate('Postal Park Epoch') = 'IDENTITY_UNRESOLVED',
       pg_temp.idstate('Grid Campus') || '/' || pg_temp.idstate('Postal Park Epoch');

-- ── STRONG EVIDENCE MERGES AUTOMATICALLY ─────────────────────────────────────────────
insert into _r select nextval('_r_n_seq'), 'E19 [M1] Ellendale: the same unique address -> AUTO_CONFIRMED_MATCH onto the ATLAS entity, no person',
       pg_temp.idstate('CoreWeave Ellendale ND') = 'AUTO_CONFIRMED_MATCH'
   and pg_temp.ent('CoreWeave Ellendale ND') = pg_temp.ent('Applied Digital Polaris Forge 1', 'compute_atlas')
   and exists (select 1 from public.dc_identity_decision d
                where d.decision_state = 'CONFIRMED_MATCH' and d.decision_rule_key = 'AUTO_EXACT_SITE_ADDRESS'
                  and d.rule_version = 3
                  and d.evidence->'source_record_keys' ? 'epoch_ai|data_centers|name:CoreWeave Ellendale ND'
                  and d.evidence->'source_record_keys' ? 'compute_atlas|facilities|applied-digital-polaris-forge-1-ellendale-nd'),
       pg_temp.idstate('CoreWeave Ellendale ND');

insert into _r select nextval('_r_n_seq'), 'E20 [M11] Ellendale: geography from the Epoch address, LIFECYCLE from Atlas, ONE marker, citation kept',
       (select g.rule_key || '|' || g.authority_source_key || '|' || g.lat || ',' || g.lng
          from public.dc_entity_geography g where g.canonical_entity_id = pg_temp.ent('Applied Digital Polaris Forge 1', 'compute_atlas'))
         = 'DERIVED_ADDRESS_POINT|epoch_ai|46.3,-99.2'
   and (select count(*) from pg_temp.page('99911')) = 1
   and (select string_agg(project_name || '|' || map_status || '|' || source_name || '|' || source_url, ';') from pg_temp.page('99911'))
       = 'Applied Digital Polaris Forge 1|Approved|Compute Atlas|https://example.org/applied-digital-polaris-forge-1-ellendale-nd',
       (select string_agg(project_name || '|' || map_status || '|' || source_name, ';') from pg_temp.page('99911'));

insert into _r select nextval('_r_n_seq'), 'E21 tenant and operator stay two facts: nothing overwritten, nothing blended',
       (select source_native_operator from public.dc_source_observation
         where source_native_name = 'CoreWeave Ellendale ND' and acquisition_run_id = '00000000-0000-0000-0000-00000000e001') = 'CoreWeave'
   and (select source_native_operator from public.dc_source_observation where publisher_record_id = 'applied-digital-polaris-forge-1-ellendale-nd') = 'Applied Digital Corporation'
   and (select string_agg(developer_or_operator, ';') from pg_temp.page('99911')) = 'Applied Digital Corporation',
       (select string_agg(developer_or_operator, ';') from pg_temp.page('99911'));

insert into _r select nextval('_r_n_seq'), 'E22 a matched Epoch point never overrides a contradicting publisher SITE point: SOURCES_DISAGREE',
       pg_temp.idstate('Site Point Epoch') = 'AUTO_CONFIRMED_MATCH'
   and (select rule_key from public.dc_entity_geography where canonical_entity_id = pg_temp.ent('Site Point Campus', 'compute_atlas')) = 'SOURCES_DISAGREE'
   and not exists (select 1 from pg_temp.allpages() where project_name in ('Site Point Campus', 'Site Point Epoch')),
       (select rule_key from public.dc_entity_geography where canonical_entity_id = pg_temp.ent('Site Point Campus', 'compute_atlas'));

insert into _r select nextval('_r_n_seq'), 'E23 [M14] a matched Epoch point that agrees only corroborates: the publisher SITE point stays',
       (select g.geography_status || '/' || g.rule_key || ' ' || g.lat || ',' || g.lng || ' ' || g.authority_source_key
          from public.dc_entity_geography g where g.canonical_entity_id = pg_temp.ent('Pine Hollow DC', 'compute_atlas'))
         = 'RESOLVED/PUBLISHER_POINT 41.15,-96.15 compute_atlas'
   and pg_temp.ent('Pine Hollow') = pg_temp.ent('Pine Hollow DC', 'compute_atlas'),
       (select g.geography_status || '/' || g.rule_key || ' ' || g.lat || ',' || g.lng
          from public.dc_entity_geography g where g.canonical_entity_id = pg_temp.ent('Pine Hollow DC', 'compute_atlas'));

insert into _r select nextval('_r_n_seq'), 'E24 [M10] a STATED cancelled lifecycle is never outvoted by another source''s silence',
       pg_temp.idstate('Gone Campus') = 'AUTO_CONFIRMED_MATCH'
   and not exists (select 1 from pg_temp.allpages() where project_name = 'Gone Campus'),
       (select string_agg(zip || ':' || map_status, ',') from pg_temp.allpages() where project_name = 'Gone Campus');

insert into _r select nextval('_r_n_seq'), 'E25 exclusivity: a record matched to one Atlas facility is automatically DISTINCT from its Atlas neighbours',
       not exists (select 1 from public.dc_entity_identity_open o
                    where o.canonical_entity_id in (pg_temp.ent('Gone Campus'), pg_temp.ent('Site Point Epoch')))
   and exists (select 1 from public.dc_identity_decision d
                where d.candidate_rule_key = 'DERIVED_POINT_NEAR_OTHER_SOURCE_DC'
                  and d.observation_a in (select home_signal_observation_id from public.dc_current_observation where source_native_name in ('Gone Campus', 'Site Point Epoch', 'Site Point Campus'))
                  and d.observation_b in (select home_signal_observation_id from public.dc_current_observation where source_native_name in ('Gone Campus', 'Site Point Epoch', 'Site Point Campus'))),
       null;

-- ── STABLE RECORD IDENTITY ACROSS RUNS ───────────────────────────────────────────────
insert into _r select nextval('_r_n_seq'), 'E26 [M12] run 1 lands on run 0''s identity: no Epoch record has two live entities',
       not exists (select 1 from public.dc_observation_record_key rk
                     join public.dc_entity_observation eo using (home_signal_observation_id)
                     join public.dc_canonical_entity e using (canonical_entity_id)
                    where rk.record_key like 'epoch_ai|data_centers|name:%' and e.superseded_by is null
                    group by rk.record_key having count(distinct eo.canonical_entity_id) > 1)
   and pg_temp.ent('Colossus 2') = (select canonical_entity_id from _e0 where nm = 'Colossus 2')
   and (select count(*) from public.dc_canonical_entity e where e.superseded_by is null
          and exists (select 1 from public.dc_entity_observation eo where eo.canonical_entity_id = e.canonical_entity_id and eo.source_key = 'epoch_ai')
          and not exists (select 1 from public.dc_entity_observation eo where eo.canonical_entity_id = e.canonical_entity_id and eo.source_key <> 'epoch_ai')) = 27,
       (select count(*)::text from public.dc_canonical_entity e where e.superseded_by is null
          and exists (select 1 from public.dc_entity_observation eo where eo.canonical_entity_id = e.canonical_entity_id and eo.source_key = 'epoch_ai')
          and not exists (select 1 from public.dc_entity_observation eo where eo.canonical_entity_id = e.canonical_entity_id and eo.source_key <> 'epoch_ai'));

insert into _r select nextval('_r_n_seq'), 'E27 run 0 already stated the address, so it landed on the Atlas entity at first sight; the legacy fork is consolidated onto it',
       (select canonical_entity_id from _e0 where nm = 'CoreWeave Ellendale ND')
         = pg_temp.ent('Applied Digital Polaris Forge 1', 'compute_atlas')
   and (select superseded_by from public.dc_canonical_entity where canonical_entity_id = (select legacy_entity from _legacy))
         = pg_temp.ent('Applied Digital Polaris Forge 1', 'compute_atlas')
   and (select canonical_entity_id from public.dc_entity_observation where home_signal_observation_id = (select legacy_obs from _legacy))
         = pg_temp.ent('Applied Digital Polaris Forge 1', 'compute_atlas'),
       null;

insert into _r select nextval('_r_n_seq'), 'E28 a name repeated inside a run is NOT a record key, and an unstable identity is never placed',
       (select count(distinct eo.canonical_entity_id) from public.dc_entity_observation eo
          join public.dc_current_observation c using (home_signal_observation_id)
         where c.source_native_name = 'Twin Name') = 2
   and (select count(*) from public.dc_entity_geography g
          join public.dc_entity_observation eo using (canonical_entity_id)
          join public.dc_current_observation c using (home_signal_observation_id)
         where c.source_native_name = 'Twin Name' and g.rule_key = 'UNSTABLE_RECORD_IDENTITY'
           and g.geography_status = 'GEOGRAPHY_UNRESOLVED') = 2
   and not exists (select 1 from pg_temp.allpages() where project_name = 'Twin Name'),
       (select string_agg(g.rule_key, ',') from public.dc_entity_geography g
          join public.dc_entity_observation eo using (canonical_entity_id)
          join public.dc_current_observation c using (home_signal_observation_id)
         where c.source_native_name = 'Twin Name');

insert into _r select nextval('_r_n_seq'), 'E29 [M13] new evidence is re-evaluated automatically: Late Campus (no address in run 0) merges once run 1 states it',
       pg_temp.idstate('Late Campus') = 'AUTO_CONFIRMED_MATCH'
   and pg_temp.ent('Late Campus') = pg_temp.ent('Late DC', 'compute_atlas')
   and (select superseded_by from public.dc_canonical_entity where canonical_entity_id = (select canonical_entity_id from _e0 where nm = 'Late Campus'))
         = pg_temp.ent('Late DC', 'compute_atlas'),
       pg_temp.idstate('Late Campus');

insert into _r select nextval('_r_n_seq'), 'E30 idempotent: second identity run relinks nothing, second geography run writes nothing',
       (select value from _c2 where metric = 'OBSERVATIONS_RELINKED') = '0'
   and (select value from _c2 where metric = 'ENTITIES_MINTED') = '0'
   and (select value from _g2 where metric = 'ROWS_WRITTEN') = '0',
       (select string_agg(metric || '=' || value, ' ') from _c2 where metric in ('OBSERVATIONS_RELINKED', 'ENTITIES_MINTED'))
       || ' ' || (select string_agg(metric || '=' || value, ' ') from _g2 where metric = 'ROWS_WRITTEN');

-- ── THE WHOLE OUTCOME, EXACTLY ───────────────────────────────────────────────────────
insert into _r select nextval('_r_n_seq'), 'E31 exactly the eight expected cross-source entities exist -- every one by AUTO_EXACT_SITE_ADDRESS',
       (select string_agg(nm, ';' order by nm) from (
          select distinct o.source_native_name nm from public.dc_canonical_entity e
            join public.dc_entity_observation eo using (canonical_entity_id)
            join public.dc_current_observation o using (home_signal_observation_id)
           where e.superseded_by is null and o.source_key = 'compute_atlas'
             and exists (select 1 from public.dc_entity_observation x where x.canonical_entity_id = e.canonical_entity_id and x.source_key = 'epoch_ai')) s)
       = 'Applied Digital Polaris Forge 1;Border DC;Corroborated DC;Far Address DC;Gone Campus;Late DC;Pine Hollow DC;Site Point Campus'
   and not exists (select 1 from public.dc_identity_decision d
                    join public.dc_source_observation a on a.home_signal_observation_id = d.observation_a
                    join public.dc_source_observation b on b.home_signal_observation_id = d.observation_b
                   where d.decision_state = 'CONFIRMED_MATCH' and a.source_key <> b.source_key
                     and d.decision_rule_key <> 'AUTO_EXACT_SITE_ADDRESS'),
       (select string_agg(nm, ';' order by nm) from (
          select distinct o.source_native_name nm from public.dc_canonical_entity e
            join public.dc_entity_observation eo using (canonical_entity_id)
            join public.dc_current_observation o using (home_signal_observation_id)
           where e.superseded_by is null and o.source_key = 'compute_atlas'
             and exists (select 1 from public.dc_entity_observation x where x.canonical_entity_id = e.canonical_entity_id and x.source_key = 'epoch_ai')) s);

insert into _r select nextval('_r_n_seq'), 'E32 every canonical marker on every test page is a RESOLVED point, drawn once; the set is exact',
       not exists (select 1 from pg_temp.allpages() m join public.dc_entity_geography g using (canonical_entity_id)
                    where g.geography_status <> 'RESOLVED' or g.geometry_type <> 'POINT')
   and (select count(*) from pg_temp.allpages()) = (select count(distinct canonical_entity_id) from pg_temp.allpages())
   and (select string_agg(zip || ':' || project_name || ':' || map_status, ';' order by zip, project_name) from pg_temp.allpages())
       = '99911:Applied Digital Polaris Forge 1:Approved;99913:Hub Campus Hall A:Operating;99913:Hub Campus Hall B:Operating;99913:Late DC:Operating;99913:Solo Campus:Unknown;99914:Colossus 2 (Whitehaven):Operating;99914:Minihard:Operating;99915:Google Council Bluffs Data Center:Operating;99916:Pine Hollow DC:Operating;99916:Twin Park Building 1:Operating;99918:Border DC:Operating;99918:Corroborated DC:Operating',
       (select string_agg(zip || ':' || project_name || ':' || map_status, ';' order by zip, project_name) from pg_temp.allpages());

-- ── CANONICAL GEOGRAPHY AUTHORITY (rule_version 4) ─────────────────────────────────────
insert into _r select nextval('_r_n_seq'), 'E34 [A/H] a derived point inside its calibrated bound CORROBORATES the publisher site point: one entity, the site point, one marker',
       pg_temp.ent('Corroborated Epoch') = pg_temp.ent('Corroborated DC', 'compute_atlas')
   and (pg_temp.geo('Corroborated DC', 'compute_atlas')).geography_status = 'RESOLVED'
   and (pg_temp.geo('Corroborated DC', 'compute_atlas')).rule_key = 'PUBLISHER_POINT'
   and (pg_temp.geo('Corroborated DC', 'compute_atlas')).lat = 44.1012
   and (pg_temp.geo('Corroborated DC', 'compute_atlas')).lng = -104.2012
   and (pg_temp.geo('Corroborated DC', 'compute_atlas')).quality_flags @> array['CORROBORATED_BY_DERIVED_ADDRESS']
   and not (pg_temp.geo('Corroborated DC', 'compute_atlas')).quality_flags @> array['SOURCES_DISAGREE']
   and (select count(*) from pg_temp.allpages() where canonical_entity_id = pg_temp.ent('Corroborated DC', 'compute_atlas')) = 1
   and (select string_agg(zip, ',') from pg_temp.allpages() where canonical_entity_id = pg_temp.ent('Corroborated DC', 'compute_atlas')) = '99918',
       (select g.geography_status || ' ' || g.rule_key || ' ' || g.lat || ',' || g.lng || ' ' || g.quality_flags::text
          from pg_temp.geo('Corroborated DC', 'compute_atlas') g);

insert into _r select nextval('_r_n_seq'), 'E35 [G] the two claims sit in different ZCTAs: authority is decided first, the ZIP follows the canonical point (99918), and 99919 carries nothing',
       (pg_temp.geo('Border DC', 'compute_atlas')).geography_status = 'RESOLVED'
   and (pg_temp.geo('Border DC', 'compute_atlas')).lat = 44.1512 and (pg_temp.geo('Border DC', 'compute_atlas')).lng = -104.0088
   and (select string_agg(zip, ',') from pg_temp.allpages() where canonical_entity_id = pg_temp.ent('Border DC', 'compute_atlas')) = '99918'
   and not exists (select 1 from pg_temp.page('99919')),
       (select g.geography_status || ' ' || g.rule_key || ' ' || g.quality_flags::text from pg_temp.geo('Border DC', 'compute_atlas') g)
       || ' pages=' || coalesce((select string_agg(zip, ',') from pg_temp.allpages() where canonical_entity_id = pg_temp.ent('Border DC', 'compute_atlas')), '-');

insert into _r select nextval('_r_n_seq'), 'E36 [B] a publisher point its OWN address places 4.4 km away (beyond the derived point''s calibrated bound) fails closed: SOURCES_DISAGREE, identity untouched, no marker, not even via the provider ZIP',
       pg_temp.idstate('Far Address Epoch') = 'AUTO_CONFIRMED_MATCH'
   and pg_temp.idstate('Far Address DC', 'compute_atlas') = 'AUTO_CONFIRMED_MATCH'
   and pg_temp.ent('Far Address Epoch') = pg_temp.ent('Far Address DC', 'compute_atlas')
   and (pg_temp.geo('Far Address DC', 'compute_atlas')).geography_status = 'GEOGRAPHY_UNRESOLVED'
   and (pg_temp.geo('Far Address DC', 'compute_atlas')).rule_key = 'SOURCES_DISAGREE'
   and (pg_temp.geo('Far Address DC', 'compute_atlas')).quality_flags @> array['DERIVED_ADDRESS_BEYOND_UNCERTAINTY']
   and not (pg_temp.geo('Far Address DC', 'compute_atlas')).quality_flags @> array['SITE_CLAIMS_CONFLICT']
   and (pg_temp.geo('Far Address DC', 'compute_atlas')).geom is null
   and not exists (select 1 from pg_temp.allpages() where project_name in ('Far Address DC', 'Far Address Epoch')),
       (select g.geography_status || ' ' || g.rule_key || ' ' || g.quality_flags::text from pg_temp.geo('Far Address DC', 'compute_atlas') g)
       || ' id=' || coalesce(pg_temp.idstate('Far Address Epoch'), '?');

select check_name, coalesce(pass, false), coalesce(detail, '') from _r order by n;

-- =====================================================================================
-- EPOCH CANONICAL GEOGRAPHY — EXECUTABLE ADVERSARIAL SUITE
-- Exercises the SHIPPED files end to end on a DISPOSABLE PostGIS:
--   docs/dc-step3d-derived-location.sql, docs/dc-step3a-canonical-identity.sql,
--   docs/dc-step3b-canonical-geography.sql, docs/map1-dc-publication.sql, and the writer's
--   own load SQL (psql variable :loadsql, default docs/dc-geocode-observations-load.sql).
-- Every expected answer is a HARD-CODED constant chosen before the code ran. Fixture names
-- (Ellendale, CoreWeave, Colossus ...) live HERE only; production files may not branch on them.
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
 ('99915', ST_Multi(ST_GeomFromText('POLYGON((-95.9 41,-95.6 41,-95.6 41.3,-95.9 41.3,-95.9 41))', 4269)));
delete from public.national_dc_records;

-- ── runs ─────────────────────────────────────────────────────────────────────────────
insert into public.dc_acquisition_run (id, source_key, distribution_key, run_seq) values
 ('00000000-0000-0000-0000-00000000a001', 'compute_atlas', 'facilities', 1),
 ('00000000-0000-0000-0000-00000000e000', 'epoch_ai', 'data_centers', 0);

create or replace function pg_temp.atlas(p_name text, p_pid text, p_lat float8, p_lng float8,
    p_notes text, p_operator text, p_city text, p_state text)
returns uuid language sql as $$
  insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key,
      publisher_record_id, raw_payload, source_native_name, source_native_type, source_native_status,
      source_native_operator, source_native_address, source_native_lat, source_native_lon,
      source_native_precision)
  values ('00000000-0000-0000-0000-00000000a001', 'compute_atlas', 'facilities', p_pid,
      jsonb_build_object('notes', p_notes, 'confidence', 'confirmed',
                         'sources', jsonb_build_array(jsonb_build_object('url', 'https://example.org/' || p_pid))),
      p_name, 'data_center', 'operational', p_operator,
      jsonb_build_object('city', p_city, 'state', p_state), p_lat, p_lng, 'exact')
  returning home_signal_observation_id $$;

create or replace function pg_temp.epoch(p_run uuid, p_name text, p_address text,
    p_operator text default null, p_status text default null, p_country text default 'United States')
returns uuid language sql as $$
  insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key,
      raw_payload, source_native_name, source_native_status, source_native_operator,
      source_native_address)
  values (p_run, 'epoch_ai', 'data_centers',
      -- production Epoch rows state NO lifecycle and carry no 'sources' array (measured 2026-09-24:
      -- 92/92 status NULL), so they cannot render. A fixture row that DOES state a lifecycle also
      -- carries a citation, so the reader's own gates -- not a missing citation -- are what is tested.
      jsonb_build_object('Name', p_name, 'Address', p_address, 'Country', p_country, 'Owner', p_operator)
        || case when p_status is null then '{}'::jsonb
                else jsonb_build_object('sources', jsonb_build_array(jsonb_build_object('url', 'https://example.org/epoch/' || p_name))) end,
      p_name, p_status, p_operator,
      jsonb_build_object('Address', p_address, 'Country', p_country))
  returning home_signal_observation_id $$;

-- Atlas
select pg_temp.atlas('Applied Digital Polaris Forge 1', 'applied-digital-polaris-forge-1-ellendale-nd',
    46.25, -99.25, 'Campus is 400 MW. Coordinates are Ellendale city centroid; exact site unpublished.',
    'Applied Digital Corporation', 'Ellendale', 'ND');
select pg_temp.atlas('Google Council Bluffs Data Center', 'google-council-bluffs', 41.15, -95.75,
    'Coordinates are the county auditor parcel centroid.', 'Google', 'Council Bluffs', 'IA');
select pg_temp.atlas('Colossus 2 (Whitehaven)', 'xai-colossus-2', 35.15, -90.05,
    'Coordinates are the building footprint centroid.', 'xAI', 'Memphis', 'TN');
select pg_temp.atlas('Minihard', 'xai-minihard', 35.16, -90.06,
    'Coordinates are the building footprint centroid.', 'xAI', 'Memphis', 'TN');
select pg_temp.atlas('Site Point Campus', 'site-point-campus', 40.28, -97.35,
    'Coordinates are the parcel centroid.', 'Site Operator', 'Northtown', 'KS');
select pg_temp.atlas('Meta Hyperion', 'meta-hyperion', 32.5, -91.5,
    'Coordinates are the parcel centroid.', 'Meta', 'Holly Ridge', 'LA');

-- Epoch, run 0 (becomes history once run 1 lands)
select pg_temp.epoch('00000000-0000-0000-0000-00000000e000', 'CoreWeave Ellendale ND',
    '9685 87th Ave SE, Ellendale, ND 58436', 'CoreWeave');
select pg_temp.epoch('00000000-0000-0000-0000-00000000e000', 'Colossus 2',
    '5420 Tulane Rd, Memphis, TN 38109', 'xAI');

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

create temp table _ell_e0 as
select eo.canonical_entity_id from public.dc_entity_observation eo
  join public.dc_source_observation o using (home_signal_observation_id)
 where o.source_native_name = 'CoreWeave Ellendale ND'
   and o.acquisition_run_id = '00000000-0000-0000-0000-00000000e000';

-- Epoch, run 1 (current)
insert into public.dc_acquisition_run (id, source_key, distribution_key, run_seq) values
 ('00000000-0000-0000-0000-00000000e001', 'epoch_ai', 'data_centers', 1);
\set E '\'00000000-0000-0000-0000-00000000e001\''
select pg_temp.epoch(:E, 'CoreWeave Ellendale ND', '9685 87th Ave SE, Ellendale, ND 58436', 'CoreWeave');
select pg_temp.epoch(:E, 'Colossus 2', '5420 Tulane Rd, Memphis, TN 38109', 'xAI');
select pg_temp.epoch(:E, 'Google Council Bluffs (East)', '10410 Bunge Ave, Council Bluffs, IA 51503', 'Google', 'operational');
select pg_temp.epoch(:E, 'Site Point Epoch', '500 Far Rd, Northtown, KS 66000', 'Site Operator');
select pg_temp.epoch(:E, 'Solo Campus', '100 Prairie Rd, Testville, KS 66001', 'Solo', 'operational');
select pg_temp.epoch(:E, 'Solo Campus No Lifecycle', '200 Prairie Rd, Testville, KS 66001', 'Solo');
select pg_temp.epoch(:E, 'Edge Campus', '300 Line Rd, Oakes, ND 58474', 'Edge', 'operational');
select pg_temp.epoch(:E, 'Anthropic Lake Site', '7725 Lake Rd, Barker, NY 14012', 'Anthropic', 'operational');
select pg_temp.epoch(:E, 'Core42 Lake Site', '7725 Lake Rd, Barker, NY 14012', 'Core42', 'operational');
select pg_temp.epoch(:E, 'Meta Hyperion', 'Holly Ridge, LA 71269', 'Meta', 'operational');
select pg_temp.epoch(:E, 'Blank Address', '', null, 'operational');
select pg_temp.epoch(:E, 'City Only', 'Cheyenne, WY 82007, USA', null, 'operational');
select pg_temp.epoch(:E, 'Zip Only', '82007', null, 'operational');
select pg_temp.epoch(:E, 'Road Only', 'Co Rd 42, Montgomery, AL 36105, USA', null, 'operational');
select pg_temp.epoch(:E, 'No Locality', '13360 Miller Rd NW', null, 'operational');
select pg_temp.epoch(:E, 'Number Range', '14436-14998 Fairview Rd, Springfield, NE 68059, USA', null, 'operational');
select pg_temp.epoch(:E, 'Geocode Failed', '1 Meta Way, Gallatin, TN 37066', null, 'operational');
select pg_temp.epoch(:E, 'Zip Centroid', '2 Zip Rd, Testville, KS 66001', null, 'operational');
select pg_temp.epoch(:E, 'County Centroid', '3 County Rd, Testville, KS 66001', null, 'operational');
select pg_temp.epoch(:E, 'Ambiguous', '1772 145th St, Rosemount, MN 55068', null, 'operational');
select pg_temp.epoch(:E, 'House Diverges', '1401 Meadow Pkwy, Chester, VA 23836', null, 'operational');
select pg_temp.epoch(:E, 'State Diverges', '5 State Rd, Testville, KS 66001', null, 'operational');
select pg_temp.epoch(:E, 'Twin Name', '9 Twin Rd, Testville, KS 66001', null, 'operational');
select pg_temp.epoch(:E, 'Twin Name', '10 Twin Rd, Testville, KS 66001', null, 'operational');
select pg_temp.epoch(:E, 'Offshore', 'Valhallarbraut 868, 262 Reykjanesbaer, Iceland', null, 'operational', 'Iceland');

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
 ('100 Prairie Rd, Testville, KS 66001', 'census_onelineaddress', 'range_interpolated', 40.05, -97.55, '100 PRAIRIE RD, TESTVILLE, KS, 99912', 1),
 ('200 Prairie Rd, Testville, KS 66001', 'census_onelineaddress', 'range_interpolated', 40.15, -97.45, '200 PRAIRIE RD, TESTVILLE, KS, 99913', 1),
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
 -- a query nobody queued: the load must refuse it
 ('999 Not Queued Rd, Nowhere, KS 66001', 'census_onelineaddress', 'range_interpolated', 40.11, -97.44, '999 NOT QUEUED RD, NOWHERE, KS, 66001', 1)
) v(q, p, mt, la, ln, ma, c);

create temp table _queue_before as select geocoder_query from public.dc_geocode_queue;
\i :loadsql

-- ── resolve (twice each: idempotency) ────────────────────────────────────────────────
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
    map_status text, developer_or_operator text, source_name text, canonical_entity_id uuid)
language sql as $$ select project_name, lat, lng, map_status, developer_or_operator, source_name, canonical_entity_id
                     from public.map1_dc_zip_members(p_zip) where publication_basis = 'canonical' $$;
create or replace function pg_temp.verdict(p_name text) returns text language sql as $$
  select d.verdict from public.dc_observation_derived_point d
    join public.dc_current_observation c using (home_signal_observation_id)
   where c.source_native_name = p_name order by d.home_signal_observation_id limit 1 $$;
create or replace function pg_temp.iq(p_name text) returns text language sql as $$
  select d.input_quality from public.dc_observation_derived_point d
    join public.dc_current_observation c using (home_signal_observation_id)
   where c.source_native_name = p_name limit 1 $$;

-- ── INPUT RULE ───────────────────────────────────────────────────────────────────────
insert into _r (check_name, pass, detail)
select 'E01 input quality is decided before any geocoder call',
       string_agg(n || '=' || coalesce(pg_temp.iq(n), 'NULL'), ', ' order by n) =
       'Blank Address=BLANK, City Only=NO_HOUSE_NUMBER, Meta Hyperion=NO_HOUSE_NUMBER, No Locality=NO_LOCALITY, Number Range=HOUSE_NUMBER_RANGE, Offshore=NOT_US, Road Only=NO_HOUSE_NUMBER, Solo Campus=GEOCODABLE, Zip Only=NO_HOUSE_NUMBER',
       string_agg(n || '=' || coalesce(pg_temp.iq(n), 'NULL'), ', ' order by n)
  from unnest(array['Blank Address','City Only','Zip Only','Road Only','No Locality','Number Range',
                    'Offshore','Meta Hyperion','Solo Campus']) n;

insert into _r select nextval('_r_n_seq'), 'E02 the queue held exactly the 16 distinct geocodable queries (and nothing ineligible)',
       (select count(*) from _queue_before) = 16
   and not exists (select 1 from _queue_before where geocoder_query in ('13360 Miller Rd NW', '82007', ''))
   and exists (select 1 from _queue_before where geocoder_query = '100 Prairie Rd, Testville, KS 66001'),
       (select count(*)::text from _queue_before);

insert into _r select nextval('_r_n_seq'), 'E03 the load SQL refuses a query the database did not queue',
       not exists (select 1 from public.dc_address_geocode where geocoder_query like '999 Not Queued%')
   and (select count(*) from public.dc_address_geocode) = 16,
       (select count(*)::text from public.dc_address_geocode);

insert into _r select nextval('_r_n_seq'), 'E04 [M5] no derived coordinate was written into publisher evidence',
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
insert into _r select nextval('_r_n_seq'), 'E06 [M2 M3 M12] every non-site result is rejected, by name',
       string_agg(n || '=' || coalesce(pg_temp.verdict(n), 'NULL'), ', ' order by n) =
       'Ambiguous=REJECTED_AMBIGUOUS, County Centroid=REJECTED_AREA_CENTROID, Geocode Failed=REJECTED_NO_MATCH, House Diverges=REJECTED_MATCH_DIVERGES, Solo Campus=ACCEPTED, State Diverges=REJECTED_MATCH_DIVERGES, Zip Centroid=REJECTED_AREA_CENTROID',
       string_agg(n || '=' || coalesce(pg_temp.verdict(n), 'NULL'), ', ' order by n)
  from unnest(array['Geocode Failed','Zip Centroid','County Centroid','Ambiguous','House Diverges',
                    'State Diverges','Solo Campus']) n;

insert into _r select nextval('_r_n_seq'), 'E07 [M4] an unknown match type is never a site',
       (select verdict from public.dc_derived_point_verdict('street_segment', 1, '1 A St, X, KS 66001',
             '1 A ST, X, KS, 66001', 40.0, -97.0)) = 'REJECTED_UNKNOWN_MATCH_TYPE', null;

insert into _r select nextval('_r_n_seq'), 'E08 [M12] every rejected or ungeocodable record stays UNRESOLVED with no point',
       count(*) = 14 and bool_and(g.geography_status = 'GEOGRAPHY_UNRESOLVED' and g.geom is null),
       string_agg(n || ':' || coalesce(g.geography_status, 'none') || '/' || coalesce(g.rule_key, ''), ', ')
  from unnest(array['Geocode Failed','Zip Centroid','County Centroid','Ambiguous','House Diverges',
                    'State Diverges','Blank Address','City Only','Zip Only','Road Only','No Locality',
                    'Number Range','Offshore','Meta Hyperion']) n
  cross join lateral pg_temp.geo(n) g;

-- ── EPOCH-ONLY POSITIVE CONTROL ──────────────────────────────────────────────────────
insert into _r select nextval('_r_n_seq'), 'E09 Epoch-only accepted point -> RESOLVED from the DERIVED evidence, uncertainty kept',
       g.geography_status = 'RESOLVED' and g.rule_key = 'DERIVED_ADDRESS_POINT' and g.lat = 40.05
   and g.lng = -97.55 and g.positional_uncertainty_m = 2000 and g.publisher_precision is null
   and 'DERIVED_ADDRESS_POINT' = any (g.quality_flags) and g.rule_version = 3
   and g.provenance->'location_basis_evidence'->>'geocoder_query' = '100 Prairie Rd, Testville, KS 66001',
       g.geography_status || '/' || g.rule_key || ' ' || g.lat || ',' || g.lng
  from pg_temp.geo('Solo Campus') g;

insert into _r select nextval('_r_n_seq'), 'E10 [M1] membership is the POLYGON (99913), never the provider ZIP (99912)',
       (select count(*) from pg_temp.page('99913') where project_name = 'Solo Campus') = 1
   and (select count(*) from pg_temp.page('99912') where project_name = 'Solo Campus') = 0,
       (select string_agg(project_name, ',') from pg_temp.page('99913'));

insert into _r select nextval('_r_n_seq'), 'E11 a source that states no lifecycle cannot render, even when placed',
       (select geography_status from pg_temp.geo('Solo Campus No Lifecycle')) = 'RESOLVED'
   and not exists (select 1 from pg_temp.page('99913') where project_name = 'Solo Campus No Lifecycle'),
       null;

insert into _r select nextval('_r_n_seq'), 'E12 [M16] a derived point within its error of a ZCTA edge is on NEITHER page',
       (select geography_status from pg_temp.geo('Edge Campus')) = 'RESOLVED'
   and not exists (select 1 from pg_temp.page('99911') where project_name = 'Edge Campus')
   and not exists (select 1 from pg_temp.page('99912') where project_name = 'Edge Campus'),
       null;

insert into _r select nextval('_r_n_seq'), 'E13 two records at ONE address: neither is placed by it',
       (select rule_key from pg_temp.geo('Anthropic Lake Site')) = 'DERIVED_ADDRESS_SHARED'
   and (select rule_key from pg_temp.geo('Core42 Lake Site')) = 'DERIVED_ADDRESS_SHARED'
   and (select count(*) from pg_temp.page('99911') where project_name like '%Lake Site') = 0,
       (select rule_key from pg_temp.geo('Anthropic Lake Site'));

-- ── DUPLICATES BEFORE ANY REVIEW ─────────────────────────────────────────────────────
insert into _r select nextval('_r_n_seq'), 'E14 [M11] possible duplicate: the Atlas site publishes, the Epoch point is HELD -> ONE marker',
       (select rule_key from pg_temp.geo('Google Council Bluffs (East)')) = 'IDENTITY_REVIEW_REQUIRED'
   and (select count(*) from pg_temp.page('99915')) = 1
   and (select string_agg(project_name, ';') from pg_temp.page('99915')) = 'Google Council Bluffs Data Center',
       (select string_agg(project_name, ',') from pg_temp.page('99915'));

insert into _r select nextval('_r_n_seq'), 'E15 [M10] Ellendale before review: town centroid withheld, Epoch held, page EMPTY',
       (select rule_key from pg_temp.geo('Applied Digital Polaris Forge 1', 'compute_atlas')) = 'PUBLISHER_AREA_POINT'
   and (select rule_key from pg_temp.geo('CoreWeave Ellendale ND')) = 'IDENTITY_REVIEW_REQUIRED'
   and (select count(*) from pg_temp.page('99911')) = 0,
       (select count(*)::text from pg_temp.page('99911'));

insert into _r select nextval('_r_n_seq'), 'E16 [M6 M7] the Ellendale pair is only POSSIBLE_MATCH, never confirmed by a rule',
       exists (select 1 from public.dc_identity_decision d
                where d.candidate_rule_key = 'DERIVED_POINT_NEAR_OTHER_SOURCE_DC'
                  and d.decision_state = 'POSSIBLE_MATCH'
                  and d.evidence->'candidate_evidence'->>'other_name' = 'Applied Digital Polaris Forge 1')
   and not exists (select 1 from public.dc_identity_decision d
                    where d.decision_state = 'CONFIRMED_MATCH' and d.candidate_rule_key <> 'EXACT_NAME'
                      and exists (select 1 from public.dc_source_observation a, public.dc_source_observation b
                                   where a.home_signal_observation_id = d.observation_a
                                     and b.home_signal_observation_id = d.observation_b
                                     and a.source_key <> b.source_key)),
       null;

insert into _r select nextval('_r_n_seq'), 'E17 [M6 M7] no entity spans two sources before a person decides',
       not exists (select 1 from public.dc_canonical_entity where superseded_by is null and source_count > 1),
       (select count(*)::text from public.dc_canonical_entity where superseded_by is null and source_count > 1);

insert into _r select nextval('_r_n_seq'), 'E18 Epoch identity is continuous across runs: run 1 lands on the run-0 entity',
       pg_temp.ent('CoreWeave Ellendale ND') = (select canonical_entity_id from _ell_e0)
   and (select count(*) from public.dc_canonical_entity e
         where e.superseded_by is null
           and exists (select 1 from public.dc_entity_observation eo where eo.canonical_entity_id = e.canonical_entity_id
                          and eo.source_key = 'epoch_ai')) = 25,
       (select count(*)::text from public.dc_canonical_entity e where e.superseded_by is null
           and exists (select 1 from public.dc_entity_observation eo where eo.canonical_entity_id = e.canonical_entity_id and eo.source_key = 'epoch_ai'));

insert into _r select nextval('_r_n_seq'), 'E19 the legacy fork is consolidated onto the oldest entity, not kept',
       (select superseded_by from public.dc_canonical_entity where canonical_entity_id = (select legacy_entity from _legacy))
         = (select canonical_entity_id from _ell_e0)
   and (select canonical_entity_id from public.dc_entity_observation where home_signal_observation_id = (select legacy_obs from _legacy))
         = (select canonical_entity_id from _ell_e0),
       null;

insert into _r select nextval('_r_n_seq'), 'E20 [M17] a name repeated inside a run is NOT a record key',
       (select count(distinct eo.canonical_entity_id) from public.dc_entity_observation eo
          join public.dc_current_observation c using (home_signal_observation_id)
         where c.source_native_name = 'Twin Name') = 2,
       null;

insert into _r select nextval('_r_n_seq'), 'E21 idempotent: second identity run relinks nothing, second geography run writes nothing',
       (select value from _c2 where metric = 'OBSERVATIONS_RELINKED') = '0'
   and (select value from _c2 where metric = 'ENTITIES_MINTED') = '0'
   and (select value from _g2 where metric = 'ROWS_WRITTEN') = '0',
       (select string_agg(metric || '=' || value, ' ') from _g2 where metric = 'ROWS_WRITTEN');

-- ── REVIEWS ──────────────────────────────────────────────────────────────────────────
insert into public.dc_identity_review (record_key_a, record_key_b, verdict, reviewer, rationale) values
 ('compute_atlas|facilities|applied-digital-polaris-forge-1-ellendale-nd', 'epoch_ai|data_centers|name:CoreWeave Ellendale ND',
  'CONFIRMED_MATCH', 'suite', 'The Epoch record cites the operator''s own lease announcement for this campus.'),
 ('compute_atlas|facilities|xai-colossus-2', 'epoch_ai|data_centers|name:Colossus 2',
  'CONFIRMED_MATCH', 'suite', 'Reviewer A believes this is the Whitehaven building of the campus.'),
 ('compute_atlas|facilities|xai-minihard', 'epoch_ai|data_centers|name:Colossus 2',
  'CONFIRMED_MATCH', 'suite', 'Reviewer B believes this is the Minihard building of the campus.'),
 ('compute_atlas|facilities|site-point-campus', 'epoch_ai|data_centers|name:Site Point Epoch',
  'CONFIRMED_MATCH', 'suite', 'Same campus; the Epoch address is the gatehouse on a different road.'),
 ('compute_atlas|facilities|google-council-bluffs', 'epoch_ai|data_centers|name:Google Council Bluffs (East)',
  'CONFIRMED_MATCH', 'suite', 'The Epoch record and the county parcel describe the same building.');

create temp table _c3 as select * from public.dc_resolve_canonical(true, false);
create temp table _g3 as select * from public.dc_resolve_geography(true);

create temp table _ell_atlas as select pg_temp.ent('Applied Digital Polaris Forge 1', 'compute_atlas') id;

insert into _r select nextval('_r_n_seq'), 'E22 a reviewed match merges onto the ATLAS entity (marker id stable), Epoch entity superseded',
       pg_temp.ent('CoreWeave Ellendale ND') = (select id from _ell_atlas)
   and (select superseded_by from public.dc_canonical_entity where canonical_entity_id = (select canonical_entity_id from _ell_e0))
         = (select id from _ell_atlas)
   and (select source_count from public.dc_canonical_entity where canonical_entity_id = (select id from _ell_atlas)) = 2,
       null;

insert into _r select nextval('_r_n_seq'), 'E23 [M18] Ellendale: RESOLVED from the Epoch address, the town centroid is NOT restored',
       g.geography_status = 'RESOLVED' and g.rule_key = 'DERIVED_ADDRESS_POINT' and g.lat = 46.30 and g.lng = -99.20
   and g.authority_source_key = 'epoch_ai' and g.provenance->>'location_basis' = 'DERIVED_ADDRESS',
       g.geography_status || '/' || g.rule_key || ' ' || g.lat || ',' || g.lng
  from public.dc_entity_geography g where g.canonical_entity_id = (select id from _ell_atlas);

insert into _r select nextval('_r_n_seq'), 'E24 [M19] exactly ONE Ellendale marker, described by the source that states a lifecycle',
       (select count(*) from pg_temp.page('99911')) = 1
   and (select string_agg(project_name || '|' || map_status || '|' || source_name || '|' || lat || ',' || lng, ';') from pg_temp.page('99911'))
       = 'Applied Digital Polaris Forge 1|Operating|Compute Atlas|46.3,-99.2',
       (select string_agg(project_name || '|' || map_status || '|' || source_name || '|' || lat || ',' || lng, ';') from pg_temp.page('99911'));

insert into _r select nextval('_r_n_seq'), 'E25 [M8] tenant and operator stay two facts: nothing overwritten, nothing blended',
       (select source_native_operator from public.dc_source_observation
         where source_native_name = 'CoreWeave Ellendale ND' and acquisition_run_id = '00000000-0000-0000-0000-00000000e001') = 'CoreWeave'
   and (select source_native_operator from public.dc_source_observation where publisher_record_id = 'applied-digital-polaris-forge-1-ellendale-nd') = 'Applied Digital Corporation'
   and (select string_agg(developer_or_operator, ';') from pg_temp.page('99911')) = 'Applied Digital Corporation',
       (select string_agg(developer_or_operator, ';') from pg_temp.page('99911'));

insert into _r select nextval('_r_n_seq'), 'E26 [M15] wrong sibling: a review component holding two Atlas records is refused whole',
       (select value from _c3 where metric = 'REVIEW_COMPONENTS_REFUSED_SIBLING') = '1'
   and pg_temp.ent('Colossus 2 (Whitehaven)', 'compute_atlas') <> pg_temp.ent('Minihard', 'compute_atlas')
   and pg_temp.ent('Colossus 2') not in (pg_temp.ent('Colossus 2 (Whitehaven)', 'compute_atlas'), pg_temp.ent('Minihard', 'compute_atlas'))
   and (select rule_key from pg_temp.geo('Colossus 2')) = 'IDENTITY_REVIEW_REQUIRED'
   and (select count(*) from pg_temp.page('99914')) = 2,
       (select string_agg(project_name, ',' order by project_name) from pg_temp.page('99914'));

insert into _r select nextval('_r_n_seq'), 'E27 [M14] a derived point never overrides a contradicting publisher SITE point: SOURCES_DISAGREE',
       (select rule_key from public.dc_entity_geography where canonical_entity_id = pg_temp.ent('Site Point Campus', 'compute_atlas')) = 'SOURCES_DISAGREE'
   and not exists (select 1 from pg_temp.page('99913') where project_name = 'Site Point Campus'),
       (select rule_key from public.dc_entity_geography where canonical_entity_id = pg_temp.ent('Site Point Campus', 'compute_atlas'));

insert into _r select nextval('_r_n_seq'), 'E28 [M10] every canonical marker on every test page is a RESOLVED point, once',
       not exists (select 1 from (select z.zcta5, m.canonical_entity_id from geo.zcta_boundary z
                                  cross join lateral pg_temp.page(z.zcta5) m) x
                    join public.dc_entity_geography g using (canonical_entity_id)
                   where g.geography_status <> 'RESOLVED' or g.geometry_type <> 'POINT')
   and (select count(*) from (select m.canonical_entity_id from geo.zcta_boundary z cross join lateral pg_temp.page(z.zcta5) m) x)
     = (select count(distinct m.canonical_entity_id) from geo.zcta_boundary z cross join lateral pg_temp.page(z.zcta5) m),
       (select count(*)::text from (select m.canonical_entity_id from geo.zcta_boundary z cross join lateral pg_temp.page(z.zcta5) m) x);

insert into _r select nextval('_r_n_seq'), 'E30 [M14] a reviewed match keeps the publisher SITE point; the derived point only corroborates',
       g.geography_status = 'RESOLVED' and g.rule_key = 'PUBLISHER_POINT' and g.lat = 41.15 and g.lng = -95.75
   and g.authority_source_key = 'compute_atlas' and g.positional_uncertainty_m is null
   and (select count(*) from pg_temp.page('99915')) = 1,
       g.geography_status || '/' || g.rule_key || ' ' || g.lat || ',' || g.lng || ' ' || coalesce(g.authority_source_key, '')
  from public.dc_entity_geography g where g.canonical_entity_id = pg_temp.ent('Google Council Bluffs Data Center', 'compute_atlas');

-- ── REVOCATION: a merge is reversible ────────────────────────────────────────────────
update public.dc_identity_review set revoked_at = now(), revoked_reason = 'suite: reviewer withdrew the decision'
 where record_key_b = 'epoch_ai|data_centers|name:CoreWeave Ellendale ND';
create temp table _c4 as select * from public.dc_resolve_canonical(true, false);
create temp table _g4 as select * from public.dc_resolve_geography(true);

insert into _r select nextval('_r_n_seq'), 'E29 revoking the review splits the evidence back out; the page is empty again',
       pg_temp.ent('CoreWeave Ellendale ND') <> (select id from _ell_atlas)
   and (select source_count from public.dc_canonical_entity where canonical_entity_id = (select id from _ell_atlas)) = 1
   and (select rule_key from pg_temp.geo('Applied Digital Polaris Forge 1', 'compute_atlas')) = 'PUBLISHER_AREA_POINT'
   and (select count(*) from pg_temp.page('99911')) = 0,
       (select count(*)::text from pg_temp.page('99911'));

select check_name, coalesce(pass, false), coalesce(detail, '') from _r order by n;

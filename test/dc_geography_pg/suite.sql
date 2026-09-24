-- =====================================================================================
-- CANONICAL DC GEOGRAPHY — EXECUTABLE ADVERSARIAL SUITE
-- (docs/dc-step3b-canonical-geography.sql: dc_location_basis*, dc_resolve_geography)
-- Every expected answer is a HARD-CODED constant or the hand-adjudicated corpus, never a value
-- computed by the code under test. One row per check (check, pass, detail); NULL pass = failure.
-- Run from this directory (the corpus is loaded with a relative \copy).
-- =====================================================================================

create temp table if not exists _g_result (n serial, check_name text, pass boolean, detail text);
truncate _g_result;

truncate public.dc_current_flag, public.dc_entity_observation cascade;
delete from public.dc_entity_geography;
delete from public.dc_canonical_entity;
delete from public.dc_source_observation;

-- one entity, one CURRENT, LINKED observation
create or replace function pg_temp.mk(p_name text, p_lat double precision, p_lng double precision,
                                      p_prec text, p_notes text,
                                      p_grain text default 'SITE',
                                      p_source text default 'compute_atlas',
                                      p_dist text default 'facilities')
returns uuid language plpgsql as $$
declare v_obs uuid; v_ent uuid;
begin
  insert into public.dc_source_observation (source_key, distribution_key, raw_payload,
      source_native_name, source_native_lat, source_native_lon, source_native_precision)
  values (p_source, p_dist, jsonb_build_object('name', p_name, 'notes', p_notes),
          p_name, p_lat, p_lng, p_prec)
  returning home_signal_observation_id into v_obs;
  insert into public.dc_canonical_entity (entity_grain) values (p_grain)
  returning canonical_entity_id into v_ent;
  insert into public.dc_entity_observation values (v_obs, v_ent);
  insert into public.dc_current_flag values (v_obs);
  return v_ent;
end $$;

create temp table _g_ent (name text primary key, id uuid);
insert into _g_ent values
 ('CITY CENTROID EXACT',  pg_temp.mk('CITY CENTROID EXACT', 46.003, -98.509, 'exact',
     'Campus is 400 MW. Coordinates are Ellendale city centroid; exact site is northeast of the city.')),
 ('TOWN CENTROID SIX DP', pg_temp.mk('TOWN CENTROID SIX DP', 33.412345, -82.312678, 'approximate',
     'Coordinates are the Harlem city centroid (OSM Nominatim), not a parcel.')),
 ('APPROX TO PLACE',      pg_temp.mk('APPROX TO PLACE', 35.4676, -97.5164, 'approximate',
     'No street address is published. Coordinates approximate to Oklahoma City.')),
 ('TWO DP SITE',          pg_temp.mk('TWO DP SITE', 41.17, -95.79, 'approximate',
     'Google flagship campus, operational since 2007.')),
 ('ROAD REFERENCE',       pg_temp.mk('ROAD REFERENCE', 41.334567, -96.145678, 'approximate',
     'Coordinates are a rough estimate from the named intersection (114th & State St), NOT a parcel-level geocode.')),
 ('HISTORICAL CORRECTION',pg_temp.mk('HISTORICAL CORRECTION', 42.911234, -112.451234, 'approximate',
     'The pin is building-level, not parcel-surveyed. Coordinates corrected 2026-09-12 from a Pocatello city-centroid placeholder to the OpenStreetMap POI for the facility.')),
 ('DIRECTION PHRASE',     pg_temp.mk('DIRECTION PHRASE', 32.751234, -111.551234, 'exact',
     'Coordinates are approximate (parcel south of Eloy city center along Greene Canal; exact boundary unpublished).')),
 ('PARK AREA',            pg_temp.mk('PARK AREA', 34.701234, -86.651234, 'approximate',
     'Coordinates are approximate for Cummings Research Park area.')),
 ('ADDRESS GEOCODE',      pg_temp.mk('ADDRESS GEOCODE', 39.123456, -84.123456, 'approximate',
     'Coordinates are a geocode of the street address, not a parcel-confirmed footprint.')),
 ('MULTI SITE',           pg_temp.mk('MULTI SITE', 40.819950, -74.427986, 'representative_multi_site',
     'Location used is the Hanover Township centroid.', 'AGGREGATE_MULTI_SITE')),
 ('ROUNDED',              pg_temp.mk('ROUNDED', 41.5, -113.5, 'exact',
     'Coordinates are approximate for western Box Elder County;')),
 ('OTHER SOURCE',         pg_temp.mk('OTHER SOURCE', 36.111111, -97.111111, null,
     'Coordinates are the Stillwater city centroid.', 'SITE', 'future_feed', 'sites')),
 ('POSITIVE CONTROL',     pg_temp.mk('POSITIVE CONTROL', 40.012345, -82.912345, 'exact',
     'Coordinates are the Franklin County Auditor parcel centroid (parcel 050-011455).'));

-- one entity with TWO current observations: an area point and a site point
insert into _g_ent values ('TWO OBS', pg_temp.mk('TWO OBS', 44.740000, -93.115000, 'exact',
     'Coordinates are Rosemount city centroid;'));
with o as (
  insert into public.dc_source_observation (source_key, distribution_key, raw_payload,
      source_native_name, source_native_lat, source_native_lon, source_native_precision)
  values ('second_feed', 'sites', '{"notes": "Surveyed site point."}', 'TWO OBS site', 44.741234, -93.114321, null)
  returning home_signal_observation_id)
, l as (insert into public.dc_entity_observation select o.home_signal_observation_id, e.id from o, _g_ent e where e.name = 'TWO OBS' returning home_signal_observation_id)
insert into public.dc_current_flag select home_signal_observation_id from l;

-- ── CANONICAL GEOGRAPHY AUTHORITY (rule_version 4): two PUBLISHER site claims of one entity ──────
-- another observation of an existing entity, from any publisher feed (the class is decided by the
-- evidence: no location-basis rule and >= 2 decimals is a PUBLISHER_SITE claim, whatever the source)
create or replace function pg_temp.add(p_entity text, p_source text, p_lat double precision,
                                       p_lng double precision, p_prec text, p_notes text)
returns void language sql as $$
  with o as (
    insert into public.dc_source_observation (source_key, distribution_key, raw_payload,
        source_native_name, source_native_lat, source_native_lon, source_native_precision)
    values (p_source, 'sites', jsonb_build_object('notes', p_notes), p_entity || ' / ' || p_source,
            p_lat, p_lng, p_prec)
    returning home_signal_observation_id)
  , l as (insert into public.dc_entity_observation
          select o.home_signal_observation_id, e.id from o, _g_ent e where e.name = p_entity
          returning home_signal_observation_id)
  insert into public.dc_current_flag select home_signal_observation_id from l $$;

-- C. two comparable publisher site points 5 km apart: a genuine peer contradiction
insert into _g_ent values ('PEER CONFLICT', pg_temp.mk('PEER CONFLICT', 45.012345, -100.012345, 'exact',
     'Coordinates are the parcel centroid.'));
select pg_temp.add('PEER CONFLICT', 'second_feed', 45.057345, -100.012345, null, 'Surveyed site point.');
-- the same, 300 m apart: agreement within the peer tolerance
insert into _g_ent values ('PEER AGREE', pg_temp.mk('PEER AGREE', 45.212345, -100.212345, 'exact',
     'Coordinates are the parcel centroid.'));
select pg_temp.add('PEER AGREE', 'second_feed', 45.215045, -100.212345, null, 'Surveyed site point.');
-- three site claims: two agree (100 m), the third is 5 km away
insert into _g_ent values ('PEER THREE', pg_temp.mk('PEER THREE', 45.412345, -100.412345, 'exact',
     'Coordinates are the parcel centroid.'));
select pg_temp.add('PEER THREE', 'second_feed', 45.413245, -100.412345, null, 'Surveyed site point.');
select pg_temp.add('PEER THREE', 'third_feed', 45.457345, -100.412345, null, 'Surveyed site point.');
-- E. a point labelled "exact" whose own sentence says it is a town centroid, beside another
-- publisher's unlabelled site point 3.3 km away: the label does not buy authority, and a non-site
-- point is not a claim that can contradict a site
insert into _g_ent values ('EXACT AREA VS SITE', pg_temp.mk('EXACT AREA VS SITE', 45.612345, -100.612345, 'exact',
     'Coordinates are Testville city centroid; exact site unpublished.'));
select pg_temp.add('EXACT AREA VS SITE', 'second_feed', 45.642345, -100.612345, null, 'Surveyed site point.');

create temp table _g_run1 as select * from public.dc_resolve_geography(true);
create temp table _g_run2 as select * from public.dc_resolve_geography(true);
create temp view _g as
  select e.name, g.* from _g_ent e left join public.dc_entity_geography g on g.canonical_entity_id = e.id;

-- G0. the hand-adjudicated corpus: every real Atlas location sentence, 2026-09-24
create temp table _g_corpus (publisher_record_id text, sentence text, expected text);
\copy _g_corpus from 'location_basis_corpus.csv' with (format csv, header true)
insert into _g_result(check_name, pass, detail)
select 'G0 every one of the adjudicated real sentences classifies as adjudicated (area / road / neutral)',
       count(*) = 1183 and count(*) filter (where b.basis <> c.expected) = 0
   and count(*) filter (where c.expected = 'NON_SITE_AREA') > 300
   and count(*) filter (where c.expected = 'NON_SITE_ROAD') > 50,
       count(*) || ' sentences, ' || count(*) filter (where b.basis <> c.expected) || ' disagree: '
       || coalesce(string_agg(left(c.sentence, 60) || ' => ' || b.basis, ' | ') filter (where b.basis <> c.expected), '')
  from _g_corpus c cross join lateral public.dc_location_basis_sentence(c.sentence) b;

insert into _g_result(check_name, pass, detail)
select 'G1 a city centroid labelled "exact" is withheld: PUBLISHER_AREA_POINT, no geometry, exact not trusted',
       geography_status = 'GEOGRAPHY_UNRESOLVED' and rule_key = 'PUBLISHER_AREA_POINT' and geom is null
   and quality_flags @> array['PUBLISHER_AREA_POINT', 'PUBLISHER_CLAIMS_EXACT'],
       geography_status || ' ' || rule_key || ' ' || quality_flags::text
  from _g where name = 'CITY CENTROID EXACT';

insert into _g_result(check_name, pass, detail)
select 'G2 six decimal places do not make a town centroid a site; nor does "approximate to <city>"',
       bool_and(geography_status = 'GEOGRAPHY_UNRESOLVED' and rule_key = 'PUBLISHER_AREA_POINT') and count(*) = 2,
       string_agg(name || '=' || geography_status, ',')
  from _g where name in ('TOWN CENTROID SIX DP', 'APPROX TO PLACE');

insert into _g_result(check_name, pass, detail)
select 'G3 decimal count alone never rejects a site: a 2-dp point with no disqualifying statement resolves (flagged coarse)',
       geography_status = 'RESOLVED' and quality_flags @> array['COARSE_COORDINATES'], geography_status
  from _g where name = 'TWO DP SITE';

insert into _g_result(check_name, pass, detail)
select 'G4 demotion never deletes a facility: every demoted entity still exists and still has its geography row',
       (select count(*) from _g_ent e join public.dc_canonical_entity c on c.canonical_entity_id = e.id) = (select count(*) from _g_ent)
   and (select count(*) from _g where geography_status is null) = 0, null;

insert into _g_result(check_name, pass, detail)
select 'G5 a road / intersection reference is recorded, not demoted (PUBLISHER_ROAD_REFERENCE)',
       geography_status = 'RESOLVED' and quality_flags @> array['PUBLISHER_ROAD_REFERENCE']
   and not quality_flags @> array['PUBLISHER_AREA_POINT'], geography_status || ' ' || quality_flags::text
  from _g where name = 'ROAD REFERENCE';

insert into _g_result(check_name, pass, detail)
select 'G6 not demoted: a historical correction, a direction phrase, a park, an address geocode',
       bool_and(geography_status = 'RESOLVED' and not quality_flags @> array['PUBLISHER_AREA_POINT']) and count(*) = 4,
       string_agg(name || '=' || geography_status, ',')
  from _g where name in ('HISTORICAL CORRECTION', 'DIRECTION PHRASE', 'PARK AREA', 'ADDRESS GEOCODE');

insert into _g_result(check_name, pass, detail)
select 'G7 rule order holds: multi-site stays NOT_A_SITE, a one-decimal point stays ROUNDED_COORDINATES',
       (select geography_status from _g where name = 'MULTI SITE') = 'NOT_A_SITE'
   and (select rule_key from _g where name = 'ROUNDED') = 'ROUNDED_COORDINATES', null;

insert into _g_result(check_name, pass, detail)
select 'G8 the notes rule is keyed on the source: another source''s words decide nothing (NO_LOCATION_BASIS_RULE)',
       geography_status = 'RESOLVED' and provenance->>'location_basis_rule' = 'NO_LOCATION_BASIS_RULE',
       geography_status || ' ' || coalesce(provenance->>'location_basis_rule', '?')
  from _g where name = 'OTHER SOURCE';

insert into _g_result(check_name, pass, detail)
select 'G9 every demotion carries the publisher''s own sentence as evidence',
       provenance->>'location_basis_evidence' like '%Coordinates are Ellendale city centroid;%'
   and provenance->>'location_basis_rule' = 'ATLAS_NOTES_AREA_CENTROID', provenance::text
  from _g where name = 'CITY CENTROID EXACT';

insert into _g_result(check_name, pass, detail)
select 'G10 a site observation is preferred over an area observation of the same entity',
       geography_status = 'RESOLVED' and lat = 44.741234 and lng = -93.114321, geography_status || ' ' || lat || ',' || lng
  from _g where name = 'TWO OBS';

insert into _g_result(check_name, pass, detail)
select 'G11 positive control: a parcel-centroid site resolves as a PUBLISHER_POINT with geometry',
       geography_status = 'RESOLVED' and rule_key = 'PUBLISHER_POINT' and geometry_type = 'POINT' and geom is not null,
       geography_status || ' ' || rule_key
  from _g where name = 'POSITIVE CONTROL';

insert into _g_result(check_name, pass, detail)
select 'G12 idempotent: a second apply rewrites nothing',
       (select value from _g_run2 where metric = 'ROWS_WRITTEN') = '0'
   and (select value::int from _g_run1 where metric = 'ROWS_WRITTEN') = (select count(*) from _g_ent),
       (select value from _g_run1 where metric = 'ROWS_WRITTEN') || ' then ' || (select value from _g_run2 where metric = 'ROWS_WRITTEN');

-- G13. an acquisition that lands between identity and geography: current evidence not yet linked
create temp table _g_before as
  select md5(string_agg(g::text, '|' order by g.canonical_entity_id)) h,
         count(*) filter (where geography_status = 'RESOLVED') resolved from public.dc_entity_geography g;
with o as (
  insert into public.dc_source_observation (source_key, distribution_key, raw_payload,
      source_native_name, source_native_lat, source_native_lon, source_native_precision)
  select source_key, distribution_key, raw_payload, source_native_name, source_native_lat,
         source_native_lon, source_native_precision from public.dc_source_observation
   where source_native_name = 'POSITIVE CONTROL'
  returning home_signal_observation_id)
insert into public.dc_current_flag select home_signal_observation_id from o;
delete from public.dc_current_flag f
 using public.dc_source_observation o
 where o.home_signal_observation_id = f.home_signal_observation_id
   and o.source_native_name = 'POSITIVE CONTROL'
   and exists (select 1 from public.dc_entity_observation eo where eo.home_signal_observation_id = o.home_signal_observation_id);
create temp table _g_run3 as select * from public.dc_resolve_geography(true);
insert into _g_result(check_name, pass, detail)
select 'G13 unlinked current evidence refuses the run: nothing rewritten, nothing unresolved, the published set stands',
       (select value from _g_run3 where metric = 'REFUSED_IDENTITY_PENDING') = '1'
   and (select value from _g_run3 where metric = 'ROWS_WRITTEN') = '0'
   and b.h = (select md5(string_agg(g::text, '|' order by g.canonical_entity_id)) from public.dc_entity_geography g)
   and b.resolved > 0,
       (select string_agg(metric || '=' || value, ',') from _g_run3)
  from _g_before b;

insert into _g_result(check_name, pass, detail)
select 'G14 [C] two publisher site claims 5 km apart: SOURCES_DISAGREE (SITE_CLAIMS_CONFLICT), no geometry -- never an arbitrary pick',
       geography_status = 'GEOGRAPHY_UNRESOLVED' and rule_key = 'SOURCES_DISAGREE'
   and quality_flags @> array['SITE_CLAIMS_CONFLICT'] and geom is null,
       geography_status || ' ' || rule_key || ' ' || quality_flags::text
  from _g where name = 'PEER CONFLICT';

insert into _g_result(check_name, pass, detail)
select 'G15 [C] two publisher site claims 300 m apart agree: RESOLVED at the exact-labelled point, not a disagreement',
       geography_status = 'RESOLVED' and lat = 45.212345 and lng = -100.212345 and not quality_flags @> array['SOURCES_DISAGREE'],
       geography_status || ' ' || lat || ',' || lng || ' ' || quality_flags::text
  from _g where name = 'PEER AGREE';

insert into _g_result(check_name, pass, detail)
select 'G16 [C] three site claims, one 5 km off: fails closed -- the closest agreeing pair does not win',
       geography_status = 'GEOGRAPHY_UNRESOLVED' and rule_key = 'SOURCES_DISAGREE' and geom is null,
       geography_status || ' ' || rule_key
  from _g where name = 'PEER THREE';

insert into _g_result(check_name, pass, detail)
select 'G17 [E] an "exact" label on a town-centroid point buys no authority: the other publisher''s site point places it',
       geography_status = 'RESOLVED' and lat = 45.642345 and lng = -100.612345 and not quality_flags @> array['SOURCES_DISAGREE']
   and authority_source_key = 'second_feed',
       geography_status || ' ' || lat || ',' || lng || ' ' || coalesce(authority_source_key, '?')
  from _g where name = 'EXACT AREA VS SITE';

-- G18. the one contradiction definition, at its boundaries (1 deg latitude ~ 111,195 m)
insert into _g_result(check_name, pass, detail)
select 'G18 dc_site_claims_conflict: derived bound 2 km, peer 1 km, two derived 4 km, non-site never, source-blind',
       not public.dc_site_claims_conflict('PUBLISHER_SITE', null, 40, -100, 'DERIVED_ADDRESS', 2000, 40.0170, -100)
   and     public.dc_site_claims_conflict('PUBLISHER_SITE', null, 40, -100, 'DERIVED_ADDRESS', 2000, 40.0190, -100)
   and not public.dc_site_claims_conflict('PUBLISHER_SITE', null, 40, -100, 'PUBLISHER_SITE', null, 40.0085, -100)
   and     public.dc_site_claims_conflict('PUBLISHER_SITE', null, 40, -100, 'PUBLISHER_SITE', null, 40.0095, -100)
   and not public.dc_site_claims_conflict('DERIVED_ADDRESS', 2000, 40, -100, 'DERIVED_ADDRESS', 2000, 40.0350, -100)
   and     public.dc_site_claims_conflict('DERIVED_ADDRESS', 2000, 40, -100, 'DERIVED_ADDRESS', 2000, 40.0370, -100)
   and not public.dc_site_claims_conflict('PUBLISHER_NON_SITE', null, 40, -100, 'PUBLISHER_SITE', null, 41, -100)
   and not public.dc_site_claims_conflict('PUBLISHER_UNUSABLE', null, 40, -100, 'DERIVED_ADDRESS', 2000, 41, -100)
   and not exists (select 1 from pg_proc p where p.proname = 'dc_site_claims_conflict'
                    and (p.prosrc ~* 'source_key|compute_atlas|epoch|zcta|zip' or pg_get_function_identity_arguments(p.oid) ~* 'source')),
       null;

select check_name, coalesce(pass, false) as pass, detail from _g_result order by n;

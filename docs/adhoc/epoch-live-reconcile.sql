-- READ-ONLY (scratch; never merged): every current Epoch record's automatic outcome, live.
with rec as (
  select distinct on (ri.record_key) ri.record_key, ri.identity_state, ri.canonical_entity_id eid,
         c.source_native_name nm, c.home_signal_observation_id oid
    from public.dc_record_identity ri
    join public.dc_current_observation c using (home_signal_observation_id)
   where ri.source_key = 'epoch_ai'
   order by ri.record_key, c.run_seq desc, c.home_signal_observation_id)
select json_build_object(
         'record_key', r.record_key, 'name', r.nm, 'identity', r.identity_state, 'entity', r.eid,
         'entity_sources', (select string_agg(distinct eo.source_key, ',') from public.dc_entity_observation eo where eo.canonical_entity_id = r.eid),
         'geography', g.geography_status, 'rule', g.rule_key, 'flags', g.quality_flags,
         'authority_source', g.authority_source_key, 'lat', g.lat, 'lng', g.lng,
         'geocode', (select dp.verdict from public.dc_observation_derived_point dp where dp.home_signal_observation_id = r.oid limit 1),
         'input', (select dp.input_quality from public.dc_observation_derived_point dp where dp.home_signal_observation_id = r.oid limit 1))::text line
  from rec r left join public.dc_entity_geography g on g.canonical_entity_id = r.eid
union all
select json_build_object('summary', true,
         'records', (select count(*) from rec),
         'geocodes_stored', (select count(*) from public.dc_address_geocode),
         'geocodes_by_type', (select json_object_agg(match_type, n) from (select match_type, count(*) n from public.dc_address_geocode group by 1) x),
         'queue_remaining', (select count(*) from public.dc_geocode_queue),
         'live_entities', (select count(*) from public.dc_canonical_entity where superseded_by is null),
         'geo_rule_versions', (select json_object_agg(rule_version, n) from (select rule_version, count(*) n from public.dc_entity_geography group by 1) x),
         'sources_disagree', (select count(*) from public.dc_entity_geography g join public.dc_canonical_entity e using (canonical_entity_id) where e.superseded_by is null and g.rule_key = 'SOURCES_DISAGREE'))::text;

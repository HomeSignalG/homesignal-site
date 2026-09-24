-- dc-geocode-probe-inputs.sql — READ-ONLY input set for scripts/dc-geocode-probe.ts.
-- One JSON object per line. Run inside a READ ONLY transaction by dc-geocode-probe.yml.
--
-- kind = 'epoch'  every CURRENT epoch_ai/data_centers observation in the United States, with its
--                 address VERBATIM (incomplete addresses included, so the probe records what the
--                 provider does with them rather than assuming).
-- kind = 'calib'  Atlas CONFIRMED_DC records whose own publisher point is a SITE point we already
--                 publish (RESOLVED, location basis UNSTATED, precision 'exact', >= 5 decimals) AND
--                 which carry a house-numbered street address. Geocoding THAT address and comparing
--                 it with the same record's own point measures street-interpolation error on
--                 data-centre addresses without assuming any cross-source identity.
select json_build_object('kind', 'epoch', 'oid', o.home_signal_observation_id,
                         'name', o.source_native_name,
                         'query', btrim(coalesce(o.source_native_address->>'Address', '')))::text
  from public.dc_current_observation c
  join public.dc_source_observation o using (home_signal_observation_id)
 where o.source_key = 'epoch_ai' and o.distribution_key = 'data_centers'
   and o.source_native_address->>'Country' = 'United States'
union all
select json_build_object('kind', 'calib', 'oid', o.home_signal_observation_id,
                         'name', o.source_native_name,
                         'query', btrim(o.source_native_address->>'street') || ', '
                                  || btrim(o.source_native_address->>'city') || ', '
                                  || btrim(o.source_native_address->>'state')
                                  || coalesce(' ' || nullif(btrim(o.source_native_address->>'postalCode'), ''), ''))::text
  from public.dc_current_observation c
  join public.dc_source_observation o using (home_signal_observation_id)
  join public.dc_entity_observation eo using (home_signal_observation_id)
  join public.dc_canonical_entity e on e.canonical_entity_id = eo.canonical_entity_id
  join public.dc_entity_geography g on g.canonical_entity_id = eo.canonical_entity_id
 where o.source_key = 'compute_atlas'
   and e.classification = 'CONFIRMED_DC'
   and g.geography_status = 'RESOLVED'
   and g.provenance->>'location_basis' = 'UNSTATED'
   and o.source_native_precision = 'exact'
   and least(scale(o.source_native_lat::text::numeric), scale(o.source_native_lon::text::numeric)) >= 5
   and o.source_native_address->>'street' ~ '^\d'
   and nullif(btrim(o.source_native_address->>'city'), '') is not null
   and nullif(btrim(o.source_native_address->>'state'), '') is not null;

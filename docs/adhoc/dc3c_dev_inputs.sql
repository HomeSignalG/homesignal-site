-- Every legacy_development identity in the ledger with its classifier inputs, so the SHIPPED classifier
-- can be run offline to select the resident DC permits. Read-only.
select count(*) as n,
       json_agg(json_build_object('k', record_key, 'n', has_source_native_key, 'b', source_native_key_basis,
                                  'u', source_url, 'i', classifier_inputs, 'p', source_population, 'r', resident_reachable)
                order by record_key collate "C") as rows
  from public.dc_resident_lineage_ledger
 where source_population = 'legacy_development';

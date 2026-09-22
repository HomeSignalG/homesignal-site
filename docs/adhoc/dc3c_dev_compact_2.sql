-- Compact legacy_development export, part 2 of 2 (80 identities each), for offline classification.
with d as (
  select record_key, classifier_inputs
    from public.dc_resident_lineage_ledger
   where source_population = 'legacy_development'
   order by record_key collate "C"
   offset 80 limit 80
)
select (select count(*) from public.dc_resident_lineage_ledger where source_population='legacy_development') as total_dev,
       json_agg(json_build_array(d.record_key,
         (select json_agg(json_build_array(i->>'record_kind', i->>'type', i->>'type_raw', left(i->>'name', 140), i->>'status', i->>'stage'))
            from jsonb_array_elements(d.classifier_inputs) i))) as rows
  from d;

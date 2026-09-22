-- Is the Government Source Archive live, and is it scoped to DC sources at all? Read-only.
select
  (select json_agg(json_build_object('id', id, 'public', public) order by id collate "C") from storage.buckets) as buckets,
  (select count(*) from storage.objects where bucket_id = 'government-source-archive') as gov_archive_objects,
  (select json_agg(json_build_object('t', t, 'exists', to_regclass('public.'||t) is not null) order by t collate "C")
     from unnest(array['source_registry','acquisition_runs','acquisition_errors','source_documents','gov_actions','gov_subjects']) t) as tables,
  (select count(*) from public.source_registry) as registry_rows,
  (select json_agg(source_id order by source_id collate "C") from public.source_registry) as registered_sources,
  (select count(*) from public.source_documents) as documents,
  (select count(*) from public.acquisition_runs) as archive_runs;

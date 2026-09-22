-- Phase 4 Gate 2: where does the exact publisher response live? Read-only.
select
  (select json_agg(json_build_object('source', source_key, 'seq', run_seq, 'state', completeness_state,
          'bytes', artifact_bytes, 'sha', left(artifact_sha256, 12), 'ref', artifact_ref,
          'media', artifact_media_type, 'parser', parser_key || '@' || parser_version,
          'seen', records_seen, 'parsed', records_parsed, 'adv', advanced_observations) order by run_seq)
     from public.dc_acquisition_run) as runs,
  (select json_agg(json_build_object('source', source_key, 'preserves_record_bytes', preserves_record_bytes,
          'supplies_id', supplies_publisher_record_id, 'licence', licence, 'active', active_state,
          'min', expected_min_records, 'not_seen', not_seen_vocabulary, 'dists', distributions) order by source_key collate "C")
     from public.dc_source) as sources,
  (select json_build_object('obs', count(*), 'with_payload_ref', count(raw_payload_ref),
          'with_raw_sha', count(raw_record_sha256), 'with_pub_id', count(publisher_record_id))
     from public.dc_source_observation) as obs,
  (select json_agg(json_build_object('bucket', bucket_id, 'objects', n) order by bucket_id collate "C")
     from (select bucket_id, count(*) n from storage.objects group by bucket_id) b) as buckets,
  (select count(*) from storage.objects where name ilike '%atlas%' or name ilike '%epoch%' or name ilike 'dc%' or bucket_id ilike '%dc%' or bucket_id ilike '%evidence%') as dc_like_objects,
  -- jsonb reorders keys: prove on the stored payloads whether the publisher's key order survives
  (select jsonb_object_keys_order from (select string_agg(k, ',') as jsonb_object_keys_order
     from (select jsonb_object_keys(raw_payload) k from public.dc_source_observation
            where source_key = (select min(source_key collate "C") from public.dc_source) limit 40) x) y) as sample_stored_key_order;

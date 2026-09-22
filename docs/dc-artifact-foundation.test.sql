-- ============================================================================
-- DC ARTIFACT FOUNDATION -- rolled-back behavioural test of docs/dc-artifact-foundation.sql
-- ============================================================================
-- Runnable form (one transaction; the final RAISE rolls EVERYTHING back, DDL included):
--     <the _pre_fp line below>  ++  docs/dc-artifact-foundation.sql  ++  <the DO block below>
-- executed through .github/workflows/db-sql.yml. Every result row reports "d": null on PASS.
--
-- APPLIED 2026-09-22 as migration version 20260922211633 (dc_artifact_foundation_20260922). The
-- ledger's recorded statement md5 is 1a5f075fa1da455211fb4e0818dc16df = md5 of
-- docs/dc-artifact-foundation.sql, so that file IS the applied statement. Post-apply, live:
-- this block (without the DDL) 20/20 PASS rolled back; 2A 72/[51,53]; 3A 20/NONE; 0 sources
-- hold the capability; 0 historical snapshots changed; resident fingerprint unchanged.
--
-- Measured 2026-09-22 before apply: A..P all PASS (20 checks: A B B2 C C2 D D2 E F G G2 H H2 I K L M N O P). Q/R report the existing
-- self-tests INSIDE this transaction, where this test's own rows are present:
--   2A #28 (TRUNCATE refused while this test's deferred trigger events are pending) and
--   3A #17 (this test's observations have no canonical entity) are TEST-DATA effects. The
--   migration alone was measured separately: 2A 72/[51,53] and 3A 20/NONE, before AND after.
--
-- Mutation proof (each mutant applied to the migration, run in its own rolled-back txn):
--   completion rule off, observation rule off, snapshot key off, fingerprint contribution off,
--   version bump off, size check off, existence check off, code_version check off, regex
--   ignores sha, regex ignores source, fingerprint suffix always -- 11/11 KILLED, 10 on behaviour.
--   The existence-check mutant dies only on its error text: with it removed, the size check
--   (NULL size <> claimed bytes) still refuses, so that rule is redundant defence, not load-bearing.
--   D2 / G2 / H2 exist because the first pass killed three of those only by error TEXT;
--   they make each rule the sole thing standing between a bad run and SUCCESS_COMPLETE.

create temp table _pre_fp as select source_key, contract_fingerprint, contract_version from public.dc_source;

-- ================== ROLLED-BACK BEHAVIOURAL TEST (never commits) ==================
do $t$
declare
  res jsonb := '[]'::jsonb;
  SRC constant text := '__art_selftest__';
  SRC_OFF constant text := '__art_off__';
  SHA constant text := repeat('ab', 32);
  FP1 constant text := repeat('c1', 32);
  KEY text := 'dc_evidence/__art_selftest__/' || repeat('ab', 32) || '.json';
  REF text := 'storage://government-source-archive/dc_evidence/__art_selftest__/' || repeat('ab', 32) || '.json';
  r1 uuid; r_off uuid; fp_false text; fp_true text; v_false int; v_true int; snap jsonb;
  obs_ok jsonb; obs_bad jsonb; s2a jsonb; s3a jsonb; msg text; ok_receipt jsonb; n int;
  call_fmt text := $q$select public.dc_complete_acquisition(%L,200,%L,'sf',1,1,%L::jsonb,null,%s,'application/json',%s)$q$;
begin
  -- production contracts untouched by the migration (captured before it ran)
  select count(*) into n from _pre_fp p join public.dc_source s using (source_key)
   where p.contract_fingerprint is distinct from s.contract_fingerprint
      or p.contract_version is distinct from s.contract_version;
  res := res || jsonb_build_object('n','A existing contract fingerprints/versions unchanged','d',
                                   case when n = 0 and (select count(*) from _pre_fp) >= 2 then null else n::text || ' moved' end);

  insert into public.dc_source (source_key,publisher,dataset_name,licence,distributions,
      supplies_publisher_record_id,supplies_geometry,supplies_lifecycle_status,
      supplies_release_identity,preserves_record_bytes,expected_min_records,not_seen_vocabulary)
    values (SRC,'t','t','none',array['d'],false,false,false,false,false,1,'SOURCE_RECORD_NOT_SEEN');
  select contract_fingerprint, contract_version into fp_false, v_false from public.dc_source where source_key = SRC;
  update public.dc_source set preserves_artifact_bytes = true where source_key = SRC;
  select contract_fingerprint, contract_version into fp_true, v_true from public.dc_source where source_key = SRC;
  res := res || jsonb_build_object('n','B opting in bumps the version and moves the fingerprint','d',
       case when v_true = v_false + 1 and fp_true <> fp_false then null else format('v %s->%s fp same=%s', v_false, v_true, fp_true = fp_false) end);

  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,parser_key,parser_version,
      source_contract_version,source_contract,source_contract_fingerprint)
    values (SRC,'d','manual','https://t.invalid','p','1',0,'{}','') returning id, source_contract into r1, snap;
  res := res || jsonb_build_object('n','C the frozen snapshot carries the capability','d',
       case when (snap->>'preserves_artifact_bytes')::boolean then null else snap::text end);
  -- B2: the fingerprint is EXACTLY the old formula when false and the old formula plus the capability when true
  res := res || jsonb_build_object('n','B2 fingerprints equal exact recomputation (false: legacy formula; true: + capability)','d',
       case when fp_false = md5(SRC||'|'||v_false||'|false|false|false|false|false|1|SOURCE_RECORD_NOT_SEEN|d')
             and fp_true  = md5(SRC||'|'||v_true ||'|false|false|false|false|false|1|SOURCE_RECORD_NOT_SEEN|preserves_artifact_bytes|d')
            then null else format('false=%s true=%s', fp_false, fp_true) end);
  -- C2: a capability run's frozen snapshot re-fingerprints to its frozen fingerprint (check 33's property, extended)
  res := res || jsonb_build_object('n','C2 capability snapshot re-fingerprints to the frozen fingerprint','d',
       case when (select source_contract_fingerprint from public.dc_acquisition_run where id = r1) = md5(
            (snap->>'source_key') || '|' || (snap->>'contract_version') || '|'
         || (snap->>'supplies_publisher_record_id') || '|' || (snap->>'supplies_geometry') || '|'
         || (snap->>'supplies_lifecycle_status')    || '|' || (snap->>'supplies_release_identity') || '|'
         || (snap->>'preserves_record_bytes')       || '|' || (snap->>'expected_min_records') || '|'
         || (snap->>'not_seen_vocabulary') || '|'
         || case when (snap->>'preserves_artifact_bytes')::boolean then 'preserves_artifact_bytes|' else '' end
         || (select string_agg(d, ',' order by d) from jsonb_array_elements_text(snap->'distributions') d))
            then null else 'snapshot does not re-fingerprint' end);

  obs_ok  := jsonb_build_array(jsonb_build_object('source_row_ordinal',0,'semantic_observation_fingerprint',FP1,
               'raw_payload','{}'::jsonb,'normalization_version','nv1','raw_payload_ref', REF || '#row=0'));
  obs_bad := jsonb_build_array(jsonb_build_object('source_row_ordinal',0,'semantic_observation_fingerprint',FP1,
               'raw_payload','{}'::jsonb,'normalization_version','nv1','raw_payload_ref', REF || '#row=9'));

  -- D: no code_version
  res := res || jsonb_build_object('n','D refused without code_version','d',
    public.dc_step2a_expect_fail(format(call_fmt, r1, SHA, obs_ok, '5', quote_literal(REF)), 'code_version'));
  update public.dc_acquisition_run set code_version = 'deadbeef' where id = r1;
  -- E: no artifact_ref (storage failed)
  res := res || jsonb_build_object('n','E refused without artifact_ref (storage failure)','d',
    public.dc_step2a_expect_fail(format(call_fmt, r1, SHA, obs_ok, '5', 'null'), 'must name its preserved artifact'));
  -- F: a mutable publisher URL is not an artifact reference
  res := res || jsonb_build_object('n','F refused: a publisher URL as artifact_ref','d',
    public.dc_step2a_expect_fail(format(call_fmt, r1, SHA, obs_ok, '5', quote_literal('https://t.invalid/x.json')), 'must name its preserved artifact'));
  -- G: another source's key
  res := res || jsonb_build_object('n','G refused: artifact under another source','d',
    public.dc_step2a_expect_fail(format(call_fmt, r1, SHA, obs_ok, '5',
      quote_literal('storage://government-source-archive/dc_evidence/compute_atlas/' || SHA || '.json')), 'must name its preserved artifact'));
  -- H: key names a different hash than the run claims
  res := res || jsonb_build_object('n','H refused: artifact_ref names a different hash','d',
    public.dc_step2a_expect_fail(format(call_fmt, r1, repeat('cd',32), obs_ok, '5', quote_literal(REF)), 'must name its preserved artifact'));
  -- I: well-formed but not preserved
  res := res || jsonb_build_object('n','I refused: object not preserved','d',
    public.dc_step2a_expect_fail(format(call_fmt, r1, SHA, obs_ok, '5', quote_literal(REF)), 'no such object is preserved'));

  begin
    insert into storage.objects (bucket_id, name, metadata) values ('government-source-archive', KEY, jsonb_build_object('size', 5));
  exception when others then
    res := res || jsonb_build_object('n','J could not stage a storage row for the positive path','d', sqlerrm);
    raise exception 'ART_TEST %', res;
  end;
  -- D2: everything valid and preserved EXCEPT code_version -- only the code_version rule can refuse this
  update public.dc_acquisition_run set code_version = null where id = r1;
  res := res || jsonb_build_object('n','D2 refused: preserved + linked but no code_version','d',
    public.dc_step2a_expect_fail(format(call_fmt, r1, SHA, obs_ok, '5', quote_literal(REF)), 'records no code_version'));
  update public.dc_acquisition_run set code_version = 'deadbeef' where id = r1;
  -- G2/H2: the wrongly-named object EXISTS at the claimed size -- only the naming rule can refuse these
  insert into storage.objects (bucket_id, name, metadata) values
    ('government-source-archive', 'dc_evidence/compute_atlas/' || SHA || '.json', jsonb_build_object('size', 5)),
    ('government-source-archive', 'dc_evidence/__art_selftest__/' || repeat('cd',32) || '.json', jsonb_build_object('size', 5));
  res := res || jsonb_build_object('n','G2 refused: an EXISTING object under another source','d',
    public.dc_step2a_expect_fail(format(call_fmt, r1, SHA,
      jsonb_build_array(jsonb_build_object('source_row_ordinal',0,'semantic_observation_fingerprint',FP1,'raw_payload','{}'::jsonb,'normalization_version','nv1',
        'raw_payload_ref','storage://government-source-archive/dc_evidence/compute_atlas/' || SHA || '.json#row=0')),
      '5', quote_literal('storage://government-source-archive/dc_evidence/compute_atlas/' || SHA || '.json')), 'must name its preserved artifact'));
  res := res || jsonb_build_object('n','H2 refused: an EXISTING object whose name states a different hash','d',
    public.dc_step2a_expect_fail(format(call_fmt, r1, SHA,
      jsonb_build_array(jsonb_build_object('source_row_ordinal',0,'semantic_observation_fingerprint',FP1,'raw_payload','{}'::jsonb,'normalization_version','nv1',
        'raw_payload_ref','storage://government-source-archive/dc_evidence/__art_selftest__/' || repeat('cd',32) || '.json#row=0')),
      '5', quote_literal('storage://government-source-archive/dc_evidence/__art_selftest__/' || repeat('cd',32) || '.json')), 'must name its preserved artifact'));
  -- K: size mismatch
  res := res || jsonb_build_object('n','K refused: size differs from the preserved object','d',
    public.dc_step2a_expect_fail(format(call_fmt, r1, SHA, obs_ok, '4', quote_literal(REF)), 'preserved object holds'));
  -- L: observation points at the wrong row
  res := res || jsonb_build_object('n','L refused: observation names the wrong artifact row','d',
    public.dc_step2a_expect_fail(format(call_fmt, r1, SHA, obs_bad, '5', quote_literal(REF)), 'observation must carry raw_payload_ref'));
  -- M: POSITIVE
  begin
    execute format(call_fmt, r1, SHA, obs_ok, '5', quote_literal(REF)) into ok_receipt;
    select count(*) into n from public.dc_source_observation where acquisition_run_id = r1 and raw_payload_ref = REF || '#row=0';
    res := res || jsonb_build_object('n','M preserved + linked + versioned run COMPLETES','d',
      case when n = 1 and (select completeness_state from public.dc_acquisition_run where id = r1) = 'SUCCESS_COMPLETE' then null else 'n=' || n end);
  exception when others then
    res := res || jsonb_build_object('n','M preserved + linked + versioned run COMPLETES','d', 'RAISED: ' || sqlerrm);
  end;
  -- N: direct INSERT of a complete run without artifact (the self-test's own path) is refused too
  res := res || jsonb_build_object('n','N refused: direct INSERT already SUCCESS_COMPLETE, no artifact','d',
    public.dc_step2a_expect_fail(format($q$insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint,completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,completeness_state,code_version) values (%L,'d','manual','https://t.invalid','p','1',0,'{}','',now(),200,%L,'sf',1,1,'SUCCESS_COMPLETE','x')$q$, SRC, repeat('ef',32)), 'must name its preserved artifact'));

  -- O: a source WITHOUT the capability is judged exactly as before
  insert into public.dc_source (source_key,publisher,dataset_name,licence,distributions,
      supplies_publisher_record_id,supplies_geometry,supplies_lifecycle_status,
      supplies_release_identity,preserves_record_bytes,expected_min_records,not_seen_vocabulary)
    values (SRC_OFF,'t','t','none',array['d'],false,false,false,false,false,1,'SOURCE_RECORD_NOT_SEEN');
  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,parser_key,parser_version,
      source_contract_version,source_contract,source_contract_fingerprint)
    values (SRC_OFF,'d','manual','https://t.invalid','p','1',0,'{}','') returning id into r_off;
  begin
    execute format($q$select public.dc_complete_acquisition(%L,200,%L,'sf',1,1,%L::jsonb)$q$, r_off, SHA,
      jsonb_build_array(jsonb_build_object('source_row_ordinal',0,'semantic_observation_fingerprint',FP1,'raw_payload','{}'::jsonb,'normalization_version','nv1')));
    res := res || jsonb_build_object('n','O a capability-free source still completes without an artifact','d', null);
  exception when others then
    res := res || jsonb_build_object('n','O a capability-free source still completes without an artifact','d', 'RAISED: ' || sqlerrm);
  end;

  -- P: history is untouched and not reinterpreted
  select count(*) into n from public.dc_acquisition_run
   where source_key in ('compute_atlas','epoch_ai') and source_contract ? 'preserves_artifact_bytes';
  res := res || jsonb_build_object('n','P no historical run snapshot gained the capability','d', case when n = 0 then null else n::text end);

  -- Q/R: the existing self-tests after the migration, counted exactly as the GREEN baseline was
  select count(*) filter (where passed), string_agg(split_part(check_name,' ',1), ',' order by check_name collate "C") filter (where not passed)
    into n, msg from public.dc_step2a_selftest();
  res := res || jsonb_build_object('n','Q step2a selftest (baseline PASS=72 NON_PASSING=[51,53])','d', format('PASS=%s NON_PASSING=[%s]', n, coalesce(msg,'NONE')));
  select count(*) filter (where outcome = 'PASS'),
         string_agg(check_no::text || '=' || outcome, ',' order by check_no) filter (where outcome not in ('PASS','INFO'))
    into n, msg from public.dc_step3a_selftest();
  res := res || jsonb_build_object('n','R step3a selftest (baseline PASS=20 NONE)','d', format('PASS=%s NON_PASSING=[%s]', n, coalesce(msg,'NONE')));

  raise exception 'ART_TEST %', res;
end
$t$;

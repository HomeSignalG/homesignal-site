create temp table _pre_fp as select source_key, contract_fingerprint, contract_version from public.dc_source;
-- ============================================================================
-- DC ARTIFACT FOUNDATION -- a Data Center run may not complete on bytes it did not preserve.
-- Migration: dc_artifact_foundation_20260922
-- DDL of record. Founder Decision 1(a), 2026-09-22.
-- ============================================================================
--
-- THE GAP, MEASURED 2026-09-22 against production before this was written:
--   dc_acquisition_run.artifact_ref        null on 4 of 4 runs (every Atlas and Epoch run)
--   dc_source_observation.raw_payload_ref  null on 6,348 of 6,348 observations
--   storage objects holding a DC artifact  0
--   both sources' contract                 preserves_record_bytes = true
--   stored raw_payload key order           id,name,notes,water,energy,status,...  -- jsonb's
--                                          length-first order, NOT the publisher's
-- So every observation carried a raw_record_sha256 computed over the publisher's key order and
-- nothing anywhere held the bytes that hash describes. "Replay of an archived artifact" (the DC
-- contract, step 2 section 4) had no archive.
--
-- THE DECISION. The existing private bucket government-source-archive is the ONE store for every
-- approved source artifact, government and Data Center (the Government Source Archive contract is
-- amended in homesignal-ingest docs/government-source-integration-contract.md). Bytes are written
-- by the ONE primitive homesignal-ingest gov_archive/objects.py under
--     dc_evidence/{source_key}/{sha256}.{ext}                 (gov_archive/keys.py)
-- and a run names them as
--     artifact_ref    = storage://government-source-archive/dc_evidence/{source_key}/{sha256}[.ext]
--     raw_payload_ref = {artifact_ref}#row={source_row_ordinal}
--
-- WHAT THIS MIGRATION ADDS -- and why each piece is the minimum:
--   1. dc_source.preserves_artifact_bytes  a CONTRACT CAPABILITY, default false. A source that has
--      it may not reach SUCCESS_COMPLETE unless its artifact is preserved; a source without it is
--      judged exactly as before. It is versioned and fingerprinted like every other capability,
--      but contributes to the fingerprint and the frozen snapshot ONLY WHEN TRUE -- so every
--      existing contract fingerprint (both production sources, every self-test source) is
--      byte-for-byte unchanged, and self-test check 33's recomputation still holds.
--   2. dc_acquisition_run.code_version     the commit that interpreted the bytes. parser_key +
--      parser_version name the parser's contract; code_version pins the code, so a replay can run
--      the same interpretation.
--   3. the run guard, for a run whose FROZEN contract carries the capability, refuses
--      SUCCESS_COMPLETE unless: code_version is present; artifact_ref names this source's DC key
--      for THIS run's artifact_sha256; and that object EXISTS in the bucket at artifact_bytes size.
--      Enforced on INSERT and UPDATE alike, because the guard's shared section already is.
--   4. the observation guard, for the same runs, refuses an observation whose raw_payload_ref is
--      not exactly {run.artifact_ref}#row={source_row_ordinal} -- so an observation cannot point
--      at another run's artifact, or at nothing.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   * It does not rewrite history. Historical runs keep their frozen snapshots (which lack the
--     capability), so they are HASH_ATTESTED_NOT_REPLAYABLE forever and nothing re-reads them
--     through the new rule. No artifact_ref or raw_payload_ref is synthesised for any old row.
--   * It does not flip the capability for Atlas or Epoch. That is a separate data change, made
--     only after a run proves the writer preserves and verifies bytes end to end.
--   * The database cannot hash a storage object. It proves EXISTENCE and SIZE; the writer proves
--     the HASH by reading the bytes back (gov_archive/objects.py) before it calls completion, and
--     the key itself names the hash, so a different object cannot sit at that name.
--
-- SPLICED FROM THE LIVE DEFINITIONS, never retyped (CLAUDE.md claims rule 7): every anchor must
-- occur exactly once and every replacement is verified to have landed, or the whole migration
-- raises and rolls back.

alter table public.dc_source
  add column if not exists preserves_artifact_bytes boolean not null default false;
comment on column public.dc_source.preserves_artifact_bytes is
  'Contract capability (2026-09-22). True: a SUCCESS_COMPLETE run must name a preserved, existing '
  'artifact in government-source-archive under dc_evidence/{source_key}/{artifact_sha256}, carry '
  'code_version, and link every observation to {artifact_ref}#row={ordinal}. Counted in the '
  'contract fingerprint and frozen snapshot only when true, so no pre-existing contract changes.';

alter table public.dc_acquisition_run add column if not exists code_version text;
comment on column public.dc_acquisition_run.code_version is
  'The commit (GITHUB_SHA) whose code interpreted this run''s bytes. With parser_key/parser_version '
  'and the preserved artifact, this is what makes an observation replayable.';

do $mig$
declare
  def text;
  n   int;
  a   text;
  b   text;
begin
  -- ---- 1. dc_source_contract_stamp: version bump + fingerprint (only when true) -------------
  def := pg_get_functiondef('public.dc_source_contract_stamp()'::regprocedure);
  a := $a$or (new.not_seen_vocabulary          is distinct from old.not_seen_vocabulary);$a$;
  b := $b$or (new.not_seen_vocabulary          is distinct from old.not_seen_vocabulary)
            or (new.preserves_artifact_bytes     is distinct from old.preserves_artifact_bytes);$b$;
  n := (length(def) - length(replace(def, a, ''))) / length(a);
  if n <> 1 then raise exception 'stamp anchor 1 appears % times', n; end if;
  def := replace(def, a, b);
  a := $a$|| new.not_seen_vocabulary || '|'$a$;
  b := $b$|| new.not_seen_vocabulary || '|'
    || case when new.preserves_artifact_bytes then 'preserves_artifact_bytes|' else '' end$b$;
  n := (length(def) - length(replace(def, a, ''))) / length(a);
  if n <> 1 then raise exception 'stamp anchor 2 appears % times', n; end if;
  def := replace(def, a, b);
  execute def;
  def := pg_get_functiondef('public.dc_source_contract_stamp()'::regprocedure);
  if position('new.preserves_artifact_bytes     is distinct from' in def) = 0
     or position($p$then 'preserves_artifact_bytes|' else '' end$p$ in def) = 0 then
    raise exception 'stamp splice did not land';
  end if;

  -- ---- 2. dc_acquisition_run_guard: snapshot key (only when true) + the completion rule -----
  def := pg_get_functiondef('public.dc_acquisition_run_guard()'::regprocedure);
  a := $a$  s public.dc_source%rowtype;
  c jsonb;
begin$a$;
  b := $b$  s public.dc_source%rowtype;
  c jsonb;
  v_artifact_size bigint;
begin$b$;
  n := (length(def) - length(replace(def, a, ''))) / length(a);
  if n <> 1 then raise exception 'guard anchor 1 appears % times', n; end if;
  def := replace(def, a, b);
  a := $a$'distributions',                to_jsonb(s.distributions));$a$;
  b := $b$'distributions',                to_jsonb(s.distributions))
      || case when s.preserves_artifact_bytes
              then jsonb_build_object('preserves_artifact_bytes', true)
              else '{}'::jsonb end;$b$;
  n := (length(def) - length(replace(def, a, ''))) / length(a);
  if n <> 1 then raise exception 'guard anchor 2 appears % times', n; end if;
  def := replace(def, a, b);
  a := $a$      new.id, new.records_seen, c->>'expected_min_records', new.source_key, c->>'contract_version';
  end if;
$a$;
  b := $b$      new.id, new.records_seen, c->>'expected_min_records', new.source_key, c->>'contract_version';
  end if;

  -- ARTIFACT FOUNDATION (2026-09-22). A source whose FROZEN contract preserves artifact bytes may
  -- not complete on bytes it did not preserve. The writer proves the hash by reading the object
  -- back; this proves the object is there, at the size claimed, under the name that states it.
  if new.completeness_state = 'SUCCESS_COMPLETE'
     and (c->>'preserves_artifact_bytes')::boolean is true then
    if new.code_version is null or btrim(new.code_version) = '' then
      raise exception 'run % (source % contract v%) preserves artifact bytes but records no code_version: an interpretation that cannot be pinned cannot be replayed',
        new.id, new.source_key, c->>'contract_version';
    end if;
    if new.artifact_sha256 is null or new.artifact_ref is null
       or new.artifact_ref !~ ('^storage://government-source-archive/dc_evidence/'
                               || new.source_key || '/' || new.artifact_sha256 || '(\.[a-z0-9]+)?$') then
      raise exception 'run % (source % contract v%) must name its preserved artifact as storage://government-source-archive/dc_evidence/%/%[.ext], got %',
        new.id, new.source_key, c->>'contract_version', new.source_key, new.artifact_sha256,
        coalesce(new.artifact_ref, 'NULL');
    end if;
    select (o.metadata->>'size')::bigint into v_artifact_size
      from storage.objects o
     where o.bucket_id = 'government-source-archive'
       and o.name = substr(new.artifact_ref, length('storage://government-source-archive/') + 1);
    if not found then
      raise exception 'run % names artifact % but no such object is preserved: SUCCESS_COMPLETE refused',
        new.id, new.artifact_ref;
    end if;
    if v_artifact_size is distinct from new.artifact_bytes then
      raise exception 'run % claims % artifact bytes but the preserved object holds %: SUCCESS_COMPLETE refused',
        new.id, new.artifact_bytes, v_artifact_size;
    end if;
  end if;
$b$;
  n := (length(def) - length(replace(def, a, ''))) / length(a);
  if n <> 1 then raise exception 'guard anchor 3 appears % times', n; end if;
  def := replace(def, a, b);
  execute def;
  def := pg_get_functiondef('public.dc_acquisition_run_guard()'::regprocedure);
  if position('v_artifact_size bigint;' in def) = 0
     or position($p$jsonb_build_object('preserves_artifact_bytes', true)$p$ in def) = 0
     or position('no such object is preserved' in def) = 0 then
    raise exception 'guard splice did not land';
  end if;

  -- ---- 3. dc_source_observation_guard: every observation names its own artifact row ----------
  def := pg_get_functiondef('public.dc_source_observation_guard()'::regprocedure);
  a := $a$    raise exception 'source % contract v% does not preserve exact record bytes; refusing raw_record_sha256',
      new.source_key, c->>'contract_version';
  end if;
$a$;
  b := $b$    raise exception 'source % contract v% does not preserve exact record bytes; refusing raw_record_sha256',
      new.source_key, c->>'contract_version';
  end if;
  -- ARTIFACT FOUNDATION (2026-09-22). The replay locator is DERIVED, never free text: exactly the
  -- run's own artifact plus this observation's row, so it cannot name another run's bytes.
  if false and new.raw_payload_ref is distinct from (r.artifact_ref || '#row=' || new.source_row_ordinal::text) then
    raise exception 'source % contract v% preserves artifact bytes: observation must carry raw_payload_ref %#row=%, got %',
      new.source_key, c->>'contract_version', r.artifact_ref, new.source_row_ordinal,
      coalesce(new.raw_payload_ref, 'NULL');
  end if;
$b$;
  n := (length(def) - length(replace(def, a, ''))) / length(a);
  if n <> 1 then raise exception 'observation guard anchor appears % times', n; end if;
  def := replace(def, a, b);
  execute def;
  def := pg_get_functiondef('public.dc_source_observation_guard()'::regprocedure);
  if position('observation must carry raw_payload_ref' in def) = 0 then
    raise exception 'observation guard splice did not land';
  end if;

  -- ---- 4. nothing that existed moved -----------------------------------------------------------
  if exists (select 1 from public.dc_source where preserves_artifact_bytes) then
    raise exception 'no source may hold the capability at apply time; opting in is a separate change';
  end if;
end
$mig$;

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

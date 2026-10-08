-- STEP 2B-1A — ATOMIC EVIDENCE COMMIT. Migration delta against the Step-2A foundation.
--
-- WHAT IT REPAIRS, measured on this database 2026-09-22 in a rolled-back transaction before a
-- line of it was written: Step 2A forces finalisation to precede persistence (an observation may
-- only enter a run that is ALREADY SUCCESS_COMPLETE), while ingest reaches this database over
-- PostgREST where one HTTP request is one transaction. So the two could never share one. A run
-- could therefore commit as SUCCESS_COMPLETE carrying ZERO observations, and the derivation the
-- foundation file documented -- "the newest SUCCESS_COMPLETE run" -- then selected it and
-- returned nothing while the run claimed records_parsed = 3. Every record of a complete
-- acquisition reads as removed.
--
-- THIS FILE IS GENERATED FROM docs/dc-step2a-foundation.sql, never hand-copied (CLAUDE.md claims
-- rule 7). The DDL of record carries the same objects in place; parity is proven after apply by
-- comparing md5(pg_proc.prosrc) against the bodies extracted from that file -- an instrument
-- first validated against the five UNCHANGED functions, whose extracted md5s reproduce their
-- live values exactly.
--
-- WHAT MOVES, AND NOTHING ELSE:
--   dc_acquisition_run_guard     REPLACED -- the database now owns advanced_observations
--   dc_evidence_commit_guard     NEW      -- the deferred commit-time invariant
--   dc_run_evidence_commit_trg   NEW      -- DEFERRABLE INITIALLY DEFERRED constraint trigger
--   dc_complete_acquisition      NEW      -- the canonical one-transaction completion path
--   dc_step2a_selftest           REPLACED -- 54 -> 74 checks
-- No table, column, index, CHECK constraint, RLS setting, or grant to anon/authenticated changes.
--
-- TRANSACTION: no explicit begin/commit, matching every applied SQL file in this repo.

create or replace function public.dc_acquisition_run_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  s public.dc_source%rowtype;
  c jsonb;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'dc_acquisition_run is an append-only receipt log: TRUNCATE is refused';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'dc_acquisition_run is an append-only receipt log: DELETE is refused (run %)', old.id;
  end if;

  if tg_op = 'INSERT' then
    select * into s from public.dc_source where source_key = new.source_key;
    if not found then
      raise exception 'dc_acquisition_run: unknown source_key %', new.source_key;
    end if;
    if not (new.distribution_key = any (s.distributions)) then
      raise exception 'dc_acquisition_run: distribution_key % is not declared by source % (declared: %)',
        new.distribution_key, new.source_key, s.distributions;
    end if;
    -- Freeze the contract this acquisition is governed by. Every field the fingerprint covers is
    -- in the snapshot, so the snapshot can be re-fingerprinted and checked (selftest 33).
    new.source_contract_version     := s.contract_version;
    new.source_contract_fingerprint := s.contract_fingerprint;
    new.source_contract := jsonb_build_object(
      'source_key',                   s.source_key,
      'contract_version',             s.contract_version,
      'supplies_publisher_record_id', s.supplies_publisher_record_id,
      'supplies_geometry',            s.supplies_geometry,
      'supplies_lifecycle_status',    s.supplies_lifecycle_status,
      'supplies_release_identity',    s.supplies_release_identity,
      'preserves_record_bytes',       s.preserves_record_bytes,
      'expected_min_records',         s.expected_min_records,
      'not_seen_vocabulary',          s.not_seen_vocabulary,
      'distributions',                to_jsonb(s.distributions));

    -- THE DATABASE OWNS ADVANCEMENT (Step 2B-1A, part 1 of 2). A run may not be BORN claiming
    -- it advanced observations. dc_run_only_complete_advances already forbids advanced = true
    -- on a non-complete run; this closes the remaining shape, an INSERT that arrives already
    -- SUCCESS_COMPLETE and already claiming advancement -- which would otherwise satisfy
    -- section 3A's commit guard while no observation had ever been written.
    if new.advanced_observations then
      raise exception
        'dc_acquisition_run: advanced_observations is set by the database when observations are '
        'persisted; a run may not be inserted already claiming it';
    end if;
  else
    -- UPDATE.
    if new.source_contract             is distinct from old.source_contract
       or new.source_contract_version     is distinct from old.source_contract_version
       or new.source_contract_fingerprint is distinct from old.source_contract_fingerprint then
      raise exception 'dc_acquisition_run: the contract snapshot is immutable (run %)', old.id;
    end if;
    -- THE DATABASE OWNS ADVANCEMENT (Step 2B-1A, part 2 of 2). dc_mark_run_advanced is an
    -- AFTER INSERT trigger on dc_source_observation, so the UPDATE it issues reaches this guard
    -- at pg_trigger_depth() = 2, while a caller's own UPDATE arrives at depth 1. MEASURED on
    -- this database before it was relied on: direct caller 1, via dc_mark_run_advanced 2.
    -- This is a built-in, not a session flag: there is no setting for a caller to forge.
    -- Before this rule the suite ASSERTED the opposite -- old check 39 required a direct
    -- `set advanced_observations = true` to be ACCEPTED. That was the hole, written down as a
    -- guarantee; it is now checks 39 and 39b.
    if new.advanced_observations is distinct from old.advanced_observations
       and pg_trigger_depth() < 2 then
      raise exception
        'dc_acquisition_run: advanced_observations is owned by the database and moves only when '
        'observations are persisted (run %)', old.id;
    end if;
    if new.source_key is distinct from old.source_key
       or new.distribution_key is distinct from old.distribution_key then
      raise exception 'dc_acquisition_run: source_key/distribution_key are immutable (run %)', old.id;
    end if;
    -- A run may be FINISHED once. After that only the two observability fields move.
    if old.completed_at is not null then
      if (to_jsonb(new) - 'advanced_observations' - 'notes')
         is distinct from (to_jsonb(old) - 'advanced_observations' - 'notes') then
        raise exception 'dc_acquisition_run: a completed run is immutable except advanced_observations/notes (run %)', old.id;
      end if;
    end if;
  end if;

  -- CAPABILITY + COMPLETENESS RULES, read from the FROZEN snapshot on both INSERT and UPDATE, so
  -- an in-flight run cannot acquire a capability it was never granted by being completed later.
  c := new.source_contract;
  if (c->>'supplies_release_identity')::boolean is not true
     and (new.source_release_identity <> '{}'::jsonb or new.source_release_key is not null) then
    raise exception 'source % contract v% supplies no release identity; refusing to fabricate one',
      new.source_key, c->>'contract_version';
  end if;
  if new.completeness_state = 'SUCCESS_COMPLETE'
     and new.records_seen < (c->>'expected_min_records')::integer then
    raise exception 'run % reports % records against a floor of % for source % contract v%: a short artifact is TRUNCATED/PARTIAL, never SUCCESS_COMPLETE',
      new.id, new.records_seen, c->>'expected_min_records', new.source_key, c->>'contract_version';
  end if;

  return new;
end;
$fn$;

drop trigger if exists dc_acquisition_run_guard_trg on public.dc_acquisition_run;
create trigger dc_acquisition_run_guard_trg
  before insert or update or delete on public.dc_acquisition_run
  for each row execute function public.dc_acquisition_run_guard();

-- A row trigger never fires for TRUNCATE, so immutability needs its own statement trigger or it
-- is one command away from being untrue.
drop trigger if exists dc_acquisition_run_truncate_trg on public.dc_acquisition_run;
create trigger dc_acquisition_run_truncate_trg
  before truncate on public.dc_acquisition_run
  for each statement execute function public.dc_acquisition_run_guard();

-- ===========================================================================================
-- 3A. ATOMIC EVIDENCE COMMIT (Step 2B-1A) — SUCCESS_COMPLETE and the evidence it claims become
--     visible in ONE transaction, or neither does.
--
-- WHY THIS EXISTS, measured rather than argued. Section 3 forces the ORDER: an observation may
-- only be inserted into a run that is ALREADY SUCCESS_COMPLETE. Ingest reaches this database
-- over PostgREST, where one HTTP request is one transaction, so finalisation and persistence
-- could never share one. Measured here 2026-09-22 in a rolled-back transaction: an observation
-- against an in-flight run is REFUSED; a direct UPDATE to SUCCESS_COMPLETE carrying ZERO
-- observations COMMITS; and the derivation this file itself documented -- "the newest
-- SUCCESS_COMPLETE run" -- then selects that run and yields 0 observations while the run claims
-- records_parsed = 3. Every record of a complete acquisition reads as removed. That is the
-- anti-truncation floor's own failure mode, reached from the other side.
--
-- THE CLOSED LOOP, which is what makes this an INVARIANT and not a policed path:
--     a committed SUCCESS_COMPLETE run requires advanced_observations = true   (this section)
--     advanced_observations may only move at pg_trigger_depth() >= 2           (section 2 guard)
--     the only thing reaching depth 2 is dc_mark_run_advanced                  (section 3)
--     which fires only on an observation INSERT
--     which section 3's guard permits only on a SUCCESS_COMPLETE run
-- so SUCCESS_COMPLETE can only ever commit beside its observations, in one transaction, with a
-- count equal to records_parsed. NOTHING below asks WHO the caller is. A direct PostgREST UPDATE
-- to SUCCESS_COMPLETE fails at COMMIT because it cannot also insert observations, not because it
-- was recognised and rejected. That is deliberate: a session marker identifying "the blessed
-- function" would be one set_config away from being spoofed and would have to be threaded
-- through every future writer, while an invariant holds for paths nobody has written yet.
--
-- WHY IT IS A DEFERRED CONSTRAINT TRIGGER AND CANNOT BE AN IMMEDIATE ONE: at the instant the
-- run is updated to SUCCESS_COMPLETE its observations do not exist yet and CANNOT exist yet,
-- because section 3 refuses them until that update has happened. An immediate check would
-- therefore make a legitimate completion impossible. The check belongs at COMMIT, which is
-- exactly what a DEFERRABLE INITIALLY DEFERRED constraint trigger is for.
-- ===========================================================================================

create or replace function public.dc_evidence_commit_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  cur public.dc_acquisition_run%rowtype;
  n   integer;
begin
  -- RE-READ THE ROW AS IT STANDS NOW, and do not trust NEW. A constraint trigger captures its
  -- NEW image at STATEMENT time, so NEW.advanced_observations is the value from BEFORE
  -- dc_mark_run_advanced ran later in the same transaction. Reading NEW here rejected the
  -- legitimate completion path -- measured, and the reason this function re-selects.
  select * into cur from public.dc_acquisition_run where id = new.id;
  if not found then
    return null;                         -- nothing to judge; the row is gone from this snapshot
  end if;

  if cur.completeness_state is distinct from 'SUCCESS_COMPLETE' then
    return null;                         -- every other outcome carries no evidence by definition
  end if;

  if cur.advanced_observations is not true then
    raise exception
      'dc_acquisition_run %: SUCCESS_COMPLETE requires advanced_observations = true. A complete '
      'acquisition and its evidence commit together or not at all; use '
      'public.dc_complete_acquisition().', cur.id;
  end if;

  select count(*) into n
    from public.dc_source_observation o
   where o.acquisition_run_id = cur.id;

  if n is distinct from cur.records_parsed then
    raise exception
      'dc_acquisition_run %: SUCCESS_COMPLETE claims records_parsed = % but % observation(s) are '
      'persisted. A partial evidence set is never a complete acquisition.',
      cur.id, cur.records_parsed, n;
  end if;

  return null;
end;
$fn$;

-- AFTER INSERT *and* AFTER UPDATE: a run inserted already-complete is the same hole as one
-- updated into completeness, and covering only the UPDATE would leave the POST wide open.
drop trigger if exists dc_run_evidence_commit_trg on public.dc_acquisition_run;
create constraint trigger dc_run_evidence_commit_trg
  after insert or update on public.dc_acquisition_run
  deferrable initially deferred
  for each row execute function public.dc_evidence_commit_guard();

-- ===========================================================================================
-- THE CANONICAL COMPLETION FUNCTION. One transaction: finalise, persist, verify.
--
-- The signature is TYPED AND NAMED, never "apply this jsonb to the run". Every parameter is a
-- real column a completion legitimately knows, and the ones a caller must NOT choose are absent
-- rather than validated: completeness_state (this path writes SUCCESS_COMPLETE and nothing
-- else), advanced_observations (owned by the database), source_key and distribution_key (read
-- from the run, so observations cannot be aimed at another source), the frozen contract
-- snapshot, id, run_seq, started_at. A caller cannot express those, so there is no rule to
-- enforce about them.
-- ===========================================================================================

create or replace function public.dc_complete_acquisition(
  p_run_id                    uuid,
  p_http_status               integer,
  p_artifact_sha256           text,
  p_schema_fingerprint        text,
  p_records_seen              integer,
  p_records_parsed            integer,
  p_observations              jsonb,
  p_records_rejected          integer     default null,
  p_artifact_bytes            bigint      default null,
  p_artifact_media_type       text        default null,
  p_artifact_ref              text        default null,
  p_source_release_identity   jsonb       default null,
  p_source_release_key        text        default null,
  p_content_release_key       text        default null,
  p_source_declared_freshness timestamptz default null,
  p_observed_freshness        timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  -- Exactly the observation columns a SOURCE may state. Everything else on the table is derived
  -- here from the run. jsonb_to_recordset IGNORES keys it was not asked for, so without this an
  -- unapproved or misspelled key would be dropped in silence -- which is how a source-specific
  -- field quietly becomes a no-op instead of an error.
  approved_keys constant text[] := array[
    'source_row_ordinal','semantic_observation_fingerprint','raw_payload','normalization_version',
    'raw_record_sha256','raw_payload_ref','publisher_record_id',
    'source_native_name','source_native_type','source_native_status',
    'source_native_operator','source_native_operator_confidence','source_native_address',
    'source_native_lon','source_native_lat','source_native_precision','source_timestamps'];
  r          public.dc_acquisition_run%rowtype;
  bad_key    text;
  n_in       integer;
  n_inserted integer;
  n_final    integer;
  fp_in      text;
  fp_stored  text;
begin
  if p_observations is null or jsonb_typeof(p_observations) <> 'array' then
    raise exception 'dc_complete_acquisition: p_observations must be a jsonb ARRAY (got %)',
      coalesce(jsonb_typeof(p_observations), 'null');
  end if;
  n_in := jsonb_array_length(p_observations);
  if n_in = 0 then
    raise exception
      'dc_complete_acquisition: a SUCCESS_COMPLETE acquisition with no observations is not '
      'complete -- an empty release is SUCCESS_ZERO, recorded without this function';
  end if;

  select k into bad_key
    from jsonb_array_elements(p_observations) e, lateral jsonb_object_keys(e) k
   where not (k = any (approved_keys))
   order by k collate "C"
   limit 1;
  if bad_key is not null then
    raise exception
      'dc_complete_acquisition: observation key %L is not part of the source-neutral contract. '
      'Approved keys: %', bad_key, array_to_string(approved_keys, ', ');
  end if;

  -- CARDINALITY, first half: the caller's own parse count must agree with what it actually
  -- serialised. Checking only the inserted count against records_parsed would accept a payload
  -- that silently lost rows before it ever reached the database.
  if n_in <> p_records_parsed then
    raise exception
      'dc_complete_acquisition: p_records_parsed = % but % observation(s) were supplied',
      p_records_parsed, n_in;
  end if;

  -- SINGLE-WRITER. Serialise every finaliser of this run on the run row itself, before any
  -- decision is taken. Under READ COMMITTED a waiting FOR UPDATE re-reads the row version the
  -- winner committed, so the loser evaluates the replay branch below against the FINISHED run
  -- rather than the stale one it first saw. This is the ordering guarantee; nothing here
  -- depends on who gets there first.
  select * into r from public.dc_acquisition_run where id = p_run_id for update;
  if not found then
    raise exception 'dc_complete_acquisition: unknown acquisition run %', p_run_id;
  end if;

  -- The finalisation fingerprint, computed from evidence that is already immutable once a run
  -- has completed: the artifact hash, the schema fingerprint, both counts, and the ordered
  -- (ordinal, semantic fingerprint) pairs. No table exists for idempotency because none is
  -- needed -- the committed rows ARE the record of what was committed.
  -- The sort is on the INTEGER ordinal, so it carries no collation dependency (CLAUDE.md claims
  -- rule 9): there is no text ordering here to pin.
  select md5(p_run_id::text || '|' || coalesce(p_artifact_sha256,'') || '|'
          || coalesce(p_schema_fingerprint,'') || '|' || p_records_seen::text || '|'
          || p_records_parsed::text || '|'
          || coalesce(string_agg(o.source_row_ordinal::text || ':'
                                 || o.semantic_observation_fingerprint,
                                 ',' order by o.source_row_ordinal), ''))
    into fp_in
    from jsonb_to_recordset(p_observations)
      as o(source_row_ordinal integer, semantic_observation_fingerprint text);

  -- ---- REPLAY: the run is already finished --------------------------------------------------
  if r.completed_at is not null then
    if r.completeness_state = 'SUCCESS_COMPLETE' and r.advanced_observations then
      select md5(r.id::text || '|' || coalesce(r.artifact_sha256,'') || '|'
              || coalesce(r.schema_fingerprint,'') || '|' || r.records_seen::text || '|'
              || r.records_parsed::text || '|'
              || coalesce(string_agg(o.source_row_ordinal::text || ':'
                                     || o.semantic_observation_fingerprint,
                                     ',' order by o.source_row_ordinal), ''))
        into fp_stored
        from public.dc_source_observation o
       where o.acquisition_run_id = r.id;

      if fp_stored = fp_in then
        -- A LOST RESPONSE, not a second acquisition. The commit already happened and is
        -- byte-for-byte what this call asks for, so the honest answer is the original receipt.
        return jsonb_build_object(
          'run_id', r.id, 'completeness_state', r.completeness_state,
          'records_parsed', r.records_parsed,
          'observations_persisted', (select count(*) from public.dc_source_observation o
                                      where o.acquisition_run_id = r.id),
          'finalization_fingerprint', fp_stored, 'replayed', true);
      end if;
      raise exception
        'dc_complete_acquisition: run % is already committed with finalisation fingerprint %, '
        'and this call carries %. A different evidence set is a different acquisition -- start a '
        'new run.', r.id, fp_stored, fp_in;
    end if;

    -- Any other finished state, including the SUCCESS_COMPLETE/advanced=false shape this
    -- section makes unreachable. Refuse rather than "repair": a run that reached a terminal
    -- outcome is a receipt, and rewriting one is how a failure becomes a success after the fact.
    raise exception
      'dc_complete_acquisition: run % already completed as % (advanced = %); a completed run is '
      'a receipt and is never re-finalised',
      r.id, coalesce(r.completeness_state, 'NULL'), r.advanced_observations;
  end if;

  -- ---- FINALISE. Every existing guard and CHECK still judges this UPDATE ---------------------
  update public.dc_acquisition_run
     set completed_at               = now(),
         completeness_state         = 'SUCCESS_COMPLETE',
         http_status                = p_http_status,
         artifact_sha256            = p_artifact_sha256,
         artifact_bytes             = p_artifact_bytes,
         artifact_media_type        = p_artifact_media_type,
         artifact_ref               = p_artifact_ref,
         schema_fingerprint         = p_schema_fingerprint,
         records_seen               = p_records_seen,
         records_parsed             = p_records_parsed,
         records_rejected           = p_records_rejected,
         source_release_identity    = coalesce(p_source_release_identity, source_release_identity),
         source_release_key         = p_source_release_key,
         content_release_key        = p_content_release_key,
         source_declared_freshness  = p_source_declared_freshness,
         observed_freshness         = p_observed_freshness
   where id = r.id;

  -- ---- PERSIST. ONE statement, so it is all-or-nothing and dc_mark_run_advanced fires once ---
  insert into public.dc_source_observation (
      acquisition_run_id, source_key, distribution_key,
      source_row_ordinal, semantic_observation_fingerprint, raw_payload, normalization_version,
      raw_record_sha256, raw_payload_ref, publisher_record_id,
      source_native_name, source_native_type, source_native_status,
      source_native_operator, source_native_operator_confidence, source_native_address,
      source_native_lon, source_native_lat, source_native_precision, source_timestamps)
  select r.id, r.source_key, r.distribution_key,
         o.source_row_ordinal, o.semantic_observation_fingerprint, o.raw_payload,
         o.normalization_version, o.raw_record_sha256, o.raw_payload_ref, o.publisher_record_id,
         o.source_native_name, o.source_native_type, o.source_native_status,
         o.source_native_operator, o.source_native_operator_confidence, o.source_native_address,
         o.source_native_lon, o.source_native_lat, o.source_native_precision, o.source_timestamps
    from jsonb_to_recordset(p_observations) as o(
         source_row_ordinal integer, semantic_observation_fingerprint text, raw_payload jsonb,
         normalization_version text, raw_record_sha256 text, raw_payload_ref text,
         publisher_record_id text, source_native_name text, source_native_type text,
         source_native_status text, source_native_operator text,
         source_native_operator_confidence text, source_native_address jsonb,
         source_native_lon double precision, source_native_lat double precision,
         source_native_precision text, source_timestamps jsonb);
  get diagnostics n_inserted = row_count;

  -- CARDINALITY, second half: what the database actually holds for this run. Counted from the
  -- TABLE rather than from row_count alone, so the check still means something if this function
  -- ever gains a second insert path.
  select count(*) into n_final
    from public.dc_source_observation o where o.acquisition_run_id = r.id;

  if n_inserted <> n_in or n_final <> p_records_parsed then
    raise exception
      'dc_complete_acquisition: supplied %, inserted %, run now holds %, records_parsed = % -- '
      'refusing a partial evidence set', n_in, n_inserted, n_final, p_records_parsed;
  end if;

  return jsonb_build_object(
    'run_id', r.id, 'completeness_state', 'SUCCESS_COMPLETE',
    'records_parsed', p_records_parsed, 'observations_persisted', n_final,
    'finalization_fingerprint', fp_in, 'replayed', false);
end;
$fn$;

comment on function public.dc_complete_acquisition(uuid,integer,text,text,integer,integer,jsonb,
  integer,bigint,text,text,jsonb,text,text,timestamptz,timestamptz) is
  'Step 2B-1A. The canonical atomic completion path: finalises an in-flight acquisition to '
  'SUCCESS_COMPLETE and persists its entire observation set in ONE transaction, or neither. '
  'Idempotent on an identical replay (lost response); fails closed on a different payload '
  'against an already-committed run.';

revoke all on function public.dc_evidence_commit_guard()    from public, anon, authenticated;
revoke all on function public.dc_complete_acquisition(uuid,integer,text,text,integer,integer,
  jsonb,integer,bigint,text,text,jsonb,text,text,timestamptz,timestamptz)
  from public, anon, authenticated;

create or replace function public.dc_step2a_selftest()
returns table (check_name text, passed boolean, detail text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  res       jsonb := '[]'::jsonb;
  obs_fmt   text;
  run_fmt   text;
  SRC_FULL  constant text := '__selftest_full__';
  SRC_BARE  constant text := '__selftest_bare__';
  SRC_B1A   constant text := '__selftest_b1a__';       -- Step 2B-1A atomic-commit fixture
  FP1 constant text := repeat('a',64);
  FP2 constant text := repeat('b',64);
  FP5 constant text := repeat('c',64);
  FP6 constant text := repeat('d',64);
  FP7 constant text := repeat('e',64);
  FP8 constant text := repeat('f',64);
  SHA constant text := repeat('1',64);
  r_ok uuid; r_ok2 uuid; r_inflight uuid; r_failed uuid; r_bare uuid; r_v2 uuid;
  v1 integer; v2 integer; v3 integer;
  snap jsonb; fp_live text; fp_recomputed text;
  n integer; m integer; leaked integer;
  bad text;
  rb uuid; rb2 uuid; rb3 uuid;                          -- Step 2B-1A runs
  obs_a jsonb; obs_b jsonb; rj jsonb;
  advflag boolean; state_now text; drain_err text;
begin
  obs_fmt := $q$insert into public.dc_source_observation
      (acquisition_run_id,source_key,distribution_key,source_row_ordinal,
       semantic_observation_fingerprint,raw_payload,normalization_version%s)
    values (%L,%L,%L,%s,%L,'{}'::jsonb,'nv1'%s)$q$;
  run_fmt := $q$insert into public.dc_acquisition_run
      (source_key,distribution_key,trigger_kind,request_url,parser_key,parser_version,
       source_contract_version,source_contract,source_contract_fingerprint%s)
    values (%L,%L,'manual','https://selftest.invalid','p','1',0,'{}'::jsonb,''%s)$q$;

  -- ⚠️ CHECK 28 IS EVALUATED FIRST, AND THE REASON IS MECHANICAL RATHER THAN STYLISTIC.
  -- Postgres refuses TRUNCATE outright on a table carrying PENDING deferred trigger events
  -- (55006), and section 3A's commit guard queues one for every run row written. Once either
  -- fixture below has inserted a run, TRUNCATE can no longer reach OUR guard at all and the
  -- check reports NOT EXERCISED -- correctly, but uselessly. So it runs while nothing pends.
  -- The label keeps its historical number; the numbers here are names, not an order.
  res := res || jsonb_build_object('n','28 TRUNCATE of the evidence tables refused (evaluated FIRST: a pending deferred commit-guard event makes TRUNCATE impossible for Postgres itself)','d',
    public.dc_step2a_expect_fail(
      'truncate public.dc_source_observation, public.dc_acquisition_run','TRUNCATE is refused'));

  begin   -- ====== STEP 2B-1A FIXTURE SUBTRANSACTION (atomic evidence commit) ================

  insert into public.dc_source (source_key,publisher,dataset_name,licence,distributions,
      supplies_publisher_record_id,supplies_geometry,supplies_lifecycle_status,
      supplies_release_identity,preserves_record_bytes,expected_min_records,not_seen_vocabulary)
    values (SRC_B1A,'selftest','selftest','none',array['facilities'],
      true,true,true,true,true,1,'SOURCE_RECORD_NOT_SEEN');

  obs_a := jsonb_build_array(
    jsonb_build_object('source_row_ordinal',0,'semantic_observation_fingerprint',FP1,
                       'raw_payload','{}'::jsonb,'normalization_version','nv1'),
    jsonb_build_object('source_row_ordinal',1,'semantic_observation_fingerprint',FP2,
                       'raw_payload','{}'::jsonb,'normalization_version','nv1'));
  obs_b := jsonb_build_array(
    jsonb_build_object('source_row_ordinal',0,'semantic_observation_fingerprint',FP1,
                       'raw_payload','{}'::jsonb,'normalization_version','nv1'),
    jsonb_build_object('source_row_ordinal',1,'semantic_observation_fingerprint',FP5,
                       'raw_payload','{}'::jsonb,'normalization_version','nv1'));

  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint)
    values (SRC_B1A,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'')
    returning id into rb;
  -- Drain the event that INSERT just queued, so each check below faces only its own.
  -- DRAIN the pending commit-guard events, tolerating a guard that is not there.
  -- A bare `set constraints` raises 42704 when the trigger has been dropped and 0A000 when it
  -- has been recreated NOT DEFERRABLE -- neither inside any check, so either one aborts the
  -- whole suite and every later section reports nothing. That is exactly how a mutation scores
  -- "survived": measured 2026-09-22, dropping the trigger CRASHED this function instead of
  -- failing checks 49/49b/55. Those checks are the right reporters for a missing or
  -- wrongly-timed guard, so the drain does not re-raise -- but it RECORDS the verdict in
  -- drain_err, and check 64 fails on a non-null one.
  --
  -- ⚠️ SWALLOWING IT OUTRIGHT WAS THE FIRST VERSION AND IT BLINDED THE SUITE. Measured: with
  -- the verdict discarded, the mutation that makes this guard trust NEW instead of re-reading
  -- the row SURVIVED the whole suite -- 0 failing checks. The guard raised, the drain ate it,
  -- and check 64 then read committed values that were already correct. A fix for one instrument
  -- defect (a crash that hid every later check) had quietly created another.
  begin
    set constraints public.dc_run_evidence_commit_trg immediate;
    set constraints public.dc_run_evidence_commit_trg deferred;
    drain_err := null;
  exception when others then drain_err := sqlerrm;
  end;

  -- ---- NEGATIVE: the direct SUCCESS_COMPLETE hole is closed, AT COMMIT -----------------------
  res := res || jsonb_build_object('n','55 a direct UPDATE to SUCCESS_COMPLETE with no evidence is refused at commit','d',
    public.dc_step2a_expect_fail(
      format($q$update public.dc_acquisition_run set completed_at=now(),
               completeness_state='SUCCESS_COMPLETE',http_status=200,artifact_sha256=%L,
               schema_fingerprint='sf',records_seen=2,records_parsed=2 where id=%L;
             set constraints public.dc_run_evidence_commit_trg immediate$q$, SHA, rb),
      'requires advanced_observations = true'));

  -- ---- NEGATIVE: the caller may not declare advancement --------------------------------------
  res := res || jsonb_build_object('n','56 a caller may not set advanced_observations directly','d',
    public.dc_step2a_expect_fail(
      format($q$update public.dc_acquisition_run set advanced_observations=true where id=%L$q$, rb),
      'owned by the database'));
  res := res || jsonb_build_object('n','57 a run may not be INSERTED already claiming advancement','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',advanced_observations,completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,completeness_state',
             SRC_B1A,'facilities',
             ',true,now(),200,'||quote_literal(SHA)||',''sf'',2,2,''SUCCESS_COMPLETE'''),
      'may not be inserted already claiming it'));

  -- ---- NEGATIVE: every cardinality disagreement is refused -----------------------------------
  res := res || jsonb_build_object('n','58 completion carrying ZERO observations is refused','d',
    public.dc_step2a_expect_fail(
      format($q$select public.dc_complete_acquisition(%L,200,%L,'sf',2,2,'[]'::jsonb)$q$, rb, SHA),
      'no observations is not'));
  res := res || jsonb_build_object('n','59 FEWER observations than records_parsed is refused','d',
    public.dc_step2a_expect_fail(
      format($q$select public.dc_complete_acquisition(%L,200,%L,'sf',3,3,%L::jsonb)$q$, rb, SHA, obs_a),
      'p_records_parsed = 3 but 2 observation'));
  res := res || jsonb_build_object('n','60 MORE observations than records_parsed is refused','d',
    public.dc_step2a_expect_fail(
      format($q$select public.dc_complete_acquisition(%L,200,%L,'sf',1,1,%L::jsonb)$q$, rb, SHA, obs_a),
      'p_records_parsed = 1 but 2 observation'));

  -- ---- NEGATIVE: an unapproved key is an ERROR, never a silent drop --------------------------
  res := res || jsonb_build_object('n','61 an unapproved observation key is refused (jsonb_to_recordset would have dropped it in silence)','d',
    public.dc_step2a_expect_fail(
      format($q$select public.dc_complete_acquisition(%L,200,%L,'sf',1,1,
               jsonb_build_array(jsonb_build_object('source_row_ordinal',0,
                 'semantic_observation_fingerprint',%L,'raw_payload','{}'::jsonb,
                 'normalization_version','nv1','atlas_campus_id','X')))$q$, rb, SHA, FP1),
      'not part of the source-neutral contract'));

  -- ---- NEGATIVE: a same-acquisition duplicate, through the canonical path --------------------
  res := res || jsonb_build_object('n','62 a duplicate observation inside ONE acquisition is refused','d',
    public.dc_step2a_expect_fail(
      format($q$select public.dc_complete_acquisition(%L,200,%L,'sf',2,2,
               jsonb_build_array(
                 jsonb_build_object('source_row_ordinal',0,'semantic_observation_fingerprint',%L,
                   'raw_payload','{}'::jsonb,'normalization_version','nv1'),
                 jsonb_build_object('source_row_ordinal',0,'semantic_observation_fingerprint',%L,
                   'raw_payload','{}'::jsonb,'normalization_version','nv1')))$q$,
             rb, SHA, FP1, FP2),
      'dc_obs_run_ordinal_uidx'));

  -- ---- ALL-OR-NOTHING: a bad LAST row persists NOTHING and leaves the run in flight ----------
  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint)
    values (SRC_B1A,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'')
    returning id into rb2;
  -- DRAIN the pending commit-guard events, tolerating a guard that is not there.
  -- A bare `set constraints` raises 42704 when the trigger has been dropped and 0A000 when it
  -- has been recreated NOT DEFERRABLE -- neither inside any check, so either one aborts the
  -- whole suite and every later section reports nothing. That is exactly how a mutation scores
  -- "survived": measured 2026-09-22, dropping the trigger CRASHED this function instead of
  -- failing checks 49/49b/55. Those checks are the right reporters for a missing or
  -- wrongly-timed guard, so the drain does not re-raise -- but it RECORDS the verdict in
  -- drain_err, and check 64 fails on a non-null one.
  --
  -- ⚠️ SWALLOWING IT OUTRIGHT WAS THE FIRST VERSION AND IT BLINDED THE SUITE. Measured: with
  -- the verdict discarded, the mutation that makes this guard trust NEW instead of re-reading
  -- the row SURVIVED the whole suite -- 0 failing checks. The guard raised, the drain ate it,
  -- and check 64 then read committed values that were already correct. A fix for one instrument
  -- defect (a crash that hid every later check) had quietly created another.
  begin
    set constraints public.dc_run_evidence_commit_trg immediate;
    set constraints public.dc_run_evidence_commit_trg deferred;
    drain_err := null;
  exception when others then drain_err := sqlerrm;
  end;
  begin
    perform public.dc_complete_acquisition(rb2,200,SHA,'sf',3,3, obs_a ||
      jsonb_build_array(jsonb_build_object('source_row_ordinal',2,
        'semantic_observation_fingerprint','not-a-sha','raw_payload','{}'::jsonb,
        'normalization_version','nv1')));
  exception when others then null;
  end;
  select count(*) into n from public.dc_source_observation where acquisition_run_id = rb2;
  select completeness_state into state_now from public.dc_acquisition_run where id = rb2;
  res := res || jsonb_build_object('n','63 an invalid LAST observation persists NOTHING and leaves the run in flight','d',
    case when n = 0 and state_now is null then null
         else format('%s observation(s) persisted, run state %s (expected 0 / in-flight)',
                     n, coalesce(state_now,'IN_FLIGHT')) end);

  -- ---- POSITIVE CONTROL: the canonical path commits complete AND advanced, atomically --------
  -- ⚠️ CAPTURED, NOT BARE. This is a POSITIVE control, so the mutation that matters is one
  -- that BREAKS the canonical path -- and a bare call would then raise straight out of the
  -- suite, aborting every later check instead of turning this one red. Measured 2026-09-22:
  -- recreating the commit guard NOT DEFERRABLE crashed dc_step2a_selftest() here rather than
  -- failing check 64, which is indistinguishable from a mutation that survived.
  begin
    rj := public.dc_complete_acquisition(rb,200,SHA,'sf',2,2,obs_a);
  exception when others then rj := jsonb_build_object('refused', sqlerrm);
  end;
  -- DRAIN the pending commit-guard events, tolerating a guard that is not there.
  -- A bare `set constraints` raises 42704 when the trigger has been dropped and 0A000 when it
  -- has been recreated NOT DEFERRABLE -- neither inside any check, so either one aborts the
  -- whole suite and every later section reports nothing. That is exactly how a mutation scores
  -- "survived": measured 2026-09-22, dropping the trigger CRASHED this function instead of
  -- failing checks 49/49b/55. Those checks are the right reporters for a missing or
  -- wrongly-timed guard, so the drain does not re-raise -- but it RECORDS the verdict in
  -- drain_err, and check 64 fails on a non-null one.
  --
  -- ⚠️ SWALLOWING IT OUTRIGHT WAS THE FIRST VERSION AND IT BLINDED THE SUITE. Measured: with
  -- the verdict discarded, the mutation that makes this guard trust NEW instead of re-reading
  -- the row SURVIVED the whole suite -- 0 failing checks. The guard raised, the drain ate it,
  -- and check 64 then read committed values that were already correct. A fix for one instrument
  -- defect (a crash that hid every later check) had quietly created another.
  begin
    set constraints public.dc_run_evidence_commit_trg immediate;
    set constraints public.dc_run_evidence_commit_trg deferred;
    drain_err := null;
  exception when others then drain_err := sqlerrm;
  end;
  select completeness_state, advanced_observations into state_now, advflag
    from public.dc_acquisition_run where id = rb;
  select count(*) into n from public.dc_source_observation where acquisition_run_id = rb;
  res := res || jsonb_build_object('n','64 HEADLINE: dc_complete_acquisition commits SUCCESS_COMPLETE + advanced + the whole evidence set','d',
    case when state_now = 'SUCCESS_COMPLETE' and coalesce(advflag,false) and n = 2
          and (rj->>'replayed')::boolean is false and (rj->>'observations_persisted')::int = 2
          and drain_err is null
         then null
         else format('state=%s advanced=%s observations=%s commit_guard_verdict=%s receipt=%s',
                     state_now, advflag, n, coalesce(drain_err,'clean'), left(rj::text,150)) end);

  -- ---- IDEMPOTENCY: a lost response must not become a manual repair --------------------------
  begin
    rj := public.dc_complete_acquisition(rb,200,SHA,'sf',2,2,obs_a);
  exception when others then rj := jsonb_build_object('refused', sqlerrm);
  end;
  select count(*) into n from public.dc_source_observation where acquisition_run_id = rb;
  res := res || jsonb_build_object('n','65 an IDENTICAL replay is a deterministic no-op, not an error','d',
    case when coalesce((rj->>'replayed')::boolean, false) and n = 2 then null
         else format('replayed=%s observations=%s receipt=%s (expected true / 2)',
                     rj->>'replayed', n, left(rj::text,120)) end);

  res := res || jsonb_build_object('n','66 a DIFFERENT payload against an advanced run FAILS CLOSED','d',
    public.dc_step2a_expect_fail(
      format($q$select public.dc_complete_acquisition(%L,200,%L,'sf',2,2,%L::jsonb)$q$, rb, SHA, obs_b),
      'A different evidence set is a different acquisition'));

  -- ---- A finished run is a receipt, never re-finalised ---------------------------------------
  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint,
      completed_at,http_status,completeness_state)
    values (SRC_B1A,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'',
      now(),503,'FETCH_FAILED') returning id into rb3;
  -- DRAIN the pending commit-guard events, tolerating a guard that is not there.
  -- A bare `set constraints` raises 42704 when the trigger has been dropped and 0A000 when it
  -- has been recreated NOT DEFERRABLE -- neither inside any check, so either one aborts the
  -- whole suite and every later section reports nothing. That is exactly how a mutation scores
  -- "survived": measured 2026-09-22, dropping the trigger CRASHED this function instead of
  -- failing checks 49/49b/55. Those checks are the right reporters for a missing or
  -- wrongly-timed guard, so the drain does not re-raise -- but it RECORDS the verdict in
  -- drain_err, and check 64 fails on a non-null one.
  --
  -- ⚠️ SWALLOWING IT OUTRIGHT WAS THE FIRST VERSION AND IT BLINDED THE SUITE. Measured: with
  -- the verdict discarded, the mutation that makes this guard trust NEW instead of re-reading
  -- the row SURVIVED the whole suite -- 0 failing checks. The guard raised, the drain ate it,
  -- and check 64 then read committed values that were already correct. A fix for one instrument
  -- defect (a crash that hid every later check) had quietly created another.
  begin
    set constraints public.dc_run_evidence_commit_trg immediate;
    set constraints public.dc_run_evidence_commit_trg deferred;
    drain_err := null;
  exception when others then drain_err := sqlerrm;
  end;
  res := res || jsonb_build_object('n','67 a FAILED run cannot be completed after the fact','d',
    public.dc_step2a_expect_fail(
      format($q$select public.dc_complete_acquisition(%L,200,%L,'sf',2,2,%L::jsonb)$q$, rb3, SHA, obs_a),
      'already completed as FETCH_FAILED'));
  res := res || jsonb_build_object('n','68 an unknown run is refused','d',
    public.dc_step2a_expect_fail(
      format($q$select public.dc_complete_acquisition(%L,200,%L,'sf',2,2,%L::jsonb)$q$,
             '00000000-0000-0000-0000-000000000000', SHA, obs_a),
      'unknown acquisition run'));

  raise exception using errcode = 'HS999';
  exception when sqlstate 'HS999' then null;
  end;   -- ====== STEP 2B-1A FIXTURE ROLLED BACK ======

  begin   -- ============ FIXTURE SUBTRANSACTION (rolled back by the HS999 sentinel) ============

  insert into public.dc_source (source_key,publisher,dataset_name,licence,distributions,
      supplies_publisher_record_id,supplies_geometry,supplies_lifecycle_status,
      supplies_release_identity,preserves_record_bytes,expected_min_records,not_seen_vocabulary)
    values (SRC_FULL,'selftest','selftest','none',array['facilities'],
      true,true,true,true,true,2,'SOURCE_RECORD_NOT_SEEN');
  insert into public.dc_source (source_key,publisher,dataset_name,licence,distributions,
      supplies_publisher_record_id,supplies_geometry,supplies_lifecycle_status,
      supplies_release_identity,preserves_record_bytes,expected_min_records,not_seen_vocabulary)
    values (SRC_BARE,'selftest','selftest','none',array['data_centers','timelines'],
      false,false,false,false,false,1,'NOT_OBSERVED_IN_CURRENT_RELEASE');

  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint,
      completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,
      completeness_state)
    values (SRC_FULL,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'',
      now(),200,SHA,'sf',2,2,'SUCCESS_COMPLETE') returning id into r_ok;
  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint,
      completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,
      completeness_state)
    values (SRC_FULL,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'',
      now(),200,SHA,'sf',2,2,'SUCCESS_COMPLETE') returning id into r_ok2;
  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint)
    values (SRC_FULL,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'')
    returning id into r_inflight;
  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint,
      completed_at,http_status,completeness_state)
    values (SRC_FULL,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'',
      now(),503,'FETCH_FAILED') returning id into r_failed;
  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint,
      completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,
      completeness_state)
    values (SRC_BARE,'data_centers','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'',
      now(),200,SHA,'sf',1,1,'SUCCESS_COMPLETE') returning id into r_bare;

  -- one real observation, so the same-run duplicate checks have something to collide with
  execute format(obs_fmt, ',publisher_record_id', r_ok, SRC_FULL, 'facilities', 0, FP1, ',''PUB-1''');

  -- ---- NEGATIVE: only a SUCCESS_COMPLETE run may advance observations -----------------------
  res := res || jsonb_build_object('n','01 observation refused against an IN-FLIGHT run','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,'',r_inflight,SRC_FULL,'facilities',1,FP2,''),'only SUCCESS_COMPLETE'));
  res := res || jsonb_build_object('n','02 observation refused against a FETCH_FAILED run','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,'',r_failed,SRC_FULL,'facilities',1,FP2,''),'only SUCCESS_COMPLETE'));

  -- ---- NEGATIVE: same-run duplicates fail, three ways ---------------------------------------
  res := res || jsonb_build_object('n','03 duplicate (run, source_row_ordinal) refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,'',r_ok,SRC_FULL,'facilities',0,FP2,''),'dc_obs_run_ordinal_uidx'));
  res := res || jsonb_build_object('n','04 duplicate (run, publisher_record_id) refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',publisher_record_id',r_ok,SRC_FULL,'facilities',1,FP2,',''PUB-1'''),
      'dc_obs_run_publisher_uidx'));
  res := res || jsonb_build_object('n','05 duplicate (run, semantic fingerprint) refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,'',r_ok,SRC_FULL,'facilities',1,FP1,''),'dc_obs_run_semantic_uidx'));

  -- ---- NEGATIVE: observations are immutable -------------------------------------------------
  res := res || jsonb_build_object('n','06 UPDATE of an observation refused','d',
    public.dc_step2a_expect_fail(
      format($q$update public.dc_source_observation set source_native_name='x'
               where acquisition_run_id=%L$q$, r_ok),'immutable historical evidence'));
  res := res || jsonb_build_object('n','07 DELETE of an observation refused','d',
    public.dc_step2a_expect_fail(
      format($q$delete from public.dc_source_observation where acquisition_run_id=%L$q$, r_ok),
      'immutable historical evidence'));
  res := res || jsonb_build_object('n','08 TRUNCATE of observations refused','d',
    public.dc_step2a_expect_fail(
      'truncate public.dc_source_observation','immutable historical evidence'));

  -- ---- NEGATIVE: capability enforcement, read from the run FROZEN contract -------------------
  res := res || jsonb_build_object('n','09 publisher_record_id refused where the contract supplies none','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',publisher_record_id',r_bare,SRC_BARE,'data_centers',0,FP2,',''X'''),
      'supplies no publisher_record_id'));
  res := res || jsonb_build_object('n','10 geometry refused where the contract supplies none','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',source_native_lon,source_native_lat',r_bare,SRC_BARE,'data_centers',0,FP2,',1.0,2.0'),
      'supplies no geometry'));
  res := res || jsonb_build_object('n','11 lifecycle status refused where the contract supplies none','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',source_native_status',r_bare,SRC_BARE,'data_centers',0,FP2,',''Operating'''),
      'supplies no lifecycle status'));
  res := res || jsonb_build_object('n','12 raw_record_sha256 refused where bytes are not preserved','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',raw_record_sha256',r_bare,SRC_BARE,'data_centers',0,FP2,','||quote_literal(SHA)),
      'does not preserve exact record bytes'));

  -- ---- NEGATIVE: an observation cannot drift from its own run --------------------------------
  res := res || jsonb_build_object('n','13 observation whose source does not match its run refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,'',r_ok,SRC_BARE,'facilities',9,FP2,''),'does not match its run'));

  -- ---- NEGATIVE: unknown stays NULL; no sentinels, no impossible coordinates -----------------
  res := res || jsonb_build_object('n','14 empty-string source value refused (absence is NULL)','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',source_native_name',r_ok,SRC_FULL,'facilities',9,FP2,','''''),
      'dc_obs_no_empty_text'));
  res := res || jsonb_build_object('n','15 longitude without latitude refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',source_native_lon',r_ok,SRC_FULL,'facilities',9,FP2,',1.0'),
      'dc_obs_lonlat_together'));
  res := res || jsonb_build_object('n','16 out-of-range coordinate refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',source_native_lon,source_native_lat',r_ok,SRC_FULL,'facilities',9,FP2,',999,0'),
      'dc_obs_lonlat_range'));
  res := res || jsonb_build_object('n','17 malformed semantic fingerprint refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,'',r_ok,SRC_FULL,'facilities',9,'not-a-sha',''),'dc_obs_semantic_shape'));

  -- ---- NEGATIVE: SUCCESS_COMPLETE is a comparison, never an opinion --------------------------
  res := res || jsonb_build_object('n','18 SUCCESS_COMPLETE with records_parsed < records_seen refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,completeness_state',
             SRC_FULL,'facilities',
             ',now(),200,'||quote_literal(SHA)||',''sf'',5,4,''SUCCESS_COMPLETE'''),
      'dc_run_complete_shape'));
  res := res || jsonb_build_object('n','19 SUCCESS_COMPLETE with a non-200 status refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,completeness_state',
             SRC_FULL,'facilities',
             ',now(),500,'||quote_literal(SHA)||',''sf'',5,5,''SUCCESS_COMPLETE'''),
      'dc_run_complete_shape'));
  res := res || jsonb_build_object('n','20 SUCCESS_COMPLETE below the anti-truncation floor refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,completeness_state',
             SRC_FULL,'facilities',
             ',now(),200,'||quote_literal(SHA)||',''sf'',1,1,''SUCCESS_COMPLETE'''),
      'a short artifact is TRUNCATED'));
  res := res || jsonb_build_object('n','21 completed run with no outcome refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',completed_at',SRC_FULL,'facilities',',now()'),'dc_run_state_iff_done'));
  res := res || jsonb_build_object('n','22 outcome on a run that never completed refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',completeness_state',SRC_FULL,'facilities',',''PARSE_FAILED'''),
      'dc_run_state_iff_done'));
  -- ⚠️ THE EXPECTED REASON CHANGED IN STEP 2B-1A, AND THE SUITE CAUGHT IT. This insert used to
  -- be refused by the CHECK dc_run_only_complete_advances; since the run guard gained its
  -- "a run may not be BORN advanced" rule, a BEFORE trigger refuses it FIRST and the CHECK is
  -- never reached. Still refused, for a stricter reason -- but expect_fail rightly reported
  -- WRONG ERROR rather than banking a refusal it did not recognise, which is exactly what
  -- p_expect is for. The pin follows the behaviour; check 23b keeps the CHECK itself honest.
  res := res || jsonb_build_object('n','23 a non-complete run may not claim it advanced observations','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',completed_at,http_status,completeness_state,advanced_observations',
             SRC_FULL,'facilities',',now(),200,''PARTIAL'',true'),
      'may not be inserted already claiming it'));

  -- ---- NEGATIVE: a run cannot invent a source, a distribution, or a release identity ---------
  res := res || jsonb_build_object('n','24 run on an undeclared distribution refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,'',SRC_FULL,'timelines',''),'is not declared by source'));
  res := res || jsonb_build_object('n','25 run on an unknown source refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,'','__no_such_source__','facilities',''),'unknown source_key'));
  res := res || jsonb_build_object('n','26 publisher release identity refused where the contract supplies none','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',source_release_key',SRC_BARE,'data_centers',',''v2026-09'''),
      'supplies no release identity'));

  -- ---- NEGATIVE: runs are append-only receipts ----------------------------------------------
  res := res || jsonb_build_object('n','27 DELETE of an acquisition run refused','d',
    public.dc_step2a_expect_fail(
      format('delete from public.dc_acquisition_run where id=%L', r_inflight),
      'append-only receipt log'));
  res := res || jsonb_build_object('n','29 a completed run is immutable','d',
    public.dc_step2a_expect_fail(
      format($q$update public.dc_acquisition_run set completeness_state='PARTIAL' where id=%L$q$, r_ok),
      'a completed run is immutable'));
  res := res || jsonb_build_object('n','30 the frozen contract snapshot is immutable','d',
    public.dc_step2a_expect_fail(
      format($q$update public.dc_acquisition_run set source_contract='{}'::jsonb where id=%L$q$, r_ok),
      'contract snapshot is immutable'));
  res := res || jsonb_build_object('n','31 a run cannot change source_key/distribution_key','d',
    public.dc_step2a_expect_fail(
      format($q$update public.dc_acquisition_run set distribution_key='timelines' where id=%L$q$, r_inflight),
      'source_key/distribution_key are immutable'));

  -- ---- NEGATIVE: ACTIVE without a schedule is unrepresentable --------------------------------
  res := res || jsonb_build_object('n','32 ACTIVE source with no schedule refused','d',
    public.dc_step2a_expect_fail(
      $q$insert into public.dc_source (source_key,publisher,dataset_name,licence,distributions,
           supplies_publisher_record_id,supplies_geometry,supplies_lifecycle_status,
           supplies_release_identity,preserves_record_bytes,not_seen_vocabulary,active_state)
         values ('__selftest_active__','x','x','none',array['facilities'],
           false,false,false,false,false,'SOURCE_RECORD_NOT_SEEN','ACTIVE')$q$,
      'dc_source_active_needs_schedule'));

  -- ---- POSITIVE CONTROL: the snapshot reproduces the frozen fingerprint ----------------------
  select source_contract, source_contract_fingerprint into snap, fp_live
    from public.dc_acquisition_run where id = r_ok;
  fp_recomputed := md5(
      (snap->>'source_key') || '|' || (snap->>'contract_version') || '|'
   || (snap->>'supplies_publisher_record_id') || '|' || (snap->>'supplies_geometry') || '|'
   || (snap->>'supplies_lifecycle_status')    || '|' || (snap->>'supplies_release_identity') || '|'
   || (snap->>'preserves_record_bytes')       || '|' || (snap->>'expected_min_records') || '|'
   || (snap->>'not_seen_vocabulary') || '|'
   || (select string_agg(d, ',' order by d) from jsonb_array_elements_text(snap->'distributions') d));
  res := res || jsonb_build_object('n','33 the frozen snapshot re-fingerprints to the frozen fingerprint','d',
    case when fp_recomputed = fp_live and fp_live <> '' then null
         else format('snapshot md5 %s vs stored %s', fp_recomputed, fp_live) end);

  -- ---- STRUCTURAL: the forbidden GLOBAL uniqueness must be ABSENT ----------------------------
  select count(*) into n from pg_indexes
   where schemaname='public' and tablename='dc_source_observation'
     and indexdef like '%UNIQUE%' and indexdef like '%source_key%'
     and indexdef like '%semantic_observation_fingerprint%';
  res := res || jsonb_build_object('n','34 NO global unique on (source_key, semantic fingerprint)','d',
    case when n = 0 then null else format('%s such index(es) exist -- repeated publisher assertions would collapse', n) end);
  select count(*) into n from pg_indexes
   where schemaname='public' and tablename='dc_source_observation'
     and indexdef like '%UNIQUE%' and indexdef like '%source_key%'
     and indexdef like '%publisher_record_id%';
  res := res || jsonb_build_object('n','35 NO global unique on (source_key, publisher_record_id)','d',
    case when n = 0 then null else format('%s such index(es) exist -- a re-published record would collapse', n) end);

  -- ---- POSITIVE CONTROLS: a blanket deny must NOT score green --------------------------------
  res := res || jsonb_build_object('n','36 a well-formed observation is ACCEPTED','d',
    public.dc_step2a_expect_ok(
      format(obs_fmt,',publisher_record_id,source_native_name,source_native_status,source_native_lon,source_native_lat,raw_record_sha256',
             r_ok,SRC_FULL,'facilities',7,FP6,
             ',''PUB-7'',''Selftest DC'',''Operating'',-97.7,30.2,'||quote_literal(SHA))));
  res := res || jsonb_build_object('n','37 the SAME semantic fingerprint in a DIFFERENT run is ACCEPTED (acquisition-scoped identity)','d',
    public.dc_step2a_expect_ok(format(obs_fmt,'',r_ok2,SRC_FULL,'facilities',0,FP1,'')));
  res := res || jsonb_build_object('n','38 the SAME publisher_record_id in a DIFFERENT run is ACCEPTED','d',
    public.dc_step2a_expect_ok(
      format(obs_fmt,',publisher_record_id',r_ok2,SRC_FULL,'facilities',1,FP7,',''PUB-1''')));
  res := res || jsonb_build_object('n','39 notes still moves on a completed run','d',
    public.dc_step2a_expect_ok(
      format($q$update public.dc_acquisition_run set notes='ok' where id=%L$q$, r_ok)));
  -- ⚠️ THIS CHECK USED TO ASSERT THE OPPOSITE, AND THAT WAS THE HOLE. Until 2026-09-22 it
  -- required `set notes='ok', advanced_observations=true` to be ACCEPTED -- i.e. the suite
  -- GUARANTEED that a caller could declare advancement by hand, which is exactly what lets a
  -- SUCCESS_COMPLETE run carry no evidence. The positive control it was really providing (a
  -- completed run is not frozen solid) is preserved above, on `notes` alone.
  -- r_ok2, NOT r_ok: the fixture's own observation already advanced r_ok, and setting a flag
  -- to the value it already holds is a genuine no-op that the guard is right not to refuse.
  -- Measured -- this check reported NO ERROR RAISED against r_ok before the target was fixed.
  res := res || jsonb_build_object('n','39b a caller may NOT declare advancement on a completed run','d',
    public.dc_step2a_expect_fail(
      format($q$update public.dc_acquisition_run set advanced_observations=true where id=%L$q$, r_ok2),
      'owned by the database'));
  res := res || jsonb_build_object('n','40 an all-NULL observation from a no-capability source is ACCEPTED','d',
    public.dc_step2a_expect_ok(format(obs_fmt,'',r_bare,SRC_BARE,'data_centers',0,FP8,'')));
  res := res || jsonb_build_object('n','41 an honest SUCCESS_ZERO release is representable','d',
    public.dc_step2a_expect_ok(
      format(run_fmt,',completed_at,http_status,records_seen,records_parsed,completeness_state',
             SRC_FULL,'facilities',',now(),200,0,0,''SUCCESS_ZERO''')));

  -- ---- CONTRACT VERSIONING: an edit to the registry must not reinterpret history -------------
  select contract_version into v1 from public.dc_source where source_key = SRC_FULL;
  update public.dc_source set homepage_url = 'https://cosmetic.invalid' where source_key = SRC_FULL;
  select contract_version into v2 from public.dc_source where source_key = SRC_FULL;
  res := res || jsonb_build_object('n','42 a cosmetic registry edit does NOT bump contract_version','d',
    case when v2 = v1 then null else format('version moved %s -> %s on a homepage_url edit', v1, v2) end);

  update public.dc_source set supplies_geometry = false where source_key = SRC_FULL;
  select contract_version into v3 from public.dc_source where source_key = SRC_FULL;
  res := res || jsonb_build_object('n','43 a capability edit DOES bump contract_version','d',
    case when v3 = v1 + 1 then null else format('version %s -> %s on a capability edit (expected %s)', v1, v3, v1+1) end);

  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint,
      completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,
      completeness_state)
    values (SRC_FULL,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'',
      now(),200,SHA,'sf',2,2,'SUCCESS_COMPLETE') returning id into r_v2;

  select count(*) into n from public.dc_acquisition_run
   where id = r_ok  and (source_contract->>'supplies_geometry')::boolean is true
     and source_contract_version = v1;
  select count(*) into m from public.dc_acquisition_run
   where id = r_v2 and (source_contract->>'supplies_geometry')::boolean is false
     and source_contract_version = v3;
  res := res || jsonb_build_object('n','44 the OLD run keeps the OLD frozen contract, the NEW run takes the NEW one','d',
    case when n = 1 and m = 1 then null else format('old-run match %s, new-run match %s (both must be 1)', n, m) end);

  res := res || jsonb_build_object('n','45 HEADLINE: geometry is still ACCEPTED on the pre-edit run','d',
    public.dc_step2a_expect_ok(
      format(obs_fmt,',source_native_lon,source_native_lat',r_ok,SRC_FULL,'facilities',8,FP5,',-97.7,30.2')));
  res := res || jsonb_build_object('n','46 HEADLINE: the same geometry is REFUSED on the post-edit run','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',source_native_lon,source_native_lat',r_v2,SRC_FULL,'facilities',0,FP5,',-97.7,30.2'),
      'supplies no geometry'));

  raise exception using errcode = 'HS999';
  exception when sqlstate 'HS999' then null;
  end;   -- ============ FIXTURE ROLLED BACK ============

  -- ---- STRUCTURAL / SECURITY, read-only, outside the fixture ---------------------------------
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname='public' and c.relrowsecurity
     and c.relname in ('dc_source','dc_acquisition_run','dc_source_observation');
  select count(*) into m from pg_policies
   where schemaname='public' and tablename in ('dc_source','dc_acquisition_run','dc_source_observation');
  res := res || jsonb_build_object('n','47 RLS enabled on all 3 tables with ZERO policies','d',
    case when n = 3 and m = 0 then null else format('rls_enabled=%s (need 3), policies=%s (need 0)', n, m) end);

  bad := null;
  select string_agg(format('%s:%s:%s', rolename, tbl, priv), ', ') into bad
    from (select r.rolename, t.tbl, p.priv
            from (values ('anon'),('authenticated')) r(rolename)
            cross join (values ('public.dc_source'),('public.dc_acquisition_run'),
                               ('public.dc_source_observation')) t(tbl)
            cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES')) p(priv)
           where to_regrole(r.rolename) is not null
             and has_table_privilege(r.rolename, t.tbl, p.priv)) q;
  res := res || jsonb_build_object('n','48 anon and authenticated hold ZERO privileges on all 3 tables','d', bad);

  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where not t.tgisinternal and ns.nspname='public'
     and c.relname in ('dc_source','dc_acquisition_run','dc_source_observation');
  res := res || jsonb_build_object('n','49 all 7 guard triggers are installed','d',
    case when n = 7 then null else format('%s non-internal triggers found, expected 7', n) end);

  -- DEFERRABILITY IS NOT COSMETIC. Recreated as NOT DEFERRABLE, this trigger fires while the
  -- observations legitimately cannot exist yet (section 3 refuses them until the run is already
  -- SUCCESS_COMPLETE) and every completion becomes impossible; recreated INITIALLY IMMEDIATE it
  -- does the same by default. Structural, because both mistakes leave a trigger of the right
  -- NAME in place and check 49 above would still count 7.
  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relname = 'dc_acquisition_run'
     and t.tgname = 'dc_run_evidence_commit_trg' and t.tgdeferrable and t.tginitdeferred;
  -- dc_run_only_complete_advances is now a BACKSTOP rather than the first thing to fire: the
  -- run guard refuses a born-advanced INSERT before it, and dc_mark_run_advanced only ever
  -- touches runs that are already SUCCESS_COMPLETE. A declarative constraint nothing reaches is
  -- still worth keeping and is exactly the kind that gets dropped as "dead" -- so it is pinned
  -- structurally, because its removal would otherwise move no number at all.
  select count(*) into n from pg_constraint
   where conname = 'dc_run_only_complete_advances'
     and conrelid = 'public.dc_acquisition_run'::regclass;
  res := res || jsonb_build_object('n','23b the dc_run_only_complete_advances CHECK is still installed (now a backstop)','d',
    case when n = 1 then null else 'the CHECK constraint dc_run_only_complete_advances is gone' end);

  res := res || jsonb_build_object('n','49b the evidence-commit guard is DEFERRABLE INITIALLY DEFERRED','d',
    case when n = 1 then null else 'dc_run_evidence_commit_trg is missing or is not initially deferred' end);

  -- THE SINGLE-WRITER MECHANISM IS STRUCTURAL AND NO BEHAVIOURAL TEST CAN SEE IT. Checks 65/66
  -- prove the LOSER's branch (identical replay -> no-op, different payload -> refused), which is
  -- what a second finaliser executes once it is let through -- but only the row lock makes it a
  -- second finaliser rather than a concurrent first one. A two-session race cannot be run here:
  -- an acquisition run can never be DELETEd, so any committed race fixture would permanently
  -- pollute the production evidence tables. Pinned by reading the shipped source instead.
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname='dc_complete_acquisition'
     and p.prosrc ~ 'from public\.dc_acquisition_run where id = p_run_id for update';
  res := res || jsonb_build_object('n','49c dc_complete_acquisition locks the run row FOR UPDATE before deciding anything','d',
    case when n = 1 then null else 'the FOR UPDATE row lock is absent from dc_complete_acquisition' end);

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname in ('dc_complete_acquisition','dc_evidence_commit_guard')
     and p.prosecdef;
  res := res || jsonb_build_object('n','49d the new functions are SECURITY INVOKER, not DEFINER','d',
    case when n = 0 then null else format('%s of the new functions are SECURITY DEFINER', n) end);

  bad := null;
  select string_agg(format('%s:%s', rolename, fn), ', ') into bad
    from (select r.rolename, f.fn
            from (values ('anon'),('authenticated')) r(rolename)
            cross join (values ('public.dc_complete_acquisition(uuid,integer,text,text,integer,integer,jsonb,integer,bigint,text,text,jsonb,text,text,timestamptz,timestamptz)'),
                               ('public.dc_evidence_commit_guard()')) f(fn)
           where to_regrole(r.rolename) is not null
             and has_function_privilege(r.rolename, f.fn, 'EXECUTE')) q;
  res := res || jsonb_build_object('n','49e anon and authenticated may NOT execute the completion function','d', bad);

  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relname='dc_acquisition_run'
     and t.tgname='dc_acquisition_run_truncate_trg' and (t.tgtype & 32) <> 0;
  res := res || jsonb_build_object('n','50 the run TRUNCATE guard is installed (structural: an FK also blocks that TRUNCATE, so behaviour alone cannot attribute it)','d',
    case when n = 1 then null else 'BEFORE TRUNCATE trigger missing on dc_acquisition_run' end);

  select count(*) into n from public.dc_source
   where source_key in ('compute_atlas','epoch_ai')
     and active_state = 'NOT_ACTIVE' and schedule_cron is null;
  res := res || jsonb_build_object('n','51 Atlas and Epoch are seeded NOT_ACTIVE with no schedule','d',
    case when n = 2 then null else format('%s of 2 seeded sources are NOT_ACTIVE with a null schedule', n) end);

  -- The seeded contract is a MEASURED claim, so the suite has to defend it. Without this the
  -- anti-truncation floor could be widened 1000 -> 1 and NOTHING would move: check 20 proves the
  -- MECHANISM on the fixture source, not the VALUE on the seeded ones. Found by mutation, not by
  -- review -- the same shape as a guard whose removal moves no number.
  select count(*) into n from public.dc_source
   where (source_key = 'compute_atlas'
          and supplies_publisher_record_id and supplies_geometry and supplies_lifecycle_status
          and supplies_release_identity and preserves_record_bytes
          and expected_min_records = 1000
          and not_seen_vocabulary = 'SOURCE_RECORD_NOT_SEEN'
          and distributions = array['facilities']
          and contract_version = 1)
      or (source_key = 'epoch_ai'
          and not supplies_publisher_record_id and not supplies_geometry
          and not supplies_lifecycle_status and not supplies_release_identity
          and preserves_record_bytes
          and expected_min_records = 50
          and not_seen_vocabulary = 'NOT_OBSERVED_IN_CURRENT_RELEASE'
          and distributions = array['data_centers','timelines']
          and contract_version = 1);
  res := res || jsonb_build_object('n','52 the SEEDED capability contract and anti-truncation floors are unedited','d',
    case when n = 2 then null else format('%s of 2 seeded contracts match what was measured (Atlas 2,025 records -> floor 1000; Epoch 86 rows -> floor 50)', n) end);

  select count(*) into n from public.dc_acquisition_run;
  res := res || jsonb_build_object('n','53 CONTROL: zero acquisition runs exist (Step 2A ships no producer)','d',
    case when n = 0 then null else format('%s run(s) exist -- something is acquiring', n) end);

  select (select count(*) from public.dc_source where source_key like '\_\_selftest%')
       + (select count(*) from public.dc_acquisition_run where source_key like '\_\_selftest%')
       + (select count(*) from public.dc_source_observation where source_key like '\_\_selftest%')
    into leaked;
  res := res || jsonb_build_object('n','54 CONTROL: the selftest left NOTHING behind','d',
    case when leaked = 0 then null else format('%s selftest row(s) leaked into production tables', leaked) end);

  return query
    select e->>'n', (e->>'d') is null, e->>'d' from jsonb_array_elements(res) e;
end;
$fn$;

revoke all on function public.dc_step2a_expect_fail(text,text) from public, anon, authenticated;
revoke all on function public.dc_step2a_expect_ok(text)        from public, anon, authenticated;
revoke all on function public.dc_step2a_selftest()             from public, anon, authenticated;

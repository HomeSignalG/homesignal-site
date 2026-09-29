-- =====================================================================================
-- DEVELOPMENT CHANGE LEDGER — EXECUTABLE ADVERSARIAL SUITE  (docs/dev-change-ledger.sql)
--
-- Order E of the Development Activity plan (11 required cases) plus the cases the Order B
-- audit measured: retrieval-time noise, timing skew between ZIP copies, sibling records,
-- non-durable keys. Every expected answer below is a HARD-CODED constant, never computed by
-- the code under test. Output: one row per check (check, pass, detail); a NULL pass is
-- stored as FALSE.
--
-- Scenarios use their own ZIP and key so they cannot interfere with each other. Times are
-- relative to a fixed base 30 days ago, so no fixture can ever be "in the future".
-- =====================================================================================
\set ON_ERROR_STOP on
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);
create temp table _base as select date_trunc('hour', now()) - interval '30 days' as t;
create temp table _ctx (name text primary key, run uuid);

create function pg_temp._t(n numeric) returns timestamptz language sql stable as
$$ select (select t from _base) + n * interval '1 hour' $$;

create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;

create function pg_temp._iso(t timestamptz) returns text language sql immutable as
$$ select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') $$;

-- writes ONE app_projects row the way the materialiser would (delete + insert keeps it simple)
create function pg_temp._set(
  p_zip text, p_key text, p_seq int, p_obs timestamptz,
  p_stage text default 'Submitted', p_status text default 'Proposed', p_type text default 'Commercial',
  p_type_raw text default 'Retail', p_date_kind text default 'filed', p_name text default 'Alpha Plaza',
  p_address text default '1 Main St', p_basis text default 'source_id:case_number',
  p_kind text default 'development', p_submitted date default '2026-08-01'
) returns void language plpgsql as $$
begin
  delete from public.app_projects where zip = p_zip and source_key = p_key and source_seq = p_seq;
  insert into public.app_projects
    (zip, record_kind, source_key, source_key_basis, source_seq, registry_id, name, type, type_raw,
     status, stage, date_kind, submitted_at, address, provenance)
  values (p_zip, p_kind, p_key, p_basis, p_seq, 'fixture-registry', p_name, p_type, p_type_raw,
          p_status, p_stage, p_date_kind, p_submitted, p_address,
          jsonb_build_object('refreshed_at', pg_temp._iso(p_obs), 'source_vintage', 'fixture'));
end $$;

create function pg_temp._obs(p_zip text, p_run text) returns jsonb language plpgsql as $$
declare _j jsonb;
begin
  select public.dev_change_observe_zip(p_zip, (select run from _ctx where name = p_run)) into _j;
  return _j;
end $$;

create function pg_temp._types(p_key text) returns text[] language sql as
$$ select coalesce(array_agg(event_type order by id), '{}') from public.dev_change_event where identity_key = p_key $$;

insert into _ctx select 'base', public.dev_change_start_run(true,  '{"suite":"dev_change_ledger_pg"}');
insert into _ctx select 'r1',   public.dev_change_start_run(false);
insert into _ctx select 'r2',   public.dev_change_start_run(false);
insert into _ctx select 'r3',   public.dev_change_start_run(false);

-- ---- C01  first sighting in a baseline run ------------------------------------------
select pg_temp._set('90001', 'k:c01', 1, pg_temp._t(0));
select pg_temp._obs('90001', 'base');
select pg_temp._ck('C01 a first sighting in a BASELINE run is one first_detected, flagged baseline, not material, no prior value',
  (select count(*) = 1 and bool_and(event_type = 'first_detected' and is_baseline and not material
                                    and prev_facts is null and prev_fp is null and changed_fields = '{}')
     from public.dev_change_event where identity_key = 'k:c01')
  and (select comparable and observation_count = 1 and not change_ready and zips = array['90001']
              and first_observed_at = pg_temp._t(0)
         from public.dev_change_project where identity_key = 'k:c01'));

-- ---- C02  same record, no change -------------------------------------------------------
select pg_temp._set('90001', 'k:c01', 1, pg_temp._t(10));
select pg_temp._obs('90001', 'r1');
select pg_temp._ck('C02 the same record read again with no change writes NO event, counts the observation, and becomes change-ready at two',
  (select pg_temp._types('k:c01') = array['first_detected'])
  and (select observation_count = 2 and change_ready and last_observed_at = pg_temp._t(10)
         from public.dev_change_project where identity_key = 'k:c01'));

-- ---- C03  publisher status changed -------------------------------------------------------
select pg_temp._set('90002', 'k:c03', 1, pg_temp._t(0));
select pg_temp._obs('90002', 'base');
select pg_temp._set('90002', 'k:c03', 1, pg_temp._t(10), p_stage => 'Permit Issued', p_status => 'Approved', p_date_kind => 'issued');
select pg_temp._obs('90002', 'r1');
select pg_temp._ck('C03 a publisher status change is ONE preserved before/after event, material, with both values and both fingerprints',
  (select pg_temp._types('k:c03') = array['first_detected', 'status_changed'])
  and (select material and not is_baseline
              and changed_fields = array['date_kind', 'stage', 'status']
              and prev_facts->>'stage' = 'Submitted' and new_facts->>'stage' = 'Permit Issued'
              and prev_facts->>'status' = 'Proposed' and new_facts->>'status' = 'Approved'
              and prev_fp <> new_fp and observed_at = pg_temp._t(10)
              and publisher_event_type = 'issued' and derivation_version = 1
         from public.dev_change_event where identity_key = 'k:c03' and event_type = 'status_changed'));

-- ---- C04  a new record is first detected, never "approved" -----------------------------------
select pg_temp._set('90003', 'k:c04a', 1, pg_temp._t(0));
select pg_temp._obs('90003', 'base');
select pg_temp._set('90003', 'k:c04b', 1, pg_temp._t(10), p_stage => 'Approved', p_status => 'Approved');
select pg_temp._obs('90003', 'r1');
select pg_temp._ck('C04 a record new after the baseline is first_detected (news, not baseline) — never approved/status_changed — and the untouched record is silent',
  (select pg_temp._types('k:c04b') = array['first_detected'])
  and (select material and not is_baseline from public.dev_change_event where identity_key = 'k:c04b')
  and (select pg_temp._types('k:c04a') = array['first_detected']));

-- ---- C05  source outage -------------------------------------------------------------------------
select pg_temp._set('90004', 'k:c05a', 1, pg_temp._t(0));
select pg_temp._set('90004', 'k:c05b', 1, pg_temp._t(0));
select pg_temp._obs('90004', 'base');
delete from public.app_projects where zip = '90004';
create temp table _o05 as select pg_temp._obs('90004', 'r1') as j;
select pg_temp._ck('C05 a source outage (no rows for the ZIP) writes nothing and removes nothing: no deletion, no cancellation',
  (select (j->>'rows_read')::int = 0 and (j->>'events_written')::int = 0 from _o05)
  and (select count(*) = 2 from public.dev_change_event where identity_key in ('k:c05a', 'k:c05b'))
  and (select count(*) = 2 and bool_and(observation_count = 1 and last_observed_at = pg_temp._t(0))
         from public.dev_change_project where identity_key in ('k:c05a', 'k:c05b')));

-- ---- C06  a successful fetch that omits a prior row --------------------------------------------------
select pg_temp._set('90005', 'k:c06a', 1, pg_temp._t(0));
select pg_temp._set('90005', 'k:c06b', 1, pg_temp._t(0));
select pg_temp._obs('90005', 'base');
delete from public.app_projects where zip = '90005' and source_key = 'k:c06b';
select pg_temp._set('90005', 'k:c06a', 1, pg_temp._t(10));
select pg_temp._obs('90005', 'r1');
select pg_temp._ck('C06 a successful fetch that no longer lists a prior row emits NO cancellation/withdrawal for it and leaves its state intact',
  (select pg_temp._types('k:c06b') = array['first_detected'])
  and (select observation_count = 1 and last_observed_at = pg_temp._t(0) and comparable
         from public.dev_change_project where identity_key = 'k:c06b')
  and (select observation_count = 2 from public.dev_change_project where identity_key = 'k:c06a'));

-- ---- C07  parser / classifier change -----------------------------------------------------------------------
select pg_temp._set('90006', 'k:c07', 1, pg_temp._t(0));
select pg_temp._obs('90006', 'base');
select pg_temp._set('90006', 'k:c07', 1, pg_temp._t(10), p_status => 'Approved', p_type => 'Industrial');
select pg_temp._obs('90006', 'r1');
select pg_temp._ck('C07 a change only in DERIVED fields (status, type) with the publisher''s fields untouched is source_record_updated, not material, never a status change',
  (select pg_temp._types('k:c07') = array['first_detected', 'source_record_updated'])
  and (select not material and changed_fields = array['status', 'type']
         from public.dev_change_event where identity_key = 'k:c07' and event_type = 'source_record_updated'));

-- ---- C08  withdrawn / denied belong to the decision authority ---------------------------------------------------
select pg_temp._set('90007', 'k:c08', 1, pg_temp._t(0));
select pg_temp._obs('90007', 'base');
select pg_temp._set('90007', 'k:c08', 1, pg_temp._t(10), p_stage => 'Withdrawn', p_status => 'Decided');
select pg_temp._obs('90007', 'r1');
select pg_temp._ck('C08a a stage moving to Withdrawn / status Decided is recorded as a generic status_changed with both values — the ledger does not classify it',
  (select pg_temp._types('k:c08') = array['first_detected', 'status_changed'])
  and (select new_facts->>'stage' = 'Withdrawn' and new_facts->>'status' = 'Decided' and prev_facts->>'stage' = 'Submitted'
         from public.dev_change_event where identity_key = 'k:c08' and event_type = 'status_changed'));
do $$
declare t text; n int := 0;
begin
  foreach t in array array['approved', 'denied', 'withdrawn', 'cancelled', 'completed', 'permit_issued'] loop
    begin
      insert into public.dev_change_event
        (identity_key, event_type, material, observed_at, prev_facts, new_facts, prev_fp, new_fp,
         changed_fields, derivation_version, facts_version)
      values ('k:c08', t, true, now(), '{}'::jsonb, '{"a":1}'::jsonb, 'a', 'b', array['stage'], 1, 1);
    exception when check_violation then n := n + 1;
    end;
  end loop;
  perform pg_temp._ck('C08b the event vocabulary REFUSES approved / denied / withdrawn / cancelled / completed / permit_issued (stronger events need reviewed evidence and the decision authority)',
                      n = 6, 'refused ' || n || ' of 6');
end $$;

-- ---- C09  a source reappears after an outage ---------------------------------------------------------------------
select pg_temp._set('90008', 'k:c09a', 1, pg_temp._t(0));
select pg_temp._set('90008', 'k:c09b', 1, pg_temp._t(0));
select pg_temp._obs('90008', 'base');
delete from public.app_projects where zip = '90008';
select pg_temp._obs('90008', 'r1');
select pg_temp._set('90008', 'k:c09a', 1, pg_temp._t(20));
select pg_temp._set('90008', 'k:c09b', 1, pg_temp._t(20), p_stage => 'Approved');
select pg_temp._obs('90008', 'r2');
select pg_temp._ck('C09 records that reappear after an outage are NOT first-detected again: unchanged -> silent, changed -> an ordinary status change',
  (select pg_temp._types('k:c09a') = array['first_detected'])
  and (select pg_temp._types('k:c09b') = array['first_detected', 'status_changed'])
  and (select bool_and(observation_count = 2) from public.dev_change_project where identity_key in ('k:c09a', 'k:c09b')));

-- ---- C10  duplicate / retried fetch, and an older copy --------------------------------------------------------------
select pg_temp._set('90009', 'k:c10', 1, pg_temp._t(0));
select pg_temp._obs('90009', 'base');
select pg_temp._obs('90009', 'base');
select pg_temp._ck('C10a the SAME observation processed twice writes no second event and counts once',
  (select pg_temp._types('k:c10') = array['first_detected'])
  and (select observation_count = 1 from public.dev_change_project where identity_key = 'k:c10'));
select pg_temp._set('90009', 'k:c10', 1, pg_temp._t(-5), p_stage => 'Denied stage');
select pg_temp._obs('90009', 'r1');
select pg_temp._ck('C10b an OLDER copy (read before what the ledger already holds) changes nothing: no event, facts not moved backwards, not counted',
  (select pg_temp._types('k:c10') = array['first_detected'])
  and (select facts->>'stage' = 'Submitted' and last_observed_at = pg_temp._t(0) and observation_count = 1
         from public.dev_change_project where identity_key = 'k:c10'));

-- ---- C11  technical metadata edit ---------------------------------------------------------------------------------------
select pg_temp._set('90010', 'k:c11', 1, pg_temp._t(0));
select pg_temp._obs('90010', 'base');
select pg_temp._set('90010', 'k:c11', 1, pg_temp._t(10), p_name => 'ALPHA PLAZA.', p_address => '1 MAIN ST');
select pg_temp._obs('90010', 'r1');
select pg_temp._ck('C11 a punctuation/casing edit to name/address is preserved as source_record_updated and is NEVER hero-eligible',
  (select pg_temp._types('k:c11') = array['first_detected', 'source_record_updated'])
  and (select not material and changed_fields = array['address', 'name']
         from public.dev_change_event where identity_key = 'k:c11' and event_type = 'source_record_updated'));

-- ---- C12  one project on several ZIP pages, read at different times ----------------------------------------------------------
-- newer copy first, older copy second: the older one must not move the project backwards
select pg_temp._set('90011', 'k:c12a', 1, pg_temp._t(5), p_stage => 'Approved', p_status => 'Approved');
select pg_temp._set('90012', 'k:c12a', 1, pg_temp._t(0));
select pg_temp._obs('90011', 'base');
select pg_temp._obs('90012', 'base');
select pg_temp._ck('C12a one project on two ZIP pages is ONE project with both ZIPs; the older copy adds no event and does not move it backwards',
  (select count(*) = 1 from public.dev_change_project where identity_key = 'k:c12a')
  and (select zips @> array['90011', '90012'] and cardinality(zips) = 2 and facts->>'stage' = 'Approved'
              and observation_count = 1 and last_observed_at = pg_temp._t(5)
         from public.dev_change_project where identity_key = 'k:c12a')
  and (select pg_temp._types('k:c12a') = array['first_detected']));
-- older copy first, newer second: the difference IS a status change
select pg_temp._set('90013', 'k:c12b', 1, pg_temp._t(0));
select pg_temp._set('90014', 'k:c12b', 1, pg_temp._t(5), p_stage => 'Approved', p_status => 'Approved');
select pg_temp._obs('90013', 'base');
select pg_temp._obs('90014', 'r1');
select pg_temp._ck('C12b the same two copies in the other order give the SAME project state, and the older-then-newer difference is one status change',
  (select pg_temp._types('k:c12b') = array['first_detected', 'status_changed'])
  and (select zips @> array['90013', '90014'] and cardinality(zips) = 2 and facts->>'stage' = 'Approved'
              and observation_count = 2 and last_observed_at = pg_temp._t(5)
         from public.dev_change_project where identity_key = 'k:c12b'));

-- ---- C13  sibling records under one key -------------------------------------------------------------------------------------------
select pg_temp._set('90015', 'k:c13', 1, pg_temp._t(0));
select pg_temp._set('90015', 'k:c13', 2, pg_temp._t(0), p_name => 'Second filing');
select pg_temp._obs('90015', 'base');
select pg_temp._set('90015', 'k:c13', 1, pg_temp._t(10), p_stage => 'Approved');
select pg_temp._set('90015', 'k:c13', 2, pg_temp._t(10), p_name => 'Second filing', p_stage => 'Approved');
select pg_temp._obs('90015', 'r1');
delete from public.app_projects where zip = '90015' and source_seq = 2;
select pg_temp._set('90015', 'k:c13', 1, pg_temp._t(20), p_stage => 'Permit Issued');
select pg_temp._obs('90015', 'r2');
select pg_temp._ck('C13 sibling records are tracked but NEVER produce events, and stay non-comparable even after the sibling disappears (fail closed)',
  (select pg_temp._types('k:c13') = '{}'::text[])
  and (select not comparable and non_comparable_reason = 'sibling_records' and not change_ready and observation_count = 3
         from public.dev_change_project where identity_key = 'k:c13'));

-- ---- C14  non-durable key bases -------------------------------------------------------------------------------------------------------
select pg_temp._set('90016', 'arcgis:x:row77', 1, pg_temp._t(0), p_basis => 'source_id:row_id');
select pg_temp._set('90016', 'arcgis:x:Some Title', 1, pg_temp._t(0), p_basis => 'source_id:title(MUTABLE)');
select pg_temp._obs('90016', 'base');
select pg_temp._set('90016', 'arcgis:x:row77', 1, pg_temp._t(10), p_basis => 'source_id:row_id', p_stage => 'Approved');
select pg_temp._set('90016', 'arcgis:x:Some Title', 1, pg_temp._t(10), p_basis => 'source_id:title(MUTABLE)', p_stage => 'Approved');
select pg_temp._obs('90016', 'r1');
select pg_temp._ck('C14 records keyed on a row number or a title are tracked but non-comparable: no first_detected, no change events',
  (select count(*) = 0 from public.dev_change_event where identity_key in ('arcgis:x:row77', 'arcgis:x:Some Title'))
  and (select count(*) = 2 and bool_and(not comparable and non_comparable_reason = 'non_durable_key_basis' and not change_ready)
         from public.dev_change_project where identity_key in ('arcgis:x:row77', 'arcgis:x:Some Title')));

-- ---- C15  regulatory/facility rows are not development changes ------------------------------------------------------------------------------
select pg_temp._set('90017', 'epa_frs:110000000001', 1, pg_temp._t(0), p_kind => 'facility', p_basis => 'epa_frs:registry_id');
create temp table _o15 as select pg_temp._obs('90017', 'base') as j;
select pg_temp._ck('C15 facility (regulatory) rows never enter the change layer',
  (select (j->>'rows_read')::int = 0 from _o15)
  and (select count(*) = 0 from public.dev_change_project where identity_key like 'epa\_frs:%'));

-- ---- C16  retrieval-time and other non-fact noise ----------------------------------------------------------------------------------------------
select pg_temp._set('90018', 'k:c16', 1, pg_temp._t(0));
select pg_temp._obs('90018', 'base');
update public.app_projects
   set lat = 1.5, lng = 2.5, impact_score = 99, last_seen_at = now(), created_at = now(), scope_text = 'different text',
       provenance = jsonb_build_object('refreshed_at', pg_temp._iso(pg_temp._t(10)), 'source_vintage', 'another-vintage')
 where zip = '90018';
select pg_temp._obs('90018', 'r1');
select pg_temp._ck('C16 a re-collection that changes only retrieval fields, coordinates, score, last_seen_at, created_at or description is NOT a change',
  (select pg_temp._types('k:c16') = array['first_detected'])
  and (select observation_count = 2 and change_ready from public.dev_change_project where identity_key = 'k:c16'));

-- ---- C17  a change to the fact definition itself ----------------------------------------------------------------------------------------------------
select pg_temp._set('90019', 'k:c17', 1, pg_temp._t(0));
select pg_temp._obs('90019', 'base');
update public.dev_change_project set facts_version = 0 where identity_key = 'k:c17';
select pg_temp._set('90019', 'k:c17', 1, pg_temp._t(10), p_stage => 'Approved');
select pg_temp._obs('90019', 'r1');
select pg_temp._ck('C17 when the FACT DEFINITION changes (facts_version) the record is re-baselined silently: no event, state moves to the current version',
  (select pg_temp._types('k:c17') = array['first_detected'])
  and (select facts_version = 1 and facts->>'stage' = 'Approved' from public.dev_change_project where identity_key = 'k:c17'));

-- ---- C18  a future-stamped retrieval time ---------------------------------------------------------------------------------------------------------------
select pg_temp._set('90020', 'k:c18', 1, now() + interval '2 days');
create temp table _o18 as select pg_temp._obs('90020', 'r1') as j;
select pg_temp._ck('C18a an observation stamped in the future is skipped (it could lock the record out of every later observation)',
  (select (j->>'rows_skipped')::int = 1 and (j->>'identities_seen')::int = 0 from _o18)
  and (select count(*) = 0 from public.dev_change_project where identity_key = 'k:c18'));
select pg_temp._set('90020', 'k:c18', 1, pg_temp._t(0));
select pg_temp._obs('90020', 'r1');
select pg_temp._ck('C18b and a later valid observation of the same record is accepted normally',
  (select pg_temp._types('k:c18') = array['first_detected']));

-- ---- C19  append-only ----------------------------------------------------------------------------------------------------------------------------------------
do $$
declare n int := 0;
begin
  begin update public.dev_change_event set rights_class = 'x' where id = (select min(id) from public.dev_change_event);
  exception when raise_exception then n := n + 1; end;
  begin delete from public.dev_change_event where id = (select min(id) from public.dev_change_event);
  exception when raise_exception then n := n + 1; end;
  begin truncate public.dev_change_event;
  exception when raise_exception then n := n + 1; end;
  perform pg_temp._ck('C19 the event log is append-only: UPDATE, DELETE and TRUNCATE are all refused and the rows are still there',
                      n = 3 and (select count(*) from public.dev_change_event) > 10, 'refused ' || n || ' of 3');
end $$;

-- ---- C20  lock-down ----------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp._ck('C20a anon, authenticated and PUBLIC hold no privilege of any kind on the three tables',
  not exists (
    select 1
      from (values ('dev_change_run'), ('dev_change_project'), ('dev_change_event')) t(n),
           (values ('anon'), ('authenticated'), ('public')) r(role),
           (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) p(priv)
     where has_table_privilege(r.role, 'public.' || t.n, p.priv)));
select pg_temp._ck('C20b row level security is enabled on all three tables',
  (select count(*) = 3 and bool_and(relrowsecurity)
     from pg_class where relnamespace = 'public'::regnamespace
      and relname in ('dev_change_run', 'dev_change_project', 'dev_change_event')));
select pg_temp._ck('C20c no dev_change_ function is executable by anon, authenticated or PUBLIC, and service_role can run all of them',
  (select count(*) >= 10 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'dev\_change\_%')
  and not exists (
    select 1 from pg_proc p, (values ('anon'), ('authenticated'), ('public')) r(role)
     where p.pronamespace = 'public'::regnamespace and p.proname like 'dev\_change\_%'
       and has_function_privilege(r.role, p.oid, 'execute'))
  and not exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname like 'dev\_change\_%'
       and not has_function_privilege('service_role', p.oid, 'execute')));
select pg_temp._ck('C20d service_role can read and write the ledger but can never UPDATE, DELETE or TRUNCATE an event',
  has_table_privilege('service_role', 'public.dev_change_event', 'select')
  and has_table_privilege('service_role', 'public.dev_change_event', 'insert')
  and not has_table_privilege('service_role', 'public.dev_change_event', 'update')
  and not has_table_privilege('service_role', 'public.dev_change_event', 'delete')
  and not has_table_privilege('service_role', 'public.dev_change_event', 'truncate')
  and has_table_privilege('service_role', 'public.dev_change_project', 'update'));
select pg_temp._ck('C20e the event sequence is not usable by anon or authenticated',
  not has_sequence_privilege('anon', 'public.dev_change_event_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'public.dev_change_event_id_seq', 'usage'));

-- ---- C21  event shape and uniqueness ------------------------------------------------------------------------------------------------------------------------------
do $$
declare n int := 0;
begin
  begin -- a first_detected that claims a prior value
    insert into public.dev_change_event (identity_key, event_type, material, observed_at, prev_facts, new_facts, prev_fp, new_fp, derivation_version, facts_version)
    values ('k:c01', 'first_detected', true, now(), '{"a":1}'::jsonb, '{"a":2}'::jsonb, 'x', 'y', 1, 1);
  exception when check_violation then n := n + 1; end;
  begin -- a "change" whose before and after fingerprints are equal
    insert into public.dev_change_event (identity_key, event_type, material, observed_at, prev_facts, new_facts, prev_fp, new_fp, changed_fields, derivation_version, facts_version)
    values ('k:c01', 'status_changed', true, now(), '{"a":1}'::jsonb, '{"a":1}'::jsonb, 'same', 'same', array['stage'], 1, 1);
  exception when check_violation then n := n + 1; end;
  begin -- a second event for the same observation instant
    insert into public.dev_change_event (identity_key, event_type, material, observed_at, prev_facts, new_facts, prev_fp, new_fp, changed_fields, derivation_version, facts_version)
    select identity_key, 'source_record_updated', false, observed_at, '{"a":1}'::jsonb, '{"a":2}'::jsonb, 'p', 'q', array['name'], 1, 1
      from public.dev_change_event where identity_key = 'k:c01' limit 1;
  exception when unique_violation then n := n + 1; end;
  perform pg_temp._ck('C21 the event table refuses a first_detected with a prior value, a change with equal fingerprints, and a second event for one observation',
                      n = 3, 'refused ' || n || ' of 3');
end $$;

-- ---- C22  change readiness is per record -----------------------------------------------------------------------------------------------------------------------------
select pg_temp._ck('C22 change_ready is exactly (comparable AND >= 2 observations) on every record, and no non-comparable record is ever ready',
  (select count(*) > 10 and bool_and(change_ready = (comparable and observation_count >= 2))
     from public.dev_change_project)
  and (select count(*) >= 3 and bool_and(not change_ready) from public.dev_change_project where not comparable));

-- ---- C23  run counters ------------------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp._set('90021', 'k:c23a', 1, pg_temp._t(0));
select pg_temp._set('90021', 'k:c23b', 1, pg_temp._t(0));
insert into public.app_projects (zip, record_kind, source_key, source_key_basis, source_seq, provenance)
values ('90021', 'development', 'k:c23c', 'source_id:case_number', 1, '{"source_vintage":"no retrieval time"}'::jsonb);
create temp table _o23 as select pg_temp._obs('90021', 'r3') as j;
select pg_temp._ck('C23 a row with no retrieval time is not an observation and is counted as skipped; the run row carries exact totals',
  (select (j->>'rows_read')::int = 3 and (j->>'rows_skipped')::int = 1 and (j->>'identities_seen')::int = 2
          and (j->>'identities_new')::int = 2 and (j->>'events_written')::int = 2 from _o23)
  and (select zips_observed = 1 and rows_read = 3 and rows_skipped = 1 and identities_new = 2
              and observations_accepted = 2 and events_written = 2
         from public.dev_change_run where id = (select run from _ctx where name = 'r3')));

-- ---- C24  bad input and closed runs ----------------------------------------------------------------------------------------------------------------------------------------------
select public.dev_change_finish_run((select run from _ctx where name = 'r3'));
do $$
declare n int := 0;
begin
  begin perform pg_temp._obs('90021', 'r3');
  exception when raise_exception then n := n + 1; end;
  begin perform public.dev_change_observe_zip('9002', (select run from _ctx where name = 'r1'));
  exception when raise_exception then n := n + 1; end;
  begin perform public.dev_change_observe_zip('90021', gen_random_uuid());
  exception when raise_exception then n := n + 1; end;
  perform pg_temp._ck('C24 a closed run, a run that does not exist and a malformed ZIP are all refused', n = 3, 'refused ' || n || ' of 3');
end $$;

-- ---- C25  the ledger holds no lifecycle key and no source/city literal -------------------------------------------------------------------------------------------
select pg_temp._ck('C25 stored facts carry only the declared fact keys (no lifecycle key, no retrieval field, no coordinates)',
  (select bool_and(facts ?& array['name','type','type_raw','status','stage','date_kind','submitted_at','address','start_date','end_date','developer','size','investment','source_ref']
                   and (select count(*) = 14 from jsonb_object_keys(facts)))
     from public.dev_change_project));

\o
select check_name, pass, detail from _r order by n;

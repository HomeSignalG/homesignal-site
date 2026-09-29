-- =====================================================================================
-- DEVELOPMENT CHANGE LEDGER, REPORTABLE EVENTS — EXECUTABLE ADVERSARIAL SUITE  (docs/dev-change-reportable.sql)
--
-- Decision 10 option (a) of the Development Activity plan: the ONE definition of which ledger events
-- may be shown to a reader as changes. The events are written by the SHIPPED writer
-- (dev_change_observe_zip, Order C) from app_projects rows, so every scenario below is the real
-- shape, not a hand-built one. Every expected answer is a HARD-CODED constant, never computed by the
-- code under test. Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
--
-- The scenario that matters most is R05: a record that sits on two ZIP pages, materialised at different
-- times, met inside ONE baseline run. The writer types that as a change (status_changed,
-- is_baseline = false) although nobody saw one. That is what the national baseline did 959 times.
--
-- Times are relative to a fixed base 30 days ago, so no fixture can be "in the future".
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

-- ONE app_projects row, the way the materialiser would write it
create function pg_temp._set(
  p_zip text, p_key text, p_seq int, p_obs timestamptz,
  p_stage text default 'Submitted', p_status text default 'Proposed', p_date_kind text default 'filed'
) returns void language plpgsql as $$
begin
  delete from public.app_projects where zip = p_zip and source_key = p_key and source_seq = p_seq;
  insert into public.app_projects
    (zip, record_kind, source_key, source_key_basis, source_seq, registry_id, name, type, type_raw,
     status, stage, date_kind, submitted_at, address, provenance)
  values (p_zip, 'development', p_key, 'source_id:case_number', p_seq, 'fixture-registry', 'Alpha Plaza',
          'Commercial', 'Retail', p_status, p_stage, p_date_kind, '2026-08-01', '1 Main St',
          jsonb_build_object('refreshed_at', pg_temp._iso(p_obs), 'source_vintage', 'fixture'));
end $$;

-- observe one ZIP in a named run (the shipped writer)
create function pg_temp._obs(p_zip text, p_run text) returns jsonb language sql as
$$ select public.dev_change_observe_zip(p_zip, (select run from _ctx where name = p_run)) $$;

-- every event the LEDGER holds for a key, in write order / the ones the VIEW lets through
create function pg_temp._ledger(p_key text) returns text[] language sql as
$$ select coalesce(array_agg(event_type order by id), '{}') from public.dev_change_event where identity_key = p_key $$;
create function pg_temp._rep(p_key text) returns text[] language sql as
$$ select coalesce(array_agg(event_type order by id), '{}') from public.dev_change_event_reportable where identity_key = p_key $$;

-- Read the view AS a role (invoker rights). Returns the row count, or the SQLSTATE if it was refused.
create function pg_temp._read_as(p_role text) returns text language plpgsql as $$
declare n bigint;
begin
  execute format('set role %I', p_role);
  begin
    select count(*) into n from public.dev_change_event_reportable;
    execute 'reset role';
    return n::text;
  exception when others then
    execute 'reset role';
    return sqlstate;
  end;
end $$;

-- Supabase's service_role has BYPASSRLS; the ledger tables have RLS on with no policy, so a stand-in that
-- lacks it would read zero rows for the wrong reason. Set here, undone at the end.
alter role service_role bypassrls;
-- Supabase grants USAGE on schema public to all three API roles. A freshly created schema here does not,
-- and without this every read would be refused at the SCHEMA — so a refusal of anon could pass for the
-- wrong reason. With it, a refusal can only come from the view's own privileges.
grant usage on schema public to anon, authenticated, service_role;

insert into _ctx select 'b',  public.dev_change_start_run(true,  '{"suite":"dev_change_reportable_pg"}');
insert into _ctx select 'o1', public.dev_change_start_run(false, '{"suite":"dev_change_reportable_pg"}');

-- ---- R01  the baseline's first sightings are observations, never news --------------------------
select pg_temp._set('92001', 'k:r01a', 1, pg_temp._t(11));
select pg_temp._set('92001', 'k:r01b', 1, pg_temp._t(11));
select pg_temp._obs('92001', 'b');
select pg_temp._ck('R01 the baseline run wrote a first_detected event for each of the two records, both flagged is_baseline, and NONE is reportable',
  (select count(*) = 2 and bool_and(is_baseline) and bool_and(event_type = 'first_detected')
     from public.dev_change_event where identity_key in ('k:r01a', 'k:r01b'))
  and (select count(*) = 0 from public.dev_change_event_reportable where identity_key in ('k:r01a', 'k:r01b')),
  (select count(*)::text from public.dev_change_event where identity_key in ('k:r01a', 'k:r01b')));

-- ---- R02  a genuinely new record met by an ordinary run IS news ---------------------------------
select pg_temp._set('92001', 'k:r02', 1, pg_temp._t(20));
-- ---- R03  a change in the publisher's own status IS news; the baseline sighting under it is not --
select pg_temp._set('92001', 'k:r01a', 1, pg_temp._t(21), 'Approved');
-- ---- R04  a derived-field-only change is carried, and stays non-material --------------------------
select pg_temp._set('92001', 'k:r01b', 1, pg_temp._t(22), 'Submitted', 'Approved');
select pg_temp._obs('92001', 'o1');
select pg_temp._ck('R02 the new record is reportable exactly once: first_detected, material, not a baseline event, written by the ordinary run',
  (select count(*) = 1 and bool_and(event_type = 'first_detected') and bool_and(material) and bool_and(not is_baseline)
          and bool_and(run_id = (select run from _ctx where name = 'o1'))
     from public.dev_change_event_reportable where identity_key = 'k:r02'),
  array_to_string(pg_temp._rep('k:r02'), ','));
select pg_temp._ck('R03 the publisher-status change is reportable and material; the baseline first_detected under it is in the ledger but is not reportable',
  pg_temp._ledger('k:r01a') = array['first_detected', 'status_changed']
  and pg_temp._rep('k:r01a') = array['status_changed']
  and (select bool_and(material) and bool_and(changed_fields = array['stage']) from public.dev_change_event_reportable where identity_key = 'k:r01a'),
  array_to_string(pg_temp._ledger('k:r01a'), ',') || ' / ' || array_to_string(pg_temp._rep('k:r01a'), ','));
select pg_temp._ck('R04 the derived-field-only change is reportable but carries material = false (the reader decides hero eligibility, this view never widens it)',
  pg_temp._ledger('k:r01b') = array['first_detected', 'source_record_updated']
  and pg_temp._rep('k:r01b') = array['source_record_updated']
  and (select not bool_or(material) from public.dev_change_event_reportable where identity_key = 'k:r01b'),
  array_to_string(pg_temp._rep('k:r01b'), ','));

-- ---- R05  THE 959: two copies of one record, different ZIPs, different materialisation times, ONE baseline run
select pg_temp._set('92002', 'k:r05', 1, pg_temp._t(11), 'Submitted');
select pg_temp._set('92003', 'k:r05', 1, pg_temp._t(12), 'Approved');
select pg_temp._obs('92002', 'b');
select pg_temp._obs('92003', 'b');
select pg_temp._ck('R05a control: the writer DID type the cross-copy difference as a change inside the baseline run (status_changed, material, is_baseline = false) — so is_baseline cannot be the rule',
  pg_temp._ledger('k:r05') = array['first_detected', 'status_changed']
  and (select count(*) = 1 from public.dev_change_event e join public.dev_change_run r on r.id = e.run_id
        where e.identity_key = 'k:r05' and e.event_type = 'status_changed' and e.material and not e.is_baseline and r.baseline),
  array_to_string(pg_temp._ledger('k:r05'), ','));
select pg_temp._ck('R05 neither event of the cross-copy record is reportable: a difference between ZIP copies met in a baseline run is not a change',
  pg_temp._rep('k:r05') = '{}' and (select count(*) = 0 from public.dev_change_event_reportable where identity_key = 'k:r05'),
  array_to_string(pg_temp._rep('k:r05'), ','));

-- ---- R06  an event that names no run cannot be classified, so it is not shown ----------------------
insert into public.dev_change_project
  (identity_key, key_basis, comparable, facts_version, facts, facts_fp, first_observed_at, last_observed_at, observation_count)
values ('k:r06', 'source_id:case_number', true, 1, '{}'::jsonb, 'fp-r06', pg_temp._t(15), pg_temp._t(15), 1);
insert into public.dev_change_event
  (identity_key, event_type, material, is_baseline, observed_at, new_facts, new_fp, derivation_version, facts_version)
values ('k:r06', 'first_detected', true, false, pg_temp._t(15), '{}'::jsonb, 'fp-r06', 1, 1);
select pg_temp._ck('R06 a run-less event exists in the ledger (control) and is NOT reportable',
  (select count(*) = 1 and bool_and(run_id is null) from public.dev_change_event where identity_key = 'k:r06')
  and pg_temp._rep('k:r06') = '{}',
  array_to_string(pg_temp._rep('k:r06'), ','));

-- ---- R07  the run is the EVENT'S OWN, never the record's first or last run ------------------------
-- k:r07 is first seen by an ORDINARY run, then met again on another ZIP by the baseline run.
select pg_temp._set('92004', 'k:r07', 1, pg_temp._t(13), 'Submitted');
select pg_temp._obs('92004', 'o1');
select pg_temp._set('92005', 'k:r07', 1, pg_temp._t(14), 'Approved');
select pg_temp._obs('92005', 'b');
select pg_temp._ck('R07a control: the record first_run is the ordinary run and its last_run is the baseline run, so judging by either would be wrong',
  (select p.first_run_id = (select run from _ctx where name = 'o1') and p.last_run_id = (select run from _ctx where name = 'b')
     from public.dev_change_project p where p.identity_key = 'k:r07')
  and pg_temp._ledger('k:r07') = array['first_detected', 'status_changed'],
  array_to_string(pg_temp._ledger('k:r07'), ','));
select pg_temp._ck('R07 only the ordinary run''s first_detected is reportable; the baseline run''s status_changed on the same record is not; and k:r01a keeps its ordinary-run change although its FIRST run was the baseline',
  pg_temp._rep('k:r07') = array['first_detected']
  and (select p.first_run_id = (select run from _ctx where name = 'b') from public.dev_change_project p where p.identity_key = 'k:r01a')
  and pg_temp._rep('k:r01a') = array['status_changed'],
  array_to_string(pg_temp._rep('k:r07'), ','));

-- ---- R08  the totals, hard-coded ---------------------------------------------------------------------
select pg_temp._ck('R08 the ledger holds exactly 10 events and the view lets exactly 4 through',
  (select count(*) = 10 from public.dev_change_event) and (select count(*) = 4 from public.dev_change_event_reportable),
  (select count(*)::text from public.dev_change_event) || ' / ' || (select count(*)::text from public.dev_change_event_reportable));
select pg_temp._ck('R08b the four reportable events are exactly: k:r01a status_changed, k:r01b source_record_updated, k:r02 first_detected, k:r07 first_detected',
  (select string_agg(identity_key || ':' || event_type, ',' order by identity_key collate "C", event_type collate "C")
     from public.dev_change_event_reportable)
  = 'k:r01a:status_changed,k:r01b:source_record_updated,k:r02:first_detected,k:r07:first_detected',
  (select string_agg(identity_key || ':' || event_type, ',' order by identity_key collate "C", event_type collate "C")
     from public.dev_change_event_reportable));
select pg_temp._ck('R08c every reportable event belongs to a run that is NOT a baseline run',
  (select count(*) = 4 and bool_and(not r.baseline)
     from public.dev_change_event_reportable v join public.dev_change_run r on r.id = v.run_id),
  null);

-- ---- R09  the view adds no fact of its own: it is exactly the event's own columns -------------------
select pg_temp._ck('R09 the view has exactly the event''s 19 columns, in order, and no run or project column',
  (select array_agg(attname::text order by attnum) from pg_attribute
    where attrelid = 'public.dev_change_event_reportable'::regclass and attnum > 0 and not attisdropped)
  = array['id', 'identity_key', 'event_type', 'material', 'is_baseline', 'observed_at', 'prev_facts', 'new_facts',
          'prev_fp', 'new_fp', 'changed_fields', 'publisher_event_type', 'publisher_event_date', 'source_id',
          'derivation_version', 'facts_version', 'rights_class', 'run_id', 'created_at'],
  (select string_agg(attname::text, ',' order by attnum) from pg_attribute
    where attrelid = 'public.dev_change_event_reportable'::regclass and attnum > 0 and not attisdropped));

-- ---- R10  the view is not a way to change the ledger -----------------------------------------------------
do $$
begin
  begin
    update public.dev_change_event_reportable set material = false;
    insert into _r (check_name, pass, detail) values ('R10 an update through the view is refused', false, 'the update succeeded');
  exception when others then
    insert into _r (check_name, pass, detail) values ('R10 an update through the view is refused', true, sqlstate);
  end;
  begin
    delete from public.dev_change_event_reportable;
    insert into _r (check_name, pass, detail) values ('R10b a delete through the view is refused', false, 'the delete succeeded');
  exception when others then
    insert into _r (check_name, pass, detail) values ('R10b a delete through the view is refused', true, sqlstate);
  end;
end $$;
select pg_temp._ck('R10c the ledger is unchanged after those attempts (still 10 events, and 3 of the 4 reportable ones are material)',
  (select count(*) = 10 from public.dev_change_event)
  and (select count(*) filter (where material) = 3 from public.dev_change_event_reportable),
  null);

-- ---- R11  lock-down: system-only ----------------------------------------------------------------------------
select pg_temp._ck('R11 anon and authenticated hold no privilege on the view; PUBLIC neither',
  not has_table_privilege('anon', 'public.dev_change_event_reportable', 'select')
  and not has_table_privilege('authenticated', 'public.dev_change_event_reportable', 'select')
  and not exists (select 1 from pg_class c, aclexplode(c.relacl) a
                   where c.oid = 'public.dev_change_event_reportable'::regclass and a.grantee = 0),
  null);
select pg_temp._ck('R11b service_role may only SELECT: no insert, update, delete or truncate',
  has_table_privilege('service_role', 'public.dev_change_event_reportable', 'select')
  and not has_table_privilege('service_role', 'public.dev_change_event_reportable', 'insert')
  and not has_table_privilege('service_role', 'public.dev_change_event_reportable', 'update')
  and not has_table_privilege('service_role', 'public.dev_change_event_reportable', 'delete')
  and not has_table_privilege('service_role', 'public.dev_change_event_reportable', 'truncate'),
  null);
select pg_temp._ck('R11c control: all three API roles hold USAGE on the schema, so the refusals below come from the view and not from the schema',
  has_schema_privilege('anon', 'public', 'usage') and has_schema_privilege('authenticated', 'public', 'usage')
  and has_schema_privilege('service_role', 'public', 'usage'),
  null);
select pg_temp._ck('R11c reading AS anon is refused (42501); AS authenticated is refused (42501)',
  pg_temp._read_as('anon') = '42501' and pg_temp._read_as('authenticated') = '42501',
  pg_temp._read_as('anon') || ' / ' || pg_temp._read_as('authenticated'));
select pg_temp._ck('R11d reading AS service_role works and sees exactly the 4 reportable events (the consumer is not locked out)',
  pg_temp._read_as('service_role') = '4',
  pg_temp._read_as('service_role'));
select pg_temp._ck('R11e the view runs with the CALLER''s rights (security_invoker), so it can never widen what a role may read',
  (select 'security_invoker=true' = any (c.reloptions) from pg_class c where c.oid = 'public.dev_change_event_reportable'::regclass),
  null);

alter role service_role nobypassrls;
revoke usage on schema public from anon, authenticated, service_role;

\o
select check_name, pass, detail from _r order by n;

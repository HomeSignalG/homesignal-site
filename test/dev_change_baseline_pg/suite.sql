-- =====================================================================================
-- DEVELOPMENT CHANGE BASELINE — EXECUTABLE ADVERSARIAL SUITE  (docs/dev-change-baseline.sql)
--
-- Order D of the Development Activity plan: the driver that walks the canonical ZIPs into the
-- change ledger, its per-ZIP cursor, its capacity gate, and the per-source evidence view.
-- Every expected answer below is a HARD-CODED constant, never computed by the code under test.
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
--
-- Each scenario owns its ZIPs and keys. Times are relative to a fixed base 30 days ago, so no
-- fixture can be "in the future". The cursor's own clock is real time, so a scenario that needs
-- an old observation BACKDATES the cursor row directly (superuser), never sleeps.
-- =====================================================================================
\set ON_ERROR_STOP on
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);
create temp table _base as select date_trunc('hour', now()) - interval '30 days' as t;
create temp table _ctx (name text primary key, run uuid);
create temp table _res (name text primary key, j jsonb);
create temp table _fp (name text primary key, v text);

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

-- a ZIP that exists in the canonical registry and has been materialised at p_meta
create function pg_temp._zip(p_zip text, p_meta timestamptz default null) returns void language sql as
$$ insert into public.canonical_zip_registry (zip) values (p_zip) on conflict do nothing;
   insert into public.app_community_meta (zip, updated_at) values (p_zip, coalesce(p_meta, pg_temp._t(10)))
   on conflict (zip) do update set updated_at = excluded.updated_at $$;

create function pg_temp._tick(
  p_run text, p_max int default 50, p_secs int default 30,
  p_budget bigint default 100000, p_free bigint default 1000000, p_interval int default 24
) returns jsonb language sql as
$$ select public.dev_change_tick((select run from _ctx where name = p_run), p_max, p_secs, p_budget, p_free, p_interval) $$;

create function pg_temp._types(p_key text) returns text[] language sql as
$$ select coalesce(array_agg(event_type order by id), '{}') from public.dev_change_event where identity_key = p_key $$;

-- the tables the driver READS must never be written by it
create function pg_temp._source_fp() returns text language sql as $$
  select md5(coalesce((select string_agg(zip || ':' || coalesce(source_key, '') || ':' || coalesce(stage, ''), ',' order by zip, source_key, source_seq) from public.app_projects), '')
          || '|' || coalesce((select string_agg(zip, ',' order by zip) from public.canonical_zip_registry), '')
          || '|' || coalesce((select string_agg(zip || updated_at::text, ',' order by zip) from public.app_community_meta), '')
          || '|' || (select count(*)::text from public.dev_refresh_source_failures)) $$;

insert into _ctx select 'b',  public.dev_change_start_run(true,  '{"suite":"dev_change_baseline_pg"}');
insert into _ctx select 'o1', public.dev_change_start_run(false, '{"suite":"dev_change_baseline_pg"}');

-- ---- D01  a baseline tick walks the never-observed ZIPs --------------------------------------
select pg_temp._zip('91001'); select pg_temp._zip('91002'); select pg_temp._zip('91003');
select pg_temp._set('91001', 'k:d01a', 1, pg_temp._t(11));
select pg_temp._set('91001', 'k:d01b', 1, pg_temp._t(11));
select pg_temp._set('91002', 'k:d02a', 1, pg_temp._t(11));
insert into _fp select 'before_d01', pg_temp._source_fp();
insert into _res select 'd01', pg_temp._tick('b');
insert into _fp select 'after_d01', pg_temp._source_fp();
select pg_temp._ck('D01 a baseline tick observes exactly the three never-observed ZIPs and reports the baseline complete',
  (select j->>'zips_observed' = '3' and j->>'zip_errors' = '0' and j->>'rows_read' = '3'
      and j->>'events_written' = '3' and j->>'stopped_reason' = 'none_due' and j->>'status' = 'ok'
      and j->>'zips_never_observed' = '0' and (j->>'baseline_complete')::boolean and (j->>'baseline')::boolean
     from _res where name = 'd01'),
  (select j::text from _res where name = 'd01'));
select pg_temp._ck('D01b the cursor records each ZIP as observed (ok, first success set, the materialisation it saw, rows and identities read)',
  (select count(*) = 3
      and bool_and(status = 'ok' and first_ok_at is not null and materialized_at = pg_temp._t(10) and error is null)
      and max(rows_read) filter (where zip = '91001') = 2 and max(identities_seen) filter (where zip = '91001') = 2
      and max(rows_read) filter (where zip = '91002') = 1
      and max(rows_read) filter (where zip = '91003') = 0
     from public.dev_change_zip_cursor where zip in ('91001', '91002', '91003')));
select pg_temp._ck('D01c every first sighting in a baseline run is a first_detected flagged baseline and NOT material',
  (select count(*) = 3 and bool_and(event_type = 'first_detected' and is_baseline and not material)
     from public.dev_change_event where identity_key in ('k:d01a', 'k:d01b', 'k:d02a')));
select pg_temp._ck('D01d the driver writes nothing outside the ledger: the registry, the meta, the projects and the failure record are byte-identical',
  (select a.v = b.v from _fp a, _fp b where a.name = 'before_d01' and b.name = 'after_d01'));

-- ---- D02  the same tick again does nothing -----------------------------------------------------
insert into _res select 'd02', pg_temp._tick('b');
select pg_temp._ck('D02 an immediate second tick observes nothing and writes no event (idempotent)',
  (select j->>'zips_observed' = '0' and j->>'events_written' = '0' and j->>'stopped_reason' = 'none_due' from _res where name = 'd02')
  and (select count(*) = 3 from public.dev_change_event where identity_key in ('k:d01a', 'k:d01b', 'k:d02a')),
  (select j::text from _res where name = 'd02'));

-- ---- D03  re-observation needs a NEW materialisation AND an old enough last observation ---------
insert into _fp select 'first_ok_91001', first_ok_at::text from public.dev_change_zip_cursor where zip = '91001';
update public.app_community_meta set updated_at = pg_temp._t(20) where zip = '91001';
select pg_temp._set('91001', 'k:d01a', 1, pg_temp._t(21), 'Approved', 'Approved', 'approved');
insert into _res select 'd03a', pg_temp._tick('o1');
select pg_temp._ck('D03a a re-materialised ZIP whose last observation is recent is NOT due (the interval bounds the write volume)',
  (select j->>'zips_observed' = '0' from _res where name = 'd03a')
  and pg_temp._types('k:d01a') = array['first_detected'], (select j::text from _res where name = 'd03a'));

update public.dev_change_zip_cursor set observed_at = now() - interval '48 hours' where zip = '91001';
insert into _res select 'd03b', pg_temp._tick('o1');
select pg_temp._ck('D03b once the last observation is old enough the re-materialised ZIP is observed in an ORDINARY run and its publisher status change is one material event',
  (select j->>'zips_observed' = '1' and j->>'events_written' = '1' and not (j->>'baseline')::boolean from _res where name = 'd03b')
  and pg_temp._types('k:d01a') = array['first_detected', 'status_changed']
  and (select material and not is_baseline and changed_fields @> array['stage', 'date_kind'] and prev_facts->>'stage' = 'Submitted' and new_facts->>'stage' = 'Approved'
         from public.dev_change_event where identity_key = 'k:d01a' and event_type = 'status_changed')
  and pg_temp._types('k:d01b') = array['first_detected'],
  (select j::text from _res where name = 'd03b'));
select pg_temp._ck('D03c the cursor now holds the newer materialisation, the ORIGINAL first-success instant, and a fresh observation time',
  (select materialized_at = pg_temp._t(20) and status = 'ok' and observed_at > now() - interval '1 hour'
      and first_ok_at::text = (select v from _fp where name = 'first_ok_91001')
     from public.dev_change_zip_cursor where zip = '91001'));

update public.dev_change_zip_cursor set observed_at = now() - interval '48 hours' where zip = '91001';
insert into _res select 'd03d', pg_temp._tick('o1');
select pg_temp._ck('D03d an old cursor with NO new materialisation is not due (unchanged ZIPs are never re-read)',
  (select j->>'zips_observed' = '0' from _res where name = 'd03d'), (select j::text from _res where name = 'd03d'));

-- ---- D04  a ZIP is FIRST observed only inside a baseline run -------------------------------------
select pg_temp._zip('91004');
select pg_temp._set('91004', 'k:d04', 1, pg_temp._t(11));
insert into _res select 'd04a', pg_temp._tick('o1');
select pg_temp._ck('D04a an ORDINARY run refuses a ZIP the ledger has never observed (its whole content would be written as material news)',
  (select j->>'zips_observed' = '0' and j->>'zips_never_observed' = '1' and not (j->>'baseline_complete')::boolean from _res where name = 'd04a')
  and not exists (select 1 from public.dev_change_project where identity_key = 'k:d04')
  and not exists (select 1 from public.dev_change_zip_cursor where zip = '91004'), (select j::text from _res where name = 'd04a'));
insert into _res select 'd04b', pg_temp._tick('b');
select pg_temp._ck('D04b the BASELINE run then observes it, flagged baseline, and the baseline is complete again',
  (select j->>'zips_observed' = '1' and (j->>'baseline_complete')::boolean from _res where name = 'd04b')
  and (select is_baseline and not material from public.dev_change_event where identity_key = 'k:d04' and event_type = 'first_detected'));

-- ---- D05  one bad ZIP never blocks the walk -------------------------------------------------------
create function public._test_poison() returns trigger language plpgsql as
$$ begin if new.identity_key = 'k:d05-poison' then raise exception 'poison identity'; end if; return new; end $$;
create trigger _test_poison before insert on public.dev_change_project for each row execute function public._test_poison();
select pg_temp._zip('91005'); select pg_temp._zip('91006');
select pg_temp._set('91005', 'k:d05-poison', 1, pg_temp._t(11));
select pg_temp._set('91006', 'k:d06', 1, pg_temp._t(11));
insert into _res select 'd05a', pg_temp._tick('b');
select pg_temp._ck('D05a a ZIP that raises is recorded and the walk goes on: the good ZIP is observed, the bad one is not retried in the same tick',
  (select j->>'zips_observed' = '1' and j->>'zip_errors' = '1' and j->>'events_written' = '1'
      and j->>'zips_never_observed' = '1' and not (j->>'baseline_complete')::boolean from _res where name = 'd05a'),
  (select j::text from _res where name = 'd05a'));
select pg_temp._ck('D05b the bad ZIP is in the cursor as an error with the reason, no first success, and left NOTHING in the ledger',
  (select status = 'error' and error like '%poison identity%' and first_ok_at is null and materialized_at is null
     from public.dev_change_zip_cursor where zip = '91005')
  and not exists (select 1 from public.dev_change_project where identity_key = 'k:d05-poison')
  and not exists (select 1 from public.dev_change_event where identity_key = 'k:d05-poison'));
insert into _res select 'd05c', pg_temp._tick('b');
select pg_temp._ck('D05c a failed ZIP is retried on the next tick (once), never skipped forever and never looped inside one tick',
  (select j->>'zip_errors' = '1' and j->>'zips_observed' = '0' from _res where name = 'd05c'), (select j::text from _res where name = 'd05c'));
drop trigger _test_poison on public.dev_change_project;
insert into _res select 'd05d', pg_temp._tick('b');
select pg_temp._ck('D05d once the cause is gone the ZIP is observed, the error is cleared and the baseline is complete',
  (select j->>'zips_observed' = '1' and (j->>'baseline_complete')::boolean from _res where name = 'd05d')
  and (select status = 'ok' and error is null and first_ok_at is not null from public.dev_change_zip_cursor where zip = '91005')
  and exists (select 1 from public.dev_change_project where identity_key = 'k:d05-poison'));

-- ---- D06  the ZIP count bounds a tick ----------------------------------------------------------------------
select pg_temp._zip(z) from unnest(array['91011', '91012', '91013', '91014', '91015']) z;
select pg_temp._set(z, 'k:d06-' || z, 1, pg_temp._t(11)) from unnest(array['91011', '91012', '91013', '91014', '91015']) z;
insert into _res select 'd06a', pg_temp._tick('b', 2);
select pg_temp._ck('D06a p_max_zips bounds a tick, and ZIPs go in order: the first two of five are observed',
  (select j->>'zips_observed' = '2' and j->>'stopped_reason' = 'max_zips' and j->>'zips_never_observed' = '3' from _res where name = 'd06a')
  and (select array_agg(zip order by zip) = array['91011', '91012'] from public.dev_change_zip_cursor where zip between '91011' and '91015'),
  (select j::text from _res where name = 'd06a'));
insert into _res select 'd06b', pg_temp._tick('b', 2);
insert into _res select 'd06c', pg_temp._tick('b', 2);
select pg_temp._ck('D06b the next ticks resume where the cursor left off and finish the set',
  (select j->>'zips_observed' = '2' from _res where name = 'd06b')
  and (select j->>'zips_observed' = '1' and j->>'stopped_reason' = 'none_due' and (j->>'baseline_complete')::boolean from _res where name = 'd06c'));

-- ---- D07  the clock bounds a tick, and a tick always makes progress ------------------------------------
create function public._test_slow() returns trigger language plpgsql as
$$ begin perform pg_sleep(1.1); return new; end $$;
create trigger _test_slow before insert on public.dev_change_project
  for each row when (new.identity_key like 'k:d07-%') execute function public._test_slow();
select pg_temp._zip(z) from unnest(array['91021', '91022', '91023']) z;
select pg_temp._set(z, 'k:d07-' || z, 1, pg_temp._t(11)) from unnest(array['91021', '91022', '91023']) z;
insert into _res select 'd07a', pg_temp._tick('b', 50, 1);
select pg_temp._ck('D07a p_max_seconds bounds a tick (one slow ZIP uses the whole budget) yet the tick still observes that ZIP',
  (select j->>'zips_observed' = '1' and j->>'stopped_reason' = 'time' and j->>'zips_never_observed' = '2' from _res where name = 'd07a'),
  (select j::text from _res where name = 'd07a'));
drop trigger _test_slow on public.dev_change_project;
insert into _res select 'd07b', pg_temp._tick('b', 50, 1);
select pg_temp._ck('D07b with the delay gone the rest is observed in one tick',
  (select j->>'zips_observed' = '2' and j->>'stopped_reason' = 'none_due' from _res where name = 'd07b'));

-- ---- D08  the ledger byte budget stops a tick (a stop, not an error) -----------------------------------------
select pg_temp._zip('91031');
select pg_temp._set('91031', 'k:d08', 1, pg_temp._t(11));
insert into public.dev_change_project
  (identity_key, registry_id, key_basis, comparable, non_comparable_reason, facts_version, facts, facts_fp,
   first_observed_at, last_observed_at, observation_count, zips)
select 'pad:' || g, 'pad-registry', 'pad', false, 'padding', 1, jsonb_build_object('pad', repeat('x', 600)), md5(g::text),
       now(), now(), 1, '{}'
  from generate_series(1, 4000) g;
insert into _res select 'd08', pg_temp._tick('b', 50, 30, 1);
select pg_temp._ck('D08 when the ledger tables reach the budget the tick STOPS without observing (status stopped, reason ledger_budget) and writes nothing',
  (select j->>'status' = 'stopped' and j->>'stopped_reason' = 'ledger_budget' and j->>'zips_observed' = '0' from _res where name = 'd08')
  and not exists (select 1 from public.dev_change_zip_cursor where zip = '91031')
  and not exists (select 1 from public.dev_change_project where identity_key = 'k:d08'), (select j::text from _res where name = 'd08'));
delete from public.dev_change_project where identity_key like 'pad:%';
insert into _res select 'd08b', pg_temp._tick('b');
select pg_temp._ck('D08b with an adequate budget the same ZIP is observed',
  (select j->>'zips_observed' = '1' and j->>'stopped_reason' = 'none_due' from _res where name = 'd08b'));

-- ---- D09  capacity gate and argument gates (all fail closed, nothing written) --------------------------------
select pg_temp._zip('91041');
select pg_temp._set('91041', 'k:d09', 1, pg_temp._t(11));
insert into _ctx select 'closed', public.dev_change_start_run(false);
select public.dev_change_finish_run((select run from _ctx where name = 'closed'));
do $$
declare
  n int := 0; ok_calls int := 0;
  b uuid := (select run from _ctx where name = 'b');
  o uuid := (select run from _ctx where name = 'o1');
  c uuid := (select run from _ctx where name = 'closed');
  msg text;
  -- (run, max_zips, max_seconds, budget, free_disk, interval) — every row below MUST be refused
  cases text[] := array[
    'b|50|30|100|(null)|24',      -- a baseline run with no verified free-disk figure
    'b|50|30|100|2147|24',        -- one MB under floor (2,048) + budget (100)
    'o|50|30|100|10|24',          -- an ordinary run that states a figure states an insufficient one
    'b|50|30|(null)|9999|24',     -- no ledger budget
    'b|50|30|0|9999|24',          -- a zero ledger budget
    'b|0|30|100|9999|24',         -- p_max_zips below 1
    'b|501|30|100|9999|24',       -- p_max_zips above 500
    'b|50|0|100|9999|24',         -- p_max_seconds below 1
    'b|50|101|100|9999|24',       -- p_max_seconds above the statement timeout margin
    'b|50|30|100|9999|0',         -- p_min_interval_hours below 1
    'c|50|30|100|9999|24',        -- a closed run
    '(null)|50|30|100|9999|24'    -- no run
  ];
  x text; f text[];
begin
  foreach x in array cases loop
    f := string_to_array(x, '|');
    begin
      perform public.dev_change_tick(
        case f[1] when 'b' then b when 'o' then o when 'c' then c else null end,
        f[2]::int, f[3]::int, nullif(f[4], '(null)')::bigint, nullif(f[5], '(null)')::bigint, f[6]::int);
    exception when raise_exception then n := n + 1; end;
  end loop;
  -- boundary: exactly floor + budget passes, and an ordinary run may omit the figure
  perform public.dev_change_tick(b, 1, 5, 100, 2148, 24); ok_calls := ok_calls + 1;
  perform public.dev_change_tick(o, 1, 5, 100, null, 24); ok_calls := ok_calls + 1;
  perform pg_temp._ck('D09 every unsafe call is refused with an exception (12 of 12) and the two boundary calls that are allowed run',
    n = 12 and ok_calls = 2, 'refused ' || n || ' of 12; allowed ' || ok_calls || ' of 2');
end $$;
select pg_temp._ck('D09b the refused calls wrote nothing: the ZIP that was due was observed only by the two allowed boundary calls, exactly once',
  (select count(*) = 1 from public.dev_change_event where identity_key = 'k:d09')
  and (select count(*) = 1 from public.dev_change_zip_cursor where zip = '91041'));

-- ---- D10  the universe is the canonical registry, materialised ZIPs only -------------------------------------
insert into public.canonical_zip_registry (zip) values ('91042');                       -- registered, never materialised
select pg_temp._set('91042', 'k:d10-unmaterialised', 1, pg_temp._t(11));
insert into public.app_community_meta (zip, updated_at) values ('99999', pg_temp._t(10)); -- materialised, NOT registered
select pg_temp._set('99999', 'k:d10-unregistered', 1, pg_temp._t(11));
insert into _res select 'd10', pg_temp._tick('b');
select pg_temp._ck('D10 a registered ZIP that was never materialised, and a materialised ZIP that is not in the registry, are both left alone (no page is ever created here)',
  (select j->>'zips_observed' = '0' and (j->>'baseline_complete')::boolean from _res where name = 'd10')
  and not exists (select 1 from public.dev_change_project where identity_key in ('k:d10-unmaterialised', 'k:d10-unregistered'))
  and not exists (select 1 from public.dev_change_zip_cursor where zip in ('91042', '99999')), (select j::text from _res where name = 'd10'));

-- ---- D11  another writer holds the ledger: the tick stops and does not advance a cursor ------------------------
create extension if not exists dblink;
\set pghost ''
\set pgport '5432'
\set pguser ''
\set pgdb ''
\set pgpass ''
\getenv pghost PGHOST
\getenv pgport PGPORT
\getenv pguser PGUSER
\getenv pgdb PGDATABASE
\getenv pgpass PGPASSWORD
select format('host=%s port=%s user=%s dbname=%s password=%s', :'pghost', :'pgport', :'pguser', :'pgdb', :'pgpass') as cs \gset
select dblink_connect('lockc', :'cs');
select dblink_exec('lockc', 'begin');
select dblink_exec('lockc', 'do $x$ begin perform pg_advisory_xact_lock(hashtext(''dev_change_observe'')); end $x$');
select pg_temp._zip('91051');
select pg_temp._set('91051', 'k:d11', 1, pg_temp._t(11));
insert into _res select 'd11a', pg_temp._tick('b');
select dblink_exec('lockc', 'rollback');
select dblink_disconnect('lockc');
select pg_temp._ck('D11a while another session holds the ledger lock the tick stops (status stopped, reason busy), observes nothing and leaves the ZIP un-cursored',
  (select j->>'status' = 'stopped' and j->>'stopped_reason' = 'busy' and j->>'zips_observed' = '0' and j->>'zip_errors' = '0' from _res where name = 'd11a')
  and not exists (select 1 from public.dev_change_zip_cursor where zip = '91051'), (select j::text from _res where name = 'd11a'));
insert into _res select 'd11b', pg_temp._tick('b');
select pg_temp._ck('D11b once the lock is released the ZIP is observed',
  (select j->>'zips_observed' = '1' from _res where name = 'd11b'));

-- ---- D12  lock-down ----------------------------------------------------------------------------------------------
select pg_temp._ck('D12a anon, authenticated and PUBLIC hold no privilege of any kind on the cursor or the source-health view',
  not exists (
    select 1
      from (values ('dev_change_zip_cursor'), ('dev_change_source_health')) t(n),
           (values ('anon'), ('authenticated'), ('public')) r(role),
           (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) p(priv)
     where has_table_privilege(r.role, 'public.' || t.n, p.priv)));
select pg_temp._ck('D12b row level security is enabled on the cursor',
  (select relrowsecurity from pg_class where oid = 'public.dev_change_zip_cursor'::regclass));
select pg_temp._ck('D12c service_role can read and write the cursor but never DELETE or TRUNCATE it, and can only SELECT the view',
  has_table_privilege('service_role', 'public.dev_change_zip_cursor', 'select')
  and has_table_privilege('service_role', 'public.dev_change_zip_cursor', 'insert')
  and has_table_privilege('service_role', 'public.dev_change_zip_cursor', 'update')
  and not has_table_privilege('service_role', 'public.dev_change_zip_cursor', 'delete')
  and not has_table_privilege('service_role', 'public.dev_change_zip_cursor', 'truncate')
  and has_table_privilege('service_role', 'public.dev_change_source_health', 'select')
  and not has_table_privilege('service_role', 'public.dev_change_source_health', 'insert'));
select pg_temp._ck('D12d the driver is executable by service_role only (and every dev_change_ function still is)',
  (select count(*) >= 11 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'dev\_change\_%')
  and not exists (
    select 1 from pg_proc p, (values ('anon'), ('authenticated'), ('public')) r(role)
     where p.pronamespace = 'public'::regnamespace and p.proname like 'dev\_change\_%'
       and has_function_privilege(r.role, p.oid, 'execute'))
  and has_function_privilege('service_role', 'public.dev_change_tick(uuid,integer,integer,bigint,bigint,integer)', 'execute'));
select pg_temp._ck('D12e the view runs with the CALLER''s rights (security_invoker), so row level security on the ledger is not bypassed',
  (select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.dev_change_source_health'::regclass));
select pg_temp._ck('D12f the ledger project table leaves room for HOT updates (fillfactor 80)',
  (select 'fillfactor=80' = any (reloptions) from pg_class where oid = 'public.dev_change_project'::regclass));

-- ---- D13  source health is evidence, per source family --------------------------------------------------------------
insert into public.dev_change_project
  (identity_key, registry_id, key_basis, comparable, non_comparable_reason, facts_version, facts, facts_fp,
   first_observed_at, last_observed_at, observation_count, zips)
values
  ('h1', 'src-h', 'source_id:case_number', true,  null,                    1, '{"submitted_at":"2026-08-01"}', 'a', pg_temp._t(5),  pg_temp._t(30), 2, '{}'),
  ('h2', 'src-h', 'source_id:case_number', true,  null,                    1, '{"submitted_at":"2026-09-01"}', 'b', pg_temp._t(6),  pg_temp._t(31), 1, '{}'),
  ('h3', 'src-h', 'source_id:other',       false, 'sibling_records',       1, '{"submitted_at":"2199-09-09"}', 'c', pg_temp._t(7),  pg_temp._t(32), 1, '{}'),
  ('h4', 'src-h', 'source_id:row_id',      false, 'non_durable_key_basis', 1, '{"submitted_at":null}',         'd', pg_temp._t(8),  pg_temp._t(33), 1, '{}'),
  ('y1', 'src-y', 'source_id:case_number', true,  null,                    1, '{"submitted_at":"2026-07-01"}', 'e', pg_temp._t(9),  pg_temp._t(34), 1, '{}');
insert into public.dev_refresh_source_failures (zip, registry_id, reason, blocked_update, seen_at, kind) values
  ('91001', 'src-h', 'r', false, now() - interval '1 hour',  'fetch_failed'),
  ('91001', 'src-h', 'r', true,  now() - interval '2 hours', 'fetch_failed'),
  ('91002', 'src-h', 'r', true,  now() - interval '3 days',  'fetch_failed'),
  ('91003', 'src-h', 'r', true,  now() - interval '10 days', 'fetch_failed'),
  ('91005', 'src-h', 'r', true,  now() - interval '20 days', 'fetch_failed'),   -- outside 14 days: counts nowhere, and its ZIP is not counted
  ('91001', 'src-h', 'r', false, now() - interval '1 hour',  'truncated'),
  ('91004', 'src-h', 'r', false, now() - interval '3 days',  'truncated'),
  ('91006', 'src-h', 'r', false, now() - interval '5 days',  'retired'),          -- a retirement is not a fetch failure and its ZIP is not counted
  ('91001', '(whole-report fire)', 'HTTP 503', false, now() - interval '1 hour', 'fire_http_error'),
  ('91001', '(whole-report fire)', 'HTTP 503', false, now() - interval '2 hours', 'fire_http_error'),
  ('91001', '(whole-report fire)', 'x', false, now() - interval '2 hours', 'fire_failed'),
  ('91002', 'src-x', 'r', true,  now() - interval '1 hour',  'fetch_failed');
select pg_temp._ck('D13a the source with ledger rows and failures reports exact coverage: 4 identities, 2 comparable, 1 change-ready, 1 sibling, 1 non-durable',
  (select identities = 4 and comparable = 2 and change_ready = 1 and sibling_records = 1 and non_durable_key_basis = 1
      and first_observed_at = pg_temp._t(5) and last_observed_at = pg_temp._t(33)
     from public.dev_change_source_health where registry_id = 'src-h'));
select pg_temp._ck('D13b its newest FILING date ignores a future placeholder (2199) and a null: it is 2026-09-01',
  (select newest_filing_date = date '2026-09-01' from public.dev_change_source_health where registry_id = 'src-h'));
select pg_temp._ck('D13c failure evidence over the workbook''s windows: in 24 h 2 fetch failures, 1 blocked, 1 truncation; in 14 days 4 fetch failures, 3 blocked, 2 truncations across 4 ZIPs; retired; last failure about an hour ago',
  (select fetch_failures_24h = 2 and blocked_24h = 1 and truncated_24h = 1
      and fetch_failures_14d = 4 and blocked_14d = 3 and truncated_14d = 2 and zips_failed_14d = 4 and retired_ever
      and last_fetch_failure_at between now() - interval '61 minutes' and now() - interval '59 minutes'
     from public.dev_change_source_health where registry_id = 'src-h'));
select pg_temp._ck('D13d a source with failures and no ledger rows still appears, with zero identities and the failure counted',
  (select identities = 0 and fetch_failures_24h = 1 and blocked_24h = 1 and first_observed_at is null
     from public.dev_change_source_health where registry_id = 'src-x'));
select pg_temp._ck('D13e a source with ledger rows and no failures reports zero failures, no last failure and not retired',
  (select identities = 1 and fetch_failures_24h = 0 and fetch_failures_14d = 0 and zips_failed_14d = 0 and last_fetch_failure_at is null and not retired_ever
     from public.dev_change_source_health where registry_id = 'src-y'));
select pg_temp._ck('D13f the whole-report fire failures are a pipeline fault under a pseudo source and are NOT any source''s health',
  not exists (select 1 from public.dev_change_source_health where registry_id = '(whole-report fire)'));
select pg_temp._ck('D13g the view exposes exactly the evidence columns and no health label or threshold (and no column named freshness: a filing date is not a freshness field)',
  (select array_agg(attname::text order by attnum) = array['registry_id', 'identities', 'comparable', 'change_ready', 'sibling_records',
      'non_durable_key_basis', 'first_observed_at', 'last_observed_at', 'newest_filing_date', 'fetch_failures_24h', 'blocked_24h',
      'truncated_24h', 'fetch_failures_14d', 'blocked_14d', 'truncated_14d', 'zips_failed_14d', 'last_fetch_failure_at', 'retired_ever']
     from pg_attribute where attrelid = 'public.dev_change_source_health'::regclass and attnum > 0 and not attisdropped));

-- ---- D15  the failure evidence on its own: the reader's cheap path ------------------------------------------------------
-- The reader (supabase/functions/_shared/change-reads.ts) asks for ONE family's failure counts. Through the wide view that
-- means aggregating the whole ledger first (measured 6.1-6.2 s on 933,013 projects, against PostgREST's 8 s). These checks
-- read the query PLAN, because the defect was a plan shape: the answers were always right, only the work was wrong.
create function pg_temp._plan(q text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin execute 'explain (format json) ' || q into r; return r; end $f$;
create function pg_temp._rels(p jsonb) returns text language sql as $f$
  select coalesce(string_agg(distinct x #>> '{}', ',' order by x #>> '{}'), '') from jsonb_path_query(p, '$.**."Relation Name"') x $f$;
select pg_temp._ck('D15a the narrow view returns the same failure counts the wide view does, for a family with failures and for one with none (row sets equal, in both directions)',
  not exists (select 1 from (
      select registry_id, fetch_failures_24h, blocked_24h, truncated_24h, fetch_failures_14d, blocked_14d, truncated_14d, zips_failed_14d, last_fetch_failure_at, retired_ever
        from public.dev_change_source_fetch_health
      except
      select registry_id, fetch_failures_24h, blocked_24h, truncated_24h, fetch_failures_14d, blocked_14d, truncated_14d, zips_failed_14d, last_fetch_failure_at, retired_ever
        from public.dev_change_source_health where last_fetch_failure_at is not null or fetch_failures_14d > 0 or fetch_failures_24h > 0 or truncated_24h > 0 or retired_ever or blocked_24h > 0) a)
  and not exists (select 1 from (
      select registry_id, fetch_failures_24h, blocked_24h, truncated_24h, fetch_failures_14d, blocked_14d, truncated_14d, zips_failed_14d, last_fetch_failure_at, retired_ever
        from public.dev_change_source_health where last_fetch_failure_at is not null or fetch_failures_14d > 0 or fetch_failures_24h > 0 or truncated_24h > 0 or retired_ever or blocked_24h > 0
      except
      select registry_id, fetch_failures_24h, blocked_24h, truncated_24h, fetch_failures_14d, blocked_14d, truncated_14d, zips_failed_14d, last_fetch_failure_at, retired_ever
        from public.dev_change_source_fetch_health) b)
  and (select count(*) from public.dev_change_source_fetch_health) >= 2);
select pg_temp._ck('D15b a family with ledger rows and no failure record has NO row in the narrow view (and a zero row in the wide one): absent and all-zero mean the same to every consumer',
  not exists (select 1 from public.dev_change_source_fetch_health where registry_id = 'src-y')
  and exists (select 1 from public.dev_change_source_health where registry_id = 'src-y' and fetch_failures_24h = 0 and blocked_24h = 0 and truncated_24h = 0));
select pg_temp._ck('D15c CONTROL: the plan reader can see a ledger scan — the wide view''s plan for the same question reaches dev_change_project',
  pg_temp._rels(pg_temp._plan($q$select registry_id, fetch_failures_24h, blocked_24h, truncated_24h from public.dev_change_source_health where registry_id = any (array['src-h'])$q$)) like '%dev_change_project%');
select pg_temp._ck('D15d the narrow view''s plan for the reader''s query touches ONLY dev_refresh_source_failures — it never reads the ledger',
  pg_temp._rels(pg_temp._plan($q$select registry_id, fetch_failures_24h, blocked_24h, truncated_24h from public.dev_change_source_fetch_health where registry_id = any (array['src-h'])$q$)) = 'dev_refresh_source_failures');
select pg_temp._ck('D15e the registry_id filter is PUSHED DOWN to the scan of the failure record (not applied after the aggregate, which would read every family)',
  exists (select 1 from jsonb_path_query(
      pg_temp._plan($q$select registry_id, fetch_failures_24h, blocked_24h, truncated_24h from public.dev_change_source_fetch_health where registry_id = any (array['src-h'])$q$),
      '$.** ? (@."Relation Name" == "dev_refresh_source_failures")') n
    where coalesce(n->>'Filter', '') || coalesce(n->>'Index Cond', '') || coalesce(n->>'Recheck Cond', '') like '%registry_id%'));
select pg_temp._ck('D15f the narrow view is system-only like the wide one: service_role can select, anon and authenticated cannot, and it is a security-invoker view',
  has_table_privilege('service_role', 'public.dev_change_source_fetch_health', 'select')
  and not has_table_privilege('service_role', 'public.dev_change_source_fetch_health', 'insert')
  and not has_table_privilege('anon', 'public.dev_change_source_fetch_health', 'select')
  and not has_table_privilege('authenticated', 'public.dev_change_source_fetch_health', 'select')
  and (select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.dev_change_source_fetch_health'::regclass));
select pg_temp._ck('D15g the narrow view exposes exactly the failure columns, in the order the wide view carries them',
  (select array_agg(attname::text order by attnum) = array['registry_id', 'fetch_failures_24h', 'blocked_24h', 'truncated_24h',
      'fetch_failures_14d', 'blocked_14d', 'truncated_14d', 'zips_failed_14d', 'last_fetch_failure_at', 'retired_ever']
     from pg_attribute where attrelid = 'public.dev_change_source_fetch_health'::regclass and attnum > 0 and not attisdropped));

-- ---- D14  the ledger vocabulary is unchanged by the driver -------------------------------------------------------
select pg_temp._ck('D14 across every scenario the driver produced only the three ledger event words, and no first sighting made in a baseline run is material',
  (select coalesce(bool_and(event_type in ('first_detected', 'status_changed', 'source_record_updated')), false) from public.dev_change_event)
  and (select count(*) > 10 from public.dev_change_event)
  and not exists (select 1 from public.dev_change_event e join public.dev_change_run r on r.id = e.run_id
                   where r.baseline and e.event_type = 'first_detected' and e.material));

\o
select check_name, pass, detail from _r order by n;

-- =====================================================================================
-- THE RECURRING OBSERVATION JOB + ITS ALARM — EXECUTABLE ADVERSARIAL SUITE
-- (docs/dev-change-observation-schedule.sql)
--
-- Runs against a DISPOSABLE Postgres with the change ledger (with option (b)), the Order D driver, the
-- reportable view, a stand-in pg_cron and a stand-in pipeline_health_tick() already applied, and the shipped
-- file applied once. Every expected answer is a HARD-CODED constant, never computed by the code under test.
--
-- Part W drives the real wrapper over real ledger scenarios. Part H drives the alarm: each scenario retires
-- every earlier scheduled run (so it cannot colour the next) and writes the one run row and the cron rows the
-- scenario needs; thresholds are tested on BOTH sides of the boundary.
-- Times: scenario data is dated relative to a fixed base 30 days ago; the cursor's own clock is real time, so a
-- scenario that needs an old observation BACKDATES the cursor row directly (superuser), never sleeps.
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);
create temp table _base as select date_trunc('hour', now()) - interval '30 days' as t;
create temp table _res (name text primary key, j jsonb);
create temp table _fp (name text primary key, v text);
create temp table _msg (name text primary key, m text);

create function pg_temp._t(n numeric) returns timestamptz language sql stable as
$$ select (select t from _base) + n * interval '1 hour' $$;
create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;
create function pg_temp._iso(t timestamptz) returns text language sql immutable as
$$ select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') $$;

-- run a statement AS a role (invoker rights); 'ok' or the SQLSTATE
create function pg_temp._as(p_role text, p_sql text) returns text language plpgsql as $$
begin
  execute format('set role %I', p_role);
  begin
    execute p_sql;
    execute 'reset role';
    return 'ok';
  exception when others then
    execute 'reset role';
    return sqlstate;
  end;
end $$;
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- ONE app_projects row, the way the materialiser would write it
create function pg_temp._set(
  p_zip text, p_key text, p_seq int, p_obs timestamptz,
  p_stage text default 'Submitted', p_status text default 'Proposed', p_date_kind text default 'filed',
  p_name text default 'Alpha Plaza'
) returns void language plpgsql as $$
begin
  delete from public.app_projects where zip = p_zip and source_key = p_key and source_seq = p_seq;
  insert into public.app_projects
    (zip, record_kind, source_key, source_key_basis, source_seq, registry_id, name, type, type_raw,
     status, stage, date_kind, submitted_at, address, provenance)
  values (p_zip, 'development', p_key, 'source_id:case_number', p_seq, 'fixture-registry', p_name,
          'Commercial', 'Retail', p_status, p_stage, p_date_kind, '2026-08-01', '1 Main St',
          jsonb_build_object('refreshed_at', pg_temp._iso(p_obs), 'source_vintage', 'fixture'));
end $$;

-- a ZIP that exists in the canonical registry and has been materialised at p_meta
create function pg_temp._zip(p_zip text, p_meta timestamptz default null) returns void language sql as
$$ insert into public.canonical_zip_registry (zip) values (p_zip) on conflict do nothing;
   insert into public.app_community_meta (zip, updated_at) values (p_zip, coalesce(p_meta, pg_temp._t(10)))
   on conflict (zip) do update set updated_at = excluded.updated_at $$;

-- the Order D baseline tick (the only place a first sighting is not news)
create temp table _ctx (name text primary key, run uuid);
insert into _ctx select 'b', public.dev_change_start_run(true, '{"suite":"dev_change_observation_pg"}');
create function pg_temp._baseline() returns jsonb language sql as
$$ select public.dev_change_tick((select run from _ctx where name = 'b'), 100, 30, 100000, 1000000, 24) $$;

-- the tables the wrapper READS must never be written by it
create function pg_temp._source_fp() returns text language sql as $$
  select md5(coalesce((select string_agg(zip || ':' || coalesce(source_key, '') || ':' || coalesce(stage, '') || ':' || coalesce(name, ''), ',' order by zip, source_key, source_seq) from public.app_projects), '')
          || '|' || coalesce((select string_agg(zip, ',' order by zip) from public.canonical_zip_registry), '')
          || '|' || coalesce((select string_agg(zip || updated_at::text, ',' order by zip) from public.app_community_meta), '')
          || '|' || (select count(*)::text from public.dev_refresh_source_failures)) $$;

-- the wrapper, the way pg_cron calls it
create function pg_temp._obs() returns jsonb language sql as $$ select public.dev_change_observe_scheduled() $$;
create function pg_temp._scheduled() returns bigint language sql as
$$ select count(*) from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled' $$;

-- ═════════════════════════════ PART W — THE WRAPPER ═════════════════════════════
select pg_temp._zip('91101'); select pg_temp._zip('91102');
select pg_temp._set('91101', 'k:w1a', 1, pg_temp._t(11));
select pg_temp._set('91101', 'k:w1b', 1, pg_temp._t(11));
select pg_temp._set('91102', 'k:w2',  1, pg_temp._t(11));
insert into _res select 'base', pg_temp._baseline();
select pg_temp._ck('W00 the fixture baseline observed the two ZIPs (3 first-sighting events, none material)',
  (select j->>'zips_observed' = '2' and (j->>'baseline_complete')::boolean from _res where name = 'base')
  and (select count(*) = 3 and bool_and(is_baseline and not material) from public.dev_change_event),
  (select j::text from _res where name = 'base'));

-- W01 nothing is due: an ordinary run is opened, ticked once, and says so
insert into _fp select 'src_before_w01', pg_temp._source_fp();
insert into _res select 'w01', pg_temp._obs();
select pg_temp._ck('W01 the first call of a day opens ONE ordinary run, ticks once, and reports nothing due (nothing observed, no event, status ok)',
  (select j->>'zips_observed' = '0' and j->>'events_written' = '0' and j->>'stopped_reason' = 'none_due'
      and j->>'status' = 'ok' and not (j->>'baseline')::boolean from _res where name = 'w01')
  and pg_temp._scheduled() = 1
  and (select count(*) = 1 and bool_and(not baseline and finished_at is null and detail->>'purpose' = 'scheduled'
          and detail->>'day' = to_char(now() at time zone 'UTC', 'YYYY-MM-DD') and detail->>'ticks' = '1')
         from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled'),
  (select j::text from _res where name = 'w01'));
-- every check below that reads the scheduled runs is an AGGREGATE over them: a regression that leaves two rows where
-- one is expected must FAIL its named check, never crash the suite (a crashed suite prints nothing, and a harness that
-- reads "no failures" from a crash reports a surviving mutation -- measured on this file, 2026-10-01)
select pg_temp._ck('W01b the run carries its own receipt: the tick result, when it ran, and that the day''s pass is complete',
  (select count(*) = 1 and bool_and(detail->'last_tick'->>'stopped_reason' = 'none_due' and (detail->>'completed')::boolean
      and detail->>'completed_at' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$' and detail->>'last_tick_at' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$'
      and (detail->>'last_tick_at')::timestamptz > now() - interval '2 minutes')
         from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled'));
insert into _fp select 'run_w01', (select id::text from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled');
-- pin "completed_at" to a fixed instant so a later tick that moved it could not hide inside the same second
update public.dev_change_run set detail = jsonb_set(detail, '{completed_at}', '"2026-01-01T00:00:00Z"') where not baseline and detail->>'purpose' = 'scheduled';
insert into _fp select 'completed_at_w01', '2026-01-01T00:00:00Z';
select pg_temp._ck('W01c the wrapper wrote nothing it reads from (app_projects, the registry, the materialisation clock, the refresh failures)',
  (select a.v = pg_temp._source_fp() from _fp a where a.name = 'src_before_w01'));

-- W02 the second call the same day reuses the run
insert into _res select 'w02', pg_temp._obs();
select pg_temp._ck('W02 a second call the same UTC day REUSES the day''s run (one run, two ticks) and the run id is returned',
  pg_temp._scheduled() = 1
  and (select count(*) = 1 and bool_and(detail->>'ticks' = '2') from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled')
  and (select (j->>'run') = (select v from _fp where name = 'run_w01') from _res where name = 'w02'),
  (select j::text from _res where name = 'w02'));

-- W03 a re-materialised ZIP whose last observation is old is observed in the ORDINARY run: one material change
update public.app_community_meta set updated_at = pg_temp._t(20) where zip = '91101';
select pg_temp._set('91101', 'k:w1a', 1, pg_temp._t(21), 'Approved', 'Approved', 'approved');
update public.dev_change_zip_cursor set observed_at = now() - interval '48 hours' where zip = '91101';
insert into _res select 'w03', pg_temp._obs();
select pg_temp._ck('W03 a re-materialised ZIP is observed and its publisher status change is ONE material event on the day''s run',
  (select j->>'zips_observed' = '1' and j->>'events_written' = '1' and j->>'zip_errors' = '0' from _res where name = 'w03')
  and (select count(*) = 1 and bool_and(event_type = 'status_changed' and material and not is_baseline
                                         and run_id::text = (select v from _fp where name = 'run_w01'))
         from public.dev_change_event where identity_key = 'k:w1a' and event_type <> 'first_detected')
  and (select count(*) = 1 from public.dev_change_event_reportable where identity_key = 'k:w1a')
  and (select count(*) = 0 from public.dev_change_event where identity_key in ('k:w1b', 'k:w2') and event_type <> 'first_detected'),
  (select j::text from _res where name = 'w03'));
select pg_temp._ck('W03b "completed" is STICKY and its first instant is kept (a later tick that finds work does not unset it or move it)',
  (select count(*) = 1 and bool_and((detail->>'completed')::boolean and detail->>'completed_at' = (select v from _fp where name = 'completed_at_w01')
      and detail->>'ticks' = '3') from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled'));

-- W04 a never-observed ZIP is NEVER first-observed by the scheduled run
select pg_temp._zip('91103');
select pg_temp._set('91103', 'k:w3', 1, pg_temp._t(11));
insert into _res select 'w04', pg_temp._obs();
select pg_temp._ck('W04 the scheduled run refuses a ZIP the baseline never observed: no cursor, no project, no first_detected (its whole content would be news)',
  (select j->>'zips_observed' = '0' and j->>'zips_never_observed' = '1' and not (j->>'baseline_complete')::boolean from _res where name = 'w04')
  and not exists (select 1 from public.dev_change_zip_cursor where zip = '91103')
  and not exists (select 1 from public.dev_change_project where identity_key = 'k:w3'),
  (select j::text from _res where name = 'w04'));
select pg_temp._ck('W05 across every scenario so far no scheduled run is a baseline run and no first_detected was written by one',
  not exists (select 1 from public.dev_change_run where baseline and detail->>'purpose' = 'scheduled')
  and not exists (select 1 from public.dev_change_event e join public.dev_change_run r on r.id = e.run_id
                   where r.detail->>'purpose' = 'scheduled' and e.event_type = 'first_detected'));

-- W06 a new UTC day closes the old run and opens a new one
update public.dev_change_run set detail = jsonb_set(detail, '{day}', '"2000-01-01"') where not baseline and detail->>'purpose' = 'scheduled';
insert into _res select 'w06', pg_temp._obs();
select pg_temp._ck('W06 the first call of a NEW UTC day closes the earlier day''s run and opens a fresh one (two runs, one finished, one open with 1 tick, a different id)',
  pg_temp._scheduled() = 2
  and (select count(*) = 1 from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled' and finished_at is not null and detail->>'day' = '2000-01-01')
  and (select count(*) = 1 from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled' and finished_at is null
                                   and detail->>'ticks' = '1' and detail->>'day' = to_char(now() at time zone 'UTC', 'YYYY-MM-DD'))
  and (select (j->>'run') <> (select v from _fp where name = 'run_w01') from _res where name = 'w06'),
  (select j::text from _res where name = 'w06'));

-- W07 option (b) is in force through the wrapper: copies that contradict are HELD, never announced
select pg_temp._zip('91104'); select pg_temp._zip('91105');
select pg_temp._set('91104', 'k:w7', 1, pg_temp._t(11));
select pg_temp._set('91105', 'k:w7', 1, pg_temp._t(11));
insert into _res select 'w07base', pg_temp._baseline();
update public.app_community_meta set updated_at = pg_temp._t(30) where zip = '91104';
select pg_temp._set('91104', 'k:w7', 1, pg_temp._t(31), 'Submitted', 'Proposed', 'filed', 'Beta Plaza');
update public.dev_change_zip_cursor set observed_at = now() - interval '48 hours' where zip = '91104';
insert into _res select 'w07', pg_temp._obs();
select pg_temp._ck('W07 a copy that now contradicts the other copy of the same record is HELD by the scheduled run: no event and an audit row of kind change_held (the ZIP IS observed: it is the change that is held)',
  (select j->>'zips_observed' = '1' and j->>'events_written' = '0' and j->>'zip_errors' = '0' from _res where name = 'w07')
  and not exists (select 1 from public.dev_change_event where identity_key = 'k:w7' and event_type <> 'first_detected')
  and exists (select 1 from public.dev_change_copy_conflict where identity_key = 'k:w7' and kind = 'change_held'),
  (select j::text from _res where name = 'w07'));

-- W13 one call observes every due ZIP up to its cap (the cap is at least three)
select pg_temp._zip('91106'); select pg_temp._zip('91107'); select pg_temp._zip('91108');
select pg_temp._set('91106', 'k:w13a', 1, pg_temp._t(11));
select pg_temp._set('91107', 'k:w13b', 1, pg_temp._t(11));
select pg_temp._set('91108', 'k:w13c', 1, pg_temp._t(11));
insert into _res select 'w13base', pg_temp._baseline();
update public.app_community_meta set updated_at = pg_temp._t(40) where zip in ('91106', '91107', '91108');
select pg_temp._set('91106', 'k:w13a', 1, pg_temp._t(41), 'Approved', 'Approved', 'approved');
select pg_temp._set('91107', 'k:w13b', 1, pg_temp._t(41), 'Approved', 'Approved', 'approved');
select pg_temp._set('91108', 'k:w13c', 1, pg_temp._t(41), 'Approved', 'Approved', 'approved');
update public.dev_change_zip_cursor set observed_at = now() - interval '48 hours' where zip in ('91106', '91107', '91108');
insert into _res select 'w13', pg_temp._obs();
select pg_temp._ck('W13 three due ZIPs are all observed by ONE call, one material change each',
  (select j->>'zips_observed' = '3' and j->>'events_written' = '3' and j->>'zip_errors' = '0' from _res where name = 'w13')
  and (select count(*) = 3 from public.dev_change_event_reportable where identity_key in ('k:w13a', 'k:w13b', 'k:w13c')),
  (select j::text from _res where name = 'w13'));

-- W14 the 24-hour interval, on both sides: a ZIP observed 12 hours ago is NOT due, one observed 25 hours ago is
select pg_temp._zip('91109');
select pg_temp._set('91109', 'k:w14', 1, pg_temp._t(11));
insert into _res select 'w14base', pg_temp._baseline();
update public.app_community_meta set updated_at = pg_temp._t(50) where zip = '91109';
select pg_temp._set('91109', 'k:w14', 1, pg_temp._t(51), 'Approved', 'Approved', 'approved');
update public.dev_change_zip_cursor set observed_at = now() - interval '12 hours' where zip = '91109';
insert into _res select 'w14a', pg_temp._obs();
select pg_temp._ck('W14a a re-materialised ZIP whose last observation is 12 hours old is NOT observed (the interval is a write-volume bound)',
  (select j->>'zips_observed' = '0' from _res where name = 'w14a') and (select count(*) = 1 from public.dev_change_event where identity_key = 'k:w14'),
  (select j::text from _res where name = 'w14a'));
update public.dev_change_zip_cursor set observed_at = now() - interval '25 hours' where zip = '91109';
insert into _res select 'w14b', pg_temp._obs();
select pg_temp._ck('W14b once its last observation is 25 hours old it IS observed, and its change is one material event',
  (select j->>'zips_observed' = '1' and j->>'events_written' = '1' from _res where name = 'w14b')
  and (select count(*) = 1 from public.dev_change_event_reportable where identity_key = 'k:w14'),
  (select j::text from _res where name = 'w14b'));

-- W15 the cap. One call observes at most 200 ZIPs and says so; a capped tick never declares the day's pass complete;
-- a day that is complete STAYS complete when a later tick is capped again (the alarm reads "completed" from the run)
select pg_temp._zip(z) from (select '92' || lpad(g::text, 3, '0') as z from generate_series(1, 201) g) s;
select pg_temp._set(z, 'k:w15:' || z, 1, pg_temp._t(11)) from (select '92' || lpad(g::text, 3, '0') as z from generate_series(1, 201) g) s;
insert into _res select 'w15b1', pg_temp._baseline();
insert into _res select 'w15b2', pg_temp._baseline();
insert into _res select 'w15b3', pg_temp._baseline();
select pg_temp._ck('W15a the fixture baseline observed the 201 extra ZIPs, in three calls bounded at 100',
  (select count(*) = 201 from public.dev_change_zip_cursor where zip like '92%' and status = 'ok'),
  (select count(*)::text from public.dev_change_zip_cursor where zip like '92%'));
-- every one of the 201 due again: materialised again at hour p_n, last observed 48 hours ago
create function pg_temp._redue(p_n numeric) returns void language sql as
$$ update public.app_community_meta set updated_at = pg_temp._t(p_n) where zip like '92%';
   update public.dev_change_zip_cursor set observed_at = now() - interval '48 hours' where zip like '92%' $$;
-- a day that has not completed (as on a day whose earlier ticks all stopped on the cap)
update public.dev_change_run set detail = detail - 'completed' - 'completed_at'
 where not baseline and detail->>'purpose' = 'scheduled' and finished_at is null;
select pg_temp._redue(60);
insert into _res select 'w15c1', pg_temp._obs();
select pg_temp._ck('W15b one call observes exactly 200 of the 201 due ZIPs and stops because of the CAP (the tick cap is 200: not 1, not more)',
  (select j->>'zips_observed' = '200' and j->>'stopped_reason' = 'max_zips' and j->>'status' = 'ok' from _res where name = 'w15c1'),
  (select j::text from _res where name = 'w15c1'));
select pg_temp._ck('W15c a capped tick leaves the day NOT complete (no "completed", no "completed_at") and the run says why it stopped',
  (select count(*) = 1 and bool_and(not coalesce((detail->>'completed')::boolean, false) and detail->>'completed_at' is null
        and detail->'last_tick'->>'stopped_reason' = 'max_zips')
     from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled' and finished_at is null));
insert into _res select 'w15c2', pg_temp._obs();
select pg_temp._ck('W15d the next call observes the ONE remaining ZIP, finds nothing more due, and the day is complete, with its first instant',
  (select j->>'zips_observed' = '1' and j->>'stopped_reason' = 'none_due' from _res where name = 'w15c2')
  and (select count(*) = 1 and bool_and((detail->>'completed')::boolean and detail->>'completed_at' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
         from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled' and finished_at is null),
  (select j::text from _res where name = 'w15c2'));
update public.dev_change_run set detail = jsonb_set(detail, '{completed_at}', '"2026-01-02T00:00:00Z"')
 where not baseline and detail->>'purpose' = 'scheduled' and finished_at is null;
select pg_temp._redue(70);
insert into _res select 'w15c3', pg_temp._obs();
select pg_temp._ck('W15e a day that is complete STAYS complete, with its first instant, when a later tick is capped again',
  (select j->>'zips_observed' = '200' and j->>'stopped_reason' = 'max_zips' from _res where name = 'w15c3')
  and (select count(*) = 1 and bool_and((detail->>'completed')::boolean and detail->>'completed_at' = '2026-01-02T00:00:00Z'
                                          and detail->'last_tick'->>'stopped_reason' = 'max_zips')
         from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled' and finished_at is null),
  (select j::text from _res where name = 'w15c3'));
insert into _res select 'w15c4', pg_temp._obs();
select pg_temp._ck('W15f the last call drains the day, so the scenarios after this one start from a quiet ledger',
  (select j->>'zips_observed' = '1' and j->>'stopped_reason' = 'none_due' from _res where name = 'w15c4'),
  (select j::text from _res where name = 'w15c4'));

-- W08 it refuses, writing nothing, when option (b) is missing
insert into _fp select 'runs_w08', _scheduled.n::text || '/' || _ticks.n::text
  from (select pg_temp._scheduled() as n) _scheduled,
       (select coalesce(sum((detail->>'ticks')::int), 0) as n from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled') _ticks;
alter table public.dev_change_copy_conflict rename to dev_change_copy_conflict_off;
do $$ begin
  begin perform public.dev_change_observe_scheduled(); insert into _msg values ('w08', 'NO ERROR');
  exception when others then insert into _msg values ('w08', sqlerrm); end;
end $$;
alter table public.dev_change_copy_conflict_off rename to dev_change_copy_conflict;
select pg_temp._ck('W08 without option (b) the wrapper REFUSES, naming it, and wrote nothing (no run, no tick)',
  (select m like '%option (b)%' from _msg where name = 'w08')
  and (select _scheduled.n::text || '/' || _ticks.n::text
         from (select pg_temp._scheduled() as n) _scheduled,
              (select coalesce(sum((detail->>'ticks')::int), 0) as n from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled') _ticks)
      = (select v from _fp where name = 'runs_w08'),
  (select m from _msg where name = 'w08'));

-- W09 a call that raises writes NOTHING: the whole call is one transaction (no half-open run, no stale-run closing)
update public.dev_change_run set detail = jsonb_set(detail, '{day}', '"2000-01-02"') where not baseline and detail->>'purpose' = 'scheduled' and finished_at is null;
insert into _fp select 'open_w09', count(*)::text from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled' and finished_at is null;
alter table public.dev_change_zip_cursor rename to dev_change_zip_cursor_off;
do $$ begin
  begin perform public.dev_change_observe_scheduled(); insert into _msg values ('w09', 'NO ERROR');
  exception when others then insert into _msg values ('w09', 'raised ' || sqlstate); end;
end $$;
alter table public.dev_change_zip_cursor_off rename to dev_change_zip_cursor;
select pg_temp._ck('W09 when the tick raises, the call rolls back as a whole: the earlier day''s run is NOT closed and no new run was opened',
  (select m = 'raised 42P01' from _msg where name = 'w09')
  and (select count(*)::text from public.dev_change_run where not baseline and detail->>'purpose' = 'scheduled' and finished_at is null)
      = (select v from _fp where name = 'open_w09')
  and pg_temp._scheduled() = 2,
  (select m from _msg where name = 'w09'));
-- put the day back so the later scenarios start from a known state
update public.dev_change_run set detail = jsonb_set(detail, '{day}', to_jsonb(to_char(now() at time zone 'UTC', 'YYYY-MM-DD'))) where not baseline and detail->>'purpose' = 'scheduled' and finished_at is null;

-- W10 the lock-down: the wrapper and the health read are service-role only
select pg_temp._ck('W10 no role but service_role can run the wrapper or read the health (anon and authenticated refused with 42501; service_role runs the health)',
  not has_function_privilege('anon', 'public.dev_change_observe_scheduled()', 'execute')
  and not has_function_privilege('authenticated', 'public.dev_change_observe_scheduled()', 'execute')
  and has_function_privilege('service_role', 'public.dev_change_observe_scheduled()', 'execute')
  and pg_temp._as('anon', 'select public.dev_change_observe_scheduled()') = '42501'
  and pg_temp._as('authenticated', 'select public.dev_change_observe_scheduled()') = '42501'
  and pg_temp._as('anon', 'select * from public.dev_change_observation_health()') = '42501'
  and pg_temp._as('authenticated', 'select * from public.dev_change_observation_health()') = '42501'
  and pg_temp._as('service_role', 'select * from public.dev_change_observation_health()') = 'ok');

-- W11 the job
select pg_temp._ck('W11 exactly ONE job, named dev-change-observe, active, every 5 minutes in the 02:00–07:59 UTC window, calling only the wrapper',
  (select count(*) = 1 and bool_and(schedule = '*/5 2-8 * * *' and command = 'select public.dev_change_observe_scheduled()' and active)
     from cron.job where jobname = 'dev-change-observe'),
  (select schedule || ' | ' || command from cron.job where jobname = 'dev-change-observe'));

-- W12 the wrapper only ever starts ORDINARY runs and only through the ledger's own helpers
select pg_temp._ck('W12 every run the wrapper made is an ordinary run with the purpose "scheduled" and a UTC day',
  (select count(*) = 2 and bool_and(not baseline and detail->>'day' ~ '^\d{4}-\d\d-\d\d$') from public.dev_change_run where detail->>'purpose' = 'scheduled'));

-- ═════════════════════════════ PART H — THE ALARM ═════════════════════════════
-- one monitor tick, one statement (the stand-in creates a temp table per call, so ONE call per statement)
create function pg_temp._chk() returns text language plpgsql as $$
declare r text;
begin
  perform count(*) from public.pipeline_health_tick();
  select ok::text || '|' || alertable::text || '|' || detail into r
    from public.pipeline_health_check where check_name = 'dev_change_observation';
  return r;
exception when others then
  return 'ERR ' || sqlstate;
end $$;

-- retire every earlier scheduled run (it keeps its events; it just stops counting) and write the one this scenario needs
create function pg_temp._h(p_tick_h numeric, p_stop text, p_first_h numeric, p_done_h numeric default null) returns void language plpgsql as $$
begin
  update public.dev_change_run set detail = jsonb_build_object('purpose', 'retired')
   where not baseline and detail->>'purpose' = 'scheduled';
  insert into public.dev_change_run (baseline, started_at, detail)
  values (false, now() - make_interval(secs => p_first_h * 3600),
    jsonb_build_object('purpose', 'scheduled', 'day', '2001-01-01', 'ticks', 1)
    || case when p_tick_h is null then '{}'::jsonb
            else jsonb_build_object('last_tick_at', to_char((now() - make_interval(secs => p_tick_h * 3600)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                    'last_tick', jsonb_build_object('stopped_reason', p_stop)) end
    || case when p_done_h is null then '{}'::jsonb
            else jsonb_build_object('completed', true,
                                    'completed_at', to_char((now() - make_interval(secs => p_done_h * 3600)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) end);
end $$;
-- no scheduled run at all
create function pg_temp._h0() returns void language sql as
$$ update public.dev_change_run set detail = jsonb_build_object('purpose', 'retired') where not baseline and detail->>'purpose' = 'scheduled' $$;

-- the job row and its recent runs; the FIRST status is the most recent
create function pg_temp._cron(p_active boolean, p_cmd text, p_statuses text[]) returns void language plpgsql as $$
begin
  update cron.job set active = p_active, command = p_cmd where jobname = 'dev-change-observe';
  delete from cron.job_run_details;
  insert into cron.job_run_details (jobid, status, start_time)
  select (select jobid from cron.job where jobname = 'dev-change-observe'), s, now() - make_interval(mins => o::int * 10)
    from unnest(p_statuses) with ordinality as t(s, o);
end $$;
create function pg_temp._okcmd() returns text language sql as $$ select 'select public.dev_change_observe_scheduled()' $$;

-- H01 healthy
select pg_temp._h(2, 'max_zips', 30, 10);
select pg_temp._cron(true, pg_temp._okcmd(), array['succeeded', 'succeeded', 'succeeded']);
insert into _msg select 'h01', pg_temp._chk();
select pg_temp._ck('H01 a healthy job (active, ticked 2 hours ago, a pass completed 10 hours ago, no error ZIPs, recent runs succeeded) is OK and ALERTABLE',
  (select m like 'true|true|job active; last tick %' from _msg where name = 'h01'), (select m from _msg where name = 'h01'));
select pg_temp._ck('H01b the OK line states the last stop reason and carries no record or error text',
  (select m like '%(max_zips); no error ZIPs' from _msg where name = 'h01'), (select m from _msg where name = 'h01'));

-- H02 the job itself: missing, inactive, and calling something else each FAIL, naming the state
create function pg_temp._jobname(p text) returns void language sql as
$$ update cron.job set jobname = p where jobname in ('dev-change-observe', 'dev-change-observe-gone') $$;
select pg_temp._jobname('dev-change-observe-gone');
insert into _msg select 'h02a', pg_temp._chk();
select pg_temp._jobname('dev-change-observe');
select pg_temp._cron(false, pg_temp._okcmd(), array['succeeded']);
insert into _msg select 'h02b', pg_temp._chk();
select pg_temp._cron(true, 'select 1', array['succeeded']);
insert into _msg select 'h02c', pg_temp._chk();
select pg_temp._cron(true, pg_temp._okcmd(), array['succeeded']);
select pg_temp._ck('H02a a MISSING job fails, alertable, naming it',
  (select m like 'false|true|%job dev-change-observe is missing%' from _msg where name = 'h02a'), (select m from _msg where name = 'h02a'));
select pg_temp._ck('H02b an INACTIVE job fails, alertable, naming it',
  (select m like 'false|true|%job dev-change-observe is inactive%' from _msg where name = 'h02b'), (select m from _msg where name = 'h02b'));
select pg_temp._ck('H02c a job that no longer calls the wrapper fails, alertable, naming it',
  (select m like 'false|true|%job dev-change-observe is wrong_command%' from _msg where name = 'h02c'), (select m from _msg where name = 'h02c'));

-- H03 stale: 36 hours, both sides of the boundary
select pg_temp._h(37, 'max_zips', 40, 10);
insert into _msg select 'h03a', pg_temp._chk();
select pg_temp._h(35, 'max_zips', 40, 10);
insert into _msg select 'h03b', pg_temp._chk();
select pg_temp._ck('H03a no tick for 37 hours FAILS, alertable, naming the 36-hour limit',
  (select m like 'false|true|%no observation tick has completed since %(36-hour limit)%' from _msg where name = 'h03a'), (select m from _msg where name = 'h03a'));
select pg_temp._ck('H03b a tick 35 hours ago still passes (the limit is not tighter than 36)',
  (select m like 'true|true|%' from _msg where name = 'h03b'), (select m from _msg where name = 'h03b'));

-- H04 no pass has completed: 48 hours, anchored on the first run, both sides, and "still warming up"
select pg_temp._h(1, 'max_zips', 49, 49);
insert into _msg select 'h04a', pg_temp._chk();
select pg_temp._h(1, 'max_zips', 60, 47);
insert into _msg select 'h04b', pg_temp._chk();
select pg_temp._h(1, 'max_zips', 30, null);
insert into _msg select 'h04c', pg_temp._chk();
select pg_temp._h(1, 'max_zips', 50, null);
insert into _msg select 'h04d', pg_temp._chk();
select pg_temp._ck('H04a the newest completed pass is 49 hours old FAILS ("nothing due" not reached in 48 hours)',
  (select m like 'false|true|%no daily pass has reached "nothing due" in 48 hours%' from _msg where name = 'h04a'), (select m from _msg where name = 'h04a'));
select pg_temp._ck('H04b a completed pass 47 hours ago passes',
  (select m like 'true|true|%' from _msg where name = 'h04b'), (select m from _msg where name = 'h04b'));
select pg_temp._ck('H04c no pass has completed yet but the first run is only 30 hours old: still warming up, passes',
  (select m like 'true|true|%' from _msg where name = 'h04c'), (select m from _msg where name = 'h04c'));
select pg_temp._ck('H04d no pass has EVER completed and the first run is 50 hours old FAILS (the window cannot cover the sweep)',
  (select m like 'false|true|%no daily pass has reached "nothing due" in 48 hours%' from _msg where name = 'h04d'), (select m from _msg where name = 'h04d'));

-- H05 the ledger is full
select pg_temp._h(1, 'ledger_budget', 30, 10);
insert into _msg select 'h05', pg_temp._chk();
select pg_temp._ck('H05 a tick that stopped on the ledger byte budget FAILS, alertable (the ledger is full)',
  (select m like 'false|true|%stopped on the ledger byte budget%' from _msg where name = 'h05'), (select m from _msg where name = 'h05'));
select pg_temp._h(1, 'busy', 30, 10);
insert into _msg select 'h05b', pg_temp._chk();
select pg_temp._ck('H05b a tick that stopped because another writer held the lock (busy) is NOT a failure',
  (select m like 'true|true|%' from _msg where name = 'h05b'), (select m from _msg where name = 'h05b'));

-- H06 the call keeps raising: three failed cron runs, not two
select pg_temp._h(1, 'max_zips', 30, 10);
select pg_temp._cron(true, pg_temp._okcmd(), array['failed', 'failed', 'failed']);
insert into _msg select 'h06a', pg_temp._chk();
select pg_temp._cron(true, pg_temp._okcmd(), array['failed', 'failed', 'succeeded']);
insert into _msg select 'h06b', pg_temp._chk();
select pg_temp._cron(true, pg_temp._okcmd(), array['succeeded', 'failed', 'failed', 'failed']);
insert into _msg select 'h06c', pg_temp._chk();
select pg_temp._ck('H06a the last 3 cron runs all failed FAILS, alertable',
  (select m like 'false|true|%the last 3 cron runs of the job all failed%' from _msg where name = 'h06a'), (select m from _msg where name = 'h06a'));
select pg_temp._ck('H06b two failures then a success passes (one bad night is not an outage)',
  (select m like 'true|true|%' from _msg where name = 'h06b'), (select m from _msg where name = 'h06b'));
select pg_temp._ck('H06c only the MOST RECENT three count: a success on top of three old failures passes',
  (select m like 'true|true|%' from _msg where name = 'h06c'), (select m from _msg where name = 'h06c'));
select pg_temp._cron(true, pg_temp._okcmd(), array['succeeded', 'succeeded']);

-- H07 ZIPs in error: any positive count (the national baseline had 0 of 12,722)
insert into public.dev_change_zip_cursor (zip, status, observed_at, last_run_id, error)
values ('91999', 'error', now(), (select run from _ctx where name = 'b'), 'PRIVATE-MARKER 9 Elm St raised here');
insert into public.dev_change_zip_cursor (zip, status, observed_at, last_run_id, error)
values ('91998', 'error', now(), (select run from _ctx where name = 'b'), 'another PRIVATE-MARKER');
select pg_temp._h(1, 'max_zips', 30, 10);
insert into _msg select 'h07a', pg_temp._chk();
select pg_temp._ck('H07a ZIPs in error FAIL, alertable, with the COUNT and the ZIP codes in order',
  (select m like 'false|true|%2 ZIP(s) are in error in the cursor (first: 91998, 91999)%' from _msg where name = 'h07a'), (select m from _msg where name = 'h07a'));
select pg_temp._ck('H07b the alarm NEVER carries an error text: a cursor error containing a marker string appears nowhere in the check or in the health read',
  (select m not like '%PRIVATE-MARKER%' and m not like '%Elm St%' from _msg where name = 'h07a')
  and (select count(*) = 0 from public.dev_change_observation_health() h where h::text like '%PRIVATE-MARKER%' or h::text like '%Elm St%'));
delete from public.dev_change_zip_cursor where zip in ('91998', '91999');
insert into _msg select 'h07c', pg_temp._chk();
select pg_temp._ck('H07c with the ZIPs out of error the check is OK again',
  (select m like 'true|true|%' from _msg where name = 'h07c'), (select m from _msg where name = 'h07c'));

-- H08 UNKNOWN: armed, never run — neither a pass nor an alert
select pg_temp._h0();
select pg_temp._cron(true, pg_temp._okcmd(), array[]::text[]);
insert into _msg select 'h08', pg_temp._chk();
select pg_temp._ck('H08 an armed job that has never run (no tick, no cron run) reports OK and NOT alertable, saying so',
  (select m = 'true|false|job armed; it has not run yet' from _msg where name = 'h08'), (select m from _msg where name = 'h08'));
select pg_temp._cron(true, pg_temp._okcmd(), array['succeeded', 'succeeded']);
insert into _msg select 'h09', pg_temp._chk();
select pg_temp._ck('H09 a job that HAS run (cron says so) but never completed a tick FAILS, alertable',
  (select m like 'false|true|%the job has run 2 time(s) and no tick ever completed%' from _msg where name = 'h09'), (select m from _msg where name = 'h09'));
select pg_temp._jobname('dev-change-observe-gone');
select pg_temp._cron(true, pg_temp._okcmd(), array[]::text[]);
insert into _msg select 'h10', pg_temp._chk();
select pg_temp._jobname('dev-change-observe');
select pg_temp._ck('H10 a MISSING job with no run is not "unknown": it fails, alertable (the unknown state is only for a job that is there)',
  (select m like 'false|true|%is missing%' from _msg where name = 'h10'), (select m from _msg where name = 'h10'));

-- H11 a check that cannot run is a FAILING check, never a dead monitor
select pg_temp._h(2, 'max_zips', 30, 10);
select pg_temp._cron(true, pg_temp._okcmd(), array['succeeded']);
alter function public.dev_change_observation_health() rename to dev_change_observation_health_off;
insert into _msg select 'h11', pg_temp._chk();
alter function public.dev_change_observation_health_off() rename to dev_change_observation_health;
select pg_temp._ck('H11 when the health read cannot run the check reports FAILED with the SQLSTATE only (and the monitor still produced every other row)',
  (select m = 'false|true|the observation check could not run (SQLSTATE 42883) — a check that cannot run is a failing check' from _msg where name = 'h11')
  and (select ok from public.pipeline_health_check where check_name = 'other_check'), (select m from _msg where name = 'h11'));

-- H13 several scheduled runs: the alarm reads the NEWEST tick, the OLDEST first run and the NEWEST completed pass
select pg_temp._h(2, 'max_zips', 30, 5);
insert into public.dev_change_run (baseline, started_at, detail)
values (false, now() - interval '100 hours',
  jsonb_build_object('purpose', 'scheduled', 'day', '2001-01-02', 'ticks', 9,
    'last_tick_at', to_char((now() - interval '50 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'last_tick', jsonb_build_object('stopped_reason', 'ledger_budget'),
    'completed', true, 'completed_at', to_char((now() - interval '50 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
insert into _msg select 'h13', pg_temp._chk();
select pg_temp._ck('H13 with an old run (stopped on the ledger budget, last ticked 50 hours ago) beside a recent healthy one, the alarm follows the NEWEST tick and the NEWEST completed pass and passes',
  (select m like 'true|true|job active; last tick %(max_zips); no error ZIPs' from _msg where name = 'h13'), (select m from _msg where name = 'h13'));
select pg_temp._h0();

-- H12 the health read is counts, times and fixed words
select pg_temp._ck('H12 the health read has exactly the nine documented columns: states and fixed words, times, counts and ZIP codes, no project field and no error text',
  pg_get_function_result('public.dev_change_observation_health()'::regprocedure)
    = 'TABLE(job_state text, last_tick_at timestamp with time zone, last_stop_reason text, first_run_at timestamp with time zone, last_completed_at timestamp with time zone, zips_in_error bigint, error_zips text, cron_runs bigint, cron_recent_failed integer)',
  pg_get_function_result('public.dev_change_observation_health()'::regprocedure));

\o
select check_name, pass, detail from _r order by n;


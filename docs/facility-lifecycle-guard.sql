-- docs/facility-lifecycle-guard.sql
--
-- THE DATABASE REFUSES AN UNSOURCED FACILITY "Operating" (2026-09-24, companion to
-- docs/facility-lifecycle-unknown-migration.sql).
--
-- ── WHY A GUARD AND NOT ONLY A WARNING ───────────────────────────────────────────────
-- Nine committed SQL artifacts still carry the obsolete facility literal
-- `'Operating', coalesce(nullif(el->>'src',''),'Public registry')` inside a full
-- CREATE OR REPLACE of public.app_refresh_zip (site docs/*-migration.sql, a rollback, a live
-- snapshot; ingest supabase/migrations/20260903174900 and docs/app_refresh_zip.live-*.sql).
-- None runs automatically, but every one is replayable by hand — db-sql.yml in either repo
-- runs any committed .sql path on dispatch, and MCP/psql run anything pasted. A replay would
-- silently reinstall facility → Operating. They are dated receipts and are NOT rewritten;
-- the control therefore lives where every replay path ends: the table.
--
-- ── WHAT IT DOES ─────────────────────────────────────────────────────────────────────
-- A row trigger on public.app_projects refuses any INSERT, or any UPDATE that sets status or
-- record_kind, that would produce  record_kind='facility' AND status='Operating'.
--   • It WRITES NOTHING and DECIDES NOTHING — it is a refusal, not a second authority. The
--     materializer remains the only writer and still decides every value.
--   • The facility plane carries NO lifecycle input: EPA FRS states none, and app_refresh_zip's
--     facility insert has no lifecycle source to read. So no legitimate facility row can be
--     Operating today. A future source that genuinely STATES a facility lifecycle must change
--     this guard and the materializer in the same reviewed change — that is the point.
--   • Development rows are untouched (a development 'Operating' is sourced; selftest case D).
--   • Rows already at rest are not validated; the sweep rewrites them (they change to 'On file'
--     on their next refresh, which this guard permits).
--   • Under a replayed obsolete body every facility write raises, so the ZIP's refresh fails
--     into public.app_refresh_failures and pipeline_health_tick's materializer checks — loud,
--     never a silent false row.
--
-- Apply outside the app-content-refresh window (:00/:15/:30/:45 + ~100s). CREATE TRIGGER takes
-- SHARE ROW EXCLUSIVE on app_projects (writers wait, readers do not); lock_timeout bounds it.

set lock_timeout = '5s';

create or replace function public.app_projects_facility_lifecycle_guard()
returns trigger
language plpgsql
as $fn$
begin
  -- The WHEN clause below already narrows to facility + Operating; this re-check keeps the
  -- function correct even if someone attaches it without that clause.
  if new.record_kind = 'facility' and new.status = 'Operating' then
    raise exception using
      errcode = 'P0001',
      message = 'facility_lifecycle_guard: refusing record_kind=facility with status=Operating (zip '
                || coalesce(new.zip, '?') || ', ' || coalesce(new.registry_id, 'no registry_id') || ')',
      detail  = 'EPA FRS states no lifecycle; registration is not operation. The canonical value for a '
                || 'facility with no sourced lifecycle is ''On file'' (Lifecycle unknown). A replay of a '
                || 'dated app_refresh_zip definition is the usual cause — see docs/facility-lifecycle-guard.sql.';
  end if;
  return new;
end
$fn$;

comment on function public.app_projects_facility_lifecycle_guard() is
  'Refuses a facility app_projects row with status Operating: EPA FRS states no lifecycle. Writes nothing. '
  'See docs/facility-lifecycle-guard.sql (homesignal-site).';

drop trigger if exists app_projects_facility_lifecycle_guard_trg on public.app_projects;
create trigger app_projects_facility_lifecycle_guard_trg
  before insert or update of status, record_kind on public.app_projects
  for each row
  when (new.record_kind = 'facility' and new.status = 'Operating')
  execute function public.app_projects_facility_lifecycle_guard();

-- ── SELF-TEST — both directions, nothing persists ────────────────────────────────────
-- Each case runs in its own subtransaction and is rolled back by raising a marker, so the
-- table is never changed. A guard that refused EVERYTHING would fail cases B and D; a guard
-- that refused NOTHING would fail cases A and C.
create or replace function public.facility_lifecycle_guard_selftest()
returns jsonb
language plpgsql
as $st$
declare
  res jsonb := '{}'::jsonb;
  zip0 constant text := '00000';
  src0 constant text := 'https://selftest.invalid/facility-lifecycle-guard';
  -- returns 'refused' | 'accepted' | 'error:<sqlerrm>'
  outcome text;
begin
  -- A. inserting a facility row that says Operating is refused
  begin
    insert into public.app_projects (zip, name, source_ref, record_kind, status)
    values (zip0, 'SELFTEST A', src0, 'facility', 'Operating');
    raise exception using errcode = 'P0002', message = 'selftest-rollback';
  exception when others then
    outcome := case when sqlerrm like 'facility_lifecycle_guard:%' then 'refused'
                    when sqlerrm = 'selftest-rollback' then 'accepted' else 'error:' || sqlerrm end;
  end;
  res := res || jsonb_build_object('A_insert_facility_operating', outcome);

  -- B. inserting a facility row with the canonical unknown value is accepted
  begin
    insert into public.app_projects (zip, name, source_ref, record_kind, status)
    values (zip0, 'SELFTEST B', src0, 'facility', 'On file');
    raise exception using errcode = 'P0002', message = 'selftest-rollback';
  exception when others then
    outcome := case when sqlerrm like 'facility_lifecycle_guard:%' then 'refused'
                    when sqlerrm = 'selftest-rollback' then 'accepted' else 'error:' || sqlerrm end;
  end;
  res := res || jsonb_build_object('B_insert_facility_on_file', outcome);

  -- C. updating a facility row INTO Operating is refused
  begin
    insert into public.app_projects (zip, name, source_ref, record_kind, status)
    values (zip0, 'SELFTEST C', src0, 'facility', 'On file');
    update public.app_projects set status = 'Operating'
     where zip = zip0 and name = 'SELFTEST C' and source_ref = src0;
    raise exception using errcode = 'P0002', message = 'selftest-rollback';
  exception when others then
    outcome := case when sqlerrm like 'facility_lifecycle_guard:%' then 'refused'
                    when sqlerrm = 'selftest-rollback' then 'accepted' else 'error:' || sqlerrm end;
  end;
  res := res || jsonb_build_object('C_update_facility_into_operating', outcome);

  -- D. POSITIVE CONTROL: a development row that says Operating is accepted
  begin
    insert into public.app_projects (zip, name, source_ref, record_kind, status)
    values (zip0, 'SELFTEST D', src0, 'development', 'Operating');
    raise exception using errcode = 'P0002', message = 'selftest-rollback';
  exception when others then
    outcome := case when sqlerrm like 'facility_lifecycle_guard:%' then 'refused'
                    when sqlerrm = 'selftest-rollback' then 'accepted' else 'error:' || sqlerrm end;
  end;
  res := res || jsonb_build_object('D_insert_development_operating', outcome);

  res := res || jsonb_build_object('pass',
    res->>'A_insert_facility_operating' = 'refused'
    and res->>'B_insert_facility_on_file' = 'accepted'
    and res->>'C_update_facility_into_operating' = 'refused'
    and res->>'D_insert_development_operating' = 'accepted');
  return res;
end
$st$;

revoke all on function public.facility_lifecycle_guard_selftest() from public, anon, authenticated;
revoke all on function public.app_projects_facility_lifecycle_guard() from public, anon, authenticated;

-- Fail the apply unless the guard demonstrably works in both directions.
do $v$
declare r jsonb := public.facility_lifecycle_guard_selftest();
begin
  if not coalesce((r->>'pass')::boolean, false) then
    raise exception 'facility lifecycle guard selftest failed: %', r;
  end if;
  raise notice 'facility lifecycle guard selftest: %', r;
end
$v$;

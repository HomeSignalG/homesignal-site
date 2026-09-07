-- ============================================================================
-- PHASE 1A — the EPA recovery path may no longer CONTROL the core refresh cron.
-- Migration `epa_decouple_phase1a_core_cron_switch`, applied to qwnnmljucajnexpxdgxr
-- on 2026-09-07. Parked here per CLAUDE.md §1 row 3 so the schema stays reproducible.
--
-- WHAT WAS WRONG
-- --------------
-- `epa_recovery_proof_check()` paused the pg_cron job `dev-reports-rolling-refresh`
-- (jobid 14, */2 * * * *, the NATIONAL core project refresh) whenever a single ZIP's
-- EPA FACILITY count came back short:
--
--     if not _pass then
--       -- FAILURE IS NOT A RETRY CONDITION. Put the refresh back to sleep and stop.
--       perform cron.alter_job((select jobid from cron.job
--                                where jobname='dev-reports-rolling-refresh'),
--                              active := false);
--     end if;
--
-- and `epa_recovery_step2()` refused to resume that job until EPA was healthy. One ZIP's
-- regulatory count was therefore the gate on the entire core project plane, in both
-- directions — 12,722 ZIP pages whose first-party permit and planning sources have
-- nothing to do with EPA.
--
-- WHAT IS KEPT
-- ------------
-- All EPA-only recovery work is intact and deliberately so:
--   * step2 still refuses to fire the 82801 proof while EPA is failing (EPA gating
--     EPA-only work is the coupling that SHOULD exist);
--   * the proof still runs and its verdict is still written to epa_recovery_runs;
--   * epa_recovery_repair() still raises without a passed proof row, so a failed proof
--     still stops the EPA repair dead.
-- Only the two job-mutating statements are gone.
--
-- WHAT IS DELIBERATELY LEFT ALONE
-- -------------------------------
-- `epa_recovery_probe_state()` READS `cron.job.active` for its status report. Reading is
-- not controlling, so it stays. The invariant below is scoped to the MUTATING verbs
-- (alter_job / cron.schedule / cron.unschedule) rather than banning the string "cron",
-- so it remains a real check instead of a spelling rule.
-- ============================================================================

-- ── guard: refuse to apply against anything but the pre-fix bodies ───────────
do $g$
declare a text; b text;
begin
  select pg_get_functiondef(p.oid) into a from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='epa_recovery_proof_check';
  select pg_get_functiondef(p.oid) into b from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='epa_recovery_step2';
  if a is null or b is null then raise exception 'epa_recovery_* not found'; end if;
  if position('alter_job' in a) = 0 or position('alter_job' in b) = 0 then
    raise exception 'expected the pre-fix bodies (both should still mutate the job); refusing';
  end if;
end $g$;

create or replace function public.epa_recovery_proof_check(_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
declare r record; _after int; _want int; _pass boolean;
begin
  perform public.epa_recovery_auth(_token);
  select * into r from public.epa_recovery_runs where phase='proof_fired' order by id desc limit 1;
  if r is null then raise exception 'no proof has been fired'; end if;

  select (resp.content::jsonb->'counts'->>'facilities')::int into _after
    from net._http_response resp where resp.id = r.request_id and resp.status_code = 200;
  if _after is null then
    return jsonb_build_object('proof_pending', true, 'request_id', r.request_id);
  end if;

  select expected_82801_facilities into _want from public.epa_recovery_config where id=1;
  _pass := _after >= _want;   -- >= : FRS may legitimately have gained facilities since 08-08

  insert into public.epa_recovery_runs (phase, proof_passed, facilities_before, facilities_after,
                                        request_id, detail)
  values ('proof_checked', _pass, r.facilities_before, _after, r.request_id,
          jsonb_build_object('expected_at_least', _want));

  -- PHASE 1A. FAILURE IS STILL NOT A RETRY CONDITION — the failed verdict is recorded above
  -- and epa_recovery_repair() raises without a passed proof, so the EPA repair still stops
  -- dead. What no longer happens is putting the CORE project refresh to sleep: that job
  -- serves first-party permit and planning sources that have nothing to do with EPA, and
  -- pausing it here stopped ~12,700 ZIP pages from refreshing on a regulatory signal.
  return jsonb_build_object('proof_pending', false, 'proof_passed', _pass,
                            'facilities_before', r.facilities_before, 'facilities_after', _after,
                            'expected_at_least', _want,
                            'core_refresh_untouched', true);
end $function$;

create or replace function public.epa_recovery_step2(_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
declare _ok boolean; _before int; _rid bigint;
begin
  perform public.epa_recovery_auth(_token);
  select coalesce(ok,false) into _ok from public.epa_frs_probes
   where resolved_at is not null order by id desc limit 1;
  -- KEPT ON PURPOSE: this gates EPA-ONLY work (firing the EPA proof) on EPA health, which is
  -- exactly the kind of coupling that should exist. Phase 1A removes cross-plane control, not
  -- EPA's control over itself.
  if not _ok then
    raise exception 'EPA has not recovered on the latest resolved probe — refusing to start step 2';
  end if;

  -- PHASE 1A. The core refresh is no longer paused by the proof path, so there is nothing
  -- here to un-pause. Core scheduling is owned solely by whoever administers that job.

  select (counts->>'facilities')::int into _before from public.development_reports where zip='82801';
  select net.http_post(
    'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
    (select jsonb_build_object('zip', zip, 'lat', home_lat, 'lng', home_lng)
       from public.development_reports where zip='82801'),
    '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 180000) into _rid;

  insert into public.epa_recovery_runs (phase, facilities_before, request_id)
  values ('proof_fired', _before, _rid);
  return jsonb_build_object('fired', true, 'proof_pending', true,
                            'facilities_before', _before, 'request_id', _rid,
                            'core_refresh_untouched', true);
end $function$;

-- ── proof: no epa_* function can mutate ANY cron job any more ────────────────
do $v$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'epa\_%'
     and pg_get_functiondef(p.oid) ~* '(alter_job|cron\.schedule|cron\.unschedule)';
  if bad is not null then
    raise exception 'PHASE 1A FAILED: epa_* function(s) can still mutate a cron job: %', bad;
  end if;
end $v$;

-- ── verified after apply, 2026-09-07 ────────────────────────────────────────
--   epa_* functions able to mutate a cron job: 0  (was 2)
--   cron.job 'dev-reports-rolling-refresh': jobid 14, */2 * * * *, active = true
--   The first apply attempt FAILED this very assertion (it reported 3) because the
--   replacement comments quoted the removed statements verbatim. That is the check
--   working; the comments were reworded and the invariant narrowed to the mutating
--   verbs so it discriminates control from documentation.

-- =====================================================================================
-- STEP 13 (C9): CLOSE THE MAP 1 MARKER-LOSS WINDOW.
--
-- THE MECHANISM (measured 2026-09-27): an acquisition's own commit makes its run CURRENT
-- (dc_mark_run_advanced fires on the observation insert inside dc_complete_acquisition), but its
-- observations are linked to canonical entities only by dc_resolve_canonical, hourly at :25.
-- Map 1 draws an entity only through a link to a CURRENT observation, so between the two every
-- canonical marker disappears: 971 -> 1 on 2026-09-27, 14:49:52 -> 15:25:19 (35.5 min; up to
-- ~60 min when an acquisition lands just after :25).
--
-- WHY NOT RESOLVE INSIDE THE ACQUISITION (atomic, zero window): acquisitions complete through
-- PostgREST (dc_evidence_writer.py -> rpc/dc_complete_acquisition), which runs under the
-- authenticator's statement_timeout of 8 s. The resolvers take 10 s avg / 39 s max (canonical) and
-- 46 s / 116 s (geography) over the last 7 days, so every acquisition would time out and roll back.
-- WHY NOT DELAY "CURRENT" UNTIL LINKED: dc_resolve_canonical itself selects dc_current_observation,
-- so it would never see the new run.
--
-- THE FIX: the SAME canonical resolver, run as soon as a new run is seen instead of at :25.
--   dc_resolve_on_acquisition()  every 2 minutes. If some CURRENT run has not one linked
--                                observation (true only between an acquisition and its first
--                                resolve; measured 0 today across 2,880 current observations),
--                                run dc_resolve_canonical. Otherwise one cheap read.
--   dc_resolve_serialized(kind)  the hourly jobs now go through one advisory lock, and so does the
--                                watcher, because neither resolver guards against a concurrent run
--                                and the watcher makes overlap possible. The watcher never waits:
--                                if the lock is held, a resolve is already running.
-- Worst-case window: 2 min detection + 39 s resolve (was ~60 min). Every 2 minutes, not every
-- minute: cron.job_run_details has no purge job (37,741 rows since 2026-07-03, ~1,103/day) and
-- the existing */2 job sets the precedent.
--
-- Decides nothing: no resolver, reader, rule or pin changes. Map 1 needs only the canonical link
-- (an entity's resolved geography persists across runs), so geography stays hourly.
-- Service-role only. Idempotent. Refuses if the two resolver jobs are not exactly as expected.
-- =====================================================================================

create or replace function public.dc_resolve_serialized(p_resolver text)
returns bigint
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  n bigint;
begin
  if p_resolver is distinct from 'canonical' and p_resolver is distinct from 'geography' then
    raise exception 'dc_resolve_serialized: unknown resolver %, expected canonical or geography', p_resolver;
  end if;
  -- one lock for every resolver run, held to the end of this transaction
  perform pg_advisory_xact_lock(hashtextextended('dc-resolvers', 0));
  if p_resolver = 'canonical' then
    select count(*) into n from public.dc_resolve_canonical(true, false);
  else
    select count(*) into n from public.dc_resolve_geography(true);
  end if;
  return n;
end
$fn$;
revoke all on function public.dc_resolve_serialized(text) from public, anon, authenticated;

create or replace function public.dc_resolve_on_acquisition()
returns text
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_runs text;
  n      bigint;
begin
  -- a CURRENT run with not one linked observation = acquired, not yet resolved
  select string_agg(r.source_key || '/' || r.distribution_key || ' #' || r.run_seq, ', '
                    order by r.source_key collate "C", r.distribution_key collate "C")
    into v_runs
    from public.dc_acquisition_run r
   where r.id in (select c.acquisition_run_id from public.dc_current_observation c)
     and not exists (select 1
                       from public.dc_current_observation c
                       join public.dc_entity_observation eo
                         on eo.home_signal_observation_id = c.home_signal_observation_id
                      where c.acquisition_run_id = r.id);
  if v_runs is null then
    return 'nothing to resolve';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('dc-resolvers', 0)) then
    return 'busy: a resolver holds the lock (unresolved: ' || v_runs || ')';
  end if;
  select count(*) into n from public.dc_resolve_canonical(true, false);
  return 'resolved ' || v_runs || ' (' || n || ' rows)';
end
$fn$;
revoke all on function public.dc_resolve_on_acquisition() from public, anon, authenticated;

-- ── the jobs (pg_cron; skipped where pg_cron is absent) ─────────────────────────────────────────
do $cron$
declare
  v_canon text;
  v_geo   text;
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron not installed here — jobs not scheduled';
    return;
  end if;
  select command into v_canon from cron.job where jobname = 'dc-resolve-canonical';
  select command into v_geo   from cron.job where jobname = 'dc-resolve-geography';
  -- DRIFT GUARD: only the two commands measured on 2026-09-27, or this migration's own (re-apply)
  if v_canon is distinct from 'select count(*) from public.dc_resolve_canonical(true, false)'
     and v_canon is distinct from $c$select public.dc_resolve_serialized('canonical')$c$ then
    raise exception 'DRIFT: dc-resolve-canonical runs %, not the expected command — refusing', coalesce(v_canon, '(no job)');
  end if;
  if v_geo is distinct from 'select count(*) from public.dc_resolve_geography(true)'
     and v_geo is distinct from $c$select public.dc_resolve_serialized('geography')$c$ then
    raise exception 'DRIFT: dc-resolve-geography runs %, not the expected command — refusing', coalesce(v_geo, '(no job)');
  end if;

  perform cron.unschedule(j.jobid) from cron.job j
   where j.jobname in ('dc-resolve-canonical', 'dc-resolve-geography', 'dc-resolve-on-acquisition');
  perform cron.schedule('dc-resolve-canonical', '25 * * * *', $c$select public.dc_resolve_serialized('canonical')$c$);
  perform cron.schedule('dc-resolve-geography', '35 * * * *', $c$select public.dc_resolve_serialized('geography')$c$);
  perform cron.schedule('dc-resolve-on-acquisition', '*/2 * * * *', 'select public.dc_resolve_on_acquisition()');
end
$cron$;

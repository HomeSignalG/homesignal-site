-- =====================================================================================
-- RESOLVER HARDENING (2026-09-29) — the three gaps step 13 recorded and did not fix.
--
-- 1. NOBODY WATCHED THE RESOLVER JOBS. dc-resolve-geography was cancelled by the 120 s statement timeout at
--    2026-09-28 20:35 and no check noticed. This adds check 'dc_resolvers' to the ONE monitor
--    (public.pipeline_health_tick, hourly at :10 -> notify-health), spliced the same way steps 12/13 did.
--    It reads pg_cron's own run history for the three resolver jobs and FAILS when:
--      quiet     a job has no successful run inside its limit:
--                  dc-resolve-canonical / dc-resolve-geography (hourly)  3 h   = two missed hours. ONE failed run
--                    is deliberately not an alert: measured 2026-09-28, the cancelled 20:35 geography run cost one
--                    skipped hour and left every entity placed (placements persist across runs).
--                  dc-resolve-on-acquisition (every 2 min)  10 min  = five missed runs. This job is what closes
--                    the Map 1 marker-loss window, so it is watched far tighter than the hourly pair.
--      slow      a successful run in the last 24 h took more than 2/3 of its statement limit: 80 s of 120 s for
--                the canonical resolver and the watcher, 200 s of 300 s for geography. Measured 2026-09-28:
--                geography 101-108 s (avg 102.4) against 120 s; canonical max 33 s; watcher max 22.4 s.
--      missing   a job is absent from cron.job, or disabled
--      open      anon or authenticated can execute a resolver or its wrapper (see 3.)
--    Not a pass when it cannot see: an absent job or an empty history FAILS, never reads as healthy.
-- 2. THE GEOGRAPHY 120 s LIMIT. Its ceiling is raised to 300 s by docs/dc-marker-loss-watcher.sql (the file of
--    record for the job), as a SEPARATE STATEMENT ahead of the call. Measured on pg_cron 1.6 / Postgres 16 under a
--    2 s limit: "set statement_timeout = ...; select fn()" completes; a SET LOCAL inside the function, and a
--    function-level SET clause, are both still cancelled at 2 s — a SET inside a running statement re-arms
--    nothing. The same defect was in step 12's snapshot and is corrected in docs/dc-address-check-monitor.sql.
--    Re-apply order: dc-marker-loss-watcher.sql, dc-address-check-monitor.sql, then this file.
-- 3. dc_resolve_canonical / dc_resolve_geography were executable by anon, authenticated and PUBLIC, so anyone
--    holding the public site key could run an identity resolve through /rest/v1/rpc/. Revoked from those
--    roles BY NAME (a revoke from PUBLIC alone is not a lock on Supabase: default privileges grant EXECUTE to
--    anon and authenticated directly). postgres (the cron user) and service_role keep it. All or nothing: the
--    migration refuses, undoing the revoke, if any pg_cron job that names a resolver would lose the ability to
--    run it.
--
-- Decides nothing about any marker: no resolver, reader, rule or pin changes.
-- Idempotent. Service-role only.
-- =====================================================================================

revoke all on function public.dc_resolve_canonical(boolean, boolean) from public, anon, authenticated;
revoke all on function public.dc_resolve_geography(boolean) from public, anon, authenticated;

do $guard$
declare
  j record;
begin
  if to_regnamespace('cron') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'cron' and table_name = 'job' and column_name = 'username') then
    raise notice 'pg_cron job table not readable here — job/owner guard skipped';
    return;
  end if;
  for j in select jobname, username, command from cron.job where command ~ 'dc_resolve' loop
    if not (has_function_privilege(j.username, 'public.dc_resolve_canonical(boolean, boolean)', 'execute')
        and has_function_privilege(j.username, 'public.dc_resolve_geography(boolean)', 'execute')) then
      raise exception 'job % runs as % which would lose EXECUTE on a resolver — refusing (revoke rolled back)',
        j.jobname, j.username;
    end if;
  end loop;
end
$guard$;

-- ── the check, spliced into the one monitor (read live definition, one anchor, fail closed, re-read) ──
do $mig$
declare
  _def    text;
  _anchor text := 'insert into public.pipeline_health_check as c (';
  _block  text := $blk$
  -- DC RESOLVERS (hardening, 2026-09-29). Reads pg_cron's run history for the three resolver jobs and the
  -- grants on the four resolver functions; see docs/dc-resolver-hardening.sql for every threshold's source.
  insert into _eval
  select 'dc_resolvers',
         (q.problems = ''),
         true,
         case when q.problems <> '' then q.problems
              else 'resolver jobs healthy — ' || q.summary || '; anon/authenticated cannot run any resolver' end
    from (
      select
        (select concat_ws('; ',
           (select string_agg(
              case when p.jobid is null then 'job ' || p.jobname || ' is not scheduled'
                   when not p.active then 'job ' || p.jobname || ' is disabled'
                   when p.last_ok is null or p.last_ok < _now - p.max_quiet
                     then p.jobname || ' has no successful run since '
                          || coalesce(to_char(p.last_ok, 'YYYY-MM-DD HH24:MI') || ' UTC', 'ever')
                          || ' (limit ' || p.max_quiet || ')'
                   when p.slowest_s > p.warn_s
                     then p.jobname || ' slowest run in 24h took ' || round(p.slowest_s) || ' s, past '
                          || p.warn_s || ' s (2/3 of its ' || p.limit_s || ' s limit)'
              end, '; ' order by p.jobname)
              from (
                select s.jobname, s.max_quiet, s.limit_s, (s.limit_s * 2 / 3) as warn_s,
                       j.jobid, coalesce(j.active, false) as active,
                       (select max(d.end_time) from cron.job_run_details d
                         where d.jobid = j.jobid and d.status = 'succeeded') as last_ok,
                       (select max(extract(epoch from d.end_time - d.start_time)) from cron.job_run_details d
                         where d.jobid = j.jobid and d.status = 'succeeded'
                           and d.start_time > _now - interval '24 hours') as slowest_s
                  from (values ('dc-resolve-canonical',      interval '3 hours',    120),
                               ('dc-resolve-geography',      interval '3 hours',    300),
                               ('dc-resolve-on-acquisition', interval '10 minutes', 120)) s(jobname, max_quiet, limit_s)
                  left join cron.job j on j.jobname = s.jobname
              ) p),
           (select string_agg(r.rolname || ' can run ' || f.fname, '; ' order by f.fname, r.rolname)
              from (values ('public.dc_resolve_canonical(boolean, boolean)'), ('public.dc_resolve_geography(boolean)'),
                           ('public.dc_resolve_serialized(text)'), ('public.dc_resolve_on_acquisition()')) f(fname)
              cross join (values ('anon'), ('authenticated')) r(rolname)
             where to_regrole(r.rolname) is null
                or has_function_privilege(r.rolname, f.fname, 'execute'))
         )) as problems,
        (select string_agg(x.jobname || ' ok ' || to_char(x.last_ok, 'HH24:MI') || 'Z slowest '
                           || coalesce(round(x.slowest_s)::text, '-') || 's', ', ' order by x.jobname)
           from (select j.jobname,
                        (select max(d.end_time) from cron.job_run_details d
                          where d.jobid = j.jobid and d.status = 'succeeded') as last_ok,
                        (select max(extract(epoch from d.end_time - d.start_time)) from cron.job_run_details d
                          where d.jobid = j.jobid and d.status = 'succeeded'
                            and d.start_time > _now - interval '24 hours') as slowest_s
                   from cron.job j
                  where j.jobname in ('dc-resolve-canonical', 'dc-resolve-geography', 'dc-resolve-on-acquisition')) x) as summary
    ) q;

$blk$;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
  if _def is null then
    raise exception 'public.pipeline_health_tick() not found — refusing to splice';
  end if;
  if position($m$'dc_resolvers',$m$ in _def) > 0 then
    raise notice 'dc_resolvers already present — nothing to do';
    return;
  end if;
  if (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor) <> 1 then
    raise exception 'anchor % appears % time(s), expected exactly 1 — refusing to splice',
      _anchor, (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor);
  end if;

  execute replace(_def, _anchor, _block || '  ' || _anchor);

  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
  if (length(_def) - length(replace(_def, $m$'dc_resolvers',$m$, ''))) / length($m$'dc_resolvers',$m$) <> 1
     or (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor) <> 1 then
    raise exception 'splice did not take — dc_resolvers must appear once and the anchor once';
  end if;
  raise notice 'dc_resolvers spliced into pipeline_health_tick()';
end
$mig$;

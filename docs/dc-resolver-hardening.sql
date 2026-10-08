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
--    History is matched on the job's id OR on the command it ran, over the last 7 days (v2): cron.schedule()
--    issues a NEW jobid on every reschedule, and v1's jobid-only match false-alarmed on the first tick after
--    the resolver jobs were rescheduled to carry the 300 s ceiling.
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
-- v2 (2026-09-29, same day as v1). v1 matched a job's run history on its jobid, and cron.schedule() gives a
-- job a NEW jobid every time it is rescheduled — so the moment the resolver jobs were rescheduled to apply the
-- 300 s ceiling, v1 saw zero history for two jobs that had 164 runs and alerted "no successful run since ever"
-- at the first tick. History is now matched on the job's id OR on the command text it ran (the resolver it
-- names), bounded to the last 7 days, so a reschedule cannot erase it. The splice below UPGRADES a v1 block in
-- place, and refuses if anything else was spliced after it.
do $mig$
declare
  _def    text;
  _new    text;
  _anchor text := 'insert into public.pipeline_health_check as c (';
  _mark1  text := '  -- DC RESOLVERS (hardening, 2026-09-29).';
  _mark2  text := '  -- DC RESOLVERS (v2, 2026-09-29).';
  _p1     int;
  _pa     int;
  _seg    text;
  _block  text := $blk$
  -- DC RESOLVERS (v2, 2026-09-29). Reads pg_cron's run history for the three resolver jobs (matched by job id OR
  -- by the command they ran, so a reschedule cannot erase it) and the grants on the four resolver functions; see
  -- docs/dc-resolver-hardening.sql for every threshold's source.
  insert into _eval
  with per as (
    select s.jobname, s.max_quiet, s.limit_s, (s.limit_s * 2 / 3) as warn_s,
           j.jobid, coalesce(j.active, false) as active, h.last_ok, h.slowest_s
      from (values ('dc-resolve-canonical',      interval '3 hours',    120,
                    'dc_resolve_canonical|dc_resolve_serialized\(.canonical.\)'),
                   ('dc-resolve-geography',      interval '3 hours',    300,
                    'dc_resolve_geography|dc_resolve_serialized\(.geography.\)'),
                   ('dc-resolve-on-acquisition', interval '10 minutes', 120,
                    'dc_resolve_on_acquisition')) s(jobname, max_quiet, limit_s, cmd_re)
      left join cron.job j on j.jobname = s.jobname
      left join lateral (
        select max(d.end_time) filter (where d.status = 'succeeded') as last_ok,
               max(extract(epoch from d.end_time - d.start_time))
                 filter (where d.status = 'succeeded' and d.start_time > _now - interval '24 hours') as slowest_s
          from cron.job_run_details d
         where d.start_time > _now - interval '7 days'
           and (d.jobid = j.jobid or d.command ~ s.cmd_re)) h on true
  )
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
                     then p.jobname || ' has no successful run '
                          || coalesce('since ' || to_char(p.last_ok, 'YYYY-MM-DD HH24:MI') || ' UTC', 'in the last 7 days')
                          || ' (limit ' || p.max_quiet || ')'
                   when p.slowest_s > p.warn_s
                     then p.jobname || ' slowest run in 24h took ' || round(p.slowest_s) || ' s, past '
                          || p.warn_s || ' s (2/3 of its ' || p.limit_s || ' s limit)'
              end, '; ' order by p.jobname)
              from per p),
           (select string_agg(r.rolname || ' can run ' || f.fname, '; ' order by f.fname, r.rolname)
              from (values ('public.dc_resolve_canonical(boolean, boolean)'), ('public.dc_resolve_geography(boolean)'),
                           ('public.dc_resolve_serialized(text)'), ('public.dc_resolve_on_acquisition()')) f(fname)
              cross join (values ('anon'), ('authenticated')) r(rolname)
             where to_regrole(r.rolname) is null
                or has_function_privilege(r.rolname, f.fname, 'execute'))
         )) as problems,
        (select string_agg(p.jobname || ' ok ' || to_char(p.last_ok, 'HH24:MI') || 'Z slowest '
                           || coalesce(round(p.slowest_s)::text, '-') || 's', ', ' order by p.jobname)
           from per p) as summary
    ) q;

$blk$;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
  if _def is null then
    raise exception 'public.pipeline_health_tick() not found — refusing to splice';
  end if;
  if position(_mark2 in _def) > 0 then
    raise notice 'dc_resolvers v2 already present — nothing to do';
    return;
  end if;
  if (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor) <> 1 then
    raise exception 'anchor % appears % time(s), expected exactly 1 — refusing to splice',
      _anchor, (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor);
  end if;

  _p1 := position(_mark1 in _def);
  if _p1 > 0 then
    -- UPGRADE a v1 block in place. v1 was spliced immediately before the anchor; refuse if anything else was
    -- spliced after it (the segment from v1's first line to the anchor must hold exactly ONE _eval insert).
    if (length(_def) - length(replace(_def, _mark1, ''))) / length(_mark1) <> 1 then
      raise exception 'the v1 dc_resolvers block appears more than once — refusing to upgrade';
    end if;
    _pa := position(_anchor in _def);
    if _pa < _p1 then
      raise exception 'the anchor sits before the v1 dc_resolvers block — refusing to upgrade';
    end if;
    _seg := substr(_def, _p1, _pa - _p1);
    if (length(_seg) - length(replace(_seg, 'insert into _eval', ''))) / length('insert into _eval') <> 1 then
      raise exception 'something else sits between the v1 dc_resolvers block and the anchor — refusing to upgrade';
    end if;
    _new := left(_def, _p1 - 1) || substr(_block, 2) || '  ' || substr(_def, _pa);
  else
    _new := replace(_def, _anchor, _block || '  ' || _anchor);
  end if;

  execute _new;

  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
  if (length(_def) - length(replace(_def, $m$'dc_resolvers',$m$, ''))) / length($m$'dc_resolvers',$m$) <> 1
     or (length(_def) - length(replace(_def, _mark2, ''))) / length(_mark2) <> 1
     or position(_mark1 in _def) > 0
     or (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor) <> 1 then
    raise exception 'splice did not take — dc_resolvers v2 must appear once, v1 not at all, and the anchor once';
  end if;
  raise notice 'dc_resolvers v2 spliced into pipeline_health_tick()';
end
$mig$;

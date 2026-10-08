-- =====================================================================================
-- STEP 12 (C8): THE DAILY DATA-CENTRE ADDRESS-CHECK MONITOR — coverage, queue backlog, admission drift.
--
-- Rides the ONE existing alert path (public.pipeline_health_tick, pg_cron hourly at :10 -> notify-health),
-- the same way docs/app-refresh-sweep-migration.sql does. No second monitor, no second mailer.
--
-- 1. public.dc_address_check_daily — one row per day, taken by pg_cron job dc-address-check-snapshot at
--    11:50 UTC. It walks public.dc_map1_address_check ONCE (measured 36.8 s over 12,722 ZIP pages, too heavy
--    for the hourly tick). 11:50 is after the 10:45 geocode run and the 11:25/11:35 resolvers, and outside
--    every measured acquisition window (Atlas/Epoch land 13:35-15:11 UTC daily, 2026-09-22..27), so a
--    snapshot never lands inside the marker-loss window step 13 measured.
-- 2. check 'dc_address_check', spliced into pipeline_health_tick. It reads only the two newest snapshots
--    and FAILS when any of these holds:
--      stale      the newest snapshot is older than 26h (pg_cron is punctual; one missed run pages)
--      invariant  a marker carries NO_CHECK_ROW or ACCEPTED_NOT_JUDGED — structurally 0 (measured 0 of
--                 1,817): the check pipeline itself broke
--      backlog    the geocode queue was non-empty at BOTH snapshots and nothing was geocoded for 30h
--                 (daily run at 10:45 via GitHub schedule; measured lateness up to 195 min — 30h clears it)
--      coverage   markers or CHECKED fell more than 5% since the previous snapshot. The largest recorded
--                 legitimate drop is Atlas admission, 1,814 -> 1,790 (1.3%); a 5% floor is ~4x that
--      drift      the admitted set, or the fingerprint of any shared decision function, changed.
--                 A gated apply is a legitimate change: it pages ONCE and recovers at the next snapshot.
--    Not alertable until the first snapshot exists (no evidence is not a failure, nor a pass).
--
-- Labels only, like the view it reads: it re-decides nothing about any marker.
-- Service-role only. Idempotent: re-running changes nothing.
-- =====================================================================================

create table if not exists public.dc_address_check_daily (
  taken_at           timestamptz primary key,
  markers            int     not null,
  canonical          int     not null,
  openstreetmap      int     not null,
  checked            int     not null,
  no_clean_match     int     not null,
  not_checkable      int     not null,
  pending            int     not null,
  invariant_breaks   int     not null,
  by_reason          jsonb   not null,
  queue_n            int     not null,
  newest_geocode_at  timestamptz,
  admitted           text    not null,
  decision_defs      jsonb   not null,
  secs               numeric not null
);
alter table public.dc_address_check_daily enable row level security;
revoke all on public.dc_address_check_daily from anon, authenticated;

create or replace function public.dc_address_check_snapshot()
returns public.dc_address_check_daily
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  t0 timestamptz := clock_timestamp();
  r  public.dc_address_check_daily;
begin
  with s as materialized (select layer, check_state, reason_code from public.dc_map1_address_check)
  insert into public.dc_address_check_daily
  select now(),
         count(*),
         count(*) filter (where layer = 'canonical'),
         count(*) filter (where layer = 'openstreetmap'),
         count(*) filter (where check_state = 'CHECKED'),
         count(*) filter (where check_state = 'CHECKABLE_NO_CLEAN_MATCH'),
         count(*) filter (where check_state = 'NOT_CHECKABLE'),
         count(*) filter (where check_state = 'PENDING'),
         count(*) filter (where reason_code in ('NO_CHECK_ROW', 'ACCEPTED_NOT_JUDGED')),
         coalesce((select jsonb_object_agg(k, n) from (
                     select layer || '|' || check_state || '|' || reason_code as k, count(*) as n
                       from s group by 1) x), '{}'::jsonb),
         (select count(*) from public.dc_geocode_queue),
         (select max(derived_at) from public.dc_address_geocode),
         coalesce((select string_agg(distinct a.source_key || '/' || a.distribution_key || '='
                                     || public.dc_derived_address_admitted(a.source_key, a.distribution_key)::text,
                                     ' ' order by a.source_key || '/' || a.distribution_key || '='
                                     || public.dc_derived_address_admitted(a.source_key, a.distribution_key)::text)
                     from public.dc_acquisition_run a), ''),
         (select jsonb_object_agg(f.name, coalesce(
                   (select md5(p.prosrc) from pg_proc p
                     where p.pronamespace = 'public'::regnamespace and p.proname = f.name), 'MISSING'))
            from unnest(array['dc_derived_address_admitted', 'dc_derived_point_verdict', 'dc_geocodable_site_address',
                              'dc_geocode_input', 'dc_resolve_canonical', 'dc_resolve_geography',
                              'map1_dc_zip_members']) as f(name)),
         round(extract(epoch from clock_timestamp() - t0)::numeric, 1)
    from s
  returning * into r;
  return r;
end
$fn$;
revoke all on function public.dc_address_check_snapshot() from public, anon, authenticated;

comment on table public.dc_address_check_daily is
'STEP 12 (C8). One row per daily snapshot of public.dc_map1_address_check (pg_cron dc-address-check-snapshot,
11:50 UTC), read by the dc_address_check row of pipeline_health_tick. Service-role only.';

-- ── the daily job (pg_cron; skipped where pg_cron is absent, e.g. a disposable stand-in) ──────────────
do $cron$
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron not installed here — snapshot job not scheduled';
    return;
  end if;
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'dc-address-check-snapshot';
  -- The 300 s ceiling is a SEPARATE STATEMENT in front of the call. A SET inside the function (or a function
  -- SET clause) does not re-arm the timer of the statement already running: measured on pg_cron 1.6 / Postgres
  -- 16 under a 2 s limit, only "set statement_timeout = ...; select fn()" completed (test/dc_resolver_hardening_pg).
  perform cron.schedule('dc-address-check-snapshot', '50 11 * * *',
                        $c$set statement_timeout = '300s'; select public.dc_address_check_snapshot()$c$);
end
$cron$;

-- ── the check, spliced into the one monitor (read live definition, one anchor, fail closed, re-read) ──
do $mig$
declare
  _def    text;
  _anchor text := 'insert into public.pipeline_health_check as c (';
  _block  text := $blk$
  -- DC ADDRESS CHECK (step 12, C8). Reads only the two newest daily snapshots of
  -- public.dc_map1_address_check; see docs/dc-address-check-monitor.sql for every threshold's source.
  insert into _eval
  select 'dc_address_check',
         (l.taken_at is null or q.problems = ''),
         (l.taken_at is not null),
         case when l.taken_at is null
              then 'UNMEASURED: no dc_address_check_daily snapshot yet (pg_cron dc-address-check-snapshot, 11:50 UTC)'
              when q.problems <> '' then q.problems
              else 'snapshot ' || to_char(l.taken_at, 'YYYY-MM-DD HH24:MI') || ' UTC: ' || l.markers || ' markers ('
                   || l.canonical || ' canonical, ' || l.openstreetmap || ' OSM); ' || l.checked || ' checked, '
                   || l.no_clean_match || ' no clean match, ' || l.not_checkable || ' not checkable, '
                   || l.pending || ' pending; coverage '
                   || coalesce(round(100.0 * l.checked / nullif(l.checked + l.no_clean_match + l.pending, 0), 1)::text, '-')
                   || '%; queue ' || l.queue_n
                   || case when p.taken_at is null then '; baseline (no previous snapshot)'
                           else '; definitions and admission unchanged' end end
    from (select 1) one
    left join lateral (select * from public.dc_address_check_daily order by taken_at desc limit 1) l on true
    left join lateral (select * from public.dc_address_check_daily order by taken_at desc offset 1 limit 1) p on true
    cross join lateral (select concat_ws('; ',
      case when l.taken_at < _now - interval '26 hours'
           then 'newest snapshot ' || to_char(l.taken_at, 'YYYY-MM-DD HH24:MI') || ' UTC is '
                || round((extract(epoch from _now - l.taken_at) / 3600.0)::numeric, 1)
                || 'h old — pg_cron dc-address-check-snapshot is not running' end,
      case when l.invariant_breaks > 0
           then l.invariant_breaks || ' marker(s) carry NO_CHECK_ROW / ACCEPTED_NOT_JUDGED — the address-check pipeline broke' end,
      case when l.queue_n > 0 and p.queue_n > 0
                and coalesce(l.newest_geocode_at, '-infinity'::timestamptz) < l.taken_at - interval '30 hours'
           then 'geocode queue ' || p.queue_n || ' -> ' || l.queue_n || ' with nothing geocoded since '
                || coalesce(to_char(l.newest_geocode_at, 'YYYY-MM-DD HH24:MI') || ' UTC', 'ever')
                || ' — check Actions > dc-geocode-observations' end,
      case when p.markers > 0 and l.markers < p.markers * 0.95
           then 'Map 1 markers fell ' || p.markers || ' -> ' || l.markers end,
      case when p.checked > 0 and l.checked < p.checked * 0.95
           then 'CHECKED markers fell ' || p.checked || ' -> ' || l.checked end,
      case when p.taken_at is not null and l.admitted is distinct from p.admitted
           then 'admitted set changed: ' || p.admitted || ' -> ' || l.admitted end,
      case when p.taken_at is not null and l.decision_defs is distinct from p.decision_defs
           then 'shared decision definition changed: '
                || (select string_agg(k, ', ' order by k) from (
                      select k from jsonb_object_keys(l.decision_defs || p.decision_defs) k
                       where l.decision_defs ->> k is distinct from p.decision_defs ->> k) d)
                || ' (a gated apply pages once and recovers at the next snapshot)' end
    ) as problems) q;

$blk$;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
  if _def is null then
    raise exception 'public.pipeline_health_tick() not found — refusing to splice';
  end if;
  if position($m$'dc_address_check',$m$ in _def) > 0 then
    raise notice 'dc_address_check already present — nothing to do';
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
  if (length(_def) - length(replace(_def, $m$'dc_address_check',$m$, ''))) / length($m$'dc_address_check',$m$) <> 1
     or (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor) <> 1 then
    raise exception 'splice did not take — dc_address_check must appear once and the anchor once';
  end if;
  raise notice 'dc_address_check spliced into pipeline_health_tick()';
end
$mig$;

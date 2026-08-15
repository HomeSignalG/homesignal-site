-- app-refresh-sweep-migration.sql — replace the dead 1,500-ZIP materializer batch with a
-- time-budgeted, per-ZIP-committing sweep + make its death impossible to miss again.
--
-- WHAT THIS FIXES (diagnosis accepted by founder 2026-08-15, receipts in QUEUE.md):
-- pg_cron job 13 (`app-content-refresh`, hourly) ran `app_refresh_batch(1500)` — ONE plpgsql
-- transaction whose duration grew with content (13s hourly avg 07-24 → 120s wall from 08-10)
-- until it hit the DB-default statement_timeout=120s on EVERY run, rolling back the whole
-- batch each time: zero ZIPs materialized since 2026-08-09 11:40Z. Per-ZIP cost measured
-- 2026-08-15: light 0.11–0.15s, dense metro 0.9–1.6s — a 1,500 batch can never fit 120s again.
--
-- THE DESIGN:
--   • app_refresh_sweep(_budget_secs default 100): oldest-first, per-ZIP COMMIT, exits on a
--     TIME budget (100s < the 120s wall, worst single-ZIP overshoot ~2s) — sized to the wall,
--     not to today's data, so further content growth degrades throughput instead of cliffing
--     to zero. Cron: every 15 min → ~380 ZIPs/run at today's mix ≈ 36k visits/day ≈ 2.8
--     national sweeps — the healthy-era throughput.
--   • FAILURE SEMANTICS: a failed ZIP is committed as a VISIBLE row in app_refresh_failures
--     (never re-raised, never blocks subsequent ZIPs) and stays oldest-first-eligible, so it
--     retries next sweep. BOUNDED SKIP (founder addition): after 5 consecutive failures
--     (ESCALATE_AFTER below) the row is flagged escalated and the ZIP sorts to the BACK of
--     the queue — one pathological ZIP degrades to an alert instead of eating budget at the
--     front of every sweep. It is still retried when budget reaches it, and a success clears
--     its row entirely.
--   • MONITORING, both riding the existing pipeline_health_tick alert path:
--       - `materializer` flips from max-age 6h to MIN-age 48h. max() moves when ANY zip is
--         touched, which is how 155 consecutive failures stayed silent behind on-demand
--         refreshes; min() is the real SLO (no ZIP older than ~5 sweep periods).
--       - new `materializer_sweep`: >=3 consecutive failed runs of the cron job = dead sweep,
--         regardless of data ages; detail also surfaces the escalated-ZIP count.
--
-- Applied via mcp apply_migration 2026-08-15. The pipeline_health_tick edit is performed as
-- an EXACT in-database string replacement (fetch def → replace → assert changed → execute),
-- never a hand retranscription of the 6.6 KB function (CLAUDE.md rule 7).

-- ── 1. The failure ledger ─────────────────────────────────────────────────────────────
create table if not exists public.app_refresh_failures (
  zip             text primary key,
  consecutive     integer not null default 1,
  first_failed_at timestamptz not null default now(),
  last_failed_at  timestamptz not null default now(),
  last_error      text not null,
  escalated       boolean not null default false
);
comment on table public.app_refresh_failures is
  'Live materializer-failure ledger, written ONLY by app_refresh_sweep. One row per currently-'
  'failing ZIP; success DELETES the row. escalated = 5+ consecutive failures -> the ZIP sorts '
  'to the back of the sweep queue and pipeline_health_tick surfaces the count.';
-- Operational table: RLS on with NO policies — no anon/authenticated read; SECURITY DEFINER
-- health checks and service-role paths read it (gov-archive posture, not page_cache).
alter table public.app_refresh_failures enable row level security;

-- ── 2. The sweep ──────────────────────────────────────────────────────────────────────
create or replace procedure public.app_refresh_sweep(_budget_secs integer default 100)
language plpgsql
as $$
declare
  ESCALATE_AFTER constant integer := 5;   -- consecutive failures before back-of-queue
  t0     timestamptz := clock_timestamp();
  r      record;
  _done  integer := 0;
  _fail  integer := 0;
begin
  -- Oldest-first over the same candidate union app_refresh_batch used; escalated ZIPs sort
  -- LAST (bounded skip). The cursor loop is holdable, so per-ZIP COMMIT is safe (PG11+).
  for r in
    select cand.zip
    from (
      select z.zip from public.communities c, unnest(c.zip_codes) as z(zip) where c.level='zip'
      union
      select zip from public.development_reports
      union
      select zip from public.app_community_meta
    ) cand
    left join public.app_community_meta  m on m.zip = cand.zip
    left join public.app_refresh_failures f on f.zip = cand.zip
    order by coalesce(f.escalated, false) asc, m.updated_at asc nulls first, cand.zip
  loop
    exit when clock_timestamp() - t0 > make_interval(secs => _budget_secs);
    begin
      perform public.app_refresh_zip(r.zip);
      delete from public.app_refresh_failures where zip = r.zip;   -- recovered -> ledger clears
      _done := _done + 1;
    exception when others then
      _fail := _fail + 1;
      insert into public.app_refresh_failures as f
        (zip, consecutive, first_failed_at, last_failed_at, last_error, escalated)
      values (r.zip, 1, now(), now(), left(sqlerrm, 500), false)
      on conflict (zip) do update
        set consecutive    = f.consecutive + 1,
            last_failed_at = now(),
            last_error     = excluded.last_error,
            escalated      = (f.consecutive + 1) >= ESCALATE_AFTER;
    end;
    commit;   -- per-ZIP: completed work survives anything that kills a later ZIP
  end loop;
  raise notice 'app_refresh_sweep: % refreshed, % failed, %s elapsed',
    _done, _fail, round(extract(epoch from clock_timestamp() - t0));
end $$;

-- ── 3. pipeline_health_tick: min-age materializer + sweep-pulse check ─────────────────
-- Exact-substring surgery on the live function (assert-changed, execute) — see the DO block
-- used at apply time, recorded here verbatim:
--
-- do $fix$
-- declare src text := pg_get_functiondef('public.pipeline_health_tick()'::regprocedure);
--         old_blk text; new_blk text;
-- begin
--   old_blk :=
-- $B$  insert into _eval
--   select 'materializer',
--          coalesce(max(updated_at) > _now - interval '6 hours', false), true,
--          coalesce('newest app_community_meta ' || to_char(max(updated_at), 'YYYY-MM-DD HH24:MI') || ' UTC ('
--                   || round((extract(epoch from _now - max(updated_at))/3600.0)::numeric, 1) || 'h ago)',
--                   'app_community_meta empty')
--     from public.app_community_meta;$B$;
--   new_blk := ... (the min-age check + materializer_sweep check, below);
--   if position(old_blk in src) = 0 then raise exception 'materializer block not found'; end if;
--   src := replace(src, old_blk, new_blk);
--   execute src;
-- end $fix$;
--
-- The replacement blocks:
--   • materializer  -> ok when min(updated_at) > now()-'48 hours' (oldest ZIP, the real SLO;
--     a healthy 15-min sweep covers the fleet in ~9h, so 48h ≈ 5 missed sweeps), detail shows
--     the OLDEST meta and its age.
--   • materializer_sweep (new, alertable) -> ok when fewer than 3 recorded runs of jobname
--     'app-content-refresh' OR any of the last 3 succeeded; detail lists the last-3 statuses
--     and the count of escalated ZIPs in app_refresh_failures.

-- ── 4. The cron swap (job 13 keeps its name; history stays attached) ──────────────────
-- select cron.alter_job(13, schedule := '*/15 * * * *',
--                           command  := 'call public.app_refresh_sweep();');

-- ── VERIFICATION (the founder-directed watch: first 3 runs live) ──────────────────────
-- Per run (fires at :00/:15/:30/:45):
--   select start_time, status, end_time-start_time as dur
--     from cron.job_run_details where jobid=13 order by start_time desc limit 3;
--   select count(*) from public.app_community_meta where updated_at > <run start>;  -- ≈380
--   select count(*), count(*) filter (where escalated) from public.app_refresh_failures;
-- Backfill: the sweep IS the backfill (oldest-first). Full-pass receipt after ~7–9h:
--   select min(updated_at), percentile_disc(0.5) within group (order by updated_at),
--          count(*) filter (where updated_at < now() - interval '48 hours')
--     from public.app_community_meta;
-- Expected end state: min(updated_at) within ~9h of now, 48h-stale count 0, and the
-- `materializer` health check flips red -> green on its own (it is correctly RED until the
-- backfill completes — that alert firing during catch-up is the instrument working).

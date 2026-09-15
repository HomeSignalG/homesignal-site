-- ============================================================================
-- COVERAGE STATE — THE RECENT-ATTEMPT WINDOW MUST COVER THE SWEEP PERIOD
-- Applied to production 2026-09-15 via MCP migration
--   `coverage_state_recent_attempt_window_72h`.
-- This file is the reproducible SQL of record (repo convention: docs/*.sql).
-- It supersedes the two `interval '48 hours'` clauses in docs/coverage-state-model.sql,
-- which is edited in the SAME commit so the two can never describe different ladders.
--
-- ── THE DEFECT ─────────────────────────────────────────────────────────────
-- `failed_ingest` and `temporarily_unavailable` both require
--   last_refresh_attempt_at >= now() - interval '48 hours'
-- to mean "this ZIP is still being actively retried". A ZIP that fails that clause
-- falls through to `stale_data`, whose documented meaning is
--   "refreshed_at >72h old, NO recent failed-attempt evidence".
--
-- 48h was correct for the scheduler that existed when the ladder was written. The
-- rolling refresh shipped as 250 rows/tick every 15 min = 24,000 attempts/day, a full
-- 12,722-ZIP sweep in ~16.7h (worst case 23.1h) against a 24h SLA — so 48h was ~2x the
-- sweep period, i.e. "missed at least one whole pass". See docs/dev-reports-rolling-refresh.sql.
--
-- THE SCHEDULER CONTRACT LATER CHANGED AND THE CLASSIFICATION CONTRACT DID NOT FOLLOW.
-- Measured 2026-09-15, cron.job jobid 14:
--   schedule '*/2 * * * *'  command 'select public.dev_refresh_tick(8, 20);'
--   => 8 rows x 30 fires/hour = 240 attempts/hour
--   => 12,722 / 240 = 53.0h for one complete sweep
-- 53.0h > 48h, so for ~5 hours of every sweep a perfectly healthy, on-schedule ZIP has
-- no attempt inside the window and is classified `stale_data` — a state asserting an
-- absence of retry evidence that the row itself contradicts.
--
-- ── MEASURED BEFORE THE CHANGE (production, 2026-09-15) ────────────────────
-- Scheduler is healthy, not throughput-starved:
--   total 12,722 · never_attempted 0 · attempted<=24h 5,760 · <=48h 11,520
--   · <=53h 12,719 · oldest attempt 53.03h   (5,760/24 = 240/h exactly)
-- Ladder population:
--   stale_data 25 — attempt-age band 48.00h .. 51.94h, ZERO outside it, and
--   25 of 25 carry last_refresh_attempt_at > refreshed_at (retry evidence present).
--   temporarily_unavailable 164 (max attempt age 47.97h)
--   failed_ingest            94 (max attempt age 47.84h)
-- Both neighbouring states press right against the 48h ceiling: that is the same
-- population crossing the boundary as the sweep hand goes round.
--
-- ── THE CORRECTION ─────────────────────────────────────────────────────────
-- The window is widened 48h -> 72h in BOTH branches. Nothing else moves: the 72h
-- and 7d `refreshed_at` thresholds, the content branches, the overlay plane, the
-- column list and the grants are all untouched.
--
-- 72h is chosen, not rounded to:
--   * it must exceed the 53.0h sweep period, or the defect persists by construction;
--   * 72h = 1.36x that sweep, leaving ~19h of headroom for retry interleaving (a failed
--     row is re-claimed and consumes a batch slot, lengthening the effective unique-ZIP
--     sweep) and for cron jitter;
--   * it reuses a threshold the ladder already carries, so the file states one 72h
--     family rather than two unrelated constants.
--
-- ── THIS DOES NOT WEAKEN COVERAGE VERIFICATION. MEASURED IN BOTH DIRECTIONS. ─
-- Exactly 25 rows change state, and every one of them stays under a gate:
--   22 -> temporarily_unavailable  (last SUCCESS 4.18 .. 6.43 days ago)
--    3 -> failed_ingest            (last SUCCESS 19.21 .. 23.54 days ago)
-- The 7-day bound is measured from `refreshed_at` — the last GOOD write — and is
-- untouched by this change, so it remains the backstop: a ZIP that is genuinely broken
-- cannot hide in `temporarily_unavailable`. Past 7 days it is `failed_ingest`, which
-- scripts/verify-coverage-state.mjs fails on with an EMPTY allowlist; inside 7 days the
-- same verifier counts it as a designed, self-releasing hold and fails it as `stuckHold`
-- the moment it overruns.
--
-- 🔑 IT IS A STRENGTHENING, AND THE 3 ARE THE PROOF. Those three ZIPs have been failing
-- for 19-23 DAYS while being retried, and `stale_data` — "no recent failed-attempt
-- evidence" — was the wrong name for them. They were buried among 22 false positives
-- produced by the boundary itself. The instrument goes from 25 findings of which 0 are
-- real to 3 findings of which 3 are real. A false alarm is how a real one gets ignored.
--
-- ── RESIDENT-VISIBLE SURFACE: NONE. MEASURED, NOT ASSUMED. ─────────────────
-- lib/community-page.js:97 renders `stale_data`, `temporarily_unavailable` and
-- `failed_ingest` through ONE branch, and its text is derived from `refreshed_at`
-- ("Records on this page were last verified N days ago"), never from which of the three
-- it is. All 25 rows are inside that group before AND after, so the rendered copy is
-- byte-identical on all 25 pages. lib/coverage-copy.js does not read coverage_state at
-- all ("THE GATE IS LIVE CONTENT, not a stored coverage_state"). The layout gate is
-- `data_quality` and is untouched. What changes is the `data-coverage-state` attribute
-- on 25 pages — an instrument, disclosed.
--
-- ⚠️ `with (security_invoker = true)` IS RESTATED ON PURPOSE. Measured on this database:
-- a bare `create or replace view` leaves `reloptions = (none)`, i.e. it DROPS the option
-- and silently promotes the view to the OWNER's rights, bypassing RLS on every source
-- relation. Never replay this file without it. Every source relation is schema-qualified
-- so `search_path` cannot re-point it.
--
-- ⚠️ DO NOT ADD AN UNFILTERED AGGREGATE OVER app_coverage_states TO THIS FILE. Measured
-- 2026-09-07: that view costs ~9.3M per pass (12,722 ZIPs x a per-ZIP LATERAL over a
-- 3.21M-row table whose visibility map is 0.1% set); one pass exceeds 60s warm and the
-- DB's own statement_timeout is 120s. The Unit 2 migration's first verify block ran five
-- such passes and could therefore NEVER ONCE EXECUTE while looking thorough. Every check
-- below is a catalog read or a keyed read of development_reports (12,722 rows, no laterals).
--
-- ROLLBACK: replay docs/coverage-state-model.sql at the commit before this one (it
-- carries the 48h form). Nothing is stored, so rollback is immediate and lossless.
-- ============================================================================

create or replace view public.app_coverage_states
with (security_invoker = true) as
select
  m.zip,
  case
    when r.zip is null then 'unsupported_source'
    -- RECENT-ATTEMPT WINDOW = 72h. It must remain >= the sweep period implied by
    -- cron jobid 14; invariant (d) below asserts that against the live cron row.
    when r.refreshed_at < now() - interval '7 days'
         and r.last_refresh_attempt_at > r.refreshed_at
         and r.last_refresh_attempt_at >= now() - interval '72 hours'
      then 'failed_ingest'
    when r.refreshed_at < now() - interval '72 hours'
         and r.last_refresh_attempt_at > r.refreshed_at
         and r.last_refresh_attempt_at >= now() - interval '72 hours'
      then 'temporarily_unavailable'
    when r.refreshed_at < now() - interval '72 hours'
      then 'stale_data'
    -- `changes` here is CIVIC changes only (see the 2026-08-02 correction in
    -- docs/coverage-state-model.sql): the same set app_refresh_zip counts into `_nc`.
    -- Local News is content, not coverage, and is reported separately as `news_items`.
    when coalesce(c.dev_markers,0) > 0 or coalesce(ch.changes,0) > 0
      then 'populated'
    else 'honestly_empty'
  end as coverage_state,
  m.data_quality,
  r.refreshed_at,
  r.last_refresh_attempt_at,
  coalesce(c.dev_markers,0)  as dev_markers,
  coalesce(c.fac_markers,0)  as fac_markers,
  coalesce(ch.changes,0)     as changes,
  coalesce(ch.news_items,0)  as news_items,
  case
    when r.zip is null then 'overlay_unsupported'
    when coalesce(c.fac_markers,0) > 0 then 'overlay_records'
    when coalesce(r.facilities_unavailable,false) then 'overlay_unknown'
    else 'overlay_empty'
  end as regulatory_overlay_state,
  r.facilities_refreshed_at,
  coalesce(r.facilities_unavailable,false) as facilities_unavailable
from public.app_community_meta m
left join public.development_reports r on r.zip = m.zip
left join lateral (
  select count(*) filter (where p.record_kind='development') dev_markers,
         count(*) filter (where p.record_kind='facility')    fac_markers
  from public.app_projects p where p.zip = m.zip
) c on true
left join lateral (
  select count(*) filter (where a.category <> 'Local News') changes,
         count(*) filter (where a.category  = 'Local News') news_items
  from public.app_changes a where a.zip = m.zip
) ch on true;

grant select on public.app_coverage_states to anon, authenticated;

-- ---------- INVARIANTS — these ASSERT, they do not describe -----------------
do $$
declare
  _def          text;
  _n48          int;
  _n72          int;
  _opts         text[];
  _sched        text;
  _cmd          text;
  _batch        int;
  _every_min    int;
  _zips         int;
  _implied_h    numeric;
  _window_h     constant numeric := 72;
begin
  -- (a) the security_invoker reloption SURVIVED the replace. A bare create-or-replace
  --     drops it; that is a privilege escalation, so it is checked, never assumed.
  select c.reloptions into _opts
    from pg_class c where c.oid = 'public.app_coverage_states'::regclass;
  if not ('security_invoker=true' = any (coalesce(_opts, '{}'::text[]))) then
    raise exception 'INVARIANT (a) FAILED: app_coverage_states lost security_invoker=true (reloptions=%)', _opts;
  end if;

  -- (b) the window actually MOVED. Lower the haystack once so the check cannot be
  --     defeated by a renderer changing keyword/interval casing.
  _def := lower(pg_get_viewdef('public.app_coverage_states'::regclass));
  _n48 := (length(_def) - length(replace(_def, '''48:00:00''', ''))) / length('''48:00:00''');
  _n72 := (length(_def) - length(replace(_def, '''72:00:00''', ''))) / length('''72:00:00''');
  if _n48 <> 0 then
    raise exception 'INVARIANT (b) FAILED: % occurrence(s) of the 48h window remain in the view body', _n48;
  end if;
  -- 4 = two recent-attempt clauses + two refreshed_at staleness clauses.
  if _n72 <> 4 then
    raise exception 'INVARIANT (b) FAILED: expected 4 occurrences of 72h in the view body, found %', _n72;
  end if;

  -- (c) the ladder still reads no EPA term (Unit 2's rule, re-asserted because this
  --     file rewrites the whole ladder and could silently undo it).
  if position('facilities_only' in _def) > 0 then
    raise exception 'INVARIANT (c) FAILED: facilities_only reappeared in the view body';
  end if;
  if position('fac_markers' in split_part(_def, 'as coverage_state', 1)) > 0 then
    raise exception 'INVARIANT (c) FAILED: the CORE ladder reads an EPA term';
  end if;

  -- (d) THE CONTRACT THIS FILE EXISTS FOR: the recent-attempt window must cover the
  --     sweep period the SCHEDULER implies. Read from cron.job rather than from
  --     observed data, so a paused or recovering job cannot make a correct window
  --     look wrong. Parsed only for the '*/N * * * *' form this job actually uses;
  --     anything else is reported loudly rather than silently skipped, because
  --     "did not run" and "found nothing" must never look alike.
  -- The cron catalog is read defensively: if this role cannot see cron.job, that is a
  -- REPORTING limitation, never a reason to roll back a correct view. An exception here
  -- would abort the whole migration, including the replace above.
  begin
    select j.schedule, j.command into _sched, _cmd
      from cron.job j
     where j.command ilike '%dev_refresh_tick%'
     order by j.jobid
     limit 1;
  exception when insufficient_privilege or undefined_table or undefined_object then
    _sched := null; _cmd := null;
    raise warning 'INVARIANT (d) NOT EVALUATED: cron.job is not readable by this role.';
  end;

  if _sched is null then
    raise warning 'INVARIANT (d) NOT EVALUATED: no cron job matching dev_refresh_tick was found. The 72h window is UNVERIFIED against a scheduler contract.';
  elsif _sched !~ '^\*/[0-9]+ \* \* \* \*$' then
    raise warning 'INVARIANT (d) NOT EVALUATED: cron schedule % is not the */N form this check parses. The 72h window is UNVERIFIED against a scheduler contract.', _sched;
  else
    _every_min := (regexp_match(_sched, '^\*/([0-9]+)'))[1]::int;
    _batch     := coalesce((regexp_match(_cmd, 'dev_refresh_tick\(\s*([0-9]+)'))[1]::int, 0);
    select count(*) into _zips from public.development_reports;
    if _batch <= 0 or _every_min <= 0 or _zips <= 0 then
      raise warning 'INVARIANT (d) NOT EVALUATED: batch=% every_min=% zips=%', _batch, _every_min, _zips;
    else
      _implied_h := round(_zips::numeric / (_batch::numeric * (60.0 / _every_min)), 2);
      if _window_h < _implied_h then
        raise exception 'INVARIANT (d) FAILED: recent-attempt window %h is SHORTER than the implied sweep period %h (% ZIPs / (% per fire x % fires/hour)). A healthy mid-sweep ZIP would be misclassified stale_data — widen the window or speed the sweep.',
          _window_h, _implied_h, _zips, _batch, round(60.0 / _every_min, 2);
      end if;
      raise notice 'INVARIANT (d) PASSED: window %h >= implied sweep %h (% ZIPs, % per fire, % fires/hour, schedule %)',
        _window_h, _implied_h, _zips, _batch, round(60.0 / _every_min, 2), _sched;
    end if;
  end if;

  raise notice 'app_coverage_states recent-attempt window: 48h -> 72h. Invariants (a)(b)(c) passed.';
end $$;

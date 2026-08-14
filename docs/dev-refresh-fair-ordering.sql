-- FAIR ROLLING-REFRESH ORDERING — a row that cannot be written must not delay other rows.
-- (2026-08-14)
--
-- THE DEFECT. `dev_refresh_fire_batch` picked its next batch with
--     order by refreshed_at asc nulls first
-- `refreshed_at` only advances when `dev_refresh_collect` actually WRITES the row. Every guard
-- in that function can refuse a write — the per-source fetch-failure refusal, the transient-safe
-- reduction guards, and the EPA facilities guard. A refused write leaves `refreshed_at` untouched,
-- so the row keeps the same sort key and returns to the front of the queue on the next tick. It
-- is re-fired forever and never yields its place.
--
-- Scheduling by "when did this row last SUCCEED" makes one row's inability to be written into
-- other rows' problem. That is the bug: priority is computed from an outcome the row does not
-- control, so a permanently-refused row is permanently first.
--
-- MEASURED, 2026-08-14 (receipts, not inference):
--   • Running `dev_refresh_fire_batch`'s own SELECT read-only returned 250 rows, of which
--     **250 were in the stuck cohort** (refreshed_at 2026-08-07 22:00 → 2026-08-08 16:15) and
--     **0 were in the 449-row EPA outage-repair cohort sitting behind them**.
--   • Over the preceding 16 hours the outage-repair cohort recorded
--     **attempted_since_last_night = 0** — not one retry — while cron job 14 ran successfully
--     every 15 minutes throughout and EPA was healthy on 6-8 of 8 probes per hour.
--   • 2,061 rows still carried a `refreshed_at` older than 5 days.
--
--   ⚠️ ONE THING I ASSERTED EARLIER AND THE DATA DOES NOT SUPPORT: that the stuck cohort
--   consumes the entire 250-row budget every tick. It does not — only **419 of those 2,061 rows
--   were fired in the last 24 hours**, out of **6,831 fires table-wide**. The starvation of the
--   rows behind them is measured and real; the "they eat the whole budget" mechanism was my
--   inference and it was wrong. The fix below does not depend on which mechanism it is, because
--   it removes the coupling itself.
--
-- THE FIX. Order by when the row was last TOUCHED, not when it last SUCCEEDED:
--     order by greatest(refreshed_at, last_refresh_attempt_at) asc nulls first
--
-- `last_refresh_attempt_at` is stamped by the claim step on EVERY fire, success or not, so a
-- refused row goes to the BACK of the queue exactly like a written one. That converts the queue
-- into a strict round-robin: every row is tried once per cycle, and no row's outcome can affect
-- another row's turn. `greatest()` (not plain `last_refresh_attempt_at`) is deliberate — a row
-- written by some other path, such as the manual outage-repair batches, advances `refreshed_at`
-- without advancing `last_refresh_attempt_at`, and greatest() correctly sends it to the back
-- rather than re-firing it immediately.
--
-- WHAT THIS DOES NOT CHANGE. Batch size, cooldown, the claim mechanics, `for update skip locked`,
-- and every guard in `dev_refresh_collect` are untouched. Staleness priority is preserved in the
-- sense that matters: with a fair cycle, the staleness of EVERY page is bounded by the cycle time,
-- instead of some pages being refreshed constantly and others never.
--
-- APPLIED AS AN ANCHORED PATCH — the live definition is read with pg_get_functiondef, the anchor
-- must appear EXACTLY ONCE verbatim, and the script raises rather than patch blind.

do $mig$
declare
  src text;
  anchor text;
  repl text;
  hits int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'dev_refresh_fire_batch' and n.nspname = 'public';
  if src is null then
    raise exception 'public.dev_refresh_fire_batch() not found — refusing to patch nothing';
  end if;

  -- Idempotence: already fair-ordered?
  if position('greatest(refreshed_at, last_refresh_attempt_at)' in src) > 0 then
    raise notice 'fair ordering already applied — no change';
    return;
  end if;

  anchor := 'order by refreshed_at asc nulls first';
  hits := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if hits <> 1 then
    raise exception 'ordering anchor found % times (expected exactly 1) — refusing to patch blind', hits;
  end if;
  repl := 'order by greatest(refreshed_at, last_refresh_attempt_at) asc nulls first';
  src := replace(src, anchor, repl);

  execute src;
  raise notice 'fair ordering applied to public.dev_refresh_fire_batch()';
end
$mig$;

-- ── VERIFY (both must be true) ────────────────────────────────────────────────────────────
-- select position('greatest(refreshed_at, last_refresh_attempt_at)' in pg_get_functiondef(oid)) > 0
--          as fair_ordering_live,
--        position('order by refreshed_at asc nulls first' in pg_get_functiondef(oid)) = 0
--          as old_ordering_gone
--   from pg_proc where proname = 'dev_refresh_fire_batch';
--
-- ── PROOF IT UNSTARVES (run before and after; the second number must become non-zero) ─────
-- with sel as (
--   select zip from public.development_reports
--    where last_refresh_attempt_at is null
--       or last_refresh_attempt_at < now() - make_interval(mins => 20)
--    order by greatest(refreshed_at, last_refresh_attempt_at) asc nulls first
--    limit 250)
-- select count(*) filter (where zip in (select zip from public.epa_outage_repair_2026_08
--                                        where repaired_at is null)) as damage_cohort_in_next_batch
--   from sel;

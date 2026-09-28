-- ============================================================================
-- dev_refresh_collect() HEALS ITS OWN CURSORS AFTER A DATABASE RESTART (2026-09-28)
--
-- WHAT KEEPS BREAKING
-- ----------------------------------------------------------------------------
-- pg_net keeps its request-id counter, net.http_request_queue_id_seq, UNLOGGED. A crash
-- restart sets it back to 1. dev_refresh_collect() only evaluates a response whose id is
-- above the ZIP's development_reports.last_collected_response_id, so after a restart
-- every cursor set before it is ABOVE every new id, and each ZIP's new answers are
-- skipped until the counter climbs past its old cursor, about a day. Nothing is saved in
-- that time, while job 14 keeps firing and succeeding.
--   2026-09-27 restart 00:36:27Z: 11,603 of 12,722 cursors stranded; found ~19h later.
--   2026-09-28 restart 20:17:50Z: 12,666 stranded; 0 reports saved until hand-repaired.
-- Both were repaired by hand with the same statement (archive, then set each stale
-- cursor to the counter's CURRENT value). This puts that statement inside the
-- collector, so the next restart heals on the first tick.
--
-- THE RULE
-- ----------------------------------------------------------------------------
-- A cursor is a response id, and a response id is an id the counter has issued, so
-- without a restart no cursor can exceed the counter's last issued value. A cursor above
-- it is left over from the counter's previous run: set it to the last issued value.
--   * Never NULL (or 0). NULL makes every in-window response for the ZIP eligible at
--     once; on 2026-09-27 that pushed one tick past its 120 s statement_timeout.
--     "Last issued" skips only responses that landed before the heal, which the
--     oldest-first rotation re-fires with fresh, higher ids.
--   * "Last issued" is last_value when is_called, else last_value - 1: a sequence that
--     has issued nothing since restart reads last_value 1, is_called false, and its
--     first id will be 1. Using 1 there would skip that response.
--   * Placed right after the advisory lock, so one collector heals, and before step (0),
--     so the same tick already evaluates the ZIP's new response.
-- Cost with nothing to heal: one sequential read of development_reports, measured 9 ms
-- (2,234 shared buffers, 12,722 rows, 2026-09-28). The update fires no trigger: the
-- table's two triggers are UPDATE OF zip and UPDATE OF sites.
--
-- SPLICE, NOT A RETYPE (CLAUDE.md claims rule 7)
-- ----------------------------------------------------------------------------
-- Live body before: md5(prosrc) 790a61cb4b72e9b40a789be46cbc09a7, 14,428 characters =
--   docs/dev-refresh-collect-once-per-response.sql (906fa23f..., 13,986)
--   + migration 20260927230313 dev_refresh_echo_health_v1_collect (two splices; its
--     source file, docs/dev-refresh-echo-health.sql, is in neither repo).
-- test/dev_refresh_restart_pg/build_live.py rebuilds that body from the two and
-- refuses unless it fingerprints to 790a61cb..., so the suite exercises the live
-- function. This block reads the LIVE definition, inserts once after the lock, refuses
-- if the anchor is not there exactly once, does nothing if already applied, and checks
-- the result. Rollback: the same splice in reverse (remove the (R) block).
-- ============================================================================

do $mig$
declare
  src    text;
  anchor text := $a$  if not pg_try_advisory_xact_lock(hashtext('public.dev_refresh_collect')) then
    return 0;
  end if;
$a$;
  heal   text := $h$
  -- (R) RESTART HEAL (2026-09-28, docs/dev-refresh-collect-restart-heal.sql). pg_net's
  -- request-id counter is UNLOGGED and restarts at 1 after a crash, so a cursor above the
  -- counter's last issued id is left over from before the restart and would make step (0)
  -- skip every new response for that ZIP for about a day. Set such cursors to the last
  -- issued id: never NULL, which would make every in-window response eligible at once.
  -- (The counter is read as a scalar subquery: a sequence in UPDATE ... FROM is refused
  -- with "cannot lock rows in sequence".)
  update public.development_reports d
     set last_collected_response_id =
           (select case when s.is_called then s.last_value else s.last_value - 1 end
              from net.http_request_queue_id_seq s)
   where d.last_collected_response_id >
           (select case when s.is_called then s.last_value else s.last_value - 1 end
              from net.http_request_queue_id_seq s);
$h$;
  hits   int;
  after  text;
begin
  select pg_get_functiondef('public.dev_refresh_collect()'::regprocedure) into src;
  if src is null then
    raise exception 'public.dev_refresh_collect() not found; refusing to patch nothing';
  end if;
  if position('(R) RESTART HEAL' in src) > 0 then
    raise notice 'restart heal already present; no change';
    return;
  end if;

  hits := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if hits <> 1 then
    raise exception 'advisory-lock block found % times (expected 1); refusing to patch blind', hits;
  end if;
  execute replace(src, anchor, anchor || heal);

  select pg_get_functiondef('public.dev_refresh_collect()'::regprocedure) into after;
  if (length(after) - length(replace(after, '(R) RESTART HEAL', ''))) / length('(R) RESTART HEAL') <> 1 then
    raise exception 'restart heal not present exactly once after the splice';
  end if;
  if position('(R) RESTART HEAL' in after) > position('(0) THE RESPONSE SET' in after) then
    raise exception 'restart heal landed after step (0)';
  end if;
  if position('(R) RESTART HEAL' in after) < position('pg_try_advisory_xact_lock' in after) then
    raise exception 'restart heal landed before the advisory lock';
  end if;
  if replace(after, heal, '') <> src then
    raise exception 'removing the heal does not give back the original definition';
  end if;
end
$mig$;

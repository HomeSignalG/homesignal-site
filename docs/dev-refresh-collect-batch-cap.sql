-- ============================================================================
-- dev_refresh_collect() EVALUATES AT MOST 16 RESPONSES PER TICK (2026-09-28)
--
-- WHAT HAPPENED
-- ----------------------------------------------------------------------------
-- At 2026-09-28 21:58:22Z about 60 get-address-report answers landed at once, fired by
-- something outside job 14 (no pg_cron job started then). The next tick put all of them
-- in its response set, step (d) ran past the 120 s statement_timeout, and the whole tick
-- rolled back, cursors included. Every tick after retried the same set and failed the
-- same way, until those answers left the 20-minute window: 10 of 12 ticks failed
-- 22:00-22:18Z and nothing was saved. The same shape stopped a tick on 2026-09-27 (~77
-- eligible after a cursor reset to NULL).
--
-- THE CHANGE (founder, 2026-09-28: "Yes, cap at 16 per run")
-- ----------------------------------------------------------------------------
-- Step (0) keeps the 16 OLDEST eligible responses. The rest are not evaluated and their
-- cursors do not move, so they stay eligible and later ticks take them, oldest first,
-- while they are still in the window. Job 14 fires 8 per tick, so a normal tick is
-- unchanged, and a backlog drains 8 net per tick (a 60-answer burst in ~8 ticks, ~16 min,
-- inside the 20-minute window). An answer that still ages out is not lost data: its ZIP
-- keeps its old refreshed_at and the oldest-first rotation re-fires it.
--
-- SPLICE, NOT A RETYPE (CLAUDE.md claims rule 7)
-- ----------------------------------------------------------------------------
-- Live body before: md5(prosrc) 313656dab39c708fbc8f59655786ba31, 15,398 characters =
-- docs/dev-refresh-collect-restart-heal.sql applied to 790a61cb... . Two anchors, each
-- must occur exactly once; refuses if the cap is already present in any form; checks
-- the result. Rollback: the same two replacements in reverse.
-- ============================================================================

do $mig$
declare
  src   text;
  head  text := $a$  select coalesce(array_agg(c.id order by c.id), '{}')
    into _ids
  from (
$a$;
  head2 text := $b$  -- (0-cap) AT MOST 16 RESPONSES PER TICK (2026-09-28,
  -- docs/dev-refresh-collect-batch-cap.sql). A burst of ~60 answers made one tick run past
  -- the 120 s statement_timeout and roll back, and every tick after retried the same set
  -- until it aged out. The 16 oldest are evaluated; the rest keep their cursors and are
  -- taken by later ticks.
  select coalesce(array_agg(e.id order by e.id), '{}')
    into _ids
  from (select c.id from (
$b$;
  tail  text := $c$  where c.id > coalesce(d.last_collected_response_id, 0);
$c$;
  tail2 text := $d$  where c.id > coalesce(d.last_collected_response_id, 0)
  order by c.id
  limit 16) e;
$d$;
  n_head int; n_tail int;
  after text;
begin
  select pg_get_functiondef('public.dev_refresh_collect()'::regprocedure) into src;
  if src is null then
    raise exception 'public.dev_refresh_collect() not found; refusing to patch nothing';
  end if;
  if position('(0-cap)' in src) > 0 then
    raise notice 'batch cap already present; no change';
    return;
  end if;
  if position('(R) RESTART HEAL' in src) = 0 then
    raise exception 'restart heal missing: apply docs/dev-refresh-collect-restart-heal.sql first';
  end if;

  n_head := (length(src) - length(replace(src, head, ''))) / length(head);
  n_tail := (length(src) - length(replace(src, tail, ''))) / length(tail);
  if n_head <> 1 or n_tail <> 1 then
    raise exception 'step (0) anchors found %/% times (expected 1/1); refusing to patch blind', n_head, n_tail;
  end if;
  execute replace(replace(src, head, head2), tail, tail2);

  select pg_get_functiondef('public.dev_refresh_collect()'::regprocedure) into after;
  if (length(after) - length(replace(after, 'limit 16) e;', ''))) / length('limit 16) e;') <> 1 then
    raise exception 'cap not present exactly once after the splice';
  end if;
  if position('(0-cap)' in after) > position('if cardinality(_ids) = 0 then' in after) then
    raise exception 'cap landed after step (0)';
  end if;
  if replace(replace(after, head2, head), tail2, tail) <> src then
    raise exception 'reversing the two replacements does not give back the original definition';
  end if;
end
$mig$;

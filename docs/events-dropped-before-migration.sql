-- HomeSignal — add events.dropped_before (client-side drop accounting sink)
-- Parked DDL of record (applied to project qwnnmljucajnexpxdgxr via MCP). Companion
-- to events.js, which counts the three silent event-drop paths in hsLogEvent and
-- flushes the count onto the next successful insert so it is queryable alongside
-- the events themselves (and can feed the acquisition dashboard).
--
-- NULLABLE, NO DEFAULT, NOT BACKFILLED — on purpose:
--   NULL  = "unknown": rows written before this column existed, OR by an older
--           cached events.js that doesn't send it. The drop count is not known.
--   0     = "measured, no drops since the last successful insert" (known-zero).
--   N > 0 = "measured, N drops flushed with this row".
-- A backfill to 0 would falsely assert "zero drops" over exactly the window we
-- established is unmeasured (see the events.js undercount review). NULL keeps it honest.
--
-- Aggregate the measured undercount (nulls excluded automatically):
--   select sum(dropped_before)                              as events_dropped_measured,
--          count(*) filter (where dropped_before is not null) as rows_in_measured_era
--   from public.events;

alter table public.events add column if not exists dropped_before int;

comment on column public.events.dropped_before is
  'Client-reported count of events silently dropped on this browser since its '
  'previous successful insert (events.js drop accounting). NULL = unknown '
  '(pre-instrumentation or stale client); 0 = measured no-drops; N = N flushed. '
  'Never backfilled: NULL must stay NULL so it cannot read as a false zero.';

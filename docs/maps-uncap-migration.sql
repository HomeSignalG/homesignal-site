-- ============================================================================
-- MAPS UNCAP (Phase 3) — remove the two arbitrary quantity caps from
-- public.app_refresh_zip: LIMIT 48 (development -> app_projects) and LIMIT 16
-- (facilities -> app_projects).
--
-- Applied to production 2026-07-24 via MCP migrations
--   `app_projects_zip_kind_date_idx`      (Phase 1 supporting index)
--   `app_refresh_zip_uncap_maps_dev_fac`  (this file's surgery block)
-- This file is the reproducible SQL of record (repo convention: docs/*.sql).
--
-- WHY (verified in the 2026-07-24 Cross-Map Parity Audit, all numbers live-DB):
--   The completeness-first product rule forbids excluding a qualifying record by
--   quantity alone. app_refresh_zip's LIMIT 48/16 made 468,609 of 515,805 cached
--   development records (90.8%) unreachable on every app_projects surface
--   (maps.html first among them); 904 ZIPs exceeded the dev cap (worst: 44127
--   with 5,424 records -> 48 shown), 5,515 exceeded the facility cap. No
--   measured performance justification for the values existed ("largest
--   existing cap precedent" was the only recorded rationale).
--
-- WHAT CHANGED (and what deliberately did NOT):
--   * REMOVED: `limit 48` on the development insert; `limit 16` on the facility
--     insert. Both inserts keep their exact filters (dev_sites_deduped,
--     record_url required, scope/relevance, label required) and their exact
--     deterministic ordering (business keys + md5(el::text) FD-1 tiebreak).
--   * UNTOUCHED: every other limit — communities resolution (limit 1 x2),
--     planning/civic notices (limit 6 x2), meetings (limit 8), gov notices
--     (limit 48) and Local News (limit 48) into app_changes — out of scope.
--   * The _ndp/_nfc "true total" counts, the data_quality gate, the indexable
--     substance gate, and the coord-sanity NULLing are byte-identical.
--
-- ORDER OF OPERATIONS (why this was safe to apply):
--   1. Site Phase 1 shipped first: lib/data.js projects()/facilities() became
--      range-windowed full reads (1,000-row pages, stable total order) — without
--      this, PostgREST's silent 1,000-row default ceiling would have re-truncated
--      the ~40 densest ZIPs the moment this migration ran.
--   2. Site Phase 2 shipped second: maps.html renders the full set (GL clustered
--      rest layer / Leaflet canvas layer / chunk-rendered "All records on file"
--      list) and refuses to render a partial read as complete.
--   3. THEN this migration + re-materialization of the 5,978 ZIPs carrying a cap
--      artifact (unlogged work-queue table, drained in 800-1,200-ZIP batches,
--      each bounded transaction well under the 120 s statement_timeout).
--
-- MEASURED AT APPLY TIME (clock_timestamp deltas, production):
--   85234 (46 dev / 38 fac):   ~33 ms    -> development=46/46 facilities=38/38
--   55407 (3,014 dev):         ~398 ms   -> development=3014/3014
--   44127 (5,424 dev, worst):  ~634 ms   -> development=5424/5424
--   Post-drain parity across ALL 11,679 cached ZIPs:
--     dev mismatches 0 (515,805 == 515,805)
--     fac mismatches 0 (217,924 == 217,924)
--   (A first parity pass showed 70 fac-short ZIPs — all were materialized at the
--    13:49 UTC cron sweep and cache-refreshed AFTER it: ordinary between-tick
--    staleness the hourly app_refresh_batch closes, not a cap artifact. They
--    were refreshed explicitly; parity then read 0/0.)
--
-- The surgery is performed on the LIVE function body (the parked docs copies had
-- drifted — the live body reads dev_sites_deduped() and carries FD-1 ordering),
-- with guards that abort unless each target clause appears EXACTLY once.
-- Body md5 before: 5d840e01cc8f35c2c7071cb893081310
-- Body md5 after:  fe8eef56aa80c7f2e2bec34651dea9c2
-- ============================================================================

do $$
declare
  def text;
  dev_needle text := E'md5(el::text)\n    limit 48;';
  dev_repl   text := 'md5(el::text);';
  fac_needle text := E'order by el->>''label'', md5(el::text)\n    limit 16;';
  fac_repl   text := 'order by el->>''label'', md5(el::text);';
  n_dev int; n_fac int;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'app_refresh_zip';
  if def is null then raise exception 'app_refresh_zip not found'; end if;

  n_dev := (length(def) - length(replace(def, dev_needle, ''))) / length(dev_needle);
  n_fac := (length(def) - length(replace(def, fac_needle, ''))) / length(fac_needle);
  if n_dev <> 1 then raise exception 'dev LIMIT 48 clause found % times (expected exactly 1) — live body drifted, aborting', n_dev; end if;
  if n_fac <> 1 then raise exception 'facility LIMIT 16 clause found % times (expected exactly 1) — live body drifted, aborting', n_fac; end if;

  def := replace(def, dev_needle, dev_repl);
  def := replace(def, fac_needle, fac_repl);
  execute def;
  raise notice 'app_refresh_zip uncapped: dev LIMIT 48 and facility LIMIT 16 removed';
end $$;

-- ----------------------------------------------------------------------------
-- RE-MATERIALIZATION (as run at apply time; safe to re-run any time):
-- queue every ZIP still carrying a cap artifact, drain in bounded batches.
-- The hourly pg_cron app_refresh_batch(1500) sweep converges the same way on
-- its own within ~9h; this just front-loads it.
-- ----------------------------------------------------------------------------
-- create unlogged table if not exists public.maps_uncap_refresh_queue (zip text primary key);
-- insert into public.maps_uncap_refresh_queue
-- select zip from public.app_projects
-- group by zip
-- having count(*) filter (where record_kind='development') = 48
--     or count(*) filter (where record_kind='facility') = 16
-- on conflict do nothing;
-- -- repeat until empty (each call is one bounded transaction):
-- do $$
-- declare r record;
-- begin
--   for r in select zip from public.maps_uncap_refresh_queue order by zip limit 800 loop
--     perform public.app_refresh_zip(r.zip);
--     delete from public.maps_uncap_refresh_queue where zip = r.zip;
--   end loop;
-- end $$;
-- drop table if exists public.maps_uncap_refresh_queue;

-- ----------------------------------------------------------------------------
-- REVERT (inverse surgery — restores the exact prior clauses, then re-run the
-- batched refresh; the front-end is a no-op at <=48/16 rows so it needs no
-- revert). Guards mirror the forward pass.
-- ----------------------------------------------------------------------------
-- do $$
-- declare
--   def text;
--   dev_needle text := E'desc nulls last,\n      md5(el::text);';
--   dev_repl   text := E'desc nulls last,\n      md5(el::text)\n    limit 48;';
--   fac_needle text := E'order by el->>''label'', md5(el::text);';
--   fac_repl   text := E'order by el->>''label'', md5(el::text)\n    limit 16;';
--   n_dev int; n_fac int;
-- begin
--   select pg_get_functiondef(p.oid) into def
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'app_refresh_zip';
--   n_dev := (length(def) - length(replace(def, dev_needle, ''))) / length(dev_needle);
--   n_fac := (length(def) - length(replace(def, fac_needle, ''))) / length(fac_needle);
--   if n_dev <> 1 or n_fac <> 1 then raise exception 'revert needles not unique (dev %, fac %)', n_dev, n_fac; end if;
--   def := replace(def, dev_needle, dev_repl);
--   def := replace(def, fac_needle, fac_repl);
--   execute def;
-- end $$;

-- ----------------------------------------------------------------------------
-- Phase 1 supporting index (applied 2026-07-24, migration
-- app_projects_zip_kind_date_idx): the app_projects read path is always
-- (zip, record_kind) ordered submitted_at desc — at ~516K rows it must be an
-- index scan, and the id tiebreak gives the client's range windows a stable
-- total order.
-- ----------------------------------------------------------------------------
create index if not exists app_projects_zip_kind_date_idx
  on public.app_projects (zip, record_kind, submitted_at desc nulls last, id);

-- app_zip_source_ids — per-ZIP development source-id summary, maintained AT WRITE TIME.
--
-- APPLIED to project qwnnmljucajnexpxdgxr on 2026-08-19 as three migrations, in this order:
--   1. app_zip_source_ids_summary_table
--   2. app_refresh_zip_maintains_zip_source_ids
--   3. dev_zip_source_ids_reads_summary_table   (after the backfill + parity check below)
-- Parked here so the schema stays reproducible (CLAUDE.md §1, source #3).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY
--
-- dev_zip_source_ids() feeds the Live scoreboard's record-based denominator. It aggregated
-- public.app_projects — 3,079,005 rows / 4,209 MB, measured 2026-08-19 — on EVERY call, under a
-- role whose statement_timeout is 3s (pg_db_role_setting: anon=3s, authenticated=8s). It had
-- been failing continuously since 2026-08-16 and, because a reporting step was ordered ahead of
-- the drift gates, it took the entire source-monitor job down with it each time. #823 fixed the
-- ordering; this fixes the cost.
--
-- ⛔ THE HALVING LADDER IN scripts/live-scoreboard.mjs WAS TREATING THE WRONG CAUSE, and its own
-- logs say so. Run 32276630120 (the last run before this change) walked the full ladder:
--     [warn] dev_zip_source_ids HTTP 500 — retrying at p_limit=125
--     [warn] dev_zip_source_ids HTTP 500 — retrying at p_limit=62
--     [warn] dev_zip_source_ids HTTP 500 — retrying at p_limit=50
--     live-scoreboard failed: HTTP 500 {"code":"57014", ... "canceling statement due to
--     statement timeout"}
-- Three retries, ~53 seconds, zero successes. The cost was never dominated by page size: a page
-- a fifth as large still had to group the whole table. The ladder is removed in the same change.
--
-- THE INSIGHT: the aggregate is over rows that ONLY app_refresh_zip() writes. So it can be
-- computed once per WRITE instead of once per READ. 12,722 possible summary rows replace 3.08M.
--
-- MEASURED AFTER, as anon: p_limit 250 -> 1.6 ms · 1000 -> 0.8 ms · 5000 -> 3.1 ms.
-- Before, the same 5000-row page measured 14,350 ms. Three orders of magnitude, and flat in page
-- size rather than linear, because it is now an index scan over 9,374 rows.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE TABLE
--
-- RLS posture mirrors app_projects EXACTLY: enabled, one public SELECT policy, NO write policy.
-- dev_zip_source_ids is security invoker, so anon reads through that policy and nothing gains a
-- write path. app_refresh_zip runs as postgres via pg_cron, which bypasses RLS as it already
-- does for its app_projects writes.
create table if not exists public.app_zip_source_ids (
  zip        text primary key,
  source_ids text[]      not null default '{}'::text[],
  dev_rows   integer     not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.app_zip_source_ids is
  'Per-ZIP summary of public.app_projects rows with record_kind=''development'': the distinct non-null registry_id set and the row count. Maintained inside app_refresh_zip() at write time; read by dev_zip_source_ids(). A row with dev_rows=0 is a POSITIVE statement that the ZIP has no development rows -- it is not the same as an absent row, and the RPC filters it out so its semantics match the old GROUP BY exactly.';

alter table public.app_zip_source_ids enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
                 where c.relname='app_zip_source_ids' and p.polname='app_zip_source_ids_read') then
    create policy app_zip_source_ids_read on public.app_zip_source_ids for select using (true);
  end if;
end $$;

grant select on public.app_zip_source_ids to anon, authenticated;
grant all    on public.app_zip_source_ids to postgres, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE WRITER — app_refresh_zip() maintains it
--
-- The function is ~17 KB and is NOT reproduced here. It is patched PROGRAMMATICALLY from its own
-- deployed text (CLAUDE.md rule 7: compute the set inside the database, never hand-transcribe a
-- list-shaped or body-shaped artifact into a migration). The migration reads
-- pg_get_functiondef, asserts the anchor line appears EXACTLY once, splices, executes, and then
-- verifies by ROUND TRIP — removing the added block from the deployed definition must reproduce
-- the original byte for byte. A byte-count assert could not make that claim; it would pass just
-- as happily if something else had moved by the same number of characters.
--
-- ⚠️ THE FIRST ATTEMPT REFUSED AND ROLLED BACK, which is the guard working: a closing assert
-- expected 2 mentions of the table name and found 1 (`on conflict (zip)` does not repeat it).
-- The whole migration is one transaction, so nothing partial landed — re-read confirmed the
-- function unchanged at 17,487 chars. The assert was corrected to 1, not deleted.
--
-- THE BLOCK IT ADDS, verbatim, spliced immediately after the `_nf` count (i.e. AFTER the
-- stale-row delete, so it summarises the ZIP's FINAL row set):
--
--   insert into public.app_zip_source_ids (zip, source_ids, dev_rows, updated_at)
--   select _zip,
--          coalesce(array_agg(distinct p.registry_id) filter (where p.registry_id is not null),
--                   '{}'::text[]),
--          count(*)::int,
--          now()
--     from public.app_projects p
--    where p.zip = _zip and p.record_kind = 'development'
--   on conflict (zip) do update
--     set source_ids = excluded.source_ids,
--         dev_rows   = excluded.dev_rows,
--         updated_at = excluded.updated_at;
--
-- NO GROUP BY, ON PURPOSE. A bare aggregate returns exactly one row even when the ZIP has zero
-- development rows, so a ZIP that loses its last record is positively written to dev_rows=0
-- rather than left carrying a stale non-zero. That is the property that keeps the summary from
-- drifting the way a cache would.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE BACKFILL (one time)
--
-- Run in leading-digit chunks; a single statement over the whole table exceeds the 60s tool
-- timeout. Chunk boundaries used: [0,2) [2,3) [3,4) [4,5) [5,7) [7,8) [8,∞) — every 5-digit ZIP
-- sorts into exactly one, and the union is total.
--
-- Only ZIPs that HAVE development rows are backfilled. That is not a shortcut: an absent row and
-- a dev_rows=0 row are identical to the reader (which filters dev_rows>0), and app_refresh_zip
-- writes the explicit zeroes as it visits each ZIP.
--
-- insert into public.app_zip_source_ids (zip, source_ids, dev_rows, updated_at)
-- select p.zip,
--        coalesce(array_agg(distinct p.registry_id) filter (where p.registry_id is not null), '{}'::text[]),
--        count(*)::int, now()
--   from public.app_projects p
--  where p.record_kind='development' and p.zip >= '<lo>' and p.zip < '<hi>'
--  group by p.zip
-- on conflict (zip) do update set source_ids=excluded.source_ids, dev_rows=excluded.dev_rows,
--                                 updated_at=excluded.updated_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. THE PARITY CHECK — run BEFORE swapping the reader, per chunk
--
-- A COUNT IS NOT A CHECK (CLAUDE.md rule 8): 9,374 plausible ZIPs look exactly like 9,374
-- correct ones. Fingerprint both sides over (zip | source_ids | n).
--
-- THE `collate "C"` IS NOT OPTIONAL (rule 9). Without it the ordering follows the database
-- collation, and a fingerprint that sorts differently on the two sides reports a mismatch on
-- identical data — which is how a real drift alarm gets ignored later.
--
-- with live as (
--   select p.zip,
--          coalesce(array_agg(distinct p.registry_id) filter (where p.registry_id is not null), '{}'::text[]) as ids,
--          count(*)::int as n
--   from public.app_projects p
--   where p.record_kind='development' and p.zip >= '<lo>' and p.zip < '<hi>'
--   group by p.zip
-- ), summ as (
--   select zip, source_ids as ids, dev_rows as n from public.app_zip_source_ids
--   where dev_rows > 0 and zip >= '<lo>' and zip < '<hi>'
-- )
-- select (select count(*) from live), (select count(*) from summ),
--        (select md5(string_agg(zip||'|'||array_to_string(ids,',')||'|'||n, ';' order by zip collate "C")) from live),
--        (select md5(string_agg(zip||'|'||array_to_string(ids,',')||'|'||n, ';' order by zip collate "C")) from summ);
--
-- RESULT 2026-08-19 — 7 chunks, 9,374 ZIPs, 0 mismatches, md5 identical on both sides in every
-- chunk. Both subqueries run in one statement, so they read one snapshot; the concurrent sweep
-- cannot split them, because app_refresh_zip writes app_projects and the summary in the same
-- transaction.
--   [0,2)  3,060  21ca11e472738acca8c129d6774c734d
--   [2,3)    851  ed4f88fc888e9baa35737e889988a3d5
--   [3,4)    772  644cc63e81a5192abf5cbfedcaff49f9
--   [4,5)    814  dfc8b6601b7bb0be67e3f857dd88d52b
--   [5,7)  1,558  e3cf96eef82a325959745c84c0016ac2
--   [7,8)    949  1caa7a7bee16c33758775bfd42ee3951
--   [8,∞)  1,370  2b2d0144a0e7a727e8e5839dfae24ca8
--
-- POSITIVE CONTROL, and it is the one that matters here: mid-backfill the summary already held
-- rows in the 3/5/6/7/8 ranges that NO chunk had written yet. Those came from the patched
-- app_refresh_zip running under the 15-minute sweep — i.e. the write-time maintenance was
-- demonstrated live before the parity check was taken, not merely asserted.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. THE READER — see docs/dev-zip-source-ids-rpc.sql for v3 and the full lineage.

comment on column public.app_zip_source_ids.dev_rows is
  'Count of app_projects rows for this ZIP with record_kind=''development''. 0 is meaningful: it asserts the ZIP was refreshed and has none. dev_zip_source_ids() filters dev_rows>0 so its result set matches the pre-2026-08-19 GROUP BY exactly.';

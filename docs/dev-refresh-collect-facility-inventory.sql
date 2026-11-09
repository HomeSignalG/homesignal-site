-- ============================================================================
-- dev_refresh_collect — KEEP THE INVENTORY'S COVERAGE AND ITS DATE THROUGH A FAILED REFRESH
-- (SQL OF RECORD; PARKED, NOT APPLIED. Founder review required: homesignal-site PR #2736.)
-- ============================================================================
-- WHY (2026-11-09). The ZIP-boundary EPA read (get-address-report, sources/epa-frs-zip.ts) sends
-- counts.facilities_coverage = "zip_boundary_v1" when, and only when, it covered the whole ZIP boundary and every
-- circle answered. The collector stores `counts` as sent on an accepted facility write. Three facts must survive a
-- LATER failed refresh, and two did not:
--   1. stored inventory coverage   counts.facilities_coverage   LOST: a refused write took the new response's counts
--                                                               keys, which carry no marker, so a complete inventory
--                                                               read as unverified after any failed refresh.
--   2. last successful acquisition facilities_refreshed_at      WRONG in one case: a failed read over a stored count of
--                                                               0 advanced the clock as if EPA had answered.
--   3. latest refresh outcome      facilities_unavailable       already correct; unchanged.
-- THE CHANGE: one helper, public.dev_facility_read_untrusted, whose body is exactly the expression that already decided
-- facilities_unavailable. When it is true, counts keeps the stored facility count and the stored coverage, and
-- facilities_refreshed_at is held. Sites, the EPA write-refusal rule, the core plane, CORE GUARD 2, the shape guard and
-- the cursor are unchanged. No new column: the three facts live in the two existing columns and the counts object.
--
-- FINGERPRINTS (prosrc of public.dev_refresh_collect):
--   SOURCE  md5 b17263cc5eca232dbde8fc33e27093e4, 16,593 chars  (production, read 2026-11-09; rebuilt locally by
--           test/dev_collect_inventory_pg/prep.sh and equal)
--   TARGET  md5 bd77573364bc41e2c5691b5f6643d6cf, 17,204 chars  (computed separately, in Python, from the source text)
-- Refused: any other body. Re-applying is a no-op on the exact TARGET. One transaction, short lock_timeout.
-- Reversal: docs/dev-refresh-collect-facility-inventory-reverse.sql.
-- Tests: test/dev_collect_inventory_pg/run.sh (disposable Postgres; CI dev-collect-carry-suite).
-- ============================================================================

\set ON_ERROR_STOP on
\echo APPLY dev_refresh_collect facility-inventory: start
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '60s';

-- PART 1 — the ONE decision "this facility read is not trusted" (additive). It is, verbatim, the expression the collector
-- already used for facilities_unavailable; the collector now asks it for all three facility columns.
create or replace function public.dev_facility_read_untrusted(_epa_ok boolean, _j jsonb, _cached_counts jsonb,
                                                             _cached_facilities_refreshed_at timestamptz)
returns boolean
language sql
stable
set search_path to 'public'
as $fn$
  select case
           when public.dev_epa_write_refused(_epa_ok, _j, _cached_counts, _cached_facilities_refreshed_at) then true
           when coalesce((_j->'counts'->>'facilities')::int, 0) > 0 then false
           when not (_epa_ok and coalesce((_j->'epa'->>'ok')::boolean, true)) then true
           else false
         end
$fn$;
revoke all on function public.dev_facility_read_untrusted(boolean, jsonb, jsonb, timestamptz) from public, anon, authenticated;

-- PART 2 — three exact replacements in the live collector.
do $mig$
declare
  c_orig_md5 constant text := 'b17263cc5eca232dbde8fc33e27093e4';
  c_orig_len constant int  := 16593;
  c_new_md5  constant text := 'bd77573364bc41e2c5691b5f6643d6cf';
  c_new_len  constant int  := 17204;
  olds text[] := array[
$a1$    -- counts: core keys from the payload; facilities preserved when the EPA write is refused.
    counts = case
               when public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)
                 then (j->'counts') || jsonb_build_object(
                        'facilities', coalesce((d.counts->>'facilities')::int, 0))
               else j->'counts'
             end,
$a1$,
$a2$    -- REGULATORY freshness. Advances only when the facility layer actually took a write.
    facilities_refreshed_at = case
                                when public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)
                                  then d.facilities_refreshed_at
                                else now()
                              end,
$a2$,
$a3$    facilities_unavailable = case
                               when public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at) then true
                               when coalesce((j->'counts'->>'facilities')::int, 0) > 0 then false
                               when not (epa_ok and coalesce((j->'epa'->>'ok')::boolean, true)) then true
                               else false
                             end
$a3$];
  news text[] := array[
$b1$    -- counts: core keys from the payload. (INVENTORY, docs/dev-refresh-collect-facility-inventory.sql) When this
    -- facility read is NOT TRUSTED (public.dev_facility_read_untrusted), the stored facility count AND the stored
    -- inventory coverage (counts.facilities_coverage) are kept, and the response's own coverage key is not taken: a
    -- failed refresh does not erase that the stored inventory was boundary-complete as of facilities_refreshed_at.
    counts = case
               when public.dev_facility_read_untrusted(epa_ok, j, d.counts, d.facilities_refreshed_at)
                 then ((j->'counts') - 'facilities_coverage')
                      || jsonb_build_object('facilities', coalesce((d.counts->>'facilities')::int, 0))
                      || jsonb_strip_nulls(jsonb_build_object('facilities_coverage', d.counts->'facilities_coverage'))
               else j->'counts'
             end,
$b1$,
$b2$    -- REGULATORY freshness = the LAST SUCCESSFUL facility acquisition. (INVENTORY) Advances only on a TRUSTED facility
    -- read; it used to advance on any write that was not refused, so a failed read over a stored count of 0 moved the
    -- clock as if EPA had answered.
    facilities_refreshed_at = case
                                when public.dev_facility_read_untrusted(epa_ok, j, d.counts, d.facilities_refreshed_at)
                                  then d.facilities_refreshed_at
                                else now()
                              end,
$b2$,
$b3$    -- (INVENTORY) the LATEST REFRESH OUTCOME. The same expression as before, moved into the one helper the two
    -- columns above also read, so "unavailable", "keep the stored inventory" and "hold the clock" cannot disagree.
    facilities_unavailable = public.dev_facility_read_untrusted(epa_ok, j, d.counts, d.facilities_refreshed_at)
$b3$];
  fn regprocedure := 'public.dev_refresh_collect()'::regprocedure;
  body text; after_body text; expect_body text; src_def text; after_def text; i int; n int;
  props_before text; props_after text;
begin
  select prosrc into body from pg_proc where oid = fn;
  raise notice 'EVIDENCE before: md5=% len=%', md5(body), length(body);
  if md5(body) = c_new_md5 and length(body) = c_new_len then
    raise notice 'EVIDENCE already at the TARGET fingerprint %; nothing changed', c_new_md5;
    return;
  end if;
  if md5(body) <> c_orig_md5 or length(body) <> c_orig_len then
    raise exception 'REFUSED: md5(prosrc) % / % is neither SOURCE (% / %) nor TARGET (% / %)',
      md5(body), length(body), c_orig_md5, c_orig_len, c_new_md5, c_new_len;
  end if;
  expect_body := body;
  for i in 1..3 loop
    n := (length(expect_body) - length(replace(expect_body, olds[i], ''))) / length(olds[i]);
    if n <> 1 then raise exception 'REFUSED: anchor % occurs % times (expected 1)', i, n; end if;
    expect_body := replace(expect_body, olds[i], news[i]);
  end loop;
  if md5(expect_body) <> c_new_md5 or length(expect_body) <> c_new_len then
    raise exception 'REFUSED: planned body fingerprints to % / %, not TARGET % / %', md5(expect_body), length(expect_body), c_new_md5, c_new_len;
  end if;
  select concat_ws('|', p.proowner::regrole::text, p.proacl::text, p.prosecdef, p.proconfig::text, p.provolatile, p.proparallel)
    into props_before from pg_proc p where p.oid = fn;
  src_def := pg_get_functiondef(fn);
  if (length(src_def) - length(replace(src_def, body, ''))) / length(body) <> 1 then
    raise exception 'REFUSED: the function definition does not contain its body exactly once';
  end if;
  execute replace(src_def, body, expect_body);
  select prosrc into after_body from pg_proc where oid = fn;
  if after_body <> expect_body then
    raise exception 'ROLLED BACK: stored body % / % is not the planned body', md5(after_body), length(after_body);
  end if;
  after_def := pg_get_functiondef(fn);
  if replace(after_def, after_body, '@BODY@') <> replace(src_def, body, '@BODY@') then
    raise exception 'ROLLED BACK: the function header/attributes changed';
  end if;
  select concat_ws('|', p.proowner::regrole::text, p.proacl::text, p.prosecdef, p.proconfig::text, p.provolatile, p.proparallel)
    into props_after from pg_proc p where p.oid = fn;
  if props_after <> props_before then
    raise exception 'ROLLED BACK: owner/ACL/attributes changed (% -> %)', props_before, props_after;
  end if;
  raise notice 'EVIDENCE after: md5=% len=% (TARGET)', md5(after_body), length(after_body);
end
$mig$;

commit;
\echo APPLY dev_refresh_collect facility-inventory: committed

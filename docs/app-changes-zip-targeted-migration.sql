-- app_changes.zip_targeted — the evidence flag the two-section Local News render
-- reads. PARKED: apply manually in the Supabase SQL editor (this repo's docs/*.sql
-- convention), never from a job.
--
-- WHY
-- ---
-- A ZIP page's Local News is county-sourced: app_refresh_zip anchors on
-- `community_id = coalesce(_root,_cid)`, so one county's stories populate every
-- ZIP page beneath it. Measured 2026-07-30: 60,941 Local News rows across 8,739
-- pages from 1,064 stories — 57.3 pages/story, max 347, zero stories on a single
-- page.
--
-- Those pages are not showing county-SCALE news. They are showing ANOTHER TOWN'S
-- news (Walburg 78673 shows Austin water policy; Ridgeway 29130 shows Columbia
-- weather alerts). A reader can tell those apart if the page does — but the page
-- could not, because `app_changes` carries no geo evidence at all and the site
-- reads `app_changes`, not `alerts`. This column is the minimum that makes the
-- distinction renderable.
--
-- WHAT IT IS NOT
-- --------------
-- NOT the page_target_zip flag, and NOT a step toward it. That flag is ruled
-- permanently false (baseline question 8): flipping it would empty 5,175 of 8,739
-- pages to recover 5 recoverable ones. This column delivers the same evidence
-- distinction as ORDERING instead of FILTERING — nothing is withheld from a page.
--
-- PROPERTIES
-- ----------
--   * ADDITIVE. New nullable-with-default column; no existing column changes.
--   * DEFAULT FALSE. Legacy rows read false, so they render in section 2 — the
--     labelled, disclosed side. Fails toward disclosure.
--   * WRITTEN UNCONDITIONALLY. The expression does NOT consult page_target_zip;
--     it is evaluated for every Local News row on every refresh.
--   * ALTERS NO ROW SELECTION. The Local News INSERT's WHERE clause, ordering and
--     `limit 48` are untouched, so no page gains or loses a single row.
--
-- EXPECTED EFFECT (measured against production before writing this)
--   3,530 of 8,739 pages (40.4%) get a non-empty section 1
--   22,925 of 60,941 items (37.6%) are zip_targeted
--   5,209 pages have no targeted item and degrade to one undifferentiated list

-- 1. the column ---------------------------------------------------------------
alter table public.app_changes
  add column if not exists zip_targeted boolean not null default false;

comment on column public.app_changes.zip_targeted is
  'True when the source alert''s resolver zip_set names THIS row''s zip — i.e. the '
  'story cites a place covering this ZIP, rather than merely sharing its county. '
  'Written unconditionally by app_refresh_zip, independent of the page_target_zip '
  'flag. Drives section ordering on the Local News tab; never filters.';

-- 2. app_refresh_zip: set it on the Local News insert -------------------------
-- ONLY the Local News INSERT changes: the column list gains `zip_targeted` and
-- the SELECT gains one expression. The WHERE clause, the ORDER BY and the
-- `limit 48` are byte-identical, so row selection is provably unchanged.
--
-- Apply by editing the live function body per the Evidence-5 method recorded in
-- LOCAL_NEWS_EXECUTION_BASELINE.md (guarded server-side rewrite, transactional
-- dry-run rolled back by sentinel exception, then apply). Do NOT hand-retype the
-- whole function: fetch the current body, apply this one hunk, and re-verify the
-- digest of an unaffected pilot ZIP (84337) before and after.
--
--   column list:   ..., confidence, lens)
--               -> ..., confidence, lens, zip_targeted)
--
--   select tail:   ..., coalesce(el->>'record_url', el->>'url'), 'Medium', 'value'
--               -> ..., 'Medium', 'value',
--                  ((a.geo_evidence->>'status') = 'routed'
--                   and (a.geo_evidence->'zip_set') ? _zip)
--
-- Note the expression deliberately does NOT treat method='countywide' as
-- targeted: a countywide story carries an empty zip_set and is county-scoped by
-- its own evidence, so section 2 is where it belongs. Measured: 34 such items.

-- 3. verification (run after applying, before considering it done) ------------
-- a. the column exists and defaults false
--    select column_name, data_type, column_default, is_nullable
--      from information_schema.columns
--     where table_schema='public' and table_name='app_changes'
--       and column_name='zip_targeted';
--
-- b. row selection is unchanged — refresh one pilot ZIP and confirm the row
--    count and the ordered title digest are identical to the pre-apply values
--    select app_refresh_zip('84337');
--    select count(*),
--           md5(string_agg(title, '|' order by occurred_at desc, id)) as digest
--      from public.app_changes where zip='84337' and category='Local News';
--
-- c. the flag is actually being set (a zero here means the expression is wrong,
--    not that no story qualifies — pair it with the control below)
--    select count(*) filter (where zip_targeted)     as targeted,
--           count(*) filter (where not zip_targeted) as other,
--           count(*)                                  as control_total
--      from public.app_changes where category='Local News';
--
-- d. rollback, if needed: the column is additive and unread by any other
--    consumer, so dropping it is safe and the function hunk reverts cleanly.
--    alter table public.app_changes drop column if exists zip_targeted;

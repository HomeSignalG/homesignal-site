-- ============================================================================================
-- PARKED · NOT APPLIED · NEEDS FOUNDER APPROVAL BEFORE IT IS RUN AGAINST PRODUCTION
-- ============================================================================================
-- resolved_projects.display_name — the title Map 1's land-assembly card shows (2026-10-29).
--
-- Why: homesignalmap.html used to hard-code "Stratos data center project — land assembly" on
-- every land card, so ZIP 84005 (project_key eagle-mountain) was labelled Stratos. The page now
-- reads the title from this column (resolved_projects is read with select=*), and falls back to
-- the neutral "Land assembly on record" while the column is absent or NULL. So the page works
-- the same before and after this file is applied; applying it only replaces the neutral title.
--
-- Measured 2026-10-29: resolved_projects has 2 rows (eagle-mountain, stratos-box-elder) and no
-- name column; anon can select all 18 columns (RLS policy "public read resolved_projects"). A new
-- column inherits anon's table-level SELECT, so select=* keeps working.
--
-- Values:
--   stratos-box-elder → 'Stratos data center project'   (the label the page showed before;
--                         MIDA PMN notice 1075195 names the "STRATOS PROJECT AREA")
--   eagle-mountain    → 'Eagle Mountain land assembly'   PROPOSAL FOR FOUNDER REVIEW: no record
--                         names this project; this only says where the land is.
--
-- Additive and idempotent. Rollback: alter table public.resolved_projects drop column display_name;
-- ============================================================================================

begin;

alter table public.resolved_projects add column if not exists display_name text;

update public.resolved_projects set display_name = 'Stratos data center project'
 where project_key = 'stratos-box-elder' and display_name is null;

-- PROPOSAL — founder to confirm or change the wording before applying.
update public.resolved_projects set display_name = 'Eagle Mountain land assembly'
 where project_key = 'eagle-mountain' and display_name is null;

-- Post-condition: both rows named, nothing else touched.
do $$
declare n int;
begin
  select count(*) into n from public.resolved_projects
   where project_key in ('stratos-box-elder','eagle-mountain') and display_name is not null;
  if n <> 2 then raise exception 'expected 2 named rows, found %', n; end if;
end $$;

commit;

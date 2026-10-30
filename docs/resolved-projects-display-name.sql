-- ============================================================================================
-- APPROVED IN PRINCIPLE (founder, 2026-10-29) · NOT YET APPLIED TO PRODUCTION
-- Applied only through its own reviewed release, after this file is merged.
-- ============================================================================================
-- resolved_projects.display_name (+ display_name_basis): the title Map 1's land-assembly card shows.
--
-- Why: homesignalmap.html used to hard-code "Stratos data center project — land assembly" on
-- every land card, so ZIP 84005 (project_key eagle-mountain) was labelled Stratos. The page reads
-- the title from this column (resolved_projects is read with select=*), and falls back to the
-- neutral "Land assembly on record" while the column is absent or NULL. So the page works the
-- same before and after this file is applied; applying it only replaces the neutral title.
--
-- Measured 2026-10-29: resolved_projects has 2 rows (eagle-mountain, stratos-box-elder) and 18
-- columns, none a name; anon reads it under RLS policy "public read resolved_projects". A new
-- column is covered by anon's table-level SELECT, so select=* keeps working.
--
-- Values (founder decision, 2026-10-29):
--   stratos-box-elder → 'Stratos data center project', basis 'record'
--       (MIDA PMN notice 1075195 names the "STRATOS PROJECT AREA").
--   eagle-mountain    → 'Eagle Mountain land assembly', basis 'descriptive'
--       JODY's own label for where the land is. No public record names this project, and the page
--       says so under the title ("Descriptive label by JODY. No public record names this project.").
--
-- ONE NAME AUTHORITY. For a project that has a resolved_projects row, this column is the only
-- stored project name. The development-dossier work (docs/development-dossier-design-2026-10-29.md)
-- must read it from here and must not store a second, competing name for the same project.
--
-- What this does NOT touch: id, project_key, community_id, every parcel row
-- (resolved_project_parcels), every route, and every other column of resolved_projects.
-- updated_at moves only if a trigger exists; none does (measured 2026-10-29: 0 user triggers).
--
-- Rollback (run by hand):
--   alter table public.resolved_projects drop column if exists display_name_basis,
--                                         drop column if exists display_name;
--   The page then shows the neutral title again. Nothing else reads these columns.
-- ============================================================================================

begin;

-- Fingerprint of everything that must not move, taken before any change.
create temp table _rp_before on commit drop as
  select md5(string_agg(project_key || ':' || id::text || ':' || coalesce(community_id::text, ''), ',' order by project_key collate "C")) as rows_md5,
         (select md5(coalesce(string_agg(project_id::text || ':' || coalesce(apn, '') || ':' || coalesce(zip, '') || ':' || in_anchor::text, ','
                                         order by project_id::text collate "C", apn collate "C", id::text collate "C"), ''))
            from public.resolved_project_parcels) as parcels_md5
    from public.resolved_projects;

alter table public.resolved_projects add column if not exists display_name text;
alter table public.resolved_projects add column if not exists display_name_basis text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'resolved_projects_display_name_basis_chk'
                    and conrelid = 'public.resolved_projects'::regclass) then
    alter table public.resolved_projects add constraint resolved_projects_display_name_basis_chk
      check ((display_name is null and display_name_basis is null)
          or (display_name is not null and btrim(display_name) <> ''
              and display_name_basis is not null              -- NULL IN (...) is NULL, which a CHECK accepts
              and display_name_basis in ('record', 'descriptive')));
  end if;
end $$;

comment on column public.resolved_projects.display_name is
  'The one stored name of this project (Map 1 land card, future dossier). NULL = neutral title.';
comment on column public.resolved_projects.display_name_basis is
  'record = a public record names the project; descriptive = JODY''s own label (the page says so).';

update public.resolved_projects set display_name = 'Stratos data center project', display_name_basis = 'record'
 where project_key = 'stratos-box-elder' and display_name is null;

update public.resolved_projects set display_name = 'Eagle Mountain land assembly', display_name_basis = 'descriptive'
 where project_key = 'eagle-mountain' and display_name is null;

-- Post-conditions: both rows named as decided; ids, keys, communities and parcels unchanged.
do $$
declare n int; b _rp_before; a_rows text; a_parcels text;
begin
  select count(*) into n from public.resolved_projects
   where (project_key = 'stratos-box-elder' and display_name = 'Stratos data center project' and display_name_basis = 'record')
      or (project_key = 'eagle-mountain' and display_name = 'Eagle Mountain land assembly' and display_name_basis = 'descriptive');
  if n <> 2 then raise exception 'expected the 2 decided names, found %', n; end if;
  select * into b from _rp_before;
  select md5(string_agg(project_key || ':' || id::text || ':' || coalesce(community_id::text, ''), ',' order by project_key collate "C"))
    into a_rows from public.resolved_projects;
  select md5(coalesce(string_agg(project_id::text || ':' || coalesce(apn, '') || ':' || coalesce(zip, '') || ':' || in_anchor::text, ','
                                 order by project_id::text collate "C", apn collate "C", id::text collate "C"), ''))
    into a_parcels from public.resolved_project_parcels;
  if a_rows is distinct from b.rows_md5 then raise exception 'project ids/keys/communities moved'; end if;
  if a_parcels is distinct from b.parcels_md5 then raise exception 'parcel associations moved'; end if;
end $$;

commit;

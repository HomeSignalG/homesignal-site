-- MAP 1 vs THE ZIP DEVELOPMENT LISTS, platform-wide (2026-11-12). Read-only.
-- Run with the service role (the database tool), in chunks by first ZIP digit if needed: db-read's read-only role
-- may not execute map1_dc_zip_members (42501, run 43322803351), and one national pass exceeds 60 s.
--
-- MEASURED 2026-11-12 (10 chunks, control 12,746 ZIP pages = the registry): 2,049 national member rows on 898 ZIP
-- pages, 210 of them Proposed, were drawn on Map 1 and absent from the ZIP page and development.html lists before
-- zipDevelopment. 0 app_projects rows carry a dc: key.
--
-- Map 1 in ZIP mode draws two development planes: app_projects members (app_projects_for_zip) and the
-- national data-centre plane (map1_dc_zip_members). Until lib/data.js zipDevelopment (2026-11-12) the ZIP
-- page and development.html listed only the first, so every national member below was drawn on the map and
-- missing from both lists and the Development tile. This counts that population, by status and state,
-- and checks the one assumption the combiner relies on: no record sits in both planes under one key.
--
-- Control: zip_pages must equal the registry count, and the national members must be > 0, or the query
-- shape is wrong (claims rule 5).
with reg as (
  select r.zip, c.state
  from public.canonical_zip_registry r
  left join public.communities c on c.level = 'zip' and c.zip_codes @> array[r.zip]
),
natl as (
  select reg.zip, reg.state, m.map_status, m.source_name, m.source_key
  from reg, lateral public.map1_dc_zip_members(reg.zip) m
  where m.zip_membership = 'member'
)
select 'control' as section, null::text as k1, null::text as k2,
       (select count(distinct zip) from reg) as zip_pages,
       (select count(*) from natl) as national_member_rows,
       (select count(distinct zip) from natl) as zips_with_national_members,
       (select count(*) from public.app_projects where source_key like 'dc:%') as app_projects_rows_with_dc_key
union all
select 'by_status', map_status, null, null, count(*), count(distinct zip), null from natl group by map_status
union all
select 'by_source', source_name, null, null, count(*), count(distinct zip), null from natl group by source_name
union all
select 'by_state', state, null, null, count(*), count(distinct zip), null from natl group by state
order by 1, 2;

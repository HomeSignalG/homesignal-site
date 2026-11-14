-- MAP 1 vs THE ZIP DEVELOPMENT LISTS, platform-wide (2026-11-12). Read-only.
-- Runs through db-read.yml (copy it under docs/adhoc/): the read-only role can execute map1_dc_zip_members since
-- 2026-11-14 (docs/map1-dc-zip-members-read-only-grant.sql; before that 42501, run 43322803351). One national pass
-- can exceed 60 s, so narrow `prefixes` below to a few first digits per run and add the chunks up.
--
-- MEASURED 2026-11-12 (10 chunks, control 12,746 ZIP pages = the registry): 2,049 national member rows on 898 ZIP
-- pages, 210 of them Proposed, were drawn on Map 1 and absent from the ZIP page and development.html lists before
-- zipDevelopment. 0 app_projects rows carry a dc: key.
--
-- SAME BUILDING IN BOTH PLANES, MEASURED 2026-11-14 (three prefix chunks; national rows 249 + 830 + 970 = 2,049,
-- equal to the count above, so the read was complete): 253 national members have an official development record
-- (app_projects, same ZIP) within 150 m; only 20 of those have one whose own name or type says data center
-- (9xxxx 5, 0-3xxxx 8, 4-8xxxx 7). Those 20 are the likely same-building pairs and both rows still list. The other
-- 233 are dense-city neighbours. No linking or hiding rule is built: that is a founder decision (CLAUDE.md, one
-- marker per building is decided only for OSM vs canonical pins, by name within 150 m).
--
-- Map 1 in ZIP mode draws two development planes: app_projects members (app_projects_for_zip) and the
-- national data-centre plane (map1_dc_zip_members). Until lib/data.js zipDevelopment (2026-11-12) the ZIP
-- page and development.html listed only the first, so every national member below was drawn on the map and
-- missing from both lists and the Development tile. This counts that population, by status and state,
-- and checks the one assumption the combiner relies on: no record sits in both planes under one key.
--
-- Control: zip_pages must equal the registry count, and the national members must be > 0, or the query
-- shape is wrong (claims rule 5).
with prefixes(d) as (select unnest(string_to_array('0,1,2,3,4,5,6,7,8,9', ','))),
reg as (
  select r.zip, c.state
  from public.canonical_zip_registry r
  left join public.communities c on c.level = 'zip' and c.zip_codes @> array[r.zip]
  where left(r.zip, 1) in (select d from prefixes)
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

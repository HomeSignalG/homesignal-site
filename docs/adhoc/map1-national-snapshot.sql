-- READ-ONLY national Map 1 snapshot (scratch; never merged to main). Every registry ZIP through
-- the ONE Map 1 reader; one summary row, then one row per published Map 1 row.
with m as (
  select r.zip, x.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) x),
k as (
  select zip, coalesce(canonical_entity_id::text, source_key) id, publication_basis, source_key, project_name,
         round(lat::numeric, 6) lat, round(lng::numeric, 6) lng, map_status, source_url, zip_membership from m)
select 'SUMMARY' tag,
       json_build_object('at', now(), 'registry', (select count(*) from public.canonical_zip_registry),
         'rows', (select count(*) from k), 'zips', (select count(distinct zip) from k),
         'canonical_rows', (select count(*) from k where publication_basis = 'canonical'),
         'canonical_entities', (select count(distinct id) from k where publication_basis = 'canonical'),
         'fp', (select md5(string_agg(k::text, '|' order by k::text collate "C")) from k))::text v
union all
select 'ROW', k::text from k
order by 1, 2 collate "C";

-- scratch: load step 1 overlap from pg_net response 43363 and fingerprint it (never merged)
drop function if exists geo.zz_probe_fn();
select geo.load_zcta_place_overlap(43363, '45c7e0e7b528c2021cb406e8f9aedc84') as load;
with src as (
  select f[2] z, f[10] g, coalesce(nullif(f[17],''),'0') p
  from (select string_to_array(l, '|') f from net._http_response r, regexp_split_to_table(r.content, E'\n') l where r.id = 43363) x
  where array_length(f,1) >= 17 and f[2] ~ '^\d{5}$' and f[10] <> ''
)
select
  (select md5(string_agg(z||'|'||g||'|'||p, ',' order by z||'|'||g collate "C")) from src) src_fp,
  (select md5(string_agg(zcta5||'|'||place_geoid||'|'||part_arealand, ',' order by zcta5||'|'||place_geoid collate "C")) from geo.zcta_place_overlap) tbl_fp,
  (select count(*) from geo.zcta_place_overlap where place_funcstat='A') incorporated_pairs,
  (select json_agg(json_build_object('zip',zcta5,'place',place_name,'share',round(area_share*100,1)) order by area_share desc) from geo.zcta_place_overlap where zcta5='98466') ctrl_98466,
  (select relrowsecurity from pg_class where oid='geo.zcta_place_overlap'::regclass) rls,
  has_table_privilege('anon','geo.zcta_place_overlap','select') anon_select,
  (select count(*) from information_schema.columns where table_name='communities' and column_name='census_place_geoid') col;

with done as (select z3::text p from geo.n5_shard where state='done'),
z424 as (select distinct zip from (
   select zcta5::text zip from geo.n5_boundary_membership where left(zcta5,3) in (select p from done)
   union select zip::text from geo.n5_association
   union select i.zip::text from preservation.app_project_identity i
          join geo.n5_accepted_source a on a.registry_id=coalesce(i.registry_id,'(null)')
         where i.snapshot_id='phase1-2026-09-01' and i.record_kind='development'
           and left(i.zip::text,3) in (select p from done)) q),
fc as (select p.zip zz, count(*) fac from public.app_projects p join z424 z on z.zip=p.zip where p.record_kind='facility' group by 1),
au as (select zcta5::text zz, count(*) auth from geo.n5_boundary_membership group by 1),
cand as (select z.zip, (m.zip is not null) pe, coalesce(m.data_quality,'NO_PAGE') cov,
                coalesce(au.auth,0) auth, coalesce(fc.fac,0) fac
         from z424 z left join public.app_community_meta m on m.zip=z.zip
                     left join au on au.zz=z.zip left join fc on fc.zz=z.zip),
g408 as (select zip from cand where pe and cov='pass' and (auth>0 or fac>=3)),
sh as (select m.zcta5::text zz, m.source_key, m.lat from geo.zip_authoritative_membership m
        where m.zcta5::text in (select zip from g408)),
dp as (select distinct p.zip zz, p.source_key from public.app_projects p join g408 g on g.zip=p.zip
        where p.record_kind='development'),
dpg as (select dp.zz, count(*) n from dp group by 1),
shg as (select sh.zz, count(*) n, count(*) filter (where sh.lat is not null) pts from sh group by 1),
inter as (select sh.zz, count(*) n from sh join dp on dp.zz=sh.zz and dp.source_key=sh.source_key group by 1),
rowsx as (select g.zip,
   coalesce(s.status,'not_measured') st,
   coalesce(dpg.n,0) prod, coalesce(shg.n,0) shadow, coalesce(inter.n,0) inter,
   coalesce(shg.pts,0) pts
 from g408 g
 left join geo.maps_zip_geography_status s on s.zip=g.zip
 left join dpg on dpg.zz=g.zip left join shg on shg.zz=g.zip left join inter on inter.zz=g.zip),
lines as (select zip,
  zip||','||st||','||prod||','||shadow||','||inter||','
  ||(case when st='boundary_complete' then (prod-inter)::text else '' end)||','
  ||(shadow-inter)||','||pts||',0,'
  ||(case when st<>'boundary_complete' then 'PRESERVES_LEGACY'
          when pts=shadow then 'YES' else 'NO' end) ln
 from rowsx)
-- ---------------------------------------------------------------------------
-- ARTIFACT: docs/maps-coverage/unit-a-408-shadow-comparison.csv
--   header: zip,geo_status,production_dev_pairs,shadow_dev_pairs,intersection,
--           production_only_refuted,shadow_only_added,points_resolved,
--           missing_descriptive_fields,satisfies_maps_shape
--   body md5: a47ee48021259bad5b6a4f2e94c33fb1  (408 rows, 2026-09-03)
--   DB side: select md5(string_agg(ln, chr(10) order by zip collate "C")) from lines;
--   file side: tail -n +2 FILE | head -c -1 | md5sum
--
-- READ-ONLY. Production is queried SEPARATELY from the shadow product; the shadow read
-- never executes the legacy path to make a comparison convenient, which is the only way
-- the two answers stay independent.
--
-- `production_only_refuted` is written ONLY for boundary_complete ZIPs. On a not_measured
-- ZIP nothing is refuted, because nothing would change: production is preserved.
--
-- `missing_descriptive_fields` is 0 on every row, and that is a measurement rather than a
-- default: the exceptions set (authoritative source_keys with no development row anywhere
-- in app_projects) was computed on its own and is EMPTY — 0 of 1,875 projects.

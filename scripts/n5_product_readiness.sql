with done as (select z3::text p from geo.n5_shard where state='done'),
mem as (select zcta5::text zip, source_key from geo.n5_boundary_membership
         where left(zcta5,3) in (select p from done)),
zbase as (select distinct zip from (
    select zip from mem
    union select zip::text from geo.n5_association
    union select i.zip::text from preservation.app_project_identity i
           join geo.n5_accepted_source a on a.registry_id=coalesce(i.registry_id,'(null)')
          where i.snapshot_id='phase1-2026-09-01' and i.record_kind='development'
            and left(i.zip::text,3) in (select p from done)) q),
ap as (select p.zip, p.source_key, p.record_kind from public.app_projects p
        join zbase b on b.zip=p.zip where p.record_kind in ('development','facility')),
dp as (select distinct zip, source_key from ap where record_kind='development'),
dr as (select zip, count(*) rows from ap where record_kind='development' group by zip),
fc as (select zip, count(*) fac from ap where record_kind='facility' group by zip),
memg as (select zip, count(*) auth from mem group by zip),
dpg as (select zip, count(*) pairs from dp group by zip),
cf as (select m.zip, count(*) confirmed from mem m join dp on dp.zip=m.zip and dp.source_key=m.source_key group by m.zip),
agg as (
  select b.zip, left(b.zip,3) zip3,
    (m.zip is not null) page_exists,
    coalesce(m.data_quality,'NO_PAGE') cov,
    coalesce(m.indexable,false) idx,
    coalesce(memg.auth,0) auth_dev,
    coalesce(dpg.pairs,0) disp_pairs,
    coalesce(dr.rows,0) disp_rows,
    coalesce(cf.confirmed,0) confirmed,
    coalesce(fc.fac,0) facilities
  from zbase b
  left join public.app_community_meta m on m.zip=b.zip
  left join memg on memg.zip=b.zip
  left join dpg on dpg.zip=b.zip
  left join dr on dr.zip=b.zip
  left join cf on cf.zip=b.zip
  left join fc on fc.zip=b.zip),
cls as (
  select *, (page_exists and cov='pass' and (auth_dev>0 or facilities>=3)) proj_idx,
    case when not page_exists then 'E'
         when auth_dev>0 and idx and cov='pass' then 'A'
         when auth_dev>0 then 'B'
         when facilities>=3 then 'C'
         else 'D' end klass
  from agg),
lines as (
  select cls.*,
    zip||','||zip3||','||(case when page_exists then 'yes' else 'no' end)||','||cov||','
    ||(case when idx then 'yes' else 'no' end)||','||auth_dev||','||disp_pairs||','||disp_rows||','
    ||confirmed||','||(disp_pairs-confirmed)||','||(auth_dev-confirmed)||','||facilities||','
    ||(case when proj_idx then 'yes' else 'no' end)||','||klass||','
    ||(case when not page_exists then 'NO_PRODUCTION_PAGE'
            when auth_dev=0 and facilities<3 then 'NO_SUBSTANTIVE_MAPS_CONTENT'
            when auth_dev=0 then 'ZERO_DEV_FACILITIES_ONLY'
            when not idx then 'NOT_INDEXABLE_TODAY'
            else 'SITE_WIDE_DELIVERY_ONLY' end) ln
  from cls)
-- ---------------------------------------------------------------------------
-- ARTIFACT: docs/maps-coverage/completed-shards-product-readiness.csv
--   header: zip,zip3,page_exists,coverage_state,indexable_now,authoritative_dev,
--           displayed_dev_pairs,displayed_dev_rows,confirmed,display_over_inclusive,
--           display_under_inclusive,facilities,indexable_after_switch,readiness_class,blocker
--   body md5 (no header, no trailing newline):
--     select md5(string_agg(ln, chr(10) order by zip collate "C")) from lines;
--     --> d67f9cc3783cf775d42b35f91103cc7f   (424 rows, 2026-09-03)
--   file side: tail -n +2 FILE | head -c -1 | md5sum
--
-- READ-ONLY. This file measures; it changes nothing.
--
-- THE UNIT IS THE (ZIP, PROJECT) PAIR, NEVER THE ROW. app_projects carries one row per
-- (zip, source_key, source_seq), so a multi-coordinate project contributes several rows to
-- one page: 50,086 rows on these ZIPs are 19,978 distinct pairs. Boundary membership is
-- keyed (zcta5, source_key), so only the pair compares.
--
-- `indexable_after_switch` uses the project's OWN substance gate verbatim —
-- docs/app-content-materialize.sql:108, `indexable := (pass) AND (_ndp > 0 OR _nfc >= 3)`.
-- No new numeric threshold is introduced here.
--
-- `blocker` = NOT_INDEXABLE_TODAY covers two distinct causes; see PRODUCT-READINESS-424.md §6
-- (01034 is coverage_coming, 06390 is one facility short of the substance bar today).

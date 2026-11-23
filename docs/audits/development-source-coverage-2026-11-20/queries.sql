-- Production read-only queries used by the development-source coverage audit.
-- Project: qwnnmljucajnexpxdgxr. Round 1 and 2 ran on 2026-11-20 (first query 19:27:37Z); serving generation then: n5-national-2026-11-20.
-- The family inventory (Q2) was regenerated 2026-11-21 14:46:35Z, generation n5-national-2026-11-21 (the generation had advanced; figures may differ slightly).
-- Only SELECTs and the STABLE function n5_projects_within_radius were run. Statements were sent one per call (the tool returns only the last result).
-- Several queries use `set local statement_timeout='55s'`. A national anti-join of geo.n5_geom against app_projects timed out and was not run.

-- Q1  identity of the live radius function and the serving generation
select now(), md5(prosrc) radius_md5, prosrc like '%n5_gen_proven_point%' has_rev4
  from pg_proc where oid='public.n5_projects_within_radius(double precision,double precision,numeric,integer)'::regprocedure;
select string_agg(generation_id||':'||state, ', ') from geo.n5_generation where state in ('ACTIVE','ACTIVE_LEGACY','READY','BUILDING');
-- result 2026-11-20: radius_md5 b8393ee3aed96fe84c8ea436be8acc00, has_rev4 true, generation n5-national-2026-11-20:ACTIVE

-- Q2  261-family inventory. The id list is registry-family-ids.txt (generated from jurisdiction-registry.json, not typed).
-- Paste it into the $$...$$ literal. A 600-character pad column was added so the tool saved the result to a file; scripts/build_inventory.mjs strips it.
with reg as (select unnest(string_to_array($$<contents of registry-family-ids.txt>$$, ',')) id),
app as (select registry_id id, count(distinct source_key) keys from public.app_projects where record_kind='development' and registry_id is not null group by 1),
gen as (select registry_id id, count(*) n from geo.n5_gen_proven_point where generation_id=(select generation_id from geo.n5_generation where state='ACTIVE') group by 1),
rec as (select registry_id id, count(distinct source_key) n from geo.n5_geom where outcome=1 and provenance='recovered_authoritative' group by 1),
snap as (select registry_id id, count(distinct source_key) n from geo.n5_geom where outcome=1 and provenance='proven_stored_point' group by 1),
ver as (select registry_id id, count(*) n from geo.n5_generation_key_verdict where generation_id=(select generation_id from geo.n5_generation where state='ACTIVE') group by 1),
acc as (select registry_id id, treatment from geo.n5_accepted_source),
hl as (select registry_id id, fetch_failures_24h f, blocked_24h b, truncated_24h t from public.dev_change_source_fetch_health)
select r.id, coalesce(app.keys,0) app_keys, coalesce(gen.n,0) gen_pts, coalesce(rec.n,0) recovered_geom, coalesce(snap.n,0) snapshot_pts,
       coalesce(ver.n,0) verdict_rejects, acc.treatment, coalesce(hl.f,0) fetch_failures_24h, coalesce(hl.b,0) blocked_24h, coalesce(hl.t,0) truncated_24h,
       now()::text queried_at, (select generation_id from geo.n5_generation where state='ACTIVE') generation_id, repeat('x',600) pad
from reg r left join app using(id) left join gen using(id) left join rec using(id) left join snap using(id)
     left join ver using(id) left join acc using(id) left join hl using(id) order by r.id;

-- Q3  per-ZIP: app_projects development keys vs serving membership (ZIPs 85083, 48854, 64166), generation n5-national-2026-11-20
with z(zip) as (values ('85083'),('48854'),('64166')),
ap as (select a.zip, a.source_key, a.registry_id, max(a.last_seen_at) ls from public.app_projects a join z on z.zip=a.zip where a.record_kind='development' group by 1,2,3),
mem as (select m.zcta5::text zip, m.source_key from geo.n5_serving_membership m join z on z.zip=m.zcta5::text where m.generation_id='n5-national-2026-11-20' and m.record_kind='development'),
elsewhere as (select ap.zip, ap.source_key from ap where exists (select 1 from geo.n5_serving_membership m2 where m2.generation_id='n5-national-2026-11-20' and m2.source_key=ap.source_key and m2.zcta5::text<>ap.zip)),
anymem as (select ap.zip, ap.source_key from ap where exists (select 1 from geo.n5_serving_membership m2 where m2.generation_id='n5-national-2026-11-20' and m2.source_key=ap.source_key)),
pp as (select ap.zip, ap.source_key from ap where exists (select 1 from geo.n5_gen_proven_point p where p.generation_id='n5-national-2026-11-20' and p.source_key=ap.source_key)),
vd as (select ap.zip, ap.source_key from ap where exists (select 1 from geo.n5_generation_key_verdict v where v.generation_id='n5-national-2026-11-20' and v.source_key=ap.source_key))
select ap.zip, ap.registry_id, count(*) app_keys,
 count(*) filter (where exists(select 1 from mem where mem.zip=ap.zip and mem.source_key=ap.source_key)) in_own_zip_map,
 count(*) filter (where exists(select 1 from elsewhere e where e.zip=ap.zip and e.source_key=ap.source_key)) in_other_zip_map,
 count(*) filter (where not exists(select 1 from anymem a2 where a2.zip=ap.zip and a2.source_key=ap.source_key)) in_no_map,
 count(*) filter (where exists(select 1 from pp where pp.zip=ap.zip and pp.source_key=ap.source_key)) has_gen_point,
 count(*) filter (where exists(select 1 from vd where vd.zip=ap.zip and vd.source_key=ap.source_key)) has_verdict,
 min(ap.ls)::date oldest_seen, max(ap.ls)::date newest_seen
from ap group by 1,2 order by 1,3 desc;
-- NOTE: "own ZIP" and "other ZIP" overlap (boundary points, multi-geometry keys). They are not a partition and not ground truth.

-- Q4  verdicts for the 48854 MDOT keys
select source_key, registry_id, verdict, left(detail::text,160) d, recorded_at from geo.n5_generation_key_verdict
 where generation_id='n5-national-2026-11-20' and source_key in (select source_key from public.app_projects where zip='48854' and record_kind='development');

-- Q5  all app_projects copies of the MDOT keys 215962, 226633 (and siblings 227401, 227403)
select source_key, zip, lat, lng, name, status, submitted_at, last_seen_at, created_at, source_seq, left(address,50) addr
  from public.app_projects where source_key in ('arcgis:mdot-stip-projects:215962','arcgis:mdot-stip-projects:226633','arcgis:mdot-stip-projects:227401','arcgis:mdot-stip-projects:227403') order by source_key, zip, lat;

-- Q6  radius function at the ZIP stored centres, various radii (limit 1000); development_reports home_lat/home_lng
--     85083 (33.7352,-112.1294) 0.5/1/2/5; 48854 (42.5796,-84.4561) 1/5; 64166 (39.3177,-94.5196) 1/5
select count(*) n_rows, count(distinct q.source_key) n_keys, bool_or(q.has_more) has_more,
  count(distinct q.source_key) filter (where exists (select 1 from public.app_projects a where a.source_key=q.source_key and a.record_kind='development')) n_hydrated
from public.n5_projects_within_radius(33.7352,-112.1294,2::numeric,1000) q;

-- Q7  unhydrated keys at 85083, 2 mi (157 of 442 on 2026-11-20): not in app_projects, not in membership, not in generation points
with q as (select source_key, registry_id from public.n5_projects_within_radius(33.7352,-112.1294,2::numeric,1000)),
u as (select * from q where not exists (select 1 from public.app_projects a where a.source_key=q.source_key and a.record_kind='development'))
select count(*) unhydrated,
 count(*) filter (where exists (select 1 from geo.n5_serving_membership m where m.generation_id='n5-national-2026-11-20' and m.source_key=u.source_key)) in_serving_membership,
 count(*) filter (where exists (select 1 from geo.n5_gen_proven_point p where p.generation_id='n5-national-2026-11-20' and p.source_key=u.source_key)) in_gen_point from u;

-- Q8  snapshot keys with no development row, bounded to four families (Phoenix 7,460/21,543; KCMO building 3,716/3,716; MDOT 22/626; KCMO cases 88/2,404)
select g.registry_id, count(*) geom_keys,
 count(*) filter (where not exists (select 1 from public.app_projects a where a.source_key=g.source_key and a.record_kind='development')) no_dev_row
from geo.n5_geom g where g.registry_id in ('phoenix-building-permits','kcmo-building-permits','mdot-stip-projects','kcmo-development-cases') and g.outcome=1 and g.geom is not null group by 1;

-- Q9  KCMO identity migration and scope classification of the 3,716 old arcgis keys
with cur as (select split_part(source_key,':',4) id from public.app_projects where registry_id='kcmo-building-permits' and record_kind='development'),
old as (select split_part(source_key,':',3) id from geo.n5_geom where registry_id='kcmo-building-permits' and outcome=1 and source_key like 'arcgis:%')
select (left(o.id,4) in ('CPBC','CPBR','CPDC','CPDR')) in_scope, substr(o.id,6,4) yr, count(*) n,
       count(*) filter (where exists (select 1 from cur where cur.id=o.id)) in_cur_new_key from old o group by 1,2 order by 1,2;
-- results: out-of-scope 2,920; in-scope 796, of which 256 share the exact permit number with a current socrata key.

-- Q10 ledger rows for sampled old keys (exact identity_key match)
select identity_key, registry_id from public.dev_change_project where identity_key in
 ('arcgis:phoenix-building-permits:25017950','arcgis:phoenix-building-permits:T969035','arcgis:phoenix-building-permits:25015631','arcgis:phoenix-building-permits:T970655',
  'arcgis:phoenix-building-permits:25019389','arcgis:phoenix-building-permits:214274','arcgis:kcmo-building-permits:CPBC-2025-00870','arcgis:kcmo-building-permits:CPBC-2025-00270',
  'socrata:data.kcmo.org:w8jz-wjgn:CPBC-2025-00870');

-- Q11 Phoenix orphan sample (14 keys, ordered by md5(source_key))
with q as (select source_key, registry_id from public.n5_projects_within_radius(33.7352,-112.1294,2::numeric,1000)),
u as (select * from q where not exists (select 1 from public.app_projects a where a.source_key=q.source_key and a.record_kind='development'))
select string_agg(source_key, ' ' order by md5(source_key)) from (select source_key from u where registry_id='phoenix-building-permits' order by md5(source_key) limit 14) s;

-- Q12 report-input export for the four test subjects (radius 0.5 mi; hydrate, ledger, events, health). The saved result is data.json (NOT committed).
with s(n,lat,lng) as (values ('S1',33.7359618783347,-112.129279887116),('S2',42.5796,-84.4561),('S3',39.316609376222,-94.511564544437),('S4',33.7134154669538,-112.201473975353)),
r as (select s.n, q.* from s cross join lateral public.n5_projects_within_radius(s.lat,s.lng,0.5::numeric,1000) q),
k as (select distinct source_key, registry_id from r),
h as (select distinct on (a.source_key) a.source_key,a.registry_id,a.record_kind,a.name,a.type,a.type_raw,a.status,a.stage,a.developer,a.size,a.investment,a.submitted_at,a.date_kind,a.address,a.source_ref,a.provenance,a.scope_text,a.start_date,a.end_date
      from public.app_projects a where a.record_kind='development' and a.source_key in (select source_key from k) order by a.source_key, a.last_seen_at desc)
select jsonb_build_object(
 'radius', (select jsonb_object_agg(n, rows) from (select n, jsonb_agg(jsonb_build_array(source_key,feature_id,registry_id,provenance,round(distance_mi::numeric,4),geometry_type,has_more,marker_lat,marker_lng) order by distance_mi) rows from r group by n) t),
 'hydrate', (select jsonb_agg(jsonb_strip_nulls(to_jsonb(h))) from h),
 'ledger', (select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.dev_change_project p where p.identity_key in (select source_key from k)),
 'events', (select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.dev_change_event_reportable e where e.identity_key in (select source_key from k) and e.observed_at >= '2026-08-22'),
 'health', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.dev_change_source_fetch_health x where x.registry_id in (select distinct registry_id from k where registry_id is not null))
)::text as j;

-- Q13 dense 0.5 mi points, limit 2000 (Manhattan midtown 40.7580,-73.9855; Chicago Loop 41.8819,-87.6278; Brooklyn Williamsburg 40.7081,-73.9571; Miami Brickell 25.7617,-80.1918)
-- results: Manhattan 2000 rows (more than 2000), 368 unhydratable; Chicago 637/116; Brooklyn 605/93; Miami 474/98.
select count(*) rows_at_2000, bool_or(has_more) more_than_2000, count(distinct source_key) keys,
 count(distinct source_key) filter (where not exists (select 1 from public.app_projects a where a.source_key=r.source_key and a.record_kind='development')) unhydratable
from public.n5_projects_within_radius(40.7580,-73.9855,0.5::numeric,2000) r;

-- Q14 5 mi at limit 2000 (customer reports are fixed at 0.5 mi; this concerns other radius consumers): 85083 -> 2000 rows, more=true, 1,491 hydratable; 64166 -> 1,014 rows, 603 hydratable.

-- Q15 membership vs report admission for the admitted-nowhere / partial families (equal in all 12)
with a as (select distinct source_key, registry_id from public.app_projects where record_kind='development' and registry_id in
 ('boulder-county-accela-applications','caltrans-sb1-projects','longmont-active-development','maine-dot-public-projects','ncdot-stip-projects-points','fairfax-active-site-construction',
  'desoto-county-permits','cook-county-il-highway-construction-program','lake-county-il-construction-program','kcmo-capital-projects','phoenix-proposed-zoning','tillamook-county-land-use-cases'))
select a.registry_id, count(*) app_keys,
 count(*) filter (where exists (select 1 from geo.n5_serving_membership m where m.generation_id='n5-national-2026-11-20' and m.source_key=a.source_key)) on_map1_membership,
 count(*) filter (where exists (select 1 from geo.n5_geom g where g.source_key=a.source_key and g.outcome=1 and g.geom is not null)) in_report_radius_via_n5_geom,
 count(*) filter (where exists (select 1 from geo.n5_gen_proven_point p where p.generation_id='n5-national-2026-11-20' and p.source_key=a.source_key)) in_report_radius_via_gen_point
from a group by 1 order by 1;
-- fairfax-recent-building-permits (9,419 keys) was not in this query; it has zero generation, recovered and snapshot points in Q2.

-- Q16 national verdict totals and plane sizes, generation n5-national-2026-11-20
select (select jsonb_object_agg(verdict, n) from (select verdict, count(*) n from geo.n5_generation_key_verdict where generation_id='n5-national-2026-11-20' group by 1) v) verdicts,
 (select count(distinct source_key) from geo.n5_serving_membership where generation_id='n5-national-2026-11-20' and record_kind='development') membership_keys,
 (select count(*) from geo.n5_gen_proven_point where generation_id='n5-national-2026-11-20') gen_points,
 (select count(distinct source_key) from geo.n5_geom where outcome=1 and provenance='recovered_authoritative') recovered_keys,
 (select count(distinct source_key) from geo.n5_geom where outcome=1 and provenance='proven_stored_point') snapshot_keys;
-- result: MULTI_COORD_UNRESOLVED 4593, RECOVERY_UNSTABLE_IDENTITY 261, SOURCE_EXCLUDED 107, NULL_COORD 12, RECOVERY_NOT_RETURNED 5; membership 891,569; gen points 735,227; recovered 174,516; snapshot 718,278.

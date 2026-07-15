-- ============================================================================
-- MINNESOTA development_reports seed — REPRODUCIBLE pg_net REFRESH SCRIPT
-- (pattern: docs/washington-development-reports-seed.sql; run in the Supabase SQL editor)
--
-- Built 2026-07-15: all 172 modeled MN ZIPs (Hennepin, Ramsey, Washington, Dakota,
-- Stearns, Carver, Olmsted, Wright, Anoka, Scott, Sherburne + single-ZIP roots)
-- cached through the live get-address-report engine and materialized into app_*.
--
-- Development depth for MN comes from ONE first-party source wired this pass
-- (jurisdiction-registry.json): minneapolis-ccs-permits — the Denver
-- spatial_zip_radius_mi pattern (point layer, no ZIP/site-address columns),
-- fresh 2026-07-13, trades dropped at source. The corrected-URL retries found
-- the real St. Paul / Ramsey / Rochester / Dakota portals but none wireable
-- (receipts: docs/source-registry.md "MINNESOTA WIRE PASS").
--
-- Centroids pinned to the zipcodes PyPI v3.0.0 offline USPS dataset (§12.0);
-- 0 quarantined for MN, all inside the MN bounding box.
-- INDEX POLICY: the nationwide substance gate stamps indexable automatically —
-- no manual flip; the throttled sitemap (250 newcomers/day) rolls new pages in.
-- ============================================================================

-- 1) Stage the pinned centroids -------------------------------------------------
drop table if exists public._mn_zips;
create table public._mn_zips(zip text primary key, lat float8, lng float8);
insert into public._mn_zips(zip,lat,lng) values
('55001',44.8697,-92.8234),
('55003',45.0214,-92.7844),
('55005',45.3887,-93.2315),
('55011',45.3414,-93.235),
('55013',45.3611,-92.8921),
('55014',45.1528,-93.144),
('55016',44.8308,-92.9393),
('55020',44.5647,-93.3269),
('55024',44.6628,-93.1539),
('55025',45.2685,-92.9749),
('55031',44.6028,-92.9467),
('55033',44.7129,-92.8637),
('55038',45.1824,-92.9452),
('55040',45.4682,-93.2266),
('55042',44.9946,-92.9056),
('55043',44.9394,-92.7716),
('55044',44.6749,-93.2578),
('55047',45.1988,-92.8258),
('55054',44.5647,-93.3269),
('55055',44.8725,-92.9986),
('55057',44.4587,-93.1668),
('55065',44.5274,-93.0196),
('55068',44.7394,-93.1258),
('55070',45.3903,-93.3598),
('55071',44.8344,-92.9873),
('55073',45.2697,-92.8292),
('55075',44.8881,-93.046),
('55076',44.8288,-93.0391),
('55077',44.8283,-93.094),
('55082',45.0614,-92.8474),
('55083',45.021,-92.9837),
('55085',44.6748,-92.9683),
('55101',44.9512,-93.0902),
('55102',44.9372,-93.1209),
('55103',44.9608,-93.1216),
('55104',44.9532,-93.158),
('55105',44.9347,-93.1651),
('55106',44.9684,-93.0488),
('55107',44.9325,-93.088),
('55108',44.9806,-93.1771),
('55109',45.0132,-93.0297),
('55110',45.08,-93.0223),
('55112',45.0788,-93.1872),
('55113',45.0139,-93.1571),
('55115',45.071,-92.9391),
('55116',44.914,-93.1727),
('55117',44.9995,-93.0969),
('55118',44.8925,-93.1221),
('55119',44.9414,-93.0107),
('55120',44.8744,-93.153),
('55121',44.8422,-93.168),
('55122',44.8028,-93.1977),
('55123',44.805,-93.1367),
('55124',44.7465,-93.202),
('55125',44.9197,-92.9439),
('55126',45.0736,-93.138),
('55127',45.0803,-93.0875),
('55128',44.9913,-92.9487),
('55129',44.8985,-92.923),
('55301',45.2534,-93.6469),
('55303',45.2825,-93.4186),
('55304',45.2377,-93.2724),
('55305',44.9528,-93.4372),
('55313',45.1814,-93.8635),
('55315',44.7169,-93.6879),
('55316',45.17,-93.3819),
('55317',44.8679,-93.5359),
('55318',44.8061,-93.6083),
('55320',45.3877,-94.0452),
('55328',45.0342,-93.8016),
('55330',45.3136,-93.5814),
('55331',44.9007,-93.5791),
('55340',45.08,-93.576),
('55341',45.1602,-93.6734),
('55343',44.914,-93.4481),
('55344',44.8574,-93.4376),
('55345',44.9138,-93.485),
('55346',44.8771,-93.483),
('55347',44.8342,-93.4389),
('55352',44.6713,-93.6195),
('55353',45.3436,-94.3028),
('55356',44.9912,-93.5818),
('55357',45.1061,-93.6692),
('55360',44.9022,-93.8859),
('55362',45.2956,-93.8023),
('55363',45.0442,-93.9139),
('55364',44.9382,-93.6561),
('55367',44.8994,-93.9701),
('55368',44.7736,-93.9216),
('55369',45.1284,-93.4589),
('55372',44.7107,-93.4101),
('55373',45.0882,-93.7237),
('55374',45.1715,-93.5814),
('55375',44.9041,-93.749),
('55376',45.2064,-93.6593),
('55377',45.5402,-93.8154),
('55378',44.7615,-93.3434),
('55379',44.7793,-93.5197),
('55382',45.2925,-94.2119),
('55384',44.9356,-93.6341),
('55386',44.8582,-93.6561),
('55387',44.851,-93.7784),
('55388',44.9595,-93.8482),
('55397',44.7929,-93.918),
('55401',44.9835,-93.2683),
('55402',44.9762,-93.2759),
('55403',44.9673,-93.2828),
('55404',44.9609,-93.2642),
('55405',44.9702,-93.3047),
('55406',44.9384,-93.2214),
('55407',44.9378,-93.2545),
('55408',44.9466,-93.2862),
('55409',44.9264,-93.2818),
('55410',44.9124,-93.3188),
('55411',44.9996,-93.3005),
('55412',45.0242,-93.302),
('55413',44.998,-93.2552),
('55414',44.9779,-93.2199),
('55415',44.9742,-93.2585),
('55416',44.9497,-93.3373),
('55417',44.9054,-93.2361),
('55418',45.0192,-93.2401),
('55419',44.9026,-93.2886),
('55420',44.8358,-93.2778),
('55422',45.0096,-93.3424),
('55423',44.8756,-93.2553),
('55424',44.9052,-93.3403),
('55425',44.8427,-93.2363),
('55426',44.955,-93.3829),
('55427',45.0,-93.391),
('55428',45.0632,-93.3811),
('55429',45.0645,-93.3413),
('55430',45.0639,-93.3022),
('55431',44.8288,-93.3118),
('55435',44.8735,-93.3346),
('55436',44.9034,-93.374),
('55437',44.8261,-93.3538),
('55438',44.8266,-93.375),
('55439',44.8744,-93.3753),
('55441',45.0058,-93.4193),
('55442',45.0467,-93.431),
('55443',45.1194,-93.3431),
('55444',45.1178,-93.3054),
('55445',45.1232,-93.3797),
('55446',45.04,-93.4865),
('55447',45.0033,-93.4875),
('55901',44.0496,-92.4896),
('55902',44.0032,-92.4835),
('55904',44.0105,-92.3973),
('55906',44.1078,-92.4053),
('55920',44.0373,-92.6308),
('55929',44.0015,-92.1415),
('55934',44.0099,-92.2648),
('55944',44.024,-92.7464),
('55956',44.2646,-92.5207),
('55960',44.1489,-92.485),
('55976',43.8555,-92.4885),
('56301',45.541,-94.1819),
('56303',45.5713,-94.2036),
('56304',45.5521,-94.1284),
('56307',45.6151,-94.574),
('56310',45.6122,-94.436),
('56320',45.45,-94.4378),
('56321',45.5783,-94.4199),
('56336',45.8252,-94.7467),
('56340',45.7249,-94.4581),
('56352',45.6582,-94.8198),
('56362',45.3988,-94.7157),
('56367',45.7364,-94.1658),
('56368',45.4605,-94.5361),
('56374',45.5651,-94.3367),
('56377',45.6318,-94.2136);

-- 2) FIRE in waves of ~90 (offset 0 / 90; wait ~4 min per wave) -------------------
select count(net.http_post(
  'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
  jsonb_build_object('zip', zip, 'lat', lat, 'lng', lng),
  '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 120000)) as fired
from (select * from public._mn_zips order by zip limit 90 offset 0) w;

-- 3) COLLECT the 200s (after each wave; transient-safe upsert) --------------------
insert into public.development_reports (zip, home_lat, home_lng, counts, sites, paywall, source_vintage, refreshed_at)
select (j->>'zip'), (j->'home'->>'lat')::float8, (j->'home'->>'lng')::float8, j->'counts', j->'sites',
       coalesce((j->>'paywall')::bool,false),
       'zipcodes PyPI v3.0.0 centroid; get-address-report ZIP mode; Minnesota batch 2026-07-15',
       now()
from (
  select distinct on ((content::jsonb->>'zip')) content::jsonb j
  from net._http_response resp
  where resp.status_code = 200 and left(ltrim(resp.content),1)='{'
    and (content::jsonb->>'zip') in (select zip from public._mn_zips)
    and resp.created > now() - interval '30 minutes'
  order by (content::jsonb->>'zip'), resp.created desc
) r
on conflict (zip) do update set
  home_lat=excluded.home_lat, home_lng=excluded.home_lng, counts=excluded.counts,
  sites=excluded.sites, paywall=excluded.paywall, source_vintage=excluded.source_vintage,
  refreshed_at=excluded.refreshed_at
where jsonb_array_length(excluded.sites) > 0 or jsonb_array_length(public.development_reports.sites) = 0;

-- 4) RE-FIRE any missing ZIP (timeouts), then re-run step 3 -----------------------
--   select count(net.http_post('https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
--     jsonb_build_object('zip', w.zip, 'lat', w.lat, 'lng', w.lng),
--     '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 180000))
--   from public._mn_zips w where not exists (select 1 from public.development_reports d where d.zip = w.zip);

-- 5) MATERIALIZE (idempotent; stamps `indexable`) ---------------------------------
select public.app_refresh_all();

-- 6) VERIFY ------------------------------------------------------------------------
--   select count(*) from public.development_reports where zip in (select zip from public._mn_zips);
--   select sum((select count(*) from jsonb_array_elements(dr.sites) s
--     where coalesce(s->>'record_url', s->>'url','')='')) as unsourced
--     from public.development_reports dr where dr.zip in (select zip from public._mn_zips);
--   select data_quality, indexable, count(*) from public.app_community_meta where state='MN' group by 1,2;

-- 7) Clean up -----------------------------------------------------------------------
drop table if exists public._mn_zips;

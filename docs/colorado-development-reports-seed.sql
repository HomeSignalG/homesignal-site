-- ============================================================================
-- COLORADO Front Range development_reports seed — REPRODUCIBLE pg_net REFRESH SCRIPT
-- (pattern: docs/texas-development-reports-seed.sql; run in the Supabase SQL editor)
--
-- Built 2026-07-14: all 139 modeled CO ZIPs (Denver, Boulder, Larimer, El Paso,
-- Douglas, Jefferson, Arapahoe, Adams, Weld — the Front Range build) cached through
-- the live get-address-report engine and materialized into the app_* tables.
-- RESULT at build time (DB-verified): 139/139 cached, 134 pass + 5 coverage_coming
-- (genuinely-empty ZIPs — honest empties, never faked). UT/TX unaffected.
--
-- Development depth for CO comes from 5 first-party permit sources wired the same
-- pass (jurisdiction-registry.json): Denver commercial+residential construction
-- permits (spatial_zip_radius_mi — the additive envelope option added for layers
-- with no ZIP attribute), Boulder construction permits (BLDS table, native ZIP,
-- geocoded addresses), Fort Collins current building permits (point + native ZIP +
-- per-record Accela links), Colorado Springs Planning_Applications (the city's own
-- Development Tracker backend, spatial scoping). Receipts: docs/source-registry.md
-- "CO metro permit sources".
--
-- Centroids pinned to the zipcodes PyPI v3.0.0 offline USPS dataset (§12.0 — never
-- guess a ZIP centroid); 0 quarantined for CO, all inside the CO bounding box.
-- Index policy UNCHANGED: CO pages stay noindexed (INDEX_STATES is UT+TX) — this
-- seed makes Colorado READY; flipping it live is a separate founder call.
-- Nightly upkeep is automatic: dev_refresh_fire/collect (09:00/09:08 UTC) and
-- app-content-refresh (09:20 UTC) iterate development_reports, which now includes
-- these rows.
-- ============================================================================

-- 1) Stage the pinned centroids -------------------------------------------------
drop table if exists public._co_zips;
create table public._co_zips(zip text primary key, lat float8, lng float8);
insert into public._co_zips(zip,lat,lng) values
('80001',39.8028,-105.0875),
('80002',39.7945,-105.0984),
('80003',39.8286,-105.0655),
('80004',39.8141,-105.1177),
('80005',39.8422,-105.1097),
('80007',39.8634,-105.1724),
('80010',39.7398,-104.8562),
('80011',39.7378,-104.8152),
('80012',39.7038,-104.8379),
('80013',39.6604,-104.7632),
('80014',39.6577,-104.845),
('80015',39.6199,-104.7763),
('80016',39.6022,-104.7139),
('80019',39.7656,-104.7069),
('80020',39.9245,-105.0609),
('80022',39.8259,-104.9113),
('80023',39.9619,-105.0148),
('80104',39.3722,-104.8561),
('80108',39.4455,-104.853),
('80109',39.3643,-104.9014),
('80111',39.6123,-104.8799),
('80112',39.5805,-104.9011),
('80113',39.6405,-104.9614),
('80116',39.3728,-104.7256),
('80118',39.2011,-104.8546),
('80121',39.6111,-104.9532),
('80122',39.5814,-104.9557),
('80123',39.6206,-105.0901),
('80124',39.5517,-104.8863),
('80125',39.4845,-105.0561),
('80126',39.5437,-104.9691),
('80127',39.592,-105.1328),
('80129',39.5397,-105.0109),
('80130',39.5414,-104.9218),
('80134',39.4895,-104.8447),
('80135',39.3113,-105.0676),
('80138',39.5102,-104.7216),
('80150',39.6478,-104.9878),
('80163',39.3479,-104.9947),
('80202',39.7491,-104.9946),
('80203',39.7313,-104.9811),
('80204',39.734,-105.0259),
('80205',39.759,-104.9661),
('80206',39.7331,-104.9524),
('80207',39.7584,-104.9177),
('80209',39.7074,-104.9686),
('80210',39.679,-104.9631),
('80211',39.7665,-105.0204),
('80212',39.7683,-105.0493),
('80216',39.7835,-104.9669),
('80218',39.7327,-104.9717),
('80219',39.6956,-105.0341),
('80220',39.7312,-104.9129),
('80222',39.671,-104.9279),
('80223',39.7002,-105.0028),
('80224',39.688,-104.9108),
('80227',39.6667,-105.0854),
('80229',39.8671,-104.9227),
('80230',39.7218,-104.8951),
('80231',39.6793,-104.8843),
('80233',39.9015,-104.9407),
('80234',39.9108,-105.0109),
('80237',39.6431,-104.8987),
('80238',39.7392,-104.9847),
('80239',39.7878,-104.8288),
('80246',39.7086,-104.9312),
('80247',39.6971,-104.8819),
('80301',40.0497,-105.2143),
('80302',40.0172,-105.2851),
('80303',39.9914,-105.2392),
('80304',40.0375,-105.2771),
('80305',39.9807,-105.2531),
('80401',39.7305,-105.1915),
('80403',39.8232,-105.2825),
('80439',39.6374,-105.3402),
('80501',40.1779,-105.1009),
('80503',40.1559,-105.1624),
('80504',40.1306,-104.9504),
('80511',40.6281,-105.5692),
('80512',40.6265,-105.261),
('80513',40.2993,-105.1055),
('80514',40.0836,-104.9297),
('80516',40.0597,-105.0686),
('80521',40.5813,-105.1039),
('80524',40.5986,-105.0581),
('80525',40.5384,-105.0547),
('80526',40.5473,-105.1076),
('80528',40.4961,-105.0002),
('80534',40.3355,-104.9236),
('80537',40.3849,-105.0916),
('80538',40.4262,-105.09),
('80542',40.2347,-104.9994),
('80543',40.3294,-104.8552),
('80546',40.525,-104.8505),
('80547',40.5291,-104.9853),
('80549',40.7255,-105.0318),
('80601',39.943,-104.7866),
('80602',39.9636,-104.9072),
('80603',39.9515,-104.7746),
('80620',40.3803,-104.6971),
('80631',40.385,-104.6806),
('80634',40.4109,-104.7541),
('80642',40.0606,-104.6532),
('80651',40.2131,-104.8028),
('80654',40.1598,-104.0468),
('80808',38.9648,-104.3553),
('80809',38.8967,-104.9722),
('80817',38.6996,-104.7005),
('80829',38.855,-104.9058),
('80831',38.9541,-104.5472),
('80840',38.9917,-104.8543),
('80903',38.8388,-104.8145),
('80904',38.8533,-104.8595),
('80905',38.8377,-104.837),
('80906',38.7902,-104.8199),
('80907',38.876,-104.817),
('80908',39.0237,-104.6933),
('80909',38.852,-104.7735),
('80910',38.8152,-104.7703),
('80911',38.7457,-104.7223),
('80915',38.8558,-104.7134),
('80916',38.8076,-104.7403),
('80917',38.886,-104.7399),
('80918',38.9129,-104.7734),
('80919',38.9268,-104.8464),
('80920',38.9497,-104.767),
('80921',39.0487,-104.814),
('80922',38.905,-104.6982),
('80923',38.9189,-104.7045),
('80924',38.9676,-104.7211),
('80925',38.7378,-104.6459),
('80926',38.6981,-104.8505),
('80927',38.9286,-104.6583),
('80928',38.6233,-104.457),
('80929',38.7968,-104.6079),
('80930',38.8289,-104.5269),
('80938',38.9047,-104.6634),
('80939',38.8776,-104.6774),
('80951',38.8881,-104.6556);

-- 2) FIRE the engine per ZIP (run in waves of ~70-80 to be polite; re-run this
--    statement with the not-exists guard until 0 rows fire) ---------------------
select count(net.http_post(
  'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
  jsonb_build_object('zip', z.zip, 'lat', z.lat, 'lng', z.lng),
  '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 120000)) as fired
from (select t.* from public._co_zips t
      where not exists (select 1 from public.development_reports d where d.zip=t.zip)
      order by t.zip limit 80) z;

-- 3) COLLECT the 200s (wait ~2-3 min after each wave; transient-safe upsert:
--    an all-empty response never clobbers a row that has content; distinct-on
--    guards against double responses for one ZIP in the window) -----------------
insert into public.development_reports (zip, home_lat, home_lng, counts, sites, paywall, source_vintage, refreshed_at)
select (j->>'zip'), (j->'home'->>'lat')::float8, (j->'home'->>'lng')::float8, j->'counts', j->'sites',
       coalesce((j->>'paywall')::bool,false),
       'zipcodes PyPI v3.0.0 centroid; get-address-report ZIP mode; Colorado Front Range batch 2026-07-14',
       now()
from (
  select distinct on ((content::jsonb->>'zip')) content::jsonb j
  from net._http_response resp
  where resp.status_code = 200 and left(ltrim(resp.content),1)='{'
    and (content::jsonb->>'zip') in (select zip from public._co_zips)
    and resp.created > now() - interval '25 minutes'
  order by (content::jsonb->>'zip'), resp.created desc
) r
on conflict (zip) do update set
  home_lat=excluded.home_lat, home_lng=excluded.home_lng, counts=excluded.counts,
  sites=excluded.sites, paywall=excluded.paywall, source_vintage=excluded.source_vintage,
  refreshed_at=excluded.refreshed_at
where jsonb_array_length(excluded.sites) > 0 or jsonb_array_length(public.development_reports.sites) = 0;

-- 4) MATERIALIZE the app pages (also refreshes UT/TX — idempotent) ----------------
select public.app_refresh_all();

-- 5) VERIFY (expected: 139 cached / 0 unsourced; UT 136 + TX 654 pass unchanged) --
--   select count(*) from public.development_reports dr
--     where dr.zip in (select zip from public._co_zips);
--   select sum((select count(*) from jsonb_array_elements(dr.sites) s
--     where coalesce(s->>'record_url', s->>'url','')=''))
--     from public.development_reports dr where dr.zip in (select zip from public._co_zips);
--   select state, data_quality, count(*) from public.app_community_meta group by 1,2;

-- 6) Clean up the staging table -------------------------------------------------
drop table if exists public._co_zips;

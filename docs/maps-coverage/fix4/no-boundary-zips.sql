-- Fix 4 — the queries behind docs/maps-coverage/fix4/*-2026-10-01.*
--
-- READ-ONLY against HomeSignal tables. Step 3 asks Postgres to fetch Census TIGERweb through
-- pg_net, because the build sandbox has no egress to census.gov; pg_net writes only its own
-- request/response queue. Run the steps in order; the pg_net responses expire after ~6 hours.
--
-- The classification itself is NOT computed here. It is computed once, by
-- scripts/fix4_classify_no_boundary_zips.py, from the outputs below plus the pinned USPS
-- dataset (zipcodes 3.0.0).

-- 1. The input export: every canonical ZIP with no geo.zcta_boundary row, with its page.
--    Written verbatim to no-boundary-zips-2026-10-01.psv (one row per line, no header).
with nob as (
  select zip from public.canonical_zip_registry
   where zip not in (select zcta5 from geo.zcta_boundary)
)
select (cm.zip_codes)[1] || '|' || coalesce(cm.state, '') || '|' || coalesce(cm.county, '')
       || '|' || replace(coalesce(cm.name, ''), '|', '/') as row
  from public.communities cm
 where cm.level = 'zip' and (cm.zip_codes)[1] in (select zip from nob)
 order by (cm.zip_codes)[1] collate "C";

-- 1b. Its fingerprints (recorded in census-zcta-evidence-2026-10-01.json -> no_boundary_input).
--     2026-10-01 17:23Z: n 706 · zip_md5 7d1bf19a913e437a28f68c7442842890
--                        rows_md5 18edb6de1c6f3d8623e35c1eaa67cf23
with nob as (
  select zip from public.canonical_zip_registry
   where zip not in (select zcta5 from geo.zcta_boundary)
), rows as (
  select (cm.zip_codes)[1] zip, cm.state, cm.county, cm.name
    from public.communities cm
   where cm.level = 'zip' and (cm.zip_codes)[1] in (select zip from nob)
)
select count(*) n,
       md5(string_agg(zip, ',' order by zip collate "C")) zip_md5,
       md5(string_agg(zip || '|' || coalesce(state, '') || '|' || coalesce(county, '') || '|'
                      || replace(coalesce(name, ''), '|', '/'), E'\n' order by zip collate "C")) rows_md5
  from rows;

-- 2. The serving side: the active generation must mark exactly these ZIPs not_measured.
--    2026-10-01: n5-national-2026-09-29 ACTIVE · not_measured 706, md5 7d1bf19a… ·
--    boundary_complete 12,016 · 0 registry boundaries null/empty/invalid.
select s.generation_id,
       count(*) filter (where s.status = 'not_measured') not_measured,
       md5(string_agg(s.zip::text, ',' order by s.zip::text collate "C")
           filter (where s.status = 'not_measured')) not_measured_md5,
       count(*) filter (where s.status = 'boundary_complete') boundary_complete
  from geo.maps_zip_geography_status s
  join public.canonical_zip_registry r on r.zip = s.zip::text
  join geo.n5_generation g on g.generation_id = s.generation_id and g.state = 'ACTIVE'
 group by 1;

select count(*) filter (where b.geom is null or ST_IsEmpty(b.geom)) null_or_empty,
       count(*) filter (where not ST_IsValid(b.geom)) invalid,
       md5(string_agg(b.zcta5, ',' order by b.zcta5 collate "C")) codes_md5_all_rows
  from geo.zcta_boundary b;

-- 3. The independent Census read (TIGERweb, a different carrier from the TIGER/Line archive).
select k, net.http_get(url, timeout_milliseconds => 120000) request_id from (values
 ('current',    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query?where=1%3D1&outFields=ZCTA5&returnGeometry=false&orderByFields=ZCTA5&f=json'),
 ('bas2026',    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query?where=1%3D1&outFields=ZCTA5&returnGeometry=false&orderByFields=ZCTA5&f=json'),
 ('acs2025',    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/4/query?where=1%3D1&outFields=ZCTA5&returnGeometry=false&orderByFields=ZCTA5&f=json'),
 ('census2020', 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/7/query?where=1%3D1&outFields=ZCTA5&returnGeometry=false&orderByFields=ZCTA5&f=json'),
 ('census2010', 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2010/MapServer/8/query?where=1%3D1&outFields=ZCTA5&returnGeometry=false&orderByFields=ZCTA5&f=json')
) u(k, url);

-- 3b. Compare each Census set with geo.zcta_boundary and with the no-boundary ZIPs.
--     Put the request ids returned by step 3 into resp(k, id). The positive control is the
--     count of registry ZIPs WITH a boundary that the Census set also contains: it must be
--     non-zero, or a zero in nob_in_census means nothing.
with resp(k, id) as (values ('current', 16689), ('bas2026', 16690), ('acs2025', 16691),
                            ('census2020', 16692), ('census2010', 16693)),
codes as (
  select r.k, f->'attributes'->>'ZCTA5' z
    from resp r join net._http_response h on h.id = r.id
   cross join lateral jsonb_array_elements(h.content::jsonb->'features') f
),
zb  as (select zcta5 z from geo.zcta_boundary),
reg as (select zip z from public.canonical_zip_registry),
nob as (select z from reg where z not in (select z from zb))
select k,
       count(*) n, count(distinct z) nd,
       md5(string_agg(z, ',' order by z collate "C")) codes_md5,
       count(*) filter (where z not in (select z from zb)) in_census_not_in_boundary_table,
       (select count(*) from zb where zb.z not in (select c2.z from codes c2 where c2.k = c.k))
         in_boundary_table_not_in_census,
       count(*) filter (where z in (select z from nob)) nob_in_census,
       count(*) filter (where z in (select z from reg) and z in (select z from zb))
         positive_control_registry_zips_with_boundary_found,
       string_agg(z, ',' order by z collate "C") filter (where z in (select z from nob)) nob_list
  from codes c
 group by k
 order by k;

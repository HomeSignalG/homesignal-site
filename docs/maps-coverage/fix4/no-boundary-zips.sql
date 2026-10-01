-- Fix 4 — the queries behind docs/maps-coverage/fix4/*-2026-10-01.*
--
-- Step 4 GENERATES the evidence file (census-zcta-evidence-2026-10-01.json) whole: its output
-- column file_text was saved verbatim, and its file_md5 (51cfa16ddce6cafbb0d94d28008ef114 on
-- 2026-10-01 19:03Z) equals the committed file's md5. No value in that file was typed by hand.
-- Step 1's output was saved verbatim to no-boundary-zips-2026-10-01.psv; step 4 also returns
-- that file's md5 (input_export.file_md5). Step 5 GENERATES census-zcta-codes-2026-10-01.json the
-- same way (file_md5 9d8c90b7bf249f0c9484f253ae456e93 on 2026-10-01 19:20Z): the Census code sets
-- themselves, so the evidence's md5s stay checkable after pg_net expires the responses.
--
-- Reads HomeSignal tables only. Step 3 asks Postgres to fetch Census TIGERweb through pg_net,
-- because the build sandbox cannot reach census.gov; pg_net writes only its own
-- request/response queue (GET requests to tigerweb.geo.census.gov), and its responses expire
-- after about 6 hours, so steps 3 and 4 must run within that window. Step 4 names the request
-- ids it was run against; a re-run needs the ids step 3 returns.
--
-- The classification itself is NOT computed here. It is computed once, by
-- scripts/fix4_classify_no_boundary_zips.py, from these three files plus the pinned zipcodes 3.0.0
-- package.

-- 1. The input export: every canonical ZIP with no geo.zcta_boundary row, with its page.
with nob as (
  select zip from public.canonical_zip_registry
   where zip not in (select zcta5 from geo.zcta_boundary)
)
select (cm.zip_codes)[1] || '|' || coalesce(cm.state, '') || '|' || coalesce(cm.county, '')
       || '|' || replace(coalesce(cm.name, ''), '|', '/') as row
  from public.communities cm
 where cm.level = 'zip' and (cm.zip_codes)[1] in (select zip from nob)
 order by (cm.zip_codes)[1] collate "C";

-- 2. (Folded into step 4: the serving generation, geometry validity and the controls.)

-- 3. The Census reads (TIGERweb). Labels and groups come from Census's own layer metadata
--    (the three metadata requests), never from this file. Run on 2026-10-01: bodies
--    16689-16693 at 17:18Z and 17178 at 19:00Z; metadata 16686 at 17:18Z, 17177 and 17179 at 19:00Z.
select k, net.http_get(url, timeout_milliseconds => 120000) request_id from (values
 ('meta tigerWMS_Current/2',       'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2?f=json'),
 ('meta PUMA_TAD_TAZ_UGA_ZCTA',    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/layers?f=json'),
 ('meta tigerWMS_Census2010/8',    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2010/MapServer/8?f=json'),
 ('tigerWMS_Current/2',            'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query?where=1%3D1&outFields=ZCTA5&returnGeometry=false&orderByFields=ZCTA5&f=json'),
 ('PUMA_TAD_TAZ_UGA_ZCTA/1',       'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query?where=1%3D1&outFields=ZCTA5&returnGeometry=false&orderByFields=ZCTA5&f=json'),
 ('PUMA_TAD_TAZ_UGA_ZCTA/4',       'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/4/query?where=1%3D1&outFields=ZCTA5&returnGeometry=false&orderByFields=ZCTA5&f=json'),
 ('PUMA_TAD_TAZ_UGA_ZCTA/7',       'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/7/query?where=1%3D1&outFields=ZCTA5&returnGeometry=false&orderByFields=ZCTA5&f=json'),
 ('PUMA_TAD_TAZ_UGA_ZCTA/11',      'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/11/query?where=1%3D1&outFields=ZCTA5&returnGeometry=false&orderByFields=ZCTA5&f=json'),
 ('tigerWMS_Census2010/8',         'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2010/MapServer/8/query?where=1%3D1&outFields=ZCTA5&returnGeometry=false&orderByFields=ZCTA5&f=json')
) u(k, url);

-- 4. The evidence file, generated whole. The positive control (registry ZIPs WITH a boundary
--    that a Census set also contains) must be non-zero, or a zero in no_boundary_hits means
--    nothing. Save file_text verbatim; check the saved file's md5 against file_md5.
with
reg   as (select zip from public.canonical_zip_registry),
zb    as (select zcta5 z, geom, source_vintage, source_url, source_checksum from geo.zcta_boundary),
nob   as (select zip from reg where zip not in (select z from zb)),
pages as (
  select (cm.zip_codes)[1] zip, cm.state, cm.county, cm.name, cardinality(cm.zip_codes) nz
    from public.communities cm
   where cm.level = 'zip' and (cm.zip_codes)[1] in (select zip from nob)
),
export as (
  select zip, zip || '|' || coalesce(state, '') || '|' || coalesce(county, '') || '|'
              || replace(coalesce(name, ''), '|', '/') as line
    from pages
),
gen_active as (select generation_id, activated_at from geo.n5_generation where state = 'ACTIVE'),
gen_building as (select generation_id from geo.n5_generation where state = 'BUILDING'),
st as (
  select s.generation_id, s.zip::text zip, s.status, s.note
    from geo.maps_zip_geography_status s
    join reg on reg.zip = s.zip::text
   where s.generation_id in (select generation_id from gen_active union all select generation_id from gen_building)
),
-- The Census reads. Request ids are the pg_net responses read on 2026-10-01; the URL and the
-- delineation label are inputs, and each label is backed by the metadata response named beside it.
layers(id, req, delineation, url, meta_req) as (values
  ('tigerWMS_Current/2',          16689, '2020', 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2',          16686),
  ('PUMA_TAD_TAZ_UGA_ZCTA/1',     16690, '2020', 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1',  17177),
  ('PUMA_TAD_TAZ_UGA_ZCTA/4',     16691, '2020', 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/4',  17177),
  ('PUMA_TAD_TAZ_UGA_ZCTA/7',     16692, '2020', 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/7',  17177),
  ('PUMA_TAD_TAZ_UGA_ZCTA/11',    17178, '2020', 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/11', 17177),
  ('tigerWMS_Census2010/8',       16693, '2010', 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2010/MapServer/8',     17179)
),
layer_meta as (
  select l.id,
         coalesce(
           (select x->>'name' from net._http_response h, jsonb_array_elements(h.content::jsonb->'layers') x
             where h.id = l.meta_req and l.meta_req = 17177 and x->>'id' = split_part(l.id, '/', 2)),
           (select h.content::jsonb->>'name' from net._http_response h where h.id = l.meta_req and l.meta_req <> 17177)) as layer_name,
         (select x->'parentLayer'->>'name' from net._http_response h, jsonb_array_elements(h.content::jsonb->'layers') x
           where h.id = l.meta_req and l.meta_req = 17177 and x->>'id' = split_part(l.id, '/', 2)) as parent_group,
         (select h.content::jsonb->>'description' from net._http_response h where h.id = l.meta_req and l.meta_req <> 17177) as description
    from layers l
),
codes as (
  select l.id, f->'attributes'->>'ZCTA5' z
    from layers l join net._http_response h on h.id = l.req
   cross join lateral jsonb_array_elements(h.content::jsonb->'features') f
),
per_layer as (
  select l.id, l.req, l.delineation, l.url, l.meta_req, m.layer_name, m.parent_group, m.description,
         h.status_code, md5(h.content) body_md5, h.created,
         (h.content::jsonb ? 'exceededTransferLimit') exceeded_transfer_limit_present,
         (select count(*) from codes c where c.id = l.id) features,
         (select count(distinct c.z) from codes c where c.id = l.id) distinct_codes,
         (select md5(string_agg(c.z, ',' order by c.z collate "C")) from codes c where c.id = l.id) codes_md5,
         (select count(*) from codes c where c.id = l.id and c.z not in (select z from zb)) in_census_not_in_boundary_table,
         (select count(*) from zb where zb.z not in (select c.z from codes c where c.id = l.id)) in_boundary_table_not_in_census,
         (select coalesce(jsonb_agg(c.z order by c.z collate "C"), '[]'::jsonb) from codes c
           where c.id = l.id and c.z in (select zip from nob)) no_boundary_hits,
         (select count(*) from codes c where c.id = l.id and c.z in (select zip from reg) and c.z in (select z from zb))
           positive_control_registry_zips_with_boundary_found
    from layers l
    join net._http_response h on h.id = l.req
    left join layer_meta m on m.id = l.id
),
doc as (
  select jsonb_build_object(
    '_doc', 'Fix 4 evidence. Generated whole by docs/maps-coverage/fix4/no-boundary-zips.sql step 4 and saved verbatim (the database also returns this file''s md5, recorded in the receipt). Census was read from Postgres through pg_net because the build sandbox cannot reach census.gov; pg_net writes only its own request/response queue. scripts/fix4_classify_no_boundary_zips.py reads this file.',
    'read_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'pg_net_requests', jsonb_build_object(
       'census_bodies', (select jsonb_agg(req order by req) from layers),
       'census_metadata', '[16686, 17177, 17179]'::jsonb,
       'note', 'GET requests to tigerweb.geo.census.gov only. No HomeSignal table was written.'),
    'input_export', jsonb_build_object(
       'file', 'docs/maps-coverage/fix4/no-boundary-zips-2026-10-01.psv',
       'definition', 'public.canonical_zip_registry ZIPs with no geo.zcta_boundary row, each with its level=''zip'' page in public.communities, one row per line: zip|state|county|page_name',
       'rows', (select count(*) from export),
       'zip_md5', (select md5(string_agg(zip, ',' order by zip collate "C")) from export),
       'rows_md5', (select md5(string_agg(line, E'\n' order by zip collate "C")) from export),
       'file_md5', (select md5(string_agg(line || E'\n', '' order by zip collate "C")) from export),
       'controls', jsonb_build_object(
          'canonical_registry_zips', (select count(*) from reg),
          'registry_zips_with_boundary', (select count(*) from reg where zip in (select z from zb)),
          'registry_zips_without_boundary', (select count(*) from nob),
          'pages_found_for_them', (select count(*) from pages),
          'pages_carrying_more_than_one_zip', (select count(*) from pages where nz <> 1))),
    'boundary_table', jsonb_build_object(
       'table', 'geo.zcta_boundary',
       'rows', (select count(*) from zb),
       'distinct_codes', (select count(distinct z) from zb),
       'codes_md5', (select md5(string_agg(z, ',' order by z collate "C")) from zb),
       'source_vintages', (select jsonb_agg(distinct source_vintage) from zb),
       'source_urls', (select jsonb_agg(distinct source_url) from zb),
       'source_checksums', (select jsonb_agg(distinct source_checksum) from zb),
       'registry_rows_null_or_empty_geometry', (select count(*) from zb where z in (select zip from reg) and (geom is null or ST_IsEmpty(geom))),
       'registry_rows_invalid_geometry', (select count(*) from zb where z in (select zip from reg) and not ST_IsValid(geom)),
       'registry_rows_geometry_types', (select jsonb_agg(distinct GeometryType(geom) || '/' || ST_SRID(geom)) from zb where z in (select zip from reg))),
    'serving', jsonb_build_object(
       'active_generation', (select generation_id from gen_active),
       'activated_at', (select to_char(activated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from gen_active),
       'status_rows', (select count(*) from st where generation_id in (select generation_id from gen_active)),
       'not_measured', (select count(*) from st where generation_id in (select generation_id from gen_active) and status = 'not_measured'),
       'not_measured_zip_md5', (select md5(string_agg(zip, ',' order by zip collate "C")) from st where generation_id in (select generation_id from gen_active) and status = 'not_measured'),
       'boundary_complete', (select count(*) from st where generation_id in (select generation_id from gen_active) and status = 'boundary_complete'),
       'not_measured_notes', (select jsonb_agg(distinct note) from st where generation_id in (select generation_id from gen_active) and status = 'not_measured'),
       'status_disagreeing_with_boundary_table', (select count(*) from st where generation_id in (select generation_id from gen_active)
           and status is distinct from case when zip in (select z from zb) then 'boundary_complete' else 'not_measured' end),
       'building_generation', (select generation_id from gen_building),
       'building_status_rows', (select count(*) from st where generation_id in (select generation_id from gen_building)),
       'building_not_measured_outside_input', (select count(*) from st where generation_id in (select generation_id from gen_building)
           and status = 'not_measured' and zip not in (select zip from nob)),
       'building_status_disagreeing_with_boundary_table', (select count(*) from st where generation_id in (select generation_id from gen_building)
           and status is distinct from case when zip in (select z from zb) then 'boundary_complete' else 'not_measured' end)),
    'census_layers', (select jsonb_agg(jsonb_build_object(
          'layer', id, 'delineation', delineation, 'url', url,
          'layer_name', layer_name, 'parent_group', parent_group, 'description', description,
          'pg_net_request_id', req, 'metadata_request_id', meta_req,
          'http_status', status_code, 'response_md5', body_md5,
          'response_created', to_char(created at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'exceeded_transfer_limit_present', exceeded_transfer_limit_present,
          'features', features, 'distinct_codes', distinct_codes, 'codes_md5', codes_md5,
          'in_census_not_in_boundary_table', in_census_not_in_boundary_table,
          'in_boundary_table_not_in_census', in_boundary_table_not_in_census,
          'no_boundary_hits', no_boundary_hits,
          'positive_control_registry_zips_with_boundary_found', positive_control_registry_zips_with_boundary_found)
          order by delineation desc, id) from per_layer)
  ) j
)
select jsonb_pretty(j) || E'\n' as file_text,
       md5(jsonb_pretty(j) || E'\n') as file_md5,
       length(jsonb_pretty(j) || E'\n') as file_len
  from doc;

-- 5. The Census code sets, generated whole (census-zcta-codes-2026-10-01.json). One bitmap per
--    delineation over the 100,000 five-digit codes: bit i, most significant bit first within each
--    byte, is 1 when code i is in the layer. The 2020 layers all returned one identical body, so
--    one 2020 set (16689) covers them. Save file_text verbatim; check the saved file's md5 against
--    file_md5. The classifier and the offline test decode the bitmaps and refuse unless each
--    decodes to the count and md5 step 4 recorded for that delineation.
with layers(id, req, delineation) as (values
  ('tigerWMS_Current/2', 16689, '2020'),
  ('tigerWMS_Census2010/8', 16693, '2010')),
raw as (
  select l.id, f->'attributes'->>'ZCTA5' z
    from layers l join net._http_response h on h.id = l.req
   cross join lateral jsonb_array_elements(h.content::jsonb->'features') f),
codes as (select distinct id, z from raw),
chk as (select r.id, count(distinct r.z) nd,
               (select md5(string_agg(c.z, ',' order by c.z collate "C")) from codes c where c.id = r.id) m
          from raw r group by r.id),
bits as (
  select l.id, k,
         sum(case when c.z is not null then (1 << (7 - j)) else 0 end) as byte
    from layers l
   cross join generate_series(0, 12499) k
   cross join generate_series(0, 7) j
    left join codes c on c.id = l.id and c.z = lpad((k*8 + j)::text, 5, '0')
   group by l.id, k),
enc as (
  select id, encode(decode(string_agg(lpad(to_hex(byte), 2, '0'), '' order by k), 'hex'), 'base64') b64
    from bits group by id),
doc as (
  select jsonb_build_object(
    '_doc', 'Fix 4 evidence: the Census ZCTA5 code sets themselves, so the md5s in census-zcta-evidence-2026-10-01.json stay checkable after pg_net expires the responses. Generated whole by docs/maps-coverage/fix4/no-boundary-zips.sql step 5 from the same pg_net responses and saved verbatim. The 2020 layers all returned one identical body, so one 2020 set covers them.',
    'encoding', 'bitmap over the 100,000 five-digit codes 00000-99999: bit i, most significant bit first within each byte, is 1 when ZCTA5 code i (zero-padded to 5 digits) is in the layer. 12,500 bytes, base64 (RFC 4648) without line breaks.',
    'layers', (select jsonb_agg(jsonb_build_object(
        'layer', l.id, 'delineation', l.delineation, 'pg_net_request_id', l.req,
        'codes', ch.nd, 'codes_md5', ch.m,
        'bitmap_base64', replace(e.b64, E'\n', ''))
        order by l.delineation desc)
       from layers l join chk ch on ch.id = l.id join enc e on e.id = l.id)) j)
select jsonb_pretty(j) || E'\n' as file_text, md5(jsonb_pretty(j) || E'\n') file_md5
  from doc;

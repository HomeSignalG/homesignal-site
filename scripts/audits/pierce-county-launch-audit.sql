-- Pierce County WA launch-readiness audit — READ-ONLY. Run via db-sql.yml (or the Supabase SQL editor).
-- Each section prints a CONTROL beside the result (claims rule 5): a zero is only evidence if the
-- control is non-zero. Pierce ZIP pages are the level='zip' communities with county 'Pierce', state 'WA'.
-- NOTE: development sites live in development_reports.sites (jsonb); a development record is a site with a
-- non-null source_registry_id (the EPA facilities floor carries none). Cached sites repeat across ZIP
-- pages, so record-level counts use `distinct on (source_id)` unless a per-page count is stated.

-- ── 1. Refresh recency (target: <=72h; flag >7d) ─────────────────────────────────────────────────────
with z as (select c.zip_codes[1] zip from public.communities c
           where c.state='WA' and c.county='Pierce' and c.level='zip')
select 'pierce_zip_pages (control: expect 65)' k, count(*)::text v from z
union all select 'no_development_report', count(*)::text from z left join public.development_reports r using (zip) where r.zip is null
union all select 'refreshed_le_72h', count(*)::text from z join public.development_reports r using (zip) where r.refreshed_at >= now()-interval '72 hours'
union all select 'refreshed_72h_to_7d', count(*)::text from z join public.development_reports r using (zip) where r.refreshed_at <  now()-interval '72 hours' and r.refreshed_at >= now()-interval '7 days'
union all select 'refreshed_gt_7d', count(*)::text from z join public.development_reports r using (zip) where r.refreshed_at < now()-interval '7 days'
union all select 'newest / oldest refresh', max(r.refreshed_at)::text||' / '||min(r.refreshed_at)::text from z join public.development_reports r using (zip);

-- stale list (older than 72h), with the retry evidence
with z as (select c.zip_codes[1] zip from public.communities c where c.state='WA' and c.county='Pierce' and c.level='zip')
select z.zip, s.coverage_state, r.refreshed_at, r.last_refresh_attempt_at, r.facilities_unavailable, now()-r.refreshed_at as age
from z join public.development_reports r using (zip) join public.app_coverage_states s using (zip)
where r.refreshed_at < now()-interval '72 hours' order by r.refreshed_at;

-- ── 2. Coverage state (target: every Pierce ZIP 'populated') ─────────────────────────────────────────
with z as (select c.zip_codes[1] zip from public.communities c where c.state='WA' and c.county='Pierce' and c.level='zip')
select coalesce(s.coverage_state,'NO ROW') coverage_state, s.data_quality, s.regulatory_overlay_state, count(*) n,
       (select count(*) from public.app_coverage_states) as control_universe_rows   -- expect 12,722
from z left join public.app_coverage_states s using (zip)
group by 1,2,3 order by n desc;

-- the not-populated ZIP(s)
with z as (select c.zip_codes[1] zip from public.communities c where c.state='WA' and c.county='Pierce' and c.level='zip')
select s.zip, s.coverage_state, s.data_quality, s.dev_markers, s.fac_markers, s.refreshed_at, s.last_refresh_attempt_at
from z join public.app_coverage_states s using (zip) where s.coverage_state <> 'populated';

-- ── 3. Coordinates: non-null, WA bbox, Pierce bbox ───────────────────────────────────────────────────
-- Bboxes are an APPROXIMATE geofence (no county polygon exists in-house): WA lat 45.5..49.0, lng -124.9..-116.9;
-- Pierce lat 46.69..47.46, lng -123.00..-121.46. A bbox miss is a LEAD, read the rows (see section 3b).
with z as (select c.zip_codes[1] zip from public.communities c where c.state='WA' and c.county='Pierce' and c.level='zip'),
e as (select r.zip, x s from z join public.development_reports r using (zip), jsonb_array_elements(r.sites) x
      where x->>'source_registry_id' is not null)
select 'dev_records_on_pierce_pages (control)' k, count(*)::text v from e
union all select 'null_lat', count(*)::text from e where s->>'lat' is null
union all select 'null_lng', count(*)::text from e where s->>'lng' is null
union all select 'zero_lat_or_lng', count(*)::text from e where (s->>'lat')::float = 0 or (s->>'lng')::float = 0
union all select 'scope_not_point', count(*)::text from e where coalesce(s->>'scope','') <> 'point'
union all select 'outside_WA_bbox', count(*)::text from e where (s->>'lat')::float not between 45.5 and 49.0 or (s->>'lng')::float not between -124.9 and -116.9
union all select 'outside_Pierce_bbox', count(*)::text from e where (s->>'lat')::float not between 46.69 and 47.46 or (s->>'lng')::float not between -123.00 and -121.46;

-- 3b. the bbox misses
with z as (select c.zip_codes[1] zip from public.communities c where c.state='WA' and c.county='Pierce' and c.level='zip'),
e as (select r.zip, x s from z join public.development_reports r using (zip), jsonb_array_elements(r.sites) x where x->>'source_registry_id' is not null)
select zip, s->>'source_registry_id' registry, s->>'lat' lat, s->>'lng' lng, s->>'address' address, left(s->>'title',70) title
from e where (s->>'lat')::float not between 46.69 and 47.46 or (s->>'lng')::float not between -123.00 and -121.46 order by zip;

-- 3c. dot clustering for the launch ZIPs: many records on one coordinate collapse into a single marker
with e as (select r.zip, x s from public.development_reports r, jsonb_array_elements(r.sites) x
           where r.zip in ('98371','98373','98335','98499','98498','98390','98391','98338','98338','98466') and x->>'source_registry_id' is not null)
select zip, count(*) records, count(distinct (s->>'lat')||','||(s->>'lng')) distinct_points,
       max(c) as max_records_on_one_point
from (select zip, s, count(*) over (partition by zip, s->>'lat', s->>'lng') c from e) q
group by zip order by zip;

-- ── 4. Status mapping and required fields (distinct records) ─────────────────────────────────────────
with z as (select c.zip_codes[1] zip from public.communities c where c.state='WA' and c.county='Pierce' and c.level='zip'),
e as (select distinct on (x->>'source_id') x s from z join public.development_reports r using (zip), jsonb_array_elements(r.sites) x
      where x->>'source_registry_id' is not null)
select 'raw_status -> bucket' k, (s->>'source_registry_id')||' | '||coalesce(s->>'status_raw','NULL')||' -> '||coalesce(s->>'bucket','NULL') v, count(*) n from e group by 2
union all select 'missing_address', '', count(*) from e where coalesce(s->>'address','')=''
union all select 'missing_file_date', '', count(*) from e where coalesce(s->>'file_date','')=''
union all select 'missing_permit_type(type_raw)', s->>'source_registry_id', count(*) from e where coalesce(s->>'type_raw','')='' group by 2
union all select 'missing_bucket', '', count(*) from e where coalesce(s->>'bucket','')=''
union all select 'missing_record_url', '', count(*) from e where coalesce(s->>'record_url','')=''
union all select 'distinct_records (control)', '', count(*) from e
order by 1,2;

-- ── 5. Tacoma minor-repair noise — the SAME rule as sources/record-hygiene.ts (pattern strings pinned by
--       test/record-hygiene.test.mjs). Dropped = type 'Building' AND minor-repair term AND NO development term.
with z as (select c.zip_codes[1] zip from public.communities c where c.state='WA' and c.county='Pierce' and c.level='zip'),
e as (select distinct on (x->>'source_id') x->>'source_id' sid, x->>'title' t, x->>'type_raw' tr
      from z join public.development_reports r using (zip), jsonb_array_elements(r.sites) x
      where x->>'source_registry_id'='tacoma-accela-permits'),
f as (select *, (tr='Building'
   and t ~* '(^|[^a-z0-9])(?:furnaces?|heat pumps?|water heaters?|mini[- ]?splits?|ductless|boilers?|air condition(?:er|ers|ing)|fire alarms?|smoke (?:detectors?|alarms?)|fire sprinkler (?:heads?|risers?)|sprinkler (?:heads?|risers?)|water damage|fire damage|smoke damage|water mitigation|mold remediation|re-?roof(?:ing)?|roof replacement|window replacement|replac(?:e|ing) (?:the |existing |all )?(?:windows?|siding|doors?)|re-?pipe|re-?piping|water ?lines?|sewer lines?|gas lines?|panel upgrade|ev chargers?)([^a-z0-9]|$)'
   and not t ~* '(^|[^a-z0-9])(?:new (?:single|sfd|sfr|multi|building|construction|dwelling|home|house|duplex|townhome|apartment|structure|residence|commercial)|construct(?:ion)? (?:of )?(?:a |an )?(?:new|[0-9,]+ ?sf)|additions?|adu|dadu|accessory dwelling|(?:full |complete |building |structure |house )demolition|demolish(?:ing)? (?:the |an? )?(?:existing )?(?:building|structure|house|home|sfd|sfr|garage)|alterations?|remodel(?:ing)?|renovations?|tenant improvements?|interior improvements?|subdivision|shell)([^a-z0-9]|$)') as dropped from e)
select 'tacoma_distinct_records' k, count(*)::text v from f
union all select 'would_drop', count(*)::text from f where dropped
union all select 'would_keep', count(*)::text from f where not dropped;

-- ── 6. Applicant-named titles on Pierce PALS — how cleanApplicantTitle (sources/record-hygiene.ts) treats the
--       name column. FOUNDER DECISION 2026-10-15: corporate kept, plat untouched, everything else (individuals) stripped.
--       SQL approximation of the TS rule (same word lists); the TS tests are the authority. The name is the title
--       minus its leading permit type. NOTE: most "Last, First"-shaped names are PLAT text ("Rolling Brook, Lot 15").
with z as (select c.zip_codes[1] zip from public.communities c where c.state='WA' and c.county='Pierce' and c.level='zip'),
e as (select distinct on (x->>'source_id')
        regexp_replace(x->>'title', '^'||regexp_replace(coalesce(x->>'type_raw',''),'([.()*+?\[\]\\|^$])','\\\1','g')||' ?', '') nm
      from z join public.development_reports r on r.zip=z.zip, jsonb_array_elements(r.sites) x
      where x->>'source_registry_id'='pierce-county-pals-permits'),
c as (select nm,
 (nm ~* '(^|[^a-z0-9])(l\.?l\.?c|inc|corp(?:oration)?|holdings?|propert(?:y|ies)|builders?|homes?|developments?|group|partners?|limited|co|lp)($|[^a-z0-9])') ent,
 (nm ~* '(^|[^a-z0-9])(lots?|blk|block|tract|plat|phase|div(?:ision)?|parcel|unit|sec(?:tion)?|subdivision)\.?\s*#?[0-9]') plat,
 (nm ~ '[A-Za-z][A-Za-z''.-]*, [A-Za-z]' and nm !~* ', (llc|inc|corp|co|ltd|llp|lp|pllc|jr|sr)\M' and nm !~* ', (lot|lots|blk|block|unit|phase|tract|parcel|div|division|plat|sec|section)\M') person_pair from e)
select 'pals_distinct_records' k, count(*)::text v from c
union all select 'KEPT corporate (applicant: ...)', count(*)::text from c where ent and not person_pair and not (plat and not person_pair)
union all select 'KEPT plat text, untouched', count(*)::text from c where plat and not person_pair
union all select 'STRIPPED (individuals and unknown)', count(*)::text from c where nm<>'' and not (plat and not person_pair) and not (ent and not person_pair);

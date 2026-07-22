-- ============================================================================
-- MAP PIPELINE REMEDIATION — geocode carry-through for markers (PARKED DDL).
-- Design + decision table: docs/map-pipeline-remediation.md.
--
-- ADDITIVE ONLY. Applied MANUALLY in the Supabase SQL editor (this file is the
-- DDL-of-record) — NOT auto-deployed by any workflow. Rollback = re-apply the
-- prior app_refresh_zip body from docs/app-content-materialize.sql history and
-- (optionally) drop the two additive objects below.
--
-- What it changes (nothing else in app_refresh_zip is touched):
--   P4  app_changes gains `geo_exclusion_reason text` (why a row is sidebar-only).
--   P2  new `app_geocodes` resolution store (source_url -> genuine geocoded point).
--   P1  gov-notice insert carries alerts.geo_lat/geo_lng when geo_scope='address'.
--   P2  area-scope development that RESOLVED to a genuine geofenced point is
--       promoted into app_projects(record_kind='development'); the rest stay in
--       app_changes with a geo_exclusion_reason (never a synthetic-centroid marker).
--   P4  app_materialization_summary() reports processed/materialized/displayed/
--       excluded + reason_counts per layer.
-- ============================================================================

-- ---------------------------------------------------------------- P4: reason column
alter table public.app_changes add column if not exists geo_exclusion_reason text;

-- ---------------------------------------------------------------- P2: resolution store
-- ONE row per (ZIP, street address). Written by the ingest geocoders
-- (adapters/development_geo.py via scripts/backfill_development_geo.py).
-- KEY = '<zip>|<UPPER(TRIM(address))>'.  NOTE: record_url is dataset-level for many
-- sources (e.g. a Fort Worth ArcGIS MapServer URL is shared by every permit), so it
-- is NOT a per-record key — the geocode is keyed by the address it actually resolves,
-- and identical addresses (same parcel) correctly share one point.
-- geo_scope='address' => a genuine, geofenced street-address point (mappable).
-- Any other geo_scope (or absence) => NOT mappable; `reason` says why.
-- RLS ON, no policies (service-role / pg_cron only) — matches resolved_projects.
create table if not exists public.app_geocodes (
  source_key   text primary key,            -- '<zip>|<UPPER(TRIM(address))>'
  lat          double precision,
  lng          double precision,
  geo_scope    text,                         -- 'address' (mappable) | 'countywide' | 'unresolved'
  matched_zip  text,                         -- ZIP the geocoder returned (fence check)
  expected_zip text,                         -- ZIP the record was filed under
  reason       text,                         -- exclusion reason when geo_scope<>'address'
  geocoder     text default 'census',
  resolved_at  timestamptz not null default now()
);
alter table public.app_geocodes enable row level security;

-- ---------------------------------------------------------------- P1+P2: materializer
create or replace function public.app_refresh_zip(_zip text)
 returns text
 language plpgsql
as $function$
declare _cid uuid; _root uuid; _county text; _nd int; _ndp int; _nf int; _nfc int; _nc int; _nm int; _has_report boolean;
        _lat double precision; _lng double precision; _nap int;
begin
  select id, county into _cid, _county from public.communities
    where _zip = any(zip_codes) order by (level='zip') desc, (level='city') desc limit 1;
  select parent_id into _root from public.communities where id = _cid;
  if _county is null then select county into _county from public.communities where id = coalesce(_root,_cid); end if;
  select exists(select 1 from public.development_reports where zip=_zip) into _has_report;
  select home_lat, home_lng into _lat, _lng from public.development_reports where zip=_zip;

  delete from public.app_projects where zip=_zip;
  delete from public.app_changes  where zip=_zip;
  _nd := 0; _ndp := 0; _nf := 0; _nfc := 0; _nc := 0; _nm := 0; _nap := 0;

  if _has_report then
    -- (1) parcel-precise DEVELOPMENT permits (scope='point') — UNCHANGED.
    insert into public.app_projects (community_id, zip, name, type, status, stage, developer, size, investment, submitted_at, lat, lng, impact_score, source_ref, record_kind)
    select _cid, _zip, el->>'label',
      coalesce(nullif(el->>'use_type',''), el->>'layer'),
      case when lower(coalesce(el->>'decided','')) = 'true' then 'Decided'
           else case lower(coalesce(nullif(el->>'bucket',''), ''))
             when 'built' then 'Active' when 'approved' then 'Approved'
             when 'proposed' then 'Proposed' when 'operating' then 'Operating'
             else 'On file' end
      end,
      nullif(el->>'status_raw',''),
      coalesce(nullif(el->>'owner',''), nullif(el->>'src','')),
      case when el->>'sqft' ~ '^[0-9.]+$' then trim(to_char((el->>'sqft')::numeric,'FM999,999,999'))||' sq ft' end,
      case when el->>'est_cost' ~ '^[0-9.]+$' then '$'||trim(to_char((el->>'est_cost')::numeric,'FM999,999,999')) end,
      case when coalesce(el->>'file_date',el->>'decision_date') ~ '^\d{4}-\d{2}-\d{2}' then left(coalesce(el->>'file_date',el->>'decision_date'),10)::date end,
      case when el->>'lat' ~ '^-?[0-9.]+$' then (el->>'lat')::double precision end,
      case when el->>'lng' ~ '^-?[0-9.]+$' then (el->>'lng')::double precision end,
      case lower(coalesce(el->>'bucket','')) when 'proposed' then 72 when 'approved' then 55 when 'built' then 55 else 45 end,
      coalesce(el->>'record_url', el->>'url'), 'development'
    from public.development_reports dr, jsonb_array_elements(dr.sites) el
    where dr.zip=_zip and coalesce(el->>'relevance','')='development'
      and coalesce(el->>'scope','')='point'
      and coalesce(el->>'record_url', el->>'url','')<>''
    order by
      case when coalesce(el->>'file_date',el->>'decision_date') ~ '^\d{4}-\d{2}-\d{2}' then left(coalesce(el->>'file_date',el->>'decision_date'),10)::date end desc nulls last
    limit 48;

    -- (1b) NEW (P2): area-scope DEVELOPMENT that RESOLVED to a genuine, geofenced
    -- street-address point (app_geocodes.geo_scope='address') is promoted to a
    -- real development marker. The engine stamped these with the ZIP CENTROID
    -- (synthetic) — we DELIBERATELY ignore el->'lat'/'lng' here and use ONLY the
    -- geocoder's fenced point. Records not resolved to 'address' are NOT promoted
    -- (they fall through to the sidebar insert below with a reason). Keyed by
    -- (zip,address); point vs area are disjoint by scope, so no cross-dedup needed.
    insert into public.app_projects (community_id, zip, name, type, status, developer, submitted_at, lat, lng, impact_score, source_ref, record_kind)
    select _cid, _zip, el->>'label',
      coalesce(nullif(el->>'use_type',''), nullif(el->>'layer',''), 'Development'),
      case lower(coalesce(nullif(el->>'bucket',''), ''))
        when 'built' then 'Active' when 'approved' then 'Approved'
        when 'proposed' then 'Proposed' when 'operating' then 'Operating' else 'On file' end,
      coalesce(nullif(el->>'owner',''), nullif(el->>'src',''), nullif(el->>'jurisdiction','')),
      case when coalesce(el->>'file_date',el->>'decision_date') ~ '^\d{4}-\d{2}-\d{2}' then left(coalesce(el->>'file_date',el->>'decision_date'),10)::date end,
      g.lat, g.lng,
      case lower(coalesce(el->>'bucket','')) when 'proposed' then 72 when 'approved' then 55 when 'built' then 55 else 45 end,
      coalesce(el->>'record_url', el->>'url'), 'development'
    from public.development_reports dr, jsonb_array_elements(dr.sites) el
    join public.app_geocodes g
      on g.source_key = _zip||'|'||upper(btrim(el->>'address'))
     and g.geo_scope = 'address' and g.lat is not null and g.lng is not null
    where dr.zip=_zip and coalesce(el->>'relevance','')='development'
      and coalesce(el->>'scope','')<>'point'
      and coalesce(el->>'record_url', el->>'url','')<>''
      and coalesce(el->>'address','')<>''
    order by
      case when coalesce(el->>'file_date',el->>'decision_date') ~ '^\d{4}-\d{2}-\d{2}' then left(coalesce(el->>'file_date',el->>'decision_date'),10)::date end desc nulls last
    limit 48;

    select count(*) into _nd from public.app_projects where zip=_zip and record_kind='development';
    -- promoted (area records that resolved to a genuine geofenced point), uncapped
    select count(*) into _nap
      from public.development_reports dr, jsonb_array_elements(dr.sites) el
      join public.app_geocodes g on g.source_key=_zip||'|'||upper(btrim(el->>'address')) and g.geo_scope='address'
      where dr.zip=_zip and coalesce(el->>'relevance','')='development'
        and coalesce(el->>'scope','')<>'point' and coalesce(el->>'record_url', el->>'url','')<>'';

    -- TRUE totals (uncapped) — parcel-precise point dev + resolved-area dev.
    select
      (select count(*) from public.development_reports dr, jsonb_array_elements(dr.sites) el
        where dr.zip=_zip and coalesce(el->>'relevance','')='development'
          and coalesce(el->>'scope','')='point' and coalesce(el->>'record_url', el->>'url','')<>'')
      + _nap
      into _ndp;
    select count(*) into _nfc
    from public.development_reports dr, jsonb_array_elements(dr.sites) el
    where dr.zip=_zip and coalesce(el->>'relevance','') not in ('development','civic')
      and coalesce(el->>'record_url', el->>'url','')<>'' and coalesce(nullif(el->>'label',''),'')<>'';

    -- (2) EPA/ECHO regulated FACILITIES — UNCHANGED (record_kind='facility').
    insert into public.app_projects (community_id, zip, name, type, status, developer, lat, lng, impact_score, source_ref, record_kind, registry_id, facility_env)
    select _cid, _zip, el->>'label',
      coalesce(nullif(el->>'use_type',''), nullif(el->>'layer',''), 'Regulated facility'),
      'Operating', coalesce(nullif(el->>'src',''),'Public registry'),
      case when el->>'lat' ~ '^-?[0-9.]+$' then (el->>'lat')::double precision end,
      case when el->>'lng' ~ '^-?[0-9.]+$' then (el->>'lng')::double precision end,
      30, coalesce(el->>'record_url', el->>'url'), 'facility',
      nullif(el->>'registry_id',''),
      nullif(jsonb_strip_nulls(jsonb_build_object(
        'link_type', el->'env'->>'link_type',
        'epa',       el->'env'->'epa',
        'tceq',      el->'env'->'tceq',
        'tceq_rn',   nullif(el->>'tceq_rn',''),
        'tceq_url',  nullif(el->>'tceq_url','')
      )), '{}'::jsonb)
    from public.development_reports dr, jsonb_array_elements(dr.sites) el
    where dr.zip=_zip and coalesce(el->>'relevance','') not in ('development','civic')
      and coalesce(el->>'record_url', el->>'url','')<>'' and coalesce(nullif(el->>'label',''),'')<>''
    order by el->>'label'
    limit 16;
    select count(*) into _nf from public.app_projects where zip=_zip and record_kind='facility';

    -- (3) area-scope DEVELOPMENT that did NOT resolve to a genuine point ->
    -- app_changes 'Planning & zoning', NULL coords, with the exclusion reason
    -- (from app_geocodes if we tried, else 'not_point_materialized'). NEVER the
    -- ZIP-centroid coordinate. (Was: unconditional insert of 6 rows, no coords.)
    insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, lens, geo_exclusion_reason)
    select _cid, _zip, 'Planning & zoning',
      el->>'label',
      'Notice from '||coalesce(nullif(el->>'src',''), nullif(el->>'jurisdiction',''), coalesce(_county||' County','the county'))||' — see the official record.',
      case when el->>'file_date' ~ '^\d{4}-\d{2}-\d{2}'
                and left(el->>'file_date',10)::date between date '2000-01-01' and (current_date + interval '2 years')
           then left(el->>'file_date',10)::date else current_date end,
      coalesce(el->>'record_url', el->>'url'), 'Medium', 'value',
      coalesce(g.reason, 'not_point_materialized')
    from public.development_reports dr, jsonb_array_elements(dr.sites) el
    left join public.app_geocodes g on g.source_key = _zip||'|'||upper(btrim(el->>'address'))
    where dr.zip=_zip and coalesce(el->>'relevance','')='development'
      and coalesce(el->>'scope','')<>'point'
      and coalesce(el->>'record_url', el->>'url','')<>''
      and coalesce(g.geo_scope,'') <> 'address'   -- resolved ones were promoted above
    order by
      case when el->>'file_date' ~ '^\d{4}-\d{2}-\d{2}' then left(el->>'file_date',10)::date end desc nulls last
    limit 12;

    -- (4) PMN civic notices (jurisdiction-wide) -> app_changes, sidebar. UNCHANGED
    -- behavior; now stamped with an honest reason.
    insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, lens, geo_exclusion_reason)
    select _cid, _zip, 'Government & civic',
      el->>'label',
      'Public notice from '||coalesce(nullif(el->>'src',''), coalesce(_county||' County','the county'))||' — see the official record.',
      current_date, coalesce(el->>'record_url', el->>'url'), 'Medium', 'safety', 'civic_jurisdiction_wide'
    from public.development_reports dr, jsonb_array_elements(dr.sites) el
    where dr.zip=_zip and coalesce(el->>'relevance','')='civic' and coalesce(el->>'record_url', el->>'url','')<>''
    limit 6;
  end if;

  -- (5) MEETINGS -> app_changes, ALWAYS timeline (Finding 7: never a map marker).
  -- Coords intentionally NULL; reason 'meeting_timeline_by_design'. UNCHANGED behavior.
  insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, window_closes_at, lens, geo_exclusion_reason)
  select coalesce(_root,_cid), _zip, 'Government & civic',
    'Public meeting — '||m.title,
    coalesce(_county||' County','County')||' '||coalesce(nullif(m.meeting_type,''),'meeting')||' on '||to_char(m.meeting_date,'Mon DD, YYYY')||coalesce(' · '||nullif(m.location,''),'')||'.',
    current_date, m.source_url, 'High', m.meeting_date::date, 'safety', 'meeting_timeline_by_design'
  from public.meetings m
  where m.community_id = coalesce(_root,_cid) and m.meeting_date >= now() and coalesce(m.source_url,'')<>''
  order by m.meeting_date asc limit 8;

  -- (6) GOV NOTICES from public.alerts (the civic-alerts source of truth).
  -- P1 CHANGE: carry the geocoded point (geo_lat/geo_lng) ONLY when geo_scope=
  -- 'address' (a genuine street-address geocode). Everything else stays NULL ->
  -- sidebar, with an honest reason. A row with real coords is plotted by the
  -- UNCHANGED frontend automatically.
  insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, window_closes_at, lens, lat, lng, geo_exclusion_reason)
  select coalesce(_root,_cid), _zip, 'Government & civic',
    a.title,
    'Government notice'||coalesce(' — '||nullif(a.category,''),'')||' from '||coalesce(_county||' County','the county')||' — see the official record.',
    a.created_at::date, a.source_url, 'High', a.comment_deadline, 'safety',
    case when a.geo_scope='address' then a.geo_lat end,
    case when a.geo_scope='address' then a.geo_lng end,
    case when a.geo_scope='address' and a.geo_lat is not null and a.geo_lng is not null then null
         when a.geo_scope='countywide' then 'countywide'
         when a.geographic_reference is null or a.geographic_reference='' then 'no_geographic_reference'
         else 'not_point_materialized' end
  from public.alerts a
  where a.community_id = coalesce(_root,_cid)
    and a.pipeline_type = 'government_notice'
    and coalesce(a.source_url,'')<>''
    and a.created_at >= now() - interval '14 days'
    and not exists (select 1 from public.app_changes ac where ac.zip=_zip and ac.source_ref = a.source_url)
  order by a.created_at desc limit 48;

  select count(*) into _nc from public.app_changes where zip=_zip and coalesce(source_ref,'')<>'';
  select count(*) into _nm from public.meetings m where m.community_id = coalesce(_root,_cid) and m.meeting_date >= now();

  insert into public.app_community_meta (zip, community_id, name, county, state, growth_pressure, component_scores, civic_activity, blurb, covered, data_quality, indexable, lat, lng)
  select _zip, _cid, c.name, c.county, c.state,
    case when _nd>=15 then 'High' when _nd>0 then 'Medium' else null end,
    case when _has_report then jsonb_build_object(
       'development projects',     jsonb_build_object('label',_ndp::text,'pct',least(100,_ndp),'tone','amber'),
       'planning & civic notices', jsonb_build_object('label',_nc::text,'pct',least(100,_nc),'tone','amber'),
       'regulated facilities',     jsonb_build_object('label',_nfc::text,'pct',least(100,_nfc),'tone','blue')) else null end,
    case when _nm>=6 then 'High' when _nm>=2 then 'Moderate' when _nm>=1 then 'Light' else null end,
    case when (_nd+_nf+_nc)>0 then 'Real public records for this area — permits, planning & civic notices, EPA-registered facilities, and county meetings, each linked to its official source.'
         else 'Coverage for this ZIP is being wired — '||coalesce(_county||' County','county')||' meeting and permit feeds are coming.' end,
    true,
    case when (_nd+_nf+_nc)>0 then 'pass' else 'coverage_coming' end,
    ((_nd+_nf+_nc)>0 and (_ndp > 0 or _nfc >= 3)),
    _lat, _lng
  from public.communities c where c.id=_cid
  on conflict (zip) do update set data_quality=excluded.data_quality, growth_pressure=excluded.growth_pressure,
    component_scores=excluded.component_scores, civic_activity=excluded.civic_activity, blurb=excluded.blurb,
    name=excluded.name, county=excluded.county, state=excluded.state, indexable=excluded.indexable, updated_at=now(),
    lat=coalesce(excluded.lat, app_community_meta.lat), lng=coalesce(excluded.lng, app_community_meta.lng);

  return _zip||': development='||_nd||'/'||_ndp||' (area-geocoded='||_nap||') facilities='||_nf||'/'||_nfc||' notices='||_nc||' quality='||(case when (_nd+_nf+_nc)>0 then 'pass' else 'coverage_coming' end);
end $function$;

-- ---------------------------------------------------------------- P4: summary fn
-- Per-layer processed / materialized / displayed(mappable) / excluded + reasons.
-- Read-only; safe to call any time. 'displayed' = rows that will render as a MAP
-- MARKER (valid coords); meetings are timeline-only so displayed is always 0.
create or replace function public.app_materialization_summary()
 returns table(layer text, records_processed bigint, records_materialized bigint,
               records_displayed bigint, records_excluded bigint, reason_counts jsonb)
 language sql stable
as $function$
  with proj as (
    select record_kind,
      count(*) processed,
      count(*) filter (where lat is not null and lng is not null) displayed,
      count(*) filter (where lat is null or lng is null) excluded
    from public.app_projects group by record_kind
  ),
  -- app_changes, split: meetings (timeline by design) vs notices/planning
  chg as (
    select
      case when geo_exclusion_reason = 'meeting_timeline_by_design' then 'meeting'
           else 'government_notice' end as layer,
      lat, lng, geo_exclusion_reason
    from public.app_changes
  ),
  chg_counts as (
    select layer,
      count(*) processed,
      count(*) filter (where lat is not null and lng is not null) displayed,
      count(*) filter (where lat is null or lng is null) excluded
    from chg group by layer
  ),
  chg_reasons as (
    select layer, coalesce(jsonb_object_agg(reason, n) filter (where reason is not null), '{}'::jsonb) rc
    from (select layer, geo_exclusion_reason reason, count(*) n from chg group by layer, geo_exclusion_reason) s
    group by layer
  )
  select 'development'::text, processed, processed, displayed, excluded, '{}'::jsonb
    from proj where record_kind='development'
  union all
  select 'facility'::text, processed, processed, displayed, excluded, '{}'::jsonb
    from proj where record_kind='facility'
  union all
  select c.layer, c.processed, c.processed, c.displayed, c.excluded, coalesce(r.rc,'{}'::jsonb)
    from chg_counts c left join chg_reasons r using (layer);
$function$;

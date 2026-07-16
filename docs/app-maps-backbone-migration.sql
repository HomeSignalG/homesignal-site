-- ============================================================================
-- MAPS BACKBONE FIX (2026-07-16 audit) — schema + materializer changes.
-- Parked per repo convention; applied live via MCP migration
-- `app_maps_backbone_centroids_and_date_sanity`.
--
-- Companion front-end (same PR): lib/map.js status-color backbone + guarded
-- buildLive chain, maps.html honest legend/chip/area-list/centroid centering,
-- dashboard.html honest home + guarded engine, lib/data.js recency ordering.
--
-- What this migration fixes (audit findings #6, #10):
--   * app_community_meta had NO lat/lng — the pages' `c.lat` centroid fallback
--     could never work, so empty ZIPs anchored on hardcoded Del Valle, TX
--     coordinates. Adds lat/lng, stamped by app_refresh_zip from the
--     development_reports centroid (home_lat/home_lng — pinned to the USPS
--     zipcodes v3.0.0 dataset by the engine batches), plus a one-time backfill.
--   * app_changes carried garbage source dates (16 rows pre-2020, oldest
--     1986-12-12) presented as current civic changes. The Planning & zoning
--     insert now sanity-windows occurred_at to [2000-01-01, today+2y] (a bad
--     date falls back to current_date exactly like a missing one), and the
--     existing out-of-window rows are purged (the nightly app_refresh_all
--     would otherwise reinsert them — the function fix prevents that).
--
-- app_refresh_zip body below = the live body pulled verbatim via
-- pg_get_functiondef 2026-07-16, with ONLY these additive edits:
--   1. declare _lat/_lng + select them from development_reports.
--   2. Planning & zoning app_changes insert: occurred_at sanity window.
--   3. app_community_meta insert/upsert: lat/lng columns (coalesce-preserved on
--      conflict so a report-less refresh never nulls a good centroid).
-- NOTE: impact_score is still WRITTEN (other readers may exist) but the map
-- backbone no longer interprets it as "impact" — pins are colored by status.
-- ============================================================================

begin;

alter table public.app_community_meta add column if not exists lat double precision;
alter table public.app_community_meta add column if not exists lng double precision;
comment on column public.app_community_meta.lat is 'ZIP centroid latitude (from development_reports.home_lat — USPS zipcodes v3.0.0). Map viewport anchor; NOT a resident home.';
comment on column public.app_community_meta.lng is 'ZIP centroid longitude (see lat).';

CREATE OR REPLACE FUNCTION public.app_refresh_zip(_zip text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare _cid uuid; _root uuid; _county text; _nd int; _ndp int; _nf int; _nfc int; _nc int; _nm int; _has_report boolean;
        _lat double precision; _lng double precision;
begin
  select id, county into _cid, _county from public.communities
    where _zip = any(zip_codes) order by (level='zip') desc, (level='city') desc limit 1;
  select parent_id into _root from public.communities where id = _cid;
  if _county is null then select county into _county from public.communities where id = coalesce(_root,_cid); end if;
  select exists(select 1 from public.development_reports where zip=_zip) into _has_report;
  -- ZIP centroid for the map viewport anchor (engine-pinned; null if no report)
  select home_lat, home_lng into _lat, _lng from public.development_reports where zip=_zip;

  delete from public.app_projects where zip=_zip;
  delete from public.app_changes  where zip=_zip;
  _nd := 0; _ndp := 0; _nf := 0; _nfc := 0; _nc := 0; _nm := 0;

  if _has_report then
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
    select count(*) into _nd from public.app_projects where zip=_zip and record_kind='development';

    -- TRUE totals from the cache (uncapped) — what the meta bars report
    select count(*) into _ndp
    from public.development_reports dr, jsonb_array_elements(dr.sites) el
    where dr.zip=_zip and coalesce(el->>'relevance','')='development'
      and coalesce(el->>'scope','')='point' and coalesce(el->>'record_url', el->>'url','')<>'';
    select count(*) into _nfc
    from public.development_reports dr, jsonb_array_elements(dr.sites) el
    where dr.zip=_zip and coalesce(el->>'relevance','') not in ('development','civic')
      and coalesce(el->>'record_url', el->>'url','')<>'' and coalesce(nullif(el->>'label',''),'')<>'';

    insert into public.app_projects (community_id, zip, name, type, status, developer, lat, lng, impact_score, source_ref, record_kind)
    select _cid, _zip, el->>'label',
      coalesce(nullif(el->>'use_type',''), nullif(el->>'layer',''), 'Regulated facility'),
      'Operating', coalesce(nullif(el->>'src',''),'Public registry'),
      case when el->>'lat' ~ '^-?[0-9.]+$' then (el->>'lat')::double precision end,
      case when el->>'lng' ~ '^-?[0-9.]+$' then (el->>'lng')::double precision end,
      30, coalesce(el->>'record_url', el->>'url'), 'facility'
    from public.development_reports dr, jsonb_array_elements(dr.sites) el
    where dr.zip=_zip and coalesce(el->>'relevance','') not in ('development','civic')
      and coalesce(el->>'record_url', el->>'url','')<>'' and coalesce(nullif(el->>'label',''),'')<>''
    order by el->>'label'
    limit 16;
    select count(*) into _nf from public.app_projects where zip=_zip and record_kind='facility';

    insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, lens)
    select _cid, _zip, 'Planning & zoning',
      el->>'label',
      'Notice from '||coalesce(nullif(el->>'src',''), nullif(el->>'jurisdiction',''), coalesce(_county||' County','the county'))||' — see the official record.',
      -- DATE SANITY (2026-07-16 audit): a source file_date outside a sane window
      -- (bad parse — the cache carried a 1986 date) falls back to current_date
      -- exactly like a missing one; the real record still surfaces.
      case when el->>'file_date' ~ '^\d{4}-\d{2}-\d{2}'
                and left(el->>'file_date',10)::date between date '2000-01-01' and (current_date + interval '2 years')
           then left(el->>'file_date',10)::date else current_date end,
      coalesce(el->>'record_url', el->>'url'), 'Medium', 'value'
    from public.development_reports dr, jsonb_array_elements(dr.sites) el
    where dr.zip=_zip and coalesce(el->>'relevance','')='development'
      and coalesce(el->>'scope','')<>'point'
      and coalesce(el->>'record_url', el->>'url','')<>''
    limit 6;

    insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, lens)
    select _cid, _zip, 'Government & civic',
      el->>'label',
      'Public notice from '||coalesce(nullif(el->>'src',''), coalesce(_county||' County','the county'))||' — see the official record.',
      current_date, coalesce(el->>'record_url', el->>'url'), 'Medium', 'safety'
    from public.development_reports dr, jsonb_array_elements(dr.sites) el
    where dr.zip=_zip and coalesce(el->>'relevance','')='civic' and coalesce(el->>'record_url', el->>'url','')<>''
    limit 6;
  end if;

  insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, window_closes_at, lens)
  select coalesce(_root,_cid), _zip, 'Government & civic',
    'Public meeting — '||m.title,
    coalesce(_county||' County','County')||' '||coalesce(nullif(m.meeting_type,''),'meeting')||' on '||to_char(m.meeting_date,'Mon DD, YYYY')||coalesce(' · '||nullif(m.location,''),'')||'.',
    current_date, m.source_url, 'High', m.meeting_date::date, 'safety'
  from public.meetings m
  where m.community_id = coalesce(_root,_cid) and m.meeting_date >= now() and coalesce(m.source_url,'')<>''
  order by m.meeting_date asc limit 8;

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
    -- THE INDEXABLE SUBSTANCE GATE (threshold c): pass AND (dev-backed OR >=3 facilities)
    ((_nd+_nf+_nc)>0 and (_ndp > 0 or _nfc >= 3)),
    _lat, _lng
  from public.communities c where c.id=_cid
  on conflict (zip) do update set data_quality=excluded.data_quality, growth_pressure=excluded.growth_pressure,
    component_scores=excluded.component_scores, civic_activity=excluded.civic_activity, blurb=excluded.blurb,
    name=excluded.name, county=excluded.county, state=excluded.state, indexable=excluded.indexable, updated_at=now(),
    lat=coalesce(excluded.lat, app_community_meta.lat), lng=coalesce(excluded.lng, app_community_meta.lng);

  return _zip||': development='||_nd||'/'||_ndp||' facilities='||_nf||'/'||_nfc||' notices='||_nc||' quality='||(case when (_nd+_nf+_nc)>0 then 'pass' else 'coverage_coming' end);
end $function$;

-- One-time backfill: stamp every existing meta row's centroid from the engine cache.
update public.app_community_meta m
set lat = d.home_lat, lng = d.home_lng
from public.development_reports d
where d.zip = m.zip and (m.lat is null or m.lng is null);

-- Purge the garbage-dated civic rows the old body admitted (12 pre-2000, oldest
-- 1986-12-12); with the sanity window above the nightly refresh re-creates the
-- same records dated current_date instead of the bad parse.
delete from public.app_changes
where occurred_at < date '2000-01-01' or occurred_at > current_date + interval '2 years';

commit;

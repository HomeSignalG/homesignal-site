-- ============================================================================
-- Migration: app_refresh_zip_local_news
-- Purpose: materialize Local News into the SAME canonical pipeline as Government
--   Notices and Upcoming Meetings, so the customer-facing Local News tab (served
--   from app_changes) is no longer empty.
--
-- Root cause (verified): news is ingested into public.alerts
--   (pipeline_type='news', category='local_news', tagged to the chain-root
--   community_id) but app_refresh_zip never copied it into app_changes; the
--   Local News tab reads only app_changes, so it rendered empty. This adds ONE
--   additive statement — every other statement is byte-identical to the prior
--   applied body (app_refresh_zip_gov_notices_window14_cap48).
--
-- Design (smallest safe change):
--   * ONE new insert: recent, sourced local_news for the chain root ->
--     app_changes with category = 'Local News' (the value the site's news tab
--     keys on via /news/i, and which every other app_changes consumer ignores).
--   * Mirrors the gov-notice statement exactly: source_url REQUIRED
--     (anti-fabrication), 14-day window, newest 48, deduped by source_ref
--     against rows this run already wrote. Idempotent (app_changes for the ZIP
--     is deleted at the top of the function and rebuilt every run).
--   * Placed AFTER the app_community_meta upsert ON PURPOSE, so it does NOT feed
--     _nc / data_quality / indexable. The coverage + nationwide-index gates stay
--     byte-identical: no coverage_coming -> pass flip, no new page indexed. Local
--     News lights up the tab without changing launch/index policy or any other
--     customer-visible surface. (If the founder later wants news to count toward
--     substance, move the count above the meta upsert — a separate decision.)
--
-- Deploy ORDER (important): merge the site PR FIRST — it ships lib/data.js
--   changes(), which excludes category='Local News' from the general "what's
--   changing" feed. Applying this function before that guard is live would let
--   news rows leak into today/dashboard/maps/index on the current site. After
--   the PR is on main: apply this migration, then run select public.app_refresh_all();
--
-- REVERT: re-apply the app_refresh_zip_gov_notices_window14_cap48 body (the
--   prior version in docs/app-content-materialize.sql history). No schema change
--   to revert; the added app_changes rows clear on the next app_refresh_all().
-- ============================================================================

create or replace function public.app_refresh_zip(_zip text)
 returns text
 language plpgsql
as $function$
declare _cid uuid; _root uuid; _county text; _nd int; _ndp int; _nf int; _nfc int; _nc int; _nm int; _nn int; _has_report boolean;
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
  _nd := 0; _ndp := 0; _nf := 0; _nfc := 0; _nc := 0; _nm := 0; _nn := 0;

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

    insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, lens)
    select _cid, _zip, 'Planning & zoning',
      el->>'label',
      'Notice from '||coalesce(nullif(el->>'src',''), nullif(el->>'jurisdiction',''), coalesce(_county||' County','the county'))||' — see the official record.',
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

  -- GOV NOTICES (migration app_refresh_zip_gov_notices): recent government notices
  -- from public.alerts for the chain root. Counts toward _nc.
  insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, window_closes_at, lens)
  select coalesce(_root,_cid), _zip, 'Government & civic',
    a.title,
    'Government notice'||coalesce(' — '||nullif(a.category,''),'')||' from '||coalesce(_county||' County','the county')||' — see the official record.',
    a.created_at::date, a.source_url, 'High', a.comment_deadline, 'safety'
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

  -- LOCAL NEWS (migration app_refresh_zip_local_news — the ONLY new statement):
  -- recent, sourced local news for the chain root -> app_changes as category
  -- 'Local News'. Placed AFTER the meta upsert on purpose so it does NOT feed
  -- _nc / data_quality / indexable (coverage + index gates stay byte-identical).
  -- source_ref REQUIRED (anti-fabrication); 14-day window; newest 48; deduped by
  -- source_ref against rows this run already wrote. The site's Local News tab reads
  -- these via HS.data.news(); changes() excludes 'Local News' so no other surface
  -- is affected.
  insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, lens)
  select coalesce(_root,_cid), _zip, 'Local News',
    a.title,
    coalesce(nullif(a.description,''), 'Local news'||coalesce(' — '||nullif(a.agency_name,''),'')||'.'),
    coalesce(a.published_at::date, a.created_at::date), a.source_url, 'Medium', 'value'
  from public.alerts a
  where a.community_id = coalesce(_root,_cid)
    and a.pipeline_type = 'news'
    and a.category = 'local_news'
    and coalesce(a.source_url,'')<>''
    and a.created_at >= now() - interval '14 days'
    and not exists (select 1 from public.app_changes ac where ac.zip=_zip and ac.source_ref = a.source_url)
  order by a.created_at desc limit 48;
  select count(*) into _nn from public.app_changes where zip=_zip and category='Local News';

  return _zip||': development='||_nd||'/'||_ndp||' facilities='||_nf||'/'||_nfc||' notices='||_nc||' news='||_nn||' quality='||(case when (_nd+_nf+_nc)>0 then 'pass' else 'coverage_coming' end);
end $function$;

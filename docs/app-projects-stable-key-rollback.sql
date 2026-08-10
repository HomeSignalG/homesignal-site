-- ============================================================================
-- ROLLBACK for docs/app-projects-stable-key-migration.sql
-- ============================================================================
-- ⚠️ READ THIS FIRST. Rolling back RESTORES A KNOWN DATA-DESTROYING BUG:
--    the prior app_refresh_zip() opened with
--        delete from public.app_projects where zip=_zip;
--    and property_company_roles / project_facility_refs / identity_conflicts all
--    carry FK ... ON DELETE CASCADE, so each refresh DESTROYED the evidence rows
--    for that ZIP (proven live, rolled back: 78617 -> roles 66->53, facility refs
--    33->0, conflicts 4->0). Prefer fixing forward.
--
-- STAGED ROLLBACK — each step is independent, least-invasive first:
--
--   STEP A (behaviour only, KEEPS the safety guard):
--     nothing to do. The new function is a strict superset of the old one for
--     every read path; its outputs were verified identical (78617 537 rows,
--     60601 1730, 85003 3635, 28470 19155 — same counts, same content).
--
--   STEP B (drop the upsert, keep the columns):
--     run PART 1 below. Restores the exact pre-change body captured from the live
--     database on 2026-08-10 BEFORE the migration was applied. NOTE: the live
--     function was NOT byte-identical to any existing docs/*.sql file (they had
--     drifted), which is why it is reproduced here rather than referenced.
--
--   STEP C (remove the schema, only if Step B is permanent):
--     run PART 2. The columns and index are additive and harmless if left.
--
-- The adoption backfill is NOT reversible field-by-field and does not need to be:
-- it only WROTE source_key/source_key_basis/source_seq on rows that had none, and
-- changed no column any reader uses.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PART 1 — restore the pre-change app_refresh_zip (REINTRODUCES THE CASCADE BUG)
-- ---------------------------------------------------------------------------
create or replace function public.app_refresh_zip(_zip text)
 returns text
 language plpgsql
as $function$
declare _cid uuid; _root uuid; _county text; _nd int; _ndp int; _nf int; _nfc int; _nc int; _nm int; _nn int; _has_report boolean;
        _lat double precision; _lng double precision;
        _refreshed timestamptz; _vintage text;
begin
  select id, county into _cid, _county from public.communities
    where zip_codes @> array[_zip] order by (level='zip') desc, (level='city') desc, id limit 1;
  with recursive up as (
    select id, parent_id, 0 as d from public.communities where id = _cid
    union all
    select c.id, c.parent_id, up.d+1 from public.communities c
      join up on c.id = up.parent_id where up.d < 6)
  select id into _root from up order by d desc limit 1;
  if _county is null then select county into _county from public.communities where id = coalesce(_root,_cid); end if;
  select exists(select 1 from public.development_reports where zip=_zip) into _has_report;
  select home_lat, home_lng, refreshed_at, source_vintage
    into _lat, _lng, _refreshed, _vintage
    from public.development_reports where zip=_zip;
  if _lat is null or _lng is null then
    select lat, lng into _lat, _lng from public.zip_centroids where zip=_zip;
  end if;

  delete from public.app_projects where zip=_zip;
  delete from public.app_changes  where zip=_zip;
  _nd := 0; _ndp := 0; _nf := 0; _nfc := 0; _nc := 0; _nm := 0; _nn := 0;

  if _has_report then
    insert into public.app_projects (community_id, zip, name, type, status, stage, developer, size, investment, submitted_at, lat, lng, impact_score, source_ref, record_kind, registry_id, date_kind,
                                     address, start_date, end_date, scope_text, parties, provenance)
    select _cid, _zip, el->>'label',
      coalesce(nullif(el->>'use_type',''), el->>'layer'),
      case when lower(coalesce(el->>'decided','')) = 'true' then 'Decided'
           else case lower(coalesce(nullif(el->>'bucket',''), nullif(el->>'type',''), ''))
             when 'built' then 'Active' when 'approved' then 'Approved'
             when 'proposed' then 'Proposed' when 'operating' then 'Operating'
             else 'On file' end
      end,
      coalesce(nullif(el->>'status_raw',''), nullif(el->>'status_text','')),
      coalesce(nullif(el->>'owner',''), nullif(el->>'src','')),
      case when el->>'sqft' ~ '^[0-9.]+$' then trim(to_char((el->>'sqft')::numeric,'FM999,999,999'))||' sq ft' end,
      case when el->>'est_cost' ~ '^[0-9.]+$' then '$'||trim(to_char((el->>'est_cost')::numeric,'FM999,999,999')) end,
      case when coalesce(el->>'file_date',el->>'decision_date') ~ '^\d{4}-\d{2}-\d{2}' then left(coalesce(el->>'file_date',el->>'decision_date'),10)::date end,
      case when el->>'lat' ~ '^-?[0-9.]+$' then (el->>'lat')::double precision end,
      case when el->>'lng' ~ '^-?[0-9.]+$' then (el->>'lng')::double precision end,
      case lower(coalesce(nullif(el->>'bucket',''), nullif(el->>'type',''), ''))
        when 'proposed' then 72 when 'approved' then 55 when 'built' then 55 else 45 end,
      coalesce(el->>'record_url', el->>'url'), 'development', nullif(el->>'source_registry_id',''),
      case when el->>'file_date' ~ '^\d{4}-\d{2}-\d{2}'
             then coalesce(nullif(el->>'file_date_kind',''), 'filed')
           when el->>'decision_date' ~ '^\d{4}-\d{2}-\d{2}'
             then 'decided' end,
      coalesce(nullif(el->>'address',''), nullif(el->>'location_addr','')),
      case when el->>'start_date' ~ '^\d{4}-\d{2}-\d{2}' then left(el->>'start_date',10)::date end,
      case when el->>'end_date'   ~ '^\d{4}-\d{2}-\d{2}' then left(el->>'end_date',10)::date end,
      nullif(el->>'scope_text',''),
      nullif(public.app_attach_parents(public.app_site_parties(el)), '[]'::jsonb),
      nullif(jsonb_strip_nulls(jsonb_build_object(
        'src',            nullif(el->>'src',''),
        'jurisdiction',   nullif(el->>'jurisdiction',''),
        'source_class',   nullif(el->>'source_class',''),
        'case_number',    coalesce(nullif(el->>'case_number',''), nullif(el->>'project_no','')),
        'url_precision',  nullif(el->>'record_url_precision',''),
        'geo_precision',  nullif(el->>'geo_precision',''),
        'canonical_addr', nullif(el->>'canonical_addr',''),
        'refreshed_at',   _refreshed,
        'source_vintage', _vintage
      )), '{}'::jsonb)
    from public.dev_sites_deduped(_zip) as t
    where coalesce(el->>'relevance','')='development'
      and coalesce(el->>'scope','')='point'
      and coalesce(el->>'record_url', el->>'url','')<>''
    order by
      case when coalesce(el->>'file_date',el->>'decision_date') ~ '^\d{4}-\d{2}-\d{2}' then left(coalesce(el->>'file_date',el->>'decision_date'),10)::date end desc nulls last,
      md5(el::text);
    select count(*) into _nd from public.app_projects where zip=_zip and record_kind='development';

    select count(*) into _ndp
    from public.dev_sites_deduped(_zip) as t
    where coalesce(el->>'relevance','')='development'
      and coalesce(el->>'scope','')='point' and coalesce(el->>'record_url', el->>'url','')<>'';
    select count(*) into _nfc
    from public.dev_sites_deduped(_zip) as t
    where coalesce(el->>'relevance','') not in ('development','civic')
      and coalesce(el->>'record_url', el->>'url','')<>'' and coalesce(nullif(el->>'label',''),'')<>'';

    insert into public.app_projects (community_id, zip, name, type, status, developer, lat, lng, impact_score, source_ref, record_kind, registry_id, facility_env,
                                     address, provenance)
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
      )), '{}'::jsonb),
      coalesce(nullif(el->>'address',''), nullif(el->>'location_addr','')),
      nullif(jsonb_strip_nulls(jsonb_build_object(
        'src',            nullif(el->>'src',''),
        'jurisdiction',   nullif(el->>'jurisdiction',''),
        'source_class',   nullif(el->>'source_class',''),
        'geo_precision',  nullif(el->>'geo_precision',''),
        'refreshed_at',   _refreshed,
        'source_vintage', _vintage
      )), '{}'::jsonb)
    from public.dev_sites_deduped(_zip) as t
    where coalesce(el->>'relevance','') not in ('development','civic')
      and coalesce(el->>'record_url', el->>'url','')<>'' and coalesce(nullif(el->>'label',''),'')<>''
    order by el->>'label', md5(el::text);
    select count(*) into _nf from public.app_projects where zip=_zip and record_kind='facility';

    update public.app_projects set lat=null, lng=null
     where zip=_zip and lat is not null and (
       lat not between 17 and 72 or lng not between -180 and -60
       or (_lat is not null and 3959*acos(least(1::double precision, greatest(-1::double precision,
            cos(radians(_lat))*cos(radians(lat))*cos(radians(lng)-radians(_lng))
            + sin(radians(_lat))*sin(radians(lat))))) > 100)
     );

    insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, lens)
    select _cid, _zip, 'Planning & zoning',
      el->>'label',
      'Notice from '||coalesce(nullif(el->>'src',''), nullif(el->>'jurisdiction',''), coalesce(_county||' County','the county'))||' — see the official record.',
      case when el->>'file_date' ~ '^\d{4}-\d{2}-\d{2}'
                and left(el->>'file_date',10)::date between date '2000-01-01' and (current_date + interval '2 years')
           then left(el->>'file_date',10)::date else current_date end,
      coalesce(el->>'record_url', el->>'url'), 'Medium', 'value'
    from public.dev_sites_deduped(_zip) as t
    where coalesce(el->>'relevance','')='development'
      and coalesce(el->>'scope','')<>'point'
      and coalesce(el->>'record_url', el->>'url','')<>''
    order by md5(el::text)
    limit 6;

    insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, lens)
    select _cid, _zip, 'Government & civic',
      el->>'label',
      'Public notice from '||coalesce(nullif(el->>'src',''), coalesce(_county||' County','the county'))||' — see the official record.',
      current_date, coalesce(el->>'record_url', el->>'url'), 'Medium', 'safety'
    from public.dev_sites_deduped(_zip) as t
    where coalesce(el->>'relevance','')='civic' and coalesce(el->>'record_url', el->>'url','')<>''
    order by md5(el::text)
    limit 6;
  end if;

  insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, window_closes_at, lens)
  select coalesce(_root,_cid), _zip, 'Government & civic',
    'Public meeting — '||m.title,
    coalesce(_county||' County','County')||' '||coalesce(nullif(m.meeting_type,''),'meeting')||' on '||to_char(m.meeting_date,'Mon DD, YYYY')||coalesce(' · '||nullif(m.location,''),'')||'.',
    current_date, m.source_url, 'High', m.meeting_date::date, 'safety'
  from public.meetings m
  where m.community_id = coalesce(_root,_cid) and m.meeting_date >= now() and coalesce(m.source_url,'')<>''
  order by m.meeting_date asc, m.id limit 8;

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
  order by a.created_at desc, a.id limit 48;

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

  insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, lens)
  select coalesce(_root,_cid), _zip, 'Local News',
    a.title,
    coalesce(nullif(a.description,''), 'Local news'||coalesce(' — '||nullif(a.agency_name,''),'')||'.'),
    coalesce(a.published_at::date, a.created_at::date), a.source_url, 'Medium', 'value'
  from public.alerts a
  where a.community_id = coalesce(_root,_cid)
    and a.pipeline_type = 'news'
    and a.category = 'local_news'
    and cardinality(a.subtopics) >= 1
    and coalesce(a.source_url,'')<>''
    and a.created_at >= now() - interval '14 days'
    and not exists (select 1 from public.app_changes ac where ac.zip=_zip and ac.source_ref = a.source_url)
    and (
      not (select coalesce(bool_or(f.enabled), false) from public.app_flags f where f.name = 'page_target_zip')
      or ( (a.geo_evidence->>'status') = 'routed'
           and ( (a.geo_evidence->>'method') = 'countywide'
                 or (a.geo_evidence->'zip_set') ? _zip ) )
    )
  order by a.created_at desc, a.id limit 48;
  select count(*) into _nn from public.app_changes where zip=_zip and category='Local News';

  return _zip||': development='||_nd||'/'||_ndp||' facilities='||_nf||'/'||_nfc||' notices='||_nc||' news='||_nn||' quality='||(case when (_nd+_nf+_nc)>0 then 'pass' else 'coverage_coming' end);
end $function$;


-- ---------------------------------------------------------------------------
-- PART 2 — remove the schema (only after PART 1, and only if permanent)
-- ---------------------------------------------------------------------------
-- drop index if exists public.app_projects_zip_source_key_uidx;
-- alter table public.app_projects
--   drop column if exists source_key,
--   drop column if exists source_key_basis,
--   drop column if exists source_seq,
--   drop column if exists last_seen_at;
-- drop function if exists public.app_source_key(jsonb);
-- drop function if exists public.app_source_key_basis(jsonb);

-- ============================================================================
-- app_projects STABLE SOURCE KEY — migration of record
-- ============================================================================
-- WHY (measured 2026-08-10, receipts in docs/app-projects-stable-key-repair.md):
--
--   app_refresh_zip() began with `delete from public.app_projects where zip=_zip`.
--   property_company_roles / project_facility_refs / identity_conflicts all carry
--   a FK to app_projects(id) declared ON DELETE CASCADE (all three convalidated).
--   So a refresh did not ORPHAN downstream evidence — it DESTROYED it. Proven by
--   a rolled-back transaction on the live database:
--
--     delete from app_projects where zip='78617';
--     -> app_projects 78617      537 -> 0
--     -> property_company_roles   66 -> 53   (13 rows destroyed)
--     -> project_facility_refs    33 -> 0    (33 rows destroyed)
--     -> identity_conflicts        4 -> 0    ( 4 rows destroyed)
--
--   app_projects.id is gen_random_uuid(), so every re-materialisation also minted
--   a brand-new identity for every logical record.
--
-- WHAT THIS CHANGES:
--   1. app_projects gains a deterministic, namespaced source-record key.
--   2. app_refresh_zip() UPSERTS on that key instead of delete+insert, so a
--      refresh updates the same row and app_projects.id is preserved.
--   3. Stale records are removed explicitly (watermark), never implicitly.
--   4. A row referenced by downstream evidence is NEVER deleted by a refresh.
--      This is a hard guard: evidence destruction becomes structurally impossible
--      even if the key derivation is wrong for some future source.
--
-- WHAT THIS DOES NOT CHANGE: the selection predicates, the ordering contract
--   (FD-1 — every capped select still tie-breaks on md5(el::text)), the emitted
--   column values, app_changes, or any read path. No UI change. No connector change.
--
-- ROLLBACK: docs/app-projects-stable-key-rollback.sql (restores the prior
--   delete+insert body; the added columns are additive and may be left in place).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. THE DERIVATION — one definition, used by measurement, backfill and refresh
-- ---------------------------------------------------------------------------
-- Inputs are mutually exclusive: verified 0 overlap across 172,522 site elements
--   (source_id & registry_id 0, source_id & project_no 0, registry_id & project_no 0),
-- so the coalesce ladder is unambiguous.
--
-- Coverage measured over the FULL corpus (11,817 ZIPs / 3,022,921 qualifying
-- sites, via dev_sites_deduped — the same path the materialiser reads):
--   source_id:case_number    2,819,607   93.274%
--   epa_frs:registry_id        197,571    6.536%
--   source_id:row_id             5,113    0.169%
--   source_id:title(MUTABLE)       625    0.021%
--   tdlr:project_no                  5    0.000%
--   (no key)                         0    0.000%   <- zero
create or replace function public.app_source_key(el jsonb) returns text
language sql immutable as $$
  select case
    -- 1. Registry connectors (arcgis/socrata/ckan/csv/carto) already emit their own
    --    namespaced record identity — platform:scope:record, e.g.
    --      socrata:data.cityofchicago.org:ydr8-5enu:101077607
    --      arcgis:phoenix-building-permits:26002663
    --    Adopt it VERBATIM. Never re-derive it here: the connector is the only
    --    place that knows which upstream column is the record id.
    when nullif(btrim(el->>'source_id'),'')    is not null then btrim(el->>'source_id')
    -- 2. TDLR TABS hand adapter: the agency's own project number (TABS##########).
    when nullif(btrim(el->>'project_no'),'')   is not null then 'tdlr_tabs:'||btrim(el->>'project_no')
    -- 3. EPA FRS facility floor: the FRS Registry ID (a national record id).
    when nullif(btrim(el->>'registry_id'),'')  is not null then 'epa_frs:'||btrim(el->>'registry_id')
    -- 4. No defensible source identity. Deliberately NULL — NEVER an address,
    --    title, company-name or arbitrary-field hash. A keyless row is handled by
    --    the delete-then-insert path below and is reported, not disguised.
    else null
  end
$$;

-- Audit only: how strong is the key we derived. Exact for tdlr/epa_frs; for the
-- source_id family we compare the connector's tail segment against the fields it
-- could have used, so it is an approximation and labelled as such.
create or replace function public.app_source_key_basis(el jsonb) returns text
language sql immutable as $$
  select case
    when nullif(btrim(el->>'source_id'),'') is not null then
      case
        when nullif(btrim(el->>'case_number'),'') is not null
             and btrim(el->>'source_id') like '%:'||btrim(el->>'case_number') then 'source_id:case_number'
        when btrim(el->>'source_id') ~ ':[0-9]+$'                             then 'source_id:row_id'
        when nullif(btrim(el->>'title'),'') is not null
             and btrim(el->>'source_id') like '%:'||btrim(el->>'title')       then 'source_id:title(MUTABLE)'
        else 'source_id:other'
      end
    when nullif(btrim(el->>'project_no'),'')  is not null then 'tdlr:project_no'
    when nullif(btrim(el->>'registry_id'),'') is not null then 'epa_frs:registry_id'
    else 'none'
  end
$$;


-- ---------------------------------------------------------------------------
-- 2. COLUMNS (additive; nothing reads them until step 4)
-- ---------------------------------------------------------------------------
alter table public.app_projects
  add column if not exists source_key       text,
  add column if not exists source_key_basis text,
  add column if not exists source_seq       smallint not null default 1,
  add column if not exists last_seen_at     timestamptz;

comment on column public.app_projects.source_key is
  'Deterministic namespaced source-record identity (platform:scope:record). Stable '
  'across refreshes: the same upstream record always derives the same value. NULL '
  'means the source exposes no defensible record id — never an address/title hash.';
comment on column public.app_projects.source_seq is
  'Ordinal within (zip, source_key), assigned by md5(el::text) — the same stable key '
  'the FD-1 ordering contract uses. Always 1 where the source key is unique (88.3% of '
  'sites). >1 only inside the 37,965 measured duplicate groups; see the migration doc '
  'for the two root causes (a registry column_map defect, and genuinely distinct '
  'filings sharing a case number).';
comment on column public.app_projects.last_seen_at is
  'Refresh watermark. A row not re-observed by the current app_refresh_zip run is '
  'stale and is removed EXPLICITLY — unless downstream evidence references it.';


-- ---------------------------------------------------------------------------
-- 3. ADOPTION BACKFILL — preserve the id of every row that already carries evidence
-- ---------------------------------------------------------------------------
-- Matched ONLY on authoritative source identifiers. No address matching, no company
-- name matching, no title matching. Every one of the 39 currently-referenced rows is
-- reachable this way (34 facility rows via FRS registry id, 5 development rows via
-- TABS project number) — verified before writing this migration.
--
-- Facility rows: app_projects.registry_id holds the FRS Registry ID itself.
-- Guarded so a (zip, registry_id) that is NOT unique is left alone rather than
-- colliding on the unique index.
update public.app_projects p
   set source_key       = 'epa_frs:'||btrim(p.registry_id),
       source_key_basis = 'epa_frs:registry_id',
       source_seq       = 1
 where p.record_kind = 'facility'
   and nullif(btrim(p.registry_id),'') is not null
   and p.source_key is null
   and not exists (
     select 1 from public.app_projects q
      where q.zip = p.zip and q.record_kind='facility'
        and btrim(q.registry_id) = btrim(p.registry_id) and q.id <> p.id);

-- TDLR TABS development rows: provenance.case_number holds the agency project number.
update public.app_projects p
   set source_key       = 'tdlr_tabs:'||btrim(p.provenance->>'case_number'),
       source_key_basis = 'tdlr:project_no',
       source_seq       = 1
 where p.record_kind = 'development'
   and btrim(coalesce(p.provenance->>'case_number','')) like 'TABS%'
   and p.source_key is null
   and not exists (
     select 1 from public.app_projects q
      where q.zip = p.zip and q.record_kind='development'
        and btrim(coalesce(q.provenance->>'case_number','')) = btrim(p.provenance->>'case_number')
        and q.id <> p.id);

-- Registry-connector development rows are deliberately NOT adopted: app_projects
-- stores source_registry_id but not the platform prefix, so the key cannot be
-- reconstructed without guessing. They carry no downstream evidence (verified: all
-- 39 referenced rows are facility or TABS), so they are simply re-created keyed on
-- the first refresh of their ZIP.


-- ---------------------------------------------------------------------------
-- 4. UNIQUE INDEX — the upsert target
-- ---------------------------------------------------------------------------
-- NULLs are distinct in a btree unique index, so un-adopted legacy rows (source_key
-- NULL) coexist with this index and are cleaned up by their ZIP's first refresh.
-- Built CONCURRENTLY: app_projects is ~3.0M rows and is read by live ZIP pages.
create unique index concurrently if not exists app_projects_zip_source_key_uidx
  on public.app_projects (zip, source_key, source_seq);


-- ---------------------------------------------------------------------------
-- 5. THE MATERIALISER — upsert on stable identity, explicit stale removal
-- ---------------------------------------------------------------------------
-- Lifecycle, stated explicitly (this is the "what happens to each record" contract):
--   NEW       source record not seen before  -> INSERT, fresh id
--   UPDATED   seen before, fields changed    -> ON CONFLICT DO UPDATE, id PRESERVED
--   UNCHANGED seen before, fields identical  -> ON CONFLICT DO UPDATE, id PRESERVED
--   REMOVED   no longer emitted by the source-> deleted by the watermark sweep
--   PROTECTED referenced by downstream evidence -> NEVER deleted by a refresh,
--             even when stale or keyless. Retention beats tidiness: an evidence row
--             must not be destroyed because an upstream feed had a bad day.
--
-- FD-1 ordering contract preserved: every capped select still tie-breaks on a stable
-- immutable key (md5(el::text) for site elements, row id for alerts/meetings).
create or replace function public.app_refresh_zip(_zip text)
 returns text
 language plpgsql
as $function$
declare _cid uuid; _root uuid; _county text; _nd int; _ndp int; _nf int; _nfc int; _nc int; _nm int; _nn int; _has_report boolean;
        _lat double precision; _lng double precision;
        _refreshed timestamptz; _vintage text;
        _run timestamptz; _stale int; _kept int;
begin
  _run := clock_timestamp();
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

  -- app_changes is a pure projection with no downstream references
  -- (app_changes.related_project_id: 0 populated rows, measured) — delete+insert stays.
  delete from public.app_changes where zip=_zip;

  -- Legacy rows predating the stable key cannot participate in the upsert, so they
  -- would otherwise duplicate on every run. Remove them once — but never one that
  -- carries evidence.
  delete from public.app_projects p
   where p.zip=_zip and p.source_key is null
     and not exists (select 1 from public.property_company_roles r where r.project_id = p.id)
     and not exists (select 1 from public.project_facility_refs  f where f.project_id = p.id)
     and not exists (select 1 from public.identity_conflicts     c where c.project_id = p.id);

  _nd := 0; _ndp := 0; _nf := 0; _nfc := 0; _nc := 0; _nm := 0; _nn := 0;

  if _has_report then
    insert into public.app_projects (community_id, zip, name, type, status, stage, developer, size, investment, submitted_at, lat, lng, impact_score, source_ref, record_kind, registry_id, date_kind,
                                     address, start_date, end_date, scope_text, parties, provenance,
                                     source_key, source_key_basis, source_seq, last_seen_at)
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
      )), '{}'::jsonb),
      sk, skb, seq, _run
    from (
      select d.el,
             public.app_source_key(d.el)       as sk,
             public.app_source_key_basis(d.el) as skb,
             row_number() over (partition by public.app_source_key(d.el)
                                order by md5(d.el::text))::smallint as seq
      from public.dev_sites_deduped(_zip) as d
      where coalesce(d.el->>'relevance','')='development'
        and coalesce(d.el->>'scope','')='point'
        and coalesce(d.el->>'record_url', d.el->>'url','')<>''
        and public.app_source_key(d.el) is not null
    ) t
    order by
      case when coalesce(el->>'file_date',el->>'decision_date') ~ '^\d{4}-\d{2}-\d{2}' then left(coalesce(el->>'file_date',el->>'decision_date'),10)::date end desc nulls last,
      md5(el::text)
    on conflict (zip, source_key, source_seq) do update set
      community_id=excluded.community_id, name=excluded.name, type=excluded.type,
      status=excluded.status, stage=excluded.stage, developer=excluded.developer,
      size=excluded.size, investment=excluded.investment, submitted_at=excluded.submitted_at,
      lat=excluded.lat, lng=excluded.lng, impact_score=excluded.impact_score,
      source_ref=excluded.source_ref, record_kind=excluded.record_kind,
      registry_id=excluded.registry_id, date_kind=excluded.date_kind, address=excluded.address,
      start_date=excluded.start_date, end_date=excluded.end_date, scope_text=excluded.scope_text,
      parties=excluded.parties, provenance=excluded.provenance,
      source_key_basis=excluded.source_key_basis, last_seen_at=excluded.last_seen_at;

    insert into public.app_projects (community_id, zip, name, type, status, developer, lat, lng, impact_score, source_ref, record_kind, registry_id, facility_env,
                                     address, provenance,
                                     source_key, source_key_basis, source_seq, last_seen_at)
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
      )), '{}'::jsonb),
      sk, skb, seq, _run
    from (
      select d.el,
             public.app_source_key(d.el)       as sk,
             public.app_source_key_basis(d.el) as skb,
             row_number() over (partition by public.app_source_key(d.el)
                                order by md5(d.el::text))::smallint as seq
      from public.dev_sites_deduped(_zip) as d
      where coalesce(d.el->>'relevance','') not in ('development','civic')
        and coalesce(d.el->>'record_url', d.el->>'url','')<>'' and coalesce(nullif(d.el->>'label',''),'')<>''
        and public.app_source_key(d.el) is not null
    ) t
    order by el->>'label', md5(el::text)
    on conflict (zip, source_key, source_seq) do update set
      community_id=excluded.community_id, name=excluded.name, type=excluded.type,
      status=excluded.status, developer=excluded.developer, lat=excluded.lat, lng=excluded.lng,
      impact_score=excluded.impact_score, source_ref=excluded.source_ref,
      record_kind=excluded.record_kind, registry_id=excluded.registry_id,
      facility_env=excluded.facility_env, address=excluded.address, provenance=excluded.provenance,
      source_key_basis=excluded.source_key_basis, last_seen_at=excluded.last_seen_at;
  end if;

  -- STALE SWEEP — explicit, and it can never destroy evidence.
  delete from public.app_projects p
   where p.zip=_zip
     and (p.last_seen_at is null or p.last_seen_at < _run)
     and not exists (select 1 from public.property_company_roles r where r.project_id = p.id)
     and not exists (select 1 from public.project_facility_refs  f where f.project_id = p.id)
     and not exists (select 1 from public.identity_conflicts     c where c.project_id = p.id);
  get diagnostics _stale = row_count;
  select count(*) into _kept from public.app_projects p
   where p.zip=_zip and (p.last_seen_at is null or p.last_seen_at < _run);

  select count(*) into _nd from public.app_projects where zip=_zip and record_kind='development';
  select count(*) into _nf from public.app_projects where zip=_zip and record_kind='facility';

  if _has_report then
    select count(*) into _ndp
    from public.dev_sites_deduped(_zip) as t
    where coalesce(el->>'relevance','')='development'
      and coalesce(el->>'scope','')='point' and coalesce(el->>'record_url', el->>'url','')<>'';
    select count(*) into _nfc
    from public.dev_sites_deduped(_zip) as t
    where coalesce(el->>'relevance','') not in ('development','civic')
      and coalesce(el->>'record_url', el->>'url','')<>'' and coalesce(nullif(el->>'label',''),'')<>'';

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

  return _zip||': development='||_nd||'/'||_ndp||' facilities='||_nf||'/'||_nfc||' notices='||_nc||' news='||_nn
       ||' stale_removed='||_stale||' stale_kept_referenced='||_kept
       ||' quality='||(case when (_nd+_nf+_nc)>0 then 'pass' else 'coverage_coming' end);
end $function$;

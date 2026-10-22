-- docs/state-cleanup-sites.sql — STATE CLEANUP SITES, a regulatory layer of its own (2026-10-21)
--
-- WHAT. Florida DEP's "DEP Cleanup Sites" layer (the data behind DEP's Contamination Locator
-- Map): every waste cleanup site DEP lists as OPEN, ACTIVE or ON HOLD, with its own point, its
-- cleanup category and a link to the site's documents in DEP's own DepNexus system.
--   https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/CLEANUP_SP/MapServer/0
-- Measured 2026-10-21 via pg_net: count 10,525 · RSC2_REMEDIATION_STATUS_KEY ACTIVE 6,534 /
-- OPEN 3,247 / ONHOLD 744 (sums to 10,525) · CLCC_CLEANUP_CATEGORY_KEY PETRO 6,534 / OTHCU 3,311 /
-- BROWN 327 / PFAS 252 / SUPER 69 / FED 32 (sums to 10,525) · DATA_LOAD_DATE 2026-10-20 ·
-- 23 rows lack DOCUMENTS or ZIP5 · paging by OBJECTID with resultOffset works (2,000 a page).
--
-- MORE STATES (2026-10-21). Each state list is one row in public.state_cleanup_sources plus one
-- branch in state_cleanup_map_feature; the fire, collect, completeness, history and readers are
-- shared. Washington Ecology's cleanup sites are the second source (measured in its row below).
-- Checked and NOT loaded, because a pin must link to the site's own public record and none was
-- found: New Jersey DEP's Known Contaminated Sites List (12,600 sites, live; its per-site search,
-- njems.nj.gov/DataMiner, answers an Incapsula bot challenge to pg_net) and Michigan EGLE's Part 201
-- sites (19,000, live; no public per-site page; RIDE needs a MiLogin account).
--
-- ⚖️ FOUNDER DECISION 2026-10-21: a cleanup site is NOT an EPA facility and NOT a project Type.
-- It gets its own Map 1 switch ("State cleanup sites", under Regulatory records), is drawn
-- whatever Status/Type chips are ticked, and stays out of every EPA facility count, every
-- development count and every indexability rule. Measured why it cannot ride on the EPA layer:
-- in ZIP 33301, 0 of DEP's 7 sites lie within ~100 m of any of the 24 stored EPA facilities.
--
-- WHY A TABLE AND NOT development_reports.sites. That array is the engine's per-ZIP cache, and
-- everything that is not a development or civic element there is materialized by
-- app_refresh_zip as an app_projects FACILITY row (counted by _nf / _nfc, which drive
-- data_quality and indexable). A state layer of 10,525 rows is small enough to hold whole, and
-- holding it here keeps it independent of the EPA read that keeps timing out.
--
-- MEMBERSHIP IS GEOGRAPHY. The ZIP reader returns only sites the canonical predicate
-- geo.zip_point_membership_in places inside the ZIP's own ZCTA polygon. A ZIP with no polygon
-- returns status 'not_measured' and no sites, never a radius. DEP's own ZIP5 is stored and never
-- used to decide membership (in 33301 it lists 1400 W Commercial Blvd, which is in 33309).
--
-- HISTORY SURVIVES. A site that leaves DEP's open list is never deleted: it keeps its row, gets
-- removed_from_source_at, and stops being drawn. Every change to a site's facts is kept in
-- public.state_cleanup_site_observations (append-only). "Removed from source" means only that:
-- DEP's open-site list no longer carries it, and that is not taken to mean the cleanup is done.
--
-- LOADING, FAIL-CLOSED. pg_cron fires a count request plus 8 page requests (room for 16,000 sites)
-- and collects them a few minutes later. A run counts only when every request answered 200 with
-- valid JSON and the distinct sites equal DEP's own count; otherwise it writes NOTHING and
-- marks nothing removed. Rolled back by the block at the end of this file.

-- ── tables ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.state_cleanup_sites (
  source                 text not null,              -- 'fl_dep_cleanup'
  site_key               text not null,              -- DEP_CLEANUP_SITE_KEY
  source_db              text,                       -- SOURCE_DATABASE_NAME (STCM / ERIC)
  source_db_id           text,                       -- SOURCE_DATABASE_ID (the id DepNexus uses)
  category               text,                       -- CLCC_CLEANUP_CATEGORY_KEY, verbatim
  status                 text,                       -- RSC2_REMEDIATION_STATUS_KEY, verbatim
  name                   text,
  address                text,
  city                   text,
  state                  text not null,
  source_zip5            text,                       -- recorded, never used for membership
  lat                    double precision,
  lng                    double precision,
  coord_accuracy         smallint,                   -- CALC_COORD_ACCURACY_LEVEL_ID, verbatim
  record_url             text,                       -- DOCUMENTS (DepNexus), verbatim
  source_loaded_at       timestamptz,                -- DATA_LOAD_DATE
  content_md5            text not null,
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  removed_from_source_at timestamptz,
  primary key (source, site_key)
);
create index if not exists state_cleanup_sites_current_latlng_idx
  on public.state_cleanup_sites (lat, lng) where removed_from_source_at is null;

create table if not exists public.state_cleanup_site_observations (
  source       text not null,
  site_key     text not null,
  observed_at  timestamptz not null default now(),
  run_id       bigint,
  event        text not null check (event in ('first_seen','changed','removed_from_source','returned_to_source')),
  content_md5  text,
  facts        jsonb,                                -- the attributes + point as DEP published them
  primary key (source, site_key, observed_at, event)
);

create table if not exists public.state_cleanup_runs (
  run_id       bigserial primary key,
  source       text not null,
  fired_at     timestamptz not null default now(),
  count_req    bigint,
  page_reqs    bigint[] not null default '{}',
  finished_at  timestamptz,
  outcome      text check (outcome in ('complete','failed')),
  detail       jsonb
);

alter table public.state_cleanup_sites enable row level security;
alter table public.state_cleanup_site_observations enable row level security;
alter table public.state_cleanup_runs enable row level security;
revoke all on public.state_cleanup_sites, public.state_cleanup_site_observations, public.state_cleanup_runs
  from public, anon, authenticated;
revoke all on sequence public.state_cleanup_runs_run_id_seq from public, anon, authenticated;

-- ── sources: one row per state list. The loader reads its URL and paging from here; only the
-- per-source attribute mapping (state_cleanup_map_feature) knows a publisher's field names. ──
create table if not exists public.state_cleanup_sources (
  source      text primary key,
  state       text not null,
  agency      text not null,                -- shown on the popup: "<agency> status: …"
  query_url   text not null,                -- an ArcGIS MapServer/FeatureServer …/query endpoint
  where_sql   text not null,                -- URL-encoded where clause, the same for count and pages
  out_fields  text not null,
  page_size   int  not null check (page_size between 100 and 5000),
  max_pages   int  not null check (max_pages between 1 and 50)
);
alter table public.state_cleanup_sources enable row level security;
revoke all on public.state_cleanup_sources from public, anon, authenticated;

insert into public.state_cleanup_sources (source, state, agency, query_url, where_sql, out_fields, page_size, max_pages)
values
  -- Florida DEP, measured 2026-10-21: 10,525 sites, all OPEN / ACTIVE / ON HOLD (see the header).
  ('fl_dep_cleanup', 'FL', 'Florida DEP',
   'https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/CLEANUP_SP/MapServer/0/query', '1%3D1',
   'DEP_CLEANUP_SITE_KEY,SOURCE_DATABASE_NAME,SOURCE_DATABASE_ID,CLCC_CLEANUP_CATEGORY_KEY,'
   || 'RSC2_REMEDIATION_STATUS_KEY,BUSINESS_NAME,ADDRESS1,CITY,STCD1_STATE_ID,ZIP5,DOCUMENTS,'
   || 'DATA_LOAD_DATE,CALC_COORD_ACCURACY_LEVEL_ID,OBJECTID', 2000, 8),
  -- Washington Ecology Toxics Cleanup Program, "CleanupSites" (layer 0), measured 2026-10-21 via
  -- pg_net: 14,727 sites; SiteStatus No Further Action 8,299 (closed, not loaded) / Cleanup Started
  -- 4,178 / Awaiting Cleanup 2,019 / Construction Complete-Performance Monitoring 124 / Cleanup
  -- Complete-Active O&M/Monitoring 83 / Tracked by EPA 24. Loaded: the 6,428 not closed, 3 pages of
  -- 2,000 + 428, one row per CleanupSiteId (6,428 distinct), every one with a point. Each site's own
  -- page is apps.ecology.wa.gov/cleanupsearch/site/<CleanupSiteId> (200 for site 7330, 404 for an
  -- id that does not exist).
  ('wa_ecology_cleanup', 'WA', 'Washington Ecology',
   'https://gis.ecology.wa.gov/serverext/rest/services/Authoritative/TCP/MapServer/0/query',
   'SiteStatus%3C%3E%27No%20Further%20Action%27',
   'CleanupSiteId,FacilitySiteId,CleanupSiteName,SiteStatus,Address,City,ZipCode,OBJECTID', 2000, 6)
on conflict (source) do update set state = excluded.state, agency = excluded.agency,
  query_url = excluded.query_url, where_sql = excluded.where_sql, out_fields = excluded.out_fields,
  page_size = excluded.page_size, max_pages = excluded.max_pages;

-- ── loader: fire ──────────────────────────────────────────────────────────────────────────
create or replace function public.state_cleanup_fire(p_source text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
  c public.state_cleanup_sources; _run bigint; _cnt bigint; _pages bigint[] := '{}'; _k int;
begin
  select * into c from public.state_cleanup_sources where source = p_source;
  if c.source is null then raise exception 'unknown state cleanup source %', p_source; end if;
  -- one run at a time: an unfinished run fired in the last hour blocks a second
  if exists (select 1 from public.state_cleanup_runs
              where source = c.source and finished_at is null and fired_at > now() - interval '1 hour') then
    return null;
  end if;
  select net.http_get(c.query_url || '?where=' || c.where_sql || '&returnCountOnly=true&f=json',
                      timeout_milliseconds := 60000) into _cnt;
  for _k in 0..c.max_pages - 1 loop
    _pages := _pages || net.http_get(c.query_url || '?where=' || c.where_sql || '&outFields=' || c.out_fields
              || '&returnGeometry=true&outSR=4326&orderByFields=OBJECTID'
              || '&resultOffset=' || (_k * c.page_size) || '&resultRecordCount=' || c.page_size || '&f=json',
              timeout_milliseconds := 120000);
  end loop;
  insert into public.state_cleanup_runs (source, count_req, page_reqs)
  values (c.source, _cnt, _pages) returning run_id into _run;
  return _run;
end
$fn$;

create or replace function public.state_cleanup_fl_fire()
returns bigint
language sql
security definer
set search_path to 'public', 'pg_temp'
as $fn$ select public.state_cleanup_fire('fl_dep_cleanup') $fn$;

-- ── per-source mapping: one publisher feature -> one site row. The only place field names live.
create or replace function public.state_cleanup_map_feature(p_source text, f jsonb, p_now timestamptz)
returns public.state_cleanup_sites
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
declare
  a jsonb := f -> 'attributes';
  g jsonb := f -> 'geometry';
  s public.state_cleanup_sites;
begin
  s.source := p_source;
  s.lat := case when jsonb_typeof(g -> 'y') = 'number' then (g ->> 'y')::float8 end;
  s.lng := case when jsonb_typeof(g -> 'x') = 'number' then (g ->> 'x')::float8 end;
  s.first_seen_at := p_now; s.last_seen_at := p_now; s.removed_from_source_at := null;
  if p_source = 'fl_dep_cleanup' then
    s.site_key := nullif(a ->> 'DEP_CLEANUP_SITE_KEY', '');
    s.source_db := nullif(a ->> 'SOURCE_DATABASE_NAME', '');
    s.source_db_id := nullif(a ->> 'SOURCE_DATABASE_ID', '');
    s.category := nullif(a ->> 'CLCC_CLEANUP_CATEGORY_KEY', '');
    s.status := nullif(a ->> 'RSC2_REMEDIATION_STATUS_KEY', '');
    s.name := nullif(btrim(a ->> 'BUSINESS_NAME'), '');
    s.address := nullif(btrim(a ->> 'ADDRESS1'), '');
    s.city := nullif(btrim(a ->> 'CITY'), '');
    s.state := coalesce(nullif(a ->> 'STCD1_STATE_ID', ''), 'FL');
    s.source_zip5 := nullif(a ->> 'ZIP5', '');
    s.coord_accuracy := case when jsonb_typeof(a -> 'CALC_COORD_ACCURACY_LEVEL_ID') = 'number' then (a ->> 'CALC_COORD_ACCURACY_LEVEL_ID')::smallint end;
    s.record_url := case when a ->> 'DOCUMENTS' ~ '^https://' then a ->> 'DOCUMENTS' end;
    s.source_loaded_at := case when jsonb_typeof(a -> 'DATA_LOAD_DATE') = 'number' then to_timestamp((a ->> 'DATA_LOAD_DATE')::float8 / 1000) end;
    s.content_md5 := md5((a - 'DATA_LOAD_DATE')::text || coalesce(g::text, ''));
  elsif p_source = 'wa_ecology_cleanup' then
    s.site_key := case when a ->> 'CleanupSiteId' ~ '^[0-9]+$' then a ->> 'CleanupSiteId' end;
    s.source_db := 'Ecology TCP';
    s.source_db_id := s.site_key;
    s.category := null;                                   -- the layer states no cleanup category
    s.status := nullif(btrim(a ->> 'SiteStatus'), '');
    s.name := nullif(btrim(a ->> 'CleanupSiteName'), '');
    s.address := nullif(btrim(a ->> 'Address'), '');
    s.city := nullif(btrim(a ->> 'City'), '');
    s.state := 'WA';
    s.source_zip5 := substring(a ->> 'ZipCode' from '^[0-9]{5}');
    s.record_url := case when s.site_key is not null then 'https://apps.ecology.wa.gov/cleanupsearch/site/' || s.site_key end;
    -- OBJECTID is the layer's row number, not a fact about the site
    s.content_md5 := md5((a - 'OBJECTID')::text || coalesce(g::text, ''));
  else
    raise exception 'no mapping for state cleanup source %', p_source;
  end if;
  return s;
end
$fn$;

-- ── loader: collect (every source) ────────────────────────────────────────────────────────
create or replace function public.state_cleanup_collect()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
  r record; _now timestamptz := now();
  _answered int; _bad int; _count bigint; _n int; _distinct int;
  _ins int := 0; _chg int := 0; _rem int := 0; _out jsonb := '[]'::jsonb;
begin
  create temp table if not exists _sc (like public.state_cleanup_sites) on commit drop;
  for r in select * from public.state_cleanup_runs
            where finished_at is null and fired_at < _now - interval '2 minutes'
            order by run_id loop
    select count(*), count(*) filter (where h.status_code is distinct from 200 or h.content is null)
      into _answered, _bad
      from net._http_response h where h.id = any (r.page_reqs || r.count_req);
    if _answered < cardinality(r.page_reqs) + 1 then
      if r.fired_at < _now - interval '30 minutes' then
        update public.state_cleanup_runs set finished_at = _now, outcome = 'failed',
               detail = jsonb_build_object('reason', 'responses_missing', 'answered', _answered)
         where run_id = r.run_id;
        _out := _out || jsonb_build_object('run', r.run_id, 'source', r.source, 'outcome', 'failed', 'reason', 'responses_missing');
      end if;
      continue;
    end if;
    begin
      if _bad > 0 then raise exception 'non_200_or_empty: %', _bad; end if;
      select (h.content::jsonb ->> 'count')::bigint into _count from net._http_response h where h.id = r.count_req;
      if _count is null or _count <= 0 then raise exception 'no_count'; end if;
      if exists (select 1 from net._http_response h where h.id = any (r.page_reqs)
                  and (h.content::jsonb ? 'error' or jsonb_typeof(h.content::jsonb -> 'features') is distinct from 'array')) then
        raise exception 'page_error';
      end if;
      truncate _sc;
      insert into _sc
      select m.*
        from net._http_response h, jsonb_array_elements(h.content::jsonb -> 'features') f,
             lateral public.state_cleanup_map_feature(r.source, f, _now) m
       where h.id = any (r.page_reqs);
      select count(*), count(distinct site_key) into _n, _distinct from _sc;
      if _distinct <> _count or _n <> _count then
        raise exception 'incomplete: count % rows % distinct %', _count, _n, _distinct;
      end if;
    exception when others then
      update public.state_cleanup_runs set finished_at = _now, outcome = 'failed',
             detail = jsonb_build_object('reason', sqlerrm) where run_id = r.run_id;
      _out := _out || jsonb_build_object('run', r.run_id, 'source', r.source, 'outcome', 'failed', 'reason', sqlerrm);
      continue;
    end;

    -- the run is complete: apply it
    -- (a) observations first, so history is written before current state moves
    insert into public.state_cleanup_site_observations (source, site_key, observed_at, run_id, event, content_md5, facts)
    select n.source, n.site_key, _now, r.run_id,
           case when s.site_key is null then 'first_seen'
                when s.removed_from_source_at is not null then 'returned_to_source'
                else 'changed' end,
           n.content_md5, to_jsonb(n) - 'first_seen_at' - 'last_seen_at' - 'removed_from_source_at'
      from _sc n left join public.state_cleanup_sites s on s.source = n.source and s.site_key = n.site_key
     where s.site_key is null or s.content_md5 <> n.content_md5 or s.removed_from_source_at is not null;
    get diagnostics _chg = row_count;
    insert into public.state_cleanup_site_observations (source, site_key, observed_at, run_id, event, content_md5, facts)
    select s.source, s.site_key, _now, r.run_id, 'removed_from_source', s.content_md5, null
      from public.state_cleanup_sites s
     where s.source = r.source and s.removed_from_source_at is null
       and not exists (select 1 from _sc n where n.site_key = s.site_key);
    get diagnostics _rem = row_count;

    -- (b) current state
    insert into public.state_cleanup_sites as s
    select * from _sc
    on conflict (source, site_key) do update set
      source_db = excluded.source_db, source_db_id = excluded.source_db_id, category = excluded.category,
      status = excluded.status, name = excluded.name, address = excluded.address, city = excluded.city,
      state = excluded.state, source_zip5 = excluded.source_zip5, lat = excluded.lat, lng = excluded.lng,
      coord_accuracy = excluded.coord_accuracy, record_url = excluded.record_url,
      source_loaded_at = excluded.source_loaded_at, content_md5 = excluded.content_md5,
      last_seen_at = excluded.last_seen_at, removed_from_source_at = null;
    get diagnostics _ins = row_count;
    update public.state_cleanup_sites s set removed_from_source_at = _now
     where s.source = r.source and s.removed_from_source_at is null
       and not exists (select 1 from _sc n where n.site_key = s.site_key);

    update public.state_cleanup_runs set finished_at = _now, outcome = 'complete',
           detail = jsonb_build_object('count', _count, 'upserted', _ins, 'observations', _chg, 'removed', _rem)
     where run_id = r.run_id;
    _out := _out || jsonb_build_object('run', r.run_id, 'source', r.source, 'outcome', 'complete', 'count', _count,
                                       'observations', _chg, 'removed', _rem);
  end loop;
  return _out;
end
$fn$;

create or replace function public.state_cleanup_fl_collect()
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $fn$ select public.state_cleanup_collect() $fn$;

-- ── readers (the only resident-facing door) ─────────────────────────────────────────────
-- A PRIVATE HOME IS NOT NAMED ON THE MAP (2026-10-22). Publishers name many cleanup cases after
-- the homeowner ("Allen Residence", "Mentzer Heating Oil Tank", "ADKINS RESIDENTIAL PROPERTY").
-- The page shows "Residential property" for those; the pin, the address and the agency's own
-- record link stay, and the stored row keeps the publisher's name (history is never rewritten).
-- Three narrow rules, measured over every current site on 2026-10-22: 104 matches (FL 5, WA 99),
-- every one read by hand and every one a home. "<Name> Property" (683 sites) is deliberately NOT
-- matched: it cannot tell a person from a county or a company, and a wrong label is worse.
create or replace function public.state_cleanup_display_name(p_name text)
returns text
language sql
immutable
set search_path to 'pg_temp'
as $fn$
  select case when p_name ~* '\mresidence\M'
                or p_name ~* '\mresidential (property|hot|heating|oil|tank|site|release)\M'
                or p_name ~* '^\s*[[:alpha:]''.-]+\s+heating oil (tank|release|ust|spill)s?\s*$'
              then 'Residential property' else p_name end
$fn$;

-- How many current sites share a record link (DEP files many cases under one facility page).
create index if not exists state_cleanup_sites_current_url_idx
  on public.state_cleanup_sites (record_url) where removed_from_source_at is null;

-- One row shape for both readers, so the page has one mapping (HS.stateCleanupSite).
-- checked_at is when the last complete run of this source confirmed the site (last_seen_at);
-- record_url_sites counts the current sites sharing this site's record link.
create or replace function public.state_cleanup_site_json(s public.state_cleanup_sites, verdict text)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $fn$
  select jsonb_strip_nulls(jsonb_build_object(
    'source', s.source, 'site_key', s.site_key,
    'agency', (select c.agency from public.state_cleanup_sources c where c.source = s.source),
    'program_id', s.source_db_id, 'category', s.category, 'status', s.status,
    'name', public.state_cleanup_display_name(s.name),
    'name_withheld', case when public.state_cleanup_display_name(s.name) is distinct from s.name then true end,
    'address', s.address, 'city', s.city, 'state', s.state,
    'lat', s.lat, 'lng', s.lng, 'record_url', s.record_url,
    'record_url_sites', (select count(*) from public.state_cleanup_sites o
                          where o.record_url = s.record_url and o.removed_from_source_at is null),
    'source_loaded_at', s.source_loaded_at, 'checked_at', s.last_seen_at, 'zip_membership', verdict))
$fn$;

create or replace function public.map1_state_cleanup_zip_members(p_zip text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'geo', 'pg_temp'
as $fn$
declare v_geom geometry; v_box box2d; v_out jsonb;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then
    raise exception 'invalid zip' using errcode = '22023';
  end if;
  v_geom := geo.zip_membership_boundary(p_zip);
  if v_geom is null then
    return jsonb_build_object('zip', p_zip, 'status', 'not_measured', 'sites', '[]'::jsonb);
  end if;
  v_box := box2d(v_geom);
  select jsonb_build_object('zip', p_zip, 'status', 'complete',
           'sites', coalesce(jsonb_agg(public.state_cleanup_site_json(c.s, c.v) order by (c.s).site_key), '[]'::jsonb))
    into v_out
    from (select s, geo.zip_point_membership_in(v_geom, s.lat, s.lng) v
            from public.state_cleanup_sites s
           where s.removed_from_source_at is null and s.record_url is not null
             and s.lat between st_ymin(v_box) and st_ymax(v_box)
             and s.lng between st_xmin(v_box) and st_xmax(v_box)) c
   where c.v = 'member';
  return v_out;
end
$fn$;

-- Address mode: sites within p_radius_mi of a point (the resident's own address circle).
create or replace function public.map1_state_cleanup_near(p_lat double precision, p_lng double precision, p_radius_mi double precision)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
  select jsonb_build_object('status', 'complete',
           'sites', coalesce(jsonb_agg(public.state_cleanup_site_json(s, null::text) order by s.site_key), '[]'::jsonb))
    from public.state_cleanup_sites s
   where p_lat between -90 and 90 and p_lng between -180 and 180 and p_radius_mi > 0 and p_radius_mi <= 20
     and s.removed_from_source_at is null and s.record_url is not null
     and s.lat between p_lat - p_radius_mi / 69.0 and p_lat + p_radius_mi / 69.0
     and s.lng between p_lng - p_radius_mi / (69.0 * cos(radians(p_lat))) and p_lng + p_radius_mi / (69.0 * cos(radians(p_lat)))
     and ST_DistanceSphere(ST_MakePoint(p_lng, p_lat), ST_MakePoint(s.lng, s.lat)) <= p_radius_mi * 1609.344
$fn$;

-- Supabase grants EXECUTE on every new function in public to anon and authenticated directly,
-- so a revoke from PUBLIC alone is not a lock. Loaders: system only. Readers: public.
revoke all on function public.state_cleanup_fl_fire() from public, anon, authenticated;
revoke all on function public.state_cleanup_fl_collect() from public, anon, authenticated;
revoke all on function public.state_cleanup_fire(text) from public, anon, authenticated;
revoke all on function public.state_cleanup_collect() from public, anon, authenticated;
revoke all on function public.state_cleanup_map_feature(text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.state_cleanup_site_json(public.state_cleanup_sites, text) from public, anon, authenticated;
revoke all on function public.state_cleanup_display_name(text) from public, anon, authenticated;
revoke all on function public.map1_state_cleanup_zip_members(text) from public;
revoke all on function public.map1_state_cleanup_near(double precision, double precision, double precision) from public;
grant execute on function public.map1_state_cleanup_zip_members(text) to anon, authenticated, service_role;
grant execute on function public.map1_state_cleanup_near(double precision, double precision, double precision) to anon, authenticated, service_role;

-- ── schedule: daily, after DEP's own load (DATA_LOAD_DATE read 2026-10-20 ~05:00Z) ──────────
do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j
   where j.jobname in ('state-cleanup-fl-fire', 'state-cleanup-fl-collect', 'state-cleanup-wa-fire');
  perform cron.schedule('state-cleanup-fl-fire', '17 10 * * *', $c$select public.state_cleanup_fl_fire()$c$);
  -- Washington is fired 6 minutes later; the one collect job applies every source's finished runs.
  perform cron.schedule('state-cleanup-wa-fire', '23 10 * * *', $c$select public.state_cleanup_fire('wa_ecology_cleanup')$c$);
  perform cron.schedule('state-cleanup-fl-collect', '*/5 10-11 * * *', $c$select public.state_cleanup_fl_collect()$c$);
end $$;

-- ── ROLLBACK (run by hand; keeps the tables and their history) ─────────────────────────────
-- select cron.unschedule(jobid) from cron.job where jobname in ('state-cleanup-fl-fire','state-cleanup-wa-fire','state-cleanup-fl-collect');
-- revoke execute on function public.map1_state_cleanup_zip_members(text) from anon, authenticated;
-- revoke execute on function public.map1_state_cleanup_near(double precision, double precision, double precision) from anon, authenticated;

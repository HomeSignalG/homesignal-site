-- docs/state-water-rights.sql — STATE WATER-RIGHTS FILINGS, a section of their own (2026-10-28)
--
-- WHY. A water-rights application is filed with a STATE agency, not a city or county, so no
-- permit, planning or notice reader ever saw one. The case that found it: Utah change application
-- a55167 (Bar H Ranch Inc., one of the Stratos data-centre aliases, filed 2026-10-15) was on no
-- HomeSignal page while three newspapers reported it.
--
-- ⚖️ FOUNDER DECISION 2026-10-28: water-rights filings are their OWN section ("Water rights
-- filings"), not a Development Type and not mixed into What's Changing. Every one of the ZIP
-- pages gets the section, with one of these answers (water_rights_for_zip.status):
--   complete      the state's pending applications whose point lies inside this ZIP (maybe none)
--   unavailable   the state is read, but its last complete load is older than 48 hours
--   not_measured  the state is read, but this ZIP has no Census area to place points in
--   not_covered   HomeSignal does not read this state's water-rights records (yet). This NEVER
--                 says the state publishes nothing: most states were not checked.
--
-- WHAT IS LOADED. Each state's own published layer of PENDING applications, the ones the agency
-- has not decided. One row per point of diversion (a filing can have several); the page groups
-- points back into filings.
--   Utah Division of Water Rights, "Utah Points of Diversion" (owner Water_Rights), filter
--   SUMMARY_ST='U' (STATUS "Unapproved"). Measured 2026-10-28 via pg_net: layer count 414,551;
--   SUMMARY_ST U 6,779 (A 67,847 · P 216,428 · T 123,497). Positive control: a55167 is in it, 2
--   points, STATUS Unapproved, PRIORITY 20261015, both inside ZCTA 84336 (Snowville). For a new
--   application PRIORITY is the filing date (the newest numbers a55232..a55235 all read 20261027).
--   Idaho Department of Water Resources, "AppropriationApplicationPods": every row is a pending
--   application (Status "Active" on all 1,974 rows, measured 2026-10-28), with PriorityDate and a
--   per-application report link (WRReport).
-- CHECKED AND HELD: Nevada NDWR "Water Rights Points of Diversion" (110,389 rows) publishes its
-- status as 3-letter codes (APP, RFA, PER, …) with no decode in the layer. Showing an undecoded
-- code would be an opaque claim, so Nevada is recorded 'held' until the codes are sourced.
--
-- A PERSON IS NOT NAMED (same rule as private homes on the cleanup layer). Applicants are shown
-- by name only when the name is an organisation (water_rights_display_applicant); otherwise the
-- page says "Individual applicant". The stored row keeps the agency's name.
--
-- MEMBERSHIP IS GEOGRAPHY: geo.zip_point_membership_in against the ZIP's ZCTA polygon, never a
-- radius and never the agency's county. HISTORY SURVIVES: a filing that leaves the pending list
-- keeps its row (removed_from_source_at) and its observations; that is not taken to mean it was
-- approved or denied. LOADING FAILS CLOSED: a run writes only if every request answered and the
-- rows equal the agency's own count. Rollback block at the end.

-- ── tables ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.water_rights_filings (
  source                 text not null,              -- 'ut_dwr_pending'
  point_key              text not null,              -- filing number | point (see the mapping)
  filing_no              text not null,              -- the application number the agency uses
  right_no               text,                       -- the underlying water right, when stated
  filing_type            text,                       -- verbatim (e.g. "Application To Appropriate")
  diversion              text,                       -- verbatim point type / source
  status                 text,                       -- verbatim
  uses                   text,                       -- verbatim
  applicant              text,                       -- verbatim; the page decides what to show
  filed_on               date,                       -- the agency's date, labelled by date_label
  date_label             text,                       -- what that date is, in the agency's words
  location               text,                       -- verbatim legal description, when stated
  state                  text not null,
  lat                    double precision,
  lng                    double precision,
  record_url             text,
  content_md5            text not null,
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  removed_from_source_at timestamptz,
  primary key (source, point_key)
);
create index if not exists water_rights_filings_current_latlng_idx
  on public.water_rights_filings (lat, lng) where removed_from_source_at is null;

create table if not exists public.water_rights_filing_observations (
  source       text not null,
  point_key    text not null,
  observed_at  timestamptz not null default now(),
  run_id       bigint,
  event        text not null check (event in ('first_seen','changed','removed_from_source','returned_to_source')),
  content_md5  text,
  facts        jsonb,
  primary key (source, point_key, observed_at, event)
);

create table if not exists public.water_rights_runs (
  run_id       bigserial primary key,
  source       text not null,
  fired_at     timestamptz not null default now(),
  count_req    bigint,
  page_reqs    bigint[] not null default '{}',
  finished_at  timestamptz,
  outcome      text check (outcome in ('complete','failed')),
  detail       jsonb
);

create table if not exists public.water_rights_sources (
  source      text primary key,
  state       text not null,
  agency      text not null,
  query_url   text not null,                -- an ArcGIS …/query endpoint
  where_sql   text not null,                -- URL-encoded, the same for count and pages
  out_fields  text not null,
  page_size   int  not null check (page_size between 100 and 5000),
  max_pages   int  not null check (max_pages between 1 and 50)
);

-- One row per state: what a page in that state is told. 'loaded' points at a source; every
-- other value is shown as "HomeSignal does not read <state>'s water-rights records yet".
create table if not exists public.water_rights_states (
  state   text primary key check (state ~ '^[A-Z]{2}$'),
  name    text not null,
  status  text not null check (status in ('loaded','held','not_checked')),
  source  text references public.water_rights_sources(source),
  note    text,
  check ((status = 'loaded') = (source is not null))
);

alter table public.water_rights_filings enable row level security;
alter table public.water_rights_filing_observations enable row level security;
alter table public.water_rights_runs enable row level security;
alter table public.water_rights_sources enable row level security;
alter table public.water_rights_states enable row level security;
revoke all on public.water_rights_filings, public.water_rights_filing_observations, public.water_rights_runs,
              public.water_rights_sources, public.water_rights_states
  from public, anon, authenticated;
revoke all on sequence public.water_rights_runs_run_id_seq from public, anon, authenticated;

insert into public.water_rights_sources (source, state, agency, query_url, where_sql, out_fields, page_size, max_pages)
values
  ('ut_dwr_pending', 'UT', 'Utah Division of Water Rights',
   'https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services/Utah_Points_of_Diversion/FeatureServer/0/query',
   'SUMMARY_ST%3D%27U%27',
   'WRNUM,CHEXNUM,STATUS,TYPE_OF_RIGHT,TYPE,PRIORITY,USES,CFS,ACFT,LOCATION,OWNER,SOURCE,WebLink,OBJECTID', 2000, 8),
  ('id_idwr_applications', 'ID', 'Idaho Department of Water Resources',
   'https://gis.idwr.idaho.gov/hosting/rest/services/Allocation/AppropriationApplicationPods/FeatureServer/0/query',
   '1%3D1',
   'WaterRightNumber,Status,PriorityDate,Applicant,Source,Uses,DiversionType,WRReport,PointOfDiversionID,OBJECTID', 1000, 6)
on conflict (source) do update set state = excluded.state, agency = excluded.agency,
  query_url = excluded.query_url, where_sql = excluded.where_sql, out_fields = excluded.out_fields,
  page_size = excluded.page_size, max_pages = excluded.max_pages;

insert into public.water_rights_states (state, name, status, source, note) values
  ('AL','Alabama','not_checked',null,null), ('AK','Alaska','not_checked',null,null),
  ('AZ','Arizona','not_checked',null,null), ('AR','Arkansas','not_checked',null,null),
  ('CA','California','not_checked',null,null), ('CO','Colorado','not_checked',null,null),
  ('CT','Connecticut','not_checked',null,null), ('DE','Delaware','not_checked',null,null),
  ('FL','Florida','not_checked',null,null), ('GA','Georgia','not_checked',null,null),
  ('HI','Hawaii','not_checked',null,null), ('ID','Idaho','loaded','id_idwr_applications',null),
  ('IL','Illinois','not_checked',null,null), ('IN','Indiana','not_checked',null,null),
  ('IA','Iowa','not_checked',null,null), ('KS','Kansas','not_checked',null,null),
  ('KY','Kentucky','not_checked',null,null), ('LA','Louisiana','not_checked',null,null),
  ('ME','Maine','not_checked',null,null), ('MD','Maryland','not_checked',null,null),
  ('MA','Massachusetts','not_checked',null,null), ('MI','Michigan','not_checked',null,null),
  ('MN','Minnesota','not_checked',null,null), ('MS','Mississippi','not_checked',null,null),
  ('MO','Missouri','not_checked',null,null), ('MT','Montana','not_checked',null,null),
  ('NE','Nebraska','not_checked',null,null),
  ('NV','Nevada','held',null,'NDWR publishes application status as undecoded 3-letter codes (APP, RFA, PER, …); held until the codes are sourced (2026-10-28).'),
  ('NH','New Hampshire','not_checked',null,null), ('NJ','New Jersey','not_checked',null,null),
  ('NM','New Mexico','not_checked',null,null), ('NY','New York','not_checked',null,null),
  ('NC','North Carolina','not_checked',null,null), ('ND','North Dakota','not_checked',null,null),
  ('OH','Ohio','not_checked',null,null), ('OK','Oklahoma','not_checked',null,null),
  ('OR','Oregon','not_checked',null,null), ('PA','Pennsylvania','not_checked',null,null),
  ('RI','Rhode Island','not_checked',null,null), ('SC','South Carolina','not_checked',null,null),
  ('SD','South Dakota','not_checked',null,null), ('TN','Tennessee','not_checked',null,null),
  ('TX','Texas','not_checked',null,null), ('UT','Utah','loaded','ut_dwr_pending',null),
  ('VT','Vermont','not_checked',null,null), ('VA','Virginia','not_checked',null,null),
  ('WA','Washington','not_checked',null,null), ('WV','West Virginia','not_checked',null,null),
  ('WI','Wisconsin','not_checked',null,null), ('WY','Wyoming','not_checked',null,null)
on conflict (state) do nothing;   -- a later decision about a state is never overwritten by a replay

-- ── loader: fire ──────────────────────────────────────────────────────────────────────────
create or replace function public.water_rights_fire(p_source text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
  c public.water_rights_sources; _run bigint; _cnt bigint; _pages bigint[] := '{}'; _k int;
begin
  select * into c from public.water_rights_sources where source = p_source;
  if c.source is null then raise exception 'unknown water rights source %', p_source; end if;
  if exists (select 1 from public.water_rights_runs
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
  insert into public.water_rights_runs (source, count_req, page_reqs)
  values (c.source, _cnt, _pages) returning run_id into _run;
  return _run;
end
$fn$;

-- An agency date: Utah writes YYYYMMDD as text, Idaho epoch milliseconds. Anything else is null.
create or replace function public.water_rights_date(v jsonb)
returns date
language sql
immutable
set search_path to 'pg_temp'
as $fn$
  select case
    when jsonb_typeof(v) = 'number' then (to_timestamp((v #>> '{}')::float8 / 1000) at time zone 'UTC')::date
    when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^(1[89]|20)[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$'
      then to_date(v #>> '{}', 'YYYYMMDD')
  end
$fn$;

-- ── per-source mapping: the only place field names live ───────────────────────────────────
create or replace function public.water_rights_map_feature(p_source text, f jsonb, p_now timestamptz)
returns public.water_rights_filings
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
declare
  a jsonb := f -> 'attributes';
  g jsonb := f -> 'geometry';
  w public.water_rights_filings;
begin
  w.source := p_source;
  w.lat := case when jsonb_typeof(g -> 'y') = 'number' then (g ->> 'y')::float8 end;
  w.lng := case when jsonb_typeof(g -> 'x') = 'number' then (g ->> 'x')::float8 end;
  w.first_seen_at := p_now; w.last_seen_at := p_now; w.removed_from_source_at := null;
  if p_source = 'ut_dwr_pending' then
    -- a change application carries its own number (CHEXNUM, e.g. a55167) beside the right it
    -- changes (WRNUM); a new appropriation is known by its WRNUM.
    w.right_no := nullif(btrim(a ->> 'WRNUM'), '');
    w.filing_no := coalesce(nullif(btrim(a ->> 'CHEXNUM'), ''), w.right_no);
    w.filing_type := nullif(btrim(a ->> 'TYPE_OF_RIGHT'), '');
    w.diversion := nullif(btrim(concat_ws(' · ', nullif(btrim(a ->> 'TYPE'), ''), nullif(btrim(a ->> 'SOURCE'), ''))), '');
    w.status := nullif(btrim(a ->> 'STATUS'), '');
    w.uses := nullif(btrim(a ->> 'USES'), '');
    w.applicant := nullif(btrim(a ->> 'OWNER'), '');
    w.filed_on := public.water_rights_date(a -> 'PRIORITY');
    w.date_label := 'Priority date';
    w.location := nullif(btrim(a ->> 'LOCATION'), '');
    w.state := 'UT';
    w.record_url := case when a ->> 'WebLink' ~ '^https://(www\.)?waterrights\.utah\.gov/' then a ->> 'WebLink' end;
    -- the layer repeats a point for each water-user record (WIN); OBJECTID is a row number
    w.content_md5 := md5((a - 'OBJECTID')::text || coalesce(g::text, ''));
  elsif p_source = 'id_idwr_applications' then
    w.filing_no := nullif(btrim(a ->> 'WaterRightNumber'), '');
    w.right_no := w.filing_no;
    w.filing_type := 'Application for permit';
    w.diversion := nullif(btrim(concat_ws(' · ', nullif(btrim(a ->> 'DiversionType'), ''), nullif(btrim(a ->> 'Source'), ''))), '');
    w.status := nullif(btrim(a ->> 'Status'), '');
    w.uses := nullif(btrim(a ->> 'Uses'), '');
    w.applicant := nullif(btrim(a ->> 'Applicant'), '');
    w.filed_on := public.water_rights_date(a -> 'PriorityDate');
    w.date_label := 'Priority date';
    w.location := null;
    w.state := 'ID';
    w.record_url := case when a ->> 'WRReport' ~ '^https://research\.idwr\.idaho\.gov/' then a ->> 'WRReport' end;
    w.content_md5 := md5((a - 'OBJECTID')::text || coalesce(g::text, ''));
  else
    raise exception 'no mapping for water rights source %', p_source;
  end if;
  -- one point of one filing: the same filing at the same place is one row, whatever the layer repeats
  w.point_key := coalesce(w.filing_no, '?') || '|' ||
                 coalesce(round(w.lat::numeric, 6)::text || ',' || round(w.lng::numeric, 6)::text, w.location, '?');
  return w;
end
$fn$;

-- ── loader: collect (every source) ────────────────────────────────────────────────────────
create or replace function public.water_rights_collect()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
  r record; _now timestamptz := now();
  _answered int; _bad int; _count bigint; _n int; _nofil int;
  _ins int := 0; _chg int := 0; _rem int := 0; _out jsonb := '[]'::jsonb;
begin
  create temp table if not exists _wr_raw (like public.water_rights_filings) on commit drop;
  create temp table if not exists _wr (like public.water_rights_filings) on commit drop;
  for r in select * from public.water_rights_runs
            where finished_at is null and fired_at < _now - interval '2 minutes'
            order by run_id loop
    select count(*), count(*) filter (where h.status_code is distinct from 200 or h.content is null)
      into _answered, _bad
      from net._http_response h where h.id = any (r.page_reqs || r.count_req);
    if _answered < cardinality(r.page_reqs) + 1 then
      if r.fired_at < _now - interval '30 minutes' then
        update public.water_rights_runs set finished_at = _now, outcome = 'failed',
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
      truncate _wr_raw; truncate _wr;
      insert into _wr_raw
      select m.*
        from net._http_response h, jsonb_array_elements(h.content::jsonb -> 'features') f,
             lateral public.water_rights_map_feature(r.source, f, _now) m
       where h.id = any (r.page_reqs);
      select count(*), count(*) filter (where filing_no is null) into _n, _nofil from _wr_raw;
      -- every feature the agency counted must have arrived, and each must name its filing
      if _n <> _count then raise exception 'incomplete: count % rows %', _count, _n; end if;
      if _nofil > 0 then raise exception 'unnamed_filing: %', _nofil; end if;
      insert into _wr select distinct on (point_key) * from _wr_raw order by point_key, content_md5;
    exception when others then
      update public.water_rights_runs set finished_at = _now, outcome = 'failed',
             detail = jsonb_build_object('reason', sqlerrm) where run_id = r.run_id;
      _out := _out || jsonb_build_object('run', r.run_id, 'source', r.source, 'outcome', 'failed', 'reason', sqlerrm);
      continue;
    end;

    insert into public.water_rights_filing_observations (source, point_key, observed_at, run_id, event, content_md5, facts)
    select n.source, n.point_key, _now, r.run_id,
           case when s.point_key is null then 'first_seen'
                when s.removed_from_source_at is not null then 'returned_to_source'
                else 'changed' end,
           n.content_md5, to_jsonb(n) - 'first_seen_at' - 'last_seen_at' - 'removed_from_source_at'
      from _wr n left join public.water_rights_filings s on s.source = n.source and s.point_key = n.point_key
     where s.point_key is null or s.content_md5 <> n.content_md5 or s.removed_from_source_at is not null;
    get diagnostics _chg = row_count;
    insert into public.water_rights_filing_observations (source, point_key, observed_at, run_id, event, content_md5, facts)
    select s.source, s.point_key, _now, r.run_id, 'removed_from_source', s.content_md5, null
      from public.water_rights_filings s
     where s.source = r.source and s.removed_from_source_at is null
       and not exists (select 1 from _wr n where n.point_key = s.point_key);
    get diagnostics _rem = row_count;

    insert into public.water_rights_filings as s
    select * from _wr
    on conflict (source, point_key) do update set
      filing_no = excluded.filing_no, right_no = excluded.right_no, filing_type = excluded.filing_type,
      diversion = excluded.diversion, status = excluded.status, uses = excluded.uses,
      applicant = excluded.applicant, filed_on = excluded.filed_on, date_label = excluded.date_label,
      location = excluded.location, state = excluded.state, lat = excluded.lat, lng = excluded.lng,
      record_url = excluded.record_url, content_md5 = excluded.content_md5,
      last_seen_at = excluded.last_seen_at, removed_from_source_at = null;
    get diagnostics _ins = row_count;
    update public.water_rights_filings s set removed_from_source_at = _now
     where s.source = r.source and s.removed_from_source_at is null
       and not exists (select 1 from _wr n where n.point_key = s.point_key);

    update public.water_rights_runs set finished_at = _now, outcome = 'complete',
           detail = jsonb_build_object('count', _count, 'points', (select count(*) from _wr),
                                       'upserted', _ins, 'observations', _chg, 'removed', _rem)
     where run_id = r.run_id;
    _out := _out || jsonb_build_object('run', r.run_id, 'source', r.source, 'outcome', 'complete', 'count', _count,
                                       'observations', _chg, 'removed', _rem);
  end loop;
  return _out;
end
$fn$;

-- ── readers ───────────────────────────────────────────────────────────────────────────────
-- An applicant is named only when the name is an organisation. Whole-word tokens; a family
-- trust ("Dorothy M Revocable Trust") is a person's name and is NOT matched.
create or replace function public.water_rights_display_applicant(p_name text)
returns text
language sql
immutable
set search_path to 'pg_temp'
as $fn$
  select case
    when p_name is null or btrim(p_name) = '' then null
    when p_name ~* '\m(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co|ltd|lp|llp|pllc|partnership|association|assn|district|irrigation|canal|ditch|reservoir|water users|water company|ranch|ranches|farms?|dairy|cattle|livestock|land|properties|holdings|investments|enterprises|development|developers|builders|homes|mining|minerals|energy|power|resources|church|university|college|school|city|town|county|state|united states|bureau|department|authority|service|forest|federal)\M'
      then p_name
    else 'Individual applicant'
  end
$fn$;

create or replace function public.water_rights_for_zip(p_zip text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'geo', 'pg_temp'
as $fn$
declare
  v_state text; st public.water_rights_states; src public.water_rights_sources;
  v_last timestamptz; v_geom geometry; v_box box2d; v_filings jsonb; v_status text;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then
    raise exception 'invalid zip' using errcode = '22023';
  end if;
  select c.state into v_state from public.communities c
   where c.level = 'zip' and c.zip_codes @> array[p_zip] limit 1;
  if v_state is null then
    return jsonb_build_object('zip', p_zip, 'status', 'not_covered', 'filings', '[]'::jsonb);
  end if;
  select * into st from public.water_rights_states where state = v_state;
  if st.state is null or st.status <> 'loaded' then
    return jsonb_build_object('zip', p_zip, 'state', v_state, 'state_name', st.name,
                              'status', 'not_covered', 'filings', '[]'::jsonb);
  end if;
  select * into src from public.water_rights_sources where source = st.source;
  select max(finished_at) into v_last from public.water_rights_runs
   where source = src.source and outcome = 'complete';
  v_geom := geo.zip_membership_boundary(p_zip);
  if v_geom is null then
    return jsonb_build_object('zip', p_zip, 'state', v_state, 'state_name', st.name, 'agency', src.agency,
                              'status', 'not_measured', 'checked_at', v_last, 'filings', '[]'::jsonb);
  end if;
  v_status := case when v_last is null or v_last < now() - interval '48 hours' then 'unavailable' else 'complete' end;
  v_box := box2d(v_geom);
  select coalesce(jsonb_agg(f order by f ->> 'filed_on' desc nulls last, f ->> 'filing_no' collate "C"), '[]'::jsonb)
    into v_filings
    from (select jsonb_strip_nulls(jsonb_build_object(
                   'filing_no', w.filing_no,
                   'right_no', case when w.right_no is distinct from w.filing_no then w.right_no end,
                   'filing_type', min(w.filing_type), 'status', min(w.status),
                   'uses', min(w.uses), 'diversion', min(w.diversion),
                   'applicant', public.water_rights_display_applicant(min(w.applicant)),
                   'applicant_withheld', case when public.water_rights_display_applicant(min(w.applicant)) = 'Individual applicant' then true end,
                   'filed_on', min(w.filed_on), 'date_label', min(w.date_label),
                   'record_url', min(w.record_url),
                   'points', jsonb_agg(jsonb_build_object('lat', w.lat, 'lng', w.lng) order by w.point_key collate "C"))) f
            from public.water_rights_filings w
           where w.source = src.source and w.removed_from_source_at is null and w.record_url is not null
             and w.lat between st_ymin(v_box) and st_ymax(v_box)
             and w.lng between st_xmin(v_box) and st_xmax(v_box)
             and geo.zip_point_membership_in(v_geom, w.lat, w.lng) = 'member'
           group by w.filing_no, w.right_no) x;
  return jsonb_build_object('zip', p_zip, 'state', v_state, 'state_name', st.name, 'agency', src.agency,
                            'status', v_status, 'checked_at', v_last, 'filings', v_filings);
end
$fn$;

-- Supabase grants EXECUTE on new functions to anon and authenticated directly: revoke by name.
revoke all on function public.water_rights_fire(text) from public, anon, authenticated;
revoke all on function public.water_rights_collect() from public, anon, authenticated;
revoke all on function public.water_rights_map_feature(text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.water_rights_date(jsonb) from public, anon, authenticated;
revoke all on function public.water_rights_display_applicant(text) from public, anon, authenticated;
revoke all on function public.water_rights_for_zip(text) from public;
grant execute on function public.water_rights_for_zip(text) to anon, authenticated, service_role;

-- ── schedule: daily ───────────────────────────────────────────────────────────────────────
do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j
   where j.jobname in ('water-rights-ut-fire', 'water-rights-id-fire', 'water-rights-collect');
  perform cron.schedule('water-rights-ut-fire', '37 11 * * *', $c$select public.water_rights_fire('ut_dwr_pending')$c$);
  perform cron.schedule('water-rights-id-fire', '43 11 * * *', $c$select public.water_rights_fire('id_idwr_applications')$c$);
  perform cron.schedule('water-rights-collect', '*/5 11-12 * * *', $c$select public.water_rights_collect()$c$);
end $$;

-- ── ROLLBACK (run by hand; keeps the tables and their history) ─────────────────────────────
-- select cron.unschedule(jobid) from cron.job where jobname in ('water-rights-ut-fire','water-rights-id-fire','water-rights-collect');
-- revoke execute on function public.water_rights_for_zip(text) from anon, authenticated;

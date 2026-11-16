-- ============================================================================
-- ZIP EXPANSION, 2026-11-12: ZIP 78521 Brownsville, Texas, under a NEW Cameron County root.
-- The ZIP page universe goes from 12,745 to 12,746 (founder 2026-11-12: "Yes—proceed with the
-- approved workflow to build and activate ZIP 78521 under the correct Cameron County structure"),
-- to track the SpaceX Starbase data center and gas plant (homesignal-ingest
-- data/tracking/spacex-starbase-data-center-2026-11-12.md).
--
-- The Tab 14 request (public.community_requests, 2026-11-12 21:45Z) was REFUSED by the automatic
-- build (homesignal-ingest run 43313446789, code no_endpoints): the plan passed both county checks
-- (Cameron holds the majority of ZCTA 78521's land; USPS files 78521 under Cameron County) and
-- stopped only because the registry carried no Texas weather-alert feed. So the row was added by
-- manifest, the 97149 pattern:
--   homesignal-ingest data/local_news_gold_master/added_zips_2026-11-12_texas_brownsville.json,
--   scripts/add_gold_master_zips.py + restate_gold_master_totals.py (workbook sha256 b6552a5c…,
--   Gold Master 2.4). The workbook changed FIRST; this file makes production match it.
--
--   ZIP    page                  county root (NEW)
--   78521  Brownsville (78521)   Cameron County, TX
--
-- USPS: STANDARD ZIP, city Brownsville, Cameron County (zipcodes 3.0.0); its point
-- (25.9221, -97.4612) lies inside ZCTA 78521. Places on the ZCTA (geo.zcta_place_overlap, 2020):
-- Brownsville city 28.0%, South Point CDP 1.4%, Villa Pancho CDP, Reid Hope King CDP. The City of
-- Starbase (incorporated 2025) post-dates that file.
--
-- Order: registry row, root, ZIP page, guard self-test count 12745 -> 12746, then the build queue
-- row marked built (code hand_built) so verify-zip-universe counts it (its baseline is 12,745 plus
-- every ZIP the queue records as built). Fails closed unless the registry outside 78521 is exactly
-- the 12,745 set (md5 73e22536…). Re-running it is a no-op.
-- ============================================================================

do $$
declare
  _zip constant text := '78521';
  _sha constant text := 'b6552a5cb69f7c2427e228d9cab049a65346ac4ac4c15a6ad420156fb1cc0b06';
  _topics constant text[] := array['County Commission & county business',
    'Planning, zoning & development','Property taxes & assessments',
    'Public safety & emergencies','Water districts & utilities','Elections & voting'];
  _n int; _md5 text; _root uuid; _src text; _new text;
begin
  select count(*), md5(string_agg(zip, ',' order by zip collate "C"))
    into _n, _md5
    from public.canonical_zip_registry where zip <> _zip;
  if _n <> 12745 or _md5 <> '73e225369fc453b8403aa6f827532255' then
    raise exception 'refusing: the registry outside 78521 is % rows md5 %, expected 12745 / 73e22536…', _n, _md5;
  end if;

  insert into public.canonical_zip_registry (zip, gold_master_version, workbook_sha256)
  select _zip, '2.4', _sha
   where not exists (select 1 from public.canonical_zip_registry where zip = _zip);

  insert into public.communities (name, county, state, zip_codes, level, government_topics, slug)
  select 'Cameron County', 'Cameron', 'TX', array[_zip], 'county', _topics, 'cameron-county-tx'
   where not exists (select 1 from public.communities where slug = 'cameron-county-tx');
  select id into strict _root from public.communities
   where slug = 'cameron-county-tx' and level = 'county';
  update public.communities set zip_codes = zip_codes || array[_zip]
   where id = _root and not (zip_codes @> array[_zip]);

  insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug)
  select 'Brownsville (78521)', 'Cameron', 'TX', array[_zip], 'zip', _root, '{}'::text[], 'brownsville-78521'
   where not exists (select 1 from public.communities where slug = 'brownsville-78521');

  -- the guard self-test's expected registry size
  select prosrc into _src from pg_proc where oid = 'public.canonical_zip_guard_selftest()'::regprocedure;
  if position('12745' in _src) > 0 then
    if (length(_src) - length(replace(_src, '12745', ''))) / 5 <> 2
       or position($q$expected := '12745';$q$ in _src) = 0
       or position($q$canonical_zip_registry) = 12745);$q$ in _src) = 0 then
      raise exception 'refusing: canonical_zip_guard_selftest does not have the two 12745 anchors expected';
    end if;
    _new := replace(_src, '12745', '12746');
    execute format('create or replace function public.canonical_zip_guard_selftest() returns table '
      || '(case_name text, expected text, blocked boolean, passed boolean, detail text) '
      || 'language plpgsql security definer set search_path = public, pg_temp as %L', _new);
  end if;

  -- the Tab 14 queue's record: the request it refused is now built by hand
  update public.zip_request_builds
     set status = 'built', code = 'hand_built', workbook_sha256 = _sha, finished_at = now(), updated_at = now(),
         reason = 'Built by hand 2026-11-12 after the automatic build refused it (no_endpoints): '
               || 'manifest added_zips_2026-11-12_texas_brownsville.json with the NWS Texas alerts feed.'
   where zip = _zip and status <> 'built';

  -- post-conditions, read back from the tables
  if (select count(*) from public.canonical_zip_registry) <> 12746 then
    raise exception 'post-check: registry is not 12,746 rows';
  end if;
  if (select count(*) from public.communities c, unnest(c.zip_codes) z where z = _zip) <> 2 then
    raise exception 'post-check: 78521 must be claimed by exactly its page and its root';
  end if;
  if exists (select 1 from public.canonical_zip_guard_selftest() where not passed) then
    raise exception 'post-check: canonical_zip_guard_selftest has a failing case';
  end if;
  if not exists (select 1 from public.zip_request_builds where zip = _zip and status = 'built') then
    raise exception 'post-check: the queue does not record 78521 as built';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- After applying: build the page's development report and materialize it.
-- Centre: the USPS point for 78521 (25.9221, -97.4612), inside ZCTA 78521.
--   select net.http_post('https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
--     jsonb_build_object('zip','78521','lat',25.9221,'lng',-97.4612), '{}'::jsonb,
--     '{"Content-Type":"application/json"}'::jsonb, 120000);
--   then store the 200 with public.zip_request_store_report('78521', <body>), which upserts the
--   report and runs public.app_refresh_zip('78521').
-- ----------------------------------------------------------------------------

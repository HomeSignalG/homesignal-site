-- ============================================================================
-- ZIP EXPANSION, 2026-11-11: ZIP 97149 Neskowin, Oregon. The ZIP page universe goes from
-- 12,744 to 12,745 (founder 2026-11-11: "build page 97149 as we have received a area
-- request on tab 14"; the request came through the coverage modal on 2026-11-10).
--
-- Source of truth: homesignal-ingest Gold Master workbook, row added by
-- scripts/add_gold_master_zips.py from data/local_news_gold_master/
-- added_zips_2026-11-11_oregon_neskowin.json (workbook sha256 47e3d8d6…, Gold Master 2.4).
-- The workbook changed FIRST (homesignal-ingest #1088); this file makes production match it.
--
--   ZIP    page                county root (NEW)
--   97149  Neskowin (97149)    Tillamook County, OR
--
-- Measured 2026-11-11: ZCTA 97149 is 100.00% Tillamook County (TIGERweb State_County layer 1,
-- pg_net 14848, intersected with geo.zcta_boundary; Lincoln County touches its bounding box
-- only). USPS: STANDARD ZIP, city Neskowin (zipcodes 3.0.0). The ZCTA overlaps one place,
-- Neskowin CDP (geo.zcta_place_overlap).
--
-- Order: registry row, then the root, then the ZIP page (enforce_canonical_zip refuses a ZIP
-- not in the registry), then canonical_zip_guard_selftest's expected count 12744 -> 12745.
-- Fails closed unless the registry outside 97149 is exactly the 12,744 set (md5 c71a4f30…).
-- Re-running it is a no-op.
-- ============================================================================

do $$
declare
  _zip constant text := '97149';
  _sha constant text := '47e3d8d65926af357c5947ccb38ba95489f94336e3f373299270ff1a6076f230';
  _topics constant text[] := array['County Commission & county business',
    'Planning, zoning & development','Property taxes & assessments',
    'Public safety & emergencies','Water districts & utilities','Elections & voting'];
  _n int; _md5 text; _root uuid; _src text; _new text;
begin
  select count(*), md5(string_agg(zip, ',' order by zip collate "C"))
    into _n, _md5
    from public.canonical_zip_registry where zip <> _zip;
  if _n <> 12744 or _md5 <> 'c71a4f3028185c68819472e95aa941ee' then
    raise exception 'refusing: the registry outside 97149 is % rows md5 %, expected 12744 / c71a4f30…', _n, _md5;
  end if;

  insert into public.canonical_zip_registry (zip, gold_master_version, workbook_sha256)
  select _zip, '2.4', _sha
   where not exists (select 1 from public.canonical_zip_registry where zip = _zip);

  insert into public.communities (name, county, state, zip_codes, level, government_topics, slug)
  select 'Tillamook County', 'Tillamook', 'OR', array[_zip], 'county', _topics, 'tillamook-county-or'
   where not exists (select 1 from public.communities where slug = 'tillamook-county-or');
  select id into strict _root from public.communities
   where slug = 'tillamook-county-or' and level = 'county';
  update public.communities set zip_codes = zip_codes || array[_zip]
   where id = _root and not (zip_codes @> array[_zip]);

  insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug)
  select 'Neskowin (97149)', 'Tillamook', 'OR', array[_zip], 'zip', _root, '{}'::text[], 'neskowin-97149'
   where not exists (select 1 from public.communities where slug = 'neskowin-97149');

  -- the guard self-test's expected registry size
  select prosrc into _src from pg_proc where oid = 'public.canonical_zip_guard_selftest()'::regprocedure;
  if position('12744' in _src) > 0 then
    if (length(_src) - length(replace(_src, '12744', ''))) / 5 <> 2
       or position($q$expected := '12744';$q$ in _src) = 0
       or position($q$canonical_zip_registry) = 12744);$q$ in _src) = 0 then
      raise exception 'refusing: canonical_zip_guard_selftest does not have the two 12744 anchors expected';
    end if;
    _new := replace(_src, '12744', '12745');
    execute format('create or replace function public.canonical_zip_guard_selftest() returns table '
      || '(case_name text, expected text, blocked boolean, passed boolean, detail text) '
      || 'language plpgsql security definer set search_path = public, pg_temp as %L', _new);
  end if;

  -- post-conditions, read back from the tables
  if (select count(*) from public.canonical_zip_registry) <> 12745 then
    raise exception 'post-check: registry is not 12,745 rows';
  end if;
  if (select count(*) from public.communities c, unnest(c.zip_codes) z where z = _zip) <> 2 then
    raise exception 'post-check: 97149 must be claimed by exactly its page and its root';
  end if;
  if exists (select 1 from public.canonical_zip_guard_selftest() where not passed) then
    raise exception 'post-check: canonical_zip_guard_selftest has a failing case';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- After applying: build the page's development report and materialize it.
-- Centre: the USPS point for 97149 (45.097, -123.9434), inside ZCTA 97149.
--   select net.http_post('https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
--     jsonb_build_object('zip','97149','lat',45.097,'lng',-123.9434), '{}'::jsonb,
--     '{"Content-Type":"application/json"}'::jsonb, 120000);
--   then collect the 200 into development_reports, then select public.app_refresh_zip('97149');
-- ----------------------------------------------------------------------------

-- ============================================================================
-- ALASKA ZIP EXPANSION, 2026-10-27: ZIP 99519 Prudhoe Bay. The ZIP page universe goes from
-- 12,743 to 12,744 (founder approval 2026-10-27, "yes fix add", after the batch-2 audit).
--
-- Source of truth: homesignal-ingest Gold Master workbook, row added by
-- scripts/add_gold_master_zips.py from data/local_news_gold_master/
-- added_zips_2026-10-27_alaska_prudhoe.json (workbook sha256 2c295c1f…, Gold Master 2.4).
-- The workbook changed FIRST; this file only makes production match it.
--
--   ZIP    page                    county-equivalent (root already exists, batch 2)
--   99519  Prudhoe Bay (99519)     North Slope Borough
--
-- Why 99519, measured 2026-10-27:
--   * The Census internal point of Prudhoe Bay CDP (GEOID 0264380, +70.3658576 -148.7498043,
--     TIGERweb Places layer 26, pg_net 8925) lies in ZCTA 99519, 12,074 m outside 99734.
--   * The CDP's land is split: 469 km2 in 99519, 457 km2 in 99734 (geo.zcta_place_overlap).
--   * ZCTA 99519 is 100.00% North Slope Borough (TIGERweb State_County layer 1, pg_net 8927).
--   * USPS: PO-box ZIP, mailing city Anchorage (zipcodes 3.0.0, county North Slope Borough).
--   The page is named for the one place its ZCTA overlaps; "(99519)" tells it from 99734.
--
-- Order: registry row, then the root's zip_codes, then the ZIP page (the enforce_canonical_zip
-- triggers refuse a ZIP not in the registry). Fails closed unless the registry outside 99519 is
-- exactly the 12,743 set after batch 2 (md5 08d503e6…).
-- ============================================================================

do $$
declare
  _zip constant text := '99519';
  _sha constant text := '2c295c1f56545240692f57d4a798de180e16def712d540405c59d534f2720412';
  _n int; _md5 text; _have int; _root uuid;
begin
  select count(*), md5(string_agg(zip, ',' order by zip collate "C"))
    into _n, _md5
    from public.canonical_zip_registry where zip <> _zip;
  if _n <> 12743 or _md5 <> '08d503e6b6f186fa0e7645cb21f43ca6' then
    raise exception 'refusing: the registry outside 99519 is % rows md5 %, expected 12743 / 08d503e6…', _n, _md5;
  end if;

  select count(*) into _have from public.canonical_zip_registry where zip = _zip;
  if _have = 0 then
    insert into public.canonical_zip_registry (zip, gold_master_version, workbook_sha256)
    values (_zip, '2.4', _sha);
  end if;

  select id into strict _root from public.communities
   where slug = 'north-slope-borough-ak' and level = 'county';
  update public.communities
     set zip_codes = zip_codes || array[_zip]
   where id = _root and not (zip_codes @> array[_zip]);

  insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug)
  select 'Prudhoe Bay (99519)', p.county, 'AK', array[_zip], 'zip', p.id, '{}'::text[], 'prudhoe-bay-99519'
    from public.communities p
   where p.id = _root
     and not exists (select 1 from public.communities c where c.slug = 'prudhoe-bay-99519');

  -- post-conditions, read back from the tables
  if (select count(*) from public.canonical_zip_registry) <> 12744 then
    raise exception 'post-check: registry is not 12,744 rows';
  end if;
  if (select count(*) from public.communities c join public.communities p on p.id = c.parent_id
       where c.level = 'zip' and c.zip_codes = array[_zip] and p.id = _root
         and p.zip_codes @> array[_zip]) <> 1 then
    raise exception 'post-check: expected one 99519 page under the North Slope root that lists 99519';
  end if;
  if (select count(*) from public.communities c, unnest(c.zip_codes) z where z = _zip) <> 2 then
    raise exception 'post-check: 99519 must be claimed by exactly its page and its root';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- After applying: build the page's development report and materialize it.
-- Centre: the Prudhoe Bay CDP's Census internal point, which lies inside ZCTA 99519.
--
-- 1) FIRE
--   select net.http_post('https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
--     jsonb_build_object('zip', '99519', 'lat', 70.3658576, 'lng', -148.7498043), '{}'::jsonb,
--     '{"Content-Type":"application/json"}'::jsonb, 120000);
-- 2) COLLECT the 200 into development_reports (same upsert as the state seeds)
-- 3) select public.app_refresh_zip('99519');
-- ----------------------------------------------------------------------------

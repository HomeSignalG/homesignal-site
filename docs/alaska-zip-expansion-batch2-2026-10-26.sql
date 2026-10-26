-- ============================================================================
-- ALASKA ZIP EXPANSION, BATCH 2, 2026-10-26: the ZIP page universe goes from 12,726 to 12,743
-- (founder request 2026-10-26, after batch 1 docs/alaska-zip-expansion-2026-10-26.sql).
--
-- Source of truth: homesignal-ingest Gold Master workbook, rows added by
-- scripts/add_gold_master_zips.py from data/local_news_gold_master/
-- added_zips_2026-10-26_alaska_batch2.json (workbook sha256 13505e2e…, Gold Master 2.4).
-- The workbook changed FIRST; this file only makes production match it.
--
--   ZIP    page                    county-equivalent (root created here)
--   99685  Unalaska (99685)        Aleutians West Census Area
--   99692  Dutch Harbor (99692)    Aleutians West Census Area
--   99762  Nome (99762)            Nome Census Area
--   99723  Utqiagvik (99723)       North Slope Borough
--   99734  Prudhoe Bay (99734)     North Slope Borough
--   99752  Kotzebue (99752)        Northwest Arctic Borough
--   99576  Dillingham (99576)      Dillingham Census Area
--   99833  Petersburg (99833)      Petersburg Borough
--   99840  Skagway (99840)         Skagway Municipality
--   99929  Wrangell (99929)        Wrangell City and Borough
--   99689  Yakutat (99689)         Yakutat City and Borough
--   99633  Naknek (99633)          Bristol Bay Borough
--   99613  King Salmon (99613)     Bristol Bay Borough
--   99921  Craig (99921)           Prince of Wales-Hyder Census Area
--   99926  Metlakatla (99926)      Prince of Wales-Hyder Census Area
--   99571  Cold Bay (99571)        Aleutians East Borough
--   99661  Sand Point (99661)      Aleutians East Borough
--
-- County = the Census county polygon the ZCTA lies in (TIGERweb State_County layer 1, pg_net
-- 1606-1622). 15 ZCTAs are >= 99.5% in one county-equivalent. 99833 is 65.0% Petersburg
-- Borough / 35.0% Prince of Wales-Hyder (the town and post office are in Petersburg Borough).
-- 99613 is 81.3% Lake and Peninsula / 18.7% Bristol Bay; it is filed under Bristol Bay, where
-- King Salmon CDP (Census point 58.7229,-156.5389, inside 99613) and its post office are.
--
-- Order: registry rows, then county roots, then ZIP pages (the enforce_canonical_zip
-- triggers refuse a ZIP not in the registry). Fails closed unless the registry outside the
-- 17 new ZIPs is exactly the 12,726 set after batch 1 (md5 4876fb88…).
-- ============================================================================

do $$
declare
  _new constant text[] := array['99571','99576','99613','99633','99661','99685','99689','99692',
    '99723','99734','99752','99762','99833','99840','99921','99926','99929'];
  _sha constant text := '13505e2e64c2170411b5e74b2d32f369ff9ad43affa4d0f975571586222960b3';
  _n int; _md5 text; _have int;
  _topics constant text[] := array['County Commission & county business',
    'Planning, zoning & development','Property taxes & assessments',
    'Public safety & emergencies','Water districts & utilities','Elections & voting'];
begin
  select count(*), md5(string_agg(zip, ',' order by zip collate "C"))
    into _n, _md5
    from public.canonical_zip_registry where zip <> all(_new);
  select count(*) into _have from public.canonical_zip_registry where zip = any(_new);
  if _n <> 12726 or _md5 <> '4876fb888cf0aee06927a5086551cb2a' then
    raise exception 'refusing: the registry outside the 17 new ZIPs is % rows md5 %, expected 12726 / 4876fb88…', _n, _md5;
  end if;

  if _have = 0 then
    insert into public.canonical_zip_registry (zip, gold_master_version, workbook_sha256)
    select z, '2.4', _sha from unnest(_new) z;
  elsif _have <> 17 then
    raise exception 'refusing: % of the 17 new ZIPs are already in the registry', _have;
  end if;

  insert into public.communities (name, county, state, zip_codes, level, government_topics, slug)
  select v.name, v.county, 'AK', v.zips, 'county', _topics, v.slug
    from (values
      ('Aleutians West Census Area', 'Aleutians West', array['99685','99692'], 'aleutians-west-census-area-ak'),
      ('Nome Census Area', 'Nome', array['99762'], 'nome-census-area-ak'),
      ('North Slope Borough', 'North Slope', array['99723','99734'], 'north-slope-borough-ak'),
      ('Northwest Arctic Borough', 'Northwest Arctic', array['99752'], 'northwest-arctic-borough-ak'),
      ('Dillingham Census Area', 'Dillingham', array['99576'], 'dillingham-census-area-ak'),
      ('Petersburg Borough', 'Petersburg', array['99833'], 'petersburg-borough-ak'),
      ('Skagway Municipality', 'Skagway', array['99840'], 'skagway-municipality-ak'),
      ('Wrangell City and Borough', 'Wrangell', array['99929'], 'wrangell-city-and-borough-ak'),
      ('Yakutat City and Borough', 'Yakutat', array['99689'], 'yakutat-city-and-borough-ak'),
      ('Bristol Bay Borough', 'Bristol Bay', array['99613','99633'], 'bristol-bay-borough-ak'),
      ('Prince of Wales-Hyder Census Area', 'Prince of Wales-Hyder', array['99921','99926'], 'prince-of-wales-hyder-census-area-ak'),
      ('Aleutians East Borough', 'Aleutians East', array['99571','99661'], 'aleutians-east-borough-ak'))
      v(name, county, zips, slug)
   where not exists (select 1 from public.communities c where c.slug = v.slug);

  insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug)
  select v.name, p.county, 'AK', array[v.zip], 'zip', p.id, '{}'::text[], v.slug
    from (values
      ('Unalaska (99685)', '99685', 'unalaska-99685', 'aleutians-west-census-area-ak'),
      ('Dutch Harbor (99692)', '99692', 'dutch-harbor-99692', 'aleutians-west-census-area-ak'),
      ('Nome (99762)', '99762', 'nome-99762', 'nome-census-area-ak'),
      ('Utqiagvik (99723)', '99723', 'utqiagvik-99723', 'north-slope-borough-ak'),
      ('Prudhoe Bay (99734)', '99734', 'prudhoe-bay-99734', 'north-slope-borough-ak'),
      ('Kotzebue (99752)', '99752', 'kotzebue-99752', 'northwest-arctic-borough-ak'),
      ('Dillingham (99576)', '99576', 'dillingham-99576', 'dillingham-census-area-ak'),
      ('Petersburg (99833)', '99833', 'petersburg-99833', 'petersburg-borough-ak'),
      ('Skagway (99840)', '99840', 'skagway-99840', 'skagway-municipality-ak'),
      ('Wrangell (99929)', '99929', 'wrangell-99929', 'wrangell-city-and-borough-ak'),
      ('Yakutat (99689)', '99689', 'yakutat-99689', 'yakutat-city-and-borough-ak'),
      ('Naknek (99633)', '99633', 'naknek-99633', 'bristol-bay-borough-ak'),
      ('King Salmon (99613)', '99613', 'king-salmon-99613', 'bristol-bay-borough-ak'),
      ('Craig (99921)', '99921', 'craig-99921', 'prince-of-wales-hyder-census-area-ak'),
      ('Metlakatla (99926)', '99926', 'metlakatla-99926', 'prince-of-wales-hyder-census-area-ak'),
      ('Cold Bay (99571)', '99571', 'cold-bay-99571', 'aleutians-east-borough-ak'),
      ('Sand Point (99661)', '99661', 'sand-point-99661', 'aleutians-east-borough-ak'))
      v(name, zip, slug, root)
    join public.communities p on p.slug = v.root and p.level = 'county'
   where not exists (select 1 from public.communities c where c.slug = v.slug);

  -- post-conditions, read back from the tables
  select count(*), md5(string_agg(zip, ',' order by zip collate "C"))
    into _n, _md5 from public.canonical_zip_registry where zip = any(_new);
  if _n <> 17 or _md5 <> md5(array_to_string(_new, ',')) then
    raise exception 'post-check: registry holds % of the new ZIPs (md5 %)', _n, _md5;
  end if;
  if (select count(*) from public.canonical_zip_registry) <> 12743 then
    raise exception 'post-check: registry is not 12,743 rows';
  end if;
  if (select count(*) from public.communities c join public.communities p on p.id = c.parent_id
       where c.level = 'zip' and c.state = 'AK' and c.zip_codes && _new
         and p.level = 'county' and c.zip_codes <@ p.zip_codes) <> 17 then
    raise exception 'post-check: expected 17 ZIP pages, each under the root that lists its ZIP';
  end if;
  if (select count(*) from public.communities c, unnest(c.zip_codes) z where z = any(_new)) <> 34 then
    raise exception 'post-check: each new ZIP must be claimed by exactly its page and its root';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- After applying: build each page's development report and materialize it.
-- Centres: the Census internal point of the place the page is named for, where it lies in the
-- ZIP's own ZCTA (TIGERweb Places 2020 layers 25/26). Exceptions: 99692 Dutch Harbor and 99723
-- Utqiagvik have no matching place point, so the ZCTA's own point-on-surface (both inside the
-- city); 99929's place is the whole borough, so the USPS point (zipcodes 3.0.0, inside 99929,
-- the town of Wrangell); 99734's Prudhoe Bay CDP point lies in ZCTA 99519, not 99734, so the
-- point of 99734 nearest to it.
--
-- 1) FIRE
--   select net.http_post('https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
--     jsonb_build_object('zip', zip, 'lat', lat, 'lng', lng), '{}'::jsonb,
--     '{"Content-Type":"application/json"}'::jsonb, 120000)
--   from (values ('99571',55.2153,-162.7760),('99576',59.0602,-158.5310),('99613',58.7229,-156.5389),
--     ('99633',58.7882,-156.8770),('99661',55.3145,-160.4856),('99685',53.9050,-166.5321),
--     ('99689',59.5221,-139.5892),('99692',53.8854,-166.5405),('99723',71.2856,-156.7369),
--     ('99734',70.2367,-148.6573),('99752',66.8868,-162.4917),('99762',64.5057,-165.4153),
--     ('99833',56.7552,-132.8764),('99840',59.4605,-135.2832),('99921',55.4887,-133.1116),
--     ('99926',55.1146,-131.5556),('99929',56.4335,-132.3529)) v(zip,lat,lng);
-- 2) COLLECT the 200s into development_reports (same upsert as the state seeds)
-- 3) select public.app_refresh_zip(z) from unnest(<the 17 ZIPs>) z;
-- ----------------------------------------------------------------------------

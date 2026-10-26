-- ============================================================================
-- ALASKA ZIP EXPANSION, 2026-10-26: the ZIP page universe goes from 12,722 to 12,726
-- (founder ruling 2026-10-26: "we are increasing our zip pages from 12,722").
--
-- Source of truth: homesignal-ingest Gold Master workbook, rows added by
-- scripts/add_gold_master_zips.py from data/local_news_gold_master/
-- added_zips_2026-10-26_alaska.json (workbook sha256 62473a20…, Gold Master 2.4).
-- The workbook changed FIRST; this file only makes production match it.
--
--   ZIP    page                       county-equivalent (root created here)
--   99827  Haines (99827)             Haines Borough
--   99743  Healy (99743)              Denali Borough
--   99704  Anderson / Clear (99704)   Denali Borough
--   99790  Livengood (99790)          Yukon-Koyukuk Census Area
--
-- County = the Census county polygon the ZCTA lies in (TIGERweb State_County layer 1,
-- pg_net 802-805, 2026-10-26): 99704 / 99743 100% Denali; 99790 100% Yukon-Koyukuk, 0%
-- Fairbanks North Star (USPS calls it "Fairbanks"; the zipcodes package agrees on the
-- county); 99827 55.0% Haines Borough, 45.0% Hoonah-Angoon (wilderness; the town of
-- Haines is in Haines Borough). Names from geo.zcta_place_overlap: 99704 lies 100% in the
-- City of Anderson; 99790 is 51.7% Livengood CDP.
--
-- APPLIED 2026-10-26 ~17:09Z as migration alaska_zip_expansion_20261026. Read back: registry
-- 12,726 rows, the other 12,722 still md5 af48c604…; 12,726 ZIP pages; app_community_meta and
-- development_reports 12,726 each. canonical_zip_guard_selftest() then expected 12,722 and failed
-- its "registry is populated" case, so it was moved to 12,726 by a fail-closed splice (migration
-- canonical_zip_guard_selftest_expects_12726; DDL of record docs/canonical-zip-registry-guard.sql);
-- all 5 cases pass. Reports: 99827 5 facilities + 3 development; 99743 2 development (EPA read
-- failed, count unknown); 99704 2 facilities; 99790 none yet (EPA read failed, count unknown).
--
-- Order: registry rows, then county roots, then ZIP pages (the enforce_canonical_zip
-- triggers refuse a ZIP not in the registry). Fails closed unless the live registry is
-- exactly the approved 12,722 set (md5 af48c604…) or already this 12,726 set (re-run = no-op).
-- ============================================================================

do $$
declare
  _new constant text[] := array['99704','99743','99790','99827'];
  _sha constant text := '62473a203dea7f428261b7736b683b578ce6a218d6e2540a4973b9cda0b78ebe';
  _n int; _md5 text; _have int;
  _haines uuid; _denali uuid; _yk uuid;
  _topics constant text[] := array['County Commission & county business',
    'Planning, zoning & development','Property taxes & assessments',
    'Public safety & emergencies','Water districts & utilities','Elections & voting'];
begin
  select count(*), md5(string_agg(zip, ',' order by zip collate "C"))
    into _n, _md5
    from public.canonical_zip_registry where zip <> all(_new);
  select count(*) into _have from public.canonical_zip_registry where zip = any(_new);
  if _n <> 12722 or _md5 <> 'af48c60436e525ae94dc87654b272c81' then
    raise exception 'refusing: the registry outside the 4 new ZIPs is % rows md5 %, expected 12722 / af48c604…', _n, _md5;
  end if;

  if _have = 0 then
    insert into public.canonical_zip_registry (zip, gold_master_version, workbook_sha256)
    select z, '2.4', _sha from unnest(_new) z;
  elsif _have <> 4 then
    raise exception 'refusing: % of the 4 new ZIPs are already in the registry', _have;
  end if;

  insert into public.communities (name, county, state, zip_codes, level, government_topics, slug)
  values ('Haines Borough', 'Haines', 'AK', array['99827'], 'county', _topics, 'haines-borough-ak'),
         ('Denali Borough', 'Denali', 'AK', array['99704','99743'], 'county', _topics, 'denali-borough-ak'),
         ('Yukon-Koyukuk Census Area', 'Yukon-Koyukuk', 'AK', array['99790'], 'county', _topics,
          'yukon-koyukuk-census-area-ak')
  on conflict do nothing;

  select id into strict _haines from public.communities where slug = 'haines-borough-ak';
  select id into strict _denali from public.communities where slug = 'denali-borough-ak';
  select id into strict _yk     from public.communities where slug = 'yukon-koyukuk-census-area-ak';

  insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug)
  select v.name, v.county, 'AK', array[v.zip], 'zip', v.parent, '{}'::text[], v.slug
    from (values ('Haines (99827)', 'Haines', '99827', _haines, 'haines-99827'),
                 ('Healy (99743)', 'Denali', '99743', _denali, 'healy-99743'),
                 ('Anderson / Clear (99704)', 'Denali', '99704', _denali, 'anderson-clear-99704'),
                 ('Livengood (99790)', 'Yukon-Koyukuk', '99790', _yk, 'livengood-99790'))
         v(name, county, zip, parent, slug)
   where not exists (select 1 from public.communities c where c.slug = v.slug);

  -- post-conditions, read back from the tables
  select count(*), md5(string_agg(zip, ',' order by zip collate "C"))
    into _n, _md5 from public.canonical_zip_registry where zip = any(_new);
  if _n <> 4 or _md5 <> md5('99704,99743,99790,99827') then
    raise exception 'post-check: registry holds % of the new ZIPs (md5 %)', _n, _md5;
  end if;
  if (select count(*) from public.canonical_zip_registry) <> 12726 then
    raise exception 'post-check: registry is not 12,726 rows';
  end if;
  if (select count(*) from public.communities c
       where c.level = 'zip' and c.zip_codes && _new and c.parent_id in (_haines, _denali, _yk)) <> 4 then
    raise exception 'post-check: expected 4 ZIP pages under the 3 new roots';
  end if;
  if exists (select 1 from public.communities c, unnest(c.zip_codes) z
              where z = any(_new) and c.id not in (_haines, _denali, _yk)
                and not (c.level = 'zip' and c.parent_id in (_haines, _denali, _yk))) then
    raise exception 'post-check: a new ZIP is claimed by a community outside the new roots';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- After applying: build each page's development report and materialize it
-- (the docs/*-development-reports-seed.sql pattern). Centres: the zipcodes 3.0.0
-- point where it lies inside the ZIP's own ZCTA (99827, 99743, 99704); for 99790 that
-- point is in 99701 (downtown Fairbanks), so the ZCTA's own point-on-surface is used.
--
-- 1) FIRE
--   select net.http_post('https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
--     jsonb_build_object('zip', zip, 'lat', lat, 'lng', lng), '{}'::jsonb,
--     '{"Content-Type":"application/json"}'::jsonb, 120000)
--   from (values ('99827',59.2519,-135.542),('99743',63.9171,-149.0111),
--                ('99704',64.2966,-149.1608),('99790',65.4280,-148.0882)) v(zip,lat,lng);
-- 2) COLLECT the 200s into development_reports (same upsert as the state seeds)
-- 3) select public.app_refresh_zip(z) from unnest(array['99704','99743','99790','99827']) z;
-- ----------------------------------------------------------------------------

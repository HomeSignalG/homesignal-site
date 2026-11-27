-- ============================================================================
-- ZIP EXPANSION, 2026-11-19 (founder, BOLO REALTORS partnership; deadline 2026-11-26):
-- 80026 Lafayette, 80027 Louisville / Superior, 80310 Boulder (CU). Universe 12,746 -> 12,750.
-- Source of truth: homesignal-ingest Gold Master row added by scripts/add_gold_master_zips.py from
-- data/local_news_gold_master/added_zips_2026-11-19_boulder_county_bolo.json (workbook first).
-- Measured 2026-11-19 (geo.zcta_place_overlap): 80026 Lafayette city 40% / Louisville 1%; 80027
-- Louisville city 40% / Superior town 20% / Lafayette ~0; 80310 = 100% Boulder city. USPS
-- (zipcodes 3.0.0): all Boulder County. Parent = existing Boulder County root (boulder-county-co).
-- 80021: USPS Jefferson County; 200 sampled points in the ZCTA vs TIGERweb counties = Jefferson 66.5%, Broomfield 33.5% (recon runs 44568287700, 44569416990).
-- Fails closed unless the registry outside these ZIPs is the 12,746 set (md5 ad61d07c...). Idempotent.
-- ============================================================================
do $$
declare
  _zips constant text[] := array['80026','80027','80310','80021'];
  _sha constant text := '6010b50953d2123330397e52d54163486e5705b882ed3dfdc4ad70ed0a990f12';
  _n int; _md5 text; _root uuid; _jroot uuid; _src text; _new text;
begin
  select count(*), md5(string_agg(zip, ',' order by zip collate "C")) into _n, _md5
    from public.canonical_zip_registry where zip <> all(_zips);
  if _n <> 12746 or _md5 <> 'ad61d07cabc455edd9468e1ed0401a74' then
    raise exception 'refusing: registry outside the new ZIPs is % rows md5 %', _n, _md5;
  end if;
  insert into public.canonical_zip_registry (zip, gold_master_version, workbook_sha256)
  select z, '2.4', _sha from unnest(_zips) z
   where not exists (select 1 from public.canonical_zip_registry r where r.zip = z);
  select id into strict _root from public.communities where slug='boulder-county-co' and level='county';
  update public.communities set zip_codes = zip_codes || (select array_agg(z) from unnest(array['80026','80027','80310']) z where not (zip_codes @> array[z]))
   where id=_root and exists (select 1 from unnest(array['80026','80027','80310']) z where not (zip_codes @> array[z]));
  select id into strict _jroot from public.communities where slug='jefferson-county-co' and level='county';
  update public.communities set zip_codes = zip_codes || array['80021'] where id=_jroot and not (zip_codes @> array['80021']);
  insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug)
  select 'Broomfield (80021)', 'Jefferson', 'CO', array['80021'], 'zip', _jroot, '{}'::text[], 'broomfield-80021'
   where not exists (select 1 from public.communities c where c.slug='broomfield-80021');
  insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug)
  select v.n, 'Boulder', 'CO', array[v.z], 'zip', _root, '{}'::text[], v.s
    from (values ('80026','Lafayette (80026)','lafayette-80026'),
                 ('80027','Louisville / Superior (80027)','louisville-80027'),
                 ('80310','Boulder (80310)','boulder-80310')) v(z,n,s)
   where not exists (select 1 from public.communities c where c.slug = v.s);
  select prosrc into _src from pg_proc where oid='public.canonical_zip_guard_selftest()'::regprocedure;
  if position('12746' in _src) > 0 then
    if (length(_src)-length(replace(_src,'12746','')))/5 <> 2
       or position($q$expected := '12746';$q$ in _src)=0
       or position($q$canonical_zip_registry) = 12746);$q$ in _src)=0 then
      raise exception 'refusing: guard self-test anchors not as expected';
    end if;
    _new := replace(_src,'12746','12750');
    execute format('create or replace function public.canonical_zip_guard_selftest() returns table '
      || '(case_name text, expected text, blocked boolean, passed boolean, detail text) '
      || 'language plpgsql security definer set search_path = public, pg_temp as %L', _new);
  end if;
  if (select count(*) from public.canonical_zip_registry) <> 12750 then raise exception 'post-check: not 12,750'; end if;
  if (select count(*) from public.communities c, unnest(c.zip_codes) z where z = any(_zips)) <> 8 then
    raise exception 'post-check: each new ZIP must be claimed by its page and the root'; end if;
  if exists (select 1 from public.canonical_zip_guard_selftest() where not passed) then
    raise exception 'post-check: guard self-test failing'; end if;
end $$;

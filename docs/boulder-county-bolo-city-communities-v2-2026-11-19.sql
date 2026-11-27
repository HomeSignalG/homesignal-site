-- BOLO REALTORS: four Boulder County city communities (v2, hardened). NOT APPLIED.
-- Supersedes the unapplied docs/boulder-county-bolo-city-communities-2026-11-19.sql carried on site #3051. Separate from that PR's ZIP SQL.
--
-- WHAT IT DOES: inserts at most four level='city' communities under boulder-county-co, owning no ZIP (zip_codes '{}'),
-- no topics (government_topics '{}'), with census_place_geoid so public.zip_government_bodies / zip_government_places can match the Census place to them
-- (the Pierce WA pattern, docs/pierce-city-communities-seed.sql). It does NOT create or change any feed, enrollment, ZIP, registry or routing.
--
-- EXPECTED VALUES (supplied; each is re-checked inside the transaction, never trusted):
--   louisville-co 0846355 'Louisville city' · superior-co 0875640 'Superior town' · lafayette-co 0841835 'Lafayette city' · boulder-co 0807850 'Boulder city'
--   parent boulder-county-co 0df863af-f218-4177-a885-fbffa17a5ec3 (county, CO, Boulder).
--
-- RUNNER AND TRANSACTION SEMANTICS: intended runner is .github/workflows/db-sql.yml (dispatch from main only), which POSTs the WHOLE FILE as ONE query string
-- to the Supabase Management API /database/query. A multi-statement string runs as one implicit transaction on the server, so any RAISE EXCEPTION below
-- aborts and undoes everything in the file. This file therefore has NO explicit BEGIN/COMMIT (an explicit COMMIT would make a later failure partial) and
-- uses SET LOCAL, which lasts to the end of that implicit transaction. UNVERIFIED: that the Management API never splits a string into separate
-- transactions. Confirm on a disposable Postgres through the same endpoint shape, or with a founder-approved rehearsal, before the real run.
--
-- RERUN: an exact match of all four rows is reported 'already_exact' and inserts nothing. Any existing row that shares a slug (case-insensitive) or a
-- Census place id with an expected row but differs in ANY attribute aborts the whole file; it is never treated as success.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temp table _bolo_result (slug text, id uuid, action text) on commit drop;

do $do$
declare
  c_parent_id constant uuid := '0df863af-f218-4177-a885-fbffa17a5ec3';
  -- md5(pg_get_functiondef) read from production 2026-11-19; if either trigger function changed, stop and re-review
  c_fn_canonical constant text := '8e87a4ddbac38af1f4b842a65aeab0ca';   -- public.enforce_canonical_zip()
  c_fn_absorb    constant text := 'e384102c80676bbc5f882835386f0dc2';   -- public.alert_catalog_absorb_offered_topics()
  v_expected jsonb := '[
    {"slug":"louisville-co","name":"Louisville","geoid":"0846355","census_name":"Louisville city"},
    {"slug":"superior-co","name":"Superior","geoid":"0875640","census_name":"Superior town"},
    {"slug":"lafayette-co","name":"Lafayette","geoid":"0841835","census_name":"Lafayette city"},
    {"slug":"boulder-co","name":"Boulder","geoid":"0807850","census_name":"Boulder city"}]';
  e jsonb; r public.communities; v_n int; v_catalog_before bigint; v_catalog_after bigint; v_total_before bigint; v_total_after bigint; v_new int := 0;
begin
  -- 1. the parent is exactly the intended county
  if not exists (select 1 from public.communities p where p.id = c_parent_id and p.slug = 'boulder-county-co' and p.level = 'county' and p.state = 'CO' and p.county = 'Boulder') then
    raise exception 'BOLO city communities refused: parent % is not boulder-county-co (county, CO, Boulder)', c_parent_id;
  end if;
  -- 2. the triggers this insert fires are the ones reviewed (both are fail-closed on a changed body)
  if md5(pg_get_functiondef('public.enforce_canonical_zip()'::regprocedure)) <> c_fn_canonical then raise exception 'enforce_canonical_zip() changed since review'; end if;
  if md5(pg_get_functiondef('public.alert_catalog_absorb_offered_topics()'::regprocedure)) <> c_fn_absorb then raise exception 'alert_catalog_absorb_offered_topics() changed since review'; end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.communities'::regclass and not tgisinternal
        and tgname in ('communities_absorb_offered_topics_ins','communities_absorb_offered_topics_upd','trg_communities_canonical_zip')) <> 3 then
    raise exception 'expected exactly the three reviewed triggers on public.communities';
  end if;
  -- the canonical-ZIP guard fails closed on an EMPTY registry; an empty zip_codes array is judged only after that check
  if not exists (select 1 from public.canonical_zip_registry) then raise exception 'canonical_zip_registry is empty'; end if;

  select count(*) into v_catalog_before from public.alert_topic_catalog;
  select count(*) into v_total_before from public.communities;

  for e in select * from jsonb_array_elements(v_expected) loop
    -- 3. the Census place exists as an ACTIVE place with exactly the expected name
    select count(distinct place_geoid) into v_n from geo.zcta_place_overlap
     where place_geoid = e->>'geoid' and place_name = e->>'census_name' and place_funcstat = 'A';
    if v_n <> 1 then raise exception 'Census place % (%) not found exactly once as an active place', e->>'geoid', e->>'census_name'; end if;
    -- 4. collisions: any row on this slug (case-insensitive) or this Census place id
    for r in select * from public.communities c where lower(c.slug) = lower(e->>'slug') or c.census_place_geoid = e->>'geoid' loop
      if r.slug = e->>'slug' and r.census_place_geoid = e->>'geoid' and r.name = e->>'name' and r.level = 'city' and r.county = 'Boulder' and r.state = 'CO'
         and r.parent_id = c_parent_id and r.zip_codes = array[]::text[] and r.government_topics = array[]::text[] then
        insert into _bolo_result values (r.slug, r.id, 'already_exact');
      else
        raise exception 'BOLO city communities refused: existing row % (slug %, geoid %, level %, parent %) collides with expected % and does not match it',
          r.id, r.slug, r.census_place_geoid, r.level, r.parent_id, e->>'slug';
      end if;
    end loop;
  end loop;

  -- 5. insert only what is missing, and record the ids actually created
  with ins as (
    insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
    select x->>'name', 'Boulder', 'CO', array[]::text[], 'city', c_parent_id, array[]::text[], x->>'slug', x->>'geoid'
      from jsonb_array_elements(v_expected) x
     where not exists (select 1 from _bolo_result b where b.slug = x->>'slug')
    returning id, slug)
  insert into _bolo_result select slug, id, 'inserted' from ins;
  select count(*) into v_new from _bolo_result where action = 'inserted';

  -- 6. post-conditions: exactly the four expected rows, exactly as specified; nothing else moved
  select count(*) into v_n from _bolo_result; if v_n <> 4 then raise exception 'expected 4 result rows, got %', v_n; end if;
  for e in select * from jsonb_array_elements(v_expected) loop
    perform 1 from public.communities c join _bolo_result b on b.id = c.id and b.slug = c.slug where c.slug = e->>'slug'
      and c.census_place_geoid = e->>'geoid' and c.name = e->>'name' and c.level = 'city' and c.county = 'Boulder' and c.state = 'CO'
      and c.parent_id = c_parent_id and c.zip_codes = array[]::text[] and c.government_topics = array[]::text[];
    if not found then raise exception 'post-condition failed for %', e->>'slug'; end if;
  end loop;
  select count(*) into v_total_after from public.communities;
  if v_total_after <> v_total_before + v_new then raise exception 'communities count moved by % but % rows were inserted', v_total_after - v_total_before, v_new; end if;
  select count(*) into v_catalog_after from public.alert_topic_catalog;
  if v_catalog_after <> v_catalog_before then raise exception 'alert_topic_catalog moved (% -> %): empty government_topics should add nothing', v_catalog_before, v_catalog_after; end if;
end
$do$;

-- the receipt (job log): the ids actually inserted, or already_exact on a rerun
select slug, id, action from _bolo_result order by slug;

-- box-elder-communities-seed.sql
-- The Box Elder County community tree — the PER-ZIP backbone with city/county
-- government layered on via parent_id (see docs/community-build-source-of-truth.md §13).
-- Versioned source for the rows created in Supabase this session; requires the `slug`
-- column (docs/communities-slug-migration.sql) and the level enum (county|city|zip|
-- neighborhood). Idempotent: re-running skips existing rows.
--
-- MODEL (citizens think in ZIP codes):
--   The ZIP is the resident-facing PAGE. The city and county are government LAYERS the
--   ZIP inherits by cascading UP parent_id. A ZIP page shows its own place name +
--   whatever government cascades down from its parents (city council, county, state).
--
--   county  Box Elder County ............ county government (commission, planning, tax, …)
--     ├─ city  Brigham City / Tremonton ... GOVERNMENT LAYERS (their own city council);
--     │         │                           NOT resident pages — the ZIP page below is.
--     │         └─ zip  Brigham City (84302) / Tremonton (84337) ... resident pages that
--     │                 inherit the city council AND the county via cascade.
--     └─ zip   Bear River City … Willard ... resident pages that inherit the county.
--
-- Every user-facing Box Elder ZIP therefore resolves through a level=zip community — an
-- identical backbone across all 18 ZIP pages (§4). The two incorporated-city ZIPs simply
-- have one extra government layer (their council) to cascade through.
--
-- Town councils for the small ZIP towns are layered on LATER, once each town's meeting
-- source is wired on the ingest side (many small Utah towns may not publish meetings).

-- ── 1) County — the root government layer ──────────────────────────────────────────
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics) values
('Box Elder County','Box Elder','UT','county','box-elder',
 array['84301','84302','84306','84307','84309','84311','84312','84313','84314',
       '84316','84324','84329','84330','84331','84334','84336','84337','84340'],
 array['County Commission & county business','Planning, zoning & development',
       'Property taxes & assessments','Public safety & emergencies','Water districts & utilities',
       'Elections & voting','Stratos data center project'])
on conflict do nothing;
-- NOTE: neither 84315 (Hooper, Weber County) nor 84308 (Cornish, Cache County) is in
-- Box Elder — both removed from the county row and this list. County = the 18 ZIPs above.

-- ── 2) Incorporated cities — own council; parent → county ───────────────────────────
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id) values
('Brigham City','Box Elder','UT','city','brigham-city',array['84302'],
 array['City government (Brigham City)'],(select id from public.communities where slug='box-elder')),
('Tremonton','Box Elder','UT','city','tremonton',array['84337'],
 array['City government (Tremonton)'],(select id from public.communities where slug='box-elder'))
on conflict do nothing;

-- ── 3) ZIP pages — one per ZIP; parent → county; government inherited via cascade ───
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Box Elder', 'UT', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='box-elder')
from (values
  ('Bear River City','bear-river-city','84301'),
  ('Collinston','collinston','84306'),
  ('Corinne','corinne','84307'),
  ('Deweyville','deweyville','84309'),
  ('Fielding','fielding','84311'),
  ('Garland','garland','84312'),
  ('Grouse Creek','grouse-creek','84313'),
  ('Honeyville','honeyville','84314'),
  ('Howell','howell','84316'),
  ('Mantua','mantua','84324'),
  ('Park Valley','park-valley','84329'),
  ('Plymouth','plymouth','84330'),
  ('Portage','portage','84331'),
  ('Riverside','riverside','84334'),
  ('Snowville','snowville','84336'),
  ('Willard','willard','84340')
) as v(name, slug, zip)
on conflict do nothing;

-- ── 4) Incorporated-city ZIP pages — the resident page for 84302 / 84337; parent → its
--        CITY row (§2). Named "<place> (<ZIP>)" like every other state's ZIP pages, with
--        government_topics=[] (the council label lives on the city government LAYER and
--        cascades down). This makes EVERY user-facing Box Elder ZIP resolve through a
--        level=zip community; resolution ranks zip > city > county, so these outrank the
--        Brigham City / Tremonton city rows, which remain purely as cascaded gov layers.
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Box Elder', 'UT', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug = v.parent_slug)
from (values
  ('Brigham City (84302)','brigham-city-84302','84302','brigham-city'),
  ('Tremonton (84337)','tremonton-84337','84337','tremonton')
) as v(name, slug, zip, parent_slug)
on conflict do nothing;

-- Verify:
--   select name, level, slug, zip_codes[1] as zip,
--          (select p.name from public.communities p where p.id = c.parent_id) as parent
--   from public.communities c where c.county='Box Elder'
--   order by array_position(array['county','city','zip'], c.level), name;

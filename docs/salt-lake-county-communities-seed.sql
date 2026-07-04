-- salt-lake-county-communities-seed.sql
-- The Salt Lake County community tree — the PER-ZIP backbone with the county
-- government layered on via parent_id (see docs/community-build-source-of-truth.md §13).
-- Versioned source for the rows created in Supabase this session; requires the `slug`
-- column (docs/communities-slug-migration.sql) and the level enum (county|city|zip|
-- neighborhood). Idempotent: re-running skips existing rows.
--
-- MODEL (citizens think in ZIP codes):
--   The ZIP is the resident-facing PAGE. The county is the government LAYER each ZIP
--   inherits by cascading UP parent_id. A ZIP page shows its own place name + whatever
--   government cascades down from its parents (county today; city + state later).
--
--   county  Salt Lake County ............ county government (commission, planning, tax, …)
--     └─ zip   84006 … 84129 ............. inherit the county's government (gov_topics = [])
--
-- City councils (Salt Lake City, Sandy, West Jordan, West Valley City, Murray,
-- Taylorsville, Holladay, Draper, Herriman, Riverton, South Jordan, Midvale, Magna,
-- Kearns, Cottonwood Heights, South Salt Lake, Bluffdale, Millcreek, Alta) are layered
-- on LATER, each as its own level=city row with a 'City government (X)' topic, ONCE that
-- city's meeting source is verified + wired on the ingest side (§13.2/§13.3 — never mint a
-- subscribable council topic before its feed exists). For now every ZIP inherits the
-- county's 6 government topics via cascade, which is real, subscribable value today.
--
-- The 6 county government_topics are the canonical civic labels (word-for-word matches to
-- the ingest CANONICAL_TOPICS + the live Utah County row) — no place-specific data-center
-- topic (that is Box Elder / Eagle Mountain only).

-- ── 1) County — the root government layer ──────────────────────────────────────────
-- 84065 (Herriman/Riverton/Bluffdale, part) is DELIBERATELY omitted from this county-level
-- coverage array: it is already claimed by the live Utah County row, and two county rows
-- claiming one ZIP is the one real same-level collision (§12.4). Its ZIP page below still
-- exists and resolves most-specific (zip > county), so residents there route correctly.
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics) values
('Salt Lake County','Salt Lake','UT','county','salt-lake-county',
 array['84006','84020','84044','84047','84070','84084','84088','84092','84093','84094',
       '84095','84096','84101','84102','84103','84104','84105','84106','84107','84108',
       '84109','84111','84112','84113','84115','84116','84117','84118','84119','84120',
       '84121','84123','84124','84128','84129'],
 array['County Commission & county business','Planning, zoning & development',
       'Property taxes & assessments','Public safety & emergencies','Water companies',
       'Elections & voting'])
on conflict do nothing;

-- ── 2) ZIP pages — one per ZIP; parent → county; government inherited via cascade ───
-- Names carry the ZIP so each page reads as a distinct place (§13.7 duplicate-content note).
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Salt Lake', 'UT', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='salt-lake-county')
from (values
  ('Bingham Canyon / Copperton (84006)','bingham-canyon-copperton-84006','84006'),
  ('Draper (84020)','draper-84020','84020'),
  ('Magna (84044)','magna-84044','84044'),
  ('Midvale (84047)','midvale-84047','84047'),
  ('Herriman / Riverton / Bluffdale (84065)','herriman-riverton-bluffdale-84065','84065'),
  ('Sandy (84070)','sandy-84070','84070'),
  ('West Jordan (84084)','west-jordan-84084','84084'),
  ('West Jordan (84088)','west-jordan-84088','84088'),
  ('Sandy / Alta (84092)','sandy-alta-84092','84092'),
  ('Sandy (84093)','sandy-84093','84093'),
  ('Sandy (84094)','sandy-84094','84094'),
  ('South Jordan / Riverton (84095)','south-jordan-riverton-84095','84095'),
  ('Herriman (84096)','herriman-84096','84096'),
  ('Salt Lake City (84101)','salt-lake-city-84101','84101'),
  ('Salt Lake City (84102)','salt-lake-city-84102','84102'),
  ('Salt Lake City (84103)','salt-lake-city-84103','84103'),
  ('Salt Lake City (84104)','salt-lake-city-84104','84104'),
  ('Salt Lake City (84105)','salt-lake-city-84105','84105'),
  ('Salt Lake City / Millcreek (84106)','salt-lake-city-millcreek-84106','84106'),
  ('Murray (84107)','murray-84107','84107'),
  ('Salt Lake City (84108)','salt-lake-city-84108','84108'),
  ('Salt Lake City (84109)','salt-lake-city-84109','84109'),
  ('Salt Lake City (84111)','salt-lake-city-84111','84111'),
  ('University of Utah (84112)','university-of-utah-84112','84112'),
  ('Salt Lake City (84113)','salt-lake-city-84113','84113'),
  ('Salt Lake City / South Salt Lake (84115)','salt-lake-city-south-salt-lake-84115','84115'),
  ('Salt Lake City (84116)','salt-lake-city-84116','84116'),
  ('Holladay (84117)','holladay-84117','84117'),
  ('Kearns / Taylorsville (84118)','kearns-taylorsville-84118','84118'),
  ('West Valley City / Taylorsville (84119)','west-valley-city-taylorsville-84119','84119'),
  ('West Valley City (84120)','west-valley-city-84120','84120'),
  ('Cottonwood Heights / Holladay (84121)','cottonwood-heights-holladay-84121','84121'),
  ('Murray / Taylorsville (84123)','murray-taylorsville-84123','84123'),
  ('Holladay (84124)','holladay-84124','84124'),
  ('West Valley City (84128)','west-valley-city-84128','84128'),
  ('Taylorsville (84129)','taylorsville-84129','84129')
) as v(name, slug, zip)
on conflict do nothing;

-- Verify:
--   select name, level, slug, zip_codes[1] as zip,
--          (select p.name from public.communities p where p.id = c.parent_id) as parent
--   from public.communities c where c.county='Salt Lake'
--   order by array_position(array['county','city','zip'], c.level), zip_codes[1];

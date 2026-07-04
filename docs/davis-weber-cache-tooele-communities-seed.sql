-- davis-weber-cache-tooele-communities-seed.sql
-- Four northern-Utah counties built on the PER-ZIP backbone, county government layered
-- on via parent_id (see docs/community-build-source-of-truth.md §13, §13.9). Versioned
-- source for the rows created in Supabase this session; requires the `slug` column
-- (docs/communities-slug-migration.sql) and the level enum (county|city|zip|neighborhood).
-- Idempotent: re-running skips existing rows (`on conflict do nothing` on the unique slug).
--
-- MODEL (citizens think in ZIP codes) — identical to Salt Lake County (the metro reference):
--   The ZIP is the resident-facing PAGE. The county is the government LAYER each ZIP
--   inherits by cascading UP parent_id. A ZIP page shows its own place name + whatever
--   government cascades down from its parents (county today; city + state later).
--
--   county  Davis / Weber / Cache / Tooele ... county government (commission, planning, tax, …)
--     └─ zip   <one page per ZIP> ............. inherit the county's government (gov_topics = [])
--
-- The 6 county government_topics are the canonical civic labels (word-for-word matches to
-- the ingest CANONICAL_TOPICS + the live Utah County / Salt Lake County rows) — no
-- place-specific topic. City councils (Ogden, Logan, Layton, Tooele, Bountiful, …) are
-- layered on LATER, each as its own level=city row with a 'City government (X)' topic, ONCE
-- that city's meeting source is verified + wired on the ingest side (§13.2/§13.3 — never mint
-- a subscribable council topic before its feed exists). For now every ZIP inherits its
-- county's 6 government topics via cascade, which is real, subscribable value on day one.
--
-- Source dataset: the County,ZIP,Primary-City list pinned for this build (§12.0). No ZIP is
-- inferred from memory. A collision probe (every ZIP vs the live communities.zip_codes arrays)
-- returned ZERO existing claims, so no cross-county border ZIP had to be held off a county
-- array (§9 / §12.4).

-- ── 1) County roots — the government layer each ZIP inherits ─────────────────────────
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics) values
('Davis County','Davis','UT','county','davis-county',
 array['84010','84011','84014','84015','84016','84025','84037','84040','84041','84054',
       '84056','84075','84087','84089'],
 array['County Commission & county business','Planning, zoning & development',
       'Property taxes & assessments','Public safety & emergencies','Water companies',
       'Elections & voting']),
('Weber County','Weber','UT','county','weber-county',
 array['84067','84310','84315','84317','84401','84402','84403','84404','84405','84408',
       '84409','84412','84414','84415'],
 array['County Commission & county business','Planning, zoning & development',
       'Property taxes & assessments','Public safety & emergencies','Water companies',
       'Elections & voting']),
('Cache County','Cache','UT','county','cache-county',
 array['84304','84305','84308','84318','84319','84320','84321','84322','84323','84325',
       '84326','84327','84328','84332','84333','84335','84338','84339','84341'],
 array['County Commission & county business','Planning, zoning & development',
       'Property taxes & assessments','Public safety & emergencies','Water companies',
       'Elections & voting']),
('Tooele County','Tooele','UT','county','tooele-county',
 array['84022','84029','84034','84069','84071','84074','84080','84083'],
 array['County Commission & county business','Planning, zoning & development',
       'Property taxes & assessments','Public safety & emergencies','Water companies',
       'Elections & voting'])
on conflict do nothing;

-- ── 2) ZIP pages — one per ZIP; parent → its county; government inherited via cascade ─
-- Names carry the ZIP so each page reads as a distinct place (§13.7 duplicate-content note);
-- a city with several ZIPs (Ogden 84401…84415, Logan 84321/84322/84323/84341) yields distinct
-- pages/slugs instead of colliding on one bare city slug (§9).
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, v.county, 'UT', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug = v.parent_slug)
from (values
  -- Davis County
  ('Bountiful (84010)','bountiful-84010','84010','Davis','davis-county'),
  ('Bountiful (84011)','bountiful-84011','84011','Davis','davis-county'),
  ('Centerville (84014)','centerville-84014','84014','Davis','davis-county'),
  ('Clearfield (84015)','clearfield-84015','84015','Davis','davis-county'),
  ('Clearfield (84016)','clearfield-84016','84016','Davis','davis-county'),
  ('Farmington (84025)','farmington-84025','84025','Davis','davis-county'),
  ('Kaysville (84037)','kaysville-84037','84037','Davis','davis-county'),
  ('Layton (84040)','layton-84040','84040','Davis','davis-county'),
  ('Layton (84041)','layton-84041','84041','Davis','davis-county'),
  ('North Salt Lake (84054)','north-salt-lake-84054','84054','Davis','davis-county'),
  ('Hill Air Force Base (84056)','hill-air-force-base-84056','84056','Davis','davis-county'),
  ('Syracuse (84075)','syracuse-84075','84075','Davis','davis-county'),
  ('Woods Cross (84087)','woods-cross-84087','84087','Davis','davis-county'),
  ('Clearfield (84089)','clearfield-84089','84089','Davis','davis-county'),
  -- Weber County
  ('Roy (84067)','roy-84067','84067','Weber','weber-county'),
  ('Eden (84310)','eden-84310','84310','Weber','weber-county'),
  ('Hooper (84315)','hooper-84315','84315','Weber','weber-county'),
  ('Huntsville (84317)','huntsville-84317','84317','Weber','weber-county'),
  ('Ogden (84401)','ogden-84401','84401','Weber','weber-county'),
  ('Ogden (84402)','ogden-84402','84402','Weber','weber-county'),
  ('Ogden (84403)','ogden-84403','84403','Weber','weber-county'),
  ('Ogden (84404)','ogden-84404','84404','Weber','weber-county'),
  ('Ogden (84405)','ogden-84405','84405','Weber','weber-county'),
  ('Ogden (84408)','ogden-84408','84408','Weber','weber-county'),
  ('Ogden (84409)','ogden-84409','84409','Weber','weber-county'),
  ('Ogden (84412)','ogden-84412','84412','Weber','weber-county'),
  ('Ogden (84414)','ogden-84414','84414','Weber','weber-county'),
  ('Ogden (84415)','ogden-84415','84415','Weber','weber-county'),
  -- Cache County
  ('Cache Junction (84304)','cache-junction-84304','84304','Cache','cache-county'),
  ('Clarkston (84305)','clarkston-84305','84305','Cache','cache-county'),
  ('Cornish (84308)','cornish-84308','84308','Cache','cache-county'),
  ('Hyde Park (84318)','hyde-park-84318','84318','Cache','cache-county'),
  ('Hyrum (84319)','hyrum-84319','84319','Cache','cache-county'),
  ('Lewiston (84320)','lewiston-84320','84320','Cache','cache-county'),
  ('Logan (84321)','logan-84321','84321','Cache','cache-county'),
  ('Logan (84322)','logan-84322','84322','Cache','cache-county'),
  ('Logan (84323)','logan-84323','84323','Cache','cache-county'),
  ('Mendon (84325)','mendon-84325','84325','Cache','cache-county'),
  ('Millville (84326)','millville-84326','84326','Cache','cache-county'),
  ('Newton (84327)','newton-84327','84327','Cache','cache-county'),
  ('Paradise (84328)','paradise-84328','84328','Cache','cache-county'),
  ('Richmond (84332)','richmond-84332','84332','Cache','cache-county'),
  ('River Heights (84333)','river-heights-84333','84333','Cache','cache-county'),
  ('Smithfield (84335)','smithfield-84335','84335','Cache','cache-county'),
  ('Trenton (84338)','trenton-84338','84338','Cache','cache-county'),
  ('Wellsville (84339)','wellsville-84339','84339','Cache','cache-county'),
  ('Logan (84341)','logan-84341','84341','Cache','cache-county'),
  -- Tooele County
  ('Dugway (84022)','dugway-84022','84022','Tooele','tooele-county'),
  ('Grantsville (84029)','grantsville-84029','84029','Tooele','tooele-county'),
  ('Ibapah (84034)','ibapah-84034','84034','Tooele','tooele-county'),
  ('Rush Valley (84069)','rush-valley-84069','84069','Tooele','tooele-county'),
  ('Stockton (84071)','stockton-84071','84071','Tooele','tooele-county'),
  ('Tooele (84074)','tooele-84074','84074','Tooele','tooele-county'),
  ('Vernon (84080)','vernon-84080','84080','Tooele','tooele-county'),
  ('Wendover (84083)','wendover-84083','84083','Tooele','tooele-county')
) as v(name, slug, zip, county, parent_slug)
on conflict do nothing;

-- Verify:
--   select c.county, c.level, c.slug, c.zip_codes[1] as zip,
--          (select p.name from public.communities p where p.id = c.parent_id) as parent
--   from public.communities c where c.county in ('Davis','Weber','Cache','Tooele')
--   order by c.county, array_position(array['county','city','zip'], c.level), c.zip_codes[1];

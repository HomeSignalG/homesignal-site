-- minnesota-communities-seed.sql
-- The Minnesota (Twin Cities metro — Hennepin/Ramsey/Dakota/Washington/Anoka/Carver/Scott/
-- Wright/Sherburne + St. Cloud (Stearns/Benton) + Rochester (Olmsted) + collar counties)
-- per-ZIP backbone: 18 county roots + one level=zip page per requested ZIP, parent_id ->
-- county, government inherited via cascade (docs/community-build-source-of-truth.md §13).
-- Idempotent (on conflict do nothing on the case-insensitive-unique slug); requires the slug
-- column (docs/communities-slug-migration.sql) and the level enum (county|city|zip|neighborhood).
--
-- MODEL (citizens think in ZIP codes): the ZIP is the resident-facing PAGE; the county is the
-- government LAYER each ZIP inherits by cascading UP parent_id. Each county root = the 6
-- canonical civic topics (word-for-word matches to the ingest CANONICAL_TOPICS + the live
-- Utah/Colorado/Michigan/Washington/Texas county rows). Every ZIP page starts
-- government_topics=[] and inherits its county's topics via cascade.
--
-- DATA PROVENANCE (§12.0 — never guess a ZIP↔county mapping): the ZIP -> city + county
-- crosswalk was generated from the `zipcodes` PyPI package v3.0.0 (bundled, offline US postal
-- database). Each ZIP page is named "<primary USPS city> (<ZIP>)". Values are used verbatim
-- from the package (e.g. USPS "Saint Paul" for the 551xx block) — not editorialized.
--
-- No collisions: all 172 requested ZIPs mapped to exactly one MN county in the crosswalk,
-- 0 quarantined, and NONE was already claimed by a live community row (MN had zero rows
-- pre-seed; verified pre-seed — prior states are UT/CO/MI/WA/TX ZIP ranges). County slugs
-- carry a `-mn` suffix (`hennepin-county-mn`, `benton-county-mn`, …) so common county names
-- (Benton also exists in WA) don't collide across states. Note St. Cloud's 56304 maps to
-- Sherburne County and 56367 (Rice) to Benton County per the package's single authoritative
-- assignment (St. Cloud physically spans Stearns/Benton/Sherburne).
--
-- City councils (Minneapolis, Saint Paul, Bloomington, Rochester, Eden Prairie, Plymouth,
-- Maple Grove, St. Cloud, Woodbury, Lakeville, Eagan, Shakopee, …) are layered on LATER, each
-- as its own level=city row with a "City government (X)" topic, ONCE that city's meeting source
-- is verified + wired on the ingest side (§13.2/§13.3 — never mint a subscribable council topic
-- before its feed exists). For now every ZIP inherits its county's 6 topics via cascade.

-- ── 1) County roots ── the government layer each ZIP inherits ────────────────────────
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics) values
('Hennepin County','Hennepin','MN','county','hennepin-county-mn',
 array['55305','55316','55331','55340','55343','55344','55345','55346','55347','55356',
       '55357','55364','55369','55374','55375','55384','55401','55402','55403','55404',
       '55405','55406','55407','55408','55409','55410','55411','55412','55413','55414',
       '55415','55416','55417','55418','55419','55420','55422','55423','55424','55425',
       '55426','55427','55428','55429','55430','55431','55435','55436','55437','55438',
       '55439','55441','55442','55443','55444','55445','55446','55447'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Ramsey County','Ramsey','MN','county','ramsey-county-mn',
 array['55101','55102','55103','55104','55105','55106','55107','55108','55109','55110',
       '55112','55113','55116','55117','55119','55126','55127'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Washington County','Washington','MN','county','washington-county-mn',
 array['55001','55003','55016','55025','55038','55042','55043','55047','55055','55071',
       '55073','55082','55083','55115','55125','55128','55129'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Dakota County','Dakota','MN','county','dakota-county-mn',
 array['55024','55031','55033','55044','55065','55068','55075','55076','55077','55085',
       '55118','55120','55121','55122','55123','55124'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Stearns County','Stearns','MN','county','stearns-county-mn',
 array['55353','55382','56301','56303','56307','56310','56320','56321','56340','56352',
       '56362','56368','56374','56377'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Carver County','Carver','MN','county','carver-county-mn',
 array['55315','55317','55318','55360','55367','55368','55386','55387','55388','55397'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Olmsted County','Olmsted','MN','county','olmsted-county-mn',
 array['55901','55902','55904','55906','55920','55929','55934','55960','55976'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Wright County','Wright','MN','county','wright-county-mn',
 array['55301','55313','55320','55328','55341','55362','55363','55373','55376'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Anoka County','Anoka','MN','county','anoka-county-mn',
 array['55005','55011','55014','55070','55303','55304'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Scott County','Scott','MN','county','scott-county-mn',
 array['55020','55054','55352','55372','55378','55379'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Sherburne County','Sherburne','MN','county','sherburne-county-mn',
 array['55330','55377','56304'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Benton County','Benton','MN','county','benton-county-mn',
 array['56367'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Chisago County','Chisago','MN','county','chisago-county-mn',
 array['55013'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Dodge County','Dodge','MN','county','dodge-county-mn',
 array['55944'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Isanti County','Isanti','MN','county','isanti-county-mn',
 array['55040'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Rice County','Rice','MN','county','rice-county-mn',
 array['55057'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Todd County','Todd','MN','county','todd-county-mn',
 array['56336'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Wabasha County','Wabasha','MN','county','wabasha-county-mn',
 array['55956'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting'])
on conflict do nothing;

-- ── 2) ZIP pages ── one per ZIP; parent -> county; government inherited via cascade ──
-- Names carry the ZIP so each page reads as a distinct place (§13.7 duplicate-content note).

-- Hennepin County (58 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Hennepin', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='hennepin-county-mn')
from (values
  ('Hopkins (55305)','hopkins-55305','55305'),
  ('Champlin (55316)','champlin-55316','55316'),
  ('Excelsior (55331)','excelsior-55331','55331'),
  ('Hamel (55340)','hamel-55340','55340'),
  ('Hopkins (55343)','hopkins-55343','55343'),
  ('Eden Prairie (55344)','eden-prairie-55344','55344'),
  ('Minnetonka (55345)','minnetonka-55345','55345'),
  ('Eden Prairie (55346)','eden-prairie-55346','55346'),
  ('Eden Prairie (55347)','eden-prairie-55347','55347'),
  ('Long Lake (55356)','long-lake-55356','55356'),
  ('Loretto (55357)','loretto-55357','55357'),
  ('Mound (55364)','mound-55364','55364'),
  ('Osseo (55369)','osseo-55369','55369'),
  ('Rogers (55374)','rogers-55374','55374'),
  ('Saint Bonifacius (55375)','saint-bonifacius-55375','55375'),
  ('Spring Park (55384)','spring-park-55384','55384'),
  ('Minneapolis (55401)','minneapolis-55401','55401'),
  ('Minneapolis (55402)','minneapolis-55402','55402'),
  ('Minneapolis (55403)','minneapolis-55403','55403'),
  ('Minneapolis (55404)','minneapolis-55404','55404'),
  ('Minneapolis (55405)','minneapolis-55405','55405'),
  ('Minneapolis (55406)','minneapolis-55406','55406'),
  ('Minneapolis (55407)','minneapolis-55407','55407'),
  ('Minneapolis (55408)','minneapolis-55408','55408'),
  ('Minneapolis (55409)','minneapolis-55409','55409'),
  ('Minneapolis (55410)','minneapolis-55410','55410'),
  ('Minneapolis (55411)','minneapolis-55411','55411'),
  ('Minneapolis (55412)','minneapolis-55412','55412'),
  ('Minneapolis (55413)','minneapolis-55413','55413'),
  ('Minneapolis (55414)','minneapolis-55414','55414'),
  ('Minneapolis (55415)','minneapolis-55415','55415'),
  ('Minneapolis (55416)','minneapolis-55416','55416'),
  ('Minneapolis (55417)','minneapolis-55417','55417'),
  ('Minneapolis (55418)','minneapolis-55418','55418'),
  ('Minneapolis (55419)','minneapolis-55419','55419'),
  ('Minneapolis (55420)','minneapolis-55420','55420'),
  ('Minneapolis (55422)','minneapolis-55422','55422'),
  ('Minneapolis (55423)','minneapolis-55423','55423'),
  ('Minneapolis (55424)','minneapolis-55424','55424'),
  ('Minneapolis (55425)','minneapolis-55425','55425'),
  ('Minneapolis (55426)','minneapolis-55426','55426'),
  ('Minneapolis (55427)','minneapolis-55427','55427'),
  ('Minneapolis (55428)','minneapolis-55428','55428'),
  ('Minneapolis (55429)','minneapolis-55429','55429'),
  ('Minneapolis (55430)','minneapolis-55430','55430'),
  ('Minneapolis (55431)','minneapolis-55431','55431'),
  ('Minneapolis (55435)','minneapolis-55435','55435'),
  ('Minneapolis (55436)','minneapolis-55436','55436'),
  ('Minneapolis (55437)','minneapolis-55437','55437'),
  ('Minneapolis (55438)','minneapolis-55438','55438'),
  ('Minneapolis (55439)','minneapolis-55439','55439'),
  ('Minneapolis (55441)','minneapolis-55441','55441'),
  ('Minneapolis (55442)','minneapolis-55442','55442'),
  ('Minneapolis (55443)','minneapolis-55443','55443'),
  ('Minneapolis (55444)','minneapolis-55444','55444'),
  ('Minneapolis (55445)','minneapolis-55445','55445'),
  ('Minneapolis (55446)','minneapolis-55446','55446'),
  ('Minneapolis (55447)','minneapolis-55447','55447')
) as v(name, slug, zip)
on conflict do nothing;

-- Ramsey County (17 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Ramsey', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='ramsey-county-mn')
from (values
  ('Saint Paul (55101)','saint-paul-55101','55101'),
  ('Saint Paul (55102)','saint-paul-55102','55102'),
  ('Saint Paul (55103)','saint-paul-55103','55103'),
  ('Saint Paul (55104)','saint-paul-55104','55104'),
  ('Saint Paul (55105)','saint-paul-55105','55105'),
  ('Saint Paul (55106)','saint-paul-55106','55106'),
  ('Saint Paul (55107)','saint-paul-55107','55107'),
  ('Saint Paul (55108)','saint-paul-55108','55108'),
  ('Saint Paul (55109)','saint-paul-55109','55109'),
  ('Saint Paul (55110)','saint-paul-55110','55110'),
  ('Saint Paul (55112)','saint-paul-55112','55112'),
  ('Saint Paul (55113)','saint-paul-55113','55113'),
  ('Saint Paul (55116)','saint-paul-55116','55116'),
  ('Saint Paul (55117)','saint-paul-55117','55117'),
  ('Saint Paul (55119)','saint-paul-55119','55119'),
  ('Saint Paul (55126)','saint-paul-55126','55126'),
  ('Saint Paul (55127)','saint-paul-55127','55127')
) as v(name, slug, zip)
on conflict do nothing;

-- Washington County (17 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Washington', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='washington-county-mn')
from (values
  ('Afton (55001)','afton-55001','55001'),
  ('Bayport (55003)','bayport-55003','55003'),
  ('Cottage Grove (55016)','cottage-grove-55016','55016'),
  ('Forest Lake (55025)','forest-lake-55025','55025'),
  ('Hugo (55038)','hugo-55038','55038'),
  ('Lake Elmo (55042)','lake-elmo-55042','55042'),
  ('Lakeland (55043)','lakeland-55043','55043'),
  ('Marine On Saint Croix (55047)','marine-on-saint-croix-55047','55047'),
  ('Newport (55055)','newport-55055','55055'),
  ('Saint Paul Park (55071)','saint-paul-park-55071','55071'),
  ('Scandia (55073)','scandia-55073','55073'),
  ('Stillwater (55082)','stillwater-55082','55082'),
  ('Stillwater (55083)','stillwater-55083','55083'),
  ('Saint Paul (55115)','saint-paul-55115','55115'),
  ('Saint Paul (55125)','saint-paul-55125','55125'),
  ('Saint Paul (55128)','saint-paul-55128','55128'),
  ('Saint Paul (55129)','saint-paul-55129','55129')
) as v(name, slug, zip)
on conflict do nothing;

-- Dakota County (16 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Dakota', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='dakota-county-mn')
from (values
  ('Farmington (55024)','farmington-55024','55024'),
  ('Hampton (55031)','hampton-55031','55031'),
  ('Hastings (55033)','hastings-55033','55033'),
  ('Lakeville (55044)','lakeville-55044','55044'),
  ('Randolph (55065)','randolph-55065','55065'),
  ('Rosemount (55068)','rosemount-55068','55068'),
  ('South Saint Paul (55075)','south-saint-paul-55075','55075'),
  ('Inver Grove Heights (55076)','inver-grove-heights-55076','55076'),
  ('Inver Grove Heights (55077)','inver-grove-heights-55077','55077'),
  ('Vermillion (55085)','vermillion-55085','55085'),
  ('Saint Paul (55118)','saint-paul-55118','55118'),
  ('Saint Paul (55120)','saint-paul-55120','55120'),
  ('Saint Paul (55121)','saint-paul-55121','55121'),
  ('Saint Paul (55122)','saint-paul-55122','55122'),
  ('Saint Paul (55123)','saint-paul-55123','55123'),
  ('Saint Paul (55124)','saint-paul-55124','55124')
) as v(name, slug, zip)
on conflict do nothing;

-- Stearns County (14 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Stearns', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='stearns-county-mn')
from (values
  ('Kimball (55353)','kimball-55353','55353'),
  ('South Haven (55382)','south-haven-55382','55382'),
  ('Saint Cloud (56301)','saint-cloud-56301','56301'),
  ('Saint Cloud (56303)','saint-cloud-56303','56303'),
  ('Albany (56307)','albany-56307','56307'),
  ('Avon (56310)','avon-56310','56310'),
  ('Cold Spring (56320)','cold-spring-56320','56320'),
  ('Collegeville (56321)','collegeville-56321','56321'),
  ('Holdingford (56340)','holdingford-56340','56340'),
  ('Melrose (56352)','melrose-56352','56352'),
  ('Paynesville (56362)','paynesville-56362','56362'),
  ('Richmond (56368)','richmond-56368','56368'),
  ('Saint Joseph (56374)','saint-joseph-56374','56374'),
  ('Sartell (56377)','sartell-56377','56377')
) as v(name, slug, zip)
on conflict do nothing;

-- Carver County (10 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Carver', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='carver-county-mn')
from (values
  ('Carver (55315)','carver-55315','55315'),
  ('Chanhassen (55317)','chanhassen-55317','55317'),
  ('Chaska (55318)','chaska-55318','55318'),
  ('Mayer (55360)','mayer-55360','55360'),
  ('New Germany (55367)','new-germany-55367','55367'),
  ('Norwood Young America (55368)','norwood-young-america-55368','55368'),
  ('Victoria (55386)','victoria-55386','55386'),
  ('Waconia (55387)','waconia-55387','55387'),
  ('Watertown (55388)','watertown-55388','55388'),
  ('Young America (55397)','young-america-55397','55397')
) as v(name, slug, zip)
on conflict do nothing;

-- Olmsted County (9 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Olmsted', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='olmsted-county-mn')
from (values
  ('Rochester (55901)','rochester-55901','55901'),
  ('Rochester (55902)','rochester-55902','55902'),
  ('Rochester (55904)','rochester-55904','55904'),
  ('Rochester (55906)','rochester-55906','55906'),
  ('Byron (55920)','byron-55920','55920'),
  ('Dover (55929)','dover-55929','55929'),
  ('Eyota (55934)','eyota-55934','55934'),
  ('Oronoco (55960)','oronoco-55960','55960'),
  ('Stewartville (55976)','stewartville-55976','55976')
) as v(name, slug, zip)
on conflict do nothing;

-- Wright County (9 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Wright', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='wright-county-mn')
from (values
  ('Albertville (55301)','albertville-55301','55301'),
  ('Buffalo (55313)','buffalo-55313','55313'),
  ('Clearwater (55320)','clearwater-55320','55320'),
  ('Delano (55328)','delano-55328','55328'),
  ('Hanover (55341)','hanover-55341','55341'),
  ('Monticello (55362)','monticello-55362','55362'),
  ('Montrose (55363)','montrose-55363','55363'),
  ('Rockford (55373)','rockford-55373','55373'),
  ('Saint Michael (55376)','saint-michael-55376','55376')
) as v(name, slug, zip)
on conflict do nothing;

-- Anoka County (6 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Anoka', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='anoka-county-mn')
from (values
  ('Bethel (55005)','bethel-55005','55005'),
  ('Cedar (55011)','cedar-55011','55011'),
  ('Circle Pines (55014)','circle-pines-55014','55014'),
  ('Saint Francis (55070)','saint-francis-55070','55070'),
  ('Anoka (55303)','anoka-55303','55303'),
  ('Andover (55304)','andover-55304','55304')
) as v(name, slug, zip)
on conflict do nothing;

-- Scott County (6 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Scott', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='scott-county-mn')
from (values
  ('Elko New Market (55020)','elko-new-market-55020','55020'),
  ('Elko New Market (55054)','elko-new-market-55054','55054'),
  ('Jordan (55352)','jordan-55352','55352'),
  ('Prior Lake (55372)','prior-lake-55372','55372'),
  ('Savage (55378)','savage-55378','55378'),
  ('Shakopee (55379)','shakopee-55379','55379')
) as v(name, slug, zip)
on conflict do nothing;

-- Sherburne County (3 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Sherburne', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='sherburne-county-mn')
from (values
  ('Elk River (55330)','elk-river-55330','55330'),
  ('Santiago (55377)','santiago-55377','55377'),
  ('Saint Cloud (56304)','saint-cloud-56304','56304')
) as v(name, slug, zip)
on conflict do nothing;

-- Benton County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Benton', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='benton-county-mn')
from (values
  ('Rice (56367)','rice-56367','56367')
) as v(name, slug, zip)
on conflict do nothing;

-- Chisago County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Chisago', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='chisago-county-mn')
from (values
  ('Chisago City (55013)','chisago-city-55013','55013')
) as v(name, slug, zip)
on conflict do nothing;

-- Dodge County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Dodge', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='dodge-county-mn')
from (values
  ('Kasson (55944)','kasson-55944','55944')
) as v(name, slug, zip)
on conflict do nothing;

-- Isanti County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Isanti', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='isanti-county-mn')
from (values
  ('Isanti (55040)','isanti-55040','55040')
) as v(name, slug, zip)
on conflict do nothing;

-- Rice County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Rice', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='rice-county-mn')
from (values
  ('Northfield (55057)','northfield-55057','55057')
) as v(name, slug, zip)
on conflict do nothing;

-- Todd County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Todd', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='todd-county-mn')
from (values
  ('Grey Eagle (56336)','grey-eagle-56336','56336')
) as v(name, slug, zip)
on conflict do nothing;

-- Wabasha County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Wabasha', 'MN', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='wabasha-county-mn')
from (values
  ('Mazeppa (55956)','mazeppa-55956','55956')
) as v(name, slug, zip)
on conflict do nothing;

-- Verify:
--   select c.name, c.level, c.slug, c.zip_codes[1] as zip,
--          (select p.name from public.communities p where p.id = c.parent_id) as parent
--   from public.communities c where c.state='MN'
--   order by array_position(array['county','city','zip','neighborhood'], c.level), c.zip_codes[1];

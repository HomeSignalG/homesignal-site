-- texas-communities-seed.sql
-- The Texas (Central Texas / Austin metro + DFW-north collar + Greater Houston collar +
-- San Antonio / New Braunfels edge) per-ZIP backbone: 18 county roots + one level=zip page
-- per requested ZIP, parent_id -> county, government inherited via cascade
-- (docs/community-build-source-of-truth.md §13). Idempotent (on conflict do nothing on the
-- case-insensitive-unique slug); requires the slug column (docs/communities-slug-migration.sql)
-- and the level enum (county|city|zip|neighborhood).
--
-- MODEL (citizens think in ZIP codes): the ZIP is the resident-facing PAGE; the county is the
-- government LAYER each ZIP inherits by cascading UP parent_id. Each county root = the 6
-- canonical civic topics (word-for-word matches to the ingest CANONICAL_TOPICS + the live
-- Utah/Colorado/Michigan/Washington county rows). Every ZIP page starts government_topics=[]
-- and inherits its county's topics via cascade.
--
-- DATA PROVENANCE (§12.0 — never guess a ZIP↔county mapping): the ZIP -> city + county
-- crosswalk was generated from the `zipcodes` PyPI package v3.0.0 (bundled, offline US postal
-- database). Each ZIP page is named "<primary USPS city> (<ZIP>)". Values are used verbatim
-- from the package (e.g. "Mckinney", "Mc Dade") — the authoritative source is not editorialized.
--
-- First TEXAS build (prior states: UT/CO/MI/WA). No collisions: all 249 requested ZIPs mapped
-- to exactly one TX county in the crosswalk, 0 quarantined, and NONE was already claimed by a
-- live community row (TX had zero rows pre-seed; verified pre-seed). County slugs carry a `-tx`
-- suffix (`travis-county-tx`, …) so common county names (Montgomery, Liberty, Walker, …) don't
-- collide with future states.
--
-- City councils (Austin, Plano, McKinney, Frisco, Denton, Sugar Land, Conroe, Round Rock,
-- Georgetown, Cedar Park, New Braunfels, San Antonio, …) are layered on LATER, each as its own
-- level=city row with a "City government (X)" topic, ONCE that city's meeting source is verified
-- + wired on the ingest side (§13.2/§13.3 — never mint a subscribable council topic before its
-- feed exists). For now every ZIP inherits its county's 6 topics via cascade, which is real,
-- subscribable value today.

-- ── 1) County roots ── the government layer each ZIP inherits ────────────────────────
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics) values
('Travis County','Travis','TX','county','travis-county-tx',
 array['73301','73344','78615','78617','78645','78652','78653','78660','78669','78691',
       '78701','78702','78703','78704','78705','78708','78709','78710','78711','78712',
       '78713','78714','78715','78716','78718','78719','78720','78721','78722','78723',
       '78724','78725','78726','78727','78728','78730','78731','78732','78733','78734',
       '78735','78736','78738','78739','78741','78742','78744','78745','78746','78747',
       '78748','78749','78750','78751','78752','78753','78754','78755','78756','78757',
       '78758','78759','78760','78761','78762','78763','78764','78765','78766','78767',
       '78768','78769','78772','78773','78774','78778','78779','78780','78781','78783',
       '78785','78786','78788','78789','78798','78799'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Denton County','Denton','TX','county','denton-county-tx',
 array['75007','75010','75022','75027','75028','75029','75033','75036','75056','75057',
       '75065','75067','75068','75077','76201','76202','76203','76204','76205','76206',
       '76207','76208','76209','76210','76226','76227','76247','76249','76258','76259',
       '76262','76266'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Collin County','Collin','TX','county','collin-county-tx',
 array['75002','75009','75013','75023','75024','75025','75026','75034','75035','75069',
       '75070','75071','75072','75074','75075','75078','75082','75086','75093','75094',
       '75097','75098','75407','75409','75424','75442','75454','75485'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Williamson County','Williamson','TX','county','williamson-county-tx',
 array['76511','76527','76530','76537','76573','76574','76578','78613','78626','78627',
       '78628','78630','78633','78634','78641','78642','78646','78664','78665','78673',
       '78674','78681','78682','78717','78729'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Montgomery County','Montgomery','TX','county','montgomery-county-tx',
 array['77301','77302','77303','77304','77305','77306','77316','77318','77328','77354',
       '77356','77357','77362','77365','77372','77378','77380','77381','77382','77384',
       '77385','77386'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Fort Bend County','Fort Bend','TX','county','fort-bend-county-tx',
 array['77053','77406','77407','77417','77441','77459','77461','77469','77471','77476',
       '77477','77478','77479','77481','77487','77489','77494','77496','77497','77498',
       '77545'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Hays County','Hays','TX','county','hays-county-tx',
 array['78610','78619','78620','78640','78666','78667','78676','78737'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Comal County','Comal','TX','county','comal-county-tx',
 array['78070','78130','78131','78132','78133','78135','78163'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Bastrop County','Bastrop','TX','county','bastrop-county-tx',
 array['78602','78612','78621','78650','78659'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Burnet County','Burnet','TX','county','burnet-county-tx',
 array['78605','78608','78611','78654'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Llano County','Llano','TX','county','llano-county-tx',
 array['78639','78657','78672'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Bexar County','Bexar','TX','county','bexar-county-tx',
 array['78260','78261'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Brazoria County','Brazoria','TX','county','brazoria-county-tx',
 array['77583'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Caldwell County','Caldwell','TX','county','caldwell-county-tx',
 array['78616'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Harris County','Harris','TX','county','harris-county-tx',
 array['77393'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Lampasas County','Lampasas','TX','county','lampasas-county-tx',
 array['76539'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Liberty County','Liberty','TX','county','liberty-county-tx',
 array['77327'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Walker County','Walker','TX','county','walker-county-tx',
 array['77358'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting'])
on conflict do nothing;

-- ── 2) ZIP pages ── one per ZIP; parent -> county; government inherited via cascade ──
-- Names carry the ZIP so each page reads as a distinct place (§13.7 duplicate-content note).

-- Travis County (86 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Travis', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='travis-county-tx')
from (values
  ('Austin (73301)','austin-73301','73301'),
  ('Austin (73344)','austin-73344','73344'),
  ('Coupland (78615)','coupland-78615','78615'),
  ('Del Valle (78617)','del-valle-78617','78617'),
  ('Leander (78645)','leander-78645','78645'),
  ('Manchaca (78652)','manchaca-78652','78652'),
  ('Manor (78653)','manor-78653','78653'),
  ('Pflugerville (78660)','pflugerville-78660','78660'),
  ('Spicewood (78669)','spicewood-78669','78669'),
  ('Pflugerville (78691)','pflugerville-78691','78691'),
  ('Austin (78701)','austin-78701','78701'),
  ('Austin (78702)','austin-78702','78702'),
  ('Austin (78703)','austin-78703','78703'),
  ('Austin (78704)','austin-78704','78704'),
  ('Austin (78705)','austin-78705','78705'),
  ('Austin (78708)','austin-78708','78708'),
  ('Austin (78709)','austin-78709','78709'),
  ('Austin (78710)','austin-78710','78710'),
  ('Austin (78711)','austin-78711','78711'),
  ('Austin (78712)','austin-78712','78712'),
  ('Austin (78713)','austin-78713','78713'),
  ('Austin (78714)','austin-78714','78714'),
  ('Austin (78715)','austin-78715','78715'),
  ('Austin (78716)','austin-78716','78716'),
  ('Austin (78718)','austin-78718','78718'),
  ('Austin (78719)','austin-78719','78719'),
  ('Austin (78720)','austin-78720','78720'),
  ('Austin (78721)','austin-78721','78721'),
  ('Austin (78722)','austin-78722','78722'),
  ('Austin (78723)','austin-78723','78723'),
  ('Austin (78724)','austin-78724','78724'),
  ('Austin (78725)','austin-78725','78725'),
  ('Austin (78726)','austin-78726','78726'),
  ('Austin (78727)','austin-78727','78727'),
  ('Austin (78728)','austin-78728','78728'),
  ('Austin (78730)','austin-78730','78730'),
  ('Austin (78731)','austin-78731','78731'),
  ('Austin (78732)','austin-78732','78732'),
  ('Austin (78733)','austin-78733','78733'),
  ('Austin (78734)','austin-78734','78734'),
  ('Austin (78735)','austin-78735','78735'),
  ('Austin (78736)','austin-78736','78736'),
  ('Austin (78738)','austin-78738','78738'),
  ('Austin (78739)','austin-78739','78739'),
  ('Austin (78741)','austin-78741','78741'),
  ('Austin (78742)','austin-78742','78742'),
  ('Austin (78744)','austin-78744','78744'),
  ('Austin (78745)','austin-78745','78745'),
  ('Austin (78746)','austin-78746','78746'),
  ('Austin (78747)','austin-78747','78747'),
  ('Austin (78748)','austin-78748','78748'),
  ('Austin (78749)','austin-78749','78749'),
  ('Austin (78750)','austin-78750','78750'),
  ('Austin (78751)','austin-78751','78751'),
  ('Austin (78752)','austin-78752','78752'),
  ('Austin (78753)','austin-78753','78753'),
  ('Austin (78754)','austin-78754','78754'),
  ('Austin (78755)','austin-78755','78755'),
  ('Austin (78756)','austin-78756','78756'),
  ('Austin (78757)','austin-78757','78757'),
  ('Austin (78758)','austin-78758','78758'),
  ('Austin (78759)','austin-78759','78759'),
  ('Austin (78760)','austin-78760','78760'),
  ('Austin (78761)','austin-78761','78761'),
  ('Austin (78762)','austin-78762','78762'),
  ('Austin (78763)','austin-78763','78763'),
  ('Austin (78764)','austin-78764','78764'),
  ('Austin (78765)','austin-78765','78765'),
  ('Austin (78766)','austin-78766','78766'),
  ('Austin (78767)','austin-78767','78767'),
  ('Austin (78768)','austin-78768','78768'),
  ('Austin (78769)','austin-78769','78769'),
  ('Austin (78772)','austin-78772','78772'),
  ('Austin (78773)','austin-78773','78773'),
  ('Austin (78774)','austin-78774','78774'),
  ('Austin (78778)','austin-78778','78778'),
  ('Austin (78779)','austin-78779','78779'),
  ('Austin (78780)','austin-78780','78780'),
  ('Austin (78781)','austin-78781','78781'),
  ('Austin (78783)','austin-78783','78783'),
  ('Austin (78785)','austin-78785','78785'),
  ('Austin (78786)','austin-78786','78786'),
  ('Austin (78788)','austin-78788','78788'),
  ('Austin (78789)','austin-78789','78789'),
  ('Austin (78798)','austin-78798','78798'),
  ('Austin (78799)','austin-78799','78799')
) as v(name, slug, zip)
on conflict do nothing;

-- Denton County (32 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Denton', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='denton-county-tx')
from (values
  ('Carrollton (75007)','carrollton-75007','75007'),
  ('Carrollton (75010)','carrollton-75010','75010'),
  ('Flower Mound (75022)','flower-mound-75022','75022'),
  ('Flower Mound (75027)','flower-mound-75027','75027'),
  ('Flower Mound (75028)','flower-mound-75028','75028'),
  ('Lewisville (75029)','lewisville-75029','75029'),
  ('Frisco (75033)','frisco-75033','75033'),
  ('Frisco (75036)','frisco-75036','75036'),
  ('The Colony (75056)','the-colony-75056','75056'),
  ('Lewisville (75057)','lewisville-75057','75057'),
  ('Lake Dallas (75065)','lake-dallas-75065','75065'),
  ('Lewisville (75067)','lewisville-75067','75067'),
  ('Little Elm (75068)','little-elm-75068','75068'),
  ('Lewisville (75077)','lewisville-75077','75077'),
  ('Denton (76201)','denton-76201','76201'),
  ('Denton (76202)','denton-76202','76202'),
  ('Denton (76203)','denton-76203','76203'),
  ('Denton (76204)','denton-76204','76204'),
  ('Denton (76205)','denton-76205','76205'),
  ('Denton (76206)','denton-76206','76206'),
  ('Denton (76207)','denton-76207','76207'),
  ('Denton (76208)','denton-76208','76208'),
  ('Denton (76209)','denton-76209','76209'),
  ('Denton (76210)','denton-76210','76210'),
  ('Argyle (76226)','argyle-76226','76226'),
  ('Aubrey (76227)','aubrey-76227','76227'),
  ('Justin (76247)','justin-76247','76247'),
  ('Krum (76249)','krum-76249','76249'),
  ('Pilot Point (76258)','pilot-point-76258','76258'),
  ('Ponder (76259)','ponder-76259','76259'),
  ('Roanoke (76262)','roanoke-76262','76262'),
  ('Sanger (76266)','sanger-76266','76266')
) as v(name, slug, zip)
on conflict do nothing;

-- Collin County (28 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Collin', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='collin-county-tx')
from (values
  ('Allen (75002)','allen-75002','75002'),
  ('Celina (75009)','celina-75009','75009'),
  ('Allen (75013)','allen-75013','75013'),
  ('Plano (75023)','plano-75023','75023'),
  ('Plano (75024)','plano-75024','75024'),
  ('Plano (75025)','plano-75025','75025'),
  ('Plano (75026)','plano-75026','75026'),
  ('Frisco (75034)','frisco-75034','75034'),
  ('Frisco (75035)','frisco-75035','75035'),
  ('Mckinney (75069)','mckinney-75069','75069'),
  ('Mckinney (75070)','mckinney-75070','75070'),
  ('Mckinney (75071)','mckinney-75071','75071'),
  ('Mckinney (75072)','mckinney-75072','75072'),
  ('Plano (75074)','plano-75074','75074'),
  ('Plano (75075)','plano-75075','75075'),
  ('Prosper (75078)','prosper-75078','75078'),
  ('Richardson (75082)','richardson-75082','75082'),
  ('Plano (75086)','plano-75086','75086'),
  ('Plano (75093)','plano-75093','75093'),
  ('Plano (75094)','plano-75094','75094'),
  ('Weston (75097)','weston-75097','75097'),
  ('Wylie (75098)','wylie-75098','75098'),
  ('Princeton (75407)','princeton-75407','75407'),
  ('Anna (75409)','anna-75409','75409'),
  ('Blue Ridge (75424)','blue-ridge-75424','75424'),
  ('Farmersville (75442)','farmersville-75442','75442'),
  ('Melissa (75454)','melissa-75454','75454'),
  ('Westminster (75485)','westminster-75485','75485')
) as v(name, slug, zip)
on conflict do nothing;

-- Williamson County (25 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Williamson', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='williamson-county-tx')
from (values
  ('Bartlett (76511)','bartlett-76511','76511'),
  ('Florence (76527)','florence-76527','76527'),
  ('Granger (76530)','granger-76530','76530'),
  ('Jarrell (76537)','jarrell-76537','76537'),
  ('Schwertner (76573)','schwertner-76573','76573'),
  ('Taylor (76574)','taylor-76574','76574'),
  ('Thrall (76578)','thrall-76578','76578'),
  ('Cedar Park (78613)','cedar-park-78613','78613'),
  ('Georgetown (78626)','georgetown-78626','78626'),
  ('Georgetown (78627)','georgetown-78627','78627'),
  ('Georgetown (78628)','georgetown-78628','78628'),
  ('Cedar Park (78630)','cedar-park-78630','78630'),
  ('Georgetown (78633)','georgetown-78633','78633'),
  ('Hutto (78634)','hutto-78634','78634'),
  ('Leander (78641)','leander-78641','78641'),
  ('Liberty Hill (78642)','liberty-hill-78642','78642'),
  ('Leander (78646)','leander-78646','78646'),
  ('Round Rock (78664)','round-rock-78664','78664'),
  ('Round Rock (78665)','round-rock-78665','78665'),
  ('Walburg (78673)','walburg-78673','78673'),
  ('Weir (78674)','weir-78674','78674'),
  ('Round Rock (78681)','round-rock-78681','78681'),
  ('Round Rock (78682)','round-rock-78682','78682'),
  ('Austin (78717)','austin-78717','78717'),
  ('Austin (78729)','austin-78729','78729')
) as v(name, slug, zip)
on conflict do nothing;

-- Montgomery County (22 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Montgomery', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='montgomery-county-tx')
from (values
  ('Conroe (77301)','conroe-77301','77301'),
  ('Conroe (77302)','conroe-77302','77302'),
  ('Conroe (77303)','conroe-77303','77303'),
  ('Conroe (77304)','conroe-77304','77304'),
  ('Conroe (77305)','conroe-77305','77305'),
  ('Conroe (77306)','conroe-77306','77306'),
  ('Montgomery (77316)','montgomery-77316','77316'),
  ('Willis (77318)','willis-77318','77318'),
  ('Cleveland (77328)','cleveland-77328','77328'),
  ('Magnolia (77354)','magnolia-77354','77354'),
  ('Montgomery (77356)','montgomery-77356','77356'),
  ('New Caney (77357)','new-caney-77357','77357'),
  ('Pinehurst (77362)','pinehurst-77362','77362'),
  ('Porter (77365)','porter-77365','77365'),
  ('Splendora (77372)','splendora-77372','77372'),
  ('Willis (77378)','willis-77378','77378'),
  ('Spring (77380)','spring-77380','77380'),
  ('Spring (77381)','spring-77381','77381'),
  ('Spring (77382)','spring-77382','77382'),
  ('Conroe (77384)','conroe-77384','77384'),
  ('Conroe (77385)','conroe-77385','77385'),
  ('Spring (77386)','spring-77386','77386')
) as v(name, slug, zip)
on conflict do nothing;

-- Fort Bend County (21 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Fort Bend', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='fort-bend-county-tx')
from (values
  ('Houston (77053)','houston-77053','77053'),
  ('Richmond (77406)','richmond-77406','77406'),
  ('Richmond (77407)','richmond-77407','77407'),
  ('Beasley (77417)','beasley-77417','77417'),
  ('Fulshear (77441)','fulshear-77441','77441'),
  ('Missouri City (77459)','missouri-city-77459','77459'),
  ('Needville (77461)','needville-77461','77461'),
  ('Richmond (77469)','richmond-77469','77469'),
  ('Rosenberg (77471)','rosenberg-77471','77471'),
  ('Simonton (77476)','simonton-77476','77476'),
  ('Stafford (77477)','stafford-77477','77477'),
  ('Sugar Land (77478)','sugar-land-77478','77478'),
  ('Sugar Land (77479)','sugar-land-77479','77479'),
  ('Thompsons (77481)','thompsons-77481','77481'),
  ('Sugar Land (77487)','sugar-land-77487','77487'),
  ('Missouri City (77489)','missouri-city-77489','77489'),
  ('Katy (77494)','katy-77494','77494'),
  ('Sugar Land (77496)','sugar-land-77496','77496'),
  ('Stafford (77497)','stafford-77497','77497'),
  ('Sugar Land (77498)','sugar-land-77498','77498'),
  ('Fresno (77545)','fresno-77545','77545')
) as v(name, slug, zip)
on conflict do nothing;

-- Hays County (8 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Hays', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='hays-county-tx')
from (values
  ('Buda (78610)','buda-78610','78610'),
  ('Driftwood (78619)','driftwood-78619','78619'),
  ('Dripping Springs (78620)','dripping-springs-78620','78620'),
  ('Kyle (78640)','kyle-78640','78640'),
  ('San Marcos (78666)','san-marcos-78666','78666'),
  ('San Marcos (78667)','san-marcos-78667','78667'),
  ('Wimberley (78676)','wimberley-78676','78676'),
  ('Austin (78737)','austin-78737','78737')
) as v(name, slug, zip)
on conflict do nothing;

-- Comal County (7 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Comal', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='comal-county-tx')
from (values
  ('Spring Branch (78070)','spring-branch-78070','78070'),
  ('New Braunfels (78130)','new-braunfels-78130','78130'),
  ('New Braunfels (78131)','new-braunfels-78131','78131'),
  ('New Braunfels (78132)','new-braunfels-78132','78132'),
  ('Canyon Lake (78133)','canyon-lake-78133','78133'),
  ('New Braunfels (78135)','new-braunfels-78135','78135'),
  ('Bulverde (78163)','bulverde-78163','78163')
) as v(name, slug, zip)
on conflict do nothing;

-- Bastrop County (5 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Bastrop', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='bastrop-county-tx')
from (values
  ('Bastrop (78602)','bastrop-78602','78602'),
  ('Cedar Creek (78612)','cedar-creek-78612','78612'),
  ('Elgin (78621)','elgin-78621','78621'),
  ('Mc Dade (78650)','mc-dade-78650','78650'),
  ('Paige (78659)','paige-78659','78659')
) as v(name, slug, zip)
on conflict do nothing;

-- Burnet County (4 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Burnet', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='burnet-county-tx')
from (values
  ('Bertram (78605)','bertram-78605','78605'),
  ('Briggs (78608)','briggs-78608','78608'),
  ('Burnet (78611)','burnet-78611','78611'),
  ('Marble Falls (78654)','marble-falls-78654','78654')
) as v(name, slug, zip)
on conflict do nothing;

-- Llano County (3 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Llano', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='llano-county-tx')
from (values
  ('Kingsland (78639)','kingsland-78639','78639'),
  ('Horseshoe Bay (78657)','horseshoe-bay-78657','78657'),
  ('Tow (78672)','tow-78672','78672')
) as v(name, slug, zip)
on conflict do nothing;

-- Bexar County (2 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Bexar', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='bexar-county-tx')
from (values
  ('San Antonio (78260)','san-antonio-78260','78260'),
  ('San Antonio (78261)','san-antonio-78261','78261')
) as v(name, slug, zip)
on conflict do nothing;

-- Brazoria County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Brazoria', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='brazoria-county-tx')
from (values
  ('Rosharon (77583)','rosharon-77583','77583')
) as v(name, slug, zip)
on conflict do nothing;

-- Caldwell County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Caldwell', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='caldwell-county-tx')
from (values
  ('Dale (78616)','dale-78616','78616')
) as v(name, slug, zip)
on conflict do nothing;

-- Harris County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Harris', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='harris-county-tx')
from (values
  ('Spring (77393)','spring-77393','77393')
) as v(name, slug, zip)
on conflict do nothing;

-- Lampasas County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Lampasas', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='lampasas-county-tx')
from (values
  ('Kempner (76539)','kempner-76539','76539')
) as v(name, slug, zip)
on conflict do nothing;

-- Liberty County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Liberty', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='liberty-county-tx')
from (values
  ('Cleveland (77327)','cleveland-77327','77327')
) as v(name, slug, zip)
on conflict do nothing;

-- Walker County (1 ZIP pages)
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, 'Walker', 'TX', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug='walker-county-tx')
from (values
  ('New Waverly (77358)','new-waverly-77358','77358')
) as v(name, slug, zip)
on conflict do nothing;

-- Verify:
--   select c.name, c.level, c.slug, c.zip_codes[1] as zip,
--          (select p.name from public.communities p where p.id = c.parent_id) as parent
--   from public.communities c where c.state='TX'
--   order by array_position(array['county','city','zip','neighborhood'], c.level), c.zip_codes[1];

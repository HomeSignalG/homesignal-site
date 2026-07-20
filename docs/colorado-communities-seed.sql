-- colorado-communities-seed.sql
-- Colorado Front Range per-ZIP backbone: 9 county roots + one level=zip page
-- per requested ZIP, parent_id -> county, government inherited via cascade
-- (docs/community-build-source-of-truth.md §13). Idempotent (on conflict do
-- nothing on the case-insensitive-unique slug); requires the slug column
-- (docs/communities-slug-migration.sql) and the level enum.
--
-- MODEL: the ZIP is the resident-facing PAGE; the county is the government LAYER
-- each ZIP inherits by cascading UP parent_id. County root = the 6 canonical
-- civic topics (word-for-word matches to the ingest CANONICAL_TOPICS + the live
-- Utah county rows). Every ZIP page starts government_topics=[] and inherits.
--
-- City councils (Denver, Colorado Springs, Aurora, Fort Collins, Boulder,
-- Castle Rock, Parker, Centennial, Arvada, Westminster, Thornton, Longmont, …)
-- are layered on LATER, each as its own level=city row with a "City government
-- (X)" topic, ONCE that city's meeting source is verified + wired on the ingest
-- side (§13.2/§13.3 — never mint a subscribable council topic before its feed
-- exists). For now every ZIP inherits its county's 6 topics via cascade.
--
-- Cross-county collision ZIPs (one ZIP listed under two counties in the source)
-- get ONE page, parented to the first county, labeled with every place, and kept
-- OFF every other county-level zip_codes array — the one real same-level county
-- collision (§9 / §12.4). Each still resolves most-specific (zip > county).
--   80549: Larimer/Wellington, Weld/Wellington  -> owner county = Larimer
--   80516: Weld/Erie, Boulder/Erie  -> owner county = Weld
--   80003: Adams/Westminster, Jefferson/Arvada  -> owner county = Adams
--   80023: Adams/Brighton, Boulder/Broomfield  -> owner county = Adams

-- ── 1) County roots ── the government layer each ZIP inherits ────────────────
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics) values
('Douglas County','Douglas','CO','county','douglas-county-co',
 array['80104','80108','80109','80116','80118','80124','80125','80126','80129','80130','80134','80135','80138','80163'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('El Paso County','El Paso','CO','county','el-paso-county-co',
 array['80808','80809','80817','80829','80831','80840','80903','80904','80905','80906','80907','80908','80909','80910','80911','80915','80916','80917','80918','80919','80920','80921','80922','80923','80924','80925','80926','80927','80928','80929','80930','80938','80939','80951'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Larimer County','Larimer','CO','county','larimer-county-co',
 array['80511','80512','80513','80521','80524','80525','80526','80528','80534','80537','80538','80547','80549'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Weld County','Weld','CO','county','weld-county-co',
 array['80504','80514','80516','80542','80543','80546','80620','80631','80634','80642','80651','80654'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Adams County','Adams','CO','county','adams-county-co',
 array['80003','80010','80011','80019','80022','80023','80229','80233','80234','80601','80602','80603'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Jefferson County','Jefferson','CO','county','jefferson-county-co',
 array['80001','80002','80004','80005','80007','80123','80127','80401','80403','80439'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Arapahoe County','Arapahoe','CO','county','arapahoe-county-co',
 array['80012','80013','80014','80015','80016','80111','80112','80113','80121','80122','80150'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Boulder County','Boulder','CO','county','boulder-county-co',
 array['80020','80301','80302','80303','80304','80305','80501','80503'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting']),
('Denver County','Denver','CO','county','denver-county-co',
 array['80202','80203','80204','80205','80206','80207','80209','80210','80211','80212','80216','80218','80219','80220','80222','80223','80224','80227','80230','80231','80237','80238','80239','80246','80247'],
 array['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water districts & utilities','Elections & voting'])
on conflict do nothing;

-- ── 2) ZIP pages ── one per ZIP; parent → owner county; gov inherited via cascade ─
insert into public.communities (name, county, state, level, slug, zip_codes, government_topics, parent_id)
select v.name, v.county, 'CO', 'zip', v.slug, array[v.zip], array[]::text[],
       (select id from public.communities where slug = v.parent_slug)
from (values
  ('Castle Rock (80104)','Douglas','castle-rock-80104','80104','douglas-county-co'),
  ('Castle Rock (80108)','Douglas','castle-rock-80108','80108','douglas-county-co'),
  ('Castle Rock (80109)','Douglas','castle-rock-80109','80109','douglas-county-co'),
  ('Franktown (80116)','Douglas','franktown-80116','80116','douglas-county-co'),
  ('Larkspur (80118)','Douglas','larkspur-80118','80118','douglas-county-co'),
  ('Lone Tree (80124)','Douglas','lone-tree-80124','80124','douglas-county-co'),
  ('Roxborough (80125)','Douglas','roxborough-80125','80125','douglas-county-co'),
  ('Highlands Ranch (80126)','Douglas','highlands-ranch-80126','80126','douglas-county-co'),
  ('Highlands Ranch (80129)','Douglas','highlands-ranch-80129','80129','douglas-county-co'),
  ('Highlands Ranch (80130)','Douglas','highlands-ranch-80130','80130','douglas-county-co'),
  ('Parker (80134)','Douglas','parker-80134','80134','douglas-county-co'),
  ('Sedalia (80135)','Douglas','sedalia-80135','80135','douglas-county-co'),
  ('Parker (80138)','Douglas','parker-80138','80138','douglas-county-co'),
  ('Highlands Ranch (80163)','Douglas','highlands-ranch-80163','80163','douglas-county-co'),
  ('Calhan (80808)','El Paso','calhan-80808','80808','el-paso-county-co'),
  ('Cascade (80809)','El Paso','cascade-80809','80809','el-paso-county-co'),
  ('Fountain (80817)','El Paso','fountain-80817','80817','el-paso-county-co'),
  ('Manitou Springs (80829)','El Paso','manitou-springs-80829','80829','el-paso-county-co'),
  ('Peyton (80831)','El Paso','peyton-80831','80831','el-paso-county-co'),
  ('U.S. Air Force Academy (80840)','El Paso','u-s-air-force-academy-80840','80840','el-paso-county-co'),
  ('Colorado Springs (80903)','El Paso','colorado-springs-80903','80903','el-paso-county-co'),
  ('Colorado Springs (80904)','El Paso','colorado-springs-80904','80904','el-paso-county-co'),
  ('Colorado Springs (80905)','El Paso','colorado-springs-80905','80905','el-paso-county-co'),
  ('Colorado Springs (80906)','El Paso','colorado-springs-80906','80906','el-paso-county-co'),
  ('Colorado Springs (80907)','El Paso','colorado-springs-80907','80907','el-paso-county-co'),
  ('Colorado Springs (80908)','El Paso','colorado-springs-80908','80908','el-paso-county-co'),
  ('Colorado Springs (80909)','El Paso','colorado-springs-80909','80909','el-paso-county-co'),
  ('Colorado Springs (80910)','El Paso','colorado-springs-80910','80910','el-paso-county-co'),
  ('Colorado Springs (80911)','El Paso','colorado-springs-80911','80911','el-paso-county-co'),
  ('Colorado Springs (80915)','El Paso','colorado-springs-80915','80915','el-paso-county-co'),
  ('Colorado Springs (80916)','El Paso','colorado-springs-80916','80916','el-paso-county-co'),
  ('Colorado Springs (80917)','El Paso','colorado-springs-80917','80917','el-paso-county-co'),
  ('Colorado Springs (80918)','El Paso','colorado-springs-80918','80918','el-paso-county-co'),
  ('Colorado Springs (80919)','El Paso','colorado-springs-80919','80919','el-paso-county-co'),
  ('Colorado Springs (80920)','El Paso','colorado-springs-80920','80920','el-paso-county-co'),
  ('Colorado Springs (80921)','El Paso','colorado-springs-80921','80921','el-paso-county-co'),
  ('Colorado Springs (80922)','El Paso','colorado-springs-80922','80922','el-paso-county-co'),
  ('Colorado Springs (80923)','El Paso','colorado-springs-80923','80923','el-paso-county-co'),
  ('Colorado Springs (80924)','El Paso','colorado-springs-80924','80924','el-paso-county-co'),
  ('Colorado Springs (80925)','El Paso','colorado-springs-80925','80925','el-paso-county-co'),
  ('Colorado Springs (80926)','El Paso','colorado-springs-80926','80926','el-paso-county-co'),
  ('Colorado Springs (80927)','El Paso','colorado-springs-80927','80927','el-paso-county-co'),
  ('Colorado Springs (80928)','El Paso','colorado-springs-80928','80928','el-paso-county-co'),
  ('Colorado Springs (80929)','El Paso','colorado-springs-80929','80929','el-paso-county-co'),
  ('Colorado Springs (80930)','El Paso','colorado-springs-80930','80930','el-paso-county-co'),
  ('Colorado Springs (80938)','El Paso','colorado-springs-80938','80938','el-paso-county-co'),
  ('Colorado Springs (80939)','El Paso','colorado-springs-80939','80939','el-paso-county-co'),
  ('Colorado Springs (80951)','El Paso','colorado-springs-80951','80951','el-paso-county-co'),
  ('Estes Park (80511)','Larimer','estes-park-80511','80511','larimer-county-co'),
  ('Bellvue (80512)','Larimer','bellvue-80512','80512','larimer-county-co'),
  ('Berthoud (80513)','Larimer','berthoud-80513','80513','larimer-county-co'),
  ('Fort Collins (80521)','Larimer','fort-collins-80521','80521','larimer-county-co'),
  ('Fort Collins (80524)','Larimer','fort-collins-80524','80524','larimer-county-co'),
  ('Fort Collins (80525)','Larimer','fort-collins-80525','80525','larimer-county-co'),
  ('Fort Collins (80526)','Larimer','fort-collins-80526','80526','larimer-county-co'),
  ('Fort Collins (80528)','Larimer','fort-collins-80528','80528','larimer-county-co'),
  ('Johnstown (80534)','Larimer','johnstown-80534','80534','larimer-county-co'),
  ('Loveland (80537)','Larimer','loveland-80537','80537','larimer-county-co'),
  ('Loveland (80538)','Larimer','loveland-80538','80538','larimer-county-co'),
  ('Timnath (80547)','Larimer','timnath-80547','80547','larimer-county-co'),
  ('Wellington (80549)','Larimer','wellington-80549','80549','larimer-county-co'),
  ('Longmont (80504)','Weld','longmont-80504','80504','weld-county-co'),
  ('Dacono (80514)','Weld','dacono-80514','80514','weld-county-co'),
  ('Erie (80516)','Weld','erie-80516','80516','weld-county-co'),
  ('Mead (80542)','Weld','mead-80542','80542','weld-county-co'),
  ('Milliken (80543)','Weld','milliken-80543','80543','weld-county-co'),
  ('Lucerne (80546)','Weld','lucerne-80546','80546','weld-county-co'),
  ('Evans (80620)','Weld','evans-80620','80620','weld-county-co'),
  ('Greeley (80631)','Weld','greeley-80631','80631','weld-county-co'),
  ('Greeley (80634)','Weld','greeley-80634','80634','weld-county-co'),
  ('Keenesburg (80642)','Weld','keenesburg-80642','80642','weld-county-co'),
  ('Platteville (80651)','Weld','platteville-80651','80651','weld-county-co'),
  ('Roggen (80654)','Weld','roggen-80654','80654','weld-county-co'),
  ('Westminster / Arvada (80003)','Adams','westminster-arvada-80003','80003','adams-county-co'),
  ('Aurora (80010)','Adams','aurora-80010','80010','adams-county-co'),
  ('Aurora (80011)','Adams','aurora-80011','80011','adams-county-co'),
  ('Aurora (80019)','Adams','aurora-80019','80019','adams-county-co'),
  ('Commerce City (80022)','Adams','commerce-city-80022','80022','adams-county-co'),
  ('Brighton / Broomfield (80023)','Adams','brighton-broomfield-80023','80023','adams-county-co'),
  ('Thornton (80229)','Adams','thornton-80229','80229','adams-county-co'),
  ('Northglenn (80233)','Adams','northglenn-80233','80233','adams-county-co'),
  ('Westminster (80234)','Adams','westminster-80234','80234','adams-county-co'),
  ('Brighton (80601)','Adams','brighton-80601','80601','adams-county-co'),
  ('Brighton (80602)','Adams','brighton-80602','80602','adams-county-co'),
  ('Brighton (80603)','Adams','brighton-80603','80603','adams-county-co'),
  ('Arvada (80001)','Jefferson','arvada-80001','80001','jefferson-county-co'),
  ('Arvada (80002)','Jefferson','arvada-80002','80002','jefferson-county-co'),
  ('Arvada (80004)','Jefferson','arvada-80004','80004','jefferson-county-co'),
  ('Arvada (80005)','Jefferson','arvada-80005','80005','jefferson-county-co'),
  ('Arvada (80007)','Jefferson','arvada-80007','80007','jefferson-county-co'),
  ('Littleton (80123)','Jefferson','littleton-80123','80123','jefferson-county-co'),
  ('Littleton (80127)','Jefferson','littleton-80127','80127','jefferson-county-co'),
  ('Golden (80401)','Jefferson','golden-80401','80401','jefferson-county-co'),
  ('Golden (80403)','Jefferson','golden-80403','80403','jefferson-county-co'),
  ('Evergreen (80439)','Jefferson','evergreen-80439','80439','jefferson-county-co'),
  ('Aurora (80012)','Arapahoe','aurora-80012','80012','arapahoe-county-co'),
  ('Aurora (80013)','Arapahoe','aurora-80013','80013','arapahoe-county-co'),
  ('Aurora (80014)','Arapahoe','aurora-80014','80014','arapahoe-county-co'),
  ('Aurora (80015)','Arapahoe','aurora-80015','80015','arapahoe-county-co'),
  ('Aurora (80016)','Arapahoe','aurora-80016','80016','arapahoe-county-co'),
  ('Centennial (80111)','Arapahoe','centennial-80111','80111','arapahoe-county-co'),
  ('Centennial (80112)','Arapahoe','centennial-80112','80112','arapahoe-county-co'),
  ('Englewood (80113)','Arapahoe','englewood-80113','80113','arapahoe-county-co'),
  ('Centennial (80121)','Arapahoe','centennial-80121','80121','arapahoe-county-co'),
  ('Centennial (80122)','Arapahoe','centennial-80122','80122','arapahoe-county-co'),
  ('Littleton (80150)','Arapahoe','littleton-80150','80150','arapahoe-county-co'),
  ('Broomfield (80020)','Boulder','broomfield-80020','80020','boulder-county-co'),
  ('Boulder (80301)','Boulder','boulder-80301','80301','boulder-county-co'),
  ('Boulder (80302)','Boulder','boulder-80302','80302','boulder-county-co'),
  ('Boulder (80303)','Boulder','boulder-80303','80303','boulder-county-co'),
  ('Boulder (80304)','Boulder','boulder-80304','80304','boulder-county-co'),
  ('Boulder (80305)','Boulder','boulder-80305','80305','boulder-county-co'),
  ('Longmont (80501)','Boulder','longmont-80501','80501','boulder-county-co'),
  ('Longmont (80503)','Boulder','longmont-80503','80503','boulder-county-co'),
  ('Denver (80202)','Denver','denver-80202','80202','denver-county-co'),
  ('Denver (80203)','Denver','denver-80203','80203','denver-county-co'),
  ('Denver (80204)','Denver','denver-80204','80204','denver-county-co'),
  ('Denver (80205)','Denver','denver-80205','80205','denver-county-co'),
  ('Denver (80206)','Denver','denver-80206','80206','denver-county-co'),
  ('Denver (80207)','Denver','denver-80207','80207','denver-county-co'),
  ('Denver (80209)','Denver','denver-80209','80209','denver-county-co'),
  ('Denver (80210)','Denver','denver-80210','80210','denver-county-co'),
  ('Denver (80211)','Denver','denver-80211','80211','denver-county-co'),
  ('Denver (80212)','Denver','denver-80212','80212','denver-county-co'),
  ('Denver (80216)','Denver','denver-80216','80216','denver-county-co'),
  ('Denver (80218)','Denver','denver-80218','80218','denver-county-co'),
  ('Denver (80219)','Denver','denver-80219','80219','denver-county-co'),
  ('Denver (80220)','Denver','denver-80220','80220','denver-county-co'),
  ('Denver (80222)','Denver','denver-80222','80222','denver-county-co'),
  ('Denver (80223)','Denver','denver-80223','80223','denver-county-co'),
  ('Denver (80224)','Denver','denver-80224','80224','denver-county-co'),
  ('Denver (80227)','Denver','denver-80227','80227','denver-county-co'),
  ('Denver (80230)','Denver','denver-80230','80230','denver-county-co'),
  ('Denver (80231)','Denver','denver-80231','80231','denver-county-co'),
  ('Denver (80237)','Denver','denver-80237','80237','denver-county-co'),
  ('Denver (80238)','Denver','denver-80238','80238','denver-county-co'),
  ('Denver (80239)','Denver','denver-80239','80239','denver-county-co'),
  ('Denver (80246)','Denver','denver-80246','80246','denver-county-co'),
  ('Denver (80247)','Denver','denver-80247','80247','denver-county-co')
) as v(name, county, slug, zip, parent_slug)
on conflict do nothing;

-- Verify:
--   select level, count(*) from public.communities where state='CO' group by level;
--   select name, level, slug, zip_codes[1] as zip,
--          (select p.name from public.communities p where p.id=c.parent_id) as parent
--   from public.communities c where c.state='CO'
--   order by array_position(array['county','zip'], c.level), c.county, zip_codes[1];

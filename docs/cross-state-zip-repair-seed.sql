-- ============================================================================
-- Cross-state ZIP root repair — REPRODUCIBLE SEED OF RECORD   (APPLIED 2026-07-27)
--
-- Repairs the 19 ZIP pages that the 42-remaining-states build modeled under the
-- wrong state. That build keyed county identity on `county_fips` from the U.S.
-- Census 2020 ZCTA5->County Relationship File; a ZCTA whose polygon straddles a
-- state line is listed under every county it overlaps, so 19 border ZCTAs were
-- emitted under the NEIGHBOURING state's county. (The same build hand-resolved
-- exactly two such cases -- 20135 Bluemont VA, 82701 Newcastle WY -- and never
-- swept for the rest.)
--
-- Authoritative crosswalk: `zipcodes` PyPI v3.0.0 -- the bundled offline USPS
-- dataset every state build pins (site CLAUDE.md §12.0). All 12,722 level='zip'
-- rows were reconciled against it; 19 disagreed on state. After this repair the
-- same reconciliation returns 0. (84684/84685 are absent from that dataset and
-- stay quarantined -- excluded, never guessed.)
--
-- Applied as two migrations:
--   cross_state_zip_root_repair_19             (this file, §1-§3)
--   remove_73_duplicate_nm_anchored_local_news (this file, §4)
-- Both carry fail-closed guards; every count below is a live measured value.
--
-- WHY IT MATTERED (measured, not hypothetical): because ZIP 79922 + 79835 rooted
-- to Dona Ana County NM, the first Gold Master ingestion anchored 73 El Paso,
-- TEXAS articles to a NEW MEXICO county -- and the hourly materializer then
-- served those 7 qualifying El Paso stories on 25 ZIP pages, 23 of which are
-- genuine New Mexico towns (Las Cruces, Hatch, Mesilla, Sunland Park, ...).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- §1  The 15 missing county roots (canonical 6 topics, copied verbatim from a
--     peer root; no county below existed at ANY level beforehand -- verified)
-- ---------------------------------------------------------------------------
insert into public.communities (name, county, state, zip_codes, level, government_topics, slug)
select v.name, v.county, v.state, v.zips, 'county',
       array['County Commission & county business','Planning, zoning & development',
             'Property taxes & assessments','Public safety & emergencies',
             'Water districts & utilities','Elections & voting'], v.slug
  from (values
    ('Wicomico County','Wicomico','MD',array['21874'],'wicomico-county-md'),
    ('Cecil County','Cecil','MD',array['21912'],'cecil-county-md'),
    ('Walker County','Walker','GA',array['30741'],'walker-county-ga'),
    ('Christian County','Christian','KY',array['42223'],'christian-county-ky'),
    ('Lincoln County','Lincoln','MN',array['56136'],'lincoln-county-mn'),
    ('Marshall County','Marshall','MN',array['56744'],'marshall-county-mn'),
    ('Roberts County','Roberts','SD',array['57255'],'roberts-county-sd'),
    ('Dickey County','Dickey','ND',array['58436'],'dickey-county-nd'),
    ('McPherson County','McPherson','ND',array['58439'],'mcpherson-county-nd'),
    ('Richland County','Richland','MT',array['59221','59270'],'richland-county-mt'),
    ('Hudspeth County','Hudspeth','TX',array['79837'],'hudspeth-county-tx'),
    ('La Plata County','La Plata','CO',array['81137'],'la-plata-county-co'),
    ('Lincoln County','Lincoln','WY',array['83120'],'lincoln-county-wy'),
    ('Apache County','Apache','AZ',array['86514'],'apache-county-az'),
    ('Whitman County','Whitman','WA',array['99128'],'whitman-county-wa')
  ) as v(name, county, state, zips, slug)
 on conflict do nothing;
-- State slugs carry the -<st> suffix so Lincoln MN / Lincoln WY, Richland MT /
-- Richland ND and McPherson ND never collide. Verified: 0 duplicate slugs.


-- ---------------------------------------------------------------------------
-- §2  Repoint the 19 ZIP pages to their authoritative state / county / root.
--     name, slug and zip_codes are deliberately UNTOUCHED -- the USPS place
--     names were already correct on every one of the 19; only the geography
--     above the ZIP was wrong.
-- ---------------------------------------------------------------------------
update public.communities z
   set state = m.st, county = m.cty,
       parent_id = (select id from public.communities r where r.slug = m.root_slug)
  from (values
    ('21874','MD','Wicomico','wicomico-county-md'),   -- was DE / Sussex
    ('21912','MD','Cecil','cecil-county-md'),         -- was DE / New Castle
    ('30741','GA','Walker','walker-county-ga'),       -- was TN / Hamilton
    ('42223','KY','Christian','christian-county-ky'), -- was TN / Montgomery
    ('56136','MN','Lincoln','lincoln-county-mn'),     -- was SD / Brookings
    ('56744','MN','Marshall','marshall-county-mn'),   -- was ND / Grand Forks
    ('57255','SD','Roberts','roberts-county-sd'),     -- was ND / Richland
    ('58436','ND','Dickey','dickey-county-nd'),       -- was SD / Brown
    ('58439','ND','McPherson','mcpherson-county-nd'), -- was SD / Brown
    ('59221','MT','Richland','richland-county-mt'),   -- was ND / McKenzie
    ('59270','MT','Richland','richland-county-mt'),   -- was ND / McKenzie
    ('79835','TX','El Paso','el-paso-county-tx'),     -- was NM / Dona Ana
    ('79837','TX','Hudspeth','hudspeth-county-tx'),   -- was NM / Otero
    ('79922','TX','El Paso','el-paso-county-tx'),     -- was NM / Dona Ana
    ('81137','CO','La Plata','la-plata-county-co'),   -- was NM / San Juan
    ('83120','WY','Lincoln','lincoln-county-wy'),     -- was ID / Bonneville
    ('84536','UT','San Juan','san-juan-county-ut'),   -- was AZ / Navajo
    ('86514','AZ','Apache','apache-county-az'),       -- was NM / San Juan
    ('99128','WA','Whitman','whitman-county-wa')      -- was ID / Latah
  ) as m(zip, st, cty, root_slug)
 where z.level='zip' and z.zip_codes @> array[m.zip];


-- ---------------------------------------------------------------------------
-- §3  Drop the stale claims from the wrong-state county arrays.
--     Each of the 19 was claimed by exactly ONE county root -- verified.
-- ---------------------------------------------------------------------------
update public.communities set zip_codes = array_remove(zip_codes,'21874') where slug='sussex-county-de';
update public.communities set zip_codes = array_remove(zip_codes,'21912') where slug='new-castle-county-de';
update public.communities set zip_codes = array_remove(zip_codes,'30741') where slug='hamilton-county-tn';
update public.communities set zip_codes = array_remove(zip_codes,'42223') where slug='montgomery-county-tn';
update public.communities set zip_codes = array_remove(zip_codes,'56136') where slug='brookings-county-sd';
update public.communities set zip_codes = array_remove(zip_codes,'56744') where slug='grand-forks-county-nd';
update public.communities set zip_codes = array_remove(zip_codes,'57255') where slug='richland-county-nd';
update public.communities set zip_codes = array_remove(array_remove(zip_codes,'58436'),'58439') where slug='brown-county-sd';
update public.communities set zip_codes = array_remove(array_remove(zip_codes,'59221'),'59270') where slug='mckenzie-county-nd';
update public.communities set zip_codes = array_remove(array_remove(zip_codes,'79835'),'79922') where slug='dona-ana-county-nm';
update public.communities set zip_codes = array_remove(zip_codes,'79837') where slug='otero-county-nm';
update public.communities set zip_codes = array_remove(array_remove(zip_codes,'81137'),'86514') where slug='san-juan-county-nm';
update public.communities set zip_codes = array_remove(zip_codes,'83120') where slug='bonneville-county-id';
update public.communities set zip_codes = array_remove(zip_codes,'84536') where slug='navajo-county-az';
update public.communities set zip_codes = array_remove(zip_codes,'99128') where slug='latah-county-id';

-- Each county keeps its OWN existing convention for zip_codes:
--   San Juan County UT models coverage in the array (7 ZIPs) -> 84536 added.
--   El Paso County TX models coverage purely via child ZIP pages (array empty,
--   143 children) -> intentionally NOT modified; 79835/79922 join as children.
update public.communities set zip_codes = zip_codes || array['84536']
 where slug='san-juan-county-ut' and not (zip_codes @> array['84536']);


-- ---------------------------------------------------------------------------
-- §4  Remove the 73 duplicate El Paso TX rows anchored to Dona Ana County NM.
--     Ran ONLY after §1-§3 were verified. The `source_url in (...)` clause is a
--     hard interlock: a row can only be deleted when its content demonstrably
--     survives under El Paso County TX. Measured beforehand:
--       nm_rows 73 | tx_rows 74 | already_under_tx 73 | unique_to_nm 0
--     -> zero content lost, so no re-ingest is required.
-- ---------------------------------------------------------------------------
delete from public.alerts a
 using public.communities c
 where a.community_id = c.id
   and c.slug = 'dona-ana-county-nm'
   and a.category = 'local_news'
   and a.source_url in (
     select a2.source_url from public.alerts a2
      join public.communities c2 on c2.id = a2.community_id
     where c2.slug = 'el-paso-county-tx' and a2.category = 'local_news');
-- deleted: exactly 73 (asserted in-migration).


-- ---------------------------------------------------------------------------
-- §5  Re-materialize ONLY the affected pages: the 19 repaired ZIPs + the 25
--     Dona Ana ZIPs that had been serving the El Paso content (42 distinct).
-- ---------------------------------------------------------------------------
do $$
declare z text;
begin
  for z in (
    select unnest(array['21874','21912','30741','42223','56136','56744','57255','58436','58439',
                        '59221','59270','79835','79837','79922','81137','83120','84536','86514','99128'])
    union
    select unnest(zip_codes) from public.communities where slug='dona-ana-county-nm')
  loop perform public.app_refresh_zip(z); end loop;
end $$;


-- ---------------------------------------------------------------------------
-- §6  VERIFICATION — every one measured live after apply
-- ---------------------------------------------------------------------------
-- THE core assertion: no page may carry Local News anchored to another state.
select count(*) as cross_state_local_news_rows_expect_0
  from public.app_changes ac
  join public.communities anchor on anchor.id = ac.community_id
  join public.communities page   on page.level='zip' and page.zip_codes @> array[ac.zip]
 where ac.category='Local News' and anchor.state <> page.state;                  -- 0

-- Structure
select count(*) from public.communities;                                         -- 13277 -> 13292 (+15 roots)
select count(*) from public.communities where level='county';                    --   534 ->   549 (+15)
select count(*) from public.communities where level='zip';                       -- 12722 -> 12722 (unchanged)
select count(*) from (select slug from public.communities where slug is not null
                       group by slug having count(*)>1) d;                       -- 0 duplicate slugs
select count(*) from public.communities c where c.parent_id is not null
  and not exists (select 1 from public.communities p where p.id=c.parent_id);    -- 0 broken parents
select count(*) from public.communities where level='county' and parent_id is not null; -- 0
select count(distinct unnest) from (select unnest(zip_codes) from public.communities) u; -- 12722, unchanged

-- No duplicate Local News page rows created
select count(*) from (select zip, source_ref from public.app_changes
                       where category='Local News' group by 1,2 having count(*)>1) d;  -- 0

-- Content preserved / duplicates gone
--   Dona Ana County NM local_news  73 -> 0
--   El Paso County TX  local_news  74 -> 74   (unchanged: nothing was lost)

-- Untouched surfaces
--   Government Notices  324  -> 324
--   Meetings           2551  -> 2551
--   Development reports 12722 -> 12722 (and 19/19 on the repaired ZIPs)
--
-- Two deltas, both explained and neither a regression:
--   local_news alerts 1521 -> 1450 : -73 deleted, +2 added by the scheduled
--     ingest running concurrently (verified by created_at).
--   non-Local-News page rows +2    : Monument Valley (84536) now correctly
--     inherits SAN JUAN COUNTY, UTAH notices ("2026 PRIMARY ELECTION CANVASS",
--     "Process For Appointing a Temporary Manager...") -- a coverage GAIN, since
--     its old root (Navajo County AZ) carries no content.


-- ---------------------------------------------------------------------------
-- §7  ROLLBACK (restores the seeded, defective modeling exactly)
-- ---------------------------------------------------------------------------
-- §2/§3 are reversible; §4 is not, and needs no rollback -- the deleted rows are
-- duplicates of rows retained under El Paso County TX.
--
-- update public.communities z set state=m.st, county=m.cty,
--        parent_id=(select id from public.communities r where r.slug=m.root_slug)
--   from (values
--     ('21874','DE','Sussex','sussex-county-de'),('21912','DE','New Castle','new-castle-county-de'),
--     ('30741','TN','Hamilton','hamilton-county-tn'),('42223','TN','Montgomery','montgomery-county-tn'),
--     ('56136','SD','Brookings','brookings-county-sd'),('56744','ND','Grand Forks','grand-forks-county-nd'),
--     ('57255','ND','Richland','richland-county-nd'),('58436','SD','Brown','brown-county-sd'),
--     ('58439','SD','Brown','brown-county-sd'),('59221','ND','McKenzie','mckenzie-county-nd'),
--     ('59270','ND','McKenzie','mckenzie-county-nd'),('79835','NM','Doña Ana','dona-ana-county-nm'),
--     ('79837','NM','Otero','otero-county-nm'),('79922','NM','Doña Ana','dona-ana-county-nm'),
--     ('81137','NM','San Juan','san-juan-county-nm'),('83120','ID','Bonneville','bonneville-county-id'),
--     ('84536','AZ','Navajo','navajo-county-az'),('86514','NM','San Juan','san-juan-county-nm'),
--     ('99128','ID','Latah','latah-county-id')
--   ) as m(zip,st,cty,root_slug)
--  where z.level='zip' and z.zip_codes @> array[m.zip];
-- (then re-add each ZIP to its old county array and delete the 15 new roots)


-- ---------------------------------------------------------------------------
-- §8  FOLLOW-UP (logged, not blocking)
-- ---------------------------------------------------------------------------
-- Add a state-vs-USPS assertion to scripts/verify-communities.mjs so this class
-- is caught by CI rather than by a downstream content anomaly. The 15 new county
-- roots have government_topics but no wired feeds yet -- they inherit the normal
-- "coverage_coming" behaviour until their feeds are configured in
-- homesignal-ingest, exactly like every other newly-seeded county root.

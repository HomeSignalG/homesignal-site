-- Washington city communities, Washington audit step 3 (2026-10-23; founder: "go").
-- Same model as docs/pierce-city-communities-seed.sql: a city community exists only once
-- HomeSignal reads that city's own source. Until then public.zip_government_bodies lists the city
-- on every ZIP it covers, with its land share and "HomeSignal is not reading this city yet".
--   zip_codes '{}'      the city owns no ZIP page; ZIP pages stay parented to the county
--   census_place_geoid  read from geo.zcta_place_overlap inside the insert (never typed)
--   government_topics   '{}' (a city's topics follow its ACTIVE feeds)
-- Feeds: homesignal-ingest feeds.csv mtg-<slug>-city-catchall.
--
-- Measured 2026-10-23 before the insert: 136 of 362 WA ZIP pages list at least one city HomeSignal
-- does not read (139 places on WA pages, 44 read). These 7 were probed live through pg_net and each
-- answers with its own current council calendar:
--   Vancouver   Clark     CivicClerk vancouverwa   City Council Meeting, Planning Commission, ...
--   Richland    Benton    CivicClerk richlandwa    City Council Regular Meeting, Planning Commission
--   Kennewick   Benton    CivicClerk kennewickwa   City Council Regular / Workshop Meeting
--   Lacey       Thurston  CivicClerk laceywa       City Council Meeting / Worksession
--   Marysville  Snohomish CivicClerk marysvillewa  City Council Meeting / Work Session
--   Olympia     Thurston  Legistar olympia         City Council (EventBodyName), committees
--   Kent        King      iQM2 kentwa              City Council Regular / Special Meeting
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, v.county, 'WA', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Vancouver', 'Clark', 'vancouver-wa', 'clark-county-wa'),
             ('Richland', 'Benton', 'richland-wa', 'benton-county-wa'),
             ('Kennewick', 'Benton', 'kennewick-wa', 'benton-county-wa'),
             ('Lacey', 'Thurston', 'lacey-wa', 'thurston-county-wa'),
             ('Marysville', 'Snohomish', 'marysville-wa', 'snohomish-county-wa'),
             ('Olympia', 'Thurston', 'olympia-wa', 'thurston-county-wa'),
             ('Kent', 'King', 'kent-wa', 'king-county-wa')) v(name, county, slug, parent_slug)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '53%' and place_funcstat = 'A') o on o.place_name = v.name || ' city'
join public.communities p on p.slug = v.parent_slug
where not exists (select 1 from public.communities c where c.slug = v.slug);

-- HELD 2026-10-23 (no community row):
--   Spokane         no answer on Legistar (spokane, spokanecity, spokanewa), CivicClerk, PrimeGov
--                   or eSCRIBE; spokanecity.granicus.com reset the connection
--   Everett         everett.granicus.com 404, everett.legistar.com empty, Legistar/CivicClerk slugs none
--   Spokane Valley  its AgendaCenter is a client-rendered "Loading" shell (nothing server-side)
--   Bellingham      meetings.cob.org is OnBase Agenda Online, current (2026 meetings into 2027-01),
--                   but its page carries no /AgendaOnline/Meetings/ViewMeeting anchors, the shape
--                   the shipped onbase_meeting_rows parser reads
--   Yakima          yakima.novusagenda.com/agendapublic answers, currency not yet established
--   Federal Way     no Legistar tenant (see pierce seed); federalway.granicus.com reset the connection

-- applied 2026-10-23 (migration washington_city_communities_step3_20261023):
--   Kennewick 29d46fc0-c4be-454c-a308-799bc5d711c9 (5335275) · Kent 587c22bc-a40b-4f14-81ad-2231262b0be7 (5335415) ·
--   Lacey dba063d0-c3ee-45ad-a278-d6b65faa47ec (5336745) · Marysville c17e515f-ce99-4aea-ae44-bcb65de30f58 (5343955) ·
--   Olympia 2cc5d6cb-212b-4d3d-be1b-3cc3c8331ca0 (5351300) · Richland f00f732c-1653-43cd-aad1-52fde29fae4d (5358235) ·
--   Vancouver f02aa44a-06e2-4804-acf5-e54cb63886df (5374060). 30 ZIP-page links in zip_government_city_links.

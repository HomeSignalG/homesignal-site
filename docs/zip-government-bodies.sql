-- Which governments cover a ZIP — step 2 of the multi-city ZIP page build (option 3, 2026-10-18).
--
-- ONE decision, read by every surface that needs it (the ZIP page's meetings and topic picker,
-- the page generator, delivery measurement). No surface may decide this a second way.
--
-- public.zip_government_bodies(zip) returns one row per government body:
--   * the chain ROOT of the ZIP's community (the county today; a root city such as
--     Eagle Mountain UT where that is how it is modelled) — body_kind = its level;
--   * every INCORPORATED Census place (funcstat A or B) that covers >= 1% of the ZIP's land,
--     from geo.zcta_place_overlap (docs/zcta-place-overlap.sql);
--   * any city community already on the ZIP's own chain that has no Census code yet (shown,
--     share unknown), so nothing that delivers today disappears before step 9's back-fill.
-- Columns:
--   community_id  the HomeSignal community that PUBLISHES this body's content, or null when no
--                 community exists for it yet (the page says so; it never borrows another body)
--   area_share    share of the ZIP's LAND AREA (0..1). For a county root: the land no
--                 incorporated place covers. For a root that is itself a city (it carries
--                 census_place_geoid): that city's own share. Null when not measured. ⚠️ Never present it as population.
--   measured      false when the ZIP has no Census ZCTA (PO box / single-organization ZIPs) —
--                 the page must say "not measured", never "0%".
--   has_source    the community exists and carries at least one government topic.
-- CDPs (funcstat S) are not governments: their land is unincorporated and the county governs it.

-- The city half of the decision as a SET, so a build or a measurement can read every ZIP at once
-- without calling the function 12,722 times (measured: that walk exceeds 60 s). The function
-- below reads its city communities FROM this view, so there is one rule, not two.
create or replace view public.zip_government_city_links as
select o.zcta5::text || ':' || c.id::text as link_id,  -- unique: the build pages on it
       o.zcta5::text as zip, c.id as community_id, c.name, o.place_geoid, round(o.area_share, 4) as area_share
from geo.zcta_place_overlap o
join public.communities c on c.census_place_geoid = o.place_geoid and c.level = 'city'
where o.place_funcstat in ('A', 'B') and o.area_share >= 0.01;
revoke all on public.zip_government_city_links from public;
grant select on public.zip_government_city_links to anon, authenticated, service_role;

create or replace function public.zip_government_bodies(p_zip text)
returns table (
  body_kind text, community_id uuid, name text, census_place_geoid text,
  area_share numeric, measured boolean, has_source boolean, sort_key int)
language sql
stable
security definer
set search_path = public, geo
as $fn$
  with recursive
  leaf as (
    select c.id, c.parent_id
    from public.communities c
    where p_zip ~ '^\d{5}$' and c.zip_codes @> array[p_zip]
    order by case c.level when 'zip' then 0 when 'neighborhood' then 0 when 'city' then 1
                          when 'county' then 2 else 3 end, c.id
    limit 1
  ),
  chain as (
    select l.id, l.parent_id, 0 as hop from leaf l
    union all
    select c.id, c.parent_id, ch.hop + 1
    from chain ch join public.communities c on c.id = ch.parent_id
    where ch.hop < 6
  ),
  root as (
    select c.* from public.communities c
    where c.id = (select id from chain order by hop desc limit 1)
  ),
  zmeasured as (
    select exists (select 1 from geo.zcta_boundary b where b.zcta5 = p_zip) as m
  ),
  places as (
    select o.place_geoid, o.place_name, o.area_share
    from geo.zcta_place_overlap o
    where o.zcta5 = p_zip and o.place_funcstat in ('A', 'B') and o.area_share > 0
  ),
  cities as (
    -- each incorporated place >= 1%, joined to the city community that publishes it
    select p.place_geoid, p.place_name, p.area_share,
           -- a ROOT that is itself the city (NYC's boroughs, Philadelphia, an independent
           -- city, Eagle Mountain UT) carries that place's code, and wins: the root already
           -- publishes the city's content, so the city is not listed a second time.
           coalesce(
             (select r.id from root r where r.census_place_geoid = p.place_geoid),
             (select l.community_id from public.zip_government_city_links l
               where l.zip = p_zip and l.place_geoid = p.place_geoid
               order by l.community_id limit 1)) as cid
    from places p
    where p.area_share >= 0.01
  ),
  chain_cities as (
    -- a city already on this ZIP's chain whose Census code is not set yet
    select c.id, c.name from public.communities c
    where c.id in (select id from chain) and c.level = 'city'
      and c.id <> (select id from root)
      and (c.census_place_geoid is null
           or c.census_place_geoid not in (select place_geoid from cities))
  ),
  bodies as (
    select r.level as body_kind, r.id as community_id,
           coalesce(nullif(r.name, ''), r.county) as name,
           r.census_place_geoid,
           case when not (select m from zmeasured) then null
                -- a root that is itself a city: that city's own land share
                when r.census_place_geoid is not null
                  then coalesce((select p.area_share from places p
                                  where p.place_geoid = r.census_place_geoid), 0)
                -- a county: the land no incorporated place covers
                else greatest(0, 1 - coalesce((select sum(area_share) from places), 0)) end
             as area_share,
           0 as sort_key
    from root r
    union all
    select 'city', ci.cid,
           coalesce((select c.name from public.communities c where c.id = ci.cid),
                    regexp_replace(ci.place_name,
                      ' (city and borough|city|town|village|borough|municipality|plantation)$', '')),
           ci.place_geoid, ci.area_share,
           (row_number() over (order by ci.area_share desc, ci.place_geoid))::int
    from cities ci
    where ci.cid is distinct from (select id from root)
    union all
    select 'city', cc.id, cc.name, null, null, 1000
    from chain_cities cc
  )
  select b.body_kind, b.community_id, b.name, b.census_place_geoid,
         round(b.area_share, 4), (select m from zmeasured),
         coalesce((select cardinality(c.government_topics) > 0
                     from public.communities c where c.id = b.community_id), false),
         b.sort_key
  from bodies b
  order by b.sort_key, b.name;
$fn$;

revoke all on function public.zip_government_bodies(text) from public;
grant execute on function public.zip_government_bodies(text) to anon, authenticated, service_role;

-- ── The topics each body offers, per stream ─────────────────────────────────────────────────
-- What a resident may pick for each government on this ZIP's page, so a pick always matches the
-- category that body's content is filed under (email matching is word-for-word, per community):
--   notices   the body's own government_topics (a Utah city's notices are "City government (X)")
--   meetings  the root: its government_topics (as before). A city: the six canonical meeting
--             topics — every meetings row of an enrolled community carries exactly one of them
--             (homesignal-ingest ingest.py::CANONICAL_MEETING_TOPICS and the DB CHECK
--             meetings_category_canonical). Measured 2026-10-18: Provo's 32 meetings are filed
--             under those six, never under "City government (Provo)".
-- A body with no community offers nothing (has_source false): there is nothing to deliver yet.
create or replace function public.zip_government_topics(p_zip text)
returns table (community_id uuid, body_kind text, name text, area_share numeric,
               measured boolean, stream text, topic text, sort_key int, topic_order int)
language sql
stable
security definer
set search_path = public, geo
as $fn$
  with b as (select * from public.zip_government_bodies(p_zip)),
  six(topic, ord) as (values
    ('County Commission & county business', 1), ('Planning, zoning & development', 2),
    ('Property taxes & assessments', 3), ('Public safety & emergencies', 4),
    ('Water districts & utilities', 5), ('Elections & voting', 6))
  select b.community_id, b.body_kind, b.name, b.area_share, b.measured, s.stream, s.topic,
         b.sort_key, s.ord::int
  from b
  join public.communities c on c.id = b.community_id
  -- a government with no source yet offers nothing: no pick may promise mail nothing sends
  cross join lateral (
    select 'notices'::text as stream, t.topic, t.ord
      from unnest(coalesce(c.government_topics, '{}'::text[])) with ordinality t(topic, ord)
    union all
    select 'meetings', t.topic, t.ord
      from unnest(coalesce(c.government_topics, '{}'::text[])) with ordinality t(topic, ord)
     where b.sort_key = 0
    union all
    select 'meetings', six.topic, six.ord from six where b.sort_key <> 0
  ) s
  where b.has_source
  order by b.sort_key, b.name, s.stream, s.ord;
$fn$;

revoke all on function public.zip_government_topics(text) from public;
grant execute on function public.zip_government_topics(text) to anon, authenticated, service_role;

-- ── Clearing ONE body's selection ───────────────────────────────────────────────────────────
-- signup_complete refuses an empty selection (D3: never a silent revoke). On a multi-government
-- page a resident can untick every topic of ONE city while keeping the county's, which is an
-- explicit action on that body. This removes only that identity's explicit rows in the named
-- streams. It never touches consent, follow_floor rows, another community or another person.
create or replace function public.clear_alert_selection(
  p_email text, p_community_id uuid, p_streams text[]
) returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email     text := lower(trim(p_email));
  v_n int;
begin
  if v_jwt_email = '' then
    raise exception 'clear_alert_selection must be called from an authenticated session';
  end if;
  if v_email is null or v_email = '' or v_email <> v_jwt_email then
    raise exception 'email does not match authenticated identity';
  end if;
  if p_community_id is null then raise exception 'community_id is required'; end if;
  if p_streams is null or cardinality(p_streams) = 0
     or not (p_streams <@ array['notices','meetings']::text[]) then
    raise exception 'streams must be a non-empty subset of {notices, meetings}';
  end if;
  delete from public.user_subscriptions s
   using public.users u
   where u.id = s.user_id and u.email = v_email and u.community_id = p_community_id
     and s.community_id = p_community_id and s.origin = 'explicit'
     and s.stream = any (p_streams);
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;

revoke all on function public.clear_alert_selection(text, uuid, text[]) from public, anon;
grant execute on function public.clear_alert_selection(text, uuid, text[]) to authenticated, service_role;

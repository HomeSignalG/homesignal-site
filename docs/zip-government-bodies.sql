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
           (select c.id from public.communities c
             where c.census_place_geoid = p.place_geoid
               and (c.level = 'city' or c.id = (select id from root))
             order by (c.id = (select id from root)) desc, c.id limit 1) as cid
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

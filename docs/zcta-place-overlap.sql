-- ZIP (ZCTA) to Census place overlap — step 1 of the multi-city ZIP page build (option 3, 2026-10-18).
--
-- WHAT IT IS: for every ZCTA, every Census 2020 place it overlaps and how much LAND AREA they share.
-- Source: U.S. Census Bureau 2020 ZCTA-to-Place relationship file
--   https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt
--   fetched 2026-10-18 through pg_net: 9,811,448 bytes, md5 45c7e0e7b528c2021cb406e8f9aedc84,
--   53,319 ZCTA-place pairs across 28,808 ZCTAs.
--
-- HOW IT IS USED: a ZIP page lists every INCORPORATED city it overlaps (place_funcstat = 'A'), each
-- labelled with its share of the ZIP's land area. CDPs (funcstat 'S') are statistical areas with no
-- government of their own: land inside them is unincorporated and governed by the county.
-- ⚠️ area_share is LAND AREA, never population. Never label it "% of residents".
--
-- APPLIED 2026-10-18 through db-sql.yml (runs 39150434861 + 39150497735; the Supabase MCP tool
-- hangs on a SECURITY DEFINER create). Loaded from pg_net response 43363:
--   select geo.load_zcta_place_overlap(43363, '45c7e0e7b528c2021cb406e8f9aedc84');
-- Fingerprint md5(string_agg(zcta5|place_geoid|part_arealand order by … collate "C")) =
--   8ccece3be6b16182ec01e421e85364e8 over the table AND over the source text, parsed separately.
-- 34,460 pairs are incorporated places (funcstat A). Control 98466: University Place 63.1%,
-- Fircrest 25.5%, Tacoma 11.4%. RLS on; anon cannot select.
--
-- ADDITIVE ONLY: a new table, a loader function and one nullable column on public.communities.
-- No grants to anon or authenticated: pages read it only through the decision function (step 2).

create table if not exists geo.zcta_place_overlap (
  zcta5            char(5) not null,
  place_geoid      text    not null,            -- 7 digits: state FIPS (2) + place FIPS (5)
  place_name       text    not null,            -- NAMELSAD, e.g. "Tacoma city", "Parkland CDP"
  place_class      text,                        -- CLASSFP, e.g. C1 (incorporated), U1/U2 (CDP)
  place_funcstat   text,                        -- A = active government, S = statistical (CDP)
  zcta_arealand    bigint,
  part_arealand    bigint  not null,
  area_share       numeric generated always as
                     (case when zcta_arealand > 0 then part_arealand::numeric / zcta_arealand end) stored,
  source_md5       text    not null,
  primary key (zcta5, place_geoid)
);
alter table geo.zcta_place_overlap enable row level security;
revoke all on geo.zcta_place_overlap from public, anon, authenticated;

-- Loader: parses a pg_net response holding the relationship file, refuses unless the bytes match
-- the expected md5, and replaces the table in one transaction. Re-runnable.
create or replace function geo.load_zcta_place_overlap(p_response_id bigint, p_expected_md5 text)
returns jsonb
language plpgsql
security definer
set search_path = geo, public, net
as $fn$
declare
  _content text;
  _md5 text;
  _n bigint;
  _z bigint;
begin
  select content into _content from net._http_response where id = p_response_id and status_code = 200;
  if _content is null then
    raise exception 'zcta_place_overlap: response % is missing or not HTTP 200', p_response_id;
  end if;
  _md5 := md5(_content);
  if _md5 is distinct from p_expected_md5 then
    raise exception 'zcta_place_overlap: source md5 % does not match expected %', _md5, p_expected_md5;
  end if;

  delete from geo.zcta_place_overlap;
  insert into geo.zcta_place_overlap
    (zcta5, place_geoid, place_name, place_class, place_funcstat, zcta_arealand, part_arealand, source_md5)
  select f[2], f[10], f[11], nullif(f[15], ''), nullif(f[16], ''),
         nullif(f[4], '')::bigint, coalesce(nullif(f[17], '')::bigint, 0), _md5
  from (select string_to_array(l, '|') f from regexp_split_to_table(_content, E'\n') l) x
  where array_length(f, 1) >= 17 and f[2] ~ '^\d{5}$' and f[10] <> '';

  select count(*), count(distinct zcta5) into _n, _z from geo.zcta_place_overlap;
  if _n <> 53319 or _z <> 28808 then
    raise exception 'zcta_place_overlap: loaded % pairs / % zctas, expected 53319 / 28808', _n, _z;
  end if;
  return jsonb_build_object('pairs', _n, 'zctas', _z, 'source_md5', _md5);
end
$fn$;
revoke all on function geo.load_zcta_place_overlap(bigint, text) from public, anon, authenticated;

-- ── PART B (applied separately): the city row's Census place code ──────────────────────────────
-- So a ZIP's overlapping places can be matched to the HomeSignal city that publishes their
-- government content. Nullable; set per city. A bounded lock wait: adding a column takes a brief
-- ACCESS EXCLUSIVE lock on a busy table, and an unbounded wait would queue every reader behind it
-- (the first combined apply timed out at 60 s and rolled back, nothing changed).
set lock_timeout = '3s';
alter table public.communities add column if not exists census_place_geoid text;
create index if not exists communities_census_place_geoid_idx
  on public.communities (census_place_geoid) where census_place_geoid is not null;

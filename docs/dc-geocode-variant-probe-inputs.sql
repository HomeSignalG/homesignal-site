-- dc-geocode-variant-probe-inputs.sql — READ-ONLY input set for scripts/dc-geocode-variant-probe.ts.
-- One JSON object per line. Run inside a READ ONLY transaction by dc-geocode-variant-probe.yml.
--
-- The newest shared-cache answer for every distinct geocoder query at the CURRENT ladder version:
--   kind = 'failed'   the ladder found no match — the population step 8 (C4) is about;
--   kind = 'control'  the ladder matched; a deterministic sample (md5 order, 150 rows) used to prove
--                     a rewrite does not MOVE an address that already geocodes. A rewrite that helps
--                     a failed address but shifts a control is not a fix.
with latest as (
  select distinct on (g.geocoder_query) g.geocoder_query, g.match_type, g.lat, g.lng
    from public.dc_address_geocode g
   where g.ladder_version = public.dc_geocode_ladder_version()
   order by g.geocoder_query, g.derived_at desc)
select json_build_object('kind', 'failed', 'query', l.geocoder_query)::text
  from latest l where l.match_type = 'failed'
union all
select json_build_object('kind', 'control', 'query', c.geocoder_query, 'lat', c.lat, 'lng', c.lng)::text
  from (select * from latest where match_type <> 'failed' and lat is not null
         order by md5(geocoder_query) collate "C" limit 150) c;

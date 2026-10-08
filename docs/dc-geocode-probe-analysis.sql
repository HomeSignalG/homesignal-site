-- dc-geocode-probe-analysis.sql — READ-ONLY analysis of the probe output.
-- Loaded by dc-geocode-probe.yml into a SESSION-TEMPORARY table inside a READ ONLY transaction:
-- nothing persists. Every membership fact below comes from geo.zcta_boundary polygons; the
-- provider's ZIP is printed only to show how often it would have been WRONG as a membership key.

\echo '===== A. CALIBRATION: Census interpolation vs the same Atlas record''s own site point ====='
with c as (
  select p.j->>'name' nm, p.j->>'match_type' mt, (p.j->>'lat')::float8 glat, (p.j->>'lng')::float8 glng,
         o.source_native_lat alat, o.source_native_lon alng
    from pg_temp.probe p
    join public.dc_source_observation o on o.home_signal_observation_id = (p.j->>'oid')::uuid
   where p.j->>'kind' = 'calib'),
d as (select *, case when glat is not null then
        ST_Distance(ST_SetSRID(ST_MakePoint(glng, glat), 4326)::geography,
                    ST_SetSRID(ST_MakePoint(alng, alat), 4326)::geography) end dist_m from c)
select mt, count(*) n,
       round(percentile_cont(0.50) within group (order by dist_m)::numeric) p50_m,
       round(percentile_cont(0.75) within group (order by dist_m)::numeric) p75_m,
       round(percentile_cont(0.90) within group (order by dist_m)::numeric) p90_m,
       round(percentile_cont(0.95) within group (order by dist_m)::numeric) p95_m,
       round(percentile_cont(0.99) within group (order by dist_m)::numeric) p99_m,
       round(max(dist_m)::numeric) max_m
  from d group by mt order by mt;

\echo '===== A2. CALIBRATION: does the interpolated point land in the SAME ZCTA as the site point? ====='
with c as (
  select (p.j->>'lat')::float8 glat, (p.j->>'lng')::float8 glng, o.source_native_lat alat, o.source_native_lon alng
    from pg_temp.probe p
    join public.dc_source_observation o on o.home_signal_observation_id = (p.j->>'oid')::uuid
   where p.j->>'kind' = 'calib' and p.j->>'match_type' = 'range_interpolated'),
z as (
  select c.*,
    (select array_agg(zcta5 order by zcta5) from geo.zcta_boundary b
      where ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(glng, glat), 4269))) gz,
    (select array_agg(zcta5 order by zcta5) from geo.zcta_boundary b
      where ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(alng, alat), 4269))) az,
    ST_Distance(ST_SetSRID(ST_MakePoint(glng, glat), 4326)::geography,
                ST_SetSRID(ST_MakePoint(alng, alat), 4326)::geography) dist_m,
    (select min(ST_Distance(ST_Boundary(b.geom)::geography, ST_SetSRID(ST_MakePoint(glng, glat), 4269)::geography))
       from geo.zcta_boundary b
      where ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(glng, glat), 4269))) edge_m
    from c)
select count(*) n,
       count(*) filter (where gz = az) same_zcta,
       count(*) filter (where gz is distinct from az) different_zcta,
       count(*) filter (where gz is distinct from az and edge_m > dist_m) diff_zcta_but_edge_beyond_error,
       count(*) filter (where edge_m > 1000) edge_gt_1km,
       count(*) filter (where edge_m > 1000 and gz is distinct from az) edge_gt_1km_but_wrong
  from z;

\echo '===== A3. CALIBRATION: every interpolated point that lands in a DIFFERENT ZCTA ====='
with c as (
  select p.j->>'name' nm, p.j->>'query' q, p.j->>'matched_address' ma, (p.j->>'lat')::float8 glat, (p.j->>'lng')::float8 glng,
         o.source_native_lat alat, o.source_native_lon alng
    from pg_temp.probe p
    join public.dc_source_observation o on o.home_signal_observation_id = (p.j->>'oid')::uuid
   where p.j->>'kind' = 'calib' and p.j->>'match_type' = 'range_interpolated')
select nm, q, ma,
  round(ST_Distance(ST_SetSRID(ST_MakePoint(glng, glat), 4326)::geography,
                    ST_SetSRID(ST_MakePoint(alng, alat), 4326)::geography)) dist_m,
  (select string_agg(zcta5, '/') from geo.zcta_boundary b where ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(glng, glat), 4269))) geocode_zcta,
  (select string_agg(zcta5, '/') from geo.zcta_boundary b where ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(alng, alat), 4269))) site_zcta,
  round((select min(ST_Distance(ST_Boundary(b.geom)::geography, ST_SetSRID(ST_MakePoint(glng, glat), 4269)::geography))
     from geo.zcta_boundary b where ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(glng, glat), 4269)))) geocode_edge_m
  from c
 where (select string_agg(zcta5, '/') from geo.zcta_boundary b where ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(glng, glat), 4269)))
       is distinct from
       (select string_agg(zcta5, '/') from geo.zcta_boundary b where ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(alng, alat), 4269)))
 order by dist_m desc;

\echo '===== A4. CALIBRATION: interpolation error distribution, 100 m buckets ====='
with c as (
  select ST_Distance(ST_SetSRID(ST_MakePoint((p.j->>'lng')::float8, (p.j->>'lat')::float8), 4326)::geography,
                     ST_SetSRID(ST_MakePoint(o.source_native_lon, o.source_native_lat), 4326)::geography) d
    from pg_temp.probe p
    join public.dc_source_observation o on o.home_signal_observation_id = (p.j->>'oid')::uuid
   where p.j->>'kind' = 'calib' and p.j->>'match_type' = 'range_interpolated')
select case when d < 100 then '000-099' when d < 250 then '100-249' when d < 500 then '250-499'
            when d < 1000 then '500-999' when d < 2000 then '1000-1999' when d < 5000 then '2000-4999'
            else '5000+' end bucket, count(*) from c group by 1 order by 1;

\echo '===== B. EPOCH: every US record, geocode result, polygon ZCTA, provider ZIP (diagnostic only), Atlas neighbours ====='
with e as (
  select p.j->>'name' nm, p.j->>'query' q, p.j->>'match_type' mt, (p.j->>'provider_candidates')::int cand,
         p.j->>'matched_address' ma, (p.j->>'lat')::float8 lat, (p.j->>'lng')::float8 lng,
         substring(p.j->>'matched_address' from '(\d{5})\s*$') provider_zip
    from pg_temp.probe p where p.j->>'kind' = 'epoch'),
g as (
  select e.*,
    (select string_agg(zcta5, '/' order by zcta5) from geo.zcta_boundary b
      where lat is not null and ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(lng, lat), 4269))) zcta,
    (select round(min(ST_Distance(ST_Boundary(b.geom)::geography, ST_SetSRID(ST_MakePoint(lng, lat), 4269)::geography)))
       from geo.zcta_boundary b where lat is not null and ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(lng, lat), 4269))) edge_m
  from e)
select nm, q, mt, cand, ma, round(lat::numeric, 6) lat, round(lng::numeric, 6) lng, provider_zip, zcta, edge_m,
       (provider_zip is not null and zcta is not null and provider_zip <> zcta) provider_zip_would_be_wrong,
       (select string_agg(x, ' || ') from (
           select o.source_native_name || ' [' || coalesce(nullif(o.source_native_operator, ''), '?') || '] '
                  || round(ST_Distance(ST_SetSRID(ST_MakePoint(o.source_native_lon, o.source_native_lat), 4326)::geography,
                                       ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography)) || 'm '
                  || coalesce(gg.geography_status || '/' || coalesce(gg.provenance->>'location_basis', ''), '') x
             from public.dc_current_observation c2
             join public.dc_source_observation o using (home_signal_observation_id)
             left join public.dc_entity_observation eo using (home_signal_observation_id)
             left join public.dc_entity_geography gg on gg.canonical_entity_id = eo.canonical_entity_id
            where o.source_key = 'compute_atlas' and g.lat is not null and o.source_native_lat is not null
              and ST_DWithin(ST_SetSRID(ST_MakePoint(o.source_native_lon, o.source_native_lat), 4326)::geography,
                             ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography, 15000)
            order by ST_Distance(ST_SetSRID(ST_MakePoint(o.source_native_lon, o.source_native_lat), 4326)::geography,
                                 ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography)
            limit 4) s) atlas_within_15km
  from g order by nm;

\echo '===== C. EPOCH: match-type roll-up ====='
select p.j->>'match_type' mt, (p.j->>'provider_candidates') cand, count(*)
  from pg_temp.probe p where p.j->>'kind' = 'epoch' group by 1, 2 order by 1, 2;

\echo '===== D. CONTROL: probe rows by kind (must equal the input row counts) ====='
select p.j->>'kind' kind, count(*) from pg_temp.probe p group by 1 order by 1;

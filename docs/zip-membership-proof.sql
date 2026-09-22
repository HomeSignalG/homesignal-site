-- =====================================================================================
-- ZIP MEMBERSHIP — THE NATIONAL PROOF (read-only). Every resident-visible Map 1 ZIP-mode point
-- population, every canonical ZIP, no sampling. The inside/outside tests use ST_Covers written
-- HERE, not the function under test (geo.zip_point_membership_in uses ST_Intersects; for a point
-- the two are equal, so agreement is evidence rather than a tautology). Run each block alone;
-- shard block 3 by the leading ZIP digit if the statement timeout bites.
-- =====================================================================================

-- 1. AUTHORITATIVE DEVELOPMENT (N5 markers). 2026-09-22: 1,004,080 / inside 1,004,080 / outside 0.
select count(*) total,
       count(*) filter (where b.geom is null) untestable,
       count(*) filter (where ST_Covers(b.geom, ST_SetSRID(ST_MakePoint(k.lng, k.lat), 4269))) inside,
       count(*) filter (where not ST_Covers(b.geom, ST_SetSRID(ST_MakePoint(k.lng, k.lat), 4269))) outside
  from geo.zip_authoritative_marker k
  left join geo.zcta_boundary b on b.zcta5 = k.zcta5
 where k.zcta5 in (select zip from public.canonical_zip_registry);

-- 2. NATIONAL DATA-CENTRE PLANE, as ZIP mode reads it. 2026-09-22 after: 12,722 canonical ·
--    12,016 with boundary · 1,083 served · 1,083 inside · 0 outside · 1,083 true members · 0 missed.
--    (Before, national_dc_for_zip(zip, 5) over the 12,013 admitted ZIPs: 8,369 / 1,014 / 7,355 /
--    69 missed on 25 ZIPs.)
with canon as (select c.zip, b.geom from public.canonical_zip_registry c
                 left join geo.zcta_boundary b on b.zcta5 = c.zip),
served as (select c.zip, r.source_key, r.lat, r.lng, r.zip_membership, c.geom
             from canon c cross join lateral public.national_dc_zip_members(c.zip) r),
truth as (select c.zip, r.source_key from canon c join public.national_dc_records r
            on c.geom is not null and r.map_eligible
           and ST_Covers(c.geom, ST_SetSRID(ST_MakePoint(r.lng, r.lat), 4269)))
select (select count(*) from canon) canonical_zips,
       (select count(*) from canon where geom is not null) with_boundary,
       (select count(*) from served) served,
       (select count(*) from served where ST_Covers(geom, ST_SetSRID(ST_MakePoint(lng, lat), 4269))) served_inside,
       (select count(*) from served where not ST_Covers(geom, ST_SetSRID(ST_MakePoint(lng, lat), 4269))) served_outside,
       (select count(*) from truth) true_members,
       (select count(*) from truth t where not exists
          (select 1 from served s where s.zip = t.zip and s.source_key = t.source_key)) members_missed;

-- 3. FACILITY PLANE, by Type input (layer) and verdict. Only 'member' is shown by HS.zipModeSites;
--    the invariant is indep_outside = 0 on every 'member' row. UNSTAMPED rows are ones the trigger
--    has not yet rewritten (not shown by the new client).
with p as (select d.zip, e.value x, b.geom
             from public.development_reports d
             left join geo.zcta_boundary b on b.zcta5 = d.zip,
                  lateral jsonb_array_elements(case when jsonb_typeof(d.sites) = 'array' then d.sites else '[]' end) e
            where d.zip like '0%'                                   -- shard
              and e.value->>'scope' = 'point'
              and coalesce(e.value->>'relevance', '') <> 'development')
select coalesce(x->>'layer', '') type_input,
       coalesce(x->>'zip_membership', 'UNSTAMPED') verdict,
       count(*) n,
       count(*) filter (where geom is not null and ST_Covers(geom, ST_SetSRID(ST_MakePoint((x->>'lng')::float8, (x->>'lat')::float8), 4269))) indep_inside,
       count(*) filter (where geom is not null and not ST_Covers(geom, ST_SetSRID(ST_MakePoint((x->>'lng')::float8, (x->>'lat')::float8), 4269))) indep_outside,
       count(*) filter (where geom is null) no_boundary
  from p group by 1, 2 order by 1, 2;

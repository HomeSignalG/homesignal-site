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

-- 3. FACILITY PLANE — served through public.zip_mode_report_sites (CLAUDE.md §7.08). Read-only:
--    calls the SHIPPED read for every canonical ZIP in the shard and re-tests every point it serves
--    with an INDEPENDENT predicate (ST_Covers on the raw boundary, not the canonical function).
--    served_outside and unverdicted must be 0. Shard by zip range to stay under 60 s.
--    2026-09-22 AFTER, all 12,722 ZIPs in five shards: 93,603 served · 93,603 inside · 0 outside ·
--    0 unverdicted · 0 development · 63,723 outside candidates excluded · 706 ZIPs not_measured
--    serving 0 points. (BEFORE, raw cached sites: 103,724 of 216,221 outside.)
with z as (select zip from public.canonical_zip_registry where zip >= '00000' and zip < '10000'),  -- shard
r as (select z.zip, public.zip_mode_report_sites(z.zip) j from z),
pts as (select r.zip, s from r, jsonb_array_elements(r.j->'sites') s where s->>'scope' = 'point'),
chk as (select p.*, ST_Covers(b.geom, ST_SetSRID(ST_MakePoint((p.s->>'lng')::float8, (p.s->>'lat')::float8), 4269)) inside
          from pts p left join geo.zcta_boundary b on b.zcta5 = p.zip)
select (select count(*) from r) zips,
       (select count(*) from r where j->>'status' = 'not_measured') zips_not_measured,
       (select count(*) from chk) served,
       (select count(*) from chk where inside) served_inside,
       (select count(*) from chk where inside is not true) served_outside,
       (select count(*) from chk where coalesce(s->>'zip_membership', '') <> 'member') unverdicted,
       (select count(*) from chk where s->>'relevance' = 'development') served_development,
       (select sum((j->'facility_counts'->>'outside')::int) from r) outside_excluded;

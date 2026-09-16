-- =====================================================================================
-- FIX 28 — THE FROZEN AUDIT (§3 "freeze the audit")
--
-- This is the audit as it was written BEFORE implementation and re-run UNCHANGED after it.
-- Nothing in it was rewritten to suit the new architecture. It is recorded here so the same
-- question can be asked again by anyone, at any time, and get a comparable answer.
--
-- THE FIVE THINGS THAT DEFINE THE MEASUREMENT, stated so they cannot drift:
--
--  1. POPULATION SELECTION. Every element of `public.development_reports.sites` with
--     `scope = 'point'`, across ALL 12,722 cached reports. No sampling.
--  2. DATA CENTER CLASSIFICATION. `fix28_baseline_is_dc()` below is the SQL form of the
--     SHIPPED classifier path lib/map.js `HS.trackerSiteItem(site, frsRid)` ->
--     `HS.resolveMarker(item).typeKey === 'datacenter'`. It is proven equal to the real
--     classifier, record by record, over every distinct production input, by
--     test/fix28-datacenter-membership.test.mjs (§2a, 426/426, 0 disagreements).
--  3. GEOMETRY SOURCE. `geo.zcta_boundary` (TIGER/Line 2025, 2020 ZCTA delineation),
--     SRID 4269, typmod MULTIPOLYGON, GiST index `zcta_boundary_geom_gix`.
--  4. SPATIAL PREDICATE. `ST_Intersects(ST_SetSRID(ST_MakePoint(lng, lat), 4269), geom)` —
--     HomeSignal's accepted ZIP-membership predicate, boundary-INCLUSIVE.
--  5. MISSING GEOMETRY. A ZIP with no `geo.zcta_boundary` row is UNTESTABLE. It is never
--     called inside, never called outside, and never touched. That population is Fix 29.
--
-- FROZEN BASELINE, measured 2026-09-15 before any change (every number reproduced exactly):
--   ZIP pages: 12,722 · with a Data center Type dot: 687 · dots: 1,178
--   testable 996 = inside 360 + outside 636 · ZIP pages with >=1 outside: 361
--   max overshoot 13.054 mi · ZIP 20166: 15 / 4 inside / 11 outside
--   no usable boundary: 706 ZIP pages · of those with dots: 153 · their dots: 182
-- =====================================================================================

-- ── The classifier projection used by the audit (identical ladder to the one shipped as
--    public.map_site_is_datacenter_type; kept separate so the AUDIT does not read the code
--    under test through the same object it is auditing).
create or replace function public.fix28_baseline_is_dc(j jsonb) returns boolean
language sql immutable as $function$
select case
  when (j->>'registry_id') is not null then
    (coalesce(j->>'use_type','') ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
     or coalesce(j->>'layer','') ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm')
  when lower(btrim(coalesce(j->>'use_type',''))) = 'other project'
    or lower(btrim(coalesce(j->>'layer',''))) = 'other project' then false
  when (coalesce(j->>'use_type','') ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
     or coalesce(j->>'layer','') ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm') then true
  else (coalesce(j->>'label','') ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
        and not coalesce(j->>'label','') ~* 'data\s*cent(er|re)\s+(rd|road|st|street|ave|avenue|ln|lane|dr|drive|blvd|boulevard|way|pkwy|parkway|ct|court|cir|circle)\y'
        and not (coalesce(j->>'label','') ~* '\y(serving|serves|to\s+serve|in\s+support\s+of|supporting|feeding|adjacent\s+to|next\s+to|abutting|associated\s+with)\y[^.;]{0,60}?data\s*cent'
             and coalesce(j->>'label','') ~* '\ysubstation\y|\yswitchyard\y|switching\s+station\y|\ytransmission\y|\y[0-9]{2,3}\s*kv\y|\ypower\s*line\y|\ytransmission\s+line\y|\ysolar\s+(farm|array|field)\y|photovoltaic|\ybattery\s+(energy\s+)?storage\y|\ybess\y|\ywind\s+(farm|turbine)\y|\ypower\s+plant\y|\ygenerating\s+station\y|\ycell\s+tower\y|\ymonopole\y|\yantenna\y')
       )
end $function$;

-- ── AUDIT 1 — the national measurement. Shard the `zip like` predicate if the statement
--    timeout bites; the aggregate is the same either way.
with dots as (
  select d.zip, e.value as x, b.geom
    from public.development_reports d
    left join geo.zcta_boundary b on b.zcta5 = d.zip,
         lateral jsonb_array_elements(d.sites) e
   where jsonb_typeof(d.sites) = 'array'
     and e.value->>'scope' = 'point'
     -- A deliberately WIDE pre-filter. It only has to be a SUPERSET of what the classifier
     -- can call a data centre; the classifier below is what decides. Proven complete: the
     -- wide form ('data|hyperscal|server') selects the same 1,178 dots.
     and (coalesce(e.value->>'use_type','') || ' ' || coalesce(e.value->>'layer','') || ' ' ||
          coalesce(e.value->>'label','')  || ' ' || coalesce(e.value->>'type_raw','') || ' ' ||
          coalesce(e.value->>'type','')   || ' ' || coalesce(e.value->>'category',''))
         ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
     and public.fix28_baseline_is_dc(e.value)
),
j as (
  select zip,
         geom is not null as testable,
         case when geom is not null
              then ST_Intersects(ST_SetSRID(ST_MakePoint((x->>'lng')::float8, (x->>'lat')::float8), 4269), geom) end as inside,
         case when geom is not null
              then round((ST_Distance(ST_SetSRID(ST_MakePoint((x->>'lng')::float8, (x->>'lat')::float8), 4269)::geography,
                                      geom::geography) / 1609.344)::numeric, 4) end as miles_outside
    from dots
)
select count(*)                                                   as datacenter_dots,
       count(distinct zip)                                        as zip_pages_with_dots,
       count(*) filter (where testable)                           as testable_points,
       count(*) filter (where testable and inside)                as inside_points,
       count(*) filter (where testable and not inside)            as outside_points,
       count(distinct zip) filter (where testable and not inside) as zip_pages_with_outside,
       max(miles_outside)                                         as max_overshoot_mi,
       count(*) filter (where not testable)                       as untestable_points_FIX29,
       count(distinct zip) filter (where not testable)            as untestable_zip_pages_FIX29
from j;
-- BEFORE: 1178 · 687 · 996 · 360 · 636 · 361 · 13.0540 · 182 · 153
-- AFTER:   542 · 371 · 360 · 360 ·   0 ·   0 ·  0.0000 · 182 · 153

-- ── AUDIT 2 — ZIP 20166, the golden identity regression.
with b as (select geom from geo.zcta_boundary where zcta5 = '20166'),
d as (select e.value as x from public.development_reports r, lateral jsonb_array_elements(r.sites) e where r.zip = '20166')
select count(*) filter (where public.fix28_baseline_is_dc(x) and x->>'scope' = 'point') as dots,
       count(*) filter (where public.fix28_baseline_is_dc(x) and x->>'scope' = 'point'
                          and ST_Intersects(ST_SetSRID(ST_MakePoint((x->>'lng')::float8,(x->>'lat')::float8),4269), b.geom)) as inside,
       count(*) filter (where public.fix28_baseline_is_dc(x) and x->>'scope' = 'point'
                          and not ST_Intersects(ST_SetSRID(ST_MakePoint((x->>'lng')::float8,(x->>'lat')::float8),4269), b.geom)) as outside
from d, b;
-- BEFORE: 15 / 4 / 11      AFTER: 5 / 5 / 0   (the source gained one qualifying record, inside,
--                                              between the freeze and the post-fix engine run)

-- ── AUDIT 3 — the FIX 29 firewall. These three numbers must not move.
select (select count(*) from public.canonical_zip_registry c
         where not exists (select 1 from geo.zcta_boundary b where b.zcta5 = c.zip)) as zip_pages_without_usable_boundary,
       (select count(distinct d.zip) from public.development_reports d, lateral jsonb_array_elements(d.sites) e
         where not exists (select 1 from geo.zcta_boundary b where b.zcta5 = d.zip)
           and e.value->>'scope' = 'point' and public.fix28_baseline_is_dc(e.value)) as of_those_with_datacenter_dots,
       (select count(*) from public.development_reports d, lateral jsonb_array_elements(d.sites) e
         where not exists (select 1 from geo.zcta_boundary b where b.zcta5 = d.zip)
           and e.value->>'scope' = 'point' and public.fix28_baseline_is_dc(e.value)) as their_datacenter_dots;
-- BEFORE: 706 / 153 / 182      AFTER: 706 / 153 / 182

-- ── AUDIT 4 — the OVER-REACH control. Fix 28 is scoped to Data center Type, so the same
--    ZIP pages must still carry plenty of NON-data-centre points outside their own boundary.
--    A zero here would mean the gate reached past its scope. (It is also the honest
--    measurement that this defect class exists for every other Type - that is NOT Fix 28.)
select count(*) filter (where not public.fix28_baseline_is_dc(e.value)
                          and not ST_Intersects(ST_SetSRID(ST_MakePoint((e.value->>'lng')::float8,(e.value->>'lat')::float8),4269), b.geom))
         as non_datacenter_points_still_outside
from public.development_reports d
join geo.zcta_boundary b on b.zcta5 = d.zip,
     lateral jsonb_array_elements(d.sites) e
where d.zip like '0%' and e.value->>'scope' = 'point' and nullif(e.value->>'lat','') is not null;
-- AFTER: 31,254 on the shard-0 affected ZIPs alone - untouched, by design.

-- ── AUDIT 5 — the counts invariant scripts/lib/verify-dev-helpers.mjs asserts live.
select count(*) as affected_zips,
       count(*) filter (where coalesce((d.counts->>'facilities')::int,0)
                            <> (select count(*) from jsonb_array_elements(d.sites) e where e.value ? 'registry_id')) as facilities_mismatch
from public.development_reports d
where d.zip in (select zip from fix28.backfill_log);
-- AFTER: 361 / 0

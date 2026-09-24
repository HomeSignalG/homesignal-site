-- =====================================================================================
-- MAP 1 · THE ONE DATA-CENTRE PUBLICATION CONTRACT — DDL of record
--
-- public.map1_dc_zip_members(p_zip) is the ONLY data-centre read Map 1 makes, for every one
-- of the 12,722 ZIP pages. It answers ONE question: which data-centre records belong to ZIP X?
-- The answer never depends on which source first observed a record, and the page never
-- unions sources itself.
--
-- WHERE EACH ROW COMES FROM (publication_basis)
--   'canonical'          a canonical entity (Step 3A dc_canonical_entity) with canonical
--                        geography (Step 3B dc_entity_geography). Every source that reaches the
--                        canonical plane — Compute Atlas, Epoch AI, whatever is onboarded next —
--                        publishes through here with no change to this function or the page.
--   'legacy_osm_compat'  TRANSITIONAL. public.national_dc_records (1,824 OpenStreetMap rows, a
--                        one-time load with no recurring acquisition) is not yet a dc_source.
--                        It is served behind this boundary so existing OSM markers do not
--                        disappear. RETIREMENT CONDITION: OpenStreetMap onboarded as a dc_source
--                        through dc_evidence_writer with a recurring acquisition, after which its
--                        records arrive as 'canonical' and this CTE is deleted. Nothing outside
--                        this function may read national_dc_records for Map 1.
--
-- WHAT PUBLISHES (canonical)
--   classification = CONFIRMED_DC only. DC_CANDIDATE is withheld: Step 3A classifies a record
--     as a candidate exactly when the publisher calls it rumored or its own fields disagree,
--     and "a rumored record does not become a HomeSignal certainty" (dc-step3a-canonical-
--     identity.sql). NON_DC and CLASSIFICATION_UNRESOLVED never publish.
--   geography_status = RESOLVED and geometry_type = POINT only. GEOGRAPHY_UNRESOLVED has no
--     geometry to publish and is never given one; NOT_A_SITE is a multi-site aggregate and is
--     never drawn as a point.
--   lifecycle: the ONE status map below. A status outside it (cancelled, shelved, blocked,
--     unknown, absent) does not publish — a cancelled data centre drawn as a data centre is a
--     false statement. The same map governs the compatibility rows.
--   a record URL: the first http(s) evidence URL the publisher cites for the record. No URL,
--     no pin (the page's anti-fabrication gate needs something to open).
--
-- MEMBERSHIP: geo.zip_point_membership_in(geo.zip_membership_boundary(zip), lat, lng) — the one
--   point-in-ZIP authority (docs/zip-membership-canonical.sql). Candidates are retrieved by the
--   ZCTA polygon's bounding box, which contains every member, so no radius can lose one. A ZIP
--   with no usable boundary returns no rows (not_measured is never replaced by a centroid,
--   radius, nearest ZIP or neighbouring boundary). No distance is returned.
--
-- ONE MARKER PER FACILITY ACROSS THE TWO POPULATIONS: a compatibility row is suppressed when a
--   published canonical entity sits at IDENTICAL coordinates (<= 1 m) and the pairing is
--   one-to-one (exactly one published entity within 1 m of the OSM point and exactly one
--   eligible OSM point within 1 m of the entity). Measured 2026-09-22: 263 such pairs, every
--   sampled one the same facility (Compute Atlas copied OSM's point). Anything looser is NOT a
--   match: "Vantage WA12" and "Vantage WA13" are 166 m apart with one operator and are two
--   buildings. An ambiguous pair keeps both markers — dropping existing coverage is the worse
--   failure during a migration.
--
-- This function reads the private dc_* planes as SECURITY DEFINER and exposes only the columns
-- below. No resident role holds any grant on a dc_* relation.
-- =====================================================================================

begin;

create or replace function public.map1_dc_zip_members(p_zip text)
returns table(source_key text, source_name text, source_url text, source_licence text,
              project_name text, developer_or_operator text, raw_status text,
              normalized_status text, map_status text, project_type text,
              lat double precision, lng double precision, location_text text,
              location_precision text, distance_mi numeric, last_seen_at timestamptz,
              has_more boolean, zip_membership text, canonical_entity_id uuid,
              publication_basis text, quality_flags text[], source_count integer)
language sql
stable
security definer
set search_path to 'public', 'geo', 'pg_temp'
as $function$
  with
  -- THE ONE LIFECYCLE MAP: source lifecycle word -> Map 1 permit-vocabulary pin status.
  lifecycle(v, map_status) as (values
    ('operational',        'Operating'),
    ('under_construction', 'Approved'),
    ('permitted',          'Approved'),
    ('proposed',           'Proposed')),
  g as (select geo.zip_membership_boundary(p_zip) as geom),
  bb as (select geom, ST_XMin(geom) x0, ST_XMax(geom) x1, ST_YMin(geom) y0, ST_YMax(geom) y1
           from g where geom is not null),
  lim as (select 1000::int as n),
  -- every PUBLISHABLE canonical entity in the box (1e-4 deg margin so an identical-coordinate
  -- compatibility pairing on the box edge is still seen from both sides)
  canon as (
    select 'dc:' || e.canonical_entity_id::text as source_key,
           s.publisher as source_name, u.url as source_url, s.licence as source_licence,
           o.source_native_name as project_name,
           nullif(btrim(o.source_native_operator), '') as developer_or_operator,
           o.source_native_status as raw_status, o.source_native_status as normalized_status,
           lc.map_status, 'datacenter'::text as project_type, ge.lat, ge.lng,
           nullif(concat_ws(', ', o.source_native_address->>'street',
                                  o.source_native_address->>'city',
                                  o.source_native_address->>'state'), '') as location_text,
           case when ge.publisher_precision = 'exact' then 'precise_location'
                else 'approximate_campus_area' end as location_precision,
           o.observed_at as last_seen_at, e.canonical_entity_id,
           'canonical'::text as publication_basis, ge.quality_flags, e.source_count,
           ge.positional_uncertainty_m
      from bb
      join public.dc_entity_geography ge
        on ge.lat between bb.y0 - 1e-4 and bb.y1 + 1e-4
       and ge.lng between bb.x0 - 1e-4 and bb.x1 + 1e-4
      join public.dc_canonical_entity e on e.canonical_entity_id = ge.canonical_entity_id
      -- THE DESCRIPTOR (2026-09-24): name, operator, lifecycle, address and citation come from
      -- the entity's CURRENT observation that states a displayable lifecycle -- the location
      -- authority itself when it does (every single-source entity: behaviour unchanged), else
      -- another observation of the same entity. Location evidence and descriptive evidence are
      -- different facts; an entity placed by a derived address point (whose source states no
      -- lifecycle) is described by the source that does. Source-agnostic: no source is named.
      cross join lateral (
        select x.*
          from public.dc_entity_observation eo2
          join public.dc_current_observation cx
            on cx.home_signal_observation_id = eo2.home_signal_observation_id
          join public.dc_source_observation x
            on x.home_signal_observation_id = eo2.home_signal_observation_id
          join lifecycle lx on lx.v = x.source_native_status
         where eo2.canonical_entity_id = e.canonical_entity_id
         order by (x.home_signal_observation_id = ge.authority_observation_id) desc,
                  x.observed_at desc, x.home_signal_observation_id
         limit 1) o
      join public.dc_source s on s.source_key = o.source_key
      join lifecycle lc on lc.v = o.source_native_status
      cross join lateral (
        select x->>'url' as url
          from jsonb_array_elements(case when jsonb_typeof(o.raw_payload->'sources') = 'array'
                                         then o.raw_payload->'sources' else '[]'::jsonb end)
               with ordinality t(x, i)
         where x->>'url' ~ '^https?://'
         order by i limit 1) u
     where e.superseded_by is null
       and e.classification = 'CONFIRMED_DC'
       and ge.geography_status = 'RESOLVED'
       and ge.geometry_type = 'POINT'),
  -- TRANSITIONAL compatibility population (see header for its retirement condition)
  osm as (
    select r.source_key, r.source_name, r.source_url,
           'ODbL, © OpenStreetMap contributors'::text as source_licence,
           r.project_name, r.developer_or_operator, r.raw_status, r.normalized_status,
           lc.map_status, r.project_type, r.lat, r.lng, r.location_text, r.location_precision,
           r.last_seen_at, null::uuid as canonical_entity_id,
           'legacy_osm_compat'::text as publication_basis, '{}'::text[] as quality_flags,
           1 as source_count, null::double precision as positional_uncertainty_m
      from bb
      join public.national_dc_records r
        on r.lat between bb.y0 - 1e-4 and bb.y1 + 1e-4
       and r.lng between bb.x0 - 1e-4 and bb.x1 + 1e-4
      join lifecycle lc on lc.v = r.normalized_status
     where r.map_eligible),
  osm_kept as (
    select o.* from osm o
     where not (
       (select count(*) from canon c
         where ST_DistanceSphere(ST_MakePoint(c.lng, c.lat), ST_MakePoint(o.lng, o.lat)) <= 1) = 1
       and (select count(*) from osm o2, canon c
             where ST_DistanceSphere(ST_MakePoint(c.lng, c.lat), ST_MakePoint(o.lng, o.lat)) <= 1
               and ST_DistanceSphere(ST_MakePoint(c.lng, c.lat), ST_MakePoint(o2.lng, o2.lat)) <= 1) = 1)),
  pool as (select * from canon union all select * from osm_kept),
  judged as (
    select p.*, geo.zip_point_membership_in(bb.geom, p.lat, p.lng) as verdict,
           -- EDGE AMBIGUITY FAILS CLOSED (2026-09-24). Membership is boundary-inclusive, so a
           -- point exactly on an edge two ZCTAs share is a member of BOTH, and would publish on
           -- two ZIP pages. It is withheld instead: never the nearest, never an arbitrary pick.
           -- Measured when written: 0 of 3,497 candidate points touch more than one ZCTA.
           -- UNCERTAIN POINTS (2026-09-24): a point that carries a positional uncertainty (a
           -- derived address point: calibrated max error 2,000 m) is a member only when EVERY
           -- position it could truly occupy is in this ZCTA -- the whole disk within one ZCTA.
           -- Road centrelines are ZCTA edges: 5 of 35 geocoded Epoch addresses sat 6-26 m from
           -- one. The same rule as the edge guard above, with a radius; NULL radius = unchanged.
           case when p.positional_uncertainty_m is null then
             (select count(*) from geo.zcta_boundary z
               where z.geom is not null
                 and ST_Intersects(z.geom, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4269)))
           else
             (select count(*) from geo.zcta_boundary z
               where z.geom is not null
                 and z.geom && ST_Expand(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4269),
                                         p.positional_uncertainty_m / 25000.0)
                 and ST_DWithin(z.geom::geography,
                                ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4269)::geography,
                                p.positional_uncertainty_m))
           end as zcta_hits
      from pool p, bb),
  members as (
    select * from judged where verdict = 'member' and zcta_hits <= 1
     order by source_key collate "C"
     limit (select n + 1 from lim)),
  counted as (select count(*) over () as total, members.* from members)
  select c.source_key, c.source_name, c.source_url, c.source_licence, c.project_name,
         c.developer_or_operator, c.raw_status, c.normalized_status, c.map_status,
         c.project_type, c.lat, c.lng, c.location_text, c.location_precision,
         null::numeric as distance_mi, c.last_seen_at,
         (c.total > (select n from lim)) as has_more, c.verdict as zip_membership,
         c.canonical_entity_id, c.publication_basis, c.quality_flags, c.source_count
    from counted c
   order by c.source_key collate "C"
   limit (select n from lim);
$function$;

revoke all on function public.map1_dc_zip_members(text) from public;
grant execute on function public.map1_dc_zip_members(text) to anon, authenticated, service_role;

comment on function public.map1_dc_zip_members(text) is
  'THE one Map 1 data-centre read for every ZIP page: CONFIRMED_DC canonical entities with '
  'RESOLVED point geography and a displayable lifecycle, plus the transitional legacy OSM '
  'compatibility population, each admitted only on geo.zip_point_membership_in = member. '
  'docs/map1-dc-publication.sql.';

commit;

-- =====================================================================================
-- ROLLBACK: point homesignalmap.html / lib/data.js back at national_dc_zip_members, then
--   drop function public.map1_dc_zip_members(text);
-- =====================================================================================

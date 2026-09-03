-- Unit A3 — the authoritative MARKER relation. DDL of record.
-- Applied 2026-09-03 by scripts/n5_a3_markers.py (MARKER_MODE=build), dispatched through
-- .github/workflows/phase2-b1-zcta.yml mode n5-a3-marker.
--
-- SHADOW ONLY. Not referenced by any production read path.
-- Production preservation control: public.app_projects_for_zip md5 = ec1b01ae4485ad2c59b9f946c9d565b6.
--
-- MEMBERSHIP and MARKER are separate questions and stay separate relations:
--   geo.zip_authoritative_membership (zcta5, source_key)  "does this project belong on this page"
--   geo.zip_authoritative_marker     (zcta5, source_key, marker_seq)  "where inside the ZIP"
-- Marker multiplicity must never duplicate a project card. Membership grain is UNCHANGED by A3.

create table if not exists geo.zip_authoritative_marker (
  zcta5       char(5) not null,
  source_key  text    not null,
  marker_seq  int     not null,
  lat         double precision not null,
  lng         double precision not null,
  marker_rule text    not null,
  family      text,
  dim         smallint,
  run_id      text    not null,
  computed_at timestamptz not null default now(),
  primary key (zcta5, source_key, marker_seq)
);
alter table geo.zip_authoritative_marker enable row level security;
revoke all on geo.zip_authoritative_marker from public;
-- Verified: geo has no USAGE for anon/authenticated/PUBLIC, no table grants,
-- RLS enabled, relacl {postgres=arwdDxtm/postgres}. Unreachable from a browser by construction.

-- THE ALGORITHM, by geometry family. Every marker is derived from AUTHORITATIVE geometry
-- (geo.n5_geom, outcome=1) intersected with the ZIP's TIGER boundary. No centroid/radius
-- approximation, no nearest-ZIP, no legacy app_projects coordinate anywhere in the derivation.
--
--   LINE      ST_LineMerge the clipped linework FIRST. The raw clip is publisher segmentation:
--             51,219 components, p50 length 20.6 m, 94.7% under 250 m. Merging is lossless —
--             6,581.0 km before and after — and collapses them to 14,538 real components.
--             Keep components >= 250 m, or the single longest if none qualifies (so every
--             membership keeps at least one marker). On each kept component place
--             ceil(len/1000) evenly spaced interior points at fractions (i+0.5)/n, so the gap
--             ALONG a component never exceeds 1,000 m and every marker lies ON the line.
--
--   POLYGON   one ST_PointOnSurface per component >= 1,000 m2, or the largest if none
--             qualifies. PointOnSurface is inside the ring, unlike a centroid.
--             One marker per membership was MEASURED inadequate: of 659 multi-component
--             polygon memberships, 584 have parts more than 1 km apart, 288 more than 5 km,
--             max spread 13.7 km, and only 236 have a component holding >=90% of the area.
--             The 1,000 m2 floor discards 0.0004% of total clipped area (pure clip slivers).
--
--   POINT     the authoritative point itself. MULTIPOINT does not occur — measured 0 across
--             all 1,875 in-scope source_keys (families: 1,440 MultiLineString + 434
--             MultiPolygon + 1 Point = 1,875 exactly).
--
-- DETERMINISM: marker_seq = row_number() over (partition by zcta5, source_key
--   order by dim desc, measure desc, ST_AsBinary(g) asc, i asc). ST_AsBinary breaks ties
--   between equal-measure components, so ordering does not depend on scan order.

-- ROLLBACK (production is untouched by this table either way):
--   drop table if exists geo.zip_authoritative_marker;

-- Supporting measurement tables written by the same driver (primitives, no rule applied):
--   geo.n5_a3_clip_component    one row per clipped component  (56,674 rows; equals the
--                               sum of n_components in geo.n5_a3_clip_stats exactly)
--   geo.n5_a3_merged_component  one row per ST_LineMerge'd line component (14,538 rows)
--   geo.n5_a3_bench             per-(ZIP, pass) benchmark timings

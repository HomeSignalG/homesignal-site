# Map Pipeline Remediation — design decision & architecture

> Implementation of the approved production architecture for making truthful,
> defensible map markers out of Government Notices and area-scope Development.
> Companion migration: `docs/app-map-geocode-migration.sql` (parked DDL, applied
> manually — NOT auto-deployed). Ingest-side geocoding mechanism lives in
> `homesignal-ingest` (`adapters/development_geo.py`, `scripts/backfill_*_geo.py`).

---

## 0. The one-line summary

The frontend is correct and stays untouched. Markers are missing because
**real geographic coordinates never reach the materialized rows** — the
materializer (`app_refresh_zip`) writes Government Notices and area-scope
Development into `app_changes`/`app_projects` with **NULL** (or **synthetic
ZIP-centroid**) coordinates. The fix carries **genuine, geocoded, geofenced**
coordinates into those rows — and *only* those with a defensible location —
so the existing frontend plots them automatically.

---

## 1. Verified facts (evidence attached — the audit was right)

All counts are live from project `qwnnmljucajnexpxdgxr`, 2026-07-22.

| Fact | Query result |
|---|---|
| `app_changes` `Government & civic` rows | **6,737**, `with_coords = 0` |
| `app_changes` `Planning & zoning` rows | **1,941**, `with_coords = 0` |
| `app_projects` (development / facility) | 46,016 / 88,432 — **all** with coords |
| `alerts` `government_notice` rows | 314 (`geo_scope='address'` = 0; countywide 50; NULL 264) |
| area-scope development in `development_reports.sites` | **52,262** — all sourced, **all carry lat/lng equal to the ZIP centroid** (373 distinct points = 1 per ZIP) |
| … of those, with a real street address (house# + street token) | **46,518** (empty/`"0"` = 1,269; non-numeric = 154) |

**The frontend coordinate gate is load-bearing and correct** (`maps.html`):

```js
// line 316-318 — markers = changes(non-quiet) + projects, WITH coords only
var all = changes.filter(x => !x.quiet).concat(projects)
  .filter(x => x.lat && x.lng);
// line 443 — changes WITHOUT coords are LISTED (sidebar), never plotted
var area = changes.filter(x => !x.quiet && !(x.lat && x.lng));
```

So a `app_changes` row **with** valid coords becomes a map marker with **zero
frontend change**; one without coords becomes a sidebar/timeline item. This is
exactly the behavior we build on. **Do not weaken this filter** (Finding 1).

---

## 2. THE REQUIRED DESIGN DECISION — when a notice/record may become a marker

Before materializing, every Government Notice and every area-scope Development
record is classified by the *strongest geographic reference it actually carries*:

| Geographic reference present | Becomes a marker? | Where it lands |
|---|---|---|
| **Source point geometry** (per-parcel lat/lng from the publisher) | ✅ yes | already a `point` record → `app_projects` (unchanged) |
| **Street address** (house number + street-type token) that **geocodes** and passes the **geofence** | ✅ yes | geocoded → genuine point → marker |
| **Parcel / APN** resolvable to a parcel polygon (`resolved_project_parcels`) | ✅ yes (future) | parcel centroid → marker |
| **Jurisdiction / county / city name only** | ❌ no | `app_changes`, NULL coords → **sidebar / timeline** |
| **ZIP only** (or the synthetic ZIP centroid the engine stamped) | ❌ no | `app_changes`, NULL coords → **sidebar / timeline** |
| **No geographic reference** | ❌ no | `app_changes`, NULL coords → **sidebar / timeline** |

**The geofence (reused from engine v20 — `GEOCODE_FENCE_MI = 25`).** A geocoded
point is trusted only when **(a)** the geocoder's matched-address ZIP equals the
record's own filed ZIP **and (b)** the point is within `GEOCODE_FENCE_MI` of the
report's ZIP centroid. A miss NULLs the coordinate (the record still lists in the
sidebar) — never a fabricated marker. Source-supplied point geometry is **never**
fenced.

**What we explicitly refuse** (Engineering Principles / Phase 2/3):
- We never plot the **ZIP / county / city centroid** to "make a marker appear."
  The 52,262 area-dev records already carry the ZIP centroid; we treat that
  coordinate as *absent*, because it is synthetic.
- We never invent, infer, default, or interpolate a coordinate.
- If uncertainty exceeds tolerance (geocode miss, out-of-fence, ZIP mismatch,
  garbage address), we **exclude the marker** and record the reason.

**Meetings are never converted to markers** (Finding 7). The meetings insert in
`app_refresh_zip` deliberately leaves coords NULL and stamps
`geo_exclusion_reason = 'meeting_timeline_by_design'`.

### 2.1 What the data actually says (verified 2026-07-22) — do not over-plot

- **Government Notices are jurisdiction-wide.** All 314 `alerts.government_notice`
  rows carry a `geographic_reference` that is a **jurisdiction name** ("Box Elder
  County, UT", "Tremonton, UT", "Pima County, AZ") — **0 are street addresses.**
  Their honest classification is *jurisdiction boundary → no marker*; they stay
  timeline/sidebar with reason `countywide`. The "6,737 not displayed" figure is
  therefore **correct behavior made observable**, not a marker backlog to force
  onto the map. The P1 carry-through still ships because it is the correct
  mechanism the moment an address-bearing notice arrives — and it labels every
  excluded one.
- **Development is the real, defensible marker gain.** Of 52,262 area-scope
  development records, **46,518 carry a genuine street address** (house# + street
  token). These geocode to real per-parcel points and become honest development
  markers — subject to the geofence. The synthetic ZIP-centroid coordinate the
  engine stamped on them is treated as absent and never plotted.

---

## 3. Architecture — where each piece runs

```
 ingest (GitHub Actions, has egress + service key)         DB (Supabase)                     frontend (static, UNCHANGED)
 ─────────────────────────────────────────────           ──────────────                    ────────────────────────────
 backfill_notice_geo.py   ── geocode + geofence ──▶  alerts.geo_lat/geo_lng/geo_scope
 backfill_development_geo.py ─ geocode + geofence ─▶  app_geocodes(source_key → lat/lng)
                                                        │
                                            app_refresh_zip(_zip)  ── carries genuine coords ──▶  app_changes.lat/lng
                                            (materializer, nightly    (+ geo_exclusion_reason)      app_projects.lat/lng
                                             pg_cron 'app-content-refresh')                                │
                                                                                        maps.html plots rows WITH coords,
                                                                                        lists rows WITHOUT coords (sidebar)
```

- **Geocoding is business logic → lives in the ingest/materialization pipeline**
  (Python, Actions egress). The DB materializer stays pure SQL and only *carries*
  coordinates that a geocoder already resolved and fenced.
- **`app_geocodes`** is the resolution store keyed by **`'<zip>|<UPPER(TRIM(address))>'`**.
  `record_url` is dataset-level for many sources (a Fort Worth ArcGIS MapServer URL
  is shared by every permit), so it is **not** a per-record key — the geocode is
  keyed by the address it actually resolves, and identical addresses (same parcel)
  correctly share one point. Idempotent upsert; RLS on, service-role only. Survives
  the materializer's nightly delete+reinsert because the materializer re-joins it
  every run. `source_ref` on the promoted `app_projects` row stays the official
  `record_url` (dataset-precision link) — anti-fabrication is preserved.
- **Notices** read their resolved point from `alerts.geo_lat/geo_lng`
  (`geo_scope='address'`); **development** reads it from `app_geocodes`. Two
  natural homes, one identical carry-through rule.

---

## 4. Observability (Phase 4)

- `app_changes.geo_exclusion_reason text` — a machine-readable reason on every
  row that stayed in the sidebar rather than the map. Reason vocabulary:
  `missing_coordinates`, `missing_address`, `no_geographic_reference`,
  `countywide`, `civic_jurisdiction_wide`, `meeting_timeline_by_design`,
  `not_point_materialized`, `geocode_no_match`, `geocode_zip_mismatch`,
  `geocode_out_of_fence`, `invalid_geometry`.
- `app_materialization_summary()` — returns, per layer
  (`government_notice` / `development` / `facility` / `meeting`):
  `records_processed`, `records_materialized`, `records_displayed` (mappable),
  `records_excluded`, and a `reason_counts` jsonb. The ingest backfill scripts
  print the same shape per run.

---

## 5. Rollout & rollback

**Rollout** (operator, after PR review — NOT part of this PR):
1. Apply `docs/app-map-geocode-migration.sql` (adds column + `app_geocodes` +
   new `app_refresh_zip` body + summary fn). Additive; readers null-check.
2. Run `backfill_notice_geo.py` (DRY_RUN=false) and
   `backfill_development_geo.py` (DRY_RUN=false) in Actions to populate coords.
3. `select public.app_refresh_all();` (or let the nightly pg_cron run) to
   re-materialize. New markers appear on the live site with no site deploy.

**Rollback**: re-apply the prior `app_refresh_zip` body from
`docs/app-content-materialize.sql` history. The added column and `app_geocodes`
table are additive and can remain (ignored). No frontend revert — the frontend
never changed.

---

## 6. Non-goals / preserved behavior (P0)

- Frontend map, coordinate filter, marker categories: **unchanged**.
- EPA FRS/ECHO facilities pipeline: **unchanged** (Finding 6).
- Meetings as timeline content: **unchanged** (Finding 7).
- Anti-fabrication invariants (`source_ref` required, no invented coords):
  **strengthened**, never relaxed.

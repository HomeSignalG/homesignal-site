# Map Pipeline Remediation — design decision & architecture

> Making truthful, defensible map markers out of Government Notices and area-scope
> Development — with **geometry resolved exactly once, in the engine's existing
> geocode infrastructure** (no new/duplicate geocoding).
>
> Site migration (this repo, parked, applied manually): `docs/app-map-observability-migration.sql`.
> Engine geometry resolution: `supabase/functions/get-address-report` (`resolveGeocode()`
> + the `geocodes` cache + the 25-mi geofence) — separate engine PR.

---

## 0. The one-line summary

The frontend is correct and stays untouched. Markers were missing because real
coordinates never reached the materialized rows. The fix has two decoupled halves,
each on the target architecture:

1. **Development** — resolved **once, in the engine** (`resolveGeocode()` + the
   `geocodes` cache + geofence). Address-bearing records the engine resolves arrive
   as `scope='point'` with real coords and flow through the **unchanged** point-dev
   insert. **No new table, no second geocoder.**
2. **Government Notices** — the materializer carries the notice's **existing**
   geocoded point (`alerts.geo_lat/geo_lng`, from the ingest `notice_geo` path) into
   `app_changes` **only** when `geo_scope='address'`. Everything else stays
   sidebar/timeline with a machine-readable exclusion reason.

The original draft introduced a parallel `app_geocodes` table + a second Python
geocoder (`development_geo.py`). **Both were removed** — the engine already owns a
production-quality, write-once, quality-aware geocode cache; duplicating it was the
architecture we agreed not to ship.

---

## 1. Verified facts (evidence attached)

Live from project `qwnnmljucajnexpxdgxr`, 2026-07-22.

| Fact | Result |
|---|---|
| `app_changes` `Government & civic` / `Planning & zoning` | 6,737 / 1,941 rows — **0 with coords** |
| `app_projects` development / facility | 46,016 / 88,432 — **all** with coords |
| `alerts` `government_notice` | 314 rows; `geo_scope='address'` = **0** (all `geographic_reference` are jurisdiction names — "Box Elder County, UT", "Pima County, AZ") |
| area-scope development in `development_reports.sites` | 52,262 records, **all carrying the ZIP centroid** (synthetic); 46,518 have a street address |

**The frontend coordinate gate is load-bearing and correct** (`maps.html:316-318` plots
`changes+projects` with coords; `:443` lists coordinate-less changes in the sidebar).
A row **with** real coords becomes a marker with **zero** frontend change. Do not weaken it (Finding 1).

**The engine already geocodes.** Source connectors (`socrata`/`arcgis`/`ckan`/`csv`/
`carto`/`tabs`) call `resolveGeocode()` + apply the geofence (`index.ts:657-724`). The
`geocodes` table + the rooftop→parcel→interpolated ladder + never-downgrade guard +
`needs_review` flagging already exist (`geocode-cache.ts`, `docs/geocodes-setup.sql`).

---

## 2. THE REQUIRED DESIGN DECISION — when a record may become a marker

| Geographic reference present | Marker? | Where it lands |
|---|---|---|
| **Source point geometry** | ✅ | `app_projects` (unchanged) |
| **Street address** that geocodes + clears the geofence | ✅ | engine resolves → `scope='point'` → `app_projects` |
| **Parcel / APN** (future: `resolved_project_parcels`) | ✅ | parcel centroid/polygon |
| **Jurisdiction / county / city / ZIP only** | ❌ | `app_changes`, NULL coords → sidebar/timeline |
| **No geographic reference** | ❌ | `app_changes`, NULL coords → sidebar/timeline |

**The geofence (engine, `GEOCODE_FENCE_MI = 25`)**: a geocoded point is trusted only
when the matched-address ZIP equals the filed ZIP **and** it sits within 25 mi of the
report centroid; a miss NULLs the coordinate (record still lists). Source geometry is
never fenced. **We never plot a ZIP/county/city centroid to make a marker appear**, and
never invent, infer, default, or interpolate a coordinate.

**Meetings are never markers** (Finding 7): the meetings insert leaves coords NULL and
stamps `meeting_timeline_by_design`.

### 2.1 What the data says today (do not over-plot)
- **Government Notices are jurisdiction-wide** — all 314 carry a jurisdiction name, 0
  street addresses. They correctly stay timeline/sidebar; the P1 carry-through is the
  correct *mechanism* the moment an address-bearing notice arrives, and it labels every
  excluded one (`countywide` / `no_geographic_reference`).
- **Development is the real marker gain**, and it is delivered by the **engine** — an
  address-bearing development record that clears the geofence renders as a point through
  the unchanged materializer. Records the engine cannot place stay sidebar (`not_point_materialized`).

---

## 3. Architecture — geometry resolved exactly once

```
 engine (get-address-report edge fn)                DB (Supabase)                 frontend (static, UNCHANGED)
 ──────────────────────────────────                ──────────────                ────────────────────────────
 source record has an address ─▶ resolveGeocode()  development_reports.sites
   + geocodes cache + 25-mi geofence  ──────────▶    scope='point' + real lat/lng
                                                        │
 ingest notice_geo ─▶ alerts.geo_lat/geo_lng (address) │
                                                        ▼
                                          app_refresh_zip(_zip)  ── COPIES geometry ──▶ app_projects.lat/lng
                                          (materializer; never geocodes)                app_changes.lat/lng
                                             + geo_exclusion_reason                          │
                                                                             maps.html plots rows WITH coords,
                                                                             lists rows WITHOUT coords (sidebar)
```

- **One geocoder** (the engine's `resolveGeocode()` + `geocodes` cache). Notices reuse
  the ingest `notice_geo` path that already populates `alerts.geo_lat`. The materializer
  **only copies** geometry — it never resolves.
- **No `app_geocodes`, no `development_geo.py`, no duplicate cache.**

---

## 4. Observability (Phase 4)
- `app_changes.geo_exclusion_reason` on every sidebar row: `countywide`,
  `no_geographic_reference`, `civic_jurisdiction_wide`, `meeting_timeline_by_design`,
  `not_point_materialized`.
- `app_materialization_summary()` — per layer: processed / materialized / displayed
  (mappable) / excluded + reason counts.

---

## 5. Rollout & rollback
**Rollout** (operator, after review):
1. Apply `docs/app-map-observability-migration.sql` (adds the column, the reason-stamped
   `app_refresh_zip`, and the summary fn). No `app_geocodes`.
2. Deploy the engine geometry-resolution change (separate PR) via the deploy workflow;
   re-cache a representative ZIP set (the nightly `dev_refresh` also does this).
3. `select public.app_refresh_all();` — engine-resolved points flow into `app_projects`.

**Rollback**: re-apply the prior `app_refresh_zip` body from
`docs/app-content-materialize.sql` history; the added column + summary fn are additive.
No frontend revert; the engine change is guarded by `verify-geocodes` CI and reverts by
redeploying the prior bundle.

---

## 6. Non-goals / preserved behavior (P0)
Frontend map, coordinate filter, marker categories, EPA facilities (Finding 6), and
meetings-as-timeline (Finding 7) are **unchanged**. Anti-fabrication invariants are
strengthened, never relaxed. No second geocoding system is introduced.

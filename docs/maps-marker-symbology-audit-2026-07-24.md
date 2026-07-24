# Maps marker symbology — backbone audit & Focus-completeness fix (2026-07-24)

Scope: audit the shared Maps marker backbone across the whole production universe, find
the root cause of the reported "records fall back to generic purple regulated-facility
markers / incomplete symbols," and fix it in the **shared** render path (never a ZIP- or
mode-specific patch). Renderer-only per direction; no ingest classification changed.

---

## 1. The shared pipeline (traced)

One resolver owns every pin's identity: **`HS.resolveMarker(item)`** in `lib/map.js`.
Every render surface calls it — nothing derives shape/color independently:

| Surface | File | Marker call |
|---|---|---|
| Focus (schematic SVG) | `maps.html` `drawSchematic` → `HS.MapProvider.render` / `overlayRestPins` / `overlayFacilities` | `HS.resolveMarker` |
| Street/Satellite (MapLibre GL) | `maps.html` `drawGL` → `pinEl` / `addMarkers` / rest layer | `HS.resolveMarker` + `HS.restFeatureCollection` |
| Street/Satellite (Leaflet fallback) | `maps.html` `drawLF` → `addLfMarkers` | `HS.resolveMarker` |
| Dev-tracker ZIP page (2D/3D) | `homesignalmap.html` | `HS.resolveTrackerMarker` → `HS.resolveMarker` |
| Dashboard preview | `lib/map.js` `HS.buildLive` | `HS.resolveMarker` |

Classification precedence (renderer-agnostic, `lib/map.js`):
1. explicit regulated-facility flag (`_facility` or `record_kind === 'facility'`) → **purple square**
2. exact normalized type (`TYPE_EXACT`) → type shape
3. canonical `use_type`
4. `layer`/`category` (`LAYER_EXACT`)
5. ordered keyword rules
6. `Other project` → circle

Status → color: Proposed `#c47a1a` (orange), Approved `#3f7fb0` (blue), Operating/built
`#1f9d5c` (green), unknown → `#6b7f76` neutral "On file". Facility → `#6f42c1` purple.

## 2. What the production audit found (receipts)

Data is classified in the DB, not guessed by the renderer. Ground truth from
`app_projects` (project `qwnnmljucajnexpxdgxr`, pulled 2026-07-24):

```
record_kind  | total   | with registry_id | with facility_env
development  | 515,896 | 0                | 0
facility     | 217,968 | 217,968          | 84,856
```

The development/facility split is clean — **0 development rows carry a facility marker**.
The raw `development_reports` cache is likewise clean: `registry_id` appears only on
facility-type sites (Industrial/energy/logistics), never on development-type sites
(sampled 78617/84302/80202/60601/48226/98101 → `reg_with_devtype = 0`).

Replaying the **real** `HS.resolveMarker` over the complete production universe
(`scripts/audit-marker-symbology.mjs`, 733,864 records):

```
records                        : 733,864
correct status/facility color  : 733,864 (100.000%)
DEV records painted PURPLE      : 0
DEV records → circle "Other"    : 401,954 (77.9% of dev)
by shape : circle 401,954 · pentagon 77,488 · hexagon 35,824 · triangle 316 · diamond 314 · square 217,968
by color : blue 432,523 · green 69,981 · orange 13,387 · neutral 5 · purple 217,968
```

**Conclusion:** the marker-classification backbone is correct. There is **no**
misclassification — no non-regulated record receives the regulated icon, no wrong
status color. The literal "records fall back to purple regulated-facility markers"
defect does **not** reproduce against current production code + data. (The canonical
resolver was already unified in PR #331, 2026-07-20.)

## 3. The real defect — Focus dropped the uncapped remainder

Two facts explain the report:

1. **77.9% of development records carry a generic SOURCE type** (`Development` /
   `unclassified` / `Trades`), which honestly resolves to the neutral **circle "Other
   project"** — exactly the anti-fabrication fallback the spec requires ("unknown fields
   → honest neutral, not purple"). Improving this is a **source/ingest** classification
   matter, not a renderer bug; tracked separately, not changed here.

2. **Focus (the default mode) rendered only a partial set.** `drawSchematic` plotted the
   nearest-16 lettered pins plus a facility overlay, but — unlike the tile modes' uncapped
   "rest" layer (added by the Maps uncap merge, #367) — it plotted **none** of the
   development records beyond the letters. For a dense ZIP (e.g. 78617: 426 dev / 29 fac)
   the default view was ~12 colored development pins + ~24 purple facility squares: the
   development statuses were under-rendered and the map read as facility-dominated. The
   uncap merge fixed GL/Leaflet but left the schematic capped — that asymmetry is the
   defect.

## 4. The fix (shared backbone, renderer-only)

- **`lib/map.js` — `HS.plottedMarkerSet(visible, facs, restFacs, opts)`**: one pure
  authority for the COMPLETE set every surface plots (lettered + uncapped rest +
  unlettered facilities), each entry carrying its canonical `resolveMarker` shape/color.
  Plus `HS.markerHistogram()` — the parity backbone.
- **`maps.html` — `overlayRestPins()`**: Focus now plots the full uncapped remainder as
  canonical **type-shaped, status-colored** SVG pins (letterless; the A–P letters remain
  the nearest-16 emphasis). Facilities still resolve to purple squares via the same
  resolver. Focus now renders the same complete status/type symbology as the tile modes.
- CI hook `window.__HS_MAP.focusMarkerCount` / `focusExpected` exposes the plotted count
  for the live check (`focusMarkerCount === visibleTotal + all mappable facilities`).

No ZIP-specific condition, no source-specific exception, no Focus-only visual patch over
a wrong payload, no duplicated per-mode fix. Dedup, geo-validation, honest empty states,
and hover/click/sidebar/mobile behavior are untouched.

## 5. Regression protection

`test/maps-focus-completeness.test.mjs` (+ existing `test/map-markers.test.mjs`):
- Focus plots each record exactly once; total == visible + facs + restFacs (no drop/dup).
- **Symbol-count parity Focus ↔ tile complete set**, per status bucket AND per shape.
- Non-regulated records can never receive the regulated icon (purple **or** square).
- Regulated records keep the purple-square treatment.
- Missing/unknown fields → neutral circle, never purple.
- Street/Satellite/Focus resolve an identical symbol histogram (one resolver).
- Uncap invariance: 600 records → 600 plotted, and per-record shape/color unchanged.

## 6. Tracked follow-up (separate, not combined)

The 77.9% generic-`type` development records render honest neutral circles because their
SOURCE type is generic. Enriching that type in the ingest engine (so those records earn a
specific shape) is a **data-classification** change and is deliberately **not** bundled
here. Open a separate ingest task, with per-record receipts, only if evidence shows true
source-classification errors (the audit above shows the current values are honestly
generic, not wrong).

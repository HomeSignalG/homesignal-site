# Unit A3 — authoritative marker grain, marker relation, and one-pass read benchmark

Measured 2026-09-03. Every figure is paired with the query or run that produced it. Predictions
were recorded before each executable step; where one was refuted that is stated, not smoothed.

## 1. Pre-state

| item | value |
|---|---|
| `public.app_projects_for_zip` md5 | `ec1b01ae4485ad2c59b9f946c9d565b6` |
| `app_projects` indexes | 4 · set md5 `cb54ea1146439b94a0b329c42629255b` |
| `geo.zip_authoritative_membership` | 5,845 rows · md5 `ff09ed6d59b3a436bf0a8c9ca6f5eaa9` |
| `geo.maps_zip_geography_status` | 428 rows · md5 `3f452ffa40fc1f540af3270655ad7400` |
| `geo.n5_association` | 20,170 rows |
| `geo.n5_boundary_membership` | 18,184 rows |
| `geo.n5_geom` | 741,562 rows |
| `geo.n5_shard` | 544 rows |
| `public.development_reports` | 12,722 rows |
| free disk (VM) | 30 G · DB 7,100.7 MB + WAL 1,040.0 MB, 3,466.3 MB against the 11,607 budget |

The status fingerprint differs from the pre-A3 value because of the disclosed `cutover`
correction (346 rows), not because of A3 work.

## 2. Membership and markers are separate relations

Membership `(ZIP, source_key)` — unchanged by A3, 5,845 rows.
Marker `(ZIP, source_key, marker_seq)` — new shadow relation.
Marker multiplicity never duplicates a project card; see §7.

## 3. Line markers

`geo.n5_a3_clip_component` — 56,674 rows, one per clipped component. Control: this equals
`sum(n_components)` in `geo.n5_a3_clip_stats` **exactly** (56,674 = 56,674), all 5,845
memberships covered, 0 null points.

**The raw components are publisher segmentation, not project structure.** 51,219 line
components across 2,532 memberships, 6,581.0 km total:

| statistic | value |
|---|---:|
| p50 component length | **20.6 m** |
| p90 / p99 / max | 105.3 m / 3,136.4 m / 18,050 m |
| under 50 m | 39,663 (77.4%) |
| under 250 m | 48,514 (94.7%) |
| at or above 1 km | 1,264 (2.5%) |

So **strategy D (one marker per raw component) is disqualified** — 51,219 markers for 2,532
memberships. But a naive 250 m sliver floor is also wrong: those short components carry
1,536.3 km, 23.3% of all corridor length.

**`ST_LineMerge` resolves it, and losslessly.** 51,219 → **14,538** components, total length
6,581.0 km before and after — identical, which is the control proving the merge lost nothing.
Prediction of a 5–15x reduction was **refuted**: the measured reduction is 3.52x, and p50
merged component length is still only 44.5 m, so this geometry genuinely is many disconnected
pieces rather than one contiguous corridor.

Line memberships are bimodal: p50 spread **81.1 m** (a project touching the ZIP at one spot),
but 740 of 2,532 span more than 1 km, max 17,676 m. A fixed per-membership marker count would
be wrong at both ends; an interval rule adapts.

**Strategies evaluated on merged components** (floor L with a longest-component fallback,
interval D):

| rule | markers | % of corridor length represented |
|---|---:|---:|
| one per raw component | 51,219 | 100% (explosion — disqualified) |
| one per merged component | 14,538 | 100% |
| L=100, D=1000 | 10,057 | 96.08% |
| **L=250, D=1000  (CHOSEN)** | **8,754** | **93.03%** |
| L=500, D=1000 | 8,102 | 89.41% |
| L=250, D=2000 | 6,004 | — |
| L=250, D=500 | 14,629 | — |
| publisher points proven on the clip (strategy A) | 6,912 | not reproducible from geometry |

Strategy A is disqualified on reproducibility: it depends on legacy publisher placement, which
the authoritative product must not consume. The chosen rule bounds the gap ALONG any kept
component at 1,000 m, keeps every membership at >= 1 marker, and is generated purely from
authoritative geometry.

## 4. Polygon markers — one per membership is NOT adequate

3,312 polygon memberships, 5,454 components, 659 multi-component (max 106 parts).

| statistic | value |
|---|---:|
| multi-component memberships with parts > 1 km apart | **584 of 659 (88.6%)** |
| with parts > 5 km apart | 288 |
| p50 / p95 / max spread | 4,217 m / 10,634.8 m / 13,705.4 m |
| with a component holding >= 90% of area | 236 of 659 |
| with none holding 50% | 151 of 659 |

A single `ST_PointOnSurface` would hide separate project areas kilometres away. **Rule: one
marker per component >= 1,000 m2** (largest if none qualifies) → **4,466 markers**. That floor
drops 1,272 of 5,454 components carrying **0.0004%** of total area — pure clip slivers.

⚠️ **A wrong query was caught here on arithmetic, and is recorded rather than quietly fixed.**
A first attempt cross-joined each component against every sibling, so `count(*)` returned
ncomp² and `sum(area)` counted each component ncomp times. It reported "all 659 below 0.50
dominance", which is impossible — with 2 components `max/total` is >= 0.5 by definition. The
spread figures (a max over pairs) were unaffected; dominance was recomputed separately.

An earlier attempt also returned a **wrong-filter zero** (`family='polygon'`; the stored literal
is `'ST_MultiPolygon'`). Caught by the control that 3,312/659/106 must reproduce the prior pass.

## 5. Point / multipoint

**MULTIPOINT does not occur.** Measured across all 1,875 in-scope source_keys in `geo.n5_geom`
(`outcome=1`): ST_MultiLineString 7,610 features / 1,440 keys · ST_MultiPolygon 434 / 434 ·
ST_Point 1 / 1. Control: 1,440 + 434 + 1 = **1,875**, exactly the distinct source_key count.
The single POINT membership preserves its authoritative point. Nothing is collapsed to a
minimum X/Y, and no MULTIPOINT case needs a rule.

## 6. The algorithm

See `docs/n5-unit-a3-marker-relation.sql` for the DDL of record and the rule in full. Summary:
line → `ST_LineMerge`, keep components >= 250 m (or the longest), place `ceil(len/1000)` evenly
spaced interior points; polygon → one `ST_PointOnSurface` per component >= 1,000 m2 (or the
largest); point → the authoritative point. `marker_seq` is ordered
`dim desc, measure desc, ST_AsBinary(g) asc, i asc` — `ST_AsBinary` breaks ties between
equal-measure components so ordering never depends on scan order.

Every marker derives from `geo.n5_geom` (outcome=1) intersected with the ZIP's TIGER boundary.
No centroid/radius approximation, no nearest-ZIP, no legacy `app_projects` coordinate.

## 7. Project/card grain — FRONTEND CONTRACT BLOCKER, confirmed

The card grain stays one project per `(ZIP, source_key)`. The current frontend cannot carry
more markers than cards:

- `maps.html:1121-1141` — each RPC row is pushed into `plotted` and card clicks are indexed by
  that array position.
- `maps.html:686` — `items.map(function (it, i)`, one card per row.
- `lib/map.js:959` — `items.forEach(... new maplibregl.Marker(...))`, one marker per item, and
  `it.lat` / `it.lng` are read off the row as a **single scalar pair**. There is no per-row
  array of marker positions.

Answers to the three questions asked: each row creates both a card and a marker — **yes**;
multiple markers without duplicate cards — **no**, not without a frontend change; marker data
embedded directly in each project row — **yes, as one scalar lat/lng pair**.

No frontend code was modified.

## 9. Descriptive-row rule — `last_seen_at` removed

`last_seen_at` is excluded, per A2's finding that reconciliation wholesale-mutates it.

48,032 candidate rows over 1,875 source_keys (one sequential scan; control: matches the
independent count of 48,032 exactly, 737 legacy zips). **84 source_keys carry descriptive
variants** — the same 84 A2 found.

Fields that actually differ (count of keys with more than one distinct value):
`stage` 25 · `submitted_at` 9 · `status` 8 · `impact_score` 8 · `address` 4 · `name` 2.
`type`, `developer`, `size`, `investment`, `jobs`, `scope_text`, `type_raw`, `source_ref`,
`registry_id`, `date_kind`, `start_date`, `end_date`, `lens` — all **0**. Control:
`variants_unexplained = 0`, so every one of the 84 differs in at least one named field; the
56-vs-84 gap is overlap between fields, not an unmeasured field.

What each candidate rule selects, on those 84:

| rule | differs from lowest-id | fingerprint |
|---|---:|---|
| **lowest stable `id` (CHOSEN)** | — | `7e0380945c2d3c59aaf64daea8227ac4` |
| highest stable `id` | 21 | `6aa6e46fd0cc48037bcd17c49f6e3d1a` |
| `source_seq` then `id` | 3 | `49073fefa05236143740b12039a5a0c3` |
| newest `submitted_at` then `id` | 5 | — |

Lowest `id` is chosen: timestamp-independent, zip-independent, deterministic, and it needs no
extra stored column. `source_seq` is deliberately not used — A2 proved it is a per-ZIP ordinal,
so it carries geographic meaning that must not leak into descriptive identity. No
`app_projects.id` is persisted; `id` is used for ORDERING only.

## 8. Shadow marker relation — built and proved

`geo.zip_authoritative_marker (zcta5, source_key, marker_seq)` — see
`docs/n5-unit-a3-marker-relation.sql`. Built by run 33789531163 (`marker_mode=build`),
TIGER sha256 matching the B1/N2A/N3/N4 pin, 13 prefixes, every prefix reporting
ZIPs-with-membership == ZIPs-with-a-TIGER-boundary.

**Prediction before the run: 8,754 line + 4,466 polygon + 1 point = 13,221 markers, 0 outside
their ZIP. Confirmed exactly on both counts.**

| | markers |
|---|---:|
| line (`LINE_MERGED_COMPONENT_INTERVAL_1000M`) | 8,754 |
| polygon (`POLYGON_COMPONENT_POINT_ON_SURFACE`) | 4,466 |
| point (`POINT_AUTHORITATIVE`) | 1 |
| **total** | **13,221** |

### Marker quality (Step 7)

| test | result |
|---|---|
| memberships with >= 1 marker | **5,845 / 5,845** — 0 without |
| markers on the authoritative geometry (1.1 m tolerance) | **13,221 / 13,221** — 0 off |
| markers inside their ZIP | **13,221 / 0 outside** (asserted in-run, fail-closed) |
| duplicate coordinates within a membership | **0** |
| `marker_seq` contiguous from 1 | **0** violations |
| markers derived from legacy ZIP membership | **0** — by construction; the derivation reads only `geo.n5_geom` ∩ TIGER boundary |

**0 unexplained exceptions.** There is no membership needing a justified absence: Unit A resolved
a point for all 5,845 (3,312 polygon + 2,532 line + 1 point) with no `EMPTY_CLIP` rows.

### Security (Step 9)

`geo` schema USAGE for anon/authenticated/PUBLIC: **NONE**. Table grants to those roles:
**NONE**. RLS **enabled**. `relacl` `{postgres=arwdDxtm/postgres}`. Unreachable from a browser
by construction, not by a policy that could later be edited.

## 10. Marker load is LIGHTER than production today

A marker rule has to be judged against what the map renders now, not in the abstract.
Across the 346:

| | avg per ZIP | p95 | max |
|---|---:|---:|---:|
| production rows today | 111.6 | 372 | 1,999 |
| authoritative markers | **39.3** | **118** | **175** |

So the authoritative marker set is ~2.8x lighter on average and ~11x lighter at the extreme,
while representing multi-part projects that a single marker per membership would hide.

## 11. Three-count reconciliation for the 346 (Step 14)

| count | value |
|---|---:|
| current production rows `(zip, source_key, source_seq)` | **38,497** |
| current production pairs `(zip, source_key)` | 17,719 |
| authoritative project memberships `(ZIP, source_key)` | **5,842** |
| authoritative map markers | **13,218** |

Decomposition of current → future, which is exact:

1. **Geography refutation** — 12,384 production pairs are not authoritative, carrying
   38,497 − 14,332 = **24,165 rows**.
2. **Geography additions** — **507** authoritative pairs production does not have.
3. **Marker-grain correction** — on the 5,335 confirmed pairs production carries 14,332 rows
   against a card grain of one per pair: **−8,997 rows** that are `source_seq` multiplicity,
   NOT geographic error.

Controls: 5,335 + 507 = 5,842 (authoritative) ✓ · 5,335 + 12,384 = 17,719 (production pairs) ✓ ·
38,497 − 24,165 − 8,997 + 507 = 5,842 ✓.

**So of the 32,655 net rows removed, 24,165 are geographic refutation and 8,997 are marker-grain
correction.** Treating all removed rows as geographically wrong would overstate refutation by
more than a third.

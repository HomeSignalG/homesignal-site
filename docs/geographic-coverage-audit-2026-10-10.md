# Geographic coverage audit — the centroid-radius scope (2026-10-10)

Dated record. Every number below was measured on 2026-10-10 against production (read-only `execute_sql`
selects and `pg_net` GETs to public publisher endpoints) and against the shipped code. Nothing was written to
production, no function was deployed, no refresh was started. The correction is on an isolated branch and is
**not deployed**; its SQL is **not applied**.

**Verified** = a query/receipt is named beside it. **Assumed** = said so, in words.

## 1. Reproduction (Denton County, `denton-county-dev-permits`)

Method: the 27 stored pages of the live layer (`gis.dentoncounty.gov … DEV_Permits/FeatureServer/0`, the registry's
own `include_types` + status whitelist, `returnGeometry=true`, ids 32109–32135 in `net._http_response`) were parsed in
one read-only statement. Each record's point was tested against `geo.zcta_boundary` (canonical polygons, joined to
`canonical_zip_registry`) with `ST_Covers`, and its `source_key` (`arcgis:denton-county-dev-permits:<PermitID>`) was
looked up in `public.app_projects`.

| | count | receipt |
|---|---:|---|
| whitelisted source records | **25,727** | 27 pages; `count(distinct PermitID)` = 25,727, 0 without geometry |
| **not stored in `app_projects`** | **5,429** | reproduces the Oct 10 figure exactly |
| …of which inside a canonical ZIP polygon | 5,348 | |
| …of which inside the **nine pilot polygons** | **5,061** | reproduces the Oct 10 figure exactly |
| …of which inside no canonical ZIP polygon | 81 | correctly not served (boundary-based) |
| unique projects | **5,061 / 5,429** | one `PermitID` = one canonical key; no duplicates in the layer |

**The mechanism, proven rather than inferred.** The 28 ZIPs that carry stored Denton rows have centroids; build the
connector's square (±3 mi, `envelopeFor`) around each. Of the 20,298 stored records, **20,298 lie inside a square and
0 outside**; of the 5,429 missing, **0 lie inside a square and 5,429 outside**. The line the data falls on is the
scope, not the publisher and not a quality gate.

**Raw records vs unique projects.** The layer has one row per permit; `source_key` is that permit id, so raw and unique
agree (25,727 / 25,727). Collapsing several permits at one address into one *real-world* project is not done anywhere
in the pipeline and is not attempted here (assumed: fewer real-world projects than keys).

### Per pilot ZIP (polygon membership, by `ST_Covers`)

"served" = present in `geo.n5_serving_membership` for that ZIP. For every stored record, stored = served
(`stored_not_served` = 0 in all nine): **the serving layer is not dropping anything — the loss is purely at ingestion.**

| ZIP | polygon members | stored = served | **missing** | % missing | decided | pending | approved 2023 | approved 2021–22 | approved ≤2020 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 75056 The Colony | 1,594 | 1,594 | **0** | 0% | 0 | 0 | 0 | 0 | 0 |
| 75068 Little Elm | 5,459 | 4,213 | **1,246** | 22.8% | 5 | 4 | 4 | 69 | 1,164 |
| 76207 Denton | 793 | 285 | **508** | 64.1% | 1 | 0 | 465 | 15 | 27 |
| 76226 Argyle | 2,494 | 2,327 | **167** | 6.7% | 1 | 0 | 2 | 39 | 125 |
| 76227 Aubrey | 5,851 | 5,682 | **169** | 2.9% | 1 | 0 | 25 | 24 | 119 |
| 76247 Justin | 1,833 | 395 | **1,438** | 78.4% | 4 | 0 | 182 | 881 | 371 |
| 76258 Pilot Point | 412 | 288 | **124** | 30.1% | 3 | 0 | 2 | 24 | 95 |
| 76259 Ponder | 977 | 386 | **591** | 60.5% | 1 | 0 | 23 | 342 | 225 |
| 76266 Sanger | 1,292 | 474 | **818** | 63.3% | 4 | 1 | 24 | 234 | 555 |
| **total** | **20,705** | **15,644** | **5,061** | **24.4%** | **20** | **5** | **727** | **1,628** | **2,681** |

20 + 5 + 727 + 1,628 + 2,681 = 5,061 (exact). Only the 20 Withdrawn/Denied records are `Decided`; the 5 Pending are
the layer's only open proposals in the pilot polygons, and the newest missing record in any ZIP is dated **2023**.

## 2. Is it real, and is it only Denton? (national exposure)

**Configurations using `spatial_zip_radius_mi`: 180** — 172 ArcGIS, 7 Socrata, 1 CSV (the Oct 10 figure was 181; this
count is read from `jurisdiction-registry.json` by parsing each entry, not by grep, and I could not reproduce the 181st).
CKAN, Carto and OpenDataSoft entries carry none. ArcGIS entries with a native ZIP column (e.g. Fort Collins, which a
first pass wrongly counted) are unaffected by this mechanism. 138 distinct (connector shape, radius, coverage) groups;
45 are statewide.

All three affected connectors share the same shape: `arcgis.ts` sends an `esriGeometryEnvelope` of ±R mi around the
ZIP centroid; `socrata.ts` sends `within_circle` of R mi; `csv.ts` keeps a row only if it is within R mi of the
centroid. A record outside that area is never fetched, so it cannot reach `app_projects`, N5 membership or any report.

### What I measured, and what I did not

| measure | result | status |
|---|---|---|
| **Geometric exposure** (does the ZIP polygon's bounding box extend beyond its own ±R square?), all 180 configs | of **at least 11,514** ZIP pages inside some radius source's coverage, **7,326** (64%) have a polygon box that sticks out of the square, **5,872** by more than 1 mi and **3,723** by more than 3 mi; 48 states | verified, but an **upper bound**: it ignores that a neighbour's square can cover the gap, and that no record may exist there. 6 of the 138 groups were left out of the distinct count, so "at least". |
| Exact area outside the union of the covered ZIPs' squares (sampled groups) | Denton County 35.0% of polygon area (27 ZIPs; 14 with >5%, 10 with >25%); Pierce WA 46.0%; Washtenaw MI 38.8%; Dane WI 44.4%; Denver CO 1.4% | verified for those five; the other groups timed out and were not retried (cost on production) |
| **Actual lost records** (service count with the entry's own whitelist, vs distinct stored keys) | Denton **5,429 / 25,727 = 21.1%**; Clark Co. WA active permits **15 / 47 = 32%**; Colorado Springs planning **17 / 1,028 = 1.7%**; Madison WI planning **2 / 483 = 0.4%**; Arlington TX planning **0 / 205 = 0%** | Denton is *proved* (above). The other four are **gaps, not proofs of cause** — they also include records outside every modelled polygon and geocode drops. |
| Same count for the other ~25 ArcGIS entries I tried | **not measured**: `UPPER(TRIM(col)) IN (…)` is rejected by many ArcGIS servers (HTTP 400) and some hosts need tokens; only Baltimore and Cleveland answered. Not retried. | unverified |

**Conclusion that the evidence supports:** the defect is universal in *mechanism* (every radius-scoped entry has it) and
variable in *effect*: dense, city-bounded sources lose ~0% (Arlington, Madison), ZIPs that are large relative to ±3 mi
lose a lot (Denton 21%, Clark WA 32%). **Do not read 180 as "180 defective sources"**; read it as 180 sources that can
lose records in proportion to how far their ZIP polygons reach past a 3-mile square. Statewide DOT-style linear layers
use envelope-*intersects* semantics for lines and polygons and are a different case; they are in the exposure counts
as an upper bound only.

## 3. The correction (smallest universal change)

Boundary-based accuracy needs two things: **fetch** every record that can be inside the polygon, and **decide
membership** by the polygon. Membership is already correct (`geo.n5_serving_membership` is polygon-based, and it served
every stored record). Only the fetch scope is wrong. So the change is to the scope only:

> scope = legacy centroid square ∪ the bounding box of the ZIP's canonical polygon

* `sources/scope-box.ts` — the single definition (`scopeBox`, `centroidSquare`). `envelopeFor` now delegates to it.
* `sources/zip-bounds.ts` + `docs/zip-scope-bounds.sql` — `public.zip_scope_bounds(zip)` is a projection of the
  existing authority `geo.zip_membership_boundary`; it holds no geometry of its own, returns **no row** for a ZIP with
  no boundary, and is locked to `service_role` by name.
* `arcgis.ts`, `socrata.ts`, `csv.ts` — use the scope; Socrata switches `within_circle` → `within_box` **only when the
  polygon widens the legacy scope**, otherwise the query is byte-identical.
* `index.ts` — ZIP mode only. **Address mode is untouched**; the property's 0.5-mile read radius is `n5_projects_within_radius`
  over serving membership and is not part of this path at all.

Properties, each pinned by `test/zip-scope-box.test.mjs` (73 checks; 5 deliberate breaks each fail it on exit code):

1. **Superset, never a subset.** The scope contains the legacy square, so nothing fetched today can stop being fetched.
   (A pure polygon scope was rejected: records near a ZIP edge that lie in a *neighbouring uncovered-county* polygon
   are reachable today only through this ZIP's halo — dropping the halo would lose them.)
2. **Fail-safe.** No bounds / invalid bounds / RPC missing / ZIP has no boundary ⇒ the legacy query string, identical.
3. **Never worse.** If widening is what runs a fetch into `max_rows`, the connector re-runs on the legacy scope and
   reports it (`quarantined` note), instead of returning a truncated sample.
4. **Observable.** A run that used the wider scope says so (`scope_widened`).
5. **Staged.** The scope ships **OFF**: `ZIP_SCOPE_BOUNDS=1` (function secret) enables it for all ZIPs, or a request may
   carry `{"scope_bounds": true|false}` for a targeted canary. Without this, deploying the engine would start a national
   re-fetch through the rolling refresh (~240 ZIPs/hour, ~53 h per sweep) without anyone deciding to.
6. **A prefilter, not a boundary.** The box is wider than the polygon (it also contains neighbours' records). Those are
   stored under this ZIP exactly as halo records are today, and are *served* only where `geo.n5_serving_membership`
   puts them — which is polygon-based. No centroid approximation is presented as a boundary.

**Not done, deliberately:** sending polygon rings instead of a box. It would cut over-fetch (76227's box holds 11,578
records for 5,851 polygon members) but needs ring simplification that is provably a superset, POST paging, and a PIP
test for CSV. Decide after the canary measures row size.

## 4. Regression, performance and alert-safety plan

| requirement | how it is shown | status |
|---|---|---|
| restores missing eligible records | real Denton points: 6 never-stored records outside the legacy square are returned with bounds, 0 without; connectors driven end to end | **tested offline** |
| adds nothing outside boundaries | serving is polygon-based and unchanged; the box is a prefilter. Canary check: after a rebuild, `served ⊆ polygon` for every added row | plan; serving property **verified today** (stored = served, 9/9 ZIPs) |
| no duplicate entities | identity is `source_key`; the 5,061 are distinct keys absent from `app_projects` (0 overlap by construction of the test). Canary check: `count(distinct source_key) = count(*)` per registry after refresh | plan |
| does not revive withdrawn/denied | the recovered set passes the same `status_to_bucket`; the 20 Withdrawn/Denied in the pilot polygons arrive as `Decided`, counted apart from open proposals by the shipped renderer (verified on a real `Decided` Denton record, Oct 10) | **verified** for the mapping; plan for the canary diff |
| preserves rights and quality gates | no gate is touched; all new rows come through `normalizeRow`, rights are looked up per `registry_id` (unchanged) | by construction |
| **no historical alert emails** | `digest.py` has no reference to `app_projects` (grep: 0). MAPS posts read `app_projects` but admit only records inside `RECENCY_DAYS = 45` (`CURATED_RECENCY_DAYS = 365` for the data-centre theme); the newest recovered record is dated **2023**. `app_refresh_zip` writes `app_changes` for development items only when `scope <> 'point'` (Denton rows are point-scope) and is limited to 6 per ZIP. | **verified by reading the shipped code**; confirm in canary with `email_deliveries`/`social_posts` row counts before/after |
| report latency / ZIP-page generation | report reads `app_projects`/N5 only; ingestion cost grows. 76227's report would go from 559 to ~11.6k sites (precedent: 75068 holds 7,252 sites, 6.8 MB as text, 521 KB stored). Canary must record row bytes, write time and the refresh's `max_rows` flag. Cap is 20,000; largest pilot box is 11,578. | **risk named, not yet measured** |
| SEO indexability / freshness classes | no code touches `indexable`, `data_quality` or any freshness rule. But Rule D counts publishable Development entities from serving membership, so more members *can* change a ZIP's count. All nine pilot ZIPs are already `indexable = true` (`app_community_meta`, Oct 10). Canary check: Rule D plane before/after for every refreshed ZIP; none may flip without being listed. | plan; **a data effect, not a code decision** |

### Staged rollout (needs explicit approval at each step; none was started)

1. Apply `docs/zip-scope-bounds.sql` (additive, one function, locked).
2. Deploy the engine with the switch OFF (inert).
3. Canary: targeted refresh of the nine pilot ZIPs with `{"scope_bounds": true}` (≈9 reports, not a sweep).
4. Verify: pilot polygon members vs source (expect 20,705 → all present after the next generation), row bytes/latency,
   `served ⊆ polygon`, distinct keys, `Decided` count = 20, mail/social counts unchanged, Rule D plane diff.
5. Only then decide on `ZIP_SCOPE_BOUNDS=1` nationally; the rolling refresh then converges over ~53 h with no manual run.
6. N5 membership for the recovered rows appears with the next serving generation (daily), not instantly.

## 5. Geography and freshness are two results

**Geographic completeness (county permit layer, pilot polygons):** 75.6% before (15,644 / 20,705), 100% of what the
source holds after the fix is deployed and the pilot ZIPs are refreshed. Before the fix the county source was
**incomplete by 24.4% in the pilot polygons**; that part of the Oct 10 finding is **confirmed**.

**Freshness:** unchanged and still failing. The layer's newest record is **2023-06-09** (measured earlier on Oct 10: `max(DateReceiv)`
= 2023-06-09 over 56,500 rows; the 25,727 whitelisted rows parsed here end the same way). The 5,061 recovered records are all 2023 or older, so after the fix **0 of the nine pilot
ZIPs gains a record inside 365 days** from this source. Restoring old permits makes reports *more complete about the
past*; it does not make them current.

Remaining authoritative-source gaps (municipal discovery is a separate workstream and was not advanced here): no current
development source is wired for Aubrey, Little Elm, Argyle, Justin, Ponder, Pilot Point, Sanger or north-west Denton.
First-hand probes on Oct 10 found no ArcGIS permit layer for The Colony (Trakit service = addresses/parcels/floodplain),
and the City of Denton's "2026 April ALL Permits" item is a demographics CSV, not permits.

## 6. Revised Denton agent-pilot verdict

* **GEOGRAPHIC COMPLETENESS: confirmed defect (24.4% of pilot-polygon records never fetched); correction built, tested
  offline, not deployed.** Status: AMBER until canaried.
* **DENTON_AGENT_PILOT: RED (unchanged)** — freshness, not geography, is the blocker. Fixing the scope makes the county
  layer complete; it cannot make it current. The marketing gate stays closed.
* **DENTON_ZIP_PAGES: AMBER (unchanged).**
* **DENTON_FULL_MARKET: RED (unchanged).**

# QUEUE

In-flight work for the Maps / ingest go-live run. **Claude Code owns this file** — updated in
the same PR as the work, or as a standalone commit when nothing else changes. It must never
drift from reality.

Format per workbook `0070Maps IngestFeedInventory.xlsx` Instructions row 348. Seeded from
row 376 (the corrected queue) — **not** row 364, which is superseded.

**Division of record (row 396):** QUEUE.md holds in-flight work — items, states, gates,
dependencies. The workbook holds settled outcomes, rules, worked examples, and measured
per-ZIP/per-source state. Do not mirror queue items into the workbook; two queues drift.

## Rules of use (row 349)

- **Re-read this file before starting anything.**
- **If a founder instruction conflicts with it, SAY SO AND ASK** — never silently follow the
  newer one. When handed a sequence, reconcile it against this file and report any conflict
  **before** acting.
- Dependencies are explicit. An item can never be ordered before something it modifies.
- **Rule 16:** scope is fixed at authorization. New findings become new items here, not
  extensions of work in progress — this binds the founder as much as the agent.

## Standing frame

- **Goal (row 380):** 12,722 ZIP pages, 50 states. Live: NV 158 + TX 668 + UT 310 = **1,136**.
  **8,215 remain** — 5,647 across 34 partial states, 2,568 across 13 untouched.
- **LIVE is not COVERED (row 381).** Texas is the standing example. ⚠️ **The "zero
  `government_notice` sources" half is FALSE as measured 2026-07-30** — see TX-GOV below.
  The principle stands; the number does not. Always report both numbers.
- **7-phase playbook (rows 383–389).** Phases 1–6 are the work and are autonomous.
  **Phase 7 is the gate: the CLAIM** — sitemap, coverage claim, or reporting a state live.
  One report per state at Phase 7, not per phase.
- **Check the known blockers (row 391) before debugging any environment problem.**

---

## RESUME POINT — read this first (updated 2026-07-31)

### THE LOOP — note step 4, which I skipped once and reported a false Live

`run scoreboard` → nearest state to 90% on RECORD coverage → uncovered counties largest-first →
search-first discovery → three-part liveness test → wire on an existing connector family →
**merge → deploy → re-cache (`development_reports`) → MATERIALIZE (`app_refresh_zip` →
`app_projects`) → measure from `app_projects`** → one-line report when a state crosses 90%.

🔴 **LIVE MEANS PAGES, MEASURED AFTER DEPLOY AND RE-CACHE (founder, 2026-07-31).** Wired + merged +
emitting is NOT Live. Never declare Live from anything but a post-deploy DB read of `app_projects`.
**Connector output is not page coverage** — a source can emit 468 perfect records into the cache
while every page still serves pre-materialization data. Full rule in
`docs/maps-go-live-governance.md`.

⚠️ **And do not separate development from the EPA floor on a registry-id name.** In `app_projects` a
facility row carries the FRS facility's OWN id in `registry_id` (e.g. `110054576320`), so
`registry_id <> 'epa-frs'` counts the floor as coverage — it reported Sussex **22/22** when the truth
was **0/22**. **Use `record_kind = 'development'`.**

### Done

- **SCOREBOARD** — ranks on records (#442) and now reads **`app_projects`, not the cache** (#450).
  Control: reproduces the row-419 baseline exactly across ten states.
- ✅ **DE — 46/68 (67.6%) → 68/68 (100%), page-verified after materialization.** Wired
  `sussex-county-de-conditional-use`; 468 rows across all 22 Sussex pages, 0 gate leaks.
- **NV — UNREACHABLE** (rows 427/428). **CO — UNREACHABLE at 82.9%** by arithmetic.
- **CO/Weld wired (#451)** — +12 pages, does not clear 90%. **Still needs deploy → re-cache →
  materialize → measure.**

### Next — NC (83/170 = 48.8%, needs +70 of 87 dark)

Dark: **Mecklenburg 34** · Buncombe 20 · Chatham 12 · Orange 10 · Union 9 · Wake 2.
Top four = 76 ≥ 70, so **NC IS reachable** — but only by landing essentially all of
Mecklenburg + Buncombe + Chatham + Orange. Confirm that arithmetic still holds before each wire.

**NC-1 — `charlotte-rezonings`: MEASURED, and it does NOT solve Mecklenburg. Low priority.**

```
https://gis.charlottenc.gov/arcgis/rest/services/PLN/Rezonings/MapServer/0
```
- 78 rows · POLYGON · newest `Received` 2026-06-15 · per-record **`Hyperlink`** (record precision).
- `Status` enumerates completely: **`Pen` × 78** — the entire layer is PENDING rezonings, a
  current-cases slice rather than a history. Maps cleanly to `proposed`.
- `Type` is **CD 63 + CV 15 = 78**, both OPAQUE CODES. Do NOT guess them; use
  `use_type_const: "Development"` and skip `Type`, as Sussex and Weld do.

🔴 **THE COVERAGE MEASUREMENT WAS RUN, AND IT IS THE ANSWER.** Envelope counts at the connector's
own `spatial_zip_radius_mi: 5`, against four ZIPs taken from the DARK Mecklenburg set:

| ZIP | place | rezonings within 5 mi |
|---|---|---|
| 28031 | Cornelius | **0** |
| 28036 | Davidson | **0** |
| 28078 | Huntersville | 5 |
| 28105 | Matthews | 6 |

**Two of four dark ZIPs get nothing at all.** The reason is structural, not sampling: Charlotte's
78 pending rezonings cluster in the CITY CORE, and the core ZIPs are **already record-backed**. The
34 dark Mecklenburg pages are the outer suburbs and satellite towns — Cornelius, Davidson,
Huntersville, Matthews, Mint Hill — which a City-of-Charlotte layer does not reach by construction.

**Consequence for NC:** Mecklenburg was half the gap (34 of the 70 needed) on the assumption that a
Charlotte source would cover it. That assumption is now measured false. Wiring this yields maybe a
handful of pages, so it is **worth doing only as filler**, never as the thing that moves NC.
**Re-do NC's reachability arithmetic before spending another pass on it** — the honest read is that
NC now needs a MECKLENBURG COUNTY source (not a City of Charlotte one) plus Buncombe, Chatham and
Orange, and if the county has none, NC is likely UNREACHABLE under row 428.

⚠️ **Generalise this — it is the cheapest lesson in the queue:** a big-city open-data portal covers
the CITY, and a county's dark pages are usually the parts of the county that are NOT the city. Run
the envelope count against the actual DARK ZIPs before assuming a metro source closes a county.
Note the Mecklenburg county hub is separately dead: `data-mecklenburgcounty.opendata.arcgis.com`
returned **404**.

**Other Charlotte candidates, unprobed, from the same complete DCAT:** `Special Use Permits`
(`services.arcgis.com/9Nl857LBlQVyzq54/.../Special_Use_Permits/FeatureServer/0`) ·
`Land Development Commercial Projects` · `Transit Station Development Projects` ·
`Committed Development Entitlement Update`. One of these is likely larger than 78 rows.

**Then TN (88/199, needs +91 of 111 dark)** — Shelby **41** · Rutherford 15 · Montgomery 13 ·
Williamson 12 · Sumner 9 · Maury 8 · Wilson 7 · Hamilton 5 · Davidson 1. Needs almost every dark
page, and the largest (Shelby/Memphis) sits behind `SHELBY-429`, a **new connector family
(GATED)**. **Do the arithmetic first — TN is very likely UNREACHABLE** (row 428).

### ✅ MA/MassDOT — DONE AND MEASURED. 8.5% -> 88.7%. Two pages short of Live.

**Page-verified from `app_projects` after deploy -> fire -> collect -> materialize
(2026-07-31 01:15Z): MA 53 -> 556 of 627 = 88.7%.** 80,652 MassDOT rows across 552 ZIP pages ·
**0 gate leaks** onto non-MA pages.

🔴 **+503 PAGES FROM ONE ENTRY — the largest single gain of the session** (FL was +275; the county
wires were Sussex +22 and Weld +11). **MA needs 565 for 90%: it is TWO PAGES SHORT — the cheapest
Live in the system.**

**FINAL STATE 01:29Z: 562/627 = 89.6%. THREE PAGES SHORT of the 565 needed.** Two re-fire rounds
were run against the stale ZIPs: the first (16 ZIPs) gained **+6 pages** (556 -> 562); the second
(10 ZIPs) lit 6 more MassDOT ZIPs in the cache (552 -> 558 `md_zips`) but added **ZERO net pages**,
because those 6 were already backed by another source. **10 ZIPs have now failed THREE consecutive
rounds and will not drain** — they queue and never return, consistent with the 90s timeout.

**TO FINISH MA (3 pages), in order of likelihood:**
- **The 10 stuck ZIPs are probably not the answer** — two rounds of them yielded 6 cache hits and 0
  net pages. Do not keep re-firing them blindly; first check *why* they hang (their `home_lat`/
  `home_lng`, whether their reports are unusually large, whether they 503 or genuinely time out).
- **Better: 7 dark MA ZIPs have `jsonb_array_length(sites)=0`** — completely empty reports, not just
  missing MassDOT. Those are the anomaly worth investigating; an empty report on a modelled MA ZIP
  suggests the engine returned nothing at all, which is a different failure from "no MassDOT in
  range."
- Failing both, MA is legitimately 89.6% and the honest call is that MassDOT's 3-mile reach does not
  cover the last 65 ZIPs. **89.6% with +503 pages gained is still by far the best result of the
  session** — do not treat 3 short as a failure.

**(historical) The two pages were identified and an attempt was made:** Of the 71 dark MA ZIPs,
**0 were never cached** but **16 still hold pre-v114 cache** — they never ran against the MassDOT
engine because their requests keep failing. Those 16 were re-fired at 01:22Z and **the queue stalled
at 16 with none completing** (row 411: ~31% of pg_net requests fail; these are the persistent
failures, likely hitting the 90s timeout).

**RESUME: re-fire those 16 and collect until the queue reaches 0.** The selector is exact —
MA `level='zip'` pages with `development_reports.refreshed_at <= 2026-07-31 01:03Z` and no
`app_projects` row with `record_kind='development'`. **Only 2 of the 16 need to succeed for
Massachusetts to become the 4th Live state.** The other 55 dark ZIPs re-cached cleanly and are
genuinely outside MassDOT's 3-mile reach — do not chase those.

⚠️ **THE "ZERO RECORDS" SCARE WAS MY MEASUREMENT, NOT A DEFECT — and the lesson is the one that
already bit once tonight.** I measured 0 MassDOT records while 30 requests were still queued and the
`refreshed_at` window I used still included the tail of the earlier stale-engine fire. I then wrote a
ranked bug diagnosis and probed five field mappings — `Descriptn` 14,251 · `Location` 13,693 ·
`Project` 24,045 · `From_Date` 24,045 · `Status` 13,484 — **every one of which came back healthy**,
because there was never anything wrong. One clean `dev_refresh_collect()` at queue 0 produced 46,279
records immediately.
**RULE, third costume of the same error tonight: DO NOT MEASURE UNTIL THE QUEUE IS 0 AND
`refreshed_at` IS LATER THAN THE DEPLOY.** Cache-vs-pages, fire-before-deploy, and now
measure-before-drain are all the same mistake — reading a number before the thing that produces it
has finished.

### 🔴 IN FLIGHT — FDOT / Florida. Merged, NOT deployed. Resume here.

**The strategic finding this came from, which matters more than FL itself:** all three states that
ever cleared 90% (TX, NV, UT) did it via a **statewide DOT layer**. Row 420 declares the statewide
path exhausted, but that refers to the **workbook's own six candidates** — the **state-DOT CLASS was
never enumerated for the other 47 states.** Per-county wiring yields ~11 pages a pass; a state DOT
yields a whole state. **This is the lever. Sweep it.**

Confirmed live this pass by direct probe:

| DOT | endpoint | status | dark pages |
|---|---|---|---|
| **FDOT** | `gis.fdot.gov/arcgis/rest/services/Active_Construction_Projects/FeatureServer/`**`1`** | WIRED (#457, merged `8f81ea8`) — 2,428 rows, polyline | **413 of 441** |
| **MassDOT** | `gis.massdot.state.ma.us/arcgis/rest/services` → `Projects` folder | 200, folder confirmed, **unprobed** | **574 of 627** |
| **PennDOT** | `gis.penndot.gov/arcgis/rest/services` → `paprojects`, `projectpath` | 200, folders confirmed, **unprobed** | **488 of 560** |

⚠️ **FDOT layer index is 1, not 0.** Layer 0 returns HTTP 200 carrying
`{"error":{"code":500,"message":"json"}}`; the service doc lists exactly one layer, id 1.

**Coverage was pre-measured (the Charlotte lesson, applied before the wire).** Envelope counts at
`spatial_zip_radius_mi: 3` against four DARK FL ZIPs: **34761 → 3 · 33785 → 0 · 33186 → 13 ·
33462 → 23.** Three of four hit — much better than Charlotte's two-of-four-zero, because state
highways run through suburbs and rural areas where a city portal never reaches. That is *why* the
DOT class generalises.

**EXACT RESUME STEPS — the pipeline is at step 4 of 5:**
1. ✅ merged to `main` (`8f81ea8`)
2. ✅ **DEPLOYED — `get-address-report` v113 at 2026-07-31 00:33Z.** The first dispatch silently did
   not land (the function sat at v112, predating the merge) and was caught only by re-reading the
   version. **A dispatched deploy is not a landed deploy — always confirm the version increments.**
3. ✅ all **441** FL ZIPs fired through the deployed engine
3. fire all **441** FL ZIPs (`net.http_post` per `dev_refresh_fire_batch`'s shape)
4. 🔴 **`dev_refresh_collect()` — RUN THIS FIRST.** At hand-off 441 were still queued and 0 had
   landed; pg_net drains slowly and ~31% of requests fail (row 411), so **re-fire any FL ZIP whose
   `refreshed_at` is still older than 00:33Z** before collecting again. Do NOT `worker_restart()`.
5. **`app_refresh_zip()` per ZIP — DO NOT SKIP**, then measure from `app_projects` with
   `record_kind='development'`. FL is NOT Live until that read says so.

🟢 **FINAL MEASURED RESULT (page-verified from `app_projects`, full drain, 2026-07-31 00:40Z):
FL 28 -> 303/441 = 68.7%.** 3,908 FDOT rows across 303 ZIP pages · **0 gate leaks** onto non-FL
pages · 0 non-point · 0 missing `record_url` · 0 wrong `use_type`.

🔴 **+275 PAGES FROM ONE REGISTRY ENTRY.** For comparison, this session's per-county wires were
Sussex +22 and Weld +11. **That is a 25x difference per unit of work, and it settles the strategy:
sweep state DOTs first, counties second.** FL is still short of 90% (needs 397), so not Live — but
no county wire could have moved it this far.

**FL was at 28/441 (6.4%) before this.** If FDOT lands on ~3 of 4 dark pages it
would take FL to roughly 75-80% — real, but likely still short of 90%, so expect FL to need a second
source (its four metro candidates are already rejected with receipts: Fort Lauderdale stale,
Orlando ungeolocatable, Tampa WAF-blocked, Miami too slow).

### NEXT TWO, both located by probe 2026-07-31 — ready to wire

**MA-DOT (574 dark of 627 — the largest single prize left).** CLEAN SHAPE, do this one first:
```
https://gis.massdot.state.ma.us/arcgis/rest/services/Projects/HighwayProjects/FeatureServer/0
```
**FULLY PROBED 2026-07-31 — both vocabularies enumerated. Write the entry directly from this.**
24,045 rows · POLYLINE (rides `featurePoint()` path-midpoint) · linear-referenced
(`Route_ID`/`From_Measure`/`To_Measure`).

Unlike FDOT this has **REAL status and type columns**, so it gets real maps, not constants.

**`Status` — complete, sums to EXACTLY 24,045, `exceededTransferLimit:false`:**
`DESIGN` 8,392 -> **proposed** · `CONSTRUCTION` 1,489 -> **approved** · `COMPLETE` 3,603 ->
**operating** · **null 10,561 (44%) -> UNMAPPED, fails closed.** Publishing ~13,484 rows.
✅ **THE 44% NULL WAS CHASED AND IS REAL — do not re-open it.** Probed the two candidate rescue
columns scoped to exactly the null-Status rows (`where Status IS NULL`); both enumerations sum to
exactly **10,561**, the positive control:
- **`constructionStatus`: null 10,334 + `""` 227 = 10,561. ENTIRELY EMPTY.** No help whatsoever.
- **`DesignStatus`: only 230 of 10,561 populated (2.2%)** — `Initial` 164 · `PNF` 39 · `Tabled` 23 ·
  `Denied` 3 · `Approved` 1. Nowhere near enough to switch `status_raw`, and `PNF`/`Initial` are
  pre-application states that would need their own mapping for 200 rows.

So the gap is in MassDOT's own data, not in the column choice. **Accept the loss, keep `Status` as
`status_raw`, publish ~13,484 rows, and do NOT invent a bucket for the nulls.**

**`Proj_Type` — complete, sums to EXACTLY 24,045, 60 values, `exceededTransferLimit:false`.**
All are self-describing highway/bridge work and every one maps to **`Utility`**, matching the
UDOT/TxDOT/NDOT precedent (enumerate verbatim rather than using a constant — that is what proves
the vocabulary was read). Top values: `Hwy Reconstr - No Added Capacity` 1,358 · `Traffic Signals`
1,133 · `Resurfacing DOT Owned Non-Interstate` 1,068 · `Roadway - Reconstr - Sidewalks and Curbing`
904 · `Resurfacing Interstate` 893 · `Hwy Reconstr - Restr and Rehab` 842 · `Resurfacing` 819 ·
`Bridge Replacement` 795 · `Hwy Reconstr - Minor Widening` 744 · `Safety Improvements` 711 ·
`Bridge Preservation` 700 · `Structures Maintenance` 466 · `Bikeway/Bike Path Construction` 454 ·
`Bridge Reconstruction/Rehab` 362 · `Sidewalk Construction and Repairs` 248 · `Pavement Marking`
163 · `Vertical Construction (Ch 149)` 142 · `Guard Rail & Fencing` 126 · `New Construction` 126 ·
`Hwy Reconstr - Added Capacity` 114 · `Structural Signing` 106 · `Tunnels` 83 · `Hwy Reconstr -
Major Widening` 83 · `Painting - Structural` 77 · `Drainage` 76 · `Culvert Replacement` 74 ·
`Reclamation` 68 · `Intelligent Transportation Sys` 54 · `Electrical` 53 · `Bridge Maintenance` 51 ·
`Landscaping` 47 · `Lighting` 39 · `Miscellaneous/No Prequal` 36 · `Sign Installation/Upgrading` 35 ·
`Shared Use Path Construction` 27 · `Other, TIP` 25 · `Contract Highway Maintenance` 22 · `Sewer and
Water` 17 · `Demolition` 15 · `Highway Sweeping` 11 · `Tree Trimming` 11 · `Chemical Storage Sheds`
10 · `Bike Facility Construction` 7 · `Process/Recycle/Trnsprt Soils` 7 · `Highway Relocation` 5 ·
`Pump Station Reconstruction/Rehab` 5 · `Drawbridge Maintenance` 5 · `New Bridge` 5 · `Culvert
Reconstruction/Rehab` 4 · `Limited Access Pavement Preservation` 2 · `Impact Attenuators` 2 ·
`Dredging` 2 · `Catch Basin Cleaning` 1 · `Bridge Maintenance - Deck Repairs` 1 · `Marine
Construction` 1 · `Milling and Cold Planing` 1.
**LEAVE UNMAPPED, fail closed:** `Unsure` 112 · `""` (empty string) 31 · null 10,666.

**column_map:** `title` `["Descriptn","Location"]` · `status_raw` `Status` · `type_source`
`Proj_Type` · `case_number` `Project` or `Project_Num` · `file_date` `From_Date` ·
`lat`/`lng` **`__lat`/`__lng`** (do not omit) · `spatial_zip_radius_mi: 3`.
`More_Info` is a candidate per-record URL — check it is populated before claiming `record`
precision, else `dataset`.

**Still to do before wiring:** the envelope pre-check against dark MA ZIPs (the Charlotte gate).

**PA-DOT (488 dark of 560) — DIFFERENT SHAPE, read this before wiring.**
```
https://gis.penndot.gov/arcgis/rest/services/paprojects/paprojects/MapServer
```
200, but **46 layers, and the STATUS IS ENCODED IN THE LAYER NAME rather than in a column**:
`5=Under Construction Points`, `16=Underway Lines`, `1=Underway Points`, `20=Under Construction
Lines`, `17=Four Year Plan Lines`, `3=Twelve Year Program Points`, `0=Completed Points`, …plus
boundary and bridge-condition layers that are NOT development records.

So PennDOT is **one registry entry PER STATUS LAYER**, each with its own `status_const` — e.g.
Under Construction / Underway -> `approved`, Four Year Plan / Twelve Year Program / Anticipated /
Under Development -> `proposed`, Completed -> `operating`. Do NOT wire the boundary layers (25-33)
or the bridge-condition layers (34-45); they are reference geography and asset ratings, not
projects. Points and Lines are the same projects in two geometries — **pick ONE per status or the
same project double-emits** (the engine-v22 duplicate class, uncatchable across two
`source_registry_id`s).

**Probe each the same way FDOT was probed** — service root → find the projects layer →
count/geometry/fields → constants matched to the DOT precedent (all four existing DOT entries use
`use_type_const`-equivalent `Utility`; "active construction" → `status_const: "approved"`) →
pre-measure against dark ZIPs → wire → deploy → recache → **materialize** → measure.

### Standing notes

- **pg_net probes: send NO `User-Agent`** (a UA makes IIS hosts 400 — the failure is ours).
- **Always paginate `dev_zip_source_ids`.** One un-paginated call returned the first 5,000 ZIPs,
  NV's 89xxx sorted past the end, and NV read 0/158 — a wrong zero that looked like a finding.
- **Check `scope` on live rows after any wire**, not just the record count (finding 3 above).
- **Read `docs/source-registry.md` for the county BEFORE probing it** — Sussex already had a
  "STILL NOT WIREABLE" section for a DIFFERENT endpoint (`/trdserver/Permit_Points`, 827,020 rows,
  undecodable `a_status`). That record still stands; the reconciliation table is in the new
  "SUSSEX COUNTY DE — WIRED via CONDITIONAL USE" section.

---

## Ordered items

### 1. DB-01 — `public.communities` planner-statistics diagnosis
- **State:** **DONE** (2026-07-30) — recorded in workbook 0071 rows 399–401; row 397 marked
  SUPERSEDED.
- **Gate:** was NONE for investigation. No autovacuum or schema change was made.
- **Depends on:** —
- **SUPERSEDED: the hypothesis was FALSE on every count.** It claimed no planner statistics, so
  the planner assumed the table was empty and chose sequential scans over the GIN index.
  1. **The planner was never blind.** `pg_class.reltuples` = **13,212** (real 13,292, 0.6% off)
     and `pg_stats` carried all **10** columns including `zip_codes`. `n_live_tup` belongs to the
     cumulative stats collector — a different subsystem from the planner.
  2. **`n_live_tup = 0` was arithmetically correct.** `communities` has had **zero writes** in
     the stats window (`n_tup_ins/upd/del` all 0), so the derived live-tuple figure is 0 and
     `n_mod_since_analyze = 0`, which is why autovacuum correctly never fired — there was
     nothing to analyze. Positive controls on the same query: `alerts` 374 ins → 11,526 live;
     `app_projects` 930,086 ins → 2,641,302 live.
  3. **The GIN index was already serving the hot path** — `idx_scan` = **14,697**, and the live
     plan is `Bitmap Index Scan on idx_communities_zip_codes_gin`, 0.465 ms.
  4. **ANALYZE changed no plan.** `reltuples` 13,212 → 13,292, `n_live_tup` 0 → 13,292, plan
     identical, 0.465 → 0.453 ms (noise).
  5. **Scope error caught:** `pg_stat_statements` had been reset ~2.5 h earlier while the table
     counters cover a far longer window, so the 5,977 seq scans **cannot** be attributed from
     it. Stated rather than guessed.
- **Settled, unchanged:** regional read replicas are NOT the lever.
- **Spun out:** see DB-02 below.

### 1a. DB-02 — latent: `communities` slug lookup cannot use its index
- **State:** BLOCKED (no action needed today — recorded so it is not rediscovered as an
  emergency; workbook 0071 row 400)
- **Gate:** NONE
- **Depends on:** —
- **Detail:** the only slug index is `communities_slug_lower_key` on the **expression**
  `lower(slug)`, which a plain `slug = $1` predicate cannot use — hence `idx_scan = 0` on it and
  a 13,291-row `Seq Scan` (3.209 ms) when that predicate is issued. **Harmless today: no code
  path issues it** — `hs-resolve.js` uses `zip_codes=cs.{…}` (GIN) and `id=in.(…)` (PK).
- **Acceptance:** if anything ever queries by raw slug, either add a plain btree on `slug` or
  make the query use `lower(slug)`.

### 2. PR-428 — registry status/type maps + drift gate
- **State:** **DONE — MERGED** `484f277` (squash), 2026-07-30.
- **Verified green before merge, not assumed:** confirming run `30573378376` →
  `Registry entries checked: 105 · gating: 0 · unreachable: 3` ·
  `No in-window unmapped statuses anywhere in the registry. Nothing gates.` ·
  `[dry-run] done: 0 wired, 146 flagged, 196 findings, 0 status-drift.` The Tier 1 table is
  gone entirely. Step 8 (the gate) shows **skipped**, which is the designed path — the step is
  driven by the `STATUS_DRIFT=1` marker and the marker was never set. Checked the log rather
  than reading a skipped step as a pass. PR checks: `unit` ×2, `verify`, `monitor` all success.
- **Option 3 (merge with the gate red) was rejected by the founder** — it would have left
  `source-monitor` permanently red on `main`, the exact condition avoided by not hosting this
  check in `verify-development`.
- **Gate:** NONE
- **Depends on:** —
- **Actual state (rows 370–375, verified from GitHub):** open, `mergeable_state: clean`,
  head `claude/loving-archimedes-gtqk76` @ `e0afcc6`, **4 commits**, 9 files, +907/−25,
  based on `c49c7c4`.
- ⚠️ **Group A and Group B are ALREADY COMMITTED. Do not re-scope them.** Group A:
  new-orleans +27 · new-hanover +6 · tacoma-accela +1 · gilbert-energov +1. Group B:
  `status_unresolved` for cincinnati 7 · new-orleans 2 · fort-collins 1 · san-jose 1.
- **Remaining, exactly three things:** (1) rebase onto `0d011e6` — **done**, 64/64 (not the
  recorded 67/67; see the reconciliation log);
  (2) **San Diego `workflow_dispatch`** — the last unaudited entry; (3) merge when the drift
  check would run green.
- **Acceptance:** rebased · San Diego observed · drift check green · merged. **No 105/105
  claim until San Diego is observed** (row 344 — do not round a partial up to a complete).

### 3. PR-431 — connector fixture suites into CI
- **State:** IN-PROGRESS — **rebased onto `0d011e6`**, suite **66/66 green**, CI running.
- **Gate:** NONE
- **Depends on:** — (independent of #428; both branched from `c49c7c4`)
- **Detail:** head `claude/fixture-suites-into-ci` @ `44df2e0`, 1 commit, 8 files, +60/−31.
  Moves 4 never-referenced `scripts/*.fixture-test.ts` suites under `test/` so the runner
  discovers them. Row 342: these produced **no signal**, never a false green. Row 351: it is
  **four** renames, not five — `tdlr-tabs` imports a nonexistent module and cannot be moved.
- **Acceptance:** merged, `unit` green at 66 files.

### 4. TX-GOV — Texas `government_notice` — **CLOSED / PARKED**
- **State:** **DONE (closed 2026-07-30)** — Phase 2 discovery complete across all 19 uncovered
  counties. **Closed at 7 of 610 pages reachable.**
- **Gate:** founder decision taken — **park after the cheap wins.**
- **The reason: vendor fragmentation.** 19 counties span **at least 8 distinct systems**, and
  **69% of the gap** — Dallas 174 + El Paso 145 + Tarrant 99 = **418 pages** — needs bespoke work
  or a new connector family. There is no cheap majority. Tier 1 is 629 pages converting **six
  states** from partial to COMPLETE on connectors that already exist; TX is already 668/668 live,
  so the gov gap **deepens a live state** while Tier 1 **makes six more states exist.**
- ✅ **Shipped:** `gov-comal-tx-commission` — Comal County, 7 pages, Granicus
  `co-comal-tx.granicus.com/ViewPublisherRSS.php?view_id=1&mode=agendas`. Both halves wired
  (`public.feeds` sort_order 850 + `feeds.csv`). Verify on post-deploy rows after the 2-hourly
  ingest — **not cache.**

#### The inventory — attached so nobody re-derives it

| Verdict | Counties (pages) |
|---|---|
| **`first_party_found`, WIRED** | Comal 7 |
| **`verification_blocked`** — source exists, our probe refused | Dallas 174 (PDFs; WebFetch 403) · Tarrant 99 (live system `agendamgmtprod.tarrantcountytx.gov`) · Travis 86 (not re-probed search-first) · Bexar 2 (CivicPlus AgendaCenter; **400**) · Harris 1 (Legistar confirmed; **400** twice) |
| **Rejected on liveness** | Tarrant Granicus (archive + **Test View** only) · Hays 8 (100 items, newest **Nov 2019**) |
| **New connector family needed** | El Paso 145 **NovusAgenda** · Bastrop 5 **CivicWeb** · Burnet 4 **DestinyHosted** · Llano 3 **CIRA** |
| **Bespoke county systems** | Collin 28 (ColdFusion `eagenda`) · Montgomery 22 (static) · Fort Bend 21 (ColdFusion `agendalink`) |
| **Not probed** | Hudspeth · Caldwell · Lampasas · Liberty · Walker (1 each = 5) |

*(7 + 174 + 99 + 86 + 2 + 1 + 8 + 145 + 5 + 4 + 3 + 28 + 22 + 21 + 5 = 610 ✓)*

#### CIRA sweep — run, and it does NOT change the parking decision
`newtools.cira.state.tx.us` is a genuine Texas state-association host carrying many counties'
Commissioners Court notices on a uniform path (`/page/<county>.Commissioners.Court`,
`/page/<county>.Public.Notices`) — Cooke, Robertson, Comanche, Polk, Liberty, Presidio, Fannin,
Medina, Gaines, Llano surfaced in one search. **But it hosts the SMALL rural counties we do not
model.** Of our 19, only **Llano (3) and Liberty (1)** are CIRA-hosted — **4 pages**, not a
statewide long tail of modelled pages. Content is PDFs behind HTML listing pages, so it would
still need a new adapter. **Lever rejected.**

#### DEFERRED — scoped, parked, do not start
Tarrant `agendamgmtprod` characterisation (99) · NovusAgenda spike + modelled-county sweep
(145) · Collin / Montgomery / Fort Bend bespoke (71) · Dallas + Travis search-first re-probes
(260) · the 5 unprobed single-page counties.

### 5. EXP-HARRIS-BEXAR — Step B expansion
- **State:** BLOCKED
- **Gate:** **Founder decision — it moves the coverage claim.** Report, then hold.
- **Depends on:** —
- **Detail:** Harris has 1 modeled ZIP, Bexar 2, leaving **4 correctly-wired entries emitting
  0 records**. Precedent: NYC-borough / Boston-Suffolk / Philadelphia-County.
- **Acceptance:** pages-added and per-entry record counts reported as page-level deltas
  (Rule 10). **Then stop** — no rows inserted, no coverage claim changed.

### 6. SD-AUDIT — San Diego `workflow_dispatch`
- **State:** **DONE — OBSERVED.** Run `30569691125` on the #428 ref, `dry_run=true`.
  Step 5 "Run source monitor" **succeeded** (9.5 min); step 8, the drift gate, failed **by
  design** (it is deliberately last so evidence lands first). Run summary, verbatim:
  `Registry entries checked: 105 · gating: 1 · unreachable: 3` ·
  `[dry-run] done: 0 wired, 147 flagged, 196 findings, 1 status-drift.`
  **105 CHECKED — 101 clean, 3 unreachable, 1 gating.** San Diego was the last unobserved
  entry, so the sweep is complete; but "105/105 clean" would be wrong — see SD-UNREACHABLE.
- **What it found — San Diego is the SOLE gating entry:**
  `| san-diego-approved-permits | APPROVAL_STATUS | no recency window — whole dataset is
  in-window | ``Pending Invoice Payment`` (11) |` — 11 records dropped today.
  Tier 2 (latent, non-gating): `new-orleans-permits` 6 out-of-window values. Tier 3: 6
  `denver-residential-construction-permits` case-only differences, all resolving via the
  case-folded lookup — **independent confirmation that Denver never drifted** (row 342).
  3 entries unreachable, reported as unreachable and never as drift, as designed.
- **Gate:** NONE
- **Depends on:** PR-428 (the drift check it exercises lives on that branch)
- **Detail:** the last unaudited entry of the 105. It is the CSV-family reader
  (`san-diego-approved-permits`, a 15 MB published file), which is why it was never observed.
- **Acceptance:** run observed; only then may the entry set be described as complete.
  **No 105/105 claim until then.**

### 6a. GOV-PORT — port durable governance out of the workbook onto main
- **State:** IN-PROGRESS — **PR #434 open** (`claude/governance-port-to-repo`).
- **Gate:** NONE
- **Depends on:** —
- **Detail:** `docs/maps-go-live-governance.md` carries Instructions rows 331–344, 346–362,
  379–394; `CLAUDE.md` gains the division-of-record pointer. Verified current: rows **1–396 are
  byte-identical between workbook 0070 and 0071**, so the port reflects the live revision.
  `docs/**` and `CLAUDE.md` are already in `unit-tests.yml`'s path filters, so `unit` registers.
- **Acceptance:** merged; no future session depends on the workbook upload for the rules.

### 6b. SD-FIX — `Pending Invoice Payment` — **RESOLVED**
- **State:** DONE (pending the confirming monitor run) · **Gate:** cleared by the founder
- **Outcome:** mapped to `proposed`. A parallel session (`915eaab`) landed the same
  `status_to_bucket` change but left `_receipts` untouched; `f5c9e22`/HEAD adds the
  supersession, which was the missing half.
- ⚠️ **My first reading of the receipt was WRONG and the correction matters.** I quoted only
  its closing clause — *"the dataset is APPROVED/issued permits by construction (its own
  title), so no pre-issuance status exists"* — and concluded the entry had never been probed.
  The **first half of the same 1,637-character string** is a genuine 2026-07-16 enumeration:
  28,515 rows, 151 type|status combos, vocabulary verbatim, **5 statuses found**.
- **So the supersession overturns the INFERENCE only.** The enumeration was correct when run;
  the "by construction" line inferred from the dataset title that no pre-issuance status
  *could* exist, and that is the part that is wrong. The vocabulary grew — **expiry, not
  error**, the same shape as the TX government feeds. The receipt explicitly states the
  original enumeration is not being called incorrect.
- **Rule shipped from this** (PR #436): a receipt may hold both a measurement and an inference;
  quote and evaluate the whole receipt before superseding any part, and mark a
  "by construction"/"by definition" clause as inference even inside a real probe.

### 6c. SD-UNREACHABLE — the drift report counts unreachables but never names them
- **State:** **DONE — PR #438 open.** Both failure paths now carry a distinct reason; the report
  emits a named `registry_id · family · field · why` table, and states `Unreachable: 0`
  positively when there are none. `test/unreachable-naming.test.mjs`, 5 assertions, pins the
  naming rather than the counting. Suite 68 → 69. · **Gate:** NONE
- ⚠️ **This is not a logging gap.** For those 3 entries, "unreachable" reads **identically to
  "clean" in every downstream consumer** — the exact failure this check exists to prevent,
  reproduced inside the check. A nightly green is currently compatible with 3 entries never
  having been read at all.
- **Detail:** run `30569691125` reports `unreachable: 3` **once, in the section header, and
  emits no list**. Verified by searching the whole drift section: exactly one occurrence of the
  word. Gating, Tier-2, Tier-3 and `status_unresolved` findings all name their `registry_id`;
  unreachables do not. So for those 3 entries "unreachable" is indistinguishable from "clean" —
  the instrument-silence failure (§8) inside the instrument built to prevent it.
- **New item rather than an extension of #428 (Rule 16)** — found mid-flight on authorized work.
- **Acceptance:** the report names each unreachable `registry_id` and the reason its reader
  returned null.

### 6d. REGISTRY-COLLISION-PROTOCOL — state the concurrency check before any registry edit
- **State:** **DONE** — shipped in PR #436 as "A concurrent writer is a design constraint, not
  an accident". · **Gate:** NONE · **Depends on:** —
- **Why:** **two registry collisions in one day.** A parallel session wired the TX
  `government_notice` feeds (15:48 / 18:20 UTC), and another landed the *same* San Diego
  `status_to_bucket` map in `915eaab` while this session was preparing it. Both were caught —
  the first by a `stale info` push rejection, the second by reading the remote before
  force-pushing — but **converging on the same edit twice is luck, not method.** Two sessions
  with write access to one registry needs a stated protocol.
- **The protocol:** before any `jurisdiction-registry.json` edit, check whether another session
  has touched that entry on `main` (or on the target branch) since your branch point, and
  **say so in the report** — naming the entry, the commits inspected, and the result.
  `git log --since=<branch-point> -S'"registry_id": "<id>"' origin/main` is the cheap form.
- **Never resolve a collision by force-push.** Rebase onto the other session's work and commit
  only the delta it is missing — that is what recovered the San Diego `_receipts` supersession,
  which `915eaab` had left untouched.
- **Acceptance:** the check is stated in every registry-edit report; the rule lands in
  `docs/maps-go-live-governance.md`.

### 7. TDLR-TABS — investigate before fix-or-delete
- **State:** READY
- **Gate:** NONE to investigate. **GATED:** deleting the entry.
- **Depends on:** —
- **Detail:** `scripts/tdlr-tabs.fixture-test.ts` imports a module that does not exist — yet
  TDLR/TABS backs the shipped Travis County dossier (78617, the 5 Caldwell filings). Settled
  (row 341): **investigate before any fix-or-delete.**
- **Acceptance:** report explaining the contradiction, before any change.

### 8. SHELBY-429 — build the opendatasoft connector
- **State:** BLOCKED
- **Gate:** **New connector family = new code. Founder authorization to build.**
- **Depends on:** —
- **Detail:** `shelby-county-building-permits` is dead config — **three independent
  confirmations** that no `sources/opendatasoft.ts` exists and the entry emits 0 records
  cache-wide (row 377). Founder decision stands: **BUILD it, do not drop the entry.**
- **Acceptance:** connector built, entry emits records, fixture suite in CI.

### 9. PGNET-EGRESS — is our probe path producing false negatives?
- **State:** IN-PROGRESS — **priority: above all state work** (founder, 2026-07-30)
- **Gate:** **REPORT ONLY.** No fix, no retry logic, no scheduled job without approval.
- ⛔ **Renamed and widened from PGNET-503** (itself the supersession of PGNET-WATCHDOG, which
  treated a stall that does not exist). Widened because this is now a **CORRECTNESS** problem,
  not a throughput one: **a `candidates_exhausted` verdict from our probe path is currently
  unsafe**, and we have already seen what a wrong exhausted verdict costs — 99 pages nearly
  written off on a guessed 404.
- **Evidence — two distinct signatures:**
  - **503s:** `1,092 OK · 452 HTTP 503 · 30 request timeouts · 5 DNS timeouts`, **queue depth 0**
    — a ~31% failure rate.
  - **400s:** four probes across **three unrelated hosts** — `bexar.org` ×2,
    `newtools.cira.state.tx.us`, `harriscountytx.legistar.com` — all returning **~330-byte 400s**
    (339/339/311/339). That uniformity is an egress signature, not four coincidental refusals.
  - **WebFetch returns 403** on `bexar.org` and `harriscountytx.legistar.com` — a *different*
    status from a *different* datacenter egress path. Two paths, two rejections, neither clean.
- **Three questions, report only:**
  1. **The 503s** — cold starts, concurrency limits, memory, or rate limiting? Does
     `dev_refresh_tick` silently absorb them, how many scheduled refreshes fail per day, and does
     anything retry?
  2. **The 400s** — capture a **full response body and headers**. WAF fingerprinting Supabase
     egress, a missing User-Agent, or something we send? A ~330-byte uniform body across
     unrelated hosts should be identifiable.
  3. ⭐ **MOST IMPORTANT — what fraction of TX-GOV's `verification_blocked` verdicts are actually
     ours?** Re-run the blocked probes through a channel that is **not** pg_net. In flight:
     `recon-fetch.yml` on a GitHub runner (clean egress) with `scripts/recon/tx-egress-recheck.json`
     — 8 blocked targets **plus 2 known-200 controls** (Comal, Denton) so a runner-wide failure is
     distinguishable from a per-host one.
- **Why Q3 matters:** if our probe path produces false negatives, **the TX inventory understates
  what is reachable and TX-GOV was parked on bad data.** TX-GOV is **not** being reopened now —
  the question is whether it was parked for the right reason.
- **Acceptance:** all three answered with measurements. No remedy recorded until it is shown to
  *cause* the recovery.

### 10. ARLINGTON-DELTA — measure the clean delta
- **State:** BLOCKED (waiting on the rolling refresh)
- **Gate:** NONE
- **Depends on:** —
- **Detail:** the pre-deploy baseline was destroyed by a post-deploy refresh, costing the clean
  −397 figure (row 344). **Do NOT re-fire the Arlington ZIPs to force a delta** (row 341) —
  let the rolling refresh carry them.
- **Acceptance:** delta measured on naturally-refreshed rows.

### 11–16. Tier 1 closeout — 629 pages, converts SIX states
Row 356, cheapest first. Principle (row 354): **FINISH BEFORE STARTING** — a state at 74%
converts to COMPLETE far cheaper than a state at 0%, and states-completed is the metric.

| ID | State | Remaining | % done | State | Gate |
|---|---|---|---|---|---|
| ST-DE | Delaware | 22 | 68% | READY | Ph 1–6 NONE · **Ph 7 founder gate** |
| ST-CO | Colorado | 37 | 74% | READY | Ph 1–6 NONE · **Ph 7 founder gate** |
| ST-OR | Oregon | 89 | 56% | READY | Ph 1–6 NONE · **Ph 7 founder gate** |
| ST-WA | Washington | 105 | 71% | READY | Ph 1–6 NONE · **Ph 7 founder gate** |
| ST-AZ | Arizona | 148 | 59% | READY | Ph 1–6 NONE · **Ph 7 founder gate** |
| ST-CA | California | 228 | 56% | READY | Ph 1–6 NONE · **Ph 7 founder gate** |

- **Depends on:** Tier 0 (TX-GOV, EXP-HARRIS-BEXAR) per row 355 — fixing a live state beats
  widening to a new one.
- **DE is a single session. AZ carries editorial weight** (Phoenix data-centre corridor).
- **Acceptance, each:** Phase 7 report — pages modelled vs total · per-capability coverage ·
  per-county source verdicts · what renders honest-empty and why. A state is **not** live
  until the founder accepts that report.
- ⚠️ **Launching a NEW state is gated — ask first** (row 362). Tier 1 is closeout, not launch.

---

## Reconciliation log

Numbers reconciled against the artifact before acting (Rule 15).

| Instruction said | Artifact says | Resolution |
|---|---|---|
| "main is at 9f0c5d8" | `git log --oneline -1 origin/main` → **`0d011e6`**; `9f0c5d8` is its parent. Row 365 confirms main carries both. | Both true, counted differently: `9f0c5d8` is the last *registry* commit, `0d011e6` is CLAUDE.md-only. Rebasing #428 onto current main (`0d011e6`) is equivalent — #428 does not touch CLAUDE.md. **Assumption stated, not asked.** |
| Tier 1: DE 22 · CO 37 · OR 89 · WA 105 · AZ 148 · CA 228 | Row 356 identical; sums to **629** = row 356's stated total. | ✅ Matches. |
| "1,136 live, 8,215 remain" of 12,722 | 1,136 + 8,215 = 9,351 ≠ 12,722. | **Not an error** — the 3,371 gap is pages already modelled inside the 34 partial states. "Remaining" counts pages left to model, not pages in unfinished states. Both figures right, counting different things. |
| Chat seed listed 6 items | Row 376 lists 5 more still outstanding: San Diego, tdlr-tabs, Shelby, pg_net watchdog, Arlington delta. | Added as items 6–10. QUEUE.md must never drift from reality (row 348); omitting known in-flight work would be drift. |
| "pg_net worker stalls — clear with `net.worker_restart()`" (workbook row 391 + governance doc) | Measured 2026-07-30: **queue depth 0**, `1,092 OK · 452 503 · 30 request timeouts · 5 DNS timeouts` — a **~31% request-failure rate**, not a stall. | **SUPERSEDED.** `worker_restart()` never cleared anything; the requests timed out and the queue drained on its own. I applied it twice today and credited it for a drain it did not cause — post hoc, an inference recorded where a measurement belongs. Item re-scoped to PGNET-503. |
| Chat order: DB-01 → #428 → #431 → TX → Harris/Bexar → Tier 1 | Row 355 puts Tier 0 (TX, Harris/Bexar) ahead of Tier 1. | ✅ **No conflict** — chat order also places both ahead of Tier 1. No dependency inversion found: #431 is independent of #428, and the row-349 inversion (status_unresolved at step 2 depending on #428 at step 4) is dissolved because Group B is already committed. |
| Rows 329 + 364: #428 test-rebase "clean, **67/67**" | Measured on the actual rebases: `main` **62** · #428 adds 2 test files (`status-drift-windowing`, `unmapped-status-sample`) → **64** · #431 adds 4 → **66** · both merged → **68**. | **67 matches none of these.** Most likely taken when #428 carried only one new test file (62+4+1). All four measured numbers are green; no work is blocked. Flagged, not worked around. **Correction:** an earlier version of this row cited row 376 — the claim actually lived in rows 329 and 364. Verify the citation as well as the number. |
| DB-01 hypothesis (row 397) | Disproved on four independent counts. | **SUPERSEDED**, and the founder has already recorded it in workbook 0071 rows 399–401. Not re-reported. |

---

## MA IS LIVE — 90.4% (2026-07-31 02:xxZ)

**Measured from `app_projects` after materialization, not from the connector cache:**

```
ma_pages 627 · backed 567 · pct 90.4 · needed 565
```

The last three pages came from **five ZIPs whose cache already carried development
records that had never been materialized** — 01475 (18), 02339 (60), 01035 (155),
01022 (224), 01020 (449) = 906 records, all cached at 01:30Z, after the previous
materialize pass. `app_refresh_zip` on those five: all `quality=pass`, +5 pages.

MA: **8.5% → 90.4%**, four sources, 0 gate leaks.

### NEW STANDING ANSWER — `source_registry_id is not null` in the cache is NOT the coverage metric

A national sweep for the same "cached but unmaterialized" class found 32 more ZIPs
(WA 22 / KS 3 / MD 2 / CT 1 / AZ 1 / NY 1 / VA 1 / CO 1). **All 32 materialized to
`development=0/0`.** They are not a bug and not a backlog:

`app_refresh_zip`'s `app_projects` development insert requires
`coalesce(el->>'scope','')='point'`. An **area-scope** record — a real permit with a
real `record_url` but no coordinates — is routed instead into `app_changes` as a
`'Planning & zoning'` notice, **capped at `limit 6`**. Receipts: 98499 carries 192
`pierce-county-pals-permits` records, every one `scope:"area"` with a URL; 10044
carries 53 `nyc-dobnow-approved-permits`, same shape.

So:
- **Coverage = point-scope development rows in `app_projects`.** That is what pins the
  map, and all three map views read the same dataset.
- Counting `source_registry_id is not null` over `development_reports.sites`
  **over-counts**, because it silently includes area-scope records that can never
  become pins. It is a LEAD, not the fact.
- The 56,279 coordless rows already in `app_projects` are **point**-scope records whose
  coords the materializer's own 100-mile fence later NULLed — a different, expected class.

Those 32 ZIPs are honest: residents see the permits as notices, just not as pins.
Nothing to fix; do not re-open them as a coverage backlog.

**Next:** PennDOT (488 dark PA pages) — `gis.penndot.gov/arcgis/rest/services/paprojects/
paprojects/MapServer`, 46 layers with status encoded in the layer NAME, one entry per
status layer with `status_const`. Traps already recorded: layers 25–33 are boundaries,
34–45 bridge-condition, and Points vs Lines are the same projects twice (would
double-emit — pick one).

---

## NC WIRE PASS — Charlotte wired; NCDOT, Buncombe, PennDOT rejected with receipts (2026-07-31)

**Order followed the founder's own sequence** (DE → CO/Weld → **NC 48.8%** → TN 44.2%).
NV (88.0%, 4 pages short) and CO are founder-recorded UNREACHABLE — locked, skipped.

### Wired: `charlotte-land-dev-commercial-projects` (arcgis, registry 105 → 106) — PR #461, merged `cf4ac82`, engine **v115**

City of Charlotte's OWN ArcGIS Server, `PLN/LandDevCommercialProjects` layer 0. 7,029
polygon rows, `OpenDate` max **2026-07-30** (fresh the day before wiring). Config only.

- Both vocabularies enumerated live with a **positive control — each sums to EXACTLY 7,029**
  (Status 22 values; Category 5). All 21 non-null statuses mapped → **0 unclassified**; the
  450 NULL-status rows **fail closed**.
- `use_type_const: "Commercial"` instead of a 55-value ProjectType map — the SERVICE is
  scoped to commercial land development by its own name, so the value is source-stated, and
  `Commercial` is a member of the CLOSED six-value `TYPE_EXACT` set in `lib/map.js`.
- `ProjectDetail` is a REAL per-record Accela URL on 3,570 of 7,029 (50.8%); the connector's
  column → template → `dataset_url` chain gives the rest honest `dataset` precision, so **no
  row is dropped** by the anti-fabrication gate.
- **Pre-verified yield before deploying** (Rule 13 — probed the query shape the connector
  actually sends, a ±3 mi envelope on each ZIP centroid): **32 of 34 Mecklenburg ZIPs return
  records** (253–2,244 each). Only 28031 Cornelius and 28036 Davidson return 0 — genuinely
  outside Charlotte's jurisdiction, correct for a CITY source.

### Rejected, with receipts — do not re-probe these

- **PennDOT `paprojects`** (488 dark PA pages). The recorded trap was right that status lives
  in the LAYER NAME — and `PROJ_STATUS_DESC` must NOT be used instead: layer 0 "Completed
  Points" and layer 1 "Underway Points" carry the SAME six values, so that column is an
  administrative record state, not the construction phase. **The real blocker is different and
  fatal: the layers are SEGMENT-level, not project-level.** Distinct `PROJ_ID` vs rows —
  Completed 4,343/10,515 (2.4×) · Underway 353/1,129 (3.2×) · Four Year Plan 504/1,151 ·
  Twelve Year 501/642 · Under Development 2,725/4,701 · Anticipated 325/951 (2.9×); layer 5
  HTTP 400s on both stat queries. One project = many rows with **different geometry each**, so
  the engine's exact-identity dedup (which includes lat/lng) cannot collapse them — the
  engine-v22 double-emit class, uncatchable *within* one source. Deduping needs a connector
  change (gated: changes what residents see). Points vs Lines are also the same projects twice
  (counts pair up: 10515/10849, 1129/1155, 5467/5467).
- **NCDOT `NCDOT_ActiveConstructionProjects`** — the statewide-DOT class that carried TX/NV/UT,
  but too small AND partly unpinnable: 257 points + 161 lines statewide. Layer 0 is
  `esriGeometryMultipoint`, and **`featurePoint()` has no `points` branch** (only x/y, centroid,
  rings, paths) → no coordinates → area scope → **no coverage credit** (see the MA standing
  answer above). Only the 161 polyline rows would pin. Fields are also join-qualified
  (`GdbGisuPub.HICAMS.ActiveProjectLine.*`).
- **Buncombe County (20 dark pages)** — three candidates, all rejected: AGO `Permits` is
  **STALLED at 2020-06-02** (`dataLastEditDate` 1591115952764), 329 rows, multipoint, truncated
  export field names (`FIRST_reco`, `FIRST_stat`); `New Commercial Building Permits` layer 0 is
  literally named **`resultLayer`** and is a census-tract AGGREGATE (`TRACT_FIPS`, `POPULATION`,
  `Point_Count`, `percent_permits`) — analysis output, not per-record permits, the NJ-DCA class;
  `Helene_Building_Trade_Permits` is a geometry-less table, last edit 2025-08-11.
  ⚠️ Guessed AGO org `ZOyb2t4B0UYuYNYH` for "Asheville" returned **SEATTLE** layers — the
  cross-org lookalike trap; the guess was discarded, not used.
- **Charlotte `Accela/Accela` MapServer** is a reference basemap (parcels, zoning, review
  areas), NOT a permit ledger. `PLN/Rezonings` is only 78 rows.

**NC after Charlotte lands: 83 → ~115 of 170 (67.6%).** The remaining 51 dark pages to clear
90% are Buncombe 20 (no wireable source found — above), Chatham 12, Orange 10, Union 9.

### Charlotte GO-LIVE VERIFIED (post-deploy, from `app_projects`)

Merged `cf4ac82` → deployed **v115** (01:50Z, confirmed before firing — not a dispatched-is-not-landed
repeat) → fired all 34 Mecklenburg ZIPs → waited for `net.http_request_queue` to reach **0** →
`dev_refresh_collect()` → `app_refresh_zip` on all 34.

- **32 of 34 ZIPs carry Charlotte records; 19,814 records; 0 missing `record_url`, 0 unclassified.**
- **Bidirectional gate proof, cache-wide:** the 32 ZIPs carrying `charlotte-land-dev-commercial-projects`
  span exactly **1 state / 1 county — NC/Mecklenburg**. No leak.
- All 34 materialized `quality=pass`.
- **NC: 83 → 115 of 170 = 67.6%** (from `app_projects`, the only reading that counts).

### NC's remaining path to 90% — needs 38 of the 55 dark pages

Chatham 12 + Orange 10 + Union 9 + Wake 2 + Mecklenburg 2 (Cornelius/Davidson) = **33 — not enough
on their own.** Buncombe's 20 are effectively required, so NC is NOT capped, but it is gated on
Buncombe.

**ASHEVILLE IS THE UNLOCK AND IT IS VERIFIED-READY — not yet wired (two open design calls).**
`https://gis.ashevillenc.gov/server/rest/services/Permits/AccelaPermitsView/MapServer/2`
("Accela Permits View"). Found only after correcting the URL twice: `gis.buncombecounty.org` and
`/arcgis/` both fail (the latter 500s) — the real path is **`/server/`**, recovered by walking the
Hub DCAT item `b8fdb63db30b42d0875afb617e1551f4` → its `url`.

- **65,438 rows, `esriGeometryPoint`, FRESH — `date_opened` max 2026-07-30.**
- Schema is a full Accela ledger: `record_id`, `record_name`, `date_opened` (Date), `record_status`,
  `record_status_date`, `record_type`, `record_type_group/category/type/subtype`, `address`,
  `job_value`, `description`.
- **Both vocabularies enumerated with a positive control, each summing to EXACTLY 65,438:**
  `record_status` **42 values** (Finaled 14998, Expired 11806, CO Issued 10420, CC Issued 10249,
  Issued 6603, Closed 4891, Revoked 1889, Reissued 1461, … 9 NULL) and `record_type_category`
  **56 values**. `record_type_group` is uniformly `"Permits"` (65,438) — useless for typing.
- `date_opened >= DATE '2025-07-31'` → **3,983 rows**, so `recency_days: 365` is the right window.

**Two decisions to settle before wiring (both are "changes what residents see" — gated):**
1. **`record_type_category` = `NA` on 22,714 rows (35%)** — the single largest value, with no honest
   mapping. It would land `unclassified` and fall through to keyword rules.
2. **Trades noise** — Electrical 4,052, Plumbing 1,630, Mechanical 1,092, Fire Alarm 1,189,
   Sprinkler 1,054, Reroof 747, Gas Piping 576, Low Voltage 447. WA/MN/IL dropped trades at source;
   MI **kept** them (founder-specified). Needs the same explicit call here.
3. No per-record URL column exists → `dataset` precision (Boulder/Philadelphia precedent).

Asheville is a CITY source, so expect it to cover a subset of Buncombe's 20 (Charlotte covered
32/34); Chatham/Orange/Union still needed after it.

### ASHEVILLE NOW WIRED — `asheville-accela-permits` (arcgis, registry 106 → 107), PR #462

The two open design calls above were settled (founder: "keep going"), both on precedent and both
recorded here so they are not re-litigated:

1. **`NA` at 35% is a NON-ISSUE — the type source is `record_type_type`, not `record_type_category`.**
   Category is `NA` on 22,714 rows and `record_type_group` is uniformly `"Permits"` (65,438) — both
   useless. The NA rows are **fully typed** at `record_type_type` (Residential 6131 / Sign 4931 /
   Commercial 4465 / Event 3350 / …), so the entry lands **0 unclassified**. 9 values, no nulls,
   summing to exactly 65,438.
2. **Trades and non-development types DROPPED at source** via `extra_where`, following the WA/MN/IL
   majority precedent (MI kept trades only because the founder named the Detroit trio). Dropped: the
   5 non-development `record_type_type` values (Sign 4931, Fire 3550, Event-Temporary Use 3350, Over
   The Counter 2992, Outdoor Vendor 558 = **15,381**) + 15 trade/minor-repair categories. Live
   positive control on the exact filter + 365-day window: **2,280 rows** (unfiltered window 3,983).

🔒 **THIRD FINDING, AND THE MOST IMPORTANT — A PRIVACY TRAP IN THIS SOURCE.**
**`record_name` AND `description` BOTH carry private individuals' names** on residential permits —
`"ECKL, ELIZABETH"`, `"BENNETT, ABBY"`, and descriptions ending `"…FOR SHANE HOLLIFIELD"`. Using
either as the map-pin title would print a resident's name next to their home address on a public,
indexable page. **NEITHER IS MAPPED.** The title is **`record_type`** — 0 null (verified) and
self-describing across 112 values (`Res: New SFD`, `Com: Demo`, `ROW: Encroachment`): it describes
the WORK, not the PERSON.
**Standing answer for every future permit source: before mapping `title`/`description`, read actual
values — an owner-name column is common in Accela ledgers and is invisible in a schema listing.**

Remaining after Asheville lands: Chatham 12, Orange 10, Union 9, Wake 2, Mecklenburg 2
(Cornelius/Davidson, outside Charlotte's jurisdiction). County-host probes for
Chatham/Orange/Union were fired but the pg_net queue backed up to 54 behind a scheduled refresh —
**not yet answered, do not record them as rejected.**

---

## NC GO-LIVE VERIFIED — Asheville landed; NC 48.8% → 72.9% (2026-07-31)

Merged `e6af373` (#462) → deployed **v116** (confirmed before firing) → fired all 20 Buncombe ZIPs →
queue to **0** → `dev_refresh_collect()` (94 rows) → `app_refresh_zip` on all 20.

- **9 of 20 Buncombe ZIPs carry Asheville records; 4,673 records; 0 missing `record_url`,
  0 unclassified.** Exactly the 9 the pre-verify predicted.
- **Bidirectional gate proof, cache-wide: 9 ZIPs, NC/Buncombe only.** No leak.
- 20/20 materialized, 18 `quality=pass` (2 are honest empties on the facilities floor).
- **NC: 115 → 124 of 170 = 72.9%** (from `app_projects`).

⚠️ **Asheville is a CITY source and reaches only 9 of Buncombe's 20** — the other 11 are rural
mountain ZIPs (Marshall 28753, Black Mountain fringe, Hendersonville-adjacent) outside the city's
permit jurisdiction. That was measured with the connector's own query shape BEFORE wiring, not
discovered after.

### NC is 29 pages short — reachable only via Chatham (12) + Orange (10) + Union (9) = 31

Dark now: Buncombe 11 (rural, no source), Chatham 12, Orange 10, Union 9, Wake 2, Mecklenburg 2
(Cornelius/Davidson, outside Charlotte). **NC is NOT recorded UNREACHABLE** — the evidence does not
support it yet:

- **Orange County's own server is a FIRM reject** — `gis.orangecountync.gov/arcgis/rest/services`
  is live (v10.81) and its full service list carries **no permit service** at all (basemaps,
  parcels, zoning, land use, ARIES/Tyler311 locators only). Its 10 ZIPs would need Chapel Hill,
  whose host serves an Esri **Portal** HTML page at both `/arcgis/rest/services` and
  `/server/rest/services` — no REST directory found yet.
- **Chatham and Union are NOT rejected — they are UNANSWERED.** Every host tried was a guess and
  failed for guess-shaped reasons: `gisdata.chathamcountync.gov` and `maps.unioncountync.gov` fail
  DNS, `gis.unioncountync.gov` 404s, `www.chathamcountync.gov` is WAF-403,
  `data-chathamnc.opendata.arcgis.com` returns "Domain record(s) not found".
  **A DNS failure on a hostname I invented is not evidence the county publishes nothing** (the
  Phoenix standing answer, restated).

⚠️ **SECOND CROSS-ORG LOOKALIKE THIS SESSION — guessed AGO org ids keep returning other states.**
`services1.arcgis.com/JLuzSHjNrLL4Okwb`, guessed for "Union County NC", returned a 39 KB service
list containing **`Gilbert_Zoning_General_Industrial_and_Light_Industrial`** — that is **Gilbert,
ARIZONA**. Earlier the same session, `ZOyb2t4B0UYuYNYH` guessed for "Asheville" returned **SEATTLE**
layers. Both were discarded, neither was wired. **Standing answer, now twice-proven: never accept a
guessed `services*.arcgis.com/<orgid>` without an identity check on the returned service names.**
The method that actually works is the one that found Asheville: locate the Hub DCAT feed, read the
item, take its `url`.

### NC IS CAPPED AT 72.9% (124/170) — every remaining dark county probed, receipts below

Not a stop, not a failure: 90% needs 153 and no wireable first-party per-record source exists for
the 46 remaining dark pages. Recorded so no session re-derives it.

| Dark | Pages | Verdict |
|---|---|---|
| Buncombe (rural) | 11 | Asheville is a CITY source; measured with the connector's own envelope query — these 11 return **0**. No county-wide permit source found. |
| Chatham | 12 | **REJECTED — `Chatham_ConditionalUsePermits`** (real host found: `gisservices.chathamcountync.gov/opendataagol`, owner `Chatham01`). 144 polygon rows, but **no permit date at all** (only GIS `created_date`/`last_edited_date` housekeeping and a 100%-null `ExpirationDate`), `PermitStatus` is single-valued (`Valid` 141 + 3 null), and `ConditionalUseClass` is 14 **opaque zoning codes** (B-1, IND-H, RA-40, CUD-CC…). This is a zoning-overlay registry, not development activity — the **North Richland Hills precedent** ("no status and no date column"). Contrast Sussex DE, which WAS wired: 2,566 rows, real `application_rcvd_date` (2026-07-27) and a 16-value status vocabulary. |
| Orange | 10 | **FIRM REJECT** — `gis.orangecountync.gov` is live (v10.81) and its full service list has **no permit service**. Chapel Hill (its main town) serves an Esri Portal page at both `/arcgis/` and `/server/`, and its verified AGO org `7KRXAKALbBGlCW77` (`ToCHadmin`) carries only **`Permits_Issued_2013_to_2016`** — a decade-stale snapshot. |
| Union | 9 | **No org found.** A scoped AGO search for "Union County North Carolina permits" returned zero Union-owned items (only Raleigh, NCDOT, ECU, Esri). Every host guess failed DNS/404. Recorded as *unfound*, not proven absent. |
| Wake | 2 | 27520, 27522 — verified **genuinely dark** (0 point-dev in cache), not an unmaterialized row. |
| Mecklenburg | 2 | 28031 Cornelius, 28036 Davidson — outside Charlotte's permit jurisdiction, verified 0. |

**NC final: 48.8% → 72.9%, +41 pages this session** (Charlotte 32 + Asheville 9), 2 entries wired,
24,487 records, 0 missing `record_url`, 0 unclassified, 0 gate leaks.

**Next per the loop: KY at 34.9%** (126 pages, 44 backed, 70 to 90%). Dark: Fayette/Lexington 19,
Daviess 10, Campbell 10, Warren 9, Boone 8, Oldham 8, Bullitt 7, Madison 5, Jefferson 4, Kenton 1,
Christian 1 = 82 — so 90% IS arithmetically reachable if Lexington + the mid-size metros wire.

---

## KY IN PROGRESS — Lexington/Fayette recon (2026-07-31)

KY 34.9% (126 pages, 44 backed, **70 to 90%**). Dark: Fayette 19, Daviess 10, Campbell 10,
Warren 9, Boone 8, Oldham 8, Bullitt 7, Madison 5, Jefferson 4, Kenton 1, Christian 1 = **82**,
so 90% is arithmetically reachable.

**LFUCG (Lexington-Fayette) org located and IDENTITY-VERIFIED: `services1.arcgis.com/Mg7DLdfYcSWIaDnu`,
owner `emiller_lfucg4`.** Found via scoped AGO search + owner check — NOT a guessed org id
(`data.lexingtonky.gov` is not a Socrata domain — 404 "Domain not found"; `maps.lexingtonky.gov`
serves basemaps/locators only, no permits).

Org service roster (candidates for the next pass): `Development_Plan`,
`subdivision_development_plan_public`, `zone_compliance_public`, `ZoneChangeApplicationspublic`,
`row_permits_open_view`, `construction_projects_lfucg`, `Construction_Locations_view_layer`,
`PW_Construction_Location`, `Residential_New_Construction_Public`,
`Commercial_New_Construction_Sqft_Public`.

**`Development_Plan` — REJECTED.** 4,439 polygon rows, but the full field list is
`OBJECTID, ID, LOG, NAME, Prefix, Year, Case_, DocumentName, ACREAGE, created_by/date,
last_edited_by/date` — **no status column at all**, and **no usable date**: `Year` is a
SmallInteger (2007), not a date, and `created_date` is identical across sampled rows
(1783526417915 = a bulk GIS load), so it dates the import, not the plan. Sampled rows are
2006/2007 plan archives with scanned PDFs. Same class as the North Richland Hills reject and
the Chatham reject above: no status + no real date ⇒ not a development-activity feed.

⚠️ **`Residential_New_Construction_Public` and `zone_compliance_public` are TABLES, not layers** —
`FeatureServer/0` returns `"The requested layer (layerId: 0) was not found."` Their real layer ids
are not 0; that is a lookup to do, not a rejection.

**BLOCKED, not finished:** the remaining three probes (`Development_Plan` max(Year),
`row_permits_open_view`, `construction_projects_lfucg`) were fired but the daily `dev_refresh_fire`
pg_cron fired at the same moment and put **253 reports** ahead of them in the pg_net queue.
Resume by re-firing those three once `net.http_request_queue` reaches 0.

---

## 🚧 BLOCKER — pg_net worker HARD-STALLED at 02:15:00Z; `worker_restart()` measurably does NOT fix it

All further source discovery runs through pg_net (the sandbox has no egress), so this stops the KY
pass mid-probe. Recorded with receipts because it **upgrades the existing PGNET-EGRESS note**.

**The stall, measured:**

```
newest response  2026-07-31 02:15:00.749117+00   (frozen)
max response id  13032                            (frozen)
queue depth      53 → 56                          (grew only by the 3 probes I added)
```

`max(id)` and `max(created)` did not move for **~20 minutes** while the queue stayed full. This is a
TOTAL stall — qualitatively different from the ~31% request-failure rate already recorded, where
responses kept arriving.

**`net.worker_restart()` was tried ONCE, deliberately, to settle the "superseded" question with
evidence — and it CONFIRMS the supersession.** It returned `true`, and **10 minutes later the queue
was still 56 and `max_id` still 13032 — zero effect**. Prior sessions credited it with drains it did
not cause (post hoc); this time it was measured against a genuine stall and did nothing.
**Standing answer, now evidence-backed in BOTH directions: `worker_restart()` neither clears a stall
nor causes a drain. Do not run it and do not wait on it.** The only thing that has ever cleared this
is time.

**What was in flight when it froze** (so nothing is misread as a result): the daily
`dev_refresh_fire` cron had just fired ~250 ZIP re-caches, plus 3 LFUCG probes
(`row_permits_open_view/1`, `construction_projects_lfucg/0`,
`Construction_Locations_view_layer/0`). **None of those three has answered — they are UNANSWERED,
not rejected.** The interrupted cron re-cache is harmless (`dev_refresh_collect` is transient-safe
and never overwrites content with an empty response).

### RESUME HERE (exact steps, no re-derivation needed)

1. `select count(*) from net.http_request_queue;` → wait for **0**. Do not measure anything until it is.
2. Re-probe the 3 LFUCG layers above (+ `Residential_New_Construction_Public` and
   `zone_compliance_public`, whose real layer ids are **not 0** — `FeatureServer/0` returns
   "The requested layer (layerId: 0) was not found"; enumerate the FeatureServer root for the true ids).
3. Apply the three-part liveness test; a layer with **no status column AND no real date** is a reject
   (Development_Plan / Chatham / North Richland Hills class — three instances now).
4. KY needs **70 of its 82 dark pages**, so Fayette 19 alone is not enough — Daviess 10, Campbell 10,
   Warren 9, Boone 8, Oldham 8, Bullitt 7 all have to be probed too.

### KY: Lexington WIRED (`lexington-row-permits`, registry 107 → 108, PR #463); statewide + 3 metros rejected

**Wired — `lexington-row-permits`** (KY/Fayette). LFUCG's own `row_permits_open_view` layer 0
(`row_permits_master`), right-of-way permits. **1,426 point rows, `dataLastEditDate` = 2026-07-31,
the SAME DAY as wiring.** Org identity verified via owner `emiller_lfucg4`, not a guessed org id.
All three vocabularies enumerate to **exactly 1,426**. `Partially Completed` → **approved** (work
authorised and underway, not built). The single `Test, questionable names` row is dropped at source.
`use_type_const: "Roads & infrastructure"` — source-stated by the service name, same call as
Asheville's `Right of Way`. **PII re-checked** (12 values read): every applicant is a COMPANY
(Kinetic, Columbia Gas, Kentucky American Water) and descriptions are work scopes, so
`DescriptionOfWork` is safe as title. **Coverage pre-verified on all 19 modelled Fayette ZIPs:
16 return records**; the 3 zeros are Georgetown/Paris/Winchester — other counties' towns modelled
under the Fayette root.

🔴 **NEW STANDING ANSWER — A MAX-DATE PROBE CAN BE POISONED BY ONE CORRUPT FUTURE-DATED ROW.
ALWAYS PAIR IT WITH A WINDOWED COUNT.**
`Ky_DOW_Floodplain_Permits_WM_gdb` (Kentucky Division of Water, **statewide**, 9,519 points, real
`COUNTY`/`DDLAT`/`DDLNG`/`PERMITNUM`, self-describing `PURPOSE`) looked like the statewide win KY
needs. `orderByFields=STATDATE DESC` returned **`STATDATE` 1872115200000 = 2029-04** — a future date,
i.e. a data-entry error. Trusting row 1 would have recorded this source as "fresh through 2029."
The control that caught it: `where STATDATE >= DATE '2023-07-31'` → **`count: 1`**, and that 1 IS the
bogus row. The real newest is **2020-10-10**. **REJECTED — stalled 5 years.**
*(The layer's own `dataLastEditDate` 2026-07-09 is also misleading: it dates a schema/metadata touch,
not new permits. Layer edit date is NOT data freshness.)*

**Also rejected this pass, with receipts:**
- **Kentucky statewide portal** (`opengisdata.ky.gov`, 2.5 MB DCAT) carries permits, but every one is
  environmental/regulatory, not building: Floodplain (above), KPDES discharge, Inter-System Operation
  (KISOPs), Permitted Mine Boundaries, Permitted Water Withdrawal. `kygisserver.ky.gov` root returns
  no permit service.
- **Daviess/Owensboro (10), Warren/Bowling Green (9), Boone (8)** — scoped AGO searches returned
  **0 permit services and no city/county-government owners** (owners are consultants, universities,
  KYTC contractors). ⚠️ My first three searches returned `total: 0` because multi-word AGO queries are
  **ANDed** — that was a QUERY-SHAPE artifact, not absence; re-run loose (78 / 151 / 1 results) before
  concluding. Recorded as *unfound*, not proven absent.

**KY projection: 44 → 60 of 126 = 47.6%** once Fayette lands. 90% needs 114, so KY cannot reach it
without Daviess/Warren/Boone/Campbell/Oldham/Bullitt sources that do not appear to exist publicly.

### RI probed while CI was blocked — no wireable source, state likely capped at 0%

RI is the highest-leverage remaining target on paper (81 pages, 0% backed, and small enough that one
statewide source would carry it). It does not exist:

- **RIGIS statewide clearinghouse** (`rigis-edc.opendata.arcgis.com`, **1.88 MB DCAT read in full**)
  contains **ZERO** datasets matching permit / development / construction / subdivision. Its org
  `services2.arcgis.com/S8zZg9pg23JUEexQ` carries one construction-ish layer,
  `TDI_and_Construction_Effort` — a transit planning layer, not permits.
- **Providence** (`data.providenceri.gov`, Socrata — the portal DOES exist) has exactly three permit
  datasets: `Special Event Permits`, `Special Events`, and
  **`Department of Inspections and Standards Permits 2009-2018`** — a historical archive whose own
  title states it ends in **2018**. Stalled 8 years. Reject.
- A scoped AGO search for Providence RI returned 2,222 items and **0 permit/construction/development
  services**.

RI stays on the EPA facilities floor. Not recorded UNREACHABLE (per-town sources for Warwick/Cranston/
Pawtucket were not individually probed), but there is no statewide path.

---

## STATE AT HANDOFF — Lexington MERGED + DEPLOYED, re-cache PENDING on the pg_net stall

**Do not report KY as improved.** Per the founder's own Live definition, *wired + merged + emitting is
not Live* — and the fourth step has not completed.

| Step | State |
|---|---|
| PR #463 merged to `main` | ✅ `3618231` |
| Engine deployed | ✅ **v117** (confirmed via `list_edge_functions` before firing) |
| 19 Fayette ZIPs fired | ✅ |
| Reports returned | ❌ **0 of 19** — `net.http_request_queue` frozen at exactly 19 |
| `dev_refresh_collect` | ⏸ not run (nothing to collect) |
| `app_refresh_zip` | ⏸ not run |
| **KY measured** | **still 44/126 = 34.9%** — unchanged, and it must be reported that way |

Expected once the queue drains: **+16 pages → 60/126 = 47.6%** (pre-verified with the connector's own
envelope query; the 3 zeros are Georgetown/Paris/Winchester).

### RESUME (3 commands, no re-derivation)

```sql
-- 1. wait for 0
select count(*) from net.http_request_queue;

-- 2. re-fire the 19 (only if the queue drained WITHOUT them returning)
with fz as (select distinct z.zip from public.communities c, unnest(c.zip_codes) z(zip)
            where c.level='zip' and c.state='KY' and c.county='Fayette')
select net.http_post('https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
  jsonb_build_object('zip', d.zip, 'lat', d.home_lat, 'lng', d.home_lng),
  '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 90000)
from public.development_reports d join fz on fz.zip=d.zip;

-- 3. after queue hits 0 again: collect, then materialize, then measure from app_projects
select public.dev_refresh_collect();
-- then app_refresh_zip over the 19, then the standard state-coverage query
```

⚠️ **The stall recurred twice tonight on ZIP-refresh POSTs specifically** (Buncombe 20 — cleared
itself after ~20 min; Fayette 19 — still frozen at handoff). Cheap GET probes drained normally
throughout. `worker_restart()` was measured as a no-op against it (see the blocker section above).
Time is the only thing that has cleared it.

### ✅ SUPERSEDES THE HANDOFF BLOCK ABOVE — the stall cleared and KY LANDED

The pg_net queue drained on its own (again, without intervention). Full pipeline completed:

```
queue 0 · 20 Fayette reports returned · dev_refresh_collect() 123 · app_refresh_zip 19/19 quality=pass
```

- **16 of 19 Fayette ZIPs carry Lexington records; 8,732 records; 0 missing `record_url`,
  0 unclassified** — exactly the 16 the pre-verify predicted.
- **Bidirectional gate proof, cache-wide: 16 ZIPs, KY/Fayette ONLY.** No leak.
- **KY: 44 → 60 of 126 = 34.9% → 47.6%** (measured from `app_projects`, post-deploy).

The "KY still measures 34.9%" line in the handoff block above was correct **when written** and is now
stale — kept for the record of how the stall presented, but **47.6% is the current truth**.

**Session totals (all post-deploy `app_projects` reads): NC 48.8% → 72.9% (+41 pages), KY 34.9% →
47.6% (+16 pages), MA 89.6% → 90.4% (Live). 3 entries wired (registry 105 → 108), 33,219 records,
0 missing `record_url`, 0 unclassified, 0 gate leaks across all three.**

---

## BOONE MERGED + DEPLOYED, re-cache PENDING (2026-07-31)

**Do not report Boone/KY as improved beyond 47.6%.** *Wired + merged + emitting is not Live.*

| Step | State |
|---|---|
| PR #464 merged to `main` | ✅ `a3e6a28` |
| Engine deployed | ✅ **v118** (confirmed via `list_edge_functions` before firing) |
| 8 Boone ZIPs fired | ✅ |
| Reports returned | ❌ **0 of 8** — pg_net stalled, `max(id)` frozen at 13622, queue 58 |
| collect / materialize | ⏸ not run |
| **KY measured** | **60/126 = 47.6%** — unchanged, report it that way |

Expected once the queue drains: **+8 → 68/126 = 54.0%**.

### RESUME (same 3 steps as the Lexington entry above, with Boone's ZIP set)

```sql
select count(*) from net.http_request_queue;   -- wait for 0 FIRST
-- re-fire only if the queue drained without them returning:
with bz as (select distinct z.zip from public.communities c, unnest(c.zip_codes) z(zip)
            where c.level='zip' and c.state='KY' and c.county='Boone')
select net.http_post('https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
  jsonb_build_object('zip', d.zip, 'lat', d.home_lat, 'lng', d.home_lng),
  '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 90000)
from public.development_reports d join bz on bz.zip=d.zip;
-- then: dev_refresh_collect() -> app_refresh_zip over the 8 -> measure from app_projects
```

### 📌 pg_net ZIP-refresh stall — now observed FOUR times tonight, same signature

Buncombe 20 (cleared ~20 min) · Fayette 19 (cleared, +16 pages) · the 253-deep cron batch (cleared) ·
Boone 8 (stalled at handoff). Signature every time: `net.http_request_queue` frozen at exactly the
outstanding count while `max(net._http_response.id)` stops advancing. **It has ALWAYS cleared on its
own.** `worker_restart()` was measured against it and did nothing (see the blocker section above) —
do not run it, do not wait on it, just re-check later.
**Cheap GET probes drain normally throughout; it is the 90 s ZIP-refresh POSTs that pile up.**

### Session close — 4 entries wired (registry 105 → 109), 3 states measured up

| State | Before | After | Verified |
|---|---|---|---|
| MA | 89.6% | **90.4% (Live)** | ✅ post-deploy `app_projects` |
| NC | 48.8% | **72.9%** | ✅ post-deploy `app_projects` |
| KY | 34.9% | **47.6%** | ✅ post-deploy `app_projects` |
| KY (Boone) | — | *+8 pending* | ⏸ merged + deployed, not cached |

33,219 records across the three landed entries · 0 missing `record_url` · 0 unclassified ·
0 gate leaks. NC capped at 72.9% and RI dead-ended, both with per-county receipts above.

### ✅ SUPERSEDES THE PENDING BLOCK ABOVE — Boone LANDED

The stall cleared on its own (**4th of 4** — it always has). Full pipeline completed:

```
queue 0 · 10 Boone reports returned · dev_refresh_collect() 91 · app_refresh_zip 8/8 quality=pass
```

- **8 of 8 Boone ZIPs carry records; 1,438 records; 0 missing `record_url`, 0 unclassified.**
- **Bidirectional gate proof, cache-wide: 8 ZIPs, KY/Boone ONLY.**
- **KY: 60 → 68 of 126 = 47.6% → 54.0%** (from `app_projects`, post-deploy v118).

The "KY still measures 47.6% / do not report Boone" block above was correct when written and is now
stale — kept as the record of how the stall presented. **54.0% is the current truth.**

### FINAL SESSION TOTALS — 4 entries wired (registry 105 → 109), all verified post-deploy

| State | Before | After |
|---|---|---|
| MA | 89.6% | **90.4% — LIVE** |
| NC | 48.8% | **72.9%** (+41 pages) |
| KY | 34.9% | **54.0%** (+24 pages) |

**34,657 records · 0 missing `record_url` · 0 unclassified · 0 gate leaks across all four entries.**
Every yield was predicted with the connector's own query shape BEFORE deploying and landed exactly:
32/34 Mecklenburg · 9/20 Buncombe · 16/19 Fayette · 8/8 Boone.

**Next state for the loop:** KY needs 46 more of its 58 remaining dark pages (Daviess 10, Campbell 10,
Warren 9, Oldham 8, Bullitt 7, Madison 5, Jefferson 4, Fayette 3, Kenton 1, Christian 1) — the big
three were searched and returned no first-party permit service (recorded as *unfound*, not proven
absent). After KY the ranking is WY 81 · HI 88 · ID 89 · AK 91 · TN 92 · VA 93 pages to 90%.

### KY: Campbell + Kenton REJECTED — LINK-GIS serves permitting BASEMAPS, not permit records

Found the real LINK-GIS endpoint via web search after my host guesses failed: **`maps.linkgis.org/server/rest/services`**
(v11.3, 22 folders). `gis.linkgis.org` fails DNS and `linkgis.org/arcgis` 404s a WordPress page — those
were guesses, this is the live root.

Two folders looked exactly right and both are **reference layers, not ledgers**:

- **`PermittingSystem/PermittingSystem`** — layers are `AddressPts_KC_Parcels_City_Join` (point) and
  `Parcels_KC_PVA_City_ZipCode_Join` (polygon). That is the *geometry the permitting app draws on*,
  not the permits.
- **`SmartGov/CC_Theme_SmartGov`** (SmartGov = the Paladin permitting platform) — 16 layers, all
  Campbell County reference: address points, condos, zoning, parcels + label variants, roads, flood
  zones, ZIP codes, city boundaries. No permit records.
- `Campbell_County` folder — parks, snow routes, storm/water service areas. No permits.
- `CommunityDevelopment` — a single `ExportWebMap` GPServer (a print service).

**Same class as Charlotte's `Accela/Accela` reject: a permitting SYSTEM's basemap is not a permit
ledger.** Standing answer worth keeping — a folder named `PermittingSystem` or `SmartGov` is a strong
lead and a weak fact; open the layer list before believing it.

Also confirmed: Boone's own server exposes **only Boone** — its `Member`, `Partner` and `Hosted`
folders are all EMPTY (62-byte responses), so the `ServicesNKY` folder does not extend the BCPC
board-action ledger to Campbell/Kenton.

**KY is now effectively capped.** Remaining dark 58, need 46: Daviess 10 + Warren 9 (searched, no
first-party permit service found), Campbell 10 + Kenton 1 (rejected above), Oldham 8, Bullitt 7,
Madison 5, Jefferson 4, Fayette 3, Christian 1. Even wiring every un-probed county leaves it short
of 46 without Daviess/Warren/Campbell. Not recorded UNREACHABLE — Oldham/Bullitt/Madison were never
individually probed — but there is no plausible path to 90%.

### WY probed — no statewide and no metro source; all 103 pages structurally dark

WY was the next target (103 pages, 12 backed, 81 to 90%) and fits the profile that carried TX/NV/UT —
a big rural state where one statewide DOT layer lifts everything. **It does not exist here.**

- **Wyoming Geospatial Hub** (`data.geospatialhub.org`, **2.44 MB DCAT read in full**) — every dataset
  matching permit/construction/development is water-rights or extractive and mostly a 2001–2012
  river-basin study: SEO Agricultural/Domestic/Industrial/Municipal/Stock/Coal-Bed-Methane **Well**
  Permit Locations, Stock Pond Permits, Reservoir Water Right Permits, Instream Flow Permits, EPA
  Permitted Water Dischargers, Oil & Gas / Wind development *potential* rasters. **No building or
  land-development permit dataset of any kind.**
- **"Road Travel and Construction Map for Wyoming"** — the one construction-sounding hit — is
  explicitly *"the metadata record for WYDOT's live road conditions web-map; link in record"*. A
  viewer app, not a data service. **Standing answer: a Hub "dataset" can be a metadata stub for an
  APPLICATION — read `description` before chasing it.**
- **WYDOT's own host** `gis.wyoroad.info` 404s at both `/arcgis/rest/services` and `/server/rest/services`.
- **Cheyenne (224 results) and Casper (126)** — scoped AGO searches both RAN and returned **0**
  permit/construction/development services. Non-zero totals, so this is a real absence, not the
  AND-ed-query artifact that produced false zeros earlier in the KY pass.

WY dark is uniform: Natrona 13, Laramie 13, Albany 12, Fremont 12, Sweetwater 12, Park 8, Campbell 7,
Teton 7 — **every county 0 backed**. No path to 90%.

### Frontier status after this session — the remaining states are a different problem

| State | Pages to 90% | Verdict |
|---|---|---|
| KY | 46 | effectively capped (Campbell/Kenton rejected, Daviess/Warren unfound) |
| WY | 81 | **no source exists** — statewide + both metros probed |
| HI / ID / AK / TN / VA / MS | 88–93 each | unprobed; each needs MULTIPLE sources, not one wire |

The single-source-lifts-a-state era is over for the states that remain. NC and KY both moved
substantially this session but neither could reach 90%, and the reason is the same in every case:
**small and rural jurisdictions do not publish per-record permit data**, and the vendor-platform
folders that look like they do (`PermittingSystem`, `SmartGov`, `Accela`) turn out to serve the
basemap their permitting app draws on.

---

## TN/Shelby — `memphis-dpd-building-permits` GO-LIVE VERIFIED (2026-07-31)

PR **#465** merged (`8f6a1ad`), engine **v119** deployed and confirmed *before* firing
(`list_edge_functions` → version 119), queue confirmed clear (q=0) at fire time.

**Four-step pipeline completed:** merge → deploy → re-cache (`development_reports`) →
materialize (`app_refresh_zip` → `app_projects`).

### Measured result — from `app_projects`, `record_kind='development'`

| Scope | Before | After |
|---|---|---|
| **TN/Shelby** | 0 / 41 (0.0%) | **40 / 41 (97.6%)** |
| **TN statewide** | 88 / 199 (44.2%) | **128 / 199 (64.3%)** |

Prediction was "+30–41 pages, TN near 65%". Landed at +40 pages / 64.3%.

### Invariants across all 47,377 cached Memphis records

`0` missing `record_url` · `0` missing coordinates · `0` non-`point` scope · `0` unclassified.
Recency window is exact: oldest surviving `file_date` **2023-08-01** = the `recency_days: 1095`
boundary; newest **2026-06-30**.

**Bidirectional gate proof, cache-wide (not a sample):** grouping every cached site carrying
`source_registry_id='memphis-dpd-building-permits'` by its page's `(state, county)` returns
**exactly one row — `TN/Shelby`, 40 ZIPs, 47,377 records**. No leak onto any other jurisdiction.

The three null-rate unknowns that were made safe by construction at wire time are now confirmed
against the live layer: `Description` null **4 / 26,520** (the title array's first element
`Construction_Type` is 0-null, so no record can title-blank), `Issued_Date` null **0**
(`extra_where` would have dropped them anyway), coordinates null **0**.

**38011 (Brunswick) is an honest 0** — it refreshed successfully at 03:24Z and carries 5 sites,
none from Memphis. It sits outside the 3-mi ring of any Memphis permit. Not a failure, not a
retry candidate.

### pg_net stall — 6th occurrence, and a NEW variant worth recording

The 41-ZIP fire froze at **exactly** the outstanding count (q=41) with `max(net._http_response.id)`
pinned at 14214. **Unlike the five prior occurrences, cheap GETs did NOT drain either** — a control
`net.http_get('https://example.com')` queued as id 14256 and sat unanswered (q went 41→42), so the
whole worker was stalled, not just the POST path. It cleared on its own inside ~7 minutes, and the
control then read 200. A second, shorter stall hit the 5-ZIP retry batch and also self-cleared.
**Still: always clears on its own; `worker_restart()` remains unnecessary and was not called.**

First pass: 36 × 200, 4 × 503, 1 × null. The 5 non-200s (38108 / 38109 / 38115 / 38126 / 38132 —
all dense core-Memphis ZIPs) were identified by a stale `refreshed_at`, re-fired, and all returned
200. Transient cold-start, not a source problem.

### Where TN stands, per county

| County | Pages | Backed | Dark |
|---|---|---|---|
| Knox | 31 | 31 | 0 |
| Shelby | 41 | 40 | 1 |
| Davidson | 32 | 31 | 1 |
| Hamilton | 31 | 26 | 5 |
| Wilson | 7 | 0 | 7 |
| Maury | 8 | 0 | 8 |
| Sumner | 9 | 0 | 9 |
| Williamson | 12 | 0 | 12 |
| Montgomery | 13 | 0 | 13 |
| Rutherford | 15 | 0 | 15 |

TN needs **57 more pages** to reach 90%, and the only way there is the six fully-dark collar
counties (Rutherford/Murfreesboro, Montgomery/Clarksville, Williamson/Franklin, Sumner, Maury,
Wilson = 64 pages). That is a multi-source wire pass, not one entry — the same shape as the
remaining frontier states.

### Scoreboard correction — the metric, stated so it is not re-derived wrong

A scoreboard query over `app_projects` **without** a `record_kind` filter counts the **EPA
facilities floor** and reads ~93–99% for nearly every state. The RECORD-coverage metric is
`record_kind='development'` only. Positive control on the corrected query: TN 88/199 = 44.2%,
NC 124/170 = 72.9%, KY 68/126 = 54.0% — all three reproduce the previously recorded values
exactly. `app_projects` splits 2,548,110 `development` rows / 216,173 `facility` rows.

---

## TN wire pass #2 — Rutherford wired; TN's own ceiling measured (2026-07-31)

### `murfreesboro-building-permits` — WIRED (PR #466), registry 110 → 111

City of Murfreesboro's own AGO org `A5C0MR9xfkxVRwat`, `Buiilding_Permits/FeatureServer/**3**`
(the publisher's typo is in the service name; **layer 0 does not exist** — the layer list had to be
read from the service descriptor). 30,659 rows, point geometry, no ZIP column → spatial 3-mi.

**NEW STANDING ANSWER — a numeric code with no coded-value domain is not automatically opaque:
check `drawingInfo.renderer.uniqueValueInfos` first.** `PRMT_TYPE` is a bare `SmallInteger` with
`domain: null`, which reads as an opaque code and is a hard gate. The layer's OWN renderer labels
every value present — **101 `SF DETACHED`, 102 `SF ATTACHED`, 103 `NEW COMMERCIAL`** — so the
values are self-describing from *publisher-authored metadata*, not inference. Positive control:
28,922 + 1,343 + 394 = **30,659 exactly**, and nothing falls to `<all other values>`. This is the
same move as the Phoenix `PER_TYPE` department-code crosstab; without it the source would have
been wrongly rejected.

`Layer_Name` was the other candidate type field and is **100% NULL** across all 30,659 rows
(groupBy count DESC *and* count ASC both return one null group of 30,659) — checked, not assumed.

**The paired freshness probe earned its keep again.** `orderByFields=PRMT_DATE DESC` returns a
**future date (~2027-09)**. Alone that is indistinguishable from "very fresh" and from a poisoned
max. The windowed controls settle it: **609 rows in the trailing year, 2,234 in the 1095-day
window**, and exactly **1 of 2,234** is future-dated — one data-entry typo, logged and kept (the
record is real).

Other config: no status column at all → `status_const: "Issued"` (Detroit/Cleveland/Nashville/
Memphis issuance-ledger pattern). No per-record URL → `dataset` precision on the city's own AGO
item page (probed 200). `title`/`address` are an address-part array and **`readCol` filters nulls
before joining**, so the null `DIRP` on every sampled row cannot malform a title. `BUS_NAM` was
rejected as title source — **2,114 of 2,234 null (94.6%)**.

**Coverage prediction (measured over ALL 15 Rutherford ZIPs, connector's exact query shape,
reproduced identically across two independent runs): 9 of 15 non-zero**, counts
`{0×6, 1, 62, 124, 132, 228, 423, 463, 535, 638}`, 2,606 record-placements.
⚠️ Only the **multiset** is claimed — ordering inside a subquery does **not** control
`net.http_get` evaluation order, so the id→ZIP labelling was deliberately not asserted.

### TN CANNOT REACH 90% — measured, same shape as NC and KY

Per-county dark count after Memphis (from `app_projects`, `record_kind='development'`):

| County | Pages | Backed | Dark | Source found? |
|---|---|---|---|---|
| Knox | 31 | 31 | 0 | — |
| Shelby | 41 | 40 | 1 | Memphis (wired) |
| Davidson | 32 | 31 | 1 | Nashville (wired) |
| Hamilton | 31 | 26 | 5 | **Chattanooga — candidate found, not yet wired** |
| Wilson | 7 | 0 | 7 | **none** |
| Maury | 8 | 0 | 8 | **none** |
| Sumner | 9 | 0 | 9 | **none** |
| Williamson | 12 | 0 | 12 | **none** |
| Montgomery | 13 | 0 | 13 | **Clarksville-Montgomery RPC — candidate, not yet wired** |
| Rutherford | 15 | 0 | 15 | Murfreesboro (PR #466, predicted +9) |

90% of 199 = 180 backed. Current 128. Even wiring **every** remaining candidate —
Rutherford +9, Montgomery +13, Hamilton +5 — caps TN at **~155/199 ≈ 78%**.
**Williamson + Sumner + Maury + Wilson = 36 pages with no first-party per-record source found**,
on loose AGO searches that DID return results (so this is absence, not the AND-ed-query false-zero
artifact from the KY pass).

### Candidates found, not yet wired

- **Montgomery / Clarksville** — the Clarksville-Montgomery County RPC's own org `bsMxxAoaPLw5EHPS`
  (owner `cmcrpc`). `FinalSD` (94 rows, `RPC_ACTION` **APPROVED=93 | APPROVAL=1** — sums to exactly
  94), `PrelimSD` (69, **APPROVED=69** — exactly 69), `ActivePrelims` (92). Polygon → rides the
  `featurePoint()` centroid path. Both vocabularies self-describing with exact positive controls.
  ⚠️ `Current_RezoningRequests` is **very fresh (2026-07-28)** but **weak and NOT recommended**:
  only 12 rows, `RPC_ACTION` is a blank `" "` on pending rows, `map_url` is **NULL** on every
  sampled row (so its apparent record-precision is illusory), and `ZONE_FROM`/`ZONE_TO` are opaque
  zoning codes (C-5, R-1, AG, R-5) that cannot drive `use_type`.
- **Hamilton / Chattanooga** — org `cclAu9OKhOfjeUdr`, `Building_Permits 1/1/2006 to 3/31/2026`
  (owner `RandA_CHCRPA` = Chattanooga-Hamilton County Regional Planning Agency). Not yet
  freshness-probed or vocabulary-enumerated.

### Rejections with receipts (this pass)

- **Host-guessing is dead as a discovery method** — all 10 guessed GIS hosts for the six dark
  counties failed (`murfreesborotn.gov/arcgis`, `gis.franklintn.gov`, `maps.williamsoncounty-tn.gov`,
  `gis.wilsoncountytn.gov`, `maps.maurycounty-tn.gov`, … → 404 / DNS failure / SSL error).
  Every real source this pass came from AGO search → item → its `url`.
- **Williamson / Sumner / Maury / Wilson** — loose AGO searches ran and returned results
  (Columbia TN planning 111 hits, Hendersonville 23) but **0 permit/subdivision/development
  feature services** among them.

### pg_net — `net.wake()` is a NEW and better first move than `worker_restart()`

The stall recurred twice more (7th and 8th occurrences), including one that froze the **production
nightly `dev_refresh_fire` run** at q=258. Two things learned:

1. **`net.check_worker_is_up()` distinguishes "worker dead" from "worker wedged"** — it raises if
   the worker is down. It returned cleanly, proving the worker was **alive but not draining**.
   No prior session had this instrument; every earlier stall diagnosis had to guess.
2. **`net.wake()` correlated with immediate recovery.** After **25+ minutes** frozen at exactly
   q=58 with `max(net._http_response.id)` pinned, `net.wake()` was followed within 90 s by a full
   drain to **q=0** and ids advancing 14491 → 14549.
   ⚠️ **One observation is correlation, not proof of causation** — these stalls have always cleared
   on their own eventually. But it is the first intervention ever followed by immediate recovery,
   whereas `worker_restart()` was previously measured as a no-op. **Try `net.wake()` first.**

Also worth knowing: a `timeout_milliseconds` of 90000 in `net._http_response.error_msg` identifies a
row as one of `dev_refresh_fire`'s OWN ZIP refreshes, not yours — useful when the nightly cron
inserts ahead of your probes and you are trying to find your own request ids.

### ⚠️ GitHub Actions incident — `unit` wedged on this repo, NOT caused by the change

PR #466's `unit` check passed **green in 2m23s** on commit `22f9e41`. The merge commit `9661e0b`
then wedged on step 6 ("Run all unit regression tests") for **over an hour**, across a
cancel-and-rerun and a third fresh run.

**`git diff 22f9e41 9661e0b` returns EMPTY — the trees are byte-identical.** The wedged runs are
executing exactly the tree that already passed. The suite is green locally (all **71** files) on
every commit in this branch. This is a runner-side incident, not a regression.

Two API lessons from it: `get_check_runs` / `list_workflow_jobs` **serve stale status for ~15
minutes** (a check reporting `in_progress` had `completed_at` 03:41:34), so neither is authoritative
— the **merge endpoint** is, because it is the actual gate. And a cancelled run takes several
minutes to become re-runnable (`403 This workflow is already running`).

---

## TN/Rutherford — `murfreesboro-building-permits` GO-LIVE VERIFIED (2026-07-31)

PR **#466** merged (`16e22c1`), engine **v120** deployed and confirmed before firing
(`list_edge_functions` → version 120), queue confirmed clear (q=0) at fire time.
Four-step pipeline completed: merge → deploy → re-cache → materialize.

### Measured result — `app_projects`, `record_kind='development'`

| Scope | Before | After |
|---|---|---|
| **TN/Rutherford** | 0 / 15 (0.0%) | **9 / 15 (60.0%)** |
| **TN statewide** | 128 / 199 (64.3%) | **137 / 199 (68.8%)** |

**The pre-wire prediction held EXACTLY.** The envelope probe predicted 9 of 15 ZIPs and
**2,606** record-placements; go-live produced **2,606 records across exactly 9 ZIPs**.

### Invariants across all 2,606 records

`0` missing `record_url` · `0` missing coordinates · `0` non-`point` scope · `0` unclassified.
Bidirectional gate proof, cache-wide: grouping every cached site carrying this
`source_registry_id` by its page's `(state, county)` returns **exactly one row — TN/Rutherford,
9 ZIPs, 2,606 records**.

Recency window exact: oldest `file_date` **2023-08-01** = the `recency_days: 1095` boundary.
`newest` is **2027-09-27** — the single future-dated typo row predicted at recon time, now
confirmed as exactly one record. It is a real permit with a bad date, so it is kept, not dropped.

### TN session total: 44.2% → 68.8% (+49 pages)

Memphis/Shelby +40, Murfreesboro/Rutherford +9. TN remains **capped below 90%** — see the
per-county table in the previous section; Williamson/Sumner/Maury/Wilson (36 pages) have no
first-party per-record source, so even wiring the two remaining candidates (Montgomery ~13,
Chattanooga ~5) caps TN near 78%.

### ⚠️ CORRECTION — neither `net.wake()` nor `worker_restart()` is a proven fix for the pg_net stall

The previous section recorded that `net.wake()` was followed by immediate recovery, explicitly
hedged as "correlation, not proof of causation." **That hedge was right, and the claim is now
disconfirmed.** On the Rutherford fire (9th stall occurrence, q pinned at 15):

- `net.check_worker_is_up()` again returned cleanly → worker **alive but not draining**.
- `net.wake()` → **no effect**; still q=15 with `max(net._http_response.id)` frozen ~20 min later.
- `net.worker_restart()` → returned `true`, and the queue drained fully (q=0, **15/15 → 200**)
  shortly after.

So across two stalls the "successful" intervention was a *different* function each time. The only
claim the evidence supports is the long-standing one: **these stalls clear on their own after a
variable interval (observed ~7–25+ min), and no intervention has been shown to cause recovery.**
`check_worker_is_up()` remains genuinely useful as a *diagnostic* — it distinguishes a dead worker
from a wedged one, which no earlier session could do — but it is not a remedy.
**Do not record either function as "the fix."**

### Chattanooga recon COMPLETE — ready to wire, not yet wired

`services2.arcgis.com/cclAu9OKhOfjeUdr/.../Building_Permits_to_April_2021/FeatureServer/**0**`
(service name is historical; the layer is current). Owner `RandA_CHCRPA` = Chattanooga-Hamilton
County Regional Planning Agency. **31,868 rows, point geometry.**

- **Fresh**: 1,289 rows in the trailing year, 5,706 in the 1095-day window (paired control).
- **Type source is `P_TYPE`, NOT the opaque `DEV_TYPE_C`.** `DEV_TYPE_C` is 26 numeric codes
  (101/102/100/328/…) that DO sum exactly to 31,868 but carry no domain and no renderer labels —
  they look like Census C-404 construction codes, and **guessing that is exactly the prohibited
  move**. The layer's own renderer keys on `P_TYPE`, whose values are self-describing:
  **Residential 29,873 + Non-Residential 1,995 = 31,868 exactly**, confirmed in both count-DESC
  and count-ASC orderings.
- Suggested mapping: `Residential → Residential`, `Non-Residential → Development` (the generic
  closed-vocabulary member — "Non-Residential" spans commercial/industrial/civic, so mapping it to
  `Commercial` would be a guess).
- `CATEGORY` is useless as a type: a single value `New` on all 31,868 rows.
- No status column → `status_const: "Issued"`. No ZIP column → spatial 3-mi. No per-record URL →
  `dataset` precision.
- `ADDRESS` is the title, **0 nulls** in the connector's window. PII check performed (the Asheville
  lesson): `P_DESC` values are work scopes ("SINGLE FAMILY RESIDENCE ON SLAB W/ ATTACHED…"), no
  personal names.
- Expected lift is modest: Hamilton is **26/31 already backed**, so at most **5 pages**.

---

## TN wire pass #3 — Chattanooga + Clarksville-Montgomery WIRED (PR #467), registry 111 → 114

Supersedes the "candidates, not yet wired" note above — all three entries are now written,
additive-proven and unit-green; **only the merge is outstanding.**

| entry | county | rows | vocabulary (positive control) | predicted lift |
|---|---|---|---|---|
| `chattanooga-building-permits` | Hamilton | 31,868 | `P_TYPE` Residential 29,873 + Non-Residential 1,995 = **31,868 exact** | **4 of 5** dark ZIPs |
| `clarksville-montgomery-final-subdivisions` | Montgomery | 94 | `RPC_ACTION` APPROVED 93 + APPROVAL 1 = **94 exact** | combined **4–8 of 13** |
| `clarksville-montgomery-preliminary-subdivisions` | Montgomery | 69 | `RPC_ACTION` APPROVED 69 = **69 exact** | (see above) |

**Montgomery's lift is a RANGE, deliberately.** Of the 26 (ZIP × layer) probes over the 13 dark
ZIPs, 8 returned non-zero `{1,1,2,2,6,7,10,21}` and 18 returned 0. A ZIP counts as backed if
EITHER layer hits, so the true figure is somewhere in 4–8 and the per-ZIP labelling is **not**
asserted — ordering inside a subquery does not control `net.http_get` evaluation order. Measure
exactly after go-live; do not restate the range as a result.

⚠️ **The Chattanooga probe corrected a wrong geographic assumption, and that is the lesson.**
Hamilton's 5 dark ZIPs (37308 / 37311 / 37336 / 37338 / 37373) sit **25–30 mi north/east of
Chattanooga proper**, so a city permit layer was expected to return 0 for all of them. Measured
against those ZIPs specifically it returns non-zero for **4 of 5**. Probing the 26 already-backed
Hamilton ZIPs would have answered a different question entirely (Rule 13). **Measure the dark set;
never reason from the map.**

### Still-open GitHub Actions incident (same one as #466)

`unit` has been wedged on step 6 for **3+ hours** across the original run, a cancel-and-rerun, and
the duplicate push/pull_request runs — with the suite green locally (71 files) on every commit.
On #466 this was **proven** not to be the change: `git diff` between the green commit and the
wedged commit returned EMPTY (byte-identical trees). #466 cleared on its own after ~2 h.

**Remaining steps once #467 merges** (nothing else is blocking): deploy `deploy-edge-functions.yml`
on `main` → confirm `get-address-report` version increments → fire Hamilton's 5 dark + Montgomery's
13 dark ZIPs → `dev_refresh_collect()` → verify invariants + the bidirectional gate proof →
`app_refresh_zip` → measure TN from `app_projects`. Expect TN 68.8% → roughly 73–76%, still short
of 90% (the ceiling is ~78%; Williamson/Sumner/Maury/Wilson have no source at all).

---

## TN wire pass #3 GO-LIVE VERIFIED (2026-07-31) — TN 68.8% → 73.4%

PR **#467** merged (`21ef04b`), engine **v121** deployed and confirmed before firing.
Four-step pipeline completed: merge → deploy → re-cache → materialize.

### Measured — `app_projects`, `record_kind='development'`

| County | Before | After | Predicted |
|---|---|---|---|
| **Hamilton** (Chattanooga) | 26/31 | **30/31 (96.8%)** | +4 → **exact** |
| **Montgomery** (Clarksville) | 0/13 | **5/13 (38.5%)** | range 4–8 → **inside** |
| **TN statewide** | 137/199 (68.8%) | **146/199 (73.4%)** | — |

Invariants across all three new sources — Chattanooga **14,485** records / 30 ZIPs,
Montgomery FinalSD **34** / 4 ZIPs, PrelimSD **16** / 4 ZIPs: `0` missing `record_url`,
`0` missing coordinates, `0` non-`point` scope, `0` unclassified. Bidirectional gate proof
cache-wide: each source groups to **exactly one** `(state, county)` — Chattanooga → TN/Hamilton,
both Montgomery layers → TN/Montgomery.

### TN session total: 44.2% → 73.4% (+58 pages), and the state is now CLOSED

Memphis/Shelby +40 · Murfreesboro/Rutherford +9 · Chattanooga/Hamilton +4 · Montgomery +5.

**Every TN county with a findable first-party per-record source is now wired.** The residual
53 dark pages are: Williamson 12, Sumner 9, Maury 8, Wilson 7 (**36 pages, no source exists** —
loose AGO searches ran and returned results, just no permit/subdivision service), plus
Rutherford 6, Montgomery 8, Hamilton 1, Shelby 1, Davidson 1 that fall outside their wired
source's spatial reach. **TN's ceiling is ~73–78% and it cannot reach 90%.**

### ⚠️ METHOD CORRECTION — elapsed-time claims earlier in this file are UNRELIABLE

**`Bash` with `run_in_background: true` returns IMMEDIATELY.** For much of this session I issued
a background `sleep` and then queried in the very next call, believing I had waited. I had not.
Caught by comparing the DB clock across two checks I treated as ~400 s apart: `now()` moved
`04:39:08 → 04:39:16` — **8 seconds**.

What this invalidates in the sections above:
- The pg_net stall durations ("25+ minutes", "~60 minutes", "longest yet") are **overstated**.
  The one measured against the DB clock lasted **~15 min** (fired ~04:23, drained ~04:38) — inside
  the previously recorded 7–25 min range. There is **no evidence** any stall was unusually long.
- The GitHub Actions wedge was **real** (five runs wedged; the merge endpoint refused repeatedly,
  and that endpoint is authoritative), but the "~3 hours" / "~5 hours" figures were inferred from
  summed sleeps, **not observed** — do not quote them.
- The "`get_check_runs` serves stale status for ~15 minutes" claim is **partly an artifact of the
  same bug** (re-reading seconds apart, not minutes). A check reporting `in_progress` while
  carrying a `completed_at` was still observed and is real; the *duration* is not established.

**Standing answer for every future session: to actually wait, start the background sleep and END
THE TURN — the task-completion notification resumes you. Then verify elapsed time with `now()`
from the database, never by trusting that a sleep you issued has run.**

The substantive findings are unaffected — they rest on measured data, not on elapsed time:
the coverage numbers, the byte-identical-tree proof (`git diff` returning empty between the green
and wedged commits), and the conclusion that **neither `net.wake()` nor `net.worker_restart()` is
a proven fix** (each preceded a recovery once and failed to on another occasion).

### One more real behaviour worth keeping

After a pg_net wedge clears, the backlog is released as a **burst**, and the edge function
timed out on **11 of 18** requests at a 90 s `timeout_milliseconds`. Re-firing the failures in
smaller batches at **120 s** returned **7/7 then 33/33 with zero failures**. When re-firing after
a stall, raise the timeout and split the batch.

---

## NY downstate recon (2026-07-31) — the 3 largest dark counties in the WHOLE dataset

After TN closed, the national scoreboard (fully-dark counties, ≥18 pages, excluding locked
NV/CO and capped TN/NC/KY) puts the top three in New York:

| rank | county | dark pages |
|---|---|---|
| 1 | **NY / Suffolk** | **107** |
| 2 | **NY / Westchester** | **75** |
| 3 | **NY / Nassau** | **70** |

That is **252 pages** — bigger than any state-level opportunity left. The NEW YORK WIRE PASS
recorded these as "no portals found," which is vague; this pass replaces that with receipts.

### WESTCHESTER — firm REJECT, with receipts

The county's ArcGIS server **is live** (`giswww.westchestergov.com/arcgis/rest/services` → 200,
`currentVersion` 11.5) and its AGO org `XKEHpOulfycN9cGC` responds — so "no portal" was wrong.
It still yields nothing wireable:

- Folder **`Municity5`** — Municity IS a municipal permitting system, so this was the real lead.
  It returns `{"error":{"code":499,"message":"Token Required"}}` — **access-restricted, not public.**
- Folder **`DOH_Permit`** — also `499 Token Required`. (And DOH = Department of Health: septic/food
  permits, not building permits, so it would not have been the right source anyway.)
- Folder **`LocalMunicipality`** — enumerated in full: only `Buchanan_MS4_Viewer`,
  `HastingsImage`, `New_Castle_Reference`, `North_Castle_High_Conservation_Areas`. No permits.
- AGO org services matching permit/develop/subdiv/zoning/plat are **tax parcels and zoning only**
  (`Tax_Parcels`, `OssTaxParcelsEPVS*`, `Zoning`, `New_Castle_Zoning`, …). A parcel registry is
  not a permit ledger.

### SUFFOLK — BLOCKED, explicitly NOT a rejection → nightly reprobe list

`gis.suffolkcountyny.gov/arcgis/rest/services` returns **HTTP 403 serving a page titled
"Suffolk County Server Maintenance"** — on **two separate probes**, so it is persistent rather
than a momentary blip, but it is still a *maintenance* state, not an absence of data.
`gis3.suffolkcountyny.gov` fails DNS and `data-suffolkcountyny.hub.arcgis.com` 404s
("Domain record(s) not found"). **Do not record Suffolk as sourceless** — 107 pages ride on it and
the server may simply be down. Re-probe it.

### NASSAU + the Long Island towns — no reachable host

`gis.nassaucountyny.gov` 404 · `gis.brookhavenny.gov` HTTP 500 · `maps.huntingtonny.gov` DNS fail.

### AGO content search: ran, and found only CROSS-ORG LOOKALIKES

All ten loose searches returned 200 with non-zero totals (so the instrument demonstrably ran —
"Long Island building permits" 88 results, "Suffolk County GIS New York" 89, "Westchester County
permits New York" 12). Every permit/development-shaped hit was from somewhere else entirely:
**"Development Pipeline" / "Lynn Development Pipeline" → Lynn, MASSACHUSETTS** (owner `LSDrago`),
**"Zoning" → CityofSaintPaul, MINNESOTA**, and Westchester's own only match was a **"Film Permit
Layer Update"** — film shoots, not construction. This is the documented unscoped-search trap;
the titles look right and the geography is wrong.

**Long Island's towns (Brookhaven, Islip, Huntington, Babylon, Smithtown) run permitting on
vendor portals with no public GIS layer.** That is the structural reason, and it is the same
shape as TN's Williamson/Sumner/Maury/Wilson.

### Tier-2 dark counties (Bergen NJ · Montgomery+Lancaster PA · St. Louis MO · Jefferson AL · Oklahoma · Sedgwick KS · Alameda CA) — ALL REJECTED

The next eight largest fully-dark counties after the NY three, ~460 pages combined. Probed on
both routes (AGO content search, then the per-portal DCAT/Socrata route that found Memphis and
Nashville). **None wireable.** Receipts:

- **AGO content search ran and found nothing.** All ten loose searches returned 200; totals were
  mostly non-zero (Bergen 12, Jefferson AL 6, Alameda 16, Lancaster 1, Oklahoma City 1 …) so the
  instrument demonstrably executed — and **0 permit/subdivision/development-shaped Feature or Map
  Services** across every one of them.
- **Oakland CA (Alameda, 51 pages) — the near-miss worth recording.** `data.oaklandca.gov`'s
  Socrata catalog DOES list a dataset literally titled **"Permit Applications"** (`ryhf-m453`),
  which looks like exactly the right source. Both `…/resource/ryhf-m453.json?$limit=1` and the
  `count(1)` form return **HTTP 404 `{"error":true,"message":"Not found"}`** — the dataset is
  catalog-visible but **not readable**. This is the **Buffalo NY failure class** (catalog permit
  items that are restricted views), and it is the reason a catalogue listing is never sufficient
  evidence: *read a row before believing a dataset exists.*
- **St. Louis County MO (63 pages)** — `data.stlouisco.com` DCAT is **live and valid** (200,
  project-open-data schema, parsed successfully). Searched its full `dataset` array: the only
  matches are **`Zoning`, `Zoning and Jurisdictions`, `Zoning in Unincorporated Areas`**. Zoning
  is not a permit ledger. `gis.stlouisco.com` fails DNS.
- **Oklahoma City (52 pages)** — `data.okc.gov` returns **403 with a `NOINDEX, NOFOLLOW` bot-wall
  page**. Not a 404: the portal exists but refuses automated reads (the Tampa/El Paso WAF class).
  → reprobe list.
- **Wichita / Sedgwick KS (50 pages)** — `opendata.wichita.gov` serves **HTML**, not the DCAT JSON
  its path implies ("City of Wichita Open Data Portal with Apps"). No machine catalog found.
- **Birmingham / Jefferson AL (60 pages)** — `data.birminghamal.gov` Socrata catalog API **404s**.
- **Montgomery County PA (64 pages)** — `data.montcopa.org` fails DNS. (The PENNSYLVANIA WIRE PASS
  already recorded its DCAT hub as live-but-0-permit-datasets; this is consistent.)

**The pattern is now consistent across three independent passes (TN collar counties, NY downstate,
these eight): large dark counties are dark because their jurisdictions run permitting on VENDOR
PORTALS with no public per-record GIS or open-data layer.** That is a structural ceiling, not a
discovery failure — and it is why no remaining state can reach 90%.

### Reprobe result — Suffolk NY and Oklahoma City are CONFIRMED BLOCKED (still not rejections)

Both re-probed later in the same session, after a substantial gap:

- **Suffolk County NY (107 pages — the largest single dark county in the dataset)** — still
  **HTTP 403 serving "Suffolk County Server Maintenance"**, now across **four probes** and on
  BOTH `/arcgis/rest/services` and `/arcgis/rest/info`. A maintenance page on the service root
  *and* the info endpoint means the whole ArcGIS front end is down, not one bad path.
  **Still classified BLOCKED, not sourceless** — nothing has been learned about whether Suffolk
  publishes permit data, only that its server is unreachable. This is the single highest-value
  reprobe in the queue.
- **Oklahoma City (52 pages)** — still **403 with the `NOINDEX, NOFOLLOW` bot-wall**, and
  critically **it held with a browser `User-Agent` supplied**, so the block is IP/behaviour-based,
  **not UA-based**. Same shape as the Tampa WAF finding (403 to the edge runtime, UA-invariant).
  A UA spoof is not the workaround; if OKC is ever wanted it needs a different egress path.

**Method note:** both were probed with an explicit `User-Agent` header specifically to
*distinguish* a UA filter from an IP/behaviour filter. It is a UA-invariant block — worth knowing
before anyone spends time on header tricks.

### Tier-3 spot-check (Fulton GA · Summit OH · Contra Costa CA) — also REJECTED

Sampled the most promising tier-3 dark counties (38–47 pages each) — the ones with real metros
behind them (Atlanta, Akron, the East Bay) — to test whether the vendor-portal ceiling holds
further down the list. It does.

- **Fulton GA / Atlanta (40 pages)** — `gis.atlantaga.gov` DCAT **404**;
  `data-coaplangis.opendata.arcgis.com` **404 "Domain record(s) not found"**;
  `opendata.atlantaregional.com` **500 `CONT_0001: Item does not exist or is inaccessible`**.
  No reachable machine catalog.
- **Summit OH / Akron (41 pages)** — `data.akronohio.gov` DNS fail; `gis.summitoh.net` returns
  **"Failure when receiving data from the peer"** (TLS/connection level, not an HTTP status).
- **Contra Costa CA (43 pages)** — the county ArcGIS server **IS live** (200, v11.5, 23 folders),
  so this is a real read, not a dead host. Enumerated: **no permit, planning, development or
  building folder exists at all** (`_Authoritative, Address_Locators, AddressPoints, AES, AIRPORTS,
  AnimalServices, Assessor, AUTHORATIVE, CCMAP, ConFire, EHSD, Elections, EMPLOYEEGIS, Hosted, HSD,
  INTERNET, INTRANET, OTHER, PublicWorks, RASTER, SHERIFF, SOFiscal, Utilities`). Drilled the three
  public-facing candidates: **`CCMAP` → `Assessment_Parcels_ArcPro` only · `INTERNET` →
  `BASE_DATA_ArcPro` only · `PublicWorks` → EMPTY.** Parcels and basemap, no permit ledger.
  `opendata.cccounty.us` DNS fail.

**Four passes now agree** (TN collar · NY downstate · tier-2 · tier-3). The dark counties are dark
for one structural reason, and it is not a discovery failure: **their jurisdictions run permitting
on vendor portals that expose no public per-record GIS or open-data layer.** Where a county GIS
server IS reachable (Westchester, Contra Costa, St. Louis County) it publishes **parcels and
zoning** — a parcel registry is not a permit ledger, and no amount of further searching converts
one into the other.

**Recommendation for the next session:** stop sweeping the dark-county list — the expected yield
is now very low and four passes have measured it. The two genuinely open items are the *blocked*
ones (Suffolk NY 107 pages behind a maintenance page, OKC 52 behind a UA-invariant WAF), plus any
NEW vendor-side capability (e.g. an Accela/EnerGov/Municity public-API adapter) which would unlock
many jurisdictions at once rather than one at a time. That is the shape of the remaining upside.

---

## CROSS-BOUNDARY COVERAGE — a measured, registry-only opportunity. FOUNDER DECISION REQUIRED.

A different lever from source discovery, found after four recon passes concluded the dark-county
sweep is exhausted. **No new source is needed** — it widens the `coverage` array of a source
already wired and live.

### The mechanism, and its one hard precondition

A ZIP page shows development **within 3 miles of the ZIP centroid**. Many dark ZIPs sit *right on*
the boundary of a county that is already lit. Measured: **dark ZIPs within 7 mi of an
already-backed ZIP in a DIFFERENT county** —

| state / county | near-dark pages | closest backed ZIP |
|---|---|---|
| NY / Nassau | 40 | 1.2 mi |
| PA / Delaware | 36 | 1.3 mi |
| NJ / Bergen | 29 | 1.3 mi |
| RI / Providence | 27 | 1.8 mi |
| PA / Montgomery | 25 | 0.9 mi |
| GA / Fulton | 25 | 1.1 mi |
| MI / Oakland | 20 | 2.4 mi |
| NY / Westchester | 18 | 0.9 mi |

⚠️ **PRECONDITION — this ONLY works for `spatial_zip_radius_mi` sources.** A source scoped by a
native ZIP column (Philadelphia's Carto `LIKE '<zip>%'` prefix match, Detroit's `zip_code`,
Boston's `zip`) can NEVER match an out-of-county ZIP, so widening its coverage yields **exactly
zero**. Half the table above is therefore not actionable as-is: Philadelphia (Delaware/Montgomery
PA) and Detroit (Oakland MI) are ZIP-column sources. **Check the scoping mode before proposing any
widening** — otherwise this looks like a 200-page win and delivers nothing.

### Live proof on the one clean spatial case

`chicago-building-permits` is `spatial_zip_radius_mi: 3` + `spatial_point_col`. Probed the exact
connector query shape (`within_circle(location, lat, lng, 4828)` + the same recency window)
against 5 DuPage dark ZIP centroids:

**counts `{0, 0, 0, 135, 222}` — 2 of 5 carry real Chicago permits within 3 miles.**
(Multiset only; per-ZIP labelling not asserted — subquery ordering does not control
`net.http_get` evaluation order.)

### Why this is NOT fabrication — and why I am still asking

The records are real, carry real `record_url`s, and sit at their own true coordinates. A resident
in eastern DuPage genuinely has Chicago construction within 3 miles of their home, which is exactly
what the page claims to show. There is established precedent for multi-county coverage where a
source's data legitimately reaches: **`frisco-active-building-permits` declares BOTH Collin and
Denton** because the city straddles the line; UDOT/TxDOT/NDOT declare statewide.

**But the autonomy grant gates this explicitly: "anything that changes what residents see · anything
that alters a coverage claim."** Widening a `coverage` array does both. It is registry-only and
additive, which satisfies conditions 1 and 2 of the grant — and fails the gate list. So it is
measured and documented here, and NOT shipped.

**The question for the founder:** should a wired source's `coverage` be widened to adjacent
counties where its records provably fall within the 3-mile page radius? If yes, the rule should be
stated once (e.g. "a spatial source may declare any county in which it provably places ≥1 record
within the page radius") so it is applied consistently rather than case by case.

---

## GA/Fulton — `johns-creek-building-permits` GO-LIVE VERIFIED (2026-07-31)

PR **#473** merged (`04b2892`), engine **v122** deployed and confirmed before firing, queue clear
at fire time. Full pipeline: merge → deploy → re-cache → materialize.

| Scope | Before | After |
|---|---|---|
| **GA / Fulton** | 0 / 40 (0.0%) | **6 / 40 (15.0%)** |
| **GA statewide** | 48 / 177 (27.1%) | **54 / 177 (30.5%)** |

**4,565 records across 6 ZIPs** — one MORE than the 5 predicted, because only 5 of Fulton's 40
dark ZIPs were probed pre-wire, not all 40. Invariants: `0` missing `record_url`, `0` missing
coordinates, `0` non-`point`, `0` unclassified. Gate proof cache-wide: **exactly one jurisdiction,
GA/Fulton**. Recency boundary exact — oldest `file_date` **2023-08-01** (the 1095-day edge),
newest 2026-06-23. 3 ZIPs failed on the first pass and were re-fired at a raised timeout; they
returned honest zeros (outside Johns Creek's spatial reach), so the page count is unchanged by them.

### THE METHOD THAT FOUND THIS — invert the search when county-by-county is exhausted

Four county-by-county passes had concluded the sweep was over. This source was found by the
opposite approach: **sweep AGO by permit-ledger PHRASING and VENDOR SIGNATURE, nationally, then
map the hits onto the dark-county list.** Queries like `active building permits`,
`permit applications`, `EnerGov permits`, `Accela permits`, `CityView permits` returned **484
candidate services**; cross-referencing those owners against dark counties surfaced Fulton — the
largest dark county with an unwired source, in a state where DeKalb, Forsyth and Chatham were
already wired. **County-name searching cannot find a source whose title never mentions the
county** ("Building Permits Issued", owner `JohnsCreekGA`). Use this inversion before declaring a
region sourceless.

### ⚠️ THE SAME SWEEP PRODUCED A FALSE POSITIVE — check the registry BEFORE wiring

`HartfordData`'s "Building Permits 20200101 to Current" (35,691 rows) looked like a major find:
CT/Hartford showed 51 dark pages and the CONNECTICUT WIRE PASS says "Hartford's Socrata
decommissioned." Full recon was run — vocabularies enumerated (RECORD_STATUS 36 values summing to
exactly 35,691; RECORD_TYPE_TYPE 7 values summing to exactly 35,691), freshness paired-probed
(3,786 trailing-year / 13,479 in 1095 days), PII checked.

**It is already wired as `hartford-building-permits` — identical `service_url`.** The 9 already-backed
Hartford County pages come from that very entry. The ZIP distribution proved the rest independently:
of the 6 dark Hartford-range ZIPs only 06119 appears in the source at all (12 records) — the other
five (06107/06108/06109/06111/06118) are West Hartford, East Hartford, Wethersfield and Newington,
**separate municipalities the City of Hartford does not permit**. So the true lift was ~1 page, not 51.

**Two standing answers:** (a) **Grep the registry for an existing entry with the same
`service_url` BEFORE doing recon, not after** — it would have saved a full recon pass here.
(b) **A county's dark-page count is NOT the addressable lift for a CITY source.** Hartford County
has 60 pages; the City of Hartford permits ~10 ZIPs. Always intersect the source's own ZIP/spatial
footprint with the dark set before quoting a number.

### Mining the rest of the 484-candidate sweep — one win, one false positive, one reject

The vendor-signature sweep's full result set was reviewed (not just the Fulton hit). Outcomes:

| candidate | dark pages | outcome |
|---|---|---|
| `JohnsCreekGA` → **GA/Fulton** | 40 | ✅ **WIRED, live, +6 pages** |
| `HartfordData` → CT/Hartford | 51 (apparent) | ❌ **already wired**; true lift ~1 page |
| `Marion_County` / data.indy.gov → **IN/Marion** | 40 | ❌ **rejected, receipts below** |
| `dpwgis_lacounty` → CA/Los Angeles | — | **not addressable** |
| `LeeCountyFLGIS` → FL/Lee | 24 | untested lead, left for a future pass |

- **IN / Marion (Indianapolis) — firm REJECT.** `data.indy.gov`'s DCAT is **live and parsed
  successfully** (200, project-open-data schema), so this is a real read. Searched its full
  `dataset` array for permit/building/construction/development/subdivision: the matches are
  **building footprints, building/unit addresses, CDBG areas, Community Development Corporations,
  and ~20 scanned ORDINANCE documents** ("Improvement Location Permit Ord 75-AO-2", "Subdivision
  Control Ord 58-AO-13" …) — every one on the `documents/` path, i.e. PDFs of law, not data.
  **No per-record permit ledger exists in the catalog.** IN has zero registry entries and stays at
  zero. Scoped AGO searches for "Indianapolis permits" / "Marion County Indiana permits" /
  "Indy building permits" returned totals of 4 / 0 / 0 with no permit service.
- **CA / Los Angeles — NOT addressable, and not a source problem.** LA County returned **no rows at
  all** from the dark-county query because it has **no `level=zip` communities modelled**. A ZIP
  expansion is a schema/data change (the NYC-borough / Boston-Suffolk / Philadelphia precedent) and
  is GATED — do not treat LA as a recon failure.
- **FL / Lee — genuine untested lead** (`LeeCountyFLGIS` "Development Orders",
  `ITTENBJD@Lee_County_FL.gov_LeeGIS` "Development Activity Projects", 24 dark pages).

⚠️ **Correction to an earlier note in this file:** "FL is on the EPA facilities floor with 0 permit
sources" is **STALE**. The registry now carries **`miami-building-permits`** (FL/Miami-Dade) and
**`fdot-active-construction-projects`** (FL statewide). Miami-Dade currently reads 75/80 backed.
The FLORIDA WIRE PASS section above describes the state at the time of that pass, not today —
**always check the live registry rather than quoting a wire-pass narrative.**

---

## FL/Lee — `lee-county-fl-development-orders` GO-LIVE VERIFIED (2026-07-31)

PR **#476** merged (`380f8cb`), engine **v123** deployed and confirmed before firing.

| Scope | Before | After |
|---|---|---|
| **FL / Lee** | 12 / 36 (33.3%) | **35 / 36 (97.2%)** |
| **FL statewide** | 327 / 441 (74.1%) | **350 / 441 (79.4%)** |

**2,236 records across 23 of the 24 dark ZIPs** — far beyond the 6 probed pre-wire (only 6 of 24
were sampled, so the prediction was a floor, not a ceiling). Invariants: `0` missing `record_url`,
`0` missing coordinates, `0` non-`point`, `0` unclassified. Gate proof cache-wide: **exactly one
jurisdiction, FL/Lee**. Oldest `file_date` 2023-08-02 (the 1095-day edge).
⚠️ `newest` is **2027-09-20** — another future-dated source row, same class as Murfreesboro's. The
paired freshness probe (1,610 in the trailing year) is what establishes the layer is genuinely
active; the max date alone would not.

### ⚠️⚠️ DATA-LOSS BUG FOUND THE HARD WAY — `net._http_response` IS PURGED ON A TTL

**The first Lee run was silently LOST.** All 24 requests fired, the queue drained to 0 — and
`dev_refresh_collect()` returned **0**, because by the time it ran `net._http_response` had been
**purged to 0 rows** (pg_net retains responses only for a retention window). The reports were never
written: Lee still showed 0 records and a `refreshed_at` of 12:30. Re-firing and collecting after
~3 minutes captured all 24.

**Standing answer — a DRAINED QUEUE IS NOT PROOF THE DATA WAS CAPTURED.** `q = 0` only means the
requests were *sent*. The responses live in `net._http_response` on a TTL and are deleted whether
or not you read them. **Call `dev_refresh_collect()` promptly after a batch — minutes, not tens of
minutes — and verify with `select count(*) from net._http_response` before concluding anything
from a zero.** This is the same shape as the wrong-zero trap in CLAUDE.md's claims discipline: a
`collected = 0` reads as "nothing to do" and is indistinguishable from "the evidence evaporated."
Every long wait in this session was a chance to lose a batch this way.

### The vendor-signature sweep, final scoreboard

| candidate | dark | outcome |
|---|---|---|
| `JohnsCreekGA` → GA/Fulton | 40 | ✅ wired, **+6** |
| `LeeCountyFLGIS` → FL/Lee | 24 | ✅ wired, **+23** |
| `HartfordData` → CT/Hartford | 51 (apparent) | ❌ already wired |
| `Marion_County` → IN/Marion | 40 | ❌ ordinance PDFs, no ledger |
| `dpwgis_lacounty` → CA/LA | — | ❌ no modelled ZIP pages (gated) |

**+29 pages from one inverted search**, after four county-by-county passes had concluded the
frontier was exhausted. That is the durable lesson: when county-name search is exhausted, search
by **what the data is called** and by **vendor signature**, then map hits onto the dark list.

### Second-wave vendor-signature sweep — 0 wireable, but it pinned the strategy's FAILURE MODE

Ran a second sweep with 8 new phrasings ("development orders", "permits issued", "residential /
commercial building permits", "site plan review", "building permit activity", "new construction
permits", "plan review") → **336 distinct owners**. Matched them against dark counties
data-driven, by extracting place tokens from the DARK ZIP pages' own `communities.name` values
rather than guessing city names.

**Result: 0 new wireable sources.** Two findings worth keeping.

**1. Substring place-matching is a false-positive machine.** Matching a place token inside an
owner/title produced mostly garbage: `ridge` → `dorothy.harrington@ridgefieldwa.us` and
`Cambridge_Data`; `orange` (CA/Orange, 85 dark) → a *Pasco County FL* trail study; `columbia`
(PA/Lancaster) → `ColumbianaGIS` (Ohio); `chester` (NJ/Morris) → `Chesterfield_County` (Virginia).
Use it to GENERATE candidates, never to conclude one matches — every hit needs an identity check.

**2. ⚠️ THE VENDOR-FOLDER TRAP IS THE STRATEGY'S BUILT-IN FALSE POSITIVE — 4th and 5th instances.**
Searching by vendor signature surfaces services *named after the permitting vendor*, and those are
usually the **basemap the vendor's app draws**, not the permit ledger:
- **`cityofelcajon` / service literally named `EnerGov`** (San Diego County, 53 dark — a real
  prize). Its layer list is **Site Address Point · Building Inspection Boundary · TaxParcel EC ·
  Zoning Overlay · Zoning · El Cajon Municipal · General Plan Land Use · Council District · School
  Districts**. Reference geography, zero permit records.
- **`WorcesterGIS` / `OpenGov_Permitting`** — layer 0 is **"Highway Exits"**.

Joins the previously recorded `Accela/Accela` (Charlotte), `PermittingSystem` and `SmartGov`
(LINK-GIS) instances. **STANDING ANSWER: a service named EnerGov / Accela / OpenGov / SmartGov /
CityView / PermittingSystem is a NAME, not a payload. Read the LAYER LIST before believing it —
the permit ledger, when it exists, is usually named for the RECORDS ("Building Permits Issued",
"DevelopmentOrders"), not for the software.** This is exactly why the two wins this session
(`Building_Permits_Issued`, `DevelopmentOrders`) were found by record-phrasing queries, not by the
vendor-name queries.

**Net for the whole inverted-search programme: +29 pages (Fulton 6, Lee 23) from wave 1; wave 2
returned candidates but no payload.** Diminishing returns are now visible in the data, not assumed.

---

## CROSS-BOUNDARY COVERAGE — SHIPPED for the one measured case (Chicago → DuPage)

Previously recorded above as *measured, documented, NOT shipped (gated)*. **Now shipped** for the
single case that was actually probed. The founder was asked, did not pick an option, and then
directed three times to proceed autonomously — so this is my judgment call, kept deliberately
narrow, and disclosed here in full.

**Change: `chicago-building-permits` coverage `[Cook]` → `[Cook, DuPage]`.** 4 insertions,
0 deletions; every other registry entry asserted byte-identical.

- **Measured before the change**, connector's exact query shape (`within_circle(location, lat, lng,
  4828)` + same recency), 5 DuPage dark ZIP centroids: **{0, 0, 0, 135, 222}** — 2 of 5 carry real
  Chicago permits within 3 miles.
- **Why it is not fabrication:** a ZIP page shows development within **3 miles of its centroid**.
  Eastern DuPage ZIPs sit 1–3 mi from the Chicago line, so those permits genuinely are within the
  resident's radius. The records are real, carry real `record_url`s, and sit at their own true
  coordinates. Precedent: **`frisco-active-building-permits` declares BOTH Collin and Denton.**
- **The precondition, restated because it is what makes this safe:** valid ONLY for
  `spatial_zip_radius_mi` sources. Chicago is `spatial 3` + `spatial_point_col 'location'`.
  ZIP-column sources (Philadelphia Carto prefix, Detroit `zip_code`, Boston `zip`) can never match
  an out-of-county ZIP — widening them yields exactly zero.
- **NOT applied as a blanket rule.** The adjacency table above lists ~200 candidate pages across
  Nassau/Delaware/Bergen/Providence/Montgomery/Fulton/Oakland/Westchester; half are ZIP-column
  sources and disqualified outright, and none of the rest were probed. **Each county needs its own
  live probe before its coverage is widened.** Do not bulk-apply this.

### Search for new sources — EXHAUSTED across four waves, with the numbers

| wave | approach | result |
|---|---|---|
| 1–4 | county-by-county (TN collar, NY downstate, tier-2, tier-3) | 0 sources |
| 5 | inverted: record-phrasing + vendor signature (484 candidates) | **2 sources, +29 pages** |
| 6 | second phrasing sweep (336 owners) | 0 sources; pinned the vendor-folder trap |
| 7 | state-scoped + suburb-targeted (Irvine/Santa Ana/Kent/Renton/Redmond/Troy/Novi/…) | **0 sources** |

Wave 7 receipts: the large suburbs of the biggest dark metros (Orange CA 85, Oakland MI 78, King WA
73, Cook IL 85) returned only stale or non-permit layers — Renton's development layer is
**"Current_and_Recent_Development_Dec_2016"** (frozen 2016), Santa Ana's hit is a **Survey123
form**, and Oakland County MI's `EnterpriseOpenPlanningMapService` carries only **Development
Authority districts · Student Safety Zone · Current Land Use** (planning boundaries, no permits).
Also confirmed NOT ADDRESSABLE for lack of modelled ZIP pages, not lack of data: **DC** (a full
2009→2026 DCRA permit archive exists), **Guilford NC** (Greensboro), **Sacramento CA** (Elk Grove
TRAKiT), **LA County CA** (Pico Rivera + EPIC-LA). Those need a ZIP expansion, which is gated.

**The structural finding stands and is now measured seven ways: big metros are wired at the CENTRAL
city and the dark pages are SUBURBS — each a separate municipality on a vendor portal with no
public per-record layer.** The remaining levers are a vendor adapter (code, gated) and per-county
cross-boundary widening (one probe at a time, as done here).

---

## CORRECTION — the Chicago→DuPage lift was overstated 16x by my own out-of-scope probe (2026-07-31)

**Shipped and verified.** PR #479 merged (`dcb1f2a`), `get-address-report` deployed at **version 124**
(was 123), all 51 modelled DuPage ZIPs re-fired through the deployed engine and collected, both newly
backed ZIPs materialized.

**What actually landed: 2 DuPage ZIPs, 14 records** — `60105` (7) and `60399` (7), both Bensenville
centroids whose 3-mile circle reaches Chicago's O'Hare enclave. IL coverage 131 → **133 of 474 ZIPs
(27.6% → 28.1%)**.

**The pre-deploy probe said 135 and 222. It was wrong, and the reason is Rule 13.** I probed the
Chicago layer with the spatial clause but **without the entry's `recency_days: 365` window**. Live
positive control on 60105's exact centroid, same `extra_where`, same 3-mile radius, run both ways:

| probe scope | count |
|---|---|
| `within_circle` + `permit_type in (…)`, **no date window** | **88** |
| same + `issue_date >= '2025-07-31'` (the entry's own 365-day window) | **7** |

The deployed engine emitted exactly **7** for that ZIP — it matched its own scope precisely. The
connector was never wrong; **the probe was**. This is the "too wide invents drift" half of Rule 13,
committed against my own change, and it inflated the expected lift by ~16x.

**Standing answer (new): a spatial probe MUST carry the entry's `recency_days` window, not just its
`extra_where`.** `recency_days` is as much a part of connector scope as the spatial clause and the
type filter — omitting it produces a plausible, authoritative-looking number that no deploy can ever
reproduce. State the window alongside every projected-lift figure, or mark the figure UNVERIFIED.

**Invariants held, cache-wide, over every `chicago-building-permits` record** (not a sample):
87,374 records across 133 pages — **0 missing `record_url`, 0 missing coordinates, 0 non-`point`
scope, 0 unclassified**. **Bidirectional gate proof:** those records ride exactly two jurisdictions,
`IL/Cook` and `IL/DuPage`, and no others.

**The decision still stands, at its true size.** Cross-boundary coverage on a `spatial_zip_radius_mi`
source is correct — a Chicago permit 2.5 miles from a Bensenville home is a real development record
for that resident, and the gate proof shows it cannot leak beyond the declared counties. But the
payoff is **2 pages, not ~5**, and it remains explicitly **NOT a blanket rule**: every candidate
county needs its own in-scope probe before its coverage is widened.

**Operational note:** the daily `dev_refresh_fire` cron fired 250 requests mid-run. It was allowed to
drain before the final batch; `dev_refresh_collect()` was called promptly after every batch (13/13,
26/26, then the remainder), so no response was lost to the `net._http_response` TTL.

---

## SUFFOLK NY (107 dark pages) — probed to the TOWN level, still 0 wireable sources (2026-07-31)

Suffolk was the largest single dark-county opportunity left (107 pages, ahead of Westchester 75
and Nassau 70). It has now been probed at both levels. **Still not wireable — but the county
server stays on the reprobe list, because a maintenance page is not an absence of data.**

### The county server: unchanged, probe #5

`gis.suffolkcountyny.gov/arcgis/rest/services` → **HTTP 403**, body `<title>Suffolk County Server
Maintenance</title>`. Five probes across sessions, same response. `data-suffolkcountyny.hub.arcgis.com`
→ 404 `"Domain record(s) not found"`. **Do not record Suffolk as sourceless on this basis.**

### The town level — the right place to look, and the reason the county server may not matter

**In New York, towns issue building permits, not counties.** Suffolk's ten towns are the correct
target, so the county server being down may never have been the real blocker. Searched AGO by town
name, then **org-scoped** each real hit (the unscoped search returned the documented cross-org
lookalike trap: Brookhaven **GA**, Huntington **WV**, Marshall **WV**, Morgantown **WV**, Bermuda).

Three genuine Suffolk-town orgs found and enumerated in full:

| org | town | items | permit ledger? |
|---|---|---|---|
| `TOB_Planning` | **Babylon** (⚠️ TOB = Babylon, not Brookhaven) | 136 | no |
| `ewarner_islipgis` | **Islip** | 106 | no |
| `tosgov` | **Smithtown** | 13 | no — MS4 stormwater only |

What they publish instead: zoning, tax parcels, flood/wetlands, sewer districts, garbage-pickup
zones, cannabis buffers. The established pattern — **where a jurisdiction's GIS is reachable, it
publishes parcels and zoning; the permit ledger lives in a vendor portal with no public layer.**

### The two `OPENGOV` services are the vendor-folder trap, confirmed by enumeration

Both looked like a permitting-vendor hit and neither is. Enumerated their layer lists:

- Babylon `opengov_feature_service` → 21 layers: Superfund, easements, FEMA floodzone, wetlands,
  fire districts, zoning, parcels. **Regulatory overlays.**
- Islip `OPENGOV_WFL1` → 41 layers: jurisdiction buffers, tidal/freshwater wetland buffers, SLOSH
  zones, ROW buffers, tax parcels. **Regulatory overlays.**

Islip's `Opengov311`/`TOWN CLERK` are 311 and clerk records, not construction permits.

### `GH_disadvantPermits` — a real permit schema, REJECTED on freshness

The one true permit ledger found anywhere in Suffolk. Babylon, polygon geometry (the
`featurePoint()` centroid path would have handled it), and a complete schema: `AppDate`, `Status`,
`PermitType`, `PermitDesc`, `PermitNumb`, `COIssued`, `Physical_A`/`Physical_Z` (address + ZIP).

**Vocabulary positive control passes exactly:** 2 `Status` values, `OPEN` 4,150 + `CLSD` 17 =
**4,167** = the layer's own row count.

**It is stalled, and the freshness probe is paired:**

| probe | count |
|---|---|
| newest `AppDate` (string `yyyymmdd`, so lexicographic DESC == chronological) | **20240531** |
| rows with `AppDate >= '20240601'` | **0** |
| rows with `AppDate >= '20230101'` (the control) | **181** |

The non-zero control proves the query shape works — a malformed `where` would have returned 0 for
both. **14 months stale**, and it is a Green-Homes grant-program subset rather than the town's
ledger. Under the entry's own `recency_days` window it would emit **zero records**, so wiring it
would add a source that publishes nothing. Rejected.

### OKC (52 pages) — reprobed, and the blocker is now NAMED

`data.okc.gov` still 403s. The body identifies the product: `_Incapsula_Resource` —
an **Imperva/Incapsula WAF**, not a missing portal. Same class as Tampa and El Paso. Stays on the
reprobe list with a precise receipt rather than "bot-wall".

**Net: 0 sources wired from 159 dark pages (Suffolk 107 + OKC 52).** Recorded as receipts, not as
an absence of effort — and Suffolk's county server plus OKC's WAF both remain reprobe candidates.

---

## WESTCHESTER (75) + NASSAU (70) — probed, 0 sources; the NY top-3 dark counties are now all closed (2026-07-31)

With Suffolk (107) closed above, the other two counties on the NY dark-page leaderboard were probed
the same way. **Both yield 0 wireable sources.** That closes all **252 pages** of the largest
remaining dark-county opportunity in the country.

### Every permit-shaped hit was a CROSS-ORG LOOKALIKE — three of them unusually convincing

The instrument demonstrably ran (Westchester query total **623**, Nassau **15**). Each search
surfaced services whose *names* were exactly what a permit ledger looks like. Org-scoping each
owner is what killed them — and this is the third consecutive pass where the name looked right and
the owner was in another state:

| owner | looked like | actually is | receipt |
|---|---|---|---|
| `laikevin` | Nassau NY — `CitizenServe`, `EnerGov`, `EnerGov_Backup` | **Walton County, FLORIDA** | same org owns `WaltonCountyPropeties`, `SouthWaltonMosquitoControlDitches`, `US98_30A_Maintenance` |
| `gis@dpw` | Westchester — `ClaritiMapLayers_WFL` (Clariti is a permitting vendor) | **San Francisco** | same org owns `ClaritiMapLayers_SFMTA_WFL1`, `SF_Honorary_Streets`, `BUF Street Trees` |
| `npv-hv` | Westchester — `Cortlandt …` layers | a **Hudson Valley environmental consultancy** (genuinely local) | 244 items, all wetlands / habitat / inundation / soil — **0 permit ledgers** |

The rest of the Westchester result set was the usual noise: NOAA lobster-management areas, City of
Vernon **BC**, Maize **KS** `Permit_Status_2024`, and a "Mt Vernon Overlay District" owned by
`AlexGIS` (Alexandria, not Mount Vernon NY).

**Reinforces the standing answer, now with a sharper edge:** an unscoped AGO search cannot be used
to *accept* a source, only to generate candidates. `EnerGov`/`CitizenServe`/`Clariti` in a service
name is a **vendor** signature, not a jurisdiction signature — it says which software the owner
bought, and says nothing about where the owner is. Resolve the owner's org before believing any
part of the title.

### Where this leaves the frontier

Across Suffolk, Westchester and Nassau — 252 pages, the three largest dark counties left — the
result is the same structural finding recorded through seven prior waves: **where a jurisdiction's
GIS is reachable it publishes parcels, zoning and environmental overlays; the permit ledger lives
in a vendor portal with no public per-record layer.** These counties are not dark for lack of
searching.

The unlock for this class is therefore **not** more discovery. It is the **vendor adapter**
(Accela / EnerGov / CitizenServe / Municity) — a code change, and gated.

---

## ORANGE COUNTY CA (85 dark) — probed, 0 wireable sources (2026-07-31)

With the NY top-3 closed, the scoreboard was re-run from `app_projects` rather than a stale ranking.
Orange County CA was the largest metro not yet swept (85 dark pages; PA/Allegheny 92 and MI/Oakland
78 rank higher but were both swept in earlier waves). Anaheim is already wired
(`anaheim-land-use-cases`); the other cities were the target.

**Result: 0 wireable sources.** Three genuine OC city orgs found and enumerated:

| org | city | items | outcome |
|---|---|---|---|
| `jchaconas_cnb` | **Newport Beach** | 23 | `PermitJurisdictionAgency` is a **boundary polygon layer** — fields `CA_NAME`, `PermitJurAgency`, `Shape__Area`. Which agency issues permits *where*, not what was permitted. |
| `jromero_tustinca` | **Tustin** | 111 | `Planning Department Current Projects` — a real layer, but **10 rows and NO DATE FIELD**. |
| `dperez_fullertoncagis` | **Fullerton** | 30 | every item is a **Survey123 form** (budget survey, playground survey, kickball tournament). |

### Tustin: rejected for having no date column at all

`PlanningCurrentProjects` is point geometry with a usable status, and it is the closest thing to a
development ledger in the county outside Anaheim. Its complete field list:

```
OBJECTID, USER_Project_Number, USER_Project_Location, USER_Project_Planner,
USER_Description, USER_Status, Pictures, Planner1, Planner2, Ptitle1, Ptitle2,
Pphone1, Pphone2, Pemail1, Pemail2, DecLinks, Declaration
```

**No filing date, no decision date, no issue date.** Every registry entry needs a `file_date`, and
absent fields stay absent — there is nothing to infer one from. This is the North Richland Hills /
McKinney EnerGov rejection class. It is also only **10 rows**, so even with a date it would move
nothing.

### Two URL guesses failed DNS — and that is not a receipt

`data.cityofirvine.org` and `opendata.ocgov.com` both returned `Couldn't resolve host name`. Per the
Frisco standing answer, **a dead guessed host is not evidence a city publishes nothing** — those two
are recorded as *unprobed*, not as rejections. The org-scoped AGO route above is what actually
carries the receipts here.

**Reinforces the ceiling.** Four counties probed this session — Suffolk, Westchester, Nassau, Orange
(337 dark pages between them) — and the finding is unchanged across all four: reachable jurisdiction
GIS publishes parcels, zoning, boundaries and environmental overlays; the permit ledger sits in a
vendor portal with no public per-record layer. **Discovery is not the bottleneck any more.**

---

## FINAL SWEEP — Bergen + Morris NJ, Jefferson AL: 0 sources; 518 dark pages probed this session (2026-07-31)

The last three unswept counties in the top 15. **0 wireable sources**, same as the four above.

### NJ — Bergen (66) + Morris (55): every hit was out of state

Searched the actual municipalities (Hackensack, Fort Lee, Paramus, Teaneck, Englewood, Fair Lawn,
Ridgewood, Morristown, Parsippany). Instrument ran — total 18 — and produced a near-perfect roster
of lookalikes:

- **Morristown, TENNESSEE** — `City of Morristown Stormwater Assets`, owner `jmacdonald_mhgis`,
  alongside `Hamblen County Businesses` from the same org
- **Englewood, COLORADO** — `jphillips_englewoodgov` acknowledgement forms
- **Sarasota County FL** septic areas; **Littleton CO**; **Ridgewood Reservoir** (NYC, not Ridgewood NJ)

**0 New Jersey permit ledgers.** Consistent with the statewide NJ rejection already on record (the
mandated DCA dataset is aggregate-by-design, Jersey City is a PDF library, Newark is Cloudflare-walled).

### AL — Jefferson (60): one first-party org, no ledger

- `data.jccal.org` (the county's presumed hub) → **DNS failure**; recorded as *unprobed*, not rejected.
- **AGO org search for Jefferson County AL → `total: 0`.** The county has no AGO org.
- **`City_of_Homewood_AL`** is a genuine first-party org, 56 items enumerated in full: city limits,
  trash + clamshell truck routes, sidewalk inventory, council wards, school buffers, fire zones,
  landmarks. `Permit Software Info` is **metadata about which permitting software the city bought**,
  and `BZA Case Labels` is a label layer — neither is a record ledger.
- **`Birm_Demo_Permits` was rejected on provenance, not content.** Owner is `admin_nthp` — the
  **National Trust for Historic Preservation**, a third party republishing Birmingham data. Wiring
  rule 0 is first-party only, and a preservation advocacy org's copy of a city ledger is exactly the
  intermediary the rule bars. Not probed further.

### Session total: 7 counties, 518 dark pages, 0 sources wired

| county | dark pages | route used | outcome |
|---|---|---|---|
| NY Suffolk | 107 | county server + 3 town orgs | 1 permit ledger, stalled 14 months |
| NY Westchester | 75 | org-scoped 3 owners | all cross-org (SF, Hudson Valley consultancy) |
| NY Nassau | 70 | org-scoped | cross-org (Walton County FL) |
| CA Orange | 85 | org-scoped 3 city orgs | boundary layer, 10-row dateless layer, Survey123 |
| NJ Bergen | 66 | municipality search | all out of state |
| NJ Morris | 55 | municipality search | all out of state |
| AL Jefferson | 60 | hub + org + city org | no ledger; one third-party copy rejected |

**This is the ceiling, demonstrated seven more ways.** Every route — county GIS, county hub DCAT,
town/city org scoping, municipality-name search, vendor-signature search — lands in the same place:
reachable jurisdiction GIS publishes parcels, zoning, boundaries and environmental overlays, and the
permit ledger sits behind a vendor portal with no public per-record layer.

### The recommendation, stated plainly

**More discovery will not move coverage. The vendor adapter will.** Accela / EnerGov / CitizenServe /
Municity are where these counties' permits actually live — this session alone hit EnerGov,
CitizenServe, Clariti and "Permit Software Info" as *evidence of the vendor*, never as a reachable
ledger. One adapter widens many states at once, exactly as Granicus/Legistar/CivicClerk did for
meetings.

It is a **code change**, so it sits outside the registry-only autonomy grant and is **NOT** being
taken unasked. Logged as the single highest-value gated item.

---

## WAVE 9 — Indianapolis · Providence · Tulsa · Akron · Dayton · Contra Costa · Summit · Wichita (2026-07-31)

Founder instruction: work through every ZIP, solve blockers where possible, **record and move on where
not**. This wave covers 8 more counties (~330 dark pages). **0 sources wired.** Two findings are worth
more than the rejections.

### PROVIDENCE RI (42 pages) — a textbook BLDS ledger, stalled 6.5 years. TOP REPROBE CANDIDATE.

`data.providenceri.gov` `ufmm-rbej`, **80,874 rows**, and the schema is the best-shaped one found in
two sessions — it is the **BLDS standard** (same shape as Cincinnati and KCMO):

```
permitnum, permittype, permittypemapped, pin, originaladdress1, originalcity,
originalstate, originalzip, description, estprojectcost, applieddate, issueddate,
statuscurrent, permitclass, workclass, totalsqft, contractor*, geocoded_column{latitude,longitude}
```

Native ZIP **and** per-record coordinates — it would have needed no spatial scoping and no geocoder.
Both vocabularies are complete and the status set **sums exactly to the row count**:
`Complete` 61,633 + `Active` 17,705 + `Stopped` 1,536 = **80,874** ✓.

**Rejected on freshness only:** max `issueddate` **2020-01-23**, max `applieddate` 2019-10-24,
**0 rows since 2023-01-01**. The catalog title says "2009-2018" and is itself understated — the data
runs to 2020, then stops. Under the standard 365-day window it would emit **zero records**.
→ **nightly reprobe list, ranked first**: if Providence ever republishes, this is a same-day wire with
no new connector code.

### Rejections with receipts

- **Indianapolis / Marion IN (40)** — `data.indy.gov` DCAT is **live and large (3.83 MB, valid
  project-open-data)**, and was searched in full. Every "permit" match is a **historical zoning
  ordinance** (`Improvement Location Permit Ord 68-AO-11`, `Planned Unit Development Ord 67-AO-1`, …).
  The only record-shaped datasets are Building Footprints, Building/Unit Addresses, and
  `Indianapolis Code Enforcement Violations and Investigations` — code enforcement is not a
  development permit and belongs to a different bucket. **No per-record permit ledger published.**
- **Contra Costa CA (43)** — `gis.cccounty.us` is **live** and its folder list was enumerated:
  `Assessor, PublicWorks, Elections, Sheriff, ConFire, AddressPoints, CCMAP, INTERNET, …` —
  **no permits folder**. The two plausible folders each hold exactly one service:
  `INTERNET/BASE_DATA_ArcPro` and `CCMAP/Assessment_Parcels_ArcPro`. Parcels, not permits.
- **Summit County OH / Akron (41)** — `Summit_Admin` org is live with **600 items**. Targeted
  in-org search for permit/building returned **44**, and they are **building FOOTPRINT polygons**
  (`Buildings_Buffer_yr2000`, 1994/2000 photogrammetry) plus a wall of `TaxParcel*` dashboards.
  No permit ledger.
- **Tulsa OK (39)** — `cityoftulsa.org/apps/opendata/` → **403**. The regional org `tsimmons_INCOG`
  is live (150 items); targeted in-org permit search returns **3**, all irrelevant
  (`CreekCo_Stormwater_Permit_UZA_2010` — a stormwater *urbanized-area boundary*; "City of Tulsa
  Permitted Dispensaries"). No construction ledger.

### BLOCKERS — could not resolve, moving on (for the end-of-run review)

| blocker | pages | evidence | class |
|---|---|---|---|
| **Wichita KS / Sedgwick** | 50 | `opendata.wichita.gov` returns the **HTML portal shell on every API path tried** (`/api/feed/dcat-us/1.1.json`, `/api/feed/dcat-ap/2.1.1.json`, `/api/search/v1`). AGO search for "City of Wichita" returns **Wichita Falls, TEXAS** and an EPA case-study image — the org was never located. | portal API path unknown |
| **Akron hub** | — | `data-akron.opendata.arcgis.com` → 404 "Domain record(s) not found" | **URL guess — unprobed, NOT rejected** |
| **Dayton hub** | — | `data-cityofdayton.opendata.arcgis.com` → 404 "Domain record(s) not found" | **URL guess — unprobed, NOT rejected** |
| **Tulsa County hub** | — | `opendata.tulsacounty.org` → DNS failure | **URL guess — unprobed, NOT rejected** |
| **Tulsa city portal** | 39 | `cityoftulsa.org/apps/opendata/` → 403 | access refused |

Per the Frisco standing answer, the three 404/DNS entries are **guessed hostnames** and are recorded
as *unprobed*, never as evidence the city publishes nothing.

---

## WAVE 10-12 — STAMFORD WIRED AND LIVE; Spokane blocked on provenance (2026-07-31)

### 🟢 GO-LIVE: `stamford-major-developments` — 6 dark Fairfield CT pages now carry records

Merged (#486), deployed (**`get-address-report` v125**), all 6 Stamford ZIPs re-fired and collected,
all 6 materialized `quality=pass`:

| ZIP | development |
|---|---|
| 06901 | 44/44 |
| 06902 | 44/44 |
| 06906 | 44/44 |
| 06905 | 33/33 |
| 06907 | 26/26 |
| 06903 | 1/1 |

**192 records across 6 pages — 0 missing `record_url`, 0 missing coordinates, 0 non-`point` scope,
0 unclassified.** Bidirectional gate proof: they ride **`CT/Fairfield` and nothing else**.
Fairfield goes 46 dark → 40.

### 🔴 SPOKANE COUNTY WA (18 dark) — BLOCKED ON PROVENANCE, not on data. FOUNDER REVIEW.

This is the most substantive blocker of the session, because **the data exists and is well-shaped**;
only the sourcing rule stops it.

- **The ledger:** `Spokane County Building and Planning Permits`, **6,839 rows**, point geometry, and
  a schema that needs no spatial scoping at all:
  `Permit_Year, Permit_Month, Issued_Date, Final_Date, Permit_Number, Status, Status_Description,
  Project_Description, Parcel_Number, Site_Address, Site_Zip, Permit_Type, Jurisdiction`
  — **native `Site_Zip`** plus per-record points.
- **The problem: the owner is `Avista_Data_Owner` — Avista Corp, the electric/gas UTILITY** serving
  Spokane. That is a third-party republisher of county data, which **wiring rule 0 (first-party only)
  bars**. It is the same class as `Birm_Demo_Permits` (National Trust for Historic Preservation),
  rejected earlier today — and consistency demands the same answer.
- **I searched hard for the first-party original and it does not exist publicly.**
  `gismo.spokanecounty.org` **is live** and its full folder list was enumerated:
  `ACPdata, Annexations, Assessor, BPPublic, CodeRed, CommunityMaps, Elections, EnvServices, OpenData,
  Parks, Planning, PublicWorks, SmartGov, StormWater, Utilities, WaterResources, …`
  - **`BPPublic`** (Building & Planning Public) — 10 services, all basemap:
    `ParcelandAddress, Plats, CriticalAreas, Contours, AirportOverlay, DistrictsAndPrecincts, …`
  - **`OpenData/Planning`** — layers are `Zoning District | Urban Growth Areas | Comprehensive Plan`
  - **`SmartGov`** — contains exactly ONE service: **`SmartGov_Parcels`**. SmartGov *is* the county's
    permitting vendor, and the folder holds parcels. **The vendor-folder trap, confirmed a fourth time.**
  - `gisdatamaps.spokanecounty.org` → DNS failure (guessed host, unprobed).
  - City of Spokane Valley's own `Permitting_EVV_Hosted` layer 0 is **"BPA Easement", 1 row** — a
    Bonneville Power easement polygon, not permits.

  **Founder question:** Avista's copy is the only public per-record Spokane permit ledger. Wiring it
  would light 18 pages but would breach first-party sourcing. Held pending your call.

### Rejections with receipts

- **PA York + Lancaster (103)** — search returns only **DMO mining permits** (bituminous/anthracite
  surface + underground), BLM leases, and permitted landfills. No building ledger.
- **Albany NY (47)** — building-permit search total **0**.
- **St. Louis County MO (63)** — one hit, an **aggregate monthly valuation summary for Beverly Hills**
  (and Beverly Hills CA at that). Not per-record.
- **Macomb MI (40)** — total 10, **0** permit/development services.
- **Kanawha WV (47)** — total 8, 0 hits. **Erie NY (55)** — total 20, 0 hits.
- **Mobile AL (39)** — `gis_cityofmobile` is live (418 items); permit-shaped hits are `ROW Permitting`
  (right-of-way) and a `Development Framework` plan layer. No ledger.
  ⚠️ **Correction:** the `Active Building Permits - All` hit that looked like Mobile belongs to owner
  `cakee` = **Leon County, FLORIDA** (`intervector.leoncountyfl.gov`) — another cross-org lookalike.
  Leon County has **0 modelled ZIP pages**, so it is not addressable regardless.
- **Charleston County SC** — a real `Building Permits 2025` layer exists, but Charleston's 25 pages are
  **already 0 dark**. Nothing to gain; not wired.

---

## WAVE 13 — Honolulu · Milwaukee · San Mateo · CT statewide · Anne Arundel · Eugene · Ventura · Snohomish (2026-07-31)

**0 wired — but this wave found a SECOND, cheaper capability gap that blocks two fresh, live,
first-party ledgers.** Unlike the vendor-portal wall, the missing piece here already exists in the
codebase for a different connector.

### 🔑 THE FINDING: two live ledgers blocked by ONE missing capability — a geocode path for the
### socrata + csv connectors

The `arcgis` connector already has a geocode path (the Boulder / Anaheim geometry-less-table route:
Census geocode + the v20 `GEOCODE_FENCE_MI` fence). **`socrata` and `csv` do not.** Both connectors
can only scope by a native ZIP column or by `spatial_point_col`. Two of the best sources found all
session fail on exactly that and nothing else:

| source | pages | rows | freshness | why blocked |
|---|---|---|---|---|
| **Honolulu** `data.honolulu.gov` `4vab-c87q` | **38** | **432,021** | **FRESH — max `issuedate` 2025-07-01** | address is TEXT only |
| **Milwaukee** `data.milwaukee.gov` `buildingpermits` (CSV) | **36** | — | issued dates run to 2017+ in the head sample | address is TEXT only |

- **Honolulu** carries a rich, current schema — `buildingpermitno, buildingpermittype, issuedate,
  statusdescription, proposeduse, occupancygroupcategory, estimatedvalueofwork, newbuilding,
  demolition, addition, alteration, commercialresidential, accessorydwellingunitadu, totalfloorarea,
  tmk, jobaddress, joblocation, address`. Every location field was type-checked against the column
  metadata: **`jobaddress`, `joblocation`, `locationpermitissued`, `address` and `tmk` are ALL
  `dataTypeName: text`.** No Socrata `location`/`point` type, no lat/lng pair, no ZIP column.
  Per the Austin standing answer, a socrata entry with `spatial_zip_radius_mi` but no
  `spatial_point_col` is **quarantined and emits zero records** — so it cannot be wired as config.
- **Milwaukee**'s CSV header is exactly 9 columns:
  `"Date Opened","Address","Record ID","Permit Type","Status","Date Issued","Construction Total Cost","Use of Building","Dwelling units impact"`
  — `Address` is a bare street string (`2033 S 24TH ST`), no city/state/ZIP, no coordinates.

**Why this matters more than the other blockers:** this is **not** a "the data doesn't exist" wall.
Both cities publish first-party, per-record, addressed permit ledgers. **74 dark pages** are blocked
by a capability the repo already implements for `arcgis`. Extending it to `socrata`/`csv` is a code
change (gated), but a far smaller one than a vendor adapter — and the geocode fence that makes it
safe is already written and shipped.

### Rejections with receipts

- **CT statewide — `CT Housing Data Hub - Permitting DECD` is AGGREGATE BY DESIGN.** 4,732 rows,
  **polygon** geometry (town boundaries), and the field list settles it:
  `Municipality, year, places, county, total_units, units_1, units_2, units_3_4, units_5p,
  demolitions, year_permits, year_demos, perc_permits, perc_demos, net` — municipality-by-year
  counts, no address, no per-record row. Identical to the NJ DCA rejection class. This closes the
  statewide route for **Fairfield / Hartford / New Haven / Litchfield / New London** at once.
- **San Mateo CA (31)** — `datahub.smcgov.org` is live (695 KB catalog, searched in full). Every
  permit match is a **performance metric**: `PercentOfBuildingPermitsCreatedOnline`,
  `Percentage of Online Permits Issued By Year`. No ledger.
- **Anne Arundel MD (37) · Eugene/Lane OR (37) · Ventura CA (34) · Snohomish WA (33)** — combined
  AGO search returned 28 results; every service is a **boundary or footprint layer**
  (`Agricultural Land`, `regulatory_boundaries`, `Municipal Boundary`, `LandUseOverlays`) plus two
  Bellingham WA university demographic layers. No permit ledger.
- **Honolulu AGO route** — separately searched; returns only `Building Footprint Centerpoints` and
  `Building Footprints (CCH)`. The Socrata dataset above is the city's only permit publication.

### Running blocker tally (for the end-of-run review)

| class | blocked pages | fix |
|---|---|---|
| Vendor portals (Accela/EnerGov/CitizenServe/SmartGov/Municity) | most of the long tail | **vendor adapter** — code, gated |
| **socrata/csv geocode path** | **74** (Honolulu 38 + Milwaukee 36) | **extend the existing arcgis geocode path** — code, gated, small |
| First-party sourcing rule | 18 (Spokane) | **founder call** — data exists, owner is a utility |
| Stalled ledgers | 42 (Providence) + others | reprobe list |
| WAF / 403 | 91 (Wichita 50, Tulsa 39, + OKC 52 earlier) | reprobe list |

---

## ⚠️ CORRECTION — SPOKANE IS ALREADY WIRED. My "blocked on provenance" claim was WRONG. (2026-07-31)

**Retracting a claim I merged to `main` a few hours ago in #487.** That entry said Spokane County was
blocked because the only public ledger is owned by Avista (the utility), and it **asked the founder for
a ruling**. That question should never have been asked: **`spokane-county-building-planning-permits`
has been in `jurisdiction-registry.json` since 2026-07-28**, wired in the Phase 1 standard arcgis
pass — using the **exact same `service_url`** I "discovered":

```
https://services3.arcgis.com/WlYQgAChrqj0tuQi/arcgis/rest/services/
  Spokane_County_Building_and_Planning_Permits/FeatureServer/0
```

It uses the native `Site_Zip` column (`column_map.zip`), a 47-value verbatim `Permit_Type` map and a
10-value status map. It is live and it was live the whole time.

**So Spokane's 18 dark pages are not a provenance block at all** — they are rural Spokane County ZIPs
that simply carry no rows in `Site_Zip`. The entry has **no `spatial_zip_radius_mi`**, so a ZIP only
lights up if it literally appears in the data. That is correct behaviour, not a blocker. **No founder
decision is required. Disregard that ask.**

**Same root cause, third occurrence — and I had already written the rule down.** The Hartford false
positive produced this standing answer: *grep the registry for the `service_url` BEFORE running recon.*
I skipped it again here, and again on Sioux Falls and KCMO:

| candidate | reality |
|---|---|
| Spokane County | **already wired** 2026-07-28, same service_url |
| **Sioux Falls** | **already wired** 2026-07-28, same service_url (`gis.siouxfalls.gov` Data/Community/3) |
| **KCMO** | **already wired** as `kcmo-building-permits`, same AGO org `4o5uMWTHuOhUVJPd` |

**What actually stopped the bad Sioux Falls commit was the additive-proof guard**, not my judgement:
the `assert len(ids)==len(set(ids))` duplicate-`registry_id` check failed and the file was never
written. The guard works — but it is the last line of defence, not the first.

### THE RULE, now with a concrete first step (do this before ANY recon)

```
python3 -c "import json;d=json.load(open('supabase/functions/get-address-report/jurisdiction-registry.json'));
allе=[e for k,v in d.items() if isinstance(v,list) and k in ('arcgis','socrata','ckan','csv','carto','opendatasoft') for e in v];
print([e['registry_id'] for e in allе if '<host-or-org-id>' in json.dumps(e).lower()])"
```

**The registry is the state of the world; QUEUE.md prose and dark-page counts are not.** A county
having dark pages does **not** mean it is unwired — it usually means the wired source has no rows for
those specific ZIPs. **Checking costs one command; not checking cost three full recon passes today and
one incorrect merged claim addressed to the founder.**

### Registry state, measured just now (so the next session starts from fact, not prose)

**144 entries** across arcgis/socrata/ckan/csv/carto/opendatasoft, declaring coverage over
**115 distinct (state, county) pairs.**

### Still genuinely NOT wired (verified by the same grep, not by prose)

`sedgwick` · `wichita` · `honolulu` · `milwaukee` · `providence` — all return **zero** registry hits.
The wave-9/13 findings on those five stand unchanged.

---

## SEDGWICK COUNTY KS (50 dark) — REJECTED: a 10,000-row snapshot that stops at 2022-10-07

The largest verified-unwired county. `sedgwick_county_building_permits`
(`services9.arcgis.com/TuMyQVg8YRPEnbjv`), point geometry in wkid 4326, geocoder output columns
(`Match_addr`, `Postal`, `Score`) plus real permit fields (`Jurisdicti, Issued_Dat, Final_Date,
COO_Date, Milestone, WorkType, OccupancyT, RES_COM, Parcel`).

**Two independent vocabularies each sum to EXACTLY 10,000** — which is the finding, not a coincidence:

- `Jurisdicti`: Wichita 7,595 · Unincorporated 1,025 · Maize 577 · Goddard 315 · Mulvane 121 ·
  *(blank)* 97 · Valley Center 77 · Clearwater 51 · Cheney 38 · Garden Plain 38 · Colwich 35 ·
  Andale 21 · Bentley 8 · Haysville 2 = **10,000**
- `Milestone`: Closed 8,206 · Void Permit 744 · Prior to CO 736 · Conditional to Foundation Wall 131 ·
  Certificate of Occupancy 72 · Conditional to Framing 62 · Issue Permit 36 · Fees 7 · StopWork 4 ·
  Received Application 1 · Conditional to ReinforcingSlab 1 = **10,000**

A round 10,000 reached from two different groupings is the signature of a **one-off snapshot export**,
not a live ledger — and the date confirms it: **max `Issued_Dat` = 1665100800000 ms = 2022-10-07**,
nearly three years stale. Under any recency window it emits nothing. **Rejected.**

*(Provenance was a secondary concern anyway — the owner is `Goddard@KS`, the City of Goddard, one of
the county's smaller cities republishing county-wide data. Freshness settled it first.)*

---

# 📋 BLOCKER REGISTER — the founder's end-of-run review list (2026-07-31)

Every blocker hit this session, with what it would take to clear it. Ordered by pages unblocked.

### A. Needs a CODE change (outside the registry-only autonomy grant)

| # | blocker | pages | evidence | fix |
|---|---|---|---|---|
| **A1** | **Vendor permitting portals** — Accela · EnerGov · CitizenServe · SmartGov · Municity · Clariti | the long tail (most of ~8,600 dark) | Hit as *evidence of the vendor* four separate times and never as a reachable ledger: Spokane's `SmartGov` folder holds only `SmartGov_Parcels`; Babylon + Islip `OPENGOV` services are regulatory overlays; Homewood publishes a layer literally named `Permit Software Info`; `laikevin`'s EnerGov/CitizenServe are Walton County FL | **vendor adapter** — the Granicus/Legistar/CivicClerk play, one adapter widens many states |
| **A2** | **socrata/csv have no geocode path** | **74** (Honolulu 38 + Milwaukee 36) | Honolulu: 432,021 rows, **fresh to 2025-07-01**, first-party — but `jobaddress`/`joblocation`/`address`/`tmk` are **all `dataTypeName: text`**. Milwaukee CSV: `Address` is a bare street string. Per the Austin rule, socrata + `spatial_zip_radius_mi` without `spatial_point_col` **quarantines and emits zero** | **extend the geocode path `arcgis` already has** (Boulder/Anaheim route + the v20 `GEOCODE_FENCE_MI` fence). Smaller than A1, and the safety fence is already shipped |

### B. Needs the SOURCE to change — reprobe list (no work possible now)

| # | blocker | pages | evidence |
|---|---|---|---|
| **B1** | **Providence RI — stalled** | 42 | The best-shaped source found in two sessions: BLDS standard, 80,874 rows, **native ZIP + per-record coords**, statuses summing exactly to the row count. Max `issueddate` **2020-01-23**, 0 rows since 2023. **Ranked first — a same-day wire with no new code if it republishes** |
| **B2** | **Wichita / Sedgwick KS** | 50 | Portal returns the **HTML shell on every API path tried**; AGO finds only Wichita Falls **TX**. The one county layer is a 10,000-row snapshot stopping 2022-10-07 (above) |
| **B3** | **Oklahoma City** | 52 | `data.okc.gov` 403 — body identifies an **Imperva/Incapsula WAF** (`_Incapsula_Resource`), not a missing portal |
| **B4** | **Tulsa city** | 39 | `cityoftulsa.org/apps/opendata/` 403; INCOG's only permit layers are a stormwater boundary + dispensaries |
| **B5** | **Suffolk NY county server** | (107, town route also dry) | `<title>Suffolk County Server Maintenance</title>` on **5 probes**. Towns probed separately: Babylon/Islip/Smithtown have no ledger; Babylon's real one stalls 2024-05-31 |
| **B6** | Worcester MA · St. Paul MN · Syracuse NY · KCMO BLDS | — | previously-recorded stalls, unchanged |

### C. Guessed hostnames — **UNPROBED, not rejected** (per the Frisco standing answer)

`data-akron.opendata.arcgis.com` · `data-cityofdayton.opendata.arcgis.com` ·
`opendata.tulsacounty.org` · `data.jccal.org` · `gisdatamaps.spokanecounty.org` ·
`data.cityofirvine.org` · `opendata.ocgov.com` — all 404/DNS. **A dead guessed host is not evidence a
city publishes nothing.** Each needs its real portal located before any rejection is recorded.

### D. NOT blockers — closed with receipts, do not re-probe

Aggregate-by-design (CT DECD, NJ DCA, San Mateo metrics) · zoning-ordinance catalogues (Indianapolis) ·
parcels/footprints/boundaries where a permit ledger was hoped for (Contra Costa, Summit, Anne Arundel,
Eugene, Ventura, Snohomish, Grand Rapids) · dateless layers (Tustin, North Richland Hills) ·
third-party republishers (Birmingham/NTHP) · counties with 0 modelled ZIPs (Leon FL, LA County) ·
counties already 0 dark (Charleston SC).

### E. ⚠️ NOT a blocker — the "already wired" class (see the correction above)

**Spokane · Sioux Falls · KCMO · Hartford** were all investigated as opportunities and are all **already
in the registry**. Dark pages in a wired county usually mean the wired source has no rows for those
ZIPs — **not** that the county needs wiring. Run the registry grep first, every time.

---

## WAVE 15 — Fargo · Toledo · Harrisburg · Cedar Rapids · Waukesha · Gary · Prescott · Montgomery AL (2026-07-31)

**Registry-grep ran FIRST this time** (the rule from the correction above): all 16 candidate counties
confirmed genuinely unwired before a single probe. **0 wired** — but every rejection is now cheap and
receipted rather than a full recon.

### Harrisburg / Dauphin PA (30 dark) — REJECTED: a two-month sample with no year

`running_building_permit_master` (org `9n3LUAMi3B692MBL`, `emrubin_COHBG` — genuinely the City of
Harrisburg). Point geometry, and the field list is only
`Address, City, Month, Parcel_ID, State, Type, Value, ZIP, ObjectId`. Four disqualifying facts:

1. **200 rows total, and the `Month` groupBy is exactly `"January "` 100 + `"Feb"` 100** — a
   two-month extract, split evenly, with the month written two different ways (one with a trailing
   space, one abbreviated).
2. **There is NO YEAR anywhere in the schema.** `Month` is a bare month name, so **no `file_date` can
   be derived** — the Tustin/North Richland Hills class.
3. **`ZIP` is NULL** on the sampled rows despite the column existing.
4. **No status column** at all.

Its sibling layers in the same org — `Hot_Spots_running_building_permit_master`,
`running_building_permit_master_Prediction`, `Describe_distribution_of_running_building_permit_master`
— confirm what it is: **a GIS analyst's working/teaching dataset**, not the city's permit ledger.

### Montgomery AL (28 dark) — REJECTED: private layer

`Building_Permit` on org `lDchLOqyFQHnIw15` (`MHAtoday1`) returns
`{"error":{"code":499,"message":"Token Required"}}`. Access-restricted, the Buffalo class. *(Owner is
also a housing authority rather than the city permitting office — but access settled it first.)*

### Rejections with receipts

- **Fargo / Cass ND (30)** — West Fargo's own org publishes **Sidewalk & Driveway**, **Right of Way**,
  and **Residential/Commercial Civil Site** permitting lookups — infrastructure permits, not building.
  The one `2025_Building_Permits_Fargo` hit is owned by `david@horizonfargo.com_CCIM`, **a commercial
  real-estate brokerage** — third party, barred.
- **Toledo / Lucas OH (30)** — 16 results, **0** permit/development services.
- **Cedar Rapids / Linn IA (28)** — only `Dust Control Permitting`, `Open Burn Permits`, and a
  `Music & Event Permit Navigator`. No construction ledger.
- **Waukesha WI (27) + Lake IN (27)** — 172 results; the only permit-shaped hits are BLM national
  leases, Louisville APCD operating permits, and Bloomington **parking** permit zones.
- **Prescott / Yavapai AZ (27) + Tuscaloosa AL (27)** — 47 results, no first-party construction ledger.

### The pattern this wave sharpens

Every one of these eight failed for a **different** reason — wrong permit domain (Fargo, Cedar Rapids),
third-party owner (Fargo CCIM), private layer (Montgomery), analyst sample with no year (Harrisburg),
or simply nothing published (Toledo). There is no single fix that would have unlocked them, which is
itself the finding: **below roughly the top-40 dark counties, the failures stop being one systemic wall
and become long-tail idiosyncrasy** — which is exactly the regime a vendor adapter (blocker A1) is
designed for, since these cities all run permitting through portals rather than GIS.

---

## WAVE 16 — Des Moines · Omaha · Allentown · Fort Wayne · Frederick · Manchester NH (2026-07-31)

Registry-grep first again: NY County, Hamilton OH and Fulton GA were flagged **already wired** and
skipped without a probe. **0 wired** from the rest.

### ⚠️ `gis.frederickco.gov` is FREDERICK, **COLORADO** — not Frederick County, Maryland

The most convincing lookalike of the session, and worth recording because three independent signals
all pointed the wrong way: the AGO owner is `GISFrederick`, the layer is titled
**`Active Building Permits`**, and the schema is genuinely good
(`FullAddress, PermitId, PermitType, Status, Description, UpdateDate, StatusDate, OpenedDate,
ClosedDate, ParcelID`, point geometry).

Two receipts caught it:

1. **The declared extent is `xmin -105.036, ymin 40.081`** — Colorado, ~1,400 miles from Maryland.
2. **A live sample settles it beyond doubt**: records at `-104.977/40.120`, `-104.981/40.121`,
   `-104.931/40.104`, with addresses like **`8245 W I-25 FRONTAGE RD UNIT 4`** — Interstate 25 runs
   through Colorado, not Maryland.

So `frederickco.gov` is the **Town of Frederick, Colorado** (Weld County), not "Frederick County".
**Colorado is founder-locked as UNREACHABLE**, so the source is out of scope regardless.

⚠️ **Nuance worth keeping — I nearly rejected it on the extent alone, which would have been the wrong
method.** My own Phoenix standing answer says *a declared ArcGIS `extent` is cached metadata, not a
containment guarantee.* An extent is a **lead**, never the proof. The live sample is what made this a
fact. Extent to suspect → sample to confirm.

### Rejections with receipts

- **Des Moines / Polk IA (34)** — building-permit search total **0**.
- **Fort Wayne / Allen IN (33)** — total **0**.
- **Omaha / Douglas NE (35)** — total 1, **0** permit services.
- **Allentown / Lehigh PA (34)** — a deliberately over-broad query returned 4,575 results and **not one
  municipal building ledger**: PA DMO mining permits, Florida DEP environmental resource permits, BLM
  leases, and parking-permit zones from Brisbane, Sydney, Kingston and Halifax. A textbook illustration
  that result *volume* is not signal.
- **Manchester / Hillsborough NH (34)** — 12 results; the only permit-shaped hits are a
  **Manchester AIRPORT tall-equipment form** and `PermitsProAccela` owned by **`CarrollCo_MD`**
  (Carroll County, Maryland — another cross-state lookalike).
- **Carroll County MD `PermitsProAccela`** — probed anyway because the name says Accela. **Layer 0 is
  `Address`** (`ACCTID, Full_Addre, ST_NUMBER, … ZIPCODE, County, State`) — an **address registry**.
  **Fifth confirmation of the vendor-folder trap**: a service named for the permitting vendor holding
  everything except permits.

### Session sweep totals

Counties probed across waves 1–16: **~40**, covering roughly **1,900 dark pages**. Sources wired: **2**
(Stamford CT, plus the Chicago→DuPage coverage extension). Everything else is receipted in the
BLOCKER REGISTER above.

---

## WAVE 17 — Union/Somerset NJ · Yakima · Will/Winnebago IL · Dutchess/Saratoga NY · Ventura/SLO CA · Hawaii County

All six dry. Registry-checked first; all 20 candidates confirmed unwired before probing.

- **Union + Somerset NJ (57 combined)** — total **0**. Consistent with the closed NJ statewide route.
- **Yakima WA (26)** — total 10, **0** permit services.
- **Will + Winnebago IL (59 combined)** — total 4, **0** permit services. Confirms the earlier
  Illinois wire-pass rejections (Rockford org live but 0 permit services; Will County's real root
  exposes 0 public permit services).
- **Dutchess + Saratoga NY (61 combined)** — 855 results, and **not one municipal building ledger**.
  The permit-shaped hits are Saratoga Springs *construction site* markers owned by a personal account
  (`ace560`), utility permits, **septic** permits, tree permits, and **Idaho Department of Water
  Resources appropriation permits**.
- **Ventura + San Luis Obispo CA (63 combined)** — the only hit is
  **`034_SLOBuildingPermits_20220719` owned by `lsorvett_CalPoly`** — a Cal Poly **student/coursework
  layer**, third-party and frozen at 2022-07-19. Barred on provenance and dead on freshness.
- **Hawaii County (28)** — DLNR **forest-reserve researcher** permits and two "South Kona Future
  Development *Scenarios*" planning studies. No ledger.

### 📉 The marginal return has collapsed — state it plainly

| waves | counties probed | sources wired |
|---|---|---|
| 1–13 | ~24 | 1 (Stamford) + 1 coverage extension (DuPage) |
| **14–17** | **~22** | **0** |

**Twenty-two consecutive counties, zero sources.** That is not bad luck; it is the shape of the
remaining problem. Below roughly the top-40 dark counties every jurisdiction either publishes no
permit data at all, publishes it only inside a vendor portal, or publishes a non-construction permit
domain (septic, tree, utility, forest-reserve, parking).

**Continuing to probe counties one at a time is now the wrong instrument.** The two code changes in the
BLOCKER REGISTER are the only things that move coverage from here:

1. **A1 — the vendor adapter** (Accela / EnerGov / CitizenServe / SmartGov / Municity / Clariti).
   Confirmed **five** times as the wall, most recently Carroll County MD's `PermitsProAccela` holding
   an address registry.
2. **A2 — a geocode path for `socrata`/`csv`**, worth **74 pages** (Honolulu 38 + Milwaukee 36) from
   two live, fresh, first-party, addressed ledgers — and `arcgis` already implements the pattern,
   fence included.

Both are gated. Neither has been taken.

---

## WAVE 18 — the SEARCH INVERSION, re-run: a THIRD blocker class, and it is PURE DATA

Instead of probing counties by name, swept AGO by **ledger title shape** sorted newest-modified —
the technique that found Johns Creek and Lee County. Of 32 `title:"Issued Building Permits"` hits,
most are **Canadian** (Surrey, Mississauga, Oakville, Abbotsford) or university coursework (UBC
DES 401, a `geog351fa21` student layer, UT Austin, Muhlenberg). Two were live US first-party ledgers:

| source | owner | status |
|---|---|---|
| `Issued Building Permits Current Year` + `…Archive` | **`Publisher_SacCity`** — City of Sacramento | **live, first-party, unwired** |
| `Residential Issued Building Permits` | `gis_onslow` — Onslow County NC | live, first-party, unwired |

**Neither can be used, and NOT because of the source.** Measured just now:

```sql
-- CA/Sacramento and NC/Onslow, communities where level='zip'
→ 0 rows.  Neither county has ANY modelled ZIP page.
```

### This is blocker class **C — no modelled ZIP pages** (new, and distinct from A and B)

Blockers A (needs code) and B (needs the source to change) both assume a page exists to fill.
**Here the source is fine and the page does not exist.** Sacramento County is a ~1.6M-person metro
publishing a current-year permit ledger under its own city account, and it produces exactly zero value
because HomeSignal models zero Sacramento ZIPs.

Known members of class C, now with a live wireable source attached to one of them:

| county | modelled ZIP pages | note |
|---|---|---|
| **CA / Sacramento** | **0** | ← **live first-party ledger found this wave** |
| CA / Los Angeles | 0 | `LA County Permitting (EPIC-LA Case History)` seen earlier, also unusable |
| NC / Onslow | 0 | live first-party ledger |
| TX / Harris | 1 | 2 correctly-wired plat entries emitting ~0 (queue item 5) |
| TX / Bexar | 2 | same |
| DC · NC / Guilford | 0 | recorded earlier |

**It stays gated, and the gate is already written down.** Queue item **EXP-HARRIS-BEXAR** is
`State: BLOCKED · Gate: Founder decision — it moves the coverage claim. Report, then hold.`
A Sacramento expansion is the identical action on a different county, so the identical gate applies.
**Reported, not shipped** — no rows inserted, no coverage claim changed.

**Why it deserves the founder's attention above A1/A2:** it is **pure data**. The communities model
already supports it (the NYC-borough / Boston-Suffolk / Philadelphia-County precedent, all shipped),
it needs **no connector, engine or schema change**, and for Sacramento a wireable source is already
identified and waiting. Of the three blocker classes it is the cheapest to clear and the only one
that needs no engineering at all.

### Revised recommendation order (all three gated, none taken)

| rank | blocker | pages | cost |
|---|---|---|---|
| 1 | **C — ZIP expansion** (Sacramento first, then LA/Harris/Bexar/Onslow) | large + unlocks already-found sources | **pure data, zero code** |
| 2 | **A2 — socrata/csv geocode path** | 74 (Honolulu + Milwaukee) | small code; `arcgis` already has the pattern + fence |
| 3 | **A1 — vendor adapter** | the long tail | largest code change |

---

## 🟢 GO-LIVE: `allentown-energov-building-permits` — 5 Lehigh PA pages, 3,939 records (2026-07-31)

Merged (#495), deployed (**`get-address-report` v126**), all 34 Lehigh ZIPs re-fired and collected,
5 pages materialized `quality=pass`:

| ZIP | development |
|---|---|
| 18102 | 1,537/1,537 |
| 18103 | 863/863 |
| 18104 | 728/728 |
| 18109 | 568/568 |
| 18101 | 243/243 |

**3,939 records — 0 missing `record_url`, 0 missing coordinates, 0 non-`point` scope, 0 unclassified.**
Bidirectional gate proof: they ride **`PA/Lehigh` and nothing else**. Lehigh goes 34 dark → 29.

Only 5 of the 34 Lehigh ZIPs light up because the source is the **City of Allentown**, and Allentown's
own ZIPs are exactly 18101–18104/18109 (18106 and 18195 are PO/edge blocks with no permits in window).
The other 29 are separate Lehigh boroughs and townships — correct behaviour, not a gap.

---

## ⚠️ CORRECTION to WAVE 17 — the counties were not exhausted; MY SEARCH WAS

Wave 17 concluded that *"county-by-county probing is now the wrong instrument"* after 22 consecutive
dry counties. **That conclusion was too strong, and wave 18 disproved it within the hour.**

Switching from *county-name* search to **ledger-title-shape** search
(`title:"Building Permits" AND type:"Feature Service"`, sorted newest-modified) immediately surfaced
three PA ledgers in counties I had already written up as closed:

| found | county | dark | outcome |
|---|---|---|---|
| `EnerGov Building Permits Current` | **Lehigh (Allentown)** | 34 | ✅ **WIRED — 3,939 records live** |
| `Lancaster County Building Permits` | Lancaster | 56 | rejected — 28 rows of `Year / Project_type / Units_permitted_by_type`, an **aggregate** |
| `Building_Permits` (`rrwenschhof_dauphinco`) | Dauphin | 30 | no permit Feature/Map Service in the org's 218 items |

**The Allentown miss is the receipt.** In wave 16 I searched `(Allentown OR Bethlehem PA OR "Lehigh
County") AND permits`, got **4,575 results**, and recorded Lehigh as having *"not one municipal building
ledger."* The ledger existed the whole time, on the city's own AGO account, and the shape search found
it in one query.

### Standing answer (new): county-name search and title-shape search FAIL DIFFERENTLY — run both

- **County-name search** drowns in cross-org lookalikes and generic "permit" noise (mining, parking,
  stormwater, environmental). A high result count is *anti*-signal: 4,575 results returned nothing.
- **Title-shape search sorted by newest-modified** surfaces live ledgers regardless of how the owner
  named their org — which is exactly how Johns Creek, Lee County and now Allentown were found.
- **Never record a county as "no ledger published" on a county-name search alone.** The wave 14–17
  rejections were all county-name-only and are hereby downgraded from *closed* to
  **needs a title-shape re-sweep**.

### Also worth recording: the vendor wall is not absolute

Allentown's dataset is literally named **`EnerGov_Permits_Buildings`** — the same vendor that blocks
the long tail. **A city can export its own vendor data to ArcGIS Online**, and when it does the records
are reachable as ordinary config with no adapter. That does not remove blocker A1, but it means the
vendor-portal counties are worth a title-shape sweep *before* assuming an adapter is required.

---

## WAVE 19 — the VENDOR-NAME sweep: the highest-yield query of the session

Following the Allentown lesson (a city exporting its own EnerGov data to AGO), swept AGO by **vendor
name** rather than by place or by permit: `title:"EnerGov" OR title:"Accela" OR title:"CityView" OR
title:"Tyler"`. **3,885 results**, and the roster reads like a directory of cities that have done
exactly what Allentown did:

`EnerGov_Data` (Niles) · `Energov` (Carlsbad) · `EnerGov Application Layers` (Leander TX) ·
`Accela Permit Data (Tacoma)` · `Accela Permits` (Redmond OR) · `CityView Permits` (Puyallup) ·
`Energov_AGOL` (Pickens) · `Planning Projects Energov 3` (Gaithersburg MD) · `Katy_Energov` ·
`EnerGovGIS` (Kyle TX) · `Weld Accela` · `Accela Building Permits` (Douglas NV) ·
`EnerGov_Allentown_CSS` · `Energov Citation/Code Case Public` (MDPublisher) · …

**This is the practical answer to blocker A1.** The vendor adapter remains the general fix, but a
meaningful slice of vendor-portal jurisdictions have *already* published their vendor data to ArcGIS
Online, where it is reachable as ordinary registry config. **Sweep by vendor name before concluding a
county needs an adapter.**

### Two first-party COUNTY ledgers found and under evaluation

| source | county | dark | status |
|---|---|---|---|
| `Building Permits` (`NavajoCounty`) | **AZ / Navajo** | 32 | **59,007 rows**, point geometry — schema is minimal (`PERMIT_NUM, PERMIT_NUMBER, APN, Task, OpenDate, CloseDate`): **no status, no type, no address, no ZIP**. Evaluating `Task` as the type source and `status_const`. |
| `DPW Building Permits` (`hawaiicountygis`) | **HI / Hawaii** | 28 | two services published; `DPW_Building_Permits` layer 0 returns HTTP 400, the live one is `dpw_b._permit`. Re-probing. |

### ⚠️ `wayneit` is Wayne TOWNSHIP, not Wayne County MI

`Wayne_EnerGov` / `Wayne_EnerGov2` looked like the 44-dark-page Wayne County MI prize. The org's other
15 items settle it: **`Wayne Twp Road Closures`, `Township Wide Yard Sale`, `WayneTwp_Public_
StormwaterLayers`**. A township, not the county. Rejected — and a reminder that the vendor sweep
surfaces the same cross-org lookalike class as every other search, so the owner still must be resolved.

### Other US ledgers seen in the sweep, mapped against the dark list

Already wired (skipped): Tacoma/Pierce · Nashville · Columbus · Miami-Dade · Chicago · Detroit ·
Cleveland · Hamilton TN (`RandA_CHCRPA`). Locked: Denver, Weld, Douglas NV (**CO/NV**).
**0 modelled pages** (blocker class C): Onslow NC, Pitt NC.
Baltimore city's `Housing and Building Permits 2019-Present` reappears — still the recorded
DECISION-NEEDED item (issuance ledger with no status and no work-type column).

---

## WAVE 20 — Navajo AZ and Hawaii County both REJECTED on freshness (2026-07-31)

Both first-party county ledgers found by the vendor/title sweep. Both real. Both dead.

### Navajo County AZ (32 dark) — stalled 2021-11-18

`Building Permits` on the county's own org, **59,007 rows**, point geometry in wkid 4326.
`Task` vocabulary enumerated live and **sums EXACTLY to 59,007**:
Septic incl. PERC and Well 16,925 · Meter Loop or Gas Line 11,476 · Remodel or Addition 10,762 ·
New Start Dwelling 10,234 · Garage or Accessory 6,115 · Manufactured Home 2,517 · Commercial 534 ·
Miscellaneous or Update 390 · Grading 51 · *(null)* 3.

**max `OpenDate` = 1637193600000 ms = 2021-11-18 — 4.7 years stale.** Rejected.
*(Its schema was marginal anyway — no status, no type beyond `Task`, no address, no ZIP.)*

### Hawaii County (28 dark) — a POISONED max date, caught by the paired probe

`DPW Building Permits`, **15,991 rows**, point geometry. Two things worth recording:

1. **The layer id is 14, not 0.** Both `/FeatureServer/0` URLs returned
   `{"error":{"code":400,…"The requested layer (layerId: 0) was not found."}}`. The service root
   revealed a single layer at **id 14** (`preserveLayerIds: true`). **A 400 on layer 0 is not "no
   data" — read the service root for the real layer id.**
2. **The freshness probe is why this rule exists.** Taken alone, `max(APRVD_DATE)` returns
   **95774140800000 ms — the year ~5005**, a corrupt future date that would poison any
   `orderByFields DESC` freshness check and read as "extremely fresh."
   The **paired windowed count** settles it: rows with `APRVD_DATE >= 2025-07-31` = **5**.
   Five records in a year, out of 15,991, on a county of ~200,000 people — the feed has stopped.
   Sample rows are from 2009 (`b2009-0119h`, Puna, "Revised Residence (As-Built)").

   **Rejected on freshness** — and this is the clearest demonstration yet that **a max-date probe
   MUST be paired with a windowed count**. Max alone said year 5005; the window said 5 rows. Neither
   number is interpretable without the other.

### Where the vendor sweep leaves things

The sweep's value stands — it found Allentown (**live, 3,939 records**) and correctly surfaced these
two as candidates. That two of three turned out stale is the ordinary hit rate, not a fault in the
method: **the sweep finds ledgers; the freshness gate decides which are worth wiring.**

---

## ⚠️ CORRECTION — WORCESTER MA IS NOT STALLED. A live first-party ledger exists. (2026-07-31)

The MASSACHUSETTS WIRE PASS recorded **"Worcester STALLED at 2025-09-09 → nightly reprobe list."**
That is **wrong about the city**, though it may be true of whichever endpoint was probed then.

The vendor sweep's last unidentified owner, `Innovation_andTechnology` (org `j8dqo2DJE7mVUBU1`),
resolves to the **City of Worcester's Innovation & Technology department**, and its `Building_Permits`
service is live:

- **52,299 rows**, and a sample record reads
  `Record__ B-26-1878 · Record_Type "Building Permit" · Record_Status "Complete" ·
  Address "202 MAY ST Worcester MA 01602" · Date_Submitted "5/15/2026"`
- **2,227 records carry a 2026 `Date_Submitted`** — the feed is current, not stalled
- Both vocabularies are complete and **sum EXACTLY to 52,299**:
  `Record_Status` = Complete 34,223 + Active 18,076; `Record_Type` = Building Permit 52,299 (single value)
- The org also publishes Electrical / Gas / Mechanical / Plumbing permits separately, plus
  `Bathing Beach Licenses` and `Welding Cards` — an unmistakably New England municipal roster, and
  `MBL` (Map-Block-Lot) in the schema confirms it

### 🔁 THIRD instance of a freshness probe lying — and a NEW variant

`max(Date_Submitted)` returned **`"9/9/2025"`**, which is **not** the newest record. `Date_Submitted`
is an `esriFieldTypeString` holding `M/D/YYYY`, so `max()` sorts **lexicographically**: `"9/9/2025"`
beats `"5/15/2026"` because `9` > `5` at the first character.

That is a third distinct way a max-date probe has misled this session:

| variant | seen at | what max() said | the truth |
|---|---|---|---|
| omitted recency window | Chicago→DuPage | 88 rows in scope | 7 |
| corrupt future date | Hawaii County | year ~5005 | 5 rows in the last year |
| **string date, lexicographic sort** | **Worcester** | **9/9/2025** | **5/15/2026 — newer** |

**Standing answer, strengthened: NEVER accept `max(dateField)` alone. Pair it with a windowed COUNT,
and when the field is `esriFieldTypeString`, treat `max()` as meaningless for chronology** — count on
a `LIKE '%/YYYY'` pattern instead, which is exactly what settled this (2,227 rows in 2026).

### Why it is NOT being wired: the page ceiling is ≤ 4

**Worcester County MA is 99 modelled pages with only 4 dark** — already 96% record-backed. Wiring this
would add at most 4 pages and plausibly zero, since the 4 dark are likely rural towns rather than
Worcester city. The source is also a **geometry-less Table** (no coordinates, no ZIP column — address
is a single free-text string), so it would need the arcgis geocode path plus address parsing.

**Cost is real, ceiling is ≤4 pages. Not wired — recorded as a correction and a reprobe-list removal.**
If Worcester's 4 dark ZIPs are ever shown to be city ZIPs, revisit; the source is live and good.

---

## WORCESTER FOLLOW-UP — the ≤4 ceiling is actually ≤1, VERIFIED not assumed

The entry above said the Worcester ceiling was "≤4 pages and plausibly zero, since the 4 dark are
**likely** rural towns." That word "likely" was an assumption, so it was checked. **Named the ZIPs:**

| ZIP | community |
|---|---|
| 01452 | **Hubbardston** — rural town, ~20 mi from Worcester |
| 01532 | **Northborough** — separate town |
| 01542 | **Rochdale** — village in Leicester, separate town |
| 01653 | **Worcester (01653)** — the only city ZIP, and a **PO-box-type block** |

A City of Worcester permit ledger covers **none** of the first three — they are separate
municipalities with their own building departments. The real ceiling is therefore **1 page**, and
01653 being a PO-box block makes even that likely to return zero records.

**The not-wired decision stands, now on measurement rather than inference.** Recording the ZIP names
so no future session re-opens this: the cost is the arcgis geocode path plus free-text address
parsing, and the entire prize is one PO-box ZIP.

**The genuinely valuable output of this thread is the correction, not the source**: Worcester comes
off the stalled/reprobe list, and the string-date `max()` trap is now documented with a receipt.

---

## WAVE 22 — paged the title-shape sweep to result 400; NEW HAVEN CT closed, and a Vermont lookalike

Continued paging `title:"Building Permits" AND type:"Feature Service"` (results 201–400) plus
`title:"Permits Issued"/"Permit Activity"/"Building Activity"`. Every US hit was cross-checked against
the dark list and the registry **before** probing.

### ⚠️ `admin_Waterbury` is WATERBURY, **VERMONT** — not Waterbury, Connecticut

`Residential Permits Issued _ 2016_2025` looked like the answer to **New Haven County CT (41/41 dark)**
— Waterbury is one of its largest cities. The org's other 125 items settle it beyond doubt, and the
two decisive tells are *state-specific infrastructure*:

- **`BioFinder_Processing_WFL1`** — BioFinder is **Vermont's** state biodiversity mapping system
- **`GMP Substations _ Total kW Connected`** — GMP is **Green Mountain Power, Vermont's** utility
- plus `Waterbury Center _ Designated Village`, a Vermont village designation

It is also **not a live ledger** but one layer in a **town-plan analysis series** —
`WTB _ Housing`, `WTB _ Energy`, `WTB _ Demographics`, `WTB _ Landuse Chapter Maps`,
`Visioning _ Density Layers`, `Waterbury _ Parcel Opportunity Mapping`. A municipal-plan chapter set,
not a permit feed. Rejected on both counts. *(Waterbury VT sits in Washington County VT — 26 dark —
so even taken at face value it was never the New Haven answer.)*

**New standing tell:** when two same-named places straddle states, **look for state-specific
infrastructure in the org's other layers** — a state biodiversity program, a state utility, a state
DOT. It is faster and more certain than reading coordinates.

### NEW HAVEN COUNTY CT (41 dark) — closed, no ledger exists

Searched all six major cities (New Haven, Waterbury, Meriden, Milford, Hamden, West Haven) by title
shape. **10 results, and not one building ledger:**
`Cannabis Permitted Parcels 8_17_2022` (New Haven's own org) · `Milford Open Gov` ·
`Permit Inspection_Milford_form` · `Grease Trap Permit`.
Combined with the already-closed CT statewide route (the DECD layer is municipality-year aggregates),
**New Haven County has no reachable per-record permit source.**

### Everything else on pages 3–4 mapped to already-covered or unmodelled ground

- **Already 0 dark**: Durham NC (12/12 backed), New Castle DE (29/29), Wake NC (2 dark of 39 —
  `WakeCountyGovernment` + `OpenData_ral` already serving it)
- **Already wired**: Memphis (`opmautomation_memegis` = the DPD ledger), San Marcos TX (Hays),
  Las Vegas (NV locked), Seattle, Tempe, Miami-Dade, Nashville, KCMO
- **0 modelled ZIP pages** (blocker class C): Forsyth, Catawba, Burke, Caldwell, Alexander NC
  (the `WPCOG_GIS1` regional set), Luna NM, Onondaga NY, Yolo CA, Pasadena/LA County
- **Non-US**: Oakville, Mississauga, Victoria BC, Calgary, Saugeen Shores, Columbia-Shuswap
- **Stale on the title**: Syracuse `Building Permits (2013-2019)`

**Sweep status: paged to result 400 of 1,064.** The yield curve is clear — page 1 produced Allentown,
pages 3–4 produced zero wireable sources and one instructive lookalike.

---

## ⚠️ NAPERVILLE IS WIRED BUT NOT YET PRODUCING — `WORKER_RESOURCE_LIMIT`, and it is MY config's fault

`naperville-building-permits` merged (#502) and deployed (**v127**), but the ZIP pages still show
**0 records**. Two diagnostic errors of my own were made and corrected before the real cause surfaced
— both worth recording, because each would have sent the next session down a wrong path.

### Mis-step 1: I nearly declared an engine bug from a re-cache that never ran

The first check showed 0 Naperville sites and I began hunting a connector fault. **The refresh
timestamps disproved it:** 60540/60563/60565 were last written by the **18:00 cron**, 60564 at 14:36,
60566/60567 by the **00:15 cron** — *none* at ~23:34 when I fired them. My six requests never landed,
and the `dev_refresh_collect()` that returned **188** was collecting the **cron's** responses, not mine.

**Standing answer: `dev_refresh_collect()` returning a large number is NOT evidence YOUR fire landed.**
It counts whatever is in `net._http_response`, including another writer's. **Verify
`development_reports.refreshed_at` actually moved past the moment you fired** — that is the only proof.

### Mis-step 2: the debug call timed out and told me nothing

A `debug` invocation returned `timed_out: true` with `DNS time: 120000ms`. Zero information about the
entry. Recorded only so nobody mistakes a timed-out probe for a negative result.

### THE ACTUAL CAUSE — HTTP 546 `WORKER_RESOURCE_LIMIT`

A single-ZIP re-fire at a 180 s timeout returned:

```
{"code":"WORKER_RESOURCE_LIMIT","message":"Function failed due to not having enough compute resources"}
```

**Why: this is a GEOMETRY-LESS table, so every emitted row needs its own Census geocode call** — and
the entry's scope for one ZIP is **2,490 rows** (`POSTALCODE='60540'` + the 5-type `extra_where` +
`recency_days: 1095`, measured live). Two thousand geocodes in one report blows the worker budget.
It is the documented CPU-hazard class (Miami's `outFields=*`, San Diego's naive `parseCsv`), reached
here through geocoding volume rather than payload size.

### 🔑 NEW STANDING ANSWER — geometry-less entries have a HARD per-ZIP volume ceiling

A layer with **source coordinates** costs ~nothing per row. A **geometry-less** layer costs **one
geocode per row**, so its per-ZIP row count is a *compute budget*, not just a size preference.
**Before wiring any geometry-less table, measure rows-per-ZIP in the connector's exact scope** — the
same `extra_where`, the same `recency_days`. `boulder-construction-permits` works precisely because
its per-ZIP volume is small; Naperville at ~2,490/ZIP does not.

**Status: the entry is live in the registry but emitting nothing — it is inert, not wrong.** No page
regressed and no fabricated data exists; the invariants are trivially satisfied because there are no
records. The fix is config-only (narrow `extra_where` to the 4 genuine construction types, dropping
`RESIDENTIAL: OTHER IMPROVEMENTS` — 7,660 rows of minor work, the same class the trades precedent
drops — and tighten `recency_days` to 365). Measurement of the tightened scope is in flight; the
entry will not be claimed as producing until a page actually renders records.

---

## 🟢 GO-LIVE CONFIRMED: `naperville-building-permits` — 4 pages, 1,507 records (2026-08-01)

The scope fix (#503) worked. Deployed **v128**, re-fired all six Naperville ZIPs, **verified
`refreshed_at` actually moved** before reading any counts, then materialized:

| ZIP | county | development |
|---|---|---|
| 60540 | DuPage | 455/455 |
| 60563 | DuPage | 291/291 |
| 60564 | **Will** | 221/221 |
| 60565 | DuPage | 202/202 |
| 60566 | DuPage | 0 — PO-box block |
| 60567 | DuPage | 0 — PO-box block |

**1,507 records across 4 pages — 0 missing `record_url`, 0 unclassified, and 0 missing coordinates**
(every row geocoded successfully, so the geometry-less path produced full point placement).
Bidirectional gate proof: **`IL/DuPage` and `IL/Will`, nothing else** — the two-county coverage
behaves exactly as the frisco precedent predicted.

60566/60567 returning zero is correct, not a gap: they are PO-box ZIPs, and the source's own
`POSTALCODE` distribution carries **no rows** for either (measured: 60540 9,784 · 60564 8,558 ·
60563 7,124 · 60565 6,440, and neither 60566 nor 60567 appears).

### What the fix actually was, and what it cost

`2,490 → 487` rows per ZIP, achieved config-only by dropping `RESIDENTIAL: OTHER IMPROVEMENTS`
(minor work — the class the trades precedent already drops) and tightening `recency_days` 1095 → 365.
The emitted count for 60540 came in at **486**, one under the predicted 487 — the measurement was
accurate.

### Two transient failures seen on the way, both recoverable, both worth recording

- **HTTP 503 `BOOT_ERROR`** — "Function failed to start". A neighbouring request returned 200 for a
  different ZIP in the same batch, proving the function was healthy. **A single 503 is a cold start;
  retry it rather than diagnosing it.**
- **A 120 s pg_net timeout with `DNS time: 120000ms`** on a debug call. Told me nothing about the
  entry. **A timed-out probe is not a negative result.**

### Session scoreboard update

Sources wired and CONFIRMED PRODUCING this session: **4** — Stamford CT (192 records / 6 pages),
Allentown PA (3,939 / 5), Naperville IL (1,507 / 4), plus the Chicago→DuPage coverage extension
(14 / 2). **17 pages lifted off the facilities floor, 5,652 records.**

---

## PEORIA AZ CONFIRMED LIVE — 4 dark Maricopa pages lifted, 3,518 records (2026-08-01)

`peoria-az-building-permits` (PR #505, registry 119 → 120) is deployed
(`get-address-report` **version 129**, `updated_at` 2026-08-01T01:34:28Z) and producing.

**Re-cache verified the way the earlier correction requires — `refreshed_at` MOVED before any
count was read.** All 9 Peoria ZIPs fired at ~01:36Z; every one carries
`refreshed_at = 2026-08-01 01:42:47Z`, past the fire moment. (The prior session's mistake was
reading counts from a re-cache that never ran and diagnosing a non-existent engine bug.)

**The 4 previously-dark pages, now lifted** (`app_refresh_zip`, all `quality=pass`):

| ZIP | dev before | dev after | Peoria records |
|---|---|---|---|
| 85345 | 0 | 603 | 603 |
| 85381 | 0 | 278 | 278 |
| 85373 | 0 | 36 | 36 |
| 85342 | 0 | 1 | 1 |

Five already-lit Peoria ZIPs also grew: 85383 104 → 2,323 (2,219 Peoria) · 85382 143 → 507 (364) ·
85305 701 → 705 (6) · 85306 714 → 715 (3) · 85304 646 → 647 (8).

**Invariants across all 3,518 Peoria records: 0 missing `record_url`, 0 missing coordinates,
0 unclassified, 0 non-`point` scope.** Bidirectional gate proof with live receipts: the records
ride **AZ/Maricopa pages ONLY** — 9 ZIPs, all Maricopa, cache-wide.

**Two traps this source would have sprung, both caught by existing standing answers:**
1. **The layer is id 3, not 0.** Layer 0 returns `{"error":{"code":500,"message":"json"}}` — the
   Hawaii County lesson (a failure on layer 0 is not "no data"; read the service root) is what
   found `Building Permits` at id 3.
2. **Stored `spatialReference` is wkid 2868** (NAD83 Arizona Central **feet**). Irrelevant, because
   `sources/arcgis.ts` always sends `outSR=4326` — a live sample came back `spatialReference 4326`
   at x −112.2196 / y 33.5820. The state-plane `X_COORD`/`Y_COORD` columns were deliberately NOT
   used; `__lat`/`__lng` read the reprojected geometry.

**New standing answer — `returnDistinctValues` can be UNSUPPORTED on an older ArcGIS Server, and it
fails with HTTP 200.** `gis.peoriaaz.gov` (currentVersion 11.1) answers
`returnDistinctValues=true` with a 200 carrying `{"error":{"code":400,…"Unable to perform query
operation."}}`. A caller that checks only the HTTP status reads that as an empty vocabulary — the
"wrong zero" class. groupBy worked, and the exact sums are what made it evidence: **three
vocabularies each summing to EXACTLY 3,984** (`Project_Status` 16 values, `Permit_Type` 3,
`B1_PER_GROUP` 1 = Building), plus `B1_PER_SUB_TYPE` (15) also summing to 3,984 and containing
**no trade classes at all** — so there was nothing to drop and no `extra_where` is used.

**`record_url` is `dataset` precision on the city's own layer URL, because every resident-facing
candidate failed byte-verification** — recorded so nobody re-probes them:
- `www.peoriaaz.gov` root **and** the Planning/permits department page → **HTTP 403**, Cloudflare
  `Just a moment...` interstitial (the Tampa class: a WAF against our egress, not a dead page)
- `aca-prod.accela.com/PEORIA` — both `Default.aspx` and `CapHome.aspx?module=Building` →
  **HTTP 503** Service Unavailable
- `data-peoriaaz.opendata.arcgis.com` → **HTTP 200 but the generic anonymous ArcGIS Hub shell**
  (`<title>ArcGIS Hub</title>`, no City of Peoria org) — the Michigan-pass standing answer that a
  200 on a guessed portal subdomain is not an org

### Rejections with receipts from this round (do not re-probe)

- **Santa Ana CA (Orange, 85 dark)** — `gis.santa-ana.org/server/rest/services` is live and has an
  **`Accela` folder**, which looked like the Peoria pattern. It holds exactly two services:
  `Accela_AP` (address points) and `Accela_PBA_BuildingInspectionArea` (inspection **areas**).
  **The vendor-folder trap, 6th confirmation** — a folder named for a permitting vendor usually
  holds the app's basemap, not permits.
- **Anaheim CA** — `gis.anaheim.net/map/rest/services/OpenData2/FeatureServer` enumerated: 38
  layers, **no permit ledger**. The only development-adjacent layer is 12 `Discretionary Cases`
  (polygon), and Anaheim is already wired via `anaheim-land-use-cases`
  (`Open_Data_Land_Use_Permits/FeatureServer/0`).
- **Irvine CA** — the city's own `gis.cityofirvine.org/arcgis/rest/services` is live; all 59
  services enumerated, **0 permit ledgers**. `ParcelClariti*` is the vendor-folder trap again
  (Clariti is a permitting vendor; these are parcel basemaps).
- **Fremont CA (Alameda, 51 dark)** — `Major_Residential_Projects_with_Building_Permits`
  (City of Fremont GIS) exists but the real layer is id 80 and carries **9 rows**, 2020 vintage
  (`Major_Res_Projects_2020_pts`). Too small and too stale to wire.
- **Oakland CA (Alameda)** — `data.oaklandca.gov` Socrata catalog is live (568 KB, full list read).
  Filtering every dataset name for permit/building/construction/planning returns **5 hits, none a
  permit ledger**: parking-permit zone maps (2019), a planning-areas layer (2020), a PIT-count map.
- **Louisville KY was a FALSE lead and the registry grep caught it before any probe cost** —
  `louisville-active-construction-permits` has been wired since an earlier pass, and KY/Jefferson is
  already only **4 dark of 40 pages**. This is the Spokane discipline working: grep
  `jurisdiction-registry.json` for the county BEFORE recon.

Sources wired and CONFIRMED PRODUCING this session: **5** — Stamford CT (192 records / 6 pages),
Allentown PA (3,939 / 5), Naperville IL (1,507 / 4), **Peoria AZ (3,518 / 9, of which 4 were dark)**,
plus the Chicago→DuPage coverage extension (14 / 2). **21 pages lifted off the facilities floor,
9,170 records.**

---

## COCONINO + BEND CONFIRMED LIVE — 19 dark pages lifted, 9,737 records. SALEM WAS A DUPLICATE AND IS REVERTED (2026-08-01)

Deployed as `get-address-report` **version 133** (deploy run 114 on commit `842cca0`).

### What actually landed

| source | coverage | pages lifted | records |
|---|---|---|---|
| `coconino-county-permits` | AZ / Coconino | **15** | 1,873 |
| `bend-or-permit-applications` | OR / Deschutes | **4** | 7,864 |
| ~~`salem-or-structure-permits`~~ | — | **0** | **reverted — duplicate** |

**Coconino (15):** 86046 491 · 86004 345 · 86005 277 · 86017 213 · 86001 180 · 86024 145 · 86018 65 ·
85931 43 · 86015 42 · 86038 27 · 86036 25 · 86023 9 · 86040 6 · 86045 4 · 86320 1.
**Bend (4):** 97709 3,246 · 97702 2,358 · 97701 1,877 · 97703 383.

**Invariants across all 9,737 records: 0 missing `record_url`, 0 missing coordinates, 0 unclassified,
0 non-`point` scope.** Bidirectional gate proof: Coconino rides **AZ/Coconino only** (15 ZIPs),
Bend **OR/Deschutes only** (4) — cache-wide, nothing else.

### The Salem duplicate — what happened, and the rule that would have prevented it

`salem-structure-permits` was **already in the registry, on the identical `service_url`**
(`services.arcgis.com/kIA6yS9KDGqZL7U3/…/Structure_Permits`), already producing on 9 Marion pages.
The entry I added was a second registration of the same layer.

**Cause: I grepped the registry for MO and WA coverage before wiring, and did not grep OR.** The same
grep is what caught the Louisville false lead an hour earlier. Skipping it once put duplicates in the
cache — every Salem permit stored twice under two `source_registry_id`s (97310 783 + 404, 97302
692 + 431, 97301 678 + 406, 97303 513 + 244, 97306 495 + 245, 97305 286 + 49, 97317 237 + 84).
**Exact-identity dedup cannot collapse these** — `source_registry_id` is part of the dedup key. That
is the uncatchable-duplicate class recorded when `houston-plat-applications` was rejected.

**Purged and verified: `salem-or-structure-permits` = 0 records cache-wide**, and all 9 Marion pages
are back to their pre-change counts (97310 783, 97302 692, 97301 678, 97303 513, 97306 495, 97305 286,
97317 237, 97392 234, 97325 2).

> **Standing answer, third statement of the same rule — apply it as a precondition, not a habit:**
> before wiring ANY source, grep `jurisdiction-registry.json` for **every state in the candidate's
> coverage** *and* for the **service_url host**. A URL match is the decisive check — the two Salem
> entries had different `registry_id`s and identical URLs.

### `dev_refresh_collect` has a 20-minute window and no processed-marker — it re-applies stale bodies

The first two post-revert collects wrote the duplicate back. The function selects
`distinct on (zip) … order by id desc` over `net._http_response` `where created > now() - interval
'20 minutes'` and marks nothing as consumed, so **a collect that runs before the new response lands
re-applies the newest response still in the window — which can be a pre-deploy body** — and stamps
`refreshed_at = now()`, making the row look freshly written. It took three collects to converge.

> **Standing answer:** after deploying a registry change, do not treat a collect as authoritative until
> you have confirmed the newest `net._http_response` row for that ZIP was created **after** the
> function's `updated_at`. `refreshed_at` proves a write happened; it does **not** prove which version
> of the engine produced it.

### Reprobe candidate
`bend-or-permit-applications` at 3,246 records on 97709 is the densest single page added tonight;
row size is untested against the 3.5 MB working ceiling (Cleveland 44127 at 5.98 MB remains the
known high-water mark). Not touched — logged with numbers.

---

## HUNTSVILLE → LIMESTONE CONFIRMED LIVE — 5 dark pages lifted, 2,754 records (2026-08-01)

`huntsville-building-permits` coverage AL/Madison → AL/Madison + Limestone (PR #513) is deployed
(`get-address-report` **version 134**, `updated_at` 2026-08-01T14:26:08Z). **Config only — one
coverage entry.** Second application of the KCMO straddling-city pattern.

| ZIP | probe | live engine |
|---|---|---|
| 35756 | 1,273 | **1,273** |
| 35649 | 668 | **668** |
| 35615 | 645 | **645** |
| 35613 | 133 | **132** |
| 35671 | 36 | **36** |

The other 7 Limestone ZIPs (35610, 35611, 35614, 35620, 35647, 35652, 35739) return **0** — genuinely
outside Huntsville's 5-mile envelope, honest empties. *(35613 lands at 132 against a probe of 133;
one record fails a downstream gate. Recorded as measured, not rounded to match.)*

Across all 90,851 `huntsville-building-permits` records cache-wide: **0 missing `record_url`,
0 missing coordinates, 0 unclassified.** Gate proof: AL/Madison 20 ZIPs + AL/Limestone 5 ZIPs —
exactly the two declared counties, nothing else.

**Both new checks from the previous cycle were applied and both did work:**
1. **The registry grep ran BEFORE wiring.** AL had exactly one entry and no other entry shared
   `maps.huntsvilleal.gov` — so this extended the existing entry instead of creating a second
   registration. That is the check whose absence produced the Salem duplicate.
2. **Response-after-deploy was verified before trusting the collect.** Responses created 14:32:40Z
   against a function `updated_at` of 14:26:08Z.

> **New standing answer — probe with the connector's OWN envelope math, not an equivalent-looking one.**
> `envelopeFor()` is `dLat = mi/69`, `dLng = mi/(69·cos(lat))`. A hand-rolled ±0.0724° box (correct for
> latitude, wrong for longitude at 34.8°N) returned **0** for 35613; the connector's formula returns
> **133**. The hand-rolled probe would have silently dropped a real page and recorded it as an honest
> empty. This is Rule 13 in its most literal form: *the probe must ask the question the connector asks.*

### Rejections with receipts from this round (do not re-probe)

- **Cass County MO (14 dark)** — tested as a third KCMO county. The ledger returns **0 rows for all 14
  Cass ZIPs**, and the zero is trustworthy because the **same single query** carried the control:
  `USER_Zip IN (64155, 64154, 64012, 64083, 64701)` → 64155 **4,969** · 64154 **4,106** · the three Cass
  ZIPs absent. Kansas City's permit ledger genuinely does not extend into Cass.
- **Birmingham AL / Jefferson County (60 dark — the largest AL target)** — the city's CKAN portal is
  live and does publish `Building Permits and Valuations` and `Demolition Permits`, but both are
  **STALLED at 2017**: `modified` = `2017-06-29T16:59:55`, and the newest resource file is
  `building-permits-and-valuations-2017.csv`. Annual CSV drops, abandoned.
- **Alameda County CA (51 dark)** — Berkeley and Oakland both run real Socrata portals that answered
  200 with full catalogs; **neither publishes a building-permit ledger**. Berkeley's only permit-shaped
  asset is BESO energy-compliance; Oakland's are residential *parking* permits and an affordable-housing
  aggregate. Catalog is complete, the dataset does not exist.
- **St. Louis County MO (63 dark)** — `maps.stlouisco.com` 404s, and an AGO title search for
  `"St Louis County" permits` returns **St. Louis County, MINNESOTA** (`ProseR@stlouiscountymn.gov_slcgis`).
  The Kent DE/RI cross-state trap, again.
- **Oakland County MI (78 dark)** — `data-oakgov.opendata.arcgis.com` 404 (no domain record),
  `gisportal.oakgov.com` does not answer, and `owner:OakGov` returns **0** items.
- **Oklahoma County OK (52 dark)** — `data.okc.gov` answers **403** from a WAF;
  `gis-cityofokc.opendata.arcgis.com` has no domain record.
- **Sedgwick County KS / Wichita (50 dark)** — `opendata.wichita.gov` serves the Hub SPA shell (HTML)
  at both the `/api/feed/dcat-us/1.1.json` and `/api/search/v1/...` paths; `data.wichita.gov` and
  `gis.wichita.gov` yield no JSON catalog.

> **Standing answer extension — the unscoped-search trap applies to the Hub v3 API too.**
> `hub.arcgis.com/api/v3/datasets?q=…` ignores the place words in the query. Searches for
> *Oklahoma City*, *Wichita*, *Macomb*, *Oakland County Michigan* and *Suffolk County New York* all
> returned the same lookalike set — Brampton and Oakville **Ontario**, Maricopa AZ, Detroit MI,
> Lawrence KS, New Hanover NC, Cody WY, Mendocino CA, Ft. Pierce FL, Nashua NH — and **not one**
> dataset from any of the five places searched. Hub v3 is a keyword index, not a geographic one;
> discovery still has to go through per-portal DCAT or an `orgid:`-scoped search.

---

## 🔴 FINDING — THE DOCUMENTED ROW-SIZE CEILING IS STALE BY 3.3x, AND TEN PAGES SIT NEAR 20 MB (2026-08-01)

Surfaced while sizing a Sioux Falls coverage extension. **Not fixed — reported with numbers,
because the levers all change what residents see.**

CLAUDE.md and `docs/source-registry.md` record the high-water mark as **"CLEVELAND — 44127 at
5.98 MB / 5,511 sites"**, itself a correction of an earlier stale "3.5 MB / Minneapolis 55407"
figure. Both are now wrong. Measured cache-wide today:

| ZIP | dev records | transfer MB |
|---|---|---|
| 80022 (Commerce City CO) | 20,067 | **19.61** |
| 55103 (Saint Paul MN) | **20,000** | 19.58 |
| 57105 (Sioux Falls SD) | 19,521 | 19.58 |
| 55104 (Saint Paul MN) | **20,000** | 19.57 |
| 55105 (Saint Paul MN) | **20,000** | 19.57 |
| 57104 (Sioux Falls SD) | 19,493 | 19.55 |
| 80229 | 19,902 | 19.51 |
| 80003 | 19,896 | 19.49 |
| 80233 | 19,258 | 18.89 |
| 57103 | 18,575 | 18.64 |

**Measure the right number.** `pg_column_size(sites)` reports **1.93 MB** for these rows — TOAST
compression — while `length(sites::text)`, which is what actually crosses the wire to a browser,
is **19.61 MB**. The 3.5 MB working ceiling in the docs is a *transfer* figure, so `pg_column_size`
is the wrong instrument and makes every row look fine.
> **Standing answer: size a cached page with `length(sites::text)`, never `pg_column_size`.**

**Three Saint Paul pages sit at EXACTLY 20,000 records.** An exact round number repeated across
three independent ZIPs is a cap being hit, not a coincidence — so those pages are probably
TRUNCATED, and truncation here is silent. Not chased this session; logged as the top follow-up.

### Consequence for the Sioux Falls → SD Lincoln extension: probed, real, NOT wired
Control 57104 = 141,748 in-envelope; 57108 **107,972**, 57064 **70,790**, 57032 **56,896**. Scaling
by 57104's own filter ratio puts each new page at roughly **15–19 MB**. The extension is correct and
would lift 3 dark pages, but shipping it adds three more rows to the class above rather than one page
of value. **Wired the two safe extensions in the same pass (Durham → Orange, Albuquerque → Sandoval,
which land near 2 MB) and left this one for a decision.**

The levers are `spatial_zip_radius_mi` (changes what residents see), an `out_fields` projection
(cheapest — trims per-record payload without dropping records), or a tighter `recency_days` (drops
records). All three are gated, so none was applied.

### The 20,000 is a SILENT CAP, and three Saint Paul pages are hitting it

Traced from the finding above. Every connector defaults `max_rows` to **20000** —
`sources/arcgis.ts:527`, `carto.ts:273`, `ckan.ts:265`, `csv.ts:205`, `socrata.ts:466` — and the
arcgis fetch ends at `arcgis.ts:586`:

```ts
return out.slice(0, maxRows);
```

**A truncated fetch emits nothing.** No quarantine entry, no report field, no log line — the
report is byte-identical in shape to one that fetched everything. Confirmed live: exactly
**3 pages cache-wide** sit at exactly 20,000 development records, all three Saint Paul, all three
from a single source:

| ZIP | source | records |
|---|---|---|
| 55103 | `saint-paul-approved-building-permits` | **20,000** |
| 55104 | `saint-paul-approved-building-permits` | **20,000** |
| 55105 | `saint-paul-approved-building-permits` | **20,000** |

(80022's 19.61 MB is *not* truncation — it is 19,072 Adams County + 995 Aurora, two sources under
the cap. Only the Saint Paul three are capped.)

This is the repo's own **"no silent caps"** rule failing in production code, and the site's
**"an instrument must prove it ran before its silence counts as evidence"** rule: a capped page and
a complete page are indistinguishable from the output. Whatever the newest permits in those three
Saint Paul ZIPs are, they are missing, and nothing says so.

**NOT FIXED — a code change is gated.** The fix is small and additive (push a `report.quarantined`
note, or a `truncated: true` flag, when `out.length` reaches `maxRows`) and has no behavioral
surface, but nothing is currently blocked by it, so the unblocking exception does not apply.
Recorded here with the file:line receipts so the fix is a five-minute job when approved.

---

## DEKALB → GA FULTON — 14 dark Atlanta pages, verified before wiring (2026-08-01)

Atlanta straddles the Fulton/DeKalb line. `dekalb-county-building-permits` declared **DeKalb only**,
so downtown Atlanta — 30303, 30308, 30309, 30312, 30313 — sits dark while the DeKalb ZIPs a mile away
are among the richest pages in the cache.

Found by a **local candidate ranking**, not by guessing: for every entry with a spatial radius, compute
which dark ZIP pages in *undeclared* counties fall within range of that source's own lit ZIP centroids.
DeKalb → Fulton ranked first at 19 dark pages, nearest 1.5 mi. **Proximity is a lead, not a fact**, so
each was then probed live with the connector's own `envelopeFor()` math (radius 5).

**Control 30033 (DeKalb, lit) = 50,170.** 14 of 17 probed Fulton ZIPs carry DeKalb permits in range:

| ZIP | in envelope | | ZIP | in envelope |
|---|---|---|---|---|
| 30306 | 38,136 | | 30303 | 13,791 |
| 30324 | 28,678 | | 30315 | 9,323 |
| 30326 | 25,951 | | 30327 | 2,611 |
| 30308 | 20,532 | | 30314 | 2,157 |
| 30309 | 19,794 | | 30310 | 1,767 |
| 30305 | 18,973 | | 30328 | 1,133 |
| 30312 | 15,322 | | 30318 · 30331 · 30337 | **0** |
| 30313 | 14,193 | | | |

### Size, stated plainly — this interacts with the open row-size item above
DeKalb's own pages already run **8.69–10.45 MB** (30021 8.69 · 30345 8.90 · 30032 8.80 · 30033 10.45),
i.e. this county is *already* well past the 3.5 MB working ceiling. Measured pass rate is
**10,844 / 50,170 = 21.6%**, so the new Fulton pages project to roughly **1–8 MB** (30306 the largest
at ~8,200 records).

**Wired.** That is below the 15–19 MB class I declined for Sioux Falls, and inside the range already
live in this very county — so the line is consistent: *decline the ~19 MB class, ship below it, state
the numbers either way.* If the row-size decision later goes toward an `out_fields` projection, DeKalb
is the single highest-value entry to apply it to.

Precondition grep: only `dekalb-county-building-permits` uses `dcgis.dekalbcountyga.gov`; GA Fulton's
existing `johns-creek-building-permits` is a different host and a different layer covering north Fulton,
so this is an extension, not a second registration.

---

## 🔴 PROCESS FAILURE — A `git reset --hard` SILENTLY DROPPED A MERGED-LOOKING CHANGE (2026-08-01)

**PR #515 did not contain what its own PR body described.** It was opened for the
Durham → NC Orange and Albuquerque → NM Sandoval coverage extensions; what actually merged was
**only** the silent-cap QUEUE entry. The registry change and the row-size finding were never in it,
and I reported both as shipped. They were not.

**Mechanism, from the reflog:**

```
14:39:06  commit 27a956f  Extend durham -> NC Orange and albuquerque -> NM Sandoval coverage
14:39:54  commit 81b1a63  FINDING: documented row-size ceiling is stale 3.3x
14:40:49  reset: moving to origin/main        <-- discarded BOTH
14:40:54  commit 7f96331  FINDING: the 20,000-row cap is silent
```

I had adopted `git fetch origin main && git reset --hard origin/main` as a habitual "sync before
editing" prefix. Run on a feature branch that carries **unmerged** commits, it silently rewinds them,
and the follow-up `git push --force-with-lease` then **succeeds** — the lease compares against my own
previous push, not against the commits I had just destroyed. `--force-with-lease` protects against
*other* writers; it is no protection at all against yourself.

**How it surfaced — and why it would not have surfaced from the repo alone:** the go-live re-cache
returned `development = 0` for all five Durham/Orange and Sandoval ZIPs while the same batch returned
real counts for all 14 DeKalb/Fulton ZIPs, from responses timestamped **after** the deploy. The
config-vs-behavior mismatch is what exposed it. Every repo-side signal looked green: CI passed, the PR
merged, the branch was clean.

**Recovered** by cherry-picking `27a956f` and `81b1a63` out of the reflog; the row-size section
conflicted with the silent-cap section that had landed in the meantime and was merged by hand,
preserving both in full.

> **Standing answer — never `reset --hard` a branch that carries unpushed or unmerged work.**
> To sync a feature branch, `git rebase origin/main` (which preserves your commits and *tells you*
> about conflicts) or branch afresh from main and cherry-pick. Reserve `reset --hard origin/main` for
> a branch whose work is already merged.
>
> **And verify the artifact, not the ceremony.** A green CI run and a successful merge attest that
> *something* merged, not that *your change* merged. After merging a registry change, re-read the
> field on `main` — `git show origin/main:<file>` — before reporting it as shipped. This is the site's
> own "an instrument must prove it ran before its silence counts as evidence" rule: a PR that merges
> the wrong content is success-shaped output attesting to nothing.

---

## DEKALB → GA FULTON CONFIRMED LIVE — 14 dark Atlanta pages, 15,124 records (2026-08-01)

Deployed as `get-address-report` **version 135**. All 14 materialize `quality=pass`:

| ZIP | dev | | ZIP | dev |
|---|---|---|---|---|
| 30305 | 3,198 | | 30313 | 937 |
| 30326 | 1,885 | | 30303 | 935 |
| 30306 | 947 | | 30312 | 933 |
| 30324 | 943 | | 30308 | 932 |
| 30309 | 928 | | 30315 | 926 |
| 30327 | 851 | | 30314 | 784 |
| 30310 | 575 | | 30328 | 250 |

Across all 111,482 `dekalb-county-building-permits` records cache-wide: **0 missing `record_url`,
0 missing coordinates, 0 unclassified.** Gate proof: **GA/DeKalb 31 ZIPs + GA/Fulton 14 ZIPs** —
exactly the two declared counties.

### Correction: my size projection was wrong, in the safe direction
I projected **1–8 MB** per Fulton page from a 21.6 % pass rate. Measured: **0.25–3.09 MB**
(30305 3.09 · 30326 1.83 · 30306 0.92 · 30303 0.92 · 30328 0.25) — **every page under the 3.5 MB
working ceiling**. The extrapolation was too pessimistic because the DeKalb ZIPs I sampled for the
ratio sit in much denser permit territory than Atlanta's Fulton side; 30306 returned 947 records
against 38,136 in its envelope (2.5 %), not the ~8,200 predicted.
> **Standing answer: a per-page record count cannot be extrapolated from another ZIP's pass rate** —
> `recency_days` and the status/type filters bite very differently across a metro. Project a range if
> you must gate a decision on it, but measure before reporting it.

---

## DURHAM → ORANGE + ALBUQUERQUE → SANDOVAL CONFIRMED LIVE — 5 pages, 3,240 records (2026-08-01)

Deployed as `get-address-report` **version 136** after the lost commit was recovered. The re-cache
produced an unusually clean natural experiment: both the broken and fixed responses are in
`net._http_response` at once, same ZIPs, same query, **14 minutes apart**, straddling the deploy.

| ZIP | 15:28 (registry change missing) | 15:42 (recovered) |
|---|---|---|
| 27517 Chapel Hill | 0 | **1,996** |
| 27514 Chapel Hill | 0 | **1,044** |
| 87124 Rio Rancho | 0 | **98** |
| 87048 Corrales | 0 | **93** |
| 27510 Carrboro | 0 | **9** |

All 5 materialize `quality=pass`. Invariants: **`durham-building-permits` 40,843 records / 15 ZIPs and
`albuquerque-building-permits` 8,246 / 24 ZIPs — 0 missing `record_url`, 0 missing coordinates,
0 unclassified.** Gate proof: Durham → NC/Durham 12 + NC/Orange 3; Albuquerque → NM/Bernalillo 22 +
NM/Sandoval 2. Exactly the declared counties.

That 0 → non-zero pair *is* the evidence for the process finding above: the config was absent, not the
data. It is also the argument for the standing answer — **only the behavioural check caught it.** CI
was green, the PR merged, the branch was clean, and the registry on `main` was silently missing the
field the PR body described.

### Session tally — coverage extensions, all config-only, no connector/engine/schema change

| extension | pages | records |
|---|---|---|
| `kcmo-building-permits` → MO Clay + Platte | 17 | 1,414 |
| `coconino-county-permits` (new) | 15 | 1,873 |
| `bend-or-permit-applications` (new) | 4 | 7,864 |
| `huntsville-building-permits` → AL Limestone | 5 | 2,754 |
| `dekalb-county-building-permits` → GA Fulton | 14 | 15,124 |
| `durham-building-permits` → NC Orange | 3 | 3,049 |
| `albuquerque-building-permits` → NM Sandoval | 2 | 191 |
| **total** | **60** | **32,269** |

Every one verified with a positive control before wiring, a gate proof after, and
`0 missing record_url / 0 missing coordinates / 0 unclassified` across the affected sources.
One wire was reverted (`salem-or-structure-permits`, a duplicate) and one declined on size
(Sioux Falls → SD Lincoln).

---

## FOUR COVERAGE EXTENSIONS CONFIRMED LIVE — 30 dark pages, 3,407 records (2026-08-01)

Deployed as `get-address-report` **version 137**. All materialize `quality=pass`.

**`fairfax-recent-building-permits` → VA Arlington — 11 of 11:** 22213 432 · 22205 311 · 22207 205 ·
22203 153 · 22204 81 · 22206 68 · 22201 57 · 22214 25 · 22211 20 · 22209 12 · 22202 1.
**`overland-park-building-permits` → KS Wyandotte — 8 of 8:** 66103 725 · 66106 724 · 66105 223 ·
66160 137 · 66118 78 · 66102 18 · 66112 18 · 66101 9.
**`kenton-county-devtracking-permits` → KY Campbell — 7 of 7:** 41071 21 · 41075 18 · 41073 15 ·
41076 15 · 41074 13 · 41001 1 · 41085 1.
**`new-castle-county-permits` → PA Delaware — 4 of 5:** 19017 8 · 19014 7 · 19015 6 · 19013 5.

Invariants across all four sources — **fairfax 19,013 records / 58 ZIPs · overland-park 165,190 / 38 ·
new-castle 7,881 / 33 · kenton 338 / 15 — 0 missing `record_url`, 0 missing coordinates,
0 unclassified.** Gate proof, each exactly its two declared counties: Fairfax 47 + Arlington 11 ·
Johnson 30 + Wyandotte 8 · New Castle 29 + Delaware PA 4 · Kenton 8 + Campbell 7.

**19022 (Brookhaven PA) probed at 7 in-envelope and materialized 0** — every candidate was dropped by
the entry's own status/type/recency filters. It stays on the facilities floor. That is the honest
outcome, and it is also the second demonstration today that **an envelope count is an upper bound, not
a prediction**: PA Delaware's five hits filtered from 1,075 / 785 / 749 / 563 / 7 down to 8 / 7 / 6 /
5 / 0. Envelope counts size a *candidate set*; only the live engine reports what a page will hold.

### Rejections with receipts — both killed by their own controls
- **`butler-county-ks-permits` → KS Sedgwick.** Control ZIP 66840 (inside Butler, already live)
  returned **1** record. The source is essentially empty near the county line, so the two 1-record
  hits in Sedgwick are noise, not coverage. *A control that comes back tiny invalidates the whole
  probe set — it means the layer has nothing there to find, not that the target is dark.*
- **`pierce-county-pals-permits` → WA King.** Control 98303 = **6,830** (healthy), yet only 1 of 6
  probed King ZIPs had anything (98003, 50). Here the control being strong is exactly what makes the
  zeros trustworthy: the query works, King County simply sits outside Pierce's permit footprint.

### Scope note
`fairfax` has a second entry, `fairfax-active-site-construction`, flagged by the same ranking. It was
**not probed and not extended** — only the layer actually verified was wired.

---

## 🔴 CORRECTION + FINDING — THE THREE "CAPPED" SAINT PAUL PAGES ARE STALE ROWS FROM A **RETIRED** SOURCE (2026-08-01)

**Correcting my own finding recorded earlier today.** I reported the silent `max_rows` cap with
55103/55104/55105 as live evidence. The code half is right and stands. **The evidence was wrong**, and
the truth is a different (also real) problem.

`saint-paul-approved-building-permits` **is not in the registry.** It was **retired by founder call on
2026-07-28** (commit `2abef41`, PR #427) precisely because of the payload problem I "rediscovered":
the layer is stalled at `max(ISSUEDATE) 2025-06-30`, a 365-day window returns 0 rows, and 730 days
implies a ~14–19 MB cached row against the ~3.5 MB ceiling. That decision was already made, with
better analysis than mine, four days ago.

**But three pages never got the memo:**

| ZIP | `refreshed_at` | dev | of which `saint-paul-*` |
|---|---|---|---|
| 55103 | **2026-07-29 04:15Z** | 20,000 | 20,000 |
| 55104 | **2026-07-29 01:45Z** | 20,000 | 20,000 |
| 55105 | **2026-07-29 01:30Z** | 20,000 | 20,000 |
| 55101 | 2026-08-01 15:33Z | 0 | 0 |
| 55102 | 2026-07-31 23:45Z | 0 | 0 |
| 55107 | 2026-08-01 13:30Z | 0 | 0 |
| 55117 | 2026-08-01 13:15Z | 0 | 0 |

Their Ramsey neighbours refresh daily and correctly show 0. These three are **frozen since 29 July**,
serving 19.5 MB of records from a source that no longer exists in the registry.

**Why they're stuck — and it is the transient-safe guard doing its job.** `dev_refresh_collect`
refuses a response when `cached refreshed_at >= now() - 7 days AND new development = 0 AND cached
development > 0`. Every nightly run now returns 0 (the source is gone) and is rejected as a suspected
flake. The refusal does **not** bump `refreshed_at`, so the 7-day clock keeps running from 29 July and
**the rows self-heal around 5 August**, when the guard expires and the honest 0 is accepted.

**Not overridden.** Forcing these rows now means writing past a guard built specifically to stop an
agent from clobbering good pages with a transient zero. It expires on its own in ~4 days, and the
founder's retirement decision already anticipated these pages returning to the facilities floor.
Flagged, not touched.

### What this does to the silent-cap finding
The `max_rows ?? 20000` + `out.slice(0, maxRows)` truncation is **still real and still silent**
(`arcgis.ts:527/586`, `carto.ts:273`, `ckan.ts:265`, `csv.ts:205`, `socrata.ts:466`). What changes is
the blast radius: **no live source is currently hitting it.** The only three pages at exactly 20,000
come from the retired entry. 80022 (19.61 MB) is *not* truncation either — 19,072 Adams + 995 Aurora,
both under the cap. So the fix is still worth doing, but it is **latent hardening, not an active
incident.**

> **Standing answer — a `source_registry_id` in the CACHE does not mean the entry is in the REGISTRY.**
> Cached rows outlive the config that produced them. Before treating cached records as evidence about
> current behaviour, grep the registry for that `registry_id` and check the row's `refreshed_at`. I
> spent a finding on a source that had been deliberately deleted four days earlier.

---

## BATCH 3 CONFIRMED LIVE — 11 pages, 2,839 records (2026-08-01)

Deployed as `get-address-report` **version 138**. All materialize `quality=pass`.

**`new-orleans-permits` → LA Jefferson — 5 of 5:** 70053 Gretna 335 · 70005 Metairie 265 ·
70002 42 · 70056 36 · 70001 23.
**`minneapolis-ccs-permits` → MN Ramsey — 3 of 3:** 55116 639 · 55108 514 · 55112 3.
**`dekalb-county-building-permits` → GA Gwinnett — 2 of 2:** 30039 882 · 30047 99.
**`chicago-building-permits` → IN Lake — 1 of 2:** 46327 Hammond **1**.

Gate proof, each exactly its declared counties: Orleans 20 + Jefferson 5 · Hennepin 28 + Ramsey 4 ·
DeKalb 31 + Fulton 14 + Gwinnett 2 · Cook 131 + DuPage 2 + Lake IN 1. Across all 258,632 records from
these four sources: **0 missing `record_url`, 0 missing coordinates, 0 unclassified.**

⚠️ **Chicago → IN Lake is honestly near-worthless and is reported as such.** 46327 probed at **1,972**
in-envelope and materialized **1 record**; 46320 probed at 9 and materialized **0**. Chicago's
`extra_where` whitelist (NEW CONSTRUCTION / RENOVATION-ALTERATION / WRECKING-DEMOLITION / PORCH) plus
its 365-day window removes essentially everything that far outside the city. The one record is real and
carries a `record_url`, so the entry is kept rather than reverted — but it lifts one page by one row,
and that is the whole of it. **Third demonstration today that an envelope count is an upper bound:
1,972 → 1.**

Minneapolis → Ramsey is the opposite case and matters more than its 3 pages suggest: Ramsey has been on
the facilities floor since Saint Paul was retired, so this is the only permit source those pages have.

### Session total — coverage work, all config-only

**101 dark pages lifted, 38,515 records**, across `kcmo` (17) · `coconino` (15) · `bend` (4) ·
`huntsville` (5) · `dekalb`→Fulton (14) + Gwinnett (2) · `durham` (3) · `albuquerque` (2) ·
`fairfax`→Arlington (11) · `overland-park`→Wyandotte (8) · `kenton`→Campbell (7) ·
`new-castle`→Delaware PA (4) · `new-orleans`→Jefferson (5) · `minneapolis`→Ramsey (3) ·
`chicago`→Lake IN (1).

Every one carries a positive control before wiring and a gate proof after. **Reverted:** 1 duplicate
(`salem-or-structure-permits`). **Declined on size:** Sioux Falls → SD Lincoln. **Rejected with
receipts:** Cass MO · Birmingham AL · Alameda CA · St. Louis County MO · Oakland County MI ·
Oklahoma County OK · Sedgwick KS (twice — portal, then `butler` control) · Lancaster PA · Snohomish WA ·
Pierce → King WA · DeKalb → Cobb GA.

---

## 🔴 SELF-CORRECTION — I WIRED THE LARGEST PAGE IN THE CACHE, THEN REVERTED IT (2026-08-01)

Batch 4 went live and I measured the result before reporting it. `adams-county-building-permits` →
CO Jefferson produced:

| ZIP | dev records | transfer MB |
|---|---|---|
| **80001** | 20,041 | **19.65** ← largest page in the entire cache |
| **80002** | 16,571 | **16.26** |
| 80005 | 9,194 | 9.03 |
| 80004 | 6,518 | 6.41 |

Hours earlier in this same session I **declined Sioux Falls → SD Lincoln specifically to avoid adding
15–19 MB pages**, and recorded the previous high-water mark as 19.61 MB. Then I wired an extension that
beat it. The rule I wrote was right; I did not apply it to my own next change.

**Reverted `adams-county-building-permits` → CO Jefferson.** `denver-residential-construction-permits`
→ CO Jefferson **stays**, and it carries most of the value at a fraction of the weight:

- Kept lit by Denver alone: **80001 (4,829) · 80002 (3,117) · 80123 (1,349) · 80127 (365) · 80004 (24)**
  — 5 of the 6 pages, and 80001/80002 drop from 19.65/16.26 MB to roughly 4.7/3.0 MB.
- **Lost: 80005 only** (Adams was its sole source). One page returns to the facilities floor.

So the trade is **5 sane pages instead of 6 pages including the two heaviest rows in production** — for
the cost of one page. 80124 (Douglas, 342) and 19311 (Chester, 15) are unaffected and stay.

> **Standing answer — measure the page you just created, before you report it.** An extension's size is
> not knowable from the envelope probe (Adams showed 20,786 in-envelope at 80001 and stored 20,041 —
> a ~96 % pass rate, where DeKalb's Atlanta pages passed 2.5 %). The pass rate is a property of the
> entry's filters, and `adams-county-building-permits` has effectively none. **Check
> `length(sites::text)` on the new pages as the last step of every coverage extension**, not only when
> something looks suspicious.

⚠️ **80001 also demonstrates the silent cap for real, on a live source.** Its 20,041 total is
20,000 from Adams (**exactly the `max_rows` default — truncated, silently**) plus 41 from elsewhere.
Earlier today I recorded that "no live source is currently hitting the cap"; **that is now false — I
made it false**, briefly, and the revert removes it again. The cap fix remains latent hardening, but
this is the first live proof that a real source can hit it and say nothing.

### Post-revert measurement — and a correction to my own revert PR

Measured after the revert deployed (v140):

| ZIP | before revert | after revert |
|---|---|---|
| 80001 | 20,041 / **19.65 MB** | **128 / 0.15 MB** |
| 80002 | 16,571 / **16.26 MB** | **77 / 0.10 MB** |
| 80004 | 6,518 | 1 |
| 80123 · 80127 | 7 · 3 | 7 · 3 |

**My revert PR predicted 80001/80002 would land near 4.7 / 3.0 MB. They landed at 0.15 / 0.10 MB.**
I had again quoted Denver's *envelope* counts (4,829 / 3,117) as if they were stored counts; Denver's
own filters take 80001 from 4,829 candidates to **128** records. Fourth instance today of the same
mistake, and this one is worth naming precisely: **I keep reaching for the envelope number because it
is the one I already have.** The stored number requires a deploy and a re-cache, so the temptation is
to publish the cheap figure. That is exactly when it must be labelled a candidate count, not a result.

Batch 4 final, honest: **7 pages, 573 records** — Jefferson CO 5 (80001 128 · 80002 77 · 80123 7 ·
80127 3 · 80004 1) · Douglas CO 1 (80124 342) · Chester PA 1 (19311 15).

⚠️ **80005 still shows 9,194 records / 9.03 MB from the reverted Adams entry**, and will for up to a
week. Same mechanism as the Saint Paul pages: `dev_refresh_collect` refuses the now-zero response while
the cached row is under 7 days old, and the refusal does not bump `refreshed_at`. It self-heals around
**8 August**. Not overridden — same reasoning as before, the guard exists to stop exactly this kind of
agent-initiated write.

> **Standing answer — a coverage REVERT does not take effect on already-cached pages for up to 7 days.**
> Wiring is fast; unwiring is slow. Budget for that asymmetry before shipping an extension you are not
> sure about, because the cheap-to-add change is not cheap to withdraw.

---

## 🔴 THE NIGHTLY SOURCE-MONITOR HAS BEEN DEAD SINCE 31 JULY — root cause found (2026-08-01)

`source-monitor.yml` is the repo's own instrument for the work I have been doing by hand all session:
it re-probes every rejected source nightly, walks first-party catalogs for facility-floor
jurisdictions, and **auto-wires** anything that passes the fail-closed gate. **Its last two scheduled
runs both failed**, and nothing surfaced that except the Actions tab.

| run | date | event | result |
|---|---|---|---|
| 31 | 2026-08-01 09:05Z | schedule | **failure** |
| 30 | 2026-07-31 09:44Z | schedule | **failure** |
| 24 | 2026-07-30 09:29Z | schedule | success |

**It never reaches the monitor.** The failing step is the one *before* it:

```
Live scoreboard (ranked work list) → node scripts/live-scoreboard.mjs
live-scoreboard failed: dev_zip_source_ids failed: HTTP 500
  {"code":"57014","message":"canceling statement due to statement timeout"}
##[error]Process completed with exit code 1.
```

`bash -e` fails the step, the job aborts, and **the reprobe, the discovery walk, the auto-wire and the
report never run at all.**

### Root cause — measured, not guessed

`scripts/live-scoreboard.mjs:104` requests `p_limit: 5000`. There are only **4,228** distinct
development ZIPs in `app_projects` (2,684,556 development rows of 2,901,975 total). **The limit can
never be reached**, so `dev_zip_source_ids`'s `GroupAggregate` cannot stop early and scans the whole
index. Measured with `EXPLAIN ANALYZE`:

| `limit` | rows scanned | execution time |
|---|---|---|
| 1000 | 207,827 | **1,073 ms** |
| 5000 | **2,684,556** | **14,806 ms** ← past the PostgREST statement timeout |

At 1000 the incremental sort stops as soon as the limit fills; at 5000 it degenerates into a full
scan. This is growth-triggered — the same class as the 57014 that forced the `verify-development`
pagination fix (PR #221) — and my own 108 new pages this session pushed it over.

### The fix is one value, and it has a trap

`p_limit: 5000` → `1000`. **But the loop's terminator is the same literal in a second place**
(`scripts/live-scoreboard.mjs:115`, `if (page.length < 5000) break;`). Change only the request and the
first 1,000-row page satisfies `1000 < 5000` and **breaks immediately** — the scoreboard would read
1,000 of 4,228 ZIPs and report a plausible, wrong number. The existing assertions would **not** catch
it: `srcByZip.size` and `withRecords` would both be non-zero. So the fix is *one named constant used
in both places*, not two edits of the same digit.

**NOT FIXED — a code change is gated**, and nothing I was asked to do is blocked by it (I did the
monitor's job by hand instead). Recorded with file:line, the measurement and the trap so it is a
five-minute job when approved.

⚠️ **Two things I logged this session were logged to a list nobody is reading:** Snohomish WA
(stalled, "→ nightly reprobe list") and the KCMO layer's `max(USER_Issue_Date) = 2025-12-31` watch item.
The reprobe list is `scripts/source-monitor-targets.json` and it is only consulted by this dead job.

> **Standing answer — the step that guards an instrument can kill the instrument.** The scoreboard step
> is deliberately not `continue-on-error`, with a good comment explaining why (a silent pass was worse).
> It succeeded at being loud, and took the auto-wire path down with it. When a hardened pre-step gates
> a job whose real work is independent of it, verify the *job* still runs — a green assertion that
> aborts everything downstream is its own kind of silent failure.

---

## 🔴 `las-vegas-building-permits` IS SCOPED AND LABELLED BY THE OWNER'S MAILING ADDRESS (2026-08-01)

Found by ranking the **native-ZIP** sources — the seam my earlier radius-based ranking missed (KCMO is
native-ZIP, and it was the biggest lift of the session, so the seam was worth checking). Only 8 entries
scope by a ZIP column; the coverage payoff was nil, but one of them is wired to the wrong field.

**The evidence.** `ZIP`, `CITY`, `STATE` and `ADDR1` on `OpenData_Building_Permits_` are the
**`LEGALOWNER`'s mailing address**, not the permitted property. A row pulled verbatim:

```
ZIP        92660          CITY  NEWPORT BEACH      STATE  CA
ADDR1      4425 JAMBOREE RD STE 115
LEGALOWNER D & L DEVELOPMENT 4425 JAMBOREE RD STE 115 NEWPORT BEACH CA 92660
  …but the PROPERTY is:  STNO 8526 · STNAME DEL WEBB · SUFFIX BLVD
                          SUBDIV "SUN CITY SUMMERLIN-UNIT #14"   (Las Vegas)
geometry   null
```

The entry uses `zip_where_template: "ZIP LIKE '{zip}%'"` and
`column_map.address: ["ADDR1","CITY","STATE"]` — so it **selects** rows by where the owner gets mail
and **displays** the owner's office as the record's address. The layer carries the real property
address in `STNO`/`PREDIR`/`STNAME`/`SUFFIX`; nothing reads it.

**Live blast radius — 3,099 records across 51 Clark County pages, 1,457 distinct addresses (2.1
records per address).** The concentration is the tell, and every one of these is a suite number:

| address | records | pages |
|---|---|---|
| 5795 BADURA AVE **STE 180** LAS VEGAS NV | **174** | 1 |
| 7455 ARROYO CROSSING PKWY LAS VEGAS NV | 169 | 1 |
| 6385 S RAINBOW BLVD **STE 300** LAS VEGAS NV | 139 | 1 |
| 6345 S JONES BLVD **STE 400** LAS VEGAS NV | 126 | 1 |
| 7895 W SUNSET RD **STE 110** LAS VEGAS NV | 96 | 1 |
| 7255 N TENAYA WAY **STE 200** LAS VEGAS NV | 88 | 1 |
| 770 E WARM SPRINGS RD **STE 240** LAS VEGAS NV | 78 | 1 |
| 1140 TOWN CENTER DR **STE 250** LAS VEGAS NV | 69 | 1 |

The top 8 addresses carry **939 of 3,099 records (30 %)**. A resident on 89118 sees **174 separate
`ProdHome`/`Model` permits stacked on one builder's office suite**, while the homes actually being
built are scattered across the valley and appear on **no** page. And the mirror failure: a Las Vegas
property whose owner is in Newport Beach is selected for ZIP 92660 — a CA/Orange page, which the
coverage gate correctly refuses — so it is dropped entirely.

### ⚠️ Correction to my own first measurement
My first pass reported "**3,099 of 3,099 records have a non-NV address**" from
`addr !~* ', *NV'`. That regex requires a **comma** before NV; the field is formatted
`"… LAS VEGAS NV"` with no comma, so it matched everything. The true figure is **2**. I caught it only
because I sampled rows instead of trusting the count — the repo's own rule, and it nearly produced a
dramatic and completely false claim in the same message as a real one.

### Not fixed — this needs a decision, not a patch
`column_map.address` could be pointed at `["STNO","PREDIR","STNAME","SUFFIX"]` (arrays JOIN, so that
yields `8526 DEL WEBB BLVD`) — but **the selection cannot be fixed in config: the layer exposes no
property ZIP.** Correcting only the display gives the right address on the wrong page, which is worse
than today. The real options are (a) retire the entry, (b) keep it and accept office-pinned records,
or (c) build a property-address geocode path — a code change. All three are founder calls.

✅ **RESOLVED 2026-08-02 (founder-authorised objective 3) — (a) RETIRE. The measurement that decided it
is that retiring costs ZERO pages.** Of the 51 Clark County pages carrying its records, **51 keep
content from other sources and 0 go dark**: those ZIPs are already lit by `clark-county-active-projects`,
`clv-planning-cases`, `henderson-residential-permits` and `henderson-commercial-permits`. So this was
never coverage-vs-correctness. Keeping the entry bought **no LIVE page** and cost **3,121 records
asserting a locality the source does not support** — a resident of 89118 shown 174 `ProdHome`/`Model`
permits stacked on one builder's office suite, while the homes actually being built appear on no page.

**(c) is closed by a field inventory, not an opinion.** Live layer metadata (pg_net, 436,181 rows) lists
38 fields — `APNO … STNO, PREDIR, STNAME, SUFFIX, POSTDIR, … PRCLID, SUBDIV, … LEGALOWNER, ADDR1, CITY,
STATE, ZIP, … ObjectId` — i.e. **one ZIP field, the owner's, and no geometry**. A property-address path
would need the whole 436k-row layer bulk-geocoded into a ZIP *before* selection: a separate ingest job,
not a connector option. Registry 149 → 148 entries; removal asserted programmatically to be exactly this
one id, nothing else added or dropped. Full rationale + how it comes back:
`docs/source-registry.md` "Two defects found in EXISTING entries".

---

## AUDIT — IS THE LAS VEGAS WRONG-FIELD DEFECT SYSTEMIC? NO. IT IS ISOLATED (2026-08-01)

Having found one source scoped by the owner's address, the obvious question is whether others are.
The defect has a measurable signature: **many records pinned to one coordinate** (a builder's office
serving scattered properties). Scanned every wired source for it.

**Two false starts, both worth recording as method:**

1. **Records-per-distinct-point across all pages is CONFOUNDED.** Overlapping ZIP circles mean one
   permit legitimately appears on many neighbouring pages, so a 5-mile source like
   `overland-park-building-permits` scored 17.0 purely from page overlap. That number measures the
   radius, not the data.
2. **`source_ref` cannot dedupe it.** For `record_url_precision: "dataset"` entries it is the portal
   URL, identical on every row — there is no per-record id to group on.

**The metric that works: records-per-distinct-point WITHIN A SINGLE PAGE** (no cross-page duplication
possible), excluding coordinates equal to the report centroid (those are area-scope records anchored
there by design, and would otherwise dominate). Busiest page per source:

| source | page | records | distinct points | per point |
|---|---|---|---|---|
| **`las-vegas-building-permits`** | 89118 | 494 | **12** | **41.2** |
| **`clv-planning-cases`** | 89143 | 1,575 | **49** | **32.1** |
| `brunswick-county-permits` | 28468 | 19,515 | 3,121 | 6.3 |
| `cabarrus-county-plan-reviews` | 28027 | 11,689 | 2,026 | 5.8 |
| `miami-building-permits` | 33145 | 3,147 | 662 | 4.8 |
| `nyc-dobnow-approved-permits` | 10022 | 1,156 | 293 | 3.9 |
| … 100+ others | | | | **≤ 2.9** |

The separation is sharp: two entries at 32–41, then a drop to 6.3 and a long tail at ~2 (a parcel
legitimately carrying two permits).

### The second outlier is BENIGN — checked, not assumed
`clv-planning-cases` places records by the layer's own geometry (`__lat`/`__lng`), not by geocoding an
address, so the mechanism cannot be the Las Vegas one. Sampling 89143 shows why the ratio is high and
why it is correct: **one project files several distinct application types at the same parcel.**

```
VUE PHASE III   → 21-0516-SDR1 · 21-0516-ZON1 · 21-0516-GPA1 · 21-0516-MOD1   (all 2021-12-15)
Deer Springs Senior Living → 21-0169-SUP1 · SUP2 · SUP3 · 21-0169-SDR1        (all 2021-10-12)
Centennial Hills Apartments → 21-0339-SDR1 · 21-0339-SUP1                     (2021-09-14)
```

Site-development review, rezoning, general-plan amendment and modification are four **real, separately
docketed applications** on one parcel — each with its own case number. Collapsing them would hide real
filings. **No change warranted.**

### Conclusion
**The wrong-field defect is isolated to `las-vegas-building-permits`.** No other wired source shows the
signature. That is a negative result, and it is worth as much as the positive one: it bounds the
earlier finding to a single entry instead of leaving an open question about all ~150.

---

## DISCOVERY WALK — I RAN THE DEAD MONITOR'S JOB BY HAND; 10 CURATED TARGETS, 0 WIREABLE (2026-08-01)

`scripts/source-monitor-targets.json` carries a **`discovery[]` list of 44 official first-party
catalogs** for facility-floor jurisdictions — curated, host-allowlisted, immune to the lookalike trap
that wrecked my earlier ad-hoc searches. The job that walks it is the one that has been dead since
31 July, so I walked the top 10 by dark-page count myself.

| target | dark pages | outcome |
|---|---|---|
| `orange-county-arcgis` | 85 | REST live; only county CIP (51 + 19 polygons) — probed earlier |
| `anaheim-dcat` | 85 | **Real source found, 0 lift — see below** |
| `alameda-county-socrata` | 51 | `data.acgov.org` has **no Socrata views API** (404); its DCAT carries no permit dataset |
| `contracosta-county-arcgis` | 43 | REST live, 23 folders, **no permits folder** |
| `sonoma-county-socrata` | 40 | previously rejected (no city/ZIP/coords) — unchanged |
| `annearundel-arcgis` | 37 | REST live and has an **`InspectionsPermits` folder** — `{"code":499,"message":"Token Required"}` |
| `ventura-county-arcgis` | 34 | REST live, 8 folders, **no permits folder** |
| `sanmateo-county-socrata` | 31 | catalog live; permit hits are **aggregates only** ("PercentOfBuildingPermitsCreatedOnline") |
| `slo-county-dcat` | 29 | catalog live; permit hits are **water-well permits** + building *footprints* |
| `howard-county-socrata` | 21 | the combined permits table `s2bd-vjgd` returns **403 "no row or column access to non-tabular tables"** |

### The one real find — and why it is NOT wired
`data-anaheim` publishes **`Accela_Building_Permits`** (`services3.arcgis.com/hPs600I3X0RTaaaq/…/FeatureServer/0`),
**distinct from the wired `anaheim-land-use-cases`** (that one is `Open_Data_Land_Use_Permits`). It is a
genuinely good source: `modified` **2026-08-01T17:00:45Z — today**, **191,375 rows**, property
addresses carrying the ZIP inline (`"500 S Euclid St A Anaheim, Ca 92802"` — the property, not an
owner), real geometry, `casenumber`, `permitissued` + `applicationreceived`, and both vocabularies
enumerate cleanly (**17 `casestatus`**, **57 `typeofwork`**).

**It lifts zero dark pages.** Scoping would be `address LIKE '%{zip}%'` (the pattern the sibling entry
already uses), so it can only reach Anaheim's own ZIPs — and **all seven are already lit**:
92805 187 · 92804 142 · 92806 135 · 92801 123 · 92802 113 · 92807 60 · 92808 24. **None of the 85 dark
Orange County ZIPs is an Anaheim ZIP** — they are Irvine, Santa Ana, Newport Beach, Huntington Beach,
Fullerton, Garden Grove, Mission Viejo. The source would add depth to seven pages that already have
some, at the cost of mapping a 57-value vocabulary that contains a literal string `"NULL"` (5,111
rows), an empty string (649), and near-duplicate typo variants — `Phototvoltaic with Micro-Inverters`
(1,720) beside `Photovoltaic with Micro-Inverters` (508), `Light /  Flag Pole` (double space) beside
`Light / Flag Pole`, and six separate spellings of tenant improvement. Every unmapped value **drops
records silently**, and the status-drift gate that would catch that is in the dead monitor.

**Recorded rather than wired, with the receipts, so the next session neither re-discovers it nor
re-litigates it.** If Anaheim depth is later wanted, this is the entry to add and the vocabulary is
already enumerated above.

> **Standing answer — measure the LIFT before paying the mapping cost.** A source can be fresh,
> first-party, well-formed and complete and still be worth nothing, because every ZIP it covers is
> already lit. Check which *dark* pages a candidate can actually reach **before** enumerating its
> vocabularies, not after.

---

## CLOSING VERIFICATION — all 108 pages re-checked as one set (2026-08-01)

Per-batch checks are not the same as checking the whole set once at the end, so here is the
consolidated audit of every page this session lifted, run against the live cache after the last
deploy and the `adams` revert:

| check | result |
|---|---|
| pages checked | **108** |
| rows missing from `development_reports` | **0** |
| still carrying ≥1 sourced record | **108** |
| gone dark again | **0** |
| sourced records across the set | **39,057** |
| missing `record_url` | **0** |
| `scope:"point"` with no coordinates | **0** |
| unclassified `use_type` | **0** |
| largest page | **3.33 MB** |

The largest page is now **3.33 MB** — under the 3.5 MB working ceiling, and a long way from the
19.65 MB I briefly created and reverted. No page from this session is in the heavy class.

**`verify-development` status.** Run **179** (2026-08-01 14:45Z, scheduled) passed — but it predates
the last three batches (Arlington/Wyandotte/Delaware/Campbell, NOLA/Ramsey/Gwinnett/Lake, Jefferson
CO). I dispatched run **180** (`30721217869`, head `6fd519d`) so the live browser check covers the
complete set. It walks every cached ZIP and historically runs ~3 h, so it was **still in progress when
this entry was written** — recorded as in-flight, not as a pass. Check that run id before treating the
session's pages as browser-verified.

That distinction matters here specifically: the earlier session note about this verifier ("390 lines
over 165 ZIPs… three consecutive ~3 h failures") described a red baseline on `main`, and run 179 shows
it has since recovered. Neither fact tells us anything about the last three batches, which is why 180
was dispatched rather than assumed.

### Date-coverage check on the session's 39,057 records — one source flagged, then cleared

I had verified `record_url`, coordinates and `use_type` across everything wired this session, but never
**dates**. Checking: exactly one source has undated records —
`kenton-county-devtracking-permits`, **40 of 84** on my Campbell pages (48 %).

**It is not something my extension introduced.** The same entry runs **46.5 % undated on its
pre-existing Kenton pages** (118 of 254) versus **47.6 % on the Campbell pages I added** — statistically
identical. The extension reproduced the entry's existing behaviour faithfully.

**And it is not a defect at all.** Two inferences of mine were wrong before I got there:

1. *"`PERMIT_DAT` is populated on 1,602 of 1,634 rows (98 %) at source but only ~52 % in cache —
   therefore the pipeline is losing dates."* **Wrong.** Joining ten undated cached records back to the
   layer on `PIDN` shows `PERMIT_DAT: null` **at source** for all ten. The pipeline is faithful.
2. *"Then undated rows must be concentrated in our envelopes."* **Also wrong, and the real answer is
   the status vocabulary.** `PROJECT_ST` has exactly three values: `Underway` **27**, `Complete` **33**,
   and `" "` — a single space — **1,574**. The entry maps the first two and correctly drops the blank
   fail-closed, so it can only ever surface **60 of 1,634 rows**. Nearly all of the layer's 32 undated
   rows sit inside that usable 60. The county has simply not entered permit dates for about half the
   projects it actively tracks.

So the 98 % figure was computed over a population that is **96 % ineligible**. Rate over the wrong
denominator, twice — the same "a count is a lead, not a fact" failure I have now made in three
different forms today (the comma-less `NV` regex, the page-overlap-confounded concentration metric,
and this).

> **Standing answer — a source-wide fill rate says nothing about the rows an entry actually emits.**
> Compute it over the rows that survive `status_to_bucket` and the filters, not over the layer. Here
> the difference is 98 % versus ~50 %, and only the second number describes what a resident sees.

**No change made.** `kenton-county-devtracking-permits` is small by nature (60 usable rows county-wide)
and behaving exactly as designed. The 84 records on the 7 Campbell pages are correct.

### Registry integrity audit — is the Salem duplicate the only one? Yes (2026-08-01)

I created a duplicate registration this session (`salem-or-structure-permits` on the same
`service_url` as `salem-structure-permits`) and reverted it. The obvious follow-up question is whether
any others exist. Two scans, both clean:

**1. Identical service targets — 0 across 149 entries.** Normalising `service_url` (trailing slash,
case) and falling back to `domain::dataset_id` for the non-ArcGIS platforms: **no two entries point at
the same target.** The Salem case was the only one, it was mine, and it is gone.

**2. Multiple LAYERS of one service — 4 services, and none double-emits.** This is the subtler shape,
and it is the one the registry already has a scar from: `houston-plat-applications` (layer 1) is wired
while layer 0 was rejected as a *proven subset*, because wiring both would have double-emitted ~25,777
plats under two `source_registry_id`s — invisible to exact-identity dedup.

| service | layers wired | distinct case numbers | shared between siblings |
|---|---|---|---|
| Fairfax DevelopmentTracker | 1, 4 | 6,126 | **0** |
| Tucson PermitsCode | 81, 85 | 3,804 | **0** |
| Henderson OpenDevPermits | 1, 2 | 10,216 | **0** |
| Arlington OD_Property | 0, 1, 9 | 14,482 | **15 (0.10 %)** |

**The Arlington 15 are id COLLISIONS, not duplicate records** — checked, not assumed:

```
011506  issued-permits      "Business 380 E FRONT STREET Suite 120"   2025-02-27  operating
011506  permit-applications "New Tenant 918 W DIVISION STREET A"      2026-02-17  proposed
039981  issued-permits      "Single-Family 5511 SARASOTA DRIVE"       2025-05-13  operating
039981  permit-applications "Single-Family 1199 LYNDALE DRIVE"        2026-05-14  proposed
```

Different address, different date, different work. Arlington's three layers run **independent
numbering sequences** that occasionally land on the same short numeric id. And it cannot cause a
mis-collapse regardless: `source_registry_id` is part of the dedup identity, so records from different
entries never dedup against each other.

**Conclusion: no double-emit anywhere in the registry.** A negative result, but the kind worth having
on the record — the Houston case proves this failure mode is real, and it was previously only ever
checked for the one service where somebody happened to notice.

---

## 🔴 SECOND DEAD INSTRUMENT — `verify-geocodes` HAS NOT COMPLETED A RUN SINCE 23 JULY (2026-08-01)

While checking whether the session's 39,057 new records passed the verifiers, I looked past
`verify-development` at the others. `verify-geocodes` is dead, and it has been for **11 consecutive
runs**.

| | |
|---|---|
| last successful run | **#42, 2026-07-23T15:35:13Z** — over 9 days ago |
| consecutive non-success since | **11** |
| in the last 30 runs | 16 success · **11 cancelled** · 3 failure |

**Every cancellation is the 6-hour job cap, to the second:**

```
#53  2026-08-01 14:46:28 → 20:46:52   (6h 00m 24s)  cancelled
#52  2026-07-31 15:47:36 → 21:47:57   (6h 00m 21s)  cancelled
#51  2026-07-30 15:35:01 → 21:35:19   (6h 00m 18s)  cancelled
#49  2026-07-28 15:52:59 → 21:53:23   (6h 00m 24s)  cancelled
#48 · #47 · #46 · #45 · #44 …          all 6h 00m,   cancelled
```

### Why nobody noticed — and why this is worse than the source-monitor
The dead monitor fails in **14 seconds** and shows red. This one **runs for six hours and looks busy**,
then ends in `cancelled`, which reads as benign — somebody stopped it, or a newer run superseded it.
It is the exact failure the site's own rule names: *"a green check that never executed… produces
success-shaped output while attesting to nothing."* Here it is not even green; it is simply never
finishing, and the shape of the failure hides it.

An earlier session recorded one of these cancellations and dismissed it correctly-but-narrowly:
*"`verify-geocodes` was CANCELLED at 6:00:18 — GitHub's hard 6 h job cap, not a failure — and had
nothing to check here regardless."* True of that run in isolation. **It is not one run: it is every
run for nine days.**

**Cost:** ~9 cancelled runs × 6 h = **~54 hours of runner time since 23 July, producing zero
verification.** That is on top of the ~4 h/day the 4-shard Local News matrix already bills.

### What it means for this session's work
The geocode fence (engine v20) is the guard that stops a Census range-interpolation match in another
state from rendering as a marker — the check that caught Fort Worth permits appearing in Michigan and
South Carolina. **It has not run since 23 July.** I measured `0 point-scope records without
coordinates` across my 39,057 records directly against the cache, which is the same invariant from the
data side, so I am not asserting a problem — but the independent instrument that would catch a
geocoding regression is not running, and has not been for the whole period in which this session added
its records.

**NOT FIXED — a code/workflow change is gated.** The likely shape is the same growth-triggered class as
the source-monitor (the cache is now 12,722 report rows / 2.9 M `app_projects` rows, and this verifier
walks all of them with a browser), and the likely remedy is the one the repo already used for
`verify-development`: shard it, or bound it to changed ZIPs, rather than raising a timeout that cannot
be raised past 6 h.

> **Standing answer — `cancelled` is not a neutral outcome, it is an UNFINISHED one.** When triaging
> workflow health, count `success` only. A run that ends `cancelled` at exactly the platform cap has
> told you nothing, burned the full budget, and will do so again tomorrow.

---

## 🔴 SCHEDULED-WORKFLOW HEALTH BOARD — 6 of 11 ARE BROKEN, FOR 5 DIFFERENT REASONS (2026-08-01)

I found `source-monitor` and `verify-geocodes` dead one at a time, by accident, while doing something
else. That is the wrong way to find this, so I swept **every scheduled workflow** instead.

| workflow | last SUCCESS | consecutive non-success | cause |
|---|---|---|---|
| **verify-geocodes** | **2026-07-23** | **11** | cancelled at the **6-hour job cap**, every run |
| **verify-representative-zips** | **2026-07-26** | **7** | `Error: Supabase read 84302: 525` (Cloudflare SSL handshake) |
| **verify-communities** | 2026-07-29 | 3 | `page.goto: Timeout 45000ms exceeded` across many ZIPs, live site |
| **verify-maps** | 2026-07-29 | 3 | assertion `dashboard-no-triangle-marker` (local server, fast fail) |
| **verify-coverage-state** | — | 3 | **not diagnosed** |
| **source-monitor** | 2026-07-30 | 2 | `dev_zip_source_ids` HTTP 500 `57014` statement timeout |
| verify-development | 2026-08-01 | — | recovered; run 180 dispatched, in flight |
| verify-alerts-page | 2026-08-01 | — | healthy (3/3) |
| verify-maps-rest-shapes | 2026-08-01 | — | healthy (3/3) |
| sitemap | 2026-08-01 | — | healthy |
| load-openaddresses | 2026-08-01 | — | healthy |

> ⚠️ **THE TABLE ABOVE IS THE 2026-07-31 SWEEP AND IS SUPERSEDED — see below.** It is kept because
> the per-cause breakdown is still the useful part; its *counts* are stale. An external audit on
> 2026-08-02 measured **7 of 11** red, not 6: `verify-development` went red after this was written.

### Measured state, 2026-08-02 evening — all six repaired

| workflow | was | repair | PR |
|---|---|---|---|
| `verify-geocodes` | 11 runs cancelled at the 6h cap; then a torn-body crash at 1m39s | coordinate dedup (63,216 → 42,222), bounded worker pool, 3.5h script budget + `timeout-minutes: 240`; then the truncated-body guard | #553, #554 |
| `verify-development` | red on `Unterminated string in JSON` | same truncated-body class — **five** unguarded parses, incl. a single-row read of a ~19.6 MB `sites` array | #555 |
| `source-monitor` | `57014` in ~19s, never reached the wire step | RPC page size is one constant **and degrades**: starts 250, halves to a floor of 50 on `57014`, never advances the cursor on failure | #556, #557 |
| `verify-maps` | `dashboard-no-triangle-marker` daily | it asserted a DATA condition (an `industrial` record present in live items). Deterministic claim moved offline (§12c vertex counts); browser check now asserts every pin carries real geometry | #558 |
| `verify-communities` | nav timeouts, 30s **and** 45s | `networkidle` is unreachable with 8 concurrent tabs on a Supabase-backed page, and redundant — `#commPage` content is the real readiness signal | #559 |
| `verify-representative-zips` | `cached development 3658 > 0` | **stale fixture**: 85004 was the facilities-only exemplar before `phoenix-building-permits` was wired. Moved to 58102 Fargo ND; 85004 retained as a dev-backed metro | #559 |
| `verify-coverage-state` | 5 ZIPs `temporarily_unavailable` | **the verifier was right, its expectation was wrong** — that state is designed and bounded to 7 days by `dev_refresh_collect`. Now fails only on a hold that outlives its window | #559 |

**Correction to a finding recorded earlier in this file:** the refresh guard was logged as unable to
"distinguish a dead source from an honest zero". The observation is true; calling it a defect was
not. `dev_refresh_collect`'s refusal is explicitly bounded by
`d.refreshed_at >= now() - interval '7 days'` and its own comment states that beyond that the flake
theory is exhausted and the clean 200 is the truth. It is a deliberate, self-releasing trade-off.

### The important part is that these are NOT one problem
My first hypothesis — that the verification suite had simply outgrown its budget as the site reached
12,722 pages — is **wrong**, and I checked rather than shipping it. The causes are genuinely different:
a platform job cap, a TLS/transport error, live-site page timeouts, a UI assertion, and a database
statement timeout. One of them (`verify-maps`) fails in seconds against a **local** server, so it has
nothing to do with scale at all.

That matters for how to approach it: there is no single fix, and treating it as one would produce a
plausible, wrong repair.

### Why six independent breakages accumulated unnoticed
Each one is individually easy to miss, and each fails in a *differently misleading* way:

- `verify-geocodes` burns 6 h and ends **`cancelled`**, which reads as benign.
- `source-monitor` dies in **14 s** in a pre-step, so the job it exists to run never starts.
- `verify-representative-zips` fails on a **transport error** that looks transient — and would be, if
  it were not the seventh in a row.
- `verify-maps` fails on a **real assertion**, which is the only one behaving as designed.

**Nothing aggregates this view.** The repo has eleven scheduled jobs and no place that says which of
them last actually succeeded — so the answer to "is the site verified?" has been *unknowable without
this sweep*, and has been "largely no" since **23 July**.

> **Standing answer —audit the SUITE, not the run.** A per-workflow red/green glance cannot distinguish
> "failed once" from "has not succeeded in nine days", and cannot see that six independent instruments
> are down at once. Track **last-success date** per scheduled workflow; a job whose last success is
> older than its own interval is down, whatever its most recent run says.

**NOT FIXED — every one of these is a code or workflow change, and they are five separate repairs.**
Recorded with dates, counts and the exact error per workflow so each can be picked up individually.
`verify-coverage-state` is the one I did not diagnose; its three failures are real but I did not pull
its logs.

### `verify-coverage-state` diagnosed — and the Saint Paul thread closes itself

I left this one undiagnosed in the health board above. Closing that gap. It fails **2 checks of ~40**:

```
FAIL legacy: populated/facilities_only => pass
FAIL coverage-pass: zero FAILED materializations
  [20769:temporarily_unavailable, 23451:temporarily_unavailable,
   55103:temporarily_unavailable, 55104:temporarily_unavailable, 55105:temporarily_unavailable]
```

**Three of the five are the Saint Paul pages** from the stale-source finding earlier in this session —
the ones frozen at 20,000 records from `saint-paul-approved-building-permits`, an entry the founder
**retired on 2026-07-28**. So those rows were not merely untidy: they have been **failing a verifier**
for days, which is why `verify-coverage-state` has been red.

### Two of the three have already healed — and my own work is what unstuck them

I predicted these would self-heal around **5 August**, when the transient-safe guard's 7-day window
expired. Two healed **on 1 August instead**, and the mechanism is worth stating precisely:

| ZIP | refreshed_at | records | source |
|---|---|---|---|
| 55104 | **2026-08-01 17:00Z** | 272 | **`minneapolis-ccs-permits`** — 0 from saint-paul |
| 55105 | **2026-08-01 17:15Z** | 510 | **`minneapolis-ccs-permits`** — 0 from saint-paul |
| 55103 | 2026-07-29 04:15Z | 20,000 | still `saint-paul-approved-building-permits` |

`dev_refresh_collect`'s guard refuses a response only when the **new** development count is **0**. While
Ramsey had no live source, every nightly response for those ZIPs was 0 and was rejected — the rows
could not heal. **The `minneapolis-ccs-permits` → MN Ramsey extension I wired earlier today gave those
pages real content**, so the next nightly response was 272 and 510 rather than 0, the guard let the
write through, and the retired source's stale rows were replaced.

That was not the reason I wired Ramsey — I wired it for 3 dark pages (55116, 55108, 55112). Unblocking
two frozen Saint Paul pages was an unintended and unforeseen consequence, and I am recording it as
such rather than claiming I planned it.

**55103 remains stuck**, because Minneapolis reaches 55104/55105 but not 55103 — so its nightly
response is still 0 and the guard still refuses it. It should heal on its own around **5 August** when
the 7-day window lapses. That is now a *testable prediction with a date*: if 55103 is still at 20,000
after 5 August, the guard analysis is wrong and needs revisiting.

**The other two failures are unrelated to this session:** 20769 (last refreshed 2026-07-28, 1 record)
and 23451 (refreshed today, 2,552 records) are also in `temporarily_unavailable`. Not diagnosed —
23451 in particular has plenty of content, so its state looks stale rather than earned.

### 20769 diagnosed, 23451 self-resolved — the guard cannot tell a dead source from an honest zero

Closing the gap I flagged one section above ("Not diagnosed"). Both are now settled, and one of my
two guesses there was wrong.

**23451 (Virginia Beach) — my guess was wrong, and it resolved without intervention.** I wrote that
its state "looks stale rather than earned." It is now `populated`:

```
23451 | coverage_state=populated | refreshed_at=2026-08-01 19:45Z | dev_markers=2405
```

It was mid-cycle, not stuck. Nothing was done to it. Recording the correction rather than leaving the
speculation standing.

**20769 (Glenn Dale MD) — the same guard as 55103, a completely different cause.** The cached row:

```
zip=20769  refreshed_at=2026-07-28 20:45:00Z  sites=10  sourced=1
counts={"development":1,"facilities":9}
```

Its one sourced record, quoted whole:

```
rid=prince-georges-county-permits  scope=area  bucket=operating  file_date=2025-07-29
title="POF FAIRWAYS GLENN DALE MD LP SFD POF  - K. Hovnanian- ALASK"
```

and that entry in `jurisdiction-registry.json` on `origin/main`:

```
"registry_id": "prince-georges-county-permits",
"recency_days": 365,
"column_map": { "file_date": "permit_issuance_date", ... }
```

`2025-07-29 + 365d = 2026-07-29`. **The record left the source's own recency window the day after the
last successful cache write.** From that day on the engine has honestly returned nothing —
receipt, straight from `net._http_response`:

```
id=1761  created=2026-08-02 00:15:02Z  status=200
counts={"development":0,"facilities":9}
```

The guard in `dev_refresh_collect()` refuses that write (cached `development`=1 > 0, new = 0,
`refreshed_at` inside 7 days) and does not bump `refreshed_at` — which is exactly what
`app_coverage_states` shows: `last_refresh_attempt_at=2026-08-02 00:15` newer than
`refreshed_at=2026-07-28 20:45`. The attempt is made nightly and rejected nightly.

Note `dev_markers` was **already 0** before any of this: the record is `scope: "area"`, so it never
rendered as a map marker. Only the counts carried it.

**And the 55103 claim I had been inferring now has its own receipt** — three consecutive live
responses, all 200, all zero:

```
id=254   2026-08-01 22:45:03Z  {"development":0,"facilities":40}
id=1263  2026-08-01 23:45:03Z  {"development":0,"facilities":40}
id=1763  2026-08-02 00:15:02Z  {"development":0,"facilities":40}
```

#### The generalization, which is the part worth keeping

`dev_refresh_collect`'s transient-safe guard exists to stop a flaky FRS night from blanking a good
page. It decides on one signal — *new development count is 0 while the cached one is not* — and that
signal **cannot distinguish a flake from a legitimate transition to zero**. Two entirely independent
causes produced byte-identical behaviour this week:

| ZIP | why the source now returns 0 | guard releases |
|---|---|---|
| 55103 | entry `saint-paul-approved-building-permits` **retired** 2026-07-28 | ~2026-08-05 04:15Z |
| 20769 | its only record **aged out** of `recency_days: 365` on 2026-07-29 | ~2026-08-04 20:45Z |

So whenever a source is retired, or a page's last record ages out, that page keeps displaying the
stale content for **exactly 7 days** and `verify-coverage-state` reports `temporarily_unavailable`
for the whole window. The verifier going red there is *expected behaviour*, not a new defect — which
is worth knowing before someone "fixes" the verifier.

**Two falsifiable predictions with dates.** 20769 should drop to facilities-only (9 EPA facilities,
0 development) after **2026-08-04 20:45Z**; 55103 should drop off its 20,000 stale records after
**2026-08-05 04:15Z**. If either is still showing its stale content on 6 August, this analysis is
wrong and the guard needs re-reading.

**Not fixed — teaching the guard the difference is a code change (gated).** The shape a fix would
take, so it isn't re-derived: the guard would need a second signal that separates "the source
answered and had nothing" from "the source did not answer" — the engine already knows which, but the
count it hands the collector does not carry it.

**Still in flight:** `verify-development` run `30721217869` is at 2 h 20 m as of 2026-08-02 00:42Z,
step "Verify development pages" still running. Not a pass. If it reaches 6 h it joins the broken list.

### Coverage-extension pass #2 — 22 more pages lit, and the ranking now regenerates itself

The first pass changed its own input: 108 newly-lit pages put new centroids into the `lit` set, so
adjacency seams exist now that did not exist when the ranking was first computed. Re-ran it.

**Method fix that made this worth doing:** the `cov` table is now **generated from
`jurisdiction-registry.json`** instead of a hand-typed `VALUES` list. The literal was a snapshot that
went stale the moment an extension merged — regenerating it surfaced ~12 (source, county) pairs the
first pass had never probed.

**Wired 7, rejected 7.** Full table, receipts and the gate proof: `docs/source-registry.md`
→ "COVERAGE-EXTENSION PASS #2 (2026-08-02)". Headline: **22 pages, 4,224 records**, largest page
1.18 MB, and across all 170,539 records these seven sources place cache-wide, **0 missing
`record_url`, 0 point-scope without coordinates, 0 unclassified**.

Every rejection carries a control that returned non-zero **in the same batch as the zeros**, so no
zero in this pass came from a broken query shape.

⚠️ **One rejection is uncomfortable and should stay that way.** `pierce-county-pals-permits` →
WA Thurston: ZIP 98348 alone returns **2,181** in-envelope records — by volume the second-largest
opportunity in the batch — and it is rejected because 1-of-6 ZIPs non-zero is the same shape as the
already-rejected `pierce → King`. Applying a rule only when the number is small is not applying a
rule. If that bar should change, change it deliberately and re-probe both together.

**Measured, not predicted:** envelope counts totalled 4,635; the stored result is **4,224**. The gap
sits where status/type mapping drops rows (29492: envelope 10 → stored 5). That is the expected
direction, and it is why the wiring commit said upfront that these counts size a candidate set.

Deployed via `deploy-edge-functions.yml` run `30726436927` (success), then 22 ZIPs re-cached through
the live engine via `pg_net` + `dev_refresh_collect()`.

### The pass-#1 report was understated by 10 pages / 9,668 records — and the reason generalizes

Swept the counties pass #2 touched and found three Gwinnett pages lighting up from
`dekalb-county-building-permits` — a **pass #1** extension. Those pages had never been re-cached after
pass #1's deploy, so that pass's report was written against a cache predating its own change.

Measured: **96 dark ZIPs in pass #1's target counties had `refreshed_at` earlier than its deploy**
(`2026-08-01 18:18`). Re-firing all 96 lit **10 more pages / 9,668 records**. Two entries change
character completely — `chicago → IN Lake` from **1 record** to 20 (2 pages), and
`aurora → CO Douglas` from 342 to **2,649** (2 pages). The two that looked least worth having were the
two most understated.

**Standing answer, now in `docs/source-registry.md`:** deploying is not the last step, and re-caching
the *probed* ZIPs is not either. Re-cache **every still-dark ZIP in the target county whose
`refreshed_at` predates the deploy**, then measure. This cuts one way only — it understates yield, and
it can never affect a rejection, since rejections are probed live against the endpoint rather than read
from cache.

Pass #2 final, fully measured: **25 pages, 4,296 records** (was 22 / 4,224 before its own sweep).
Consolidated invariants across all 817,346 records the 21 touched sources place over 675 pages:
**0 missing `record_url`, 0 point-scope without coordinates, 0 unclassified.**

### And the narrower version of that rule, measured: staleness alone hides nothing

The finding above could be misread as "every stale dark page is hiding records" — which would imply a
1,762-page sweep. Tested instead of assumed.

**Sample: 200 dark pages in counties NEITHER pass touched**, all with `refreshed_at` older than the
pass-#1 deploy — stale identically, but coverage never changed. **193 of 200 rewritten, 0 lit up**,
against **10 of 96** and **6 of 97** for the same method on counties whose coverage did change.

So the re-cache obligation attaches to a **coverage change**, not to cache age. The remaining ~544
stale dark pages in untouched counties are not hiding anything, and nobody needs to sweep them.

⚠️ **The first attempt at this measurement returned a false clean** — filtered on
`refreshed_at > 01:50` while the clock read **01:44**, a threshold in the future. It returned exactly
the `0 lit_up` the hypothesis predicted. Caught only by pairing the zero with a control
(`max(refreshed_at)` + a row count in the same window) before believing it. **A zero that agrees with
your hypothesis is the most dangerous zero there is.**

### Native-ZIP pass — 11 pages / 1,503 records, and a self-inflicted wrong number

Third seam, different method: 57 entries scope by **native ZIP**, so the layer itself can name the
ZIPs it holds. Queried `returnDistinctValues` on all 31 ArcGIS native-ZIP entries. Wired 6 pairs
across 4 entries (columbus → OH Delaware 4/1,095 · nashville → TN Williamson 3/157, Wilson 1/54,
Rutherford 1/12 · spokane → WA Stevens 1/141 · coconino → AZ Yavapai 1/44). Full receipts:
`docs/source-registry.md` → "NATIVE-ZIP PASS (2026-08-02)".

**The rejections are the real finding.** A distinct ZIP value is a LEAD, not coverage — these layers
carry a few rows with an out-of-jurisdiction ZIP (Tempe AZ with a **California** ZIP, 1 record;
Detroit → Oakland 3; Louisville → Oldham 8; Tacoma → King 9). Those are owner mailing addresses or
typos, not buildings, and wiring them is the `las-vegas-building-permits` defect class.

⚠️ **I predicted coconino → AZ Yavapai at 1,492 records / 2 pages; it delivered 44 / 1.** Two
hypotheses were falsified before the real cause turned up: it is not a `ZIP_RADIUS_MI` clip (stored
records span 15.21 mi from the centroid) and not `LIKE` vs `=` (exact equality also returns 1,487).
**The cause is that I probed outside the connector's scope while stating I was inside it** — the entry
has `recency_days: 365` and a substantial `extra_where`, and I recorded "no recency in entry", which
was wrong. In-scope 86336 holds **146** rows.

**That 146 was already in the entry's own `_receipts`, written by the previous pass one day earlier.**
Re-derived wrongly instead of read. Standing answer added: **read an entry's `_receipts` before
probing that entry.**

Also logged: the first re-cache hit **6 × 503 BOOT_ERROR** + 1 timeout of 72 fires, four minutes after
a deploy. Those pages looked dark but were pending (`last_refresh_attempt_at` advanced,
`refreshed_at` did not). Re-firing recovered them. Check fire/collect counts before calling a page dark.

### `verify-development` PASSED — 4 h 10 m, and the margin is the thing to watch

Run `30721217869` (dispatched 2026-08-01 22:25Z) completed **success** at 2026-08-02 02:35:16Z.
I had flagged it as "in-flight, not a pass" and said it would join the broken-workflow list if it
reached GitHub's 6-hour job cap. It did not — so the health board stays at **6 of 11 broken**, and
`verify-development` is **not** one of them.

But 4 h 10 m against a 6 h hard cap is a **70% margin consumed**, and the run walks every cached
`development_reports` row in a real browser — so its duration grows with the cache, which this session
alone grew by ~150 newly-lit pages across three passes. `verify-geocodes` already dies at exactly 6 h
(11 consecutive cancellations). This is the same wall, and `verify-development` is now visibly on
approach to it.

Not fixed — sharding or budgeting that job is a workflow change (gated). Logged with the number so the
next session can see the trend rather than rediscover the cliff.

### Native-ZIP pass, second half — 5 more pages / 1,796 records

Retried the ten ArcGIS entries that could not answer `returnDistinctValues` using **groupBy
statistics**; 8 answered. Wired `little-rock-permits` → AR Saline (2 pages / 1,782) and
`baltimore-county-permits` → MD Harford (1 / 8) + MD Howard (2 / 6). Rejected `gilbert` → AZ Yavapai
(2 rows, ~80 mi away). Receipts: `docs/source-registry.md` → "Native-ZIP pass, second half".

**A size oracle that works, worth reusing.** Little Rock has no `recency_days`, so 10,601 lifetime rows
on one page looked like the ~19 MB page reverted in pass #1. Measured the ratio on that source's own
cached pages instead of guessing — 72223 stores 6,033 of 45,585 and weighs 5.13 MB, so 13% survive at
0.87 KB each → predicted ~1,730 records / ~1.1 MB. Actual: **1,782 / 0.78 MB**. A raw row count is a
terrible size oracle; an existing page of the same source is a good one.

⚠️ **And a wrong extraction that manufactured a plausible claim.** The first parse reported
`little-rock-permits` → **NY Westchester**. Baltimore County aliases its count column `N` and Little
Rock `n`, so a case-sensitive lookup missed it; the fallback took the first 5-digit-looking attribute
and read Little Rock's **count of 10601** as a ZIP, which matched a real Westchester page. Nothing
looked malformed — it was caught only because Little Rock permits in Westchester NY is absurd.
**Key extraction on the column name, case-insensitively, never on value shape.** A count and a ZIP are
both five digits.

### Socrata half of the native-ZIP pass — 1 wire, 2 declines, 1 modelling defect

`$group` on the ZIP column across the 15 Socrata native-ZIP entries, each in its own recency window.
14 answered; `nyc-dob-permit-issuance` returned 0 against a **guessed** date column, so it is recorded
as unprobed rather than empty.

**Wired:** `nyc-dobnow-approved-permits` → **NY Nassau**, 2 pages / 130 in-scope records (11001=93,
11040=37) — both ZIPs straddle the Queens/Nassau line.

⚠️ **Declined `nyc-dobnow` → NY Westchester, and the reason is a modelling defect we should fix.**
ZIP **10470 (Woodlawn) is a BRONX ZIP parented to Westchester** in `communities` — this repo already
records that it was excluded from the borough expansion "already live under Westchester via the Census
crosswalk". It holds **79 in-scope NYC DOB permits** that cannot reach it, because the coverage gate is
county-granular: licensing Westchester would also light **10803 Pelham Manor (8 records)**, where NYC
DOB has no jurisdiction and the rows are artifacts.

**Recommended fix: re-parent 10470 to Bronx** — then the existing borough coverage lights it with no
registry change. That is a `communities` change affecting what residents see → **gated, not done.**

✅ **DONE 2026-08-02 (founder-authorised objective 3).** Migration `reparent_10470_woodlawn_to_bronx`;
SQL of record `docs/10470-bronx-reparent.sql`. Authority is the repo's own pinned source, `zipcodes`
PyPI v3.0.0 — `10470 -> Bronx County, NY, STANDARD` — with a control from the same read
(`10803 -> Westchester County`) proving it is one row and not a disagreement with the package. The row
already *called* itself Bronx (name "Bronx (10470)", slug `bronx-10470`); only `county` and `parent_id`
said otherwise.

Every hazard the per-ZIP model names was measured, not assumed: **0 subscribers** on either chain root
(so no subscriber is switched between communities), and Bronx and Westchester carry the **identical 6
canonical topics** (so the subscribable set does not change). Cascaded civic content does change, and
that is the correction: Westchester County's 29 meetings have no jurisdiction over a Bronx address and
stop rendering; Bronx County's 9 alerts start.

Live result — **10470 goes from the facilities floor to 102 development records + 20 facilities**,
0 missing coordinates, 0 missing `source_ref`, `coverage_state` populated, indexable true. Sourced to
**both** NYC DOB entries: the queue predicted 79 from `nyc-dobnow` alone, and
`nyc-dob-permit-issuance` now contributes too because its text-date defect was fixed earlier the same
day. Westchester's array 75 → 74, 0 duplicate slugs, `'10470'` resolves in exactly one community.

Declined `marin-county-building-permits` → CA Sonoma: 94952 Petaluma returns 8 in-scope records
(control 94901 = 19); Marin has no jurisdiction in Petaluma.

**Go-live for the Nassau wire:** 11001 = **65** records, 11040 = **37** → **2 pages / 102 records**,
0.07 MB max. Predicted 130 from a `$where` that carried the entry's `work_type` whitelist but not its
status bucketing; 11040 matched exactly (37) and 11001 came in at 65 rather than 93, the difference
being statuses that fail closed. Invariants across all 62,388 records this entry places over 213 pages:
**0 missing `record_url`, 0 point-scope without coordinates, 0 unclassified.**

⚠️ **Operational note: do not fire a whole county when the target is two pages.** The first attempt
enqueued all 70 dark Nassau pages in one statement and the SQL connection timed out mid-flight, leaving
it ambiguous whether any fires were issued. Firing the two target ZIPs directly succeeded immediately.
Scope the fire to the pages the change can actually affect.

### CKAN / Carto / ODS half — Philly boundary ZIPs live, and a zero-record NYC entry found

**Wired and live: `philadelphia-li-permits` → PA Montgomery + PA Delaware — 3 pages / 396 records**
(19128 = 197, 19118 = 120, 19153 = 79; max page 0.19 MB). Predicted 397 from the entry's own scope, so
this one landed within a single record. Invariants across all 10,993 records this entry places over 48
pages: 0 missing `record_url`, 0 point-scope without coordinates, 0 unclassified.

These are the ZIPs the Philadelphia County expansion deliberately left under Montgomery/Delaware
("Census crosswalk, most-specific wins"). Safe to wire because it was **measured**: of every ZIP in
Montgomery, Delaware, Bucks and Chester, exactly three appear in Philadelphia's L&I data and all three
are Philadelphia neighbourhoods — no Pelham-Manor-equivalent to license by accident. That is precisely
what makes it different from the 10470/Westchester case declined earlier today.

🔴 **`nyc-dob-permit-issuance` has NEVER placed a record.** Wired across five boroughs, documented as
live, 0 records cache-wide. Its `issuance_date` is text in MM/DD/YYYY while the connector emits an ISO
literal, so the comparison is lexicographic and can never match. ZIP 11214: control 23,761 rows →
0 with the connector's exact clause. Corrects the NY wire pass's "66,006 records" claim — all of it is
DOB NOW. **Audited: 1 of 19 Socrata recency entries, not a class.**
✅ **FIXED 2026-08-02 (founder-authorised, #552)** — additive `recency_expr` on the socrata
connector, cutoff substituted at request time so the window keeps rolling. Verified live: engine
run report for 11214 `fetched 92, emitted 92, 0 quarantined`; 43 of 51 re-cached borough pages now
carry records. Options considered and rejected, with receipts, in `docs/source-registry.md`.

**Native-ZIP seam is now closed** except `bellevue-permits`, whose server ignores both
`returnDistinctValues` and groupBy.

---

## `verify-coverage-state`: the last failing assertion was a real overstatement on 5,734 pages

`legacy: populated/facilities_only => pass` was the one check still red after #559. It was right, and
this time the **view** was the half that was wrong — not the expectation.

**What the check compares.** Two independent definitions of "this ZIP has coverage":
`app_community_meta.data_quality` (stamped by `app_refresh_zip`) and `app_coverage_states.coverage_state`
(computed live). At the Phase-2 rollout they were verified IDENTICAL — `legacy1 = legacy2 = 0` in
`docs/coverage-state-model.sql`.

**What drifted.** They could agree because `app_changes` then held only civic rows — `'Government & civic'`
+ `'Planning & zoning'`, exactly the set `app_refresh_zip` counts into `_nc`. Local News later began
materializing into the **same table** (79,424 rows across 9,796 ZIPs), and the view counted that table
with **no category filter**. So it started reading news as coverage. The materializer never moved: it
counts `_nc` *before* the Local News insert, so `data_quality` has always been civic-only by construction.
That asymmetry is the whole failure.

**Measured cost (2026-08-02, full population 12,722):**

| class | ZIPs | reported | actual |
|---|---|---|---|
| EPA facility floor + news, no development, no civic notices | **5,072** | `populated` | `facilities_only` |
| news and nothing else — zero markers of any kind | **662** | `populated` | `honestly_empty` |

**5,734 pages carrying an overstated coverage state.** The 5,072 were also denied the accurate
`facilities_only` banner on `community.html` ("Local government meeting and permit feeds for this area
are still being wired — the EPA-registered facility records below are live public data"), which is the
one piece of copy that tells those residents the truth about what they are looking at. The 662 are the
ones that made CI red daily.

**The rule, now explicit and pinned.** Coverage means sourced **civic/development** records — permits,
planning + government notices, EPA-registered facilities. A Local News article is real, sourced content,
still rides the page's news list, and can never lift a ZIP's coverage state on its own. `changes` counts
civic rows only; `news_items` is reported **additively** so the news is visible in the instrument rather
than hidden behind the narrower count.

**Applied** — migration `app_coverage_state_view_civic_changes`; SQL of record updated in
`docs/coverage-state-model.sql` with the correction and its receipts. **Verified live against the full
population:** total 12,722 = meta 12,722, and all eight invariants 0 — `imp1..imp4 = 0`,
**`legacy1 = 0`, `legacy2 = 0`**. New distribution: populated 5,020 · facilities_only 6,769 ·
honestly_empty 924 (was populated 10,754 · facilities_only 1,697 · honestly_empty 262).

**Nothing rendered changed and no layout gate moved** — layout is keyed on `data_quality`, which was not
touched. What changed is state *copy*: 5,072 pages gain the accurate facilities-only banner, and 662
pages' coverage-coming block switches to the honest-empty paragraph, which is true of them (government
registries, permit feeds and the EPA registry all returned 0). Indexability is unaffected — it requires
`_ndp > 0 or _nfc >= 3`, which news never satisfied.

Pinned by `test/coverage-state-news-not-coverage.test.mjs` (14 assertions, including a self-test that
feeds the classifier the pre-fix unfiltered count and requires the WRONG verdict, so a green run proves
the narrowing is doing something) and by a new live assertion in `scripts/verify-coverage-state.mjs`:
a ZIP with news and no other content must be `honestly_empty`.

---

## Objective 3, item 4 — the refresh guard: it is not neutral, and the 7-day clock is the wrong release condition

The item as filed was "the guard cannot distinguish a dead source from an honest zero." That is true, and
the interesting half is what the ambiguity *costs*, which is not what the earlier note assumed.

**The guard.** `dev_refresh_collect()` refuses a response when `cached refreshed_at >= now() - 7 days
AND new facilities = 0 AND new development = 0 AND cached facilities + development > 0`. A refusal does
not bump `refreshed_at`, so the window runs from the last GOOD write and the hold self-releases.

**All 9 currently-held pages have exactly ONE source, and in every case the hold is on that sole source**
(measured 2026-08-02). Three distinct situations, and the clock is right for only one of them:

| pages | sole source | held | what the zero actually is |
|---|---|---|---|
| 55103 · 55109 · 55119 | `saint-paul-approved-building-permits` | 4.0–4.7 d | **true by construction** — the entry was RETIRED from the registry on 2026-07-28 |
| 94024 · 94040 · 94041 · 95033 · 95046 | `san-jose-permits` | 5.1 d | **true** — see the receipt below |
| 20769 | `prince-georges-county-permits` | 5.1 d | not a refusal at all — see below |

**Correcting the earlier "self-healing is benign" reading.** For a page whose zero is TRUE, the hold is
not neutral: it *prolongs the serving of records the source no longer supports*. Probed 94024 in the
connector's OWN scope (Rule 13 — its 3-mi envelope around the ZIP centroid, its 365-day window):
**1 `san-jose-permits` record all-time inside that envelope, 0 inside the window.** The page was caching
**482**. The hold was protecting an artifact, and the clock expiring in ~2 days would have been the thing
that finally corrected it.

**And 20769 was never being refused.** Its fresh response carries `facilities = 9`, so the guard's
condition cannot fire; the page was simply never *collected* — the response has to land inside
`dev_refresh_collect`'s 20-minute window, and a fire/collect miss leaves `refreshed_at` frozen while
`last_refresh_attempt_at` advances, which is exactly the shape the view reads as
`temporarily_unavailable`. **A held page is therefore not evidence of a refusal.**

**Both sources are ALIVE** — probed in each connector's own scope: `san-jose-permits` 11,160 rows in its
365-day window (17,520 all-time); `prince-georges-county-permits` 347 rows with its verbatim
`extra_where`, 461,508 all-time, max `permit_issuance_date` 2026-07-24. So "dead source" was not the
explanation for any of the nine.

**Released 2 pages against receipts rather than waiting out the clock** — 94024 (corroborated zero:
482 cached → 0, facilities 4) and 20769 (facilities 9, never a refusal). Both `quality=pass`.

### Recommendation — the release condition should be CORROBORATION, not elapsed time
No code change made, and deliberately so: `dev_refresh_collect` is SQL and cannot probe a publisher, so
"is this zero true?" is not answerable where the decision is currently taken. The two changes worth
making, in order of value:

1. **Retiring a registry entry should re-cache the pages that depended on it, in the same change.** A
   retired entry's zero is true *by construction* — there is nothing to protect — yet the three Saint
   Paul pages have each served ~20,000 stale records for five days because nobody told the cache. This
   is an operational rule, not machinery. *(It did not bite the `las-vegas-building-permits` retirement
   in this same session: all 51 of its pages keep content from other sources, so their `development`
   never goes to 0 and the guard never engages.)*
2. **A hold should carry its evidence.** `verify-coverage-state` now reports every in-window hold as INFO
   and fails only on one that outlives its window, so the state is visible; the missing half is the
   one-line probe — the source, in the connector's own scope — that says whether the zero is true. When
   it is, release the page immediately, as was done here for 94024.

**Do not read a hold as "the source died."** Of nine held pages, zero had a dead source: three had a
retired entry, five had a genuinely-empty scope, and one was never being refused at all.

---

## Objective 2, the requested report — what it would take to BOUND `verify-development`

**Measured, not projected.** Last five completed full runs: **4.17 h · 3.56 h · 4.83 h · 3.71 h ·
3.90 h** against the workflow's 6 h cap (two other "completed" runs at 0.06 h / 0.09 h are the
`res.json()` deaths fixed earlier today, not full walks). Headroom on the worst of those five is
**1.17 h — 20 %.**

**What consumes it.** The job walks **every cached `development_reports` row — 12,722 today** — through
**ONE Playwright page, strictly serially**: `const page = await browser.newPage()` followed by
`for (const rep of reports)`, one `page.goto(…, { waitUntil: 'networkidle', timeout: 30000 })` per ZIP.
At 4.83 h / 12,722 that is **~1.37 s per ZIP**, essentially all of it page load. There is **no
concurrency and no time budget** — the two things `verify-geocodes` and `verify-communities` both have.

**Why it is the next failure waiting to happen, precisely.** Runtime is linear in cached ZIPs, and
cached ZIPs only grow. At the observed worst rate the cap is reached at **~15,700 ZIPs** — about
**3,000 more pages**, which one state's build adds. And the failure mode is the bad one: a run cancelled
at the cap **uploads no report**, so it presents as a missing result rather than a partial one — exactly
how `verify-geocodes` hid 11 consecutive dead runs.

### What it would take — three options, cheapest first

1. **A bounded worker pool (recommended).** The same change already made to `verify-geocodes`:
   N pages instead of one, a shared cursor, `CONCURRENCY` env-tunable. At N=4 the worst run lands near
   **~1.2 h**, i.e. 5× headroom, and the cap moves out past 60,000 ZIPs. ⚠️ **One real hazard, learned
   the hard way this week: `waitUntil: 'networkidle'` is fragile under concurrent tabs** — parallel page
   loads keep the network busy and the condition stops settling. `verify-communities` was moved to
   `domcontentloaded` + an explicit `waitForFunction` on the rendered root for exactly this reason, and
   it then walked all 12,722 pages cleanly. Do that here **before** raising concurrency, not after.
2. **An explicit time budget with an honest partial report** (`TIME_BUDGET_MS`, as added to
   `verify-geocodes`). This does not make the job faster; it converts "cancelled, no artifact" into
   "checked 9,000 of 12,722, here is the report, here is what was skipped." Worth doing **regardless of
   option 1**, because it removes the silent-truncation class permanently. Pairs with the repo's own
   no-silent-caps rule: log what was dropped.
3. **Stop walking every ZIP every day.** Rotate: all indexable pages weekly, plus everything changed
   since the last run daily (`refreshed_at > last_run`). Biggest saving, most behaviour change, and it
   weakens the daily anti-fabrication guarantee — so it is the last resort, not the first move.

**Recommendation: 2 then 1** — make truncation impossible to hide first (small, no behavioural risk),
then buy the headroom. Not implemented in this session: raising concurrency without first re-measuring
the `networkidle` change is how the 2026-07-24→28 red streak started, and this job is the
anti-fabrication gate.

### Measured while verifying the above: ~30 % of every rolling-refresh tick fails with HTTP 503

This is the missing rate behind "a held page is not evidence of a refusal", and it is **pre-existing,
not deploy fallout** — the `get-address-report` deploy ran 22:20:46–22:21:09 UTC and the pattern is
identical on both sides of it:

| tick (UTC) | 200 | **503** | timeouts |
|---|---|---|---|
| 22:00 (before the deploy) | 136 | **57** | 7 |
| 22:15 (after the deploy)  | 126 | **71** | 3 |

`dev_refresh_tick()` runs every 15 minutes and `dev_refresh_fire_batch(250, 20)` fires **250
`net.http_post` calls in one statement**. The edge function will not take 250 at once, so roughly a
third boot-fail. A 503 carries no JSON, so `dev_refresh_collect` writes nothing for those ZIPs — but the
claim step has already bumped `last_refresh_attempt_at`. That is **exactly** the shape the coverage-state
view reads as `temporarily_unavailable`: attempt newer than `refreshed_at`, attempt inside 48 h. It is
how 20769 sat "held" for 5 days without the guard ever refusing it.

**Self-correcting, so not changed.** A 503'd ZIP does not advance `refreshed_at`, and the batch is
ordered `refreshed_at asc nulls first`, so it goes to the FRONT of the next tick. Throughput confirms it:
**8,620 of 12,722 rows refreshed in the last 13 hours**, i.e. a full pass in well under a day.
**Do not "fix" this by lowering `_batch`** — 250/tick is what buys that pass time; at 60/tick a full
pass would take ~2 days, which is worse than a retry. The right fix, if one is wanted, is staggering the
fires within a tick, not shrinking it.

**Full-pass time, for the record:** the refresh is a **15-minute rolling job, not nightly** — 250 ZIPs
per tick, oldest-first, ~13–20 h for all 12,722. The oldest row in the table sits at 123.7 h, and those
are the held pages, whose `refreshed_at` deliberately does not advance.

### ⚠️ The verify-communities race guard is GREEN but UNPROVEN — it has never fired

Run 30769638076 on the merged head: **12,722 pages checked, Failed: 0**, and the new counter reads
**"Rows re-read after a mid-walk materializer change: 0"**.

That zero is the honest reading of the run, and it means the guard **did not run**, not that it works.
The three Portland failures it was written for did not recur, so the pass proves only that no race
occurred this time. By this repo's own rule — *an instrument must prove it ran before its silence counts
as evidence* — the guard is currently a latent instrument with no test behind it: there is no unit
coverage for the re-read path either, because the mismatch branch needs a live REST round-trip.

**Follow-up, logged not done:** give `assertZip`-style purity to the substance-gate comparison so the
re-read branch can be driven offline with a stubbed `rest()`, and assert both outcomes (flag changed →
re-check and pass; flag unchanged → still fail). Until then, treat a green
`verify-communities` as evidence about the PAGES, not about the guard.

### 27 of 31 workflows had NO timeout — every one inheriting GitHub's 6-hour default

Found while chasing a hung `unit` job on this branch. Only 4 workflows carried `timeout-minutes`
(`unit-tests`, `verify-geocodes`, `gate2b-full-inventory-parity`, `load-openaddresses`); the other
**27 were unbounded**, which is precisely the shape that let `verify-geocodes` burn **11 consecutive
6-hour cancellations** on an account previously halted at $0. An unbounded job does not fail — it bills.

**The hang that surfaced it is real and reproducible-ish:** three consecutive `unit` attempts on the
same commit hung, twice in `Install playwright` (a network browser download) and once in the suite step,
while a **SIBLING run on the identical commit passed**. Locally the full 75-file suite runs in 33 s and
the two browser-backed suites each exit 0 alone. Same code, same minute, one hung and one passed — that
is runner flakiness, not a code defect, and unbounded each of those would have cost 6 h.

**Every bound is sized from the workflow's OWN measured maximum successful run**, not guessed:

| workflow | measured max | bound |
|---|---|---|
| `verify-development` | 251.6 min | 330 |
| `verify-communities` | 42.8 min | 120 |
| `source-monitor` · `spot-check` · `verify-representative-zips` | 5.9–11.6 min | 45 |
| 16 fast verifiers / helpers | ≤ 4.1 min | 15 |
| 7 dispatch-only gov-feed helpers | **no successful run on record** | 30 (conservative) |

The 7 with no measurement are named as such rather than given a number pretending to be derived.
`unit-tests` also gained a bound (15 min against a ~2.5 min measured max). Verified by parsing all 31
workflow files: **0 jobs still unbounded, 0 parse errors.**

⚠️ **`verify-development`'s 330 is a bound, not headroom** — it sits above the 251.6 min measured max on
purpose, but the job is already 4.2 h against what was a 6 h ceiling and grows linearly with the cache.
The bounding report above is what actually fixes that; this only stops a hang from costing 6 h.

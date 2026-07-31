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

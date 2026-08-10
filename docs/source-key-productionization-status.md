# Source-key repair — productionization status, corpus re-measure, Cabarrus audit

**2026-08-10.** Follows `docs/source-key-quality-repair.md` (commit `6a92a41`).
**No production change was made in this session.** No deploy, no re-cache, no registry change.

---

## 1. Deployment status — all four layers proven separately

| Layer | Status | Proof |
|---|---|---|
| Code merged to `main` | **NO** | `git merge-base --is-ancestor 6a92a41 origin/main` → not an ancestor. `6a92a41` exists only on `origin/claude/homesignal-multisource-architecture-95bolu`. |
| Edge function deployed with `identity_fields` | **NO** | Deployed slug `get-address-report` is **version 197**, `updated_at` **2026-08-09 19:52:15 UTC** — *before* the commit. `grep -c identity_fields` → **0**; `grep -c identityFromFields` → **0**. |
| Brunswick reports refreshed under new code | **NO** | 37,909 cached Brunswick site elements: **0** carry the new composite `source_id` form, 37,909 carry the old form. Cache `refreshed_at` 2026-08-08 00:45 UTC. |
| NYC reports refreshed under new code | **NO** | 1,355 cached NYC site elements: **0** new form. `refreshed_at` 2026-08-08 19:00–23:45 UTC. |

**Positive control on the deploy grep** (so "0 matches" is not "the grep ran over nothing"): the same
file yields matches for `brunswick-county-permits`, `nyc-dobnow-approved-permits` and `source_id`.
The deployed artifact is a real bundle (1.16 MB, registry inlined) — the absence is real.

### What remains, and why I stopped

1. **Merge `6a92a41` to `main`** — founder gate.
2. **Deploy** `get-address-report` via `deploy-edge-functions.yml` (`workflow_dispatch`). It deploys
   **from the dispatched ref**, so dispatching the feature branch would ship unmerged connector code
   to production. Per the hard rule, I did not do this.
3. **Targeted re-cache** — the ZIP lists are derived below, ready to run.
4. Re-materialize those ZIPs, then re-run §2's measurement to fill the "after" column.

### Phase 2 ZIP lists — derived from data, not from memory

| Source | Affected ZIPs | Sites |
|---|---:|---:|
| `brunswick-county-permits` | **14** | 155,319 |
| `nyc-dobnow-approved-permits` | **213** | 62,043 |

Brunswick, complete: `28420, 28422, 28436, 28451, 28452, 28456, 28461, 28462, 28465, 28467, 28468,
28469, 28470, 28479`.

⚠️ **NYC is 213, not the ~245 carried in the brief** — see §11.

---

## 2. Corpus before / after

Same methodology, re-run in full (3 slices over `dev_sites_deduped`, the materializer's own path):

| Metric | Before (2026-08-10 baseline) | After (this session) | Delta |
|---|---:|---:|---:|
| Source-derived sites | 3,022,921 | 3,022,921 | **0** |
| ZIPs | 11,817 | 11,817 | 0 |
| Distinct `(zip, source_key)` | 2,706,057 | 2,706,057 | 0 |
| Duplicate groups | 37,965 | 37,965 | **0** |
| Rows in duplicate groups | 354,829 | 354,829 | **0** |
| Keyless records | 0 | 0 | 0 |
| Worst single group | 3,664 | 3,664 | 0 |
| Materialized `source_seq > 1` | 19,085 | 19,334 | +249 |

**The zero deltas are the expected and correct result** — nothing was deployed or re-cached, so the
corpus cannot have improved. Re-running it proves the baseline has not *drifted* under the daily
`dev_refresh` cron, which is what makes the eventual "after" comparison meaningful.

The `source_seq > 1` delta reconciles exactly: `19,085 + 249 = 19,334`, the 249 being ZIP 11201
(Brooklyn), materialized for the first time at the end of the previous session. `keyed` moves
`227,272 + 1,118 = 228,390` for the same reason.

---

## 3–4. Brunswick and NYC production result

**Expected: no change. Actual: no change.** Both remain exactly at baseline (Brunswick 155,319
records / 1,007 distinct identities / max multiplicity 3,664; NYC 62,043 / 43,212 / max 20) because
the connector fix is not deployed. The predicted post-deploy figures — Brunswick max **57,543 → 2**,
NYC max **20 → 2**, both measured by live groupBy at the publishers — are unchanged predictions,
**not** results, and are labelled as such.

---

## 5. Evidence integrity — clean

FK inventory re-derived (not assumed): exactly **three** validated `ON DELETE CASCADE` FKs to
`app_projects` — `property_company_roles`, `project_facility_refs`, `identity_conflicts`. No
additional referencing table exists. `app_changes.related_project_id` remains 0 populated rows.

| | Before | After two refresh cycles |
|---|---:|---:|
| `property_company_roles` | 66 (48 with NULL `project_id`) | 66 |
| `project_facility_refs` | 33 | 33 |
| `identity_conflicts` | 4 | 4 |
| role orphans / facref orphans / conflict orphans | 0 / 0 / 0 | **0 / 0 / 0** |
| TDLR/TABS roles still attached | 5 | **5** |

All five Del Valle TABS identities intact and correctly keyed —
`tdlr_tabs:TABS2023006449 / …6483 / …2024016698 / …2024022676 / …2026011928`.

**Repaired sources still carry zero downstream evidence:** 217,355 Brunswick+NYC rows, **0** with
evidence. **Cabarrus: 30,264 rows, 0 with evidence** (checked before the audit, per Phase 6).

**Two-refresh stability, this session** (each ZIP refreshed twice, ids compared):

| ZIP | rows | ids preserved | lost | new |
|---|---:|---:|---:|---:|
| 78617 | 537 | **537** | 0 | 0 |
| 28470 (Brunswick) | 19,155 | **19,155** | 0 | 0 |
| 11201 (NYC) | 1,118 | **1,118** | 0 | 0 |

---

## 6. Cabarrus classification — **Class C + Class D. NOT a source-key defect.**

`cabarrus-county-plan-reviews` · layer `Current_Accela_Permits/Plan_Reviews/MapServer/0`, internally
named **`AccelaQuery`** (a database view, ArcGIS 10.91).

**The mapped identity is already correct.** `case_number → B1_ALT_ID`, and `B1_ALT_ID` is the
layer's own **`displayField`**, carrying real permit numbers (`PRB2025-00756`, `PRS2021-00276`).
This is the opposite of Brunswick, where the mapped column was a counter.

**Evidence for the worst group — `PRB2025-00756`, n=891:**

- groupBy `(ReviewType, B1_PER_ID1, B1_PER_ID2, B1_PER_ID3)` → **one group, n=891**. All 891 rows
  share Accela's own record triplet `25CAP / 00000 / 0038P` and ReviewType `Commercial New`.
- groupBy `(StreetAddress, ParcelNum, B6_ADDR_TYPE)` → **one group, n=891**:
  `65120 SAWGRASS LN KANNAPOLIS NC 28027` / `46918500940000` / `Kannapolis`.
- Sampled rows differ **only in OBJECTID** (195111913, 195111914, 195111915 …), and OBJECTIDs near
  195 million on a view named `AccelaQuery` are consistent with a join explosion at the publisher.
- **With geometry:** 195111913/914/915 share one point; 195112280/281 share a *different* point. Our
  cache confirms the consequence — `PRB2025-00639` has **1,104 site instances at 368 distinct
  lat/lng**, with 1 distinct label, 1 date, 1 status.

**So the duplication is two things, neither of them an identity problem:**

- **Class C** — exact publisher duplicates (several identical rows at the same point).
- **Class D** — geometry decomposition: one permit emitted at hundreds of points, the MassDOT
  pattern. This is why `dev_sites_deduped` does not collapse them: lat/lng is in the dedup key and
  the points genuinely differ.

**No candidate field distinguishes these rows, because they are not distinct records.** Accela's
`B1_PER_ID1/2/3` triplet is identical across all 891 — the only varying field is the
system-generated `OBJECTID`, which the rules forbid using without documented durability (and which
is unstable on a rebuilt view).

---

## 7. Cabarrus change — **NONE, deliberately**

Phase 6's gate is "if and ONLY if the evidence conclusively identifies an authoritative
key/composite." The evidence conclusively identifies the **opposite**. Adding an `identity_fields`
composite here would manufacture distinctness for rows that carry none — precisely what the hard
rules forbid ("never force uniqueness just to eliminate `source_seq`").

`source_seq` is the correct handling for the Class C portion. The Class D portion (one permit at 368
points) is the **same product-model question as MassDOT** and is deferred to the founder, unchanged.

---

## 8. Remaining duplicate sources — top 10 (unchanged; fixes not yet live)

| # | Source | Rows in dups | Max mult | % of source | Preliminary class | Action? |
|---|---|---:|---:|---:|---|---|
| 1 | `brunswick-county-permits` | 155,106 | 3,664 | 99.9% | **A — fixed, awaiting deploy** | deploy |
| 2 | `massdot-highway-projects` | 85,627 | 136 | 92.8% | **D** — geometry segments | founder (product) |
| 3 | `nyc-dobnow-approved-permits` | 29,338 | 20 | 47.3% | **B — fixed, awaiting deploy** | deploy |
| 4 | `cabarrus-county-plan-reviews` | 28,666 | 368 | 94.7% | **C + D** (this session) | none |
| 5 | `missoula-addresses-with-permits` | 11,094 | 87 | 15.3% | unclassified | investigate later |
| 6 | `clv-planning-cases` | 5,777 | 137 | 75.5% | unclassified | investigate later |
| 7 | `desoto-county-permits` | 4,465 | 1,081 | 62.8% | suspected **A** (`APBTP`) | **next candidate** |
| 8 | `charleston-county-permits` | 4,359 | 146 | 11.5% | unclassified | low priority |
| 9 | `mdot-stip-projects` | 4,144 | 54 | 55.9% | suspected **D** (DOT) | founder (product) |
| 10 | `minneapolis-ccs-permits` | 3,684 | 8 | 7.9% | unclassified | low priority |

After the two pending fixes land, **~184,000 of the 354,829 duplicated rows (52%) are addressed by
identity**. Of the remainder, the largest blocks (MassDOT 85,627 + Cabarrus 28,666 + MDOT 4,144 =
**118,437, 33% of all duplication**) are **not identity defects at all** — they are the one product
question: *should one project with many geometries be one record or many?*

---

## 9. MassDOT — re-measured, untouched

`92,315` materialized rows · `20,323` distinct identities · `13,635` duplicate groups · `85,627`
rows in groups · max multiplicity `136`. Source layer: 24,045 features; project `613571` spans 811.
**No behavioral change made.** Reported here only as a corpus contribution. It remains a **product
model question**, not a key-quality defect.

---

## 10. Tests

| Suite | Result |
|---|---|
| `source-key-quality` | **PASS** (22 assertions, real captured publisher rows) |
| `app-projects-stable-key` | **PASS** |
| `connector-option-surface` | **PASS** (15 checks) |
| `app-refresh-zip-determinism` | **PASS** |
| **Full offline suite** | **87/87 files pass** |

Two consecutive refreshes on 78617 / 28470 / 11201 → identical output both runs, 100% id
preservation (§5).

---

## 11. Corrections

1. **NYC affected ZIPs: the brief's "approximately 245" is wrong — the measured figure is 213.**
   Derived from the cache by `count(distinct zip)` where the connector actually contributes sites.
   The 245 was the NYC-borough *page* expansion count (`nyc_borough_zip_expansion` added 245
   `level=zip` rows), which is not the same set as the ZIPs this connector reaches. Brunswick's
   "approximately 14" **is** correct (exactly 14).
2. **My own prior-session speculation was wrong.** `docs/source-key-quality-repair.md` §16 called
   `cabarrus-county-plan-reviews` "the next likely Class A" and "highest-value next candidate". It
   is **not Class A** — the mapped column is already the layer's `displayField` and a real permit
   number. It is Class C + D and needs no identity change. That line was a guess from the
   multiplicity shape (max 368) without publisher evidence; this session replaced it with evidence.
   The corrected next Class A candidate is `desoto-county-permits`.
3. No other prior measurement failed re-verification. The corpus figures, evidence counts and
   Brunswick/NYC identity findings all reproduced exactly.

---

## 12. Recommendation

**Source-key quality is NOT yet the blocker — deployment is.** But neither is a reason to hold the
evidence architecture.

**Do not start TCAD / the evidence architecture until `6a92a41` is merged and deployed.** Not
because of key quality, but because the multi-source model will attach evidence to `app_projects`
rows, and re-keying Brunswick/NYC *after* evidence exists would be far more expensive than doing it
now while **0 rows carry evidence**. The window is currently free; it will not stay free.

Recommended order:

1. **Merge + deploy + targeted re-cache** (14 + 213 ZIPs) + re-materialize + re-measure. This is the
   only outstanding item from the repair itself.
2. **One founder decision — the geometry/product question** covering MassDOT, Cabarrus and MDOT
   (118,437 duplicated rows, 33% of all duplication): one project with many geometries = one record
   or many? No identity work can or should answer it.
3. **`desoto-county-permits`** (max multiplicity 1,081 on `APBTP`) — the one remaining plausible
   Class A, ~4,465 rows. Small; can ride alongside the evidence work.
4. **Then** the multi-source evidence architecture and the TCAD parcel adapter.

Items 2 and 3 do **not** block item 4. Item 1 does.

---

# PART 2 — Productionization executed (2026-08-10, later same day)

Founder approval received for the ten authorized actions. This part supersedes Part 1's status
table: **the code is now merged and deployed.** The re-cache is **halted mid-flight, deliberately,
with nothing written** — see §17.

## 13. Merge — done, and proven to contain only the reviewed work

| Step | Receipt |
|---|---|
| PR | **#661**, `unit-tests` run **31423062071** → `completed success` |
| Squash-merged to `main` | **`988c929`** "Stable app_projects source key + identity_fields repair (Brunswick, NYC DOB NOW) (#661)" |
| Merge contains ONLY the intended work | `git diff --stat HEAD origin/main` → **empty output**. `main`'s tree is byte-identical to the reviewed branch head `65ce47e`. Not an eyeballed diff — an assertion that the trees are equal. |
| Runtime surface of the merge | 2 files: `sources/arcgis.ts`, `sources/socrata.ts` (+35/−1 each, symmetric) and `jurisdiction-registry.json` (+9/−0). Everything else is docs/tests. |

## 14. Deploy — done, and verified in the deployed artifact (not inferred from a green workflow)

`deploy-edge-functions.yml` dispatched **from `main`**, run **31423300551** → `completed success`.

A successful workflow is not evidence of a deployed behaviour, so the artifact itself was read:

| Check | Result |
|---|---|
| Deployed version | **197 → 198** (`updated_at` 1786305135261 → 1786389427530) |
| Artifact size | 1,161,752 → **1,192,953** bytes |
| `identityFromFields` occurrences | **4** (was 0) |
| `identity_fields` occurrences | **8** (was 0) |
| arcgis call site | `` arcgis:${entry.registry_id}:${identityFromFields(row, entry.identity_fields) ?? caseNo ?? rowId(row) ?? title} `` |
| socrata call site | `` socrata:${entry.domain}:${entry.dataset_id}:${identityFromFields(row, entry.identity_fields) ?? caseNo ?? rowId(row) ?? title} `` |
| Display fields preserved | `"case_number": "PermitNumber"` and `"case_number": "job_filing_number"` both still present |

## 15. Target ZIP sets — re-derived from the live cache, correcting two earlier numbers

| Source | ZIPs | Cached records |
|---|---|---|
| `brunswick-county-permits` | **14** | 155,319 |
| `nyc-dobnow-approved-permits` | **214** | 62,591 |

**214, not 213 and not the brief's ~245.** The brief's 245 was the borough *page* expansion count
(a different set); the 213 in Part 1 was measured at the `app_projects` layer, which excludes a ZIP
cached but not materialized. The authoritative set for a re-cache is the cache itself. Total **228**.

## 16. BEFORE measurement (over `dev_sites_deduped`, the view the materializer itself reads)

| Source | ZIPs | Records | Distinct keys | Dup groups | Excess rows | Worst group | Keyless |
|---|---|---|---|---|---|---|---|
| `brunswick-county-permits` | 14 | 155,319 | **1,007** | 794 | 154,312 | **3,664** | 0 |
| `nyc-dobnow-approved-permits` | 214 | 62,591 | 43,529 | 10,605 | 19,062 | 20 | 0 |

Brunswick's 155,319 records collapsing onto 1,007 keys is the Class A defect exactly as diagnosed.

## 17. ⛔ RE-CACHE HALTED — EPA FRS is returning zero facilities right now

**Nothing was written. `dev_refresh_collect()` was never called.**

### What was observed

14 Brunswick ZIPs were fired through `net.http_post`: **4 × 200, 10 × 504** (gateway timeout on the
heaviest pages — 28452 alone returns 14.62 MB / 15,689 records). Every one of the four 200s carried
**`facilities: 0`**, including two ZIPs with cached facilities (28436 cached 2, 28456 cached 5).

Five NYC ZIPs were then fired as an independent test. All **200**, all with development counts
intact and slightly *increased* (937→953, 368→375, 1124→1130, 446→452, 470→514 — new permits since
the last cache, so the engine and the permit connectors are healthy), and **all with
`facilities: 0`** — including 11373 (18 cached) and 11214 (7 cached).

That is a 9-ZIP, 2-state measurement with its own positive control: the same responses prove the
fetch path works, so the empty dimension is FRS specifically.

### The instrument that looked like evidence and was not

`public.epa_frs_probes` shows every probe since 18:45 UTC failing with
`Failure when receiving data from the peer`. That is **not** usable evidence: the probe has
**178 rows and has NEVER once reported `ok=true`** (`count(*) filter (where ok)` → **0**,
`max(probed_at) filter (where ok)` → NULL). A monitor that has never been green cannot
distinguish "the source is down" from "the monitor is broken." The FRS conclusion above rests on
the nine live engine responses, not on this probe. **The probe itself is a defect to fix**, logged
here, not repaired in this session.

### Why this stops the re-cache rather than slowing it

`dev_refresh_collect()`'s transient-safe guard refuses any write where the cached row is fresher
than 7 days, the response reports 0 facilities, and the cached row has facilities > 0. Measured
against the real target set:

| | ZIPs |
|---|---|
| Targets | **228** |
| Would be **blocked** by the guard | **183 (80%)** |
| Writable (already 0 cached facilities) | 45 |
| Stale enough for the guard to be off | 0 |

So proceeding has exactly two outcomes, and both are wrong:

1. **Collect normally** → only 45 of 228 ZIPs (20%) re-key. The corpus lands in a mixed state,
   and the BEFORE→AFTER this session exists to produce would be measured over a fifth of the
   target set while being reported as the repair's result. That is a misleading number, not a
   partial one.
2. **Bypass the guard** → EPA facility records are wiped from **183 live production pages** to
   work around an unrelated upstream outage. That is the "would risk destroying data — STOP and
   report before executing" case in the brief, and the guard exists precisely to prevent it.

**Neither was done.** The nine responses will age out of the 20-minute collection window and have
no effect.

### Production state, verified after halting

| Check | Value |
|---|---|
| Target ZIPs written this session | **0** (`refreshed_at` range still 2026-08-07 15:45 → 2026-08-09 18:15) |
| `dev_refresh_targets` queue | **779 rows, 779 unfired, 0 consumed** — untouched |
| `property_company_roles` / `project_facility_refs` / `identity_conflicts` | 66 / 33 / 4 — unchanged |
| Orphaned evidence rows | **0** |
| TDLR/TABS records at 78617 | **5** — intact |
| `app_projects` | 3,027,773 (`source_seq > 1`: 19,334) — unchanged |
| Safety gate, re-checked at halt | `evidence_on_rekey_rows` = **0** |

**`dev_refresh_fire_targets()` was deliberately not used.** It claims `where fired_at is null
order by zip limit _batch` from the *shared* queue, which currently holds **779 unrelated unfired
ZIPs** (0 overlap with the Brunswick set) — calling it would have swept ZIPs the approval did not
cover. Requests were fired directly for exactly the target ZIPs instead.

### To resume (no re-derivation needed)

1. Confirm FRS is answering: fire one ZIP with a known non-zero cached facility count (e.g. 11373,
   cached 18) and read `counts.facilities` from the response **without** collecting.
2. Re-fire the 228 targets **in batches of ≤5** — 10 of 14 Brunswick ZIPs 504'd at concurrency 14,
   and 28452 needs its own request.
3. `select public.dev_refresh_collect();` within 20 minutes of each batch.
4. Re-materialize via `app_refresh_zip()`, then re-run §16's query for the AFTER column.
5. Two consecutive refreshes of one Brunswick + one NYC ZIP to prove `app_projects.id` stability.

## 18. Full test suite — green, and proven to have run

`node scripts/run-unit-tests.mjs` → **All 94 unit test file(s) passed (mode=all)**, 1,863
assertions. `--offline` → 87 files passed.

Silence is not evidence, so both new suites were confirmed to have actually executed:
`source-key-quality.test.mjs` printed all **22** named assertions, including the controls
(`control: the old case_number field IS identical on both rows`, `control: work_permit ALONE is
also identical on all 8`) and `exactly the two audited entries declare identity_fields (found:
nyc-dobnow-approved-permits, brunswick-county-permits)`.

## 19. `desoto-county-permits` — read-only, CONFIRMED next Class A (not repaired, per instruction)

| Metric | Value |
|---|---|
| Records / ZIPs | 7,105 / 10 |
| Distinct `source_key` | 1,565 |
| **Distinct `case_number`** | **3** |
| Duplicate groups / excess rows | 26 / 4,439 |
| Worst group | **1,081** |

The three values are `CM1`, `MH1`, `RS1` (plus nulls) — permit **type codes**, not identifiers, so
`source_id` becomes `arcgis:desoto-county-permits:RS1` for a thousand distinct permits. Rows whose
`case_number` is null fall through to `rowId(row)` (e.g. `arcgis:desoto-county-permits:4499`),
which is why 1,565 keys exist rather than 3. Same shape as Brunswick, one tenth the volume.

**This also corrects Part 1 §12's guess** that the offending field was `APBTP` with "~4,465 rows":
the measured excess is **4,439** and the collapse is visible in `case_number`. Not repaired here —
the approval explicitly excluded it.

---

# PART 3 — EPA FRS diagnostic (2026-08-10). Re-cache still blocked; **FRS HEALTH GATE = FAIL**

Part 2 halted the re-cache on a suspected FRS problem. This part diagnoses it properly and
**corrects two of Part 2's own conclusions.**

## 20. Root cause: EPA FRS is degraded upstream. HomeSignal is not broken.

The FRS path in `supabase/functions/get-address-report/index.ts`:

| | |
|---|---|
| Endpoint | `https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities` (`frsAt`, line 265) |
| Method / params | GET · `latitude83`, `longitude83`, `search_radius`, `output=JSON` |
| Timeout | 30 s (`AbortSignal.timeout(30000)`) |
| Back-off | `frsFacilities`: radii `[3,2,1.5,1,0.5,0.25]` × 3 attempts each; `status>=500` and parse/network errors are transient (retry), `Results.Error` is the process limit (shrink) |
| Parser | `Results.FRSFacility ?? Results.Facilities ?? FRSFacility`; reads `RegistryId`, `FacilityName`, `Latitude83`, `Longitude83` |
| Failure output | after all radii × attempts → `[]` → `counts.facilities = 0` |

**Every candidate cause was tested against the live service, not assumed:**

| Hypothesis | Verdict | Receipt |
|---|---|---|
| E. Endpoint dead / moved | **NO** | `?registry_id=110019451886&output=JSON` → **HTTP 200**, 346 bytes, returns `ALLIED SANITATION 73 PLACE FACILITY` — a facility already in 11373's cache |
| E. Schema changed | **NO** | that 200 payload has `RegistryId`, `FacilityName`, `Latitude83`, `Longitude83`; `Results.FRSFacility` is an `array`. Every field the parser reads is present and correctly typed |
| D/F/H. Parser / filter / swallowed exception | **NO** | the parser is never reached — the transport fails first |
| G. Coordinate or radius bug | **NO** | facility `110019451886` lives at 40.736805/−73.889595, **0.64 mi** from the 11373 centroid (40.7351/−73.8776) — inside even the smallest back-off radius, and the same query returned all 18 on 2026-08-08 |
| A. Genuinely empty area | **NO** | 11373 has 18 cached FRS sites, 11214 has 7, with registry IDs |
| **B/C. Upstream request failure / timeout** | **YES** | see below |

**The measurement.** Six non-spatial and six spatial requests fired together, identical shapes:

| Request shape | Attempts | HTTP 200 | HTTP 502 | Transport failure |
|---|---:|---:|---:|---:|
| non-spatial (`registry_id`) | 6 | **3** (all 3 carried `FRSFacility`) | 3 | 0 |
| spatial (`latitude83`+`longitude83`+`search_radius`) | 6 | **0** | 4 | 2 |

A confirming battery of 8 more spatial requests across both control centroids: **0 × 200, 8 × 502.**

The 502s are `<title>502 Proxy Error</title>` from **EPA's own proxy**, and the transport failures are
`Failure when receiving data from the peer` and `Timeout of 30000 ms reached … (DNS 72 ms, TCP/SSL
handshake 601 ms, HTTP Request/Response 29,327 ms)` — DNS resolves, TLS completes, then EPA never
delivers a body. `https://api.github.com/zen` → 200 from the same pg_net worker, so egress is fine.

**Conclusion: EPA FRS is intermittently failing, and the spatial search — the only shape HomeSignal
uses — is failing far harder than non-spatial (0/17 vs 4/8 today).** Per the standing instruction,
this is *not* coded around: zero is not treated as valid, and no re-cache proceeds.

## 21. ⚠️ CORRECTION — Part 2 called `epa_frs_probes` a broken instrument. It is not.

Part 2 §17 asserted the probe "has never been green, so a monitor that has never been green cannot
distinguish a dead source from a dead monitor," and logged it as a defect. **That was wrong, and the
error was reasoning from the absence of a green row without checking the window it covers.**

`select min(probed_at), max(probed_at) from public.epa_frs_probes` → **2026-08-09 21:46 →
2026-08-10 20:00**. The table is ~22 hours old. Across all **182** rows: **0 × HTTP 200, 8 × 502,
171 transport failures, 2 unresolved.** The probe fired every time, received real HTTP status codes
back (the 502s prove the requests reached EPA's proxy), and recorded failure correctly on every one.

**It has never been green because FRS's spatial endpoint has not returned 200 once since the probe
was created.** The monitor is reporting a real, continuous ~22-hour outage. It was working.

That also means the FRS finding in Part 2 was *right for a reason Part 2 dismissed* — and the
independent nine-ZIP engine measurement it fell back on happened to agree.

### Two genuine design gaps remain (not repaired — see below)

1. **No known-positive control.** Both probe targets are spatial. Today proves the two shapes fail
   independently, so a non-spatial `registry_id=110019451886` control would separate *"FRS is down"*
   from *"FRS's spatial search is down"* — a distinction that changes the remediation.
2. **`ok` conflates healthy-and-empty with failure.** The predicate is
   `status_code=200 AND content LIKE '%"Results"%' AND content NOT LIKE '%"Error"%'`, so a genuinely
   empty area returning an `Error`-shaped "no facilities found" would be recorded as not-ok.

**Not fixed in this session, deliberately.** Phase 8 authorized a monitor repair conditioned on the
monitor being invalid; that premise is now disproven, the monitor is functioning, and the remaining
items are design improvements rather than the incident. Changing a `SECURITY DEFINER` production
function mid-incident to fix something that is currently working is not the minimum safe action.
The exact change is specified above and needs only a go-ahead.

## 22. ⚠️ CORRECTION — "the spatial search specifically hangs" was concluded from n=1

Mid-diagnostic, one round showed the non-spatial lookup at 200 while spatial timed out, and the
working conclusion became "spatial only." The very next round returned **502 on all four requests,
including the same non-spatial lookup that had just succeeded.** Both shapes are degraded; spatial
is merely much worse. The n=6/n=8 batteries above replaced the n=1 inference.

## 23. FRS HEALTH GATE = **FAIL**

| Control | Cached facilities | Cache vintage | Fresh spatial result |
|---|---:|---|---|
| 11373 (centroid 40.7351/−73.8776) | **18** | 2026-08-08 11:15 UTC | 0 — no 200 in any attempt |
| 11214 (centroid 40.6016/−73.9968) | **7** | 2026-08-08 19:00 UTC | 0 — no 200 in any attempt |

Registry-ID overlap between cached and fresh: **0 of 25**, because no fresh spatial response ever
arrived. The gate requires a nonzero fresh count *and* registry-ID overlap. Neither is achievable
while the upstream is failing.

**Phases 11–18 (re-fire, collect, re-materialize, BEFORE→AFTER, two-refresh stability, evidence
integrity) are therefore not executed.** They are gated on Phase 9 by the brief's own ordering.

## 24. Production state at the end of this session — unchanged, again

| Check | Value |
|---|---|
| Cache rows written in the last 6 h | **0** |
| `dev_refresh_collect()` calls | **0** |
| `dev_refresh_targets` consumed | **0** (779 unrelated rows still untouched) |
| `property_company_roles` / `project_facility_refs` / `identity_conflicts` | **66 / 33 / 4** |
| Del Valle 78617 TABS records | **5** |
| Phase 10 safety gate `evidence_on_rekey_rows` | **0** |
| Transient-safe guard | untouched |

Every request in this diagnostic was a **read** — `net.http_get` against EPA, plus SELECTs. No write
path was invoked.

## 25. Resume trigger (unchanged from Part 2, now with a cheap gate)

Poll one spatial request and require **HTTP 200**:

```
select net.http_get('https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities?latitude83=40.735100&longitude83=-73.877600&search_radius=3&output=JSON','{}'::jsonb,'{}'::jsonb,30000);
```

When that returns 200 **and** the payload contains registry id `110019451886`, the health gate
passes; then run Part 2 §17's resume steps (batches of ≤5, `28452` alone, collect within 20 min).

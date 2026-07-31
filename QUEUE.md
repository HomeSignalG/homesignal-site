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

**After FL: probe MassDOT and PennDOT the same way** — service root → find the projects layer →
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

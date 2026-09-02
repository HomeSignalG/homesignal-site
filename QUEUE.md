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

- **Goal (row 380):** 12,722 ZIP pages, 50 states. ⚠️ **The original figure on this line
  (NV 158 + TX 668 + UT 310 = 1,136 live / 8,215 remaining) is the row-380 SEED and is long
  superseded — do not quote it.** Measured on `app_projects` **2026-08-13: 7,476 live / 12,722
  (58.8%), 5,246 dark** (workbook 0080). Re-measure with the scoreboard rather than reading either
  number off this line.
- **LIVE is not COVERED (row 381).** Texas is the standing example. ⚠️ **The "zero
  `government_notice` sources" half is FALSE as measured 2026-07-30** — see TX-GOV below.
  The principle stands; the number does not. Always report both numbers.
- **7-phase playbook (rows 383–389).** Phases 1–6 are the work and are autonomous.
  **Phase 7 is the gate: the CLAIM** — sitemap, coverage claim, or reporting a state live.
  One report per state at Phase 7, not per phase.
- **Check the known blockers (row 391) before debugging any environment problem.**

---

## RESUME POINT — read this first (updated 2026-08-13)

### 2026-09-02 — HANDOFF: Claude Code is now the SOLE agent (Cursor retired)

Cursor has been retired from this project; **Claude Code is the only agent going forward.** Two
risks that earlier rules guarded against are **retired** with it:

- **The two-writer / two-session drift risk** (CLAUDE.md "Rule #0a — TWO SESSIONS WRITE THIS
  REPO"): there is now a single writer, so session-vs-session drift between concurrent agents no
  longer applies. The `−24` shared-table discipline still applies to scheduled jobs and any other
  non-agent writer — re-read row counts before writing a shared table.
- **The agent-local-VM loss pattern** that killed `feature/map-address-search` (six commits that
  existed only on a Cursor agent's VM plus a same-disk bundle, never pushed — see PR #1011 and
  `docs/n5-address-search-architecture-record.md`). "Push first or it does not exist" remains the
  standing rule; the specific cross-agent, unreachable-VM handoff that lost that work is gone.

### 2026-09-02 — STANDING ANSWER: make a version visible via a PATH binary, not an rc variable

**Environment state dies with the shell; filesystem state does not.** A `~/.bashrc` entry cannot
affect a **non-interactive** shell — bash does not read `~/.bashrc` there. Founder-measured
2026-09-02: `bash -c` and `bash -lc` both saw the value **unset**; only `bash -ic` saw it. So if a
specific interpreter version must be visible to a **non-interactive** command (a CI gate, an
agent-issued command), **put the binary earlier on `PATH` via a symlink** (filesystem state) —
**do not set an rc variable** (shell state).

**Second defect from the same work, recorded so it is not repeated:** an install script that
**exited 1 whenever `nvm` was absent** — even on a machine that already met the Node requirement.
It tested for a **version manager** instead of testing for the **requirement**. Test the
requirement (is `node >= X` on PATH?), never the tool you assumed would provide it.

_Origin: the retired Cursor env-setup config (PR #1012, now moot). This finding is
platform-independent, which is why it was extracted here before that PR was closed._

### 2026-08-14 — KANSAS WIRED (#712): 61 → 182/202 (90.1%). Statewide-DOT lever, 5th state.

**`kdot-wincpms-project-locations`, arcgis 166 → 167, merged `22868af`, deployed (run 31831595244).
ROLLOUT COMPLETE: 182 / 202 live (90.1%), KDOT on 180 pages / 2,375 records.** Pre-wire control:
202 cached, **61 live**. National **8,328 → 8,449** of 12,722.

- **Invariants over all 2,375 materialized rows: 0 missing `source_ref`, 0 missing coordinates,
  0 missing title, 0 missing status**, statuses `Approved`/`Operating`, lat 37.391–39.774 / lng
  −98.418 to −94.608 — wholly inside Kansas. Dates 2021-08-17 → 2031-10-08, exactly the 1825-day
  window with future lettings retained. **Gate proof, bidirectional:** `leaked_outside_ks = 0`
  cache-wide, and the pre-rollout control **64108 (Kansas City MO, Jackson Co) returned 0 KDOT
  records while keeping its own 785** — a cross-state-line control directly opposite 66101, which
  took 66. That is the strongest gate receipt to date.
- **Both vocabularies enumerated live, each summing EXACTLY to 8,297:** `proj_status_cd` = CLOSE
  5,584 + COMPL 1,358 + ACTIV 1,235 + `CANC ` 112 + `PLAN ` 8; `wtyp_name` = 83 self-describing
  values. 0 unclassified. ACTIV→approved, PLAN→proposed, COMPL+CLOSE→operating, CANC→exclude.
- ⚠️ **`CANC ` and `PLAN ` carry upstream char(5) RIGHT-PADDING.** The connector trims both sides,
  so the mapping uses TRIMMED values — the `harris-county-plats` precedent. Mapping the padded
  strings would have silently dropped 120 rows into fail-closed.
- **`recency_days: 1825` MEASURED, not assumed** (the Phoenix discipline). `d_proj_let_date` is a
  true `esriFieldTypeDate` spanning 2010-03-23 → 2031-12-16. Unwindowed 8,297 · 1825d **2,561** ·
  1095d 1,712 · 283 NULL let dates dropped. **6,942 of 8,297 rows are finished work (CLOSE+COMPL)
  reaching back to 2010** — unwindowed, resident pages would fill with decade-old completed
  roadwork rendered as "operating".
- **Column population verified IN-WINDOW before mapping** (the arlington/harris-county-permits
  failure class — config that looks complete and silently emits nothing): `proj_friendly_name`
  NULL → 0, `d_proj_full_num` NULL → 0, `prdc_friendly_loc_desc` NULL → 0. Sampled rows:
  `Guardrail End Terminal Updates on US-169 in Anderson Co` / KA-6463-01 / ACTIV.
- 🆕 **FOURTH CONSECUTIVE STATE WHERE THE SERVER PATH WAS THE BLOCKER.** `gis.ksdot.gov` fails DNS
  outright; the live server is **`kanplan.ksdot.gov/arcgis_web_adaptor/`**, recovered by searching
  the OWNER ACCOUNT `KanDOT` (695 items) and reading the item's own `url` field — the same
  owner-account move that found Oregon's `OregonDOTGIS`. INDOT `/ro/` · MoDOT DNS-dead · SCDOT
  `/hosting/` · KDOT `kanplan`. **Never conclude a DOT has nothing from a host guess.**
- ⚠️ **LAYER INDEX IS 2** — `Projects_KHUB/MapServer/0` returns `{"error":{"code":404,"message":
  "Layer not found"}}`; the `layers` array holds exactly one entry, id 2. Third state running
  (MoDOT layer 1, SCDOT layer 1). **Read the layers array, never assume 0.**
- **Rejected siblings with receipts:** `WinCPMS KHUB` (same source, item stale 2023-09-19) ·
  `Project Strip Maps` (cartographic imagery, not a register) · `SigWorkZone` (signed work zones —
  transient traffic control, the ODOT TripCheck event-vs-project distinction).
- 🧹 **PRE-EXISTING, NOT CAUSED BY THIS WIRE — Topeka 66603 is a 5.67 MB cached row**, near the
  Cleveland 44127 high-water mark (5.98 MB). `topeka-building-permits` supplies **6,100** of its
  6,126 records; KDOT contributes 26. Levers are `spatial_zip_radius_mi` or an `out_fields`
  projection, both of which change what residents see — logged, not touched.
- ⚠️ **`dev_refresh_collect()` now exceeds the 60 s MCP client timeout on large batches.** It
  COMPLETES server-side; confirm by re-reading the count in a separate statement, never by whether
  the call returned. (And never call collect + count in ONE statement — the scalar subquery reads
  the pre-collect snapshot, which reported every SC batch one behind.)
- **20 ZIPs did not land** — the FRS facilities-guard class recorded under South Carolina, not a
  KDOT problem. They stay on the `refreshed_at` cursor; the 15-min `dev-reports-rolling-refresh`
  cron sweeps them.

### 2026-08-14 — MINNESOTA WIRED (#716): 34 → 120/174 (69.0%). Statewide-DOT lever, 6th state.

**`mndot-stip-roadway-projects` + `mndot-chip-roadway-projects`, arcgis 167 → 169, merged `5359ba5`,
deployed (run 31847890869). ROLLOUT PARTIAL BY CHOICE: 120 / 174 live (69.0%), MnDOT on 94 pages /
596 records.** Pre-wire control: 174 cached, **34 live**. National **8,449 → 8,535** of 12,722.

- **Invariants, per entry: 0 missing `source_ref`, 0 missing coordinates, 0 missing title, 0 missing
  status.** `mndot-stip-*` 401 rows, single status `Approved`, lat 44.01–45.55 / lng −94.26 to
  −92.46. `mndot-chip-*` 195 rows, single status `Proposed`, lat 44.03–45.50 / lng −94.31 to −92.49.
  Both wholly inside Minnesota. **Gate proof, bidirectional:** `leaked = 0` cache-wide, and the
  pre-rollout Wisconsin controls **54755 + 54739 (Eau Claire) returned 0 MnDOT** while keeping their
  own 2 and 11 records.
- 🆕 **TWO ENTRIES BECAUSE DISJOINTNESS WAS PROVEN — the general shape for a multi-layer DOT service.**
  The 2026-2035 CHIP service carries FOUR project layers (0 CHIP Bridge 500, 13 STIP Bridge 271,
  22 STIP Roadway 534, 23 CHIP Roadway 431). STIP could easily have been NESTED inside CHIP, which
  would double-emit every shared project on every page — the `houston-plat-applications` hazard that
  exact-identity dedup CANNOT catch across two `source_registry_id`s. Live `groupBy Fiscal_Yea`:
  STIP Roadway = 2026:160 + 2027:149 + 2028:141 + 2029:84 = **534** (sums exactly); CHIP Roadway =
  2030:54 + 2031:62 + 2032:65 + 2033:84 + 2034:73 + 2035:93 = **431** (sums exactly). **ZERO overlap
  — MnDOT PARTITIONS the ten-year plan** (STIP = committed years 1-4, CHIP = planned years 5-10).
  **Test the partition before wiring siblings; never infer it from the names.**
- ⚠️ **THE UNIT SUITE CAUGHT THE FIRST DRAFT AND IT WAS RIGHT.** Neither layer has a status column,
  so `status_const` is required (the `detroit-building-permits` pattern). I first used
  `"Approved"`/`"Proposed"` — and `status-const-must-be-mapped.test.mjs` FAILED on its ratchet:
  *"no NEW bucket-named constant (known: 14) … now 16"*. A `status_const` must DESCRIBE THE RECORD,
  not restate the bucket. Corrected to MnDOT's own program terms — **`Programmed`** (STIP → approved)
  and **`Planned`** (CHIP → proposed) — each resolving through its own `status_to_bucket`. **Without
  that ratchet the weaker version would have shipped.** 16 pre-existing entries still name a bucket;
  the ratchet freezes the count rather than fixing them.
- **No `file_date`, deliberately:** `Fiscal_Yea` is a YEAR (Integer 2026), not a date, and there is
  no date column — omitted rather than fabricated from a year. `recency_days` absent for the same
  reason. Column population verified in advance on BOTH layers: `Descriptio` NULL → 0,
  `SP_Number` NULL → 0. Sample: `ISANTI / 3006-39 / "Rebuild Hwy 95 from Fern St to Fillmore St in
  Cambridge…" / MN 95`.
- 🆕 **FIFTH CONSECUTIVE STATE WHERE A GUESSED HOST WAS DEAD** — `gis.dot.state.mn.us` fails DNS.
  Org is PUBLIC (`qWbGMYB49y8mLbRt`, urlKey `mndot`), but the service was found through the OWNER
  ACCOUNT **`MnDOT_GIS`** — the `OregonDOTGIS` / `KanDOT` move, now 3 for 3.
- **Rejected with receipts:** `MnDOT 2020 Construction Projects` (2020-04-30) · `MnDOT 2021
  Construction Projects` (2023-09-18) · `STIP Bridge/Pavement Projects on Tribal Nations` (2024-05-24
  AND tribal-scoped, not statewide) · `2025-2034 Capital Highway Investment Plan` (superseded edition).
- 📌 **OPEN — BRIDGE LAYERS 0 AND 13 (771 rows) NOT WIRED.** The FY partition almost certainly holds
  for them too, but that is an assumption. Run the same `groupBy Fiscal_Yea` on layers 0 and 13,
  then wire as two more entries. Would likely add materially to the 54 still-dark MN pages.
- ⚠️ **ROLLOUT STOPPED DELIBERATELY AT 101/174 REFRESHED, NOT RUN TO EXHAUSTION.** Batch yields ran
  25 → 11 → 10 → 12 → 11 → 13 → 14 → **+2**. That last figure is a stall: the remaining pool had
  concentrated into ZIPs the FRS facilities guard keeps refusing, and every further fire is FRS
  pressure that makes the next refusal more likely while discarding real MnDOT records with the
  transient zero. Handed to the 15-min `dev-reports-rolling-refresh` cron, which sweeps them on the
  `refreshed_at` cursor. **Firing harder does not fix an FRS-throughput refusal.**

### 2026-08-17 — ✅ RESOLVED: the 7 pre-existing ingest test failures were CI-DARK dead tests, already retired on main

The founder's closing question on the Phase-0 thread: were the 7 `tests/test_cutover_box_elder.py`
failures (observed on clean ingest main in the sandbox) red in CI on main, or sandbox-only?
**Neither — they were in a third category: genuinely failing everywhere, but invisible to CI.**
- **No CI ever ran them.** Measured across every ingest workflow: **22 of 57 test files are
  referenced by a CI workflow** (one via pytest — `test_local_news_topic_matrix.py` — the rest
  as per-gate direct `python tests/test_X.py` steps); `test_cutover_box_elder.py` has **0
  references, ever**. So there is no green main run covering them to cite, and no red one
  either — a green ingest main attested nothing about these tests.
- **The failures were content-genuine, not environment parity.** Re-run and read: gate G6
  fails with *"feeds.csv is missing reviewed rows: be-localnews-abc4/cvd/fox13/
  hjnews-tremonton/ksl/sltrib"* — the tests pinned the pre-Gold-Master Box Elder local-news
  rows, which were legitimately removed when Local News moved to the registry path. Dead tests
  asserting a completed one-time cutover state; they would fail identically on any machine.
- **Already adjudicated and removed on main** — by the other ingest session, before this
  question was asked: PR #338 ("Deactivate Hampshire + Middlesex MA; **retire the dead
  cutover**; give Gate 9 CI", commit `c626bac`) deleted the file. Current ingest main has no
  such tests. **Nothing gates the next merge; no stop-and-fix.**
- 🧭 **The parity caveat that DOES survive, logged:** ingest CI test coverage is per-gate, not
  suite-wide — **35 of 57 ingest test files are executed by no workflow**, so the sandbox
  pytest run is the only place they run, and sandbox failures in that set are invisible to (and
  unattested by) CI in either direction. When a sandbox test failure appears on clean ingest
  main, check whether ANY workflow references the file before reasoning about CI state — the
  instrument-must-prove-it-ran rule, at test-roster scale. Widening CI to the uncovered 35 is
  the ingest sessions' call, not taken here.

### 2026-08-17 — 🔎 PHASE 0 COMPLETE: agenda-item yield measured — ZERO on every axis, with named structural causes

**Founder-approved Phase 0 ran to completion (ingest run 31989802553, read-only; instrument PRs
#341/#346/#347/#348/#349). County selection was drawn from the dark-ZIP-ceiling population, not
convenience: the top dark-ZIP contributors per structured family — Granicus: Taos NM (13 dark),
Fauquier VA (8); CivicClerk: Collier FL (5), Minnehaha SD (3). RESULT: address strings 0 · case
strings 0 · fenced geocodes 0 · dark-ZIP page-lift 0.** Not one zero is a shrug — each has a
named cause:
- **Taos NM (granicus): measured 0.** 101 agendas in the wired RSS, **0 planning-titled** — the
  feed is the County Commission's; no planning body publishes on it. Extracting from EXISTING
  feeds yields nothing; a planning-body feed would be new wiring, not extraction.
- **Fauquier VA (granicus): structurally unreachable.** 48 planning-titled agendas exist — the
  best cell in the sample — but every document fetch dies on
  `SSL: CERTIFICATE_VERIFY_FAILED — hostname mismatch, cert not valid for
  'granicus_production_attachments.s3…'`: the AgendaViewer redirects to a Granicus S3
  attachments host whose underscored bucket name breaks TLS. Verification correctly refuses and
  is never bypassed. Vendor-side defect; 0 extractable over verified TLS. (Taos's tenant serves
  agenda HTML inline; Fauquier's serves S3 PDF attachments — Granicus tenant configs differ,
  so "Granicus HTML is parseable" is per-tenant, never per-family.)
- **Collier FL + Minnehaha SD (civicclerk): items not on the public API.** Events reachable
  (15 each, 5–6 planning-titled) but agenda ITEMS are exposed on none of the OData item
  endpoints — item content lives behind PublishedFiles (PDFs).
**Verdict: the 319-dark-ZIP document-extraction ceiling is theoretical.** In the very counties
that would supply it, the two structured families yield zero machine-readable agenda-item text;
every remaining path runs through PDF parsing of vendor attachments — a heavier, fuzzier build
the anti-fabrication rules make expensive, and one nothing measured here justifies. Measured
payoff chain now complete: titles ≈ 33 records / 0 dark lift → structured agenda items 0 / 0 →
unmeasured remainder = PDFs. **Recommendation: do not build `land_use_action`.**
Instrument lessons banked (all self-caught, each its own PR): a workflow secret that doesn't
exist sets its env var to EMPTY STRING and `.get()` defaults don't fire (#346); **the repo's
`SUPABASE_WRITE_KEY` is a new-format `sb_` secret key and Supabase's gateway HARD-REFUSES it
from any browser-looking User-Agent** — `"Forbidden use of secret API key in browser"` —
ingest.py only works because it sends no UA; never send a Mozilla UA on Supabase REST (#347/#348);
government-site fetches belong on the shipped `http_get_bytes`, not a private fetcher (#349).
**Deferred, logged not dropped (unchanged): the Multnomah bespoke wire** (quality add, 0
coverage lift — queued behind coverage work) **and the full land_use_action build** (was
contingent on Phase 0's number; that number is 0).

### 2026-08-15 — 🔎 SCOPING: notices/agendas as "proposed development" records — MEASURED, report delivered, NOTHING BUILT

Founder-directed evidence-only investigation. Full report in the session transcript; the numbers
that gate any future build:
- **Title yield is ~0.5%, concentrated in ONE feed.** Of 6,238 stored government notices
  (202 communities), 64 titles (1.0%) match an address-or-case regex, and reading them shreds
  that to **~33 real development-signal titles: Multnomah County Land Use Planning 27, Spokane
  County hearing examiner 5, Williams ND 1** — the rest are ordinance numbers, meeting-location
  addresses, and found-property notices. Meetings titles: 11 of 7,034. `alerts.description`:
  **0 rows populated >100 chars** (ingest stores title+link only); `geo_lat`: 0.
- **The substance lives behind source_url, and family determines extractability.** pg_net
  sampling: Multnomah = 31.5KB HTML with schema.org JSON-LD (headline=address,
  description=case+type+deadline) AND a labeled "Proposal:" paragraph — richest shape found.
  Utah PMN = 15.9KB structured HTML (already parsed ingest-side). Granicus AgendaViewer =
  agenda body inline in HTML. CivicClerk = 1.3KB SPA shell (real data is the OData API the
  ingest adapter already reads). CivicPlus/CivicWeb/Legistar/eScribe/iQM2 400'd or timed out
  FROM PG_NET — Rule-13 caveat: the ingest runner fetches these same sources successfully
  (that is where the rows came from), so the finding is "untested from here", NOT unfetchable;
  their documents are typically agenda PDFs.
- **Semantic gap is real and measured in the best case itself:** Multnomah T2-2026-0017's own
  "Proposal:" text ends *"No development is proposed at this time"* — under a land-use notice.
  A notice must never masquerade as a permit; vocabulary proposed in the report
  (notice_of_hearing / comment_window / notice_of_decision + verbatim-quote-only description,
  does_not_mean rendered on-page).
- **Overlap with the permit rail: 0 in both samples, for STRUCTURAL reasons** — Spokane's wired
  source is building permits while its notices are land-use cases (0 of 7,006 rows match the
  case numbers); Multnomah's notices are unincorporated-county cases while the wired source is
  City of Portland (0 address matches). Notices cover DIFFERENT records: complementary, not
  early-duplicate.
- **Dark-ZIP ceiling: title-borne extraction lights up ZERO of the 806 currently-dark ZIPs**
  (Multnomah/Spokane ZIPs already have content). Document-level extraction ceiling: **319 of
  806** dark ZIPs sit in counties with an active notice feed — reachable only via per-family
  document parsing whose yield is UNMEASURED.
- **Recommendation (stands until founder rules):** do not build a national layer on these
  numbers. Phase-0 first — measure agenda-ITEM yield on the two structured families
  (CivicClerk OData, Granicus agenda HTML) for planning bodies in ~2 counties each, on a
  runner; build only what that measurement licenses. Multnomah is wireable today as a bespoke
  high-quality source but lifts 0 dark ZIPs.

### 2026-08-15 — ✅ EXECUTED (founder-approved): bethelak cache purge + engine pagination fix (#736), both live-verified

**Purge:** pre-flight re-measured the population at exactly 26 (unchanged), then the one-time
provenance-scoped update ran: **UPDATE 26** (the stop condition — "anything other than 26" —
did not trigger). Verification, all green: bethelak provenance anywhere in the cache **0**;
granicus positive control **295 rows** (the query shape provably still sees sites); per-row
`counts.civic == remaining civic sites` mismatches **0**; 99551 counts now all-zero; 99559
kept its 10 legitimate sites (8 AKDOT&PF dev + 2 facilities). Transient-safe guard untouched.
SQL of record: `docs/bethelak-wrong-body-cache-purge.sql`.

**Pagination (#736, squash-merged `e4c96c1`, checks unit+verify+browser green, 105-file suite):**
deploy-edge-functions run 31905066054 success (fail-loud exclusion loader green on the same
run). **The receipt: 87513 re-cached through the live engine (pg_net request 157506, HTTP 200)
→ civic 100 → 101**, exactly the predicted number (101 qualifying alerts, 101 distinct URLs so
dedup collapses none). Live spot-check run 31905226787: **99551 tracker = "empty (honest,
map/coverage note)"** — the purge visible end-to-end on homesignal.net — and **87513 tracker =
"populated (101 sites)"** — the uncapped read visible live; dev-app honest coverage block on
both, 0 JS errors, retired-claim tripwire silent.

### 2026-08-15 — 🔴 FINDING: the app-content-refresh cron has been DEAD since 2026-08-09 (statement timeout, every run)

Found answering "will 87513 re-materialize on its own?" — the answer is **no, nothing will, for
any ZIP, until this is fixed.** The scheduled path exists: pg_cron job 13 `app-content-refresh`
(hourly at :40) runs `app_refresh_batch(1500)`, oldest-first over every modeled ZIP — a full
national sweep every ~9 hours when healthy. Measured: **last success 2026-08-09 11:40Z; every
hourly run since has FAILED on `canceling statement due to statement timeout`** (154 lifetime
failures, the tail unbroken since 08-09; contexts: `insert into app_projects`, `app_changes`,
`dev_sites_deduped`). Because `app_refresh_batch` is one plpgsql function = ONE transaction, a
timeout rolls back the WHOLE batch — each failing run materializes **zero** ZIPs while looking
like an attempt. Every `app_community_meta.updated_at` newer than 08-09 (2,355 rows) came from
session-driven explicit `app_refresh_zip` calls (the SC/KS/MN/NE rollouts), which is why the
breakage stayed invisible: on-demand worked, so the app surface kept moving where anyone was
looking. Consequence: app pages (maps.html / development.html / app_changes civic) are frozen at
their last touch for all ~10k untouched ZIPs. Fix direction (GATED, not built): the batch must
commit incrementally — a procedure with per-ZIP/per-chunk COMMIT, or a much smaller batch sized
to the statement timeout with the cron cadence raised to compensate. Not attempted without
approval: it is a production cron + function change.

**PROMOTED 2026-08-15 (founder): top-priority work item, PROPOSE-ONLY until the diagnosis is
reviewed. Diagnosis complete same day — all four scope points measured:**

**(a) What killed it: per-ZIP cost growth crossing a fixed 120s wall — content growth, not one
slow ZIP.** The DB-default `statement_timeout` is **120000ms** (the failures' 120s is exactly
that; `authenticator`/`anon` roles are 8s/3s — irrelevant here, pg_cron runs at DB default).
The batch's own duration curve walks straight into it: hourly runs averaged **13–20s**
(07-24→28) → **33s** (07-29) → **44–56s** (07-30→08-05) with maxima 99–116s (08-01→08-08) →
08-09 half the runs hit 120s → 08-10 onward **every run 120s-failed**. That growth window is
exactly the content expansion: Gold Master local news live 07-28 (7,168 alerts in 2 days, rows
in `app_changes` for every covered ZIP), the Government Notices national rollout (761 feeds by
08-12), and the Maps state passes growing `dev_sites` arrays. Per-ZIP cost measured today
(clock-timed through the real `app_refresh_zip`): light/empty ZIP **0.11–0.15s**, dense metro
**0.9s** (55407, 3,035 app rows) to **1.6s** (44127, 5,384 rows). At those costs a 1,500-ZIP
batch needs **~165s even if all-light and ~390s at the fleet mix** — the 1,500 batch size can
NEVER fit 120s again, and the curve says per-ZIP cost keeps rising with coverage. No single
poison ZIP: failure CONTEXTs rotate (`insert app_projects`, `app_changes`,
`dev_sites_deduped`, deletes) — the timeout lands wherever second 120 falls.

**(b) Proposed design — time-budgeted sweep procedure, per-ZIP COMMIT, fail-visible:**
a new `procedure app_refresh_sweep(_budget_secs int default 100)` replacing
`app_refresh_batch(1500)` in cron job 13, cadence `*/15 * * * *`. Per ZIP (oldest-first, same
candidate union): `BEGIN app_refresh_zip(zip); EXCEPTION WHEN OTHERS → log to
app_refresh_failures(zip, error, at) END; COMMIT;` then exit the loop when
`clock_timestamp() - t0 > _budget_secs`. Failure semantics, explicitly: **a failed ZIP is
committed as a failure ROW (visible), never re-raised (does not block subsequent ZIPs), and the
ZIP stays oldest-first-eligible so it retries next sweep**; completed ZIPs survive any later
kill because each committed. The 100s budget guarantees the CALL ends before the 120s wall
regardless of mix (worst single ZIP overshoot ~1.6s), so the sizing is time-based and immune to
further growth — throughput degrades gracefully instead of cliffing to zero. Capacity at
today's mix: ~380 ZIPs/run × 96 runs/day ≈ **36k ZIP-visits/day ≈ 2.8 full national sweeps** —
the same throughput the healthy 07-25-era job delivered.

**(c) The six-day silence is an instrument defect with a one-line cause:**
`pipeline_health_tick`'s `materializer` check alerts on `max(app_community_meta.updated_at)`
age > 6h — and MAX moves whenever ANY ZIP is touched, so the session-driven on-demand
refreshes kept it green while the sweep was dead (155 consecutive cron failures, zero alerts).
It measured "something was touched", not "the sweep is alive". Proposed: (1) change the
`materializer` check to **min-age** — alert when `min(updated_at) < now() - 48h` (the real
SLO: no ZIP older than ~5 sweep periods); (2) add a `materializer_cron` check that reads
`cron.job_run_details` for the sweep job and alerts on ≥3 consecutive failures, plus a row
count from `app_refresh_failures`. Both ride the EXISTING pipeline-health pg_cron+pg_net
alert path — no new mechanism.

**(d) Backfill: no special machinery.** Backlog measured 2026-08-15: **10,361 of 12,722**
metas older than the 08-09 sweep death (median age = 08-09). Oldest-first is already the
order, so the first ~7 hours of a healthy sweep IS the backfill (10,361 ÷ ~1,520/hr ≈ 7h;
call it 7–9h with heavy-ZIP variance). Notices-covered ZIPs like 87513 need no priority lane:
they're inside the same 7–9h window, and any specific ZIP can be kicked on demand today (the
mechanism sessions already use). ETA to fully caught up: **under half a day from the moment
the procedure ships.**

**APPROVED 2026-08-15 — diagnosis accepted, fix shipping as specified, with one founder
addition to the failure semantics: BOUNDED SKIP.** A repeatedly-failing ZIP must not anchor
oldest-first forever: after **N=5 consecutive failures** its `app_refresh_failures` row is
flagged `escalated` and the ZIP sorts to the BACK of the sweep queue (still retried when
budget reaches it; a success clears the row). Escalated count surfaces in the
`materializer_sweep` health detail, so one pathological ZIP degrades to an alert instead of
eating budget at the front of every sweep. Migration of record:
`docs/app-refresh-sweep-migration.sql`. Watch protocol: first 3 cron runs observed live
(expect ~380 ZIPs/run committed; stop and report on anything unexpected, no live tuning);
full-pass staleness curve reported after ~7–9h. NOTE: the `materializer` min-age check will be
correctly RED from the moment it ships until the backfill completes — that alert firing during
catch-up is the instrument working, not a defect.

**SHIPPED AND SWEEPING 2026-08-15 ~20:30Z.** PR #737 merged `c1586cb` (checks green); DB
applied as two migrations — `app_refresh_sweep` (ledger + procedure) and
`pipeline_health_materializer_min_age_and_sweep_pulse` (the exact-substring surgery; verified
after: min-age check in, `materializer_sweep` in, old max-age check gone) — then
`cron.alter_job(13, '*/15', 'call public.app_refresh_sweep();')` (verified in `cron.job`).
**First-runs watch (founder protocol), all within design:** runs at 20:30/20:45/21:00/21:15
all `succeeded` at **100/103/100/100s** — the budget doing exactly its job — committing
**879 / 105 / 1,194 / 1,023** ZIPs respectively (variance is per-ZIP cost: run 2 hit a heavy
pocket and throughput degraded gracefully instead of failing — the designed behavior).
`app_refresh_failures`: **0 rows, 0 escalated.** Backlog burn: 10,361 stale → **7,160** in the
first ~50 minutes; oldest meta advanced 08-09 03:40 → 06:40. Running ahead of the 7–9h
estimate (the oldest ZIPs are light); full-pass staleness curve to be reported when
`min(updated_at)` crosses into the sweep window.

**✅ BACKFILL COMPLETE 2026-08-15 (DB-verified 23:42Z; founder's independent check confirmed
first).** Before → after: stale ZIPs **10,361 → 0** of 12,722; `min(updated_at)` **08-09
03:40 → 08-15 21:30** (every ZIP touched within ~2h); median **08-09 09:40 → today**. Six days
of backlog cleared in **~2 hours, not the estimated 7–9** — the metro-slowdown inversion was
absorbed by the time budget without a single failure: **13/13 sweep runs succeeded,
`app_refresh_failures` 0 rows, 0 escalated** (the ledger and N=5 skip were never needed).
**The instrument-repair receipt:** `materializer` health check flipped red → green ON ITS OWN
(`ok=true`, transition logged 23:10Z, detail "oldest … 2.2h ago"); `materializer_sweep` green
since 21:10Z ("last 3 runs: succeeded,succeeded,succeeded"). **No downstream surge, by
construction and by measurement:** nothing in the delivery path reads `app_changes`/`app_projects`
(digest rides ingest-side `alerts`), materialization dispatches no Actions, and `email_deliveries`
shows **0 sends today and 0 yesterday** — the send path did not move. **Taos two-page divergence
closed in the direction that matters:** 87513 app-side civic **0 → 55**, so development.html's
gate counts are non-zero and the honest-empty block correctly yields to real notices. 55 ≠ the
tracker's 101 by DESIGN, not lag: `app_refresh_zip` applies its own windows/caps (measured in
its def: `limit 48`, `interval '2 years'`, `interval '14 days'`, …) while the tracker engine
reads all qualifying notices — the known cross-page definitional seam, not a defect. Arc
closed: wrong smoke-note attribution → 26 wrong-body cache rows purged → silent truncation
fixed (#736) → dead materializer diagnosed and replaced (#737); app-side freshness went from
six days of fiction to fully current in one session.

### 2026-08-15 — 🧹 SESSION-HYGIENE RULE: the orphaned-branch pattern (from the coverage-copy revival)

**What happened.** The approved coverage-copy build (honest empty-state on `development.html`,
decision 1, `zipFitRadius` untouched) was fully built and pushed on 2026-08-11 to
`claude/admiring-hawking-r8x2nl` — 7 files, 3 test suites, commit `4516897` — and then the session
ended. **No PR was ever opened**, the handoff described the work as "merged-pending on the branch",
and the approval's explicit condition (before/after renders of Bethel AK 99551 and Taos NM 87513
for founder review) was **dropped with the session**. The branch sat 36 commits behind while later
sessions, reading "merged-pending," believed the work was in flight. Found only because the founder
challenged a "zero occurrences of `HS.coverageCopy`" grep that had been run against `main` alone.

**The rule, in two halves:**
1. **A handoff that says "pending" must cite the PR number.** No PR number means NOT pending —
   it means un-opened, and the handoff must say "pushed to `<branch>`, NO PR opened yet" instead.
   "Merged-pending" with nothing to point at is how work goes invisible.
2. **Conditions attached to an approval travel with the WORK, not the session.** The
   before/afters were owed to the founder as a gate on the PR; the session ending does not
   discharge them. Any revival or continuation inherits the condition verbatim until the founder
   releases it.

**Revival status (this session, 2026-08-15):** branch rebased onto `main` (`57f0185`) —
conflict-free; the "EPA-revert test conflicts" concern turned out INVERTED (the branch carries no
tests `main` deleted; all main-side EPA-repair files survive the rebase untouched).
`lib/generated/county-sources.json` regenerated against the 198-entry registry via its own
generator (parity test green) — which changed Bethel's copy to name AKDOT&PF statewide with zero
copy edits, the self-clearing property demonstrated in the artifact itself. Full 104-file suite
green. The owed before/afters are COMMITTED at `docs/coverage-copy-before-after/` (4 renders from
real DB rows, both ZIPs verified all-empty on the three gate counts). **Stopped there per the
standing condition: no PR until the founder reviews them.**

**RESOLVED 2026-08-15 — the condition was discharged the right way round.** Founder reviewed and
approved the before/afters, then **PR #733** was opened (citing this history), checks green
(unit + browser), **squash-merged as `18c1409`**, Pages deploy green. Live smoke: the render
harness stubbed the fetch path, so the live empty-state load was verified on a GitHub runner via
`spot-check-shell.mjs`, extended additively to walk `development.html?zip=` as a third page type —
it classifies populated / honest-coverage-block / plain-fallback and flags the RETIRED "we check
continuously" claim as BROKEN if it ever reappears live (a permanent regression tripwire, not a
one-off probe). Smoke result recorded below this entry when the dispatch completed.

**LIVE SMOKE GREEN 2026-08-15 (run 31902656221, spot-check-shell @ `0b532ce`, ~19:00Z):**
`99551` → dev-app shell yes · **empty (honest coverage block)** · 0 JS errors; `87513` → same.
That is the REAL fetch path end-to-end on homesignal.net — live Supabase reads (anon key) for
community/projects/facilities/changes plus the Pages-served `lib/generated/county-sources.json` —
not the stubbed render harness. The retired claim did not appear (the checker flags it BROKEN on
sight, so its absence is asserted, not assumed). Note the tracker column on the same run reads
`populated (15 / 100 sites)` — that is `homesignalmap.html` reading `development_reports` (EPA
facilities floor), a different page and rail; no contradiction with the app page's empty state,
whose gate counts run against `app_projects`/`app_changes` (0/0/0 for both ZIPs, verified). The
coverage-copy arc is CLOSED: built 08-11 → stranded → revived → reviewed → #733 merged → live.

### 2026-08-15 — LIVE-METRIC EXCLUSION LIST COMPUTED, NOT TRANSCRIBED. View replaces the inline array.

**The 10-entry "incomplete registry" exclusion list that gates every Live-page count is now
COMPUTED from the registry JSON and served by one DB view.** It had been hand-maintained here and
restated inline in every query, with nothing enforcing it (self-flagged 2026-08-15; founder-directed
fix, propose-then-wire). **No registry entry changed; no metric definition changed** — verified
before wiring: the computed list matched the hand list EXACTLY, 10/10, zero difference in either
direction, at registry `76ef18a`.

**THE CRITERIA (canonical; prose here and `scripts/compute-incomplete-registry.mjs` must say the
same thing — the script alone holding the truth would recreate the single-copy problem):**

```
incomplete(e) ⇔  NOT hasUseType(e)  OR  NOT hasStatus(e, family)
hasUseType(e)        ⇔ 'type_map' ∈ e  OR  'use_type_const' ∈ e
hasStatus(e, family) ⇔ status_to_bucket has ≥1 mapped value
                       OR (family = 'socrata' AND 'status_const' ∈ e)
```

- Type half: without either field, `use_type` falls through to keyword guessing for the pin shape
  (`use_type` is the CLOSED six-value vocabulary, `lib/map.js::TYPE_EXACT`).
- Status half — **the socrata clause is load-bearing, and its omission was a real near-miss**: the
  old prose ("complete on both `type_map` and `status_to_bucket`") read naively adds
  `east-baton-rouge-` / `marin-county-` / `buffalo-` / `prince-georges-county-` building permits,
  whose all-empty `status_to_bucket` + `status_const` is socrata's SHIPPED IDIOM (the constant IS
  the bucket). An arcgis `status_const` is a raw value that must resolve through its map —
  `test/status-const-must-be-mapped.test.mjs` documents the asymmetry and now
  `test/registry-incomplete-entries.test.mjs` pins these criteria with self-tests (16 checks:
  stripped entry flagged, socrata-const passes, arcgis same-shape fails, the four real entries
  stay off the list). The line-662 prose above carries the dated correction.

**THE PLUMBING:** `scripts/compute-incomplete-registry.mjs` (the one computation; `--sql` emits a
single-transaction full replace) → loader step in `deploy-edge-functions.yml` runs it against the
exact JSON just deployed and writes `public.registry_incomplete_entries`
(`registry_id, reason, registry_sha256, computed_at`; RLS ON, public read, loader-only writes) →
**`public.v_incomplete_registry_entries`** is what everyone reads. DDL of record:
`docs/registry-incomplete-entries-migration.sql`. **The loader is FAIL-LOUD**: no
`continue-on-error`, `set -euo pipefail`, non-2xx/SQL error exits 1 — a deploy whose load fails
shows a RED run, never a silently stale list.

**THE LIVE-METRIC QUERY, from now on (inline id arrays are retired for this metric):**

```sql
with live as (
  select distinct p.zip from public.app_projects p
  where p.record_kind = 'development'
    and p.registry_id is not null
    and p.registry_id not in (select registry_id from public.v_incomplete_registry_entries)
)
select count(*) from live;  -- per-state: join communities on level='zip', state, zip_codes[1]
```

**FRESHNESS CHECK — run before trusting the view (a list nobody has verified is the hand list with
extra steps):**

```sql
select count(*) n, min(registry_sha256) sha, count(distinct registry_sha256) shas,
       max(computed_at) at
from public.registry_incomplete_entries;
```

`sha` must equal `git show origin/main:supabase/functions/get-address-report/jurisdiction-registry.json | sha256sum`
(deploys are byte-exact from repo source), `shas` must be 1, and **`n` = 0 is DO-NOT-USE, same
severity as a sha mismatch** (founder addition, 2026-08-15) — an empty or truncated table makes the
view silently OVERSTATE Live, so the guard that catches drift must also catch an unloaded table,
permanently, not just at activation. Any failure — wrong sha, `shas` > 1, or `n` = 0 — means:
dispatch `deploy-edge-functions` and re-check; never hand-patch the table, and never run Live
queries against the view until the check passes. (`n` was 10 at time of writing; the number may
legitimately change as registry entries are completed or added — the sha, not the count, is the
currency check.)

**KNOWN ASSUMPTION (recorded 2026-08-15):** the loader tracks the DEPLOYED REF — it computes
from whatever checkout the deploy ran on, so the list always matches the deployed registry. The
freshness compare-against-`main` therefore only holds while deploys come from `main` (the current
operating convention). If a branch deploy ever becomes normal practice, the freshness check needs
revisiting.

**SEQUENCING NOTE:** until the migration is applied AND the next deploy runs its loader, the table
is EMPTY and the view would silently overstate Live. The migration file says so and orders the
steps: apply SQL → dispatch deploy → verify freshness → only then switch queries to the view.

### 2026-08-15 — NEBRASKA WIRED (#728): 36 → 123/174 (70.7%). Statewide-DOT lever, 7th state.

**`ndot-program-book-segments`, arcgis 169 → 170, merged `76ef18a`, deployed (run 31891641193).
ROLLOUT COMPLETE: 123 / 174 live (70.7%), NDOT on 113 pages / 374 records.** Pre-wire control:
174 cached, **36 live**. National **8,535 → 8,622** of 12,722.

- **Invariants over all 374 materialized rows: 0 missing `source_ref`, 0 missing coordinates,
  0 missing title, 0 missing status**, single status `Proposed`, lat 40.59–41.89 / lng −99.49 to
  −95.91 — wholly inside Nebraska. **Gate proof, bidirectional:** `leaked = 0` cache-wide, and the
  pre-rollout control **51501 (Council Bluffs IA, Pottawattamie) returned 0 NDOT** while keeping its
  own 13 — a page directly across the Missouri River from Omaha, which itself took 7.
- 🆕🚨 **STANDING ANSWER — `ndot.maps.arcgis.com` IS **NEVADA**, NOT NEBRASKA. CONFIRM THE ORG NAME,
  NEVER THE ACRONYM.** It returns a LIVE, PUBLIC, correctly-configured org: id `9Y4hSlLf13E9S0Eo`,
  name `Nevada Department of Transportation`, urlKey `NDOT` — and Nevada is ALREADY WIRED here as
  `nvdot-project-boundaries`. The `_ndor` owner suffix is **also Nevada** (`jsekanovich_ndor` =
  Nevada Division of Outdoor Recreation). Nebraska's own NDOR account (`munn_ndor`, Nebraska Dept of
  Roads, the pre-2017 name) holds 4 Grant-Portal items from 2024-10-03 — not projects.
  **Wiring from either would have published Nevada roadwork on Nebraska pages with clean invariants,
  a plausible count, and coordinates ~1,200 miles wrong — nothing downstream catches that.** Same
  class as the Michigan recon's `Kent` hits resolving to DE/RI, but with a live public org behind it.
- 🆕 **SIXTH CONSECUTIVE STATE WHERE THE SERVER PATH WAS THE BLOCKER — eight dead ends first:**
  `nebraskadot.maps.arcgis.com` nonexistent (all-null, no urlKey) · `maps.dot.nebraska.gov` DNS-dead ·
  `gis.ne.gov/portal` HTTP 500 'Application Error' · `gis.ne.gov/arcgis` 404 ·
  `dot-nebraska.opendata.arcgis.com` no such domain. The live path is **`gis.ne.gov/dot/rest/services/`**,
  reached by resolving `nebraska.maps.arcgis.com` → org **`State of Nebraska`** (`Sj9eBhzWwOMzQCfI`,
  PUBLIC), orgid-scoped search → `ProgramBook_NDOT`, then reading the item's own `url` field.
- ⚠️ **THIS IS THE HOUSTON-PLAT CASE, NOT THE MINNESOTA CASE — AND THEY LOOK IDENTICAL FROM THE
  OUTSIDE.** One service, two layers, identical field sets: `0` Program Book Points (337, point) and
  `1` Program Book Segments (558, polyline). Measured live by pulling EVERY `ProjectNo` from both and
  comparing: Points 130 distinct, Segments 437 distinct, **28 `ProjectNo` values in BOTH**. Not
  disjoint → wiring both would double-emit those 28 on every page, uncatchable by exact-identity
  dedup across two `source_registry_id`s. **Only the segment layer is wired.**
  **ACCEPTED COST, STATED PLAINLY: the 102 `ProjectNo` values unique to the POINTS layer are NOT
  represented.** The obvious fix — an `extra_where` excluding the 28 shared numbers — was REJECTED
  because it means hand-transcribing a 28-item list into config (the founder rule against
  transcribing rather than computing a list). Contrast `mndot-stip/chip-roadway-projects` the day
  before, where `groupBy Fiscal_Yea` proved a TRUE partition and two entries were safe.
  **Identical schemas prove nothing either way — run the id-overlap test.**
- **`status_const: "Programmed"` → `proposed`, deliberately the CONSERVATIVE direction.** No status
  column exists. `ProgramYear` is `2027` (87 segments / 76 points) and `2028-2032` (261 points;
  76+261 = 337 exactly), so the large majority is future-year programming — mapping the register to
  `approved` would overstate NDOT's commitment. `proposed` understates at worst. The constant
  describes the record rather than restating a bucket (the ratchet that caught the Minnesota draft).
- **No `file_date`:** `ProgramYear` is a STRING whose second value is the RANGE `"2028-2032"` — not a
  date, not even a single year. Never fabricated into one; `recency_days` absent for the same reason.
- **Column population verified on the WIRED layer before mapping:** `ProjectName` NULL → 0,
  `ProjectNo` NULL → 0, `Hwy` NULL → 0. Real rows: `Giltner East` / NH-80-7(176) / Hamilton /
  `Crack Seal`; `I-480, 20th-12th Bridge Painting, Omaha`; `O Street to Saunders Ave, Lincoln`.
  Every string column is heavily RIGHT-PADDED upstream; the connector trims both sides
  (harris-county-plats precedent). `address` maps `Hwy` ALONE — column_map arrays JOIN, never fall back.
- **51 ZIPs did not land** — the FRS facilities-guard class, not an NDOT problem. Batch yields ran
  23 → 10 → 17 → 15 → 12 → 16 → 15 → 14 → 15; they stay on the `refreshed_at` cursor and the 15-min
  cron sweeps them.

### 2026-08-14 — 🚫 OREGON REJECTED. No wireable statewide source. OR stays 52/200 (148 dark).

**The Florida outcome: recon found real candidates and LIVE PROBING rejected every one.** Recorded
with receipts so no session re-derives this. **Nothing was wired; no registry change.**

- **`2024_2027_STIP_Project_Lines`** (owner `OregonDOTGIS`, modified 2026-04-08, the one current
  STIP layer) — **REJECTED on two independent grounds.**
  - **Only 109 rows.** Density is what predicts coverage: INDOT 3,966 → 96%, SCDOT 3,958 → 89%,
    UDOT 358 → 35%. 109 statewide cannot carry 148 dark pages.
  - **`ListStatus` IS NOT A STATUS — second instance of the SC standing answer.** Live groupBy,
    summing to exactly 109: `" "` 25 (blank) · `300` 20 · `Scoping - Full Scoping` 13 · `Low` 11 ·
    `150` 10 · `Drop - from Scoping List` 7 · `High` 4 · `A` 4 · `B` 4 · `100` 3 · `Medium` 3 ·
    `No scoping - Already in design (PE)` 2 · `Scoping - Update Prior scoping/estimate` 2 ·
    `No scoping - Shelf project (PE only)` 1. That is blanks + numeric priority scores + letter
    grades + priority labels + scoping actions in ONE column — opaque-coded values, barred by the
    autonomy grant. **A `status_const` workaround is ALSO wrong here**: 7 rows are
    `Drop - from Scoping List`, so a constant would publish dropped projects as approved.
  - **Not actually statewide.** `Program` (sums to exactly 109): ARTS 45 · Pres 27 · SSPF 19 ·
    **`R1 Pres` 9** · Culverts 5 · Ops 4 — Region-1-weighted, and ARTS/SSPF are opaque acronyms.
- **`ODOT_Traffic_Construction` / `TripCheck_Construction_Data_Upload`** — **22,868 rows, FRESH
  (`lastEditDate` 2026-08-13), and still REJECTED: it is an EVENT feed, not a project layer.**
  Fields are `incidentId`, `eventTypeName`, `eventSubTypeName`, `odotSeverityDescript`,
  `delayInfo`, `incidentDirection`, `startTime`, `tocsEventId` — transient closures and delays.
  The `development` bucket is "permits, construction filings, planning notices"; every wired DOT
  entry (UDOT/NDOT/TxDOT/SCDOT) is a PROJECT layer. **Volume is not relevance — 22,868 road-closure
  advisories on resident pages would misrepresent what the page claims.**
- **Stale, all rejected on `modified`:** `ODOT_Region1_100_Percent_Projects` 2019-05-31 ·
  `ODOT_Region1_150_Percent_ARTS_CityWide` 2019-03-22 · `ODOT_Region1_Ops_150_Percent_CountyWide`
  2018-09-07 · `ODOT_Region1_ARTS` 2018-07-03 · `Region_1_DRAFT_21_24_STIP_Projects_v2` 2021-01-12.
- **Dead ends:** `gis-odot.opendata.arcgis.com` → 404 "domain record does not exist" ·
  `gis.odot.state.or.us/arcgis` → HTTP 500 Runtime Error · `/hosting` → 404 ·
  `navigator.state.or.us` `Projects` folder → imagery basemap + enterprise zones only.
- 🆕 **STANDING ANSWER — search the OFFICIAL owner account, not the visible one.** Every ODOT layer
  surfaced by the obvious searches belongs to `daniel.warren_ODOT` (all stale, Region 1). The STIP
  layer belongs to **`OregonDOTGIS`** (263 items) and appears in NEITHER a `daniel.warren_ODOT`
  owner search NOR a plain `ODOT` org search. Enumerate owners before concluding a DOT has nothing.
- 🆕 **The org taxonomy held a 3rd and 4th time.** `odot.maps.arcgis.com` → id/name/urlKey ALL null
  = **nonexistent** (Michigan decoy). `geo.maps.arcgis.com` → `Oregon ArcGIS Online`,
  `uUvqNMGPm7axC2dD`, `access: public` = the real org. `kdot.maps.arcgis.com` → `urlKey: "KDOT"`,
  `access: private` = **private** (INDOT class). Three distinct outcomes, three distinct meanings.

### 2026-08-14 — KANSAS RECON OPEN (141 dark, 30.2%, no statewide source). Next target.

- `kdot.maps.arcgis.com` is a **PRIVATE** org (`urlKey: "KDOT"`) — no anonymous `orgid:` search.
- `gis.ksdot.gov` → **"Couldn't resolve host name"** (DNS dead).
- The real owner account is **`KanDOT`** (695 items, e.g. "KDOT reference post markers" modified
  2025-08-22). Per the Oregon standing answer above, work the owner account. **Not yet resolved.**

### 2026-08-14 — SOUTH CAROLINA WIRED (#709): 30 → 171/192 (89.1%). Statewide-DOT lever, 4th state.

**`scdot-project-viewer-lines`, arcgis 165 → 166, merged `f41a63b`, deployed (run 31808271280).
ROLLOUT COMPLETE: 171 / 192 live (89.1%), SCDOT on 170 pages / 3,529 records.** Pre-wire control:
192 cached, **30 live**. National **8,187 → 8,328** of 12,722.

- **Invariants over all 3,529 materialized rows: 0 missing `source_ref`, 0 missing coordinates,
  0 missing title, 0 missing status, exactly 2 statuses** (`Approved`, `Proposed`), lat
  32.384–35.175 / lng −82.555 to −78.619 — wholly inside SC. **Gate proof, bidirectional:**
  `scdot_leaked_outside_sc = 0` cache-wide, and the pre-rollout NC control (28202, Mecklenburg)
  returned **0** SCDOT records while still serving its own 1,251 Charlotte-sourced sites.
- **Vocabularies enumerated live, each summing EXACTLY to the layer count (3,958):** `projectact`
  = Construction 1,892 + Design/Development 1,823 + Pre-Award 243; `projecttyp` = 29
  self-describing values. 0 unclassified.
- **No `file_date` — deliberate, not an omission.** `dateofcurr` is the literal string
  `"Currently Undetermined"`; `con_year`/`row_year` contain `0`. 18 of 192 pre-existing entries
  already omit it, incl. four other state DOTs.
- 🆕 **THIRD CONSECUTIVE STATE WHERE THE SERVER PATH WAS THE BLOCKER, NOT THE ORG.** SCDOT lives at
  `gis.scdot.org/hosting/rest/services/`, not `/arcgis/`; both host guesses 404'd and the real
  server was recovered by walking a live web map's `operationalLayers` (the Frisco pattern).
  INDOT was `/ro/`, MoDOT's hosts were DNS-dead. **Walk a web map before writing off a DOT.**
- 🆕 **STANDING ANSWER — a column named `status*` is not necessarily a status.**
  `PavementList2027_commission` (429 rows) has `status1` = `""` ×426 and
  `"Event Located.  Event distance is out of range and has been truncated."` ×3 — an LRS
  geocoding diagnostic. Rejected. Also rejected with counts: `Announced_Projects_Job_Numbers`
  (517, economic-development announcements, not roads), `AllProjects`/`existingprojects` (68,
  interstate-only), `2014_Present_InterstateProjects` (17), `ProjectTracking` (0 rows).
- 📌 **OPEN FOLLOW-UP — `Project_Viewer_Points` (layer 0, 960 rows, identical schema) deliberately
  NOT wired.** Prove `projectid` disjointness from Lines first; wiring both without that check is
  the Houston-plat double-emit class, where one real project is counted twice on every page.
- ⚠️ **21 of 192 SC ZIPs did not land, and the cause is the FRS ceiling, not SCDOT.** When FRS
  returns `facilities: 0`, `dev_refresh_collect`'s facilities guard refuses the WHOLE response and
  discards the real SCDOT records with it. Measured directly: a 35-ZIP batch produced 59 SC
  responses, **all 59 with development > 0 (4,045 records), 12 refused by that guard**; batches of
  25 held ~80-92%. They stay on the `refreshed_at` cursor and the hourly cron sweeps them.
- ⚠️ **METHOD ERROR TO NOT REPEAT — never call `dev_refresh_collect()` and count in the SAME
  statement.** The scalar subquery reads the pre-collect snapshot, so every batch reported one
  behind and looked like a stall. Measure in a separate statement.
- ⚠️ **AND: a background `sleep` does NOT block the next tool call.** Polling straight through
  five of them produced a fabricated "15 minutes elapsed, CI is hung" reading when the DB clock
  said 1m53s. **Read the clock before calling anything hung** — third occurrence this session.

### 2026-08-13 — DENVER 80249 WAS DELETED BY SOMETHING OTHER THAN CLAUDE. RULING REVERTED TO 12,722.

**The count is 12,722 again and Rule #0b is restored verbatim** (ingest repo; the brief 12,723
amendment is reverted, founder instruction). **Nothing here reopens the ruling — it now matches
the data.** What follows is the episode, so no future session re-derives it.

- **Measured 2026-08-13, late session:** `level=zip` rows **12,723 → 12,722** · the
  `Denver (80249)` community row (`ac55f889-b265-4a1f-afee-7ffdd289ffd9`) **gone** · rows claiming
  ZIP 80249 **0** · its `development_reports` row **gone** · CO ZIP rows **141 → 140** · all
  community rows **13,293 → 13,292**.
- ⚠️ **CLAUDE DID NOT DELETE IT, AND STILL CANNOT ACCOUNT FOR WHO DID.** The only statements run
  against that row this session were: `UPDATE state → 'CO'`, `ALTER TABLE ADD CONSTRAINT`, four
  constraint probes (three rejected by the CHECK, one setting `'CO'`), an `INSERT` into
  `development_reports`, and `app_refresh_zip('80249')`. None deletes rows, and a CHECK constraint
  cannot delete. **UNVERIFIED: whether this was a founder action, another session, or a job.**
- **It was ISOLATED, not a cascade** — checked before concluding: Denver County's parent row is
  intact, `county_rows` = 549, and exactly **1** orphaned ZIP exists system-wide.
- 🧹 **OPEN, NOT ACTIONED: 199 orphaned `app_projects` rows for ZIP 80249** remain, for a page with
  no community row and no cache row. They are unreachable (`?zip=80249` no longer resolves) but
  they are stale. Deleting them is destructive and was NOT done unasked.
- 📌 **The durable lessons from this row survive its deletion and are still in force:** the
  off-seed-path hand-insert caused three separate defects at once (count drift · `state='Colorado'`
  excluding it from every CO source · no cached report), and the
  **`communities_state_two_letter` VALIDATED constraint** added because of it stays
  (`docs/communities-state-format-migration.sql`). **Add pages only through the per-state seed
  path** — a hand-insert sets neither the state code nor the cache row.
- ⚠️ **Standing lesson about the source of truth itself: `public.communities` changed underneath
  an active session.** If a count you measured earlier stops matching, re-measure before building
  on it — do not assume your own earlier reading still holds.


### 2026-08-13 — THE LEVER IS STATEWIDE DOT SOURCES. INDIANA WIRED (#694): 2 → 190/198.

**The measurement that should drive state selection from here** (on `app_projects`, excluding the
10 incomplete registry entries): states **with** a statewide DOT source run **79.1% live**
(6,288/7,945); states with **county-only** sources run **36.2%** (1,675/4,623); ND runs 0% and is a
documented rejection. That 43-point split is the largest available lever. The 0079 workbook
predicted 78.0 vs 31.7 from a smaller sample; OK landed 78.2%, NH 83.8%, IN 96.0%.

- **`indot-spms-active-projects`, arcgis 163 → 164, merged `30feb9d7`, deployed (run
  31740761922). ROLLOUT COMPLETE: 190 / 198 live (96.0%), 2,399 records.** Pre-wire control:
  198 cached, **2 live**. National **7,963 → 8,151** of 12,723.
- **Invariants over all 2,399 records: 0 missing `record_url`, 0 missing coordinates, 0 records on
  a non-Indiana page, exactly 2 statuses** (`Proposed`, `Approved`) — precisely what the 3-value
  vocabulary predicts. Gate proof: 60601 (Chicago) fetched only `cook-county-*` / `idot-*`.
- ⚠️ **BOTH OBVIOUS COLUMNS WERE UNUSABLE — check the siblings before rejecting a DOT layer.**
  `PHASE` is the single opaque letter `'A'` on all 3,966 rows; `WORKCAT` is opaque numeric codes
  (912, 962, 931, 943, 210 … plus TMS/LTAP/DTP). Either would have been an opaque-coded value (the
  San Jose `planningpermits30` rejection class). The usable columns are **`PROGRESS`** (Plan 3,288
  + Const 599 + Let 79 = **exactly 3,966**) and **`WORKDESC`** (133 self-describing values, also
  exactly 3,966). **This is the SECOND time in one session** the first-choice column was wrong and
  a sibling was right — RI's `Status` vs `StatusAdmin` was the first. Enumerate every candidate
  column before writing a source off.
- 🆕 **STANDING ANSWER — a private AGO org is NOT the generic-portal decoy.** `indot.maps.arcgis.com`
  and `in.maps.arcgis.com` return `access: private` with **null id, empty name, but a populated
  `urlKey`**. The Michigan decoy (a nonexistent org) returns **no `urlKey` at all**. Both close off
  anonymous `orgid:` search, but they are different findings and only one means "no such org".
- 🆕 **The server path was `/ro/`, not `/arcgis/`** — `gis.indot.in.gov/arcgis/rest/services` 404s.
  Recovered by walking an unscoped AGO search result (the Frisco pattern). Most AGO hits for "INDOT
  projects" are **consultant copies** (HNTB `rD2ylXRs80UroD90`, Corradino `zkfscBHttPaQwR4x`) and
  were rejected on the first-party rule.
- 📌 **Register DENSITY predicts coverage better than state size.** INDOT publishes 3,966 projects
  across all 92 counties → 96%. UDOT publishes 358 → UT sits at 35.2% despite having a statewide
  entry. When choosing the next state, check the row count and county spread first.
- 🔁 **The FRS-guard discard recurred exactly as documented** — 38, then 19, then 8 ZIPs returned
  HTTP 200 carrying real records with `facilities: 0`, so the whole response was refused. Re-firing
  the same ZIPs into a clear queue recovered them each round. **Do not fire a tail into a full
  queue**; nothing about the source changes.
- ⚠️ **Check `now()` before calling a queue stalled.** Twice this rollout "no responses yet" was
  read as a fault when only 1–2 minutes had elapsed — the MCP round-trip is much faster than the
  wait timers. The DB clock is the instrument; "not yet processed" and "failed" are different states.
- **NEXT, by dark pages among the 24 county-only states:** MO 176 · SC 162 · OR 148 · KS 141 ·
  MN 140 · NE 138 · NM 134 · AR 132 · LA 127. ⚠️ **CA is the biggest single prize (360 dark) but
  Caltrans is a documented edge-runtime blocker** — not a straightforward wire.
- **Honest ceiling, so nobody plans against a wrong target:** a perfect statewide-DOT sweep of all
  24 county-only states projects to **≈ +1,982 pages (~9,945 total, 78%)**, NOT 12,723. Rural ZIPs
  genuinely have no project within the 3-mile radius. Past ~10,000 needs a NEW source class or a
  radius change (gated — it alters what residents see). Honest-empty remains a correct terminal state.


### 2026-08-13 — DECLINED: adding `CLAUDE.md` to a path filter in the INGEST repo. Do not re-propose.

Claude proposed adding root-level `CLAUDE.md` to a workflow path filter in `homesignal-ingest`
so a check would run on changes to it, reasoning from the site repo's precedent. **Founder
ruled: leave it.** Recorded here because Claude proposed it wrongly and would otherwise
propose it again.

- **Why it was wrong.** `homesignal-ingest/.github/workflows/test-local-news-resolver.yml`
  already carries an explicit ruling in its own header comment: *"PATH-FILTERED ON PURPOSE
  (audit finding D-9). A docs-only commit does not run this workflow, so `main` can legitimately
  have a HEAD commit with no test run against it — that is intended, not a gap. … **Do NOT widen
  it to `**` to make HEAD always show a check: that trades a meaningful signal for a cosmetic
  one.**"* The proposal was the exact move that comment forbids.
- **It would also have been an empty check.** That workflow runs the local-news resolver suite,
  which tests nothing about `CLAUDE.md`. A green result would be success-shaped output attesting
  to nothing — the failure mode both repos' claims-discipline sections exist to prevent.
- ⚠️ **THE TWO REPOS ARE NOT ANALOGOUS — this is the error to avoid repeating.** In the SITE
  repo, branch protection **requires** the `unit` check on every PR, so a `CLAUDE.md`-only PR
  could never register it and **could never merge**; adding the path unblocked a real deadlock
  (that is what `CLAUDE.md`'s "Unblocking exception" describes). The INGEST repo has **no such
  requirement** — PR #318 was `CLAUDE.md`-only, reported `mergeable_state: clean`, ran **zero
  checks**, and merged without incident. There was no blockage to remove. **Do not carry a
  site-repo precedent into the ingest repo without checking whether the precondition holds.**
- **If a check on that file is ever wanted, the honest version is a doc-lint that asserts
  something real** — e.g. no struck-through line in the `SETTLED` list without an `AMENDED
  <date>` marker, or no edit to a dated measurement without its date changing. Offered and NOT
  built (new workflow + script; founder said leave it). It would have caught nothing on
  2026-08-13 — that amendment satisfies both rules.
- 📌 **Related and still true:** #318 merged with **zero checks, not green checks**. "No check
  failed" and "a check passed" are different claims; only the first is available for a doc-only
  change in that repo. Say which you mean.


### 2026-08-13 — ZERO-STATE LIST RE-MEASURED. ND IS THE ONLY ONE LEFT. ONE TYPO WAS STRANDING A LIVE PAGE.

**Measured on `app_projects`, excluding the 10 incomplete registry entries (the same definition
0078-0080 used): 7,963 of 12,723 ZIP pages live. Exactly ONE state is at zero — ND (155 pages),
and ND is a documented REJECTION (no NDDOT project register exists), not a to-do.** Re-measure
this; do not quote it from memory. The zero-state block has now been wrong three times: AK and HI
were never at zero, RI was listed as "the last zero state" while it was being wired, and the run
below turned up a second entry that was not a state at all.

- 🐛 **`Denver (80249)` carried `state = 'Colorado'` — the ONLY one of 12,723 `level=zip`
  community rows not using the two-letter code.** It surfaced as a phantom one-ZIP "state" with
  0% coverage in the zero-state query. Consequence was real, not cosmetic: coverage gates and the
  state seed scripts both key on `communities.state`, so `'Colorado' != 'CO'` excluded the page
  from every Colorado source AND from the seed that would have cached it — **it had no
  `development_reports` row at all**, while neighbours 80239 / 80247 carried 350 / 266 records.
  One live Denver page sat permanently on the facilities floor for a typo.
  - Fixed by migration **`fix_denver_80249_state_code`** (idempotent — guarded on id, old value,
    `level` and `zip_codes`, so a re-run is a no-op). After: **0 rows with a non-two-letter
    state**, CO ZIP rows 140 → 141.
  - Centroid read from the pinned **`zipcodes` PyPI v3.0.0** (`80249 → 39.7783, -104.7557, Denver,
    Denver County, CO`), never guessed; it agrees with the community row's own county. Seeded the
    missing `development_reports` row with it and refreshed.
  - **Verified after:** 80249 now carries **199 development records from BOTH Denver sources**
    (`denver-commercial-construction-permits`, `denver-residential-construction-permits`),
    facilities 40, 239 sites, **0 missing `record_url`, 0 missing coordinates** — in range with
    80239 (350) and 80247 (266). Nothing about the sources changed; only the string they compare
    against. That is the proof the gate was the blocker.
  - ✅ **CONSTRAINT ADDED — `communities_state_two_letter`, VALIDATED** (founder-approved;
    migration `communities_state_two_letter_check`, DDL of record
    `docs/communities-state-format-migration.sql`).
    `check (state is not null and state ~ '^[A-Z]{2}$')`. All 13,293 rows across every level
    already matched, so it went on VALIDATED, not NOT VALID.
    - **`state is not null` is LOAD-BEARING.** SQL three-valued logic makes the regex evaluate
      to NULL for a NULL state, NULL is not `false`, and **a CHECK ACCEPTS NULL** — so a bare
      `check (state ~ ...)` would have let NULL through, and a NULL state strands a page in
      exactly the same way `'Colorado'` did (neither equals `'CO'`). Same trap the ingest repo
      recorded on `meetings_category_canonical_utah`. Do not "simplify" that clause away.
    - **Probed live, all four cases, errors observed rather than inferred** (the RAISE NOTICE
      version of this probe returned no visible output through MCP — a constraint nobody has
      tried to violate is not evidence of anything, so each was re-run as a bare statement):
      `'Colorado'` → **23514 REJECTED** · `NULL` → **23514 REJECTED** · `'co'` → **23514
      REJECTED** · `'CO'` → **ACCEPTED**. Row restored to `CO`, 13,293 / 13,293 conforming.
- ⚖️ **SUPERSEDED LATER THE SAME DAY — 80249 IS REMOVED AND THE COUNT IS 12,722.** The
  founder issued a later ruling that reverses the "keep it" decision recorded below. Verbatim
  scope: *"Resolve ZIP 80249 as an unauthorized production-registry drift. Do not add it to
  the Gold Master simply because the production row exists… The Gold Master registry is the
  source of truth for which ZIP pages exist. Production must not create or expand the ZIP
  universe independently."* **Quote 12,722, not 12,723.** The block below is kept for the
  record; its measurements were right and its conclusion was overruled.
  - **What the earlier pass got wrong is the ORDER OF AUTHORITY, not the arithmetic.** Both
    passes measured the same thing correctly. The first concluded the *number* should follow
    production; the founder ruled the opposite — the *registry* is authoritative and production
    conforms to it. **A page appearing in the DB is never evidence that it should exist.** That
    inversion is the whole lesson, and it is why "12,722 is a founder RULING, not a statistic"
    (recorded below) pointed the right way and was then not followed.
  - **Root cause, traced to the statement — do not re-investigate.** The DB carries no actor,
    so the earlier pass recorded the origin as "UNVERIFIED and not knowable from here." It is
    knowable: `supabase_migrations.schema_migrations` version **`20260811133957`**
    (`evidence_phase6_evidence_only_zip_routing`) contains a hardcoded
    `insert into public.communities … 'Denver (80249)' … 'denver-80249-co'`, applied at
    **13:39:57** — the row's `created_at` to the second. Forensic corroboration: it is a
    singleton insert alone on its day (every other creation event is a batch of 18–11,791),
    and it carries the **county `-co` slug convention on a zip-level row** while all 25 sibling
    Denver ZIP pages use `denver-802xx` from one 2026-07-04 batch.
  - **`fix_denver_80249_state_code` is what PUBLISHED it.** The state typo was not an unrelated
    defect — it was the only thing keeping the drift row out of the CO coverage gates.
    Normalising it to `CO` at 17:50:41 let the materializer publish the page (`indexable=true`,
    17:51:51) and the maps cache fill it (239 sites, 17:51:19). Fixing a symptom on the
    assumption the row was legitimate is what turned an inert row into a live indexable page.
  - **Removed 2026-08-13** from `communities`, `app_community_meta` and `development_reports`,
    with all three rows archived first into `public.registry_drift_audit`. Dependents were ZERO
    before removal (subscriptions, alerts, meetings, children, email_events, projects,
    self_reports, social_posts, users); `sitemap.xml` never contained it.
  - **Diff proven by fingerprint, not assumption:** production was Gold Master ∪ {80249}
    exactly — md5(GM)=`af48c604…` (12,722), md5(GM+80249)=`d8416a1e…`, which equalled all three
    surfaces. After removal all four sets (registry + three surfaces) are 12,722 / `af48c604…`
    with 0 production-only and 0 registry-only ZIPs.
  - 🔒 **The hole is closed in the DATABASE** — see `docs/canonical-zip-registry-guard.sql`.
    The drift arrived through a MIGRATION, so a guard in site JS, an edge function or a seed
    script could never have caught it; the DB is the only choke point that sees migrations,
    RPCs, the REST API and manual SQL alike. `public.canonical_zip_registry` (seeded only when
    the live set matches the Gold Master md5) + `enforce_canonical_zip()` triggers on all three
    surfaces, **failing closed** — an empty registry rejects every ZIP rather than allowing
    every ZIP. The guard covers **every level's `zip_codes`**, not just `level='zip'`, because
    `?zip=` resolves via `zip_codes @> [zip]`, so a ZIP in a county row's array is routable with
    no ZIP page at all. Regression test `public.canonical_zip_guard_selftest()` +
    `scripts/verify-zip-universe.mjs` (daily CI).
  - ⚠️ **The "add pages through the per-state seed path" lesson below is necessary but NOT
    sufficient** — it would have produced a well-formed row with a valid state code and a cached
    report, and the universe would still have grown by one, silently. The registry check is the
    part that actually binds.
- ~~✅ **RULED 2026-08-13 — FOUNDER SAID KEEP IT. The fixed count is now 12,723.**~~ **(REVERSED
  — see the superseding ruling directly above.)** Rule #0b in
  `homesignal-ingest/CLAUDE.md` was amended in the same session: the old line is struck through,
  the new count recorded, the 80249 exception named, and the "count is FIXED / pages are not
  created" half explicitly retained. **The DATED measurements elsewhere in that file
  (12,722/12,722 on 2026-07-30, etc.) were deliberately NOT rewritten** — they were true on
  their date and editing a receipt to match a later number falsifies it.
  Original finding, kept for the record:
  Measured: `level=zip` rows created **before 2026-08-11 = exactly 12,722**; rows created on or
  after = **exactly 1** — `Denver (80249)`, slug `denver-80249-co`, `created_at`
  **2026-08-11 13:39:57**. No other row claims 80249, so it is a genuine addition, not a
  duplicate. **Neither figure was ever wrong: 12,722 was correct when written and became 12,723
  on 2026-08-11.**
  - The ingest repo's `CLAUDE.md` Rule #0b lists under **"SETTLED — do not reopen"**:
    *"12,722 ZIP pages, fixed. No page is ever created."* That number is a **founder ruling, not
    a statistic**. Editing the docs to 12,723 would launder a departure from the ruling into a
    documentation fix and quietly ratify page creation as normal. **Do not do that.**
  - **It is the SAME row as the state typo above.** One off-path insert produced all three
    symptoms — the count drift, `state='Colorado'`, and the absent `development_reports` row —
    exactly what a row created outside the per-state seed path looks like (that path sets the
    two-letter code and caches the ZIP). The DB carries no actor, so who added it and why is
    **UNVERIFIED and not knowable from here**.
  - **RULED: keep the row; the ruling's number moved to 12,723** (option a of the two that were
    put to the founder). Rule #0b amended accordingly.
  - **Quote 12,723 from here on.** A pre-2026-08-13 document saying 12,722 is not wrong and does
    not need correcting — check whether it is a RULING (amend) or a dated MEASUREMENT (leave it).
  - 📌 **The real lesson is the insert path, not the number.** 80249 was hand-inserted rather than
    seeded, and that single shortcut produced three separate defects (count drift, malformed
    `state`, no cached report). **Add pages through the per-state seed path** — it sets the
    two-letter code and writes the `development_reports` row; a hand-insert does neither.

### 2026-08-13 — RHODE ISLAND WIRED AND FULLY ROLLED OUT (#689). WV ROLLOUT FINISHED.

**RI — `ridot-rhode-restore-projects`, registry 162 → 163 arcgis entries, merged `95abd63`,
deployed (run 31721009891). ROLLOUT COMPLETE: 81 / 81 ZIP pages LIVE (100%), 4,512 records.**
Pre-wire control measured on `app_projects` before the deploy: **81 cached, 0 live** — RI carried
no development record from any source. Source is RIDOT's own RHODE RESTORE (Municipal Roads &
Bridges Fund) projects-as-points layer, `MRBF_Projects/FeatureServer/0`, 1,380 point rows,
`lastEditDate` 2026-07-31.

- **Org identity, and two decoys.** `ridot.maps.arcgis.com/sharing/rest/portals/self` →
  `id JfTJE9T2RFfUZzVx`, `name "Rhode Island Department of Transportation"`, `urlKey RIDOT`.
  `rigis` and `ridemo` both returned **HTTP 200 with `id: null`, `name: null`** — the generic
  anonymous portal, per the Michigan standing answer. The org holds 107 services; 105 are
  per-project tile packages (`SPL_*`/`PL_*`/`PLAT_*`), sweeping routes, condition layers and
  survey123 forms. Two cross-state training leftovers sit in the org and were ignored
  ("Environmental Equity in Allegheny County", "DC Embassies"). MRBF is the only register.
- **Status vocabulary complete, with a positive control.** `groupBy StatusAdmin` → `Approved`
  = **1,380**, summing exactly to the layer count. 0 unclassified; the other three buckets are
  declared empty so the lookup fails closed. The separate `Status` column is the APPLICATION
  state (`Submitted` 1,379 + `Draft` 1 = 1,380, also exact) — bucketing on it would have
  rendered 1,379 awarded projects as "proposed".
- ⚠️ **KNOWN LIMIT, recorded not papered over.** `TotalProjectPercentComplete` groups as
  100 → 876, 0 → 397, 5/90/99 → 17 each, 50 → 6, 75 → 5, null → 13. So **876 of 1,380 are
  physically COMPLETE** and would ideally read `operating`. The layer publishes no string
  vocabulary separating complete from underway — the only discriminator is a numeric percent,
  and `"100"`/`"0"` in `status_to_bucket` is exactly the opaque-coded value the autonomy grant
  bars. `approved` is true of all 1,380, so it is the honest coarse bucket. This is a known
  understatement of lifecycle, NOT an unclassified value.
- **Date column — `Application_Date` REJECTED for `DecisionDate`, and the first read was wrong.**
  Three same-batch sample rows shared one `Application_Date`, which read as a constant load
  stamp; the min/max probe disproved that (2023-10-16T14:29:52Z … 2026-07-16T18:39:31Z, it does
  vary). It is still the wrong column: those values carry **sub-second precision** = system write
  times, while `DecisionDate` spans 2023-07-10 … 2026-06-09 with **both bounds at exactly
  00:00:00 UTC** — a human-entered civic date — and is populated on **1,379 / 1,380** (the single
  null is the one Draft row). `file_date_kind: decided` matches `StatusAdmin: Approved`.
  *Standing lesson: midnight-alignment vs sub-second precision distinguishes a civic date from a
  system timestamp when two date columns compete.*
- **Post-rollout invariants over all 4,512 records: 0 missing `record_url`, 0 missing
  coordinates, 0 missing status, 1 distinct status, 0 records on a non-RI page.** lat span
  41.1508…42.0121, lng span −71.8298…−71.1334 — inside the publisher's own declared extent.
- **Bidirectional gate proof, live receipts.** 02882 → 108/108 emitted · 02886 → 61/61 ·
  02903 → 147/147, all `unmapped_statuses: []`, `no_record_url: 0`, `geocode_failures: 0`
  (`fetched == emitted`, exactly as the single-value vocabulary predicts). Controls: 02138
  (Cambridge MA) fetched ONLY `massdot-highway-projects`; 06010 (Bristol CT) ONLY
  `hartford-building-permits` + `ctdot-project-work-areas`. RIDOT rode neither.
- 🔁 **The FRS-guard discard class bit again and the remedy is CONFIRMED to be rate, not retry
  count.** 17 Providence-metro ZIPs came back **HTTP 200 carrying real records** (02909 → 206,
  02919 → 163, 02912 → 156, 02907 → 118, 02905 → 116) but with `facilities: 0` against a cached
  row holding facilities — so `dev_refresh_collect` refused the WHOLE response and discarded the
  development half with it. Re-firing the SAME ZIPs against the SAME endpoint recovered them in
  four decreasing waves (17 → 13 → 8 → 4 → 0) purely by waiting for the pg_cron 250-request batch
  to drain first. Nothing about the source changed. **Do not fire a tail into a full queue.**

**WV — `wvdoh-active-projects`, merged `6d39939`, deployed (run 31715915322). ROLLOUT COMPLETE:
198 / 212 ZIP pages LIVE (93.4%), 1,262 records, 0 ZIPs left unrefreshed.** Conversion held at
~91% of refreshed ZIPs landing a record across every batch. Original wire notes below.

**WV — `wvdoh-active-projects`, registry 189 → 190, merged `6d39939`, deployed (run 31715915322).**
`2026_Active_Project`, 1,033 rows, polyline, max `EditDate` 2026-08-10. Rollout in progress; live
smoke matched the pre-wire envelope closely (25526 12/12, 26451 10/10, 26181 0/0) with **0 missing
`record_url`, 0 missing coordinates**. Two decoys rejected first: WVDOT's server has a folder
literally named `Projects` holding GIS projects (AADT, bridges, stormwater, signs), and the
publicly-searchable "Roads to Prosperity" layer is the **2024 vintage** while the current one the
2025 map draws is **token-gated** (499). ⚠️ **`wv.maps.arcgis.com` is a REAL org that is NOT West
Virginia — it resolves to "World Vision", a global NGO.** A guessed subdomain can point at someone
else's data entirely, not merely fail.

🛑 **ND — NO STATEWIDE CONSTRUCTION PROJECT REGISTER EXISTS. Stamp `NO_DOT_PROJECT_REGISTER`
(the INDOT class). Do not re-probe without a new instrument.** Four surfaces enumerated
2026-08-13, all exhaustively:
- **NDDOT AGO org `EDijJFsQQwgz8X53`** (the subdomain IS genuine here — "North Dakota Dept. of
  Transportation" — which is why the rule is *check*, not *assume fake*): **38 services**, all
  bridges / basemaps / road conditions / crashes / grants. No project register.
- **NDDOT self-hosted `gis.dot.nd.gov`** (`external` + `ext_ssl`, ~38 services): crashes, speed
  zones, traffic counts, haul permits, road conditions, bridge inventory. No project register.
  Note the REST **root listing 404s** while the folders enumerate fine — probe folders, not root.
- **ND GIS Hub `ndgishub.nd.gov`**: folders are Elevation / Flood / Geoscientific / Imagery /
  Utilities / Water / Applications — **no transportation folder at all**.
- **Scoped search** (`orgid:EDijJFsQQwgz8X53 AND (construction OR STIP OR "highway improvement")`):
  15 hits, every one a bridge layer, StoryMap or grant application.

**The only project-shaped public data is two FUNDING-AWARD layers, and they were MEASURED, not
guessed:** `Special_Road_Fund_2026_WFL1` (47 points) and `Flex_Fund_Approved_Projects_WFL1` (14).
Their coordinates were fetched and intersected against all 155 modelled ND ZIP centroids at the
connector's own 3-mile radius: **SRF lights 7 pages, Flex Fund 4, combined 11 of 155 = 7%.**
For scale, NH's 340 records lit 207 pages. **NOT WIRED, deliberately** — 7% coverage, no status
column and no date column (a `status_const` would have to be invented), and single-programme-year
funding awards rather than a construction programme. Wiring it would put ND on the board at ~11
pages and make a future session read the state as worked when the actual finding is that the
register does not exist. `IMPROVE` does enumerate cleanly (20 values summing exactly to 47) if
anyone later decides 11 pages is worth it.

### 2026-08-13 (later) — NEW HAMPSHIRE: 0 → 207/247 (83.8%). Registry 188 → 189.

`nhdot-ten-year-plan-projects` (#686, merged `6a666a6`, deployed v204). **703 records on 207 ZIP
pages**, measured on `app_projects` after deploy → re-cache → materialize, with **every one of NH's
247 ZIPs refreshed at least once**. **Global 7,476 → 7,683 of 12,722 (60.4%).** NH was the largest
state at literal zero.

⚠️ **THE LAST 19 ZIPs WERE WORTH 16 PAGES — DO NOT ACCEPT THE FIRST PLATEAU.** This state was
measured and reported at **191/247** when 19 ZIPs still showed unrefreshed. They looked like the
usual honest-empty tail; they were not. Re-fired into an EMPTY `pg_net` queue they returned records
and took NH 191 → 207 (77.3% → 83.8%). They had been **blocked, not empty** — the §0h FRS guard
again. Before calling a state finished, check `refreshed_at` coverage is 100%, not just that the
page count stopped moving.

🔴 **THE LAYER IS NOT REACHABLE BY SEARCH — both lookalike traps fired.** `nhdot.maps.arcgis.com`
returns the **generic anonymous portal** (`portals/self` → `id:null`, `name:null`); the real org is
`nh.maps.arcgis.com`, "State of New Hampshire DOT" `22pI3HyqMrW5cmOh`. A `"NHDOT"` title search
returned **155 items, ZERO in that org**. The org's own 47 services hold no project register and NH
GRANIT carries only base data. The register lives on **`maps.dot.nh.gov`**, a host that appears in
NO search result, recovered only by walking the org's web map "Ten Year Plan Map (Revised)" →
`operationalLayers` (the Frisco precedent). `gis.dot.nh.gov` does not resolve at all.
**Had either search been trusted, NH would have been written off as sourceless — which is exactly
what this file said about NY the day before.**

✅ **SECOND INDEPENDENT CONFIRMATION OF THE STATEWIDE-SOURCE THESIS.** Both zero-coverage states
wired on one DOT layer landed at or above the predicted ~78%: **OK 154/197 = 78.2%**,
**NH 207/247 = 83.8%**. The thesis is now measured twice on states it was not fitted to, and NH
came in ABOVE the split it was derived from.

**Let the publisher choose the row filter.** NHDOT's own web map carries
`definitionExpression: "IS_TEN_YEAR = 'YES'"` — 340 of the layer's 6,913 rows. Both that and the
12×-larger `INTERNET_DISPLAY='YES'` (4,086 rows) were measured against 10 statewide ZIP centroids
BEFORE choosing: **10/10 coverage either way**, so the narrow publisher-sanctioned set won on
identical coverage without burying pages under 5,902 historical completed jobs. Same pages,
one-twelfth the noise.

⚠️ **A populated, per-record-LOOKING URL is not evidence.** `PROJECT_PLANS`
(`…/plan-inventory/?p=12334`) is populated on 109 rows and was REJECTED: a real id and
`?p=99999999` return the **identical 1,915-byte SPA shell**. `TYP_PROJECT_SHEETS` passes the same
test (real → `%PDF-1.7` 200, bogus → **404**) and is the `record_url`. Always run the San Diego
discrimination test before trusting a URL column.

**The 40 remaining dark NH ZIPs have all been refreshed and return ZERO** — outside the DOT layer's
3-mile reach. Honest under Rule 8; the next NH gain needs a NEW source, not another refresh.

### 2026-08-13 — FIVE STATEWIDE DOT WIRES. 6,692 → 7,476 Live (+784). Registry 183 → 188.

Measured on `public.app_projects` (`record_kind='development'`, entry complete on both `type_map`
and `status_to_bucket`) — the same definition the scoreboard uses. *(⚠️ CORRECTED 2026-08-15: as
written, this parenthetical is underspecified in both halves. Complete = (`type_map` OR
`use_type_const`) AND (≥1 mapped `status_to_bucket` value OR a socrata `status_const` — socrata's
constant IS the bucket, no mapping required; an arcgis constant must resolve through its own
`status_to_bucket`, per `test/status-const-must-be-mapped.test.mjs`). Read naively, the status
half wrongly flags the four socrata idiom entries — `east-baton-rouge-`, `marin-county-`,
`buffalo-`, `prince-georges-county-` building permits. The 10-entry list this produced was
verified correct; the prose was not. Canonical definition + computed list: the 2026-08-15
"EXCLUSION LIST COMPUTED" entry.)* **7,476 / 12,722 = 58.8%**, up
from 6,692 (52.6%). Recorded in workbook **0080**.

| state | before | after | entry |
|---|---|---|---|
| NY | 233 | **606** (+373) | `nysdot-capital-program-projects` — 5,422 records / 380 pages |
| IL | 256 | **401** (+145) | `idot-annual-program-bridges` 1,082/123 · `-construction` 481/138 |
| OK | 0 | **154** (+154) | `okdot-workplan-roadways` — 1,086 records / 154 pages |
| OH | 136 | **248** (+112) | `odot-current-projects` (TIMS) — 1,232 records / 117 pages |

Control: per-state deltas sum to +784 = the change in the total, and **no state lost a page** (the
0079 live set is a strict subset of the new one within each of the four states, checked per state).
PA unchanged at 350.

🔴 **THIS SUPERSEDES THREE STANDING CLOSURES AT THE BOTTOM OF THIS FILE.** The "LARGE AND GENUINELY
HARD" category said NY had **"no statewide source exists"** — false; NYSDOT publishes one and it was
the single largest gain of the night. OH ("every county closed on enumeration") and IL were in the
same category. **A county-by-county enumeration coming back empty is not evidence that the STATE
publishes nothing** — the two are different registers, and nothing in the earlier passes had looked
for the state DOT layer. Corrected in place below.

✅ **The statewide-source thesis is now confirmed on a state it was not fitted to.** Workbook 0079
argued the lever from a split of 78.0% (states with a statewide entry) vs 31.7% (without).
**Oklahoma had zero registry coverage; after one wire it is 154/197 = 78.2%.** The pre-wire envelope
projection was 146–156; measured 154.

⚠️ **Envelope projections are CEILINGS, not forecasts.** Projected NY ≥413 / IL 161 / OK 146–156 /
OH 117; measured +373 / +145 / +154 / +112 — three of four came in **under**. The envelope answers
"is a project within 3 mi of this centroid", which is necessary but not sufficient for a record to
land and survive the connector. Aggregate projection 837, actual 784.

**The remaining dark pages in these four states are mostly CONFIRMED empty, not unprocessed.** Of
~1,150 that started dark, 41 were still unreached at the end (NY 35, IL 3, OK 2, OH 1); the rest
refreshed successfully and returned zero — outside the DOT layers' 3-mile reach. Honest under Rule 8.
**The next gain in NY/IL/OH/OK needs a NEW source, not another refresh.**


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
- **`status_const` means the OPPOSITE thing in the two connectors — check which one you are
  writing.** socrata: it **IS** the bucket (`"proposed"|"approved"|"operating"`), so an all-empty
  `status_to_bucket` is correct. arcgis: it is the **RAW value**, resolved through
  `status_to_bucket` like any column-read status (`arcgis.ts:300-304`), so with no map the constant
  is unmapped and the entry emits **zero** — silently. Two production entries were written the
  wrong way (`delaware-county-pa-…`, `san-antonio-prelim-plan-review`, both fixed 2026-08-03);
  `test/status-const-must-be-mapped.test.mjs` now fails the build on a third.
- **Read `docs/source-registry.md` for the county BEFORE probing it** — Sussex already had a
  "STILL NOT WIREABLE" section for a DIFFERENT endpoint (`/trdserver/Permit_Points`, 827,020 rows,
  undecodable `a_status`). That record still stands; the reconciliation table is in the new
  "SUSSEX COUNTY DE — WIRED via CONDITIONAL USE" section.

---

## Ordered items

### 0h. FRS-THROUGHPUT — the refresh has a ceiling, and it is EPA FRS — **MEASURED, FIX OPEN**

- **State:** measured 2026-08-13 during the five-DOT refresh. **No code change made.** The run
  worked around it; the guard itself is correct and was NOT touched.
- **The defect:** `dev_refresh_collect`'s transient-safety guard refuses the write when a response
  reports `facilities=0` against a cached `facilities>0`. Right in intent — it stops a flaky FRS
  night blanking good pages — but it refuses the **whole response**, so the development records in
  the same payload are discarded with it. Caught live on ZIP **73003**: the payload carried **5 real
  OKDOT development records** and `facilities:0` against a cached 8; the entire write was refused.
- 🔴 **FRS returns zero as a function of OUR OWN FIRING RATE.** Measured three ways in one session:

  | firing rate | responses | `facilities: 0` |
  |---|---|---|
  | ~170/min (450-ZIP batches) | 172 | **141 — 82%** |
  | 30-ZIP control batch | 30 | **5 — 17%** (25 of 30 carried development records) |
  | 52 ZIPs into an **empty** `pg_net` queue | 52 | **51 collected** |

  **Bigger batches produced FEWER live pages.** Several 450-ZIP rounds barely moved the counter
  while one 52-ZIP round into a clear pipe landed almost everything.
- ⚠️ **Consequence for `dev_refresh_fire_batch` — read before tuning it up.** It defaults to
  `_batch 250` and cron job 14 fires it every 15 min, which is survivable. **Raising that default to
  "go faster" yields fewer pages, silently**: every response still returns HTTP 200, collect still
  reports rows collected, and the writes simply stop landing. There is no error to see.
- **The fix, when it is wanted:** make the guard **per-dimension** — accept the development half of
  a response whose facilities half is untrustworthy — rather than firing harder. Same shape as the
  §0 per-source fix: the aggregate refusal is too blunt.
- **Also observed:** ~**8.4%** of requests returned `503 {"code":"BOOT_ERROR"}` (193 of 2,292 in one
  45-min window). Those ZIPs get `last_refresh_attempt_at` stamped anyway, so the 20-minute cooldown
  **locks out work that never happened**. Not fixed; the run used a shorter ad-hoc retry window.
- **Instrument note, cost a round:** `status_code IS NULL` in `net._http_response` means **NOT YET
  PROCESSED**, not failed. A stalled queue and a failed request are indistinguishable until you join
  against `net.http_request_queue` — 63 OK and 69 OH requests were read as a wiring fault when they
  were merely still queued.

### 0. FETCH-FAIL-GUARD — a failed fetch collected as an empty success — **FIX (1) DONE**
- **State:** **DONE and live-proven** (2026-08-03). Migration `dev_refresh_per_source_failure_guard`;
  SQL of record `docs/dev-refresh-source-failure-guard.sql`; contract pinned by
  `test/fetch-failure-reason-contract.test.mjs` (30 checks, in the 82-file suite).
- **Gate:** founder-approved ("FIX (1) FIRST"). No engine/connector change — collect layer only.
- **The defect:** the transient guard tested the AGGREGATE `development` count, so a per-SOURCE
  collapse hid behind another source's contribution. ZIP 97215 emitted `development: 15` from the
  county's AREA planning notices while losing **414** Portland permits; 15 > 0, guard silent.
- **The trigger:** concurrency, not the paging fix. 10 ZIPs in parallel → 7 return `fetched 0`
  (`Connection reset by peer`); the same ZIPs 2 at a time → 414 / 407 / 136 / 116.
- **Live proof, same run:** 97213 refused (323 records held, `refreshed_at` unadvanced) while five
  siblings updated and **188 other rows updated in the same call** — per-source, not per-page.
- **First-run catch:** `minneapolis-ccs-permits` — `"Unable to perform query. Too many requests."`
  — blocked 55413 (2,015) and 55422 (719), correctly did NOT block 55119 (0 cached). A second
  source that had been darkening pages silently.

### 0a. FETCH-BOUND — bound the fetch (fix 2) — **VISIBILITY DONE, SIZING OPEN**
- **State:** part 1 **DONE** (migration `dev_refresh_truncation_visibility`): a bounded fetch is
  now distinguishable from a complete one at the collect layer, keyed on the
  `truncated_at_max_rows` FIELD (csv words its note "bound the emit" vs the others' "bound the
  fetch" — a prose match would have missed one connector in five). Logged as
  `kind='truncated'`, **never blocking** — truncation is deterministic, so refusing would freeze
  the page forever. Part 2 (per-entry sizing) OPEN — see the measurement below.
- **Gate:** approved. Per-entry `page_size` / `max_rows`.
- **MEASURED cache-wide 2026-08-03, so nobody re-derives it:**
  - **Only 3 ZIPs are truncated** at the 20,000 default — 80011 + 80012
    (`aurora-building-permits`) and 55103 (`saint-paul-approved-building-permits`). *(An earlier
    "p95 = 20,000" reading was an artifact of `percentile_disc` over 16 values, not "most ZIPs
    truncated" — corrected by counting.)*
  - **Row SIZE is the sharper cost:** 55103 **20 MB** · 80011/80012/80013/80014 **18 MB** ·
    80010 17 MB — ~3x the 5.98 MB Cleveland high-water mark in CLAUDE.md (44127 measures 6,158 kB
    and is no longer the ceiling). `aurora-building-permits` alone is 152,414 records over 16 ZIPs.
  - **Row COUNT is NOT the binding constraint.** 80011 (20,051 sites / 18 MB) collects fine;
    55109 (10,995 / 11 MB) never does. The constraint is upstream host SPEED — so a global
    `max_rows` would not have fixed either, and the per-entry value has to come from timing.
- **⚠️ `out_fields` is the tempting lever and it has a trap** — 120 of 124 arcgis entries pull
  `outFields=*`. Deriving the projection automatically from `column_map` + `extra_where` looked
  clean until the derivation produced `ADDITION, BARN, DUPLEX, GARAGE, HOUSE, MOBILE, SHOP` for
  `denton-county-dev-permits`: an identifier regex cannot tell a column from a **string literal
  inside `PermitType IN ('HOUSE','MOBILE HOME',…)`**. Same bug hit miami / minneapolis /
  cleveland. A projection that MISSES a column silently drops a field from every record, so any
  `out_fields` pass must strip quoted literals first **and** be verified against each layer's
  live `fields` list before it is written.

### 0c. FIRE-TIMEOUT — a third invisible failure, one layer further out — **VISIBILITY DONE**
- **State:** attribution **DONE** (migration `dev_refresh_fire_failure_visibility`). Recovery of
  the three stuck pages is **OPEN and needs a founder call** — see "the actual blocker" below.
- `dev_refresh_inflight` records `request_id -> zip` at FIRE time (a timeout has no payload and
  therefore no zip — it cannot be attributed after the fact); `dev_refresh_log_fire_failures`
  joins the response back and logs `kind='fire_failed'` (NULL status) / `'fire_http_error'`.
  `dev_refresh_tick` now runs collect -> log_fire_failures -> fire.
- **Proved by forcing it:** three ZIPs fired with an impossible 1 ms timeout, all landed
  `status_code NULL`, all three attributed with error text + cached_records + request_id;
  inflight cleared to 0. Before this they were invisible.
- ⚠️ **THE TIMEOUT WAS NOT THE BLOCKER.** Fired ALONE, 55103 returns **200 in seconds, 16 kB**,
  counts `{facilities 40, development 0, civic 2}` — engine healthy, retired entry already gone
  from its output. The 90 s overruns are **concurrency queuing** behind the tick's 250-way
  fan-out, the same trigger as the Portland resets.
- 🔴 **THE ACTUAL BLOCKER IS THE 7-DAY TRANSIENT GUARD** — and it is refusing a *correct*
  reduction. The clean 200 carries `development: 0` (right: the entry was retired), the cache
  says 20,000, the row is 5 days old, so the guard refuses. Verified live: collect returned 220
  rows updated and 55103 stayed at 20,042 sites / `refreshed_at` 2026-07-29. **A legitimate
  reduction and a transient collapse are identical by COUNT alone** — the same shape as
  `fetched: 0` meaning both "found nothing" and "could not be reached".
  Self-heals **2026-08-05 04:15Z** (refreshed_at + 7 days), by accident not design.
- **Resident impact is NOT contained** (checked, per the founder's note): `app_projects` holds
  zero saint-paul rows, but `homesignalmap.html:1055` reads `development_reports` **directly**,
  so those three pages render ~40,000 retired-entry records — 55103 20,000 of 20,042 sites
  (99.8%), 55109 10,968 of 10,995, 55119 10,942 of 10,952; all carry `record_url`, ~19,483 /
  10,364 / 10,342 pinned.
- **Old note retained for context:** measured, not fixed. Neither payload guard can see it.
- `net.http_post` fires with a 90 s timeout; an overrun lands in `net._http_response` with
  **`status_code` NULL**, and `dev_refresh_collect` filters `where status_code = 200`. The row is
  never updated and nothing records why. Receipt (18:00Z): `Timeout of 90000 ms reached. Total
  time: 90000.951 ms (DNS 44.817, TCP/SSL 63.738, HTTP Request/Response 89892.309)`.
- **Three ZIPs have not collected once in five days** while being re-fired every cooldown:
  55103 (133.5 h), 55119 (118.0 h), 55109 (116.7 h).
- **It is hiding a registry change:** those pages still serve **41,910 records** from
  `saint-paul-approved-building-permits`, an entry that **no longer exists** in
  `jurisdiction-registry.json`. The refresh that would drop them cannot complete, so the removal
  never reached production.

### 0b. PDX-3-ZIP — 97206 / 97208 / 97227 return 0 Portland records SOLO as well as under load
- **State:** OPEN, recorded not chased (founder: "a separate question — record it, do not chase it
  inside this fix").
- All three were lit before 2026-08-03 and now hold 0 `portland-building-permits` records while
  returning cleanly (no `fetch failed:` quarantine), so this is NOT the guard's class. Candidates:
  the `include_types` enforcement legitimately removing everything they carried, or a scoping
  effect of their centroids (97208 is a downtown P.O.-box ZIP). Their sibling ZIPs recovered fully
  (97209 136 · 97213 323 · 97214 407 · 97215 414 · 97218 196 · 97219 116 · 97239 178).

### 0f. RETIRED-SOURCE DISCRIMINATOR — **DONE** (founder-approved)
- Migration `dev_refresh_retired_source_discriminator`; SQL of record
  `docs/dev-refresh-source-failure-guard.sql` Part 4; pinned in
  `test/fetch-failure-reason-contract.test.mjs` (48 → 54 checks).
- **The problem:** the 7-day transient guard refused a write when `development` dropped to 0 on a
  fresh row — right for a flake, wrong for a deliberate reduction, and **identical by COUNT
  ALONE**. It held the saint-paul retirement off three pages for five days and would have
  self-healed at `refreshed_at + 7 days` by accident.
- **The discriminator:** a drop is EXPLAINED when a source that currently contributes cached
  records is **absent from the payload's reports entirely**. The engine reports on every entry
  whose coverage gate matched, so absence means it no longer runs for this ZIP (retired, or
  coverage changed) — not a flake, and not something waiting resolves.
- **It STRENGTHENS the guard.** Proven read-only against a real fresh row (97215):
  P1 unexplained collapse → **REFUSE** · P2 explained by a retired source → **ACCEPT** ·
  P3 source reported but fetch-failed → **REFUSE** (Part 1 takes precedence) · P4 healthy →
  ACCEPT. Discriminator itself: source still reported → none retired; source absent → retired
  with its cached count; no reports at all → retired; ZIP with no sourced records → none.

### 0g. UNCAPPED MAP RENDERING — one DOM marker per site, no clustering — **OPEN**
- **State:** measured, not fixed. Founder-flagged as its own item: "20,000 divIcons is a browser
  problem regardless of what we do to the data."
- `homesignalmap.html` `sites.forEach(...)` builds **one Leaflet `divIcon` per site**, then
  `spreadStackedMarkers()` fans co-located dots in screen pixels and `fitBounds` frames all of
  them. **No clustering anywhere** — `markerClusterGroup` / `supercluster`: **0 matches in the
  file**. Both 3D views do the same over `MAP_SITES`.
- The LIST is capped (`listInto()`: `items.slice(0,12)`); the MAP is not. So a resident on a dense
  page sees 12 of N in the list and N markers on the map.
- **The data levers only shrink it, they do not fix it.** After the 365-day window the worst page
  is 80016 at **10,421** sites (was 20,051). The type change will cut further, to a few thousand.
  Still far past what unclustered DOM markers handle.
- Fix is a page change (clustering / canvas renderer), which is gated — not attempted.

### 0d. SURFACE-TABLE MATRIX — **RULED: both tables authoritative; verifiers now declare their surface**
- **Founder ruling (2026-08-03):** both tables are authoritative, each for its own surface. The
  materializer's caps exist deliberately for list pages; the map genuinely needs every site.
  **The divergence is design, not defect, and is not being collapsed.** What was missing was that
  no verification declared which surface it spoke about — that is what was fixed.
- **DONE:** `scripts/lib/surface-banner.mjs` + a `surfaceBanner('<name>')` call as the first line
  of every verifier's `main()` (all **16** instrumented). Output header now reads e.g.
  `verify-development: surface = map page (homesignalmap.html?zip=), table = development_reports +
  app_community_meta + property_reports [UNCAPPED (cache the page reads)]`.
  Pinned by `test/verifier-surface-declaration.test.mjs` (103 checks): every verifier imports and
  calls it, every declaration is complete, a raw-cache reader must be marked UNCAPPED and a
  materialized reader CAPPED, an undeclared name **throws** rather than printing nothing.

**Read-path audit — done from the code, not grep** (each page's actual `HS.data.*` calls and
direct `rest/v1/` fetches):

| Page | Direct | Via `lib/data.js` | Underlying tables | Verifier |
|---|---|---|---|---|
| `homesignalmap.html` | **`development_reports` (UNCAPPED)**, `app_community_meta`, `communities`, `property_reports` | — | raw cache | verify-development · verify-representative-zips · audit-official-links · verify-geocodes · verify-maps · verify-map-markers |
| `community.html` | — | community, coverageState, coverageStatus, projects, facilities, changes, meetings | app_projects, app_changes, app_community_meta, meetings, communities | verify-communities · verify-coverage-state |
| `alerts.html` | — | community, changes, news, meetings | app_changes, meetings | verify-alerts-page · verify-alerts-categories |
| `development.html` | — | community, projects, facilities, meetings | app_projects, app_changes, meetings | verify-facility-entity · verify-maps-live |
| `dashboard.html` | — | community, projects, changes, meetings | app_projects, app_changes, meetings | verify-map-markers (partial) |
| `properties.html` | — | projects, changes | app_projects, app_changes | **NONE** |
| `property.html` | — | projects, changes, envRisk | app_projects, app_changes | **NONE** (verify-development §4.5 covers `property_reports`, not the page) |
| `today.html` | — | community, projects, changes, meetings | app_projects, app_changes, meetings | **NONE** |
| `index.html` | — | isCovered, changes | app_community_meta, app_changes | **NONE** |
| `maps.html` | — | community, projects, facilities, changes, meetings | app_projects, app_changes, meetings | **NONE** |
| `reports.html` | — | community, projects | app_projects | **NONE** |

- 🔴 **SIX SURFACES HAVE NO VERIFIER** — `properties.html`, `property.html`, `today.html`,
  `index.html`, `maps.html`, `reports.html`. Listed in `UNVERIFIED_SURFACES` and asserted by the
  test so the list cannot quietly go stale. **That is where the next silent defect lives.**
- **Why the caps matter when reading a result:** `app_refresh_zip` has **five** inserts — app_projects
  `development` (`relevance='development' AND scope='point'`), app_projects `facility`
  (`relevance NOT IN ('development','civic')`), then app_changes planning & zoning **limit 6**,
  civic **limit 6**, meetings **limit 8**, government notices **limit 48**, local news **limit 48**.
  A row absent from `app_changes` may be a CAP, not an absence.

### 0e. ROW-SIZE DETECTOR — retired/stale entries at scale — **RUN, CACHE IS CLEAN**
- Founder's suggestion: a `development_reports` row far larger than its peers is a cheap signal.
  Confirmed cheap — use **`pg_column_size(sites)`** (compressed, no detoast) and it runs over all
  12,722 rows in seconds; `length(sites::text)` times out.
- **Baseline 2026-08-03:** p50 **2,298 bytes** · p99 **480 kB** · max **1,979 kB** stored ·
  **25 rows over 1 MB** stored. 55103 was the largest at 20 MB uncompressed before the clear.
- **Direct check beats the proxy, and it is also cheap:** cached `source_registry_id` values with
  no entry in the live registry → **0 cache-wide**. Positive control in the same chain: the
  unfiltered query returns **143** distinct source ids over 12,722 rows against **151** registry
  entries, so the query reaches real data and the exclusion list is complete.
  `saint-paul-approved-building-permits` was the 144th and is gone. **No other retired entry is
  lingering anywhere.**
- Worth a periodic check; not urgent while the retired-entry count is 0.

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

## PA/Allegheny — `allegheny-county-asbestos-permits` GO-LIVE VERIFIED (2026-08-04)

**DONE.** Registry-only wire (PR #586, merged `89b3089`), deployed via `deploy-edge-functions`
from main, re-cached, re-materialized, measured in BOTH tables.

| | before | after |
|---|---|---|
| Allegheny live / dark | 27 / 92 | **77 / 42** |
| PA dark | 322 | **272** |
| national | 4,482 / 12,722 (35.24%) | **4,532 / 12,722 (35.62%)** |

50 pages carry the source · 215 records (`development_reports`) · 210 (`app_projects`) · 0
invariant violations. Native `zip_code` → the page count is exact, not a spatial estimate.
The 215/210 gap is the 5 `scope:"area"` records, not dedup and not loss (all 10 records on
15260 have distinct `case_number`s).

**Method notes worth keeping:** re-cache selector was `refreshed_at`, NOT "still dark" — 3 of
92 (15086/15090/15135) missed the collector's 20-minute window and would have been invisible to
a still-dark selector (the Chester lesson). `app_refresh_zip` was called explicitly on all 119
rather than waiting for the 8.5 h round-robin.

⚠️ **Publisher SUSPENDED updates 2026-07-29** (undercounting found after an Oct 2025 system
transition). Data is real and current to 2026-06-29. **On the reprobe list. Do not restate as
complete county coverage.**

Receipts: docs/source-registry.md "ALLEGHENY COUNTY PA".

## GEOCODE GEOFENCE — ported to the 3 unfenced connectors (2026-08-04)

**DONE.** PR #587. The fence CLAUDE.md §8 calls unbendable existed in `arcgis.ts` + `socrata.ts`
only (two private copies); `ckan.ts`, `carto.ts`, `csv.ts` had none. Live proof: ZIP 15202
"294 UNION AVENUE" cached at a **Johnstown NY** coordinate, ~300 mi off, `scope:"point"`.

Collapsed to one `sources/geo-fence.ts`, **semantics unchanged** (the two copies were already
identical; only identifiers differed). `test/geocode-fence.test.mjs` drives all five shipped
connectors both directions + a guard so a sixth cannot ship unfenced. Suite 85 → 86.

Cache-wide census at fix time: only **2** records geocode at all on those three connectors.

## NEXT — PA/Montgomery (62 dark, PA's largest remaining block)

`gis.montcopa.org/arcgis/rest/services` → `Planning/Montgomery_County_Act247_Proposals`.
Act 247 = the PA Municipalities Planning Code subdivision/land-development filing requirement,
i.e. a county-wide development docket. **UNPROBED — vocabularies not yet enumerated.**

Its hub DCAT returns a literal `"dataset": []`; the server root carries 19 folders. **An empty
DCAT dataset array is not an empty server** — second time this has paid (Centre, Montgomery).
⚠️ `opendata-mcgov-gis` is Montgomery County MARYLAND, already wired — cross-state lookalike.

**Closed by enumeration this session, do not repeat:** PASDA for Allegheny/Montgomery/Dauphin/
Lehigh (all base cartography, 0 activity layers) · Allegheny's own gisdata server (`Accela`
folder EMPTY) · Dauphin (30 datasets, all parcels/hydrology/zoning — candidates_exhausted) ·
ACCD Applications (NO_GEOGRAPHY, byte-verified field list).

## PA/Montgomery — `montgomery-county-pa-act247-proposals` GO-LIVE VERIFIED (2026-08-04)

**DONE.** PR #588, merged `0e24089`, deployed from main, re-cached, re-materialized, measured
in BOTH tables. Baseline captured BEFORE mutating: 64 pages, 2 live, 62 dark.

| | before | after |
|---|---|---|
| Montgomery live / dark | 2 / 62 | **64 / 0** |
| PA live / dark | 288 / 272 | **350 / 210** (62.50%) |
| national | 4,532 | **4,591 / 12,722 (36.09%)** |

3,628 records, **identical in `development_reports` and `app_projects`**, all 64 pages,
**0 invariant violations** (0 missing record_url, 0 missing coords, 0 unclassified, 0 non-point
scope, 0 non-record precision). Gate proof: PA/Montgomery ONLY.

Founder ruling recorded in `_receipts`: `status_const` buckets to **proposed** (Act 247 = a
filing submitted for county review before local action, not an approval). Measured after
go-live: proposed 3,628 / approved 0 / operating 0.

⚠️ **Window 1095 differs from both siblings (Chester + York use 1825) — FLAGGED, not silently
reconciled.** Named-row counts 365d 253 · 1095d 813 · 1825d 1,396. Reconcile deliberately.

**Two method notes worth keeping.** (1) The 2 pages already "live" were the Philadelphia-physical
crosswalk ZIPs 19118/19128; a "still dark" retry selector would have SKIPPED them and they would
have silently missed the new source — `refreshed_at` caught them (the Chester lesson, second time
it has paid). (2) I read a verification subquery in the SAME statement as `dev_refresh_collect()`
and got the PRE-mutation snapshot, then briefly mistook it for a blocked write. **Never measure a
mutation in the statement that performs it.**

## PA SEAM CLOSED (2026-08-04) — 560 pages · 350 live · 210 dark

Every PA county is now wired or rejected ON ENUMERATION. The 210 dark are not unprobed:
165 firm rejections (Lancaster 56 · Bucks 50 · Dauphin 30 · Lehigh 29), 42 coverage-limited
inside wired Allegheny, 3 single stragglers (York/Philadelphia/Centre).

**Lehigh closed this session** — PASDA 7 base layers · own `gis.lehighcounty.org` behind an
Incapsula WAF (212-byte JS challenge to pg_net → verification_blocked, reprobe) · hub DCAT
enumerated 13 datasets, all parcels/assessment/voting/bridges/landuse-codes → candidates_exhausted.
Note its hub is POPULATED and still carries no activity layer — a firmer verdict than Montgomery's
empty DCAT.

Remaining PA routes: Bucks reprobe (docket may resume), Lehigh reprobe (if the WAF lifts), or
municipal-level wiring in Lancaster/Dauphin. **Nothing further is cheaply available in PA.**

## ACT 247 WINDOWS RECONCILED TO 1825 (founder ruling 2026-08-04, same day, superseding 1095)

All three PA Act 247 entries now read identically. `montgomery-county-pa-act247-proposals`
shipped at `recency_days: 1095` and was reconciled within hours to match
`chester-county-pa-act247-plans` and `york-county-pa-planning-subdivisions`, which shipped
first at 1825.

**The reasoning, because it is the durable part:** three entries on ONE mechanism with TWO
windows is drift. The 1095 ruling was made before the sibling convention was known. 1825 is
also the more ACCURATE window rather than merely the consistent one — Act 247 plan reviews run
multi-year, so a three-year cut truncates live cases mid-review.

Measured named-row counts: 365d 253 · 1095d 813 · **1825d 1,396**.

**If a future session finds a reason to narrow any of the three, narrow ALL THREE together or
the drift returns.**

### MEASURED after deploy + re-cache (2026-08-04)

| | at 1095 | at 1825 |
|---|---|---|
| Montgomery records (`development_reports`) | 3,628 | **6,126** |
| Montgomery records (`app_projects`) | 3,628 | **6,126** |
| pages carrying the source | 64 | **64** |
| oldest `file_date` | 2023-08-08 | **2021-08-05** |
| invariant violations | 0 | **0** |

**The oldest `file_date` is the proof, not the record count.** 2021-08-05 is exactly the
1825-day boundary; those records could not exist under a 1095-day window, so the window
demonstrably changed rather than the counts merely moving.

**+2,498 page-records from +583 source rows is correct, not inflation.** Scoping is spatial at
3 mi, so one Act 247 filing legitimately lands on every Montgomery ZIP page within range —
3,628/813 = 4.46 pages per source row before, 6,126/1,396 = 4.39 after. The ratio is stable;
only the window moved. Per-page counts remain honest.

Coverage is unchanged (Montgomery was already 64/64 live): PA 350/210, national 4,591/12,722.
This reconciliation bought DEPTH on pages that were already lit, not new pages.

⚠️ **Operational note — batch size.** Firing all 64 ZIPs at once returned **62 × 503
`BOOT_ERROR`** while the scheduled `dev_refresh` cron was running concurrently; the same
function had just answered a single probe 200. Nothing was corrupted (`dev_refresh_collect`
reads only `status_code=200`, so those rows simply kept their previous content). **Batches of
16 ran 16/16 clean.** Use 16 when the cron may be active, and measure completion by
`refreshed_at` on the target rows — the global collect count includes the cron's ZIPs and is
not evidence about your own fires.

## EDITORIAL LEAD — Norristown PA data-centre cluster (surfaced 2026-08-04)

**Five data-centre filings in Montgomery County PA, all March 2026, all on ZIP 19401
(Norristown), all Act 247 land-development submissions to the county planning commission:**

- `600 River Road - Data Center` (2026-03-18)
- `411 Swedeland Road - Data Center` (2026-03-12)
- `2100 Renaissance Blvd - Data Center` (2026-03-11)
- `3200 Horizon Drive - Data Center` (2026-03-11)
- `Renaissance Blvd. - Data Center` (2026-03-11)

Three filed on the SAME DAY and two more within a week — a cluster, not five unrelated
projects. Renaissance Blvd appears twice (2100 Renaissance Blvd + a second Renaissance Blvd
parcel). Every one carries a per-record `URL_Documents` link to the county's own document
portal, so each is traceable to its official public record.

**This is the thread the platform exists to surface** — the Stratos/Box Elder and
Stargate/Abilene shape, in a metro county nobody was watching. Logged as a LEAD, not a
conclusion: these are submissions under county review, not approvals, and the entry buckets
them `proposed` accordingly. Any editorial use must say so.

Not yet done: no cross-check against operator identity, utility interconnect filings, or
PA DEP records. That is the follow-up if this thread is pursued.

## OH/Summit — `summit-county-oh-planning-commission-items` GO-LIVE VERIFIED (2026-08-05)

**DONE.** PR #592, merged `de5b8aa`, deployed, re-cached, re-materialized, measured in both tables.

| | before | after |
|---|---|---|
| Summit live / dark | 0 / 41 | **14 / 27** |
| OH live / dark | 122 / 213 | **136 / 199** (40.60%) |
| national | 4,591 | **4,604 / 12,722 (36.19%)** |

36 records, identical in both tables, 0 invariant violations, gate proof OH/Summit only.
The 27 still-dark are the documented coverage limit (county commission reviews UNINCORPORATED
TOWNSHIPS; Akron and the incorporated cities run their own) — not a failure, and not to be
described as county-wide coverage.

## ⚠️ OH SHAPE CORRECTION — three unwired metros, not seams

159 of the original 213 dark pages (75%) were in counties with ZERO wired source, three of them
separate metros: **Akron 41 (now wired), Dayton 39, Toledo 30**. Only 54 dark pages are true seams
inside Franklin/Cuyahoga/Hamilton, which were already at 91.8% / 75.0% / 60.7%.

**NEXT IN OH, both UNPROBED:** Montgomery/Dayton 39 · Lucas/Toledo 30 · then Medina 19 / Warren 15 /
Butler 15 collars.

⚠️ **DAYTON CARRIES THE WORST NAME COLLISION IN THE DATASET.** "Montgomery County" GIS searches
return `montcopa` (Montgomery **PA**, wired 2026-08-04), `mcgov` (Montgomery **MD**, already wired)
and PASDA `MontgomeryCounty` (also PA). Ohio's is `mcohio.org`, and
`gis.mcohio.org/arcgis/rest/services` returns 404 HTML — the real OH service host is still unfound.
Confirm entity from CONTENTS before wiring anything named Montgomery.

## 🚫 DAYTON — WIRED, DEPLOYED, REVERTED. Montgomery OH stays 0 / 39 (2026-08-05)

PR #594 wired `dayton-oh-capital-improvement-projects`, merged and deployed. The deploy proved
the host **blocks the engine**. Reverted in PR #595 the same hour. DB-verified: Montgomery **0 / 39**
unchanged, OH **136 / 335**, 0 Dayton records anywhere — the failed fetches wrote nothing.

**Receipt.** 4 of 4 Montgomery ZIPs (45402/45403/45404/45410), `fetched 0 / emitted 0`:
`client error (Connect): Connection reset by peer (os error 104)`.
Control — the SAME URL byte for byte returns **200 / 413,143 bytes / 212 features** via `pg_net`,
minutes apart. Error is at **Connect**, before HTTP, so not a query-shape/size problem: a source-IP
block on Supabase edge egress. Tampa/El Paso class. No hosted copy exists — every AGO item is a Map
Service *reference* back to `maps.daytonohio.gov`.

### 🔑 A `pg_net` 200 IS NOT EVIDENCE THE ENGINE CAN FETCH THE HOST — use this before the next wire

Recon runs on `pg_net` (Postgres egress); the engine runs on the Deno edge runtime (different egress).
A host can be fully reachable to every recon probe and entirely unreachable to production, and because
**all** recon here is `pg_net`-based, this is **invisible to recon by construction**. Tampa/El Paso
were caught at recon only because their block was an HTTP 403 `pg_net` also received.

**Operational rule:** for any **NEW HOST**, the first post-deploy re-cache is a **DEPLOY VERIFICATION,
not a formality** — read `arcgis_reports[].fetched/emitted` and `quarantined`, never just `counts`.
A page with 0 development records is indistinguishable from a legitimately empty one; only the
connector report separates "fetched nothing" from "could not connect". That check caught this one
probe after deploy, before any coverage was claimed.

**Known-reachable hosts are now a wiring advantage.** `services*.arcgis.com` is proven by dozens of
live entries; a city-hosted `gis.<city>.<state>.gov` is an unknown until the engine tries it.

**🔁 REPROBE:** Dayton. Data is good, config is proven correct — a one-object re-add if the block lifts.
An engine-side edge-reachability preflight is **proposed, not built** (that is a code change).

## OH — MONTGOMERY / DAYTON RECON RECORD (stands; only the wire was withdrawn)

- Server root enumerated **in full — all 35 folders** of `maps.daytonohio.gov`. **No permit ledger and
  no zoning-case ledger anywhere on it.**
- **Accela REJECTED on record class — a sixth disqualifier, `WRONG_RECORD_CLASS`.** 12,879 rows, fresh
  (2026-01-02 → 2026-07-01), per-record, point geometry — and `COMPLAINT_TYPE` is `HOUSING` on **every
  one** of the 12,879, with statuses ABATED / PAID / APPEAL-PPC / EXTENSION GRANTED (summing to
  12,879). A housing code-enforcement ledger, not development. Live, fresh, per-record, geolocated,
  and still not the thing. It is **not** the empty-vendor-folder case (Summit `tyler`, Allegheny
  `Accela`) — this folder is full; the content is simply the wrong ledger.
- **The service name is misleading and the layer choice is load-bearing.**
  `Completed_Capital_Improvement_Projects` is the FULL register (264 rows), and
  `Active_Capital_Improvement_Projects` (43) is exactly its `Construction`+`Bidding & Award` subset —
  proven by `PROJID` set difference **0**, not by count. Wiring both would double-emit (houston-plat
  trap). Third instance of *read the rows, not the service name*.
- **Worst name collision in the registry, two of three already wired:** montcopa = Montgomery **PA**
  (wired), mcgov = Montgomery **MD** (wired), Ohio's `gis.mcohio.org/arcgis/rest/services` **404s** —
  the real Montgomery County **Ohio** service host is still unfound. Entity was confirmed from
  CONTENTS only (Midtown, Belmont, Ryburn Ave, Merrimac Ave, Riverside Dr = City of Dayton, Ohio).

## OH — CLOSED FOR NOW (2026-08-05). 136 / 335 live, 199 dark

Every OH county is wired, partially wired, blocked, or **exhausted on enumeration** — none is merely
unprobed. Full per-county table + receipts: `docs/source-registry.md` "OHIO — STATE CLOSED FOR NOW".

- **Wired:** Franklin 45/49 · Cuyahoga 39/52 · Hamilton 34/56 · Summit 14/41 (coverage limit:
  unincorporated townships only) · Delaware 4/19 seam.
- 🔴 **Montgomery 0/39 — BLOCKED AT THE EDGE.** Source found, wired, deployed, reverted. **The only
  OH reprobe candidate**; config is proven correct, so it is a one-object re-add if egress opens.
- **Lucas 0/30 — REJECTED `NO_TEMPORAL_FIELD`.** `Vibrancy_Projects` had 119 rows on a
  known-reachable host, complete vocabularies summing to 119, current through 2026, and a measured
  **16 of 30** page lift — rejected anyway on the founder ruling: **119/119 undated is the
  disqualifier, not the missing status.** `Program_Year` is an integer with nothing to fall back on.
  `DemoCandidates` also rejected (no date, no status, no case number; a pre-decision candidate list
  naming private residences). Neither server carries a permit or case ledger; Toledo's
  `PlanningComAppUNC10419` is a misnomer for the plan commission's **basemap**, and Lucas's `Tyler`
  folders hold only cadastral data — **a vendor-named folder is not a source whether empty or full.**
- **Medina 0/19 · Butler 0/15 · Warren 0/15 — exhausted.** Medina's org (confirmed Ohio from township
  names) is utilities/parcels/zoning. Butler/Warren surfaced the City of Monroe (~15k pop, negligible
  lift) and OKI's `Prioritization_Projects_2026`, rejected as 62 polylines with an opaque `NoteType`
  integer and no date — the San Jose opaque-code class.

## MISSOURI — CLOSED (2026-08-05). **53 → 83 / 264 (20.08% → 31.44%), +30 pages**

National **4,604 → 4,636 / 12,722 (36.44%)**. Per-county after: St. Louis 16 · Jackson 39 · Clay 13 ·
Platte 8 · Boone 6 · Cass 1 · Greene/Franklin/Jefferson/St. Charles 0. Both tables identical
(39/16, 1,074/13, 882/3 records/ZIPs), 0 invariant violations, gate proof clean in all three.
⚠️ The `mapd.kcmo.org` **new-host deploy verification PASSED** (`f=838 e=664`) — and the first probe,
fired ~1 min after the deploy queued, returned an EMPTY `arcgis_reports`. That pre-deploy response is
exactly the §0 trap; it was caught by waiting, not by reading the zero as a verdict.

Every MO county is now wired or **rejected on enumeration**. Full per-county receipts:
`docs/source-registry.md` "MISSOURI PASS". Shape confirmed the standing rule again — six counties at
0% held **156 of the 211 dark pages (74%)**: metro builds, not trim.

**WIRED (3, registry arcgis 128 → 131):**
- `stlouis-county-mo-subdivisions` — 42 rows, the only STL source carrying dates at all. **Native
  PROP_ZIP → 18 EXACT pages** (a 3-mi radius would have estimated 33; the exact number was chosen).
  STALE and said so: 2025-01-03…2025-12-18, and `DATESUBMIT >= 2026-01-01` returns **exactly 0**.
  Ceiling: `MUNICIPALI` is UNINCORPORATED on 42/42.
- `kcmo-development-cases` — the best-formed source in the state. 23,166 rows, **100% dated**, fresh to
  within 4 days. **The 1825 window is load-bearing**: unwindowed it is 71% `Closed` (no recorded
  outcome); in-window `Closed` vanishes and 17 self-describing values sum to exactly 2,675. `Closed` is
  still mapped to `exclude` because the window moves. Lift **14** (Jackson 9 · Clay 2 · Platte 2 · Cass 1).
- `columbia-mo-capital-projects` — 370 rows, status sums to exactly 370, genuinely current (to
  2029-10-01). Lift **2**, and says so.

**REJECTED with receipts:** STL zoning petitions (**0 of 3,945 dated**) · STL construction layers (no
date field) · STL licence locations (WRONG_RECORD_CLASS) · **KCMO BLDS re-probed and still frozen at
exactly `2025-05-09T20:22:20.907Z`** after three more months · `BW_NewCommercial_Permits` (1 page, 5
ZIPs, one-off extract) · St. Charles CUP (**free-text prose statuses**, Douglas NV class), BZA (opaque
`D-OT`/`D/G`/`SeeComme`, San Jose class), Zoning Application + PUD (no date), production host behind a
**Cloudflare 403** · Greene/Springfield (no ledger) · Franklin + Jefferson (no first-party org).

**🔁 MO REPROBE CANDIDATES:** KCMO BLDS (stalled, would wire in minutes if it revives) · `rdx.stldata.org`
(unreachable, TLS blackhole) · a `Subdivisions2026` successor if St. Louis publishes one.

### Three reusable findings from this pass

- **Fourth vendor-named folder that is not a source** — St. Louis's `Accela` holds only
  `Accela_Parcels`. Tally: Summit `tyler` empty · Allegheny `Accela` empty · Dayton `Accela` housing
  code-enforcement · St. Louis `Accela` parcels. **Content decides; the name promises nothing.**
- **`preserveLayerIds: true` means layer ids are arbitrary** — STL's construction layers are **101**
  and **100**, not 0, and the `/0` 404s came back as **HTTP 200 carrying an error object**.
- **Unknown `*.maps.arcgis.com` subdomains return a byte-identical 12,477-byte generic portal.** Five
  of six urlKey guesses hit it; the one real org differed at 18,684 bytes. Response size is a cheap
  "this is not an org" discriminator before you spend a search.

## ILLINOIS — CLOSED (2026-08-05). **139 → 255 / 474 (29.32% → 53.80%), +116 pages**

National **4,636 → 4,752 / 12,722 (37.35%)**. The largest single-state gain in the run. Full receipts:
`docs/source-registry.md` "ILLINOIS PASS".

**WIRED (3, registry arcgis 131 → 134):** `cook-county-il-highway-construction-program` (Cook 131 →
**211**, dark 85 → 5) · `lake-county-il-construction-program` (Lake 0 → **27**, dark 31 → 4) ·
`champaign-il-special-use-permits` (Champaign 0 → **9**). All three met or beat their pre-wire
estimates. Gate proof clean; 0 records missing `record_url`.

**REJECTED with receipts:** Madison DevelopmentChange (324 polygons, schema is `LOCALE`/`LOCALE2`/
`TYPE`, no date) · Rockford CIP (90 points, Esri Shortlist app layer, no date — **corrects the prior
"0 permit services"**, a CIP service does exist) · Kane 2020 Transportation Plan (integer `COMP_YE`,
stale 2023) · McHenry Woodstock permit (1 row, a boundary polygon) · Champaign layer 19 (edit stamps
only) · Lake layer 1 lines (companion half, withheld) · DuPage/Will/Kendall/LaSalle/Aurora.

### 🔴 OPEN ITEM NEEDING A DECISION — arcgis connector does not flatten `esriGeometryMultipoint`

Lake writes **77 records / 27 ZIPs into `development_reports` and ZERO into `app_projects`**.
`featurePoint()` handles `x/y`, `centroid`, `rings` and `paths` — **no branch for `g.points`**. Lake's
layer is multipoint, so records correctly become `scope: "area"` and the rail stays empty. **The pages
are live and nothing is fabricated**; Lake just gets no per-project pins. One branch in
`sources/arcgis.ts` fixes it — a **code change, outside the registry-only grant, so flagged not made.**

⚠️ **The invariant check passed VACUOUSLY and that is the transferable lesson.** "0 point-scope
records missing coordinates" returned 0 because Lake has *no point-scope records at all*. **Report the
scope DISTRIBUTION next to the violation count** — a zero among an empty class attests to nothing.

### Two method notes from this pass

- **Check the registry before probing.** `chicago-building-permits` and `naperville-building-permits`
  already existed; discovery re-found Naperville's tables and measured ~1 page of lift because its four
  ZIPs were already live at 484/480/333/204 records. A two-second grep skips that branch.
- **A season string is not a date, but an edit-stamp date can be.** Cook's `start` is "Spring 2026"
  (unparseable); its `CreationDate` is real, 70/70, and inside the named program year. NO_TEMPORAL_FIELD
  means there are NO dates — not that the best-named field is unusable.

## ⚠️ METHOD ERROR — never select a re-cache batch by "still dark"

Made and caught this session. A ZIP that legitimately returns ZERO records never leaves the
"dark" set, so batch-selecting on it re-fires the same ZIPs every round while unfired ZIPs wait.
Caught at 21/41 refreshed. **`refreshed_at` is the only correct selector — for the FIRING batch,
not just the retry.** This is the Chester lesson generalised.

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

⚠️ **CORRECTION, SAME SESSION: THE "HANG" THAT TRIGGERED THIS SWEEP NEVER HAPPENED.** An earlier version
of this section justified the work with "three consecutive `unit` attempts on the same commit hung,
twice in `Install playwright`". That was **wrong, and the error was mine, not CI's.** Measured from the
API afterwards:

| run | conclusion | duration |
|---|---|---|
| 30770523717 | success | **2.3 min** |
| 30770516378 | cancelled **by me at 1.8 min** | 1.8 min |
| 30770693405 | success | **2.4 min** |

Every run was normal. I was reading elapsed time by counting my own background `sleep` polls as though
wall-clock had advanced with them, concluded jobs were stuck for 20-50 minutes, **cancelled a healthy
job 1.8 minutes in**, pushed an empty "re-trigger CI" commit, and wrote the hang into the record. The
same miscount produced the earlier "`verify-communities` has been running ~50 minutes" claim - its real
duration was 22m32s. Correcting the symptom the first time without finding the cause let me repeat it
with more consequence.

**Standing answer: never infer elapsed time from how much waiting it FEELS like. Compute it -
`now - started_at` from the API - and quote both timestamps.** A cancelled healthy job is a real cost:
it destroys a valid check and invites an unnecessary push.

**The sweep itself stands on its own evidence and is unaffected**, because the finding was never about
the hang: it is a static property of the workflow files. Only 4 of 31 carried `timeout-minutes`
(`unit-tests`, `verify-geocodes`, `gate2b-full-inventory-parity`, `load-openaddresses`); the other **27
were unbounded**, inheriting GitHub's 6-hour default. That is the same shape that let `verify-geocodes`
burn **11 consecutive 6-hour cancellations** on an account previously halted at $0 - a real, recorded
incident, unlike the one I imagined. An unbounded job does not fail; it bills.

**Every bound is sized from the workflow's OWN measured maximum successful run**, not guessed:

| workflow | measured max | bound |
|---|---|---|
| `verify-development` | 251.6 min | 330 |
| `verify-communities` | 42.8 min | 120 |
| `source-monitor` / `spot-check` / `verify-representative-zips` | 5.9-11.6 min | 45 |
| 16 fast verifiers / helpers | <= 4.1 min | 15 |
| 7 dispatch-only gov-feed helpers | **no successful run on record** | 30 (conservative) |

The 7 with no measurement are named as such rather than given a number pretending to be derived.
`unit-tests` also gained a bound (15 min against a ~2.5 min measured max). Verified by parsing all 31
workflow files: **0 jobs still unbounded, 0 parse errors.**

⚠️ **`verify-development`'s 330 is a bound, not headroom** - it sits above the 251.6 min measured max on
purpose, but the job is already 4.2 h against what was a 6 h ceiling and grows linearly with the cache.
The bounding report above is what actually fixes that; this only stops a genuine hang from costing 6 h.

---

## 🗓️ RECURRING ITEM — DATED CONSTANTS IN REGISTRY WINDOWS (review every January)

**Next review due: 2027-01-01. Owner: whoever is in the registry that month.**

**Four** entries filter on a **hardcoded year**. They are not equivalent, and only two are dangerous:

| entry | window | shape | what happens over time |
|---|---|---|---|
| **`worcester-building-permits`** | `Permit_License_Issued_Date LIKE '%/2025' OR LIKE '%/2026'` | **FIXED WINDOW** | 🔴 **stops matching new records on 2027-01-01** and silently decays to stale-only, then to zero |
| **`centre-county-pa-building-permits`** | `Issue_Date LIKE '%/2024' OR '%/2025' OR '%/2026' OR '%/2027'` | **FIXED WINDOW**, next year pre-included | 🟠 **goes blind 2028-01-01**, not 2027 — the list already carries the year AFTER the one it shipped in, which buys a full year of grace. Same failure mode as Worcester, one year later. |
| `anaheim-land-use-cases` | `Application_Received >= '2025/07/01'` | fixed floor | 🟡 keeps matching new records; the window only ever GROWS, accumulating old cases |
| `tempe-building-permits` | `IssuedDate >= '2025-01-01'` | fixed floor | 🟡 same — grows, never blind to new data |

**Cheap mitigation, already applied to Centre and NOT yet to Worcester: pre-include next year.**
A year that has not started yet matches nothing, so adding it costs zero rows today and converts a
hard cliff into a year of slack. Worcester should get `OR LIKE '%/2027'` at the January review even
if the durable fix below does not land — that alone removes the 2027-01-01 cliff.

**A fixed FLOOR degrades gracefully; a fixed WINDOW goes blind.** Only Worcester is the second kind,
because its date column is a **String in M/D/YYYY**: `recency_days` emits a `DATE` literal that cannot
apply (the `frisco-active-building-permits` standing answer), and M/D/YYYY does not sort
lexicographically either, so a `>=` string compare is wrong too (the `nyc-dob-permit-issuance` trap).
The socrata connector has `recency_expr` for exactly this; **arcgis has no equivalent** — building one
is the durable fix and would retire all three constants.

**January action:** extend Worcester's window to include the new year (and consider dropping the
oldest), or ship `recency_expr` for arcgis and delete the constant. Verify after by counting
`LIKE '%/<new year>'` with the layer total as a positive control.

✅ **THIS ITEM IS NOW ENFORCED, NOT JUST SCHEDULED — `test/dated-window-must-not-go-blind.test.mjs`
(2026-08-04).** A recurring manual review is an instrument that cannot prove it ran, and it had
already failed once: the session that shipped `centre-county-pa-building-permits` did not register
it here, because the grep that would have found this item **read zero files and reported nothing** —
it ran from the wrong working directory with `2>/dev/null`, so every missing path was silent and
grep exited 0. *(Corrected: this was first written up as a stale-checkout effect. It was not — the
item was present in every tree the session had.)* The suite now derives the list from the registry itself and fails when an entry is **already
blind** (hard, always) or **goes blind at year-end** (unless named in its `EXPIRING_ACKNOWLEDGED`
ratchet). It ships a self-test proving the cliff/grace decision fires on each violation class, so
it cannot go vacuous. **Consequence to expect: Worcester will turn CI red on 2027-01-01** — that
is the alarm working, and the fix is one `OR LIKE '%/2027'` clause or the durable `recency_expr`.
Adding a new fixed-window entry now requires registering it in BOTH places or CI fails.

*(Audited across all 149 entries: 51 further arcgis entries carry no `recency_days` at all, which is a
different and deliberate choice — most are "active projects" layers where every row is current by
construction. Those are not on this list.)*

---

## 🧹 BATCHED CLEANUP — 14 arcgis `status_const` values name a bucket instead of the record

**Not urgent, not broken, and deliberately NOT failing the build — recorded so it is not invisible.**

`test/status-const-must-be-mapped.test.mjs` check 4 lists 14 entries written as
`status_const: "operating"` with `status_to_bucket: {operating: ["operating"]}` — circular, and the
pipeline's own bucket vocabulary sitting in a field meant for the publisher's word:

`nvdot-project-boundaries` · `new-castle-county-permits` · `loudoun-county-residential-permits` ·
`charleston-county-permits` · `huntsville-building-permits` · `chattanooga-permits-archive` ·
`knoxville-building-permits` · `desoto-county-permits` · `flathead-county-building-permits` ·
`aurora-building-permits` · `sheridan-county-building-permits` · `albuquerque-building-permits` ·
`thurston-county-residential-permits` · `fdot-active-construction-projects` (`"approved"`).

**Why it does not block:** they RESOLVE, so they pass the check that matters and emit records
normally — this is a naming rule, not the silent-nothing defect that suite exists to catch. The value
is one *we* authored (each is an issuance ledger with **no status column**, which is what
`status_const` is for), and its only surface is each record's `status_raw`, which nothing renders —
`lib/map.js:576` derives the displayed lifecycle from `bucket`. A rename therefore changes **no
resident-visible text** and would cost a re-cache of every page these 14 sources touch.

**The list is RATCHETED at 14**, so a new entry written to the wrong convention still fails CI.
**When to actually do it:** fold each rename into a re-cache those pages are getting anyway, never as
its own re-cache. Convention to follow: `detroit-building-permits` / `cleveland-issued-building-permits`
— `"Issued"` + `status_to_bucket.approved: ["Issued"]`. Drop the ratchet as the count falls.

---

## WORCESTER GO-LIVE — measured, and the baseline corrected my own expectation

**Deployed** (`get-address-report`, run 30773978256, green) **→ forced re-cache → materialized.**

⚠️ **The baseline, captured BEFORE the re-cache, corrected the premise.** The recon note said
"Lift: 15 modeled Worcester ZIPs if usable", implying dark pages. In fact **all 99 Worcester County
pages were ALREADY dev-backed** — every one carried ~270–404 records from
**`massdot-highway-projects`**, the statewide DOT layer (the same source that lifted Chester 01012 and
retired that exemplar). **So this wire adds DEPTH, not pages.** Counting it as a page lift would have
been wrong, and only the pre-mutation baseline showed that.

**Measured on the two city ZIPs whose re-cache completed:**

| ZIP | development before | after | of which `worcester-building-permits` |
|---|---|---|---|
| 01607 | 388 (MassDOT only) | **691** | **303** |
| 01608 | 404 (MassDOT only) | **528** | **124** |

**Invariants across all 380 materialized Worcester rows: 0 missing `record_url`, 0 missing
coordinates, 0 missing status.** (427 cached → 380 materialized is the exact-identity dedup in
`dev_sites_deduped()`, working as designed.)

**Bidirectional gate proof:** the four suburban Worcester-County ZIPs re-cached in the same batch —
01532, 01545, 01568, 01581 — took **0** Worcester records, because `Address LIKE '%<zip>%'` matches
only city addresses. Worcester records ride Worcester city pages and nowhere else.

**7 of 13 re-cache fires timed out at 120 s** — the engine under concurrent rolling-refresh load, the
known PGNET-503/timeout condition. Those ZIPs keep their prior rows and pick the new source up on the
rolling refresh; nothing was lost.

### The honest read on the reprobe seam
Worcester was **1 hit in 3** on the reprobe list (St. Paul and Syracuse both still stalled; KCMO
closed as stalled once its real column was read). The hit added **no new LIVE pages** — it deepened
two existing ones with genuine city permit records where previously only state highway projects showed.
That is a real quality gain for residents of those ZIPs and **not** a coverage-percentage gain. Any
future estimate of the reprobe seam's value should use that distinction: **a revival deepens pages
that a statewide source already lit; it only lifts pages where NO source reaches.**

### Worcester go-live COMPLETED — ALL 9 city ZIPs, 7,191 records (supersedes the 7-ZIP and 2-ZIP figures above)

The section above was written when only 01607/01608 had re-cached. Five more landed on a second
fire; the complete measurement:

| ZIP | before (MassDOT only) | after | of which `worcester-building-permits` | cache row |
|---|---|---|---|---|
| 01606 | 270 | **1,476** | 1,233 | 1.69 MB |
| 01605 | 380 | **1,327** | 969 | 1.50 MB |
| 01603 | 388 | **1,203** | 834 | 1.36 MB |
| 01609 | 391 | **1,031** | 703 | 1.20 MB |
| 01610 | 388 | **880** | 517 | 1.00 MB |
| 01607 | 388 | **655** | 303 | — |
| 01608 | 404 | **517** | 124 | — |

✅ **AMENDED 2026-08-03 — 01602 and 01604 picked the source up on the rolling refresh (00:45Z), so
all 9 city ZIPs are live, not 7.** The two that timed out under load did not need re-firing; waiting
was the correct call. Their numbers are the largest of the set:

| ZIP | before (MassDOT only) | after | of which `worcester-building-permits` |
|---|---|---|---|
| 01604 | 375 | **1,936** | **1,561** |
| 01602 | 366 | **1,560** | **1,194** |

**VERIFIED TOTAL: 7,191 materialized records across 9 ZIPs — 0 missing `record_url`, 0 missing
coordinates, 0 missing status, 0 rows outside the MA/Worcester gate** (keyed on
`source_ref like '%j8dqo2DJE7mVUBU1%'`, not on a title). Cache rows 0.15–1.69 MB, inside the ceiling.
The conclusion is unchanged: **depth, not pages** — all 99 Worcester County pages were already
dev-backed before this wire.

> ⚠️ **A wrong filter nearly turned a clean gate proof into a false alarm — third time this session.**
> The first proof filtered on `name ilike 'Building Permit%'` and reported **57,761 rows "outside
> Worcester County"**, which reads as a catastrophic gate leak. It is an artifact: that title is
> common to many cities' permit records. Filtering on the column that actually identifies the source —
> `source_ref like '%j8dqo2DJE7mVUBU1%'` — gives the real answer, **0**.
> Same class as `%opendataportal-lasvegas%` conflating two entries on one portal, and as the
> `%OpenData_Building_Permits_%` zero that matched nothing at all.
> **Key a source-scoped query on `source_ref`, never on a title, a name, or a portal domain** — those
> are shared across entries and produce both false zeros and false alarms.

### ⚠️ I MAY HAVE DEGRADED THE SHARED REFRESH WITH LONG-TIMEOUT FIRES — correlation, not proof

Stopped re-caching 01602/01604 after measuring this. Per-minute, from `net._http_response`:

| tick | 200 | 503 | **timeouts** |
|---|---|---|---|
| 23:30 | 145 | 54 | 1 |
| 23:45 | 130 | 68 | 2 |
| 00:00 | 142 | 56 | 2 |
| **00:16** | 29 | 33 | **138** |
| **00:18** | 5 | 0 | **45** |

Three consecutive healthy ticks (~145 OK / ~55 503 / 1–2 timeouts — the documented steady state), then
a collapse to **192 timeouts in 20 minutes, 71 % of all responses**.

**The correlation:** I fired 22 ad-hoc re-cache requests in that window with **deliberately long
timeouts — 120 s, then 150 s, then 180 s** — to survive an engine that was already slow. pg_net has
limited worker concurrency, so a long-timeout request *occupies* a worker for its full duration. 22
requests holding workers for up to 3 minutes each, on top of the rolling refresh's 250-per-tick, is a
plausible mechanism for starving the pool and timing out the scheduled batch behind me.

**It is NOT proven, and I am not recording it as established.** `net._http_response` does not retain
the request URL, so I cannot attribute the 138 timeouts at 00:16 to my requests versus the refresh's
own. The engine may have had an independent incident. This is exactly the shape the superseded
`worker_restart()` note got wrong — two events correlated, a cause inferred, guidance written. Recorded
here as an **observation with a hypothesis**, for the open **PGNET-503** investigation.

**What I changed anyway, because it is cheap and the downside is asymmetric:** stopped firing. The two
remaining Worcester ZIPs (01602, 01604) keep their MassDOT rows and will pick the source up on the
rolling pass. Deepening two pages a few hours sooner is not worth risking the refresh for all 12,722.

> ~~**Provisional guidance, to test rather than trust: raising a pg_net timeout to work around a slow
> engine may make the engine slower for everyone.** The timeout is not free — it is a worker-seconds
> reservation against a shared pool.~~ **TESTED 2026-08-03 AND THE STATED MECHANISM IS WRONG — see
> below.**

### ✅ RESOLVED BY EXPERIMENT — the timeout is a CEILING, not a reservation; the trigger is the TICK

The hypothesis above was testable rather than permanently unknowable, so it was tested instead of
left to harden into guidance.

**Conditions (verified before firing):** 13:22 UTC — minute 22, i.e. between the :15 and :30 rolling
ticks; **queue depth 0**; **0 responses in the previous 5 minutes**; and 500 responses / **3 timeouts
(0.6 %)** over the previous 30 minutes. A genuinely quiet window with no other load.

**The experiment:** 6 requests, **the same 150 s timeout shape that timed out during the incident**,
against already-live Worcester ZIPs so a re-cache is idempotent.

**Result: 6 / 6 HTTP 200, 0 timeouts.**

**What that establishes:** a long timeout **alone is not sufficient** to cause the failure. That
falsifies the mechanism I proposed — if a request reserved workers for its full timeout, six 150 s
requests would tie up the pool here too, and they plainly did not. **A pg_net timeout is a CEILING on
how long a request may run, not a reservation of worker-seconds.** Raising it costs nothing unless the
request actually runs long.

**The corrected reading of the incident:** under a rolling tick the engine is already 503-ing ~30 %,
so requests genuinely DO run long — and that is the only regime where the ceiling matters. My 22
ad-hoc requests collided with a 250-request tick; the trigger was **the collision**, not the timeout
value.

⚠️ **What the experiment does NOT isolate, stated plainly:** it varied **two** things against the
incident — 6 requests instead of 22, and off-tick instead of on-tick. So it proves "long timeouts
off-peak are safe" and does **not** separate count from timing. A 22-request off-tick run would
separate them, but it costs real load for information that would not change the action.

**Corrected guidance:** *fire ad-hoc re-caches BETWEEN rolling ticks (the tick fires at :00/:15/:30/:45
— aim for the middle minutes), and check `net.http_request_queue` is near zero first. The timeout
value is not the lever; the collision is.*

**A measurement limitation worth recording:** `net._http_response.created` is the request-CREATION
timestamp, identical for every row in a batch — **it is not a completion time**, so per-request
duration cannot be derived from this table. That is the same gap that made the incident
unattributable, and it is why the experiment had to be built around success/failure rather than
latency.

### PA reprobe pass 2 — one wire, two hosts that exist but do not answer, three still un-probed

Applying the enumerated / access-denied / unreachable rule to the six PA counties recorded as
"county-hub URL guesses 404'd":

| county | probe | basis | verdict |
|---|---|---|---|
| **Delaware** | `gis.delcopa.gov/arcgis/rest/services` | **ENUMERATED** — 36 folders, `SLD_Review` read | ✅ **WIRED** (29 dark pages) |
| York | `gis.yorkcountypa.gov` | **unreachable** — DNS RESOLVED, then timed out at 20 s *and again at 60 s* | provisional |
| Bucks | `gis.buckscounty.org` | **unreachable** — DNS resolved, timed out at 30 s | provisional |
| Chester | `arcgis.chesco.org` | **unreachable** — `Couldn't resolve host name` | 🔴 still a GUESS |
| Lancaster | `gis.co.lancaster.pa.us` | **unreachable** — `Couldn't resolve host name` | 🔴 still a GUESS |
| Centre | `gis.centrecountypa.gov`, `maps.co.centre.pa.us` | **unreachable** — both `Couldn't resolve host name` | 🔴 still a GUESS |

**York and Bucks moved from "guess" to "real host that does not answer."** Their DNS resolves — the
hostnames are correct — but the servers time out, York twice at 20 s and 60 s. That is a materially
different state from a name that does not exist, and it is worth knowing before the next attempt:
these may be firewalled to non-US egress, or genuinely down. Still **not** rejections.

**Chester, Lancaster and Centre remain UN-RUN PROBES.** My hostnames for them were invented and failed
DNS, which tells us nothing about those counties. Per the rule, "not found" from a guessed hostname is
not a rejection. **Do not record them as rejected, and do not keep guessing** — the next attempt needs
their real GIS hostnames, found from the counties' own sites rather than from a naming pattern.

---

### ✅ PA reprobe pass 3 (2026-08-03) — the "real hostname" instruction, carried out

Delaware is **WIRED, DEPLOYED, RE-CACHED AND MEASURED: 29 dark pages → 0, 40/40 pages carrying it,
5,180 rows.** Full receipts in `docs/source-registry.md` "DELAWARE COUNTY PA — GO-LIVE MEASURED".

Nine MORE hostname guesses for Chester/Lancaster/Centre **all failed DNS** — the pattern-guessing route
is exhausted and is recorded as such. What worked instead: **the county's own published GIS hub or
planning-commission host.** Two of the three named counties fell to it immediately.

| county | dark | outcome of pass 3 |
|---|---|---|
| **Chester** | 34 (of 39; the other 5 are New Castle border spill) | ✅ **WIRED, DEPLOYED, MEASURED → 34 dark = 0.** `chester-county-pa-act247-plans` (registry 150→151), layer 5 only. 39/39 pages carry it, 2,475 rows, 0 missing record_url/coords/use_type/**file_date**, 0 outside gate. PR #574. |
| **York** | 47 (of 47) | ✅ **SOURCE FOUND, LIVE, FRESH** — the earlier "real host that does not answer" was the **wrong host**: `yorkcountypa.gov` is the county portal, `arcweb1.ycpc.org` is the **Planning Commission**. 26,879 rows, POINT geometry, newest `DATE_RCVD` 2026-07-27. **Open design question before wiring: type is 8 YES/NO flags, not a column**, so a precedence rule must be chosen (it drives the pin SHAPE). |
| **Centre** | 35 | ✅ **SOURCE FOUND, FRESH** — `gissites4.centrecountypa.gov` `Building_Permits/MapServer/2`, 60,098 rows, 669 permits dated 2026 / 1,745 in 2025. ⚠️ **Its HUB does not list this layer** (100 datasets, 0 hits) — only the server's own root listing has it. Dates are `M/D/YYYY` STRINGS, so no `recency_days`; `OBJECTID DESC` is not date order. |
| Lancaster | 56 | ❌ **REJECTED — enumerated across 3 surfaces.** PASDA 22 layers, own server (`arcgis.` not `gis.`) 92+37=129 services, hub 4 admin pages. Zero activity layers; only zoning/planning-area boundaries. May be publishes-PRIVATELY (it sells "Paid Data"), which probing cannot reach. |
| Bucks | 50 | ❌ **REJECTED — STALLED 2023-10-26.** PASDA `BucksCounty/MapServer/6` "Proposed Developments" is the right shape (BCPC docket, real `DateReceiv` Date field, 1,343 rows) but only 46 rows in 3 years and nothing after Oct 2023. → nightly reprobe list. |

**Two standing answers earned in this pass:**
1. **A layer's DESCRIPTION can justify a wrong rejection — read the SCHEMA.** York's opens *"represents
   the geographic boundaries…"* (reads cadastral/static); its fields are a live plan-review docket.
2. **DCAT `modified` is metadata staleness, not data staleness.** Chester's catalogue says 2021-08-31
   while its newest record is 2026-07-30.

**Next action here is a WIRE, not a probe — the PA seam is fully resolved.** All six counties are now
decided on enumeration: 1 wired (Delaware), **3 sources found** (Chester 34 · York 47 · Centre 35 =
**116 dark pages**), 2 firm rejections (Bucks stale, Lancaster absent).

Readiness order (Chester DONE — 2 of 3 PA sources now live):
1. ~~**Chester**~~ ✅ **WIRED AND MEASURED, 34 dark → 0.**
2. **Centre (35 dark)** — NEXT. Ready to write after enumerating `Permit_Type` and `Open_Y_N`. String
   `M/D/YYYY` dates, so recency rides `extra_where`, never `recency_days` (frisco/worcester class);
   `OBJECTID DESC` is NOT date order on that layer; use the MapServer (FeatureServer is not enabled).
3. **York (47 dark)** — needs one DESIGN decision first: type is 8 YES/NO flags, not a column, and
   `use_type` drives the pin SHAPE. Do not guess a precedence rule.

**PA is now 560 pages / 158 dev-backed / 402 dark** (Delaware and Chester both at 0 dark). The two
found-but-unwired sources are worth **82 more pages**; after that the largest remaining PA target is
Allegheny (92 dark) and Montgomery (62), neither of which has a source yet.

**Standing answer earned here, worth applying to every future county: a hub catalogue is a PUBLISHING
CHOICE, not an inventory.** Centre's hub lists 100 datasets and omits its own permit service; the layer
exists only in the server's root listing. Enumerate `/arcgis/rest/services` before recording a rejection.
**And try PASDA first for any PA county** — `mapservices.pasda.psu.edu/server/rest/services/pasda/<X>County/MapServer`
resolved Bucks and Lancaster without needing their own hosts at all.

## PA SEAM — CLOSED (2026-08-04)

All six PA counties recorded as "county-hub URL guesses 404'd" are resolved.

| county | dark before | outcome |
|---|---|---|
| Delaware | 29 | ✅ wired (#570) → 0 dark |
| Chester | 34 | ✅ wired (#574/#575) |
| **Centre** | **35** | ✅ **WIRED + MEASURED (#577)** — 34/35 pages, 7,686 records; 1 honest zero (16686 Tyrone, 0 unwindowed = true absence) |
| **York** | **47** | ✅ **WIRED + MEASURED (#578)** — 46/47 pages, 2,444 records; 1 honest zero (17372 York Springs, 80 unwindowed / 0 windowed = no activity in 5 years) |
| Bucks | 50 | ❌ rejected — layer real but STALLED 2023-10-26 → reprobe list |
| Lancaster | 56 | ❌ rejected — no activity layer exists |

Both surfaces measured: `development_reports` 7,686 / 2,444; `app_projects` 35 pages / 7,879
rows and 47 pages / 3,060 rows. Across all 10,130 records: 0 missing `record_url`, 0 missing
coordinates, 0 unclassified. Bidirectional gate proof cache-wide: each source rides ONLY its
own county's pages.

**One decision is open for a founder ruling (reversible, one map):** York's use-flag
PRECEDENCE — `IND > COM > MF > MHP > SR > SF > AG > OTHER`, most intensive use wins. It sets
the pin SHAPE for the ~315 multi-flag rows (e.g. `SF+AG`, the second most common combination,
renders Residential). Full reasoning + the 32 measured combinations: docs/source-registry.md
"PA SEAM CLOSED".

**One observation logged, not filtered:** Centre's ledger includes minor residential work
("Roof over front deck", "12x24 Shed"). `include_types` is deliberately NOT set — `Permit_Type`
has no trades class to drop (unlike the WA/MN/IL and Aurora noise drops) and is not a proxy
for scale, since a `Dwelling` row can be a deck roof. No type whitelist separates minor from
major here.

## CLOSED 2026-08-04 — three founder rulings, recorded so they are not re-opened

| item | ruling | where recorded |
|---|---|---|
| **York `AG` renders as "Other project"** | **DECLINED** a new `use_type` category — a national rendering change for a 240-row local case. Honest ambiguity stands. | governance "Settled and CLOSED" |
| **Test account for the signed-in `property.html` dossier** | **DECLINED** — credentials in CI are a worse risk than an uncovered surface. `PARTIAL_SURFACES` naming the residual IS the handling. | governance "Settled and CLOSED" |
| **CI schedule for `verify-property-page`** | **APPROVED and armed** — daily 13:59 UTC + dispatch + path filters. | `.github/workflows/verify-property-page.yml` |

⚠️ **The stale-checkout mandate was issued on a WRONG CAUSE, and the founder corrected it.** The
missed dated-constants item was not a stale tree — it was `2>/dev/null` on a grep from the wrong
cwd, which exits 0 with no output. The governance doc now LEADS with that rule; the tree check is
kept but demoted to second-order. A plausible misdiagnosis costs more than an obvious one precisely
because it ships.

### `verify-property-page` — armed and MEASURED (2026-08-04)

Both post-merge confirmations the founder required are done, and neither was assumed:

- **Path filter registers.** The arming merge to `main` produced run **#1 via `push`** — distinct
  from the `workflow_dispatch` run #2. (Note the ordering constraint found here: a workflow must
  exist on the DEFAULT BRANCH before it is dispatchable — dispatching from the branch 404s — so
  both confirmations are strictly post-merge.)
- **Runtime measured → bound set.** Run `30922999400`: total **1 m 29 s**, of which the Playwright
  install is 75 s and the verify step itself **3 s**. `timeout-minutes` 20 (provisional) → **10**
  (~6.7x measured).
- **The run is not vacuous.** Its own output: *All 14 checks passed*, and §5 independently
  reproduced the DB figure — 78617 = **537 rows (508 development + 29 facility)**, 0 missing
  `source_ref` / coords / name.

## MICHIGAN — CLOSED (2026-08-05). **50 → 182+ / 360**, statewide DOT source wired

**Every MI county is now either wired or closed on enumeration.** One source wired:
`mdot-stip-projects` (statewide), the Michigan analogue of the already-live UDOT / TxDOT /
NDOT rows.

**Shape measured before probing** (the standing rule — and again the state-level framing was a
hypothesis, not a brief): "310 dark" is not uniform. Oakland alone was 78 of it, and **8 of 11
counties had zero wired source**, not partial coverage.

| county | pages | live before | live after | note |
|---|---|---|---|---|
| Wayne | 76 | 32 | **65** | Detroit ×3 already wired |
| Oakland | 87 | 9 | **48** | county GIS rejected; Independence Twp already wired |
| Macomb | 40 | **0** | **15** | no city/county source exists |
| Washtenaw | 20 | 9 | **14** | Ann Arbor already wired |
| Genesee | 26 | **0** | **11** | Flint org enumerated, 0 permit services |
| Kent | 37 | **0** | **9** | Grand Rapids STALE |
| Monroe | 17 | **0** | **7** | |
| Ingham | 24 | **0** | **6** | Lansing has no AGO org |
| Ottawa | 19 | **0** | **4** | county GIS enumerated, 0 permit services |
| Livingston | 13 | **0** | **3** | |
| Shiawassee | 1 | 0 | 0 | 1 page, no STIP project within 3 mi |
| **MI total** | **360** | **50** | **182+** | remaining ZIPs light as they re-cache |

The "after" column is measured with ~176 of 360 ZIPs re-cached through the post-deploy engine;
the rest still hold pre-MDOT cached rows and lift as the refresh reaches them. **Report the
denominator, not just the gain** — this number is a floor, not the end state.

### The host gamble paid off — and it was checked, not assumed

`mdotgis.state.mi.us` is **state-hosted, not `services*.arcgis.com`**, i.e. the Montgomery-OH /
Dayton class where a pg_net 200 proves nothing about the Deno edge runtime. Wired under §0's
wire-and-see (pg_net 200 = the required positive control) and then **verified from
`arcgis_reports` on the first post-deploy re-cache**: 16 of 16 responses carried an
`mdot-stip-projects` report — **149 fetched, 149 emitted, 0 quarantined**. The engine reaches
the host. Stored invariants across the first batch, with denominators: **136 of 136
`scope:"point"`, 0 of 136 missing `record_url`, 0 of 136 missing coordinates, 0 of 136
unclassified, 0 of 136 undated.**

### Rejections (receipts in docs/source-registry.md "MICHIGAN PASS")

- **Oakland County** — `WRONG_RECORD_CLASS`. Its only development-named layer is DDA/TIFA
  **district polygons** by the layer's own description.
- **Ottawa County** — `candidates_exhausted`. Both service folders enumerated: 0 permit services.
- **Grand Rapids / Kent** — `STALE`. FiscalYear stops at **2023**, last projected start
  **2022-07-01**, last edit **2017-10-05**; also only 32% of rows carry any date. → reprobe list.
- **Flint / Genesee, Lansing / Ingham, Macomb, Monroe, Livingston** — org- or keyword-scoped
  searches returned real non-empty result sets (109 / 48 / 12 / 142 / 145 items) with **zero**
  permit or development feature services. Negatives with stated, non-zero denominators.

### Method notes

- **"Check the registry before probing" is now the standard opening move** and it paid
  immediately: the grep showed all 5 pre-existing MI entries were city/township scoped, which is
  what made a *statewide* source the obvious play rather than another metro hunt.
- **URL-guessing county GIS hosts is not discovery.** All 8 first-pass host guesses failed;
  every real host was recovered from item URLs inside AGO search results.
- ⚠️ **`list_workflow_jobs` is stale too, not just the check-runs endpoint.** A `unit` job was
  reported `in_progress` for ~20 minutes when it had in fact completed **success in 2:18**. Two
  healthy runs were cancelled on that misreading. **Only `completed_at` appearing is reliable** —
  and note `timeout-minutes: 15` means a genuinely hung job cannot exceed 15 minutes, so any
  "still running" past that is the API lying, not a hang.
- ⚠️ **Local `node scripts/run-unit-tests.mjs` is a WEAKER instrument than CI** — Playwright is
  not resolvable in the sandbox, so browser-backed suites do not run locally. A local green does
  not license skipping CI.


### MICHIGAN — FINAL MEASURED RESULT (2026-08-05, all 360 ZIPs re-cached)

**MI 50 → 268 of 360 live (13.9% → 74.4%), +218 pages.**
**National 4,755 → 4,973 of 12,722 (37.38% → 39.09%), +218.**

| county | pages | before | after |
|---|---|---|---|
| Wayne | 76 | 32 | **69** |
| Oakland | 87 | 9 | **62** |
| Macomb | 40 | 0 | **28** |
| Kent | 37 | 0 | **25** |
| Genesee | 26 | 0 | **20** |
| Ingham | 24 | 0 | **17** |
| Washtenaw | 20 | 9 | **15** |
| Monroe | 17 | 0 | **12** |
| Ottawa | 19 | 0 | **10** |
| Livingston | 13 | 0 | **9** |
| Shiawassee | 1 | 0 | **1** |
| **total** | **360** | **50** | **268** |

**Every one of the 11 counties now carries live pages**, including all 8 that had zero.
The 92 still dark are ZIPs with no STIP project within the 3-mile radius — an honest empty,
not a wiring defect.

**Invariants across the FULL population, denominators stated (§0a):** 4,679 MDOT records on
228 ZIPs — **4,679/4,679 `scope:"point"` · 0/4,679 missing `record_url` · 0/4,679 missing
coordinates · 0/4,679 unclassified · 0/4,679 undated.** Pins span lat 41.732–43.323 / lng
−86.224 to −82.817, which is the southern Lower Peninsula — correct geography.

**Bidirectional gate proof, and NOT vacuous:** 0 MDOT records on any non-MI page, measured
against a non-zero class of 4,679 records actually emitted across 228 MI pages. (Had the entry
emitted nothing, this same zero would have read identically — which is the trap §0a exists for.)


### ⚠️ DO NOT CANCEL A CHECK THAT ONLY *LOOKS* HUNG (learned the hard way, 2026-08-05)

The GitHub check state for this repo lagged reality by **tens of minutes** during this session,
on BOTH `pull_request_read(get_check_runs)` and `list_workflow_jobs`. A `unit` job that had in
fact finished **success in 2:18** kept reporting `in_progress`, and the merge API — which reads
the same state — kept returning `405 … "unit" is in progress`.

**Cancelling makes it strictly worse.** Branch protection then blocks on
`… "unit" is cancelled`, which no amount of waiting clears, and `rerun_workflow_run` does not
reliably replace that terminal state. **The recovery is a new commit on the branch**, which
mints fresh check runs.

**The rule:** `unit-tests.yml` sets `timeout-minutes: 15`, so a genuinely hung job cannot exceed
15 minutes. Anything still reading "in progress" past that is the API lying — **wait, or push a
new commit; never cancel.**

## ELEVEN ZERO-COVERAGE STATES — 4 WIRED AND LIVE, 6 REJECTED, RI OPEN (2026-08-05)

**Metric reminder (§0e): the headline is `app_projects` where `record_kind='development'`.**

| metric | session start | measured |
|---|---|---|
| headline — `app_projects` `record_kind='development'` | 4,937 | **5,054** |
| cache — `development_reports` with `source_registry_id` | 4,973 | 5,090 |
| **materialization lag** | 36 | **36** (steady at every reading) |

### Wired, deployed, engine-verified, filling

| state | pages | before | measured | source |
|---|---|---|---|---|
| NJ | 359 | 0 | **35** | `nj-stip-projects` |
| VT | 212 | 0 | **33** | `vtrans-project-locations` |
| ME | 273 | 0 | **30** | `maine-dot-public-projects` |
| IA | 225 | 0 | **19** | `iowa-dot-bid-projects` |
| **total** | **1,069** | **0** | **117** | |

**~950 pages remain to fill and need NO intervention** — the round-robin re-caches every ZIP on
its own schedule. The figure above is a floor taken mid-fill, not the end state.

**New-host verification (the §0 requirement, done for ALL FOUR, not just the first)** — read from
`arcgis_reports` on the first post-deploy re-cache: NJ 16 fetched/16 emitted · ME 6/6 · IA 5/5 ·
VT 4/4, **0 quarantined on all four**. Both STATE-HOSTED sources (`gis.maine.gov`,
`maps.vtrans.vermont.gov`) reach the Deno edge runtime — the Dayton-class gamble paid off twice.
Stored invariants: **31 of 31 `scope:"point"`, 0 missing `record_url`, 0 missing coordinates,
0 unclassified, 0 undated.** Maine's records are point-scoped, i.e. the multipoint fix working in
production on a SECOND source.

### Rejected with receipts (6 states, 1,009 pages)

AK `NO_TEMPORAL_FIELD` (2,282 points and a real `Status`, but **zero date-typed fields**) ·
WV `candidates_exhausted` (`owner:WVDOT_Publisher` enumerated: 64 items, 0 project services) ·
NH / OK / ND / HI no first-party source (searches returned real non-empty result sets with zero
permit or project services — negatives with stated, non-zero denominators).

### Still open

**RI (81 pages)** — first-party (`risegis.ri.gov`, RI DOA administers the STIP) but the STIP is
**split across 15 program-specific layers** (Bridge / Pavement / Drainage / Traffic Safety / TAP /
Transit, each × points and lines) rather than one union, and the host needs a **90 s timeout**
(it times out at 30 s). That is several registry entries with a subset-identity proof per pair —
a design decision, not a mechanical repeat. **Then NY non-Suffolk.**

### The window finding that changed all four entries

**The 1825-day default is WRONG for STIP-class sources** and is omitted from all four. Measured:

| source | rows | 1825-day window | require-a-date |
|---|---|---|---|
| NJ `PROJ_RECD` | 264 | **28 (−89%)** | **246 (93%)** |
| IA `CONTRACT_AWARDED` | 362 | 128 (−65%) | **322 (89%)** |
| ME `conbegin_forecast` | 1,109 | 501 | **501 (45%)** |
| VT `ExpectedConstructionStart` | 1,037 | 344 | **337 (33%)** |

A backward window would discard 89% of New Jersey's CURRENT FY2024-2033 program because
`PROJ_RECD` is a receipt date. **ME publishes 45% of its layer and VT 33%** — stated ceilings,
not implied coverage.

## ✅ ELEVEN-STATE PASS CLOSED (2026-08-05) — 4 wired and live, 7 rejected

**RI resolved as `NO_TEMPORAL_FIELD` — the last item. Every one of the eleven is now wired or
rejected on enumeration.**

| metric | session start | closed |
|---|---|---|
| **headline — `app_projects` `record_kind='development'`** | 4,937 | **5,387** |
| cache — `development_reports` | 4,973 | 5,419 |
| lag | 36 | **32** |

**+450 pages on the headline metric this session** (12,722 total → **42.3%**).

### Wired and filling (4 states)

| state | pages | before | now |
|---|---|---|---|
| ME | 273 | 0 | **171** |
| VT | 212 | 0 | **112** |
| NJ | 359 | 0 | **94** |
| IA | 225 | 0 | **57** |
| **total** | **1,069** | **0** | **434** |

Still climbing on the round-robin with no intervention.

### Rejected with receipts (7 states, 1,090 pages)

| state | pages | disqualifier |
|---|---|---|
| NH | 247 | no first-party source (`owner:NHDOT` → 0 items) |
| WV | 212 | `candidates_exhausted` (DOT org enumerated: 64 items, 0 project services) |
| OK | 197 | no source found |
| ND | 155 | no first-party source (hits are City of Minot + a consultant) |
| AK | 101 | **`NO_TEMPORAL_FIELD`** — 2,282 points, real `Status`, **0 date-typed fields** |
| HI | 97 | no source found |
| RI | 81 | **`NO_TEMPORAL_FIELD`** — all 15 layers enumerated, **0 date-typed fields** |

⚠️ **`NO_TEMPORAL_FIELD` disqualified TWO states in this pass** (AK, RI), both of which otherwise
looked wireable — first-party, geolocated, per-record, and in RI's case with a real status column.
**A programme year (`FY2018`…`FY2027`, `STIP_Year`, `Year2`, `Program_Year`) is not a date.**
This is now the most common disqualifier after "no source at all".

### ⚠️ THE LAG SIGNAL FIRED — and it worked as designed

Mid-pass the materialization lag went **36 → 244** while the round-robin filled faster than
`app_refresh` materialized. That is exactly the widening-gap signal §0e says to watch. Fixed with
two `app_refresh_batch(1500)` calls: **244 → 72 → 32**. **Track the lag, don't just print it** —
had only the headline been read, 244 live-but-unmaterialized pages would have been invisible.

### Next

**NY non-Suffolk** (531 dark; Suffolk needs ten town wires and is deliberately last).

---

## CALIFORNIA — CLOSED (2026-08-05)

**Baseline: 523 pages, 137 lit, 386 dark, ten modelled counties.**

### Wired (1 live, 1 reverted — config only)

| entry | county | dark pages targeted | rows | outcome |
|---|---|---|---|---|
| `slo-county-planning-permits` | San Luis Obispo | **29** (0 lit before) | 50,969 | **LIVE — 26 of 29 pages now carry development records** |
| ~~`san-diego-county-discretionary-permits`~~ | San Diego | 53 | 50,306 | **REVERTED — `EDGE_EGRESS_BLOCKED`** |

⚠️ **The San Diego entry was wired, deployed, measured and un-wired in the same pass.** The layer is
live and fast from Postgres egress (200 in under a second, repeatedly) and its vocabularies are
exact — but the deployed engine timed out on it **20 times out of 20**, including once against an
idle queue. The gate failed closed: 0 emitted, a named quarantine reason, and **not one fabricated
record**. Removing it saves 115 San Diego pages a 30-second timeout per refresh in exchange for
nothing they were getting.

⚠️ **I first blamed the connector's `User-Agent`, and that claim does not survive its own control.**
`services3.arcgis.com` — Esri's own host — had already returned **400 "invalid header name"** to a
pg_net request carrying a custom User-Agent and **200** to the same request without one. Two
unrelated hosts failing that way indicts **pg_net's header serialisation**, not two coincidental
WAF rules. **Standing answer: pg_net custom headers are not a valid instrument for testing what a
host does with a header — probe bare, and suspect the instrument first.** The cause (edge-egress
block vs request-signature rule) is unresolvable from the sandbox and belongs on a GitHub runner.

Both vocabularies sum **exactly** to their layer counts (SLO `CaseType` 93 values → 50,969, proven
on both groupBy orderings; SD `PER_STAT` 11 values and `PER_TYPE_DESC` 69 values → 50,306).

### Rejected with receipts

- **Statewide (Caltrans)** — `WRONG_RECORD_CLASS`. The DCAT catalogue was enumerated in full:
  **69 datasets, 0 project layers** — all asset/network inventory. ⚠️ **California is the clean
  counter-example to §0c**: nine other states' DOTs publish projects; Caltrans publishes assets.
- **MTC (§0i regional fallback)** — `NO_TEMPORAL_FIELD`. The fallback *worked as discovery* and
  found the largest prize in the state (185 dark pages across six Bay Area counties), then the
  schema gate killed it: 2027 TIP, 2025 TIP and OBAG 3 all carry **zero date-typed fields and no
  status field**. SCAG 30 items / SANDAG 29 items: 0 project layers.
- **Seven counties** — Orange 85 · Alameda 51 · Contra Costa 43 · Sonoma 40 · Ventura 34 ·
  San Mateo 31 · Santa Clara 15. Every one exhausted at the county tier with non-zero denominators.
  ⚠️ **Ventura's Oil Permits are the near-miss**: 393 polygons, real `aprv_date`, a 4-value status
  vocabulary summing exactly to 393 — and `max(aprv_date)` = **2015-05-14**. `STALE`.
  **Check the max date before enumerating the vocabulary, not after.**

**Stamp: `MUNICIPAL_TIER_REQUIRED`** for the seven. ~304 pages would need ~80+ city wires at a
handful of pages each — an order of magnitude past §0k's >5-wires-at-<20-pages threshold.

### Next

**CT 269 dark**, then AL 237 · WA 225 · AZ 208 · UT 201 · OH 199 · IN 196 · WI 191 · MD 192.
UT is the flagged case — a statewide DOT source is already wired and the state is still at 35%,
so check whether UDOT's scope, window or radius is the limiter before assuming county work.
OH is already scoped in `docs/source-registry.md` and may already be `MUNICIPAL_TIER_REQUIRED`.

---

## WASHINGTON — CLOSED (2026-08-05). **137 → 336 / 362 (93%)**, one statewide DOT wire

**National: 5,449 → 5,648 distinct `app_projects` ZIPs with `record_kind='development'`
(42.83% → 44.40%).** Cache 12,722 rows, lag 0 (every WA target re-cached and materialized in
this pass).

- **Wired:** `wsdot-project-delivery-plan-{proposed,under-construction,complete}` — three entries
  over ONE WSDOT layer, split by disjoint `CURRENT_TIMESTAMP` predicates because the layer
  publishes no status column. 2,646 records across 199 of the 225 previously-dark pages.
- **The catch that defines the pass:** the obvious `OperComplete IS NOT NULL` design would have
  marked **586 not-yet-built projects as built**. Promoted to governance **§0l — a populated date
  field is not an assertion that the event happened** (with the CT 1900-sentinel and year-2222
  cases, and the ALDOT `RPT_URL` corollary).
- **Every previously-zero county is off zero** except single-page Whitman: Snohomish 32/33,
  Yakima 19/26, Whatcom 14/18, Skagit 12/14, Benton 9/10, plus Lewis / Kittitas / Stevens 1/1.
- **26 pages remain dark** — rural ZIPs with no capital project inside the 3-mile envelope.
  Honest empties, not defects. **Not `MUNICIPAL_TIER_REQUIRED`**: the remaining gap is 26 pages
  scattered across 10 counties, which is below any wire floor worth spending.
- **Invariants:** 0 missing `record_url`, 0 missing coordinates, 0 non-point scope,
  0 missing `use_type` across all 2,646 records. Gate proof: 0 WSDOT records on any non-WA page.
- **Stated ceiling:** `max(LastUpdated)` 2024-11-27 → WSDOT on the reprobe list.

### Correction carried into this item

**#610's merge title claimed "plus the WSDOT wire" and that diff did not contain it** — the
registry file was never edited, and a round was then spent diagnosing why the deployed engine had
"dropped" entries that had never been written. The instrument (grep over the deployed bundle) was
right; the assumption behind it was wrong. **Confirm the tree contains the change before
diagnosing why production lacks it** — this is the §0-2026-08-04b rule, and it was skipped.
The actual wire is #611.

### Reusable tooling added this pass (DB-side, not repo)

`public.dev_refresh_targets` + `public.dev_refresh_fire_targets(_batch)` — an explicit-ZIP-list
re-cache queue, because `dev_refresh_fire_batch` orders by global `refreshed_at` and cannot be
aimed at one state. Table truncated after use.

### Next under §0k

**AZ 208 · UT 201 · OH 199 · IN 196 · WI 191 · MD 192.** UT first: UDOT is already wired and UT
sits at ~35%, so check whether **scope, window or radius** is the limiter before assuming county
work. OH may already be `MUNICIPAL_TIER_REQUIRED` — check the existing record first.

---

## ARIZONA — CLOSED (2026-08-05). **156 → 224 / 364 (62%)**, one statewide DOT wire

**National: 5,736 distinct `app_projects` ZIPs with `record_kind='development'`.** All 208 dark
AZ ZIPs re-cached and materialized; cache 12,722 rows.

- **Wired:** `adot-tip-fy2026-2030` — ADOT's adopted FY2026-2030 Transportation Improvement
  Program. 159 records across 77 ZIPs, 141 point-scope. 0 missing `record_url`, 0 missing
  coordinates, 0 missing `use_type`. Gate proof: 0 ADOT records on any non-AZ page.
- **Five of six zero counties lifted:** Navajo 0→11, Yuma 0→7, Cochise 0→5, Mohave 0→3,
  Santa Cruz 0→2, plus Yavapai 1→7. Only single-page **Apache** is still dark.
- **Rejected with receipts:** `ADOTProjects_AZGEO` — named exactly like the target, self-labelled
  "ADOT Projects DRAFT", 57 rows, free-text prose `Status` whose top value is an unedited template
  placeholder. `lyrTIPAdoptions_Tentative2731_view` — a **59% duplicate** (146 of 247 shared
  `TIP_ID`s); wiring it would put contradictory stages on one page.
- 🛑 **The remaining 140 are `MUNICIPAL_TIER_REQUIRED`** — Kingman/Lake Havasu 21, Show
  Low/Winslow 21, Prescott 20, Sierra Vista/Douglas 17, Nogales 5 and the Maricopa/Pima rural
  fringe: **more than ~5 wires, each under 20 pages.** Scoped finding, not abandonment.
- **Stated ceiling:** `dataLastEditDate` 2025-06-25 (annual programme cadence). ADOT on the
  reprobe list; when FY27-31 is adopted, **replace** this entry rather than supplement it.

### The defect this pass produced — now a standing answer

The entry shipped without `lat`/`lng` in `column_map`, so 128 of its first 129 records came back
**area-scoped at the report centroid instead of pinning**, and AZ moved only 156 → 157. The layer
was fine; `featurePoint()`'s derived point lands in the synthetic `__lat`/`__lng` columns, which
only reach the record if `column_map` maps them.

> **An arcgis entry on a NON-POINT layer must declare `lat: "__lat"`, `lng: "__lng"`.** Otherwise
> records list, carry a `record_url`, render — and never pin, never count as LIVE.

WSDOT was immune only because it has native lat/lng columns, which is why this survived the WA
pass. **What caught it was the arithmetic — +1 page against 68 ZIPs of cached records.** Fixed
and re-cached same day (#614).

### Also learned: pre-wire yield probes were wrong in BOTH directions

AZ probes said Cochise 0 and Yavapai 0; the wire lit 5 and 7 pages there. WA probes over-predicted
by ~25%. **A single-ZIP probe samples one 3-mile circle in a county of thousands of square miles —
it orders candidates, it does not size them, and a zero at the county seat is not a zero for the
county.**

### Next under §0k

**UT 201 · OH 199 · IN 196 · WI 191 · MD 192.** UT first: UDOT is already wired and UT sits at
~35%, so check whether **scope, window or radius** is the limiter before assuming county work —
and check UDOT's entry for the `__lat`/`__lng` defect above. OH may already be
`MUNICIPAL_TIER_REQUIRED`; check the existing record first.

---

## NATIONAL §0n SWEEP — CLOSED (2026-08-05). 5 defective entries, 13,082 records recovered

Run before UT at the founder's instruction, after the Pierce saturation finding.

### The scoreboard is now TWO numbers (§0q), reported on every state close from here

| | value |
|---|---|
| **COVERAGE** — lit pages / 12,722 | **5,863 = 46.09%** |
| **COMPLETENESS** — median records / lit page | **62** |
| **COMPLETENESS** — p10 records / lit page | **2** |
| pages lit by exactly **1** record | **422** |
| pages under 5 records | **1,130** (19.3% of lit) |
| total development records | 2,772,675 |

**p10 of 2 against a median of 62 is a thirty-fold spread.** Every state summary before today
reported the top of that range; the bottom was invisible.

### The hunt found three more Pierce-shaped entries — all now fixed and at 100%

| entry | before | after |
|---|---|---|
| `columbus-building-permits` | 13,269 / 14,503 (91.5%) | **14,497 / 14,503 (100%)** |
| `clark-county-active-dev-permits` | 222 / 296 (75.0%) | **346 / 346 (100%)** |
| `bellevue-permits` | 318 / 349 (91.1%) | **350 / 350 (100%)** |

Plus the two already fixed: Pierce 2,255 → 13,003 and Butler 158 → 1,201.
**Session total: 13,082 records recovered from listed-but-unpinned to pinned**, and ~13,800 more
upgraded from interpolated geocodes to the publisher's own parcel points.

### ⚠️ A correction to my own prior audit, on the record

The earlier pass classified nine of the eleven no-lat/lng arcgis entries as *"the legitimate
geocode path, 75%–98.4%, healthy."* **That was an inference from an `address` column plus a
good-looking percentage — not a measurement of the layer — and it was wrong for three of them.**
They scored well *because geocoding mostly works*, which is exactly what hid the config bug.

**The distinguishing check is one field:** `"type": "Table"` with `geometryType: null` is a real
geocode path; `"Feature Layer"` with a `geometryType` is the §0n defect.
**Final split: 5 defective · 6 genuine Tables** (virginia-beach, naperville, boulder, worcester,
anaheim, hartford).

### No sixth Pierce exists

After the fixes, only geocode-path Tables and small null-coordinate residues remain below 95%
pinned. The largest remaining unpinned pool is `virginia-beach-building-permits` at 1,052 of
15,161 (93.1%) — genuine geocode failure on a geometry-less Table, a data-quality ceiling rather
than a config bug.

### Rules added

**§0q** the two-number scoreboard · **§0r** measure the symptom across the population before
probing any candidate's config, plus its corollary that a healthy-looking percentage is not proof
of a healthy mechanism.

### Next under §0k

**UT 201 · OH 199 · IN 196 · WI 191 · MD 192**, reporting coverage AND completeness on each close.
UT first: UDOT is wired and UT sits at ~35%, so check whether **scope, window or radius** is the
limiter. UDOT already passes the `__lat`/`__lng` check — it appeared in the clean native-lat/lng
audit at ≥95.8%.

---

## UTAH — CLOSED (2026-08-05). **NO WIRE.** 109 / 310 (35.2%), median 3, p10 1

First state closed on the two-number scoreboard, and the second number is the story.

| | UT | national |
|---|---|---|
| **COVERAGE** | **109 / 310 = 35.2%** | 5,868 / 12,722 = 46.12% |
| **COMPLETENESS** median records / lit page | **3** | 62 |
| **COMPLETENESS** p10 | **1** | 2 |
| pages lit by exactly 1 record | **33 of 109** | 420 |
| pages under 5 records | **63 of 109** | 1,125 |
| total records | 1,722 | 2,777,632 |

- ✅ **The scope/window/radius hypothesis is REFUTED with receipts.** `udot-active-projects` is
  correct as configured. It filters `All_Projects` (2,145 rows, vocabulary sums exactly) down to
  358 via `NOT IN ('Closed','Abandoned')` — and including `Closed` would have been a fabrication:
  **1,319 of its 1,368 Closed rows (96%) carry NO completion date**, only 49 have a past one, and
  `Abandoned` with a past completion date returns 0. No `recency_days`, standard 3-mi radius.
  **358 rows is UDOT's real ceiling.**
- **The limiter is the municipal tier.** UDOT alone carries all 109 lit pages (957 records,
  8.8/zip); only 16 ZIPs have any city source (SLC 12, Provo 4).
- 🛑 **`MUNICIPAL_TIER_REQUIRED` + `candidates_exhausted`** — three enumerations empty with
  non-zero denominators: state clearinghouse 608 datasets (8 permit-titled, all environmental) ·
  Washington County's real `BuildingPermits` layer **STALE at 2021-10-01** on two agreeing
  instruments · a 3,186-result AGO permit search yielding only out-of-state lookalikes, with
  St. George's own 93 items containing zero permit layers and `opendata.utah.gov` 404.
- **New standing answer:** a GUESSED orgid can return HTTP 200 with 370 KB of *genuine* services
  belonging to someone else (the guess at St. George returned Azerbaijan/Grenada/DC/Coronavirus
  layers). Read the service NAMES before believing a 200.

### What the completeness number changed here

Weber is **14/14 lit at median 12**; Davis is **12/14 lit at median 2**. Coverage alone reads them
as near-equivalent. The 93 UT pages whose only source is UDOT sit at 1–3 records each — a Utah
municipal source would raise the MEDIAN far more than the PAGE COUNT, the exact reverse of the
Pierce case. Logged as a completeness item.

### Next under §0k

**OH 199 · IN 196 · WI 191 · MD 192**, coverage AND completeness on each close. OH may already be
`MUNICIPAL_TIER_REQUIRED` — check the existing record first.

---

## DOT_ONLY RETRO-STAMP (2026-08-05) — measured, and it CORRECTS the intuition

Stamped where **≥80% of a state's lit pages have a DOT layer as their only source** (§0s). These
states are **correctly closed — nothing to redo** — but a future session should read them as
*broad and shallow* (or, for two of them, broad and deep) rather than finished.

| `DOT_ONLY` | lit | DOT-only % | median | read as |
|---|---|---|---|---|
| **ME** | 171 | 100% | 2 | broad, very shallow |
| **NJ** | 164 | 100% | 3 | broad, very shallow |
| **VT** | 113 | 100% | 2 | broad, very shallow |
| **IA** | 60 | 100% | 2 | broad, very shallow |
| **MA** | 624 | 90% | **68** | broad **and deep** |
| **UT** | 109 | 85% | 3 | broad, very shallow |
| **FL** | 378 | 84% | 8 | broad, shallow |
| **MI** | 287 | 83% | 11 | broad, shallow |
| **CT** | 104 | 82% | **76** | broad **and deep** |

### ⚠️ Two corrections the measurement forced

1. **`DOT_ONLY` does NOT imply shallow.** MA (median 68) and CT (median 76) are DOT-dominated and
   deep — MassDOT and CTDOT are dense programmes in small dense states, so a 3-mile envelope
   catches many. Thinness tracks **project density per unit area**, a property of the state, not
   of the source class.
2. **AL is NOT `DOT_ONLY` — measured 26%, median 796.** Its two ALDOT wires added just **9** pages
   to a state already carried by `huntsville-building-permits`. **WA (53%), TX (43%), NV (42%) and
   AZ (30%) are mixed too**, despite the DOT wire being the headline of each pass.
   **The wire that made the headline is often not the source carrying the pages — measure the
   share, don't infer it from the pass title.**

⚠️ The first version of this query reported **CT at 244% DOT-only** — impossible on its face,
which is the only reason it was caught before publication. Recorded in §0s: *any share that can
exceed its own denominator is a query to re-derive, not a finding.*

---

## OHIO — RE-CONFIRMED CLOSED (2026-08-05). 136 / 335 (40.6%), median 186

**No new wire. OH was already closed on enumeration in an earlier pass and remains so** — every
county wired, partially wired, blocked or exhausted. This pass ran its one named open item.

| | OH | national |
|---|---|---|
| **COVERAGE** | **136 / 335 = 40.6%** | 5,868 / 12,722 = 46.12% |
| **COMPLETENESS** median records / lit page | **186** | 62 |
| DOT-only share | **0%** | — |

**OH is the opposite shape to Utah: narrow and deep.** Its lit pages carry a median of 186 records
(Cuyahoga 2,171, Franklin 275, Delaware 79, Hamilton 78) because it is carried entirely by city
permit ledgers — Cleveland, Columbus, Cincinnati — with no DOT wire at all. Utah is 35% coverage at
median 3; Ohio is 41% coverage at median 186. **Coverage alone reads them as near-equivalent.**

### The one open item, tested and closed negative

**Dayton / Montgomery — 39 pages, OH's largest fully-dark county.** Re-wired, deployed, probed,
reverted. The edge-egress block has **not** lifted: the deploy-verification probe on 45309 returned
`fetched: 0, emitted: 0` with `client error (Connect): Connection reset by peer (os error 104)` —
byte-identical to 2026-08-04. Host still serves 264 rows at HTTP 200 to `pg_net`, which remains
irrelevant to the question.

⚠️ **`counts.development: 0` on that page is indistinguishable from a legitimately empty rural
ZIP.** Only `arcgis_reports[].quarantined[].reason` separates "could not connect" from "fetched and
found nothing". A `counts`-only check would have recorded *"Dayton wired, 0 records, thin county"* —
a wire producing nothing, reported as coverage.

**Dayton stays on the reprobe list** (config proven, parked in #594 and the source registry — a
one-object re-add). **Re-test no more often than monthly**: the block has held across two tests a
day apart and nothing on our side influences it. The proposed **edge-reachability preflight** would
have collapsed both deploy cycles into one probe — still proposed, still not built, and this is the
second time it would have paid.

### Remaining OH dark, all previously closed on enumeration

Montgomery 39 (blocked) · Lucas 30 (`NO_TEMPORAL_FIELD`) · Summit 27 (partially wired — county
reviews unincorporated townships only) · Hamilton 22 · Medina 19 (exhausted) · Delaware 15 ·
Warren 15 (exhausted) · Butler 15 (exhausted) · Cuyahoga 13 · Franklin 4.

### Next under §0k

**IN 196 · WI 191 · MD 192**, coverage AND completeness on each close, plus the `DOT_ONLY` stamp
where it applies.

---

## INDIANA — CLOSED (2026-08-05). **NO WIRE.** 2 / 198 (1.0%), median 1

The lowest-covered state in the country, and it stays that way.

| | IN | national |
|---|---|---|
| **COVERAGE** | **2 / 198 = 1.0%** | 5,868 / 12,722 = 46.12% |
| **COMPLETENESS** median records / lit page | **1** | 62 |

⚠️ **Indiana has ZERO pages lit by an Indiana source.** Its only two lit pages are lit by
`chicago-building-permits` spilling over the state line — Hammond 46327 (1 record) and Whiting
46394 (19), both within 3 mi of Chicago. Marion (Indianapolis) 40 pages, Allen (Fort Wayne) 33 —
all dark. Nine of ten counties at literal zero.

### 🔴 The §0c first move failed on the MERITS, not on reachability — a first

**INDOT publishes a maintenance-defect system, not a project register.** Its org is real and active
(193 items, 42 services) and consists of `INDOTGenDef_*` — Pothole, Graffiti, DeadTree,
DamagedGuardrail, Striping, SignalMalfunction, WaterPollution (18 services) — plus reference
geometry, toll-road ops and field-crew QA layers. **No capital-project, STIP, TIP or construction
layer exists.**

The one project-shaped trail — a **2017 `STIP Project Viewer`** — was followed to its end via the
web-map → `operationalLayers` path. Its backing services live on `gis.in.gov` and `gisq.in.gov`,
**both of which fail DNS**. Indiana's current state server `gisdata.in.gov` (live, ArcGIS 11.5) has
**no DOT folder**. The data did not move; it stopped being published.

### Rejected with receipts

`INDOT Projects` 3 rows / 2016 / owner `arcgis_svc` · `TIP_Point` 4 rows / **CDM Smith** ·
`CR Projects` / **HNTB** · Indianapolis `data.indy.gov` 651 datasets whose 31 permit-titled
candidates are **all historical zoning ORDINANCES with no REST URL** · Fort Wayne nothing ·
IndianaMap 554 items yielding only Richmond (pop 35k) and Demotte (pop 5k).

⚠️ **Provenance rule reinforced:** a plain `INDOT` search returns 776 items whose four most
project-shaped hits are owned by **private consultancies and service accounts** — HNTB, CDM Smith,
`arcgis_svc`. They rank because "INDOT" is in their metadata. **The word in the title is not the
publisher; check `owner`.**

### 🛑 `candidates_exhausted` + `MUNICIPAL_TIER_REQUIRED` + new: `NO_DOT_PROJECT_REGISTER`

Five enumerations, all empty with non-zero denominators. **Indiana is not a wiring problem, it is a
publication gap** — the statewide DOT exists, is active, is first-party and is reachable, and does
not publish the class of record we need. Distinct from every prior DOT rejection, which failed on
reachability, staleness or vocabulary. → reprobe list, low priority.

### Next

**WI 20 lit / 211 (median 140) · MD 125 / 317 (median 22).**

---

## WISCONSIN — CLOSED (2026-08-05). **20 → 198 / 211 (93.8%)**, largest gain of the run. `DOT_ONLY`

| | WI before | WI after | national |
|---|---|---|---|
| **COVERAGE** | 20 / 211 = 9.5% | **198 / 211 = 93.8%** | **6,279 / 12,722 = 49.4%** |
| **COMPLETENESS** median | 140 | **6** | 62 |
| p10 | — | **1** | 2 |
| pages at exactly 1 record | — | **27** | — |

- **Wired:** `wisdot-highway-program-6yr` — WisDOT's own `dotmaps.wi.gov`, 6-Year Highway
  Improvement Program, 1,750 rows. **1,612 records / 180 ZIPs, 100% point-scope, 0 missing
  `record_url`, 0 missing coords, 0 on any non-WI page.**
- **All NINE zero counties lifted** — Milwaukee 0→36 (100%), Racine 0→14 (100%), Washington 0→13
  (100%), Waukesha 0→25, Outagamie 0→18, Brown 0→16, Eau Claire 0→14, Kenosha 0→10, Ozaukee 0→7.
  13 pages remain dark: rural ZIPs with no programmed project in a 3-mile envelope.
- **Only layer 1 wired** — layers 0/1/2 are byte-identical-schema views of one table (931 / 1,221 /
  1,750) selected by its own `LET_2YR`/`LET_6YR`/`STIP_4YR` flags. Wiring more would triple-emit.
  **Identical schemas across sibling layers = filtered view; check before wiring a set.**
- ⚠️ **`COUNTY` is right-padded and produced a WRONG ZERO on the biggest target.**
  `COUNTY='MILWAUKEE'` → 0; `LIKE 'MILWAUKEE%'` → 94. Affects recon, not production (connector
  trims), but a padded-column zero is indistinguishable from a real absence — the `'Box Elder'` vs
  `'Box Elder County, UT'` class.
- **§0l on both dates:** `LET_DATE` 1,733 future / 17 past; `PROJECT_COMPLETION_DATE <= now` = **0**.
  Nothing is built → `proposed` for the whole layer. The 17 let-but-incomplete rows are disclosed
  and deliberately left in `proposed` — understating a stage is the safe direction, and it differs
  from ADOT-TIP-as-`approved` because each follows its own publisher's signal.

### 🔑 The completeness dilution, watched happening

**Median 140 → 6.** Nothing got worse: 178 thin DOT pages joined 20 deep Madison permit pages and
the median moved to where the mass is. Coverage-only, this is an unambiguous triumph. Both numbers
tell the truth: **WI went from a one-city state to a broad-and-shallow `DOT_ONLY` state**, and its
next unlock is Milwaukee municipal permits, which would move the MEDIAN far more than the page
count. **§0s's prediction observed live rather than inferred from a cross-section.**

### Next

**MD** (125 / 317, median 22), then the national remaining-states report.

---

## MARYLAND — CLOSED (2026-08-06). **125 → 234 / 317 (73.8%)**. `DOT_ONLY` does NOT apply

| | MD before | MD after | national |
|---|---|---|---|
| **COVERAGE** | 125 / 317 = 39.4% | **234 / 317 = 73.8%** | **6,493 / 12,722 = 51.0%** |
| **COMPLETENESS** median | 22 | **4** | 62 |
| p10 | — | **1** | 2 |
| pages at exactly 1 record | — | **49** | — |

- **Wired:** `mdot-sha-project-portal` — MDOT SHA's Project Portal, 293 point rows,
  `dataLastEditDate` **2026-08-04**, the freshest DOT source wired in this run.
  **309 records / 109 ZIPs, 100% point-scope, 0 missing `record_url`, 0 missing coords, 0 missing
  `use_type`, 0 on any non-MD page.** Both buckets exercised: approved 173 / proposed 136.
- **Four of six zero counties lifted:** Anne Arundel 0→27, Frederick 0→15, Charles 0→6, Calvert
  0→3. Harford 1→18, Howard 3→16, Queen Anne's 2→10, Baltimore 46→55. **Cecil and Wicomico (1 page
  each) stay dark** — single rural ZIPs with no SHA project inside 3 mi.
- **§0u mattered here.** The richest items are owned by `marshall.stevenson1`, which reads like an
  individual; confirmed first-party **by ORG, not by name** — that account and `MDOTSHA.GIS` publish
  to the same hosted org `njFNhDsUCentVYJW`. Two siblings discarded on the same check: they point at
  `https://shagbegis1/`, an internal hostname with no domain.
- **§0l, inverse shape:** 133 rows carry an estimated completion date in the PAST, and **103 of
  those are `Phase='Construction'` while `Project_Status` says In Progress.** A past *estimated*
  completion means the estimate slipped, not that the project finished — reading it as built would
  have marked 103 in-progress projects as operating. WSDOT was a future-scheduled date read as done;
  this is a past-estimated date read as done. **Same rule from the other side.**
- **§0o, harder than RPT_URL:** `Project_Portal_URL` is populated on 292/293 but has only 135
  distinct values — **155 rows carry the placeholder `bit.ly/MDOT-SHA-No-Project-Portal-Page`**
  while 137 carry a genuine per-project page (155 + 137 = 292 exactly). Record-precise **47% of the
  time**, which is *worse to detect* than a uniformly-wrong column. Not mapped; precision `dataset`.

**Not stamped `DOT_ONLY`:** MD keeps Montgomery (48/48) and Baltimore County on municipal permit
sources, so SHA is additive rather than sole. The median fell 22 → 4 by dilution, the same shape as
WI — 109 thin SHA pages joining 125 deeper permit pages.

**83 pages remain dark**: Frederick 18, Charles 17, Calvert 10, Baltimore 13, Anne Arundel 10,
Queen Anne's 6, Howard 5, Harford 2, Cecil 1, Wicomico 1.

---

# 🇺🇸 NATIONAL STANDING — 2026-08-06, from the scoreboard

**The state list is done. This is what the numbers say remains, ordered by the data rather than by
any prior ordering.**

| | value |
|---|---|
| **COVERAGE** | **6,493 / 12,722 = 51.0%** |
| **COMPLETENESS** median records / lit page | 62 (national) |
| total dark | **6,229** |
| states at literal ZERO | **7**, holding **1,090** pages |
| dark in partially-covered states | **5,139** |

## 🔴 THE BIGGEST RECOVERABLE BLOCK IS A CATEGORY, NOT A STATE: 7 states at ZERO

⚠️ **UPDATED 2026-08-13 — this block was wrong in TWO ways. It is now THREE states / 448 pages.**

**(1) TWO ARE DONE**, both on a single DOT wire and both landing at or above the predicted ~78%:
**OK 0 → 154/197 (78.2%)** and **NH 0 → 207/247 (83.8%)**. The thesis is now measured twice on
states it was not fitted to. The prediction was "one wire per state, no municipal tier, no
per-county fan-out"; that is exactly what both took.

**(2) AK AND HI WERE NEVER AT ZERO — they were listed here in error.** Measured on `app_projects`
2026-08-13: **AK 28/101**, all 28 pages and all 909 records from `akdot-stip-24-27`; **HI 85/97**,
all 85 pages and all 1,848 records from `hdot-active-design-projects`. Both entries were already in
the registry and already emitting. Do NOT hunt a new source for either — HI at 87.6% is one of the
better-covered states in the system, and AK's gap is a REACH question about an existing entry
(Alaska ZIPs are enormous and the 3-mile radius is the binding constraint), not a discovery problem.

**~~NH 247~~ · WV 212 · ~~OK 197~~ · ND 155 · ~~AK 101~~ · ~~HI 97~~ · RI 81 = WV + ND + RI = 448
pages across THREE states genuinely at zero, none ever probed in this run.**

Every one is a **whole-state greenfield**, and the §0c first move has never been tried on any of
them. On this run's evidence a statewide DOT wire alone took **WI 9.5% → 93.8%** and **MD 39% →
74%**; even INDOT's failure was informative in one pass. **These seven are where the next
1,000 pages are, and they are the cheapest per page of anything remaining** — one wire per state,
no municipal tier, no per-county fan-out.

⚠️ **NH at 247 pages is larger than Indiana, Utah or Wisconsin were**, and it has never been
looked at.

## The three shapes of what remains, and they need different work

**1. BROAD AND SHALLOW — `DOT_ONLY`, needs municipal permits, will move the MEDIAN not the count.**
NJ 74% / median 3 · MD 74% / 4 · ME 63% / 2 · VT 53% / 2 · IA 27% / 2 · UT 35% / 3 · WI 94% / 6 ·
FL 86% / 8 · MI 81% / 11. **Their pages exist and are nearly empty.** Highest-value: **WI Milwaukee,
MD Baltimore/Anne Arundel, MI Detroit-adjacent** — dense metros already covered but thin.

**2. NARROW AND DEEP — one or two cities carrying the state, needs COVERAGE.**
SD 9% / median 13,064 · AR 16% / 3,607 · KS 38% / 2,202 · GA 46% / 1,540 · MT 10% / 1,674 ·
MN 20% / 1,201 · SC 16% / 884 · NC 75% / 646 · MS 9% / 506 · VA 49% / 473. **A high median on a low
lit count is one deep city, not a healthy state** (§0s). Their unlock is a statewide DOT or a
second metro.

**3. LARGE AND GENUINELY HARD — already worked, blocked on structure.**
🔴 **SUPERSEDED IN PART, 2026-08-13 — three of these were NOT blocked on structure.** NY, IL and OH
were each closed here on a county-level enumeration, and each had a **statewide DOT layer that was
never looked for**. Wired in one pass: **NY 531 dark → 158** (`nysdot-capital-program-projects`;
the "no statewide source exists" claim was simply wrong), **IL 218 → 73** (`idot-annual-program-*`),
**OH 199 → 87** (`odot-current-projects` on TIMS). **Do not read a `MUNICIPAL_TIER_REQUIRED` stamp
as covering the state register** — the stamp was earned against counties and says nothing about the
DOT. Remaining in this category, still unworked against a statewide source: **CA 360**
(`MUNICIPAL_TIER_REQUIRED`, 7 counties — Caltrans is self-hosted, see the edge-egress blocker) ·
**PA 210** · **IN 196** (`NO_DOT_PROJECT_REGISTER` — INDOT's register was probed and is a genuine
publication gap, unlike NY/IL/OH) · **UT 201** (`candidates_exhausted`). **~967 pages, not 1,915.**

## Recommended order for whatever comes next

1. **The zero states — now THREE, 448 pages** (was 7 / 1,090). Two are DONE on one wire each,
   2026-08-13: **OK 0 → 154/197 (78.2%)** and **NH 0 → 207/247 (83.8%)** — the proof of this item
   rather than a claim about it, and ~78% is the yardstick to expect. **AK and HI were never at
   zero and are struck from the list** (28/101 and 85/97, both already served by existing registry
   entries). Genuinely remaining: **WV 212 · ND 155 · RI 81**. Still the cheapest per page on the
   board. Expect the source to be UNSEARCHABLE — on both wires so far the register sat on a state
   DOT host that no ArcGIS Online search returned, and was found only by walking a web map's
   `operationalLayers`.
2. **Municipal permits for the thin `DOT_ONLY` metros** — Milwaukee, Baltimore, Anne Arundel.
   Moves completeness, which is the half of the scoreboard that has never been worked.
3. **The 1,125 pages under 5 records nationally** (§0q) — a queue in its own right; worth measuring
   whether they cluster by state or by source before touching.
4. **Leave category 3 alone** until there is a new instrument (a vendor adapter, a permit-portal
   family, or the edge-reachability preflight).

## PENNDOT STATEWIDE RECON — COMPLETE; registry entry PROPOSED, awaiting founder review (2026-08-17)

Founder-approved evidence-first recon (owner-account style). Four probe rounds via `recon-fetch.yml`
(runs 32044964903 / 32046075961 / 32046719205 / 32047475605, target lists committed as
`scripts/recon/pa-penndot-round{1..4}.json`, PRs #768–#771). **Every receipt below is from those
job logs.** Outcome: **one qualifying statewide register found — PROPOSE-ONLY handoff delivered;
nothing wired.**

- **Org name confirmed, never the acronym** (NDOT/Nevada lesson): AGO org `PennShare`
  (id `jOy9iZUXBy03ojXb`) opens its own description "Introducing PennDOT One Map". The register
  itself sits on the agency's own server `gis.penndot.pa.gov/gis/rest/services/opendata` — no
  AGO-hosted mirror exists (185 org feature services paged; only wrong-agency DGS, a Blair County
  subset, and a May-2023 snapshot).
- **SUPERSEDES the 2026-07-31 `paprojects` rejection shape**: the old `gis.penndot.gov` …
  `paprojects` folders bake status into LAYER NAMES (one entry per status layer, `status_const`
  each). The One Map opendata layers carry status/stage as ATTRIBUTES on a single layer — the
  normal `status_to_bucket` path, no per-status split.
- **Two layers, SAME projects — the id-overlap discriminator (Nebraska/Minnesota) says wire ONE.**
  `transportationprojectslines/MapServer/0` (194,354 polyline rows) and
  `transportationprojectspoints/MapServer/0` (166,571 point rows) share the full MPMS schema, and
  on the identical where clause ordered `PROJECT_ID ASC` both heads return the identical six ids
  (328/333/334/426/516/592, Crawford County bridges, same titles). Wiring both = double-emission
  (the Houston layer-0/layer-1 class). **Proposed wire target: POINTS** — native
  `esriGeometryPoint` (no polyline-midpoint approximation), UDOT precedent.
- **Vocabularies COMPLETE, each summing exactly to its total:** lines PROJECT_STATUS 8 code/desc
  pairs → 194,354 · lines PROJECT_STAGE 5 values → 194,354 · stage×status crosstab 25 cells →
  194,354 (proves `N/A` stage = Candidate 25,972 + Incomplete 22,589 dominated — wishlist rows,
  excluded fail-closed, never guessed) · **points scoped IMPROVEMENT_TYPE 79 values → exactly
  21,620, 0 nulls**.
- **Scope**: `PROJECT_STAGE IN ('IN DEVELOPMENT','UNDER CONSTRUCTION','FUTURE DEVELOPMENT')` =
  21,620 points / 23,598 lines. Buckets: IN DEVELOPMENT + FUTURE DEVELOPMENT → proposed,
  UNDER CONSTRUCTION → approved; COMPLETED (112,478) and N/A (58,278) excluded at source.
- **file_date = PROJECT_CREATION_DATE**: real `esriFieldTypeDate`, **100% populated in scope**
  (21,620/21,620), a true past event. LET_DATE (78.1%) and NTP_DATE (84.9%) are STRINGS
  (`"20260828"` yyyymmdd) and future-dated on in-development rows — scheduled, i.e. the forecast
  class the TxDOT 2026-08-08 founder ruling rejects. POTENTIAL_COMMITTED_DATE 35.7%.
- **Freshness**: top-1 `LAST_EDITED_DATE` = 2026-08-15T05:42Z (probed 08-17) — live register.
  365-day edit window holds 39,883 line rows.
- **County spread receipt** (points, in scope, `RESPONSIBLE_COUNTY_NAME` — right-padded, trim
  precedent): Allegheny 1,968 · Philadelphia 1,312 · Montgomery 1,108 · Delaware 794 · Chester 578
  · Westmoreland 596 … all 67 PA counties represented.
- **Known instrument limits, honest**: distinct-PROJECT_ID is UNOBTAINABLE from this ArcGIS 10.91
  server (unscoped statistics → "Could not access any server machines"; scoped
  returnDistinctValues+returnCountOnly → 30s abort on points, explicit 400 on lines). Multiplicity
  documented qualitatively: one row per project-location detail (`PROJECT_LOCATION_DETAIL_PT.FID`).
  PROJECT_TITLE is truncated to 25 chars BY THE SOURCE (`length:25`);
  PROJECT_SHORT_NARRATIVE (240) carries the full text.
- 🔴 **HEADLINE CAVEAT — edge-runtime reachability UNPROVEN**: `gis.penndot.pa.gov` hard-400s ALL
  pg_net requests ("HTTP Error 400. The request is badly formed", even bare host with browser UA)
  while the GitHub runner reaches it cleanly. The Supabase edge runtime is a third client class;
  only a post-deploy smoke on a PA ZIP proves the engine can fetch (worse than the Tampa class,
  where pg_net worked). If the edge is blocked too: entry quarantines to 0 records (never fake),
  stamp the rejection, nightly reprobe.
- **Planned gate proof at wire time**: unit never-fetches test — Camden NJ ZIP (08102) never
  fetches the layer, Philadelphia (19103) does (the Council Bluffs analog) — plus live
  bidirectional receipts post-deploy. Invariants: 0 missing record_url, 0 missing coordinates,
  0 unclassified beyond the 9 documented admin values (751 rows, 3.5%), pins within the PA extent.
- **STATE: proposal handed to founder; STOPPED at registry-entry stage per the standing
  propose-only instruction. No registry change, no wiring, no deploy.**

## PENNDOT WIRED AND LIVE — penndot-transportation-projects; PA dev-backed 350 → 534 of 560 (2026-08-17)

Founder-approved with two riders, both resolved with receipts before merge:

- **Rider 1 (title field), measured — run 32053833264** (`scripts/recon/pa-penndot-round5.json`):
  PROJECT_SHORT_NARRATIVE populated **21,607/21,620 in scope (99.94%)** and legible full
  sentences; PROJECT_TITLE is truncated at 25 chars mid-word BY THE SOURCE (`length:25` —
  "SR 3001 Kirmar Avenue Eme", "I-80 R.S.REST EBANDWB"). **Wired: PROJECT_SHORT_NARRATIVE**;
  the 13 null-narrative rows fall back to the PROJECT_ID label (column_map arrays JOIN, never
  fall back — the truncated title is not used as backfill).
- **Rider 2 (bucket consistency), resolved — no change:** UNDER CONSTRUCTION → approved matches
  the statewide-DOT fleet exactly (udot `'Under Construction'` → approved; txdot
  `'Construction'` → approved; NDOT/IDOT/ODOT/NYSDOT carry no under-construction value).

**Wire:** PR #774 (squash `09448ac`) — registry arcgis 170 → 171 (additivity asserted
programmatically, 109-line diff), `test/penndot-connector.test.mjs` (42 assertions incl. the
Camden NJ 08102 never-fetches gate — the Council Bluffs analog — and a registry-wide
exactly-ONE-PennDOT-entry invariant, since Lines carries the SAME projects),
`fixtures/penndot/points-sample.json` (captured run 32047475605), `lib/generated/
county-sources.json` regenerated same-commit (parity gate). `out_fields` projected to the 7
mapped columns (~90-column MPMS row = the wide-row CPU-hazard class). Full unit suite
**106/106 green**. Deploy: run 32054722199 (fail-loud registry step green).

**🟢 EDGE-REACHABILITY VERDICT: CLEAR.** The wire-time risk (gis.penndot.pa.gov hard-400s ALL
pg_net requests) did NOT extend to the edge runtime: first live smoke all 200 —
19103 Philadelphia **409** penndot records (development 294→703) · 15222 Pittsburgh **359**
(234→590) · 16801 State College **67** (952→1,019) · **08618 Trenton NJ 0** (live
bidirectional receipt; Camden County is not modeled, so Mercer NJ — also directly across the
Delaware — is the live control; the unit test still pins literal Camden 08102).

**Rollout receipts (statewide re-cache, 560 fired + retries, collected via
`dev_refresh_collect`):** **42,191 penndot records across 464 of 560 PA pages** —
**0 missing record_url · 0 missing coordinates · 0 non-point · 0 outside the PA bounds ·
0 bad buckets · 0 missing file_date · 810 unclassified (1.9%, the 9 documented admin
classes)**. Cache-wide gate: penndot rides PA pages ONLY (0 non-PA), 0 fetch-failure or
truncation rows for the entry all day. **PA dev-backed pages 350 → 534 of 560** (the gap
table's 210-dark is now 26).

- ⚠️ **The 86-page tail is EPA-FRS-side, deliberately NOT forced:** the 560-request burst
  degraded FRS, later responses carried `facilities: 0`, and `dev_refresh_collect`'s
  transient-safe guard correctly refused to clobber pages holding real cached facility counts
  (0 penndot fetch failures in any refused response). The guard was NOT bypassed (standing
  rule); the nightly 09:00 cron + FRS probe gate own the tail. 9 refreshed pages carry 0
  penndot records — rural honest-empties (Centre County villages, small Allegheny boroughs).
- The Live-metric (app_projects) propagation rides `app_refresh_sweep` (15-min cadence)
  zero-touch; no manual materializer action taken.
- **Next levers per the standing order:** CA 360 behind the edge-reachability preflight
  instrument; then the statewide-DOT recon batch (NM/AR/LA/SD/MT/MS/AZ), each checked against
  its rejection stamp first.

## EDGE-REACHABILITY PREFLIGHT BUILT + FIRST STAMP AUDIT RUN — 2 flips, 1 intermittent, 5 hold (2026-08-17)

Founder-approved instrument (rider: ≥3 spaced probes before any stamp moves; mixed = "intermittent",
a third state). Closes the PennDOT gap: pg_net-based reachability stamps are claims about the WRONG
client — recon runs on Postgres egress, production on the Deno edge runtime.

**The instrument:** `supabase/functions/edge-probe` (PRs #776/#777/#779, deploy runs 32065779982 +
post-#779). Fetches ≤10 candidate URLs per call FROM the deployed edge runtime with **fetch-shape
parity to `sources/arcgis.ts::getWithBackoff`** — byte-identical headers + the identical 30s
timeout, ENFORCED by `test/edge-probe.test.mjs` (29 assertions; CI-red if probe and connector ever
drift). Receipt per target: status/ok/elapsed_ms/bytes/content_type/redirected/final_url/
body_head(600)/error. SSRF fences: https-only, GET-only, no forwarded headers, private/link-local/
loopback/metadata refused pre-fetch, 64 KB body cap, sequential targets. Suite 107/107.
- ⚠️ **Two deploy-posture traps found and closed en route, both live-verified:** (1) the deploy
  workflow passed `--no-verify-jwt` unconditionally (written for the engine) — now conditional
  (#777); (2) **the deploy CLI PRESERVES a function's stored verify_jwt when the flag is omitted**,
  so the flag-less redeploy kept `false` from the first deploy — caught by a live no-auth control
  (request 8471 ran the probe), pinned by `supabase/config.toml` `[functions.edge-probe]
  verify_jwt = true` (#779, + `supabase/config.toml` added to unit-tests path filters — the
  CLAUDE.md no-path-filter merge-deadlock case, same remedy). **Post-fix control: no-auth → 401
  UNAUTHORIZED_NO_AUTH_HEADER (request 8725).** Standing answer: after ANY security-posture deploy,
  verify the posture with a live negative control — the CLI's flag semantics make "deployed with
  the right command" insufficient evidence.
- **Calibration (no verdicts before controls behaved):** positive control gis.penndot lines count →
  200/1,684ms through the probe (request 7902). ⚠️ **The divergence control found the PennDOT/pg_net
  400-block has LIFTED** — raw pg_net now 200 `{"count":194354}` (request 7903) on the same host
  that hard-400'd every pg_net request during the morning recon. **Stateful-host behavior measured
  same-day — the empirical justification for the ×3 rider.**

**Stamp audit — 8 hosts × 3 rounds ~15 min apart (requests 8156 / 8470 / 8724), verdicts:**

| host (stamp) | r1 / r2 / r3 | verdict |
|---|---|---|
| **caltrans-gis.dot.ca.gov** | 200 245ms · 200 245ms · 200 258ms (real services JSON, v11.1) | **REACHABLE 3/3** — but see the stamp-class correction below |
| **Miami** `services1.arcgis.com/CvuPhqcTQpZPT9qY/Building_Permits_Since_2014` | 200 212ms · 200 223ms · 200 207ms, count 229,637 | **FLIPS → reachable.** The stamped 30–60s/request slow-host condition is GONE (3/3 at ~210ms). → **RE-RECON flag** (Miami-Dade FL pages) |
| **El Paso** `gis.elpasotexas.gov` NewResidential/1 | 30s timeout · 200 340ms `{"count":42677}` · 200 368ms | **INTERMITTENT** — the third state, all receipts attached. Note the stamped 403 did not reproduce in any round; today it hangs or answers. Not wired on this evidence; re-run the ×3 audit before any wire |
| Tampa `arcgis.tampagov.net` | 403 Access Denied ×3 (102/143/164ms) | HOLDS |
| Dayton `maps.daytonohio.gov` | connect error ×3 (~220ms) | HOLDS (TCP-reset class) |
| Newark `data.ci.newark.nj.us` | 503 ×3 | HOLDS (Cloudflare) |
| Lehigh `gis.lehighcounty.org` | **HTTP 200 ×3 but the body is the Incapsula JS challenge** | HOLDS — the shape receipt (body_head) catches what status alone would mis-stamp; never judge on status_code |
| STL RDX `rdx.stldata.org` | 30s timeout ×3 | HOLDS (blackhole) |

- 🔎 **CALTRANS STAMP-CLASS CORRECTION (report headline):** QUEUE's "Caltrans is a documented
  edge-runtime blocker" line was a DRIFTED SUMMARY — no reachability receipt exists behind it. The
  real stamp (CALIFORNIA PASS, 2026-08-05) is **`WRONG_RECORD_CLASS`**: the DCAT catalogue was
  enumerated in full — 69 datasets, ALL asset/network inventory, 0 project layers. The 3/3
  reachable receipts REMOVE the phantom reachability blocker but do NOT overturn the content
  verdict: Caltrans still publishes assets, not projects. **The CA 360 path is unchanged —
  municipal/MPO tier** (MTC rejected on schema: 0 date-typed fields, no status), now with one
  fewer excuse: no candidate can be dismissed on "edge-blocked" grounds without an edge-probe
  receipt.
- **Standing answer (both directions):** a reachability claim about a candidate host — reachable
  OR blocked — requires an `edge-probe` receipt (≥3 spaced rounds for a verdict). pg_net and
  GitHub-runner results are supporting evidence about OTHER clients, never the stamp.

## MIAMI RE-RECON COMPLETE — source QUALIFIES; registry entry PROPOSED, awaiting founder review (2026-08-17)

Founder-approved re-recon after the edge-probe stamp audit flipped Miami to reachable (3/3 at
~210 ms vs the stamped 30–60 s/request; receipts in the stamp-audit section above). Old recon
treated as EXPIRED and fully re-receipted via pg_net (AGO host, both paths reachable) — and the
expiry call was right: **the schema changed since the old recon** (the status field is now
`BuildingPermitStatusDescription`; 41 columns; the old bare `Status` field is gone).

Fresh receipts (pg_net requests 8979–8996, all in `net._http_response`):
- **Single layer** on `services1.arcgis.com/CvuPhqcTQpZPT9qY/Building_Permits_Since_2014` —
  no id-overlap question. Point geometry; `Latitude`/`Longitude` columns 100% in scope.
- **Total 229,637 rows · ScopeofWork vocab 22 values summing EXACTLY to 229,637.** Kept scope
  (the 4 construction/land-use types, all still verbatim): NEW CONSTRUCTION 50,592 · ADDITION
  AND REMODELING 12,426 · DEMOLITION 8,586 · PHASED PERMIT 660 = **72,264**; 18 trade/noise
  values dropped at source (REMODELING/REPAIRS 88,365 still excluded — Boston Short-Form class).
- **Status vocab IN SCOPE: 5 values summing exactly to 72,264** — Active 9,363 · Final 60,593 ·
  Revoked 1,255 · Expired 916 · Hold 137; 0 nulls. Buckets (fleet-consistent): Active→approved
  (Boston Issued precedent) · Final→operating (Boston Closed) · Hold→proposed (Scottsdale ON
  HOLD) · Expired+Revoked→exclude (Phoenix EXPR/VOID).
- **type_source = PropertyType — the clean find of the re-recon:** exactly 2 values, Commercial
  28,075 + Residential 44,189 = 72,264 EXACTLY, both literal members of the closed use_type
  set → verbatim identity map, 0 unclassified possible. (The old wire had no per-row use class.)
- **Title (rider-measured):** `["ScopeofWork","WorkItems"]` joined (UDOT pattern). WorkItems
  72,254/72,264 (99.99%), specific work text ("MULTI-FAMILY (RENTAL)", "BOAT LIFT/DAVITS…|DOCK");
  ScopeofWork 100% but only 4 generic values — the join gives category + specifics.
  DeliveryAddress = address (100%). case_number = PermitNumber.
- **file_date = IssuedDate**: real esriFieldTypeDate, 72,253/72,264 (99.98%), a true past event;
  DATE-literal recency verified live (365d scope = **11,531 rows citywide**). FirstSubmissionDate
  REJECTED on measurement — 20,397/72,264 (28.2%), only 299 rows in the last 365d (a legacy
  backfill, not a live application stream; the Henderson process-start preference inverts here).
- **Distinct-permit reality: distinct PermitNumber = 72,264 = the scoped row count** — one row
  per permit, no multiplicity (unlike PennDOT's location-detail rows).
- **Freshness: max IssuedDate 2026-08-15 · service dataLastEditDate 2026-08-16** — live ledger.
- ⚠️ **CompanyZip is the CONTRACTOR's ZIP, never usable for site scoping** — spatial 3-mi on the
  rows' own points (no site-ZIP column).

**Proposed entry** (propose-only; wire on approval): `miami-building-permits`, arcgis, coverage
`[{FL, Miami-Dade}]`, extra_where = the 4-type ScopeofWork filter, recency_days 365 on IssuedDate,
`out_fields` projected to the 8 mapped columns (the CPU-hazard fix originally shipped FOR this
host), spatial_zip_radius_mi 3, record_url dataset-precision (no per-row URL column),
status/type maps as above. **Gate plan:** unit never-fetches with Broward 33301 (Fort Lauderdale)
vs Miami 33127 + live bidirectional receipts post-deploy. **Wire-time smoke MUST re-answer the
ORIGINAL rejection**: a full paged engine fetch on a dense Miami ZIP (33127/33130) within the
worker budget — the edge-probe's ~210 ms is one request, not a full report; if the budget blows
again, the stamp re-closes with the new receipt.

**STATE: proposal handed to founder; STOPPED per propose-only.** El Paso stays parked in the
intermittent bin (re-run its ×3 audit a different day before any recon). CA reclassified:
municipal/MPO tier, queued behind the DOT recon batch.

## MIAMI RECONCILIATION — ALREADY WIRED AND DELIVERING; approved re-wire HALTED at the duplicate gate (2026-08-17)

The founder-approved Miami wire was **NOT executed**: the pre-commit duplicate assertion found
`miami-building-permits` **already in the registry** — wired **2026-07-25** by a later pass (nine
days AFTER the 2026-07-16 rejection this whole thread worked from), with its own receipts and a
measured volume correction. `docs/source-registry.md`'s "REJECTED AT SMOKE" section was never
updated; a supersession banner now sits on it.

**Live measurement (the reconciliation): 34,307 cached records across 24 Miami-Dade ZIP pages ·
0 in `v_incomplete_registry_entries` · 0 `dev_refresh_source_failures` rows in 7 days.** The
entry is healthy in production. Its config is CONSISTENT with the 2026-08-17 re-recon receipts
(same 5 verbatim statuses on `BuildingPermitStatusDescription`, same 4-type ScopeofWork scope,
file_date IssuedDate, recency 365, dataset-precision, contractor-ZIP trap documented) — the fresh
recon independently re-derived the same source model, which is corroboration, not waste.

- ⚠️ **A duplicate would have been the Houston-plat double-emission class** — one PennDOT-style
  duplicate entry double-emits every permit across two `source_registry_id`s, uncatchable by
  exact-identity dedup. The one-entry-per-source assertion (added to the wire script after the
  PennDOT Lines/Points lesson) is the control that caught it.
- ⚠️ **The proposed entry would also have REGRESSED a measured fix:** it carried
  `spatial_zip_radius_mi: 3`; the live entry is **1.5**, corrected 2026-07-25 after ZIP 33130
  produced a 14,933-record / **13 MB** row at 3 mi (3.7x the dense-metro ceiling). The halt
  prevented both the duplicate AND the regression.
- 🔑 **STANDING ANSWER (the miss that caused this):** the re-recon started from the REJECTION
  STAMP and never ran the §0c/§0j registry grep. **Before ANY recon or proposal on a source,
  grep the registry for entries on the same host/dataset FIRST** — a rejection stamp in the docs
  proves a rejection HAPPENED, never that the registry still reflects it; two writers means the
  docs and the registry drift independently. (The CA pass did this grep; the Miami thread did
  not.) Corollary for the stamp audit: "Miami flips → re-recon flag" was correct as an
  INSTRUMENT finding, but the production conclusion was already moot — the flip had been acted
  on 2026-07-25 by the other writer.
- **The 2026-08-17 re-recon receipts remain valid and are attached to the record** (QUEUE
  "MIAMI RE-RECON" above; pg_net 8979–8996). Where they differ from the live entry, they are
  measured IMPROVEMENT CANDIDATES, not defects — gated (they change what residents see),
  proposed to the founder separately: (a) `type_source: PropertyType` → Commercial 28,075 /
  Residential 44,189 = 72,264 exactly, replacing the generic all-Development map (pin shapes
  gain real use classes); (b) title `[ScopeofWork, WorkItems]` (99.99% specific work text)
  replacing `[ScopeofWork, DeliveryAddress]`; (c) `Hold` (137 rows) → proposed instead of
  exclude (the Scottsdale ON HOLD precedent the 07-16 recon itself cited). None wired.
- Miami-Dade dev-backed footprint today: 24 of the county's modeled ZIPs carry city permits;
  the rest of the county (Hialeah, Miami Beach, Homestead …) has no first-party source wired —
  that is the real remaining FL frontier, not the City of Miami.

## MIAMI ENTRY UPGRADED (improvements 1+2) · Hold→proposed REJECTED · FLEET REVIEW LOGGED (2026-08-17)

One reviewed change to the existing `miami-building-permits` entry (founder-approved):
`type_source` → `PropertyType` with the verbatim two-value identity map (Commercial 28,075 +
Residential 44,189 = 72,264 exactly — pins gain real use classes) and title →
`[ScopeofWork, WorkItems]` (99.99% specific work text). Change-set asserted programmatically:
exactly those fields + the appended receipts note moved; every other entry byte-identical; the
1.5-mi measured radius untouched. Suite 107/107.

⚖️ **Hold→proposed REJECTED (founder ruling, 2026-08-17): pausing is not proposing.** Recoloring
a stalled application as a fresh proposal claims motion where there is none. Miami's `Hold`
(137 rows) stays `exclude`.

📋 **FLEET-REVIEW ITEM (logged, queued — not started): hold/stalled-status semantics, fleet-wide.**
Audit how EVERY registry entry buckets hold/stalled-type statuses (Scottsdale 'ON HOLD' included —
it maps to proposed today and is the precedent the rejected Miami change cited; also Orlando's
Hold/Hardhold→exclude, Henderson/others as found by grep). Decide ONE fleet-wide semantic, with
the resident-meaning question stated explicitly: **does this pin claim something is moving
forward when it isn't?** Founder decision at the end; until then no entry's hold-bucketing moves.

## MIAMI UPGRADE SHIPPED AND LIVE-VERIFIED (2026-08-17)

PR #781 squash-merged (`3659393`), engine deployed (run 32074839710 — the first dispatch,
32074619475, failed on a TRANSIENT `supabase/setup-cli` "rate limit exceeded" resolving
'latest', before any deploy step; retried clean). **Live receipt, ZIP 33127 through the
deployed engine (pg_net request 9823): HTTP 200 · 3.1 MB (under the 3.5 MB ceiling — the
1.5-mi measured radius holding) · 3,145 miami-building-permits records · ALL 3,145 with real
use classes (Residential/Commercial) · 0 unclassified · 0 missing record_url · 0 missing
coordinates · titles now ScopeofWork+WorkItems ("NEW CONSTRUCTION LOW VOLTAGE SOUND / SPEAKER
SYSTEM").** Persisted via dev_refresh_collect; stored row re-verified at 3,145 with-use-class.
The other 23 Miami-Dade pages pick up the upgraded fields on the nightly refresh, zero-touch.
Hold stays exclude (founder ruling); the fleet hold-semantics review item stands above.

**Board (founder-set): next = the statewide-DOT recon batch NM / AR / LA / SD / MT / MS / AZ,**
with registry-grep-first and the edge-probe ×3 preflight in force for every candidate; El Paso
parked (different-day ×3 audit before recon); CA in the municipal/MPO tier behind the batch.

## DOT RECON BATCH COMPLETE — NM / AR / LA / SD / MT / MS / AZ (2026-08-17, propose-only; NOTHING WIRED)

Registry-grep-first ran before any recon: **no statewide DOT entry exists for any of the six**
(199 entries; MT/AR/SD/NM/LA/MS carry municipal permit entries only). Edge-probe ×3 preflight
(requests 10448 / 10705 / 11041, probed 22:43:44Z / 22:49:09Z / 23:04:20Z — rounds 1→2 were
5.4 min apart because round 2 fired on session resume after the spacer had already elapsed;
disclosed, results identical in all rounds so no verdict rests on the spacing):
mt-mdt 200×3 (244/269/184 ms, count 275 every round) · ar-ardot 200×3 (184/340/295 ms, count
1,384 every round) · sd-dotgis 200×3 · la-dotd 200×3 · **ms-mdot DNS failure ×3**.

- **AZ — ALREADY WIRED, healthy.** `adot-tip-fy2026-2030` predates the batch; 685 records /
  181 ZIP pages delivering. No action.
- **MT — PROPOSE-ONLY ENTRY DRAFTED** (`mt-mdt-stip-lines`): MDT STIP "Lines (2026)" layer 1,
  gis.mtmdt.us (org name receipt: arcgis.com portal dKlvxNSUvl36IGMp = "Montana Department of
  Transportation"). 275 polylines; SCOPE 26 verbatim values SUM 275 exactly (0 null) → type_map
  all → Utility; FFY_YEAR 2022–2030 sums 275; NO status/date fields → status_const "Programmed"
  → proposed (NJ/MnDOT fleet shape), file_date deliberately absent (FFY is forecast — rider).
  Layer 0 "STIP Points (2026)" = 5 features (2 UPNs shared with lines) — below threshold, logged.
- **AR — PROPOSE-ONLY ENTRIES DRAFTED ×2** (`ar-ardot-job-status-points` L2 1,384 rows /
  `ar-ardot-job-status-lines` L3 5,052 rows). **The opaque-code block is RESOLVED with a
  publisher receipt**: ARDOT's own web map (item 05f0db5beea8448392b11190bd36f06c, owner
  Thomas.Melton@ardot.gov) carries Arcade expr "MapStatusAliasName": 00=Programmed, 01=Scheduled,
  02=Under Construction, 03=Completed; the ARDOT dashboard's pie slices agree independently.
  Not the San-Jose class. Buckets proposed: 01→proposed (letting not yet occurred — conservative,
  one step past NDOT Programmed), 02→approved (PennDOT/UDOT fleet), 03→operating. Status sums
  exact both layers (451/199/734=1,384 · 894/567/3,591=5,052); crosstabs with Map_Show exact;
  extra_where Map_Show=1 (ARDOT's own display curation — status-orthogonal, receipts). FRESH:
  max Accepted_Date 2026-08-09, max NTP 2026-07-06 (Updated_DT is a dead legacy field, max
  2019-11-14 — checked and discarded). file_date=Letting_Date (real event; PCPM_Let_Date maxes
  2029 = forecast, rejected). Type vocab 21 values sums 1,384 (12 null → unclassified).
  Job_No overlap Points∩Lines = 60 of 660 (600 points-only vs 1,643 lines) — substantially
  disjoint populations, NOT the Houston subset class; 60 dual-representation jobs disclosed.
  Titles: Job_Name legible (samples on file). Fields carry NO coded-value domains; legend and
  renderer labels are the codes themselves — the web-map config was the only decode channel.
- **SD — PROPOSE-ONLY SHAPE DRAFTED ×7 entries** on dotgis.sd.gov (first-party state domain)
  STIP/DOT_STIP_Approved layers 0/1/2/3/4/6/9 = Structures 330 · Safety-pt 104 · Constr-Reconstr
  140 · Resurfacing 199 · Pavement Preservation 430 · Safety-line 153 · RR Crossings 44 = 1,400
  of 1,466 approved features. No status field, LettingDate/ReadyDate are forecast → status_const
  "Programmed"→proposed, use_type_const Utility (ImproveDesc is free-text prose — Douglas-NV
  class — rides in title with LocDesc instead). Partition receipt: 646 distinct ProjectCtrlNbrs,
  50 in >1 layer — L0+L19=48 (L19 dropped as Houston-subset), L1+L6=2 (disclosed, kept).
  Dropped and logged (no silent caps): L19 (53), L5 ADA (11), L20 (2), L12/L18/L21 (0 rows),
  L7/L8 Developmental STIP 2030-2033 (381 — forecast program per rider), L16 "Do Not Map".
- **NM — STAMPED REJECTION: STALLED.** NMDOT_ESTIP_Project_Locations (owner nmdot, AGO
  hOpd7wfnKm16p9D9): newest layer "Project Locations 2025" dataLastEditDate = 2023-08-24;
  program columns end at PRG_2021+PRG_FUTURE; counts 49/79/44; no status field; only forecast
  FFY fields (rider). Completeness: owner's 10 newest items (through 2026-07-21) contain no
  replacement register. → nightly reprobe list.
- **LA — STAMPED REJECTION: register is a Power BI embed.** dotd.la.gov/projects/ embeds
  app.powerbi.com/view?r=… (iframe receipt) — no queryable per-record API, no record_url.
  maps.dotd.la.gov/topo carries reference layers only (OpenData = soils/census/GNIS/boundaries;
  Utilities folder 499 Token Required; FHWAUrbanArea = urban-area polygons). AGO name-search:
  no register (Mardi Gras Pass maps, signal design zones, bridges gdb). → reprobe list.
- **MS — STAMPED REJECTION: GIS hostname does not exist.** gis.mdot.ms.gov NXDOMAIN from THREE
  client classes: edge runtime ×3 rounds, pg_net, sandbox getent — while mdot.ms.gov itself
  resolves (205.144.237.39), so the agency is alive and the GIS host is gone. AGO name-search
  ("Mississippi Department of Transportation") returns third-party items only (student/MDEQ);
  mdot.ms.gov is a React SPA shell (goMDOT) with no crawlable GIS links. → reprobe list.

Proposal JSON parked at scratchpad/dot-batch-proposals.json (session-local); the entries above
are the record. **Awaiting founder review — no registry edit, no wire, no deploy in this batch.**

## MT + SD STIP WIRED AND LIVE — 8 entries, 136 ZIP pages lifted, 759 records (2026-08-18)

PR #783 squash-merged (b3fdcc6, unit/browser/verify all green — 109-file suite; the
type-const-with-map meta-check correctly rejected the initial MT `type_map`+`use_type_const:
Utility` pairing and the constant was dropped: 0 null SCOPEs live, a future blank falls to
unclassified). Deployed via run 32081876989. Designated branch reset post-squash
(diff-empty + no-branch-only-files preconditions both checked, --force-with-lease).

- **Live smoke (6 ZIPs through the deployed engine, all 200):** Billings 59101 dev 0→7 (all
  MDT) · Missoula 59801 +10 MDT · Sioux Falls 57104 +24 SD-STIP (proposed 5→29) · Rapid City
  57701 dev 0→8 · **Bismarck ND 58501 and Williston ND 58801: 0 MT/SD records — bidirectional
  gate holds live.**
- **Rollout: all 251 modeled MT/SD ZIP pages re-cached in 4 paced waves (62/62/62/61, ~2 min
  apart — the PennDOT burst lesson) + 14 cold-start 503 retries (all 200 on retry).**
  214 pages upserted; **37 responses guard-refused** (smaller than cache — the transient-safe
  guard, never bypassed; nightly dev_refresh cron owns them). Tracking table dropped.
- **Cache-wide receipts:** 136 MT/SD pages carry DOT records (MT 46 pages / 145 records ·
  SD 90 pages / 614 records; every one of the 7 SD entries places records — pavement-pres 205,
  safety-lines 117, resurfacing 95, structures 79, constr-reconstr 61, safety-pts 33, RR
  crossings 24). **0 records on any non-MT/SD page. Invariants: 0 missing record_url ·
  0 non-proposed · 0 unclassified · 0 fabricated file_dates · 0 out-of-region pins · 0 area
  records** (the SD NaN-geometry region-wide rows can't be returned by the server-side spatial
  envelope, exactly as designed; the connector test pins the fail-closed path anyway).
- ⚠️ Pre-existing, not this wire: 57104's cached row is ~20 MB / 19,599 sites (dominated by
  sioux-falls-building-permits) and 59801 ~16 MB — both beyond the Cleveland 5.98 MB high-water
  mark. Logged for the row-size review; the adaptive verifier loaders are the mitigation.

**AR HELD (founder), overlap resolution proposed — awaiting pick:**
1. Dedup answer (from shipped code, index.ts:836-838): the exact-identity key includes
   lat|lng|source_registry_id, so cross-entry rows for the same Job_No NEVER collapse — wiring
   both AR layers as-is would double-pin the 60 dual-representation jobs.
2. Block_Overlap is NOT the discriminator (overlap jobs split 44/17 across it; points-only jobs
   split 429/173 the same way — it is an internal symbology flag). No server-side predicate
   exists: ArcGIS layer queries cannot subquery a sibling layer.
3. **Computed resolution IS expressible at INGEST time (code change, gated):** a registry-declared
   `yields_to: "ar-ardot-job-status-lines"` on the Points entry + a small assembly hook before
   dedupeExactPermits — drop a yielding entry's record when the yielded-to entry emitted the same
   case_number in the same report. Evaluated per-report from live data; no id list (Nebraska-clean);
   self-updating as ARDOT moves jobs between layers. Effect: 60 dual-pin jobs → 0; the 600
   points-only and 1,583 lines-only jobs unaffected.
4. **Nebraska fallback (config-only, pre-authorized by the ruling):** wire Lines alone (5,052
   rows / 1,643 jobs); accepted loss = the 600 points-only jobs (of 660 in the points layer).
5. Scheduled → proposed bucketing approved either way (founder).

## ROW-SIZE REVIEW QUEUED — Sioux Falls 57104 at ~20 MB (founder, 2026-08-18)

57104's cached development_reports row is ~20 MB / 19,599 sites — **3.3× the previous
high-water mark** (Cleveland 44127 at 5.98 MB) — and 59801 Missoula sits at ~16 MB. Both
PREDATE the DOT wires (the SD-STIP contribution to 57104 is 24 records; the mass is
`sioux-falls-building-permits` + `missoula-addresses-with-permits`). Understand before it
becomes the next silent ceiling hit: measure per-source record mass and per-record width on
both rows, check the adaptive verifier loaders and the live page's single-row read against
20 MB, then evaluate the Cleveland levers (recency window · `out_fields` projection ·
`spatial_zip_radius_mi`) per entry — radius changes what residents see, so that lever is a
founder call. No entry touched yet; review item only.

## AR WIRED AND LIVE — yields_to hook + both entries; 147 pages / 1,896 records (2026-08-18)

PR #784 squash-merged (aa42a5a; unit/browser/verify green — 111-file suite incl. the two new
test files). Deployed via run 32086334069. Branch reset post-squash (preconditions checked).

- **The hook (sources/yields.ts):** same-report-only, keyed on trimmed case_number equality;
  a yielding record drops ONLY when the yielded-to entry emitted the same Job_No in the same
  assembly. **Outage property confirmed in implementation and test-pinned:** an empty/failed
  Lines fetch leaves the yield set empty and every Points record survives — dual-source
  absence, never silent point-job loss. Zero declarations = structural no-op (input array
  returned). `yields_to` declared on the arcgis RegistryEntry interface so the
  connector-option-surface guard recognizes it (that guard flagged the first draft — the
  linter working as designed).
- **Founder-required tests, all green:** overlap job → exactly one survivor, the Lines one
  (proven twice — synthetic in test/yields-hook.test.mjs AND end-to-end on the real
  dual-representation Job_No 012289 in test/ardot-connector.test.mjs); points-only survives;
  Lines-outage → all Points survive; no-yields_to entry provably inert. Plus edge discipline
  (null case_number never yields; padded keys still match).
- **Live smoke (deployed engine):** Little Rock 72201 +84 ARDOT records (17 pts + 67 lines,
  dev 1,324→1,408) · Fayetteville 72701 dev 0→29 · **Memphis TN 38103: 0 ARDOT records — gate
  holds live.** Across all 113 smoke records: 0 jobs in both sources (the hook working in
  production), 0 missing record_url, 0 Scheduled rows carrying a date, 0 out-of-AR pins.
- **Rollout: all 157 modeled AR ZIP pages** (2 smoke + 155 in 2 paced waves of 78/77) +
  8 cold-start 503 retries (all 200). 118 pages upserted; 40 guard-refused (smaller than
  cache — transient-safe guard, never bypassed; nightly cron owns them).
- **Cache-wide receipts:** 147 AR pages / 1,896 ARDOT records (points 281 · lines 1,615);
  **0 dual-source jobs cache-wide · 0 records on any non-AR page · 0 missing record_url ·
  0 Scheduled-with-date · 0 out-of-AR pins · 16 unclassified** = the receipted null
  PCPM_Type_Work_Desc rows (logged, never guessed).

The DOT recon batch is fully closed: AZ already-wired · MT/SD/AR wired and live ·
NM/LA/MS stamped rejections on the reprobe list. Row-size review item (57104 ~20 MB) queued
above. Board next: El Paso ×3 re-audit on a different day; CA municipal/MPO tier;
fleet-wide hold/stalled-status semantics review (founder decision).

## FLEET RULING SHIPPED — hold/stalled statuses → EXCLUDE (2026-08-18)

**The principle (founder, durable):** a bucket is a claim to the resident — proposed claims
"you may still weigh in," approved claims "this is moving." A held/stalled/suspended project
supports neither; pausing is not proposing, and wrong content is worse than no content.

PR #794 squash-merged (7b20ab9; unit/verify green first pass, browser CANCELLED at 15.3 min
by the runner — not a test failure — and green on rerun in 4 min). Deployed via run
32159780146. Branch reset: precondition initially failed on a 2-line diff that proved to be
main's own sitemap-bot commit (17234d4) landing after the squash — branch-exclusive commits
were exactly the squashed pair, so the reset proceeded on verified-redundant history.

- **31 raw values flipped proposed→exclude across 28 entries** (survey computed from the
  registry, blast radius measured from the live cache: **1,044 records were rendering as
  proposed**, worst kcmo-development-cases 'Review on Hold' 297/55 pages; per-entry receipts
  in PR #794's table and each entry's `_receipts`).
- **Named exceptions (per-entry, never per-word):** sussex-county-de-conditional-use
  `Deferred`/`Defered` stay proposed — hearing-register semantics, a deferred agenda item
  returns to the board and the comment window is genuinely open; raleigh-building-permits
  `INACTIVE (INSPECTIONS COMPLETED)` stays operating — completed-inactive. Both rationales
  live in `_receipts` and in the lint's exceptions list.
- **The lint (test/stalled-status-bucket.test.mjs):** any hold/stall/suspend/pause/dormant/
  inactive-pattern raw value bucketed to proposed or approved fails the suite unless the exact
  (registry_id, raw value) pair is on the reviewed-exceptions list with a written rationale.
  Self-tests prove planted violations are caught, that exceptions never travel to other
  entries, and pin the over-flagging direction (Shareholder/Threshold/Withholding pass).
  Suite 112/112.
- **Live receipt (KCMO 64154, the biggest blast):** held pins **16 → 0**; proposed **34 → 18**
  = exactly −16, reconciling the held set; dev total 531 → 514 (−17: the 16 held + one record
  that moved at the source in the ~19 h since baseline — disclosed). Persisted via a
  deliberate targeted update (an INTENDED contraction — the wave-upsert `>=` guard is for
  transients and was not weakened for this; one verified ZIP only).
- **The remaining ~1,028 cached held records sweep via the nightly dev_refresh cron** — its
  transient-safe guard refuses only all-empty responses, never intended contractions, so no
  manual override is needed cache-wide.

## HELD-PIN SWEEP COMPLETE + EL PASO ×3 RE-AUDIT FLIPS TO REACHABLE (2026-08-18)

**1. Held-pin sweep — cache-wide zero.** The founder's "overnight" check ran 23 minutes after
the fleet-ruling deploy (16:20Z), so the 1,028 remaining held→proposed records across 188
pages were neither guard refusals nor missed pages — no scheduled pass had run against the
new registry yet. Diagnosis surfaced an architecture update the QUEUE notes had not recorded:
the refresh is now a ROLLING 15-minute `dev_refresh_tick()` (cron jobid 14, ~100 pages/tick,
full-cache cycle ≈ 1.3 days), not the single 09:00 daily fire — organic clearance would have
taken up to ~2 days. Per "the ruling isn't done until residents stop seeing the pins," the
188 affected pages were swept directly through the deployed engine in three waves (95 + 100 +
9; 16 transient failures all recovered on re-fire; upserts guarded against all-empty responses
only — intended contractions allowed). **Post-sweep: 0 held-status records bucketed proposed
cache-wide** (Sussex exception: 0 cached Deferred records at present; the config exception
stands). Tracking table dropped.

**2. El Paso ×3 re-audit (different day, byte-identical URL from the 2026-08-17 audit:
gis.elpasotexas.gov/arcgis/rest/services/Planning/NewResidential/FeatureServer/1/query
where=1=1&returnCountOnly).** Prior verdict INTERMITTENT (timeout · 200 340ms · 200 368ms).
Today, edge-probe requests 30047/30159/30413, probed 16:45 / 17:05:29 / 17:23:55Z:
**200 in 364 ms · 200 in 430 ms · 200 in 367 ms — count 42,677 IDENTICAL in all three
rounds. Verdict FLIPS TO REACHABLE; flagged for re-recon** (largest TX prize, 145 pages).
Per the founder's instruction: no recon, no wire — the re-recon is a separate founder-gated
step. Note for that recon: the original rejection was a WAF 403 measured in PRODUCTION
against all 143 ZIPs' real workload — the re-recon must include a budget/load-proving smoke
(the Miami precedent), not just count probes, before any stamp is rewritten.

## EL PASO RE-RECON COMPLETE — PROPOSE-ONLY ENTRY DELIVERED, AWAITING FOUNDER (2026-08-18)

Full standing playbook run against `Planning/NewResidential/FeatureServer/1` on
`gis.elpasotexas.gov` (org receipted by the service's own JSON: serviceDescription
"new residential building permits", documentInfo keywords "El Paso" — the City of El
Paso's own ArcGIS Server, v11.3). Registry-grep clean: no TX El Paso entry; the only
`county: "El Paso"` coverage registry-wide is `colorado-springs-planning-applications`
(CO — the county-name namesake, which the wire's gate tests must disambiguate).
Edge-probe 3/3 cited from the same-day audit (requests 30047/30159/30413), not re-run.

**Fresh receipts (all via pg_net, 2026-08-18):**
- Point layer, WGS84 on request (`outSR=4326`), maxRecordCount 1000, capabilities Query.
- `B1_APPL_ST` vocabulary, 11 values, sums EXACTLY to 42,677: " " 7,326 · Closed 31,597 ·
  Inspection 2,485 · Issued 826 · Issue Certificate 357 · Cancelled 46 · Expired 26 ·
  Completion Application 8 · Pending Review 2 · Revisions Approved 2 · TCO Issued 2.
  No hold/stall-pattern values. ALL 544 trailing-365d records carry the blank value —
  the status column stopped being populated (column drift), so it cannot drive buckets.
- `Record_Typ` vocabulary, 5 values, sums EXACTLY to 42,677: " " 16,771 ·
  Residential/New/NA 11,647 · New Residential 6,175 · 3rd/Residential/New 5,889 ·
  New Construction 2,195. In the connector's own 365d window (Rule 13): exactly 3 values
  summing to 544 (New Residential 492 · 3rd/Residential/New 28 · Residential/New/NA 24),
  ZERO blanks.
- Freshness: max `Issued_Dat` 2026-06-30 (≈7-week publication lag — batch loading; live,
  not stalled), 544 records in the trailing 365d. `REC_DATE` STALLED at 2019-09-26 —
  rejected as file_date. Live-end sample rows carry real WGS84 geometry inside El Paso
  (lng −106.33…−106.37, lat 31.69…31.72); `NUMOFUNITS` blank and `JOBVALUE` 0.0 on the
  samples — not mapped. `Descriptio` blank on the live end (historic values are batch
  labels like "Sept2019") — rejected as title. `B1_SITUS_Z` holds years, not ZIPs
  (0 of 42,677 rows LIKE '799%') — spatial 3-mi scoping required. Max 2 rows per
  `B1_ALT_ID` (distinct-record reality receipted).
- ⚠️ **The WAF is LIVE and CONTENT-SENSITIVE — demonstrated mid-recon:** a pg_net probe
  whose where-clause contained `<> ''` was blocked by Cloudflare ("Sorry, you have been
  blocked", elpasotexas.gov, HTTP 403) while the production query shape (DATE literal +
  IS NOT NULL) returned 200 the same hour. pg_net reachability remains NOT proof of
  production reachability; the rollout-as-test gate is the only honest wire-time smoke.

**NewCommercial (`Planning/NewCommercial/MapServer/0`) — stamp RE-CLOSES on fresh
receipts:** total count 11,322, byte-identical to the 2026-07-25 stamp (zero new rows in
24 days); the server 400s both orderBy-desc and groupBy-stat probes; the original
rejection (single blank in-window `Record_Typ` group, 0 non-blank `Descriptio` — no title
source) stands unrefuted. Not proposed.

**Handoff:** propose-only entry `el-paso-new-residential-permits` delivered to the founder
with the required stated failure path (post-deploy full paced rollout across all modeled
El Paso ZIPs IS the WAF test; 403 under load → wire quarantines, stamp re-closes with the
new receipt, rollout reverses) + Las Cruces NM 88001 and CO/El Paso (80903) never-fetches
controls. NO registry edit, NO wire — awaiting founder approval.

## EL PASO WIRED AND LIVE — THE WAF GATE PASSED, STAMP REWRITTEN (2026-08-18)

`el-paso-new-residential-permits` shipped in PR #797 (3 checks green, squash-merged
`ad11a899`, deploy run 32171225573 green on the merge commit, branch reset clean).

**THE GATE — the rollout WAS the test, and it passed.** The 2026-07-25 rejection was a
WAF 403 measured across the real production workload, so the smoke had to re-answer
exactly that. Three paced waves (48 + 48 + 49) across **all 145 modeled El Paso TX ZIPs**
(the July stamp's "143" was that run's vintage; two pages have been added since), fired
through `dev_refresh_fire_batch`'s exact production shape:
- **145 / 145 pages answered · 0 HTTP 403 · 0 `dev_failed_sources` rows naming
  `el-paso-new-residential-permits`** (the only failure rows in the window were 4
  whole-report `HTTP 503` cold starts, all recovered on re-fire).
- The stamp is REWRITTEN, not merely re-opened: the entry stays wired, and the quarantine
  branch of the failure path was never entered.

**Persisted receipts (cache-level, post-collect):** 89 pages carry **1,925 records /
221 distinct permits** (adjacent 3-mi circles legitimately repeat a permit across
neighbouring ZIP pages — Chicago precedent). Across every one of them: **0 missing
`record_url`, 0 missing coordinates, 0 non-`point` scope, 0 non-`approved` bucket,
0 unclassified, 0 missing `file_date`.** Pins span lat 31.6627–31.9242 / lng
−106.6168–−106.2489 (inside El Paso). `file_date` window is EXACT — oldest 2025-08-18,
newest 2026-06-29, the 365-day boundary.
**Bidirectional gate proof, live:** 0 el-paso records on any non-El-Paso page cache-wide,
including the two named controls — Las Cruces NM (88001/88005/88011) and Colorado Springs
(80903/80904/80906, the registry's OTHER `county: "El Paso"`), both cached, both zero.
El Paso pages moved dev 9,391 → 11,375 and sites 12,639 → 15,429.

⚠️ **54 of 145 pages have NOT yet persisted their El Paso records (595 pending) — and the
cause is EPA FRS, not the WAF.** Their responses carry El Paso data and no 403, but
`facilities` came back 0 while the cached row holds a real count, so
`dev_refresh_collect`'s transient-safe guard correctly REFUSED the write (24 confirmed on
that predicate; 2 had no response row; the rest re-fired mid-window). **The guard was not
bypassed or weakened** — the rolling 15-min `dev_refresh_tick` owns these pages and will
land them on a healthy FRS cycle. Anyone re-measuring El Paso before that cycle completes
should expect 89 pages, not 145.

**NewCommercial stays REJECTED** on fresh receipts (11,322 rows, byte-identical to the
2026-07-25 count — zero new rows in 24 days; no title source). One elpasotexas.gov entry
exists registry-wide, asserted in the test.

## ROW-SIZE REVIEW COMPLETE — MEASURED, NO LEVER APPLIED (2026-08-18)

Answers the review queued at line 8155. **Measurement only — nothing was changed.** The
lever decision is the founder's and is OPEN.

**1. What 57104 is.** 20 MB JSON / 19,599 sites / 1,077 B per site (1,531 kB on disk —
TOAST compresses 13×, so storage is not the constraint; the wire and the browser are).
`sioux-falls-building-permits` is **99.8%** of the mass (19,518 records). Width is uniform
(max 1,107 B) and all 19,518 case numbers are distinct — no duplicate records, the v22
dedup holds. But the width carries real waste, engine-wide rather than local:
**`url` is byte-identical to `record_url` and `title` to `label` on all 19,518 rows —
2,634,426 B = 12.5% of the row**, and fields whose value is CONSTANT across the source
total **5,679,738 B = 27%**. The volume itself is a config choice: `recency_days: 730` +
`spatial_zip_radius_mi: 5` + no `extra_where` + no `out_fields`. Window is exact (oldest
2024-10-07, newest 2026-08-12).

**2. The ceiling, and it is a CLASS.** ⚠️ **The largest cached row is 57105, not 57104.**
Across 12,722 rows / 3,066 MB: p50 **19 kB** · p95 **986 kB** · p99 **4,535 kB** · max
**20 MB**. **77 rows exceed the retired 5.98 MB Cleveland mark · 31 exceed 10 MB · 6 are
≥18 MB · 159 exceed the old 3.5 MB "working ceiling."** **14 registry entries share the
signature** (radius ≥5 AND recency ≥730 AND no `extra_where`); three of them own the whole
top 15 — sioux-falls, `brunswick-county-permits` NC, `missoula-addresses-with-permits` MT.
The other eleven are latent.

**3. BEHAVIOUR AT SIZE — the page does not load, and the cause is NOT the cached row.**
Server side nothing is near a limit: PostgREST returns the full **21,109,900 bytes with
HTTP 200** (no truncation), the engine returns 200 with a 19 MB body, and heavy rows
refresh no worse than the rest (avg age 27.7 h vs 29.6 h). Live runner checks, with
same-county light controls proving size and not content:
- **`homesignalmap.html` renders all 19,599 sites at 20 MB** — one request, one cached row.
- **`community.html` AND `maps.html` both break, reproducibly (2/2).** Both call
  `HS.data.projects()` → `fetchAllPages` over `app_projects` in **1,000-row windows**, so
  57104's 19,584 project rows mean **20 SEQUENTIAL round trips** before first render.
  Boundary is sharp: 57103 renders at **18,561** records; **19,141+ does not**.
- **Failure mode is NOT silent truncation, by design** — `if (projects.complete === false)
  throw` refuses to render a partial prefix ("The map can't load right now").
  ⚠️ **Honest limit of this measurement:** `spot-check-shell.mjs` waits only **6,500 ms**
  after DOM load, so "BROKEN (unrecognized state)" cannot be distinguished from "still
  loading at 6.5 s" without a longer-settle probe. Not claimed either way.
- **Blast radius: 6 ZIPs, 2 counties** — 57105/57104/57103 (Minnehaha SD) and
  28468/28470/28469 (Brunswick NC). **All 6 are currently `indexable`.** Clean gap: 0 rows
  between 17 and 18 MB.

**4. Levers, measured on 57104 — FOUNDER'S CALL, NOT APPLIED.** Note `sioux-falls` carries
**0 `proposed`** records (all issued/completed), but the heavy class carries **26,732**
(Cabarrus 17,566, Missoula 8,238) — so a FLEET-WIDE trim would cost real comment-window
items elsewhere. Per-source beats blanket.
| lever | records kept | row size | resident cost |
|---|---|---|---|
| recency 730 → 365 | 10,568 (54%) | 11 MB | loses year-old permits; still above the break |
| radius 5 → 3 mi | 5,689 (29%) | 5.96 MB | narrows "near me" — changes what the map means |
| both | 3,283 (17%) | 3.4 MB | clears comfortably |
| drop duplicate `url`/`label` | all | ~17.5 MB | **zero** rendered change (engine change) |
| raise `PAGE_ROWS` / parallelize | all | unchanged | zero content loss; fixes the mechanism |

## ROW-SIZE FOLLOW-UPS (founder, 2026-08-18) — item 1 ANSWERED; 2 and 3 PROPOSED

**Recency and radius trims are NOT APPROVED** (founder): the row size was never the
constraint, and radius changes what "development near my home" MEANS to a resident — a
product decision, not a performance lever. Do not propose them again as a size fix.

### 1. ANSWERED — residents get a SLOW page, not a broken one
The 6,500 ms ambiguity is closed. `spot-check.yml` now takes an optional `settle_ms`
(default 6500 — every existing caller byte-identical). **At `settle_ms=30000` both
heaviest ZIPs render COMPLETELY:** 57104 community populated · tracker 19,601 sites ·
**dev-app 19,584 records**, and 28468 all three populated at 19,546. **19,584 is exactly
the `app_projects` row count for 57104**, so the full set renders and the complete-flag
honesty holds — no truncation, no partial prefix. The 60 s run was not needed: 30 s
already renders. **The earlier "BROKEN" readings were the checker's impatience, not a
page failure.** ⚠️ Do not restate the earlier finding as "the page is broken."
**NARROWED: `settle_ms=15000` ALSO passes**, both ZIPs, identical counts (19,584 /
19,546) — so the full render lands **between 6.5 s and 15 s**. That is the number the
fix is worth measuring against: slow enough to lose a resident (well past the ~3 s
abandonment point), not broken. 6 ZIPs, 2 counties.

### 2. PROPOSED (not built) — fix the PAGINATION, and NOT by enlarging PAGE_ROWS
⛔ **`PAGE_ROWS` CANNOT BE RAISED — and raising it would cause SILENT TRUNCATION REPORTED
AS COMPLETE.** Measured on `app_projects?zip=eq.57104`: `limit=5000` → **1,000 rows**,
`limit=25000` → **1,000 rows** (`pgrst.db_max_rows` is unset at the DB level, so the cap
is service-side and unreachable from page code). `fetchAllPages` stops on
`data.length < PAGE_ROWS`, so with PAGE_ROWS=5000 the first 1,000-row response reads as a
short page: the loop returns 1,000 of 19,584 records **with `complete: true`** — exactly
the failure the flag exists to prevent.
- **Option A (recommended): one server-side aggregate RPC** returning the ZIP's projects
  as a single `jsonb` payload. A single row escapes the 1,000-row cap, and that path is
  already proven at this scale — `development_reports` serves **21,109,900 bytes at HTTP
  200** and the tracker renders 19,599 sites from it in ONE request. Turns 20 sequential
  round trips into 1, removes the window-boundary consistency risk, and makes the
  complete-flag trivially honest. Precedent for the shape: `dev_sites_deduped()`.
- **Option B: parallel windows.** Learn the total first (`Prefer: count=exact` →
  `Content-Range`), then issue `ceil(N/1000)` range requests at **concurrency 6** (browser
  per-origin HTTP/1.1 ceiling). 20 windows → 4 waves. **The termination test MUST become
  "received exactly N rows"** — under parallelism a short page can no longer distinguish
  "end of set" from "truncated in the middle". Re-sort by the total order after collection.
- **Proof required either way:** the 6 heavy ZIPs (57105/57104/57103/28468/28470/28469)
  populated on all three page types **at the DEFAULT 6,500 ms**, not an indulgent settle ·
  light controls unchanged (28456 46 kB, 28436, 28420, 84302, 28462 13 MB) · **per-ZIP
  record-count parity: `app_projects` DB count == records rendered** · a planted-failure
  offline test proving `complete:false` still throws and never renders a prefix
  (`HS.fetchAllPages` is already exported for this).

### 3. QUEUED SEPARATELY (not bundled) — fleet-wide field dedup
`url` is byte-identical to `record_url` and `title` to `label` on **all 19,518** Sioux
Falls records — **2,634,426 B = 12.5% of that row**, and the pattern is cache-wide across
3,066 MB. Zero rendered difference. Different blast radius from item 2 (every cached row,
not one read path), so it needs its own verification: prove equality across EVERY source
before dropping either field (per-source check, never a spot check), decide which name
survives, confirm no page/verifier reads the dropped one, re-cache, then compare rendered
output on a sample.

### 4. LOGGED — `missoula-addresses-with-permits` needs a consistency review
One of the three heavy sources (62,675 records in the heavy class, 8,238 `proposed`). An
ADDRESS REGISTRY with permits attached has been a **rejection** reason elsewhere — St.
Paul's PAULIE ("an address registry, not permits") and DuPage address-points. Either those
stamps or this wire is inconsistent; check which, with receipts.

---

## ITEM 2 SHIPPED AND MEASURED — Option A, the aggregate RPC (2026-08-18)

**Built, merged (#804), deployed, and now MEASURED as a number rather than as a pass/fail
at a settle deadline (#805).** `HS.data.projects()` / `.facilities()` read a ZIP through
`public.app_projects_for_zip(p_zip, p_kind)`, which returns the whole set as ONE `jsonb`
payload; a single row cannot be truncated by the 1,000-row cap.

### The number the fix was worth measuring against

Measured on the live site from a runner, 3 reps per ZIP, run `32190273999`:

| ZIP | median page render (DOM ready → score rail) | rendered / attempts |
|---|---|---|
| 57104 Sioux Falls SD (19,544 dev records) | **3,415 ms** | 3 / 3 |
| 28468 (19,545) | **3,545 ms** | 3 / 3 |
| 84302 Brigham City (2, light control) | **839 ms** | 3 / 3 |

Read path head to head, both in the SAME live browser against the SAME live DB with the
SAME public anon key, alternating in a fixed order — the OLD half drives the **shipped**
`HS.fetchAllPages` helper over the exact pre-change query, so the "before" number is
measured on this deploy, not remembered from a previous one:

| ZIP | NEW single-payload RPC | OLD 1,000-row windows | delta | rows (new / old) | complete |
|---|---|---|---|---|---|
| 57104 | **1,780 ms** | 3,064 ms | **−1,284 ms (−42%)** | 19,544 / 19,544 | true / true |
| 28468 | **1,735 ms** | 3,053 ms | **−1,318 ms (−43%)** | 19,545 / 19,545 | true / true |
| 84302 | 55 ms | 56 ms | −1 ms | 2 / 2 | true / true |

**Identical row counts on both paths at every rep** — the speed-up is not bought by a
shorter read, which is why the counts and the `complete` flag are printed beside every
timing rather than reported separately.

### The "suspected community.html regression" is WITHDRAWN — it was the instrument

It was reported as *suspected* on n=1 before/after through `spot-check-shell`, whose
verdict is pass/fail at a fixed settle. On the same deploy, `community.html?zip=57104`
renders in **3.1–4.5 s, 3 for 3**, less than half the 6,500 ms default it was said to
fail. ⚠️ **A threshold cannot measure a change whose point is a duration, and near the
deadline it disagrees with itself run to run.** Nothing was reverted; `lib/data.js` stands
as merged.

### Security posture — SECURITY INVOKER, a deliberate deviation from "SECURITY DEFINER"

The approval said definer. It was built **invoker**, because definer rights would add
privilege for zero benefit: `app_projects` has RLS enabled with a single policy
(`app_projects_read`, SELECT, `{anon,authenticated}`, `USING (true)`), and the page already
read that table directly with the anon key. The function is `stable`, read-only, takes no
free-text SQL, pins `search_path = public, pg_temp`, and is `revoke all from public` +
`grant execute to anon, authenticated`. The sitemap_children lesson applies to anything
carrying definer rights, so the safest definer function is the one that is not definer.

### What still guards it
`test/maps-pagination.test.mjs`, 20 assertions: A6 still pins `PAGE_ROWS === 1000` (the
raise-it trap), and the **planted failure** proves `complete:false` with ZERO rows and
exactly one retry, with `maps.html`'s `throw new Error('incomplete app_projects read')`
asserted still present. Full 113-file suite green.

### Instrument added
`scripts/measure-projects-read.mjs` + dispatch-only `measure-projects-read.yml` — reports
durations, row counts and the complete flag, distinguishes a timeout and the honest
can't-load state from mere slowness, writes nothing. Use it, not the settle checker, for
any future question shaped "did this get faster."

### Proof list, closed at the DEFAULT 6,500 ms settle (not an indulgent one)

Two `spot-check.yml` runs, `SETTLE_MS` left empty so the default applied — **11 ZIPs, 33
page loads, 0 BROKEN, 0 JS errors**, all three page types populated on every one.

Run `32190472734`: 57104 community populated · tracker 19,601 · **dev-app 19,584** ·
28468 19,546 / 19,546 · 84302 68 / 24 · 28456 48 / 48 · 28462 13,195 / 13,195.
Run `32190746918` (the remaining heavy ZIPs + light controls): 57105 19,591 / **19,574** ·
57103 18,578 / **18,561** · 28470 19,141 / 19,141 · 28469 18,852 / 18,852 · 28436 47 / 47 ·
28420 857 / 857.

**Record-count parity holds**: 57104's 19,584 dev-app records is exactly its `app_projects`
development row count, and the light controls are unchanged from their pre-change figures.
All 6 heavy ZIPs from the proof list now pass at the impatient default — before the fix
they needed 15 s.

---

## GATE 2B CONSTANT DRIFT — RESOLVED, and the first parity comparison in three weeks (2026-08-18)

**The 517-vs-540 drift is fixed by deriving, not re-baselining** (PR #808). `scripts/gate2/
full-inventory.mjs` no longer states an inventory size anywhere; the workflow header no longer
states one either (it had said **457** while the script said 517 and production held 540).

### What the drift actually did
517 was a real rebaselined measurement (run `30397067493`, 2026-07-28, green). Production grew
to 537 by 08-11 and 540 by 08-18, and the gate then died on line 45 **0.55 s in** — before the
adapter, before Chromium, before any parity comparison. **27 consecutive red runs over 8 days
across four branches**, 25 of them on someone else's PRs, with the artifact step confirming it
every time (`No files were found with the provided path: gate2b-out/`). Not a false pass — a
spurious failure that stopped the gate from testing what it exists to test.

### THE PARITY FINDINGS — run `32198178049`, the first execution since 2026-07-28
```
records compared           : 540          (previously 521 at best — see the identity bug below)
same id set across modes   : true
field mismatches           : 0
category  (Street): commercial 126 · infrastructure 68 · residential 86 · other 166 · civic 37 · industrial 27 · facility 30
symbol    (Street): hexagon 126 · diamond 68 · pentagon 86 · circle 166 · cross 37 · triangle 27 · square 30
lifecycle (Street): approved 338 · operating 153 · proposed 49
fallback-shape records     : 166 of 540 (each carries a stated reason)
restFacs agrees with page  : true (harness 6 vs page 6)
console errors / page errors: 0 / 0
```
**ZERO rendering drift.** 8 fields × 540 records × 3 modes compared, 0 mismatches — markers,
categories, symbols, colours, lifecycle, evidence, filterKey and popup title are identical
across Street / Satellite / Focus. Category and symbol histograms are 1:1 and both sum to
exactly 540; lifecycle sums to 540 (operating 153 = 119 dev Operating + 4 dev Active + 30
facilities, which render lifecycle `operating` but filterKey `facility`).
- ⚠️ **One observation, NOT a defect: 166 of 540 (30.7%) render as the honest "Other project"
  circle.** Every one carries a stated `fallbackReason` — nothing is guessed — and it matches
  the pre-existing universe audit (`FALLBACK:other` is the largest shapeRule there too). It is
  a classification-coverage observation, not drift and not a regression.

### THE IDENTITY BUG the green run uncovered — pre-existing, now fixed
The gate keyed on `source_ref || name`, which is **not unique**: at 78617 that collapses 540
rows to **521 distinct values**, because `txdot-projects-info-all` is `record_url_precision:
"dataset"` and all **20** of its route segments share ONE url (17 distinct names, 20 distinct
coordinates). Consequences: 19 adapted rows were compared against a different row's
coordinates (a false `coordinate drift on SH 130 Install Traffic Signal`), and the parity
comparison silently ran over **521 records instead of 540** while able to report
`same_id_set: true`. Fixed with `__gid`, stamped once per row and carried through
harness → seed → page → collector; `SOURCE_OF` is built positionally; the collector **throws**
if a plotted record lacks `__gid` (no fallback — a silent one re-collapses the 20 segments and
reports it as a pass). Rejected: `source_ref|name|lat|lng` — still collides (537 of 540) and is
circular, keying on the field under verification.
- ⚠️ **NOT engine v22 dedup identity.** That key is deliberately content-based and keeps
  `file_date` + `case_number` because its job is deciding whether two SOURCE ROWS are the same
  real filing. This key's job is the opposite. Do not conflate them.
- **When the collision began is UNDATABLE with the available instruments** —
  `app_projects.created_at` is a re-materialization stamp (4 distinct seconds, earliest
  postdating the 2026-07-28 baseline). Stated plainly rather than estimated.

### The guards now in place
`censusOf` (in the new `scripts/gate2/lifecycle-buckets.mjs`) FAILS CLOSED on an unrecognised
status and names it — production's vocabulary is exactly four values (Operating / Approved /
Proposed / **Active**, 0 NULL), and the 2026-08 move of the five TABS rows off `On file` is what
this would have caught the day it happened. Empty buckets are reported **UNTESTED**, never
scored green: `unknown` now holds **zero records ZIP-wide and table-wide**, so it is proven
instead against the **frozen fixture** (`scripts/gate2/rows.tsv`, 39 verbatim production rows,
five still carrying `On file`) — and a fixture that loses those rows is a hard failure, not a
vacuous pass. 25 offline assertions in `test/gate2-lifecycle-buckets.test.mjs` pin all of it,
including the collision reproduced and the fix demonstrated. Suite 113 → 114 files.

**Left alone as ruled:** `NEAREST_FAC_CAP`, `verify-zip-universe`'s `12722` (the founder's
policy constant — deriving it from production is what the 80249 ruling forbids),
`verify-maps-uncap`'s budgets, `delvalle-golden`'s frozen fixture, and `verify-maps-rest-shapes`'
print-only baseline. `audit-marker-symbology.mjs` folded in the same vocabulary move (`Active`
added, same fail-closed guard).

---

## 2026-08-19 — `type_raw`: the mapping is now AUDITABLE (item A of the FALLBACK:other plan)

**What was wrong.** `use_type` is the MAPPED classification. Every connector emits
`unclassified` when an entry's `type_map` misses — and `unclassified` is also what an entry
that maps no type column at all emits. Once stored, two different situations were
**indistinguishable**:

| | | |
|---|---|---|
| (a) | the publisher genuinely states no project type | the generic "Other project" pin is **correct** |
| (b) | the publisher stated a value our `type_map` lacks | the generic pin is a **config gap** |

Measured 2026-08-18: **128,387 of 2,932,766** stored development rows carry `use_type`
"unclassified". Telling (a) from (b) meant re-probing 43 live sources — an answer that goes
stale the moment a publisher adds a value. It is now one `GROUP BY`, permanently.

**What shipped.** `type_raw` — the publisher's own value, verbatim (trimmed, case preserved),
BEFORE the mapping. Named `type_raw` in **both** layers; the exact discipline `status_raw`
already follows (engine → `app_projects.stage`).
- All five connectors, from the same expression: `type_raw: typeSrcVal || null`.
- `development_reports.sites[].type_raw` → `public.app_projects.type_raw` via `app_refresh_zip`.
- **NULL, never `''` and never the mapped word,** when the publisher stated nothing or the entry
  maps no type column. That distinction IS the field's job.

**⛔ NOT in the engine v22 exact-identity dedup key, and it must not be added.** It carries no
discriminating information the key lacks (same source row as `use_type`), and widening that key
is how a genuine duplicate starts surviving as two pins — the 2026-07-23 cleanup removed 9,631
excess copies across 273 cached rows. The reason is recorded **at the key** in `index.ts`, not
only here, and `test/type-raw-provenance.test.mjs` §8 fails if a future session "completes" it.

**Storage, measured before shipping** (fingerprints matched: 151 entries / 2705.8682 / 4280;
`dev_rows_matched` 2,799,246 equalled the independent count). Volume-weighted mean raw value
**17.32 chars** → **+49 MB typical / +83 MB worst** on `app_projects` (4,191 MB) and
**+26.2–27.0 bytes per jsonb element / +2.1–2.6% ≈ +12 MB** on `development_reports` (506 MB).
Combined **~+61 MB on 4,697 MB (~2%)**; the 57104 RPC payload goes 26 MB → ~26.3 MB.

**Deliberately UNINDEXED**, matching the `stage` precedent — the audit is an occasional report,
not a page query, and an index on a 4.2 GB table would cost more than the column.

### The denominator is REQUIRED, so it is a FUNCTION, not a query
`type_raw` is **non-retroactive**: a row carries it only once its ZIP is re-cached and
re-materialized. A partial turnover reported without its denominator reads exactly like a
complete one — so `public.type_raw_audit()` (`docs/type-raw-audit.sql`) always returns
`coverage.zips_not_yet_refreshed` first, reads the deploy time from `public.engine_deploy_marks`
rather than accepting one from the caller, and **fails closed**: with no recorded mark it
returns `complete:false` + an explicit error rather than a 100% figure. Positive control run
before the mark was inserted — it refused, as designed.

### Turnover: the CRON fills in. No deliberate full re-cache.
⚠️ **`CLAUDE.md`'s "pg_cron daily auto-refresh (`dev_refresh_fire` 09:00 UTC →
`dev_refresh_collect` 09:08)" is STALE.** Measured in `cron.job` 2026-08-19: those jobs are gone.
What runs is **`dev_refresh_tick()` every 15 min** (batch 250, 20-min cooldown) — a continuous
**oldest-first** rolling re-cache (`order by greatest(refreshed_at, last_refresh_attempt_at) asc
nulls first`), plus `app_refresh_sweep()` every 15 min for the materializer.

Firing all 12,722 at once is what the old `dev_refresh_fire` did and what this batched tick
replaced; overriding it would re-introduce a pattern someone deliberately removed. Oldest-first
ordering already guarantees full turnover with a bounded tail.

**Expected full-pass window, measured from the live `refreshed_at` distribution (not predicted):**

| within | ZIPs | of 12,722 |
|---|---|---|
| 1 day | 7,195 | 56.6% |
| 2 days | 10,365 | 81.5% |
| 3 days | 11,254 | 88.5% |
| 7 days | 12,688 | 99.7% |
| all | 12,722 | oldest 2026-08-07 (11.6 d) |

So **the audit becomes ~complete at 7 days and fully complete at ~12 days.** The materializer is
not the constraint — all 12,722 `app_community_meta` rows turn over inside ~3.5 h. Don't take
those dates on faith: `type_raw_audit()` reports the exact outstanding count.

### Item D, ruled and recorded so no future session reopens it
**The `use_type` vocabulary STAYS CLOSED at six values** (`lib/map.js::TYPE_EXACT`). Evidence:
fleet-wide there are **0 off-vocabulary rows** — every `FALLBACK:other` record reaches the
generic circle through a *missing per-entry `type_map` line*, never through a value the
vocabulary cannot express. The gap is per-entry config, not taxonomy. Widening the vocabulary
would change every pin shape in the fleet to fix a config problem.

### Still open from that plan
- **B — Cleveland (`cleveland-issued-building-permits`, 92,378 rows).** HELD until its
  four-value vocabulary is re-enumerated LIVE. The recon figure is not quotable as current on a
  swing that size.
- **C — the per-entry fallback report.** Buildable now that A has landed; run it only against
  `type_raw_audit().complete`, or state the denominator with it.
- **E — the "Other project" LABEL.** Founder ruling: *the label is wrong, the behavior is
  right.* Bring the wording question back **after C exists**, not before.

### GO-LIVE RECEIPTS — deployed 2026-08-19 13:30:26Z (run 32258428672, main@ca4bc0d, PR #817)

**Before** (78617, pre-deploy control, same query): 505 rows across 4 entries, **0 with `type_raw`**.

**After** — `public.app_projects`, ZIP 78617:

| registry_id | rows | with type_raw | distinct raw | mapped `unclassified` |
|---|---|---|---|---|
| `austin-site-plan-cases` | 267 | 243 | 97 | 153 |
| `austin-subdivision-cases` | 158 | 153 | 48 | 57 |
| `austin-zoning-cases` | 60 | 60 | 4 | 0 |
| `txdot-projects-info-all` | 20 | 20 | 9 | 0 |

Verbatim rows, mapped value beside publisher value:

```
Interport Multifamily                      Commercial     ← "Commercial Multi Family"
TRAVIS COUNTY CORRECTIONAL COMPLEX -#2     Commercial     ← "Commercial"
Austin Surf Club                           Residential    ← "Single Family"
SAND HILL ENERGY CENTER                    unclassified   ← "999"
Jetstar FBO and Private Hangars ABIA        unclassified   ← "Airport"
RAMI Transportation                        unclassified   ← "Truck Facility/Office/warehouw"
Travis County Correctional Complex Storage  unclassified   ← "Storage Building"
```

**Every one of the 505 sites carries the `type_raw` KEY** in the engine's own output (`has_key = rows`
on all four entries), so `null` means "the publisher stated nothing", never "the field is missing".

**It answered the question on its first day.** The 166 fallback records gate 2B reported are no longer
anonymous — top unmapped values at 78617: `999` **43** (an opaque code, not a type), publisher stated
nothing **29**, `SF, PUB` 5, `SF, ROW` 4, `Mixed Use -  Complete Propsed Use below` 3, `Vacant` 3,
plus `Mining`, `Light Industrial`, `Civic`, `Airport`, and the publisher's own typo `Miulti-family`.
Three distinct causes that used to look identical: an opaque sentinel, a joined multi-value
(`column_map` arrays JOIN), and free prose. That triage is Item C's input.

**The audit, first run:**
```
deployed_at  2026-08-19T13:30:26Z      complete  false
coverage     12,722 total · 108 refreshed since deploy (0.85%) · 12,614 NOT yet refreshed
rows         2,930,575 connector development rows · 476 with type_raw
caveat       "12614 of 12722 ZIPs have NOT been re-cached since the 2026-08-19 13:30Z deploy…"
```
Exactly the intended behaviour: a 0.85% picture **cannot** be read as complete.

⚠️ **One real event during the go-live, worth keeping.** The first 78617 re-cache came back
`facilities: 0` with `epa.ok:false, reason:"transient", attempts:18` — a genuine EPA FRS outage, which
the independent probe cron corroborated (`atlanta-dense` ok=false at 13:30). `dev_refresh_collect`'s
transient-safe guard **correctly refused** to overwrite 30 cached facilities with 0. The guard was not
bypassed to produce a receipt; the fire was simply repeated, FRS had recovered (`epa.ok:true`,
facilities 30), and the write went through the shipped path. A receipt obtained by disabling the
control that protects the data is not a receipt.

---

## 2026-08-19 — ITEM B GATE: Cleveland's vocabulary re-enumerated LIVE. It had MOVED.

The founder held B until the four values were re-verified live rather than quoted from recon.
They were right to: **the recon is stale in BOTH directions, and the publisher has been actively
migrating its labels.** Probed in the connector's own scope (Rule 13 — same `extra_where`, same
365-day window, `include_types` deliberately NOT applied so exclusions are visible).

**Every count is paired with its control and reconciles EXACTLY.**

| scope | control rows | vocab sum | distinct values | agreeing methods |
|---|---|---|---|---|
| in-window (`ISSUE_DATE >= 2025-08-19`) | 14,618 | **14,618** | 4 | groupBy `n DESC` · groupBy `n ASC` · `returnDistinctValues` — all 3 say 4 |
| all-time | 196,741 | **196,741** | 5 | groupBy |

**The live vocabulary, with first and last appearance:**

| `PERMIT_SUBTYPE` | in-window | all-time | first seen | last seen | in registry? |
|---|---|---|---|---|---|
| `Building Permits` | 8,340 | 8,340 | **2025-08-29** | 2026-08-14 | yes |
| `Residential` | 4,556 | 136,798 | 2015-01-02 | 2026-08-12 | yes |
| `Commercial` | 1,613 | 51,491 | 2015-01-02 | 2026-08-14 | yes |
| `Install Permits` | 109 | 109 | **2026-03-18** | 2026-08-14 | **NO — dropped at source** |
| `Mechanical` | 0 | 3 | 2025-07-09 | 2025-07-09 | no (inert, out of window) |
| `Building` | **0** | **0** | — | — | yes — **a value that has NEVER existed** |

**Three findings the recon did not have:**

1. **`Building` is fiction.** It sits in both `include_types` and `type_map` and matches **0 rows
   all-time**. Harmless today, but it is a config line asserting something untrue, and it is the
   reason "four enumerated values" read as confirmed when the live four are different.
2. **`Install Permits` (109 rows, current to 2026-08-14) is being DROPPED at source** by
   `include_types`. It appeared **2026-03-18**, five months AFTER the entry was wired (OH wire
   pass, 2026-07-17… itself after — so this value arrived between recon and now).
3. **The publisher is migrating.** `Building Permits` did not exist before 2025-08-29 and is now
   the **plurality in-window (57.1%)**, while `Residential`+`Commercial` — 96% of all-time volume —
   have fallen to 42.2% of the last year. Two of the five values were introduced within 12 months.
   This entry's vocabulary is not stable, and any "enumerated once" claim about it decays.

**Stored footprint, reconciled:** `app_projects` holds **92,372 rows across 39 ZIP pages** for this
entry (the recon's 92,378, drifted by 6 as the window rolled). **All 92,372 carry `type =
'Development'`; ZERO are `unclassified`.** So this was never a type_map MISS — it is a type_map
that maps every value onto the GENERIC member, which `lib/map.js` treats as non-terminal, so every
record falls through to keyword guessing and lands on the "Other project" circle. 14,618 source
rows → 92,372 stored is ~6.3x, the legitimate overlapping-3-mile-circle duplication (Chicago
precedent), not a dedup defect.

### B WIRED 2026-08-19 (founder ruling) — one PR

| value | in-window rows | mapped to | why |
|---|---|---|---|
| `Residential` | 4,556 | **`Residential`** | states a class |
| `Commercial` | 1,613 | **`Commercial`** | states a class |
| `Building Permits` | 8,340 | `Development` (generic) | **states NO class** — a specific shape would be fabricated |
| `Install Permits` | 109 | `Development` (generic) | **ADDED** to include_types — states no class |
| ~~`Building`~~ | 0 all-time | — | **REMOVED** — a config line asserting a value that never existed |

**6,169 of 14,618 in-window rows (42.2%)** gain a real pin shape; **8,340 (57.1%) correctly stay
generic.** Founder ruling on the 109: *"Excluding 109 live rows because the whitelist is stale is
silent under-coverage, not a ruling."*

`test/cleveland-type-map.test.mjs` — 19 assertions. It does **not** stop at the config: it drives
the SHIPPED `lib/map.js` resolver to prove the categoryKey AND the shape actually change
(`Development` is non-terminal, so asserting the config alone would prove nothing), and drives the
SHIPPED arcgis connector to prove an `Install Permits` row is now emitted rather than dropped.
Suite 108 → 109 files.

---

## 2026-08-19 — 🔴 NEW ITEM: a new `include_types` value SILENTLY DROPS. Nothing catches it.

Founder asked whether any existing mechanism would catch a new value appearing. **It would not**,
and the two config domains fail in opposite ways — which is why this was invisible:

| domain | entries | a NEW publisher value… | caught by? |
|---|---|---|---|
| `status_to_bucket` | **210** | is **excluded**, record DROPPED | ✅ **YES** — `scripts/source-monitor.mjs` reads distinct status values per entry, diffs against the entry's own `status_to_bucket`, and **GATES the run** on in-window unmapped values (tiered: in-window fails, out-of-window is latent/non-failing) |
| `type_map` | **151** | still **fetched**, lands as `unclassified` | ⚠️ visible in the data — and now NAMEABLE, since `type_raw` records the value verbatim |
| **`include_types`** | **10** | **NEVER FETCHED** — dropped at source by the pushed-down whitelist | ❌ **NOTHING.** No record, no quarantine, no `unclassified`, no monitor tier. The only symptom is a count that fails to grow. |

The monitor's own comment scopes it: *"An unmapped status is the one soft-fail that DROPS a
record"* (`source-monitor.mjs:606`). That was true when written. `include_types` drops records too,
and got no equivalent.

**The exposed fleet is 10 entries / 153 whitelisted values — smaller than feared, and named:**
`aurora-building-permits` (50 values, CO) · `slo-county-planning-permits` (49, CA) ·
`nashville-building-permits-issued` (14, TN) · `san-diego-approved-permits` (10, CA) ·
`fairfax-active-site-construction` (9, VA) · `portland-building-permits` (6, OR) ·
`columbus-building-permits` (5, OH) · `cleveland-issued-building-permits` (4, OH) ·
`fairfax-recent-building-permits` (4, VA) · `cincinnati-building-permits` (2, OH).

**Cleveland is the proof this is real, not theoretical:** `Install Permits` appeared 2026-03-18 and
was silently dropped for five months. Nothing reported it. It surfaced only because a human asked
for a re-enumeration.

**Proposed shape (NOT built — needs a decision):** extend `source-monitor.mjs`'s existing
drift machinery to the TYPE domain — probe each of the 10 entries' `type_source` distinct values in
the connector's own scope **without** `include_types` applied, diff against the whitelist, and
report in-window unlisted values. Same tiering as statuses. The 10-entry scope makes this cheap.

**One invariant already holds and is now PINNED** (`cleveland-type-map.test.mjs` §4b): every
whitelisted value has a `type_map` line or a `use_type_const`. Measured fleet-wide today: **0 gaps
of 10**. That is the *other* direction — a value fetched only to be emitted `unclassified`.

---

## Item C — GATED ON THE AUDIT, NOT THE CALENDAR (founder ruling, 2026-08-19)

Build the per-entry fallback report **when `public.type_raw_audit()` says the turnover is
trustworthy** — read `coverage.zips_not_yet_refreshed` / `complete`, do not build to the ~2026-08-26
estimate. Two design rulings, both recorded so they are not re-litigated:

1. **EXACT, driving the shipped classifier over real rows. NOT sampled.** *"Sampling is how we get
   another Cleveland."*
2. **Key it on "reaches the generic bucket", NOT on `type='unclassified'`.** Cleveland's 92,372 rows
   would have scored **clean** under the narrower key — they were mapped, just mapped to the generic
   member, which `lib/map.js` treats as non-terminal.

### B GO-LIVE RECEIPTS — deployed 2026-08-19 14:46:48Z (run 32266012276, main@431f019, PR #819)

Live smoke on **ZIP 44113** (Cleveland) through the deployed engine — 200, 5.47 MB, 4,779
development records, `epa.ok:true`.

**Before** (`app_projects`, same query): **4,664 rows — 4,664 generic `Development`, 0 classified.**

**After** — engine output and `app_projects` agree row-for-row:

| `type_raw` (publisher) | mapped `use_type` | rows |
|---|---|---|
| `Building Permits` | `Development` (generic) | 2,642 |
| `Residential` | **`Residential`** | 1,240 |
| `Commercial` | **`Commercial`** | 766 |
| `Install Permits` | `Development` (generic) | **72 — previously ZERO, dropped at source** |

**2,006 of 4,720 records on this page (42.5%) moved off the generic circle onto a real pin
shape**, matching the 42.2% predicted from the in-window vocabulary. The 72 `Install Permits` rows
are records that did not exist on any HomeSignal page before today.

`type_raw` is populated on every row, so the mapping on this entry is now auditable from stored
data alone — no re-probe needed to ask the question again.

⚠️ **Pre-existing and untouched:** 44113's cached row is **5.47 MB**, the known Cleveland
heavy-page class (44127 at 5.98 MB is the fleet high-water mark). The levers are
`spatial_zip_radius_mi` or an `out_fields` projection, and radius changes what residents see —
out of scope here, logged with numbers, unchanged by this PR.

---

## 2026-08-19 — TYPE-DOMAIN DRIFT GATE (include_types) — built, approved shape

`status_to_bucket` drift gates the run because an unmapped status drops a record. `include_types`
drops records the same way and had **no equivalent**. It now gates at the same severity.

**The three failure modes, which are NOT the same:**

| domain | a new publisher value… | visible as |
|---|---|---|
| `status_to_bucket` | FETCHED, then excluded | an unmapped status in the run report |
| `type_map` | FETCHED, emitted `unclassified` | a pin on the page, now NAMED by `type_raw` |
| **`include_types`** | **NEVER FETCHED** — the whitelist is pushed down INTO THE QUERY | **nothing. A count that fails to grow.** |

### The baseline, and why it is not a softening
Measured live in each connector's own scope: SLO keeps 49 of 83 live values, Aurora 50 of 60,
Columbus 5 of 7, Cincinnati 2 of 11. A literal "any unlisted value gates" fires on **80 values**
night one, almost all deliberate noise. The gate therefore fires on a value in **NEITHER**
`include_types` **NOR** `observed_types_unreviewed`.

⚠️ **`observed_types_unreviewed` means "observed at baseline and NOT fetched". It does NOT mean
reviewed and does NOT mean approved.** The name carries *unreviewed* so a future session reading
it cold cannot mistake it for a blessing. Nothing in the code or the report asserts those 80
values are correct to exclude — **that review is a separate pass the founder owns, and the gate
does not wait on it.**

**Seeded 2026-08-19 with an md5 fingerprint on BOTH sides** (server-side
`md5(string_agg(val, E'\n' order by val collate "C"))` vs Python `sorted()` — rule 8 + rule 9),
re-verified by reading the file back off disk. 210 → 210 entries, **nothing changed but the added
field**, 8 entries seeded, 80 values.

| entry | live values | fetched | observed-not-fetched |
|---|---|---|---|
| `slo-county-planning-permits` | 83 | 44 | **39** |
| `nashville-building-permits-issued` | 26 | 12 | **14** |
| `aurora-building-permits` | 60 | 47 | **13** |
| `cincinnati-building-permits` | 11 | 2 | **9** |
| `columbus-building-permits` | 7 | 2 | **5** |
| `cleveland` · `fairfax-active` · `fairfax-recent` | 4 / 9 / 4 | all | **0** (enumerated, emits nothing unfetched) |
| `portland-building-permits` · `san-diego-approved-permits` | — | — | **BASELINE NOT ESTABLISHED** |

Every enumeration reconciled EXACTLY to its own `returnCountOnly` control: Cleveland 14,618 ·
Columbus 42,395 · Nashville 9,080 · Aurora 15,890 · SLO 36,495 · Fairfax 2,148 / 4,049 ·
Cincinnati 11,266.

### 🔴 A REAL DROP THE BASELINE IS HIDING — first candidate for the review pass
**SLO emits `Renewable Energy ` with a TRAILING SPACE — 3,386 in-window rows — while the entry
declares `Renewable Energy` clean.** Those rows are **not fetched**. This is not a formatting
artefact: `includeTypesClause` trims the CONFIG value when building `col IN (…)`, but the live
side is the raw column and the database matches byte-exactly. Same for `Express ` (1,683 rows).
It is on the baseline (so non-gating) precisely because a baseline records *what is*, not *what
should be* — and it is exactly the class of genuine miss that hides among deliberate noise.

**This asymmetry was a bug in my first implementation and the self-test caught it.** I trimmed the
live value, which made a padded value look fetched. Corrected: **config trimmed, live verbatim**,
matching the connector.

### BASELINE NOT ESTABLISHED is a THIRD state, never "clean"
An ABSENT `observed_types_unreviewed` means nobody ever enumerated that entry — its silence
attests to nothing. An EMPTY ARRAY is the opposite: a positive "enumerated, emits nothing
unfetched." Never collapsed to one falsy check (pinned, B1–B4). Two entries are in it:
**Portland** (groupBy returned unreachable while its control returned 200/896 — the layer is
alive, the groupBy specifically failed) and **San Diego** (15 MB CSV, not enumerable via pg_net).
The monitor has runner egress and establishes them on its first pass. Both render as their own
report table, never a blank cell.

### Tier 3, permanent: DECLARED values matching ZERO live rows
Cleveland's fictional `Building` was not a one-off — **13 more across the fleet** (Columbus 3 of
5, Aurora 3, SLO 5, Nashville 2). Non-gating, own tier, permanent.

### The rest
- **`source-monitor.mjs:606` corrected.** It claimed an unmapped status was "THE ONE soft-fail
  that DROPS a record" — true when written, false since, and a stale comment asserting
  exclusivity is how this stayed invisible.
- **`TYPE_DRIFT=1`** with its **own** failing workflow step — not folded into the status one,
  because the two need different fixes and one shared error message would send the reader to the
  wrong file. Same `always()` + last-position discipline so every side effect completes first.
- **`soleTypeCol` restated** in `scripts/lib/type-drift.mjs`, not imported: the nightly workflow
  pins **Node 20**, which has no TS type stripping. The test asserts the restatement against the
  SHIPPED connector's exported version on a runtime that can (gate2 precedent).
- **The whitelist/mapping invariant is now permanent** — every whitelisted value has a `type_map`
  line or a `use_type_const`, asserted fleet-wide with a planted-gap positive control so its
  silence means something. Holds today: **0 gaps of 10**.
- **`observed_types_unreviewed` declared as an ANNOTATION key** in
  `connector-option-surface.test.mjs` — that guard failed the build first, correctly: it is
  monitor-only and must never influence a fetch, or the baseline would start widening ingestion.

Suite 109 → **110 files**; 30 assertions in `test/type-domain-drift.test.mjs`, self-tested in both
directions (a planted new value GATES; an unchanged vocabulary does NOT).

### 🔴 BLOCKING FINDING — the source-monitor has FAILED EVERY RUN FOR 11+ DAYS, before any drift check

Dispatching a `--dry-run` to prove Phase 3.6 executes (a syntax check is not proof it runs) found
the workflow dying **80 seconds in, at a step that runs BEFORE the monitor**:

```
Live scoreboard (ranked work list)
  [warn] dev_zip_source_ids HTTP 500 — retrying at p_limit=125
  [warn] dev_zip_source_ids HTTP 500 — retrying at p_limit=62
  [warn] dev_zip_source_ids HTTP 500 — retrying at p_limit=50
  live-scoreboard failed: dev_zip_source_ids failed: HTTP 500
    {"code":"57014","message":"canceling statement due to statement timeout"}
  ##[error]Process completed with exit code 1
```

**Every run since at least 2026-08-09 has failed — 11 consecutive scheduled runs plus this
dispatch — and four sampled runs all failed at the SAME step** (`Live scoreboard (ranked work
list)`, confirmed via per-step conclusions on runs 32228642357 / 32112228423 / 32007699380 /
31934013320).

**The consequence is the part that matters: `node scripts/source-monitor.mjs` never executes, so
NEITHER drift gate has run in 11+ days.** The status-domain gate — the one whose existence is the
whole argument for building the type gate — has been inert that entire time. It is correct in
code and unreachable in practice.

⚠️ **So the honest status of this build: the type gate is MERGED and UNIT-PROVEN, but it has NOT
yet executed against live data.** Its pure classification carries 30 assertions self-tested in
both directions, and its I/O helpers (`arcgisGroupBy`, `arcgisDistinct`, `ckanStatusCounts`,
`cartoStatusCounts`, `csvStatusCounts`, `windowClause`/`andWhere`) are the SAME functions the
status check already runs in production — but "the same helpers work elsewhere" is not the same
claim as "Phase 3.6 ran." It has not.

**Not fixed here, deliberately.** The failure is a Postgres statement timeout on
`dev_zip_source_ids`, which is a real query/performance defect needing its own judgement — not
the minimum-necessary, no-behavioural-surface change the unblocking exception covers. The step is
also deliberately NOT `continue-on-error` (workflow comment: *"that throw has to be able to fail
the job or the assertion is decorative"*), so the fix is a decision about the query or about step
ordering, not a flag flip.

**The options, for a founder call:**
1. **Fix `dev_zip_source_ids`** (paginate / index / lower the default `p_limit`) — addresses the
   root cause; the scoreboard keeps its fail-loud property.
2. **Move the scoreboard AFTER the monitor**, keeping it fail-loud. The drift gates then run even
   when the scoreboard is broken, and a scoreboard failure still reds the run. Smallest change
   that restores both gates tonight; does not fix the timeout.
3. Both — 2 now, 1 properly.

Recommendation: **2 then 1.** A monitor that cannot reach its own gates is worth less than a
scoreboard, and option 2 restores eleven days of missing coverage in one line of ordering.

---

## ✅ CLOSED 2026-08-19 — both gates VERIFIED on live data, and the timeout fixed at its cause

### Part 1 — the gates ran. Run `32276630120`, dispatched on `main` at `b7a2b73` (#823's ordering fix).

**Correction to the entry above, made before anyone acted on it: the blockage was 4 days, not
11+.** That claim was inferred from 11 consecutive red runs without reading which STEP failed. The
per-step conclusions say two different things: runs from 2026-08-08 through 2026-08-15 failed at
`Fail on status-domain drift` — the gate WORKING, exactly as designed — and only 2026-08-16
onward failed at `Live scoreboard`. The boundary is 2026-08-16. The status gate was not inert for
eleven days; it was firing.

**Phase 3.6 — TYPE-domain drift, first live execution:**

```
### Type-domain drift — an unlisted `include_types` value is NEVER FETCHED
- Entries checked: 10 · gating (in-window, in neither list): 0 · baseline not established: 2 · unreachable: 0
- No in-window unlisted type values on any entry with an established baseline. Nothing gates.
```

- **BASELINE NOT ESTABLISHED (non-failing, and reported as NOT clean):** `portland-building-permits`
  (NEWCLASS), `san-diego-approved-permits` (APPROVAL_TYPE) — "its live vocabulary has never been
  enumerated, so the absence of findings here attests to NOTHING." The third state renders as its
  own labelled section, not a blank cell, as specified.
- **Tier 2 (out-of-window, non-failing):** columbus `Minor Alteration` (64,113) · `Repair Replace`
  (63,682) · +11 more; slo-county 6; aurora 5; nashville 3; cincinnati 3; cleveland `Mechanical` (3).
- **Tier 3 (declared, zero live rows):** columbus 3 · slo-county 5 · aurora 3 · nashville 2.
- **Baseline matched, UNREVIEWED:** 5 entries, **64,311 records observed-not-fetched** (columbus
  27,829 · slo 17,706 · aurora 9,316 · cincinnati 8,230 · nashville 1,230). The report states
  plainly that listing one "records only that it already existed — never that excluding it was
  reviewed or approved."
- **The whitelist/mapping invariant held:** every whitelisted value has a `type_map` line or a
  `use_type_const`.

**Status-domain gate, same run: `STATUS_DRIFT=1`, 12 Tier-1 in-window unmapped values** across
irving · fairfax ×2 · udot · fort-worth · san-jose · coconino · kcmo · vtrans · austin-subdivision ·
cincinnati · new-orleans. **These are expected findings, not regressions** — five days of publisher
vocabulary that nothing was watching. They are the queue, handled per entry.

Run summary line: `0 wired, 141 flagged, 193 findings, 12 status-drift, 0 type-drift (10 entries
checked, 2 without a baseline).`

### Part 2 — `dev_zip_source_ids` no longer aggregates 3.08M rows per call

**Diagnosis first.** `app_projects` is **3,079,005 rows / 4,209 MB** and the RPC did a grouped
scan of all of it on every call, as `anon` (`statement_timeout=3s`, confirmed in
`pg_db_role_setting`). Nothing changed on 2026-08-09; the table simply crossed the line.

**The halving ladder was treating the wrong cause, and its own log proves it** — run 32276630120
walked `250 → 125 → 62 → 50` and threw anyway, ~53 s spent, zero successes. A page a fifth the
size still had to group the whole table. Removed, per founder call.

**Fix (Option A, approved):** `public.app_zip_source_ids` (zip, source_ids, dev_rows, updated_at),
upserted inside `app_refresh_zip()` right after the stale-row delete, so it summarises the ZIP's
final row set. The RPC reads it. Signature, pagination, ordering and clamp unchanged.

- `app_refresh_zip` patched **programmatically** from its own deployed text with a round-trip
  identity check (rule 7). The first attempt's closing assert refused and the transaction rolled
  back — re-read confirmed 17,487 chars unchanged. The assert was corrected, not deleted.
- **Parity fingerprinted, not eyeballed** (rule 8), sort collation pinned (rule 9): 7 chunks,
  **9,374 ZIPs, md5 identical on both sides in every chunk, 0 mismatches** — receipts in
  `docs/app-zip-source-ids.sql` §4.
- **Positive control:** mid-backfill the summary already held rows in ranges no chunk had written,
  written by the patched function under the live 15-minute sweep. Write-time maintenance was
  demonstrated, not asserted.
- **Measured as anon after:** p_limit 250 → **1.6 ms** · 1000 → **0.8 ms** · 5000 → **3.1 ms**
  (before: 14,350 ms for the 5000-row page).

**New caller hazard, pinned in `test/live-scoreboard.test.mjs`:** the request must stay STRICTLY
below the RPC's own 5000 clamp. At or above it a full page returns short, the keyset walk stops
after one page, and the scoreboard ranks on a fraction of the ZIPs with no error at all. Both new
assertions were proven to fail on their own violation before being accepted.

**Did anything I reported rest on the dead scoreboard? No.** Every coverage/Live figure reported
since 2026-08-16 was measured directly against Supabase in this session, not read from
`docs/source-monitor-report.md`. What WAS lost is the ranked work list: it stopped refreshing on
2026-08-16, so any *prioritisation* implied by that committed report is four days stale — it is
regenerated by the next scheduled run.

---

## 🔎 OPEN — sweep churn: investigated, NOT changed (propose-only, 2026-08-19)

Full write-up with every instrument: **`docs/app-refresh-sweep-churn-investigation.md`**.

**Headline:** `call public.app_refresh_sweep()` is **44 GB of WAL (94.5% of all WAL)** and
**7,968 s (62.6% of all database execution time)** over 79 ticks — 570 MB and 101 s per tick against
a 100 s budget, i.e. it spends its entire budget every tick and has never finished early. Cluster
WAL is 76 GB/day. A full pass over all 12,722 ZIPs takes ~4 h (~6 passes/day, ~91 ms/ZIP).

**Why nothing is "unchanged":** the `app_projects` upsert always writes `last_seen_at=_run`, and the
stale-row reaper (`delete ... where last_seen_at < _run`) depends on that stamp. **70.5% of the
resulting updates are non-HOT** (12,394,463 of 17,580,429), so each one rewrites all four indexes.

**Skipping is viable but the predicate is a three-way OR, not a content hash** — cache watermark,
upstream-write watermark, and *elapsed time*, because the meetings/alerts queries are relative to
`now()` (53 meetings leave "upcoming" and 526 alerts leave the 14-day window in the next 24 h).

⚠️ **The tempting number is the wrong one.** 94.1% of pages are currently ahead of their cache — but
that is a snapshot, not a rate. The rate is 2.7 cache changes/ZIP/day against 6 materializations, so
a cache-driven skip removes **~55%**, not 94%. And the window was confounded: **ingest wrote nothing
for 21 hours**, so even 55% is an overestimate.

**Not costs today:** replication (0 slots, 0 connections — though `wal_level=logical` means a future
slot inherits 76 GB/day), and autovacuum, which is keeping up (~28 cycles/day, dead tuples below
threshold). **Not measured, and said so:** index bloat (`pgstattuple` not installed) and plan
stability (no symptom observed, not probed).

**Recommendation for a founder call:** ship the max-age floor + shadow audit + skip-rate metric with
the predicate **evaluated but not acted on** — pure observation, no behaviour change — and decide
from a measured would-have-been-wrong rate rather than from this quiet window. Skip-first,
instrument-after is the ordering where a stale page is found by a resident.

### 📌 Unrelated, surfaced by the same measurement — ingest has been silent 21 hours
Newest `alerts.created_at` `2026-08-18 20:04`, newest `meetings.created_at` `2026-08-18 18:12`; zero
rows on 2026-08-19 against a 7-day baseline of 200–4,700/day. Longer than the 4 h/6 h cadence the
2026-08-16 Actions-budget cut set. `homesignal-ingest`, out of scope here, flagged not chased.

---

## 🔬 RUNNING — sweep skip probe, shadow mode (armed 2026-08-19 ~17:46 UTC)

Founder decision: **instrument-first.** Evaluate the skip predicate every tick, log what it WOULD
have decided, **act on nothing.** SQL of record: `docs/app-refresh-sweep-skip-probe.sql`.
Kill switch: `update public.app_flags set enabled=false where name='sweep_skip_probe';`

- **Max-age floor built in from the start** (24h) — the only one of the four failure modes that is
  *prevented* rather than detected.
- **The three OR branches are logged separately**, as instructed, plus the time branch's three
  sub-conditions (`day_rollover`, `meeting_crossed`, `alert_aged_out`), so we learn which one does
  the work.
- **The wrong-skip audit is 100%, not a sample.** Because nothing is actually skipped, the real
  refresh runs for every ZIP anyway — fingerprint before, refresh, fingerprint after. A 25-ZIP
  sample is unnecessary. This is a property of instrument-first that skip-first would have thrown away.
- **A simulated timeline** (`app_skip_probe_state.last_would_refresh_at`) is what every branch is
  measured against. Against the real 4h rotation a 24h floor could never bind and we would learn
  nothing about it.

### ⛔ BLOCKER ON THE REPORT, not on the probe — the window is NOT yet representative

The founder's premise for starting the clock was *"the 21h gap has cleared (152 alerts / 191
meetings written in the last 24h, verified)"*. **Re-measured 2026-08-19 17:40 UTC: it has not
cleared.** The rolling-24h counts are real but they are the OLD rows aging out of the window, not
new arrivals:

```
max(alerts.created_at)   = 2026-08-18 20:04:00   -> 21.6 h ago
max(meetings.created_at) = 2026-08-18 18:12:07   -> 23.5 h ago
alerts/meetings created since 2026-08-18 21:00   = 0 / 0
last 3 hours                                     = 0 / 0
hourly histogram: last non-empty hour is 2026-08-18 20:00
```

The counts fell 152 -> 151 and 191 -> 188 between the founder's reading and mine — which is the
tell: a rolling window that only ever decreases has nothing entering it.

**Consequence:** the upstream branch reads 0 for reasons that have nothing to do with the
predicate, so any would-skip rate measured now is an **overestimate**. The probe records this
itself — `v_app_skip_probe.representativeness` marks every zero-ingest hour, computed at read time
from the source tables so it cannot go stale. **The report waits for hours marked `ingest active`.**

### Logged, not for now
- **`pgstattuple` is not installed, so index bloat is unmeasurable today.** If churn keeps
  mattering, installing it is a prerequisite for the next round of this question.
- **Neither `alerts` nor `meetings` has an `updated_at` column**, so the upstream branch sees
  INSERTS only — an in-place UPDATE (the ingest category backfill is exactly this shape) is
  invisible to it. Adding that column upstream is a prerequisite for any real skipping.
- **The shadow run cannot measure the second-order effect.** The sweep is budget-limited, so real
  skipping would shorten the rotation, which changes the intervals every branch measures over.
  First-order estimate only.

---

## 🔴 P0 — `homesignal-ingest` Actions have been dead since 2026-08-18 20:18Z (diagnosed 2026-08-19)

**Every notice and meeting feed is frozen for residents.** Ingest repo's jurisdiction; diagnosed
here because the symptom was found here. **Propose-only on every fix below — nothing was changed.**

### Where it fails: BEFORE a runner is assigned

| | |
|---|---|
| last successful run (any workflow) | **2026-08-18 19:56:37Z** — `Ingest heartbeat`, run `32179458019` |
| last successful `ingest.yml` schedule | **2026-08-18 16:25:55Z**, run `32160255644` |
| **first failure** | **2026-08-18 20:18:19Z** — `HomeSignal ingest`, run `32181506635` |
| since | **every run of every workflow fails** — schedule, push, pull_request, workflow_dispatch alike |

**Runs ARE firing.** GitHub created scheduled runs all day (07:56, 08:05, 08:07, 08:31, 09:08,
09:16, 09:35, 12:37, 13:22, 13:25, 14:17, 16:25 on 08-19). The scheduler is not dropping anything —
this is not the "cron silently stopped" failure mode.

```
job 96143014234   started 16:25:55  completed 16:25:57  = 2 seconds
                  runner_id: 0      runner_name: ""     log download: HTTP 404
run 32181506635 (08-18 20:18)  billable.UBUNTU.total_ms = 0
run 32236046924 (08-19 09:08)  billable.UBUNTU.total_ms = 0   <- 13h apart, same signature
```

**Zero billable milliseconds = the job never executed.** No logs exist because none were produced.
It hits every workflow and every trigger identically, and a uniform failure across independent
workflows is an infrastructure fault, never a code fault.

**The discriminator: `homesignal-ingest` is PRIVATE; `homesignal-site` is PUBLIC.** Private-repo
Actions consume billed minutes, public-repo Actions are free. Same account, same `ubuntu-latest`
label — and the site repo has been green throughout (source-monitor 16:33, unit + browser CI 17:50).

### ⚠️ CAUSE IS UNVERIFIED — an Actions spending-limit/billing block is the LEADING HYPOTHESIS ONLY

GitHub does not expose the reason through the API (the check-run `output` is empty) and the billing
endpoint needs account scope this session does not have. **Do not record billing as the cause until
the billing page has been read.** It fits the documented history — the Actions budget was exhausted
**twice in 36 hours** around 2026-08-16, which is what prompted the cadence cut — and this would be
a third in four days, meaning that cut was insufficient. That is a reason to check, not a finding.

Ruled out with receipts: Actions disabled for the repo (runs would not be CREATED; they are) · a
GitHub incident (the public repo is unaffected on the same account and runner label) · a code or
config bug (would not fail push, PR, schedule and dispatch identically at 0 ms with no logs) · the
dead PAT (scheduled runs do not use one).

### Two OTHER failures already in flight — distinct from this one, both already alarmed
1. **`github_credential` = HTTP 401 Bad credentials** — the vault `github_actions_pat` is dead.
   Last notified 2026-08-18 23:10. Blocks pg_cron from dispatching `digest.yml`. **Founder owns the
   rotation.**
2. **`digest_delivery`** — newest delivery **2026-08-01 22:06Z, 427 hours ago**. 18 days.

### Why nothing alarmed, and the design flaw underneath it
- `local_news_ingest` threshold is **72h**; at 21.1h it still reads `ok=true`. It fires ~**2026-08-21
  20:00Z**, ~50 hours after the outage began.
- `government_notice_ingest` and `meetings_ingest` are **explicitly NOT ALERTABLE**, and
  `pipeline_health_tick()` records why: *"measured worst normal gap 101.3h vs 113.8h outage — no
  separating threshold exists."* That reasoning is correct.
- 🔑 **`Ingest heartbeat (a dropped cron is silent)` is itself a private-repo Actions job.** It dies
  in exactly the scenario it exists to detect. **The watchdog is inside the thing it watches — that
  is the design flaw, and it is independent of whatever the billing page says.**

### Resident impact, measured 2026-08-19 17:5xZ
946 meetings still upcoming (74 elapsed during the gap and correctly vanished — meetings render from
a LIVE read, so no staleness there) · 4,944 government notices in the 14-day render window, none new
for 22h · **2,970 local-news items in the 7-day window, and that window SLIDES** — `NEWS_MAX_AGE_DAYS
= 7`, so local-news tiles start emptying with nothing replacing them · 440 communities fed in the
last 7 days.

---

## 📋 PROPOSED (none built, none blocked on billing)

### P1. Move the watchdog OUT of the watched repo
A small scheduled workflow in **`homesignal-site`** (public → free Actions) that evaluates the ingest
repo's liveness. This survives the exact failure that killed the in-repo heartbeat, and it would have
survived it today.

⚠️ **It must NOT read the GitHub API to do this.** `homesignal-ingest` is private, so a cross-repo
read needs a PAT — which re-introduces the credential dependency in a second place, and that
credential is dead right now. See P2 for what it reads instead.

### P2. Alarm on RUN SUCCESS, not row arrival — and answer the dead-PAT case rather than assume it away

The reasoning holds: row arrival cannot separate outage from quiet (101.3h normal gap vs 113.8h
outage), but **a fixed schedule makes "no successful run in 6h" separating against a 4h cron.**

**THE PAT DEPENDENCY IS REAL AND IS LIVE RIGHT NOW, so the design removes it from the critical path
rather than documenting it.** Three layers, and only the middle one needs a credential:

- **Layer 1 — the heartbeat ROW (no PAT, no GitHub API).** The ingest run writes one row to a
  `ingest_run_heartbeat` table at the END of a successful run, using the `SUPABASE_WRITE_KEY` it
  already holds. pg_cron reads it directly — no egress, no credential.
  - 🔑 **This is NOT row-arrival alarming wearing a different hat.** `alerts` rows arrive only when
    publishers publish, which is why 101.3h quiet gaps are normal. A heartbeat row is written
    **unconditionally on every successful run, on a fixed schedule** — the denominator is runs, not
    publisher behaviour. That is precisely what makes it separating.
  - Written at the END so it attests to completion, not to having started.
  - Today's failure produces no heartbeat → alarm fires. Correct by construction.
- **Layer 2 — the GitHub API (PAT).** Adds only the DIAGNOSIS: did the run not fire, fire and fail,
  or fail pre-runner? Useful, not load-bearing.
  - ⚠️ **When the PAT is dead this check must go to an explicit UNKNOWN that IS ALERTABLE.** Note
    the existing `github_credential` check deliberately treats unknown as *not* alertable
    (`coalesce(_gh_status = 200, true)` / `(_gh_status is not null)`) — correct there, because
    unknown means "probe fired this tick, read it next tick", a one-tick transient. It would be
    **wrong here**: for a watchdog, "cannot read" means blind, and blind must never be silent.
    Layer 1 is the floor underneath, so a dead PAT degrades detail, never detection.
- **Layer 3 — P1's site-repo workflow reads Layer 1** via the Supabase anon key (already used by
  `verify-communities`). No PAT anywhere in the detection path, and detection survives the ingest
  repo being entirely dead.

### P3. What the row-arrival thresholds should become once P2 exists

**Not "tune them" — RE-SCOPE them.** Once run-success alarming exists, elapsed-time row-arrival is
redundant *as an outage detector*. But it is NOT redundant outright: it is the only thing that
catches **runs succeeding while writing nothing** — a config or regression fault (the feeds table
emptied, a filter change dropping everything, the 1,000-row window class). P2 cannot see that at all.

🔑 **Conditioning row arrival on run success makes it separating too.** "Zero rows across the last K
*successful* runs" has no quiet analogue, because the denominator is runs rather than hours — which
is exactly the property the 101.3h-vs-113.8h measurement said elapsed time lacks.

- `local_news_ingest` (72h elapsed) → replace with "0 local_news rows across the last K successful
  Local News registry runs". Stays alertable.
- `government_notice_ingest` / `meetings_ingest` → **can BECOME alertable** under the same
  conditioning. The recorded reason they are not — no separating elapsed-time threshold — dissolves
  when the unit is runs.
- ⚠️ **K CANNOT BE PROPOSED YET.** The per-run write distribution for gov notices and meetings has
  NOT been measured, and a K guessed from intuition is how a gate becomes either noise or
  decoration. Measure writes-per-successful-run over a healthy fortnight first, then set K.

### Sequencing note
**If the billing page confirms a third exhaustion in four days**, the fetch-layer work — conditional
GETs (`If-None-Match` / `If-Modified-Since`) and killing the per-endpoint `sess.warm()` — moves ahead
of any new state expansion, per `homesignal-ingest/CLAUDE.md`'s own ordering. Every tranche of feeds
raises the burn, so the fetch layer has to get cheaper before the footprint gets bigger.

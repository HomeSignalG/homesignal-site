# Denton workstream B: compound permit identity, the "missing" Denton/TxDOT records, and the notification safeguards (2026-10-14)

Branch `claude/wsb-identity`. **Nothing here is applied, merged, deployed, refreshed or activated.** No registry line was added, no alias file exists, no production
write was made. Production was READ once (SELECT only, `db-sql` run `38599809183` from the scratch branch `claude/wsb-adhoc`, never to be merged).
Anything not read off a live object, a committed file or a run log is marked **UNVERIFIED**.

## 0. Canonical truth path (CLAUDE.md "NO SHORTCUTS", mandatory statement)

* **Canonical truth path:** publisher layer (`OBJECTID`, `PermitID`) -> generated, fingerprinted alias file -> `sources/arcgis.ts` (`source_id`) -> `public.app_projects.source_key` (`app_source_key` adopts `source_id` verbatim) -> `geo.n5_geom` / `geo.n5_serving_membership` (via `scripts/n5_shard.py`) -> Map 1 / ZIP page / reports.
* **Decision owner:** ONE rule, two implementations pinned to one table: `supabase/functions/get-address-report/sources/identity-aliases.ts::applyIdentityAlias` (connector) and `scripts/identity_aliases.py::source_identity` (fetcher, generator, checker). `test/fixtures/identity-aliases/parity-cases.json` is asserted against both. Membership stays owned by `geo.zip_point_membership_in` / serving generation; nothing here decides membership.
* **Shortcut check:** searched for competing "which feature is this record" logic. `identity_fields` (all-or-nothing, rekeys everything) is mutually exclusive with the new option and the connector, `check_identity_aliases.py` and `n5_shard.py` refuse the combination. No `#`-splitting of `source_key`/`project_ref` exists in `lib/`, `scripts/`, `supabase/functions` (grep for `split('#')`, `lastIndexOf('#')`, `rpartition('#')`, `split_part(...,'#')`: no hit; `project_ref` is built as `source_key || '#' || source_seq` in `docs/n5-unit-a4-delivery-contract.sql` and is only built, not parsed, in this repo; consumers in homesignal-ingest were NOT checked: **UNVERIFIED**, see section 6 risk R3).

## 1. Compound permit identity (built, offline-tested, default-off)

### 1.1 The rule (extends `docs/denton-permit-identity-design-2026-10-14.md`, which is on `claude/wsc-geometry`)

* Of the features sharing one identifier value, the **lowest OBJECTID keeps the legacy key** (`arcgis:<registry>:<PermitID>`, unchanged).
* Any later feature that is a **different record** gets `<PermitID>#<OBJECTID>`.
* A later feature that is a **true publisher duplicate** (same comparable attributes, both with a point, within 30 m) of an earlier record shares that record's identity, so exact-identity dedup keeps collapsing it. This resolves the design's open risk 5 (30 of the 149 groups were unclassified). Missing geometry is never assumed identical.
* Unique, blank and unlisted ids are never touched. An alias is applied only if it **extends the row's current identifier** (a publisher re-keying an OBJECTID can never attach a stale alias to a new id).
* The reused set comes from a **full-layer scan** (`where=1=1`, never the registry `extra_where` or an envelope), written to `identity-aliases/<registry_id>.json`, fingerprinted order-independently (sum of per-row md5 prefixes: no collation, claims rules 8-9): `layer_fingerprint` over (OBJECTID -> id), `alias_fingerprint` over the alias entries, plus an `evidence` table (every member of every reused id with its coordinates).

### 1.2 What was built

| piece | file |
|---|---|
| connector option `identity_aliases_file` (optional registry field, default-off, per entry), `deps.identityAliases`, `recordIdentity()` (the one place a `source_id` segment is made), run-report counter `identity_alias_applied`, quarantine note when a declared file is unusable | `sources/arcgis.ts`, `sources/identity-aliases.ts`, `index.ts` (passes `IDENTITY_ALIAS_FILES`), `identity-aliases/index.ts` (empty map; the static-import loader) |
| shared Python rule, generator, daily live check, offline checker | `scripts/identity_aliases.py`, `scripts/gen_identity_aliases.py`, `scripts/check_identity_aliases.py`, `.github/workflows/check-identity-aliases.yml` (offline on PR; **daily live compare**; dispatch `generate` prints the file in the job log) |
| `n5_shard.fetch_features` support | asks the publisher for the **bare** id (an alias string would find nothing), requests `OBJECTID` too, routes each returned feature by `source_identity`, gives each key only its own feature. An opted-in entry whose file is missing/unsound/foreign returns `EXCLUDED` (never fetched under legacy keys) |
| `source_key_basis` | `docs/app-source-key-basis-objectid-alias.sql`: PARKED splice adding `source_id:case_number+objectid_alias`. Spliced from the live body, drift-guarded on the md5 **read from production today** (`d1c77344bb482e18a49dfaefe208b013`, 753 chars; the body is committed as a fixture and the test proves the md5 matches), anchor count 1, excision reproduces the original, grants unchanged, behaviour asserted. `app_source_key` is untouched (adopts `source_id`). |
| CI parity | `check_identity_aliases.py` fails when: a registry entry names a missing/foreign/unsound file; a file is not listed/imported by `identity-aliases/index.ts` (the engine would silently use legacy keys); a file is orphaned; the engine does not pass `IDENTITY_ALIAS_FILES` to `arcgisForZip`; `n5_shard.py` stops routing through the shared module; `identity_fields` and the option coexist |

### 1.3 Evidence

* **Legacy keys unchanged.** `test/identity-alias-legacy-keys.test.mjs`: 14 committed real-capture fixtures (12 registry entries) driven through the shipped connector; **44 `source_id`s identical** to `test/fixtures/identity-aliases/legacy-source-ids.golden.json`, which was produced by the connector on `origin/main` BEFORE this change (data, not a recomputation; regeneration recipe in the test header). A second population: an entry that does not name the option ignores a loaded alias file, with a positive control that the same file WITH the opt-in does alias.
* **Reused PermitIDs, true duplicates, renumbering.** `test/fixtures/identity-aliases/denton-shaped-scan.json` (SYNTHETIC rows shaped like the layer; labelled so): far-apart pair, same-attributes duplicate pair, three-feature group (duplicate of primary + a different record), same place with different attributes, same attributes far apart, a duplicate of a NON-primary record, unique/blank ids, geometry-less pair. Expected alias set asserted exactly. Fingerprints are shown order-independent (5 shuffles). **Renumbering guard:** two features of ONE id trading OBJECTIDs leaves the alias set and the (OBJECTID -> id) fingerprint unchanged (the legacy key would silently change owner - design risk 2), so that fingerprint alone is NOT enough; the `evidence` table catches it (`diff_alias_files`: "OBJECTID n now sits elsewhere"). Two unique ids trading OBJECTIDs are caught by `layer_fingerprint`; a new reuse turns the check red. Pinned in the connector test as a KNOWN LIMIT (the connector cannot see renumbering; the daily live check is the guard).
* **Suites:** `node scripts/run-unit-tests.mjs --offline`: **357 files pass**. New: `identity-alias-legacy-keys` (33 checks), `identity-alias-parity` (38, spawns the Python suite: 64 checks), `identity-alias-basis-sql` (10), `scope-nonpoint-membership-gap` (5).
* **Mutation checks** (`python3 test/identity-alias_mutants.py`, scratch copy, never edits the repo): **31 weakenings, 31 killed**, control passes. They include: primary also aliased; highest OBJECTID keeps legacy; duplicates not folded; attribute differences ignored; distance ignored; missing point treated as duplicate; order-dependent fingerprint; identity-blind fingerprint; stale alias applied; renumbering swap undetected; hand-edit undetected; connector ignoring the verdict; engine never passing the files; shard not routing by OBJECTID / asking for the alias string / omitting OBJECTID / fetching under legacy keys when the file is unusable; the checker skipping each of its rules. (Two first-run survivors were equivalent/redundant mutants; the checker tests were strengthened until each rule is individually load-bearing.)
* **No Denton alias file is committed and the registry line is not added.** The sandbox has no egress to `gis.dentoncounty.gov` (curl: proxy 403). The file must be generated on a runner (`check-identity-aliases.yml`, mode `generate`, prints between markers), reviewed (the 149-group table: ids, OBJECTIDs, distance, primary, duplicate-vs-distinct counts), committed through a PR with its `index.ts` import line, and only then is `"identity_aliases_file": "denton-county-dev-permits.json"` added to the registry entry. The checker makes every step of that mandatory.

### 1.4 Residual risks (not removed by this change)

* R1 Existing history on the 149 legacy keys may describe the second feature (MAPS drafts, capture keys, `social_posts`): list references before activation; do not rewrite approved/published posts.
* R2 Renumbering between a publisher republish and the next daily check (up to 24 h) can swap the legacy key's owner at fetch time. Mitigation is the daily check plus regeneration as a reviewed change.
* R3 `project_ref` becomes `...#<OBJECTID>#<seq>` for alias keys. No parser of it exists in this repo; homesignal-ingest consumers (project-page address keeping, `base_project_key = source_key|source_seq`) were not read: **UNVERIFIED**; verify before activation.
* R4 Other layers have the same shape (design risk 7); the mechanism is per-registry and reusable, no other entry is opted in.
* R5 ORDER: activate identity aliases **before** widening the ZIP scope for Denton (section 2). Widening fetches more features of reused ids; without aliases it merges more unrelated features under shared keys.

## 2. The 5,298 "missing eligible" Denton records and the 32 never-ingested TxDOT projects

### 2.1 Evidence read (all from the audit outputs, not re-derived)

Audit JSON `audit5.json` (2026-10-13 00:10Z, 32 ZIPs; kept in the session scratchpad) and the `denton-launch-audit` `data` job log of run `38583292854` (read through the Actions log API). `eligible_missing` for `denton-county-dev-permits`, per ZIP:

| ZIP | eligible (publisher point inside polygon, whitelist + mapped status) | missing from serving |
|---|---:|---:|
| 76247 | 1,833 | 1,438 |
| 75068 | 5,459 | 1,246 |
| 76266 | 1,292 | 818 |
| 76259 | 977 | 591 |
| 76207 | 793 | 508 |
| 76249 | 503 | 219 |
| 76227 | 5,851 | 169 |
| 76226 | 2,494 | 167 |
| 76258 | 412 | 124 |
| 76262 | 51 | 9 |
| 75036 | 1,836 | 8 |
| 75033 | 1 | 1 |
| other 20 ZIPs | 0-1,594 | 0 |
| **total** | **23,560** | **5,298** |

The eight pilot ZIPs above sum to **5,061** (1,438+1,246+818+591+508+169+167+124) and the other four to **237** (219+9+8+1): 5,061 + 237 = **5,298**, exact.

### 2.2 Cause of the 5,298: ingestion scope, proven by an independent earlier measurement; not recency, not identity

* `docs/geographic-coverage-audit-2026-10-10.md` section 1 measured the same population independently: of 25,727 whitelisted records, **5,429 were never stored; 0 of the stored lie outside a +-3 mi centroid square and 0 of the 5,429 missing lie inside one** (20,298 stored all inside, 5,429 missing all outside). 5,348 of the 5,429 lie in a canonical ZIP polygon; 5,061 in the nine pilot polygons. This audit's 5,061 equals that figure; its missing share rises with polygon size (76247 Justin 78%, 76207 64%, 76266 63%, 76259 61%; 75056 and 75065 0%), the signature of a disc-vs-polygon scope.
* Serving is not dropping anything (`stored_not_served` = 0 in all nine pilot ZIPs, same document).
* **It is not the 365-day / recency rule.** The Denton entry has **no `recency_days`** (registry read today), so the connector does not drop old records; the 365-day figure is only the report flag `older_than_a_year`, and the audit treats freshness as a reported fact, never an input to `eligible`. **It is not identity:** the audit counts ids, 149 reused ids affect displayed geometry (design doc), not whether an id is stored.
* **How many of the 5,298 are eligible-current: 0.** The layer is frozen: `max(DateReceiv)` = **2023-06-09** over 56,500 rows (`docs/denton-data-integrity-launch-gate-2026-10-10.md` section 1; audit `newest_source_record` 2023-06-06 for the whitelisted set). The cut-off for "within 365 days" on 2026-10-14 is 2025-10-14, so every one of the 5,298 is older than 365 days (pilot split from the coverage audit: 727 approved 2023, 1,628 approved 2021-22, 2,681 approved 2020 or earlier, 20 Decided, 5 Pending). Production confirms the stored side today: Denton `app_projects` 26,558 rows / 20,298 keys, **max `submitted_at` 2023-06-06, 0 rows within 365 days** (run `38599809183`). The 237 non-pilot records have no per-record dates in the audit file; the layer-wide maximum bounds them. Restoring them makes reports more complete about the past; it adds no current record.
* **The shared fix already exists and is deployed in code but switched OFF:** the polygon-bounds scope (`sources/scope-box.ts` union of the legacy square and the ZIP polygon bbox, tested downstream by `public.zip_scope_members`). Production read today: `zip_scope_bounds` md5 `30a72ed5...`, `zip_scope_members` md5 `815a0b83...` exist, `anon` cannot execute either. It is enabled by the server secret `ZIP_SCOPE_BOUNDS_MODE` (state UNVERIFIED, unreadable by SQL). It applies to all 180 `spatial_zip_radius_mi` entries, not Denton alone. **No new Denton code is needed; what is missing is the enablement sequence in section 5 (identity aliases and the notification safeguards first).**

### 2.3 The 32 never-ingested TxDOT projects (same run log)

`txdot-projects-info-all`: 379 line projects in the audit bbox, **34 missing**: `not_in_app_projects` **32** (never fetched) + `candidate_geometry_but_no_membership_in_this_zip` **2**. Examples carry several ZIPs each (131502014: 75033, 75068; 156701043: 75033, 75036, 75068).

* Cause of the 32 is the same legacy scope (the layer is statewide with `spatial_zip_radius_mi: 3`; a corridor crossing a ZIP polygon but not the +-3 mi centroid square is never requested). The per-id geometry was not re-fetched here (no egress), so which of the 32 are square-misses is **UNVERIFIED per id**; the audit's own cause tally is the receipt.
* **The shared fix does NOT fully cover lines and polygons.** `featureScopeClass` treats a non-point feature whose bbox misses the legacy square as "widened" and tests ONLY its pin (half-length point) with `zip_scope_members`, while serving membership is `ST_Intersects` of the WHOLE geometry (`docs/n5-generation-publish.sql`). A corridor crossing the polygon whose pin falls outside it is excluded and counted as a correct exclusion (`outside_excluded`), i.e. silently. Pinned, with the control that the crossing line has a vertex inside the polygon, in `test/scope-nonpoint-membership-gap.test.mjs` (behaviour asserted as TODAY'S; fixing it must move it on purpose).
* **Smallest shared fix (not built, needs a production SQL object):** a geometry-aware sibling of the one membership function, e.g. `public.zip_scope_members_geom(p_zip, p_geoms jsonb)` using the same `geo.zip_membership_boundary` + `ST_Intersects` as step (1) of the serving build, called by `keepMembers` for `rings`/`paths` features instead of the pin, behind the same `widened-only` classification, same fail-closed fallback, applicable to every non-point `spatial_zip_radius_mi` entry. It was not built because the sandbox has no PostGIS server to prove the SQL (the existing suite `test/zip_scope_members_pg` needs one); building it untested would violate the repo's proof standard. The 2 `candidate_geometry_but_no_membership` ids are a different class (geometry fetched, membership rejected by the generation) and are not explained by this.

## 3. Historical-notification safeguards: live in production?

Read-only, `db-sql` run `38599809183` on `claude/wsb-adhoc` (query file `docs/adhoc/query.sql` on that branch), 2026-10-14 16:38Z, PostgreSQL 17.6; controls in the same result: 1,087 public functions, 642 ledger rows, `dev_change_event` ~938,749 rows, `app_projects` ~3,149,692. The result agrees with `docs/denton-ingest-apply-plan-2026-10-14.md` (PR #1912) on every object it covers.

| safeguard | state | evidence (value read) |
|---|---|---|
| **#1848** collector plan-stable fix (`dev_refresh_collect`) | **NOT APPLIED** | `md5(prosrc)` = `2012877397532a1e8e160b5a7a4c8032`, 15,800 chars = the PRE-fix body (patched target `12b3dcc6...`, 16,047 chars per the apply plan). Ledger names `dev_refresh_collect_restart_heal`, `_batch_cap` but nothing plan-stable. Also unmerged (branch only, per the apply plan: **UNVERIFIED here**). |
| **#1840** source-completion receipt / durable continuity | **NOT APPLIED** | `to_regclass` false for `dev_source_continuity`, `dev_refresh_generation`, `dev_source_continuity_state`; trigger `dev_reports_generation_receipt_trg` count **0**; functions `dev_source_receipts`, `dev_continuity_step`, `dev_reports_generation_receipt` absent from the `pg_proc` result. Code half (scope receipt in the deployed bundle): **UNVERIFIED**. |
| **#1829** recovery protection, rule_version 5 | **NOT APPLIED** | `dev_change_recovery` absent; `dev_change_recovery_rule_version`, `dev_change_scope_ready/health`, `dev_monitoring_coverage` absent; `dev_change_event` has **no `rule_version` column** (0) and still 19 columns. Live `dev_change_observe_zip` md5 `042ce946...` and `dev_change_tick` md5 `59ce03a9...` equal the recovery file's "written against" fingerprints. |
| view `dev_change_event_reportable` | **PRE-recovery** | live `pg_get_viewdef` md5 `46e9ec8b1c28601f52bc87010bedaf89` (= the file's precondition). **Caution on the requested "view contains is_baseline" check:** the string IS present (`position` > 0) but only in the SELECT LIST (`e.is_baseline`). The WHERE clause is exactly `WHERE (NOT r.baseline)`; there is **no `NOT e.is_baseline` filter**, which is the safeguard #1829 adds. A bare "contains is_baseline" test would read as protected and be wrong. |
| ledger C1/D1/D2 | applied | ledger rows `dev_change_ledger_c1_20260930`, `dev_change_baseline_d1_20260930`, `dev_change_reportable_d2_20260930`; cron `dev-change-observe` `*/5 2-8 * * *` active. |
| **containment** (#1826 `zip_scope_bounds`, `zip_scope_members`) | **APPLIED (functions); scope switch UNVERIFIED** | md5 `30a72ed5c0b03d4b73d3246510be56ae` and `815a0b83765ae3b1173099a550606bd9`; `has_function_privilege('anon', ...)` false for both; ledger `zip_scope_bounds`, `zip_scope_members`. `ZIP_SCOPE_BOUNDS_MODE` is a server secret, not readable by SQL: **UNVERIFIED**. |
| customer consumers of the view | live | cron `property-watch-run` `3,13,...,53 * * * *` active; `dev-reports-rolling-refresh` `*/2` active. |

**Consequence (unchanged from the apply plan, re-confirmed live):** production has no recovery protection. The consumer test (`test/recovery-notification-safety.test.mjs` on PR #1912) shows that with today's writer and view a record first reached "now" is emailed as "New official record". The only barrier is that the polygon scope is presumed OFF.

## 4. Order of work that follows from sections 1-3

1. Merge this branch (code is inert: no registry opt-in, no alias file, `IDENTITY_ALIAS_FILES` empty). 
2. Generate the Denton alias file on a runner, review, commit it with its `index.ts` import (CI enforces the pairing).
3. Apply the notification safeguards in the apply plan's order (#1848 -> #1840 -> #1829) and verify each.
4. Apply `docs/app-source-key-basis-objectid-alias.sql`; add the registry line; deploy `get-address-report`; refresh Denton ZIPs; next N5 generation carries the split (the pre-activation proof will list the 149 merged keys as explained moves).
5. Only then enable the polygon scope for a Denton canary ZIP (server secret). Expected effect: +5,298 old (2021-2023 or earlier) records on 12 ZIPs, **0 current**; with #1829 live they are baseline/quiet, never emailed.
6. Separately, build and prove the geometry-aware membership function for lines/polygons (section 2.3) before expecting the 32 TxDOT projects to appear.

## 5. Production approvals needed (each separate; nothing below was done)

| # | approval | type | notes |
|---|---|---|---|
| A1 | Merge of this branch's PR | git | inert by itself (verified: legacy keys identical on 44 source_ids over 14 fixtures; 357 unit files pass) |
| A2 | Apply `docs/app-source-key-basis-objectid-alias.sql` | production SQL (function replacement, reversible exactly) | drift guard md5 `d1c77344...` read today; after A3 or before is safe, but before the registry line |
| A3 | Run the alias-file generation on a runner and commit the reviewed file + `index.ts` import | read-only scan + PR | decide per the 149-group table; list stored references to the affected keys first (R1) |
| A4 | Add `identity_aliases_file` to the `denton-county-dev-permits` registry entry and deploy `get-address-report` via `deploy-edge-functions.yml` | registry + edge deploy | requires A2, A3 |
| A5 | Re-fetch Denton `development_reports`/`app_projects` (refresh) and the next N5 generation | data refresh | requires A4; the daily build already runs |
| A6 | Merge #1848's branch to main, then apply it | merge + production SQL | per the apply plan steps 1 |
| A7 | Apply #1840 `docs/dev-source-receipt.sql`; redeploy `get-address-report` if the deployed bundle lacks `scope-receipt.ts` (read the bundle first) | production SQL + edge deploy | hot-path trigger on `development_reports` |
| A8 | Apply #1829 `docs/dev-change-recovery.sql` | production SQL (splices ledger writer/tick, replaces the reportable view) | needs the `dev-change-observe` window (02:00-08:59 UTC) for a verification tick |
| A9 | Confirm/set `ZIP_SCOPE_BOUNDS_MODE` (server secret) and enable polygon scope for a Denton canary ZIP, later wider | secret change | only after A5-A8 verified |
| A10 | (Optional) pause/resume cron `property-watch-run` around A9 | production write | not required if the sequence is honored |
| A11 | Any recovery backfill/refresh pass with scope on | data refresh | distinct from enabling |
| A12 | Build, prove (disposable PostGIS) and apply a geometry-aware membership function for lines/polygons; then re-measure the 32 TxDOT ids | new production SQL object | closes the section 2.3 gap |

## 6. Not verified

Per-id geometry of the 32 TxDOT ids; the live Denton layer (no egress: the alias file, the 149-group classification and duplicates-vs-distinct counts could not be produced here); `ZIP_SCOPE_BOUNDS_MODE`; the deployed `get-address-report` bundle contents; the #1848/#1840/#1829 PG suites (not rerun); homesignal-ingest consumers of `source_key` / `project_ref` with a `#`; behaviour of the parked SQL on a real PostgreSQL (checked by string surgery against the live body and its md5, not executed).

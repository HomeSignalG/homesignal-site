# Denton 32-ZIP acceptance matrix, 2026-10-14 (read-only)

Prepared for the 2026-10-14 20:45Z (3:45 PM CT) GO/NO-GO. Branch `claude/denton-acceptance-matrix`, **not merged**. Machine-readable twin: `data/denton-acceptance-matrix-2026-10-14.json`.
No production writes, merges, deploys, cron or notification changes were made. **UNKNOWN is not PASS.** A PASS exists only where every required check reports `complete`.

## GO / NO-GO summary (for the 3:45 PM CT / 20:45Z review)

**Verdict: NO-GO for full Denton data currency. Step 6 (all 32 ZIPs current and accepted) is BLOCKED and UNPROVEN.**
Founder decision recorded: **Option 3, natural refresh cadence (about 50 h).** No timestamp changes, no manual `dev_refresh_fire_targets`. No `docs/denton-acceptance-evidence.json` was created and no attestation was fabricated; `source_coverage`, `classification` and `evidence` stay UNKNOWN.

| item | state |
|---|---|
| Overall verdicts, 32 ZIPs | **PASS 5 / UNKNOWN 14 / FAIL 13** |
| Geographic ZIPs (27) that PASS | **0** |
| PASS (PO Box path only) | 75027, 75029, 76202, 76204, 76206 |
| FAIL (13) | 75033, 75036, 75068, 76205, 76207, 76226, 76227, 76247, 76249, 76258, 76259, 76262, 76266 |
| UNKNOWN (14) | 75007, 75010, 75022, 75028, 75056, 75057, 75065, 75067, 75077, 76201, 76203, 76208, 76209, 76210 |
| Denton ZIPs that ingested City of Denton records | **0 of 32** (measured about 19:14Z; the coordinator re-checked at 19:14-19:27Z with the same result) |
| `source_coverage` / `classification` / `evidence` | UNKNOWN on all 27 geographic ZIPs (never run / no attested reference) |
| Step 1 (publish and verify live pages) | delivered (below) |
| Step 2 (safeguards) | applied and verified (below) |
| Step 6 (current data on all 32 ZIPs) | **BLOCKED until each ZIP refreshes; UNPROVEN** |

Why NO-GO, in one paragraph: the pages are live, correct in behaviour and guarded, but the seven City of Denton sources registered at 18:04Z have delivered nothing, because the ZIPs have not reached the front of a 53-hour oldest-first refresh sweep. Even where records are stored (Frisco, Fort Worth), the audit finds eligible publisher records missing from serving, and the county layer is frozen at 2023-06-09. Nothing here proves the remaining ZIPs have current coverage.

### What was delivered (record, with run ids and SHAs as supplied by the founder/coordinator; items marked [measured] were measured by this session)

1. **Step 1 delivered.**
   - #1878 merged `70e50d1b`.
   - Rule D plane refreshed: ingest PR #665 merge `0804406`, run `38614877723`, `generated_at` 2026-10-14T18:24:36Z. The Boston re-key guard held (a separate, unresolved item, see Known open items).
   - Pages deploy run `38617956566` at `eb33b7db`.
   - Live pages audit run `38619142539` (32 ZIPs, desktop and mobile): markers equal point sites; the 5 PO Box ZIPs draw 0 markers and show the "not measured" notice. The marker-click link probe was **inconclusive**; notice sections were **not measured**. [measured: HTTP 200, 0 errors, 0 sites missing `record_url`.]
2. **Step 2 safeguards applied and verified.**
   - `source_key_basis` splice.
   - #1848 collector `12b3dcc6…`.
   - #1840.
   - #1829 with the view filter `WHERE NOT e.is_baseline`.
   - Identity code #1922 `dc939b57`; alias file #1924 `44e04245` (148 reused ids, 194 aliases).
   - City of Denton sources #1921 `21e5ce1a`.
   - `get-address-report` v271 deployed 18:04Z.
3. **PR #1926 baseline guard** (merge `eb33b7db`): migration `dev_change_source_baseline_denton_20261014`; `observe_zip` md5 `2f70e4c7` to `161d7fd2`; window until 2026-10-20 00:00Z; 7-id allowlist fingerprint `40ee6c76…`; with a verification schedule. [measured: `dev_change_source_baseline` holds exactly 7 rows, all `denton-city-projects-*`, `baseline_until` 2026-10-20 00:00Z, `closed_at` null; 0 `dev_change_project` identities for them.]
4. **Refresh status [measured].** 0 of 32 ZIPs hold city records (cached `sites` and `app_projects`). Queue positions and projected times are in the Task A table: first Denton ZIP (76247) is next, 76258 about 20:55Z, the last (75028) about 2026-10-16 22:30Z (about 50 h). **A queue jump is not available:** cron job 14 does not read `dev_refresh_targets` (1,437 stale target rows, none of them Denton), and timestamps must not be falsified. By the 20:45Z review at most 1-2 ZIPs will have refreshed.
5. **76203 is a legitimate measured zero**, one of a class of 3,825 `boundary_complete` ZIPs with empty membership (n5-national-2026-10-14). The Option B copy ("No development records fall inside the Census boundary for ZIP [ZIP]. Enter a street address to see development around that address.") is in **PR #1928 (head `07e6aee7`): OPEN, NOT merged, not draft, mergeable state "unstable" as of this check; awaiting founder approval.** Until it merges, 76203 shows the existing wording. 76203 remains UNKNOWN here, not PASS, because source_coverage/classification/evidence are unrecorded.

### Known FAIL / UNKNOWN (details per ZIP and category below)

- **13 FAIL ZIPs**, all on `eligibility_reconciliation` (eligible publisher records inside the ZIP polygon absent from serving), mostly the frozen `denton-county-dev-permits`.
- **Fort Worth:** 76247, 962 of 972 eligible records missing from serving, plus 1,091 eligible rows without a publisher point (not testable); 76262, 75 of 94 missing.
- **Frisco:** 75033, 90 of 239 eligible missing; 75036, 40 of 47 missing.
- **75033:** 5 dots whose Frisco id the publisher does not return (re-queried singly). **76207:** 1 polyline dot off the publisher's geometry (stale geometry).
- **TxDOT (reported by the coordinator, not re-measured here):** 32 never-ingested records, plus a line/polygon scope gap. This audit does show TxDOT eligible-missing counts of 1-13 on 13 ZIPs.
- **Notification exposure (coordinator analysis):** no `property_watch` rows exist today, so no resident can currently be notified from this data.
- **Boston held pages:** unresolved, separate from Denton.
- **No local authority source is current** for the 23 other geographic ZIPs; the City of Denton ZIPs await the first refresh.

### Remaining actions and approvals

1. Let the Denton ZIPs refresh naturally (about 50 h). Do not edit timestamps or fire targets by hand.
2. After they refresh: re-run the **data audit** (`denton-launch-audit.py` task `data`) from a ref whose registry has `denton-city-projects-*` (main), and the **production pages test**. The candidate has changed since the 16:58Z audit.
3. Run the baseline-guard verification checks on the schedule in #1926 (window closes 2026-10-20 00:00Z); confirm first city observations land as baseline and none is reportable.
4. Verify permit-identity activation after refresh: it is live through the alias file (#1924), so check the `#`-suffixed alias keys appear and behave once county ZIPs refresh (0 stored today).
5. Founder approvals still open: merge of #1928 (76203 copy); scope-enablement sequence and A9-A12; the geometry cache refresh policy (`docs/denton-geometry-cache-refresh-policy-2026-10-14.md`, design only); the rights ruling (`report-rights-r7`) that the city-source PR needed.
6. Write per-ZIP attestations to `docs/denton-acceptance-evidence.json` **only after** real source-coverage and classification review exists. Not done and not to be faked.


---

The sections below are the measured detail behind the summary above.

## Headline

- **Overall verdicts (32 ZIPs): PASS 5 / UNKNOWN 14 / FAIL 13.** The 5 PASS are the PO Box ZIPs (75027, 75029, 76202, 76204, 76206) on their separate non-geographic path. **0 of 27 geographic ZIPs pass.**
- **Why no geographic ZIP can pass today:** `source_coverage` and `classification` were never run for any ZIP (no `docs/denton-acceptance-evidence.json` exists on any branch) and `evidence` has no recorded reference, so those three categories are UNKNOWN for all 27. That is a missing-evidence gap, not a measured defect.
- **Measured defects (FAIL) on 13 geographic ZIPs:** eligible source records inside the ZIP polygon but absent from serving (`eligibility_reconciliation`), plus 1 publisher-not-found ZIP (75033) and 1 off-geometry polyline dot (76207). Most of the missing counts are `denton-county-dev-permits` records, a source frozen at 2023-06-09.
- **Rolling refresh (Task A):** **0 of 32 Denton ZIPs have refreshed since v271 (18:04Z); 0 contain any `denton-city-projects-*` site; `app_projects` holds 0 rows for them.** The national sweep runs 240 ZIPs/hour; founder Option 3 accepts the natural cadence (about 50 h, last Denton ZIP about 2026-10-16 22:30Z). By 20:45Z at most 1-2 will have refreshed.
- **Candidate changed:** the data audit (16:19-16:58Z) predates v271 and its registry did not include the seven city sources. See "Re-runs needed".

## Category counts (27 geographic ZIPs; PO Box ZIPs separate)

| category | PASS | UNKNOWN | FAIL |
|---|---:|---:|---:|
| polygon_membership | 27 | 0 | 0 |
| unique_identity | 24 | 3 | 0 |
| publisher_geometry | 26 | 0 | 1 |
| eligibility_reconciliation | 14 | 0 | 13 |
| source_coverage | 0 | 27 | 0 |
| classification | 0 | 27 | 0 |
| browser_behavior | 27 | 0 | 0 |
| evidence | 0 | 27 | 0 |
| nonpoint_geometry | 26 | 0 | 1 |
| non-geographic path (5 PO Box ZIPs) | 5 | 0 | 0 |

Category derivation follows `scripts/denton_verdict.py` exactly: FAIL = a measured counter above zero; UNKNOWN = counter or check not established; PASS = measured zero and check `complete`. `browser_behavior` is PASS from the production page run 38619142539 (HTTP 200, 0 errors, desktop and mobile markers equal, drawn markers equal the point records).

## ZIP lists

**Verdict PASS (PO Box path):** 75027, 75029, 76202, 76204, 76206

**Verdict UNKNOWN (14, no measured defect, evidence missing):** 75007, 75010, 75022, 75028, 75056, 75057, 75065, 75067, 75077, 76201, 76203, 76208, 76209, 76210

**Verdict FAIL (13):** 75033, 75036, 75068, 76205, 76207, 76226, 76227, 76247, 76249, 76258, 76259, 76262, 76266

**ZIPs with current authoritative records stored (4). Existence is proven; completeness is NOT, and all four are partial-area or FAIL on eligibility reconciliation:**
- 75033: frisco-active-building-permits (Frisco = 97.5% of ZIP area; legitimate authority share; newest 2026-10-07 membership-based; 124 rows in last 365d). Existence only: audit finds 90 of 239 eligible Frisco records missing from serving
- 75036: frisco-active-building-permits (Frisco = 44.0% of ZIP area; newest 2026-09-15; 7 rows in last 365d, membership-based) -- PARTIAL. Audit: 40 of 47 eligible Frisco records missing from serving
- 76247: fort-worth-development-permits (Fort Worth city 6.1% + ETJ 11.7% of ZIP area; newest 2026-07-13) -- PARTIAL. Audit: 962 of 972 eligible Fort Worth records with a publisher point missing from serving, and 1,091 eligible rows have no publisher point (not testable)
- 76262: fort-worth-development-permits (Fort Worth city 11.1%; newest 2026-08-17; 19 rows in last 365d) -- PARTIAL. Audit: 75 of 94 eligible Fort Worth records missing from serving; 1,091 rows without a publisher point not testable

Basis: a local permitting authority's source with a stored record in the last 365 days, where that authority covers at least 5% of the ZIP area (Step 6 matrix). Frisco rows seen in 75056 and 75068 are 3-mile-disc spill from an authority covering under 5% of those ZIPs and are not counted as coverage. TxDOT road projects are state work, not a local land-development authority, and are ignored for coverage.

**Geographic ZIPs lacking any authoritative current source (23):** 75007, 75010, 75022, 75028, 75056, 75057, 75065, 75067, 75068, 75077, 76201, 76203, 76205, 76207, 76208, 76209, 76210, 76226, 76227, 76249, 76258, 76259, 76266

Of those, the ZIPs where the City of Denton (city plus ETJ) holds at least 5% of the area now have the seven new `denton-city-projects-*` sources registered but **nothing stored**: 76201, 76203, 76205, 76207, 76208, 76209, 76210, 76226, 76227, 76249, 76259, 76266. Their coverage is therefore not yet proven.

## Acceptance matrix (all 32 ZIPs)

Jurisdictions are by area share from the Step 6 matrix (generated before v271). Connected sources and dates are the Step 6 membership-based figures; `app_projects` figures (source-stated ZIP, a different set) are in the JSON and in the Task A table. "Stage coverage" is from source semantics, not measured per ZIP: Frisco rows are all `ISSUED` (approved/under construction), Fort Worth rows are permit filings, the county layer is frozen, the city layers cover plats/zoning/SUP/PD/site plans/annexations (proposed and approved).

| ZIP | Permitting jurisdictions (area share) | Connected current sources (stored/365d/newest) | Newest local-permit record | Stage coverage | Gaps | Verdict | Production page |
|---|---|---|---|---|---|---|---|
| 75007 | Carrollton 98.9%; Dallas 1.1%; Hebron 0.1% ... | txdot 10/1/2026-06-24 (state road work, ignored); dallas 1/0/2009-03-27 (disc spill, <5% of area) | 2009-03-27 | none from a local authority | 100.1% of area has no current source: Carrollton 99% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 25 markers |
| 75010 | Carrollton 95.1%; Hebron 2.7%; Lewisville 2.3% ... | denton-county 1/0/2018-01-09 (disc spill, <5% of area); txdot 1/0/2022-12-15 (state road work, ignored) | 2018-01-09 | none from a local authority | 100.1% of area has no current source: Carrollton 95% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 5 markers |
| 75022 | Flower Mound 91.8%; Grapevine 2.7%; Outside Denton County, not in a mapped city/ETJ 2.1% ... | denton-county 2/0/2021-06-30 (disc spill, <5% of area); txdot 2/0/2025-02-27 (state road work, ignored) | 2021-06-30 | none from a local authority | 100.0% of area has no current source: Flower Mound 92% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 9 markers |
| 75027 | PO Box ZIP, no geographic area (out of Step 6 scope) | n/a | n/a | n/a | not a mapped area; page states so | PASS (PO Box path) | 200, 0 errors, 0 markers, notice shown |
| 75028 | Flower Mound 99.6%; Double Oak 0.5%; Lewisville 0.1% ... | txdot 4/0/2025-03-27 (state road work, ignored) | none | none from a local authority | 100.1% of area has no current source: Flower Mound 100% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 16 markers |
| 75029 | PO Box ZIP, no geographic area (out of Step 6 scope) | n/a | n/a | n/a | not a mapped area; page states so | PASS (PO Box path) | 200, 0 errors, 0 markers, notice shown |
| 75033 | Frisco 97.5%; Little Elm 1.9%; Unincorporated Denton County 0% | frisco 154/124/2026-10-07; txdot 20/2/2025-11-13 (state road work, ignored) | 2026-10-07 | permit issuances/filings only (Frisco: approved/under construction; Fort Worth: filed permits); proposed plats/zoning not covered | 1.9% of area has no current source (none >=5%) | FAIL | 200, 0 err, 135 markers |
| 75036 | Frisco 44.0%; Unincorporated Denton County 18.8%; The Colony 15.0% ... | denton-county 1828/0/2023-05-04; frisco 7/7/2026-09-15; txdot 4/0/2024-03-28 (state road work, ignored) | 2026-09-15 | permit issuances/filings only (Frisco: approved/under construction; Fort Worth: filed permits); proposed plats/zoning not covered (partial area) | 55.9% of area has no current source: Unincorporated Denton County 19% (STALE), The Colony 15% (NO_SOURCE_REGISTERED), Hackberry ETJ 9% (NO_SOURCE_REGISTERED), Little Elm 7% (NO_SOURCE_REGISTERED) | FAIL | 200, 0 err, 1823 markers |
| 75056 | The Colony 45.5%; Lewisville 36.7%; Unincorporated Denton County 13.3% ... | denton-county 1594/0/2021-11-02; txdot 5/1/2026-05-21 (state road work, ignored) | 2021-11-02 | none from a local authority | 100.0% of area has no current source: The Colony 45% (NO_SOURCE_REGISTERED), Lewisville 37% (NO_SOURCE_REGISTERED), Unincorporated Denton County 13% (STALE) | UNKNOWN | 200, 0 err, 1625 markers |
| 75057 | Lewisville 98.6%; Carrollton 1.5%; Unincorporated Denton County 0% | txdot 6/1/2026-05-21 (state road work, ignored) | none | none from a local authority | 100.1% of area has no current source: Lewisville 99% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 46 markers |
| 75065 | Unincorporated Denton County 30.0%; Hickory Creek 28.1%; Lewisville 19.7% ... | denton-county 182/0/2021-05-28; txdot 7/0/2024-01-17 (state road work, ignored) | 2021-05-28 | none from a local authority | 100.0% of area has no current source: Unincorporated Denton County 30% (STALE), Hickory Creek 28% (NO_SOURCE_REGISTERED), Lewisville 20% (NO_SOURCE_REGISTERED), Lake Dallas 16% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 204 markers |
| 75067 | Lewisville 93.8%; Carrollton 2.0%; Coppell 1.5% ... | txdot 19/2/2026-05-21 (state road work, ignored) | none | none from a local authority | 100.1% of area has no current source: Lewisville 94% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 88 markers |
| 75068 | Little Elm 48.3%; Oak Point 16.2%; Oak Point ETJ 11.0% ... | denton-county 4213/0/2023-05-19; frisco 10/9/2026-09-21 (disc spill, <5% of area); txdot 10/1/2025-11-13 (state road work, ignored) | 2026-09-21 | none from a local authority | 98.2% of area has no current source: Little Elm 48% (NO_SOURCE_REGISTERED), Oak Point 16% (NO_SOURCE_REGISTERED), Oak Point ETJ 11% (NO_SOURCE_REGISTERED), Little Elm ETJ 10% (NO_SOURCE_REGISTERED) | FAIL | 200, 0 err, 4246 markers |
| 75077 | Highland Village 38.6%; Lewisville 29.0%; Copper Canyon 15.6% ... | txdot 11/0/2025-03-27 (state road work, ignored); denton-county 3/0/2020-09-09 (disc spill, <5% of area) | 2020-09-09 | none from a local authority | 100.1% of area has no current source: Highland Village 39% (NO_SOURCE_REGISTERED), Lewisville 29% (NO_SOURCE_REGISTERED), Copper Canyon 16% (NO_SOURCE_REGISTERED), Double Oak 14% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 36 markers |
| 76201 | Denton 100%; Unincorporated Denton County 0% | txdot 11/1/2025-11-13 (state road work, ignored) | none | city plat/zoning/SUP/PD/site-plan/annexation layers registered, 0 stored; building permits not covered | 100% of area has no current source: Denton 100% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 18 markers |
| 76202 | PO Box ZIP, no geographic area (out of Step 6 scope) | n/a | n/a | n/a | not a mapped area; page states so | PASS (PO Box path) | 200, 0 errors, 0 markers, notice shown |
| 76203 | Denton 100%; Unincorporated Denton County 0% | none stored | none | city plat/zoning/SUP/PD/site-plan/annexation layers registered, 0 stored; building permits not covered | 100% of area has no current source: Denton 100% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 0 markers |
| 76204 | PO Box ZIP, no geographic area (out of Step 6 scope) | n/a | n/a | n/a | not a mapped area; page states so | PASS (PO Box path) | 200, 0 errors, 0 markers, notice shown |
| 76205 | Denton 100.0%; Unincorporated Denton County 0% | txdot 19/0/2025-08-21 (state road work, ignored); denton-county 1/0/2015-09-30 (disc spill, <5% of area) | 2015-09-30 | city plat/zoning/SUP/PD/site-plan/annexation layers registered, 0 stored; building permits not covered | 100.0% of area has no current source: Denton 100% (NO_SOURCE_REGISTERED) | FAIL | 200, 0 err, 56 markers |
| 76206 | PO Box ZIP, no geographic area (out of Step 6 scope) | n/a | n/a | n/a | not a mapped area; page states so | PASS (PO Box path) | 200, 0 errors, 0 markers, notice shown |
| 76207 | Denton 82.6%; Denton ETJ 17.2%; Denton 'DIV 2' polygon in county ETJ layer (meaning of DIV 2 unverified) 0.1% ... | denton-county 285/0/2023-03-23; txdot 49/5/2025-11-13 (state road work, ignored) | 2023-03-23 | city plat/zoning/SUP/PD/site-plan/annexation layers registered, 0 stored; building permits not covered | 99.8% of area has no current source: Denton 83% (NO_SOURCE_REGISTERED), Denton ETJ 17% (NO_SOURCE_REGISTERED) | FAIL | 200, 0 err, 472 markers |
| 76208 | Denton 45.1%; Denton ETJ 21.7%; Denton 'DIV 2' polygon in county ETJ layer (meaning of DIV 2 unverified) 10.4% ... | denton-county 222/0/2023-05-17; txdot 9/1/2025-11-13 (state road work, ignored) | 2023-05-17 | city plat/zoning/SUP/PD/site-plan/annexation layers registered, 0 stored; building permits not covered | 99.8% of area has no current source: Denton 45% (NO_SOURCE_REGISTERED), Denton ETJ 22% (NO_SOURCE_REGISTERED), Denton 'DIV 2' polygon in county ETJ layer (meaning of DIV 2 unverified) 10% (UNKNOWN_AUTHORITY), Shady Shores 9% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 249 markers |
| 76209 | Denton 100%; Unincorporated Denton County 0% | txdot 6/1/2025-11-13 (state road work, ignored) | none | city plat/zoning/SUP/PD/site-plan/annexation layers registered, 0 stored; building permits not covered | 100% of area has no current source: Denton 100% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 18 markers |
| 76210 | Denton 47.0%; Corinth 38.9%; Denton ETJ 13.8% ... | denton-county 53/0/2023-04-05; txdot 22/0/2025-08-21 (state road work, ignored) | 2023-04-05 | city plat/zoning/SUP/PD/site-plan/annexation layers registered, 0 stored; building permits not covered | 100.0% of area has no current source: Denton 47% (NO_SOURCE_REGISTERED), Corinth 39% (NO_SOURCE_REGISTERED), Denton ETJ 14% (NO_SOURCE_REGISTERED) | UNKNOWN | 200, 0 err, 133 markers |
| 76226 | Argyle 22.9%; Denton ETJ 13.9%; Bartonville 12.7% ... | denton-county 2327/0/2023-05-15; txdot 36/1/2026-05-21 (state road work, ignored) | 2023-05-15 | city plat/zoning/SUP/PD/site-plan/annexation layers registered, 0 stored; building permits not covered | 100.2% of area has no current source: Argyle 23% (NO_SOURCE_REGISTERED), Denton ETJ 14% (NO_SOURCE_REGISTERED), Bartonville 13% (NO_SOURCE_REGISTERED), Denton 11% (NO_SOURCE_REGISTERED) | FAIL | 200, 0 err, 2466 markers |
| 76227 | Aubrey ETJ 27.3%; Denton ETJ 16.6%; Cross Roads 8.1% ... | denton-county 5682/0/2023-05-24; txdot 38/4/2026-01-29 (state road work, ignored) | 2023-05-24 | city plat/zoning/SUP/PD/site-plan/annexation layers registered, 0 stored; building permits not covered | 99.8% of area has no current source: Aubrey ETJ 27% (NO_SOURCE_REGISTERED), Denton ETJ 17% (NO_SOURCE_REGISTERED), Cross Roads 8% (NO_SOURCE_REGISTERED), Denton 8% (NO_SOURCE_REGISTERED) | FAIL | 200, 0 err, 5867 markers |
| 76247 | Ponder ETJ 13.6%; Justin ETJ 12.7%; Northlake 12.4% ... | denton-county 395/0/2023-06-06; txdot 19/1/2025-10-30 (state road work, ignored); fort-worth 10/10/2026-07-13 | 2026-07-13 | permit issuances/filings only (Frisco: approved/under construction; Fort Worth: filed permits); proposed plats/zoning not covered (partial area) | 82.0% of area has no current source: Ponder ETJ 14% (NO_SOURCE_REGISTERED), Justin ETJ 13% (NO_SOURCE_REGISTERED), Northlake 12% (NO_SOURCE_REGISTERED), Northlake ETJ 11% (NO_SOURCE_REGISTERED) | FAIL | 200, 0 err, 489 markers |
| 76249 | Unincorporated Denton County 42.3%; Denton 'DIV 2' polygon in county ETJ layer (meaning of DIV 2 unverified) 33.6%; Denton ETJ 8.7% ... | denton-county 284/0/2023-05-04; txdot 15/2/2025-10-30 (state road work, ignored) | 2023-05-04 | city plat/zoning/SUP/PD/site-plan/annexation layers registered, 0 stored; building permits not covered | 100.0% of area has no current source: Unincorporated Denton County 42% (STALE), Denton 'DIV 2' polygon in county ETJ layer (meaning of DIV 2 unverified) 34% (UNKNOWN_AUTHORITY), Denton ETJ 9% (NO_SOURCE_REGISTERED) | FAIL | 200, 0 err, 374 markers |
| 76258 | Pilot Point ETJ 40.8%; Unincorporated Denton County 19.0%; Outside Denton County, not in a mapped city/ETJ 16.2% ... | denton-county 288/0/2023-05-10; txdot 26/0/2025-02-27 (state road work, ignored) | 2023-05-10 | none from a local authority | 99.6% of area has no current source: Pilot Point ETJ 41% (NO_SOURCE_REGISTERED), Unincorporated Denton County 19% (STALE), Outside Denton County, not in a mapped city/ETJ 16% (UNKNOWN_AUTHORITY), Pilot Point 10% (NO_SOURCE_REGISTERED) | FAIL | 200, 0 err, 441 markers |
| 76259 | Denton 'DIV 2' polygon in county ETJ layer (meaning of DIV 2 unverified) 28.5%; Unincorporated Denton County 22.4%; Ponder ETJ 17.2% ... | denton-county 386/0/2023-05-31; txdot 12/2/2025-11-13 (state road work, ignored) | 2023-05-31 | city plat/zoning/SUP/PD/site-plan/annexation layers registered, 0 stored; building permits not covered | 100.0% of area has no current source: Denton 'DIV 2' polygon in county ETJ layer (meaning of DIV 2 unverified) 28% (UNKNOWN_AUTHORITY), Unincorporated Denton County 22% (STALE), Ponder ETJ 17% (NO_SOURCE_REGISTERED), Denton ETJ 14% (NO_SOURCE_REGISTERED) | FAIL | 200, 0 err, 468 markers |
| 76262 | Northlake 15.8%; Roanoke 14.6%; Westlake 13.4% ... | denton-county 42/0/2023-05-01; txdot 37/1/2026-05-21 (state road work, ignored); fort-worth 19/19/2026-08-17 | 2026-08-17 | permit issuances/filings only (Frisco: approved/under construction; Fort Worth: filed permits); proposed plats/zoning not covered (partial area) | 87.1% of area has no current source: Northlake 16% (NO_SOURCE_REGISTERED), Roanoke 15% (NO_SOURCE_REGISTERED), Westlake 13% (NO_SOURCE_REGISTERED), Flower Mound 10% (NO_SOURCE_REGISTERED) | FAIL | 200, 0 err, 199 markers |
| 76266 | Unincorporated Denton County 37.1%; Denton 'DIV 2' polygon in county ETJ layer (meaning of DIV 2 unverified) 23.6%; Sanger ETJ 15.2% ... | denton-county 474/0/2023-05-02; txdot 20/1/2025-10-30 (state road work, ignored) | 2023-05-02 | city plat/zoning/SUP/PD/site-plan/annexation layers registered, 0 stored; building permits not covered | 99.9% of area has no current source: Unincorporated Denton County 37% (STALE), Denton 'DIV 2' polygon in county ETJ layer (meaning of DIV 2 unverified) 24% (UNKNOWN_AUTHORITY), Sanger ETJ 15% (NO_SOURCE_REGISTERED), Sanger 9% (NO_SOURCE_REGISTERED) | FAIL | 200, 0 err, 590 markers |

## Audit verdict by category (geographic ZIPs)

P = PASS, U = UNKNOWN, F = FAIL.

| ZIP | polygon membership | unique identity | publisher geometry | eligibility reconciliation | source coverage | classification | browser behavior | evidence | nonpoint geometry | overall |
|---|---|---|---|---|---|---|---|---|---|---|
| 75007 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 75010 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 75022 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 75028 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 75033 | P | P | F | F | U | U | P | U | P | FAIL |
| 75036 | P | P | P | F | U | U | P | U | P | FAIL |
| 75056 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 75057 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 75065 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 75067 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 75068 | P | U | P | F | U | U | P | U | P | FAIL |
| 75077 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 76201 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 76203 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 76205 | P | P | P | F | U | U | P | U | P | FAIL |
| 76207 | P | P | P | F | U | U | P | U | F | FAIL |
| 76208 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 76209 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 76210 | P | P | P | P | U | U | P | U | P | UNKNOWN |
| 76226 | P | P | P | F | U | U | P | U | P | FAIL |
| 76227 | P | U | P | F | U | U | P | U | P | FAIL |
| 76247 | P | P | P | F | U | U | P | U | P | FAIL |
| 76249 | P | P | P | F | U | U | P | U | P | FAIL |
| 76258 | P | P | P | F | U | U | P | U | P | FAIL |
| 76259 | P | P | P | F | U | U | P | U | P | FAIL |
| 76262 | P | U | P | F | U | U | P | U | P | FAIL |
| 76266 | P | P | P | F | U | U | P | U | P | FAIL |

## Exact reason for every non-PASS (geographic ZIPs)

The three evidence-gap categories are identical on all 27 ZIPs and are stated once:
- **source_coverage UNKNOWN (27):** not_run: no attested source-coverage reference in docs/denton-acceptance-evidence.json (file does not exist on any branch)
- **classification UNKNOWN (27):** not_run: no attested classification reference (status/type mapping against publisher vocabularies not recorded per ZIP)
- **evidence UNKNOWN (27):** incomplete: record_url present on 100% of drawn sites (0 missing) but no evidence reference recorded

Remaining non-PASS categories, per ZIP:

| ZIP | category | verdict | exact reason |
|---|---|---|---|
| 75033 | publisher_geometry | FAIL | 5 dots whose source record the publisher does not return (re-queried singly, still absent) |
| 75033 | eligibility_reconciliation | FAIL | 96 eligible source records inside the ZIP polygon are missing from serving: frisco-active-building-permits 90 of 239; denton-county-dev-permits 1 of 1; txdot-projects-info-all 5 of 25 |
| 75036 | eligibility_reconciliation | FAIL | 49 eligible source records inside the ZIP polygon are missing from serving: frisco-active-building-permits 40 of 47; denton-county-dev-permits 8 of 1836; txdot-projects-info-all 1 of 5 |
| 75068 | unique_identity | UNKNOWN | 1 dots whose source id is shared by several official features; 0 eligible ids not unique at the publisher |
| 75068 | eligibility_reconciliation | FAIL | 1254 eligible source records inside the ZIP polygon are missing from serving: frisco-active-building-permits 4 of 14; denton-county-dev-permits 1246 of 5459; txdot-projects-info-all 4 of 14 |
| 76205 | eligibility_reconciliation | FAIL | 2 eligible source records inside the ZIP polygon are missing from serving: txdot-projects-info-all 2 of 21 |
| 76207 | eligibility_reconciliation | FAIL | 510 eligible source records inside the ZIP polygon are missing from serving: denton-county-dev-permits 508 of 793; txdot-projects-info-all 2 of 50 |
| 76207 | nonpoint_geometry | FAIL | 1 line/polygon dots not on the publisher's own geometry |
| 76226 | eligibility_reconciliation | FAIL | 170 eligible source records inside the ZIP polygon are missing from serving: denton-county-dev-permits 167 of 2494; txdot-projects-info-all 3 of 39 |
| 76227 | unique_identity | UNKNOWN | 1 dots whose source id is shared by several official features; 0 eligible ids not unique at the publisher |
| 76227 | eligibility_reconciliation | FAIL | 173 eligible source records inside the ZIP polygon are missing from serving: denton-county-dev-permits 169 of 5851; txdot-projects-info-all 4 of 39 |
| 76247 | eligibility_reconciliation | FAIL | 2402 eligible source records inside the ZIP polygon are missing from serving: fort-worth-development-permits 962 of 972; denton-county-dev-permits 1438 of 1833; txdot-projects-info-all 2 of 21; not testable: fort-worth-development-permits: 1091 eligible publisher rows carry no point (the engine geocodes them from the address); the 19342 rows with a publisher point were reconciled |
| 76249 | eligibility_reconciliation | FAIL | 221 eligible source records inside the ZIP polygon are missing from serving: denton-county-dev-permits 219 of 503; txdot-projects-info-all 2 of 17 |
| 76258 | eligibility_reconciliation | FAIL | 129 eligible source records inside the ZIP polygon are missing from serving: denton-county-dev-permits 124 of 412; txdot-projects-info-all 5 of 31 |
| 76259 | eligibility_reconciliation | FAIL | 593 eligible source records inside the ZIP polygon are missing from serving: denton-county-dev-permits 591 of 977; txdot-projects-info-all 2 of 14 |
| 76262 | unique_identity | UNKNOWN | 5 dots whose source id is shared by several official features; 5 eligible ids not unique at the publisher |
| 76262 | eligibility_reconciliation | FAIL | 85 eligible source records inside the ZIP polygon are missing from serving: fort-worth-development-permits 75 of 94; denton-county-dev-permits 9 of 51; txdot-projects-info-all 1 of 38; not testable: fort-worth-development-permits: 1091 eligible publisher rows carry no point (the engine geocodes them from the address); the 19342 rows with a publisher point were reconciled |
| 76266 | eligibility_reconciliation | FAIL | 831 eligible source records inside the ZIP polygon are missing from serving: denton-county-dev-permits 818 of 1292; txdot-projects-info-all 13 of 33 |

Note on `eligibility_reconciliation`: the audit asks, for every registered ArcGIS source, which records the publisher says are eligible inside the ZIP polygon (same predicate as serving) and which of them serving lacks. Large counts are dominated by `denton-county-dev-permits` (frozen 2023-06-09, `PermitType` whitelist) and by Fort Worth in 76247. Whether those old county permits SHOULD be served is a serving-window decision, not established here; the verdict stays FAIL until reconciled or the gap is explained by a rule.

## Production verification status

Run 38619142539 (production, main @ eb33b7db, 18:54-19:04Z, after v271): all 32 ZIP pages HTTP 200, 0 page errors, desktop and mobile markers equal, 0 sites missing `record_url`. The 5 PO Box pages draw 0 markers and show the "no mapped area" notice (the earlier run 38597050743 at 16:27Z drew 8 markers on each; that is fixed on main). This verifies page behaviour; it does not verify source currency, which is why `browser_behavior` PASS does not lift any ZIP.

## Task A: rolling refresh after v271

Measured read-only at about 19:14Z (control: `development_reports` = 12,722 rows; cron job 14 active, last four runs succeeded at 19:08-19:14Z).

| measure | value |
|---|---|
| Denton ZIPs refreshed since 18:04Z | **0 of 32** |
| Denton ZIPs whose cached `sites` contain any `denton-city-projects-*` | **0 of 32** |
| `app_projects` rows, source_key `arcgis:denton-city-projects-%`, on the 32 ZIPs | **0** (control: 26,558 `denton-county-dev-permits` rows on the same ZIPs; 28,517 rows of all kinds) |
| `#`-suffixed alias keys (denton-county-dev-permits identity aliases) stored | **0** (control: the 26,558 county rows) |
| National refreshed since 18:04Z / attempted | 340 / 288 |
| National rate, last hour | 294 refreshed, 240 attempted (cron `*/2`, `dev_refresh_tick(8,20)` = 8 per tick) |
| Order | oldest first by `greatest(refreshed_at, last_refresh_attempt_at)`; 12,722 ZIPs, ~53 h per sweep |
| Denton ZIPs in `dev_refresh_targets` (priority list, 1,463 rows) | 0 |

Projection (holds only if order and rate hold): 76247 is next. 76258 at about 20:55Z, 76210 about 21:50Z, 75022/75010/75067 about 22:05Z, 76262 about 22:30Z, a third of the ZIPs by 02:00Z 10-15, the last (75028, position 12,311) about 2026-10-16 22:30Z. **By the 20:45Z decision: 76247 only, possibly 76258.** Moving any Denton ZIP to the front would be a write (priority targets or a manual fire) and was not done.

| ZIP | refreshed_at (UTC) | ZIPs ahead in queue | hours until attempted | cached sites | county sites | city-projects sites | `app_projects` county rows (2025-2026) | newest county record |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 76247 | 2026-10-12T03:16 | 0 | 0.0 | 507 | 319 | 0 | 319 (0) | 2023-06-06 |
| 76258 | 2026-10-12T05:12 | 405 | 1.7 | 413 | 252 | 0 | 252 (0) | 2023-05-10 |
| 76210 | 2026-10-12T06:26 | 629 | 2.6 | 1085 | 922 | 0 | 922 (0) | 2023-04-24 |
| 75022 | 2026-10-12T06:40 | 685 | 2.9 | 142 | 3 | 0 | 3 (0) | 2022-02-08 |
| 75010 | 2026-10-12T06:50 | 725 | 3.0 | 1757 | 1593 | 0 | 1593 (0) | 2021-10-29 |
| 75067 | 2026-10-12T06:50 | 725 | 3.0 | 191 | 0 | 0 | 0 (0) | none |
| 76262 | 2026-10-12T07:08 | 798 | 3.3 | 242 | 42 | 0 | 42 (0) | 2023-05-01 |
| 75057 | 2026-10-12T07:34 | 902 | 3.8 | 190 | 0 | 0 | 0 (0) | none |
| 75068 | 2026-10-12T07:52 | 973 | 4.1 | 7252 | 7098 | 0 | 7098 (0) | 2023-05-19 |
| 76204 | 2026-10-12T08:30 | 1069 | 4.5 | 249 | 28 | 0 | 28 (0) | 2022-07-12 |
| 75027 | 2026-10-12T08:34 | 1085 | 4.5 | 249 | 28 | 0 | 28 (0) | 2022-07-12 |
| 76227 | 2026-10-12T09:20 | 1270 | 5.3 | 559 | 396 | 0 | 396 (0) | 2023-05-08 |
| 75077 | 2026-10-12T10:18 | 1429 | 6.0 | 1407 | 1246 | 0 | 1246 (0) | 2023-04-24 |
| 75056 | 2026-10-12T13:44 | 2085 | 8.7 | 1266 | 1045 | 0 | 1045 (0) | 2023-01-27 |
| 75065 | 2026-10-09T23:58 | 2117 | 8.8 | 432 | 278 | 0 | 278 (0) | 2023-05-12 |
| 76203 | 2026-10-12T17:22 | 2733 | 11.4 | 316 | 84 | 0 | 84 (0) | 2022-07-19 |
| 75036 | 2026-10-12T19:06 | 3077 | 12.8 | 357 | 0 | 0 | 0 (0) | none |
| 76207 | 2026-10-12T19:58 | 3222 | 13.4 | 279 | 59 | 0 | 59 (0) | 2022-12-20 |
| 75033 | 2026-10-12T22:24 | 3654 | 15.2 | 7347 | 7133 | 0 | 7133 (0) | 2023-05-24 |
| 76202 | 2026-10-13T02:24 | 4422 | 18.4 | 513 | 310 | 0 | 310 (0) | 2023-04-28 |
| 75007 | 2026-10-13T20:24 | 8157 | 34.0 | 852 | 678 | 0 | 678 (0) | 2021-10-29 |
| 76201 | 2026-10-13T21:48 | 8493 | 35.4 | 533 | 305 | 0 | 305 (0) | 2023-04-28 |
| 76205 | 2026-10-14T00:40 | 9037 | 37.7 | 263 | 41 | 0 | 41 (0) | 2023-01-24 |
| 76209 | 2026-10-14T10:02 | 10861 | 45.3 | 600 | 400 | 0 | 400 (0) | 2023-04-28 |
| 76206 | 2026-10-14T11:04 | 11045 | 46.0 | 427 | 208 | 0 | 208 (0) | 2023-05-09 |
| 76226 | 2026-10-14T12:12 | 11253 | 46.9 | 2432 | 2273 | 0 | 2273 (0) | 2023-05-15 |
| 76259 | 2026-10-14T15:20 | 11781 | 49.1 | 604 | 456 | 0 | 456 (0) | 2023-05-31 |
| 75029 | 2026-10-14T15:24 | 11797 | 49.2 | 194 | 0 | 0 | 0 (0) | none |
| 76249 | 2026-10-14T16:26 | 11973 | 49.9 | 507 | 356 | 0 | 356 (0) | 2023-05-04 |
| 76266 | 2026-10-14T16:36 | 12013 | 50.1 | 553 | 394 | 0 | 394 (0) | 2023-05-02 |
| 76208 | 2026-10-14T17:10 | 12149 | 50.6 | 376 | 202 | 0 | 202 (0) | 2023-05-17 |
| 75028 | 2026-10-14T17:50 | 12311 | 51.3 | 562 | 409 | 0 | 409 (0) | 2022-06-24 |

City-project statistics requested (newest record dates, 2025-2026 counts, status/type distribution, '#' alias keys): **all empty or zero because nothing is stored.** They cannot be produced until a Denton ZIP refreshes. Other stored sources on these ZIPs (source-stated ZIP): Frisco 75033 29 rows (28 in 2025-26, newest 2026-09-21), 75036 198 (188; 2026-10-06), 75056 64 (58; 2026-09-15); TxDOT on every ZIP; county permits all dated 2018-2023 with 0 rows in 2025-2026.

### Change guard state (`dev_change_source_baseline`)

- Allowlist: **7 rows**, one per `denton-city-projects-*` source, `baseline_until` 2026-10-20 00:00Z, `closed_at` null, created 2026-10-14. Total table rows 7, so nothing else is allowlisted.
- `dev_change_project` identities for the seven sources: **0** (control: 20,298 for `denton-county-dev-permits`, 962,918 in total). With no identity rows and no stored `app_projects` rows, no `dev_change_event` for them can exist yet; `dev_change_event` was not scanned directly to avoid a heavy query. Material or reportable events: none expected; first observations after a refresh should land as baseline until 2026-10-20.

### Spot validation against the publisher

No city records are stored and the sandbox has no egress to maps.cityofdenton.com (CONNECT 403), so records FETCHED by v271 could not be validated against the live publisher. Validation was done on the 12 real features captured read-only on 2026-10-14 by run 38595451531 (fixtures/denton/city-planning-projects-sample.json): attributes verbatim, vertex-mean of the ring located in the canonical ZCTA boundary (geo.zcta_boundary, SRID 4269) of the 27 geographic Denton ZIPs.

| project | layer | type | status | status date | address | ZIP of ring centroid |
|---|---|---|---|---|---|---|
| FP26-0016 | layer 15 | FINAL PLAT | WITHDRAWN | status_date 2026-10-12 | 3819 W UNIVERSITY DR | 76207 |
| ZCP26-0019 | layer 15 | ZONING COMPLIANCE PLAN | APPROVED | 2026-10-08 | 1201 RANDALL ST | 76207 |
| ZCP26-0022 | layer 15 | ZONING COMPLIANCE PLAN | DENIED | 2026-10-08 | 115 N LOOP 288 | 76209 |
| FP26-0019 | layer 15 | FINAL PLAT | FILED | 2026-10-05 | MILLS RD | 76208 |
| FP26-0014 | layer 15 (OBJECTID 126 and 132 duplicate) | FINAL PLAT | APPROVED | 2026-09-28 | 2403 HINKLE DR | 76201 |
| MP26-0017 | layer 9 | MINOR PLAT | EXTENSION 30 | 2026-10-08 | 1302 W OAK ST | 76201 |
| Z26-0007 | layer 12 | ZONING | UNDER REVIEW | 2026-08-13 | 5120 E UNIVERSITY DR | 76208 |
| S26-0005 | layer 8 | SPECIFICUSE | UNDER REVIEW | 2026-10-08 | 805 E OAK ST | 76209 |
| PDA26-0004 | layer 5 | PD AMENDMENT | UNDER REVIEW | 2026-04-15 | 3848 TEASLEY LN | 76210 |
| ZCP26-0023 | layer 13 | ZONING COMPLIANCE PLAN | RESUBMIT | 2026-10-12 | 5702 FM 2181 LN | 76210 |
| A26-0001 | layer 0 | ANNEXATIONS | UNDER REVIEW | 2026-04-09 | 4911 MILLS RD | 76208 |

11 distinct projects: each ring centroid falls inside exactly one Denton ZIP boundary (76201, 76207, 76208, 76209, 76210), i.e. the layers' geometry supports ZIP assignment. The connector's 3-mile centroid disc will also attach them to neighbouring ZIPs; that spill is the registry's normal scoping and is not measured here.

Not validated: record_url is dataset-precision (the city's Active Projects map), not per record; record id/status/dates of records the DEPLOYED engine fetched (none stored); duplicate OBJECTIDs 126/132 handling by the deployed engine (offline test only).

## Re-runs needed

- **Data audit (`denton-launch-audit.py`, task `data`): re-run, but only after the Denton ZIPs have refreshed.** The candidate changed (v271 and the seven registry sources, plus the identity aliases). The 16:58Z audit used a registry without the city sources and a serving state with 0 city rows, so it cannot say anything about them. Run it from a ref whose `jurisdiction-registry.json` contains `denton-city-projects-*` (main). Re-running now, with 0 city rows stored, would repeat the same result.
- **Production pages test:** no re-run needed for the current data; re-run after the refresh so the new records are exercised in the browser.
- **`source_coverage`, `classification`, `evidence`:** these are not audits to re-run; they need per-ZIP attested references (run id or doc anchor) in `docs/denton-acceptance-evidence.json`. Until written, they stay UNKNOWN.

## Known limitations

- Step 6 jurisdiction matrix was generated before v271, uses geography (city limits, ETJ) from Denton County GIS and Census TIGERweb, and its permit-authority text is a statutory generalization, not verified per city. 27 geographic ZIPs only; ETJ outside Denton County is unknown.
- Step 6 stored-record counts are serving-membership based; `app_projects` counts here are by source-stated ZIP. They differ (for example Frisco rows appear on 75056 and 75068 by source-stated ZIP but not by membership). Neither is a jurisdiction-level attribution.
- Stage coverage (proposed / approved / under construction) is derived from source semantics, not measured per ZIP.
- Cannot be validated from the sandbox: the live City of Denton service (no egress), the new sources as fetched by the deployed engine, and USPS ZIP status.
- `test/report-rights-r7.test.mjs` was failing on the new registry ids on the source branch (rights ruling needed before that PR merges); not re-checked here.
- The 5 PO Box ZIPs were judged on the non-geographic path only; the PO Box set comes from `docs/maps-coverage/fix4/no-boundary-zip-classification.csv`. 76203 is geographic with 0 records and no 'no mapped area' notice, as expected.
- Audit counts for `denton-county-dev-permits` include records from 2008-2023; the 'missing from serving' FAILs there reflect a frozen source and an unexplained serving window, not new data loss.

## Inputs and reproduction

- **data_audit:** Actions run 38597050743 (branch claude/wsc-geometry @ 6373010e, job 'data', 2026-10-14 16:19-16:58Z); audit JSON read from the job log between BEGIN/END DENTON AUDIT JSON
- **live_pages:** Actions run 38619142539 (main @ eb33b7db, job 'pages', 2026-10-14 18:54-19:04Z, desktop+mobile, production)
- **acceptance_logic:** scripts/denton-launch-accept.py + scripts/denton_verdict.py from claude/wsc-geometry, re-run on (audit, latest pages): counts reproduce UNKNOWN 14 / PASS 5 / FAIL 13
- **jurisdictions:** branch claude/step6-jurisdictions data/denton-step6-zip-jurisdiction-matrix.json (27 geographic ZIPs; generated before v271)
- **sources:** docs/denton-step6-source-verification-2026-10-14.md (branch claude/step6-sources)
- **db:** production read-only SQL via mcp Supabase execute_sql, zip-keyed; no writes

Acceptance logic was re-run on (audit JSON from run 38597050743, pages JSON from run 38619142539) and reproduces UNKNOWN 14 / PASS 5 / FAIL 13. Per-ZIP detail, audit counters and the nine category reasons are in the JSON.

---

## Post-refresh re-audit — 2026-10-16 (read-only, measured)

Run: `denton-launch-audit` #44, run id 38979247658, dispatched from `main` at `a0f882af`, all jobs succeeded
(`data`, `pages`, `accept`; `jurisdictions`/`coverage`/`sources`/`investigate` are skipped by design).

**Preconditions (database, read-only; control = 12,722 `development_reports`):** all 32 Denton ZIPs have
`refreshed_at` after 2026-10-14 18:04Z (newest 2026-10-16 22:36Z). `app_projects` now holds 543 rows across the seven
`denton-city-projects-*` registry ids, in 14 of the 32 ZIPs (75027, 75077, 76201-76207, 76209, 76210, 76226).

**Verdicts (accept step output): PASS 5 · UNKNOWN 15 · FAIL 12.** Total 32.
- PASS (5, PO Box path): 75027, 75029, 76202, 76204, 76206.
- FAIL (12): 75033, 75036, 75068, 76207, 76226, 76227, 76247, 76249, 76258, 76259, 76262, 76266.
  Reasons: eligible source records missing from serving (1 to 1,438 per ZIP, largest 76247 = 1,438, 75068 = 1,246,
  76266 = 818, 76259 = 591, 76207 = 508); 75033 also has 3 dots whose source record the publisher does not return;
  76207 has 1 line/polygon dot not on the publisher's geometry; 75068, 76227 and 76262 have dots whose source id is shared
  by several official features.
- UNKNOWN (15): 75007, 75010, 75022, 75028, 75056, 75057, 75065, 75067, 75077, 76201, 76203, 76205, 76208, 76209, 76210.

**No geographic ZIP passes.** `source_coverage` and `classification` are `not_run` and `evidence` and
`eligibility_reconciliation` are `incomplete` for every geographic ZIP, so none can reach PASS.

**Not done, and why:** `docs/denton-acceptance-evidence.json` was NOT generated. The audit produced no measured evidence for
source coverage, classification or per-record evidence, and the file must not be filled from anything else.

**Pages test origin:** the test targets `https://homesignal.net`, which now 301s to `jodytracks.com` (#1980/#1983); the
browser follows the redirect. The final URL was not separately recorded in the output read for this update.

**Verdict unchanged: NO-GO on data currency / reconciliation.** The refresh completed; it did not close the
missing-record counts above.

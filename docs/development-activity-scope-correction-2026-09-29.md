# Development Activity — product-scope correction (2026-09-29)

This records a founder ruling and the read-only audit that followed it. It supersedes the geography and "market" framing of `docs/development-activity-plan-2026-09-28.md` and of `docs/development-activity-reconciliation-2026-09-29.md`. Those two files stay as the dated record of what they said; where they disagree with this one, this one governs.

Nothing here changes runtime behavior. The proposed sequence in §6 is a proposal, not an approval.

> **Superseded in part, 2026-09-30.** The founder supplied an updated plan (`docs/development-activity-plan-2026-09-30.md`) that adopts this ruling, and six further rulings (`docs/development-activity-founder-rulings-2026-09-30.md`). The sequence to follow is now Order A–P in `docs/development-activity-status-2026-09-30.md`; the R0–R20 proposal in §6 below is **not** followed. §1 (the ruling) and §3–§5 (the audits) remain the dated record. The U02 work mentioned here was reverted and never merged.

## 1. The ruling (founder, 2026-09-29, verbatim in scope)

> Do not architect HomeSignal Development Activity by city or by "market." There is no NYC-only product concept. HomeSignal's geographic product universe is the existing canonical set of 12,722 ZIP-code pages.

- A brokerage or real-estate agent may enter **any** property address. Resolve it to its ZIP.
- If that ZIP is in the canonical 12,722-ZIP registry, Development Activity is an eligible product surface for that address. Build the report from HomeSignal's **existing** development-data and ingestion architecture, and from the coverage available for that geography.
- Coverage depth may vary by ZIP and source, and that must be disclosed honestly.
- No city-specific implementation or configuration. No "markets" as the gating abstraction. **No new feeds** for Phase 1.
- A ZIP outside the canonical universe reports **coverage unavailable**.
- An unsupported ZIP, an unresolved address, a failed generation, or an insufficient report-quality result **must not consume a free-report credit**.
- The NYC V1 Future Surroundings work is **legacy implementation and history**. It does not define the architecture or the geographic scope.

```
PROPERTY ADDRESS → ADDRESS RESOLUTION → CANONICAL ZIP CHECK
                 → EXISTING HOMESIGNAL DEVELOPMENT COVERAGE/DATA → DEVELOPMENT ACTIVITY REPORT
not: PROPERTY ADDRESS → CITY/MARKET-SPECIFIC REPORT IMPLEMENTATION
```

## 2. What in the frozen plan this overrides

| Plan location | What it said | Now |
|---|---|---|
| Step 10 (`:1983-2029`) | "Coverage quality determines the first pilot markets"; readiness judged per market | Eligibility is the canonical ZIP. Readiness and coverage are per ZIP and per source, not per market. |
| `:1283`, `:1393-1395`, `:1539-1558` | "For each pilot market…", "for each source/market record" | Per ZIP / per source record. |
| `:2017`, `:2025-2029`, `:2471`, `:2497`, `:2523` | "report-ready / change-ready / sales-ready **markets**", outreach only to sales-ready markets | Same three states, defined per ZIP. Outreach targeting is by ZIP coverage. |
| `:143-149`, `:1946-1951`, `:2299-2354` | Steps written against the NYC V1 report and the browser-direct NYC Open Data path | Legacy. Lineage, change and baseline work is built on the national data, not on four NYC views. |
| Reconciliation D7, D10 | "NYC brokerages only"; keep the NYC job-filings mapping inside the FSR contract | Superseded. D10's mapping is legacy-only, and "no new feeds" means it is never added to the registry. |
| Reconciliation U01 / U02 | Customer surface and one engine, both on the NYC path | See §5. |

The plan's rules that do **not** depend on geography stand: a new fetch is not a change; a publisher date is not `first_detected_at`; a source outage is not a removal; one Type/lifecycle/decision authority; server-side quota and entitlement; opaque share tokens; `report_id` separate from `content_hash`; no unapproved basemap.

## 3. Audit A — where NYC is hardcoded into the report path

Read on `main` `0357d97`. Everything below is **legacy implementation** and must be separated from the national architecture. None of it is used by Map 1, the ZIP pages or the national registry paths.

| Where | What is hardcoded |
|---|---|
| `lib/nyc-v1-report.js:7-31` | `DATASETS`: NYC AddressPoint, DOB Permit Issuance, DOB NOW Approved Permits, DOB NOW Job Filings, each with its NYC Open Data publisher string |
| `:33-43`, `:72-80`, `:134-158`, `:180` | NYC permit-type and filing-type allowlists; the five-borough map (`BOROUGH`); borough parsing and matching in address handling |
| `:82-96` | `EXCLUSIONS` and `INVESTIGATE` copy naming NYC Department of Buildings and the AddressPoint |
| `:303`, `:332`, `:363`, `:510`, `:522` | `record_url` built from `data.cityofnewyork.us`; report `version: 'nyc-v1'`; `host: 'data.cityofnewyork.us'` |
| `lib/nyc-v1-soda.js:1-7`, `:25`, `:38`, `:82-159` | The one allowed host, the four allowed view ids, every query written against those views' columns |
| `lib/fsr-scale.js:8-10`, `:49-54`, `:91`, `:95-185` | The **market registry**: `assemblable_market_ids: ['nyc-v1']` and market rows for New York City, Seattle, Cambridge MA, Chicago, Austin, Little Rock, Brunswick County. This is the "market as gating abstraction" the ruling rejects. |
| `lib/fsr-scale.js:198-208`, `:226`, `:271`, `:311-317`, `:351`, `:368-393` | `isNycV1Report` gate on every portfolio/listing/usage object; `nyc-v1-*` versions; a `market` request field validated against `'nyc-v1'`; a capability document naming the NYC host |
| `future-surroundings-report.html:42` | Eyebrow `HOMESIGNAL DEVELOPMENT ACTIVITY · NEW YORK CITY` (added by U01, merged in #1458) |
| `:96-97`, `:105`, `:192-204`, `:312-366`, `:448-456` | Loads the two NYC libs; `hs_nyc_v1_*` storage keys; the "Assemblable markets" view; Department of Buildings and borough copy; "Retrieving AddressPoint and Department of Buildings rows from NYC Open Data" |
| `supabase/functions/get-future-surroundings-report/` `allowlist.ts:1-2`, `:38-59`, `:65-71`; `index.ts:1`; `supabase/config.toml` | NYC allowlist API, a `market: 'nyc-v1'` request field and capability document. Not deployed (reconciliation row 13). |
| tests: `nyc-v1-report`, `fsr-scale`, `fsr-audience.browser`, `lib-cache-keys`, `corporate-output-unsupported-predictions`, `socrata-text-date-recency`, `source-key-quality` | Pin the above. The last two only reference the NYC registry ids and are not part of the FSR path. |
| `docs/corporate-output-*` (21 files) | The NYC pilot's evidence, assembly notes and the per-city coverage matrix |

**Not hardcoding, and not touched by this correction:** `jurisdiction-registry.json` carries `nyc-dob-permit-issuance` and `nyc-dobnow-approved-permits` as two of its 240 national entries, which is the correct shape (a source among many, selected by coverage). `nyc-dobnow-job-filings` is in the FSR path and **not** in the registry (reconciliation row 5). Under "no new feeds" it stays legacy-only.

**Also legacy in shape:** the report is assembled by live browser-side (and edge-side) calls to one publisher's API, address matching is against that publisher's own address table, and record links point at a dataset page rather than the record. The national architecture assembles from `app_projects` and its geometry instead.

## 4. Audit B — what already exists for the target architecture

| Target stage | Existing HomeSignal path | Evidence |
|---|---|---|
| Address resolution | `geocode-address` edge function: one-line address → U.S. Census geocoder → `{matchedAddress, lat, lng, zip, city, state}`, first confirmed match only, never a guessed point, outage is a 502. Also `get-address-report`'s ladder (OpenAddresses rung 1, Texas only, 8,545 rows, then Census) with `canonicalAddr()` as the one address normalizer. | `supabase/functions/geocode-address/index.ts:1-11`, `:29-38`; `get-address-report/index.ts:94-95`, `:71-72`; rights audit `:95` |
| Canonical ZIP check | `public.canonical_zip_registry` (12,722 ZIPs, DB-enforced; the ingest repo owns it). On the site side the same universe is `communities` level=zip, `development_reports` (one row per ZIP), and `app_coverage_states` (12,722 rows, "every ZIP"). No single "is this ZIP eligible" reader exists for a customer flow. | `scripts/verify-zip-universe.mjs`, `docs/coverage-state-model.sql:1-40` |
| Development data near an address | **Map 1 address mode**, already live: address → `geocode-address` → lat/lng → `public.n5_projects_within_radius(lat, lng, radius, limit)` (canonical geometry, radii 0.5 / 1 / 2 / 5 mi, `has_more` truncation signal, execute granted to `anon`) → `app_projects` hydration by `source_key` → the same markers, rails and dossier. First end-to-end street-address proof passed 2026-09-03; the page's own live-proof script drives it against production. | `lib/n5-radius.js:1-30`, `docs/n5-spatial-read-rpc.sql:323-345`, `:612`, `docs/n5-spatial-read-rpc-readiness.md` §16, §19, `scripts/map1-live-proof.mjs` |
| Type, lifecycle, decision | `lib/project-type.js` (`HS.classifyProjectType`, `HS.canonicalLifecycle`, `HS.canonicalProjectType`) and `sources/decision.ts` (denied and withdrawn kept as sourced, uncounted history). | CLAUDE.md §7.05, §7.11 |
| Coverage disclosure | `app_coverage_states` (per ZIP: populated, honestly_empty, unsupported_source, failed_ingest, temporarily_unavailable, stale_data, plus a separate regulatory-overlay state) and `geo.n5_serving_status` (boundary_complete vs not_measured, 706 ZIPs with no boundary). | `docs/coverage-state-model.sql`, CLAUDE.md §7.13 |
| Source identity | `app_projects.source_key` = `source|source_seq`, the base of project identity; source registry ids on each row. | ingest CLAUDE.md (Development SEO Rule D), `lib/n5-radius.js:8-30` |

So the four stages the ruling names each have an existing implementation. What does not exist is the **composition** for a customer flow: a single server-side path that takes an address and returns a typed outcome (resolved / unresolved / ambiguous / unsupported ZIP / coverage unavailable / insufficient quality / report).

## 5. Audit C — what stands in the way

### 5.1 The rights audit blocks this exact architecture for a paid or evaluation report

`docs/corporate-output-source-rights-audit-2026-09-27.md` (verdict **NOT YET**) holds, for a report sold to brokerages and agents:

- **All 240 jurisdiction-registry sources** (`:150`, family row `:84`): HOLD. Terms are not recorded per portal, and "public record" or an empty copyright field is not a commercial grant.
- **Census geocoder output, OpenAddresses-derived coordinates, ZCTA membership, `zipcodes` centroids** (`:154`, matrix row `:116`): HOLD. Any distance, pin or "near" claim depends on them.
- Only NYC's and Seattle's permit datasets were cleared with attribution, and Seattle's geography was not. **NYC V1 existed because NYC was the only market assemblable entirely from cleared publisher data and cleared geography** (its own AddressPoint replaced the geocoder), per `lib/fsr-scale.js:91`.

The ruling's target architecture routes every report through the geocoder and the ZIP/geometry stack, and through registry sources. Those are exactly the HOLD items. This is not a code problem and I have not decided it. It is the first decision in §7.

The site already shows these same records publicly on ZIP pages and Map 1 under the founder's one-time §10 sign-off (render the public fact plus a link, never editorialize). The audit says that sign-off does not extend to paid redistribution. Whether a free evaluation report to a brokerage is "paid" for this purpose is also unrecorded.

### 5.2 Gaps in the existing path, independent of rights

- **Ambiguity.** `geocode-address` returns the first match only. The NYC engine handles ambiguous and capped matches explicitly (a miss is only honest if every candidate was read). A brokerage report cannot silently pick a building.
- **Geometry coverage is partial and must be disclosed.** The radius RPC reads only projects with canonical geometry (741,562 rows at the 2026-09-03 sync; that figure is dated and grows). 706 ZIPs have no boundary and read as not measured. A ZIP with a "populated" coverage state can still return few radius results.
- **A radius crosses ZIP lines.** The RPC is pure geometry and knows nothing of ZIPs. The canonical ZIP check is an eligibility gate and a coverage lookup, not a filter on the results.
- **No observation ledger.** `app_projects` is refreshed by the materializer and carries identity (`source_key`) and a write stamp, not a history of what was seen when. Change detection is still unbuilt on the national data (reconciliation row 14 is unchanged).
- **Two units of coverage disagree.** `app_coverage_states` is per ZIP; a report needs "which sources were checked for this address's county and what did each return", which `property_reports.sources_checked` and the registry `covers` declarations hold.
- **Report-quality threshold.** The plan requires that an address below a minimum quality threshold does not consume a credit (`:971`), and the ruling repeats it. The threshold itself is undefined.

### 5.3 Not verified in this pass

- The Supabase connector is unauthorized in this session, so **no production read was made**: whether `n5_projects_within_radius` accepts the currently active N5 generation (its DDL was revised in `docs/n5-generation-publish-part-d.sql`), the current `app_projects` column list, and the current `canonical_zip_registry` count.
- Whether Map 1 address mode still passes its live proof today (the last recorded proof is 2026-09-03; the script exists to re-run it).
- `get-address-report` address mode was read only for how it geocodes, not end to end.

## 6. Proposed revised sequence (not approved)

Renumbered because the earlier U-numbers assumed the NYC engine. Track letters are unchanged.

| Step | What | Depends on |
|---|---|---|
| **R0** | This record (docs only). | none |
| **R1** | Rights decision for the national path (founder): what the report may include from the 240 registry sources, the Census geocoder and ZIP/geometry stack, for a free evaluation and for a paid report. Output is an evidence record in Git and a **per-source rights field in data** (so one source can be held without any city-specific code). | founder |
| **R2** | Address resolution and eligibility: one server-side function over the **existing** geocoder and the canonical ZIP registry, returning a typed outcome. Handles ambiguity. Sets the "does not consume a credit" outcomes. No city configuration. | R1 for what the geocoder may be used for |
| **R3** | Report assembly from the existing data: radius read plus `app_projects` hydration, Type and lifecycle from `lib/project-type.js`, decisions from `decision.ts`. Publisher-date facts only ("Recent Official Activity"); no change claims. | R2 |
| **R4** | Coverage and quality disclosure per ZIP and source, including the insufficient-quality rule. | R2, R3 |
| **R5** | Report layout on the national report object. | R3, R4 |
| **R6–R10** | Lineage, rights evidence for change, observation ledger, warm baseline, "What Changed": as U06–U11, on `app_projects` identity, per ZIP. | R1, R3 |
| **R11–R13** | Commercial spine (durable snapshot with `report_id` / `content_hash`, canonical commercial API, secure share): as U12–U14. | R3 |
| **R14–R18** | Accounts, 20-report evaluation, workspace, funnel analytics, paid continuation: as U15–U19, with credit semantics from §1. | R11 |
| **R19–R20** | Launch gate and per-ZIP readiness states (report-ready, change-ready, sales-ready). | all |
| **Legacy** | Retire the NYC V1 page, libs, edge function and market registry once the national path serves a report, or keep a non-entitled internal diagnostic per plan `:1946-1951`. Nothing new is built on it. | R5 |

## 7. Decisions needed

1. **Rights (blocks R2 onward):** does the founder's §10 sign-off (public fact plus link, attribution, no editorializing) extend to a free evaluation report and to a paid report, for the registry sources and the geocoder/ZIP stack? If yes, R1 is an evidence file plus a per-source data field. If only some sources, the report includes only those and says so.
2. **PR #1459 (U02, one NYC engine):** hold, drop, or keep as legacy hygiene. My recommendation is drop: it deepens the legacy path, and the function it consolidates has never been deployed. The bundling-spike result in `docs/development-activity-u02-one-engine-2026-09-29.md` is the part worth keeping, because it applies to any edge function.
3. **U01's "NEW YORK CITY" eyebrow** on the unlinked, noindex, disallowed page: leave as is until the legacy page is retired, or neutralize now.
4. **Insufficient-quality threshold:** what minimum makes a report worth a credit.
5. **Legacy NYC path:** retire, or keep as an internal diagnostic.

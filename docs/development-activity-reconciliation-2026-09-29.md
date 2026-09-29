# Development Activity — reconciliation record (2026-09-29)

This file records what `main` actually contained when the Development Activity plan was frozen in Git. It is evidence, not a roadmap. It does not clear a source, does not move a rights classification, and does not change product or runtime behavior. The historical checkpoint (`docs/future-surroundings-report-checkpoint-2026-09-27.md`) and the `corporate-output-*` evidence files are left exactly as they are; where this record disagrees with one of them, the disagreement is stated here and the older file stays as the dated record.

## Provenance

| Item | Record |
|---|---|
| Plan | `docs/development-activity-plan-2026-09-28.md`, a byte-for-byte copy of the upload named `093026_HomeSignal_Development_Activity_Plan_PHASE1_FOCUSED.md`. 2,539 lines, sha256 `d8597ebd497393be47d6377f7f7d5a189a3c8bab0b0129d839e39d9b7fa88cf6`. The plan file is not edited; later product changes are a new dated record. |
| Measured against | `HomeSignalG/homesignal-site` `main` `12497bd5f43d6f25f05b5d9cc690fc2bb4ca8be3` (2026-09-28). The plan cites `f715779…`, which is an ancestor of it; the three commits between them (#1449, #1450, #1451) touch none of the files named below. Before this change `main` had advanced one more commit, a bot nightly report (`b31fa70`, `docs/source-monitor-report.md` only). |
| Prior work | PR #1424 merged 2026-09-28T22:08:06Z; PR #1447 merged 2026-09-28T22:43:34Z. The Cursor branch `cursor/nyc-pilot-geography-rights-dbc1` head equals #1447's head (`d2f67df`), so nothing from that session is in flight. |
| Naming | The customer-facing name is **HomeSignal Development Activity**. `future-surroundings-report.html`, `get-future-surroundings-report`, `lib/fsr-scale.js` and the `FSR` prefix are legacy technical identifiers and are not renamed by this record. |

Every figure below names the file and line, or the query, it came from. Production reads were made read-only on 2026-09-29 against project `qwnnmljucajnexpxdgxr`. Anything not measured is listed under **Not verified**.

## What `main` contains, measured

| # | Fact | Evidence |
|---|---|---|
| 1 | The customer page reads NYC Open Data directly from the browser. | `future-surroundings-report.html:8` (`connect-src 'self' https://data.cityofnewyork.us`); `lib/nyc-v1-soda.js:6` (`HOST`), `:39` (`fetch`). |
| 2 | Internal pilot and verdict copy is rendered to any visitor: hard-coded in the header, and again in the Coverage, Portfolio and Usage views. All five views are reachable from a nav with no audience gate. | Page `:39`, `:173`, `:229`, `:257-260`; nav `:41-47`. Pinned by `test/fsr-scale.test.mjs:129` (14e) and `:68` (9b). |
| 3 | There are two report engines. The edge function re-implements assembly in TypeScript and keeps parity by comment. | `supabase/functions/get-future-surroundings-report/allowlist.ts:468` (`assembleReport`), `:580` ("this block must stay byte-identical to lib/nyc-v1-report.js"). |
| 4 | Row `stage` is a literal per dataset, whatever the publisher status. The filings view records statuses Approved, Objections, Permit Entire, Plan Examiner Review, LOC Issued, Full Demolition Signed-off and Filing Withdrawn; every listed one is staged "Filed". The registry buckets the two permit views (`nyc-dob-permit-issuance`: IN PROCESS→proposed, ISSUED/RE-ISSUED→approved, REVOKED→exclude; `nyc-dobnow-approved-permits`: Permit Issued→approved, Signed-off→operating), yet no query or row builder filters on status. | `lib/nyc-v1-report.js:293`, `:322`, `:351`; `docs/corporate-output-nyc-dobnow-job-filings-2026-09-28.md:63`; `supabase/functions/get-address-report/jurisdiction-registry.json` (`status_to_bucket`); grep of `nyc-v1-soda.js` and `allowlist.ts` for `permit_status`, `filing_status`, `REVOKED`, `IN PROCESS` matched only `$select` lists and row mapping. **How many such rows reach a real report is not measured.** |
| 5 | `nyc-dobnow-job-filings` is not in the consumer registry. | `jurisdiction-registry.json` search for the three NYC registry ids found the other two and not this one. |
| 6 | The NYC code does not use the canonical Type or lifecycle authority. The canonical Types match the plan's list. The canonical lifecycle keys are only `proposed`, `approved`, `operating`, `unknown`; there is no key for permitted or under construction. The classifier emits no Civic subtypes. | `lib/project-type.js:55-64` (`CATEGORY_REGISTRY`), `:528` (`LIFECYCLE_KEYS`). A search of `lib/nyc-v1-*.js`, `lib/fsr-scale.js`, the page and both `.ts` files for `project-type`, `classifyProjectType`, `canonicalProjectType`, `canonicalLifecycle`, `decision.ts` found nothing. `subtype` does not occur in `lib/project-type.js`, `lib/map.js`, `lib/community-page.js` or `lib/templates.js` (control: `civic` occurs 12 times in `project-type.js`). |
| 7 | The SODA queries select no project name or use field. Type will likely be "Other project" for most rows; that is an inference and is not measured. | `lib/nyc-v1-soda.js:107`, `:128`, `:145`. |
| 8 | Each row's `record_url` is the dataset page, not the record. Withdrawn filings are dropped. The list is capped at 50 by distance. `nearby_matched` counts source rows. | `lib/nyc-v1-report.js:303`, `:332`, `:363`; `:43`; `:44`; `:516`. |
| 9 | There is no lineage step. One test fixture models job `M0002-I1` as both a withdrawn filing and a DOB NOW permit; real overlap is not measured. The registry carries `identity_fields` (`work_permit`, `sequence_number`, `work_type`) for the DOB NOW permit view. | `lib/nyc-v1-report.js:429-541` (no linking); `test/nyc-v1-report.test.mjs:93`, `:109`; `jurisdiction-registry.json`. |
| 10 | `report_id` is a SHA-256 of the stringified report minus `report_id` and `generated_at`, and it is printed first in the report. The hashed object includes `product: 'HomeSignal Future Surroundings Report'`, so renaming that field changes every hash. | `lib/nyc-v1-report.js:405-410`, `:509`, `:536-539`; page `:322`. |
| 11 | Recent reports are in `sessionStorage` (key `hs_nyc_v1_reports`); usage and portfolio in `localStorage`. The share link rebuilds the report from address, ZIP and radius, and the page auto-runs from those parameters. | Page `:95`, `:112`, `:117`, `:126`, `:145-151`, `:451-458`. |
| 12 | The edge function is authored with `verify_jwt = true` and CORS `*`, and has no persistence, rate limit or idempotency key. The deploy workflow is `workflow_dispatch` only, exempts only `get-address-report` from JWT verification, and its second step full-replaces `public.registry_incomplete_entries` on any deploy. | `supabase/config.toml:14-15`; `index.ts:7`; `.github/workflows/deploy-edge-functions.yml:16-22`, `:61-68`, `:80`. |
| 13 | **The function is not deployed.** Production lists 20 edge functions: `unsubscribe`, `notify-signup`, `submit-public-form`, `get-address-report`, `lemonsqueezy-webhook`, `map-preview`, `social-approve`, `tabs-fixture-fetch`, `gate-check-staging`, `get-address-report-v19check`, `diag-email-check`, `geocode-address`, `fetch-youtube-transcript`, `esg-refresh`, `notify-health`, `edge-probe`, `confirm-alerts`, `maps-draft-dispatch`, `digest-resend-webhook`, `xrpc`. `get-future-surroundings-report` is not among them. | Supabase `list_edge_functions`, 2026-09-29. |
| 14 | No change ledger exists. No production column is named `first_detected_at`, `previous_status`, `change_event` or `change_detected_at`. Precedents are narrow: `resolved_project_status` (37 rows; tracks approval/pmn:1077, legal/manual, water_rights/pod; keyed to `resolved_projects`), the `dc_*` observation tables (data centres), and `gov_actions` and `source_document_events` (0 rows each). | Query 2 below (control: the same regex returned `first_seen_at`, `observed_at`, `content_hash`, `source_version`); row counts from `pg_class.reltuples` and `count(*)`. |
| 15 | The rights audit holds "Change detected since prior observation" at **HOLD**. A search of the `corporate-output-*` rights docs for retention and history terms surfaced that row and no passage granting or refusing retention of prior observations. That is a lead, not proof of absence. The NYC statute as quoted in the repo grants use "without any registration requirement, license requirement or restrictions on their use" provided source, version and modifications are identified. | `docs/corporate-output-source-rights-audit-2026-09-27.md:187`; `docs/corporate-output-nyc-pilot-assembly-2026-09-27.md:66-68`. |
| 16 | No brokerage, evaluation, entitlement, snapshot, share or invite tables exist. `app_premium_waitlist` (5 rows) is the only commercial-interest capture. | Query 1 below (control: the same regex returned `property_reports`, `development_reports`, `dc_*`). |
| 17 | A payment precedent exists that the checkpoint does not record. `lemonsqueezy-webhook` is deployed (v4), verifies an HMAC signature, and upserts `public.subscriptions` with `plan: "map_yearly"`; that table has 0 rows. Its source is in `homesignal-ingest`. The site has no checkout. The checkpoint's "no Stripe, no checkout, no payment path anywhere in the tree" is true of checkout and of the site tree, not of the platform. | Supabase `get_edge_function` and `count(*)`; `homesignal-ingest` `supabase/functions/lemonsqueezy-webhook/index.ts`; `supabase/migrations/20260701040000_subscriptions_processor_agnostic.sql`; checkpoint `:145`. |
| 18 | The identity tables the plan relies on exist with RLS on and one policy each: `app_profiles`, `app_properties`, `app_follows`, `app_watchlist_items` (also `property_reports`). `dashboard_admins` has RLS and no policy. | Query 3 below. |
| 19 | The page is unlinked, absent from `sitemap.xml`, `noindex`, and disallowed. | `robots.txt:22`; page `:6`; a search of the shipped tree for `future-surroundings-report` found only the page itself and `robots.txt`. |
| 20 | No open PR in either repo overlaps this work. The PRs found by keyword search (`future surroundings`, `brokerage`, `evaluation`, `entitlement`, `development activity`, `report snapshot`, `share link`) are the rights and NYC V1 PRs #1397–#1447, all closed. Open drafts that affect process: site #1452 and ingest #636 ("Claude may merge its own PRs without asking") and site #1333 (production credential boundary). | GitHub PR list and search, 2026-09-29. |

### Production queries (read-only, 2026-09-29)

1. Tables: `select table_schema, table_name from information_schema.tables where table_schema in ('public','geo') and table_name ~* '(eval|trial|entitle|quota|credit|brokerage|broker|team|seat|invite|snapshot|share|billing|stripe|checkout|payment|portfolio|observation|lineage|funnel|campaign|suppress|waitlist|pilot|report)'`. Returned: `geo.n3_pilot_frozen`, `geo.n5_snapshot`, `public.app_premium_waitlist`, `dashboard_snapshots`, the seven `dc_*` observation and lineage tables, `development_reports`, `property_reports`, `self_reports`, two dated snapshot tables, and the views `v_acq_campaign_metrics` and `v_feed_candidates_funnel`. None is a brokerage, evaluation, entitlement, report-snapshot, share or invite store.
2. Columns: `select table_schema, table_name, column_name from information_schema.columns where table_schema in ('public','geo') and column_name ~* '(first_seen|first_detected|last_observed|observed_at|previous_status|change_event|change_detected|content_hash|source_version|record_hash)'`. Returned `observed_at`, `first_seen_at`, `content_hash` and `source_version` on the tables named in row 14, and no `first_detected`, `last_observed`, `previous_status`, `change_event` or `change_detected` column anywhere.
3. Identity: RLS flag and `pg_policies` count for `app_profiles`, `app_properties`, `app_follows`, `app_watchlist_items`, `property_reports`, `dashboard_admins`, `social_admins`.

## Where this record disagrees with earlier ones

- Checkpoint `:145` says no payment path exists anywhere in the tree. See row 17.
- Checkpoint step 5 calls `report_id` "Done" and then qualifies it; the qualification stands, and rows 10 and 3 add that the hashed object carries the product name and that two engines produce it.
- The audit's "Type bucket / lifecycle map … SAFE DERIVED FACT as a method" (`…audit….md` §9) is not yet applied to any NYC row (row 6).

## Decisions still open

| # | Decision | Recommended default |
|---|---|---|
| D1 | Authorize a rights evidence record for retaining NYC observations and deriving change events (moves the §9 HOLD row for NYC-only inputs). | Yes, as an evidence file in Git. Blocks any "What Changed" and the observation store. |
| D2 | Where a permit-issued project sits: the plan lists it under both "Approved / Coming" and "Permitted / Under Construction". | Approved / Coming = filing status Approved with no permit. Permitted = permit issued. "Under construction" only where a publisher signal exists (none today). |
| D3 | Add canonical lifecycle keys for permitted and under construction? | No. Keep `approved` and carry a publisher-stage sub-label; Map 1 consumes the canonical keys. |
| D4 | Hero window. | 90-day hero over the existing 365-day list. |
| D5 | Show withdrawn and denied filings as historical, outside active counts, per the decision-history contract, instead of dropping them. | Yes. |
| D6 | Offer, price, billing unit, seats, quota, processor. | Lemon Squeezy (already chosen as merchant of record). |
| D7 | Evaluation unit and campaign scope. | One shared pool of 20 per brokerage account; NYC brokerages only. |
| D8 | Sales-outreach sender, opt-out handling, legal review. | Founder-owned. |
| D9 | Who merges. | A human, until #1452 lands. |
| D10 | Add `nyc-dobnow-job-filings` to the consumer registry (changes consumer output). | No. Keep the mapping inside the FSR contract with a parity test against the registry for the two shared views. |

## Implementation sequence

Execution status is tracked in the working session and in `QUEUE.md`, not here, so this file cannot go stale.

- **Phase 0:** U00 freeze this plan and record.
- **Phase 1 (an honest report on today's evidence):** U01 customer-safe surface and naming; U02 one engine, zero behavior change; U03 lifecycle and status truth contract; U04 canonical Type; U05 report layout v1 with the "Recent Official Activity" fallback.
- **Phase 2 (lineage and change):** U06 lineage measurement; U07 projects vs source records vs events; U08 rights evidence record (needs D1); U09 observation ledger; U10 warm baseline and the change-ready gate; U11 "What Changed" and Change History.
- **Phase 3 (commercial spine):** U12 durable snapshot with `report_id` and `content_hash`; U13 canonical commercial API and cutover; U14 secure share and read-only client view.
- **Phase 4 (accounts, evaluation, paid):** U15 brokerage account, members, branding; U16 20-report evaluation; U17 agent workspace and brokerage admin; U18 server-side funnel analytics and outbound tables; U19 paid continuation.
- **Phase 5:** U20 launch gate; U21 readiness states (report-ready, change-ready, sales-ready).

Tracks: A (report truth and UI) U01→U05; B (change intelligence) U06→U07 and D1→U08→U09→U10→U11, started early because the baseline needs calendar time to warm; C (commercial spine) U12→U14, after U02; D (accounts, evaluation, paid) U15→U19; then U20 and U21.

## Not verified

- The live page at `homesignal.net` (the only source is the PR #1447 description).
- Print/PDF output and whether the results table overflows a 390 px viewport.
- How many BIS `IN PROCESS` or `REVOKED` rows, or filings beyond "Filed"-stage statuses, reach a real report (row 4).
- Whether a shared module can be bundled into the edge function by the Supabase CLI (U02 begins with that spike).
- Whether the `LEMONSQUEEZY_WEBHOOK_SECRET` secret is set.
- The remaining rights docs in full for retention or history language (row 15; U08 must read them in full rather than rely on this search).
- A full-repo search for other observation or lineage precedents beyond the tables and columns named above.

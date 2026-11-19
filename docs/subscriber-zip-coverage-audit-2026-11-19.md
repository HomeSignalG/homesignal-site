# Subscriber ZIP coverage audit — validation batch (2026-11-19)

Working audit artifact for the "Subscriber ZIP coverage, verified completeness & continuous refresh" priority.
Scope done this session: shared infrastructure (verdict model, lifecycle SQL, tests) and a **database-evidence** audit of the five
validation ZIPs. Method: `public._hs_subscriber_zip_health_core()` read through `execute_sql` at 2026-11-19 ~21:00 UTC, plus
`communities`, `source_registry`, `cron.job`. Counts are database counts; **no official-source reconciliation was performed**
(the sandbox has no egress to government hosts, and the reconciliation workflows are runner jobs). Subscribers are counted, never named.

## Verified architecture (read, not assumed)
- Subscribers: `public.bsky_maps_priority_classification`, class `eligible` (ingest #1143; test/unsubscribed excluded there).
- Tab 2 reader: `docs/subscriber-zip-health.sql` (`hs_subscriber_zip_health`, admin-gated, read-only) + `lib/acq-subscriber-zip-health.js`.
- Priority order for drafts is ingest's `bsky_maps_subscribers_first()` (pg_cron 122, every 15 min). MAPS eligibility lives only in ingest `bluesky/lib/maps-eligibility.mjs`.
- Refresh: pg_cron 14 `dev-reports-rolling-refresh` `*/2`, 8 ZIPs/tick ≈ 53 h per full sweep. No per-subscriber-ZIP schedule exists.
- **`public.source_registry` has 6 rows and `refresh_cadence` is NULL on all of them; none is a source used by these ZIPs.** The authoritative
  classification registry is `jurisdiction-registry.json`. So Tab 2's "expected schedule" column can never be filled from that join: this is an
  instrument gap, shown as UNVERIFIED, not as a pass.
- Nothing in either generator path was run or modified that can publish, send email or deploy.

## What shipped (this PR)
1. `HS.subscriberZipFindings` (alias `subscriberZipVerdict`): ten states, **simultaneous findings**, deterministic rollup
   (BLOCKED_SOURCE_ACCESS > INGESTION_FAILURE > MISSING_COVERAGE > PAGE_REFRESH_FAILURE > RECORDS_MISSING_FROM_MAP > STALE_DATA >
   PARTIAL_COVERAGE > UNVERIFIED > VERIFIED_NO_NEW_ACTIVITY > VERIFIED_CURRENT). `VERIFIED_*` is unreachable without a current, complete,
   zero-missing reconciliation record; the database supplies none today, so no ZIP can read verified. 36 tests.
2. `docs/subscriber-zip-lifecycle.sql` (**not applied**): persistent one-row-per-ZIP lifecycle, history table, idempotent
   `subscriber_zip_lifecycle_sync()`, admin reader. Stage is a ceiling from evidence and stops at `reconciliation` until a reconciliation is recorded.
   Disposable-Postgres proof `test/subscriber_zip_lifecycle_pg/run.sh`: 13/13 (it caught a real plpgsql bug before apply).

## Per ZIP (database evidence only; reconciliation not performed for any)
| ZIP | Local governing bodies on file | Dev sources with stored records (records, newest filed) | Live records / on this Map 1 / in no Map 1 | Gov feeds active | ZIP report refreshed | Findings | Class |
|---|---|---|---|---|---|---|---|
| 07001 Avenel NJ | Middlesex County (no city row) | nj-stip-projects (2, 2015-01-21) | 0 / 0 / 0 | 8/8 | 2026-11-18 17:40Z, EPA layer unavailable | PARTIAL (state transport source only), UNVERIFIED | PARTIALLY_COMPLETE |
| 48854 Mason MI | Ingham County | mdot-stip-projects (5, 2027-07-09) | 5 / 2 / **3** | 2/3 | 2026-11-19 04:54Z | **RECORDS_MISSING_FROM_MAP (3)**, PARTIAL, UNVERIFIED | PARTIALLY_COMPLETE |
| 64166 Kansas City MO | Clay County (city row absent) | kcmo-development-cases (71, 2026-11-09), kcmo-capital-projects (14), kcmo-building-permits (2), modot-stip (5) | 10 / 2 / 0 | 8/9 | 2026-11-19 19:56Z, EPA unavailable | PARTIAL (1 gov feed inactive), UNVERIFIED | PARTIALLY_COMPLETE |
| 85083 Phoenix AZ | Maricopa County | phoenix-building-permits (2,048, 2026-11-17), adot-tip (1) | 631 / 4 / 0 (627 belong to neighbouring ZIP pages) | 8/9 | 2026-11-19 19:56Z, EPA unavailable | PARTIAL, UNVERIFIED | PARTIALLY_COMPLETE |
| 98684 Vancouver WA | Clark County | wsdot (3 sources), clark-county-active-dev-permits (1, 2025-09-26), wa-ecology-sepa (1, 2026-08-12) | 3 / 1 / 0 | 8/8 | 2026-11-17 20:16Z, EPA unavailable | UNVERIFIED | PARTIALLY_COMPLETE |

Posts/email: 85083 has 1 published MAPS post and 2 delivery rows (no duplicates), 3 skipped; 64166 has 1 skipped; 07001, 48854, 98684 have none.
Email readiness for the other four is "no published post", which is not an absence of development.

## Blockers and owners
1. Official-source reconciliation for every ZIP: needs runner egress (e.g. `recon-fetch` / the source's own probe workflow) per jurisdiction. Owner: OWNER_UNASSIGNED (next session; founder to authorize the runner minutes).
2. Missing local sources: no city/county permit or planning source for 07001 (Edison/Woodbridge area, Middlesex NJ) or 48854 (Mason / Ingham MI). Needs discovery, registry entry and a dry-run; not started. Owner: OWNER_UNASSIGNED.
3. 48854: 3 recent live records are in no serving Map 1 generation. Likely the next N5 generation (builds daily); re-check after the next ACTIVE switch before treating as a defect. Owner: Map 1 (ingest/N5).
4. Source schedule metadata: `source_registry.refresh_cadence` empty; decide whether Tab 2 should read the registry JSON or derive from cron job 14. Founder call.
5. EPA layer unavailable on four of five ZIPs (EPA 429/502 availability, known class).
6. Lifecycle SQL needs founder approval to apply; Tab 2 wiring of `hs_subscriber_zip_lifecycle` follows the apply.
7. No draft-only MAPS run was triggered this session: no ZIP has passed its verification gates.

## Next exact actions
1. Founder: approve applying `docs/subscriber-zip-lifecycle.sql` and a daily `subscriber_zip_lifecycle_sync()` pg_cron (this session did neither).
2. Next session: ZIP 85083 first (best-covered): official Phoenix permit read via runner, record-level comparison, write `reconciliation_*`.
3. Then 64166, 98684, then source discovery for 48854 and 07001.

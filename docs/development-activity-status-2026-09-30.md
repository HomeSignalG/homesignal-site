# Development Activity — plan status (living document)

Governs with `docs/development-activity-plan-2026-09-30.md` (frozen, sha256
`66257cc790c566c6b25644225899659385b973d8b1e6b02f94f7272a3a92955c`) and
`docs/development-activity-founder-rulings-2026-09-30.md`.

**How to read it.** ~~Struck through~~ = done, and "done" means **merged to `main`**.
Nothing is struck on the strength of a branch, a draft PR or a dry run. Only this file
is edited as work lands; the plan and the rulings are frozen.

Last updated: 2026-10-01, in the PR that records the production receipts of the purge schedule (#1502, applied 16:34Z, first monitor tick ok at 17:10Z) and of ledger option (b) (#1506, applied 17:02Z).

## Master steps (plan "Master Step Plan")

1. ~~Freeze the B2B product~~ — the plan itself marks Step 1 COMPLETE.
2. Complete corporate data-rights clearance — **open.** Classifications come from
   `docs/corporate-output-source-rights-audit-2026-09-27.md` (verdict NOT YET; HOLD stays
   HOLD, ruling R4). Separate gate; does not change the 12,722-ZIP architecture.
3. Remove unsupported prediction claims — **open.** The merged U01 (#1458) touched the
   legacy page only; it has not been checked against Step 3's text, so nothing is struck.
   - 3A. Build the Change Intelligence Contract — **open; Order B audit done** (see below).
     Nothing of it exists: no first-detected date, no prior value, no change event.
4. Build the real Development Activity Report — **open.** Gated on Step 3A and on the
   national path (Order G). Layout waits for the data contract (Order I).
5. Standardize development/change content and lifecycle — **open.** Rulings R1–R3 apply.
   One mismatch to resolve first: stored status `Decided` (19,309 rows) resolves to
   "Lifecycle unknown" in `lib/project-type.js` while `decision.ts` buckets it as proposed.
6. Durable report snapshot (`report_id` vs `content_hash`) — **storage layer done (Order F);** the
   customer-facing use of it waits for Orders G, J and L.
7. Secure share + print/PDF + disclosure + audit trail — **open.**
8. Agent Workspace + Brokerage Admin — **open.**
9. Canonical commercial property-intelligence API — **open.** One generation path, and it
   must be national: the only report engine in the tree today answers NYC addresses.
10. ZIP/address coverage truth for the 12,722-ZIP universe — **open.**
11. Autonomous 20-report brokerage evaluation — **open.** The credit rule for
    insufficient quality is an open founder decision (R5).
12. Autonomous conversion to 3–5 paid pilots — **open.**
13. Acquisition-grade instrumentation — **open.**
14. Reusable listing-level summary — **open.**
15. Batch / portfolio / API scale — **open.**
16. Protect the long-term platform thesis — **open.**

## Immediate Product Execution Order (plan "Immediate Product Execution Order")

- A. ~~Freeze this updated plan in Git~~ — `docs/development-activity-plan-2026-09-30.md`,
  byte-identical to the upload, added in the PR that merges this file.
- B. ~~Audit national identity/lineage~~ —
  `docs/development-activity-audit-b-identity-lineage-2026-09-30.md`, merged with this file.
- ~~C. Durable observation/delta layer~~ — **done.** Merged as #1461 (`764d6e3`) and applied to
  production 2026-09-29 17:20Z (migration `dev_change_ledger_c1_20260930`, ledger version
  `20260929172018`). `docs/dev-change-ledger.sql` + `docs/development-activity-change-layer-2026-09-30.md`;
  33 SQL checks with 21 prohibited mutations all killed (Postgres 16 local, 17 in CI), 29 structural
  pins. Production receipt: design doc §8.
- ~~D. National change baseline~~ — **done.** Driver, per-ZIP cursor with a capacity gate, and the
  per-source evidence view merged as #1463 (`a952139`) and applied to production 2026-09-29 18:11Z (migration
  `dev_change_baseline_d1_20260930`). The **national baseline ran 2026-09-29 18:57–19:34Z**: all 12,722 ZIPs
  observed, 0 errors, 932,969 identities and 922,244 events (counts reconcile exactly to the runs), ledger 1.93 GB
  (2,071 B per identity). Receipts: design doc §9 (apply and pilot) and §10 (the run). **Two things the run
  did not settle:** 959 of the events are cross-copy disagreements typed as changes instead of first detections
  (decision 10: the reader rule is built, `dev_change_event_reportable`, design doc §11; the writer question
  remains), and the run overlapped the last minutes of the daily `verify-communities` load, during which
  the API had statement timeouts that I cannot attribute between the two (design doc §10; decision 9 carries the
  scheduling consequence). No change is detected from here on until a recurring job exists (decision 9). A
  development source can be labelled only ERROR or UNKNOWN until the two gaps in decision 8 close.
- ~~E. Change-detection tests~~ — **done with C** (all 11 cases, `test/dev_change_ledger_pg/`; map in
  the design doc §4). One case is proven only in part, and stays so until sources supply proven
  identifiers: linked source rows of one project are proven for ZIP copies of a record, not for
  cross-record lineage.
- ~~F. Durable `report_id` + `content_hash`~~ — **done.** Merged as #1475 (`76dca60`) and applied to production
  2026-09-29 21:16Z (migration `report_snapshot_f1_20260930`, ledger version `20260929211614`).
  `docs/report-snapshot.sql` + `docs/report-snapshot-contract-2026-09-30.md`. It means: a table that stores a
  report, a database-minted `report_id` per stored snapshot, a `content_hash` that the database checks, and a shared
  module — **and nothing calls the writer until Order G**; the table holds 0 rows; the legacy NYC page and API are
  untouched (R6). Production receipt: contract doc §7. **Its `inputs` and `property_key` columns could have held a
  customer's address; they are removed by F2 below.**
- ~~F2. Privacy boundary of the report snapshot~~ — **done** (founder decision 2026-09-29). Merged as #1480
  (`023b4bf`) and applied to production 2026-09-29 22:22–22:23Z (migrations `report_private_context_f2a_20260930`,
  ledger `20260929222229`, and `report_snapshot_f2b_20260930`, ledger `20260929222315`; stored text md5-equal to both
  files). `docs/report-private-context.sql` (new, deletable) + `docs/report-snapshot.sql` (changed) +
  `docs/report-private-context-contract-2026-09-30.md`. It means: the exact street address never enters the immutable
  snapshot; it lives in a separate private context kept while a report, a Follow or an account needs it, purged in
  place 90 days after the last need ends (at once on a verified privacy request or a legal requirement), with an
  append-only audit; the snapshot keeps its `report_id`, hash, body and time when the address is purged. Measured
  first: the legacy report shape would have stored the typed address, the exact property point and per-record offsets
  that recover the point to within a metre (contract §2). All four tables hold 0 rows and **nothing calls the writer**;
  the purge is written and tested; **its schedule and alarm are applied (contract §13): pg_cron job 70 every 15 minutes, and the alertable check `report_private_context_retention`, which read ok on its first monitor tick (2026-10-01 17:10Z)**. Production receipt and a rolled-back behaviour probe: contract
  §12. **The probe found one limit the docs had not named:** the database backstop matches whole values, so a fragment
  of the address (the street line alone) is not caught — now stated in §9 and pinned by X07b, and it goes on Order G's
  boundary-test checklist (§8.4).
- G. Deploy / smoke the canonical commercial API — **done for what it claims: the national engine is deployed (function
  `get-development-activity-report`, version 1, JWT on, run `36648751939`) and its two access gates are smoked in production;
  the signed-in path is NOT exercised, so no end-to-end report has been generated there.** Production receipt:
  `docs/development-activity-report-engine-2026-09-30.md` §11. It stores nothing (both report tables read 0 rows), and the
  ledger has no reportable events yet (0), so today a report can show Recent Official Activity but not What Changed Recently.
  One logged-not-taken limit: a capped hydrate chunk fails the request rather than splitting (worst measured 572 of 1,000 rows).
  **Go given 2026-09-29 under one rule: Order G may build the national report engine, but no
  production path may permanently write a brokerage-entered exact address into the immutable snapshot, and no real
  customer report is stored until the five gates in `docs/report-private-context-contract-2026-09-30.md` §6 are closed**
  (three are proven; gate 5, arming the purge, is applied and reading ok — contract §13; one is open: the Follow / Changes Since Report surface).
  `docs/development-activity-report-engine-2026-09-30.md` records what was found and built: the plan's "canonical
  commercial API" (NYC-only) was **never deployed**, so this builds the national path (`get-development-activity-report`,
  JWT on, plus a signed-in allow-listed user because the anon key passes the gateway). **It stores nothing, and it shows a
  source's records to a customer only if that source is on a written clearance list, which is empty** — so today every
  customer report is LIMITED COVERAGE with no records, and the internal view is the only one that shows records (labelled
  HOLD, never storable). Proof: 117 + 85 + 59 offline checks, 28 checks storing the engine's real output through the real
  Postgres writer, 107 mutations all killed. **Not built, by design:** entitlement, quota, idempotency and rate limiting
  (Orders H, L, M), the "Things to Review" section, per-ZIP source-applicability measurement.
- H. Remove the quota bypass — open.
- I. Redesign the report, only after the data contract is proven — open.
- J. Secure stored-report delivery — open.
- K. Agent Workspace + Brokerage Admin — open.
- L. Evaluation build and security tests — open.
- M. Paid continuation path — open.
- N. End-to-end launch gate — open.
- O. Mass outreach — open.
- P. Convert to 3–5 paid pilots — open.

## Rulings in force (2026-09-30) — summary

R1 regulatory is an overlay, never a Type · R2 lifecycle is exactly proposed / approved /
operating / unknown; publisher statuses stay separate · R3 no "What Exists Today" in
Phase 1 · R4 rights come from the existing audit, a HOLD is not cleared · R5 the credit
threshold for insufficient quality is not defined (open) · R6 legacy NYC is history; the
eyebrow is HOMESIGNAL DEVELOPMENT ACTIVITY. Full text and the plan lines each overrides:
the rulings file.

## What changed in the implementation sequence

The earlier sequence (`docs/development-activity-reconciliation-2026-09-29.md` U00–U21,
and the unapproved R0–R20 in `docs/development-activity-scope-correction-2026-09-29.md`)
is **superseded by Order A–P above**. Those two files stay as dated receipts.

- **U00 (#1457)** and **U01 (#1458)** are merged and describe the old NYC-era plan and
  the legacy page. They complete no step of the new plan.
- **U02 is reverted** (the NYC engine consolidation) — the plan makes NYC legacy, so it
  pointed the wrong way. It was never merged.
- **D7 (NYC brokerages only) and D10 (NYC job-filings mapping) are dead.**
- The legacy technical route is untouched. It is not deleted or renamed (R6).
- The first real work is Order C, and the audit already fixes its shape: diff over a
  declared fact list (not whole rows — retrieval timestamps otherwise count as change),
  key on the project not the ZIP copy, treat multi-record keys and non-durable bases as
  non-comparable, keep a baseline and prior values, append-only.

## Open decisions (only what the rulings did not settle)

1. **R5 — the credit rule for insufficient quality.** Founder/product; not to be invented.
2. **Operating records in Phase 1.** Default applied: an `operating` record appears only
   when it carries a qualifying change event in the window, never as a standing inventory
   (follows from R3). Confirm at Step 4.
3. **Civic & Public subtypes** (plan lines 830–843): default applied — display labels from
   publisher evidence only, no new classifier key. Confirm at Step 5.
4. **`Decided` lifecycle mismatch** (above): the fix changes what residents see on
   existing surfaces, so it is not made without a go.
5. ~~Order C schema~~ — go given 2026-09-30 (new tables, additive only).
6. **Rights per source family** (R4) before any paid pilot exposes a source's content.
7. ~~Free disk for the national baseline — and the go to run it.~~ Go given 2026-09-29 and the run is done. The
   figure passed to the gate was derived from the dashboard's "Disk 51%" (16,000, then 15,000 MB); a reading
   taken afterwards (Disk 57%: database 18.8 GiB, WAL 1.1 GiB, system 207 MiB) puts the volume at about 35 GiB
   with about 15 GiB free, so the figures were true throughout, with a final margin of only ~0.5 GiB (design doc
   §10). The 35 GiB is derived from the percentage, not read from the size setting. The 24 GB recorded on
   2026-09-25 is superseded. Headroom is ample for now (database 20.16 GB, ledger 1.93 GB).
8. **Source-health labels — the workbook was supplied 2026-09-29 and settles the definitions, not the gaps.**
   Its contract (Instructions rows 509–580) defines HEALTHY / STALE / ERROR / VERIFIED ZERO / UNKNOWN / N/A /
   PAUSED at (ZIP × feed family) grain and forbids inventing an SLA. For the development family it records
   `SLA_UNDEFINED` and no freshness source field ("`submitted_at` is a filing date"), and the refresh logs
   failures but not successes. So today only ERROR and UNKNOWN can be assigned (its own 2026-09-26 audit:
   17 ERROR, 224 UNKNOWN). Two things are still needed: (a) an approved freshness SLA and a source-controlled
   freshness field for the family — a product decision; (b) per-source success logging in the refresh — an
   engineering change in the refresh's lane. The view exposes the evidence; details in the Order D design doc §8.
9. **A recurring observation job.** Without one the ledger never detects a change after the baseline.
   Arming a `pg_cron` job is a new scheduled job and waits for a go. Decision 10 should be settled first,
   because an ordinary run re-observes ZIP copies and would meet the same disagreements. **It must also keep
   clear of the daily `verify-communities` run**, which starts at a different time each day (17:10, 17:44,
   20:07 and 18:38Z on 09-26 to 09-29), lasts 22–47 minutes, and on 09-29 drove the API to 190 statement
   timeouts on its own.
10. **Cross-copy disagreements are typed as changes (found by the national baseline).** 959 events (563
    `status_changed`, 396 `source_record_updated`) on 863 multi-ZIP identities were written as changes although
    they are differences between ZIP copies materialised at different times, none of them seen during the run;
    114 sit on identities the ledger itself marks non-comparable. Nothing was deleted (the ledger is append-only).
    **Option (a) chosen by the founder 2026-09-29 and built in this PR:** the view
    `public.dev_change_event_reportable` (`docs/dev-change-reportable.sql`, design doc §11) is the one definition
    of which events may be shown as changes — only those written by an ordinary run; no ledger change, no
    writer change, reversible. A reader must select from it, never from `dev_change_event`; a structural test
    fails if anything else names the raw table. **Merged (#1470) and applied to production 2026-09-29 20:32Z**
    (migration `dev_change_reportable_d2_20260930`; it reads 0 reportable events today, against 922,244 events
    that are all baseline; it has no reader, so nothing visible changed; receipt in design doc §11). **Option (b) — go given 2026-09-30, built 2026-10-01, merged (#1506) and
    applied to production 2026-10-01 17:02Z (change-layer doc §9, with the receipt):** the writer now HOLDS copies that contradict on name, address or
    filing date instead of announcing them (a hold, not a newest-copy resolution, because the measured conflicts persist:
    528 of the 862 identities that carried a cross-copy event still disagree today). A real rename is reported once the copies
    converge; a new record whose copies already contradict is recorded non-comparable (`copies_disagree`); a held
    observation writes only an audit row (`dev_change_copy_conflict`). The production upgrade is the generated
    `docs/dev-change-copy-conflicts-apply.sql`, guarded on the live writer's md5, applied through `db-sql.yml` (the 33.8 KB file
    timed out twice at `apply_migration`'s 60 s limit and applied nothing). **The hold was then seen to fire on production data:** five ZIPs
    with known conflicts held 99 identities and wrote 1 real change. **Still undecided:** an ordinary-run event on
    an identity that later becomes non-comparable stays reportable.
11. ~~Retention and privacy of a brokerage-entered address~~ — **decided by the founder 2026-09-29.** Not permanent
    intelligence; kept only while a report, Follow or account relationship needs it; purged no more than 90 days
    after the last need ends; earlier on a verified privacy request or legal requirement; the permanent record
    survives the purge. Built as F2. **Defaults taken in F2 that the founder may change** (contract §7): distances
    from the subject are private-derived and not stored (D-1); a ZIP stays permanent (D-2); the purge keeps a
    tombstone row with no personal data (D-3); the `report` need stays open until Orders J and L close it (D-4);
    `label` is the one optional free-text field (D-5); unknown private fields are refused (D-6). **Arming the purge
    (go 2026-09-30) is built:** a pg_cron job every 15 minutes and an alertable monitor check
    (`docs/report-private-context-purge-schedule.sql`, contract §13; defaults D-7..D-10). **Still to do before the first
    real report is stored:** the apply and its production receipt, the Follow / Changes Since Report surface, and backups
    are outside this unit.

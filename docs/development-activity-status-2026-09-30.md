# Development Activity — plan status (living document)

Governs with `docs/development-activity-plan-2026-09-30.md` (frozen, sha256
`66257cc790c566c6b25644225899659385b973d8b1e6b02f94f7272a3a92955c`) and
`docs/development-activity-founder-rulings-2026-09-30.md`.

**How to read it.** ~~Struck through~~ = done, and "done" means **merged to `main`**.
Nothing is struck on the strength of a branch, a draft PR or a dry run. Only this file
is edited as work lands; the plan and the rulings are frozen.

Last updated: 2026-09-30, in the PR that records the Order D apply and pilot.

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
6. Durable report snapshot (`report_id` vs `content_hash`) — **open.**
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
- D. National change baseline — **in progress.** Driver, per-ZIP cursor with a capacity gate, and the
  per-source evidence view are merged (#1463, `a952139`), applied to production 2026-09-29 18:11Z (migration
  `dev_change_baseline_d1_20260930`) and fingerprint-verified; a nine-ZIP pilot measured storage (1,968 B per
  identity) and time (~0.29 ms per row; the two largest ZIPs 3.5 s and 5.8 s). Receipt: design doc §9. Not
  struck until the baseline run over the 12,722 ZIPs has completed. The run needs the operator's verified
  free-disk figure (decision 7 below); a development source can be labelled only ERROR or UNKNOWN until
  the two gaps in decision 8 close.
- ~~E. Change-detection tests~~ — **done with C** (all 11 cases, `test/dev_change_ledger_pg/`; map in
  the design doc §4). One case is proven only in part, and stays so until sources supply proven
  identifiers: linked source rows of one project are proven for ZIP copies of a record, not for
  cross-record lineage.
- F. Durable `report_id` + `content_hash` — open.
- G. Deploy / smoke the canonical commercial API — open (national path required).
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
7. **Free disk for the national baseline — and the go to run it.** The database is 17 GB. The pilot
   measured 1,968 B per identity, so the baseline adds about 1.8–2.2 GB live plus write churn. The driver
   refuses to run without the provider's verified free-disk figure (≥ 2,048 MB + the ledger budget).
   Suggested budget 3,500 MB, so the gate needs ≥ 5,548 MB; because WAL is outside the budget I would want
   ≥ ~8.5 GB verified free. Only the founder can read that figure from the dashboard.
8. **Source-health labels — the workbook was supplied 2026-09-29 and settles the definitions, not the gaps.**
   Its contract (Instructions rows 509–580) defines HEALTHY / STALE / ERROR / VERIFIED ZERO / UNKNOWN / N/A /
   PAUSED at (ZIP × feed family) grain and forbids inventing an SLA. For the development family it records
   `SLA_UNDEFINED` and no freshness source field ("`submitted_at` is a filing date"), and the refresh logs
   failures but not successes. So today only ERROR and UNKNOWN can be assigned (its own 2026-09-26 audit:
   17 ERROR, 224 UNKNOWN). Two things are still needed: (a) an approved freshness SLA and a source-controlled
   freshness field for the family — a product decision; (b) per-source success logging in the refresh — an
   engineering change in the refresh's lane. The view exposes the evidence; details in the Order D design doc §8.
9. **A recurring observation job.** Without one the ledger never detects a change after the baseline.
   Arming a `pg_cron` job is a new scheduled job and waits for a go.

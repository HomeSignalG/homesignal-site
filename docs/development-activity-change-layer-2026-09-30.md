# Development Activity — Order C: the change ledger (2026-09-30)

Plan reference: `docs/development-activity-plan-2026-09-30.md`, Immediate Product Execution
Order **C** ("Build the smallest universal durable observation/delta layer"), Master
**Step 3A**. SQL of record: `docs/dev-change-ledger.sql`. Executable proof:
`test/dev_change_ledger_pg/` (33 checks, 21 prohibited mutations) and
`test/dev-change-ledger-structure.test.mjs` (29 pins, 14 breakages checked).

Founder rulings in force: `docs/development-activity-founder-rulings-2026-09-30.md`
(R1 regulatory is an overlay · R2 four lifecycle keys · R3 no "What Exists Today" ·
R4 rights from the existing audit · R6 legacy NYC is history).

## 1. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- **Canonical truth path:** publisher connectors → `dev_sites_deduped` → `app_refresh_zip` →
  `public.app_projects` → **`dev_change_observe_zip` (the only writer)** → the ledger →
  the report reader (later units).
- **Decision owners — none duplicated:**

  | question | owner | how the ledger uses it |
  |---|---|---|
  | which record is this? | `public.app_source_key` / `app_source_key_basis` | keyed on `source_key`; adds no key |
  | what Type is it? | `lib/project-type.js` (read time) | stores the raw `type`/`type_raw`; no classifier |
  | what lifecycle is it? | `lib/project-type.js` `HS.canonicalLifecycle` (read time) | stores the raw `status`; no lifecycle key (R2) |
  | denied / withdrawn? | `supabase/functions/get-address-report/sources/decision.ts` | records a status change with before/after; never classifies it |
  | may we show this source's content? | `docs/corporate-output-source-rights-audit-2026-09-27.md` | `rights_class` stays NULL; enforced at report time (R4) |
  | is the durable-key rule right? | ingest `NON_DURABLE_BASIS` | same rule, pinned equal |
- **Shortcut check:** searched `origin/main` for any existing ledger (none); rejected diffing the
  Development SEO plane JSON (featured-only, no prior values, ingest-owned) and diffing on
  `last_seen_at` (a ZIP-refresh clock — measured). No FSR/NYC path, no per-city or per-source
  code, no second classifier.

## 2. What was built

Three tables, all `dev_change_*`, RLS on, no grant to anon/authenticated/PUBLIC, `service_role`
only what it uses:

- **`dev_change_project`** — one row per record (`identity_key = source_key`): current declared
  facts and fingerprint, `first_observed_at`, `last_observed_at`, `observation_count`, the
  ZIP pages it appears on (an attribute, not identity), `comparable` and why not, and
  `change_ready` (generated: comparable **and** at least two observations — the Step 3A cold-start
  rule, per record).
- **`dev_change_event`** — append-only (triggers refuse UPDATE, DELETE, TRUNCATE): prior facts,
  new facts, both fingerprints, changed fields, the retrieval instant, the publisher's own event
  kind/date, `derivation_version`, `facts_version`, `run_id`, `rights_class` (NULL).
- **`dev_change_run`** — one row per pass, with exact counters.

Functions: `dev_change_facts`, `dev_change_fp`, `dev_change_key_is_durable`, `dev_change_classify`
(pure, versioned), `dev_change_start_run` / `_finish_run`, and **`dev_change_observe_zip(zip, run)`**.
The event vocabulary is exactly `first_detected`, `status_changed`, `source_record_updated`,
enforced by a CHECK constraint.

## 3. The rules, and the measurement behind each

| # | rule | why (measured 2026-09-29, `docs/development-activity-audit-b-identity-lineage-2026-09-30.md`) |
|---|---|---|
| 1 | A change is a difference in a **declared 14-field list**, never in a whole row. | Every re-collection of a ZIP rewrites every row of it (`provenance.refreshed_at` is inside the row comparison; 34.39% of rows written in 24 h, 100% in 7 days). |
| 2 | Observations are ordered by **retrieval time**; an older copy never moves a record backwards. | 5,782 of 14,455 sampled records (40%) sit on several ZIP pages; **46 of 46** disagreeing copies were read at different times, none at the same time. |
| 3 | Only the **publisher's own** `stage` / `date_kind` change is a material status change. A change in derived `status` / `type` alone is `source_record_updated`. | Classifier or parser changes must not read as real-world change (Step 3A). |
| 4 | **Absence is never an event.** A missing row, an outage and a reappearance emit nothing. | Step 3A: a record disappearing is not withdrawal; an outage is not "no project". |
| 5 | **Comparable** = durable key basis AND alone under its key on its ZIP; sticky once false. | 221,167 rows (7.05%) carry `source_seq > 1`, ordered by `md5` of their content; 6,878 rows (0.22%) use a row-number or title key. |
| 6 | **Change-ready is per record**, never per city. | Plan Order D. |
| 7 | Facility (regulatory) rows are not development changes. | Ruling R1. |
| 8 | A fact-definition change (`facts_version`) re-baselines silently; a future-stamped retrieval time is not an observation. | A classifier change is not news; a bad clock must not lock a record out. |

## 4. Order E — required cases → checks

| Order E case | check |
|---|---|
| same record, no change → no event | C02, C16 |
| same project on several linked rows → one project | C12a, C12b (ZIP copies) — see §5(b) for cross-record lineage |
| status changed → one preserved before/after event | C03 |
| new record → first detected, not "approved" | C04, C08b |
| source outage → no deletion/cancellation | C05 |
| successful fetch missing a prior row → no cancellation | C06 |
| parser/classifier change → no fake real-world change | C07, C17 |
| withdrawn/denied → existing decision authority | C08a, C08b |
| source reappears → no fake first detection | C09 |
| duplicate/retried fetch → no duplicate event | C10a, C10b |
| technical metadata edit → no hero alert | C11 |

Added from the audit: C13 (siblings), C14 (non-durable keys), C15 (facility rows), C18
(future-stamped time), C19–C21 (append-only, lock-down, shape), C22–C25 (readiness, counters,
closed runs, no stray fact keys).

## 5. Deliberately NOT in Order C

a. **Stronger events** (`permit_issued`, `construction_started`, `approved`, …). The vocabulary
   refuses them (C08b). Adding one needs a reviewed exact-string map per source and, for
   denied/withdrawn, output from `decision.ts` — 579 distinct `stage` values exist; inferring
   from them would be "stronger events from weaker evidence". The decision carrier
   (`docs/decision-provenance-migration.sql`) is still parked.
b. **Cross-record lineage** (filing → approval → permit rows of one project). The audit found no
   table and no source-proven identifiers; Step 3A says to keep such records separate until
   identifiers prove otherwise. Order E's "multiple linked source rows" case is proven here only
   for the ZIP copies of one record.
c. **Source health, freshness, the batch driver, the cursor and the national baseline run** —
   Order D. `observe_zip` is idempotent per ZIP and ready to be driven.
d. **The reader and any customer copy** — later units. Reading rule for them: a record is a
   "What Changed Recently" candidate only if `change_ready` and the event is `material`; otherwise
   the report says **Recent Official Activity** (Step 3A).
e. **The `Decided` lifecycle mismatch** — flagged in the audit, not changed.

## 6. Known limits (stated, not hidden)

- At most about 92% of development records can ever be change-ready (the sibling and
  non-durable exclusions, from the audit sample). The exact share is what Order D's baseline measures.
- A source whose `stage` is a constant label (e.g. an issuance ledger) exposes no publisher
  status, so it can show new records but never a status change — honest, not a defect.
- `first_observed_at` is the retrieval instant of the first observation the ledger *received*;
  during a national baseline (ZIPs are read up to ~53 h apart) it can differ from the earliest
  read of that record by up to one sweep.
- 46 of 5,782 multi-ZIP records disagreed between copies in the sample; rule 2 handles them,
  and the cause is *consistent with* read-time skew, not proven to be the only one.
- Through PostgREST the authenticator's 8 s `statement_timeout` applies. The production canary took
  28–33 ms for ZIPs of 41–123 rows; the largest ZIP (28451, 14,664 rows) was **not** timed, so
  whether it fits under 8 s is unmeasured. Order D's driver should call the function from a direct
  database connection or pg_cron and measure the largest ZIPs before relying on REST.

## 7. Apply and rollback

Additive only: three tables, functions, triggers; alters and writes no existing object.
Apply `docs/dev-change-ledger.sql` as one migration (`dev_change_ledger_c1_20260930`). It refuses
if `app_projects` lacks a column it reads. Rollback: the `ROLLBACK` block at the foot of the file
(drops only its own objects). Verified in Postgres 16 and (CI) 17; idempotent (applied twice in
the harness).

## 8. Production receipt (2026-09-29)

**Applied 17:20Z** as migration `dev_change_ledger_c1_20260930` (ledger version `20260929172018`),
from the file on `main` (sha256 `be5f2ac49776e675…`, 23,671 bytes, byte-identical to what CI tested).
Preflight beforehand: Postgres 17.6, roles present, no `dev_change_*` object existed, every column the
SQL reads present, default ACLs equal to the ones the test fixture emulates.

**Verified by fingerprint, not by eye.** `md5(prosrc)` and length of all 10 functions equal the values
computed from the file before applying (for example `dev_change_observe_zip` `17b45b9c4b93` / 8,074
chars; `dev_change_classify` `0f75659fcc47` / 422). Also read back: 3 tables, RLS on all three, both
append-only triggers, no privilege of any kind for anon/authenticated/PUBLIC on the tables, sequence or
any function, `service_role` limited to select+insert on events, all three tables empty before the
canary, `app_projects` unchanged (3,136,783 rows, normal refresh churn).

**Canary** (run `93776308-b470-4721-98a8-f4f68cc03bc7`, flagged `canary` in its detail; two ZIPs,
baseline-flagged; it is **not** the national baseline). Expected values were computed independently from
`app_projects` first; the ledger's answers equalled them exactly:

| ZIP | rows | identities | with siblings | expected events | actual events | time |
|---|---:|---:|---:|---:|---:|---:|
| 84302 | 41 | 36 | 5 | 31 | 31 | 28 ms |
| 19475 | 123 | 112 | 6 | 106 | 106 | 33 ms |

A **second pass** over both ZIPs wrote 0 events, 0 new identities and 0 accepted observations
(idempotent in production). Final state: 148 identities (137 comparable, 11 `sibling_records`), 137
events, all `first_detected`, all baseline, none material, none on a non-comparable record, one per
identity, `change_ready` = 0 everywhere (cold start, as the rule requires).

These 148 identities and 137 events are real baseline rows and stay; Order D continues from them.

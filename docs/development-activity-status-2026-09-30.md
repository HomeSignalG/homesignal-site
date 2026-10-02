# Development Activity — plan status (living document)

Governs with `docs/development-activity-plan-2026-09-30.md` (frozen, sha256
`66257cc790c566c6b25644225899659385b973d8b1e6b02f94f7272a3a92955c`) and
`docs/development-activity-founder-rulings-2026-09-30.md`.

**How to read it.** ~~Struck through~~ = done, and "done" means **merged to `main`**.
Nothing is struck on the strength of a branch, a draft PR or a dry run. Only this file
is edited as work lands; the plan and the rulings are frozen.

Last updated: 2026-10-02, in the docs PR that records the production apply of K0, J1, M0 and L1 on the founder's "go" (receipt: the "Applied to production" entry under Order M; the J, K, L and M entries keep their dated pre-apply text, each with an APPLIED note at its front, so a line below that says "not applied" is the text from before that apply, not the state); before that 2026-10-02, in the Order M step M0 PR (a payment-event ledger, built and not applied; Order M stays open); before that 2026-10-01, in the PR for Order K0 (the brokerage account spine: built as parked SQL, **not applied**). Before it, in the receipt PR for the Follow / Changes Since Report function (#1516, merged `5937254`; deployed 22:31–22:32Z: `follow-development-report` v1 and the refactored `get-development-activity-report` v2; anon-key refusals and capability reads verified live; **no signed-in call made**, follow doc §9). The receipt of the recurring observation job (#1512, applied 17:53Z, first monitor tick ok at 18:10Z) is merged (#1514); the receipts of the purge schedule (#1502) and of ledger option (b) (#1506) are merged (#1509).

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
   **Fixed 2026-10-01 (go given):** `lifecycleKey` and the card-bar `statusKey` now read `Decided` as proposed, like `n5BucketFromStatus`
   already did; `test/decided-lifecycle-parity.test.mjs` holds the three rules together (19,364 rows measured that day).
   What changes for a resident is narrow: the left bar of a decided application's card takes the Proposed colour instead of an
   impact-score colour, and the national report groups it with Proposed instead of Lifecycle unknown. Map 1's ZIP-mode pin was already
   proposed. The wording "Decided" printed bare on `development.html` is **not** changed here (named, not fixed).
   **Redeployed 2026-10-01 22:56Z:** `get-development-activity-report` v2 → v3 carries the regenerated lifecycle copy (follow doc §9b).
   `follow-development-report` bundles the same generated file but stores a report's lifecycle as stored, so it was not redeployed.
6. Durable report snapshot (`report_id` vs `content_hash`) — **storage layer done (Order F);** the
   customer-facing use of it waits for Orders G, J and L.
7. Secure share + print/PDF + disclosure + audit trail — **open.** Its first piece, the share-link primitive (Order J, unit J1), is built and
   proven on a disposable Postgres and not applied; the client view, print/PDF, disclosure and the audit trail with actor and brokerage are not started (J1 carries only a two-kind share-event log with no actor).
8. Agent Workspace + Brokerage Admin — **open.**
9. Canonical commercial property-intelligence API — **open.** One generation path, and it
   must be national: the only report engine in the tree today answers NYC addresses.
10. ZIP/address coverage truth for the 12,722-ZIP universe — **open.**
11. Autonomous 20-report brokerage evaluation — **open.** The credit rule for
    insufficient quality is an open founder decision (R5). Its database layer (Order L1) is built, not applied, not wired.
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
  (gate 5, arming the purge, is applied and reading ok — contract §13; gate 4, the Follow / Changes Since Report function, is built, proven end to end on a disposable Postgres (stand-ins stated in its doc §6), and **deployed** (its refusals and capability verified live), but **no signed-in call has been made in production, so its production answer is unproven** — `docs/development-activity-follow-changes-2026-10-01.md` §9; the open parts of gates 1 and 2 are stated limits, not unbuilt features; gate 5's open part is only that no real due context has yet been purged in production).
  `docs/development-activity-report-engine-2026-09-30.md` records what was found and built: the plan's "canonical
  commercial API" (NYC-only) was **never deployed**, so this builds the national path (`get-development-activity-report`,
  JWT on, plus a signed-in allow-listed user because the anon key passes the gateway). **It stores nothing, and it shows a
  source's records to a customer only if that source is on a written clearance list, which is empty** — so today every
  customer report is LIMITED COVERAGE with no records, and the internal view is the only one that shows records (labelled
  HOLD, never storable). Proof: 117 + 85 + 64 offline checks, 28 checks storing the engine's real output through the real
  Postgres writer, 109 mutations all killed *(59 structural checks and 107 mutations when it deployed; the Follow change moved the gate, the reads and the change rule into shared modules, so the structural suite and the harness were re-pointed and extended; the two behavioural suites are unchanged)*. **Not built, by design:** entitlement, quota, idempotency and rate limiting
  (Orders H, L, M), the "Things to Review" section, per-ZIP source-applicability measurement.
- G2. Follow / Changes Since Report — **built and proven end to end on a disposable Postgres (the transport, the sign-in and allow-list, the rights registry and the ingest-side failure table are stand-ins; its doc §6 lists them); deployed 2026-10-01 (#1516, `follow-development-report` v1, national function v2), with the anon-key refusals and both capability reads verified live. No signed-in call has been made, so G2 is not struck.** This file's rule is that struck means merged; G2 was held back until it was also deployed and smoked, and it is now held back only on the one thing the smoke could not do: an allow-listed admin's call (follow doc §9). `follow-development-report` (internal, JWT on, plus the admin allow-list) answers what the change ledger has learned about the
  projects **in a stored report** since it was issued, and registers or closes a `follow` need on the report's private context.
  `docs/development-activity-follow-changes-2026-10-01.md`: the boundary in time is the ledger's **recording** time (`created_at`, the instant the recording transaction began) with a
  ten-minute overlap and a removal of what the report already showed, because `observed_at` is the source's retrieval instant and
  would lose events recorded after a report but retrieved before it, and each such answer says so (`recorded_at`, `RECORDED_AFTER_REPORT`);
  the reader has no handle on the private context (the `changes` read selects no private column), so its answer is byte-identical for the
  same clock and ledger state while a Follow holds the context and after a purge. Proof: 73 + 107 + 92 offline checks, 52 checks on a
  disposable Postgres through the real handler and data layer (and 47 on the health views, 34 mutations), 136 mutations all killed.
  One production change was needed and is applied: a narrow `dev_change_source_fetch_health` view (migration `20261001220554`; the wide view is
  built from it with identical output, proven in the migration's own transaction), because the reader's source-health read took 6.1–6.2 s
  against PostgREST's 8 s timeout and now takes about 0.1–0.2 s (follow doc §6b). The gate, the ledger reads and the change rule are
  shared with the national report (one definition each), and the national function was refactored onto them with its two behavioural suites
  unchanged (its structural suite and harness were re-pointed at the shared files).
  **Defaults the founder may change:** D-F1 internal-only until accounts exist; D-F2 a Follow is an opaque need whose id the caller chooses
  and keeps (required, a random version-4 UUID; the function mints none); D-F3 the overlap is ten minutes, pinned to at least twice the observation job's longest transaction; D-F4 a purged report cannot be followed again; D-F5 unfollow answers `UNFOLLOW_REQUESTED`, not "done". **Not covered, and the answer says so:** projects that
  appeared near the property after the report. **Not built:** notifications, ownership of a Follow (Order K).
- H. Remove the quota bypass — **open. First step is in the PR that merges this file: the customer surface is retired; the onto-the-canonical-path half waits on K and L.**
  The legacy browser-direct NYC page `future-surroundings-report.html` leaves the production artifact (`scripts/stage_site.py`; the page and
  its three libraries stay in the repository, R6), so the only shipped browser-side report generator is gone and, after the Pages deploy, anyone holding its old
  URL should get a 404 (inferred from the allowlist contract and `404.html`, **not observed**; reversible by one line; the founder's `?audience=internal` views
  at that URL go with it, which is the audit's founder decision 1, taken at its default and awaiting confirmation). `test/single-customer-generation-path.test.mjs` pins, by content on the real staged artifact, that no shipped
  page loads the browser-direct engine or names `get-future-surroundings-report`, `get-development-activity-report` or `follow-development-report` (16 prohibited mutations,
  each killed by the pin it targets). **Not covered by that pin:** Map 1 address mode (`get-address-report`, `verify_jwt=false`), which is the audit's founder decision 2.
  **Not done, and why H is not struck:** no customer identity, entitlement, quota, idempotency or rate limit exists, so nothing authorizes a customer
  on the national path (Orders K, J and L); the rights registry is empty, so a customer report there is LIMITED COVERAGE with no records; and
  retiring the page rather than keeping it as an internal surface is the audit's founder decision 1 taken at its default and awaiting confirmation.
  Design, decisions and receipt: `docs/order-h-retire-legacy-generator-2026-10-01.md`.
- I. Redesign the report, only after the data contract is proven — open. **Step 1 built 2026-10-02, no caller, nothing struck:** `lib/da-report-view.js`, a pure presentation module that renders the national engine's own response in the approved section order (only sections with data), proven offline against the real handler's output (`docs/development-activity-report-view-2026-10-02.md`); no page loads it, so nothing a customer sees has changed. Not built: Things to Review, the map, Permitted / Under Construction, the action bar.
- J. Secure stored-report delivery — **open. J1 APPLIED to production 2026-10-02** (founder "go"; run `37015952315`; receipt under "Applied to production" below; the J1 sentences that follow are the dated text from before the apply, so "NOT applied" in them is no longer the state). Split (audit 2026-10-01): **J1** the share-link primitive now; **J2** the read-only client view,
  disclosure and print, after Order I; **J3** the audit trail with actor and brokerage, after Orders K and L. **J1 is built and proven on a
  disposable Postgres, and is NOT applied to production, has no caller, no endpoint and no page, and changes nothing a customer, resident or the
  founder can see** (`docs/report-share.sql`, `supabase/functions/_shared/report-share.ts`; design, proof and limits in
  `docs/report-snapshot-contract-2026-09-30.md` §8). It means: a table of share links that stores only the SHA-256 of an opaque 256-bit token (the
  database never sees the token, so a lost link is revoked and reissued, never recovered); optional expiry computed at read time; revocation that
  can never be undone and an expiry that can never move; one function that decides whether a link is usable (`report_share_resolve`: ACTIVE,
  EXPIRED, REVOKED, UNKNOWN, revoked beating expired, the report handed back only for ACTIVE); an audit log with two event kinds and no free text,
  IP address, user agent or actor; and a share that survives a purge of its report's private context. **Not struck:** J1 completes none of Order
  J. **Open and not answered by J1** (founder, privacy and legal calls; §8.6): what ends a stored report's `report` need (so its 90-day clock can
  start); whether a client who opens a link sees the subject address while the context is active; what client-view events may be recorded;
  the label policy; print/PDF and the default share expiry. The legacy NYC page's raw-address share URL is untouched (R6).
- K. Agent Workspace + Brokerage Admin — open. **K0 APPLIED to production 2026-10-02** (founder "go"; run `37015869854`; receipt under "Applied to production" below); the sentences that follow are the dated text from before the apply, so "NOT applied" and "no go ... is recorded" in them are no longer the state. **K0, the first safe step, is built and is NOT applied** (account spine built, not applied; no go to apply it to production is recorded). `docs/brokerage-account-spine.sql` (parked SQL of record, rollback at its foot) adds `public.brokerage_account`, `public.brokerage_member` and the one resolver `public.brokerage_membership_of(user_id)`: an explicit membership of a Supabase Auth user in one brokerage, as owner or agent, with one active membership per user, closed vocabularies, and a last-active-owner guard. The tables are empty and unreadable by anon, authenticated and service_role (the `dashboard_admins` posture) and are reached only through the resolver; they hold no address, label, client, email, credit, quota, price or invite token; nothing reads or writes them, and no gate, edge function or page changed (`_shared/admin-gate.ts` still answers from `dashboard_admins`). Proof: `test/brokerage_account_pg` (suite, an owner race between two sessions, a second apply, a poisoned state, 59 prohibited mutations), `test/brokerage-account-structure.test.mjs`, `test/brokerage_account_mutants.py`; design, the six defaults D-K1..D-K6 the founder may change, and what the rest of K needs from J and L: `docs/development-activity-agent-workspace-2026-10-01.md`. **Not built, and not buildable yet:** the Agent Workspace and Brokerage Admin surfaces, agent invites, usage and "reports remaining", recent reports across devices, ownership of a Follow, share and audit trail, and the plan control — they need report ownership (Order J) and entitlement and quota (Orders L and M).
- L. Evaluation build and security tests — open. **L1 APPLIED to production 2026-10-02** (founder "go", after K0; run `37016093353`; receipt under "Applied to production" below); the sentences that follow are the dated text from before the apply, so "NOT applied" and "no go ... is recorded" in them are no longer the state. **Founder ruling, same day: a free evaluation report does not count toward a paid subscription** (see the receipt entry for what that is read to mean and what it does not settle). **L1, the database layer, is built and is NOT applied** (database layer built, not applied, not wired; no go to apply it to production is recorded, and it hangs off K0's account spine, which must be applied first). `docs/evaluation-entitlement.sql` (parked SQL of record, rollback at its foot) adds four tables hung off `public.brokerage_account` (one evaluation per account; a hashed, one-time, expiring invite; an append-only credit ledger whose `ordinal` primary key and CHECK make the 20-report cap hold by constraint at any isolation level; an append-only event log) and thirteen system-only functions: create the account, its evaluation and its first owner invite in one transaction; mint, redeem and revoke an invite (the redeem function is now the writer of `public.brokerage_member` and honours every K0 rule: one active membership per user, owner and agent, and it never updates or removes a membership); and `evaluation_report_issue`, which locks the evaluation, answers a retried key with the stored report at no charge, refuses report 21 with `EVALUATION_COMPLETE`, calls the existing `report_snapshot_issue` in the same transaction (so a refusal rolls back and costs no credit) and appends the ledger row. Used credits are the count of ledger rows; no address, address hash, property key, client, label, email, user id (but the invite's redeemer, cleared with the account) or free text is held anywhere. Nothing reads or writes it: no gate, edge function, page or schedule changed, and `public.subscriptions` is untouched. Proof: `test/evaluation_entitlement_pg` (a suite, real concurrent sessions at READ COMMITTED and the cap at REPEATABLE READ and SERIALIZABLE, a second apply, a poisoned state, the rollback, and the prohibited mutations), `test/evaluation-entitlement-structure.test.mjs`, `test/evaluation_entitlement_mutants.py`; design, the eight defaults D-L1..D-L8 and the open founder decisions: `docs/development-activity-evaluation-2026-10-02.md`. **Not built:** the handler that calls it, the admin or self-serve signup, the workspace's "reports remaining" read, ownership of a report (Order J), and paid continuation (Order M). R5 (does a limited-coverage report cost a credit) stays open: the caller decides when to call the issue function.
- M. Paid continuation path — **open. Step M0 is APPLIED to production (2026-10-02**, founder "go" to apply all four; run `37016041571`; **applied before the captured payload that contract §11 asked for, with provisional columns; see the receipt entry below**). The sentences that follow are the dated text from before the apply, so "NOT applied" in them is no longer the state. **Step M0 is built and NOT applied (2026-10-02, this PR); M itself stays open.** `docs/development-activity-paid-continuation-2026-10-01.md` is the contract (the canonical path, the ten gaps in the deployed
  webhook, the proposed entitlement states marked as defaults, and every open founder decision), and `docs/payment-event-ledger.sql` is a payment-event ledger as SQL of record: an append-only record of billing-processor events with one idempotency rule,
  one ordering rule and a closed status mapping (a status the map does not know is `unknown`, never `active`). **It decides no entitlement, writes to no entitlement or subscriptions table, has no caller, and the deployed webhook in `homesignal-ingest` is
  untouched.** Nothing a customer or resident sees changes; the landing page's commerce buttons stay inert. Its key, time and catalogue columns are **PROVISIONAL**: the processor's real payload has not been captured, so applying it
  waits for that and for a founder go. Proof (disposable Postgres 16 locally, 17 in CI by `payment-event-ledger-suite.yml`): 55 database checks and 41 prohibited mutations of the SQL, all killed; the file applies twice with an identical result, its rollback is exact, and two concurrent sessions agree; 59 structural pins, each turned red by at least one of 63 mutations; the landing-page tripwire and the report-snapshot and private-context suites stay green (contract §10, with what was not exercised). **Still missing before M can complete:** Order L (the evaluation/brokerage account and the one entitlement function this ledger feeds), Order H (the gate that
  reads entitlement), Order K (the Billing tab), a checkout, a processor store and one real test-mode payload, counsel-reviewed commercial terms, a cleared source family, and the founder's decisions on the offer and on failed-payment and cancellation behaviour
  (contract §8–§9).
- **Applied to production, 2026-10-02: K0, J1, M0 and L1 (founder "go"; the choice put to the founder was "apply all four, in order").** Nothing is struck: K, J, L and M stay
  open, and nothing calls any of the new functions, so no resident, customer or founder sees a change.
  - **How, and against what.** Each file was run from `main` `eb33f50` through `db-sql.yml`, which sends the committed file text to the Management API, so the text applied is the file
    on `main` and not a copy typed into a tool call. In order: K0 run `37015869854` (created 13:51:58Z), J1 `37015952315` (13:52:41Z), M0 `37016041571` (13:53:28Z),
    L1 `37016093353` (13:53:56Z), each read back before the next. A read-only check just before: none of the nine tables and no `evaluation_%`, `brokerage_%`, `report_share%`
    or `payment_event%` function existed; `report_snapshot` and `report_snapshot_issue(text,text,text,jsonb,jsonb)` were present; the `postgres` role can read `auth.users`;
    PostgreSQL 17.6. This path writes no row to the migration ledger, so `list_migrations` will not show these four; the committed files at `eb33f50` are the record.
  - **Read back, per file.** Every function body in production is md5-equal to the body in the committed file: K0 2 of 2, J1 5 of 5, M0 8 of 8, and for L1 the 13-function
    fingerprint `md5(string_agg(name || ':' || md5(prosrc), ',' order by name collate "C"))` is `a192907348a6601223f3d0ae653df2e5` on both sides. All nine tables exist with row level
    security on, **no policy, and zero rows** (K0 0/0, J1 0/0, M0 0, L1 0/0/0/0). Grants on the tables are as each file states: K0 and L1 none to any role but the owner; J1 and M0
    `SELECT` to `service_role` only. The functions are executable by `service_role` alone, and no function is executable by `anon` or `authenticated` (checked on every K0, J1 and M0
    function and on all 13 of L1's). `public.subscriptions` and `report_snapshot` read 0 rows when checked after the applies (no row was written to either; their counts before were not
    read).
  - **Security advisor, read after the applies.** 9 `rls_enabled_no_policy` (INFO) on the nine new tables, which is the system-only posture by design (the existing `report_snapshot` shows
    the same finding, the control for the filter). 4 `function_search_path_mutable` (WARN) on `report_share_guard`, `report_share_event_immutable`, `payment_event_immutable` and
    `evaluation_report_limit`: helper and trigger functions that are not `SECURITY DEFINER` and not executable by `anon` or `authenticated`. **Recorded, not changed**: fixing them is a
    reviewed SQL change, not a tidy-up. No `anon_` or `authenticated_security_definer_function_executable` finding names a new object.
  - **M0 was applied before the captured payload its own contract asked for.** `docs/development-activity-paid-continuation-2026-10-01.md` §11 said applying needs a founder go **and,
    first, a captured payload (§5)**, because the key, time and catalogue columns are PROVISIONAL and the table is immutable. It was applied on the "apply all four" go without that
    capture, and the question put to the founder did not name the condition. That was a miss on this side. The cost is bounded: the table is empty, nothing writes to it, and its rollback
    block is exact while it holds no row. **Until the processor payload is captured and the provisional columns are confirmed (or the table is dropped and recreated), no writer may be wired
    and no event recorded.**
  - **Founder ruling, 2026-10-02 (verbatim: "free report does not count toward a pid subrsciption"): the free evaluation reports do not count toward a paid subscription.** Read as: the 20
    free credits are the evaluation's own and are never counted against, or deducted from, a paid subscription's allotment (contract §8.1's "whether the 20 free credits count toward it" is
    answered **no**). That matches L1 as built: `evaluation_credit` belongs to the evaluation and nothing in it reads or writes paid usage. For Order M it means paid usage is tracked in
    its own ledger. **Not settled by it, and not read into it:** rollover, R5 (does a limited-coverage report cost a free credit), and whether a free report counts as paid redistribution
    for the source-rights audit (`docs/development-activity-evaluation-2026-10-02.md` §7.6, a different question). Those stay open until the founder says otherwise.
  - **Not exercised:** no function was called on production and no row was written (behaviour is proven on disposable PostgreSQL 16 locally and 17 in CI, not on production); the
    `performance` advisor; API-gateway request logs (the database's own settings were read: `log_statement = ddl`, `log_min_duration_statement = -1`,
    `log_parameter_max_length_on_error = 0`, so a function-call argument is not statement-logged, but a handler's request log is a separate question for the handler PR).
- **Open event counter found in production, 2026-10-02 (read-only); the fix for this layer's one is parked and NOT applied (it needs its own go).** Of the 33 identity or serial
  sequences in `public`, 5 are usable (`USAGE`, `SELECT` or `UPDATE`) by `anon` and `authenticated` while the table each belongs to is closed to them. One is this layer's:
  `report_private_context_event_event_id_seq`, from the privacy layer applied 2026-09-29, whose lock-down covered the three tables and the functions and never named the counter.
  The other four belong to other workstreams and are **not touched here**, only named for their owners: `dc_acquisition_run_run_seq_seq` (the data-centre pipeline),
  `local_news_geo_migration_rows_id_seq` (Local News), `maps_dc_generation_request_id_seq` (the MAPS dashboard) and `source_document_events_event_id_seq` (the government source
  archive). The Order J, K, L and M layers applied today are not among the five (their files revoke their counters by a computed loop, which is the pattern to copy).
  - **What it could do, without inflation.** `UPDATE` on a sequence is `setval()`: a role that could call it could push the counter to its maximum and make every later insert into the
    audit log fail, which here includes private-context creation and purge; `USAGE` is `nextval()`, which burns ids. **I know of no REST route to either** (PostgREST does not expose
    sequences and `pg_catalog.nextval` is not in an exposed schema). That was **not tested end to end**, because a successful test would itself move a production counter. A hardening gap, not a known exposure.
  - **The fix and its proof.** `docs/report-private-context-sequence-lockdown.sql` revokes every privilege on the sequence(s) owned by a `report_private_context*` table from PUBLIC,
    `anon`, `authenticated` and `service_role`, found through the dependency catalogue (so a later sequence on the layer is covered), and refuses to run if the table is absent, refuses to report
    success if it found no sequence, and refuses if any non-owner grantee remains. Every writer is a `SECURITY DEFINER` function owned by the owner, so no writer changes. Proof on a disposable
    PostgreSQL 16: `test/report_private_context_pg/sequence_lockdown.sh` reproduces the gap first (the three roles and PUBLIC can use the counter, and `anon` `nextval` and `authenticated` `setval`
    succeed), then shows it closed, a definer writer still creating a context and its audit event, a later sequence on the layer closed, an unrelated sequence untouched, a second apply a no-op, both refusals; 25 checks
    and 10 prohibited mutations, all killed. `test/report-private-context-sequence-lockdown-structure.test.mjs` pins the file's shape. **Not exercised:** the file on production (nothing applied), PostgreSQL 17 locally (CI runs 17).
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
4. ~~**`Decided` lifecycle mismatch** (above): the fix changes what residents see on
   existing surfaces, so it is not made without a go.~~ Go given; fixed 2026-10-01 (see item 5 above).
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
   Go given 2026-09-30; decision 10 (option (b)) is applied, so an ordinary run no longer announces disagreements
   between ZIP copies. **Built and APPLIED 2026-10-01 (#1512, applied 17:53Z by `db-sql` run `36902655576`; baseline doc §12 and its production receipt):**
   `docs/dev-change-observation-schedule.sql` adds one wrapper (one ordinary run per UTC day, one tick per call),
   the pg_cron job `dev-change-observe` at `*/5 2-7 * * *` UTC, and an alertable monitor check. The schedule comes from
   **a production pilot of the update path** (175 ZIPs through the real tick plus six named ZIPs): every one of the
   12,722 ZIPs is due every day, a pass is 64 calls of 200, and the window must hold at least that many calls (the first
   guess, `*/5 2-6`, held 60 and could never finish). **It keeps clear of the daily `verify-communities` run**, which starts
   at a different time each day (17:10, 17:44, 20:07 and 18:38Z on 09-26 to 09-29), lasts 22–47 minutes, and on 09-29 drove
   the API to 190 statement timeouts on its own: the window ends at 07:59 UTC, before the earliest start (13:17). No hour is
   quiet; it does overlap the 05:30 SEO refresh (both are reads). **The first pilot runs already produced the first 46
   reportable events** (a real highway-plan stage change and 45 in one ZIP). **Live state:** pg_cron job 74 is active, the first monitor tick read `dev_change_observation` ok (18:10Z), and one call made by hand through the wrapper observed 200 ZIPs in 32.3 s and wrote 60 events (reportable events 46 -> 106). **No scheduled run has fired yet; the first is 02:00Z on 2026-10-02.** **Not yet measured:** the first full pass, and its time per call is the open sizing question (this call ran at 1.07 ms a row against the pilot's 0.5 to 0.7).
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
    real report is stored:** the deploy and smoke of the Follow / Changes Since Report function (built 2026-10-01), and backups
    are outside this unit.

# Development Activity — the launch gate (build step 13), 2026-10-04

The plan's step 13, in the founder's words: **"End-to-end launch test, then the Enterprise page buttons go live. A test brokerage runs sign-up, 20 reports,
the end of the trial, payment and a 100-report month."**

## 1. Status — read this first

| | |
|---|---|
| **The end-to-end test** | **BUILT AND GREEN.** `test/launch_gate_pg` runs the whole sequence as one scenario (section 2) through the real handlers and the shipped SQL. **86 checks, all passing: the original 73 (sections 1-14 of the scenario), unchanged, plus 13 (section 15, the report rate limit).** It runs in CI on every change to anything it stands on. |
| **The launch / manual test location** | **Brigham City, UT 84302** (founder, 2026-10-04), defined once in `test/lib/launch-test-location.mjs` and used by every launch-path test and the manual test. It is a *place*, not a source and not a clearance (section 8). |
| **The report rate limit** | **BUILT, NOT APPLIED, NOT DEPLOYED.** `docs/report-rate-limit.sql` + the report function's claim + the page's plain-words message, with its own suites and mutation loops (section 9). Applying the SQL to production and deploying the function are your calls: nothing live has changed. |
| **Step 12 (Utah source requests)** | **STILL OPEN.** No request has been sent and no source is cleared; `report-rights.json` still reads `cleared: []`. A test ZIP does not replace sending the requests or clearing a source. |
| **The Enterprise page buttons** | **NOT LIVE.** Four of the five things that have to be true first are not (section 4). They stay hidden and inert (`<div data-commerce hidden>`, `aria-disabled`), and `test/development-activity-landing.test.mjs` still fails if one becomes visible (evidence in section 11). |
| **Step 13 in the checklist** | **STILL OPEN, not struck.** The checklist strikes a step only after the work is merged, deployed and read back live. Lemon Squeezy account creation, the product, the webhook, the secrets and a real payment test are **deferred, not done**; the buttons are not live. |
| **Any payment made** | **None.** No request has ever reached Lemon Squeezy from this build. The processor in the gate is a stand-in that records what it was sent. |

## 2. What the gate runs

One brokerage, one scenario, in this order. Every request goes through the real request handler and the real data layer of the function a customer or the
processor would reach (`development-activity-trial`, `get-development-activity-report`, `manage-billing`, `development-activity-billing-webhook`), against a
fresh disposable Postgres that has had every layer the product stands on applied in the order production applied them. The only translations are the
network (a request the data layer would send to PostgREST is run as the same database function call through `psql`; a refusal comes back as PostgREST returns
it) and the processor.

1. **Sign-up.** An admin creates the test brokerage's trial; the owner opens the invite link; the owner invites an agent; the agent joins.
2. **Before payment.** The plan reads "none"; an owner is offered a checkout, an agent is told to ask the owner, a person with no brokerage gets nothing.
3. **Twenty free reports**, made by the owner and the agent in turn. The twentieth ends the trial. The free ledger is 1 to 20 with no gap; no paid credit exists.
4. **The end of the trial.** The 21st report is refused (403 `evaluation_complete`) *before* any work: the issue function is never asked, nothing is stored, nothing charged.
5. **Checkout.** Only the owner; refused with the processor never contacted for an agent, an outsider or an unconfigured server; a processor outage is
   a plain 502. The request the processor is sent is read byte for byte: its endpoint, the store and the $79 variant, a live checkout, the brokerage's
   id **with a signature only this server's secret can make**, a return address that only brings the person back, and no email. Asking changes nothing in the database.
6. **A test-mode payment** (the founder's own test) is recorded and **grants nothing**: the plan reads "test only", the 21st report is still refused, no paid credit exists.
7. **The webhook refuses what it cannot trust.** No signature, a wrong secret and a made-up signature are 401 and record nothing. A correctly signed event that
   names another brokerage with this brokerage's signature, one with no binding, one for another product's variant, an order event: none is acted on. A malformed
   signed event is refused loudly (422), never guessed at.
8. **The live payment.** The subscription is bound to the brokerage and the plan becomes paid: a month of 100, none used (the 20 free reports do not count toward
   it). The processor retrying the delivery is a duplicate. A second checkout is refused (409) with the processor not contacted: nobody is billed twice.
9. **A hundred paid reports** (21 to 120), by the owner and the agent in turn, each reported as a paid one with the month's figures and the free trial untouched. A retry of the same request returns the same report and charges nothing. The paid ledger is 1 to 100 with no gap and the reports are numbered 21 to 120.
10. **The 101st** is refused before any work (403 `allotment_complete`); asked directly, the *database* refuses it too; a 101st ledger row cannot be written by any path (the cap is a constraint, named in the refusal). There is no overage and no extra purchase.
11. **Saved reports.** All 120 list in one list (newest first) and open without charging, for the owner and the agent; the other brokerage sees none and cannot open one.
12. **Isolation.** The other brokerage's plan is untouched, its checkout names only itself, and an event naming its brokerage for this brokerage's subscription is refused (409) and recorded nowhere.
13. **Cancellation.** The allotment ends at once (D-11-1); all 120 stored reports still list and open; nothing is deleted; a new checkout is available; an older event arriving late does not undo the cancellation.
14. **The audit.** Every billing invariant reads zero beside controls that are not zero; the processor's key, the signing secret, the checkout address and the owner's email are written in no table of the public schema; no resident role can run a billing function.
15. **The report rate limit** *(added with `docs/report-rate-limit.sql`; sections 1-14 are unchanged)*. A second brokerage, on the real clock and the real wrapper: a member asking quickly is let through up to the person's ceiling and then refused with 429 and the wait in the body and in `Retry-After`; the refusal carries no report, no charge, no address and no brokerage id; the geocoder and the issuing function are asked once per report let through and **never** for the refused one; four more refused requests consume nothing; the agent of the same brokerage is still served; the limited person can still list saved reports; the free and paid numbers are still 20 and 100; once the minute has passed the person is served again; with the limiter unreadable the request is a 502 and the geocoder is never reached (fails closed). *Sections 1-14 clear the limiter's counters before each request* (they make ~140 reports in about a minute to test the **entitlement**, far above the ceiling by design); section 15 does not.

Run it: `bash test/launch_gate_pg/run.sh` with `PGHOST`/`PGDATABASE` pointing at a disposable Postgres (the script refuses any database whose name does not contain
"disposable" and refuses to run if any Supabase credential is present). About 90 seconds (section 15 begins early in a wall-clock minute, which can add up to half a minute of waiting). In CI it is the `launch-gate` job of `report-snapshot-suite.yml`.

## 3. What the gate does NOT prove

Stated plainly, because a green gate reads like more than it is.

- **Nothing was exercised against Lemon Squeezy.** The processor is a stand-in. The field names this build reads from the processor's webhook and checkout answer
  (`meta.event_name`, `meta.test_mode`, `meta.custom_data`, `data.type`, `data.id`, `data.attributes.status` / `updated_at` / `variant_id` / `product_id`, the checkout
  response's `data.attributes.url`) are still the unverified ones recorded in `docs/development-activity-billing-2026-10-04.md` section 6. The gate proves the
  system behaves correctly *given those shapes*. **The founder's test payment is what confirms the shapes**; until it is made, "payment works" is not a statement anyone can make.
- **No payment has been made.** Not a test one, not a live one.
- **The reports are fixture reports.** The gate gives the engine a cleared source and a fixed project record. In production `supabase/functions/_shared/report-rights.json`
  lists no cleared source (`cleared: []`), so a real customer report is "No data ingested" (free, never stored) and cannot be charged. The 20-report trial and the paid
  month cannot yet be exercised on real data, only on test data (step 12).
- **A second month is not here.** The scenario stays inside the first month. The month rolling over (a binding 35 days old has a month 1, with its own 100) is exercised
  by the billing SQL suite (`test/brokerage_billing_pg`), not by this gate.
- **No browser, no email, no live deploy.** The Billing card in Chromium is covered by `development-activity-reports.browser.test.mjs` against the real handler; the
  gate does not drive a page. It does not read production.
- **Concurrency is the SQL suites' job** (two sessions racing for the 100th report, one key sent twice at once, one subscription named for two brokerages at once).

### How we know the gate can see a break

A gate that only passes when everything is right and cannot tell is not a gate. `test/launch_gate_mutants.py` makes one prohibited change at a time to the files the
gate reads — edge functions, shared modules, and the SQL — in a *copy* (the working tree is never edited), against its own disposable database, and requires the gate
alone to fail with a named `FAIL —` line. An unmutated copy runs first as the positive control. A run that only crashes is **not** counted as a kill.

**Record, 2026-10-04.** 28 mutations in four groups: who may start a checkout and when (6), the checkout and the webhook (8), the report function's refusals (4), and the
database — plan state, the cap, numbering, the binding, the lock-down (10). Run it with
`PGHOST=… PGPORT=… PGUSER=… python3 test/launch_gate_mutants.py` against a Postgres it may create databases in.

- **First pass, on the first version of the gate (72 checks): 24 killed, 2 survived, 2 only crashed.** The survivors were real gaps in the gate, found by the loop:
  1. `plan_answer_names_the_brokerage` — the gate checked "no billing answer names the brokerage" on the refusal an outsider gets, which carries no plan at all, so an id
     added to a plan answer passed. It is now checked on the owner's and the agent's status, the checkout answer, a report answer and the webhook's answer.
  2. `order_events_recorded` — the gate's order event also failed the separate "this is a subscription" check, which hid the event-name check behind it. A new check sends a
     subscription-shaped payment notice, which only the event-name check can refuse.
  The two crashes (`complete_trial_reaches_the_issue_function`, `spent_month_reaches_the_issue_function`) were assertions that threw on an answer with no plan field instead of
  failing. They now fail by name, and the gate ends any throw as a named failure with its summary (the loop counts that line as a crash, not a kill).
- **Final pass, on the committed gate (73 checks): the unmutated control passes in full, and 28 of 28 mutations are killed**, each by a named check.
- **What this does and does not say.** 28 breaks along the path are a sample, not every possible break. The layer suites carry the rest (`test/billing_mutants.py`,
  `test/brokerage_billing_pg/mutate.py`, and the trial and report suites); this loop answers a different question — whether the gate, on its own, notices a break in the
  layer it stands on.

## 4. Why the buttons are not live

The plan says the buttons go live after the test. These are what has to be true first, and which are not.

| # | Prerequisite | State |
|---|---|---|
| 1 | The end-to-end test is green | **Done** (this step). |
| 2 | **The $79 product exists in Lemon Squeezy, a second webhook points at `development-activity-billing-webhook`, the four secrets are set, and ONE test payment has been made and its ledger rows checked.** | **Founder action, not done.** Steps: `docs/development-activity-billing-2026-10-04.md` section 5. Until the secrets are set, `manage-billing` answers 503 and the webhook 503: everything fails closed. |
| 3 | **At least one source is cleared for paying customers**, so a report can show projects. | **Founder action, not done.** The Utah requests are drafted and send-ready (`docs/utah-source-requests-send-ready-2026-10-04.md`) and have **not been sent**. Nothing is "pending" until a person sends them. |
| 4 | **What the public "Start with 20 free reports" and "Join for $79/month" buttons DO.** | **A product decision, not made.** See below. |
| 5 | The items the checklist carries as "open before step 13" (kept explicit; the full table with evidence is section 10): **(a) the free-report rate limit — APPLIED and DEPLOYED 2026-10-04 on the founder's go (section 9);** **(b) there is no billing-portal link, so a customer cannot change a card or cancel from the page — OPEN, not built;** (c) the public client link endpoint is not rate-limited — OPEN; (d) an owner cannot list or withdraw invite links or remove an agent — OPEN; (e) `run-property-watch` has no rate limit beyond its private secret — OPEN; (f) an ended or failing watch is not emailed to the agent — OPEN. | **(a) live. (b)-(f) open.** (a) and (b) bear most directly on opening the door to the public: the limiter is live, and there is still no self-service card update or cancellation. |

### The decision the buttons need (D-13-1) — not made here

The commerce buttons are drawn, inert and hidden in four places on the page (four `data-commerce` divs), and **there is nothing for them to call**. That is because the product, as built through step 12, is
*invite-only*:

- A trial is **created by an admin** (`development-activity-trial`, action `create`, admin only) and **joined by an invite link** the admin or the owner sends.
- A checkout is started by the **owner of an existing brokerage** (`manage-billing`); a person with no brokerage gets 403.

So a stranger who presses "Start with 20 free reports" has no function to reach that would give them a trial, and a stranger who presses "Join for $79/month" has no
brokerage to pay for. Making the buttons live therefore means choosing, which is the founder's call:

- **A. Request-and-invite (needs no new code on the server).** "Start with 20 free reports" opens a request form; the founder creates the trial and sends the owner link, exactly as now.
  "Join for $79/month" takes a signed-in owner to the Billing card. Manual: the founder is the gate on who gets a trial.
- **B. Self-serve trial creation.** A new function lets a signed-in person create their own brokerage and trial. That is new code and a new abuse surface. The report rate limit (section 9) is a prerequisite and is now built, but it is **not enough on its own**: section 11 lists what else would have to exist first, and none of it is built.

Either way, **the buttons stay hidden until items 2, 3 and 4 are true**, because a live button that leads to "No data ingested" or to a checkout that cannot complete is worse than no button.

## 5. When the prerequisites are true — the go-live steps

1. Re-run `bash test/launch_gate_pg/run.sh` on `main` (green), and the founder's test payment's ledger rows pass the checks in the billing record section 5 (every `livemode` false, `variant_ref` the product,
   the Billing card says "Test subscription only"). If a field name was wrong, correct `_shared/lemon-billing.ts` and its tests **first**, and update this gate's events to the real captured shapes.
2. Decide D-13-1 (A or B) and build what it needs.
3. Make the buttons call it; remove `hidden` from the four `data-commerce` divs; update `test/development-activity-landing.test.mjs`, which today fails on exactly that.
4. Deploy, then read the live page back from homesignal.net (the buttons visible and doing what D-13-1 says), and only then strike step 13.

## 6. Decisions made in this step (build step 13)

- The gate lives in `report-snapshot-suite.yml` as its **own job** (`launch-gate`), beside `snapshot` and `billing`, so its 70 seconds and its 100-report loop do not share another job's time. It takes no repository secret.
- The processor is a **stand-in that records the request**, and the webhook body it "sends" is built from the custom data of the checkout request the real `manage-billing` handler made, so the binding that ties a payment to a brokerage is exercised end to end.
- The gate uses **fixture keys that say so** ("fixture-…-not-real"); `test/launch-gate-structure.test.mjs` fails on a key or secret in the round trip that does not.
- **Nothing was changed in `homesignal-ingest`'s `lemonsqueezy-webhook`**, and nothing in this repo calls it.

## 7. Files

- `test/launch_gate_pg/run.sh`, `test/launch_gate_pg/roundtrip.mjs` — the gate.
- `test/launch-gate-structure.test.mjs` — its structure: stands on the real layers, answered through an allowlist, reads no environment, runs in CI, says what it does not prove.
- `test/launch_gate_mutants.py` — the mutation loop (manual, like the others).
- `.github/workflows/report-snapshot-suite.yml` — the `launch-gate` and `report-rate-limit` jobs and their path filters.
- `docs/report-rate-limit.sql`, `supabase/functions/_shared/rate-reads.ts`, `test/report_rate_limit_pg/`, `test/report-rate-limit-function.test.mjs`, `test/report-rate-limit-structure.test.mjs`, `test/report_rate_limit_mutants.py` — the rate limit and its proof.
- `test/lib/launch-test-location.mjs`, `test/brigham-city-84302-journey.test.mjs`, `test/launch-location-structure.test.mjs`, `docs/development-activity-manual-test-brigham-city-84302.md` — the test location.

## 8. Brigham City, UT 84302 — the launch / manual test location (founder, 2026-10-04)

"Use Brigham City, Utah 84302 everywhere the launch/manual test location is needed. Do not use Bingham Canyon or ZIP 84006." It is defined once, in `test/lib/launch-test-location.mjs`
(address `20 N Main St, Brigham City, UT 84302`, Box Elder County), imported by the launch gate, the trial round trip, the customer page in Chromium and the journey test below, and
quoted by the manual test (`docs/development-activity-manual-test-brigham-city-84302.md`). `test/launch-location-structure.test.mjs` fails if a launch-path file uses another place.

**What was verified, and with what** (`test/brigham-city-84302-journey.test.mjs`, 28 checks; the real request handler, the real data layer, the engine, the credit rule and `report-rights.json` as shipped; the network is a fetch stand-in that records every request):

- **Accepted and routed.** The typed address goes to the one geocoder exactly as typed; the ZIP it returns (84302) is asked of `canonical_zip_registry`; the 0.5-mile spatial read is made at the geocoded point; the records that read names are the ones hydrated; and the rate limit is asked first. An address in a ZIP outside the registry is `OUTSIDE_COVERAGE`, one the geocoder cannot find is `ADDRESS_NOT_RESOLVED`: both free, neither "No data ingested".
- **The empty-source state is accurate.** With the rights registry as shipped, the report for this location says **"No data ingested"**: HTTP 200 and no `error` field, no project, nothing charged or stored, the issuing function never called, the trial count unchanged — and none of the **41 stored UDOT records** the database holds for this ZIP appears in the answer (by name, family or address). The empty answer is caused by the rights registry and not by the location: the control that clears a *fixture* family for the very same journey shows development and uses one free report. Clearing a *different* source changes nothing, and a malformed rights registry fails the request instead of clearing everything.
- **It does not look like an error.** In Chromium (`development-activity-reports.browser.test.mjs` 2e2-2e5; `development-activity-review.browser.test.mjs` 3c2) the page leads with the heading **"No data ingested"** and the founder's sentence "It is not a finding that there is no development", draws no project, shows no red status, and says no measured zero and none of the other outcome's words ("No development activity"). *This pass found and fixed one real defect:* the status line under the button read **"Report ready: 0 official records within 0.5 miles."** for this state, which is a measured zero for something that was not measured (ruling R5). It now reads "Report ready: No data ingested for this address. It is not a finding that there is no development nearby." in both pages; populated reports are unchanged. The new check was proven load-bearing by restoring the old line (it fails).
- **Read from production, read-only, 2026-10-04:** 84302 is one of the 12,722 rows of `canonical_zip_registry`; the database holds 41 stored UDOT development rows and 22 EPA facility rows for it. Those are stored, not cleared.

**What it does NOT prove.**
- **The ZIP is not a data source and not a clearance.** Being covered says where a report can be asked for, never that any publisher's records may be shown to a paying customer. Nothing is cleared (step 12), so a real Brigham City report is "No data ingested" today and will be until a source is cleared.
- **The automated tests did not call the live geocoder** (the sandbox has no egress). **The founder did, on 2026-10-04 at 1:02 PM CDT (18:02 UTC), through the landing page's coverage check, which calls the same `geocode-address` function the report handler calls** (`data.ts`: "the ONE geocoder"): `20 N Main St, Brigham City, UT 84302` resolved to "20 N MAIN ST, BRIGHAM CITY, UT, 84302 · ZIP 84302" and showed "INSIDE THE PRODUCT NETWORK", with no error (founder-reported, with a screenshot). That settles the lookup and coverage steps live. It does **not** exercise the report: that control never makes one, so the "No data ingested" page, its status line and its credit note are still to be seen live (manual test, Part A, steps 1-4 on the admin review page).
- The street address and the point are fixture values (copied from `test/national-report.test.mjs`), standing in for what the geocoder returns.

## 9. The free-report rate limit — applied and deployed 2026-10-04

**Why it was needed.** The entitlement limits what is *stored and charged* (20 free, 100 paid a month). It does not limit what is *asked*, and a request the credit rule does not charge — "No data ingested" (today **every** request), an address that cannot be found, an address outside coverage — is free work for the geocoder and the spatial reads. Behind an admin-created trial that is bounded by who was invited; before any self-serve trial it is not.

**What it is.** `docs/report-rate-limit.sql`: fixed windows of a minute, an hour and a day, per signed-in person and per brokerage, counted by the database (advisory locks, so two requests cannot both take the last slot). A request is allowed only if **every** window has room, and only then are all of them incremented, together; **a refused attempt consumes nothing**. The report function claims after the request is validated and **before the geocoder**, for members only (not admins, not the list/open reads, not a request already refused as invalid or because the trial or month is spent). A full window answers **429** `rate_limited` with the wait in the body and in `Retry-After`; the page says, in plain words, "You have asked for a lot of reports in a short time. Try again in 30 seconds. This did not use a free report." A claim that cannot be made is a 502 and the geocoder is **never** asked (fails closed). It stores only a person's id or a brokerage's id and counters: no email, address or IP. It touches neither the 20 nor the 100 (its post-condition refuses to apply if either is anything else, and a fingerprint of everything else in the schema is identical before and after applying it).

**The numbers — D-RL-1, proposed, not founder-set** (one function, `public.report_rate_limits()`; nothing in the edge repeats them):

| | a minute | an hour | a day |
|---|---:|---:|---:|
| a person | 10 | 60 | 200 |
| a brokerage | 30 | 200 | 1,000 |

They are chosen to sit well above a person working through addresses by hand and well below a script. **Nothing in the plan or the rulings names a request ceiling** (the 20 and the 100 are the only founder numbers and they are untouched), so these are mine; say if you want different ones. Changing them is a one-function edit and a re-apply.

**Proof.**
- `test/report_rate_limit_pg` against a real Postgres: 71 checks. Fixed instants for every window boundary (the longer wait is the one reported; an old clock cannot reopen a window); **eight real concurrent sessions racing one person's minute admit exactly ten of their 160 requests; sixteen real sessions across four people of one brokerage admit exactly thirty** (the brokerage's ceiling, not the sum of the people's); a claim above READ COMMITTED refused; the API roles refused by the database itself; applying changes nothing the entitlement owns; a second apply; an exact rollback; the refusal when a layer is absent. **29 prohibited mutations of the SQL, all killed by a named check** (`mutate_all.sh`; a crash does not count).
- `test/report-rate-limit-function.test.mjs`: 70 checks of the edge, written to fail by name, and `test/report-rate-limit-structure.test.mjs`: where the claim sits, who it is for, that no other file reaches the counters, that the credit path does not know it exists. **Edge mutation loop `test/report_rate_limit_mutants.py`: see section 12 for the record.**
- Section 15 of the launch gate, above, end to end; `test/brigham-city-84302-journey.test.mjs` 6a-6d for the test location.
- `.github/workflows/report-snapshot-suite.yml` gains a `report-rate-limit` job (database suite and mutation loop) and the new paths.

**Apply order — done on the founder's "go 1" and "go 2" (receipt below the list).**
1. Apply `docs/report-rate-limit.sql` **first**. It is additive, system-only, idempotent, and changes nothing a person sees. (The deployed function calls the claim; deployed *before* the SQL it would fail closed with 502 for every member.)
2. Deploy `get-development-activity-report` (`deploy-edge-functions.yml`).
3. The page change goes live **by merging** (Pages deploys on push to `main`). It is safe before the function change: the 429 message is dead code until the function can send one.
4. Read it back live: a member's report still works; the claim row appears in `report_rate_window`; `select * from public.report_rate_check()` reads zero on every invariant.


**Receipt (read back from production, not from the workflow's green tick).**
- **Go 1, 2026-10-04.** PR #1622 squash-merged as `46f3cb43`; `db-sql` run 37221261595 ran `docs/report-rate-limit.sql` from `main` (HTTP 201, empty result). Read back: the four functions' bodies equal the committed file byte for byte (md5 of `prosrc`: `report_rate_limits` `a96e0c40…`, `report_rate_claim_at` `39783072…`, `report_rate_claim` `6d085b03…`, `report_rate_check` `3253a830…`); each is executable by `service_role` alone; `report_rate_window` has row-level security on and no privilege for `anon`, `authenticated` or `service_role`; `evaluation_report_limit()` is 20 and `billing_report_limit()` is 100; `report_rate_check()` reads 0 on its three invariants, beside `limits_defined` = 6; the table holds 0 rows, as expected before any member's request.
- **Go 2, 2026-10-04.** `deploy-edge-functions` run 37221513812 deployed `get-development-activity-report` from `main` `46f3cb43`: version 14 to 15, `verify_jwt` still true. Read back: all 17 files of the deployed bundle are byte-identical to `main` (including the new `_shared/rate-reads.ts`). A request with only the public key answered `401 {"error":"unauthorized"}` from the handler's own gate (so the new code boots and refuses an unsigned-in caller before the limiter or the geocoder), and the function's logs for the three hours around it show that one request and no server error.
- **Not seen:** a real member's request passing through the live limiter, and a 429 from production. Both need an invited test member: manual test Part B then Part C.
- **Rollback, if ever needed:** redeploy the previous function first (a branch cut from `2c0246dc`, dispatched to `deploy-edge-functions`), and only then run the commented `ROLLBACK` statements at the foot of `docs/report-rate-limit.sql`; the other order makes every member's request fail closed with 502.

## 10. Anti-abuse audit — what is limited, what is not, and why

Each row says what exists **today** and the evidence. "NOT COVERED" means no rate limit applies; it is not a claim that the surface is unsafe.

| Surface | Who can reach it | What a flood or abuse costs | Control today | Status |
|---|---|---|---|---|
| **Report generation** (`get-development-activity-report`) | a signed-in trial or paid member | a geocoder call + spatial reads per request; "No data ingested", not-found and outside-coverage requests are free of charge and unlimited | the 20 / 100 entitlement (database-enforced) for what is *charged*; **the new rate limit for what is *asked*** | **Covered, live since 2026-10-04** |
| Report **admin** use | an admin | same as above | none, by design: the founder's own tool (`dashboard_admins`) | NOT COVERED, accepted |
| **Saved-report list and open** | a member, for their own brokerage | indexed database reads of the caller's own rows; no geocoder, no charge | membership resolver; no request ceiling | NOT COVERED — low risk; open |
| **Trial creation** | an admin only | one brokerage row + one invite per call | `development-activity-trial` `create` answers 403 to anyone else *before any field is read* (`test/development-activity-trial-function.test.mjs` 6a, 6b). **No public or self-serve path exists** | Not abusable from outside today. **A self-serve path does not exist, and must not until section 11 is done** |
| **Invite redeem** | anyone holding a token | one database call per try | tokens are `hse1_` + 64 hex (256 bits), one-time, expire in 14 days (`evaluation-entitlement.sql`; the format is pinned); guessing is not feasible | NOT COVERED by a request ceiling; protected by entropy |
| **Owner mints an agent invite** | an active owner of that brokerage (D-L8) | an invite row per call | seat limit chosen by the admin per trial (`NULL` = none, D-L2: **no number has been chosen**); an owner cannot list or withdraw invites | NOT COVERED — open (d) |
| **Checkout creation** (`manage-billing`) | the owner of a brokerage | once the Lemon Squeezy key is set, **one outbound call to the processor per request** | owner-only; answers 503 today because no key is set; refuses a second checkout while paid | **NOT COVERED — must be added before the processor key is set** |
| **Billing webhook** | the processor (signed) | a ledger write per event | HMAC signature; unsigned or wrong-secret is 401 and records nothing; a retry is a duplicate | Signature-gated; no request ceiling needed for a signed caller |
| **Share-link create / list / revoke** | a member of the report's brokerage | a row per link | at most 25 links per report, counted under a lock (`report_share_limit()`) | Bounded per report; no per-person request ceiling |
| **Public client link** (`view-shared-report`, `verify_jwt = false`) | **anyone with the link** | a hash lookup per request | 256-bit token; the handler's own header says rate limiting "is not built here" | **NOT COVERED — open (c); the one unauthenticated surface** |
| **Property Watch** start | a member | a row per watch | at most 25 per brokerage (`property_watch_limit()`) | Bounded; the daily runner is behind a private secret (open (e)) |
| **`geocode-address`** | **anyone with the public anon key** (CORS `*`; the site's add-your-home box calls it) | a call to the U.S. Census geocoder per request | none; no rate limit | **NOT COVERED — a pre-existing exposure outside the report path.** The new limit protects the geocoder *from the report function*; it cannot protect a direct call to this function |
| **Billing portal / card update / cancel** | — | — | none exists: a customer cannot change a card or cancel from the page | **OPEN (b)** — a customer-facing gap, not an abuse control |

## 11. Request-access / self-serve trial — what it needs, and what was left alone

**Today's operating model, unchanged: an admin creates the trial, the owner joins by invite link.** The admin does it from `development-activity-review.html`; the owner receives a link by hand.

**Nothing public was added.** The "Start with 20 free reports" and "Join for $79/month" buttons remain inside `<div data-commerce hidden>`, inert, with no destination. Evidence that the landing tests would fail if one became visible: in a copy of the page, un-hiding **each of the four wrappers on its own**, un-hiding all of them, making a button clickable, adding a new visible "Start with 20 free reports" outside a wrapper, and replacing "Join for $79/month" with a live link **each fail both** `development-activity-landing.test.mjs` and its browser test, by name. (One try first reported a survivor: it had changed the *comment* that quotes the wrapper, not a wrapper — a harness error, corrected by editing the four real wrappers separately.)

**Why a request-access path was not built.** It needs a real destination, and every candidate for one is a decision that is yours, not mine: **D-RA-1** where a request goes (the founder's inbox by a mailto to an address you name, or a form that stores a row and tells you) · **D-RA-2** if it stores an email address or name, that is subscriber data/PII and needs consent wording, which is a legal/consent change · **D-RA-3** what happens to the request (who creates the trial, in what time). A page button with no real destination is exactly what you said not to expose, so none was added.

**Self-serve trial creation (D-13-1 option B) needs all of this, and none of it exists:** a verified identity to create under (an email confirmed by sign-in, one trial per person); a limit on trial *creations* per person, per email domain and per network address per day (the report limit does not cover this: it protects report requests, not account creation); a **default seat limit** (D-L2: no number has been chosen); a checkout request ceiling (section 10); a rate limit on the public client link; and a way for the founder to see and stop abuse (a monitor check on request volume and on trials created per day — the pipeline monitor lives in `homesignal-ingest`, a cross-repo change I did not make). The report limit is the first of these, not the last.

## 12. Tests and checks run for this change

Run 2026-10-04 on the final tree, in a sandbox with **no network egress** (so nothing below touched the live geocoder, Supabase, Lemon Squeezy or any publisher). Disposable Postgres 16 for every database suite; no credential was present.

**Suites**

| Suite | Result |
|---|---|
| Offline unit suite (`node scripts/run-unit-tests.mjs --offline`, the required CI check) | **all 325 files pass** (run after the last code change; the docs edit that followed was re-checked by `launch-location-structure`, below) |
| `test/brigham-city-84302-journey.test.mjs` | 28 / 28 |
| `test/report-rate-limit-function.test.mjs` | 70 / 70 |
| `test/report-rate-limit-structure.test.mjs` | 42 / 42 |
| `test/launch-location-structure.test.mjs` | 22 / 22 |
| `test/launch-gate-structure.test.mjs` | 67 / 67 (the original 73 gate checks are pinned by name in 6a-6g) |
| `test/evaluation-entitlement-structure.test.mjs` · `brokerage-account-structure` · `national-report-function` | 76 / 76 · 57 / 57 · 194 / 194 |
| `test/report_rate_limit_pg/run.sh` (the limiter against a real Postgres, incl. real concurrent sessions) | 71 / 71 |
| `test/launch_gate_pg/run.sh` (invite to a 100-report paid month, over the real handlers and SQL) | **86 / 86** = the original 73 + 13 in section 15 |
| `test/trial_report_pg/run.sh` | 95 / 95 |
| Chromium: `development-activity-reports.browser` · `development-activity-review.browser` | 257 / 257 · 54 / 54 |

**Mutation loops** (each mutation is applied to a copy and must be killed by a *named failing check*; a crash does not count)

| Loop | Result |
|---|---|
| SQL, `test/report_rate_limit_pg/mutate_all.sh` | **29 killed, 0 survived**, control 71 / 71 |
| Edge, `test/report_rate_limit_mutants.py` | **35 killed, 0 survived** |
| Launch gate, `test/launch_gate_mutants.py` (the original 28 + 6 rate-limit mutations) | **34 killed, 0 survived**, control 86 / 86 |

**An instrument defect found and fixed during this run.** The first SQL mutation re-run reported "killed 0, survived 29". It was run in a shell with no database named, so `run.sh` stopped on its first line and printed no failing check, which the loop read as "survived" for every mutation. It failed in the safe direction, but a suite that never ran must not be filed as a surviving mutant. `mutate_all.sh` now requires `PGHOST` and `PGDATABASE`, runs the **unmutated** suite first and refuses to judge any mutation unless it passes, and reports a mutation whose suite did not run as a harness failure. Shown: no database named → abort (exit 1); a database that does not exist → "the unmutated suite did not pass, so no mutation can be judged" (exit 2); the real run → 29 / 29 killed.

**The whole browser sweep (reported-only in CI).** `node scripts/run-unit-tests.mjs --browser` ended "17 test file(s) failed" out of 55. That is **not** caused by this change, shown rather than assumed: the same 17 files were run on a pristine checkout of `main` (`2c0246dc`) and all 17 fail there too. 15 fail with the identical set of failing check names. The two that differed by one check were re-run three times each, alone, on both trees: `user-journey` matched on `main` every time (the extra failure only appeared while other jobs were loading the machine), and in `home-zip-or-address` the extra "no page errors" check is `console: Failed to load resource: net::ERR_TUNNEL_CONNECTION_FAILED`, a sandbox network-proxy failure on an external resource, in a page this change does not touch (no file in the diff is loaded by the home page). The failures I read were the sandbox itself: no network (Map 1 and the geocoder checks need the live database and geocoder), and in one file a Chrome channel that is not installed. I did not read every line of all 17; the evidence that none is this change's is that each one fails on `main` too. A first baseline attempt was **invalid** and is not used: the pristine checkout had no `node_modules`, so those tests printed "SKIP — playwright not installed" and exited 0 without running.

**Not tested, and why.** The automated tests never asked the live address lookup for `20 N Main St, Brigham City, UT 84302` (no egress); the founder did on 2026-10-04 through the landing page's coverage check, and it passed (section 8). Still not seen live: the report page's "No data ingested" state (manual test, Part A, steps 1-4). Before the go, `docs/report-rate-limit.sql` had been run only against disposable Postgres. It was then applied and the function deployed (section 9, receipt); what has still NOT been seen is a real member's request passing through the live limiter, because no signed-in member was available to make one from this session (manual test, Part C). Nothing was sent to a publisher and no public button was exposed.

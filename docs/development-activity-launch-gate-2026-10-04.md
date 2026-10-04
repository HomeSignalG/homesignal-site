# Development Activity — the launch gate (build step 13), 2026-10-04

The plan's step 13, in the founder's words: **"End-to-end launch test, then the Enterprise page buttons go live. A test brokerage runs sign-up, 20 reports,
the end of the trial, payment and a 100-report month."**

## 1. Status — read this first

| | |
|---|---|
| **The end-to-end test** | **BUILT AND GREEN.** `test/launch_gate_pg` runs the whole sequence as one scenario (section 2) through the real handlers and the shipped SQL. 73 checks, all passing. It runs in CI on every change to anything it stands on. |
| **The Enterprise page buttons** | **NOT LIVE.** Four of the five things that have to be true first are not (section 4). They stay hidden and inert (`<div data-commerce hidden>`, `aria-disabled`), and `test/development-activity-landing.test.mjs` still fails if one becomes visible. |
| **Step 13 in the checklist** | **NOT struck.** The checklist strikes a step only after the work is merged, deployed and read back live. The buttons are the second half of this step and they are not live. |
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

Run it: `bash test/launch_gate_pg/run.sh` with `PGHOST`/`PGDATABASE` pointing at a disposable Postgres (the script refuses any database whose name does not contain
"disposable" and refuses to run if any Supabase credential is present). About 70 seconds. In CI it is the `launch-gate` job of `report-snapshot-suite.yml`.

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
| 5 | The items the checklist carries as "open before step 13": the free-report rate limit; the public link endpoint is not rate-limited; an owner cannot list or withdraw invite links or remove an agent; **there is no billing-portal link, so a customer cannot change a card or cancel from the page**; `run-property-watch` has no rate limit beyond its private secret; an ended or failing watch is not emailed to the agent. | **Open.** None was fixed in this step; the first three and the billing-portal link bear directly on opening the door to the public. |

### The decision the buttons need (D-13-1) — not made here

The commerce buttons are drawn, inert and hidden in four places on the page (four `data-commerce` divs), and **there is nothing for them to call**. That is because the product, as built through step 12, is
*invite-only*:

- A trial is **created by an admin** (`development-activity-trial`, action `create`, admin only) and **joined by an invite link** the admin or the owner sends.
- A checkout is started by the **owner of an existing brokerage** (`manage-billing`); a person with no brokerage gets 403.

So a stranger who presses "Start with 20 free reports" has no function to reach that would give them a trial, and a stranger who presses "Join for $79/month" has no
brokerage to pay for. Making the buttons live therefore means choosing, which is the founder's call:

- **A. Request-and-invite (needs no new code on the server).** "Start with 20 free reports" opens a request form; the founder creates the trial and sends the owner link, exactly as now.
  "Join for $79/month" takes a signed-in owner to the Billing card. Manual: the founder is the gate on who gets a trial.
- **B. Self-serve trial creation.** A new function lets a signed-in person create their own brokerage and trial. That is new code and a new abuse surface (the free-report rate limit in item 5 would have to exist first).

Either way, **the buttons stay hidden until items 2, 3 and 4 are true**, because a live button that leads to "No data ingested" or to a checkout that cannot complete is worse than no button.

## 5. When the prerequisites are true — the go-live steps

1. Re-run `bash test/launch_gate_pg/run.sh` on `main` (green), and the founder's test payment's ledger rows pass the checks in the billing record section 5 (every `livemode` false, `variant_ref` the product,
   the Billing card says "Test subscription only"). If a field name was wrong, correct `_shared/lemon-billing.ts` and its tests **first**, and update this gate's events to the real captured shapes.
2. Decide D-13-1 (A or B) and build what it needs.
3. Make the buttons call it; remove `hidden` from the four `data-commerce` divs; update `test/development-activity-landing.test.mjs`, which today fails on exactly that.
4. Deploy, then read the live page back from homesignal.net (the buttons visible and doing what D-13-1 says), and only then strike step 13.

## 6. Decisions made in this step

- The gate lives in `report-snapshot-suite.yml` as its **own job** (`launch-gate`), beside `snapshot` and `billing`, so its 70 seconds and its 100-report loop do not share another job's time. It takes no repository secret.
- The processor is a **stand-in that records the request**, and the webhook body it "sends" is built from the custom data of the checkout request the real `manage-billing` handler made, so the binding that ties a payment to a brokerage is exercised end to end.
- The gate uses **fixture keys that say so** ("fixture-…-not-real"); `test/launch-gate-structure.test.mjs` fails on a key or secret in the round trip that does not.
- **Nothing was changed in `homesignal-ingest`'s `lemonsqueezy-webhook`**, and nothing in this repo calls it.

## 7. Files

- `test/launch_gate_pg/run.sh`, `test/launch_gate_pg/roundtrip.mjs` — the gate.
- `test/launch-gate-structure.test.mjs` — its structure: stands on the real layers, answered through an allowlist, reads no environment, runs in CI, says what it does not prove.
- `test/launch_gate_mutants.py` — the mutation loop (manual, like the others).
- `.github/workflows/report-snapshot-suite.yml` — the `launch-gate` job and its path filters.

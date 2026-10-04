# Development Activity — build step 11: the $79 a month plan (2026-10-04)

The founder's line, unchanged: **"$79/month checkout on the existing Lemon Squeezy connection: 100 reports a month, Billing tab. Founder action:
create the $79 product in Lemon Squeezy and make one test payment."**

This is the written record of that step: what was built, who decides what, the defaults taken (the founder may change any of them), the actions
only the founder can take, and — stated first, because it is the point of the step — **what has and has not been exercised.**

## 0. What has NOT been done, plainly

- **No payment has been made, by anyone.** The processor's product does not exist yet; the founder creates it.
- **Nothing here has been exercised against Lemon Squeezy.** No real webhook payload was ever captured, and the processor's documentation could not
  be read from the build sandbox (docs.lemonsqueezy.com is blocked there). Every field name this build reads from the processor is **unverified**:
  `meta.event_name`, `meta.test_mode`, `meta.custom_data`, `data.type`, `data.id`, `data.attributes.status` / `updated_at` / `variant_id` /
  `product_id`, the checkout request's shape and the checkout answer's `url`. The code is built to **refuse what it does not recognise** (a payload
  without a field it needs is answered 422, loudly; a checkout answer without a Lemon address is never handed to a browser). The founder's one test
  payment is what confirms the shape. Section 6 says exactly what to look at.
- **The signed-in and payment paths are NOT exercised live.** What is exercised is the database layer on a disposable Postgres (the real SQL, real
  concurrent sessions), the edge handlers over stand-ins, and the page in Chromium against the real handlers. After deploy, only the fail-closed
  answers can be read live (secrets unset): see section 7.
- **The landing page's buttons are still inert.** Making "Join for $79/month" live is step 13, not this step.

## 1. What a customer gets

- On the customer reports page (`development-activity-reports.html`) a **Billing** card, for a brokerage member:
  - before any subscription: **Free trial** (or **Free trial used**), "$79/month gives your brokerage 100 new reports each month. Cancel anytime.",
    and — for the brokerage's **owner only** — a **Subscribe for $79/month** button. An agent is told only the owner can subscribe.
  - the button asks `manage-billing` for ONE checkout and sends the browser to Lemon Squeezy's own page. Nothing is charged and nothing changes by
    pressing it. Coming back, **Check again** asks again; the plan appears once the processor's signed event has reached HomeSignal.
  - on the plan: **"$79/month plan: N of 100 reports used this month"** and when the month ends.
  - a subscription that ended, is past due, or is not clear says so, and **"Make report" stays off**; a second checkout is offered only where a new
    subscription is what is needed (never subscribed, ended, or test-only), never over one that exists and might recover (it would bill twice).
- The 20 free reports and the 100 monthly ones are **separate**: the free ones do not count toward the plan (founder, 2026-10-02), a paid report
  never takes a free one, and the unused free ones are neither used nor lost. Reopening, sharing, printing, saving as PDF, Watch and Compare never
  use a report (unchanged).
- Paid reports are numbered from **21** and a number names one report for ever. They appear in the saved list, the share links, the watch list and
  Compare beside the free ones, newest first.
- There is no other tier, no overage, no token pack and no seat charge (plan ruling 8). At the 101st report of a month the answer is
  `allotment_complete` ("all 100 are used; the next month starts on …").

## 2. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- **Canonical truth path:** processor event → the HMAC-verified webhook (`development-activity-billing-webhook`) → `public.billing_event_apply` →
  `public.payment_event_record` → `public.payment_event` (the ledger applied 2026-10-02) → `public.billing_plan_of` (the plan state, derived) →
  `public.brokerage_report_issue` (which allotment) → `public.report_snapshot_issue` (the one snapshot writer) → the credit ledger
  (`evaluation_credit` for free, `brokerage_paid_credit` for paid) → the view `public.evaluation_credit_all` (whose a report is) → the saved list,
  the share links, the watch list and Compare.
- **Decision owners, none duplicated:**
  - *is the event genuine* — the webhook's signature check, in `_shared/lemon-billing.ts`, before anything is parsed.
  - *was it recorded, and which event is the latest* — the ledger (`payment_event_record`, `payment_event_latest_id`). Asked, never re-ordered.
  - *what a processor status word means* — the ledger's `payment_event_map_status`, read through the stored `mapped_status`.
  - *is the brokerage paid* — `billing_plan_of` alone. Nothing stores "paid": a state that is stored can disagree with the ledger it came from.
  - *which allotment a report uses* — `brokerage_report_issue` alone. The report function names no allotment rule; it reads the database's answer.
  - *whether a report may be stored* — `report_snapshot_issue` and the private-context containment trigger, called and not repeated.
  - *whose a report is* — `evaluation_credit_all`, the one ownership view. The six readers that decided it (saved list, open, the share links, the
    share page, the watch list) are **spliced** to read it, from their live function bodies, anchor-counted.
  - *the numbers 20 and 100* — `evaluation_report_limit()` (unchanged) and `billing_report_limit()` (new), written once each.
  - *what a browser may be told about a plan* — `planSummary` in `_shared/billing-reads.ts`: the state, this month's figures and the person's own
    role; never the brokerage's id, an event, a subscription id, a price or a processor word.
- **Shortcut check:** `evaluation_credit` is named by the free evaluation's own function and by nothing that decides ownership any more (a test fails
  if a reader names it); `billing_usage` and `billing_event_apply` are named in one TypeScript module (`_shared/billing-reads.ts`) and nowhere else;
  the processor is named in one module and, as environment variable names, in two index files; the credit RPC is named in one module
  (`_shared/report-snapshot.ts`). The map product's per-user `subscriptions` table is **trapped** in the SQL suite (any touch from this layer
  raises) and the other webhook, `lemonsqueezy-webhook`, belongs to homesignal-ingest and is not changed, called or replaced.

## 3. How it works

- **`docs/brokerage-billing.sql`** (additive; two tables, one view, eleven functions, five triggers, one splice). `brokerage_subscription` binds a
  processor subscription to ONE brokerage for ever (append-only). `brokerage_paid_credit` is the append-only ledger of paid reports: **the cap is a
  constraint** (primary key `(binding, month, ordinal)`, ordinal between 1 and 100; the month is stamped by a trigger from the binding and the
  clock, so no writer can name another month to get another 100). The issuing function additionally refuses at READ COMMITTED only and answers
  `ALLOTMENT_COMPLETE` before the constraint is reached. Closed to every API role, `service_role` included, except through the eleven functions.
- **`billing_plan_of`** — `paid` exactly when the latest LIVE event of the brokerage's current LIVE binding maps to `active`. A test-mode event is
  recorded and bound (so the founder's test payment can be checked) but the state is `test_only` and **no report is ever charged to it**. An
  unknown status word never grants. A suspended brokerage is `suspended` whatever its subscription says.
- **`manage-billing`** (JWT on): `status` for any member, `checkout` for the owner only. It returns the processor's own https address and nothing
  else; the brokerage id rides only in the checkout's custom data with an HMAC (`bind`) made under the webhook's signing secret, because a public
  buy link lets a buyer add custom data of their own — a checkout without our signature is ignored by the webhook.
- **`development-activity-billing-webhook`** (JWT off; the gate is the HMAC): signature checked on the RAW body before the body is parsed; every
  request refused (503) while the secret or the variant id is unset; 401 / 413 / 422 / 409 / 503 as documented in its header; an event that is not
  ours (another product, an order or invoice event, a checkout without our signature) is acknowledged 200 and recorded nowhere. It logs, stores and
  returns no payload, customer, email, card, price or secret.
- **`get-development-activity-report`** reads the plan once per request; a complete free trial with no paid plan is `evaluation_complete`, a paid
  plan with the month used is `allotment_complete`; the credit shown after a report says which allotment it used (the database's answer).
- **Environment** (set by the founder, never printed or committed): `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`,
  `LEMONSQUEEZY_BILLING_VARIANT_ID`, `LEMONSQUEEZY_BILLING_WEBHOOK_SECRET`, and `LEMONSQUEEZY_TEST_MODE` (`true` while testing).

## 4. Defaults taken — the founder may change any of them

| | default | why / what it costs |
|---|---|---|
| **D-11-1** | **Paid means the processor's own `active` and nothing else. A cancelled subscription ends access at once.** | The ledger holds no period-end date, so "cancelled but paid through the end of the month" cannot be told from "cancelled" here. **FOUNDER DECISION**: the kinder rule (access until the paid month ends) needs the processor's `ends_at` recorded, which is a change to the immutable ledger. |
| D-11-2 | past_due, unpaid and paused do not grant; no grace period is invented. | A failed payment pauses new reports; saved reports stay available. |
| D-11-3 | A paid month runs from the day the subscription was bound, in whole calendar months (UTC); it does not follow a paused or shifted billing date. | The month is derived, never stored. 31 Jan + 1 month is 28 Feb. |
| D-11-4 | Once the plan is paid, every new report uses the paid month; the unused free reports are neither used nor lost. | A brokerage that subscribes with free reports left keeps them if the plan later lapses. |
| D-11-5 | The 101st report in a month is refused (`allotment_complete`); no overage, pack or extra purchase. | Plan ruling 8. |
| D-11-6 | Paid reports are numbered from 21 and a number is never reused. | Free ones are 1 to 20. |
| D-11-7 | A brokerage that subscribes again after cancelling gets a new binding and a new first month. | The old binding's reports stay owned by it. |
| **D-11-8** | **A SECOND webhook** (its own URL and its own signing secret), not a change to the map product's `lemonsqueezy-webhook`. | That function belongs to homesignal-ingest and to a different product (a per-user map subscription); changing it is a cross-repo change. The two ignore each other's events: the map one ignores an event with no user id, this one ignores an event with no signed brokerage id. |
| D-11-9 | The variant and the signing secret have **billing-specific** environment names (`LEMONSQUEEZY_BILLING_VARIANT_ID`, `LEMONSQUEEZY_BILLING_WEBHOOK_SECRET`); the API key and store id keep the generic names. | The generic variant name could already hold the map product's variant; this function would then act on the wrong product. The key and store are the same Lemon account either way. |
| D-11-10 | Only the brokerage's owner subscribes; an agent sees the plan and is told to ask the owner. | Plan hard rules 40-41. |
| D-11-11 | An evaluation HomeSignal revoked or let expire stays no access even when paid. | Payment adds an allotment, never standing. |
| D-11-12 | No billing-portal or cancel button is built. | "Cancel anytime" is the processor's own customer link in its receipts. Linking it needs the subscription's portal URL, which is not stored (nothing personal is). Open item. |

## 5. Founder actions — only the founder can take these

None of these has been done. In this order:

1. **Create the $79/month product in Lemon Squeezy** (a subscription, monthly, $79). In **test mode** first. Note its **variant id** and the
   **store id**.
2. **Create a SECOND webhook** in Lemon Squeezy (Settings → Webhooks) pointing at
   `https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/development-activity-billing-webhook`, with a **new** signing secret (not the map
   product's). Subscribe it to: `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_resumed`,
   `subscription_expired`, `subscription_paused`, `subscription_unpaused`.
3. **Set four secrets** on the Supabase project (never paste them in chat or commit them): `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`,
   `LEMONSQUEEZY_BILLING_VARIANT_ID`, `LEMONSQUEEZY_BILLING_WEBHOOK_SECRET` (the new webhook's signing secret), plus `LEMONSQUEEZY_TEST_MODE=true`.
   Until all are set, everything here fails closed: the Billing card says subscribing is not open yet and the webhook answers 503.
4. **Make ONE test payment** through the Billing card of a brokerage you own (Lemon's test card). Then check — before anything goes live — that the
   event arrived and the shape matched what this build expects. Read-only checks, run through the repo's `db-sql.yml`:

   ```sql
   select event_id, event_name, processor_status, mapped_status, occurred_at, livemode, product_ref, variant_ref
     from public.payment_event order by event_id desc limit 20;      -- the test payment's events: livemode false
   select * from public.billing_check();                              -- every invariant row reads 0 beside non-zero controls
   ```

   What to look at: that the events exist and carry a real `occurred_at`, that `variant_ref` is the product you made, that `livemode` is false,
   and that the Billing card shows **"Test subscription only"** (a test payment never grants reports — that is correct).
5. **Only then go live**: create/confirm the live product, point `LEMONSQUEEZY_BILLING_VARIANT_ID` and the webhook secret at the live ones,
   remove `LEMONSQUEEZY_TEST_MODE`. (Whether Lemon keeps separate variant ids and webhooks for test and live is **unverified** here.)
6. **If the first test event shows a different shape** (the ledger's columns are PROVISIONAL, `docs/payment-event-ledger.sql`, and the table is
   immutable): the ledger may be dropped and recreated **only while it holds test events alone**, which is the condition that file states. Say so
   and the translation (`_shared/lemon-billing.ts`) and the ledger are corrected together before any live event is recorded.
7. Step 13 (the landing page's buttons) stays separate and is not started.

## 6. What is unverified about the processor, and what the test payment will show

| unverified | where it is read | how it fails if wrong |
|---|---|---|
| the signature header is `X-Signature`, hex HMAC-SHA256 of the raw body | `verifySignature` | every webhook answers 401 (nothing recorded) |
| the event name is `meta.event_name`; the test flag is `meta.test_mode` (or `data.attributes.test_mode`) | `translate` | a missing flag is `invalid` (422), never read as live |
| the checkout's custom data comes back as `meta.custom_data` | `translate` | no signed brokerage id → the event is ignored (200); the plan stays as it was |
| `data.type` is `subscriptions`, `data.id` the subscription, `attributes.status` its status, `attributes.updated_at` its time | `translate` | `invalid` (422) |
| `attributes.variant_id` is the product's variant | `translate` | another product's event is ignored |
| the checkout request (`/v1/checkouts`, JSON:API, `checkout_data.custom`, `product_options.redirect_url`) and the answer's `data.attributes.url` | `checkoutRequest`, `checkoutUrlFrom` | `checkout_unavailable` (502); the page says the payment page could not be opened |
| there is no per-delivery id, so the ledger's key is `event:subscription:updated_at` | `translate` | PROVISIONAL (the ledger's own note): a retry carries the same three, a later change carries a new time |

## 7. What was proved, and how

- **The database layer — `test/brokerage_billing_pg/`** (72 checks, run by `run.sh` against a disposable Postgres, in CI as its own job):
  empty and system-only (RLS on, no policy, no privilege for any API role, `service_role` included); nothing personal can be stored (columns
  listed); every processor status word maps as stated and only `active` is paid; an older event arriving later changes nothing; a test binding never
  grants and never outranks a live one; one subscription cannot belong to two brokerages; the 100th report of a month and the refusal of the 101st
  (no snapshot is stored for a refused one); the cap holds **by constraint** for a writer that bypasses the function; the month cannot be chosen by
  the writer; a retried key is answered across both ledgers; a refused snapshot leaves no hole; the six readers show paid reports beside free ones,
  and a share link and a property watch work on a paid report; `billing_check()` reads zero beside non-zero controls and is shown to catch a
  seeded wrong-month row. **Five real concurrent sessions scenarios**: two callers racing for the 100th report (one wins, the other is refused
  `ALLOTMENT_COMPLETE`, the ledger holds exactly 100); the same key at once (one report, one charge); one subscription named for two brokerages at
  once (one binding, the loser refused and recorded nowhere); the same subscription for one brokerage at once (one binding); an issue under
  REPEATABLE READ refused. The file applies twice with an identical result; **its rollback was run with 315 paid reports stored** and puts the six
  readers back to exactly their earlier definitions, keeps every snapshot and every payment event, and re-applying gives the first apply; it is
  refused (creating nothing) when a layer it stands on or a splice anchor is absent. **38 prohibited mutations** each fail a named check or stop
  the apply.
- **The edge** — `test/lemon-billing.test.mjs` (the processor module), `test/billing-functions.test.mjs` (both functions over a stand-in
  database, processor and clock), `test/billing-structure.test.mjs` (the shape, the single modules, the order of the checks, the wiring), and
  the report function's and snapshot module's suites. `test/billing_mutants.py` is the manual mutation loop for these: 96 prohibited mutations of the processor module, the two functions, the report function, the snapshot module, the wiring and the page, each failing a named check (one candidate, removing the early hex check in `verifySignature`, is recorded as an equivalent mutant and not counted: a header that is not 64 hex characters cannot equal the HMAC either way).
- **The real handler over the real SQL — `test/trial_report_pg/`** (95 checks): the report function's real handler and data layer, with the network
  translated to psql calls of the database's own functions. It applies the billing file twice on top of the layers it stands on, answers the plan
  read (`billing_usage`) and the ONE issue function (`brokerage_report_issue`), and does **not** answer the free evaluation's own issue function:
  a handler that charged a report by calling that directly would be a second way to charge, and the unlisted call stops the run. A trial pays for
  nothing (no paid credit exists after twenty free reports). *Found by CI, not by the local run:* this suite's first push failed (502
  `data_unavailable`) because it had neither the billing file nor those two answers; the structure test now pins both (5h).
- **The page** — `test/development-activity-reports.browser.test.mjs` section 12 (232 checks in all): the Billing card in every plan state, the
  owner's checkout against the real `manage-billing` handler, an agent offered no button, the processor not set up, an address that is not the
  processor's never opened, a plan that cannot be read never shown as paid or free, "Check again", a paid report using the month and not a free
  report, sign-out forgetting the plan, 390 px wide.
- **Live, after deploy, with the secrets unset — fail-closed answers only:** `manage-billing` `status` / `checkout` answer for the signed-in
  caller (checkout `billing_not_set_up`, 503); the webhook answers 503 `not_set_up` to a POST and its capability to a GET; the report function
  reads a plan. The real signed-in/payment path is **NOT exercised live** and no payment is made.

## 8. Apply and deploy order

Read-only check of production before applying (2026-10-04, `execute_sql`): the six readers each hold exactly one `public.evaluation_credit c`
(so the splice's anchor count is 1 on every one), every function the file stands on is present, and no billing object exists yet. Counts at that
moment, each beside the check that it is a real read: `payment_event` 0 rows, `brokerage_account` 0 rows, `evaluation_credit` 0 rows. **No
customer exists yet, so applying changes nothing for anyone.**


1. `docs/brokerage-billing.sql` through the approved runner (`db-sql.yml`, dispatched from the branch with `sql_file`), then verify: the six
   readers read the view; `billing_check()` reads zero; the grants are service-role only. The runner writes no migration-ledger row: backfill one
   by hand (statements NULL, the honest marker of a backfill).
2. Deploy `get-development-activity-report`, `manage-billing` and `development-activity-billing-webhook` (and any function importing the changed
   `report-snapshot.ts`), in that order, SQL first: **the report function calls `brokerage_report_issue`, which must exist before it is deployed.**
3. Pages ships the Billing card with the merge.
4. Rollback: the footer of `docs/brokerage-billing.sql`. **Appropriate only before the first paid report** — it drops the paid ledger, so a paid
   report would be left with no owner (the snapshots themselves are append-only and survive). The report function would also have to be redeployed
   to the previous version first.

## 9. Concurrency check (CLAUDE.md, 2026-09-06)

Verdict: **GENUINE GAP.** Searched on 2026-10-04: pull requests matching billing / Lemon Squeezy / checkout / subscription / "$79" (the only prior
billing work is #1537, the ledger of Order M step M0, applied 2026-10-02, which this step builds on and does not repeat), the 20 open pull requests
(none is about billing) and the branch list; nothing implements this outcome. The map product's webhook lives in another repository and is not
touched. The landing page's price copy is read by a tripwire test and unchanged.

## 10. Open items, stated rather than hidden

- D-11-1 is a founder decision (cancelled ends access at once).
- No billing portal / cancel link (D-11-12).
- A paying brokerage whose evaluation has an end date that has passed cannot see its reports (no evaluation is made with one today);
  `billing_check()` reports the case.
- `docs/payment-event-ledger.sql` still says "NOT APPLIED" in its header although it was applied on 2026-10-02. This step wires the first writer
  to it; correcting that header is left for its own change.
- The edge mutation loops of older suites (`test/national_report_mutants.py` and others) may carry anchors this step moved; they are manual loops
  and CI runs the tests, not the loops.

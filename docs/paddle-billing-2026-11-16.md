# Paddle checkout and membership billing (2026-11-16)

Paddle replaces Lemon Squeezy (founder: "lemon should be deleted, paddle replaces it"). Built on the billing design that already existed
(`docs/payment-event-ledger.sql` → `docs/brokerage-billing.sql`); **no second truth path was added**.

**Nothing is live.** `supabase/functions/_shared/billing-switch.ts` still has `CHECKOUT_ENABLED = false`, so `manage-billing` refuses every checkout
(`503 checkout_disabled`). Flip it only after the release gate at the foot of this file.

## 1. Audit (what was found, 2026-11-16)

| Question | Finding |
|---|---|
| Paddle account reachable | Yes: the proxy-injected key reads `api.paddle.com` (the **live** account). `sandbox-api.paddle.com` is **not** reachable from this session (proxy refuses it), so no sandbox call was made. |
| Active products | Professional `pro_01m7d6ke8gd7beyc6p68kvhxy3`, Private Partner Offer `pro_01m7d6q09cv0d8hmbbpjv1qraz`, Brokerage & Enterprise `pro_01m7d6kes3ew6s2cyhtgdcgysp`. |
| Active prices | **Professional Monthly** `pri_01m7d6kede6hqr2kh9b78mb25j`: $78.00 USD, monthly, **no trial**. **Private Partner** `pri_01m7d6q4yw2yzygm5cz92s5abg`: $234.00 USD, one-time, **no trial**, custom_data access_months 6. |
| Prices that have a trial | Professional Annual, Brokerage Monthly and Brokerage Annual each carry a 7-day trial. **All three are `archived`**, so no active checkout price has a free trial. Nothing in Paddle was changed. |
| Brokerage & Enterprise | Product is active but both its prices are archived: it cannot be bought. Quote only (`contact.html`). |
| Notification destinations | None exist yet in the live account. |
| Existing code | A complete Lemon Squeezy billing path: `_shared/lemon-billing.ts`, `manage-billing`, `development-activity-billing-webhook`, plus `homesignal-ingest/supabase/functions/lemonsqueezy-webhook` (the old map-product webhook). Provider-neutral layers underneath: payment ledger, brokerage binding, paid-credit ledger (100 a month as a constraint), `billing_plan_of`. |
| Production data | 3 Lemon **test** events, 1 Lemon test binding, 0 paid credits, 0 rows in `subscriptions`. Kept (never deleted). |
| Open PRs / duplicates | Not checked: the GitHub tools were not used in this session. Check before merging. |

## 2. Design

```
Paddle.js overlay (price + signed custom data from manage-billing)
  -> Paddle -> paddle-webhook (Paddle-Signature, 5-minute tolerance, which secret verified = livemode)
  -> public.paddle_event_apply / paddle_adjustment_apply
  -> public.billing_event_apply -> public.payment_event_record (the ledger: unique key = Paddle event_id; ordered by Paddle occurred_at)
  -> public.billing_plan_of (state, derived) -> public.brokerage_report_issue (which allotment) -> brokerage_paid_credit (100 a month, a constraint)
  -> public.billing_summary (the dashboard)
```

* **Account required.** `manage-billing` needs a signed-in session; the checkout names the caller's own account, signed with a secret only the server holds (account + plan + enrollment are inside the signature). A payment whose custom data is unsigned or edited is never attached to an account; it is kept in `paddle_unmatched_event`.
* **What a price is** is one table, `billing_plan_price` (price id, livemode, plan, one-time or recurring, months). The page never names a price; a sandbox price can never be a live plan.
* **Professional** ($78/month): paid exactly while the latest event of the subscription maps to `active`. Cancelling in Paddle schedules the end: the status stays `active` until the end of the paid period, so access runs to the end of the period by construction; the scheduled date is stored and shown. `canceled`, `past_due`, `paused` and anything unknown never grant.
* **Private Partner Offer** ($234 once, six months): paid from a confirmed `transaction.completed`, **only** for an account with a valid, unexpired, not-full partner link and an active partner brokerage, once per account, never while the enrollment is marked failed. Six months = six monthly allotments of 100 (periods 0-5 from the binding), no rollover, no renewal, then `expired` (derived from the clock; no job is needed). A price id alone grants nothing.
* **Refunds:** a full, approved refund or chargeback is the latest ledger event and revokes at once. Partial refunds change nothing.
* **Periodic membership verification (decision 2):** every paid partner enrollment gets a `next_verification_at` = purchase + the partner brokerage's own `verification_interval_days` (**30 by default**, 1 to 365, set with `partner_brokerage_set_interval`). `partner_verification_due()` is the **manual-review queue** (derived from the clock on every call, with `days_overdue`); `paddle_billing_check()` counts it in a `review` row. `partner_enrollment_verify(id, 'verified')` schedules the next check; `'failed'` (confirmed ineligibility) suspends access immediately. **A late check never suspends anything** (suite V04/V05: still paid at 12 and at 400 days overdue).
* **Nothing personal is stored:** no email, name, card, address, Paddle customer id or amount. Opaque Paddle ids and times only.

## 3. Files

Site repo (`homesignal-site`)
* New: `docs/paddle-billing.sql`, `supabase/functions/_shared/paddle-billing.ts`, `supabase/functions/paddle-webhook/{index,handler,data}.ts`, `test/paddle-billing.test.mjs`, `test/paddle_billing_pg/{run.sh,suite.sql}`, this file.
* Rewritten: `supabase/functions/manage-billing/*`, `supabase/functions/_shared/billing-reads.ts`, `development-activity-reports.html` (billing card, Paddle.js, partner offer, dashboard fields, CSP).
* Deleted: `_shared/lemon-billing.ts`, `development-activity-billing-webhook/`, `test/lemon-billing.test.mjs`.
* Edited: `supabase/config.toml`, `.github/workflows/deploy-edge-functions.yml`, `.github/workflows/report-snapshot-suite.yml`.

Ingest repo (`homesignal-ingest`): deleted `supabase/functions/lemonsqueezy-webhook/` and its `config.toml` entry (its `public.subscriptions` table had 0 rows).

## 4. Database migration (NOT applied)

`docs/paddle-billing.sql`: additive, idempotent, with a rollback block. Apply through `db-sql.yml` from `main` (or `apply_migration` from the committed file), never as a rolled-back dry run. It stands on `docs/brokerage-billing.sql` (already applied: its tables exist in production).
Replaces two functions with the same signatures (`payment_event_map_status`: adds a `paddle` branch, keeps `lemonsqueezy` for the three historical test events; `billing_plan_of`: one-time expiry and partner suspension). Seeds the two live price ids.

## 5. Tests run

* `test/paddle_billing_pg/run.sh` on a disposable PostgreSQL 16: the real dependency chain, `brokerage-billing.sql`, then this file. **57 checks pass**, it applies twice with an identical schema, and its rollback runs and re-applies.
* `node test/paddle-billing.test.mjs`: **116 checks pass** (signature incl. replay/rotation/no-secret, binding tampering, translation, both handlers, the real data layers with stubbed fetch).
* Covered: both checkout flows' server side, duplicate and out-of-order events, six monthly allotments then expiry, no rollover, the 101st report refused, cancellation keeping access, full refund, sandbox events never granting, unknown price, plan swap, partner without a link, wrong account, link cap, expired link, failed verification, no PII, anon/authenticated cannot call anything, tables closed to every API role.
* **Not run (could not be):** Paddle sandbox checkouts, real Paddle webhook deliveries, successful and failed card payments against Paddle, a browser test of the overlay. The sandbox is unreachable from this session. Payload shapes follow Paddle's published Billing format and must be confirmed by the first sandbox deliveries.

## 6. What must be done by hand (Paddle dashboard and Supabase)

1. **Sandbox first.** In a Paddle *sandbox* account create the same two prices (no trial). Register their ids:
   `insert into public.billing_plan_price (price_ref, livemode, plan_key, plan_label, kind, access_months) values ('pri_…', false, 'professional', 'Professional', 'recurring', null), ('pri_…', false, 'private_partner', 'Private Partner Offer', 'one_time', 6);`
2. Create a notification destination in each Paddle environment pointing at `https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/paddle-webhook`, subscribed to: `subscription.created`, `.activated`, `.updated`, `.canceled`, `.paused`, `.resumed`, `.past_due`, `.trialing`, `transaction.completed`, `adjustment.created`, `adjustment.updated`. Keep each destination's secret.
3. Set Supabase function secrets (values entered in the Supabase dashboard, never in chat or code): `PADDLE_ENV` (`sandbox` until go-live, then `production`), `PADDLE_CLIENT_TOKEN` (Paddle client-side token: `test_…` / `live_…`), `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET_SANDBOX`, `PADDLE_WEBHOOK_SECRET_LIVE`, `PADDLE_CHECKOUT_BINDING_SECRET` (a new random 32+ byte string).
4. In Paddle, add and get approved the checkout domain (`jodytracks.com`) and set the default payment link. Live website approval is a Paddle-side review: submit pricing, terms, privacy and refund pages.
5. Create the first partner brokerage and link in SQL (store only the hash; give the partner the token):
   `select public.partner_brokerage_create('<brokerage name>');` then `select public.partner_link_create('<partner_id>', encode(sha256(convert_to('<random token ≥16 chars>','UTF8')),'hex'), '<expires>', 50);`. The private link is `https://jodytracks.com/development-activity-reports.html#partner=<token>` (the fragment is never sent to a server).
6. Run the sandbox end-to-end list in section 7, then the live test purchase.
7. **Delete the old deployed functions** from Supabase (no MCP tool deletes functions): `lemonsqueezy-webhook` and `development-activity-billing-webhook` are still ACTIVE in production. Delete them and remove the `LEMONSQUEEZY_*` secrets after Paddle is confirmed.
8. Deploy `manage-billing` and `paddle-webhook` (`deploy-edge-functions.yml`; `paddle-webhook` needs JWT verification off, already set in `config.toml` and the workflow).

## 7. Release gate (do not set `CHECKOUT_ENABLED = true` until all pass)

Sandbox: Professional purchase (card 4242…) → plan paid, 100 reports; failed card → nothing granted; duplicate and replayed webhook (Paddle "replay" button) → one ledger row; cancel in the portal → still paid until the period end, then canceled; refund → revoked; partner link → purchase → paid, six monthly resets (advance with the test clock or by backdating the binding as the SQL suite does), expiry after six months; a partner purchase without the link → nothing granted and listed in `paddle_unmatched_event`; an unpaid account cannot make a paid report.
Then: Paddle live website approval, one live test purchase and refund, confirm `paddle_billing_check()` and `billing_check()` read zero violations.

## 8. Founder decisions of 2026-11-16 and how each is built

| # | Decision | Built as | Proof |
|---|---|---|---|
| 1 | No free plan, no free trial | `evaluation.free_reports_granted` (every existing evaluation keeps `true`; **every new one defaults to `false`**, by any path). `billing_gate` (`paid_required`, `honor_granted_free_reports`): once armed, `brokerage_report_issue` refuses every unpaid report (`EV013 PAID_PLAN_REQUIRED` -> HTTP 402 `payment_required`). A retried key of a report already made still returns it. Reports are never touched. | suite G01-G10 |
| 2 | Re-verify every 30 days, per brokerage; overdue = manual review, never auto-suspend | see section 2 | suite V01-V06 |
| 3 | Terms and Refund Policy updated; customer agrees before buying | `terms.html`, `refund-policy.html` (Paddle Merchant of Record, $78/month, $234/six months, cancellation, expiry, 30-day checks, refunds). The page asks for a tick box; `manage-billing` refuses a checkout without `terms_version`, and `billing_terms_accept` records it (append-only: account, plan, version, time) **before** a session is signed; a stale version is refused (409 `terms_changed`). The version is one value on the page, in `billing_terms_version` and in both legal pages (pinned by `test/legal-pages.test.mjs`). | suite T01-T04, paddle-billing 5aa-5af |
| 4 | Sandbox `test_only` vs the end-to-end paid test | `billing_environment`: a database is `production` (live payments grant, sandbox is `test_only`, as before) or an **isolated staging** database (`staging`: sandbox payments grant, live ones never do). No API role can read or change it; a trigger refuses to change it once the database holds a payment of the other kind. `manage-billing` refuses (503 `billing_environment_mismatch`) when its `PADDLE_ENV` and the database disagree, and (503 `billing_gate_not_armed`) while the gate is off. | suite E01-E07 (E05 runs the whole sandbox scenario in a staging-mode database) |
| 5 | No free-trial promise or Lemon Squeezy on customer-facing pages | `how-it-works.html` ("Free for agents during beta" removed), `development-activity-reports.html` (all trial/free wording), Terms, Refund Policy. `test/legal-pages.test.mjs` scans 13 customer pages (visible text and message strings) for free-plan/trial/beta wording and for Lemon Squeezy anywhere. | legal-pages test |

### The free reports that were already promised (review, decision 1)
Measured read-only on production, 2026-11-16 (counts only): **5 evaluations hold the old promise** (3 brokerage accounts created 2026-10-04..10-12, 2 individual accounts created 2026-10-25 and 2026-11-10), **23 reports used, all 5 still active with reports left**. They keep `free_reports_granted = true`. Until the gate is armed they can still use what is left. **Armed, they cannot** (the instruction is no unpaid generation), unless the operator chooses `billing_gate_set(true, true)`, which honours exactly those 5. List them any time: `select * from public.billing_free_reports_review();`. The old Terms said "Eligible new accounts may receive 100 free evaluation reports": this is the promise to decide on before launch. Whatever is decided, every report already made is preserved.

New accounts created from now on (by individual signup or by the admin "Start a brokerage trial") have **no free reports**, so before checkout opens a new signup can sign in but cannot make a report. That follows the instruction and is a visible product change.

### Sandbox end-to-end test: how to run it without touching production
1. Create a **separate Supabase project** (isolated staging). Apply the same SQL chain, then `update public.billing_environment set mode = 'staging';` (owner SQL; an empty database accepts it).
2. Deploy `manage-billing` and `paddle-webhook` to that project with `PADDLE_ENV=sandbox`, the sandbox client token, API key and **only** the sandbox webhook secret. Register the two sandbox prices with `livemode = false`. Point a Paddle **sandbox** notification destination at that project.
3. Arm its gate: `select public.billing_gate_set(true, false);`. Set `CHECKOUT_ENABLED` true **in the staging deployment only**.
4. Run section 7's list. A sandbox purchase now shows plan `paid`; the production database never grants for a sandbox payment (and `PADDLE_ENV=sandbox` against it is refused at checkout).
Never run the sandbox list against the production project: there a sandbox payment is `test_only` by design.

## 9. Remaining blockers (nothing is merged, applied or deployed)
* **Paddle sandbox end-to-end has NOT been run.** `sandbox-api.paddle.com` is unreachable from this session, and the isolated staging project above does not exist yet. The SQL scenario (E05) and the handler tests prove the logic; they do not prove Paddle's real payload shapes or signatures. This is the release blocker.
* **The Refund Policy text needs the founder's confirmation.** It states: cancel any time, no partial-period refunds, no refund of unused partner months, refund of mistaken or duplicate charges and anything the law requires, a full refund ends access. The money-back terms are a business decision that was not given; the wording is conservative and is on the page as written.
* **The 5 promised free accounts** (above) need a decision before the gate is armed.
* **Migration `docs/paddle-billing.sql` is NOT applied** and needs review. It also replaces `brokerage_paid_credit_guard`, `billing_plan_of` and `evaluation_usage`, and splices `brokerage_report_issue` and `billing_check` from their live definitions (fail-closed, with an exact rollback, tested).
* **Overdue partner checks reach a human only through `partner_verification_due()` and `paddle_billing_check()`.** They are not yet wired into the hourly health monitor; that is a splice of a live function and was not done here.
* **Deploy:** the new `payment_required` answer and the Terms version need the report function and `manage-billing` deployed together with the SQL; the order is in section 6.
* `homesignalmap.html` still ends a paywall sentence with "Free during launch." (the older paid-map product, whose Lemon webhook this work removes). It is not a Development Activity plan and was left; say if it should go.
* `homesignal-ingest` #1141's `step2a-isolation-db` check fails on unclassified `dc_*` objects already in the live database; it is not caused by the deletion of the Lemon function.

## 10. Five free-report allowances were revoked in production on 2026-11-27 — REOPEN BEFORE CHECKOUT (founder decision "option 2")

Founder instruction: the five accounts that still had free reports (two the founder's own, three real outside users) must pay to make reports, and their emails must not be blocked if they pay. In production, before this migration exists, the only removal tool was `public.evaluation_revoke`, so these five evaluations were REVOKED (nothing deleted: 7 accounts, 7 evaluations, 28 reports and 28 usage entries before and after).

A revoked evaluation is terminal, and `brokerage_report_issue` refuses a revoked evaluation even with a paid plan ("a payment cannot reopen an account HomeSignal ended"). So these five cannot report, even after paying, until they are reopened.

| account | owner | evaluation_id |
|---|---|---|
| Brigham City Test Realty | founder | 04cd5fe1-c3a9-4fea-9991-6be7ad95cef0 |
| Cheryl | founder | 2bd665ce-e252-45e9-9498-b0ffb2fb8e53 |
| Dinkle Properties | outside user | 5edce01f-b333-496c-a9e5-04e77b753e9d |
| Bob Bemis | outside user | 6232a760-0233-4896-98d0-8d136f5bbb77 |
| GBRAR | outside user | 19b5a849-4ccf-4079-b3d3-f755f1135bff |

**Required before `CHECKOUT_ENABLED` is set:** apply `docs/paddle-billing.sql` (so free reports are a cleared flag, not the evaluation's status), then reopen these five evaluations by an explicit, logged, exact-ID edit (status back to `active`, `revoked_at` null; the revoked-is-terminal guard must be bypassed for that one statement) and confirm `free_reports_granted` is false on each, so they hold no free reports but can pay. The "Founder Test Workspace" and "Brigham City Test Realty 2" evaluations were not touched.

### 10a. Exact SQL to reopen the five evaluations (NOT RUN; run only after `docs/paddle-billing.sql` is applied and the founder says "go reopen", which is a separate approval after "go migration")

*Dated note, 2026-11-28:* prepared, read-only checked against production on 2026-11-28 (all five rows `revoked` at 2026-11-27 18:45:14Z, `evaluation_guard_trg` enabled and the only thing that blocks reopening). Not run. The migration ("go migration") and this reopen ("go reopen") are two separate steps with two separate approvals.

`evaluation_guard` makes `revoked` terminal, so the guard trigger is disabled inside one transaction for these five exact IDs only, then enabled again. `free_reports_granted` is set false so they hold no free reports. The transaction aborts unless exactly 5 rows change. The original `revoked` events stay in `evaluation_event` (it is append-only and its kind list has no "reopened", so no new event is invented).

```sql
begin;
alter table public.evaluation disable trigger evaluation_guard_trg;
with ids(evaluation_id) as (values
  ('04cd5fe1-c3a9-4fea-9991-6be7ad95cef0'::uuid),
  ('2bd665ce-e252-45e9-9498-b0ffb2fb8e53'),
  ('5edce01f-b333-496c-a9e5-04e77b753e9d'),
  ('6232a760-0233-4896-98d0-8d136f5bbb77'),
  ('19b5a849-4ccf-4079-b3d3-f755f1135bff'))
update public.evaluation e
   set status = 'active', revoked_at = null, free_reports_granted = false
  from ids
 where e.evaluation_id = ids.evaluation_id and e.status = 'revoked';
do $$ declare n int; begin
  select count(*) into n from public.evaluation
   where evaluation_id in ('04cd5fe1-c3a9-4fea-9991-6be7ad95cef0','2bd665ce-e252-45e9-9498-b0ffb2fb8e53','5edce01f-b333-496c-a9e5-04e77b753e9d','6232a760-0233-4896-98d0-8d136f5bbb77','19b5a849-4ccf-4079-b3d3-f755f1135bff')
     and status = 'active' and revoked_at is null and free_reports_granted = false;
  if n <> 5 then raise exception 'expected 5 reopened evaluations, got %', n; end if;
end $$;
alter table public.evaluation enable trigger evaluation_guard_trg;
commit;
```

Read-back after: those five show `status active`, `free_reports_granted false`, trigger `evaluation_guard_trg` enabled (`tgenabled = 'O'`), and 7 accounts, 7 evaluations, 28 reports, 28 usage entries unchanged.

## 11. Pre-checkout list: complimentary access for Veronica and Devin (production step, NOT DONE)

Founder decision (2026-11-27): Veronica and Devin get named complimentary access, an exception, not a plan. After `docs/paddle-billing.sql` is applied, the database owner inserts one `public.billing_complimentary` row for each: the account's `brokerage_id`, a reason of at least 8 characters, `approved_by` the founder, and an expiry or an explicitly recorded "no expiry". Look up the two `brokerage_id` values first (read-only, by the accounts' own emails) and confirm them with the founder; they are not guessed here. Confirm after: `billing_complimentary_active(brokerage_id)` is true for these two and false for every other account, and `billing_gate` is unchanged.

### 11a. Founder decision, 2026-11-28: Veronica and Devin get FREE accounts, December 1 to December 31, 2026 (production step, NOT DONE)

Veronica (veronica@bolorealtors.com) and Devin (dbacon@nwmls.com) never pay and never see checkout **while the exception lasts**: from December 1, 2026 to the end of December 31, 2026, America/Los_Angeles (`complimentary_expiry=2026-12-31`, stored as `2027-01-01 07:59:59+00`). After that each account is a normal account and must pay: the exception simply stops counting (`billing_complimentary_active` is false once `expires_at` passes), nothing is deleted, and there is no renewal.

Order: (1) "go migration"; (2) they sign up as individuals; (3) read-only look-up of the two brokerage IDs, shown to the founder; (4) the two grant statements below are shown to the founder with the real IDs and run only after approval.

**Start date.** The table has no start column, so a grant is live the moment it runs. To honour "from December 1", the two grants are run on or after December 1, 2026 (Los Angeles). A sign-up before then gets no exception until then.

Grant statements (IDs filled in only after the look-up; not run):

```sql
select public.billing_complimentary_grant('<veronica brokerage_id>'::uuid, 'complimentary access December 2026, approved by founder', 'founder', timestamptz '2027-01-01 07:59:59+00');
select public.billing_complimentary_grant('<devin brokerage_id>'::uuid,    'complimentary access December 2026, approved by founder', 'founder', timestamptz '2027-01-01 07:59:59+00');
```

The staging seed (`docs/paddle-billing-staging-seed.sql`, staging only) takes the same `complimentary_expiry=2026-12-31` and its test pins the same instant.

**Known gap, to build before launch:** the exception is enforced in SQL only (`billing_free_reports_usable`). No page or function reads `billing_complimentary_active`, so these two could make reports but would still be shown checkout. Hiding checkout for an account with an open exception needs a code change (billing summary and billing page); not done.

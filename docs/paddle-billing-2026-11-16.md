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
* **Periodic membership verification:** every partner enrollment gets a `next_verification_at` (90 days). `partner_verification_due()` lists those due; `partner_enrollment_verify(id, 'verified'|'failed')` records the operator's check. `failed` suspends access immediately. Nothing is revoked automatically when a check is merely overdue.
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

## 8. Decisions left for the founder

* **Free evaluation reports still exist in the backend.** `individual_signup` still creates the account's free evaluation (the 100 "free" reports a new individual gets) and `brokerage_report_issue` still uses it when an account has no paid plan. Public pages no longer advertise a free plan, but an unpaid signed-in user can still generate reports from that allowance. To end it, stop issuing evaluations at signup or set the free limit to 0. Paid credits are unaffected: no unpaid account receives paid credits.
* Partner re-verification interval (90 days) and whether an overdue check should suspend automatically.
* Whether the Paddle webhook should also be recorded for the old map-product `public.subscriptions` table (not needed for this launch; it had no rows).

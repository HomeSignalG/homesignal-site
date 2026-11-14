# Paddle billing, the Private Partner six-month grant, and refunds (2026-11-14)

Paddle replaces Lemon Squeezy for Development Activity billing. **Checkout stays OFF** (`_shared/billing-switch.ts` `CHECKOUT_ENABLED = false`) and
`docs/paddle-billing.sql` is **NOT applied to production** until the launch gate below passes.

## The offers (founder's words, 2026-11-14)

| Offer | Price | Access | Paddle price id |
|---|---|---|---|
| Professional | $78 USD / month, recurring | 100 reports a month, no trial | `pri_01m7d6kede6hqr2kh9b78mb25j` |
| Private Partner Offer | $234 USD once | six calendar months of Professional, 100 reports a month, no renewal, no trial; an INDIVIDUAL agent offer | `pri_01m7d6q4yw2yzygm5cz92s5abg` |
| Brokerage & Enterprise | custom quote | nothing is sold by the site | none |

The Private Partner Offer uses its own one-time price. There is no discount code. It is **not on the public pricing page**: the page copy has no
prices (free-only copy rule), and the button appears only to a signed-in individual account whose checkout is available.

## How it works

* Checkout: the server makes a draft Paddle transaction for one brokerage and one offer (`manage-billing`, body `{action:'checkout', offer}`), with the
  brokerage id and an HMAC signature in `custom_data`. The page loads Paddle.js on return (`?_ptxn=`) with the PUBLIC client token.
* Webhook (`development-activity-billing-webhook`): verifies `Paddle-Signature` over the raw body, translates the event, records it through
  `billing_event_apply`. A payment with no valid signature in its custom data is ignored.
* Six months: the length (`access_months`) is fixed by the server from the price id, never from a payload. After it, the plan reads `expired` and
  reports use the free evaluation. The credit guard also refuses a paid credit for month 7.
* Refunds and chargebacks (Paddle "adjustments", which carry no custom data): found through the grant's own transaction id (`billing_grant_of`).

### Refund and chargeback rules (explicit)

| Paddle adjustment | Effect on access |
|---|---|
| Approved FULL refund of the grant's transaction | access ends for that purchase |
| PARTIAL refund (any amount) | **no change**; acknowledged and recorded nowhere |
| Pending or rejected refund | none |
| Approved chargeback (any amount) | access ends for that purchase |
| Chargeback warning | none |
| Chargeback reversed | access restored; **never extended** (the six months still count from the original purchase) |
| Any adjustment on a transaction that is not a one-time grant (a subscription renewal, another product) | none (`no_grant`) |

A refund of one monthly Professional charge does not cancel the subscription; the subscription's own Paddle events do. Only the entitlement bound under
the adjusted transaction can change.

## Migration review: `docs/paddle-billing.sql` against production (read-only, 2026-11-14, project `qwnnmljucajnexpxdgxr`)

Measured before: 5 brokerage accounts (2 individual), 1 binding (Lemon Squeezy, test mode), 3 ledger events (all Lemon, test mode), 0 paid credits,
`access_months` absent, no view or function depends on `billing_usage`. Functions on file: `billing_event_apply(uuid,jsonb)` `3e306fcf…`, `billing_plan_of`
`2341dca5…`, `billing_usage` `9bccd367…`, `brokerage_paid_credit_guard` `13e8b436…`, `payment_event_map_status` `2ad78fa6…`.

Effects: adds a nullable column and a check; replaces five functions (adds a Paddle branch to the status map and keeps the Lemon one; `expired` state; credit
guard; new 3-argument writer; `billing_usage` gains `access_ends_at`); adds `billing_grant_of`. Grants stay `service_role` only.

Existing-user impact: none visible. Every existing binding has `access_months` NULL (recurring, unchanged). The one Lemon binding is test mode and reads
`test_only` exactly as before; the three stored ledger rows keep their generated `mapped_status`. No data is rewritten. The 2-argument `billing_event_apply`
stays and means "recurring". `billing_usage` is dropped and recreated (a column is added); nothing else depends on it, and it is re-granted in the same file.

Failure and recovery: the file is one transaction per statement group and fails closed on its own postconditions. If it fails part-way, re-run it (idempotent).
To undo: the rollback block at its foot (refuses once a grant exists) restores the earlier function bodies from `docs/brokerage-billing.sql` and
`docs/payment-event-ledger.sql`; the column can then be dropped. Take the five function definitions' `pg_get_functiondef` before applying.

Tested on a disposable Postgres with the real earlier layers (`test/paddle_billing_pg`): 34 checks, apply-twice, refuses without its layers, 16 deliberate breaks each caught.

## Launch gate (all must pass in a SANDBOX/STAGING environment before checkout is enabled)

Sandbox purchase of each offer · account binding (a forged binding is ignored) · 100-report allowance · monthly renewal · cancellation · six-month expiry ·
full refund, partial refund, chargeback and reversal · duplicate webhook delivery. Sandbox and live are separate Paddle accounts with separate keys, price ids,
webhook secrets and client tokens; the function reads which one it is from `PADDLE_ENVIRONMENT` and never from a payload. Sandbox events are recorded with
`livemode = false`, which the plan reads as `test_only` (no reports), so a sandbox event can never grant access in production.

## Secrets (names only; values never in chat or git)

`PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_PRICE_PROFESSIONAL`, `PADDLE_PRICE_PARTNER`, `PADDLE_ENVIRONMENT` (`sandbox` or `production`), `PADDLE_CLIENT_TOKEN`.

## Not done / open

* The old Paddle prices (Pro Annual $780, B&E Monthly $234, B&E Annual $2,340) are still active until their dependents are checked.
* The 50% discount was never created (the API key cannot manage discounts); the Private Partner Offer does not need one.
* Nothing has been exercised against a real Paddle sandbox yet.

---

## Paid-only new registrations and the Professional-only public flow (from the pricing session's PR #2919, merged into this document)

# Paddle billing and paid-only individual signup (2026-11-14)

Status: BUILT AND TESTED OFFLINE. NOT LIVE. `CHECKOUT_ENABLED = false` in `supabase/functions/_shared/billing-switch.ts`.
Nothing in this file is applied to production. Founder instruction: keep checkout disabled until end-to-end Paddle SANDBOX testing passes.

## The offer
Professional: **$78 USD per month**, recurring, **100 reports per monthly billing period**, the existing **0.5-mile** radius, **no free trial**.
Brokerage & Enterprise: custom pricing, "Request a Quote" (contact page). The private $234 six-month partner offer is NOT on any public page and
`PARTNER_OFFER_ENABLED = false` keeps it out of the signed-in Billing card and out of manage-billing (the webhook still understands a grant).

## What exists (reconciled 2026-11-14)
| Piece | Where | State |
|---|---|---|
| Pricing page (two cards, quote link) | `development-activity.html`, PR #2915 | LIVE since 2026-11-14 15:2xZ (checked on the live host) |
| Paddle adapter (signature, checkout request, webhook translation, binding) | `supabase/functions/_shared/paddle-billing.ts` | written by the earlier session (branch `claude/laughing-shannon-53ecgd`, commit `dcf52308`, never merged, no PR); merged into this branch; unit-tested |
| `manage-billing`, `development-activity-billing-webhook` | `supabase/functions/*` | Paddle versions, JWT on / off as before; NOT deployed |
| Paddle SQL (ledger map, six-month grant) | `docs/paddle-billing.sql` | NOT applied; suite `test/paddle_billing_pg` passes (27 checks) |
| Paid-only individual signup | `docs/paid-only-individual-signup.sql` | NOT applied; suite `test/paid_only_signup_pg` passes (20 checks) |
| Paddle catalog (product, $78 price) | Paddle dashboard | **UNVERIFIED**: no Paddle credential exists in this environment, so the catalog could not be read. Another session reported creating the price; its id is not in the repo. Nothing was created here. |

## Apply order (when the founder approves)
1. Review and apply `docs/paddle-billing.sql` (additive; rollback in its footer).
2. Review and apply `docs/paid-only-individual-signup.sql` (additive; impact and recovery in its header; it prints before/after counts and refuses on any mismatch).
3. Set the function secrets (see the list below), deploy `manage-billing` and `development-activity-billing-webhook`.
4. Run the Paddle SANDBOX test (below). Only then edit `billing-switch.ts` (`CHECKOUT_ENABLED = true`) in a reviewed PR and deploy.

## Enforcement (database, not page copy)
- A new individual account is created with `evaluation.free_reports = false` (only `individual_signup` creates one). Existing evaluations read TRUE and keep their free reports.
- `evaluation_report_issue` refuses such an account (EV002 EVALUATION_COMPLETE); `brokerage_report_issue` reaches it for every non-paid account, so there is no free path.
- `evaluation_usage` reports 0 free reports for it, so the report function's own pre-check refuses before anything is geocoded or charged.
- A paid plan (`billing_plan_of.state = 'paid'`, from a LIVE signed Paddle event bound to the brokerage by a HomeSignal-made checkout signature) opens exactly 100 reports per billing period; the 101st is `ALLOTMENT_COMPLETE`. Cancelling ends access; it does not fall back to a free report.
- A Paddle SANDBOX event is recorded with `livemode = false` (the deployed `PADDLE_ENVIRONMENT`, never the payload) and reads `test_only`: it can never grant access in production.

## Sandbox end-to-end test (what proves it, and what each step needs)
1. Checkout: a signed-in OWNER account presses Subscribe -> `manage-billing` asks Paddle (sandbox API) for a transaction with the brokerage id and its signature in `custom_data` -> the page opens Paddle's checkout with the sandbox client token.
2. Pay with a Paddle sandbox test card.
3. Paddle sends `subscription.created` / `subscription.activated` to the webhook; the signature (`Paddle-Signature: ts;h1`) must verify under the sandbox notification secret.
4. Read the ledger: the event is recorded for that brokerage with `livemode = false` -> state `test_only`. **That is the correct sandbox result.** It proves checkout creation, the price id, signature verification and account binding against Paddle's real payload shapes.
5. The 100-report allowance and cancel behaviour are proven on a disposable database with LIVE-mode events (suites above), because a sandbox event must not grant production access.
6. Compare the first real payload with the shapes in `paddle-billing.ts` (header comment lists exactly what to look at); any difference makes the webhook answer 422 loudly rather than guess.

## Remaining credentials and dashboard actions (do one at a time)
See the final report of the session that wrote this file. In short: Paddle sandbox API key; the Professional price id (check the catalog first); a notification destination pointing at the webhook (its secret); a client-side token; the checkout page domain approved in Paddle; then the same set for live.

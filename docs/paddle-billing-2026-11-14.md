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

# Paddle billing for Development Activity (2026-11-14)

Professional: **$78 USD per month**, 100 reports per monthly billing period, 0.5-mile radius, no trial, no annual option.
Brokerage & Enterprise: Custom Pricing, "Request a Quote" -> `contact.html`. The $234 partner offer is not on any public page.
Lemon Squeezy customers keep working; Paddle is used only where its settings are present.

## Flow
1. Page `development-activity-reports.html` (loads Paddle.js; `/pricing` does not exist). The landing page `development-activity.html` links to `#billing` there.
2. Sign-in or account creation is required. An individual account (`individual_signup`) needs no brokerage.
3. `manage-billing` `{action:"paddle_checkout"}` makes the transaction **on the server** (`custom_data` carries a signed binding to the brokerage). The browser only gets environment, public client token, `txn_` id and calls `Paddle.Checkout.open`.
4. Access comes ONLY from the signed webhook `development-activity-paddle-webhook` (raw body, `Paddle-Signature` HMAC-SHA256, live and sandbox secrets separate; sandbox events are recorded `test_only` and never grant). Duplicates and out-of-order events are handled by the ledger (`payment_event`). Refund (full, approved) and chargeback end access; cancel/expire end it; a later genuine active event restores it. The monthly allowance resets from the binding date in whole months (existing `billing_period_index`).
5. The page polls the plan after `checkout.completed` and shows "active" only when the database says paid.

## Default payment URL
`https://jodytracks.com/development-activity-reports.html` (approve this domain in Paddle > Checkout settings).

## Environment names
- Edge Function secrets: `PADDLE_CHECKOUT_ENVIRONMENT` (live|sandbox), `PADDLE_API_KEY_LIVE/_SANDBOX`, `PADDLE_CLIENT_TOKEN_LIVE/_SANDBOX`, `PADDLE_PRICE_ID_LIVE/_SANDBOX`, `PADDLE_WEBHOOK_SECRET_LIVE/_SANDBOX`.
- Repo Actions variables (public values): `PADDLE_ENVIRONMENT`, `PADDLE_CLIENT_TOKEN` -> written into `paddle-config.js` at build.
- Webhook URL: `https://<project>.supabase.co/functions/v1/development-activity-paddle-webhook`; events `subscription.*`, `adjustment.*`.

## Kill switches (both committed false)
`CHECKOUT_ENABLED` (live) and `PADDLE_SANDBOX_CHECKOUT_ENABLED` (`_shared/billing-switch.ts`). Live stays off until a sandbox purchase activates the right account and allowance.

## Not yet verified against real Paddle Sandbox
Adjustment enum values, `custom_data` inheritance to subscriptions, retry re-signing (tolerance is 300 s), the CSP hosts on the reports page, `?_ptxn=` auto-open, email prefill with a transaction id.

## Apply order
`docs/paddle-billing.sql` (additive, through `db-sql.yml` from main) -> deploy `development-activity-paddle-webhook` and `manage-billing` -> set secrets -> sandbox test -> flip switches in a reviewed commit.

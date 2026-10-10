# Payment provider audit: the Lemon Squeezy code against the Paddle plan (2026-10-09)

**Corrects an earlier error in `CUTOVER-CHECKLIST.md`:** the intended payment provider is **Paddle**, not Lemon Squeezy. The checklist's old "Lemon Squeezy dashboard" item was wrong and is removed.
Nothing here activates Lemon Squeezy, adds Paddle code, or enables payments. Live Paddle approval and working billing are **separate gates** from the Jody launch.

**Scope and honesty.** The repository contains no Paddle migration plan document (searched both repos; the only Paddle mentions are the legal-pages readiness test and a registry string), so this audits the *code* against what Paddle Billing requires of an integration. The Paddle-side facts below come from Paddle's published Billing API as I know it; the build sandbox cannot reach `developer.paddle.com`, so every Paddle fact is marked **verify** and is confirmed by the first Paddle **Sandbox** test event, exactly as the existing code already says of Lemon Squeezy's shapes.

## What exists, and what is Lemon-specific

| Piece | Where | Lemon-specific? | Paddle work |
|---|---|---|---|
| Brokerage billing (Development Activity): checkout, webhook, status | `supabase/functions/_shared/lemon-billing.ts`, `manage-billing/*`, `development-activity-billing-webhook/*` | **Yes, all provider shapes live in `lemon-billing.ts`** (its header says so). Handlers, data layer and DB are provider-neutral. | Replace the one module with a Paddle twin; wiring files change only env names and the module import. |
| Payment event ledger | `docs/payment-event-ledger.sql` (`payment_event`, `payment_event_map_status`) | **Neutral by design** (`processor` column; unique `(processor, idempotency_key)`). One `lemonsqueezy` branch in the status map. | Additive reviewed migration: add a `paddle` branch to `payment_event_map_status`. No table change. |
| Entitlement / allotments | `docs/brokerage-billing.sql` | No (the DB decides paid-ness from the ledger) | None expected. |
| User-scoped paid map-page subscription | ingest `supabase/functions/lemonsqueezy-webhook`, `public.subscriptions` (`processor default 'lemonsqueezy'`), `get-address-report` gate | **Yes** (a separate, older product) | A Paddle webhook of its own, or retire. **Separate decision**; not needed for the Jody launch. |
| Billing page | `development-activity-reports.html` (CSP `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`, `default-src 'self'`) | Checkout is a server-made URL the browser navigates to (host check: `lemonsqueezy.com`) | If Paddle's **hosted** `checkout.url` is used (navigation), CSP needs no change; the host allow-list changes to Paddle's domains. If Paddle.js **overlay** is used, CSP must add `https://cdn.paddle.com` (script) and Paddle's checkout frame hosts (frame-src), and a client-side token is shipped. Recommend the hosted URL: no CSP change, no client token. |
| Checkout return page | `BILLING_PAGE` constant, `https://homesignal.net/...#billing` | Provider-neutral, brand-bound | Moves to the Jody host in Step 8; both domains are already approved in Paddle Sandbox. |

## Provider differences the Paddle build must handle (all **verify** in Sandbox)

1. **Signature.** Lemon: `X-Signature` = hex HMAC-SHA256 of the raw body. Paddle Billing: header `Paddle-Signature: ts=<unix>;h1=<hex>`, where `h1` is HMAC-SHA256 of `"<ts>:<raw body>"` under the notification destination's secret. Needs a timestamp-tolerance rule that Lemon's verifier does not have. (Paddle *Classic* uses an RSA public key instead; confirm the account is Billing.)
2. **Envelope.** Lemon: `meta.event_name`, `data.attributes.*`. Paddle: top-level `event_id`, `event_type` (`subscription.created|activated|updated|canceled|paused|resumed|past_due|trialing`), `occurred_at` (RFC 3339, has an offset), `data.id` (`sub_...`), `data.status`, `data.items[].price`, `data.custom_data`.
3. **Event name separators and spelling.** Dots, and `canceled` (one *l*); the ledger's `event_name` and `processor_status` patterns are `[a-z_]` only. The adapter must map `subscription.canceled` into the ledger's vocabulary (or the ledger's pattern is widened in the same reviewed migration).
4. **Status words.** Lemon `on_trial, active, paused, past_due, unpaid, cancelled, expired`; Paddle `trialing, active, past_due, paused, canceled`. The ledger maps by processor, so this is the `paddle` branch above.
5. **Idempotency.** Lemon has no per-delivery id, so the key is `event:id:updated_at`. Paddle gives a unique `event_id` per event; use it. The existing reference regex allows `evt_...`.
6. **Test versus live.** Lemon marks `test_mode` in each payload and the code reads it into `livemode`. Paddle Sandbox and Live are **separate environments with separate endpoints, keys and secrets**; the payload is not relied on to say which. `livemode` must come from *which secret verified the delivery*, never from the body. **A Sandbox event must be unable to mark a brokerage paid in production.**
7. **Binding.** The signed `{brokerage_id, bind}` rides in checkout `custom_data` in both; Paddle returns `data.custom_data`. The `verifyBinding` logic is reusable as is.
8. **Plan identity.** Lemon `variant_id`; Paddle `price.id` (and `product_id`). Config variable changes only.
9. **"Manage billing".** Lemon exposes a customer-portal URL; Paddle issues authenticated portal-session links through its API. A new, small call in `manage-billing`.
10. **Tax / merchant of record.** Both are MoR; no code difference.

## Gates (separate, in order; none is part of the Jody GO LIVE)

1. **Paddle Sandbox build**: write the Paddle adapter + ledger migration + tests against captured Sandbox payloads. *Needs from the founder (only when this gate starts):* Sandbox API key, notification-destination secret, price id, as Supabase function secrets. No code can be proven without a real captured payload.
2. **Paddle live website approval** for the live account (domain approval exists in Sandbox for both domains; live is separate).
3. **Live billing** switched on: a founder decision after 1 and 2, with a live test purchase.

Until gate 3, billing stays as it is today. The code paths named above are not activated by the Jody cutover.

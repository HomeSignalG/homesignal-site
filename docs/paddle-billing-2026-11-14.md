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

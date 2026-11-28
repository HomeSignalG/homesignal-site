// paddle-webhook — Paddle's signed events, recorded for the account a HomeSignal checkout named.
//
// Wiring only. The request logic is handler.ts, the database calls are data.ts, every shape Paddle has is _shared/paddle-billing.ts. JWT verification is
// OFF for this function (supabase/config.toml and the deploy workflow): Paddle sends no Supabase token, and the gate is Paddle's own HMAC signature
// over the raw body, checked before the body is parsed. The three secrets below are read here and nowhere else; none is printed, returned or logged.
// PADDLE_WEBHOOK_SECRET_LIVE      the production notification destination's secret (a delivery it signs is LIVE)
// PADDLE_WEBHOOK_SECRET_SANDBOX   the sandbox notification destination's secret (a delivery it signs is TEST and never grants)
// PADDLE_CHECKOUT_BINDING_SECRET  signs the checkout's custom data (shared with manage-billing)
// Docs: docs/paddle-billing-2026-11-16.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';
import { withSafeLog } from '../_shared/safe-log.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const secrets = { live: Deno.env.get('PADDLE_WEBHOOK_SECRET_LIVE') ?? '', sandbox: Deno.env.get('PADDLE_WEBHOOK_SECRET_SANDBOX') ?? '' };
const bindingSecret = Deno.env.get('PADDLE_CHECKOUT_BINDING_SECRET') ?? '';

// one fixed-text log line per request (name, status, milliseconds): _shared/safe-log.ts. Nothing from the request or the answer is ever logged.
Deno.serve(withSafeLog('paddle-webhook', makeHandler(makeDeps({ url, serviceKey, secrets, bindingSecret }, (input, init) => fetch(input, init))), (line) => console.log(line), () => Date.now()));

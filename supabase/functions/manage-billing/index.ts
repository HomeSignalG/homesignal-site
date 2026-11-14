// manage-billing — a brokerage member reads their plan, and a brokerage OWNER starts the $79 a month checkout (build step 11).
//
// Wiring only. The request logic is handler.ts, the reads are data.ts, every plan read is _shared/billing-reads.ts (the same module the report gate
// uses), every shape the processor has is _shared/lemon-billing.ts, and the gate is _shared/admin-gate.ts. JWT verification stays ON
// (supabase/config.toml), and the handler additionally requires a real signed-in user: the anon key passes the gateway, so the gateway alone is not a gate.
// The four settings below are read here and nowhere else; none is ever printed, returned or logged. When any is missing the checkout is
// "not set up" and every request for it is refused: the function fails closed.
// Docs: docs/development-activity-billing-2026-10-04.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';
import { withSafeLog } from '../_shared/safe-log.ts';
import { CHECKOUT_ENABLED, PADDLE_SANDBOX_CHECKOUT_ENABLED } from '../_shared/billing-switch.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const billing = {
  apiKey: Deno.env.get('LEMONSQUEEZY_API_KEY') ?? '',
  storeId: Deno.env.get('LEMONSQUEEZY_STORE_ID') ?? '',
  variantId: Deno.env.get('LEMONSQUEEZY_BILLING_VARIANT_ID') ?? '',
  secret: Deno.env.get('LEMONSQUEEZY_BILLING_WEBHOOK_SECRET') ?? '',
  testMode: (Deno.env.get('LEMONSQUEEZY_TEST_MODE') ?? '') === 'true',
};

// Paddle (docs/paddle-billing-2026-11-14.md): ONE environment per deployment (PADDLE_CHECKOUT_ENVIRONMENT = live | sandbox), and that environment's four settings. Missing or
// mismatched (a client token whose prefix is not the environment's) means Paddle is "not set up" and the Paddle checkout is refused.
const env = (Deno.env.get('PADDLE_CHECKOUT_ENVIRONMENT') ?? '').toLowerCase();
const live = env === 'live', sandbox = env === 'sandbox';
const paddle = {
  environment: (live ? 'live' : sandbox ? 'sandbox' : '') as 'live' | 'sandbox' | '',
  apiKey: live ? (Deno.env.get('PADDLE_API_KEY_LIVE') ?? '') : sandbox ? (Deno.env.get('PADDLE_API_KEY_SANDBOX') ?? '') : '',
  clientToken: live ? (Deno.env.get('PADDLE_CLIENT_TOKEN_LIVE') ?? '') : sandbox ? (Deno.env.get('PADDLE_CLIENT_TOKEN_SANDBOX') ?? '') : '',
  priceId: live ? (Deno.env.get('PADDLE_PRICE_ID_LIVE') ?? '') : sandbox ? (Deno.env.get('PADDLE_PRICE_ID_SANDBOX') ?? '') : '',
  secret: live ? (Deno.env.get('PADDLE_WEBHOOK_SECRET_LIVE') ?? '') : sandbox ? (Deno.env.get('PADDLE_WEBHOOK_SECRET_SANDBOX') ?? '') : '',
};

// one fixed-text log line per request (name, status, milliseconds): _shared/safe-log.ts. Nothing from the request or the answer is ever logged.
Deno.serve(withSafeLog('manage-billing', makeHandler({ ...makeDeps({ url, serviceKey, billing, paddle, paddleSandboxCheckoutEnabled: PADDLE_SANDBOX_CHECKOUT_ENABLED, checkoutEnabled: CHECKOUT_ENABLED }, (input, init) => fetch(input, init)), checkoutEnabled: () => CHECKOUT_ENABLED }), (line) => console.log(line), () => Date.now()));

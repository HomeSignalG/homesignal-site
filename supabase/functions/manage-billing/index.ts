// manage-billing — a brokerage member reads their plan, and a brokerage OWNER starts a Paddle checkout for the $78 a month plan or the $234 six-month Private Partner Offer (build step 11).
//
// Wiring only. The request logic is handler.ts, the reads are data.ts, every plan read is _shared/billing-reads.ts (the same module the report gate
// uses), every shape the processor has is _shared/paddle-billing.ts, and the gate is _shared/admin-gate.ts. JWT verification stays ON
// (supabase/config.toml), and the handler additionally requires a real signed-in user: the anon key passes the gateway, so the gateway alone is not a gate.
// The settings below are read here and nowhere else; none is ever printed, returned or logged. When any is missing the checkout is
// "not set up" and every request for it is refused: the function fails closed.
// Docs: docs/development-activity-billing-2026-10-04.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';
import { withSafeLog } from '../_shared/safe-log.ts';
import { CHECKOUT_ENABLED } from '../_shared/billing-switch.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const env = Deno.env.get('PADDLE_ENVIRONMENT') ?? '';
const billing = {
  apiKey: Deno.env.get('PADDLE_API_KEY') ?? '',
  secret: Deno.env.get('PADDLE_WEBHOOK_SECRET') ?? '',
  prices: { professional: Deno.env.get('PADDLE_PRICE_PROFESSIONAL') ?? '', partner: Deno.env.get('PADDLE_PRICE_PARTNER') ?? '' },
  environment: (env === 'production' || env === 'sandbox' ? env : '') as 'production' | 'sandbox' | '',
  clientToken: Deno.env.get('PADDLE_CLIENT_TOKEN') ?? '',
};

// one fixed-text log line per request (name, status, milliseconds): _shared/safe-log.ts. Nothing from the request or the answer is ever logged.
Deno.serve(withSafeLog('manage-billing', makeHandler({ ...makeDeps({ url, serviceKey, billing }, (input, init) => fetch(input, init)), checkoutEnabled: () => CHECKOUT_ENABLED }), (line) => console.log(line), () => Date.now()));

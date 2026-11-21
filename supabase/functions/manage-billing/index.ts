// manage-billing — a member reads their plan, and an OWNER asks for a signed Paddle checkout (Professional $78/month, or the private partner offer).
//
// Wiring only. The request logic is handler.ts, the reads are data.ts, every plan read is _shared/billing-reads.ts, every shape Paddle has is
// _shared/paddle-billing.ts, and the gate is _shared/admin-gate.ts. JWT verification stays ON (supabase/config.toml), and the handler additionally requires a
// real signed-in user: the anon key passes the gateway, so the gateway alone is not a gate. The settings below are read here and nowhere else; none but the
// public client token is ever returned. When any checkout setting is missing the checkout is "not set up" and every request for it is refused.
//   PADDLE_ENV                       'production' or 'sandbox' (anything else, or nothing, is SANDBOX: the safe side)
//   PADDLE_CLIENT_TOKEN              Paddle's public client-side token (live_... / test_...): meant for the browser
//   PADDLE_API_KEY                   the server API key, used only to ask Paddle for a subscription's management addresses
//   PADDLE_CHECKOUT_BINDING_SECRET   signs the checkout's custom data (shared with paddle-webhook)
// Docs: docs/paddle-billing-2026-11-16.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';
import { withSafeLog } from '../_shared/safe-log.ts';
import { CHECKOUT_ENABLED } from '../_shared/billing-switch.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const paddle = {
  environment: ((Deno.env.get('PADDLE_ENV') ?? '') === 'production' ? 'production' : 'sandbox') as 'production' | 'sandbox',
  clientToken: Deno.env.get('PADDLE_CLIENT_TOKEN') ?? '',
  apiKey: Deno.env.get('PADDLE_API_KEY') ?? '',
  bindingSecret: Deno.env.get('PADDLE_CHECKOUT_BINDING_SECRET') ?? '',
};

// one fixed-text log line per request (name, status, milliseconds): _shared/safe-log.ts. Nothing from the request or the answer is ever logged.
Deno.serve(withSafeLog('manage-billing', makeHandler({ ...makeDeps({ url, serviceKey, paddle }, (input, init) => fetch(input, init)), checkoutEnabled: () => CHECKOUT_ENABLED }), (line) => console.log(line), () => Date.now()));

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

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const billing = {
  apiKey: Deno.env.get('LEMONSQUEEZY_API_KEY') ?? '',
  storeId: Deno.env.get('LEMONSQUEEZY_STORE_ID') ?? '',
  variantId: Deno.env.get('LEMONSQUEEZY_BILLING_VARIANT_ID') ?? '',
  secret: Deno.env.get('LEMONSQUEEZY_BILLING_WEBHOOK_SECRET') ?? '',
  testMode: (Deno.env.get('LEMONSQUEEZY_TEST_MODE') ?? '') === 'true',
};

Deno.serve(makeHandler(makeDeps({ url, serviceKey, billing }, (input, init) => fetch(input, init))));

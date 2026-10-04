// development-activity-billing-webhook — the processor's signed subscription events, recorded for the brokerage a HomeSignal checkout named
// (Development Activity build step 11).
//
// Wiring only. The request logic is handler.ts, the one database call is data.ts (_shared/billing-reads.ts `applyEvent`), and every shape the
// processor has is _shared/lemon-billing.ts. JWT verification is OFF for this function (supabase/config.toml and the deploy workflow): the
// processor sends no Supabase token, and the gate is the processor's own HMAC signature over the raw body, checked in the handler before the body
// is parsed. When the signing secret or the variant id is not configured EVERY request is refused (503): a missing secret must never read as "no
// signature needed". Both are read here and nowhere else; neither is ever printed, returned or logged.
//
// This is a SECOND webhook, with its own URL and its own signing secret, for a different product (a brokerage's subscription). It does not touch
// the user-scoped `lemonsqueezy-webhook` that homesignal-ingest owns: that one ignores an event with no user id, and this one ignores an event
// with no signed brokerage id, so neither acts on the other's.
// Docs: docs/development-activity-billing-2026-10-04.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { makeDeps } from './data.ts';
import { makeHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const secret = Deno.env.get('LEMONSQUEEZY_BILLING_WEBHOOK_SECRET') ?? '';
const variantId = Deno.env.get('LEMONSQUEEZY_BILLING_VARIANT_ID') ?? '';

Deno.serve(makeHandler(makeDeps({ url, serviceKey, secret, variantId }, (input, init) => fetch(input, init))));

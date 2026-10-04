// development-activity-billing-webhook — the processor's signed subscription events (Development Activity build step 11;
// docs/development-activity-billing-2026-10-04.md). Request logic only: it reads no environment and calls no network; everything external arrives
// through `Deps`, so the whole webhook is testable without Deno or a network.
//
// WHO MAY CALL: whoever holds the webhook's signing secret, and nobody else. The X-Signature header must be the HMAC-SHA256 of the RAW request body
// under that secret, compared in constant time and BEFORE the body is parsed (_shared/lemon-billing.ts `verifySignature`). When the secret or the
// variant id is not configured every request is refused: a missing secret must never read as "no signature needed".
//
// WHAT IT DOES: turns a verified body into the one event the ledger records (`translate`), and records it for the brokerage a HomeSignal checkout
// named (public.billing_event_apply). It decides nothing about money: whether the brokerage is paid, and which allotment a report uses, are the
// database's. An event that is not ours to act on (another product, an order or invoice event, a checkout without our signature on it) is
// acknowledged with 200 and recorded nowhere, so the processor stops retrying it.
//
// WHAT IT NEVER DOES: log, store or return the payload, a customer, an email, a card, a price or a secret. Every answer below is a fixed word.
//
// ANSWERS, and what the processor does with each (it retries a non-200 a few times):
//   200 OK / IGNORED   recorded (or a retry of a recorded event), or not ours to act on.
//   401                the signature is missing or wrong. Never retried to success.
//   409 binding_conflict   the subscription already belongs to a different brokerage: loud, and recorded nowhere.
//   413                the body is larger than any real event.
//   422                a verified body that is not shaped as expected: loud, so a changed payload is noticed, never guessed at.
//   503                the webhook is not set up, or the database could not be reached: the retry is what recovers it.
import { translate, verifySignature } from '../_shared/lemon-billing.ts';
import { BindingConflict, BrokerageUnknown, EventRefused } from '../_shared/billing-reads.ts';
import type { AppliedEvent } from '../_shared/billing-reads.ts';
import type { LedgerEvent } from '../_shared/lemon-billing.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';

export { DataUnavailable };

export type Deps = {
  /** The webhook's signing secret. Empty when it is not configured, which refuses every request. */
  secret: string;
  /** The $79 product's variant id (a number as text). Empty when it is not configured. */
  variantId: string;
  applyEvent: (brokerageId: string, event: LedgerEvent) => Promise<AppliedEvent>;
};

export const SIGNATURE_HEADER = 'x-signature';
/** A real subscription event is a few kilobytes. This is far above that and far below anything that could exhaust the function. */
export const MAX_BODY_BYTES = 262_144;

export const CAPABILITY = {
  product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
  method: 'POST (the payment processor only, signed)',
  access: 'a valid X-Signature over the raw body',
  writes: ['one billing event per delivery, and the subscription\'s binding to its brokerage, in one database call'],
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  const configured = () => !!deps.secret && /^[0-9]{1,20}$/.test(deps.variantId);
  return async (req: Request): Promise<Response> => {
    // a browser never calls this, so no CORS grant is made; the preflight is answered with nothing
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (req.method === 'GET') return reply({ ...CAPABILITY, configured: configured() });
    if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!configured()) return reply({ error: 'not_set_up' }, 503);

    // the RAW text is what was signed, so it is read as text and checked before anything parses it
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply({ error: 'too_large' }, 413);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return reply({ error: 'too_large' }, 413);
    if (!(await verifySignature(deps.secret, raw, req.headers.get(SIGNATURE_HEADER)))) return reply({ error: 'unauthorized' }, 401);

    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return reply({ error: 'invalid', reason: 'json' }, 422); }

    try {
      const t = await translate(payload, { secret: deps.secret, variantId: deps.variantId });
      if (t.kind === 'ignore') return reply({ status: 'IGNORED', reason: t.reason });
      if (t.kind === 'invalid') return reply({ error: 'invalid', reason: t.reason }, 422);
      const applied = await deps.applyEvent(t.brokerageId, t.event);
      return reply({ status: 'OK', outcome: applied.outcome });
    } catch (e) {
      if (e instanceof BindingConflict) return reply({ error: 'binding_conflict' }, 409);
      if (e instanceof BrokerageUnknown) return reply({ error: 'invalid', reason: 'brokerage_unknown' }, 422);
      if (e instanceof EventRefused) return reply({ error: 'invalid', reason: 'event_refused' }, 422);
      if (e instanceof DataUnavailable) return reply({ error: 'data_unavailable' }, 503);
      return reply({ error: 'internal' }, 500);      // never the message: it can carry an id
    }
  };
}

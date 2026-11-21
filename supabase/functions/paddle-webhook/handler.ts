// paddle-webhook — Paddle's signed events, recorded for the account a HomeSignal checkout named (replaces development-activity-billing-webhook).
// Request logic only: it reads no environment and calls no network; everything external arrives through `Deps`, so the whole webhook is testable
// without Deno or a network.
//
// WHO MAY CALL: whoever holds one of the two webhook signing secrets (production or sandbox), and nobody else. The Paddle-Signature header
// (`ts=...;h1=...`) is the HMAC-SHA256 of "<ts>:<RAW body>", compared in constant time and BEFORE the body is parsed, with a five-minute timestamp
// tolerance (_shared/paddle-billing.ts `verifyWebhook`). WHICH secret verified the delivery decides livemode: a sandbox delivery can never mark an
// account paid in production. With no secret configured every request is refused: a missing secret must never read as "no signature needed".
//
// WHAT IT DOES: turns a verified body into the one event the ledger records (`translate`) and records it for the account a SIGNED checkout named
// (public.paddle_event_apply). A full refund is recorded against the subscription or transaction it refunded (public.paddle_adjustment_apply). It
// decides nothing about money: whether an account is paid, which allotment a report uses and whether a partner enrollment is eligible are the database's.
//
// WHAT IT NEVER DOES: log, store or return the payload, a customer, an email, a card, a price or a secret. Every answer below is a fixed word.
//
// ANSWERS (Paddle retries a non-2xx for days; every 2xx stops the retries):
//   200 OK / IGNORED   recorded (or a retry of a recorded event), or not ours to act on, or recorded as "granted nothing" (an unknown price, a partner
//                      payment with no eligible enrollment): the event is kept in public.paddle_unmatched_event for the operator.
//   401                the signature is missing, wrong, or its timestamp is stale.
//   409 binding_conflict   the subscription already belongs to a different account: loud, and recorded nowhere.
//   413                the body is larger than any real event.
//   422                a verified body that is not shaped as expected: loud, so a changed payload is noticed, never guessed at.
//   503                the webhook is not set up, or the database could not be reached: the retry is what recovers it.
import { translate, verifyWebhook } from '../_shared/paddle-billing.ts';
import type { LedgerEvent, Period, PlanKey } from '../_shared/paddle-billing.ts';
import { BindingConflict, BrokerageUnknown, EventRefused } from '../_shared/billing-reads.ts';
import type { AppliedEvent } from '../_shared/billing-reads.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';

export { DataUnavailable };

export type Deps = {
  /** The two signing secrets (a notification destination's secret in each Paddle environment). Empty = not configured = verifies nothing. */
  secrets: { live: string; sandbox: string };
  /** The secret that signs checkout bindings. Empty refuses every request. */
  bindingSecret: string;
  now: () => number;
  applyEvent: (brokerageId: string, plan: PlanKey, enrollmentId: string | null, event: LedgerEvent, period: Period | null) => Promise<AppliedEvent>;
  applyRefund: (event: LedgerEvent) => Promise<AppliedEvent>;
  recordUnbound: (event: LedgerEvent) => Promise<void>;
};

export const SIGNATURE_HEADER = 'paddle-signature';
/** A real Paddle event is a few kilobytes. This is far above that and far below anything that could exhaust the function. */
export const MAX_BODY_BYTES = 262_144;

export const CAPABILITY = {
  product: 'JODY TRACKS DEVELOPMENT ACTIVITY',
  method: 'POST (Paddle only, signed)',
  access: 'a valid Paddle-Signature over the raw body',
  writes: ['one billing event per delivery and the subscription\'s binding to its account, in one database call'],
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  const configured = () => !!deps.bindingSecret && (!!deps.secrets.live || !!deps.secrets.sandbox);
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (req.method === 'GET') return reply({ ...CAPABILITY, configured: configured() });
    if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!configured()) return reply({ error: 'not_set_up' }, 503);

    const declared = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply({ error: 'too_large' }, 413);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return reply({ error: 'too_large' }, 413);
    const env = await verifyWebhook(deps.secrets, raw, req.headers.get(SIGNATURE_HEADER), deps.now());
    if (env === null) return reply({ error: 'unauthorized' }, 401);

    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return reply({ error: 'invalid', reason: 'json' }, 422); }

    try {
      const t = await translate(payload, env, deps.bindingSecret);
      if (t.kind === 'ignore') return reply({ status: 'IGNORED', reason: t.reason });
      if (t.kind === 'invalid') return reply({ error: 'invalid', reason: t.reason }, 422);
      if (t.kind === 'unbound') {
        await deps.recordUnbound(t.event);        // a payment no signed checkout of ours made: kept for the operator, never granted
        return reply({ status: 'IGNORED', reason: t.reason });
      }
      const applied = t.kind === 'refund' ? await deps.applyRefund(t.event) : await deps.applyEvent(t.brokerageId, t.plan, t.enrollmentId, t.event, t.period);
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

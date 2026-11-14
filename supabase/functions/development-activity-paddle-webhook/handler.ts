// development-activity-paddle-webhook — Paddle's signed events (Development Activity billing, 2026-11-14; docs/paddle-billing-2026-11-14.md).
// Request logic only: it reads no environment and calls no network; everything external arrives through `Deps`.
//
// WHO MAY CALL: whoever holds a Paddle notification-destination secret (Live or Sandbox), and nobody else. The Paddle-Signature header is verified against the
// RAW request body BEFORE it is parsed (_shared/paddle-billing.ts). WHICH secret verified decides livemode, never the body: a Sandbox delivery is recorded as
// test-mode and can never make a brokerage paid. When no environment is fully configured every request is refused: a missing secret never reads as "no signature needed".
//
// WHAT IT DOES: turns a verified body into the one event the ledger records and records it for the brokerage a HomeSignal checkout named
// (public.billing_event_apply); a refund or chargeback (no custom data) is recorded for the brokerage its subscription is already bound to. It decides
// nothing about money: paid / allowance / reset / cancellation are the database's. Duplicates and out-of-order events are the ledger's: the same event_id is
// recorded once (DUPLICATE), and the latest event is chosen by Paddle's occurred_at, never by arrival.
//
// ANSWERS: 200 OK / IGNORED (recorded, a retry, or not ours) · 401 bad or missing signature · 409 binding_conflict · 413 too large · 422 verified but not shaped as
// expected (loud) · 503 not set up, or the database could not be reached (Paddle retries).
import { translate, verifyEnvironment } from '../_shared/paddle-billing.ts';
import type { PaddleEnvironment } from '../_shared/paddle-billing.ts';
import { BindingConflict, BrokerageUnknown, EventRefused } from '../_shared/billing-reads.ts';
import type { AppliedEvent } from '../_shared/billing-reads.ts';
import type { LedgerEvent } from '../_shared/lemon-billing.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';

export { DataUnavailable };

export type EnvConfig = { secret: string; priceId: string };
export type Deps = {
  live: EnvConfig;
  sandbox: EnvConfig;
  applyEvent: (brokerageId: string, event: LedgerEvent) => Promise<AppliedEvent>;
  bindingOf: (processor: string, livemode: boolean, subscriptionRef: string) => Promise<string | null>;
  /** Seconds since the epoch. Injected so a test fixes the clock. */
  nowSeconds: () => number;
};

export const SIGNATURE_HEADER = 'paddle-signature';
export const MAX_BODY_BYTES = 262_144;
export const CAPABILITY = {
  product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
  method: 'POST (Paddle only, signed)',
  access: 'a valid Paddle-Signature over the raw body',
  writes: ['one billing event per delivery, and the subscription\'s binding to its brokerage, in one database call'],
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
const PRICE = /^pri_[A-Za-z0-9]{10,40}$/;
const envReady = (c: EnvConfig) => !!c.secret && PRICE.test(c.priceId);

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    const ready = { live: envReady(deps.live), sandbox: envReady(deps.sandbox) };
    if (req.method === 'GET') return reply({ ...CAPABILITY, configured: ready.live || ready.sandbox });
    if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!ready.live && !ready.sandbox) return reply({ error: 'not_set_up' }, 503);

    const declared = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply({ error: 'too_large' }, 413);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return reply({ error: 'too_large' }, 413);

    // only a configured environment's secret may verify
    const env: PaddleEnvironment | null = await verifyEnvironment(
      { live: ready.live ? deps.live.secret : '', sandbox: ready.sandbox ? deps.sandbox.secret : '' },
      raw, req.headers.get(SIGNATURE_HEADER), deps.nowSeconds());
    if (env === null) return reply({ error: 'unauthorized' }, 401);

    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return reply({ error: 'invalid', reason: 'json' }, 422); }

    const cfg = env === 'live' ? deps.live : deps.sandbox;
    const livemode = env === 'live';
    try {
      const t = await translate(payload, { secret: cfg.secret, priceId: cfg.priceId, livemode });
      if (t.kind === 'ignore') return reply({ status: 'IGNORED', reason: t.reason });
      if (t.kind === 'invalid') return reply({ error: 'invalid', reason: t.reason }, 422);
      let brokerageId: string;
      if (t.kind === 'adjustment') {
        const bound = await deps.bindingOf(t.event.processor, livemode, t.subscriptionRef);
        if (bound === null) return reply({ status: 'IGNORED', reason: 'unbound_subscription' });
        brokerageId = bound;
      } else brokerageId = t.brokerageId;
      const applied = await deps.applyEvent(brokerageId, t.event);
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

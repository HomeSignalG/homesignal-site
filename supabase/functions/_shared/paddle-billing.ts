// THE ONE PLACE THIS REPO KNOWS PADDLE BILLING'S SHAPES (Development Activity billing, 2026-11-14). The Lemon Squeezy twin is lemon-billing.ts and is untouched:
// both feed the SAME processor-neutral payment ledger (docs/payment-event-ledger.sql) and the same entitlement (docs/brokerage-billing.sql).
//
// Three things live here: how a webhook is verified, how a verified body becomes the one event the ledger records, and how a checkout is asked for.
// The database decides every question about money and entitlement (paid, allowance, reset); this file decides only whether a request really came from
// Paddle and what it said. PURE of environment and network (secrets, ids and the clock arrive as arguments). It never logs.
//
// WHAT WAS CHECKED AGAINST WHAT. Read from Paddle's own Node SDK source (github.com/PaddleHQ/paddle-node-sdk, main): the signature rule (header
// `ts=<unix>;h1=<hex>`, HMAC-SHA256, hex, over `<ts>:<raw body>`), the envelope fields (event_id, event_type, occurred_at, data), the subscription fields
// (id, status, custom_data, items[].price.id / product_id) and the adjustment fields (action, type, status, subscription_id, transaction_id).
// NOT verified (developer.paddle.com is unreachable from the build sandbox, and no sandbox account has been connected): the VALUES of the adjustment enums,
// that a transaction's custom_data is copied onto its subscription, the transaction request/answer shape, and the retry/re-signing behaviour. Everything
// below therefore REFUSES what it does not recognise (`invalid`, a loud 422) rather than guessing, and docs/paddle-billing-2026-11-14.md lists exactly what the
// first Sandbox payments must confirm before live checkout is enabled.
import { hmacHex, timingSafeEqual } from './lemon-billing.ts';
import type { LedgerEvent } from './lemon-billing.ts';

export const PROCESSOR = 'paddle';
export type PaddleEnvironment = 'live' | 'sandbox';

export const API_BASE: Record<PaddleEnvironment, string> = { live: 'https://api.paddle.com', sandbox: 'https://sandbox-api.paddle.com' };

/** Subscription lifecycle events whose `data.status` is the plan's state. */
export const SUBSCRIPTION_EVENTS: readonly string[] = [
  'subscription.created', 'subscription.activated', 'subscription.updated', 'subscription.canceled',
  'subscription.past_due', 'subscription.paused', 'subscription.resumed', 'subscription.trialing',
];
export const ADJUSTMENT_EVENTS: readonly string[] = ['adjustment.created', 'adjustment.updated'];
/** Paddle's subscription statuses. Anything else is a payload we do not understand. */
export const SUBSCRIPTION_STATUSES: readonly string[] = ['active', 'trialing', 'past_due', 'paused', 'canceled'];

/**
 * How far a signature's timestamp may be from now. Paddle's SDK uses 5 seconds. This is wider (5 minutes) on purpose: whether Paddle re-signs a retried
 * delivery is not confirmed, and a strict window would turn a late retry into a permanent 401. A replay inside the window is harmless: an event is recorded
 * once per event_id (the ledger's unique key), so the same bytes again are a DUPLICATE and change nothing.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const REF = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_WITH_OFFSET = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---- the signature ---------------------------------------------------------------------------------------------------------------------------
/** `ts=1700000000;h1=abc;h1=def` -> { ts, h1: [..] }. More than one h1 is accepted (a rotated secret signs with both); a missing or repeated ts is refused. */
export function parseSignatureHeader(header: string | null): { ts: number; h1: string[] } | null {
  if (typeof header !== 'string' || header.length > 1000) return null;
  const h1: string[] = [];
  let ts: string | null = null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) return null;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 'ts') { if (ts !== null) return null; ts = v; }
    else if (k === 'h1') h1.push(v.toLowerCase());
  }
  if (ts === null || !/^[0-9]{9,12}$/.test(ts) || h1.length === 0 || h1.length > 4 || !h1.every((h) => HEX64.test(h))) return null;
  return { ts: Number(ts), h1 };
}

/**
 * Whether a webhook was signed with `secret`: some h1 equals HMAC-SHA256(secret, `${ts}:${raw body}`) in hex, compared in constant time, and ts is within
 * the tolerance of `nowSeconds` in both directions. The RAW text is what was signed, so it is hashed before anything parses it. An empty secret verifies nothing.
 */
export async function verifyPaddleSignature(secret: string, rawBody: string, header: string | null, nowSeconds: number): Promise<boolean> {
  if (typeof secret !== 'string' || !secret || typeof rawBody !== 'string' || !Number.isFinite(nowSeconds)) return false;
  const p = parseSignatureHeader(header);
  if (!p || Math.abs(nowSeconds - p.ts) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = await hmacHex(secret, p.ts + ':' + rawBody);
  let ok = false;
  for (const h of p.h1) ok = timingSafeEqual(h, expected) || ok;     // every candidate is compared: no early exit
  return ok;
}

/**
 * Which environment's secret signed this delivery. LIVEMODE COMES FROM THE SECRET THAT VERIFIED, never from the body: Paddle Sandbox and Live are separate
 * accounts with separate secrets, so a Sandbox delivery can only ever verify as 'sandbox', and a sandbox event is recorded as test-mode (it never grants).
 */
export async function verifyEnvironment(secrets: { live: string; sandbox: string }, rawBody: string, header: string | null, nowSeconds: number): Promise<PaddleEnvironment | null> {
  const live = await verifyPaddleSignature(secrets.live, rawBody, header, nowSeconds);
  const sandbox = await verifyPaddleSignature(secrets.sandbox, rawBody, header, nowSeconds);
  if (live && sandbox) return null;           // the same secret configured for both environments: refuse rather than guess
  return live ? 'live' : sandbox ? 'sandbox' : null;
}

// ---- the checkout binding ----------------------------------------------------------------------------------------------------------------------
// The checkout this server makes for a brokerage carries the brokerage's id and a signature of it in the transaction's custom_data, and the subscription
// that results carries them back. Nobody else can make a binding that verifies (they do not hold the environment's webhook secret), and a Sandbox binding
// does not verify under the live secret. The id never reaches a browser: the browser is given only the transaction's id.
const BINDING_CONTEXT = 'hs-billing-checkout|paddle|';
export async function paddleBinding(secret: string, brokerageId: string): Promise<string> {
  if (typeof secret !== 'string' || !secret) throw new Error('paddle-billing: a signing secret is required');
  if (!UUID.test(brokerageId)) throw new Error('paddle-billing: a brokerage id is required');
  return hmacHex(secret, BINDING_CONTEXT + brokerageId);
}
export async function verifyPaddleBinding(secret: string, brokerageId: unknown, bind: unknown): Promise<boolean> {
  if (typeof secret !== 'string' || !secret || typeof brokerageId !== 'string' || !UUID.test(brokerageId) || typeof bind !== 'string' || !HEX64.test(bind)) return false;
  return timingSafeEqual(bind, await hmacHex(secret, BINDING_CONTEXT + brokerageId));
}

// ---- the webhook body -> the ledger's event ------------------------------------------------------------------------------------------------
export type TranslateConfig = { secret: string; priceId: string; livemode: boolean };

/**
 * `event`       a subscription event of OUR price, for a brokerage a checkout of ours named: record it for that brokerage.
 * `adjustment`  a refund / chargeback on a subscription: record it for whichever brokerage that subscription is already bound to (an adjustment carries no
 *               custom data, so the brokerage is looked up, never read from the body).
 * `ignore`      a verified webhook that is not ours to act on: acknowledge it.
 * `invalid`     a webhook that should have been ours and is not shaped as expected: refuse it loudly.
 */
export type Translation =
  | { kind: 'event'; brokerageId: string; event: LedgerEvent }
  | { kind: 'adjustment'; subscriptionRef: string; event: LedgerEvent }
  | { kind: 'ignore'; reason: string }
  | { kind: 'invalid'; reason: string };

const asRef = (v: unknown): string | null => (typeof v === 'string' && REF.test(v) ? v : null);

export async function translate(payload: unknown, cfg: TranslateConfig): Promise<Translation> {
  if (!isObj(payload) || !isObj(payload.data)) return { kind: 'invalid', reason: 'shape' };
  const eventType = payload.event_type;
  if (typeof eventType !== 'string' || !/^[a-z_.]{1,64}$/.test(eventType)) return { kind: 'invalid', reason: 'event_type' };
  const isSub = SUBSCRIPTION_EVENTS.includes(eventType), isAdj = ADJUSTMENT_EVENTS.includes(eventType);
  if (!isSub && !isAdj) return { kind: 'ignore', reason: 'event_type' };

  const eventId = asRef(payload.event_id);
  if (eventId === null) return { kind: 'invalid', reason: 'event_id' };
  const occurred = payload.occurred_at;
  if (typeof occurred !== 'string' || !ISO_WITH_OFFSET.test(occurred) || !Number.isFinite(Date.parse(occurred))) return { kind: 'invalid', reason: 'occurred_at' };
  const data = payload.data;

  if (isAdj) {
    // a refund or chargeback that has been APPROVED takes the money back and ends access; everything else (credits, partial refunds, pending or rejected
    // adjustments, a reversal) is acknowledged and changes nothing.
    const action = data.action, type = data.type, status = data.status;
    if (typeof action !== 'string' || typeof status !== 'string') return { kind: 'invalid', reason: 'adjustment' };
    let word: 'refunded' | 'charged_back' | null = null;
    if (status === 'approved' && action === 'refund' && type === 'full') word = 'refunded';
    else if (status === 'approved' && (action === 'chargeback' || action === 'chargeback_warranty')) word = 'charged_back';
    if (word === null) return { kind: 'ignore', reason: 'adjustment_not_final_refund' };
    const sub = data.subscription_id === null || data.subscription_id === undefined ? null : asRef(data.subscription_id);
    if (sub === null) return { kind: 'ignore', reason: 'no_subscription' };
    if (!cfg.priceId || !REF.test(cfg.priceId)) return { kind: 'ignore', reason: 'price' };
    return {
      kind: 'adjustment', subscriptionRef: sub,
      event: { processor: PROCESSOR, idempotency_key: eventId, subscription_ref: sub, event_name: eventType, processor_status: word, occurred_at: occurred, variant_ref: cfg.priceId, livemode: cfg.livemode },
    };
  }

  // subscription: bound by the checkout's own signed custom_data
  const custom = data.custom_data;
  if (!isObj(custom) || typeof custom.brokerage_id !== 'string' || typeof custom.bind !== 'string') return { kind: 'ignore', reason: 'no_binding' };
  if (!(await verifyPaddleBinding(cfg.secret, custom.brokerage_id, custom.bind))) return { kind: 'ignore', reason: 'bad_binding' };

  if (!Array.isArray(data.items)) return { kind: 'invalid', reason: 'items' };
  let price: string | null = null, product: string | null = null;
  for (const it of data.items) {
    if (!isObj(it) || !isObj(it.price)) return { kind: 'invalid', reason: 'items' };
    const id = asRef(it.price.id);
    if (id === null) return { kind: 'invalid', reason: 'price_id' };
    if (cfg.priceId && id === cfg.priceId) { price = id; product = it.price.product_id === undefined ? null : asRef(it.price.product_id); }
  }
  if (price === null) return { kind: 'ignore', reason: 'price' };

  const sub = asRef(data.id);
  if (sub === null) return { kind: 'invalid', reason: 'id' };
  const status = data.status;
  if (typeof status !== 'string' || !SUBSCRIPTION_STATUSES.includes(status)) return { kind: 'invalid', reason: 'status' };

  const event: LedgerEvent = {
    processor: PROCESSOR, idempotency_key: eventId, subscription_ref: sub, event_name: eventType, processor_status: status,
    occurred_at: occurred, ...(product ? { product_ref: product } : {}), variant_ref: price, livemode: cfg.livemode,
  };
  return { kind: 'event', brokerageId: custom.brokerage_id, event };
}

// ---- the checkout (a server-made transaction) -----------------------------------------------------------------------------------------------------
// The server asks Paddle for ONE transaction for ONE brokerage, with the price fixed here and the signed binding in custom_data, and hands the browser only
// the transaction's id (Paddle.Checkout.open({ transactionId })). The browser cannot change the price, the quantity or the account that will be bound.
export type TransactionConfig = { environment: PaddleEnvironment; apiKey: string; priceId: string; secret: string };

export async function transactionRequest(cfg: TransactionConfig, brokerageId: string): Promise<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> {
  if (!cfg.apiKey || !cfg.secret || !/^pri_[A-Za-z0-9]{10,40}$/.test(cfg.priceId)) throw new Error('paddle-billing: the checkout is not configured');
  const bind = await paddleBinding(cfg.secret, brokerageId);
  return {
    url: API_BASE[cfg.environment] + '/transactions',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey, 'Paddle-Version': '1' },
      body: JSON.stringify({ items: [{ price_id: cfg.priceId, quantity: 1 }], collection_mode: 'automatic', custom_data: { brokerage_id: brokerageId, bind } }),
    },
  };
}

/** The transaction id out of Paddle's answer, or null. Only an id of the documented shape is ever handed to a browser. */
export function transactionIdFrom(response: unknown): string | null {
  if (!isObj(response) || !isObj(response.data)) return null;
  const id = response.data.id;
  return typeof id === 'string' && /^txn_[a-z0-9]{20,40}$/.test(id) ? id : null;
}

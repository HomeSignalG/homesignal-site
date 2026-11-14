// THE ONE PLACE THIS REPO KNOWS PADDLE'S SHAPES (it replaces _shared/lemon-billing.ts, founder 2026-11-14: "replace Lemon Squeezy").
//
// Three things live here and nowhere else: how a checkout is asked for, how an incoming webhook is verified, and how a verified webhook body becomes
// the one event the payment ledger records. The database owns every decision about money and entitlement (docs/brokerage-billing.sql,
// docs/paddle-billing.sql): whether a brokerage is paid, which allotment a report uses, when a one-time grant ends. This file decides only whether a
// request really came from the processor, which of OUR offers it is for, and what it said.
//
// THE TWO OFFERS (founder, 2026-11-14), each bound to a Paddle price id that arrives as configuration, never as a literal here:
//   professional  a recurring monthly subscription ($78/month, 100 reports a month, no trial). The access length is NULL: it lasts while Paddle says active.
//   partner       the Private Partner Offer: ONE payment ($234 once) for SIX months of Professional access, no renewal, individual agents only. The
//                 length (6) is looked up HERE from the price the buyer paid, so a payload can never choose how long access lasts.
// "Brokerage & Enterprise" is custom quoted and has no price, so it is not an offer this module knows.
//
// PURE of environment and network: the secret, the price ids and the clock arrive as arguments, and the only crypto is the platform's Web Crypto.
// It never logs, and it returns no payload field a caller does not need.
//
// WHAT HAS NOT BEEN SEEN. The shapes below are Paddle Billing's documented ones (the Paddle-Signature header `ts=<unix>;h1=<hex>` over "<ts>:<raw body>",
// the envelope `event_id` / `event_type` / `occurred_at` / `data`, subscription `data.status`, `data.custom_data`, `data.items[].price.id`, and the
// transaction answer's `data.checkout.url`), written WITHOUT a captured Paddle payload: the build sandbox has no Paddle Sandbox account. It is built to
// REFUSE what it does not recognise (a payload without a field it needs is `invalid`, answered 422, never guessed). The first Sandbox purchase is what
// confirms the shapes; docs/paddle-billing-2026-11-14.md says exactly what to look at.

export const PROCESSOR = 'paddle';
export const API_BASE = { production: 'https://api.paddle.com', sandbox: 'https://sandbox-api.paddle.com' } as const;
export type PaddleEnvironment = keyof typeof API_BASE;
/** The same type under a processor-neutral name, for the handlers and data layers (which name no processor). */
export type BillingEnvironment = PaddleEnvironment;

/** The offers this build sells. `accessMonths` is the fixed length of a one-time grant, or null for a subscription. */
export type OfferKey = 'professional' | 'partner';
export const OFFER_ACCESS_MONTHS: Readonly<Record<OfferKey, number | null>> = { professional: null, partner: 6 };

/** The header Paddle signs every webhook with (read by the webhook handler through this constant, so no handler names the processor). */
export const SIGNATURE_HEADER = 'paddle-signature';

/** A webhook older or newer than this many seconds is a replay or a clock problem and is refused (Paddle signs every attempt afresh). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Paddle subscription lifecycle events the plan acts on. Everything else is acknowledged and not recorded. */
export const SUBSCRIPTION_EVENTS: readonly string[] = [
  'subscription.created', 'subscription.activated', 'subscription.updated', 'subscription.trialing',
  'subscription.past_due', 'subscription.paused', 'subscription.resumed', 'subscription.canceled',
];
/** The one-time payment event. It counts only for the partner offer's price and only when it belongs to no subscription. */
export const ONE_TIME_EVENT = 'transaction.completed';

/** The payload keys the ledger accepts (docs/payment-event-ledger.sql): this is exactly the object the webhook sends, never more. */
export type LedgerEvent = {
  processor: string;
  idempotency_key: string;
  subscription_ref: string;
  event_name: string;
  processor_status: string;
  occurred_at: string;
  product_ref?: string;
  variant_ref: string;
  livemode: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const REF = /^[A-Za-z0-9_-]{1,64}$/;
const STATUS = /^[a-z_]{1,32}$/;
const EVENT_NAME = /^[a-z_]{1,32}\.[a-z_]{1,32}$/;
const ISO_WITH_OFFSET = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$/;

const encoder = new TextEncoder();
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256 of `message` under `secret`, as lower-case hex. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Compares two strings in time that depends only on their length, never on where they first differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Paddle-Signature: `ts=1671552777;h1=<hex>` (more than one h1 while a secret is being rotated). Returns the timestamp and every h1, or null when
 * the header is not that shape. Nothing is trusted yet.
 */
export function parseSignatureHeader(header: string | null): { ts: string; h1: string[] } | null {
  if (typeof header !== 'string' || header.length > 600) return null;
  let ts: string | null = null;
  const h1: string[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) return null;
    const k = part.slice(0, eq).trim(), v = part.slice(eq + 1).trim();
    if (k === 'ts') { if (ts !== null || !/^[0-9]{9,12}$/.test(v)) return null; ts = v; }
    else if (k === 'h1') { if (!HEX64.test(v.toLowerCase())) return null; h1.push(v.toLowerCase()); }
  }
  return ts !== null && h1.length > 0 ? { ts, h1 } : null;
}

/**
 * Whether a webhook really came from Paddle: some h1 in the Paddle-Signature header is the HMAC-SHA256, under the notification destination's secret, of
 * "<ts>:<RAW request body>", and ts is within SIGNATURE_TOLERANCE_SECONDS of `nowSeconds`. The raw text is what was signed, so it is hashed before
 * anything parses it. An empty secret verifies NOTHING (fails closed). `nowSeconds` is passed in so a test can fix the clock.
 */
export async function verifySignature(secret: string, rawBody: string, header: string | null, nowSeconds: number): Promise<boolean> {
  if (typeof secret !== 'string' || !secret || typeof rawBody !== 'string' || !Number.isFinite(nowSeconds)) return false;
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(nowSeconds - Number(parsed.ts)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = await hmacHex(secret, parsed.ts + ':' + rawBody);
  let ok = false;
  for (const h of parsed.h1) ok = timingSafeEqual(h, expected) || ok;   // every candidate is compared: no early exit
  return ok;
}

// ---- the checkout binding -------------------------------------------------------------------------------------------------------------------
// A checkout carries the brokerage's id in its custom data, and that id is what the webhook binds a subscription or a grant to. A buyer can add
// custom data to a public buy link themselves, so the id alone proves nothing about who made the checkout. Every transaction this server makes
// therefore also carries a signature of that id (`bind`), made with the webhook's own secret under a fixed context; a payment without a valid one is
// ignored, so access can only ever be bound to a brokerage by a checkout HomeSignal itself made for it. (Unchanged from the Lemon build.)
const BINDING_CONTEXT = 'hs-billing-checkout|';

export async function checkoutBinding(secret: string, brokerageId: string): Promise<string> {
  if (typeof secret !== 'string' || !secret) throw new Error('paddle-billing: a signing secret is required');
  if (!UUID.test(brokerageId)) throw new Error('paddle-billing: a brokerage id is required');
  return hmacHex(secret, BINDING_CONTEXT + brokerageId);
}

export async function verifyBinding(secret: string, brokerageId: unknown, bind: unknown): Promise<boolean> {
  if (typeof secret !== 'string' || !secret || typeof brokerageId !== 'string' || !UUID.test(brokerageId) || typeof bind !== 'string' || !HEX64.test(bind)) return false;
  return timingSafeEqual(bind, await hmacHex(secret, BINDING_CONTEXT + brokerageId));
}

// ---- the webhook body -> the ledger's event ------------------------------------------------------------------------------------------------
/** Which price id is which offer. Both are configuration. A missing or malformed id means that offer is not sold. */
export type OfferPrices = { professional: string; partner: string };
export type WebhookConfig = { secret: string; prices: OfferPrices; livemode: boolean };

/**
 * `event`   an event of OUR price, for a brokerage a checkout of ours named: record it, with the offer's fixed access length.
 * `ignore`  a verified webhook that is not ours to act on (another product's, an event type we do not use, a renewal's own transaction, a forged
 *           binding): acknowledge it.
 * `invalid` a webhook that should have been ours and is not shaped as expected: refuse it loudly.
 */
export type Translation =
  | { kind: 'event'; brokerageId: string; event: LedgerEvent; offer: OfferKey; accessMonths: number | null }
  | { kind: 'adjustment'; transactionId: string; subscriptionId: string | null; event: LedgerEvent }
  | { kind: 'ignore'; reason: string }
  | { kind: 'invalid'; reason: string };

const PRICE_ID = /^pri_[0-9a-z]{20,40}$/;
export const isPriceId = (v: unknown): v is string => typeof v === 'string' && PRICE_ID.test(v);

const asRef = (v: unknown): string | null => (typeof v === 'string' && REF.test(v) ? v : null);

/** The offer a payload's items name, by price id: the first item whose price is one of ours, or null. */
function offerOf(items: unknown, prices: OfferPrices): { offer: OfferKey; priceId: string; productId: string | null } | null {
  if (!Array.isArray(items)) return null;
  for (const it of items) {
    if (!isObj(it)) continue;
    const price = isObj(it.price) ? it.price : null;
    const id = price && typeof price.id === 'string' ? price.id : typeof it.price_id === 'string' ? it.price_id : null;
    if (id === null) continue;
    const offer: OfferKey | null = isPriceId(prices.professional) && id === prices.professional ? 'professional'
      : isPriceId(prices.partner) && id === prices.partner ? 'partner' : null;
    if (offer) return { offer, priceId: id, productId: price ? asRef(price.product_id) : null };
  }
  return null;
}

// ---- refunds and chargebacks (Paddle "adjustments") -----------------------------------------------------------------------------------
// An adjustment carries NO custom data, so it cannot name a brokerage. It names the TRANSACTION it adjusts, and a one-time Private Partner grant is
// bound under that very transaction id (its `subscription_ref`). The handler therefore looks the grant up by that id (`grantOf`), so an adjustment can only
// ever touch the entitlement of the purchase it belongs to: any other transaction (a subscription's renewal, another product, another brokerage's) finds
// no grant and is acknowledged and ignored.
//
// THE RULES (explicit, and pinned by tests):
//   * a FULL refund that Paddle has APPROVED ends that purchase's access (ledger status `refunded`, which the status map reads as canceled);
//   * a PARTIAL refund NEVER changes access: the buyer keeps what remains of the six months, and the refund is acknowledged (IGNORED partial_refund);
//   * an approved CHARGEBACK ends it (`charged_back`), whatever its amount; a chargeback warning does nothing;
//   * a SUBSCRIPTION's refund or chargeback (the adjusted transaction is not a one-time grant but belongs to a subscription we bound): an approved FULL refund or an
//     approved chargeback ends that subscription's access, with the same ledger words; a reversal is NOT acted on for a subscription (only a later genuine subscription
//     event restores it), so a refund followed by a reversal can never revive a subscription that was cancelled in the meantime;
//   * a chargeback that is REVERSED (action chargeback_reverse approved, or an adjustment whose status becomes reversed) restores it (`completed`);
//   * a refund that is pending or rejected does nothing.
// Access ending early is not extended by anything: the six months are counted from the original binding, so a restore never grants more time.
export const ADJUSTMENT_EVENTS: readonly string[] = ['adjustment.created', 'adjustment.updated'];

function adjustmentStatus(data: Record<string, unknown>): { status: string } | { ignore: string } {
  const action = data.action, status = data.status, kind = data.type;
  if (typeof action !== 'string' || typeof status !== 'string') return { ignore: 'shape' };
  if (action === 'chargeback_reverse') return status === 'approved' ? { status: 'completed' } : { ignore: 'chargeback_reverse_not_approved' };
  if (status === 'reversed') return action === 'chargeback' || action === 'refund' ? { status: 'completed' } : { ignore: 'action' };
  if (action === 'chargeback' || action === 'chargeback_warranty') return status === 'approved' ? { status: 'charged_back' } : { ignore: 'chargeback_not_approved' };
  if (action === 'refund') {
    if (status !== 'approved') return { ignore: 'refund_not_approved' };
    if (kind !== 'full') return { ignore: 'partial_refund' };
    return { status: 'refunded' };
  }
  return { ignore: 'action' };
}

function translateAdjustment(payload: Record<string, unknown>, data: Record<string, unknown>, cfg: WebhookConfig): Translation {
  const eventId = asRef(payload.event_id);
  if (eventId === null) return { kind: 'invalid', reason: 'event_id' };
  const occurred = payload.occurred_at;
  if (typeof occurred !== 'string' || !ISO_WITH_OFFSET.test(occurred) || !Number.isFinite(Date.parse(occurred))) return { kind: 'invalid', reason: 'occurred_at' };
  const txn = asRef(data.transaction_id);
  if (txn === null) return { kind: 'invalid', reason: 'transaction_id' };
  const decided = adjustmentStatus(data);
  if ('ignore' in decided) return { kind: 'ignore', reason: decided.ignore };
  const subId = asRef(data.subscription_id);
  return { kind: 'adjustment', transactionId: txn, subscriptionId: subId, event: {
    processor: PROCESSOR, idempotency_key: eventId, subscription_ref: txn, event_name: String(payload.event_type),
    processor_status: decided.status, occurred_at: occurred, livemode: cfg.livemode } };
}

export async function translate(payload: unknown, cfg: WebhookConfig): Promise<Translation> {
  if (!isObj(payload) || !isObj(payload.data)) return { kind: 'invalid', reason: 'shape' };
  const data = payload.data;
  const type = payload.event_type;
  if (typeof type !== 'string' || !EVENT_NAME.test(type)) return { kind: 'invalid', reason: 'event_type' };
  if (ADJUSTMENT_EVENTS.includes(type)) return translateAdjustment(payload, data, cfg);
  const isSub = SUBSCRIPTION_EVENTS.includes(type), isOneTime = type === ONE_TIME_EVENT;
  if (!isSub && !isOneTime) return { kind: 'ignore', reason: 'event_type' };

  // which brokerage: the checkout's own custom data, and only if it carries the signature this server put on it
  const custom = data.custom_data;
  if (!isObj(custom) || typeof custom.brokerage_id !== 'string' || typeof custom.bind !== 'string') return { kind: 'ignore', reason: 'no_binding' };
  if (!(await verifyBinding(cfg.secret, custom.brokerage_id, custom.bind))) return { kind: 'ignore', reason: 'bad_binding' };

  const hit = offerOf(data.items, cfg.prices);
  if (hit === null) return { kind: 'ignore', reason: 'price' };
  // a subscription event is for the recurring offer; the one-time event is for the partner offer. Any other pairing is not ours to act on.
  if (isSub && hit.offer !== 'professional') return { kind: 'ignore', reason: 'offer_mismatch' };
  if (isOneTime && hit.offer !== 'partner') return { kind: 'ignore', reason: 'offer_mismatch' };
  // a transaction that belongs to a subscription is that subscription's own billing: the subscription events already carry its state
  if (isOneTime && data.subscription_id !== null && data.subscription_id !== undefined) return { kind: 'ignore', reason: 'subscription_transaction' };

  const eventId = asRef(payload.event_id);
  if (eventId === null) return { kind: 'invalid', reason: 'event_id' };
  const occurred = payload.occurred_at;
  if (typeof occurred !== 'string' || !ISO_WITH_OFFSET.test(occurred) || !Number.isFinite(Date.parse(occurred))) return { kind: 'invalid', reason: 'occurred_at' };
  const ref = asRef(data.id);
  if (ref === null) return { kind: 'invalid', reason: 'id' };
  const status = data.status;
  if (typeof status !== 'string' || !STATUS.test(status)) return { kind: 'invalid', reason: 'status' };
  // a one-time payment counts only when Paddle says it is completed; the ledger's word for that is `completed`
  if (isOneTime && status !== 'completed') return { kind: 'invalid', reason: 'status' };

  const event: LedgerEvent = {
    processor: PROCESSOR,
    // Paddle gives every event its own id, so a retried delivery carries the same key and a later change a new one (the Lemon build had to guess).
    idempotency_key: eventId,
    subscription_ref: ref,
    event_name: type,
    processor_status: status,
    occurred_at: occurred,
    ...(hit.productId !== null ? { product_ref: hit.productId } : {}),
    variant_ref: hit.priceId,
    // Paddle Sandbox and live are separate environments with separate secrets: the payload does not say which, so the CONFIGURATION does.
    livemode: cfg.livemode,
  };
  return { kind: 'event', brokerageId: custom.brokerage_id, event, offer: hit.offer, accessMonths: OFFER_ACCESS_MONTHS[hit.offer] };
}

// ---- the checkout request -----------------------------------------------------------------------------------------------------------------------
export type CheckoutConfig = { apiKey: string; prices: OfferPrices; secret: string; environment: PaddleEnvironment; checkoutPageUrl: string };

/**
 * The request that asks Paddle for ONE transaction (a draft the buyer then pays) for ONE brokerage and ONE offer. The brokerage's id and its signature
 * ride in the transaction's custom data, which Paddle copies onto the subscription and sends back on every event. `checkout.url` is the page that
 * will open Paddle's checkout (it must be a domain approved in the Paddle account); Paddle appends `?_ptxn=<transaction id>` to it. Nothing is charged
 * by making it. Returns the request without sending it, so a test can look at every byte; `init.headers` carries the API key and must never be logged.
 */
export async function checkoutRequest(cfg: CheckoutConfig, brokerageId: string, offer: OfferKey): Promise<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> {
  const priceId = cfg.prices[offer];
  if (!cfg.apiKey || !cfg.secret || !isPriceId(priceId)) throw new Error('paddle-billing: the checkout is not configured');
  if (!(cfg.environment in API_BASE)) throw new Error('paddle-billing: unknown environment');
  const bind = await checkoutBinding(cfg.secret, brokerageId);
  const body = {
    items: [{ price_id: priceId, quantity: 1 }],
    collection_mode: 'automatic',
    custom_data: { brokerage_id: brokerageId, bind },
    checkout: { url: cfg.checkoutPageUrl },
  };
  return {
    url: API_BASE[cfg.environment] + '/transactions',
    init: {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify(body),
    },
  };
}

/**
 * The page address to send the buyer to, out of Paddle's answer, or null. It must be https and on one of OUR approved hosts (the page that carries
 * Paddle.js and opens the checkout) or on Paddle's own domain: an answer that points anywhere else is never handed to a browser.
 */
export function checkoutUrlFrom(response: unknown, ownHosts: readonly string[]): string | null {
  if (!isObj(response) || !isObj(response.data) || !isObj(response.data.checkout)) return null;
  const url = response.data.checkout.url;
  if (typeof url !== 'string' || url.length > 2000) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const ours = ownHosts.some((h) => host === h.toLowerCase());
  const paddles = host === 'paddle.com' || host.endsWith('.paddle.com') || host === 'paddle.io' || host.endsWith('.paddle.io');
  if (!ours && !paddles) return null;
  return u.toString();
}

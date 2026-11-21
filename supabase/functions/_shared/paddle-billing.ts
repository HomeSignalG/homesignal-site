// THE ONE PLACE THIS REPO KNOWS PADDLE'S SHAPES (replaces the Lemon Squeezy module, founder 2026-11-16).
//
// Four things live here and nowhere else: how a webhook is verified (Paddle-Signature), how a checkout is bound to the HomeSignal account that
// started it (a signature only this server can make), how a verified Paddle event becomes the one event the payment ledger records, and how a
// customer-portal address is asked for. The database owns every decision about money and entitlement (docs/paddle-billing.sql, docs/brokerage-billing.sql).
// This file decides only whether a request really came from Paddle, whose checkout it was, and what it said.
//
// PURE of environment and network: secrets, keys and the clock arrive as arguments; the only crypto is Web Crypto. It never logs and returns no
// payload field a caller does not need (no email, name, address, card, amount or Paddle customer id ever leaves this file).
//
// SHAPES (Paddle Billing; the founder's first SANDBOX payload is what confirms them end to end, docs/paddle-billing-2026-11-16.md):
//   header      Paddle-Signature: ts=<unix seconds>;h1=<hex HMAC-SHA256 of "<ts>:<raw body>">  (several h1= appear while a secret is rotating)
//   envelope    { event_id, event_type, occurred_at, notification_id, data }
//   events used subscription.created|activated|updated|canceled|paused|resumed|past_due|trialing, transaction.completed, adjustment.created|updated
//   LIVE vs TEST is decided by WHICH webhook secret verified the delivery (Paddle sandbox and production are separate accounts with separate
//   secrets), never by anything in the body: a sandbox payload cannot claim to be live.
export const PROCESSOR = 'paddle';
export const PLANS = ['professional', 'private_partner'] as const;
export type PlanKey = typeof PLANS[number];
/** Paddle's own signature tolerance is five seconds of clock drift plus retries over days; a stale TIMESTAMP is refused, a stale EVENT is not (it is ordered by occurred_at). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type LedgerEvent = {
  processor: string;
  idempotency_key: string;
  subscription_ref: string;
  event_name: string;
  processor_status: string;
  occurred_at: string;
  product_ref?: string;
  variant_ref?: string;
  livemode: boolean;
};
export type Period = { next_billed_at: string | null; period_ends_at: string | null; cancel_effective_at: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const PADDLE_ID = /^[a-z]{2,6}_[0-9a-z]{20,40}$/;
const STATUS = /^[a-z_]{1,32}$/;
const ISO_WITH_OFFSET = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$/;
const encoder = new TextEncoder();

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}
export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}
/** Compares two strings in time that depends only on their length. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- the webhook signature ----------------------------------------------------------------------------------------------------------------
/** Parse `ts=...;h1=...` into its timestamp and every h1 value. Anything malformed is null. */
export function parseSignatureHeader(header: string | null): { ts: string; h1: string[] } | null {
  if (typeof header !== 'string' || header.length > 600) return null;
  let ts: string | null = null;
  const h1: string[] = [];
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) return null;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 'ts') { if (ts !== null) return null; ts = v; }
    else if (k === 'h1') { if (!HEX64.test(v)) return null; h1.push(v); }
  }
  if (ts === null || !/^[0-9]{9,12}$/.test(ts) || h1.length === 0) return null;
  return { ts, h1 };
}

export type Environment = 'live' | 'sandbox';
export type WebhookSecrets = { live: string; sandbox: string };
/**
 * Which Paddle environment SIGNED this delivery, or null. The signed text is `<ts>:<raw body>`; the raw text is hashed before anything parses it. An
 * empty secret verifies NOTHING (fails closed), and a timestamp outside the tolerance is refused (replay of a captured request).
 */
export async function verifyWebhook(secrets: WebhookSecrets, rawBody: string, header: string | null, nowMs: number): Promise<Environment | null> {
  if (typeof rawBody !== 'string') return null;
  const sig = parseSignatureHeader(header);
  if (!sig) return null;
  if (Math.abs(nowMs / 1000 - Number(sig.ts)) > SIGNATURE_TOLERANCE_SECONDS) return null;
  for (const env of ['live', 'sandbox'] as const) {
    const secret = secrets[env];
    if (typeof secret !== 'string' || !secret) continue;
    const expected = await hmacHex(secret, sig.ts + ':' + rawBody);
    if (sig.h1.some((h) => timingSafeEqual(h, expected))) return env;
  }
  return null;
}

// ---- the checkout binding ------------------------------------------------------------------------------------------------------------------
// A checkout opened by Paddle.js carries custom data the BROWSER can edit, so the account id alone proves nothing. This server signs
// (account, plan, enrollment) with a secret only it holds; a payment whose custom data does not carry a valid signature is never attached to an
// account. The plan is inside the signature, so a checkout made for one plan cannot be reused to pay another.
const BINDING_CONTEXT = 'hs-paddle-checkout|';
const bindingText = (brokerageId: string, plan: string, enrollmentId: string | null) => BINDING_CONTEXT + brokerageId + '|' + plan + '|' + (enrollmentId ?? '');

export async function checkoutBinding(secret: string, brokerageId: string, plan: string, enrollmentId: string | null): Promise<string> {
  if (typeof secret !== 'string' || !secret) throw new Error('paddle-billing: a binding secret is required');
  if (!UUID.test(brokerageId) || !(PLANS as readonly string[]).includes(plan) || (enrollmentId !== null && !UUID.test(enrollmentId))) throw new Error('paddle-billing: a brokerage, a plan and an optional enrollment id are required');
  return hmacHex(secret, bindingText(brokerageId, plan, enrollmentId));
}
export async function verifyBinding(secret: string, brokerageId: unknown, plan: unknown, enrollmentId: unknown, bind: unknown): Promise<boolean> {
  if (typeof secret !== 'string' || !secret || typeof brokerageId !== 'string' || !UUID.test(brokerageId) || typeof plan !== 'string' || !(PLANS as readonly string[]).includes(plan)
      || !(enrollmentId === undefined || enrollmentId === null || (typeof enrollmentId === 'string' && UUID.test(enrollmentId))) || typeof bind !== 'string' || !HEX64.test(bind)) return false;
  return timingSafeEqual(bind, await hmacHex(secret, bindingText(brokerageId, plan, typeof enrollmentId === 'string' ? enrollmentId : null)));
}

export type CheckoutSession = {
  environment: 'sandbox' | 'production';
  clientToken: string;
  priceId: string;
  customData: { brokerage_id: string; plan: PlanKey; enrollment_id?: string; bind: string };
};
/** What the browser needs to open Paddle's overlay: the public client token, the price, and the signed custom data. No secret. */
export async function checkoutSession(cfg: { environment: 'sandbox' | 'production'; clientToken: string; bindingSecret: string }, brokerageId: string, plan: PlanKey, enrollmentId: string | null, priceId: string): Promise<CheckoutSession> {
  if (!cfg.clientToken || !cfg.bindingSecret || !PADDLE_ID.test(priceId) || !priceId.startsWith('pri_')) throw new Error('paddle-billing: the checkout is not configured');
  const bind = await checkoutBinding(cfg.bindingSecret, brokerageId, plan, enrollmentId);
  return {
    environment: cfg.environment, clientToken: cfg.clientToken, priceId,
    customData: { brokerage_id: brokerageId, plan, ...(enrollmentId ? { enrollment_id: enrollmentId } : {}), bind },
  };
}

// ---- the webhook body -> the ledger's event ------------------------------------------------------------------------------------------------
export const SUBSCRIPTION_EVENTS: readonly string[] = [
  'subscription.created', 'subscription.activated', 'subscription.updated', 'subscription.canceled', 'subscription.paused',
  'subscription.resumed', 'subscription.past_due', 'subscription.trialing',
];
export type Translation =
  | { kind: 'event'; brokerageId: string; plan: PlanKey; enrollmentId: string | null; event: LedgerEvent; period: Period | null }
  | { kind: 'refund'; event: LedgerEvent }
  | { kind: 'unbound'; reason: 'no_binding' | 'bad_binding'; event: LedgerEvent }
  | { kind: 'ignore'; reason: string }
  | { kind: 'invalid'; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asId = (v: unknown, prefix: string): string | null => (typeof v === 'string' && v.startsWith(prefix) && PADDLE_ID.test(v) ? v : null);
const asTime = (v: unknown): string | null => (typeof v === 'string' && ISO_WITH_OFFSET.test(v) && Number.isFinite(Date.parse(v)) ? v : null);

/** The single price of a subscription or transaction. More than one line item is not a plan we sell: refused, never guessed. */
function onlyPrice(items: unknown): { price: string; product: string | undefined } | null {
  if (!Array.isArray(items) || items.length !== 1 || !isObj(items[0])) return null;
  const it = items[0] as Record<string, unknown>;
  const price = isObj(it.price) ? it.price : null;
  const id = asId(price?.id ?? it.price_id, 'pri_');
  if (id === null) return null;
  const product = price ? asId(price.product_id, 'pro_') : null;
  return { price: id, product: product ?? undefined };
}

export async function translate(payload: unknown, env: Environment, bindingSecret: string): Promise<Translation> {
  if (!isObj(payload) || !isObj(payload.data)) return { kind: 'invalid', reason: 'shape' };
  const eventType = payload.event_type;
  if (typeof eventType !== 'string' || !/^[a-z_.]{3,64}$/.test(eventType)) return { kind: 'invalid', reason: 'event_type' };
  const isSub = SUBSCRIPTION_EVENTS.includes(eventType);
  const isTxn = eventType === 'transaction.completed';
  const isAdj = eventType === 'adjustment.created' || eventType === 'adjustment.updated';
  if (!isSub && !isTxn && !isAdj) return { kind: 'ignore', reason: 'event_type' };

  const key = typeof payload.event_id === 'string' && /^evt_[0-9a-z]{20,40}$/.test(payload.event_id) ? payload.event_id : null;
  if (key === null) return { kind: 'invalid', reason: 'event_id' };
  const occurred = asTime(payload.occurred_at);
  if (occurred === null) return { kind: 'invalid', reason: 'occurred_at' };
  const data = payload.data as Record<string, unknown>;
  const livemode = env === 'live';

  if (isAdj) {
    // only a FULL, APPROVED refund (or chargeback) takes access away; a partial one changes nothing
    const action = data.action;
    if (action !== 'refund' && action !== 'chargeback') return { kind: 'ignore', reason: 'adjustment_action' };
    if (data.type !== 'full') return { kind: 'ignore', reason: 'adjustment_partial' };
    if (data.status !== 'approved') return { kind: 'ignore', reason: 'adjustment_status' };
    const ref = asId(data.subscription_id, 'sub_') ?? asId(data.transaction_id, 'txn_');
    if (ref === null) return { kind: 'invalid', reason: 'adjustment_ref' };
    return { kind: 'refund', event: { processor: PROCESSOR, idempotency_key: key, subscription_ref: ref, event_name: 'adjustment_' + action, processor_status: 'refunded', occurred_at: occurred, livemode } };
  }

  const price = onlyPrice(data.items);
  if (price === null) return { kind: 'invalid', reason: 'items' };
  let ref: string | null, status: unknown, period: Period | null = null;
  if (isSub) {
    ref = asId(data.id, 'sub_');
    status = data.status;
    const bp = isObj(data.current_billing_period) ? data.current_billing_period : null;
    const sc = isObj(data.scheduled_change) ? data.scheduled_change : null;
    period = {
      next_billed_at: asTime(data.next_billed_at),
      period_ends_at: bp ? asTime(bp.ends_at) : null,
      cancel_effective_at: sc && sc.action === 'cancel' ? asTime(sc.effective_at) : null,
    };
  } else {
    // a one-time purchase only: a subscription's own transactions are followed through its subscription events
    if (data.subscription_id !== null && data.subscription_id !== undefined) return { kind: 'ignore', reason: 'subscription_transaction' };
    ref = asId(data.id, 'txn_');
    status = data.status;
  }
  if (ref === null) return { kind: 'invalid', reason: 'id' };
  if (typeof status !== 'string' || !STATUS.test(status)) return { kind: 'invalid', reason: 'status' };
  const event: LedgerEvent = {
    processor: PROCESSOR,
    idempotency_key: key,
    subscription_ref: ref,
    event_name: eventType.replace('.', '_'),
    processor_status: status,
    occurred_at: occurred,
    ...(price.product ? { product_ref: price.product } : {}),
    variant_ref: price.price,
    livemode,
  };

  // which account: the checkout's own signed custom data
  const custom = data.custom_data;
  if (!isObj(custom) || typeof custom.brokerage_id !== 'string' || typeof custom.plan !== 'string' || typeof custom.bind !== 'string') return { kind: 'unbound', reason: 'no_binding', event };
  if (!(await verifyBinding(bindingSecret, custom.brokerage_id, custom.plan, custom.enrollment_id, custom.bind))) return { kind: 'unbound', reason: 'bad_binding', event };
  return {
    kind: 'event', brokerageId: custom.brokerage_id, plan: custom.plan as PlanKey,
    enrollmentId: typeof custom.enrollment_id === 'string' ? custom.enrollment_id : null, event, period,
  };
}

// ---- the customer portal -------------------------------------------------------------------------------------------------------------------------
export const API_BASE = { production: 'https://api.paddle.com', sandbox: 'https://sandbox-api.paddle.com' } as const;

/** The request for one subscription, whose answer carries Paddle's own "update payment method" and "cancel" addresses. Returned unsent so a test can read every byte. */
export function subscriptionRequest(cfg: { environment: 'sandbox' | 'production'; apiKey: string }, subscriptionRef: string): { url: string; init: { method: string; headers: Record<string, string> } } {
  if (!cfg.apiKey) throw new Error('paddle-billing: the Paddle API key is not configured');
  if (asId(subscriptionRef, 'sub_') === null) throw new Error('paddle-billing: a subscription id is required');
  return { url: API_BASE[cfg.environment] + '/subscriptions/' + subscriptionRef, init: { method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + cfg.apiKey } } };
}

/** An https address on paddle.com, with no credentials. Anything else is never handed to a browser. */
export function paddleUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2000) return null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  return host === 'paddle.com' || host.endsWith('.paddle.com') ? u.toString() : null;
}
export type ManagementUrls = { update_payment_method: string | null; cancel: string | null };
export function managementUrlsFrom(response: unknown): ManagementUrls | null {
  if (!isObj(response) || !isObj(response.data) || !isObj(response.data.management_urls)) return null;
  const m = response.data.management_urls;
  const out = { update_payment_method: paddleUrl(m.update_payment_method), cancel: paddleUrl(m.cancel) };
  return out.update_payment_method || out.cancel ? out : null;
}

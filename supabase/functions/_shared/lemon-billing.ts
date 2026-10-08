// THE ONE PLACE THIS REPO KNOWS LEMON SQUEEZY'S SHAPES (Development Activity build step 11).
//
// Three things live here and nowhere else: how a checkout is asked for, how an incoming webhook is verified, and how a verified webhook body becomes
// the one event the payment ledger records. The database owns every decision about money and entitlement (docs/brokerage-billing.sql: whether a
// brokerage is paid, which allotment a report uses); this file decides only whether a request really came from the processor and what it said.
//
// PURE of environment and network: the secret, the keys and the clock arrive as arguments, and the only crypto is the platform's Web Crypto.
// It names no Deno global, so a test can drive it with fixed values. It never logs, and it returns no payload field a caller does not need.
//
// WHAT HAS NOT BEEN SEEN. This was written WITHOUT a captured Lemon Squeezy payload and without reaching the processor's documentation from the
// build sandbox (docs.lemonsqueezy.com is blocked there). Every field below is read from a documented shape recalled through search results, not
// from a real webhook. It is therefore built to REFUSE what it does not recognise: a payload that does not carry the fields it needs is `invalid`
// (the webhook answers 422, loudly), never guessed. The founder's one test payment, in the processor's test mode, is what confirms the shape;
// docs/development-activity-billing-2026-10-04.md says exactly what to check.
//
//   Verified here by reading and by tests:  the signature rule (HMAC-SHA256 of the RAW body, hex, constant-time), the checkout binding, the
//                                           translation, and that nothing personal is passed on.
//   NOT verified against the processor:     the field names (meta.event_name, meta.test_mode, meta.custom_data, data.type, data.id,
//                                           data.attributes.status / updated_at / variant_id / product_id), the checkout request shape and the
//                                           checkout response's url field.

export const PROCESSOR = 'lemonsqueezy';
export const CHECKOUT_ENDPOINT = 'https://api.lemonsqueezy.com/v1/checkouts';

/**
 * The subscription lifecycle events the plan acts on. Order, invoice and licence events (and the payment success / failure events, whose data is a
 * subscription INVOICE) are acknowledged and not recorded: the plan follows the subscription's own status, and every status change arrives as one of these.
 */
export const SUBSCRIPTION_EVENTS: readonly string[] = [
  'subscription_created', 'subscription_updated', 'subscription_cancelled', 'subscription_resumed',
  'subscription_expired', 'subscription_paused', 'subscription_unpaused',
];

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
const ISO_WITH_OFFSET = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$/;

const encoder = new TextEncoder();

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
 * Whether a webhook really came from the processor: the X-Signature header is the HMAC-SHA256 of the RAW request body under the webhook's signing
 * secret, in hex. The raw text is what was signed, so it is hashed before anything parses it. An empty secret verifies NOTHING (fails closed).
 */
export async function verifySignature(secret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (typeof secret !== 'string' || !secret || typeof rawBody !== 'string' || typeof header !== 'string') return false;
  const given = header.trim().toLowerCase();
  if (!HEX64.test(given)) return false;
  return timingSafeEqual(given, await hmacHex(secret, rawBody));
}

// ---- the checkout binding -------------------------------------------------------------------------------------------------------------------
// A checkout carries the brokerage's id in its custom data, and that id is what the webhook binds a subscription to. A buyer can add custom data
// to a PUBLIC buy link themselves, so the id alone proves nothing about who made the checkout. Every checkout this server makes therefore also
// carries a signature of that id (`bind`), made with the webhook's own signing secret under a fixed context; a checkout without a valid one is
// ignored, so a subscription can only ever be bound to a brokerage by a checkout HomeSignal itself made for it.
const BINDING_CONTEXT = 'hs-billing-checkout|';

export async function checkoutBinding(secret: string, brokerageId: string): Promise<string> {
  if (typeof secret !== 'string' || !secret) throw new Error('lemon-billing: a signing secret is required');
  if (!UUID.test(brokerageId)) throw new Error('lemon-billing: a brokerage id is required');
  return hmacHex(secret, BINDING_CONTEXT + brokerageId);
}

export async function verifyBinding(secret: string, brokerageId: unknown, bind: unknown): Promise<boolean> {
  if (typeof secret !== 'string' || !secret || typeof brokerageId !== 'string' || !UUID.test(brokerageId) || typeof bind !== 'string' || !HEX64.test(bind)) return false;
  return timingSafeEqual(bind, await hmacHex(secret, BINDING_CONTEXT + brokerageId));
}

// ---- the webhook body -> the ledger's event ------------------------------------------------------------------------------------------------
export type WebhookConfig = { secret: string; variantId: string };
/**
 * `event`   a subscription event of OUR variant, for a brokerage a checkout of ours named: record it.
 * `ignore`  a verified webhook that is not ours to act on (another product's, an order or invoice event, a forged binding): acknowledge it.
 * `invalid` a webhook that should have been ours and is not shaped as expected: refuse it loudly.
 */
export type Translation =
  | { kind: 'event'; brokerageId: string; event: LedgerEvent }
  | { kind: 'ignore'; reason: string }
  | { kind: 'invalid'; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asRef = (v: unknown): string | null => {
  const s = typeof v === 'number' && Number.isInteger(v) && v >= 0 ? String(v) : typeof v === 'string' ? v : null;
  return s !== null && REF.test(s) ? s : null;
};

export async function translate(payload: unknown, cfg: WebhookConfig): Promise<Translation> {
  if (!isObj(payload) || !isObj(payload.meta) || !isObj(payload.data)) return { kind: 'invalid', reason: 'shape' };
  const meta = payload.meta, data = payload.data;
  const eventName = meta.event_name;
  if (typeof eventName !== 'string' || !/^[a-z_]{1,64}$/.test(eventName)) return { kind: 'invalid', reason: 'event_name' };
  if (!SUBSCRIPTION_EVENTS.includes(eventName)) return { kind: 'ignore', reason: 'event_name' };
  if (data.type !== 'subscriptions') return { kind: 'ignore', reason: 'type' };

  // which brokerage: the checkout's own custom data, and only if it carries the signature this server put on it
  const custom = meta.custom_data;
  if (!isObj(custom) || typeof custom.brokerage_id !== 'string' || typeof custom.bind !== 'string') return { kind: 'ignore', reason: 'no_binding' };
  if (!(await verifyBinding(cfg.secret, custom.brokerage_id, custom.bind))) return { kind: 'ignore', reason: 'bad_binding' };

  const attrs = data.attributes;
  if (!isObj(attrs)) return { kind: 'invalid', reason: 'attributes' };
  const variant = asRef(attrs.variant_id);
  if (variant === null) return { kind: 'invalid', reason: 'variant_id' };
  if (!cfg.variantId || variant !== cfg.variantId) return { kind: 'ignore', reason: 'variant' };

  const testMode = typeof meta.test_mode === 'boolean' ? meta.test_mode : typeof attrs.test_mode === 'boolean' ? attrs.test_mode : null;
  if (testMode === null) return { kind: 'invalid', reason: 'test_mode' };
  const id = asRef(data.id);
  if (id === null) return { kind: 'invalid', reason: 'id' };
  const status = attrs.status;
  if (typeof status !== 'string' || !STATUS.test(status)) return { kind: 'invalid', reason: 'status' };
  const updated = attrs.updated_at;
  if (typeof updated !== 'string' || !ISO_WITH_OFFSET.test(updated) || !Number.isFinite(Date.parse(updated))) return { kind: 'invalid', reason: 'updated_at' };
  const product = attrs.product_id === undefined ? undefined : asRef(attrs.product_id);
  if (product === null) return { kind: 'invalid', reason: 'product_id' };

  const event: LedgerEvent = {
    processor: PROCESSOR,
    // one key per (event, subscription, the subscription's own last-updated time): a retry carries the same three, a later change carries a new time.
    // PROVISIONAL (docs/payment-event-ledger.sql, section 5): the processor's payload carries no per-delivery id that this build could confirm.
    idempotency_key: eventName + ':' + id + ':' + updated,
    subscription_ref: id,
    event_name: eventName,
    processor_status: status,
    occurred_at: updated,
    ...(product !== undefined ? { product_ref: product } : {}),
    variant_ref: variant,
    livemode: !testMode,
  };
  return { kind: 'event', brokerageId: custom.brokerage_id, event };
}

// ---- the checkout request -----------------------------------------------------------------------------------------------------------------------
export type CheckoutConfig = { apiKey: string; storeId: string; variantId: string; secret: string; testMode: boolean; redirectUrl: string };
export const CHECKOUT_LIFETIME_MS = 60 * 60 * 1000;

/**
 * The request that asks the processor for ONE checkout for ONE brokerage. The brokerage's id and its signature ride in the checkout's custom data,
 * which the processor sends back on every subscription event. The success page (`redirect_url`) only brings the person back: it grants nothing.
 * Returns the request without sending it, so a test can look at every byte; `init.headers` carries the API key and must never be logged.
 */
export async function checkoutRequest(cfg: CheckoutConfig, brokerageId: string, now: Date): Promise<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> {
  if (!cfg.apiKey || !cfg.storeId || !cfg.variantId || !cfg.secret) throw new Error('lemon-billing: the checkout is not configured');
  if (!/^[0-9]{1,20}$/.test(cfg.storeId) || !/^[0-9]{1,20}$/.test(cfg.variantId)) throw new Error('lemon-billing: the store and variant ids are numbers');
  const bind = await checkoutBinding(cfg.secret, brokerageId);
  const body = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: { custom: { brokerage_id: brokerageId, bind } },
        product_options: { redirect_url: cfg.redirectUrl },
        expires_at: new Date(now.getTime() + CHECKOUT_LIFETIME_MS).toISOString(),
        ...(cfg.testMode ? { test_mode: true } : {}),
      },
      relationships: {
        store: { data: { type: 'stores', id: cfg.storeId } },
        variant: { data: { type: 'variants', id: cfg.variantId } },
      },
    },
  };
  return {
    url: CHECKOUT_ENDPOINT,
    init: {
      method: 'POST',
      headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify(body),
    },
  };
}

/**
 * The checkout address out of the processor's answer, or null. It must be an https address on the processor's own domain: an answer that
 * points anywhere else is never handed to a browser. (A store on a custom checkout domain would need this widened on purpose.)
 */
export function checkoutUrlFrom(response: unknown): string | null {
  if (!isObj(response) || !isObj(response.data) || !isObj(response.data.attributes)) return null;
  const url = response.data.attributes.url;
  if (typeof url !== 'string' || url.length > 2000) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host !== 'lemonsqueezy.com' && !host.endsWith('.lemonsqueezy.com')) return null;
  return u.toString();
}

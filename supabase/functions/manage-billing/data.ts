// manage-billing — the real reads, built from an INJECTED fetch and config.
//
// This file names no Deno global: `index.ts` passes the environment and `fetch` in, so a test can hand it a stub and look at every request it would
// make. It decides nothing: the user lookup and the admin allow-list are _shared/service-rest.ts, the plan is _shared/billing-reads.ts, and the
// checkout request and its answer are _shared/lemon-billing.ts. It holds the API key only inside the request it builds and never returns, logs or
// stores it.
import type { Deps } from './handler.ts';
import { CheckoutUnavailable } from './handler.ts';
import { makeServiceReads } from '../_shared/service-rest.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { makeBillingReads, BILLING_PAGE } from '../_shared/billing-reads.ts';
import { checkoutRequest, checkoutUrlFrom } from '../_shared/lemon-billing.ts';
import { transactionRequest, transactionIdFrom } from '../_shared/paddle-billing.ts';
import type { PaddleEnvironment } from '../_shared/paddle-billing.ts';

export type BillingSettings = { apiKey: string; storeId: string; variantId: string; secret: string; testMode: boolean };
/** Paddle settings for the ONE environment this deployment sells in (PADDLE_CHECKOUT_ENVIRONMENT). All are server settings; the client token is public by design. */
export type PaddleSettings = { environment: PaddleEnvironment | ''; apiKey: string; clientToken: string; priceId: string; secret: string };
export type Config = { url: string; serviceKey: string; billing: BillingSettings; paddle?: PaddleSettings; paddleSandboxCheckoutEnabled?: boolean; checkoutEnabled?: boolean };
const NO_PADDLE: PaddleSettings = { environment: '', apiKey: '', clientToken: '', priceId: '', secret: '' };

/** Whether every Paddle setting is present and well-formed, and the token's prefix matches the environment (live_ for live, test_ for sandbox). A boolean only. */
export function isPaddleConfigured(p: PaddleSettings): boolean {
  if (p.environment !== 'live' && p.environment !== 'sandbox') return false;
  const prefix = p.environment === 'live' ? 'live_' : 'test_';
  return !!p.apiKey && !!p.secret && p.clientToken.startsWith(prefix) && /^pri_[A-Za-z0-9]{10,40}$/.test(p.priceId);
}

/** Whether every setting the checkout needs is present and well-formed. A boolean only: a value is never reported. */
export function isConfigured(b: BillingSettings): boolean {
  return !!b.apiKey && !!b.secret && /^[0-9]{1,20}$/.test(b.storeId) && /^[0-9]{1,20}$/.test(b.variantId);
}

export function makeDeps(config: Config, fetchFn: FetchFn): Deps {
  const cfg = { ...config, paddle: config.paddle ?? NO_PADDLE, paddleSandboxCheckoutEnabled: config.paddleSandboxCheckoutEnabled === true, checkoutEnabled: config.checkoutEnabled === true };
  const { rpc, authenticate, isAdmin } = makeServiceReads(cfg, fetchFn);
  const billing = makeBillingReads(rpc);
  return {
    authenticate, isAdmin, usageOf: billing.usageOf,
    checkoutClaim: billing.checkoutClaim, checkoutRelease: billing.checkoutRelease,
    configured: () => isConfigured(cfg.billing),
    paddleConfigured: () => isPaddleConfigured(cfg.paddle),
    // Live checkout is the committed kill switch (_shared/billing-switch.ts CHECKOUT_ENABLED). A Sandbox deployment is a separate committed switch, so a
    // sandbox checkout can be tested without ever opening a live one, and a live deployment can never open on the sandbox switch.
    paddleEnabled: () => cfg.paddle.environment === 'live' ? cfg.checkoutEnabled : cfg.paddle.environment === 'sandbox' && cfg.paddleSandboxCheckoutEnabled,
    async createPaddleTransaction(brokerageId: string) {
      if (!isPaddleConfigured(cfg.paddle)) throw new CheckoutUnavailable('not configured');
      const environment = cfg.paddle.environment as PaddleEnvironment;
      const req = await transactionRequest({ environment, apiKey: cfg.paddle.apiKey, priceId: cfg.paddle.priceId, secret: cfg.paddle.secret }, brokerageId);
      let r: Response;
      try { r = await fetchFn(req.url, req.init); } catch { throw new CheckoutUnavailable('network'); }
      if (!r.ok) throw new CheckoutUnavailable('http ' + r.status);   // the answer's body is never read or repeated
      const id = transactionIdFrom(await r.json().catch(() => null));
      if (!id) throw new CheckoutUnavailable('shape');
      return { environment: environment === 'live' ? 'production' as const : 'sandbox' as const, token: cfg.paddle.clientToken, transaction_id: id };
    },
    async createCheckout(brokerageId: string): Promise<string> {
      if (!isConfigured(cfg.billing)) throw new CheckoutUnavailable('not configured');
      const req = await checkoutRequest({ ...cfg.billing, redirectUrl: BILLING_PAGE }, brokerageId, new Date());
      let r: Response;
      try { r = await fetchFn(req.url, req.init); } catch { throw new CheckoutUnavailable('network'); }
      if (!r.ok) throw new CheckoutUnavailable('http ' + r.status);   // the answer's body is never read or repeated: it can name the buyer
      const url = checkoutUrlFrom(await r.json().catch(() => null));
      if (!url) throw new CheckoutUnavailable('shape');
      return url;
    },
  };
}

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

export type BillingSettings = { apiKey: string; storeId: string; variantId: string; secret: string; testMode: boolean };
export type Config = { url: string; serviceKey: string; billing: BillingSettings };

/** Whether every setting the checkout needs is present and well-formed. A boolean only: a value is never reported. */
export function isConfigured(b: BillingSettings): boolean {
  return !!b.apiKey && !!b.secret && /^[0-9]{1,20}$/.test(b.storeId) && /^[0-9]{1,20}$/.test(b.variantId);
}

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const { rpc, authenticate, isAdmin } = makeServiceReads(cfg, fetchFn);
  const billing = makeBillingReads(rpc);
  return {
    authenticate, isAdmin, usageOf: billing.usageOf,
    configured: () => isConfigured(cfg.billing),
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

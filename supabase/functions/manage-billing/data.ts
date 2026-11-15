// manage-billing — the real reads, built from an INJECTED fetch and config.
//
// This file names no Deno global: `index.ts` passes the environment and `fetch` in, so a test can hand it a stub and look at every request it would
// make. It decides nothing: the user lookup and the admin allow-list are _shared/service-rest.ts, the plan is _shared/billing-reads.ts, and the
// checkout request and its answer are _shared/paddle-billing.ts. It holds the API key only inside the request it builds and never returns, logs or
// stores it.
import type { Deps } from './handler.ts';
import { CheckoutUnavailable } from './handler.ts';
import { makeServiceReads } from '../_shared/service-rest.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { makeBillingReads, BILLING_PAGE } from '../_shared/billing-reads.ts';
import { checkoutRequest, checkoutUrlFrom, isPriceId } from '../_shared/paddle-billing.ts';
import type { BillingEnvironment, OfferKey, OfferPrices } from '../_shared/paddle-billing.ts';

/** `clientToken` is the processor's client-side token: public by design (it only identifies the account to the checkout script). The API key and the secret are not. */
export type BillingSettings = { apiKey: string; secret: string; prices: OfferPrices; environment: BillingEnvironment | ''; clientToken: string };
export type Config = { url: string; serviceKey: string; billing: BillingSettings };

/** The host(s) of the page that carries the checkout script, from the one public billing address: the processor's checkout link comes back to it. */
const OWN_HOSTS: readonly string[] = [new URL(BILLING_PAGE).hostname];

/** Whether every setting a checkout needs is present and well-formed: the key, the secret, the environment and the Professional price. A boolean only. */
export function isConfigured(b: BillingSettings): boolean {
  return !!b.apiKey && !!b.secret && (b.environment === 'production' || b.environment === 'sandbox') && isPriceId(b.prices.professional);
}

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const { rpc, authenticate, isAdmin } = makeServiceReads(cfg, fetchFn);
  const billing = makeBillingReads(rpc);
  return {
    authenticate, isAdmin, usageOf: billing.usageOf, accountTypeOf: billing.accountTypeOf,
    checkoutClaim: billing.checkoutClaim, checkoutRelease: billing.checkoutRelease,
    configured: () => isConfigured(cfg.billing),
    clientConfig: () => (cfg.billing.clientToken && /^[A-Za-z0-9_]{10,80}$/.test(cfg.billing.clientToken) && (cfg.billing.environment === 'production' || cfg.billing.environment === 'sandbox'))
      ? { environment: cfg.billing.environment, token: cfg.billing.clientToken } : null,
    async createCheckout(brokerageId: string, offer: OfferKey): Promise<string> {
      if (!isConfigured(cfg.billing) || cfg.billing.environment === '' || !isPriceId(cfg.billing.prices[offer])) throw new CheckoutUnavailable('not configured');
      const req = await checkoutRequest({ apiKey: cfg.billing.apiKey, secret: cfg.billing.secret, prices: cfg.billing.prices, environment: cfg.billing.environment, checkoutPageUrl: BILLING_PAGE }, brokerageId, offer);
      let r: Response;
      try { r = await fetchFn(req.url, req.init); } catch { throw new CheckoutUnavailable('network'); }
      if (!r.ok) throw new CheckoutUnavailable('http ' + r.status);   // the answer's body is never read or repeated: it can name the buyer
      const url = checkoutUrlFrom(await r.json().catch(() => null), OWN_HOSTS);
      if (!url) throw new CheckoutUnavailable('shape');
      return url;
    },
  };
}

// manage-billing — the real reads, built from an INJECTED fetch and config. Names no Deno global: `index.ts` passes the environment and `fetch` in, so a
// test can hand it a stub and look at every request it would make. It decides nothing: the user lookup and admin allow-list are _shared/service-rest.ts,
// the plan is _shared/billing-reads.ts, and every Paddle shape is _shared/paddle-billing.ts. It holds the API key only inside the request it builds.
import type { Deps } from './handler.ts';
import { CheckoutUnavailable } from './handler.ts';
import { makeServiceReads } from '../_shared/service-rest.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { makeBillingReads } from '../_shared/billing-reads.ts';
import { checkoutSession, managementUrlsFrom, sha256Hex, subscriptionRequest } from '../_shared/paddle-billing.ts';

export type PaddleSettings = { environment: 'sandbox' | 'production'; clientToken: string; apiKey: string; bindingSecret: string };
export type Config = { url: string; serviceKey: string; paddle: PaddleSettings };

/** Paddle's public client-side token: `live_...` for production, `test_...` for sandbox. A token for the wrong environment is not "configured". */
export function isConfigured(p: PaddleSettings): boolean {
  const tokenOk = p.environment === 'production' ? /^live_[0-9a-z]{20,64}$/.test(p.clientToken) : /^test_[0-9a-z]{20,64}$/.test(p.clientToken);
  return tokenOk && !!p.bindingSecret;
}

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const { rpc, authenticate, isAdmin } = makeServiceReads(cfg, fetchFn);
  const billing = makeBillingReads(rpc);
  const livemode = cfg.paddle.environment === 'production';
  return {
    authenticate, isAdmin, summaryOf: billing.summaryOf, partnerStart: billing.partnerStart, sha256: sha256Hex,
    checkoutClaim: billing.checkoutClaim, checkoutRelease: billing.checkoutRelease,
    configured: () => isConfigured(cfg.paddle),
    apiConfigured: () => !!cfg.paddle.apiKey,
    async makeSession(brokerageId, plan, enrollmentId) {
      if (!isConfigured(cfg.paddle)) throw new CheckoutUnavailable('not configured');
      const price = await billing.priceFor(plan, livemode);
      if (!price) throw new CheckoutUnavailable('no price for the plan in this environment');
      return checkoutSession({ environment: cfg.paddle.environment, clientToken: cfg.paddle.clientToken, bindingSecret: cfg.paddle.bindingSecret }, brokerageId, plan, enrollmentId, price);
    },
    async managementUrls(userId) {
      const ref = await billing.portalRef(userId);
      if (!ref || ref.livemode !== livemode) return null;       // a test subscription is never opened through the production API, or the reverse
      const req = subscriptionRequest({ environment: cfg.paddle.environment, apiKey: cfg.paddle.apiKey }, ref.subscription_ref);
      let r: Response;
      try { r = await fetchFn(req.url, req.init); } catch { throw new CheckoutUnavailable('network'); }
      if (!r.ok) throw new CheckoutUnavailable('http ' + r.status);      // the answer's body is never read or repeated: it can name the buyer
      return managementUrlsFrom(await r.json().catch(() => null));
    },
    checkoutEnabled: () => true,        // replaced by index.ts with the committed switch
  };
}

// development-activity-paddle-webhook — the real database calls, built from an INJECTED fetch and config. Decides nothing (see handler.ts).
import type { Deps, EnvConfig } from './handler.ts';
import { makeServiceReads } from '../_shared/service-rest.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { makeBillingReads } from '../_shared/billing-reads.ts';

export type Config = { url: string; serviceKey: string; live: EnvConfig; sandbox: EnvConfig };

export function makeDeps(cfg: Config, fetchFn: FetchFn, nowSeconds: () => number): Deps {
  const { rpc } = makeServiceReads(cfg, fetchFn);
  const billing = makeBillingReads(rpc);
  return { live: cfg.live, sandbox: cfg.sandbox, applyEvent: billing.applyEvent, bindingOf: billing.bindingOf, nowSeconds };
}

// development-activity-billing-webhook — the real database call, built from an INJECTED fetch and config.
//
// This file names no Deno global: `index.ts` passes the environment and `fetch` in, so a test can hand it a stub and look at every request it would
// make. It decides nothing. Recording an event is ONE database function (public.billing_event_apply, through _shared/billing-reads.ts), which binds
// the subscription to the brokerage and records the event in one transaction, through the payment ledger's one writer.
import type { Deps } from './handler.ts';
import { makeServiceReads } from '../_shared/service-rest.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { makeBillingReads } from '../_shared/billing-reads.ts';

export type Config = { url: string; serviceKey: string; secret: string; variantId: string };

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const { rpc } = makeServiceReads(cfg, fetchFn);
  const billing = makeBillingReads(rpc);
  return { secret: cfg.secret, variantId: cfg.variantId, applyEvent: billing.applyEvent };
}

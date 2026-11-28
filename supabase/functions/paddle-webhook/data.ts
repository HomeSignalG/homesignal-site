// paddle-webhook — the real database calls, built from an INJECTED fetch and config. Names no Deno global. It decides nothing: recording an event is
// ONE database function (public.paddle_event_apply / paddle_adjustment_apply, through _shared/billing-reads.ts).
import type { Deps } from './handler.ts';
import { makeServiceReads } from '../_shared/service-rest.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { makeBillingReads } from '../_shared/billing-reads.ts';

export type Config = { url: string; serviceKey: string; secrets: { live: string; sandbox: string }; bindingSecret: string };

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const { rpc } = makeServiceReads(cfg, fetchFn);
  const billing = makeBillingReads(rpc);
  return {
    secrets: cfg.secrets, bindingSecret: cfg.bindingSecret, now: () => Date.now(),
    applyEvent: billing.applyEvent, applyRefund: billing.applyRefund, recordUnbound: billing.recordUnbound,
  };
}

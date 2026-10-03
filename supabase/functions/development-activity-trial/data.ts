// development-activity-trial — the real reads, built from an INJECTED fetch and config.
//
// This file names no Deno global: `index.ts` passes the environment and `fetch` in, so a test can hand it a stub and look at every
// request it would make. It decides nothing: the user lookup and the admin allow-list are _shared/service-rest.ts, and every trial
// call is _shared/evaluation-reads.ts (the same module the report function uses).
import type { Deps } from './handler.ts';
import { makeServiceReads } from '../_shared/service-rest.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { makeEvaluationReads } from '../_shared/evaluation-reads.ts';

export type Config = { url: string; serviceKey: string };

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const { rpc, authenticate, isAdmin } = makeServiceReads(cfg, fetchFn);
  const evaluation = makeEvaluationReads(rpc);
  return {
    authenticate, isAdmin, trialOf: evaluation.trialOf, redeemInvite: evaluation.redeemInvite, createTrial: evaluation.createTrial,
    roleOf: evaluation.roleOf, inviteAgent: evaluation.inviteAgent, now: () => new Date(),
  };
}

// manage-shared-report — the real reads, built from an INJECTED fetch and config.
//
// This file names no Deno global: `index.ts` passes the environment and `fetch` in, so a test can hand it a stub and look at every request it
// would make. It decides nothing: the user lookup and the admin allow-list are _shared/service-rest.ts, and every link call is
// _shared/share-reads.ts (the same module the client's function uses).
import type { Deps } from './handler.ts';
import { makeServiceReads } from '../_shared/service-rest.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { makeShareReads } from '../_shared/share-reads.ts';

export type Config = { url: string; serviceKey: string };

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const { rpc, authenticate, isAdmin } = makeServiceReads(cfg, fetchFn);
  const shares = makeShareReads(rpc);
  return { authenticate, isAdmin, createShare: shares.createShare, listShares: shares.listShares, revokeShare: shares.revokeShare };
}

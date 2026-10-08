// manage-property-watch — the real reads, built from an INJECTED fetch and config.
//
// This file names no Deno global: `index.ts` passes the environment and `fetch` in, so a test can hand it a stub and look at every request it
// would make. It decides nothing: the user lookup and the admin allow-list are _shared/service-rest.ts, every watch call is
// _shared/watch-reads.ts (the same module the daily job uses), and the address shown is _shared/private-subject.ts (the one reader of the
// private layer for display).
import type { Deps } from './handler.ts';
import { LABEL_MAX } from './handler.ts';
import { makeServiceReads } from '../_shared/service-rest.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { makeWatchReads } from '../_shared/watch-reads.ts';
import { makePrivateSubjectReads } from '../_shared/private-subject.ts';

export type Config = { url: string; serviceKey: string };

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const { rpc, rest, authenticate, isAdmin } = makeServiceReads(cfg, fetchFn);
  const watches = makeWatchReads(rpc, rest);
  const subjects = makePrivateSubjectReads(rpc);
  return {
    authenticate, isAdmin,
    startWatch: watches.startWatch, watchesOf: watches.watchesOf, stopWatch: watches.stopWatch,
    addressOf: (contextId) => subjects.subjectOf(contextId, LABEL_MAX).then((s) => s.address),
  };
}

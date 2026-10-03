// view-shared-report — the real reads, built from an INJECTED fetch and config.
//
// This file names no Deno global: `index.ts` passes the environment and `fetch` in, so a test can hand it a stub and look at every request it
// would make. It decides nothing. The link's database call is _shared/share-reads.ts (the same module the agent's function uses), and the
// address comes from the one reader of the private layer, _shared/private-subject.ts, through its ADDRESS-ONLY window: this function has no
// way to ask for the label an agent typed.
import type { Deps } from './handler.ts';
import { makeServiceReads } from '../_shared/service-rest.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { makeShareReads } from '../_shared/share-reads.ts';
import { makePrivateSubjectReads } from '../_shared/private-subject.ts';

export type Config = { url: string; serviceKey: string };

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const { rpc } = makeServiceReads(cfg, fetchFn);
  const shares = makeShareReads(rpc);
  const subjects = makePrivateSubjectReads(rpc);
  return { openShared: shares.openShared, addressOf: subjects.addressOf };
}

// follow-development-report — the real database reads and writes, built from an INJECTED fetch and config.
//
// This file names no Deno global: `index.ts` passes the environment and `fetch` in, so a test can hand it a stub and look at
// every request it would make. It holds no rule about what a change is (_shared/national-report.ts), what "since" means
// (_shared/changes-since-report.ts) or who may ask (_shared/admin-gate.ts). The shared reads — the admin allow-list, the user
// lookup and the ledger — are _shared/service-rest.ts and _shared/change-reads.ts, used unchanged.
//
// THE ONLY WRITE is the existing, locked database function public.report_private_context_need_open / _need_close with kind
// 'follow'. It reads report_snapshot in two separate selects: the permanent body (changes) and the opaque private_context_id
// (follow, unfollow). It never calls the private layer's read function (the one that returns the customer's address) and names
// no column of the private layer itself: the id is only a handle.
import { DataUnavailable, makeServiceReads } from '../_shared/service-rest.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { makeChangeReads } from '../_shared/change-reads.ts';
import type { Deps, ReportContextRow } from './handler.ts';
import type { StoredReport } from '../_shared/changes-since-report.ts';

export type Config = { url: string; serviceKey: string; rights: unknown; now?: () => Date };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const { base, svc, rest, authenticate, isAdmin } = makeServiceReads(cfg, fetchFn);
  const reads = makeChangeReads(rest);

  async function rpc(fn: string, args: Record<string, string>): Promise<Response> {
    let r: Response;
    try {
      r = await fetchFn(base + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: { ...svc, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch { throw new DataUnavailable('network'); }
    return r;
  }

  return {
    now: cfg.now ?? (() => new Date()),
    rights: cfg.rights,
    authenticate,
    isAdmin,

    // `changes` reads the permanent body and identity. This select names no private-context column, so the changes path cannot hold the handle.
    async report(reportId): Promise<StoredReport | null> {
      if (!UUID.test(reportId)) throw new DataUnavailable('report id');
      const rows = await rest<StoredReport>('report_snapshot?select=report_id,content_hash,report_version,generated_at,body&report_id=eq.' + reportId);
      return rows.length === 1 ? rows[0] : null;
    },

    // follow / unfollow read only the opaque handle: no body, so a long report is not downloaded to learn one id.
    async reportContext(reportId): Promise<ReportContextRow | null> {
      if (!UUID.test(reportId)) throw new DataUnavailable('report id');
      const rows = await rest<ReportContextRow>('report_snapshot?select=private_context_id&report_id=eq.' + reportId);
      return rows.length === 1 ? rows[0] : null;
    },

    ledger: reads.ledger,
    eventsWrittenSince: reads.eventsWrittenSince,
    health: reads.health,

    async openFollow(contextId, followId) {
      const r = await rpc('report_private_context_need_open', { p_context: contextId, p_kind: 'follow', p_ref: followId });
      if (r.ok) return 'OPENED';
      // a purged context is a normal outcome, not an outage: the database says so with SQLSTATE 55000
      const j = await r.json().catch(() => null);
      if (j && j.code === '55000') return 'CONTEXT_PURGED';
      throw new DataUnavailable('http ' + r.status);
    },

    async closeFollow(contextId, followId) {
      const r = await rpc('report_private_context_need_close', { p_context: contextId, p_kind: 'follow', p_ref: followId });
      if (!r.ok) throw new DataUnavailable('http ' + r.status);
    },
  };
}

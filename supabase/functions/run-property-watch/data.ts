// run-property-watch — the real reads, writes and the mail call, built from an INJECTED fetch and config.
//
// This file names no Deno global: `index.ts` passes the environment and `fetch` in, so a test can hand it a stub and look at every request it
// would make. It decides nothing. Every database call is a shared module: the watch layer (_shared/watch-reads.ts), the report's own reads
// (_shared/report-reads.ts and _shared/change-reads.ts), the saved-report standing check (_shared/evaluation-reads.ts) and the one reader of the
// private layer (_shared/private-subject.ts, `pointOf`). The mail is _shared/email-send.ts.
//
// THE TWO THINGS THIS FILE ADDS, and the care each needs:
//   * `recipientOf` asks the auth service for the agent's email address, by the agent's id, with the service key. The address is returned to the
//     handler, used to address one message, and kept nowhere. It is read at send time, so a changed address is followed.
//   * `dueCount` reads how many watches are due, for a dry run. It leases nothing.
import type { Deps } from './handler.ts';
import { NoRecipient } from './handler.ts';
import { makeServiceReads } from '../_shared/service-rest.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { makeReportReads } from '../_shared/report-reads.ts';
import { makeChangeReads } from '../_shared/change-reads.ts';
import { makeEvaluationReads, UUID } from '../_shared/evaluation-reads.ts';
import { makePrivateSubjectReads } from '../_shared/private-subject.ts';
import { makeWatchReads } from '../_shared/watch-reads.ts';
import { isMailable, sendEmail } from '../_shared/email-send.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';

export type Config = { url: string; serviceKey: string; rights: unknown; secret: string; resendKey: string; now?: () => Date };

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const { base, svc, rest, rpc } = makeServiceReads(cfg, fetchFn);
  const watches = makeWatchReads(rpc, rest);
  const reportReads = makeReportReads({ base, svc }, rest, fetchFn);
  const changeReads = makeChangeReads(rest);
  const evaluation = makeEvaluationReads(rpc);
  const subjects = makePrivateSubjectReads(rpc);

  return {
    now: cfg.now ?? (() => new Date()),
    rights: cfg.rights,
    secret: cfg.secret,
    emailConfigured: cfg.resendKey !== '',

    claim: watches.claim,
    seenOf: watches.seenOf,
    recordRun: watches.recordRun,
    recordFailure: watches.recordFailure,
    endWatch: watches.endWatch,

    async dueCount() {
      // up to 101 rows: enough to say "100 or more"; the table is read-only to this function except through the watch functions
      const rows = await rest<{ watch_id: string }>('property_watch?select=watch_id&limit=101&next_due_at=lte.' + encodeURIComponent((cfg.now ?? (() => new Date()))().toISOString()));
      return rows.length;
    },

    // standing and the stored report: the SAME function that lets a member reopen a saved report
    openReport: evaluation.openSavedReport,
    pointOf: subjects.pointOf,

    // the report's own reads, one definition
    radius: reportReads.radius,
    hydrate: reportReads.hydrate,
    ledger: changeReads.ledger,
    events: changeReads.events,
    health: changeReads.health,
    eventsWrittenSince: changeReads.eventsWrittenSince,

    // the agent's address, from the auth service, by id. Never stored, never logged.
    async recipientOf(userId) {
      if (!UUID.test(userId)) throw new DataUnavailable('user id');
      let r: Response;
      try { r = await fetchFn(base + '/auth/v1/admin/users/' + userId, { headers: svc }); } catch { throw new DataUnavailable('network'); }
      if (r.status === 404) throw new NoRecipient('no such user');
      if (!r.ok) throw new DataUnavailable('http ' + r.status);
      const u = await r.json().catch(() => null);
      const email = u && typeof u.email === 'string' ? u.email.trim() : '';
      return isMailable(email) ? email : null;
    },

    send: (message, idempotencyKey) => sendEmail(fetchFn, cfg.resendKey, message, idempotencyKey),
  };
}

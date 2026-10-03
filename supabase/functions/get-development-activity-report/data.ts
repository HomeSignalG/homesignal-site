// get-development-activity-report — the real database and service reads, built from an INJECTED fetch and config.
//
// This file names no Deno global: `index.ts` passes the environment and `fetch` in, so a test can hand it a stub and
// look at every request it would make. It contains no rule about what a report says (that is _shared/national-report.ts)
// and no rule about who may ask (that is _shared/admin-gate.ts). It only fetches, and it fails CLOSED. The shared
// fetching, the row cap, the admin allow-list read and the user lookup are _shared/service-rest.ts, used unchanged by
// every admin function (a second copy of "is this user an admin" is exactly what the one-path rule forbids).
import { GeocoderUnavailable } from './handler.ts';
import type { Deps, Geocoded } from './handler.ts';
import {
  DataUnavailable, makeServiceReads, POSTGREST_ROW_CAP, quoteIn,
} from '../_shared/service-rest.ts';
import { makeReportReads } from '../_shared/report-reads.ts';
import { makeChangeReads } from '../_shared/change-reads.ts';
import { issueEvaluationReport } from '../_shared/report-snapshot.ts';
import { makeEvaluationReads } from '../_shared/evaluation-reads.ts';
import { makePrivateSubjectReads } from '../_shared/private-subject.ts';
import { norm } from '../_shared/national-report.ts';
import type { FetchFn } from '../_shared/service-rest.ts';
import { LABEL_MAX } from './handler.ts';

export { POSTGREST_ROW_CAP, quoteIn };
export type Config = { url: string; serviceKey: string; rights: unknown; now?: () => Date };

export function makeDeps(cfg: Config, fetchFn: FetchFn): Deps {
  const { base, svc, rest, rpc, authenticate, isAdmin } = makeServiceReads(cfg, fetchFn);
  const reportReads = makeReportReads({ base, svc }, rest, fetchFn);
  // the ledger, the reportable events and the source health: one definition, shared with Changes Since Report
  const changeReads = makeChangeReads(rest);

  // the trial: one definition, shared with the trial function (_shared/evaluation-reads.ts)
  const evaluation = makeEvaluationReads(rpc);
  const subjects = makePrivateSubjectReads(rpc);

  return {
    now: cfg.now ?? (() => new Date()),
    rights: cfg.rights,

    authenticate,
    isAdmin,

    async geocode(address): Promise<Geocoded | null> {
      // the ONE geocoder: the existing geocode-address function, never a second Census client
      let r: Response;
      try {
        r = await fetchFn(base + '/functions/v1/geocode-address', {
          method: 'POST',
          headers: { ...svc, 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
        });
      } catch { throw new GeocoderUnavailable('network'); }
      if (!r.ok) throw new GeocoderUnavailable('http ' + r.status);
      const j = await r.json().catch(() => null);
      const m = j && j.match;
      if (!m) return null;
      if (typeof m.lat !== 'number' || typeof m.lng !== 'number' || !/^\d{5}$/.test(String(m.zip))) return null;
      return { matchedAddress: String(m.matchedAddress ?? address), lat: m.lat, lng: m.lng, zip: String(m.zip) };
    },

    async zipSupported(zip) {
      if (!/^\d{5}$/.test(zip)) return false;
      const rows = await rest<{ zip: string }>('canonical_zip_registry?select=zip&limit=1&zip=eq.' + zip);
      return rows.length === 1;
    },

    // the two canonical project reads: ONE definition, shared with the Watch (_shared/report-reads.ts)
    radius: reportReads.radius,
    hydrate: reportReads.hydrate,

    ...changeReads,

    // ── the trial (build step 5b): every one of these goes through a database function that owns the decision ──
    trialOf: evaluation.trialOf,

    issue(userId, idempotencyKey, intelligence, privateContext, opts) {
      return issueEvaluationReport(rpc, { userId, idempotencyKey }, intelligence, privateContext, opts);
    },

    async storedReport(reportId) {
      const rows = await rest<{ body: string }>('report_snapshot?select=body&report_id=eq.' + encodeURIComponent(reportId));
      return rows.length === 1 && typeof rows[0].body === 'string' ? rows[0].body : null;
    },

    // saved reports (build step 6): the brokerage's stored reports, read through the one membership resolver
    savedReports: evaluation.savedReports,
    openSavedReport: evaluation.openSavedReport,

    // the header a member's reports carry (build step 7): the brokerage's name and the person's own, read when a report is shown, never stored
    headerOf: evaluation.reportHeader,

    // the address and the client label a stored report was made for, while the private layer still keeps them: the ONE reader of that
    // (_shared/private-subject.ts), shared with the public share-link function, which can read the address alone
    subjectOf: (contextId) => subjects.subjectOf(contextId, LABEL_MAX),

    // A retried key returns the FIRST report (D-L6). Whether it is the same property is asked of its private context; the address read
    // stays inside this function, and only the answer leaves it.
    async contextMatches(contextId, address) {
      const { data, error } = await rpc('report_private_context_read', { p_context: contextId });
      if (error || !Array.isArray(data)) throw new DataUnavailable('private context');
      const c = data.length === 1 ? data[0] : null;
      if (!c || c.state !== 'active' || typeof c.address !== 'string') return 'unknown';
      return norm(c.address) === norm(address) ? 'match' : 'mismatch';
    },
  };
}

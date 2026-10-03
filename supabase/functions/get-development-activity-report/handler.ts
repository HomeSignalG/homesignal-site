// get-development-activity-report — request handling (Development Activity plan, Order G).
//
// The national Development Activity report as a JWT-protected server path. This file holds the LOGIC and reads no
// environment and calls no network: everything external arrives through `Deps`, so the whole request path is
// testable without Deno or a database (test/national-report-function.test.mjs).
//
// WHO MAY CALL IT is _shared/admin-gate.ts (`authorizeReportCaller`). The gateway's JWT check alone is not enough, because the public
// anon key is a validly signed token. Two callers pass:
//   an ADMIN (email in public.dashboard_admins): either view, never charged, nothing stored, exactly as before build step 5b;
//   a TRIAL MEMBER (public.evaluation_usage: an active, unexpired brokerage evaluation): the customer view only, with a page-minted
//     idempotency key. Anyone else is refused before the body is read.
//
// WHETHER A REPORT USES A FREE REPORT is _shared/credit-rule.ts (`creditDecision`, founder ruling R5), the one owner. Every answer that
// is a report or says why there is none carries its decision as `credit`. Only a trial report the rule charges is stored, and only
// through public.evaluation_report_issue (via _shared/report-snapshot.ts `issueEvaluationReport`), which stores the snapshot and the
// credit in ONE transaction. This function never calls the plain snapshot writer (`issueSnapshot`), so no report is stored without a
// credit; a structural test fails if it does. A retried key returns the first report, and only if it is about the same property (D-L6).
//
// SAVED REPORTS (build step 6). A trial member may also LIST their brokerage's stored reports (`{ action: 'list' }`) and REOPEN one by its
// permanent id (`{ action: 'open', report_id }`). Both are reads through the one membership resolver (public.evaluation_reports_of and
// public.evaluation_report_open): they reach neither the engine, the geocoder, the credit rule nor the issue function, so opening a report
// can never charge, store or recompute anything, and the text shown is the text that was stored. An id that is not one of the caller's own
// brokerage's reports is "not found", the same for another brokerage's and for an unknown one.
import {
  addDays, assemble, dayOf, parseRadius, RECENT_DAYS, REPORT_RADIUS_MI, REPORT_VERSION, validateRights,
} from '../_shared/national-report.ts';
import { creditDecision, CREDIT_RULE_VERSION } from '../_shared/credit-rule.ts';
import { authorizeReportCaller, trialSummary, MAX_BODY_BYTES, ALLOWED_ORIGINS, readBounded, reply, TOO_LARGE, corsFor } from '../_shared/admin-gate.ts';
import type { TrialState } from '../_shared/admin-gate.ts';
import { EvaluationComplete, NotEntitled } from '../_shared/report-snapshot.ts';
import { UUID } from '../_shared/evaluation-reads.ts';
import type { OpenedReport, SavedReport } from '../_shared/evaluation-reads.ts';
import type { EvaluationIssue, PrivateContext } from '../_shared/report-snapshot.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';
import type {
  LedgerProject, ProjectRow, RadiusRow, ReportableEvent, SourceHealth, View,
} from '../_shared/national-report.ts';

export { MAX_BODY_BYTES, ALLOWED_ORIGINS, DataUnavailable };
/** Rows requested from the canonical spatial read. It reports `has_more`, and a truncated area is disclosed, never hidden. */
export const RADIUS_ROW_LIMIT = 1000;

export type Geocoded = { matchedAddress: string; lat: number; lng: number; zip: string };

export type Deps = {
  now: () => Date;
  rights: unknown;
  authenticate: (token: string) => Promise<{ email: string } | null>;
  isAdmin: (email: string) => Promise<boolean>;
  geocode: (address: string) => Promise<Geocoded | null>;
  zipSupported: (zip: string) => Promise<boolean>;
  radius: (lat: number, lng: number, radiusMi: number) => Promise<RadiusRow[]>;
  hydrate: (keys: string[]) => Promise<ProjectRow[]>;
  ledger: (keys: string[]) => Promise<LedgerProject[]>;
  events: (keys: string[], sinceDay: string) => Promise<ReportableEvent[]>;
  health: (families: string[]) => Promise<SourceHealth[]>;
  // the trial (build step 5b)
  trialOf: (userId: string) => Promise<TrialState | null>;
  issue: (userId: string, idempotencyKey: string, intelligence: Record<string, unknown>, privateContext: PrivateContext | null,
    opts: { reportVersion: string; engineInputs: Record<string, unknown> }) => Promise<EvaluationIssue>;
  storedReport: (reportId: string) => Promise<string | null>;
  contextMatches: (contextId: string, address: string) => Promise<'match' | 'mismatch' | 'unknown'>;
  // saved reports (build step 6)
  savedReports: (userId: string) => Promise<SavedReport[]>;
  openSavedReport: (userId: string, reportId: string) => Promise<OpenedReport | null>;
  /** The address a stored report was made for, while the private layer still keeps it; null once it has been purged. */
  subjectOf: (contextId: string | null) => Promise<string | null>;
};

/** A random (v4) UUID the trial page mints once per report request, and repeats only when it retries that same request. */
const IDEMPOTENCY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The geocoder itself could not be reached (distinct from "no match"). */
export class GeocoderUnavailable extends Error {}

export function capability() {
  return {
    product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
    method: 'POST { address, radius_mi?, view?, label?, idempotency_key? } | { action: "list" } | { action: "open", report_id }',
    radius_mi: [REPORT_RADIUS_MI],
    recent_days: RECENT_DAYS,
    access: 'signed-in: an internal admin (dashboard_admins), or an invited trial member with an active trial (customer view only).',
    stores_reports: 'only a trial report that uses a free report (credit rule); never an admin report',
    saved_reports: 'list: the stored reports of a trial member\'s trial; open: one of them by its id, as stored, never charged',
    credit_rule: CREDIT_RULE_VERSION,
  };
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function makeHandler(deps: Deps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
    if (req.method === 'GET') return reply(req, capability());
    if (req.method !== 'POST') return reply(req, { error: 'GET for the capability, POST to generate' }, 405);

    // 1. who is asking — the one shared gate: a signed-in user, then an admin or an active trial member
    const caller = await authorizeReportCaller(req, deps);
    if (caller instanceof Response) return caller;
    const trial = caller.kind === 'trial' ? caller : null;

    // 2. what they asked — bounded, validated, and nothing unknown accepted
    const raw = await readBounded(req);
    if (raw === TOO_LARGE) return reply(req, { error: 'request_too_large' }, 413);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return reply(req, { error: 'invalid_request' }, 400);
    const b = raw as Record<string, unknown>;
    // saved reports (build step 6): a request with an action reads what is already stored, and carries nothing else
    if (b.action !== undefined) {
      if (b.action !== 'list' && b.action !== 'open') return reply(req, { error: 'invalid_request', detail: 'action' }, 400);
      const allowed = b.action === 'open' ? ['action', 'report_id'] : ['action'];
      const extra = Object.keys(b).filter((k) => !allowed.includes(k));
      if (extra.length) return reply(req, { error: 'invalid_request', detail: 'unknown field: ' + extra[0] }, 400);
      // only a trial member has a brokerage's stored reports; an admin's reports are never stored
      if (!trial) return reply(req, { error: 'forbidden' }, 403);
      try {
        if (b.action === 'list') {
          const rows = await deps.savedReports(trial.userId);
          const reports = await Promise.all(rows.map(async (r) => ({
            report_id: r.report_id, number: r.number, generated_at: r.generated_at, address: await deps.subjectOf(r.private_context_id),
          })));
          return reply(req, { status: 'OK', reports, trial: trialSummary(trial.trial) });
        }
        if (typeof b.report_id !== 'string' || !UUID.test(b.report_id)) return reply(req, { error: 'invalid_request', detail: 'report_id' }, 400);
        const opened = await deps.openSavedReport(trial.userId, b.report_id);
        if (!opened) return reply(req, { error: 'not_found' }, 404);
        let stored: { coverage?: { state?: string } } | null;
        try { stored = JSON.parse(opened.body); } catch { throw new DataUnavailable('stored report'); }
        if (!stored || typeof stored !== 'object') throw new DataUnavailable('stored report');
        return reply(req, {
          status: 'OK', coverage_state: stored.coverage?.state ?? null, report: stored,
          stored: true, reopened: true, report_id: opened.report_id, number: opened.number, generated_at: opened.generated_at,
          address: await deps.subjectOf(opened.private_context_id), charged: false, trial: trialSummary(trial.trial),
        });
      } catch (e) {
        if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);
        return reply(req, { error: 'internal' }, 500);
      }
    }
    // a trial whose 20 free reports are used can make no more: refused here, before anything is read, geocoded or charged
    if (trial && trial.complete) return reply(req, { error: 'evaluation_complete', trial: trialSummary(trial.trial) }, 403);
    const unknown = Object.keys(b).filter((k) => !['address', 'radius_mi', 'view', 'label', 'idempotency_key'].includes(k));
    if (unknown.length) return reply(req, { error: 'invalid_request', detail: 'unknown field: ' + unknown[0] }, 400);
    const address = typeof b.address === 'string' ? b.address.trim() : '';
    if (address.length < 8 || address.length > 200 || address.indexOf(' ') < 0) return reply(req, { error: 'invalid_request', detail: 'address' }, 400);
    // 100526 plan, ruling 7: a report is always 0.5 mile. `radius_mi` may be omitted or say 0.5; anything else is refused.
    const radius = b.radius_mi === undefined ? REPORT_RADIUS_MI : parseRadius(b.radius_mi);
    if (radius !== REPORT_RADIUS_MI) return reply(req, { error: 'invalid_request', detail: 'radius_mi must be ' + REPORT_RADIUS_MI }, 400);
    const view = (b.view === undefined ? 'customer' : b.view) as View;
    if (view !== 'customer' && view !== 'internal') return reply(req, { error: 'invalid_request', detail: 'view' }, 400);
    // a trial member sees exactly what a paying customer sees, and nothing an internal view would show
    if (trial && view !== 'customer') return reply(req, { error: 'forbidden' }, 403);
    // a trial report needs the page's key, so a retried request can never be charged twice; an admin report stores nothing and takes none
    let idempotencyKey: string | null = null;
    if (b.idempotency_key !== undefined || trial) {
      if (!trial) return reply(req, { error: 'invalid_request', detail: 'idempotency_key is for trial reports' }, 400);
      if (typeof b.idempotency_key !== 'string' || !IDEMPOTENCY_KEY.test(b.idempotency_key)) return reply(req, { error: 'invalid_request', detail: 'idempotency_key' }, 400);
      idempotencyKey = b.idempotency_key;
    }
    const trialInfo = trial ? { trial: trialSummary(trial.trial) } : {};
    let label: string | undefined;
    if (b.label !== undefined) {
      if (typeof b.label !== 'string' || b.label.length > 80) return reply(req, { error: 'invalid_request', detail: 'label' }, 400);
      label = b.label.trim() || undefined;
    }

    try {
      const rights = validateRights(deps.rights); // a malformed registry fails the request: never "everything is cleared"

      // 3. resolve the address, then the ZIP — before any credit-shaped decision
      const g = await deps.geocode(address);
      if (!g) return reply(req, { status: 'ADDRESS_NOT_RESOLVED', report: null, stored: false, credit: creditDecision({ status: 'ADDRESS_NOT_RESOLVED' }), ...trialInfo });
      const supported = await deps.zipSupported(g.zip);
      if (!supported) return reply(req, { status: 'OUTSIDE_COVERAGE', zip: g.zip, report: null, stored: false, credit: creditDecision({ status: 'OUTSIDE_COVERAGE' }), ...trialInfo });

      // 4. the canonical reads
      const rows = await deps.radius(g.lat, g.lng, radius);
      const keys = [...new Set(rows.map((r) => r.source_key))].sort();
      const since = addDays(dayOf(deps.now()), -RECENT_DAYS);
      const [projects, ledger, events] = await Promise.all([
        deps.hydrate(keys), deps.ledger(keys), deps.events(keys, since),
      ]);
      const families = [...new Set(projects.map((p) => p.registry_id).filter((f): f is string => !!f))].sort();
      const health = families.length ? await deps.health(families) : [];

      // 5. compose
      const out = assemble({
        now: deps.now(), view, zip_supported: true, radius_mi: radius, rights,
        subject: { address, matched_address: g.matchedAddress, lat: g.lat, lng: g.lng, zip: g.zip, ...(label ? { label } : {}) },
        rows, projects, ledger, events, health,
      });
      const storable = out.storage_blockers.length === 0;
      // whether this report uses one of the free reports: the ONE rule (founder ruling R5). An admin is never charged and nothing is stored
      // for one; a trial report that the rule does not charge ("No data ingested", a report that cannot be stored) is also stored nowhere
      const credit = creditDecision({ status: 'OK', view, activity: out.intelligence?.activity, storable });
      if (!trial || !credit.uses_report) {
        return reply(req, {
          status: 'OK',
          coverage_state: out.coverage_state,
          report: out.intelligence,
          // for this response only: measured from the subject, so never part of the permanent report
          render: out.renderOnly,
          stored: false,
          report_id: null,
          storable,
          storage_blockers: out.storage_blockers,
          credit,
          charged: false,
          ...trialInfo,
        });
      }

      // 6. a trial report that uses a free report: stored and charged in ONE database transaction (evaluation_report_issue)
      let issued: EvaluationIssue;
      try {
        issued = await deps.issue(trial.userId, idempotencyKey!, out.intelligence!, out.privateContext,
          { reportVersion: REPORT_VERSION, engineInputs: out.engineInputs! });
      } catch (e) {
        // a refusal stores nothing and charges nothing, and returns no report (a report given anyway would be a free report)
        if (e instanceof EvaluationComplete) return reply(req, { error: 'evaluation_complete' }, 403);
        if (e instanceof NotEntitled) return reply(req, { error: 'forbidden' }, 403);
        throw e;
      }
      const used = { trial: { status: issued.credit.evaluation_status, credits_used: issued.credit.credits_used, credits_remaining: issued.credit.credits_remaining } };
      if (issued.replayed) {
        // the key was already charged: the answer is the FIRST report, and only if it is about this same property (D-L6)
        const same = issued.private_context_id ? await deps.contextMatches(issued.private_context_id, address) : 'unknown';
        if (same !== 'match') return reply(req, { error: 'idempotency_key_reused' }, 409);
        const body = await deps.storedReport(issued.report_id);
        if (body === null) throw new DataUnavailable('stored report');
        const stored = JSON.parse(body);
        return reply(req, {
          status: 'OK', coverage_state: stored?.coverage?.state ?? out.coverage_state, report: stored, render: out.renderOnly,
          stored: true, report_id: issued.report_id, storable: true, storage_blockers: [], credit, charged: false, replayed: true, ...used,
        });
      }
      return reply(req, {
        status: 'OK', coverage_state: out.coverage_state, report: issued.report, render: out.renderOnly,
        stored: true, report_id: issued.report_id, storable: true, storage_blockers: [], credit, charged: true, replayed: false, ...used,
      });
    } catch (e) {
      if (e instanceof GeocoderUnavailable) return reply(req, { error: 'geocoder_unavailable' }, 502);
      if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);
      return reply(req, { error: 'internal' }, 500); // never the message: it can carry the address
    }
  };
}

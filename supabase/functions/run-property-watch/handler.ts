// run-property-watch — the daily check of every watched property (Development Activity build step 9;
// docs/development-activity-watch-2026-10-03.md). Request logic only: it reads no environment and calls no network; everything external
// arrives through `Deps`, so the whole run is testable without Deno or a network.
//
// WHO MAY CALL: the database's scheduler, and nobody else. The request must carry the project's private SIGNUP_HOOK_SECRET in
// `x-signup-secret`; it is compared in constant time, and when no secret is configured EVERY request is refused (a missing secret must never
// read as "no secret needed"). The gateway's JWT check stays on in front of this, and is not the gate.
//
// WHAT ONE RUN DOES: leases the watches that are due (public.property_watch_claim; a lease means two runs never take the same one), and for
// each, one at a time:
//   1. asks the SAME question that lets a member reopen a saved report whether the agent still has standing (public.evaluation_report_open).
//      If not, the watch ends: a trial that ended, a revoked account or a member who left stops being watched by the one rule.
//   2. asks the private layer for the property's point (_shared/private-subject.ts `pointOf`). If the layer no longer keeps it, the watch ends.
//   3. reads what is near the point with the report's own reads and assembles what a NEW report would show (_shared/report-run.ts, `assemble`).
//   4. asks the ledger what it recorded after the report for those projects, and removes what the agent was already told (_shared/property-watch.ts).
//   5. if something is new: reads the agent's email address from the auth service, sends ONE email, and only after the provider accepts it
//      records exactly what the email listed. If nothing is new, records the check.
// A check that cannot finish says why and is retried with a back-off; it never skips the day and never loses a change: a change is recorded as told
// only after the email that told it was accepted, and the email carries an idempotency key, so the retry of a run that died between the two does not
// send twice.
//
// WHAT IT NEVER DOES: write the address, the point, the label or the agent's email anywhere (not a row, not a log line, not the email, not the
// response). The point lives in memory for the length of one watch's check. The response is counts.
import { assemble, parseRadius, REPORT_RADIUS_MI, validateRights } from '../_shared/national-report.ts';
import type { LedgerProject, ProjectRow, RadiusRow, ReportableEvent, SourceHealth, WrittenEvent } from '../_shared/national-report.ts';
import { readReportInputs } from '../_shared/report-run.ts';
import { ReportUnreadable } from '../_shared/changes-since-report.ts';
import { checkWatch, lookBackInstant, selectForEmail } from '../_shared/property-watch.ts';
import type { SeenKey } from '../_shared/property-watch.ts';
import { composeWatchEmail, WATCH_FROM } from '../_shared/watch-email.ts';
import { EmailFailed, idempotencyKeyFor } from '../_shared/email-send.ts';
import type { Message } from '../_shared/email-send.ts';
import { corsFor, readBounded, reply, TOO_LARGE } from '../_shared/admin-gate.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';
import type { OpenedReport } from '../_shared/evaluation-reads.ts';
import type { Claimed, EndReason, FailureOutcome, SuccessOutcome } from '../_shared/watch-reads.ts';

export { DataUnavailable };

/** The agent has no email address the auth service will give, or one that cannot be mailed. */
export class NoRecipient extends Error {}

export type Deps = {
  now: () => Date;
  rights: unknown;
  /** The project's private SIGNUP_HOOK_SECRET. Empty when it is not configured, which refuses every request. */
  secret: string;
  /** Whether the mail provider's key is configured. The key itself never reaches this file. */
  emailConfigured: boolean;
  // the watch layer
  claim: (limit: number) => Promise<Claimed[]>;
  dueCount: () => Promise<number>;
  seenOf: (watchId: string) => Promise<SeenKey[]>;
  recordRun: (watchId: string, outcome: SuccessOutcome, told: SeenKey[]) => Promise<boolean>;
  recordFailure: (watchId: string, outcome: FailureOutcome) => Promise<boolean>;
  endWatch: (watchId: string, reason: EndReason) => Promise<boolean>;
  // standing and the stored report, then the property's point
  openReport: (userId: string, reportId: string) => Promise<OpenedReport | null>;
  pointOf: (contextId: string | null) => Promise<{ lat: number; lng: number } | null>;
  // the report's own reads, and the ledger's written-since read
  radius: (lat: number, lng: number, radiusMi: number) => Promise<RadiusRow[]>;
  hydrate: (keys: string[]) => Promise<ProjectRow[]>;
  ledger: (keys: string[]) => Promise<LedgerProject[]>;
  events: (keys: string[], sinceDay: string) => Promise<ReportableEvent[]>;
  health: (families: string[]) => Promise<SourceHealth[]>;
  eventsWrittenSince: (keys: string[], sinceIso: string) => Promise<WrittenEvent[]>;
  // the mail
  recipientOf: (userId: string) => Promise<string | null>;
  send: (message: Message, idempotencyKey: string) => Promise<void>;
};

/** Watches one run will claim when the caller does not say. A check is a few seconds; this keeps a run well inside the platform's time limit. */
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 25;
/** The run stops starting new watches after this long. A claimed watch it never reached keeps its lease and is retried when the lease lapses. */
export const RUN_BUDGET_MS = 100_000;

export const SECRET_HEADER = 'x-signup-secret';

export function capability(deps: Pick<Deps, 'secret' | 'emailConfigured'>) {
  return {
    product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
    method: 'POST { limit?, dry_run? } with the x-signup-secret header',
    access: 'system only: the scheduler, with the project\'s private secret. Not a person and not a page.',
    cadence: 'each watch once a day, on a fixed daily slot',
    secret_configured: deps.secret !== '',
    email_configured: deps.emailConfigured,
    writes: ['the outcome of each check and what an email told the agent (public.property_watch*)', 'one email per watch with something new, to the agent who watches it'],
    never: ['an address', 'a coordinate', 'a client label', 'the agent\'s email address in any row, log or response'],
  };
}

/** Constant-time equality of two strings: both are hashed to a fixed length first, so neither length nor content decides how long it takes. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

export type Tally = { claimed: number; checked: number; notified: number; ended: number; failed: number; not_reached: number };

type Outcome = 'checked' | 'notified' | 'ended' | 'failed';

/** One watch. Every failure is recorded against it; nothing here throws past the caller. */
export async function processWatch(deps: Deps, w: Claimed): Promise<Outcome> {
  let stage = 'open';
  try {
    const opened = await deps.openReport(w.user_id, w.report_id);
    if (!opened) { await deps.endWatch(w.watch_id, 'STANDING_LOST'); return 'ended'; }
    stage = 'point';
    const point = await deps.pointOf(opened.private_context_id);
    if (!point) { await deps.endWatch(w.watch_id, 'PROPERTY_NOT_KEPT'); return 'ended'; }

    stage = 'read';
    let stored: { zip?: unknown; radius_mi?: unknown };
    try { stored = JSON.parse(opened.body); } catch { throw new ReportUnreadable('body is not JSON'); }
    if (!stored || typeof stored !== 'object' || typeof stored.zip !== 'string' || !/^\d{5}$/.test(stored.zip)) throw new ReportUnreadable('no zip');
    const radiusMi = parseRadius(stored.radius_mi) ?? REPORT_RADIUS_MI;
    const rights = validateRights(deps.rights); // a malformed registry fails the check: never "everything is cleared"
    const now = deps.now();
    const inputs = await readReportInputs(deps, { lat: point.lat, lng: point.lng, radiusMi, now });
    // What a NEW report for this point would show a customer. The subject's address is a placeholder the assembly needs and nothing uses: the
    // result is read for its project list only and is never stored, returned or logged.
    const out = assemble({
      now, view: 'customer', zip_supported: true, radius_mi: radiusMi, rights,
      subject: { address: 'watched property', matched_address: null, lat: point.lat, lng: point.lng, zip: stored.zip },
      ...inputs,
    });
    const nearby = (out.intelligence?.projects ?? []) as Array<{ project_id: string }>;
    const keys = nearby.map((p) => p.project_id);
    const events = keys.length ? await deps.eventsWrittenSince(keys, lookBackInstant(opened.generated_at, now)) : [];
    const seen = await deps.seenOf(w.watch_id);
    const check = checkWatch({
      now, rights, original: { generated_at: opened.generated_at, body: opened.body }, nearby,
      ledger: inputs.ledger, events, health: inputs.health, seen,
    });

    if (check.changes.length === 0) {
      await deps.recordRun(w.watch_id, check.partial ? 'CHECKED_PARTIAL' : 'CHECKED', []);
      return 'checked';
    }

    stage = 'email';
    const selection = selectForEmail(check.changes);
    const to = await deps.recipientOf(w.user_id);
    if (!to) throw new NoRecipient('no address');
    const email = composeWatchEmail({ selection, partial: check.partial, reportNumber: opened.number, reportDate: opened.generated_at });
    await deps.send({ from: WATCH_FROM, to, ...email }, await idempotencyKeyFor(w.watch_id, selection.told));

    stage = 'record';
    // Only now, after the provider accepted the email, is it recorded as told. A failure here leaves the changes untold, and the retry's
    // email carries the same idempotency key, so the provider does not send it twice.
    await deps.recordRun(w.watch_id, 'NOTIFIED', selection.told);
    return 'notified';
  } catch (e) {
    const outcome: FailureOutcome = e instanceof EmailFailed ? 'EMAIL_FAILED' : e instanceof NoRecipient ? 'NO_RECIPIENT' : 'READ_FAILED';
    // the operator gets the class and a fixed-string reason; nothing from the report, the point or the agent
    const known = e instanceof EmailFailed || e instanceof NoRecipient || e instanceof DataUnavailable || e instanceof ReportUnreadable;
    console.error(JSON.stringify({ fn: 'run-property-watch', stage, outcome, reason: known ? (e as Error).message : (e instanceof Error ? e.name : 'unknown') }));
    try { await deps.recordFailure(w.watch_id, outcome); } catch { console.error(JSON.stringify({ fn: 'run-property-watch', stage: 'record_failure', outcome: 'LOST' })); }
    return 'failed';
  }
}

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsFor(req) });
    if (req.method === 'GET') return reply(req, capability(deps));
    if (req.method !== 'POST') return reply(req, { error: 'method_not_allowed' }, 405);

    // who is asking, settled before anything they sent is read
    if (!deps.secret) return reply(req, { error: 'not_configured' }, 503);
    const given = req.headers.get(SECRET_HEADER) ?? '';
    if (!(await sameSecret(given, deps.secret))) return reply(req, { error: 'unauthorized' }, 401);

    const body = await readBounded(req);
    if (body === TOO_LARGE) return reply(req, { error: 'too_large' }, 413);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(req, { error: 'bad_request' }, 400);
    const b = body as Record<string, unknown>;
    const extra = Object.keys(b).filter((k) => k !== 'limit' && k !== 'dry_run');
    if (extra.length) return reply(req, { error: 'bad_request', detail: 'unknown field: ' + extra[0] }, 400);
    let limit = DEFAULT_LIMIT;
    if (b.limit !== undefined) {
      if (typeof b.limit !== 'number' || !Number.isInteger(b.limit) || b.limit < 1 || b.limit > MAX_LIMIT) return reply(req, { error: 'bad_request', detail: 'limit' }, 400);
      limit = b.limit;
    }
    if (b.dry_run !== undefined && typeof b.dry_run !== 'boolean') return reply(req, { error: 'bad_request', detail: 'dry_run' }, 400);

    try {
      // A dry run proves the secret, the wiring and the configuration, and counts what is due. It leases nothing, checks nothing and sends nothing.
      if (b.dry_run === true) {
        return reply(req, { status: 'OK', dry_run: true, due: await deps.dueCount(), email_configured: deps.emailConfigured });
      }
      const started = deps.now().getTime();
      const claimed = await deps.claim(limit);
      const tally: Tally = { claimed: claimed.length, checked: 0, notified: 0, ended: 0, failed: 0, not_reached: 0 };
      for (const w of claimed) {
        if (deps.now().getTime() - started > RUN_BUDGET_MS) { tally.not_reached++; continue; }
        tally[await processWatch(deps, w)]++;
      }
      return reply(req, { status: 'OK', dry_run: false, ...tally });
    } catch (e) {
      const known = e instanceof DataUnavailable;
      console.error(JSON.stringify({ fn: 'run-property-watch', stage: 'run', status: known ? 502 : 500, reason: known ? (e as Error).message : (e instanceof Error ? e.name : 'unknown') }));
      if (known) return reply(req, { error: 'data_unavailable' }, 502);
      return reply(req, { error: 'internal' }, 500); // never the message
    }
  };
}

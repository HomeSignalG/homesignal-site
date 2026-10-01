// follow-development-report — Changes Since Report, and Follow (Development Activity plan "Watch This Property";
// docs/report-private-context-contract-2026-09-30.md §6 gate 4).
//
// THREE ACTIONS on a STORED report, addressed by its report_id (never by an address, and never by the private context's id):
//   changes   what the change ledger has learned about the projects in that report since it was issued. Reads the report's
//             PERMANENT body, the ledger, source health and the rights registry. It never reads the report's private-context id
//             (its report read does not select it), so it gives the same answer while a Follow keeps the context alive and
//             after the context has been purged.
//   follow    registers a `follow` need on the report's private context, so the context is kept (the 90-day clock stops) while
//             the property is being watched. Idempotent for the same follow_id.
//   unfollow  closes that need. When it was the last open need, the 90-day clock starts. Idempotent.
// follow and unfollow read only the context handle (a body-less read); changes reads only the body. Neither action sees the other's column.
//
// WHO MAY CALL IT is _shared/admin-gate.ts, the same gate as the national report: a signed-in user in public.dashboard_admins.
// Orders J and K (secure delivery, accounts) replace the allow-list with the account's entitlement, in that one place.
//
// WHAT A FOLLOW IS, TODAY: an open `follow` need row, opaque and owner-less, because the account system that would own it
// (who follows, notification preferences, billing) is Order K. It is exactly what the contract defines (§4: "a property Follow
// … registers its own"). The `follow_id` is REQUIRED and chosen by the CALLER (a random UUID it keeps): this function never mints
// one. A server-minted id returned only in a response is lost with a lost response, leaving an open need nobody can close, which
// holds the private context open past the contract's 90 days; a caller-held id makes a retry the same request. The id is not
// derived from the address, the report, the user or anything private, and the audit log records the need's KIND, never its reference.
//
// This file holds the LOGIC and reads no environment and calls no network: everything external arrives through `Deps`.
import { authorizeAdmin, corsFor, readBounded, reply, TOO_LARGE } from '../_shared/admin-gate.ts';
import { changesSinceReport, EventRowUnreadable, parseStoredReport, ReportUnreadable, writtenSinceInstant } from '../_shared/changes-since-report.ts';
import type { StoredReport, WrittenEvent } from '../_shared/changes-since-report.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';
import { validateRights } from '../_shared/national-report.ts';
import type { LedgerProject, SourceHealth, View } from '../_shared/national-report.ts';

export { DataUnavailable };

/** What follow / unfollow read of a stored report: only the opaque handle to its private context. It is never put in a response. */
export type ReportContextRow = { private_context_id: string | null };

export type Deps = {
  now: () => Date;
  rights: unknown;
  authenticate: (token: string) => Promise<{ email: string } | null>;
  isAdmin: (email: string) => Promise<boolean>;
  /** The permanent body and identity of a stored report. Selects no private-context column. For `changes`. */
  report: (reportId: string) => Promise<StoredReport | null>;
  /** The private-context handle of a stored report, and nothing else (no body). For `follow` and `unfollow`. */
  reportContext: (reportId: string) => Promise<ReportContextRow | null>;
  ledger: (keys: string[]) => Promise<LedgerProject[]>;
  eventsWrittenSince: (keys: string[], sinceIso: string) => Promise<WrittenEvent[]>;
  health: (families: string[]) => Promise<SourceHealth[]>;
  /** 'CONTEXT_PURGED' when the database refuses because the context was purged (it can never be reopened). */
  openFollow: (contextId: string, followId: string) => Promise<'OPENED' | 'CONTEXT_PURGED'>;
  closeFollow: (contextId: string, followId: string) => Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * A follow_id is stored for good (it becomes the need's `ref`, which a purge does not blank), so it must carry no information about the
 * customer or the property. Only a version-4 (random) UUID is accepted: a name-based id (version 3 or 5, a hash of a string) or a
 * time-based one (1, 2, 6, 7, 8) is refused. The shape cannot PROVE randomness (a caller can still choose to build a v4-looking id from
 * an address hash), so the caller's contract in docs/development-activity-follow-changes-2026-10-01.md §5 is that it generates the id
 * randomly and keeps it; what this refuses is the ordinary way of deriving one by accident.
 */
const FOLLOW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = ['changes', 'follow', 'unfollow'];
const FIELDS: Record<string, string[]> = {
  changes: ['action', 'report_id', 'view'],
  follow: ['action', 'report_id', 'follow_id'],
  unfollow: ['action', 'report_id', 'follow_id'],
};

export function capability() {
  return {
    product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
    method: 'POST { action: "changes", report_id, view? } | { action: "follow" | "unfollow", report_id, follow_id }',
    access: 'signed-in internal user only (JWT + dashboard_admins). Not a customer surface.',
    stores_reports: false,
    reads_private_values: false,
    uses_private_context_handle: true, // follow / unfollow pass the context's opaque id to two database functions; the id is never returned
    writes: ['a follow need on a report\'s private context (follow, unfollow)'],
  };
}

export function makeHandler(deps: Deps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
    if (req.method === 'GET') return reply(req, capability());
    if (req.method !== 'POST') return reply(req, { error: 'GET for the capability, POST to ask' }, 405);

    // 1. who is asking — the one shared gate, before anything the caller typed is looked at
    const denied = await authorizeAdmin(req, deps);
    if (denied) return denied;

    // 2. what they asked — bounded, validated, and nothing unknown accepted
    const raw = await readBounded(req);
    if (raw === TOO_LARGE) return reply(req, { error: 'request_too_large' }, 413);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return reply(req, { error: 'invalid_request' }, 400);
    const b = raw as Record<string, unknown>;
    const action = typeof b.action === 'string' ? b.action : '';
    if (!ACTIONS.includes(action)) return reply(req, { error: 'invalid_request', detail: 'action' }, 400);
    const unknown = Object.keys(b).filter((k) => !FIELDS[action].includes(k));
    if (unknown.length) return reply(req, { error: 'invalid_request', detail: 'unknown field: ' + unknown[0] }, 400);
    const reportId = typeof b.report_id === 'string' && UUID.test(b.report_id) ? b.report_id.toLowerCase() : null;
    if (!reportId) return reply(req, { error: 'invalid_request', detail: 'report_id' }, 400);
    let followId: string | null = null;
    if (b.follow_id !== undefined) {
      if (typeof b.follow_id !== 'string' || !FOLLOW_ID.test(b.follow_id)) return reply(req, { error: 'invalid_request', detail: 'follow_id' }, 400);
      followId = b.follow_id.toLowerCase();
    }
    // the caller holds the id: follow and unfollow both require it, and the function never mints one
    if ((action === 'follow' || action === 'unfollow') && !followId) return reply(req, { error: 'invalid_request', detail: 'follow_id' }, 400);
    const view = (b.view === undefined ? 'customer' : b.view) as View;
    if (view !== 'customer' && view !== 'internal') return reply(req, { error: 'invalid_request', detail: 'view' }, 400);

    try {
      // ── follow / unfollow: a need on the private context. The id of the context never leaves this function, and the body is never read.
      if (action === 'follow' || action === 'unfollow') {
        const ctx = await deps.reportContext(reportId);
        if (!ctx) return reply(req, { error: 'report_not_found' }, 404);
        if (!ctx.private_context_id) return reply(req, { status: 'NO_PRIVATE_CONTEXT', report_id: reportId });
        if (action === 'follow') {
          const opened = await deps.openFollow(ctx.private_context_id, followId!);
          if (opened === 'CONTEXT_PURGED') return reply(req, { status: 'CONTEXT_PURGED', report_id: reportId });
          return reply(req, { status: 'FOLLOWING', report_id: reportId, follow_id: followId });
        }
        await deps.closeFollow(ctx.private_context_id, followId!);
        // The database's close function returns nothing, so this function cannot know whether a need was open: a follow_id that was never
        // opened, or belongs to another report, changes nothing and gets this same answer. It says "requested", not "done".
        return reply(req, { status: 'UNFOLLOW_REQUESTED', report_id: reportId, follow_id: followId });
      }

      // ── changes: the permanent body, the ledger, source health, the rights. Never the private context.
      // `now` is taken BEFORE the reads, so the answer's `through` and its upper bound are the instant the question was asked, not an
      // instant after reads that may have taken seconds. It is this function's clock, not the database's snapshot.
      const asked = deps.now();
      const rights = validateRights(deps.rights); // a malformed registry fails the request: never "everything is cleared"
      const stored = await deps.report(reportId);
      if (!stored) return reply(req, { error: 'report_not_found' }, 404);
      const parsed = parseStoredReport(stored);
      const keys = parsed.projects.map((p) => p.project_id);
      const families = [...new Set(parsed.projects.map((p) => p.source_family).filter((f): f is string => !!f))].sort();
      const [ledger, events, health] = await Promise.all([
        keys.length ? deps.ledger(keys) : Promise.resolve([] as LedgerProject[]),
        keys.length ? deps.eventsWrittenSince(keys, writtenSinceInstant(stored.generated_at)) : Promise.resolve([] as WrittenEvent[]),
        families.length ? deps.health(families) : Promise.resolve([] as SourceHealth[]),
      ]);
      const result = changesSinceReport({ now: asked, view, rights, ledger, events, health, report: stored });
      return reply(req, { status: 'OK', result });
    } catch (e) {
      // The caller gets a bare status; the operator gets the REASON, so a 502 can be told apart (row cap, http 500, network, unreadable
      // event). Only the three classes below carry a fixed-string message (none holds a value from the report, the ledger or the caller);
      // any other error logs its class name and nothing else. The action is one of three validated words.
      const known = e instanceof ReportUnreadable || e instanceof DataUnavailable || e instanceof EventRowUnreadable;
      const status = e instanceof ReportUnreadable ? 422 : known ? 502 : 500;
      console.error(JSON.stringify({ fn: 'follow-development-report', action, status, reason: known ? (e as Error).message : (e instanceof Error ? e.name : 'unknown') }));
      if (e instanceof ReportUnreadable) return reply(req, { error: 'report_unreadable' }, 422);
      if (known) return reply(req, { error: 'data_unavailable' }, 502);
      return reply(req, { error: 'internal' }, 500); // never the message
    }
  };
}

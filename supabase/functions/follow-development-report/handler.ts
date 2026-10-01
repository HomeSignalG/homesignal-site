// follow-development-report — Changes Since Report, and Follow (Development Activity plan "Watch This Property";
// docs/report-private-context-contract-2026-09-30.md §6 gate 4).
//
// THREE ACTIONS on a STORED report, addressed by its report_id (never by an address, and never by the private context's id):
//   changes   what the change ledger has learned about the projects in that report since it was issued. Reads the report's
//             PERMANENT body, the ledger and the rights registry. It has no handle on the private context, so it gives the
//             same answer while a Follow keeps the context alive and after the context has been purged.
//   follow    registers a `follow` need on the report's private context, so the context is kept (the 90-day clock stops) while
//             the property is being watched. Idempotent for the same follow_id.
//   unfollow  closes that need. When it was the last open need, the 90-day clock starts. Idempotent.
//
// WHO MAY CALL IT is _shared/admin-gate.ts, the same gate as the national report: a signed-in user in public.dashboard_admins.
// Orders J and K (secure delivery, accounts) replace the allow-list with the account's entitlement, in that one place.
//
// WHAT A FOLLOW IS, TODAY: an open `follow` need row, opaque and owner-less, because the account system that would own it
// (who follows, notification preferences, billing) is Order K. It is exactly what the contract defines (§4: "a property Follow
// … registers its own"). The id this function mints is a random UUID: it is not derived from the address, the report, the user
// or anything private, and the audit log records the need's KIND, never its reference.
//
// This file holds the LOGIC and reads no environment and calls no network: everything external arrives through `Deps`.
import { authorizeAdmin, corsFor, readBounded, reply, TOO_LARGE } from '../_shared/admin-gate.ts';
import { changesSinceReport, parseStoredReport, ReportUnreadable, writtenSinceInstant } from '../_shared/changes-since-report.ts';
import type { StoredReport, WrittenEvent } from '../_shared/changes-since-report.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';
import { validateRights } from '../_shared/national-report.ts';
import type { LedgerProject, SourceHealth, View } from '../_shared/national-report.ts';

export { DataUnavailable };

/** A stored report's row (the snapshot table). `private_context_id` is an internal handle: it is never put in a response. */
export type StoredReportRow = StoredReport & { private_context_id: string | null };

export type Deps = {
  now: () => Date;
  rights: unknown;
  newId: () => string;
  authenticate: (token: string) => Promise<{ email: string } | null>;
  isAdmin: (email: string) => Promise<boolean>;
  report: (reportId: string) => Promise<StoredReportRow | null>;
  ledger: (keys: string[]) => Promise<LedgerProject[]>;
  eventsWrittenSince: (keys: string[], sinceIso: string) => Promise<WrittenEvent[]>;
  health: (families: string[]) => Promise<SourceHealth[]>;
  /** 'CONTEXT_PURGED' when the database refuses because the context was purged (it can never be reopened). */
  openFollow: (contextId: string, followId: string) => Promise<'OPENED' | 'CONTEXT_PURGED'>;
  closeFollow: (contextId: string, followId: string) => Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = ['changes', 'follow', 'unfollow'];
const FIELDS: Record<string, string[]> = {
  changes: ['action', 'report_id', 'view'],
  follow: ['action', 'report_id', 'follow_id'],
  unfollow: ['action', 'report_id', 'follow_id'],
};

export function capability() {
  return {
    product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
    method: 'POST { action: "changes" | "follow" | "unfollow", report_id, view?, follow_id? }',
    access: 'signed-in internal user only (JWT + dashboard_admins). Not a customer surface.',
    stores_reports: false,
    reads_private_context: false,
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
      if (typeof b.follow_id !== 'string' || !UUID.test(b.follow_id)) return reply(req, { error: 'invalid_request', detail: 'follow_id' }, 400);
      followId = b.follow_id.toLowerCase();
    }
    if (action === 'unfollow' && !followId) return reply(req, { error: 'invalid_request', detail: 'follow_id' }, 400);
    const view = (b.view === undefined ? 'customer' : b.view) as View;
    if (view !== 'customer' && view !== 'internal') return reply(req, { error: 'invalid_request', detail: 'view' }, 400);

    try {
      const stored = await deps.report(reportId);
      if (!stored) return reply(req, { error: 'report_not_found' }, 404);

      // ── follow / unfollow: a need on the private context. The id of the context never leaves this function.
      if (action === 'follow' || action === 'unfollow') {
        if (!stored.private_context_id) return reply(req, { status: 'NO_PRIVATE_CONTEXT', report_id: reportId });
        if (action === 'follow') {
          const id = followId ?? deps.newId();
          const opened = await deps.openFollow(stored.private_context_id, id);
          if (opened === 'CONTEXT_PURGED') return reply(req, { status: 'CONTEXT_PURGED', report_id: reportId });
          return reply(req, { status: 'FOLLOWING', report_id: reportId, follow_id: id });
        }
        await deps.closeFollow(stored.private_context_id, followId!);
        return reply(req, { status: 'UNFOLLOWED', report_id: reportId, follow_id: followId });
      }

      // ── changes: the permanent body, the ledger, the rights. Never the private context.
      const rights = validateRights(deps.rights); // a malformed registry fails the request: never "everything is cleared"
      const parsed = parseStoredReport(stored);
      const keys = parsed.projects.map((p) => p.project_id);
      const families = [...new Set(parsed.projects.map((p) => p.source_family).filter((f): f is string => !!f))].sort();
      const [ledger, events, health] = await Promise.all([
        keys.length ? deps.ledger(keys) : Promise.resolve([] as LedgerProject[]),
        keys.length ? deps.eventsWrittenSince(keys, writtenSinceInstant(stored.generated_at)) : Promise.resolve([] as WrittenEvent[]),
        families.length ? deps.health(families) : Promise.resolve([] as SourceHealth[]),
      ]);
      const result = changesSinceReport({
        now: deps.now(), view, rights, ledger, events, health,
        report: { report_id: stored.report_id, content_hash: stored.content_hash, report_version: stored.report_version, generated_at: stored.generated_at, body: stored.body },
      });
      return reply(req, { status: 'OK', result });
    } catch (e) {
      if (e instanceof ReportUnreadable) return reply(req, { error: 'report_unreadable' }, 422);
      if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);
      return reply(req, { error: 'internal' }, 500); // never the message
    }
  };
}

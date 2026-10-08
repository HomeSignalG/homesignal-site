// manage-property-watch — a brokerage's agent starts, lists and stops watching the property of one of its own stored reports
// (Development Activity build step 9; docs/development-activity-build-steps-100526.md).
//
// THREE ACTIONS:
//   start   { action: "start", report_id }   watch the property of one of the caller's own brokerage's stored reports. Idempotent. The first
//                                            check runs at the daily job's next wake (every ten minutes), then once a day on that slot (founder: "Daily check").
//   list    { action: "list" }               the caller's OWN watches, newest first: the report, its address while the private layer keeps it,
//                                            when it was last checked and how, and when it is next due.
//   stop    { action: "stop", watch_id }     stop one of the caller's own watches.
//
// WHO MAY CALL. Any signed-in person is let in, and being signed in grants nothing: the database answers only for that person's own brokerage
// (public.brokerage_membership_of, the one membership resolver). `start` needs the standing that lets a member reopen a saved report; `list` and
// `stop` need ownership only, so a watch can always be taken back even after a trial has ended.
//
// WHAT IT NEVER RETURNS: a private-context id, a coordinate, a label, another agent's watch, an email address. The address of the agent's own
// report is shown while the private layer keeps it (the same window the saved-report list uses) and is null once it has been purged.
//
// This file holds the LOGIC and reads no environment and calls no network: everything external arrives through `Deps`.
import { authorizeSignedIn, corsFor, readBounded, reply, TOO_LARGE } from '../_shared/admin-gate.ts';
import type { AdminGateDeps } from '../_shared/admin-gate.ts';
import { UUID } from '../_shared/evaluation-reads.ts';
import { PropertyNotKept, WatchLimitReached, WatchNotFound } from '../_shared/watch-reads.ts';
import type { StartedWatch, WatchRow } from '../_shared/watch-reads.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';

export { DataUnavailable };

/** The longest client label the private layer's display window will print (the same bound the report function uses; this function never shows it). */
export const LABEL_MAX = 80;

export type Deps = AdminGateDeps & {
  startWatch: (userId: string, reportId: string) => Promise<StartedWatch>;
  watchesOf: (userId: string) => Promise<WatchRow[]>;
  stopWatch: (userId: string, watchId: string) => Promise<void>;
  /** The address a stored report was made for, while the private layer keeps it; null once purged. */
  addressOf: (contextId: string | null) => Promise<string | null>;
};

export const CAPABILITY = {
  product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
  method: 'POST { action: "start", report_id } | { action: "list" } | { action: "stop", watch_id }',
  access: 'signed-in user; acts only on their own brokerage\'s stored reports and their own watches. start needs a brokerage with standing; list and stop need ownership only',
  cadence: 'once a day',
  writes: ['a watch and its follow need on the report\'s private context, when a member starts one', 'the removal of a watch and the closing of its need, when a member stops it'],
};

/** The fields each action may carry. Anything else is a malformed request. */
const FIELDS: Record<string, string[]> = { start: ['action', 'report_id'], list: ['action'], stop: ['action', 'watch_id'] };

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsFor(req) });
    if (req.method === 'GET') return reply(req, CAPABILITY);
    if (req.method !== 'POST') return reply(req, { error: 'method_not_allowed' }, 405);

    // who is asking, settled before anything they sent is read
    const who = await authorizeSignedIn(req, deps);
    if (who instanceof Response) return who;

    const body = await readBounded(req);
    if (body === TOO_LARGE) return reply(req, { error: 'too_large' }, 413);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(req, { error: 'bad_request' }, 400);
    const b = body as Record<string, unknown>;
    const action = typeof b.action === 'string' && Object.prototype.hasOwnProperty.call(FIELDS, b.action) ? b.action : null;
    if (!action) return reply(req, { error: 'bad_request', detail: 'action' }, 400);
    const extra = Object.keys(b).filter((k) => !FIELDS[action].includes(k));
    if (extra.length) return reply(req, { error: 'bad_request', detail: 'unknown field: ' + extra[0] }, 400);
    const idField = action === 'stop' ? 'watch_id' : action === 'start' ? 'report_id' : null;
    let id = '';
    if (idField) {
      const v = b[idField];
      if (typeof v !== 'string' || !UUID.test(v)) return reply(req, { error: 'bad_request', detail: idField }, 400);
      id = v.toLowerCase();
    }

    try {
      if (action === 'start') {
        const w = await deps.startWatch(who.userId, id);
        return reply(req, { status: 'OK', watch_id: w.watch_id, started: w.started, created_at: w.created_at });
      }
      if (action === 'stop') {
        await deps.stopWatch(who.userId, id);
        return reply(req, { status: 'OK', stopped: true });
      }
      const rows = await deps.watchesOf(who.userId);
      const watches = await Promise.all(rows.map(async (r) => ({
        watch_id: r.watch_id, report_id: r.report_id, number: r.number, generated_at: r.generated_at,
        address: await deps.addressOf(r.private_context_id),
        created_at: r.created_at, last_run_at: r.last_run_at, last_outcome: r.last_outcome, next_due_at: r.next_due_at,
      })));
      return reply(req, { status: 'OK', watches });
    } catch (e) {
      if (e instanceof WatchNotFound) return reply(req, { error: 'not_found' }, 404);
      if (e instanceof WatchLimitReached) return reply(req, { error: 'watch_limit_reached' }, 409);
      if (e instanceof PropertyNotKept) return reply(req, { error: 'property_not_kept' }, 409);
      if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);
      return reply(req, { error: 'internal' }, 500);
    }
  };
}

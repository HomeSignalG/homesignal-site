// manage-shared-report — a brokerage's agent makes, lists and withdraws the private client links to its own stored reports
// (Development Activity build step 8; docs/development-activity-build-steps-100526.md).
//
// THREE ACTIONS, each for one stored report or one link of the caller's own brokerage:
//   create   { action: "create", report_id }   make a link to the report. It lasts 6 months (founder, 2026-10-03). The link is in the answer,
//                                              ONCE: its token is stored nowhere and cannot be shown again. A lost link is revoked and replaced.
//   list     { action: "list", report_id }     the report's links, newest first, each with the database's own status (ACTIVE, EXPIRED, REVOKED).
//   revoke   { action: "revoke", share_id }    withdraw a link at once. Revoking one that is already revoked is a quiet no-op.
//
// WHO MAY CALL. Any signed-in person is let in, and being signed in grants nothing: the database answers only for that person's own
// brokerage (public.brokerage_membership_of, the one membership resolver). It is NOT the report function's gate, on purpose: that gate
// refuses a brokerage whose trial has ended, and a client link must never become impossible to take back because a trial ran out. So `list`
// and `revoke` need only ownership; `create` also needs the standing that lets a member reopen a saved report, which the database checks.
//
// WHAT IT NEVER RETURNS: a token or its hash after the one answer that carries the link, an evaluation, a brokerage id, a user, another
// brokerage's anything. A report or link that is not the caller's brokerage's is `not_found`, the same as one that does not exist.
//
// This file holds the LOGIC and reads no environment and calls no network: everything external arrives through `Deps`.
import { authorizeSignedIn, corsFor, readBounded, reply, TOO_LARGE } from '../_shared/admin-gate.ts';
import type { AdminGateDeps } from '../_shared/admin-gate.ts';
import { UUID } from '../_shared/evaluation-reads.ts';
import { ShareLimitReached, ShareNotFound } from '../_shared/share-reads.ts';
import type { CreatedShare, ShareRow } from '../_shared/share-reads.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';

export { DataUnavailable };

export type Deps = AdminGateDeps & {
  createShare: (userId: string, reportId: string) => Promise<CreatedShare>;
  listShares: (userId: string, reportId: string) => Promise<ShareRow[]>;
  revokeShare: (userId: string, shareId: string) => Promise<boolean>;
};

export const CAPABILITY = {
  product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
  method: 'POST { action: "create", report_id } | { action: "list", report_id } | { action: "revoke", share_id }',
  access: 'signed-in user; acts only on their own brokerage\'s stored reports and their links. create needs a brokerage with standing; list and revoke need ownership only',
  link_lifetime: '6 months',
  writes: ['a share link, when a member makes one', 'a link\'s revocation, when a member withdraws it'],
};

/** The fields each action may carry. Anything else is a malformed request. */
const FIELDS: Record<string, string[]> = { create: ['action', 'report_id'], list: ['action', 'report_id'], revoke: ['action', 'share_id'] };

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
    const idField = action === 'revoke' ? 'share_id' : 'report_id';
    const id = b[idField];
    if (typeof id !== 'string' || !UUID.test(id)) return reply(req, { error: 'bad_request', detail: idField }, 400);

    try {
      if (action === 'create') {
        const made = await deps.createShare(who.userId, id);
        return reply(req, { status: 'OK', share_id: made.share_id, expires_at: made.expires_at, link: made.link });
      }
      if (action === 'list') {
        return reply(req, { status: 'OK', shares: await deps.listShares(who.userId, id) });
      }
      return reply(req, { status: 'OK', revoked: await deps.revokeShare(who.userId, id) });
    } catch (e) {
      if (e instanceof ShareNotFound) return reply(req, { error: 'not_found' }, 404);
      if (e instanceof ShareLimitReached) return reply(req, { error: 'share_limit_reached' }, 409);
      if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);
      return reply(req, { error: 'internal' }, 500);
    }
  };
}

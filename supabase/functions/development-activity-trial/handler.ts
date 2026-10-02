// development-activity-trial — joining a brokerage's 20-report trial, and reading one's own trial (Development Activity build
// step 5c; docs/development-activity-build-steps-100526.md).
//
// TWO ACTIONS, both for the signed-in person only:
//   status   whether this person can make reports here, and how many free reports their brokerage's trial has left.
//   redeem   join a trial with an invite token (the one in the invite link). The same person using their own invite again
//            is told so and nothing changes.
//
// WHO DECIDES WHAT. The database decides membership, the count and whether an invite may be used (docs/evaluation-entitlement.sql,
// Order L1), through _shared/evaluation-reads.ts. Whether a trial may make reports now is _shared/admin-gate.ts trialStanding, the
// same reading the report function's gate uses. Making and charging reports is get-development-activity-report, never this function.
//
// WHAT IT NEVER RETURNS: an evaluation id, a brokerage id, an invite id, or anything about another person.
//
// This file holds the LOGIC and reads no environment and calls no network: everything external arrives through `Deps`.
import { authorizeSignedIn, corsFor, readBounded, reply, TOO_LARGE, trialStanding, trialSummary } from '../_shared/admin-gate.ts';
import type { AdminGateDeps, TrialState } from '../_shared/admin-gate.ts';
import { AlreadyAMember, InviteUnusable, SeatLimitReached } from '../_shared/evaluation-reads.ts';
import type { Redeemed } from '../_shared/evaluation-reads.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';

export { DataUnavailable };

export type Deps = AdminGateDeps & {
  trialOf: (userId: string) => Promise<TrialState | null>;
  redeemInvite: (token: string, userId: string) => Promise<Redeemed>;
};

export const CAPABILITY = {
  product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
  method: 'POST { action: "status" } | { action: "redeem", token }',
  access: 'signed-in user; answers only about their own trial',
  stores_reports: false,
  writes: ['a brokerage membership, when the signed-in person redeems an invite'],
};

/**
 * How the report function will treat this person, and their trial in plain counts. `access` is 'admin' (served as an admin: never
 * charged), 'trial' (a member of an active trial), 'complete' (their trial's free reports are used), 'ended' (their trial was revoked
 * or expired) or 'none' (no trial). Never an id.
 */
function standingOf(admin: boolean, trial: TrialState | null) {
  const standing = trial ? trialStanding(trial) : null;
  const access = admin ? 'admin' : standing === null ? 'none' : standing === 'active' ? 'trial' : standing;
  return { access, trial: trial ? trialSummary(trial) : null };
}

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
    const { action, token } = body as Record<string, unknown>;

    try {
      if (action === 'status') {
        return reply(req, { status: 'OK', ...standingOf(who.admin, await deps.trialOf(who.userId)) });
      }
      if (action === 'redeem') {
        if (typeof token !== 'string' || token.length > 100) return reply(req, { error: 'invite_unusable' }, 400);
        let joined: Redeemed;
        try {
          joined = await deps.redeemInvite(token, who.userId);
        } catch (e) {
          if (e instanceof InviteUnusable) return reply(req, { error: 'invite_unusable' }, 400);
          if (e instanceof AlreadyAMember) return reply(req, { error: 'already_a_member' }, 409);
          if (e instanceof SeatLimitReached) return reply(req, { error: 'seat_limit_reached' }, 409);
          throw e;
        }
        return reply(req, { status: 'OK', role: joined.role, replayed: joined.replayed, ...standingOf(who.admin, await deps.trialOf(who.userId)) });
      }
      return reply(req, { error: 'bad_request' }, 400);
    } catch (e) {
      if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);
      return reply(req, { error: 'internal' }, 500);
    }
  };
}

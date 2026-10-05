// development-activity-trial — joining a brokerage's 10-report trial, reading one's own trial (Development Activity build step 5c),
// creating a trial (step 5d) and an owner inviting agents (step 5e; docs/development-activity-build-steps-100526.md).
//
// FOUR ACTIONS:
//   status   whether this person can make reports here, how many free reports their brokerage's trial has left, and their role.
//   redeem   join a trial with an invite token (the one in the invite link). The same person using their own invite again
//            is told so and nothing changes.
//   create   ADMIN ONLY (dashboard_admins): create a brokerage's trial and its owner invite. The invite link is in the answer,
//            once; nothing else on HomeSignal can show it again.
//   invite   a trial's OWNER makes an invite link for one agent, while the trial is active. The link is in the answer, once.
//
// WHO DECIDES WHAT. The database decides membership and role, the count, whether an invite may be used and who may make one
// (docs/evaluation-entitlement.sql, Order L1), through _shared/evaluation-reads.ts. Whether a trial may make reports now is
// _shared/admin-gate.ts trialStanding, the same reading the report function's gate uses; an invite is offered only while it reads
// active. Making and charging reports is get-development-activity-report, never this function.
//
// WHAT IT NEVER RETURNS: an evaluation id, a brokerage id, an invite id, or anything about another person. The secrets it returns
// are invite links, each once, to the person who just made it: an admin creating a trial, or an owner inviting an agent.
//
// This file holds the LOGIC and reads no environment and calls no network: everything external arrives through `Deps`.
import { authorizeSignedIn, corsFor, readBounded, reply, TOO_LARGE, trialStanding, trialSummary } from '../_shared/admin-gate.ts';
import type { AdminGateDeps, TrialState } from '../_shared/admin-gate.ts';
import { AlreadyAMember, InviteUnusable, NotEntitled, SeatLimitReached, TrialRejected } from '../_shared/evaluation-reads.ts';
import type { CreatedInvite, CreatedTrial, NewTrial, Redeemed, Role } from '../_shared/evaluation-reads.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';

export { DataUnavailable };

export type Deps = AdminGateDeps & {
  trialOf: (userId: string) => Promise<TrialState | null>;
  redeemInvite: (token: string, userId: string) => Promise<Redeemed>;
  createTrial: (t: NewTrial) => Promise<CreatedTrial>;
  roleOf: (userId: string) => Promise<Role | null>;
  inviteAgent: (userId: string) => Promise<CreatedInvite>;
  now: () => Date;
};

export const CAPABILITY = {
  product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
  method: 'POST { action: "status" } | { action: "redeem", token } | { action: "create", brokerage_name, seat_limit?, trial_days? } | { action: "invite" }',
  access: 'signed-in user; answers only about their own trial. create: an internal admin (dashboard_admins) only. invite: an owner of an active trial only',
  stores_reports: false,
  writes: ['a brokerage membership, when the signed-in person redeems an invite',
    'a brokerage account, its trial and its owner invite, when an admin creates a trial',
    'an agent invite, when a trial owner invites an agent'],
};

/** The longest brokerage name accepted, and the bounds of the two optional numbers. Input checks only: none is a product limit. */
export const NAME_MAX = 120, SEATS_MAX = 1000, DAYS_MAX = 365;
const DAY_MS = 86_400_000;

/**
 * An admin's request to create a trial, checked before the database is asked. Returns the trial to create, or the name of the field
 * that is wrong. A blank seat limit is "no limit" (D-L2) and a blank length is "no end date" (D-L3): this function invents neither.
 * The owner invite lives the database's default 14 days (D-L4); the request cannot change it.
 */
export function trialRequest(body: Record<string, unknown>, now: Date): NewTrial | 'brokerage_name' | 'seat_limit' | 'trial_days' {
  const name = typeof body.brokerage_name === 'string' ? body.brokerage_name.trim() : '';
  if (!name || name.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) return 'brokerage_name';
  const seats = body.seat_limit, days = body.trial_days;
  if (seats !== undefined && seats !== null && !(Number.isInteger(seats) && (seats as number) >= 0 && (seats as number) <= SEATS_MAX)) return 'seat_limit';
  if (days !== undefined && days !== null && !(Number.isInteger(days) && (days as number) >= 1 && (days as number) <= DAYS_MAX)) return 'trial_days';
  return {
    brokerageName: name,
    seatLimit: seats === undefined || seats === null ? null : seats as number,
    expiresAt: days === undefined || days === null ? null : new Date(now.getTime() + (days as number) * DAY_MS).toISOString(),
  };
}

/**
 * How the report function will treat this person, and their trial in plain counts. `access` is 'admin' (served as an admin: never
 * charged), 'trial' (a member of an active trial), 'complete' (their trial's free reports are used), 'ended' (their trial was revoked
 * or expired) or 'none' (no trial). `role` is 'owner', 'agent' or null (no trial), from the one membership resolver. Never an id.
 */
async function standingOf(deps: Deps, admin: boolean, userId: string) {
  const trial = await deps.trialOf(userId);
  const standing = trial ? trialStanding(trial) : null;
  const access = admin ? 'admin' : standing === null ? 'none' : standing === 'active' ? 'trial' : standing;
  return { access, trial: trial ? trialSummary(trial) : null, role: trial ? await deps.roleOf(userId) : null };
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
        return reply(req, { status: 'OK', ...await standingOf(deps, who.admin, who.userId) });
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
        return reply(req, { status: 'OK', replayed: joined.replayed, ...await standingOf(deps, who.admin, who.userId) });
      }
      if (action === 'create') {
        // an admin's act: refused for anyone else before a single field is looked at
        if (!who.admin) return reply(req, { error: 'forbidden' }, 403);
        const wanted = trialRequest(body as Record<string, unknown>, deps.now());
        if (typeof wanted === 'string') return reply(req, { error: 'bad_request', detail: wanted }, 400);
        let made: CreatedTrial;
        try {
          made = await deps.createTrial(wanted);
        } catch (e) {
          if (e instanceof TrialRejected) return reply(req, { error: 'rejected' }, 422);
          throw e;
        }
        return reply(req, {
          status: 'OK', brokerage_name: wanted.brokerageName, seat_limit: wanted.seatLimit, trial_ends_at: wanted.expiresAt,
          invite_link: made.invite_link, invite_expires_at: made.invite_expires_at,
        });
      }
      if (action === 'invite') {
        // an owner's act, for an ACTIVE trial: an agent who joins a used-up or ended trial could make no report. Whether this person
        // is an owner of it is the database's check, made when the invite is made (inviteAgent); it is not re-derived here.
        const trial = await deps.trialOf(who.userId);
        if (!trial) return reply(req, { error: 'forbidden' }, 403);
        if (trialStanding(trial) !== 'active') return reply(req, { error: 'trial_not_active' }, 409);
        let made: CreatedInvite;
        try {
          made = await deps.inviteAgent(who.userId);
        } catch (e) {
          if (e instanceof NotEntitled) return reply(req, { error: 'not_owner' }, 403);
          throw e;
        }
        return reply(req, { status: 'OK', invite_link: made.invite_link, invite_expires_at: made.invite_expires_at });
      }
      return reply(req, { error: 'bad_request' }, 400);
    } catch (e) {
      if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);
      return reply(req, { error: 'internal' }, 500);
    }
  };
}

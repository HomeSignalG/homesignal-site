// THE BROKERAGE TRIAL, as the edge functions reach it (Development Activity build steps 5b, 5c and 5d).
//
// The database owns every decision here (docs/evaluation-entitlement.sql, Order L1): who is a member, of which evaluation, how many
// of the 20 reports are used, whether an invite may be redeemed. This file only calls those functions, checks the shape of what
// comes back, and turns the database's refusal messages into named errors. It is the ONE place an edge function names them, so the
// report function and the trial function cannot read a trial two different ways. It also holds the one form of an invite link (5d).
// Charging a report is not here: it is public.evaluation_report_issue, reached only through _shared/report-snapshot.ts, because it
// must store the report in the same transaction.
//
// PURE of environment and network: the database call arrives as `rpc` (_shared/service-rest.ts).
import { DataUnavailable } from './service-rest.ts';
import type { ServiceRpc } from './service-rest.ts';
import type { TrialState } from './admin-gate.ts';

/** The invite cannot be used: unknown, malformed, expired, revoked, already used by someone else, or its trial has ended. */
export class InviteUnusable extends Error {}
/** The person already belongs to a brokerage (one membership per person, Order K0). */
export class AlreadyAMember extends Error {}
/** The trial's agent seats are full. */
export class SeatLimitReached extends Error {}
/** The database refused to create a trial. Its function is one transaction, so nothing was created. */
export class TrialRejected extends Error {}

/** An invite token as public.evaluation_invite_mint makes it. Anything else is refused before the database is asked. */
export const INVITE_TOKEN = /^hse1_[0-9a-f]{64}$/;

/**
 * THE invite link: the ONE place its form is written (build step 5d). The token rides in the URL FRAGMENT, which a browser never sends
 * to any server; the customer page (development-activity-reports.html) reads it from there and removes it from the address bar.
 */
export const INVITE_PAGE = 'https://homesignal.net/development-activity-reports.html';
export function inviteLink(token: string): string {
  if (!INVITE_TOKEN.test(token)) throw new DataUnavailable('shape');
  return INVITE_PAGE + '#invite=' + token;
}

export type Redeemed = { role: 'owner' | 'agent'; replayed: boolean };
/** A new trial's owner invite, as the admin who created it is shown it: once, and never an id. */
export type CreatedTrial = { invite_link: string; invite_expires_at: string };
/** What an admin asks for. A null seat limit or end date means none (D-L2, D-L3); the invite lives the database's default 14 days (D-L4). */
export type NewTrial = { brokerageName: string; seatLimit: number | null; expiresAt: string | null };

export function makeEvaluationReads(rpc: ServiceRpc) {
  return {
    /** The signed-in person's trial, by their auth user id (never an email), or null when they belong to none. */
    async trialOf(userId: string): Promise<TrialState | null> {
      const { data, error } = await rpc('evaluation_usage', { p_user_id: userId });
      if (error) throw new DataUnavailable('evaluation_usage');
      if (!Array.isArray(data)) throw new DataUnavailable('shape');
      if (data.length === 0) return null;
      const t = data[0];
      if (data.length !== 1 || !t || typeof t.status !== 'string' || !Number.isInteger(t.credits_used) || !Number.isInteger(t.credits_remaining) || typeof t.expired !== 'boolean') {
        throw new DataUnavailable('shape');
      }
      return { status: t.status, credits_used: t.credits_used, credits_remaining: t.credits_remaining, expired: t.expired };
    },

    /**
     * Join a trial with an invite. The same person using their own invite again is answered `replayed: true` and changes nothing.
     * Every other refusal is one of the three named errors; any other failure is DataUnavailable. No id leaves this function.
     */
    async redeemInvite(token: string, userId: string): Promise<Redeemed> {
      if (!INVITE_TOKEN.test(token)) throw new InviteUnusable('malformed');
      const { data, error } = await rpc('evaluation_invite_redeem', { p_token: token, p_user_id: userId });
      if (error) {
        if (error.message === 'INVITE_UNUSABLE') throw new InviteUnusable('refused');
        if (error.message === 'ALREADY_A_MEMBER') throw new AlreadyAMember('refused');
        if (error.message === 'SEAT_LIMIT_REACHED') throw new SeatLimitReached('refused');
        throw new DataUnavailable('evaluation_invite_redeem');
      }
      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');
      const r = data[0];
      if (!r || (r.role !== 'owner' && r.role !== 'agent') || typeof r.replayed !== 'boolean') throw new DataUnavailable('shape');
      return { role: r.role, replayed: r.replayed };
    },

    /**
     * Create a brokerage's trial: its account, its evaluation and its first OWNER invite, in the database's one transaction
     * (public.evaluation_create). Only the trial function's `create` action calls this, and only for an admin. The token comes back
     * once, as the invite link; the account, evaluation and invite ids stay here.
     */
    async createTrial(t: NewTrial): Promise<CreatedTrial> {
      const { data, error } = await rpc('evaluation_create', { p_brokerage_name: t.brokerageName, p_seat_limit: t.seatLimit, p_expires_at: t.expiresAt });
      if (error) throw new TrialRejected('refused');
      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');
      const r = data[0];
      if (!r || typeof r.owner_token !== 'string' || !INVITE_TOKEN.test(r.owner_token) || typeof r.invite_expires_at !== 'string' || !Number.isFinite(Date.parse(r.invite_expires_at))) {
        throw new DataUnavailable('shape');
      }
      return { invite_link: inviteLink(r.owner_token), invite_expires_at: r.invite_expires_at };
    },
  };
}

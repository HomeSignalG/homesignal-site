// THE BROKERAGE TRIAL, as the edge functions reach it (Development Activity build steps 5b and 5c).
//
// The database owns every decision here (docs/evaluation-entitlement.sql, Order L1): who is a member, of which evaluation, how many
// of the 20 reports are used, whether an invite may be redeemed. This file only calls those functions, checks the shape of what
// comes back, and turns the database's refusal messages into named errors. It is the ONE place an edge function names them, so the
// report function and the trial function cannot read a trial two different ways. Charging a report is not here: it is
// public.evaluation_report_issue, reached only through _shared/report-snapshot.ts, because it must store the report in the same
// transaction.
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

/** An invite token as public.evaluation_invite_mint makes it. Anything else is refused before the database is asked. */
export const INVITE_TOKEN = /^hse1_[0-9a-f]{64}$/;

export type Redeemed = { role: 'owner' | 'agent'; replayed: boolean };

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
  };
}

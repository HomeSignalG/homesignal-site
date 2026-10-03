// THE BROKERAGE TRIAL, as the edge functions reach it (Development Activity build steps 5b, 5c, 5d and 5e).
//
// The database owns every decision here (docs/evaluation-entitlement.sql, Order L1, and docs/brokerage-account-spine.sql, Order K0):
// who is a member and in what role, of which evaluation, how many of the 20 reports are used, whether an invite may be redeemed, and
// who may make one. This file only calls those functions, checks the shape of what comes back, and turns the database's refusal
// messages into named errors. It is the ONE place an edge function names them, so the report function and the trial function cannot
// read a trial two different ways. It also holds the one form of an invite link (5d).
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
/** The person may not invite: they belong to no trial, are not an active OWNER of it, or the trial has ended (EV003, NOT_ENTITLED). */
export class NotEntitled extends Error {}

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

export type Role = 'owner' | 'agent';
/** One of a brokerage's stored reports, as the list shows it. The context handle is for the caller's own address read; it never leaves the report function. */
export type SavedReport = { report_id: string; number: number; generated_at: string; private_context_id: string | null };
/** One stored report, opened: the stored text exactly as it was stored. */
export type OpenedReport = SavedReport & { body: string };
/** The header a brokerage's member sees on a report (build step 7): presentation only, read when a report is shown and stored nowhere. */
export type ReportHeader = { brokerage: string | null; agent: string | null };
export type Redeemed = { role: Role; replayed: boolean };
/** A new trial's owner invite, as the admin who created it is shown it: once, and never an id. */
export type CreatedTrial = { invite_link: string; invite_expires_at: string };
/** An agent invite, as the owner who made it is shown it: once, and never an id (build step 5e). */
export type CreatedInvite = { invite_link: string; invite_expires_at: string };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isTime = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
/** What an admin asks for. A null seat limit or end date means none (D-L2, D-L3); the invite lives the database's default 14 days (D-L4). */
export type NewTrial = { brokerageName: string; seatLimit: number | null; expiresAt: string | null };

/**
 * A name that will be PRINTED on a report (build step 7), as one line of plain text: line breaks, control and direction-changing
 * characters become spaces, runs of spaces collapse, the ends are trimmed. A name that is empty, is not text or is longer than `max` is
 * `null`, never a shortened copy: half a name on a report reads as a different name. The agent's name is the person's own wording, so
 * this is the ONE place it is made safe to show (the page shows it as text, never as markup).
 */
export function cleanDisplayName(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return s && Array.from(s).length <= max ? s : null;
}
export const AGENT_NAME_MAX = 80;
export const BROKERAGE_NAME_MAX = 120;

function savedRow(r: unknown): SavedReport {
  const x = r as Record<string, unknown> | null;
  if (!x || typeof x.report_id !== 'string' || !UUID.test(x.report_id) || !Number.isInteger(x.number) || !isTime(x.generated_at)
      || !(x.private_context_id === null || (typeof x.private_context_id === 'string' && UUID.test(x.private_context_id)))) {
    throw new DataUnavailable('shape');
  }
  return { report_id: x.report_id, number: x.number as number, generated_at: x.generated_at as string, private_context_id: x.private_context_id as string | null };
}

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
      if (!r || typeof r.owner_token !== 'string' || !INVITE_TOKEN.test(r.owner_token) || !isTime(r.invite_expires_at)) {
        throw new DataUnavailable('shape');
      }
      return { invite_link: inviteLink(r.owner_token), invite_expires_at: r.invite_expires_at };
    },

    /**
     * The person's role in their brokerage, 'owner' or 'agent', or null when they belong to none (build step 5e). Read from the ONE
     * membership resolver (public.brokerage_membership_of, Order K0), never re-derived. It decides only what the page OFFERS: whether
     * an invite may be made is the database's own check, at the moment it is made (inviteAgent).
     */
    async roleOf(userId: string): Promise<Role | null> {
      const { data, error } = await rpc('brokerage_membership_of', { p_user_id: userId });
      if (error) throw new DataUnavailable('brokerage_membership_of');
      if (!Array.isArray(data)) throw new DataUnavailable('shape');
      if (data.length === 0) return null;
      const r = data[0];
      if (data.length !== 1 || !r || (r.role !== 'owner' && r.role !== 'agent')) throw new DataUnavailable('shape');
      return r.role;
    },

    /**
     * The brokerage's stored reports, newest first (build step 6): public.evaluation_reports_of, which reads the caller's own brokerage's
     * ledger through the one membership resolver. A person with no standing gets an empty list. At most the evaluation's 20 reports exist.
     */
    async savedReports(userId: string): Promise<SavedReport[]> {
      const { data, error } = await rpc('evaluation_reports_of', { p_user_id: userId });
      if (error) throw new DataUnavailable('evaluation_reports_of');
      if (!Array.isArray(data) || data.length > 1000) throw new DataUnavailable('shape');
      return data.map(savedRow);
    },

    /**
     * ONE stored report by its permanent id (build step 6): public.evaluation_report_open. Null when the id is not one of the caller's own
     * brokerage's reports (another brokerage's, unknown, or the caller has no standing): the three cannot be told apart. The text is the
     * stored text, unchanged; this call writes nothing and can charge nothing.
     */
    async openSavedReport(userId: string, reportId: string): Promise<OpenedReport | null> {
      if (!UUID.test(reportId)) return null;
      const { data, error } = await rpc('evaluation_report_open', { p_user_id: userId, p_report_id: reportId });
      if (error) throw new DataUnavailable('evaluation_report_open');
      if (!Array.isArray(data)) throw new DataUnavailable('shape');
      if (data.length === 0) return null;
      const r = data[0];
      // the database was asked for ONE id: a different id, or a second row, is a fault, never a report to show
      if (data.length !== 1 || !r || typeof r.report_id !== 'string' || r.report_id.toLowerCase() !== reportId.toLowerCase() || typeof r.body !== 'string') {
        throw new DataUnavailable('shape');
      }
      return { ...savedRow(r), body: r.body };
    },

    /**
     * The header a member's reports carry (build step 7): public.report_header_of, which reads the brokerage's name through the one
     * membership resolver and the person's own name from their account. Both are cleaned here, once. A person with no standing gets
     * `{ brokerage: null, agent: null }`. Nothing returned is stored by the caller: the header is read each time a report is shown.
     */
    async reportHeader(userId: string): Promise<ReportHeader> {
      const { data, error } = await rpc('report_header_of', { p_user_id: userId });
      if (error) throw new DataUnavailable('report_header_of');
      if (!Array.isArray(data) || data.length > 1) throw new DataUnavailable('shape');
      if (data.length === 0) return { brokerage: null, agent: null };
      const r = data[0];
      const text = (v: unknown) => v === null || typeof v === 'string';
      if (!r || !text(r.brokerage_name) || !text(r.agent_name)) throw new DataUnavailable('shape');
      return { brokerage: cleanDisplayName(r.brokerage_name, BROKERAGE_NAME_MAX), agent: cleanDisplayName(r.agent_name, AGENT_NAME_MAX) };
    },

    /**
     * An OWNER invites an agent to their own brokerage's trial (build step 5e): public.evaluation_invite_mint with the owner as the
     * actor, so the DATABASE checks, under the evaluation's lock, that this person is an active owner of that very brokerage and that
     * the trial is neither revoked nor expired, and it can mint an AGENT invite only (D-L8). The seat limit is checked when the invite
     * is used (redeemInvite), not here (D-L2). The evaluation id is read and used inside this function and never returned; the token
     * comes back once, as the invite link. The invite lives the database's default 14 days (D-L4).
     */
    async inviteAgent(userId: string): Promise<CreatedInvite> {
      const usage = await rpc('evaluation_usage', { p_user_id: userId });
      if (usage.error) throw new DataUnavailable('evaluation_usage');
      if (!Array.isArray(usage.data)) throw new DataUnavailable('shape');
      if (usage.data.length === 0) throw new NotEntitled('no trial');
      const t = usage.data[0];
      if (usage.data.length !== 1 || !t || typeof t.evaluation_id !== 'string' || !UUID.test(t.evaluation_id)) throw new DataUnavailable('shape');
      const { data, error } = await rpc('evaluation_invite_mint', { p_evaluation_id: t.evaluation_id, p_role: 'agent', p_actor: userId });
      if (error) {
        if (error.message === 'NOT_ENTITLED') throw new NotEntitled('refused');
        throw new DataUnavailable('evaluation_invite_mint');
      }
      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');
      const r = data[0];
      if (!r || typeof r.token !== 'string' || !INVITE_TOKEN.test(r.token) || !isTime(r.expires_at)) throw new DataUnavailable('shape');
      return { invite_link: inviteLink(r.token), invite_expires_at: r.expires_at };
    },
  };
}

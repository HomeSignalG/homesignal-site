// CLIENT SHARE LINKS, as the edge functions reach them (Development Activity build step 8).
//
// The database owns every decision here (docs/report-share-delivery.sql, on the share primitive docs/report-share.sql, Order J1): who may
// make a link for a report, how long it lasts (6 months, founder 2026-10-03), how many a report may have, whether a link is usable, and what
// a person holding one may read. This file only mints the secret, calls those functions, checks the shape of what comes back, and turns the
// database's refusals into named errors. It is the ONE place an edge function names them, and the ONE place the link's form is written, so
// the agent's function and the client's function cannot read a link two different ways.
//
// THE SECRET. A link carries a random 256-bit token (_shared/report-share.ts). The DATABASE NEVER SEES IT: this file hashes it and only
// the SHA-256 is sent. The token is returned ONCE, inside the link, to the agent who just made it, and is stored nowhere: a lost link is
// revoked and replaced, never recovered. The token rides in the URL FRAGMENT, which a browser never sends to any server; the client page
// (shared-report.html) reads it from there, removes it from the address bar, and sends it in a POST body.
//
// WHAT IT NEVER RETURNS to the person holding a link: a share id, an evaluation, a user, an agent, or the label an agent typed. The
// brokerage's NAME is the only identity a shared report carries. (The address is read separately, from the private layer, by the function
// that serves the link: _shared/private-subject.ts.)
//
// PURE of environment and network: the database call arrives as `rpc` (_shared/service-rest.ts).
import { DataUnavailable } from './service-rest.ts';
import type { ServiceRpc } from './service-rest.ts';
import { hashShareToken, isWellFormedToken, newShareToken } from './report-share.ts';
import { UUID } from './evaluation-reads.ts';

/** The report is not one of the caller's own brokerage's, does not exist, or the brokerage has no standing to share it. All one answer. */
export class ShareNotFound extends Error {}
/** The report already has the most links it may ever have (the database's own cap). */
export class ShareLimitReached extends Error {}

/**
 * THE share link: the ONE place its form is written. The token rides in the URL FRAGMENT, so no server, log or referrer ever receives it.
 * The page that reads it is shared-report.html, which is noindex, disallowed in robots.txt, linked from nowhere and sends no referrer.
 */
export const SHARE_PAGE = 'https://homesignal.net/shared-report.html';
export function shareLink(token: string): string {
  if (!isWellFormedToken(token)) throw new DataUnavailable('shape');
  return SHARE_PAGE + '#share=' + token;
}

const isTime = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const STATUSES = ['ACTIVE', 'EXPIRED', 'REVOKED'] as const;
export type ShareStatus = typeof STATUSES[number];

/** A link just made, as the agent who made it is shown it: once. The link is the only place the token exists. */
export type CreatedShare = { share_id: string; expires_at: string; link: string };
/** One of a report's links, as the agent sees it: never the token or its hash. `status` is the database's own decision. */
export type ShareRow = { share_id: string; created_at: string; expires_at: string | null; revoked_at: string | null; status: ShareStatus };
/** What the holder of a link may read: the stored report as stored, when it was made, and the brokerage's name. */
export type SharedReport = { report_id: string; generated_at: string; body: string; private_context_id: string | null; brokerage_name: string | null };

function shareRow(r: unknown): ShareRow {
  const x = r as Record<string, unknown> | null;
  if (!x || typeof x.share_id !== 'string' || !UUID.test(x.share_id) || !isTime(x.created_at)
      || !(x.expires_at === null || isTime(x.expires_at)) || !(x.revoked_at === null || isTime(x.revoked_at))
      || typeof x.status !== 'string' || !(STATUSES as readonly string[]).includes(x.status)) {
    throw new DataUnavailable('shape');
  }
  return { share_id: x.share_id, created_at: x.created_at as string, expires_at: x.expires_at as string | null, revoked_at: x.revoked_at as string | null, status: x.status as ShareStatus };
}

export function makeShareReads(rpc: ServiceRpc) {
  return {
    /**
     * Make a link for one of the caller's own brokerage's stored reports (public.evaluation_report_share_create). The token is minted
     * here, hashed here, and only the hash is sent. A refusal of the database is one of the two named errors; anything else is
     * DataUnavailable. The link comes back once.
     */
    async createShare(userId: string, reportId: string): Promise<CreatedShare> {
      if (!UUID.test(reportId)) throw new ShareNotFound('malformed');
      const token = newShareToken();
      const { data, error } = await rpc('evaluation_report_share_create', { p_user_id: userId, p_report_id: reportId, p_token_sha256: await hashShareToken(token) });
      if (error) {
        if (error.message === 'NOT_FOUND') throw new ShareNotFound('refused');
        if (error.message === 'SHARE_LIMIT_REACHED') throw new ShareLimitReached('refused');
        throw new DataUnavailable('evaluation_report_share_create');
      }
      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');
      const r = data[0];
      if (!r || typeof r.share_id !== 'string' || !UUID.test(r.share_id) || !isTime(r.expires_at)) throw new DataUnavailable('shape');
      return { share_id: r.share_id, expires_at: r.expires_at, link: shareLink(token) };
    },

    /**
     * The links of one of the caller's own brokerage's reports, newest first (public.evaluation_report_shares_of). Empty for a report that is
     * not the caller's, which cannot be told from "no links". At most the database's cap of 25.
     */
    async listShares(userId: string, reportId: string): Promise<ShareRow[]> {
      if (!UUID.test(reportId)) return [];
      const { data, error } = await rpc('evaluation_report_shares_of', { p_user_id: userId, p_report_id: reportId });
      if (error) throw new DataUnavailable('evaluation_report_shares_of');
      if (!Array.isArray(data) || data.length > 100) throw new DataUnavailable('shape');
      return data.map(shareRow);
    },

    /** Revoke one link (public.evaluation_report_share_revoke): true when THIS call revoked it, false when it already was. */
    async revokeShare(userId: string, shareId: string): Promise<boolean> {
      if (!UUID.test(shareId)) throw new ShareNotFound('malformed');
      const { data, error } = await rpc('evaluation_report_share_revoke', { p_user_id: userId, p_share_id: shareId });
      if (error) {
        if (error.message === 'NOT_FOUND') throw new ShareNotFound('refused');
        throw new DataUnavailable('evaluation_report_share_revoke');
      }
      if (typeof data !== 'boolean') throw new DataUnavailable('shape');
      return data;
    },

    /**
     * What the holder of a link may read (public.report_share_open). Null for a link that is unknown, revoked, expired, or whose owner was
     * withdrawn: the database returns no row for any of them, and so does a string that could never have been a token (no database call
     * is made for one). The token is hashed here and never sent.
     */
    /**
     * The link's subject for the client-link rate limit (docs/da-owner-safeguards.sql part B): the SHA-256 of a well-formed token (the form in which a
     * token ever reaches the database), or null for anything else. The token module has ONE importer, this file, so the hashing stays here.
     */
    async linkHashOf(token: unknown): Promise<string | null> {
      return isWellFormedToken(token) ? await hashShareToken(token) : null;
    },

    async openShared(token: unknown): Promise<SharedReport | null> {
      if (!isWellFormedToken(token)) return null;
      const { data, error } = await rpc('report_share_open', { p_token_sha256: await hashShareToken(token) });
      if (error) throw new DataUnavailable('report_share_open');
      if (!Array.isArray(data)) throw new DataUnavailable('shape');
      if (data.length === 0) return null;
      const r = data[0];
      if (data.length !== 1 || !r || typeof r.report_id !== 'string' || !UUID.test(r.report_id) || !isTime(r.generated_at) || typeof r.body !== 'string'
          || !(r.private_context_id === null || (typeof r.private_context_id === 'string' && UUID.test(r.private_context_id)))
          || !(r.brokerage_name === null || typeof r.brokerage_name === 'string')) {
        throw new DataUnavailable('shape');
      }
      return { report_id: r.report_id, generated_at: r.generated_at, body: r.body, private_context_id: r.private_context_id, brokerage_name: r.brokerage_name };
    },
  };
}

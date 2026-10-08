// THE REPORT RATE LIMIT, as the report function reaches it (docs/report-rate-limit.sql).
//
// The database owns every decision here: which windows exist, how many requests each allows, whether this request still fits in all of them, and the
// counting itself (one transaction, serialised per person and per brokerage). This file only calls `report_rate_claim`, checks the shape of what comes
// back, and says it plainly. It decides nothing, holds no number, and stores nothing: the numbers live in public.report_rate_limits() and NOWHERE in
// this repo's TypeScript (a second copy would drift from the first, and a test fails if one appears).
//
// FAILS CLOSED. A claim that cannot be made, or comes back in a shape this file does not recognise, is DataUnavailable and the report function answers
// 502 WITHOUT going on to the geocoder: a limiter that cannot be read must not become an open door.
//
// PURE of environment and network: the database call arrives as `rpc` (_shared/service-rest.ts).
import { DataUnavailable } from './service-rest.ts';
import type { ServiceRpc } from './service-rest.ts';

/** Whose ceiling refused the request: the signed-in person's own, or their brokerage's (shared by everyone in it). */
export type LimitedBy = 'user' | 'brokerage';
export const WINDOW_SECONDS = [60, 3600, 86400] as const;
export type WindowSeconds = typeof WINDOW_SECONDS[number];

export type RateVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; limitedBy: LimitedBy; windowSeconds: WindowSeconds };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function makeRateReads(rpc: ServiceRpc) {
  return {
    /**
     * Take one request from every applicable window of this person (and of their brokerage), or learn that one is full. A refusal has consumed
     * nothing. `userId` is the auth user id, never an email, an address or an IP.
     */
    async claim(userId: string): Promise<RateVerdict> {
      if (!UUID.test(userId)) throw new DataUnavailable('rate claim needs a user id');
      const { data, error } = await rpc('report_rate_claim', { p_user: userId });
      if (error) throw new DataUnavailable('report_rate_claim');
      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');
      const r = data[0];
      if (!r || typeof r.allowed !== 'boolean') throw new DataUnavailable('shape');
      if (r.allowed) {
        if (r.retry_after_seconds !== 0 || r.limited_by !== null || r.limited_window_secs !== null) throw new DataUnavailable('shape');
        return { allowed: true };
      }
      if (!Number.isInteger(r.retry_after_seconds) || r.retry_after_seconds < 1 || r.retry_after_seconds > 86400
          || (r.limited_by !== 'user' && r.limited_by !== 'brokerage')
          || !(WINDOW_SECONDS as readonly number[]).includes(r.limited_window_secs)) {
        throw new DataUnavailable('shape');
      }
      return { allowed: false, retryAfterSeconds: r.retry_after_seconds, limitedBy: r.limited_by, windowSeconds: r.limited_window_secs };
    },
  };
}

// ---- THE CLIENT LINK RATE LIMIT (docs/da-owner-safeguards.sql, part B) --------------------------------------------------------------------------------
// view-shared-report answers a person who is not signed in, so its subjects are not accounts: a CLIENT (a one-way hash of the caller's network address,
// salted with a server secret, so the table never holds an address and a hash cannot be reversed by trying every address) and a LINK (the SHA-256 of
// the token, which the database already knows). The numbers live in public.share_view_limits() and nowhere in this repo's TypeScript.
export type ShareLimitedBy = 'client' | 'link';
export type ShareViewVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; limitedBy: ShareLimitedBy; windowSeconds: WindowSeconds };

const HEX = /^[0-9a-f]{32,64}$/;

/**
 * The caller's network address, as the platform's edge saw it. `cf-connecting-ip` is set by the edge itself and cannot be chosen by the caller; the other
 * two are fallbacks a caller could influence, which can only let them dodge their OWN client window (the link window still binds), never someone else's.
 * No header at all is the one shared client "unknown": a request with no address is limited together, not let through.
 */
export function networkAddressOf(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip'); if (cf && cf.trim()) return cf.trim().slice(0, 64);
  const real = headers.get('x-real-ip'); if (real && real.trim()) return real.trim().slice(0, 64);
  const fwd = headers.get('x-forwarded-for'); if (fwd && fwd.split(',')[0].trim()) return fwd.split(',')[0].trim().slice(0, 64);
  return 'unknown';
}

/** The client's subject: HMAC-SHA-256 of the address under the server's secret, 64 lower-case hex digits. Refuses to run with no secret (an unsalted hash is an address). */
export async function shareClientKey(headers: Headers, secret: string): Promise<string> {
  if (!secret) throw new DataUnavailable('share client key needs a secret');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('share-view-client|' + networkAddressOf(headers)));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeShareViewRateReads(rpc: ServiceRpc) {
  return {
    /** Take one request from the client's windows and (when the token is well formed) the link's, or learn one is full. A refusal has consumed nothing. */
    async claim(clientKey: string, linkHash: string | null): Promise<ShareViewVerdict> {
      if (!HEX.test(clientKey) || (linkHash !== null && !HEX.test(linkHash))) throw new DataUnavailable('share view claim needs hashed subjects');
      const { data, error } = await rpc('share_view_claim', { p_client: clientKey, p_link: linkHash });
      if (error) throw new DataUnavailable('share_view_claim');
      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');
      const r = data[0];
      if (!r || typeof r.allowed !== 'boolean') throw new DataUnavailable('shape');
      if (r.allowed) {
        if (r.retry_after_seconds !== 0 || r.limited_by !== null || r.limited_window_secs !== null) throw new DataUnavailable('shape');
        return { allowed: true };
      }
      if (!Number.isInteger(r.retry_after_seconds) || r.retry_after_seconds < 1 || r.retry_after_seconds > 86400
          || (r.limited_by !== 'client' && r.limited_by !== 'link')
          || !(WINDOW_SECONDS as readonly number[]).includes(r.limited_window_secs)) {
        throw new DataUnavailable('shape');
      }
      return { allowed: false, retryAfterSeconds: r.retry_after_seconds, limitedBy: r.limited_by, windowSeconds: r.limited_window_secs };
    },
  };
}

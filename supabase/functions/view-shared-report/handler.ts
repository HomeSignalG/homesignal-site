// view-shared-report — what a CLIENT who holds a share link may read (Development Activity build step 8; docs/development-activity-build-steps-100526.md).
//
// A brokerage's agent makes a private, read-only link to one stored report (manage-shared-report). This is the function behind that link. It is
// the one function that answers a person who is NOT signed in, so it is deliberately small:
//   * the only input is the link's token, in a POST body (the page reads it from the URL fragment, which no server ever receives);
//   * the only answer is the stored report as stored, when it was made, the brokerage's NAME and, while the private layer still keeps it,
//     the report's street address (founder, 2026-10-03: the client sees the address). Never the label the agent typed, never a share id, an
//     agent, a user, an evaluation, another report, or whether a link ever existed;
//   * a link that is unknown, malformed, revoked, expired, or whose owner was withdrawn is ONE answer: 404 `not_found`. There is no oracle;
//   * it writes nothing and charges nothing: opening a report is a read (the database function behind it is STABLE).
//
// It is deployed WITHOUT JWT verification (the client has no account), so there is no gate to rely on: every rule is in this file and in the
// database function it calls.
//
// THE RATE LIMIT (audit item D, docs/da-owner-safeguards.sql part B). A 256-bit token cannot be guessed, but a flood of requests still costs a
// database read each. Every well-formed request first takes one from the windows of (1) the caller's network address, stored only as a salted
// one-way hash, and (2) the link it asks about, and a full window answers 429 `rate_limited` with how long to wait. The claim comes BEFORE the link
// is looked up, so unknown links count against the caller too. It fails closed: a limiter that cannot be read is 502 and the link is not opened.
// The numbers are the database's (public.share_view_limits()); none is written here.
//
// This file holds the LOGIC and reads no environment and calls no network: everything external arrives through `Deps`.
import { corsFor, readBounded, reply, TOO_LARGE } from '../_shared/admin-gate.ts';
import { BROKERAGE_NAME_MAX, cleanDisplayName } from '../_shared/evaluation-reads.ts';
import type { ShareViewVerdict } from '../_shared/rate-reads.ts';
import type { SharedReport } from '../_shared/share-reads.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';

export { DataUnavailable };

export type Deps = {
  /** The report a link opens, or null for every kind of link that opens nothing. The token never leaves this call unhashed. */
  openShared: (token: unknown) => Promise<SharedReport | null>;
  /** The street address the report was made for, while the private layer keeps it, else null. The ONLY thing read from that layer. */
  addressOf: (contextId: string | null) => Promise<string | null>;
  /** The link's subject for the rate limit: the SHA-256 of a well-formed token, else null. */
  linkKey: (token: unknown) => Promise<string | null>;
  /** The caller, as a one-way hash of their network address (never the address). Throws DataUnavailable when it cannot be made. */
  clientKey: (req: Request) => Promise<string>;
  /** The rate limit (docs/da-owner-safeguards.sql part B): take one request from the client's and the link's windows, or learn one is full. Throws DataUnavailable when it cannot say. */
  viewClaim: (clientKey: string, linkHash: string | null) => Promise<ShareViewVerdict>;
};

export const CAPABILITY = {
  product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
  method: 'POST { token }',
  access: 'anyone holding a share link; there is no sign-in. A link is read-only and can be withdrawn by the brokerage that made it.',
  writes: [],
  rate_limit: 'requests are rate limited per caller and per link; a full window answers 429 rate_limited with retry_after_seconds (the limits are set in the database)',
};

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsFor(req) });
    if (req.method === 'GET') return reply(req, CAPABILITY);
    if (req.method !== 'POST') return reply(req, { error: 'method_not_allowed' }, 405);

    const body = await readBounded(req);
    if (body === TOO_LARGE) return reply(req, { error: 'too_large' }, 413);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(req, { error: 'bad_request' }, 400);
    const b = body as Record<string, unknown>;
    // a closed set of one field: anything else is a malformed request, not a link
    if (Object.keys(b).some((k) => k !== 'token')) return reply(req, { error: 'bad_request' }, 400);

    try {
      // the rate limit, BEFORE the link is looked up: a request with no usable token still takes the caller's windows (a flood of garbage is still a flood)
      const linkHash = await deps.linkKey(b.token);
      const verdict = await deps.viewClaim(await deps.clientKey(req), linkHash);
      if (!verdict.allowed) return reply(req, { error: 'rate_limited', retry_after_seconds: verdict.retryAfterSeconds }, 429);
      // a token that is not a string, or could never have been one, reaches no database and gets the same answer as an unknown link
      if (typeof b.token !== 'string') return reply(req, { error: 'not_found' }, 404);
      const shared = await deps.openShared(b.token);
      if (!shared) return reply(req, { error: 'not_found' }, 404);
      let stored: { coverage?: { state?: string } } | null;
      try { stored = JSON.parse(shared.body); } catch { throw new DataUnavailable('stored report'); }
      if (!stored || typeof stored !== 'object') throw new DataUnavailable('stored report');
      const address = await deps.addressOf(shared.private_context_id);
      return reply(req, {
        status: 'OK',
        coverage_state: stored.coverage?.state ?? null,
        report: stored,
        report_id: shared.report_id,
        generated_at: shared.generated_at,
        brokerage: cleanDisplayName(shared.brokerage_name, BROKERAGE_NAME_MAX),
        address,
      });
    } catch (e) {
      if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);
      return reply(req, { error: 'internal' }, 500); // never the message: it can carry the address
    }
  };
}

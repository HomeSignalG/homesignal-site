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
// database function it calls. Rate limiting is not built here; a 256-bit token cannot be guessed, and a flood of requests is carried to
// build step 13 (docs/development-activity-report-engine-2026-09-30.md).
//
// This file holds the LOGIC and reads no environment and calls no network: everything external arrives through `Deps`.
import { corsFor, readBounded, reply, TOO_LARGE } from '../_shared/admin-gate.ts';
import { BROKERAGE_NAME_MAX, cleanDisplayName } from '../_shared/evaluation-reads.ts';
import type { SharedReport } from '../_shared/share-reads.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';

export { DataUnavailable };

export type Deps = {
  /** The report a link opens, or null for every kind of link that opens nothing. The token never leaves this call unhashed. */
  openShared: (token: unknown) => Promise<SharedReport | null>;
  /** The street address the report was made for, while the private layer keeps it, else null. The ONLY thing read from that layer. */
  addressOf: (contextId: string | null) => Promise<string | null>;
};

export const CAPABILITY = {
  product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
  method: 'POST { token }',
  access: 'anyone holding a share link; there is no sign-in. A link is read-only and can be withdrawn by the brokerage that made it.',
  writes: [],
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

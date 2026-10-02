// WHO MAY CALL AN INTERNAL EDGE FUNCTION, and the response plumbing every one of them shares — moved here VERBATIM from
// get-development-activity-report/handler.ts so the gate has ONE definition (CLAUDE.md "one canonical truth path").
// The national report and Changes Since Report / Follow both ask `authorizeAdmin`; neither restates it.
//
// WHY THE GATEWAY'S JWT CHECK IS NOT ENOUGH. `verify_jwt = true` proves a token is validly SIGNED. The public anon key is a
// validly signed token, and it is in every page of the site. So the gateway alone leaves an anonymous caller. This gate
// therefore also requires a real SIGNED-IN USER whose email is in public.dashboard_admins. That is an internal diagnostic
// surface, which is what the plan permits before the account, entitlement and quota units (Orders H and L) exist; it is NOT
// a customer surface. When those units land, the entitlement check replaces `isAdmin` HERE, and every function that uses
// this gate changes with it.
//
// PURE of environment and network: the two reads arrive through `AdminGateDeps`.
export const MAX_BODY_BYTES = 4096;
export const ALLOWED_ORIGINS = ['https://homesignal.net', 'https://www.homesignal.net'];

export type AdminGateDeps = {
  authenticate: (token: string) => Promise<{ email: string; id?: string } | null>;
  isAdmin: (email: string) => Promise<boolean>;
};

export function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

export function reply(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    // the response can carry the customer's own address back to them: it is never cacheable
    headers: { ...corsFor(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** A unique object, so no JSON body can ever be mistaken for "too large". */
export const TOO_LARGE = Symbol('too-large');

export async function readBounded(req: Request): Promise<unknown | typeof TOO_LARGE> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return TOO_LARGE;
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return TOO_LARGE;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Who is asking — a signed-in user, then an allow-listed one. Returns null when the caller may proceed, or the refusal to
 * send. It reads nothing from the request body: identity is settled BEFORE anything the caller typed is looked at.
 */
export async function authorizeAdmin(req: Request, deps: AdminGateDeps): Promise<Response | null> {
  const who = await identify(req, deps);
  if (who instanceof Response) return who;
  if (!who.admin) return reply(req, { error: 'forbidden' }, 403);
  return null;
}

/** A signed-in user, and whether the allow-list names them. Shared by both gates, so neither can authenticate differently. */
async function identify(req: Request, deps: AdminGateDeps): Promise<Response | { user: { email: string; id?: string }; admin: boolean }> {
  const auth = req.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  if (!token) return reply(req, { error: 'unauthorized' }, 401);
  let user: { email: string; id?: string } | null;
  try { user = await deps.authenticate(token); } catch { return reply(req, { error: 'unavailable' }, 502); }
  if (!user || !user.email) return reply(req, { error: 'unauthorized' }, 401); // includes the public anon key: it has no user
  let admin: boolean;
  try { admin = await deps.isAdmin(user.email); } catch { return reply(req, { error: 'unavailable' }, 502); }
  return { user, admin };
}

// ── WHO MAY MAKE A DEVELOPMENT ACTIVITY REPORT (build step 5b) ───────────────────────────────────────────────────────────────
//
// An admin, exactly as before, or a member of an ACTIVE, unexpired brokerage evaluation (the 20-report trial). The gate decides
// nothing about the trial itself: whether this person is a member, and of which evaluation, is public.evaluation_usage (built on the
// ONE resolver public.brokerage_membership_of, docs/evaluation-entitlement.sql). This only asks it, by the auth user's id, and reads
// its status. Only the report function uses this gate; Follow / Changes Since Report stay admin-only (authorizeAdmin).

/** A trial as public.evaluation_usage reports it. */
export type TrialState = { status: string; credits_used: number; credits_remaining: number; expired: boolean };
export type ReportCaller = { kind: 'admin' } | { kind: 'trial'; userId: string; trial: TrialState };
export type ReportGateDeps = AdminGateDeps & { trialOf: (userId: string) => Promise<TrialState | null> };

/** What a trial member is told about their own trial: never an id. */
export function trialSummary(t: TrialState) {
  return { status: t.status, credits_used: t.credits_used, credits_remaining: t.credits_remaining };
}

/**
 * Whether a trial may make reports now: 'active', 'complete' (its 20 reports are used) or 'ended' (revoked, expired, or any status
 * this code does not know). The ONE reading of a trial's state: the report gate refuses on it and the trial page shows it.
 */
export function trialStanding(t: TrialState): 'active' | 'complete' | 'ended' {
  // a trial whose 20 reports are used is over; making more reports (even free ones) is the paid product's (Order M)
  if (t.status === 'complete') return 'complete';
  if (t.status === 'active' && !t.expired) return 'active';
  return 'ended';
}

export async function authorizeReportCaller(req: Request, deps: ReportGateDeps): Promise<Response | ReportCaller> {
  const who = await identify(req, deps);
  if (who instanceof Response) return who;
  if (who.admin) return { kind: 'admin' };
  if (!who.user.id) return reply(req, { error: 'forbidden' }, 403);
  let trial: TrialState | null;
  try { trial = await deps.trialOf(who.user.id); } catch { return reply(req, { error: 'unavailable' }, 502); }
  if (!trial) return reply(req, { error: 'forbidden' }, 403);
  const standing = trialStanding(trial);
  if (standing === 'complete') return reply(req, { error: 'evaluation_complete', trial: trialSummary(trial) }, 403);
  if (standing !== 'active') return reply(req, { error: 'forbidden' }, 403);
  return { kind: 'trial', userId: who.user.id, trial };
}

// ── ANY SIGNED-IN PERSON (build step 5c): the trial function's gate ──────────────────────────────────────────────────────────────
//
// Joining a trial and reading one's own trial need a real signed-in user (with an id: everything about a trial is keyed on the auth
// user, never an email), and nothing more: being signed in grants nothing, because the database answers only for that user's own
// membership. Whether they are an admin travels with them, so the page knows the report function will serve them as an admin.
export type SignedInCaller = { userId: string; admin: boolean };

export async function authorizeSignedIn(req: Request, deps: AdminGateDeps): Promise<Response | SignedInCaller> {
  const who = await identify(req, deps);
  if (who instanceof Response) return who;
  if (!who.user.id) return reply(req, { error: 'forbidden' }, 403);
  return { userId: who.user.id, admin: who.admin };
}

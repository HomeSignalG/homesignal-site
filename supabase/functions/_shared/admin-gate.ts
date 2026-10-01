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
  authenticate: (token: string) => Promise<{ email: string } | null>;
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
  const auth = req.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  if (!token) return reply(req, { error: 'unauthorized' }, 401);
  let user: { email: string } | null;
  try { user = await deps.authenticate(token); } catch { return reply(req, { error: 'unavailable' }, 502); }
  if (!user || !user.email) return reply(req, { error: 'unauthorized' }, 401); // includes the public anon key: it has no user
  let admin: boolean;
  try { admin = await deps.isAdmin(user.email); } catch { return reply(req, { error: 'unavailable' }, 502); }
  if (!admin) return reply(req, { error: 'forbidden' }, 403);
  return null;
}

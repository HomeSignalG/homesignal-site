// manage-billing — a member reads their plan and its allowance, and an OWNER asks for a signed Paddle checkout (Paddle replaced Lemon Squeezy, 2026-11-16).
//
// ACTIONS:
//   status           { action: "status" }                                   the caller's plan: state, plan, this month's allowance, remaining, next reset,
//                                                                          access end or renewal, and whether the caller may start a checkout.
//   offer            { action: "offer", partner_code }                      read-only: may this account buy the private partner offer with this link?
//   checkout         { action: "checkout", plan, partner_code? }            an OWNER asks for a checkout. Returns what Paddle.js needs to open its overlay:
//                                                                          the PUBLIC client token, the price id, and custom data signed by this server.
//                                                                          Nothing is charged, and nothing about the plan changes, by calling it: the plan changes
//                                                                          only when Paddle's signed event reaches paddle-webhook.
//   checkout_release { action: "checkout_release" }                         the overlay was closed without paying: free the single checkout slot at once.
//   portal           { action: "portal" }                                   an OWNER of a recurring plan gets Paddle's own "update payment method" and
//                                                                          "cancel" addresses (asked of Paddle, never stored).
//
// WHO MAY CALL. Any signed-in person is let in, and being signed in grants nothing: the database answers only for that person's own account
// (public.billing_summary). A person with no account is refused. Only an OWNER may start a checkout or open the portal; an agent sees the plan.
//
// THE PRICE IS NEVER THE PAGE'S: the price id comes from public.billing_price_for (docs/paddle-billing.sql) for the configured environment, and the
// plan, the account and the partner enrollment are inside a signature only this server can make, so a payment cannot be attached to someone else's
// account or to a plan it was not made for. The PRIVATE PARTNER offer is decided here from a link's hash (public.partner_enrollment_start); a price id
// alone grants nothing.
//
// WHAT IT NEVER RETURNS: the account's id, a subscription id, an event, a Paddle customer, an email, the API key or any secret. The client token is
// Paddle's public client-side token and is meant for the browser. This file holds the LOGIC and reads no environment and calls no network.
import { authorizeSignedIn, corsFor, readBounded, reply, TOO_LARGE } from '../_shared/admin-gate.ts';
import type { AdminGateDeps } from '../_shared/admin-gate.ts';
import { dashboardPlan } from '../_shared/billing-reads.ts';
import type { BillingSummary, CheckoutSlot, PartnerStart } from '../_shared/billing-reads.ts';
import { PLANS } from '../_shared/paddle-billing.ts';
import type { CheckoutSession, ManagementUrls, PlanKey } from '../_shared/paddle-billing.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';

export { DataUnavailable };

/** Paddle could not give what was asked. The reason is for the log, never for the browser. */
export class CheckoutUnavailable extends Error {}

export type Deps = AdminGateDeps & {
  summaryOf: (userId: string) => Promise<BillingSummary | null>;
  /** The Paddle checkout settings are all present (a boolean: the values never leave the server). */
  configured: () => boolean;
  /** The Paddle API key is present (the portal needs it; the checkout does not). */
  apiConfigured: () => boolean;
  /** The committed kill switch (_shared/billing-switch.ts). False refuses every checkout. */
  checkoutEnabled: () => boolean;
  /** The database's own environment ('production' | 'staging') and whether paid checkout has launched there (the report gate is armed). */
  environmentMode: () => Promise<'production' | 'staging'>;
  gateArmed: () => Promise<boolean>;
  /** The Paddle environment this function is configured for ('production' | 'sandbox'). */
  paddleEnvironment: () => 'production' | 'sandbox';
  /** Records the owner's agreement to the CURRENT terms version for a plan; answers ACCEPTED, VERSION_STALE or NOT_OWNER. */
  termsAccept: (userId: string, version: string, plan: PlanKey) => Promise<'ACCEPTED' | 'VERSION_STALE' | 'NOT_OWNER'>;
  partnerStart: (userId: string, tokenHash: string, write: boolean) => Promise<PartnerStart>;
  sha256: (text: string) => Promise<string>;
  makeSession: (brokerageId: string, plan: PlanKey, enrollmentId: string | null) => Promise<CheckoutSession>;
  checkoutClaim: (brokerageId: string) => Promise<CheckoutSlot>;
  checkoutRelease: (brokerageId: string) => Promise<void>;
  managementUrls: (userId: string) => Promise<ManagementUrls | null>;
};

export const CAPABILITY = {
  product: 'JODY TRACKS DEVELOPMENT ACTIVITY',
  method: 'POST { action: "status" | "offer" | "checkout" | "checkout_release" | "portal" }',
  access: 'signed-in account member; status for any member, offer / checkout / portal for the account owner only',
  writes: [],
};

/** The fields each action may carry. Anything else is a malformed request. */
const FIELDS: Record<string, string[]> = {
  status: ['action'], offer: ['action', 'partner_code'], checkout: ['action', 'plan', 'partner_code', 'terms_version'], checkout_release: ['action'], portal: ['action'],
};
/** A partner code is a long random token; its shape is checked before it is hashed, so a stray string never reaches the database. */
const PARTNER_CODE = /^[A-Za-z0-9_-]{16,128}$/;

export type Availability = 'available' | 'not_owner' | 'already_paid' | 'subscription_exists' | 'account_suspended' | 'disabled' | 'not_set_up' | 'environment_mismatch' | 'gate_not_armed';
/**
 * Who may start a checkout and why not: the ONE reading of it. A checkout is offered only where a NEW purchase is what the account needs: never bought
 * ('none'), ended ('canceled', 'expired'), or a test purchase only ('test_only', which never grants). Over a purchase that exists and may recover (paid,
 * past due, paused, trialing, unclear) it is refused, so an account is never billed twice.
 */
export function checkoutAvailability(u: BillingSummary, configured: boolean, enabled: boolean, ready: { environmentOk: boolean; gateArmed: boolean } = { environmentOk: true, gateArmed: true }): Availability {
  if (u.role !== 'owner') return 'not_owner';
  if (u.state === 'paid') return 'already_paid';
  if (u.state === 'suspended') return 'account_suspended';
  if (u.state !== 'none' && u.state !== 'canceled' && u.state !== 'expired' && u.state !== 'test_only') return 'subscription_exists';
  if (!enabled) return 'disabled';        // the kill switch: checked before Paddle's settings, so it holds whatever they are
  if (!configured) return 'not_set_up';
  // Two safety checks that make a launch impossible by accident: the function's Paddle environment must be the one the DATABASE grants for (a production
  // function never sells against a staging database, and the reverse), and the report gate must already be armed, so the day checkout opens is the day
  // an unpaid account stops being able to make reports.
  if (!ready.environmentOk) return 'environment_mismatch';
  if (!ready.gateArmed) return 'gate_not_armed';
  return 'available';
}

const REFUSALS: Record<Exclude<Availability, 'available'>, [number, Record<string, string>]> = {
  not_owner: [403, { error: 'forbidden', detail: 'owner_only' }],
  already_paid: [409, { error: 'already_paid' }],
  subscription_exists: [409, { error: 'subscription_exists' }],
  account_suspended: [403, { error: 'account_suspended' }],
  disabled: [503, { error: 'checkout_disabled' }],
  not_set_up: [503, { error: 'billing_not_set_up' }],
  environment_mismatch: [503, { error: 'billing_environment_mismatch' }],
  gate_not_armed: [503, { error: 'billing_gate_not_armed' }],
};
const PARTNER_REFUSALS: Record<string, [number, string]> = {
  LINK_INVALID: [404, 'offer_unavailable'], NOT_ENTITLED: [403, 'owner_only'], ALREADY_USED: [409, 'offer_used'], ALREADY_PAID: [409, 'already_paid'],
};

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
    const b = body as Record<string, unknown>;
    const action = typeof b.action === 'string' && Object.prototype.hasOwnProperty.call(FIELDS, b.action) ? b.action : null;
    if (!action) return reply(req, { error: 'bad_request', detail: 'action' }, 400);
    const extra = Object.keys(b).filter((k) => !FIELDS[action].includes(k));
    if (extra.length) return reply(req, { error: 'bad_request', detail: 'unknown field: ' + extra[0] }, 400);

    try {
      const summary = await deps.summaryOf(who.userId);
      if (!summary) return reply(req, { error: 'forbidden' }, 403);     // no account, no billing
      // the two database reads are made only when the switch is on and Paddle is set up: nothing about them is asked of a closed checkout
      let ready = { environmentOk: true, gateArmed: true };
      if (deps.checkoutEnabled() && deps.configured() && (action === 'status' || action === 'checkout')) {
        const [mode, armed] = await Promise.all([deps.environmentMode(), deps.gateArmed()]);
        ready = { environmentOk: (mode === 'production') === (deps.paddleEnvironment() === 'production'), gateArmed: armed };
      }
      const availability = checkoutAvailability(summary, deps.configured(), deps.checkoutEnabled(), ready);
      if (action === 'status') return reply(req, { status: 'OK', plan: dashboardPlan(summary), checkout: availability, portal: summary.role === 'owner' && summary.kind === 'recurring' && deps.apiConfigured() });

      if (action === 'checkout_release') {
        if (summary.role !== 'owner') return reply(req, { error: 'forbidden', detail: 'owner_only' }, 403);
        await deps.checkoutRelease(summary.brokerage_id).catch(() => { /* the slot frees itself in ten minutes */ });
        return reply(req, { status: 'OK' });
      }

      if (action === 'portal') {
        if (summary.role !== 'owner') return reply(req, { error: 'forbidden', detail: 'owner_only' }, 403);
        if (summary.kind !== 'recurring' || !deps.apiConfigured()) return reply(req, { error: 'portal_unavailable' }, 409);
        const urls = await deps.managementUrls(who.userId);
        if (!urls) return reply(req, { error: 'portal_unavailable' }, 409);
        return reply(req, { status: 'OK', update_payment_method: urls.update_payment_method, cancel: urls.cancel });
      }

      // offer / checkout: a partner code, when one is sent, is shape-checked and hashed here; the token itself is never stored or logged
      let tokenHash: string | null = null;
      if (b.partner_code !== undefined) {
        if (typeof b.partner_code !== 'string' || !PARTNER_CODE.test(b.partner_code)) return reply(req, { error: 'offer_unavailable' }, 404);
        tokenHash = await deps.sha256(b.partner_code);
      }

      if (action === 'offer') {
        if (tokenHash === null) return reply(req, { error: 'bad_request', detail: 'partner_code' }, 400);
        const r = await deps.partnerStart(who.userId, tokenHash, false);
        if (r.outcome !== 'OK') { const [st, e] = PARTNER_REFUSALS[r.outcome]; return reply(req, { error: e }, st); }
        return reply(req, { status: 'OK', plan: 'private_partner', eligible: true });
      }

      // checkout: an owner, not already paid, with Paddle set up
      const plan = typeof b.plan === 'string' && (PLANS as readonly string[]).includes(b.plan) ? (b.plan as PlanKey) : null;
      if (plan === null) return reply(req, { error: 'bad_request', detail: 'plan' }, 400);
      if (availability !== 'available') { const [st, e] = REFUSALS[availability]; return reply(req, e, st); }
      // THE CUSTOMER AGREES TO THE CURRENT TERMS BEFORE ANYTHING IS SIGNED: the page names the version of the Terms and Refund Policy it showed; the database
      // records the agreement only when that is the current version. No version, or a stale one, gets no checkout.
      if (typeof b.terms_version !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b.terms_version)) return reply(req, { error: 'terms_not_accepted' }, 409);
      if (plan === 'professional' && tokenHash !== null) return reply(req, { error: 'bad_request', detail: 'partner_code' }, 400);
      let enrollmentId: string | null = null;
      if (plan === 'private_partner') {
        // eligibility is the DATABASE's, from the link's hash: a price id alone never reaches this point with an enrollment
        if (tokenHash === null) return reply(req, { error: 'offer_unavailable' }, 404);
        const r = await deps.partnerStart(who.userId, tokenHash, true);
        if (r.outcome !== 'OK' || !r.enrollment_id) { const [st, e] = PARTNER_REFUSALS[r.outcome] ?? [404, 'offer_unavailable']; return reply(req, { error: e }, st); }
        enrollmentId = r.enrollment_id;
      }
      const agreed = await deps.termsAccept(who.userId, b.terms_version, plan);
      if (agreed !== 'ACCEPTED') return reply(req, { error: 'terms_not_accepted', detail: agreed === 'VERSION_STALE' ? 'terms_changed' : 'owner_only' }, agreed === 'VERSION_STALE' ? 409 : 403);
      // ONE CHECKOUT AT A TIME: the slot is claimed in the database BEFORE a session is made, so two presses (or two tabs) cannot open two checkouts.
      const slot = await deps.checkoutClaim(summary.brokerage_id);
      if (slot.outcome === 'BUSY') return reply(req, { error: 'checkout_in_progress' }, 409);
      let session: CheckoutSession;
      try {
        session = await deps.makeSession(summary.brokerage_id, plan, enrollmentId);
      } catch (e) {
        await deps.checkoutRelease(summary.brokerage_id).catch(() => { /* the slot frees itself in two minutes */ });
        throw e;
      }
      return reply(req, { status: 'OK', session });
    } catch (e) {
      if (e instanceof CheckoutUnavailable) return reply(req, { error: 'checkout_unavailable' }, 502);
      if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);
      return reply(req, { error: 'internal' }, 500);      // never the message: it can carry an id
    }
  };
}

// manage-billing — a member reads their plan, and an account OWNER starts a checkout with Paddle (Development Activity build step 11; the processor
// moved from Lemon Squeezy to Paddle on 2026-11-14). TWO OFFERS: `professional` ($78/month, 100 reports a month, recurring) and `partner` (the Private
// Partner Offer: $234 once for six months of Professional access, no renewal, INDIVIDUAL accounts only).
//
// TWO ACTIONS:
//   status    { action: "status" }     the caller's plan: its state, this month's allotment, the caller's own role, and whether the caller may start a checkout.
//   checkout  { action: "checkout", offer?: "professional" | "partner" }   an OWNER asks for a checkout for their own account (offer defaults to
//                                      professional). Returns the processor's checkout address; the page sends the
//                                      browser there. Nothing is charged, and nothing about the plan changes, by calling it: the plan changes only when the
//                                      processor's signed event arrives at development-activity-billing-webhook.
//
// WHO MAY CALL. Any signed-in person is let in, and being signed in grants nothing: the database answers only for that person's own brokerage
// (public.billing_usage, built on the one membership resolver). A person with no brokerage is refused. Only an OWNER may start a checkout (plan
// Hard Rules 40-41: the brokerage owns the account and its billing); an agent sees the plan and is told to ask their owner.
//
// WHAT IT NEVER RETURNS: the brokerage's id, a subscription id, an event, a price id, a customer, an email, a key or any processor word. The checkout address
// is an https address on HomeSignal's own approved page or on Paddle's domain (_shared/paddle-billing.ts refuses any other). The processor's settings
// are reported only as a boolean, and the one value sent to the page is Paddle's PUBLIC client-side token, which exists to be public.
//
// A CHECKOUT IS OFFERED ONLY FOR A NEW SUBSCRIPTION: to a brokerage that never subscribed, whose subscription has ended, or that has only a test one.
// Over a subscription that exists and may recover (paid, past due, paused, trialing, unclear) it is refused (409), so a brokerage is never billed twice.
//
// AND ONLY ONE CHECKOUT IS OPENED AT A TIME (audit item D, docs/da-owner-safeguards.sql part C). Before the processor is asked, the brokerage's single
// checkout slot is claimed in the database. For the next ten minutes a second press (or a second tab) is answered 409 `checkout_in_progress` and the processor
// is not asked again. The address of a checkout is never stored (the launch gate pins that no table holds one), so it cannot be handed back.
//
// This file holds the LOGIC and reads no environment and calls no network: everything external arrives through `Deps`.
import { authorizeSignedIn, corsFor, readBounded, reply, TOO_LARGE } from '../_shared/admin-gate.ts';
import type { AdminGateDeps } from '../_shared/admin-gate.ts';
import { planSummary } from '../_shared/billing-reads.ts';
import type { BillingUsage, CheckoutSlot } from '../_shared/billing-reads.ts';
import type { OfferKey } from '../_shared/paddle-billing.ts';
import { DataUnavailable } from '../_shared/service-rest.ts';

export { DataUnavailable };

/** The processor could not give a checkout. The reason is for the log, never for the browser. */
export class CheckoutUnavailable extends Error {}

export type Deps = AdminGateDeps & {
  usageOf: (userId: string) => Promise<BillingUsage | null>;
  /** 'individual' | 'brokerage' | null: whether the caller's account may be offered the one-time Private Partner grant. */
  accountTypeOf: (userId: string) => Promise<'individual' | 'brokerage' | null>;
  /** Paddle's PUBLIC client-side token and environment, for Paddle.js on the page; null when not configured. */
  clientConfig: () => { environment: 'production' | 'sandbox'; token: string } | null;
  /** Whether the processor's settings are all present. A boolean: the values never leave the server. */
  configured: () => boolean;
  /** The committed kill switch (_shared/billing-switch.ts). False refuses every checkout. */
  checkoutEnabled: () => boolean;
  createCheckout: (brokerageId: string, offer: OfferKey) => Promise<string>;
  /** The brokerage's single checkout slot (docs/da-owner-safeguards.sql, part C): one open checkout at a time. */
  checkoutClaim: (brokerageId: string) => Promise<CheckoutSlot>;
  checkoutRelease: (brokerageId: string) => Promise<void>;
};

export const CAPABILITY = {
  product: 'HOMESIGNAL DEVELOPMENT ACTIVITY',
  method: 'POST { action: "status" } | { action: "checkout", offer?: "professional" | "partner" }',
  access: 'signed-in brokerage member; status for any member, checkout for the brokerage owner only',
  writes: [],
};

/** The fields each action may carry. Anything else is a malformed request. */
const FIELDS: Record<string, string[]> = { status: ['action'], checkout: ['action', 'offer'] };
const OFFERS: readonly OfferKey[] = ['professional', 'partner'];

/**
 * Who may start a checkout and why not: the ONE reading of it, used by `status` to say so and by `checkout` to refuse. A checkout is offered only
 * where a NEW subscription is what the brokerage needs: never subscribed ('none'), a subscription that has ended ('canceled'), a one-time grant that has
 * run out ('expired'), or a test subscription only ('test_only', which never grants). Over a subscription that exists and may recover (paid, past due, paused, trialing, an unclear one) it is
 * refused, because a second checkout there would bill the brokerage twice.
 */
export function checkoutAvailability(u: BillingUsage, configured: boolean, enabled: boolean): 'available' | 'not_owner' | 'already_paid' | 'subscription_exists' | 'disabled' | 'not_set_up' {
  if (u.role !== 'owner') return 'not_owner';
  if (u.state === 'paid') return 'already_paid';
  if (u.state !== 'none' && u.state !== 'canceled' && u.state !== 'test_only' && u.state !== 'expired') return 'subscription_exists';
  if (!enabled) return 'disabled';        // the kill switch (_shared/billing-switch.ts): checked before the processor's settings, so it holds whatever they are
  if (!configured) return 'not_set_up';
  return 'available';
}

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

    // the offer is a closed list, checked with the rest of the request and before anything about billing is read
    const offer = b.offer === undefined ? 'professional' : typeof b.offer === 'string' && (OFFERS as readonly string[]).includes(b.offer) ? b.offer as OfferKey : null;
    if (offer === null) return reply(req, { error: 'bad_request', detail: 'offer' }, 400);

    try {
      const usage = await deps.usageOf(who.userId);
      if (!usage) return reply(req, { error: 'forbidden' }, 403);     // no brokerage, no billing
      const availability = checkoutAvailability(usage, deps.configured(), deps.checkoutEnabled());
      const individual = (await deps.accountTypeOf(who.userId)) === 'individual';
      if (action === 'status') {
        // the offers this person may press, in the order the page lists them; empty unless a checkout is available at all
        const offers: OfferKey[] = availability === 'available' ? (individual ? ['professional', 'partner'] : ['professional']) : [];
        return reply(req, { status: 'OK', plan: planSummary(usage), checkout: availability, offers, client: availability === 'available' ? deps.clientConfig() : null });
      }

      // checkout: an owner, not already paid, with the processor set up
      if (availability === 'not_owner') return reply(req, { error: 'forbidden', detail: 'owner_only' }, 403);
      if (availability === 'already_paid') return reply(req, { error: 'already_paid' }, 409);
      if (availability === 'subscription_exists') return reply(req, { error: 'subscription_exists' }, 409);
      if (availability === 'disabled') return reply(req, { error: 'checkout_disabled' }, 503);
      if (availability === 'not_set_up') return reply(req, { error: 'billing_not_set_up' }, 503);
      // the Private Partner Offer is an INDIVIDUAL agent's: a brokerage account is refused here, and the database refuses a grant for one regardless
      if (offer === 'partner' && !individual) return reply(req, { error: 'forbidden', detail: 'individual_only' }, 403);
      // ONE CHECKOUT AT A TIME. The slot is claimed in the database BEFORE the processor is asked, so two presses (or two tabs) cannot make two
      // checkouts: the second is told one was just opened. No slot, no checkout: a failed claim is a 502.
      const slot = await deps.checkoutClaim(usage.brokerage_id);
      if (slot.outcome === 'BUSY') return reply(req, { error: 'checkout_in_progress' }, 409);
      let url: string;
      try {
        url = await deps.createCheckout(usage.brokerage_id, offer);
      } catch (e) {
        await deps.checkoutRelease(usage.brokerage_id).catch(() => { /* the slot frees itself in two minutes */ });
        throw e;
      }
      return reply(req, { status: 'OK', url });
    } catch (e) {
      if (e instanceof CheckoutUnavailable) return reply(req, { error: 'checkout_unavailable' }, 502);
      if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);
      return reply(req, { error: 'internal' }, 500);      // never the message: it can carry an id
    }
  };
}

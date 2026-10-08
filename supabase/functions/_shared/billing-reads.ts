// THE BROKERAGE'S PLAN, as the edge functions reach it (Development Activity build step 11).
//
// The database owns every decision here (docs/brokerage-billing.sql): which state a brokerage's plan is in (derived from the payment ledger's
// latest live event), how many paid reports are left this month, and what recording a processor event does. This file only calls those functions,
// checks the shape of what comes back, turns the database's refusals into named errors, and says what a BROWSER may be told. It is the ONE place an
// edge function names billing_usage and billing_event_apply, so the report gate, the Billing function and the webhook cannot read a plan three
// different ways. It decides nothing about money and holds no secret.
//
// PURE of environment and network: the database call arrives as `rpc` (_shared/service-rest.ts).
import { DataUnavailable } from './service-rest.ts';
import type { ServiceRpc } from './service-rest.ts';
import type { LedgerEvent } from './lemon-billing.ts';

/** Where the processor brings a person back to after a checkout. It only brings them back: the page re-reads the plan, and a success URL grants nothing. */
export const BILLING_PAGE = 'https://homesignal.net/development-activity-reports.html#billing';

/** The ledger refused to bind the subscription: it already belongs to a different brokerage. */
export class BindingConflict extends Error {}
/** The checkout named an id that is no brokerage. */
export class BrokerageUnknown extends Error {}
/** The ledger refused the event itself (a key it does not know, a time with no offset): the payload was not what was expected. */
export class EventRefused extends Error {}

/** The plan states billing_plan_of can answer, exactly. Anything else from the database is a shape failure. */
export const PLAN_STATES = ['none', 'trialing', 'paid', 'past_due', 'canceled', 'unknown', 'test_only', 'suspended'] as const;
export type PlanState = typeof PLAN_STATES[number];

export type BillingUsage = {
  brokerage_id: string;
  role: 'owner' | 'agent';
  state: PlanState;
  credit_limit: number;
  credits_used: number;
  credits_remaining: number;
  period_ends_at: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isTime = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));

/**
 * What a BROWSER is told about a plan: the state and this month's figures, and the person's own role. Never the brokerage's id (it is the key of
 * a signed checkout and means nothing to the person), never an event, a subscription id, a price or a processor word.
 */
export type PlanSummary = {
  state: PlanState; role: 'owner' | 'agent' | null;
  credit_limit: number; credits_used: number; credits_remaining: number; period_ends_at: string | null;
};
export function planSummary(u: BillingUsage | null): PlanSummary {
  if (!u) return { state: 'none', role: null, credit_limit: 0, credits_used: 0, credits_remaining: 0, period_ends_at: null };
  return { state: u.state, role: u.role, credit_limit: u.credit_limit, credits_used: u.credits_used, credits_remaining: u.credits_remaining, period_ends_at: u.period_ends_at };
}

/** The checkout slot (docs/da-owner-safeguards.sql, part C): CLAIMED = make one checkout; BUSY = one was claimed in the last ten minutes, make none. */
export type CheckoutSlot = { outcome: 'CLAIMED' | 'BUSY' };

export type AppliedEvent = { outcome: 'RECORDED' | 'DUPLICATE'; bound: boolean; state: PlanState; is_latest: boolean };

export function makeBillingReads(rpc: ServiceRpc) {
  return {
    /** The signed-in person's billing, by their auth user id (never an email), or null when they belong to no brokerage. */
    async usageOf(userId: string): Promise<BillingUsage | null> {
      const { data, error } = await rpc('billing_usage', { p_user_id: userId });
      if (error) throw new DataUnavailable('billing_usage');
      if (!Array.isArray(data)) throw new DataUnavailable('shape');
      if (data.length === 0) return null;
      const u = data[0];
      if (data.length !== 1 || !u || typeof u.brokerage_id !== 'string' || !UUID.test(u.brokerage_id) || (u.role !== 'owner' && u.role !== 'agent')
          || !(PLAN_STATES as readonly string[]).includes(u.state) || !Number.isInteger(u.credit_limit) || !Number.isInteger(u.credits_used)
          || !Number.isInteger(u.credits_remaining) || u.credits_used < 0 || u.credits_remaining < 0
          || !(u.period_ends_at === null || isTime(u.period_ends_at))) {
        throw new DataUnavailable('shape');
      }
      return {
        brokerage_id: u.brokerage_id.toLowerCase(), role: u.role, state: u.state, credit_limit: u.credit_limit,
        credits_used: u.credits_used, credits_remaining: u.credits_remaining, period_ends_at: u.period_ends_at,
      };
    },

    /**
     * Take the brokerage's single checkout slot (public.billing_checkout_claim, ONE transaction, serialised per brokerage): CLAIMED means make one
     * checkout, BUSY means one was claimed in the last ten minutes and none is made. The address of a checkout is never kept anywhere. Any failure to
     * claim is DataUnavailable: no checkout is made without the slot.
     */
    async checkoutClaim(brokerageId: string): Promise<CheckoutSlot> {
      if (!UUID.test(brokerageId)) throw new DataUnavailable('checkout claim needs a brokerage id');
      const { data, error } = await rpc('billing_checkout_claim', { p_brokerage: brokerageId });
      if (error) throw new DataUnavailable('billing_checkout_claim');
      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');
      const r = data[0];
      if (r && r.outcome === 'CLAIMED' && Object.keys(r).length === 1) return { outcome: 'CLAIMED' };
      if (r && r.outcome === 'BUSY' && Object.keys(r).length === 1) return { outcome: 'BUSY' };
      throw new DataUnavailable('shape');
    },

    /** The checkout could not be made: free the slot at once. Best effort: if this fails the slot frees itself in ten minutes. */
    async checkoutRelease(brokerageId: string): Promise<void> {
      if (!UUID.test(brokerageId)) throw new DataUnavailable('checkout release needs a brokerage id');
      const { error } = await rpc('billing_checkout_release', { p_brokerage: brokerageId });
      if (error) throw new DataUnavailable('billing_checkout_release');
    },

    /**
     * Record one processor event for one brokerage, and bind its subscription to that brokerage if this is the first the database has seen of it
     * (public.billing_event_apply: ONE transaction, through the payment ledger's one writer). A retried delivery is `DUPLICATE`. The refusals are
     * named; any other failure is DataUnavailable so the webhook answers 5xx and the processor retries.
     */
    async applyEvent(brokerageId: string, event: LedgerEvent): Promise<AppliedEvent> {
      if (!UUID.test(brokerageId)) throw new BrokerageUnknown('malformed');
      const { data, error } = await rpc('billing_event_apply', { p_brokerage: brokerageId, p_event: event });
      if (error) {
        if (error.message === 'BINDING_CONFLICT') throw new BindingConflict('refused');
        if (error.message === 'BROKERAGE_UNKNOWN') throw new BrokerageUnknown('refused');
        // the ledger's own refusals are SQLSTATE 22023 with a message that names a field and never a value
        if (/^payment_event:|^billing_event_apply:/.test(error.message)) throw new EventRefused('refused');
        throw new DataUnavailable('billing_event_apply');
      }
      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');
      const r = data[0];
      if (!r || (r.outcome !== 'RECORDED' && r.outcome !== 'DUPLICATE') || typeof r.bound !== 'boolean' || typeof r.is_latest !== 'boolean'
          || !(PLAN_STATES as readonly string[]).includes(r.state)) {
        throw new DataUnavailable('shape');
      }
      return { outcome: r.outcome, bound: r.bound, state: r.state, is_latest: r.is_latest };
    },
  };
}

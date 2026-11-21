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
import type { LedgerEvent, Period, PlanKey } from './paddle-billing.ts';
import { PUBLIC_ORIGIN } from './brand-origins.generated.ts';

/** Where Paddle brings a person back to after a checkout. It only brings them back: the page re-reads the plan, and a success URL grants nothing. */
export const BILLING_PAGE = PUBLIC_ORIGIN + '/development-activity-reports.html#billing';

/** The ledger refused to bind the subscription: it already belongs to a different brokerage. */
export class BindingConflict extends Error {}
/** The checkout named an id that is no brokerage. */
export class BrokerageUnknown extends Error {}
/** The ledger refused the event itself (a key it does not know, a time with no offset): the payload was not what was expected. */
export class EventRefused extends Error {}

/** The plan states billing_plan_of can answer, exactly. Anything else from the database is a shape failure. */
export const PLAN_STATES = ['none', 'trialing', 'paid', 'past_due', 'canceled', 'unknown', 'test_only', 'suspended', 'expired'] as const;
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

export type ApplyOutcome = 'RECORDED' | 'DUPLICATE' | 'UNKNOWN_PRICE' | 'PLAN_MISMATCH' | 'UNSUPPORTED_EVENT' | 'PARTNER_NOT_ELIGIBLE' | 'NO_BINDING';
export type AppliedEvent = { outcome: ApplyOutcome; bound: boolean; state: PlanState | null; is_latest: boolean | null };

/** The dashboard's plan, exactly as public.billing_summary answers (docs/paddle-billing.sql). The brokerage id stays server-side. */
export type BillingSummary = BillingUsage & {
  plan_key: PlanKey | null; plan_label: string | null; kind: 'recurring' | 'one_time' | null; access_months: number | null;
  next_reset_at: string | null; access_ends_at: string | null; renews_at: string | null; cancel_effective_at: string | null;
};
export type DashboardPlan = {
  state: PlanState; role: 'owner' | 'agent' | null; plan_key: PlanKey | null; plan_label: string | null; kind: 'recurring' | 'one_time' | null;
  credit_limit: number; credits_used: number; credits_remaining: number;
  next_reset_at: string | null; access_ends_at: string | null; renews_at: string | null; cancel_effective_at: string | null;
};
export function dashboardPlan(u: BillingSummary | null): DashboardPlan {
  if (!u) return { state: 'none', role: null, plan_key: null, plan_label: null, kind: null, credit_limit: 0, credits_used: 0, credits_remaining: 0, next_reset_at: null, access_ends_at: null, renews_at: null, cancel_effective_at: null };
  return {
    state: u.state, role: u.role, plan_key: u.plan_key, plan_label: u.plan_label, kind: u.kind, credit_limit: u.credit_limit, credits_used: u.credits_used,
    credits_remaining: u.credits_remaining, next_reset_at: u.next_reset_at, access_ends_at: u.access_ends_at, renews_at: u.renews_at, cancel_effective_at: u.cancel_effective_at,
  };
}
export type PartnerStart = { outcome: 'OK' | 'LINK_INVALID' | 'NOT_ENTITLED' | 'ALREADY_USED' | 'ALREADY_PAID'; enrollment_id: string | null; brokerage_id: string | null };

const nullableTime = (v: unknown) => v === null || v === undefined || isTime(v);
const APPLY_OUTCOMES: readonly string[] = ['RECORDED', 'DUPLICATE', 'UNKNOWN_PRICE', 'PLAN_MISMATCH', 'UNSUPPORTED_EVENT', 'PARTNER_NOT_ELIGIBLE', 'NO_BINDING'];

function appliedFrom(data: unknown): AppliedEvent {
  if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');
  const r = data[0];
  if (!r || !APPLY_OUTCOMES.includes(r.outcome) || typeof r.bound !== 'boolean' || !(r.is_latest === null || typeof r.is_latest === 'boolean')
      || !(r.state === null || (PLAN_STATES as readonly string[]).includes(r.state))) throw new DataUnavailable('shape');
  return { outcome: r.outcome, bound: r.bound, state: r.state, is_latest: r.is_latest };
}
function refusal(error: { message: string }, fn: string): never {
  if (error.message === 'BINDING_CONFLICT') throw new BindingConflict('refused');
  if (error.message === 'BROKERAGE_UNKNOWN') throw new BrokerageUnknown('refused');
  // the ledger's own refusals are SQLSTATE 22023 with a message that names a field and never a value
  if (/^payment_event:|^billing_event_apply:|^paddle_event_apply:|^paddle_adjustment_apply:/.test(error.message)) throw new EventRefused('refused');
  throw new DataUnavailable(fn);
}

export function makeBillingReads(rpc: ServiceRpc) {
  return {
    /** The signed-in person's billing (the report gate's reader), by auth user id, or null when they belong to no brokerage. */
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

    /** The customer dashboard's reader (public.billing_summary): plan, allowance, remaining, next reset, access end, renewal. */
    async summaryOf(userId: string): Promise<BillingSummary | null> {
      const { data, error } = await rpc('billing_summary', { p_user_id: userId });
      if (error) throw new DataUnavailable('billing_summary');
      if (!Array.isArray(data)) throw new DataUnavailable('shape');
      if (data.length === 0) return null;
      const u = data[0];
      if (data.length !== 1 || !u || typeof u.brokerage_id !== 'string' || !UUID.test(u.brokerage_id) || (u.role !== 'owner' && u.role !== 'agent')
          || !(PLAN_STATES as readonly string[]).includes(u.state) || !Number.isInteger(u.credit_limit) || !Number.isInteger(u.credits_used) || !Number.isInteger(u.credits_remaining)
          || u.credits_used < 0 || u.credits_remaining < 0 || !(u.plan_key === null || u.plan_key === 'professional' || u.plan_key === 'private_partner')
          || !(u.kind === null || u.kind === 'recurring' || u.kind === 'one_time') || !nullableTime(u.next_reset_at) || !nullableTime(u.access_ends_at)
          || !nullableTime(u.renews_at) || !nullableTime(u.cancel_effective_at)) throw new DataUnavailable('shape');
      return {
        brokerage_id: u.brokerage_id.toLowerCase(), role: u.role, state: u.state, credit_limit: u.credit_limit, credits_used: u.credits_used, credits_remaining: u.credits_remaining,
        period_ends_at: u.next_reset_at ?? null, plan_key: u.plan_key ?? null, plan_label: typeof u.plan_label === 'string' ? u.plan_label : null, kind: u.kind ?? null,
        access_months: Number.isInteger(u.access_months) ? u.access_months : null, next_reset_at: u.next_reset_at ?? null, access_ends_at: u.access_ends_at ?? null,
        renews_at: u.renews_at ?? null, cancel_effective_at: u.cancel_effective_at ?? null,
      };
    },

    /** The environment this DATABASE grants for (public.billing_environment_mode): 'production' or 'staging'. Anything else is a failed read. */
    async environmentMode(): Promise<'production' | 'staging'> {
      const { data, error } = await rpc('billing_environment_mode', {});
      if (error) throw new DataUnavailable('billing_environment_mode');
      if (data !== 'production' && data !== 'staging') throw new DataUnavailable('shape');
      return data;
    },

    /** Whether paid checkout has launched in the database (public.billing_gate_state): unpaid reports are refused once it has. */
    async gateArmed(): Promise<boolean> {
      const { data, error } = await rpc('billing_gate_state', {});
      if (error) throw new DataUnavailable('billing_gate_state');
      if (!Array.isArray(data) || data.length !== 1 || typeof data[0]?.paid_required !== 'boolean') throw new DataUnavailable('shape');
      return data[0].paid_required;
    },

    /** The owner agrees to the CURRENT terms for a plan (public.billing_terms_accept). Recorded append-only; nothing is signed before this answers ACCEPTED. */
    async termsAccept(userId: string, version: string, plan: PlanKey): Promise<'ACCEPTED' | 'VERSION_STALE' | 'NOT_OWNER'> {
      const { data, error } = await rpc('billing_terms_accept', { p_user_id: userId, p_version: version, p_plan: plan });
      if (error) throw new DataUnavailable('billing_terms_accept');
      if (data !== 'ACCEPTED' && data !== 'VERSION_STALE' && data !== 'NOT_OWNER') throw new DataUnavailable('shape');
      return data;
    },

    /** The Paddle price for a plan in the configured environment (public.billing_price_for), or null when none is registered. Never a price the page names. */
    async priceFor(plan: PlanKey, livemode: boolean): Promise<string | null> {
      const { data, error } = await rpc('billing_price_for', { p_plan_key: plan, p_livemode: livemode });
      if (error) throw new DataUnavailable('billing_price_for');
      return typeof data === 'string' && /^pri_[0-9a-z]{20,40}$/.test(data) ? data : null;
    },

    /** Whether this person's account may buy the private partner offer with this link (hash), and with write=true, the enrollment the signed checkout names. */
    async partnerStart(userId: string, tokenHash: string, write: boolean): Promise<PartnerStart> {
      const { data, error } = await rpc('partner_enrollment_start', { p_user_id: userId, p_token_hash: tokenHash, p_create: write });
      if (error) throw new DataUnavailable('partner_enrollment_start');
      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');
      const r = data[0];
      if (!r || !['OK', 'LINK_INVALID', 'NOT_ENTITLED', 'ALREADY_USED', 'ALREADY_PAID'].includes(r.outcome)
          || !(r.enrollment_id === null || (typeof r.enrollment_id === 'string' && UUID.test(r.enrollment_id)))
          || !(r.brokerage_id === null || (typeof r.brokerage_id === 'string' && UUID.test(r.brokerage_id)))) throw new DataUnavailable('shape');
      return { outcome: r.outcome, enrollment_id: r.enrollment_id, brokerage_id: r.brokerage_id };
    },

    /** The owner's recurring subscription id, for the billing-management addresses. Server-side only. */
    async portalRef(userId: string): Promise<{ subscription_ref: string; livemode: boolean } | null> {
      const { data, error } = await rpc('billing_portal_ref', { p_user_id: userId });
      if (error) throw new DataUnavailable('billing_portal_ref');
      if (!Array.isArray(data)) throw new DataUnavailable('shape');
      if (data.length === 0) return null;
      const r = data[0];
      if (data.length !== 1 || !r || typeof r.subscription_ref !== 'string' || !/^sub_[0-9a-z]{20,40}$/.test(r.subscription_ref) || typeof r.livemode !== 'boolean') throw new DataUnavailable('shape');
      return { subscription_ref: r.subscription_ref, livemode: r.livemode };
    },

    /** The brokerage's single checkout slot (public.billing_checkout_claim): CLAIMED = open one checkout, BUSY = one was opened in the last ten minutes. */
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

    /** The checkout was closed without paying: free the slot at once. Best effort: it frees itself in ten minutes. */
    async checkoutRelease(brokerageId: string): Promise<void> {
      if (!UUID.test(brokerageId)) throw new DataUnavailable('checkout release needs a brokerage id');
      const { error } = await rpc('billing_checkout_release', { p_brokerage: brokerageId });
      if (error) throw new DataUnavailable('billing_checkout_release');
    },

    /** Record one verified Paddle subscription / one-time transaction event for the account a SIGNED checkout named (public.paddle_event_apply). */
    async applyEvent(brokerageId: string, plan: PlanKey, enrollmentId: string | null, event: LedgerEvent, period: Period | null): Promise<AppliedEvent> {
      if (!UUID.test(brokerageId)) throw new BrokerageUnknown('malformed');
      const { data, error } = await rpc('paddle_event_apply', { p_brokerage: brokerageId, p_event: event, p_plan: plan, p_enrollment: enrollmentId, p_period: period });
      if (error) refusal(error, 'paddle_event_apply');
      return appliedFrom(data);
    },

    /** Record a FULL refund / chargeback against the binding it refers to (public.paddle_adjustment_apply). */
    async applyRefund(event: LedgerEvent): Promise<AppliedEvent> {
      const { data, error } = await rpc('paddle_adjustment_apply', { p_event: event });
      if (error) refusal(error, 'paddle_adjustment_apply');
      return appliedFrom(data);
    },

    /** A verified payment event whose checkout carried no valid signature: kept (opaque ids only) so the operator can refund it. Never granted. */
    async recordUnbound(event: LedgerEvent): Promise<void> {
      const { error } = await rpc('paddle_unmatched_record', { p_event: event, p_reason: 'NO_ACCOUNT' });
      if (error) throw new DataUnavailable('paddle_unmatched_record');
    },
  };
}

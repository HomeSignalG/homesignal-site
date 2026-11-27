-- ============================================================================
-- PADDLE BILLING  (replaces Lemon Squeezy as the payment processor — founder, 2026-11-16)
-- SQL OF RECORD. Additive. Apply through the approved runner (db-sql.yml) or apply_migration from this committed file; never as a rolled-back
-- dry run against production (CLAUDE.md §7.11). Stands on docs/brokerage-billing.sql (and everything that file stands on).
--
-- WHAT IT DOES
--   Adds the Paddle processor to the billing design that already exists, without a second truth path:
--     payment ledger (public.payment_event) -> brokerage binding (public.brokerage_subscription) -> billing_plan_of (state, DERIVED)
--       -> brokerage_report_issue (which allotment) -> brokerage_paid_credit (100 a month, a constraint) -> billing_summary (the dashboard).
--   * public.payment_event_map_status   gains a 'paddle' branch (the lemonsqueezy branch stays: three historical test events and one test binding
--                                       are recorded under it and are never deleted).
--   * public.billing_plan_price         the ONE table that says what a Paddle price id IS: plan, kind (recurring / one_time), months of access.
--                                       Keyed by (price_ref, livemode): a sandbox price can never be a live plan.
--   * public.billing_plan_of            replaced, same signature: a ONE-TIME plan is paid only until bound_at + access_months ('expired' after);
--                                       a partner enrollment marked failed is 'suspended'. A refund or cancellation is the latest ledger event.
--   * public.paddle_event_apply         the webhook's writer for subscription / transaction events (price check, plan check, partner check,
--                                       then billing_event_apply). public.paddle_adjustment_apply records a FULL REFUND against the binding.
--   * public.billing_period_observation append-only record of renewal / cancellation dates the dashboard shows. Times only.
--   * public.paddle_unmatched_event     append-only list of verified Paddle events that granted nothing, with the reason. Opaque ids only.
--   * Private partner offer: partner_brokerage, partner_link (token HASH only), partner_enrollment, partner_offer_check / _enrollment_start /
--     _verification_due / _enrollment_verify. Eligibility is decided HERE, server-side; a price id alone grants nothing.
--   * public.billing_summary            the ONE reader for the customer dashboard (plan, allowance, remaining, next reset, access end, renewal).
--
-- RULES (each pinned by test/paddle_billing_pg)
--   1. PAID ONLY FROM A SERVER-VERIFIED PAYMENT EVENT of a LIVE delivery. Sandbox / test deliveries are recorded and never grant.
--   2. A price id that is not in billing_plan_price, or a plan that differs from the one the signed checkout named, grants nothing.
--   3. The PRIVATE PARTNER price grants only for an account with a valid, unexpired, not-full partner link, with a brokerage that is active, once
--      per account, and never while the enrollment is marked failed.
--   4. Six months = SIX monthly allotments of 100 (period index 0..5 from the binding), no rollover, then 'expired'. No renewal exists for it.
--   5. A FULL refund (Paddle adjustment, action refund, approved) is the latest event and revokes at once. A partial refund changes nothing.
--   6. Cancelling a subscription: Paddle keeps it 'active' until the end of the paid period and only then sends canceled, so paid access
--      runs to the end of the period by construction. The scheduled end is stored (billing_period_observation) so the dashboard can say so.
--   7. Nothing personal is stored: no email, name, card, address, Paddle customer id, amount or free text. Opaque ids and times only.
--   8. Events are idempotent (the ledger's unique key is Paddle's own event_id) and out-of-order safe (the ledger orders by Paddle's occurred_at).
--
--   9. THE ENVIRONMENT DECIDES WHAT GRANTS (founder, 2026-11-16, decision 4). A database has ONE mode, public.billing_environment: 'production' grants only
--      livemode=true (real) payments and treats every sandbox payment as 'test_only'; an ISOLATED STAGING database ('staging') grants only livemode=false
--      (sandbox) payments, so the Paddle sandbox end-to-end test can show a paid plan without ever touching production. The mode cannot be changed through
--      any API role, and a trigger refuses to change it once the database holds a payment of the other kind (a production database that has taken a real
--      payment can never be switched to staging, and the reverse).
--  10. NO FREE PLAN (founder, 2026-11-16, decision 1). New evaluations are created with NO free reports (evaluation.free_reports_granted defaults to false;
--      the five that exist keep true and are listed for review). public.billing_gate says whether paid checkout has launched: once armed, every unpaid
--      report is refused (PAID_PLAN_REQUIRED) unless the operator has chosen to honour the already-granted free reports. Reports already made are never touched.
--  11. TERMS BEFORE PURCHASE (decision 3). A checkout is signed only after the owner's acceptance of the CURRENT terms version is recorded (append-only).
--  12. PARTNER RE-VERIFICATION (decision 2): every 30 days by default, configurable per partner brokerage. An overdue check is FLAGGED for manual review and
--      never suspends access; only a confirmed 'failed' check suspends.
--
-- ADDITIVE ONLY. Creates 12 tables, 2 indexes, and the functions below; replaces payment_event_map_status and billing_plan_of with the same
-- signatures. Seeds the two LIVE price ids read from the Paddle API on 2026-11-16. Idempotent. ROLLBACK at the foot.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ---------------------------------------------------------------------
do $pre$
declare f text;
begin
  foreach f in array array['public.billing_plan_of(uuid)', 'public.billing_event_apply(uuid, jsonb)', 'public.billing_period_index(timestamptz, timestamptz)',
                           'public.billing_period_end(timestamptz, integer)', 'public.brokerage_membership_of(uuid)', 'public.payment_event_map_status(text, text)',
                           'public.payment_event_opaque_ok(text)', 'public.billing_append_only()'] loop
    if to_regprocedure(f) is null then
      raise exception 'paddle_billing: % is missing. Apply docs/brokerage-billing.sql (and what it stands on) first', f;
    end if;
  end loop;
  if to_regclass('public.brokerage_subscription') is null or to_regclass('public.payment_event') is null then
    raise exception 'paddle_billing: apply docs/brokerage-billing.sql first';
  end if;
end $pre$;

-- ---- 1. THE STATUS MAPPING: the paddle branch ------------------------------------------------------------
-- Subscription statuses are Paddle's own. 'completed' is a one-time TRANSACTION's status (the only word that pays); 'refunded' is what a full
-- refund records against the subscription or transaction it refunded. Anything else is 'unknown', which never grants.
create or replace function public.payment_event_map_status(p_processor text, p_status text) returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case
    when p_processor = 'lemonsqueezy' then
      case p_status
        when 'on_trial'  then 'trialing'
        when 'active'    then 'active'
        when 'paused'    then 'paused'
        when 'past_due'  then 'past_due'
        when 'unpaid'    then 'unpaid'
        when 'cancelled' then 'canceled'
        when 'expired'   then 'canceled'
        else 'unknown'
      end
    when p_processor = 'paddle' then
      case p_status
        when 'trialing'  then 'trialing'
        when 'active'    then 'active'
        when 'completed' then 'active'
        when 'paused'    then 'paused'
        when 'past_due'  then 'past_due'
        when 'canceled'  then 'canceled'
        when 'refunded'  then 'canceled'
        else 'unknown'
      end
    else 'unknown'
  end
$$;

-- ---- 2. WHAT A PRICE IS ---------------------------------------------------------------------------------
create table if not exists public.billing_plan_price (
  price_ref         text        not null,
  livemode          boolean     not null,
  plan_key          text        not null,
  plan_label        text        not null,
  kind              text        not null,
  access_months     integer,
  reports_per_month integer     not null default 100,
  active            boolean     not null default true,
  added_at          timestamptz not null default now(),
  constraint billing_plan_price_pkey   primary key (price_ref, livemode),
  constraint billing_plan_price_ref    check (public.payment_event_opaque_ok(price_ref)),
  constraint billing_plan_price_key    check (plan_key in ('professional', 'private_partner')),
  constraint billing_plan_price_kind   check (kind in ('recurring', 'one_time')),
  constraint billing_plan_price_months check ((kind = 'one_time') = (access_months is not null) and (access_months is null or access_months between 1 and 36)),
  constraint billing_plan_price_limit  check (reports_per_month = public.billing_report_limit())
);
-- The LIVE prices, read from the Paddle API (GET /products?include=prices, 2026-11-16): neither has a trial period.
-- Sandbox prices differ per environment: add them with livemode = false when the sandbox catalogue is created (see docs/paddle-billing-2026-11-16.md).
insert into public.billing_plan_price (price_ref, livemode, plan_key, plan_label, kind, access_months) values
  ('pri_01m7d6kede6hqr2kh9b78mb25j', true, 'professional',    'Professional',          'recurring', null),
  ('pri_01m7d6q4yw2yzygm5cz92s5abg', true, 'private_partner', 'Private Partner Offer', 'one_time',  6)
on conflict (price_ref, livemode) do nothing;

-- the one price a customer is offered for a plan, in the configured environment
create or replace function public.billing_price_for(p_plan_key text, p_livemode boolean) returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select p.price_ref from public.billing_plan_price p where p.plan_key = p_plan_key and p.livemode = p_livemode and p.active order by p.added_at, p.price_ref limit 1 $$;

-- the price a binding was bought with: the first event of that subscription / transaction that named one
create or replace function public.billing_binding_price(p_processor text, p_livemode boolean, p_ref text) returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select x.variant_ref from public.payment_event x
   where x.processor = p_processor and x.livemode = p_livemode and x.subscription_ref = p_ref and x.variant_ref is not null
   order by x.occurred_at, x.event_id limit 1
$$;

-- ---- 2b. WHICH ENVIRONMENT THIS DATABASE GRANTS FOR (decision 4) ----------------------------------------------------------
-- ONE row. 'production' (the default): only a LIVE (livemode = true) payment grants; a sandbox payment is recorded and is 'test_only'. 'staging': this is
-- an ISOLATED database made for the Paddle sandbox end-to-end test; only a SANDBOX (livemode = false) payment grants, and a live one never does. No API
-- role can read or write it. The trigger below refuses to change the mode once the database holds a payment of the other kind, so a production database
-- that has taken a real payment can never be switched, and a staging one that holds sandbox payments cannot become production.
create table if not exists public.billing_environment (
  singleton boolean     primary key default true,
  mode      text        not null default 'production',
  set_at    timestamptz not null default now(),
  constraint billing_environment_one  check (singleton),
  constraint billing_environment_mode check (mode in ('production', 'staging'))
);
insert into public.billing_environment (singleton, mode) values (true, 'production') on conflict do nothing;

create or replace function public.billing_environment_guard() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if tg_op <> 'UPDATE' then raise exception 'billing_environment: the row is never deleted or truncated' using errcode = '55000'; end if;
  if new.singleton is distinct from old.singleton then raise exception 'billing_environment: identity cannot change' using errcode = '55000'; end if;
  if new.mode <> old.mode then
    -- 'production' holds LIVE payments (livemode = true); 'staging' holds SANDBOX payments (livemode = false)
    if exists (select 1 from public.brokerage_subscription s where s.livemode = (old.mode = 'production'))
       or exists (select 1 from public.payment_event e where e.livemode = (old.mode = 'production')) then
      raise exception 'billing_environment: this database already holds % payments, so its mode cannot be changed', case when old.mode = 'production' then 'live' else 'sandbox' end
        using errcode = '55000';
    end if;
    new.set_at := now();
  end if;
  return new;
end $$;
drop trigger if exists billing_environment_guard on public.billing_environment;
create trigger billing_environment_guard before update on public.billing_environment for each row execute function public.billing_environment_guard();
drop trigger if exists billing_environment_no_delete on public.billing_environment;
create trigger billing_environment_no_delete before delete or truncate on public.billing_environment for each statement execute function public.billing_environment_guard();

-- true: this database grants for LIVE payments (production). false: it grants for SANDBOX payments (isolated staging).
create or replace function public.billing_grants_livemode() returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce((select e.mode = 'production' from public.billing_environment e), true) $$;
create or replace function public.billing_environment_mode() returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce((select e.mode from public.billing_environment e), 'production') $$;

-- A payment of the kind this database grants for must not be bound the other way round by the guard on a paid credit (replaced, same signature).
create or replace function public.brokerage_paid_credit_guard() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare
  b public.brokerage_subscription%rowtype;
begin
  select s.* into b from public.brokerage_subscription s where s.binding_id = new.binding_id;
  if not found or b.livemode is distinct from public.billing_grants_livemode() or b.brokerage_id <> new.brokerage_id then
    raise exception 'brokerage_paid_credit: a paid credit needs a subscription binding of the same brokerage, made in the environment this database grants for' using errcode = '55000';
  end if;
  new.period_index := public.billing_period_index(b.bound_at, now());
  new.issued_at    := now();
  return new;
end $$;

-- ---- 2c. NO FREE PLAN: the gate, and who still holds free reports (decision 1) -----------------------------------------------
-- evaluation.free_reports_granted says whether this account was ever PROMISED free reports. Every existing evaluation keeps true (that is the review
-- list: select * from public.billing_free_reports_review()); every NEW evaluation, by any path, defaults to false, so no new free credit is issued.
alter table public.evaluation add column if not exists free_reports_granted boolean not null default true;
alter table public.evaluation alter column free_reports_granted set default false;

-- ONE row. paid_required: paid checkout has launched, so an unpaid report is refused. honor_granted_free_reports: the operator's reviewed choice to keep
-- letting accounts that were promised free reports use what they have left (default false: the founder's instruction is no unpaid generation).
-- Changing it is a SQL act by the owner (no API role can), and every change is logged (append-only).
create table if not exists public.billing_gate (
  singleton                 boolean     primary key default true,
  paid_required             boolean     not null default false,
  honor_granted_free_reports boolean    not null default false,
  armed_at                  timestamptz,
  constraint billing_gate_one check (singleton),
  constraint billing_gate_armed check ((paid_required) = (armed_at is not null))
);
insert into public.billing_gate (singleton) values (true) on conflict do nothing;
create table if not exists public.billing_gate_log (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  paid_required boolean not null,
  honor_granted_free_reports boolean not null
);
create or replace function public.billing_gate_set(p_paid_required boolean, p_honor_granted_free_reports boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.billing_gate g set paid_required = p_paid_required, honor_granted_free_reports = coalesce(p_honor_granted_free_reports, false),
         armed_at = case when p_paid_required then coalesce(g.armed_at, now()) else null end;
  insert into public.billing_gate_log (paid_required, honor_granted_free_reports) values (p_paid_required, coalesce(p_honor_granted_free_reports, false));
end $$;
create or replace function public.billing_gate_state() returns table (paid_required boolean, honor_granted_free_reports boolean)
language sql stable security definer set search_path = public, pg_temp
as $$ select g.paid_required, g.honor_granted_free_reports from public.billing_gate g $$;

-- NAMED COMPLIMENTARY ACCESS (founder, 2026-11-27): an exception for ONE named account, never a plan. Every row carries the reason and who approved it, may carry
-- an expiry (null = no expiry, a founder choice recorded as such), and can only be ended by setting revoked_at (append-only otherwise). It is not a $0 Paddle
-- checkout and it never changes billing_gate: every account without a row still has to pay. Set by the database owner in SQL (no API role can), like the gate.
create table if not exists public.billing_complimentary (
  id           bigint generated always as identity primary key,
  brokerage_id uuid        not null references public.brokerage_account (id),
  reason       text        not null,
  approved_by  text        not null,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  constraint billing_complimentary_reason check (length(btrim(reason)) >= 8),
  constraint billing_complimentary_approver check (length(btrim(approved_by)) >= 3)
);
create unique index if not exists billing_complimentary_one_open on public.billing_complimentary (brokerage_id) where revoked_at is null;
create or replace function public.billing_complimentary_guard() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if tg_op <> 'UPDATE' then raise exception 'billing_complimentary: rows are never deleted or truncated (revoke instead)' using errcode = '55000'; end if;
  if old.revoked_at is not null or new.revoked_at is null
     or (new.id, new.brokerage_id, new.reason, new.approved_by, new.expires_at, new.created_at) is distinct from (old.id, old.brokerage_id, old.reason, old.approved_by, old.expires_at, old.created_at) then
    raise exception 'billing_complimentary: the only change allowed is revoking an open row' using errcode = '55000';
  end if;
  return new;
end $$;
drop trigger if exists billing_complimentary_guard on public.billing_complimentary;
create trigger billing_complimentary_guard before update on public.billing_complimentary for each row execute function public.billing_complimentary_guard();
drop trigger if exists billing_complimentary_no_delete on public.billing_complimentary;
create trigger billing_complimentary_no_delete before delete or truncate on public.billing_complimentary for each statement execute function public.billing_complimentary_guard();

create or replace function public.billing_complimentary_active(p_brokerage uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.billing_complimentary c
                  where c.brokerage_id = p_brokerage and c.revoked_at is null and (c.expires_at is null or c.expires_at > now()))
$$;
create or replace function public.billing_complimentary_grant(p_brokerage uuid, p_reason text, p_approved_by text, p_expires_at timestamptz default null) returns bigint
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id bigint;
begin
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'billing_complimentary: the expiry must be in the future' using errcode = '22023'; end if;
  insert into public.billing_complimentary (brokerage_id, reason, approved_by, expires_at) values (p_brokerage, p_reason, p_approved_by, p_expires_at) returning id into v_id;
  return v_id;
end $$;
create or replace function public.billing_complimentary_revoke(p_brokerage uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare n integer;
begin
  update public.billing_complimentary c set revoked_at = now() where c.brokerage_id = p_brokerage and c.revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- May this evaluation's FREE reports still be used? Only if the account was promised them and either checkout has not launched or the operator chose to honour them,
-- OR the account holds an open, unexpired named complimentary row. Nothing else widens it.
create or replace function public.billing_free_reports_usable(p_evaluation uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((select (e.free_reports_granted and (not g.paid_required or g.honor_granted_free_reports)) or public.billing_complimentary_active(e.brokerage_id)
                     from public.evaluation e cross join public.billing_gate g where e.evaluation_id = p_evaluation), false)
$$;

-- The review list (counts and opaque ids only): every account that was promised free reports, what it used and what is left.
create or replace function public.billing_free_reports_review()
returns table (brokerage_id uuid, evaluation_status text, credits_used integer, credits_left integer, granted_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select e.brokerage_id, e.status, u.n, greatest(public.evaluation_report_limit() - u.n, 0), e.created_at
    from public.evaluation e
    cross join lateral (select count(*)::integer n from public.evaluation_credit c where c.evaluation_id = e.evaluation_id) u
   where e.free_reports_granted order by e.created_at
$$;

-- The member's usage as the workspace reads it: when the free reports may not be used, there are none to show. The count already made is unchanged.
create or replace function public.evaluation_usage(p_user_id uuid)
returns table (evaluation_id uuid, status text, credit_limit integer, credits_used integer, credits_remaining integer,
               expires_at timestamptz, expired boolean)
language sql stable security definer set search_path = public, pg_temp
as $$
  select e.evaluation_id, e.status,
         case when public.billing_free_reports_usable(e.evaluation_id) then public.evaluation_report_limit() else u.n end,
         u.n,
         case when public.billing_free_reports_usable(e.evaluation_id) then greatest(public.evaluation_report_limit() - u.n, 0) else 0 end,
         e.expires_at, (e.expires_at is not null and e.expires_at <= now())
    from public.brokerage_membership_of(p_user_id) r
    join public.evaluation e on e.brokerage_id = r.brokerage_id
    cross join lateral (select count(*)::integer as n from public.evaluation_credit c where c.evaluation_id = e.evaluation_id) u
$$;

-- THE GATE ITSELF: spliced into brokerage_report_issue (the ONE way a member's report is stored) from its LIVE definition, never retyped. A report is refused
-- (EV013 PAID_PLAN_REQUIRED, nothing stored, nothing charged) when the plan is not paid and the free reports may not be used. A retried key of a report already
-- made returns that report, as before. Fail-closed: the anchor must appear exactly once, or the splice is already in.
do $gate$
declare
  f      constant text := 'public.brokerage_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)';
  anchor constant text := E'  select p.* into pl from public.billing_plan_of(m.brokerage_id) p;\n';
  def    text;
  n      integer;
begin
  def := pg_get_functiondef(to_regprocedure(f)::oid);
  if def like '%PAID_PLAN_REQUIRED%' then return; end if;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'paddle_billing: brokerage_report_issue holds the plan lookup % times (expected exactly 1); refusing to splice', n; end if;
  execute replace(def, anchor, anchor ||
    E'  if pl.state is distinct from ''paid''\n' ||
    E'     and not exists (select 1 from public.evaluation_credit c where c.evaluation_id = ev.evaluation_id and c.idempotency_key = p_idempotency_key)\n' ||
    E'     and not public.billing_free_reports_usable(ev.evaluation_id) then\n' ||
    E'    raise exception using errcode = ''EV013'', message = ''PAID_PLAN_REQUIRED'';\n' ||
    E'  end if;\n');
  if pg_get_functiondef(to_regprocedure(f)::oid) not like '%PAID_PLAN_REQUIRED%' then raise exception 'paddle_billing: the gate splice did not take'; end if;
end $gate$;

-- billing_check()'s test-binding invariant must follow the environment (a sandbox credit in isolated staging is correct, a live one there is the violation).
do $chk$
declare
  f      constant text := 'public.billing_check()';
  anchor constant text := 'where not b.livemode';
  def    text;
  n      integer;
begin
  def := pg_get_functiondef(to_regprocedure(f)::oid);
  if def like '%billing_grants_livemode%' then return; end if;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'paddle_billing: billing_check holds the test-binding test % times (expected exactly 1); refusing to splice', n; end if;
  execute replace(def, anchor, 'where b.livemode is distinct from public.billing_grants_livemode()');
end $chk$;

-- ---- 2d. TERMS BEFORE PURCHASE (decision 3) ----------------------------------------------------------------------------------
-- The terms version a purchaser must have accepted is a row, not a code constant, so Terms and the database cannot drift without a visible change.
create table if not exists public.billing_terms_version (
  version      text        primary key,
  effective_at timestamptz not null default now(),
  constraint billing_terms_version_shape check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
insert into public.billing_terms_version (version, effective_at) values ('2026-11-16', '2026-11-16 00:00:00+00') on conflict do nothing;
-- 2026-11-27: refund wording changed (Paddle handles refunds and billing questions; HomeSignal does not). The earlier row stays (acceptances reference it); the newest effective row is current.
insert into public.billing_terms_version (version, effective_at) values ('2026-11-27', '2026-11-27 00:00:00+00') on conflict do nothing;
create or replace function public.billing_terms_current() returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select t.version from public.billing_terms_version t where t.effective_at <= now() order by t.effective_at desc, t.version desc limit 1 $$;

-- APPEND-ONLY. The ACCOUNT that agreed, the plan, the version and the time: no person, email, address or text.
create table if not exists public.billing_terms_acceptance (
  id           bigint      generated always as identity primary key,
  brokerage_id uuid        not null references public.brokerage_account (id),
  plan_key     text        not null,
  terms_version text       not null references public.billing_terms_version (version),
  accepted_at  timestamptz not null default now(),
  constraint billing_terms_acceptance_plan check (plan_key in ('professional', 'private_partner'))
);
create index if not exists billing_terms_acceptance_by_account on public.billing_terms_acceptance (brokerage_id, plan_key, accepted_at desc);

-- The OWNER agrees to the CURRENT terms for a plan. ACCEPTED | VERSION_STALE (the page showed an older version) | NOT_OWNER. A checkout is signed only after ACCEPTED.
create or replace function public.billing_terms_accept(p_user_id uuid, p_version text, p_plan text) returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare m record;
begin
  select r.* into m from public.brokerage_membership_of(p_user_id) r;
  if not found or m.role <> 'owner' then return 'NOT_OWNER'; end if;
  if p_plan not in ('professional', 'private_partner') or p_version is distinct from public.billing_terms_current() then return 'VERSION_STALE'; end if;
  insert into public.billing_terms_acceptance (brokerage_id, plan_key, terms_version) values (m.brokerage_id, p_plan, p_version);
  return 'ACCEPTED';
end $$;

-- ---- 3. DATES THE DASHBOARD SHOWS, AND VERIFIED EVENTS THAT GRANTED NOTHING (both append-only) -------------
create table if not exists public.billing_period_observation (
  obs_id            bigint      generated always as identity primary key,
  processor         text        not null,
  livemode          boolean     not null,
  subscription_ref  text        not null,
  occurred_at       timestamptz not null,
  next_billed_at    timestamptz,
  period_ends_at    timestamptz,
  cancel_effective_at timestamptz,
  recorded_at       timestamptz not null default now(),
  constraint billing_period_observation_ref check (public.payment_event_opaque_ok(subscription_ref))
);
create index if not exists billing_period_observation_latest on public.billing_period_observation (processor, livemode, subscription_ref, occurred_at desc, obs_id desc);

create table if not exists public.paddle_unmatched_event (
  id               bigint      generated always as identity primary key,
  idempotency_key  text        not null unique,
  event_name       text        not null,
  reason           text        not null,
  price_ref        text,
  subject_ref      text,
  livemode         boolean     not null,
  occurred_at      timestamptz,
  recorded_at      timestamptz not null default now(),
  constraint paddle_unmatched_key    check (public.payment_event_opaque_ok(idempotency_key)),
  constraint paddle_unmatched_name   check (public.payment_event_opaque_ok(event_name)),
  constraint paddle_unmatched_reason check (reason in ('UNKNOWN_PRICE', 'PLAN_MISMATCH', 'PARTNER_NOT_ELIGIBLE', 'UNSUPPORTED_EVENT', 'NO_BINDING', 'NO_ACCOUNT', 'TEST_PRICE_LIVE_EVENT')),
  constraint paddle_unmatched_price  check (price_ref is null or public.payment_event_opaque_ok(price_ref)),
  constraint paddle_unmatched_subj   check (subject_ref is null or public.payment_event_opaque_ok(subject_ref))
);

-- ---- 4. THE PRIVATE PARTNER OFFER -----------------------------------------------------------------------
create table if not exists public.partner_brokerage (
  partner_id  uuid        primary key default gen_random_uuid(),
  name        text        not null,
  status      text        not null default 'active',
  verification_interval_days integer not null default 30,
  created_at  timestamptz not null default now(),
  constraint partner_brokerage_interval check (verification_interval_days between 1 and 365),
  constraint partner_brokerage_name   check (btrim(name) <> ''),
  constraint partner_brokerage_status check (status in ('active', 'inactive'))
);
-- A link is its sha-256 (hex) and nothing else: the token itself is shown once to the operator and never stored.
create table if not exists public.partner_link (
  link_id         uuid        primary key default gen_random_uuid(),
  partner_id      uuid        not null references public.partner_brokerage (partner_id),
  token_hash      text        not null unique,
  active          boolean     not null default true,
  expires_at      timestamptz,
  max_redemptions integer     not null default 100,
  created_at      timestamptz not null default now(),
  constraint partner_link_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint partner_link_max  check (max_redemptions between 1 and 10000)
);
create table if not exists public.partner_enrollment (
  enrollment_id        uuid        primary key default gen_random_uuid(),
  account_id           uuid        not null references public.brokerage_account (id),
  link_id              uuid        not null references public.partner_link (link_id),
  partner_id           uuid        not null references public.partner_brokerage (partner_id),
  binding_id           uuid        references public.brokerage_subscription (binding_id),
  created_at           timestamptz not null default now(),
  verification_status  text        not null default 'pending',
  last_verified_at     timestamptz,
  next_verification_at timestamptz,
  constraint partner_enrollment_status check (verification_status in ('pending', 'verified', 'failed'))
);
-- One partner purchase per account, and a binding belongs to one enrollment.
create unique index if not exists partner_enrollment_one_paid_per_account on public.partner_enrollment (account_id) where binding_id is not null;
create unique index if not exists partner_enrollment_binding on public.partner_enrollment (binding_id) where binding_id is not null;

-- ---- 5. THE PLAN STATE (replaced; same signature) ---------------------------------------------------------
-- As before, plus: a one-time plan is paid only until bound_at + access_months ('expired' afterwards, derived, never stored), and an enrollment an
-- operator marked failed is 'suspended'. A binding with no billing_plan_price row (the historical Lemon Squeezy test binding) behaves exactly as before.
create or replace function public.billing_plan_of(p_brokerage uuid)
returns table (binding_id uuid, livemode boolean, bound_at timestamptz, processor_status text, mapped_status text, occurred_at timestamptz, state text)
language sql stable security definer set search_path = public, pg_temp
as $$
  with b as (
    select s.binding_id, s.processor, s.subscription_ref, s.livemode, s.bound_at
      from public.brokerage_subscription s
     where s.brokerage_id = p_brokerage
     order by (s.livemode = public.billing_grants_livemode()) desc, s.bound_at desc, s.binding_id
     limit 1)
  select b.binding_id, b.livemode, b.bound_at, e.processor_status, e.mapped_status, e.occurred_at,
         case
           when not exists (select 1 from public.brokerage_account a where a.id = p_brokerage and a.status = 'active') then 'suspended'
           when b.livemode is distinct from public.billing_grants_livemode() then 'test_only'
           when exists (select 1 from public.partner_enrollment pe where pe.binding_id = b.binding_id and pe.verification_status = 'failed') then 'suspended'
           when e.mapped_status = 'active' and pp.kind = 'one_time'
                and now() >= ((b.bound_at at time zone 'UTC') + pp.access_months * interval '1 month') at time zone 'UTC' then 'expired'
           when e.mapped_status = 'active' then 'paid'
           when e.mapped_status is null then 'none'
           when e.mapped_status = 'trialing' then 'trialing'
           when e.mapped_status in ('paused', 'past_due', 'unpaid') then 'past_due'
           when e.mapped_status = 'canceled' then 'canceled'
           else 'unknown'
         end
    from b
    left join public.payment_event e on e.event_id = public.payment_event_latest_id(b.processor, b.livemode, b.subscription_ref)
    left join public.billing_plan_price pp on pp.livemode = b.livemode and pp.price_ref = public.billing_binding_price(b.processor, b.livemode, b.subscription_ref)
$$;

-- ---- 6. THE WEBHOOK'S WRITERS ------------------------------------------------------------------------------
create or replace function public.paddle_unmatched_record(p_event jsonb, p_reason text) returns void
language sql security definer set search_path = public, pg_temp
as $$
  insert into public.paddle_unmatched_event (idempotency_key, event_name, reason, price_ref, subject_ref, livemode, occurred_at)
  values (p_event ->> 'idempotency_key', coalesce(p_event ->> 'event_name', 'unknown'), p_reason,
          nullif(p_event ->> 'variant_ref', ''), nullif(p_event ->> 'subscription_ref', ''), coalesce((p_event ->> 'livemode')::boolean, false),
          (p_event ->> 'occurred_at')::timestamptz)
  on conflict (idempotency_key) do nothing
$$;

-- A subscription event or a one-time transaction.completed for a brokerage a SIGNED checkout named. p_plan is the plan that signed checkout named;
-- p_enrollment is the partner enrollment it named (null for Professional); p_period carries Paddle's dates ({next_billed_at, period_ends_at, cancel_effective_at}).
-- Returns outcome RECORDED | DUPLICATE, or one of the refusal words below (nothing is granted, and the event is kept in paddle_unmatched_event).
create or replace function public.paddle_event_apply(p_brokerage uuid, p_event jsonb, p_plan text, p_enrollment uuid, p_period jsonb)
returns table (outcome text, event_id bigint, is_latest boolean, bound boolean, state text)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_live  boolean;
  v_price text;
  v_name  text;
  v_ref   text;
  pp      public.billing_plan_price%rowtype;
  en      public.partner_enrollment%rowtype;
  lk      public.partner_link%rowtype;
  r       record;
  v_bind  uuid;
begin
  if jsonb_typeof(p_event) is distinct from 'object' or p_event ->> 'processor' is distinct from 'paddle' then
    raise exception 'paddle_event_apply: the event must be a paddle event object' using errcode = '22023';
  end if;
  v_live  := (p_event ->> 'livemode')::boolean;
  v_price := p_event ->> 'variant_ref';
  v_name  := p_event ->> 'event_name';
  v_ref   := p_event ->> 'subscription_ref';
  if v_live is null or v_price is null or v_name is null or v_ref is null then
    raise exception 'paddle_event_apply: livemode, variant_ref, event_name and subscription_ref are required' using errcode = '22023';
  end if;

  select * into pp from public.billing_plan_price x where x.price_ref = v_price and x.livemode = v_live and x.active;
  if not found then
    perform public.paddle_unmatched_record(p_event, case when exists (select 1 from public.billing_plan_price x where x.price_ref = v_price) then 'TEST_PRICE_LIVE_EVENT' else 'UNKNOWN_PRICE' end);
    return query select 'UNKNOWN_PRICE'::text, null::bigint, null::boolean, false, null::text; return;
  end if;
  if p_plan is distinct from pp.plan_key then
    perform public.paddle_unmatched_record(p_event, 'PLAN_MISMATCH');
    return query select 'PLAN_MISMATCH'::text, null::bigint, null::boolean, false, null::text; return;
  end if;
  if (pp.kind = 'one_time' and v_name <> 'transaction_completed') or (pp.kind = 'recurring' and v_name not like 'subscription\_%') then
    perform public.paddle_unmatched_record(p_event, 'UNSUPPORTED_EVENT');
    return query select 'UNSUPPORTED_EVENT'::text, null::bigint, null::boolean, false, null::text; return;
  end if;

  if pp.plan_key = 'private_partner' then
    select e.* into en from public.partner_enrollment e where e.enrollment_id = p_enrollment for update;
    select l.* into lk from public.partner_link l where l.link_id = en.link_id;
    if not found or en.account_id is distinct from p_brokerage or en.verification_status = 'failed'
       or not lk.active or not exists (select 1 from public.partner_brokerage b where b.partner_id = en.partner_id and b.status = 'active')
       -- a first payment needs an unexpired link and room under its cap; a later event for an already-bound enrollment does not
       or (en.binding_id is null and ((lk.expires_at is not null and lk.expires_at <= now())
            or (select count(*) from public.partner_enrollment x where x.link_id = lk.link_id and x.binding_id is not null) >= lk.max_redemptions))
       or (en.binding_id is not null and not exists (select 1 from public.brokerage_subscription s where s.binding_id = en.binding_id
              and s.processor = 'paddle' and s.livemode = v_live and s.subscription_ref = v_ref)) then
      perform public.paddle_unmatched_record(p_event, 'PARTNER_NOT_ELIGIBLE');
      return query select 'PARTNER_NOT_ELIGIBLE'::text, null::bigint, null::boolean, false, null::text; return;
    end if;
    -- only a payment of the kind THIS database grants binds an enrollment (live in production, sandbox in isolated staging): the other kind is
    -- recorded (the founder's test) and never uses up a link
  end if;

  select a.* into r from public.billing_event_apply(p_brokerage, p_event) a;

  if pp.plan_key = 'private_partner' and en.binding_id is null and v_live = public.billing_grants_livemode() then
    select s.binding_id into v_bind from public.brokerage_subscription s where s.processor = 'paddle' and s.livemode = v_live and s.subscription_ref = v_ref;
    update public.partner_enrollment e set binding_id = v_bind,
           next_verification_at = now() + make_interval(days => (select b.verification_interval_days from public.partner_brokerage b where b.partner_id = en.partner_id))
     where e.enrollment_id = en.enrollment_id and e.binding_id is null;
  end if;

  if pp.kind = 'recurring' and r.outcome = 'RECORDED' and jsonb_typeof(p_period) = 'object' then
    insert into public.billing_period_observation (processor, livemode, subscription_ref, occurred_at, next_billed_at, period_ends_at, cancel_effective_at)
    values ('paddle', v_live, v_ref, (p_event ->> 'occurred_at')::timestamptz,
            nullif(p_period ->> 'next_billed_at', '')::timestamptz, nullif(p_period ->> 'period_ends_at', '')::timestamptz, nullif(p_period ->> 'cancel_effective_at', '')::timestamptz);
  end if;
  return query select r.outcome, r.event_id, r.is_latest, r.bound, r.state;
end $$;

-- A FULL refund. Paddle's adjustment names the transaction and, for a subscription's transaction, the subscription: p_event.subscription_ref is
-- the subscription id when there is one, else the transaction id, and processor_status is 'refunded'. The brokerage is found from the existing binding.
create or replace function public.paddle_adjustment_apply(p_event jsonb)
returns table (outcome text, event_id bigint, is_latest boolean, bound boolean, state text)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_live boolean;
  b      public.brokerage_subscription%rowtype;
  r      record;
begin
  if jsonb_typeof(p_event) is distinct from 'object' or p_event ->> 'processor' is distinct from 'paddle' or p_event ->> 'processor_status' is distinct from 'refunded' then
    raise exception 'paddle_adjustment_apply: the event must be a paddle full-refund event' using errcode = '22023';
  end if;
  v_live := (p_event ->> 'livemode')::boolean;
  select s.* into b from public.brokerage_subscription s where s.processor = 'paddle' and s.livemode = v_live and s.subscription_ref = p_event ->> 'subscription_ref';
  if not found then
    perform public.paddle_unmatched_record(p_event, 'NO_BINDING');
    return query select 'NO_BINDING'::text, null::bigint, null::boolean, false, null::text; return;
  end if;
  select a.* into r from public.billing_event_apply(b.brokerage_id, p_event) a;
  return query select r.outcome, r.event_id, r.is_latest, r.bound, r.state;
end $$;

-- ---- 7. PARTNER ENROLLMENT ---------------------------------------------------------------------------------
create or replace function public.partner_brokerage_create(p_name text, p_verification_interval_days integer default 30) returns uuid
language sql security definer set search_path = public, pg_temp
as $$ insert into public.partner_brokerage (name, verification_interval_days) values (p_name, coalesce(p_verification_interval_days, 30)) returning partner_id $$;

-- The re-verification interval is the PARTNER BROKERAGE's (configurable per brokerage, 1 to 365 days, default 30). It applies from the next check scheduled.
create or replace function public.partner_brokerage_set_interval(p_partner uuid, p_days integer) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.partner_brokerage b set verification_interval_days = p_days where b.partner_id = p_partner;
  return found;
end $$;

-- The operator mints a token (a random string), gives it to the partner, and stores only its sha-256 here.
create or replace function public.partner_link_create(p_partner uuid, p_token_hash text, p_expires_at timestamptz, p_max integer) returns uuid
language sql security definer set search_path = public, pg_temp
as $$ insert into public.partner_link (partner_id, token_hash, expires_at, max_redemptions) values (p_partner, p_token_hash, p_expires_at, coalesce(p_max, 100)) returning link_id $$;

-- Whether this person's account may buy the partner offer with this link. The answer carries a reason word and never says which part of a link failed.
create or replace function public.partner_enrollment_start(p_user_id uuid, p_token_hash text, p_create boolean default true)
returns table (outcome text, enrollment_id uuid, brokerage_id uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  m  record;
  lk public.partner_link%rowtype;
  v_id uuid;
begin
  select r.* into m from public.brokerage_membership_of(p_user_id) r;
  if not found or m.role <> 'owner' then
    return query select 'NOT_ENTITLED'::text, null::uuid, null::uuid; return;
  end if;
  select l.* into lk from public.partner_link l where l.token_hash = p_token_hash;
  if not found or not lk.active or (lk.expires_at is not null and lk.expires_at <= now())
     or not exists (select 1 from public.partner_brokerage b where b.partner_id = lk.partner_id and b.status = 'active') then
    return query select 'LINK_INVALID'::text, null::uuid, null::uuid; return;
  end if;
  if exists (select 1 from public.partner_enrollment e where e.account_id = m.brokerage_id and e.binding_id is not null) then
    return query select 'ALREADY_USED'::text, null::uuid, null::uuid; return;
  end if;
  if exists (select 1 from public.billing_plan_of(m.brokerage_id) p where p.state = 'paid') then
    return query select 'ALREADY_PAID'::text, null::uuid, null::uuid; return;
  end if;
  if (select count(*) from public.partner_enrollment e where e.link_id = lk.link_id and e.binding_id is not null) >= lk.max_redemptions then
    return query select 'LINK_INVALID'::text, null::uuid, null::uuid; return;
  end if;
  select e.enrollment_id into v_id from public.partner_enrollment e where e.account_id = m.brokerage_id and e.link_id = lk.link_id and e.binding_id is null order by e.created_at limit 1;
  if v_id is null and not p_create then
    return query select 'OK'::text, null::uuid, m.brokerage_id; return;       -- a read-only check (the private offer page): eligible, nothing written
  end if;
  if v_id is null then
    insert into public.partner_enrollment (account_id, link_id, partner_id) values (m.brokerage_id, lk.link_id, lk.partner_id) returning enrollment_id into v_id;
  end if;
  return query select 'OK'::text, v_id, m.brokerage_id;
end $$;

-- Periodic membership verification (decision 2). Every partner enrollment that has paid is re-checked by an operator every
-- partner_brokerage.verification_interval_days (30 by default, set per brokerage). THIS LIST IS THE MANUAL-REVIEW QUEUE: it is derived from the clock on
-- every call (no job has to run for an overdue check to appear), oldest first, with how many days overdue each is. Being on it changes NOTHING about
-- access: only a recorded 'failed' check suspends (billing_plan_of reads it), never a late one.
create or replace function public.partner_verification_due(p_now timestamptz default now())
returns table (enrollment_id uuid, partner_name text, account_id uuid, enrolled_at timestamptz, last_verified_at timestamptz, next_verification_at timestamptz, days_overdue integer)
language sql stable security definer set search_path = public, pg_temp
as $$
  select e.enrollment_id, b.name, e.account_id, e.created_at, e.last_verified_at, e.next_verification_at,
         greatest(0, floor(extract(epoch from (p_now - e.next_verification_at)) / 86400))::integer
    from public.partner_enrollment e join public.partner_brokerage b on b.partner_id = e.partner_id
   where e.binding_id is not null and e.verification_status <> 'failed' and e.next_verification_at <= p_now
   order by e.next_verification_at
$$;

-- 'verified' keeps access and schedules the next check (the partner's own interval unless one is given); 'failed' is a CONFIRMED ineligibility and suspends
-- access immediately (billing_plan_of reads it) and is never silently reversed.
create or replace function public.partner_enrollment_verify(p_enrollment uuid, p_result text, p_next interval default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_result not in ('verified', 'failed') then raise exception 'partner_enrollment_verify: result must be verified or failed' using errcode = '22023'; end if;
  update public.partner_enrollment e set verification_status = p_result, last_verified_at = now(),
         next_verification_at = case when p_result = 'verified'
              then now() + coalesce(p_next, make_interval(days => (select b.verification_interval_days from public.partner_brokerage b where b.partner_id = e.partner_id)))
              else null end
   where e.enrollment_id = p_enrollment and e.verification_status <> 'failed';
  return found;
end $$;

-- ---- 8. THE DASHBOARD READER ---------------------------------------------------------------------------------
-- A member's plan in the words the customer dashboard shows. Derived on every call; nothing is stored. credits_remaining is 0 unless the plan is paid.
-- next_reset_at: when the monthly allowance next resets (paid only, and not past the last month of a one-time plan).
-- access_ends_at: when paid access ends (a one-time plan's six months, or a recurring plan's scheduled cancellation).
-- renews_at: a recurring plan's next charge (null when cancelling).
create or replace function public.billing_summary(p_user_id uuid)
returns table (brokerage_id uuid, role text, state text, plan_key text, plan_label text, kind text, credit_limit integer, credits_used integer,
               credits_remaining integer, next_reset_at timestamptz, access_ends_at timestamptz, renews_at timestamptz, cancel_effective_at timestamptz, access_months integer)
language sql stable security definer set search_path = public, pg_temp
as $$
  select m.brokerage_id, m.role, coalesce(pl.state, 'none'), pp.plan_key, pp.plan_label, pp.kind, public.billing_report_limit(),
         case when pl.state = 'paid' then u.n else 0 end,
         case when pl.state = 'paid' then greatest(public.billing_report_limit() - u.n, 0) else 0 end,
         case when pl.state = 'paid' and (pp.kind is distinct from 'one_time' or public.billing_period_index(pl.bound_at, now()) + 1 < pp.access_months)
              then public.billing_period_end(pl.bound_at, public.billing_period_index(pl.bound_at, now())) end,
         case when pp.kind = 'one_time' then ((pl.bound_at at time zone 'UTC') + pp.access_months * interval '1 month') at time zone 'UTC'
              when pp.kind = 'recurring' and ob.cancel_effective_at is not null then ob.cancel_effective_at end,
         case when pp.kind = 'recurring' and pl.state = 'paid' and ob.cancel_effective_at is null then ob.next_billed_at end,
         case when pp.kind = 'recurring' then ob.cancel_effective_at end,
         pp.access_months
    from public.brokerage_membership_of(p_user_id) m
    left join lateral public.billing_plan_of(m.brokerage_id) pl on true
    left join public.brokerage_subscription bs on bs.binding_id = pl.binding_id
    left join public.billing_plan_price pp on pp.livemode = pl.livemode and pp.price_ref = public.billing_binding_price(bs.processor, bs.livemode, bs.subscription_ref)
    left join lateral (select o.next_billed_at, o.cancel_effective_at from public.billing_period_observation o
                        where o.processor = bs.processor and o.livemode = bs.livemode and o.subscription_ref = bs.subscription_ref
                        order by o.occurred_at desc, o.obs_id desc limit 1) ob on true
    cross join lateral (select count(*)::integer as n from public.brokerage_paid_credit c
                         where pl.binding_id is not null and c.binding_id = pl.binding_id
                           and c.period_index = public.billing_period_index(pl.bound_at, now())) u
$$;

-- The subscription a member's billing-management link is for: the OWNER's current LIVE-or-test recurring Paddle binding, nothing else. Server-only (the
-- subscription id never reaches a browser): the edge function asks Paddle for that subscription's own management addresses with it.
create or replace function public.billing_portal_ref(p_user_id uuid)
returns table (subscription_ref text, livemode boolean)
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.subscription_ref, s.livemode
    from public.brokerage_membership_of(p_user_id) m
    join lateral public.billing_plan_of(m.brokerage_id) pl on true
    join public.brokerage_subscription s on s.binding_id = pl.binding_id
    join public.billing_plan_price pp on pp.livemode = s.livemode and pp.price_ref = public.billing_binding_price(s.processor, s.livemode, s.subscription_ref)
   where m.role = 'owner' and s.processor = 'paddle' and pp.kind = 'recurring'
$$;

-- ---- 9. THE AUDIT: invariants as counts that must be zero, beside controls ---------------------------------------
create or replace function public.paddle_billing_check()
returns table (check_name text, kind text, violations bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select 'paddle_prices_total'::text, 'control'::text, count(*) from public.billing_plan_price
  union all select 'paddle_events_total', 'control', count(*) from public.payment_event where processor = 'paddle'
  union all select 'paddle_binding_without_a_known_price', 'invariant', count(*) from public.brokerage_subscription s
    where s.processor = 'paddle' and not exists (select 1 from public.billing_plan_price p where p.livemode = s.livemode and p.price_ref = public.billing_binding_price(s.processor, s.livemode, s.subscription_ref))
  union all select 'one_time_credit_after_access_ended', 'invariant', count(*) from public.brokerage_paid_credit c
    join public.brokerage_subscription s on s.binding_id = c.binding_id
    join public.billing_plan_price p on p.livemode = s.livemode and p.price_ref = public.billing_binding_price(s.processor, s.livemode, s.subscription_ref)
   where p.kind = 'one_time' and c.period_index >= p.access_months
  union all select 'paid_credit_on_a_binding_of_the_other_environment', 'invariant', count(*) from public.brokerage_paid_credit c
    join public.brokerage_subscription s on s.binding_id = c.binding_id where s.processor = 'paddle' and s.livemode is distinct from public.billing_grants_livemode()
  union all select 'partner_verification_overdue_for_manual_review', 'review', count(*) from public.partner_verification_due()
  union all select 'free_reports_used_after_the_gate_armed', 'invariant', count(*) from public.evaluation_credit c
    join public.evaluation e on e.evaluation_id = c.evaluation_id, public.billing_gate g
   where g.paid_required and not g.honor_granted_free_reports and c.issued_at > g.armed_at and g.armed_at is not null
  union all select 'partner_link_over_its_cap', 'invariant', count(*) from public.partner_link l
    where (select count(*) from public.partner_enrollment e where e.link_id = l.link_id and e.binding_id is not null) > l.max_redemptions
  union all select 'partner_binding_not_on_a_partner_price', 'invariant', count(*) from public.partner_enrollment e
    join public.brokerage_subscription s on s.binding_id = e.binding_id
    where public.billing_binding_price(s.processor, s.livemode, s.subscription_ref) is distinct from public.billing_price_for('private_partner', s.livemode)
$$;

-- ---- 10. LOCK-DOWN: system-only ------------------------------------------------------------------------------
do $lock$
declare
  t text;
  f record;
begin
  foreach t in array array['billing_plan_price', 'billing_period_observation', 'paddle_unmatched_event', 'partner_brokerage', 'partner_link', 'partner_enrollment',
                           'billing_environment', 'billing_gate', 'billing_gate_log', 'billing_terms_version', 'billing_terms_acceptance', 'billing_complimentary'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
  foreach t in array array['billing_period_observation', 'paddle_unmatched_event', 'billing_gate_log', 'billing_terms_acceptance'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_append_only', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.billing_append_only()', t || '_append_only', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.billing_append_only()', t || '_no_truncate', t);
  end loop;
  for f in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'paddle\_%' or p.proname like 'partner\_%' or p.proname in ('billing_price_for', 'billing_binding_price', 'billing_summary', 'billing_portal_ref', 'billing_grants_livemode', 'billing_environment_mode', 'billing_gate_set', 'billing_gate_state', 'billing_free_reports_usable', 'billing_free_reports_review', 'billing_terms_current', 'billing_terms_accept', 'billing_complimentary_active', 'billing_complimentary_grant', 'billing_complimentary_revoke')) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  -- the gate and the environment are changed by the database owner in SQL, never through the API: not even service_role may call the setter, and the trigger
  -- function is not callable at all
  revoke execute on function public.billing_gate_set(boolean, boolean) from service_role;
  revoke execute on function public.billing_complimentary_grant(uuid, text, text, timestamptz) from service_role;
  revoke execute on function public.billing_complimentary_revoke(uuid) from service_role;
  revoke all on function public.billing_complimentary_guard() from public, anon, authenticated, service_role;
  revoke all on function public.billing_environment_guard() from public, anon, authenticated, service_role;
  revoke execute on function public.partner_brokerage_create(text, integer) from service_role;
  revoke execute on function public.partner_brokerage_set_interval(uuid, integer) from service_role;
  revoke all on function public.billing_plan_of(uuid) from public, anon, authenticated, service_role;
  grant execute on function public.billing_plan_of(uuid) to service_role;
  revoke all on function public.payment_event_map_status(text, text) from public, anon, authenticated;
  grant execute on function public.payment_event_map_status(text, text) to service_role;
end $lock$;

-- ---- 11. POST-CONDITION --------------------------------------------------------------------------------------
do $post$
declare
  f   record;
  t   text;
begin
  for f in select p.oid, p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'paddle\_%' or p.proname like 'partner\_%' or p.proname in ('billing_price_for', 'billing_binding_price', 'billing_summary', 'billing_portal_ref', 'billing_grants_livemode', 'billing_environment_mode', 'billing_gate_set', 'billing_gate_state', 'billing_free_reports_usable', 'billing_free_reports_review', 'billing_terms_current', 'billing_terms_accept', 'billing_complimentary_active', 'billing_complimentary_grant', 'billing_complimentary_revoke')) loop
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f.oid and a.grantee <> p.proowner
                  and (a.grantee <> (select oid from pg_roles where rolname = 'service_role') or a.privilege_type <> 'EXECUTE')) then
      raise exception 'paddle_billing: % is executable by a role it should not be', f.sig;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = f.oid) then
      raise exception 'paddle_billing: % must be SECURITY DEFINER (its tables are closed to the caller)', f.sig;
    end if;
  end loop;
  foreach t in array array['public.billing_plan_price', 'public.billing_period_observation', 'public.paddle_unmatched_event', 'public.partner_brokerage', 'public.partner_link', 'public.partner_enrollment',
                           'public.billing_environment', 'public.billing_gate', 'public.billing_gate_log', 'public.billing_terms_version', 'public.billing_terms_acceptance', 'public.billing_complimentary'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = t::regclass)
       or exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = t::regclass and a.grantee <> c.relowner) then
      raise exception 'paddle_billing: % must have row level security and no grant to any API role', t;
    end if;
  end loop;
  if exists (select 1 from public.billing_plan_price where reports_per_month <> 100) then
    raise exception 'paddle_billing: every plan is 100 reports a month';
  end if;
end $post$;

-- ROLLBACK (this file only). Appropriate only before the first Paddle event: it drops the partner, period, gate and terms records. The Lemon Squeezy mapping is
-- NOT restored (that processor has been removed); billing_plan_of goes back to its brokerage-billing.sql body, evaluation_usage to its evaluation-entitlement.sql
-- body and brokerage_paid_credit_guard to its brokerage-billing.sql body by re-applying those sections. The gate splice in brokerage_report_issue and the
-- environment test in billing_check are taken OUT below (nothing may still call a function this rollback drops).
-- ROLLBACK-BEGIN
--   do $undo$
--   declare d text; f text;
--   begin
--     f := 'public.brokerage_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)'; d := pg_get_functiondef(to_regprocedure(f)::oid);
--     if d like '%PAID_PLAN_REQUIRED%' then
--       d := replace(d, '  if pl.state is distinct from ''paid''' || chr(10) ||
--         '     and not exists (select 1 from public.evaluation_credit c where c.evaluation_id = ev.evaluation_id and c.idempotency_key = p_idempotency_key)' || chr(10) ||
--         '     and not public.billing_free_reports_usable(ev.evaluation_id) then' || chr(10) ||
--         '    raise exception using errcode = ''EV013'', message = ''PAID_PLAN_REQUIRED'';' || chr(10) ||
--         '  end if;' || chr(10), '');
--       execute d;
--     end if;
--     f := 'public.billing_check()'; d := pg_get_functiondef(to_regprocedure(f)::oid);
--     if d like '%billing_grants_livemode%' then execute replace(d, 'where b.livemode is distinct from public.billing_grants_livemode()', 'where not b.livemode'); end if;
--   end $undo$;
--   drop function if exists public.paddle_billing_check(), public.billing_portal_ref(uuid), public.billing_summary(uuid), public.partner_enrollment_verify(uuid, text, interval),
--     public.partner_verification_due(timestamptz), public.partner_enrollment_start(uuid, text, boolean), public.partner_link_create(uuid, text, timestamptz, integer),
--     public.partner_brokerage_create(text, integer), public.partner_brokerage_set_interval(uuid, integer), public.billing_terms_accept(uuid, text, text),
--     public.billing_terms_current(), public.billing_free_reports_review(), public.billing_gate_state(), public.billing_gate_set(boolean, boolean),
--     public.paddle_adjustment_apply(jsonb), public.paddle_event_apply(uuid, jsonb, text, uuid, jsonb),
--     public.paddle_unmatched_record(jsonb, text), public.billing_binding_price(text, boolean, text), public.billing_price_for(text, boolean);
--   drop table if exists public.partner_enrollment, public.partner_link, public.partner_brokerage, public.paddle_unmatched_event,
--     public.billing_period_observation, public.billing_plan_price, public.billing_gate_log, public.billing_gate, public.billing_terms_acceptance, public.billing_terms_version;
--   drop function if exists public.billing_free_reports_usable(uuid);
--   drop table if exists public.billing_complimentary;
--   drop function if exists public.billing_complimentary_grant(uuid, text, text, timestamptz), public.billing_complimentary_revoke(uuid), public.billing_complimentary_active(uuid), public.billing_complimentary_guard();
--   drop table if exists public.billing_environment;
--   drop function if exists public.billing_environment_mode(), public.billing_grants_livemode(), public.billing_environment_guard();
--   alter table public.evaluation drop column if exists free_reports_granted;
-- ROLLBACK-END

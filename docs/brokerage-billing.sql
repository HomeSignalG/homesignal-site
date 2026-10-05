-- ============================================================================
-- BROKERAGE BILLING  (Development Activity build step 11, Order M — 2026-10-04)
-- SQL OF RECORD. Additive. Applied through the approved runner (db-sql.yml), never as a rolled-back dry run (CLAUDE.md §7.11).
-- The database layer of the $79 a month plan: 100 new reports a month for a brokerage, on top of (and never counted against) the
-- 10 free reports of its evaluation. Nothing here talks to the payment processor; the processor's events arrive through
-- supabase/functions/development-activity-billing-webhook and are recorded by the ledger that already exists.
--
-- WHAT IT ADDS
--   public.brokerage_subscription  the BINDING of a processor subscription to ONE brokerage account (append-only). It is how a payment
--                                  event, which names only the processor's own subscription id, is tied to an account HomeSignal minted.
--   public.brokerage_paid_credit   the APPEND-ONLY ledger of reports issued against the paid allotment: one row per report, linking the
--                                  report_id. The cap of 100 a month is a CONSTRAINT (primary key + check), not a count and a lock.
--   public.evaluation_credit_all   the ONE ownership view: the trial's credit rows and the paid credit rows, with the SAME columns
--                                  (evaluation_id, ordinal, idempotency_key, report_id, issued_at). "Whose report is this" is read here and nowhere else.
--   billing_plan_of(brokerage)     the plan state, DERIVED from the latest payment-ledger event of the brokerage's current binding.
--                                  Nothing stores "paid": a state that is stored can disagree with the ledger it came from.
--   billing_event_apply            the webhook's ONE writer: binds the subscription to the brokerage and records the event, in one
--                                  transaction, through public.payment_event_record (the ledger's one writer).
--   billing_usage(user)            the ONE reader for the Billing section and the report gate: plan state, this month's allotment.
--   brokerage_report_issue         THE ONE report-issuing entry. It decides which allotment a member's report uses: the paid month when
--                                  the plan is paid, otherwise the free evaluation (public.evaluation_report_issue, unchanged).
--   billing_check                  invariants as counts that must be zero, beside controls.
--   And a one-time, anchor-counted SPLICE of the six readers that decide whose a report is (saved list, open, the share links, the share
--   page, the watch list) so each reads public.evaluation_credit_all instead of public.evaluation_credit. The splice is computed from the
--   LIVE function bodies, never retyped (CLAUDE.md claims rule 7), and refuses unless every anchor appears exactly once.
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   processor event -> [HMAC-verified webhook, this repo] -> billing_event_apply -> public.payment_event_record -> public.payment_event
--     -> billing_plan_of (state) -> brokerage_report_issue (which allotment) -> public.report_snapshot_issue (the one snapshot writer)
--     -> public.report_snapshot + a credit row (trial: evaluation_credit, paid: brokerage_paid_credit) -> evaluation_credit_all (whose it is)
--     -> the saved list, the share links, the watch list and Compare.
--   Decision owners, none duplicated here:
--     is the event genuine ..................... the webhook's signature check, upstream. Not repeated.
--     was it recorded, and which is the latest . public.payment_event_record / payment_event_latest_id (the ledger). Asked, never re-ordered here.
--     what a processor status word means ....... public.payment_event_map_status (the ledger). Read through the stored mapped_status.
--     is the brokerage paid .................... billing_plan_of. Nothing else decides it.
--     which allotment a report uses ............ brokerage_report_issue.
--     whether a report may be stored ........... report_snapshot_issue and the private-context containment trigger. Called, not repeated.
--     whose a report is ........................ evaluation_credit_all.
--     the numbers 10 and 100 ................... evaluation_report_limit() (unchanged) and billing_report_limit() (here). Written once each.
--
-- THE RULES THIS ENCODES (each pinned by test/brokerage_billing_pg/suite.sql and run.sh)
--   1. PAID ONLY FROM A SERVER-VERIFIED EVENT. A brokerage is paid exactly when the latest LIVE-mode event of its current LIVE binding maps to
--      'active'. A success URL, a page, a browser value or a client claim never makes a plan paid. (Plan Hard Rules 31-32.)
--   2. TEST NEVER GRANTS. A test-mode event is recorded and bound (so the founder's test payment can be checked) but the state is
--      'test_only' and no report is ever charged to it.
--   3. THE FREE REPORTS DO NOT COUNT TOWARD THE PLAN (founder, 2026-10-02). The two ledgers are separate; the paid month's 100 is never
--      reduced by the 10, and a free report is never taken from the paid month. Reports are numbered 1 to 10 (free) and 11 onward (paid):
--      a number names one report forever and is never reused.
--   4. THE MONTH IS COUNTED FROM THE DAY THE SUBSCRIPTION WAS BOUND, in whole calendar months (billing_period_index). It is derived, never
--      stored, and it does not follow a paused or shifted billing date (default D-11-3).
--   5. THE CAP HOLDS BY CONSTRAINT at any isolation level: primary key (binding, period, ordinal), ordinal between 1 and 100, and the period
--      is STAMPED by a trigger from the binding and the clock, so no writer can name a different month to get another 100. The issuing
--      function additionally refuses at READ COMMITTED only, and answers ALLOTMENT_COMPLETE before the constraint is reached.
--   6. A RETRIED KEY IS ANSWERED, NEVER CHARGED TWICE, ACROSS BOTH LEDGERS: the same key returns the stored report whichever allotment
--      first charged it, even if the plan changed between the request and its retry.
--   7. AN UNKNOWN STATUS NEVER GRANTS. 'unknown', 'trialing', 'paused', 'past_due', 'unpaid' and 'canceled' are not paid.
--   8. A SUBSCRIPTION BELONGS TO ONE BROKERAGE FOR EVER. Re-binding it to another brokerage is refused (BINDING_CONFLICT) and records nothing.
--   9. NOTHING PERSONAL IS STORED. The binding holds the processor's opaque ids and a time; the paid ledger holds ids and times. No payer
--      email, name, card, address, customer id, price, plan name or free text. (CLAUDE.md, permanent historical intelligence.)
--
-- DEFAULTS TAKEN (the founder may change any; none is hard-coded as a product claim)
--   D-11-1  paid means the processor's own 'active' and nothing else (the ledger holds no period-end date, so "cancelled but paid through the
--           end of the month" cannot be told from "cancelled" here: a cancelled subscription ends access at once). FOUNDER DECISION.
--   D-11-2  past_due, unpaid and paused do not grant, and no grace period is invented.
--   D-11-3  a paid month runs from the day the subscription was bound; the allotment resets on that day each month.
--   D-11-4  once the plan is paid, every new report uses the paid allotment; the unused free reports are neither used nor lost.
--   D-11-5  at the 101st report in a month the answer is ALLOTMENT_COMPLETE; there is no overage, no pack and no extra purchase.
--   D-11-6  paid reports are numbered from 11.
--   D-11-7  a brokerage that subscribes again after cancelling gets a new binding and a new first month.
--
-- ERRORS (message, SQLSTATE): the handler maps on the message.
--   NOT_ENTITLED EV003            not a member, a removed member, another brokerage, a revoked or expired evaluation, a suspended brokerage.
--   ALLOTMENT_COMPLETE EV010      100 reports are used this month.
--   BINDING_CONFLICT EV011        the subscription is already bound to a different brokerage.
--   BROKERAGE_UNKNOWN EV012       billing_event_apply was given an id that is no brokerage.
--   IDEMPOTENCY_KEY_REQUIRED 22023 no key was given.
--
-- ACCESS: system-only, the K0 / L1 posture. RLS on, NO policy, every privilege on the two tables and the view revoked from public, anon,
-- authenticated AND service_role; every function executable by service_role alone, except the trigger functions (nobody) and the helper that
-- issues against the paid month (nobody: only brokerage_report_issue, which runs as the owner, can reach it, so there is ONE way to charge).
-- Every function that touches a table is SECURITY DEFINER with a pinned search_path.
--
-- ADDITIVE ONLY. Creates two tables, one view, two indexes beside the keys, five triggers and eleven functions, and replaces six existing
-- functions by the splice described above (their privileges, security and search path are checked unchanged afterwards). Seeds nothing and
-- arms no schedule. Idempotent: safe to run twice. ROLLBACK is at the foot.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) -------------------------------------------------------------
do $pre$
declare
  f text;
begin
  if to_regclass('public.brokerage_account') is null
     or to_regclass('public.evaluation') is null or to_regclass('public.evaluation_credit') is null
     or to_regclass('public.report_snapshot') is null or to_regclass('public.payment_event') is null then
    raise exception 'brokerage_billing: apply docs/brokerage-account-spine.sql, docs/report-snapshot.sql, docs/evaluation-entitlement.sql and docs/payment-event-ledger.sql first';
  end if;
  foreach f in array array[
    'public.brokerage_membership_of(uuid)', 'public.evaluation_report_limit()',
    'public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)',
    'public.report_snapshot_issue(text, text, text, jsonb, jsonb)',
    'public.payment_event_record(jsonb)', 'public.payment_event_latest_id(text, boolean, text)',
    'public.payment_event_opaque_ok(text)', 'public.payment_event_processor_ok(text)',
    'public.evaluation_reports_of(uuid)', 'public.evaluation_report_open(uuid, uuid)',
    'public.evaluation_report_shares_of(uuid, uuid)', 'public.evaluation_report_share_revoke(uuid, uuid)',
    'public.report_share_open(text)', 'public.evaluation_property_watches_of(uuid)'] loop
    if to_regprocedure(f) is null then
      raise exception 'brokerage_billing: % is missing. Apply docs/saved-reports.sql, docs/report-share-delivery.sql and docs/property-watch.sql first', f;
    end if;
  end loop;
  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'brokerage_billing: gen_random_uuid() is not available';
  end if;
end $pre$;

-- ---- 1. THE ONE DEFINITION OF THE NUMBER OF PAID REPORTS A MONTH -----------------------------------
create or replace function public.billing_report_limit() returns integer
language sql immutable as $$ select 100 $$;

-- ---- 2. THE BINDING (append-only) -------------------------------------------------------------------
-- One row says: this processor subscription belongs to this brokerage. The processor's own ids only. livemode is part of the identity, so a
-- test subscription "1" and a live subscription "1" are two different things. bound_at is the SERVER's time of the first event it saw.
create table if not exists public.brokerage_subscription (
  binding_id       uuid        primary key default gen_random_uuid(),
  brokerage_id     uuid        not null references public.brokerage_account (id),
  processor        text        not null,
  subscription_ref text        not null,
  livemode         boolean     not null,
  bound_at         timestamptz not null default now(),
  constraint brokerage_subscription_processor check (public.payment_event_processor_ok(processor)),
  constraint brokerage_subscription_ref       check (public.payment_event_opaque_ok(subscription_ref)),
  constraint brokerage_subscription_unique    unique (processor, livemode, subscription_ref),
  constraint brokerage_subscription_pair      unique (binding_id, brokerage_id)
);
create index if not exists brokerage_subscription_by_brokerage on public.brokerage_subscription (brokerage_id, livemode desc, bound_at desc);

-- ---- 3. THE PAID CREDIT LEDGER (append-only; the cap is a constraint) -----------------------------------
-- period_index counts whole months from the binding's bound_at (0 = the first month). It is STAMPED by the trigger below, so a writer cannot
-- choose the month. number is the report's number for the brokerage, from 11; unique, so no two reports ever share one.
create table if not exists public.brokerage_paid_credit (
  binding_id      uuid        not null,
  brokerage_id    uuid        not null,
  period_index    integer     not null,
  ordinal         integer     not null,
  number          integer     not null,
  idempotency_key uuid        not null,
  report_id       uuid        not null references public.report_snapshot (report_id),
  issued_at       timestamptz not null default now(),
  constraint brokerage_paid_credit_pkey          primary key (binding_id, period_index, ordinal),
  constraint brokerage_paid_credit_binding       foreign key (binding_id, brokerage_id) references public.brokerage_subscription (binding_id, brokerage_id),
  constraint brokerage_paid_credit_period        check (period_index >= 0),
  constraint brokerage_paid_credit_ordinal       check (ordinal between 1 and public.billing_report_limit()),
  constraint brokerage_paid_credit_number        check (number > public.evaluation_report_limit()),
  constraint brokerage_paid_credit_number_unique unique (brokerage_id, number),
  constraint brokerage_paid_credit_key_unique    unique (brokerage_id, idempotency_key),
  constraint brokerage_paid_credit_report_unique unique (report_id)
);

-- ---- 4. GUARDS ------------------------------------------------------------------------------------------------
create or replace function public.billing_append_only() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  raise exception '% is append-only (% refused)', tg_table_name, tg_op using errcode = '55000';
end $$;

-- The month a month's allotment belongs to: whole calendar months from the binding's bound_at, in UTC, as the number k such that
-- bound_at + k months <= at < bound_at + (k + 1) months. Computed by the database, in one place, never stored with the binding.
create or replace function public.billing_period_index(p_bound_at timestamptz, p_at timestamptz) returns integer
language sql immutable set search_path = public, pg_temp
as $$
  select coalesce(max(k), 0)::integer from generate_series(0, 1200) k
   where (p_bound_at at time zone 'UTC') + k * interval '1 month' <= (p_at at time zone 'UTC')
$$;
create or replace function public.billing_period_end(p_bound_at timestamptz, p_index integer) returns timestamptz
language sql immutable set search_path = public, pg_temp
as $$ select ((p_bound_at at time zone 'UTC') + (p_index + 1) * interval '1 month') at time zone 'UTC' $$;

-- A paid credit needs a LIVE binding of the same brokerage. The month and the time are stamped here, from the binding and the clock.
create or replace function public.brokerage_paid_credit_guard() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare
  b public.brokerage_subscription%rowtype;
begin
  select s.* into b from public.brokerage_subscription s where s.binding_id = new.binding_id;
  if not found or b.livemode is not true or b.brokerage_id <> new.brokerage_id then
    raise exception 'brokerage_paid_credit: a paid credit needs a live subscription binding of the same brokerage' using errcode = '55000';
  end if;
  new.period_index := public.billing_period_index(b.bound_at, now());
  new.issued_at    := now();
  return new;
end $$;

drop trigger if exists brokerage_subscription_append_only on public.brokerage_subscription;
create trigger brokerage_subscription_append_only before update or delete on public.brokerage_subscription
  for each row execute function public.billing_append_only();
drop trigger if exists brokerage_subscription_no_truncate on public.brokerage_subscription;
create trigger brokerage_subscription_no_truncate before truncate on public.brokerage_subscription
  for each statement execute function public.billing_append_only();
drop trigger if exists brokerage_paid_credit_append_only on public.brokerage_paid_credit;
create trigger brokerage_paid_credit_append_only before update or delete on public.brokerage_paid_credit
  for each row execute function public.billing_append_only();
drop trigger if exists brokerage_paid_credit_no_truncate on public.brokerage_paid_credit;
create trigger brokerage_paid_credit_no_truncate before truncate on public.brokerage_paid_credit
  for each statement execute function public.billing_append_only();
drop trigger if exists brokerage_paid_credit_guard on public.brokerage_paid_credit;
create trigger brokerage_paid_credit_guard before insert on public.brokerage_paid_credit
  for each row execute function public.brokerage_paid_credit_guard();

-- ---- 5. THE ONE OWNERSHIP VIEW ------------------------------------------------------------------------------------
-- The trial's credit rows and the paid credit rows, as ONE set with the columns every ownership reader already uses. A paid row carries the
-- evaluation_id of its brokerage's evaluation (every brokerage is made with one) and its number as the ordinal, so a reader that joins
-- brokerage -> evaluation -> credit finds a paid report exactly as it finds a free one.
create or replace view public.evaluation_credit_all as
  select c.evaluation_id, c.ordinal, c.idempotency_key, c.report_id, c.issued_at
    from public.evaluation_credit c
  union all
  select e.evaluation_id, p.number, p.idempotency_key, p.report_id, p.issued_at
    from public.brokerage_paid_credit p
    join public.evaluation e on e.brokerage_id = p.brokerage_id;

-- ---- 6. THE PLAN STATE (derived, never stored) -------------------------------------------------------------------------
-- The brokerage's CURRENT binding is the latest LIVE one, else the latest test one. Its state comes from the latest event of THAT subscription
-- (public.payment_event_latest_id: processor time first, arrival to break a tie), through the ledger's own mapped_status:
--   test binding                   -> test_only   (never grants)
--   active                         -> paid        (the only state that grants)
--   trialing                       -> trialing
--   paused | past_due | unpaid     -> past_due
--   canceled                       -> canceled
--   unknown (any other word)       -> unknown     (never grants)
--   no event                       -> none
-- A brokerage that is not active is 'suspended' whatever its subscription says. No row at all means the brokerage never subscribed.
create or replace function public.billing_plan_of(p_brokerage uuid)
returns table (binding_id uuid, livemode boolean, bound_at timestamptz, processor_status text, mapped_status text, occurred_at timestamptz, state text)
language sql stable security definer set search_path = public, pg_temp
as $$
  with b as (
    select s.binding_id, s.processor, s.subscription_ref, s.livemode, s.bound_at
      from public.brokerage_subscription s
     where s.brokerage_id = p_brokerage
     order by s.livemode desc, s.bound_at desc, s.binding_id
     limit 1)
  select b.binding_id, b.livemode, b.bound_at, e.processor_status, e.mapped_status, e.occurred_at,
         case
           when not exists (select 1 from public.brokerage_account a where a.id = p_brokerage and a.status = 'active') then 'suspended'
           when not b.livemode then 'test_only'
           when e.mapped_status = 'active' then 'paid'
           when e.mapped_status is null then 'none'
           when e.mapped_status = 'trialing' then 'trialing'
           when e.mapped_status in ('paused', 'past_due', 'unpaid') then 'past_due'
           when e.mapped_status = 'canceled' then 'canceled'
           else 'unknown'
         end
    from b
    left join public.payment_event e on e.event_id = public.payment_event_latest_id(b.processor, b.livemode, b.subscription_ref)
$$;

-- ---- 7. THE WEBHOOK'S ONE WRITER ---------------------------------------------------------------------------------------
-- Binds the subscription to the brokerage the checkout named and records the event, in ONE transaction. Calls for one subscription are
-- serialised, so two first events racing bind it once. A subscription already bound to ANOTHER brokerage is refused and nothing is recorded.
-- `bound` is true only on the call that created the binding. The event is validated by public.payment_event_record (the ledger), not here.
create or replace function public.billing_event_apply(p_brokerage uuid, p_event jsonb)
returns table (outcome text, event_id bigint, is_latest boolean, bound boolean, state text)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_proc  text;
  v_ref   text;
  v_live  boolean;
  b       public.brokerage_subscription%rowtype;
  r       record;
  v_bound boolean := false;
begin
  if p_brokerage is null or not exists (select 1 from public.brokerage_account a where a.id = p_brokerage) then
    raise exception using errcode = 'EV012', message = 'BROKERAGE_UNKNOWN';
  end if;
  if jsonb_typeof(p_event) is distinct from 'object'
     or jsonb_typeof(p_event -> 'processor') is distinct from 'string'
     or jsonb_typeof(p_event -> 'subscription_ref') is distinct from 'string'
     or jsonb_typeof(p_event -> 'livemode') is distinct from 'boolean' then
    raise exception 'billing_event_apply: the event must be an object with a processor, a subscription_ref and a livemode' using errcode = '22023';
  end if;
  v_proc := p_event ->> 'processor';
  v_ref  := p_event ->> 'subscription_ref';
  v_live := (p_event ->> 'livemode')::boolean;
  perform pg_advisory_xact_lock(hashtextextended('billing|' || v_proc || '|' || v_live::text || '|' || v_ref, 0));

  select s.* into b from public.brokerage_subscription s where s.processor = v_proc and s.livemode = v_live and s.subscription_ref = v_ref;
  if found and b.brokerage_id <> p_brokerage then
    raise exception using errcode = 'EV011', message = 'BINDING_CONFLICT';
  end if;

  select * into r from public.payment_event_record(p_event);
  if not found then
    raise exception 'billing_event_apply: the ledger returned nothing';
  end if;

  if b.binding_id is null then
    insert into public.brokerage_subscription (brokerage_id, processor, subscription_ref, livemode)
    values (p_brokerage, v_proc, v_ref, v_live);
    v_bound := true;
  end if;
  return query select r.outcome, r.event_id, r.is_latest, v_bound, (select pl.state from public.billing_plan_of(p_brokerage) pl);
end $$;

-- ---- 8. THE ONE READER ----------------------------------------------------------------------------------------------
-- A member's billing: their brokerage, their role, the plan state, and this month's allotment, DERIVED (the count of paid credits in the current
-- month). Nothing for a person with no active membership of an active brokerage. credits_remaining is 0 unless the plan is paid. This is what the
-- Billing section and the report gate read; neither re-derives a count or a state. The brokerage id is for the SERVER only: it rides in a checkout's
-- custom data (signed) and is never sent to a browser.
create or replace function public.billing_usage(p_user_id uuid)
returns table (brokerage_id uuid, role text, state text, credit_limit integer, credits_used integer, credits_remaining integer, period_ends_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select r.brokerage_id, r.role,
         coalesce(pl.state, 'none'),
         public.billing_report_limit(),
         case when pl.state = 'paid' then u.n else 0 end,
         case when pl.state = 'paid' then greatest(public.billing_report_limit() - u.n, 0) else 0 end,
         case when pl.state = 'paid' then public.billing_period_end(pl.bound_at, public.billing_period_index(pl.bound_at, now())) end
    from public.brokerage_membership_of(p_user_id) r
    left join lateral public.billing_plan_of(r.brokerage_id) pl on true
    cross join lateral (
      select count(*)::integer as n from public.brokerage_paid_credit c
       where pl.binding_id is not null and c.binding_id = pl.binding_id
         and c.period_index = public.billing_period_index(pl.bound_at, now())) u
$$;

-- ---- 9. THE ONE ISSUING ENTRY -----------------------------------------------------------------------------------------
-- The helper that charges the PAID month. Executable by nobody: only brokerage_report_issue (the owner) reaches it, so there is one way in.
create or replace function public.billing_paid_issue(
  p_brokerage       uuid,
  p_binding         uuid,
  p_bound_at        timestamptz,
  p_idempotency_key uuid,
  p_body            text,
  p_content_hash    text,
  p_report_version  text,
  p_engine_inputs   jsonb,
  p_private         jsonb
) returns table (report_id uuid, generated_at timestamptz, private_context_id uuid, credit_ordinal integer, credits_used integer, credits_remaining integer, period_ends_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_idx    integer := public.billing_period_index(p_bound_at, now());
  v_used   integer;
  v_number integer;
  v_snap   record;
begin
  select count(*)::integer into v_used from public.brokerage_paid_credit c where c.binding_id = p_binding and c.period_index = v_idx;
  if v_used >= public.billing_report_limit() then
    raise exception using errcode = 'EV010', message = 'ALLOTMENT_COMPLETE';
  end if;
  select public.evaluation_report_limit() + count(*)::integer + 1 into v_number from public.brokerage_paid_credit c where c.brokerage_id = p_brokerage;
  -- the snapshot BEFORE the ledger row and in the SAME transaction: a refusal by the snapshot raises out and rolls everything back, so a failure costs no report
  select s.* into v_snap from public.report_snapshot_issue(p_body, p_content_hash, p_report_version, p_engine_inputs, p_private) s;
  insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id)
  values (p_binding, p_brokerage, v_idx, v_used + 1, v_number, p_idempotency_key, v_snap.report_id);
  return query select v_snap.report_id, v_snap.generated_at, v_snap.private_context_id, v_used + 1, v_used + 1,
                      public.billing_report_limit() - (v_used + 1), public.billing_period_end(p_bound_at, v_idx);
end $$;

-- THE entry. Entitlement (the resolver, again after the lock) -> a retried key, in either ledger -> which allotment -> the charge.
-- The lock is the brokerage's evaluation row, the same row evaluation_report_issue takes, so the two ledgers are serialised together.
create or replace function public.brokerage_report_issue(
  p_user_id         uuid,
  p_idempotency_key uuid,
  p_body            text,
  p_content_hash    text,
  p_report_version  text,
  p_engine_inputs   jsonb,
  p_private         jsonb default null
) returns table (report_id uuid, generated_at timestamptz, private_context_id uuid, replayed boolean,
                 credit_ordinal integer, credits_used integer, credits_remaining integer, evaluation_status text,
                 allotment text, period_ends_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  m       record;
  ev      public.evaluation%rowtype;
  pl      record;
  v_prior record;
  v_used  integer;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'brokerage_report_issue: needs READ COMMITTED (the retry and allotment answers are serialised on a row lock that refreshes what the check sees only there; this transaction is at %)',
      current_setting('transaction_isolation') using errcode = '55000';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  select r.* into m from public.brokerage_membership_of(p_user_id) r;
  if not found then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  select e.* into ev from public.evaluation e where e.brokerage_id = m.brokerage_id for update;
  if not found then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  select r.* into m from public.brokerage_membership_of(p_user_id) r where r.brokerage_id = ev.brokerage_id;
  -- the evaluation row's standing is the ACCOUNT's standing for everything, paid or not: a revoked or expired one is no access (the readers
  -- hide its reports on the same test), so a payment cannot reopen an account HomeSignal ended. Payment adds an allotment, never standing.
  if not found or ev.status = 'revoked' or (ev.expires_at is not null and ev.expires_at <= now()) then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;

  -- 1. a retried key in the PAID ledger returns the stored report and charges nothing
  select c.ordinal, c.report_id, c.binding_id, c.period_index into v_prior
    from public.brokerage_paid_credit c where c.brokerage_id = m.brokerage_id and c.idempotency_key = p_idempotency_key;
  if found then
    select count(*)::integer into v_used from public.brokerage_paid_credit c where c.binding_id = v_prior.binding_id and c.period_index = v_prior.period_index;
    return query
      select s.report_id, s.generated_at, s.private_context_id, true, v_prior.ordinal, v_used,
             public.billing_report_limit() - v_used, 'paid'::text, 'paid'::text,
             public.billing_period_end((select b.bound_at from public.brokerage_subscription b where b.binding_id = v_prior.binding_id), v_prior.period_index)
        from public.report_snapshot s where s.report_id = v_prior.report_id;
    return;
  end if;

  -- 2. which allotment: the paid month when the plan is paid and the key is not already a free report's; otherwise the free evaluation
  select p.* into pl from public.billing_plan_of(m.brokerage_id) p;
  if not found or pl.state is distinct from 'paid'
     or exists (select 1 from public.evaluation_credit c where c.evaluation_id = ev.evaluation_id and c.idempotency_key = p_idempotency_key) then
    -- the free evaluation's own function decides (and answers a retried key without charging): unchanged
    return query
      select t.report_id, t.generated_at, t.private_context_id, t.replayed, t.credit_ordinal, t.credits_used, t.credits_remaining,
             t.evaluation_status, 'trial'::text, null::timestamptz
        from public.evaluation_report_issue(p_user_id, p_idempotency_key, p_body, p_content_hash, p_report_version, p_engine_inputs, p_private) t;
    return;
  end if;
  return query
    select i.report_id, i.generated_at, i.private_context_id, false, i.credit_ordinal, i.credits_used, i.credits_remaining,
           'paid'::text, 'paid'::text, i.period_ends_at
      from public.billing_paid_issue(m.brokerage_id, pl.binding_id, pl.bound_at, p_idempotency_key, p_body, p_content_hash,
                                     p_report_version, p_engine_inputs, p_private) i;
end $$;

-- ---- 10. THE SPLICE: the six ownership readers read the ONE view ---------------------------------------------------------
-- Each function's LIVE definition is read from the catalog, its one `public.evaluation_credit c` is replaced by `public.evaluation_credit_all c`
-- and the result is executed. Nothing is retyped. Fail-closed: a function must contain the anchor EXACTLY ONCE (or already read the view and
-- not the table); after the replace it must read the view, not the table; and its security, volatility, search path and privileges must be
-- exactly what they were. Idempotent: a second run finds nothing to change.
do $splice$
declare
  f      text;
  oid_   oid;
  def    text;
  newdef text;
  before_ record;
  after_  record;
  n      integer;
begin
  foreach f in array array[
    'public.evaluation_reports_of(uuid)', 'public.evaluation_report_open(uuid, uuid)',
    'public.evaluation_report_shares_of(uuid, uuid)', 'public.evaluation_report_share_revoke(uuid, uuid)',
    'public.report_share_open(text)', 'public.evaluation_property_watches_of(uuid)'] loop
    oid_ := to_regprocedure(f)::oid;
    def  := pg_get_functiondef(oid_);
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into before_ from pg_proc p where p.oid = oid_;
    n := (length(def) - length(replace(def, 'public.evaluation_credit c', ''))) / length('public.evaluation_credit c');
    if def like '%public.evaluation_credit_all c%' then
      continue;                                   -- already spliced: nothing to do
    end if;
    if n <> 1 then
      raise exception 'brokerage_billing: % reads public.evaluation_credit % times (expected exactly 1); refusing to splice', f, n;
    end if;
    newdef := replace(def, 'public.evaluation_credit c', 'public.evaluation_credit_all c');
    if newdef = def or newdef like '%public.evaluation_credit c%' or newdef not like '%public.evaluation_credit_all c%' then
      raise exception 'brokerage_billing: the splice of % did not take', f;
    end if;
    execute newdef;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into after_ from pg_proc p where p.oid = to_regprocedure(f)::oid;
    if after_ is distinct from before_ then
      raise exception 'brokerage_billing: the splice of % changed its security, volatility, search path, owner or privileges', f;
    end if;
    if pg_get_functiondef(to_regprocedure(f)::oid) not like '%public.evaluation_credit_all c%' then
      raise exception 'brokerage_billing: % does not read the ownership view after the splice', f;
    end if;
  end loop;
end $splice$;

-- ---- 11. THE AUDIT: every invariant as a count that must be zero, beside controls that must not be ---------------------------
create or replace function public.billing_check()
returns table (check_name text, kind text, violations bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select 'bindings_total'::text, 'control'::text, count(*) from public.brokerage_subscription
  union all select 'paid_credits_total', 'control', count(*) from public.brokerage_paid_credit
  union all select 'paid_credit_on_a_test_binding', 'invariant', count(*) from public.brokerage_paid_credit c
    join public.brokerage_subscription b on b.binding_id = c.binding_id where not b.livemode
  union all select 'paid_credit_in_the_wrong_month', 'invariant', count(*) from public.brokerage_paid_credit c
    join public.brokerage_subscription b on b.binding_id = c.binding_id
   where c.period_index <> public.billing_period_index(b.bound_at, c.issued_at)
  union all select 'ordinal_gaps_in_a_month', 'invariant', count(*) from
    (select c.binding_id from public.brokerage_paid_credit c group by c.binding_id, c.period_index having max(c.ordinal) <> count(*)) g
  union all select 'number_gaps_for_a_brokerage', 'invariant', count(*) from
    (select c.brokerage_id from public.brokerage_paid_credit c group by c.brokerage_id
      having max(c.number) <> public.evaluation_report_limit() + count(*)) g
  union all select 'paid_credit_without_a_snapshot', 'invariant', count(*) from public.brokerage_paid_credit c
    where not exists (select 1 from public.report_snapshot s where s.report_id = c.report_id)
  union all select 'report_owned_twice', 'invariant', count(*) from
    (select a.report_id from public.evaluation_credit_all a group by a.report_id having count(*) > 1) d
  union all select 'brokerage_without_an_evaluation_has_paid_credit', 'invariant', count(*) from public.brokerage_paid_credit c
    where not exists (select 1 from public.evaluation e where e.brokerage_id = c.brokerage_id)
  -- the known limit: a paying brokerage whose evaluation has an end date that has passed cannot see its reports (D-L3: no evaluation is made with one)
  union all select 'paid_brokerage_with_an_expired_evaluation', 'invariant', count(*) from public.evaluation e
    where e.status = 'active' and e.expires_at is not null and e.expires_at <= now()
      and exists (select 1 from public.billing_plan_of(e.brokerage_id) p where p.state = 'paid')
$$;

-- ---- 12. LOCK-DOWN: system-only --------------------------------------------------------------------------------------------
-- Supabase's default privileges open every new table, view and function in `public` to anon and authenticated; revoke by name, enable RLS
-- with no policy on the tables (deny by default), grant back nothing on them, and grant execute on the functions to service_role alone.
alter table public.brokerage_subscription enable row level security;
alter table public.brokerage_paid_credit  enable row level security;
revoke all on public.brokerage_subscription from public, anon, authenticated, service_role;
revoke all on public.brokerage_paid_credit  from public, anon, authenticated, service_role;
revoke all on public.evaluation_credit_all  from public, anon, authenticated, service_role;

revoke all on function public.billing_report_limit()                                  from public, anon, authenticated, service_role;
revoke all on function public.billing_period_index(timestamptz, timestamptz)          from public, anon, authenticated, service_role;
revoke all on function public.billing_period_end(timestamptz, integer)                from public, anon, authenticated, service_role;
revoke all on function public.billing_append_only()                                   from public, anon, authenticated, service_role;
revoke all on function public.brokerage_paid_credit_guard()                           from public, anon, authenticated, service_role;
revoke all on function public.billing_plan_of(uuid)                                   from public, anon, authenticated, service_role;
revoke all on function public.billing_event_apply(uuid, jsonb)                        from public, anon, authenticated, service_role;
revoke all on function public.billing_usage(uuid)                                     from public, anon, authenticated, service_role;
revoke all on function public.billing_paid_issue(uuid, uuid, timestamptz, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.brokerage_report_issue(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.billing_check()                                         from public, anon, authenticated, service_role;
grant execute on function public.billing_report_limit()                               to service_role;
grant execute on function public.billing_period_index(timestamptz, timestamptz)       to service_role;
grant execute on function public.billing_period_end(timestamptz, integer)             to service_role;
grant execute on function public.billing_plan_of(uuid)                                to service_role;
grant execute on function public.billing_event_apply(uuid, jsonb)                     to service_role;
grant execute on function public.billing_usage(uuid)                                  to service_role;
grant execute on function public.brokerage_report_issue(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;
grant execute on function public.billing_check()                                      to service_role;

-- ---- 13. POST-CONDITION ----------------------------------------------------------------------------------------------------
-- Computed over every function and relation this file owns, so one added later that is open to a resident role fails here.
do $post$
declare
  f   record;
  t   text;
  bad text;
begin
  for f in select p.oid, p.oid::regprocedure::text as sig, p.proname
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'billing\_%' or p.proname like 'brokerage\_paid\_credit%' or p.proname = 'brokerage_report_issue') loop
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f.oid and a.grantee <> p.proowner
                  and (a.grantee <> (select oid from pg_roles where rolname = 'service_role') or a.privilege_type <> 'EXECUTE'
                       or f.proname in ('billing_append_only', 'brokerage_paid_credit_guard', 'billing_paid_issue'))) then
      raise exception 'brokerage_billing: % is executable by a role it should not be', f.sig;
    end if;
  end loop;
  foreach t in array array['public.brokerage_subscription', 'public.brokerage_paid_credit'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = t::regclass) then
      raise exception 'brokerage_billing: % must have row level security enabled', t;
    end if;
  end loop;
  foreach t in array array['public.brokerage_subscription', 'public.brokerage_paid_credit', 'public.evaluation_credit_all'] loop
    if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = t::regclass and a.grantee <> c.relowner) then
      raise exception 'brokerage_billing: % is open to a role it should not be', t;
    end if;
  end loop;
  for bad in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and not p.prosecdef
                and p.proname in ('billing_plan_of', 'billing_event_apply', 'billing_usage', 'billing_paid_issue', 'brokerage_report_issue', 'billing_check') loop
    raise exception 'brokerage_billing: % must be SECURITY DEFINER (the tables are closed to its caller)', bad;
  end loop;
  if public.billing_report_limit() <> 100 then
    raise exception 'brokerage_billing: the paid month is the founder''s 100 reports';
  end if;
end $post$;

-- ROLLBACK (this file only). Appropriate only before the first paid report: it DELETES paid credits' ledger by dropping the table.
-- The reverse splice puts the six readers back on public.evaluation_credit; it is computed from their live bodies, like the splice.
-- ROLLBACK-BEGIN
--   do $rb$ declare f text; def text; begin
--     foreach f in array array['public.evaluation_reports_of(uuid)', 'public.evaluation_report_open(uuid, uuid)', 'public.evaluation_report_shares_of(uuid, uuid)',
--       'public.evaluation_report_share_revoke(uuid, uuid)', 'public.report_share_open(text)', 'public.evaluation_property_watches_of(uuid)'] loop
--       def := pg_get_functiondef(to_regprocedure(f)::oid);
--       if def like '%public.evaluation_credit_all c%' then execute replace(def, 'public.evaluation_credit_all c', 'public.evaluation_credit c'); end if;
--     end loop; end $rb$;
--   drop view if exists public.evaluation_credit_all;
--   drop table if exists public.brokerage_paid_credit;
--   drop table if exists public.brokerage_subscription;
--   drop function if exists public.billing_check(), public.brokerage_report_issue(uuid, uuid, text, text, text, jsonb, jsonb),
--     public.billing_paid_issue(uuid, uuid, timestamptz, uuid, text, text, text, jsonb, jsonb), public.billing_usage(uuid),
--     public.billing_event_apply(uuid, jsonb), public.billing_plan_of(uuid), public.brokerage_paid_credit_guard(),
--     public.billing_period_end(timestamptz, integer), public.billing_period_index(timestamptz, timestamptz),
--     public.billing_append_only(), public.billing_report_limit();
-- ROLLBACK-END

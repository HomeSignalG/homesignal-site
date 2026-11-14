-- ============================================================================
-- PAID-ONLY INDIVIDUAL SIGNUP   (2026-11-14, founder: "Make NEW individual registrations paid-only: no free report credits")
-- SQL OF RECORD. NOT APPLIED. Review the IMPACT and the RECOVERY below, then apply through the approved runner (db-sql.yml from main).
--
-- WHAT IT DOES
--   Individual agents who register AFTER this is applied get no free reports. The ONLY way they can make a report is an active paid plan
--   (docs/brokerage-billing.sql: billing_plan_of(...).state = 'paid', 100 reports per monthly billing period). Every account that exists today
--   keeps exactly what it has: its free evaluation, its ledger, its paid plan, its billing. Nothing is rewritten, deleted or re-priced.
--
-- HOW (three small, additive changes; each function is SPLICED from its live definition, never retyped, and fails closed if its anchor moved)
--   1. public.evaluation.free_reports boolean NOT NULL DEFAULT true.  Adding a column with a constant default is a metadata-only change in
--      PostgreSQL 11+: no row is rewritten, and every existing evaluation reads TRUE (it keeps its free reports). Nothing else about the table moves.
--   2. public.individual_signup creates the evaluation with free_reports = FALSE. This is the ONLY writer of an individual account, so it is the
--      only place a new paid-only evaluation can come from. Brokerage accounts (created by HomeSignal for a quoted customer) keep the default TRUE.
--   3. ENFORCEMENT, in the database, not the page:
--        public.evaluation_report_issue   refuses (EV002 EVALUATION_COMPLETE, the answer the report function already maps) when the evaluation has
--                                          free_reports = false. brokerage_report_issue falls through to this function for every non-paid brokerage,
--                                          so an unpaid paid-only account cannot make a report by ANY path; a paid one never reaches it.
--        public.evaluation_usage          reports 0 free reports (limit 0, used n, remaining 0) for such an account, so every reader of "how many free
--                                          reports are left" (the report function's pre-check, the trial function's status, the workspace) agrees with
--                                          the refusal. The page reads this number; it holds none of its own.
--
-- IMPACT (measure before applying: the PRE-FLIGHT block at the foot prints the counts; the migration also refuses to run if an assumption fails)
--   * Existing accounts: unchanged. The post-condition proves every evaluation that existed before is still free_reports = true and that the count
--     of evaluations, credits and paid credits is identical before and after.
--   * New individual accounts: created with 0 free reports. Until a payment is confirmed by Paddle's signed event, they can sign in, see Billing
--     and subscribe; they cannot make a report. Their saved-report archive is empty and stays readable.
--   * Brokerage-invited members: unaffected (they belong to a brokerage's evaluation, free_reports = true by default).
--   * No payment-event, subscription, ledger or credit row is touched. The checkout kill switch is not touched by this file.
--
-- RECOVERY (only if something is wrong; none of it loses a customer's data)
--   * Fast, no data change: re-open free reports for new individuals by re-applying individual_signup's old insert (the ROLLBACK block at the foot).
--     Accounts created while this was live KEEP free_reports = false until set true by the ONE statement in the ROLLBACK block (it names them by the
--     column, so it can never touch an older account).
--   * The column is additive and harmless if left in place; dropping it is NOT part of recovery (it would orphan the enforcement lines).
--
-- Idempotent: safe to run twice (a second run finds every anchor already replaced and changes nothing). Fail-closed on every splice.
-- ============================================================================

begin;

do $mig$
declare
  v_evals_before   bigint;  v_credits_before bigint;  v_paid_before bigint := 0;
  v_evals_after    bigint;  v_credits_after  bigint;  v_paid_after  bigint := 0;
  f                text;
  oid_             oid;
  def              text;
  newdef           text;
  n                integer;
  before_          record;
  after_           record;
begin
  -- ---- 0. PRECONDITIONS --------------------------------------------------------------------------------------------------
  if to_regclass('public.evaluation') is null or to_regclass('public.evaluation_credit') is null
     or to_regclass('public.brokerage_account') is null
     or to_regprocedure('public.individual_signup(uuid, text)') is null
     or to_regprocedure('public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)') is null
     or to_regprocedure('public.evaluation_usage(uuid)') is null
     or to_regprocedure('public.brokerage_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)') is null then
    raise exception 'paid_only_individual_signup: apply docs/evaluation-entitlement.sql, docs/brokerage-billing.sql and docs/individual-agent-signup.sql first';
  end if;

  lock table public.evaluation in share row exclusive mode;      -- no evaluation is created or changed while the counts are taken

  select count(*) into v_evals_before from public.evaluation;
  select count(*) into v_credits_before from public.evaluation_credit;
  if to_regclass('public.brokerage_paid_credit') is not null then
    execute 'select count(*) from public.brokerage_paid_credit' into v_paid_before;
  end if;

  -- ---- 1. THE COLUMN: existing rows read TRUE (they keep their free reports) -------------------------------------------------
  alter table public.evaluation add column if not exists free_reports boolean not null default true;
  if (select count(*) from public.evaluation e where not e.free_reports) <> 0
     and not exists (select 1 from pg_proc p where p.proname = 'individual_signup' and pg_get_functiondef(p.oid) like '%free_reports%') then
    raise exception 'paid_only_individual_signup: an evaluation already has free_reports = false before this change set it; stop and look';
  end if;

  -- ---- 2. individual_signup: the new evaluation is paid-only ------------------------------------------------------------------
  oid_ := to_regprocedure('public.individual_signup(uuid, text)')::oid;
  def  := pg_get_functiondef(oid_);
  if def not like '%free_reports%' then
    n := (length(def) - length(replace(def, 'insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, 0)', ''))) / length('insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, 0)');
    if n <> 1 then
      raise exception 'paid_only_individual_signup: individual_signup''s evaluation insert appears % times (expected exactly 1); refusing to splice', n;
    end if;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into before_ from pg_proc p where p.oid = oid_;
    newdef := replace(def, 'insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, 0)',
                           'insert into public.evaluation (brokerage_id, seat_limit, free_reports) values (v_acct, 0, false)');
    execute newdef;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into after_ from pg_proc p where p.oid = oid_;
    if before_ is distinct from after_ then
      raise exception 'paid_only_individual_signup: individual_signup''s security, volatility, settings, owner or privileges changed';
    end if;
  end if;

  -- ---- 3a. evaluation_report_issue: refuse a paid-only evaluation (the one place every non-paid issue path ends) ---------------
  oid_ := to_regprocedure('public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)')::oid;
  def  := pg_get_functiondef(oid_);
  if def not like '%free_reports%' then
    n := (length(def) - length(replace(def, 'select count(*)::integer, coalesce(max(c.ordinal), 0) into v_used, v_max', ''))) / length('select count(*)::integer, coalesce(max(c.ordinal), 0) into v_used, v_max');
    if n <> 1 then
      raise exception 'paid_only_individual_signup: evaluation_report_issue''s ledger-count anchor appears % times (expected exactly 1); refusing to splice', n;
    end if;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into before_ from pg_proc p where p.oid = oid_;
    -- placed AFTER the retried-key answer (a report already made is still returned, never charged) and BEFORE anything is counted or stored
    newdef := replace(def, 'select count(*)::integer, coalesce(max(c.ordinal), 0) into v_used, v_max',
      E'if not ev.free_reports then\n    raise exception using errcode = ''EV002'', message = ''EVALUATION_COMPLETE'';   -- a paid-only account has no free reports: only an active paid plan makes one\n  end if;\n  select count(*)::integer, coalesce(max(c.ordinal), 0) into v_used, v_max');
    execute newdef;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into after_ from pg_proc p where p.oid = oid_;
    if before_ is distinct from after_ then
      raise exception 'paid_only_individual_signup: evaluation_report_issue''s security, volatility, settings, owner or privileges changed';
    end if;
  end if;

  -- ---- 3b. evaluation_usage: a paid-only account reports 0 free reports (limit 0, remaining 0) -------------------------------------
  oid_ := to_regprocedure('public.evaluation_usage(uuid)')::oid;
  def  := pg_get_functiondef(oid_);
  if def not like '%free_reports%' then
    f := 'public.evaluation_report_limit(), u.n, greatest(public.evaluation_report_limit() - u.n, 0)';
    n := (length(def) - length(replace(def, f, ''))) / length(f);
    if n <> 1 then
      raise exception 'paid_only_individual_signup: evaluation_usage''s limit expression appears % times (expected exactly 1); refusing to splice', n;
    end if;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into before_ from pg_proc p where p.oid = oid_;
    newdef := replace(def, f, 'case when e.free_reports then public.evaluation_report_limit() else 0 end, u.n, case when e.free_reports then greatest(public.evaluation_report_limit() - u.n, 0) else 0 end');
    execute newdef;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into after_ from pg_proc p where p.oid = oid_;
    if before_ is distinct from after_ then
      raise exception 'paid_only_individual_signup: evaluation_usage''s security, volatility, settings, owner or privileges changed';
    end if;
  end if;

  -- ---- 4. POST-CONDITIONS -------------------------------------------------------------------------------------------------------
  select count(*) into v_evals_after from public.evaluation;
  select count(*) into v_credits_after from public.evaluation_credit;
  if to_regclass('public.brokerage_paid_credit') is not null then
    execute 'select count(*) from public.brokerage_paid_credit' into v_paid_after;
  end if;
  if v_evals_after <> v_evals_before or v_credits_after <> v_credits_before or v_paid_after <> v_paid_before then
    raise exception 'paid_only_individual_signup: a row count moved (evaluations %->%, credits %->%, paid credits %->%)', v_evals_before, v_evals_after, v_credits_before, v_credits_after, v_paid_before, v_paid_after;
  end if;
  if (select count(*) from public.evaluation e where not e.free_reports) <> 0 then
    raise exception 'paid_only_individual_signup: an EXISTING evaluation lost its free reports; refusing to commit';
  end if;
  if pg_get_functiondef(to_regprocedure('public.individual_signup(uuid, text)')::oid) not like '%values (v_acct, 0, false)%'
     or pg_get_functiondef(to_regprocedure('public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)')::oid) not like '%if not ev.free_reports%'
     or pg_get_functiondef(to_regprocedure('public.evaluation_usage(uuid)')::oid) not like '%e.free_reports%' then
    raise exception 'paid_only_individual_signup: a splice did not take';
  end if;
  if exists (select 1 from public.evaluation_check() k where k.kind = 'invariant' and k.violations <> 0) then
    raise exception 'paid_only_individual_signup: an evaluation_check() invariant is not zero after the change';
  end if;
  raise notice 'paid_only_individual_signup: ok. evaluations % credits % paid credits % (all unchanged)', v_evals_after, v_credits_after, v_paid_after;
end $mig$;

commit;

-- PRE-FLIGHT (read-only; run first and compare with the NOTICE the apply prints):
--   select (select count(*) from public.evaluation) evaluations, (select count(*) from public.evaluation_credit) credits,
--          (select count(*) from public.brokerage_account where account_type = 'individual') individual_accounts;

-- ROLLBACK (recovery; see the header). ROLLBACK-BEGIN
--   -- 1. new individuals get free reports again: restore the original insert
--   --    (run docs/individual-agent-signup.sql, which defines individual_signup with the original two-column insert).
--   -- 2. accounts created while paid-only was live stay paid-only until reopened by naming the column:
--   --    update public.evaluation set free_reports = true where free_reports = false;     -- run only if the founder wants them reopened
--   -- 3. evaluation_report_issue / evaluation_usage: re-run docs/evaluation-entitlement.sql section 11 and 12 definitions (their original text).
-- ROLLBACK-END

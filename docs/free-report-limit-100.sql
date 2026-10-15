-- ============================================================================
-- FREE DEVELOPMENT ACTIVITY REPORTS: 10 -> 100  (founder, 2026-10-15)
-- MIGRATION. PARKED: NOT APPLIED to production. Applying it needs the founder's separate go.
--
-- WHAT CHANGES
--   public.evaluation_report_limit()  10 -> 100. That function is the ONE definition of the free allowance; the ledger's ordinal CHECK,
--   the 'complete' trigger and guard, the issue function's refusal and the usage reader all ask it, so none of them is edited for the
--   number. No ledger row is written, changed or deleted (a person's USED count is the count of their ledger rows).
--
-- THE ONE DATA CHANGE: evaluations that completed at the OLD limit are reopened
--   An evaluation that used all of the old free reports is 'complete', and evaluation_guard() makes 'complete' terminal (it can only be
--   revoked). Under the new limit it has reports left, and evaluation_check() would report complete_without_a_full_ledger. This file
--   flips such an evaluation back to 'active' (status only; usage unchanged) by disabling evaluation_guard_trg for that one UPDATE inside
--   this transaction, then re-enabling it. Measured 2026-10-15: 1 such evaluation (10 of 10 used).
--
-- FAIL CLOSED (writes nothing, says why)
--   * any paid credit (public.brokerage_paid_credit). Paid reports are numbered limit + n (from 11 today); at 100 free they would
--     collide with free numbers 11..100. Measured 2026-10-15: 0 exist. If one appears, this is a numbering decision: stop and ask.
--   * the live limit is neither 10 nor 100 (an unknown starting point).
--   * an evaluation_check() invariant is not zero after the change, or the audit returns no controls.
--
-- Idempotent. The paid month (public.billing_report_limit() = 100) and its price do not move.
-- ============================================================================

begin;
set local lock_timeout = '5s';

do $mig$
declare
  v_has_paid boolean := to_regclass('public.brokerage_paid_credit') is not null;
  v_paid     bigint := 0;
  v_bill     integer;
  v_cur      integer;
  v_flipped  integer;
begin
  if to_regclass('public.evaluation') is null or to_regclass('public.evaluation_credit') is null
     or to_regprocedure('public.evaluation_report_limit()') is null then
    raise exception 'free_report_limit_100: the evaluation entitlement (docs/evaluation-entitlement.sql) is not applied';
  end if;

  lock table public.evaluation_credit in share row exclusive mode;

  v_cur := public.evaluation_report_limit();
  if v_cur not in (10, 100) then
    raise exception 'free_report_limit_100: the live free limit is %, expected 10 (or 100 on a second run). Stop and ask the founder.', v_cur;
  end if;
  if v_has_paid then
    execute 'select count(*) from public.brokerage_paid_credit' into v_paid;
    if v_paid > 0 then
      raise exception 'free_report_limit_100: % paid credit(s) exist and were numbered from 11; free numbers 11..100 would collide with them. Stop and ask the founder.', v_paid;
    end if;
  end if;

  -- 1. THE ONE DEFINITION
  execute 'create or replace function public.evaluation_report_limit() returns integer language sql immutable as $f$ select 100 $f$';

  -- 2. reopen evaluations that completed under the old limit (status only; the guard is off for this one statement)
  alter table public.evaluation disable trigger evaluation_guard_trg;
  update public.evaluation e set status = 'active'
   where e.status = 'complete'
     and (select count(*) from public.evaluation_credit c where c.evaluation_id = e.evaluation_id) < public.evaluation_report_limit();
  get diagnostics v_flipped = row_count;
  alter table public.evaluation enable trigger evaluation_guard_trg;
  raise notice 'free_report_limit_100: % evaluation(s) reopened', v_flipped;

  -- 3. POST-CONDITION
  if public.evaluation_report_limit() <> 100 then
    raise exception 'free_report_limit_100: the free limit is not 100 after the change';
  end if;
  if (select count(*) from pg_trigger t where t.tgrelid = 'public.evaluation'::regclass and t.tgname = 'evaluation_guard_trg' and t.tgenabled = 'O') <> 1 then
    raise exception 'free_report_limit_100: evaluation_guard_trg is not enabled after the change';
  end if;
  if to_regprocedure('public.billing_report_limit()') is not null then
    execute 'select public.billing_report_limit()' into v_bill;
    if v_bill <> 100 then
      raise exception 'free_report_limit_100: the paid month is 100 reports and must not move';
    end if;
  end if;
  if exists (select 1 from public.evaluation_check() k where k.kind = 'invariant' and k.violations <> 0) then
    raise exception 'free_report_limit_100: an evaluation_check() invariant is not zero after the change: %',
      (select string_agg(k.check_name || '=' || k.violations, ', ') from public.evaluation_check() k where k.kind = 'invariant' and k.violations <> 0);
  end if;
  if (select count(*) from public.evaluation_check() k where k.kind = 'control') < 2 then
    raise exception 'free_report_limit_100: evaluation_check() returned no controls, so its zeros mean nothing';
  end if;
end $mig$;

commit;

-- ROLLBACK (only before any evaluation has used more than 10 reports; reopened evaluations stay 'active', which at limit 10 would read
-- active_with_a_full_ledger for one that has used 10):
-- ROLLBACK-BEGIN
--   create or replace function public.evaluation_report_limit() returns integer language sql immutable as $$ select 10 $$;
-- ROLLBACK-END

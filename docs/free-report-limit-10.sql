-- ============================================================================
-- FREE DEVELOPMENT ACTIVITY REPORTS: 20 -> 10  (founder, 2026-10-05)
-- MIGRATION. PARKED: NOT APPLIED to production. Applying it needs the founder's separate go (see the foot).
--
-- WHAT CHANGES
--   public.evaluation_report_limit()  20 -> 10. That function is the ONE definition of the free allowance. The ledger's ordinal
--   CHECK, the 'complete' trigger and guard, the issue function's refusal and the usage reader all ask it, so none of them is edited
--   for the number. Production still carries `select 20` (read 2026-10-05: 2 evaluations, 1 free credit, 0 paid credits).
--
--   What IS edited, by splicing the LIVE definition (never retyped), is the displayed REMAINING count, which becomes
--   greatest(limit - used, 0) in evaluation_usage and in the replay answer of evaluation_report_issue, so no reader can ever show a negative. (A NEW issue can never reach below zero: the issue function refuses at used >= limit first.)
--
-- WHAT DOES NOT CHANGE
--   The $79/month price, public.billing_report_limit() = 100, the paid ledger, every table, every grant, every trigger. No ledger row
--   is written, changed or deleted: a person's USED count is the count of their ledger rows, so existing usage is preserved by
--   construction and there is no counter to reset. remaining = max(0, 10 - used).
--
-- THE ONE DATA CHANGE, AND WHY IT IS NOT A RESET
--   An evaluation that has ALREADY used exactly 10 reports under the old limit is 'active' (the flip to 'complete' happens on the
--   ledger row that equals the limit, and the limit was 20). Under the new limit it has 0 left and the issue function refuses it,
--   but its status would still read 'active', which evaluation_check() reports as active_with_a_full_ledger. This file flips such an
--   evaluation to 'complete' and logs the 'completed' event, through the same guard a 10th report goes through. No usage changes.
--
-- FAIL CLOSED (the file refuses, writes nothing, and says why)
--   * any ledger row with ordinal > 10. A brokerage that has used 11..19 free reports under the old limit is real history this file
--     will not renumber, and the paid ledger's numbering (a paid report is numbered limit + n, from 11) would then collide with the
--     free numbers 11..19. That is a numbering decision, not a number change: it stops here and is surfaced.
--   * any paid credit (public.brokerage_paid_credit). Paid numbers were issued from 21; the audit's number_gaps_for_a_brokerage
--     expects limit + count, so a paid report issued before this change would read as a gap. Measured 2026-10-05: none exist.
--   * the live definitions no longer contain the text this file splices (anchor count must be exactly 1, or already spliced).
--
-- Idempotent: safe to run twice (the second run changes nothing). ROLLBACK is at the foot.
-- ============================================================================

begin;
set local lock_timeout = '5s';

do $mig$
declare
  v_old     text;
  v_new     text;
  v_def     text;
  v_n       integer;
  v_has_paid boolean := to_regclass('public.brokerage_paid_credit') is not null;
  v_paid    bigint := 0;
  v_bill    integer;
  v_over    bigint;
  v_flipped integer;
  v_pair    text[];
  v_pairs   text[][] := array[
    -- function signature, text now present, text after. The text now present must NOT be a substring of the text after (or a second run would find
    -- its own anchor again and wrap it twice), which is why the first pair carries the 'u.n, ' that precedes it.
    ['public.evaluation_usage(uuid)',
     'u.n, public.evaluation_report_limit() - u.n,',
     'u.n, greatest(public.evaluation_report_limit() - u.n, 0),'],
    ['public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)',
     '             public.evaluation_report_limit() - v_used, ev.status',
     '             greatest(public.evaluation_report_limit() - v_used, 0), ev.status']
  ];
  i integer;
begin
  -- ---- preconditions ------------------------------------------------------------------------------------------------------
  if to_regclass('public.evaluation') is null or to_regclass('public.evaluation_credit') is null
     or to_regprocedure('public.evaluation_report_limit()') is null
     or to_regprocedure('public.evaluation_usage(uuid)') is null
     or to_regprocedure('public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)') is null then
    raise exception 'free_report_limit_10: the evaluation entitlement (docs/evaluation-entitlement.sql) is not applied';
  end if;

  -- block new ledger rows until this transaction ends, so the checks below cannot be overtaken by a report being issued under 20
  lock table public.evaluation_credit in share row exclusive mode;

  select count(*) into v_over from public.evaluation_credit c where c.ordinal > 10;
  if v_over > 0 then
    raise exception 'free_report_limit_10: % ledger row(s) carry an ordinal above 10. Existing free usage above 10 is preserved history, and the paid numbering would collide with it; this file does not renumber it. Stop and ask the founder.', v_over;
  end if;
  if v_has_paid then
    execute 'select count(*) from public.brokerage_paid_credit' into v_paid;
    if v_paid > 0 then
      raise exception 'free_report_limit_10: % paid credit(s) already exist and were numbered from 21; the number audit would read them as gaps. Stop and ask the founder.', v_paid;
    end if;
  end if;

  -- ---- 1. THE ONE DEFINITION -------------------------------------------------------------------------------------------------
  -- create or replace keeps the owner, the grants and the dependents (the CHECK, the guard and the trigger read it by name).
  execute 'create or replace function public.evaluation_report_limit() returns integer language sql immutable as $f$ select 10 $f$';

  -- ---- 2. THE DISPLAYED REMAINING NEVER GOES BELOW ZERO: splice the live definitions ---------------------------------------
  for i in 1 .. array_length(v_pairs, 1) loop
    v_old := v_pairs[i][2];
    v_new := v_pairs[i][3];
    v_def := pg_get_functiondef(to_regprocedure(v_pairs[i][1]));
    if position(v_new in v_def) > 0 and position(v_old in v_def) = 0 then
      continue;                                                   -- already spliced (a second run)
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    if v_n <> 1 then
      raise exception 'free_report_limit_10: the anchor for % appears % times (expected exactly 1): %', v_pairs[i][1], v_n, v_old;
    end if;
    execute replace(v_def, v_old, v_new);
    v_def := pg_get_functiondef(to_regprocedure(v_pairs[i][1]));
    if position(v_new in v_def) = 0 or position(v_old in v_def) > 0 then
      raise exception 'free_report_limit_10: the splice of % did not take', v_pairs[i][1];
    end if;
  end loop;

  -- ---- 3. an evaluation that already used exactly 10 is complete (status and event only; no ledger row is touched) ----------
  with done as (
    update public.evaluation e set status = 'complete'
     where e.status = 'active'
       and (select count(*) from public.evaluation_credit c where c.evaluation_id = e.evaluation_id) >= public.evaluation_report_limit()
    returning e.evaluation_id
  ), ev as (
    insert into public.evaluation_event (evaluation_id, kind) select d.evaluation_id, 'completed' from done d returning 1
  )
  select count(*) into v_flipped from ev;
  raise notice 'free_report_limit_10: % evaluation(s) that had already used 10 are now complete', v_flipped;

  -- ---- 4. POST-CONDITION ------------------------------------------------------------------------------------------------------
  if public.evaluation_report_limit() <> 10 then
    raise exception 'free_report_limit_10: the free limit is not 10 after the change';
  end if;
  if to_regprocedure('public.billing_report_limit()') is not null then
    execute 'select public.billing_report_limit()' into v_bill;   -- dynamic: the billing layer may be absent, and a missing function is a parse error, not a skipped branch
    if v_bill <> 100 then
      raise exception 'free_report_limit_10: the paid month is the founder''s 100 reports and must not move';
    end if;
  end if;
  if exists (select 1 from public.evaluation_check() k where k.kind = 'invariant' and k.violations <> 0) then
    raise exception 'free_report_limit_10: an evaluation_check() invariant is not zero after the change: %',
      (select string_agg(k.check_name || '=' || k.violations, ', ') from public.evaluation_check() k where k.kind = 'invariant' and k.violations <> 0);
  end if;
  if (select count(*) from public.evaluation_check() k where k.kind = 'control') < 2 then
    raise exception 'free_report_limit_10: evaluation_check() returned no controls, so its zeros mean nothing';
  end if;
end $mig$;

commit;

-- ROLLBACK (appropriate only before any evaluation has used more than 10 reports; the CHECK would otherwise be unaffected but a
-- rolled-back 'complete' status is NOT reverted: the evaluations flipped above stay complete, which the guard would refuse to reopen).
-- ROLLBACK-BEGIN
--   create or replace function public.evaluation_report_limit() returns integer language sql immutable as $$ select 20 $$;
--   -- then re-run the three splices in reverse (swap each pair's two strings), computed from the live definitions.
-- ROLLBACK-END

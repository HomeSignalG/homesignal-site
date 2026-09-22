-- ============================================================================
-- STEP 3C · SAFETY FIX — THE STEP-3A VIEWS WERE ANON-READABLE
-- Applied 2026-09-22 as migration dc_step3a_views_are_not_anon_readable_20260922.
-- DDL of record. This file is the reproducible copy; production already carries it.
-- ============================================================================
--
-- THE DEFECT, MEASURED BEFORE THE FIX, WITH A CONTROL THAT PASSES:
--
--   anon SELECT public.dc_source_observation   (TABLE) -> REFUSED 42501       <- correct
--   anon SELECT public.dc_current_observation  (VIEW)  -> 2174 ROWS RETURNED  <- the defect
--   anon SELECT public.dc_identity_candidate   (VIEW)  -> readable            <- the defect
--
-- The control is what makes this unambiguous: the underlying table refuses anon, so the rows
-- can only have arrived through the view. The entire CURRENT evidence plane was readable with
-- the public anon key that every shipped page carries.
--
-- CAUSE. Step 2A/3A locked the six dc_* TABLES correctly (RLS enabled, no anon grant). The two
-- Step-3A VIEWS were created without `security_invoker`, so they execute with the OWNER's
-- rights and read straight through RLS, and they inherited the project's DEFAULT PRIVILEGES,
-- which grant anon and authenticated ALL privileges. Neither half was deliberate.
--
-- This is the trap CLAUDE.md §7.1 already records in as many words:
--   "create or replace view DROPS reloptions -- MEASURED, and it is a privilege escalation."
-- Step 3A was written by the same session that had read that paragraph, and still shipped it.
-- The lesson is that the rule needed a CHECK, not a reader: a grant audit is one query and it
-- was never run until an adversarial pass ran it.
--
-- TWO INDEPENDENT FIXES, DELIBERATELY BOTH:
--   (1) REVOKE                     -- removes the grant, so the view is unreachable.
--   (2) security_invoker = true    -- so that if a grant is ever re-added (a default-privilege
--                                     change, a later CREATE OR REPLACE), RLS on the tables
--                                     beneath still applies and the view cannot leak.
-- Either alone is a guard that stops guarding the day somebody re-grants. Both is a boundary.
--
-- NO RESIDENT IMPACT. No shipped page, lib or edge function reads any dc_* object -- that is
-- what scripts/check-dc-step2a-isolation.mjs exists to enforce, and it was re-run after this
-- change. PRECHANGE_RESIDENT_MD5 == POSTCHANGE_RESIDENT_MD5 == 4d4b97757acbe1276f7775fe2efbefdd.

revoke all on public.dc_current_observation from anon, authenticated;
revoke all on public.dc_identity_candidate  from anon, authenticated;

alter view public.dc_current_observation set (security_invoker = true);
alter view public.dc_identity_candidate  set (security_invoker = true);

-- FAIL CLOSED. A migration that reports success without proving the grant is gone is the same
-- class of defect it is repairing.
do $verify$
declare
  n_grants  int;
  n_invoker int;
begin
  select count(*) into n_grants
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('dc_current_observation','dc_identity_candidate')
     and grantee in ('anon','authenticated');
  if n_grants <> 0 then
    raise exception 'anon/authenticated still hold % grant(s) on the Step-3A views', n_grants;
  end if;

  select count(*) into n_invoker
    from pg_class
   where relname in ('dc_current_observation','dc_identity_candidate')
     and 'security_invoker=true' = any (reloptions);
  if n_invoker <> 2 then
    raise exception 'expected 2 security_invoker views, found %', n_invoker;
  end if;

  if (select count(*) from public.dc_source_observation) <> 6348 then
    raise exception 'evidence row count moved during a GRANT-only migration';
  end if;
end
$verify$;

-- VERIFIED LIVE AFTER APPLY, IN BOTH DIRECTIONS (a revoke that also broke the legitimate path
-- would be a worse bug than the one being fixed):
--   reloptions dc_current_observation : security_invoker=true
--   anon/authenticated grants on any dc_* object : 0
--   anon via dc_current_observation : REFUSED [42501] permission denied for view
--   anon via dc_identity_candidate  : REFUSED [42501]
--   POSITIVE CONTROL, postgres      : 2174 rows (view still usable)
--   EVIDENCE UNCHANGED              : 6348 observations

-- ============================================================================
-- DDL OF RECORD for migration 20260922164122 dc_step3a_views_are_not_anon_readable_20260922
-- ============================================================================
-- Everything between the BEGIN/END markers below is the statement AS APPLIED, byte for
-- byte: read back from supabase_migrations.schema_migrations.statements on 2026-09-22 and
-- fingerprinted  length 2681  md5 eefe2851d6f40b03696667cc13763114.
-- test/dc-step3c-reconcile.test.mjs section 7 recomputes that fingerprint from this file.
--
-- WHY THIS FILE WAS REWRITTEN. Commit d76d96c (another session's Step 3C work) committed a
-- file here that was a later REVISION of this migration, not the statement that ran:
--   same executable statements, but a different, longer comment set.
-- A DDL of record that is not the applied statement cannot reproduce production, which is
-- the only thing a DDL of record is for. So this is not a correction to the migration --
-- production is unchanged -- it is a correction to the RECORD of it.
-- ============================================================================
-- ----- BEGIN APPLIED STATEMENT -----
-- STEP 3C · SAFETY FIX (defect introduced by Step 3A, found by adversarial review 2026-09-22)
--
-- MEASURED BEFORE THIS MIGRATION, with a control that passes:
--   anon SELECT public.dc_source_observation  (TABLE) -> REFUSED 42501        <- correct
--   anon SELECT public.dc_current_observation (VIEW)  -> 2174 ROWS RETURNED   <- the defect
--
-- CAUSE. The six Step-2A/3A TABLES are RLS-enabled and carry no anon grant. The two Step-3A
-- VIEWS inherited the project's default privileges (anon + authenticated, ALL privileges) and
-- were created WITHOUT security_invoker, so they execute with the OWNER's rights and read
-- straight through RLS. That is the `page_cache` posture reached by omission, and it is the
-- same trap CLAUDE.md §7.1 already records: "create or replace view DROPS reloptions -- it is
-- a privilege escalation".
--
-- TWO INDEPENDENT FIXES, deliberately both:
--   (1) REVOKE  -- removes the grant that makes the view reachable at all.
--   (2) security_invoker = true -- so if a grant is ever re-added (a default-privilege change,
--       a later CREATE OR REPLACE), RLS on the underlying tables still applies and the view
--       cannot leak. One of these alone is a guard that stops guarding the day someone
--       re-grants.
--
-- NO RESIDENT IMPACT: no shipped page, lib or edge function reads any dc_* object (the Step-2A
-- isolation gate exists to enforce exactly that), so this changes nothing a resident sees.

revoke all on public.dc_current_observation from anon, authenticated;
revoke all on public.dc_identity_candidate  from anon, authenticated;

alter view public.dc_current_observation set (security_invoker = true);
alter view public.dc_identity_candidate  set (security_invoker = true);

do $verify$
declare
  n_grants int;
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

  -- the evidence itself must be untouched by a grant change
  if (select count(*) from public.dc_source_observation) <> 6348 then
    raise exception 'evidence row count moved during a GRANT-only migration';
  end if;
end
$verify$;
-- ----- END APPLIED STATEMENT -----

-- VERIFIED LIVE AFTER APPLY, IN BOTH DIRECTIONS (a revoke that also broke the legitimate path
-- would be a worse bug than the one being fixed):
--   reloptions dc_current_observation : security_invoker=true
--   anon/authenticated grants on any dc_* object : 0
--   anon via dc_current_observation : REFUSED [42501] permission denied for view
--   anon via dc_identity_candidate  : REFUSED [42501]
--   POSITIVE CONTROL, postgres      : 2174 rows (view still usable)
--   EVIDENCE UNCHANGED              : 6348 observations

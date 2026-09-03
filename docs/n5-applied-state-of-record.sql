-- ============================================================================
-- INERT. NOT A MIGRATION. NOT PART OF #1016. DO NOT RUN.
-- ============================================================================
-- THIS DESCRIBES SQL ALREADY APPLIED TO PRODUCTION BY A PARALLEL SESSION;
-- IT MUST NOT BE RE-EXECUTED AS PART OF #1016.
--
-- The reconstruction, the ownership table, and the exact-vs-reconstructed
-- distinction live in docs/n5-applied-state-of-record.md. This file exists so
-- that a workflow_dispatch of db-sql.yml against this path CANNOT replay the
-- already-applied statements: it raises before any other statement is reachable.
-- ============================================================================

do $inert$
begin
  raise exception
    'THIS DESCRIBES SQL ALREADY APPLIED TO PRODUCTION BY A PARALLEL SESSION; '
    'IT MUST NOT BE RE-EXECUTED AS PART OF #1016. '
    'Read docs/n5-applied-state-of-record.md. This file is inert on purpose.';
end $inert$;

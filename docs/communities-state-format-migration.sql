-- communities-state-format-migration.sql
-- Fixes one malformed `state` value and constrains the column so the class cannot recur.
--
-- Applied to project qwnnmljucajnexpxdgxr (migration names: fix_denver_80249_state_code,
-- communities_state_two_letter_check). Parked here per CLAUDE.md §1 source #3: schema
-- changes are reproducible SQL.
--
-- WHY THIS EXISTS
-- `Denver (80249)` carried state = 'Colorado' -- the only one of 12,723 level=zip rows not
-- using the two-letter code every other row uses. Coverage gates and the per-state seed
-- scripts both key on communities.state, so 'Colorado' != 'CO' excluded the page from every
-- Colorado source AND from the seed that would have cached it: it had no development_reports
-- row at all, while its neighbours 80239 / 80247 carried 350 / 266 records. One live Denver
-- page sat permanently on the EPA facilities floor because of a typo in one string.
--
-- After the fix and a refresh, 80249 carries 199 development records from BOTH Denver sources
-- (denver-commercial-construction-permits, denver-residential-construction-permits),
-- facilities 40, 0 missing record_url, 0 missing coordinates -- in range with its neighbours.
-- Nothing about the sources changed; only the string they are compared against.

-- 1. The data fix. Idempotent: guarded on id, the old value, level and zip_codes, so
--    re-running it is a no-op rather than a second write.
update public.communities
   set state = 'CO'
 where id = 'ac55f889-b265-4a1f-afee-7ffdd289ffd9'
   and state = 'Colorado'
   and level = 'zip'
   and zip_codes = array['80249'];

-- 2. The constraint that makes the class impossible.
--
--    `state is not null` is LOAD-BEARING, not decoration. SQL three-valued logic makes
--    `state ~ '^[A-Z]{2}$'` evaluate to NULL when state is NULL, `NULL` is not `false`, and a
--    CHECK ACCEPTS NULL -- so without that clause a NULL state would pass and would strand a
--    page in exactly the same way, because 'Colorado' and NULL are indistinguishable to the
--    gate: neither equals 'CO'. Same trap as the ingest repo's meetings_category_canonical_utah.
--
--    Verified before applying: all 13,293 rows across every level already matched, so the
--    constraint is added VALIDATED rather than NOT VALID.
alter table public.communities
  add constraint communities_state_two_letter
  check (state is not null and state ~ '^[A-Z]{2}$');

-- 3. Positive control -- run these after applying. Each of the first three MUST raise
--    SQLSTATE 23514; the fourth MUST succeed. A constraint nobody has tried to violate is
--    not evidence of anything.
--
--    update public.communities set state = 'Colorado' where id = '<a real id>';  -- 23514
--    update public.communities set state = null       where id = '<a real id>';  -- 23514
--    update public.communities set state = 'co'       where id = '<a real id>';  -- 23514
--    update public.communities set state = 'CO'       where id = '<a real id>';  -- ok
--
--    Observed 2026-08-13 against ac55f889-b265-4a1f-afee-7ffdd289ffd9: rejected, rejected,
--    rejected, accepted; 13,293 / 13,293 rows conforming afterwards.

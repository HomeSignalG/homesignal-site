-- GIN index on communities.zip_codes — ROOT-CAUSE FIX for the 2026-07-16 15:21 UTC
-- database restart (founder-diagnosed; postgres logs confirm).
--
-- WHY: every ZIP→community resolution goes through `communities.zip_codes @> array[zip]`
-- (the engine's resolveCommunityIds, ad-hoc per-state reconciliation joins, seed probes).
-- With ~12,666 level=zip rows and NO index on zip_codes, the planner ran a nested-loop
-- seq scan (~236k row visits on the reconciliation join; logged plan cost 711k, 13.7 s),
-- which under verifier + batch load hit statement_timeout repeatedly and pushed the
-- instance into a restart. A GIN index on the text[] turns @> into an index scan.
--
-- Applied as migration `communities_zip_codes_gin_index` (2026-07-16). Plain CREATE
-- INDEX rather than CONCURRENTLY: Supabase migrations run transactionally (CONCURRENTLY
-- is not allowed in a transaction block) and the table is ~12.6k rows, so the write-lock
-- is milliseconds. On a table this size the index build itself is sub-second.
--
-- VERIFY (plan must show a Bitmap Index Scan on the GIN index, not a seq scan):
--   explain select id from public.communities where zip_codes @> array['92101'];

create index if not exists idx_communities_zip_codes_gin
  on public.communities using gin (zip_codes);

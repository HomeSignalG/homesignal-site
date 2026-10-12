-- ============================================================================
-- dev_refresh_collect(): THE "blocked" CTE MUST NOT BE ABLE TO CHOOSE A FULL-TABLE HASH JOIN (2026-10-12)
--
-- WHAT WAS MEASURED (read-only, production, 2026-10-12 ~01:10Z; no production object touched)
-- ----------------------------------------------------------------------------
-- Step (d) of dev_refresh_collect() decides which ZIPs a failed source blocks with
--     blocked as ( select distinct zip from resp r, lateral dev_failed_sources(r.j) f
--                  where exists ( select 1 from development_reports d, lateral jsonb_array_elements(d.sites) e
--                                  where d.zip = r.zip and e->>'source_registry_id' = f.registry_id ) )
-- Postgres flattens that EXISTS into a SEMI JOIN and prices it from the SIZE OF THE RESPONSE SET:
--     1 / 8 / 12 response ids  -> Nested Loop Semi Join, index scan on development_reports_pkey, 15-19 ms
--     16 response ids          -> Hash Semi Join whose build side is  development_reports x jsonb_array_elements(d.sites)
--                                 i.e. EVERY site of EVERY one of 12,722 ZIPs (planner estimate 1,272,200 rows, cost 72,212)
-- The hash side is only built when the outer side yields a row, so the plan is harmless until one of the 16 responses
-- carries a "fetch failed:" source (Maine DOT rate-limited, Fairfax "Token Required", NV DOT ...). Then the tick expands the
-- entire national cache. Same SELECT, same data, 16 ids, production:
--     default plan ........................ cancelled at the 45 s test cap (statement_timeout)
--     hash and merge joins disabled ....... 15 ms, 741 buffers
-- The 16 is the batch cap (docs/dev-refresh-collect-batch-cap.sql): a normal tick holds 8 responses, a burst fills the cap.
--
-- WHY IT LOOKS LIKE "EPISODES"
-- ----------------------------------------------------------------------------
-- A burst (60 answers at 23:26:26Z, the Maine DOT batch fired together) fills the cap at 16. The oldest 16 contain failed-source
-- answers, the tick runs past the 120 s statement_timeout and ROLLS BACK, cursor included, so the next tick selects the SAME 16, and so
-- on until those answers leave the 20-minute window (7-9 ticks). Measured 2026-10-11/12: all 15 failing episodes in the last 24 h begin
-- within minutes of a batch carrying maine-dot-public-projects / maine-dot-public-projects-lines fetch failures; the answers that
-- expire uncollected are the lost ones.
--
-- THE CHANGE (one expression, nothing else)
-- ----------------------------------------------------------------------------
-- EXISTS (...)  ->  (select count(*) from <same two relations, same predicates>) > 0
-- A scalar subquery is never flattened into a join, so the lookup stays a per-(response, failed source) index probe of ONE row of
-- development_reports (zip is its primary key) at every set size. Meaning is unchanged: exists <=> count > 0.
-- Step (a)'s "scored" CTE already uses this shape and is not touched. No guard, threshold, cap, timeout, retry rule or batch size
-- changes; no response is skipped or dropped; the cursor, completeness and refusal logic are byte-identical.
--
-- SPLICE, NOT A RETYPE (CLAUDE.md claims rule 7). Live body before: md5(prosrc) 2012877397532a1e8e160b5a7a4c8032, 15,800 chars.
-- One anchor, must occur exactly once; idempotent; refuses to patch blind; the result is checked and the replacement reversed.
-- Rollback: the same replacement in reverse. NOT APPLIED to production by this file's commit.
-- ============================================================================

do $mig$
declare
  src   text;
  old_  text := $a$    where exists (
      select 1 from public.development_reports d,
                    lateral jsonb_array_elements(d.sites) e
       where d.zip = (r.j->>'zip')
         and e->>'source_registry_id' = f.registry_id)
$a$;
  new_  text := $b$    -- (PLAN-STABLE, docs/dev-refresh-collect-blocked-plan-stable.sql) a scalar COUNT, not EXISTS: EXISTS is flattened to a
    -- semi join, which at a full 16-response set is priced as a hash join over every site of every ZIP.
    where (select count(*)
             from public.development_reports d,
                  lateral jsonb_array_elements(d.sites) e
            where d.zip = (r.j->>'zip')
              and e->>'source_registry_id' = f.registry_id) > 0
$b$;
  n int;
  after text;
begin
  select pg_get_functiondef('public.dev_refresh_collect()'::regprocedure) into src;
  if src is null then
    raise exception 'public.dev_refresh_collect() not found; refusing to patch nothing';
  end if;
  if position('(PLAN-STABLE' in src) > 0 then
    raise notice 'blocked plan-stable change already present; no change';
    return;
  end if;
  if position('(0-cap)' in src) = 0 then
    raise exception 'batch cap missing: apply docs/dev-refresh-collect-batch-cap.sql first';
  end if;
  n := (length(src) - length(replace(src, old_, ''))) / length(old_);
  if n <> 1 then
    raise exception 'blocked EXISTS anchor found % times (expected 1); refusing to patch blind', n;
  end if;
  execute replace(src, old_, new_);

  select pg_get_functiondef('public.dev_refresh_collect()'::regprocedure) into after;
  if (length(after) - length(replace(after, '(PLAN-STABLE', ''))) / length('(PLAN-STABLE') <> 1 then
    raise exception 'plan-stable marker not present exactly once after the splice';
  end if;
  if position(old_ in after) > 0 then
    raise exception 'the EXISTS form survived the splice';
  end if;
  if replace(after, new_, old_) <> src then
    raise exception 'reversing the replacement does not give back the original definition';
  end if;
end
$mig$;

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
-- SPLICE, NOT A RETYPE (CLAUDE.md claims rule 7), AND FAIL-CLOSED ON TWO FINGERPRINTS (both are md5(pg_proc.prosrc), never md5 of
-- pg_get_functiondef, which is a different representation):
--   ORIGINAL  md5 2012877397532a1e8e160b5a7a4c8032, 15,800 chars   (production, read-only, 2026-10-11/12)
--   PATCHED   md5 12b3dcc680b322af7d2cd61734be9b4c, 16,047 chars   (computed SEPARATELY, in Python, from the production body with this
--                                                                  file's one replacement; the apply recomputes it BEFORE it executes
--                                                                  anything and again after, and refuses unless all three agree)
-- Anything else is refused: a drifted body, a half-patched body, a body that merely carries the PLAN-STABLE marker. Re-applying is a
-- no-op ONLY on the exact PATCHED fingerprint. Owner, SECURITY DEFINER, search_path, return type, language, volatility, ACL and the
-- dependency set must be identical before and after, and the function definition with its body removed must be byte-identical.
-- Everything runs in one transaction with a short lock_timeout; any raise rolls the whole thing back (DDL is transactional).
-- Reversal: docs/dev-refresh-collect-blocked-plan-stable-reverse.sql.  Procedure: docs/dev-refresh-collect-blocked-plan-stable-runbook.md.
-- NOT APPLIED to production by this file's commit.
-- ============================================================================

\set ON_ERROR_STOP on
\echo APPLY dev_refresh_collect blocked-plan-stable: start
begin;
set local lock_timeout = '3s';                       -- DDL waits for the function's lock behind running ticks: bounded, retry later
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '60s';

do $mig$
declare
  c_orig_md5 constant text := '2012877397532a1e8e160b5a7a4c8032';
  c_orig_len constant int  := 15800;
  c_new_md5  constant text := '12b3dcc680b322af7d2cd61734be9b4c';
  c_new_len  constant int  := 16047;
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
  fn   regprocedure;
  cur  record;
  props_before text;
  props_after  text;
  src_def text; src_body text; expect_body text; after_body text; after_def text;
  n int;
begin
  begin
    fn := 'public.dev_refresh_collect()'::regprocedure;
  exception when others then
    raise exception 'REFUSED: public.dev_refresh_collect() does not exist (%)', sqlerrm;
  end;

  select pp.prosrc, md5(pp.prosrc) m, length(pp.prosrc) l,
         pp.prosecdef sd, pp.proconfig cfg, pp.prorettype::regtype::text rt, l.lanname lang, pp.pronargs na, pp.proretset rs,
         pp.proleakproof lk, pp.proisstrict st, pp.provolatile vol, pp.proparallel par, pp.proowner::regrole::text ow, pp.proacl::text acl
    into cur from pg_proc pp join pg_language l on l.oid = pp.prolang where pp.oid = fn;

  -- absolute properties: these are what the function IS in production
  if not (cur.sd and cur.lang = 'plpgsql' and cur.rt = 'integer' and cur.na = 0 and not cur.rs
          and cur.cfg is not distinct from array['search_path=public, net']::text[]) then
    raise exception 'REFUSED: signature or security properties differ from the approved ones (secdef %, lang %, returns %, args %, setof %, config %)',
      cur.sd, cur.lang, cur.rt, cur.na, cur.rs, cur.cfg;
  end if;

  props_before := concat_ws('|', cur.ow, cur.acl, cur.lk, cur.st, cur.vol, cur.par,
    (select md5(coalesce(string_agg(d.refclassid::regclass::text || ':' || d.refobjid || ':' || d.deptype::text, ',' order by d.refclassid::regclass::text collate "C", d.refobjid, d.deptype::text), ''))
       from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = fn::oid),
    (select count(*) from pg_depend d where d.refclassid = 'pg_proc'::regclass and d.refobjid = fn::oid));

  raise notice 'EVIDENCE before: md5=% len=% owner=% acl=%', cur.m, cur.l, cur.ow, cur.acl;

  if cur.m = c_new_md5 and cur.l = c_new_len then
    raise notice 'EVIDENCE already at the approved PATCHED fingerprint %; nothing changed', c_new_md5;
    return;
  end if;
  if cur.m <> c_orig_md5 or cur.l <> c_orig_len then
    raise exception 'REFUSED: md5(prosrc) % / % chars is neither the approved ORIGINAL (% / %) nor the approved PATCHED (% / %); body has drifted or is half-patched',
      cur.m, cur.l, c_orig_md5, c_orig_len, c_new_md5, c_new_len;
  end if;

  n := (length(cur.prosrc) - length(replace(cur.prosrc, old_, ''))) / length(old_);
  if n <> 1 then
    raise exception 'REFUSED: the EXISTS anchor occurs % times in the body (expected exactly 1)', n;
  end if;
  expect_body := replace(cur.prosrc, old_, new_);
  if md5(expect_body) <> c_new_md5 or length(expect_body) <> c_new_len then
    raise exception 'REFUSED: the planned replacement fingerprints to % / %, not the approved PATCHED % / %', md5(expect_body), length(expect_body), c_new_md5, c_new_len;
  end if;

  src_def := pg_get_functiondef(fn);
  if (length(src_def) - length(replace(src_def, cur.prosrc, ''))) / length(cur.prosrc) <> 1 then
    raise exception 'REFUSED: the function definition does not contain its body exactly once';
  end if;
  execute replace(src_def, old_, new_);

  -- ── verify the result against the SEPARATELY established fingerprint, and that ONLY the intended expression changed ──
  select prosrc into after_body from pg_proc where oid = fn;
  if md5(after_body) <> c_new_md5 or length(after_body) <> c_new_len or after_body <> expect_body then
    raise exception 'ROLLED BACK: patched body is % / %, approved PATCHED is % / %', md5(after_body), length(after_body), c_new_md5, c_new_len;
  end if;
  if replace(after_body, new_, old_) <> cur.prosrc then
    raise exception 'ROLLED BACK: reversing the replacement does not give back the original body';
  end if;
  after_def := pg_get_functiondef(fn);
  if replace(after_def, after_body, '@BODY@') <> replace(src_def, cur.prosrc, '@BODY@') then
    raise exception 'ROLLED BACK: the function header/attributes changed';
  end if;
  select concat_ws('|', p2.proowner::regrole::text, p2.proacl::text, p2.proleakproof, p2.proisstrict, p2.provolatile, p2.proparallel,
    (select md5(coalesce(string_agg(d.refclassid::regclass::text || ':' || d.refobjid || ':' || d.deptype::text, ',' order by d.refclassid::regclass::text collate "C", d.refobjid, d.deptype::text), ''))
       from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = fn::oid),
    (select count(*) from pg_depend d where d.refclassid = 'pg_proc'::regclass and d.refobjid = fn::oid))
    into props_after from pg_proc p2 where p2.oid = fn;
  if props_after <> props_before then
    raise exception 'ROLLED BACK: owner/ACL/attributes/dependencies changed (% -> %)', props_before, props_after;
  end if;
  if (select not (prosecdef and proconfig is not distinct from array['search_path=public, net']::text[]) from pg_proc where oid = fn) then
    raise exception 'ROLLED BACK: security properties changed';
  end if;
  raise notice 'EVIDENCE after: md5=% len=% (approved PATCHED); only the one expression changed; owner/ACL/config/dependencies identical', md5(after_body), length(after_body);
end
$mig$;

commit;
\echo APPLY dev_refresh_collect blocked-plan-stable: committed

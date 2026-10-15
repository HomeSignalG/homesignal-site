-- ============================================================================
-- REVERSAL of docs/dev-refresh-collect-blocked-plan-stable.sql: restores the approved ORIGINAL dev_refresh_collect() body.
-- Runs only if md5(prosrc) is exactly the approved PATCHED fingerprint 12b3dcc680b322af7d2cd61734be9b4c (16,047 chars); if the body is
-- already the ORIGINAL 2012877397532a1e8e160b5a7a4c8032 (15,800) it changes nothing; ANY other body (an intervening change) is refused and left
-- untouched. Same checks as the apply: signature/security properties, owner, ACL, attributes, dependencies identical before/after, header
-- byte-identical, one transaction, bounded lock_timeout, rollback on any raise.  NOT APPLIED to production by this file's commit.
-- ============================================================================
\set ON_ERROR_STOP on
\echo REVERSE dev_refresh_collect blocked-plan-stable: start
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

  if cur.m = c_orig_md5 and cur.l = c_orig_len then
    raise notice 'EVIDENCE already at the approved ORIGINAL fingerprint %; nothing changed', c_orig_md5;
    return;
  end if;
  if cur.m <> c_new_md5 or cur.l <> c_new_len then
    raise exception 'REFUSED: md5(prosrc) % / % chars is neither the approved PATCHED (% / %) nor the approved ORIGINAL (% / %); an intervening change is present and is NOT overwritten',
      cur.m, cur.l, c_new_md5, c_new_len, c_orig_md5, c_orig_len;
  end if;

  n := (length(cur.prosrc) - length(replace(cur.prosrc, new_, ''))) / length(new_);
  if n <> 1 then
    raise exception 'REFUSED: the COUNT block occurs % times in the body (expected exactly 1)', n;
  end if;
  expect_body := replace(cur.prosrc, new_, old_);
  if md5(expect_body) <> c_orig_md5 or length(expect_body) <> c_orig_len then
    raise exception 'REFUSED: the planned reversal fingerprints to % / %, not the approved ORIGINAL % / %', md5(expect_body), length(expect_body), c_orig_md5, c_orig_len;
  end if;

  src_def := pg_get_functiondef(fn);
  if (length(src_def) - length(replace(src_def, cur.prosrc, ''))) / length(cur.prosrc) <> 1 then
    raise exception 'REFUSED: the function definition does not contain its body exactly once';
  end if;
  execute replace(src_def, new_, old_);

  -- ── verify the result against the SEPARATELY established fingerprint, and that ONLY the intended expression changed ──
  select prosrc into after_body from pg_proc where oid = fn;
  if md5(after_body) <> c_orig_md5 or length(after_body) <> c_orig_len or after_body <> expect_body then
    raise exception 'ROLLED BACK: restored body is % / %, approved ORIGINAL is % / %', md5(after_body), length(after_body), c_orig_md5, c_orig_len;
  end if;
  if replace(after_body, old_, new_) <> cur.prosrc then
    raise exception 'ROLLED BACK: re-applying the replacement does not give back the patched body';
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
  raise notice 'EVIDENCE after: md5=% len=% (approved ORIGINAL); only the one expression changed; owner/ACL/config/dependencies identical', md5(after_body), length(after_body);
end
$mig$;

commit;
\echo REVERSE dev_refresh_collect blocked-plan-stable: committed

-- ============================================================================
-- dev_refresh_collect — ONE FAILED SOURCE NO LONGER FREEZES THE WHOLE REPORT   (SQL OF RECORD; NOT APPLIED by this commit)
-- ============================================================================
-- WHY (founder, 2026-11-05): CORE GUARD 1 refused the whole ZIP write whenever any source that already had records on the
-- page failed to answer. One dead source therefore froze every other source on that page too. Measured 2026-11-05 over
-- all 12,744 development_reports: 690 older than 7 days, 74 older than 30 days, every one retried in the last 72 h;
-- the blocking sources were caltrans-sb1-projects 483 pages, fairfax-recent-building-permits 64, kcmo 49,
-- fairfax-active-site-construction 47, sd-stip-structures 26, chattanooga-permits-archive 26, huntsville 25.
--
-- THE NEW RULE: a source that failed this read keeps its LAST STORED records on the page; every other source refreshes.
--   * Before the write, public.dev_with_carried_sources(j) appends the stored project records of each failed source to the
--     response's sites and adds them to its counts, using the engine's own counting rules (get-address-report/index.ts:
--     proposed / approved / operating by `type`, proposed_active by sources/decision.ts isActiveUndecided, proposed_decided,
--     comment_open, development = the three bands). Every later expression in step (d), CORE GUARD 2 included, therefore
--     sees the full page, exactly as if the source had answered with what it last said.
--   * A source is carried only when this response holds NO record of it (a partial answer is never padded with old rows),
--     and only project records are carried (facility records carry `registry_id` and belong to the EPA plane).
--   * Nothing is deleted because a source timed out or demanded a login. The failure is still logged in
--     dev_refresh_source_failures (kind fetch_failed) with blocked_update = false and detail.carried_forward = n, and the
--     page's source-freshness box already says, from the same connector reports, that this source's latest read did not
--     complete and its records are from an earlier read.
--   * CORE GUARD 2 (unexplained reduction to zero on a fresh row), the shape guard, the EPA plane and the cursor are unchanged.
--
-- FINGERPRINTS (prosrc):
--   ORIGINAL  md5 5afbb78376a080f2d9eb095335476a53, 16,091 chars  (production, read 2026-11-05; rebuilt locally from
--             test/dev_collect_harness + dev-refresh-collect-blocked-plan-stable.sql + dev-frs-start-hint.sql PART 3 and equal)
--   PATCHED   md5 b17263cc5eca232dbde8fc33e27093e4, 16593 chars  (computed separately, in Python, by test/dev_collect_carry_pg/expected.py)
-- Refused: any other body. Re-applying is a no-op only on the exact PATCHED fingerprint. Header, owner, ACL, config and
-- dependencies must be identical before and after. One transaction, short lock_timeout.
-- Reversal: docs/dev-refresh-collect-carry-failed-sources-reverse.sql.
-- ============================================================================

\set ON_ERROR_STOP on
\echo APPLY dev_refresh_collect carry-failed-sources: start
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '60s';

-- PART 1 — the helper (additive). It reads the stored row only when this response reports a failed source.
create or replace function public.dev_with_carried_sources(_j jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $fn$
declare
  carried jsonb;
  c jsonb;
begin
  if jsonb_typeof(_j->'sites') is distinct from 'array'
     or not exists (select 1 from public.dev_failed_sources(_j) f where f.registry_id is not null) then
    return _j;
  end if;

  select coalesce(jsonb_agg(x order by o), '[]'::jsonb)
    into carried
    from public.development_reports d,
         lateral jsonb_array_elements(case when jsonb_typeof(d.sites) = 'array' then d.sites else '[]'::jsonb end)
                 with ordinality t(x, o)
   where d.zip = (_j->>'zip')
     and not (x ? 'registry_id')
     and x->>'source_registry_id' in (
           select f.registry_id
             from public.dev_failed_sources(_j) f
            where f.registry_id is not null
              and not exists (select 1 from jsonb_array_elements(_j->'sites') s
                               where s->>'source_registry_id' = f.registry_id));

  if carried = '[]'::jsonb then
    return _j;
  end if;

  -- counts, by the engine's rules (index.ts COUNTS; decision.ts isActiveUndecided)
  select jsonb_build_object(
           'proposed',         count(*) filter (where x->>'type' = 'proposed'),
           'proposed_active',  count(*) filter (where x->>'type' = 'proposed'
                                 and coalesce(x->'decision', 'null'::jsonb) in ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '0'::jsonb)
                                 and coalesce(x->>'decided', '') not in ('true')
                                 and lower(trim(coalesce(x->>'status', ''))) <> 'decided'
                                 and lower(trim(coalesce(x->>'bucket', x->>'lifecycleBucket', x->>'status', x->>'type', ''))) = 'proposed'),
           'proposed_decided', count(*) filter (where x->>'type' = 'proposed' and x ? 'decision' and x->'decision' <> 'null'::jsonb),
           'approved',         count(*) filter (where x->>'type' = 'approved'),
           'operating',        count(*) filter (where x->>'type' = 'built'),
           'comment_open',     count(*) filter (where x->>'comment_open' = 'true'))
    into c
    from jsonb_array_elements(carried) x;

  return jsonb_set(
           jsonb_set(_j, '{sites}', (_j->'sites') || carried),
           '{counts}',
           coalesce(_j->'counts', '{}'::jsonb) || jsonb_build_object(
             'proposed',         coalesce((_j->'counts'->>'proposed')::int, 0)         + (c->>'proposed')::int,
             'proposed_active',  coalesce((_j->'counts'->>'proposed_active')::int, 0)  + (c->>'proposed_active')::int,
             'proposed_decided', coalesce((_j->'counts'->>'proposed_decided')::int, 0) + (c->>'proposed_decided')::int,
             'approved',         coalesce((_j->'counts'->>'approved')::int, 0)         + (c->>'approved')::int,
             'operating',        coalesce((_j->'counts'->>'operating')::int, 0)        + (c->>'operating')::int,
             'comment_open',     coalesce((_j->'counts'->>'comment_open')::int, 0)     + (c->>'comment_open')::int,
             'development',      coalesce((_j->'counts'->>'development')::int, 0)
                                 + (c->>'proposed')::int + (c->>'approved')::int + (c->>'operating')::int));
end
$fn$;
revoke all on function public.dev_with_carried_sources(jsonb) from public, anon, authenticated;

-- PART 2 — three exact replacements in the live collector.
do $mig$
declare
  c_orig_md5 constant text := '5afbb78376a080f2d9eb095335476a53';
  c_orig_len constant int  := 16091;
  c_new_md5  constant text := 'b17263cc5eca232dbde8fc33e27093e4';
  c_new_len  constant int  := 16593;
  olds text[] := array[
$a1$  insert into public.dev_refresh_source_failures
        (zip, registry_id, reason, cached_records, blocked_update, kind)
  select zip, registry_id, reason, cached_records, cached_records > 0, 'fetch_failed' from scored;
$a1$,
$a2$  -- (d) write — TWO INDEPENDENT PLANES composed into one row.
  with resp as (
    select r.id as rid, r.content::jsonb as j
$a2$,
$a3$    -- CORE GUARD 1 — per-source fetch failure where that source already contributes.
    -- dev_failed_sources() reads the first-party connector reports only; EPA reports through
    -- j->'epa'->>'ok' and can never appear here.
    and not exists (select 1 from blocked b where b.zip = d.zip)
$a3$];
  news text[] := array[
$b1$  -- (CARRY, docs/dev-refresh-collect-carry-failed-sources.sql) a failed source no longer blocks the write: step (d) keeps
  -- its stored records. blocked_update is therefore false; detail.carried_forward says how many records were kept.
  insert into public.dev_refresh_source_failures
        (zip, registry_id, reason, cached_records, blocked_update, kind, detail)
  select zip, registry_id, reason, cached_records, false, 'fetch_failed',
         jsonb_build_object('carried_forward', cached_records) from scored;
$b1$,
$b2$  -- (d) write — TWO INDEPENDENT PLANES composed into one row.
  -- (CARRY) j is the response with each failed source's stored project records appended and counted
  -- (public.dev_with_carried_sources), so every expression below sees the whole page.
  with resp as (
    select r.id as rid, public.dev_with_carried_sources(r.content::jsonb) as j
$b2$,
$b3$    -- (CARRY) CORE GUARD 1 is retired: a failed source's stored records are carried forward in resp.j instead of
    -- refusing the whole write (docs/dev-refresh-collect-carry-failed-sources.sql). The `blocked` CTE above is no
    -- longer referenced and is never evaluated.
$b3$];
  fn regprocedure := 'public.dev_refresh_collect()'::regprocedure;
  body text; after_body text; expect_body text; src_def text; after_def text; i int; n int;
  props_before text; props_after text;
begin
  select prosrc into body from pg_proc where oid = fn;
  raise notice 'EVIDENCE before: md5=% len=%', md5(body), length(body);
  if md5(body) = c_new_md5 and length(body) = c_new_len then
    raise notice 'EVIDENCE already at the PATCHED fingerprint %; nothing changed', c_new_md5;
    return;
  end if;
  if md5(body) <> c_orig_md5 or length(body) <> c_orig_len then
    raise exception 'REFUSED: md5(prosrc) % / % is neither ORIGINAL (% / %) nor PATCHED (% / %)',
      md5(body), length(body), c_orig_md5, c_orig_len, c_new_md5, c_new_len;
  end if;
  expect_body := body;
  for i in 1..3 loop
    n := (length(expect_body) - length(replace(expect_body, olds[i], ''))) / length(olds[i]);
    if n <> 1 then raise exception 'REFUSED: anchor % occurs % times (expected 1)', i, n; end if;
    expect_body := replace(expect_body, olds[i], news[i]);
  end loop;
  if md5(expect_body) <> c_new_md5 or length(expect_body) <> c_new_len then
    raise exception 'REFUSED: planned body fingerprints to % / %, not PATCHED % / %', md5(expect_body), length(expect_body), c_new_md5, c_new_len;
  end if;

  select concat_ws('|', p.proowner::regrole::text, p.proacl::text, p.prosecdef, p.proconfig::text, p.provolatile, p.proparallel,
    (select md5(coalesce(string_agg(d.refclassid::regclass::text || ':' || d.refobjid || ':' || d.deptype::text, ',' order by d.refclassid::regclass::text collate "C", d.refobjid, d.deptype::text), ''))
       from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = fn::oid))
    into props_before from pg_proc p where p.oid = fn;

  src_def := pg_get_functiondef(fn);
  if (length(src_def) - length(replace(src_def, body, ''))) / length(body) <> 1 then
    raise exception 'REFUSED: the function definition does not contain its body exactly once';
  end if;
  execute replace(src_def, body, expect_body);

  select prosrc into after_body from pg_proc where oid = fn;
  if after_body <> expect_body then
    raise exception 'ROLLED BACK: stored body % / % is not the planned body', md5(after_body), length(after_body);
  end if;
  after_def := pg_get_functiondef(fn);
  if replace(after_def, after_body, '@BODY@') <> replace(src_def, body, '@BODY@') then
    raise exception 'ROLLED BACK: the function header/attributes changed';
  end if;
  select concat_ws('|', p.proowner::regrole::text, p.proacl::text, p.prosecdef, p.proconfig::text, p.provolatile, p.proparallel,
    (select md5(coalesce(string_agg(d.refclassid::regclass::text || ':' || d.refobjid || ':' || d.deptype::text, ',' order by d.refclassid::regclass::text collate "C", d.refobjid, d.deptype::text), ''))
       from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = fn::oid))
    into props_after from pg_proc p where p.oid = fn;
  if props_after <> props_before then
    raise exception 'ROLLED BACK: owner/ACL/attributes/dependencies changed (% -> %)', props_before, props_after;
  end if;
  raise notice 'EVIDENCE after: md5=% len=% (PATCHED)', md5(after_body), length(after_body);
end
$mig$;

commit;
\echo APPLY dev_refresh_collect carry-failed-sources: committed

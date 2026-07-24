-- ============================================================================
-- Migration: app_refresh_zip_determinism_tiebreakers  (applied 2026-07-24)
-- Phase A / M1 of the Local News routing project (FD-1, approved with
-- modification). Diff-style record — the full resulting body of record lives in
-- docs/app-refresh-zip-gin-containment-migration.sql (M2, applied the same day);
-- the pre-Phase-A baseline is docs/app-refresh-zip-live-snapshot-2026-07-24.sql.
--
-- WHY (Phase A Addendum Obs 1-2, re-verified live): two capped materialization
-- branches had NO ORDER BY at all (planning & zoning, civic — top-6), and the
-- others could tie on their sort keys (development top-48 orders by a date that
-- ties/NULLs; ZIP 02108 selects 48 of 77 qualifying rows). SQL guarantees no
-- ordering on equal keys, so top-N selection was nondeterministic and
-- byte-identical replay was impossible even with unchanged sources.
--
-- FD-1 ORDERING CONTRACT (also documented inside the function body):
--   1. The existing business ordering is preserved exactly as the leading keys.
--   2. The tie-breaker decides ONLY when the business keys compare equal.
--   3. The final term is a stable, immutable unique key:
--        - md5(el::text)  for JSONB site elements (unique after
--          dev_sites_deduped(); jsonb text form is canonical),
--        - the row uuid `id` for alerts / meetings selects,
--        - communities.id for the ZIP->community resolution (limit 1).
--   4. Branches that had NO ordering (planning & zoning, civic) order by the
--      stable key alone — deterministic without inventing a business ranking;
--      any future ranking must be PREPENDED, keeping the stable key last.
--
-- THE EIGHT ORDERING SITES (before -> after):
--   ZIP resolution (limit 1):
--     order by (level='zip') desc, (level='city') desc limit 1
--       -> ... desc, id limit 1
--   development -> app_projects (limit 48):
--     order by <file/decision date> desc nulls last
--       -> ... desc nulls last, md5(el::text)
--   facilities -> app_projects (limit 16):
--     order by el->>'label'  ->  order by el->>'label', md5(el::text)
--   planning & zoning -> app_changes (limit 6):
--     (no order by)  ->  order by md5(el::text)
--   civic -> app_changes (limit 6):
--     (no order by)  ->  order by md5(el::text)
--   meetings -> app_changes (limit 8):
--     order by m.meeting_date asc  ->  ... asc, m.id
--   gov notices -> app_changes (limit 48):
--     order by a.created_at desc  ->  ... desc, a.id
--   Local News -> app_changes (limit 48):
--     order by a.created_at desc  ->  ... desc, a.id
--   (The `select id into _root from up order by d desc limit 1` ancestor walk is
--   exempt: depth d is unique in a linear parent chain, so it cannot tie.)
--
-- SELECTION-DELTA NOTE (founder-acknowledged): on pages where more rows qualify
-- than the cap AND the business keys tie at the boundary, M1 permanently fixes
-- WHICH rows win; the previously arbitrary winners may change once at migration
-- time, then never again. Ranking logic itself is unchanged.
--
-- HOW IT WAS APPLIED — guarded server-side rewrite (no hand-pasted body): the
-- migration below reads the live pg_get_functiondef, ABORTS unless it is the
-- audited baseline (md5 1b4dbc18316353ce8efbc3b1ac8d422a), asserts each anchor
-- matches exactly once (twice for the shared top-48 anchor), applies the
-- replacements, executes the result, and ABORTS unless the new body round-trips
-- to md5 dbe9e6c099f036318b99064d40d5d081 (independently generated). A full
-- dry-run of this block (including a live refresh of pilot 84337) was executed
-- first inside a transaction and rolled back via a sentinel exception.
--
-- EVIDENCE (docs/local-news-phase-a-evidence-report.md): idempotency — two
-- consecutive runs of app_refresh_zip('84337') produce identical normalized
-- page digests; determinism — ZIP 02108 (48-of-77) produces an identical
-- development-selection digest across repeated runs; runtime unchanged
-- (~28-33 ms per ZIP before and after).
--
-- REVERT: apply docs/app-refresh-zip-live-snapshot-2026-07-24.sql
-- (drill-verified: restore -> baseline md5 match -> refresh ran).
-- ============================================================================

do $mig$
declare src text; body text; n int; newmd5 text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname='app_refresh_zip';
  if md5(src) <> '1b4dbc18316353ce8efbc3b1ac8d422a' then
    raise exception 'baseline md5 mismatch: %', md5(src);
  end if;
  body := src;

  n := (length(body) - length(replace(body, $o1$begin
  select id, county into _cid$o1$, ''))) / length($o1$begin
  select id, county into _cid$o1$);
  if n <> 1 then raise exception 'anchor r1 matched %', n; end if;
  body := replace(body, $o1$begin
  select id, county into _cid$o1$, $n1$begin
  -- FD-1 ordering contract (determinism): every capped select keeps its original
  -- business ordering as the leading key(s); a stable, immutable unique key is
  -- appended as the FINAL term (md5(el::text) for JSONB site elements -- unique
  -- after dev_sites_deduped(); the row uuid id for alerts/meetings; communities.id
  -- for ZIP resolution) and decides order ONLY when the business keys compare
  -- equal. Branches that had no ordering at all (planning & zoning, civic) order
  -- by the stable key alone; any future business ranking must be PREPENDED,
  -- keeping the stable key as the last term.
  select id, county into _cid$n1$);

  n := (length(body) - length(replace(body, $o2$order by (level='zip') desc, (level='city') desc limit 1;$o2$, ''))) / length($o2$order by (level='zip') desc, (level='city') desc limit 1;$o2$);
  if n <> 1 then raise exception 'anchor r2 matched %', n; end if;
  body := replace(body, $o2$order by (level='zip') desc, (level='city') desc limit 1;$o2$,
                        $n2$order by (level='zip') desc, (level='city') desc, id limit 1;$n2$);

  n := (length(body) - length(replace(body, $o3$end desc nulls last
    limit 48;$o3$, ''))) / length($o3$end desc nulls last
    limit 48;$o3$);
  if n <> 1 then raise exception 'anchor r3 matched %', n; end if;
  body := replace(body, $o3$end desc nulls last
    limit 48;$o3$, $n3$end desc nulls last,
      md5(el::text)
    limit 48;$n3$);

  n := (length(body) - length(replace(body, $o4$order by el->>'label'
    limit 16;$o4$, ''))) / length($o4$order by el->>'label'
    limit 16;$o4$);
  if n <> 1 then raise exception 'anchor r4 matched %', n; end if;
  body := replace(body, $o4$order by el->>'label'
    limit 16;$o4$, $n4$order by el->>'label', md5(el::text)
    limit 16;$n4$);

  n := (length(body) - length(replace(body, $o5$      and coalesce(el->>'record_url', el->>'url','')<>''
    limit 6;$o5$, ''))) / length($o5$      and coalesce(el->>'record_url', el->>'url','')<>''
    limit 6;$o5$);
  if n <> 1 then raise exception 'anchor r5 matched %', n; end if;
  body := replace(body, $o5$      and coalesce(el->>'record_url', el->>'url','')<>''
    limit 6;$o5$, $n5$      and coalesce(el->>'record_url', el->>'url','')<>''
    order by md5(el::text)
    limit 6;$n5$);

  n := (length(body) - length(replace(body, $o6$='civic' and coalesce(el->>'record_url', el->>'url','')<>''
    limit 6;$o6$, ''))) / length($o6$='civic' and coalesce(el->>'record_url', el->>'url','')<>''
    limit 6;$o6$);
  if n <> 1 then raise exception 'anchor r6 matched %', n; end if;
  body := replace(body, $o6$='civic' and coalesce(el->>'record_url', el->>'url','')<>''
    limit 6;$o6$, $n6$='civic' and coalesce(el->>'record_url', el->>'url','')<>''
    order by md5(el::text)
    limit 6;$n6$);

  n := (length(body) - length(replace(body, $o7$order by m.meeting_date asc limit 8;$o7$, ''))) / length($o7$order by m.meeting_date asc limit 8;$o7$);
  if n <> 1 then raise exception 'anchor r7 matched %', n; end if;
  body := replace(body, $o7$order by m.meeting_date asc limit 8;$o7$,
                        $n7$order by m.meeting_date asc, m.id limit 8;$n7$);

  n := (length(body) - length(replace(body, $o8$order by a.created_at desc limit 48;$o8$, ''))) / length($o8$order by a.created_at desc limit 48;$o8$);
  if n <> 2 then raise exception 'anchor r8 matched %', n; end if;
  body := replace(body, $o8$order by a.created_at desc limit 48;$o8$,
                        $n8$order by a.created_at desc, a.id limit 48;$n8$);

  execute body;

  select md5(pg_get_functiondef(p.oid)) into newmd5
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname='app_refresh_zip';
  if newmd5 <> 'dbe9e6c099f036318b99064d40d5d081' then
    raise exception 'roundtrip md5 unexpected: %', newmd5;
  end if;
end $mig$;

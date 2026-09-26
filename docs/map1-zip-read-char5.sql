-- ============================================================================
-- MAP 1'S ZIP READ USES THE ZIP INDEX (2026-09-26). DDL OF RECORD.
-- One function: public.app_zip_projects_markers(text,text,boolean), the read Map 1's ZIP
-- mode makes for every visitor. Output is unchanged; only how the rows are found changes.
-- Rollback: docs/map1-zip-read-char5.rollback.sql (the exact inverse).
--
-- THE DEFECT. The serving keys are char(5): geo.zip_authoritative_membership.zcta5,
-- geo.zip_authoritative_marker.zcta5 and geo.maps_zip_geography_status.zip (read through the
-- geo.n5_serving_* views). The function compared them with its TEXT parameter p_zip.
-- Postgres has no char = text operator, so it casts the column, `(zcta5)::text = p_zip`, and
-- no index covers that expression. Every call therefore scanned the whole serving plane
-- (~900,000 membership rows twice, ~1,000,000 marker rows once) instead of one ZIP's rows.
--
-- MEASURED ON PRODUCTION 2026-09-26, before this change:
--   * pg_stat_statements, the PostgREST call shape: 411 calls, mean 4,562 ms, max 24,535 ms
--     (the function's own statement_timeout is 25 s), ~119,000 blocks read per call. A cold
--     call measured 30.1 s and failed; Map 1 then shows "Development coverage for ZIP ...
--     could not be read just now."
--   * The same marker read with a char(5) value: Index Scan, 68 blocks, 19 ms. With a text
--     value: Parallel Seq Scan, 46,802 blocks, 1,808 ms, 1,002,476 rows filtered away.
--   * public.app_authoritative_projects_for_zip (the ZIP page's reader) already copies p_zip
--     into a char(5) variable and compares that. This change gives Map 1's reader the same
--     shape.
--
-- WHY THE OUTPUT CANNOT CHANGE. p_zip is refused unless it matches ^[0-9]{5}$ before any
-- read, so the char(5) copy holds the same five characters. Every stored key is also exactly
-- five digits (measured 2026-09-26: 0 of 901,465 membership, 0 of 1,004,080 marker and 0 of
-- 12,719 status keys fail ^[0-9]{5}$). For five-digit values the char and text comparisons
-- select the same rows.
--
-- HOW IT IS APPLIED. The new definition is computed from the LIVE one, never retyped
-- (CLAUDE.md claims rule 7), and the block refuses unless the live body fingerprints to the
-- known pre-state (md5 5517dce94b4ed2dd9f6dc12b9c4389a8, which is also the executable
-- suite's fixture after PART C). If the body already fingerprints to the post-state it does
-- nothing. Each anchor must appear exactly the expected number of times, and each
-- replacement is checked on its own. After the CREATE OR REPLACE the body is re-read and
-- must fingerprint to 4918783a335244d4a7056b4922120c1c, and the owner, grants, SECURITY
-- DEFINER, STABLE, search_path and 25 s statement_timeout must be unchanged.
--
-- PROOF: test/n5_generation_pg/run_map1_char5.py (run by n5-generation-publish-suite.yml on
-- PostgreSQL 16 and 17). It builds the suite's production pre-state, shows that the plans
-- inside the function compare the key as text BEFORE the change (the control), applies this
-- file, and requires identical Map 1 output on every fixture ZIP, no text comparison of a
-- ZIP key in any plan inside the function, the ZIP in an index condition on all three serving
-- tables, and the attributes above. Reverting any one of the five comparisons must turn the
-- plan check red.
--
-- MEASURED AND DELIBERATELY NOT CHANGED: public.app_projects_for_zip compares
-- geo.n5_serving_status.zip with its text p_zip too, but that table holds 12,719 rows and the
-- function averaged 23.8 ms over 274,098 calls; it also does not validate p_zip first, so a
-- char(5) copy could raise on a long input where it now returns "unavailable". The geo.n5_*
-- diagnostic readers (n5_shadow_projects_for_zip, n5_authoritative_test_for_zip,
-- n5_a3_projects_one_pass, n5_a3_bench_one) serve no resident and are left as they are.
-- ============================================================================
do $splice$
declare
  fn        constant regprocedure := 'public.app_zip_projects_markers(text,text,boolean)'::regprocedure;
  pre_md5   constant text := '5517dce94b4ed2dd9f6dc12b9c4389a8';
  post_md5  constant text := '4918783a335244d4a7056b4922120c1c';
  src       text;
  newdef    text;
  got       int;
  attrs_before text;
  attrs_after  text;
  r         record;
begin
  perform set_config('lock_timeout', '5s', true);

  select p.prosrc into src from pg_proc p where p.oid = fn;
  if md5(src) = post_md5 then
    raise notice 'map1-zip-read-char5: already applied (body md5 %), nothing to do', post_md5;
    return;
  end if;
  if md5(src) <> pre_md5 then
    raise exception 'map1-zip-read-char5: the live body drifted (md5 %, expected %). Not applied.',
      md5(src), pre_md5;
  end if;

  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
    into attrs_before from pg_proc p where p.oid = fn;

  newdef := pg_get_functiondef(fn);
  for r in
    select * from (values
      (1, $n$  v_status   text;
begin$n$,
          $r$  v_status   text;
  v_zip      char(5);
begin$r$, 1),
      (2, $n$  if not p_authoritative then$n$,
          $r$  -- The geo ZIP keys are char(5). Compared with the text p_zip, every key is cast to text,
  -- which no index covers, so each call read the whole serving plane. p_zip is checked
  -- above to be exactly 5 digits, so this copy is exact. docs/map1-zip-read-char5.sql
  v_zip := p_zip;

  if not p_authoritative then$r$, 1),
      (3, $n$s.zip = p_zip$n$,    $r$s.zip = v_zip$r$,    1),
      (4, $n$mm.zcta5 = p_zip$n$, $r$mm.zcta5 = v_zip$r$, 3),
      (5, $n$k.zcta5 = p_zip$n$,  $r$k.zcta5 = v_zip$r$,  1)) v(n, needle, repl, want)
    order by n
  loop
    got := (length(newdef) - length(replace(newdef, r.needle, ''))) / length(r.needle);
    if got <> r.want then
      raise exception 'map1-zip-read-char5: anchor % appears % time(s), expected %. Not applied.',
        r.n, got, r.want;
    end if;
    newdef := replace(newdef, r.needle, r.repl);
    got := (length(newdef) - length(replace(newdef, r.repl, ''))) / length(r.repl);
    if got <> r.want then
      raise exception 'map1-zip-read-char5: replacement % landed % time(s), expected %. Not applied.',
        r.n, got, r.want;
    end if;
  end loop;

  execute newdef;

  select p.prosrc into src from pg_proc p where p.oid = fn;
  if md5(src) <> post_md5 then
    raise exception 'map1-zip-read-char5: the new body fingerprints to %, expected %. Rolled back.',
      md5(src), post_md5;
  end if;
  if src ~ '(zcta5|s\.zip) = p_zip' then
    raise exception 'map1-zip-read-char5: a ZIP key is still compared with the text p_zip. Rolled back.';
  end if;
  if (length(src) - length(replace(src, 'p.zip = p_zip', ''))) / length('p.zip = p_zip') <> 2 then
    raise exception 'map1-zip-read-char5: the legacy app_projects branch changed. Rolled back.';
  end if;

  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
    into attrs_after from pg_proc p where p.oid = fn;
  if attrs_after is distinct from attrs_before then
    raise exception 'map1-zip-read-char5: function attributes changed (% -> %). Rolled back.',
      attrs_before, attrs_after;
  end if;

  raise notice 'map1-zip-read-char5: applied (body md5 % -> %)', pre_md5, post_md5;
end
$splice$;

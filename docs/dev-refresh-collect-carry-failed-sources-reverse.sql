-- REVERSAL of docs/dev-refresh-collect-carry-failed-sources.sql: restores the ORIGINAL collector body (md5 5afbb783…, CORE
-- GUARD 1 back: a failed source with stored records refuses the whole write) and drops the helper. Refused on any body
-- other than the PATCHED one. Stored rows written while the change was live keep their carried records; the next refresh of
-- each ZIP replaces them as before.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $rev$
declare
  fn regprocedure := 'public.dev_refresh_collect()'::regprocedure;
  body text; expect_body text; src_def text; i int; n int;
  olds text[]; news text[]; mig text;
begin
  select prosrc into body from pg_proc where oid = fn;
  if md5(body) = '5afbb78376a080f2d9eb095335476a53' then
    raise notice 'EVIDENCE already ORIGINAL; nothing changed';
  else
    if md5(body) <> 'b17263cc5eca232dbde8fc33e27093e4' or length(body) <> 16593 then
      raise exception 'REFUSED: body % / % is not the PATCHED one', md5(body), length(body);
    end if;
    -- the three replacements, in reverse (each new text back to its old text)
    olds := array[
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
    news := array[
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
    expect_body := body;
    for i in 1..3 loop
      n := (length(expect_body) - length(replace(expect_body, news[i], ''))) / length(news[i]);
      if n <> 1 then raise exception 'REFUSED: patched text % occurs % times', i, n; end if;
      expect_body := replace(expect_body, news[i], olds[i]);
    end loop;
    if md5(expect_body) <> '5afbb78376a080f2d9eb095335476a53' then
      raise exception 'REFUSED: reversal would give %, not the ORIGINAL', md5(expect_body);
    end if;
    src_def := pg_get_functiondef(fn);
    execute replace(src_def, body, expect_body);
    select prosrc into body from pg_proc where oid = fn;
    if md5(body) <> '5afbb78376a080f2d9eb095335476a53' then raise exception 'ROLLED BACK: reversal did not take'; end if;
    raise notice 'EVIDENCE after: md5=% (ORIGINAL)', md5(body);
  end if;
end
$rev$;
drop function if exists public.dev_with_carried_sources(jsonb);
commit;

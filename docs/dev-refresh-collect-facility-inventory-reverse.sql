-- REVERSAL of docs/dev-refresh-collect-facility-inventory.sql: puts dev_refresh_collect back to the SOURCE body
-- (md5 b17263cc5eca232dbde8fc33e27093e4) by the same three replacements in reverse. The helper
-- public.dev_facility_read_untrusted is left in place (unused, harmless); drop it by hand if wanted.
-- Data: rows written while the change was live keep their counts.facilities_coverage and held clocks; nothing is undone.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $mig$
declare
  c_orig_md5 constant text := 'bd77573364bc41e2c5691b5f6643d6cf';
  c_orig_len constant int  := 17204;
  c_new_md5  constant text := 'b17263cc5eca232dbde8fc33e27093e4';
  c_new_len  constant int  := 16593;
  olds text[] := array[
$a1$    -- counts: core keys from the payload. (INVENTORY, docs/dev-refresh-collect-facility-inventory.sql) When this
    -- facility read is NOT TRUSTED (public.dev_facility_read_untrusted), the stored facility count AND the stored
    -- inventory coverage (counts.facilities_coverage) are kept, and the response's own coverage key is not taken: a
    -- failed refresh does not erase that the stored inventory was boundary-complete as of facilities_refreshed_at.
    counts = case
               when public.dev_facility_read_untrusted(epa_ok, j, d.counts, d.facilities_refreshed_at)
                 then ((j->'counts') - 'facilities_coverage')
                      || jsonb_build_object('facilities', coalesce((d.counts->>'facilities')::int, 0))
                      || jsonb_strip_nulls(jsonb_build_object('facilities_coverage', d.counts->'facilities_coverage'))
               else j->'counts'
             end,
$a1$,
$a2$    -- REGULATORY freshness = the LAST SUCCESSFUL facility acquisition. (INVENTORY) Advances only on a TRUSTED facility
    -- read; it used to advance on any write that was not refused, so a failed read over a stored count of 0 moved the
    -- clock as if EPA had answered.
    facilities_refreshed_at = case
                                when public.dev_facility_read_untrusted(epa_ok, j, d.counts, d.facilities_refreshed_at)
                                  then d.facilities_refreshed_at
                                else now()
                              end,
$a2$,
$a3$    -- (INVENTORY) the LATEST REFRESH OUTCOME. The same expression as before, moved into the one helper the two
    -- columns above also read, so "unavailable", "keep the stored inventory" and "hold the clock" cannot disagree.
    facilities_unavailable = public.dev_facility_read_untrusted(epa_ok, j, d.counts, d.facilities_refreshed_at)
$a3$];
  news text[] := array[
$b1$    -- counts: core keys from the payload; facilities preserved when the EPA write is refused.
    counts = case
               when public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)
                 then (j->'counts') || jsonb_build_object(
                        'facilities', coalesce((d.counts->>'facilities')::int, 0))
               else j->'counts'
             end,
$b1$,
$b2$    -- REGULATORY freshness. Advances only when the facility layer actually took a write.
    facilities_refreshed_at = case
                                when public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)
                                  then d.facilities_refreshed_at
                                else now()
                              end,
$b2$,
$b3$    facilities_unavailable = case
                               when public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at) then true
                               when coalesce((j->'counts'->>'facilities')::int, 0) > 0 then false
                               when not (epa_ok and coalesce((j->'epa'->>'ok')::boolean, true)) then true
                               else false
                             end
$b3$];
  fn regprocedure := 'public.dev_refresh_collect()'::regprocedure;
  body text; after_body text; expect_body text; src_def text; after_def text; i int; n int;
  props_before text; props_after text;
begin
  select prosrc into body from pg_proc where oid = fn;
  raise notice 'EVIDENCE before: md5=% len=%', md5(body), length(body);
  if md5(body) = c_new_md5 and length(body) = c_new_len then
    raise notice 'EVIDENCE already at the TARGET fingerprint %; nothing changed', c_new_md5;
    return;
  end if;
  if md5(body) <> c_orig_md5 or length(body) <> c_orig_len then
    raise exception 'REFUSED: md5(prosrc) % / % is neither SOURCE (% / %) nor TARGET (% / %)',
      md5(body), length(body), c_orig_md5, c_orig_len, c_new_md5, c_new_len;
  end if;
  expect_body := body;
  for i in 1..3 loop
    n := (length(expect_body) - length(replace(expect_body, olds[i], ''))) / length(olds[i]);
    if n <> 1 then raise exception 'REFUSED: anchor % occurs % times (expected 1)', i, n; end if;
    expect_body := replace(expect_body, olds[i], news[i]);
  end loop;
  if md5(expect_body) <> c_new_md5 or length(expect_body) <> c_new_len then
    raise exception 'REFUSED: planned body fingerprints to % / %, not TARGET % / %', md5(expect_body), length(expect_body), c_new_md5, c_new_len;
  end if;
  select concat_ws('|', p.proowner::regrole::text, p.proacl::text, p.prosecdef, p.proconfig::text, p.provolatile, p.proparallel)
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
  select concat_ws('|', p.proowner::regrole::text, p.proacl::text, p.prosecdef, p.proconfig::text, p.provolatile, p.proparallel)
    into props_after from pg_proc p where p.oid = fn;
  if props_after <> props_before then
    raise exception 'ROLLED BACK: owner/ACL/attributes changed (% -> %)', props_before, props_after;
  end if;
  raise notice 'EVIDENCE after: md5=% len=% (TARGET)', md5(after_body), length(after_body);
end
$mig$;

commit;

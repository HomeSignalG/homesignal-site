-- docs/decision-provenance-migration.rollback.sql
--
-- NOT APPLIED. Reverses docs/decision-provenance-migration.sql: removes the one inserted `'decision'` line (and its
-- comment) from public.app_refresh_zip by excision, so no other edit to the function is touched.
--
-- Fails closed:
--   * nothing to do if the splice is not present;
--   * refuses unless excising the exact inserted text reproduces the REVIEWED pre-splice body
--     (md5 7718e5dbd2f4702048be9cba3b59ae13). If the function has been edited since, re-derive by hand.
--
-- This restores the WRITER only. Rows already refreshed keep `provenance.decision`; it is inert (nothing but
-- HS.decisionOf reads it, and a Decided row without it renders the honest "not verified" line). To strip it from a
-- pilot ZIP as well, see the rollout doc (one scoped UPDATE, archived first).

begin;

do $rb$
declare
  _def text;
  _ins text := $ins$,
        -- THE SOURCED DECISION (2026-09-20 contract, sources/decision.ts). Carried whole
        -- so a consumer reads the outcome, its date and its record URL from ONE object it
        -- can check, rather than re-deriving any of them from `status`. jsonb_strip_nulls
        -- around this object already drops the key on a live proposal, so an undecided
        -- record's provenance is byte-identical to what it was before this change.
        'decision',       el->'decision'$ins$;
  _reviewed_md5 constant text := '7718e5dbd2f4702048be9cba3b59ae13';
  _n int;
  _new text;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip';
  if _def is null then raise exception 'app_refresh_zip not found'; end if;

  _n := (length(_def) - length(replace(_def, _ins, ''))) / length(_ins);
  if _n = 0 then raise notice 'decision splice not present — nothing to roll back'; return; end if;
  if _n <> 1 then raise exception 'inserted text found % times, expected exactly 1', _n; end if;

  _new := replace(_def, _ins, '');
  if md5(_new) <> _reviewed_md5 then
    raise exception 'excision gives md5 %, not the reviewed pre-splice %; the function changed since — roll back by hand',
                    md5(_new), _reviewed_md5;
  end if;

  execute _new;

  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip';
  if md5(_def) <> _reviewed_md5 then
    raise exception 'rollback did not restore the reviewed body (md5 %)', md5(_def);
  end if;
  raise notice 'app_refresh_zip restored to %', md5(_def);
end
$rb$;

commit;

-- ROLLBACK of docs/app-refresh-zip-source-dates.sql (PROPOSED, NOT APPLIED). Cuts the one inserted line back out of the live body. The md5 of the reviewed
-- body is the guard: it refuses unless removing the line reproduces exactly that body, so it cannot undo anyone else's later change.
begin;
do $undo$
declare
  _orig constant text := '50d925795f2c4d11804551a54947e4e6';
  _add  constant text := E',\n        ''source_dates'',   el->''source_dates''';
  _def text; _old text;
begin
  select pg_get_functiondef(p.oid) into _def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip' and p.pronargs = 1;
  if (length(_def) - length(replace(_def, _add, ''))) / length(_add) <> 1 then raise exception 'the source_dates line is not present exactly once'; end if;
  _old := replace(_def, _add, '');
  if md5(_old) <> _orig then raise exception 'live body is not the reviewed body plus the one line (md5 after removal %, expected %)', md5(_old), _orig; end if;
  execute _old;
end
$undo$;
commit;

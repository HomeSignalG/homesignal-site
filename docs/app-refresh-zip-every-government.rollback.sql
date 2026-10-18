-- Rollback for docs/app-refresh-zip-every-government.sql: re-installs the archived pre-change body.
do $do$
declare d text;
begin
  select def into d from public.app_refresh_zip_def_archive
   where tag = 'pre-every-government' order by archived_at desc limit 1;
  if d is null then raise exception 'no archived pre-every-government body'; end if;
  execute d;
  if pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure) like '%_gov uuid[]%' then
    raise exception 'rollback did not land';
  end if;
end
$do$;

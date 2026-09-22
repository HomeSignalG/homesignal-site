-- P0 verification, step 1 of 2: READ THE PRODUCER before asserting what it does.
-- Claims rule 3 — quote the source, never recall it. Nothing here writes.
select
  md5(pg_get_functiondef(p.oid))                              as read_path_md5,
  length(pg_get_functiondef(p.oid))                           as def_chars,
  p.prosecdef                                                 as security_definer,
  p.proretset                                                 as returns_set,
  pg_get_functiondef(p.oid)                                   as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'app_projects_for_zip';

-- ONE-STEP ROLLBACK for the legal-ad tile-tags splice (applied 2026-11-27).
-- Restores the exact pre-change app_refresh_zip from the archive row captured inside the database.
-- live before: md5(prosrc) 098f6335a60f0f3aeab484fd5e310c55 (27,281 chars) ; after splice: 6b82d5817a5a68ed0f9a79e6d3c9b058 (27,564)
do $$ declare d text; begin
  select def into d from public.app_refresh_zip_def_archive where tag = 'pre-legal-ad-tile-tags' order by archived_at desc limit 1;
  if d is null then raise exception 'archive row missing'; end if;
  execute d;
  if md5((select prosrc from pg_proc where oid = 'public.app_refresh_zip(text)'::regprocedure)) <> '098f6335a60f0f3aeab484fd5e310c55' then
    raise exception 'rollback did not restore the original body'; end if;
end $$;
-- The tile_tags column and legal_notice_review table are additive and inert once the function is restored; leave them.

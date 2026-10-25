-- Read-only verification for docs/video-bluesky-queue.sql. Select statements only.
select
  to_regclass('public.video_bluesky_jobs') is not null as jobs_table,
  (select relrowsecurity from pg_class where oid = to_regclass('public.video_bluesky_jobs')) as rls_on,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'video\_bsky\_%' or p.proname like 'video\_job\_%' or p.proname like 'hs\_video\_%'
          or p.proname in ('video_next_slot', 'video_bluesky_jobs_guard'))) as video_fns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'youtube_video_reviews'
    and column_name in ('youtube_url', 'bsky_posts', 'reconcile_required')) as review_cols,
  (select count(*) from public.youtube_video_reviews where reconcile_required) as items_held_for_reconciliation,
  has_function_privilege('anon', 'public.hs_video_jobs_list()', 'execute') as anon_can_list,
  has_function_privilege('authenticated', 'public.video_job_claim(uuid,text,int,text)', 'execute') as authenticated_can_claim,
  has_function_privilege('service_role', 'public.video_job_claim(uuid,text,int,text)', 'execute') as service_can_claim;

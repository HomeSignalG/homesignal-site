-- ROLLBACK for docs/source-freshness.sql. Removes everything it added and nothing else.
-- The page code tolerates a missing reader (the freshness block simply does not render), so this
-- is safe to run before or after reverting the page.
do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'dev-source-freshness';
end
$cron$;
drop function if exists public.source_freshness_for_zip(text, text[]);
drop function if exists public.dev_source_freshness_refresh();
drop table if exists public.dev_source_freshness;

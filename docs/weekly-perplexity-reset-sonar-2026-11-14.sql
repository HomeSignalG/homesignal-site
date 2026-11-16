-- Tab 20 · one-time: give back the Perplexity attempts lost to the retired endpoint (2026-11-14).
-- The first real run (homesignal-ingest run 43639382929, 20:48Z) sent each due request to /chat/completions, which
-- Perplexity now refuses with HTTP 403 "Sonar is now the Agent API". Those attempts used up the request's 3 tries, so
-- weekly_perplexity_due() will never offer it again. This removes exactly those failed calls (and nothing else), so the
-- Agent API worker (homesignal-ingest #1127) can try again under the same cost limits.
-- Fail-closed: refuses unless every row it would remove is a failed call whose error is that 403, and the count matches
-- what was measured (3). The removed rows are printed first, so the job log keeps them.
begin;
select id, request_id, attempt, model, status, started_at, finished_at, left(error, 160) as error
  from public.weekly_perplexity_calls where status = 'failed' and error like '%Sonar is now the Agent API%' order by request_id, attempt;
do $$
declare n integer; bad integer;
begin
  select count(*) into n from public.weekly_perplexity_calls where status = 'failed' and error like '%Sonar is now the Agent API%';
  select count(*) into bad from public.weekly_perplexity_calls where error like '%Sonar is now the Agent API%' and (status <> 'failed' or answer_id is not null);
  if n <> 3 or bad <> 0 then raise exception 'expected 3 failed Sonar-403 calls and nothing else, found % (+% other)', n, bad; end if;
  delete from public.weekly_perplexity_calls where status = 'failed' and error like '%Sonar is now the Agent API%';
end $$;
select (select count(*) from public.weekly_perplexity_calls) as calls_left, (select count(*) from public.weekly_perplexity_due()) as due_now;
commit;

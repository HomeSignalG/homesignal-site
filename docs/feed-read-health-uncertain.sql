-- Tab 2: read the new 'uncertain' feed_read_outcome value as its own state (homesignal-ingest#1160). READ-ONLY function replace.
-- Apply BEFORE homesignal-ingest migration 20261122180000_feed_read_outcome_uncertain.sql, so no uncertain row can ever be read as a success.
-- Same signature as before; an unknown outcome value now reads READ_UNKNOWN_OUTCOME instead of READ_OK_ITEMS.
create or replace function public._hs_feed_read_state()
returns table(feed_id text, state text, last_attempt_at timestamptz, last_outcome text, items_returned int, newest_item_date timestamptz, last_error text, consecutive_errors int, last_run_id text)
language sql stable security definer set search_path = public as $$
  with ranked as (select o.*, row_number() over (partition by o.feed_id order by o.attempted_at desc, o.id desc) rn from public.feed_read_outcome o),
       firstok as (select r.feed_id, min(r.rn) m from ranked r where r.outcome <> 'error' group by 1),
       streak as (select r.feed_id, count(*)::int n from ranked r left join firstok f on f.feed_id = r.feed_id where r.outcome = 'error' and r.rn < coalesce(f.m, 2147483647) group by 1)
  select l.feed_id,
    case when l.attempted_at < now() - interval '12 hours' then 'STALE_EVIDENCE'
         when l.outcome = 'error' then 'READ_FAILED'
         when l.outcome = 'uncertain' then 'READ_UNCERTAIN'
         when l.outcome = 'empty' then 'READ_OK_ZERO_ITEMS'
         when l.outcome = 'ok' then 'READ_OK_ITEMS'
         else 'READ_UNKNOWN_OUTCOME' end,
    l.attempted_at, l.outcome, l.items_returned, l.newest_item_date, l.error, coalesce(st.n, 0), l.run_id
  from ranked l left join streak st on st.feed_id = l.feed_id where l.rn = 1;
$$;
revoke all on function public._hs_feed_read_state() from public, anon, authenticated;

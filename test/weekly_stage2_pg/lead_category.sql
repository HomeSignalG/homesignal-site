-- EVERY TOPIC HAS ITS LOCAL NEWS CATEGORY (docs/weekly-2b-lead-category.sql) on a DISPOSABLE Postgres (never
-- production). Run by run_lead_category.sh after files 1, 2, 2a and 2b. Every line 'Cnn|true' is one check.
\set ON_ERROR_STOP 0
create or replace function pg_temp.raises(q text, code text, msg text default null) returns boolean language plpgsql as $$
begin execute q; return false;
exception when others then return (code is null or sqlstate = code) and (msg is null or sqlerrm = msg); end $$;
grant execute on function pg_temp.raises(text, text, text) to authenticated;
\set admin '{"email":"founder@test.invalid"}'
create or replace function pg_temp.fp() returns text language sql as $$
  select md5(coalesce((select string_agg(to_jsonb(l)::text, ',' order by l.id::text collate "C") from public.weekly_topic_leads l), '') ||
             coalesce((select string_agg(to_jsonb(e)::text, ',' order by e.id) from public.weekly_topic_lead_events e), '')) $$;
grant execute on function pg_temp.fp() to authenticated;
-- a topic captured before this rule, with no category (written as the owner, the way it exists in production)
reset role;
insert into public.weekly_topic_leads (title, created_by, notes, source_urls) values ('TEST old topic with no category', 'founder@test.invalid', 'TEST notes', '{https://news.example.test/a}');
select id as lold from public.weekly_topic_leads where title = 'TEST old topic with no category' \gset
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_edition_create('Data Centers', '2026-11-09') ->> 'id') as edc \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST in a report","topic":"Data Centers"}') ->> 'lead_id') as lin \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST unassigned","topic":"Data Centers"}') ->> 'lead_id') as lfree \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST deferred","topic":"Data Centers"}') ->> 'lead_id') as ldef \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST included","topic":"Data Centers"}') ->> 'lead_id') as linc \gset
select public.hs_weekly_lead_assign(:'lin', :'edc') is not null as c \gset
select public.hs_weekly_lead_assign(:'ldef', :'edc') is not null as c \gset
select public.hs_weekly_lead_disposition(:'ldef', :'edc', 'deferred') is not null as c \gset
select public.hs_weekly_lead_assign(:'linc', :'edc') is not null as c \gset
select public.hs_weekly_lead_disposition(:'linc', :'edc', 'included') is not null as c \gset
reset role;
select pg_temp.fp() as fp0 \gset
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'C01|' || pg_temp.raises($q$select public.hs_weekly_lead_save(null, '{"title":"TEST no category"}')$q$, '22023', 'a topic needs its Local News category');
select 'C02|' || pg_temp.raises($q$select public.hs_weekly_lead_save(null, '{"title":"TEST blank category","topic":""}')$q$, '22023', 'a topic needs its Local News category');
reset role;
select 'C03|' || (pg_temp.fp() = :'fp0') || ' a refused new topic writes nothing';
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'C04|' || pg_temp.raises(format($q$select public.hs_weekly_lead_save(%L, '{"title":"TEST renamed"}')$q$, :'lold'), '22023', 'a topic needs its Local News category');
select 'C05|' || pg_temp.raises(format($q$select public.hs_weekly_lead_save(%L, '{"topic":""}')$q$, :'lfree'), '22023', 'a topic needs its Local News category');
select 'C06|' || pg_temp.raises(format($q$select public.hs_weekly_lead_save(%L, '{"topic":"Water Quality"}')$q$, :'lin'), '55006',
  'this topic is in a report; defer or drop it there before changing its category');
select 'C07|' || pg_temp.raises(format($q$select public.hs_weekly_lead_save(%L, '{"topic":"Water Quality"}')$q$, :'linc'), '55006',
  'this topic is in a report; defer or drop it there before changing its category');
reset role;
select 'C08|' || (pg_temp.fp() = :'fp0') || ' refused saves change nothing';
set role authenticated;
select set_config('test.jwt', :'admin', false);
-- allowed
select 'C09|' || ((public.hs_weekly_lead_save(:'lold', '{"topic":"Data Centers"}') -> 'state') is not null);
reset role;
select 'C10|' || (select topic = 'Data Centers' and notes = 'TEST notes' and source_urls = '{https://news.example.test/a}' from public.weekly_topic_leads where id = :'lold')
  || ' repairing an old topic keeps its notes and sources';
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'C11|' || ((public.hs_weekly_lead_save(:'lin', '{"topic":"Data Centers","notes":"TEST same category"}') -> 'state') is not null) || ' a topic in a report saves with its own category';
select 'C12|' || ((public.hs_weekly_lead_save(:'lfree', '{"topic":"Water Quality"}') -> 'state') is not null) || ' an unassigned topic can change category';
select 'C13|' || ((public.hs_weekly_lead_save(:'ldef', '{"topic":"Water Quality"}') -> 'state') is not null) || ' a deferred topic can change category';
select 'C14|' || ((public.hs_weekly_lead_save(:'lin', '{"title":"TEST in a report, renamed"}') -> 'state') is not null) || ' an edit that does not send the category keeps it';
reset role;
select 'C15|' || (select count(*) = 0 from public.weekly_topic_leads where topic is null) || ' after the repair no topic lacks a category';

-- The PUBLICATION LOCK of the queue-only release (docs/weekly-2a-publication-lock.sql) on a DISPOSABLE Postgres (never
-- production). Run by run_publication_lock.sh after files 1, 2 and 2a. Every line 'Lnn|true' is one check.
-- Calls are made the way the page makes them (as authenticated, with the admin's token), and directly as the owner.
\set ON_ERROR_STOP 0
create or replace function pg_temp.raises(q text, code text, msg text default null) returns boolean language plpgsql as $$
begin execute q; return false;
exception when others then return (code is null or sqlstate = code) and (msg is null or sqlerrm = msg); end $$;
grant execute on function pg_temp.raises(text, text, text) to anon, authenticated, service_role;
\set admin '{"email":"founder@test.invalid"}'
\set fmt 'TEST ANSWER FORMAT'
-- the fingerprint of everything the queue writes: a refused call must leave it unchanged
create or replace function pg_temp.fp() returns text language sql as $$
  select md5(coalesce((select string_agg(to_jsonb(l)::text, ',' order by l.id::text collate "C") from public.weekly_topic_leads l), '') ||
             coalesce((select string_agg(to_jsonb(e)::text, ',' order by e.id) from public.weekly_topic_lead_events e), '') ||
             coalesce((select string_agg(to_jsonb(d)::text, ',' order by d.id::text collate "C") from public.weekly_editions d), '') ||
             coalesce((select string_agg(to_jsonb(r)::text, ',' order by r.id::text collate "C") from public.weekly_research_requests r), '')) $$;
grant execute on function pg_temp.fp() to authenticated;

-- SETUP, through the admin functions only. Three Data Centers editions:
--   ep  open and PUBLISHED (one lead included, then the video recorded)
--   eu  open, not published
--   ec  closed, not published;  epc  published and then closed
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_edition_create('Data Centers', '2026-11-09') ->> 'id') as ep \gset
select (public.hs_weekly_edition_create('Data Centers', '2026-11-16') ->> 'id') as eu \gset
select (public.hs_weekly_edition_create('Data Centers', '2026-11-23') ->> 'id') as ec \gset
select (public.hs_weekly_edition_create('Data Centers', '2026-11-30') ->> 'id') as epc \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST lead in the published edition","topic":"Data Centers"}') ->> 'lead_id') as lin \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST lead handed off to the published edition","topic":"Data Centers"}') ->> 'lead_id') as lho \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST lead deferred in the published edition","topic":"Data Centers"}') ->> 'lead_id') as ldf \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST new lead","topic":"Data Centers"}') ->> 'lead_id') as lnew \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST second new lead","topic":"Data Centers"}') ->> 'lead_id') as lnew2 \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST lead in the published, closed edition","topic":"Data Centers"}') ->> 'lead_id') as lpc \gset
select public.hs_weekly_lead_assign(:'lin', :'ep') is not null as c \gset
select public.hs_weekly_lead_send_to_research(:'lho', :'ep', :'fmt') is not null as c \gset
select public.hs_weekly_lead_assign(:'ldf', :'ep') is not null as c \gset
select public.hs_weekly_lead_disposition(:'lin', :'ep', 'included') is not null as c \gset
select public.hs_weekly_lead_disposition(:'lho', :'ep', 'included') is not null as c \gset
select public.hs_weekly_lead_disposition(:'ldf', :'ep', 'deferred') is not null as c \gset
select public.hs_weekly_edition_publish(:'ep', 'https://video.example.test/watch?v=P', current_date) is not null as c \gset
select public.hs_weekly_lead_assign(:'lpc', :'epc') is not null as c \gset
select public.hs_weekly_lead_disposition(:'lpc', :'epc', 'included') is not null as c \gset
select public.hs_weekly_edition_publish(:'epc', 'https://video.example.test/watch?v=PC', current_date) is not null as c \gset
select public.hs_weekly_edition_close(:'epc') is not null as c \gset
select public.hs_weekly_edition_close(:'ec', 'TEST: closing without a video') is not null as c \gset
reset role;
select 'L00|' || ((select video_url is not null and closed_at is null from public.weekly_editions where id = :'ep')
  and (select video_url is null and closed_at is null from public.weekly_editions where id = :'eu')
  and (select video_url is null and closed_at is not null from public.weekly_editions where id = :'ec')
  and (select video_url is not null and closed_at is not null from public.weekly_editions where id = :'epc'));

-- THE LOCK, called the way the page calls it. Each refusal is 55000 with the lock's own message, and changes nothing.
select pg_temp.fp() as f0 \gset
select (select edition_key from public.weekly_editions where id = :'ep') as k_ep, (select edition_key from public.weekly_editions where id = :'ec') as k_ec,
       (select edition_key from public.weekly_editions where id = :'epc') as k_epc \gset
set role authenticated;
select set_config('test.jwt', :'admin', false);
-- L01 assigning a new lead to the published edition
select 'L01|' || pg_temp.raises(format($q$select public.hs_weekly_lead_assign(%L, %L)$q$, :'lnew', :'ep'), '55000',
  'edition ' || :'k_ep' || ' is published; its topics are final');
-- L02 preparing a research request for a new lead in the published edition
select 'L02|' || pg_temp.raises(format($q$select public.hs_weekly_lead_send_to_research(%L, %L, 'x')$q$, :'lnew2', :'ep'), '55000',
  'edition ' || :'k_ep' || ' is published; its topics are final');
-- L03 a research request for a lead ALREADY in the published edition but never handed off (assign returns false; the
--     request's own lock must still refuse)
select 'L03|' || pg_temp.raises(format($q$select public.hs_weekly_lead_send_to_research(%L, %L, 'x')$q$, :'lin', :'ep'), '55000',
  'edition ' || :'k_ep' || ' is published; its topics are final');
-- L04 include, defer and drop on the published edition, from every starting disposition
select 'L04|' || (
  pg_temp.raises(format($q$select public.hs_weekly_lead_disposition(%L, %L, 'deferred', 'TEST reason text')$q$, :'lin', :'ep'), '55000',
    'edition ' || :'k_ep' || ' is published; its decisions stand')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_disposition(%L, %L, 'dropped', 'TEST reason text')$q$, :'lin', :'ep'), '55000',
    'edition ' || :'k_ep' || ' is published; its decisions stand')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_disposition(%L, %L, 'included')$q$, :'lin', :'ep'), '55000',
    'edition ' || :'k_ep' || ' is published; its decisions stand')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_disposition(%L, %L, 'included')$q$, :'ldf', :'ep'), '55000',
    'edition ' || :'k_ep' || ' is published; its decisions stand')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_disposition(%L, %L, 'dropped', 'TEST reason text')$q$, :'ldf', :'ep'), '55000',
    'edition ' || :'k_ep' || ' is published; its decisions stand')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_disposition(%L, %L, 'deferred', 'TEST reason text')$q$, :'lho', :'ep'), '55000',
    'edition ' || :'k_ep' || ' is published; its decisions stand'));
-- L05 a lead's request already prepared for the published edition: the call answers with the existing request and writes nothing
select public.hs_weekly_lead_send_to_research(:'lho', :'ep', :'fmt') as h \gset
reset role;
select 'L05|' || ((:'h'::jsonb ->> 'existing') = 'true');
-- L06 directly as the owner (the internal assignment function is not callable by authenticated at all)
select 'L06|' || (pg_temp.raises(format($q$select public._wk_lead_assign(%L, %L, 'owner')$q$, :'lnew', :'ep'), '55000',
    'edition ' || :'k_ep' || ' is published; its topics are final')
  and not has_function_privilege('authenticated', 'public._wk_lead_assign(uuid,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public._wk_lead_assign(uuid,uuid,text)', 'execute'));
-- L07 every refusal above left the queue exactly as it was
select 'L07|' || (pg_temp.fp() = :'f0');

-- NORMAL WORK on an open, unpublished edition is unchanged
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_lead_assign(:'lnew', :'eu') as a1 \gset
select public.hs_weekly_lead_send_to_research(:'lnew2', :'eu', :'fmt') as r1 \gset
select public.hs_weekly_lead_disposition(:'lnew', :'eu', 'included') is not null as d1 \gset
select public.hs_weekly_lead_disposition(:'lnew', :'eu', 'deferred', 'TEST: not ready') is not null as d2 \gset
select public.hs_weekly_lead_disposition(:'lnew', :'eu', 'included') is not null as d3 \gset
select public.hs_weekly_lead_disposition(:'lnew2', :'eu', 'dropped') is not null as d4 \gset
reset role;
select 'L08|' || (:'a1'::jsonb is not null and (:'r1'::jsonb ->> 'existing') = 'false'
  and (public.weekly_lead_state(:'lnew') ->> 'status') = 'included' and (public.weekly_lead_state(:'lnew2') ->> 'status') = 'dropped'
  and (select count(*) from public.weekly_research_requests) = 2);

-- CLOSED editions keep their own messages; a published-and-closed edition says closed (that check runs first)
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'L09|' || (
  pg_temp.raises(format($q$select public.hs_weekly_lead_assign(%L, %L)$q$, :'ldf', :'ec'), '55000',
    'edition ' || :'k_ec' || ' is closed')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_send_to_research(%L, %L, 'x')$q$, :'ldf', :'ec'), '55000',
    'edition ' || :'k_ec' || ' is closed')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_assign(%L, %L)$q$, :'ldf', :'epc'), '55000',
    'edition ' || :'k_epc' || ' is closed')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_send_to_research(%L, %L, 'x')$q$, :'ldf', :'epc'), '55000',
    'edition ' || :'k_epc' || ' is closed')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_disposition(%L, %L, 'dropped', 'TEST reason text')$q$, :'lpc', :'epc'), '55000',
    'edition ' || :'k_epc' || ' is closed; its decisions stand'));
reset role;

-- THE FUNCTIONS: each is file 2's body with one inserted line, and nothing else about it changed
select 'L10|' || (select bool_and(p.prosecdef and p.proconfig = array['search_path=public'] and pg_get_userbyid(p.proowner) = 'postgres'
                                  and (length(p.prosrc) - length(replace(p.prosrc, 'is published;', ''))) / length('is published;') = 1)
  from pg_proc p where p.oid in ('public._wk_lead_assign(uuid,uuid,text)'::regprocedure, 'public.hs_weekly_lead_send_to_research(uuid,uuid,text)'::regprocedure,
                                 'public.hs_weekly_lead_disposition(uuid,uuid,text,text)'::regprocedure));
select 'L11|' || (has_function_privilege('authenticated', 'public.hs_weekly_lead_send_to_research(uuid,uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.hs_weekly_lead_disposition(uuid,uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.hs_weekly_lead_send_to_research(uuid,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.hs_weekly_lead_disposition(uuid,uuid,text,text)', 'execute'));

-- Scenarios for the maps_subscriber_zips check. Each DO block is its own transaction (one tick),
-- starts from the base data (97702 subscriber a@x, active, on the list; 84336 unsubscribed) and
-- prints PASS/FAIL. The base subscriber is backdated to 30 days unless a scenario says otherwise.
create or replace function pg_temp.reset() returns void language plpgsql as $$
begin
  delete from public.social_post_withdrawals where true;
  delete from public.social_posts where true;
  delete from public.user_subscriptions where user_id not in
    ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
  delete from public.users where id not in
    ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
  update public.users set referral_source = null, unsubscribed = (id = '10000000-0000-0000-0000-000000000002') where true;
  update public.user_subscriptions set created_at = now() - interval '30 days' where true;
  perform public.maps_zip_order_sync_subscribers();
  insert into public.social_posts (content_family, status, zip, published_at) values ('MAPS','published','97702', now());
end $$;
create or replace function pg_temp.tick() returns table(ok boolean, alertable boolean, detail text) language plpgsql as $$
begin
  perform public.pipeline_health_tick();
  return query select c.ok, c.alertable, c.detail from public.pipeline_health_check c where c.check_name = 'maps_subscriber_zips';
end $$;
create or replace function pg_temp.say(label text, cond boolean, detail text) returns void language plpgsql as $$
begin raise notice '% %: %', case when cond then 'PASS' else 'FAIL' end, label, coalesce(detail, '(no row)'); end $$;
create or replace function pg_temp.add_sub(uid uuid, zip text, ref text, age interval) returns void language plpgsql as $$
begin
  insert into public.communities (id, level, zip_codes)
    select ('00000000-0000-0000-0000-0000000' || zip)::uuid, 'zip', array[zip]
     where not exists (select 1 from public.communities where zip_codes = array[zip] and level = 'zip');
  insert into public.users (id, email, community_id, zip_code, referral_source)
    values (uid, uid::text || '@x', (select id from public.communities where zip_codes = array[zip] and level = 'zip'), zip, ref);
  insert into public.user_subscriptions values
    (uid, (select id from public.communities where zip_codes = array[zip] and level = 'zip'), 'maps', 't', 'explicit', 0, now() - age);
end $$;

do $$ declare r record; begin perform pg_temp.reset(); select * into r from pg_temp.tick();
  perform pg_temp.say('S01 healthy base reads ok and alertable', r.ok and r.alertable and r.detail like '1 subscriber ZIP(s), all on the post list%', r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  delete from public.maps_zip_order where zip = '97702';
  select * into r from pg_temp.tick();
  perform pg_temp.say('S02 a subscriber ZIP missing from the list fails and names it', not r.ok and r.detail like '1 development-alert subscriber ZIP(s) are not on the MAPS post list: 97702%', r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  drop trigger users_maps_zip_order on public.users;
  select * into r from pg_temp.tick();
  perform pg_temp.say('S03 a missing trigger fails', not r.ok and r.detail like 'only 1 of the 2 triggers%', r.detail);
  raise exception 'rollback';
exception when raise_exception then null; end $$;

do $$ declare r record; begin perform pg_temp.reset();
  delete from public.social_posts where true;
  select * into r from pg_temp.tick();
  perform pg_temp.say('S04 a real subscriber over 7 days with no published post fails and names the ZIP', not r.ok and r.detail like '1 ZIP(s) have had a development-alert subscriber for over 7 days%97702 (since %', r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  delete from public.social_posts where true;
  update public.user_subscriptions set created_at = now() - interval '3 days' where true;
  select * into r from pg_temp.tick();
  perform pg_temp.say('S05 under 7 days with no post is waiting, not failing', r.ok and r.detail like '%1 with a subscriber under 7 days and no post yet%', r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  update public.social_posts set status = 'approved' where true;
  select * into r from pg_temp.tick();
  perform pg_temp.say('S06 an approved but unpublished post does not count', not r.ok, r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  insert into public.social_post_withdrawals select id, now() from public.social_posts;
  select * into r from pg_temp.tick();
  perform pg_temp.say('S07 a withdrawn post does not count', not r.ok, r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  update public.social_posts set content_family = 'ALERTS' where true;
  select * into r from pg_temp.tick();
  perform pg_temp.say('S08 a non-MAPS post does not count', not r.ok, r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  perform pg_temp.add_sub('20000000-0000-0000-0000-000000000001', '85083', 'admin_test', interval '30 days');
  select * into r from pg_temp.tick();
  perform pg_temp.say('S09 a test-only ZIP with no post never pages, and is counted', r.ok and r.detail like '%1 test-only ZIP(s) not watched', r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  perform pg_temp.add_sub('20000000-0000-0000-0000-000000000001', '85083', 'admin_test', interval '30 days');
  perform pg_temp.add_sub('20000000-0000-0000-0000-000000000002', '85083', null, interval '10 days');
  select * into r from pg_temp.tick();
  perform pg_temp.say('S10 a real subscriber on a ZIP that also has a test one is watched', not r.ok and r.detail like '%85083 (since %', r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  update public.users set unsubscribed = true where id = '10000000-0000-0000-0000-000000000001';
  delete from public.social_posts where true;
  select * into r from pg_temp.tick();
  perform pg_temp.say('S11 an unsubscribed subscriber is not watched', r.ok and r.detail like '0 subscriber ZIP(s)%', r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  perform pg_temp.add_sub('20000000-0000-0000-0000-000000000003', '64166', null, interval '10 days');
  insert into public.social_posts (content_family, status, zip) values ('MAPS','published','64166');
  delete from public.maps_zip_order where zip = '64166';
  select * into r from pg_temp.tick();
  perform pg_temp.say('S12 missing-from-list is reported before stale', not r.ok and r.detail like '1 development-alert subscriber ZIP(s) are not on the MAPS post list: 64166%', r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  alter table public.social_posts rename column zip to zip_x;
  select * into r from pg_temp.tick();
  perform pg_temp.say('S13 a broken check is a failing alertable row, not a dead monitor',
    not r.ok and r.alertable and r.detail like 'the maps_subscriber_zips check could not run:%', r.detail);
  raise exception 'rollback';
exception when raise_exception then null; end $$;

do $$ declare r record; n int; begin perform pg_temp.reset(); select * into r from pg_temp.tick();
  select count(*) into n from public.pipeline_health_check where check_name = 'stand_in';
  perform pg_temp.say('S14 the other checks still run', n = 1 and r.ok, r.detail); end $$;

-- Each line: <id>|<t/f>. t = pass.
\set ON_ERROR_STOP 1
-- S00: the fixture IS production for what the rule reads (fingerprints read from production 2026-11-09).
select 'S00a the resolver view is production''s (viewdef md5 df44a9bd...)|' ||
  (md5(pg_get_viewdef('public.alert_subscription_state'::regclass, true)) = 'df44a9bdfdb7d4e03f747e98c645f769')::text;
select 'S00b the list table has production''s columns and constraints|' ||
  ((select string_agg(attname||':'||format_type(atttypid,atttypmod), ',' order by attnum) from pg_attribute
     where attrelid='public.maps_zip_order'::regclass and attnum>0 and not attisdropped)
    = 'founder_position:integer,zip:text,uploaded_at:timestamp with time zone'
   and (select string_agg(conname||'='||pg_get_constraintdef(oid), ' ; ' order by conname collate "C") from pg_constraint
     where conrelid='public.maps_zip_order'::regclass)
    = 'maps_zip_order_pkey=PRIMARY KEY (founder_position) ; maps_zip_order_position_positive=CHECK ((founder_position >= 1)) ; maps_zip_order_zip_format=CHECK ((zip ~ ''^[0-9]{5}$''::text)) ; maps_zip_order_zip_unique=UNIQUE (zip)')::text;
select 'S01 backfill added the active subscriber 97702 at the end|' ||
  ((select founder_position from maps_zip_order where zip='97702') = 3)::text;
select 'S02 unsubscribed 84336 not added|' || (not exists (select 1 from maps_zip_order where zip='84336'))::text;
select 'S03 founder order unchanged|' || ((select string_agg(zip, ',' order by founder_position) from maps_zip_order where founder_position<=2) = '98303,98304')::text;
-- new sign-up via the same two writes enable_area_email_alerts makes
insert into users (id, email, community_id, zip_code) values ('10000000-0000-0000-0000-000000000003','c@x','00000000-0000-0000-0000-000000085083','85083');
insert into user_subscriptions values ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000085083','maps','t','explicit',0,now());
select 'S04 new sign-up 85083 appended|' || ((select founder_position from maps_zip_order where zip='85083') = 4)::text;
-- a follow-floor row is not a selection
insert into users (id, email, community_id, zip_code) values ('10000000-0000-0000-0000-000000000004','d@x','00000000-0000-0000-0000-000000064166','64166');
insert into user_subscriptions values ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000064166','maps','t','follow_floor',0,now());
select 'S05 follow_floor does not add|' || (not exists (select 1 from maps_zip_order where zip='64166'))::text;
-- a notices sign-up is not a maps sign-up
insert into user_subscriptions values ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000064166','notices','t','explicit',0,now());
select 'S06 other streams do not add|' || (not exists (select 1 from maps_zip_order where zip='64166'))::text;
update user_subscriptions set origin='explicit' where user_id='10000000-0000-0000-0000-000000000004' and stream='maps';
select 'S07 becoming explicit adds 64166|' || exists (select 1 from maps_zip_order where zip='64166')::text;
-- re-subscribe through users.unsubscribed
update users set unsubscribed=false where id='10000000-0000-0000-0000-000000000002';
select 'S08 re-subscribe adds 84336|' || exists (select 1 from maps_zip_order where zip='84336')::text;
select 'S09 no duplicates, positions contiguous|' || ((select count(*) = count(distinct zip) and max(founder_position) = count(*) from maps_zip_order))::text;
-- founder upload that omits subscriber ZIPs: they are appended after it
select set_config('test.jwt', '{"email":"sdsutca@proton.me"}', false);
select count(*) from hs_set_maps_zip_order(array['98402','98401']) \g /dev/null
select 'S10 upload keeps founder order then subscribers|' ||
  ((select string_agg(zip, ',' order by founder_position) from maps_zip_order) = '98402,98401,64166,84336,85083,97702')::text;
select 'S11 upload of exactly the subscribers adds nothing twice|' ||
  ((select count(*) from hs_set_maps_zip_order(array['97702','85083'])) = 4)::text;
-- a failing sync never blocks a sign-up
alter table maps_zip_order add constraint zz_block check (zip <> '98303');
insert into users (id, email, community_id, zip_code) values ('10000000-0000-0000-0000-000000000005','e@x','00000000-0000-0000-0000-000000098303','98303');
insert into user_subscriptions values ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000098303','maps','t','explicit',0,now());
select 'S12 sign-up commits even when the list write fails|' || exists (select 1 from user_subscriptions where user_id='10000000-0000-0000-0000-000000000005')::text;
alter table maps_zip_order drop constraint zz_block;
select 'S13 anon/authenticated cannot run the sync|' ||
  (not has_function_privilege('anon','public.maps_zip_order_sync_subscribers()','EXECUTE')
   and not has_function_privilege('authenticated','public.maps_zip_order_sync_subscribers()','EXECUTE'))::text;
-- test sign-ups do not count (founder 2026-11-11)
insert into communities (id, level, zip_codes) values ('00000000-0000-0000-0000-000000098401','zip','{98499}');
insert into users (id, email, community_id, zip_code, referral_source) values ('10000000-0000-0000-0000-000000000006','f@x','00000000-0000-0000-0000-000000098401','98499','admin_test');
insert into user_subscriptions values ('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000098401','maps','t','explicit',0,now());
select 'S14 a test sign-up does not put its ZIP on the list|' || (not exists (select 1 from maps_zip_order where zip='98499'))::text;
select count(*) from hs_set_maps_zip_order(array['98402']) \g /dev/null
select 'S15 an upload does not bring a test-only ZIP back|' || (not exists (select 1 from maps_zip_order where zip='98499'))::text;
insert into users (id, email, community_id, zip_code) values ('10000000-0000-0000-0000-000000000007','g@x','00000000-0000-0000-0000-000000098401','98499');
insert into user_subscriptions values ('10000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000098401','maps','t','explicit',0,now());
select 'S16 a real sign-up on the same ZIP adds it|' || exists (select 1 from maps_zip_order where zip='98499')::text;

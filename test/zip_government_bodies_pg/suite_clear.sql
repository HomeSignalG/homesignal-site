-- runs as the resident; each statement's effect is read back
truncate auth._jwt; insert into auth._jwt values ('{"email":"res@example.com"}');
select 'C1 clearing Tacoma meetings removes exactly one row', public.clear_alert_selection('res@example.com','00000000-0000-0000-0000-0000000000a1', array['meetings']) = 1, '';
select 'C2 the county selection is untouched', (select count(*) = 1 from public.user_subscriptions where community_id='00000000-0000-0000-0000-0000000000c1'), '';
select 'C3 the other stream and the follow_floor row survive', (select count(*) = 2 from public.user_subscriptions where user_id='00000000-0000-0000-0000-00000000aa02'), '';
select 'C4 another person is untouched', (select count(*) = 1 from public.user_subscriptions where user_id='00000000-0000-0000-0000-00000000aa03'), '';
select 'C5 clearing Tacoma notices removes the explicit pick but never the follow_floor row', public.clear_alert_selection('res@example.com','00000000-0000-0000-0000-0000000000a1', array['notices']) = 1 and (select count(*) = 1 from public.user_subscriptions where user_id='00000000-0000-0000-0000-00000000aa02' and origin='follow_floor'), '';

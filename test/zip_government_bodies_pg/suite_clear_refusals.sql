-- each must raise; run one per psql call
truncate auth._jwt; insert into auth._jwt values ('{"email":"res@example.com"}'); select public.clear_alert_selection('other@example.com','00000000-0000-0000-0000-0000000000a1', array['meetings']);
truncate auth._jwt; select public.clear_alert_selection('res@example.com','00000000-0000-0000-0000-0000000000a1', array['meetings']);
truncate auth._jwt; insert into auth._jwt values ('{"email":"res@example.com"}'); select public.clear_alert_selection('res@example.com','00000000-0000-0000-0000-0000000000a1', array['news']);
truncate auth._jwt; insert into auth._jwt values ('{"email":"res@example.com"}'); select public.clear_alert_selection('res@example.com','00000000-0000-0000-0000-0000000000a1', array[]::text[]);

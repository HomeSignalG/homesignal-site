-- Scenarios for docs/maps-subscriber-zips-monitor-real-only.sql (run after suite.sql's helpers are
-- gone, so they are redefined by including suite.sql first in run.sh). Prints PASS/FAIL R..
do $$ declare r record; begin perform pg_temp.reset();
  perform pg_temp.add_sub('20000000-0000-0000-0000-000000000011', '98499', 'admin_test', interval '30 days');
  select * into r from pg_temp.tick();
  perform pg_temp.say('R01 a test-only ZIP is not put on the list and does not page', r.ok
    and not exists (select 1 from public.maps_zip_order where zip = '98499')
    and r.detail like '%1 test-only ZIP(s) not watched', r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  perform pg_temp.add_sub('20000000-0000-0000-0000-000000000012', '98499', 'campaign_test', interval '30 days');
  select * into r from pg_temp.tick();
  perform pg_temp.say('R02 "test" is the shared rule, not referral_source = admin_test', r.ok
    and r.detail like '%1 test-only ZIP(s) not watched', r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  delete from public.maps_zip_order where zip = '97702';
  select * into r from pg_temp.tick();
  perform pg_temp.say('R03 a REAL subscriber ZIP missing from the list still fails and is named', not r.ok
    and r.detail like '1 development-alert subscriber ZIP(s) are not on the MAPS post list: 97702%', r.detail); end $$;

do $$ declare r record; begin perform pg_temp.reset();
  perform pg_temp.add_sub('20000000-0000-0000-0000-000000000013', '98499', 'admin_test', interval '30 days');
  perform pg_temp.add_sub('20000000-0000-0000-0000-000000000014', '98499', null, interval '10 days');
  select * into r from pg_temp.tick();
  perform pg_temp.say('R04 a real subscriber beside a test one is on the list and watched', not r.ok
    and exists (select 1 from public.maps_zip_order where zip = '98499')
    and r.detail like '%98499 (since %', r.detail); end $$;

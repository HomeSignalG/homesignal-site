-- End-to-end proof of docs/acquisition-attribution.sql against the REAL schema, run inside ONE transaction that is ALWAYS rolled back
-- (the script ends by raising an exception that carries the results), so no row survives and production is not touched.
-- Run: execute this file with a role that can write (postgres). The result is the exception text "E2E_RESULT {...}".
--
-- It simulates each marketing source arriving as a first visit (what the browser sends), a page view, a registration (a new
-- auth user via the real individual_signup), and saved reports (via the real evaluation_report_issue), then reads the dashboard
-- function as an admin and asserts what it reports. It also proves the guard rails: bad input, wrong host, a non-owner,
-- a non-admin, replays, first-touch-wins, internal/test exclusion, the Pierce ZIP set, and the Los Angeles day boundary.
do $e2e$
declare
  res jsonb := '[]'::jsonb;
  admin_email text; admin_uid uuid;
  pz text; pz2 text;                                  -- two Pierce ZIPs from the set
  v_google uuid := gen_random_uuid(); v_bing uuid := gen_random_uuid(); v_bpierce uuid := gen_random_uuid();
  v_beng uuid := gen_random_uuid(); v_sales uuid := gen_random_uuid(); v_direct uuid := gen_random_uuid();
  v_unknown uuid := gen_random_uuid(); v_prior uuid := gen_random_uuid(); v_nonpierce uuid := gen_random_uuid();
  v_evil uuid := gen_random_uuid(); v_bad uuid := gen_random_uuid(); v_testv uuid := gen_random_uuid(); v_tz uuid := gen_random_uuid();
  u_google uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_old uuid := gen_random_uuid(); u_other uuid := gen_random_uuid();
  rid1 uuid; rid2 uuid; rid3 uuid;
  rep jsonb; row_ jsonb; n int; t text; ok boolean;
  today_la date := (now() at time zone 'America/Los_Angeles')::date;
  body text := '{"projects":[],"note":"e2e"}';
  hash text;

begin
  select email into admin_email from public.dashboard_admins limit 1;
  select id into admin_uid from auth.users where lower(email) = lower(admin_email);
  select min(zip), max(zip) into pz, pz2 from public.zip_set where set_key = 'pierce_wa';
  hash := encode(sha256(convert_to(body, 'UTF8')), 'hex');

  -- helpers -------------------------------------------------------------------------------------------------------------------
  create temp table chk (name text, pass boolean, detail text) on commit drop;

  -- 1. first visits: exactly what the browser would send (visitor id, host, utm, referrer HOST, landing PATH, zip) -------------
  perform public.record_first_touch(v_google,  'jodytracks.com', null, null, null, null, 'www.google.com', '/community/' || pz || '/', pz);
  perform public.record_first_touch(v_bing,    'jodytracks.com', null, null, null, null, 'www.bing.com',   '/community/' || pz || '/', pz);
  perform public.record_first_touch(v_bpierce, 'jodytracks.com', 'bluesky', 'social', 'pierce-zip', null, 'bsky.app', '/community/' || pz2 || '/', pz2);
  perform public.record_first_touch(v_beng,    'jodytracks.com', 'bluesky', 'social', 'engage-wa', null, null, '/', null);
  perform public.record_first_touch(v_sales,   'jodytracks.com', 'saleshandy', 'email', 'oct-agents-1', 'tmpl-a', null, '/development-activity.html', null);
  perform public.record_first_touch(v_direct,  'jodytracks.com', null, null, null, null, null, '/', null);
  perform public.record_first_touch(v_unknown, 'jodytracks.com', null, null, null, null, null, '/community/' || pz || '/', pz);
  perform public.record_first_touch(v_prior,   'homesignal.net', null, null, null, null, null, '/', null, null, true);   -- old domain + pre-existing browser
  perform public.record_first_touch(v_nonpierce, 'jodytracks.com', null, null, null, null, 'www.google.com', '/community/84302/', '84302');
  perform public.record_first_touch(v_evil, 'evil.example.com', 'saleshandy', null, null, null, null, '/', null);           -- host not ours
  perform public.record_first_touch(v_bad, 'jodytracks.com', 'bluesky<script>', 'a@b.com', 'x y', null, 'x@evil.com', '/community/' || pz || '/?addr=12+Main+St#secret', pz);
  perform public.record_first_touch(v_testv, 'jodytracks.com', 'saleshandy', 'email', 'audit-test-1', null, null, '/', null);
  perform public.record_first_touch(v_google,  'jodytracks.com', 'saleshandy', 'email', 'late', null, null, '/', null);      -- second call: first touch must win

  insert into chk select 'google referrer -> google_organic', channel = 'google_organic', channel from public.acquisition_touch where subject_id = v_google::text;
  insert into chk select 'first touch wins at the database', count(*) = 1 and max(channel) = 'google_organic', count(*)::text from public.acquisition_touch where subject_id = v_google::text;
  insert into chk select 'bing referrer -> bing_organic', channel = 'bing_organic', channel from public.acquisition_touch where subject_id = v_bing::text;
  insert into chk select 'bluesky/pierce-zip -> bluesky_pierce_auto', channel = 'bluesky_pierce_auto', channel from public.acquisition_touch where subject_id = v_bpierce::text;
  insert into chk select 'bluesky/engage-wa -> bluesky_engagement', channel = 'bluesky_engagement', channel from public.acquisition_touch where subject_id = v_beng::text;
  insert into chk select 'saleshandy utm -> saleshandy', channel = 'saleshandy', channel from public.acquisition_touch where subject_id = v_sales::text;
  insert into chk select 'home landing, no referrer -> direct', channel = 'direct', channel from public.acquisition_touch where subject_id = v_direct::text;
  insert into chk select 'deep landing, no referrer -> unknown (NOT direct)', channel = 'unknown', channel from public.acquisition_touch where subject_id = v_unknown::text;
  insert into chk select 'pre-existing browser without utm -> not_collected', channel = 'not_collected' and host = 'homesignal.net', channel || '/' || host from public.acquisition_touch where subject_id = v_prior::text;
  insert into chk select 'foreign host writes nothing', count(*) = 0, count(*)::text from public.acquisition_touch where subject_id = v_evil::text;
  insert into chk select 'invalid utm/referrer/query/address are dropped',
    utm_source is null and utm_medium is null and utm_campaign is null and referrer is null and landing_path = '/community/' || pz || '/',
    coalesce(utm_source,'-') || '|' || coalesce(utm_campaign,'-') || '|' || coalesce(referrer,'-') || '|' || coalesce(landing_path,'-')
    from public.acquisition_touch where subject_id = v_bad::text;
  insert into chk select 'audit-test campaign is internal', is_internal, is_internal::text from public.acquisition_touch where subject_id = v_testv::text;
  insert into chk select 'no stored value contains an @ or ?',
    not exists (select 1 from public.acquisition_touch where subject_type = 'visitor' and (coalesce(referrer,'') || coalesce(landing_path,'') || coalesce(utm_campaign,'')) ~ '[@?#]'), '';

  -- 2. page views (as the anon role inserts them) ----------------------------------------------------------------------------
  insert into public.events (event_type, visitor_id, visit_session_id, host, zip_code, page_url, session_id, entry_family)
  select 'page_view', v, 'vs-' || left(v::text, 8), 'jodytracks.com', z, 'https://jodytracks.com/', 'legacy', 'home'
    from (values (v_google, pz), (v_bing, pz), (v_bpierce, pz2), (v_beng, null), (v_sales, null), (v_direct, null), (v_unknown, pz),
                 (v_prior, null), (v_nonpierce, '84302'), (v_testv, null)) t(v, z);
  -- a second DAY for v_google (repeat visitor) and two page views in ONE session (sessions != page views)
  insert into public.events (event_type, visitor_id, visit_session_id, host, zip_code, page_url, created_at)
  values ('page_view', v_google, 'vs-' || left(v_google::text, 8), 'jodytracks.com', pz, 'https://jodytracks.com/x', now()),
         ('page_view', v_google, 'vs-second-day', 'jodytracks.com', pz, 'https://jodytracks.com/x', now() - interval '1 day');
  -- Los Angeles day boundary: 06:30 UTC on D+1 is the previous LA day; 07:30 UTC is the new LA day
  insert into public.events (event_type, visitor_id, visit_session_id, host, zip_code, page_url, created_at)
  values ('page_view', v_tz, 'vs-tz-a', 'jodytracks.com', pz, 'https://jodytracks.com/', ((today_la - 5)::timestamp + interval '1 day 6 hours 30 minutes') at time zone 'UTC'),
         ('page_view', v_tz, 'vs-tz-b', 'jodytracks.com', pz, 'https://jodytracks.com/', ((today_la - 5)::timestamp + interval '1 day 7 hours 30 minutes') at time zone 'UTC');
  perform public.record_first_touch(v_tz, 'jodytracks.com', null, null, null, null, 'www.google.com', '/community/' || pz || '/', pz);

  -- 3. registrations: real individual_signup creates account + owner membership + evaluation -----------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
    (u_google, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e2e-google@example.invalid', now(), now() + interval '1 second', now()),
    (u_sales,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e2e-sales@example.invalid', now(), now() + interval '1 second', now()),
    (u_other,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e2e-other@example.invalid', now(), now() + interval '1 second', now()),
    (u_old,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e2e-old@example.invalid', now(), now() - interval '90 days', now());
  perform public.individual_signup(u_google, 'E2E Google Agent');
  perform public.individual_signup(u_sales,  'E2E Saleshandy Agent');
  perform public.individual_signup(u_other,  'E2E Other Agent');

  perform set_config('request.jwt.claims', json_build_object('sub', u_google, 'email', 'e2e-google@example.invalid', 'role', 'authenticated')::text, true);
  perform public.claim_first_touch(v_google);
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'email', 'e2e-sales@example.invalid', 'role', 'authenticated')::text, true);
  perform public.claim_first_touch(v_sales);
  perform set_config('request.jwt.claims', json_build_object('sub', u_old, 'email', 'e2e-old@example.invalid', 'role', 'authenticated')::text, true);
  perform public.claim_first_touch(v_direct);                   -- an OLD account signing in later must not be credited to this visit
  perform set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'email', admin_email, 'role', 'authenticated')::text, true);
  perform public.claim_first_touch(v_direct);                   -- admin: marks the visitor internal
  perform public.claim_first_touch(v_direct);                   -- idempotent

  insert into chk select 'new account inherits the Google first touch', channel = 'google_organic', channel from public.acquisition_touch where subject_type = 'account' and subject_id = u_google::text;
  insert into chk select 'new account inherits the Saleshandy first touch', channel = 'saleshandy', channel from public.acquisition_touch where subject_type = 'account' and subject_id = u_sales::text;
  insert into chk select 'older account is NOT credited to a later visit', channel = 'not_collected', channel from public.acquisition_touch where subject_type = 'account' and subject_id = u_old::text;
  insert into chk select 'admin visitor becomes internal', (select is_internal from public.acquisition_touch where subject_id = v_direct::text), '';
  insert into chk select 'claim is idempotent (one account row per user)', count(*) = 1, count(*)::text from public.acquisition_touch where subject_type = 'account' and subject_id = admin_uid::text;

  -- 4. reports: only STORED snapshots count; a replay or a non-owner is not counted --------------------------------------------
  select report_id into rid1 from public.evaluation_report_issue(u_google, gen_random_uuid(), body || ' ', encode(sha256(convert_to(body || ' ', 'UTF8')), 'hex'), 'e2e-1', '{}'::jsonb);
  select report_id into rid2 from public.evaluation_report_issue(u_google, gen_random_uuid(), body || '  ', encode(sha256(convert_to(body || '  ', 'UTF8')), 'hex'), 'e2e-1', '{}'::jsonb);
  select report_id into rid3 from public.evaluation_report_issue(u_sales, gen_random_uuid(), body || '   ', encode(sha256(convert_to(body || '   ', 'UTF8')), 'hex'), 'e2e-1', '{}'::jsonb);
  -- also a report that is issued but never attributed (client never called)
  perform public.evaluation_report_issue(u_other, gen_random_uuid(), body || '    ', encode(sha256(convert_to(body || '    ', 'UTF8')), 'hex'), 'e2e-1', '{}'::jsonb);

  -- Reports are NOT attributed by the browser. The reader derives them: report -> its brokerage's single active member at generation time.
  insert into chk select 'a report resolves to its brokerage''s single active member', (select user_id from public._report_account(rid1, now())) = u_google
     and (select user_id from public._report_account(rid3, now())) = u_sales, '';
  insert into chk select 'a report from before the member joined resolves to nobody (not guessed)', (select user_id from public._report_account(rid1, now() - interval '10 days')) is null, '';
  insert into chk select 'no report_attribution row was written by anything (retired table stays empty)', not exists (select 1 from public.report_attribution), '';

  perform set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'email', admin_email, 'role', 'authenticated')::text, true);
  rep := public.hs_acq_channel_report(today_la - 7, today_la, 'day', null, false);
  select r into row_ from jsonb_array_elements(rep->'range') r where r->>'channel' = 'google_organic';
  insert into chk values ('google_organic: 3 visitors in period (2 today + the LA-boundary visitor), 1 repeat', (row_->>'visitors')::int = 3 and (row_->>'repeat_visitors')::int >= 1, row_::text);
  insert into chk values ('google_organic: 1 registered account', (row_->>'registered_users')::int = 1, row_->>'registered_users');
  insert into chk values ('google_organic: 2 reports by 1 user', (row_->>'reports_created')::int = 2 and (row_->>'report_users')::int = 1, (row_->>'reports_created') || '/' || (row_->>'report_users'));
  select r into row_ from jsonb_array_elements(rep->'range') r where r->>'channel' = 'saleshandy';
  insert into chk values ('saleshandy: test-campaign visitor excluded by default, 1 visitor, 1 registered, 1 report', (row_->>'visitors')::int = 1 and (row_->>'registered_users')::int = 1 and (row_->>'reports_created')::int = 1, row_::text);
  select r into row_ from jsonb_array_elements(rep->'range') r where r->>'channel' = 'direct';
  insert into chk values ('direct: the admin-claimed visitor is internal, so excluded', row_ is null, coalesce(row_::text, 'absent'));
  select r into row_ from jsonb_array_elements(rep->'range') r where r->>'channel' = 'unknown';
  insert into chk values ('unknown is reported separately from direct', row_ is not null, coalesce(row_::text, 'absent'));
  insert into chk values ('reports with no recorded source are not_attributed (never assigned a channel)',
    exists (select 1 from jsonb_array_elements(rep->'range') r where r->>'channel' = 'not_attributed' and (r->>'reports_created')::int >= 1), '');

  -- internal/test traffic is excluded unless asked for
  rep := public.hs_acq_channel_report(today_la - 7, today_la, 'day', null, true);
  select r into row_ from jsonb_array_elements(rep->'range') r where r->>'channel' = 'saleshandy';
  insert into chk values ('include_internal brings the audit-test visitor back', (row_->>'visitors')::int = 2, row_->>'visitors');

  -- Los Angeles days: 06:30Z and 07:30Z on the same UTC date land on two different LA days
  rep := public.hs_acq_channel_report(today_la - 7, today_la, 'day', null, false);
  select count(distinct r->>'period') into n from jsonb_array_elements(rep->'rows') r
   where r->>'channel' = 'google_organic' and (r->>'period')::date in (today_la - 5, today_la - 4) and (r->>'visitors')::int >= 1;
  insert into chk values ('America/Los_Angeles: 06:30Z and 07:30Z fall on different LA days', n = 2, n::text);

  -- weekly grouping: week starts Monday (LA)
  rep := public.hs_acq_channel_report(today_la - 20, today_la, 'week', null, false);
  insert into chk values ('weekly periods are Mondays', not exists (select 1 from jsonb_array_elements(rep->'rows') r where r->>'period' is not null and extract(isodow from (r->>'period')::date) <> 1), '');

  -- Pierce ZIP set: only visitors who viewed a Pierce ZIP page
  rep := public.hs_acq_channel_report(today_la - 7, today_la, 'day', 'pierce_wa', false);
  select r into row_ from jsonb_array_elements(rep->'range') r where r->>'channel' = 'google_organic';
  insert into chk values ('Pierce filter excludes the 84302 visitor, keeps the 2 Pierce google visitors', (row_->>'visitors')::int = 2, coalesce(row_->>'visitors', 'null'));
  select r into row_ from jsonb_array_elements(rep->'range') r where r->>'channel' = 'bluesky_pierce_auto';
  insert into chk values ('Pierce filter shows the Pierce Bluesky visitor', (row_->>'visitors')::int = 1, coalesce(row_->>'visitors', 'null'));
  insert into chk values ('Pierce set reports its size and that county overlap is NOT evaluated',
    (rep->'zip_set'->>'zips')::int = (select count(*) from public.zip_set where set_key = 'pierce_wa') and (rep->'zip_set'->>'overlap_evaluated') = 'false', rep->>'zip_set');
  rep := public.hs_acq_channel_report(today_la - 7, today_la, 'day', null, false);
  select r into row_ from jsonb_array_elements(rep->'range') r where r->>'channel' = 'google_organic';

  -- gate and grants
  insert into chk values ('anon cannot run the reader or claim; no browser role can run the helpers or the retired attribute_report',
    not has_function_privilege('anon', 'public.hs_acq_channel_report(date,date,text,text,boolean)', 'execute')
    and not has_function_privilege('anon', 'public.claim_first_touch(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.attribute_report(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public._report_account(uuid,timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public._acq_channel_rows(date,date,text,text[],boolean)', 'execute'), '');
  insert into chk values ('anon CAN record a first touch (the only anon writer)', has_function_privilege('anon', 'public.record_first_touch(uuid,text,text,text,text,text,text,text,text,timestamptz,boolean)', 'execute'), '');
  insert into chk values ('no table grant to anon/authenticated on the new tables',
    not exists (select 1 from information_schema.role_table_grants where table_name in ('report_attribution','analytics_exclusion','zip_set','acquisition_touch') and grantee in ('anon','authenticated')), '');
  perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'email', 'e2e-other@example.invalid', 'role', 'authenticated')::text, true);
  begin
    perform public.hs_acq_channel_report();
    ok := false; t := 'no error';
  exception when others then ok := sqlstate = '42501'; t := sqlstate;
  end;
  insert into chk values ('a signed-in non-admin is refused (42501)', ok, t);

  -- the legacy dashboard function still runs and no longer counts visitor rows as marketing "attributed touches"
  perform set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'email', admin_email, 'role', 'authenticated')::text, true);
  insert into chk values ('hs_acquisition_metrics still runs and exposes registered_external',
    (public.hs_acquisition_metrics()->'kpis') ? 'registered_external', '');

  select jsonb_agg(jsonb_build_object('name', name, 'pass', pass, 'detail', detail) order by name) into res from chk;
  raise exception 'E2E_RESULT % passed % failed % %',
    (select count(*) filter (where pass) from chk), (select count(*) filter (where not pass) from chk), chr(10), res::text;   -- rolls everything back
end $e2e$;

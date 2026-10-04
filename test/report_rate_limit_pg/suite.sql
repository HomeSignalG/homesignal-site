-- =====================================================================================
-- REPORT RATE LIMIT — EXECUTABLE ADVERSARIAL SUITE  (docs/report-rate-limit.sql)
--
-- A per-person and per-brokerage ceiling on report REQUESTS (the work before a report is charged), in fixed windows of a minute, an hour and a day.
-- The suite stands on the REAL account spine and every entitlement layer, applied unmutated (run.sh), and asks the rule at FIXED instants
-- (public.report_rate_claim_at takes the clock) so every window boundary is exact and nothing depends on when it runs. Every instant is in 2031, so
-- the database's own clock (used only by the wrapper check F04, on a person with no other row) can never meet one.
-- Every expected answer is a HARD-CODED constant, never computed by the code under test. The suite runs as the table owner; what the API roles
-- may do is asked of the catalog here and of the roles themselves in run.sh.
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);
create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;

create function pg_temp._why(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || ': ' || sqlerrm; end $$;

-- the nth person, an instant, and a counter read
create function pg_temp._u(n integer) returns uuid language sql as $$ select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._t(s text) returns timestamptz language sql as $$ select (s || '+00')::timestamptz $$;
create function pg_temp._used(p_bucket text, p_subject uuid, p_secs integer) returns integer language sql as
$$ select used from public.report_rate_window where bucket = p_bucket and subject = p_subject and window_secs = p_secs $$;

-- the FIRST row of a claim (a claim must answer exactly one row; B02 and B05 check that, and every other check reads the first so a defect that
-- answers two rows is named by those two and does not crash the rest)
create function pg_temp._claim1(p_user uuid, p_at timestamptz) returns table (allowed boolean, retry_after_seconds integer, limited_by text, limited_window_secs integer)
language sql as $$ select * from public.report_rate_claim_at(p_user, p_at) limit 1 $$;

-- how many of p_n claims, p_step_secs apart from p_start, were allowed
create function pg_temp._burst(p_user uuid, p_start timestamptz, p_n integer, p_step_secs numeric) returns integer language plpgsql as $$
declare k integer; got integer := 0; r record;
begin
  for k in 0 .. p_n - 1 loop
    select * into r from public.report_rate_claim_at(p_user, p_start + (k * p_step_secs) * interval '1 second');
    if r.allowed then got := got + 1; end if;
  end loop;
  return got;
end $$;

-- ---- the population: three brokerages and twelve people -----------------------------------------------------------------------------------
-- B1: U1 U2 U3   B2: U4   B3: U6 U7 U8 U9 (four people, so the brokerage ceiling can be reached before any one person's)   no brokerage: U5 U10 U11 U12
insert into auth.users (id, email) select pg_temp._u(i), 'rate' || i || '@example.test' from generate_series(1, 12) i;
insert into public.brokerage_account (id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'Rate One'), ('e1000000-0000-4000-8000-000000000002', 'Rate Two'), ('e1000000-0000-4000-8000-000000000003', 'Rate Three');
insert into public.brokerage_member (brokerage_id, user_id, role)
  select ('e1000000-0000-4000-8000-00000000000' || b)::uuid, pg_temp._u(u), r
    from (values (1, 1, 'owner'), (1, 2, 'agent'), (1, 3, 'agent'), (2, 4, 'owner'), (3, 6, 'owner'), (3, 7, 'agent'), (3, 8, 'agent'), (3, 9, 'agent')) m(b, u, r);

-- =====================================================================================
-- A. THE NUMBERS ARE EXACTLY THE ONES THE FILE STATES, AND THE FOUNDER'S TWO ARE UNTOUCHED
-- =====================================================================================
select pg_temp._ck('A01 the limits are exactly the six this file states (person 10/60/200, brokerage 30/200/1000)',
  (select string_agg(bucket || ':' || window_secs || ':' || max_requests, ',' order by bucket collate "C", window_secs) from public.report_rate_limits())
    = 'brokerage:60:30,brokerage:3600:200,brokerage:86400:1000,user:60:10,user:3600:60,user:86400:200',
  (select string_agg(bucket || ':' || window_secs || ':' || max_requests, ',' order by bucket collate "C", window_secs) from public.report_rate_limits()));
select pg_temp._ck('A02 the founder''s 20 free reports and 100 paid reports a month are untouched',
  public.evaluation_report_limit() = 20 and public.billing_report_limit() = 100,
  public.evaluation_report_limit() || '/' || public.billing_report_limit());
select pg_temp._ck('A03 nothing the entitlement owns refers to the limiter: it is beside the credit path, not in it',
  not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'report\_rate\_%' and p.prosrc like '%report_rate%'),
  (select string_agg(p.proname, ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'report\_rate\_%' and p.prosrc like '%report_rate%'));

-- =====================================================================================
-- B. THE PERSON'S MINUTE (U5 has no brokerage: the person's windows are the only ones)
-- =====================================================================================
create temp table _b as select * from public.report_rate_claim_at(pg_temp._u(5), pg_temp._t('2031-03-15 12:00:00'));
select pg_temp._ck('B01 a first request is allowed, with no wait and no limiter named',
  (select bool_and(allowed and retry_after_seconds = 0 and limited_by is null and limited_window_secs is null) from _b), (select string_agg(row_to_json(x)::text, ' ') from _b x));
select pg_temp._ck('B02 a claim returns exactly one row', (select count(*) from _b) = 1, (select count(*)::text from _b));
select pg_temp._ck('B03 nine more in the same minute are allowed (ten in all)', pg_temp._burst(pg_temp._u(5), pg_temp._t('2031-03-15 12:00:01'), 9, 1) = 9);
create temp table _b2 as select * from public.report_rate_claim_at(pg_temp._u(5), pg_temp._t('2031-03-15 12:00:30'));
select pg_temp._ck('B04 the eleventh in that minute is refused, by the person, in the 60-second window, and told to wait the 30 seconds that remain',
  (select bool_and(not allowed and limited_by = 'user' and limited_window_secs = 60 and retry_after_seconds = 30) from _b2), (select string_agg(row_to_json(x)::text, ' ') from _b2 x));
select pg_temp._ck('B05 the refusal answers exactly one row too', (select count(*) from _b2) = 1, (select count(*)::text from _b2));
select pg_temp._ck('B06 five more refused tries in the same minute are all refused', pg_temp._burst(pg_temp._u(5), pg_temp._t('2031-03-15 12:00:31'), 5, 1) = 0);
select pg_temp._ck('B07 REFUSED ATTEMPTS CONSUME NOTHING: after six refusals the minute, the hour and the day each still read exactly 10',
  pg_temp._used('user', pg_temp._u(5), 60) = 10 and pg_temp._used('user', pg_temp._u(5), 3600) = 10 and pg_temp._used('user', pg_temp._u(5), 86400) = 10,
  pg_temp._used('user', pg_temp._u(5), 60) || '/' || pg_temp._used('user', pg_temp._u(5), 3600) || '/' || pg_temp._used('user', pg_temp._u(5), 86400));
select pg_temp._ck('B08 a refusal in the last half second of a minute still tells the person to wait 1 second, never 0',
  (select not allowed and retry_after_seconds = 1 and limited_by = 'user' and limited_window_secs = 60 from pg_temp._claim1(pg_temp._u(5), pg_temp._t('2031-03-15 12:00:59.5'))));
select pg_temp._ck('B09 the next minute opens again: allowed at 12:01:00, the hour now reads 11 and the new minute reads 1',
  (select allowed from pg_temp._claim1(pg_temp._u(5), pg_temp._t('2031-03-15 12:01:00'))) and pg_temp._used('user', pg_temp._u(5), 3600) = 11 and pg_temp._used('user', pg_temp._u(5), 60) = 1,
  pg_temp._used('user', pg_temp._u(5), 3600) || '/' || pg_temp._used('user', pg_temp._u(5), 60));
select pg_temp._ck('B10 a person without a brokerage writes no brokerage counter',
  not exists (select 1 from public.report_rate_window where bucket = 'brokerage' and subject = pg_temp._u(5)));
select pg_temp._ck('B11 people are limited separately: another person (U10) is allowed while U5 was refused in the same minute',
  (select allowed from pg_temp._claim1(pg_temp._u(10), pg_temp._t('2031-03-15 12:00:40'))));

-- =====================================================================================
-- C. THE PERSON'S HOUR, AND WHICH LIMIT SPEAKS WHEN TWO REFUSE (U2 is in B1)
-- =====================================================================================
select pg_temp._ck('C01 sixty requests 10 seconds apart (six a minute for ten minutes) are all allowed: 60 in the hour',
  pg_temp._burst(pg_temp._u(2), pg_temp._t('2031-03-15 12:00:00'), 60, 10) = 60);
create temp table _c as select * from public.report_rate_claim_at(pg_temp._u(2), pg_temp._t('2031-03-15 12:10:00'));
select pg_temp._ck('C02 the 61st in the hour is refused by the person in the 3600-second window and told to wait the 3000 seconds that remain',
  (select bool_and(not allowed and limited_by = 'user' and limited_window_secs = 3600 and retry_after_seconds = 3000) from _c), (select string_agg(row_to_json(x)::text, ' ') from _c x));
select pg_temp._ck('C03 the next hour opens again at 13:00:00',
  (select allowed from pg_temp._claim1(pg_temp._u(2), pg_temp._t('2031-03-15 13:00:00'))));
-- both the minute and the hour are full: the longer wait is the one reported (U3 is primed as the table owner; the logic under test is the claim)
insert into public.report_rate_window (bucket, subject, window_secs, window_start, used) values
  ('user', pg_temp._u(3), 60, pg_temp._t('2031-03-15 12:50:00'), 10), ('user', pg_temp._u(3), 3600, pg_temp._t('2031-03-15 12:00:00'), 60);
create temp table _c2 as select * from public.report_rate_claim_at(pg_temp._u(3), pg_temp._t('2031-03-15 12:50:30'));
select pg_temp._ck('C04 when the minute AND the hour are full, the LONGER wait is reported: the hour, 570 seconds',
  (select bool_and(not allowed and limited_by = 'user' and limited_window_secs = 3600 and retry_after_seconds = 570) from _c2), (select string_agg(row_to_json(x)::text, ' ') from _c2 x));

-- =====================================================================================
-- D. THE PERSON'S DAY (200, through the claim alone: 72 seconds apart keeps the minute and the hour clear; U12 has no brokerage)
-- =====================================================================================
select pg_temp._ck('D01 200 requests 72 seconds apart across four hours are all allowed',
  pg_temp._burst(pg_temp._u(12), pg_temp._t('2031-03-15 00:00:00'), 200, 72) = 200);
create temp table _d as select * from public.report_rate_claim_at(pg_temp._u(12), pg_temp._t('2031-03-15 04:00:00'));
select pg_temp._ck('D02 the 201st in the day is refused by the person in the 86400-second window, told to wait until midnight UTC (72000 seconds)',
  (select bool_and(not allowed and limited_by = 'user' and limited_window_secs = 86400 and retry_after_seconds = 72000) from _d), (select string_agg(row_to_json(x)::text, ' ') from _d x));
select pg_temp._ck('D03 the next day opens again at 00:00:00',
  (select allowed from pg_temp._claim1(pg_temp._u(12), pg_temp._t('2031-03-16 00:00:00'))));

-- =====================================================================================
-- E. THE BROKERAGE'S CEILING IS SHARED BY ITS PEOPLE (B3 has four people)
-- =====================================================================================
-- eight each would be 32 requests: no person reaches their ten, but the brokerage reaches its 30
select pg_temp._ck('E01 four people making 8, 8, 8 and 6 requests inside one minute: all 30 are allowed',
  pg_temp._burst(pg_temp._u(6), pg_temp._t('2031-03-15 14:00:00'), 8, 1) + pg_temp._burst(pg_temp._u(7), pg_temp._t('2031-03-15 14:00:10'), 8, 1)
  + pg_temp._burst(pg_temp._u(8), pg_temp._t('2031-03-15 14:00:20'), 8, 1) + pg_temp._burst(pg_temp._u(9), pg_temp._t('2031-03-15 14:00:30'), 6, 1) = 30);
create temp table _e as select * from public.report_rate_claim_at(pg_temp._u(9), pg_temp._t('2031-03-15 14:00:40'));
select pg_temp._ck('E02 the 31st is refused by the BROKERAGE in the 60-second window although that person has used only six of their ten; wait 20 seconds',
  (select bool_and(not allowed and limited_by = 'brokerage' and limited_window_secs = 60 and retry_after_seconds = 20) from _e), (select string_agg(row_to_json(x)::text, ' ') from _e x));
select pg_temp._ck('E03 a refusal by the brokerage consumes nothing from the person either: U9 still reads six in the minute and in the hour, the brokerage 30',
  pg_temp._used('user', pg_temp._u(9), 60) = 6 and pg_temp._used('user', pg_temp._u(9), 3600) = 6 and pg_temp._used('brokerage', 'e1000000-0000-4000-8000-000000000003', 60) = 30,
  pg_temp._used('user', pg_temp._u(9), 60) || '/' || pg_temp._used('user', pg_temp._u(9), 3600) || '/' || pg_temp._used('brokerage', 'e1000000-0000-4000-8000-000000000003', 60));
select pg_temp._ck('E04 another brokerage is unaffected at the same moment (B2''s U4 is allowed at 14:00:40)',
  (select allowed from pg_temp._claim1(pg_temp._u(4), pg_temp._t('2031-03-15 14:00:40'))));
select pg_temp._ck('E05 the brokerage window opens again the next minute for the same person',
  (select allowed from pg_temp._claim1(pg_temp._u(9), pg_temp._t('2031-03-15 14:01:00'))));
select pg_temp._ck('E06 a person with no brokerage has exactly 3 counter rows (the person''s three windows), U5 as the example',
  (select count(*) from public.report_rate_window where subject = pg_temp._u(5)) = 3, (select count(*)::text from public.report_rate_window where subject = pg_temp._u(5)));
select pg_temp._ck('E07 a member of a brokerage has 3 person rows and shares 3 brokerage rows: U4 and B2',
  (select count(*) from public.report_rate_window where subject = pg_temp._u(4)) = 3 and (select count(*) from public.report_rate_window where subject = 'e1000000-0000-4000-8000-000000000002') = 3);

-- =====================================================================================
-- F. THE CLOCK
-- =====================================================================================
select pg_temp._ck('F01 (setup) ten requests fill U1''s 15:00 minute', pg_temp._burst(pg_temp._u(1), pg_temp._t('2031-03-15 15:00:00'), 10, 1) = 10);
select pg_temp._ck('F02 a request stamped a minute EARLIER (14:59:30) than the full 15:00 window is still refused: an old clock cannot reopen a window',
  not (select allowed from pg_temp._claim1(pg_temp._u(1), pg_temp._t('2031-03-15 14:59:30'))));
select pg_temp._ck('F03 and it did not reset the counter: the minute still reads 10',
  pg_temp._used('user', pg_temp._u(1), 60) = 10, pg_temp._used('user', pg_temp._u(1), 60)::text);
select pg_temp._ck('F04a (setup) a claim through the wrapper, which passes the database''s own clock, is allowed', (select bool_and(allowed) from public.report_rate_claim(pg_temp._u(11))));
select pg_temp._ck('F04 and it stamped a minute window that began within the last 61 seconds of the database''s clock (in the same statement the row would not be visible, so this is a separate one)',
  (select window_start <= now() and window_start > now() - interval '61 seconds' from public.report_rate_window where bucket = 'user' and subject = pg_temp._u(11) and window_secs = 60));

-- =====================================================================================
-- G. INPUT
-- =====================================================================================
select pg_temp._ck('G01 a missing person is refused by name', pg_temp._why($$select * from public.report_rate_claim_at(null, now())$$) like '22023: RATE_CLAIM_NEEDS_USER_AND_TIME%',
  pg_temp._why($$select * from public.report_rate_claim_at(null, now())$$));
select pg_temp._ck('G02 a missing time is refused by name', pg_temp._why($$select * from public.report_rate_claim_at('e0000000-0000-4000-8000-000000000001', null)$$) like '22023: RATE_CLAIM_NEEDS_USER_AND_TIME%',
  pg_temp._why($$select * from public.report_rate_claim_at('e0000000-0000-4000-8000-000000000001', null)$$));

-- =====================================================================================
-- H. WHAT IT STORES
-- =====================================================================================
select pg_temp._ck('H01 the counter table holds exactly: bucket, subject (a uuid), window_secs, window_start, used - no email, address, IP or token',
  (select string_agg(column_name || ':' || data_type, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'report_rate_window')
    = 'bucket:text,subject:uuid,used:integer,window_secs:integer,window_start:timestamp with time zone',
  (select string_agg(column_name || ':' || data_type, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'report_rate_window'));
select pg_temp._ck('H02 a window is overwritten in place: U2 made requests in eleven different minutes and still has exactly 3 person rows',
  (select count(*) from public.report_rate_window where bucket = 'user' and subject = pg_temp._u(2)) = 3, (select count(*)::text from public.report_rate_window where bucket = 'user' and subject = pg_temp._u(2)));
select pg_temp._ck('H03 no row anywhere exceeds its limit',
  not exists (select 1 from public.report_rate_window w join public.report_rate_limits() l on l.bucket = w.bucket and l.window_secs = w.window_secs where w.used > l.max_requests));

-- =====================================================================================
-- I. ACCESS
-- =====================================================================================
select pg_temp._ck('I01 anon and authenticated can execute NONE of the four functions',
  not exists (select 1 from unnest(array['public.report_rate_limits()', 'public.report_rate_claim_at(uuid, timestamptz)', 'public.report_rate_claim(uuid)', 'public.report_rate_check()']) f,
                          unnest(array['anon', 'authenticated']) r where has_function_privilege(r, f, 'EXECUTE')),
  (select string_agg(r || ':' || f, ',') from unnest(array['public.report_rate_limits()', 'public.report_rate_claim_at(uuid, timestamptz)', 'public.report_rate_claim(uuid)', 'public.report_rate_check()']) f,
      unnest(array['anon', 'authenticated']) r where has_function_privilege(r, f, 'EXECUTE')));
select pg_temp._ck('I02 service_role can execute the claim, the clocked claim, the limits and the audit',
  has_function_privilege('service_role', 'public.report_rate_claim(uuid)', 'EXECUTE') and has_function_privilege('service_role', 'public.report_rate_claim_at(uuid, timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.report_rate_limits()', 'EXECUTE') and has_function_privilege('service_role', 'public.report_rate_check()', 'EXECUTE'));
select pg_temp._ck('I03 no API role has ANY privilege on the counter table (the system role reaches it only through the functions)',
  not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
               where has_table_privilege(r, 'public.report_rate_window', p)));
select pg_temp._ck('I04 row level security is on, and no policy opens it',
  (select relrowsecurity from pg_class where oid = 'public.report_rate_window'::regclass) and not exists (select 1 from pg_policy where polrelid = 'public.report_rate_window'::regclass));
select pg_temp._ck('I05 the claim and audit functions are SECURITY DEFINER with a pinned search path (they read the membership resolver and write the table on the caller''s behalf)',
  (select bool_and(prosecdef and proconfig::text like '%search_path%') from pg_proc where pronamespace = 'public'::regnamespace and proname in ('report_rate_claim', 'report_rate_claim_at', 'report_rate_check')));

-- =====================================================================================
-- J. THE AUDIT
-- =====================================================================================
select pg_temp._ck('J01 every invariant of report_rate_check reads zero', not exists (select 1 from public.report_rate_check() where kind = 'invariant' and n <> 0),
  (select string_agg(check_name || '=' || n, ';') from public.report_rate_check() where kind = 'invariant' and n <> 0));
select pg_temp._ck('J02 beside controls that are not zero: six limits and many counter rows',
  (select n from public.report_rate_check() where check_name = 'limits_defined') = 6 and (select n from public.report_rate_check() where check_name = 'counter_rows') > 10,
  (select string_agg(check_name || '=' || n, ';') from public.report_rate_check() where kind = 'control'));
insert into public.report_rate_window (bucket, subject, window_secs, window_start, used) values ('user', pg_temp._u(8), 86400, pg_temp._t('2031-03-15 00:00:00'), 201)
  on conflict (bucket, subject, window_secs) do update set used = 201;
select pg_temp._ck('J03 the audit CAN see a breach: a row planted above its limit reads 1',
  (select n from public.report_rate_check() where check_name = 'window_above_its_limit') = 1, (select n::text from public.report_rate_check() where check_name = 'window_above_its_limit'));
update public.report_rate_window set used = 1 where bucket = 'user' and subject = pg_temp._u(8) and window_secs = 86400;
select pg_temp._ck('J04 and it reads zero again once the planted row is corrected', (select n from public.report_rate_check() where check_name = 'window_above_its_limit') = 0);

select pg_temp._ck('S99 every population step ran: twelve people, three brokerages, eight memberships',
  (select count(*) from auth.users where email like 'rate%') = 12 and (select count(*) from public.brokerage_account where name like 'Rate %') = 3
  and (select count(*) from public.brokerage_member where brokerage_id in ('e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003')) = 8);

\o
select check_name, pass, detail from _r order by n;

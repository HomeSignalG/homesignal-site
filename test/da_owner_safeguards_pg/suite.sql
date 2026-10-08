-- =====================================================================================
-- DEVELOPMENT ACTIVITY OWNER SAFEGUARDS — EXECUTABLE ADVERSARIAL SUITE  (docs/da-owner-safeguards.sql)
--   A. the team: list, remove an agent, withdraw an invite      B. the client link rate limit      C. one open checkout at a time
-- The suite stands on the REAL account spine and every entitlement layer, applied unmutated (run.sh). Every instant is FIXED (the claims take the clock as
-- an argument), so nothing depends on when it runs. Every expected answer is a HARD-CODED constant, never computed by the code under test.
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
-- the value of a one-value statement as text, or the sqlstate it raised: a defect that raises must be NAMED by a failing check, never crash the suite
create function pg_temp._val(p_sql text) returns text language plpgsql as $$
declare v text;
begin execute p_sql into v; return coalesce(v, 'null'); exception when others then return 'ERR ' || sqlstate; end $$;
-- runs a statement, reports what it returned or the sqlstate it raised, and ALWAYS rolls its effects back: used for the refusals, so that a defect which lets a forbidden
-- removal through is NAMED by a failing check and cannot also change the population the later checks stand on
create function pg_temp._probe(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    raise exception using errcode = 'P0099', message = 'RAN:' || coalesce(v, 'null');
  exception when others then
    if sqlstate = 'P0099' then return sqlerrm; end if;
    return 'ERR ' || sqlstate || ': ' || sqlerrm;
  end;
end $$;
create function pg_temp._t(s text) returns timestamptz language sql as $$ select (s || '+00')::timestamptz $$;
create function pg_temp._u(n integer) returns uuid language sql as $$ select ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._h(s text) returns text language sql as $$ select substr(md5(s) || md5(s || 'x'), 1, 40) $$;

-- ---- the population ------------------------------------------------------------------------------------------------------------------------
-- Brokerage X (seat limit 2): owner U1, agents U2 U3.  Brokerage Y: owner U4, agent U5.  U6 belongs to nothing.  U7 is a second owner of X.  U8 an agent-to-be.
insert into auth.users (id, email) values
  (pg_temp._u(1), 'owner.x@example.test'), (pg_temp._u(2), 'agent.two@example.test'), (pg_temp._u(3), 'agent.three@example.test'),
  (pg_temp._u(4), 'owner.y@example.test'), (pg_temp._u(5), 'agent.five@example.test'), (pg_temp._u(6), 'nobody@example.test'),
  (pg_temp._u(7), 'owner.x2@example.test'), (pg_temp._u(8), 'agent.eight@example.test'), (pg_temp._u(9), null);

create temp table _ev (name text primary key, evaluation_id uuid, brokerage_id uuid);
insert into _ev select 'X', e.evaluation_id, e.brokerage_id from public.evaluation_create('Team X', 2, null) e;
insert into _ev select 'Y', e.evaluation_id, e.brokerage_id from public.evaluation_create('Team Y', null, null) e;

create temp table _tok (user_id uuid, token text);
create function pg_temp._join(p_eval text, p_role text, p_user uuid) returns void language plpgsql as $$
declare e uuid; t record;
begin
  select evaluation_id into e from _ev where name = p_eval;
  select * into t from public.evaluation_invite_mint(e, p_role, null);
  insert into _tok values (p_user, t.token);
  perform public.evaluation_invite_redeem(t.token, p_user);
end $$;

select pg_temp._join('X', 'owner', pg_temp._u(1));
select pg_temp._join('X', 'agent', pg_temp._u(2));
select pg_temp._join('X', 'agent', pg_temp._u(3));
select pg_temp._join('Y', 'owner', pg_temp._u(4));
select pg_temp._join('Y', 'agent', pg_temp._u(5));
select pg_temp._join('X', 'owner', pg_temp._u(7));

create function pg_temp._mid(p_user uuid) returns uuid language sql as
$$ select m.id from public.brokerage_member m where m.user_id = p_user order by m.joined_at desc limit 1 $$;
create function pg_temp._team(p_actor uuid) returns text language plpgsql as $$
begin return (select string_agg(kind || ':' || label, ',' order by kind collate "C", label collate "C") from public.brokerage_team_of(p_actor)); end $$;

-- =====================================================================================
-- A. THE TEAM
-- =====================================================================================
select pg_temp._ck('A01 an owner sees exactly the two agents of their own brokerage, masked',
  pg_temp._team(pg_temp._u(1)) = 'member:a***@example.test,member:a***@example.test', pg_temp._team(pg_temp._u(1)));
select pg_temp._ck('A02 the masked label is the first letter, ***, and the domain — never the address',
  (select string_agg(label, ',' order by label) from public.brokerage_team_of(pg_temp._u(1))) !~ 'agent\.|\.two|three', null);
select pg_temp._ck('A03 the listing never shows an owner (the asker, or the second owner)',
  (select count(*) from public.brokerage_team_of(pg_temp._u(1)) where role = 'owner') = 0);
select pg_temp._ck('A04 the other brokerage''s owner sees only their own agent, none of X''s',
  (select count(*) from public.brokerage_team_of(pg_temp._u(4))) = 1
  and not exists (select 1 from public.brokerage_team_of(pg_temp._u(4)) t where t.ref in (pg_temp._mid(pg_temp._u(2)), pg_temp._mid(pg_temp._u(3)))));
select pg_temp._ck('A05 an agent is refused the listing (NOT_ENTITLED, EV003)', pg_temp._why('select * from public.brokerage_team_of(''' || pg_temp._u(2) || ''')') like 'EV003: NOT_ENTITLED%', pg_temp._why('select * from public.brokerage_team_of(''' || pg_temp._u(2) || ''')'));
select pg_temp._ck('A06 a person with no brokerage is refused the listing in the same words', pg_temp._why('select * from public.brokerage_team_of(''' || pg_temp._u(6) || ''')') like 'EV003: NOT_ENTITLED%');
select pg_temp._ck('A07 a null asker is refused in the same words', pg_temp._why('select * from public.brokerage_team_of(null)') like 'EV003: NOT_ENTITLED%');

-- open invites: one open, one redeemed (listed above as a member, not an invite), one revoked, one expired
create temp table _inv (name text primary key, invite_id uuid);
insert into _inv select 'open', t.invite_id from public.evaluation_invite_mint((select evaluation_id from _ev where name = 'X'), 'agent', pg_temp._u(1)) t;
insert into _inv select 'revoked', t.invite_id from public.evaluation_invite_mint((select evaluation_id from _ev where name = 'X'), 'agent', pg_temp._u(1)) t;
select public.evaluation_invite_revoke((select invite_id from _inv where name = 'revoked'), pg_temp._u(1));
insert into _inv select 'expired', t.invite_id from public.evaluation_invite_mint((select evaluation_id from _ev where name = 'X'), 'agent', pg_temp._u(1), interval '1 hour') t;
alter table public.evaluation_invite disable trigger user;
update public.evaluation_invite set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where invite_id = (select invite_id from _inv where name = 'expired');
alter table public.evaluation_invite enable trigger user;
insert into _inv select 'ownerinvite', t.invite_id from public.evaluation_invite_mint((select evaluation_id from _ev where name = 'X'), 'owner', null) t;
insert into _inv select 'other', t.invite_id from public.evaluation_invite_mint((select evaluation_id from _ev where name = 'Y'), 'agent', pg_temp._u(4)) t;

select pg_temp._ck('A08 the listing carries exactly ONE open invite for X: not the redeemed, the revoked, the expired, an owner invite, or Y''s',
  (select count(*) from public.brokerage_team_of(pg_temp._u(1)) where kind = 'invite') = 1
  and (select ref from public.brokerage_team_of(pg_temp._u(1)) where kind = 'invite') = (select invite_id from _inv where name = 'open'));
select pg_temp._ck('A09 an invite row carries no label and no token (the label is null)', (select bool_and(label is null) from public.brokerage_team_of(pg_temp._u(1)) where kind = 'invite'));
select pg_temp._ck('A10 a member row carries an opaque handle that is the membership id',
  exists (select 1 from public.brokerage_team_of(pg_temp._u(1)) t where t.ref = pg_temp._mid(pg_temp._u(2))) and exists (select 1 from public.brokerage_team_of(pg_temp._u(1)) t where t.ref = pg_temp._mid(pg_temp._u(3))));

-- withdraw an invite: the existing function, which an owner may call for their own brokerage only
select pg_temp._ck('A11 another brokerage''s owner cannot withdraw X''s invite (EV003) and it stays open',
  pg_temp._why('select public.evaluation_invite_revoke(''' || (select invite_id from _inv where name = 'open') || ''', ''' || pg_temp._u(4) || ''')') like 'EV003%'
  and (select status from public.evaluation_invite where invite_id = (select invite_id from _inv where name = 'open')) = 'open');
select pg_temp._ck('A12 an agent cannot withdraw an invite', pg_temp._why('select public.evaluation_invite_revoke(''' || (select invite_id from _inv where name = 'open') || ''', ''' || pg_temp._u(2) || ''')') like 'EV003%');
select pg_temp._ck('A13 the owner withdraws their own open invite: true', public.evaluation_invite_revoke((select invite_id from _inv where name = 'open'), pg_temp._u(1)) = true);
select pg_temp._ck('A13b and it leaves the listing', (select count(*) from public.brokerage_team_of(pg_temp._u(1)) where kind = 'invite') = 0);

-- remove an agent
create temp table _cr0 as select count(*) n from public.evaluation_credit;
create temp table _mem0 as select count(*) n from public.brokerage_member;
select pg_temp._ck('R01 another brokerage''s owner cannot remove X''s agent (EV003) and the agent is still active',
  pg_temp._probe('select public.brokerage_member_remove(''' || pg_temp._u(4) || ''', ''' || pg_temp._mid(pg_temp._u(2)) || ''')') like 'ERR EV003: NOT_ENTITLED%'
  and (select status from public.brokerage_member where id = pg_temp._mid(pg_temp._u(2))) = 'active');
select pg_temp._ck('R02 an agent cannot remove another agent', pg_temp._probe('select public.brokerage_member_remove(''' || pg_temp._u(3) || ''', ''' || pg_temp._mid(pg_temp._u(2)) || ''')') like 'ERR EV003%'
  and (select status from public.brokerage_member where id = pg_temp._mid(pg_temp._u(2))) = 'active');
select pg_temp._ck('R03 an owner cannot remove themselves', pg_temp._probe('select public.brokerage_member_remove(''' || pg_temp._u(1) || ''', ''' || pg_temp._mid(pg_temp._u(1)) || ''')') like 'ERR EV003%'
  and (select status from public.brokerage_member where id = pg_temp._mid(pg_temp._u(1))) = 'active');
select pg_temp._ck('R04 an owner cannot remove another owner of their own brokerage', pg_temp._probe('select public.brokerage_member_remove(''' || pg_temp._u(1) || ''', ''' || pg_temp._mid(pg_temp._u(7)) || ''')') like 'ERR EV003%'
  and (select status from public.brokerage_member where id = pg_temp._mid(pg_temp._u(7))) = 'active');
select pg_temp._ck('R05 an unknown handle, a null handle and a null asker are refused in the same words',
  pg_temp._probe('select public.brokerage_member_remove(''' || pg_temp._u(1) || ''', ''' || pg_temp._u(99) || ''')') like 'ERR EV003: NOT_ENTITLED%'
  and pg_temp._probe('select public.brokerage_member_remove(''' || pg_temp._u(1) || ''', null)') like 'ERR EV003: NOT_ENTITLED%'
  and pg_temp._probe('select public.brokerage_member_remove(null, ''' || pg_temp._mid(pg_temp._u(2)) || ''')') like 'ERR EV003: NOT_ENTITLED%');
select pg_temp._ck('R06 nothing was changed by any of those refusals', (select count(*) from public.brokerage_member where status = 'deactivated') = 0);
select pg_temp._ck('R07 a person with no brokerage cannot remove anyone', pg_temp._probe('select public.brokerage_member_remove(''' || pg_temp._u(6) || ''', ''' || pg_temp._mid(pg_temp._u(2)) || ''')') like 'ERR EV003%');

select pg_temp._ck('R08 the owner removes an agent: true', pg_temp._val('select public.brokerage_member_remove(''' || pg_temp._u(1) || ''', ''' || pg_temp._mid(pg_temp._u(2)) || ''')') = 'true');
select pg_temp._ck('R09 the membership is deactivated and the guard stamped the time (not the caller)',
  (select status || ':' || (deactivated_at is not null) from public.brokerage_member where id = pg_temp._mid(pg_temp._u(2))) = 'deactivated:true');
select pg_temp._ck('R10 the removed agent has no standing at all any more (the one resolver returns nothing)',
  (select count(*) from public.brokerage_membership_of(pg_temp._u(2))) = 0);
select pg_temp._ck('R11 removing the same agent again is false, not an error', pg_temp._val('select public.brokerage_member_remove(''' || pg_temp._u(1) || ''', ''' || pg_temp._mid(pg_temp._u(2)) || ''')') = 'false');
select pg_temp._ck('R12 the listing no longer shows them; the other agent remains',
  pg_temp._team(pg_temp._u(1)) = 'member:a***@example.test' and not exists (select 1 from public.brokerage_team_of(pg_temp._u(1)) t where t.ref = pg_temp._mid(pg_temp._u(2))));
select pg_temp._ck('R13 the removed agent can no longer list the team or remove anyone', pg_temp._why('select * from public.brokerage_team_of(''' || pg_temp._u(2) || ''')') like 'EV003%');
select pg_temp._ck('R14 nothing is deleted: the membership row is still there and no credit row was added or removed',
  (select count(*) from public.brokerage_member) = (select n from _mem0) and (select count(*) from public.evaluation_credit) = (select n from _cr0));
select pg_temp._ck('R15 the other agent (U3) is untouched', (select status from public.brokerage_member where id = pg_temp._mid(pg_temp._u(3))) = 'active');
select pg_temp._ck('R16 Y''s agent and owners are untouched', (select count(*) from public.brokerage_member where status = 'active') = 5);
select pg_temp._ck('R17 the removed agent cannot get back in with the invite they used (INVITE_UNUSABLE)',
  pg_temp._why('select * from public.evaluation_invite_redeem(''' || (select token from _tok where user_id = pg_temp._u(2) order by ctid limit 1) || ''', ''' || pg_temp._u(2) || ''')') like 'EV001%');

-- the freed seat: X has a seat limit of 2 agents and both were taken; removing one frees one
select pg_temp._ck('R18 the seat is freed: a new agent can join X (seat limit 2) after one was removed', pg_temp._why('select pg_temp._join(''X'', ''agent'', ''' || pg_temp._u(8) || ''')') = 'ok');
select pg_temp._ck('R18b and that agent is active', (select status from public.brokerage_member where id = pg_temp._mid(pg_temp._u(8))) = 'active');
select pg_temp._ck('R19 and the seat limit still holds: a third active agent is refused (SEAT_LIMIT_REACHED)',
  pg_temp._why('select pg_temp._join(''X'', ''agent'', ''' || pg_temp._u(2) || ''')') like 'EV005%');

-- =====================================================================================
-- B. THE CLIENT LINK RATE LIMIT
-- =====================================================================================
select pg_temp._ck('B01 the limits are exactly the five this file states (client 30/300/2000, link 120/1500)',
  (select string_agg(bucket || ':' || window_secs || ':' || max_requests, ',' order by bucket collate "C", window_secs) from public.share_view_limits())
    = 'client:60:30,client:3600:300,client:86400:2000,link:60:120,link:3600:1500');

create function pg_temp._burst(p_client text, p_link text, p_start timestamptz, p_n integer, p_step_secs numeric) returns integer language plpgsql as $$
declare k integer; got integer := 0; r record;
begin
  for k in 0 .. p_n - 1 loop
    select * into r from public.share_view_claim_at(p_client, p_link, p_start + (k * p_step_secs) * interval '1 second');
    if r.allowed then got := got + 1; end if;
  end loop;
  return got;
end $$;

select pg_temp._ck('B02 of 40 requests inside one minute from one client EXACTLY 30 are allowed',
  pg_temp._burst(pg_temp._h('c1'), null, pg_temp._t('2031-03-01 10:00:00'), 40, 1) = 30);
select pg_temp._ck('B03 a refusal consumes nothing: ten more refusals leave the minute at 30',
  pg_temp._burst(pg_temp._h('c1'), null, pg_temp._t('2031-03-01 10:00:41'), 10, 1) = 0
  and (select used from public.share_view_window where bucket = 'client' and subject = pg_temp._h('c1') and window_secs = 60) = 30);
select pg_temp._ck('B04 the refusal names who and which window, and how long to wait (10 s into the minute: 50)',
  (select retry_after_seconds || '/' || limited_by || '/' || limited_window_secs from public.share_view_claim_at(pg_temp._h('c1'), null, pg_temp._t('2031-03-01 10:00:10')) limit 1) = '50/client/60');
select pg_temp._ck('B04b a claim always answers exactly ONE row, whether it is allowed or refused',
  (select count(*) from public.share_view_claim_at(pg_temp._h('c1'), null, pg_temp._t('2031-03-01 10:00:10'))) = 1
  and (select count(*) from public.share_view_claim_at(pg_temp._h('c1b'), null, pg_temp._t('2031-03-01 10:00:10'))) = 1);
select pg_temp._ck('B05 the next minute opens again', (select allowed from public.share_view_claim_at(pg_temp._h('c1'), null, pg_temp._t('2031-03-01 10:01:00')) limit 1));
select pg_temp._ck('B06 a different client is not affected', (select allowed from public.share_view_claim_at(pg_temp._h('c2'), null, pg_temp._t('2031-03-01 10:00:20')) limit 1));
select pg_temp._ck('B07 a request with no link takes the client windows only (no link row is written for it)',
  not exists (select 1 from public.share_view_window where bucket = 'link' and subject = pg_temp._h('c2')) and (select count(*) from public.share_view_window where bucket = 'link') = 0);

-- one link, many clients: the link ceiling (120 a minute) binds even when no client is anywhere near its own
select pg_temp._ck('B08 one link asked about by 20 different clients, 8 each in a minute (160 requests): EXACTLY 120 are allowed',
  (select sum(pg_temp._burst(pg_temp._h('wide' || g), pg_temp._h('linkA'), pg_temp._t('2031-03-02 10:00:00'), 8, 0.1)) from generate_series(1, 20) g) = 120);
select pg_temp._ck('B09 the refusal of a full link names the link (limited_by = link, window 60)',
  (select limited_by || '/' || limited_window_secs from public.share_view_claim_at(pg_temp._h('wide99'), pg_temp._h('linkA'), pg_temp._t('2031-03-02 10:00:30')) limit 1) = 'link/60');
select pg_temp._ck('B10 and that refusal took nothing from the client who was refused',
  not exists (select 1 from public.share_view_window where bucket = 'client' and subject = pg_temp._h('wide99')));

-- the hour: 10 a minute for 31 minutes = 310 attempts, 300 allowed
select pg_temp._ck('B11 the hour window: 310 attempts spread at 10 a minute, EXACTLY 300 allowed',
  (select sum(pg_temp._burst(pg_temp._h('hr'), null, pg_temp._t('2031-03-03 10:00:00') + (m * interval '1 minute'), 10, 1)) from generate_series(0, 30) m) = 300);
select pg_temp._ck('B12 and the one refused in the hour names the hour (3600)',
  (select limited_window_secs from public.share_view_claim_at(pg_temp._h('hr'), null, pg_temp._t('2031-03-03 10:45:00')) limit 1) = 3600);
-- the minute AND the hour both full: the answer is the LONGER wait (the hour), not the first or the shortest
select pg_temp._ck('B12b nine minutes of 30 then a tenth: the hour is full at 300 and the minute is full at 30',
  (select sum(pg_temp._burst(pg_temp._h('both'), null, pg_temp._t('2031-03-06 10:00:00') + (m * interval '1 minute'), 30, 0.1)) from generate_series(0, 9) m) = 300);
select pg_temp._ck('B12c with both full, the wait is the LONGER one: 3020 s to the end of the hour, named as the hour (not the 20 s to the end of the minute)',
  (select retry_after_seconds || '/' || limited_by || '/' || limited_window_secs from public.share_view_claim_at(pg_temp._h('both'), null, pg_temp._t('2031-03-06 10:09:40')) limit 1) = '3020/client/3600');

-- input and isolation
select pg_temp._ck('B13 a malformed client is refused (22023)', pg_temp._why('select * from public.share_view_claim_at(''ABC'', null, now())') like '22023%');
select pg_temp._ck('B14 an upper-case client is refused (22023): subjects are lower-case hex only', pg_temp._why('select * from public.share_view_claim_at(upper(''' || pg_temp._h('c3') || '''), null, now())') like '22023%');
select pg_temp._ck('B15 a malformed link is refused (22023)', pg_temp._why('select * from public.share_view_claim_at(''' || pg_temp._h('c3') || ''', ''not-hex'', now())') like '22023%');
select pg_temp._ck('B16 a null client and a null time are refused (22023)', pg_temp._why('select * from public.share_view_claim_at(null, null, now())') like '22023%'
  and pg_temp._why('select * from public.share_view_claim_at(''' || pg_temp._h('c3') || ''', null, null)') like '22023%');
select pg_temp._ck('B18 the wrapper allows a fresh client', (select allowed from public.share_view_claim(pg_temp._h('c10'), null)));
select pg_temp._ck('B18b and uses the database clock: the minute window began within the last 61 seconds',
  (select window_start <= now() and window_start > now() - interval '61 seconds' from public.share_view_window where subject = pg_temp._h('c10') and window_secs = 60));

-- housekeeping and what is stored
insert into public.share_view_window (bucket, subject, window_secs, window_start, used) values
  ('client', pg_temp._h('old1'), 60, pg_temp._t('2031-02-20 10:00:00'), 3), ('client', pg_temp._h('old2'), 86400, pg_temp._t('2031-02-25 00:00:00'), 3),
  ('client', pg_temp._h('young'), 86400, pg_temp._t('2031-03-04 00:00:00'), 3);
select * from public.share_view_claim_at(pg_temp._h('hk'), null, pg_temp._t('2031-03-05 12:00:00'));
select pg_temp._ck('B19 a claim sweeps rows whose window ended more than two days ago, and keeps a younger one',
  not exists (select 1 from public.share_view_window where subject in (pg_temp._h('old1'), pg_temp._h('old2')))
  and exists (select 1 from public.share_view_window where subject = pg_temp._h('young')));
select pg_temp._ck('B20 the counter table has exactly five columns and none can hold an address, an email or a token',
  (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'share_view_window')
    = 'bucket,subject,used,window_secs,window_start');
select pg_temp._ck('B21 a subject that is not a lower-case hex hash cannot be stored even directly',
  pg_temp._why('insert into public.share_view_window values (''client'', ''203.0.113.7'', 60, now(), 1)') like '23514%');

-- =====================================================================================
-- C. ONE OPEN CHECKOUT AT A TIME
-- =====================================================================================
create temp table _bx as select brokerage_id b from _ev where name = 'X';
create temp table _by as select brokerage_id b from _ev where name = 'Y';
create function pg_temp._co(p_b uuid, p_at text) returns text language sql as
$$ select outcome from public.billing_checkout_claim_at(p_b, pg_temp._t(p_at)) $$;

select pg_temp._ck('C01 the first request for a brokerage is told to make the checkout (CLAIMED)', pg_temp._co((select b from _bx), '2031-04-01 10:00:00') = 'CLAIMED');
select pg_temp._ck('C02 a second request a few seconds later is told BUSY, and makes none', pg_temp._co((select b from _bx), '2031-04-01 10:00:10') = 'BUSY');
select pg_temp._ck('C03 every request in the next ten minutes is told BUSY too (nothing hands out a checkout)',
  pg_temp._co((select b from _bx), '2031-04-01 10:05:00') = 'BUSY' and pg_temp._co((select b from _bx), '2031-04-01 10:09:59') = 'BUSY');
select pg_temp._ck('C04 after ten minutes the slot is free again (CLAIMED)', pg_temp._co((select b from _bx), '2031-04-01 10:10:01') = 'CLAIMED');
select pg_temp._ck('C05 and the hold restarts from that claim: BUSY just after, CLAIMED ten minutes later',
  pg_temp._co((select b from _bx), '2031-04-01 10:15:00') = 'BUSY' and pg_temp._co((select b from _bx), '2031-04-01 10:20:02') = 'CLAIMED');
select pg_temp._ck('C05b the slot holds a brokerage and a time and nothing else (two columns, none of them an address)',
  (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'billing_checkout_claim') = 'brokerage_id,claimed_at');
select pg_temp._ck('C06 releasing the slot (the processor could not make a checkout) frees it at once (true)',
  public.billing_checkout_release((select b from _bx)) = true and pg_temp._co((select b from _bx), '2031-04-01 10:20:10') = 'CLAIMED');
create temp table _rel as select public.billing_checkout_release((select b from _bx)) first_try;
create temp table _rel2 as select public.billing_checkout_release((select b from _bx)) second_try;
select pg_temp._ck('C08 releasing a slot that is not held is false, not an error', (select first_try from _rel) and not (select second_try from _rel2));
select pg_temp._ck('C08b and the brokerage can claim again straight after', pg_temp._co((select b from _bx), '2031-04-01 10:21:00') = 'CLAIMED');
select pg_temp._ck('C09 another brokerage is independent', pg_temp._co((select b from _by), '2031-04-01 10:20:10') = 'CLAIMED');
select pg_temp._ck('C10 an unknown brokerage is refused in the account''s words (EV003)', pg_temp._why('select * from public.billing_checkout_claim_at(''' || pg_temp._u(98) || ''', now())') like 'EV003: NOT_ENTITLED%');
update public.brokerage_account set status = 'suspended' where id = (select b from _by);
select pg_temp._ck('C11 a suspended brokerage is refused too', pg_temp._why('select * from public.billing_checkout_claim_at(''' || (select b from _by) || ''', now())') like 'EV003%');
update public.brokerage_account set status = 'active' where id = (select b from _by);
select pg_temp._ck('C12 null arguments are refused (22023)', pg_temp._why('select * from public.billing_checkout_claim_at(null, now())') like '22023%'
  and pg_temp._why('select * from public.billing_checkout_claim_at(''' || (select b from _bx) || ''', null)') like '22023%');
create temp table _bz as select e.brokerage_id b from public.evaluation_create('Team Z', null, null) e;
select pg_temp._ck('C17 the wrapper makes a first claim for a fresh brokerage: CLAIMED', (select outcome from public.billing_checkout_claim((select b from _bz))) = 'CLAIMED');
select pg_temp._ck('C17b and it uses the database clock: the slot began within the last five minutes, and a second wrapper claim now is BUSY',
  (select claimed_at > now() - interval '5 minutes' and claimed_at <= now() from public.billing_checkout_claim where brokerage_id = (select b from _bz))
  and (select outcome from public.billing_checkout_claim((select b from _bz))) = 'BUSY');

-- =====================================================================================
-- D. ACCESS, THE AUDIT, THE FOUNDER'S NUMBERS
-- =====================================================================================
create function pg_temp._mine() returns setof pg_proc language sql as
$$ select p.* from pg_proc p where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'share\_view\_%' or p.proname like 'billing\_checkout\_%' or p.proname in ('brokerage_team_of', 'brokerage_member_remove', 'da_owner_safeguards_check')) $$;
select pg_temp._ck('D01 the file owns exactly nine functions', (select count(*) from pg_temp._mine()) = 9, (select count(*) from pg_temp._mine())::text);
select pg_temp._ck('D02 none is executable by anyone but the owner and service_role',
  not exists (select 1 from pg_temp._mine() p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where a.grantee <> p.proowner and (a.grantee <> (select oid from pg_roles where rolname = 'service_role') or a.privilege_type <> 'EXECUTE')));
select pg_temp._ck('D03 and service_role CAN execute every one', (select count(*) from pg_temp._mine() p where has_function_privilege('service_role', p.oid, 'execute')) = 9);
select pg_temp._ck('D04 every function except the limits is SECURITY DEFINER with a fixed search_path',
  (select count(*) from pg_temp._mine() p where p.proname <> 'share_view_limits' and p.prosecdef and p.proconfig::text like '%search_path%') = 8);
select pg_temp._ck('D05 both tables have row level security on and no grant to any role but the owner',
  (select count(*) from pg_class c where c.relname in ('share_view_window', 'billing_checkout_claim') and c.relrowsecurity) = 2
  and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                   where c.relname in ('share_view_window', 'billing_checkout_claim') and a.grantee <> c.relowner));
select pg_temp._ck('D06 the founder''s numbers are untouched: 10 free, 100 paid', public.evaluation_report_limit() = 10 and public.billing_report_limit() = 100);
select pg_temp._ck('D07 the report rate limit''s numbers are untouched',
  (select string_agg(bucket || ':' || window_secs || ':' || max_requests, ',' order by bucket collate "C", window_secs) from public.report_rate_limits())
    = 'brokerage:60:30,brokerage:3600:200,brokerage:86400:1000,user:60:10,user:3600:60,user:86400:200');
select pg_temp._ck('D08 the audit reads zero on every invariant',
  (select count(*) from public.da_owner_safeguards_check() where kind = 'invariant' and n <> 0) = 0
  and (select count(*) from public.da_owner_safeguards_check() where kind = 'invariant') = 4,
  (select string_agg(check_name || '=' || n, ';') from public.da_owner_safeguards_check()));
select pg_temp._ck('D09 and its controls are not zero (it looked at real rows)',
  (select n from public.da_owner_safeguards_check() where check_name = 'share_limits_defined') = 5
  and (select n from public.da_owner_safeguards_check() where check_name = 'share_counter_rows') > 3
  and (select n from public.da_owner_safeguards_check() where check_name = 'checkout_claim_rows') = 3,
  (select string_agg(check_name || '=' || n, ';') from public.da_owner_safeguards_check() where kind = 'control'));
insert into public.share_view_window (bucket, subject, window_secs, window_start, used) values ('link', pg_temp._h('breach'), 60, pg_temp._t('2031-05-01 00:00:00'), 121);
select pg_temp._ck('D10 the audit CAN see a breach: a counter planted above its limit reads 1',
  (select n from public.da_owner_safeguards_check() where check_name = 'share_window_above_its_limit') = 1);
delete from public.share_view_window where subject = pg_temp._h('breach');
select pg_temp._ck('D11 and reads zero again once it is removed', (select n from public.da_owner_safeguards_check() where check_name = 'share_window_above_its_limit') = 0);

select pg_temp._ck('S99 every population step ran: nine people, two brokerages, eight memberships in total',
  (select count(*) from auth.users where email like '%example.test') = 8 and (select count(*) from _ev) = 2
  and (select count(*) from public.brokerage_member) = 7, (select count(*) from public.brokerage_member)::text);

\o
select check_name, pass, detail from _r order by n;

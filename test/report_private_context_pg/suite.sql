-- =====================================================================================
-- REPORT PRIVATE CONTEXT — EXECUTABLE ADVERSARIAL SUITE  (docs/report-private-context.sql)
--
-- Order F2 of the Development Activity plan: the deletable half of a stored report. It holds the
-- customer-entered street address and what derives from it, keeps it only while a report, a
-- property follow or an account relationship needs it, starts a 90-day clock when the last need
-- closes, and purges it in place — immediately on a verified privacy request. Every expected
-- answer below is a HARD-CODED constant, never computed by the code under test. The retention clock
-- is exercised by moving a row's two timestamps back (as the table owner, the way a test travels in
-- time); production code never does that.
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);

create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;

-- run a statement; 'ok', or the SQLSTATE and (for a constraint) its name
create function pg_temp._try(p_sql text) returns text language plpgsql as $$
declare _c text; _s text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics _c = constraint_name;
  _s := sqlstate;
  return _s || case when coalesce(_c, '') <> '' then ':' || _c else '' end;
end $$;

-- Setup steps go through these wrappers so that a REGRESSION in the code under test becomes a FAILED CHECK,
-- not a crash that ends the suite before the checks that would have named it. Every wrapper logs to _setup,
-- and S01 (last) fails if any step raised.
create temp table _setup (n serial, step text, result text);
create function pg_temp._open(p_ctx uuid, p_kind text, p_ref text) returns void language plpgsql as $$
begin
  perform public.report_private_context_need_open(p_ctx, p_kind, p_ref);
  insert into _setup (step, result) values ('need_open ' || p_kind || ' ' || p_ref, 'ok');
exception when others then
  insert into _setup (step, result) values ('need_open ' || p_kind || ' ' || p_ref, sqlstate);
end $$;
create function pg_temp._close(p_ctx uuid, p_kind text, p_ref text) returns void language plpgsql as $$
begin
  perform public.report_private_context_need_close(p_ctx, p_kind, p_ref);
  insert into _setup (step, result) values ('need_close ' || p_kind || ' ' || p_ref, 'ok');
exception when others then
  insert into _setup (step, result) values ('need_close ' || p_kind || ' ' || p_ref, sqlstate);
end $$;
-- the purge outcome as a boolean, or NULL when it raised
create function pg_temp._purge(p_ctx uuid, p_reason text) returns boolean language plpgsql as $$
begin
  return public.report_private_context_purge(p_ctx, p_reason);
exception when others then
  insert into _setup (step, result) values ('purge ' || p_reason, sqlstate);
  return null;
end $$;
-- how many the batch purged, or -1 when it raised
create function pg_temp._purge_due() returns integer language plpgsql as $$
begin
  return public.report_private_context_purge_due();
exception when others then
  insert into _setup (step, result) values ('purge_due', sqlstate);
  return -1;
end $$;

-- run a statement AS a role (invoker rights); 'ok' or the SQLSTATE
create function pg_temp._as(p_role text, p_sql text) returns text language plpgsql as $$
begin
  execute format('set role %I', p_role);
  begin
    execute p_sql;
    execute 'reset role';
    return 'ok';
  exception when others then
    execute 'reset role';
    return sqlstate;
  end;
end $$;

-- Supabase's service_role has BYPASSRLS and all three API roles hold USAGE on schema public. A freshly
-- created schema here has neither, and without them every refusal below could come from the SCHEMA or
-- from RLS rather than from the object's own privileges. Set here, undone at the end.
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create function pg_temp._mk(p_addr text, p_kind text default 'report', p_ref text default 'r1', p_extra jsonb default '{}'::jsonb)
returns uuid language plpgsql as $$
begin
  return public.report_private_context_create(jsonb_build_object('address', p_addr) || p_extra, p_kind, p_ref);
exception when others then
  insert into _setup (step, result) values ('create ' || p_addr, sqlstate);
  return null;
end $$;

-- travel in time: move a context's two timestamps back together (so the 90-day ceiling still holds)
create function pg_temp._age(p_ctx uuid, p_secs bigint) returns void language plpgsql as $$
begin
  update public.report_private_context
     set last_needed_at = last_needed_at - make_interval(secs => p_secs),
         purge_due_at   = purge_due_at   - make_interval(secs => p_secs)
   where context_id = p_ctx;
exception when others then
  insert into _setup (step, result) values ('age', sqlstate);
end $$;

create function pg_temp._ev(p_ctx uuid) returns text language sql as
$$ select string_agg(kind || coalesce(':' || coalesce(need_kind, reason), ''), ',' order by event_id)
     from public.report_private_context_event where context_id = p_ctx $$;

create function pg_temp._open_needs(p_ctx uuid) returns bigint language sql as
$$ select count(*) from public.report_private_context_need where context_id = p_ctx and closed_at is null $$;

-- ---- E01  the constants the retention rule hangs on -----------------------------------------------
select pg_temp._ck('E01 the grace period is exactly 90 days (7,776,000 seconds), defined once, and the table CHECK uses that one definition',
  extract(epoch from public.report_private_context_grace()) = 7776000
  and (select pg_get_constraintdef(oid) like '%report_private_context_grace()%' from pg_constraint
        where conrelid = 'public.report_private_context'::regclass and conname = 'report_private_context_grace_ceiling'),
  extract(epoch from public.report_private_context_grace())::text);

-- ---- C01..C04  creating a context ----------------------------------------------------------------------
create temp table _c1 as select pg_temp._mk('1 Centre Street, New York, NY 10007', 'report', 'rep-1',
  '{"normalized_address":"1 CENTRE ST","latitude":40.712980288068,"longitude":-74.003758107366,"property_keys":["nyc:1001387","1001387"],"label":"Acme Realty Smith listing"}'::jsonb) as id;
select pg_temp._ck('C01 a context is stored exactly as given, active, with no clock, and with one open "report" need',
  (select c.state = 'active' and c.address = '1 Centre Street, New York, NY 10007' and c.normalized_address = '1 CENTRE ST'
          and c.latitude = 40.712980288068 and c.longitude = -74.003758107366
          and c.property_keys = array['nyc:1001387', '1001387'] and c.label = 'Acme Realty Smith listing'
          and c.purge_due_at is null and c.purged_at is null and c.purge_reason is null
          and abs(extract(epoch from now() - c.created_at)) < 60 and c.last_needed_at = c.created_at
     from _c1, lateral (select * from public.report_private_context where context_id = _c1.id) c)
  and (select count(*) = 1 and bool_and(kind = 'report' and ref = 'rep-1' and closed_at is null)
         from public.report_private_context_need where context_id = (select id from _c1)),
  (select pg_temp._ev(id) from _c1));
select pg_temp._ck('C01b the audit log records the creation and the first need, in that order',
  (select pg_temp._ev(id) from _c1) = 'created,need_opened:report', (select pg_temp._ev(id) from _c1));
create temp table _c2 as select pg_temp._mk('9 Oak Avenue', 'follow', 'fol-9') as id;
select pg_temp._ck('C02 the minimum context is just an address: every other private field is null',
  (select c.address = '9 Oak Avenue' and c.normalized_address is null and c.latitude is null and c.longitude is null and c.property_keys is null and c.label is null
     from public.report_private_context c where c.context_id = (select id from _c2)),
  null);

create temp table _n0 as select
  (select count(*) from public.report_private_context) as c, (select count(*) from public.report_private_context_need) as n,
  (select count(*) from public.report_private_context_event) as e;
select pg_temp._ck('C03 a context that is not an object, has no usable address, or carries a field it may not hold is REFUSED — including a client name, email or phone, which are never stored',
  pg_temp._try($$select public.report_private_context_create('[]'::jsonb, 'report', 'x')$$) = '22023'
  and pg_temp._try($$select public.report_private_context_create(null, 'report', 'x')$$) = '22023'
  and pg_temp._try($$select public.report_private_context_create('{}'::jsonb, 'report', 'x')$$) = '23514'
  and pg_temp._try($$select public.report_private_context_create('{"address":"   "}'::jsonb, 'report', 'x')$$) = '23514'
  and pg_temp._try($$select public.report_private_context_create('{"address":"1 A St","client_name":"Jane Doe"}'::jsonb, 'report', 'x')$$) = '22023'
  and pg_temp._try($$select public.report_private_context_create('{"address":"1 A St","email":"jane@example.com"}'::jsonb, 'report', 'x')$$) = '22023'
  and pg_temp._try($$select public.report_private_context_create('{"address":"1 A St","phone":"212-555-0100"}'::jsonb, 'report', 'x')$$) = '22023',
  pg_temp._try($$select public.report_private_context_create('{"address":"1 A St","client_name":"Jane Doe"}'::jsonb, 'report', 'x')$$));
select pg_temp._ck('C03b coordinates must be a matched pair of numbers inside the valid range; property_keys must be an array of non-blank strings',
  pg_temp._try($$select public.report_private_context_create('{"address":"1 A St","latitude":40.7}'::jsonb, 'report', 'x')$$) = '22023'
  and pg_temp._try($$select public.report_private_context_create('{"address":"1 A St","latitude":"40.7","longitude":-74.0}'::jsonb, 'report', 'x')$$) = '22023'
  and pg_temp._try($$select public.report_private_context_create('{"address":"1 A St","latitude":91,"longitude":-74.0}'::jsonb, 'report', 'x')$$) = '23514:report_private_context_point'
  and pg_temp._try($$select public.report_private_context_create('{"address":"1 A St","latitude":40.7,"longitude":181}'::jsonb, 'report', 'x')$$) = '23514:report_private_context_point'
  and pg_temp._try($$select public.report_private_context_create('{"address":"1 A St","property_keys":"k"}'::jsonb, 'report', 'x')$$) = '22023'
  and pg_temp._try($$select public.report_private_context_create('{"address":"1 A St","property_keys":["k"," "]}'::jsonb, 'report', 'x')$$) = '22023'
  and pg_temp._try($$select public.report_private_context_create('{"address":"1 A St","property_keys":[1]}'::jsonb, 'report', 'x')$$) = '22023',
  null);
select pg_temp._ck('C03c the first need must be a real kind (report, follow, account) with a non-blank reference',
  pg_temp._try($$select public.report_private_context_create('{"address":"1 A St"}'::jsonb, 'friend', 'x')$$) = '23514:report_private_context_need_kind'
  and pg_temp._try($$select public.report_private_context_create('{"address":"1 A St"}'::jsonb, 'report', ' ')$$) = '23514:report_private_context_need_ref'
  and pg_temp._try($$select public.report_private_context_create('{"address":"1 A St"}'::jsonb, null, 'x')$$) = '23502',
  null);
select pg_temp._ck('C04 control: every refusal above left NOTHING behind — no context, no need and no event from a create that failed',
  (select count(*) from public.report_private_context) = (select c from _n0)
  and (select count(*) from public.report_private_context_need) = (select n from _n0)
  and (select count(*) from public.report_private_context_event) = (select e from _n0),
  null);

-- ---- N01..N04  needs, and the clock they start -----------------------------------------------------------
select pg_temp._open((select id from _c1), 'follow', 'fol-1');
select pg_temp._ck('N01a a second need opens (a property Follow on the same address); still no clock',
  pg_temp._open_needs((select id from _c1)) = 2 and (select purge_due_at is null from public.report_private_context where context_id = (select id from _c1)),
  pg_temp._ev((select id from _c1)));
select pg_temp._close((select id from _c1), 'report', 'rep-1');
select pg_temp._ck('N01b closing the report need while the Follow is still open starts NO clock: the address is kept while ANY need remains',
  pg_temp._open_needs((select id from _c1)) = 1 and (select purge_due_at is null from public.report_private_context where context_id = (select id from _c1))
  and (select state from public.report_private_context where context_id = (select id from _c1)) = 'active',
  null);
select pg_temp._close((select id from _c1), 'follow', 'fol-1');
select pg_temp._ck('N01c closing the LAST need starts the clock: purge_due_at is exactly last_needed_at + 90 days, and last_needed_at moved to the close',
  (select c.purge_due_at = c.last_needed_at + interval '90 days' and c.last_needed_at > c.created_at - interval '1 second'
          and abs(extract(epoch from now() - c.last_needed_at)) < 60 and c.state = 'active'
     from public.report_private_context c where c.context_id = (select id from _c1))
  and pg_temp._open_needs((select id from _c1)) = 0,
  pg_temp._ev((select id from _c1)));
select pg_temp._ck('N01d the audit log has the whole history: created, both needs opened, both closed, grace started',
  pg_temp._ev((select id from _c1)) = 'created,need_opened:report,need_opened:follow,need_closed:report,need_closed:follow,grace_started',
  pg_temp._ev((select id from _c1)));

-- reopen inside the window: the clock clears; closing again restarts it from the NEW close
select pg_temp._age((select id from _c1), 30 * 86400);
select pg_temp._open((select id from _c1), 'account', 'acct-1');
select pg_temp._ck('N02a a need opened inside the 90 days clears the clock (the recovery window worked) and is logged as grace_cleared',
  (select purge_due_at is null and last_needed_at > now() - interval '1 minute' from public.report_private_context where context_id = (select id from _c1))
  and pg_temp._ev((select id from _c1)) like '%grace_started,need_opened:account,grace_cleared',
  pg_temp._ev((select id from _c1)));
select pg_temp._close((select id from _c1), 'account', 'acct-1');
select pg_temp._ck('N02b closing it again starts a FRESH 90 days from now, not from the first close',
  (select c.purge_due_at = c.last_needed_at + interval '90 days' and abs(extract(epoch from now() - c.last_needed_at)) < 60
     from public.report_private_context c where c.context_id = (select id from _c1)),
  null);

-- idempotence
create temp table _c3 as select pg_temp._mk('3 Elm Road', 'report', 'rep-3') as id;
create temp table _n3a as select pg_temp._try(format($$select public.report_private_context_need_open(%L, 'report', 'rep-3')$$, (select id from _c3))) as r;
select pg_temp._ck('N03a opening a need that is already open is a no-op WITHOUT an error: still one open row, no extra event',
  (select r from _n3a) = 'ok' and pg_temp._open_needs((select id from _c3)) = 1 and pg_temp._ev((select id from _c3)) = 'created,need_opened:report',
  pg_temp._ev((select id from _c3)));
select pg_temp._close((select id from _c3), 'follow', 'never-opened');
select pg_temp._close((select id from _c3), 'report', 'wrong-ref');
select pg_temp._ck('N03b closing a need that is not open changes nothing and starts NO clock while the real need is still open',
  pg_temp._open_needs((select id from _c3)) = 1 and (select purge_due_at is null from public.report_private_context where context_id = (select id from _c3))
  and pg_temp._ev((select id from _c3)) = 'created,need_opened:report',
  pg_temp._ev((select id from _c3)));
-- a no-op close on a context that is ALREADY in its grace period must not move the clock (that would quietly extend retention)
create temp table _cl as select purge_due_at as due, last_needed_at as lna from public.report_private_context where context_id = (select id from _c1);
create temp table _ev_before as select pg_temp._ev((select id from _c1)) as ev;
select pg_temp._close((select id from _c1), 'account', 'acct-1');
select pg_temp._close((select id from _c1), 'report', 'never-existed');
select pg_temp._ck('N03d closing a need that is already closed, on a context already in its grace period, does NOT restart or extend the clock and writes no event',
  (select c.purge_due_at = _cl.due and c.last_needed_at = _cl.lna from public.report_private_context c, _cl where c.context_id = (select id from _c1))
  and pg_temp._ev((select id from _c1)) = (select ev from _ev_before),
  pg_temp._ev((select id from _c1)));
select pg_temp._ck('N03c a need on a context that does not exist is refused (23503), for open and close alike',
  pg_temp._try($$select public.report_private_context_need_open('00000000-0000-4000-8000-000000000000', 'report', 'x')$$) = '23503'
  and pg_temp._try($$select public.report_private_context_need_close('00000000-0000-4000-8000-000000000000', 'report', 'x')$$) = '23503',
  null);

-- need rows are close-only, and the log is append-only
select pg_temp._ck('N04 a need can only ever be CLOSED: it cannot be deleted, re-pointed, re-opened or truncated (all P0001)',
  pg_temp._try($$delete from public.report_private_context_need$$) = 'P0001'
  and pg_temp._try($$update public.report_private_context_need set ref = 'other'$$) = 'P0001'
  and pg_temp._try($$update public.report_private_context_need set closed_at = null where closed_at is not null$$) = 'P0001'
  and pg_temp._try($$truncate public.report_private_context_need$$) = 'P0001',
  pg_temp._try($$update public.report_private_context_need set closed_at = null where closed_at is not null$$));

-- ---- R01..R05  the retention clock and the purge it triggers -----------------------------------------------
select pg_temp._ck('R01 "retention_expired" is REFUSED (55000) while a need is open, and refused during the grace period before the clock runs out',
  pg_temp._try(format($$select public.report_private_context_purge(%L, 'retention_expired')$$, (select id from _c3))) = '55000'
  and pg_temp._try(format($$select public.report_private_context_purge(%L, 'retention_expired')$$, (select id from _c1))) = '55000'
  and (select state from public.report_private_context where context_id = (select id from _c1)) = 'active',
  pg_temp._try(format($$select public.report_private_context_purge(%L, 'retention_expired')$$, (select id from _c1))));

-- the boundary: 90 days minus one minute is not due; 90 days plus one second is
create temp table _c4 as select pg_temp._mk('4 Pine Court', 'report', 'rep-4', '{"label":"Pine client label"}'::jsonb) as id;
select pg_temp._close((select id from _c4), 'report', 'rep-4');
select pg_temp._age((select id from _c4), 90 * 86400 - 60);
select pg_temp._ck('R02a 89 days 23 hours 59 minutes after the last need closed: purge_due() purges nothing and the address is still there',
  pg_temp._purge_due() = 0 and (select address = '4 Pine Court' and state = 'active' from public.report_private_context where context_id = (select id from _c4)),
  null);
select pg_temp._age((select id from _c4), 61);
-- (each volatile call runs in its OWN statement: sub-selects of the same statement read the statement's snapshot)
create temp table _pd1 as select pg_temp._purge_due() as n;
select pg_temp._ck('R02b 90 days and one second after: it is due, and purge_due() purges exactly that one',
  (select n from _pd1) = 1 and (select state = 'purged' from public.report_private_context where context_id = (select id from _c4)),
  (select n::text from _pd1));
select pg_temp._ck('R02c the purge blanked EVERY private value in place — address, normalized address, coordinates, property keys and label — and recorded when and why',
  (select c.state = 'purged' and c.address is null and c.normalized_address is null and c.latitude is null and c.longitude is null
          and c.property_keys is null and c.label is null and c.purge_due_at is null
          and c.purged_at is not null and c.purge_reason = 'retention_expired'
     from public.report_private_context c where c.context_id = (select id from _c4)),
  null);
select pg_temp._ck('R02d the audit log ends with the purge and its reason, and no need is left open',
  pg_temp._ev((select id from _c4)) = 'created,need_opened:report,need_closed:report,grace_started,purged:retention_expired'
  and pg_temp._open_needs((select id from _c4)) = 0,
  pg_temp._ev((select id from _c4)));
select pg_temp._ck('R02e purge_due() again does nothing and writes no further event',
  pg_temp._purge_due() = 0 and pg_temp._ev((select id from _c4)) = 'created,need_opened:report,need_closed:report,grace_started,purged:retention_expired',
  null);

-- a mixed population: one due, one not due, one still needed
create temp table _m as select pg_temp._mk('M1 due', 'report', 'm1') as due, pg_temp._mk('M2 not due', 'report', 'm2') as notdue, pg_temp._mk('M3 needed', 'follow', 'm3') as needed;
select pg_temp._close((select due from _m), 'report', 'm1');
select pg_temp._close((select notdue from _m), 'report', 'm2');
select pg_temp._age((select due from _m), 91 * 86400);
select pg_temp._age((select notdue from _m), 10 * 86400);
create temp table _pd2 as select pg_temp._purge_due() as n;
select pg_temp._ck('R03 in a mixed population purge_due() purges ONLY the context whose clock has run out: the one not yet due and the one still needed are untouched',
  (select n from _pd2) = 1
  and (select state from public.report_private_context where context_id = (select due from _m)) = 'purged'
  and (select state = 'active' and address = 'M2 not due' from public.report_private_context where context_id = (select notdue from _m))
  and (select state = 'active' and address = 'M3 needed' and purge_due_at is null from public.report_private_context where context_id = (select needed from _m)),
  null);
select pg_temp._ck('R04 the 90 days is a CEILING enforced by the table: a purge date later than last_needed_at + 90 days is refused (23514), and one exactly at 90 days is accepted',
  pg_temp._try(format($$update public.report_private_context set purge_due_at = last_needed_at + interval '90 days 1 second' where context_id = %L$$, (select notdue from _m)))
     = '23514:report_private_context_grace_ceiling'
  and pg_temp._try(format($$update public.report_private_context set purge_due_at = last_needed_at + interval '90 days' where context_id = %L$$, (select notdue from _m))) = 'ok',
  pg_temp._try(format($$update public.report_private_context set purge_due_at = last_needed_at + interval '90 days 1 second' where context_id = %L$$, (select notdue from _m))));

-- ---- P01..P07  a verified privacy request or a legal requirement purges NOW -------------------------------------
create temp table _p as select pg_temp._mk('P1 open needs', 'report', 'p1', '{"latitude":40.71298,"longitude":-74.00375,"property_keys":["k-p1"],"label":"P1 label"}'::jsonb) as a,
  pg_temp._mk('P2 legal', 'follow', 'p2') as b, pg_temp._mk('P3 in grace', 'report', 'p3') as c;
select pg_temp._open((select a from _p), 'follow', 'p1-follow');
select pg_temp._close((select c from _p), 'report', 'p3');
select pg_temp._ck('P01a control: before the request the context holds real private values (so the purge below blanks something)',
  (select address = 'P1 open needs' and label = 'P1 label' and property_keys = array['k-p1'] and latitude = 40.71298 from public.report_private_context where context_id = (select a from _p))
  and pg_temp._open_needs((select a from _p)) = 2,
  null);
create temp table _pp1 as select pg_temp._purge((select a from _p), 'verified_privacy_request') as r;
select pg_temp._ck('P01 a verified privacy request purges IMMEDIATELY although two needs are still open and no clock is running: it overrides the grace period',
  (select r from _pp1) is true
  and (select c.state = 'purged' and c.address is null and c.label is null and c.property_keys is null and c.latitude is null
          and c.purge_reason = 'verified_privacy_request' and c.purged_at is not null
     from public.report_private_context c where c.context_id = (select a from _p)),
  pg_temp._ev((select a from _p)));
select pg_temp._ck('P01b its open needs were closed and logged, then the purge, with the reason',
  pg_temp._open_needs((select a from _p)) = 0
  and pg_temp._ev((select a from _p)) = 'created,need_opened:report,need_opened:follow,need_closed:report,need_closed:follow,purged:verified_privacy_request',
  pg_temp._ev((select a from _p)));
create temp table _pp2 as select pg_temp._purge((select b from _p), 'legal_requirement') as r;
select pg_temp._ck('P02 a legal requirement purges immediately too',
  (select r from _pp2) is true
  and (select state = 'purged' and purge_reason = 'legal_requirement' and address is null from public.report_private_context where context_id = (select b from _p)),
  null);
create temp table _pp3 as select (select purge_due_at > now() + interval '89 days' from public.report_private_context where context_id = (select c from _p)) as had_clock,
  pg_temp._purge((select c from _p), 'verified_privacy_request') as r;
select pg_temp._ck('P03 a privacy request overrides a clock that is still running (a context already in its 90 days is purged now, not at day 90)',
  (select had_clock and r is true from _pp3)
  and (select state = 'purged' and purge_due_at is null from public.report_private_context where context_id = (select c from _p)),
  null);
select pg_temp._ck('P04 the reason must be one of the three: an unknown or null reason is refused (22023) and purges nothing',
  pg_temp._try(format($$select public.report_private_context_purge(%L, 'because')$$, (select needed from _m))) = '22023'
  and pg_temp._try(format($$select public.report_private_context_purge(%L, null)$$, (select needed from _m))) = '22023'
  and (select state from public.report_private_context where context_id = (select needed from _m)) = 'active',
  null);
select pg_temp._ck('P05 purging is idempotent: a second purge returns false, writes no event, and keeps the FIRST reason',
  pg_temp._purge((select a from _p), 'legal_requirement') is false
  and pg_temp._ev((select a from _p)) = 'created,need_opened:report,need_opened:follow,need_closed:report,need_closed:follow,purged:verified_privacy_request'
  and (select purge_reason from public.report_private_context where context_id = (select a from _p)) = 'verified_privacy_request',
  null);
select pg_temp._ck('P06 a purged context is TERMINAL: a need cannot be opened (55000), it cannot be set active again, and a private value cannot be written back (all refused)',
  pg_temp._try(format($$select public.report_private_context_need_open(%L, 'report', 'again')$$, (select a from _p))) = '55000'
  and pg_temp._try(format($$update public.report_private_context set state = 'active' where context_id = %L$$, (select a from _p))) = 'P0001'
  and pg_temp._try(format($$update public.report_private_context set address = 'back again' where context_id = %L$$, (select a from _p))) = 'P0001',
  pg_temp._try(format($$update public.report_private_context set state = 'active' where context_id = %L$$, (select a from _p))));
select pg_temp._ck('P06b reading a purged context returns its state and reason and NO private value',
  (select r.state = 'purged' and r.purge_reason = 'verified_privacy_request' and r.address is null and r.normalized_address is null
          and r.latitude is null and r.property_keys is null and r.label is null
     from public.report_private_context_read((select a from _p)) r),
  null);
select pg_temp._ck('P06c closing a need on a purged context is a harmless no-op',
  pg_temp._try(format($$select public.report_private_context_need_close(%L, 'report', 'p1')$$, (select a from _p))) = 'ok',
  null);
select pg_temp._ck('P07 the tombstone left behind contains none of the private values (the whole row, as text) — and the same scan DOES find them on a live row, so the scan can fail',
  (select position('P1 open needs' in row_to_json(c)::text) = 0 and position('P1 label' in row_to_json(c)::text) = 0
          and position('k-p1' in row_to_json(c)::text) = 0 and position('40.71298' in row_to_json(c)::text) = 0
     from public.report_private_context c where c.context_id = (select a from _p))
  and (select position('M3 needed' in row_to_json(c)::text) > 0 from public.report_private_context c where c.context_id = (select needed from _m)),
  null);

-- ---- D01..D02  history is never deleted --------------------------------------------------------------------------
select pg_temp._ck('D01 a context row is never deleted (P0001), and never truncated: PostgreSQL refuses a plain TRUNCATE of a referenced table (0A000) and TRUNCATE ... CASCADE is stopped by the append-only need and event tables (P0001) — so a purged tombstone, and the foreign key of any snapshot that points at it, always survives',
  pg_temp._try($$delete from public.report_private_context$$) = 'P0001'
  and pg_temp._try($$truncate public.report_private_context$$) = '0A000'
  and pg_temp._try($$truncate public.report_private_context cascade$$) = 'P0001'
  and pg_temp._try(format($$update public.report_private_context set context_id = gen_random_uuid() where context_id = %L$$, (select needed from _m))) = 'P0001',
  pg_temp._try($$delete from public.report_private_context$$));
select pg_temp._ck('D02 the audit log is append-only: no update, delete or truncate, even for the owner (all P0001)',
  pg_temp._try($$update public.report_private_context_event set reason = null$$) = 'P0001'
  and pg_temp._try($$delete from public.report_private_context_event$$) = 'P0001'
  and pg_temp._try($$truncate public.report_private_context_event$$) = 'P0001',
  null);

-- ---- A01..A02  the audit trail --------------------------------------------------------------------------------------
select pg_temp._ck('A01 a scripted lifecycle reads back as exactly the hard-coded event sequence (create, follow, close, close, clock, purge)',
  pg_temp._ev((select id from _c4)) = 'created,need_opened:report,need_closed:report,grace_started,purged:retention_expired'
  and pg_temp._ev((select due from _m)) = 'created,need_opened:report,need_closed:report,grace_started,purged:retention_expired',
  pg_temp._ev((select due from _m)));
select pg_temp._ck('A02 no private value appears anywhere in the audit log or the need table — and the same scan finds them in the context table, so a leak into the log would show',
  (select count(*) > 20 from public.report_private_context_event)
  and not exists (select 1 from public.report_private_context_event e where e::text ~* '(centre|oak avenue|elm road|pine|acme|smith|1001387|k-p1|40\.7129|jane|example\.com|212-555)')
  and not exists (select 1 from public.report_private_context_need n where n::text ~* '(centre|oak avenue|elm road|pine|acme|smith|1001387|k-p1|40\.7129|jane|example\.com|212-555)')
  and exists (select 1 from public.report_private_context c where c::text ~* '(centre|oak avenue|elm road)'),
  null);

-- ---- V01..V02  the retention check that makes the rule auditable --------------------------------------------------------
create temp table _v0 as select check_name, kind, violations from public.report_private_context_retention_check();
select pg_temp._ck('V01 on the healthy population above every invariant reads 0, beside a control that is not: the check ran over real contexts',
  (select violations > 8 from _v0 where check_name = 'contexts_total' and kind = 'control')
  and (select count(*) = 6 and bool_and(violations = 0) from _v0 where kind = 'invariant')
  and (select violations = 0 from _v0 where check_name = 'clock_expired_but_not_yet_purged'),
  (select string_agg(check_name || '=' || violations, ',') from _v0));

-- deliberately corrupt the population, as the table owner, four ways; the check must see each
insert into public.report_private_context (address) values ('V no need no clock');                                 -- active, unneeded, unclocked
create temp table _vc as select pg_temp._mk('V need and clock', 'report', 'v2') as id;
update public.report_private_context set purge_due_at = now() + interval '5 days' where context_id = (select id from _vc);   -- clock while needed
create temp table _vo as select pg_temp._mk('V overdue', 'report', 'v3') as id;
select pg_temp._close((select id from _vo), 'report', 'v3');
select pg_temp._age((select id from _vo), 95 * 86400);                                                              -- overdue, unpurged
insert into public.report_private_context (state, purged_at, purge_reason) values ('purged', now(), 'legal_requirement'); -- purged with no purge event
select pg_temp._ck('V02 each deliberate corruption is REPORTED by exactly the invariant that names it (no need+no clock, clock+need, purged without an event) and the overdue clock shows as lag — the check can fail',
  (select violations = 1 from public.report_private_context_retention_check() where check_name = 'active_without_a_need_or_a_clock')
  and (select violations = 1 from public.report_private_context_retention_check() where check_name = 'a_clock_running_while_a_need_is_open')
  and (select violations = 1 from public.report_private_context_retention_check() where check_name = 'purged_without_a_purge_event')
  and (select violations = 1 from public.report_private_context_retention_check() where check_name = 'clock_expired_but_not_yet_purged' and kind = 'lag'),
  (select string_agg(check_name || '=' || violations, ',') from public.report_private_context_retention_check()));

-- ---- L01..L06  lock-down: system-only ---------------------------------------------------------------------------------------
select pg_temp._ck('L01 row-level security is on for all three tables',
  (select count(*) = 3 and bool_and(relrowsecurity) from pg_class
    where oid in ('public.report_private_context'::regclass, 'public.report_private_context_need'::regclass, 'public.report_private_context_event'::regclass)),
  null);
select pg_temp._ck('L02 anon and authenticated hold NO privilege on any of the three tables (select, insert, update, delete, truncate, references, trigger), and PUBLIC holds none',
  not exists (select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p,
                     unnest(array['public.report_private_context', 'public.report_private_context_need', 'public.report_private_context_event']) t
               where has_table_privilege(r, t, p))
  and not exists (select 1 from pg_class c, aclexplode(c.relacl) a
                   where c.oid in ('public.report_private_context'::regclass, 'public.report_private_context_need'::regclass, 'public.report_private_context_event'::regclass) and a.grantee = 0),
  null);
select pg_temp._ck('L03 service_role holds NO privilege at all on the private table (it reaches values only through the functions), and only SELECT on the need and event tables',
  not exists (select 1 from unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p where has_table_privilege('service_role', 'public.report_private_context', p))
  and has_table_privilege('service_role', 'public.report_private_context_need', 'select')
  and has_table_privilege('service_role', 'public.report_private_context_event', 'select')
  and not exists (select 1 from unnest(array['insert', 'update', 'delete', 'truncate']) p, unnest(array['public.report_private_context_need', 'public.report_private_context_event']) t
                   where has_table_privilege('service_role', t, p)),
  null);
select pg_temp._ck('L04 every report_private_context_ function is locked to service_role, and each of the seven that touch private data is security definer with a pinned search_path',
  not exists (select 1 from pg_proc p where p.proname like 'report\_private\_context\_%'
               and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                    or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
                    or not has_function_privilege('service_role', p.oid, 'execute')))
  and (select count(*) = 7 and bool_and(p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=public, pg_temp'])
         from pg_proc p where p.pronamespace = 'public'::regnamespace
          and p.proname in ('report_private_context_create', 'report_private_context_need_open', 'report_private_context_need_close', 'report_private_context_read',
                            'report_private_context_purge', 'report_private_context_purge_due', 'report_private_context_retention_check')),
  null);
select pg_temp._ck('L05a control: all three API roles hold USAGE on the schema, so the refusals below come from the objects and not from the schema',
  has_schema_privilege('anon', 'public', 'usage') and has_schema_privilege('authenticated', 'public', 'usage') and has_schema_privilege('service_role', 'public', 'usage'),
  null);
select pg_temp._ck('L05 AS service_role: the functions work, but the private table itself cannot be read (42501)',
  pg_temp._as('service_role', format($$select * from public.report_private_context_read(%L)$$, (select needed from _m))) = 'ok'
  and pg_temp._as('service_role', format($$select public.report_private_context_create('{"address":"SR St"}'::jsonb, 'report', 'sr-1')$$)) = 'ok'
  and pg_temp._as('service_role', 'select count(*) from public.report_private_context') = '42501'
  and pg_temp._as('service_role', 'select count(*) from public.report_private_context_event') = 'ok',
  pg_temp._as('service_role', 'select count(*) from public.report_private_context'));
select pg_temp._ck('L06 AS anon and AS authenticated: every function is refused, and none of the three tables can be read or written (all 42501)',
  pg_temp._as('anon', format($$select * from public.report_private_context_read(%L)$$, (select needed from _m))) = '42501'
  and pg_temp._as('authenticated', format($$select * from public.report_private_context_read(%L)$$, (select needed from _m))) = '42501'
  and pg_temp._as('anon', $$select public.report_private_context_create('{"address":"X"}'::jsonb, 'report', 'x')$$) = '42501'
  and pg_temp._as('authenticated', format($$select public.report_private_context_purge(%L, 'legal_requirement')$$, (select needed from _m))) = '42501'
  and pg_temp._as('authenticated', 'select public.report_private_context_purge_due()') = '42501'
  and pg_temp._as('anon', 'select * from public.report_private_context_retention_check()') = '42501'
  and pg_temp._as('anon', 'select count(*) from public.report_private_context') = '42501'
  and pg_temp._as('authenticated', 'select count(*) from public.report_private_context_need') = '42501'
  and pg_temp._as('authenticated', 'select count(*) from public.report_private_context_event') = '42501'
  and pg_temp._as('anon', $$insert into public.report_private_context (address) values ('x')$$) = '42501'
  and (select state from public.report_private_context where context_id = (select needed from _m)) = 'active',
  null);

select pg_temp._ck('S01 every setup step in this suite ran without raising (a step that raises is a regression in the code under test, reported here instead of ending the run)',
  not exists (select 1 from _setup where result <> 'ok') and (select count(*) >= 10 from _setup),
  (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));

alter role service_role nobypassrls;
revoke usage on schema public from anon, authenticated, service_role;

\o
select check_name, pass, detail from _r order by n;

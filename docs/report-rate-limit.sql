-- =====================================================================================================================================
-- DEVELOPMENT ACTIVITY — THE REPORT RATE LIMIT (launch-readiness; the carried open item "free-report rate limit", docs/development-activity-launch-gate-2026-10-04.md)
--
-- WHAT THIS IS. A per-person and per-brokerage ceiling on how many report REQUESTS may reach the expensive part of the report function (the geocoder and
-- the canonical spatial reads). It sits BESIDE the entitlement and touches none of it: the 20 free reports (public.evaluation_report_limit) and the 100 paid
-- reports a month (public.billing_report_limit) and the constraints and triggers that enforce them are not read, written or changed here, and the
-- post-condition at the foot of this file refuses to apply if either number is anything but 20 and 100.
--
-- WHY IT IS NEEDED. The entitlement limits what is STORED AND CHARGED. It does not limit what is ASKED. A request that is not charged is unlimited work:
-- "No data ingested" (today every request, because no source is cleared), an address that cannot be found, an address outside coverage, and a report the
-- credit rule does not charge each cost a geocoder call and a spatial read and use no report. Behind an admin-created trial that is bounded by who was
-- invited; before any self-serve trial it is not. This closes that.
--
-- THE RULE. FIXED WINDOWS, three per subject: 60 seconds, one hour, one day. A subject is a person (auth user id) or a brokerage (account id). A
-- request is ALLOWED only if EVERY applicable window still has room, and only then is every window incremented, together, in one transaction; a REFUSED
-- request consumes NOTHING (so a client that keeps retrying a refusal cannot lock itself out longer, and cannot run up a count). The refusal says how many
-- seconds until the longest-blocked window ends and which subject and window refused.
--
-- THE NUMBERS (public.report_rate_limits(), the ONE definition). THEY ARE PROPOSED, NOT FOUNDER-SET: nothing in the plan or the founder rulings names a
-- request ceiling (the 20 and the 100 are the only founder numbers and they are untouched). They are chosen to sit well above a person working through
-- addresses by hand and well below a script, and they are changed in this one function. Decision D-RL-1 (docs/development-activity-launch-gate-2026-10-04.md)
-- records that the founder may set them.
--     person       10 a minute      60 an hour     200 a day
--     brokerage    30 a minute     200 an hour    1000 a day
--
-- WHAT IT STORES. A person's id or a brokerage's id, a window length, when that window began and how many requests it has seen: counters, nothing else.
-- NO email, NO address, NO IP address, NO token. A row is overwritten in place when its window rolls over, so the table never grows past
-- (people + brokerages) x 3 rows and needs no scheduled job. It is not customer-entered private context and it is not part of the permanent historical record.
--
-- ACCESS: system-only (the K0 / L1 posture, as docs/brokerage-billing.sql): RLS on, no policy, every privilege on the table revoked from every role,
-- and EXECUTE on the functions for service_role alone. The report edge function is the only caller.
--
-- FAILS CLOSED. The edge function treats any failure of this call as "could not check", answers 502 and does NOT go on to the geocoder. A limiter that
-- cannot be read does not become an open door.
--
-- SERIALISED. Two requests at once cannot both take the last slot: the claim holds a transaction-scoped advisory lock on the person and on the
-- brokerage, always in that order (a person belongs to one brokerage, so the order cannot make a cycle).
--
-- SCOPE (and what is not covered): this limits the REPORT request of a signed-in trial or paid member. It does not limit an admin (the founder's own
-- tool), the saved-report list and open reads, share links, the Watch, the checkout request, trial creation or the public client link. See the audit table
-- in docs/development-activity-launch-gate-2026-10-04.md §"Anti-abuse audit". Nothing here is a firewall: a flood of requests still reaches the edge and
-- the database once each; what it prevents is that flood reaching the geocoder and the spatial reads.
--
-- APPLY ORDER (production): this file FIRST, then deploy get-development-activity-report. The deployed function calls report_rate_claim; deployed before
-- this file is applied it would fail closed (502) for every member. Applying this file first changes nothing a person sees.
-- Idempotent: applying it twice leaves the same objects. Depends on: docs/brokerage-account-spine.sql (brokerage_membership_of),
-- docs/evaluation-entitlement.sql (evaluation_report_limit) and docs/brokerage-billing.sql (billing_report_limit).
-- =====================================================================================================================================

-- ---- 1. PRECONDITIONS: refuse, creating nothing, if a layer this stands on is absent ---------------------------------------------------
do $pre$
begin
  if to_regprocedure('public.brokerage_membership_of(uuid)') is null then
    raise exception 'report_rate_limit: public.brokerage_membership_of(uuid) is absent (apply docs/brokerage-account-spine.sql first)';
  end if;
  if to_regprocedure('public.evaluation_report_limit()') is null then
    raise exception 'report_rate_limit: public.evaluation_report_limit() is absent (apply docs/evaluation-entitlement.sql first)';
  end if;
  if to_regprocedure('public.billing_report_limit()') is null then
    raise exception 'report_rate_limit: public.billing_report_limit() is absent (apply docs/brokerage-billing.sql first)';
  end if;
end
$pre$;

-- ---- 2. THE LIMITS: one definition --------------------------------------------------------------------------------------------------------
create or replace function public.report_rate_limits()
returns table (bucket text, window_secs integer, max_requests integer)
language sql immutable set search_path = public, pg_temp
as $$
  values ('user', 60, 10), ('user', 3600, 60), ('user', 86400, 200),
         ('brokerage', 60, 30), ('brokerage', 3600, 200), ('brokerage', 86400, 1000)
$$;

-- ---- 3. THE COUNTERS ----------------------------------------------------------------------------------------------------------------------
create table if not exists public.report_rate_window (
  bucket        text        not null,
  subject       uuid        not null,
  window_secs   integer     not null,
  window_start  timestamptz not null,
  used          integer     not null,
  constraint report_rate_window_pkey   primary key (bucket, subject, window_secs),
  constraint report_rate_window_bucket check (bucket in ('user', 'brokerage')),
  constraint report_rate_window_secs   check (window_secs in (60, 3600, 86400)),
  constraint report_rate_window_used   check (used >= 1)
);

-- ---- 4. THE CLAIM -------------------------------------------------------------------------------------------------------------------------
-- report_rate_claim_at takes the clock as an argument so the whole rule can be tested across window boundaries; report_rate_claim is the only one the
-- edge function calls and it passes the database's own clock. Both are system-only.
create or replace function public.report_rate_claim_at(p_user uuid, p_at timestamptz)
returns table (allowed boolean, retry_after_seconds integer, limited_by text, limited_window_secs integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  l          record;
  v_brokerage uuid;
  v_subject  uuid;
  v_start    timestamptz;
  v_used     integer;
  v_wait     integer;
  v_worst    integer := 0;
  v_scope    text;
  v_win      integer;
begin
  if p_user is null or p_at is null then
    raise exception using errcode = '22023', message = 'RATE_CLAIM_NEEDS_USER_AND_TIME';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '55000', message = 'RATE_CLAIM_NEEDS_READ_COMMITTED';
  end if;
  select m.brokerage_id into v_brokerage from public.brokerage_membership_of(p_user) m limit 1;

  -- serialise: the person, then the brokerage (always in that order)
  perform pg_advisory_xact_lock(hashtextextended('report_rate|user|' || p_user::text, 0));
  if v_brokerage is not null then
    perform pg_advisory_xact_lock(hashtextextended('report_rate|brokerage|' || v_brokerage::text, 0));
  end if;

  -- 1. is there room in EVERY applicable window? (read only: nothing is written yet)
  for l in select * from public.report_rate_limits() order by bucket, window_secs loop
    v_subject := case l.bucket when 'user' then p_user else v_brokerage end;
    continue when v_subject is null;
    v_start := to_timestamp(floor(extract(epoch from p_at) / l.window_secs) * l.window_secs);
    select w.used into v_used from public.report_rate_window w
     where w.bucket = l.bucket and w.subject = v_subject and w.window_secs = l.window_secs and w.window_start >= v_start;
    if coalesce(v_used, 0) >= l.max_requests then
      v_wait := greatest(1, ceil(extract(epoch from (v_start + l.window_secs * interval '1 second' - p_at)))::integer);
      if v_wait > v_worst then v_worst := v_wait; v_scope := l.bucket; v_win := l.window_secs; end if;
    end if;
  end loop;

  -- a refusal consumes nothing
  if v_worst > 0 then
    return query select false, v_worst, v_scope, v_win;
    return;
  end if;

  -- 2. take one from EVERY applicable window, together
  for l in select * from public.report_rate_limits() order by bucket, window_secs loop
    v_subject := case l.bucket when 'user' then p_user else v_brokerage end;
    continue when v_subject is null;
    v_start := to_timestamp(floor(extract(epoch from p_at) / l.window_secs) * l.window_secs);
    insert into public.report_rate_window as w (bucket, subject, window_secs, window_start, used)
    values (l.bucket, v_subject, l.window_secs, v_start, 1)
    on conflict (bucket, subject, window_secs) do update
      set used         = case when w.window_start >= excluded.window_start then w.used + 1 else 1 end,
          window_start = greatest(w.window_start, excluded.window_start);
  end loop;
  return query select true, 0, null::text, null::integer;
end
$$;

create or replace function public.report_rate_claim(p_user uuid)
returns table (allowed boolean, retry_after_seconds integer, limited_by text, limited_window_secs integer)
language sql security definer set search_path = public, pg_temp
as $$ select * from public.report_rate_claim_at(p_user, now()) $$;

-- ---- 5. THE AUDIT: every invariant as a count that must be zero, beside controls that must not be ---------------------------------------
create or replace function public.report_rate_check()
returns table (check_name text, kind text, n bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select 'window_above_its_limit', 'invariant', count(*) from public.report_rate_window w
    join public.report_rate_limits() l on l.bucket = w.bucket and l.window_secs = w.window_secs
   where w.used > l.max_requests
  union all select 'window_with_no_limit', 'invariant', count(*) from public.report_rate_window w
   where not exists (select 1 from public.report_rate_limits() l where l.bucket = w.bucket and l.window_secs = w.window_secs)
  union all select 'limit_not_larger_for_a_longer_window', 'invariant', count(*) from public.report_rate_limits() a
    join public.report_rate_limits() b on a.bucket = b.bucket and b.window_secs > a.window_secs and b.max_requests < a.max_requests
  union all select 'limits_defined', 'control', count(*) from public.report_rate_limits()
  union all select 'counter_rows', 'control', count(*) from public.report_rate_window
$$;

-- ---- 6. LOCK-DOWN: system-only --------------------------------------------------------------------------------------------------------------
alter table public.report_rate_window enable row level security;
revoke all on public.report_rate_window from public, anon, authenticated, service_role;
revoke all on function public.report_rate_limits()                       from public, anon, authenticated, service_role;
revoke all on function public.report_rate_claim_at(uuid, timestamptz)   from public, anon, authenticated, service_role;
revoke all on function public.report_rate_claim(uuid)                    from public, anon, authenticated, service_role;
revoke all on function public.report_rate_check()                        from public, anon, authenticated, service_role;
grant execute on function public.report_rate_limits()                    to service_role;
grant execute on function public.report_rate_claim_at(uuid, timestamptz) to service_role;
grant execute on function public.report_rate_claim(uuid)                 to service_role;
grant execute on function public.report_rate_check()                     to service_role;

-- ---- 7. POST-CONDITION ----------------------------------------------------------------------------------------------------------------------
-- Computed over every function and relation this file owns, so one added later that is open to a resident role fails here. It also refuses to leave
-- the entitlement numbers anything but the founder's (20 free, 100 paid): this file must never be the reason either changed.
do $post$
declare
  f record;
  t record;
begin
  for f in select p.oid, p.oid::regprocedure::text as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'report\_rate\_%' loop
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f.oid and a.grantee <> p.proowner
                  and (a.grantee <> (select oid from pg_roles where rolname = 'service_role') or a.privilege_type <> 'EXECUTE')) then
      raise exception 'report_rate_limit: % is executable by a role it should not be', f.sig;
    end if;
  end loop;
  for t in select c.oid, c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'report_rate_window' loop
    if not t.relrowsecurity then raise exception 'report_rate_limit: % has row level security off', t.relname; end if;
    if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = t.oid and a.grantee <> c.relowner) then
      raise exception 'report_rate_limit: % is open to a role other than its owner', t.relname;
    end if;
  end loop;
  if (select count(*) from public.report_rate_limits()) <> 6 then raise exception 'report_rate_limit: the limits are not the six this file defines'; end if;
  if exists (select 1 from public.report_rate_check() where kind = 'invariant' and n <> 0) then raise exception 'report_rate_limit: an invariant is not zero'; end if;
  if public.evaluation_report_limit() <> 20 then raise exception 'report_rate_limit: the free report limit is not 20 (founder-set; this file must not change it)'; end if;
  if public.billing_report_limit() <> 100 then raise exception 'report_rate_limit: the paid monthly limit is not 100 (founder-set; this file must not change it)'; end if;
end
$post$;

-- ROLLBACK (this file only; removes the limiter and every counter, touches nothing the entitlement owns)
-- drop function if exists public.report_rate_check();
-- drop function if exists public.report_rate_claim(uuid);
-- drop function if exists public.report_rate_claim_at(uuid, timestamptz);
-- drop table if exists public.report_rate_window;
-- drop function if exists public.report_rate_limits();

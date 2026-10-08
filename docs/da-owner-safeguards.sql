-- =====================================================================================================================================
-- DEVELOPMENT ACTIVITY — THREE OWNER SAFEGUARDS (audit item D, founder-approved 2026-10-08: "D approved")
--
-- Three independent, ADDITIVE pieces. Each is its own section, owns its own objects and can be rolled back alone (the footer drops them by name).
-- Nothing here changes a table, a column, a constraint or a function that exists: the 10 free reports (evaluation_report_limit), the 100 paid reports
-- a month (billing_report_limit), the report rate limit's numbers and every membership rule are read, never written, and the post-condition at the
-- foot refuses to apply if any of them is anything but what it was.
--
--  A. THE TEAM.  An owner can SEE who is on their brokerage (agents, with a masked email) and which invite links are still open, REMOVE an agent, and
--     WITHDRAW an open invite. Removing an agent ends their membership (status 'deactivated', stamped by the existing guard; the row stays as
--     history). Their saved reports, their credits and every ledger row are untouched: only their access ends. Withdrawing an invite is the existing
--     public.evaluation_invite_revoke (an owner may already call it for their own brokerage); this file adds only the listing and the removal.
--       public.brokerage_team_of(p_actor)                 who is on the team and which invites are open — owners only
--       public.brokerage_member_remove(p_actor, p_member) end one agent's membership — owners only, never an owner, never oneself
--  B. THE CLIENT LINK RATE LIMIT.  view-shared-report is the one function that answers a person who is NOT signed in, so it had no ceiling. The
--     function now takes one request from the windows of (1) the caller's network address — stored only as a salted one-way hash, never the address —
--     and (2) the link it asks about, BEFORE it looks the link up, and a full window answers 429. Counters only. A refused request consumes nothing.
--       public.share_view_limits()            the numbers (PROPOSED, not founder-set; changed in this one function)
--       public.share_view_claim_at / _claim   the claim
--  C. ONE OPEN CHECKOUT AT A TIME.  A brokerage owner who presses Subscribe twice, or in two tabs, used to get two checkouts and could pay twice. The
--     checkout function now claims the brokerage's single checkout slot first; while the slot is held (10 minutes) a second press is told a payment page was
--     just opened and no second checkout is made. The address of the checkout is NEVER stored (the launch gate pins that no table holds one): the slot is a
--     brokerage id and a time, nothing else. A checkout the processor could not make frees the slot at once.
--       public.billing_checkout_claim_at / _claim, _release
--
-- ACCESS: system-only (the K0 / L1 posture, as docs/report-rate-limit.sql): RLS on, no policy, every privilege on the tables revoked from every
-- role, EXECUTE on the functions for service_role alone. The edge functions are the only callers.
--
-- APPLY ORDER (production): this file FIRST, then deploy the functions that call it (development-activity-trial, view-shared-report, manage-billing).
-- Deployed before this file, each fails closed (a clear error, never an open door). Idempotent. Depends on docs/brokerage-account-spine.sql,
-- docs/evaluation-entitlement.sql, docs/brokerage-billing.sql and docs/report-rate-limit.sql.
-- =====================================================================================================================================

-- ---- 0. PRECONDITIONS: refuse, creating nothing, if a layer this stands on is absent ------------------------------------------------------
do $pre$
begin
  if to_regprocedure('public.brokerage_membership_of(uuid)') is null then
    raise exception 'da_owner_safeguards: public.brokerage_membership_of(uuid) is absent (apply docs/brokerage-account-spine.sql first)';
  end if;
  if to_regprocedure('public.evaluation_invite_revoke(uuid,uuid)') is null then
    raise exception 'da_owner_safeguards: public.evaluation_invite_revoke(uuid,uuid) is absent (apply docs/evaluation-entitlement.sql first)';
  end if;
  if to_regprocedure('public.billing_report_limit()') is null then
    raise exception 'da_owner_safeguards: public.billing_report_limit() is absent (apply docs/brokerage-billing.sql first)';
  end if;
  if to_regprocedure('public.report_rate_limits()') is null then
    raise exception 'da_owner_safeguards: public.report_rate_limits() is absent (apply docs/report-rate-limit.sql first)';
  end if;
end
$pre$;

-- =====================================================================================================================================
-- A. THE TEAM
-- =====================================================================================================================================
-- The listing. An owner only: anyone else (an agent, a person with no brokerage, an owner of nothing) gets the same NOT_ENTITLED the invite functions
-- give, so the answer is never an oracle. Members are ACTIVE AGENTS of the actor's brokerage (never owners, never anyone elsewhere). `ref` is the
-- opaque handle the removal / withdrawal takes; both re-check that the actor owns the same brokerage, so a handle is worth nothing to anyone else.
-- The label is a MASKED email (first letter, then ***, then the domain): enough for an owner to recognise their own agent, not the address.
create or replace function public.brokerage_team_of(p_actor uuid)
returns table (kind text, ref uuid, role text, label text, at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_actor record;
begin
  select r.* into v_actor from public.brokerage_membership_of(p_actor) r;
  if not found or v_actor.role <> 'owner' then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  return query
    select 'member'::text, m.id, m.role::text,
           case when u.email is null or position('@' in u.email) < 2 then '(no email)'
                else left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2) end,
           m.joined_at, null::timestamptz
      from public.brokerage_member m join auth.users u on u.id = m.user_id
     where m.brokerage_id = v_actor.brokerage_id and m.status = 'active' and m.role = 'agent'
    union all
    select 'invite'::text, i.invite_id, i.role::text, null::text, i.created_at, i.expires_at
      from public.evaluation_invite i join public.evaluation e on e.evaluation_id = i.evaluation_id
     where e.brokerage_id = v_actor.brokerage_id and i.status = 'open' and i.expires_at > now() and i.role = 'agent'
     order by 1, 5, 2;
end $$;

-- The removal. true when THIS call ended the membership; false when it was already ended. NOT_ENTITLED (one answer, no oracle) when the actor is not
-- an active owner of the target's brokerage, or when the target is not an agent (so never an owner, and never the asker, who must be one). READ COMMITTED only, because the
-- actor's standing is re-read after the row lock (as evaluation_invite_revoke does).
create or replace function public.brokerage_member_remove(p_actor uuid, p_member_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  mem     public.brokerage_member%rowtype;
  v_actor record;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'brokerage_member_remove: needs READ COMMITTED (the actor is re-read after a row lock; this transaction is at %)',
      current_setting('transaction_isolation') using errcode = '55000';
  end if;
  select m.* into mem from public.brokerage_member m where m.id = p_member_id for update;
  if not found then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  select r.* into v_actor from public.brokerage_membership_of(p_actor) r;
  if not found or v_actor.role <> 'owner' or v_actor.brokerage_id <> mem.brokerage_id or mem.role <> 'agent' then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  if mem.status <> 'active' then
    return false;
  end if;
  update public.brokerage_member set status = 'deactivated' where id = mem.id;   -- deactivated_at is stamped by brokerage_member_guard, never by the caller
  return true;
end $$;

-- =====================================================================================================================================
-- B. THE CLIENT LINK RATE LIMIT
-- =====================================================================================================================================
-- THE NUMBERS. PROPOSED, NOT FOUNDER-SET (the same footing as report_rate_limits): a client opens their report a handful of times. These sit far above
-- that and far below a script. Changed in this one function.
--     client (one network address)   30 a minute    300 an hour    2000 a day
--     link   (one share link)        120 a minute   1500 an hour
create or replace function public.share_view_limits()
returns table (bucket text, window_secs integer, max_requests integer)
language sql immutable set search_path = public, pg_temp
as $$
  values ('client', 60, 30), ('client', 3600, 300), ('client', 86400, 2000),
         ('link', 60, 120), ('link', 3600, 1500)
$$;

-- Counters only. `subject` is a one-way hash (the edge function salts and hashes the network address, and sends the link's own SHA-256): never an
-- address, an email, a token. Rows are overwritten in place when a window rolls over, and a claim deletes a few long-dead rows, so the table does not
-- grow without bound and needs no scheduled job.
create table if not exists public.share_view_window (
  bucket        text        not null,
  subject       text        not null,
  window_secs   integer     not null,
  window_start  timestamptz not null,
  used          integer     not null,
  constraint share_view_window_pkey    primary key (bucket, subject, window_secs),
  constraint share_view_window_bucket  check (bucket in ('client', 'link')),
  constraint share_view_window_secs    check (window_secs in (60, 3600, 86400)),
  constraint share_view_window_subject check (subject ~ '^[0-9a-f]{32,64}$'),
  constraint share_view_window_used    check (used >= 1)
);
create index if not exists share_view_window_by_start on public.share_view_window (window_start);

-- p_client is required; p_link is null for a request with no well-formed token (it still takes the caller's windows). The clock is an argument so the
-- whole rule can be tested across window boundaries; share_view_claim is the only one the edge function calls and it passes the database's own clock.
create or replace function public.share_view_claim_at(p_client text, p_link text, p_at timestamptz)
returns table (allowed boolean, retry_after_seconds integer, limited_by text, limited_window_secs integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  l         record;
  v_subject text;
  v_start   timestamptz;
  v_used    integer;
  v_wait    integer;
  v_worst   integer := 0;
  v_scope   text;
  v_win     integer;
begin
  if p_client is null or p_at is null or p_client !~ '^[0-9a-f]{32,64}$' or (p_link is not null and p_link !~ '^[0-9a-f]{32,64}$') then
    raise exception using errcode = '22023', message = 'SHARE_VIEW_CLAIM_NEEDS_CLIENT_AND_TIME';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '55000', message = 'SHARE_VIEW_CLAIM_NEEDS_READ_COMMITTED';
  end if;

  -- serialise: the client, then the link (always in that order)
  perform pg_advisory_xact_lock(hashtextextended('share_view|client|' || p_client, 0));
  if p_link is not null then
    perform pg_advisory_xact_lock(hashtextextended('share_view|link|' || p_link, 0));
  end if;

  -- 1. is there room in EVERY applicable window? (read only: nothing is written yet)
  for l in select * from public.share_view_limits() order by bucket, window_secs loop
    v_subject := case l.bucket when 'client' then p_client else p_link end;
    continue when v_subject is null;
    v_start := to_timestamp(floor(extract(epoch from p_at) / l.window_secs) * l.window_secs);
    select w.used into v_used from public.share_view_window w
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
  for l in select * from public.share_view_limits() order by bucket, window_secs loop
    v_subject := case l.bucket when 'client' then p_client else p_link end;
    continue when v_subject is null;
    v_start := to_timestamp(floor(extract(epoch from p_at) / l.window_secs) * l.window_secs);
    insert into public.share_view_window as w (bucket, subject, window_secs, window_start, used)
    values (l.bucket, v_subject, l.window_secs, v_start, 1)
    on conflict (bucket, subject, window_secs) do update
      set used         = case when w.window_start >= excluded.window_start then w.used + 1 else 1 end,
          window_start = greatest(w.window_start, excluded.window_start);
  end loop;

  -- 3. housekeeping: at most 25 rows whose window ended more than two days ago (their count could never matter again)
  delete from public.share_view_window d
   where d.ctid in (select w.ctid from public.share_view_window w where w.window_start < p_at - interval '2 days' order by w.window_start limit 25);
  return query select true, 0, null::text, null::integer;
end
$$;

create or replace function public.share_view_claim(p_client text, p_link text)
returns table (allowed boolean, retry_after_seconds integer, limited_by text, limited_window_secs integer)
language sql security definer set search_path = public, pg_temp
as $$ select * from public.share_view_claim_at(p_client, p_link, now()) $$;

-- =====================================================================================================================================
-- C. ONE OPEN CHECKOUT AT A TIME
-- =====================================================================================================================================
-- One row per brokerage: the instant its slot was last claimed. NOTHING ELSE: the address of the checkout is not kept anywhere (the launch gate pins that no
-- table of the public schema holds one), so a second press cannot be handed the first checkout back; it is told one was just opened.
create table if not exists public.billing_checkout_claim (
  brokerage_id uuid        primary key references public.brokerage_account (id),
  claimed_at   timestamptz not null
);

-- CLAIMED: the slot was free — the caller makes ONE checkout (and calls _release if the processor could not make it).
-- BUSY:    a checkout was claimed less than 10 minutes ago — the caller makes none.
create or replace function public.billing_checkout_claim_at(p_brokerage uuid, p_at timestamptz)
returns table (outcome text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.billing_checkout_claim%rowtype;
begin
  if p_brokerage is null or p_at is null then
    raise exception using errcode = '22023', message = 'CHECKOUT_CLAIM_NEEDS_BROKERAGE_AND_TIME';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '55000', message = 'CHECKOUT_CLAIM_NEEDS_READ_COMMITTED';
  end if;
  if not exists (select 1 from public.brokerage_account a where a.id = p_brokerage and a.status = 'active') then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billing_checkout|' || p_brokerage::text, 0));
  select * into c from public.billing_checkout_claim k where k.brokerage_id = p_brokerage;
  if found and c.claimed_at > p_at - interval '10 minutes' then
    return query select 'BUSY'::text;
    return;
  end if;
  insert into public.billing_checkout_claim as k (brokerage_id, claimed_at) values (p_brokerage, p_at)
  on conflict (brokerage_id) do update set claimed_at = excluded.claimed_at;
  return query select 'CLAIMED'::text;
end $$;

create or replace function public.billing_checkout_claim(p_brokerage uuid)
returns table (outcome text)
language sql security definer set search_path = public, pg_temp
as $$ select * from public.billing_checkout_claim_at(p_brokerage, now()) $$;

-- The checkout could not be made: free the slot at once so the owner can try again. true when a slot was removed.
create or replace function public.billing_checkout_release(p_brokerage uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  delete from public.billing_checkout_claim where brokerage_id = p_brokerage;
  return found;
end $$;

-- ---- THE AUDIT: every invariant a count that must be zero, beside controls that must not be ---------------------------------------------
create or replace function public.da_owner_safeguards_check()
returns table (check_name text, kind text, n bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select 'share_window_above_its_limit', 'invariant', count(*) from public.share_view_window w
    join public.share_view_limits() l on l.bucket = w.bucket and l.window_secs = w.window_secs where w.used > l.max_requests
  union all select 'share_window_with_no_limit', 'invariant', count(*) from public.share_view_window w
   where not exists (select 1 from public.share_view_limits() l where l.bucket = w.bucket and l.window_secs = w.window_secs)
  union all select 'checkout_claim_for_a_closed_brokerage', 'invariant', count(*) from public.billing_checkout_claim k
    join public.brokerage_account a on a.id = k.brokerage_id where a.status <> 'active'
  union all select 'agent_deactivated_without_a_stamp', 'invariant', count(*) from public.brokerage_member m where m.status = 'deactivated' and m.deactivated_at is null
  union all select 'share_limits_defined', 'control', count(*) from public.share_view_limits()
  union all select 'share_counter_rows', 'control', count(*) from public.share_view_window
  union all select 'checkout_claim_rows', 'control', count(*) from public.billing_checkout_claim
$$;

-- ---- LOCK-DOWN: system-only ---------------------------------------------------------------------------------------------------------------
alter table public.share_view_window     enable row level security;
alter table public.billing_checkout_claim enable row level security;
revoke all on public.share_view_window      from public, anon, authenticated, service_role;
revoke all on public.billing_checkout_claim from public, anon, authenticated, service_role;
revoke all on function public.brokerage_team_of(uuid)                         from public, anon, authenticated, service_role;
revoke all on function public.brokerage_member_remove(uuid, uuid)            from public, anon, authenticated, service_role;
revoke all on function public.share_view_limits()                            from public, anon, authenticated, service_role;
revoke all on function public.share_view_claim_at(text, text, timestamptz)   from public, anon, authenticated, service_role;
revoke all on function public.share_view_claim(text, text)                   from public, anon, authenticated, service_role;
revoke all on function public.billing_checkout_claim_at(uuid, timestamptz)   from public, anon, authenticated, service_role;
revoke all on function public.billing_checkout_claim(uuid)                   from public, anon, authenticated, service_role;
revoke all on function public.billing_checkout_release(uuid)                 from public, anon, authenticated, service_role;
revoke all on function public.da_owner_safeguards_check()                    from public, anon, authenticated, service_role;
grant execute on function public.brokerage_team_of(uuid)                         to service_role;
grant execute on function public.brokerage_member_remove(uuid, uuid)            to service_role;
grant execute on function public.share_view_limits()                            to service_role;
grant execute on function public.share_view_claim_at(text, text, timestamptz)   to service_role;
grant execute on function public.share_view_claim(text, text)                   to service_role;
grant execute on function public.billing_checkout_claim_at(uuid, timestamptz)   to service_role;
grant execute on function public.billing_checkout_claim(uuid)                   to service_role;
grant execute on function public.billing_checkout_release(uuid)                 to service_role;
grant execute on function public.da_owner_safeguards_check()                    to service_role;

-- ---- POST-CONDITION -----------------------------------------------------------------------------------------------------------------------
-- Computed over every function and relation this file owns, so one added later that is open to a resident role fails here; and it refuses to leave
-- the founder's numbers anything but what they are (10 free, 100 paid) or the report rate limit's numbers moved.
do $post$
declare
  f record;
  t text;
begin
  for f in select p.oid, p.oid::regprocedure::text as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and (p.proname like 'share\_view\_%' or p.proname like 'billing\_checkout\_%' or p.proname in ('brokerage_team_of', 'brokerage_member_remove', 'da_owner_safeguards_check')) loop
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f.oid and a.grantee <> p.proowner
                  and (a.grantee <> (select oid from pg_roles where rolname = 'service_role') or a.privilege_type <> 'EXECUTE')) then
      raise exception 'da_owner_safeguards: % is executable by a role it should not be', f.sig;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = f.oid) and f.sig not like 'share_view_limits%' then
      raise exception 'da_owner_safeguards: % is not SECURITY DEFINER', f.sig;
    end if;
  end loop;
  foreach t in array array['share_view_window', 'billing_checkout_claim'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || t)) then
      raise exception 'da_owner_safeguards: row level security is off on %', t;
    end if;
    if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                where c.oid = to_regclass('public.' || t) and a.grantee <> c.relowner) then
      raise exception 'da_owner_safeguards: % has a privilege granted to a role other than its owner', t;
    end if;
  end loop;
  if public.evaluation_report_limit() <> 10 or public.billing_report_limit() <> 100 then
    raise exception 'da_owner_safeguards: the founder numbers moved (10 free, 100 paid)';
  end if;
  if (select string_agg(bucket || ':' || window_secs || ':' || max_requests, ',' order by bucket collate "C", window_secs) from public.share_view_limits())
       <> 'client:60:30,client:3600:300,client:86400:2000,link:60:120,link:3600:1500' then
    raise exception 'da_owner_safeguards: the share link limits are not the ones this file states';
  end if;
  if (select string_agg(bucket || ':' || window_secs || ':' || max_requests, ',' order by bucket collate "C", window_secs) from public.report_rate_limits())
       <> 'brokerage:60:30,brokerage:3600:200,brokerage:86400:1000,user:60:10,user:3600:60,user:86400:200' then
    raise exception 'da_owner_safeguards: the report rate limit numbers moved';
  end if;
end
$post$;

-- ROLLBACK (this file only; every statement is idempotent. Stored counters and checkout slots are discarded, which is harmless: they are windows
-- and short-lived markers, not history. A removed agent STAYS removed: the membership row is history and is not touched.)
-- drop function if exists public.da_owner_safeguards_check();
-- drop function if exists public.brokerage_team_of(uuid);
-- drop function if exists public.brokerage_member_remove(uuid, uuid);
-- drop function if exists public.share_view_claim(text, text);
-- drop function if exists public.share_view_claim_at(text, text, timestamptz);
-- drop function if exists public.share_view_limits();
-- drop function if exists public.billing_checkout_claim(uuid);
-- drop function if exists public.billing_checkout_claim_at(uuid, timestamptz);
-- drop function if exists public.billing_checkout_release(uuid);
-- drop table if exists public.share_view_window;
-- drop table if exists public.billing_checkout_claim;

-- ============================================================================
-- REPORT PRIVATE CONTEXT  (Development Activity plan, Order F2 — 2026-09-30)
-- SQL OF RECORD. The DELETABLE half of a stored report: the customer-entered street address and
-- everything derived from it. One table for the context, one for the reasons it is still needed,
-- one append-only audit log, and the functions that are the only way in or out.
--
-- WHY IT EXISTS (founder decision, 2026-09-29)
--   Permanent HomeSignal intelligence — development records, evidence, canonical identities,
--   observations, change history, and the fact that a report was issued — survives. A street
--   address a brokerage typed is CUSTOMER CONTEXT: it must not become permanent merely because it
--   was used to generate a report. So it does not live in public.report_snapshot (immutable, see
--   docs/report-snapshot.sql). It lives here, is kept only while something still needs it, and is
--   purged after a bounded grace period. "Permanent intelligence survives. Customer-entered
--   private context does not become permanent merely because it generated that intelligence."
--
-- THE RETENTION RULE, as code (founder, 2026-09-29)
--   * A context is kept while a REPORT, a property FOLLOW, or an ACCOUNT relationship that needs
--     it is open. Each of those is a row in report_private_context_need.
--   * When the LAST open need closes, a 90-day clock starts: purge_due_at = now() + 90 days.
--     That is a customer-data recovery / operational window, NOT a historical-intelligence
--     retention period. Opening a need again inside the window clears the clock.
--   * When the clock runs out the private values are purged (report_private_context_purge_due()).
--   * A verified privacy-deletion request, or a legal requirement, purges IMMEDIATELY and
--     overrides the grace period (report_private_context_purge(context, reason)).
--   * 90 days is a CEILING, enforced by a CHECK: no row can carry a purge date later than
--     last_needed_at + 90 days. There is exactly one definition of the number:
--     report_private_context_grace().
--
-- PURGE IS IN PLACE, NEVER A ROW DELETE
--   A purged row keeps its context_id, timestamps, state and reason, and NULLs every private
--   value. So the permanent snapshot that references it keeps a valid foreign key, the audit trail
--   stays whole, and "was this ever purged, when, and why" stays answerable. A purged context is
--   terminal: it cannot be reopened, and a new report needs a new context.
--
-- WHAT IT DELIBERATELY DOES NOT HOLD
--   Client name, email, phone or any other client identifier: create() REFUSES an unknown key
--   rather than storing it. (`label` is the one optional free-text field — a brokerage's own
--   property label — and it is private, deletable and scanned out of the permanent snapshot.)
--   Nor an owner: whose context it is depends on the account tables of Orders J and L, and the
--   column is added, additively, with them.
--
-- ACCESS: system-only. RLS on for all three tables. anon and authenticated hold nothing.
-- service_role holds NO privilege on the private table at all — it reaches the values only through
-- report_private_context_read(), so every read is a function call — and SELECT on the need and
-- event tables, which carry identifiers and dates but never a private value.
--
-- NO SCHEDULE IS ARMED HERE. report_private_context_purge_due() is written and tested; nothing
-- calls it on a timer. Arming it is a new scheduled job and waits for its own go (plan Order J/L).
-- Until then report_private_context_retention_check() reports overdue contexts by count.
--
-- ADDITIVE ONLY. Creates three tables and their functions; alters nothing that exists. Idempotent:
-- safe to run twice. ROLLBACK is at the foot of this file.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------
do $pre$
begin
  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'report_private_context: gen_random_uuid() is not available';
  end if;
end $pre$;

-- ---- 1. THE ONE DEFINITION OF THE GRACE PERIOD ---------------------------------------
create or replace function public.report_private_context_grace() returns interval
language sql immutable as $$ select interval '90 days' $$;

-- ---- 2. THE PRIVATE CONTEXT ------------------------------------------------------------
create table if not exists public.report_private_context (
  context_id         uuid        primary key default gen_random_uuid(),
  state              text        not null default 'active',
  address            text,
  normalized_address text,
  latitude           numeric,
  longitude          numeric,
  property_keys      text[],
  label              text,
  created_at         timestamptz not null default now(),
  last_needed_at     timestamptz not null default now(),
  purge_due_at       timestamptz,
  purged_at          timestamptz,
  purge_reason       text,
  constraint report_private_context_state check (state in ('active', 'purged')),
  constraint report_private_context_active_has_address check (state <> 'active' or (address is not null and btrim(address) <> '')),
  constraint report_private_context_active_not_purged check (state <> 'active' or (purged_at is null and purge_reason is null)),
  constraint report_private_context_purged_is_empty check (state <> 'purged' or (
    address is null and normalized_address is null and latitude is null and longitude is null
    and property_keys is null and label is null and purge_due_at is null
    and purged_at is not null and purge_reason is not null)),
  constraint report_private_context_reason check (purge_reason is null or purge_reason in ('retention_expired', 'verified_privacy_request', 'legal_requirement')),
  constraint report_private_context_point check ((latitude is null) = (longitude is null)
    and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))),
  constraint report_private_context_grace_ceiling check (purge_due_at is null or purge_due_at <= last_needed_at + public.report_private_context_grace())
);

-- ---- 3. WHY IT IS STILL NEEDED --------------------------------------------------------
create table if not exists public.report_private_context_need (
  need_id    uuid        primary key default gen_random_uuid(),
  context_id uuid        not null references public.report_private_context (context_id),
  kind       text        not null,
  ref        text        not null,
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  constraint report_private_context_need_kind check (kind in ('report', 'follow', 'account')),
  constraint report_private_context_need_ref  check (btrim(ref) <> ''),
  constraint report_private_context_need_span check (closed_at is null or closed_at >= opened_at)
);
create unique index if not exists report_private_context_need_one_open
  on public.report_private_context_need (context_id, kind, ref) where closed_at is null;
create index if not exists report_private_context_need_by_context
  on public.report_private_context_need (context_id);

-- ---- 4. THE AUDIT LOG (append-only; carries no private value, by construction) -----------
create table if not exists public.report_private_context_event (
  event_id   bigint      generated always as identity primary key,
  context_id uuid        not null references public.report_private_context (context_id),
  kind       text        not null,
  need_kind  text,
  reason     text,
  at         timestamptz not null default now(),
  constraint report_private_context_event_kind check (kind in ('created', 'need_opened', 'need_closed', 'grace_started', 'grace_cleared', 'purged')),
  constraint report_private_context_event_need_kind check (need_kind is null or need_kind in ('report', 'follow', 'account')),
  constraint report_private_context_event_reason check (reason is null or reason in ('retention_expired', 'verified_privacy_request', 'legal_requirement'))
);
create index if not exists report_private_context_event_by_context
  on public.report_private_context_event (context_id, event_id);

-- ---- 5. GUARDS -----------------------------------------------------------------------------
-- events are append-only; a need may only be CLOSED (never edited or removed); a context is never
-- deleted and a purged context never comes back.
create or replace function public.report_private_context_event_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'report_private_context_event is append-only (% refused)', tg_op;
end $$;

create or replace function public.report_private_context_need_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.closed_at is null and new.closed_at is not null
     and new.need_id = old.need_id and new.context_id = old.context_id
     and new.kind = old.kind and new.ref = old.ref and new.opened_at = old.opened_at then
    return new;
  end if;
  raise exception 'report_private_context_need may only be closed (% refused)', tg_op;
end $$;

create or replace function public.report_private_context_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.state = 'purged' then
      raise exception 'report_private_context: a purged context is terminal (update refused)';
    end if;
    if new.context_id <> old.context_id or new.created_at <> old.created_at then
      raise exception 'report_private_context: identity columns cannot change';
    end if;
    return new;
  end if;
  raise exception 'report_private_context rows are purged in place, never deleted (% refused)', tg_op;
end $$;

create or replace trigger report_private_context_event_no_change
  before update or delete on public.report_private_context_event
  for each row execute function public.report_private_context_event_immutable();
create or replace trigger report_private_context_event_no_truncate
  before truncate on public.report_private_context_event
  for each statement execute function public.report_private_context_event_immutable();
create or replace trigger report_private_context_need_only_close
  before update or delete on public.report_private_context_need
  for each row execute function public.report_private_context_need_guard();
create or replace trigger report_private_context_need_no_truncate
  before truncate on public.report_private_context_need
  for each statement execute function public.report_private_context_need_guard();
create or replace trigger report_private_context_no_delete_or_reopen
  before update or delete on public.report_private_context
  for each row execute function public.report_private_context_guard();
-- There is deliberately NO truncate trigger on the context table itself. PostgreSQL refuses a plain
-- TRUNCATE of a table that other tables reference (0A000) before any trigger could fire, and
-- TRUNCATE ... CASCADE reaches the need and event tables, whose truncate triggers refuse it. A
-- trigger here could never be the thing that stops it, so it would be protection nobody can observe.

-- ---- 6. THE FUNCTIONS (the only way in and out) ---------------------------------------------
-- create: the private values, plus the FIRST reason it is needed. A context with no reason to
-- exist is not creatable, so every active context is either needed or on a clock.
create or replace function public.report_private_context_create(p_private jsonb, p_need_kind text, p_need_ref text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id   uuid;
  v_addr text;
  v_lat  numeric;
  v_lng  numeric;
  v_keys text[];
  v_bad  text;
begin
  if jsonb_typeof(p_private) is distinct from 'object' then
    raise exception 'report_private_context: the private context must be a JSON object' using errcode = '22023';
  end if;
  -- an unknown key is REFUSED, not stored: this is how a client name, email or phone never lands here
  select k into v_bad from jsonb_object_keys(p_private) k
   where k not in ('address', 'normalized_address', 'latitude', 'longitude', 'property_keys', 'label') limit 1;
  if v_bad is not null then
    raise exception 'report_private_context: unknown field "%" (allowed: address, normalized_address, latitude, longitude, property_keys, label)', v_bad using errcode = '22023';
  end if;
  v_addr := nullif(btrim(p_private ->> 'address'), '');
  if v_addr is null then
    raise exception 'report_private_context: an address is required' using errcode = '23514';
  end if;
  if p_private ? 'latitude' or p_private ? 'longitude' then
    if jsonb_typeof(p_private -> 'latitude') is distinct from 'number' or jsonb_typeof(p_private -> 'longitude') is distinct from 'number' then
      raise exception 'report_private_context: latitude and longitude must both be numbers' using errcode = '22023';
    end if;
    v_lat := (p_private ->> 'latitude')::numeric;
    v_lng := (p_private ->> 'longitude')::numeric;
  end if;
  if p_private ? 'property_keys' then
    if jsonb_typeof(p_private -> 'property_keys') is distinct from 'array'
       or exists (select 1 from jsonb_array_elements(p_private -> 'property_keys') e where jsonb_typeof(e) <> 'string' or btrim(e #>> '{}') = '') then
      raise exception 'report_private_context: property_keys must be an array of non-blank strings' using errcode = '22023';
    end if;
    select array_agg(e #>> '{}') into v_keys from jsonb_array_elements(p_private -> 'property_keys') e;
  end if;

  insert into public.report_private_context (address, normalized_address, latitude, longitude, property_keys, label)
  values (v_addr, nullif(btrim(p_private ->> 'normalized_address'), ''), v_lat, v_lng, v_keys, nullif(btrim(p_private ->> 'label'), ''))
  returning context_id into v_id;

  insert into public.report_private_context_need (context_id, kind, ref) values (v_id, p_need_kind, p_need_ref);
  insert into public.report_private_context_event (context_id, kind) values (v_id, 'created');
  insert into public.report_private_context_event (context_id, kind, need_kind) values (v_id, 'need_opened', p_need_kind);
  return v_id;
end $$;

-- a need opens (a report is issued, a property is followed, an account relationship begins)
create or replace function public.report_private_context_need_open(p_context uuid, p_kind text, p_ref text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.report_private_context%rowtype;
begin
  select * into c from public.report_private_context where context_id = p_context for update;
  if not found then
    raise exception 'report_private_context: no such context' using errcode = '23503';
  end if;
  if c.state = 'purged' then
    raise exception 'report_private_context: the context was purged and cannot be reopened' using errcode = '55000';
  end if;
  if exists (select 1 from public.report_private_context_need where context_id = p_context and kind = p_kind and ref = p_ref and closed_at is null) then
    return;                                  -- already open: idempotent
  end if;
  insert into public.report_private_context_need (context_id, kind, ref) values (p_context, p_kind, p_ref);
  insert into public.report_private_context_event (context_id, kind, need_kind) values (p_context, 'need_opened', p_kind);
  if c.purge_due_at is not null then
    insert into public.report_private_context_event (context_id, kind) values (p_context, 'grace_cleared');
  end if;
  update public.report_private_context set last_needed_at = now(), purge_due_at = null where context_id = p_context;
end $$;

-- a need closes; when the LAST one closes the 90-day clock starts
create or replace function public.report_private_context_need_close(p_context uuid, p_kind text, p_ref text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.report_private_context%rowtype; v_closed integer;
begin
  select * into c from public.report_private_context where context_id = p_context for update;
  if not found then
    raise exception 'report_private_context: no such context' using errcode = '23503';
  end if;
  if c.state = 'purged' then
    return;                                  -- nothing left to close
  end if;
  update public.report_private_context_need set closed_at = now()
   where context_id = p_context and kind = p_kind and ref = p_ref and closed_at is null;
  get diagnostics v_closed = row_count;
  if v_closed = 0 then
    return;                                  -- not open: idempotent, and it never starts a clock by itself
  end if;
  insert into public.report_private_context_event (context_id, kind, need_kind) values (p_context, 'need_closed', p_kind);
  if not exists (select 1 from public.report_private_context_need where context_id = p_context and closed_at is null) then
    update public.report_private_context
       set last_needed_at = now(), purge_due_at = now() + public.report_private_context_grace()
     where context_id = p_context;
    insert into public.report_private_context_event (context_id, kind) values (p_context, 'grace_started');
  end if;
end $$;

-- the values, for rendering. A purged context returns its state and nothing else.
create or replace function public.report_private_context_read(p_context uuid)
returns table (state text, address text, normalized_address text, latitude numeric, longitude numeric,
               property_keys text[], label text, purge_due_at timestamptz, purged_at timestamptz, purge_reason text)
language sql security definer set search_path = public, pg_temp
as $$
  select c.state, c.address, c.normalized_address, c.latitude, c.longitude, c.property_keys, c.label,
         c.purge_due_at, c.purged_at, c.purge_reason
    from public.report_private_context c where c.context_id = p_context
$$;

-- purge: 'retention_expired' only once the clock has run out and nothing needs the context;
-- 'verified_privacy_request' and 'legal_requirement' purge at once and override the grace period.
create or replace function public.report_private_context_purge(p_context uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.report_private_context%rowtype;
begin
  if p_reason is null or p_reason not in ('retention_expired', 'verified_privacy_request', 'legal_requirement') then
    raise exception 'report_private_context: unknown purge reason' using errcode = '22023';
  end if;
  select * into c from public.report_private_context where context_id = p_context for update;
  if not found then
    raise exception 'report_private_context: no such context' using errcode = '23503';
  end if;
  if c.state = 'purged' then
    return false;                            -- already purged: idempotent, and it writes nothing more
  end if;
  if p_reason = 'retention_expired'
     and (c.purge_due_at is null or c.purge_due_at > now()
          or exists (select 1 from public.report_private_context_need where context_id = p_context and closed_at is null)) then
    raise exception 'report_private_context: the retention period has not expired' using errcode = '55000';
  end if;
  with closed as (
    update public.report_private_context_need set closed_at = now()
     where context_id = p_context and closed_at is null returning kind, opened_at)
  insert into public.report_private_context_event (context_id, kind, need_kind)
    select p_context, 'need_closed', kind from closed order by opened_at, kind;
  update public.report_private_context
     set state = 'purged', address = null, normalized_address = null, latitude = null, longitude = null,
         property_keys = null, label = null, purge_due_at = null, purged_at = now(), purge_reason = p_reason
   where context_id = p_context;
  insert into public.report_private_context_event (context_id, kind, reason) values (p_context, 'purged', p_reason);
  return true;
end $$;

-- the batch a scheduler would call. Returns how many contexts it purged. Not scheduled here.
create or replace function public.report_private_context_purge_due()
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; n integer := 0;
begin
  for r in select context_id from public.report_private_context
            where state = 'active' and purge_due_at is not null and purge_due_at <= now() order by purge_due_at loop
    begin
      if public.report_private_context_purge(r.context_id, 'retention_expired') then n := n + 1; end if;
    exception when sqlstate '55000' then
      null;                                  -- a need was reopened between the scan and the purge: leave it
    end;
  end loop;
  return n;
end $$;

-- the audit: every invariant as a count that must be zero, beside a control that must not be
create or replace function public.report_private_context_retention_check()
returns table (check_name text, kind text, violations bigint)
language sql security definer set search_path = public, pg_temp
as $$
  select 'contexts_total'::text, 'control'::text, count(*) from public.report_private_context
  union all select 'active_without_a_need_or_a_clock', 'invariant', count(*) from public.report_private_context c
    where c.state = 'active' and c.purge_due_at is null
      and not exists (select 1 from public.report_private_context_need n where n.context_id = c.context_id and n.closed_at is null)
  union all select 'a_clock_running_while_a_need_is_open', 'invariant', count(*) from public.report_private_context c
    where c.purge_due_at is not null
      and exists (select 1 from public.report_private_context_need n where n.context_id = c.context_id and n.closed_at is null)
  union all select 'a_clock_beyond_the_grace_period', 'invariant', count(*) from public.report_private_context c
    where c.purge_due_at > c.last_needed_at + public.report_private_context_grace()
  union all select 'purged_but_still_holding_a_private_value', 'invariant', count(*) from public.report_private_context c
    where c.state = 'purged' and (c.address is not null or c.normalized_address is not null or c.latitude is not null
          or c.longitude is not null or c.property_keys is not null or c.label is not null)
  union all select 'purged_without_a_purge_event', 'invariant', count(*) from public.report_private_context c
    where c.state = 'purged' and not exists (select 1 from public.report_private_context_event e where e.context_id = c.context_id and e.kind = 'purged')
  union all select 'purged_with_a_need_still_open', 'invariant', count(*) from public.report_private_context c
    where c.state = 'purged' and exists (select 1 from public.report_private_context_need n where n.context_id = c.context_id and n.closed_at is null)
  union all select 'clock_expired_but_not_yet_purged', 'lag', count(*) from public.report_private_context c
    where c.state = 'active' and c.purge_due_at is not null and c.purge_due_at <= now()
$$;

-- ---- 7. LOCK-DOWN: system-only --------------------------------------------------------
-- Supabase's default privileges grant every new table and function in `public` to anon and
-- authenticated (and everything to service_role). Revoke by name, enable RLS with no policy (deny
-- by default), then grant back exactly what the consumers need.
alter table public.report_private_context       enable row level security;
alter table public.report_private_context_need  enable row level security;
alter table public.report_private_context_event enable row level security;
revoke all on public.report_private_context        from public, anon, authenticated, service_role;
revoke all on public.report_private_context_need   from public, anon, authenticated, service_role;
revoke all on public.report_private_context_event from public, anon, authenticated, service_role;
grant select on public.report_private_context_need  to service_role;
grant select on public.report_private_context_event to service_role;

-- Every report_private_context_ function, computed rather than typed (a list typed here would
-- silently stop covering the next function added).
do $lock$
declare f record;
begin
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'report\_private\_context\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $lock$;

-- ROLLBACK (this file only). Rolling back DELETES private contexts and their audit trail, and
-- docs/report-snapshot.sql must be rolled back FIRST (its foreign key points here):
--   drop function if exists public.report_private_context_retention_check(), public.report_private_context_purge_due(),
--     public.report_private_context_purge(uuid, text), public.report_private_context_read(uuid),
--     public.report_private_context_need_close(uuid, text, text), public.report_private_context_need_open(uuid, text, text),
--     public.report_private_context_create(jsonb, text, text) cascade;
--   drop table if exists public.report_private_context_event, public.report_private_context_need, public.report_private_context;
--   drop function if exists public.report_private_context_guard(), public.report_private_context_need_guard(),
--     public.report_private_context_event_immutable(), public.report_private_context_grace();

-- ============================================================================
-- REPORT SHARE LINKS — THE PRIMITIVE  (Development Activity plan, Order J, unit J1 — 2026-10-02)
-- SQL OF RECORD. Two tables, one guard, three functions. NO caller, NO endpoint, NO page: this is the database
-- primitive a later read-only client view will stand on, landed the way Order F landed the snapshot. NOT APPLIED to
-- production by this file's own merge; applying it is a separate step with its own go (docs/report-snapshot-contract-2026-09-30.md §8.7).
--
-- WHAT IT IS
--   An opaque, revocable, optionally expiring link to ONE stored report. Plan Step 7: "Commercial share links must
--   use an opaque share/report token, not raw address/ZIP/radius query parameters ... support revocation ... support
--   optional expiry." A link is a random 256-bit token that exists only in the URL its owner hands out. THIS DATABASE
--   NEVER SEES THE TOKEN: the caller hashes it (SHA-256, supabase/functions/_shared/report-share.ts) and sends the hash.
--   So a read of these tables yields no usable link, and a link that is lost cannot be recovered — it is revoked and
--   reissued. A raw token cannot be stored by mistake either: a token is 43 characters and the hash column accepts
--   only 64 lower-case hex digits.
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   stored report: public.report_snapshot (immutable, permanent, address-free)
--     -> THIS FILE: public.report_share (token hash, optional expiry, revocation, one row per link)
--        + public.report_share_resolve, the ONE decision on whether a link is usable
--     -> a later read-only client view (J2) that opens the snapshot BODY and nothing else.
--   Decision owners, none duplicated here:
--     what the report IS ............ public.report_snapshot. This file stores a reference to it and never reads it.
--     whether a link is usable ...... public.report_share_resolve. Nothing else decides ACTIVE / EXPIRED / REVOKED / UNKNOWN.
--     the share's identity .......... the writer (gen_random_uuid() inside report_share_create). The column has no default
--                                     and the writer has no argument for it, so no caller chooses a share_id.
--     what the token hash looks like . this table's CHECK. A function does not repeat it.
--     what an expiry may be ......... this table's CHECK (strictly after the share was created). A function does not repeat it.
--     what is private, and for how long: the private layer (docs/report-private-context.sql). This file does not name it,
--                                     read it, open a need on it or start a clock on it.
--     who may share or revoke ....... NOT HERE. service_role only, and nothing calls it. The admin gate now, an
--                                     entitlement (Orders K and L) later, in the caller. There is no owner column.
--
-- RULES THIS ENCODES (each pinned by test/report_share_pg and test/report-share-structure.test.mjs)
--   1. The token is never stored. The table has a token HASH and no token column.
--   2. A hash is unique: two links can never resolve to the same share.
--   3. A share is created ACTIVE. It becomes EXPIRED by the clock alone (nothing writes when an expiry passes: expiry
--      is computed at read time, so there is no job that could fail to run), and REVOKED by one explicit call.
--   4. REVOKED beats EXPIRED. A link that was revoked and then also lapsed reads REVOKED, not EXPIRED.
--   5. An expiry can never be extended, shortened or cleared, and a revoke can never be undone: the one update the
--      table allows is revoked_at from null to a time, with every other column unchanged (guard trigger). A share is
--      never deleted and the table is never truncated. Events are append-only.
--   6. report_share_resolve returns a status and, ONLY when the status is ACTIVE, the report_id. It returns no body, no
--      private-context handle, no address, no share_id and no timestamp, and it writes nothing.
--   7. A share outlives the report's private context. Creating one does not need an active context, and a purge of the
--      context (a verified privacy request, the 90-day clock) leaves every share resolving ACTIVE to the same address-free
--      body. Creating or revoking a share changes no row of the snapshot and nothing in the private layer.
--   8. The audit log has two event kinds, created and revoked, and no other column that could hold text: no actor, no label,
--      no IP address, no user agent, no referrer. Nothing here records that a link was OPENED (a privacy question that is
--      not settled; docs/report-snapshot-contract-2026-09-30.md §8.6).
--   9. Nothing here is readable or writable by anon or authenticated. service_role may SELECT and may EXECUTE the three
--      functions; it cannot INSERT, UPDATE or DELETE directly, so every share goes through them.
--
-- WHAT THIS DOES NOT DECIDE (recorded, not solved)
--   * Whose share it is. There is no account, brokerage or entitlement table (Orders K and L), so there is no owner column;
--     it is added, additively, with that unit. Until then any service_role caller could share any report_id, which is
--     acceptable ONLY because nothing calls this.
--   * A default expiry. The function takes an optional one and applies none.
--   * What a client sees, how a link is shaped as a URL, rate limiting, replay control, branding, disclosure, print/PDF.
--   * Retries. Creating twice with the same hash is refused (23505); the caller mints a new token.
--
-- ADDITIVE ONLY. Creates two tables and their functions; alters nothing that exists. Idempotent: safe to run twice.
-- ROLLBACK is at the foot of this file.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------
do $pre$
begin
  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'report_share: gen_random_uuid() is not available';
  end if;
  if to_regclass('public.report_snapshot') is null then
    raise exception 'report_share: apply docs/report-snapshot.sql first (a share points at a stored report)';
  end if;
end $pre$;

-- ---- 1. THE SHARE ------------------------------------------------------------------
create table if not exists public.report_share (
  share_id     uuid        primary key,
  report_id    uuid        not null,
  token_sha256 text        not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  constraint report_share_report_fk             foreign key (report_id) references public.report_snapshot (report_id),
  constraint report_share_hash_shape            check (token_sha256 ~ '^[0-9a-f]{64}$'),
  constraint report_share_hash_unique           unique (token_sha256),
  constraint report_share_expiry_after_creation check (expires_at is null or expires_at > created_at)
);

-- ---- 2. THE AUDIT LOG (append-only; two kinds; no column that could hold text) -----------
create table if not exists public.report_share_event (
  event_id bigint      generated always as identity primary key,
  share_id uuid        not null,
  kind     text        not null,
  at       timestamptz not null default now(),
  constraint report_share_event_share_fk foreign key (share_id) references public.report_share (share_id),
  constraint report_share_event_kind     check (kind in ('created', 'revoked'))
);
create index if not exists report_share_event_by_share
  on public.report_share_event (share_id, event_id);

-- ---- 3. GUARDS ----------------------------------------------------------------------------
-- A share may be REVOKED, once, and nothing else about it may ever change: not the report, not the hash, not the
-- creation time, and above all not the expiry (an expiry that could be extended or cleared is not an expiry). It is
-- never deleted. The same function stops TRUNCATE (statement-level, so it is reached for tg_op = 'TRUNCATE').
create or replace function public.report_share_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.revoked_at is null and new.revoked_at is not null
       and new.share_id = old.share_id and new.report_id = old.report_id
       and new.token_sha256 = old.token_sha256 and new.created_at = old.created_at
       and new.expires_at is not distinct from old.expires_at then
      return new;
    end if;
  end if;
  raise exception 'report_share may only be revoked, once (% refused)', tg_op;
end $$;

create or replace function public.report_share_event_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'report_share_event is append-only (% refused)', tg_op;
end $$;

create or replace trigger report_share_only_revoke
  before update or delete on public.report_share
  for each row execute function public.report_share_guard();
create or replace trigger report_share_no_truncate
  before truncate on public.report_share
  for each statement execute function public.report_share_guard();
create or replace trigger report_share_event_no_change
  before update or delete on public.report_share_event
  for each row execute function public.report_share_event_immutable();
create or replace trigger report_share_event_no_truncate
  before truncate on public.report_share_event
  for each statement execute function public.report_share_event_immutable();

-- ---- 4. THE THREE FUNCTIONS (the only way in, and the only way to ask) ---------------------------
-- create: one share for one stored report. The hash and the expiry are validated by the table, once. An unknown report
-- is refused by the foreign key (23503). The share and its 'created' event are written in one transaction.
create or replace function public.report_share_create(p_report uuid, p_token_sha256 text, p_expires_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.report_share (share_id, report_id, token_sha256, expires_at)
  values (v_id, p_report, p_token_sha256, p_expires_at);
  insert into public.report_share_event (share_id, kind) values (v_id, 'created');
  return v_id;
end $$;

-- revoke: true when THIS call revoked the share, false when it was already revoked (idempotent: no second event, the
-- first revoked_at stands). A share that does not exist is an ERROR, not a quiet false: a revoke that silently did
-- nothing would leave a live link believed dead. The row is locked, so two concurrent revokes write one event.
create or replace function public.report_share_revoke(p_share uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  s public.report_share%rowtype;
begin
  select * into s from public.report_share where share_id = p_share for update;
  if not found then
    raise exception 'report_share: no such share' using errcode = '23503';
  end if;
  if s.revoked_at is not null then
    return false;
  end if;
  update public.report_share set revoked_at = now() where share_id = p_share;
  insert into public.report_share_event (share_id, kind) values (p_share, 'revoked');
  return true;
end $$;

-- resolve: the ONE decision on whether a link is usable. Takes the token's HASH. Always returns exactly one row.
-- Revoked is checked before expired (rule 4); an expiry that has been reached (expires_at <= now()) is EXPIRED.
-- The report_id is returned only for ACTIVE: a dead or unknown link gets no handle on any report.
create or replace function public.report_share_resolve(p_token_sha256 text)
returns table (status text, report_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  s public.report_share%rowtype;
begin
  select * into s from public.report_share where token_sha256 = p_token_sha256;
  if not found then
    return query select 'UNKNOWN'::text, null::uuid;
  elsif s.revoked_at is not null then
    return query select 'REVOKED'::text, null::uuid;
  elsif s.expires_at is not null and s.expires_at <= now() then
    return query select 'EXPIRED'::text, null::uuid;
  else
    return query select 'ACTIVE'::text, s.report_id;
  end if;
end $$;

-- ---- 5. LOCK-DOWN: system-only --------------------------------------------------------------
-- Supabase's default privileges grant every new table and function in `public` to anon and authenticated (and
-- everything to service_role). Revoke by name, enable RLS with no policy (deny by default), then grant back exactly what
-- the consumers need: SELECT on the two tables, and EXECUTE on the functions.
alter table public.report_share       enable row level security;
alter table public.report_share_event enable row level security;
revoke all on public.report_share       from public, anon, authenticated, service_role;
revoke all on public.report_share_event from public, anon, authenticated, service_role;
grant select on public.report_share       to service_role;
grant select on public.report_share_event to service_role;

-- Every report_share_ function, computed rather than typed (a list typed here would silently stop covering the next
-- function added). The report_snapshot_ and report_private_context_ loops do not match this prefix, so this file carries
-- its own.
do $lock$
declare f record;
begin
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'report\_share\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $lock$;

-- ROLLBACK (this file only; each line between the markers is a statement once the leading "-- " is removed). Rolling
-- back DELETES every share and its audit rows, and every link ever issued stops working, so it is only appropriate
-- before the first real share is created. It touches nothing of the snapshot or the private layer, which this file
-- never altered. test/report_share_pg proves the round trip.
-- ROLLBACK-BEGIN
-- drop function if exists public.report_share_resolve(text), public.report_share_revoke(uuid),
--   public.report_share_create(uuid, text, timestamptz);
-- drop table if exists public.report_share_event, public.report_share;
-- drop function if exists public.report_share_guard(), public.report_share_event_immutable();
-- ROLLBACK-END

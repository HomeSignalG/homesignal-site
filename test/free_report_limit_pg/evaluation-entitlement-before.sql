-- ============================================================================
-- EVALUATION ENTITLEMENT  (Development Activity plan, Order L1 — 2026-10-02)
-- SQL OF RECORD. PARKED: NOT APPLIED to production. New schema in production needs its own founder go, and
-- docs/brokerage-account-spine.sql (Order K0) must be applied first: this file hangs off it.
-- The database layer of the 20-report brokerage evaluation, built DARK: nothing calls it, no function is deployed,
-- no page, schedule or edge function changed, and no report is stored.
--
-- WHAT IT IS
--   public.evaluation          the entitlement: ONE row per brokerage account (it REFERENCES public.brokerage_account,
--                              the one account spine; it is not a second account or member table).
--   public.evaluation_invite   a one-time, expiring invite. Only the SHA-256 of the token is stored.
--   public.evaluation_credit   the APPEND-ONLY credit ledger: one row per report issued, linking the report_id.
--   public.evaluation_event    an append-only log of the evaluation's lifecycle (no token, no address, no free text).
--   evaluation_create          makes the brokerage account, the evaluation and its first OWNER invite in ONE transaction
--                              (K0 asked for the account and its first owner to be created together). Token returned once.
--   evaluation_invite_mint     mints another invite. Admin/system (p_actor null) or an active OWNER of that very brokerage
--                              (p_actor = their user id), who may invite agents only. Token returned once.
--   evaluation_invite_redeem   binds an invite to a Supabase Auth user id and creates the membership row in
--                              public.brokerage_member (K0 left that table with no writer; this is the writer).
--   evaluation_invite_revoke / evaluation_revoke   end an open invite / the whole evaluation.
--   evaluation_report_issue    THE credit: in ONE transaction it locks the evaluation, answers a retried key with the
--                              stored report (no charge), refuses report 21 with EVALUATION_COMPLETE, calls the existing
--                              public.report_snapshot_issue (the one snapshot and private-context writer), and appends the
--                              ledger row. Any refusal rolls everything back, so no credit is lost to a failure.
--   evaluation_usage           the one reader: status and credits used / remaining for a signed-in member's evaluation.
--   evaluation_check           invariants as counts that must be zero, beside controls.
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   Supabase Auth user -> public.brokerage_member (K0) -> the ONE resolver public.brokerage_membership_of -> THIS file's
--   evaluation_report_issue -> public.report_snapshot_issue -> public.report_snapshot (+ report_private_context).
--   Decision owners, none duplicated here:
--     who this person is, commercially ........ brokerage_membership_of (K0). This file reads it, never re-derives it,
--                                               and never matches an email or a domain.
--     whether a report may be stored .......... report_snapshot_issue and the private-context containment trigger (F, F2).
--     whether a credit is consumed ............ evaluation_report_issue (one credit per SUCCESSFUL call). Whether a
--                                               limited-coverage or thin report SHOULD be charged is open decision R5; the
--                                               future handler decides when to call this function, nothing here hard-codes it.
--     how many credits exist .................. evaluation_report_limit(), the one definition of the number 20.
--     paid state ................................ a later order (M) writes evaluation.status; public.subscriptions is the
--                                               map-paywall product and is not read here.
--
-- THE 20-REPORT CAP HOLDS BY CONSTRAINT AT ANY ISOLATION LEVEL, not by a lock and a count.
--   A row lock serialises concurrent writers only at READ COMMITTED; at REPEATABLE READ the waiter keeps its old snapshot and a
--   count taken from it is stale (measured on K0's owner guard: two sessions both passed and left zero owners). So the ledger
--   carries an ORDINAL: primary key (evaluation_id, ordinal) and CHECK (ordinal between 1 and evaluation_report_limit()). At
--   most 20 distinct ordinals exist per evaluation, so a 21st row cannot be inserted by ANY writer, in any transaction, at any
--   isolation level, including one that bypasses the functions. Likewise unique (evaluation_id, idempotency_key) and
--   unique (report_id). The status flips to 'complete' in a trigger on the 20th ledger row, so it cannot be skipped.
--   What remains lock-based is only the FRIENDLY behaviour (a retried key returns the stored report, the 21st call says
--   EVALUATION_COMPLETE, the next ordinal is contiguous, agent seats are counted, and an actor's membership is re-read after the
--   evaluation lock). evaluation_report_issue, evaluation_invite_redeem, evaluation_invite_mint and evaluation_invite_revoke
--   therefore REFUSE any transaction that is not READ COMMITTED (errcode 55000) instead of
--   relying on a lock whose effect depends on the level. The default for PostgREST and the migration role is READ COMMITTED.
--
-- WHAT IT DELIBERATELY DOES NOT HOLD (CLAUDE.md "Permanent historical intelligence", founder decision 2026-09-29)
--   No street address, address hash, property key, coordinates, report label, client name, email, domain, ip address or free
--   text in any of the four tables: the private context lives only in report_private_context, reached through
--   report_snapshot_issue, and this file never names that table. Nor a user id in the append-only ledger or event log: who
--   issued a report is Order J's ownership row (deletable with the account); retaining an agent identity in a permanent trail is
--   an open founder question (audit K, decision 5), so the conservative default is to store none. The one user id kept is
--   evaluation_invite.redeemed_by, which is NOT append-only and is cleared (ON DELETE SET NULL) when the person's account is
--   deleted, so an account deletion or a privacy request is never blocked by this layer (K0, D-K4). Used credits are the COUNT
--   of ledger rows: there is no mutable counter column anywhere.
--
-- DEFAULTS TAKEN (the founder may change any of them; nothing here hard-codes an open decision)
--   D-L1  invite-only: no self-serve signup path exists. Open signup means an account proves only an email.
--   D-L2  seat limit is evaluation.seat_limit, NULL = no limit. No number is chosen. It is enforced at redeem.
--   D-L3  evaluation expiry is evaluation.expires_at, NULL = none (the default). Set only at creation.
--   D-L4  an invite lives 14 days by default (parameter, at most 90): a bearer credential should not live forever.
--   D-L5  one credit per successful evaluation_report_issue call. R5 (does a limited-coverage report cost a credit, and at
--         what threshold) is open; the caller decides when to call.
--   D-L6  the idempotency key is a caller-chosen random UUID bound to the EVALUATION only, never to the request content,
--         because hashing an address into the ledger would store an identifier that resolves to one address. A retry with the
--         same key and a DIFFERENT address returns the FIRST report; the handler must detect that mismatch from the private
--         context while it is active.
--   D-L7  an evaluation is a state: active -> complete (the 20th credit) | revoked; complete -> revoked; revoked is terminal.
--         Order M adds the paid transition deliberately (it amends evaluation_guard); a paid continuation is not decided here.
--   D-L8  an owner may mint AGENT invites only. Another owner is minted by the admin (p_actor null).
--
-- ERRORS (message, SQLSTATE) — the handler maps on the message
--   INVITE_UNUSABLE EV001   an unknown, malformed, expired, revoked or already-redeemed invite: ONE generic refusal.
--   EVALUATION_COMPLETE EV002   all 20 credits are used (a retried key still returns its report).
--   NOT_ENTITLED EV003      not a member, a removed member, another brokerage, a revoked, expired or suspended evaluation.
--   ALREADY_A_MEMBER EV004  the person already has an ACTIVE membership somewhere (K0: one per user, so no second pool).
--   SEAT_LIMIT_REACHED EV005   the evaluation's agent seats are full.
--   IDEMPOTENCY_KEY_REQUIRED 22023   no key was given.
--
-- ACCESS: system-only, the K0 posture. RLS on, NO policy, every privilege on the four tables revoked from public, anon,
-- authenticated AND service_role, and on the file's own sequence; every function is executable by service_role alone (trigger
-- functions by nobody). Every function that touches a table is SECURITY DEFINER with a pinned search_path.
-- THE GATE IS UNCHANGED: supabase/functions/_shared/admin-gate.ts still answers from public.dashboard_admins, and the shared
-- snapshot module still calls report_snapshot_issue directly. Making evaluation_report_issue the only caller path (and revoking
-- service_role's execute on the writer) changes a locked, applied layer and belongs to a later unit, with its own proof; this
-- unit pins structurally that no other caller exists.
--
-- ADDITIVE ONLY. Creates four tables, one explicit index (beside the keys), one sequence (the event identity), seven triggers and
-- thirteen functions; alters nothing that exists. Seeds nothing and arms no schedule. Idempotent: safe to run twice. ROLLBACK is
-- at the foot.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------------------------
do $pre$
begin
  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'evaluation_entitlement: gen_random_uuid() is not available';
  end if;
  if to_regprocedure('sha256(bytea)') is null then
    raise exception 'evaluation_entitlement: sha256(bytea) is not available (PostgreSQL 11 or later is required)';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'evaluation_entitlement: auth.users does not exist (Supabase Auth is the one identity system)';
  end if;
  if to_regclass('public.brokerage_account') is null or to_regclass('public.brokerage_member') is null
     or to_regprocedure('public.brokerage_membership_of(uuid)') is null then
    raise exception 'evaluation_entitlement: apply docs/brokerage-account-spine.sql first (the evaluation hangs off the one account spine)';
  end if;
  if to_regclass('public.report_snapshot') is null
     or to_regprocedure('public.report_snapshot_issue(text, text, text, jsonb, jsonb)') is null then
    raise exception 'evaluation_entitlement: apply docs/report-snapshot.sql first (the credit ledger links a stored report)';
  end if;
end $pre$;

-- ---- 1. THE ONE DEFINITION OF THE NUMBER OF FREE REPORTS ---------------------------------------------
create or replace function public.evaluation_report_limit() returns integer
language sql immutable as $$ select 20 $$;

-- ---- 2. THE EVALUATION -------------------------------------------------------------------------------
create table if not exists public.evaluation (
  evaluation_id uuid        primary key default gen_random_uuid(),
  brokerage_id  uuid        not null references public.brokerage_account (id),
  status        text        not null default 'active',
  seat_limit    integer,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  constraint evaluation_one_per_brokerage unique (brokerage_id),
  constraint evaluation_status            check (status in ('active', 'complete', 'revoked')),
  constraint evaluation_seat_limit        check (seat_limit is null or seat_limit >= 0),
  constraint evaluation_revoked           check ((status = 'revoked') = (revoked_at is not null)),
  constraint evaluation_expiry            check (expires_at is null or expires_at > created_at)
);

-- ---- 3. THE INVITE (only the hash of the token is ever stored) --------------------------------------------------
create table if not exists public.evaluation_invite (
  invite_id     uuid        primary key default gen_random_uuid(),
  evaluation_id uuid        not null references public.evaluation (evaluation_id),
  role          text        not null,
  token_hash    text        not null,
  status        text        not null default 'open',
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  redeemed_at   timestamptz,
  redeemed_by   uuid        references auth.users (id) on delete set null,
  revoked_at    timestamptz,
  constraint evaluation_invite_token_hash_unique unique (token_hash),
  constraint evaluation_invite_token_hash_shape  check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint evaluation_invite_role              check (role in ('owner', 'agent')),
  -- the status vocabulary (open | redeemed | revoked) AND what each status implies, in one rule
  constraint evaluation_invite_state             check (
       (status = 'open'     and redeemed_at is null and redeemed_by is null and revoked_at is null)
    or (status = 'redeemed' and redeemed_at is not null and revoked_at is null)
    or (status = 'revoked'  and revoked_at is not null and redeemed_at is null and redeemed_by is null)),
  constraint evaluation_invite_lifetime          check (expires_at > created_at and expires_at <= created_at + interval '90 days')
);

-- ---- 4. THE CREDIT LEDGER (append-only; the cap is a constraint) ---------------------------------------------------
create table if not exists public.evaluation_credit (
  evaluation_id   uuid        not null references public.evaluation (evaluation_id),
  ordinal         integer     not null,
  idempotency_key uuid        not null,
  report_id       uuid        not null references public.report_snapshot (report_id),
  issued_at       timestamptz not null default now(),
  constraint evaluation_credit_pkey          primary key (evaluation_id, ordinal),
  constraint evaluation_credit_ordinal       check (ordinal between 1 and public.evaluation_report_limit()),
  constraint evaluation_credit_key_unique    unique (evaluation_id, idempotency_key),
  constraint evaluation_credit_report_unique unique (report_id)
);

-- ---- 5. THE EVENT LOG (append-only; no free text, so no token and no address can be written to it) ------------------------
create table if not exists public.evaluation_event (
  event_id      bigint      generated always as identity primary key,
  evaluation_id uuid        not null references public.evaluation (evaluation_id),
  kind          text        not null,
  role          text,
  invite_id     uuid        references public.evaluation_invite (invite_id),
  at            timestamptz not null default now(),
  constraint evaluation_event_kind   check (kind in ('created', 'invite_minted', 'invite_redeemed', 'invite_revoked', 'completed', 'revoked')),
  constraint evaluation_event_role   check (role is null or role in ('owner', 'agent')),
  constraint evaluation_event_invite  check ((kind in ('invite_minted', 'invite_redeemed', 'invite_revoked')) = (invite_id is not null))
);
create index if not exists evaluation_event_by_evaluation on public.evaluation_event (evaluation_id, event_id);

-- ---- 6. GUARDS --------------------------------------------------------------------------------------------------------
-- The ledger and the log are append-only: no update, delete or truncate, for any role including the owner. (There is no truncate
-- trigger on evaluation or evaluation_invite: PostgreSQL refuses a plain TRUNCATE of a referenced table, and TRUNCATE ... CASCADE
-- reaches the ledger and the log, whose triggers refuse it.)
create or replace function public.evaluation_append_only() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  raise exception '% is append-only (% refused)', tg_table_name, tg_op using errcode = '55000';
end $$;

-- An evaluation is a state machine and is never deleted. Identity never changes. 'complete' is only reachable with a full ledger.
create or replace function public.evaluation_guard() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'evaluation: an evaluation is never deleted (revoke it)' using errcode = '55000';
  end if;
  if new.evaluation_id <> old.evaluation_id or new.brokerage_id <> old.brokerage_id or new.created_at <> old.created_at then
    raise exception 'evaluation: identity columns cannot change' using errcode = '55000';
  end if;
  if new.status <> old.status then
    if old.status = 'revoked' then
      raise exception 'evaluation: a revoked evaluation is terminal' using errcode = '55000';
    end if;
    if old.status = 'complete' and new.status <> 'revoked' then
      raise exception 'evaluation: a complete evaluation can only be revoked' using errcode = '55000';
    end if;
    if new.status = 'complete'
       and (select count(*) from public.evaluation_credit c where c.evaluation_id = old.evaluation_id) < public.evaluation_report_limit() then
      raise exception 'evaluation: complete means every credit is used' using errcode = '55000';
    end if;
    if new.status = 'revoked' then
      new.revoked_at := now();                    -- stamped here, never taken from the caller
    end if;
  end if;
  return new;
end $$;

-- An invite is open, then redeemed or revoked, and either is terminal. Its identity, role, token hash and lifetime never change;
-- the transition times are stamped by the database. The one other change allowed is the foreign key's own action clearing
-- redeemed_by when the redeemer's account is deleted. An expired invite cannot be redeemed, by any writer.
create or replace function public.evaluation_invite_guard() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'evaluation_invite: an invite is never deleted (revoke it)' using errcode = '55000';
  end if;
  if new.invite_id <> old.invite_id or new.evaluation_id <> old.evaluation_id or new.role <> old.role
     or new.token_hash <> old.token_hash or new.created_at <> old.created_at or new.expires_at <> old.expires_at then
    raise exception 'evaluation_invite: identity, role, token hash and lifetime cannot change' using errcode = '55000';
  end if;
  if old.status <> 'open' then
    if old.status = 'redeemed' and new.status = 'redeemed' and old.redeemed_by is not null and new.redeemed_by is null
       and new.redeemed_at is not distinct from old.redeemed_at and new.revoked_at is not distinct from old.revoked_at then
      return new;                                 -- the redeemer's account was deleted
    end if;
    raise exception 'evaluation_invite: a redeemed or revoked invite is terminal' using errcode = '55000';
  end if;
  if new.status = 'redeemed' then
    if old.expires_at <= now() then
      raise exception 'evaluation_invite: an expired invite cannot be redeemed' using errcode = '55000';
    end if;
    new.redeemed_at := now();                     -- stamped here, never taken from the caller
  elsif new.status = 'revoked' then
    new.revoked_at := now();
  end if;
  return new;
end $$;

-- The status flips to 'complete' on the ledger row that uses the last credit, whoever wrote it: the flip cannot be skipped.
create or replace function public.evaluation_credit_after_insert() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.ordinal = public.evaluation_report_limit() then
    update public.evaluation e set status = 'complete' where e.evaluation_id = new.evaluation_id and e.status = 'active';
    if found then
      insert into public.evaluation_event (evaluation_id, kind) values (new.evaluation_id, 'completed');
    end if;
  end if;
  return null;
end $$;

create or replace trigger evaluation_guard_trg
  before update or delete on public.evaluation
  for each row execute function public.evaluation_guard();
create or replace trigger evaluation_invite_guard_trg
  before update or delete on public.evaluation_invite
  for each row execute function public.evaluation_invite_guard();
create or replace trigger evaluation_credit_append_only
  before update or delete on public.evaluation_credit
  for each row execute function public.evaluation_append_only();
create or replace trigger evaluation_credit_no_truncate
  before truncate on public.evaluation_credit
  for each statement execute function public.evaluation_append_only();
create or replace trigger evaluation_event_append_only
  before update or delete on public.evaluation_event
  for each row execute function public.evaluation_append_only();
create or replace trigger evaluation_event_no_truncate
  before truncate on public.evaluation_event
  for each statement execute function public.evaluation_append_only();
create or replace trigger evaluation_credit_complete_trg
  after insert on public.evaluation_credit
  for each row execute function public.evaluation_credit_after_insert();

-- ---- 7. MINT AN INVITE ---------------------------------------------------------------------------------------------------
-- The token is 'hse1_' and 64 hex characters from two gen_random_uuid() values (244 random bits; no extension is needed). It is
-- returned HERE, ONCE; only its SHA-256 is stored, and no function returns the hash. p_actor null is the admin/system path (any
-- role); an actor must be an active OWNER of this very brokerage and may invite agents only (D-L8).
create or replace function public.evaluation_invite_mint(
  p_evaluation_id uuid,
  p_role          text,
  p_actor         uuid     default null,
  p_ttl           interval default interval '14 days'
) returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  ev      public.evaluation%rowtype;
  v_actor record;
  v_token text;
  v_id    uuid;
  v_exp   timestamptz;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'evaluation_invite_mint: needs READ COMMITTED (the membership of the actor is re-read after a row lock that refreshes what the check sees only there; this transaction is at %)',
      current_setting('transaction_isolation') using errcode = '55000';
  end if;
  if p_role is null or p_role not in ('owner', 'agent') then
    raise exception 'evaluation_invite_mint: the role must be owner or agent' using errcode = '22023';
  end if;
  if p_ttl is null or p_ttl <= interval '0' or p_ttl > interval '90 days' then
    raise exception 'evaluation_invite_mint: the lifetime must be positive and at most 90 days' using errcode = '22023';
  end if;
  select e.* into ev from public.evaluation e where e.evaluation_id = p_evaluation_id for update;
  if not found or ev.status = 'revoked' or (ev.expires_at is not null and ev.expires_at <= now())
     or not exists (select 1 from public.brokerage_account a where a.id = ev.brokerage_id and a.status = 'active') then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  if p_actor is not null then
    select r.* into v_actor from public.brokerage_membership_of(p_actor) r;
    if not found or v_actor.brokerage_id <> ev.brokerage_id or v_actor.role <> 'owner' or p_role <> 'agent' then
      raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
    end if;
  end if;
  v_token := 'hse1_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_exp   := now() + p_ttl;
  insert into public.evaluation_invite (evaluation_id, role, token_hash, expires_at)
  values (ev.evaluation_id, p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_exp)
  returning evaluation_invite.invite_id into v_id;
  insert into public.evaluation_event (evaluation_id, kind, role, invite_id) values (ev.evaluation_id, 'invite_minted', p_role, v_id);
  return query select v_id, v_token, v_exp;
end $$;

-- ---- 8. CREATE AN EVALUATION: the account, the evaluation and the first owner invite, in ONE transaction ----------------------
create or replace function public.evaluation_create(
  p_brokerage_name text,
  p_seat_limit     integer     default null,
  p_expires_at     timestamptz default null,
  p_invite_ttl     interval    default interval '14 days'
) returns table (evaluation_id uuid, brokerage_id uuid, invite_id uuid, owner_token text, invite_expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_brokerage uuid;
  v_eval      uuid;
  v_invite    record;
begin
  insert into public.brokerage_account (name) values (p_brokerage_name) returning brokerage_account.id into v_brokerage;
  insert into public.evaluation (brokerage_id, seat_limit, expires_at) values (v_brokerage, p_seat_limit, p_expires_at)
    returning evaluation.evaluation_id into v_eval;
  insert into public.evaluation_event (evaluation_id, kind) values (v_eval, 'created');
  select m.* into v_invite from public.evaluation_invite_mint(v_eval, 'owner', null, p_invite_ttl) m;
  return query select v_eval, v_brokerage, v_invite.invite_id, v_invite.token, v_invite.expires_at;
end $$;

-- ---- 9. REDEEM AN INVITE ---------------------------------------------------------------------------------------------------
-- One-time, bound to an auth user id. The SAME user replaying it is idempotent (no second membership); anyone else is refused, as
-- are an unknown, malformed, expired or revoked token and an evaluation that is revoked, expired or whose brokerage is not active:
-- all ONE generic refusal. A person who already has an ACTIVE membership anywhere is refused (K0: one per user). Lock order is
-- always evaluation, then invite.
create or replace function public.evaluation_invite_redeem(p_token text, p_user_id uuid)
returns table (evaluation_id uuid, brokerage_id uuid, role text, replayed boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_hash   text;
  v_eval   uuid;
  v_usable boolean;
  v_seats  integer;
  ev       public.evaluation%rowtype;
  inv      public.evaluation_invite%rowtype;
  mem      public.brokerage_member%rowtype;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'evaluation_invite_redeem: needs READ COMMITTED (the seat count and one-time use are serialised on a row lock that refreshes what the check sees only there; this transaction is at %)',
      current_setting('transaction_isolation') using errcode = '55000';
  end if;
  if p_token is null or p_user_id is null or p_token !~ '^hse1_[0-9a-f]{64}$' then
    raise exception using errcode = 'EV001', message = 'INVITE_UNUSABLE';
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select i.evaluation_id into v_eval from public.evaluation_invite i where i.token_hash = v_hash;
  if not found then
    raise exception using errcode = 'EV001', message = 'INVITE_UNUSABLE';
  end if;
  select e.* into ev  from public.evaluation e        where e.evaluation_id = v_eval  for update;
  select i.* into inv from public.evaluation_invite i where i.token_hash = v_hash     for update;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception using errcode = 'EV001', message = 'INVITE_UNUSABLE';
  end if;
  v_usable := ev.status <> 'revoked' and (ev.expires_at is null or ev.expires_at > now())
              and exists (select 1 from public.brokerage_account a where a.id = ev.brokerage_id and a.status = 'active');
  if not v_usable then
    raise exception using errcode = 'EV001', message = 'INVITE_UNUSABLE';
  end if;
  if inv.status = 'redeemed' then
    if inv.redeemed_by is not distinct from p_user_id then
      select m.* into mem from public.brokerage_member m
       where m.user_id = p_user_id and m.brokerage_id = ev.brokerage_id and m.status = 'active';
      if found then
        return query select ev.evaluation_id, ev.brokerage_id, mem.role, true;
        return;
      end if;
    end if;
    raise exception using errcode = 'EV001', message = 'INVITE_UNUSABLE';
  end if;
  if inv.status <> 'open' or inv.expires_at <= now() then
    raise exception using errcode = 'EV001', message = 'INVITE_UNUSABLE';
  end if;
  if exists (select 1 from public.brokerage_member m where m.user_id = p_user_id and m.status = 'active') then
    raise exception using errcode = 'EV004', message = 'ALREADY_A_MEMBER';
  end if;
  if inv.role = 'agent' and ev.seat_limit is not null then
    select count(*) into v_seats from public.brokerage_member m
     where m.brokerage_id = ev.brokerage_id and m.role = 'agent' and m.status = 'active';
    if v_seats >= ev.seat_limit then
      raise exception using errcode = 'EV005', message = 'SEAT_LIMIT_REACHED';
    end if;
  end if;
  insert into public.brokerage_member (brokerage_id, user_id, role) values (ev.brokerage_id, p_user_id, inv.role);
  update public.evaluation_invite i set status = 'redeemed', redeemed_by = p_user_id where i.invite_id = inv.invite_id;
  insert into public.evaluation_event (evaluation_id, kind, role, invite_id) values (ev.evaluation_id, 'invite_redeemed', inv.role, inv.invite_id);
  return query select ev.evaluation_id, ev.brokerage_id, inv.role, false;
end $$;

-- ---- 10. REVOKE AN INVITE / AN EVALUATION --------------------------------------------------------------------------------------
-- true when THIS call revoked an open invite; false when there was nothing to revoke (already revoked or redeemed: a membership is
-- ended by its own act, not here). p_actor null is admin/system; otherwise an active owner of that invite's brokerage.
create or replace function public.evaluation_invite_revoke(p_invite_id uuid, p_actor uuid default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  inv     public.evaluation_invite%rowtype;
  ev      public.evaluation%rowtype;
  v_actor record;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'evaluation_invite_revoke: needs READ COMMITTED (the membership of the actor is re-read after a row lock that refreshes what the check sees only there; this transaction is at %)',
      current_setting('transaction_isolation') using errcode = '55000';
  end if;
  select i.* into inv from public.evaluation_invite i where i.invite_id = p_invite_id;
  if not found then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  select e.* into ev  from public.evaluation e        where e.evaluation_id = inv.evaluation_id for update;
  select i.* into inv from public.evaluation_invite i where i.invite_id = p_invite_id           for update;
  if p_actor is not null then
    select r.* into v_actor from public.brokerage_membership_of(p_actor) r;
    if not found or v_actor.brokerage_id <> ev.brokerage_id or v_actor.role <> 'owner' then
      raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
    end if;
  end if;
  if inv.status <> 'open' then
    return false;
  end if;
  update public.evaluation_invite i set status = 'revoked' where i.invite_id = inv.invite_id;
  insert into public.evaluation_event (evaluation_id, kind, role, invite_id) values (ev.evaluation_id, 'invite_revoked', inv.role, inv.invite_id);
  return true;
end $$;

create or replace function public.evaluation_revoke(p_evaluation_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare ev public.evaluation%rowtype;
begin
  select e.* into ev from public.evaluation e where e.evaluation_id = p_evaluation_id for update;
  if not found then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  if ev.status = 'revoked' then
    return false;
  end if;
  update public.evaluation e set status = 'revoked' where e.evaluation_id = ev.evaluation_id;
  insert into public.evaluation_event (evaluation_id, kind) values (ev.evaluation_id, 'revoked');
  return true;
end $$;

-- ---- 11. ISSUE A REPORT: the credit ------------------------------------------------------------------------------------------
-- p_user_id is the Supabase Auth user id the edge function got from the VERIFIED token; this function trusts it exactly as the
-- existing writers trust their service_role caller. The body, hash, version, engine inputs and the optional private context are
-- passed straight to report_snapshot_issue, which owns every rule about them; nothing of the private context is read or kept here.
-- ORDER: entitlement (the resolver, again after the lock) -> replay (same key = the stored report, no charge) -> EVALUATION_COMPLETE
-- -> snapshot -> ledger row. The snapshot call is BEFORE the ledger row and in the SAME transaction: a refusal by the snapshot (its
-- containment trigger, a bad hash) raises out of this function, and PostgreSQL rolls back everything, so a failure costs no credit.
-- A retried key is NOT re-checked against the content (D-L6).
create or replace function public.evaluation_report_issue(
  p_user_id         uuid,
  p_idempotency_key uuid,
  p_body            text,
  p_content_hash    text,
  p_report_version  text,
  p_engine_inputs   jsonb,
  p_private         jsonb default null
) returns table (report_id uuid, generated_at timestamptz, private_context_id uuid, replayed boolean,
                 credit_ordinal integer, credits_used integer, credits_remaining integer, evaluation_status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  m       record;
  ev      public.evaluation%rowtype;
  v_prior record;
  v_snap  record;
  v_used  integer;
  v_max   integer;
  v_ord   integer;
  v_state text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'evaluation_report_issue: needs READ COMMITTED (the retry and completion answers are serialised on a row lock that refreshes what the check sees only there; this transaction is at %)',
      current_setting('transaction_isolation') using errcode = '55000';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  select r.* into m from public.brokerage_membership_of(p_user_id) r;
  if not found then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  select e.* into ev from public.evaluation e where e.brokerage_id = m.brokerage_id for update;
  if not found then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  -- the lock may have waited: ask again, now that this transaction holds it
  select r.* into m from public.brokerage_membership_of(p_user_id) r where r.brokerage_id = ev.brokerage_id;
  if not found or ev.status = 'revoked' or (ev.expires_at is not null and ev.expires_at <= now()) then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  select c.ordinal, c.report_id into v_prior from public.evaluation_credit c
   where c.evaluation_id = ev.evaluation_id and c.idempotency_key = p_idempotency_key;
  if found then
    select count(*)::integer into v_used from public.evaluation_credit c where c.evaluation_id = ev.evaluation_id;
    return query
      select s.report_id, s.generated_at, s.private_context_id, true, v_prior.ordinal, v_used,
             public.evaluation_report_limit() - v_used, ev.status
        from public.report_snapshot s where s.report_id = v_prior.report_id;
    return;
  end if;
  select count(*)::integer, coalesce(max(c.ordinal), 0) into v_used, v_max from public.evaluation_credit c where c.evaluation_id = ev.evaluation_id;
  if ev.status <> 'active' or v_used >= public.evaluation_report_limit() then
    raise exception using errcode = 'EV002', message = 'EVALUATION_COMPLETE';
  end if;
  v_ord := v_max + 1;
  select s.* into v_snap from public.report_snapshot_issue(p_body, p_content_hash, p_report_version, p_engine_inputs, p_private) s;
  insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id)
  values (ev.evaluation_id, v_ord, p_idempotency_key, v_snap.report_id);
  select e.status into v_state from public.evaluation e where e.evaluation_id = ev.evaluation_id;
  return query select v_snap.report_id, v_snap.generated_at, v_snap.private_context_id, false, v_ord, v_used + 1,
                      public.evaluation_report_limit() - (v_used + 1), v_state;
end $$;

-- ---- 12. THE READER ---------------------------------------------------------------------------------------------------------
-- A member's evaluation: its status and credits used and remaining, DERIVED (the count of ledger rows). Nothing for a person with no
-- active membership of an active brokerage. This is what the workspace reads; it never re-derives a count.
create or replace function public.evaluation_usage(p_user_id uuid)
returns table (evaluation_id uuid, status text, credit_limit integer, credits_used integer, credits_remaining integer,
               expires_at timestamptz, expired boolean)
language sql stable security definer set search_path = public, pg_temp
as $$
  select e.evaluation_id, e.status, public.evaluation_report_limit(), u.n, public.evaluation_report_limit() - u.n,
         e.expires_at, (e.expires_at is not null and e.expires_at <= now())
    from public.brokerage_membership_of(p_user_id) r
    join public.evaluation e on e.brokerage_id = r.brokerage_id
    cross join lateral (select count(*)::integer as n from public.evaluation_credit c where c.evaluation_id = e.evaluation_id) u
$$;

-- ---- 13. THE AUDIT: every invariant as a count that must be zero, beside a control that must not be ----------------------------
create or replace function public.evaluation_check()
returns table (check_name text, kind text, violations bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select 'evaluations_total'::text, 'control'::text, count(*) from public.evaluation
  union all select 'credits_total', 'control', count(*) from public.evaluation_credit
  union all select 'complete_without_a_full_ledger', 'invariant', count(*) from public.evaluation e
    where e.status = 'complete'
      and (select count(*) from public.evaluation_credit c where c.evaluation_id = e.evaluation_id) <> public.evaluation_report_limit()
  union all select 'active_with_a_full_ledger', 'invariant', count(*) from public.evaluation e
    where e.status = 'active'
      and (select count(*) from public.evaluation_credit c where c.evaluation_id = e.evaluation_id) >= public.evaluation_report_limit()
  union all select 'ledger_with_gaps', 'invariant', count(*) from
    (select c.evaluation_id from public.evaluation_credit c group by c.evaluation_id having max(c.ordinal) <> count(*)) g
  union all select 'ledger_beyond_the_limit', 'invariant', count(*) from public.evaluation_credit c
    where c.ordinal > public.evaluation_report_limit()
$$;

-- ---- 14. LOCK-DOWN: system-only --------------------------------------------------------------------------------------------
-- Supabase's default privileges grant every new table, sequence and function in `public` to anon and authenticated (and everything
-- to service_role). Revoke by name, enable RLS with no policy (deny by default), and grant back nothing on the tables.
alter table public.evaluation        enable row level security;
alter table public.evaluation_invite enable row level security;
alter table public.evaluation_credit enable row level security;
alter table public.evaluation_event  enable row level security;
revoke all on public.evaluation        from public, anon, authenticated, service_role;
revoke all on public.evaluation_invite from public, anon, authenticated, service_role;
revoke all on public.evaluation_credit from public, anon, authenticated, service_role;
revoke all on public.evaluation_event  from public, anon, authenticated, service_role;

-- The sequence behind evaluation_event.event_id is a relation of its own and the default privileges open it too. Computed from the
-- dependency of a sequence on one of THIS file's four tables, never typed.
do $seq$
declare s record;
begin
  for s in select format('%I.%I', n.nspname, c.relname) as sig
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
             join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = c.oid and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
             join pg_class t on t.oid = d.refobjid
            where c.relkind = 'S' and t.relnamespace = 'public'::regnamespace
              and t.relname in ('evaluation', 'evaluation_invite', 'evaluation_credit', 'evaluation_event') loop
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s.sig);
  end loop;
end $seq$;

-- Every evaluation_ function, computed rather than typed (a list typed here would silently stop covering the next function added),
-- each named by its SCHEMA-QUALIFIED identity. The prefix is this file's own. A trigger function is executable by nobody.
do $lock$
declare f record;
begin
  for f in select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as sig,
                  (p.prorettype = 'trigger'::regtype) as is_trigger
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'evaluation\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
    if not f.is_trigger then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $lock$;

-- ---- 15. POST-CONDITION (fail closed) -----------------------------------------------------------------------------------------
-- The promise of this file is "unreadable by anon and authenticated, and writable by nobody but its own functions". Read from the
-- WHOLE ACL (no grantee but the owner; a function's only other grantee is service_role, and only a non-trigger one), so a grant to an
-- unnamed role, to PUBLIC, or a privilege a newer PostgreSQL adds stops the apply instead of passing a typed list of roles.
do $post$
declare
  t    text;
  r    text;
  s    record;
  f    record;
  v_sr oid;
  v_seqs integer := 0;
  v_fns  integer := 0;
begin
  select o.oid into v_sr from pg_roles o where o.rolname = 'service_role';
  foreach t in array array['public.evaluation', 'public.evaluation_invite', 'public.evaluation_credit', 'public.evaluation_event'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = t::regclass) then
      raise exception 'evaluation_entitlement: row level security is not enabled on %', t;
    end if;
    if exists (select 1 from pg_policy where polrelid = t::regclass) then
      raise exception 'evaluation_entitlement: % has a policy; it must have none', t;
    end if;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r)
         and has_table_privilege(r, t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
        raise exception 'evaluation_entitlement: role % holds a privilege on %', r, t;
      end if;
    end loop;
    if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = t::regclass and a.grantee <> c.relowner) then
      raise exception 'evaluation_entitlement: % is accessible to a role other than its owner', t;
    end if;
  end loop;
  for s in select c.oid, c.relname, c.relowner
             from pg_class c
             join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = c.oid and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
             join pg_class t on t.oid = d.refobjid
            where c.relkind = 'S' and t.relnamespace = 'public'::regnamespace
              and t.relname in ('evaluation', 'evaluation_invite', 'evaluation_credit', 'evaluation_event') loop
    v_seqs := v_seqs + 1;
    if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a where c.oid = s.oid and a.grantee <> c.relowner) then
      raise exception 'evaluation_entitlement: the sequence % is accessible to a role other than its owner', s.relname;
    end if;
  end loop;
  if v_seqs <> 1 then
    raise exception 'evaluation_entitlement: expected exactly one sequence behind the four tables (the event identity), found %', v_seqs;
  end if;
  for f in select p.oid, p.proname, p.proowner, (p.prorettype = 'trigger'::regtype) as is_trigger
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'evaluation\_%' loop
    v_fns := v_fns + 1;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f.oid and a.grantee <> p.proowner
                  and (f.is_trigger or v_sr is null or a.grantee <> v_sr or a.privilege_type <> 'EXECUTE')) then
      raise exception 'evaluation_entitlement: the function % is executable by a role it should not be', f.proname;
    end if;
  end loop;
  if v_fns < 13 then
    raise exception 'evaluation_entitlement: expected at least 13 evaluation_ functions, found %', v_fns;
  end if;
end $post$;

-- ROLLBACK (this file only). It DELETES every evaluation, invite, credit and event, so anything a later order hung off these tables
-- (Order J's ownership rows keyed by report_id, Order M's paid state) must be rolled back FIRST, and it leaves the stored snapshots
-- it linked WITHOUT an owner: only ever appropriate before the first real report is issued. Memberships that evaluation_invite_redeem
-- created stay in public.brokerage_member. docs/brokerage-account-spine.sql and docs/report-snapshot.sql are rolled back AFTER this file
-- (this file's foreign keys point at them).
-- ROLLBACK-BEGIN
--   drop function if exists public.evaluation_check(), public.evaluation_usage(uuid), public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb),
--     public.evaluation_revoke(uuid), public.evaluation_invite_revoke(uuid, uuid), public.evaluation_invite_redeem(text, uuid),
--     public.evaluation_create(text, integer, timestamptz, interval), public.evaluation_invite_mint(uuid, text, uuid, interval);
--   drop table if exists public.evaluation_event, public.evaluation_credit, public.evaluation_invite, public.evaluation;
--   drop function if exists public.evaluation_credit_after_insert(), public.evaluation_invite_guard(), public.evaluation_guard(),
--     public.evaluation_append_only(), public.evaluation_report_limit();
-- ROLLBACK-END

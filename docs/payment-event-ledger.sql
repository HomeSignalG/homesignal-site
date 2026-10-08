-- ============================================================================
-- PAYMENT-EVENT LEDGER  (Development Activity plan, Order M, step M0 — audit 2026-10-01, built 2026-10-02)
-- SQL OF RECORD. NOT APPLIED. Nothing calls it. Entitlement is not decided here.
--
-- WHAT IT IS
--   An append-only, processor-neutral record of the payment events a billing processor has sent us, kept so
--   that the later entitlement function (Order L) can act on VERIFIED, ORDERED, DE-DUPLICATED facts instead of
--   on whatever the last webhook call said. One table, one writer, one ordering rule, one status mapping.
--   Plan: docs/development-activity-plan-2026-09-30.md, Order M and Hard Rules 31-32 ("Paid entitlement changes
--   only from an authoritative server-verified payment/conversion event"). Contract and every open decision:
--   docs/development-activity-paid-continuation-2026-10-01.md.
--
-- WHAT IT DELIBERATELY IS NOT
--   * It is not the entitlement. It names no account, evaluation, credit, brokerage or subscription TABLE, writes
--     to none, and reads none. Whether a brokerage is paid is decided by ONE database function that Order L
--     builds; this table only answers "was this event already recorded", "is it the latest for its subscription"
--     and "what does the processor's status word map to". `is_latest` is an ORDERING fact, never a paid status.
--   * It is not the webhook. The deployed `lemonsqueezy-webhook` lives in homesignal-ingest and is untouched; a
--     change there needs its own cross-repo go. Nothing in this repo calls the recorder.
--   * It is not a copy of the payload. It holds opaque processor ids and the facts below, and NOTHING that
--     identifies a person: no payer email, name, card data, address or processor customer id. The table is
--     immutable, so anything that enters it cannot be purged on a privacy request; that is why the recorder
--     REFUSES any key outside a written allow-list instead of ignoring it (founder rule, 2026-09-29: customer
--     context never enters an immutable table; the payer's email stays only in the mutable subscriptions row).
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   billing processor event -> [HMAC-verified webhook, homesignal-ingest, exists] -> public.payment_event_record
--   (the ONLY writer) -> public.payment_event -> Order L's entitlement function (decision owner for "is this
--   account paid"; not built) -> consumers (Order H's gate, Order K's Billing tab, Order N's proof).
--   Decision owners, none duplicated here:
--     is the event genuine ........... the webhook's signature check, upstream. Not repeated here.
--     was it already recorded ........ the unique (processor, idempotency_key) constraint.
--     which event is the latest ...... public.payment_event_latest_id(), the ONE ordering rule.
--     what a status word maps to ..... public.payment_event_map_status(), the ONE mapping; unknown maps to 'unknown'.
--     what may be stored ............. public.payment_event_allowed_keys() and the table's column list.
--     is the account paid ............ Order L. Not here.
--
-- RULES THIS ENCODES (each pinned by test/payment_event_ledger_pg and test/payment-event-ledger-structure.test.mjs)
--   1. An event is recorded once. The same (processor, idempotency_key) again returns DUPLICATE and writes nothing.
--      The same key for a DIFFERENT event raises instead of returning DUPLICATE: a key that is too coarse would
--      otherwise drop real events in silence.
--   2. Order is the processor's own time, `occurred_at`, then arrival (`event_id`) only to break a tie. An older
--      event arriving later is RECORDED and reported not-latest. Arrival time never decides.
--   3. A status the mapping does not know is stored as 'unknown'. It is never 'active'. The mapped value is a
--      GENERATED column: no caller, and not even a direct INSERT by the owner, can choose it.
--   4. Append-only. No update, delete or truncate, by any role (trigger); the API roles hold no privilege.
--   5. The recorder refuses any key outside the allow-list, a value that is not an opaque token (so an email
--      address or a name cannot fit), and a timestamp with no explicit offset.
--   6. Test-mode and live-mode events never order against each other (livemode is part of the subscription's
--      identity for ordering), and one processor's events never order against another's.
--
-- PROVISIONAL (read before relying on any column): the processor's real payload is UNVERIFIED. This unit was built
-- offline with no captured payload and without reading the processor's documentation. Which field is the event's
-- time, whether the payload carries a unique event id, whether product/variant ids and a test-mode flag exist, and
-- what the retry behaviour is are DESIGN NEEDS here, not verified facts. The recorder takes the key and the time
-- from its CALLER precisely so that a wrong guess is a change to the caller, not to this immutable table. If a
-- captured test-mode payload shows a different shape, this file changes BEFORE it is applied.
--
-- ADDITIVE ONLY. Creates one table, one sequence (its identity), one trigger function, two triggers and the
-- functions below; alters and reads nothing that exists. Idempotent: safe to run twice. ROLLBACK is at the foot
-- of this file. Apply through the repo's approved path only (db-sql.yml, or apply_migration from this committed
-- file), never a begin/rollback dry run against production (CLAUDE.md section 7.11).
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------
do $pre$
begin
  if to_regprocedure('hashtextextended(text,bigint)') is null then
    raise exception 'payment_event: hashtextextended(text, bigint) is not available (PostgreSQL 11 or later is required)';
  end if;
  if to_regprocedure('pg_advisory_xact_lock(bigint)') is null then
    raise exception 'payment_event: pg_advisory_xact_lock(bigint) is not available';
  end if;
end $pre$;

-- ---- 1. THE VOCABULARIES, EACH DEFINED ONCE --------------------------------------------
-- An opaque token: 1 to 200 characters of letters, digits and . _ : | = + / - . No space and no @, so a
-- name or an email address cannot be a token. This is a backstop for the allow-list, not proof that a token is
-- not personal (a bare word such as "Smith" still fits); the real control is that the caller passes ids only.
create or replace function public.payment_event_opaque_ok(p text) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select coalesce(p ~ '^[A-Za-z0-9._:|=+/-]{1,200}$', false) $$;

-- A processor name: lower case, 2 to 32 characters. Processor-neutral on purpose; a new processor needs a reviewed
-- branch in payment_event_map_status below, and until it has one every status it sends maps to 'unknown'.
create or replace function public.payment_event_processor_ok(p text) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select coalesce(p ~ '^[a-z][a-z0-9_]{1,31}$', false) $$;

-- The keys the recorder accepts. Anything else is REFUSED, never ignored.
create or replace function public.payment_event_allowed_keys() returns text[]
language sql immutable
set search_path = public, pg_temp
as $$ select array['processor', 'idempotency_key', 'subscription_ref', 'event_name', 'processor_status',
                   'occurred_at', 'product_ref', 'variant_ref', 'livemode']::text[] $$;

-- The ONE mapping from a processor's status word to ours. Parity with the deployed webhook's STATUS_MAP for
-- Lemon Squeezy (on_trial, active, paused, past_due, unpaid, cancelled, expired) and ONE deliberate difference:
-- a word the map does not know is 'unknown' here, where the webhook stores 'canceled'. 'unknown' neither grants
-- nor revokes anything by itself; what the entitlement does with it is Order L's decision, and the processor's own
-- word is kept verbatim in processor_status. Case-sensitive: "ACTIVE" is not "active".
create or replace function public.payment_event_map_status(p_processor text, p_status text) returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case
    when p_processor = 'lemonsqueezy' then
      case p_status
        when 'on_trial'  then 'trialing'
        when 'active'    then 'active'
        when 'paused'    then 'paused'
        when 'past_due'  then 'past_due'
        when 'unpaid'    then 'unpaid'
        when 'cancelled' then 'canceled'
        when 'expired'   then 'canceled'
        else 'unknown'
      end
    else 'unknown'
  end
$$;

-- ---- 2. THE LEDGER ---------------------------------------------------------------------
create table if not exists public.payment_event (
  event_id         bigint      generated always as identity primary key,
  processor        text        not null,
  idempotency_key  text        not null,
  subscription_ref text        not null,
  event_name       text        not null,
  processor_status text,
  mapped_status    text        generated always as (public.payment_event_map_status(processor, processor_status)) stored,
  occurred_at      timestamptz not null,
  recorded_at      timestamptz not null default now(),
  product_ref      text,
  variant_ref      text,
  livemode         boolean     not null,
  constraint payment_event_idempotency      unique (processor, idempotency_key),
  constraint payment_event_processor_named  check (public.payment_event_processor_ok(processor)),
  constraint payment_event_key_opaque       check (public.payment_event_opaque_ok(idempotency_key)),
  constraint payment_event_subscription_opaque check (public.payment_event_opaque_ok(subscription_ref)),
  constraint payment_event_name_opaque      check (public.payment_event_opaque_ok(event_name)),
  constraint payment_event_status_opaque    check (processor_status is null or public.payment_event_opaque_ok(processor_status)),
  constraint payment_event_product_opaque   check (product_ref is null or public.payment_event_opaque_ok(product_ref)),
  constraint payment_event_variant_opaque   check (variant_ref is null or public.payment_event_opaque_ok(variant_ref)),
  constraint payment_event_mapped_closed    check (mapped_status in ('trialing', 'active', 'paused', 'past_due', 'unpaid', 'canceled', 'unknown'))
);

create index if not exists payment_event_by_subscription
  on public.payment_event (processor, livemode, subscription_ref, occurred_at desc, event_id desc);

-- ---- 3. APPEND-ONLY ----------------------------------------------------------------------
-- A recorded event is the processor's word at a moment, and the only evidence of what we were told.
create or replace function public.payment_event_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'payment_event is append-only (% refused)', tg_op;
end $$;

create or replace trigger payment_event_no_update_delete
  before update or delete on public.payment_event
  for each row execute function public.payment_event_immutable();

create or replace trigger payment_event_no_truncate
  before truncate on public.payment_event
  for each statement execute function public.payment_event_immutable();

-- ---- 4. THE ONE ORDERING RULE --------------------------------------------------------------
-- The latest event of a subscription, in one place. Processor time first; arrival only breaks a tie, so the answer
-- is deterministic. Order L's entitlement function must call THIS rather than write its own ORDER BY.
-- livemode is part of the identity: a test-mode event never displaces a live one, whatever its ids and times.
create or replace function public.payment_event_latest_id(p_processor text, p_livemode boolean, p_subscription_ref text)
returns bigint
language sql stable
set search_path = public, pg_temp
as $$
  select e.event_id
    from public.payment_event e
   where e.processor = p_processor and e.livemode = p_livemode and e.subscription_ref = p_subscription_ref
   order by e.occurred_at desc, e.event_id desc
   limit 1
$$;

-- ---- 5. THE ONE WRITER ---------------------------------------------------------------------
-- Takes ONE json object. Refuses anything it does not recognise instead of storing it. Returns
--   outcome     'RECORDED' (a new row) or 'DUPLICATE' (this exact event was already recorded; nothing written)
--   event_id    the row's id
--   is_latest   whether it is the latest event of its subscription under payment_event_latest_id() right now
--   recorded_at the server time the row was written
-- Calls for one subscription are serialised by a transaction-scoped advisory lock, so is_latest is accurate even for
-- two events recorded at the same moment. It says nothing about whether the account is paid.
create or replace function public.payment_event_opaque_field(p_event jsonb, p_key text, p_required boolean)
returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  t text := jsonb_typeof(p_event -> p_key);
begin
  if t is null or t = 'null' then
    if p_required then
      raise exception 'payment_event: "%" is required', p_key using errcode = '22023';
    end if;
    return null;
  end if;
  if t <> 'string' then
    raise exception 'payment_event: "%" must be a string', p_key using errcode = '22023';
  end if;
  if not public.payment_event_opaque_ok(p_event ->> p_key) then
    raise exception 'payment_event: "%" must be an opaque token (1 to 200 characters of letters, digits and . _ : | = + / -)', p_key using errcode = '22023';
  end if;
  return p_event ->> p_key;
end $$;

create or replace function public.payment_event_record(p_event jsonb)
returns table (outcome text, event_id bigint, is_latest boolean, recorded_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bad     text;
  v_proc    text;
  v_key     text;
  v_sub     text;
  v_name    text;
  v_status  text;
  v_prod    text;
  v_var     text;
  v_live    boolean;
  v_occ     timestamptz;
  v_id      bigint;
  v_rec     timestamptz;
  v_outcome text;
  r         public.payment_event%rowtype;
begin
  if jsonb_typeof(p_event) is distinct from 'object' then
    raise exception 'payment_event: the event must be a JSON object' using errcode = '22023';
  end if;
  -- an unknown key is REFUSED, not stored: this is how a payer email, a name or a card detail never lands here
  select j into v_bad from jsonb_object_keys(p_event) j where j <> all (public.payment_event_allowed_keys()) limit 1;
  if v_bad is not null then
    raise exception 'payment_event: unknown field "%" (allowed: processor, idempotency_key, subscription_ref, event_name, processor_status, occurred_at, product_ref, variant_ref, livemode)', v_bad using errcode = '22023';
  end if;

  if jsonb_typeof(p_event -> 'processor') is distinct from 'string' or not public.payment_event_processor_ok(p_event ->> 'processor') then
    raise exception 'payment_event: "processor" is required and must be 2 to 32 lower-case letters, digits or underscores, starting with a letter' using errcode = '22023';
  end if;
  v_proc   := p_event ->> 'processor';
  v_key    := public.payment_event_opaque_field(p_event, 'idempotency_key', true);
  v_sub    := public.payment_event_opaque_field(p_event, 'subscription_ref', true);
  v_name   := public.payment_event_opaque_field(p_event, 'event_name', true);
  v_status := public.payment_event_opaque_field(p_event, 'processor_status', false);
  v_prod   := public.payment_event_opaque_field(p_event, 'product_ref', false);
  v_var    := public.payment_event_opaque_field(p_event, 'variant_ref', false);

  if jsonb_typeof(p_event -> 'livemode') is distinct from 'boolean' then
    raise exception 'payment_event: "livemode" is required and must be true or false' using errcode = '22023';
  end if;
  v_live := (p_event ->> 'livemode')::boolean;

  -- the processor's own time, with an explicit offset: a timestamp with none would be read in the session's zone
  if jsonb_typeof(p_event -> 'occurred_at') is distinct from 'string'
     or (p_event ->> 'occurred_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'payment_event: "occurred_at" is required and must be an ISO-8601 timestamp with an explicit offset (for example 2026-10-01T10:00:00Z)' using errcode = '22023';
  end if;
  begin
    v_occ := (p_event ->> 'occurred_at')::timestamptz;
  exception when others then
    raise exception 'payment_event: "occurred_at" is not a valid timestamp' using errcode = '22023';
  end;

  perform pg_advisory_xact_lock(hashtextextended('payment_event|' || v_proc || '|' || v_live::text || '|' || v_sub, 0));

  insert into public.payment_event as e
    (processor, idempotency_key, subscription_ref, event_name, processor_status, occurred_at, product_ref, variant_ref, livemode)
  values (v_proc, v_key, v_sub, v_name, v_status, v_occ, v_prod, v_var, v_live)
  on conflict (processor, idempotency_key) do nothing
  returning e.event_id, e.recorded_at into v_id, v_rec;

  if v_id is null then
    select * into r from public.payment_event x where x.processor = v_proc and x.idempotency_key = v_key;
    if (r.subscription_ref, r.event_name, r.processor_status, r.occurred_at, r.product_ref, r.variant_ref, r.livemode)
       is distinct from (v_sub, v_name, v_status, v_occ, v_prod, v_var, v_live) then
      raise exception 'payment_event: this idempotency key was already recorded for a different event'
        using errcode = '23505', constraint = 'payment_event_idempotency_key_reused';
    end if;
    v_outcome := 'DUPLICATE';
    v_id := r.event_id;
    v_rec := r.recorded_at;
  else
    v_outcome := 'RECORDED';
  end if;

  return query select v_outcome, v_id, (public.payment_event_latest_id(v_proc, v_live, v_sub) = v_id), v_rec;
end $$;

-- ---- 6. LOCK-DOWN: system-only --------------------------------------------------------------
-- Supabase's default privileges grant every new table, sequence and function in `public` to anon and authenticated
-- (and everything to service_role). Revoke by name, enable RLS with no policy (deny by default), then grant back
-- exactly what the consumers need: SELECT, and the functions. service_role cannot INSERT directly, so it cannot
-- choose an id, a mapping or a time.
alter table public.payment_event enable row level security;
revoke all on public.payment_event from public, anon, authenticated, service_role;
grant select on public.payment_event to service_role;

do $seq$
declare s text := pg_get_serial_sequence('public.payment_event', 'event_id');
begin
  if s is null then
    raise exception 'payment_event: the identity sequence of event_id was not found';
  end if;
  execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s);
end $seq$;

-- Every payment_event_ function, computed rather than typed (a list typed here would silently stop covering the
-- next function added).
do $lock$
declare f record;
begin
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'payment\_event\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $lock$;

-- ROLLBACK (this file only; each line between the markers is a statement once the leading "-- " is removed).
-- Rolling back DELETES the recorded events, so it is only ever appropriate before the first real one is recorded.
-- Nothing references this table, so there is nothing to roll back first. The table goes before the functions
-- (its generated column and checks call them). test/payment_event_ledger_pg runs this block and proves it.
-- ROLLBACK-BEGIN
-- drop table if exists public.payment_event;
-- drop function if exists public.payment_event_record(jsonb);
-- drop function if exists public.payment_event_opaque_field(jsonb, text, boolean);
-- drop function if exists public.payment_event_latest_id(text, boolean, text);
-- drop function if exists public.payment_event_map_status(text, text);
-- drop function if exists public.payment_event_allowed_keys();
-- drop function if exists public.payment_event_processor_ok(text);
-- drop function if exists public.payment_event_opaque_ok(text);
-- drop function if exists public.payment_event_immutable();
-- ROLLBACK-END

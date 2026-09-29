-- ============================================================================
-- DURABLE REPORT SNAPSHOTS  (Development Activity plan, Order F — 2026-09-30; boundary F2 same day)
-- SQL OF RECORD. One table, one writer, one immutability trigger, one containment trigger.
--
-- WHAT IT IS
--   The place a commercial report is STORED, and the place its durable identity is minted.
--   Two identifiers that used to be one field are now two columns:
--     report_id     a random UUID minted by THIS database at issue time, one per stored
--                   snapshot. It is the key everything about a delivered report hangs on
--                   later: entitlement ledger, sharing, reopening, portfolio and history,
--                   audit trail, paid delivery. It is not derived from the content.
--     content_hash  SHA-256 (hex) of `body`, the exact bytes of the report content. It says
--                   whether two stored reports carry the same content. It is NOT an issuance
--                   id: two reports issued months apart from unchanged data share it.
--   Before this, one SHA-256 field called report_id did both jobs and could do neither
--   (docs/corporate-output-report-id-guarantee-2026-09-28.md: not unique per issuance, not an
--   order or delivery id). Plan: docs/development-activity-plan-2026-09-30.md, Order F,
--   Step 6, Hard Rules 21 and 22.
--
-- THE PRIVACY BOUNDARY (F2 — founder decision 2026-09-29)
--   This table is PERMANENT and IMMUTABLE. A street address a brokerage typed is customer context,
--   not historical intelligence, so it is NOT stored here — not in `body`, not in `engine_inputs`,
--   and not as a property identifier that resolves to one address. It lives in the deletable
--   public.report_private_context (docs/report-private-context.sql), and this table references it
--   by an opaque `private_context_id`. Deleting the private context therefore cannot touch a
--   report_id, a content_hash, a timestamp, a version, or any project fact in a body.
--   The database ENFORCES the boundary at the write, beside the data: the containment trigger
--   refuses a snapshot whose body or engine_inputs contains ANY value held in its private context.
--   That is a backstop. The primary control is structural — the engine hands the writer permanent
--   intelligence and private context as two separate things (supabase/functions/_shared/
--   report-snapshot.ts) — and the trigger exists so a future engine that gets this wrong fails at
--   the first write instead of after a stored report.
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   report engine (assembles the content) -> supabase/functions/_shared/report-snapshot.ts
--     (derives body + content_hash, separates the private context) -> [public.report_snapshot_issue,
--     the ONLY writer] -> public.report_snapshot (+ public.report_private_context) -> the consumers
--     named above (later units).
--   Decision owners, none duplicated here:
--     what the content IS ......... the report engine. This file stores it, it never edits it.
--     the content_hash definition .. this table's CHECK: content_hash = sha256(body). It is
--                                   enforced by the database, so no caller can store a hash
--                                   that does not describe the stored bytes.
--     the report_id ................ minted inside the writer (gen_random_uuid(); the column has no
--                                   default, and the writer has no argument for it). Nothing else inserts.
--     what counts as private ....... public.report_private_context, and the containment trigger
--                                   below, which reads it. There is no second list of private fields.
--     who may read / reopen ........ later units (J, L). This file grants no read to any API role.
--
-- RULES THIS ENCODES (each pinned by test/report_snapshot_pg and test/report-snapshot-structure.test.mjs)
--   1. report_id is minted by the database and is unique per issued snapshot. Issuing the same
--      content twice gives two report_ids and one content_hash.
--   2. `body` is TEXT, not jsonb, on purpose. jsonb reorders keys and rewrites whitespace, so
--      a stored jsonb could never hash back to content_hash. The text is the exact bytes the
--      hash was taken over, which is what lets a stored report be reopened and re-verified
--      byte for byte.
--   3. content_hash must equal the SHA-256 of body. A wrong, short, upper-case or borrowed hash
--      is refused by the table, not trusted from the caller.
--   4. A snapshot is immutable. No update, delete or truncate, by any role (trigger), and the
--      API roles hold no privilege that could try. A stored report is the record of what a
--      customer was shown; the permanent-history rule in CLAUDE.md applies to it.
--   5. Nothing here is readable or writable by anon or authenticated. service_role may SELECT
--      and may EXECUTE the one writer; it cannot INSERT directly, so it cannot choose an id.
--   6. No private value is ever stored here. The writer creates the private context, the first
--      "report needs this" row and the snapshot in ONE transaction, and the containment trigger
--      refuses the snapshot (rolling all three back) if its body or engine_inputs contains the
--      address, the normalized address, a property key, the label, or full-precision coordinates.
--
-- WHAT THIS DOES NOT DECIDE (recorded, not solved)
--   * Whose report it is. There is no account, evaluation or entitlement table yet (Order L),
--     so there is no owner column. It is added, additively, with the unit that creates them.
--   * When a REPORT stops needing its address (which starts the 90-day clock). The "report" need
--     opens at issue and stays open until Orders J and L close it (report archived, account closed).
--   * A subject address that is itself a public record's address. The containment trigger fails
--     CLOSED on it. Order G's engine must declare which body strings are public-record addresses
--     before such a report can be stored.
--   * Retries. Issuing twice is two snapshots. Idempotent issue keyed on a request key belongs
--     with the credit ledger (plan Hard Rule 28), which is the thing that must not double-count.
--   * Read access, share tokens and revocation (Order J).
--
-- IDEMPOTENT, and UPGRADES the Order F table (which had `inputs` and `property_key`, both of which
-- could carry an address): the upgrade fails closed unless the table is EMPTY. It was empty when
-- this was written (0 rows, verified on production). ROLLBACK is at the foot of this file.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------
do $pre$
begin
  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'report_snapshot: gen_random_uuid() is not available';
  end if;
  if to_regprocedure('sha256(bytea)') is null then
    raise exception 'report_snapshot: sha256(bytea) is not available (PostgreSQL 11 or later is required)';
  end if;
  if (select setting from pg_settings where name = 'server_encoding') <> 'UTF8' then
    raise exception 'report_snapshot: the database encoding must be UTF8 so that sha256(body) is the hash of the UTF-8 bytes a client hashes';
  end if;
  if to_regclass('public.report_private_context') is null
     or to_regprocedure('public.report_private_context_create(jsonb, text, text)') is null then
    raise exception 'report_snapshot: apply docs/report-private-context.sql first (the snapshot references it)';
  end if;
end $pre$;

-- ---- 1. THE TABLE ---------------------------------------------------------------
create table if not exists public.report_snapshot (
  report_id          uuid        primary key,
  content_hash       text        not null,
  report_version     text        not null,
  generated_at       timestamptz not null default now(),
  private_context_id uuid        references public.report_private_context (context_id),
  engine_inputs      jsonb       not null,
  body               text        not null,
  body_bytes         integer     generated always as (octet_length(body)) stored,
  constraint report_snapshot_hash_matches_body  check (content_hash = encode(sha256(convert_to(body, 'UTF8')), 'hex')),
  constraint report_snapshot_body_is_object     check (jsonb_typeof(body::jsonb) = 'object'),
  constraint report_snapshot_version_named      check (btrim(report_version) <> ''),
  constraint report_snapshot_engine_inputs_object check (jsonb_typeof(engine_inputs) = 'object')
);

-- ---- 1b. UPGRADE from the Order F shape ----------------------------------------------
-- Order F stored `inputs` (the request as typed, address included) and `property_key` (a label that
-- for NYC is an address-point id, i.e. an address). Neither may exist in a permanent table. Refuses,
-- changing nothing, if a single snapshot has been stored.
do $upg$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'report_snapshot' and column_name in ('inputs', 'property_key')) then
    if exists (select 1 from public.report_snapshot) then
      raise exception 'report_snapshot: the Order F shape holds stored reports; refusing to drop its address-bearing columns. Nothing was changed.';
    end if;
    alter table public.report_snapshot drop constraint if exists report_snapshot_inputs_object;
    alter table public.report_snapshot drop constraint if exists report_snapshot_key_named;
    alter table public.report_snapshot drop column if exists inputs;
    alter table public.report_snapshot drop column if exists property_key;
  end if;
  alter table public.report_snapshot alter column report_id drop default;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'report_snapshot' and column_name = 'engine_inputs') then
    alter table public.report_snapshot add column engine_inputs jsonb not null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'report_snapshot' and column_name = 'private_context_id') then
    alter table public.report_snapshot add column private_context_id uuid references public.report_private_context (context_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.report_snapshot'::regclass and conname = 'report_snapshot_engine_inputs_object') then
    alter table public.report_snapshot add constraint report_snapshot_engine_inputs_object check (jsonb_typeof(engine_inputs) = 'object');
  end if;
end $upg$;

-- the Order F writer (its fifth argument was a property key as text); the new writer has a different signature
drop function if exists public.report_snapshot_issue(text, text, text, jsonb, text);

-- ---- 2. IMMUTABLE ------------------------------------------------------------------
create or replace function public.report_snapshot_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'report_snapshot is immutable (% refused)', tg_op;
end $$;

create or replace trigger report_snapshot_no_update_delete
  before update or delete on public.report_snapshot
  for each row execute function public.report_snapshot_immutable();

create or replace trigger report_snapshot_no_truncate
  before truncate on public.report_snapshot
  for each statement execute function public.report_snapshot_immutable();

-- ---- 3. NO PRIVATE VALUE IN THE PERMANENT RECORD -------------------------------------
-- Comparison text: lower case, with runs of whitespace, commas and periods collapsed to one space,
-- so "1   CENTRE  street," and "1 Centre Street" compare equal. (Applied to both sides.)
create or replace function public.report_snapshot_norm(t text) returns text
language sql immutable as $$ select btrim(regexp_replace(lower(coalesce(t, '')), '[[:space:],.]+', ' ', 'g')) $$;

-- Refuses a snapshot whose body or engine_inputs contains any value held in its private context.
-- The message names the FIELD, never the value. Coordinates are scanned only at full precision
-- (5+ decimals, about a metre): a coarse "40.71" is not an exact property location and would
-- collide with unrelated numbers. A private value shorter than 3 characters is not scanned.
create or replace function public.report_snapshot_no_private_values() returns trigger
language plpgsql
as $$
declare
  c        public.report_private_context%rowtype;
  f        text;
  v        text;
  hay_body text;
  hay_in   text;
begin
  if new.private_context_id is null then
    return new;                                   -- a report with no subject address has no private context
  end if;
  select * into c from public.report_private_context where context_id = new.private_context_id;
  if not found then
    raise exception 'report_snapshot: the private context does not exist' using errcode = '23503';
  end if;
  if c.state <> 'active' then
    raise exception 'report_snapshot: a snapshot cannot be issued against a purged private context' using errcode = '55000';
  end if;
  hay_body := public.report_snapshot_norm(new.body);
  hay_in   := public.report_snapshot_norm(new.engine_inputs::text);
  for f, v in
    select t.f, t.v from (values
      ('address', c.address),
      ('normalized_address', c.normalized_address),
      ('label', c.label),
      ('latitude', case when scale(c.latitude) >= 5 then c.latitude::text end),
      ('longitude', case when scale(c.longitude) >= 5 then c.longitude::text end)) as t (f, v)
    union all select 'property_key', k from unnest(coalesce(c.property_keys, '{}'::text[])) as k
  loop
    v := public.report_snapshot_norm(v);
    if length(v) >= 3 and (position(v in hay_body) > 0 or position(v in hay_in) > 0) then
      raise exception 'report_snapshot: the permanent snapshot contains the private context''s %', f
        using errcode = '23514', constraint = 'report_snapshot_no_private_values';
    end if;
  end loop;
  return new;
end $$;

create or replace trigger report_snapshot_no_private_values
  before insert on public.report_snapshot
  for each row execute function public.report_snapshot_no_private_values();

-- ---- 4. THE ONE WRITER ---------------------------------------------------------------
-- There is deliberately no argument for report_id or generated_at: the database mints both.
-- p_private is the customer-entered context (address and what derives from it); null when the
-- report has no subject address. In ONE transaction the writer creates the private context with its
-- first need ("this report"), then the snapshot. If the containment trigger refuses the snapshot,
-- the context and the need are rolled back with it.
create or replace function public.report_snapshot_issue(
  p_body           text,
  p_content_hash   text,
  p_report_version text,
  p_engine_inputs  jsonb,
  p_private        jsonb default null
) returns table (report_id uuid, generated_at timestamptz, private_context_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id  uuid := gen_random_uuid();
  v_ctx uuid;
  v_at  timestamptz;
begin
  if p_private is not null then
    v_ctx := public.report_private_context_create(p_private, 'report', v_id::text);
  end if;
  insert into public.report_snapshot as s (report_id, content_hash, report_version, private_context_id, engine_inputs, body)
  values (v_id, p_content_hash, p_report_version, v_ctx, p_engine_inputs, p_body)
  returning s.generated_at into v_at;
  return query select v_id, v_at, v_ctx;
end $$;

-- ---- 5. LOCK-DOWN: system-only --------------------------------------------------------
-- Supabase's default privileges grant every new table and function in `public` to anon and
-- authenticated (and everything to service_role). Revoke by name, enable RLS with no policy
-- (deny by default), then grant back exactly what the consumers need: SELECT, and the writer.
alter table public.report_snapshot enable row level security;
revoke all on public.report_snapshot from public, anon, authenticated, service_role;
grant select on public.report_snapshot to service_role;

-- Every report_snapshot_ function, computed rather than typed (a list typed here would silently
-- stop covering the next function added).
do $lock$
declare f record;
begin
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'report\_snapshot\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $lock$;

-- ROLLBACK (this file only; touches nothing else). Rolling back DELETES stored reports, so it
-- is only ever appropriate before the first real one is issued. Run it BEFORE rolling back
-- docs/report-private-context.sql (this table's foreign key points there):
--   drop function if exists public.report_snapshot_issue(text, text, text, jsonb, jsonb),
--     public.report_snapshot_immutable(), public.report_snapshot_no_private_values(),
--     public.report_snapshot_norm(text) cascade;
--   drop table if exists public.report_snapshot;

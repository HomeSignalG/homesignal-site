-- ============================================================================
-- DURABLE REPORT SNAPSHOTS  (Development Activity plan, Order F — 2026-09-30)
-- SQL OF RECORD. One table, one writer, one immutability trigger.
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
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   report engine (assembles the content) -> supabase/functions/_shared/report-snapshot.ts
--     (derives body + content_hash) -> [public.report_snapshot_issue, the ONLY writer]
--     -> public.report_snapshot -> the consumers named above (later units).
--   Decision owners, none duplicated here:
--     what the content IS ......... the report engine. This file stores it, it never edits it.
--     the content_hash definition .. this table's CHECK: content_hash = sha256(body). It is
--                                   enforced by the database, so no caller can store a hash
--                                   that does not describe the stored bytes.
--     the report_id ................ this table's default. No function argument can set it.
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
--
-- WHAT THIS DOES NOT DECIDE (recorded, not solved)
--   * Whose report it is. There is no account, evaluation or entitlement table yet (Order L),
--     so there is no owner column. It is added, additively, with the unit that creates them.
--   * Retries. Issuing twice is two snapshots. Idempotent issue keyed on a request key belongs
--     with the credit ledger (plan Hard Rule 28), which is the thing that must not double-count.
--   * Read access, share tokens and revocation (Order J).
--   * The property_key format. It is a nullable label the engine supplies when an address
--     resolved; nothing here interprets it.
--
-- ADDITIVE ONLY. Creates one table, one trigger, three functions. Alters no existing object and
-- writes no existing table. Idempotent: safe to run twice. ROLLBACK is at the foot of this file.
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
end $pre$;

-- ---- 1. THE TABLE ---------------------------------------------------------------
create table if not exists public.report_snapshot (
  report_id      uuid        primary key default gen_random_uuid(),
  content_hash   text        not null,
  report_version text        not null,
  generated_at   timestamptz not null default now(),
  property_key   text,
  inputs         jsonb       not null,
  body           text        not null,
  body_bytes     integer     generated always as (octet_length(body)) stored,
  constraint report_snapshot_hash_matches_body check (content_hash = encode(sha256(convert_to(body, 'UTF8')), 'hex')),
  constraint report_snapshot_body_is_object    check (jsonb_typeof(body::jsonb) = 'object'),
  constraint report_snapshot_version_named     check (btrim(report_version) <> ''),
  constraint report_snapshot_inputs_object     check (jsonb_typeof(inputs) = 'object'),
  constraint report_snapshot_key_named         check (property_key is null or btrim(property_key) <> '')
);

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

-- ---- 3. THE ONE WRITER ---------------------------------------------------------------
-- There is deliberately no argument for report_id or generated_at: the database mints both.
create or replace function public.report_snapshot_issue(
  p_body           text,
  p_content_hash   text,
  p_report_version text,
  p_inputs         jsonb,
  p_property_key   text default null
) returns table (report_id uuid, generated_at timestamptz)
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.report_snapshot as s (content_hash, report_version, property_key, inputs, body)
  values (p_content_hash, p_report_version, p_property_key, p_inputs, p_body)
  returning s.report_id, s.generated_at
$$;

-- ---- 4. LOCK-DOWN: system-only --------------------------------------------------------
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
-- is only ever appropriate before the first real one is issued:
--   drop function if exists public.report_snapshot_issue(text, text, text, jsonb, text),
--     public.report_snapshot_immutable() cascade;
--   drop table if exists public.report_snapshot;

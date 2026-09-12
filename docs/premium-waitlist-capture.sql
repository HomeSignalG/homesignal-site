-- HomeSignal — Premium waitlist capture contract (DDL of record)
--
-- Applied to project qwnnmljucajnexpxdgxr as three migrations:
--   20260911 premium_waitlist_capture_contract
--   20260911 hs_premium_waitlist_admin_read
--   20260911 hs_premium_waitlist_join_public_write_path
--   20260912 premium_waitlist_address_context   (Fix 15 — the address column below)
-- Parked here so the schema stays reproducible (CLAUDE.md §1, source #3).
--
-- ============================================================================
-- WHAT WAS BROKEN
-- ============================================================================
-- shell.js::HS.submitWaitlist inserted into `premium_waitlist`. That table does
-- not exist. Measured on production through PostgREST with the real anon key:
--
--   POST /rest/v1/premium_waitlist  -> HTTP 404
--   {"code":"PGRST205","message":"Could not find the table 'public.premium_waitlist'
--    in the schema cache","hint":"Perhaps you meant the table 'public.app_premium_waitlist'"}
--
-- persistEmail swallowed it (`try { await ... } catch {}` — and a PostgREST
-- rejection RESOLVES with { error } rather than throwing, so even the catch was
-- beside the point), and the caller then showed "You're on the list"
-- unconditionally. Control for the claim: app_premium_waitlist held 0 rows.
--
-- ============================================================================
-- WHY THE PUBLIC WRITE PATH IS AN RPC AND NOT A TABLE INSERT
-- ============================================================================
-- Decided on probe evidence, not preference:
--
--   * plain INSERT against UNIQUE(email) answers 23505 on a repeat. That is an
--     email-EXISTENCE ORACLE any anonymous caller could mine, which Gate 8 of the
--     brief prohibits outright.
--   * INSERT ... ON CONFLICT (email) DO NOTHING hides the oracle, but Postgres
--     requires SELECT on the arbiter column, so it would have forced a SELECT
--     grant back onto anon. MEASURED: with SELECT revoked, anon's upsert returned
--     HTTP 401 42501 (pg_net request 23316) — the reason this file does not use it.
--   * a SECURITY DEFINER function owned by postgres does the dedupe with NO anon
--     privilege on the table at all, and answers identically for a new lead and a
--     repeat.
--
-- Net posture: anon can call one narrow validating function and nothing else. It
-- cannot read the table, enumerate it, or learn whether an address is on it.

-- ============================================================================
-- FIX 15 (2026-09-12) — WHICH PROPERTY THE LEAD CAME FROM
-- ============================================================================
-- The Address dossier offers this same waitlist, so a lead can now originate from a
-- specific property rather than a ZIP page. `address` records which one. STRICTLY
-- ADDITIVE: one nullable column, one defaulted RPC parameter, one appended key in the
-- admin read. Grants, RLS posture and the admin gate are untouched.
--
-- ⚠️ THE UNIQUENESS CONTRACT IS DELIBERATELY UNCHANGED, AND IT IS A KNOWN LIMIT.
-- UNIQUE(email) + `on conflict (email) do nothing` means ONE ROW PER EMAIL, first
-- touch wins. So a visitor who asks about ZIP 78617 and later about 96 ISLAND DR is
-- recorded once, under whichever came first: the second intent signal is accepted by
-- the RPC (it answers ok) and then silently discarded by the conflict clause. Holding
-- both would mean a new uniqueness key and a migration of the existing rows — a change
-- to the database contract, which is gated. Reported, not taken. Do not "fix" this by
-- switching the clause to DO UPDATE: that would overwrite the first context with the
-- newest and lose an intent signal in the other direction.

-- ---------------------------------------------------------------- source context
alter table public.app_premium_waitlist add column if not exists source  text;
alter table public.app_premium_waitlist add column if not exists zip     text;
alter table public.app_premium_waitlist add column if not exists address text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_premium_waitlist_zip_format') then
    alter table public.app_premium_waitlist
      add constraint app_premium_waitlist_zip_format
      check (zip is null or zip ~ '^[0-9]{5}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_premium_waitlist_source_len') then
    alter table public.app_premium_waitlist
      add constraint app_premium_waitlist_source_len
      check (source is null or char_length(source) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_premium_waitlist_address_len') then
    alter table public.app_premium_waitlist
      add constraint app_premium_waitlist_address_len
      check (address is null or char_length(address) <= 200);
  end if;
end $$;

-- ------------------------------------------- normalization + one logical lead
-- Normalization is enforced in the DATABASE, not only in the client, so uniqueness
-- cannot drift if another caller ever writes this table.
create or replace function public.tg_app_premium_waitlist_normalize()
returns trigger language plpgsql as $$
begin
  new.email   := lower(btrim(new.email));
  new.zip     := nullif(btrim(coalesce(new.zip, '')), '');
  new.source  := nullif(btrim(coalesce(new.source, '')), '');
  -- Address CASE is preserved. app_properties stores the Census-confirmed line
  -- ("96 ISLAND DR"); re-casing it here would be an edit to a canonical value.
  new.address := nullif(btrim(coalesce(new.address, '')), '');
  return new;
end $$;

drop trigger if exists app_premium_waitlist_normalize on public.app_premium_waitlist;
create trigger app_premium_waitlist_normalize
  before insert or update on public.app_premium_waitlist
  for each row execute function public.tg_app_premium_waitlist_normalize();

update public.app_premium_waitlist
   set email = lower(btrim(email))
 where email <> lower(btrim(email));

-- collapse any duplicates normalization created, KEEPING FIRST TOUCH
delete from public.app_premium_waitlist a
 using public.app_premium_waitlist b
 where a.email = b.email
   and (a.created_at, a.id) > (b.created_at, b.id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_premium_waitlist_email_key') then
    alter table public.app_premium_waitlist
      add constraint app_premium_waitlist_email_key unique (email);
  end if;
end $$;

create index if not exists app_premium_waitlist_created_at_idx
  on public.app_premium_waitlist (created_at desc);

-- ------------------------------------------------------ the public write path
-- Dropped and recreated rather than added alongside: a second 3-arg overload would make
-- a 3-arg PostgREST call ambiguous. The 4th parameter defaults, so an already-deployed
-- 3-arg caller (a browser holding a cached lib/premium-waitlist.js) still resolves here.
drop function if exists public.hs_premium_waitlist_join(text, text, text);

create or replace function public.hs_premium_waitlist_join(
  p_email   text,
  p_source  text default null,
  p_zip     text default null,
  p_address text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e text; s text; z text; a text;
begin
  e := lower(btrim(coalesce(p_email, '')));
  if e = ''
     or char_length(e) > 320
     or e !~ '^[^[:space:]@]+@[^[:space:]@.]+([.][^[:space:]@.]+)+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  s := nullif(btrim(coalesce(p_source, '')), '');
  if s is not null and char_length(s) > 200 then s := left(s, 200); end if;

  -- A ZIP is recorded only when it really is one. Anything else becomes NULL
  -- rather than being stored, guessed or inferred — and never blocks the signup.
  z := nullif(btrim(coalesce(p_zip, '')), '');
  if z is not null and z !~ '^[0-9]{5}$' then z := null; end if;

  -- Same rule for the originating property: absent stays absent. An address is only
  -- ever the line the CTA's own property object carried; nothing here derives one.
  a := nullif(btrim(regexp_replace(coalesce(p_address, ''), '[[:space:]]+', ' ', 'g')), '');
  if a is not null and char_length(a) > 200 then a := left(a, 200); end if;

  insert into public.app_premium_waitlist (email, source, zip, address)
  values (e, s, z, a)
  on conflict (email) do nothing;

  -- Deliberately uniform for a new lead AND a repeat: the response must not
  -- reveal whether this address was already recorded.
  return jsonb_build_object('ok', true, 'email', e);
end
$function$;

revoke all on function public.hs_premium_waitlist_join(text, text, text, text) from public;
grant execute on function public.hs_premium_waitlist_join(text, text, text, text) to anon, authenticated;

-- ----------------------------------------------------- the privileged admin read
-- Same shape as hs_acquisition_live / hs_zip_behavior / hs_acquisition_metrics.
-- Gate 5: KPI + lead log are ONE call over ONE table, so they cannot drift.
create or replace function public.hs_premium_waitlist(p_limit int default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  caller_email text := auth.jwt() ->> 'email';
  n            int;
  result       jsonb;
begin
  if caller_email is null
     or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  n := least(greatest(coalesce(p_limit, 500), 1), 2000);

  select jsonb_build_object(
    'generated_at', now(),
    'total',    (select count(*) from public.app_premium_waitlist),
    'last_7d',  (select count(*) from public.app_premium_waitlist where created_at >= now() - interval '7 days'),
    'last_30d', (select count(*) from public.app_premium_waitlist where created_at >= now() - interval '30 days'),
    'with_zip', (select count(*) from public.app_premium_waitlist where zip is not null),
    'with_address', (select count(*) from public.app_premium_waitlist where address is not null),
    'row_limit', n,
    'rows', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select email, created_at, source, zip, address
          from public.app_premium_waitlist
         order by created_at desc, email asc
         limit n
      ) t), '[]'::jsonb)
  ) into result;

  return result;
end
$function$;

revoke all on function public.hs_premium_waitlist(int) from public;
revoke all on function public.hs_premium_waitlist(int) from anon;
grant execute on function public.hs_premium_waitlist(int) to authenticated;

-- --------------------------------------------------------------- the boundary
-- The table is closed to the public roles entirely. The INSERT policy is KEPT so
-- that if a direct grant is ever restored it is still governed rather than open.
revoke all on table public.app_premium_waitlist from anon, authenticated;

-- ============================================================================
-- POST-APPLY INVARIANTS — this file refuses to report success over nothing.
-- ============================================================================
do $$
declare
  n_unique int; n_tab int; n_join int; n_join3 int;
  n_read_anon int; n_read_auth int; n_dupes int; n_addr int;
begin
  select count(*) into n_unique from pg_constraint
   where conname='app_premium_waitlist_email_key' and contype='u';
  select count(*) into n_tab from information_schema.role_table_grants
   where table_schema='public' and table_name='app_premium_waitlist' and grantee in ('anon','authenticated');
  select count(*) into n_join from information_schema.role_routine_grants
   where routine_schema='public' and routine_name='hs_premium_waitlist_join' and grantee in ('anon','authenticated');
  select count(*) into n_read_anon from information_schema.role_routine_grants
   where routine_schema='public' and routine_name='hs_premium_waitlist' and grantee in ('anon','PUBLIC');
  select count(*) into n_read_auth from information_schema.role_routine_grants
   where routine_schema='public' and routine_name='hs_premium_waitlist' and grantee='authenticated';
  select count(*) into n_dupes from (
    select 1 from public.app_premium_waitlist group by email having count(*) > 1) d;
  select count(*) into n_join3 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='hs_premium_waitlist_join' and p.pronargs <> 4;
  select count(*) into n_addr from information_schema.columns
   where table_schema='public' and table_name='app_premium_waitlist' and column_name='address';

  if n_unique    <> 1 then raise exception 'a: unique(email) not established (%)', n_unique; end if;
  if n_tab       <> 0 then raise exception 'b: public roles still hold table privileges (%)', n_tab; end if;
  if n_join      <> 2 then raise exception 'c: join RPC not executable by anon+authenticated (%)', n_join; end if;
  if n_read_anon <> 0 then raise exception 'd: anon/PUBLIC can execute the admin read (%)', n_read_anon; end if;
  if n_read_auth <> 1 then raise exception 'e: authenticated cannot execute the admin read (%)', n_read_auth; end if;
  if n_dupes     <> 0 then raise exception 'f: duplicate emails remain (%)', n_dupes; end if;
  if n_join3     <> 0 then raise exception 'g: a non-4-arg join overload survives, calls would be ambiguous (%)', n_join3; end if;
  if n_addr      <> 1 then raise exception 'h: address column missing (%)', n_addr; end if;
end $$;

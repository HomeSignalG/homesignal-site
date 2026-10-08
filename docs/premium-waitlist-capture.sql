-- HomeSignal — Premium waitlist capture contract (DDL of record)
--
-- Applied to project qwnnmljucajnexpxdgxr as three migrations:
--   20260911 premium_waitlist_capture_contract
--   20260911 hs_premium_waitlist_admin_read
--   20260911 hs_premium_waitlist_join_public_write_path
--   20260912 premium_waitlist_address_context   (Fix 15 — the address column below)
--   20260912 premium_waitlist_multi_interest_key (Fix 15 — UNIQUE(email, interest_key))
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
-- ============================================================================
-- ⚖️ MULTI-INTEREST — FOUNDER RULING, APPLIED 2026-09-12
-- ============================================================================
-- ONE PROSPECT MAY HOLD SEVERAL PREMIUM INTERESTS. The old contract was UNIQUE(email)
-- + `on conflict (email) do nothing`: one row per email, first touch wins, so a visitor
-- who asked about ZIP 78617 and later about 96 ISLAND DR was recorded once. Measured
-- before the change: the second call answered ok:true and the row was silently
-- discarded — the failure was invisible from the client.
--
-- The key is now UNIQUE (email, interest_key), where interest_key is computed by the
-- normalize TRIGGER below — ONE computation site, so an RPC call and a direct
-- service-role insert cannot disagree and no second copy of the rule exists in the
-- browser or the edge function.
--
-- ⛔ NOT `DO UPDATE`. That replaces the first signal with the latest and loses exactly
-- the same history from the other direction. The KEY widened; the conflict ACTION did
-- not change.
-- ⛔ NOT app_properties.id. Measured: it is a per-save ROW id, not a place identity —
-- 9 rows carry 9 ids over only 3 distinct address|zip values, and one user holds TWO
-- ids for 96 ISLAND DR (HS.saveHome inserts, never upserts). Keying on it would file
-- two records for one real interest.
--
-- COALESCE in the key is load-bearing, not defensive: Postgres treats NULLs as DISTINCT
-- in a unique index, so a key over the raw nullable columns would NEVER dedupe the
-- generic Premium interest (header "Go Premium": zip NULL, address NULL). That case
-- would fail silently — the exact class of defect this file exists to remove.

-- ---------------------------------------------------------------- the identity
-- ⚠️ KNOWN LIMIT, ACCEPTED BY THE FOUNDER AND DELIBERATELY NOT CLOSED IN FIX 15: this is
-- the LIGHT fold — case, punctuation and whitespace only. It does NOT expand
-- abbreviations, so `96 ISLAND DRIVE` and `96 ISLAND DR` are DIFFERENT identities.
-- Measured as unreachable through today's only writer of app_properties: HS.saveHome
-- stores the Census geocoder's own matchedAddress, and 9 of 9 stored rows are
-- USPS-abbreviated with 0 spelled-out street types. Closing it means porting
-- get-address-report's canonicalAddr abbreviation table into SQL — a SECOND normalizer
-- to keep in step. Revisit only if a second writer of app_properties appears.
create or replace function public.hs_premium_fold_address(p_address text)
returns text language sql immutable parallel safe as $$
  select btrim(regexp_replace(
           regexp_replace(upper(coalesce(p_address, '')), '[^A-Z0-9 ]', '', 'g'),
           '\s+', ' ', 'g'))
$$;

create or replace function public.hs_premium_interest_key(
  p_source text, p_zip text, p_address text
) returns text language sql immutable parallel safe as $$
  select lower(coalesce(p_source, ''))
      || '|' || coalesce(p_zip, '')
      || '|' || public.hs_premium_fold_address(p_address)
$$;

-- ---------------------------------------------------------------- source context
alter table public.app_premium_waitlist add column if not exists source  text;
alter table public.app_premium_waitlist add column if not exists zip     text;
alter table public.app_premium_waitlist add column if not exists address text;
alter table public.app_premium_waitlist add column if not exists interest_key text;

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
  -- Computed AFTER the field normalizations, so the key always derives from the values
  -- actually stored. Only the KEY is folded; the stored address keeps its own case.
  new.interest_key := public.hs_premium_interest_key(new.source, new.zip, new.address);
  return new;
end $$;

drop trigger if exists app_premium_waitlist_normalize on public.app_premium_waitlist;
create trigger app_premium_waitlist_normalize
  before insert or update on public.app_premium_waitlist
  for each row execute function public.tg_app_premium_waitlist_normalize();

update public.app_premium_waitlist
   set email = lower(btrim(email))
 where email <> lower(btrim(email));

-- ------------------------------------------------------------------- backfill
-- Deterministic, from the values ALREADY STORED. Nothing is inferred: a legacy
-- '/community.html?zip=78617' row is NOT relabelled 'ZIP Community Profile', because that
-- would be fabricated context. No row is deleted and no stored value is rewritten.
update public.app_premium_waitlist
   set interest_key = public.hs_premium_interest_key(source, zip, address)
 where interest_key is distinct from public.hs_premium_interest_key(source, zip, address);

-- Collapse only rows that normalization made IDENTICAL, keeping first touch.
-- ⚠️ THIS CLAUSE USED TO READ `where a.email = b.email`, WHICH WAS CORRECT UNDER
-- UNIQUE(email) AND IS DESTRUCTIVE UNDER THE CURRENT CONTRACT: replaying this file with
-- the old clause would delete every SECOND interest a prospect holds — the exact history
-- the multi-interest key exists to keep. A parked DDL is meant to be replayable, so the
-- clause moves with the contract. It is placed AFTER the backfill because interest_key
-- must be populated before it can be compared.
delete from public.app_premium_waitlist a
 using public.app_premium_waitlist b
 where a.email = b.email
   and a.interest_key = b.interest_key
   and (a.created_at, a.id) > (b.created_at, b.id);

-- ------------------------------------------- PROVE SAFETY *BEFORE* THE SWAP
-- Fails closed: if the live corpus would collide under the new key this raises and the
-- whole migration rolls back with the old key still in force. A migration that cannot
-- prove its precondition must not proceed. Measured at apply time: 42 rows -> 42 keys,
-- 0 collisions, 0 rows touched. That is structural, not luck — while UNIQUE(email)
-- holds, every email is distinct, so any key CONTAINING email is at least as selective.
do $$
declare n_rows int; n_keys int; n_null int;
begin
  select count(*), count(distinct (email, interest_key)), count(*) filter (where interest_key is null)
    into n_rows, n_keys, n_null
    from public.app_premium_waitlist;
  if n_null > 0 then
    raise exception 'PRECHECK a: % row(s) have a NULL interest_key after backfill', n_null;
  end if;
  if n_rows <> n_keys then
    raise exception 'PRECHECK b: % row(s) would collide under UNIQUE(email, interest_key)', n_rows - n_keys;
  end if;
end $$;

alter table public.app_premium_waitlist alter column interest_key set not null;

alter table public.app_premium_waitlist drop constraint if exists app_premium_waitlist_email_key;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_premium_waitlist_email_interest_key') then
    alter table public.app_premium_waitlist
      add constraint app_premium_waitlist_email_interest_key unique (email, interest_key);
  end if;
end $$;

create index if not exists app_premium_waitlist_created_at_idx
  on public.app_premium_waitlist (created_at desc);
-- An email is no longer unique, so the lead log and per-prospect grouping need it indexed.
create index if not exists app_premium_waitlist_email_idx
  on public.app_premium_waitlist (email);

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

  -- interest_key is supplied by the BEFORE INSERT trigger, which runs before the
  -- conflict is arbitrated — so the arbiter sees the computed value, and no caller can
  -- submit a key of its own.
  insert into public.app_premium_waitlist (email, source, zip, address)
  values (e, s, z, a)
  on conflict (email, interest_key) do nothing;

  -- Deliberately uniform for a new interest AND a repeat of one already held: the
  -- response must not reveal whether this address, or this interest, was already
  -- recorded.
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
    -- `prospects` is PEOPLE and `total` is SIGNALS. They were necessarily equal while
    -- UNIQUE(email) stood, which is why the dashboard's "Premium prospects" tile was
    -- accidentally right reading `total`; it now reads `prospects` explicitly.
    'prospects', (select count(distinct email) from public.app_premium_waitlist),
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
   where conname='app_premium_waitlist_email_interest_key' and contype='u';
  select count(*) into n_tab from information_schema.role_table_grants
   where table_schema='public' and table_name='app_premium_waitlist' and grantee in ('anon','authenticated');
  select count(*) into n_join from information_schema.role_routine_grants
   where routine_schema='public' and routine_name='hs_premium_waitlist_join' and grantee in ('anon','authenticated');
  select count(*) into n_read_anon from information_schema.role_routine_grants
   where routine_schema='public' and routine_name='hs_premium_waitlist' and grantee in ('anon','PUBLIC');
  select count(*) into n_read_auth from information_schema.role_routine_grants
   where routine_schema='public' and routine_name='hs_premium_waitlist' and grantee='authenticated';
  select count(*) into n_dupes from (
    select 1 from public.app_premium_waitlist group by email, interest_key having count(*) > 1) d;
  select count(*) into n_join3 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='hs_premium_waitlist_join' and p.pronargs <> 4;
  select count(*) into n_addr from information_schema.columns
   where table_schema='public' and table_name='app_premium_waitlist' and column_name='address';

  if n_unique    <> 1 then raise exception 'a: UNIQUE(email, interest_key) not established (%)', n_unique; end if;
  if exists (select 1 from pg_constraint where conname='app_premium_waitlist_email_key') then
    raise exception 'a2: UNIQUE(email) survives — multi-interest cannot work';
  end if;
  if n_tab       <> 0 then raise exception 'b: public roles still hold table privileges (%)', n_tab; end if;
  if n_join      <> 2 then raise exception 'c: join RPC not executable by anon+authenticated (%)', n_join; end if;
  if n_read_anon <> 0 then raise exception 'd: anon/PUBLIC can execute the admin read (%)', n_read_anon; end if;
  if n_read_auth <> 1 then raise exception 'e: authenticated cannot execute the admin read (%)', n_read_auth; end if;
  if n_dupes     <> 0 then raise exception 'f: duplicate (email, interest_key) pairs remain (%)', n_dupes; end if;
  if n_join3     <> 0 then raise exception 'g: a non-4-arg join overload survives, calls would be ambiguous (%)', n_join3; end if;
  if n_addr      <> 1 then raise exception 'h: address column missing (%)', n_addr; end if;
end $$;

-- HomeSignal — ZIP coverage-request capture contract (DDL of record)
--
-- Fix 13. Parked here so the schema stays reproducible (CLAUDE.md §1, source #3).
-- Apply path: db-sql.yml on merge to main (docs/*-capture.sql). Also valid in the
-- Supabase SQL editor on project qwnnmljucajnexpxdgxr. The client only reports
-- "Request received" after hs_community_request_join returns { ok: true }.
--
-- ============================================================================
-- WHAT WAS BROKEN
-- ============================================================================
-- The Add-ZIP modal (and onboarding) told every visitor "Request received —
-- we'll email you the moment <ZIP> is live" and captured nobody.
-- docs/persist-email-caller-audit.md, measured 2026-09-11 through PostgREST
-- with the real anon key (pg_net), sending the exact row shape shell.js sent:
--
--   POST /rest/v1/community_requests   {"email":"…","zip":"78617"}
--     -> HTTP 400  {"code":"PGRST204",
--                   "message":"Could not find the 'zip' column of
--                    'community_requests' in the schema cache"}
--
--   POST /rest/v1/community_requests   {"email":"…","requested_zip":"78617"}
--     -> HTTP 401  {"code":"42501","message":"permission denied for table
--                    community_requests",
--                   "hint":"GRANT INSERT ON public.community_requests TO anon;"}
--
-- Three independent faults, any one fatal:
--   1. the client sent `zip`; the column is `requested_zip` (no `zip` column)
--   2. anon holds no INSERT grant
--   3. RLS is enabled with zero policies, so it denies regardless of grants
--
-- Control: the table held 5 rows, newest created_at 2026-06-27 — nothing had
-- landed through this path in ~2.5 months. persistEmail then showed success
-- unconditionally (a PostgREST rejection RESOLVES with { error }, it does not
-- throw, so even the catch was beside the point).
--
-- ============================================================================
-- WHY THE PUBLIC WRITE PATH IS AN RPC AND NOT A TABLE INSERT
-- ============================================================================
-- Same evidence as docs/premium-waitlist-capture.sql, not preference:
--
--   * plain INSERT against UNIQUE(email, requested_zip) answers 23505 on a
--     repeat. That is an email-EXISTENCE ORACLE any anonymous caller could mine.
--   * INSERT ... ON CONFLICT DO NOTHING hides the oracle, but Postgres requires
--     SELECT on the arbiter columns, which would force a SELECT grant back onto
--     anon. Measured on the waitlist table: with SELECT revoked, anon's upsert
--     returned HTTP 401 42501.
--   * a SECURITY DEFINER function owned by postgres does the dedupe with NO anon
--     privilege on the table at all, and answers identically for a new request
--     and a repeat.
--
-- Net posture: anon can call one narrow validating function and nothing else.
-- It cannot read the table, enumerate it, or learn whether an address already
-- asked for a ZIP. The founder reads emails through hs_community_requests,
-- gated on dashboard_admins — the same shape as hs_premium_waitlist.
--
-- The submit-public-form edge function (service-role, ingest repo) remains a
-- second writer for the homepage path. It is not changed here. Unique
-- (email, requested_zip) makes a same-pair retry from either writer collapse
-- rather than duplicate.

-- ------------------------------------------- normalization + one logical request
-- Normalization is enforced in the DATABASE, not only in the client, so uniqueness
-- cannot drift if another caller ever writes this table.
create or replace function public.tg_community_requests_normalize()
returns trigger language plpgsql as $$
begin
  new.email := lower(btrim(new.email));
  new.requested_zip := nullif(btrim(coalesce(new.requested_zip, '')), '');
  new.source := nullif(btrim(coalesce(new.source, '')), '');
  return new;
end $$;

drop trigger if exists community_requests_normalize on public.community_requests;
create trigger community_requests_normalize
  before insert or update on public.community_requests
  for each row execute function public.tg_community_requests_normalize();

update public.community_requests
   set email = lower(btrim(email))
 where email <> lower(btrim(email));

update public.community_requests
   set requested_zip = nullif(btrim(requested_zip), '')
 where requested_zip is not null
   and requested_zip is distinct from nullif(btrim(requested_zip), '');

-- collapse any duplicates normalization created, KEEPING FIRST TOUCH
delete from public.community_requests a
 using public.community_requests b
 where lower(btrim(a.email)) = lower(btrim(b.email))
   and coalesce(a.requested_zip, '') = coalesce(b.requested_zip, '')
   and (a.created_at, a.ctid) > (b.created_at, b.ctid);

-- One email may request many ZIPs. Same email + same ZIP is a repeat, not a
-- second waitlist row. If a unique(email) ever existed (PLAN.md sketched one),
-- it would block a second ZIP from the same person — drop it.
alter table public.community_requests
  drop constraint if exists community_requests_email_key;
alter table public.community_requests
  drop constraint if exists unique_email;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'community_requests_email_zip_key'
  ) then
    alter table public.community_requests
      add constraint community_requests_email_zip_key
      unique (email, requested_zip);
  end if;
end $$;

create index if not exists community_requests_zip_idx
  on public.community_requests (requested_zip);

create index if not exists community_requests_created_at_idx
  on public.community_requests (created_at desc);

-- ------------------------------------------------------ the public write path
create or replace function public.hs_community_request_join(
  p_email  text,
  p_zip    text,
  p_source text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e text; z text; s text;
begin
  e := lower(btrim(coalesce(p_email, '')));
  if e = ''
     or char_length(e) > 320
     or e !~ '^[^[:space:]@]+@[^[:space:]@.]+([.][^[:space:]@.]+)+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  -- A coverage request without a real ZIP is not a coverage request. Anything
  -- else is refused rather than stored, guessed, or inferred.
  z := nullif(btrim(coalesce(p_zip, '')), '');
  if z is null or z !~ '^[0-9]{5}$' then
    raise exception 'invalid zip' using errcode = '22023';
  end if;

  s := nullif(btrim(coalesce(p_source, '')), '');
  if s is not null and char_length(s) > 200 then s := left(s, 200); end if;

  insert into public.community_requests (email, requested_zip, source)
  values (e, z, s)
  on conflict (email, requested_zip) do nothing;

  -- Deliberately uniform for a new request AND a repeat: the response must not
  -- reveal whether this address had already asked for this ZIP.
  return jsonb_build_object('ok', true, 'email', e, 'zip', z);
end
$function$;

revoke all on function public.hs_community_request_join(text, text, text) from public;
grant execute on function public.hs_community_request_join(text, text, text) to anon, authenticated;

-- ----------------------------------------------------- the privileged admin read
-- Same shape as hs_premium_waitlist. Gate: KPI + lead log are ONE call over ONE
-- table, so they cannot drift apart. p_zip, when a real 5-digit ZIP, returns
-- only that ZIP's rows — that is the "we just added 90025, email these people"
-- lookup. Anything else (null, blank, malformed) returns the full newest-first
-- log rather than guessing.
create or replace function public.hs_community_requests(
  p_zip   text default null,
  p_limit int default 500
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  caller_email text := auth.jwt() ->> 'email';
  n            int;
  z            text;
  result       jsonb;
begin
  if caller_email is null
     or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  n := least(greatest(coalesce(p_limit, 500), 1), 2000);
  z := nullif(btrim(coalesce(p_zip, '')), '');
  if z is not null and z !~ '^[0-9]{5}$' then z := null; end if;

  select jsonb_build_object(
    'generated_at', now(),
    'total',    (select count(*) from public.community_requests),
    'last_7d',  (select count(*) from public.community_requests where created_at >= now() - interval '7 days'),
    'last_30d', (select count(*) from public.community_requests where created_at >= now() - interval '30 days'),
    'distinct_zips', (select count(distinct requested_zip) from public.community_requests where requested_zip is not null),
    'filter_zip', z,
    'row_limit', n,
    'by_zip', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select requested_zip as zip, count(*)::int as count
          from public.community_requests
         where requested_zip is not null
           and (z is null or requested_zip = z)
         group by requested_zip
         order by count(*) desc, requested_zip asc
         limit 200
      ) t), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select email, requested_zip, requested_community, source, created_at
          from public.community_requests
         where (z is null or requested_zip = z)
         order by created_at desc, email asc
         limit n
      ) t), '[]'::jsonb)
  ) into result;

  return result;
end
$function$;

revoke all on function public.hs_community_requests(text, int) from public;
revoke all on function public.hs_community_requests(text, int) from anon;
grant execute on function public.hs_community_requests(text, int) to authenticated;

-- --------------------------------------------------------------- the boundary
-- The table stays closed to the public roles. Direct INSERT is not restored:
-- that was the posture that made the broken client look plausible (PLAN.md
-- promised an insert policy that production never had). Service-role writers
-- (submit-public-form) and this SECURITY DEFINER function are the only paths.
revoke all on table public.community_requests from anon, authenticated;

-- ============================================================================
-- POST-APPLY INVARIANTS — this file refuses to report success over nothing.
-- ============================================================================
do $$
declare
  n_unique int; n_tab int; n_join int; n_read_anon int; n_read_auth int; n_dupes int;
begin
  select count(*) into n_unique from pg_constraint
   where conname = 'community_requests_email_zip_key' and contype = 'u';
  select count(*) into n_tab from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'community_requests'
     and grantee in ('anon', 'authenticated');
  select count(*) into n_join from information_schema.role_routine_grants
   where routine_schema = 'public' and routine_name = 'hs_community_request_join'
     and grantee in ('anon', 'authenticated');
  select count(*) into n_read_anon from information_schema.role_routine_grants
   where routine_schema = 'public' and routine_name = 'hs_community_requests'
     and grantee in ('anon', 'PUBLIC');
  select count(*) into n_read_auth from information_schema.role_routine_grants
   where routine_schema = 'public' and routine_name = 'hs_community_requests'
     and grantee = 'authenticated';
  select count(*) into n_dupes from (
    select 1 from public.community_requests
     group by email, requested_zip having count(*) > 1) d;

  if n_unique    <> 1 then raise exception 'a: unique(email, requested_zip) not established (%)', n_unique; end if;
  if n_tab       <> 0 then raise exception 'b: public roles still hold table privileges (%)', n_tab; end if;
  if n_join      <> 2 then raise exception 'c: join RPC not executable by anon+authenticated (%)', n_join; end if;
  if n_read_anon <> 0 then raise exception 'd: anon/PUBLIC can execute the admin read (%)', n_read_anon; end if;
  if n_read_auth <> 1 then raise exception 'e: authenticated cannot execute the admin read (%)', n_read_auth; end if;
  if n_dupes     <> 0 then raise exception 'f: duplicate (email, zip) rows remain (%)', n_dupes; end if;
end $$;

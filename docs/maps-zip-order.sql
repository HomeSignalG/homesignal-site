-- ============================================================================
-- MAPS (ALL THEMES) — FOUNDER-ORDERED ZIP LIST + "GENERATE DRAFTS" BUTTON — DDL of record
-- (2026-10-15)
--
-- A SECOND, INDEPENDENT copy of docs/maps-dc-zip-order.sql and
-- docs/maps-dc-generation-request.sql. The Data Center list (public.maps_dc_zip_order) and
-- this list (public.maps_zip_order) are separate tables with separate RPCs and a separate
-- request log, so the founder can manage, say, Pierce County WA and Denton County TX for
-- ordinary MAPS posts without touching the Data Center ZIPs, and the reverse.
--
-- WHAT THIS IS NOT. It is not a generator and decides no eligibility. The button dispatches
-- the EXISTING homesignal-ingest workflow bluesky-generate-maps.yml with `maps_order=true`,
-- which runs the EXISTING bluesky/generate-maps.mjs --maps-order. That mode reads
-- public.maps_zip_order, drafts ordinary MAPS posts for ONLY those ZIPs, in that order.
--
-- ⛔ APPLY ORDER IS NOT OPTIONAL. A workflow_dispatch carrying an input the target workflow
-- does not DECLARE is rejected by GitHub with HTTP 422. The ingest PR that declares
-- `maps_order` must be merged to homesignal-ingest main BEFORE this file is applied, or the
-- button breaks outright. (Same lesson as the `refresh` input, 2026-09-21.)
--
-- Idempotent and executable; replaying it reproduces the intended state. RLS on, anon revoked,
-- founder-only, exactly like the Data Center list.
-- ============================================================================

create table if not exists public.maps_zip_order (
  founder_position integer not null,
  zip text not null,
  uploaded_at timestamp with time zone not null default now(),

  -- Position is the identity: founder priority #1 is one row, always.
  constraint maps_zip_order_pkey PRIMARY KEY (founder_position),

  -- A ZIP appears at most once. Upload validation reports duplicates to the founder with
  -- a readable message; this is the backstop that makes a duplicate structurally
  -- impossible even if a future writer skips that path.
  constraint maps_zip_order_zip_unique UNIQUE (zip),

  -- ZIP IS TEXT AND MUST STAY FIVE DIGITS. This is what keeps 07446 from becoming 7446:
  -- an integer column would silently drop the leading zero, and a numeric round-trip
  -- anywhere in the stack would fail this check rather than corrupt the value quietly.
  constraint maps_zip_order_zip_format CHECK (zip ~ '^[0-9]{5}$'),

  -- Founder priority is 1-based and contiguous-by-convention; 0 or negative is a bug.
  constraint maps_zip_order_position_positive CHECK (founder_position >= 1)
);

create index if not exists maps_zip_order_zip_idx on public.maps_zip_order (zip);

-- RLS ON, and the policy is a byte-for-byte mirror of social_posts_owner_all so this
-- table can never be more permissive than the queue it feeds.
alter table public.maps_zip_order enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polrelid = 'public.maps_zip_order'::regclass
                   and polname = 'maps_zip_order_owner_all') then
    create policy maps_zip_order_owner_all on public.maps_zip_order
      for all to authenticated
      using ((auth.jwt() ->> 'email') = 'sdsutca@proton.me')
      with check ((auth.jwt() ->> 'email') = 'sdsutca@proton.me');
  end if;
end $$;

-- DELIBERATELY TIGHTER THAN social_posts. That table grants to anon and relies on RLS
-- alone; a founder-only config table has no anonymous use case at all, so anon is
-- revoked outright and the grant is the first gate rather than the only one. This is a
-- more conservative posture than the table it mirrors, never a looser one.
revoke all on public.maps_zip_order from anon;
grant select, insert, update, delete on public.maps_zip_order to authenticated;
grant select, insert, update, delete on public.maps_zip_order to service_role;

-- Fail closed. If a future edit inverts either half of the posture, replaying this file
-- raises instead of quietly reproducing an exposure.
do $$
begin
  if has_table_privilege('anon', 'public.maps_zip_order', 'SELECT') then
    raise exception 'maps_zip_order must NOT be anon-readable; it is a founder-only control';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.maps_zip_order'::regclass) then
    raise exception 'maps_zip_order must have RLS enabled';
  end if;
end $$;

-- ============================================================================
-- THE WRITE PATH — one transaction, or nothing.
--
-- WHY AN RPC RATHER THAN delete()+insert() FROM THE PAGE. Replacing the list is two
-- statements. From the browser they are two round trips, so a failure between them leaves
-- the founder with an EMPTY list — their previous ordering destroyed by a half-completed
-- replace. Inside one function they are one transaction: the new list lands whole or the
-- old one is still there.
--
-- It also puts the CSV contract on the server. The page validates so the founder gets a
-- readable error, but validation that exists only in a browser is a convenience, not a
-- control — a future caller that skips the page would otherwise bypass every rule.
-- ============================================================================
create or replace function public.hs_set_maps_zip_order(p_zips text[])
returns table(founder_position integer, zip text, uploaded_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer := coalesce(array_length(p_zips, 1), 0);
  stamp timestamp with time zone := now();
begin
  -- Same predicate as the RLS policy and social_posts_owner_all. SECURITY DEFINER
  -- bypasses RLS, so this check is the gate, not a second opinion.
  if coalesce((auth.jwt() ->> 'email'), '') <> 'sdsutca@proton.me' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if n > 500 then
    raise exception 'list has % ZIPs; the maximum is 500', n using errcode = '22023';
  end if;

  -- Reject the whole upload rather than accepting part of it: a partial accept would
  -- shift every later founder priority number, which is the renumbering the product
  -- contract forbids.
  if exists (select 1 from unnest(p_zips) z where z !~ '^[0-9]{5}$') then
    raise exception 'every ZIP must be exactly 5 digits' using errcode = '22023';
  end if;
  if (select count(distinct z) from unnest(p_zips) z) <> n then
    raise exception 'duplicate ZIP in list' using errcode = '22023';
  end if;

  delete from public.maps_zip_order;

  -- WITH ORDINALITY is the whole point: array position becomes founder priority, so the
  -- order the founder uploaded is the order stored, with no sort anywhere in between.
  if n > 0 then
    insert into public.maps_zip_order (founder_position, zip, uploaded_at)
    select ord::integer, z, stamp from unnest(p_zips) with ordinality as t(z, ord);
  end if;

  return query
    select o.founder_position, o.zip, o.uploaded_at
    from public.maps_zip_order o order by o.founder_position;
end;
$function$;

alter function public.hs_set_maps_zip_order(text[]) owner to postgres;
revoke all on function public.hs_set_maps_zip_order(text[]) from public, anon;
grant execute on function public.hs_set_maps_zip_order(text[]) to authenticated;

create table if not exists public.maps_generation_request (
  id             bigint generated always as identity primary key,
  requested_at   timestamptz not null default now(),
  requested_by   text        not null,
  zip_count      integer     not null,
  run_limit      integer     not null,
  net_request_id bigint
);

-- RLS ON with NO anon/authenticated grant. Reads go through the SECURITY DEFINER status
-- function below, so there is no direct read to enable by accident. Deliberately NOT
-- modelled on public.page_cache, which CLAUDE.md flags as RLS-disabled and anon-writable.
alter table public.maps_generation_request enable row level security;
revoke all on public.maps_generation_request from anon, authenticated;

create index if not exists maps_generation_request_requested_at_idx
  on public.maps_generation_request (requested_at desc);

-- ── THE BUTTON ──────────────────────────────────────────────────────────────
create or replace function public.hs_request_maps_generation()
returns table (net_request_id bigint, zip_count integer, run_limit integer)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp'
as $function$
declare
  _email  text := coalesce((auth.jwt() ->> 'email'), '');
  _zips   integer;
  _limit  integer;
  _pat    text;
  _req    bigint;
  _recent timestamptz;
begin
  -- The SAME gate as hs_set_maps_zip_order, stated the same way rather than a second
  -- notion of "admin" that could drift from it.
  if _email <> 'sdsutca@proton.me' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select count(*) into _zips from public.maps_zip_order;
  if _zips = 0 then
    raise exception 'the Maps ZIP list is empty; upload a CSV before generating'
      using errcode = '22023';
  end if;

  -- DOUBLE-CLICK GUARD. Each dispatch costs a runner and writes drafts, so two clicks a
  -- second apart must not become two runs. 2 minutes is short enough to retry a genuine
  -- failure and long enough that an impatient second click is absorbed.
  select max(requested_at) into _recent from public.maps_generation_request;
  if _recent is not null and _recent > now() - interval '2 minutes' then
    raise exception 'a generation run was requested at %; wait 2 minutes before requesting another',
      to_char(_recent, 'HH24:MI:SS') using errcode = '55006';
  end if;

  -- One draft per ZIP is the curated contract, so the run limit IS the list length.
  -- DERIVED rather than stored, so the two cannot disagree after a CSV upload.
  --
  -- ⚠️ IT BOUNDS CREATES ONLY, AND THAT IS CORRECT RATHER THAN AN OVERSIGHT. `--limit`
  -- caps how many NEW drafts a run inserts; the refresh pass is bounded by a different
  -- thing — the founder's own ZIP list, since it only ever touches existing drafts on
  -- those ZIPs. Applying the create limit to the refresh would leave some of the
  -- founder's ZIPs carrying superseded copy with nothing saying which, which is the
  -- invisible-drift shape this requirement exists to end.
  _limit := _zips;

  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then
    raise exception 'no GitHub token is stored (vault secret github_actions_pat); the run cannot be dispatched'
      using errcode = '28000';
  end if;

  -- GitHub REQUIRES a User-Agent and rejects the request outright without one.
  select net.http_post(
    url     := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/bluesky-generate-maps.yml/dispatches',
    body    := jsonb_build_object(
                 'ref', 'main',
                 -- ⚖️ 2026-09-21: `refresh` is the founder's create-AND-refresh requirement.
                 -- Sent as the STRING 'true' because workflow_dispatch inputs are strings
                 -- over the API even when the workflow declares them `type: boolean`.
                 'inputs', jsonb_build_object('apply', 'true', 'limit', _limit::text,
                                              'zips', '', 'refresh', 'true',
                                              'maps_order', 'true')),
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || _pat,
                 'Accept', 'application/vnd.github+json',
                 'X-GitHub-Api-Version', '2022-11-28',
                 'User-Agent', 'homesignal-acquisition-dashboard',
                 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000
  ) into _req;

  insert into public.maps_generation_request (requested_by, zip_count, run_limit, net_request_id)
  values (_email, _zips, _limit, _req);

  return query select _req, _zips, _limit;
end;
$function$;

-- ── DID GITHUB ACTUALLY ACCEPT IT? ──────────────────────────────────────────
-- Read separately because the answer does not exist yet when the button returns.
-- `pending` is a real third state and is reported as one: a response that has not
-- arrived yet and a response that never will look identical otherwise, which is the
-- failure this whole file is shaped by. A successful workflow_dispatch is 204 + EMPTY
-- body, so "no content" is success here and must not be read as an empty answer.
create or replace function public.hs_maps_generation_status()
returns table (requested_at timestamptz, zip_count integer, http_status integer,
               state text, detail text)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp'
as $function$
declare
  _email text := coalesce((auth.jwt() ->> 'email'), '');
begin
  if _email <> 'sdsutca@proton.me' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select r.requested_at,
         r.zip_count,
         resp.status_code,
         case
           when resp.id is null and r.requested_at > now() - interval '2 minutes' then 'pending'
           when resp.id is null then 'no_response'
           when resp.status_code = 204 then 'accepted'
           when resp.status_code = 401 then 'bad_credential'
           else 'rejected'
         end,
         case
           when resp.id is null and r.requested_at > now() - interval '2 minutes'
             then 'waiting for GitHub to answer'
           when resp.id is null
             then 'no response was ever recorded for this request'
           when resp.status_code = 204
             then 'GitHub accepted the run; drafts appear once it finishes'
           when resp.status_code = 401
             then 'GitHub rejected the stored token (vault github_actions_pat) — it needs re-minting'
           else coalesce(left(resp.content, 300), resp.error_msg, 'no detail')
         end
    from public.maps_generation_request r
    left join net._http_response resp on resp.id = r.net_request_id
   order by r.requested_at desc
   limit 1;
end;
$function$;

grant execute on function public.hs_request_maps_generation() to authenticated;
grant execute on function public.hs_maps_generation_status() to authenticated;


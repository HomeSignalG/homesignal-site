-- ============================================================================
-- MAPS · DATA CENTER THEME — FOUNDER-ORDERED ZIP LIST — DDL of record
--
-- CLAUDE.md section 1 makes docs/*.sql the schema of record. This file is the
-- EXECUTABLE, idempotent record of the applied migration `maps_dc_zip_order_v1`.
-- Replaying it must reproduce the live state, so nothing load-bearing is a comment.
--
-- WHAT THIS IS. One founder input control, and nothing else: the ordered list of ZIPs
-- the founder wants the EXISTING MAPS · Data Center Theme draft generator
-- (homesignal-ingest bluesky/generate-maps.mjs) to consider, in the order given.
--
-- WHAT IT IS NOT. It is not a queue, not a post, not an approval state, and it has no
-- relationship to public.social_posts. The founder's ordered INPUT and the social-post
-- HISTORY are separate concerns: replacing this list must never touch a draft, an
-- approved post, a scheduled post or a published one. Keeping them in separate tables
-- is what makes that structural rather than a rule someone has to remember.
--
-- WHY A TABLE AT ALL. All 167 public tables were enumerated before this was created:
-- there is no generic settings/config/key-value store to reuse. epa_recovery_config is
-- a purpose-built singleton; dashboard_admins/social_admins are membership lists. The
-- alternatives were rejected on the record — putting it on social_posts is forbidden
-- (input vs history), a committed data/*.json cannot be written by a static browser page
-- without shipping a git token, and object storage gives no ordering or uniqueness
-- guarantee. Founder approved the table on 2026-09-15.
--
-- THE ORDER IS THE PRODUCT. founder_position is the PRIMARY KEY, so two ZIPs can never
-- claim the same priority, and a read ordered by it is deterministic by construction.
-- ============================================================================

create table if not exists public.maps_dc_zip_order (
  founder_position integer not null,
  zip text not null,
  uploaded_at timestamp with time zone not null default now(),

  -- Position is the identity: founder priority #1 is one row, always.
  constraint maps_dc_zip_order_pkey PRIMARY KEY (founder_position),

  -- A ZIP appears at most once. Upload validation reports duplicates to the founder with
  -- a readable message; this is the backstop that makes a duplicate structurally
  -- impossible even if a future writer skips that path.
  constraint maps_dc_zip_order_zip_unique UNIQUE (zip),

  -- ZIP IS TEXT AND MUST STAY FIVE DIGITS. This is what keeps 07446 from becoming 7446:
  -- an integer column would silently drop the leading zero, and a numeric round-trip
  -- anywhere in the stack would fail this check rather than corrupt the value quietly.
  constraint maps_dc_zip_order_zip_format CHECK (zip ~ '^[0-9]{5}$'),

  -- Founder priority is 1-based and contiguous-by-convention; 0 or negative is a bug.
  constraint maps_dc_zip_order_position_positive CHECK (founder_position >= 1)
);

create index if not exists maps_dc_zip_order_zip_idx on public.maps_dc_zip_order (zip);

-- RLS ON, and the policy is a byte-for-byte mirror of social_posts_owner_all so this
-- table can never be more permissive than the queue it feeds.
alter table public.maps_dc_zip_order enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polrelid = 'public.maps_dc_zip_order'::regclass
                   and polname = 'maps_dc_zip_order_owner_all') then
    create policy maps_dc_zip_order_owner_all on public.maps_dc_zip_order
      for all to authenticated
      using ((auth.jwt() ->> 'email') = 'sdsutca@proton.me')
      with check ((auth.jwt() ->> 'email') = 'sdsutca@proton.me');
  end if;
end $$;

-- DELIBERATELY TIGHTER THAN social_posts. That table grants to anon and relies on RLS
-- alone; a founder-only config table has no anonymous use case at all, so anon is
-- revoked outright and the grant is the first gate rather than the only one. This is a
-- more conservative posture than the table it mirrors, never a looser one.
revoke all on public.maps_dc_zip_order from anon;
grant select, insert, update, delete on public.maps_dc_zip_order to authenticated;
grant select, insert, update, delete on public.maps_dc_zip_order to service_role;

-- Fail closed. If a future edit inverts either half of the posture, replaying this file
-- raises instead of quietly reproducing an exposure.
do $$
begin
  if has_table_privilege('anon', 'public.maps_dc_zip_order', 'SELECT') then
    raise exception 'maps_dc_zip_order must NOT be anon-readable; it is a founder-only control';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.maps_dc_zip_order'::regclass) then
    raise exception 'maps_dc_zip_order must have RLS enabled';
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
create or replace function public.hs_set_maps_dc_zip_order(p_zips text[])
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

  delete from public.maps_dc_zip_order;

  -- WITH ORDINALITY is the whole point: array position becomes founder priority, so the
  -- order the founder uploaded is the order stored, with no sort anywhere in between.
  if n > 0 then
    insert into public.maps_dc_zip_order (founder_position, zip, uploaded_at)
    select ord::integer, z, stamp from unnest(p_zips) with ordinality as t(z, ord);
  end if;

  return query
    select o.founder_position, o.zip, o.uploaded_at
    from public.maps_dc_zip_order o order by o.founder_position;
end;
$function$;

alter function public.hs_set_maps_dc_zip_order(text[]) owner to postgres;
revoke all on function public.hs_set_maps_dc_zip_order(text[]) from public, anon;
grant execute on function public.hs_set_maps_dc_zip_order(text[]) to authenticated;

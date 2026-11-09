-- ============================================================================
-- EVERY DEVELOPMENT-ALERT SUBSCRIBER'S ZIP IS ON THE MAPS POST LIST ⚖️ FOUNDER (2026-11-09)
--
-- Founder, verbatim in substance: "when a new subscriber signs up for the development map
-- alerts we need to add their zip code to the bluesky post. otherwise they will never get
-- any emails. even if they add an address we need to add their zip code."
--
-- WHY. The MAPS email ("What is changing in my zip code?") sends copies of PUBLISHED Bluesky
-- MAPS posts whose social_posts.zip is the subscriber's ZIP (homesignal-ingest digest.py).
-- A ZIP with no MAPS post never produces an email. MAPS drafts for chosen ZIPs come from
-- public.maps_zip_order (the dashboard's "All Maps" list, generate-maps.mjs --maps-order).
-- So a subscriber whose ZIP is not on that list waits forever. Found 2026-11-09 for 85083
-- and 64166, which the founder then added by hand.
--
-- THE RULE, ONE DECISION: public.maps_zip_order_sync_subscribers() appends, at the END of
-- the list, every ZIP that has an active maps subscriber and is not already on it.
--   * "Active maps subscriber" is read from the canonical resolver
--     public.alert_subscription_state (stream 'maps', subscribed = true), never re-derived.
--   * The ZIP is the subscription's own community (a maps selection is always filed on a
--     level='zip' community, enforced by user_subscriptions_maps_zip_scoped). So it is the
--     same ZIP whether the resident signed up from the ZIP page or after an address search.
--   * Append only. The founder's order is never changed; nothing is ever removed (an
--     unsubscribe leaves the ZIP; the founder can take it off, but a later save re-adds it
--     while a subscriber remains).
-- It runs:
--   1. after any insert/update on public.user_subscriptions (a new sign-up);
--   2. after users.unsubscribed / alert_email_consent / community_id change (a re-subscribe);
--   3. at the end of hs_set_maps_zip_order (a founder upload that omits a subscriber ZIP gets
--      it appended after the founder's list, so an upload can never drop a subscriber);
--   4. once, when this file is applied (backfill).
-- The triggers can never block a sign-up: a failure is a WARNING and the sign-up commits.
--
-- It does NOT create drafts. Drafts still come from "Create + refresh drafts" in the
-- dashboard's All Maps view (or a maps_order dispatch), exactly as before.
--
-- Idempotent. Apply after docs/maps-zip-order.sql and docs/alert-subscription-canonical-a12.sql.
-- Test: test/maps_zip_order_subscribers_pg (disposable Postgres).
-- ============================================================================

-- ---------------------------------------------------------------- the one rule
create or replace function public.maps_zip_order_sync_subscribers()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  added integer := 0;
  next_pos integer;
  z text;
begin
  -- Two sign-ups at once must not both take the same next position (the primary key).
  perform pg_advisory_xact_lock(hashtext('public.maps_zip_order'));
  select coalesce(max(o.founder_position), 0) into next_pos from public.maps_zip_order o;
  for z in
    select x.zip from (
      select distinct c.zip_codes[1] as zip
      from public.alert_subscription_state s
      join public.communities c on c.id = s.community_id
      where s.stream = 'maps' and s.subscribed
        and c.level = 'zip' and cardinality(c.zip_codes) = 1
        and c.zip_codes[1] ~ '^[0-9]{5}$'
        and not exists (select 1 from public.maps_zip_order o where o.zip = c.zip_codes[1])
    ) x
    order by x.zip collate "C"
  loop
    next_pos := next_pos + 1;
    insert into public.maps_zip_order (founder_position, zip, uploaded_at)
    values (next_pos, z, now());
    added := added + 1;
  end loop;
  return added;
end;
$function$;

alter function public.maps_zip_order_sync_subscribers() owner to postgres;
revoke all on function public.maps_zip_order_sync_subscribers() from public, anon, authenticated;
grant execute on function public.maps_zip_order_sync_subscribers() to service_role;

-- ---------------------------------------------------------------- triggers
create or replace function public.maps_zip_order_sync_subscribers_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    perform public.maps_zip_order_sync_subscribers();
  exception when others then
    -- Never block a sign-up over the post list.
    raise warning 'maps_zip_order_sync_subscribers failed: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$function$;

alter function public.maps_zip_order_sync_subscribers_trg() owner to postgres;
revoke all on function public.maps_zip_order_sync_subscribers_trg() from public, anon, authenticated;

drop trigger if exists user_subscriptions_maps_zip_order on public.user_subscriptions;
create trigger user_subscriptions_maps_zip_order
  after insert or update on public.user_subscriptions
  for each statement execute function public.maps_zip_order_sync_subscribers_trg();

drop trigger if exists users_maps_zip_order on public.users;
create trigger users_maps_zip_order
  after update of unsubscribed, alert_email_consent, community_id on public.users
  for each statement execute function public.maps_zip_order_sync_subscribers_trg();

-- ---------------------------------------------------------------- the founder upload
-- The live body (md5(prosrc) 7eca7b452cc07fd9a071398051042154, docs/maps-zip-order.sql)
-- with ONE addition: after the founder's list is stored, subscriber ZIPs it left out are
-- appended after it.
create or replace function public.hs_set_maps_zip_order(p_zips text[])
 RETURNS TABLE(founder_position integer, zip text, uploaded_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- WHERE true: the database refuses an unqualified DELETE (pg-safeupdate); same as the Data Center function.
  delete from public.maps_zip_order where true;

  -- WITH ORDINALITY is the whole point: array position becomes founder priority, so the
  -- order the founder uploaded is the order stored, with no sort anywhere in between.
  if n > 0 then
    insert into public.maps_zip_order (founder_position, zip, uploaded_at)
    select ord::integer, z, stamp from unnest(p_zips) with ordinality as t(z, ord);
  end if;

  -- Founder rule 2026-11-09: every development-alert subscriber's ZIP stays on the list.
  -- Appended AFTER the founder's order, which is unchanged.
  perform public.maps_zip_order_sync_subscribers();

  return query
    select o.founder_position, o.zip, o.uploaded_at
    from public.maps_zip_order o order by o.founder_position;
end;
$function$;

alter function public.hs_set_maps_zip_order(text[]) owner to postgres;
revoke all on function public.hs_set_maps_zip_order(text[]) from public, anon;
grant execute on function public.hs_set_maps_zip_order(text[]) to authenticated;

-- ---------------------------------------------------------------- backfill + checks
select public.maps_zip_order_sync_subscribers();

do $$
declare missing integer;
begin
  select count(*) into missing
  from public.alert_subscription_state s
  join public.communities c on c.id = s.community_id
  where s.stream = 'maps' and s.subscribed and c.level = 'zip' and cardinality(c.zip_codes) = 1
    and not exists (select 1 from public.maps_zip_order o where o.zip = c.zip_codes[1]);
  if missing <> 0 then
    raise exception 'after sync, % subscriber ZIP(s) are still missing from maps_zip_order', missing;
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in
        ('user_subscriptions_maps_zip_order', 'users_maps_zip_order')) <> 2 then
    raise exception 'subscriber-ZIP triggers are not both installed';
  end if;
  if has_function_privilege('anon', 'public.maps_zip_order_sync_subscribers()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.maps_zip_order_sync_subscribers()', 'EXECUTE') then
    raise exception 'maps_zip_order_sync_subscribers must not be callable by anon/authenticated';
  end if;
end $$;

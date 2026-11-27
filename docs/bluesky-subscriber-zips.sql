-- Tab 12: which ZIPs have a real subscriber of ANY alert type, and what each signed up for (2026-11-11; widened 2026-11-21). SQL of record. ADDITIVE: one admin-only reader.
--
-- WHY: the founder reviews new Bluesky MAPS drafts every morning and must see the drafts for subscriber ZIPs first
-- (a subscriber gets no email until a post about their ZIP is approved and published). The page cannot read the
-- subscriber list (service-role only), so it asks this function which ZIPs to put at the top.
--
-- TRUTH PATH (unchanged; this file only reads it)
--   digest_recipients (delivery) -> public.bsky_maps_priority_classification (homesignal-ingest
--   20261110180000_bsky_maps_priority_eligibility.sql: class 'eligible' = a real subscriber, not a test identity)
--   -> this reader -> Tab 12.
-- DECISION OWNER for "is this a real subscriber ZIP": that view. This file adds no rule of its own.
-- Returns ZIPs, counts and, per subscriber, their email and what they signed up for (admin-only; no user id).
--
-- (applied as ONE transaction by apply_migration; do not add begin/commit)

create or replace function public.hs_bsky_subscriber_zips()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  caller_email text := auth.jwt() ->> 'email';
  r jsonb;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Any alert type counts (founder, 2026-11-21). Same set the post list uses (maps_zip_order_sync_subscribers):
  -- a real subscriber is a resolver-subscribed identity that is not a known test identity.
  -- ⚖️ EMAIL ADDRESSES (founder, 2026-11-21: "put next to zip code what they signed up for and their email
  -- address"): returned ONLY by this function, which raises unless the caller is a dashboard admin (above).
  -- No other reader, table grant or log carries them.
  with q as (
    select s.user_id, s.email, s.stream,
           case when s.stream = 'maps' and c.level = 'zip' and cardinality(c.zip_codes) = 1
                then c.zip_codes[1] else s.zip_code end as zip
      from public.alert_subscription_state s
      join public.communities c on c.id = s.community_id
     where s.subscribed and not public.bsky_maps_known_test_identity(s.user_id)
  ), per_user as (
    select q.zip, q.user_id, min(q.email) as email, array_agg(distinct q.stream order by q.stream) as streams
      from q where q.zip ~ '^[0-9]{5}$'
     group by q.zip, q.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'zip', z.zip,
           'subscribers', z.n,
           'signed_up_for', z.streams,
           'people', z.people,
           'last_published_at', (
             select max(sp.published_at) from public.social_posts sp
              where sp.zip = z.zip and sp.content_family = 'MAPS' and sp.status = 'published'
                and not exists (select 1 from public.social_post_withdrawals w where w.social_post_id = sp.id))
         ) order by z.zip), '[]'::jsonb)
    into r
    from (select p.zip, count(*) as n,
                 (select array_agg(distinct st order by st) from per_user p2, unnest(p2.streams) st where p2.zip = p.zip) as streams,
                 jsonb_agg(jsonb_build_object('email', p.email, 'signed_up_for', p.streams) order by p.email) as people
            from per_user p group by p.zip) z;
  return jsonb_build_object('zips', r, 'as_of', now());
end $$;

revoke all on function public.hs_bsky_subscriber_zips() from public, anon;
grant execute on function public.hs_bsky_subscriber_zips() to authenticated;

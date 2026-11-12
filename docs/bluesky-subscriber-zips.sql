-- Tab 12: which ZIPs have a real Development-alert subscriber (2026-11-11). SQL of record. ADDITIVE: one admin-only reader.
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
-- Returns ZIPs and counts only. No email, no user id.
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
  select coalesce(jsonb_agg(jsonb_build_object(
           'zip', z.zip,
           'subscribers', z.n,
           'last_published_at', (
             select max(sp.published_at) from public.social_posts sp
              where sp.zip = z.zip and sp.content_family = 'MAPS' and sp.status = 'published'
                and not exists (select 1 from public.social_post_withdrawals w where w.social_post_id = sp.id))
         ) order by z.zip), '[]'::jsonb)
    into r
    from (select c.zip, count(*) as n
            from public.bsky_maps_priority_classification c
           where c.class = 'eligible' and c.zip ~ '^[0-9]{5}$'
           group by c.zip) z;
  return jsonb_build_object('zips', r, 'as_of', now());
end $$;

revoke all on function public.hs_bsky_subscriber_zips() from public, anon;
grant execute on function public.hs_bsky_subscriber_zips() to authenticated;

-- PARKED. NOT APPLIED. Do not run against production without the founder's approval.
--
-- WHY IT EXISTS. public.user_subscriptions is keyed (user_id, community_id, stream, topic) and
-- is foreign-keyed to communities and to users(id, community_id), so a resident on a ZIP with no
-- community can store no subscription at all. (As of 2026-11-26 52638 was the example; its page has
-- since been built, so the picker now saves it against its county root.) This table would hold
-- "I want <stream>/<topic> alerts for ZIP <zip>" for such a ZIP, so interest can be counted and
-- converted when coverage arrives.
--
-- WHAT IT IS NOT. It is not delivery. digest_recipients / alert_subscription_state never read it,
-- so a row here can never send an email. Nothing in the site reads or writes it yet; wiring it to
-- the picker is a separate, approved change. The picker says nothing is saved for such a ZIP.
--
-- Contracts it keeps: a ZIP is exactly five digits; (stream, topic) must exist in the catalog
-- (same FK as user_subscriptions); one row per (user, zip, stream, topic); a resident reads and
-- writes only their own rows; consent is NOT recorded here (alert_email_consent stays on users).

create table if not exists public.zip_pending_interest (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  zip         text not null check (zip ~ '^\d{5}$'),
  stream      text not null,
  topic       text not null,
  created_at  timestamptz not null default now(),
  converted_at timestamptz,                                  -- set when a community and a subscription exist
  constraint zip_pending_interest_catalog_fk
    foreign key (stream, topic) references public.alert_topic_catalog (stream, topic),
  constraint zip_pending_interest_uniq unique (user_id, zip, stream, topic)
);

alter table public.zip_pending_interest enable row level security;

create policy zip_pending_interest_own_select on public.zip_pending_interest
  for select to authenticated using (user_id = auth.uid());
create policy zip_pending_interest_own_insert on public.zip_pending_interest
  for insert to authenticated with check (user_id = auth.uid());
create policy zip_pending_interest_own_delete on public.zip_pending_interest
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.zip_pending_interest from anon;
revoke update on public.zip_pending_interest from authenticated;

-- OPTIONAL PRECISION UPGRADE (also parked). The picker currently infers "verified meeting
-- coverage" from stored meetings, because visitors cannot read public.feeds. That reads a county
-- whose feed is armed but has not written a row yet as "unavailable". This function would answer
-- from the feeds themselves, returning only a boolean per ZIP, never a feed row:
--
-- create or replace function public.zip_has_active_meetings_feed(p_zip text)
-- returns boolean language sql stable security definer set search_path = public as $$
--   with recursive leaf as (
--     select c.id, c.parent_id from public.communities c
--     where p_zip ~ '^\d{5}$' and c.zip_codes @> array[p_zip]
--     order by case c.level when 'zip' then 0 when 'city' then 1 when 'county' then 2 else 3 end, c.id limit 1),
--   chain as (select id, parent_id, 0 hop from leaf
--             union all select c.id, c.parent_id, ch.hop + 1 from chain ch
--             join public.communities c on c.id = ch.parent_id where ch.hop < 6)
--   select exists (select 1 from public.feeds f
--                  where f.active and f.target_table = 'meetings'
--                    and f.community_id in (select id::text from chain));
-- $$;
-- revoke execute on function public.zip_has_active_meetings_feed(text) from public;
-- grant execute on function public.zip_has_active_meetings_feed(text) to anon, authenticated;

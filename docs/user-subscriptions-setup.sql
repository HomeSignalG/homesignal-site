-- ============================================================
-- HomeSignal — user_subscriptions setup + backfill (increment 2)
-- Run in Supabase -> SQL Editor. Review before running.
-- The table user_subscriptions ALREADY EXISTS; this only adds a
-- uniqueness guard, RLS so the website can write, and a one-time
-- backfill of existing follows from users.topics.
-- ============================================================

-- 1) UNIQUENESS GUARD ------------------------------------------------
-- One row per (user, county, pipeline, topic). Makes writes idempotent
-- and lets the backfill be safely re-run. Table is empty today, so this
-- cannot fail on existing duplicates.
create unique index if not exists ux_user_subscriptions_unique
  on public.user_subscriptions (user_id, community_id, pipeline_type, topic);

-- 2) ROW-LEVEL SECURITY ---------------------------------------------
-- The website talks to Supabase with the anon key + the logged-in
-- user's JWT (which carries their email). These policies scope every
-- read/write to THAT user's own rows, matched via public.users.email.
-- (Anon, not-logged-in requests match nothing — following requires login.)
alter table public.user_subscriptions enable row level security;

drop policy if exists subs_own_select on public.user_subscriptions;
create policy subs_own_select on public.user_subscriptions
  for select
  using ( user_id in (select id from public.users where email = auth.jwt() ->> 'email') );

drop policy if exists subs_own_write on public.user_subscriptions;
create policy subs_own_write on public.user_subscriptions
  for all
  using      ( user_id in (select id from public.users where email = auth.jwt() ->> 'email') )
  with check ( user_id in (select id from public.users where email = auth.jwt() ->> 'email') );

-- NOTE: your alert engine should read user_subscriptions with the
-- SERVICE-ROLE key, which bypasses RLS.

-- 3) ONE-TIME BACKFILL ----------------------------------------------
-- Expand existing users.topics  ({ "meetings":[...], "news":[...], ... })
-- into one user_subscriptions row per chosen topic, mapping each UI cat
-- to its canonical pipeline_type. Safe to re-run (on conflict do nothing).
insert into public.user_subscriptions (user_id, community_id, pipeline_type, topic)
select
  u.id,
  u.community_id,
  case e.cat
    when 'meetings' then 'government_notice'
    when 'news'     then 'news_alert'
    when 'emerging' then 'emerging_technology'
    when 'global'   then 'global_best_practices'
  end as pipeline_type,
  t.topic
from public.users u
cross join lateral jsonb_each(u.topics) as e(cat, arr)
cross join lateral jsonb_array_elements_text(e.arr) as t(topic)
where u.topics is not null
  and u.community_id is not null
  and e.cat in ('meetings','news','emerging','global')
  and jsonb_typeof(e.arr) = 'array'
on conflict (user_id, community_id, pipeline_type, topic) do nothing;

-- 4) VERIFY ----------------------------------------------------------
-- Expect: one row per chosen topic, per user, per county.
select pipeline_type, topic, count(*) as followers
from public.user_subscriptions
group by pipeline_type, topic
order by pipeline_type, topic;

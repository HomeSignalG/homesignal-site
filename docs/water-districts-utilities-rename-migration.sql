-- water-districts-utilities-rename-migration.sql
-- Rename canonical government topic "Water companies" → "Water districts & utilities"
-- across every table that stores the word-for-word match key (subscriptions, alerts,
-- meetings, community popups). Run in Supabase SQL Editor. Idempotent on re-run.
--
-- CROSS-REPO: also update homesignal-ingest topics/canon.yaml (CANONICAL_TOPICS) and
-- any feed/Zap tags that stamp category = 'Water companies' — new ingest rows must use
-- the new string or matching will fail for subscribers on the renamed topic.
--
-- Site repo seeds + topics.canon.json updated in the same PR as this file.

-- 1) Community popup labels (government_topics text[])
update public.communities
set government_topics = array_replace(
  government_topics,
  'Water companies',
  'Water districts & utilities'
)
where government_topics @> array['Water companies']::text[];

-- 2) Notices stream
update public.alerts
set category = 'Water districts & utilities'
where category = 'Water companies';

-- 3) Meetings stream
update public.meetings
set category = 'Water districts & utilities'
where category = 'Water companies';

-- 4) Digest subscriptions
update public.user_subscriptions
set topic = 'Water districts & utilities'
where topic = 'Water companies';

-- 5) users.topics jsonb (notices/meetings arrays on the users row)
update public.users
set topics = replace(topics::text, 'Water companies', 'Water districts & utilities')::jsonb
where topics::text like '%Water companies%';

-- 6) App topic picker prefs (localStorage mirror)
update public.app_topic_prefs
set topics = replace(topics::text, 'Water companies', 'Water districts & utilities')::jsonb
where topics::text like '%Water companies%';

-- Verify
select 'communities' as tbl, count(*) as rows
from public.communities
where government_topics @> array['Water districts & utilities']::text[]
union all
select 'alerts', count(*) from public.alerts where category = 'Water districts & utilities'
union all
select 'meetings', count(*) from public.meetings where category = 'Water districts & utilities'
union all
select 'user_subscriptions', count(*) from public.user_subscriptions where topic = 'Water districts & utilities'
union all
select 'stale_water_companies_alerts', count(*) from public.alerts where category = 'Water companies'
union all
select 'stale_water_companies_communities', count(*) from public.communities where government_topics @> array['Water companies']::text[];

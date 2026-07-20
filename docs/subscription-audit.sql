-- ============================================================================
-- HomeSignal — SUBSCRIPTION DATABASE AUDIT (read-only)
-- Run via .github/workflows/db-sql.yml (workflow_dispatch, sql_file input).
-- Produces JSON rows for the operator report. DO NOT DELETE ANYTHING.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Table counts (sanity)
-- ---------------------------------------------------------------------------
select 'TABLE_COUNTS' as section, jsonb_build_object(
  'public_users', (select count(*) from public.users),
  'public_users_distinct_emails', (select count(distinct lower(email)) from public.users),
  'user_subscriptions', (select count(*) from public.user_subscriptions),
  'auth_users', (select count(*) from auth.users),
  'app_follows', (select count(*) from public.app_follows),
  'app_topic_prefs', (select count(*) from public.app_topic_prefs),
  'email_events', (select count(*) from public.email_events),
  'email_events_sent', (select count(*) from public.email_events where status = 'sent' or event_type = 'sent')
) as data;

-- ---------------------------------------------------------------------------
-- 1) Canonical topic universe (for invalid-topic checks)
-- ---------------------------------------------------------------------------
with canonical_universal as (
  select unnest(array[
    'Water Quality','Air Quality','Soil Quality',
    'Animal & Human Viruses / Diseases','Infrastructure','EMF',
    'Noise Pollution','Light Pollution','Livestock, Crops, Pets & Wildlife Health',
    'Weather & Climate Hazards','Radiation','Data Centers'
  ]) as topic
),
canonical_gov as (
  select distinct unnest(government_topics) as topic
  from public.communities
  where government_topics is not null and array_length(government_topics, 1) > 0
),
canonical_all as (
  select topic from canonical_universal
  union
  select topic from canonical_gov
),
canonical_pipelines as (
  select unnest(array['government_notice','news_alert','emerging_technology','global_best_practices']) as pipeline_type
),
live_zips as (
  select distinct unnest(zip_codes) as zip from public.communities where zip_codes is not null
),
user_base as (
  select
    lower(u.email) as email,
    array_agg(distinct u.id order by u.id) as user_ids,
    array_agg(distinct u.zip_code order by u.zip_code) filter (where u.zip_code is not null and trim(u.zip_code) <> '') as zips,
    array_agg(distinct c.state order by c.state) filter (where c.state is not null) as states,
    bool_or(coalesce(u.unsubscribed, false) = false) as any_active_row,
    bool_or(coalesce(u.marketing_consent, false)) as any_marketing_consent,
    min(u.created_at) as first_created,
    max(u.created_at) as last_created,
    array_agg(distinct u.community_id::text) as community_ids,
    array_agg(distinct c.name) filter (where c.name is not null) as community_names
  from public.users u
  left join public.communities c on c.id = u.community_id
  group by lower(u.email)
),
sub_topics as (
  select
    lower(u.email) as email,
    array_agg(distinct (s.pipeline_type || '::' || s.topic) order by (s.pipeline_type || '::' || s.topic)) as topic_pairs,
    array_agg(distinct s.topic order by s.topic) as topics,
    array_agg(distinct s.pipeline_type order by s.pipeline_type) as pipelines,
    count(*) as subscription_rows
  from public.user_subscriptions s
  join public.users u on u.id = s.user_id
  group by lower(u.email)
),
last_email as (
  select lower(user_email) as email, max(created_at) as last_email_sent
  from public.email_events
  where coalesce(status, event_type) in ('sent', 'delivered')
     or event_type in ('sent', 'delivered')
  group by lower(user_email)
),
auth_emails as (
  select lower(email) as email, min(created_at) as auth_created
  from auth.users
  where email is not null
  group by lower(email)
),
app_follow_zips as (
  select lower(au.email) as email,
         array_agg(distinct f.target_id order by f.target_id) as app_follow_zips
  from public.app_follows f
  join auth.users au on au.id = f.user_id
  where f.target_type = 'community'
  group by lower(au.email)
),
app_prefs as (
  select lower(au.email) as email,
         jsonb_object_agg(p.category, p.topics) as app_topic_prefs
  from public.app_topic_prefs p
  join auth.users au on au.id = p.user_id
  group by lower(au.email)
),
report as (
  select
    ub.email,
    ub.user_ids[1] as primary_user_id,
    ub.user_ids,
    coalesce(ub.zips, '{}') as digest_zips,
    coalesce(af.app_follow_zips, '{}') as app_follow_zips,
    (
      select coalesce(array_agg(distinct z order by z), '{}')
      from unnest(coalesce(ub.zips, '{}') || coalesce(af.app_follow_zips, '{}')) z
    ) as all_zips,
    coalesce(ub.states, '{}') as states,
    coalesce(st.topics, '{}') as topics,
    coalesce(st.topic_pairs, '{}') as topic_pairs,
    coalesce(st.pipelines, '{}') as pipelines,
    coalesce(st.subscription_rows, 0) as subscription_rows,
    ub.any_active_row as active,
    coalesce(ub.any_marketing_consent, false) as marketing_consent,
    le.last_email_sent,
    ub.first_created,
    ub.last_created,
    ae.auth_created,
    ub.community_ids,
    ub.community_names,
    ap.app_topic_prefs,
    case
      when ub.email ~* '(^demo@|@homesignal\.net$|@example\.com$|@test\.|test@|mailinator|yopmail|tempmail|\+test)' then true
      when ub.email in ('demo@homesignal.net') then true
      else false
    end as test_account_heuristic,
    case
      when ub.email in ('sdsutca@proton.me') then 'founder_doc_ref'
      when ub.email in ('cheryltownsend2525@gmail.com') then 'reconnect_doc_ref'
      else null
    end as known_account_tag,
    (
      select count(*) from public.users u2
      where lower(u2.email) = ub.email
    ) as digest_identity_rows
  from user_base ub
  left join sub_topics st on st.email = ub.email
  left join last_email le on le.email = ub.email
  left join auth_emails ae on ae.email = ub.email
  left join app_follow_zips af on af.email = ub.email
  left join app_prefs ap on ap.email = ub.email
)
select 'MAIN_REPORT' as section,
  jsonb_agg(
    jsonb_build_object(
      'email', email,
      'user_id', primary_user_id,
      'user_ids', user_ids,
      'zips', all_zips,
      'digest_zips', digest_zips,
      'app_follow_zips', app_follow_zips,
      'states', states,
      'topics', topics,
      'topic_pairs', topic_pairs,
      'pipelines', pipelines,
      'subscription_rows', subscription_rows,
      'active', active,
      'marketing_consent', marketing_consent,
      'last_email_sent', last_email_sent,
      'first_created', first_created,
      'last_created', last_created,
      'auth_created', auth_created,
      'community_ids', community_ids,
      'community_names', community_names,
      'app_topic_prefs', app_topic_prefs,
      'test_account', test_account_heuristic,
      'known_account_tag', known_account_tag,
      'digest_identity_rows', digest_identity_rows
    )
    order by email
  ) as data
from report;

-- ---------------------------------------------------------------------------
-- 2) Emails with app auth but NO digest identity (orphaned app-only)
-- ---------------------------------------------------------------------------
select 'APP_ONLY_NO_DIGEST' as section,
  coalesce(jsonb_agg(jsonb_build_object(
    'email', lower(au.email),
    'auth_user_id', au.id,
    'auth_created', au.created_at,
    'app_follows', (select count(*) from public.app_follows f where f.user_id = au.id),
    'app_topic_prefs', (select count(*) from public.app_topic_prefs p where p.user_id = au.id)
  ) order by au.email), '[]'::jsonb) as data
from auth.users au
where au.email is not null
  and not exists (select 1 from public.users u where lower(u.email) = lower(au.email));

-- ---------------------------------------------------------------------------
-- 3) Digest identities with ZERO subscriptions (abandoned / follow-only)
-- ---------------------------------------------------------------------------
select 'DIGEST_NO_SUBSCRIPTIONS' as section,
  coalesce(jsonb_agg(jsonb_build_object(
    'email', lower(u.email),
    'user_id', u.id,
    'zip_code', u.zip_code,
    'community_id', u.community_id,
    'community_name', c.name,
    'state', c.state,
    'marketing_consent', u.marketing_consent,
    'unsubscribed', u.unsubscribed,
    'topics_json', u.topics,
    'created_at', u.created_at
  ) order by u.email), '[]'::jsonb) as data
from public.users u
left join public.communities c on c.id = u.community_id
where not exists (
  select 1 from public.user_subscriptions s where s.user_id = u.id
);

-- ---------------------------------------------------------------------------
-- 4) Duplicate subscription check (should be 0 — unique index enforced)
-- ---------------------------------------------------------------------------
select 'DUPLICATE_SUBSCRIPTIONS' as section,
  coalesce(jsonb_agg(jsonb_build_object(
    'user_id', user_id,
    'community_id', community_id,
    'pipeline_type', pipeline_type,
    'topic', topic,
    'dup_count', cnt
  )), '[]'::jsonb) as data
from (
  select user_id, community_id, pipeline_type, topic, count(*) as cnt
  from public.user_subscriptions
  group by 1,2,3,4
  having count(*) > 1
) d;

-- ---------------------------------------------------------------------------
-- 5) Orphan subscriptions (user_id not in public.users)
-- ---------------------------------------------------------------------------
select 'ORPHAN_SUBSCRIPTIONS' as section,
  coalesce(jsonb_agg(jsonb_build_object(
    'subscription_id', s.id,
    'user_id', s.user_id,
    'community_id', s.community_id,
    'pipeline_type', s.pipeline_type,
    'topic', s.topic
  )), '[]'::jsonb) as data
from public.user_subscriptions s
where not exists (select 1 from public.users u where u.id = s.user_id);

-- ---------------------------------------------------------------------------
-- 6) Invalid topics (not in canonical universe)
-- ---------------------------------------------------------------------------
with canonical_universal as (
  select unnest(array[
    'Water Quality','Air Quality','Soil Quality',
    'Animal & Human Viruses / Diseases','Infrastructure','EMF',
    'Noise Pollution','Light Pollution','Livestock, Crops, Pets & Wildlife Health',
    'Weather & Climate Hazards','Radiation','Data Centers'
  ]) as topic
),
canonical_gov as (
  select distinct unnest(government_topics) as topic
  from public.communities
  where government_topics is not null
),
canonical_all as (
  select topic from canonical_universal union select topic from canonical_gov
)
select 'INVALID_TOPICS' as section,
  coalesce(jsonb_agg(jsonb_build_object(
    'email', lower(u.email),
    'user_id', s.user_id,
    'community_id', s.community_id,
    'community_name', c.name,
    'pipeline_type', s.pipeline_type,
    'topic', s.topic,
    'community_carries_topic', (s.topic = any(coalesce(c.government_topics, '{}')))
  ) order by u.email, s.topic), '[]'::jsonb) as data
from public.user_subscriptions s
join public.users u on u.id = s.user_id
left join public.communities c on c.id = s.community_id
where s.topic is not null
  and s.topic not in (select topic from canonical_all);

-- ---------------------------------------------------------------------------
-- 7) Invalid pipeline types
-- ---------------------------------------------------------------------------
select 'INVALID_PIPELINES' as section,
  coalesce(jsonb_agg(jsonb_build_object(
    'email', lower(u.email),
    'pipeline_type', s.pipeline_type,
    'topic', s.topic,
    'count', cnt
  )), '[]'::jsonb) as data
from (
  select s.pipeline_type, s.topic, s.user_id, count(*) as cnt
  from public.user_subscriptions s
  where s.pipeline_type not in ('government_notice','news_alert','emerging_technology','global_best_practices','permit_filing','government_notice','news')
  group by 1,2,3
) x
join public.user_subscriptions s on s.user_id = x.user_id and s.pipeline_type = x.pipeline_type and coalesce(s.topic,'') = coalesce(x.topic,'')
join public.users u on u.id = s.user_id;

-- ---------------------------------------------------------------------------
-- 8) Invalid / unknown ZIP codes on digest identities
-- ---------------------------------------------------------------------------
with live_zips as (
  select distinct unnest(zip_codes) as zip from public.communities where zip_codes is not null
)
select 'INVALID_DIGEST_ZIPS' as section,
  coalesce(jsonb_agg(jsonb_build_object(
    'email', lower(u.email),
    'user_id', u.id,
    'zip_code', u.zip_code,
    'community_id', u.community_id,
    'zip_in_communities', exists(select 1 from live_zips lz where lz.zip = u.zip_code)
  ) order by u.email), '[]'::jsonb) as data
from public.users u
where u.zip_code is not null and trim(u.zip_code) <> ''
  and not exists (select 1 from live_zips lz where lz.zip = u.zip_code);

-- ---------------------------------------------------------------------------
-- 9) Invalid app_follow ZIPs
-- ---------------------------------------------------------------------------
with live_zips as (
  select distinct unnest(zip_codes) as zip from public.communities where zip_codes is not null
)
select 'INVALID_APP_FOLLOW_ZIPS' as section,
  coalesce(jsonb_agg(jsonb_build_object(
    'email', lower(au.email),
    'auth_user_id', f.user_id,
    'zip', f.target_id,
    'created_at', f.created_at
  ) order by au.email), '[]'::jsonb) as data
from public.app_follows f
join auth.users au on au.id = f.user_id
where f.target_type = 'community'
  and not exists (select 1 from live_zips lz where lz.zip = f.target_id);

-- ---------------------------------------------------------------------------
-- 10) Topic/community mismatches (gov topic not on subscribed community chain)
-- ---------------------------------------------------------------------------
select 'TOPIC_COMMUNITY_MISMATCH' as section,
  coalesce(jsonb_agg(jsonb_build_object(
    'email', lower(u.email),
    'user_id', s.user_id,
    'subscribed_community', c.name,
    'subscribed_community_id', s.community_id,
    'pipeline_type', s.pipeline_type,
    'topic', s.topic,
    'topic_on_community', (s.topic = any(coalesce(c.government_topics, '{}')))
  ) order by u.email), '[]'::jsonb) as data
from public.user_subscriptions s
join public.users u on u.id = s.user_id
join public.communities c on c.id = s.community_id
where s.pipeline_type = 'government_notice'
  and s.topic is not null
  and not (s.topic = any(coalesce(c.government_topics, '{}')));

-- ---------------------------------------------------------------------------
-- 11) Dashboard admin allowlist (who can see metrics — not PII but useful)
-- ---------------------------------------------------------------------------
select 'DASHBOARD_ADMINS' as section,
  coalesce(jsonb_agg(jsonb_build_object('email', email, 'note', note, 'added_at', added_at)), '[]'::jsonb) as data
from public.dashboard_admins;

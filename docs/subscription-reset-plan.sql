-- ============================================================================
-- HomeSignal — SUBSCRIPTION RESET (PARKED — DO NOT RUN without explicit approval)
-- Goal: simulate a brand-new production launch while preserving accounts,
-- historical content, feeds, and email logs.
-- Run in Supabase SQL editor AFTER exporting a backup (see step 0).
-- ============================================================================

-- 0) BACKUP (run first; save output to a file)
-- select * from public.user_subscriptions order by user_id, community_id, pipeline_type, topic;
-- select * from public.users order by email, community_id;
-- select * from public.app_topic_prefs order by user_id, category;
-- select * from public.app_follows order by user_id, target_type, target_id;

begin;

-- 1) Alert subscription rows (digest matching source)
delete from public.user_subscriptions;

-- 2) Saved topic preferences (app layer)
delete from public.app_topic_prefs;

-- 3) App follows (ZIP/community follows — would re-hydrate stale UI state)
delete from public.app_follows;

-- 4) Digest identity topic/consent state (keep rows for account continuity,
--    but clear alert preferences so no one is silently emailable)
update public.users
   set topics = '{}'::jsonb,
       marketing_consent = false,
       marketing_consent_at = null,
       marketing_consent_copy = null,
       consent_version = null,
       unsubscribed = false,
       unsubscribed_at = null;

-- 5) Optional: remove digest identity rows entirely (stricter clean slate).
--    Uncomment ONLY if you also want zero public.users rows.
-- delete from public.users;

-- 6) NOT TOUCHED (per operator contract):
--    auth.users, alerts, meetings, feeds, email_events, communities,
--    development_reports, app_properties, canonical topics, ingestion data.

commit;

-- 7) VERIFY (expect all zero / false)
-- select count(*) from public.user_subscriptions;          -- 0
-- select count(*) from public.app_topic_prefs;             -- 0
-- select count(*) from public.app_follows;                 -- 0
-- select count(*) filter (where marketing_consent) from public.users;  -- 0
-- select count(*) filter (where topics <> '{}'::jsonb) from public.users;  -- 0

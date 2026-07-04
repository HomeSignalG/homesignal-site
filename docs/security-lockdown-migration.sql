-- Security lockdown — acquisition/social/growth views + page_cache
-- Applied manually via the Supabase SQL editor (project qwnnmljucajnexpxdgxr).
-- Recorded here per CLAUDE.md §1 (docs/*.sql = schema/DDL of record, reproducible).
--
-- Context: a live advisory + audit found (a) seven dashboard views granting full
-- anon AND authenticated privileges, five of them security_invoker=off so anon
-- read them with the OWNER's rights (bypassing base-table RLS), and (b)
-- public.page_cache with RLS disabled and full anon read/write (cache poisoning).
--
-- Safe because: the dashboard reads these views ONLY through SECURITY DEFINER
-- RPCs (hs_acquisition_*), which run as the function owner — revoking the direct
-- client grants does not touch them. No shipped HTML/JS references these views
-- or page_cache. page_cache's only user is the map-preview edge function, which
-- connects with the SERVICE ROLE key and therefore bypasses RLS.

-- 1) Revoke browser-role access to the acquisition/social/growth views.
REVOKE ALL ON public.v_acq_campaign_metrics FROM anon, authenticated;
REVOKE ALL ON public.v_acq_channel_metrics  FROM anon, authenticated;
REVOKE ALL ON public.v_acq_contacts         FROM anon, authenticated;
REVOKE ALL ON public.v_acq_tracker          FROM anon, authenticated;
REVOKE ALL ON public.v_growth_daily         FROM anon, authenticated;
REVOKE ALL ON public.v_social_followers     FROM anon, authenticated;
REVOKE ALL ON public.v_social_posts         FROM anon, authenticated;

-- 2) Defense in depth: make the five definer views respect the caller's RLS if a
--    grant is ever re-added. (The two social views were already invoker=on.)
ALTER VIEW public.v_acq_campaign_metrics SET (security_invoker = on);
ALTER VIEW public.v_acq_channel_metrics  SET (security_invoker = on);
ALTER VIEW public.v_acq_contacts         SET (security_invoker = on);
ALTER VIEW public.v_acq_tracker          SET (security_invoker = on);
ALTER VIEW public.v_growth_daily         SET (security_invoker = on);

-- 3) Lock down page_cache: revoke browser-role access, enable RLS with NO policy.
--    Service role (map-preview edge function) bypasses RLS and keeps working;
--    anon/authenticated are fully denied. Do NOT add an anon policy — nothing in
--    the browser legitimately reads or writes this table.
REVOKE ALL ON public.page_cache FROM anon, authenticated;
ALTER TABLE public.page_cache ENABLE ROW LEVEL SECURITY;

-- Verify:
--   SELECT count(*) FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND grantee IN ('anon','authenticated')
--     AND (table_name LIKE 'v_acq_%' OR table_name LIKE 'v_social_%'
--          OR table_name LIKE 'v_growth%' OR table_name='page_cache');   -- expect 0
--   SELECT relrowsecurity FROM pg_class WHERE oid='public.page_cache'::regclass; -- expect true

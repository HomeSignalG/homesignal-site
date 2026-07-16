-- HomeSignal — referral first-touch attribution (marketing restart).
-- Parked per repo convention: review + run in the Supabase SQL editor.
-- Companion client code: shell.js captureReferral()/HS.referral()/HS.referralToken()
-- (shipped in PR #250 + the stamp commit). Everything here is ADDITIVE.
--
-- The attribution chain:
--   1. CAPTURE (live): shell.js stores the first touch (utm_* params or off-site
--      referrer) once, first-touch-wins, in localStorage 'hs:referral'.
--   2. STAMP — area requests (live once the stamp commit deploys): shell.js
--      HS.submitRequest() writes community_requests.source = 'ref:<source>[/<campaign>]'
--      e.g. 'ref:bluesky/box-elder-meetings'. NO SCHEMA CHANGE NEEDED — the live
--      `source` text column already exists (verified in the SQL editor 2026-07-16);
--      its other writer is the submit-public-form edge function ('homepage_zip',
--      'contact_page'). The 'ref:' prefix separates referral-attributed rows from
--      those page-provenance tokens.
--   3. STAMP — signups: BLOCKED, see the bottom of this file.

-- ---------------------------------------------------------------------------
-- 1. users: additive referral columns (for the signup-side stamp, step 3).
--    Safe to run now; unused until signup_complete is extended + re-wired.
alter table public.users add column if not exists referral_source   text;
alter table public.users add column if not exists referral_campaign text;
comment on column public.users.referral_source   is 'First-touch marketing source at signup (e.g. bluesky); null = organic/unknown.';
comment on column public.users.referral_campaign is 'utm_campaign at first touch (e.g. box-elder-meetings).';

-- ---------------------------------------------------------------------------
-- 2. Reporting: area requests by referral source (aggregate-only; extend/replace
--    hs_acquisition_live's demand block with the same expression when editing it —
--    that RPC's body is live-only, so pull it with the query in section 3 first
--    and re-park the full definition here when touched).
--      select coalesce(source, '(none)') as source, count(*) as requests
--      from public.community_requests group by 1 order by 2 desc;

-- ---------------------------------------------------------------------------
-- 3. SIGNUP-SIDE STAMP — BLOCKED on two things (do NOT improvise past them):
--    a. The live `signup_complete` RPC (the historical sole writer of
--       public.users + user_subscriptions, per the pre-promotion community.html)
--       is NOT committed in any repo .sql. Pull the live body first:
--         select pg_get_functiondef(p.oid)
--         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--         where n.nspname = 'public' and p.proname = 'signup_complete';
--       Then extend it with a `p_referral_source text default null,
--       p_referral_campaign text default null` pair that writes the two columns
--       above, and park the FULL new definition in this file.
--    b. NOTHING on the deployed site calls signup_complete anymore (the /app
--       promotion replaced the old community.html that called it; the shell's
--       topics modal writes topic_prefs, which digest.py does not read).
--       Restoring that wiring is a product decision (topic-label matching rules
--       apply) — the stamp rides along when it happens, passing
--       HS.referralToken()'s parts at the call site.

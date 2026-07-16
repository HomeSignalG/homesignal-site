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
--   3. STAMP — signups: shell.js persistSignup() -> signup_complete (extended
--      below with referral params; full definition of record in section 3).

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
-- 3. SIGNUP-SIDE STAMP — signup_complete, extended with referral params.
--    UNBLOCKED 2026-07-16: the live body below was pulled verbatim via
--    pg_get_functiondef (it is now the committed definition of record), and the
--    client wiring is restored in shell.js::persistSignup() (founder-approved
--    design: strict opt-in topics, fail-loud save, chain-root anchoring).
--
--    Changes vs the live body — ADDITIVE ONLY, everything else byte-identical:
--      * two new defaulted params: p_referral_source, p_referral_campaign
--      * INSERT writes referral_source / referral_campaign (columns from §1)
--      * ON CONFLICT preserves FIRST TOUCH at the DB level:
--        coalesce(users.referral_*, EXCLUDED.referral_*) — a later organic
--        re-save can never erase the original marketing credit.
--
--    DROP + CREATE (not CREATE OR REPLACE): adding params would otherwise create
--    a second overload and make PostgREST rpc calls ambiguous. Defaults keep any
--    old 8-arg caller working; the shell also retries without the referral args
--    on PGRST202, so client and migration can deploy in either order.

begin;

drop function if exists public.signup_complete(
  text, uuid, text, jsonb, text, jsonb, boolean, text);

CREATE FUNCTION public.signup_complete(
  p_email text, p_community_id uuid, p_zip_code text, p_topics jsonb,
  p_consent_version text, p_subscriptions jsonb,
  p_data_licensing_agreed boolean DEFAULT false,
  p_marketing_consent_copy text DEFAULT NULL::text,
  p_referral_source text DEFAULT NULL::text,
  p_referral_campaign text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email     text := lower(trim(p_email));
  v_user_id   uuid;
  v_now       timestamptz := now();
  v_opted_in  boolean := (
    SELECT count(*) > 0
    FROM jsonb_array_elements(coalesce(p_subscriptions, '[]'::jsonb)) AS e
    WHERE coalesce(e->>'pipeline_type','') <> '' AND coalesce(e->>'topic','') <> ''
  );
BEGIN
  IF v_jwt_email = '' THEN
    RAISE EXCEPTION 'signup_complete must be called from an authenticated session (no JWT email present)';
  END IF;
  IF v_email = '' OR v_email IS NULL THEN
    RAISE EXCEPTION 'email is required';
  END IF;
  IF v_email <> v_jwt_email THEN
    RAISE EXCEPTION 'email (%) does not match authenticated identity (%)', v_email, v_jwt_email;
  END IF;
  IF p_zip_code IS NULL OR trim(p_zip_code) = '' THEN
    RAISE EXCEPTION 'zip_code is required';
  END IF;
  IF p_community_id IS NULL THEN
    RAISE EXCEPTION 'community_id is required';
  END IF;

  INSERT INTO public.users (
    email, zip_code, community_id, topics, consent_version, data_licensing_agreed,
    marketing_consent, marketing_consent_at, marketing_consent_copy,
    referral_source, referral_campaign
  )
  VALUES (
    v_email, trim(p_zip_code), p_community_id, coalesce(p_topics, '[]'::jsonb),
    p_consent_version, coalesce(p_data_licensing_agreed, false),
    v_opted_in,
    CASE WHEN v_opted_in THEN v_now END,
    CASE WHEN v_opted_in THEN p_marketing_consent_copy END,
    p_referral_source, p_referral_campaign
  )
  ON CONFLICT (email, community_id) DO UPDATE
    SET zip_code               = EXCLUDED.zip_code,
        topics                 = EXCLUDED.topics,
        consent_version        = EXCLUDED.consent_version,
        data_licensing_agreed  = EXCLUDED.data_licensing_agreed,
        marketing_consent      = v_opted_in,
        marketing_consent_at   = CASE WHEN v_opted_in
                                      THEN coalesce(public.users.marketing_consent_at, v_now) END,
        marketing_consent_copy = CASE WHEN v_opted_in
                                      THEN coalesce(p_marketing_consent_copy, public.users.marketing_consent_copy) END,
        referral_source        = coalesce(public.users.referral_source, EXCLUDED.referral_source),
        referral_campaign      = coalesce(public.users.referral_campaign, EXCLUDED.referral_campaign)
  RETURNING id INTO v_user_id;

  WITH desired AS (
    SELECT DISTINCT
      e->>'pipeline_type' AS pipeline_type,
      e->>'topic'         AS topic
    FROM jsonb_array_elements(coalesce(p_subscriptions, '[]'::jsonb)) AS e
    WHERE coalesce(e->>'pipeline_type','') <> '' AND coalesce(e->>'topic','') <> ''
  ),
  removed AS (
    DELETE FROM public.user_subscriptions s
    WHERE s.user_id = v_user_id
      AND s.community_id = p_community_id
      AND NOT EXISTS (
        SELECT 1 FROM desired d
        WHERE d.pipeline_type = s.pipeline_type AND d.topic = s.topic
      )
    RETURNING 1
  )
  INSERT INTO public.user_subscriptions (user_id, community_id, pipeline_type, topic)
  SELECT v_user_id, p_community_id, d.pipeline_type, d.topic
  FROM desired d
  ON CONFLICT (user_id, community_id, pipeline_type, topic) DO NOTHING;

  RETURN v_user_id;
END;
$function$;

-- A dropped function loses its grants — restore the security posture explicitly.
revoke all on function public.signup_complete(text, uuid, text, jsonb, text, jsonb, boolean, text, text, text) from public, anon;
grant execute on function public.signup_complete(text, uuid, text, jsonb, text, jsonb, boolean, text, text, text) to authenticated;

commit;

-- Note on the data_licensing_agreed overwrite (found during this design): the
-- pre-promotion page's comment claimed the RPC "does not downgrade" stored
-- licensing consent, but the body above (unchanged from live) OVERWRITES it on
-- every upsert. The client compensates: shell.js passes true if ANY stored
-- category consent is true or the box is checked now, so consent never silently
-- downgrades. A server-side coalesce-preserve is a possible future hardening —
-- deliberately NOT changed here to keep this migration additive-only.

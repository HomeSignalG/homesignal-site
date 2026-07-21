-- ===========================================================================
-- Explicit EMAIL OPT-IN at the moment of follow. PARKED SQL — apply MANUALLY in the
-- Supabase SQL editor (repo convention, CLAUDE.md §1 #3). Nothing here runs automatically.
--
-- WHY. Following an area is NOT email consent. The follow (subscribe_area_defaults,
-- docs/reconnect-subscriptions.sql) writes an identity row + user_subscriptions with
-- marketing_consent LEFT FALSE and topics LEFT NULL — so digest.py never emails it
-- (_recipients gates on marketing_consent=true AND topics not null; _topic_list reads
-- users.topics jsonb). This RPC is the ONLY writer of marketing_consent in the follow
-- flow: it fires only from the resident's explicit "Email me these alerts" tap on the
-- inline confirmation card. That affirmative, deliberate action is what makes the consent
-- defensible (founder decision 2026-07-18: inline card, never a disappearing toast).
--
-- WHAT IT SETS (keyed by (email, community_id) — the same identity row the follow made):
--   * marketing_consent      = true          (ONLY here)
--   * marketing_consent_at    = now() (first opt-in wins — audit trail preserved)
--   * marketing_consent_copy  = the exact wording shown (audit trail — founder wants this)
--   * consent_version         = the policy version agreed to
--   * topics                  = existing ∪ p_topics  (ADDITIVE per key — see below)
--
-- ADDITIVE, never delete-to-match. Unlike signup_complete (which reconciles
-- user_subscriptions to EXACTLY its payload), this UNIONS the floor labels into
-- users.topics and NEVER removes a topic the resident already chose — so opting a
-- multi-topic subscriber (e.g. 153 subs) into area emails can't wipe their other picks.
--
-- Schema verified 2026-07-18: public.users has UNIQUE (email, community_id); columns
-- marketing_consent (NOT NULL default false), marketing_consent_at, marketing_consent_copy,
-- consent_version, topics jsonb all exist and are writable.
-- ===========================================================================

create or replace function public.enable_area_email_alerts(
  p_email                  text,
  p_community_id           uuid,
  p_zip_code               text,
  p_topics                 jsonb,   -- ADDITIVE, e.g. {"notices":["Planning, zoning & development", ...]}
  p_consent_version        text,
  p_marketing_consent_copy text
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email     text := lower(trim(p_email));
  v_id        uuid;
  v_existing  jsonb;
  v_merged    jsonb;
  v_key       text;
  v_community uuid;
begin
  -- identity guards (mirror subscribe_area_defaults / signup_complete)
  if v_jwt_email = '' then
    raise exception 'enable_area_email_alerts must be called from an authenticated session';
  end if;
  if v_email = '' or v_email is null then
    raise exception 'email is required';
  end if;
  if v_email <> v_jwt_email then
    raise exception 'email (%) does not match authenticated identity (%)', v_email, v_jwt_email;
  end if;
  if p_zip_code is null or trim(p_zip_code) = '' then
    raise exception 'zip_code is required';
  end if;

  v_community := public.resolve_digest_community_id(p_zip_code);

  select id, topics into v_id, v_existing
  from public.users where email = v_email and community_id = v_community;

  -- ADDITIVE topic merge: for each key in p_topics, UNION its labels into the existing
  -- array (distinct) — never replace or remove. Other existing keys are left untouched.
  v_existing := coalesce(v_existing, '{}'::jsonb);
  v_merged := v_existing;
  for v_key in select jsonb_object_keys(coalesce(p_topics, '{}'::jsonb)) loop
    v_merged := jsonb_set(
      v_merged, array[v_key],
      (select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
       from (
         select jsonb_array_elements_text(coalesce(v_existing -> v_key, '[]'::jsonb)) as e
         union
         select jsonb_array_elements_text(coalesce(p_topics   -> v_key, '[]'::jsonb)) as e
       ) u),
      true
    );
  end loop;

  if v_id is not null then
    update public.users
       set topics                 = v_merged,
           marketing_consent      = true,
           marketing_consent_at   = coalesce(marketing_consent_at, now()),  -- first opt-in wins
           marketing_consent_copy = p_marketing_consent_copy,
           consent_version        = p_consent_version,
           zip_code               = trim(p_zip_code),
           community_id           = v_community
     where id = v_id;
  else
    -- Defensive: opt-in before the follow row exists — create it, consented.
    insert into public.users (email, zip_code, community_id, topics,
                              marketing_consent, marketing_consent_at, marketing_consent_copy, consent_version)
    values (v_email, trim(p_zip_code), v_community, v_merged,
            true, now(), p_marketing_consent_copy, p_consent_version)
    on conflict (email, community_id) do update
      set topics                 = excluded.topics,
          marketing_consent      = true,
          marketing_consent_at   = coalesce(public.users.marketing_consent_at, now()),
          marketing_consent_copy = excluded.marketing_consent_copy,
          consent_version        = excluded.consent_version,
          zip_code               = excluded.zip_code
    returning id into v_id;
  end if;

  perform public.retire_stale_digest_identities(v_email, v_community);

  return v_id;
end;
$function$;

grant execute on function public.enable_area_email_alerts(text, uuid, text, jsonb, text, text) to authenticated;

-- VERIFY after applying (a follow-only row stays consent=false; only the opt-in flips it):
-- select email, marketing_consent, marketing_consent_at, consent_version, topics
-- from public.users where community_id = '<travis-id>' order by email;

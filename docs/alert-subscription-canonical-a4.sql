-- ===========================================================================
-- HomeSignal — CANONICAL EMAIL-SUBSCRIPTION MODEL, migration A4 (WRITE PATH)
-- Founder-approved 2026-09-21. Runs after A3/A3b.
--
-- The three writers now write ONE store. None of them writes users.topics --
-- that column is frozen as topics_pre_migration by A5 and RETAINED.
--
-- Defects closed here, structurally:
--   D1 signup_complete accepted TWO independent representations of one fact and
--      validated neither. p_topics is now THE representation; p_subscriptions is
--      kept for client compatibility and CROSS-CHECKED -- a disagreement RAISES
--      instead of silently producing a consented row that can never be emailed.
--   D3 an empty payload silently revoked consent and wiped topics. It now
--      RAISES. Revoking is unsubscribe's job and leaves a record.
--   D2 enable_area_email_alerts granted consent while writing no subscriptions.
--      It now writes canonical rows in the same transaction as the consent.
-- ===========================================================================

-- ONE definition of how a topics payload expands into canonical rows. Used by
-- every writer, so no two writers can parse the payload differently.
-- Deliberately NOT a temporary table: a temp table created inside a plpgsql
-- FUNCTION is dropped at commit while its plan stays cached, so the second call
-- in a session fails on a stale OID.
create or replace function public.expand_alert_topics(p_topics jsonb)
returns table (stream text, topic text, sort_order int)
language sql immutable as $function$
  select e.k::text, t.topic::text, t.ord::int
  from jsonb_each(coalesce(p_topics, '{}'::jsonb)) e(k, v),
       lateral jsonb_array_elements_text(v) with ordinality t(topic, ord)
  where jsonb_typeof(v) = 'array';
$function$;

create or replace function public.signup_complete(
  p_email text, p_community_id uuid, p_zip_code text, p_topics jsonb,
  p_consent_version text, p_subscriptions jsonb,
  p_data_licensing_agreed boolean default false,
  p_marketing_consent_copy text default null,
  p_referral_source text default null, p_referral_campaign text default null
) returns uuid
  language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email     text := lower(trim(p_email));
  v_user_id   uuid;
  v_now       timestamptz := now();
  v_picks     int;
  v_mismatch  int;
begin
  if v_jwt_email = '' then
    raise exception 'signup_complete must be called from an authenticated session';
  end if;
  if v_email = '' or v_email is null then raise exception 'email is required'; end if;
  if v_email <> v_jwt_email then
    raise exception 'email (%) does not match authenticated identity (%)', v_email, v_jwt_email;
  end if;
  if p_zip_code is null or trim(p_zip_code) = '' then raise exception 'zip_code is required'; end if;
  if p_community_id is null then raise exception 'community_id is required'; end if;
  if coalesce(jsonb_typeof(p_topics),'null') <> 'object' then
    raise exception 'p_topics must be an object keyed by stream (notices/meetings/news/global/emerging)';
  end if;

  -- THE single representation
  select count(*) into v_picks from public.expand_alert_topics(p_topics);

  -- D3: never a silent revoke.
  if v_picks = 0 then
    raise exception
      'signup_complete received an empty selection; use the unsubscribe flow to stop alerts'
      using errcode = '23514';
  end if;

  -- D1: the legacy second representation must AGREE or the call fails.
  if p_subscriptions is not null and jsonb_array_length(p_subscriptions) > 0 then
    select count(*) into v_mismatch from (
      select distinct e->>'pipeline_type' pt, e->>'topic' tp
        from jsonb_array_elements(p_subscriptions) e
       where coalesce(e->>'pipeline_type','') <> '' and coalesce(e->>'topic','') <> ''
      except
      select distinct case stream when 'notices' then 'government_notice'
                                  when 'meetings' then 'government_notice'
                                  when 'news' then 'news_alert'
                                  when 'global' then 'global_best_practices'
                                  when 'emerging' then 'emerging_technology' end, topic
        from public.expand_alert_topics(p_topics)
    ) x;
    if v_mismatch > 0 then
      raise exception
        'p_subscriptions disagrees with p_topics on % pair(s); one selection, one representation',
        v_mismatch using errcode = '23514';
    end if;
  end if;

  insert into public.users (
    email, zip_code, community_id, consent_version, data_licensing_agreed,
    alert_email_consent, alert_email_consent_at, alert_email_consent_copy,
    marketing_consent, marketing_consent_at, marketing_consent_copy,
    referral_source, referral_campaign, unsubscribed
  ) values (
    v_email, trim(p_zip_code), p_community_id, p_consent_version,
    coalesce(p_data_licensing_agreed,false),
    true, v_now, p_marketing_consent_copy,
    true, v_now, p_marketing_consent_copy,
    p_referral_source, p_referral_campaign, false
  )
  on conflict (email, community_id) do update
    set zip_code                 = excluded.zip_code,
        consent_version          = excluded.consent_version,
        data_licensing_agreed    = excluded.data_licensing_agreed,
        alert_email_consent      = true,
        alert_email_consent_at   = coalesce(public.users.alert_email_consent_at, v_now),
        alert_email_consent_copy = coalesce(p_marketing_consent_copy, public.users.alert_email_consent_copy),
        marketing_consent        = true,
        marketing_consent_at     = coalesce(public.users.marketing_consent_at, v_now),
        marketing_consent_copy   = coalesce(p_marketing_consent_copy, public.users.marketing_consent_copy),
        referral_source          = coalesce(public.users.referral_source, excluded.referral_source),
        referral_campaign        = coalesce(public.users.referral_campaign, excluded.referral_campaign),
        unsubscribed             = false
  returning id into v_user_id;

  -- Reconcile to exactly the declared set (the Topics modal declares completeness).
  delete from public.user_subscriptions s
   where s.user_id = v_user_id and s.community_id = p_community_id
     and s.origin = 'explicit'
     and not exists (select 1 from public.expand_alert_topics(p_topics) d
                      where d.stream = s.stream and d.topic = s.topic);

  insert into public.user_subscriptions (user_id, community_id, topic, stream, origin, sort_order)
  select v_user_id, p_community_id, d.topic, d.stream, 'explicit', d.sort_order
  from public.expand_alert_topics(p_topics) d
  on conflict (user_id, community_id, stream, topic) do update
    set origin = 'explicit', sort_order = excluded.sort_order;

  return v_user_id;
end $function$;

-- Following an area is NOT email consent (founder contract A). Unchanged in
-- behaviour; it now labels what it writes so a follow can never read as
-- enrollment, and never downgrades an existing explicit selection.
create or replace function public.subscribe_area_defaults(
  p_email text, p_community_id uuid, p_zip_code text, p_subscriptions jsonb
) returns uuid
  language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email     text := lower(trim(p_email));
  v_user_id   uuid;
begin
  if v_jwt_email = '' then
    raise exception 'subscribe_area_defaults must be called from an authenticated session';
  end if;
  if v_email = '' or v_email is null then raise exception 'email is required'; end if;
  if v_email <> v_jwt_email then
    raise exception 'email (%) does not match authenticated identity (%)', v_email, v_jwt_email;
  end if;
  if p_zip_code is null or trim(p_zip_code) = '' then raise exception 'zip_code is required'; end if;
  if p_community_id is null then raise exception 'community_id is required'; end if;

  insert into public.users (email, zip_code, community_id)
  values (v_email, trim(p_zip_code), p_community_id)
  on conflict (email, community_id) do update set zip_code = excluded.zip_code
  returning id into v_user_id;

  insert into public.user_subscriptions (user_id, community_id, topic, stream, origin, sort_order)
  select v_user_id, p_community_id, e->>'topic', 'notices', 'follow_floor', 0
  from jsonb_array_elements(coalesce(p_subscriptions,'[]'::jsonb)) e
  where coalesce(e->>'topic','') <> ''
  on conflict (user_id, community_id, stream, topic) do nothing;

  return v_user_id;
end $function$;

-- The affirmative tap. Consent and the selection it implies are now written in
-- ONE transaction, so consent can never exist without a representable selection.
create or replace function public.enable_area_email_alerts(
  p_email text, p_community_id uuid, p_zip_code text, p_topics jsonb,
  p_consent_version text, p_marketing_consent_copy text
) returns uuid
  language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email     text := lower(trim(p_email));
  v_user_id   uuid;
  v_picks     int;
begin
  if v_jwt_email = '' then
    raise exception 'enable_area_email_alerts must be called from an authenticated session';
  end if;
  if v_email = '' or v_email is null then raise exception 'email is required'; end if;
  if v_email <> v_jwt_email then
    raise exception 'email (%) does not match authenticated identity (%)', v_email, v_jwt_email;
  end if;
  if p_zip_code is null or trim(p_zip_code) = '' then raise exception 'zip_code is required'; end if;
  if p_community_id is null then raise exception 'community_id is required'; end if;
  if coalesce(jsonb_typeof(p_topics),'null') <> 'object' then
    raise exception 'p_topics must be an object keyed by stream';
  end if;

  select count(*) into v_picks from public.expand_alert_topics(p_topics);
  if v_picks = 0 then
    raise exception 'enable_area_email_alerts requires at least one topic'
      using errcode = '23514';
  end if;

  insert into public.users (email, zip_code, community_id,
                            alert_email_consent, alert_email_consent_at, alert_email_consent_copy,
                            marketing_consent, marketing_consent_at, marketing_consent_copy,
                            consent_version, unsubscribed)
  values (v_email, trim(p_zip_code), p_community_id,
          true, now(), p_marketing_consent_copy,
          true, now(), p_marketing_consent_copy, p_consent_version, false)
  on conflict (email, community_id) do update
    set zip_code                 = excluded.zip_code,
        alert_email_consent      = true,
        alert_email_consent_at   = coalesce(public.users.alert_email_consent_at, now()),
        alert_email_consent_copy = excluded.alert_email_consent_copy,
        marketing_consent        = true,
        marketing_consent_at     = coalesce(public.users.marketing_consent_at, now()),
        marketing_consent_copy   = excluded.marketing_consent_copy,
        consent_version          = excluded.consent_version,
        unsubscribed             = false
  returning id into v_user_id;

  -- ADDITIVE: promote the floor to an explicit selection, never remove a topic
  -- the resident already chose.
  insert into public.user_subscriptions (user_id, community_id, topic, stream, origin, sort_order)
  select v_user_id, p_community_id, f.topic, f.stream, 'explicit', f.sort_order
  from public.expand_alert_topics(p_topics) f
  on conflict (user_id, community_id, stream, topic) do update set origin = 'explicit';

  return v_user_id;
end $function$;

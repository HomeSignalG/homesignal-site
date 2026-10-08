-- ============================================================================
-- A12 — THE "WHAT IS CHANGING IN MY ZIP CODE?" EMAIL: stream 'maps'.
--
-- Founder, 2026-09-25: a button on Map 1 (homesignalmap.html?zip=) lets a
-- resident sign up for email copies of the Acquisition Dashboard's Bluesky MAPS
-- posts about THAT ZIP. Approved plan, verbatim in substance: "Add MAPS as a new
-- type in the existing subscription system rather than building a separate
-- signup." So this file adds a STREAM to the one store; it adds no store.
--
-- What it adds, and nothing else:
--   1. 'maps' joins the closed stream vocabulary on BOTH halves -- the catalog
--      and user_subscriptions (§6.5: widen both halves together).
--   2. pipeline_type gains a 'maps' branch. It is GENERATED, and read NULL for
--      any stream outside the five.
--   3. ONE catalog topic, in the founder's own words for the button.
--   4. A 'maps' selection must sit on a ZIP-level community. A MAPS post is about
--      exactly one ZIP (social_posts.zip, which the MAPS contract binds to
--      evidence.map_zip), and the 12,722 ZIP communities carry exactly one ZIP
--      each (measured 2026-09-25: 12,722 rows, 12,722 with cardinality 1, 0 ZIPs
--      on two rows). A 'maps' row on a county could never be matched to a post,
--      so it is REFUSED here rather than silently never delivering.
--   5. The ONE additive consent writer, enable_area_email_alerts, learns two
--      OPTIONAL things, both defaulted so every existing caller is unchanged:
--        p_marketing_consent  -- default true = today's behaviour. Map 1 passes
--                                false: founder contract F models alert consent
--                                SEPARATELY from marketing consent, and this tap
--                                asks for the ZIP's posts, not for marketing.
--                                A false never REVOKES marketing consent that a
--                                resident already gave elsewhere.
--        p_referral_*         -- first-touch attribution, the same coalesce rule
--                                signup_complete already uses, so a Bluesky
--                                visitor's utm_source survives into users.
--      It stays ADDITIVE: it never deletes a selection (unlike signup_complete,
--      which reconciles to exactly its payload and would delete a resident's
--      county topics if it were handed only a 'maps' pick).
--   6. alert_subscription_integrity reports the new guard. A10's own argument:
--      a guard that can be dropped with no number moving must report itself.
--
-- NOT HERE, and deliberately so:
--   * No subscription is created, no consent is granted, no row is backfilled.
--   * The delivery half (email_deliveries accepting a social post, and the
--     confirmation email learning which streams it confirms) is a DELIVERY
--     change and ships in homesignal-ingest as
--     supabase/migrations/20260925230000_maps_email_delivery.sql. Apply THIS
--     file first: that one reads streams this one defines.
--
-- Idempotent: every statement can re-run without changing the result.
-- ============================================================================

-- ------------------------------------------------------- 1. the vocabulary
alter table public.alert_topic_catalog drop constraint if exists alert_topic_catalog_stream_ck;
alter table public.alert_topic_catalog add constraint alert_topic_catalog_stream_ck
  check (stream = any (array['notices','meetings','news','global','emerging','maps']));

alter table public.user_subscriptions drop constraint if exists user_subscriptions_stream_ck;
alter table public.user_subscriptions add constraint user_subscriptions_stream_ck
  check (stream = any (array['notices','meetings','news','global','emerging','maps']));

-- --------------------------------------------------- 2. the generated column
-- PostgreSQL 17 (live: 17.6) changes a generation expression in place. No view
-- depends on pipeline_type (pg_depend, 2026-09-25: none), so nothing is rebuilt.
alter table public.user_subscriptions alter column pipeline_type set expression as (
  case stream
    when 'notices'  then 'government_notice'
    when 'meetings' then 'government_notice'
    when 'news'     then 'news_alert'
    when 'global'   then 'global_best_practices'
    when 'emerging' then 'emerging_technology'
    when 'maps'     then 'maps'
    else null
  end);

-- ------------------------------------------------------ 3. the one topic
-- The founder's wording for the button, word for word. It is also the first
-- line of every ordinary MAPS post (bluesky/lib/compose-maps.mjs HEADER).
insert into public.alert_topic_catalog (stream, topic, active)
values ('maps', 'What is changing in my zip code?', true)
on conflict (stream, topic) do nothing;

-- ------------------------------------------- 4. a 'maps' pick is ZIP-scoped
create or replace function public.assert_maps_subscription_zip_scoped()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.stream = 'maps' and not exists (
       select 1 from public.communities c
        where c.id = new.community_id and c.level = 'zip') then
    raise exception
      'a maps subscription must be filed on a ZIP-level community (community %)',
      new.community_id using errcode = '23514';
  end if;
  return new;
end $function$;

drop trigger if exists user_subscriptions_maps_zip_scoped on public.user_subscriptions;
create trigger user_subscriptions_maps_zip_scoped
  before insert or update of stream, community_id on public.user_subscriptions
  for each row execute function public.assert_maps_subscription_zip_scoped();

-- -------------------------------- 5. the one additive consent writer, extended
-- The signature changes, so the old one is DROPPED rather than overloaded: two
-- overloads that differ only by defaulted trailing arguments make a PostgREST
-- named-argument call ambiguous. Existing callers (HS.optinRpcArgs, six named
-- arguments) resolve to this definition unchanged.
drop function if exists public.enable_area_email_alerts(text, uuid, text, jsonb, text, text);
-- `or replace` is what makes a re-run idempotent: the DROP above only ever removes the
-- OLD six-argument signature, so on a second pass this nine-argument one already exists.
create or replace function public.enable_area_email_alerts(
  p_email text, p_community_id uuid, p_zip_code text, p_topics jsonb,
  p_consent_version text, p_marketing_consent_copy text,
  p_marketing_consent boolean default true,
  p_referral_source text default null,
  p_referral_campaign text default null
) returns uuid
  language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email     text := lower(trim(p_email));
  v_marketing boolean := coalesce(p_marketing_consent, true);
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
                            consent_version, referral_source, referral_campaign, unsubscribed)
  values (v_email, trim(p_zip_code), p_community_id,
          true, now(), p_marketing_consent_copy,
          v_marketing,
          case when v_marketing then now() end,
          case when v_marketing then p_marketing_consent_copy end,
          p_consent_version, p_referral_source, p_referral_campaign, false)
  on conflict (email, community_id) do update
    set zip_code                 = excluded.zip_code,
        alert_email_consent      = true,
        alert_email_consent_at   = coalesce(public.users.alert_email_consent_at, now()),
        alert_email_consent_copy = excluded.alert_email_consent_copy,
        -- Marketing consent is only ever GRANTED by a tap that asks for it. A
        -- tap that does not (v_marketing false) leaves the stored value alone:
        -- it neither grants nor revokes.
        marketing_consent        = coalesce(public.users.marketing_consent, false) or v_marketing,
        marketing_consent_at     = case when v_marketing
                                        then coalesce(public.users.marketing_consent_at, now())
                                        else public.users.marketing_consent_at end,
        marketing_consent_copy   = case when v_marketing
                                        then excluded.marketing_consent_copy
                                        else public.users.marketing_consent_copy end,
        consent_version          = excluded.consent_version,
        -- First touch wins, exactly as signup_complete records it.
        referral_source          = coalesce(public.users.referral_source, excluded.referral_source),
        referral_campaign        = coalesce(public.users.referral_campaign, excluded.referral_campaign),
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

-- The grants the function carried before this file, restated (live proacl
-- 2026-09-25: {=X, postgres=X, anon=X, authenticated=X, service_role=X}). The
-- function refuses any caller without an authenticated email, so anon's EXECUTE
-- reaches the first raise and nothing else.
grant execute on function public.enable_area_email_alerts(text, uuid, text, jsonb, text, text, boolean, text, text)
  to anon, authenticated, service_role;

-- -------------------------------- 6. the integrity view reports the new guard
-- APPENDED to the live definition, read back inside the database rather than
-- retyped (claims rule 7): the view is ~40 lines and a hand copy is how a column
-- silently goes missing. Fails closed if the live view no longer ends where A11
-- left it.
do $do$
declare
  v_def text;
begin
  v_def := pg_get_viewdef('public.alert_subscription_integrity'::regclass);
  if position('maps_zip_scope_trigger' in v_def) > 0 then
    return;                                   -- already appended: idempotent
  end if;
  v_def := rtrim(btrim(v_def), ';');
  if right(v_def, length('AS event_key_columns_declared')) <> 'AS event_key_columns_declared' then
    raise exception
      'A12: alert_subscription_integrity no longer ends at event_key_columns_declared; re-read it before appending';
  end if;
  execute 'create or replace view public.alert_subscription_integrity with (security_invoker = true) as '
       || v_def
       || ', ( SELECT count(*) AS count FROM pg_trigger'
       || ' WHERE pg_trigger.tgrelid = ''public.user_subscriptions''::regclass'
       || ' AND NOT pg_trigger.tgisinternal'
       || ' AND pg_trigger.tgname = ''user_subscriptions_maps_zip_scoped''::name) AS maps_zip_scope_trigger';
end
$do$;

notify pgrst, 'reload schema';

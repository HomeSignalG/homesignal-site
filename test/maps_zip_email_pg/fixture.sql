-- STAND-IN for the production objects that A12 (site) and the MAPS delivery migration
-- (homesignal-ingest supabase/migrations/20260925230000_maps_email_delivery.sql) touch.
-- A DISPOSABLE database only -- never production. Every definition below is the LIVE
-- read-back of 2026-09-25 (pg_get_functiondef / pg_get_viewdef / information_schema),
-- reduced to the columns and objects these two migrations and the suite exercise.
-- What is deliberately NOT here: pg_net / vault (the confirmation HOOK posts through
-- them; the suite drives the CLAIM, which is where the new column lives) and RLS
-- (the suite runs as the table owner; RLS is unchanged by both migrations).
create extension if not exists pgcrypto;

do $$ begin
  create role anon;          exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role;  exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
-- Supabase's auth.jwt() reads the request's claims GUC; the stand-in reads the same GUC.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  name text, level text, zip_codes text[], parent_id uuid, government_topics text[]
);

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  zip_code text not null,
  created_at timestamptz default now(),
  data_licensing_agreed boolean default false,
  community_id uuid references public.communities(id),
  topics_pre_migration jsonb,
  unsubscribed boolean not null default false,
  unsubscribe_token uuid not null default gen_random_uuid(),
  last_digest_date date,
  consent_version text,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  marketing_consent_copy text,
  referral_source text,
  referral_campaign text,
  alert_email_consent boolean not null default false,
  alert_email_consent_at timestamptz,
  alert_email_consent_copy text,
  constraint users_email_community_key unique (email, community_id)
);
create unique index users_id_community_ux on public.users (id, community_id);

create table public.alert_topic_catalog (
  stream text not null, topic text not null,
  active boolean not null default true, created_at timestamptz default now(),
  constraint alert_topic_catalog_pkey primary key (stream, topic),
  constraint alert_topic_catalog_stream_ck
    check (stream = any (array['notices','meetings','news','global','emerging']))
);

create table public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  community_id uuid not null references public.communities(id),
  topic text not null,
  created_at timestamptz default now(),
  stream text not null,
  origin text not null,
  pipeline_type text generated always as (
    case stream
      when 'notices'  then 'government_notice'
      when 'meetings' then 'government_notice'
      when 'news'     then 'news_alert'
      when 'global'   then 'global_best_practices'
      when 'emerging' then 'emerging_technology'
      else null
    end) stored,
  sort_order integer default 0,
  constraint user_subscriptions_stream_ck
    check (stream = any (array['notices','meetings','news','global','emerging'])),
  constraint user_subscriptions_origin_ck check (origin = any (array['explicit','follow_floor'])),
  constraint user_subscriptions_topic_catalog_fk
    foreign key (stream, topic) references public.alert_topic_catalog(stream, topic),
  constraint user_subscriptions_user_community_fk
    foreign key (user_id, community_id) references public.users(id, community_id) on delete cascade
);
create unique index ux_user_subscriptions_canonical
  on public.user_subscriptions (user_id, community_id, stream, topic);

create table public.consent_log (
  id uuid primary key default gen_random_uuid(), user_id uuid, email text,
  consent_type text default 'data_licensing', agreed boolean, consent_version text,
  source text default 'signup', changed_at timestamptz default now(), consent_copy text
);

create table public.alerts   (id uuid primary key default gen_random_uuid(), event_key text);
create table public.meetings (id uuid primary key default gen_random_uuid(), event_key text);

create table public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  item_type text not null,
  item_id uuid not null,
  created_at timestamptz not null default now(),
  event_key text,
  constraint email_deliveries_item_type_check check (item_type = any (array['alert','meeting'])),
  constraint email_deliveries_user_id_item_type_item_id_key unique (user_id, item_type, item_id)
);

create table public.alert_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  epoch integer not null,
  community_id uuid, zip_code text,
  status text not null default 'pending'
    check (status = any (array['pending','sending','sent','failed','suppressed'])),
  resend_id text, attempts integer not null default 0, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz,
  unique (user_id, epoch)
);

create table public.app_properties (
  id uuid primary key default gen_random_uuid(), user_id uuid, address text, city text,
  state text, zip text, label text, created_at timestamptz default now()
);

-- ---------------------------------------------------------------- functions (live)
create or replace function public.expand_alert_topics(p_topics jsonb)
returns table (stream text, topic text, sort_order int)
language sql immutable as $function$
  select e.k::text, t.topic::text, t.ord::int
  from jsonb_each(coalesce(p_topics, '{}'::jsonb)) e(k, v),
       lateral jsonb_array_elements_text(v) with ordinality t(topic, ord)
  where jsonb_typeof(v) = 'array';
$function$;

create or replace function public.assert_consent_has_subscription()
 returns trigger language plpgsql as $function$
declare v_user uuid; v_comm uuid;
begin
  if tg_table_name = 'users' then
    v_user := new.id; v_comm := new.community_id;
    if not new.alert_email_consent then return null; end if;
  else
    v_user := coalesce(old.user_id, new.user_id);
    v_comm := coalesce(old.community_id, new.community_id);
    if not exists (select 1 from public.users u
                    where u.id = v_user and u.alert_email_consent) then
      return null;
    end if;
  end if;

  if not exists (select 1 from public.user_subscriptions s
                  where s.user_id = v_user and s.community_id = v_comm
                    and s.origin = 'explicit') then
    raise exception
      'alert_email_consent requires at least one explicit subscription (user %, community %)',
      v_user, v_comm using errcode = '23514';
  end if;
  return null;
end $function$;

create constraint trigger users_consent_requires_subscription
  after insert or update on public.users deferrable initially deferred
  for each row execute function public.assert_consent_has_subscription();
create constraint trigger subs_change_preserves_consent
  after delete or update on public.user_subscriptions deferrable initially deferred
  for each row execute function public.assert_consent_has_subscription();

create or replace function public.log_consent_change()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.consent_log (user_id, email, consent_type, agreed, consent_version, source)
    values (new.id, new.email, 'data_licensing', coalesce(new.data_licensing_agreed, false), new.consent_version, 'signup');

    if coalesce(new.marketing_consent, false) then
      insert into public.consent_log (user_id, email, consent_type, agreed, consent_version, source, consent_copy)
      values (new.id, new.email, 'email_marketing', true, new.consent_version, 'signup', new.marketing_consent_copy);
    end if;

  elsif tg_op = 'UPDATE' then
    if coalesce(new.data_licensing_agreed, false) is distinct from coalesce(old.data_licensing_agreed, false)
       or new.consent_version is distinct from old.consent_version then
      insert into public.consent_log (user_id, email, consent_type, agreed, consent_version, source)
      values (new.id, new.email, 'data_licensing', coalesce(new.data_licensing_agreed, false), new.consent_version, 'update');
    end if;

    if coalesce(new.marketing_consent, false) is distinct from coalesce(old.marketing_consent, false) then
      insert into public.consent_log (user_id, email, consent_type, agreed, consent_version, source, consent_copy)
      values (new.id, new.email, 'email_marketing', coalesce(new.marketing_consent, false), new.consent_version, 'update', new.marketing_consent_copy);
    end if;
  end if;
  return new;
end;
$function$;
create trigger trg_log_consent after insert or update on public.users
  for each row execute function public.log_consent_change();

create view public.alert_subscription_state with (security_invoker = true) as
 SELECT u.id AS user_id, u.email, u.community_id, u.zip_code, s.stream, s.topic, s.origin,
    u.alert_email_consent, u.unsubscribed,
    u.community_id IS NOT NULL AND u.alert_email_consent AND NOT u.unsubscribed AND s.origin = 'explicit'::text AS subscribed,
    s.sort_order
   FROM users u
     JOIN user_subscriptions s ON s.user_id = u.id AND s.community_id = u.community_id;

create or replace function public.alert_email_eligible(p_user_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (select 1 from public.alert_subscription_state st
                  where st.user_id = p_user_id and st.subscribed);
$function$;

create view public.digest_recipients with (security_invoker = true) as
 SELECT id, email, community_id, zip_code, unsubscribe_token, last_digest_date,
    ( SELECT jsonb_object_agg(g.stream, g.topics) AS jsonb_object_agg
           FROM ( SELECT s.stream,
                    jsonb_agg(s.topic ORDER BY s.sort_order, s.topic) AS topics
                   FROM user_subscriptions s
                     JOIN users uu ON uu.id = s.user_id
                  WHERE s.user_id = u.id AND s.community_id = u.community_id AND s.origin = 'explicit'::text AND uu.alert_email_consent AND NOT uu.unsubscribed AND uu.community_id IS NOT NULL
                  GROUP BY s.stream) g) AS topics
   FROM users u
  WHERE (EXISTS ( SELECT 1
           FROM alert_subscription_state st
          WHERE st.user_id = u.id AND st.community_id = u.community_id AND st.subscribed));

create view public.subscription_lifecycle with (security_invoker = true) as
 SELECT u.id, u.email, u.community_id, u.zip_code, u.created_at,
    COALESCE(e.n, 0::bigint) AS explicit_topics,
    COALESCE(f.n, 0::bigint) AS follow_floor_rows,
        CASE
            WHEN COALESCE(NULLIF(btrim(u.email), ''::text), NULL::text) IS NULL OR u.community_id IS NULL THEN 'invalid'::text
            WHEN u.unsubscribed THEN 'unsubscribed'::text
            WHEN u.alert_email_consent AND COALESCE(e.n, 0::bigint) = 0 THEN 'consent_without_topics'::text
            WHEN u.alert_email_consent THEN 'active'::text
            WHEN COALESCE(f.n, 0::bigint) > 0 THEN 'incomplete_follow'::text
            ELSE 'incomplete'::text
        END AS lifecycle_state,
    u.alert_email_consent AND NOT u.unsubscribed AND u.community_id IS NOT NULL AND COALESCE(e.n, 0::bigint) > 0 AS deliverable
   FROM users u
     LEFT JOIN LATERAL ( SELECT count(*) AS n
           FROM user_subscriptions s
          WHERE s.user_id = u.id AND s.origin = 'explicit'::text) e ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS n
           FROM user_subscriptions s
          WHERE s.user_id = u.id AND s.origin = 'follow_floor'::text) f ON true;

-- The live A7 + A10 + A11 integrity view, verbatim from pg_get_viewdef (2026-09-25),
-- so A12's append is exercised against the real ending it anchors on.
create view public.alert_subscription_integrity with (security_invoker = true) as
 SELECT ( SELECT count(*) AS count
           FROM ( SELECT DISTINCT t.topic,
                    s.stream
                   FROM communities c,
                    LATERAL unnest(c.government_topics) t(topic),
                    ( VALUES ('notices'::text), ('meetings'::text)) s(stream)
                  WHERE NOT (EXISTS ( SELECT 1
                           FROM alert_topic_catalog k
                          WHERE k.stream = s.stream AND k.topic = t.topic))) g) AS uncatalogued_offerings,
    ( SELECT count(*) AS count
           FROM user_subscriptions s
             JOIN alert_topic_catalog k ON k.stream = s.stream AND k.topic = s.topic
          WHERE NOT k.active AND s.origin = 'explicit'::text) AS stored_undeliverable,
    ( SELECT count(*) AS count
           FROM alert_topic_catalog) AS catalog_rows,
    ( SELECT count(*) AS count
           FROM alert_topic_catalog
          WHERE alert_topic_catalog.active) AS catalog_deliverable,
    ( SELECT count(*) AS count
           FROM communities
          WHERE communities.government_topics IS NOT NULL AND cardinality(communities.government_topics) > 0) AS communities_offering,
    ( SELECT count(*) AS count
           FROM user_subscriptions) AS subscription_rows,
    ( SELECT count(*) AS count
           FROM pg_trigger
          WHERE pg_trigger.tgrelid = 'communities'::regclass::oid AND NOT pg_trigger.tgisinternal AND (pg_trigger.tgname = ANY (ARRAY['communities_absorb_offered_topics_ins'::name, 'communities_absorb_offered_topics_upd'::name]))) AS absorb_triggers,
    ( SELECT count(*) AS count
           FROM pg_trigger
          WHERE pg_trigger.tgrelid = 'users'::regclass::oid AND NOT pg_trigger.tgisinternal AND pg_trigger.tgname = 'users_topics_pre_migration_frozen'::name) AS freeze_trigger,
    ( SELECT (EXISTS ( SELECT 1
                   FROM information_schema.columns
                  WHERE columns.table_schema::name = 'public'::name AND columns.table_name::name = 'users'::name AND columns.column_name::name = 'topics_pre_migration'::name)) AS "exists") AS snapshot_retained,
    ( SELECT count(*) AS count
           FROM pg_trigger
          WHERE NOT pg_trigger.tgisinternal AND pg_trigger.tgfoid = 'assert_consent_has_subscription'::regproc::oid AND (pg_trigger.tgrelid = ANY (ARRAY['users'::regclass::oid, 'user_subscriptions'::regclass::oid]))) AS consent_requires_subscription_triggers,
    ( SELECT count(*) AS count
           FROM subscription_lifecycle
          WHERE subscription_lifecycle.lifecycle_state = 'consent_without_topics'::text) AS consent_without_topics,
    ( SELECT count(*) AS count
           FROM subscription_lifecycle
          WHERE subscription_lifecycle.lifecycle_state = 'incomplete_follow'::text) AS incomplete_follows,
    ( SELECT count(*) AS count
           FROM subscription_lifecycle
          WHERE subscription_lifecycle.deliverable) AS deliverable_subscriptions,
    ( SELECT count(*) AS count
           FROM email_deliveries da
             JOIN email_deliveries dm ON dm.user_id = da.user_id AND dm.event_key = da.event_key AND dm.item_type <> da.item_type
          WHERE da.event_key IS NOT NULL AND da.item_type = 'alert'::text) AS cross_stream_duplicate_sends,
    ( SELECT count(*) AS count
           FROM information_schema.columns
          WHERE columns.table_schema::name = 'public'::name AND (columns.table_name::name = ANY (ARRAY['alerts'::name, 'meetings'::name])) AND columns.column_name::name = 'event_key'::name) AS event_key_columns_declared;

-- The consent writer as it is live today (six arguments).
create or replace function public.enable_area_email_alerts(p_email text, p_community_id uuid, p_zip_code text, p_topics jsonb, p_consent_version text, p_marketing_consent_copy text)
 returns uuid language plpgsql security definer set search_path to 'public'
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

  insert into public.user_subscriptions (user_id, community_id, topic, stream, origin, sort_order)
  select v_user_id, p_community_id, f.topic, f.stream, 'explicit', f.sort_order
  from public.expand_alert_topics(p_topics) f
  on conflict (user_id, community_id, stream, topic) do update set origin = 'explicit';

  return v_user_id;
end $function$;
grant execute on function public.enable_area_email_alerts(text, uuid, text, jsonb, text, text)
  to anon, authenticated, service_role;

-- The confirmation claim as it is live today (nine columns).
create or replace function public.alert_confirmation_claim(p_confirmation_id uuid)
 returns table(outcome text, confirmation_id uuid, user_id uuid, email text, zip_code text, community_id uuid, community_name text, address_line text, unsubscribe_token uuid)
 language plpgsql security definer set search_path to ''
as $function$
declare
  v_conf public.alert_confirmations;
  v_user public.users;
begin
  select * into v_conf from public.alert_confirmations where id = p_confirmation_id;
  if not found then
    return query select 'unknown'::text, p_confirmation_id,
                        null::uuid, null::text, null::text, null::uuid,
                        null::text, null::text, null::uuid;
    return;
  end if;

  select * into v_user from public.users where id = v_conf.user_id;
  if not found or not public.alert_email_eligible(v_user.id) then
    return query select 'not_eligible'::text, v_conf.id, v_conf.user_id,
                        null::text, null::text, null::uuid,
                        null::text, null::text, null::uuid;
    return;
  end if;

  update public.alert_confirmations
     set status = 'sending', attempts = attempts + 1, updated_at = now()
   where id = p_confirmation_id and status = 'pending';

  if not found then
    return query select 'already_claimed'::text, v_conf.id, v_conf.user_id,
                        null::text, null::text, null::uuid,
                        null::text, null::text, null::uuid;
    return;
  end if;

  return query
  select 'claimed'::text, v_conf.id, v_user.id, v_user.email, v_user.zip_code,
         v_user.community_id, com.name,
         (select concat_ws(', ', nullif(p.address, ''),
                   nullif(concat_ws(', ', nullif(p.city, ''),
                            nullif(concat_ws(' ', nullif(p.state, ''), nullif(p.zip, '')), '')), ''))
            from public.app_properties p
            join auth.users au on au.id = p.user_id
           where lower(au.email) = lower(v_user.email)
             and p.zip = v_user.zip_code and p.label = 'home'
           order by p.created_at desc limit 1),
         v_user.unsubscribe_token
  from (select 1) _
  left join public.communities com on com.id = v_user.community_id;
end;
$function$;
revoke all on function public.alert_confirmation_claim(uuid) from public, anon, authenticated;
grant execute on function public.alert_confirmation_claim(uuid) to service_role;

-- ---------------------------------------------------------------- data
-- A county with one ZIP community under it, and a second ZIP for the cross-ZIP case.
insert into public.communities (id, name, level, zip_codes, parent_id, government_topics) values
  ('00000000-0000-0000-0000-00000000c001', 'Deschutes County', 'county', array['97701','97702'], null,
   array['County Commission & county business']),
  ('00000000-0000-0000-0000-0000000097a2', 'Bend (97702)', 'zip', array['97702'],
   '00000000-0000-0000-0000-00000000c001', array[]::text[]),
  ('00000000-0000-0000-0000-0000000097a1', 'Bend (97701)', 'zip', array['97701'],
   '00000000-0000-0000-0000-00000000c001', array[]::text[]);

insert into public.alert_topic_catalog (stream, topic, active) values
  ('notices',  'County Commission & county business', true),
  ('meetings', 'County Commission & county business', true),
  ('news',     'Data Centers', true),
  ('global',   'Data Centers', true),
  ('emerging', 'Data Centers', true);

-- A resident who ALREADY receives county notices (marketing consent given on the
-- Alerts page), so the suite can prove a MAPS tap neither touches that row nor
-- revokes anything. ONE transaction: the deferred consent guard refuses a consented
-- identity with no explicit selection at commit, exactly as it does live.
begin;
insert into public.users (id, email, zip_code, community_id, alert_email_consent, alert_email_consent_at,
                          marketing_consent, marketing_consent_at, marketing_consent_copy, consent_version)
values ('00000000-0000-0000-0000-0000000000a1', 'resident@example.com', '97702',
        '00000000-0000-0000-0000-00000000c001', true, now(), true, now(), 'alerts copy', '2026-07-16');
insert into public.user_subscriptions (user_id, community_id, topic, stream, origin)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000c001',
        'County Commission & county business', 'notices', 'explicit'),
       ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000c001',
        'County Commission & county business', 'meetings', 'explicit');
commit;

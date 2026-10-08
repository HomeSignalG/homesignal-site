-- ===========================================================================
-- HomeSignal — CANONICAL EMAIL-SUBSCRIPTION MODEL, migration A3 (ENFORCEMENT)
-- Founder-approved 2026-09-21. Runs after A2.
--
-- A3 makes the contradictory states structurally IMPOSSIBLE rather than merely
-- detectable, and creates the ONE resolver that UI and delivery both read.
-- Nothing here is periodic reconciliation: every guard is a constraint, a
-- foreign key, or a deferred constraint trigger that RAISES at write time.
-- ===========================================================================

-- 1) SHAPE -------------------------------------------------------------------
alter table public.user_subscriptions
  alter column stream set not null,
  alter column origin set not null;

alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_stream_ck,
  add  constraint user_subscriptions_stream_ck
       check (stream in ('notices','meetings','news','global','emerging'));

alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_origin_ck,
  add  constraint user_subscriptions_origin_ck
       check (origin in ('explicit','follow_floor'));

-- An invalid topic string now fails at WRITE time instead of silently matching
-- nothing at delivery time. This is the whole "typos silently drop" class.
alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_topic_catalog_fk,
  add  constraint user_subscriptions_topic_catalog_fk
       foreign key (stream, topic) references public.alert_topic_catalog (stream, topic);

-- A subscription can never point at a (user, place) pair the users row does not
-- itself carry, so the two can never drift apart.
alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_user_community_fk,
  add  constraint user_subscriptions_user_community_fk
       foreign key (user_id, community_id) references public.users (id, community_id)
       on delete cascade;

-- 2) pipeline_type BECOMES DERIVED -------------------------------------------
-- It can no longer be a second mutable representation of stream. Legacy readers
-- (hs_acquisition_metrics) keep working unchanged.
alter table public.user_subscriptions drop column if exists pipeline_type;
alter table public.user_subscriptions
  add column pipeline_type text generated always as (
    case stream
      when 'notices'  then 'government_notice'
      when 'meetings' then 'government_notice'
      when 'news'     then 'news_alert'
      when 'global'   then 'global_best_practices'
      when 'emerging' then 'emerging_technology'
    end) stored;

-- 3) THE ONE ANSWER ----------------------------------------------------------
-- Every consumer resolves SUBSCRIBED(user, place, stream, topic) from HERE.
-- Delivery and UI cannot disagree because there is only one definition.
create or replace view public.alert_subscription_state
  with (security_invoker = true) as
select u.id          as user_id,
       u.email       as email,
       u.community_id,
       u.zip_code,
       s.stream,
       s.topic,
       s.origin,
       u.alert_email_consent,
       u.unsubscribed,
       (u.community_id is not null
        and u.alert_email_consent
        and not u.unsubscribed
        and s.origin = 'explicit') as subscribed
from public.users u
join public.user_subscriptions s
  on s.user_id = u.id and s.community_id = u.community_id;

-- Delivery read contract. digest.py selects exactly these columns; `topics` is
-- PROJECTED from canonical rows, so digest.py's matching logic is unchanged.
create or replace view public.digest_recipients
  with (security_invoker = true) as
select u.id, u.email, u.community_id, u.zip_code, u.unsubscribe_token, u.last_digest_date,
       (select jsonb_object_agg(g.stream, g.topics)
          from (select st.stream, jsonb_agg(st.topic order by st.topic) as topics
                  from public.alert_subscription_state st
                 where st.user_id = u.id and st.community_id = u.community_id and st.subscribed
                 group by st.stream) g) as topics
from public.users u
where exists (select 1 from public.alert_subscription_state st
               where st.user_id = u.id and st.community_id = u.community_id and st.subscribed);

-- UI read contract: the SAME state, scoped to the caller by RLS.
create or replace view public.my_alert_subscriptions
  with (security_invoker = true) as
select user_id, email, community_id, zip_code, stream, topic, origin,
       alert_email_consent, unsubscribed, subscribed
from public.alert_subscription_state;

create or replace function public.is_subscribed(
  p_user_id uuid, p_community_id uuid, p_stream text, p_topic text
) returns boolean
  language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((select st.subscribed from public.alert_subscription_state st
                    where st.user_id = p_user_id and st.community_id = p_community_id
                      and st.stream = p_stream and st.topic = p_topic), false);
$function$;

-- The UI could not previously READ canonical state (user_subscriptions had RLS
-- with an INSERT policy and no SELECT policy) -- which is why it drifted onto
-- app_topic_prefs. Contract E needs owner-read here.
drop policy if exists "select own user_subscriptions" on public.user_subscriptions;
create policy "select own user_subscriptions" on public.user_subscriptions
  for select to authenticated
  using (exists (select 1 from public.users u
                  where u.id = user_subscriptions.user_id
                    and lower(u.email) = lower((select auth.jwt() ->> 'email'))));

drop policy if exists "delete own user_subscriptions" on public.user_subscriptions;
create policy "delete own user_subscriptions" on public.user_subscriptions
  for delete to authenticated
  using (exists (select 1 from public.users u
                  where u.id = user_subscriptions.user_id
                    and lower(u.email) = lower((select auth.jwt() ->> 'email'))));

grant select on public.alert_subscription_state, public.my_alert_subscriptions to authenticated;
grant select on public.digest_recipients to service_role;

-- 4) I1 — CONSENT WITHOUT A SELECTION IS INVALID ------------------------------
-- Deferred so a reconciling RPC may delete-then-insert inside one transaction,
-- but it RAISES at commit. It never silently suppresses a subscription: a
-- violation is loud, per the founder's no-silent-fail-closed rule.
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

drop trigger if exists users_consent_requires_subscription on public.users;
create constraint trigger users_consent_requires_subscription
  after insert or update on public.users
  deferrable initially deferred
  for each row execute function public.assert_consent_has_subscription();

drop trigger if exists subs_change_preserves_consent on public.user_subscriptions;
create constraint trigger subs_change_preserves_consent
  after delete or update on public.user_subscriptions
  deferrable initially deferred
  for each row execute function public.assert_consent_has_subscription();

-- 5) VERIFY ------------------------------------------------------------------
do $$
declare bad int; n_state int; n_sub int; n_recip int;
begin
  select count(*) into n_state from public.alert_subscription_state;
  select count(*) into n_sub   from public.alert_subscription_state where subscribed;
  select count(*) into n_recip from public.digest_recipients;
  if n_state = 0 or n_sub = 0 or n_recip = 0 then
    raise exception 'HALT: empty state (state=%, subscribed=%, recipients=%)', n_state, n_sub, n_recip;
  end if;

  -- pipeline_type must still reproduce its old values exactly
  select count(*) into bad
  from public.user_subscriptions s
  join public.user_subscriptions_pre_migration a on a.id = s.id
  where a.pipeline_type is distinct from s.pipeline_type;
  if bad > 0 then raise exception 'HALT: % row(s) changed pipeline_type', bad; end if;

  -- the resolver and the view must agree on every row, always
  select count(*) into bad from public.alert_subscription_state st
  where st.subscribed
        is distinct from public.is_subscribed(st.user_id, st.community_id, st.stream, st.topic);
  if bad > 0 then raise exception 'HALT: resolver disagrees with view on % row(s)', bad; end if;

  raise notice 'A3 ok: state=% subscribed=% recipients=%', n_state, n_sub, n_recip;
end $$;

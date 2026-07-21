-- Geography invariant for public.users (digest identity).
-- Ensures users.zip_code is covered by users.community_id and retires stale
-- multi-community rows when a subscriber moves to a new area.
-- Applied via docs/candidates + db-sql workflow.

-- 1) Does this community row cover the ZIP?
create or replace function public.community_covers_zip(p_community_id uuid, p_zip_code text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.communities c
    where c.id = p_community_id
      and c.zip_codes @> array[regexp_replace(coalesce(p_zip_code, ''), '\D', '', 'g')::text]
      and length(regexp_replace(coalesce(p_zip_code, ''), '\D', '', 'g')) = 5
  );
$$;

-- 2) Canonical county root for a ZIP (digest content scope).
create or replace function public.resolve_digest_community_id(p_zip_code text)
returns uuid
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_zip text := left(regexp_replace(coalesce(p_zip_code, ''), '\D', '', 'g'), 5);
  v_start uuid;
  v_cur   public.communities%rowtype;
begin
  if length(v_zip) <> 5 then
    raise exception 'resolve_digest_community_id requires a 5-digit ZIP, got %', p_zip_code;
  end if;

  select c.id into v_start
  from public.communities c
  where c.zip_codes @> array[v_zip]
  order by case c.level
             when 'zip' then 0 when 'neighborhood' then 0
             when 'city' then 1 when 'county' then 2 else 3
           end
  limit 1;

  if v_start is null then
    raise exception 'no community covers ZIP %', v_zip;
  end if;

  select * into v_cur from public.communities where id = v_start;
  while v_cur.parent_id is not null loop
    select * into v_cur from public.communities where id = v_cur.parent_id;
  end loop;

  if v_cur.level <> 'county' then
    -- Some chains may already be county-level without parent
    select * into v_cur from public.communities where id = v_start;
  end if;

  return v_cur.id;
end;
$function$;

-- 3) Retire other digest identities when a subscriber moves.
create or replace function public.retire_stale_digest_identities(
  p_email text,
  p_keep_community_id uuid
) returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(trim(p_email));
  v_n int := 0;
begin
  if v_email = '' then
    return 0;
  end if;

  update public.users u
     set marketing_consent = false,
         unsubscribed = true
   where lower(u.email) = v_email
     and u.community_id is distinct from p_keep_community_id
     and (u.marketing_consent or not u.unsubscribed);

  get diagnostics v_n = row_count;

  delete from public.user_subscriptions s
  using public.users u
  where s.user_id = u.id
    and lower(u.email) = v_email
    and u.community_id is distinct from p_keep_community_id;

  return v_n;
end;
$function$;

-- 4) BEFORE trigger: reject zip/community mismatch.
create or replace function public.trg_users_geography_invariant()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.zip_code is null or trim(new.zip_code) = '' then
    raise exception 'users.zip_code is required';
  end if;
  if new.community_id is null then
    raise exception 'users.community_id is required';
  end if;
  if not public.community_covers_zip(new.community_id, new.zip_code) then
    raise exception 'users geography mismatch: community % does not cover zip %',
      new.community_id, new.zip_code;
  end if;
  return new;
end;
$function$;

drop trigger if exists users_geography_invariant on public.users;
create trigger users_geography_invariant
  before insert or update of zip_code, community_id on public.users
  for each row execute function public.trg_users_geography_invariant();

-- 5) subscribe_area_defaults — retire stale rows + enforce canonical community.
create or replace function public.subscribe_area_defaults(
  p_email         text,
  p_community_id  uuid,
  p_zip_code      text,
  p_subscriptions jsonb
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email     text := lower(trim(p_email));
  v_user_id   uuid;
  v_community uuid;
begin
  if v_jwt_email = '' then
    raise exception 'subscribe_area_defaults must be called from an authenticated session';
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

  insert into public.users (email, zip_code, community_id)
  values (v_email, trim(p_zip_code), v_community)
  on conflict (email, community_id) do update
    set zip_code = excluded.zip_code
  returning id into v_user_id;

  insert into public.user_subscriptions (user_id, community_id, pipeline_type, topic)
  select v_user_id, v_community, e->>'pipeline_type', e->>'topic'
  from jsonb_array_elements(coalesce(p_subscriptions, '[]'::jsonb)) as e
  where coalesce(e->>'pipeline_type','') <> '' and coalesce(e->>'topic','') <> ''
  on conflict (user_id, community_id, pipeline_type, topic) do nothing;

  perform public.retire_stale_digest_identities(v_email, v_community);

  return v_user_id;
end;
$function$;

grant execute on function public.subscribe_area_defaults(text, uuid, text, jsonb) to authenticated;

-- 6) enable_area_email_alerts — resolve canonical community + retire stale rows.
create or replace function public.enable_area_email_alerts(
  p_email                  text,
  p_community_id           uuid,
  p_zip_code               text,
  p_topics                 jsonb,
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
           marketing_consent_at   = coalesce(marketing_consent_at, now()),
           marketing_consent_copy = p_marketing_consent_copy,
           consent_version        = p_consent_version,
           zip_code               = trim(p_zip_code),
           community_id           = v_community
     where id = v_id;
  else
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

-- 7) signup_complete — canonical community + retire stale rows AFTER identity is live.
drop function if exists public.signup_complete(
  text, uuid, text, jsonb, text, jsonb, boolean, text, text, text);

create function public.signup_complete(
  p_email text, p_community_id uuid, p_zip_code text, p_topics jsonb,
  p_consent_version text, p_subscriptions jsonb,
  p_data_licensing_agreed boolean default false,
  p_marketing_consent_copy text default null::text,
  p_referral_source text default null::text,
  p_referral_campaign text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email     text := lower(trim(p_email));
  v_user_id   uuid;
  v_now       timestamptz := now();
  v_community uuid;
  v_opted_in  boolean := (
    select count(*) > 0
    from jsonb_array_elements(coalesce(p_subscriptions, '[]'::jsonb)) as e
    where coalesce(e->>'pipeline_type','') <> '' and coalesce(e->>'topic','') <> ''
  );
begin
  if v_jwt_email = '' then
    raise exception 'signup_complete must be called from an authenticated session (no JWT email present)';
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

  insert into public.users (
    email, zip_code, community_id, topics, consent_version, data_licensing_agreed,
    marketing_consent, marketing_consent_at, marketing_consent_copy,
    referral_source, referral_campaign
  )
  values (
    v_email, trim(p_zip_code), v_community, coalesce(p_topics, '[]'::jsonb),
    p_consent_version, coalesce(p_data_licensing_agreed, false),
    v_opted_in,
    case when v_opted_in then v_now end,
    case when v_opted_in then p_marketing_consent_copy end,
    p_referral_source, p_referral_campaign
  )
  on conflict (email, community_id) do update
    set zip_code               = excluded.zip_code,
        topics                 = excluded.topics,
        consent_version        = excluded.consent_version,
        data_licensing_agreed  = excluded.data_licensing_agreed,
        marketing_consent      = v_opted_in,
        marketing_consent_at   = case when v_opted_in
                                      then coalesce(public.users.marketing_consent_at, v_now) end,
        marketing_consent_copy = case when v_opted_in
                                      then coalesce(p_marketing_consent_copy, public.users.marketing_consent_copy) end,
        referral_source        = coalesce(public.users.referral_source, excluded.referral_source),
        referral_campaign      = coalesce(public.users.referral_campaign, excluded.referral_campaign)
  returning id into v_user_id;

  with desired as (
    select distinct
      e->>'pipeline_type' as pipeline_type,
      e->>'topic'         as topic
    from jsonb_array_elements(coalesce(p_subscriptions, '[]'::jsonb)) as e
    where coalesce(e->>'pipeline_type','') <> '' and coalesce(e->>'topic','') <> ''
  ),
  removed as (
    delete from public.user_subscriptions s
    where s.user_id = v_user_id
      and s.community_id = v_community
      and not exists (
        select 1 from desired d
        where d.pipeline_type = s.pipeline_type and d.topic = s.topic
      )
    returning 1
  )
  insert into public.user_subscriptions (user_id, community_id, pipeline_type, topic)
  select v_user_id, v_community, d.pipeline_type, d.topic
  from desired d
  on conflict (user_id, community_id, pipeline_type, topic) do nothing;

  perform public.retire_stale_digest_identities(v_email, v_community);

  return v_user_id;
end;
$function$;

revoke all on function public.signup_complete(text, uuid, text, jsonb, text, jsonb, boolean, text, text, text) from public, anon;
grant execute on function public.signup_complete(text, uuid, text, jsonb, text, jsonb, boolean, text, text, text) to authenticated;

-- Service-role verification hooks (read-only RPC probes).
grant execute on function public.community_covers_zip(uuid, text) to service_role;
grant execute on function public.resolve_digest_community_id(text) to service_role;

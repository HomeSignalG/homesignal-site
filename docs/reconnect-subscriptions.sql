-- ===========================================================================
-- Reconnect the app (app_*) and digest (public.users / user_subscriptions)
-- subscription systems.  PARKED SQL — apply MANUALLY in the Supabase SQL editor
-- (repo convention, CLAUDE.md §1 #3).  Nothing here runs automatically.
--
-- WHY.  Two disconnected "who's subscribed" databases exist:
--   * NEW (app):    app_properties / app_follows / app_topic_prefs, keyed by
--                   auth.users.id.  What the app UI shows.
--   * OLD (digest): public.users (email+zip+topics) + public.user_subscriptions,
--                   keyed by public.users.id (by EMAIL).  What digest.py emails.
-- The only bridge, signup_complete(), fires ONLY from the Topics modal.  Saving a
-- home or following a community — the actions users actually complete — never
-- reached the digest system.  DB-verified: CH (app-only) had app_properties=2,
-- app_follows=1, but 0 public.users rows / 0 subscriptions => got no emails.
--
-- DESIGN (see the front-end note in shell.js::ensureAreaSubscribed).
--   signup_complete() RECONCILES user_subscriptions to EXACTLY its payload
--   (DELETE-then-insert) — correct for the Topics modal where the user declares
--   their complete set, but UNSAFE to reuse for the follow/save-home bridge: the
--   bridge's payload is built from localStorage topicPrefs, which is not a mirror
--   of server truth, so reusing it would DELETE a returning user's real subs.
--   Therefore the bridge uses a SEPARATE, purely ADDITIVE function below —
--   "following your area" may only ADD the development/hearings floor, never
--   remove a customization.  signup_complete stays the reconciler.
--
-- Schema verified before writing (2026-07-18):
--   * public.users: UNIQUE (email, community_id)  [users_email_community_key]
--     NOT NULL cols needing a value: email, zip_code (rest default/nullable).
--   * public.user_subscriptions: UNIQUE INDEX (user_id, community_id,
--     pipeline_type, topic)  [user_subscriptions_user_community_pipeline_topic_key]
--   Both ON CONFLICT targets are backed.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1) The ADDITIVE bridge RPC.  Called from the browser (anon key + the user's
--    session) by shell.js::ensureAreaSubscribed after a covered save-home /
--    follow-community.  SECURITY DEFINER + JWT-email guard, exactly like
--    signup_complete — a caller can only write their OWN digest identity.
--    p_subscriptions is pre-filtered client-side to topics the community really
--    carries (word-for-word), so this never subscribes anyone to a dead topic.
-- ---------------------------------------------------------------------------
create or replace function public.subscribe_area_defaults(
  p_email         text,
  p_community_id  uuid,
  p_zip_code      text,
  p_subscriptions jsonb           -- [{pipeline_type, topic}, …]
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email     text := lower(trim(p_email));
  v_user_id   uuid;
begin
  -- identity guards (mirror signup_complete)
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
  if p_community_id is null then
    raise exception 'community_id is required';
  end if;

  -- ADDITIVE identity: create the digest row if absent; if present, only refresh
  -- the ZIP.  NEVER touch topics / consent / marketing / unsubscribed — following
  -- an area is not consent and must not downgrade an existing subscriber.
  insert into public.users (email, zip_code, community_id)
  values (v_email, trim(p_zip_code), p_community_id)
  on conflict (email, community_id) do update
    set zip_code = excluded.zip_code
  returning id into v_user_id;

  -- ADDITIVE subscriptions: add the floor, never delete.  Idempotent — the live
  -- bridge and the §2 backfill can both hit this repeatedly and it converges.
  insert into public.user_subscriptions (user_id, community_id, pipeline_type, topic)
  select v_user_id, p_community_id, e->>'pipeline_type', e->>'topic'
  from jsonb_array_elements(coalesce(p_subscriptions, '[]'::jsonb)) as e
  where coalesce(e->>'pipeline_type','') <> '' and coalesce(e->>'topic','') <> ''
  on conflict (user_id, community_id, pipeline_type, topic) do nothing;

  return v_user_id;
end;
$function$;

grant execute on function public.subscribe_area_defaults(text, uuid, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 2) ONE-TIME BACKFILL of existing app-only accounts (CH's class): auth users who
--    follow a community but have no matching public.users row.  Runs as admin in
--    the SQL editor (no JWT), so it writes directly with the SAME additive logic
--    the RPC uses.  Idempotent (both upserts) — safe to re-run.
--
--    It resolves each followed ZIP to its chain ROOT + cascaded government_topics
--    exactly as communityGovTopics() does, then subscribes only the narrow floor
--    (development/land-use + hearings) that the community actually carries.  A
--    community carrying neither gets NO row (never a zero-subscription subscriber).
--
--    DRY-RUN FIRST: run the `preview` CTE alone (SELECT * from preview;) and eyeball
--    it before running the writes.  For CH+78617 it yields Travis County +
--    {Planning, zoning & development ; County Commission & county business}.
--
--    ⚠️ TWO SEPARATE STATEMENTS, run in order.  They CANNOT be fused into one
--    WITH ... INSERT: every sub-statement in a single query runs on the SAME
--    snapshot, so a subscription INSERT joining public.users in the same statement
--    that just created those rows would NOT see them — brand-new identities would
--    get a users row but 0 subscriptions.  (Learned live: the first run left CH +
--    uclambact with a Travis row and zero subs until step 2b re-ran on its own.)
-- ---------------------------------------------------------------------------

-- 2a) Create/refresh the digest identity for every followed area with a real floor.
with follows as (
  select f.user_id, lower(au.email) as email, f.target_id as zip
  from public.app_follows f
  join auth.users au on au.id = f.user_id
  where f.target_type = 'community' and au.email is not null
),
resolved as (
  select fo.email, fo.zip, r.root_id, r.topics
  from follows fo
  cross join lateral (
    with recursive start as (
      select c.* from public.communities c
      where c.zip_codes @> array[fo.zip]
      order by case c.level when 'zip' then 0 when 'neighborhood' then 0
                            when 'city' then 1 when 'county' then 2 else 3 end
      limit 1
    ),
    chain as (
      select c.id, c.parent_id, c.government_topics from public.communities c
        join start s on s.id = c.id
      union all
      select p.id, p.parent_id, p.government_topics from public.communities p
        join chain ch on p.id = ch.parent_id
    )
    select (select id from chain where parent_id is null limit 1)                          as root_id,
           (select coalesce(array_agg(distinct t), '{}') from chain, unnest(government_topics) t) as topics
  ) r
  where r.root_id is not null
),
preview as (
  select email, root_id,
         array(select t from unnest(topics) t
               where t in ('Planning, zoning & development',
                           'County Commission & county business')) as floor_topics
  from resolved
)
insert into public.users (email, zip_code, community_id)
select distinct p.email, (select fo.zip from follows fo where fo.email = p.email limit 1), p.root_id
from preview p
where array_length(p.floor_topics, 1) > 0
on conflict (email, community_id) do update set zip_code = excluded.zip_code;

-- 2b) Add the floor subscriptions, joined to the (now-committed) users rows.
--     Idempotent — safe to re-run; ON CONFLICT DO NOTHING never deletes a topic
--     the user already chose (that is the whole point of the additive design).
with follows as (
  select lower(au.email) as email, f.target_id as zip
  from public.app_follows f
  join auth.users au on au.id = f.user_id
  where f.target_type = 'community' and au.email is not null
),
resolved as (
  select fo.email, r.root_id, r.topics
  from follows fo
  cross join lateral (
    with recursive start as (
      select c.* from public.communities c
      where c.zip_codes @> array[fo.zip]
      order by case c.level when 'zip' then 0 when 'neighborhood' then 0
                            when 'city' then 1 when 'county' then 2 else 3 end
      limit 1
    ),
    chain as (
      select c.id, c.parent_id, c.government_topics from public.communities c
        join start s on s.id = c.id
      union all
      select p.id, p.parent_id, p.government_topics from public.communities p
        join chain ch on p.id = ch.parent_id
    )
    select (select id from chain where parent_id is null limit 1)                          as root_id,
           (select coalesce(array_agg(distinct t), '{}') from chain, unnest(government_topics) t) as topics
  ) r
  where r.root_id is not null
),
preview as (
  select distinct email, root_id,
         array(select t from unnest(topics) t
               where t in ('Planning, zoning & development',
                           'County Commission & county business')) as floor_topics
  from resolved
)
insert into public.user_subscriptions (user_id, community_id, pipeline_type, topic)
select u.id, p.root_id, 'government_notice', t
from preview p
join public.users u on u.email = p.email and u.community_id = p.root_id
cross join lateral unnest(p.floor_topics) as t
where array_length(p.floor_topics, 1) > 0
on conflict (user_id, community_id, pipeline_type, topic) do nothing;


-- ---------------------------------------------------------------------------
-- 3) VERIFY after applying (expect CH to gain a Travis County users row + 2 subs):
--
-- select au.email,
--   (select count(*) from public.users u where u.email = lower(au.email))                as digest_rows,
--   (select count(*) from public.user_subscriptions s
--      where s.user_id in (select id from public.users where email = lower(au.email)))   as subs
-- from auth.users au
-- where au.email in ('cheryltownsend2525@gmail.com','sdsutca@proton.me');
-- ---------------------------------------------------------------------------

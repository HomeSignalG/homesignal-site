-- ===========================================================================
-- HomeSignal — CANONICAL EMAIL-SUBSCRIPTION MODEL, migration A2 (DATA)
-- Founder-approved 2026-09-21. Runs after A1. No constraints yet (A3).
--
-- Classifies every users row by SEMANTICS, never by copying data:
--   ENROLLED     -> topics is an object with >=1 pick, marketing_consent true,
--                   AND affirmative consent evidence exists. Its subscriptions
--                   are REBUILT FROM users.topics, because topics is the only
--                   non-lossy store: user_subscriptions collapses notices and
--                   meetings into one pipeline_type and would silently destroy
--                   every meetings selection if used as the source.
--   FOLLOW_ONLY  -> topics NULL, no picks, no consent. Rows are RETAINED and
--                   labelled origin='follow_floor'. NOT enrolled -- a follow is
--                   not consent (founder contract A).
-- Anything else HALTS the migration.
--
-- CONSENT EVIDENCE RULE (founder-approved 2026-09-21), universal:
--   marketing_consent_at IS NOT NULL
--   OR marketing_consent_copy IS NOT NULL
--   OR an affirmative public.consent_log row (email_marketing, agreed).
-- Measured before approval: covers 8/8 enrolment candidates and 0/5 follow-only
-- rows -- that 0 is the control proving it cannot enrol a follower.
--
-- No email-, ZIP-, account- or test-user-specific logic appears anywhere below.
-- ===========================================================================

-- 0) ARCHIVE -----------------------------------------------------------------
-- NOT `create table as` in public: that inherits default grants and lands
-- anon-readable AND writable (CLAUDE.md, the epa_split_probe lesson).
create table if not exists public.user_subscriptions_pre_migration (
  id uuid, user_id uuid, community_id uuid, pipeline_type text, topic text,
  created_at timestamptz, archived_at timestamptz not null default now()
);
alter table public.user_subscriptions_pre_migration enable row level security;
revoke all on public.user_subscriptions_pre_migration from anon, authenticated;

insert into public.user_subscriptions_pre_migration
  (id, user_id, community_id, pipeline_type, topic, created_at)
select s.id, s.user_id, s.community_id, s.pipeline_type, s.topic, s.created_at
from public.user_subscriptions s
where not exists (select 1 from public.user_subscriptions_pre_migration a where a.id = s.id);

-- 1) CLASSIFY (computed in-DB; no ids, emails or ZIPs are named anywhere) -----
-- Persistent, not temporary: a temp table created and then referenced inside a
-- single plpgsql block trips plan caching. Retained as the migration receipt.
drop table if exists public.alert_migration_picks;
create table public.alert_migration_picks as
select u.id as uid, e.k as stream, t as topic
from public.users u,
     lateral jsonb_each(u.topics) e(k,v),
     lateral jsonb_array_elements_text(v) t
where coalesce(jsonb_typeof(u.topics),'null') = 'object'
  and jsonb_typeof(v) = 'array';
alter table public.alert_migration_picks enable row level security;
revoke all on public.alert_migration_picks from anon, authenticated;

drop table if exists public.alert_migration_classes;
create table public.alert_migration_classes as
select u.id as uid,
       (coalesce(jsonb_typeof(u.topics),'null') = 'object') as obj,
       coalesce((select count(*) from public.alert_migration_picks p
                 where p.uid = u.id), 0) as npicks,
       coalesce(u.marketing_consent, false) as mc,
       (u.marketing_consent_at is not null
        or u.marketing_consent_copy is not null
        or exists (select 1 from public.consent_log cl
                   where cl.user_id = u.id
                     and cl.consent_type = 'email_marketing'
                     and cl.agreed)) as evidence,
       coalesce(u.marketing_consent_at,
                (select min(cl.changed_at) from public.consent_log cl
                 where cl.user_id = u.id
                   and cl.consent_type = 'email_marketing'
                   and cl.agreed)) as consent_at,
       u.marketing_consent_copy as consent_copy
from public.users u;
alter table public.alert_migration_classes enable row level security;
revoke all on public.alert_migration_classes from anon, authenticated;

alter table public.alert_migration_classes add column klass text;
update public.alert_migration_classes set klass = case
  when obj and npicks > 0 and mc and evidence then 'ENROLLED'
  when (not obj) and npicks = 0 and not mc    then 'FOLLOW_ONLY'
  else 'AMBIGUOUS' end;

-- 1b) SWAP THE LOSSY KEY -----------------------------------------------------
-- The old unique key is (user_id, community_id, pipeline_type, topic). Because
-- notices and meetings BOTH map to pipeline_type 'government_notice', it cannot
-- hold a notices pick and a meetings pick for the same topic -- which is the
-- exact defect this migration exists to remove. Proven live: the first apply of
-- A2 aborted here with 23505 on
--   (..., government_notice, 'County Commission & county business').
-- Swapping to (user_id, community_id, stream, topic) is therefore a PRECONDITION
-- of the rebuild, not a tidy-up. Existing rows still carry stream NULL at this
-- point; NULLs compare distinct in a unique index, so the swap is safe here and
-- the key becomes fully enforcing once section 2 labels every row.
drop index if exists public.user_subscriptions_user_community_pipeline_topic_key;
create unique index if not exists ux_user_subscriptions_canonical
  on public.user_subscriptions (user_id, community_id, stream, topic);

-- 2) MIGRATE + VERIFY --------------------------------------------------------
do $$
declare
  n_users int; n_enrolled int; n_follow int; n_other int;
  n_meetings_before int; n_meetings_after int;
  fp_before text; fp_after text; bad int;
begin
  select count(*) into n_users    from public.users;
  select count(*) into n_enrolled from public.alert_migration_classes where klass = 'ENROLLED';
  select count(*) into n_follow   from public.alert_migration_classes where klass = 'FOLLOW_ONLY';
  select count(*) into n_other    from public.alert_migration_classes where klass = 'AMBIGUOUS';

  if n_other > 0 then
    raise exception 'HALT: % ambiguous row(s) -- classification is not exhaustive', n_other;
  end if;
  if n_enrolled + n_follow <> n_users then
    raise exception 'HALT: partition % + % <> % users', n_enrolled, n_follow, n_users;
  end if;

  -- pre-state fingerprint + the meetings control (collation pinned, rule 9)
  select md5(string_agg(x, ',' order by x collate "C")) into fp_before
  from (select p.uid::text||'|'||p.stream||'|'||p.topic as x
        from public.alert_migration_picks p) q;
  select count(*) into n_meetings_before
  from public.alert_migration_picks where stream = 'meetings';

  -- ENROLLED: rebuild subscriptions from users.topics (the non-lossy store)
  delete from public.user_subscriptions s
  where s.user_id in (select uid from public.alert_migration_classes where klass = 'ENROLLED');

  insert into public.user_subscriptions
    (user_id, community_id, pipeline_type, topic, stream, origin)
  select p.uid, u.community_id,
         case p.stream when 'notices'  then 'government_notice'
                       when 'meetings' then 'government_notice'
                       when 'news'     then 'news_alert'
                       when 'global'   then 'global_best_practices'
                       when 'emerging' then 'emerging_technology' end,
         p.topic, p.stream, 'explicit'
  from public.alert_migration_picks p
  join public.users u on u.id = p.uid
  where p.uid in (select uid from public.alert_migration_classes where klass = 'ENROLLED');

  -- FOLLOW_ONLY: label in place. Retained, inert, NOT enrolled.
  update public.user_subscriptions s
     set stream = 'notices', origin = 'follow_floor'
   where s.user_id in (select uid from public.alert_migration_classes where klass = 'FOLLOW_ONLY');

  -- CONSENT: carry affirmative evidence across, never invent it
  update public.users u
     set alert_email_consent      = true,
         alert_email_consent_at   = c.consent_at,
         alert_email_consent_copy = c.consent_copy
  from public.alert_migration_classes c
  where c.uid = u.id and c.klass = 'ENROLLED';

  -- VERIFY -------------------------------------------------------------------
  select count(*) into bad from public.user_subscriptions where stream is null or origin is null;
  if bad > 0 then raise exception 'HALT: % subscription row(s) left unlabelled', bad; end if;

  select count(*) into bad from public.user_subscriptions s
  where not exists (select 1 from public.alert_topic_catalog c
                    where c.stream = s.stream and c.topic = s.topic);
  if bad > 0 then raise exception 'HALT: % subscription row(s) off-catalog', bad; end if;

  select count(*) into bad from public.users u
  where u.alert_email_consent
    and not exists (select 1 from public.user_subscriptions s
                    where s.user_id = u.id and s.origin = 'explicit');
  if bad > 0 then raise exception 'HALT: % consented row(s) with no explicit subscription', bad; end if;

  select count(*) into bad
  from public.alert_migration_classes c join public.users u on u.id = c.uid
  where c.klass = 'FOLLOW_ONLY' and u.alert_email_consent;
  if bad > 0 then raise exception 'HALT: % follow-only row(s) gained consent', bad; end if;

  -- meetings must survive the notices/meetings de-collapse EXACTLY
  select count(*) into n_meetings_after
  from public.user_subscriptions where stream = 'meetings' and origin = 'explicit';
  if n_meetings_after <> n_meetings_before then
    raise exception 'HALT: meetings % -> % (must not change)', n_meetings_before, n_meetings_after;
  end if;

  -- every explicit selection round-trips: topics -> rows
  select md5(string_agg(x, ',' order by x collate "C")) into fp_after
  from (select s.user_id::text||'|'||s.stream||'|'||s.topic as x
        from public.user_subscriptions s where s.origin = 'explicit') q;
  if fp_before is distinct from fp_after then
    raise exception 'HALT: selection fingerprint % -> %', fp_before, fp_after;
  end if;

  raise notice 'A2 ok: users=% enrolled=% follow_only=% meetings=%->% fp=%',
               n_users, n_enrolled, n_follow, n_meetings_before, n_meetings_after, fp_after;
end $$;

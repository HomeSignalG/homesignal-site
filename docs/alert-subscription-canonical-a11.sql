-- ============================================================================
-- A11 — NAME THE INCOMPLETE STATE, AND MAKE A10 REPORT THE GUARDS IT MISSED.
--
-- 🛑 WHAT THIS FILE DELIBERATELY DOES **NOT** DO: add a constraint binding
-- alert_email_consent to the existence of an explicit subscription. THAT GUARD
-- ALREADY EXISTS AND IS LIVE. A3 installed `assert_consent_has_subscription()`
-- behind two DEFERRABLE INITIALLY DEFERRED constraint triggers --
-- `users_consent_requires_subscription` on public.users and
-- `subs_change_preserves_consent` on public.user_subscriptions -- and both are
-- enabled in production. Verified 2026-09-22 by forcing the deferred trigger to
-- fire immediately and attempting a consented row with no topics:
--     PROBE: consent_without_topics_REFUSED=t     (then rolled back)
-- Writing a second one would be a duplicate truth path for a decision that
-- already has an owner.
--
-- ⚠️ AN AUDIT EARLIER THE SAME DAY REPORTED THAT NO SUCH CONSTRAINT EXISTED.
-- That was WRONG, and the way it was wrong is the lesson: it queried
-- pg_constraint for contype in ('c','u','f'). A constraint TRIGGER is not a
-- constraint row, so the catalog it asked could not contain the answer, and an
-- empty result read as "no invariant" instead of "wrong instrument". Ask
-- pg_trigger before concluding an invariant is missing.
--
-- WHAT IS ACTUALLY MISSING, and what this file adds:
--
--   1. THE STATE HAS NO NAME. A follow that never became an enrollment
--      (subscribe_area_defaults writes a users row with no consent and
--      origin='follow_floor' subscriptions -- founder contract A, following is
--      not enrollment) is indistinguishable in shape from a subscriber. It is
--      correctly excluded from delivery by digest_recipients, so nothing leaks;
--      but "is this an active subscriber?" is answered by a derived predicate
--      that every future reader has to re-derive correctly. Measured
--      2026-09-22: 13 users rows, 8 deliverable, 5 dormant follows (38.5%),
--      each carrying exactly 2 follow_floor rows and zero explicit ones.
--
--   2. A10's OWN ARGUMENT IS UNFINISHED. alert_subscription_integrity reports
--      absorb_triggers and freeze_trigger precisely because "dropping a guard
--      moves no other number". The A3 consent triggers are guards with exactly
--      that property and are NOT reported -- so they could be dropped and every
--      column in that view would still read healthy.
--
--   3. THE CROSS-STREAM GUARANTEE HAS NO DETECTOR. The 2026-09-22 repair made
--      one real-world event produce one resident-facing item (alerts.event_key
--      / meetings.event_key + the resolver in digest.py::build_user_digest).
--      Nothing measures whether it is holding in production.
--
-- Additive only: one new view, columns APPENDED to an existing view, and a
-- backfill that derives values from rows that already exist. No row is
-- repaired, no subscription is enabled, no consent is granted.
-- ============================================================================

-- ---------------------------------------------------------------- 1. backfill
-- email_deliveries.event_key (added 2026-09-22) is NULL on every row written
-- before it existed. Derive it from the row that was actually delivered -- not
-- invented: the key is read off the delivered alert/meeting itself. Without
-- this the duplicate-send detector below starts blind and would read a
-- reassuring 0 over a history it simply cannot see.
update public.email_deliveries d
   set event_key = a.event_key
  from public.alerts a
 where d.item_type = 'alert' and d.item_id = a.id
   and d.event_key is null and a.event_key is not null;

update public.email_deliveries d
   set event_key = m.event_key
  from public.meetings m
 where d.item_type = 'meeting' and d.item_id = m.id
   and d.event_key is null and m.event_key is not null;

-- --------------------------------------------------- 2. the state gets a name
-- ONE definition of "what is this row". Anything that counts subscribers reads
-- this instead of re-deriving the predicate.
create or replace view public.subscription_lifecycle
with (security_invoker = true) as
select u.id,
       u.email,
       u.community_id,
       u.zip_code,
       u.created_at,
       coalesce(e.n, 0) as explicit_topics,
       coalesce(f.n, 0) as follow_floor_rows,
       case
         when coalesce(nullif(btrim(u.email), ''), null) is null
           or u.community_id is null                      then 'invalid'
         when u.unsubscribed                              then 'unsubscribed'
         -- Structurally prevented by A3's constraint triggers. Retained as a
         -- REACHABLE state on purpose: if those triggers are ever dropped this
         -- is where it surfaces, instead of a row quietly looking active.
         when u.alert_email_consent and coalesce(e.n, 0) = 0
                                                          then 'consent_without_topics'
         when u.alert_email_consent                       then 'active'
         when coalesce(f.n, 0) > 0                        then 'incomplete_follow'
         else                                                  'incomplete'
       end as lifecycle_state,
       (u.alert_email_consent and not u.unsubscribed
        and u.community_id is not null and coalesce(e.n, 0) > 0) as deliverable
from public.users u
left join lateral (select count(*) n from public.user_subscriptions s
                    where s.user_id = u.id and s.origin = 'explicit') e on true
left join lateral (select count(*) n from public.user_subscriptions s
                    where s.user_id = u.id and s.origin = 'follow_floor') f on true;

comment on view public.subscription_lifecycle is
  'One row per public.users row with an EXPLICIT lifecycle state, so a follow '
  'that never became an enrollment can never masquerade as an active '
  'subscriber. ''incomplete_follow'' is the intended product state from '
  'subscribe_area_defaults (founder contract A: following is not enrollment), '
  'not a defect. ''deliverable'' mirrors the digest_recipients predicate.';

grant select on public.subscription_lifecycle to service_role;

-- ------------------------------- 3. append the missing columns to A7/A10's view
-- SPLICED from the LIVE definition, never retyped (claims rule 7): a
-- hand-copied 9-column view is an unreviewed edit to production. create or
-- replace can only APPEND columns, which is why these go on the end.
-- ⚠️ security_invoker is RESTATED: create or replace view DROPS reloptions, and
-- losing it would silently promote an anon-readable view to the owner's rights.
do $$
declare v_def text; v_new text;
begin
  select pg_get_viewdef('public.alert_subscription_integrity'::regclass, true)
    into v_def;
  if v_def is null or length(v_def) = 0 then
    raise exception 'could not read the live view definition -- refusing to guess';
  end if;
  if position('snapshot_retained' in v_def) = 0 then
    raise exception 'anchor column snapshot_retained absent -- the view is not the '
                    'one this migration was written against, refusing';
  end if;
  if position('consent_requires_subscription_triggers' in v_def) > 0 then
    raise notice 'A11 columns already present; nothing to do';
    return;
  end if;

  v_def := rtrim(btrim(v_def), ';');

  v_new := v_def || $add$,
    ( SELECT count(*) FROM pg_trigger
       WHERE NOT tgisinternal
         AND tgfoid = 'public.assert_consent_has_subscription'::regproc
         AND tgrelid IN ('public.users'::regclass, 'public.user_subscriptions'::regclass)
    ) AS consent_requires_subscription_triggers,
    ( SELECT count(*) FROM public.subscription_lifecycle
       WHERE lifecycle_state = 'consent_without_topics') AS consent_without_topics,
    ( SELECT count(*) FROM public.subscription_lifecycle
       WHERE lifecycle_state = 'incomplete_follow') AS incomplete_follows,
    ( SELECT count(*) FROM public.subscription_lifecycle
       WHERE deliverable) AS deliverable_subscriptions,
    ( SELECT count(*) FROM public.email_deliveries da
        JOIN public.email_deliveries dm
          ON dm.user_id = da.user_id
         AND dm.event_key = da.event_key
         AND dm.item_type <> da.item_type
       WHERE da.event_key IS NOT NULL
         AND da.item_type = 'alert') AS cross_stream_duplicate_sends,
    ( SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('alerts','meetings')
         AND column_name = 'event_key') AS event_key_columns_declared$add$;

  execute 'create or replace view public.alert_subscription_integrity '
          'with (security_invoker = true) as ' || v_new;
end $$;

-- ------------------------------------------------------------- 4. verification
do $$
declare r record; opts text[];
begin
  select reloptions into opts from pg_class
   where oid = 'public.alert_subscription_integrity'::regclass;
  if not ('security_invoker=true' = any(coalesce(opts, '{}'))) then
    raise exception 'security_invoker was LOST by the replace -- the view would '
                    'run with the owner''s rights';
  end if;

  select * into r from public.alert_subscription_integrity;

  -- The A3 guards must be present. This is the column whose absence A10's own
  -- reasoning says nothing else would reveal.
  if r.consent_requires_subscription_triggers <> 2 then
    raise exception 'expected 2 consent constraint triggers, found %',
      r.consent_requires_subscription_triggers;
  end if;
  if r.consent_without_topics <> 0 then
    raise exception '% row(s) hold consent with no topics -- the A3 guard is not '
                    'holding', r.consent_without_topics;
  end if;
  if r.event_key_columns_declared <> 2 then
    raise exception 'event_key is declared on % of 2 tables -- the cross-stream '
                    'identity layer is incomplete', r.event_key_columns_declared;
  end if;
  -- Positive control: a detector whose inputs are all empty reports 0 for
  -- reasons that have nothing to do with health.
  if r.deliverable_subscriptions = 0 then
    raise exception 'deliverable_subscriptions = 0 -- every count in this view is '
                    'vacuous, refusing to report clean';
  end if;

  raise notice 'A11 OK: guards=% consent_without_topics=% incomplete_follows=% '
               'deliverable=% cross_stream_duplicate_sends=%',
    r.consent_requires_subscription_triggers, r.consent_without_topics,
    r.incomplete_follows, r.deliverable_subscriptions,
    r.cross_stream_duplicate_sends;
end $$;

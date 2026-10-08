-- ===========================================================================
-- HomeSignal — CANONICAL EMAIL-SUBSCRIPTION MODEL: the live definitions.
-- READ BACK from production with pg_get_viewdef / pg_get_functiondef /
-- pg_get_constraintdef / pg_get_triggerdef on 2026-09-25 23:16Z, AFTER a1..a12.
-- This is what the database actually contains, quoted rather than recalled — not
-- a hand-written copy and not the migrations' intent.
--
-- EACH QUOTED VIEW AND FUNCTION BELOW IS BYTE-EQUAL TO PRODUCTION and carries the
-- md5 that proves it: md5(pg_get_viewdef(regclass)) / md5(pg_get_functiondef(oid))
-- taken at the read-back, then recomputed over the text in this file before it was
-- committed. The 2026-09-21 read-back carried no fingerprints, and its layout differs
-- from pg_get_viewdef(regclass) (parentheses, line wrapping), so it could not be
-- checked that way. To re-verify: md5 the block between its header and the blank
-- line that ends it, and compare with the same md5 taken live.
--
-- ⚠️ An earlier version of this file ended with the line "below is the live
--    read-back" and then contained NOTHING. That is the same defect this
--    workstream exists to remove: a document asserting evidence it does not
--    carry. It is retained in git history; the receipt is now actually here.
--
-- Applied migrations, from supabase_migrations.schema_migrations (version, name):
--   20260921160015  alert_subscription_canonical_a1_additive
--   20260921160654  alert_subscription_canonical_a2_backfill
--   20260921161201  alert_subscription_canonical_a3_enforcement
--   20260921161250  alert_subscription_canonical_a3b_preserve_order
--   20260921161607  alert_subscription_canonical_a4_write_path
--   20260921162317  alert_subscription_canonical_a4b_confirmation_gate
--   20260921162702  alert_subscription_canonical_a5_state_sort_order
--   20260921170018  alert_subscription_canonical_a6_catalog_covers_offered_topics
--   20260921170208  alert_subscription_canonical_a7_integrity_view
--   20260921171028  alert_subscription_canonical_a8_catalog_absorbs_offered_topics
--   20260921171122  alert_subscription_canonical_a9_freeze_topics_pre_migration
--   20260921171938  alert_subscription_canonical_a10_integrity_reports_its_own_guards
--   20260922145255  alert_subscription_a11_lifecycle_state_and_guard_detectors
--   20260925231226  alert_subscription_canonical_a12_maps_stream
-- and A12's delivery half, which lives in homesignal-ingest
-- (supabase/migrations/20260925230000_maps_email_delivery.sql):
--   20260925231403  maps_email_delivery
--
-- THE CONTRACT. One mutable store: public.user_subscriptions
-- (user_id, community_id, stream, topic) + origin + sort_order, with
-- pipeline_type GENERATED and (stream, topic) FK'd to public.alert_topic_catalog.
-- One answer: alert_subscription_state.subscribed / is_subscribed().
-- Two consumers that both read it: digest_recipients (delivery, homesignal-ingest
-- digest.py::_recipients) and my_alert_subscriptions (UI, shell.js::hydrateTopicPrefs).
-- The legacy users.topics store is RENAMED to users.topics_pre_migration, FROZEN by
-- trigger and RETAINED (founder mandatory change 1). No RPC writes it.
-- Six streams since A12: notices | meetings | news | global | emerging | maps.
-- A 'maps' selection is filed on the ZIP's OWN community row, never the chain root
-- (trigger user_subscriptions_maps_zip_scoped refuses anything else).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- VIEW public.alert_subscription_state          (security_invoker = true)
-- md5(pg_get_viewdef) 617ad73e646e6211f347b09e321b1d1d
-- ---------------------------------------------------------------------------
 SELECT u.id AS user_id,
    u.email,
    u.community_id,
    u.zip_code,
    s.stream,
    s.topic,
    s.origin,
    u.alert_email_consent,
    u.unsubscribed,
    ((u.community_id IS NOT NULL) AND u.alert_email_consent AND (NOT u.unsubscribed) AND (s.origin = 'explicit'::text)) AS subscribed,
    s.sort_order
   FROM (users u
     JOIN user_subscriptions s ON (((s.user_id = u.id) AND (s.community_id = u.community_id))));

-- ---------------------------------------------------------------------------
-- VIEW public.my_alert_subscriptions            (security_invoker = true — the UI
-- reads it under the resident's own JWT, so RLS on user_subscriptions is what
-- scopes it to their rows. That is the gate; there is no second one.)
-- md5(pg_get_viewdef) 3d6a51edc006a357fbf2520cff1e8562
-- ---------------------------------------------------------------------------
 SELECT user_id,
    email,
    community_id,
    zip_code,
    stream,
    topic,
    origin,
    alert_email_consent,
    unsubscribed,
    subscribed,
    sort_order
   FROM alert_subscription_state;

-- ---------------------------------------------------------------------------
-- VIEW public.digest_recipients                 (security_invoker = true)
-- Every delivery filter lives HERE, so the sender cannot drift from the UI.
-- `topics` is an aggregate over user_subscriptions — it is NOT users.topics. It groups
-- by stream with no stream list, so a 'maps' selection appears under topics.maps.
-- md5(pg_get_viewdef) b3b7f2efe47cd9d02ace7d53c5296751
-- ---------------------------------------------------------------------------
 SELECT id,
    email,
    community_id,
    zip_code,
    unsubscribe_token,
    last_digest_date,
    ( SELECT jsonb_object_agg(g.stream, g.topics) AS jsonb_object_agg
           FROM ( SELECT s.stream,
                    jsonb_agg(s.topic ORDER BY s.sort_order, s.topic) AS topics
                   FROM (user_subscriptions s
                     JOIN users uu ON ((uu.id = s.user_id)))
                  WHERE ((s.user_id = u.id) AND (s.community_id = u.community_id) AND (s.origin = 'explicit'::text) AND uu.alert_email_consent AND (NOT uu.unsubscribed) AND (uu.community_id IS NOT NULL))
                  GROUP BY s.stream) g) AS topics
   FROM users u
  WHERE (EXISTS ( SELECT 1
           FROM alert_subscription_state st
          WHERE ((st.user_id = u.id) AND (st.community_id = u.community_id) AND st.subscribed)));

-- ---------------------------------------------------------------------------
-- VIEW public.alert_subscription_integrity      (security_invoker = true)
-- The FULL live shape: a7's six columns, then a10 (absorb_triggers, freeze_trigger,
-- snapshot_retained), a11 (consent_requires_subscription_triggers, the three
-- subscription_lifecycle counts, cross_stream_duplicate_sends,
-- event_key_columns_declared) and a12 (maps_zip_scope_trigger), in that order.
-- md5(pg_get_viewdef) 4dbeaf8a314fc2dd7e7afd3de605e9fa
-- ---------------------------------------------------------------------------
 SELECT ( SELECT count(*) AS count
           FROM ( SELECT DISTINCT t.topic,
                    s.stream
                   FROM communities c,
                    LATERAL unnest(c.government_topics) t(topic),
                    ( VALUES ('notices'::text), ('meetings'::text)) s(stream)
                  WHERE (NOT (EXISTS ( SELECT 1
                           FROM alert_topic_catalog k
                          WHERE ((k.stream = s.stream) AND (k.topic = t.topic)))))) g) AS uncatalogued_offerings,
    ( SELECT count(*) AS count
           FROM (user_subscriptions s
             JOIN alert_topic_catalog k ON (((k.stream = s.stream) AND (k.topic = s.topic))))
          WHERE ((NOT k.active) AND (s.origin = 'explicit'::text))) AS stored_undeliverable,
    ( SELECT count(*) AS count
           FROM alert_topic_catalog) AS catalog_rows,
    ( SELECT count(*) AS count
           FROM alert_topic_catalog
          WHERE alert_topic_catalog.active) AS catalog_deliverable,
    ( SELECT count(*) AS count
           FROM communities
          WHERE ((communities.government_topics IS NOT NULL) AND (cardinality(communities.government_topics) > 0))) AS communities_offering,
    ( SELECT count(*) AS count
           FROM user_subscriptions) AS subscription_rows,
    ( SELECT count(*) AS count
           FROM pg_trigger
          WHERE ((pg_trigger.tgrelid = ('communities'::regclass)::oid) AND (NOT pg_trigger.tgisinternal) AND (pg_trigger.tgname = ANY (ARRAY['communities_absorb_offered_topics_ins'::name, 'communities_absorb_offered_topics_upd'::name])))) AS absorb_triggers,
    ( SELECT count(*) AS count
           FROM pg_trigger
          WHERE ((pg_trigger.tgrelid = ('users'::regclass)::oid) AND (NOT pg_trigger.tgisinternal) AND (pg_trigger.tgname = 'users_topics_pre_migration_frozen'::name))) AS freeze_trigger,
    ( SELECT (EXISTS ( SELECT 1
                   FROM information_schema.columns
                  WHERE (((columns.table_schema)::name = 'public'::name) AND ((columns.table_name)::name = 'users'::name) AND ((columns.column_name)::name = 'topics_pre_migration'::name)))) AS "exists") AS snapshot_retained,
    ( SELECT count(*) AS count
           FROM pg_trigger
          WHERE ((NOT pg_trigger.tgisinternal) AND (pg_trigger.tgfoid = ('assert_consent_has_subscription'::regproc)::oid) AND (pg_trigger.tgrelid = ANY (ARRAY[('users'::regclass)::oid, ('user_subscriptions'::regclass)::oid])))) AS consent_requires_subscription_triggers,
    ( SELECT count(*) AS count
           FROM subscription_lifecycle
          WHERE (subscription_lifecycle.lifecycle_state = 'consent_without_topics'::text)) AS consent_without_topics,
    ( SELECT count(*) AS count
           FROM subscription_lifecycle
          WHERE (subscription_lifecycle.lifecycle_state = 'incomplete_follow'::text)) AS incomplete_follows,
    ( SELECT count(*) AS count
           FROM subscription_lifecycle
          WHERE subscription_lifecycle.deliverable) AS deliverable_subscriptions,
    ( SELECT count(*) AS count
           FROM (email_deliveries da
             JOIN email_deliveries dm ON (((dm.user_id = da.user_id) AND (dm.event_key = da.event_key) AND (dm.item_type <> da.item_type))))
          WHERE ((da.event_key IS NOT NULL) AND (da.item_type = 'alert'::text))) AS cross_stream_duplicate_sends,
    ( SELECT count(*) AS count
           FROM information_schema.columns
          WHERE (((columns.table_schema)::name = 'public'::name) AND ((columns.table_name)::name = ANY (ARRAY['alerts'::name, 'meetings'::name])) AND ((columns.column_name)::name = 'event_key'::name))) AS event_key_columns_declared,
    ( SELECT count(*) AS count
           FROM pg_trigger
          WHERE ((pg_trigger.tgrelid = ('user_subscriptions'::regclass)::oid) AND (NOT pg_trigger.tgisinternal) AND (pg_trigger.tgname = 'user_subscriptions_maps_zip_scoped'::name))) AS maps_zip_scope_trigger;

-- ---------------------------------------------------------------------------
-- FUNCTION public.is_subscribed(uuid, uuid, text, text)
-- md5(pg_get_functiondef) afa82e665d67fb87c5a99bdaddbae790
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_subscribed(p_user_id uuid, p_community_id uuid, p_stream text, p_topic text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select st.subscribed from public.alert_subscription_state st
                    where st.user_id = p_user_id and st.community_id = p_community_id
                      and st.stream = p_stream and st.topic = p_topic), false);
$function$

-- ---------------------------------------------------------------------------
-- GENERATED COLUMN user_subscriptions.pipeline_type (pg_get_expr, 2026-09-25)
-- ---------------------------------------------------------------------------
-- CASE stream
--     WHEN 'notices'::text THEN 'government_notice'::text
--     WHEN 'meetings'::text THEN 'government_notice'::text
--     WHEN 'news'::text THEN 'news_alert'::text
--     WHEN 'global'::text THEN 'global_best_practices'::text
--     WHEN 'emerging'::text THEN 'emerging_technology'::text
--     WHEN 'maps'::text THEN 'maps'::text
--     ELSE NULL::text
-- END

-- ---------------------------------------------------------------------------
-- CONSTRAINTS (pg_get_constraintdef, 2026-09-25)
-- ---------------------------------------------------------------------------
-- alert_topic_catalog  alert_topic_catalog_pkey              PRIMARY KEY (stream, topic)
-- alert_topic_catalog  alert_topic_catalog_stream_ck         CHECK ((stream = ANY (ARRAY['notices'::text, 'meetings'::text, 'news'::text, 'global'::text, 'emerging'::text, 'maps'::text])))
-- user_subscriptions   subs_change_preserves_consent         TRIGGER DEFERRABLE INITIALLY DEFERRED
-- user_subscriptions   user_subscriptions_community_id_fkey  FOREIGN KEY (community_id) REFERENCES communities(id)
-- user_subscriptions   user_subscriptions_origin_ck          CHECK ((origin = ANY (ARRAY['explicit'::text, 'follow_floor'::text])))
-- user_subscriptions   user_subscriptions_pkey               PRIMARY KEY (id)
-- user_subscriptions   user_subscriptions_stream_ck          CHECK ((stream = ANY (ARRAY['notices'::text, 'meetings'::text, 'news'::text, 'global'::text, 'emerging'::text, 'maps'::text])))
-- user_subscriptions   user_subscriptions_topic_catalog_fk   FOREIGN KEY (stream, topic) REFERENCES alert_topic_catalog(stream, topic)
-- user_subscriptions   user_subscriptions_user_community_fk  FOREIGN KEY (user_id, community_id) REFERENCES users(id, community_id) ON DELETE CASCADE
-- user_subscriptions   user_subscriptions_user_id_fkey       FOREIGN KEY (user_id) REFERENCES users(id)
--
-- plus ux_user_subscriptions_canonical UNIQUE (user_id, community_id, stream, topic) —
-- the grain the OLD key could not hold. Its predecessor keyed on
-- (user_id, community_id, pipeline_type, topic), and notices+meetings share
-- pipeline_type 'government_notice', so one of the two selections was silently lost.
-- That is why the migration moved 120 -> 155 rows: +35 recovered meetings selections.

-- ---------------------------------------------------------------------------
-- TRIGGERS on communities, user_subscriptions and users (pg_get_triggerdef, 2026-09-25)
-- ---------------------------------------------------------------------------
-- CREATE TRIGGER communities_absorb_offered_topics_ins AFTER INSERT ON public.communities REFERENCING NEW TABLE AS newrows FOR EACH STATEMENT EXECUTE FUNCTION alert_catalog_absorb_offered_topics()
-- CREATE TRIGGER communities_absorb_offered_topics_upd AFTER UPDATE ON public.communities REFERENCING NEW TABLE AS newrows FOR EACH STATEMENT EXECUTE FUNCTION alert_catalog_absorb_offered_topics()
-- CREATE TRIGGER trg_communities_canonical_zip BEFORE INSERT OR UPDATE OF zip_codes ON public.communities FOR EACH ROW EXECUTE FUNCTION enforce_canonical_zip()
-- CREATE CONSTRAINT TRIGGER subs_change_preserves_consent AFTER DELETE OR UPDATE ON public.user_subscriptions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_consent_has_subscription()
-- CREATE TRIGGER user_subscriptions_maps_zip_scoped BEFORE INSERT OR UPDATE OF stream, community_id ON public.user_subscriptions FOR EACH ROW EXECUTE FUNCTION assert_maps_subscription_zip_scoped()
-- CREATE CONSTRAINT TRIGGER notify_alert_confirmation_hook AFTER INSERT OR UPDATE ON public.users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION notify_alert_confirmation_hook()
-- CREATE TRIGGER notify_signup_hook AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION notify_signup_hook()
-- CREATE TRIGGER trg_log_consent AFTER INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION log_consent_change()
-- CREATE CONSTRAINT TRIGGER users_consent_requires_subscription AFTER INSERT OR UPDATE ON public.users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_consent_has_subscription()
-- CREATE TRIGGER users_topics_pre_migration_frozen BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION refuse_topics_pre_migration_write()

-- ---------------------------------------------------------------------------
-- A12's DELIVERY HALF (homesignal-ingest maps_email_delivery), for orientation:
-- email_deliveries_item_type_check is now
--   CHECK ((item_type = ANY (ARRAY['alert'::text, 'meeting'::text, 'social_post'::text])))
-- and alert_confirmation_claim(uuid) returns one more column, streams text[]
-- (md5(prosrc) 1132dc5b24a823bdbeeec4eee4f632ac; grants postgres + service_role only).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- LIVE READING, 2026-09-25 23:16Z (public.alert_subscription_integrity), which is
-- the control set the CI gate re-measures:
--   uncatalogued_offerings 0 · stored_undeliverable 0 · catalog_rows 95 ·
--   catalog_deliverable 59 · communities_offering 572 · subscription_rows 155 ·
--   absorb_triggers 2 · freeze_trigger 1 · snapshot_retained true ·
--   consent_requires_subscription_triggers 2 · consent_without_topics 0 ·
--   incomplete_follows 5 · deliverable_subscriptions 8 ·
--   cross_stream_duplicate_sends 4 · event_key_columns_declared 2 ·
--   maps_zip_scope_trigger 1
--   (absorb/freeze/snapshot, consent_requires_subscription_triggers,
--    event_key_columns_declared and maps_zip_scope_trigger are detectors that
--    report whether their own preventers are still installed, because dropping
--    them does not move any other number)
-- and public.users: 13 rows, 8 carrying a retained topics_pre_migration snapshot,
-- 8 digest recipients. A12 added one catalog row (maps, 'What is changing in my
-- zip code?') and created no subscription: user_subscriptions is still 155 rows,
-- row fingerprint unchanged across the apply.
-- ---------------------------------------------------------------------------

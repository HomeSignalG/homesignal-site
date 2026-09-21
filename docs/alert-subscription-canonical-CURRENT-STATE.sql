-- ===========================================================================
-- HomeSignal — CANONICAL EMAIL-SUBSCRIPTION MODEL: the live definitions.
-- READ BACK from production with pg_get_viewdef / pg_get_functiondef /
-- pg_get_constraintdef on 2026-09-21, AFTER a1..a10. This is what the database
-- actually contains, quoted rather than recalled — not a hand-written copy and
-- not the migrations' intent.
--
-- ⚠️ An earlier version of this file ended with the line "below is the live
--    read-back" and then contained NOTHING. That is the same defect this
--    workstream exists to remove: a document asserting evidence it does not
--    carry. It is retained in git history; the receipt is now actually here.
--
-- Applied migration names, in order:
--   alert_subscription_canonical_a1_additive
--   alert_subscription_canonical_a2_backfill
--   alert_subscription_canonical_a3_enforcement
--   alert_subscription_canonical_a3b_preserve_order
--   alert_subscription_canonical_a4_write_path
--   alert_subscription_canonical_a4b_confirmation_gate
--   alert_subscription_canonical_a5_state_sort_order
--   alert_subscription_canonical_a6_catalog_covers_offered_topics
--   alert_subscription_canonical_a7_integrity_view
--   alert_subscription_canonical_a8_catalog_absorbs_offered_topics
--   alert_subscription_canonical_a9_freeze_topics_pre_migration
--   alert_subscription_canonical_a10_integrity_reports_its_own_guards
--
-- THE CONTRACT. One mutable store: public.user_subscriptions
-- (user_id, community_id, stream, topic) + origin + sort_order, with
-- pipeline_type GENERATED and (stream, topic) FK'd to public.alert_topic_catalog.
-- One answer: alert_subscription_state.subscribed / is_subscribed().
-- Two consumers that both read it: digest_recipients (delivery, homesignal-ingest
-- digest.py::_recipients) and my_alert_subscriptions (UI, shell.js::hydrateTopicPrefs).
-- The legacy users.topics store is RENAMED to users.topics_pre_migration, FROZEN by
-- trigger and RETAINED (founder mandatory change 1). No RPC writes it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- VIEW public.alert_subscription_state          (security_invoker = true)
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
    u.community_id IS NOT NULL AND u.alert_email_consent AND NOT u.unsubscribed AND s.origin = 'explicit'::text AS subscribed,
    s.sort_order
   FROM users u
     JOIN user_subscriptions s ON s.user_id = u.id AND s.community_id = u.community_id;

-- ---------------------------------------------------------------------------
-- VIEW public.my_alert_subscriptions            (security_invoker = true — the UI
-- reads it under the resident's own JWT, so RLS on user_subscriptions is what
-- scopes it to their rows. That is the gate; there is no second one.)
-- ---------------------------------------------------------------------------
 SELECT user_id, email, community_id, zip_code, stream, topic, origin,
    alert_email_consent, unsubscribed, subscribed, sort_order
   FROM alert_subscription_state;

-- ---------------------------------------------------------------------------
-- VIEW public.digest_recipients                 (security_invoker = true)
-- Every delivery filter lives HERE, so the sender cannot drift from the UI.
-- `topics` is an aggregate over user_subscriptions — it is NOT users.topics.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- VIEW public.alert_subscription_integrity      (security_invoker = true)
-- Defined by a7.sql, EXTENDED by a10.sql with absorb_triggers / freeze_trigger /
-- snapshot_retained. The columns below are the a7 six; read a10.sql for the full
-- live shape rather than assuming this block is complete.
-- ---------------------------------------------------------------------------
 SELECT ( SELECT count(*) AS count
           FROM ( SELECT DISTINCT t.topic, s.stream
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
    ( SELECT count(*) AS count FROM alert_topic_catalog) AS catalog_rows,
    ( SELECT count(*) AS count FROM alert_topic_catalog WHERE alert_topic_catalog.active) AS catalog_deliverable,
    ( SELECT count(*) AS count FROM communities
          WHERE communities.government_topics IS NOT NULL AND cardinality(communities.government_topics) > 0) AS communities_offering,
    ( SELECT count(*) AS count FROM user_subscriptions) AS subscription_rows;

-- ---------------------------------------------------------------------------
-- FUNCTION public.is_subscribed(uuid, uuid, text, text)
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
$function$;

-- ---------------------------------------------------------------------------
-- CONSTRAINTS on public.user_subscriptions (pg_get_constraintdef, 2026-09-21)
-- ---------------------------------------------------------------------------
-- subs_change_preserves_consent          TRIGGER DEFERRABLE INITIALLY DEFERRED
-- user_subscriptions_community_id_fkey   FOREIGN KEY (community_id) REFERENCES communities(id)
-- user_subscriptions_origin_ck           CHECK (origin = ANY (ARRAY['explicit','follow_floor']))
-- user_subscriptions_pkey                PRIMARY KEY (id)
-- user_subscriptions_stream_ck           CHECK (stream = ANY (ARRAY['notices','meetings','news','global','emerging']))
-- user_subscriptions_topic_catalog_fk    FOREIGN KEY (stream, topic) REFERENCES alert_topic_catalog(stream, topic)
-- user_subscriptions_user_community_fk   FOREIGN KEY (user_id, community_id) REFERENCES users(id, community_id) ON DELETE CASCADE
-- user_subscriptions_user_id_fkey        FOREIGN KEY (user_id) REFERENCES users(id)
--
-- plus ux_user_subscriptions_canonical UNIQUE (user_id, community_id, stream, topic) —
-- the grain the OLD key could not hold. Its predecessor keyed on
-- (user_id, community_id, pipeline_type, topic), and notices+meetings share
-- pipeline_type 'government_notice', so one of the two selections was silently lost.
-- That is why the migration moved 120 -> 155 rows: +35 recovered meetings selections.

-- ---------------------------------------------------------------------------
-- TRIGGERS added by a8/a9
-- ---------------------------------------------------------------------------
-- communities_absorb_offered_topics_ins  AFTER INSERT ON communities   (statement)
-- communities_absorb_offered_topics_upd  AFTER UPDATE ON communities   (statement)
-- users_topics_pre_migration_frozen      BEFORE INSERT OR UPDATE ON users (row)

-- ---------------------------------------------------------------------------
-- LIVE READING, 2026-09-21 (public.alert_subscription_integrity), which is the
-- control set the CI gate re-measures:
--   uncatalogued_offerings 0 · stored_undeliverable 0 · catalog_rows 94 ·
--   catalog_deliverable 58 · communities_offering 570 · subscription_rows 155 ·
--   absorb_triggers 2 · freeze_trigger 1 · snapshot_retained true
--   (the last three are A10: the detector reports whether its own preventers are
--    still installed, because dropping them does not move any other number)
-- and public.users: 13 rows, 8 carrying a retained topics_pre_migration snapshot,
-- 8 digest recipients.
-- ---------------------------------------------------------------------------

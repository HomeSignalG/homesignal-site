-- ===========================================================================
-- HomeSignal — CANONICAL EMAIL-SUBSCRIPTION MODEL, migration A7
-- THE RECURRENCE DETECTOR — `public.alert_subscription_integrity`
-- Applied 2026-09-21 as `alert_subscription_canonical_a7_integrity_view`.
--
-- A6 repaired a SNAPSHOT. This is the instrument that says when the snapshot has
-- drifted, so the next community build fails a check instead of breaking signup.
-- `scripts/check_alert_subscription_live.py` (homesignal-ingest) reads it daily.
--
-- ONE ROW, and every defect count ships beside a control taken from the same read.
-- A zero over an empty catalog is indistinguishable from a healthy system, which is
-- the failure mode this whole workstream exists to remove.
--
--   uncatalogued_offerings  MUST be 0 — a (stream, topic) a community offers that the
--                           catalog has never seen. Non-zero means a resident can pick
--                           a topic whose write A3's FK will abort.
--   stored_undeliverable    an explicit selection on a catalog row marked `active=false`
--                           — OFFERABLE but not DELIVERABLE. Not a defect; it is the
--                           fact that would otherwise be invisible. Reported, not gated.
--   catalog_rows            CONTROL
--   catalog_deliverable     CONTROL
--   communities_offering    CONTROL
--   subscription_rows       CONTROL
--
-- `security_invoker = true` is restated deliberately: `create or replace view` DROPS
-- reloptions, and losing it here would turn an anon-readable view into one running with
-- the owner's rights, bypassing RLS on `user_subscriptions`. Under the anon role RLS
-- correctly hides other people's rows, so `subscription_rows` reads 0 — which is why
-- the live gate runs with the service key and refuses on a zero control.
-- ===========================================================================

create or replace view public.alert_subscription_integrity
with (security_invoker = true) as
select
  (select count(*) from (
     select distinct t.topic, s.stream
       from public.communities c,
            lateral unnest(c.government_topics) t(topic),
            (values ('notices'), ('meetings')) s(stream)
      where not exists (select 1 from public.alert_topic_catalog k
                         where k.stream = s.stream and k.topic = t.topic)) g
  ) as uncatalogued_offerings,
  (select count(*)
     from public.user_subscriptions s
     join public.alert_topic_catalog k on k.stream = s.stream and k.topic = s.topic
    where not k.active and s.origin = 'explicit'
  ) as stored_undeliverable,
  (select count(*) from public.alert_topic_catalog) as catalog_rows,
  (select count(*) from public.alert_topic_catalog where active) as catalog_deliverable,
  (select count(*) from public.communities
    where government_topics is not null and cardinality(government_topics) > 0
  ) as communities_offering,
  (select count(*) from public.user_subscriptions) as subscription_rows;

do $$
declare v_opt boolean;
begin
  select 'security_invoker=true' = any (c.reloptions) into v_opt
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'alert_subscription_integrity';
  if not coalesce(v_opt, false) then
    raise exception 'A7 refused: alert_subscription_integrity lost security_invoker';
  end if;
end $$;

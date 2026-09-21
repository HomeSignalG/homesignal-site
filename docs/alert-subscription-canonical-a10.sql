-- ===========================================================================
-- HomeSignal — CANONICAL EMAIL-SUBSCRIPTION MODEL, migration A10
-- THE DETECTOR REPORTS ITS OWN PREVENTERS
-- Applied 2026-09-21 as
--   `alert_subscription_canonical_a10_integrity_reports_its_own_guards`.
--
-- A7 reports `uncatalogued_offerings = 0`. A8's two triggers are WHY it stays 0.
-- Drop them and the reading does not move — it stays 0 until the next community
-- build, at which point residents on the new ZIPs cannot subscribe at all. That is
-- a guard that stops guarding with nothing failing, which is the recurring shape in
-- this repo's own record ("an instrument must prove it ran before its silence counts
-- as evidence"). A9's freeze is the same: the column can be renamed back and
-- re-opened for writes while every count in A7 still reads healthy.
--
-- So the guards become part of the READING rather than an assumption behind it:
--   absorb_triggers    MUST be 2   (communities_absorb_offered_topics_ins + _upd)
--   freeze_trigger     MUST be 1   (users_topics_pre_migration_frozen)
--   snapshot_retained  MUST be true (users.topics_pre_migration still exists)
--
-- Columns are APPENDED — `create or replace view` cannot reorder or rename one —
-- and `security_invoker = true` is restated because a replace DROPS reloptions, and
-- losing it would run this view with the owner's rights over user_subscriptions.
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
  (select count(*) from public.user_subscriptions) as subscription_rows,
  (select count(*) from pg_trigger
    where tgrelid = 'public.communities'::regclass
      and not tgisinternal
      and tgname in ('communities_absorb_offered_topics_ins',
                     'communities_absorb_offered_topics_upd')
  ) as absorb_triggers,
  (select count(*) from pg_trigger
    where tgrelid = 'public.users'::regclass
      and not tgisinternal
      and tgname = 'users_topics_pre_migration_frozen'
  ) as freeze_trigger,
  (select exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'users'
                     and column_name = 'topics_pre_migration')
  ) as snapshot_retained;

do $$
declare r record; v_opt boolean;
begin
  select 'security_invoker=true' = any (c.reloptions) into v_opt
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'alert_subscription_integrity';
  if not coalesce(v_opt, false) then
    raise exception 'A10 refused: alert_subscription_integrity lost security_invoker';
  end if;

  select * into r from public.alert_subscription_integrity;
  if r.absorb_triggers <> 2 or r.freeze_trigger <> 1 or not r.snapshot_retained then
    raise exception 'A10 refused: absorb_triggers=% freeze_trigger=% snapshot_retained=%',
      r.absorb_triggers, r.freeze_trigger, r.snapshot_retained;
  end if;
  raise notice 'A10 ok: absorb_triggers=2 freeze_trigger=1 snapshot_retained=true';
end $$;

-- ---------------------------------------------------------------------------
-- LIVE READING after apply, 2026-09-21:
--   uncatalogued_offerings 0 · stored_undeliverable 0 · catalog_rows 94 ·
--   catalog_deliverable 58 · communities_offering 570 · subscription_rows 155 ·
--   absorb_triggers 2 · freeze_trigger 1 · snapshot_retained true
-- ---------------------------------------------------------------------------

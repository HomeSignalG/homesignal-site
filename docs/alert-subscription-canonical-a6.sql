-- ===========================================================================
-- HomeSignal — CANONICAL EMAIL-SUBSCRIPTION MODEL, migration A6
-- THE CATALOG IS A SUPERSET OF EVERYTHING COMMUNITIES OFFER
-- Applied 2026-09-21 as `alert_subscription_canonical_a6_catalog_covers_offered_topics`.
--
-- THE REGRESSION THIS REPAIRS WAS MINE. A1 seeded `alert_topic_catalog` from
-- `digest.py::CANONICAL_TOPICS` alone, and A3 then added
--   user_subscriptions_topic_catalog_fk FOREIGN KEY (stream, topic)
--     REFERENCES alert_topic_catalog(stream, topic)
-- so a topic a community OFFERS but the catalog has never seen stopped being a silent
-- drop and became a HARD ABORT at signup. Measured live, in a rolled-back transaction,
-- with a control that passes (Box Elder County, a real user+community pair):
--
--   catalog rows for the newly offered topic ......... 0
--   RESIDENT SELECTS THE NEWLY OFFERED TOPIC ......... FAILED
--     -> violates foreign key constraint "user_subscriptions_topic_catalog_fk"
--   CONTROL, catalogued topic, same user + community .. SUCCEEDED
--
-- Exposure at the time of the repair: 18 live communities offering a
-- `City government (X)` label absent from the 58-row catalog (Orem, Provo, Lehi,
-- Spanish Fork, Saratoga Springs, ... — Utah County cities), across 25 ZIP pages.
--
-- THE SET IS COMPUTED IN THE DATABASE, NEVER TRANSCRIBED (claims rule 7): the 18 are
-- not named anywhere in this file, so replaying it on a moved population is correct
-- rather than stale.
--
-- NEW ROWS LAND `active = false` ON PURPOSE. Offerable is not deliverable: whether a
-- topic can be EMAILED is a decision about `digest.py::CANONICAL_TOPICS`, and making
-- one by side effect of seeding a community is how a resident comes to pick a topic
-- nothing will ever send. `active` is informational today -- `digest_recipients` does
-- not join the catalog -- and `alert_subscription_integrity.stored_undeliverable`
-- is what makes an undeliverable pick observable instead of invisible.
-- ===========================================================================

insert into public.alert_topic_catalog (stream, topic, active)
select distinct s.stream, t.topic, false
  from public.communities c,
       lateral unnest(c.government_topics) t(topic),
       (values ('notices'), ('meetings')) s(stream)
 where t.topic is not null
   and btrim(t.topic) <> ''
on conflict (stream, topic) do nothing;   -- never downgrades an active row

-- Fail closed: the repair is not done until nothing a community offers is uncatalogued.
do $$
declare v_gap int; v_catalog int; v_offering int;
begin
  select count(*) into v_gap from (
    select distinct t.topic, s.stream
      from public.communities c,
           lateral unnest(c.government_topics) t(topic),
           (values ('notices'), ('meetings')) s(stream)
     where not exists (select 1 from public.alert_topic_catalog k
                        where k.stream = s.stream and k.topic = t.topic)) g;
  select count(*) into v_catalog from public.alert_topic_catalog;
  select count(*) into v_offering from public.communities
   where government_topics is not null and cardinality(government_topics) > 0;

  -- CONTROLS FIRST. A zero gap over an empty catalog, or over zero offering
  -- communities, is a broken query rather than a healthy system.
  if v_catalog = 0 or v_offering = 0 then
    raise exception 'A6 refused: catalog=% offering communities=% — NOTHING WAS VERIFIED',
      v_catalog, v_offering;
  end if;
  if v_gap <> 0 then
    raise exception 'A6 refused: % offered (stream, topic) pair(s) still uncatalogued', v_gap;
  end if;
  raise notice 'A6 ok: catalog=%, communities offering topics=%, uncatalogued=0',
    v_catalog, v_offering;
end $$;

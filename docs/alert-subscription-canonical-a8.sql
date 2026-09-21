-- ===========================================================================
-- HomeSignal — CANONICAL EMAIL-SUBSCRIPTION MODEL, migration A8
-- THE CATALOG ABSORBS WHAT A COMMUNITY OFFERS — continuously, not once
-- Applied 2026-09-21 as
--   `alert_subscription_canonical_a8_catalog_absorbs_offered_topics`.
--
-- A6 repaired the snapshot; A7 detects the drift. Neither stops it. A community seed
-- is a MIGRATION, so it lands in production between two runs of a daily CI gate — and
-- during that window a resident on the new ZIP picks the offered topic and the write
-- aborts. The site's own precedent is explicit about this shape: "the hole is closed in
-- the DATABASE, not in application code — the drift arrived through a migration, so a
-- JS/edge-function guard could never have caught it" (canonical_zip_registry).
--
-- ⛔ AND THE OBVIOUS DB GUARD IS THE WRONG ONE. A trigger that REFUSED a community
-- offering an uncatalogued topic would convert a silent signup break into a BLOCKED
-- COMMUNITY BUILD, which is worse and contradicts site CLAUDE.md §0 ("a new community
-- must be addable as pure data — zero engineering"). So this trigger is ADDITIVE: it
-- inserts what is missing and refuses nothing.
--
-- New rows land `active = false` — OFFERABLE, not DELIVERABLE. Whether a topic can be
-- emailed is a decision about `digest.py::CANONICAL_TOPICS`; making it as a side effect
-- of seeding a community is exactly how a resident comes to pick a topic nothing sends.
-- ===========================================================================

create or replace function public.alert_catalog_absorb_offered_topics()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  insert into public.alert_topic_catalog (stream, topic, active)
  select distinct s.stream, t.topic, false
    from newrows c,
         lateral unnest(c.government_topics) t(topic),
         (values ('notices'), ('meetings')) s(stream)
   where t.topic is not null and btrim(t.topic) <> ''
  on conflict (stream, topic) do nothing;   -- never downgrades an active row
  return null;
end $function$;

-- Transition tables cannot be shared by a multi-event trigger, and Postgres refuses a
-- column list beside one (`transition tables cannot be specified for triggers with
-- column lists`) — so this is two triggers over one function and the UPDATE trigger is
-- unqualified. Statement-level: a 9,729-row state seed pays ONE insert, not 9,729, and
-- a community update that changes no topic is a no-op ON CONFLICT.
drop trigger if exists communities_absorb_offered_topics_ins on public.communities;
create trigger communities_absorb_offered_topics_ins
  after insert on public.communities
  referencing new table as newrows
  for each statement execute function public.alert_catalog_absorb_offered_topics();

drop trigger if exists communities_absorb_offered_topics_upd on public.communities;
create trigger communities_absorb_offered_topics_upd
  after update on public.communities
  referencing new table as newrows
  for each statement execute function public.alert_catalog_absorb_offered_topics();

do $$
declare v int;
begin
  select uncatalogued_offerings into v from public.alert_subscription_integrity;
  if v <> 0 then
    raise exception 'A8 refused: % offered topic(s) still uncatalogued', v;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- VERIFIED LIVE 2026-09-21, one rolled-back transaction, 6 checks with controls.
-- The SAME probe run BEFORE the apply is the counterfactual: check 3 read FAILED.
--
--   community under test: Box Elder County
--   1 catalog rows auto-created for the newly offered topic: 2  (notices + meetings)
--   2 auto-created rows are OFFERABLE not DELIVERABLE (active=false): false
--   3 RESIDENT SELECTS THE NEWLY OFFERED TOPIC: SUCCEEDED      (was FAILED)
--   4 CONTROL an existing DELIVERABLE topic was not downgraded: active=true
--   5 CONTROL an UNOFFERED topic is still REFUSED: yes          (the FK still guards)
--   6 catalog rows 94 -> 96                                     (+2, exact)
-- ---------------------------------------------------------------------------

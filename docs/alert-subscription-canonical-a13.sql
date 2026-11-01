-- ===========================================================================
-- A13 — Local News gains a 13th topic: "Development & Land Use"
-- Founder ruling, 2026-11-01. Additive; one catalog row; nothing else moves.
--
-- WHY. user_subscriptions.(stream, topic) is foreign-keyed to alert_topic_catalog (A3), so a
-- resident ticking the new Local News checkbox is refused until the catalog carries the
-- string. Delivery reads digest.py::SUBTOPIC_VOCAB (homesignal-ingest), which gains the same
-- string in the same change; the classifier writes it to alerts.subtopics.
--
-- SCOPE. Stream 'news' only (the Local News checkboxes). Notices and meetings keep their own
-- topics. No existing subscriber is enrolled: following is not enrollment (contract A), so a
-- resident gets the new topic only by ticking it.
--
-- Idempotent: a replay changes nothing.
-- ===========================================================================

insert into public.alert_topic_catalog (stream, topic, active)
values ('news', 'Development & Land Use', true)
on conflict (stream, topic) do update set active = true;

do $$
declare n int;
begin
  select count(*) into n from public.alert_topic_catalog where stream = 'news' and active;
  if n <> 13 then
    raise exception 'A13: expected 13 active Local News topics, found %', n;
  end if;
end $$;

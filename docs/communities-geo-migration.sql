-- ============================================================
-- HomeSignal — communities table: geo granularity + per-county topics
-- Run in Supabase -> SQL Editor. Additive and safe to re-run.
-- Prepares the communities table so ONE dynamic page can serve any
-- county (and, later, sub-county communities for large counties).
-- ============================================================

-- 1) Add columns (additive; existing rows get safe defaults).
alter table public.communities
  add column if not exists level            text  not null default 'county',  -- county | city | zip | neighborhood
  add column if not exists parent_id        uuid  references public.communities(id),
  add column if not exists government_topics text[] not null default '{}';     -- per-county Government Notices topics

-- 2) Seed Box Elder's 7 government topics (verbatim — must match popup labels).
update public.communities
set government_topics = array[
  'County Commission & county business',
  'Planning, zoning & development',
  'Property taxes & assessments',
  'Public safety & emergencies',
  'Water districts & utilities',
  'Elections & voting',
  'Stratos data center project'
]
where id = 'd67c558f-1f04-4811-a565-873ae2afd6f3';

-- 3) Verify: confirm level, zip_codes, and government_topics are populated.
select id, name, level, zip_codes, government_topics
from public.communities
order by name;

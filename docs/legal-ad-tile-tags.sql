-- APPLIED 2026-11-27 (founder approval): column, constraint, review table, archive row, DB-computed backfill (31 rows: 12 local_news + 19 government_notice) and the app_refresh_zip splice. Rollback: docs/legal-ad-tile-tags-rollback.sql.
-- (was: PARKED, NOT APPLIED) (founder routing rule 2026-11-27: legal ads show on Government Notices AND Local News).
-- Evidence (2026-11-27): public.alerts has ONE `pipeline_type` (NOT NULL) and ONE `category` (NOT NULL) per row, plus
-- `subtopics text[]` (topics, not tiles). 31 bid-like rows = 19 government_notice + 12 news/local_news, each on one tile only.
-- Smallest change: a second tag on the SAME row (no duplicate rows).
begin;

alter table public.alerts
  add column if not exists tile_tags text[] not null default '{}'::text[];

alter table public.alerts drop constraint if exists alerts_tile_tags_known;
alter table public.alerts add constraint alerts_tile_tags_known
  check (tile_tags <@ array['government_notices','local_news']::text[]) not valid;   -- validate after the backfill

-- Review list: notices that look partly like a meeting. Never read by a resident surface.
create table if not exists public.legal_notice_review (
  alert_id    uuid primary key references public.alerts(id) on delete cascade,
  reason      text not null,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decision    text check (decision in ('meeting','not_meeting'))
);
alter table public.legal_notice_review enable row level security;   -- no policy: service role only

-- Backfill COMPUTED IN THE DATABASE, never transcribed (claims rule 7). Same procurement words as
-- homesignal-ingest legal_notice_routing.py. Run only after the founder approves; fingerprint the set first:
--   select count(*), md5(string_agg(id::text, ',' order by id collate "C")) from public.alerts
--   where title ~* '<LEGAL/PROCUREMENT pattern>' and tile_tags = '{}';
-- update public.alerts set tile_tags = array['government_notices','local_news']
--   where title ~* '<same pattern>' and tile_tags = '{}';

-- NOT DONE HERE (needs a splice of the LIVE bodies, rule 7): app_refresh_zip must also select
-- `'local_news' = any(tile_tags)` rows for the Government Notices tile and `'government_notices' = any(tile_tags)` for
-- Local News; digest.py _fetch_news_tier and the notices read must do the same. See PR description.
commit;

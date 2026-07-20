-- ============================================================================
-- MAP + EVENT IDENTITY BACKBONE (2026-07-20)
-- Parked DDL — apply manually in Supabase SQL editor after auditing live data.
--
-- Problem: app_changes rows for meetings carry no stable identity columns.
-- Materializer stamps occurred_at = current_date on every refresh, so the UI
-- cannot distinguish a re-ingested row from a new occurrence. Presentation-layer
-- title grouping (PR #323) incorrectly merged separate recurring meetings.
--
-- Fix layers (preferred order):
--   1. ingest upsert on meetings.dedupe_key / source_url (homesignal-ingest)
--   2. app_refresh_zip writes identity columns + uses meeting.id as change anchor
--   3. unique (zip, source_ref) on app_changes where source_ref is non-empty
-- ============================================================================

begin;

-- ── Identity columns on app_changes ─────────────────────────────────────────
alter table public.app_changes add column if not exists meeting_id uuid;
alter table public.app_changes add column if not exists source_record_id text;
alter table public.app_changes add column if not exists canonical_event_id text;
alter table public.app_changes add column if not exists series_id text;

comment on column public.app_changes.meeting_id is
  'FK-style anchor to public.meetings.id when this change row materializes a meeting.';
comment on column public.app_changes.source_record_id is
  'Stable external document URL or vendor row id — same value on every ingest run.';
comment on column public.app_changes.canonical_event_id is
  'One real-world occurrence (a specific meeting date or one notice document).';
comment on column public.app_changes.series_id is
  'Recurring series label (body name) — occurrences differ by canonical_event_id.';

-- Backfill from existing rows (safe: only fills nulls).
update public.app_changes c
set source_record_id = coalesce(c.source_record_id, c.source_ref),
    canonical_event_id = coalesce(c.canonical_event_id,
      case when c.source_ref is not null and c.source_ref <> ''
           then 'src:' || c.source_ref
           else 'row:' || c.id::text end),
    series_id = coalesce(c.series_id,
      coalesce(c.zip, '') || '|' ||
      lower(regexp_replace(coalesce(c.title, ''), '^public meeting\s*[—–-]\s*', '', 'i')) || '|' ||
      coalesce(c.category, ''))
where c.source_record_id is null
   or c.canonical_event_id is null
   or c.series_id is null;

-- ── Uniqueness: one app_changes row per official source document per ZIP ───
-- Audit before applying (should return 0 rows):
--   select zip, source_ref, count(*) from app_changes
--   where coalesce(source_ref,'') <> '' group by 1,2 having count(*) > 1;
create unique index if not exists app_changes_zip_source_ref_uidx
  on public.app_changes (zip, source_ref)
  where coalesce(source_ref, '') <> '';

-- ── app_refresh_zip: stamp meeting identity on materialize ───────────────────
-- NOTE: pull the LIVE function body via pg_get_functiondef first; this fragment
-- replaces ONLY the meetings→app_changes insert. Re-run app_refresh_all after apply.

/*
  insert into public.app_changes (
    community_id, zip, category, title, plain_language,
    occurred_at, source_ref, confidence, window_closes_at, lens,
    meeting_id, source_record_id, canonical_event_id, series_id
  )
  select coalesce(_root, _cid), _zip, 'Government & civic',
    'Public meeting — ' || m.title || ' · ' || to_char(m.meeting_date, 'Mon DD, YYYY'),
    coalesce(_county || ' County', 'County') || ' ' ||
      coalesce(nullif(m.meeting_type, ''), 'meeting') || ' on ' ||
      to_char(m.meeting_date, 'Mon DD, YYYY') ||
      coalesce(' · ' || nullif(m.location, ''), '') || '.',
    coalesce(m.meeting_date::date, current_date),
    m.source_url, 'High', m.meeting_date::date, 'safety',
    m.id,
    m.source_url,
    coalesce('dedupe:' || m.dedupe_key, 'mtg:' || m.id::text),
    coalesce(_cid::text, _zip) || '|' ||
      lower(regexp_replace(coalesce(m.title, ''), '\s+', ' ', 'g')) || '|Government & civic'
  from public.meetings m
  where m.community_id = coalesce(_root, _cid)
    and m.meeting_date >= now()
    and coalesce(m.source_url, '') <> ''
  order by m.meeting_date asc
  limit 8
  on conflict (zip, source_ref) where coalesce(source_ref, '') <> '' do update set
    title = excluded.title,
    plain_language = excluded.plain_language,
    occurred_at = excluded.occurred_at,
    window_closes_at = excluded.window_closes_at,
    meeting_id = excluded.meeting_id,
    canonical_event_id = excluded.canonical_event_id,
    series_id = excluded.series_id;
*/

commit;

-- ROLLBACK (manual):
--   drop index if exists app_changes_zip_source_ref_uidx;
--   alter table public.app_changes drop column if exists meeting_id;
--   alter table public.app_changes drop column if exists source_record_id;
--   alter table public.app_changes drop column if exists canonical_event_id;
--   alter table public.app_changes drop column if exists series_id;
--   re-apply prior app_refresh_zip body from docs/app-maps-backbone-migration.sql history.

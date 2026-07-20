-- ============================================================================
-- MAP + EVENT IDENTITY BACKBONE (2026-07-20)
-- Parked DDL — apply via docs/candidates/map-event-identity-apply.sql
-- (db-sql workflow) or Supabase SQL editor.
--
-- Problem: app_changes rows for meetings carry no stable identity columns.
-- Materializer stamps occurred_at = current_date on every refresh, so the UI
-- cannot distinguish a re-ingested row from a new occurrence. Presentation-layer
-- title grouping (PR #323) incorrectly merged separate recurring meetings.
--
-- Dataset-precision permit sources (Detroit BSEED trio) stamped every row in a
-- ZIP with the same Hub landing-page URL — 48226 audit FAIL (5 rows, 1 source_ref).
--
-- Fix layers (preferred order):
--   1. ingest upsert on meetings.dedupe_key / source_url (homesignal-ingest — verified)
--   2. engine record_url_template for Detroit (jurisdiction-registry.json)
--   3. app_dev_site_source_ref() + app_refresh_zip materializer patch
--   4. unique (zip, source_ref) on app_changes where source_ref is non-empty
-- ============================================================================

-- ── PRE-APPLY AUDIT (must return 0 rows before unique index) ─────────────────
-- select zip, source_ref, count(*) from app_changes
-- where coalesce(source_ref,'') <> '' group by 1,2 having count(*) > 1;

-- ── Helper: stable per-record source_ref from development_reports site JSON ──
-- Detroit: verified first-party Accela eLAPS record-number search URL.
-- Other dataset-precision sources: append #case=<case_number> (unique anchor).
create or replace function public.app_dev_site_source_ref(el jsonb)
returns text
language sql
immutable
as $$
  select case
    when coalesce(el->>'source_registry_id','') like 'detroit-%'
         and coalesce(el->>'case_number','') <> ''
    then 'https://aca-prod.accela.com/DETROIT/Cap/CapHome.aspx?module=Permits&TabName=Permits&RecordNumber='
         || (el->>'case_number')
    when coalesce(el->>'record_url_precision','') = 'dataset'
         and coalesce(el->>'case_number','') <> ''
    then coalesce(nullif(el->>'record_url',''), nullif(el->>'url',''))
         || '#case=' || (el->>'case_number')
    else coalesce(nullif(el->>'record_url',''), nullif(el->>'url',''))
  end;
$$;

comment on function public.app_dev_site_source_ref(jsonb) is
  'Anti-fabrication source_ref for app_changes materialized from development_reports.sites. '
  'Dataset-precision rows need a per-record anchor — Detroit uses verified Accela URLs.';

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

-- ── Fix dataset-precision source_ref collisions (48226 Detroit + any similar) ─
with fixes as (
  select dr.zip,
         el->>'label' as title,
         public.app_dev_site_source_ref(el) as new_ref
  from public.development_reports dr,
       jsonb_array_elements(dr.sites) el
  where coalesce(el->>'relevance','') in ('development','civic')
    and coalesce(el->>'record_url', el->>'url', '') <> ''
)
update public.app_changes c
set source_ref = f.new_ref,
    source_record_id = coalesce(c.source_record_id, f.new_ref),
    canonical_event_id = 'src:' || f.new_ref
from fixes f
where c.zip = f.zip
  and c.title = f.title
  and f.new_ref is not null
  and c.source_ref is distinct from f.new_ref;

-- Meetings: stamp identity from meetings table where source_ref matches source_url
update public.app_changes c
set meeting_id = m.id,
    source_record_id = coalesce(c.source_record_id, m.source_url),
    canonical_event_id = coalesce(c.canonical_event_id, 'dedupe:' || m.dedupe_key),
    series_id = coalesce(c.series_id,
      coalesce(c.community_id::text, c.zip) || '|' ||
      lower(regexp_replace(coalesce(m.title, ''), '\s+', ' ', 'g')) || '|Government & civic'),
    occurred_at = coalesce(m.meeting_date::date, c.occurred_at)
from public.meetings m
where c.source_ref = m.source_url
  and c.category = 'Government & civic'
  and c.title like 'Public meeting — %'
  and (c.meeting_id is null or c.canonical_event_id is null);

-- Drop any remaining duplicate (zip, source_ref) pairs — keep the newest row.
delete from public.app_changes a
using public.app_changes b
where a.zip = b.zip
  and a.source_ref = b.source_ref
  and coalesce(a.source_ref, '') <> ''
  and a.id < b.id;

-- ── Uniqueness: one app_changes row per official source document per ZIP ───
create unique index if not exists app_changes_zip_source_ref_uidx
  on public.app_changes (zip, source_ref)
  where coalesce(source_ref, '') <> '';

-- ── app_refresh_zip: meetings→app_changes insert (replace in live function) ──
-- Pull the LIVE body via:
--   select pg_get_functiondef(oid) from pg_proc where proname = 'app_refresh_zip';
-- Replace ONLY the meetings insert block with:

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
    source_record_id = excluded.source_record_id,
    canonical_event_id = excluded.canonical_event_id,
    series_id = excluded.series_id;
*/

-- Planning & zoning / civic inserts: replace
--   coalesce(el->>'record_url', el->>'url')
-- with
--   public.app_dev_site_source_ref(el)
-- in the live app_refresh_zip body (two insert statements).

-- ROLLBACK (manual):
--   drop index if exists app_changes_zip_source_ref_uidx;
--   drop function if exists public.app_dev_site_source_ref(jsonb);
--   alter table public.app_changes drop column if exists meeting_id;
--   alter table public.app_changes drop column if exists source_record_id;
--   alter table public.app_changes drop column if exists canonical_event_id;
--   alter table public.app_changes drop column if exists series_id;
--   re-apply prior app_refresh_zip body from docs/app-maps-backbone-migration.sql history.

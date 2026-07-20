-- Map event identity backbone — APPLY script (2026-07-20)
-- Run via: gh workflow run db-sql.yml -f sql_file=docs/candidates/map-event-identity-apply.sql
-- Receipt: node scripts/audit-map-identity.mjs must be 8/8 PASS after apply + refresh.

begin;

-- PRE-AUDIT: duplicate source_ref pairs (expect >0 before fix, 0 after)
select 'pre_audit_dup_pairs' as check, count(*)::int as n
from (
  select zip, source_ref
  from public.app_changes
  where coalesce(source_ref, '') <> ''
  group by 1, 2
  having count(*) > 1
) d;

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

alter table public.app_changes add column if not exists meeting_id uuid;
alter table public.app_changes add column if not exists source_record_id text;
alter table public.app_changes add column if not exists canonical_event_id text;
alter table public.app_changes add column if not exists series_id text;

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

delete from public.app_changes a
using public.app_changes b
where a.zip = b.zip
  and a.source_ref = b.source_ref
  and coalesce(a.source_ref, '') <> ''
  and a.id < b.id;

create unique index if not exists app_changes_zip_source_ref_uidx
  on public.app_changes (zip, source_ref)
  where coalesce(source_ref, '') <> '';

-- POST-AUDIT: must be 0
select 'post_audit_dup_pairs' as check, count(*)::int as n
from (
  select zip, source_ref
  from public.app_changes
  where coalesce(source_ref, '') <> ''
  group by 1, 2
  having count(*) > 1
) d;

-- Re-materialize representative ZIPs (Detroit + Travis meetings)
select public.app_refresh_zip('48226');
select public.app_refresh_zip('78617');

commit;

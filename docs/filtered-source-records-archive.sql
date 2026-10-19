-- public.filtered_source_records_archive — keeps the source records a registry noise filter drops.
--
-- WHY. A registry filter (today: `drop_minor_repairs` on tacoma-accela-permits, 2026-10-15) drops a record
-- before it reaches development_reports, so app_refresh_zip then deletes the app_projects row it used to have.
-- The permanent-historical-intelligence rule says removal must not destroy history, and on 2026-10-15 no
-- snapshot was taken first (docs/pierce-county-launch-audit-2026-10-15.md). The records are still served by
-- the public source, so scripts/archive-filtered-source-records.mjs re-reads it, asks the SHIPPED filter
-- (sources/record-hygiene.ts::isMinorRepairNoise) which records it drops, and stores them here.
--
-- One row per (registry_id, source_record_id). Append-only: the writer inserts with ignore-duplicates, so the
-- first copy of a record is never overwritten, and nothing deletes from this table.
-- row_json is the publisher's own attribute row, verbatim. Not resident-facing: RLS on, no anon /
-- authenticated grant.

create table if not exists public.filtered_source_records_archive (
  registry_id      text        not null,
  source_record_id text        not null,
  filter_name      text        not null,
  rule_fingerprint text        not null,
  title            text,
  record_type      text,
  status_raw       text,
  file_date        date,
  record_url       text,
  row_json         jsonb       not null,
  reason           text        not null,
  archived_at      timestamptz not null default now(),
  primary key (registry_id, source_record_id)
);

alter table public.filtered_source_records_archive enable row level security;
revoke all on public.filtered_source_records_archive from public, anon, authenticated;
grant select, insert on public.filtered_source_records_archive to service_role;

-- Append-only: refuse UPDATE and DELETE for every role, the owner included.
create or replace function public.filtered_source_records_archive_append_only()
returns trigger language plpgsql as $fn$
begin
  raise exception 'filtered_source_records_archive is append-only (% refused)', tg_op;
end
$fn$;

drop trigger if exists filtered_source_records_archive_append_only_trg on public.filtered_source_records_archive;
create trigger filtered_source_records_archive_append_only_trg
  before update or delete on public.filtered_source_records_archive
  for each row execute function public.filtered_source_records_archive_append_only();

do $chk$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.filtered_source_records_archive'::regclass) then
    raise exception 'RLS is not enabled on filtered_source_records_archive';
  end if;
  if has_table_privilege('anon', 'public.filtered_source_records_archive', 'select')
     or has_table_privilege('authenticated', 'public.filtered_source_records_archive', 'select') then
    raise exception 'anon/authenticated can read filtered_source_records_archive';
  end if;
end
$chk$;

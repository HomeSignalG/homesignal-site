-- PUBLIC HEARING VISIBILITY: SQL of record (founder policy 2026-11-17; final direction 2026-11-19).
-- Applied to production 2026-11-19 on the founder's explicit authorization.
-- Additive only: nullable columns and new append-only tables. Nothing is dropped, rewritten or backfilled.
-- The decisions live in homesignal-ingest hearings.py (one authority). This file is storage and the read
-- derivation; its constants are pinned to hearings.py by test/public-hearings-sql.test.mjs.

set local lock_timeout = '5s';
alter table public.meetings
  add column if not exists confirmation_state text check (confirmation_state in ('official','provisional')),
  add column if not exists source_tier        text check (source_tier in ('government_body','advisory_committee')),
  add column if not exists hearing_status     text check (hearing_status in ('scheduled','cancelled','postponed','superseded','held')),
  add column if not exists hearing_key        text,
  add column if not exists hearing_key_confidence text check (hearing_key_confidence in ('high','medium','low')),
  add column if not exists hearing_subject    text check (hearing_subject in ('development_land_use','budget_tax','other')),
  add column if not exists date_basis         text check (date_basis in
        ('vendor_event','stated_in_notice','stated_in_title','posting_date_fallback','unknown_legacy')),
  add column if not exists announced_on       date,
  add column if not exists notice_published_on date,
  add column if not exists decision_date      date,
  add column if not exists decision_outcome   text,
  add column if not exists comment_deadline   date,
  add column if not exists comment_deadline_verified boolean,
  add column if not exists comment_instructions text,
  add column if not exists participation_url  text,
  add column if not exists participation_note text;
create index if not exists meetings_hearing_key_idx on public.meetings (hearing_key) where hearing_key is not null;

-- The ONE read derivation. Mirrors hearings.display_state; a placeholder date is never returned.
create or replace function public.hearing_display_state(m public.meetings)
returns text language sql stable as $$
  select case
    when m.hearing_status = 'cancelled' then 'cancelled'
    when m.hearing_status in ('superseded','postponed') then 'superseded'
    when m.hearing_status = 'held' then 'held'
    when m.date_basis not in ('vendor_event','stated_in_notice','stated_in_title') or m.date_basis is null then
      case when m.confirmation_state = 'provisional' and m.announced_on < current_date - 365 then 'unresolved'
           when m.confirmation_state = 'provisional' and m.announced_on < current_date - 30 then 'provisional_expired'
           else 'date_not_announced' end
    when m.meeting_date::date >= current_date then 'upcoming'
    when m.confirmation_state = 'provisional' then
      case when m.meeting_date::date < current_date - 365 then 'unresolved' else 'provisional_expired' end
    else 'past_unconfirmed' end
$$;

create or replace function public.hearing_public_date(m public.meetings)
returns date language sql stable as $$
  select case when m.date_basis in ('vendor_event','stated_in_notice','stated_in_title')
              then m.meeting_date::date end $$;

-- Append-only audit tables. RLS on; no visitor access.
create table if not exists public.meeting_reconciliation (
  id bigint generated always as identity primary key,
  provisional_meeting_id uuid not null, official_meeting_id uuid,
  kind text not null check (kind in ('confirmed_by','rescheduled_to','cancelled_by','duplicate_of','unresolved','ambiguous')),
  match_key text, rule_version text not null, evidence_quote text, evidence_url text,
  decided_at timestamptz not null default now());
create table if not exists public.meeting_project_link (
  id bigint generated always as identity primary key,
  meeting_id uuid not null, project_key text not null,
  basis text not null check (basis in ('case_number','named_parcel','named_project','reviewer')),
  evidence text, grade text check (grade in ('a','b','c')), decided_at timestamptz not null default now());
create table if not exists public.hearing_source_evidence (
  id bigint generated always as identity primary key,
  jurisdiction_slug text not null, committee text not null,
  criterion text not null check (criterion in ('E1','E2','E3','E4','E5')),
  passed boolean not null, evidence_url text, evidence_quote text, rule_version text not null,
  status text check (status in ('qualified','assessing','suspended')), note text,
  checked_at timestamptz not null default now());
create table if not exists public.hearing_notification_event (
  id bigint generated always as identity primary key,
  hearing_key text not null,
  event_type text not null check (event_type in
    ('hearing_announced','hearing_rescheduled','hearing_cancelled','comment_deadline_approaching')),
  effective_value text not null, event_hash text not null unique, created_at timestamptz not null default now());

do $$ declare t text; begin
  foreach t in array array['meeting_reconciliation','meeting_project_link','hearing_source_evidence','hearing_notification_event'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert on public.%I to service_role', t);
    execute format('create or replace function public.%I() returns trigger language plpgsql as $f$ begin raise exception ''%% is append-only'', TG_TABLE_NAME; end $f$', t||'_ro');
    execute format('drop trigger if exists %I on public.%I', t||'_ro_trg', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.%I()', t||'_ro_trg', t, t||'_ro');
  end loop; end $$;

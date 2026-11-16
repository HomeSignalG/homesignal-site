-- Tab 20 · Weekly Report, 1 of 7: BASE. DDL of record. PREPARED, NOT APPLIED TO PRODUCTION.
-- The objects every other weekly file builds on, and all the topic queue needs from the research side:
--   weekly_sha256, weekly_append_only        helpers
--   weekly_research_requests                 a research request (the queue writes one when a lead is handed to research)
--   weekly_research_answers, weekly_runs     a pasted answer and an engine run. The queue only READS these, to derive a
--                                            lead's research status. NOTHING in this file or in the queue file writes
--                                            them or dispatches anything: the functions that do are in 3 (workbench).
-- weekly_runs.kind lists every run kind of files 3-6 (shared vocabulary, kept in one place).
-- Nothing here is readable or writable by anon or authenticated (RLS on, no grant).
-- Needs: public.alert_topic_catalog (docs/alert-subscription-canonical-a1.sql).
-- Application order (docs/weekly-release-order.md): 1 base · 2 topic queue  [the queue-only release ends here]
--   · 3 workbench · 4 source copies · 5 titles · 6 document cues · 7 topic-queue approval gate.
-- Each file is one transaction and is idempotent; re-applying an earlier file after a later one changes nothing.

begin;

-- ── shared helpers ────────────────────────────────────────────────────────────────────────────────────────────────
-- sha256 of a text's UTF-8 bytes. Declared immutable so generated columns can use it (the database encoding is UTF-8).
create or replace function public.weekly_sha256(t text) returns text language sql immutable strict parallel safe as
  $$ select encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;

create or replace function public.weekly_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (no %)', tg_table_name, lower(tg_op) using errcode = '55000';
end $$;

-- ── run queue ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('research_ingest', 'angles', 'outline', 'script', 'rewrite', 'titles', 'title_check', 'visual_check', 'source_copy')),
  topic text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  requested_by text not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- ── research: request → pasted answer → sources → findings ────────────────────────────────────────────────────────
create table if not exists public.weekly_research_requests (
  id uuid primary key default gen_random_uuid(),
  stream text not null default 'news',
  topic text not null,
  request_text text not null check (char_length(request_text) between 20 and 20000),
  request_sha256 text generated always as (public.weekly_sha256(request_text)) stored,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint weekly_research_requests_topic_fk foreign key (stream, topic) references public.alert_topic_catalog (stream, topic)
);

create table if not exists public.weekly_research_answers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.weekly_research_requests (id),
  provider text not null check (provider in ('perplexity')),
  mode text not null check (mode in ('manual_paste')),
  raw_text text not null check (char_length(raw_text) between 1 and 200000),
  raw_sha256 text generated always as (public.weekly_sha256(raw_text)) stored,
  kind text not null default 'ai_draft' check (kind = 'ai_draft'),
  -- The answer is a provider's AI output. Its reuse terms are not reviewed here, so it is kept and exported as a record only.
  export_permission text not null default 'record_only' check (export_permission in ('record_only', 'exclude')),
  pasted_by text not null,
  pasted_at timestamptz not null default now()
);

-- ── append-only triggers, RLS, no direct grants ──
do $$
declare t text;
begin
  foreach t in array array['weekly_research_requests', 'weekly_research_answers'] loop
    execute format('drop trigger if exists %I_append_only on public.%I', t, t);
    execute format('create trigger %I_append_only before update or delete on public.%I for each row execute function public.weekly_append_only()', t, t);
  end loop;
  foreach t in array array['weekly_runs', 'weekly_research_requests', 'weekly_research_answers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ── function grants ──
do $$
declare f text;
begin
  foreach f in array array[
    'weekly_sha256(text)', 'weekly_append_only()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;

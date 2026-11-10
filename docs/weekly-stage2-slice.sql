-- Tab 20 · Weekly Report, STAGE 2 PROOF SLICE (first topic: Air Quality, thumbnail "Air"): DDL of record. PREPARED, NOT APPLIED TO PRODUCTION.
--
-- What this slice proves, end to end, for one topic:
--   1. one research packet (a Perplexity answer pasted by a person, parsed, its sources fetched) is saved here;
--   2. one script is written by Claude (on the founder's plan) from a SEALED library version and an APPROVED profile;
--   3. one correction is saved and approved as a lesson;
--   4. a later script retrieves that lesson, includes it, and its use is assessed and then confirmed by a person.
--
-- Rules this file enforces (test/weekly_stage2_pg proves each one, with mutations):
--   - Nothing here is readable or writable by anon or authenticated directly: every table has RLS on and no grant.
--     People act through admin-only functions (public._hs_is_admin, the dashboard admin list); the workflows act
--     through service_role-only functions.
--   - History is kept: research, sources, findings, decisions, profiles, scripts, corrections, lessons and costs are
--     append-only. A changed finding is a NEW version that names the one it supersedes.
--   - A library version is a pinned set of finding versions, sealed once. Later research never changes it.
--   - Three separate verification results on a source/finding, never one "verified" flag:
--       quote_match      exact | normalized | not_found | not_checked   (a machine compared text; not proof of truth)
--       date_extraction  page_metadata | page_text | not_stated | unknown (an unknown date stays unknown)
--       human_decision   pending | approved | rejected                    (ONLY this makes a finding approved)
--   - Four kinds of material: third_party · original_analysis · ai_draft · human_reviewed. Storage, publication and
--     export permissions are separate; a short quote starts as 'to_confirm', never as cleared; export follows the
--     export permission.
--   - AI work on a plan is cost_type 'no_incremental_api_charge' and carries no amount. Subscription fees are entered
--     by a person as shared overhead. extra_usage_enabled defaults to false and nothing here turns it on.
--   - Lesson use keeps four states apart: retrieved · included · assessed (rule / model / none) · reviewer decision.
--     An assessment is automated and is not a reviewer's confirmation.
-- Needs: public._hs_is_admin (docs/impact-stories.sql), public.alert_topic_catalog (docs/alert-subscription-canonical-a1.sql),
-- vault.decrypted_secrets and net.http_post (Supabase). Idempotent: safe to apply twice.

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
  kind text not null check (kind in ('research_ingest', 'script')),
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

create table if not exists public.weekly_sources (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.weekly_research_answers (id),
  url text not null check (url ~ '^https://'),
  final_url text,
  publisher text,
  title text,
  quote text,
  retrieved_at timestamptz,
  content_sha256 text,
  fetch_error text,
  quote_match text not null check (quote_match in ('exact', 'normalized', 'not_found', 'not_checked')),
  date_extraction text not null check (date_extraction in ('page_metadata', 'page_text', 'not_stated', 'unknown')),
  published_date date,
  kind text not null default 'third_party' check (kind = 'third_party'),
  storage_permission text not null default 'excerpt' check (storage_permission in ('full_copy', 'excerpt', 'link_only', 'none')),
  publication_permission text not null default 'to_confirm'
    check (publication_permission in ('cleared', 'to_confirm', 'terms_not_reviewed', 'needs_permission', 'blocked')),
  export_permission text not null default 'record_only' check (export_permission in ('include', 'record_only', 'exclude')),
  terms_status text not null default 'not_reviewed',
  attribution text,
  created_at timestamptz not null default now(),
  -- An unknown or unstated date has no value; a stated one must have one. Never filled from the fetch date.
  constraint weekly_sources_date_ck check (
    (date_extraction in ('page_metadata', 'page_text') and published_date is not null)
    or (date_extraction in ('not_stated', 'unknown') and published_date is null)),
  -- A page that was never read cannot have matched a quote.
  constraint weekly_sources_unread_ck check (fetch_error is null or (quote_match = 'not_checked' and date_extraction = 'unknown')),
  -- A quote stored only as a link must not carry the quote text.
  constraint weekly_sources_storage_ck check (storage_permission not in ('link_only', 'none') or quote is null)
);

create table if not exists public.weekly_findings (
  id uuid primary key default gen_random_uuid(),
  finding_key text not null check (finding_key ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  version integer not null check (version >= 1),
  supersedes uuid references public.weekly_findings (id),
  stream text not null default 'news',
  topic text not null,
  statement text not null check (char_length(statement) between 5 and 2000),
  qualifiers text[] not null default '{}',
  uncertainty text,
  scope text,
  answer_id uuid not null references public.weekly_research_answers (id),
  kind text not null default 'ai_draft' check (kind in ('ai_draft', 'original_analysis')),
  created_at timestamptz not null default now(),
  constraint weekly_findings_key_version unique (finding_key, version),
  constraint weekly_findings_supersedes_ck check ((version = 1) = (supersedes is null)),
  constraint weekly_findings_topic_fk foreign key (stream, topic) references public.alert_topic_catalog (stream, topic)
);

create table if not exists public.weekly_finding_sources (
  finding_id uuid not null references public.weekly_findings (id),
  source_id uuid not null references public.weekly_sources (id),
  primary key (finding_id, source_id)
);

create table if not exists public.weekly_finding_decisions (
  id bigserial primary key,
  finding_id uuid not null references public.weekly_findings (id),
  decision text not null check (decision in ('approved', 'rejected')),
  note text,
  decided_by text not null,
  decided_at timestamptz not null default now()
);

-- ONE decision for a finding's state. quote_match and date_extraction are reported beside it and never decide it.
create or replace view public.weekly_finding_state with (security_invoker = true) as
  select f.*,
         coalesce((select d.decision from public.weekly_finding_decisions d where d.finding_id = f.id
                   order by d.decided_at desc, d.id desc limit 1), 'pending') as human_decision,
         not exists (select 1 from public.weekly_findings n where n.supersedes = f.id) as is_latest
  from public.weekly_findings f;

-- ── library versions: pinned, sealed sets of finding versions ─────────────────────────────────────────────────────
create table if not exists public.weekly_library_versions (
  id uuid primary key default gen_random_uuid(),
  stream text not null default 'news',
  topic text not null,
  n integer not null check (n >= 1),
  sealed boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint weekly_library_versions_n unique (topic, n)
);
create table if not exists public.weekly_library_version_findings (
  library_version_id uuid not null references public.weekly_library_versions (id),
  finding_id uuid not null references public.weekly_findings (id),
  primary key (library_version_id, finding_id)
);

create or replace function public.weekly_library_guard() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'weekly_library_versions' then
    if tg_op = 'DELETE' then raise exception 'a library version is never deleted' using errcode = '55000'; end if;
    if old.sealed or new.sealed is distinct from true or (to_jsonb(new) - 'sealed') <> (to_jsonb(old) - 'sealed') then
      raise exception 'a library version can only be sealed once, and nothing else changes' using errcode = '55000';
    end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then raise exception 'pinned findings never change' using errcode = '55000'; end if;
  if (select sealed from public.weekly_library_versions where id = new.library_version_id) then
    raise exception 'library version is sealed' using errcode = '55000';
  end if;
  return new;
end $$;

-- ── editorial profile ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_editorial_profiles (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  rules jsonb not null check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) between 1 and 60),
  kind text not null default 'original_analysis' check (kind = 'original_analysis'),
  created_by text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.weekly_profile_approvals (
  id bigserial primary key,
  profile_id uuid not null references public.weekly_editorial_profiles (id),
  approved_by text not null,
  approved_at timestamptz not null default now()
);

-- ── scripts, approvals, corrections ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_scripts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.weekly_runs (id),
  stream text not null default 'news',
  topic text not null,
  library_version_id uuid not null references public.weekly_library_versions (id),
  profile_id uuid not null references public.weekly_editorial_profiles (id),
  lessons_included uuid[] not null default '{}',
  prompt_sha256 text not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  provider text not null,
  model text,
  body jsonb not null check (jsonb_typeof(body -> 'segments') = 'array'),
  body_sha256 text generated always as (public.weekly_sha256(body::text)) stored,
  -- Mechanical checks only. They are labelled as such and never certify factual accuracy.
  checks jsonb not null,
  kind text not null default 'ai_draft' check (kind = 'ai_draft'),
  created_at timestamptz not null default now()
);
create table if not exists public.weekly_script_approvals (
  id bigserial primary key,
  script_id uuid not null references public.weekly_scripts (id),
  body_sha256 text not null,
  approved_by text not null,
  approved_at timestamptz not null default now()
);
create table if not exists public.weekly_corrections (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references public.weekly_scripts (id),
  segment_index integer not null check (segment_index >= 0),
  before_text text not null,
  after_text text not null check (char_length(after_text) between 1 and 4000),
  note text,
  kind text not null default 'human_reviewed' check (kind = 'human_reviewed'),
  created_by text not null,
  created_at timestamptz not null default now()
);

-- ── lessons and their use ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_lessons (
  id uuid primary key default gen_random_uuid(),
  stream text not null default 'news',
  topic text not null,
  text text not null check (char_length(text) between 5 and 1000),
  -- Optional mechanical test the checker runs on later drafts: {"type": "avoid_phrase"|"require_phrase", "value": "..."}.
  test jsonb check (test is null or (test ->> 'type' in ('avoid_phrase', 'require_phrase')
                                     and char_length(coalesce(test ->> 'value', '')) between 2 and 200)),
  correction_id uuid not null references public.weekly_corrections (id),
  example_before text not null,
  example_after text not null,
  kind text not null default 'human_reviewed' check (kind = 'human_reviewed'),
  created_by text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.weekly_lesson_decisions (
  id bigserial primary key,
  lesson_id uuid not null references public.weekly_lessons (id),
  decision text not null check (decision in ('approved', 'rejected', 'retired')),
  decided_by text not null,
  decided_at timestamptz not null default now()
);
create or replace view public.weekly_lesson_state with (security_invoker = true) as
  select l.*, coalesce((select d.decision from public.weekly_lesson_decisions d where d.lesson_id = l.id
                        order by d.decided_at desc, d.id desc limit 1), 'proposed') as status
  from public.weekly_lessons l;

create table if not exists public.weekly_lesson_uses (
  id bigserial primary key,
  script_id uuid not null references public.weekly_scripts (id),
  lesson_id uuid not null references public.weekly_lessons (id),
  retrieved boolean not null,
  included boolean not null,
  assessed text not null check (assessed in ('applied', 'not_applied', 'not_assessed')),
  assessed_by text not null check (assessed_by in ('rule', 'model', 'none')),
  assessment_note text,
  reviewer_decision text not null default 'pending' check (reviewer_decision in ('pending', 'confirmed', 'corrected')),
  reviewer_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  constraint weekly_lesson_uses_one unique (script_id, lesson_id),
  constraint weekly_lesson_uses_included_ck check (retrieved or not included),
  constraint weekly_lesson_uses_assessed_ck check ((assessed = 'not_assessed') = (assessed_by = 'none'))
);
create or replace function public.weekly_lesson_use_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'lesson uses are never deleted' using errcode = '55000'; end if;
  if old.reviewer_decision <> 'pending' or new.reviewer_decision = 'pending'
     or (to_jsonb(new) - array['reviewer_decision', 'reviewer_note', 'reviewed_by', 'reviewed_at'])
        <> (to_jsonb(old) - array['reviewer_decision', 'reviewer_note', 'reviewed_by', 'reviewed_at']) then
    raise exception 'only a pending reviewer decision can be set, once' using errcode = '55000';
  end if;
  return new;
end $$;

-- ── costs and subscriptions ───────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_cost_entries (
  id bigserial primary key,
  run_id uuid references public.weekly_runs (id),
  category text not null check (category in ('research', 'writing', 'verification', 'narration', 'rendering', 'storage', 'other')),
  cost_type text not null check (cost_type in ('no_incremental_api_charge', 'runner_minutes', 'storage_bytes', 'licensing',
                                               'subscription_overhead', 'extra_usage')),
  scope text not null check (scope in ('shared', 'report')),
  library_version_id uuid references public.weekly_library_versions (id),
  script_id uuid references public.weekly_scripts (id),
  quantity numeric,
  unit text,
  amount_usd numeric,
  note text,
  created_at timestamptz not null default now(),
  constraint weekly_cost_plan_ck check (cost_type <> 'no_incremental_api_charge' or amount_usd is null)
);
create table if not exists public.weekly_subscriptions (
  id bigserial primary key,
  provider text not null check (provider in ('perplexity', 'claude')),
  plan text not null,
  monthly_fee_usd numeric check (monthly_fee_usd is null or monthly_fee_usd >= 0),
  usage_limits text,
  extra_usage_enabled boolean not null default false,
  recorded_by text not null,
  recorded_at timestamptz not null default now()
);

-- ── append-only triggers, RLS, no direct grants ───────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['weekly_research_requests', 'weekly_research_answers', 'weekly_sources', 'weekly_findings',
    'weekly_finding_sources', 'weekly_finding_decisions', 'weekly_editorial_profiles', 'weekly_profile_approvals',
    'weekly_scripts', 'weekly_script_approvals', 'weekly_corrections', 'weekly_lessons', 'weekly_lesson_decisions',
    'weekly_cost_entries', 'weekly_subscriptions'] loop
    execute format('drop trigger if exists %I_append_only on public.%I', t, t);
    execute format('create trigger %I_append_only before update or delete on public.%I for each row execute function public.weekly_append_only()', t, t);
  end loop;
  foreach t in array array['weekly_runs', 'weekly_research_requests', 'weekly_research_answers', 'weekly_sources',
    'weekly_findings', 'weekly_finding_sources', 'weekly_finding_decisions', 'weekly_library_versions',
    'weekly_library_version_findings', 'weekly_editorial_profiles', 'weekly_profile_approvals', 'weekly_scripts',
    'weekly_script_approvals', 'weekly_corrections', 'weekly_lessons', 'weekly_lesson_decisions', 'weekly_lesson_uses',
    'weekly_cost_entries', 'weekly_subscriptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on public.weekly_finding_state, public.weekly_lesson_state from public, anon, authenticated;

drop trigger if exists weekly_library_versions_guard on public.weekly_library_versions;
create trigger weekly_library_versions_guard before update or delete on public.weekly_library_versions
  for each row execute function public.weekly_library_guard();
drop trigger if exists weekly_library_version_findings_guard on public.weekly_library_version_findings;
create trigger weekly_library_version_findings_guard before insert or update or delete on public.weekly_library_version_findings
  for each row execute function public.weekly_library_guard();
drop trigger if exists weekly_lesson_uses_guard on public.weekly_lesson_uses;
create trigger weekly_lesson_uses_guard before update or delete on public.weekly_lesson_uses
  for each row execute function public.weekly_lesson_use_guard();

-- ── dispatch (the two slice workflows only, always ref main) ──────────────────────────────────────────────────────
create or replace function public._wk_dispatch(p_workflow text, p_run uuid) returns boolean
language plpgsql security definer set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare _pat text;
begin
  if p_workflow not in ('weekly-research-ingest.yml', 'weekly-script-run.yml') then raise exception 'unknown workflow'; end if;
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then return false; end if;
  perform net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/' || p_workflow || '/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('run', p_run::text)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-weekly-report', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000);
  return true;
end $$;

-- ── admin functions (a signed-in dashboard admin) ─────────────────────────────────────────────────────────────────
create or replace function public.hs_weekly_request_research(p_topic text, p_request_text text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); r uuid;
begin
  insert into public.weekly_research_requests (topic, request_text, created_by) values (p_topic, p_request_text, e) returning id into r;
  return r;
end $$;

create or replace function public.hs_weekly_paste_answer(p_request uuid, p_raw_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); q public.weekly_research_requests; a uuid; r uuid; sent boolean;
begin
  select * into q from public.weekly_research_requests where id = p_request;
  if q.id is null then raise exception 'unknown research request' using errcode = '22023'; end if;
  if exists (select 1 from public.weekly_runs where kind = 'research_ingest' and topic = q.topic and status in ('queued', 'running')) then
    raise exception 'a research ingest is already running for this topic' using errcode = '55006';
  end if;
  insert into public.weekly_research_answers (request_id, provider, mode, raw_text, pasted_by)
    values (q.id, 'perplexity', 'manual_paste', p_raw_text, e) returning id into a;
  insert into public.weekly_runs (kind, topic, input, requested_by)
    values ('research_ingest', q.topic, jsonb_build_object('answer_id', a), e) returning id into r;
  sent := public._wk_dispatch('weekly-research-ingest.yml', r);
  if not sent then
    update public.weekly_runs set status = 'failed', error = 'not started: the GitHub dispatch credential is missing', finished_at = now() where id = r;
  end if;
  return jsonb_build_object('answer_id', a, 'run_id', r, 'dispatched', sent);
end $$;

create or replace function public.hs_weekly_finding_decide(p_finding uuid, p_decision text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  if not exists (select 1 from public.weekly_findings where id = p_finding) then raise exception 'unknown finding' using errcode = '22023'; end if;
  insert into public.weekly_finding_decisions (finding_id, decision, note, decided_by) values (p_finding, p_decision, p_note, e);
  return p_decision;
end $$;

-- Seals a NEW version containing every latest, approved finding of the topic. Existing versions are never touched.
create or replace function public.hs_weekly_library_seal(p_topic text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v uuid; nn integer; k integer;
begin
  select coalesce(max(n), 0) + 1 into nn from public.weekly_library_versions where topic = p_topic;
  insert into public.weekly_library_versions (topic, n, created_by) values (p_topic, nn, e) returning id into v;
  insert into public.weekly_library_version_findings (library_version_id, finding_id)
    select v, s.id from public.weekly_finding_state s
    where s.topic = p_topic and s.is_latest and s.human_decision = 'approved';
  get diagnostics k = row_count;
  if k = 0 then raise exception 'no approved findings to seal for %', p_topic using errcode = '22023'; end if;
  update public.weekly_library_versions set sealed = true where id = v;
  return jsonb_build_object('library_version_id', v, 'n', nn, 'findings', k);
end $$;

create or replace function public.hs_weekly_profile_create(p_rules jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); p uuid;
begin
  insert into public.weekly_editorial_profiles (version, rules, created_by)
    values ((select coalesce(max(version), 0) + 1 from public.weekly_editorial_profiles), p_rules, e) returning id into p;
  return p;
end $$;

create or replace function public.hs_weekly_profile_approve(p_profile uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  if not exists (select 1 from public.weekly_editorial_profiles where id = p_profile) then raise exception 'unknown profile' using errcode = '22023'; end if;
  insert into public.weekly_profile_approvals (profile_id, approved_by) values (p_profile, e);
  return true;
end $$;

-- Retrieval is decided HERE, once: every approved lesson of the topic at request time. The run records the list, and
-- the record step refuses a script that claims to include a lesson that was not retrieved.
create or replace function public.hs_weekly_script_request(p_library_version uuid, p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); lv public.weekly_library_versions; r uuid; lessons uuid[]; sent boolean;
begin
  select * into lv from public.weekly_library_versions where id = p_library_version;
  if lv.id is null or not lv.sealed then raise exception 'library version is not sealed' using errcode = '22023'; end if;
  if not exists (select 1 from public.weekly_profile_approvals where profile_id = p_profile) then
    raise exception 'editorial profile is not approved' using errcode = '22023';
  end if;
  if exists (select 1 from public.weekly_runs where kind = 'script' and topic = lv.topic and status in ('queued', 'running')) then
    raise exception 'a script run is already running for this topic' using errcode = '55006';
  end if;
  select coalesce(array_agg(id order by created_at), '{}') into lessons from public.weekly_lesson_state
    where topic = lv.topic and status = 'approved';
  insert into public.weekly_runs (kind, topic, input, requested_by)
    values ('script', lv.topic, jsonb_build_object('library_version_id', lv.id, 'profile_id', p_profile,
                                                   'lessons_retrieved', to_jsonb(lessons)), e)
    returning id into r;
  sent := public._wk_dispatch('weekly-script-run.yml', r);
  if not sent then
    update public.weekly_runs set status = 'failed', error = 'not started: the GitHub dispatch credential is missing', finished_at = now() where id = r;
  end if;
  return jsonb_build_object('run_id', r, 'lessons_retrieved', to_jsonb(lessons), 'dispatched', sent);
end $$;

create or replace function public.hs_weekly_script_approve(p_script uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.weekly_scripts;
begin
  select * into s from public.weekly_scripts where id = p_script;
  if s.id is null then raise exception 'unknown script' using errcode = '22023'; end if;
  insert into public.weekly_script_approvals (script_id, body_sha256, approved_by) values (s.id, s.body_sha256, e);
  return true;
end $$;

create or replace function public.hs_weekly_correction_save(p_script uuid, p_segment integer, p_after text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.weekly_scripts; before text; c uuid;
begin
  select * into s from public.weekly_scripts where id = p_script;
  if s.id is null then raise exception 'unknown script' using errcode = '22023'; end if;
  before := s.body -> 'segments' -> p_segment ->> 'text';
  if before is null then raise exception 'no such segment' using errcode = '22023'; end if;
  insert into public.weekly_corrections (script_id, segment_index, before_text, after_text, note, created_by)
    values (s.id, p_segment, before, p_after, p_note, e) returning id into c;
  return c;
end $$;

create or replace function public.hs_weekly_lesson_propose(p_correction uuid, p_text text, p_test jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); c public.weekly_corrections; l uuid;
begin
  select * into c from public.weekly_corrections where id = p_correction;
  if c.id is null then raise exception 'unknown correction' using errcode = '22023'; end if;
  insert into public.weekly_lessons (topic, text, test, correction_id, example_before, example_after, created_by)
    values ((select topic from public.weekly_scripts where id = c.script_id), p_text, p_test, c.id, c.before_text, c.after_text, e)
    returning id into l;
  return l;
end $$;

create or replace function public.hs_weekly_lesson_decide(p_lesson uuid, p_decision text) returns text
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  if not exists (select 1 from public.weekly_lessons where id = p_lesson) then raise exception 'unknown lesson' using errcode = '22023'; end if;
  insert into public.weekly_lesson_decisions (lesson_id, decision, decided_by) values (p_lesson, p_decision, e);
  return p_decision;
end $$;

create or replace function public.hs_weekly_lesson_use_review(p_use bigint, p_decision text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  if p_decision not in ('confirmed', 'corrected') then raise exception 'decision must be confirmed or corrected' using errcode = '22023'; end if;
  update public.weekly_lesson_uses set reviewer_decision = p_decision, reviewer_note = p_note, reviewed_by = e, reviewed_at = now()
    where id = p_use;
  if not found then raise exception 'unknown lesson use' using errcode = '22023'; end if;
  return p_decision;
end $$;

create or replace function public.hs_weekly_subscription_record(p_provider text, p_plan text, p_monthly_fee_usd numeric,
  p_usage_limits text, p_extra_usage_enabled boolean default false) returns bigint
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); i bigint;
begin
  insert into public.weekly_subscriptions (provider, plan, monthly_fee_usd, usage_limits, extra_usage_enabled, recorded_by)
    values (p_provider, p_plan, p_monthly_fee_usd, p_usage_limits, coalesce(p_extra_usage_enabled, false), e) returning id into i;
  insert into public.weekly_cost_entries (category, cost_type, scope, amount_usd, note)
    values ('other', 'subscription_overhead', 'shared', p_monthly_fee_usd, p_provider || ' ' || p_plan || ' (entered monthly fee)');
  return i;
end $$;

-- Read model for the Tab 20 slice screens.
create or replace function public.hs_weekly_overview(p_topic text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  return jsonb_build_object(
    'topic', p_topic,
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'request_text', request_text, 'created_at', created_at)
                  order by created_at desc), '[]') from public.weekly_research_requests where topic = p_topic),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'status', status, 'error', error, 'created_at', created_at)
              order by created_at desc), '[]') from public.weekly_runs where topic = p_topic),
    'findings', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'finding_key', s.finding_key, 'version', s.version,
        'statement', s.statement, 'qualifiers', s.qualifiers, 'uncertainty', s.uncertainty, 'scope', s.scope, 'kind', s.kind,
        'human_decision', s.human_decision, 'is_latest', s.is_latest,
        'sources', (select coalesce(jsonb_agg(jsonb_build_object('url', w.url, 'publisher', w.publisher, 'title', w.title,
            'quote', w.quote, 'quote_match', w.quote_match, 'date_extraction', w.date_extraction, 'published_date', w.published_date,
            'retrieved_at', w.retrieved_at, 'fetch_error', w.fetch_error, 'publication_permission', w.publication_permission)), '[]')
          from public.weekly_finding_sources fs join public.weekly_sources w on w.id = fs.source_id where fs.finding_id = s.id))
        order by s.finding_key, s.version), '[]') from public.weekly_finding_state s where s.topic = p_topic),
    'library_versions', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'n', v.n, 'sealed', v.sealed,
        'findings', (select count(*) from public.weekly_library_version_findings x where x.library_version_id = v.id)) order by v.n), '[]')
        from public.weekly_library_versions v where v.topic = p_topic),
    'profiles', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version, 'rules', p.rules,
        'approved', exists (select 1 from public.weekly_profile_approvals a where a.profile_id = p.id)) order by p.version), '[]')
        from public.weekly_editorial_profiles p),
    'scripts', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'created_at', s.created_at, 'library_version_id', s.library_version_id,
        'profile_id', s.profile_id, 'provider', s.provider, 'model', s.model, 'body', s.body, 'checks', s.checks,
        'lessons_included', s.lessons_included,
        'approved', exists (select 1 from public.weekly_script_approvals a where a.script_id = s.id and a.body_sha256 = s.body_sha256),
        'lesson_uses', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'lesson_id', u.lesson_id, 'retrieved', u.retrieved,
            'included', u.included, 'assessed', u.assessed, 'assessed_by', u.assessed_by, 'assessment_note', u.assessment_note,
            'reviewer_decision', u.reviewer_decision) order by u.id), '[]') from public.weekly_lesson_uses u where u.script_id = s.id))
        order by s.created_at), '[]') from public.weekly_scripts s where s.topic = p_topic),
    'lessons', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'text', l.text, 'test', l.test, 'status', l.status,
        'example_before', l.example_before, 'example_after', l.example_after) order by l.created_at), '[]')
        from public.weekly_lesson_state l where l.topic = p_topic),
    'corrections', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'script_id', c.script_id, 'segment_index', c.segment_index,
        'before_text', c.before_text, 'after_text', c.after_text, 'note', c.note) order by c.created_at), '[]')
        from public.weekly_corrections c join public.weekly_scripts s on s.id = c.script_id where s.topic = p_topic));
end $$;

-- Export that follows each item's export permission. 'exclude' is left out; 'record_only' keeps the record and link
-- but drops the stored text; only 'include' carries the quote. The raw AI answer is always record-only.
create or replace function public.hs_weekly_export(p_topic text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  return jsonb_build_object(
    'schema', 'weekly-export/1', 'topic', p_topic, 'exported_by', e, 'exported_at', now(),
    'answers', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'provider', a.provider, 'mode', a.mode, 'kind', a.kind,
        'raw_sha256', a.raw_sha256, 'pasted_at', a.pasted_at, 'export', 'record_only')), '[]')
        from public.weekly_research_answers a join public.weekly_research_requests q on q.id = a.request_id
        where q.topic = p_topic and a.export_permission <> 'exclude'),
    'sources', (select coalesce(jsonb_agg(
        jsonb_build_object('id', w.id, 'url', w.url, 'publisher', w.publisher, 'title', w.title, 'kind', w.kind,
          'storage_permission', w.storage_permission, 'publication_permission', w.publication_permission,
          'export_permission', w.export_permission, 'attribution', w.attribution, 'quote_match', w.quote_match,
          'date_extraction', w.date_extraction, 'published_date', w.published_date, 'retrieved_at', w.retrieved_at)
        || case when w.export_permission = 'include' then jsonb_build_object('quote', w.quote, 'content_sha256', w.content_sha256)
                else '{}'::jsonb end), '[]')
        from public.weekly_sources w join public.weekly_research_answers a on a.id = w.answer_id
        join public.weekly_research_requests q on q.id = a.request_id
        where q.topic = p_topic and w.export_permission <> 'exclude'),
    'findings', (select coalesce(jsonb_agg(to_jsonb(s) - 'stream'), '[]') from public.weekly_finding_state s where s.topic = p_topic),
    'library_versions', (select coalesce(jsonb_agg(jsonb_build_object('n', v.n, 'sealed', v.sealed,
        'finding_ids', (select jsonb_agg(x.finding_id) from public.weekly_library_version_findings x where x.library_version_id = v.id))), '[]')
        from public.weekly_library_versions v where v.topic = p_topic),
    'lessons', (select coalesce(jsonb_agg(to_jsonb(l)), '[]') from public.weekly_lesson_state l where l.topic = p_topic));
end $$;

-- ── service functions (the two workflows; service_role only) ──────────────────────────────────────────────────────
create or replace function public.weekly_run_claim(p_run uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.weekly_runs; lv public.weekly_library_versions;
begin
  update public.weekly_runs set status = 'running', started_at = now() where id = p_run and status = 'queued' returning * into r;
  if r.id is null then raise exception 'run is not queued' using errcode = '55000'; end if;
  if r.kind = 'research_ingest' then
    return jsonb_build_object('run', r.id, 'kind', r.kind, 'topic', r.topic,
      'answer', (select jsonb_build_object('id', a.id, 'raw_text', a.raw_text, 'raw_sha256', a.raw_sha256)
                 from public.weekly_research_answers a where a.id = (r.input ->> 'answer_id')::uuid));
  end if;
  select * into lv from public.weekly_library_versions where id = (r.input ->> 'library_version_id')::uuid;
  return jsonb_build_object('run', r.id, 'kind', r.kind, 'topic', r.topic, 'library_version', lv.n,
    'findings', (select coalesce(jsonb_agg(jsonb_build_object('claim_id', f.finding_key || '@' || f.version, 'statement', f.statement,
        'qualifiers', f.qualifiers, 'uncertainty', f.uncertainty, 'scope', f.scope) order by f.finding_key), '[]')
        from public.weekly_library_version_findings x join public.weekly_findings f on f.id = x.finding_id
        where x.library_version_id = lv.id),
    'profile', (select p.rules from public.weekly_editorial_profiles p where p.id = (r.input ->> 'profile_id')::uuid),
    'lessons', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'text', l.text, 'test', l.test,
        'example_before', l.example_before, 'example_after', l.example_after) order by l.created_at), '[]')
        from public.weekly_lessons l where l.id in (select jsonb_array_elements_text(r.input -> 'lessons_retrieved')::uuid)));
end $$;

create or replace function public.weekly_run_fail(p_run uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.weekly_runs set status = 'failed', error = left(p_error, 2000), finished_at = now()
    where id = p_run and status in ('queued', 'running');
end $$;

-- payload: {sources:[{ref,url,final_url,publisher,title,quote,retrieved_at,content_sha256,fetch_error,quote_match,
--            date_extraction,published_date}], findings:[{finding_key,statement,qualifiers,uncertainty,scope,source_refs:[]}],
--           runner_seconds}
create or replace function public.weekly_research_record(p_run uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.weekly_runs; a uuid; s jsonb; f jsonb; ids jsonb := '{}'; sid uuid; fid uuid; prev public.weekly_findings; nf integer := 0;
begin
  select * into r from public.weekly_runs where id = p_run and kind = 'research_ingest' and status = 'running';
  if r.id is null then raise exception 'run is not a running research ingest' using errcode = '55000'; end if;
  a := (r.input ->> 'answer_id')::uuid;
  for s in select * from jsonb_array_elements(coalesce(p_payload -> 'sources', '[]')) loop
    insert into public.weekly_sources (answer_id, url, final_url, publisher, title, quote, retrieved_at, content_sha256, fetch_error,
                                       quote_match, date_extraction, published_date)
      values (a, s ->> 'url', s ->> 'final_url', s ->> 'publisher', s ->> 'title', s ->> 'quote', (s ->> 'retrieved_at')::timestamptz,
              s ->> 'content_sha256', s ->> 'fetch_error', s ->> 'quote_match', s ->> 'date_extraction', (s ->> 'published_date')::date)
      returning id into sid;
    ids := ids || jsonb_build_object(s ->> 'ref', sid);
  end loop;
  for f in select * from jsonb_array_elements(coalesce(p_payload -> 'findings', '[]')) loop
    select * into prev from public.weekly_findings w where w.finding_key = f ->> 'finding_key'
      and not exists (select 1 from public.weekly_findings n where n.supersedes = w.id);
    insert into public.weekly_findings (finding_key, version, supersedes, topic, statement, qualifiers, uncertainty, scope, answer_id)
      values (f ->> 'finding_key', coalesce(prev.version, 0) + 1, prev.id, r.topic, f ->> 'statement',
              coalesce(array(select jsonb_array_elements_text(f -> 'qualifiers')), '{}'), f ->> 'uncertainty', f ->> 'scope', a)
      returning id into fid;
    insert into public.weekly_finding_sources (finding_id, source_id)
      select fid, (ids ->> x)::uuid from jsonb_array_elements_text(coalesce(f -> 'source_refs', '[]')) x where ids ? x;
    nf := nf + 1;
  end loop;
  insert into public.weekly_cost_entries (run_id, category, cost_type, scope, quantity, unit, note)
    values (r.id, 'research', 'no_incremental_api_charge', 'shared', null, null, 'Perplexity answer pasted by a person (plan use)'),
           (r.id, 'research', 'runner_minutes', 'shared', round(coalesce((p_payload ->> 'runner_seconds')::numeric, 0) / 60, 2), 'minutes',
            'parse and fetch sources on a GitHub runner');
  update public.weekly_runs set status = 'done', finished_at = now(),
    result = jsonb_build_object('sources', jsonb_array_length(coalesce(p_payload -> 'sources', '[]')), 'findings', nf) where id = r.id;
  return jsonb_build_object('sources', jsonb_array_length(coalesce(p_payload -> 'sources', '[]')), 'findings', nf);
end $$;

-- payload: {provider, model, prompt_sha256, body:{segments:[...]}, checks:{...}, lessons_included:[uuid],
--           lesson_assessments:[{lesson_id, assessed, assessed_by, note}], runner_seconds}
create or replace function public.weekly_script_record(p_run uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.weekly_runs; sid uuid; retrieved uuid[]; included uuid[]; l uuid; asmt jsonb;
begin
  select * into r from public.weekly_runs where id = p_run and kind = 'script' and status = 'running';
  if r.id is null then raise exception 'run is not a running script run' using errcode = '55000'; end if;
  retrieved := coalesce(array(select jsonb_array_elements_text(r.input -> 'lessons_retrieved')::uuid), '{}');
  included := coalesce(array(select jsonb_array_elements_text(p_payload -> 'lessons_included')::uuid), '{}');
  if not included <@ retrieved then raise exception 'a lesson was included that was not retrieved' using errcode = '22023'; end if;
  insert into public.weekly_scripts (run_id, topic, library_version_id, profile_id, lessons_included, prompt_sha256, provider, model, body, checks)
    values (r.id, r.topic, (r.input ->> 'library_version_id')::uuid, (r.input ->> 'profile_id')::uuid, included,
            p_payload ->> 'prompt_sha256', p_payload ->> 'provider', p_payload ->> 'model', p_payload -> 'body', p_payload -> 'checks')
    returning id into sid;
  foreach l in array retrieved loop
    select x into asmt from jsonb_array_elements(coalesce(p_payload -> 'lesson_assessments', '[]')) x where (x ->> 'lesson_id')::uuid = l limit 1;
    insert into public.weekly_lesson_uses (script_id, lesson_id, retrieved, included, assessed, assessed_by, assessment_note)
      values (sid, l, true, l = any (included), coalesce(asmt ->> 'assessed', 'not_assessed'), coalesce(asmt ->> 'assessed_by', 'none'),
              asmt ->> 'note');
  end loop;
  insert into public.weekly_cost_entries (run_id, category, cost_type, scope, script_id, note)
    values (r.id, 'writing', 'no_incremental_api_charge', 'report', sid, 'Claude on the founder''s plan'),
           (r.id, 'verification', 'no_incremental_api_charge', 'report', sid, 'mechanical checks and the run audit (no AI call)');
  insert into public.weekly_cost_entries (run_id, category, cost_type, scope, script_id, quantity, unit, note)
    values (r.id, 'writing', 'runner_minutes', 'report', sid, round(coalesce((p_payload ->> 'runner_seconds')::numeric, 0) / 60, 2), 'minutes',
            'script, audit and check jobs on GitHub runners');
  update public.weekly_runs set status = 'done', finished_at = now(), result = jsonb_build_object('script_id', sid) where id = r.id;
  return sid;
end $$;

-- ── function grants ───────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['weekly_sha256(text)', 'weekly_append_only()', 'weekly_library_guard()', 'weekly_lesson_use_guard()', '_wk_dispatch(text,uuid)',
    'hs_weekly_request_research(text,text)', 'hs_weekly_paste_answer(uuid,text)', 'hs_weekly_finding_decide(uuid,text,text)',
    'hs_weekly_library_seal(text)', 'hs_weekly_profile_create(jsonb)', 'hs_weekly_profile_approve(uuid)',
    'hs_weekly_script_request(uuid,uuid)', 'hs_weekly_script_approve(uuid)', 'hs_weekly_correction_save(uuid,integer,text,text)',
    'hs_weekly_lesson_propose(uuid,text,jsonb)', 'hs_weekly_lesson_decide(uuid,text)', 'hs_weekly_lesson_use_review(bigint,text,text)',
    'hs_weekly_subscription_record(text,text,numeric,text,boolean)', 'hs_weekly_overview(text)', 'hs_weekly_export(text)',
    'weekly_run_claim(uuid)', 'weekly_run_fail(uuid,text)', 'weekly_research_record(uuid,jsonb)', 'weekly_script_record(uuid,jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['hs_weekly_request_research(text,text)', 'hs_weekly_paste_answer(uuid,text)',
    'hs_weekly_finding_decide(uuid,text,text)', 'hs_weekly_library_seal(text)', 'hs_weekly_profile_create(jsonb)',
    'hs_weekly_profile_approve(uuid)', 'hs_weekly_script_request(uuid,uuid)', 'hs_weekly_script_approve(uuid)',
    'hs_weekly_correction_save(uuid,integer,text,text)', 'hs_weekly_lesson_propose(uuid,text,jsonb)',
    'hs_weekly_lesson_decide(uuid,text)', 'hs_weekly_lesson_use_review(bigint,text,text)',
    'hs_weekly_subscription_record(text,text,numeric,text,boolean)', 'hs_weekly_overview(text)', 'hs_weekly_export(text)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['weekly_run_claim(uuid)', 'weekly_run_fail(uuid,text)', 'weekly_research_record(uuid,jsonb)',
    'weekly_script_record(uuid,jsonb)'] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;

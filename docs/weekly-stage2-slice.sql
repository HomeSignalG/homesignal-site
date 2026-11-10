-- Tab 20 · Weekly Report, STAGE 2 PROOF SLICE (first topic: Air Quality, thumbnail "Air"): DDL of record. PREPARED, NOT APPLIED TO PRODUCTION.
--
-- What this slice proves, end to end, for one topic:
--   1. one research packet (a Perplexity answer pasted by a person, parsed, its sources fetched) is saved here;
--   2. one script is written by Claude (on the founder's plan) from a SEALED library version and an APPROVED profile;
--   3. one correction is saved and approved as a lesson;
--   4. a later script retrieves that lesson, includes it, and its use is assessed and then confirmed by a person.
--   5. EDITORIAL WORKBENCH: three evidence-backed angle cards -> a person selects one -> a beat outline -> a script ->
--      passage-level review (a named rewrite action, keeping its findings and qualifications) -> explicit approval of
--      ONE exact version with the seven-dimension provisional rubric.
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
--   - Every draft (angle set, outline, script) is an immutable VERSION in weekly_scripts (stage angles | outline |
--     script). An approval binds one exact version (its body hash). A new version needs its own approval. A version
--     whose angle set or outline has a newer version, or lost its approval, is OUTDATED and cannot be approved;
--     earlier approvals stay in the history and are never shown as approval of a newer version.
--   - Script approval needs the seven-dimension rubric (0-4 each). PROVISIONAL INTERNAL CRITERIA, not validated
--     performance benchmarks: total >= 21/28, factual discipline = 4, hook, emotional force and coherence each >= 3,
--     no unresolved material factual issue on that exact version, and the reviewer's explicit approval (this call).
--   - Three angle cards may share evidence; a person decides whether they are meaningfully different. Nothing here
--     requires different categories. A high-risk category or high-risk wording needs supporting findings AND an
--     explicit acknowledgement at approval; a category label is never permission to accuse.
--   - TITLES are versions too (stage 'title', written from one script version). Three approvals are kept apart and
--     none implies another: editorial (the wording, one candidate), evidence review (a person, after the mechanical
--     title checks on that exact version) and publication (needs both, on a current script). Changed wording is a new
--     version; a changed script makes the title outdated and it must be checked against the new script (a new
--     version with the same words). Evidence concerns are flags; nothing ever rewrites a title.
--   - Quote status: 'in_packet' or 'not_in_packet' come from the machine and are the only values it can set.
--     'not_found_in_sources_reviewed' and 'contradicted' are reviewer findings (with their reasons / findings). A
--     quote that is not in the packet is never recorded as either of the other two.
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
  kind text not null check (kind in ('research_ingest', 'angles', 'outline', 'script', 'rewrite', 'titles', 'title_check', 'visual_check')),
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
  -- A stored copy of the source document (PDF or saved web page), kept only when its storage permission is full_copy.
  -- A document-evidence cue (a segment's visual) can only point at a source with a stored copy; the checksum is what the
  -- visual_check run compares the downloaded bytes against. Private bucket 'weekly-sources'.
  document_path text check (document_path ~ '^weekly-sources/[A-Za-z0-9/_.-]+\.(pdf|html)$'),
  document_sha256 text check (document_sha256 ~ '^[0-9a-f]{64}$'),
  document_kind text check (document_kind in ('pdf', 'html')),
  created_at timestamptz not null default now(),
  -- An unknown or unstated date has no value; a stated one must have one. Never filled from the fetch date.
  constraint weekly_sources_date_ck check (
    (date_extraction in ('page_metadata', 'page_text') and published_date is not null)
    or (date_extraction in ('not_stated', 'unknown') and published_date is null)),
  -- A page that was never read cannot have matched a quote.
  constraint weekly_sources_unread_ck check (fetch_error is null or (quote_match = 'not_checked' and date_extraction = 'unknown')),
  -- A quote stored only as a link must not carry the quote text.
  constraint weekly_sources_storage_ck check (storage_permission not in ('link_only', 'none') or quote is null),
  -- all three document fields or none, and a full copy only where storage of a full copy is permitted
  constraint weekly_sources_document_ck check (
    ((document_path is null) = (document_sha256 is null) and (document_path is null) = (document_kind is null))
    and (document_path is null or (storage_permission = 'full_copy' and document_path like '%.' || document_kind)))
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
-- scope 'script' (writing rules) or 'title' (title preferences; entries may be {"text", "origin": "inferred" | "user"}).
create table if not exists public.weekly_editorial_profiles (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'script' check (scope in ('script', 'title')),
  version integer not null check (version >= 1),
  rules jsonb not null check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) between 1 and 60),
  unique (scope, version),
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

-- ── editorial versions (angle sets, outlines, scripts), approvals, passage reviews ─────────────────────────────────
-- One row per immutable VERSION. stage says what it is; depends_on names the version it was written from (an outline
-- from an angle set + selected card; a script from an outline); parent_id names the earlier version of the same draft
-- (a rewrite). Every version is written by a run and checked by the engine's mechanical checks.
create table if not exists public.weekly_scripts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid unique references public.weekly_runs (id),
  stage text not null default 'script' check (stage in ('angles', 'outline', 'script', 'title')),
  parent_id uuid references public.weekly_scripts (id),
  depends_on uuid references public.weekly_scripts (id),
  selected_index integer check (selected_index between 0 and 2),
  stream text not null default 'news',
  topic text not null,
  library_version_id uuid not null references public.weekly_library_versions (id),
  profile_id uuid not null references public.weekly_editorial_profiles (id),
  lessons_included uuid[] not null default '{}',
  prompt_sha256 text check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  provider text,
  model text,
  body jsonb not null,
  body_sha256 text generated always as (public.weekly_sha256(body::text)) stored,
  -- Mechanical checks only. They are labelled as such and never certify factual accuracy.
  checks jsonb not null,
  kind text not null default 'ai_draft' check (kind in ('ai_draft', 'human_reviewed')),
  created_at timestamptz not null default now(),
  constraint weekly_scripts_shape_ck check (case stage
    when 'script' then jsonb_typeof(body -> 'segments') = 'array'
    when 'outline' then jsonb_typeof(body -> 'beats') = 'array' and jsonb_array_length(body -> 'beats') between 3 and 12
    when 'angles' then jsonb_typeof(body -> 'angles') = 'array' and jsonb_array_length(body -> 'angles') = 3
    when 'title' then jsonb_typeof(body -> 'candidates') = 'array' and jsonb_array_length(body -> 'candidates') between 1 and 3 end),
  constraint weekly_scripts_lineage_ck check ((stage = 'angles') = (depends_on is null)
    and (stage in ('angles', 'title') or selected_index is not null)),
  -- A person may write a title, or a new script version that changes only its document cues (the lineage guard checks
  -- that); every other version comes from a checked engine run.
  constraint weekly_scripts_origin_ck check ((run_id is null) = (kind = 'human_reviewed') and (run_id is not null or stage in ('title', 'script'))
    and (run_id is null or (prompt_sha256 is not null and provider is not null)))
);
-- A script body with every segment's visual removed: what a person-made cue version must keep word for word.
create or replace function public.weekly_without_visuals(b jsonb) returns jsonb language sql immutable parallel safe as $$
  select case when jsonb_typeof(b -> 'segments') = 'array' then b || jsonb_build_object('segments',
    (select coalesce(jsonb_agg(g - 'visual' order by n), '[]'::jsonb) from jsonb_array_elements(b -> 'segments') with ordinality t(g, n)))
  else b end
$$;

-- depends_on must be the previous stage; a parent is an earlier version of the same draft (same stage, same basis).
create or replace function public.weekly_scripts_lineage_guard() returns trigger language plpgsql as $$
declare d public.weekly_scripts; p public.weekly_scripts;
begin
  if new.depends_on is not null then
    select * into d from public.weekly_scripts where id = new.depends_on;
    if d.stage is distinct from (case new.stage when 'outline' then 'angles' when 'script' then 'outline' when 'title' then 'script' end) then
      raise exception 'a % is written from the previous stage', new.stage using errcode = '22023';
    end if;
  end if;
  if new.parent_id is not null then
    select * into p from public.weekly_scripts where id = new.parent_id;
    if new.stage = 'title' then
      -- a title's new version may be written from a newer version of the same script (the script-fit check)
      if p.stage <> 'title' or (select depends_on from public.weekly_scripts where id = p.depends_on)
                                is distinct from (select depends_on from public.weekly_scripts where id = new.depends_on) then
        raise exception 'a new title version is written from the same script lineage' using errcode = '22023';
      end if;
    elsif p.stage <> new.stage or p.depends_on is distinct from new.depends_on or p.selected_index is distinct from new.selected_index then
      raise exception 'a new version keeps its stage and basis' using errcode = '22023';
    end if;
  end if;
  -- A person-made script version is a new version of an existing script that changes only document cues.
  if new.stage = 'script' and new.run_id is null then
    if p.id is null then raise exception 'a person-made script version is a new version of an existing script' using errcode = '22023'; end if;
    if public.weekly_without_visuals(new.body) is distinct from public.weekly_without_visuals(p.body)
       or new.library_version_id is distinct from p.library_version_id or new.profile_id is distinct from p.profile_id then
      raise exception 'a person changes only the document cues of a script version' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create table if not exists public.weekly_script_approvals (
  id bigserial primary key,
  script_id uuid not null references public.weekly_scripts (id),
  body_sha256 text not null,
  -- editorial: the wording / selection (every stage). evidence: a person cleared a title's evidence after its checks.
  -- publication: a title approved for publication (needs both). None of the three implies another.
  approval_kind text not null default 'editorial' check (approval_kind in ('editorial', 'evidence', 'publication')),
  selected_index integer check (selected_index between 0 and 2),
  -- {hook_conflict, human_stakes, emotional_force, argument_coherence, factual_discipline, spoken_clarity, closing}, 0-4.
  rubric jsonb,
  high_risk_ack boolean not null default false,
  note text,
  approved_by text not null,
  approved_at timestamptz not null default now()
);
-- Passage review. decision:
--   approved | rejected            a person's verdict on the passage as written
--   corrected                      the reviewer's own wording (a lesson source; makes no new version)
--   rewrite                        a named rewrite action; a run writes a NEW version and fills after_text once
--   material_issue                 an unresolved material factual issue on THIS version (blocks its approval)
--   quote_not_found_in_sources     reviewer: the quote is not in the sources reviewed (the reason names them)
--   quote_contradicted             reviewer: evidence contradicts the quote (finding_ids required)
create table if not exists public.weekly_corrections (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references public.weekly_scripts (id),
  segment_index integer not null check (segment_index >= 0),
  decision text not null default 'corrected' check (decision in ('approved', 'rejected', 'corrected', 'rewrite',
    'material_issue', 'quote_not_found_in_sources', 'quote_contradicted')),
  action text check (action in ('conflict_first', 'concrete_stake', 'plain_wording', 'tighten', 'strengthen_contrast',
    'cut_repetition', 'strengthen_closing')),
  reason text,
  finding_ids text[] not null default '{}',
  lesson_scope text not null default 'local' check (lesson_scope in ('local', 'reusable')),
  before_text text not null,
  after_text text check (after_text is null or char_length(after_text) between 1 and 4000),
  result_script_id uuid references public.weekly_scripts (id),
  note text,
  kind text not null default 'human_reviewed' check (kind = 'human_reviewed'),
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint weekly_corrections_action_ck check ((decision = 'rewrite') = (action is not null)),
  constraint weekly_corrections_after_ck check (decision in ('corrected', 'rewrite') or after_text is null),
  constraint weekly_corrections_corrected_ck check (decision <> 'corrected' or after_text is not null),
  constraint weekly_corrections_reason_ck check (decision in ('approved', 'corrected') or char_length(coalesce(reason, '')) >= 3),
  constraint weekly_corrections_contradicted_ck check (decision <> 'quote_contradicted' or cardinality(finding_ids) > 0)
);
-- Corrections are append-only except that a rewrite's result (after_text + result_script_id) is filled once.
create or replace function public.weekly_corrections_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'passage reviews are never deleted' using errcode = '55000'; end if;
  if old.decision <> 'rewrite' or old.result_script_id is not null or new.result_script_id is null or new.after_text is null
     or (to_jsonb(new) - array['after_text', 'result_script_id']) <> (to_jsonb(old) - array['after_text', 'result_script_id']) then
    raise exception 'only a rewrite result can be filled, once' using errcode = '55000';
  end if;
  return new;
end $$;

-- The one status decision for a version. approved = an approval bound to this exact body hash. superseded = a newer
-- version of the same draft exists. outdated = what it was written from has a newer version, lost its approval, is
-- itself outdated, or (for an outline) the selected card is no longer the approved selection.
create or replace function public.weekly_version_status(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.weekly_scripts; d jsonb; approved boolean; superseded boolean; outdated boolean := false; why text;
        sel integer; ever boolean;
begin
  select * into v from public.weekly_scripts where id = p_id;
  if v.id is null then return null; end if;
  approved := exists (select 1 from public.weekly_script_approvals a where a.script_id = v.id and a.body_sha256 = v.body_sha256
                      and a.approval_kind = 'editorial');
  ever := exists (select 1 from public.weekly_script_approvals a where a.script_id = v.id and a.approval_kind = 'editorial');
  superseded := exists (select 1 from public.weekly_scripts c where c.parent_id = v.id);
  if v.depends_on is not null then
    d := public.weekly_version_status(v.depends_on);
    if (d ->> 'superseded')::boolean then outdated := true; why := 'the ' || (d ->> 'stage') || ' it was written from has a newer version';
    elsif not (d ->> 'approved')::boolean and v.stage <> 'title' then outdated := true; why := 'the ' || (d ->> 'stage') || ' it was written from is not approved';
    elsif (d ->> 'outdated')::boolean then outdated := true; why := 'the ' || (d ->> 'stage') || ' it was written from is outdated';
    elsif v.stage = 'outline' then
      select a.selected_index into sel from public.weekly_script_approvals a where a.script_id = v.depends_on
        and a.approval_kind = 'editorial' order by a.approved_at desc, a.id desc limit 1;
      if sel is distinct from v.selected_index then outdated := true; why := 'a different angle card is now selected'; end if;
    end if;
  end if;
  return jsonb_build_object('id', v.id, 'stage', v.stage, 'approved', approved, 'approved_earlier_version', ever and not approved,
    'superseded', superseded, 'outdated', outdated, 'outdated_reason', why,
    'current', approved and not superseded and not outdated)
    || case when v.stage = 'title' then public.weekly_title_review_status(v.id) else '{}'::jsonb end;
end $$;

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
    'weekly_scripts', 'weekly_script_approvals', 'weekly_lessons', 'weekly_lesson_decisions',
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
drop trigger if exists weekly_corrections_guard on public.weekly_corrections;
drop trigger if exists weekly_corrections_append_only on public.weekly_corrections;
create trigger weekly_corrections_guard before update or delete on public.weekly_corrections
  for each row execute function public.weekly_corrections_guard();
drop trigger if exists weekly_scripts_lineage_guard on public.weekly_scripts;
create trigger weekly_scripts_lineage_guard before insert on public.weekly_scripts
  for each row execute function public.weekly_scripts_lineage_guard();

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

drop function if exists public.hs_weekly_profile_create(jsonb);
create or replace function public.hs_weekly_profile_create(p_rules jsonb, p_scope text default 'script') returns uuid
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); p uuid;
begin
  insert into public.weekly_editorial_profiles (scope, version, rules, created_by)
    values (coalesce(p_scope, 'script'), (select coalesce(max(version), 0) + 1 from public.weekly_editorial_profiles
             where scope = coalesce(p_scope, 'script')), p_rules, e) returning id into p;
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

drop function if exists public.hs_weekly_script_request(uuid, uuid);
drop function if exists public.hs_weekly_script_approve(uuid);
drop function if exists public.hs_weekly_correction_save(uuid, integer, text, text);

-- ── titles ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- The mechanical title checks of a version: its own run's checks, else the newest title_check run done on this exact
-- body hash. NULL means not checked yet.
create or replace function public.weekly_title_checks(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select v.checks from public.weekly_scripts v where v.id = p_id and v.run_id is not null and v.checks ? 'ok'),
    (select r.result -> 'checks' from public.weekly_runs r join public.weekly_scripts v on v.id = p_id
      where r.kind = 'title_check' and r.status = 'done' and r.input ->> 'version_id' = p_id::text
        and r.result ->> 'body_sha256' = v.body_sha256 order by r.finished_at desc limit 1))
$$;

-- Evidence review and publication, kept apart from the editorial approval.
create or replace function public.weekly_title_review_status(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.weekly_scripts; c jsonb; sel integer; ev text; pub boolean; sc jsonb;
begin
  select * into v from public.weekly_scripts where id = p_id and stage = 'title';
  if v.id is null then return '{}'::jsonb; end if;
  c := public.weekly_title_checks(v.id);
  select a.selected_index into sel from public.weekly_script_approvals a where a.script_id = v.id and a.body_sha256 = v.body_sha256
    and a.approval_kind = 'editorial' order by a.approved_at desc, a.id desc limit 1;
  ev := case
    when exists (select 1 from public.weekly_script_approvals a where a.script_id = v.id and a.body_sha256 = v.body_sha256
                 and a.approval_kind = 'evidence') then 'cleared'
    when exists (select 1 from public.weekly_corrections x where x.script_id = v.id and x.decision = 'material_issue') then 'concerns_open'
    when c is null then 'not_checked'
    when coalesce((c ->> 'ok')::boolean, false) is not true then 'checks_failed'
    when coalesce((c ->> 'needs_research')::boolean, false) then 'needs_research'
    else 'ready_for_review' end;
  pub := exists (select 1 from public.weekly_script_approvals a where a.script_id = v.id and a.body_sha256 = v.body_sha256
                 and a.approval_kind = 'publication');
  select jsonb_build_object('approved', exists (select 1 from public.weekly_script_approvals a join public.weekly_scripts d on d.id = a.script_id
            where d.id = v.depends_on and a.body_sha256 = d.body_sha256 and a.approval_kind = 'editorial'),
          'superseded', exists (select 1 from public.weekly_scripts n where n.parent_id = v.depends_on)) into sc;
  return jsonb_build_object('selected_index', sel, 'selected_title', v.body -> 'candidates' -> sel ->> 'title',
    'evidence_review', ev, 'title_checks', c, 'publication', case when pub then 'approved' else 'not_approved' end,
    'script', sc);
end $$;

-- A person proposes title wording (no run). The mechanical title checks run afterwards on this exact version.
-- p_parent: a new version of an earlier title (changed words, or the same words checked against a newer script).
create or replace function public.hs_weekly_title_propose(p_script uuid, p_candidates jsonb, p_profile uuid, p_parent uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); sc public.weekly_scripts; t uuid; c jsonb; bad text[]; q jsonb;
begin
  select * into sc from public.weekly_scripts where id = p_script and stage = 'script';
  if sc.id is null then raise exception 'unknown script' using errcode = '22023'; end if;
  if not exists (select 1 from public.weekly_editorial_profiles where id = p_profile and scope = 'title') then
    raise exception 'unknown title profile' using errcode = '22023';
  end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) not between 1 and 3 then
    raise exception 'one to three title candidates' using errcode = '22023';
  end if;
  for c in select * from jsonb_array_elements(p_candidates) loop
    if char_length(btrim(coalesce(c ->> 'title', ''))) not between 1 and 200 then raise exception 'a title is 1 to 200 characters' using errcode = '22023'; end if;
  end loop;
  select coalesce(array_agg(distinct x), '{}') into bad from (select jsonb_array_elements_text(coalesce(c2 -> 'input' -> 'supporting_claim_ids', '[]')) x
    from jsonb_array_elements(p_candidates) c2) t where x <> all (public.weekly_library_claim_ids(sc.library_version_id));
  if cardinality(bad) > 0 then raise exception 'not in the pinned library: %', array_to_string(bad, ', ') using errcode = '22023'; end if;
  if p_parent is not null and (public.weekly_version_status(p_parent) ->> 'superseded')::boolean then
    raise exception 'that title already has a newer version' using errcode = '22023';
  end if;
  insert into public.weekly_scripts (stage, parent_id, depends_on, topic, library_version_id, profile_id, body, checks, kind)
    values ('title', p_parent, sc.id, sc.topic, sc.library_version_id, p_profile, jsonb_build_object('candidates', p_candidates, 'origin', 'person'),
            jsonb_build_object('label', 'title checks not run yet', 'certifies_accuracy', false), 'human_reviewed')
    returning id into t;
  q := public._wk_queue('title_check', sc.topic, jsonb_build_object('version_id', t), e);
  return jsonb_build_object('title_version', t) || q;
end $$;

-- The same words, checked against a newer script version (a new title version that needs its own approvals).
create or replace function public.hs_weekly_title_refit(p_title uuid, p_script uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.weekly_scripts;
begin
  select * into v from public.weekly_scripts where id = p_title and stage = 'title';
  if v.id is null then raise exception 'unknown title' using errcode = '22023'; end if;
  return public.hs_weekly_title_propose(p_script, v.body -> 'candidates', v.profile_id, v.id);
end $$;

-- Three generated candidates from the selected angle, the pinned research and the title profile (a Claude run).
create or replace function public.hs_weekly_titles_request(p_script uuid, p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); sc public.weekly_scripts;
begin
  select * into sc from public.weekly_scripts where id = p_script and stage = 'script';
  if sc.id is null then raise exception 'unknown script' using errcode = '22023'; end if;
  if not exists (select 1 from public.weekly_editorial_profiles p join public.weekly_profile_approvals a on a.profile_id = p.id
                 where p.id = p_profile and p.scope = 'title') then
    raise exception 'the title profile is not approved' using errcode = '22023';
  end if;
  return public._wk_queue('titles', sc.topic, jsonb_build_object('library_version_id', sc.library_version_id, 'profile_id', p_profile,
    'depends_on', sc.id), e);
end $$;

-- Editorial decision on one candidate. 'approved' approves the WORDING of this exact version only; it never clears
-- evidence or approves publication. 'rejected' is kept in the candidate history with its reason.
create or replace function public.hs_weekly_title_decide(p_version uuid, p_index integer, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v public.weekly_scripts; st jsonb; t text;
begin
  select * into v from public.weekly_scripts where id = p_version and stage = 'title';
  if v.id is null then raise exception 'unknown title' using errcode = '22023'; end if;
  t := v.body -> 'candidates' -> p_index ->> 'title';
  if t is null then raise exception 'no such candidate' using errcode = '22023'; end if;
  st := public.weekly_version_status(v.id);
  if p_decision = 'approved' then
    if (st ->> 'superseded')::boolean then raise exception 'a newer version exists; review that one' using errcode = '22023'; end if;
    if (st ->> 'outdated')::boolean then raise exception 'outdated: %; check the title against the new script', st ->> 'outdated_reason' using errcode = '22023'; end if;
    insert into public.weekly_script_approvals (script_id, body_sha256, approval_kind, selected_index, note, approved_by)
      values (v.id, v.body_sha256, 'editorial', p_index, p_reason, e);
  elsif p_decision = 'rejected' then
    insert into public.weekly_corrections (script_id, segment_index, decision, reason, before_text, created_by)
      values (v.id, p_index, 'rejected', p_reason, t, e);
  else
    raise exception 'decision must be approved or rejected' using errcode = '22023';
  end if;
  return public.weekly_version_status(v.id);
end $$;

-- Evidence review of the editorially approved candidate. 'cleared' needs passing title checks on this exact version,
-- no research gap, no open concern, and an acknowledgement when the checks raised flags. 'concerns' records a flag.
-- Neither one ever changes the title.
create or replace function public.hs_weekly_title_evidence_review(p_version uuid, p_decision text, p_reason text default null,
  p_flags_ack boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v public.weekly_scripts; st jsonb; c jsonb;
begin
  select * into v from public.weekly_scripts where id = p_version and stage = 'title';
  if v.id is null then raise exception 'unknown title' using errcode = '22023'; end if;
  st := public.weekly_version_status(v.id);
  if (st ->> 'selected_index') is null then raise exception 'approve the wording of one candidate first' using errcode = '22023'; end if;
  if p_decision = 'concerns' then
    insert into public.weekly_corrections (script_id, segment_index, decision, reason, before_text, created_by)
      values (v.id, (st ->> 'selected_index')::integer, 'material_issue', p_reason, st ->> 'selected_title', e);
    return public.weekly_version_status(v.id);
  end if;
  if p_decision <> 'cleared' then raise exception 'decision must be cleared or concerns' using errcode = '22023'; end if;
  if st ->> 'evidence_review' <> 'ready_for_review' then
    raise exception 'evidence cannot be cleared: %', st ->> 'evidence_review' using errcode = '22023';
  end if;
  c := st -> 'title_checks';
  if jsonb_array_length(coalesce(c -> 'candidates' -> (st ->> 'selected_index')::integer -> 'flags', '[]')) > 0 and not coalesce(p_flags_ack, false) then
    raise exception 'the title checks raised flags; acknowledge them to clear' using errcode = '22023';
  end if;
  insert into public.weekly_script_approvals (script_id, body_sha256, approval_kind, selected_index, high_risk_ack, note, approved_by)
    values (v.id, v.body_sha256, 'evidence', (st ->> 'selected_index')::integer, coalesce(p_flags_ack, false), p_reason, e);
  return public.weekly_version_status(v.id);
end $$;

-- Publication approval of a title. Needs the editorial approval and the evidence clearance of this exact version,
-- written from the current approved script. Nothing here publishes.
create or replace function public.hs_weekly_title_publication_approve(p_version uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v public.weekly_scripts; st jsonb;
begin
  select * into v from public.weekly_scripts where id = p_version and stage = 'title';
  if v.id is null then raise exception 'unknown title' using errcode = '22023'; end if;
  st := public.weekly_version_status(v.id);
  if not (st ->> 'current')::boolean then raise exception 'the title wording is not the current approved version' using errcode = '22023'; end if;
  if st ->> 'evidence_review' <> 'cleared' then raise exception 'the evidence review is not cleared' using errcode = '22023'; end if;
  if not (public.weekly_version_status(v.depends_on) ->> 'current')::boolean then
    raise exception 'the script it was written from is not the current approved version' using errcode = '22023';
  end if;
  insert into public.weekly_script_approvals (script_id, body_sha256, approval_kind, selected_index, note, approved_by)
    values (v.id, v.body_sha256, 'publication', (st ->> 'selected_index')::integer, p_note, e);
  return public.weekly_version_status(v.id);
end $$;

-- Claim ids ("key@version") of the findings pinned in a library version.
-- ── document-evidence cues (a segment's visual) ──────────────────────────────────────────────────────────────────
-- A cue says: while this segment is spoken, show this page of this stored source with these words highlighted in yellow.
-- It is resolved by homesignal-ingest weekly_slice/doc_cue.py with Tab 16's own document code (video/pdf_tools.find_quote,
-- video/build.stage_assets, video/build.visual -> the DocScene props). A cue is chosen by a person (hs_weekly_doc_cue_set);
-- a segment that only cites a document gets no document visual. An unresolved cue blocks approval; nothing is substituted.
create or replace function public.weekly_cue_count(b jsonb) returns integer language sql immutable parallel safe as $$
  select count(*)::integer from jsonb_array_elements(case when jsonb_typeof(b -> 'segments') = 'array' then b -> 'segments' else '[]'::jsonb end) g
  where jsonb_typeof(g -> 'visual') = 'object'
$$;

-- The document cue checks of a version: the newest visual_check run done on this exact text.
create or replace function public.weekly_visual_checks(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select r.result -> 'checks' from public.weekly_runs r join public.weekly_scripts v on v.id = p_id
   where r.kind = 'visual_check' and r.status = 'done' and r.input ->> 'version_id' = p_id::text
     and r.result ->> 'body_sha256' = v.body_sha256 order by r.finished_at desc limit 1
$$;

-- A person sets (or, with p_cue null, removes) one segment's document cue. The result is a NEW script version that differs
-- from p_script only in that cue (the lineage guard enforces it); it needs its own approval, and a visual_check run
-- resolves its cues against the stored documents.
create or replace function public.hs_weekly_doc_cue_set(p_script uuid, p_segment integer, p_cue jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v public.weekly_scripts; st jsonb; g jsonb; b jsonb; nv uuid; q jsonb := '{}';
        cid text; src public.weekly_sources;
begin
  select * into v from public.weekly_scripts where id = p_script and stage = 'script';
  if v.id is null then raise exception 'unknown script' using errcode = '22023'; end if;
  st := public.weekly_version_status(v.id);
  if (st ->> 'superseded')::boolean then raise exception 'a newer version exists; set the cue on that one' using errcode = '22023'; end if;
  if (st ->> 'outdated')::boolean then raise exception 'this script is outdated' using errcode = '22023'; end if;
  g := v.body -> 'segments' -> p_segment;
  if g is null then raise exception 'no such segment' using errcode = '22023'; end if;
  if p_cue is not null and jsonb_typeof(p_cue) <> 'null' then
    if jsonb_typeof(p_cue) <> 'object' or exists (select 1 from jsonb_object_keys(p_cue) k
         where k not in ('type', 'claim_id', 'source_id', 'page', 'quote', 'highlight')) then
      raise exception 'a cue has type, claim_id, source_id, page, quote and highlight only' using errcode = '22023';
    end if;
    if p_cue ->> 'type' is distinct from 'doc' then raise exception 'a document cue has type doc' using errcode = '22023'; end if;
    if p_cue ->> 'highlight' is distinct from 'yellow' then raise exception 'the highlight is yellow' using errcode = '22023'; end if;
    if char_length(btrim(coalesce(p_cue ->> 'quote', ''))) not between 1 and 1000 then
      raise exception 'the words to highlight are 1 to 1000 characters' using errcode = '22023';
    end if;
    if jsonb_typeof(p_cue -> 'page') not in ('null', 'number') or (jsonb_typeof(p_cue -> 'page') = 'number'
         and ((p_cue ->> 'page')::numeric <> trunc((p_cue ->> 'page')::numeric) or (p_cue ->> 'page')::numeric < 1)) then
      raise exception 'the page is a page number (1 or more) or empty' using errcode = '22023';
    end if;
    cid := p_cue ->> 'claim_id';
    if not (g -> 'claim_ids') ? cid then raise exception 'the segment does not cite %', cid using errcode = '22023'; end if;
    select w.* into src from public.weekly_sources w
      join public.weekly_finding_sources fs on fs.source_id = w.id
      join public.weekly_findings f on f.id = fs.finding_id
      join public.weekly_library_version_findings x on x.finding_id = f.id and x.library_version_id = v.library_version_id
     where w.id::text = p_cue ->> 'source_id' and f.finding_key || '@' || f.version = cid;
    if src.id is null then raise exception 'that source is not a source of % in this library', cid using errcode = '22023'; end if;
    if src.document_path is null then
      raise exception 'no stored copy of that source (only an excerpt or a link is kept)' using errcode = '22023';
    end if;
    if src.document_kind = 'html' and jsonb_typeof(p_cue -> 'page') = 'number' then
      raise exception 'a saved web page has no page numbers' using errcode = '22023';
    end if;
    b := jsonb_set(v.body, array['segments', p_segment::text, 'visual'],
                   jsonb_build_object('type', 'doc', 'claim_id', cid, 'source_id', src.id, 'page', p_cue -> 'page',
                                      'quote', btrim(p_cue ->> 'quote'), 'highlight', 'yellow'));
  else
    b := jsonb_set(v.body, array['segments', p_segment::text, 'visual'], 'null'::jsonb);
  end if;
  -- a segment with no visual key and one with visual null both have no cue
  if coalesce(b -> 'segments' -> p_segment -> 'visual', 'null'::jsonb) = coalesce(g -> 'visual', 'null'::jsonb) then
    raise exception 'the cue is unchanged' using errcode = '22023';
  end if;
  insert into public.weekly_scripts (stage, parent_id, depends_on, selected_index, topic, library_version_id, profile_id,
                                     lessons_included, body, checks, kind)
    values ('script', v.id, v.depends_on, v.selected_index, v.topic, v.library_version_id, v.profile_id, v.lessons_included,
            b, v.checks || jsonb_build_object('text_checks_from', v.id), 'human_reviewed')
    returning id into nv;
  if public.weekly_cue_count(b) > 0 then
    q := public._wk_queue('visual_check', v.topic, jsonb_build_object('version_id', nv), e);
  end if;
  return jsonb_build_object('script_version', nv) || q;
end $$;

-- The document cue checks of one script version (visual_check run, no AI step). Recorded against the body hash.
create or replace function public.weekly_visual_check_record(p_run uuid, p_body_sha256 text, p_checks jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.weekly_runs;
begin
  select * into r from public.weekly_runs where id = p_run and kind = 'visual_check' and status = 'running';
  if r.id is null then raise exception 'run is not a running visual check' using errcode = '55000'; end if;
  if p_body_sha256 is distinct from (select body_sha256 from public.weekly_scripts where id = (r.input ->> 'version_id')::uuid) then
    raise exception 'the checks were made on a different text' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_checks -> 'ok'), '') <> 'boolean' or coalesce(jsonb_typeof(p_checks -> 'segments'), '') <> 'array' then
    raise exception 'document cue checks have ok and segments' using errcode = '22023';
  end if;
  insert into public.weekly_cost_entries (run_id, category, cost_type, scope, note)
    values (r.id, 'verification', 'runner_minutes', 'report', 'document cue checks on a GitHub runner (no AI call)');
  update public.weekly_runs set status = 'done', finished_at = now(),
    result = jsonb_build_object('body_sha256', p_body_sha256, 'checks', p_checks) where id = r.id;
end $$;

create or replace function public.weekly_library_claim_ids(p_lv uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(f.finding_key || '@' || f.version), '{}') from public.weekly_library_version_findings x
    join public.weekly_findings f on f.id = x.finding_id where x.library_version_id = p_lv
$$;

-- The rubric gate. PROVISIONAL INTERNAL CRITERIA, not validated performance benchmarks. Returns every problem.
create or replace function public.weekly_rubric_problems(p_rubric jsonb) returns text[]
language plpgsql immutable as $$
declare k text; v jsonb; total integer := 0; probs text[] := '{}';
  dims text[] := array['hook_conflict', 'human_stakes', 'emotional_force', 'argument_coherence', 'factual_discipline',
                       'spoken_clarity', 'closing'];
begin
  if p_rubric is null or jsonb_typeof(p_rubric) <> 'object' then return array['the rubric is missing']; end if;
  foreach k in array dims loop
    v := p_rubric -> k;
    if v is null or jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not in (0, 1, 2, 3, 4) then
      probs := probs || (k || ' must be a whole score from 0 to 4');
    else total := total + (v #>> '{}')::integer; end if;
  end loop;
  if exists (select 1 from jsonb_object_keys(p_rubric) x where x <> all (dims)) then probs := probs || 'the rubric has an unknown dimension'::text; end if;
  if cardinality(probs) > 0 then return probs; end if;
  if total < 21 then probs := probs || ('total ' || total || '/28 is below 21'); end if;
  if (p_rubric ->> 'factual_discipline')::integer <> 4 then probs := probs || 'factual discipline must be 4'::text; end if;
  foreach k in array array['hook_conflict', 'emotional_force', 'argument_coherence'] loop
    if (p_rubric ->> k)::integer < 3 then probs := probs || (k || ' must be at least 3'); end if;
  end loop;
  return probs;
end $$;

-- Queue one engine run (angles / outline / script / rewrite) and dispatch it.
create or replace function public._wk_queue(p_kind text, p_topic text, p_input jsonb, p_by text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r uuid; sent boolean;
begin
  if p_kind in ('angles', 'outline', 'script', 'rewrite', 'titles') and exists (select 1 from public.weekly_runs
             where kind in ('angles', 'outline', 'script', 'rewrite', 'titles') and topic = p_topic and status in ('queued', 'running')) then
    raise exception 'a writing run is already running for this topic' using errcode = '55006';
  end if;
  insert into public.weekly_runs (kind, topic, input, requested_by) values (p_kind, p_topic, p_input, p_by) returning id into r;
  sent := public._wk_dispatch('weekly-script-run.yml', r);
  if not sent then
    update public.weekly_runs set status = 'failed', error = 'not started: the GitHub dispatch credential is missing', finished_at = now() where id = r;
  end if;
  return jsonb_build_object('run_id', r, 'dispatched', sent);
end $$;

-- Step 1: three angle cards from a sealed library version and an approved profile.
-- p_parent: ask for a NEW VERSION of an existing angle set (the old one becomes superseded; drafts written from it
-- become outdated).
create or replace function public.hs_weekly_angles_request(p_library_version uuid, p_profile uuid, p_parent uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); lv public.weekly_library_versions;
begin
  if p_parent is not null and not exists (select 1 from public.weekly_scripts where id = p_parent and stage = 'angles') then
    raise exception 'unknown angle set' using errcode = '22023';
  end if;
  select * into lv from public.weekly_library_versions where id = p_library_version;
  if lv.id is null or not lv.sealed then raise exception 'library version is not sealed' using errcode = '22023'; end if;
  if not exists (select 1 from public.weekly_profile_approvals where profile_id = p_profile) then
    raise exception 'editorial profile is not approved' using errcode = '22023';
  end if;
  return public._wk_queue('angles', lv.topic, jsonb_build_object('library_version_id', lv.id, 'profile_id', p_profile,
    'parent_id', p_parent), e);
end $$;

-- Step 2: an outline from the CURRENT approved angle set and its selected card.
create or replace function public.hs_weekly_outline_request(p_angles uuid, p_parent uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v public.weekly_scripts; st jsonb; sel integer;
begin
  if p_parent is not null and not exists (select 1 from public.weekly_scripts where id = p_parent and stage = 'outline'
                                          and depends_on = p_angles) then
    raise exception 'the earlier outline was not written from this angle set' using errcode = '22023';
  end if;
  select * into v from public.weekly_scripts where id = p_angles and stage = 'angles';
  if v.id is null then raise exception 'unknown angle set' using errcode = '22023'; end if;
  st := public.weekly_version_status(v.id);
  if not (st ->> 'current')::boolean then raise exception 'the angle set is not the current approved version' using errcode = '22023'; end if;
  select a.selected_index into sel from public.weekly_script_approvals a where a.script_id = v.id and a.body_sha256 = v.body_sha256
    and a.approval_kind = 'editorial'
    order by a.approved_at desc, a.id desc limit 1;
  return public._wk_queue('outline', v.topic, jsonb_build_object('library_version_id', v.library_version_id, 'profile_id', v.profile_id,
    'depends_on', v.id, 'selected_index', sel, 'parent_id', p_parent), e);
end $$;

-- Step 3: a script from the CURRENT approved outline. Retrieval is decided HERE, once: every approved lesson of the
-- topic at request time. The record step refuses a script that claims to include a lesson that was not retrieved.
create or replace function public.hs_weekly_script_request(p_outline uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v public.weekly_scripts; lessons uuid[]; q jsonb;
begin
  select * into v from public.weekly_scripts where id = p_outline and stage = 'outline';
  if v.id is null then raise exception 'unknown outline' using errcode = '22023'; end if;
  if not (public.weekly_version_status(v.id) ->> 'current')::boolean then
    raise exception 'the outline is not the current approved version' using errcode = '22023';
  end if;
  select coalesce(array_agg(id order by created_at), '{}') into lessons from public.weekly_lesson_state
    where topic = v.topic and status = 'approved';
  q := public._wk_queue('script', v.topic, jsonb_build_object('library_version_id', v.library_version_id, 'profile_id', v.profile_id,
    'depends_on', v.id, 'selected_index', v.selected_index, 'lessons_retrieved', to_jsonb(lessons)), e);
  return q || jsonb_build_object('lessons_retrieved', to_jsonb(lessons));
end $$;

-- Approve ONE exact version. angles: a selected card (and an acknowledgement when it is a high-risk category).
-- outline: passing mechanical checks. script: the seven-dimension rubric gate, no unresolved material factual issue on
-- this version, and an acknowledgement when the checks found high-risk wording.
create or replace function public.hs_weekly_version_approve(p_version uuid, p_selected integer default null,
  p_rubric jsonb default null, p_high_risk_ack boolean default false, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v public.weekly_scripts; st jsonb; card jsonb; probs text[];
begin
  select * into v from public.weekly_scripts where id = p_version;
  if v.id is null then raise exception 'unknown version' using errcode = '22023'; end if;
  if v.stage = 'title' then raise exception 'titles are decided with hs_weekly_title_decide' using errcode = '22023'; end if;
  st := public.weekly_version_status(v.id);
  if (st ->> 'superseded')::boolean then raise exception 'a newer version exists; review that one' using errcode = '22023'; end if;
  if (st ->> 'outdated')::boolean then raise exception 'outdated: %', st ->> 'outdated_reason' using errcode = '22023'; end if;
  if coalesce((v.checks ->> 'ok')::boolean, false) is not true then
    raise exception 'the mechanical checks did not pass on this version' using errcode = '22023';
  end if;
  if v.stage = 'angles' then
    if p_selected is null or p_selected not between 0 and 2 then raise exception 'select one of the three angle cards' using errcode = '22023'; end if;
    card := v.body -> 'angles' -> p_selected;
    if card ->> 'category' in ('false_claim', 'knowing_deception', 'improper_influence') and not coalesce(p_high_risk_ack, false) then
      raise exception 'a high-risk angle needs an explicit acknowledgement that its findings support it' using errcode = '22023';
    end if;
    p_rubric := null;
  elsif v.stage = 'outline' then
    p_selected := null; p_rubric := null;
  else
    p_selected := null;
    probs := public.weekly_rubric_problems(p_rubric);
    if cardinality(probs) > 0 then raise exception 'rubric gate: %', array_to_string(probs, '; ') using errcode = '22023'; end if;
    if jsonb_array_length(coalesce(v.checks -> 'material_issues', '[]')) > 0 then
      raise exception 'unresolved material factual issue found by the checks' using errcode = '22023';
    end if;
    if exists (select 1 from public.weekly_corrections c where c.script_id = v.id
               and c.decision in ('material_issue', 'quote_not_found_in_sources', 'quote_contradicted')) then
      raise exception 'unresolved material factual issue recorded on this version' using errcode = '22023';
    end if;
    if jsonb_array_length(coalesce(v.checks -> 'high_risk', '[]')) > 0 and not coalesce(p_high_risk_ack, false) then
      raise exception 'high-risk wording needs an explicit acknowledgement' using errcode = '22023';
    end if;
    if public.weekly_cue_count(v.body) > 0
       and coalesce((public.weekly_visual_checks(v.id) ->> 'ok')::boolean, false) is not true then
      raise exception 'a document cue on this version is not resolved (checked against the stored document)' using errcode = '22023';
    end if;
  end if;
  insert into public.weekly_script_approvals (script_id, body_sha256, selected_index, rubric, high_risk_ack, note, approved_by)
    values (v.id, v.body_sha256, p_selected, p_rubric, coalesce(p_high_risk_ack, false), p_note, e);
  return public.weekly_version_status(v.id);
end $$;

-- A passage review. A 'rewrite' names one action and queues a run that writes a new version of the script; the
-- original version is unchanged, and the review keeps the before text, reason, findings and lesson scope.
create or replace function public.hs_weekly_passage_review(p_script uuid, p_segment integer, p_decision text,
  p_reason text default null, p_action text default null, p_finding_ids text[] default '{}', p_lesson_scope text default 'local',
  p_after text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v public.weekly_scripts; before text; c uuid; q jsonb := '{}'; bad text[];
begin
  select * into v from public.weekly_scripts where id = p_script and stage = 'script';
  if v.id is null then raise exception 'unknown script' using errcode = '22023'; end if;
  before := v.body -> 'segments' -> p_segment ->> 'text';
  if before is null then raise exception 'no such segment' using errcode = '22023'; end if;
  select coalesce(array_agg(x), '{}') into bad from unnest(coalesce(p_finding_ids, '{}')) x
    where x <> all (public.weekly_library_claim_ids(v.library_version_id));
  if cardinality(bad) > 0 then raise exception 'not in the pinned library: %', array_to_string(bad, ', ') using errcode = '22023'; end if;
  if p_decision = 'rewrite' then
    if (public.weekly_version_status(v.id) ->> 'superseded')::boolean then
      raise exception 'a newer version exists; review that one' using errcode = '22023';
    end if;
    if (public.weekly_version_status(v.id) ->> 'outdated')::boolean then
      raise exception 'this script is outdated' using errcode = '22023';
    end if;
  end if;
  insert into public.weekly_corrections (script_id, segment_index, decision, action, reason, finding_ids, lesson_scope,
                                         before_text, after_text, created_by)
    values (v.id, p_segment, p_decision, p_action, p_reason, coalesce(p_finding_ids, '{}'), coalesce(p_lesson_scope, 'local'),
            before, case when p_decision = 'corrected' then p_after end, e) returning id into c;
  if p_decision = 'rewrite' then
    q := public._wk_queue('rewrite', v.topic, jsonb_build_object('library_version_id', v.library_version_id, 'profile_id', v.profile_id,
      'parent_id', v.id, 'depends_on', v.depends_on, 'selected_index', v.selected_index, 'review_id', c,
      'segment_index', p_segment, 'action', p_action, 'reason', p_reason, 'finding_ids', to_jsonb(coalesce(p_finding_ids, '{}')),
      'lessons_retrieved', to_jsonb(v.lessons_included)), e);
  end if;
  return jsonb_build_object('review_id', c) || q;
end $$;

-- The reviewer's own wording for a passage (a lesson source). Kept for the Stage 2 lesson loop.
create or replace function public.hs_weekly_correction_save(p_script uuid, p_segment integer, p_after text, p_note text default null,
  p_lesson_scope text default 'local') returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return (public.hs_weekly_passage_review(p_script, p_segment, 'corrected', p_note, null, '{}', p_lesson_scope, p_after) ->> 'review_id')::uuid;
end $$;

-- A lesson comes only from a review a person marked REUSABLE, with a before and an after.
create or replace function public.hs_weekly_lesson_propose(p_correction uuid, p_text text, p_test jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); c public.weekly_corrections; l uuid;
begin
  select * into c from public.weekly_corrections where id = p_correction;
  if c.id is null then raise exception 'unknown correction' using errcode = '22023'; end if;
  if c.lesson_scope <> 'reusable' then raise exception 'this review was marked local to this script' using errcode = '22023'; end if;
  if c.after_text is null then raise exception 'a lesson needs a before and an after' using errcode = '22023'; end if;
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
        'sources', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'document_kind', w.document_kind,
            'url', w.url, 'publisher', w.publisher, 'title', w.title,
            'quote', w.quote, 'quote_match', w.quote_match, 'date_extraction', w.date_extraction, 'published_date', w.published_date,
            'retrieved_at', w.retrieved_at, 'fetch_error', w.fetch_error, 'publication_permission', w.publication_permission)), '[]')
          from public.weekly_finding_sources fs join public.weekly_sources w on w.id = fs.source_id where fs.finding_id = s.id))
        order by s.finding_key, s.version), '[]') from public.weekly_finding_state s where s.topic = p_topic),
    'library_versions', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'n', v.n, 'sealed', v.sealed,
        'findings', (select count(*) from public.weekly_library_version_findings x where x.library_version_id = v.id)) order by v.n), '[]')
        from public.weekly_library_versions v where v.topic = p_topic),
    'profiles', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'scope', p.scope, 'version', p.version, 'rules', p.rules,
        'approved', exists (select 1 from public.weekly_profile_approvals a where a.profile_id = p.id)) order by p.version), '[]')
        from public.weekly_editorial_profiles p),
    'versions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'stage', s.stage, 'created_at', s.created_at,
        'parent_id', s.parent_id, 'depends_on', s.depends_on, 'selected_index', s.selected_index,
        'library_version_id', s.library_version_id, 'profile_id', s.profile_id, 'provider', s.provider, 'model', s.model,
        'body', s.body, 'body_sha256', s.body_sha256, 'checks', s.checks, 'lessons_included', s.lessons_included,
        'status', public.weekly_version_status(s.id), 'kind', s.kind,
        'cues', public.weekly_cue_count(s.body), 'visual_checks', case when s.stage = 'script' then public.weekly_visual_checks(s.id) end,
        'approvals', (select coalesce(jsonb_agg(jsonb_build_object('kind', a.approval_kind, 'approved_by', a.approved_by, 'approved_at', a.approved_at,
            'body_sha256', a.body_sha256, 'this_version', a.body_sha256 = s.body_sha256, 'selected_index', a.selected_index,
            'rubric', a.rubric, 'high_risk_ack', a.high_risk_ack, 'note', a.note) order by a.approved_at), '[]')
            from public.weekly_script_approvals a where a.script_id = s.id),
        'lesson_uses', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'lesson_id', u.lesson_id, 'retrieved', u.retrieved,
            'included', u.included, 'assessed', u.assessed, 'assessed_by', u.assessed_by, 'assessment_note', u.assessment_note,
            'reviewer_decision', u.reviewer_decision) order by u.id), '[]') from public.weekly_lesson_uses u where u.script_id = s.id))
        order by s.created_at), '[]') from public.weekly_scripts s where s.topic = p_topic),
    'rubric', jsonb_build_object('label', 'Provisional internal criteria, not validated performance benchmarks',
        'dimensions', jsonb_build_array('hook_conflict', 'human_stakes', 'emotional_force', 'argument_coherence',
                                        'factual_discipline', 'spoken_clarity', 'closing'),
        'gates', jsonb_build_array('total at least 21/28', 'factual discipline = 4',
                                   'hook, emotional force and coherence each at least 3', 'no unresolved material factual issue',
                                   'explicit human approval')),
    -- Kept apart on purpose: mechanical compliance, human acceptance, editing effort, audience outcomes.
    'measurement', jsonb_build_object(
        'mechanical', (select jsonb_build_object('script_versions', count(*), 'checks_passed', count(*) filter (where (s.checks ->> 'ok')::boolean))
                       from public.weekly_scripts s where s.topic = p_topic and s.stage = 'script'),
        'human', (select jsonb_build_object('approvals', count(*), 'rubric_totals', coalesce(jsonb_agg(
                     (select sum(value::integer) from jsonb_each_text(a.rubric))) filter (where a.rubric is not null), '[]'))
                  from public.weekly_script_approvals a join public.weekly_scripts s on s.id = a.script_id
                  where s.topic = p_topic and s.stage = 'script' and a.approval_kind = 'editorial'),
        'editing', (select jsonb_build_object('rewrites', count(*) filter (where c.decision = 'rewrite'),
                       'reviews', count(*), 'note', 'Clock time between versions is not active editing time.')
                    from public.weekly_corrections c join public.weekly_scripts s on s.id = c.script_id where s.topic = p_topic),
        'audience', jsonb_build_object('status', 'not_collected')),
    'lessons', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'text', l.text, 'test', l.test, 'status', l.status,
        'example_before', l.example_before, 'example_after', l.example_after) order by l.created_at), '[]')
        from public.weekly_lesson_state l where l.topic = p_topic),
    'corrections', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'script_id', c.script_id, 'segment_index', c.segment_index,
        'decision', c.decision, 'action', c.action, 'reason', c.reason, 'finding_ids', c.finding_ids, 'lesson_scope', c.lesson_scope,
        'before_text', c.before_text, 'after_text', c.after_text, 'result_script_id', c.result_script_id, 'note', c.note)
        order by c.created_at), '[]')
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
declare r public.weekly_runs; lv public.weekly_library_versions; tv public.weekly_scripts;
begin
  update public.weekly_runs set status = 'running', started_at = now() where id = p_run and status = 'queued' returning * into r;
  if r.id is null then raise exception 'run is not queued' using errcode = '55000'; end if;
  if r.kind = 'research_ingest' then
    return jsonb_build_object('run', r.id, 'kind', r.kind, 'topic', r.topic,
      'answer', (select jsonb_build_object('id', a.id, 'raw_text', a.raw_text, 'raw_sha256', a.raw_sha256)
                 from public.weekly_research_answers a where a.id = (r.input ->> 'answer_id')::uuid));
  end if;
  if r.kind in ('title_check', 'visual_check') then
    select v.* into tv from public.weekly_scripts v where v.id = (r.input ->> 'version_id')::uuid;
    r.input := r.input || jsonb_build_object('library_version_id', tv.library_version_id, 'profile_id', tv.profile_id, 'depends_on', tv.depends_on);
  end if;
  select * into lv from public.weekly_library_versions where id = (r.input ->> 'library_version_id')::uuid;
  return jsonb_build_object('run', r.id, 'kind', r.kind, 'mode', r.kind, 'topic', r.topic, 'library_version', lv.n,
    'title_version', case when r.kind = 'title_check' then jsonb_build_object('id', tv.id, 'body', tv.body, 'body_sha256', tv.body_sha256) end,
    'cue_version', case when r.kind = 'visual_check' then jsonb_build_object('id', tv.id, 'body', tv.body, 'body_sha256', tv.body_sha256) end,
    -- the library's sources that carry a stored copy (visual_check only): what a cue may point at
    'sources', case when r.kind = 'visual_check' then (select coalesce(jsonb_agg(jsonb_build_object('source_id', w.id, 'url', w.url,
        'publisher', w.publisher, 'title', w.title, 'label', coalesce(w.title, w.publisher, w.url),
        'document_path', w.document_path, 'document_sha256', w.document_sha256, 'document_kind', w.document_kind,
        'finding_ids', (select jsonb_agg(f2.finding_key || '@' || f2.version order by f2.finding_key)
                        from public.weekly_finding_sources s2 join public.weekly_findings f2 on f2.id = s2.finding_id
                        join public.weekly_library_version_findings x2 on x2.finding_id = f2.id and x2.library_version_id = lv.id
                        where s2.source_id = w.id)) order by w.created_at, w.id), '[]')
        from public.weekly_sources w where w.document_path is not null and exists (select 1 from public.weekly_finding_sources s3
          join public.weekly_library_version_findings x3 on x3.finding_id = s3.finding_id and x3.library_version_id = lv.id
          where s3.source_id = w.id)) end,
    'script', (select sv.body from public.weekly_scripts sv where sv.id = (r.input ->> 'depends_on')::uuid and sv.stage = 'script'),
    'findings', (select coalesce(jsonb_agg(jsonb_build_object('claim_id', f.finding_key || '@' || f.version, 'statement', f.statement,
        'qualifiers', f.qualifiers, 'uncertainty', f.uncertainty, 'scope', f.scope,
        'quotes', (select coalesce(jsonb_agg(w.quote order by w.created_at) filter (where w.quote is not null), '[]')
                   from public.weekly_finding_sources fs join public.weekly_sources w on w.id = fs.source_id where fs.finding_id = f.id))
        order by f.finding_key), '[]')
        from public.weekly_library_version_findings x join public.weekly_findings f on f.id = x.finding_id
        where x.library_version_id = lv.id),
    'profile', (select p.rules from public.weekly_editorial_profiles p where p.id = (r.input ->> 'profile_id')::uuid),
    'profile_version', (select p.version from public.weekly_editorial_profiles p where p.id = (r.input ->> 'profile_id')::uuid),
    'angle', (select d.body -> 'angles' -> (r.input ->> 'selected_index')::integer from public.weekly_scripts d
              where d.id = (case r.kind when 'outline' then (r.input ->> 'depends_on')::uuid
                                        when 'titles' then (select o.depends_on from public.weekly_scripts o where o.id =
                                          (select sv.depends_on from public.weekly_scripts sv where sv.id = (r.input ->> 'depends_on')::uuid))
                                        when 'title_check' then (select o.depends_on from public.weekly_scripts o where o.id =
                                          (select sv.depends_on from public.weekly_scripts sv where sv.id = (r.input ->> 'depends_on')::uuid))
                                        else (select o.depends_on from public.weekly_scripts o where o.id = (r.input ->> 'depends_on')::uuid) end)),
    'outline', (select o.body from public.weekly_scripts o where o.id = (r.input ->> 'depends_on')::uuid and o.stage = 'outline'),
    'parent', (select jsonb_build_object('body', ps.body, 'segment_index', (r.input ->> 'segment_index')::integer,
                 'action', r.input ->> 'action', 'reason', r.input ->> 'reason', 'finding_ids', r.input -> 'finding_ids')
               from public.weekly_scripts ps where ps.id = (r.input ->> 'parent_id')::uuid),
    'lessons', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'text', l.text, 'test', l.test,
        'example_before', l.example_before, 'example_after', l.example_after) order by l.created_at), '[]')
        from public.weekly_lessons l where l.id in (select jsonb_array_elements_text(coalesce(r.input -> 'lessons_retrieved', '[]'))::uuid)));
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
    -- A stored copy of the document (document_path/sha256/kind) is recorded only with storage_permission full_copy (the table's
    -- check refuses it otherwise). The fetcher does not store copies yet; until it does, no source carries one.
    insert into public.weekly_sources (answer_id, url, final_url, publisher, title, quote, retrieved_at, content_sha256, fetch_error,
                                       quote_match, date_extraction, published_date, storage_permission,
                                       document_path, document_sha256, document_kind)
      values (a, s ->> 'url', s ->> 'final_url', s ->> 'publisher', s ->> 'title', s ->> 'quote', (s ->> 'retrieved_at')::timestamptz,
              s ->> 'content_sha256', s ->> 'fetch_error', s ->> 'quote_match', s ->> 'date_extraction', (s ->> 'published_date')::date,
              coalesce(s ->> 'storage_permission', 'excerpt'), s ->> 'document_path', s ->> 'document_sha256', s ->> 'document_kind')
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

-- payload: {provider, model, prompt_sha256, body, checks, lessons_included:[uuid],
--           lesson_assessments:[{lesson_id, assessed, assessed_by, note}], runner_seconds}
-- One record step for every writing run (angles / outline / script / rewrite). The run's input decides the stage and
-- lineage; the payload cannot choose them.
create or replace function public.weekly_script_record(p_run uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.weekly_runs; sid uuid; retrieved uuid[]; included uuid[]; l uuid; asmt jsonb; stg text; lib text[]; bad text[];
        newtext text;
begin
  select * into r from public.weekly_runs where id = p_run and kind in ('angles', 'outline', 'script', 'rewrite', 'titles') and status = 'running';
  if r.id is null then raise exception 'run is not a running writing run' using errcode = '55000'; end if;
  stg := case r.kind when 'rewrite' then 'script' when 'titles' then 'title' else r.kind end;
  lib := public.weekly_library_claim_ids((r.input ->> 'library_version_id')::uuid);
  -- every finding id a draft names must be pinned in its library version
  select coalesce(array_agg(distinct x), '{}') into bad from (
    select jsonb_array_elements_text(coalesce(a -> 'finding_ids', '[]')) x from jsonb_array_elements(coalesce(p_payload -> 'body' -> 'angles', '[]')) a
    union all select jsonb_array_elements_text(coalesce(b -> 'finding_ids', '[]')) from jsonb_array_elements(coalesce(p_payload -> 'body' -> 'beats', '[]')) b
    union all select jsonb_array_elements_text(coalesce(g -> 'claim_ids', '[]')) from jsonb_array_elements(coalesce(p_payload -> 'body' -> 'segments', '[]')) g
    union all select jsonb_array_elements_text(coalesce(c -> 'input' -> 'supporting_claim_ids', '[]')) from jsonb_array_elements(coalesce(p_payload -> 'body' -> 'candidates', '[]')) c) t
    where x <> all (lib);
  if cardinality(bad) > 0 then raise exception 'cites findings not in the pinned library: %', array_to_string(bad, ', ') using errcode = '22023'; end if;
  if stg = 'angles' and exists (select 1 from jsonb_array_elements(coalesce(p_payload -> 'body' -> 'angles', '[]')) a
                                where jsonb_array_length(coalesce(a -> 'finding_ids', '[]')) = 0) then
    raise exception 'every angle card needs supporting findings' using errcode = '22023';
  end if;
  retrieved := coalesce(array(select jsonb_array_elements_text(coalesce(r.input -> 'lessons_retrieved', '[]'))::uuid), '{}');
  included := coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'lessons_included', '[]'))::uuid), '{}');
  if not included <@ retrieved then raise exception 'a lesson was included that was not retrieved' using errcode = '22023'; end if;
  insert into public.weekly_scripts (run_id, stage, parent_id, depends_on, selected_index, topic, library_version_id, profile_id,
                                     lessons_included, prompt_sha256, provider, model, body, checks)
    values (r.id, stg, (r.input ->> 'parent_id')::uuid, (r.input ->> 'depends_on')::uuid, (r.input ->> 'selected_index')::integer,
            r.topic, (r.input ->> 'library_version_id')::uuid, (r.input ->> 'profile_id')::uuid, included,
            p_payload ->> 'prompt_sha256', p_payload ->> 'provider', p_payload ->> 'model', p_payload -> 'body', p_payload -> 'checks')
    returning id into sid;
  if r.kind = 'rewrite' then
    newtext := p_payload -> 'body' -> 'segments' -> (r.input ->> 'segment_index')::integer ->> 'text';
    if newtext is null then raise exception 'the rewrite lost the passage it was asked to rewrite' using errcode = '22023'; end if;
    update public.weekly_corrections set after_text = newtext, result_script_id = sid where id = (r.input ->> 'review_id')::uuid;
  end if;
  if stg = 'script' then
    foreach l in array retrieved loop
      select x into asmt from jsonb_array_elements(coalesce(p_payload -> 'lesson_assessments', '[]')) x where (x ->> 'lesson_id')::uuid = l limit 1;
      insert into public.weekly_lesson_uses (script_id, lesson_id, retrieved, included, assessed, assessed_by, assessment_note)
        values (sid, l, true, l = any (included), coalesce(asmt ->> 'assessed', 'not_assessed'), coalesce(asmt ->> 'assessed_by', 'none'),
                asmt ->> 'note');
    end loop;
  end if;
  insert into public.weekly_cost_entries (run_id, category, cost_type, scope, script_id, note)
    values (r.id, 'writing', 'no_incremental_api_charge', 'report', sid, 'Claude on the founder''s plan'),
           (r.id, 'verification', 'no_incremental_api_charge', 'report', sid, 'mechanical checks and the run audit (no AI call)');
  insert into public.weekly_cost_entries (run_id, category, cost_type, scope, script_id, quantity, unit, note)
    values (r.id, 'writing', 'runner_minutes', 'report', sid, round(coalesce((p_payload ->> 'runner_seconds')::numeric, 0) / 60, 2), 'minutes',
            'writing, audit and check jobs on GitHub runners');
  update public.weekly_runs set status = 'done', finished_at = now(), result = jsonb_build_object('script_id', sid, 'stage', stg) where id = r.id;
  -- a rewrite keeps its parent's document cues; the new text is checked against them like any cued version
  if stg = 'script' and public.weekly_cue_count(p_payload -> 'body') > 0 then
    perform public._wk_queue('visual_check', r.topic, jsonb_build_object('version_id', sid), r.requested_by);
  end if;
  return sid;
end $$;

-- The mechanical title checks of one title version (title_check run). Records the checks against the body hash
-- the run read, so a check never attaches to a different text.
create or replace function public.weekly_title_check_record(p_run uuid, p_body_sha256 text, p_checks jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.weekly_runs;
begin
  select * into r from public.weekly_runs where id = p_run and kind = 'title_check' and status = 'running';
  if r.id is null then raise exception 'run is not a running title check' using errcode = '55000'; end if;
  if p_body_sha256 is distinct from (select body_sha256 from public.weekly_scripts where id = (r.input ->> 'version_id')::uuid) then
    raise exception 'the checks were made on a different text' using errcode = '22023';
  end if;
  insert into public.weekly_cost_entries (run_id, category, cost_type, scope, note)
    values (r.id, 'verification', 'runner_minutes', 'report', 'title checks on a GitHub runner (no AI call)');
  update public.weekly_runs set status = 'done', finished_at = now(),
    result = jsonb_build_object('body_sha256', p_body_sha256, 'checks', p_checks) where id = r.id;
end $$;

-- ── function grants ───────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['weekly_sha256(text)', 'weekly_append_only()', 'weekly_library_guard()', 'weekly_lesson_use_guard()', '_wk_dispatch(text,uuid)',
    'weekly_scripts_lineage_guard()', 'weekly_corrections_guard()', 'weekly_version_status(uuid)', 'weekly_library_claim_ids(uuid)',
    'weekly_rubric_problems(jsonb)', '_wk_queue(text,text,jsonb,text)', 'weekly_title_checks(uuid)', 'weekly_title_review_status(uuid)',
    'hs_weekly_title_propose(uuid,jsonb,uuid,uuid)', 'hs_weekly_title_refit(uuid,uuid)', 'hs_weekly_titles_request(uuid,uuid)',
    'hs_weekly_title_decide(uuid,integer,text,text)', 'hs_weekly_title_evidence_review(uuid,text,text,boolean)',
    'hs_weekly_title_publication_approve(uuid,text)', 'weekly_title_check_record(uuid,text,jsonb)',
    'weekly_without_visuals(jsonb)', 'weekly_cue_count(jsonb)', 'weekly_visual_checks(uuid)',
    'hs_weekly_doc_cue_set(uuid,integer,jsonb)', 'weekly_visual_check_record(uuid,text,jsonb)',
    'hs_weekly_angles_request(uuid,uuid,uuid)', 'hs_weekly_outline_request(uuid,uuid)', 'hs_weekly_version_approve(uuid,integer,jsonb,boolean,text)',
    'hs_weekly_passage_review(uuid,integer,text,text,text,text[],text,text)',
    'hs_weekly_request_research(text,text)', 'hs_weekly_paste_answer(uuid,text)', 'hs_weekly_finding_decide(uuid,text,text)',
    'hs_weekly_library_seal(text)', 'hs_weekly_profile_create(jsonb,text)', 'hs_weekly_profile_approve(uuid)',
    'hs_weekly_script_request(uuid)', 'hs_weekly_correction_save(uuid,integer,text,text,text)',
    'hs_weekly_lesson_propose(uuid,text,jsonb)', 'hs_weekly_lesson_decide(uuid,text)', 'hs_weekly_lesson_use_review(bigint,text,text)',
    'hs_weekly_subscription_record(text,text,numeric,text,boolean)', 'hs_weekly_overview(text)', 'hs_weekly_export(text)',
    'weekly_run_claim(uuid)', 'weekly_run_fail(uuid,text)', 'weekly_research_record(uuid,jsonb)', 'weekly_script_record(uuid,jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['hs_weekly_request_research(text,text)', 'hs_weekly_paste_answer(uuid,text)',
    'hs_weekly_finding_decide(uuid,text,text)', 'hs_weekly_library_seal(text)', 'hs_weekly_profile_create(jsonb,text)',
    'hs_weekly_profile_approve(uuid)', 'hs_weekly_script_request(uuid)', 'hs_weekly_angles_request(uuid,uuid,uuid)',
    'hs_weekly_outline_request(uuid,uuid)', 'hs_weekly_version_approve(uuid,integer,jsonb,boolean,text)',
    'hs_weekly_passage_review(uuid,integer,text,text,text,text[],text,text)', 'hs_weekly_correction_save(uuid,integer,text,text,text)',
    'hs_weekly_title_propose(uuid,jsonb,uuid,uuid)', 'hs_weekly_title_refit(uuid,uuid)', 'hs_weekly_titles_request(uuid,uuid)',
    'hs_weekly_title_decide(uuid,integer,text,text)', 'hs_weekly_title_evidence_review(uuid,text,text,boolean)',
    'hs_weekly_title_publication_approve(uuid,text)', 'hs_weekly_doc_cue_set(uuid,integer,jsonb)', 'hs_weekly_lesson_propose(uuid,text,jsonb)',
    'hs_weekly_lesson_decide(uuid,text)', 'hs_weekly_lesson_use_review(bigint,text,text)',
    'hs_weekly_subscription_record(text,text,numeric,text,boolean)', 'hs_weekly_overview(text)', 'hs_weekly_export(text)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['weekly_run_claim(uuid)', 'weekly_run_fail(uuid,text)', 'weekly_research_record(uuid,jsonb)',
    'weekly_script_record(uuid,jsonb)', 'weekly_title_check_record(uuid,text,jsonb)', 'weekly_visual_check_record(uuid,text,jsonb)'] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Private buckets for stored source documents and the page images a visual_check makes (Tab 16's staged page PNGs).
-- Read by dashboard admins only; written only by the service role. Skipped where Supabase Storage is absent (test databases).
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('weekly-sources', 'weekly-sources', false, 20971520, array['application/pdf', 'text/html']),
         ('weekly-visuals', 'weekly-visuals', false, 10485760, array['image/png'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  execute 'drop policy if exists weekly_documents_admin_read on storage.objects';
  execute $p$create policy weekly_documents_admin_read on storage.objects for select to authenticated
             using (bucket_id in ('weekly-sources', 'weekly-visuals') and public.hs_is_dashboard_admin())$p$;
end $$;

commit;

-- ============================================================================================
-- DEVELOPMENT DOSSIERS — project identity + reviewed relationships (founder, 2026-10-29)
-- PROPOSED FOR SEPARATE APPROVAL · NOT APPLIED TO PRODUCTION
-- ============================================================================================
-- Design: docs/development-dossier-design-2026-10-29.md (§2–§7). Approved in principle 2026-10-29.
--
-- One real-world development = one row in development_project, with a permanent project_key and
-- one page at /development/<state>/<project_key>/. What belongs to it is a REVIEWED LINK to an
-- object JODY already stores (a source record, the data-centre entity, the land assembly, a water
-- filing, a government record, an organization, a document, a JODY video or Bluesky post). The
-- link stores only the object's stable key, the role, the evidence grade and source, and who
-- approved it. Nothing is copied, merged or re-classified:
--   * Type and lifecycle come from lib/project-type.js run on the ONE defining record.
--   * Facts are joined at snapshot time from the owning tables (§5 of the design).
--   * A project needs no app_projects row: Stratos's defining record is the data-centre entity.
--
-- RULES ENFORCED HERE, not in calling code:
--   1. Links and statements are append-only. A decision or correction inserts a new row that
--      supersedes the old one; UPDATE and DELETE are refused.
--   2. Automated jobs can only PROPOSE (link_state 'candidate'). Every non-candidate row must name
--      a current reviewer whose scopes include the object kind — checked by trigger on every
--      insert, whoever inserts it (including service_role).
--   3. Only grades a and b can be approved; grade b also needs evidence_note.
--   4. A link naming a private person can never be approved and never reaches the snapshot.
--   5. At most one current approved defining record per project.
--   6. The role must fit the object kind (development_link_role_allowed).
--   7. ONE NAME AUTHORITY: a project that links an approved land assembly takes its name from
--      resolved_projects.display_name (docs/resolved-projects-display-name.sql). Its own
--      display_name must then be NULL or identical; a different one is refused.
--
-- GRANTS: anon and authenticated get nothing on any table. Reviewers act through the security
-- definer functions below; the build reads only development_dossier_snapshot() (service_role).
--
-- APPLY ORDER: docs/resolved-projects-display-name.sql first (this file reads that column).
-- ROLLBACK (no other object depends on these): see the end of the file.
-- ============================================================================================

begin;

-- ── reviewers ────────────────────────────────────────────────────────────────────────────
create table if not exists public.development_reviewer (
  user_id     uuid primary key,
  scopes      text[] not null default array['source_record','dc_entity','land_assembly','parcel','water_filing',
                'government_record','organization','document','youtube_video','bluesky_post','news_report',
                'statement','project'],
  granted_by  text not null,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  note        text
);

-- ── projects ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.development_project (
  project_id    uuid primary key default gen_random_uuid(),
  project_key   text not null unique check (project_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  state         char(2) not null check (state ~ '^[A-Z]{2}$'),
  display_name  text check (display_name is null or btrim(display_name) <> ''),
  page_state    text not null default 'draft' check (page_state in ('draft','published','withdrawn')),
  merged_into   uuid references public.development_project(project_id),
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on column public.development_project.display_name is
  'Only for a project with no linked resolved_projects name. One name authority: see rule 7.';

-- ── links ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.development_project_link (
  link_id          uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.development_project(project_id),
  object_kind      text not null check (object_kind in (
                     'source_record','dc_entity','land_assembly','parcel','water_filing',
                     'government_record','organization','document','youtube_video',
                     'bluesky_post','news_report')),
  object_ref       text not null check (btrim(object_ref) <> ''),
  role             text not null,
  grade            char(1) not null check (grade in ('a','b','c','d','e')),
  evidence_url     text not null check (evidence_url ~ '^https://[^\s]+$'),
  evidence_label   text,
  evidence_quote   text,
  evidence_note    text,
  display_text     text,            -- the reviewer's sentence the page shows for this link
  event_date       date,            -- the source's own date, when the link is a dated event
  event_date_label text check (event_date is null or (event_date_label is not null and btrim(event_date_label) <> '')),
  aspect           text,            -- Water, Land, Approvals, Public participation, …
  valid_from       date,
  valid_to         date,
  link_state       text not null check (link_state in ('candidate','approved','rejected','revoked','superseded')),
  supersedes       uuid unique references public.development_project_link(link_id),
  proposed_by      text not null check (proposed_by ~ '^(reviewer|automated):[A-Za-z0-9._:-]+$'),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_reason  text,
  names_private_person boolean not null default false,
  created_at       timestamptz not null default now(),
  check ((link_state = 'candidate') = (decided_by is null and decided_at is null)),
  check (link_state not in ('rejected','revoked') or (decision_reason is not null and btrim(decision_reason) <> '')),
  check (link_state <> 'approved' or grade in ('a','b')),
  check (link_state <> 'approved' or grade <> 'b' or (evidence_note is not null and btrim(evidence_note) <> '')),
  check (link_state <> 'approved' or not names_private_person)
);
create index if not exists development_project_link_project_idx on public.development_project_link (project_id);

-- ── reviewer-written statements (summary, what is known, what is not, next, impacts) ─────
create table if not exists public.development_project_statement (
  statement_id  uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.development_project(project_id),
  kind          text not null check (kind in ('summary','latest','known','unknown','next','impact')),
  body          text not null check (btrim(body) <> ''),
  title         text,
  aspect        text,
  event_date    date,
  event_date_label text,
  checked_on    date,
  evidence_url  text check (evidence_url is null or evidence_url ~ '^https://[^\s]+$'),
  evidence_label text,
  position      int not null default 0,
  retired       boolean not null default false,
  supersedes    uuid unique references public.development_project_statement(statement_id),
  written_by    uuid not null,
  created_at    timestamptz not null default now(),
  -- a statement that asserts a fact names its source; "unknown" and "next" may not have one
  check (kind in ('unknown','next') or retired or evidence_url is not null)
);

alter table public.development_reviewer          enable row level security;
alter table public.development_project           enable row level security;
alter table public.development_project_link      enable row level security;
alter table public.development_project_statement enable row level security;
revoke all on public.development_reviewer, public.development_project, public.development_project_link,
              public.development_project_statement from public, anon, authenticated;

-- ── the role vocabulary (design §3) ───────────────────────────────────────────────────────
create or replace function public.development_link_role_allowed(p_kind text, p_role text)
returns boolean language sql immutable set search_path to 'public','pg_temp' as $fn$
  select case p_kind
    when 'source_record'     then p_role in ('defining_record','permit_for','environmental_review_for','land_use_case_for')
    when 'dc_entity'         then p_role in ('defining_record','facility_of')
    when 'land_assembly'     then p_role = 'associated_land'
    when 'parcel'            then p_role = 'associated_land'
    when 'water_filing'      then p_role in ('water_change_application','water_appropriation_application')
    when 'government_record' then p_role in ('agenda_item','adopted_action','legal_decision','hearing','filing')
    when 'organization'      then p_role in ('landowner_of_record','applicant','buyer_under_contract','master_developer',
                                             'designer','consultant','governing_body','filing_receiver')
    when 'document'          then p_role = 'primary_document'
    when 'youtube_video'     then p_role = 'explains'
    when 'bluesky_post'      then p_role = 'explains'
    when 'news_report'       then p_role = 'reported_by'
    else false end
$fn$;

-- the object_ref shape each kind must have (design §4)
create or replace function public.development_link_ref_ok(p_kind text, p_ref text)
returns boolean language sql immutable set search_path to 'public','pg_temp' as $fn$
  select case p_kind
    when 'source_record'     then p_ref ~ '^[^|\s][^|]*\|[0-9]+$'
    when 'dc_entity'         then p_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    when 'land_assembly'     then p_ref ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    when 'parcel'            then p_ref ~ '^[A-Z]{2}-[0-9]{5}:\S+$'
    when 'water_filing'      then p_ref ~ '^[a-z]{2}_[a-z]+:\S+$'
    when 'government_record' then p_ref ~ '^([a-z]{2}_[a-z]+:\S+|https://\S+)$'
    when 'organization'      then p_ref ~ '^[A-Z]{2}:\S.*$'
    when 'document'          then p_ref ~ '^https://\S+$'
    when 'youtube_video'     then p_ref ~ '^youtube:[A-Za-z0-9_-]{11}$'
    when 'bluesky_post'      then p_ref ~ '^bsky:at://\S+$'
    when 'news_report'       then p_ref ~ '^https://\S+$'
    else false end
$fn$;

create or replace function public.development_reviewer_can(p_user uuid, p_scope text)
returns boolean language sql stable set search_path to 'public','pg_temp' as $fn$
  select exists (select 1 from public.development_reviewer r
                  where r.user_id = p_user and r.revoked_at is null and p_scope = any (r.scopes))
$fn$;

-- the land-assembly name a project takes, if it links one (rule 7)
create or replace function public.development_project_record_name(p_project uuid)
returns text language sql stable set search_path to 'public','pg_temp' as $fn$
  select min(rp.display_name)
    from public.development_project_link l
    join public.resolved_projects rp on rp.project_key = l.object_ref
   where l.project_id = p_project and l.object_kind = 'land_assembly' and l.link_state = 'approved'
     and not exists (select 1 from public.development_project_link s where s.supersedes = l.link_id)
     and rp.display_name is not null
$fn$;

-- ── guards ───────────────────────────────────────────────────────────────────────────────
create or replace function public.development_append_only() returns trigger
language plpgsql set search_path to 'public','pg_temp' as $fn$
begin
  raise exception '% is append-only: insert a new row that supersedes this one', tg_table_name
    using errcode = '42501';
end $fn$;

create or replace function public.development_link_guard() returns trigger
language plpgsql set search_path to 'public','pg_temp' as $fn$
declare prev public.development_project_link;
begin
  if not public.development_link_role_allowed(new.object_kind, new.role) then
    raise exception 'role % is not allowed for %', new.role, new.object_kind using errcode = '23514';
  end if;
  if not public.development_link_ref_ok(new.object_kind, new.object_ref) then
    raise exception 'object_ref % is not a % key', new.object_ref, new.object_kind using errcode = '23514';
  end if;
  if new.link_state <> 'candidate' and not public.development_reviewer_can(new.decided_by, new.object_kind) then
    raise exception 'only a current reviewer with scope % can decide a link', new.object_kind using errcode = '42501';
  end if;
  if new.link_state = 'candidate' and new.supersedes is not null then
    raise exception 'a candidate does not supersede a row' using errcode = '23514';
  end if;
  if new.supersedes is not null then
    select * into prev from public.development_project_link where link_id = new.supersedes;
    if prev.project_id <> new.project_id or prev.object_kind <> new.object_kind or prev.object_ref <> new.object_ref
       or prev.role <> new.role then
      raise exception 'a decision keeps the project, object and role of the row it decides' using errcode = '23514';
    end if;
    if new.link_state = 'revoked' and prev.link_state <> 'approved' then
      raise exception 'only an approved link can be revoked' using errcode = '23514';
    end if;
    if new.link_state in ('approved','rejected') and prev.link_state <> 'candidate' then
      raise exception 'only a candidate can be approved or rejected' using errcode = '23514';
    end if;
  elsif new.link_state <> 'candidate' then
    raise exception 'a decision must supersede the row it decides' using errcode = '23514';
  end if;
  return new;
end $fn$;

create or replace function public.development_statement_guard() returns trigger
language plpgsql set search_path to 'public','pg_temp' as $fn$
begin
  if not public.development_reviewer_can(new.written_by, 'statement') then
    raise exception 'only a current reviewer can write a project statement' using errcode = '42501';
  end if;
  return new;
end $fn$;

create or replace function public.development_project_guard() returns trigger
language plpgsql set search_path to 'public','pg_temp' as $fn$
declare rec text;
begin
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.project_key <> old.project_key or new.state <> old.state
       or new.created_by <> old.created_by or new.created_at <> old.created_at then
      raise exception 'project_id, project_key, state and creation are permanent' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  rec := public.development_project_record_name(new.project_id);
  if rec is not null and new.display_name is not null and new.display_name <> rec then
    raise exception 'project % is named % by its land assembly; a second name is refused', new.project_key, rec
      using errcode = '23514';
  end if;
  return new;
end $fn$;

drop trigger if exists development_link_append_only on public.development_project_link;
create trigger development_link_append_only before update or delete on public.development_project_link
  for each row execute function public.development_append_only();
drop trigger if exists development_link_guard on public.development_project_link;
create trigger development_link_guard before insert on public.development_project_link
  for each row execute function public.development_link_guard();
drop trigger if exists development_statement_append_only on public.development_project_statement;
create trigger development_statement_append_only before update or delete on public.development_project_statement
  for each row execute function public.development_append_only();
drop trigger if exists development_statement_guard on public.development_project_statement;
create trigger development_statement_guard before insert on public.development_project_statement
  for each row execute function public.development_statement_guard();
drop trigger if exists development_project_guard on public.development_project;
create trigger development_project_guard before insert or update on public.development_project
  for each row execute function public.development_project_guard();
drop trigger if exists development_project_no_delete on public.development_project;
create trigger development_project_no_delete before delete on public.development_project
  for each row execute function public.development_append_only();

-- ── what reviewers and jobs call ─────────────────────────────────────────────────────────
-- The acting user: auth.uid() for a reviewer's own session. Only authenticated (always has a uid)
-- and service_role may execute the functions below, so a NULL uid means service_role (a job),
-- and a job can only propose.
create or replace function public.development_actor() returns uuid
language sql stable set search_path to 'public','pg_temp' as $fn$
  select auth.uid()
$fn$;

create or replace function public.development_project_create(p_project_key text, p_state text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare uid uuid := public.development_actor(); pid uuid;
begin
  if uid is null or not public.development_reviewer_can(uid, 'project') then
    raise exception 'only a current reviewer can create a project' using errcode = '42501';
  end if;
  insert into public.development_project (project_key, state, display_name, created_by)
  values (p_project_key, upper(p_state), nullif(btrim(p_display_name), ''), uid) returning project_id into pid;
  return pid;
end $fn$;

create or replace function public.development_project_set(p_project_key text, p_page_state text, p_display_name text default null)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare uid uuid := public.development_actor();
begin
  if uid is null or not public.development_reviewer_can(uid, 'project') then
    raise exception 'only a current reviewer can change a project' using errcode = '42501';
  end if;
  update public.development_project
     set page_state = p_page_state, display_name = nullif(btrim(p_display_name), '')
   where project_key = p_project_key;
  if not found then raise exception 'no project %', p_project_key using errcode = 'P0002'; end if;
end $fn$;

-- Propose a link. A reviewer proposes as reviewer:<uid>; a job (service_role) as automated:<job>.
-- Either way the row is a CANDIDATE. Nothing publishes until a reviewer decides it.
create or replace function public.development_link_propose(
  p_project_key text, p_object_kind text, p_object_ref text, p_role text, p_grade text,
  p_evidence_url text, p_evidence_label text default null, p_evidence_quote text default null,
  p_evidence_note text default null, p_display_text text default null, p_event_date date default null,
  p_event_date_label text default null, p_aspect text default null, p_names_private_person boolean default false,
  p_job text default null)
returns uuid language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare uid uuid := public.development_actor(); pid uuid; who text; lid uuid;
begin
  if uid is not null then
    if not public.development_reviewer_can(uid, p_object_kind) then
      raise exception 'only a current reviewer can propose a link' using errcode = '42501';
    end if;
    who := 'reviewer:' || uid::text;
  elsif p_job ~ '^[A-Za-z0-9._-]+$' then
    who := 'automated:' || p_job;
  else
    raise exception 'a job must name itself (p_job)' using errcode = '42501';
  end if;
  select project_id into pid from public.development_project where project_key = p_project_key;
  if pid is null then raise exception 'no project %', p_project_key using errcode = 'P0002'; end if;
  insert into public.development_project_link (project_id, object_kind, object_ref, role, grade, evidence_url,
    evidence_label, evidence_quote, evidence_note, display_text, event_date, event_date_label, aspect,
    names_private_person, link_state, proposed_by)
  values (pid, p_object_kind, p_object_ref, p_role, p_grade, p_evidence_url, p_evidence_label, p_evidence_quote,
    p_evidence_note, p_display_text, p_event_date, p_event_date_label, p_aspect, p_names_private_person,
    'candidate', who)
  returning link_id into lid;
  return lid;
end $fn$;

-- Decide a link: approve or reject a candidate, or revoke an approved link. Inserts a new row.
create or replace function public.development_link_decide(p_link_id uuid, p_decision text, p_reason text default null)
returns uuid language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare uid uuid := public.development_actor(); l public.development_project_link; nid uuid; nm text;
begin
  if p_decision not in ('approved','rejected','revoked') then
    raise exception 'decision must be approved, rejected or revoked' using errcode = '22023';
  end if;
  select * into l from public.development_project_link where link_id = p_link_id for update;
  if not found then raise exception 'no link %', p_link_id using errcode = 'P0002'; end if;
  if uid is null or not public.development_reviewer_can(uid, l.object_kind) then
    raise exception 'only a current reviewer with scope % can decide this link', l.object_kind using errcode = '42501';
  end if;
  if exists (select 1 from public.development_project_link where supersedes = l.link_id) then
    raise exception 'link % was already decided' , l.link_id using errcode = '23505';
  end if;
  perform pg_advisory_xact_lock(hashtext('development_project:' || l.project_id::text));
  if p_decision = 'approved' and l.role = 'defining_record' and exists (
       select 1 from public.development_project_link d
        where d.project_id = l.project_id and d.role = 'defining_record' and d.link_state = 'approved'
          and not exists (select 1 from public.development_project_link s where s.supersedes = d.link_id)) then
    raise exception 'project already has a defining record; revoke it first' using errcode = '23505';
  end if;
  insert into public.development_project_link (project_id, object_kind, object_ref, role, grade, evidence_url,
    evidence_label, evidence_quote, evidence_note, display_text, event_date, event_date_label, aspect,
    valid_from, valid_to, names_private_person, link_state, supersedes, proposed_by, decided_by, decided_at,
    decision_reason)
  values (l.project_id, l.object_kind, l.object_ref, l.role, l.grade, l.evidence_url, l.evidence_label,
    l.evidence_quote, l.evidence_note, l.display_text, l.event_date, l.event_date_label, l.aspect, l.valid_from,
    l.valid_to, l.names_private_person, p_decision, l.link_id, l.proposed_by, uid, now(), nullif(btrim(p_reason), ''))
  returning link_id into nid;
  if p_decision = 'approved' and l.object_kind = 'land_assembly' then
    nm := public.development_project_record_name(l.project_id);
    if nm is not null and exists (select 1 from public.development_project
                                   where project_id = l.project_id and display_name is not null and display_name <> nm) then
      raise exception 'the land assembly names this project %; clear the project''s own name first', nm
        using errcode = '23514';
    end if;
  end if;
  return nid;
end $fn$;

-- Write, correct or retire a statement. A correction supersedes the old statement.
create or replace function public.development_statement_write(
  p_project_key text, p_kind text, p_body text, p_evidence_url text default null, p_evidence_label text default null,
  p_title text default null, p_aspect text default null, p_event_date date default null,
  p_event_date_label text default null, p_checked_on date default null, p_position int default 0,
  p_supersedes uuid default null, p_retire boolean default false)
returns uuid language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare uid uuid := public.development_actor(); pid uuid; sid uuid; prev public.development_project_statement;
begin
  if uid is null or not public.development_reviewer_can(uid, 'statement') then
    raise exception 'only a current reviewer can write a project statement' using errcode = '42501';
  end if;
  select project_id into pid from public.development_project where project_key = p_project_key;
  if pid is null then raise exception 'no project %', p_project_key using errcode = 'P0002'; end if;
  if p_supersedes is not null then
    select * into prev from public.development_project_statement where statement_id = p_supersedes;
    if not found or prev.project_id <> pid then
      raise exception 'statement % is not one of this project''s', p_supersedes using errcode = '23514';
    end if;
  end if;
  insert into public.development_project_statement (project_id, kind, body, title, aspect, event_date,
    event_date_label, checked_on, evidence_url, evidence_label, position, retired, supersedes, written_by)
  values (pid, coalesce(prev.kind, p_kind), p_body, p_title, p_aspect, p_event_date, p_event_date_label, p_checked_on,
    p_evidence_url, p_evidence_label, p_position, p_retire, p_supersedes, uid)
  returning statement_id into sid;
  return sid;
end $fn$;

-- ── the one read the build makes ─────────────────────────────────────────────────────────
-- Published, unmerged projects; their current APPROVED links (grade a/b, no private person) with
-- facts joined from the owning tables; their current statements. A link whose object is not
-- public or no longer exists (a video not verified public, a Bluesky post not published, a
-- source record no longer stored) is withheld and counted, never shown.
-- A data-center record's lifecycle, decided the way Map 1 decides it (2026-10-30). The rule is
-- public.map1_dc_zip_members' (docs/map1-dc-publication.sql): the entity's CURRENT observation that
-- states a displayable lifecycle (the location authority first, then the newest), mapped through
-- THE ONE LIFECYCLE MAP. A stated lifecycle outside that map (e.g. cancelled), or none, is NULL:
-- the page then says "Lifecycle unknown". The two VALUES lists are pinned equal by
-- test/development-pages.test.mjs, so the dossier cannot drift from Map 1.
create or replace function public.dc_entity_map_status(p_entity uuid)
returns text language sql stable set search_path to 'public','pg_temp' as $fn$
  with lifecycle(v, map_status) as (values
    ('operational',        'Operating'),
    ('under_construction', 'Approved'),
    ('permitted',          'Approved'),
    ('proposed',           'Proposed'))
  select lc.map_status
    from public.dc_entity_observation eo
    join public.dc_current_observation cx on cx.home_signal_observation_id = eo.home_signal_observation_id
    join public.dc_source_observation x on x.home_signal_observation_id = eo.home_signal_observation_id
    join lifecycle lc on lc.v = x.source_native_status
    left join public.dc_entity_geography ge on ge.canonical_entity_id = eo.canonical_entity_id
   where eo.canonical_entity_id = p_entity
   order by (x.home_signal_observation_id = ge.authority_observation_id) desc nulls last,
            x.observed_at desc, x.home_signal_observation_id
   limit 1
$fn$;
revoke all on function public.dc_entity_map_status(uuid) from public, anon, authenticated;

create or replace function public.development_dossier_snapshot()
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare out jsonb := '{}'::jsonb; p record; links jsonb; stmts jsonb; withheld jsonb; nm text; nsrc text; def jsonb;
begin
  for p in select * from public.development_project
            where page_state = 'published' and merged_into is null order by project_key collate "C" loop
    with cur as (
      select l.* from public.development_project_link l
       where l.project_id = p.project_id and l.link_state = 'approved' and l.grade in ('a','b')
         and not l.names_private_person
         and not exists (select 1 from public.development_project_link s where s.supersedes = l.link_id)
    ), f as (
      select c.*, case c.object_kind
        when 'source_record' then (
          select jsonb_build_object('name', ap.name, 'type', ap.type, 'type_raw', ap.type_raw, 'status', ap.status,
                   'date', ap.submitted_at, 'date_kind', ap.date_kind, 'source_ref', ap.source_ref,
                   'source_key', ap.source_key, 'source_seq', ap.source_seq,
                   'zips', (select jsonb_agg(distinct z.zip order by z.zip) from public.app_projects z
                             where z.source_key = ap.source_key and z.source_seq = ap.source_seq and z.record_kind = ap.record_kind))
            from public.app_projects ap
           where ap.source_key = split_part(c.object_ref, '|', 1)
             and ap.source_seq = nullif(split_part(c.object_ref, '|', 2), '')::smallint
           order by ap.id limit 1)
        when 'dc_entity' then (
          select jsonb_build_object('classification', e.classification, 'superseded_by', e.superseded_by,
                   'lifecycle', public.dc_entity_map_status(e.canonical_entity_id))
            from public.dc_canonical_entity e where e.canonical_entity_id = c.object_ref::uuid
             and e.superseded_by is null)
        when 'land_assembly' then (
          select jsonb_build_object('display_name', rp.display_name, 'display_name_basis', rp.display_name_basis,
                   'zips', (select jsonb_agg(jsonb_build_object('zip', v.zip, 'parcels', v.parcels_in_this_zip,
                                                                'primary', v.is_primary_zip) order by v.zip)
                              from public.v_resolved_project_zip v where v.project_key = rp.project_key))
            from public.resolved_projects rp where rp.project_key = c.object_ref)
        when 'water_filing' then (
          select jsonb_build_object('filing_no', w.filing_no, 'filing_type', min(w.filing_type), 'status', min(w.status),
                   'filed_on', min(w.filed_on), 'date_label', min(w.date_label), 'record_url', min(w.record_url),
                   'points', count(*), 'on_pending_list', bool_or(w.removed_from_source_at is null))
            from public.water_rights_filings w
           where w.source = case split_part(c.object_ref, ':', 1) when 'ut_dwr' then 'ut_dwr_pending'
                                when 'id_idwr' then 'id_idwr_applications' when 'nv_ndwr' then 'nv_ndwr_pending' end
             and w.filing_no = substr(c.object_ref, length(split_part(c.object_ref, ':', 1)) + 2)
           group by w.filing_no)
        when 'youtube_video' then (
          select jsonb_build_object('title', y.title, 'url', y.url, 'duration_s', y.duration_s,
                   'kind', case when y.duration_s is not null and y.duration_s <= 180 then 'short' else 'main' end,
                   'published_at', y.published_at, 'verified', y.public_verified_at)
            from public.youtube_channel_videos y
           where y.video_id = substr(c.object_ref, 9) and y.privacy_status = 'public' and y.public_verified_at is not null)
        when 'bluesky_post' then coalesce(
          (select jsonb_build_object('text', j.post_text, 'published_at', j.published_at, 'uri', j.bsky_uri)
             from public.video_bluesky_jobs j where j.bsky_uri = substr(c.object_ref, 6) and j.status = 'published'
            order by j.published_at desc nulls last limit 1),
          (select jsonb_build_object('text', m.label, 'published_at', m.posted_at, 'uri', m.bsky_uri)
             from public.bsky_post_metrics m where m.bsky_uri = substr(c.object_ref, 6) and m.posted_at is not null
            order by m.captured_at desc limit 1))
        else '{}'::jsonb end as facts
      from cur c
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'link_id', f.link_id, 'kind', f.object_kind, 'ref', f.object_ref, 'role', f.role, 'grade', f.grade,
             'evidence_url', f.evidence_url, 'evidence_label', f.evidence_label, 'evidence_quote', f.evidence_quote,
             'evidence_note', f.evidence_note, 'text', f.display_text, 'date', f.event_date,
             'date_label', f.event_date_label, 'aspect', f.aspect, 'approved_at', f.decided_at, 'facts', f.facts)
             order by f.event_date nulls last, f.object_kind, f.object_ref collate "C") filter (where f.facts is not null), '[]'),
           coalesce(jsonb_agg(jsonb_build_object('kind', f.object_kind, 'ref', f.object_ref))
             filter (where f.facts is null), '[]')
      into links, withheld
      from f;

    select coalesce(jsonb_agg(jsonb_build_object('kind', s.kind, 'body', s.body, 'title', s.title, 'aspect', s.aspect,
             'date', s.event_date, 'date_label', s.event_date_label, 'checked_on', s.checked_on,
             'evidence_url', s.evidence_url, 'evidence_label', s.evidence_label)
             order by s.kind, s.position, s.created_at), '[]')
      into stmts
      from public.development_project_statement s
     where s.project_id = p.project_id and not s.retired
       and not exists (select 1 from public.development_project_statement x where x.supersedes = s.statement_id);

    nm := public.development_project_record_name(p.project_id);
    if nm is not null and p.display_name is not null and p.display_name <> nm then
      raise exception 'project % has two names (% / %)', p.project_key, nm, p.display_name;
    end if;
    nsrc := case when nm is not null then 'resolved_project' when p.display_name is not null then 'project' end;
    nm := coalesce(nm, p.display_name);
    if nm is null then continue; end if;   -- an unnamed project has no page
    def := (select l.value from jsonb_array_elements(links) as l(value) where l.value ->> 'role' = 'defining_record');

    out := out || jsonb_build_object(p.project_key, jsonb_build_object(
      'project_key', p.project_key, 'state', p.state,
      'path', '/development/' || lower(p.state) || '/' || p.project_key || '/',
      'display_name', nm, 'name_source', nsrc,
      'name_basis', (select l.value #>> '{facts,display_name_basis}' from jsonb_array_elements(links) as l(value)
                      where l.value ->> 'kind' = 'land_assembly' and l.value #>> '{facts,display_name}' = nm limit 1),
      'defining', def, 'links', links, 'statements', stmts, 'withheld', withheld,
      'updated_at', greatest(p.updated_at,
                    (select max(x.created_at) from public.development_project_link x where x.project_id = p.project_id),
                    (select max(x.created_at) from public.development_project_statement x where x.project_id = p.project_id))));
  end loop;
  return jsonb_build_object('schema', 'development-dossiers/1', 'generated_at', to_char(now() at time zone 'UTC',
                            'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'dossiers', out);
end $fn$;

-- Supabase grants EXECUTE on new functions to anon and authenticated directly: revoke by name.
revoke all on function public.development_link_role_allowed(text, text) from public, anon, authenticated;
revoke all on function public.development_link_ref_ok(text, text) from public, anon, authenticated;
revoke all on function public.development_reviewer_can(uuid, text) from public, anon, authenticated;
revoke all on function public.development_project_record_name(uuid) from public, anon, authenticated;
revoke all on function public.development_actor() from public, anon, authenticated;
revoke all on function public.development_append_only() from public, anon, authenticated;
revoke all on function public.development_link_guard() from public, anon, authenticated;
revoke all on function public.development_statement_guard() from public, anon, authenticated;
revoke all on function public.development_project_guard() from public, anon, authenticated;
revoke all on function public.development_dossier_snapshot() from public, anon, authenticated;
revoke all on function public.development_project_create(text, text, text) from public, anon;
revoke all on function public.development_project_set(text, text, text) from public, anon;
revoke all on function public.development_link_propose(text, text, text, text, text, text, text, text, text, text, date, text, text, boolean, text) from public, anon;
revoke all on function public.development_link_decide(uuid, text, text) from public, anon;
revoke all on function public.development_statement_write(text, text, text, text, text, text, text, date, text, date, int, uuid, boolean) from public, anon;
grant execute on function public.development_project_create(text, text, text) to authenticated;
grant execute on function public.development_project_set(text, text, text) to authenticated;
grant execute on function public.development_link_propose(text, text, text, text, text, text, text, text, text, text, date, text, text, boolean, text) to authenticated, service_role;
grant execute on function public.development_link_decide(uuid, text, text) to authenticated;
grant execute on function public.development_statement_write(text, text, text, text, text, text, text, date, text, date, int, uuid, boolean) to authenticated;
grant execute on function public.development_dossier_snapshot() to service_role;

commit;

-- ── ROLLBACK (run by hand; only after the renderer and publisher are reverted) ─────────────
-- drop function if exists public.development_dossier_snapshot(), public.development_statement_write(text, text, text, text, text, text, text, date, text, date, int, uuid, boolean),
--   public.development_link_decide(uuid, text, text),
--   public.development_link_propose(text, text, text, text, text, text, text, text, text, text, date, text, text, boolean, text),
--   public.development_project_set(text, text, text), public.development_project_create(text, text, text);
-- drop table if exists public.development_project_statement, public.development_project_link,
--   public.development_project, public.development_reviewer;
-- drop function if exists public.development_project_guard(), public.development_statement_guard(),
--   public.development_link_guard(), public.development_append_only(), public.development_actor(),
--   public.development_project_record_name(uuid), public.development_reviewer_can(uuid, text),
--   public.development_link_ref_ok(text, text), public.development_link_role_allowed(text, text);

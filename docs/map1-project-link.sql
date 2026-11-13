-- MAP 1 PROJECT LINK + PROJECT DOCUMENTS (2026-11-12). PROPOSED · NOT APPLIED TO PRODUCTION.
--
-- Two things Map 1 needs so a link of the form /map/<zip>/?project=<project key> opens one project
-- with its supporting documents (lib/map1-project-panel.js, homesignalmap.html):
--
--   1. public.map1_project_locate(p_key, p_zip)  where a project is drawn on Map 1 today, and the key
--      the map draws it under. Read-only. It decides no membership itself: a data center counts as
--      drawn only when public.map1_dc_zip_members(zip) returns it (docs/map1-dc-publication.sql); a
--      development record only when the serving N5 generation holds it (geo.n5_serving_membership).
--   2. public.map1_project_document + public.map1_project_document_decision  supporting documents a
--      person approved for one project, with an append-only decision history, and the public reader
--      public.map1_project_documents(p_map_keys) that returns APPROVED rows only.
--
-- PROJECT KEYS (stable across status changes, merges and map rebuilds):
--   dcrec:<record key>  a canonical data center, named by its publisher's record key
--                       (public.dc_observation_record_key, rank 0 publisher id or 1 run-unique name;
--                       a rank-2 singleton key names one observation and is refused). Never the entity
--                       uuid: entities are superseded when the identity resolver merges them.
--   nat:<source_key>    a row of public.national_dc_records (OpenStreetMap).
--   n5:<source_key>     a development record in the serving N5 generation.
--
-- WHY A NEW DOCUMENT STORE (2026-11-12 design note):
--   * development_project_link / official_record belong to the development dossiers, which this
--     feature must not depend on (founder, 2026-11-12), and official_record holds water filings only.
--   * dc_record_citation() derives ONE citation from a publisher payload; it stores nothing and has no
--     approval.
--   * Impact Stories source packs live in git per story.
--   None of these is "this document belongs to this project and may be shown". This table is the only
--   approval record for that question; nothing else may show a document on Map 1's project panel.
--
-- STATES: a document's state is the decision of its newest decision row, or 'pending' when it has none.
--   pending  -> approved | rejected
--   rejected -> approved
--   approved -> revoked
--   revoked  -> approved
--   Every move is a new row (who, when, why). Rows are never updated or deleted.
-- APPROVING A DOCUMENT SAYS ONLY THAT IT BELONGS TO THE PROJECT AND MAY BE SHOWN. It changes no
-- project status, location or type; nothing reads this table to decide a status.
--
-- Depends on: docs/map1-dc-publication.sql, docs/zip-membership-canonical.sql,
-- docs/dc-step3a-canonical-identity.sql (dc_observation_record_key), docs/n5-generation-publish.sql,
-- docs/canonical-zip-registry-guard.sql, docs/impact-stories.sql (public._hs_is_admin).

-- ── 1. LOCATE ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.map1_project_locate(p_key text, p_zip text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'geo', 'pg_temp'
set statement_timeout to '20s'
as $fn$
declare
  k text := btrim(coalesce(p_key, ''));
  kind text; body text; roots uuid[]; root uuid; map_key text;
  lat double precision; lng double precision; zips text[] := '{}';
begin
  if k !~ '^(dcrec|nat|n5):[^[:cntrl:]]{1,255}$' then
    return jsonb_build_object('key', p_key, 'state', 'bad_key', 'zips', '[]'::jsonb);
  end if;
  kind := split_part(k, ':', 1);
  body := substr(k, length(kind) + 2);

  if kind = 'dcrec' then
    -- every entity this record key is linked to, followed to the entity that stands today
    with recursive linked as (
      select distinct eo.canonical_entity_id as id, 0 as depth
        from public.dc_observation_record_key rk
        join public.dc_entity_observation eo on eo.home_signal_observation_id = rk.home_signal_observation_id
       where rk.record_key = body and rk.record_key_rank < 2
      union
      select e.superseded_by, l.depth + 1
        from linked l join public.dc_canonical_entity e on e.canonical_entity_id = l.id
       where e.superseded_by is not null and l.depth < 50)
    select coalesce(array_agg(distinct l.id), '{}') into roots
      from linked l join public.dc_canonical_entity e on e.canonical_entity_id = l.id
     where e.superseded_by is null;
    if cardinality(roots) = 0 then
      return jsonb_build_object('key', k, 'kind', kind, 'state', 'unknown_key', 'zips', '[]'::jsonb);
    end if;
    if cardinality(roots) > 1 then
      return jsonb_build_object('key', k, 'kind', kind, 'state', 'ambiguous', 'zips', '[]'::jsonb);
    end if;
    root := roots[1];
    map_key := 'dc:' || root::text;
    select g.lat, g.lng into lat, lng from public.dc_entity_geography g where g.canonical_entity_id = root;
  elsif kind = 'nat' then
    map_key := body;
    select r.lat, r.lng into lat, lng from public.national_dc_records r where r.source_key = body limit 1;
    if not found then
      return jsonb_build_object('key', k, 'kind', kind, 'state', 'unknown_key', 'zips', '[]'::jsonb);
    end if;
  else  -- n5
    map_key := k;
    select coalesce(array_agg(z order by z collate "C"), '{}') into zips
      from (select distinct m.zcta5::text as z
              from geo.n5_serving_membership m
              join public.canonical_zip_registry r on r.zip = m.zcta5::text
             where m.source_key = body) d;
  end if;

  if kind in ('dcrec', 'nat') and lat is not null and lng is not null then
    -- candidate ZIPs by the canonical point predicate; drawn only if Map 1's own reader returns it
    select coalesce(array_agg(z order by z collate "C"), '{}') into zips
      from (select b.zcta5::text as z
              from geo.zcta_boundary b
              join public.canonical_zip_registry r on r.zip = b.zcta5::text
             where b.geom && ST_SetSRID(ST_MakePoint(lng, lat), 4269)
               and geo.zip_point_membership_in(b.geom, lat, lng) = 'member') c
     where exists (select 1 from public.map1_dc_zip_members(c.z) m where m.source_key = map_key);
  end if;

  return jsonb_build_object(
    'key', k, 'kind', kind, 'map_key', map_key,
    'state', case when cardinality(zips) > 0 then 'found' else 'not_on_map' end,
    'zips', to_jsonb(zips),
    'zip', case when p_zip = any(zips) then p_zip else zips[1] end);
end $fn$;

revoke all on function public.map1_project_locate(text, text) from public;
grant execute on function public.map1_project_locate(text, text) to anon, authenticated, service_role;

comment on function public.map1_project_locate(text, text) is
'Where a project key (dcrec:/nat:/n5:) is drawn on Map 1 today: {state found|not_on_map|unknown_key|ambiguous|bad_key, zips, zip, map_key}. '
'A data center counts as drawn only when map1_dc_zip_members returns it. docs/map1-project-link.sql.';

-- The stable project keys behind a key Map 1 draws (dc:<uuid>, an OSM source_key, n5:<source_key>).
-- A canonical data center may carry several record keys (one per publisher) and absorbs the record
-- keys of every entity superseded into it.
create or replace function public.map1_project_stable_keys(p_map_key text)
returns setof text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  with recursive ent as (
    select (substr(p_map_key, 4))::uuid as id, 0 as depth
     where p_map_key ~ '^dc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union
    select e.canonical_entity_id, ent.depth + 1
      from ent join public.dc_canonical_entity e on e.superseded_by = ent.id
     where ent.depth < 50)
  select distinct 'dcrec:' || rk.record_key
    from ent
    join public.dc_entity_observation eo on eo.canonical_entity_id = ent.id
    join public.dc_observation_record_key rk on rk.home_signal_observation_id = eo.home_signal_observation_id
   where rk.record_key_rank < 2
  union
  select p_map_key where p_map_key ~ '^n5:.'
  union
  select 'nat:' || r.source_key from public.national_dc_records r
   where r.source_key = p_map_key and p_map_key !~ '^(dc|n5):';
$fn$;

revoke all on function public.map1_project_stable_keys(text) from public;
grant execute on function public.map1_project_stable_keys(text) to service_role;

-- ── 2. DOCUMENTS ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.map1_project_document (
  document_id    uuid primary key default gen_random_uuid(),
  project_key    text not null check (project_key ~ '^(dcrec|nat|n5):[^[:cntrl:]]{1,255}$'),
  url            text not null check (url ~ '^https://[^[:space:]<>"'']+$' and length(url) <= 2000),
  title          text not null check (btrim(title) <> '' and length(title) <= 300),
  publisher      text not null check (btrim(publisher) <> '' and length(publisher) <= 200),
  doc_kind       text not null check (doc_kind in ('application','planning','decision','permit','meeting',
                                                   'other_official','news','directory')),
  doc_date       date,
  doc_date_label text check (doc_date_label is null or (btrim(doc_date_label) <> '' and length(doc_date_label) <= 80)),
  supports       text not null check (btrim(supports) <> '' and length(supports) <= 500),
  evidence_quote text check (evidence_quote is null or length(evidence_quote) <= 1000),
  proposed_by    text not null check (proposed_by ~ '^(founder|verification):[A-Za-z0-9._:@-]{1,120}$'),
  created_at     timestamptz not null default now(),
  check (doc_date is null or doc_date_label is not null),
  unique (project_key, url)
);

create table if not exists public.map1_project_document_decision (
  decision_id  bigint generated always as identity primary key,
  document_id  uuid not null references public.map1_project_document(document_id),
  decision     text not null check (decision in ('approved','rejected','revoked')),
  reason       text check (reason is null or length(reason) <= 500),
  decided_by   text not null check (btrim(decided_by) <> ''),
  decided_at   timestamptz not null default now(),
  check (decision = 'approved' or (reason is not null and btrim(reason) <> ''))
);
create index if not exists map1_project_document_decision_doc_idx
  on public.map1_project_document_decision (document_id, decision_id desc);

alter table public.map1_project_document          enable row level security;
alter table public.map1_project_document_decision enable row level security;
revoke all on public.map1_project_document, public.map1_project_document_decision from anon, authenticated;

create or replace function public.map1_project_document_append_only()
returns trigger language plpgsql as $fn$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end $fn$;
drop trigger if exists map1_project_document_no_change on public.map1_project_document;
create trigger map1_project_document_no_change before update or delete on public.map1_project_document
  for each row execute function public.map1_project_document_append_only();
drop trigger if exists map1_project_document_decision_no_change on public.map1_project_document_decision;
create trigger map1_project_document_decision_no_change before update or delete on public.map1_project_document_decision
  for each row execute function public.map1_project_document_append_only();

-- The one definition of a document's current state.
create or replace function public.map1_project_document_current(p_document_id uuid)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select coalesce((select d.decision from public.map1_project_document_decision d
                    where d.document_id = p_document_id order by d.decision_id desc limit 1), 'pending');
$fn$;
revoke all on function public.map1_project_document_current(uuid) from public;

-- Every decision row obeys the state machine, whoever writes it.
create or replace function public.map1_project_document_decision_guard()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare cur text := public.map1_project_document_current(new.document_id);
begin
  perform pg_advisory_xact_lock(hashtext('map1_project_document:' || new.document_id::text));
  cur := public.map1_project_document_current(new.document_id);
  if not ((cur = 'pending'  and new.decision in ('approved', 'rejected'))
       or (cur = 'rejected' and new.decision = 'approved')
       or (cur = 'approved' and new.decision = 'revoked')
       or (cur = 'revoked'  and new.decision = 'approved')) then
    raise exception 'a % document cannot be %', cur, new.decision using errcode = '55000';
  end if;
  return new;
end $fn$;
drop trigger if exists map1_project_document_decision_state on public.map1_project_document_decision;
create trigger map1_project_document_decision_state before insert on public.map1_project_document_decision
  for each row execute function public.map1_project_document_decision_guard();

-- Propose a document (the verification job, service role). Idempotent on (project_key, url): the same
-- facts return the existing id; different facts for the same URL are refused, never overwritten.
create or replace function public.map1_project_document_propose(
  p_project_key text, p_url text, p_title text, p_publisher text, p_doc_kind text,
  p_doc_date date, p_doc_date_label text, p_supports text, p_evidence_quote text, p_proposed_by text)
returns uuid language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare d public.map1_project_document%rowtype;
begin
  select * into d from public.map1_project_document where project_key = p_project_key and url = p_url;
  if found then
    if d.title is distinct from p_title or d.publisher is distinct from p_publisher
       or d.doc_kind is distinct from p_doc_kind or d.doc_date is distinct from p_doc_date
       or d.doc_date_label is distinct from p_doc_date_label or d.supports is distinct from p_supports then
      raise exception 'this document is already on file for this project with different details' using errcode = '23505';
    end if;
    return d.document_id;
  end if;
  insert into public.map1_project_document (project_key, url, title, publisher, doc_kind, doc_date, doc_date_label,
    supports, evidence_quote, proposed_by)
  values (p_project_key, p_url, p_title, p_publisher, p_doc_kind, p_doc_date, p_doc_date_label,
    p_supports, p_evidence_quote, p_proposed_by)
  returning document_id into d.document_id;
  return d.document_id;
end $fn$;
revoke all on function public.map1_project_document_propose(text, text, text, text, text, date, text, text, text, text) from public;
grant execute on function public.map1_project_document_propose(text, text, text, text, text, date, text, text, text, text) to service_role;

-- A person's decision (dashboard admin only). Returns the new state.
create or replace function public.hs_map1_project_document_decide(p_document_id uuid, p_decision text, p_reason text default null)
returns text language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare who text := public._hs_is_admin();
begin
  if not exists (select 1 from public.map1_project_document where document_id = p_document_id) then
    raise exception 'no such document' using errcode = 'P0002';
  end if;
  insert into public.map1_project_document_decision (document_id, decision, reason, decided_by)
  values (p_document_id, p_decision, nullif(btrim(coalesce(p_reason, '')), ''), who);
  return public.map1_project_document_current(p_document_id);
end $fn$;
revoke all on function public.hs_map1_project_document_decide(uuid, text, text) from public;
grant execute on function public.hs_map1_project_document_decide(uuid, text, text) to authenticated;

-- The public reader: APPROVED documents for keys Map 1 draws. Nothing pending, rejected or revoked.
create or replace function public.map1_project_documents(p_map_keys text[])
returns table(map_key text, project_key text, document_id uuid, url text, title text, publisher text,
              doc_kind text, doc_date date, doc_date_label text, supports text, approved_at timestamptz)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  with keys as (
    select mk, sk from unnest(p_map_keys[1:200]) as mk, lateral public.map1_project_stable_keys(mk) as sk
  ), cur as (
    select distinct on (dd.document_id) dd.document_id, dd.decision, dd.decided_at
      from public.map1_project_document_decision dd
     order by dd.document_id, dd.decision_id desc)
  select k.mk, d.project_key, d.document_id, d.url, d.title, d.publisher, d.doc_kind, d.doc_date,
         d.doc_date_label, d.supports, c.decided_at
    from keys k
    join public.map1_project_document d on d.project_key = k.sk
    join cur c on c.document_id = d.document_id and c.decision = 'approved'
   order by k.mk, d.doc_date desc nulls last, d.title collate "C";
$fn$;
revoke all on function public.map1_project_documents(text[]) from public;
grant execute on function public.map1_project_documents(text[]) to anon, authenticated, service_role;

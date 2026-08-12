-- property-card-entity-track-record.sql
-- THE STORE BEHIND THE ENTITY TRACK RECORD MODULE (property-card.html → HS.card).
--
-- It holds one hierarchy and nothing else:
--
--   Property
--     → Property Entity                  (the legal entity on the project/property)
--       → Entity Relationships           (each with a SOURCE and a VERIFICATION STATUS)
--         → Parent / Controlling Entity
--         → Related Material Entities
--     → Track Record Records             (source-agnostic enforcement / regulatory events)
--       → Source Agency / Source Document
--
-- SOURCE-AGNOSTIC BY CONSTRUCTION. Nothing below is keyed on SEC or FinCEN. An agency is a row in
-- `track_source_agency`; a record is a row in `track_record_event` whose `source_agency_id` points
-- at one. Adding OFAC, a state attorney general or a city enforcement body is an INSERT — no new
-- table, no new column, no new Property Card module. FinCEN in particular is a SOURCE FEEDING this
-- module, never a module of its own.
--
-- WHY IT IS NOT ONE WIDE "enforcement" TABLE PER AGENCY: the audit in
-- docs/multi-source-evidence-architecture.md §1.1 found three unconnected truth models built one
-- per pilot, sharing no key. This is deliberately the identity+evidence slice of that document's
-- Part 20 model, cut to exactly what the card renders, with the same names and vocabularies so the
-- full model adopts these tables rather than becoming a fourth parallel truth. §19 disposition:
--   companies (45)            → track_entity                (company_key kept as an alternate key)
--   company_parents (8)       → track_entity_relationship   (verification vocabulary kept VERBATIM)
--   company_aliases (0)       → track_entity_alias
--   company_track_events (61) → track_record_event          (attribution kept: direct / parent)
--   track_record_checks (17)  → track_source_check
-- Backfill, do not duplicate. Every one of those tables keeps its rows until the backfill is
-- compared row-for-row.
--
-- Parked/applied manually in the Supabase SQL editor, same convention as the other docs/*.sql.
-- Idempotent. NOT yet applied — until it is, HS.data.entityTrackRecord() reports `absent` and the
-- card renders every agency as "not checked", which is the true answer.
--
-- SECURITY: RLS ENABLED on every table. Anon may SELECT (this is public-record data the card reads
-- with the anon key). There is intentionally NO anon insert/update/delete policy anywhere — only
-- the service-role ingest may write. 21 tables in this project shipped with RLS disabled; nothing
-- here adds a 22nd.

-- ════════════════════════════════════════════════════════════════════════════════════
-- 1. SOURCE AGENCIES — the registry that makes the module source-agnostic
-- ════════════════════════════════════════════════════════════════════════════════════
-- `agency_id` matches HS.card.AGENCIES[].id exactly. That is the contract: the UI declares which
-- agencies it can render, this table declares which ones exist, and a CI parity check keeps the
-- two lists identical rather than letting them drift into a silent gap.
create table if not exists public.track_source_agency (
  agency_id      text primary key,                 -- 'sec' | 'epa_echo' | 'osha' | 'fincen' | 'doj' | 'ofac' | …
  short_name     text not null,                    -- 'FinCEN'            (the badge)
  full_name      text not null,                    -- 'Financial Crimes Enforcement Network'
  agency_level   text not null check (agency_level in ('federal','state','local','tribal')),
  jurisdiction   text,                             -- null = national; else a state/county scope
  homepage_url   text,
  -- What this agency PUBLISHES, in its own words. Never translated into a HomeSignal category at
  -- write time: an agency's programme enrolment is not an enforcement action, and collapsing the
  -- two is how a registry listing gets displayed as a finding.
  record_types   text[] not null default '{}',     -- e.g. {'Enforcement Action'}
  -- Whether HomeSignal can query it today. `not_connected` is the honest default and it is what
  -- makes the card's "we have not checked this" true rather than assumed.
  connection_status text not null default 'not_connected'
    check (connection_status in ('not_connected','in_progress','connected','access_restricted')),
  notes          text,
  created_at     timestamptz not null default now()
);

comment on table public.track_source_agency is
  'The enforcement/regulatory sources the Entity Track Record module can render. agency_id mirrors HS.card.AGENCIES[].id. Adding an agency is an INSERT here plus an entry in that list — never a new Property Card module.';

insert into public.track_source_agency
  (agency_id, short_name, full_name, agency_level, record_types, connection_status) values
  ('epa_echo',    'EPA / ECHO',           'US Environmental Protection Agency — ECHO compliance & enforcement', 'federal', '{"Violation","Enforcement Action","Inspection"}', 'not_connected'),
  ('state_env',   'State environmental',  'State environmental regulator',                                      'state',   '{"Violation","Enforcement Action"}',              'not_connected'),
  ('osha',        'OSHA',                 'US Occupational Safety and Health Administration',                   'federal', '{"Inspection","Violation"}',                      'not_connected'),
  ('sec',         'SEC',                  'US Securities and Exchange Commission',                              'federal', '{"Enforcement Action","Filing"}',                 'not_connected'),
  ('fincen',      'FinCEN',               'Financial Crimes Enforcement Network',                               'federal', '{"Enforcement Action"}',                          'not_connected'),
  ('doj',         'DOJ',                  'US Department of Justice',                                           'federal', '{"Enforcement Action","Prosecution","Settlement"}','not_connected'),
  ('ofac',        'OFAC',                 'US Treasury Office of Foreign Assets Control',                       'federal', '{"Designation","Enforcement Action"}',            'not_connected'),
  ('state_local', 'State / local',        'State and local enforcement bodies',                                 'state',   '{"Record"}',                                      'not_connected')
on conflict (agency_id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════════════
-- 2. ENTITIES — thin. Every describable attribute is a claim somewhere else.
-- ════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.track_entity (
  entity_id      uuid primary key default gen_random_uuid(),
  entity_kind    text not null default 'organization'
                 check (entity_kind in ('organization','government','individual_filer')),
  -- The name as the SOURCE THAT ESTABLISHED THIS ROW wrote it. Not a canonical name: "Neuralink",
  -- "Neuralink Corporation" and "Neuralink Corp." are three rows, exactly as `companies` holds
  -- them today, because merging them is a claim and no source here makes it.
  legal_name     text not null,
  legal_name_source text,                          -- which record stated this name
  -- The alternate key the existing `companies` table uses, kept so the backfill is a join and not
  -- a re-resolution. NOT the identity: a name change must never mint a different company.
  company_key    text unique,
  jurisdiction_of_formation text,                  -- e.g. 'DE', 'TX', 'NV'
  -- A KNOWN formation date renders on the card, so a company incorporated last quarter with no
  -- history does not read as equivalent to a thirty-year-old company with a clean one.
  formed_date    date,
  formed_source  text,
  formed_source_url text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists track_entity_name_idx on public.track_entity (lower(legal_name));

comment on column public.track_entity.legal_name is
  'The name as the establishing source wrote it. Two spellings are two rows: merging them is a claim, and it needs a track_entity_alias row with evidence.';

-- 2a. IDENTIFIERS — a source-issued identifier, and the authority that issued it.
-- An identifier's TYPE declares what kind of thing it identifies, which is what stops an SEC CIK
-- being joined to an EPA registry ID (architecture doc Part 5.1).
create table if not exists public.track_entity_identifier (
  entity_id      uuid not null references public.track_entity(entity_id) on delete cascade,
  id_type        text not null,                    -- 'sec.cik' | 'ein' | 'lei' | 'duns' | 'tceq.cn' | 'state.filing_no'
  id_value       text not null,
  issuing_authority text,
  source_name    text not null,                    -- who told us
  source_url     text,
  retrieved_at   timestamptz not null default now(),
  status         text not null default 'active' check (status in ('active','superseded','rejected')),
  primary key (entity_id, id_type, id_value)
);
create unique index if not exists track_entity_identifier_unique_active
  on public.track_entity_identifier (id_type, id_value) where status = 'active';

-- 2b. ALIASES — former legal names and d/b/a names, each with its own verification.
-- An UNVERIFIED alias is somebody's guess that two companies are one company. It is stored (so the
-- guess is on the record and can be resolved later) and it is NEVER used for matching: the card's
-- HS.card.matchKeys() admits verified aliases only.
create table if not exists public.track_entity_alias (
  alias_id       uuid primary key default gen_random_uuid(),
  entity_id      uuid not null references public.track_entity(entity_id) on delete cascade,
  alias_kind     text not null check (alias_kind in ('former_name','dba_name')),
  alias_name     text not null,
  verification   text not null default 'not_yet_asked'
                 check (verification in ('not_yet_asked','unverified_candidate','verified')),
  evidence_class text check (evidence_class in ('register_of_record','identifier_backed',
                 'authoritative_filing','regulatory_affiliation','published_statement','derived','candidate')),
  source_name    text,
  source_url     text,
  source_document_title text,
  retrieved_at   timestamptz,
  notes          text,
  -- The same shape of CHECK company_parents already enforces on parent_name: a VERIFIED alias may
  -- not exist without a source. Verification with nothing behind it is the failure mode this
  -- whole table exists to prevent.
  constraint track_entity_alias_verified_needs_source
    check (verification <> 'verified' or source_name is not null),
  unique (entity_id, alias_kind, alias_name)
);

-- 2c. RELATIONSHIPS — parent / controlling / related, as first-class rows.
-- EVERY parent-or-subsidiary relationship must have a SOURCE and a VERIFICATION STATUS; both are
-- enforced below rather than left to the writer's discipline. `relationship_kind` matches
-- HS.card.RELATIONSHIP_KINDS[].id, whose `group` decides which entity group the card renders it in
-- — so the layout follows the data instead of a hardcoded list of parent synonyms.
create table if not exists public.track_entity_relationship (
  relationship_id uuid primary key default gen_random_uuid(),
  entity_id      uuid not null references public.track_entity(entity_id) on delete cascade,   -- the subject
  related_entity_id uuid not null references public.track_entity(entity_id) on delete cascade, -- the parent/related company
  relationship_kind text not null check (relationship_kind in
    ('parent_company','controlling_company','ultimate_owner',
     'operator','developer','property_owner','management_company','subsidiary','affiliate')),
  verification   text not null default 'not_yet_asked'
                 check (verification in ('not_yet_asked','unverified_candidate','verified')),
  evidence_class text check (evidence_class in ('register_of_record','identifier_backed',
                 'authoritative_filing','regulatory_affiliation','published_statement','derived','candidate')),
  source_name    text,
  source_url     text,
  source_document_title text,
  -- WHAT PART IT PLAYS IN THIS PROJECT, in prose, from a document. Required for a related company
  -- to render at all: sharing a corporate parent is not a role, and a list of every affiliate is
  -- not information about this property.
  material_role  text,
  valid_from     date,
  valid_to       date,
  retrieved_at   timestamptz,
  notes          text,
  constraint track_entity_relationship_verified_needs_source
    check (verification <> 'verified' or source_name is not null),
  unique (entity_id, related_entity_id, relationship_kind)
);

comment on table public.track_entity_relationship is
  'Parent / controlling / related-company edges. A verified row MUST name its source (CHECK). The card renders a parent or a related company only on a verified, sourced row — and a related company only when material_role is stated.';

-- ════════════════════════════════════════════════════════════════════════════════════
-- 3. PROPERTY → ENTITY — which companies this address's card shows, and in which group
-- ════════════════════════════════════════════════════════════════════════════════════
-- Keyed on the engine's canonical address, the same key property_reports and
-- homesignalmap.html?addr= use. ONE normalizer, engine-side.
create table if not exists public.property_track_entity (
  address        text not null,                    -- canonical address (engine-normalized)
  entity_id      uuid not null references public.track_entity(entity_id) on delete cascade,
  -- Matches HS.card.ENTITY_ROLES[].id. `parent` and `related` rows are DERIVED from a verified
  -- track_entity_relationship; the read function below refuses to emit one that is not.
  entity_role    text not null check (entity_role in ('project_entity','parent','related')),
  -- How this entity relates to the PROPERTY (not to another company): 'Named as the project owner
  -- on a permit filed at this address', 'Owner of record per the appraisal district', …
  relationship_to_property text,
  evidence_class text check (evidence_class in ('register_of_record','identifier_backed',
                 'authoritative_filing','regulatory_affiliation','published_statement','derived','candidate')),
  source_name    text,
  source_url     text,
  retrieved_at   timestamptz,
  primary key (address, entity_id, entity_role)
);
create index if not exists property_track_entity_addr_idx on public.property_track_entity (address);

-- ════════════════════════════════════════════════════════════════════════════════════
-- 4. TRACK RECORD RECORDS — one source-agnostic shape for every agency
-- ════════════════════════════════════════════════════════════════════════════════════
-- Columns are exactly HS.card.ENFORCEMENT_FIELDS, so the store, the contract and the renderer
-- cannot drift. Nothing here is FinCEN-shaped: FinCEN's initial integration is
-- `record_type = 'Enforcement Action'` with a matter number, and every column it uses is one an
-- SEC administrative proceeding or an OSHA citation uses too.
create table if not exists public.track_record_event (
  event_id       uuid primary key default gen_random_uuid(),
  source_agency_id text not null references public.track_source_agency(agency_id),
  source_name    text not null,                    -- the publication, verbatim
  record_type    text,                             -- the source's OWN words: 'Enforcement Action', 'Citation'…
                                                   -- NULL when the source did not say; the card then
                                                   -- names the agency alone rather than calling it
                                                   -- an enforcement action on the source's behalf.
  -- ATTRIBUTION. `entity_name` is the legal entity THE SOURCE DOCUMENT NAMES, verbatim.
  -- `matched_entity_id` is HomeSignal's resolution of it, and may be NULL: an unresolved record is
  -- a real state, and guessing an entity to fill this column is the defect the column exists to
  -- make visible.
  entity_name    text not null,
  matched_entity_id uuid references public.track_entity(entity_id),
  match_basis    text check (match_basis in ('identifier','legal_name','former_name','dba_name')),
  -- The role/relationship AS THE RECORD FRAMES IT. Denormalized deliberately: the record must
  -- carry its own account of who this company was, so a later relationship edit cannot silently
  -- rewrite what a published document said.
  entity_role    text,
  relationship_to_property text,
  parent_or_subsidiary_relationship text,
  action_date    date,
  matter_number  text,
  violation_category text,
  violation_summary  text,
  penalty_amount numeric,                          -- NULL ≠ 0. An unstated penalty renders as
                                                   -- "the record doesn't say", never as $0.
  action_status  text,                             -- 'Final', 'Pending', 'Appealed' — the source's word
  source_url     text,                             -- the agency's page for this matter
  source_document_url text,                        -- the PDF/order itself
  source_document_title text,
  verification_status text not null default 'unverified'
                 check (verification_status in ('unverified','verified','disputed','withdrawn')),
  -- CARRIED, NEVER RENDERED. Upstream resolvers emit a score and dropping it on ingest would throw
  -- away somebody's work, but no HomeSignal surface displays it and no arbitration consumes it:
  -- confidence is categorical here, permanently (architecture doc Part 7.3 / Q8).
  confidence_score numeric,
  retrieved_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (source_agency_id, matter_number, entity_name)
);
create index if not exists track_record_event_entity_idx on public.track_record_event (matched_entity_id);
create index if not exists track_record_event_name_idx on public.track_record_event (lower(entity_name));

comment on column public.track_record_event.entity_name is
  'The legal entity the SOURCE DOCUMENT names, verbatim. The card displays the record under this entity and no other — never under the property, and never under a sibling because they share a parent.';
comment on column public.track_record_event.confidence_score is
  'Carried for provenance and never rendered. Confidence at HomeSignal is categorical (verification_status); a number invites arithmetic across incommensurable evidence.';

-- ════════════════════════════════════════════════════════════════════════════════════
-- 5. CHECKS — "we have not looked" and "we looked and found nothing" are different rows
-- ════════════════════════════════════════════════════════════════════════════════════
-- NO ROW AT ALL = not checked. A row with found_n = 0 = checked and empty. This is the whole
-- reason the card can refuse to print a 0 next to a source nobody queried, and it is per ENTITY
-- per AGENCY: querying OSHA once for an address is not a check of each company named on its
-- filings, and presenting it as one attributes research nobody performed.
create table if not exists public.track_source_check (
  entity_id      uuid not null references public.track_entity(entity_id) on delete cascade,
  agency_id      text not null references public.track_source_agency(agency_id),
  checked_at     timestamptz not null default now(),
  status         text not null check (status in
                 ('ok','error','access_restricted','in_progress','partial')),
  found_n        integer,                          -- NULL unless status='ok'
  query_basis    text,                             -- which name/identifier we searched under
  source_url     text,
  error          text,
  parser_version text,
  primary key (entity_id, agency_id)
);

comment on table public.track_source_check is
  'One row per (entity, agency) we have actually queried. The ABSENCE of a row is "not checked" — the distinction the whole card is built to keep visible. found_n=0 with status=ok is a measured zero and renders as 0.';

-- ════════════════════════════════════════════════════════════════════════════════════
-- 6. RLS — public read, no anon writes, on every table
-- ════════════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['track_source_agency','track_entity','track_entity_identifier',
    'track_entity_alias','track_entity_relationship','property_track_entity',
    'track_record_event','track_source_check']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_anon_select', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_anon_select', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════
-- 7. THE READ — one RPC, one payload, the shape HS.card already renders
-- ════════════════════════════════════════════════════════════════════════════════════
-- Returns { entities: [...], enforcement_records: [...] } for one canonical address.
--
-- THE GATES ARE IN THE QUERY, not only in the renderer. A parent or related entity is emitted only
-- from a VERIFIED, SOURCED relationship, and a related entity only with a material role — so an
-- unverified parent cannot reach the page even if a future surface forgets to check.
create or replace function public.property_card_entity_track(p_address text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with subject as (
  select pte.entity_id, pte.entity_role, pte.relationship_to_property, pte.evidence_class,
         pte.source_name, pte.source_url, pte.retrieved_at
  from public.property_track_entity pte
  where pte.address = p_address
),
-- The relationship backing a parent/related row, if any. A project_entity row needs none.
rel as (
  select r.*
  from public.track_entity_relationship r
  where r.verification = 'verified'
    and r.source_name is not null
),
resolved as (
  select s.*,
         r.relationship_kind, r.verification as relationship_verification,
         r.source_name as rel_source_name, r.source_url as rel_source_url,
         r.material_role, r.evidence_class as rel_evidence_class
  from subject s
  left join rel r
    on r.related_entity_id = s.entity_id
   and ((s.entity_role = 'parent'  and r.relationship_kind in ('parent_company','controlling_company','ultimate_owner'))
     or (s.entity_role = 'related' and r.relationship_kind in ('operator','developer','property_owner',
                                                               'management_company','subsidiary','affiliate')))
  where s.entity_role = 'project_entity'
     or (r.relationship_id is not null
         and (s.entity_role <> 'related' or r.material_role is not null))
),
entities as (
  select jsonb_agg(jsonb_build_object(
    'id',            e.entity_id,
    'name',          e.legal_name,
    'role',          x.entity_role,
    'formed_date',   e.formed_date,
    'formed_source', e.formed_source,
    'relationship_kind',         x.relationship_kind,
    'relationship_verification', coalesce(x.relationship_verification, 'not_yet_asked'),
    'relationship_to_property',  x.relationship_to_property,
    'relationship_source',       coalesce(x.rel_source_name, x.source_name),
    'relationship_source_url',   coalesce(x.rel_source_url, x.source_url),
    'material_role',   x.material_role,
    'evidence_class',  coalesce(x.rel_evidence_class, x.evidence_class),
    'identifiers', coalesce((
      select jsonb_agg(jsonb_build_object('id_type', i.id_type, 'id_value', i.id_value))
      from public.track_entity_identifier i
      where i.entity_id = e.entity_id and i.status = 'active'), '[]'::jsonb),
    -- VERIFIED aliases only. An unverified alias is stored so the guess is on the record, and it
    -- is withheld here so nothing can match on it.
    'aliases', coalesce((
      select jsonb_agg(jsonb_build_object('kind', a.alias_kind, 'name', a.alias_name,
                                          'verification', a.verification, 'source', a.source_name))
      from public.track_entity_alias a
      where a.entity_id = e.entity_id and a.verification = 'verified'), '[]'::jsonb),
    -- PER-ENTITY, PER-AGENCY check state. No row = the key is absent = the card says not checked.
    'track', coalesce((
      select jsonb_object_agg(c.agency_id, jsonb_build_object(
        'state', case
                   when c.status = 'ok' and coalesce(c.found_n, 0) > 0 then 'verified'
                   when c.status = 'ok' then 'checked_empty'
                   when c.status = 'error' then 'unavailable'
                   when c.status = 'access_restricted' then 'access_restricted'
                   when c.status = 'in_progress' then 'in_progress'
                   else 'partial' end,
        'found_n', c.found_n,
        'recent',  c.checked_at))
      from public.track_source_check c
      where c.entity_id = e.entity_id), '{}'::jsonb)
  ) order by case x.entity_role when 'project_entity' then 1 when 'parent' then 2 else 3 end,
             e.legal_name) as js
  from resolved x
  join public.track_entity e on e.entity_id = x.entity_id
),
records as (
  select jsonb_agg(jsonb_build_object(
    'source_agency',   ev.source_agency_id,
    'source_name',     ev.source_name,
    'record_type',     ev.record_type,
    'entity_name',     ev.entity_name,
    'matched_entity_id', ev.matched_entity_id,
    'entity_role',     ev.entity_role,
    'relationship_to_property', ev.relationship_to_property,
    'parent_or_subsidiary_relationship', ev.parent_or_subsidiary_relationship,
    'action_date',     ev.action_date,
    'matter_number',   ev.matter_number,
    'violation_category', ev.violation_category,
    'violation_summary',  ev.violation_summary,
    'penalty_amount',  ev.penalty_amount,
    'action_status',   ev.action_status,
    'source_url',      ev.source_url,
    'source_document_url',   ev.source_document_url,
    'source_document_title', ev.source_document_title,
    'verification_status',   ev.verification_status,
    'retrieved_at',    ev.retrieved_at
    -- confidence_score is deliberately NOT emitted: carried in the store, never rendered.
  ) order by ev.action_date desc nulls last) as js
  from public.track_record_event ev
  where ev.matched_entity_id in (select entity_id from resolved)
)
select jsonb_build_object(
  'address', p_address,
  'entities', coalesce((select js from entities), '[]'::jsonb),
  'enforcement_records', coalesce((select js from records), '[]'::jsonb)
);
$$;

comment on function public.property_card_entity_track(text) is
  'Entity Track Record payload for one canonical address: { entities, enforcement_records }. Emits a parent or related entity ONLY from a verified, sourced relationship (and a related one only with a material role), so the gate holds even for a caller that forgets to check. confidence_score is never emitted.';

grant execute on function public.property_card_entity_track(text) to anon, authenticated;

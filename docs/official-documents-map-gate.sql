-- OFFICIAL-DOCUMENT DEVELOPMENT PROJECTS, PR 1 (site half): the exposure gates, the map gate on the
-- canonical resolvers, the official-documents classification branch, scoped identity keys, the open-actions
-- reader, and the kill switch. Design: homesignal-ingest
-- docs/official-document-development-ingestion-design-2026-11-13.md (revision 3a, approved 2026-11-13).
--
-- ⛔ NOT APPLIED. Nothing here is authorized for production yet. It is applied only after review, and then
-- through the replica dry-run rule (CLAUDE.md, "A PRODUCTION DRY RUN RUNS NO DDL IN PRODUCTION"): copy
-- production out read-only, apply this file to the replica, prove Map 1 over every registry ZIP is
-- row-for-row identical before and after (it must be: every gate is closed and no official-documents
-- observation exists), then apply.
--
-- APPLY ORDER: after docs/dc-step3a-canonical-identity.sql, docs/dc-step3b-canonical-geography.sql and
-- docs/map1-dc-publication.sql (and every later splice of those functions), and after
-- docs/official-documents-contract.sql (the dc_source registration and the incremental release mode).
--
-- WHAT IT CHANGES, AND WHY EACH PIECE IS THE MINIMUM (design §4):
--   1. official_document_gate_decision: ONE append-only log for every gate (G1 acquisition per source,
--      G3 map admission per source distribution, G4 auto-publish). A gate's state is its newest decision;
--      no decision = closed. Nothing else stores a gate.
--   2. dc_source_admission_gate + dc_source_map_admitted(source, distribution) (G3). A distribution
--      registered here is admitted only while its gate is open; a distribution NOT registered here is
--      admitted exactly as today. Compute Atlas, Epoch and OSM are not registered, so they are untouched.
--   3. dc_current_observation: the same view, plus (a) only admitted distributions, and (b) for a run whose
--      FROZEN contract says release_mode 'incremental', every advanced complete run counts (a document
--      family has no release; a run carries only what it newly read), minus observations a later current
--      observation of the same distribution says it supersedes. For every whole-release source the
--      selection is exactly the old one.
--   4. dc_resolve_canonical: the history path (_res_obs) also keeps only admitted distributions. With G3
--      closed the canonical tables, the geography and Map 1 are therefore byte-identical whatever
--      official-documents observations are stored (test T-30 / T-48).
--   5. dc_classify_observation: one official_documents branch. It reads the classification the
--      deterministic checker (PR 3) wrote, and fails closed unless the evidence that rule needs is present.
--   6. Identity. An official-documents observation's publisher_record_id IS the agency-scoped case key
--      ('case:<agency>:<number>') when the documents state one; the checker folds every passage about that
--      case in one run into one observation, so documents of the same case in later runs are the same
--      record under the existing A1 rule, with no new merge rule. A document that states no case number
--      gets 'doc:<sha256>:<ordinal>'. dc_identity_candidate K5 surfaces pairs sharing a scoped case or
--      parcel key; a shared parcel never merges (A2 separates two records of one run, and across runs or
--      sources a scoped key is only a surfaced pair). dc_site_address reads the site address a document
--      states, so the existing A4 rule can tie a document about an existing facility to that facility.
--   7. dc_entity_open_actions(uuid[]) / dc_zip_open_actions(zip): the reader the Map 1 owner agreed for the
--      "Expansion proposed" badge and the "Proposed expansions" filter. It reads open actions; it decides
--      no lifecycle, colour or count.
--   8. official_documents_exposure_off(reason) / official_documents_exposure_restore(decision): the kill
--      switch and its rollback (design §4.2, §4.3).
--
-- WHAT IT DELIBERATELY DOES NOT DO: open any gate; register any acquisition source (G1 rows are the ingest
-- migration's); store any observation; change Map 1's reader; touch Compute Atlas, Epoch or OSM.
--
-- SPLICED FROM THE LIVE DEFINITIONS, never retyped (claims rule 7): each anchor must occur exactly once and
-- each replacement is re-read to prove it landed, or the whole file raises and nothing is kept.
-- No place name appears in this file (design T-26).

-- ── 1. THE GATE LOG ───────────────────────────────────────────────────────────────────────────
create table if not exists public.official_document_gate_decision (
  decision_id     bigint generated always as identity primary key,
  gate            text not null check (gate in ('G1_ACQUISITION', 'G3_MAP_ADMISSION', 'G4_AUTO_PUBLISH')),
  -- G1: an official_document_sources.source_ref; G3: '<source_key>/<distribution_key>'; G4: 'official_documents'
  scope_key       text not null check (btrim(scope_key) <> '' and length(scope_key) <= 200),
  is_open         boolean not null,
  actor           text not null check (btrim(actor) <> '' and length(actor) <= 200),
  policy_version  text not null check (btrim(policy_version) <> '' and length(policy_version) <= 80),
  reason          text not null check (btrim(reason) <> '' and length(reason) <= 1000),
  -- what an automated step changed, so a rollback can re-apply the previous state exactly
  effects         jsonb not null default '{}'::jsonb,
  -- a decision that restores an earlier state names the decision it reverses
  reverses        bigint references public.official_document_gate_decision(decision_id),
  decided_at      timestamptz not null default now()
);
create index if not exists official_document_gate_decision_scope_idx
  on public.official_document_gate_decision (gate, scope_key, decision_id desc);

alter table public.official_document_gate_decision enable row level security;
revoke all on public.official_document_gate_decision from public, anon, authenticated;
grant select, insert on public.official_document_gate_decision to service_role;

create or replace function public.official_document_append_only()
returns trigger language plpgsql as $fn$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end $fn$;
drop trigger if exists official_document_gate_decision_no_change on public.official_document_gate_decision;
create trigger official_document_gate_decision_no_change before update or delete on public.official_document_gate_decision
  for each row execute function public.official_document_append_only();
drop trigger if exists official_document_gate_decision_no_truncate on public.official_document_gate_decision;
create trigger official_document_gate_decision_no_truncate before truncate on public.official_document_gate_decision
  for each statement execute function public.official_document_append_only();

-- The ONE reading of a gate: its newest decision, closed when there is none.
create or replace function public.official_document_gate_open(p_gate text, p_scope_key text)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select coalesce((select d.is_open from public.official_document_gate_decision d
                    where d.gate = p_gate and d.scope_key = p_scope_key
                    order by d.decision_id desc limit 1), false)
$fn$;
revoke all on function public.official_document_gate_open(text, text) from public, anon, authenticated;
grant execute on function public.official_document_gate_open(text, text) to service_role;

-- ── 2. G3: MAP ADMISSION ─────────────────────────────────────────────────────────────────────
create table if not exists public.dc_source_admission_gate (
  source_key        text not null,
  distribution_key  text not null,
  registered_at     timestamptz not null default now(),
  primary key (source_key, distribution_key)
);
alter table public.dc_source_admission_gate enable row level security;
revoke all on public.dc_source_admission_gate from public, anon, authenticated;
drop trigger if exists dc_source_admission_gate_no_change on public.dc_source_admission_gate;
create trigger dc_source_admission_gate_no_change before update or delete on public.dc_source_admission_gate
  for each row execute function public.official_document_append_only();

insert into public.dc_source_admission_gate (source_key, distribution_key) values
  ('official_documents', 'official_listing'),
  ('official_documents', 'meeting_packets'),
  ('official_documents', 'tx_tceq_air')
on conflict do nothing;

-- Acquired is not admitted (the dc_derived_address_admitted pattern). A gated distribution is admitted only
-- while its G3 gate is open; an ungated distribution is admitted as it always was.
create or replace function public.dc_source_map_admitted(p_source_key text, p_distribution_key text)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select case
    when exists (select 1 from public.dc_source_admission_gate g
                  where g.source_key = p_source_key and g.distribution_key = p_distribution_key)
      then public.official_document_gate_open('G3_MAP_ADMISSION', p_source_key || '/' || p_distribution_key)
    else true end
$fn$;
revoke all on function public.dc_source_map_admitted(text, text) from public, anon, authenticated;
grant execute on function public.dc_source_map_admitted(text, text) to service_role;
comment on function public.dc_source_map_admitted(text, text) is
'G3 map admission (official-document design §4.1). A distribution in dc_source_admission_gate reaches the
canonical resolvers only while its G3 gate is open; every other distribution is admitted as before.';

-- ── 3. THE CURRENT OBSERVATION SET ───────────────────────────────────────────────────────────
-- Same columns, same order, same whole-release selection. Two additions: admitted distributions only, and
-- the incremental release mode for a run whose frozen contract declares it.
create or replace view public.dc_current_observation as
select
    o.home_signal_observation_id,
    o.acquisition_run_id,
    o.source_key,
    o.distribution_key,
    o.publisher_record_id,
    o.source_row_ordinal,
    o.source_native_name,
    o.source_native_type,
    o.source_native_status,
    o.source_native_operator,
    o.source_native_lat,
    o.source_native_lon,
    o.source_native_precision,
    o.raw_payload,
    r.run_seq,
    r.source_release_key,
    r.content_release_key
from public.dc_source_observation o
join public.dc_acquisition_run r on r.id = o.acquisition_run_id
where public.dc_source_map_admitted(o.source_key, o.distribution_key)
  and (
    r.id in (
      select distinct on (a.source_key, a.distribution_key) a.id
      from public.dc_acquisition_run a
      where a.completeness_state = 'SUCCESS_COMPLETE'
        and a.advanced_observations
        and coalesce(a.source_contract->>'release_mode', 'whole') <> 'incremental'
      order by a.source_key, a.distribution_key, a.run_seq desc
    )
    or (r.completeness_state = 'SUCCESS_COMPLETE'
        and r.advanced_observations
        and r.source_contract->>'release_mode' = 'incremental'
        -- a later document of the same distribution that names this observation supersedes it;
        -- nothing is deleted and nothing is inferred from absence
        and not exists (
          select 1 from public.dc_source_observation s
            join public.dc_acquisition_run sr on sr.id = s.acquisition_run_id
           where s.source_key = o.source_key and s.distribution_key = o.distribution_key
             and sr.completeness_state = 'SUCCESS_COMPLETE' and sr.advanced_observations
             and jsonb_typeof(s.raw_payload->'supersedes') = 'array'
             and s.raw_payload->'supersedes' ? o.home_signal_observation_id::text))
  );

comment on view public.dc_current_observation is
'STEP 3A. The current eligible observation set: latest SUCCESS_COMPLETE + advanced_observations
run per (source_key, distribution_key); for an incremental-release run (official documents) every
advanced complete run, minus observations a later one supersedes. Only map-admitted distributions
(dc_source_map_admitted, G3). Read-only over the frozen Step-2A evidence plane.';
revoke all on public.dc_current_observation from anon, authenticated;

-- ── 4–6. SPLICES INTO THE LIVE RESOLVER, CLASSIFIER AND ADJUDICATOR ───────────────────────────
do $mig$
declare
  def text;
  n   int;
  a   text;
  b   text;
begin
  -- ---- 4. dc_resolve_canonical: the history path keeps only admitted distributions ------------
  def := pg_get_functiondef('public.dc_resolve_canonical(boolean, boolean)'::regprocedure);
  if position('public.dc_source_map_admitted(o.source_key, o.distribution_key)' in def) = 0 then
  a := $a$     where p_include_history
        or o.home_signal_observation_id in (
              select c.home_signal_observation_id from public.dc_current_observation c);$a$;
  b := $b$     where (p_include_history
        or o.home_signal_observation_id in (
              select c.home_signal_observation_id from public.dc_current_observation c))
       -- G3 (official-document design §4.1): a distribution not admitted to the map reaches no
       -- canonical decision, current or historical
       and public.dc_source_map_admitted(o.source_key, o.distribution_key);$b$;
  n := (length(def) - length(replace(def, a, ''))) / length(a);
  if n <> 1 then raise exception 'resolver anchor appears % times', n; end if;
  execute replace(def, a, b);
  end if;
  if position('public.dc_source_map_admitted(o.source_key, o.distribution_key)'
              in pg_get_functiondef('public.dc_resolve_canonical(boolean, boolean)'::regprocedure)) = 0 then
    raise exception 'resolver splice did not land';
  end if;

  -- ---- 5. dc_classify_observation: the official_documents branch ---------------------------------
  def := pg_get_functiondef('public.dc_classify_observation(text, text, text, jsonb)'::regprocedure);
  if position('OFFICIAL_DOC_SHARED_TERM_RULE_SITE_USE' in def) = 0 then
  a := $a$    else
        return query select 'CLASSIFICATION_UNRESOLVED'::text,
            'UNKNOWN_SOURCE'::text,$a$;
  b := $b$    elsif p_source_key = 'official_documents' then
        -- The deterministic checker (PR 3) decided the class from a passage it re-found verbatim on its
        -- page of the archived bytes, using the ONE data-center term rule shared with Map 1
        -- (lib/project-type.js namesDataCenter). This branch reads that decision and refuses it unless
        -- the evidence the class needs is on the record. It never reads a name.
        v_conf := p_payload->'checker'->>'classification';
        if coalesce(p_payload->'checker'->>'checker_version', '') = ''
           or coalesce(p_payload->'passage'->>'quote', '') = ''
           or coalesce(p_payload->'passage'->>'document_sha256', '') !~ '^[a-f0-9]{64}$'
           or coalesce(p_payload->'passage'->>'page', '') !~ '^[1-9][0-9]*$' then
            return query select 'CLASSIFICATION_UNRESOLVED'::text, 'OFFICIAL_DOC_EVIDENCE_INCOMPLETE'::text,
                jsonb_build_object('why', 'no checker version, re-found quote, document hash or page; fail closed');
        elsif v_conf = 'CONFIRMED_DC' then
            if coalesce(p_payload->'checker'->>'source_term', '') = ''
               or coalesce(p_payload->'checker'->>'site_identified', '') <> 'true' then
                return query select 'DC_CANDIDATE'::text, 'OFFICIAL_DOC_SITE_NOT_IDENTIFIED'::text,
                    jsonb_build_object('source_term', p_payload->'checker'->>'source_term',
                        'why', 'a data-center use needs a stated term AND an identified site or project; held');
            else
                return query select 'CONFIRMED_DC'::text, 'OFFICIAL_DOC_SHARED_TERM_RULE_SITE_USE'::text,
                    jsonb_build_object('source_term', p_payload->'checker'->>'source_term',
                        'document_type', p_payload->>'document_type',
                        'checker_version', p_payload->'checker'->>'checker_version',
                        'term_rule_site_commit', p_payload->'checker'->>'term_rule_site_commit');
            end if;
        elsif v_conf = 'DC_CANDIDATE' then
            return query select 'DC_CANDIDATE'::text, 'OFFICIAL_DOC_HELD'::text,
                jsonb_build_object('why', coalesce(p_payload->'checker'->>'why', 'held by the checker'));
        elsif v_conf = 'NON_DC' then
            return query select 'NON_DC'::text, 'OFFICIAL_DOC_NOT_A_DATA_CENTER'::text,
                jsonb_build_object('source_term', p_payload->'checker'->>'source_term',
                    'why', 'its own subject is power, water, air or another facility; a link never retypes it');
        else
            -- NOT_A_PROJECT (definitions, use tables, moratoria, policy) is never stored by the writer;
            -- anything here that is not one of the three classes above fails closed
            return query select 'CLASSIFICATION_UNRESOLVED'::text, 'OFFICIAL_DOC_UNKNOWN_CLASS'::text,
                jsonb_build_object('checker_classification', v_conf, 'why', 'not a stored class; fail closed');
        end if;

    else
        return query select 'CLASSIFICATION_UNRESOLVED'::text,
            'UNKNOWN_SOURCE'::text,$b$;
  n := (length(def) - length(replace(def, a, ''))) / length(a);
  if n <> 1 then raise exception 'classifier anchor appears % times', n; end if;
  execute replace(def, a, b);
  end if;
  if position('OFFICIAL_DOC_SHARED_TERM_RULE_SITE_USE'
              in pg_get_functiondef('public.dc_classify_observation(text, text, text, jsonb)'::regprocedure)) = 0 then
    raise exception 'classifier splice did not land';
  end if;

  -- ---- 6c. dc_site_address: a document's own structured site address ---------------------------
  -- The checker writes the site address the document states, in the Atlas shape, on
  -- source_native_address. With it the existing A4 rule (same unique site address, both data centres,
  -- every guard) can tie a document about an existing facility to that facility; nothing else can.
  def := pg_get_functiondef('public.dc_site_address(text, text, jsonb, jsonb)'::regprocedure);
  if position('OFFICIAL_DOC_STATED_SITE_ADDRESS' in def) = 0 then
  a := $a$    return query select null::text, null::text, null::text, 'NO_SITE_ADDRESS_RULE'::text;$a$;
  b := $b$    if p_source_key = 'official_documents' then
        -- the site address the document itself states (official-document design §3.7)
        return query select public.dc_normalize_street(p_native_address->>'street'),
                            nullif(upper(btrim(p_native_address->>'state')), ''),
                            nullif(left(btrim(coalesce(p_native_address->>'postalCode', '')), 5), ''),
                            'OFFICIAL_DOC_STATED_SITE_ADDRESS'::text;
        return;
    end if;
    return query select null::text, null::text, null::text, 'NO_SITE_ADDRESS_RULE'::text;$b$;
  n := (length(def) - length(replace(def, a, ''))) / length(a);
  if n <> 1 then raise exception 'site address anchor appears % times', n; end if;
  execute replace(def, a, b);
  end if;
  if position('OFFICIAL_DOC_STATED_SITE_ADDRESS'
              in pg_get_functiondef('public.dc_site_address(text, text, jsonb, jsonb)'::regprocedure)) = 0 then
    raise exception 'site address splice did not land';
  end if;

  -- ---- 6b. dc_identity_candidate K5: scoped keys surface a pair ---------------------------------
  def := pg_get_viewdef('public.dc_identity_candidate'::regclass, true);
  if position('SCOPED_KEY' in def) > 0 then
    raise notice 'K5 already present';
  else
    execute 'create or replace view public.dc_identity_candidate with (security_invoker = true) as '
         || rtrim(rtrim(def), ';')
         || $k5$
UNION ALL
 SELECT LEAST(x.home_signal_observation_id, y.home_signal_observation_id) AS observation_a,
    GREATEST(x.home_signal_observation_id, y.home_signal_observation_id) AS observation_b,
    'SCOPED_KEY'::text AS candidate_rule_key,
    jsonb_build_object('scoped_key', kx.k, 'a_source', x.source_key, 'b_source', y.source_key) AS candidate_evidence
   FROM public.dc_current_observation x
     CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(x.raw_payload -> 'scoped_keys') = 'array' THEN x.raw_payload -> 'scoped_keys'
              ELSE '[]'::jsonb END) kx(k)
     JOIN public.dc_current_observation y ON y.home_signal_observation_id > x.home_signal_observation_id
     CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(y.raw_payload -> 'scoped_keys') = 'array' THEN y.raw_payload -> 'scoped_keys'
              ELSE '[]'::jsonb END) ky(k)
  WHERE ky.k = kx.k
    AND kx.k ~ '^(case|parcel):[a-z0-9-]+:[^[:space:]]+$'$k5$;
    revoke all on public.dc_identity_candidate from anon, authenticated;
  end if;
  if position('SCOPED_KEY' in pg_get_viewdef('public.dc_identity_candidate'::regclass, true)) = 0 then
    raise exception 'candidate splice did not land';
  end if;
end
$mig$;

-- ── 7. OPEN ACTIONS: the reader behind "Expansion proposed" ───────────────────────────────────
-- An action is a government step the documents state about a facility (a hearing, an application, an
-- expansion, an alteration, a change of use). The checker writes each one on the observation in the
-- agency's own words (raw_payload->'actions'), with a normalized state. This reader returns the OPEN ones.
-- Contract agreed with the Map 1 project-link session (design §3.9):
--   keyed on the live canonical_entity_id (Map 1's dc:<id>); a merged entity's actions return under the
--   entity asked about via superseded_by; nat:/n5: records have no entity and simply return nothing;
--   Map 1 only reads it, and its stage, colour and counts never change from it.
create or replace function public.dc_entity_open_actions(p_entities uuid[])
returns table(canonical_entity_id uuid, action_kind text, action_status text, action_date date,
              document_url text, document_sha256 text, page integer, home_signal_observation_id uuid)
language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  with recursive asked(asked_id, cur, depth) as (
      select q.id, q.id, 0 from unnest(p_entities) q(id)
    union all
      select a.asked_id, e.superseded_by, a.depth + 1
        from asked a join public.dc_canonical_entity e on e.canonical_entity_id = a.cur
       where e.superseded_by is not null and a.depth < 20
  ), survivor as (
      select distinct on (asked_id) asked_id, cur from asked order by asked_id, depth desc
  )
  select s.asked_id, x->>'action_kind', x->>'status_text',
         case when x->>'action_date' ~ '^\d{4}-\d{2}-\d{2}$' then (x->>'action_date')::date end,
         x->>'document_url', x->>'document_sha256',
         case when x->>'page' ~ '^[1-9][0-9]*$' then (x->>'page')::int end,
         c.home_signal_observation_id
    from survivor s
    join public.dc_entity_observation eo on eo.canonical_entity_id = s.cur
    join public.dc_current_observation c on c.home_signal_observation_id = eo.home_signal_observation_id
   cross join lateral jsonb_array_elements(case when jsonb_typeof(c.raw_payload->'actions') = 'array'
                                                then c.raw_payload->'actions' else '[]'::jsonb end) x
   where c.source_key = 'official_documents'
     and x->>'state' = 'open'
     and coalesce(x->>'action_kind', '') <> ''
   order by s.asked_id, 4 desc nulls last, 2
$fn$;
revoke all on function public.dc_entity_open_actions(uuid[]) from public, anon, authenticated;
grant execute on function public.dc_entity_open_actions(uuid[]) to service_role;
comment on function public.dc_entity_open_actions(uuid[]) is
'Open government actions (agency words) on canonical data-center entities, from admitted official
documents. Read-only for Map 1 badges and filters; it never changes a lifecycle, colour or count.';

-- One call per ZIP page: the open actions of every canonical pin map1_dc_zip_members draws there.
create or replace function public.dc_zip_open_actions(p_zip text)
returns table(canonical_entity_id uuid, action_kind text, action_status text, action_date date,
              document_url text, document_sha256 text, page integer, home_signal_observation_id uuid)
language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select a.* from public.dc_entity_open_actions(
           array(select m.canonical_entity_id from public.map1_dc_zip_members(p_zip) m
                  where m.canonical_entity_id is not null)) a
$fn$;
revoke all on function public.dc_zip_open_actions(text) from public, anon, authenticated;
grant execute on function public.dc_zip_open_actions(text) to service_role;

-- ── 8. KILL SWITCH AND ROLLBACK (design §4.2, §4.3) ──────────────────────────────────────────
-- The policy actor: the uuid automatic publication would act as. It has no development_reviewer row until
-- the founder approves auto-publication (G4), so today it can publish nothing.
create or replace function public.official_documents_policy_actor()
returns uuid language sql immutable as $fn$ select '00000000-0000-4000-8000-0000000000d0'::uuid $fn$;

-- One statement closes everything this source exposes, in the database. It returns what it did; the
-- caller (official-documents-exposure.yml, PR 5) then runs the freshness build and the read-only verifier.
create or replace function public.official_documents_exposure_off(p_reason text, p_actor text default 'service_role')
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare
  v_all    boolean := p_reason ~* '^all:';
  v_gated  text[];
  v_pages  text[] := '{}';
  v_listed text[] := '{}';
  v_docs   uuid[] := '{}';
  v_prev   jsonb;
  v_res    jsonb;
  v_id     bigint;
  g        record;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('official-documents-exposure', 0));

  -- the state being replaced, so a rollback restores it exactly
  select jsonb_object_agg(k, public.official_document_gate_open(split_part(k, '|', 1), split_part(k, '|', 2)))
    into v_prev
    from (select 'G3_MAP_ADMISSION|' || source_key || '/' || distribution_key k from public.dc_source_admission_gate
          union all select 'G4_AUTO_PUBLISH|official_documents') z;

  -- 2. pages: the policy actor's published pages are withdrawn; a reviewer's are listed, and withdrawn only
  --    when the reason begins "all:". A page belongs to this source when it links an entity that carries an
  --    official-documents observation.
  if to_regclass('public.development_project') is not null then
    select coalesce(array_agg(p.project_key order by p.project_key collate "C"), '{}') into v_pages
      from public.development_project p
     where p.page_state = 'published' and p.created_by = public.official_documents_policy_actor();
    if to_regclass('public.development_project_link') is not null then
      select coalesce(array_agg(distinct p.project_key), '{}') into v_listed
        from public.development_project p
        join public.development_project_link l on l.project_id = p.project_id
        join public.dc_entity_observation eo on l.object_kind = 'dc_entity'
                                            and eo.canonical_entity_id::text = l.object_ref
       where p.page_state = 'published' and p.created_by <> public.official_documents_policy_actor()
         and l.link_state = 'approved' and eo.source_key = 'official_documents';
    end if;
    update public.development_project set page_state = 'withdrawn'
     where page_state = 'published'
       and (project_key = any (v_pages) or (v_all and project_key = any (v_listed)));
  end if;

  -- 3. pending document proposals this source made in Map 1's document store are rejected
  if to_regclass('public.map1_project_document') is not null then
    select coalesce(array_agg(d.document_id), '{}') into v_docs
      from public.map1_project_document d
     where d.proposed_by like 'official_documents:%'
       and public.map1_project_document_current(d.document_id) = 'pending';
    insert into public.map1_project_document_decision (document_id, decision, reason, decided_by)
    select unnest(v_docs), 'rejected', 'official documents exposure off: ' || left(p_reason, 400),
           'official_documents:exposure_off';
  end if;

  -- 1. close every gate this source opens (one decision per gate, the effects on the G4 row)
  for g in select source_key || '/' || distribution_key scope from public.dc_source_admission_gate loop
    insert into public.official_document_gate_decision (gate, scope_key, is_open, actor, policy_version, reason)
    values ('G3_MAP_ADMISSION', g.scope, false, p_actor, 'exposure-off-1', p_reason);
  end loop;
  insert into public.official_document_gate_decision (gate, scope_key, is_open, actor, policy_version, reason, effects)
  values ('G4_AUTO_PUBLISH', 'official_documents', false, p_actor, 'exposure-off-1', p_reason,
          jsonb_build_object('previous_gates', v_prev,
                             'withdrawn_pages', to_jsonb(v_pages || case when v_all then v_listed else '{}'::text[] end),
                             'reviewer_pages_listed', to_jsonb(v_listed),
                             'rejected_document_proposals', to_jsonb(v_docs)))
  returning decision_id into v_id;

  -- 4. the resolvers run now, in this transaction, so an entity admitted only through this source leaves
  --    the map at commit rather than at the next hourly run
  v_res := jsonb_build_object(
    'canonical', public.dc_resolve_serialized('canonical'),
    'geography', public.dc_resolve_serialized('geography'));

  return jsonb_build_object('decision_id', v_id, 'gates_closed', true, 'resolved', v_res,
    'withdrawn_pages', to_jsonb(v_pages || case when v_all then v_listed else '{}'::text[] end),
    'reviewer_pages_listed', to_jsonb(v_listed), 'rejected_document_proposals', to_jsonb(v_docs),
    'next', 'dispatch the pages.yml freshness build, then verify-official-documents-exposure.yml');
end $fn$;
revoke all on function public.official_documents_exposure_off(text, text) from public, anon, authenticated;
grant execute on function public.official_documents_exposure_off(text, text) to service_role;

-- Rollback: re-apply the state an exposure-off decision replaced (gates, and pages it withdrew). Rejected
-- document proposals stay rejected: a rejected document is re-approved by a person, never by a job.
create or replace function public.official_documents_exposure_restore(p_decision_id bigint, p_reason text,
                                                                      p_actor text default 'service_role')
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare
  d      public.official_document_gate_decision%rowtype;
  k      text;
  v      jsonb;
  v_res  jsonb;
  v_pages text[] := '{}';
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('official-documents-exposure', 0));
  select * into d from public.official_document_gate_decision where decision_id = p_decision_id;
  if not found or d.gate <> 'G4_AUTO_PUBLISH' or d.policy_version <> 'exposure-off-1'
     or not (d.effects ? 'previous_gates') then
    raise exception 'decision % is not an exposure-off decision', p_decision_id using errcode = '22023';
  end if;
  if exists (select 1 from public.official_document_gate_decision r where r.reverses = p_decision_id) then
    raise exception 'decision % was already restored', p_decision_id using errcode = '55000';
  end if;
  if exists (select 1 from public.official_document_gate_decision l
              where l.decision_id > p_decision_id and l.gate in ('G3_MAP_ADMISSION', 'G4_AUTO_PUBLISH')) then
    raise exception 'a later gate decision exists; restore the newest change first' using errcode = '55000';
  end if;

  for k, v in select * from jsonb_each(d.effects->'previous_gates') loop
    if k <> 'G4_AUTO_PUBLISH|official_documents' then
      insert into public.official_document_gate_decision (gate, scope_key, is_open, actor, policy_version, reason, reverses)
      values (split_part(k, '|', 1), split_part(k, '|', 2), (v)::text::boolean, p_actor, 'exposure-restore-1',
              p_reason, p_decision_id);
    end if;
  end loop;

  if to_regclass('public.development_project') is not null then
    select coalesce(array_agg(x), '{}') into v_pages from jsonb_array_elements_text(d.effects->'withdrawn_pages') x;
    update public.development_project set page_state = 'published'
     where page_state = 'withdrawn' and project_key = any (v_pages);
  end if;

  insert into public.official_document_gate_decision (gate, scope_key, is_open, actor, policy_version, reason, reverses, effects)
  values ('G4_AUTO_PUBLISH', 'official_documents',
          coalesce((d.effects->'previous_gates'->>'G4_AUTO_PUBLISH|official_documents')::boolean, false),
          p_actor, 'exposure-restore-1', p_reason, p_decision_id,
          jsonb_build_object('republished_pages', to_jsonb(v_pages)));

  v_res := jsonb_build_object(
    'canonical', public.dc_resolve_serialized('canonical'),
    'geography', public.dc_resolve_serialized('geography'));
  return jsonb_build_object('restored', p_decision_id, 'republished_pages', to_jsonb(v_pages), 'resolved', v_res,
    'next', 'dispatch the pages.yml freshness build, then verify-official-documents-exposure.yml');
end $fn$;
revoke all on function public.official_documents_exposure_restore(bigint, text, text) from public, anon, authenticated;
grant execute on function public.official_documents_exposure_restore(bigint, text, text) to service_role;

-- ── NOTHING WAS OPENED ───────────────────────────────────────────────────────────────────────
do $chk$
begin
  if exists (select 1 from public.dc_source_admission_gate g
              where public.dc_source_map_admitted(g.source_key, g.distribution_key)) then
    raise exception 'a gated distribution is admitted at apply time; opening G3 is a separate, reviewed change';
  end if;
  if public.official_document_gate_open('G4_AUTO_PUBLISH', 'official_documents') then
    raise exception 'auto-publish is open at apply time; it is a separate, approved change';
  end if;
end
$chk$;

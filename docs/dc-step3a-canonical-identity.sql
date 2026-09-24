-- STEP 3A — CANONICAL DATA-CENTER IDENTITY AND CLASSIFICATION.
-- DDL OF RECORD for project qwnnmljucajnexpxdgxr.
--
-- WHAT THIS IS
--   Step 2A/2B built the EVIDENCE plane: dc_source, dc_acquisition_run, dc_source_observation,
--   written by exactly one authorized writer (homesignal-ingest dc_evidence_writer.py). That
--   plane holds what a PUBLISHER asserted. It holds no HomeSignal belief.
--
--   Step 3A adds the first HomeSignal belief, and only two of them:
--       WHAT REAL-WORLD THING IS THIS?      (canonical identity)
--       IS IT A DATA-CENTER ENTITY?         (canonical classification)
--
--   It does NOT decide lifecycle (Step 3A is explicitly out of scope), does NOT decide
--   geography or ZIP membership (Step 3B), and has NO resident-facing consumer (Step 3C/3D).
--
-- WHAT THIS IS NOT
--   * Not a second truth path. Nothing reads these tables today, by design.
--   * Not a parallel project universe. app_projects and resolved_projects were both examined
--     and REJECTED as owners, with reasons recorded in section 0.
--   * Not a knowledge graph, entity-resolution platform, plugin framework or ML matcher.
--
-- THE EVIDENCE PLANE IS FROZEN AND IS NOT MODIFIED HERE. This file only READS it. No
-- dc_source / dc_acquisition_run / dc_source_observation column, constraint, trigger or
-- function is altered, and no row in them is ever written or mutated by canonical resolution.
-- A canonical decision REFERENCES evidence; it never rewrites evidence into its conclusion.
--
-- =============================================================================================
-- SECTION 0 — EXISTING-ASSET REUSE DECISIONS (measured 2026-09-22, not assumed)
-- =============================================================================================
--
--   public.app_projects            REJECT as canonical DC identity owner.
--       3,231,572 rows of PERMIT/FILING records at RECORD grain, keyed by `zip` with a
--       `community_id`. Three disqualifiers, each structural rather than stylistic:
--         (a) it is ZIP-keyed, so writing a canonical entity there decides GEOGRAPHY, which
--             Step 3A is forbidden to decide;
--         (b) it is the table Map 1 and MAPS read TODAY, so writing Atlas/Epoch into it is
--             precisely the direct Atlas->Map1 / Atlas->MAPS path the mandate forbids;
--         (c) its grain is a filing, not a facility. One facility has many filings.
--
--   public.resolved_projects       REJECT as canonical DC identity owner.
--       2 rows: 'eagle-mountain' and 'stratos-box-elder'. Keyed by a HAND-WRITTEN text
--       `project_key` slug, scoped to a single `community_id`, and oriented to parcel/APN
--       lineage and water rights. It is a per-community parcel reconciliation for two bespoke
--       projects, not a national facility identity model, and a hand slug as the key is the
--       exact antipattern section 3 forbids. REUSED CONCEPTUALLY: its `aliases` and
--       `unconfirmed` modelling is the precedent for keeping an unresolved claim visible
--       instead of dropping it.
--
--   public.national_dc_records     REJECT as owner, RETAIN as a future source.
--       1,824 rows, every one source_name='OpenStreetMap', consumed by national_dc_for_zip.
--       It is a single-source import with its own classification decided at import time. It is
--       a SOURCE that belongs in the evidence plane at Step 3C, not an identity layer.
--
--   public.dc_source_observation   REUSE as the one evidence anchor.
--       Canonical linkage keys on `home_signal_observation_id` and nothing else. That column
--       is source-agnostic, so ANY future source that lands in the evidence plane is resolvable
--       by this same path with no new canonical structure.
--
-- =============================================================================================
-- SECTION 1 — THE CURRENT OBSERVATION SET
-- =============================================================================================
--
-- 🔑 THE PROBLEM THIS SOLVES IS LIVE, NOT HYPOTHETICAL. Measured 2026-09-22:
--
--     compute_atlas/facilities  run_seq 1606  SUCCESS_COMPLETE  2087 observations
--     compute_atlas/facilities  run_seq 1607  SUCCESS_COMPLETE  2087 observations
--     compute_atlas/facilities  run_seq 1609  SUCCESS_COMPLETE  2087 observations
--     epoch_ai/data_centers     run_seq 1608  SUCCESS_COMPLETE    87 observations
--                                                               ---- 6348 total
--
--   All three Atlas runs carry the IDENTICAL source_release_key '1.34.0' and the IDENTICAL
--   content_release_key '6adf5fd3...'. They observed one release three times. A resolver run
--   over "all observations" would therefore mint 6,261 Atlas entities for 2,087 real
--   facilities -- or, worse, report 4,174 CONFIRMED_MATCHes and look like an excellent
--   matching result. The evidence plane is immutable and append-only, so this only grows.
--
--   THE CONTRACT: the current eligible observation set is the observations of the run with the
--   greatest run_seq, per (source_key, distribution_key), among runs that are BOTH
--   completeness_state='SUCCESS_COMPLETE' AND advanced_observations=true.
--
--   Deterministic (run_seq is a unique sequence), total (every distribution resolves to at
--   most one run), and latest-wins (a later run carrying a NEW content_release_key is a new
--   release and must supersede). Historical runs remain historical EVIDENCE; they do not
--   become duplicate current entities.
--
--   ⚠️ DELIBERATELY NOT de-duplicated on content_release_key. Two runs of one release is not
--   the same fact as two releases with identical content, and collapsing them would make the
--   selection depend on payload equality rather than on acquisition order.

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
where r.id in (
    select distinct on (a.source_key, a.distribution_key) a.id
    from public.dc_acquisition_run a
    where a.completeness_state = 'SUCCESS_COMPLETE'
      and a.advanced_observations
    order by a.source_key, a.distribution_key, a.run_seq desc
);

comment on view public.dc_current_observation is
'STEP 3A. The current eligible observation set: latest SUCCESS_COMPLETE + advanced_observations
run per (source_key, distribution_key). Historical runs stay historical evidence and must never
become duplicate entities. Read-only over the frozen Step-2A evidence plane.';

-- =============================================================================================
-- SECTION 2 — CANONICAL CLASSIFICATION
-- =============================================================================================
--
-- Four states, and no others. CLASSIFICATION_UNRESOLVED is the fail-closed default: an
-- unrecognised source or an unrecognised source-native type is never silently a data centre
-- and never silently discarded.
--
-- 🔑 EVERY RULE READS A FIELD THE PUBLISHER ACTUALLY SET. Nothing here guesses from a name.
--    Measured vocabulary of the current set (2,174 observations):
--
--      compute_atlas source_native_type  (== raw_payload->>'facilityType' on 2087 of 2087)
--          data_center       1658
--          power_generation   235
--          crypto_mining      194
--
--      compute_atlas raw_payload->>'confidence'   -- the publisher's confidence in the RECORD
--          reported 1137 · confirmed 926 · rumored 24
--
--      compute_atlas raw_payload->>'aiClassification'  -- a SECOND, ORTHOGONAL axis
--          <null> 1570 · likely 252 · confirmed 179 · mixed_use 86
--
--      epoch_ai   source_native_type is NULL on 87 of 87. The distribution itself is the
--                 assertion: distribution_key='data_centers'.
--
-- ⛔ CRYPTO MINING IS NOT AUTOMATICALLY A DATA CENTRE, AND IS NOT AUTOMATICALLY DISCARDED.
--    Of 194 crypto_mining records, 15 carry an aiClassification of confirmed/likely/mixed_use
--    -- the publisher asserting an AI-compute dimension on a record its own facilityType calls
--    mining. Two publisher fields disagreeing about what a thing IS is a CONFLICT, so those 15
--    are DC_CANDIDATE with the conflict recorded, and the other 179 are NON_DC. Neither is
--    dropped.
--
-- ⛔ POWER GENERATION IS NOT A DATA CENTRE. All 235 carry a null aiClassification. A power
--    plant that SERVES a data centre is a power plant.
--
-- ⛔ A `rumored` RECORD DOES NOT BECOME A HOMESIGNAL CERTAINTY. 21 data_center records are
--    publisher-rumored; they are DC_CANDIDATE, not CONFIRMED_DC. Fail closed.

create or replace function public.dc_classify_observation(
    p_source_key       text,
    p_distribution_key text,
    p_native_type      text,
    p_payload          jsonb
) returns table(classification text, rule_key text, evidence jsonb)
language plpgsql
immutable
as $fn$
declare
    v_conf text;
    v_ai   text;
    v_proj text;
begin
    if p_source_key = 'compute_atlas' then
        v_conf := p_payload->>'confidence';
        v_ai   := p_payload->>'aiClassification';

        if p_native_type = 'data_center' then
            if v_conf = 'rumored' then
                return query select 'DC_CANDIDATE'::text,
                    'ATLAS_DATA_CENTER_PUBLISHER_RUMORED'::text,
                    jsonb_build_object('facilityType', p_native_type, 'confidence', v_conf,
                        'why', 'publisher states the record itself is rumored; fail closed to CANDIDATE');
            else
                return query select 'CONFIRMED_DC'::text,
                    'ATLAS_FACILITYTYPE_DATA_CENTER'::text,
                    jsonb_build_object('facilityType', p_native_type, 'confidence', v_conf,
                        'aiClassification', v_ai);
            end if;

        elsif p_native_type = 'power_generation' then
            return query select 'NON_DC'::text,
                'ATLAS_FACILITYTYPE_POWER_GENERATION'::text,
                jsonb_build_object('facilityType', p_native_type, 'confidence', v_conf,
                    'why', 'a power plant that serves a data centre is a power plant');

        elsif p_native_type = 'crypto_mining' then
            if v_ai in ('confirmed', 'likely', 'mixed_use') then
                return query select 'DC_CANDIDATE'::text,
                    'ATLAS_CRYPTO_MINING_WITH_AI_DIMENSION'::text,
                    jsonb_build_object('facilityType', p_native_type, 'aiClassification', v_ai,
                        'conflict', true,
                        'why', 'facilityType says mining, aiClassification asserts AI compute; publisher fields disagree');
            else
                return query select 'NON_DC'::text,
                    'ATLAS_FACILITYTYPE_CRYPTO_MINING'::text,
                    jsonb_build_object('facilityType', p_native_type, 'aiClassification', v_ai);
            end if;

        else
            return query select 'CLASSIFICATION_UNRESOLVED'::text,
                'ATLAS_UNKNOWN_FACILITYTYPE'::text,
                jsonb_build_object('facilityType', p_native_type,
                    'why', 'source-native type not in the measured vocabulary; fail closed');
        end if;

    elsif p_source_key = 'epoch_ai' and p_distribution_key = 'data_centers' then
        v_proj := p_payload->>'Project';
        if v_proj is not null and v_proj ilike '%#speculative%' then
            return query select 'DC_CANDIDATE'::text,
                'EPOCH_PROJECT_SPECULATIVE'::text,
                jsonb_build_object('project', v_proj,
                    'why', 'publisher tags the programme speculative; fail closed to CANDIDATE');
        else
            return query select 'CONFIRMED_DC'::text,
                'EPOCH_DISTRIBUTION_SCOPE_IS_DATA_CENTERS'::text,
                jsonb_build_object('distribution_key', p_distribution_key, 'project', v_proj,
                    'why', 'the distribution contract scopes this feed to data centres; per-record type is not published');
        end if;

    else
        return query select 'CLASSIFICATION_UNRESOLVED'::text,
            'UNKNOWN_SOURCE'::text,
            jsonb_build_object('source_key', p_source_key, 'distribution_key', p_distribution_key,
                'why', 'no classification rule for this source; fail closed');
    end if;
end;
$fn$;

comment on function public.dc_classify_observation(text, text, text, jsonb) is
'STEP 3A classification, rule version 1. Reads only fields the publisher set. Never infers a
data centre from a name. Fails closed to CLASSIFICATION_UNRESOLVED.';

-- =============================================================================================
-- SECTION 3 — CANONICAL STORAGE
-- =============================================================================================
--
-- ⛔ SOURCE IDs ARE NOT HOMESIGNAL IDs. canonical_entity_id is a HomeSignal-minted uuid.
--    An Atlas publisher id, an Epoch Name, a row ordinal, an artifact hash, a semantic
--    fingerprint, a normalized name and a lat/lon pair are EVIDENCE ATTRIBUTES. None of them
--    is ever the canonical key, and none is ever used to construct it.

create table if not exists public.dc_canonical_entity (
    canonical_entity_id      uuid primary key default gen_random_uuid(),
    entity_grain             text not null,
    classification           text not null,
    classification_conflict  boolean not null default false,
    rule_version             integer not null,
    observation_count        integer not null default 0,
    source_count             integer not null default 0,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now(),
    superseded_by            uuid references public.dc_canonical_entity(canonical_entity_id),
    supersede_reason         text,
    constraint dc_canonical_entity_grain_ck check (entity_grain in
        ('SITE', 'AGGREGATE_MULTI_SITE', 'GRAIN_UNRESOLVED')),
    constraint dc_canonical_entity_classification_ck check (classification in
        ('CONFIRMED_DC', 'DC_CANDIDATE', 'NON_DC', 'CLASSIFICATION_UNRESOLVED'))
);

comment on table public.dc_canonical_entity is
'STEP 3A. One row per real-world thing HomeSignal believes exists, minted from source evidence.
No geography, no ZIP, no lifecycle -- those are Step 3B and a later decision. superseded_by
makes a wrong merge or split repairable without destroying evidence.';

-- entity_grain, and why AGGREGATE_MULTI_SITE is a first-class state rather than a merge:
--   Atlas publishes 9 records at source_native_precision='representative_multi_site', and 3 of
--   them carry a location.multiSite note in which the PUBLISHER ITSELF says the pin is not a
--   facility -- e.g. one record aggregates three physically distinct Lumen facilities in Salt
--   Lake City and states "the listed coordinates are an illustrative city-area point, not any
--   one building." Such a record is not a site and must not be treated as one, nor split into
--   sites HomeSignal cannot individuate.

create table if not exists public.dc_entity_observation (
    canonical_entity_id           uuid not null references public.dc_canonical_entity(canonical_entity_id) on delete cascade,
    -- NOT a foreign key to dc_source_observation -- see SECTION 3A below. The reference is
    -- enforced by trigger, because an FK here pre-empts Step 2A's own TRUNCATE guard.
    home_signal_observation_id    uuid not null,
    source_key                    text not null,
    distribution_key              text not null,
    publisher_record_id           text,
    observation_classification    text not null,
    classification_rule_key       text not null,
    classification_evidence       jsonb not null,
    link_rule_key                 text not null,
    linked_at                     timestamptz not null default now(),
    primary key (canonical_entity_id, home_signal_observation_id),
    constraint dc_entity_observation_class_ck check (observation_classification in
        ('CONFIRMED_DC', 'DC_CANDIDATE', 'NON_DC', 'CLASSIFICATION_UNRESOLVED'))
);

-- An observation belongs to at most ONE canonical entity. This is what makes "nothing silently
-- disappears" and "nothing is silently double-counted" both checkable.
create unique index if not exists dc_entity_observation_one_entity_per_observation
    on public.dc_entity_observation (home_signal_observation_id);

comment on table public.dc_entity_observation is
'STEP 3A. The answer to WHICH OBSERVATIONS SUPPORT THIS ENTITY, plus the per-observation
classification and the decision that linked it. Evidence is referenced, never mutated.';

create table if not exists public.dc_identity_decision (
    decision_id        uuid primary key default gen_random_uuid(),
    observation_a      uuid not null,   -- enforced by trigger, not FK (SECTION 3A)
    observation_b      uuid not null,   -- enforced by trigger, not FK (SECTION 3A)
    decision_state     text not null,
    candidate_rule_key text not null,
    decision_rule_key  text not null,
    rule_version       integer not null,
    evidence           jsonb not null,
    decided_at         timestamptz not null default now(),
    constraint dc_identity_decision_state_ck check (decision_state in
        ('CONFIRMED_MATCH', 'CANDIDATE_MATCH', 'POSSIBLE_MATCH', 'UNRESOLVED', 'CONFIRMED_DISTINCT')),
    constraint dc_identity_decision_ordered_ck check (observation_a < observation_b)
);

create unique index if not exists dc_identity_decision_pair_rule
    on public.dc_identity_decision (observation_a, observation_b, candidate_rule_key);

comment on table public.dc_identity_decision is
'STEP 3A. Every adjudicated pair, INCLUDING CONFIRMED_DISTINCT. Recording distinctness is what
stops a later resolver re-proposing a merge that was already refused, and it is why a wrong
merge is reversible: the decision, not the evidence, is what gets corrected.';

-- ── STABLE RECORD KEYS (2026-09-24) ───────────────────────────────────────────────────────────
-- The key under which a SOURCE RECORD persists across acquisitions. It is evidence identity, not
-- canonical identity: two records never share a key, and nothing cross-source is decided here.
--   * the publisher's own record id, when the source supplies one (Atlas) -- unchanged, and in the
--     exact format A1 has always grouped on;
--   * otherwise the record's NAME, but ONLY for a source whose registry says it supplies no
--     record id AND only when that name is unique within its own acquisition run and
--     distribution. Measured 2026-09-24 for epoch_ai/data_centers: 87 / 91 / 92 names in three
--     runs, unique in every run, every earlier name present in the next. The source's own table
--     key is its Name; treating it as such is what stops a new canonical entity (and a new Map 1
--     marker id) being minted for the same Epoch record every day -- measured: 270 entities for
--     92 current records after 3 runs.
--     A rename mints a new key (fails safe: a decision is lost, nothing is merged). A name that
--     repeats inside a run is NOT a key, so epoch_ai/timelines (538 rows, 92 names) stays
--     singleton -- the rule is the uniqueness measurement, not a list of distributions;
--   * otherwise a singleton key that no other observation can ever share.
create or replace view public.dc_observation_record_key with (security_invoker = true) as
select o.home_signal_observation_id,
       case when o.publisher_record_id is not null
              then o.source_key || '|' || o.distribution_key || '|' || o.publisher_record_id
            when s.supplies_publisher_record_id is false
             and nullif(btrim(o.source_native_name), '') is not null
             and count(*) over (partition by o.source_key, o.acquisition_run_id, o.distribution_key,
                                             btrim(o.source_native_name)) = 1
              then o.source_key || '|' || o.distribution_key || '|name:' || btrim(o.source_native_name)
            else 'singleton|' || o.home_signal_observation_id::text end as record_key,
       case when o.publisher_record_id is not null then 0
            when s.supplies_publisher_record_id is false
             and nullif(btrim(o.source_native_name), '') is not null
             and count(*) over (partition by o.source_key, o.acquisition_run_id, o.distribution_key,
                                             btrim(o.source_native_name)) = 1 then 1
            else 2 end as record_key_rank   -- 0 publisher id, 1 unique name, 2 singleton
  from public.dc_source_observation o
  join public.dc_source s on s.source_key = o.source_key;

revoke all on public.dc_observation_record_key from anon, authenticated;

comment on view public.dc_observation_record_key is
'STEP 3A. Per-observation stable record key: publisher record id, else a run-unique name for a
source that supplies no id, else a singleton. Evidence identity only; never cross-source.';

-- ── SITE ADDRESS: THE ONE AUTOMATIC CROSS-SOURCE IDENTITY EVIDENCE (2026-09-24) ───────────────
-- Measured before any rule was written, over every current Epoch US record against all 2,187
-- current Atlas records (docs/dc-epoch-identity-evidence-2026-09-24.md):
--   * EXACT SITE ADDRESS (single house number + street, same stated state): 5 cross-source pairs,
--     5 the same physical facility, 0 distinct, 0 ambiguous -- INCLUDING a tenant/operator pair
--     (CoreWeave record vs Core Scientific record at one Muskogee address). It is the only
--     evidence class in the corpus that separated same from different without an error.
--   * but an address is NOT unique to a facility: 2 Epoch addresses carry two different Epoch
--     records (an expansion beside the original; two tenants of one campus), and 19 Atlas
--     addresses carry more than one Atlas record (campus buildings). So the rule requires the
--     address to be UNIQUE among the current records of EACH source.
--   * name, operator, city, ZIP, distance and numbered designations were measured and REJECTED
--     as identity evidence: e.g. "TX1" vs "TX11" (a campus and its first building, 89 m apart),
--     "Colossus 2" 3 m from "Minihard", one operator at two addresses in one city.
-- Keyed on source like dc_classify_observation; every other source has NO site-address rule and
-- therefore no automatic cross-source identity. Adding a source is adding a branch here.

-- A street line reduced to comparable form: upper case, punctuation dropped, common suffixes and
-- directionals abbreviated. NULL unless it starts with ONE house number: a range names a
-- frontage, and a road with no number names no site.
create or replace function public.dc_normalize_street(p_street text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
    with t as (
        select btrim(regexp_replace(upper(coalesce(p_street, '')), '[^A-Z0-9 ]', ' ', 'g')) s,
               coalesce(p_street, '') ~ '^\s*\d+[A-Za-z]?\s*[-–]\s*\d' is_range),
    w as (
        select array_agg(coalesce(('{"ROAD":"RD","STREET":"ST","AVENUE":"AVE","DRIVE":"DR",'
                                    '"PARKWAY":"PKWY","HIGHWAY":"HWY","BOULEVARD":"BLVD","LANE":"LN",'
                                    '"COURT":"CT","PLACE":"PL","CIRCLE":"CIR","TRAIL":"TRL","LOOP":"LP",'
                                    '"NORTH":"N","SOUTH":"S","EAST":"E","WEST":"W","NORTHEAST":"NE",'
                                    '"NORTHWEST":"NW","SOUTHEAST":"SE","SOUTHWEST":"SW"}'::jsonb) ->> x, x)
                         order by i) a, bool_or(t.is_range) is_range
          from t, regexp_split_to_table(t.s, '\s+') with ordinality u(x, i)
         where x <> '')
    select case when not w.is_range and w.a[1] ~ '^\d+[A-Z]?$' and array_length(w.a, 1) >= 2
                then array_to_string(w.a, ' ') end
      from w
$fn$;

create or replace function public.dc_site_address(p_source_key text, p_distribution_key text,
                                                  p_native_address jsonb, p_payload jsonb)
returns table(site_key text, state text, postal text, rule_key text)
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
declare
    line text;
begin
    if p_source_key = 'compute_atlas' and p_distribution_key = 'facilities' then
        -- the publisher's structured street / state / postal code
        return query select public.dc_normalize_street(p_native_address->>'street'),
                            nullif(upper(btrim(p_native_address->>'state')), ''),
                            nullif(left(btrim(coalesce(p_native_address->>'postalCode', '')), 5), ''),
                            'ATLAS_STRUCTURED_ADDRESS'::text;
        return;
    elsif p_source_key = 'epoch_ai' and p_distribution_key = 'data_centers' then
        -- the publisher's one-line address: street before the first comma, then ", ST 99999"
        line := regexp_replace(coalesce(p_payload->>'Address', ''), '\s+', ' ', 'g');
        if coalesce(p_payload->>'Country', '') <> 'United States' then
            return query select null::text, null::text, null::text, 'NOT_US'::text;
            return;
        end if;
        return query select public.dc_normalize_street(split_part(line, ',', 1)),
                            substring(line from ',\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*(?:,|$)'),
                            substring(line from ',\s*[A-Z]{2}\s+(\d{5})(?:-\d{4})?\s*(?:,|$)'),
                            'EPOCH_ADDRESS_LINE'::text;
        return;
    end if;
    return query select null::text, null::text, null::text, 'NO_SITE_ADDRESS_RULE'::text;
end;
$fn$;

-- Numbered-sibling designations in a name ("2", "II", "TX11", "DC1"), roman numerals as digits.
-- Used ONLY as a guard: two records whose names both carry designations with none in common are
-- never merged automatically ("Facility 1" vs "Facility 2"). Measured: a designation can neither
-- confirm nor refute identity on its own ("TX1" campus vs "TX11" building), so it never decides a
-- match -- it can only stop one.
create or replace function public.dc_name_designations(p_name text)
returns text[]
language sql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
    select coalesce(array_agg(distinct coalesce(('{"i":"1","ii":"2","iii":"3","iv":"4","v":"5",'
                                                  '"vi":"6","vii":"7","viii":"8","ix":"9","x":"10"}'::jsonb) ->> tok,
                                                 regexp_replace(tok, '^0+(\d)', '\1'))), '{}')
      from regexp_split_to_table(lower(coalesce(p_name, '')), '[^a-z0-9]+') tok
     where tok ~ '^(\d{1,3}|i{1,3}|iv|vi{0,3}|ix|x|v|[a-z]{1,5}\d{1,3}[a-z]?|\d{1,3}[a-z])$'
$fn$;

-- Every CURRENT observation's site address, and how many current records OF ITS OWN SOURCE share
-- it. The uniqueness is part of the evidence, so it is computed once, here, for every consumer.
create or replace view public.dc_observation_site_address with (security_invoker = true) as
select c.home_signal_observation_id, c.source_key, c.distribution_key,
       sa.site_key, sa.state, sa.postal, sa.rule_key,
       count(*) over (partition by c.source_key, c.distribution_key, sa.state, sa.site_key)
           as same_address_in_source
  from public.dc_current_observation c
  join public.dc_source_observation o on o.home_signal_observation_id = c.home_signal_observation_id
 cross join lateral public.dc_site_address(c.source_key, c.distribution_key,
                                           o.source_native_address, c.raw_payload) sa
 where sa.site_key is not null and sa.state is not null;

revoke all on public.dc_observation_site_address from anon, authenticated;

comment on view public.dc_observation_site_address is
'STEP 3A. Per current observation: the source-stated site address (house number + street, state,
postal) and how many current records of the same source share it. Automatic identity evidence.';

-- RLS: these are internal canonical tables with no resident reader. Enabled with NO anon or
-- authenticated grant, deliberately NOT the public.page_cache posture.
alter table public.dc_canonical_entity    enable row level security;
alter table public.dc_entity_observation  enable row level security;
alter table public.dc_identity_decision   enable row level security;

revoke all on public.dc_canonical_entity   from anon, authenticated;
revoke all on public.dc_entity_observation from anon, authenticated;
revoke all on public.dc_identity_decision  from anon, authenticated;

-- =============================================================================================
-- SECTION 3A — THE CANONICAL->EVIDENCE REFERENCE IS A TRIGGER, NOT A FOREIGN KEY
-- =============================================================================================
--
-- 🛑 THE FIRST VERSION OF THIS FILE USED FOREIGN KEYS, AND MY OWN POST-APPLY REGRESSION FOUND
--    THE DEFECT. An FK referencing public.dc_source_observation makes Postgres refuse TRUNCATE
--    on that table for an FK reason, which PRE-EMPTS Step 2A's own immutability guard. Measured
--    immediately after the first apply:
--
--      dc_step2a_selftest 08 TRUNCATE of observations refused
--        -> WRONG ERROR [0A000] cannot truncate a table referenced in a foreign key constraint
--           (expected to match: immutable historical evidence)
--      dc_step2a_selftest 28 TRUNCATE of the evidence tables refused  -> the same.
--
--    Step 2A went 72 -> 70 passing. **Protection was never weakened** -- TRUNCATE stayed
--    refused, arguably harder -- but a frozen guard could no longer PROVE it still guards, and
--    this repo treats that as a defect in its own right. Same shape as #1289 ("a check Postgres
--    pre-empted said WRONG ERROR, not NOT EXERCISED"), one level over.
--
-- 🔑 AND THE FK WAS GUARDING A STATE THAT CANNOT OCCUR. Probed live before changing anything:
--      DELETE on dc_source_observation -> REFUSED [P0001] "immutable historical evidence"
--      UPDATE on dc_source_observation -> REFUSED [P0001] "immutable historical evidence"
--      triggers installed: dc_source_observation_guard_trg (ROW),
--                          dc_source_observation_truncate_trg (STMT)
--    An observation can never be deleted or truncated, so an ORPHANED canonical link is
--    impossible by construction of the frozen evidence plane. The FK's only measurable effect
--    on this system was to break two of the guards that make it impossible.
--
-- ✅ THE ONE REAL THING THE FK CAUGHT IS KEPT: a resolver bug inserting a link whose uuid was
--    never an observation. That is a write-time check, and a trigger performs it without
--    creating the dependency that blocks TRUNCATE. Verified in BOTH directions after applying:
--      invented uuid -> REFUSED "canonical resolution may only reference REAL evidence"
--      real uuid     -> ACCEPTED   (so it is not a blanket deny)
--    and Step 2A returned to 72 passing.
--
-- Applied as migration 20260922154759 dc_step3a_reference_by_trigger_not_fk_20260922.

create or replace function public.dc_canonical_reference_guard()
returns trigger
language plpgsql
as $reffn$
declare
    v_missing uuid;
begin
    if tg_table_name = 'dc_entity_observation' then
        if not exists (select 1 from public.dc_source_observation o
                        where o.home_signal_observation_id = new.home_signal_observation_id) then
            v_missing := new.home_signal_observation_id;
        end if;
    else
        if not exists (select 1 from public.dc_source_observation o
                        where o.home_signal_observation_id = new.observation_a) then
            v_missing := new.observation_a;
        elsif not exists (select 1 from public.dc_source_observation o
                           where o.home_signal_observation_id = new.observation_b) then
            v_missing := new.observation_b;
        end if;
    end if;

    if v_missing is not null then
        raise exception
          'canonical resolution may only reference REAL evidence: no dc_source_observation %',
          v_missing;
    end if;
    return new;
end;
$reffn$;

drop trigger if exists dc_entity_observation_reference_trg on public.dc_entity_observation;
create trigger dc_entity_observation_reference_trg
    before insert or update on public.dc_entity_observation
    for each row execute function public.dc_canonical_reference_guard();

drop trigger if exists dc_identity_decision_reference_trg on public.dc_identity_decision;
create trigger dc_identity_decision_reference_trg
    before insert or update on public.dc_identity_decision
    for each row execute function public.dc_canonical_reference_guard();

-- ⛔ DO NOT "TIDY" THESE BACK INTO FOREIGN KEYS. Doing so silently takes Step 2A from 72 to 70
--    passing checks, and the two it breaks are the ones proving the evidence plane is immutable.

-- =============================================================================================
-- SECTION 4 — CANDIDATE GENERATION
-- =============================================================================================
--
-- A candidate rule only SURFACES a pair for adjudication. It never concludes anything.
--
-- 🔑 THREE CANDIDATE RULES WERE DESIGNED, MEASURED AGAINST PRODUCTION, AND TWO WERE DELETED.
--    Recording why, because each looks reasonable until it is run:
--
--    ⛔ NORMALIZED NAME (lowercase, strip punctuation, strip a trailing parenthetical) --
--       DELETED. It produced 18 pairs, and the parenthetical it discards is the DISCRIMINATOR:
--         "AWS New Albany (3180 Beech Road)" / "(Newton Court)" /
--         "(Beech/Miller Road Campus)" / "(2550 Beech Road)"
--       are FOUR distinct Atlas records at four addresses that this rule collapsed into one
--       name. It also collapsed "Adams Fork Energy Campus Data Center (Twisted Gun Golf Course,
--       Wharncliffe)" with "(Harless Industrial Park, Holden)" -- two sites in two towns. The
--       instrument was manufacturing the very false merges the mandate forbids.
--
--    ⛔ SHARED POSTAL CODE -- DELETED. It produced 20 pairs, every one garbage:
--         "CyrusOne NVA5 [20166]" <> "Google Arcola",  "Digital Realty IAD55 [20166]" <> the same.
--       Ashburn 20166 contains dozens of unrelated data centres. A ZIP is not an identity.
--
--    ✅ EXACT NAME (K1) and SAME OPERATOR + IDENTICAL COORDINATES (K2) are retained -- NOT
--       because they confirm anything (section 5 shows they confirm nothing) but because they
--       surface exactly the pairs a human would ask about, and answering them in writing is
--       what stops the next resolver guessing.
--
-- ⛔ NO FUZZY MATCHING RULE EXISTS HERE AND NONE MAY BE ADDED. Name similarity, trigram
--    distance, coordinate proximity and shared operator are not candidate rules in this design;
--    the first two are absent entirely and the last two appear only in K2's exact-coordinate
--    form, which section 5 then refuses to treat as identity.

-- ✅ K3 (2026-09-24) IS A DELIBERATE, NARROW AMENDMENT TO THE RULE ABOVE -- and it cannot merge.
--    A source with no coordinates (Epoch) now gains a DERIVED point from its own address
--    (docs/dc-step3d-derived-location.sql). A derived point that another source's data centre
--    already occupies is the duplicate-marker risk this layer exists to prevent. The 2026-09-24
--    probe measured it: 34 of 35 matched Epoch points have an Atlas data-centre record within
--    10 km, and many are plainly the same site under another name (Google Council Bluffs 12 m;
--    QTS Hillsboro 2 281 m; Vantage TX1 / TX11 89 m; Colossus 2 / "Minihard" 3 m). Atlas's own
--    town-centroid pins sat 3.5-6.6 km from the address of the same facility (Kuna 3.5 km,
--    Ellendale 4.6 km, Bowling Green 6.2 km, Fairwater Atlanta 6.6 km), hence 10 km, plus the
--    same state and locality for a town-centroid pin that is further out.
--    K3 SURFACES ONLY. Section 5 adjudicates it POSSIBLE_MATCH and nothing else: proximity is
--    never identity. Its effect is an automatic IDENTITY_UNRESOLVED that HOLDS the derived
--    location (dc_resolve_geography) and is recomputed from evidence every run -- no person is
--    asked. Over-recall costs a held Epoch point; under-recall costs a duplicate facility on a
--    resident's map.
create or replace view public.dc_identity_candidate with (security_invoker = true) as
with o as (
    select c.home_signal_observation_id oid, c.source_key, c.distribution_key, c.acquisition_run_id,
           c.publisher_record_id, c.source_native_name, c.source_native_type, c.source_native_operator,
           c.source_native_lat, c.source_native_lon, c.source_native_precision,
           ev.source_native_address, c.raw_payload, lower(btrim(c.source_native_name)) exact_name
    from public.dc_current_observation c
    join public.dc_source_observation ev on ev.home_signal_observation_id = c.home_signal_observation_id
)
-- K1 — byte-identical name after case-folding and trimming, and nothing else discarded.
select least(a.oid, b.oid) as observation_a,
       greatest(a.oid, b.oid) as observation_b,
       'EXACT_NAME'::text as candidate_rule_key,
       jsonb_build_object('name', a.source_native_name,
                          'a_source', a.source_key, 'b_source', b.source_key) as candidate_evidence
from o a join o b
  on a.exact_name = b.exact_name and a.oid < b.oid
 where a.exact_name is not null and a.exact_name <> ''
union all
-- K2 — same operator AND byte-identical coordinates.
select least(a.oid, b.oid), greatest(a.oid, b.oid),
       'SAME_OPERATOR_IDENTICAL_COORDS'::text,
       jsonb_build_object('operator', a.source_native_operator,
                          'lat', a.source_native_lat, 'lon', a.source_native_lon,
                          'a_precision', a.source_native_precision,
                          'b_precision', b.source_native_precision,
                          'a_name', a.source_native_name, 'b_name', b.source_native_name,
                          'a_type', a.source_native_type, 'b_type', b.source_native_type)
from o a join o b
  on a.source_native_operator = b.source_native_operator
 and a.source_native_lat = b.source_native_lat
 and a.source_native_lon = b.source_native_lon
 and a.oid < b.oid
 where a.source_native_operator is not null
   and a.source_native_lat is not null and a.source_native_lon is not null
union all
-- K3 — an ACCEPTED derived address point, and ANOTHER source's data-centre record within 10 km
--      of it or in the same state and locality. Surfaces a pair for a person; concludes nothing.
select least(d.home_signal_observation_id, t.oid), greatest(d.home_signal_observation_id, t.oid),
       'DERIVED_POINT_NEAR_OTHER_SOURCE_DC'::text,
       jsonb_build_object('derived_observation', d.home_signal_observation_id,
                          'derived_query', d.geocoder_query, 'derived_matched', d.matched_address,
                          'other_name', t.source_native_name, 'other_source', t.source_key,
                          'other_operator', t.source_native_operator,
                          'distance_m', round(ST_Distance(
                               ST_SetSRID(ST_MakePoint(d.lng, d.lat), 4326)::geography,
                               ST_SetSRID(ST_MakePoint(t.source_native_lon, t.source_native_lat), 4326)::geography)))
from public.dc_observation_derived_point d
join o t on t.source_key <> d.source_key
cross join lateral public.dc_classify_observation(t.source_key, t.distribution_key,
                                                  t.source_native_type, t.raw_payload) tc
 where d.verdict = 'ACCEPTED'
   and tc.classification in ('CONFIRMED_DC', 'DC_CANDIDATE')
   and t.source_native_lat is not null and t.source_native_lon is not null
   and ( ST_DWithin(ST_SetSRID(ST_MakePoint(d.lng, d.lat), 4326)::geography,
                    ST_SetSRID(ST_MakePoint(t.source_native_lon, t.source_native_lat), 4326)::geography,
                    10000)
      or ( nullif(upper(btrim(t.source_native_address->>'state')), '') = split_part(d.matched_address, ', ', 3)
       and nullif(upper(btrim(t.source_native_address->>'city')), '')  = split_part(d.matched_address, ', ', 2) ) )
union all
-- K4 — the SAME source-stated site address (house number + street + state) in two sources. The
--      only candidate the adjudicator can confirm automatically, and only under its guards (A4).
select least(x.home_signal_observation_id, y.home_signal_observation_id),
       greatest(x.home_signal_observation_id, y.home_signal_observation_id),
       'EXACT_SITE_ADDRESS'::text,
       jsonb_build_object('site_key', x.site_key, 'state', x.state,
                          'a_source', x.source_key, 'b_source', y.source_key)
  from public.dc_observation_site_address x
  join public.dc_observation_site_address y
    on y.site_key = x.site_key and y.state = x.state and x.source_key < y.source_key;

comment on view public.dc_identity_candidate is
'STEP 3A candidate generation. Surfaces pairs for adjudication; concludes nothing. Normalized-
name and shared-postal-code rules were measured against production and deleted -- see the
header of this section for the false merges each produced.';

-- create-or-replace DROPS reloptions and re-inherits default privileges (Step 3C view-grants fix):
-- the view above re-declares security_invoker, and the grant is revoked again here, every time.
revoke all on public.dc_identity_candidate from anon, authenticated;

-- =============================================================================================
-- SECTION 5 — ADJUDICATION
-- =============================================================================================
--
-- ⛔ THE FOLLOWING ARE NEVER SUFFICIENT FOR CONFIRMED_MATCH, AND THE DATA IS WHY:
--
--   same NAME            "Red Oak Campus" appears twice in one Atlas run, at 32.5135,-96.7282
--                        and at 32.537981,-96.804371 -- roughly five miles apart.
--
--   same OPERATOR +      14 groups / 29 observations share an operator and BYTE-IDENTICAL
--   identical COORDS     coordinates while describing different things:
--                          "Monarch Data Center" <> "Monarch Data Center On-Site Generation"
--                          "Savannah River Site AI Data Center" <> "... Energy Generation Project"
--                          "Alterra Marshall Technology & Energy Center" <> "... Gas Generation"
--                        A data centre and the power plant built to feed it share a point.
--
--   COORDINATE           Only 696 of 2,087 Atlas observations are source_native_precision
--   PROXIMITY            'exact'. 1,382 are 'approximate' and 9 are 'representative_multi_site'.
--                        All five same-type K2 pairs are approximate/approximate, so their
--                        identical coordinates are an artifact of approximation, not evidence
--                        of co-location: "Stream Chicago I (ORDA)" / "II (ORDB)" / "III (ORDC)"
--                        are three buildings sharing one approximate campus pin.
--
--   same ADDRESS         See the deleted postal-code candidate rule in section 4.
--
-- ✅ WHAT DOES CONFIRM. Exactly one rule, and it is the one that makes the entity STABLE
--    ACROSS ACQUISITIONS: the same source's same publisher_record_id observed in two different
--    runs is the same real-world thing. That is the publisher's own record identity persisting
--    over time, which is deterministic and explainable.
--
-- ✅ WHAT CONFIRMS DISTINCTNESS. Two observations from the SAME run of the SAME distribution
--    carrying DIFFERENT publisher_record_ids are two records the publisher itself asserts are
--    different. Atlas carries 2,087 distinct publisher_record_ids for 2,087 rows.
--
-- ⚠️ ATLAS <-> EPOCH CANNOT PRODUCE A CONFIRMED_MATCH ON TODAY'S EVIDENCE, AND THAT IS A
--    MEASURED FACT RATHER THAN A CHOICE. Epoch supplies NO publisher_record_id (0 of 87), NO
--    coordinates (0 of 87) and NO lifecycle status (0 of 87). Its only identity-bearing field
--    is a Name. Exactly 2 Epoch names are byte-identical to an Atlas name ("Meta Prometheus",
--    "Meta Hyperion"), and a name alone is never sufficient. So the honest ceiling for every
--    cross-source pair is CANDIDATE_MATCH.
--
-- ⚠️ AND THE GRAIN MAKES IT WORSE, WHICH IS WHY NO AMOUNT OF NAME CLEVERNESS FIXES IT. Epoch
--    publishes at CAMPUS grain and Atlas at BUILDING/SITE grain. Epoch has ONE "AWS New Albany";
--    Atlas has FOUR. There is no correct one-to-one answer to pick, and picking one would be a
--    false merge dressed as a match.

create or replace function public.dc_adjudicate_pair(
    p_observation_a uuid,
    p_observation_b uuid,
    p_candidate_rule_key text
) returns table(decision_state text, decision_rule_key text, evidence jsonb)
language plpgsql
stable
as $fn$
declare
    a record;
    b record;
    sa record;
    sb record;
    ca text;
    cb text;
    da text[];
    db text[];
    ev jsonb;
begin
    select o.home_signal_observation_id oid, o.source_key, o.distribution_key,
           o.acquisition_run_id, o.publisher_record_id, o.source_native_name,
           o.source_native_type, o.source_native_precision, o.source_native_operator, o.raw_payload
      into a
      from public.dc_source_observation o
     where o.home_signal_observation_id = p_observation_a;

    select o.home_signal_observation_id oid, o.source_key, o.distribution_key,
           o.acquisition_run_id, o.publisher_record_id, o.source_native_name,
           o.source_native_type, o.source_native_precision, o.source_native_operator, o.raw_payload
      into b
      from public.dc_source_observation o
     where o.home_signal_observation_id = p_observation_b;

    if a.oid is null or b.oid is null then
        return query select 'UNRESOLVED'::text, 'OBSERVATION_NOT_FOUND'::text,
            jsonb_build_object('why', 'one or both observations are absent; fail closed');
        return;
    end if;

    -- A1. The one confirming rule: the publisher's own record identity, persisting across runs.
    if a.source_key = b.source_key
       and a.distribution_key = b.distribution_key
       and a.publisher_record_id is not null
       and a.publisher_record_id = b.publisher_record_id then
        return query select 'CONFIRMED_MATCH'::text,
            'SAME_SOURCE_SAME_PUBLISHER_RECORD_ID'::text,
            jsonb_build_object('source_key', a.source_key,
                'publisher_record_id', a.publisher_record_id,
                'same_run', a.acquisition_run_id = b.acquisition_run_id,
                'why', 'the publisher asserts one record identity observed more than once');
        return;
    end if;

    -- A2. The publisher asserts two DIFFERENT records within one run of one distribution.
    if a.source_key = b.source_key
       and a.distribution_key = b.distribution_key
       and a.acquisition_run_id = b.acquisition_run_id
       and a.publisher_record_id is distinct from b.publisher_record_id then
        return query select 'CONFIRMED_DISTINCT'::text,
            'SAME_RUN_DIFFERENT_PUBLISHER_RECORD_ID'::text,
            jsonb_build_object('source_key', a.source_key,
                'a_publisher_record_id', a.publisher_record_id,
                'b_publisher_record_id', b.publisher_record_id,
                'a_name', a.source_native_name, 'b_name', b.source_native_name,
                'a_type', a.source_native_type, 'b_type', b.source_native_type,
                'a_precision', a.source_native_precision, 'b_precision', b.source_native_precision,
                'candidate_rule', p_candidate_rule_key,
                'why', 'one publisher, one release, two records: the publisher itself separates them');
        return;
    end if;

    -- A4. Cross-source, AUTOMATIC: the same source-stated site address, under every guard the
    --     corpus measurement showed is needed. Any failed guard is a COMPLETED automatic decision
    --     (UNRESOLVED, with the guard named) -- never a request for a person.
    if a.source_key <> b.source_key and p_candidate_rule_key = 'EXACT_SITE_ADDRESS' then
        select * into sa from public.dc_observation_site_address x where x.home_signal_observation_id = a.oid;
        select * into sb from public.dc_observation_site_address x where x.home_signal_observation_id = b.oid;
        select c.classification into ca from public.dc_classify_observation(a.source_key, a.distribution_key,
                                                                            a.source_native_type, a.raw_payload) c;
        select c.classification into cb from public.dc_classify_observation(b.source_key, b.distribution_key,
                                                                            b.source_native_type, b.raw_payload) c;
        da := public.dc_name_designations(a.source_native_name);
        db := public.dc_name_designations(b.source_native_name);
        ev := jsonb_build_object('site_key', sa.site_key, 'state', sa.state,
                  'a_postal', sa.postal, 'b_postal', sb.postal,
                  'a_same_address_in_source', sa.same_address_in_source,
                  'b_same_address_in_source', sb.same_address_in_source,
                  'a_classification', ca, 'b_classification', cb,
                  'a_name', a.source_native_name, 'b_name', b.source_native_name,
                  'a_designations', to_jsonb(da), 'b_designations', to_jsonb(db),
                  'a_operator', a.source_native_operator, 'b_operator', b.source_native_operator);
        if sa.site_key is null or sb.site_key is null or sa.site_key <> sb.site_key or sa.state <> sb.state then
            return query select 'UNRESOLVED'::text, 'EXACT_ADDRESS_NOT_CURRENT'::text,
                ev || jsonb_build_object('why', 'the address is not stated by both CURRENT records');
        elsif sa.same_address_in_source > 1 or sb.same_address_in_source > 1 then
            return query select 'UNRESOLVED'::text, 'EXACT_ADDRESS_SHARED_WITHIN_SOURCE'::text,
                ev || jsonb_build_object('why', 'a source carries more than one record at this address (a campus): the address does not single out a facility');
        elsif coalesce(ca, '') not in ('CONFIRMED_DC', 'DC_CANDIDATE') or coalesce(cb, '') not in ('CONFIRMED_DC', 'DC_CANDIDATE') then
            return query select 'UNRESOLVED'::text, 'EXACT_ADDRESS_NOT_BOTH_DATA_CENTRES'::text,
                ev || jsonb_build_object('why', 'a data centre and another kind of facility can share an address');
        elsif a.source_native_precision = 'representative_multi_site' or a.raw_payload->'location'->'multiSite' is not null
           or b.source_native_precision = 'representative_multi_site' or b.raw_payload->'location'->'multiSite' is not null then
            return query select 'UNRESOLVED'::text, 'EXACT_ADDRESS_AGGREGATE_RECORD'::text,
                ev || jsonb_build_object('why', 'a record that stands for several sites is not one facility');
        elsif sa.postal is not null and sb.postal is not null and sa.postal <> sb.postal then
            return query select 'UNRESOLVED'::text, 'EXACT_ADDRESS_POSTAL_CONFLICT'::text,
                ev || jsonb_build_object('why', 'the two records state different postal codes');
        elsif cardinality(da) > 0 and cardinality(db) > 0 and not (da && db) then
            return query select 'UNRESOLVED'::text, 'EXACT_ADDRESS_SIBLING_DESIGNATION_CONFLICT'::text,
                ev || jsonb_build_object('why', 'both names carry sibling designations and none agree ("Facility 1" vs "Facility 2")');
        else
            return query select 'CONFIRMED_MATCH'::text, 'AUTO_EXACT_SITE_ADDRESS'::text,
                ev || jsonb_build_object('why', 'both sources state the same unique site address; party names are roles and are kept per source, never compared');
        end if;
        return;
    end if;

    -- A3. Cross-source. No deterministic identity exists on today's evidence, so the ceiling is
    --     CANDIDATE. Exact name is the strongest available signal and it is still only a name.
    if a.source_key <> b.source_key then
        if p_candidate_rule_key = 'EXACT_NAME' then
            return query select 'CANDIDATE_MATCH'::text,
                'CROSS_SOURCE_EXACT_NAME_ONLY'::text,
                jsonb_build_object('name', a.source_native_name,
                    'a_source', a.source_key, 'b_source', b.source_key,
                    'grain_compatible', false,
                    'why', 'name alone is never sufficient, and the two sources publish at different grains');
            return;
        end if;
        return query select 'POSSIBLE_MATCH'::text,
            case when p_candidate_rule_key = 'DERIVED_POINT_NEAR_OTHER_SOURCE_DC'
                 then 'CROSS_SOURCE_DERIVED_POINT_NEARBY' else 'CROSS_SOURCE_WEAK_SIGNAL' end::text,
            jsonb_build_object('candidate_rule', p_candidate_rule_key,
                'why', 'surfaced by a non-identity signal; not adjudicable on current evidence');
        return;
    end if;

    -- Anything else is honestly unresolved.
    return query select 'UNRESOLVED'::text, 'NO_APPLICABLE_RULE'::text,
        jsonb_build_object('candidate_rule', p_candidate_rule_key,
            'why', 'no deterministic rule applies; fail closed rather than guess');
end;
$fn$;

comment on function public.dc_adjudicate_pair(uuid, uuid, text) is
'STEP 3A adjudication, rule version 3. AUTOMATIC. CONFIRMED_MATCH requires the publisher''s own
record identity (same source) or, cross-source, the same unique source-stated site address under
the A4 guards. Name, operator, city, ZIP, distance and derived points never confirm. Every other
outcome is a completed automatic decision. Fails closed.';

-- =============================================================================================
-- SECTION 6 — THE RESOLVER
-- =============================================================================================
--
-- Entity formation is the connected components of CONFIRMED_MATCH, and of nothing else. A
-- CANDIDATE_MATCH, a POSSIBLE_MATCH and an UNRESOLVED never merge anything; they are recorded
-- so Step 3B/3C can revisit them with parcel and geography evidence that does not exist yet.
--
-- p_apply = false is REPORT ONLY: it computes and returns the whole disposition and writes
-- nothing. That is the default, and it is how the design gate was run.

-- 🔑 WHY THERE IS NO UNION-FIND HERE, STATED AS A PROOF RATHER THAN A CONVENIENCE.
--    Entity formation is the connected components of CONFIRMED_MATCH. CONFIRMED_MATCH is
--    produced by exactly one rule (A1): equality of the tuple
--        (source_key, distribution_key, publisher_record_id).
--    Equality of a tuple is reflexive, symmetric and transitive, so its connected components
--    ARE its equivalence classes, and grouping by that tuple computes them exactly. A graph
--    traversal would return the same partition at more cost and more risk.
--    An observation with a NULL publisher_record_id can never satisfy A1, so it is always its
--    own component -- the correct conservative outcome, and the one every Epoch row takes.

-- ⚖️ RULE VERSION 2 (2026-09-24): THE PARTITION NOW HAS TWO KINDS OF EDGE, AND NO OTHER.
--   1. RECORD CONTINUITY: observations sharing a stable record key (dc_observation_record_key)
--      -- the publisher id, or a run-unique name for a source that supplies no id. Equality of
--      a key is still an equivalence relation, so grouping by it is still exact.
--   2. AUTOMATIC CROSS-SOURCE IDENTITY (rule version 3): a CONFIRMED_MATCH that THIS run's
--      adjudication of CURRENT evidence produced between two stable record keys of different
--      sources (A4, the unique exact site address). Recomputed from evidence on every run: a
--      match whose evidence disappears stops linking and the evidence splits back out; an
--      unresolved record that gains evidence merges on the next run. No person is in the loop,
--      and nothing is stored as a standing instruction.
--   Nothing else links anything. A CANDIDATE / POSSIBLE / UNRESOLVED decision merges nothing.
--
-- 🔒 WRONG-SIBLING GUARD. A matched component that would contain two records of the SAME
--    source and distribution is REFUSED as a whole: every member falls back to its own record
--    key and nothing merges. A publisher separates its own records (A2); a cross-source match
--    can never fold two of them into one facility -- a record matched to both "Minihard" and
--    "Colossus 2 (Whitehaven)" merges with neither.
--
-- ⚖️ ENTITY FOR A GROUP, deterministically, and stable across runs:
--    each existing entity is ANCHORED to the group of its best-ranked record key (publisher id
--    before name before singleton, then key order); a group's entity is the anchored entity
--    whose anchor key ranks best, then the oldest. Every other entity anchored to the same group
--    is superseded by it and its evidence relinked -- so a matched Atlas + Epoch pair keeps the
--    ATLAS entity (and its Map 1 marker id), and the one-time Epoch continuity consolidation
--    (270 run-minted entities -> one per record) is the same rule, not a special migration.
--    Evidence of a group an entity is NOT anchored to (a match whose evidence is gone, or a
--    refused component) is moved to
--    that group's entity, minting one if needed: a merge is always reversible.
create or replace function public.dc_resolve_canonical(
    p_apply           boolean default false,
    p_include_history boolean default false
) returns table(metric text, value text)
language plpgsql
as $fn$
declare
    v_rule_version constant integer := 3;
    v_entities     integer;
    v_obs          integer;
    v_classified   integer;
    v_linked       integer;
    v_newly_linked integer := 0;
    v_minted       integer := 0;
    v_reused       integer := 0;
    v_relinked     integer := 0;
    v_superseded   integer := 0;
    v_edges        integer := 0;
    v_refused      integer := 0;
begin
    drop table if exists _res_obs;
    drop table if exists _res_class;
    drop table if exists _res_decision;
    drop table if exists _res_edge;
    drop table if exists _res_comp;
    drop table if exists _res_refused;
    drop table if exists _res_key;
    drop table if exists _res_entity;
    drop table if exists _res_all;
    drop table if exists _res_anchor;
    drop table if exists _res_target;
    drop table if exists _res_new;

    -- The observation set under resolution. p_include_history is the HISTORICAL DUPLICATE TEST
    -- switch: it deliberately admits superseded runs so the resolver can be PROVEN to collapse
    -- them onto one entity instead of minting duplicates.
    create temporary table _res_obs on commit drop as
    select o.home_signal_observation_id oid, o.acquisition_run_id, o.source_key,
           o.distribution_key, o.publisher_record_id, o.source_native_name,
           o.source_native_type, o.source_native_precision, o.raw_payload,
           rk.record_key, rk.record_key_rank
      from public.dc_source_observation o
      join public.dc_observation_record_key rk
        on rk.home_signal_observation_id = o.home_signal_observation_id
     where p_include_history
        or o.home_signal_observation_id in (
              select c.home_signal_observation_id from public.dc_current_observation c);

    -- Classification, per observation, from the shipped function. One row per observation or
    -- the accounting check below fails -- a classifier that silently returns nothing would
    -- otherwise look identical to one that classified everything.
    create temporary table _res_class on commit drop as
    select r.oid, c.classification, c.rule_key, c.evidence
      from _res_obs r
      cross join lateral public.dc_classify_observation(
          r.source_key, r.distribution_key, r.source_native_type, r.raw_payload) c;

    -- Adjudicate every generated candidate pair (recorded; never a merge by itself).
    create temporary table _res_decision on commit drop as
    select k.observation_a, k.observation_b, k.candidate_rule_key,
           d.decision_state, d.decision_rule_key,
           ka.record_key record_key_a, kb.record_key record_key_b,
           ka.record_key_rank rank_a, kb.record_key_rank rank_b,
           d.evidence || jsonb_build_object('candidate_evidence', k.candidate_evidence,
                                            'source_record_keys', jsonb_build_array(ka.record_key, kb.record_key)) evidence
      from public.dc_identity_candidate k
      cross join lateral public.dc_adjudicate_pair(
          k.observation_a, k.observation_b, k.candidate_rule_key) d
      join public.dc_observation_record_key ka on ka.home_signal_observation_id = k.observation_a
      join public.dc_observation_record_key kb on kb.home_signal_observation_id = k.observation_b;

    -- Automatic cross-source edges between STABLE record keys, and their connected components.
    create temporary table _res_edge on commit drop as
    select distinct d.record_key_a a, d.record_key_b b
      from _res_decision d
     where d.decision_state = 'CONFIRMED_MATCH'
       and split_part(d.record_key_a, '|', 1) <> split_part(d.record_key_b, '|', 1)
       and d.rank_a < 2 and d.rank_b < 2;
    select count(*) into v_edges from _res_edge;

    create temporary table _res_comp on commit drop as
    with recursive adj(k, other) as (
        select a, b from _res_edge union select b, a from _res_edge
    ), walk(k, root) as (
        select k, k from adj
        union
        select j.other, w.root from walk w join adj j on j.k = w.k
    )
    select w.k as record_key, min(w.root collate "C") as comp from walk w group by w.k;

    -- 🔒 the wrong-sibling guard: two records of one source+distribution in one component
    create temporary table _res_refused on commit drop as
    select c.comp from _res_comp c
     group by c.comp
    having count(distinct split_part(c.record_key, '|', 1) || '|' || split_part(c.record_key, '|', 2))
           < count(*);
    select count(*) into v_refused from _res_refused;

    create temporary table _res_key on commit drop as
    select c.record_key,
           case when f.comp is null then c.comp else c.record_key end as group_key
      from _res_comp c left join _res_refused f on f.comp = c.comp;

    create temporary table _res_entity on commit drop as
    select r.oid, coalesce(k.group_key, r.record_key) as group_key, r.record_key, r.record_key_rank,
           case when k.group_key is not null and k.group_key <> r.record_key then 'AUTO_CONFIRMED_MATCH'
                when r.record_key_rank = 0 then 'SAME_SOURCE_SAME_PUBLISHER_RECORD_ID'
                when r.record_key_rank = 1 then 'SAME_SOURCE_SAME_NAME_UNIQUE_IN_RUN'
                else 'SINGLETON_NO_STABLE_RECORD_KEY' end as link_rule_key
      from _res_obs r left join _res_key k on k.record_key = r.record_key;

    select count(distinct group_key), count(*) into v_entities, v_obs from _res_entity;
    select count(*) into v_classified from _res_class;
    select count(*) into v_linked from (
        select group_key from _res_entity group by group_key having count(*) > 1) g;

    -- Every observation that is already linked, plus every one under resolution that is not.
    create temporary table _res_all on commit drop as
    select eo.home_signal_observation_id oid, eo.canonical_entity_id eid,
           rk.record_key, rk.record_key_rank,
           coalesce(k.group_key, rk.record_key) as group_key
      from public.dc_entity_observation eo
      join public.dc_observation_record_key rk
        on rk.home_signal_observation_id = eo.home_signal_observation_id
      left join _res_key k on k.record_key = rk.record_key
    union all
    select e.oid, null::uuid, e.record_key, e.record_key_rank, e.group_key
      from _res_entity e
     where not exists (select 1 from public.dc_entity_observation eo
                        where eo.home_signal_observation_id = e.oid);

    -- each existing entity's anchor: the group of its best-ranked record key
    create temporary table _res_anchor on commit drop as
    select distinct on (a.eid) a.eid, a.record_key anchor_key, a.record_key_rank anchor_rank,
           a.group_key anchor_group
      from _res_all a
     where a.eid is not null
     order by a.eid, a.record_key_rank, a.record_key collate "C";

    -- a group's entity: the anchored entity with the best anchor key, then the oldest
    create temporary table _res_target on commit drop as
    select distinct on (an.anchor_group) an.anchor_group group_key, an.eid target
      from _res_anchor an
      join public.dc_canonical_entity ce on ce.canonical_entity_id = an.eid
     order by an.anchor_group, an.anchor_rank, an.anchor_key collate "C", ce.created_at, an.eid;

    -- groups that still need an entity (new records; evidence split off when a match's evidence is gone)
    create temporary table _res_new on commit drop as
    select g.group_key, gen_random_uuid() canonical_entity_id
      from (select distinct group_key from _res_all) g
     where not exists (select 1 from _res_target t where t.group_key = g.group_key);
    select count(*) into v_minted from _res_new;
    select count(*) into v_reused from _res_target t
     where exists (select 1 from _res_entity e where e.group_key = t.group_key);
    select count(*) into v_relinked from _res_all a
      join _res_target t on t.group_key = a.group_key
     where a.eid is not null and a.eid <> t.target;
    select count(*) into v_superseded from _res_anchor an
      join _res_target t on t.group_key = an.anchor_group
      join public.dc_canonical_entity ce on ce.canonical_entity_id = an.eid
     where an.eid <> t.target and ce.superseded_by is distinct from t.target;

    if p_apply then
        insert into _res_target select group_key, canonical_entity_id from _res_new;

        insert into public.dc_canonical_entity
            (canonical_entity_id, entity_grain, classification, classification_conflict,
             rule_version, observation_count, source_count)
        select n.canonical_entity_id,
               -- GRAIN. The publisher's own statement is the only input. A record Atlas marks
               -- representative_multi_site, or annotates with a location.multiSite note, is NOT
               -- a site: on three of them the publisher says outright that the pin "is not a
               -- physical facility location". Such a record is held at its own grain rather
               -- than being treated as a site or split into sites we cannot individuate.
               case when bool_or(o.source_native_precision = 'representative_multi_site'
                                 or o.raw_payload->'location'->'multiSite' is not null)
                    then 'AGGREGATE_MULTI_SITE' else 'SITE' end,
               'CLASSIFICATION_UNRESOLVED', false, v_rule_version, 0, 0
          from _res_new n
          join _res_all a on a.group_key = n.group_key
          join public.dc_source_observation o on o.home_signal_observation_id = a.oid
         group by n.canonical_entity_id;

        -- relink evidence whose group's entity is another one (automatic match, continuity
        -- consolidation, or a match whose evidence is gone splitting evidence back out)
        update public.dc_entity_observation eo
           set canonical_entity_id = t.target,
               link_rule_key = case when a.group_key <> a.record_key then 'AUTO_CONFIRMED_MATCH'
                                    when a.record_key_rank = 1 then 'SAME_SOURCE_SAME_NAME_UNIQUE_IN_RUN'
                                    else eo.link_rule_key end,
               linked_at = now()
          from _res_all a
          join _res_target t on t.group_key = a.group_key
         where eo.home_signal_observation_id = a.oid
           and a.eid is not null and a.eid <> t.target;
        get diagnostics v_relinked = row_count;

        -- every other entity anchored to a group is superseded by that group's entity
        update public.dc_canonical_entity ce
           set superseded_by = t.target,
               supersede_reason = 'SAME_RECORD_GROUP: ' || an.anchor_group,
               updated_at = now()
          from _res_anchor an
          join _res_target t on t.group_key = an.anchor_group
         where ce.canonical_entity_id = an.eid
           and an.eid <> t.target
           and ce.superseded_by is distinct from t.target;
        get diagnostics v_superseded = row_count;

        insert into public.dc_entity_observation
            (canonical_entity_id, home_signal_observation_id, source_key, distribution_key,
             publisher_record_id, observation_classification, classification_rule_key,
             classification_evidence, link_rule_key)
        select t.target, o.oid, o.source_key, o.distribution_key, o.publisher_record_id,
               c.classification, c.rule_key, c.evidence, re.link_rule_key
          from _res_entity re
          join _res_obs    o on o.oid = re.oid
          join _res_class  c on c.oid = re.oid
          join _res_target t on t.group_key = re.group_key
        on conflict (home_signal_observation_id) do nothing;
        get diagnostics v_newly_linked = row_count;

        -- Counts and classification recomputed from each touched entity's OWN links, by the
        -- most-confirmed rule, so an entity can never disagree with the evidence attached to it.
        update public.dc_canonical_entity e
           set observation_count = s.n_obs,
               source_count      = s.n_src,
               classification    = s.cls,
               classification_conflict = s.conflict,
               updated_at        = now()
          from (select eo.canonical_entity_id,
                       count(*) n_obs, count(distinct eo.source_key) n_src,
                       case when bool_or(eo.observation_classification = 'CONFIRMED_DC') then 'CONFIRMED_DC'
                            when bool_or(eo.observation_classification = 'DC_CANDIDATE') then 'DC_CANDIDATE'
                            when bool_or(eo.observation_classification = 'CLASSIFICATION_UNRESOLVED')
                                 then 'CLASSIFICATION_UNRESOLVED'
                            else 'NON_DC' end cls,
                       count(distinct eo.observation_classification) > 1 conflict
                  from public.dc_entity_observation eo
                 where eo.canonical_entity_id in (select target from _res_target)
                 group by eo.canonical_entity_id) s
         where e.canonical_entity_id = s.canonical_entity_id
           and (e.observation_count, e.source_count, e.classification, e.classification_conflict)
               is distinct from (s.n_obs, s.n_src, s.cls, s.conflict);

        insert into public.dc_identity_decision
            (observation_a, observation_b, decision_state, candidate_rule_key,
             decision_rule_key, rule_version, evidence)
        select observation_a, observation_b, decision_state, candidate_rule_key,
               decision_rule_key, v_rule_version, evidence
          from _res_decision
        on conflict (observation_a, observation_b, candidate_rule_key) do update
           set decision_state    = excluded.decision_state,
               decision_rule_key = excluded.decision_rule_key,
               rule_version      = excluded.rule_version,
               evidence          = excluded.evidence,
               decided_at        = now()
         where (dc_identity_decision.decision_state, dc_identity_decision.decision_rule_key,
                dc_identity_decision.rule_version)
               is distinct from (excluded.decision_state, excluded.decision_rule_key, excluded.rule_version);
    end if;

    return query
        select 'MODE'::text, case when p_apply then 'APPLY' else 'REPORT_ONLY' end
        union all select 'INCLUDE_HISTORY', p_include_history::text
        union all select 'OBSERVATIONS_CONSIDERED', v_obs::text
        union all select 'OBSERVATIONS_CLASSIFIED', v_classified::text
        union all select 'PROPOSED_CANONICAL_ENTITIES', v_entities::text
        union all select 'MULTI_OBSERVATION_ENTITIES', v_linked::text
        union all select 'AUTO_MATCH_EDGES', v_edges::text
        union all select 'MATCH_COMPONENTS_REFUSED_SIBLING', v_refused::text
        union all select 'ENTITIES_MINTED', v_minted::text
        union all select 'GROUPS_ALREADY_ENTITIES', v_reused::text
        union all select 'OBSERVATIONS_RELINKED', v_relinked::text
        union all select 'ENTITIES_SUPERSEDED', v_superseded::text
        union all select 'OBSERVATIONS_NEWLY_LINKED',
               case when p_apply then v_newly_linked::text else 'n/a' end
        union all select 'ACCOUNTED_FOR',
               (select count(*) from _res_entity e join _res_class c on c.oid = e.oid)::text
        union all select 'OBS_' || upper(x.source_key), x.n::text
               from (select source_key, count(*) n from _res_obs group by source_key) x
        union all select 'CLASS_' || y.classification, y.n::text
               from (select classification, count(*) n from _res_class group by classification) y
        union all select 'DECISION_' || z.decision_state, z.n::text
               from (select decision_state, count(*) n from _res_decision group by decision_state) z
        union all select 'CANDIDATE_' || w.candidate_rule_key, w.n::text
               from (select candidate_rule_key, count(*) n from _res_decision
                      group by candidate_rule_key) w;
end;
$fn$;

comment on function public.dc_resolve_canonical(boolean, boolean) is
'STEP 3A resolver, rule version 3. AUTOMATIC. Default REPORT ONLY. Entities are the connected
components of stable record continuity (publisher id, or a run-unique name for a source with no
id) and of this run''s automatic cross-source CONFIRMED_MATCH decisions (A4) -- nothing else. A
matched component holding two records of one source is refused whole. Merges keep the
best-anchored entity and follow the evidence on every run.';

-- ── AUTOMATIC IDENTITY OUTCOMES (2026-09-24) ─────────────────────────────────────────────────
-- ONE definition of "does this entity still have an open cross-source identity question", read by
-- geography (a derived point may not place an entity with one) and by every report. A pair is
-- OPEN when a candidate links two DIFFERENT live data-centre entities from different sources and
-- no automatic decision separates them. Two separating decisions exist, both automatic:
--   * CONFIRMED_DISTINCT from the adjudicator (A2);
--   * EXCLUSIVITY: the two entities each already hold a stable record of the SAME source and
--     distribution, and those records differ. A publisher separates its own records (A2), so an
--     Epoch record that is automatically matched to Atlas X is not Atlas Y. Pure logic over
--     decisions already made; no signal is weighed.
-- Everything else stays OPEN -- the automatic IDENTITY_UNRESOLVED -- and is recomputed from the
-- current evidence every time this view is read. There is no queue and nothing waits for a person.
create or replace view public.dc_entity_identity_open with (security_invoker = true) as
with d as (
    select k.observation_a, k.observation_b, k.candidate_rule_key, a.decision_state, a.decision_rule_key
      from public.dc_identity_candidate k
     cross join lateral public.dc_adjudicate_pair(k.observation_a, k.observation_b, k.candidate_rule_key) a
     where a.decision_state <> 'CONFIRMED_DISTINCT'
), e as (
    select xa.canonical_entity_id ea, xb.canonical_entity_id eb,
           d.candidate_rule_key, d.decision_state, d.decision_rule_key
      from d
      join public.dc_entity_observation xa on xa.home_signal_observation_id = d.observation_a
      join public.dc_entity_observation xb on xb.home_signal_observation_id = d.observation_b
     where xa.source_key <> xb.source_key
       and xa.canonical_entity_id <> xb.canonical_entity_id
), both_dirs as (
    select ea canonical_entity_id, eb other_entity_id, candidate_rule_key, decision_state, decision_rule_key from e
    union
    select eb, ea, candidate_rule_key, decision_state, decision_rule_key from e
)
select b.canonical_entity_id, b.other_entity_id, b.candidate_rule_key, b.decision_state, b.decision_rule_key
  from both_dirs b
  join public.dc_canonical_entity me on me.canonical_entity_id = b.canonical_entity_id
  join public.dc_canonical_entity oe on oe.canonical_entity_id = b.other_entity_id
 where me.superseded_by is null
   and oe.superseded_by is null
   and oe.classification in ('CONFIRMED_DC', 'DC_CANDIDATE')
   and not exists (
        select 1
          from public.dc_entity_observation l1
          join public.dc_observation_record_key r1 on r1.home_signal_observation_id = l1.home_signal_observation_id
          join public.dc_entity_observation l2
            on l2.canonical_entity_id = b.other_entity_id
          join public.dc_observation_record_key r2 on r2.home_signal_observation_id = l2.home_signal_observation_id
         where l1.canonical_entity_id = b.canonical_entity_id
           and r1.record_key_rank < 2 and r2.record_key_rank < 2
           and split_part(r1.record_key, '|', 1) = split_part(r2.record_key, '|', 1)
           and split_part(r1.record_key, '|', 2) = split_part(r2.record_key, '|', 2)
           and r1.record_key <> r2.record_key);

revoke all on public.dc_entity_identity_open from anon, authenticated;

comment on view public.dc_entity_identity_open is
'STEP 3A. Automatic IDENTITY_UNRESOLVED, per entity: live cross-source data-centre pairs that no
automatic decision (A2 distinct, or exclusivity) separates. Recomputed on every read.';

-- Every CURRENT record's automatic identity outcome -- the receipt that no record waits for a person.
create or replace view public.dc_record_identity with (security_invoker = true) as
select c.home_signal_observation_id, c.source_key, c.distribution_key, rk.record_key,
       eo.canonical_entity_id,
       case when eo.canonical_entity_id is null then 'NOT_YET_RESOLVED'
            when exists (select 1 from public.dc_entity_observation x
                          where x.canonical_entity_id = eo.canonical_entity_id
                            and x.source_key <> c.source_key) then 'AUTO_CONFIRMED_MATCH'
            when exists (select 1 from public.dc_entity_identity_open o
                          where o.canonical_entity_id = eo.canonical_entity_id) then 'IDENTITY_UNRESOLVED'
            else 'AUTO_CONFIRMED_DISTINCT' end as identity_state
  from public.dc_current_observation c
  join public.dc_observation_record_key rk on rk.home_signal_observation_id = c.home_signal_observation_id
  left join public.dc_entity_observation eo on eo.home_signal_observation_id = c.home_signal_observation_id;

revoke all on public.dc_record_identity from anon, authenticated;

comment on view public.dc_record_identity is
'STEP 3A. Each current record''s automatic identity outcome: AUTO_CONFIRMED_MATCH,
AUTO_CONFIRMED_DISTINCT or IDENTITY_UNRESOLVED (NOT_YET_RESOLVED only until the next scheduled
resolver run). There is no state that waits for a person.';

-- ── CITATION: the source's own record URL, source-keyed (2026-09-24) ──────────────────────────
-- Map 1 cites every marker. The reader used to parse Atlas's payload shape itself, so any other
-- source's record could never carry a citation -- a source-specific rule living in the reader.
-- It lives here, keyed like dc_classify_observation, and the reader asks it.
create or replace function public.dc_record_citation(p_source_key text, p_distribution_key text,
                                                     p_payload jsonb)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
    select case
        when p_source_key = 'epoch_ai' and p_distribution_key = 'data_centers' then
            -- "Selected Sources" is markdown: "- [title](https://...)"; the first link is cited
            substring(coalesce(p_payload->>'Selected Sources', '') from '\]\((https?://[^)\s]+)\)')
        else (
            -- the default record shape (Compute Atlas, and any source that follows it): a
            -- "sources" array of {url}; the first http(s) URL, in the publisher's own order
            select x->>'url'
              from jsonb_array_elements(case when jsonb_typeof(p_payload->'sources') = 'array'
                                             then p_payload->'sources' else '[]'::jsonb end)
                   with ordinality s(x, i)
             where x->>'url' ~ '^https?://'
             order by i limit 1)
        end
$fn$;

comment on function public.dc_record_citation(text, text, jsonb) is
'STEP 3A. The first http(s) record URL the source itself cites for a record, per source. NULL when
the source cites none -- and a record with no citation does not publish.';

-- ── AUTOMATIC RESOLUTION AFTER ACQUISITION (2026-09-22) ────────────────────────────────────
-- Acquisition (ingest repo: ingest-compute-atlas.yml 09:40Z, ingest-epoch-ai.yml 10:10Z) writes
-- evidence only; nothing turned that evidence into canonical entities except a person running
-- this function by hand. The resolver is now safe to run repeatedly (above: an existing A1
-- group re-uses its entity, a second run is a no-op -- measured 0 minted / 0 newly linked on the
-- rerun), so it runs on a DB-side schedule, independent of GitHub Actions. Hourly rather than
-- chained to a run's completion: it costs ~0.25s, a manual or re-run acquisition is picked up
-- within the hour with no extra wiring, and a missed tick self-heals on the next one.
-- Current-run scope only (p_include_history = false): the history backfill is a one-time act.
do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'dc-resolve-canonical';
  perform cron.schedule('dc-resolve-canonical', '25 * * * *',
                        'select count(*) from public.dc_resolve_canonical(true, false)');
end
$cron$;

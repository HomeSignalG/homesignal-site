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
    home_signal_observation_id    uuid not null references public.dc_source_observation(home_signal_observation_id),
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
    observation_a      uuid not null references public.dc_source_observation(home_signal_observation_id),
    observation_b      uuid not null references public.dc_source_observation(home_signal_observation_id),
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

-- RLS: these are internal canonical tables with no resident reader. Enabled with NO anon or
-- authenticated grant, deliberately NOT the public.page_cache posture.
alter table public.dc_canonical_entity    enable row level security;
alter table public.dc_entity_observation  enable row level security;
alter table public.dc_identity_decision   enable row level security;

revoke all on public.dc_canonical_entity   from anon, authenticated;
revoke all on public.dc_entity_observation from anon, authenticated;
revoke all on public.dc_identity_decision  from anon, authenticated;

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

create or replace view public.dc_identity_candidate as
with o as (
    select home_signal_observation_id oid, source_key, distribution_key, acquisition_run_id,
           publisher_record_id, source_native_name, source_native_type, source_native_operator,
           source_native_lat, source_native_lon, source_native_precision,
           lower(btrim(source_native_name)) exact_name
    from public.dc_current_observation
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
   and a.source_native_lat is not null and a.source_native_lon is not null;

comment on view public.dc_identity_candidate is
'STEP 3A candidate generation. Surfaces pairs for adjudication; concludes nothing. Normalized-
name and shared-postal-code rules were measured against production and deleted -- see the
header of this section for the false merges each produced.';

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
begin
    select o.home_signal_observation_id oid, o.source_key, o.distribution_key,
           o.acquisition_run_id, o.publisher_record_id, o.source_native_name,
           o.source_native_type, o.source_native_precision
      into a
      from public.dc_source_observation o
     where o.home_signal_observation_id = p_observation_a;

    select o.home_signal_observation_id oid, o.source_key, o.distribution_key,
           o.acquisition_run_id, o.publisher_record_id, o.source_native_name,
           o.source_native_type, o.source_native_precision
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
            'CROSS_SOURCE_WEAK_SIGNAL'::text,
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
'STEP 3A adjudication, rule version 1. CONFIRMED_MATCH requires the publisher''s own record
identity. Name, operator, coordinates and address never confirm. Fails closed to UNRESOLVED.';

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

create or replace function public.dc_resolve_canonical(
    p_apply           boolean default false,
    p_include_history boolean default false
) returns table(metric text, value text)
language plpgsql
as $fn$
declare
    v_rule_version constant integer := 1;
    v_entities     integer;
    v_obs          integer;
    v_classified   integer;
    v_linked       integer;
begin
    drop table if exists _res_obs;
    drop table if exists _res_class;
    drop table if exists _res_decision;
    drop table if exists _res_entity;
    drop table if exists _res_new;

    -- The observation set under resolution. p_include_history is the HISTORICAL DUPLICATE TEST
    -- switch: it deliberately admits superseded runs so the resolver can be PROVEN to collapse
    -- them onto one entity instead of minting duplicates.
    create temporary table _res_obs on commit drop as
    select o.home_signal_observation_id oid, o.acquisition_run_id, o.source_key,
           o.distribution_key, o.publisher_record_id, o.source_native_name,
           o.source_native_type, o.source_native_precision, o.raw_payload
      from public.dc_source_observation o
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

    -- Adjudicate every generated candidate pair.
    create temporary table _res_decision on commit drop as
    select k.observation_a, k.observation_b, k.candidate_rule_key,
           d.decision_state, d.decision_rule_key,
           d.evidence || jsonb_build_object('candidate_evidence', k.candidate_evidence) evidence
      from public.dc_identity_candidate k
      cross join lateral public.dc_adjudicate_pair(
          k.observation_a, k.observation_b, k.candidate_rule_key) d;

    -- Components, by the equivalence class proven above.
    create temporary table _res_entity on commit drop as
    select r.oid,
           case when r.publisher_record_id is not null
                then r.source_key || '|' || r.distribution_key || '|' || r.publisher_record_id
                else 'singleton|' || r.oid::text end as group_key,
           case when r.publisher_record_id is not null
                then 'SAME_SOURCE_SAME_PUBLISHER_RECORD_ID'
                else 'SINGLETON_NO_PUBLISHER_RECORD_ID' end as link_rule_key
      from _res_obs r;

    select count(distinct group_key), count(*) into v_entities, v_obs from _res_entity;
    select count(*) into v_classified from _res_class;
    -- CONFIRMED_MATCH pairs implied by A1 across the set under resolution. This is the number
    -- that proves the historical-duplicate collapse actually happened rather than being assumed.
    select count(*) into v_linked from (
        select group_key from _res_entity group by group_key having count(*) > 1) g;

    if p_apply then
        create temporary table _res_new on commit drop as
        select e.group_key, gen_random_uuid() canonical_entity_id
          from (select distinct group_key from _res_entity) e
         where not exists (
               select 1
                 from public.dc_entity_observation eo
                 join _res_entity re on re.oid = eo.home_signal_observation_id
                where re.group_key = e.group_key);

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
               -- Entity classification. CONFIRMED_DC only if some observation confirms it;
               -- otherwise the most cautious state any observation asserts.
               case when bool_or(c.classification = 'CONFIRMED_DC') then 'CONFIRMED_DC'
                    when bool_or(c.classification = 'DC_CANDIDATE') then 'DC_CANDIDATE'
                    when bool_or(c.classification = 'CLASSIFICATION_UNRESOLVED')
                         then 'CLASSIFICATION_UNRESOLVED'
                    else 'NON_DC' end,
               count(distinct c.classification) > 1,
               v_rule_version, count(*), count(distinct o.source_key)
          from _res_new n
          join _res_entity re on re.group_key = n.group_key
          join _res_obs   o  on o.oid = re.oid
          join _res_class c  on c.oid = re.oid
         group by n.canonical_entity_id;

        insert into public.dc_entity_observation
            (canonical_entity_id, home_signal_observation_id, source_key, distribution_key,
             publisher_record_id, observation_classification, classification_rule_key,
             classification_evidence, link_rule_key)
        select n.canonical_entity_id, o.oid, o.source_key, o.distribution_key,
               o.publisher_record_id, c.classification, c.rule_key, c.evidence, re.link_rule_key
          from _res_new n
          join _res_entity re on re.group_key = n.group_key
          join _res_obs   o  on o.oid = re.oid
          join _res_class c  on c.oid = re.oid
        on conflict (home_signal_observation_id) do nothing;

        insert into public.dc_identity_decision
            (observation_a, observation_b, decision_state, candidate_rule_key,
             decision_rule_key, rule_version, evidence)
        select observation_a, observation_b, decision_state, candidate_rule_key,
               decision_rule_key, v_rule_version, evidence
          from _res_decision
        on conflict (observation_a, observation_b, candidate_rule_key) do nothing;
    end if;

    return query
        select 'MODE'::text, case when p_apply then 'APPLY' else 'REPORT_ONLY' end
        union all select 'INCLUDE_HISTORY', p_include_history::text
        union all select 'OBSERVATIONS_CONSIDERED', v_obs::text
        union all select 'OBSERVATIONS_CLASSIFIED', v_classified::text
        union all select 'PROPOSED_CANONICAL_ENTITIES', v_entities::text
        union all select 'MULTI_OBSERVATION_ENTITIES', v_linked::text
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
'STEP 3A resolver. Default REPORT ONLY. Entity formation is the connected components of
CONFIRMED_MATCH and nothing else, computed as the equivalence classes of
(source_key, distribution_key, publisher_record_id). p_include_history admits superseded runs so
the historical duplicate test can prove they collapse onto one entity rather than minting
duplicates.';

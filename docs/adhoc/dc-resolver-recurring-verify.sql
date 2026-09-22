-- SCRATCH, NEVER MERGE: rolled-back verification of the recurring-resolver fix (PR #1313).
-- Generated from docs/dc-step3a-canonical-identity.sql (no hand transcription). Everything,
-- including the function install, is rolled back by the final RAISE.
do $verify$
declare
  e0 bigint; l0 bigint; u0 bigint; e1 bigint; l1 bigint; u1 bigint; e2 bigint; l2 bigint;
  dup bigint; m1 jsonb; m2 jsonb;
begin
  set local statement_timeout = '120s';
  select count(*) into e0 from public.dc_canonical_entity;
  select count(*) into l0 from public.dc_entity_observation;
  select count(*) into u0 from public.dc_source_observation o where not exists
    (select 1 from public.dc_entity_observation x where x.home_signal_observation_id=o.home_signal_observation_id);

  execute $q$create or replace function public.dc_resolve_canonical(
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
    v_newly_linked integer := 0;
    v_minted       integer := 0;
    v_reused       integer := 0;
begin
    drop table if exists _res_existing;
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
        -- ⚖️ RECURRING INGEST (2026-09-22). An entity's identity outlives the run that minted
        -- it. The set under resolution is normally the CURRENT run only, so the next scheduled
        -- acquisition brings the SAME publisher records under NEW observation ids. Deciding
        -- "is this group already an entity?" from the observations in the set alone therefore
        -- minted a duplicate entity for every facility on every run (2,087 per Atlas run), and
        -- with p_include_history the new observations were never linked at all -- measured:
        -- 4,174 Atlas observations from runs 1606/1607 linked to nothing.
        -- The existing entity for a group is found across ALL linked observations, by the same
        -- A1 tuple. No new identity rule: this is the same equivalence class, remembered.
        create temporary table _res_existing on commit drop as
        select g.group_key, min(eo.canonical_entity_id::text)::uuid canonical_entity_id,
               count(distinct eo.canonical_entity_id) n_entities
          from public.dc_entity_observation eo
          join public.dc_source_observation o
            on o.home_signal_observation_id = eo.home_signal_observation_id
         cross join lateral (
               select case when o.publisher_record_id is not null
                           then o.source_key || '|' || o.distribution_key || '|' || o.publisher_record_id
                           else 'singleton|' || o.home_signal_observation_id::text end as group_key) g
         where g.group_key in (select group_key from _res_entity)
         group by g.group_key;

        -- One group, one entity. Two entities for one A1 group means identity already forked;
        -- linking more evidence to either would hide it. Fail loudly instead.
        if exists (select 1 from _res_existing where n_entities > 1) then
            raise exception 'dc_resolve_canonical: % A1 group(s) already map to more than one canonical entity; refusing to link new evidence onto a forked identity',
                (select count(*) from _res_existing where n_entities > 1);
        end if;

        create temporary table _res_new on commit drop as
        select e.group_key, gen_random_uuid() canonical_entity_id
          from (select distinct group_key from _res_entity) e
         where not exists (select 1 from _res_existing x where x.group_key = e.group_key);
        select count(*) into v_minted from _res_new;
        select count(*) into v_reused from _res_existing;

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
        select coalesce(x.canonical_entity_id, n.canonical_entity_id), o.oid, o.source_key,
               o.distribution_key, o.publisher_record_id, c.classification, c.rule_key,
               c.evidence, re.link_rule_key
          from _res_entity re
          join _res_obs   o  on o.oid = re.oid
          join _res_class c  on c.oid = re.oid
          left join _res_existing x on x.group_key = re.group_key
          left join _res_new      n on n.group_key = re.group_key
        on conflict (home_signal_observation_id) do nothing;
        get diagnostics v_newly_linked = row_count;

        -- An entity that gained evidence reports it. Counts and classification are recomputed
        -- from the entity's own links, by the SAME most-confirmed rule used at minting, so an
        -- existing entity can never disagree with the evidence now attached to it.
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
                 where eo.canonical_entity_id in (select canonical_entity_id from _res_existing)
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
        on conflict (observation_a, observation_b, candidate_rule_key) do nothing;
    end if;

    return query
        select 'MODE'::text, case when p_apply then 'APPLY' else 'REPORT_ONLY' end
        union all select 'INCLUDE_HISTORY', p_include_history::text
        union all select 'OBSERVATIONS_CONSIDERED', v_obs::text
        union all select 'OBSERVATIONS_CLASSIFIED', v_classified::text
        union all select 'PROPOSED_CANONICAL_ENTITIES', v_entities::text
        union all select 'MULTI_OBSERVATION_ENTITIES', v_linked::text
        union all select 'ENTITIES_MINTED',
               case when p_apply then v_minted::text else 'n/a' end
        union all select 'GROUPS_ALREADY_ENTITIES',
               case when p_apply then v_reused::text else 'n/a' end
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
$fn$$q$;

  -- 1. history backfill: every historical observation must attach to its EXISTING entity
  select jsonb_object_agg(metric, value) into m1 from public.dc_resolve_canonical(true, true);
  select count(*) into e1 from public.dc_canonical_entity;
  select count(*) into l1 from public.dc_entity_observation;
  select count(*) into u1 from public.dc_source_observation o where not exists
    (select 1 from public.dc_entity_observation x where x.home_signal_observation_id=o.home_signal_observation_id);

  -- 2. the scheduled shape: current-run apply again must be a no-op (idempotent)
  select jsonb_object_agg(metric, value) into m2 from public.dc_resolve_canonical(true, false);
  select count(*) into e2 from public.dc_canonical_entity;
  select count(*) into l2 from public.dc_entity_observation;

  -- 3. no A1 group maps to two entities
  select count(*) into dup from (
    select o.source_key, o.distribution_key, o.publisher_record_id
      from public.dc_entity_observation eo join public.dc_source_observation o using (home_signal_observation_id)
     where o.publisher_record_id is not null
     group by 1,2,3 having count(distinct eo.canonical_entity_id) > 1) d;

  raise exception 'VERIFY_RESULT %', jsonb_build_object(
    'entities_before', e0, 'links_before', l0, 'unlinked_before', u0,
    'entities_after_history', e1, 'links_after_history', l1, 'unlinked_after_history', u1,
    'entities_after_rerun', e2, 'links_after_rerun', l2, 'a1_groups_forked', dup,
    'metrics_history', m1, 'metrics_rerun', m2);
end
$verify$;

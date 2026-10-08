-- dc_entity_identity_open BEFORE the cross-source pre-filter (origin/main 2026-10-01; production md5 of pg_get_viewdef
-- 86ab0fcf9fa3aa5c87d08e9c5fbee3df). Generated from git, never retyped.
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

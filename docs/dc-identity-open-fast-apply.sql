-- =====================================================================================
-- THE IDENTITY-OPEN VIEW READS THE RECORD KEYS ONCE (2026-10-01) — the geography resolver's cost, removed.
--
-- THE MEASUREMENT (production, 2026-10-01, read-only one-off jobs, runs agreeing): the geography resolver took
-- 199 s of its 300 s ceiling and had grown 9 -> 7 -> 83 -> 94 -> 98 -> 101 -> 157 -> 199 s over the 17:35 runs since
-- 09-23. Timed in isolation, its evidence view took 1.5-3.0 s, the derived points 0.8 s, the record keys ~0 s, and
-- dc_entity_identity_open 192-197 s. Clearing 4,339 stale Epoch entities (see dc-epoch-timeline-key-apply.sql) moved
-- nothing, so the entities were never the cost.
--
-- WHERE THE TIME ACTUALLY GOES, SPLIT BY A SECOND SET OF PROBES (the first guess was wrong and is recorded):
--   * First guess: the adjudicator was run on ~2,340 candidate pairs and ~2,200 of them (same-source EXACT_NAME pairs of
--     epoch_ai/timelines) were then discarded. Pushing that discard BEFORE the adjudicator (145 pairs survive) changed
--     the read from 191.5 s to 191.9 s — NO speed-up. Kept anyway because it is a pure, parity-proven pushdown, but it is
--     not the cause.
--   * Cause: the exclusivity test (a per-row NOT EXISTS) reached public.dc_observation_record_key — a window-function
--     view over EVERY observation (32,170) — and re-derived it for each of the 272 surviving pairs.
--     Candidates + adjudication + filters: 15.8 s. Record keys computed once (rank < 2): 0.4 s. The whole exclusivity
--     test against those keys: 2.2 s. Same 272 rows, same md5 as the old view.
--
-- THE CHANGE. (1) the different-source / different-entity test runs before the adjudicator; (2) the record keys are
-- computed once (a MATERIALIZED CTE) and the per-row exclusivity probe reads that, instead of re-deriving the view for
-- every pair. (Written as a join instead of a probe it is far WORSE — over 900 s, measured.) Same rows, same columns, same security; the exclusivity rule itself is unchanged.
--
-- GUARDED. Refuses unless the live view is exactly the definition this replaces (md5 of pg_get_viewdef
-- 86ab0fcf9fa3aa5c87d08e9c5fbee3df, read on production 2026-10-01) or already carries the change (then a no-op).
-- The view statement below is byte-identical to the one in docs/dc-step3a-canonical-identity.sql (a test pins that).
-- docs/dc-epoch-geography-apply.sql is a frozen applied artifact and is never re-applied.
-- Decides nothing about any marker. Idempotent. Service-role only.
-- =====================================================================================

do $guard$
declare
  _def text := pg_get_viewdef('public.dc_entity_identity_open'::regclass, true);
begin
  if position('pre AS (' in _def) > 0 then
    raise notice 'identity-open change already present — nothing to change';
  elsif md5(_def) <> '86ab0fcf9fa3aa5c87d08e9c5fbee3df' then
    raise exception 'dc_entity_identity_open is not the definition this change replaces (md5 %) — refusing', md5(_def);
  end if;
end
$guard$;

create or replace view public.dc_entity_identity_open with (security_invoker = true) as
with pre as (
    -- 2026-10-01: ONLY a pair of two DIFFERENT entities from two DIFFERENT sources can ever be open, so that test
    -- runs BEFORE the adjudicator, not after it. The adjudicator is the expensive part (it builds geocode inputs
    -- per pair) and this view used to run it on every candidate and then discard the same-source ones: measured
    -- on production 2026-10-01, ~195 s of the ~199 s geography run, almost all of it on epoch_ai/timelines pairs
    -- that share a name and a source. The decision is only ever read for the pairs that survive this test.
    select k.observation_a, k.observation_b, k.candidate_rule_key,
           xa.canonical_entity_id ea, xb.canonical_entity_id eb
      from public.dc_identity_candidate k
      join public.dc_entity_observation xa on xa.home_signal_observation_id = k.observation_a
      join public.dc_entity_observation xb on xb.home_signal_observation_id = k.observation_b
     where xa.source_key <> xb.source_key
       and xa.canonical_entity_id <> xb.canonical_entity_id
), e as (
    select p.ea, p.eb, p.candidate_rule_key, a.decision_state, a.decision_rule_key
      from pre p
     cross join lateral public.dc_adjudicate_pair(p.observation_a, p.observation_b, p.candidate_rule_key) a
     where a.decision_state <> 'CONFIRMED_DISTINCT'
), both_dirs as (
    select ea canonical_entity_id, eb other_entity_id, candidate_rule_key, decision_state, decision_rule_key from e
    union
    select eb, ea, candidate_rule_key, decision_state, decision_rule_key from e
), cand as (
    select b.canonical_entity_id, b.other_entity_id, b.candidate_rule_key, b.decision_state, b.decision_rule_key
      from both_dirs b
      join public.dc_canonical_entity me on me.canonical_entity_id = b.canonical_entity_id
      join public.dc_canonical_entity oe on oe.canonical_entity_id = b.other_entity_id
     where me.superseded_by is null
       and oe.superseded_by is null
       and oe.classification in ('CONFIRMED_DC', 'DC_CANDIDATE')
), rk as materialized (
    -- 2026-10-01: the record keys are a window-function view over EVERY observation. The exclusivity test used to
    -- reach it from inside a per-row NOT EXISTS and re-derived it for each pair: measured on production, ~175 s of
    -- a ~192 s read (272 rows). Computed once here (rank < 2 only) it is 0.4 s and the whole test 2.2 s.
    -- The test stays a CORRELATED probe on purpose: written as a join over rk the planner pairs the two record-key
    -- sets before it applies the entity filter and the read exceeds 900 s (measured, probe cancelled).
    select home_signal_observation_id, record_key, record_key_rank
      from public.dc_observation_record_key
     where record_key_rank < 2
)
select c.canonical_entity_id, c.other_entity_id, c.candidate_rule_key, c.decision_state, c.decision_rule_key
  from cand c
 where not exists (
        select 1
          from public.dc_entity_observation l1
          join rk r1 on r1.home_signal_observation_id = l1.home_signal_observation_id
          join public.dc_entity_observation l2
            on l2.canonical_entity_id = c.other_entity_id
          join rk r2 on r2.home_signal_observation_id = l2.home_signal_observation_id
         where l1.canonical_entity_id = c.canonical_entity_id
           and split_part(r1.record_key, '|', 1) = split_part(r2.record_key, '|', 1)
           and split_part(r1.record_key, '|', 2) = split_part(r2.record_key, '|', 2)
           and r1.record_key <> r2.record_key);

do $post$
declare
  _def text := pg_get_viewdef('public.dc_entity_identity_open'::regclass, true);
begin
  if (length(_def) - length(replace(_def, 'pre AS (', ''))) / length('pre AS (') <> 1
     or position('dc_adjudicate_pair(p.observation_a' in _def) = 0
     or position('rk AS MATERIALIZED' in _def) = 0 then
    raise exception 'identity-open change did not take — refusing';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.dc_entity_identity_open'::regclass
                  and 'security_invoker=true' = any (reloptions)) then
    raise exception 'dc_entity_identity_open lost security_invoker — refusing';
  end if;
  if has_table_privilege('anon', 'public.dc_entity_identity_open', 'select')
     or has_table_privilege('authenticated', 'public.dc_entity_identity_open', 'select') then
    raise exception 'dc_entity_identity_open is readable by anon/authenticated — refusing';
  end if;
  if obj_description('public.dc_entity_identity_open'::regclass, 'pg_class') is null then
    raise exception 'dc_entity_identity_open lost its comment — refusing';
  end if;
end
$post$;

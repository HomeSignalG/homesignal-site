-- scripts/verify-canary-recovery.sql — READ-ONLY. Did the canary ZIP RECOVER exactly the records it should have?
-- COLLECTION IS NOT RECOVERY. scripts/verify-canary-collection.sql proves the canary's response was applied to the cache; it says
-- nothing about the ledger. This script proves the other half, by KEY SET, never by count (docs/zip-scope-bounds-runbook.md gate 2).
-- Run after: the collection gate passed, app_refresh_zip materialised the cache, and ONE ordinary ledger observation of the ZIP ran.
-- Parameters are the three lines marked <<. `expected` is the operator's INDEPENDENT list — the source_keys the polygon verdict
-- (public.zip_scope_members) says are inside the ZIP but outside the legacy scope — produced BEFORE the canary from the dry run.
--
-- PASSES only if EVERY check is true; NULL is false. Three independent derivations must agree on the same set:
--   expected (operator, pre-canary)  ==  cache_stamped (the connector's own stamps in the cache)  ==  ledger_recovered
-- and in addition:
--   c1  expected is non-empty (a zero proves nothing: an empty expectation is a FAIL, never a pass)
--   c2  the three sets are equal (missing = expected not recovered; unexpected = recovered not expected)
--   c3  none of the recovered keys was ANNOUNCED (no reportable first_detected / material event): backfill must stay silent
--   c4  every recovered key has a ledger identity
--   c5  the ZIP x source pairs that carry the recovered keys are READY (the baseline is established, so later arrivals report)
with p as (
  select '76258'::text as zip,                                  -- << the canary ZIP
         array['']::text[] as expected,                         -- << the expected recovered source_keys (independent list)
         '2026-10-11 00:00:00+00'::timestamptz as fired_after   -- << the instant the canary fire was issued
), e as (
  select distinct k from p, unnest(p.expected) k where k <> ''
), cs as (
  select distinct public.app_source_key(x.el) as k
    from public.development_reports d, p, jsonb_array_elements(d.sites) x(el)
   where d.zip = p.zip and x.el->>'scope_origin' = 'polygon_member'
     and coalesce(x.el->>'relevance','') = 'development' and coalesce(x.el->>'scope','') = 'point'
     and public.app_source_key(x.el) is not null
), lr as (
  select distinct r.identity_key as k
    from public.dev_change_recovery r, p
   where r.zip = p.zip and r.classified_at >= p.fired_after and r.outcome = 'coverage_recovered'
), diff as (
  select (select count(*) from e where k not in (select k from lr)) as missing,
         (select count(*) from lr where k not in (select k from e)) as unexpected,
         (select count(*) from e where k not in (select k from cs)) as expected_not_stamped,
         (select count(*) from cs where k not in (select k from e)) as stamped_not_expected
), chk as (
  select
    (select count(*) > 0 from e)                                                                               as c1,
    (select missing = 0 and unexpected = 0 and expected_not_stamped = 0 and stamped_not_expected = 0 from diff) as c2,
    (select count(*) = 0 from public.dev_change_event_reportable v
      where v.identity_key in (select k from lr) and v.event_type = 'first_detected' and v.material)           as c3,
    (select count(*) = (select count(*) from lr) from public.dev_change_project pr where pr.identity_key in (select k from lr)) as c4,
    coalesce((select bool_and(exists (select 1 from public.dev_change_scope_ready sr, p
                                       where sr.zip = p.zip and sr.registry_id = coalesce(pr.registry_id, '') and sr.lapsed_at is null))
                from public.dev_change_project pr where pr.identity_key in (select k from lr)), false)         as c5
)
select
  (select count(*) from e) as expected_n, (select count(*) from cs) as cache_stamped_n, (select count(*) from lr) as ledger_recovered_n,
  (select missing from diff) as missing, (select unexpected from diff) as unexpected,
  md5(coalesce((select string_agg(k, ',' order by k collate "C") from e), ''))  as expected_md5,
  md5(coalesce((select string_agg(k, ',' order by k collate "C") from lr), '')) as recovered_md5,
  chk.c1 as c1_expected_nonempty, chk.c2 as c2_three_sets_equal, chk.c3 as c3_none_announced,
  chk.c4 as c4_all_have_identity, chk.c5 as c5_pairs_ready,
  coalesce(chk.c1 and chk.c2 and chk.c3 and chk.c4 and chk.c5, false) as canary_recovered
from chk;

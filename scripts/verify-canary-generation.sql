-- scripts/verify-canary-generation.sql — READ-ONLY. Did THIS canary's response produce the ACCEPTED cache generation, and is each
-- expected source recorded as a complete read of the expanded scope?  (Requires docs/dev-source-receipt.sql to be deployed.)
-- Run through db-sql.yml after a canary refresh of ONE ZIP, after scripts/verify-canary-collection.sql. Parameters are the lines marked <<.
--
-- verify-canary-collection.sql proves the response arrived and the cache clock moved; it cannot prove THAT response produced the write
-- (it infers it from refreshed_at >= response.created). The accepted-generation trigger records the binding in the same row update:
--   g1  a dev_refresh_generation row exists for exactly this request id with outcome 'accepted' (not refused / unattributed / unreadable)
--   g2  that generation's tick IS the cache clock now (no later generation superseded it; if one did, rerun the canary — do not infer)
--   g3  every expected source has a continuity row that describes this very generation: scope 'expanded', complete, versioned
--   g4  no expected source is impaired (no open gap)
-- A canary PASSES only if every check is true. NULL is false: a missing row is a FAIL, never "unknown".
with p as (
  select '76258'::text as zip,                                  -- << the canary ZIP
         0::bigint as request_id,                               -- << the id RECORDED when the canary was fired
         array['']::text[] as expected_sources                  -- << the registry ids that must be monitored under the expanded scope
), g as (
  select x.* from public.dev_refresh_generation x, p
   where x.zip = p.zip and x.response_id = p.request_id and x.outcome = 'accepted'
), d as (
  select dr.refreshed_at from public.development_reports dr, p where dr.zip = p.zip
), chk as (
  select
    coalesce((select count(*) = 1 from g), false)                                                         as g1,
    coalesce((select g.tick_at = d.refreshed_at from g, d), false)                                        as g2,
    coalesce((select count(*) = cardinality(p.expected_sources) and cardinality(p.expected_sources) > 0
                 and bool_and(c.scope = 'expanded' and c.complete and c.scope_version is not null
                              and c.last_response_id = p.request_id and c.last_tick_at = d.refreshed_at)
                from public.dev_source_continuity c, p, d
               where c.zip = p.zip and c.registry_id = any(p.expected_sources)), false)                    as g3,
    coalesce((select count(*) = 0 from public.dev_source_continuity c, p
               where c.zip = p.zip and c.registry_id = any(p.expected_sources) and c.impaired_since is not null), false) as g4
)
select chk.g1 as g1_accepted_generation_for_this_request, chk.g2 as g2_it_is_the_current_cache,
       chk.g3 as g3_every_expected_source_complete_expanded, chk.g4 as g4_no_open_gap,
       (chk.g1 and chk.g2 and chk.g3 and chk.g4) as canary_generation_proven
from chk;

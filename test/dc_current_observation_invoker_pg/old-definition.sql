-- VERBATIM extract of docs/official-documents-map-gate.sql as merged (0ca1dd2): the statement that dropped the option.
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

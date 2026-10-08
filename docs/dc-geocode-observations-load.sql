-- dc-geocode-observations-load.sql — the ONLY write path into public.dc_address_geocode.
-- Expects pg_temp._dcg_in(j jsonb): one object per derivation, produced by
-- scripts/dc-geocode-observations.ts from HomeSignal's production geocoding ladder.
--
-- FAIL CLOSED:
--   * only a query the database CURRENTLY queues is accepted (the writer cannot choose addresses);
--   * only the current ladder version is accepted;
--   * append-only: an existing (query, ladder version) is never overwritten;
--   * NOTHING is written anywhere else -- in particular never into dc_source_observation, whose
--     coordinates are the publisher's and stay NULL for a source that published none.
insert into public.dc_address_geocode
    (geocoder_query, canonical_addr, ladder_version, provider, match_type, lat, lng,
     matched_address, provider_candidates, provider_matched_addresses, run_ref)
select j->>'geocoder_query', j->>'canonical_addr', j->>'ladder_version',
       coalesce(nullif(j->>'provider', ''), 'none'), j->>'match_type',
       (j->>'lat')::double precision, (j->>'lng')::double precision,
       j->>'matched_address', (j->>'provider_candidates')::integer,
       array(select jsonb_array_elements_text(coalesce(j->'provider_matched_addresses', '[]'::jsonb))),
       j->>'run_ref'
  from pg_temp._dcg_in
 where j->>'ladder_version' = public.dc_geocode_ladder_version()
   and j->>'geocoder_query' in (select geocoder_query from public.dc_geocode_queue)
on conflict (geocoder_query, ladder_version) do nothing;

-- receipt: what this load wrote, by match type (the control is the input count, printed by the
-- workflow before this file runs)
select match_type, count(*) as derived_this_run
  from public.dc_address_geocode
 where run_ref = (select max(j->>'run_ref') from pg_temp._dcg_in)
 group by match_type
 order by match_type;

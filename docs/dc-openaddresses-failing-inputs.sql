-- READ-ONLY input for .github/workflows/dc-openaddresses-match-preview.yml.
-- One line per data-centre address the shared geocoder ladder rejected as REJECTED_NO_MATCH, as
-- "<geocoder_query><TAB><canonical_addr>" (the ladder's own lookup key). Run under
-- default_transaction_read_only=on. Lives in docs/ because the evidence tables may be read only from
-- SQL a workflow runs, never from a script under scripts/ (the Step 2A isolation gate).
select distinct on (q.geocoder_query) q.geocoder_query || E'\t' || g.canonical_addr
  from public.dc_observation_derived_point q
  join public.dc_address_geocode g on g.geocoder_query = q.geocoder_query
 where q.verdict = 'REJECTED_NO_MATCH'
   and q.admitted
   and g.canonical_addr is not null
 order by q.geocoder_query, g.derived_at desc;

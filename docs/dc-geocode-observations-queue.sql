-- dc-geocode-observations-queue.sql — READ-ONLY export of the addresses still to be derived.
-- Run by dc-geocode-observations.yml inside a READ ONLY transaction; one JSON object per line.
-- The queue is decided in the database (docs/dc-step3d-derived-location.sql: dc_geocode_input +
-- dc_geocode_queue); the writer never chooses what to geocode.
select json_build_object('geocoder_query', q.geocoder_query,
                         'ladder_version', q.ladder_version)::text
  from public.dc_geocode_queue q
 order by q.geocoder_query collate "C";

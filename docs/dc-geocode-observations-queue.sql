-- dc-geocode-observations-queue.sql — READ-ONLY export of the addresses still to be derived.
-- Run by dc-geocode-observations.yml inside a READ ONLY transaction; one JSON object per line.
-- The queue is decided in the database (docs/dc-step3d-derived-location.sql: dc_geocode_input +
-- dc_geocode_queue); the writer never chooses what to geocode.
--
-- RESUMABLE, DETERMINISTIC BATCHES (2026-09-24). psql variable dcg_batch (a positive integer) caps
-- one run; unset means the whole queue. The order is total and stable -- ADMITTED work first (a
-- derivation a decision is waiting for), then the address text under collation "C" -- and a loaded
-- derivation leaves the queue, so the next run takes exactly the next slice. Nothing is consumed
-- partially: a batch is loaded in ONE transaction by dc-geocode-observations-load.sql, or not at all.
-- An address not yet derived is ABSENT evidence, which never removes a publisher point, so a queue
-- that takes several days to drain can delay a validation but can never black out a facility.
--
-- DEPLOYMENT-ORDER SAFE: before docs/dc-atlas-validation-apply.sql reaches the database, its queue view
-- has no `admitted` column (every queued address was then admitted by construction: only Epoch had an
-- address rule). The file reads the catalog and orders on the column only where it exists, so the
-- scheduled writer works on either side of the apply.
\if :{?dcg_batch}
\else
\set dcg_batch ALL
\endif
select exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'dc_geocode_queue'
                  and column_name = 'admitted') as dcg_has_admitted \gset
\if :dcg_has_admitted
select json_build_object('geocoder_query', q.geocoder_query,
                         'ladder_version', q.ladder_version)::text
  from public.dc_geocode_queue q
 order by (not q.admitted), q.geocoder_query collate "C"
 limit :dcg_batch;
\else
select json_build_object('geocoder_query', q.geocoder_query,
                         'ladder_version', q.ladder_version)::text
  from public.dc_geocode_queue q
 order by q.geocoder_query collate "C"
 limit :dcg_batch;
\endif

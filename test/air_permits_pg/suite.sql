-- Air permits & filings suite. Every row: name|t-or-f|detail. Any '|f|' fails the run.
-- ALL RECORDS BELOW ARE FIXTURES in a disposable database. The 185303 / 414660 record is a REGRESSION FIXTURE built from
-- the identifiers in the task brief (its location is a reviewed-point stand-in); it is not production evidence.
\set ON_ERROR_STOP 1
create temp table ck (n serial, name text, ok boolean, detail text);
create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into ck (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;
create or replace function pg_temp.raises(p_sql text, p_code text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlstate = p_code; end $$;

-- A. a BLOCKED authority cannot write and never reads as "no permits"
select pg_temp.ck('tx source registered blocked', (select access_status = 'blocked' from public.air_permit_sources where source = 'tx_tceq_nsr'));
select pg_temp.ck('blocked source cannot ingest (55000)',
  pg_temp.raises($$select public.air_permits_ingest('tx_tceq_nsr', '[]'::jsonb, true)$$, '55000'));
select pg_temp.ck('unknown source refused (22023)', pg_temp.raises($$select public.air_permits_ingest('nope', '[]'::jsonb, true)$$, '22023'));
select pg_temp.ck('reader: blocked state says blocked, with its reason, and no records',
  (select r ->> 'status' = 'blocked' and (r ->> 'blocked_note') ilike '%robots%' and r -> 'records' = '[]'::jsonb and r ->> 'agency' is not null
     from (select public.air_permits_for_zip('78521') r) x));
select pg_temp.ck('reader: a state nobody checked is not_covered, never complete',
  (select public.air_permits_for_zip('33301') ->> 'status' = 'not_covered'));
select pg_temp.ck('reader: bad zip refused', pg_temp.raises($$select public.air_permits_for_zip('7852')$$, '22023'));

-- FIXTURE sources (a flipped TX stands in for a future compliant TCEQ route; CA tests the polygon predicate)
update public.air_permit_sources set access_status = 'active', access_note = null where source = 'tx_tceq_nsr';
update public.air_permit_states set status = 'loaded' where state = 'TX';
insert into public.air_permit_sources (source, state, authority, agency, permit_types, access_status) values
  ('fx_ca', 'CA', 'FIXTURE authority', 'FIXTURE California agency', array['Authority to Construct'], 'active');
insert into public.air_permit_states (state, name, status, source) values ('CA', 'California', 'loaded', 'fx_ca');

-- B. the regression record (identifiers from the brief) flows through the shared function
select public.air_permits_ingest('tx_tceq_nsr', $j$[
 {"source_record_id":"414660","permit_no":"185303","project_no":"414660","facility_ref":"RN112524897","facility_name":"BOCA CHICA FACILITY",
  "applicant":"Space Exploration Technologies Corp.","permit_type":"Standard permit, electric generating facilities","action_kind":"registration",
  "status":"PENDING","received_on":"2026-09-08","county":"Cameron",
  "record_url":"https://records.tceq.texas.gov/cs/idcplg?IdcService=TCEQ_EXTERNAL_SEARCH_GET_FILE&Rendition=Web&dID=10258370&searchType=External",
  "doc_urls":["https://records.tceq.texas.gov/cs/idcplg?IdcService=TCEQ_EXTERNAL_SEARCH_GET_FILE&Rendition=Web&dID=10258371&searchType=External","http://insecure.example/x.pdf"],
  "lat":25.950101,"lng":-97.395252,"location_basis":"reviewed_point"}
]$j$::jsonb, true) as r1 \gset
select pg_temp.ck('ingest: first complete read is complete, 1 read, 1 changed', (:'r1'::jsonb ->> 'outcome') = 'complete' and (:'r1'::jsonb ->> 'changed') = '1');
create temp table z as select public.air_permits_for_zip('78521') r;
select pg_temp.ck('reader 78521: complete with the permit and its identifiers preserved',
  (select r ->> 'status' = 'complete' and jsonb_array_length(r -> 'records') = 1
      and r #>> '{records,0,permit_no}' = '185303' and r #>> '{records,0,project_no}' = '414660'
      and r #>> '{records,0,facility_ref}' = 'RN112524897' and r #>> '{records,0,facility_name}' = 'BOCA CHICA FACILITY' from z));
select pg_temp.ck('reader: the official link is the one supplied (document dID 10258370)',
  (select r #>> '{records,0,record_url}' like '%dID=10258370%' from z));
select pg_temp.ck('reader: only https document links are returned',
  (select jsonb_array_length(r #> '{records,0,doc_urls}') = 1 and r #>> '{records,0,doc_urls,0}' like '%dID=10258371%' from z));
select pg_temp.ck('reader: a registration is a registration, status is the agency word, nothing says approved',
  (select r #>> '{records,0,action_kind}' = 'registration' and r #>> '{records,0,status}' = 'PENDING' and r::text !~* 'approved' from z));
select pg_temp.ck('reader: point carries the polygon verdict and its stated basis',
  (select r #>> '{records,0,points,0,zip_membership}' = 'member' and r #>> '{records,0,location_basis}' = 'reviewed_point' from z));
select pg_temp.ck('reader: facility, project link and permit stay separate; no project link unless reviewed',
  (select not (r -> 'records' -> 0) ? 'project_link_ref' from z));
select pg_temp.ck('applicant: an organisation is shown by name', (select r #>> '{records,0,applicant}' = 'Space Exploration Technologies Corp.' from z));

-- C. idempotency and history
select public.air_permits_ingest('tx_tceq_nsr', (select jsonb_agg(jsonb_build_object('source_record_id','414660','permit_no','185303','project_no','414660',
  'facility_ref','RN112524897','facility_name','BOCA CHICA FACILITY','applicant','Space Exploration Technologies Corp.',
  'permit_type','Standard permit, electric generating facilities','action_kind','registration','status','PENDING','received_on','2026-09-08','county','Cameron',
  'record_url','https://records.tceq.texas.gov/cs/idcplg?IdcService=TCEQ_EXTERNAL_SEARCH_GET_FILE&Rendition=Web&dID=10258370&searchType=External',
  'doc_urls', jsonb_build_array('https://records.tceq.texas.gov/cs/idcplg?IdcService=TCEQ_EXTERNAL_SEARCH_GET_FILE&Rendition=Web&dID=10258371&searchType=External','http://insecure.example/x.pdf'),
  'lat',25.950101,'lng',-97.395252,'location_basis','reviewed_point'))), true) as r2 \gset
select pg_temp.ck('idempotent: the same read again changes nothing and adds no history',
  (:'r2'::jsonb ->> 'changed') = '0' and (select count(*) = 1 from public.air_permit_record_observations));
select public.air_permits_ingest('tx_tceq_nsr', (select jsonb_agg(jsonb_build_object('source_record_id','414660','permit_no','185303','project_no','414660',
  'facility_ref','RN112524897','facility_name','BOCA CHICA FACILITY','applicant','Space Exploration Technologies Corp.','action_kind','issued','status','ISSUED',
  'received_on','2026-09-08','action_on','2026-11-16','county','Cameron',
  'record_url','https://records.tceq.texas.gov/cs/idcplg?IdcService=TCEQ_EXTERNAL_SEARCH_GET_FILE&Rendition=Web&dID=10258370&searchType=External',
  'lat',25.950101,'lng',-97.395252,'location_basis','reviewed_point'))), true) as r3 \gset
select pg_temp.ck('update: a status/action change is one more observation; the old one is kept',
  (:'r3'::jsonb ->> 'changed') = '1' and (select count(*) = 2 and bool_or(status = 'PENDING') and bool_or(status = 'ISSUED') from public.air_permit_record_observations));
select pg_temp.ck('update: the reader shows the newest action and date',
  (select r #>> '{records,0,action_kind}' = 'issued' and r #>> '{records,0,action_on}' = '2026-11-16' from (select public.air_permits_for_zip('78521') r) x));
select pg_temp.ck('history is append-only (update refused)', pg_temp.raises($$update public.air_permit_record_observations set status = 'x'$$, '55000'));
select pg_temp.ck('history is append-only (delete refused)', pg_temp.raises($$delete from public.air_permit_record_observations$$, '55000'));

-- D. validation: bad records are rejected by the function, the run is partial, freshness does not move
select max(finished_at) as t_before from public.air_permit_runs where outcome = 'complete' \gset
select public.air_permits_ingest('tx_tceq_nsr', $j$[
 {"source_record_id":"a1","permit_no":"1","action_kind":"issued","record_url":"http://insecure.example/a"},
 {"source_record_id":"a2","action_kind":"issued","record_url":"https://x.example/a"},
 {"source_record_id":"a3","permit_no":"3","action_kind":"approved_development","record_url":"https://x.example/a"},
 {"source_record_id":"a4","permit_no":"4","action_kind":"issued","record_url":"https://x.example/a","lat":25.9},
 {"source_record_id":"a5","permit_no":"5","action_kind":"issued","record_url":"https://x.example/a","lat":25.9,"lng":-97.4},
 {"source_record_id":"a6","permit_no":"6","action_kind":"issued","record_url":"https://x.example/a","location_basis":"source_point"},
 {"source_record_id":"a7","permit_no":"7","action_kind":"issued","record_url":"https://x.example/a","lat":125.9,"lng":-97.4,"location_basis":"source_point"},
 {"permit_no":"8","action_kind":"issued","record_url":"https://x.example/a"}
]$j$::jsonb, true) as r4 \gset
select pg_temp.ck('validation: every bad record is rejected with its reason',
  (:'r4'::jsonb -> 'reject_reasons') = '{"no_record_id":1,"bad_action_kind":1,"half_a_point":1,"basis_without_point":1,"point_out_of_range":1,"point_without_basis":1,"no_https_record_url":1,"no_permit_or_project_no":1}'::jsonb
  and (:'r4'::jsonb ->> 'rejected') = '8', :'r4');
select pg_temp.ck('validation: a run with rejections is partial, never complete, and removes nothing',
  (:'r4'::jsonb ->> 'outcome') = 'partial' and (:'r4'::jsonb ->> 'removed') = '0'
  and (select removed_from_source_at is null from public.air_permit_records where record_id = 'tx_tceq_nsr:414660'));
select pg_temp.ck('freshness: a partial run does not refresh the source',
  (select max(finished_at) = :'t_before'::timestamptz from public.air_permit_runs where outcome = 'complete'));
select pg_temp.ck('no rejected record was written', (select count(*) = 1 from public.air_permit_records where source = 'tx_tceq_nsr'));

-- E. completeness: incomplete reads remove nothing; a truncated read does not clear the floor
select public.air_permits_ingest('tx_tceq_nsr', '[]'::jsonb, false) as r5 \gset
select pg_temp.ck('incomplete read: nothing removed', (:'r5'::jsonb ->> 'outcome') = 'incomplete'
  and (select removed_from_source_at is null from public.air_permit_records where record_id = 'tx_tceq_nsr:414660'));
update public.air_permit_sources set expected_min = 2 where source = 'tx_tceq_nsr';
select public.air_permits_ingest('tx_tceq_nsr', (select jsonb_agg(jsonb_build_object('source_record_id','414660','permit_no','185303','action_kind','issued',
  'record_url','https://x.example/a','status','ISSUED'))), true) as r6 \gset
select pg_temp.ck('anti-truncation: a "complete" read under the floor is incomplete and removes nothing',
  (:'r6'::jsonb ->> 'outcome') = 'incomplete' and (:'r6'::jsonb ->> 'removed') = '0');
update public.air_permit_sources set expected_min = 1 where source = 'tx_tceq_nsr';

-- F. ZIP assignment: polygon predicate, unlocated records counted not placed, no-boundary ZIPs
select public.air_permits_ingest('fx_ca', $j$[
 {"source_record_id":"in","permit_no":"CA-1","action_kind":"application","record_url":"https://x.example/in","lat":33.93,"lng":-118.28,"location_basis":"source_point","county":"Los Angeles"},
 {"source_record_id":"boxout","permit_no":"CA-2","action_kind":"renewal","record_url":"https://x.example/out","lat":33.99,"lng":-118.21,"location_basis":"source_point","county":"Los Angeles"}
]$j$::jsonb, true) as r7 \gset
select pg_temp.ck('ZIP: a point inside the ZIP is listed; a point only inside its bounding box is not',
  (select jsonb_array_length(r -> 'records') = 1 and r #>> '{records,0,permit_no}' = 'CA-1' from (select public.air_permits_for_zip('90001') r) x));
select pg_temp.ck('ZIP: a renewal is returned as a renewal (the page must not call it construction)',
  (select r2.k = 'renewal' from (select action_kind k from public.air_permit_records where record_id = 'fx_ca:boxout') r2));
select public.air_permits_ingest('tx_tceq_nsr', $j$[
 {"source_record_id":"414660","permit_no":"185303","project_no":"414660","facility_ref":"RN112524897","facility_name":"BOCA CHICA FACILITY","action_kind":"issued","status":"ISSUED",
  "record_url":"https://x.example/a","lat":25.950101,"lng":-97.395252,"location_basis":"reviewed_point","county":"Cameron"},
 {"source_record_id":"nopoint","permit_no":"999","facility_name":"NO POINT PLANT","action_kind":"application","record_url":"https://x.example/n","county":"Cameron"},
 {"source_record_id":"second","permit_no":"186000","facility_ref":"RN112524897","facility_name":"BOCA CHICA FACILITY","action_kind":"renewal","status":"RENEWAL PENDING",
  "record_url":"https://x.example/s","lat":25.951,"lng":-97.396,"location_basis":"source_point","county":"Cameron"}
]$j$::jsonb, true);
select pg_temp.ck('ZIP: a record the source states without a point is counted in the county, never placed or guessed',
  (select (r ->> 'unlocated_in_county')::int = 1 and not (r::text like '%NO POINT PLANT%') from (select public.air_permits_for_zip('78521') r) x));
select pg_temp.ck('entities: two permit records of one facility are two records sharing one facility_ref (no merge, no extra count)',
  (select jsonb_array_length(r -> 'records') = 2 and (select count(distinct x ->> 'facility_ref') = 1 from jsonb_array_elements(r -> 'records') x)
     from (select public.air_permits_for_zip('78521') r) y));
select pg_temp.ck('ZIP with no Census area is not_measured, never "none"',
  (select public.air_permits_for_zip('78999') ->> 'status' = 'not_measured'));

-- G. freshness and removal
update public.air_permit_runs set finished_at = now() - interval '5 days' where source = 'tx_tceq_nsr' and outcome = 'complete';
select pg_temp.ck('stale source: status unavailable, last records kept for "last confirmed"',
  (select r ->> 'status' = 'unavailable' and jsonb_array_length(r -> 'records') = 2 from (select public.air_permits_for_zip('78521') r) x));
select public.air_permits_ingest('tx_tceq_nsr', (select jsonb_agg(jsonb_build_object('source_record_id','414660','permit_no','185303','project_no','414660','action_kind','issued','status','ISSUED',
  'record_url','https://x.example/a','lat',25.950101,'lng',-97.395252,'location_basis','reviewed_point','county','Cameron'))), true) as r8 \gset
select pg_temp.ck('removal: a complete read without a record marks it removed, keeps the row and its history',
  (:'r8'::jsonb ->> 'removed') = '2'
  and (select count(*) = 2 and bool_and(removed_from_source_at is not null) from public.air_permit_records where record_id in ('tx_tceq_nsr:nopoint','tx_tceq_nsr:second'))
  and (select count(*) >= 3 from public.air_permit_record_observations));
select pg_temp.ck('removal: the reader stops listing a removed record', (select jsonb_array_length(r -> 'records') = 1 from (select public.air_permits_for_zip('78521') r) x));
select pg_temp.ck('recovery: a fresh complete run makes the source current again',
  (select r ->> 'status' = 'complete' from (select public.air_permits_for_zip('78521') r) x));

-- H. circle reader and people
select pg_temp.ck('circle: includes a record inside, excludes one outside, names every source and its status',
  (select jsonb_array_length(r -> 'records') = 1 and jsonb_array_length(r -> 'sources') = 2
     from (select public.map1_air_permits_near(25.95, -97.395, 2) r) x));
select pg_temp.ck('circle: a bad radius is refused', pg_temp.raises($$select public.map1_air_permits_near(25.95, -97.39, 25)$$, '22023'));
select pg_temp.ck('people: a person is never named', public.air_permits_display_applicant('JOHN Q PUBLIC') = 'Individual applicant'
  and public.air_permits_display_applicant('Acme Power Inc.') = 'Acme Power Inc.');

-- H2. THE REPORT RADIUS RULE (0.5 mile around 25.9500,-97.3900). Fixtures only. A verified footprint is judged by the shape, over all its parcels;
-- a point-only record by its point; no location is disclosed, never placed. 1 mile of longitude here is about 0.0161 degrees.
select public.air_permits_ingest('tx_tceq_nsr', $j$[
 {"source_record_id":"fx-cross","permit_no":"FX1","action_kind":"registration","status":"PENDING","county":"Cameron","record_url":"https://x.example/fx1","lat":25.95,"lng":-97.37,"location_basis":"reviewed_point"},
 {"source_record_id":"fx-out","permit_no":"FX2","action_kind":"registration","status":"PENDING","county":"Cameron","record_url":"https://x.example/fx2","lat":25.95,"lng":-97.388,"location_basis":"reviewed_point"},
 {"source_record_id":"fx-pt","permit_no":"FX3","action_kind":"registration","status":"PENDING","county":"Cameron","record_url":"https://x.example/fx3","lat":25.95,"lng":-97.388,"location_basis":"reviewed_point"},
 {"source_record_id":"fx-none","permit_no":"FX4","action_kind":"registration","status":"PENDING","county":"Cameron","record_url":"https://x.example/fx4"},
 {"source_record_id":"fx-multi","permit_no":"FX5","action_kind":"registration","status":"PENDING","county":"Cameron","record_url":"https://x.example/fx5","lat":25.95,"lng":-97.34,"location_basis":"reviewed_point"}
]$j$::jsonb, false) as rfx \gset
-- fx-cross: point 2 km east (outside); boundary spans ~0.4 mi to 2 mi east, so it crosses into the radius
select public.air_permit_footprint_set('tx_tceq_nsr:fx-cross', 'verified_boundary', 'https://x.example/boundary', 'fixture',
  '[{"feature_id":"b","geometry":{"type":"Polygon","coordinates":[[[-97.3835,25.948],[-97.360,25.948],[-97.360,25.952],[-97.3835,25.952],[-97.3835,25.948]]]}}]'::jsonb);
-- fx-out: its point is INSIDE the radius but its verified boundary is entirely outside, so the boundary decides: excluded
select public.air_permit_footprint_set('tx_tceq_nsr:fx-out', 'verified_parcel', 'https://x.example/parcel', 'fixture',
  '[{"feature_id":"p","geometry":{"type":"Polygon","coordinates":[[[-97.360,25.948],[-97.350,25.948],[-97.350,25.952],[-97.360,25.952],[-97.360,25.948]]]}}]'::jsonb);
-- fx-multi: ONE permit, three parcels, two of them inside the radius (point far outside)
select public.air_permit_footprint_set('tx_tceq_nsr:fx-multi', 'verified_parcel', 'https://x.example/parcels', 'fixture',
  '[{"feature_id":"p1","geometry":{"type":"Polygon","coordinates":[[[-97.3880,25.948],[-97.3870,25.948],[-97.3870,25.949],[-97.3880,25.949],[-97.3880,25.948]]]}},
    {"feature_id":"p2","geometry":{"type":"Polygon","coordinates":[[[-97.3890,25.951],[-97.3880,25.951],[-97.3880,25.952],[-97.3890,25.952],[-97.3890,25.951]]]}},
    {"feature_id":"p3","geometry":{"type":"Polygon","coordinates":[[[-97.340,25.948],[-97.339,25.948],[-97.339,25.949],[-97.340,25.949],[-97.340,25.948]]]}}]'::jsonb);
create temp table rr as select public.map1_air_permits_near(25.95, -97.39, 0.5, 'TX', 'Cameron') r;
select pg_temp.ck('radius 1: point outside but verified boundary crosses in -> included, matched by footprint',
  (select r -> 'matches' -> 'tx_tceq_nsr:fx-cross' ->> 'matched_by' = 'footprint' and r #>> '{matches,tx_tceq_nsr:fx-cross,distance_mi}' is not null from rr));
select pg_temp.ck('radius 2: boundary entirely outside -> excluded even though its own point is inside',
  (select not (r -> 'matches' ? 'tx_tceq_nsr:fx-out') and not exists (select 1 from jsonb_array_elements(r -> 'records') e where e ->> 'permit_no' = 'FX2') from rr));
select pg_temp.ck('radius 3: point only, inside -> included, matched by point',
  (select r -> 'matches' -> 'tx_tceq_nsr:fx-pt' ->> 'matched_by' = 'point' from rr));
select pg_temp.ck('radius 4: no location -> excluded from the list and disclosed by county',
  (select not exists (select 1 from jsonb_array_elements(r -> 'records') e where e ->> 'permit_no' = 'FX4')
      and (r ->> 'unlocated_in_county')::int = 1 and r ->> 'unlocated_county' = 'Cameron' from rr));
select pg_temp.ck('radius 5: one permit with several parcels is listed once',
  (select count(*) = 1 from rr, jsonb_array_elements(r -> 'records') e where e ->> 'permit_no' = 'FX5')
  and (select r -> 'matches' -> 'tx_tceq_nsr:fx-multi' ->> 'matched_by' = 'footprint' from rr));
select pg_temp.ck('radius: the same rule at a larger distance changes the answer (the point-only record still obeys its point)',
  (select r -> 'matches' ? 'tx_tceq_nsr:fx-pt' from (select public.map1_air_permits_near(25.95, -97.30, 0.5) r) x) = false);
select pg_temp.ck('location: a city or ZIP level basis is refused at ingest, the record is not stored',
  (select (public.air_permits_ingest('tx_tceq_nsr', '[{"source_record_id":"fx-city","permit_no":"FX6","action_kind":"registration","record_url":"https://x.example/6","lat":25.9,"lng":-97.4,"location_basis":"zip_centroid"}]'::jsonb, false) ->> 'rejected')::int = 1)
  and not exists (select 1 from public.air_permit_records where record_id = 'tx_tceq_nsr:fx-city'));
select pg_temp.ck('footprint writer: service_role only; visitors cannot read the table',
  has_function_privilege('service_role', 'public.air_permit_footprint_set(text,text,text,text,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.air_permit_footprint_set(text,text,text,text,jsonb)', 'execute')
  and not has_table_privilege('anon', 'public.air_permit_footprints', 'select')
  and pg_temp.raises($$select public.air_permit_footprint_set('tx_tceq_nsr:fx-pt', 'city_centroid', 'https://x.example', 'f', '[{"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}}]'::jsonb)$$, '22023'));
update public.air_permit_sources set access_status = 'blocked' where source = 'tx_tceq_nsr';
select pg_temp.ck('circle: a source that becomes blocked is reported blocked and contributes no records',
  (select jsonb_array_length(r -> 'records') = 0 and r -> 'sources' @> '[{"source":"tx_tceq_nsr","status":"blocked"}]'::jsonb
     from (select public.map1_air_permits_near(25.95, -97.395, 2) r) x));
select pg_temp.ck('reader: blocked again after being active reads blocked, not an empty complete',
  (select public.air_permits_for_zip('78521') ->> 'status' = 'blocked'));

-- I. who may do what
select pg_temp.ck('anon can read through the readers only',
  has_function_privilege('anon', 'public.air_permits_for_zip(text)', 'execute')
  and has_function_privilege('anon', 'public.map1_air_permits_near(double precision,double precision,double precision,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.air_permits_ingest(text,jsonb,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.air_permits_ingest(text,jsonb,boolean)', 'execute')
  and has_function_privilege('service_role', 'public.air_permits_ingest(text,jsonb,boolean)', 'execute'));
select pg_temp.ck('no visitor role can read or write the tables',
  not has_table_privilege('anon', 'public.air_permit_records', 'select') and not has_table_privilege('authenticated', 'public.air_permit_records', 'select')
  and not has_table_privilege('anon', 'public.air_permit_records', 'insert') and not has_table_privilege('anon', 'public.air_permit_sources', 'update'));
select pg_temp.ck('row level security is on for every table',
  (select bool_and(relrowsecurity) and count(*) = 6 from pg_class where relname in ('air_permit_footprints','air_permit_sources','air_permit_states','air_permit_runs','air_permit_records','air_permit_record_observations')));

select name || '|' || case when ok then 't' else 'f' end || '|' || detail from ck order by n;

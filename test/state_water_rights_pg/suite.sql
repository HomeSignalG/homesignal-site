-- State water-rights filings suite. Every row: name|t-or-f|detail. Any '|f|' fails the run.
\set ON_ERROR_STOP 1
create temp table ck (n serial, name text, ok boolean, detail text);
create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into ck (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;

-- Real Utah features (a55167, read 2026-10-28 via pg_net) plus fixtures: the same point repeated
-- (the layer repeats a point per water-user record), a person's filing in 84302, a point outside
-- every ZIP, and an undated legacy filing.
create temp table ut_feat as select * from (values
 ('{"attributes":{"OBJECTID":383710,"WRNUM":"13-2","CHEXNUM":"a55167","STATUS":"Unapproved","TYPE_OF_RIGHT":"Application To Appropriate","TYPE":"Point of Return","PRIORITY":"20261015","USES":"OP","CFS":4,"ACFT":1712,"LOCATION":"N40 W704 S4 30 12N 7W SL","OWNER":"BAR H RANCH INC.","SOURCE":"Salt Wells Spring Stream","WebLink":"https://www.waterrights.utah.gov/search/?q=a55167"},"geometry":{"x":-112.7003012663938,"y":41.73339735410095}}'::jsonb),
 ('{"attributes":{"OBJECTID":383711,"WRNUM":"13-2","CHEXNUM":"a55167","STATUS":"Unapproved","TYPE_OF_RIGHT":"Application To Appropriate","TYPE":"Surface","PRIORITY":"20261015","USES":"OP","CFS":4,"ACFT":1712,"LOCATION":"N1953 W333 S4 21 12N 7W SL","OWNER":"BAR H RANCH INC.","SOURCE":"Salt Wells Spring Stream","WebLink":"https://www.waterrights.utah.gov/search/?q=a55167"},"geometry":{"x":-112.66019764240536,"y":41.75341874169309}}'::jsonb),
 ('{"attributes":{"OBJECTID":999001,"WRNUM":"13-2","CHEXNUM":"a55167","STATUS":"Unapproved","TYPE_OF_RIGHT":"Application To Appropriate","TYPE":"Surface","PRIORITY":"20261015","USES":"OP","CFS":4,"ACFT":1712,"LOCATION":"N1953 W333 S4 21 12N 7W SL","OWNER":"BAR H RANCH INC.","SOURCE":"Salt Wells Spring Stream","WebLink":"https://www.waterrights.utah.gov/search/?q=a55167"},"geometry":{"x":-112.66019764240536,"y":41.75341874169309}}'::jsonb),
 ('{"attributes":{"OBJECTID":500,"WRNUM":"29-4501","CHEXNUM":"","STATUS":"Unapproved","TYPE_OF_RIGHT":"Application To Appropriate","TYPE":"Underground","PRIORITY":"20260601","USES":"D","CFS":0.015,"ACFT":1,"LOCATION":"S10 E20 N4 5 9N 2W SL","OWNER":"DENNIS OR ANN TOLLEY","SOURCE":"Underground Water Well","WebLink":"https://www.waterrights.utah.gov/search/?q=29-4501"},"geometry":{"x":-112.03,"y":41.51}}'::jsonb),
 ('{"attributes":{"OBJECTID":502,"WRNUM":"29-9999","CHEXNUM":"","STATUS":"Unapproved","TYPE_OF_RIGHT":"Application To Appropriate","TYPE":"Underground","PRIORITY":"20260701","USES":"I","CFS":1,"ACFT":0,"LOCATION":"Y","OWNER":"OUTSIDE LLC","SOURCE":"Well","WebLink":"https://www.waterrights.utah.gov/search/?q=29-9999"},"geometry":{"x":-111.99,"y":41.55}}'::jsonb),
 ('{"attributes":{"OBJECTID":501,"WRNUM":"01-1","CHEXNUM":"","STATUS":"Unapproved","TYPE_OF_RIGHT":"","TYPE":"Surface","PRIORITY":"1848","USES":"I","CFS":1,"ACFT":0,"LOCATION":"X","OWNER":"SOMEONE","SOURCE":"Creek","WebLink":"https://www.waterrights.utah.gov/search/?q=01-1"},"geometry":{"x":-110.0,"y":38.0}}'::jsonb)
) v(f);

create or replace function pg_temp.answer(p_run bigint, p_count int, p_feats jsonb, p_bad_page boolean default false) returns void
language plpgsql as $$
declare r public.water_rights_runs; k int;
begin
  select * into r from public.water_rights_runs where run_id = p_run;
  insert into net._http_response (id, status_code, content) values (r.count_req, 200, json_build_object('count', p_count)::text);
  for k in 1..cardinality(r.page_reqs) loop
    insert into net._http_response (id, status_code, content) values (r.page_reqs[k], 200,
      case when p_bad_page and k = 2 then '{"error":{"code":500,"message":"x"}}'
           else jsonb_build_object('features', case when k = 1 then p_feats else '[]'::jsonb end)::text end);
  end loop;
  update public.water_rights_runs set fired_at = now() - interval '5 minutes' where run_id = p_run;
end $$;

-- 1. fire Utah
select public.water_rights_fire('ut_dwr_pending') as run1 \gset
select pg_temp.ck('fire: one count + 8 page requests recorded',
  (select cardinality(page_reqs) = 8 and count_req is not null from public.water_rights_runs where run_id = :run1));
select pg_temp.ck('fire: every request asks only for pending (SUMMARY_ST=U)',
  (select bool_and(url like '%where=SUMMARY_ST%3D%27U%27%') and count(*) = 9 from net.http_request_log));
select pg_temp.ck('fire: a second fire inside the hour does nothing', public.water_rights_fire('ut_dwr_pending') is null);

-- 2. complete run
select pg_temp.answer(:run1, 6, (select jsonb_agg(f) from ut_feat));
select public.water_rights_collect() as c1 \gset
select pg_temp.ck('collect: run complete', (select outcome = 'complete' from public.water_rights_runs where run_id = :run1), :'c1');
select pg_temp.ck('collect: a repeated point is stored once (6 features -> 5 points)',
  (select count(*) = 5 from public.water_rights_filings), (select count(*)::text from public.water_rights_filings));
select pg_temp.ck('collect: every point has a first_seen observation',
  (select count(*) = 5 from public.water_rights_filing_observations where event = 'first_seen'));
select pg_temp.ck('map: a change application is known by its own number, beside the right it changes',
  (select bool_and(filing_no = 'a55167' and right_no = '13-2') and count(*) = 2 from public.water_rights_filings where filing_no = 'a55167'));
select pg_temp.ck('map: PRIORITY 20261015 is the date, labelled Priority date',
  (select bool_and(filed_on = date '2026-10-15' and date_label = 'Priority date') from public.water_rights_filings where filing_no = 'a55167'));
select pg_temp.ck('map: a year-only PRIORITY is not a date', (select filed_on is null from public.water_rights_filings where filing_no = '01-1'));

-- 3. readers
select public.water_rights_for_zip('84336') as z1 \gset
select pg_temp.ck('reader 84336: complete', (:'z1'::jsonb ->> 'status') = 'complete', :'z1');
select pg_temp.ck('reader 84336: a55167 is the one filing, with both its points',
  jsonb_array_length(:'z1'::jsonb -> 'filings') = 1
  and (:'z1'::jsonb #>> '{filings,0,filing_no}') = 'a55167'
  and jsonb_array_length(:'z1'::jsonb #> '{filings,0,points}') = 2);
select pg_temp.ck('reader 84336: an organisation is named', (:'z1'::jsonb #>> '{filings,0,applicant}') = 'BAR H RANCH INC.');
select pg_temp.ck('reader 84336: the agency record link and status are the agency''s own',
  (:'z1'::jsonb #>> '{filings,0,record_url}') = 'https://www.waterrights.utah.gov/search/?q=a55167'
  and (:'z1'::jsonb #>> '{filings,0,status}') = 'Unapproved'
  and (:'z1'::jsonb ->> 'agency') = 'Utah Division of Water Rights');
select pg_temp.ck('reader 84336: every point carries the polygon verdict (Map 1 admits on it)',
  (select bool_and(p ->> 'zip_membership' = 'member') from jsonb_array_elements(:'z1'::jsonb #> '{filings,0,points}') p));
-- Map 1 address mode: the circle reader
select public.map1_water_rights_near(41.745, -112.68, 3) as n1 \gset
select pg_temp.ck('near: a55167 within 3 mi, both points, no ZIP verdict',
  (select count(*) = 1 from jsonb_array_elements(:'n1'::jsonb -> 'filings') f where f ->> 'filing_no' = 'a55167'
     and jsonb_array_length(f -> 'points') = 2 and not (f #> '{points,0}' ? 'zip_membership')), :'n1');
select pg_temp.ck('near: each filing names its source and state',
  (:'n1'::jsonb #>> '{filings,0,source}') = 'ut_dwr_pending' and (:'n1'::jsonb #>> '{filings,0,state}') = 'UT');
select pg_temp.ck('near: the loaded sources are listed with their load state',
  (select count(*) = 2 and count(*) filter (where s ->> 'source' = 'ut_dwr_pending' and s ->> 'status' = 'complete') = 1
     from jsonb_array_elements(:'n1'::jsonb -> 'sources') s));
select pg_temp.ck('near: a point outside the circle is not returned',
  jsonb_array_length(public.map1_water_rights_near(41.745, -112.68, 0.5) -> 'filings') = 0
  and jsonb_array_length(public.map1_water_rights_near(38.0, -110.0, 1) -> 'filings') = 1);
-- a point inside the square around the circle but 1.27 mi from its centre (radius 1) is outside it
select pg_temp.ck('near: the circle, not its bounding square, decides',
  jsonb_array_length(public.map1_water_rights_near(41.7464, -112.6828, 1) -> 'filings') = 0
  and jsonb_array_length(public.map1_water_rights_near(41.7464, -112.6828, 1.4) -> 'filings') = 1);
do $$ begin perform public.map1_water_rights_near(41.7, -112.6, 50); perform pg_temp.ck('near: a radius over 20 mi is refused', false);
exception when others then perform pg_temp.ck('near: a radius over 20 mi is refused', sqlstate = '22023'); end $$;
select public.water_rights_for_zip('84302') as z2 \gset
select pg_temp.ck('reader 84302: a person is not named',
  (:'z2'::jsonb #>> '{filings,0,applicant}') = 'Individual applicant' and (:'z2'::jsonb #>> '{filings,0,applicant_withheld}') = 'true', :'z2');
select pg_temp.ck('reader 84302: membership is the polygon (a point inside the box but outside the ZIP is not here)',
  jsonb_array_length(:'z2'::jsonb -> 'filings') = 1);
select pg_temp.ck('reader 84999: a read state with no Census area is not_measured',
  (public.water_rights_for_zip('84999') ->> 'status') = 'not_measured');
select pg_temp.ck('reader 33301: an unread state is not_covered and names the state',
  (public.water_rights_for_zip('33301') ->> 'status') = 'not_covered' and (public.water_rights_for_zip('33301') ->> 'state_name') = 'Florida');
select pg_temp.ck('reader 89501: a held state is not_covered', (public.water_rights_for_zip('89501') ->> 'status') = 'not_covered');
select pg_temp.ck('reader 83706: a read state with no complete load is unavailable, never complete',
  (public.water_rights_for_zip('83706') ->> 'status') = 'unavailable');
select pg_temp.ck('reader: a ZIP with no page is not_covered', (public.water_rights_for_zip('00000') ->> 'status') = 'not_covered');
do $$ begin perform public.water_rights_for_zip('8433'); perform pg_temp.ck('reader: bad zip refused', false);
exception when others then perform pg_temp.ck('reader: bad zip refused', sqlstate = '22023'); end $$;
select pg_temp.ck('states: all 50, and Utah + Idaho loaded',
  (select count(*) = 50 and count(*) filter (where status = 'loaded') = 2 from public.water_rights_states));

-- 4. an incomplete run writes nothing
select public.water_rights_fire('ut_dwr_pending') as run2 \gset
select pg_temp.answer(:run2, 7, (select jsonb_agg(f) from ut_feat));
select md5(string_agg(point_key || content_md5 || coalesce(removed_from_source_at::text,''), ',' order by point_key collate "C")) as before2 from public.water_rights_filings \gset
select public.water_rights_collect();
select pg_temp.ck('incomplete: run failed', (select outcome = 'failed' from public.water_rights_runs where run_id = :run2));
select pg_temp.ck('incomplete: nothing changed',
  (select md5(string_agg(point_key || content_md5 || coalesce(removed_from_source_at::text,''), ',' order by point_key collate "C")) from public.water_rights_filings) = :'before2');

-- 5. an error page writes nothing
update public.water_rights_runs set fired_at = now() - interval '2 hours' where finished_at is null;
select public.water_rights_fire('ut_dwr_pending') as run3 \gset
select pg_temp.answer(:run3, 6, (select jsonb_agg(f) from ut_feat), true);
select public.water_rights_collect();
select pg_temp.ck('page error: run failed', (select outcome = 'failed' from public.water_rights_runs where run_id = :run3));

-- 6. a filing that leaves the pending list keeps its row and history
select public.water_rights_fire('ut_dwr_pending') as run4 \gset
select pg_temp.answer(:run4, 3, (select jsonb_agg(f) from ut_feat where f #>> '{attributes,CHEXNUM}' <> 'a55167'));
select public.water_rights_collect();
select pg_temp.ck('removal: run complete', (select outcome = 'complete' from public.water_rights_runs where run_id = :run4));
select pg_temp.ck('removal: rows kept, marked removed',
  (select count(*) = 2 and bool_and(removed_from_source_at is not null) from public.water_rights_filings where filing_no = 'a55167'));
select pg_temp.ck('removal: observations recorded', (select count(*) = 2 from public.water_rights_filing_observations where event = 'removed_from_source'));
select pg_temp.ck('removal: the circle no longer lists it',
  not exists (select 1 from jsonb_array_elements(public.map1_water_rights_near(41.745, -112.68, 3) -> 'filings') f where f ->> 'filing_no' = 'a55167'));
select pg_temp.ck('removal: the page no longer lists it', jsonb_array_length(public.water_rights_for_zip('84336') -> 'filings') = 0
  and (public.water_rights_for_zip('84336') ->> 'status') = 'complete');

-- 7. a stale load reads unavailable
update public.water_rights_runs set finished_at = now() - interval '3 days' where outcome = 'complete';
select pg_temp.ck('stale: unavailable after 48h', (public.water_rights_for_zip('84302') ->> 'status') = 'unavailable');

-- 8. Idaho mapping (real field shapes, read 2026-10-28)
select pg_temp.ck('idaho: epoch PriorityDate, per-application report link',
  (select filed_on = date '2026-10-22' and record_url like 'https://research.idwr.idaho.gov/%' and filing_no = '63-35880' and status = 'Active'
     from public.water_rights_map_feature('id_idwr_applications',
       '{"attributes":{"WaterRightNumber":"63-35880  ","Status":"Active","PriorityDate":1792652400000,"Applicant":"BENJAMIN BRANDVOLD","Source":"GROUND WATER","Uses":"IRRIGATION,DOMESTIC","WRReport":"https://research.idwr.idaho.gov/apps/shared/WrExtSearch/Reports/WaterAppReport?basin=63&seq=35880&suffix="},"geometry":{"x":-116.69,"y":43.85}}', now())));

-- 9. names
select pg_temp.ck('names: a family trust is a person', public.water_rights_display_applicant('DOROTHY M REVOCABLE TRUST') = 'Individual applicant');
select pg_temp.ck('names: a farm trust is a person (real 84336 row)', public.water_rights_display_applicant('ROSS DENZIL BALLARD FARM TRUST') = 'Individual applicant');
select pg_temp.ck('names: a company-held trust is named', public.water_rights_display_applicant('FIRST SECURITY BANK TRUST') = 'FIRST SECURITY BANK TRUST');
select pg_temp.ck('names: a person is a person', public.water_rights_display_applicant('JULIA BUTLER') = 'Individual applicant');
select pg_temp.ck('names: LLC / district / city are named',
  public.water_rights_display_applicant('QUALITY DEVELOPMENT LLC') = 'QUALITY DEVELOPMENT LLC'
  and public.water_rights_display_applicant('Red Creek Irrigation Company') = 'Red Creek Irrigation Company'
  and public.water_rights_display_applicant('LEAMINGTON TOWN') = 'LEAMINGTON TOWN');

-- 10. who may run what
select pg_temp.ck('grants: anon may read a page', has_function_privilege('anon', 'public.water_rights_for_zip(text)', 'execute'));
select pg_temp.ck('grants: anon may read the circle, not the shape helper',
  has_function_privilege('anon', 'public.map1_water_rights_near(double precision, double precision, double precision)', 'execute')
  and not has_function_privilege('anon', 'public.water_rights_filings_json(public.water_rights_filings[], boolean)', 'execute'));
select pg_temp.ck('grants: anon may not fire or collect',
  not has_function_privilege('anon', 'public.water_rights_fire(text)', 'execute')
  and not has_function_privilege('anon', 'public.water_rights_collect()', 'execute')
  and not has_function_privilege('authenticated', 'public.water_rights_fire(text)', 'execute'));
select pg_temp.ck('grants: anon may not read the tables',
  not has_table_privilege('anon', 'public.water_rights_filings', 'select')
  and not has_table_privilege('anon', 'public.water_rights_states', 'select'));
select pg_temp.ck('schedule: fire UT + ID and one collect',
  (select count(*) = 3 from cron.job where jobname like 'water-rights-%'));

select name, case when ok then 't' else 'f' end, left(coalesce(detail,''), 200) from ck order by n;

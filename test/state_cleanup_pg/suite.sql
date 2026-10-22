-- Executable checks for docs/state-cleanup-sites.sql. Each row: name|t/f|detail.
\set ON_ERROR_STOP 1
create temp table chk (n serial, name text, ok boolean, detail text);

-- Real feature shapes, copied from DEP's layer (pg_net read 2026-10-21, ZIP5=33301).
create temp table feat (k text primary key, f jsonb);
insert into feat values
 ('citgo', '{"attributes":{"DEP_CLEANUP_SITE_KEY":89287788,"SOURCE_DATABASE_NAME":"STCM","SOURCE_DATABASE_ID":"8839695","CLCC_CLEANUP_CATEGORY_KEY":"PETRO","RSC2_REMEDIATION_STATUS_KEY":"ACTIVE","BUSINESS_NAME":"CITGO (FORMER)","ADDRESS1":"1500 E LAS OLAS BLVD","CITY":"FORT LAUDERDALE","STCD1_STATE_ID":"FL","ZIP5":33301,"DOCUMENTS":"https://prodenv.dep.state.fl.us/DepNexus/public/electronic-documents/8839695/facility!search","DATA_LOAD_DATE":1792566009000,"CALC_COORD_ACCURACY_LEVEL_ID":4,"OBJECTID":1},"geometry":{"x":-80.128438782018932,"y":26.119515886579535}}'),
 ('gore',  '{"attributes":{"DEP_CLEANUP_SITE_KEY":89284058,"SOURCE_DATABASE_NAME":"ERIC","SOURCE_DATABASE_ID":"ERIC_18959","CLCC_CLEANUP_CATEGORY_KEY":"OTHCU","RSC2_REMEDIATION_STATUS_KEY":"OPEN","BUSINESS_NAME":"BCGC Gore Building","ADDRESS1":"201 W Broward Blvd","CITY":"Fort Lauderdale","STCD1_STATE_ID":"FL","ZIP5":33301,"DOCUMENTS":"https://prodenv.dep.state.fl.us/DepNexus/public/electronic-documents/ERIC_18959/facility!search","DATA_LOAD_DATE":1792566008000,"CALC_COORD_ACCURACY_LEVEL_ID":1,"OBJECTID":2},"geometry":{"x":-80.146137675801555,"y":26.122777776574758}}'),
 -- DEP files this one under ZIP5 33301; its point is in 33309. Membership must follow the point.
 ('sony',  '{"attributes":{"DEP_CLEANUP_SITE_KEY":89282856,"SOURCE_DATABASE_NAME":"ERIC","SOURCE_DATABASE_ID":"ERIC_10331","CLCC_CLEANUP_CATEGORY_KEY":"OTHCU","RSC2_REMEDIATION_STATUS_KEY":"OPEN","BUSINESS_NAME":"SONY PROFESSIONAL PRODUCTS CO","ADDRESS1":"1400 W COMMERCIAL BLVD","CITY":"FORT LAUDERDALE","STCD1_STATE_ID":"FL","ZIP5":33301,"DOCUMENTS":"https://prodenv.dep.state.fl.us/DepNexus/public/electronic-documents/ERIC_10331/facility!search","DATA_LOAD_DATE":1792566008000,"CALC_COORD_ACCURACY_LEVEL_ID":3,"OBJECTID":3},"geometry":{"x":-80.160989904467996,"y":26.18643915230118}}'),
 -- no DOCUMENTS link: stored, never served
 ('nolink','{"attributes":{"DEP_CLEANUP_SITE_KEY":89999999,"SOURCE_DATABASE_NAME":"STCM","SOURCE_DATABASE_ID":"9999999","CLCC_CLEANUP_CATEGORY_KEY":"PETRO","RSC2_REMEDIATION_STATUS_KEY":"ONHOLD","BUSINESS_NAME":"NO LINK STATION","ADDRESS1":"1 TEST ST","CITY":"FORT LAUDERDALE","STCD1_STATE_ID":"FL","ZIP5":33301,"DOCUMENTS":null,"DATA_LOAD_DATE":1792566008000,"CALC_COORD_ACCURACY_LEVEL_ID":4,"OBJECTID":4},"geometry":{"x":-80.13,"y":26.12}}');

-- Fire a run, then answer its requests: count + pages (features split over the first pages).
create temp table cur (run_id bigint);
create function pg_temp.answer(_count int, _keys text[], _status int default 200, _page0 text default null, _last text default null) returns void language plpgsql as $$
declare r public.state_cleanup_runs; i int := 0; p bigint; body text;
begin
  select * into r from public.state_cleanup_runs order by run_id desc limit 1;
  insert into net._http_response values (r.count_req, 200, json_build_object('count', _count)::text);
  foreach p in array r.page_reqs loop
    if i = 0 then
      body := coalesce(_page0, (select jsonb_build_object('features', coalesce(jsonb_agg(f.f order by f.k), '[]'))::text
                                  from feat f where f.k = any (_keys)));
    elsif i = cardinality(r.page_reqs) - 1 and _last is not null then body := _last;
    else body := '{"features":[]}'; end if;
    insert into net._http_response values (p, case when i = 0 then _status else 200 end, body);
    i := i + 1;
  end loop;
  update public.state_cleanup_runs set fired_at = fired_at - interval '3 minutes' where run_id = r.run_id;
end $$;
create function pg_temp.ok(_name text, _ok boolean, _detail text default '') returns void language sql as
  $$ insert into chk (name, ok, detail) values (_name, coalesce(_ok, false), _detail) $$;

-- 1. fire
select public.state_cleanup_fl_fire();
select pg_temp.ok('fire: one count request + 8 page requests',
  (select cardinality(page_reqs) = 8 and count_req is not null from public.state_cleanup_runs order by run_id desc limit 1));
select pg_temp.ok('fire: a second fire while a run is open does nothing', public.state_cleanup_fl_fire() is null);
select pg_temp.ok('fire: pages ordered by OBJECTID at offsets 0..14000, outSR 4326',
  (select count(*) = 8 from net.http_request_log where url like '%orderByFields=OBJECTID%' and url like '%outSR=4326%'
     and url ~ 'resultOffset=(0|2000|4000|6000|8000|10000|12000|14000)&'));

-- 2. collect before answers: nothing
select public.state_cleanup_fl_collect();
select pg_temp.ok('collect: unanswered run stays open', (select finished_at is null from public.state_cleanup_runs order by run_id desc limit 1));

-- 3. complete first run
select pg_temp.answer(4, array['citgo','gore','sony','nolink']);
select public.state_cleanup_fl_collect();
select pg_temp.ok('run 1 complete', (select outcome = 'complete' from public.state_cleanup_runs order by run_id desc limit 1));
select pg_temp.ok('run 1: 4 sites stored', (select count(*) = 4 from public.state_cleanup_sites));
select pg_temp.ok('run 1: 4 first_seen observations', (select count(*) = 4 from public.state_cleanup_site_observations where event = 'first_seen'));
select pg_temp.ok('point stored from DEP geometry, not from ZIP5',
  (select abs(lat - 26.119515886579535) < 1e-9 and abs(lng + 80.128438782018932) < 1e-9 from public.state_cleanup_sites where site_key = '89287788'));
select pg_temp.ok('record_url null when DOCUMENTS is missing', (select record_url is null from public.state_cleanup_sites where site_key = '89999999'));

-- 4. ZIP reader
select pg_temp.ok('zip 33301: members only (Citgo, Gore); Sony is in 33309; no-link not served',
  (select string_agg(x ->> 'site_key', ',' order by x ->> 'site_key')
     from jsonb_array_elements(public.map1_state_cleanup_zip_members('33301') -> 'sites') x) = '89284058,89287788',
  (public.map1_state_cleanup_zip_members('33301'))::text);
select pg_temp.ok('zip 33309 holds Sony by its point',
  (select string_agg(x ->> 'site_key', ',') from jsonb_array_elements(public.map1_state_cleanup_zip_members('33309') -> 'sites') x) = '89282856');
select pg_temp.ok('every served site says member', (select bool_and(x ->> 'zip_membership' = 'member')
  from jsonb_array_elements(public.map1_state_cleanup_zip_members('33301') -> 'sites') x));
select pg_temp.ok('zip with no polygon: not_measured, no sites',
  public.map1_state_cleanup_zip_members('99999') = '{"zip":"99999","status":"not_measured","sites":[]}'::jsonb);
select pg_temp.ok('served row carries category, status, record link, agency',
  (select x ->> 'category' = 'PETRO' and x ->> 'status' = 'ACTIVE' and x ->> 'agency' = 'Florida DEP' and x ->> 'record_url' like 'https://prodenv.dep.state.fl.us/%'
     from jsonb_array_elements(public.map1_state_cleanup_zip_members('33301') -> 'sites') x where x ->> 'site_key' = '89287788'));

-- 4b. private homes are not named; shared record links are counted; the checked date is served
select pg_temp.ok('display name: a residence, a one-word heating oil tank and a residential property are withheld',
  public.state_cleanup_display_name('Allen Residence') = 'Residential property'
  and public.state_cleanup_display_name('Mentzer Heating Oil Tank') = 'Residential property'
  and public.state_cleanup_display_name('ADKINS RESIDENTIAL PROPERTY') = 'Residential property'
  and public.state_cleanup_display_name('Barker Residential HOT') = 'Residential property'
  and public.state_cleanup_display_name('BROCK RESIDENCE') = 'Residential property');
select pg_temp.ok('display name: public and business names are kept',
  public.state_cleanup_display_name('Town Hall Heating Oil Tank') = 'Town Hall Heating Oil Tank'
  and public.state_cleanup_display_name('Crown Residences LLC') = 'Crown Residences LLC'
  and public.state_cleanup_display_name('Viridian Residential Development') = 'Viridian Residential Development'
  and public.state_cleanup_display_name('Goldfarb Property') = 'Goldfarb Property'
  and public.state_cleanup_display_name('CITGO (FORMER)') = 'CITGO (FORMER)'
  and public.state_cleanup_display_name(null) is null);
update public.state_cleanup_sites set name = 'Ellis Residence' where site_key = '89284058';
select pg_temp.ok('reader withholds a private name and says so; the stored row keeps it',
  (select x ->> 'name' = 'Residential property' and (x ->> 'name_withheld')::boolean
     from jsonb_array_elements(public.map1_state_cleanup_zip_members('33301') -> 'sites') x where x ->> 'site_key' = '89284058')
  and (select name = 'Ellis Residence' from public.state_cleanup_sites where site_key = '89284058'));
select pg_temp.ok('reader does not mark an ordinary name withheld',
  (select x ->> 'name' = 'CITGO (FORMER)' and not (x ? 'name_withheld')
     from jsonb_array_elements(public.map1_state_cleanup_zip_members('33301') -> 'sites') x where x ->> 'site_key' = '89287788'));
update public.state_cleanup_sites set name = 'BCGC Gore Building' where site_key = '89284058';
select pg_temp.ok('a site with its own record link counts 1',
  (select (x ->> 'record_url_sites')::int = 1 from jsonb_array_elements(public.map1_state_cleanup_zip_members('33301') -> 'sites') x
    where x ->> 'site_key' = '89287788'));
create temp table url_keep as select site_key, record_url from public.state_cleanup_sites where site_key = '89282856';
update public.state_cleanup_sites set record_url = (select record_url from public.state_cleanup_sites where site_key = '89287788') where site_key = '89282856';
select pg_temp.ok('two current sites sharing a record link each count 2 (across ZIPs)',
  (select (x ->> 'record_url_sites')::int = 2 from jsonb_array_elements(public.map1_state_cleanup_zip_members('33301') -> 'sites') x
    where x ->> 'site_key' = '89287788'));
update public.state_cleanup_sites set removed_from_source_at = now() where site_key = '89282856';
select pg_temp.ok('a removed site does not count toward a shared record link',
  (select (x ->> 'record_url_sites')::int = 1 from jsonb_array_elements(public.map1_state_cleanup_zip_members('33301') -> 'sites') x
    where x ->> 'site_key' = '89287788'));
update public.state_cleanup_sites s set record_url = k.record_url, removed_from_source_at = null from url_keep k where s.site_key = k.site_key;
select pg_temp.ok('reader serves checked_at = the run that last confirmed the site',
  (select (x ->> 'checked_at')::timestamptz = s.last_seen_at
     from jsonb_array_elements(public.map1_state_cleanup_zip_members('33301') -> 'sites') x
     join public.state_cleanup_sites s on s.site_key = x ->> 'site_key' where s.site_key = '89287788'));
select pg_temp.ok('anon cannot call the display-name rule directly', not has_function_privilege('anon', 'public.state_cleanup_display_name(text)', 'execute'));

-- 5. near reader (address mode)
select pg_temp.ok('near: 0.5 mi of Citgo returns Citgo only',
  (select string_agg(x ->> 'site_key', ',') from jsonb_array_elements(public.map1_state_cleanup_near(26.1195, -80.1284, 0.5) -> 'sites') x) = '89287788');
select pg_temp.ok('near: a radius over 20 mi returns nothing',
  jsonb_array_length(public.map1_state_cleanup_near(26.12, -80.13, 50) -> 'sites') = 0);

-- 6. second run: Citgo changes status, Gore leaves DEP's list, Sony unchanged except load date
update feat set f = jsonb_set(f, '{attributes,RSC2_REMEDIATION_STATUS_KEY}', '"ONHOLD"') where k = 'citgo';
update feat set f = jsonb_set(f, '{attributes,DATA_LOAD_DATE}', '1792652409000') where k = 'sony';
update public.state_cleanup_runs set fired_at = fired_at - interval '2 hours';
select public.state_cleanup_fl_fire();
select pg_temp.answer(3, array['citgo','sony','nolink']);
select public.state_cleanup_fl_collect();
select pg_temp.ok('run 2 complete', (select outcome = 'complete' from public.state_cleanup_runs order by run_id desc limit 1));
select pg_temp.ok('a changed status is one changed observation', (select count(*) = 1 from public.state_cleanup_site_observations where event = 'changed' and site_key = '89287788'));
select pg_temp.ok('a new load date alone is not a change', (select count(*) = 0 from public.state_cleanup_site_observations where event = 'changed' and site_key = '89282856'));
select pg_temp.ok('a site that leaves the list is kept, marked removed',
  (select removed_from_source_at is not null from public.state_cleanup_sites where site_key = '89284058'));
select pg_temp.ok('removal is recorded as an observation', (select count(*) = 1 from public.state_cleanup_site_observations where event = 'removed_from_source' and site_key = '89284058'));
select pg_temp.ok('a removed site is not drawn',
  (select count(*) = 0 from jsonb_array_elements(public.map1_state_cleanup_zip_members('33301') -> 'sites') x where x ->> 'site_key' = '89284058'));
select pg_temp.ok('first_seen_at survives an update',
  (select first_seen_at < last_seen_at or first_seen_at = (select min(observed_at) from public.state_cleanup_site_observations o where o.site_key = s.site_key)
     from public.state_cleanup_sites s where site_key = '89287788'));
select pg_temp.ok('the original observation is still there', (select count(*) = 1 from public.state_cleanup_site_observations where event = 'first_seen' and site_key = '89287788'));

-- 7. a short run (DEP says 4, only 3 arrive) writes nothing and removes nothing
update public.state_cleanup_runs set fired_at = fired_at - interval '2 hours';
select public.state_cleanup_fl_fire();
select pg_temp.answer(4, array['citgo','sony']);
create temp table snap as select site_key, content_md5, removed_from_source_at from public.state_cleanup_sites;
select public.state_cleanup_fl_collect();
select pg_temp.ok('short run fails', (select outcome = 'failed' from public.state_cleanup_runs order by run_id desc limit 1));
select pg_temp.ok('short run changed nothing',
  not exists (select site_key, content_md5, removed_from_source_at from public.state_cleanup_sites
              except select * from snap));

-- 8. an error page fails the run
update public.state_cleanup_runs set fired_at = fired_at - interval '2 hours';
select public.state_cleanup_fl_fire();
-- the data pages are complete; the overflow page (offset 14000) answers an error instead of [].
select pg_temp.answer(3, array['citgo','sony','nolink'], 200, null, '{"error":{"code":400,"message":"Unable to complete operation."}}');
select public.state_cleanup_fl_collect();
select pg_temp.ok('error page fails the run', (select outcome = 'failed' from public.state_cleanup_runs order by run_id desc limit 1));
select pg_temp.ok('error page changed nothing',
  not exists (select site_key, content_md5, removed_from_source_at from public.state_cleanup_sites except select * from snap));

-- 9. a 500 fails the run
update public.state_cleanup_runs set fired_at = fired_at - interval '2 hours';
select public.state_cleanup_fl_fire();
select pg_temp.answer(3, array['citgo','sony','nolink'], 500);
select public.state_cleanup_fl_collect();
select pg_temp.ok('HTTP 500 fails the run', (select outcome = 'failed' from public.state_cleanup_runs order by run_id desc limit 1));

-- 10. a site that comes back
update public.state_cleanup_runs set fired_at = fired_at - interval '2 hours';
select public.state_cleanup_fl_fire();
select pg_temp.answer(4, array['citgo','gore','sony','nolink']);
select public.state_cleanup_fl_collect();
select pg_temp.ok('a returning site is current again with a returned_to_source observation',
  (select removed_from_source_at is null from public.state_cleanup_sites where site_key = '89284058')
  and (select count(*) = 1 from public.state_cleanup_site_observations where event = 'returned_to_source' and site_key = '89284058'));

-- 10b. a second source (Washington Ecology), loaded by the same shared fire / collect
insert into feat values
 ('wa_coupe', '{"attributes":{"City":"COUPEVILLE","County":"Island","Address":"1 S MAIN ST","ZipCode":"98239","OBJECTID":14212,"SiteRank":null,"SiteStatus":"Cleanup Started","CleanupSiteId":10008,"FacilitySiteId":64473279,"CleanupSiteName":"Coupeville Country Store"},"geometry":{"x":-122.68578411499313,"y":48.211804727846456}}'),
 ('wa_other', '{"attributes":{"City":"COUPEVILLE","County":"Island","Address":"2 N MAIN ST","ZipCode":"98239-1234","OBJECTID":14213,"SiteRank":null,"SiteStatus":"Awaiting Cleanup","CleanupSiteId":10009,"FacilitySiteId":64473280,"CleanupSiteName":"Test Second Site"},"geometry":{"x":-122.686,"y":48.212}}');
create temp table fl_snap as select site_key, content_md5, removed_from_source_at from public.state_cleanup_sites where source = 'fl_dep_cleanup';
select public.state_cleanup_fire('wa_ecology_cleanup');
select pg_temp.ok('wa fire: one count request + 6 page requests',
  (select source = 'wa_ecology_cleanup' and cardinality(page_reqs) = 6 from public.state_cleanup_runs order by run_id desc limit 1));
select pg_temp.ok('wa fire: count and pages carry the not-closed filter, offsets 0..10000',
  (select count(*) = 7 from net.http_request_log where url like 'https://gis.ecology.wa.gov/%where=SiteStatus%3C%3E%27No%20Further%20Action%27&%')
  and (select count(*) = 6 from net.http_request_log where url like 'https://gis.ecology.wa.gov/%' and url ~ 'resultOffset=(0|2000|4000|6000|8000|10000)&'));
select pg_temp.answer(2, array['wa_coupe','wa_other']);
select public.state_cleanup_collect();
select pg_temp.ok('wa run complete', (select outcome = 'complete' from public.state_cleanup_runs order by run_id desc limit 1));
select pg_temp.ok('wa: 2 sites stored under their own source', (select count(*) = 2 from public.state_cleanup_sites where source = 'wa_ecology_cleanup'));
select pg_temp.ok('wa: record link is the site''s own Ecology page; ZIP+4 cut to 5; status verbatim',
  (select record_url = 'https://apps.ecology.wa.gov/cleanupsearch/site/10008' and status = 'Cleanup Started' and state = 'WA'
     from public.state_cleanup_sites where source = 'wa_ecology_cleanup' and site_key = '10008')
  and (select source_zip5 = '98239' from public.state_cleanup_sites where source = 'wa_ecology_cleanup' and site_key = '10009'));
select pg_temp.ok('wa: Florida rows untouched by a Washington run',
  not exists (select site_key, content_md5, removed_from_source_at from public.state_cleanup_sites where source = 'fl_dep_cleanup'
              except select * from fl_snap)
  and (select count(*) from public.state_cleanup_sites where source = 'fl_dep_cleanup') = (select count(*) from fl_snap));
select pg_temp.ok('zip 98239 serves both Washington sites with Ecology as the agency',
  (select string_agg(x ->> 'site_key', ',' order by x ->> 'site_key') = '10008,10009' and bool_and(x ->> 'agency' = 'Washington Ecology')
     from jsonb_array_elements(public.map1_state_cleanup_zip_members('98239') -> 'sites') x));
select pg_temp.ok('florida rows still name Florida DEP',
  (select bool_and(x ->> 'agency' = 'Florida DEP') from jsonb_array_elements(public.map1_state_cleanup_zip_members('33301') -> 'sites') x));
-- second Washington run: one site leaves the list, the other only changes its OBJECTID
update feat set f = jsonb_set(f, '{attributes,OBJECTID}', '99999') where k = 'wa_coupe';
update public.state_cleanup_runs set fired_at = fired_at - interval '2 hours';
select public.state_cleanup_fire('wa_ecology_cleanup');
select pg_temp.answer(1, array['wa_coupe']);
select public.state_cleanup_collect();
select pg_temp.ok('wa: a new OBJECTID alone is not a change',
  (select count(*) = 0 from public.state_cleanup_site_observations where source = 'wa_ecology_cleanup' and event = 'changed'));
select pg_temp.ok('wa: a site that leaves the list is kept, marked removed; Florida not touched',
  (select removed_from_source_at is not null from public.state_cleanup_sites where source = 'wa_ecology_cleanup' and site_key = '10009')
  and not exists (select site_key, content_md5, removed_from_source_at from public.state_cleanup_sites where source = 'fl_dep_cleanup'
                  except select * from fl_snap));
do $$ begin
  perform public.state_cleanup_fire('nope');
  insert into chk (name, ok, detail) values ('fire refuses an unknown source', false, 'no error');
exception when others then
  insert into chk (name, ok, detail) values ('fire refuses an unknown source', sqlerrm like 'unknown state cleanup source%', sqlerrm);
end $$;

-- 11. who can run what
select pg_temp.ok('anon can read the ZIP reader', has_function_privilege('anon', 'public.map1_state_cleanup_zip_members(text)', 'execute'));
select pg_temp.ok('anon can read the near reader', has_function_privilege('anon', 'public.map1_state_cleanup_near(double precision,double precision,double precision)', 'execute'));
select pg_temp.ok('anon cannot fire', not has_function_privilege('anon', 'public.state_cleanup_fl_fire()', 'execute'));
select pg_temp.ok('authenticated cannot collect', not has_function_privilege('authenticated', 'public.state_cleanup_fl_collect()', 'execute'));
select pg_temp.ok('anon cannot read the tables', not has_table_privilege('anon', 'public.state_cleanup_sites', 'select')
  and not has_table_privilege('anon', 'public.state_cleanup_site_observations', 'select'));
select pg_temp.ok('both cron jobs scheduled', (select count(*) = 2 from cron.job where jobname like 'state-cleanup-fl-%'));
select pg_temp.ok('washington fire scheduled', (select count(*) = 1 from cron.job where jobname = 'state-cleanup-wa-fire'
  and command = 'select public.state_cleanup_fire(''wa_ecology_cleanup'')'));
select pg_temp.ok('anon cannot fire or collect a source', not has_function_privilege('anon', 'public.state_cleanup_fire(text)', 'execute')
  and not has_function_privilege('anon', 'public.state_cleanup_collect()', 'execute')
  and not has_function_privilege('authenticated', 'public.state_cleanup_fire(text)', 'execute'));
select pg_temp.ok('anon cannot read the sources table', not has_table_privilege('anon', 'public.state_cleanup_sources', 'select'));

select name, case when ok then 't' else 'f' end, detail from chk order by n;

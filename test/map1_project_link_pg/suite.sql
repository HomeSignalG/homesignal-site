-- MAP 1 PROJECT LINK + DOCUMENTS (docs/map1-project-link.sql) — executable suite on a disposable PostGIS.
-- Synthetic ZIP 99901 (the notched polygon of test/map1_dc_publication_pg), 99902 has no boundary.
-- Every expected answer is a hard-coded constant. Output: check|pass|detail.
create temp table if not exists _pl_result (n serial, check_name text, pass boolean, detail text);
truncate _pl_result;

create temp table if not exists _pl_poly as
select ST_Multi(ST_GeomFromText(
  'POLYGON((-100 40, -99.6 40, -99.6 40.18, -99.82 40.18, -99.82 40.22, -99.6 40.22, -99.6 40.4, -100 40.4, -100 40))',
  4269))::geometry(MultiPolygon, 4269) as geom;
delete from geo.zcta_boundary where zcta5 in ('99901', '99902', '99903');
insert into geo.zcta_boundary (zcta5, geom) select '99901', geom from _pl_poly;
truncate public.canonical_zip_registry;
insert into public.canonical_zip_registry values ('99901'), ('99902');
insert into public.dc_source values ('compute_atlas', 'Compute Atlas', 'CC BY 4.0'), ('epoch_ai', 'Epoch AI', 'CC BY 4.0')
on conflict (source_key) do nothing;

truncate public.dc_entity_geography, public.dc_entity_observation, public.dc_canonical_entity, public.dc_source_observation,
         public.dc_observation_record_key, geo.n5_serving_membership;
delete from public.national_dc_records where source_key like 'pl:%';

-- One observation with a record key, linked to an entity (new, or an existing one by name).
create or replace function pg_temp.obs(p_name text, p_src text, p_key text, p_rank int, p_entity uuid,
                                       p_lat double precision, p_lng double precision, p_gstatus text default 'RESOLVED')
returns uuid language plpgsql as $$
declare v_obs uuid; v_ent uuid := p_entity;
begin
  insert into public.dc_source_observation (source_key, raw_payload, source_native_name, source_native_status,
      source_native_address, source_native_lat, source_native_lon, source_native_precision)
  values (p_src, jsonb_build_object('sources', jsonb_build_array(jsonb_build_object('url', 'https://example.test/' || p_key))),
          p_name, 'proposed', '{"city":"Testville","state":"ZZ"}', p_lat, p_lng, 'exact')
  returning home_signal_observation_id into v_obs;
  if v_ent is null then
    insert into public.dc_canonical_entity (classification) values ('CONFIRMED_DC') returning canonical_entity_id into v_ent;
    insert into public.dc_entity_geography (canonical_entity_id, geography_status, geometry_type, geom, lat, lng,
        authority_observation_id, publisher_precision, quality_flags)
    values (v_ent, p_gstatus, case when p_gstatus = 'RESOLVED' then 'POINT' end,
            case when p_gstatus = 'RESOLVED' then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) end,
            p_lat, p_lng, v_obs, 'exact', '{}');
  end if;
  insert into public.dc_entity_observation (home_signal_observation_id, canonical_entity_id) values (v_obs, v_ent);
  insert into public.dc_observation_record_key values (v_obs, p_key, p_rank);
  return v_ent;
end $$;

create temp table _pl_ent (label text primary key, id uuid);
insert into _pl_ent select 'alpha', pg_temp.obs('Alpha DC', 'compute_atlas', 'compute_atlas|facilities|alpha', 0, null, 40.30, -99.90);
-- beta: an old entity superseded by a new one that also carries an Epoch record (a merge)
insert into _pl_ent select 'beta_new', pg_temp.obs('Beta DC', 'epoch_ai', 'epoch_ai|data_centers|beta', 0, null, 40.10, -99.95);
insert into _pl_ent select 'beta_old', pg_temp.obs('Beta DC', 'compute_atlas', 'compute_atlas|facilities|beta', 0, null, 40.10, -99.95);
update public.dc_canonical_entity set superseded_by = (select id from _pl_ent where label = 'beta_new')
 where canonical_entity_id = (select id from _pl_ent where label = 'beta_old');
insert into _pl_ent select 'gamma', pg_temp.obs('Gamma DC', 'compute_atlas', 'compute_atlas|facilities|gamma', 0, null, 40.3, -99.8, 'GEOGRAPHY_UNRESOLVED');
insert into _pl_ent select 'single', pg_temp.obs('Single DC', 'compute_atlas', 'singleton|x1', 2, null, 40.25, -99.93);
-- one record key linked to two standing entities: ambiguous
insert into _pl_ent select 'amb1', pg_temp.obs('Amb DC', 'compute_atlas', 'compute_atlas|facilities|amb', 0, null, 40.26, -99.92);
insert into _pl_ent select 'amb2', pg_temp.obs('Amb DC 2', 'compute_atlas', 'compute_atlas|facilities|amb', 0, null, 40.27, -99.91);

insert into public.national_dc_records (source_key, source_record_id, osm_type, source_url, project_name, raw_status,
  normalized_status, lat, lng, location_precision, map_eligible, map_exclusion_reason)
values ('pl:osm-in', '1', 'way', 'https://example.test/osm1', 'OSM inside', 'operational', 'operational', 40.36, -99.66, 'precise_location', true, null),
       ('pl:osm-out', '2', 'way', 'https://example.test/osm2', 'OSM in notch', 'operational', 'operational', 40.20, -99.70, 'precise_location', true, null);
insert into geo.n5_serving_membership values ('99901', 'arcgis:city:1'), ('99977', 'arcgis:city:2');

create or replace function pg_temp.loc(k text, z text default null) returns jsonb language sql as $$ select public.map1_project_locate(k, z) $$;
create or replace function pg_temp.mk(l text) returns text language sql as $$ select 'dc:' || id::text from _pl_ent where label = l $$;

insert into _pl_result(check_name, pass, detail) select 'L1 a publisher record key opens its data center on its ZIP',
  r->>'state' = 'found' and r->>'zip' = '99901' and r->>'map_key' = pg_temp.mk('alpha'), r::text
  from (select pg_temp.loc('dcrec:compute_atlas|facilities|alpha') r) x;
insert into _pl_result(check_name, pass, detail) select 'L2 a record key whose entity was merged follows it to the entity that stands',
  r->>'state' = 'found' and r->>'map_key' = pg_temp.mk('beta_new'), r::text
  from (select pg_temp.loc('dcrec:compute_atlas|facilities|beta') r) x;
insert into _pl_result(check_name, pass, detail) select 'L3 the merged entity''s other publisher key opens the same project',
  r->>'map_key' = pg_temp.mk('beta_new'), r::text
  from (select pg_temp.loc('dcrec:epoch_ai|data_centers|beta') r) x;
insert into _pl_result(check_name, pass, detail) select 'L4 a project Map 1 does not draw is not_on_map (never another ZIP or pin)',
  r->>'state' = 'not_on_map' and jsonb_array_length(r->'zips') = 0, r::text
  from (select pg_temp.loc('dcrec:compute_atlas|facilities|gamma') r) x;
insert into _pl_result(check_name, pass, detail) select 'L5 a singleton record key is never a project key',
  r->>'state' = 'unknown_key', r::text from (select pg_temp.loc('dcrec:singleton|x1') r) x;
insert into _pl_result(check_name, pass, detail) select 'L6 one key on two standing entities is ambiguous, not a guess',
  r->>'state' = 'ambiguous', r::text from (select pg_temp.loc('dcrec:compute_atlas|facilities|amb') r) x;
insert into _pl_result(check_name, pass, detail) select 'L7 an OSM entry Map 1 draws opens under its own source key',
  r->>'state' = 'found' and r->>'map_key' = 'pl:osm-in', r::text from (select pg_temp.loc('nat:pl:osm-in') r) x;
insert into _pl_result(check_name, pass, detail) select 'L8 an OSM point outside the ZIP polygon is not on the map',
  r->>'state' = 'not_on_map', r::text from (select pg_temp.loc('nat:pl:osm-out') r) x;
insert into _pl_result(check_name, pass, detail) select 'L9 a development record opens on its serving-generation ZIP',
  r->>'state' = 'found' and r->>'zip' = '99901' and r->>'map_key' = 'n5:arcgis:city:1', r::text from (select pg_temp.loc('n5:arcgis:city:1') r) x;
insert into _pl_result(check_name, pass, detail) select 'L10 a development record on a ZIP with no page is not on the map',
  r->>'state' = 'not_on_map', r::text from (select pg_temp.loc('n5:arcgis:city:2') r) x;
insert into _pl_result(check_name, pass, detail) select 'L11 a malformed key is refused',
  (select bool_and(pg_temp.loc(k)->>'state' = 'bad_key') from unnest(array['dc:abc', 'x', 'nat:', 'n5:a' || chr(10)]) k), null;
insert into _pl_result(check_name, pass, detail) select 'L12 an unknown OSM key is unknown_key',
  pg_temp.loc('nat:pl:nope')->>'state' = 'unknown_key', null;

-- documents
create temp table _pl_map_before as select * from public.map1_dc_zip_members('99901');
create temp table _pl_counts_before as select (select count(*) from public.dc_canonical_entity) e,
  (select count(*) from public.dc_entity_geography) g, (select count(*) from public.national_dc_records) r;
do $$ begin perform set_config('test.admin', 'no', false); end $$;
create temp table _pl_doc as select public.map1_project_document_propose('dcrec:compute_atlas|facilities|beta',
  'https://county.example.gov/rezoning.pdf', 'Rezoning application', 'Test County', 'application', date '2024-03-02',
  'Application filed', 'The site and the use applied for.', null, 'verification:run-1') as id;
insert into _pl_result(check_name, pass, detail) select 'D1 a proposed document starts pending and is not shown',
  public.map1_project_document_current(id) = 'pending'
  and not exists (select 1 from public.map1_project_documents(array[pg_temp.mk('beta_new')])), null from _pl_doc;
insert into _pl_result(check_name, pass, detail) select 'D2 proposing the same document again returns the same row',
  public.map1_project_document_propose('dcrec:compute_atlas|facilities|beta', 'https://county.example.gov/rezoning.pdf',
    'Rezoning application', 'Test County', 'application', date '2024-03-02', 'Application filed',
    'The site and the use applied for.', null, 'verification:run-2') = id, null from _pl_doc;
do $$ begin
  perform public.map1_project_document_propose('dcrec:compute_atlas|facilities|beta', 'https://county.example.gov/rezoning.pdf',
    'A different title', 'Test County', 'application', date '2024-03-02', 'Application filed', 'x', null, 'verification:run-3');
  insert into _pl_result(check_name, pass, detail) values ('D3 different details for an existing document are refused, not overwritten', false, 'accepted');
exception when unique_violation then
  insert into _pl_result(check_name, pass, detail) values ('D3 different details for an existing document are refused, not overwritten', true, null);
end $$;
do $$ begin
  perform public.hs_map1_project_document_decide((select id from _pl_doc), 'approved', null);
  insert into _pl_result(check_name, pass, detail) values ('D4 only a dashboard admin decides', false, 'accepted');
exception when insufficient_privilege then
  insert into _pl_result(check_name, pass, detail) values ('D4 only a dashboard admin decides', true, null);
end $$;
do $$ begin perform set_config('test.admin', 'yes', false); end $$;
-- (a decision and a read of the reader are separate statements: the reader is STABLE and reads the statement's snapshot)
create temp table _pl_d5 as select public.hs_map1_project_document_decide(id, 'approved', null) as st from _pl_doc;
insert into _pl_result(check_name, pass, detail) select 'D5 approving shows it, under the merged entity''s map key',
  (select st from _pl_d5) = 'approved'
  and (select count(*) from public.map1_project_documents(array[pg_temp.mk('beta_new')]) d
        where d.map_key = pg_temp.mk('beta_new') and d.title = 'Rezoning application' and d.doc_date = date '2024-03-02') = 1, null;
insert into _pl_result(check_name, pass, detail) select 'D6 approving changes no project, entity, location or Map 1 row',
  (select (count(*), md5(string_agg(t::text, ',' order by t::text collate "C"))) from public.map1_dc_zip_members('99901') t)
  = (select (count(*), md5(string_agg(t::text, ',' order by t::text collate "C"))) from _pl_map_before t)
  and (select row(e,g,r) from _pl_counts_before) = row((select count(*) from public.dc_canonical_entity),
       (select count(*) from public.dc_entity_geography), (select count(*) from public.national_dc_records)), null;
do $$ begin
  perform public.hs_map1_project_document_decide((select id from _pl_doc), 'rejected', 'x');
  insert into _pl_result(check_name, pass, detail) values ('D7 an approved document cannot be rejected (only revoked)', false, 'accepted');
exception when object_not_in_prerequisite_state then
  insert into _pl_result(check_name, pass, detail) values ('D7 an approved document cannot be rejected (only revoked)', true, null);
end $$;
do $$ begin
  perform public.hs_map1_project_document_decide((select id from _pl_doc), 'revoked', null);
  insert into _pl_result(check_name, pass, detail) values ('D8 revoking needs a reason', false, 'accepted');
exception when check_violation then
  insert into _pl_result(check_name, pass, detail) values ('D8 revoking needs a reason', true, null);
end $$;
create temp table _pl_d9 as select public.hs_map1_project_document_decide(id, 'revoked', 'wrong project') as st from _pl_doc;
insert into _pl_result(check_name, pass, detail) select 'D9 a revoked document is no longer shown',
  (select st from _pl_d9) = 'revoked'
  and not exists (select 1 from public.map1_project_documents(array[pg_temp.mk('beta_new')])), null;
insert into _pl_result(check_name, pass, detail) select 'D10 the full history is kept, in order',
  (select string_agg(decision, ',' order by decision_id) from public.map1_project_document_decision where document_id = (select id from _pl_doc))
  = 'approved,revoked', null;
do $$ begin
  update public.map1_project_document_decision set decision = 'approved';
  insert into _pl_result(check_name, pass, detail) values ('D11 decisions cannot be edited', false, 'updated');
exception when object_not_in_prerequisite_state then
  insert into _pl_result(check_name, pass, detail) values ('D11 decisions cannot be edited', true, null);
end $$;
do $$ begin
  delete from public.map1_project_document;
  insert into _pl_result(check_name, pass, detail) values ('D12 documents cannot be deleted', false, 'deleted');
exception when object_not_in_prerequisite_state then
  insert into _pl_result(check_name, pass, detail) values ('D12 documents cannot be deleted', true, null);
end $$;
-- a rejected document never shows; a second project's document never shows on the first
create temp table _pl_doc2 as select public.map1_project_document_propose('nat:pl:osm-in', 'https://x.example.gov/a', 'Permit',
  'Test County', 'permit', null, null, 'A permit for the site.', null, 'founder:test') as id;
create temp table _pl_d13 as select public.hs_map1_project_document_decide(id, 'rejected', 'not this project') as st from _pl_doc2;
insert into _pl_result(check_name, pass, detail) select 'D13 a rejected document is not shown',
  (select st from _pl_d13) = 'rejected'
  and not exists (select 1 from public.map1_project_documents(array['pl:osm-in'])), null;
create temp table _pl_d14 as select public.hs_map1_project_document_decide(id, 'approved', null) as st from _pl_doc2;
insert into _pl_result(check_name, pass, detail) select 'D14 a document is shown only on its own project',
  (select st from _pl_d14) = 'approved'
  and (select count(*) from public.map1_project_documents(array['pl:osm-in', pg_temp.mk('alpha')])) = 1
  and (select map_key from public.map1_project_documents(array['pl:osm-in', pg_temp.mk('alpha')])) = 'pl:osm-in', null;
insert into _pl_result(check_name, pass, detail) select 'D15 grants: visitors read and locate; only the service role proposes; decide needs a signed-in admin',
  has_function_privilege('anon', 'public.map1_project_locate(text, text)', 'execute')
  and has_function_privilege('anon', 'public.map1_project_documents(text[])', 'execute')
  and not has_function_privilege('anon', 'public.map1_project_document_propose(text, text, text, text, text, date, text, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.map1_project_document_propose(text, text, text, text, text, date, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.hs_map1_project_document_decide(uuid, text, text)', 'execute')
  and not has_table_privilege('anon', 'public.map1_project_document', 'select'), null;

select check_name, coalesce(pass, false), coalesce(detail, '') from _pl_result order by n;

with v as (
with
-- The candidate superset. A LEAD filter, never a decider: every literal the shipped
-- classifier matches (DATACENTER_RE, TYPE_EXACT) contains data<=3 non-letters>cent|hall,
-- hyper or server, and test/dc-step3c-reconcile.test.mjs asserts that against lib/map.js.
legacy_rows as (
  select p.*
    from public.app_projects p
   where p.type     ~* 'data[^a-z]{0,3}(cent|hall)|hyper|server'
      or p.type_raw ~* 'data[^a-z]{0,3}(cent|hall)|hyper|server'
      or p.name     ~* 'data[^a-z]{0,3}(cent|hall)|hyper|server'
),
legacy as (
  select
    r.source_key                                        as record_key,
    case when min(r.record_kind) = 'facility' then 'legacy_facility'
         else 'legacy_development' end                  as source_population,
    case when min(r.record_kind) = 'facility' then 'FACILITY_REGISTRATION'
         else 'DEVELOPMENT_FILING' end                  as record_grain,
    'app_projects'::text                                as resident_storage_plane,
    min(r.registry_id)                                  as publisher_or_dataset,
    min(r.source_key_basis)                             as source_native_key_basis,
    min(r.source_ref)                                   as source_url,
    count(*)::int                                       as storage_rows,
    count(distinct r.zip)::int                          as resident_zip_count,
    count(distinct r.record_kind)::int                  as record_kind_count,
    jsonb_agg(distinct jsonb_build_object(
        'record_kind', r.record_kind, 'type', r.type, 'type_raw', r.type_raw,
        'name', r.name, 'status', r.status, 'stage', r.stage,
        'registry_id', r.registry_id, 'source_ref', r.source_ref))
                                                        as classifier_inputs,
    null::boolean                                       as osm_map_eligible,
    true                                                as resident_reachable,
    'app_projects is anon-readable (policy app_projects_read)'::text
                                                        as reachability_basis,
    -- DECLARED, never inferred. No dc_source is registered for any legacy publisher, so this
    -- is NULL and the evidence join below cannot match. Onboarding a publisher through
    -- dc_evidence_writer sets it here, in the same PR.
    null::text                                          as dc_source_key
  from legacy_rows r
  where r.source_key is not null
  group by r.source_key
),
admitted as (
  select s.zip
    from geo.maps_zip_geography_status s
    join public.development_reports d on d.zip = s.zip
   where s.status = 'boundary_complete'
),
reached as (
  select distinct r.source_key
    from admitted a
    cross join lateral public.national_dc_for_zip(a.zip, 5) r
),
osm as (
  select
    n.source_key                                        as record_key,
    'osm'::text                                         as source_population,
    'PHYSICAL_SITE'::text                               as record_grain,
    'national_dc_records'::text                         as resident_storage_plane,
    n.source_name                                       as publisher_or_dataset,
    ('osm:' || n.osm_type)                              as source_native_key_basis,
    n.source_url                                        as source_url,
    1                                                   as storage_rows,
    null::int                                           as resident_zip_count,
    1                                                   as record_kind_count,
    null::jsonb                                         as classifier_inputs,
    n.map_eligible                                      as osm_map_eligible,
    (x.source_key is not null)                          as resident_reachable,
    case when x.source_key is not null
           then 'returned by national_dc_for_zip for >= 1 Fix-29-admitted ZIP page'
         when not n.map_eligible
           then 'never served: national_dc_for_zip filters map_eligible'
         else 'map_eligible but returned for no admitted ZIP page' end
                                                        as reachability_basis,
    null::text                                          as dc_source_key  -- OSM is not a registered dc_source
  from public.national_dc_records n
  left join reached x on x.source_key = n.source_key
),
unioned as (select * from legacy union all select * from osm)
select
  u.record_key,
  u.source_population,
  u.record_grain,
  u.resident_storage_plane,
  u.publisher_or_dataset,
  u.source_native_key_basis,
  u.source_url,
  u.storage_rows,
  u.resident_zip_count,
  u.record_kind_count,
  u.classifier_inputs,
  u.osm_map_eligible,
  u.resident_reachable,
  u.reachability_basis,
  u.dc_source_key,
  o.home_signal_observation_id                          as source_observation_id,
  eo.canonical_entity_id                                as canonical_entity_id,
  'docs/dc-step3c-ledger-distinct-record-grain.sql'::text as proof_reference
from unioned u
left join public.dc_current_observation o
       on o.source_key = u.dc_source_key     -- scoped: (source, publisher id) or nothing
      and o.publisher_record_id = u.record_key
left join public.dc_entity_observation eo
       on eo.home_signal_observation_id = o.home_signal_observation_id
)
select json_build_object(
 'rows',(select count(*) from v),'keys',(select count(distinct record_key) from v),
 'by',(select json_agg(json_build_object('pop',source_population,'grain',record_grain,'reach',resident_reachable,'elig',osm_map_eligible,'n',n,'storage_rows',sr) order by source_population collate "C", resident_reachable, osm_map_eligible) from (select source_population, record_grain, resident_reachable, osm_map_eligible, count(*) n, sum(storage_rows) sr from v group by 1,2,3,4) q),
 'multi_kind',(select count(*) from v where record_kind_count<>1),
 'with_obs',(select count(source_observation_id) from v),
 'legacy_keys_fp',(select md5(string_agg(record_key, ',' order by record_key collate "C")) from v where resident_storage_plane='app_projects'),
 'osm_reach_fp',(select md5(string_agg(record_key, ',' order by record_key collate "C")) from v where source_population='osm' and resident_reachable)
) facts;

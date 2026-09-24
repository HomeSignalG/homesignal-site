-- dc-epoch-dryrun-report.sql — the PRODUCTION DRY RUN of automatic Epoch canonical geography.
-- Run ONLY by .github/workflows/dc-epoch-dryrun.yml, inside ONE transaction that it ALWAYS rolls back:
--
--   begin;
--     _before  <- map1_dc_zip_members over all 12,722 canonical ZIP pages (today's production)
--     \i the apply body (drift guard first: refuses if live definitions moved)
--     _dcg_in  <- derivations from the production ladder (dry-run store: the cache is not written)
--     \i docs/dc-geocode-observations-load.sql       (the writer's own load path)
--     dc_resolve_canonical(true, false); dc_resolve_geography(true)   (the scheduled resolvers)
--     \i THIS FILE
--   rollback;
--
-- Nothing persists. Every number below is measured on production data as it would stand after
-- apply, and every receipt carries its control. Output: `metric|before|after` rows, then one JSON
-- line per current Epoch record between the DISPOSITIONS markers.

-- ── the national page set, after ─────────────────────────────────────────────────────────────
create temp table _after as
select r.zip, m.*
  from public.canonical_zip_registry r
 cross join lateral public.map1_dc_zip_members(r.zip) m;

-- ── every current Epoch data-centre record, with its automatic outcome ────────────────────────
create temp table _ep as
select c.home_signal_observation_id oid, c.source_native_name as name,
       coalesce(c.raw_payload->>'Country', '') as country,
       c.raw_payload->>'Address' as address,
       rk.record_key, rk.record_key_rank, ri.identity_state,
       eo.canonical_entity_id eid, e.classification, e.superseded_by,
       g.geography_status, g.rule_key as geo_rule, g.lat, g.lng, g.positional_uncertainty_m,
       dp.input_quality, dp.verdict as geocode_verdict, dp.match_type,
       public.dc_record_citation(c.source_key, c.distribution_key, c.raw_payload) as cite,
       (select string_agg(distinct a.zip, ',' order by a.zip) from _after a
         where a.canonical_entity_id = eo.canonical_entity_id) as published_zips,
       exists (select 1 from public.dc_entity_observation x
                where x.canonical_entity_id = eo.canonical_entity_id and x.source_key <> 'epoch_ai') as has_other_source
  from public.dc_current_observation c
  join public.dc_observation_record_key rk on rk.home_signal_observation_id = c.home_signal_observation_id
  join public.dc_record_identity ri on ri.home_signal_observation_id = c.home_signal_observation_id
  left join public.dc_entity_observation eo on eo.home_signal_observation_id = c.home_signal_observation_id
  left join public.dc_canonical_entity e on e.canonical_entity_id = eo.canonical_entity_id
  left join public.dc_entity_geography g on g.canonical_entity_id = eo.canonical_entity_id
  left join public.dc_observation_derived_point dp on dp.home_signal_observation_id = c.home_signal_observation_id
 where c.source_key = 'epoch_ai' and c.distribution_key = 'data_centers';

-- ZCTAs an entity's point could truly occupy (the uncertainty disk), for withhold reasons
create temp table _ep_disk as
select p.oid,
       (select count(*) from geo.zcta_boundary z
         where z.geom is not null
           and z.geom && ST_Expand(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4269), coalesce(p.positional_uncertainty_m, 0) / 25000.0)
           and ST_DWithin(z.geom::geography, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4269)::geography,
                          coalesce(p.positional_uncertainty_m, 0))) as zctas
  from _ep p where p.geography_status = 'RESOLVED';

create temp table _ep_bucket as
select p.*,
       case when p.identity_state = 'AUTO_CONFIRMED_MATCH' then 'AUTO_MATCHED_EXISTING_ENTITY'
            when p.identity_state = 'IDENTITY_UNRESOLVED' then 'IDENTITY_UNRESOLVED'
            when p.geography_status is distinct from 'RESOLVED' then 'GEOGRAPHY_UNRESOLVED'
            when p.published_zips is not null then 'AUTO_DISTINCT_NEW_ENTITY'
            else 'OTHER_CANONICAL_WITHHOLD' end as bucket,
       case when p.identity_state = 'AUTO_CONFIRMED_MATCH' then 'AUTO_EXACT_SITE_ADDRESS'
            when p.identity_state = 'IDENTITY_UNRESOLVED' then 'OPEN_CROSS_SOURCE_CANDIDATE'
            when p.geography_status is distinct from 'RESOLVED' then
                 coalesce(p.geo_rule, 'NO_GEOGRAPHY') || ':' || coalesce(p.input_quality, '-') || '/' || coalesce(p.geocode_verdict, '-')
            when p.published_zips is not null then 'PUBLISHED'
            when p.classification <> 'CONFIRMED_DC' then 'WITHHELD_CLASSIFICATION_' || p.classification
            when p.cite is null then 'WITHHELD_NO_CITATION'
            when d.zctas = 0 then 'WITHHELD_OUTSIDE_EVERY_ZCTA'
            when d.zctas > 1 then 'WITHHELD_AMBIGUOUS_ZCTA_EDGE'
            else 'WITHHELD_OTHER' end as reason
  from _ep p left join _ep_disk d on d.oid = p.oid;

-- ── the receipts: metric | before | after ────────────────────────────────────────────────────
with ent_src as (
    select a.canonical_entity_id,
           bool_or(eo.source_key = 'compute_atlas') atlas, bool_or(eo.source_key = 'epoch_ai') epoch
      from (select distinct canonical_entity_id from _after where canonical_entity_id is not null) a
      join public.dc_entity_observation eo on eo.canonical_entity_id = a.canonical_entity_id
     group by a.canonical_entity_id
), before_src as (
    select count(distinct canonical_entity_id) filter (where canonical_entity_id is not null) n from _before
)
select * from (values
  -- IDENTITY
  ('I01 CURRENT_EPOCH_RECORDS', null, (select count(*) from _ep)::text),
  ('I02 STABLE_EPOCH_SOURCE_IDENTITIES', null, (select count(distinct record_key) from _ep where record_key_rank < 2)::text),
  ('I03 AUTO_MATCHED_ATLAS', null, (select count(*) from _ep where identity_state = 'AUTO_CONFIRMED_MATCH')::text),
  ('I04 AUTO_DISTINCT', null, (select count(*) from _ep where identity_state = 'AUTO_CONFIRMED_DISTINCT')::text),
  ('I05 IDENTITY_UNRESOLVED', null, (select count(*) from _ep where identity_state = 'IDENTITY_UNRESOLVED')::text),
  ('I06 NOT_AN_AUTOMATIC_STATE (must be 0)', null, (select count(*) from _ep where identity_state not in
        ('AUTO_CONFIRMED_MATCH', 'AUTO_CONFIRMED_DISTINCT', 'IDENTITY_UNRESOLVED'))::text),
  ('I07 MANUAL_IDENTITY_DECISIONS_REQUIRED (review objects on the path; must be 0)', null,
        ((select count(*) from pg_class where relname ilike '%identity_review%' and relnamespace = 'public'::regnamespace)
         + (select count(*) from _ep where identity_state not in ('AUTO_CONFIRMED_MATCH', 'AUTO_CONFIRMED_DISTINCT', 'IDENTITY_UNRESOLVED')))::text),
  ('I08 WRONG_SIBLING_MERGES (live entities holding two records of one source; must be 0)', null,
        (select count(*) from (select eo.canonical_entity_id
                                 from public.dc_entity_observation eo
                                 join public.dc_canonical_entity e on e.canonical_entity_id = eo.canonical_entity_id
                                 join public.dc_observation_record_key rk on rk.home_signal_observation_id = eo.home_signal_observation_id
                                where e.superseded_by is null and rk.record_key_rank < 2
                                group by eo.canonical_entity_id, split_part(rk.record_key, '|', 1), split_part(rk.record_key, '|', 2)
                               having count(distinct rk.record_key) > 1) x)::text),
  ('I09 RUN_CHURN_DUPLICATES (Epoch records with >1 live entity; must be 0)', null,
        (select count(*) from (select rk.record_key
                                 from public.dc_observation_record_key rk
                                 join public.dc_entity_observation eo on eo.home_signal_observation_id = rk.home_signal_observation_id
                                 join public.dc_canonical_entity e on e.canonical_entity_id = eo.canonical_entity_id
                                where rk.record_key like 'epoch_ai|data_centers|name:%' and e.superseded_by is null
                                group by rk.record_key having count(distinct eo.canonical_entity_id) > 1) x)::text),
  ('I10 LIVE_EPOCH_DATA_CENTRE_ENTITIES (was 270 for 92 records)', null,
        (select count(distinct eo.canonical_entity_id) from public.dc_entity_observation eo
           join public.dc_canonical_entity e on e.canonical_entity_id = eo.canonical_entity_id
          where eo.source_key = 'epoch_ai' and eo.distribution_key = 'data_centers' and e.superseded_by is null)::text),
  -- RECONCILIATION (the five buckets must sum to I01)
  ('R1 AUTO_MATCHED_EXISTING_ENTITY', null, (select count(*) from _ep_bucket where bucket = 'AUTO_MATCHED_EXISTING_ENTITY')::text),
  ('R2 AUTO_DISTINCT_NEW_ENTITY', null, (select count(*) from _ep_bucket where bucket = 'AUTO_DISTINCT_NEW_ENTITY')::text),
  ('R3 IDENTITY_UNRESOLVED', null, (select count(*) from _ep_bucket where bucket = 'IDENTITY_UNRESOLVED')::text),
  ('R4 GEOGRAPHY_UNRESOLVED', null, (select count(*) from _ep_bucket where bucket = 'GEOGRAPHY_UNRESOLVED')::text),
  ('R5 OTHER_CANONICAL_WITHHOLD', null, (select count(*) from _ep_bucket where bucket = 'OTHER_CANONICAL_WITHHOLD')::text),
  ('R6 RECONCILES (R1..R5 = I01)', null, ((select count(*) from _ep_bucket) = (select count(*) from _ep)
        and (select count(*) from _ep_bucket where bucket is null) = 0)::text),
  -- GEOGRAPHY
  ('G01 EPOCH_GEOCODE_ATTEMPTED', null, (select count(*) from _ep where match_type is not null)::text),
  ('G02 EPOCH_GEOCODE_ACCEPTED', null, (select count(*) from _ep where geocode_verdict = 'ACCEPTED')::text),
  ('G03 EPOCH_GEOCODE_REJECTED', null, (select count(*) from _ep where geocode_verdict like 'REJECTED%')::text),
  ('G04 EPOCH_NOT_GEOCODABLE (input rule)', null, (select count(*) from _ep where geocode_verdict = 'NOT_GEOCODABLE')::text),
  ('G05 EPOCH_GEOGRAPHY_RESOLVED', null, (select count(*) from _ep where geography_status = 'RESOLVED')::text),
  ('G06 EPOCH_GEOGRAPHY_UNRESOLVED', null, (select count(*) from _ep where geography_status is distinct from 'RESOLVED')::text),
  ('G07 PROVIDER_ZIP_USED_FOR_MEMBERSHIP (must be 0)', null,
        (select count(*) from _after a join public.dc_entity_geography g on g.canonical_entity_id = a.canonical_entity_id
          where g.provenance->>'location_basis' = 'DERIVED_ADDRESS'
            and geo.zip_point_membership_in(geo.zip_membership_boundary(a.zip), a.lat, a.lng) <> 'member')::text),
  ('G08 CENTROID_FALLBACK_USED (must be 0)', null,
        (select count(*) from public.dc_entity_geography g where g.geography_status = 'RESOLVED'
            and g.provenance->>'location_basis_rule' in ('zip_centroid', 'county_centroid'))::text),
  ('G09 NEAREST_ZIP_USED (rows outside their page polygon; must be 0)', null,
        (select count(*) from _after a where geo.zip_point_membership_in(geo.zip_membership_boundary(a.zip), a.lat, a.lng) <> 'member')::text),
  -- LIFECYCLE
  ('L1 EPOCH_SOURCE_LIFECYCLE_PRESENT', null,
        (select count(*) from public.dc_current_observation where source_key = 'epoch_ai' and distribution_key = 'data_centers'
            and source_native_status is not null)::text),
  ('L2 MATCHED_ENTITIES_USING_LIFECYCLE_FROM_OTHER_SOURCE', null,
        (select count(distinct a.canonical_entity_id) from _after a join ent_src s using (canonical_entity_id)
          where s.atlas and s.epoch and a.map_status <> 'Unknown')::text),
  ('L3 EPOCH_ONLY_UNKNOWN_LIFECYCLE (live Epoch-only entities)', null,
        (select count(distinct eid) from _ep where not has_other_source and superseded_by is null)::text),
  ('L4 EPOCH_ONLY_PUBLISHED_UNKNOWN_LIFECYCLE', null,
        (select count(distinct a.canonical_entity_id) from _after a join ent_src s using (canonical_entity_id)
          where s.epoch and not s.atlas and a.map_status = 'Unknown')::text),
  ('L5 EPOCH_ONLY_WITHHELD_FOR_LIFECYCLE (must be 0)', null,
        (select count(*) from _ep_bucket where not has_other_source and reason like '%LIFECYCLE%')::text),
  -- NATIONAL 12,722 PAGES
  ('N01 MAP1_ROWS', (select count(*) from _before)::text, (select count(*) from _after)::text),
  ('N02 MAP1_ZIPS', (select count(distinct zip) from _before)::text, (select count(distinct zip) from _after)::text),
  ('N03 CANONICAL_ROWS', (select count(*) from _before where publication_basis = 'canonical')::text,
                         (select count(*) from _after where publication_basis = 'canonical')::text),
  ('N04 CANONICAL_ENTITIES', (select n from before_src)::text,
                             (select count(distinct canonical_entity_id) from _after where canonical_entity_id is not null)::text),
  ('N05 ATLAS_BACKED_ENTITIES', null, (select count(*) from ent_src where atlas)::text),
  ('N06 EPOCH_BACKED_ENTITIES', null, (select count(*) from ent_src where epoch)::text),
  ('N07 EPOCH_ONLY_ENTITIES', null, (select count(*) from ent_src where epoch and not atlas)::text),
  ('N08 DUPLICATE_PHYSICAL_FACILITIES (published pairs still identity-open, or one entity twice on a page; must be 0)', null,
        ((select count(*) from public.dc_entity_identity_open o
           where o.canonical_entity_id in (select canonical_entity_id from _after)
             and o.other_entity_id in (select canonical_entity_id from _after))
         + (select count(*) from (select zip, canonical_entity_id from _after where canonical_entity_id is not null
                                  group by 1, 2 having count(*) > 1) x))::text),
  ('N09 OUTSIDE_ZIP_ROWS (must be 0)', null,
        (select count(*) from _after a where geo.zip_point_membership_in(geo.zip_membership_boundary(a.zip), a.lat, a.lng) <> 'member')::text),
  ('N10 AMBIGUOUS_EDGE_POINTS_WITHHELD', null, (select count(*) from _ep_bucket where reason = 'WITHHELD_AMBIGUOUS_ZCTA_EDGE')::text),
  ('N11 ROWS_REMOVED (canonical, by entity)', null,
        (select count(*) from (select distinct zip, canonical_entity_id from _before where publication_basis = 'canonical'
                               except select distinct zip, canonical_entity_id from _after where publication_basis = 'canonical') x)::text),
  ('N12 ROWS_ADDED (canonical, by entity)', null,
        (select count(*) from (select distinct zip, canonical_entity_id from _after where publication_basis = 'canonical'
                               except select distinct zip, canonical_entity_id from _before where publication_basis = 'canonical') x)::text)
) v(metric, before, after)
order by 1;

-- the rows that moved, so each can be read
select 'MOVED' tag, 'REMOVED' direction, zip, canonical_entity_id::text, project_name, map_status
  from _before b where publication_basis = 'canonical'
   and not exists (select 1 from _after a where a.zip = b.zip and a.canonical_entity_id = b.canonical_entity_id)
union all
select 'MOVED', 'ADDED', zip, canonical_entity_id::text, project_name, map_status
  from _after a where publication_basis = 'canonical'
   and not exists (select 1 from _before b where b.zip = a.zip and b.canonical_entity_id = a.canonical_entity_id)
order by 2, 5, 3;

\echo ----- BEGIN EPOCH DISPOSITIONS -----
select json_build_object('name', name, 'country', country, 'bucket', bucket, 'reason', reason,
                         'identity', identity_state, 'record_key', record_key,
                         'geography', geography_status, 'geo_rule', geo_rule, 'geocode', geocode_verdict,
                         'zips', published_zips, 'lat', lat, 'lng', lng)::text
  from _ep_bucket order by bucket, name collate "C";
\echo ----- END EPOCH DISPOSITIONS -----

-- identity-open pairs behind every IDENTITY_UNRESOLVED Epoch record (what stands in the way)
\echo ----- BEGIN OPEN PAIRS -----
select json_build_object('epoch', p.name, 'rule', o.candidate_rule_key, 'state', o.decision_state,
                         'decision_rule', o.decision_rule_key,
                         'other', (select string_agg(distinct x.source_native_name, ' / ')
                                     from public.dc_entity_observation l
                                     join public.dc_source_observation x on x.home_signal_observation_id = l.home_signal_observation_id
                                    where l.canonical_entity_id = o.other_entity_id))::text
  from _ep_bucket p join public.dc_entity_identity_open o on o.canonical_entity_id = p.eid
 where p.bucket = 'IDENTITY_UNRESOLVED'
 order by 1;
\echo ----- END OPEN PAIRS -----

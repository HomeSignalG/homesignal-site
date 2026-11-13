-- READ-ONLY PREFLIGHT for docs/map1-project-link.sql and docs/impact-dc-verification.sql (Tab 17 data-center project check).
-- Run through db-read.yml (read-only role, read-only endpoint) BEFORE applying either file. One SELECT; it writes nothing and
-- returns counts and object names only (no person, email or address).
--   missing_columns / missing_functions must be empty; already_present lists objects the two files would replace;
--   keys shows how many live canonical data-center entities get a stable project key (rank 0 or 1 record key), and how many
--   record keys would point at more than one live entity (the link then reads "matches more than one project").
with need(sch, rel, col) as (values
  ('public','dc_observation_record_key','home_signal_observation_id'), ('public','dc_observation_record_key','record_key'),
  ('public','dc_observation_record_key','record_key_rank'), ('public','dc_entity_observation','home_signal_observation_id'),
  ('public','dc_entity_observation','canonical_entity_id'), ('public','dc_canonical_entity','canonical_entity_id'),
  ('public','dc_canonical_entity','superseded_by'), ('public','dc_entity_geography','canonical_entity_id'),
  ('public','dc_entity_geography','lat'), ('public','dc_entity_geography','lng'), ('public','national_dc_records','source_key'),
  ('public','national_dc_records','lat'), ('public','national_dc_records','lng'), ('geo','n5_serving_membership','zcta5'),
  ('geo','n5_serving_membership','source_key'), ('geo','zcta_boundary','zcta5'), ('geo','zcta_boundary','geom'),
  ('public','canonical_zip_registry','zip'), ('public','app_projects','zip'), ('public','app_projects','record_kind'),
  ('public','app_projects','source_key'), ('public','app_projects','name'), ('public','app_projects','status'),
  ('public','app_projects','lat'), ('public','app_projects','lng'), ('public','communities','level'), ('public','communities','state'),
  ('public','communities','county'), ('public','communities','name'), ('public','communities','zip_codes'),
  ('public','impact_discovery_candidates','id'), ('public','impact_discovery_candidates','category'),
  ('public','impact_discovery_candidates','title'), ('public','impact_discovery_candidates','place'),
  ('public','impact_discovery_candidates','subject'), ('public','impact_discovery_candidates','post_uris'),
  ('public','impact_discovery_candidates','link_keys'), ('public','impact_discovery_candidates','evidence'),
  ('public','impact_discovery_candidates','coverage'), ('public','impact_discovery_candidates','status'),
  ('public','impact_discovery_candidates','duplicate_of'), ('public','impact_discovery_candidates','lead_url'),
  ('public','impact_discovery_candidates','related'), ('public','impact_discovery_candidates','discovered_at')),
fns(sch, fn) as (values ('public','map1_dc_zip_members'), ('geo','zip_point_membership_in'), ('public','_hs_is_admin'),
  ('net','http_post')),
mine(sch, obj) as (values ('public','map1_project_locate'), ('public','map1_project_stable_keys'), ('public','map1_project_documents'),
  ('public','hs_map1_project_document_decide'), ('public','map1_project_document'), ('public','map1_project_document_decision'),
  ('public','impact_dc_verification'), ('public','impact_dc_verification_runs'), ('public','impact_dc_reply_edits'),
  ('public','impact_dc_verification_tick'), ('public','impact_dc_topic_zips')),
live as (select e.canonical_entity_id from public.dc_canonical_entity e where e.superseded_by is null),
keyed as (select distinct eo.canonical_entity_id, rk.record_key
            from public.dc_entity_observation eo
            join public.dc_observation_record_key rk on rk.home_signal_observation_id = eo.home_signal_observation_id
           where rk.record_key_rank < 2)
select jsonb_build_object(
  'missing_columns', coalesce((select jsonb_agg(n.sch || '.' || n.rel || '.' || n.col order by 1) from need n
     where not exists (select 1 from information_schema.columns c where c.table_schema = n.sch and c.table_name = n.rel and c.column_name = n.col)), '[]'),
  'missing_functions', coalesce((select jsonb_agg(f.sch || '.' || f.fn order by 1) from fns f
     where not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = f.sch and p.proname = f.fn)), '[]'),
  'vault_secrets_view', exists (select 1 from information_schema.views where table_schema = 'vault' and table_name = 'decrypted_secrets'),
  'cron_installed', exists (select 1 from pg_extension where extname = 'pg_cron'),
  'already_present', coalesce((select jsonb_agg(m.sch || '.' || m.obj order by 1) from mine m
     where exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = m.sch and c.relname = m.obj)
        or exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = m.sch and p.proname = m.obj)), '[]'),
  'keys', jsonb_build_object(
     'live_entities', (select count(*) from live),
     'live_entities_with_stable_key', (select count(distinct k.canonical_entity_id) from keyed k join live l using (canonical_entity_id)),
     'stable_keys_on_more_than_one_live_entity', (select count(*) from (select k.record_key from keyed k join live l using (canonical_entity_id)
        group by k.record_key having count(distinct k.canonical_entity_id) > 1) x)),
  'data_center_topics_to_backfill', (select count(*) from public.impact_discovery_candidates c
     where c.category = 'data_centers' and c.status not in ('rejected','dismissed','excluded') and c.duplicate_of is null)
) as preflight;

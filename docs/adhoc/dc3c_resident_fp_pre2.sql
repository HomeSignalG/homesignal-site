with
ndr as (select md5(string_agg(concat_ws('|',source_key,project_name,developer_or_operator,raw_status,normalized_status,lat::text,lng::text,map_eligible::text,source_url), ',' order by source_key collate "C")) fp, count(*) n from public.national_dc_records),
ap as (select md5(string_agg(concat_ws('|',id::text,zip,record_kind,type,type_raw,name,status,lat::text,lng::text,source_key,source_ref), ',' order by id::text collate "C")) fp, count(*) n from public.app_projects
  where type ~* 'data[^a-z]{0,3}(cent|hall)|hyper|server' or type_raw ~* 'data[^a-z]{0,3}(cent|hall)|hyper|server' or name ~* 'data[^a-z]{0,3}(cent|hall)|hyper|server'),
sp as (select md5(string_agg(concat_ws('|',id::text,status,md5(coalesce(post_text,'')),md5(coalesce(evidence::text,'')),coalesce(image_bucket_path,'')), ',' order by id::text collate "C")) fp, count(*) n from public.social_posts where content_family='MAPS'),
fn as (select md5(string_agg(p.proname||':'||md5(p.prosrc), ',' order by p.proname collate "C")) fp, count(*) n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='public' and p.proname in ('national_dc_for_zip','map_site_is_datacenter_type','app_projects_for_zip','app_zip_projects_markers','dev_reports_enforce_dc_zip_membership','zip_dc_membership_outside','app_refresh_zip')),
ev as (select count(*) n, md5(string_agg(home_signal_observation_id::text||'|'||acquisition_run_id::text||'|'||coalesce(publisher_record_id,'')||'|'||md5(raw_payload::text), ',' order by home_signal_observation_id::text collate "C")) fp from public.dc_source_observation)
select now()::text measured_at, ndr.n ndr_n, ndr.fp ndr_fp, ap.n ap_dc_n, ap.fp ap_dc_fp, sp.n maps_n, sp.fp maps_fp, fn.n fn_n, fn.fp fn_fp,
 md5(concat_ws('|',ndr.fp,ap.fp,sp.fp,fn.fp)) resident_fp, ev.n obs_n, ev.fp obs_fp,
 (select count(*) from public.dc_canonical_entity) entities, (select count(*) from public.dc_entity_observation) links,
 (select count(*) from public.dc_identity_decision) decisions, (select count(*) from public.dc_acquisition_run) runs, (select count(*) from public.dc_source) sources
from ndr, ap, sp, fn, ev;

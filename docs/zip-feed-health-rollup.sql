-- Tab 2 · All-ZIP and all-feed health roll-up (2026-11-20). SQL of record. ADDITIVE and READ-ONLY: two functions, no table, no write.
--
-- WHY: Tab 2 exists to monitor the health of ALL ZIP pages and feeds. Subscriber ZIP Health (docs/subscriber-zip-health.sql) covers only
-- the ZIPs with a real subscriber. This reader rolls up every canonical ZIP page and every development source, in AGGREGATES, with each
-- failure class kept separate so one cannot hide inside another.
--
-- TRUTH PATH (this file only READS it; it decides no eligibility and re-derives no rule):
--   ZIP pages   -> public.canonical_zip_registry (the universe), public.development_reports (what each page's report holds)
--   map status  -> geo.n5_serving_status (the serving generation Map 1 reads; not_measured = no Census area, declared by design)
--   sources     -> public.dev_refresh_source_failures (kind keeps fetch / fire / retired / truncated apart), public.source_registry
--   publishing  -> public.social_posts (MAPS); alarms -> public.pipeline_health_check (existing hourly monitor, shown as is)
--
-- WHAT IT DOES NOT COMPUTE (and the page says so): per-ZIP "records missing from Map 1" for ALL ZIPs (a 3M-row join; the per-ZIP check
-- exists only for subscriber ZIPs), per-source expected schedules (source_registry carries none for most sources), and any comparison
-- with a city's own system. A figure that is not computed is returned as null or listed under `not_computed`, never as 0.
--
-- (applied as ONE transaction by apply_migration; do not add begin/commit)

create or replace function public._hs_zip_feed_health_core()
returns jsonb language plpgsql stable security definer set search_path = public, geo as $$
declare
  now_ts timestamptz := now();
  zips jsonb; srcs jsonb; pub jsonb; alarms jsonb; reg jsonb; hb jsonb; sub_zips text[];
begin
  select coalesce(array_agg(distinct c.zip), '{}') into sub_zips
    from public.bsky_maps_priority_classification c where c.class = 'eligible' and c.zip ~ '^[0-9]{5}$';

  select jsonb_build_object(
      'registry_zips', (select count(*) from public.canonical_zip_registry),
      'with_report', count(*),
      'refreshed_24h', count(*) filter (where d.refreshed_at >= now_ts - interval '24 hours'),
      'refreshed_24_72h', count(*) filter (where d.refreshed_at < now_ts - interval '24 hours' and d.refreshed_at >= now_ts - interval '72 hours'),
      'refreshed_72h_7d', count(*) filter (where d.refreshed_at < now_ts - interval '72 hours' and d.refreshed_at >= now_ts - interval '7 days'),
      'refreshed_older_7d', count(*) filter (where d.refreshed_at < now_ts - interval '7 days'),
      'epa_layer_unavailable', count(*) filter (where d.facilities_unavailable),
      'epa_clock_older_7d', count(*) filter (where d.facilities_refreshed_at < now_ts - interval '7 days'),
      'no_map_area_by_design', (select count(*) from geo.n5_serving_status s where s.status = 'not_measured'),
      'map_area_measured', (select count(*) from geo.n5_serving_status s where s.status = 'boundary_complete'),
      'serving_generation', (select g.generation_id || ' · ' || coalesce(max(g.completed_at)::text, '') from geo.n5_serving_status g group by g.generation_id order by max(g.completed_at) desc limit 1),
      'stalest', coalesce((select jsonb_agg(jsonb_build_object('zip', t.zip, 'refreshed_at', t.refreshed_at, 'epa_unavailable', t.facilities_unavailable,
                    'subscriber_zip', t.zip = any (sub_zips)) order by t.refreshed_at)
                 from (select zip, refreshed_at, facilities_unavailable from public.development_reports order by refreshed_at limit 25) t), '[]'::jsonb)
    ) into zips from public.development_reports d;

  select coalesce(jsonb_agg(jsonb_build_object('registry_id', f.registry_id, 'kind', f.kind, 'events', f.n, 'zips', f.z, 'last_seen', f.last_seen,
              'sample_reason', f.reason, 'subscriber_zips', f.subs) order by f.z desc, f.n desc), '[]'::jsonb) into srcs
    from (select registry_id, kind, count(*) n, count(distinct zip) z, max(seen_at) last_seen,
                 (array_agg(reason order by seen_at desc))[1] reason, count(distinct zip) filter (where zip = any (sub_zips)) subs
            from public.dev_refresh_source_failures where seen_at > now_ts - interval '48 hours' group by registry_id, kind
           order by count(distinct zip) desc, count(*) desc limit 40) f;

  select jsonb_build_object(
      'maps_posts_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.social_posts where content_family = 'MAPS' group by status) q), '{}'::jsonb),
      'drafts_waiting_over_3d', (select count(*) from public.social_posts where content_family = 'MAPS' and status = 'draft' and created_at < now_ts - interval '3 days'),
      'approved_not_published', (select count(*) from public.social_posts where content_family = 'MAPS' and status = 'approved'),
      'newest_published', (select max(published_at) from public.social_posts where content_family = 'MAPS' and status = 'published')
    ) into pub;

  select jsonb_build_object('total', count(*), 'failing', count(*) filter (where not ok),
           'failing_checks', coalesce(jsonb_agg(jsonb_build_object('check', check_name, 'detail', left(detail, 240), 'since', since, 'alertable', alertable)) filter (where not ok), '[]'::jsonb))
    into alarms from public.pipeline_health_check;

  select jsonb_build_object('registered_sources', count(*), 'with_schedule', count(*) filter (where refresh_cadence is not null)) into reg from public.source_registry;

  select coalesce(jsonb_agg(jsonb_build_object('workflow', h.workflow, 'finished_at', h.finished_at) order by h.workflow), '[]'::jsonb) into hb
    from (select workflow, max(finished_at) finished_at from public.ingest_run_heartbeat group by workflow) h;

  return jsonb_build_object('zips', zips, 'sources_48h', srcs, 'publishing', pub, 'alarms', alarms, 'source_registry', reg, 'heartbeats', hb,
    'subscriber_zip_count', coalesce(array_length(sub_zips, 1), 0),
    'not_computed', jsonb_build_array('per-ZIP records missing from Map 1 for non-subscriber ZIPs', 'per-source expected schedules', 'comparison with official city systems'));
end $$;

revoke all on function public._hs_zip_feed_health_core() from public, anon, authenticated;

create or replace function public.hs_zip_feed_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email';
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object('rollup', public._hs_zip_feed_health_core(), 'as_of', now());
end $$;

revoke all on function public.hs_zip_feed_health() from public, anon;
grant execute on function public.hs_zip_feed_health() to authenticated;

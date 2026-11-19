-- Tab 2 · Subscriber ZIP Health (2026-11-19). SQL of record. ADDITIVE and READ-ONLY: two functions, no table, no write.
--
-- WHY: the founder asked that every ZIP with a real subscriber be audited end to end and shown at the top of Feed
-- Intelligence: sources, last successful read, failures, records missing from the map, latest activity, pending
-- posts and email readiness. "Never represent missing instrumentation as a healthy result."
--
-- TRUTH PATH (this file only READS it; it decides no eligibility and re-derives no rule):
--   subscribers  -> public.bsky_maps_priority_classification (homesignal-ingest; class 'eligible' = a real subscriber)
--   development  -> public.app_projects (what the materializer stored), public.dev_refresh_source_failures
--   Map 1        -> geo.n5_serving_membership (the serving generation Map 1 reads)
--   posts        -> public.social_posts (MAPS); email -> public.email_deliveries (item_type 'social_post')
--   MAPS eligibility is decided ONLY by homesignal-ingest bluesky/lib/maps-eligibility.mjs. This file counts RECENT LIVE
--   RECORDS (Proposed/Approved, filed <= 120 days, with coordinates) and says where they are drawn; it never calls them
--   "eligible". The generator's own per-ZIP verdicts live in its run log.
--
-- MAP COUNTS (corrected 2026-11-19): distinct source keys, not rows. recent_live_records = drawn_on_map1 + drawn_on_other_zip +
-- n5_unresolved + not_in_serving_generation (a non-overlapping partition: membership here / membership only elsewhere / no membership
-- but recorded unresolved by the ACTIVE N5 generation / no membership and not recorded). n5_unresolved_by_reason carries the N5 reason
-- codes (REGISTRY_IDENT_UNRESOLVED, GEOMETRY_INVALID, POINT_REJECTED, NO_INTERSECTION_WITH_GENERATION_ZCTAS, ...): these are mostly DATA-QUALITY
-- or placement problems, not benign exclusions; only SOURCE_EXCLUDED is an intentional exclusion. The N5 unresolved table holds one row per
-- (generation, source_key): the entry is generation-wide for the key, not ZIP-specific. Records drawn on a neighbouring ZIP's polygon are
-- correct N5 behaviour (membership is point-in-polygon, not the 3-mile source scope) and are counted as drawn elsewhere.
--
-- VERDICT: decided ONCE, in lib/acq-subscriber-zip-health.js (HS.subscriberZipVerdict), from the facts this reader returns.
-- The worst applicable wins, and nothing is healthy by default:
--   FAILED_INGESTION            a source failed in the last 48h, or the ZIP's report is older than 72h
--   MISSING_SOURCE_COVERAGE     no development source has ever stored a record for this ZIP
--   RECORDS_MISSING_FROM_MAP1   recent live records are not drawn on this ZIP's Map 1
--   UNVERIFIED                  a needed instrument is absent (EPA layer unavailable, or a source with no read time)
--   NO_NEW_DEVELOPMENT_ACTIVITY sources read recently, all drawn, and nothing filed in the last 30 days
--   ACTIVITY_CAPTURED           sources read recently, all drawn, and something filed in the last 30 days
--
-- (applied as ONE transaction by apply_migration; do not add begin/commit)

create or replace function public._hs_subscriber_zip_health_core()
returns jsonb language plpgsql stable security definer set search_path = public, geo as $$
declare
  out jsonb;
begin
  select coalesce(jsonb_agg(zrow order by (zrow->>'subscribers')::int desc, zrow->>'zip'), '[]'::jsonb) into out
  from (
    select (
      with z as (select s.zip, s.n from (select c.zip, count(*) n from public.bsky_maps_priority_classification c
                  where c.class = 'eligible' and c.zip ~ '^[0-9]{5}$' group by c.zip) s where s.zip = zz.zip),
      rep as (select refreshed_at, facilities_refreshed_at, facilities_unavailable, counts
                from public.development_reports where zip = zz.zip),
      src as (select p.registry_id, count(*) n, max(p.submitted_at) newest_filed, max(p.last_seen_at) last_seen
                from public.app_projects p where p.zip = zz.zip and p.record_kind = 'development' group by p.registry_id),
      fail as (select f.registry_id, count(*) n, max(f.seen_at) last_failed, (array_agg(f.reason order by f.seen_at desc))[1] reason
                 from public.dev_refresh_source_failures f where f.zip = zz.zip and f.seen_at > now() - interval '48 hours'
                group by f.registry_id),
      live as (select distinct p.source_key from public.app_projects p
                where p.zip = zz.zip and p.record_kind = 'development' and p.status in ('Proposed','Approved')
                  and p.submitted_at >= current_date - 120 and p.lat is not null and p.lng is not null),
      drawn_here as (select count(*) n from live l where exists (
                select 1 from geo.n5_serving_membership m where m.zcta5 = zz.zip::bpchar and m.source_key = l.source_key)),
      drawn_else as (select count(*) n from live l where not exists (
                select 1 from geo.n5_serving_membership m where m.zcta5 = zz.zip::bpchar and m.source_key = l.source_key)
                and exists (select 1 from geo.n5_serving_membership m where m.source_key = l.source_key)),
      unres as (select count(*) n from live l where not exists (
                select 1 from geo.n5_serving_membership m where m.source_key = l.source_key)
                and exists (select 1 from geo.n5_generation_unresolved u
                  join geo.n5_generation g on g.generation_id = u.generation_id and g.state = 'ACTIVE' where u.source_key = l.source_key)),
      unres_r as (select u.reason_code, count(*) n from live l
                join geo.n5_generation_unresolved u on u.source_key = l.source_key
                join geo.n5_generation g on g.generation_id = u.generation_id and g.state = 'ACTIVE'
                where not exists (select 1 from geo.n5_serving_membership m where m.source_key = l.source_key)
                group by u.reason_code),
      absent as (select count(*) n from live l where not exists (
                select 1 from geo.n5_serving_membership m where m.source_key = l.source_key)
                and not exists (select 1 from geo.n5_generation_unresolved u
                  join geo.n5_generation g on g.generation_id = u.generation_id and g.state = 'ACTIVE' where u.source_key = l.source_key)),
      posts as (select status, count(*) n, max(created_at) newest from public.social_posts
                 where zip = zz.zip and content_family = 'MAPS' group by status),
      gov as (select cm.id from public.communities cm where cm.zip_codes @> array[zz.zip]),
      chain as (select id from public.communities where id in (select id from gov)
                union select parent_id from public.communities where id in (select id from gov) and parent_id is not null),
      feeds as (select count(*) filter (where f.active) active, count(*) total from public.feeds f where f.community_id in (select id::text from chain)),
      govnew as (select greatest(
                    (select max(a.created_at) from public.alerts a where a.community_id in (select id from chain) and a.pipeline_type = 'government_notice'),
                    (select max(m.created_at) from public.meetings m where m.community_id in (select id from chain))) newest),
      pub as (select sp.id from public.social_posts sp where sp.zip = zz.zip and sp.content_family = 'MAPS' and sp.status = 'published'
                 and not exists (select 1 from public.social_post_withdrawals w where w.social_post_id = sp.id)),
      mail as (select count(*) delivered, count(distinct (d.user_id, d.item_id)) distinct_pairs
                 from public.email_deliveries d where d.item_type = 'social_post' and d.item_id in (select id from pub))
      select jsonb_build_object(
        'zip', zz.zip,
        'subscribers', (select n from z),
        'report', (select to_jsonb(rep) from rep),
        'sources', coalesce((select jsonb_agg(jsonb_build_object(
              'registry_id', s.registry_id, 'records', s.n, 'newest_filed', s.newest_filed, 'last_seen', s.last_seen,
              'cadence', sr.refresh_cadence, 'connection', sr.connection_status,
              'failures_48h', coalesce(f.n, 0), 'last_failed', f.last_failed, 'failure_reason', f.reason) order by s.n desc)
              from src s left join fail f on f.registry_id = s.registry_id left join public.source_registry sr on sr.source_id = s.registry_id), '[]'::jsonb),
        'failures_without_records', coalesce((select jsonb_agg(jsonb_build_object('registry_id', f.registry_id, 'failures_48h', f.n, 'reason', f.reason))
              from fail f where not exists (select 1 from src s where s.registry_id = f.registry_id)), '[]'::jsonb),
        'recent_live_records', (select count(*) from live),
        'drawn_on_map1', (select n from drawn_here),
        'drawn_on_other_zip', (select n from drawn_else),
        'not_in_serving_generation', (select n from absent),
        'n5_unresolved', (select n from unres),
        'n5_unresolved_by_reason', coalesce((select jsonb_object_agg(reason_code, n) from unres_r), '{}'::jsonb),
        'posts', coalesce((select jsonb_object_agg(status, jsonb_build_object('n', n, 'newest', newest)) from posts), '{}'::jsonb),
        'government', jsonb_build_object('feeds_active', (select active from feeds), 'feeds_total', (select total from feeds), 'newest_item', (select newest from govnew)),
        'email', jsonb_build_object('published_posts', (select count(*) from pub), 'deliveries', (select delivered from mail),
                  'duplicate_deliveries', (select delivered - distinct_pairs from mail))
      )
    ) as zrow
    from (select distinct c.zip from public.bsky_maps_priority_classification c where c.class = 'eligible' and c.zip ~ '^[0-9]{5}$') zz
  ) t;
  return out;
end $$;

revoke all on function public._hs_subscriber_zip_health_core() from public, anon, authenticated;

create or replace function public.hs_subscriber_zip_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email';
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object('zips', public._hs_subscriber_zip_health_core(), 'as_of', now());
end $$;

revoke all on function public.hs_subscriber_zip_health() from public, anon;
grant execute on function public.hs_subscriber_zip_health() to authenticated;

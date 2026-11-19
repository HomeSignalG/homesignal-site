-- ROLLBACK for change group A2. GENERATED from git commit 77fdd06 (PR #3054), the text production ran. NOT APPLIED.
-- Fail-closed: refuses unless the live body is the A2 body (md5 b4edac02bea49df601ca06fbfc1b547f); restores the prior body (md5 3998bbf2cff02ea15f16e0ac80c03935).
-- Reversible without data loss: the function holds no state. The A1 lifecycle objects (if applied) keep working with either version.
do $g$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public._hs_subscriber_zip_health_core()'::regprocedure) <> 'b4edac02bea49df601ca06fbfc1b547f' then
    raise exception 'A2 rollback precondition: live body md5 is not b4edac02bea49df601ca06fbfc1b547f; refusing';
  end if;
end $g$;

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
      live as (select p.source_key from public.app_projects p
                where p.zip = zz.zip and p.record_kind = 'development' and p.status in ('Proposed','Approved')
                  and p.submitted_at >= current_date - 120 and p.lat is not null and p.lng is not null),
      drawn_here as (select count(*) n from live l where exists (
                select 1 from geo.n5_serving_membership m where m.zcta5 = zz.zip::bpchar and m.source_key = l.source_key)),
      drawn_else as (select count(*) n from live l where not exists (
                select 1 from geo.n5_serving_membership m where m.zcta5 = zz.zip::bpchar and m.source_key = l.source_key)
                and exists (select 1 from geo.n5_serving_membership m where m.source_key = l.source_key)),
      absent as (select count(*) n from live l where not exists (
                select 1 from geo.n5_serving_membership m where m.source_key = l.source_key)),
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
do $g$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public._hs_subscriber_zip_health_core()'::regprocedure) <> '3998bbf2cff02ea15f16e0ac80c03935' then
    raise exception 'post-condition failed: body md5 is not 3998bbf2cff02ea15f16e0ac80c03935';
  end if;
  if (select proacl::text from pg_proc where oid = 'public._hs_subscriber_zip_health_core()'::regprocedure) is distinct from '{postgres=X/postgres,service_role=X/postgres}' then
    raise exception 'post-condition failed: ACL changed';
  end if;
end $g$;

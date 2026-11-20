-- Tab 2 · FULL AFFECTED-ZIP ACCESS, ALL-ZIP ACCOUNTING, SUPERSEDED-FAILURE RULE (2026-11-20). SQL of record. ADDITIVE + READ-ONLY (one view, three functions, one splice).
--
-- 1 · The 50 ZIPs stored on a finding are a DISPLAY PREVIEW (a LIMIT 50 in the recorder), not a storage limit: the ZIP lists are recomputed live.
--     hs_zip_feed_health_zips(key, offset, limit) pages through ALL affected ZIPs for a finding (e.g. all 419 for FDOT), 100 per page, max 500.
-- 2 · hs_zip_feed_health_accounting() puts EVERY canonical ZIP page into exactly ONE status, and returns the sum so a missed ZIP shows as a mismatch.
-- 3 · A source failure is superseded when the same ZIP+source later has a successful tick (dev_source_continuity.last_tick_at > the failure). Existing
--     signal, no new threshold; the 48-hour window is the existing one. Persistent failures stay ongoing.
-- (applied as ONE transaction by apply_migration)

create or replace view public.zip_feed_health_open_failures with (security_invoker = true) as
  select f.* from public.dev_refresh_source_failures f
  left join public.dev_source_continuity c on c.zip = f.zip and c.registry_id = f.registry_id
  where f.seen_at > now() - interval '48 hours' and f.kind in ('fetch_failed','fire_failed','fire_http_error')
    and not (c.last_tick_at is not null and c.last_tick_at > f.seen_at);
revoke all on public.zip_feed_health_open_failures from public, anon, authenticated;

-- splice the recorder's two source-failure reads onto the view (fail closed unless each anchor appears exactly once)
do $$
declare src text; a1 text; b1 text; a2 text; b2 text; n int;
begin
  select pg_get_functiondef('public._hs_zip_feed_health_findings()'::regprocedure) into src;
  a1 := 'from public.dev_refresh_source_failures f where f.seen_at > now_ts - interval ''48 hours'' and f.kind in (''fetch_failed'',''fire_failed'',''fire_http_error'') group by f.registry_id;';
  b1 := 'from public.zip_feed_health_open_failures f group by f.registry_id;';
  a2 := 'from public.dev_refresh_source_failures where registry_id=f.registry_id and kind in (''fetch_failed'',''fire_failed'',''fire_http_error'') and seen_at > now_ts - interval ''48 hours'' order by zip limit 50';
  b2 := 'from public.zip_feed_health_open_failures where registry_id=f.registry_id order by zip limit 50';
  select (length(src) - length(replace(src, a1, '')))/length(a1) into n; if n <> 1 then raise exception 'anchor 1 appeared % times', n; end if;
  select (length(src) - length(replace(src, a2, '')))/length(a2) into n; if n <> 1 then raise exception 'anchor 2 appeared % times', n; end if;
  src := replace(replace(src, a1, b1), a2, b2);
  execute src;
end $$;

create or replace function public._hs_zip_feed_health_zip_status()
returns table(zip text, status text, report_at timestamptz) language sql stable security definer set search_path = public as $$
  with fail as (select distinct zip from public.zip_feed_health_open_failures),
       cont as (select distinct zip from public.dev_source_continuity),
       ver as (select zip from public.dev_change_scope_health group by zip having bool_or(monitoring_state = 'complete_verified'))
  select r.zip,
    case when d.zip is null or d.refreshed_at is null then 'NO_REPORT'
         when d.refreshed_at < now() - interval '72 hours' then 'STALE_REPORT'
         when r.zip in (select zip from fail) then 'SOURCE_READ_FAILING'
         when r.zip not in (select zip from cont) then 'NO_CHANGE_EVIDENCE'
         when r.zip in (select zip from ver) then 'CHANGE_MONITOR_VERIFIED_SOME'
         else 'COVERAGE_NOT_VERIFIED' end,
    d.refreshed_at
  from public.canonical_zip_registry r left join public.development_reports d on d.zip = r.zip;
$$;
revoke all on function public._hs_zip_feed_health_zip_status() from public, anon, authenticated;

create or replace function public.hs_zip_feed_health_accounting()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email'; reg int; b jsonb; tot int;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then raise exception 'not authorized' using errcode = '42501'; end if;
  select count(*) into reg from public.canonical_zip_registry;
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb), coalesce(sum(n), 0) into b, tot from (select status, count(*) n from public._hs_zip_feed_health_zip_status() group by 1) q;
  return jsonb_build_object('registry_zips', reg, 'buckets', b, 'bucket_sum', tot, 'every_zip_accounted_for', reg = tot,
    'note', 'Each ZIP is in exactly one bucket, in priority order. NO status means verified complete coverage except CHANGE_MONITOR_VERIFIED_SOME, which means at least one source pair is verified, not all.', 'as_of', now());
end $$;
revoke all on function public.hs_zip_feed_health_accounting() from public, anon;
grant execute on function public.hs_zip_feed_health_accounting() to authenticated;

create or replace function public.hs_zip_feed_health_zips(p_key text, p_offset int default 0, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email'; lim int := least(greatest(coalesce(p_limit, 100), 1), 500); off int := greatest(coalesce(p_offset, 0), 0);
        total int; rows jsonb; sub text[];
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then raise exception 'not authorized' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct c.zip), '{}') into sub from public.bsky_maps_priority_classification c where c.class = 'eligible' and c.zip ~ '^[0-9]{5}$';
  create temp table _z on commit drop as
    select z.zip::text zip, z.at from (
      select zip, max(seen_at) at from public.zip_feed_health_open_failures where p_key like 'SOURCE_READ|%' and registry_id = substr(p_key, 13) group by zip
      union all select zip, refreshed_at from public.development_reports where p_key = 'STALE_ZIP_REPORT|all' and refreshed_at < now() - interval '72 hours'
      union all select r.zip, null from public.canonical_zip_registry r where p_key = 'NO_REPORT|all' and not exists (select 1 from public.development_reports d where d.zip = r.zip)
      union all select zip, facilities_refreshed_at from public.development_reports where p_key = 'EPA_LAYER|all' and facilities_unavailable
      union all select d.zip, null from public.development_reports d where p_key = 'NO_GENERATION_EVIDENCE|all' and d.refreshed_at is not null and not exists (select 1 from public.dev_source_continuity c where c.zip = d.zip)
      union all select zip, report_at from public._hs_zip_feed_health_zip_status() where p_key like 'ACCOUNT|%' and status = substr(p_key, 9)
    ) z;
  select count(*) into total from _z;
  select coalesce(jsonb_agg(jsonb_build_object('zip', t.zip, 'at', t.at, 'subscriber', t.zip = any(sub)) order by t.zip), '[]'::jsonb) into rows from (select * from _z order by zip offset off limit lim) t;
  return jsonb_build_object('key', p_key, 'total', total, 'offset', off, 'limit', lim, 'rows', rows);
end $$;
revoke all on function public.hs_zip_feed_health_zips(text, int, int) from public, anon;
grant execute on function public.hs_zip_feed_health_zips(text, int, int) to authenticated;

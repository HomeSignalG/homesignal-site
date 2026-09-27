-- oa-health-recovery.sql — OpenAddresses demand scope, lookup, and geocode upgrade.
--
-- WHY: the loader scoped from property_reports (1 ZIP) while public.geocodes already
-- names hundreds of demand ZIPs; refreshed OA points never reached the write-once
-- geocode cache; datasetRung missed city-less keys that share a house/street/ZIP with
-- a loaded OA row. Additive only — no delete, no truncate, no change to the
-- never-downgrade `>` on upsert_geocode_if_better.
--
-- Parked here (docs/*.sql convention). Applied via apply_migration.

-- ── city-less key: "NUM STREET, CITY, ST ZIP" → "NUM STREET, ST ZIP" ─────────────────────
create or replace function public.oa_cityless_key(addr text)
returns text
language sql
immutable
as $$
  select case
    when addr ~ ', [^,]+, [A-Z]{2} [0-9]{5}(-[0-9]{4})?$'
    then regexp_replace(addr, ', [^,]+, ([A-Z]{2} [0-9]{5}(-[0-9]{4})?)$', ', \1')
    else addr
  end
$$;

create index if not exists nap_cityless_idx
  on public.national_address_points (public.oa_cityless_key(canonical_addr));
create index if not exists geocodes_cityless_idx
  on public.geocodes (public.oa_cityless_key(canonical_addr));

revoke all on function public.oa_cityless_key(text) from public, anon, authenticated;
grant execute on function public.oa_cityless_key(text) to service_role;

-- ── demand ZIP/state pairs the loader should cover ───────────────────────────────────────
create or replace function public.oa_demand_scope()
returns table(zip text, state text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct s.zip, s.state
    from (
      select substr(trim(pr.zip), 1, 5) as zip, upper(trim(pr.state)) as state
        from public.property_reports pr
       where pr.zip ~ '^\d{5}'
      union all
      select substring(g.canonical_addr from '(\d{5})(?:-\d{4})?$'),
             substring(g.canonical_addr from ', ([A-Z]{2}) \d{5}')
        from public.geocodes g
      union all
      select substring(g.input_address from '(\d{5})(?:-\d{4})?$'),
             substring(upper(g.input_address) from ', ([A-Z]{2}) \d{5}')
        from public.geocodes g
      union all
      select substring(q.geocoder_query from '(\d{5})(?:-\d{4})?$'),
             substring(upper(q.geocoder_query) from ', ([A-Z]{2}) \d{5}')
        from public.dc_geocode_queue q
    ) s
   where s.zip ~ '^\d{5}$'
$$;

revoke all on function public.oa_demand_scope() from public, anon, authenticated;
grant execute on function public.oa_demand_scope() to service_role;

comment on function public.oa_demand_scope() is
'ZIP/state pairs the OpenAddresses loader should ingest: property_reports ∪ geocodes ∪ dc_geocode_queue. Service-role only.';

-- ── NAP lookup: exact canonical, then a UNIQUE city-less match ───────────────────────────
create or replace function public.lookup_national_address_point(p_canonical text)
returns table(lat double precision, lng double precision, match_type text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hits integer;
begin
  return query
    select n.lat, n.lng, n.match_type
      from public.national_address_points n
     where n.canonical_addr = p_canonical
     limit 1;
  if found then
    return;
  end if;

  select count(*) into hits
    from public.national_address_points n
   where public.oa_cityless_key(n.canonical_addr) = public.oa_cityless_key(p_canonical);

  if hits = 1 then
    return query
      select n.lat, n.lng, n.match_type
        from public.national_address_points n
       where public.oa_cityless_key(n.canonical_addr) = public.oa_cityless_key(p_canonical);
  end if;
end;
$$;

revoke all on function public.lookup_national_address_point(text) from public, anon, authenticated;
grant execute on function public.lookup_national_address_point(text) to service_role;

-- ── match_type distribution (honest self-audit; avoids the PostgREST 1000-row cap) ───────
create or replace function public.oa_nap_stats()
returns table(match_type text, n bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.match_type, count(*) from public.national_address_points p group by 1
$$;

revoke all on function public.oa_nap_stats() from public, anon, authenticated;
grant execute on function public.oa_nap_stats() to service_role;

-- ── durable loader receipt ───────────────────────────────────────────────────────────────
create table if not exists public.oa_load_runs (
  run_id              uuid primary key default gen_random_uuid(),
  started_at          timestamptz not null,
  finished_at         timestamptz not null default now(),
  zips                text[] not null,
  states              text[] not null,
  regions             text[] not null,
  rows_written        integer not null,
  distinct_canonical  integer not null,
  quarantined         integer not null,
  dry_run             boolean not null default false,
  vintage             text not null,
  nap_count           integer,
  notes               jsonb
);

alter table public.oa_load_runs enable row level security;
revoke all on public.oa_load_runs from anon, authenticated;

comment on table public.oa_load_runs is
'One row per OpenAddresses loader run. Service-role only. No delete/retire of national_address_points.';

-- ── copy outranking (or refreshed equal-tier OA) NAP points into geocodes ────────────────
-- Does NOT loosen upsert_geocode_if_better. Failed and Census rows upgrade when NAP
-- outranks them. Existing openaddresses rows refresh coordinates when they moved.
create or replace function public.upgrade_geocodes_from_national_address_points()
returns table(considered integer, upgraded integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  n_considered integer := 0;
  n_upgraded integer := 0;
begin
  with exact_hit as (
    select g.canonical_addr, g.match_type as old_mt, g.geocode_source as old_src,
           g.lat as old_lat, g.lng as old_lng,
           n.lat, n.lng, n.match_type as nap_mt, n.source_vintage
      from public.geocodes g
      join public.national_address_points n on n.canonical_addr = g.canonical_addr
  ),
  cityless_unique as (
    select x.canonical_addr, x.old_mt, x.old_src, x.old_lat, x.old_lng,
           x.lat, x.lng, x.nap_mt, x.source_vintage
      from (
        select g.canonical_addr, g.match_type as old_mt, g.geocode_source as old_src,
               g.lat as old_lat, g.lng as old_lng,
               n.lat, n.lng, n.match_type as nap_mt, n.source_vintage,
               count(*) over (partition by g.canonical_addr) as hits
          from public.geocodes g
          join public.national_address_points n
            on public.oa_cityless_key(n.canonical_addr) = public.oa_cityless_key(g.canonical_addr)
         where not exists (
           select 1 from public.national_address_points n2
            where n2.canonical_addr = g.canonical_addr
         )
      ) x
     where x.hits = 1
  ),
  matched as (
    select * from exact_hit
    union all
    select * from cityless_unique
  ),
  eligible as (
    select *
      from matched
     where public.geocode_quality_rank(nap_mt) > public.geocode_quality_rank(old_mt)
        or (old_src = 'openaddresses'
            and nap_mt = old_mt
            and (old_lat is distinct from lat or old_lng is distinct from lng))
  ),
  upd as (
    update public.geocodes g
       set lat = e.lat,
           lng = e.lng,
           match_type = e.nap_mt,
           matched_address = coalesce(g.matched_address, g.canonical_addr),
           geocode_source = 'openaddresses',
           needs_review = (e.nap_mt is distinct from 'rooftop'),
           review_reason = case
             when e.nap_mt = 'rooftop' then null
             else 'match_type=' || e.nap_mt || ' (not rooftop) — flagged for optional precise upgrade'
           end,
           provider_vintage = 'oa-upgrade ' || coalesce(e.source_vintage, ''),
           updated_at = now()
      from eligible e
     where g.canonical_addr = e.canonical_addr
    returning 1
  )
  select
    (select count(*) from matched)::integer,
    (select count(*) from upd)::integer
    into n_considered, n_upgraded;

  considered := n_considered;
  upgraded := n_upgraded;
  return next;
end;
$$;

revoke all on function public.upgrade_geocodes_from_national_address_points() from public, anon, authenticated;
grant execute on function public.upgrade_geocodes_from_national_address_points() to service_role;

comment on function public.upgrade_geocodes_from_national_address_points() is
'Upgrade-only: copy national_address_points into geocodes when OA outranks the cache, or when an existing OA point moved. Never downgrades.';

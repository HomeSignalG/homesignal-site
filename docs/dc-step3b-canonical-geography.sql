-- ============================================================================
-- STEP 3B · CANONICAL GEOGRAPHY — DDL OF RECORD
-- ============================================================================
-- One row per canonical entity (Step 3A) stating WHERE HomeSignal believes it is, or that it
-- cannot say. Geography is a canonical decision, not a publisher assertion: the publisher's
-- point is EVIDENCE, and this layer decides whether that evidence is good enough to place the
-- entity inside a ZIP boundary.
--
-- WHAT IT IS NOT
--   * It assigns NO ZIP. ZIP membership is a separate stage that reads this table through the
--     one point-in-ZIP authority (geo.zip_point_membership_in). No radius, no centroid.
--   * It has NO resident reader. RLS on, no anon/authenticated grant (Step 3A posture); the
--     isolation gate derives its forbidden list from this file.
--   * It knows no place, project or source by name. Every rule reads a column, never a value
--     list. Stratos (41.5, -113.5, "exact") is unresolved because its coordinates carry one
--     decimal place, the same rule that applies to every other record.
--
-- THE RULES (rule_version 1), evaluated per entity over its CURRENT linked observations:
--   1. entity_grain AGGREGATE_MULTI_SITE          -> NOT_A_SITE      (publisher says so)
--   2. no observation carries a coordinate pair    -> GEOGRAPHY_UNRESOLVED  NO_COORDINATES
--   3. two sources place it > 1 km apart           -> GEOGRAPHY_UNRESOLVED  SOURCES_DISAGREE
--   4. the chosen point has <= 1 decimal place on
--      either axis (±~5.5 km: cannot decide a ZIP) -> GEOGRAPHY_UNRESOLVED  ROUNDED_COORDINATES
--      ("exact" is not trusted: PUBLISHER_CLAIMS_EXACT is recorded beside it)
--   5. otherwise                                   -> RESOLVED, POINT, with flags:
--        COARSE_COORDINATES      2 decimal places (~1.1 km)
--        PUBLISHER_APPROXIMATE   the publisher labels the point approximate
--        SHARED_COORDINATES      another entity's chosen point is identical (centroid suspect)
--   The chosen point: publisher-precision 'exact' first, then the most decimal places, then
--   the newest observation, then the observation id (deterministic).
--
-- FOOTPRINT: geometry_type admits 'FOOTPRINT' and a footprint would win over any point, but NO
-- current source supplies a polygon (Atlas: lat/lon only; Epoch: address only). The rule is not
-- written against a field that does not exist; the first footprint-bearing source adds it.
-- ============================================================================

create table if not exists public.dc_entity_geography (
    canonical_entity_id       uuid primary key
                              references public.dc_canonical_entity(canonical_entity_id),
    geography_status          text not null,
    geometry_type             text,
    geom                      geometry(Geometry, 4326),
    lat                       double precision,
    lng                       double precision,
    coordinate_decimals       integer,
    authority_source_key      text,
    authority_observation_id  uuid references public.dc_source_observation(home_signal_observation_id),
    publisher_precision       text,
    quality_flags             text[] not null default '{}',
    rule_key                  text not null,
    rule_version              integer not null,
    provenance                jsonb not null default '{}'::jsonb,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),
    constraint dc_entity_geography_status_ck check (geography_status in
        ('RESOLVED', 'GEOGRAPHY_UNRESOLVED', 'NOT_A_SITE')),
    constraint dc_entity_geography_type_ck check (geometry_type in ('POINT', 'FOOTPRINT')),
    -- A resolved row has a geometry; an unresolved one never carries one to be misread.
    constraint dc_entity_geography_resolved_ck check (
        (geography_status = 'RESOLVED' and geom is not null and geometry_type is not null)
     or (geography_status <> 'RESOLVED' and geom is null and geometry_type is null))
);

alter table public.dc_entity_geography enable row level security;
revoke all on public.dc_entity_geography from anon, authenticated;

comment on table public.dc_entity_geography is
'STEP 3B. Canonical geography per canonical entity: RESOLVED (point or footprint),
GEOGRAPHY_UNRESOLVED or NOT_A_SITE, with quality flags and the observation that is its
authority. No ZIP here; membership is a separate stage over geo.zip_point_membership_in.';

create or replace function public.dc_resolve_geography(p_apply boolean default false)
returns table(metric text, value text)
language plpgsql
as $fn$
declare
    v_rule_version constant integer := 1;
    v_written integer := 0;
begin
    drop table if exists _geo_pts;
    drop table if exists _geo_pick;
    drop table if exists _geo_out;

    -- Every coordinate pair any CURRENT observation of an entity asserts.
    create temporary table _geo_pts on commit drop as
    select eo.canonical_entity_id, o.home_signal_observation_id oid, o.source_key,
           o.source_native_precision prec, o.source_native_lat lat, o.source_native_lon lng,
           least(scale(o.source_native_lat::text::numeric),
                 scale(o.source_native_lon::text::numeric)) decimals,
           o.observed_at
      from public.dc_entity_observation eo
      join public.dc_current_observation c
        on c.home_signal_observation_id = eo.home_signal_observation_id
      join public.dc_source_observation o
        on o.home_signal_observation_id = eo.home_signal_observation_id
     where o.source_native_lat is not null and o.source_native_lon is not null
       and o.source_native_lat between -90 and 90 and o.source_native_lon between -180 and 180;

    create temporary table _geo_pick on commit drop as
    select distinct on (canonical_entity_id) *
      from _geo_pts
     order by canonical_entity_id, (prec = 'exact') desc nulls last, decimals desc,
              observed_at desc, oid;

    create temporary table _geo_out on commit drop as
    with base as (
        select e.canonical_entity_id, e.entity_grain, p.oid, p.source_key, p.prec, p.lat,
               p.lng, p.decimals,
               exists (select 1 from _geo_pts a join _geo_pts b
                         on a.canonical_entity_id = b.canonical_entity_id
                        and a.source_key < b.source_key
                        where a.canonical_entity_id = e.canonical_entity_id
                          and ST_DistanceSphere(ST_MakePoint(a.lng, a.lat),
                                                ST_MakePoint(b.lng, b.lat)) > 1000) disagree,
               exists (select 1 from _geo_pick q
                        where q.canonical_entity_id <> e.canonical_entity_id
                          and q.lat = p.lat and q.lng = p.lng) shared
          from public.dc_canonical_entity e
          left join _geo_pick p on p.canonical_entity_id = e.canonical_entity_id
         where e.superseded_by is null)
    select b.*,
           case when b.entity_grain = 'AGGREGATE_MULTI_SITE' then 'NOT_A_SITE'
                when b.oid is null or b.disagree or b.decimals <= 1 then 'GEOGRAPHY_UNRESOLVED'
                else 'RESOLVED' end status,
           case when b.entity_grain = 'AGGREGATE_MULTI_SITE' then 'PUBLISHER_MULTI_SITE'
                when b.oid is null then 'NO_COORDINATES'
                when b.disagree then 'SOURCES_DISAGREE'
                when b.decimals <= 1 then 'ROUNDED_COORDINATES'
                else 'PUBLISHER_POINT' end rule_key,
           array_remove(array[
               case when b.oid is not null and b.decimals <= 1 then 'ROUNDED_COORDINATES' end,
               case when b.oid is not null and b.decimals <= 1 and b.prec = 'exact'
                    then 'PUBLISHER_CLAIMS_EXACT' end,
               case when b.decimals = 2 then 'COARSE_COORDINATES' end,
               case when b.prec = 'approximate' then 'PUBLISHER_APPROXIMATE' end,
               case when b.shared then 'SHARED_COORDINATES' end,
               case when b.disagree then 'SOURCES_DISAGREE' end,
               case when b.oid is null then 'NO_COORDINATES' end], null) flags
      from base b;

    if p_apply then
        insert into public.dc_entity_geography as g
            (canonical_entity_id, geography_status, geometry_type, geom, lat, lng,
             coordinate_decimals, authority_source_key, authority_observation_id,
             publisher_precision, quality_flags, rule_key, rule_version, provenance)
        select canonical_entity_id, status,
               case when status = 'RESOLVED' then 'POINT' end,
               case when status = 'RESOLVED' then ST_SetSRID(ST_MakePoint(lng, lat), 4326) end,
               lat, lng, decimals, source_key, oid, prec, flags, rule_key, v_rule_version,
               jsonb_build_object('rule', rule_key, 'observation', oid)
          from _geo_out
        on conflict (canonical_entity_id) do update
           set geography_status = excluded.geography_status,
               geometry_type = excluded.geometry_type, geom = excluded.geom,
               lat = excluded.lat, lng = excluded.lng,
               coordinate_decimals = excluded.coordinate_decimals,
               authority_source_key = excluded.authority_source_key,
               authority_observation_id = excluded.authority_observation_id,
               publisher_precision = excluded.publisher_precision,
               quality_flags = excluded.quality_flags, rule_key = excluded.rule_key,
               rule_version = excluded.rule_version, provenance = excluded.provenance,
               updated_at = now()
         where (g.geography_status, g.lat, g.lng, g.quality_flags, g.rule_key,
                g.authority_observation_id, g.rule_version)
               is distinct from
               (excluded.geography_status, excluded.lat, excluded.lng, excluded.quality_flags,
                excluded.rule_key, excluded.authority_observation_id, excluded.rule_version);
        get diagnostics v_written = row_count;
    end if;

    return query
        select 'MODE'::text, case when p_apply then 'APPLY' else 'REPORT_ONLY' end
        union all select 'ENTITIES', count(*)::text from _geo_out
        union all select 'ROWS_WRITTEN', case when p_apply then v_written::text else 'n/a' end
        union all select 'STATUS_' || s.status, s.n::text
               from (select status, count(*) n from _geo_out group by status) s
        union all select 'RULE_' || r.rule_key, r.n::text
               from (select rule_key, count(*) n from _geo_out group by rule_key) r
        union all select 'FLAG_' || f.flag, f.n::text
               from (select flag, count(*) n from _geo_out, unnest(flags) flag group by flag) f;
end;
$fn$;

comment on function public.dc_resolve_geography(boolean) is
'STEP 3B resolver. Default REPORT ONLY. Decides each canonical entity''s geography from its
current observations by column-level rules (grain, coordinates present, source agreement,
decimal places); never by place, project or source name. Idempotent: an unchanged entity is
not rewritten.';

-- ── AUTOMATIC, AFTER IDENTITY (2026-09-22) ─────────────────────────────────────────────────
-- dc-resolve-canonical runs at :25; geography follows at :35 so it reads that hour's entities.
-- Idempotent (an unchanged entity is not rewritten), DB-side, independent of GitHub Actions.
do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'dc-resolve-geography';
  perform cron.schedule('dc-resolve-geography', '35 * * * *',
                        'select count(*) from public.dc_resolve_geography(true)');
end
$cron$;

-- ============================================================================
-- N5 GENERATION PUBLICATION — PART D: MAKE THE LIFECYCLE RUNNABLE.
-- DDL OF RECORD. Applied AFTER docs/n5-generation-publish.sql Parts A-C (applied to
-- production 2026-09-25). Three sections, applied IN ORDER, each separately:
--
--   D-A  transactional, additive: two generation-scoped evidence tables, the per-generation
--        publication preparation, generation-correct candidate geometry, publish /
--        unresolved / reconcile / ready / activate / discard rewritten, and the
--        n5_association generation column (fast default, a catalog change).
--   D-B  NON-transactional: CREATE UNIQUE INDEX CONCURRENTLY for n5_association's
--        generation key, and the membership (generation_id, source_key) index.
--   D-C  transactional, short: swap n5_association's primary key, drop its default.
--
-- WHY (docs/maps-coverage/N5-GENERATION-RUNNABILITY-AUDIT-2026-09-25.md, verified against
-- the live catalog):
--   #6  geo.n5_association is keyed (source_key, zip) with no generation, and still holds
--       the legacy build: every shard of a new generation whose prefix drifted halts.
--   #8  nothing materialises proven points for a new snapshot. geo.n5_geom holds ONE pt:1
--       per project (PK source_key, feature_id), stamped with phase1 and read LIVE by
--       public.n5_projects_within_radius, which accepts only the consumable snapshot's
--       stamp — so a new snapshot's points can be neither added beside nor written over
--       the legacy ones. They get their own generation-scoped table.
--   #10 geo.n5_gen_record_unresolved has no evidence class for excluded sources,
--       unclassified registries, recoveries that returned nothing, or unstable identity;
--       the shard stage decides those and discarded the decision. It is now persisted.
--   #11 mark_ready / activate were each one statement doing far more than the 120 s
--       statement_timeout: per-chunk reconcile (two membership seq scans x 544 chunks) and
--       a per-row nested-loop chunk-coverage predicate (~12 min). Both are set-based now.
--
-- THE PROVEN-POINT RULE IS NOT NEW. It is the one the phase1 sweep applied, reproduced
-- EXACTLY and verified on production 2026-09-25 against phase1-2026-09-01: per PROVEN
-- source_key, the number of distinct non-null (lat, lng) over its snapshot rows —
--   1 -> ELIGIBLE (a point at that coordinate), 0 -> NULL_COORD, >1 -> MULTI_COORD_UNRESOLVED.
-- Result 718,278 / 294 / 4,877, identical to geo.n5_proven_verdict key by key (0 differing,
-- 0 on either side only), and 718,278 of 718,278 eligible coordinates equal to the stored
-- pt:1 geometry exactly (SRID 4269, POINT).
-- ============================================================================


-- ############################################################################
-- D-A — additive. One transaction.
-- ############################################################################
do $gate$
declare v text := current_setting('n5.verified_free_disk_mb', true);
begin
  -- ⛔ CAPACITY GATE (PART D-A). Same contract as Parts A/B: the operator states the
  -- PHYSICAL free disk, verified independently (the provider's own disk metrics), in MB.
  if v is null or v !~ '^[0-9]+$' or v::bigint < 2048 + 950 then
    raise exception 'CAPACITY GATE: n5.verified_free_disk_mb is %, need >= % (2,048 MB floor + 950 MB peak). Not applied.',
      coalesce(v, 'unset'), 2048 + 950;
  end if;
end $gate$;

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- D1. Per-generation publication preparation marker.
-- ---------------------------------------------------------------------------
alter table geo.n5_generation add column if not exists publish_prepared_at timestamptz;

-- ---------------------------------------------------------------------------
-- D2. THE GENERATION'S PROVEN POINTS (#8). One row per ELIGIBLE PROVEN project of the
--     generation's snapshot. Never shared between generations, so a later snapshot can
--     move a point without touching the serving generation's evidence or the radius RPC's.
-- ---------------------------------------------------------------------------
create table if not exists geo.n5_gen_proven_point (
  generation_id text not null references geo.n5_generation(generation_id) on delete cascade,
  source_key    text not null,
  registry_id   text,
  geom          geometry(Point, 4269) not null,
  primary key (generation_id, source_key));
create index if not exists n5_gen_proven_point_gix on geo.n5_gen_proven_point using gist (geom);
alter table geo.n5_gen_proven_point enable row level security;
revoke all on geo.n5_gen_proven_point from public;

-- ---------------------------------------------------------------------------
-- D3. THE GENERATION'S RECOVERED CANDIDATE KEYS. The snapshot's source_keys that carry
--     recovered_authoritative geometry, fixed once every shard is done. Lets candidate
--     geometry be bounded to the snapshot by an indexed join instead of re-reading the
--     ~3M-row snapshot on every prefix.
-- ---------------------------------------------------------------------------
create table if not exists geo.n5_gen_recovered_key (
  generation_id text not null references geo.n5_generation(generation_id) on delete cascade,
  source_key    text not null,
  primary key (generation_id, source_key));
alter table geo.n5_gen_recovered_key enable row level security;
revoke all on geo.n5_gen_recovered_key from public;

-- ---------------------------------------------------------------------------
-- D4. PER-KEY VERDICTS THE BUILD ALREADY MAKES (#10). Evidence, not a catch-all: every row
--     is written by the stage that decided it, and each class is a closed allowlist.
--       NULL_COORD / MULTI_COORD_UNRESOLVED  the proven-point rule (D6)
--       SOURCE_EXCLUDED                      the shard refused the registry (a configured
--                                            exclusion, or no service_url to recover from)
--       RECOVERY_UNSTABLE_IDENTITY           identity basis cannot be recovered
--                                            (source_id:row_id / source_id:title(MUTABLE))
--       RECOVERY_NOT_RETURNED                a COMPLETE recovery attempt returned no
--                                            feature at all for the key
--       REGISTRY_UNCLASSIFIED                the registry has no geo.n5_accepted_source row
-- ---------------------------------------------------------------------------
create table if not exists geo.n5_generation_key_verdict (
  generation_id text not null references geo.n5_generation(generation_id) on delete cascade,
  source_key    text not null,
  registry_id   text,
  verdict       text not null check (verdict in ('NULL_COORD','MULTI_COORD_UNRESOLVED',
                  'SOURCE_EXCLUDED','RECOVERY_UNSTABLE_IDENTITY','RECOVERY_NOT_RETURNED',
                  'REGISTRY_UNCLASSIFIED')),
  detail        jsonb,
  recorded_at   timestamptz not null default now(),
  primary key (generation_id, source_key));
alter table geo.n5_generation_key_verdict enable row level security;
revoke all on geo.n5_generation_key_verdict from public;

-- ---------------------------------------------------------------------------
-- D5. #6: n5_association becomes generation-scoped. The fast-default form is a CATALOG
--     change: the 2.8M existing rows are not rewritten; they READ as the legacy build that
--     produced them. D-B builds the generation key; D-C swaps it in and drops the default.
-- ---------------------------------------------------------------------------
alter table geo.n5_association
  add column if not exists generation_id text not null default 'legacy-phase1-2026-09-01';

-- the same guard as every other generation-scoped table: writable only while BUILDING
drop trigger if exists n5_generation_row_guard on geo.n5_gen_proven_point;
create trigger n5_generation_row_guard before insert or update or delete
  on geo.n5_gen_proven_point for each row execute function geo.n5_generation_row_guard();
drop trigger if exists n5_generation_row_guard on geo.n5_gen_recovered_key;
create trigger n5_generation_row_guard before insert or update or delete
  on geo.n5_gen_recovered_key for each row execute function geo.n5_generation_row_guard();
drop trigger if exists n5_generation_row_guard on geo.n5_generation_key_verdict;
create trigger n5_generation_row_guard before insert or update or delete
  on geo.n5_generation_key_verdict for each row execute function geo.n5_generation_row_guard();
drop trigger if exists n5_generation_row_guard on geo.n5_association;
create trigger n5_generation_row_guard before insert or update or delete
  on geo.n5_association for each row execute function geo.n5_generation_row_guard();

-- ---------------------------------------------------------------------------
-- D6. PREPARE PUBLICATION — once, after every shard is done, before any prefix publishes.
--     Materialises the proven points and their verdicts (the phase1 rule, verified exact)
--     and fixes the recovered candidate key set. Refuses once any prefix has published:
--     re-preparing under a published prefix would change evidence it was built from.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_gen_prepare_publish(p_generation_id text)
returns jsonb
language plpgsql
set search_path = geo, public, pg_temp
as $$
declare
  g      geo.n5_generation;
  n_bad  bigint;
  n_pt   bigint;
  n_null bigint;
  n_mult bigint;
  n_rec  bigint;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id for update;
  if not found then
    raise exception 'prepare: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if g.state <> 'BUILDING' then
    raise exception 'prepare: generation % is %, not BUILDING', p_generation_id, g.state using errcode = '22023';
  end if;
  select count(*) into n_bad from geo.n5_shard s
   where s.generation_id = p_generation_id and s.state <> 'done';
  if n_bad > 0 then
    raise exception 'prepare: % shard(s) of generation % are not done — recovered geometry is incomplete', n_bad, p_generation_id
      using errcode = '22023';
  end if;
  if not exists (select 1 from geo.n5_shard s where s.generation_id = p_generation_id) then
    raise exception 'prepare: generation % has no shards', p_generation_id using errcode = '22023';
  end if;
  if exists (select 1 from geo.n5_generation_publish p where p.generation_id = p_generation_id) then
    raise exception 'prepare: generation % already has published prefixes — its evidence is fixed', p_generation_id
      using errcode = '22023';
  end if;

  delete from geo.n5_gen_proven_point where generation_id = p_generation_id;
  delete from geo.n5_gen_recovered_key where generation_id = p_generation_id;
  delete from geo.n5_generation_key_verdict
   where generation_id = p_generation_id and verdict in ('NULL_COORD','MULTI_COORD_UNRESOLVED');

  drop table if exists n5_prep_proven;
  create temp table n5_prep_proven on commit drop as
  select e.source_key,
         min(e.registry_id) registry_id,
         min(e.lat) lat, min(e.lng) lng,
         count(distinct (e.lat, e.lng)) filter (where e.lat is not null and e.lng is not null) nc
    from public.n5_expected_captured(g.snapshot_id) e
    join geo.n5_accepted_source a on a.registry_id = e.registry_id and a.treatment = 'PROVEN'
   group by e.source_key;

  insert into geo.n5_gen_proven_point (generation_id, source_key, registry_id, geom)
  select p_generation_id, k.source_key, k.registry_id, ST_SetSRID(ST_MakePoint(k.lng, k.lat), 4269)
    from n5_prep_proven k where k.nc = 1;
  get diagnostics n_pt = row_count;

  insert into geo.n5_generation_key_verdict (generation_id, source_key, registry_id, verdict, detail)
  select p_generation_id, k.source_key, k.registry_id,
         case when k.nc = 0 then 'NULL_COORD' else 'MULTI_COORD_UNRESOLVED' end,
         jsonb_build_object('distinct_coordinates', k.nc, 'rule', 'phase1 proven-point rule')
    from n5_prep_proven k where k.nc <> 1
  on conflict (generation_id, source_key) do nothing;
  select count(*) filter (where k.nc = 0), count(*) filter (where k.nc > 1) into n_null, n_mult
    from n5_prep_proven k;

  insert into geo.n5_gen_recovered_key (generation_id, source_key)
  select distinct p_generation_id, e.source_key
    from public.n5_expected_captured(g.snapshot_id) e
   where exists (select 1 from geo.n5_geom gg
                  where gg.source_key = e.source_key and gg.provenance = 'recovered_authoritative');
  get diagnostics n_rec = row_count;

  update geo.n5_generation set publish_prepared_at = now() where generation_id = p_generation_id;
  return jsonb_build_object('generation_id', p_generation_id, 'proven_points', n_pt,
    'null_coord', n_null, 'multi_coord_unresolved', n_mult, 'recovered_keys', n_rec);
end $$;
revoke all on function geo.n5_gen_prepare_publish(text) from public;

-- ---------------------------------------------------------------------------
-- D7. INV-2, generation-correct. Candidate geometry = the snapshot's recovered geometry
--     (bounded by the prepared key set) UNION the generation's OWN proven points. The
--     legacy pt:1 rows in geo.n5_geom are never read for a generation: they carry phase1's
--     coordinates, which a later snapshot may have moved. Row shape stays geo.n5_geom.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_gen_candidate_geom(p_generation_id text)
returns setof geo.n5_geom
language sql stable
as $$
  select g.*
    from geo.n5_geom g
    join geo.n5_gen_recovered_key rk
      on rk.generation_id = p_generation_id and rk.source_key = g.source_key
   where g.provenance = 'recovered_authoritative'
  union all
  select pp.source_key, pp.registry_id, 'pt:1'::text, 1::smallint,
         pp.geom::geometry(Geometry, 4269), null::text, null::char(3),
         gen.publish_prepared_at, 'proven_stored_point'::text, gen.snapshot_id
    from geo.n5_gen_proven_point pp
    join geo.n5_generation gen on gen.generation_id = pp.generation_id
   where pp.generation_id = p_generation_id;
$$;
revoke all on function geo.n5_gen_candidate_geom(text) from public;

-- ---------------------------------------------------------------------------
-- D8. PUBLISH ONE PREFIX — Part A's function with two changes and nothing else:
--     (a) refuses until the generation is prepared (D6);
--     (b) membership and markers read the generation's geometry (recovered + its own
--         proven points), never the legacy pt:1. The rules themselves are unchanged.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_gen_publish_prefix(
  p_generation_id text, p_prefix text, p_run_id text, p_expected_zcta integer,
  p_d_m double precision default 1000,
  p_min_line_m double precision default 250,
  p_min_area_m2 double precision default 1000)
returns jsonb
language plpgsql
set search_path = geo, public, pg_temp
as $$
declare
  g        geo.n5_generation;
  n_zcta   int;
  n_bound  int;
  n_memb   int;
  n_mark   int;
  n_status int;
  n_bad    bigint;
  v_dtag   text := (p_d_m::bigint)::text;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id for update;
  if not found then
    raise exception 'publish: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if g.state <> 'BUILDING' then
    raise exception 'publish: generation % is %, not BUILDING', p_generation_id, g.state using errcode = '22023';
  end if;
  if p_prefix !~ '^[0-9]{3}$' then
    raise exception 'publish: prefix must be a ZIP3, got %', p_prefix using errcode = '22023';
  end if;
  if not exists (select 1 from geo.n5_generation_publish_scope(p_generation_id) sc where sc.z3 = p_prefix) then
    raise exception 'publish: % is not in the publication scope of generation %', p_prefix, p_generation_id using errcode = '22023';
  end if;
  -- Boundary resolution needs the WHOLE generation's geometry: a project whose expected
  -- ZIP is in another prefix can land here. Publishing before every shard finished would
  -- miss it in silence.
  select count(*) into n_bad from geo.n5_shard s
   where s.generation_id = p_generation_id and s.state <> 'done';
  if n_bad > 0 then
    raise exception 'publish: % shard(s) of generation % are not done — geometry is incomplete', n_bad, p_generation_id
      using errcode = '22023';
  end if;
  if g.publish_prepared_at is null then
    raise exception 'publish: generation % is not prepared (geo.n5_gen_prepare_publish) — its proven points do not exist yet', p_generation_id
      using errcode = '22023';
  end if;
  -- The instrument must prove it ran: the loader declares how many boundaries it loaded.
  select count(*) into n_zcta from geo.n5_gen_zcta z
   where z.generation_id = p_generation_id and z.prefix = p_prefix;
  if p_expected_zcta is null or n_zcta <> p_expected_zcta then
    raise exception 'publish: % boundaries resident for %/% but the loader declared %',
      n_zcta, p_generation_id, p_prefix, p_expected_zcta using errcode = '22023';
  end if;

  -- idempotent re-publish of THIS candidate prefix only
  delete from geo.maps_zip_geography_status   where generation_id = p_generation_id and left(zip, 3)   = p_prefix;
  delete from geo.zip_authoritative_marker     where generation_id = p_generation_id and left(zcta5, 3) = p_prefix;
  delete from geo.zip_authoritative_membership where generation_id = p_generation_id and left(zcta5, 3) = p_prefix;
  delete from geo.n5_boundary_membership       where generation_id = p_generation_id and left(zcta5, 3) = p_prefix;

  -- (1) BOUNDARY RESOLUTION. Candidate set = the generation's national candidate geometry.
  --     [candidate-bounding probe begins]
  insert into geo.n5_boundary_membership (generation_id, zcta5, source_key, provenance, run_id)
  select distinct on (b.zcta5, c.source_key)
         b.generation_id, b.zcta5, c.source_key, c.provenance, p_run_id
    from geo.n5_gen_zcta b
    join geo.n5_gen_candidate_geom(p_generation_id) c
      on c.outcome = 1 and c.geom is not null and ST_Intersects(c.geom, b.geom)
   where b.generation_id = p_generation_id and b.prefix = p_prefix
   order by b.zcta5, c.source_key, c.provenance;
  --     [candidate-bounding probe ends]
  get diagnostics n_bound = row_count;

  -- (2) MEMBERSHIP, one deterministic representative point per (ZIP, project). Geometry is
  --     the GENERATION's: recovered rows, plus this generation's own proven point.
  insert into geo.zip_authoritative_membership
    (generation_id, zcta5, source_key, lat, lng, point_rule, clip_dim, feature_count, geom_family, run_id)
  select b.generation_id, b.zcta5, m.source_key,
         case when p.pt is null then null else ST_Y(p.pt) end,
         case when p.pt is null then null else ST_X(p.pt) end,
         p.rule, x.dim, x.nfeat, x.family, p_run_id
    from geo.n5_gen_zcta b
    join geo.n5_boundary_membership m on m.generation_id = b.generation_id and m.zcta5 = b.zcta5
    cross join lateral (
        select ST_Intersection(ST_MakeValid(ST_Union(gg.geom)), b.geom) clip,
               count(*)::int nfeat,
               min(ST_GeometryType(gg.geom)) family
          from (select r.geom from geo.n5_geom r
                 where r.source_key = m.source_key and r.provenance = 'recovered_authoritative'
                   and r.outcome = 1 and r.geom is not null
                union all
                select pp.geom from geo.n5_gen_proven_point pp
                 where pp.generation_id = b.generation_id and pp.source_key = m.source_key) gg
         where ST_Intersects(ST_MakeValid(gg.geom), b.geom)) f
    cross join lateral (select f.clip, f.nfeat, f.family,
                               case when f.clip is null then null else ST_Dimension(f.clip) end::smallint dim) x
    cross join lateral geo.n5_rep_point(x.clip) p
   where b.generation_id = p_generation_id and b.prefix = p_prefix;
  get diagnostics n_memb = row_count;

  -- (3) MARKERS — the chosen A3 rule, unchanged; geometry is the generation's.
  insert into geo.zip_authoritative_marker
    (generation_id, zcta5, source_key, marker_seq, lat, lng, marker_rule, family, dim, run_id)
  with base as (
    select b.zcta5, m.source_key, x.family, x.clip
      from geo.n5_gen_zcta b
      join geo.zip_authoritative_membership m on m.generation_id = b.generation_id and m.zcta5 = b.zcta5
      cross join lateral (
          select ST_Intersection(ST_MakeValid(ST_Union(gg.geom)), b.geom) clip,
                 min(ST_GeometryType(gg.geom)) family
            from (select r.geom from geo.n5_geom r
                   where r.source_key = m.source_key and r.provenance = 'recovered_authoritative'
                     and r.outcome = 1 and r.geom is not null
                  union all
                  select pp.geom from geo.n5_gen_proven_point pp
                   where pp.generation_id = b.generation_id and pp.source_key = m.source_key) gg
           where ST_Intersects(ST_MakeValid(gg.geom), b.geom)) x
     where b.generation_id = p_generation_id and b.prefix = p_prefix),
  comp as (
    select z.zcta5, z.source_key, z.family, 1 as dim, d.geom gm, ST_Length(d.geom::geography) measure
      from base z cross join lateral ST_Dump(ST_LineMerge(ST_CollectionExtract(z.clip, 2))) d
     where not ST_IsEmpty(d.geom)
    union all
    select z.zcta5, z.source_key, z.family, 2, d.geom, ST_Area(d.geom::geography)
      from base z cross join lateral ST_Dump(ST_CollectionExtract(z.clip, 3)) d
     where not ST_IsEmpty(d.geom)
    union all
    select z.zcta5, z.source_key, z.family, 0, d.geom, 0
      from base z cross join lateral ST_Dump(ST_CollectionExtract(z.clip, 1)) d
     where not ST_IsEmpty(d.geom)),
  keep as (
    select c.*,
           (c.dim = 0
            or (c.dim = 1 and (c.measure >= p_min_line_m
                               or c.measure = max(case when c.dim = 1 then c.measure end)
                                                over (partition by c.zcta5, c.source_key)))
            or (c.dim = 2 and (c.measure >= p_min_area_m2
                               or c.measure = max(case when c.dim = 2 then c.measure end)
                                                over (partition by c.zcta5, c.source_key)))) as keep_it
      from comp c),
  placed as (
    select k.zcta5, k.source_key, k.family, k.dim, k.measure, k.gm, gs.i,
           greatest(1, ceil(k.measure / p_d_m)::int) as n_on_comp
      from keep k
      cross join lateral generate_series(
          0, case when k.dim = 1 then greatest(1, ceil(k.measure / p_d_m)::int) - 1 else 0 end) gs(i)
     where k.keep_it),
  pt as (
    select p.*,
           case when p.dim = 1 then ST_LineInterpolatePoint(p.gm, (p.i + 0.5) / p.n_on_comp::float8)
                when p.dim = 2 then ST_PointOnSurface(p.gm)
                else p.gm end as mp
      from placed p)
  select p_generation_id, zcta5, source_key,
         row_number() over (partition by zcta5, source_key
                            order by dim desc, measure desc, ST_AsBinary(gm) asc, i asc)::int,
         ST_Y(mp), ST_X(mp),
         case when dim = 1 then 'LINE_MERGED_COMPONENT_INTERVAL_' || v_dtag || 'M'
              when dim = 2 then 'POLYGON_COMPONENT_POINT_ON_SURFACE'
              else 'POINT_AUTHORITATIVE' end,
         family, dim::smallint, p_run_id
    from pt;
  get diagnostics n_mark = row_count;

  -- (4) STATUS for EVERY canonical ZIP of the prefix: a loaded boundary is measured
  --     (possibly a measured zero); no boundary is 'not_measured', never an absent row.
  insert into geo.maps_zip_geography_status (generation_id, zip, status, membership_rows, completed_at, run_id, note)
  select p_generation_id, r.zip,
         case when z.zcta5 is not null then 'boundary_complete' else 'not_measured' end,
         case when z.zcta5 is not null
              then (select count(*) from geo.n5_boundary_membership bm
                     where bm.generation_id = p_generation_id and bm.zcta5 = r.zip)
              else 0 end,
         now(), p_run_id,
         case when z.zcta5 is null then 'NO_ZCTA_BOUNDARY: canonical ZIP has no Census ZCTA polygon' end
    from public.canonical_zip_registry r
    left join geo.n5_gen_zcta z
      on z.generation_id = p_generation_id and z.prefix = p_prefix and z.zcta5 = r.zip
   where left(r.zip, 3) = p_prefix;
  get diagnostics n_status = row_count;

  -- (5) PROOFS, while the boundaries are still resident.
  select count(*) into n_bad
    from geo.zip_authoritative_marker k
    join geo.n5_gen_zcta b on b.generation_id = k.generation_id and b.zcta5 = k.zcta5
   where k.generation_id = p_generation_id and b.prefix = p_prefix
     and not ST_Intersects(ST_SetSRID(ST_MakePoint(k.lng, k.lat), 4269), b.geom);
  if n_bad > 0 then
    raise exception 'publish: % marker(s) of %/% fall outside their ZIP', n_bad, p_generation_id, p_prefix;
  end if;
  select count(*) into n_bad
    from geo.zip_authoritative_membership m
   where m.generation_id = p_generation_id and left(m.zcta5, 3) = p_prefix
     and not exists (select 1 from geo.zip_authoritative_marker k
                      where k.generation_id = m.generation_id and k.zcta5 = m.zcta5
                        and k.source_key = m.source_key);
  if n_bad > 0 then
    raise exception 'publish: % membership row(s) of %/% have no marker — refusing a membership Map 1 would not draw',
      n_bad, p_generation_id, p_prefix;
  end if;

  delete from geo.n5_gen_zcta where generation_id = p_generation_id and prefix = p_prefix;

  insert into geo.n5_generation_publish
    (generation_id, z3, run_id, zcta_loaded, boundary_rows, membership_rows, marker_rows, status_rows, completed_at)
  values (p_generation_id, p_prefix, p_run_id, n_zcta, n_bound, n_memb, n_mark, n_status, now())
  on conflict (generation_id, z3) do update
    set run_id = excluded.run_id, zcta_loaded = excluded.zcta_loaded,
        boundary_rows = excluded.boundary_rows, membership_rows = excluded.membership_rows,
        marker_rows = excluded.marker_rows, status_rows = excluded.status_rows,
        completed_at = excluded.completed_at;
  -- a re-published prefix invalidates any earlier unresolved accounting
  update geo.n5_generation set unresolved_recorded_at = null where generation_id = p_generation_id;

  return jsonb_build_object('generation_id', p_generation_id, 'prefix', p_prefix,
    'zcta_loaded', n_zcta, 'boundary_rows', n_bound, 'membership_rows', n_memb,
    'marker_rows', n_mark, 'status_rows', n_status);
end $$;
revoke all on function geo.n5_gen_publish_prefix(text, text, text, integer, double precision, double precision, double precision) from public;

-- ---------------------------------------------------------------------------
-- D9. INV-4, with the build's persisted verdicts (#10). Order of precedence:
--       NO_INTERSECTION_WITH_GENERATION_ZCTAS  the generation HAS usable geometry for the
--                                              key (recovered, or its own proven point) and
--                                              it intersected no published ZCTA
--       POINT_REJECTED                         proven-point verdict NULL_COORD /
--                                              MULTI_COORD_UNRESOLVED (reason kept)
--       GEOMETRY_INVALID                       only quarantined recovered geometry
--       REGISTRY_NOAUTH / _IDENT_UNRESOLVED / _HIST_UNRECOVERABLE   the source catalogue
--       SOURCE_EXCLUDED / RECOVERY_UNSTABLE_IDENTITY / RECOVERY_NOT_RETURNED /
--       REGISTRY_UNCLASSIFIED                  the shard's persisted verdict
--     An expected key matching none of them is NOT written: it stays UNACCOUNTED and blocks
--     readiness. There is still no catch-all. The legacy, snapshot-less geo.n5_point_reject
--     is no longer read: a generation's point verdicts are its own.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_gen_record_unresolved(p_generation_id text)
returns jsonb
language plpgsql
set search_path = geo, public, pg_temp
as $$
declare
  g         geo.n5_generation;
  n_unpub   int;
  n_written int;
  n_pref    int;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id for update;
  if not found then
    raise exception 'unresolved: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if g.state <> 'BUILDING' then
    raise exception 'unresolved: generation % is %, not BUILDING', p_generation_id, g.state using errcode = '22023';
  end if;
  select count(*) into n_unpub from geo.n5_generation_publish_scope(p_generation_id) sc
   where not exists (select 1 from geo.n5_generation_publish p
                      where p.generation_id = p_generation_id and p.z3 = sc.z3);
  if n_unpub > 0 then
    raise exception 'unresolved: % prefix(es) of % are unpublished — an absence is not evidence yet', n_unpub, p_generation_id
      using errcode = '22023';
  end if;
  select count(*) into n_pref from geo.n5_generation_publish p where p.generation_id = p_generation_id;

  delete from geo.n5_generation_unresolved where generation_id = p_generation_id;

  with expected as (
    select e.source_key, min(e.zip) zip, min(e.registry_id) registry_id
      from public.n5_expected_captured(g.snapshot_id) e
     group by e.source_key),
  missing as (
    select x.* from expected x
     where not exists (select 1 from geo.zip_authoritative_membership m
                        where m.generation_id = p_generation_id and m.source_key = x.source_key)),
  classified as (
    select x.source_key, x.zip,
           case
             when exists (select 1 from geo.n5_geom gg where gg.source_key = x.source_key
                            and gg.provenance = 'recovered_authoritative'
                            and gg.outcome = 1 and gg.geom is not null)
               or exists (select 1 from geo.n5_gen_proven_point pp
                           where pp.generation_id = p_generation_id and pp.source_key = x.source_key)
               then 'NO_INTERSECTION_WITH_GENERATION_ZCTAS'
             when v.verdict in ('NULL_COORD','MULTI_COORD_UNRESOLVED') then 'POINT_REJECTED'
             when exists (select 1 from geo.n5_geom gg where gg.source_key = x.source_key
                            and gg.provenance = 'recovered_authoritative')
               then 'GEOMETRY_INVALID'
             when a.treatment in ('NOAUTH','IDENT_UNRESOLVED','HIST_UNRECOVERABLE')
               then 'REGISTRY_' || a.treatment
             when v.verdict in ('SOURCE_EXCLUDED','RECOVERY_UNSTABLE_IDENTITY',
                                'RECOVERY_NOT_RETURNED','REGISTRY_UNCLASSIFIED')
               then v.verdict
           end as reason_code,
           jsonb_strip_nulls(jsonb_build_object(
             'prefixes_probed', n_pref,
             'verdict', v.verdict, 'verdict_detail', v.detail,
             'invalid_reasons', (select jsonb_agg(distinct gg.invalid_reason) from geo.n5_geom gg
                                  where gg.source_key = x.source_key
                                    and gg.provenance = 'recovered_authoritative' and gg.outcome <> 1),
             'registry_id', x.registry_id, 'registry_treatment', a.treatment)) as detail
      from missing x
      left join geo.n5_generation_key_verdict v
             on v.generation_id = p_generation_id and v.source_key = x.source_key
      left join geo.n5_accepted_source a on a.registry_id = x.registry_id)
  insert into geo.n5_generation_unresolved (generation_id, source_key, zip, reason_code, detail)
  select p_generation_id, c.source_key, c.zip, c.reason_code, c.detail
    from classified c
   where c.reason_code is not null;
  get diagnostics n_written = row_count;

  update geo.n5_generation set unresolved_recorded_at = now() where generation_id = p_generation_id;
  return jsonb_build_object('generation_id', p_generation_id, 'unresolved_written', n_written,
                            'prefixes_probed', n_pref);
end $$;
revoke all on function geo.n5_gen_record_unresolved(text) from public;

-- ---------------------------------------------------------------------------
-- D10. RECONCILIATION, set-based (#11). The SAME definition as geo.n5_reconcile_chunk —
--      expected = distinct source_keys whose source-stated ZIP falls in the chunk;
--      resolved = has membership ANYWHERE in the generation (INV-5); unresolved = has a
--      recorded outcome — computed for every declared chunk in ONE pass. The per-chunk
--      form re-scanned membership twice per chunk (chunk 850: 56.7 s, x 544 chunks).
--      Chunk keys are matched by length, so each join is an equi-join on left(zip, n).
-- ---------------------------------------------------------------------------
create or replace function geo.n5_reconcile_chunks(p_generation_id text, p_chunks text[])
returns table (chunks integer, expected_keys bigint, accounted_resolved bigint,
               accounted_unresolved bigint, unaccounted bigint)
language plpgsql
set search_path to 'geo', 'public', 'pg_temp'
as $function$
declare
  g     geo.n5_generation;
  n_cap bigint;
  bad   text;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id;
  if not found then
    raise exception 'n5_reconcile_chunks: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if p_chunks is null or array_length(p_chunks, 1) is null then
    raise exception 'n5_reconcile_chunks: no chunks declared' using errcode = '22023';
  end if;
  select k into bad from unnest(p_chunks) k where k is null or k !~ '^[0-9]{1,5}$' limit 1;
  if found then
    raise exception 'n5_reconcile_chunks: chunk_key must be a ZIP prefix, got %', bad using errcode = '22023';
  end if;
  select count(*) into n_cap
    from preservation.app_project_identity i
   where i.snapshot_id = g.snapshot_id and i.record_kind = 'development';
  if n_cap = 0 then
    raise exception 'n5_reconcile_chunks: generation % has no captured expected set for snapshot % — refusing a vacuous pass',
      p_generation_id, g.snapshot_id using errcode = '22023';
  end if;

  drop table if exists n5_rc_keys; drop table if exists n5_rc_res; drop table if exists n5_rc_unr;
  create temp table n5_rc_keys on commit drop as
  with ch as (select distinct k, length(k) len from unnest(p_chunks) k),
  e as (select distinct x.source_key, x.zip from public.n5_expected_captured(g.snapshot_id) x)
  select c.k chunk_key, e.source_key from e join ch c on c.len = 1 and c.k = left(e.zip, 1)
  union
  select c.k, e.source_key from e join ch c on c.len = 2 and c.k = left(e.zip, 2)
  union
  select c.k, e.source_key from e join ch c on c.len = 3 and c.k = left(e.zip, 3)
  union
  select c.k, e.source_key from e join ch c on c.len = 4 and c.k = left(e.zip, 4)
  union
  select c.k, e.source_key from e join ch c on c.len = 5 and c.k = e.zip;

  create temp table n5_rc_res on commit drop as
  select distinct m.source_key from geo.zip_authoritative_membership m
   where m.generation_id = p_generation_id and m.record_kind = 'development';
  create temp table n5_rc_unr on commit drop as
  select distinct u.source_key from geo.n5_generation_unresolved u
   where u.generation_id = p_generation_id;

  insert into geo.n5_generation_reconcile as r
    (generation_id, chunk_key, expected_keys, accounted_resolved, accounted_unresolved, unaccounted, computed_at)
  select p_generation_id, c.k,
         count(k.source_key),
         count(k.source_key) filter (where rs.source_key is not null),
         count(k.source_key) filter (where un.source_key is not null),
         count(k.source_key) filter (where rs.source_key is null and un.source_key is null),
         now()
    from (select distinct k from unnest(p_chunks) k) c
    left join n5_rc_keys k on k.chunk_key = c.k
    left join n5_rc_res rs on rs.source_key = k.source_key
    left join n5_rc_unr un on un.source_key = k.source_key
   group by c.k
  on conflict (generation_id, chunk_key) do update
    set expected_keys        = excluded.expected_keys,
        accounted_resolved   = excluded.accounted_resolved,
        accounted_unresolved = excluded.accounted_unresolved,
        unaccounted          = excluded.unaccounted,
        computed_at          = excluded.computed_at;

  drop table n5_rc_keys; drop table n5_rc_res; drop table n5_rc_unr;
  return query
    select count(*)::int, coalesce(sum(r.expected_keys), 0)::bigint, coalesce(sum(r.accounted_resolved), 0)::bigint,
           coalesce(sum(r.accounted_unresolved), 0)::bigint, coalesce(sum(r.unaccounted), 0)::bigint
      from geo.n5_generation_reconcile r
     where r.generation_id = p_generation_id and r.chunk_key = any (p_chunks);
end
$function$;
revoke all on function geo.n5_reconcile_chunks(text, text[]) from public;

-- ---------------------------------------------------------------------------
-- D11. ONE DEFINITION OF "COMPLETE" — Part A's checks, with the chunk-coverage predicate
--      evaluated per distinct ZIP instead of per row (identical result; ~12 min -> seconds),
--      and one added check: the generation was prepared.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_generation_publish_problems(p_generation_id text, p_expected_chunks text[])
returns table (check_name text, n bigint)
language sql stable
set search_path = geo, public, pg_temp
as $$
  with g as (select * from geo.n5_generation where generation_id = p_generation_id),
  checks as (
    select 'shards_not_done'::text c,
           (select count(*) from geo.n5_shard s where s.generation_id = p_generation_id and s.state <> 'done') n
    union all
    select 'no_shards', case when exists (select 1 from geo.n5_shard s where s.generation_id = p_generation_id) then 0 else 1 end
    union all
    select 'not_prepared', (select case when g.publish_prepared_at is null then 1 else 0 end from g)
    union all
    select 'prefixes_unpublished',
           (select count(*) from geo.n5_generation_publish_scope(p_generation_id) sc
             where not exists (select 1 from geo.n5_generation_publish p
                                where p.generation_id = p_generation_id and p.z3 = sc.z3))
    union all
    select 'unresolved_not_recorded_after_last_publish',
           (select case when g.unresolved_recorded_at is null
                          or g.unresolved_recorded_at < coalesce((select max(p.completed_at) from geo.n5_generation_publish p
                                                                   where p.generation_id = p_generation_id), '-infinity')
                        then 1 else 0 end from g)
    union all
    select 'membership_without_marker',
           (select count(*) from geo.zip_authoritative_membership m
             where m.generation_id = p_generation_id
               and not exists (select 1 from geo.zip_authoritative_marker k
                                where k.generation_id = m.generation_id and k.zcta5 = m.zcta5 and k.source_key = m.source_key))
    union all
    select 'marker_without_membership',
           (select count(*) from geo.zip_authoritative_marker k
             where k.generation_id = p_generation_id
               and not exists (select 1 from geo.zip_authoritative_membership m
                                where m.generation_id = k.generation_id and m.zcta5 = k.zcta5 and m.source_key = k.source_key))
    union all
    select 'canonical_zip_without_status',
           (select count(*) from public.canonical_zip_registry r
             where not exists (select 1 from geo.maps_zip_geography_status st
                                where st.generation_id = p_generation_id and st.zip = r.zip))
    union all
    select 'boundary_scratch_residue',
           (select count(*) from geo.n5_gen_zcta z where z.generation_id = p_generation_id)
    union all
    -- the declared chunk set must cover every expected key, or reconciliation could pass
    -- while a slice of the expected set was never evaluated at all. Evaluated once per
    -- distinct ZIP (a ZIP is covered or not regardless of how many rows carry it).
    select 'expected_keys_outside_declared_chunks',
           (select coalesce(sum(z.n), 0) from (
              select e.zip, count(*) n
                from public.n5_expected_captured((select snapshot_id from g)) e
               group by e.zip) z
             where p_expected_chunks is null
                or not exists (select 1 from unnest(p_expected_chunks) c(k)
                                where z.zip >= rpad(c.k, 5, '0') and z.zip <= rpad(c.k, 5, '9'))))
  select c, n from checks where n > 0;
$$;
revoke all on function geo.n5_generation_publish_problems(text, text[]) from public;

-- ---------------------------------------------------------------------------
-- D12. BUILDING -> READY and ACTIVATE — Part A's functions with the per-chunk loop replaced
--      by the set-based pass (D10). Every gate is otherwise unchanged and still recomputed
--      inside the switching transaction.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_generation_mark_ready(p_generation_id text, p_expected_chunks text[])
returns geo.n5_generation
language plpgsql
set search_path = geo, public, pg_temp
as $$
declare
  g        geo.n5_generation;
  prob     record;
  rc       record;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id for update;
  if not found then
    raise exception 'ready: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if g.state <> 'BUILDING' then
    raise exception 'ready: generation % is %, not BUILDING', p_generation_id, g.state using errcode = '22023';
  end if;
  if p_expected_chunks is null or array_length(p_expected_chunks, 1) is null then
    raise exception 'ready: no expected chunk set declared' using errcode = '22023';
  end if;
  for prob in select * from geo.n5_generation_publish_problems(p_generation_id, p_expected_chunks) loop
    raise exception 'ready: generation % is incomplete — % = %', p_generation_id, prob.check_name, prob.n
      using errcode = '22023';
  end loop;
  select * into rc from geo.n5_reconcile_chunks(p_generation_id, p_expected_chunks);
  if rc.unaccounted > 0 then
    raise exception 'ready: INV-1 violated — % of % expected source_keys have no accounted outcome', rc.unaccounted, rc.expected_keys
      using errcode = '22023';
  end if;
  if rc.expected_keys = 0 then
    raise exception 'ready: reconciliation covered 0 expected records — refusing a vacuous pass' using errcode = '22023';
  end if;
  update geo.n5_generation set state = 'READY' where generation_id = p_generation_id returning * into g;
  return g;
end $$;
revoke all on function geo.n5_generation_mark_ready(text, text[]) from public;

create or replace function geo.n5_generation_activate(p_generation_id text, p_expected_chunks text[])
returns geo.n5_generation
language plpgsql
set search_path to 'geo', 'public', 'pg_temp'
as $function$
declare
  g            geo.n5_generation;
  prev         geo.n5_generation;
  n_chunks     int;
  n_missing    int;
  rc           record;
  integ        record;
  prob         record;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id for update;
  if not found then
    raise exception 'activate: unknown generation %', p_generation_id using errcode = '22023';
  end if;

  if g.state <> 'READY' then
    raise exception 'activate: generation % is %, not READY', p_generation_id, g.state using errcode = '22023';
  end if;

  if p_expected_chunks is null or array_length(p_expected_chunks, 1) is null then
    raise exception 'activate: no expected chunk set declared' using errcode = '22023';
  end if;
  n_chunks := array_length(p_expected_chunks, 1);
  select count(*) into n_missing
    from unnest(p_expected_chunks) c(k)
   where not exists (select 1 from geo.n5_generation_reconcile r
                      where r.generation_id = p_generation_id and r.chunk_key = c.k);
  if n_missing > 0 then
    raise exception 'activate: % of % declared chunks have no reconciliation row', n_missing, n_chunks using errcode = '22023';
  end if;

  -- RECOMPUTED, never trusted: reconcile rows are an ordinary table, so the answer the
  -- switch acts on is derived here, inside the switching transaction.
  select * into rc from geo.n5_reconcile_chunks(p_generation_id, p_expected_chunks);
  if rc.unaccounted > 0 then
    raise exception 'activate: INV-1 violated — % of % expected source_keys have no accounted outcome', rc.unaccounted, rc.expected_keys using errcode = '22023';
  end if;

  if rc.expected_keys = 0 then
    raise exception 'activate: reconciliation covered 0 expected records — refusing a vacuous pass' using errcode = '22023';
  end if;

  for prob in select * from geo.n5_generation_publish_problems(p_generation_id, p_expected_chunks) loop
    raise exception 'activate: generation % is incomplete — % = %', p_generation_id, prob.check_name, prob.n
      using errcode = '22023';
  end loop;

  for integ in select * from public.n5_expected_input_integrity() loop
    if not integ.ok then
      raise exception 'activate: source integrity check % failed — %', integ.check_name, integ.detail using errcode = '22023';
    end if;
  end loop;

  select * into prev from geo.n5_generation
   where state in ('ACTIVE','ACTIVE_LEGACY') and generation_id <> p_generation_id
   for update;

  update geo.n5_generation
     set superseded_from_state = state, state = 'SUPERSEDED', superseded_at = now()
   where state in ('ACTIVE','ACTIVE_LEGACY') and generation_id <> p_generation_id;

  update geo.n5_generation
     set state = 'ACTIVE', activated_at = now(),
         predecessor_generation_id = coalesce(predecessor_generation_id, prev.generation_id)
   where generation_id = p_generation_id
  returning * into g;

  return g;
end
$function$;
revoke all on function geo.n5_generation_activate(text, text[]) from public;

-- ---------------------------------------------------------------------------
-- D13. DISCARD covers the new generation-scoped tables.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_generation_discard(p_generation_id text)
returns jsonb
language plpgsql
set search_path = geo, public, pg_temp
as $$
declare
  g    geo.n5_generation;
  serv geo.n5_generation;
  n_m int; n_k int; n_s int; n_b int; n_p int; n_v int; n_a int;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id for update;
  if not found then
    raise exception 'discard: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if g.state not in ('FAILED','SUPERSEDED') then
    raise exception 'discard: generation % is %; only FAILED or SUPERSEDED generations can be discarded', p_generation_id, g.state
      using errcode = '22023';
  end if;
  select * into serv from geo.n5_generation where state in ('ACTIVE','ACTIVE_LEGACY');
  if serv.predecessor_generation_id = p_generation_id then
    raise exception 'discard: generation % is the predecessor of the serving generation % — it is the rollback target and the entry-evidence baseline',
      p_generation_id, serv.generation_id using errcode = '22023';
  end if;
  perform set_config('n5.discard_generation', p_generation_id, true);
  delete from geo.zip_authoritative_marker     where generation_id = p_generation_id; get diagnostics n_k = row_count;
  delete from geo.zip_authoritative_membership where generation_id = p_generation_id; get diagnostics n_m = row_count;
  delete from geo.maps_zip_geography_status    where generation_id = p_generation_id; get diagnostics n_s = row_count;
  delete from geo.n5_boundary_membership       where generation_id = p_generation_id; get diagnostics n_b = row_count;
  delete from geo.n5_generation_unresolved     where generation_id = p_generation_id;
  delete from geo.n5_gen_zcta                  where generation_id = p_generation_id;
  delete from geo.n5_gen_proven_point          where generation_id = p_generation_id; get diagnostics n_p = row_count;
  delete from geo.n5_gen_recovered_key         where generation_id = p_generation_id;
  delete from geo.n5_generation_key_verdict    where generation_id = p_generation_id; get diagnostics n_v = row_count;
  delete from geo.n5_association               where generation_id = p_generation_id; get diagnostics n_a = row_count;
  perform set_config('n5.discard_generation', '', true);
  update geo.n5_generation set superseded_from_state = null,
         note = coalesce(note || ' | ', '') || 'rows discarded ' || now()::text
   where generation_id = p_generation_id;
  return jsonb_build_object('generation_id', p_generation_id, 'membership', n_m, 'marker', n_k,
                            'status', n_s, 'boundary', n_b, 'proven_points', n_p,
                            'verdicts', n_v, 'associations', n_a);
end $$;
revoke all on function geo.n5_generation_discard(text) from public;

commit;


-- ############################################################################
-- D-B — NON-transactional. Run each statement on its own (never inside BEGIN).
-- ############################################################################
-- @@PART_DB
do $gate$
declare v text := current_setting('n5.verified_free_disk_mb', true);
begin
  -- ⛔ CAPACITY GATE (PART D-B).
  if v is null or v !~ '^[0-9]+$' or v::bigint < 2048 + 950 then
    raise exception 'CAPACITY GATE: n5.verified_free_disk_mb is %, need >= % (2,048 MB floor + 950 MB peak). Not applied.',
      coalesce(v, 'unset'), 2048 + 950;
  end if;
end $gate$;
create unique index concurrently if not exists n5_association_gen_pk
  on geo.n5_association (generation_id, source_key, zip);
-- reconcile / unresolved read membership by (generation, project); nothing served it
create index concurrently if not exists zip_authoritative_membership_gen_source
  on geo.zip_authoritative_membership (generation_id, source_key);


-- ############################################################################
-- D-C — the n5_association key swap. One transaction; catalog changes only.
-- ############################################################################
-- @@PART_DC
begin;
set local lock_timeout = '5s';
alter table geo.n5_association drop constraint n5_association_pkey;
alter table geo.n5_association add constraint n5_association_pkey
  primary key using index n5_association_gen_pk;
alter table geo.n5_association alter column generation_id drop default;
commit;

-- GENERATED from docs/n5-generation-publish-part-d.sql by slicing its D7 and D8 regions
-- verbatim - never hand-edited. Part E: the index-served candidate probe (2026-09-26).
--
-- Applies the revised D7 (candidate set read through the probing boundary's envelope) and
-- D8 (the publish function's probe calls it laterally) to a production that carries the
-- previous Part D. ONE transaction. Fail-closed on both sides:
--   before: the live publish body must be exactly the previous DDL of record
--           (md5(prosrc) dce3f74a16bd693867950736c3f3b626);
--   after:  it must be exactly the new DDL of record (8cefdf078aa8ab60322c541ef993ae5d), the
--           one-argument candidate function must be gone and the two-argument one present.
begin;
set local lock_timeout = '10s';
do $g$
declare m text;
begin
  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_gen_publish_prefix';
  if m is distinct from 'dce3f74a16bd693867950736c3f3b626' then
    raise exception 'part E: live n5_gen_publish_prefix is % - not the previous DDL of record; refusing', m;
  end if;
end $g$;

-- D7 (revised 2026-09-26): the candidate set is read THROUGH the probing boundary's own
--     envelope, p_env. That is the one narrowing the candidate-bounding rule admits (the GiST
--     prefilter from the boundary's envelope, scripts/n5_candidate_bounding.py) - it removes
--     nothing ST_Intersects(c.geom, boundary) would keep. Without it the planner cannot reach
--     either GiST index through the UNION: EXPLAIN on production 2026-09-26 showed a nested
--     loop comparing each boundary with all ~960k candidates (join filter, no GiST; estimated
--     cost 24.2M), and the envelope form uses n5_geom_gix + n5_gen_proven_point_gix. Whole
--     prefixes measured 11-63 s (median ~25 s) before this change; the first two, 95 s, were
--     cold-cache and are NOT representative - an early "~14 h" projection from them was wrong.
drop function if exists geo.n5_gen_candidate_geom(text);
create or replace function geo.n5_gen_candidate_geom(p_generation_id text, p_env geometry)
returns setof geo.n5_geom
language sql stable
as $$
  select g.*
    from geo.n5_geom g
    join geo.n5_gen_recovered_key rk
      on rk.generation_id = p_generation_id and rk.source_key = g.source_key
   where g.provenance = 'recovered_authoritative'
     and g.geom && p_env
  union all
  select pp.source_key, pp.registry_id, 'pt:1'::text, 1::smallint,
         pp.geom::geometry(Geometry, 4269), null::text, null::char(3),
         gen.publish_prepared_at, 'proven_stored_point'::text, gen.snapshot_id
    from geo.n5_gen_proven_point pp
    join geo.n5_generation gen on gen.generation_id = pp.generation_id
   where pp.generation_id = p_generation_id
     and pp.geom && p_env;
$$;
revoke all on function geo.n5_gen_candidate_geom(text, geometry) from public;

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
    join lateral geo.n5_gen_candidate_geom(p_generation_id, b.geom) c
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

do $g$
declare m text; n1 int; n2 int;
begin
  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_gen_publish_prefix';
  select count(*) filter (where p.oid::regprocedure::text = 'geo.n5_gen_candidate_geom(text)'),
         count(*) filter (where p.oid::regprocedure::text = 'geo.n5_gen_candidate_geom(text,geometry)')
    into n1, n2
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_gen_candidate_geom';
  if m is distinct from '8cefdf078aa8ab60322c541ef993ae5d' or n1 <> 0 or n2 <> 1 then
    raise exception 'part E post-condition failed: publish md5 %, one-arg %, two-arg %', m, n1, n2;
  end if;
end $g$;
commit;

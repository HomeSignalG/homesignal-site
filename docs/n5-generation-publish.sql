-- ============================================================================
-- N5 GENERATION PUBLICATION — the checked, generation-scoped path onto Map 1.
-- DDL OF RECORD. NOT APPLIED. Three parts, applied IN ORDER, each separately:
--
--   PART A  transactional, additive: new objects, new columns, rewritten lifecycle
--           functions, the DB write guard. Changes nothing Map 1 returns.
--   PART B  NON-transactional: CREATE UNIQUE INDEX CONCURRENTLY x4 and the NOT VALID ->
--           VALIDATE checks. Readers and the (non-existent) writers are never blocked.
--   PART C  transactional, short ACCESS EXCLUSIVE: swap the four primary keys onto the
--           generation-scoped indexes, set NOT NULL, and splice every serving reader onto
--           the serving views. With one generation present, every reader returns
--           byte-identical output before and after (proven in test/n5_generation_pg).
--
-- WHY THIS EXISTS (measured 2026-09-25, read-only):
--   * geo.zip_authoritative_membership / _marker / maps_zip_geography_status /
--     n5_boundary_membership were keyed WITHOUT generation, so two generations could not
--     coexist. The only writers (scripts/n5_boundary_first.py, n5_unit_a_shadow.py,
--     n5_a3_markers.py, manual phase2-b1-zcta.yml) delete-and-reinsert the SERVING rows
--     in place, prefix by prefix, with no generation awareness.
--   * public.app_zip_projects_markers never filtered on generation_id, and
--     geo.n5_generation_activate only swapped state rows — "ACTIVE" did not mean serving.
--   * geo.n5_reconcile_chunk counted a project RESOLVED only if its membership ZCTA fell
--     inside the chunk's own ZIP range, so correct geography across a prefix boundary
--     read as UNACCOUNTED.
--   * Nothing wrote geo.n5_generation_unresolved, so INV-1 could never pass for a real
--     generation.
--
-- THE MODEL AFTER THIS FILE:
--   candidate rows are written ONLY for a BUILDING generation (DB-enforced by trigger);
--   Map 1 reads ONLY the serving generation, through three views that resolve it once;
--   the serving generation is the ONE row in state ACTIVE / ACTIVE_LEGACY (already
--   unique by geo.n5_generation_one_serving). Activation and rollback flip that state in
--   one transaction: that COMMIT is the only serving switch. No row is copied at
--   activation; the previous generation's rows are never touched by it.
-- ============================================================================


-- ############################################################################
-- PART A — additive. One transaction.
-- ############################################################################
do $gate$
declare v text := current_setting('n5.verified_free_disk_mb', true);
begin
  -- ⛔ CAPACITY GATE (PART A). PRODUCTION MIGRATION/CUTOVER IS BLOCKED UNTIL VERIFIED DATABASE
  -- CAPACITY IS SUFFICIENT. The operator must state the PHYSICAL free disk, verified
  -- independently (the provider's disk metrics), in MB:  set n5.verified_free_disk_mb = '<n>';
  -- The 11,607 MB "total" hard-coded in the N5 scripts is NOT evidence and must not be used
  -- to derive it. Required: the 2,048 MB safety floor + ~950 MB for PART B's peak (≈450 MB of
  -- new unique indexes built beside the old keys, plus a similar volume of WAL).
  if v is null or v !~ '^[0-9]+$' or v::bigint < 2048 + 950 then
    raise exception 'CAPACITY GATE: n5.verified_free_disk_mb is %, need >= % (2,048 MB floor + 950 MB PART B peak). Not applied.',
      coalesce(v, 'unset'), 2048 + 950;
  end if;
end $gate$;

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- A1. Generation lineage. predecessor = the generation this one replaced when it FIRST
--     served; superseded_from_state = the serving state a generation held before it was
--     superseded, so rollback restores ACTIVE_LEGACY as ACTIVE_LEGACY (activation can
--     never produce that state, by the existing contract).
-- ---------------------------------------------------------------------------
alter table geo.n5_generation add column if not exists predecessor_generation_id text
  references geo.n5_generation(generation_id);
alter table geo.n5_generation add column if not exists superseded_from_state text
  check (superseded_from_state is null or superseded_from_state in ('ACTIVE','ACTIVE_LEGACY'));
alter table geo.n5_generation add column if not exists unresolved_recorded_at timestamptz;

-- ---------------------------------------------------------------------------
-- A2. Boundary membership becomes generation-scoped. The fast-default form is a CATALOG
--     change (PG 11+): the 907,297 existing rows are not rewritten; they READ as the
--     legacy generation that produced them. The default is dropped in PART C so no future
--     insert can silently inherit the legacy identity.
-- ---------------------------------------------------------------------------
alter table geo.n5_boundary_membership
  add column if not exists generation_id text not null default 'legacy-phase1-2026-09-01';

-- ---------------------------------------------------------------------------
-- A3. Per-prefix publication receipts and the candidate boundary scratch.
-- ---------------------------------------------------------------------------
create table if not exists geo.n5_generation_publish (
  generation_id   text not null references geo.n5_generation(generation_id) on delete cascade,
  z3              char(3) not null,
  run_id          text not null,
  zcta_loaded     integer not null,
  boundary_rows   integer not null,
  membership_rows integer not null,
  marker_rows     integer not null,
  status_rows     integer not null,
  completed_at    timestamptz not null default now(),
  primary key (generation_id, z3));
alter table geo.n5_generation_publish enable row level security;
revoke all on geo.n5_generation_publish from public;

create table if not exists geo.n5_gen_zcta (
  generation_id text not null references geo.n5_generation(generation_id) on delete cascade,
  prefix        char(3) not null,
  zcta5         char(5) not null,
  geom          geometry(MultiPolygon, 4269) not null,
  primary key (generation_id, prefix, zcta5));
create index if not exists n5_gen_zcta_gix on geo.n5_gen_zcta using gist (geom);
alter table geo.n5_gen_zcta enable row level security;
revoke all on geo.n5_gen_zcta from public;

-- ---------------------------------------------------------------------------
-- A4. THE SERVING GENERATION. One definition. Every Map 1 read resolves it through the
--     three views below, so no reader can combine two generations (INV-7, INV-14).
--     No row -> NULL -> every view is empty -> readers report 'unknown', never a mix.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_serving_generation_id()
returns text
language sql stable
set search_path = geo, pg_temp
as $$
  select g.generation_id from geo.n5_generation g
   where g.state in ('ACTIVE','ACTIVE_LEGACY');
$$;
revoke all on function geo.n5_serving_generation_id() from public;

-- The views INLINE the serving-generation subquery rather than call the function above.
-- A function called inside a view is permission-checked as the CALLING role (anon, via
-- public.app_zip_geography_state), while a relation inside a view is checked as the view
-- OWNER. Inlining keeps anon's existing access working without granting anon anything in
-- `geo`. The subquery and the function are the same predicate; test/n5_generation_pg
-- asserts they agree.
create or replace view geo.n5_serving_membership as
  select m.* from geo.zip_authoritative_membership m
   where m.generation_id = (select g.generation_id from geo.n5_generation g
                             where g.state in ('ACTIVE','ACTIVE_LEGACY'));
create or replace view geo.n5_serving_marker as
  select k.* from geo.zip_authoritative_marker k
   where k.generation_id = (select g.generation_id from geo.n5_generation g
                             where g.state in ('ACTIVE','ACTIVE_LEGACY'));
create or replace view geo.n5_serving_status as
  select s.* from geo.maps_zip_geography_status s
   where s.generation_id = (select g.generation_id from geo.n5_generation g
                             where g.state in ('ACTIVE','ACTIVE_LEGACY'));
revoke all on geo.n5_serving_membership, geo.n5_serving_marker, geo.n5_serving_status from public;

-- ---------------------------------------------------------------------------
-- A4b. THE PUBLICATION SCOPE of a generation: its shard prefixes AND every canonical ZIP
--      prefix. One definition, read by publish, unresolved accounting, the completeness
--      check and the orchestrator.
--      Shards alone are NOT enough, measured 2026-09-25: 40 canonical prefixes (445 ZIPs)
--      carry no expected project, and 442 of those ZIP pages serve a `boundary_complete`
--      measured zero today. A generation scoped to its shards would leave them with no
--      status row — Map 1 would regress them to 'unknown' on activation — and would never
--      probe their boundaries, so a project whose geometry lies there would be missed.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_generation_publish_scope(p_generation_id text)
returns table (z3 char(3))
language sql stable
set search_path = geo, public, pg_temp
as $$
  select s.z3::char(3) from geo.n5_shard s where s.generation_id = p_generation_id
  union
  select left(r.zip, 3)::char(3) from public.canonical_zip_registry r
   where exists (select 1 from geo.n5_generation g where g.generation_id = p_generation_id);
$$;
revoke all on function geo.n5_generation_publish_scope(text) from public;

-- ---------------------------------------------------------------------------
-- A5. THE WRITE GUARD. Rows of a generation are writable only while it is BUILDING, or
--     deletable by geo.n5_generation_discard for a FAILED / non-predecessor SUPERSEDED
--     generation. This is what makes INV-1 / INV-8 / INV-9 hold against EVERY writer,
--     including the retired phase-2 scripts: their delete-and-reinsert of a serving
--     prefix now raises and rolls back instead of blanking live ZIP pages.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_generation_row_guard()
returns trigger
language plpgsql
set search_path = geo, pg_temp
as $$
declare
  v_gen   text;
  v_state text;
begin
  v_gen := case when tg_op = 'DELETE' then old.generation_id else new.generation_id end;
  if tg_op = 'UPDATE' and old.generation_id is distinct from new.generation_id then
    raise exception 'N5 GUARD: % rows may not move between generations (% -> %)',
      tg_table_name, old.generation_id, new.generation_id using errcode = '23514';
  end if;
  -- FOR SHARE, not a plain read: READY/ACTIVATE take FOR UPDATE on this row, so a writer
  -- that saw BUILDING holds the row until it commits and READY cannot slip in between
  -- (proven by a two-connection test in test/n5_generation_pg).
  select g.state into v_state from geo.n5_generation g where g.generation_id = v_gen for share;
  if v_state is null then
    raise exception 'N5 GUARD: % row names unknown generation %', tg_table_name, v_gen
      using errcode = '23514';
  end if;
  if v_state = 'BUILDING' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE'
     and v_state in ('FAILED','SUPERSEDED')
     and coalesce(current_setting('n5.discard_generation', true), '') = v_gen then
    return old;
  end if;
  raise exception 'N5 GUARD: % of % row refused — generation % is %, not BUILDING',
    tg_op, tg_table_name, v_gen, v_state using errcode = '23514';
end $$;
revoke all on function geo.n5_generation_row_guard() from public;

drop trigger if exists n5_generation_row_guard on geo.zip_authoritative_membership;
create trigger n5_generation_row_guard before insert or update or delete
  on geo.zip_authoritative_membership for each row execute function geo.n5_generation_row_guard();
drop trigger if exists n5_generation_row_guard on geo.zip_authoritative_marker;
create trigger n5_generation_row_guard before insert or update or delete
  on geo.zip_authoritative_marker for each row execute function geo.n5_generation_row_guard();
drop trigger if exists n5_generation_row_guard on geo.maps_zip_geography_status;
create trigger n5_generation_row_guard before insert or update or delete
  on geo.maps_zip_geography_status for each row execute function geo.n5_generation_row_guard();
drop trigger if exists n5_generation_row_guard on geo.n5_boundary_membership;
create trigger n5_generation_row_guard before insert or update or delete
  on geo.n5_boundary_membership for each row execute function geo.n5_generation_row_guard();
-- the recorded unresolved outcomes are evidence too: frozen once the generation leaves BUILDING
drop trigger if exists n5_generation_row_guard on geo.n5_generation_unresolved;
create trigger n5_generation_row_guard before insert or update or delete
  on geo.n5_generation_unresolved for each row execute function geo.n5_generation_row_guard();

-- ---------------------------------------------------------------------------
-- A6. The atomic-completion invariant, now per generation. Same rule as before (a
--     boundary_complete ZIP's membership count equals its declared count equals its
--     boundary membership), evaluated inside the status row's OWN generation.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_assert_shadow_complete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare z char(5); g text; want int; got int; expect int;
begin
  if tg_op = 'DELETE' then return null; end if;
  z := new.zip; g := new.generation_id;
  select s.membership_rows into want from geo.maps_zip_geography_status s
   where s.generation_id = g and s.zip = z and s.status = 'boundary_complete';
  if want is null then return null; end if;
  select count(*) into got    from geo.zip_authoritative_membership m where m.generation_id = g and m.zcta5 = z;
  select count(*) into expect from geo.n5_boundary_membership b      where b.generation_id = g and b.zcta5 = z;
  if got <> want then
    raise exception 'UNIT A INVARIANT: generation % zip % is boundary_complete with % membership rows, declared %', g, z, got, want;
  end if;
  if want <> expect then
    raise exception 'UNIT A INVARIANT: generation % zip % declares % rows but boundary membership holds %', g, z, want, expect;
  end if;
  return null;
end $fn$;
revoke all on function geo.n5_assert_shadow_complete() from public;

-- ---------------------------------------------------------------------------
-- A7. INV-2: THE GENERATION'S CANDIDATE GEOMETRY. The ONLY narrowing beyond the spatial
--     prefilter and the eligibility allowlist is the generation's frozen expected set,
--     applied NATIONALLY (no zip / prefix predicate), so a project outside the snapshot
--     can never be resurrected by stale geometry, and cross-prefix under-inclusion — the
--     defect scripts/n5_candidate_bounding.py exists to prevent — cannot return.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_gen_candidate_geom(p_generation_id text)
returns setof geo.n5_geom
language sql stable
as $$
  select g.*
    from geo.n5_geom g
   where exists (
     select 1
       from geo.n5_generation gen
       join public.n5_expected_captured(gen.snapshot_id) e on true
      where gen.generation_id = p_generation_id
        and e.source_key = g.source_key);
$$;
revoke all on function geo.n5_gen_candidate_geom(text) from public;

-- ---------------------------------------------------------------------------
-- A8. PUBLISH ONE PREFIX OF A CANDIDATE — one call, one transaction: boundary resolution,
--     membership, markers, status, containment proof, scratch cleanup, receipt. Writes
--     ONLY rows of p_generation_id (the guard refuses anything else).
--
--     The three statements below are the SAME rules the retired scripts ran
--     (n5_boundary_first.PROBE_SQL, n5_unit_a_shadow.POPULATE, n5_a3_markers.BUILD), now
--     generation-scoped. They are the only implementation; the scripts refuse to run.
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

  -- (2) MEMBERSHIP, one deterministic representative point per (ZIP, project).
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
          from geo.n5_geom gg
         where gg.source_key = m.source_key
           and gg.outcome = 1 and gg.geom is not null
           and ST_Intersects(ST_MakeValid(gg.geom), b.geom)) f
    cross join lateral (select f.clip, f.nfeat, f.family,
                               case when f.clip is null then null else ST_Dimension(f.clip) end::smallint dim) x
    cross join lateral geo.n5_rep_point(x.clip) p
   where b.generation_id = p_generation_id and b.prefix = p_prefix;
  get diagnostics n_memb = row_count;

  -- (3) MARKERS — the chosen A3 rule, unchanged.
  insert into geo.zip_authoritative_marker
    (generation_id, zcta5, source_key, marker_seq, lat, lng, marker_rule, family, dim, run_id)
  with base as (
    select b.zcta5, m.source_key, x.family, x.clip
      from geo.n5_gen_zcta b
      join geo.zip_authoritative_membership m on m.generation_id = b.generation_id and m.zcta5 = b.zcta5
      cross join lateral (
          select ST_Intersection(ST_MakeValid(ST_Union(gg.geom)), b.geom) clip,
                 min(ST_GeometryType(gg.geom)) family
            from geo.n5_geom gg
           where gg.source_key = m.source_key and gg.outcome = 1 and gg.geom is not null
             and ST_Intersects(ST_MakeValid(gg.geom), b.geom)) x
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
-- A9. INV-4: EXPLICIT, EVIDENCE-BACKED UNRESOLVED OUTCOMES. Written only after every
--     prefix is published. Each class is read from a real pipeline artefact; an expected
--     key that matches none of them is deliberately NOT written, so it stays UNACCOUNTED
--     and blocks readiness. There is no catch-all.
--
--       NO_INTERSECTION_WITH_GENERATION_ZCTAS  usable geometry exists; it intersected no
--                                              canonical ZCTA in any of the generation's
--                                              published prefixes
--       POINT_REJECTED                         geo.n5_point_reject verdict (reason kept)
--       GEOMETRY_INVALID                       only quarantined geometry (outcome <> 1)
--       REGISTRY_NOAUTH / REGISTRY_IDENT_UNRESOLVED / REGISTRY_HIST_UNRECOVERABLE
--                                              the source catalogue's own verdict
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
                            and gg.outcome = 1 and gg.geom is not null)
               then 'NO_INTERSECTION_WITH_GENERATION_ZCTAS'
             when r.source_key is not null then 'POINT_REJECTED'
             when exists (select 1 from geo.n5_geom gg where gg.source_key = x.source_key)
               then 'GEOMETRY_INVALID'
             when a.treatment in ('NOAUTH','IDENT_UNRESOLVED','HIST_UNRECOVERABLE')
               then 'REGISTRY_' || a.treatment
           end as reason_code,
           jsonb_strip_nulls(jsonb_build_object(
             'prefixes_probed', n_pref,
             'reject_reason', r.reason, 'reject_verdict_snapshot_id', r.verdict_snapshot_id,
             'invalid_reasons', (select jsonb_agg(distinct gg.invalid_reason) from geo.n5_geom gg
                                  where gg.source_key = x.source_key and gg.outcome <> 1),
             'registry_id', x.registry_id, 'registry_treatment', a.treatment)) as detail
      from missing x
      left join geo.n5_point_reject r on r.source_key = x.source_key
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
-- A10. RECONCILIATION, corrected. Expected is still chunked by the SOURCE-STATED ZIP,
--      but RESOLVED is "has membership anywhere in this generation": correct geography
--      into a ZIP outside the stated prefix is resolution, not absence (INV-5).
-- ---------------------------------------------------------------------------
create or replace function geo.n5_reconcile_chunk(p_generation_id text, p_chunk_key text)
returns geo.n5_generation_reconcile
language plpgsql
set search_path to 'geo', 'public', 'pg_temp'
as $function$
declare
  g     geo.n5_generation;
  out   geo.n5_generation_reconcile;
  n_cap bigint;
  lo    text;
  hi    text;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id;
  if not found then
    raise exception 'n5_reconcile_chunk: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if p_chunk_key !~ '^[0-9]{1,5}$' then
    raise exception 'n5_reconcile_chunk: chunk_key must be a ZIP prefix, got %', p_chunk_key using errcode = '22023';
  end if;
  lo := rpad(p_chunk_key, 5, '0');
  hi := rpad(p_chunk_key, 5, '9');

  select count(*) into n_cap
    from preservation.app_project_identity i
   where i.snapshot_id = g.snapshot_id and i.record_kind = 'development';
  if n_cap = 0 then
    raise exception 'n5_reconcile_chunk: generation % has no captured expected set for snapshot % — refusing a vacuous chunk',
      p_generation_id, g.snapshot_id using errcode = '22023';
  end if;

  with expected as (
    select distinct e.source_key
      from public.n5_expected_captured(g.snapshot_id) e
     where e.zip >= lo and e.zip <= hi
  )
  insert into geo.n5_generation_reconcile as r
    (generation_id, chunk_key, expected_keys, accounted_resolved, accounted_unresolved, unaccounted, computed_at)
  select p_generation_id, p_chunk_key,
         (select count(*) from expected),
         (select count(*) from expected x where exists (
            select 1 from geo.zip_authoritative_membership m
             where m.generation_id = p_generation_id and m.record_kind = 'development'
               and m.source_key = x.source_key)),
         (select count(*) from expected x where exists (
            select 1 from geo.n5_generation_unresolved u
             where u.generation_id = p_generation_id and u.source_key = x.source_key)),
         (select count(*) from expected x
           where not exists (select 1 from geo.zip_authoritative_membership m
                              where m.generation_id = p_generation_id and m.record_kind = 'development'
                                and m.source_key = x.source_key)
             and not exists (select 1 from geo.n5_generation_unresolved u
                              where u.generation_id = p_generation_id and u.source_key = x.source_key)),
         now()
  on conflict (generation_id, chunk_key) do update
    set expected_keys        = excluded.expected_keys,
        accounted_resolved   = excluded.accounted_resolved,
        accounted_unresolved = excluded.accounted_unresolved,
        unaccounted          = excluded.unaccounted,
        computed_at          = excluded.computed_at
  returning * into out;
  return out;
end
$function$;

-- ---------------------------------------------------------------------------
-- A11. ONE DEFINITION OF "THIS CANDIDATE IS COMPLETE", used by READY and by ACTIVATE.
--      Returns only the failing checks; an empty result is the pass.
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
    -- while a slice of the expected set was never evaluated at all
    select 'expected_keys_outside_declared_chunks',
           (select count(*) from public.n5_expected_captured((select snapshot_id from g)) e
             where p_expected_chunks is null
                or not exists (select 1 from unnest(p_expected_chunks) c(k)
                                where e.zip >= rpad(c.k, 5, '0') and e.zip <= rpad(c.k, 5, '9'))))
  select c, n from checks where n > 0;
$$;
revoke all on function geo.n5_generation_publish_problems(text, text[]) from public;

-- ---------------------------------------------------------------------------
-- A12. BUILDING -> READY. Recomputes reconciliation itself; a stale reconcile row cannot
--      carry a generation to READY.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_generation_mark_ready(p_generation_id text, p_expected_chunks text[])
returns geo.n5_generation
language plpgsql
set search_path = geo, public, pg_temp
as $$
declare
  g        geo.n5_generation;
  prob     record;
  c        text;
  n_un     bigint;
  n_exp    bigint;
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
  foreach c in array p_expected_chunks loop
    perform geo.n5_reconcile_chunk(p_generation_id, c);
  end loop;
  select coalesce(sum(r.unaccounted), 0), coalesce(sum(r.expected_keys), 0) into n_un, n_exp
    from geo.n5_generation_reconcile r
   where r.generation_id = p_generation_id and r.chunk_key = any (p_expected_chunks);
  if n_un > 0 then
    raise exception 'ready: INV-1 violated — % of % expected source_keys have no accounted outcome', n_un, n_exp
      using errcode = '22023';
  end if;
  if n_exp = 0 then
    raise exception 'ready: reconciliation covered 0 expected records — refusing a vacuous pass' using errcode = '22023';
  end if;
  update geo.n5_generation set state = 'READY' where generation_id = p_generation_id returning * into g;
  return g;
end $$;
revoke all on function geo.n5_generation_mark_ready(text, text[]) from public;

-- ---------------------------------------------------------------------------
-- A13. ACTIVATION — THE SERVING SWITCH. The existing gate (READY, declared chunks,
--      reconciliation, integrity) is kept verbatim; the completeness checks are added;
--      and lineage is recorded. The COMMIT of this function is the instant Map 1 starts
--      reading the new generation: every serving view resolves the one ACTIVE row.
-- ---------------------------------------------------------------------------
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
  n_unaccount  bigint;
  n_expected   bigint;
  integ        record;
  prob         record;
  c_key        text;
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
  foreach c_key in array p_expected_chunks loop
    perform geo.n5_reconcile_chunk(p_generation_id, c_key);
  end loop;

  select coalesce(sum(r.unaccounted), 0), coalesce(sum(r.expected_keys), 0)
    into n_unaccount, n_expected
    from geo.n5_generation_reconcile r
   where r.generation_id = p_generation_id
     and r.chunk_key = any (p_expected_chunks);
  if n_unaccount > 0 then
    raise exception 'activate: INV-1 violated — % of % expected source_keys have no accounted outcome', n_unaccount, n_expected using errcode = '22023';
  end if;

  if n_expected = 0 then
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

-- ---------------------------------------------------------------------------
-- A14. ROLLBACK — restores a SUPERSEDED generation by state alone. Its rows were never
--      touched (the guard refuses writes to non-BUILDING generations), so nothing is
--      rebuilt or copied. Intactness is re-checked from the generation's own rows, which
--      works for the legacy build too (it has no publish receipts).
-- ---------------------------------------------------------------------------
create or replace function geo.n5_generation_rollback(p_to_generation_id text, p_reason text)
returns geo.n5_generation
language plpgsql
set search_path = geo, public, pg_temp
as $$
declare
  t      geo.n5_generation;
  cur    geo.n5_generation;
  n_stat bigint;
  n_decl bigint;
  n_memb bigint;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'rollback: a reason is required' using errcode = '22023';
  end if;
  select * into cur from geo.n5_generation where state in ('ACTIVE','ACTIVE_LEGACY') for update;
  if not found then
    raise exception 'rollback: no generation is serving' using errcode = '22023';
  end if;
  select * into t from geo.n5_generation where generation_id = p_to_generation_id for update;
  if not found then
    raise exception 'rollback: unknown generation %', p_to_generation_id using errcode = '22023';
  end if;
  if t.state <> 'SUPERSEDED' or t.superseded_from_state is null then
    raise exception 'rollback: generation % is % (served before: %) — only a previously serving, superseded generation can be restored',
      p_to_generation_id, t.state, coalesce(t.superseded_from_state, 'never') using errcode = '22023';
  end if;
  select count(*), coalesce(sum(membership_rows) filter (where status = 'boundary_complete'), 0)
    into n_stat, n_decl
    from geo.maps_zip_geography_status where generation_id = p_to_generation_id;
  select count(*) into n_memb from geo.zip_authoritative_membership where generation_id = p_to_generation_id;
  if n_stat = 0 or n_memb <> n_decl then
    raise exception 'rollback: generation % is not intact (status rows %, declared membership %, present %)',
      p_to_generation_id, n_stat, n_decl, n_memb using errcode = '22023';
  end if;

  update geo.n5_generation
     set superseded_from_state = state, state = 'SUPERSEDED', superseded_at = now(),
         note = coalesce(note || ' | ', '') || 'rolled back to ' || p_to_generation_id || ': ' || p_reason
   where generation_id = cur.generation_id;
  update geo.n5_generation
     set state = superseded_from_state, superseded_from_state = null, superseded_at = null
   where generation_id = p_to_generation_id
  returning * into t;
  return t;
end $$;
revoke all on function geo.n5_generation_rollback(text, text) from public;

-- ---------------------------------------------------------------------------
-- A15. FAIL and DISCARD. A failed candidate never served; discarding it frees storage and
--      touches no other generation. The serving generation and its predecessor (the
--      rollback target and the entry-evidence baseline) can never be discarded.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_generation_fail(p_generation_id text, p_reason text)
returns geo.n5_generation
language plpgsql
set search_path = geo, public, pg_temp
as $$
declare g geo.n5_generation;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id for update;
  if not found then
    raise exception 'fail: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if g.state not in ('BUILDING','VALIDATING','READY') then
    raise exception 'fail: generation % is %; only a candidate can fail', p_generation_id, g.state using errcode = '22023';
  end if;
  update geo.n5_generation
     set state = 'FAILED', note = coalesce(note || ' | ', '') || 'FAILED: ' || coalesce(p_reason, '(no reason)')
   where generation_id = p_generation_id returning * into g;
  return g;
end $$;
revoke all on function geo.n5_generation_fail(text, text) from public;

create or replace function geo.n5_generation_discard(p_generation_id text)
returns jsonb
language plpgsql
set search_path = geo, public, pg_temp
as $$
declare
  g    geo.n5_generation;
  serv geo.n5_generation;
  n_m int; n_k int; n_s int; n_b int;
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
  perform set_config('n5.discard_generation', '', true);
  update geo.n5_generation set superseded_from_state = null,
         note = coalesce(note || ' | ', '') || 'rows discarded ' || now()::text
   where generation_id = p_generation_id;
  return jsonb_build_object('generation_id', p_generation_id, 'membership', n_m, 'marker', n_k,
                            'status', n_s, 'boundary', n_b);
end $$;
revoke all on function geo.n5_generation_discard(text) from public;

-- ---------------------------------------------------------------------------
-- A16. INV-10: FIRST-VISIBILITY EVIDENCE, DERIVED — no ledger. A (ZIP, source_key) became
--      visible on HomeSignal in generation G iff it is in G's membership and not in
--      G.predecessor's. Both row sets are immutable once their generation leaves
--      BUILDING, so the answer is deterministic and a re-run cannot create false "new"
--      pairs. It is only answerable once G has actually served.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_generation_entries(p_generation_id text)
returns table (zcta5 char(5), source_key text)
language plpgsql stable
set search_path = geo, public, pg_temp
as $$
declare g geo.n5_generation;
begin
  select * into g from geo.n5_generation where generation_id = p_generation_id;
  if not found then
    raise exception 'entries: unknown generation %', p_generation_id using errcode = '22023';
  end if;
  if g.activated_at is null or g.state not in ('ACTIVE','SUPERSEDED') then
    raise exception 'entries: generation % has never served Map 1 (state %) — nothing became visible', p_generation_id, g.state
      using errcode = '22023';
  end if;
  if g.predecessor_generation_id is null then
    raise exception 'entries: generation % has no predecessor — it is a baseline, not a change', p_generation_id
      using errcode = '22023';
  end if;
  if not exists (select 1 from geo.maps_zip_geography_status s where s.generation_id = g.predecessor_generation_id) then
    raise exception 'entries: predecessor % of % has been discarded — entry evidence is no longer derivable',
      g.predecessor_generation_id, p_generation_id using errcode = '22023';
  end if;
  return query
    select m.zcta5, m.source_key from geo.zip_authoritative_membership m
     where m.generation_id = p_generation_id and m.record_kind = 'development'
    except
    select p.zcta5, p.source_key from geo.zip_authoritative_membership p
     where p.generation_id = g.predecessor_generation_id and p.record_kind = 'development';
end $$;
revoke all on function geo.n5_generation_entries(text) from public;

-- ---------------------------------------------------------------------------
-- A17. Status adds the publication counts, and the hint uses the one completeness check.
-- ---------------------------------------------------------------------------
create or replace function geo.n5_generation_status(p_generation_id text)
returns jsonb
language sql stable
set search_path to 'geo', 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'generation_id',        g.generation_id,
    'snapshot_id',          g.snapshot_id,
    'state',                g.state,
    'serving',              (g.generation_id = geo.n5_serving_generation_id()),
    'predecessor',          g.predecessor_generation_id,
    'source_cutoff',        g.cutoff,
    'freshness_lag_days',   round((extract(epoch from (now() - g.cutoff))/86400.0)::numeric, 2),
    'opened_at',            g.opened_at,
    'elapsed_seconds',      round(extract(epoch from (now() - g.opened_at))::numeric, 0),
    'snapshot_rows',        (select count(*) from preservation.app_project_identity i
                              where i.snapshot_id = g.snapshot_id and i.record_kind = 'development'),
    'shards_total',         (select count(*) from geo.n5_shard s where s.generation_id = g.generation_id),
    'shards_pending',       (select count(*) from geo.n5_shard s where s.generation_id = g.generation_id and s.state = 'pending'),
    'shards_running',       (select count(*) from geo.n5_shard s where s.generation_id = g.generation_id and s.state = 'running'),
    'shards_done',          (select count(*) from geo.n5_shard s where s.generation_id = g.generation_id and s.state = 'done'),
    'shards_failed',        (select count(*) from geo.n5_shard s where s.generation_id = g.generation_id and s.state not in ('pending','running','done')),
    'prefixes_published',   (select count(*) from geo.n5_generation_publish p where p.generation_id = g.generation_id),
    'unresolved_recorded_at', g.unresolved_recorded_at,
    'expected_keys',        (select coalesce(sum(r.expected_keys),0) from geo.n5_generation_reconcile r where r.generation_id = g.generation_id),
    'accounted_resolved',   (select coalesce(sum(r.accounted_resolved),0) from geo.n5_generation_reconcile r where r.generation_id = g.generation_id),
    'accounted_unresolved', (select coalesce(sum(r.accounted_unresolved),0) from geo.n5_generation_reconcile r where r.generation_id = g.generation_id),
    'unaccounted',          (select coalesce(sum(r.unaccounted),0) from geo.n5_generation_reconcile r where r.generation_id = g.generation_id),
    'reconcile_chunks',     (select count(*) from geo.n5_generation_reconcile r where r.generation_id = g.generation_id),
    'unresolved_recorded',  (select count(*) from geo.n5_generation_unresolved u where u.generation_id = g.generation_id),
    -- ⛔ NOT a promise. n5_generation_activate re-derives every condition itself.
    'activation_eligible_hint',
      (g.state = 'READY'
       and (select coalesce(sum(r.unaccounted),0) from geo.n5_generation_reconcile r where r.generation_id = g.generation_id) = 0
       and (select coalesce(sum(r.expected_keys),0) from geo.n5_generation_reconcile r where r.generation_id = g.generation_id) > 0)
  )
  from geo.n5_generation g
  where g.generation_id = p_generation_id;
$function$;

commit;


-- ############################################################################
-- PART B — NON-transactional. Run each statement on its own (never inside BEGIN).
-- CONCURRENTLY builds take SHARE UPDATE EXCLUSIVE: Map 1 reads continue throughout.
-- If any build fails it leaves an INVALID index: drop it and re-run that statement.
-- ############################################################################
-- @@PART_B
-- Session-level (Part B runs outside a transaction). CONCURRENTLY builds wait only for
-- SHARE UPDATE EXCLUSIVE; the three ADD CONSTRAINT ... NOT VALID take a brief ACCESS
-- EXCLUSIVE, which this bounds so a blocked statement cannot queue readers behind it.
do $gate$
declare v text := current_setting('n5.verified_free_disk_mb', true);
begin
  -- ⛔ CAPACITY GATE (PART B). PRODUCTION MIGRATION/CUTOVER IS BLOCKED UNTIL VERIFIED DATABASE
  -- CAPACITY IS SUFFICIENT. The operator must state the PHYSICAL free disk, verified
  -- independently (the provider's disk metrics), in MB:  set n5.verified_free_disk_mb = '<n>';
  -- The 11,607 MB "total" hard-coded in the N5 scripts is NOT evidence and must not be used
  -- to derive it. Required: the 2,048 MB safety floor + ~950 MB for PART B's peak (≈450 MB of
  -- new unique indexes built beside the old keys, plus a similar volume of WAL).
  if v is null or v !~ '^[0-9]+$' or v::bigint < 2048 + 950 then
    raise exception 'CAPACITY GATE: n5.verified_free_disk_mb is %, need >= % (2,048 MB floor + 950 MB PART B peak). Not applied.',
      coalesce(v, 'unset'), 2048 + 950;
  end if;
end $gate$;
set lock_timeout = '5s';
create unique index concurrently if not exists zip_authoritative_membership_gen_pk
  on geo.zip_authoritative_membership (generation_id, zcta5, source_key);
create unique index concurrently if not exists zip_authoritative_marker_gen_pk
  on geo.zip_authoritative_marker (generation_id, zcta5, source_key, marker_seq);
create unique index concurrently if not exists maps_zip_geography_status_gen_pk
  on geo.maps_zip_geography_status (generation_id, zip);
create unique index concurrently if not exists n5_boundary_membership_gen_pk
  on geo.n5_boundary_membership (generation_id, zcta5, source_key);
-- NOT NULL without a long ACCESS EXCLUSIVE scan: a VALIDATEd check lets SET NOT NULL skip it.
alter table geo.zip_authoritative_membership add constraint zam_generation_nn check (generation_id is not null) not valid;
alter table geo.zip_authoritative_membership validate constraint zam_generation_nn;
alter table geo.zip_authoritative_marker add constraint zak_generation_nn check (generation_id is not null) not valid;
alter table geo.zip_authoritative_marker validate constraint zak_generation_nn;
alter table geo.maps_zip_geography_status add constraint mzgs_generation_nn check (generation_id is not null) not valid;
alter table geo.maps_zip_geography_status validate constraint mzgs_generation_nn;


-- ############################################################################
-- PART C — the key swap and the serving splice. One transaction; each statement takes
-- ACCESS EXCLUSIVE only for a catalog change (no scan, no rewrite).
-- ############################################################################
-- @@PART_C
begin;
set local lock_timeout = '5s';

do $$
declare r record;
begin
  for r in select * from (values
      ('geo.zip_authoritative_membership'::regclass, 'zip_authoritative_membership_gen_pk'),
      ('geo.zip_authoritative_marker'::regclass,     'zip_authoritative_marker_gen_pk'),
      ('geo.maps_zip_geography_status'::regclass,    'maps_zip_geography_status_gen_pk'),
      ('geo.n5_boundary_membership'::regclass,       'n5_boundary_membership_gen_pk')) v(tbl, idx)
  loop
    if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                    where c.relname = r.idx and c.relnamespace = 'geo'::regnamespace
                      and i.indisvalid and i.indisready) then
      raise exception 'PART C: index geo.% is missing or INVALID — run PART B first', r.idx;
    end if;
  end loop;
end $$;

alter table geo.zip_authoritative_membership alter column generation_id set not null;
alter table geo.zip_authoritative_marker     alter column generation_id set not null;
alter table geo.maps_zip_geography_status    alter column generation_id set not null;
alter table geo.zip_authoritative_membership drop constraint zam_generation_nn;
alter table geo.zip_authoritative_marker     drop constraint zak_generation_nn;
alter table geo.maps_zip_geography_status    drop constraint mzgs_generation_nn;
alter table geo.n5_boundary_membership alter column generation_id drop default;

alter table geo.zip_authoritative_membership drop constraint zip_authoritative_membership_pkey,
  add constraint zip_authoritative_membership_pkey primary key using index zip_authoritative_membership_gen_pk;
alter table geo.zip_authoritative_marker drop constraint zip_authoritative_marker_pkey,
  add constraint zip_authoritative_marker_pkey primary key using index zip_authoritative_marker_gen_pk;
alter table geo.maps_zip_geography_status drop constraint maps_zip_geography_status_pkey,
  add constraint maps_zip_geography_status_pkey primary key using index maps_zip_geography_status_gen_pk;
alter table geo.n5_boundary_membership drop constraint n5_boundary_membership_pkey,
  add constraint n5_boundary_membership_pkey primary key using index n5_boundary_membership_gen_pk;

-- ---------------------------------------------------------------------------
-- C2. THE SERVING SPLICE. Every reader of the three serving tables is rewritten, from
--     its LIVE definition, onto the serving views — computed in the database, never
--     transcribed (CLAUDE.md claims rule 7). Fail-closed: each named object must exist,
--     must contain a reference, and must contain NONE afterwards. The list is the set
--     measured 2026-09-25 by prosrc / pg_views scan; a reader added later that is not in
--     it is caught by the final sweep, which raises.
--     Excluded ON PURPOSE: the lifecycle functions above, which address a generation by
--     id, and the serving views themselves.
-- ---------------------------------------------------------------------------
do $$
declare
  fns text[] := array[
    'public.app_zip_projects_markers(text,text,boolean)',
    'public.app_authoritative_projects_for_zip(text)',
    'public.app_projects_for_zip(text,text)',
    'geo.refresh_maps_zip_export()',
    'geo.n5_shadow_projects_for_zip(text,text)',
    'geo.n5_a3_projects_one_pass(text)',
    'geo.n5_a3_bench_one(text,integer,text)',
    'geo.n5_authoritative_test_for_zip(text)'];
  vws text[] := array['public.app_zip_geography_state', 'public.dc_resident_lineage_ledger'];
  f text; v text; def text; newdef text; n_left int; opts text[];
  pat constant text := '(geo\.)?(zip_authoritative_membership|zip_authoritative_marker|maps_zip_geography_status)\M';
begin
  foreach f in array fns loop
    def := pg_get_functiondef(f::regprocedure);
    if def !~ pat then
      raise exception 'SPLICE: % holds no serving-table reference — the reader list is stale', f;
    end if;
    newdef := regexp_replace(def,    '\m(geo\.)?zip_authoritative_membership\M', 'geo.n5_serving_membership', 'g');
    newdef := regexp_replace(newdef, '\m(geo\.)?zip_authoritative_marker\M',     'geo.n5_serving_marker',     'g');
    newdef := regexp_replace(newdef, '\m(geo\.)?maps_zip_geography_status\M',    'geo.n5_serving_status',     'g');
    execute newdef;
    if pg_get_functiondef(f::regprocedure) ~ pat then
      raise exception 'SPLICE: % still references a base serving table after the splice', f;
    end if;
  end loop;
  foreach v in array vws loop
    def := pg_get_viewdef(v::regclass, false);
    if def !~ pat then
      raise exception 'SPLICE: view % holds no serving-table reference — the reader list is stale', v;
    end if;
    newdef := regexp_replace(def,    '\m(geo\.)?zip_authoritative_membership\M', 'geo.n5_serving_membership', 'g');
    newdef := regexp_replace(newdef, '\m(geo\.)?zip_authoritative_marker\M',     'geo.n5_serving_marker',     'g');
    newdef := regexp_replace(newdef, '\m(geo\.)?maps_zip_geography_status\M',    'geo.n5_serving_status',     'g');
    -- CREATE OR REPLACE VIEW REPLACES the view's options with the ones it names, so a
    -- bare replace would silently drop security_invoker=true from
    -- dc_resident_lineage_ledger. Carry the live options through, verbatim.
    select c.reloptions into opts from pg_class c where c.oid = v::regclass;
    if opts is null then
      execute format('create or replace view %s as %s', v, newdef);
    else
      execute format('create or replace view %s with (%s) as %s', v, array_to_string(opts, ', '), newdef);
    end if;
    if (select c.reloptions from pg_class c where c.oid = v::regclass) is distinct from opts then
      raise exception 'SPLICE: view % lost its options (% -> %)', v, opts,
        (select c.reloptions from pg_class c where c.oid = v::regclass);
    end if;
    if pg_get_viewdef(v::regclass, false) ~ pat then
      raise exception 'SPLICE: view % still references a base serving table after the splice', v;
    end if;
  end loop;

  -- C3. ONE AUTHORITY: public.app_zip_geography_cutover STOPS BEING A SERVING SWITCH.
  --     It was the per-ZIP rollout flag of the legacy build. app_projects_for_zip (the ZIP
  --     page, development.html, property.html, properties.html) served Development only
  --     where it was enabled, while Map 1 (app_zip_projects_markers) never consulted it —
  --     so the two surfaces could disagree, and flipping one row changed resident-facing
  --     Development without any generation changing. Measured 2026-09-25 the switch is
  --     already redundant: enabled-and-verified = 12,013 ZIPs = exactly the 12,013
  --     boundary_complete ZIPs of the serving generation (0 either way; the 64 disabled rows
  --     are all not boundary_complete). So deriving it changes no output today, and after
  --     this the serving generation alone decides. The table is RETAINED, unread by any
  --     serving path, as the historical record of the legacy rollout.
  def := pg_get_functiondef('public.app_projects_for_zip(text,text)'::regprocedure);
  if (select count(*) from regexp_matches(def,
        'if exists \(select 1 from public\.app_zip_geography_cutover c\s+where c\.zip = p_zip and c\.enabled\) then\s+return public\.app_authoritative_projects_for_zip\(p_zip\);\s+end if;\s+return jsonb_build_object\(\s+''unavailable'', true,\s+''zip_geography_status'', ''boundary_complete_not_cut_over'',\s+''projects'', null\);', 'g')) <> 1 then
    raise exception 'C3: the app_projects_for_zip cutover gate does not appear exactly once — definition drifted';
  end if;
  newdef := regexp_replace(def,
        'if exists \(select 1 from public\.app_zip_geography_cutover c\s+where c\.zip = p_zip and c\.enabled\) then\s+return public\.app_authoritative_projects_for_zip\(p_zip\);\s+end if;\s+return jsonb_build_object\(\s+''unavailable'', true,\s+''zip_geography_status'', ''boundary_complete_not_cut_over'',\s+''projects'', null\);',
        '-- the serving N5 generation is the only authority (docs/n5-generation-publish.sql C3)
    return public.app_authoritative_projects_for_zip(p_zip);');
  execute newdef;

  create or replace view public.app_zip_geography_state as
   select r.zip,
          case when s.status = 'boundary_complete' then 'authoritative'::text
               when s.status = 'not_measured'      then 'not_measured'::text
               else 'pending'::text
          end as geography_state
     from public.canonical_zip_registry r
     left join geo.n5_serving_status s on s.zip::text = r.zip;

  -- No Development SERVING reader may consult the retired switch. refresh_maps_zip_export
  -- is excluded by name: it writes a diagnostic export that nothing reads (measured: no
  -- function, view or site file reads geo.maps_zip_export) and serves no resident.
  select count(*) into n_left from (
    select p.oid from pg_proc p
     where p.prosrc ~* 'app_zip_geography_cutover' and p.proname <> 'refresh_maps_zip_export'
    union all
    select c.oid from pg_class c join pg_rewrite rw on rw.ev_class = c.oid
     where c.relkind = 'v' and pg_get_viewdef(c.oid) ~* 'app_zip_geography_cutover') x;
  if n_left > 0 then
    raise exception 'C3: % Development reader(s) still consult app_zip_geography_cutover', n_left;
  end if;

  -- FINAL SWEEP: no function or view outside the generation-addressed lifecycle may read a
  -- serving base table directly. A reader nobody listed is a way to combine generations.
  -- EVERY non-system schema, not only public and geo.
  select count(*) into n_left from (
    select p.oid::regprocedure::text o
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg\_%'
       and p.prosrc ~ pat
       and p.proname not in ('n5_serving_generation_id','n5_generation_row_guard','n5_assert_shadow_complete',
                             'n5_gen_publish_prefix','n5_gen_record_unresolved','n5_reconcile_chunk',
                             'n5_generation_publish_problems','n5_generation_mark_ready','n5_generation_activate',
                             'n5_generation_rollback','n5_generation_fail','n5_generation_discard',
                             'n5_generation_entries','n5_generation_status','n5_generation_publish_scope')
    union all
    select schemaname || '.' || viewname
      from pg_views
     where schemaname not in ('pg_catalog','information_schema')
       and definition ~ pat
       and viewname not in ('n5_serving_membership','n5_serving_marker','n5_serving_status')) x;
  if n_left > 0 then
    raise exception 'SPLICE: % unlisted reader(s) still read a serving base table directly', n_left;
  end if;
end $$;

commit;

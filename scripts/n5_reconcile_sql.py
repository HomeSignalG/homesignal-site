#!/usr/bin/env python3
"""THE PERMANENT SOURCE-KEY-SCOPED RECONCILIATION SQL, in ONE place.

Phase 5 of the national geography pipeline. Every statement here is bounded by a
PROCESSED SOURCE KEY SET and by nothing else: no ZIP3 predicate, no prefix, no
unbounded national scan. A key the caller did not name is never read for mutation
and can never be written or deleted.

WHY THE RELATION NAMES ARE PARAMETERS. The behavioural proof for this file cannot
run in the build sandbox (no egress to Supabase), and a proof that runs against a
PARAPHRASE of the shipped SQL proves nothing about the shipped SQL. So every
relation is a named placeholder with a production default, and the fixture harness
substitutes TEMP relations into the SAME string. There is exactly one
implementation; the tests and production differ only in which tables it points at.

------------------------------------------------------------------ THE FOUR STAGES

    stage 1  GEOMETRY    geo.n5_geom                      <- incoming fetched features
    stage 2  BOUNDARY    geo.n5_boundary_membership       <- n5_geom x canonical ZCTA
    stage 3  MEMBERSHIP  geo.zip_authoritative_membership <- one rep point per (ZIP,key)
    stage 4  MARKERS     geo.zip_authoritative_marker     <- per-component markers

Each stage is `expected` vs `current`, both computed for the SAME bounded key set:
expected-only -> INSERT, both-but-changed -> UPDATE, current-only -> DELETE,
unchanged -> NO WRITE. The last clause is not an optimisation: a no-op write would
advance `recovered_at` / `computed_at` and destroy the vintage those columns exist
to record.

------------------------------------------------- STAGE 1 AND WHY IT IS SET-WISE

`geo.n5_geom` HAS NO PER-FEATURE IDENTITY, and that is measured, not assumed
(production, 2026-09-19):

    provenance                rows      keys      distinct feature_id
    proven_stored_point    718,278   718,278      1   (the literal 'pt:1')
    recovered_authoritative 491,469   160,182      491,465

    RECOVERY keys whose features share ONE feature_id prefix : 160,182 of 160,182
    RECOVERY keys with >1 feature                            :  54,904
      ... of those, keys whose features are ALL ONE geometry :  49,615
    heaviest key                                             : 191 features

So a RECOVERY feature_id is `<the identity we asked for>#<index within THAT key's
features, ordered by the geometry itself>` (n5_shard.py:437-443). The prefix is
constant within a key, so it discriminates nothing; the index is POSITIONAL and is
derived by sorting the WHOLE fetched set. Drop one feature that sorts first and
every remaining feature's id shifts by one. `(source_key, feature_id)` is therefore
a stable identity for a ROW but NOT for a FEATURE across refetches.

PROVEN is the opposite and equally simple: one row per key at the constant 'pt:1'.

THE SMALLEST CORRECT IDENTITY RULE IS THEREFORE THE KEY, NOT THE FEATURE. Stage 1
compares the two feature SETS by fingerprint and, when they differ, replaces the
key's whole set. The brief permits this explicitly, and the measurement is why it
is not merely permitted but forced: there is no per-feature UPDATE to write,
because there is no per-feature identity to write it against.

FINGERPRINT COLLATION IS PINNED (`collate "C"`). Postgres `order by` uses the
database collation and Python's `sorted()` uses codepoint order; under en_US.UTF-8
the same set can order differently on the two sides and the fingerprints then
disagree on IDENTICAL data. A false drift alarm is how a real one gets ignored.

------------------------------------------------------------ WHAT IS NOT IN HERE

No scheduler. No backfill. No orphan cleanup. No registry activation. These are
statements; nothing in this module runs them.
"""

# Production relation names. The fixture harness overrides every one of these.
PROD_RELS = {
    "GEOM":       "geo.n5_geom",
    "INCOMING":   "geo.n5_geom_incoming",
    "BOUND":      "geo.n5_boundary_membership",
    "MEMB":       "geo.zip_authoritative_membership",
    "MARK":       "geo.zip_authoritative_marker",
    "ZCTA":       "geo.zcta_boundary",
    "REGISTRY":   "public.canonical_zip_registry",
    "QUEUE":      "geo.n5_reconcile_queue",
}

# The one fingerprint expression, defined once so the two sides cannot drift apart.
# `collate "C"` is not optional - see the module docstring.
_FP = ("md5(coalesce(string_agg("
       "f.feature_id || '|' || f.outcome::text || '|' || "
       "coalesce(encode(ST_AsBinary(f.geom),'hex'),'') || '|' || coalesce(f.invalid_reason,''), "
       "E'\\n' order by f.feature_id collate \"C\"), ''))")


def geom_fingerprint(rel, alias="f"):
    """Set fingerprint for one key's features in `rel`, as a scalar subquery body."""
    return _FP.replace("f.", alias + ".").replace('f.feature_id collate',
                                                  alias + '.feature_id collate')


# --------------------------------------------------------------- STAGE 1: GEOMETRY
#
# Bounded by :keys. `changed` is the set of named keys whose INCOMING feature set
# differs from the STORED one; only those keys are touched, so a key whose publisher
# returned byte-identical features keeps its first-acquisition `recovered_at`.
#
# A key present in :keys but ABSENT from INCOMING is NOT treated as deleted here.
# Source disappearance is a retention decision the application already owns (the
# app_projects stale sweep); inventing a second definition of "deleted" inside the
# geometry layer would make two answers to one question. Stage 1 acts only on keys
# the fetch actually returned, and `absent_from_incoming` is reported, not enacted.
# ⚠️ STAGE 1 IS TWO STATEMENTS, AND THAT IS FORCED BY POSTGRES, NOT A STYLE CHOICE.
# The first version was ONE statement with the DELETE as a data-modifying CTE. Every
# data-modifying CTE in a statement sees the SAME snapshot, so the INSERT's unique
# check still saw the rows the DELETE had just removed:
#
#   ERROR: 23505 duplicate key value violates unique constraint "t_geom_pkey"
#   DETAIL: Key (source_key, feature_id)=(K, k#0) already exists.
#
# That is unavoidable here because whole-set replacement REUSES feature ids - it is
# the normal case, not an edge case. The two statements run in one implicit
# transaction (simple-query protocol) or one plpgsql function body, so atomicity is
# unchanged; what changes is that the INSERT now runs after the DELETE is visible.
#
# `changed` is RECOMPUTED in the second statement rather than carried in a temp: after
# the delete a changed key's stored fingerprint is md5('') and its incoming one is not,
# so it still qualifies; an unchanged key still matches and is still skipped. The
# recomputation cannot disagree with the first because both read the same expression.
#
# Bounded by :keys throughout. A key present in :keys but ABSENT from INCOMING is NOT
# treated as deleted: source disappearance is a retention decision the application
# already owns (the app_projects stale sweep), and a second definition of "deleted"
# inside the geometry layer is how one question gets two answers.
_STAGE1_CHANGED = """
with named as (select unnest({KEYS}::text[]) source_key),
fetched as (select distinct source_key from {INCOMING}
             where source_key in (select source_key from named)),
fp_new as (
  select n.source_key,
         (select {FP_NEW} from {INCOMING} f where f.source_key = n.source_key) fp
    from fetched n),
fp_old as (
  select n.source_key,
         (select {FP_OLD} from {GEOM} f where f.source_key = n.source_key) fp
    from fetched n),
changed as (
  select a.source_key from fp_new a join fp_old b using (source_key)
   where a.fp is distinct from b.fp)
"""

STAGE1_GEOMETRY = _STAGE1_CHANGED + """
delete from {GEOM} g where g.source_key in (select source_key from changed);
""" + _STAGE1_CHANGED + """
insert into {GEOM} (source_key, registry_id, feature_id, outcome, geom, invalid_reason,
                    first_z3, provenance, verdict_snapshot_id)
select i.source_key, i.registry_id, i.feature_id, i.outcome, i.geom, i.invalid_reason,
       i.first_z3, i.provenance, i.verdict_snapshot_id
  from {INCOMING} i
 where i.source_key in (select source_key from changed);
"""

# --------------------------------------------------------------- STAGE 2: BOUNDARY
#
# The FIRST stage whose expected set is derived rather than fetched, and the one the
# append-only `on conflict do nothing` probe could never do: it DELETES a membership
# a key no longer earns. Bounded by :keys; a ZCTA row belonging to any other key is
# unreachable from this statement.
#
# `provenance` rides from the geometry rather than being re-derived, so the two
# planes cannot disagree about what kind of evidence placed a key on a ZIP.
STAGE2_BOUNDARY = """
with named as (select unnest({KEYS}::text[]) source_key),
expected as (
  select distinct b.zcta5, g.source_key, g.provenance
    from named n
    join {GEOM} g on g.source_key = n.source_key and g.outcome = 1 and g.geom is not null
    join {ZCTA} b on ST_Intersects(ST_MakeValid(g.geom), b.geom)
   where b.zcta5 in (select zip from {REGISTRY})),
del as (
  delete from {BOUND} m
   where m.source_key in (select source_key from named)
     and not exists (select 1 from expected e
                      where e.zcta5 = m.zcta5 and e.source_key = m.source_key)
  returning 1)
insert into {BOUND} (zcta5, source_key, provenance, run_id)
select e.zcta5, e.source_key, e.provenance, {RUN} from expected e
on conflict (zcta5, source_key) do update
   set provenance = excluded.provenance, run_id = excluded.run_id
 where {BOUND}.provenance is distinct from excluded.provenance;
"""

# ------------------------------------------------------------- STAGE 3: MEMBERSHIP
#
# The resident-facing plane. Expected is computed from the geometry directly, NOT by
# reading {BOUND} - a key acquired for the first time has no {BOUND} row yet, and
# scoping stage 3 off {BOUND} is precisely the discovery blind spot Phase 5 exists to
# close. Stage 2 and stage 3 read the same geometry and therefore cannot disagree;
# stage 3 does not depend on stage 2 having run.
STAGE3_MEMBERSHIP = """
with named as (select unnest({KEYS}::text[]) source_key),
pairs as (
  select distinct b.zcta5, g.source_key
    from named n
    join {GEOM} g on g.source_key = n.source_key and g.outcome = 1 and g.geom is not null
    join {ZCTA} b on ST_Intersects(ST_MakeValid(g.geom), b.geom)
   where b.zcta5 in (select zip from {REGISTRY})),
expected as (
  select pr.zcta5, pr.source_key,
         case when p2.pt is null then null else ST_Y(p2.pt) end lat,
         case when p2.pt is null then null else ST_X(p2.pt) end lng,
         p2.rule point_rule, x2.dim clip_dim, x2.nfeat feature_count, x2.family geom_family
    from pairs pr
    join {ZCTA} b2 on b2.zcta5 = pr.zcta5
    cross join lateral (
        select ST_Intersection(ST_MakeValid(ST_Union(g2.geom)), b2.geom) clip,
               count(*)::int nfeat, min(ST_GeometryType(g2.geom)) family
          from {GEOM} g2
         where g2.source_key = pr.source_key and g2.outcome = 1 and g2.geom is not null
           and ST_Intersects(ST_MakeValid(g2.geom), b2.geom)) f2
    cross join lateral (select f2.clip, f2.nfeat, f2.family,
                        case when f2.clip is null then null else ST_Dimension(f2.clip) end::smallint dim) x2
    cross join lateral geo.n5_rep_point(x2.clip) p2),
del as (
  delete from {MEMB} m
   where m.source_key in (select source_key from named)
     and not exists (select 1 from expected e
                      where e.zcta5 = m.zcta5 and e.source_key = m.source_key)
  returning 1)
insert into {MEMB} (zcta5, source_key, lat, lng, point_rule, clip_dim, feature_count, geom_family, run_id)
select e.zcta5, e.source_key, e.lat, e.lng, e.point_rule, e.clip_dim, e.feature_count, e.geom_family, {RUN}
  from expected e
on conflict (zcta5, source_key) do update
   set lat = excluded.lat, lng = excluded.lng, point_rule = excluded.point_rule,
       clip_dim = excluded.clip_dim, feature_count = excluded.feature_count,
       geom_family = excluded.geom_family, run_id = excluded.run_id
 where {MEMB}.lat is distinct from excluded.lat
    or {MEMB}.lng is distinct from excluded.lng
    or {MEMB}.point_rule is distinct from excluded.point_rule
    or {MEMB}.clip_dim is distinct from excluded.clip_dim
    or {MEMB}.feature_count is distinct from excluded.feature_count
    or {MEMB}.geom_family is distinct from excluded.geom_family;
"""

# ---------------------------------------------------------------- STAGE 4: MARKERS
#
# Same bound, same derivation-from-geometry as stage 3, for the same reason: a marker
# plane scoped off the membership plane inherits the membership plane's blind spots.
# Deriving both from {GEOM} makes them agree by construction rather than by ordering.
#
# The sliver floors and the interval spacing are the SHIPPED rule parameters, injected
# by the caller so this file cannot hold a second copy of them.
STAGE4_MARKERS = """
with named as (select unnest({KEYS}::text[]) source_key),
pairs as (
  select distinct b.zcta5, g.source_key
    from named n
    join {GEOM} g on g.source_key = n.source_key and g.outcome = 1 and g.geom is not null
    join {ZCTA} b on ST_Intersects(ST_MakeValid(g.geom), b.geom)
   where b.zcta5 in (select zip from {REGISTRY})),
base as (
  select pr.zcta5, pr.source_key, x.family, x.clip
    from pairs pr
    join {ZCTA} b on b.zcta5 = pr.zcta5
    cross join lateral (
        select ST_Intersection(ST_MakeValid(ST_Union(g.geom)), b.geom) clip,
               min(ST_GeometryType(g.geom)) family
          from {GEOM} g
         where g.source_key = pr.source_key and g.outcome = 1 and g.geom is not null
           and ST_Intersects(ST_MakeValid(g.geom), b.geom)) x),
comp as (
  select z.zcta5, z.source_key, z.family, 1 as dim, d.geom g,
         ST_Length(d.geom::geography) measure
    from base z
    cross join lateral ST_Dump(ST_LineMerge(ST_CollectionExtract(z.clip, 2))) d
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
          or (c.dim = 1 and (c.measure >= {MIN_LINE_M}
                             or c.measure = max(case when c.dim=1 then c.measure end)
                                              over (partition by c.zcta5, c.source_key)))
          or (c.dim = 2 and (c.measure >= {MIN_AREA_M2}
                             or c.measure = max(case when c.dim=2 then c.measure end)
                                              over (partition by c.zcta5, c.source_key)))) as keep_it
    from comp c),
placed as (
  select k.zcta5, k.source_key, k.family, k.dim, k.measure, k.g, gs.i,
         greatest(1, ceil(k.measure / {D_M})::int) as n_on_comp
    from keep k
    cross join lateral generate_series(
        0, case when k.dim = 1 then greatest(1, ceil(k.measure / {D_M})::int) - 1 else 0 end) gs(i)
   where k.keep_it),
pt as (
  select p.*,
         case when p.dim = 1 then ST_LineInterpolatePoint(p.g, (p.i + 0.5) / p.n_on_comp::float8)
              when p.dim = 2 then ST_PointOnSurface(p.g)
              else p.g end as mp
    from placed p),
expected as (
  select zcta5, source_key,
         row_number() over (partition by zcta5, source_key
                            order by dim desc, measure desc, ST_AsBinary(g) asc, i asc)::int marker_seq,
         ST_Y(mp) lat, ST_X(mp) lng,
         case when dim = 1 then 'LINE_MERGED_COMPONENT_INTERVAL_{DTAG}M'
              when dim = 2 then 'POLYGON_COMPONENT_POINT_ON_SURFACE'
              else 'POINT_AUTHORITATIVE' end marker_rule,
         family, dim::smallint dim
    from pt),
del as (
  delete from {MARK} kk
   where kk.source_key in (select source_key from named)
     and not exists (select 1 from expected e
                      where e.zcta5 = kk.zcta5 and e.source_key = kk.source_key
                        and e.marker_seq = kk.marker_seq)
  returning 1)
insert into {MARK} (zcta5, source_key, marker_seq, lat, lng, marker_rule, family, dim, run_id)
select e.zcta5, e.source_key, e.marker_seq, e.lat, e.lng, e.marker_rule, e.family, e.dim, {RUN}
  from expected e
on conflict (zcta5, source_key, marker_seq) do update
   set lat = excluded.lat, lng = excluded.lng, marker_rule = excluded.marker_rule,
       family = excluded.family, dim = excluded.dim, run_id = excluded.run_id
 where {MARK}.lat is distinct from excluded.lat
    or {MARK}.lng is distinct from excluded.lng
    or {MARK}.marker_rule is distinct from excluded.marker_rule
    or {MARK}.family is distinct from excluded.family
    or {MARK}.dim is distinct from excluded.dim;
"""

STAGES = (
    ("geometry",   STAGE1_GEOMETRY),
    ("boundary",   STAGE2_BOUNDARY),
    ("membership", STAGE3_MEMBERSHIP),
    ("markers",    STAGE4_MARKERS),
)


def render(stage_sql, keys_literal, run_literal, rels=None, rule_params=None):
    """Substitute relation names, the bounded key set, and the rule parameters.

    `keys_literal` is a SQL text[] literal naming EVERY key this call may touch. It
    appears in every stage as the sole bound, so a caller cannot widen the blast
    radius by editing one stage.
    """
    r = dict(PROD_RELS)
    r.update(rels or {})
    out = stage_sql
    for k, v in r.items():
        out = out.replace("{" + k + "}", v)
    out = out.replace("{FP_NEW}", geom_fingerprint(r["INCOMING"]))
    out = out.replace("{FP_OLD}", geom_fingerprint(r["GEOM"]))
    for k, v in (rule_params or {}).items():
        out = out.replace("{" + k + "}", str(v))
    out = out.replace("{KEYS}", keys_literal).replace("{RUN}", run_literal)
    return out


def unresolved_placeholders(text):
    """Every `{NAME}` left in a rendered statement. A rendered stage must have none.

    A placeholder that survives rendering is not a cosmetic defect: `{MEMB}` left in
    a DELETE names no relation and the statement fails, while `{MIN_LINE_M}` left in
    a comparison would fail too - but only on the day that branch is reached.
    """
    import re
    return sorted(set(re.findall(r"\{[A-Z_]+\}", text)))

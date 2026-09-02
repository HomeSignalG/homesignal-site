#!/usr/bin/env python3
"""N5 - bounded national project->ZIP association build, executed ZIP3 shard by shard.

Freeze basis is preservation.app_project_identity @ phase1-2026-09-01, record_kind
'development'. That table reproduces the accepted national baseline EXACTLY - 234
sources / 925,463 projects / 2,753,802 pairs, and 234 of 234 sources match the accepted
per-source counts with 0 differing. It is an immutable single-transaction capture, so
re-derivation is exact and chunked derivation is safe. Live public.app_projects is NOT
the baseline; it has drifted (+7,040 projects / +12,923 pairs at 2026-09-02 17:30Z) and
that drift is deliberately out of this build.

Per shard: freeze -> boundaries -> recover -> associate -> verify -> discard -> disk.
Advance only if the shard VERIFIED CLEAN **and** free disk is above the floor. Both,
and-not-or: a clean shard can still walk the disk down, and a disk-comfortable shard
carrying phantoms gets built on by hundreds more before anyone notices.
"""
import hashlib
import io
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import (  # noqa: E402  - one implementation, imported not re-derived
    sql, http, esri, lit, read_dbf, read_shp_polygons, rings_to_multipolygon_wkt,
    paths_to_multilinestring_wkt, rings_to_wkt, PROJECT_REF, TIGER_URL, TIGER_SHA256,
    CANON_SRID, UA, STATS,
)

SNAPSHOT = os.environ.get("SNAPSHOT", "phase1-2026-09-01").strip()
Z3_ENV = os.environ.get("Z3", "AUTO").strip()
MAX_SHARDS = int(os.environ.get("MAX_SHARDS", "1"))
DISK_FLOOR_MB = float(os.environ.get("DISK_FLOOR_MB", "2048"))
# Same basis as the N3/N4 receipts so the floor means the same thing across phases.
DISK_TOTAL_MB = float(os.environ.get("DISK_TOTAL_MB", "11607"))
REG_PATH = "supabase/functions/get-address-report/jurisdiction-registry.json"

# Carried-forward gates. These are decisions, not TODOs - see the N5 authorization.
EXCLUDED_SOURCES = {
    "cincinnati-building-permits":
        "socrata four-segment source_key (platform:domain:dataset:ident); the registry "
        "entry carries domain+dataset_id rather than service_url. EXCLUDED until configured - "
        "reported as excluded, never as zero.",
    "cook-county-il-highway-construction-program":
        "no case_number and no identity_fields in the registry; identity is row_id. "
        "EXCLUDED until configured - reported as excluded, never as zero.",
    "lake-county-il-construction-program":
        "no case_number and no identity_fields in the registry; identity is row_id. "
        "EXCLUDED until configured - reported as excluded, never as zero.",
}
UNRECOVERABLE_BASES = ("source_id:row_id", "source_id:title(MUTABLE)")


def say(k, v):
    print(f"{k:<48} {v}", flush=True)


def one(rows, col):
    return rows[0][col] if rows else None


def load_registry():
    reg = json.load(open(REG_PATH))
    out = {}
    for plat, lst in reg.items():
        if plat.startswith("_"):
            continue
        for e in lst:
            out[e["registry_id"]] = (plat, e)
    return out


def disk_free_mb():
    r = sql("select (pg_database_size(current_database())/1048576.0) db, "
            "(select coalesce(sum(size),0)/1048576.0 from pg_ls_waldir()) wal;", "disk")
    db = float(r[0]["db"])
    wal = float(r[0]["wal"])
    return DISK_TOTAL_MB - (db + wal), db, wal


# ---------------------------------------------------------------- boundaries

_TIGER = {"raw": None, "geoid_to_idx": None}


def tiger_index():
    """Download and index the TIGER ZCTA archive ONCE per run, not once per shard."""
    if _TIGER["raw"] is not None:
        return _TIGER
    t0 = time.time()
    req = urllib.request.Request(TIGER_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=1800) as r:
        blob = r.read()
    sha = hashlib.sha256(blob).hexdigest()
    if sha != TIGER_SHA256:
        raise SystemExit(f"STOP: TIGER sha256 changed; expected {TIGER_SHA256} got {sha}")
    zf = zipfile.ZipFile(io.BytesIO(blob))
    base = next(n for n in zf.namelist() if n.endswith(".shp"))[:-4]
    prj = " ".join(zf.read(base + ".prj").decode("latin-1").split()).upper()
    if "NORTH_AMERICAN_1983" not in prj and "NAD83" not in prj:
        raise SystemExit("STOP: unexpected .prj; refusing to guess a CRS")
    n_rec, _fields, rows = read_dbf(zf.read(base + ".dbf"))
    if n_rec != 33791:
        raise SystemExit(f"STOP: national ZCTA feature count moved: {n_rec} != 33791")
    idx = {}
    for i, row in enumerate(rows):
        if row is None:
            continue
        g = row.get("GEOID20") or row.get("ZCTA5CE20")
        if g:
            idx[g] = i
    _TIGER["raw"] = zf.read(base + ".shp")
    _TIGER["geoid_to_idx"] = idx
    say("TIGER archive bytes", f"{len(blob):,}")
    say("TIGER sha256 matches the B1/N2A/N3/N4 pin", "yes")
    say("TIGER dbf records", f"{n_rec:,}")
    say("TIGER GEOIDs indexed", f"{len(idx):,}")
    say("TIGER download+index seconds", round(time.time() - t0, 1))
    return _TIGER


def load_boundaries(z3, zips):
    t = tiger_index()
    idx = t["geoid_to_idx"]
    wanted = {z: idx[z] for z in zips if z in idx}
    missing = sorted(set(zips) - set(wanted))
    shapes, _ = read_shp_polygons(t["raw"], set(wanted.values()))
    sql(f"delete from geo.n5_zcta where z3={lit(z3)};", "clear zcta")
    vals, loaded = [], 0
    for zc, i in sorted(wanted.items()):
        rings = shapes.get(i)
        if not rings:
            missing.append(zc)
            continue
        wkt = rings_to_multipolygon_wkt(rings, zc)
        vals.append(f"({lit(z3)},{lit(zc)},ST_GeomFromText({lit(wkt)},{CANON_SRID}))")
        loaded += 1
        if len(vals) >= 25:
            sql("insert into geo.n5_zcta (z3,zcta5,geom) values " + ",".join(vals)
                + " on conflict (z3,zcta5) do update set geom=excluded.geom;", "zcta ins")
            vals = []
    if vals:
        sql("insert into geo.n5_zcta (z3,zcta5,geom) values " + ",".join(vals)
            + " on conflict (z3,zcta5) do update set geom=excluded.geom;", "zcta ins")
    r = sql(f"select count(*) n, count(*) filter (where not ST_IsValid(geom)) bad, "
            f"coalesce(sum(ST_NPoints(geom)),0) pts from geo.n5_zcta where z3={lit(z3)};", "zcta chk")
    return loaded, sorted(set(missing)), int(r[0]["n"]), int(r[0]["bad"]), int(r[0]["pts"])


# ---------------------------------------------------------------- recovery

def recover_shard(z3, registry):
    """Recover authoritative geometry for RECOVERY-class projects in this shard.

    Publisher feature multiplicity is preserved (one row per source_key x OBJECTID) and a
    recovered feature is keyed by the FROZEN identity we asked for, never by the string the
    publisher echoes back - the N4 trailing-space defect. Geometry already in geo.n5_geom
    from an earlier shard is REUSED rather than refetched. That reuse is a side benefit:
    geo.n5_geom is PERMANENT CANONICAL PRODUCT GEOMETRY, not a build cache - see the table
    comment in docs/n5-canonical-geometry-provenance.sql."""
    rows = sql(f"""select registry_id,
                          count(distinct source_key) filter (where source_key_basis is null
                              or source_key_basis not in ({','.join(lit(b) for b in UNRECOVERABLE_BASES)})) recoverable,
                          count(distinct source_key) filter (where source_key_basis in
                              ({','.join(lit(b) for b in UNRECOVERABLE_BASES)})) unstable
                     from geo.n5_frozen
                    where z3={lit(z3)} and treatment='RECOVERY'
                    group by 1 order by 1;""", "rec sources")
    report = []
    for r in rows:
        rid = r["registry_id"]
        n_unstable = int(r["unstable"] or 0)
        if rid in EXCLUDED_SOURCES:
            report.append({"registry_id": rid, "status": "EXCLUDED", "unstable": n_unstable,
                           "reason": EXCLUDED_SOURCES[rid]})
            continue
        keys = [x["source_key"] for x in sql(
            f"""select distinct source_key from geo.n5_frozen
                 where z3={lit(z3)} and treatment='RECOVERY' and registry_id={lit(rid)}
                   and (source_key_basis is null or source_key_basis not in
                        ({','.join(lit(b) for b in UNRECOVERABLE_BASES)}))
                 order by source_key;""", "rec keys")]
        if not keys:
            report.append({"registry_id": rid, "status": "NO_RECOVERABLE_KEYS",
                           "unstable": n_unstable})
            continue
        cached = {x["source_key"] for x in sql(
            "select distinct source_key from geo.n5_geom "
            "where provenance='recovered_authoritative' and source_key in ("
            + ",".join(lit(k) for k in keys) + ");", "cache probe")}
        todo = [k for k in keys if k not in cached]
        st = {"registry_id": rid, "status": "OK", "projects": len(keys),
              "cache_hits": len(cached), "fetched": 0, "features": 0, "unstable": n_unstable}
        if todo:
            plat, entry = registry.get(rid, (None, None))
            if entry is None or not entry.get("service_url"):
                st["status"] = "EXCLUDED"
                st["reason"] = "no service_url in jurisdiction-registry.json"
                report.append(st)
                continue
            st.update(fetch_features(rid, entry, todo, z3))
        sql(f"""insert into geo.n5_recovery_attempt
                  (z3,registry_id,projects_in_shard,cache_hits,fetched,features,bytes_in,requests)
                values ({lit(z3)},{lit(rid)},{len(keys)},{len(cached)},{st.get('fetched',0)},
                        {st.get('features',0)},{st.get('bytes_in',0)},{st.get('requests',0)})
                on conflict (z3,registry_id) do update set
                  projects_in_shard=excluded.projects_in_shard, cache_hits=excluded.cache_hits,
                  fetched=excluded.fetched, features=excluded.features;""", "rec attempt")
        report.append(st)
    return report


def fetch_features(rid, entry, keys, z3):
    """Fetch authoritative geometry for `keys` from the publisher layer."""
    url = entry["service_url"]
    cm = entry.get("column_map") or {}
    ident = entry.get("identity_fields") or cm.get("case_number")
    if isinstance(ident, list):
        if len(ident) != 1:
            return {"status": "EXCLUDED",
                    "reason": f"compound identity {ident} is not supported by this pass"}
        ident = ident[0]
    b0, r0 = STATS["bytes_in"], STATS["requests"]
    meta, why = http(url, {"f": "json"})
    if meta is None or esri(meta):
        return {"status": "PUBLISHER_UNREACHABLE", "reason": str(why or esri(meta))[:200]}
    gtype = meta.get("geometryType")
    fields = {f.get("name"): f.get("type") for f in (meta.get("fields") or [])}
    quoted = fields.get(ident) == "esriFieldTypeString"
    # Map the publisher's ECHO back to the frozen identity we asked for (N4 defect).
    cases = {}
    for k in keys:
        # arcgis keys are platform:registry_id:ident, so everything after the SECOND
        # colon is the identity - the same split N3/N4 used. Taking the last segment
        # instead would truncate any identity that itself contains a colon.
        parts = k.split(":", 2)
        if len(parts) != 3:
            return {"status": "EXCLUDED",
                    "reason": f"source_key {k!r} is not platform:registry:ident; "
                              f"a 4-segment (socrata) key needs its own parser"}
        cases.setdefault(parts[2].strip(), k)
    want = sorted(cases)
    feats, unasked, errors = [], [], 0
    for i in range(0, len(want), 10):
        chunk = want[i:i + 10]
        vals = ",".join(("'" + c.replace("'", "''") + "'") if quoted else c for c in chunk)
        j, why2 = http(url + "/query", {"where": f"{ident} IN ({vals})", "outFields": ident,
                                        "returnGeometry": "true", "outSR": str(CANON_SRID),
                                        "f": "json"}, method="POST")
        if j is None or esri(j):
            errors += 1
            continue
        if j.get("exceededTransferLimit"):
            raise SystemExit(f"STOP: {rid} capped a batch; refusing a truncated recovery")
        for ft in j.get("features") or []:
            echo = str((ft.get("attributes") or {}).get(ident))
            sk = cases.get(echo.strip())
            if sk is None:
                unasked.append(echo)
                continue
            feats.append((sk, ft))
    rows, nfeat = [], 0
    for sk, ft in feats:
        g = ft.get("geometry") or {}
        oid = str((ft.get("attributes") or {}).get(ident, "")).strip() + f"#{nfeat}"
        # rings_to_wkt returns a (wkt, reason) PAIR - a malformed publisher ring set is
        # reported rather than raised, so one bad record cannot end the batch. paths_ and
        # POINT return a bare string. Unpacking the pair is not optional: assigning it
        # whole stringifies the tuple into the SQL as ('MULTIPOLYGON(...)', None) and
        # Postgres rejects it with "parse error at position 2 within geometry".
        if "rings" in g:
            wkt, bad = rings_to_wkt(g["rings"], sk)
        elif "paths" in g:
            wkt, bad = paths_to_multilinestring_wkt(g["paths"]), None
        elif "x" in g and "y" in g:
            wkt, bad = f"POINT({g['x']} {g['y']})", None
        else:
            wkt, bad = None, "NO_GEOMETRY"
        nfeat += 1
        if not wkt:
            reason = bad or "no usable geometry"
            rows.append(f"({lit(sk)},{lit(rid)},{lit(oid)},3,null,{lit(reason)},{lit(z3)},"
                        f"'recovered_authoritative')")
        else:
            # Dollar-quoted, as the pilot loaders do: a polygon WKT runs to tens of
            # thousands of characters and must not be re-escaped per quote.
            rows.append(f"({lit(sk)},{lit(rid)},{lit(oid)},1,"
                        f"ST_GeomFromText($g${wkt}$g$,{CANON_SRID}),null,{lit(z3)},"
                        f"'recovered_authoritative')")
    for i in range(0, len(rows), 25):
        sql("insert into geo.n5_geom (source_key,registry_id,feature_id,outcome,geom,invalid_reason,first_z3,"
            "provenance) values "
            + ",".join(rows[i:i + 25]) + " on conflict (source_key,feature_id) do nothing;", "geom ins")
    return {"status": "OK", "fetched": len(keys), "features": len(feats),
            "geometry_type": gtype, "batch_errors": errors, "unasked_echoes": len(unasked),
            "bytes_in": STATS["bytes_in"] - b0, "requests": STATS["requests"] - r0}


# ---------------------------------------------------------------- association

def build_associations(z3):
    """One evidence row per frozen legacy pair, plus geometry-only additions.

    Membership is exact ST_Intersects against authoritative geometry. No centroid, no
    radius, no bounding box, no nearest-ZIP, no buffer, no simplification, no snapping,
    and no ST_MakeValid. Proven-POINT projects use their frozen stored coordinates and
    are never refetched. Feature multiplicity supports an association but cannot inflate
    a project's count: the ZIP set is reduced to distinct at PROJECT identity before any
    row is written, and the table is keyed (source_key, zip, evidence)."""
    return f"""
with fr as (select * from geo.n5_frozen where z3={lit(z3)}),
proj as (select source_key, max(treatment) treatment,
                bool_or(source_key_basis in ({','.join(lit(b) for b in UNRECOVERABLE_BASES)})) unstable
           from fr group by source_key),
bnd as (select zcta5, geom from geo.n5_zcta where z3={lit(z3)}),
pt as (select distinct fr.source_key, ST_SetSRID(ST_MakePoint(fr.lng, fr.lat), {CANON_SRID}) g
         from fr join proj p using (source_key)
        where p.treatment='PROVEN' and fr.lat is not null and fr.lng is not null),
rec as (select g.source_key, g.geom g
          from geo.n5_geom g join proj p on p.source_key=g.source_key
         where p.treatment='RECOVERY' and g.geom is not null),
allgeom as (select * from pt union all select * from rec),
ver as (select distinct a.source_key, b.zcta5::text zip
          from allgeom a join bnd b on ST_Intersects(a.g, b.geom)),
hasg as (select distinct source_key from allgeom),
legacy as (select distinct source_key, zip::text zip from fr),
cls as (
  select l.source_key, l.zip,
         case when v.source_key is not null then 1
              when p.treatment in ('NOAUTH','HIST_UNRECOVERABLE','IDENT_UNRESOLVED') then 2
              when b.zcta5 is null then 2
              when h.source_key is not null then 3
              else 4 end ev
    from legacy l
    join proj p using (source_key)
    left join ver  v on v.source_key=l.source_key and v.zip=l.zip
    left join bnd  b on b.zcta5=l.zip
    left join hasg h on h.source_key=l.source_key),
adds as (select v.source_key, v.zip, 1 ev from ver v
          where not exists (select 1 from legacy l
                             where l.source_key=v.source_key and l.zip=v.zip))
"""


# ------------------------------------------------- PROVEN point materialization

def proven_candidates(z3):
    """Resolve the admission gate for every PROVEN project in this shard.

    ZERO NEW ASSOCIATION SEMANTICS. These exact points ALREADY participate in association
    construction through the `pt` CTE in build_associations, which computes
    ST_MakePoint(fr.lng, fr.lat) for PROVEN projects and unions it into `allgeom`. This
    function does not introduce a second PROVEN association path and does not change what
    associations are produced; it makes the spatial representation the builder is already
    using DURABLE in the canonical geometry corpus.

    ELIGIBILITY IS ENFORCED AT INSERTION, NOT AT QUERY TIME. A query-time join is a rule
    every future caller must remember; an insertion gate is a rule callers cannot forget.
    A point that fails any check is never written to geo.n5_geom, so no reader - however
    it is written - can return it as radius-eligible.

    The registry verdict is necessary but NOT sufficient: it is a per-SOURCE statement and
    cannot see a per-project geocode failure, so each candidate must also pass coordinate
    sanity and fall inside its own shard's jurisdiction."""
    return f"""
with fr as (select * from geo.n5_frozen where z3={lit(z3)} and treatment='PROVEN'),
verdict as (select registry_id from geo.n5_accepted_source where treatment='PROVEN'),
bnd as (select geom from geo.n5_zcta where z3={lit(z3)}),
base as (select distinct source_key from fr),
reg as (select source_key, min(registry_id) registry_id from fr group by source_key),
-- Distinct OBSERVED coordinate PAIRS. Deriving lat and lng with independent aggregates
-- (min(lat), min(lng)) could pair a latitude from one row with a longitude from another and
-- emit a point present in NO source row - fabrication. Rows A(42,-71) and B(41,NULL) must
-- never yield (41,-71). A pair is only observed when BOTH values are non-null on the SAME row.
pairs as (select distinct source_key, lat, lng
            from fr where lat is not null and lng is not null),
cnt as (select b.source_key,
               (select count(*) from pairs p where p.source_key = b.source_key) ncoord
          from base b),
-- The candidate coordinate is taken ONLY when exactly one distinct pair was observed, and it
-- is that whole row - never assembled from parts.
sel as (select p.source_key, p.lat, p.lng
          from pairs p join cnt c on c.source_key = p.source_key and c.ncoord = 1),
agg as (
  select b.source_key, r.registry_id, c.ncoord, sl.lat, sl.lng
    from base b
    join reg r using (source_key)
    join cnt c using (source_key)
    left join sel sl using (source_key)),
gated as (
  select a.*,
         (a.registry_id is not null
          and exists (select 1 from verdict v where v.registry_id = a.registry_id)) has_verdict,
         case when a.ncoord = 0 then null
              else ST_SetSRID(ST_MakePoint(a.lng, a.lat), {CANON_SRID}) end g
    from agg a),
judged as (
  select gg.*,
         case
           when not gg.has_verdict                             then 'NO_REGISTRY_VERDICT'
           when gg.ncoord > 1                                  then 'MULTI_COORD_UNRESOLVED'
           when gg.ncoord = 0                                  then 'NULL_COORD'
           when gg.lat not between -90 and 90
             or gg.lng not between -180 and 180                then 'INVALID_COORD'
           when abs(gg.lat) < 1e-9 and abs(gg.lng) < 1e-9      then 'NULL_ISLAND'
           when not exists (select 1 from bnd b where ST_Intersects(gg.g, b.geom))
                                                               then 'OUTSIDE_JURISDICTION'
           else null end reject_reason
    from gated gg)
"""


def materialize_proven_points(z3):
    """Persist admitted PROVEN points, and record every rejection with its reason.

    feature_id is the reserved slot 'pt:1' - see FEATURE_ID_PT1_DOC. Multi-coordinate
    projects are NOT materialized in v1: they are recorded MULTI_COORD_UNRESOLVED and
    'pt:2' is never generated.

    *** DISABLED - TWO RULINGS OUTSTANDING. DO NOT ENABLE WITHOUT THEM. ***

    (a) OWNERSHIP / DELETION BOUNDARY is unresolved. Measured on the frozen baseline
        2026-09-02: of 723,449 PROVEN source_keys, 72,856 (10.1%) appear in MORE THAN ONE z3
        shard - up to 12 shards and 217 distinct ZIPs for one project. But the canonical point
        is ONE row per project, keyed (source_key,'pt:1'). So a per-z3 destructive delete would
        let shards erase each other's points, and eligibility judged on a shard-LOCAL slice can
        disagree between shards for the same project. This insert is still append-only
        (ON CONFLICT DO NOTHING), which the audit correctly rejected: a stale pt:1 survives
        ineligibility and a corrected coordinate is never applied.

    (b) JURISDICTION is unresolved. The gate below tests "intersects ANY ZCTA loaded for this
        shard", which the audit classified TOO BROAD. The narrower rule needs a project-level
        jurisdiction, and the freeze source preservation.app_project_identity carries only
        (zip, lat, lng) where `zip` is the ZIP PAGE the project was materialized onto - up to
        217 of them per project - not an address ZIP. There is therefore no unambiguous "own
        jurisdiction" field available.

    Until both are ruled, this refuses to run rather than writing geometry under semantics
    known to be wrong. Fail closed."""
    if os.environ.get("N5_PROVEN_MATERIALIZE", "0").strip() != "1":
        raise SystemExit(
            "STOP: PROVEN point materialization is disabled pending two rulings - the "
            "cross-shard ownership/deletion boundary (10.1% of PROVEN projects span multiple "
            "shards) and the 'own jurisdiction' definition (the freeze source carries only the "
            "page ZIP). See materialize_proven_points.__doc__.")
    q = proven_candidates(z3) + f"""
insert into geo.n5_geom (source_key, registry_id, feature_id, outcome, geom,
                         invalid_reason, first_z3, provenance)
select source_key, registry_id, 'pt:1', 1, g, null, {lit(z3)}, 'proven_stored_point'
  from judged where reject_reason is null
on conflict (source_key, feature_id) do nothing;"""
    sql(q, "proven points " + z3)
    r = proven_candidates(z3) + f"""
insert into geo.n5_point_reject (z3, source_key, registry_id, lat, lng, reason)
select {lit(z3)}, source_key, registry_id, lat, lng, reject_reason
  from judged where reject_reason is not null
on conflict (z3, source_key, reason) do nothing;"""
    sql(r, "proven rejects " + z3)
    return one(sql(f"""select
        (select count(*) from geo.n5_geom
          where first_z3={lit(z3)} and provenance='proven_stored_point') materialized,
        (select count(*) from geo.n5_point_reject where z3={lit(z3)}) rejected;""",
                   "proven counts"), None)


# 'pt:' is a RESERVED synthetic namespace meaning "the canonical fidelity-proven stored point
# slot for this source_key". It cannot collide with publisher feature ids: those use '#' as
# their ordinal separator (e.g. '0001-0100#2', 'NHSX-020-9(183)--3H-31#0') and contain no
# colon. Identity is the SLOT, not the coordinate value, so correcting a coordinate updates
# geom in place and leaves feature_id unchanged. 'pt:2' and beyond are RESERVED AND UNDEFINED
# and MUST NOT be generated until multi-coordinate PROVEN semantics are separately approved.
FEATURE_ID_PT1_DOC = "pt:1"


# ------------------------------------------------- stage / reconcile / swap

def stage_associations(z3):
    """Build this shard's complete candidate output WITHOUT touching the authoritative set."""
    sql(f"delete from geo.n5_association_stage where z3={lit(z3)};", "stage clear " + z3)
    q = build_associations(z3) + f"""
insert into geo.n5_association_stage (z3, source_key, zip, evidence)
select {lit(z3)}, source_key, zip::char(5), ev
  from (select * from cls union all select * from adds) z;"""
    # Deliberately NO `on conflict`: the stage PK (z3, source_key, zip) enforces one class per
    # pair, so a run that would produce two evidence values for one pair fails HERE instead of
    # corrupting production.
    sql(q, "stage " + z3)


def reconcile_stage(z3):
    """Verify the staged set before anything authoritative is touched."""
    return one(sql(f"""select
        (select count(*) from geo.n5_association_stage where z3={lit(z3)}) staged,
        (select count(distinct (source_key, zip)) from geo.n5_association_stage
          where z3={lit(z3)}) staged_pairs,
        (select count(*) from geo.n5_association_stage where z3={lit(z3)} and evidence=1) s1,
        (select count(*) from geo.n5_association_stage where z3={lit(z3)} and evidence=2) s2,
        (select count(*) from geo.n5_association_stage where z3={lit(z3)} and evidence=3) s3,
        (select count(*) from geo.n5_association_stage where z3={lit(z3)} and evidence=4) s4,
        (select count(*) from geo.n5_association where left(zip,3)={lit(z3)}) prior,
        (select count(*) from geo.n5_geom where first_z3={lit(z3)}
           and provenance='recovered_authoritative') geom_recovered,
        (select count(*) from geo.n5_geom where first_z3={lit(z3)}
           and provenance='proven_stored_point') geom_proven,
        (select count(*) from geo.n5_point_reject where z3={lit(z3)}) rejects,
        (select count(*) from (
            select source_key, zip, evidence from geo.n5_association_stage where z3={lit(z3)}
            except
            select source_key, zip, evidence from geo.n5_association
             where left(zip,3)={lit(z3)}) d) staged_not_prior,
        (select count(*) from (
            select source_key, zip, evidence from geo.n5_association
             where left(zip,3)={lit(z3)}
            except
            select source_key, zip, evidence from geo.n5_association_stage
             where z3={lit(z3)}) d) prior_not_staged;""",
                   "reconcile " + z3), None)


def swap_shard(z3):
    """Atomically replace this shard's authoritative association set.

    One DO block = one statement = one transaction. The old authoritative rows survive until
    this commits, so a failure before or during the swap leaves production untouched. The
    boundary left(zip,3)=z3 is exact: association ZIPs can only come from geo.n5_zcta rows
    loaded for this shard, and that partition was verified against all 13 completed shards."""
    z = lit(z3)
    body = ("do $swap$\n"
            "begin\n"
            "  delete from geo.n5_association where left(zip,3)=" + z + ";\n"
            "  insert into geo.n5_association (source_key, zip, evidence)\n"
            "    select source_key, zip, evidence from geo.n5_association_stage"
            " where z3=" + z + ";\n"
            "  delete from geo.n5_association_stage where z3=" + z + ";\n"
            "end\n"
            "$swap$;")
    sql(body, "swap " + z3)


# A REBUILD of an already-populated shard must not change association semantics. Persisting a
# PROVEN point cannot add, remove or reclassify a pair, because those points already
# participate through the `pt` CTE. So for a rebuild, ANY membership or evidence delta HALTS
# BEFORE THE SWAP - it is not printed and swapped anyway. A deliberately authorized semantic
# change sets ALLOW_ASSOCIATION_DELTA=1 explicitly; the invariant is never weakened silently.
ALLOW_ASSOCIATION_DELTA = os.environ.get("ALLOW_ASSOCIATION_DELTA", "0").strip() == "1"


def associate(z3):
    """Stage -> reconcile -> swap. Rerunning is idempotent: staging clears its own z3 first
    and the swap is a full scoped replacement, never an append."""
    stage_associations(z3)
    rc = reconcile_stage(z3)
    if int(rc["staged"]) != int(rc["staged_pairs"]):
        raise SystemExit(f"STOP: shard {z3} staged {rc['staged']} rows for "
                         f"{rc['staged_pairs']} distinct pairs - refusing to swap.")
    prior = int(rc["prior"])
    drift = int(rc["staged_not_prior"]) + int(rc["prior_not_staged"])
    if prior > 0 and drift and not ALLOW_ASSOCIATION_DELTA:
        raise SystemExit(
            f"STOP: shard {z3} rebuild changes associations - staged {rc['staged']} vs prior "
            f"{prior}; {rc['staged_not_prior']} staged-not-prior, {rc['prior_not_staged']} "
            f"prior-not-staged (evidence 1/2/3/4 staged {rc['s1']}/{rc['s2']}/{rc['s3']}/"
            f"{rc['s4']}). Persisting PROVEN points must not alter association semantics. "
            f"Refusing to swap. Set ALLOW_ASSOCIATION_DELTA=1 only for an authorized change.")
    swap_shard(z3)
    return rc


def shard_counts(z3):
    q = build_associations(z3) + """
select (select count(*) from legacy) legacy_pairs,
       (select count(*) from cls where ev=1) v1,
       (select count(*) from cls where ev=2) v2,
       (select count(*) from cls where ev=3) v3,
       (select count(*) from cls where ev=4) v4,
       (select count(*) from adds) adds,
       (select count(distinct source_key) from proj) projects,
       (select count(*) from hasg) with_geom,
       (select count(*) from proj where unstable) unstable_projects;"""
    return sql(q, "counts " + z3)[0]


# ---------------------------------------------------------------- one shard

def run_shard(z3):
    say("", "")
    say("=" * 48, "")
    say("SHARD", z3)
    t_shard = time.time()
    man = sql(f"""select projects, pairs, zips, checksum from geo.n5_shard
                   where snapshot_id={lit(SNAPSHOT)} and z3={lit(z3)};""", "manifest")[0]
    say("manifest projects / pairs / zips",
        f"{man['projects']} / {man['pairs']} / {man['zips']}")

    # 1 - FREEZE this shard's slice of the frozen baseline
    sql(f"delete from geo.n5_frozen where z3={lit(z3)};", "clear frozen")
    sql(f"""insert into geo.n5_frozen (z3,source_key,zip,source_seq,registry_id,treatment,lat,lng,source_key_basis)
            select {lit(z3)}, i.source_key, i.zip, i.source_seq,
                   coalesce(i.registry_id,'(null)'), a.treatment, i.lat, i.lng, p.source_key_basis
              from preservation.app_project_identity i
              join geo.n5_accepted_source a on a.registry_id = coalesce(i.registry_id,'(null)')
              left join public.app_projects p on p.id = i.app_project_id
             where i.snapshot_id={lit(SNAPSHOT)} and i.record_kind='development'
               and left(i.zip,3)={lit(z3)};""", "freeze")
    chk = sql(f"""select count(*) rows, count(distinct source_key) projects,
                         count(distinct source_key||'|'||zip) pairs, count(distinct zip) zips,
                         sum(('x'||substr(md5(source_key||'|'||zip||'|'||coalesce(source_seq::text,'')),1,8))::bit(32)::bigint) ck
                    from geo.n5_frozen where z3={lit(z3)};""", "freeze chk")[0]
    say("frozen rows / projects / pairs",
        f"{chk['rows']} / {chk['projects']} / {chk['pairs']}")
    drift = []
    if int(chk["projects"]) != int(man["projects"]):
        drift.append(f"projects {chk['projects']} vs manifest {man['projects']}")
    if int(chk["pairs"]) != int(man["pairs"]):
        drift.append(f"pairs {chk['pairs']} vs manifest {man['pairs']}")
    if str(chk["ck"]) != str(man["checksum"]):
        drift.append(f"checksum {chk['ck']} vs manifest {man['checksum']}")
    say("freeze checksum matches manifest", "yes" if not drift else "NO -> " + "; ".join(drift))
    if drift:
        return halt(z3, "FREEZE_DRIFT", {"drift": drift})

    # 2 - BOUNDARIES
    zips = [r["zip"] for r in sql(
        f"select distinct zip from geo.n5_frozen where z3={lit(z3)} order by zip;", "zips")]
    loaded, missing, nb, bad, pts = load_boundaries(z3, zips)
    say("ZIPs in shard / ZCTA-matched / no boundary",
        f"{len(zips)} / {loaded} / {len(missing)}")
    say("boundary polygons valid", f"{nb - bad} of {nb}" + ("" if bad == 0 else "  <-- INVALID"))
    say("boundary vertices", f"{pts:,}")
    if bad:
        return halt(z3, "INVALID_BOUNDARY", {"invalid": bad})

    # 3 - RECOVER (geometry reuse is cross-shard; hit rate is measured, not assumed)
    rec = recover_shard(z3, load_registry())
    for r in rec:
        say(f"  recovery {r['registry_id']}",
            f"{r['status']} projects={r.get('projects','-')} cache_hits={r.get('cache_hits','-')} "
            f"fetched={r.get('fetched','-')} features={r.get('features','-')} "
            f"unstable={r.get('unstable',0)}")
        if r.get("reason"):
            say("    reason", r["reason"][:150])
        if r.get("unasked_echoes"):
            say("    identities echoed but never asked for", r["unasked_echoes"])

    # 3b - MATERIALIZE fidelity-proven stored points into canonical geometry.
    #      ZERO NEW ASSOCIATION SEMANTICS: these points already participate through the `pt`
    #      CTE in build_associations. This only makes them durable. Association output must
    #      therefore be unchanged by this step - that is the invariant the receipt checks.
    pts = materialize_proven_points(z3)
    say("proven points materialized / rejected",
        f"{pts['materialized']} / {pts['rejected']}")

    # 4 - ASSOCIATE (stage -> reconcile -> swap)
    before = shard_counts(z3)
    rc = associate(z3)
    say("staged / prior associations", f"{rc['staged']} / {rc['prior']}")
    got = int(one(sql(f"select count(*) n from geo.n5_association where left(zip,3)={lit(z3)};",
                      "assoc n"), "n"))
    say("", "")
    say("legacy pairs", before["legacy_pairs"])
    say("  geometry_verified (1)", before["v1"])
    say("  legacy_unverifiable (2)", before["v2"])
    say("  legacy_unsupported (3)", before["v3"])
    say("  unresolved (4)", before["v4"])
    say("geometry-only additions", before["adds"])
    say("associations written", got)
    say("projects with authoritative geometry", f"{before['with_geom']} of {before['projects']}")
    say("projects on unstable identity -> unresolved", before["unstable_projects"])

    closes = (int(before["v1"]) + int(before["v2"]) + int(before["v3"]) + int(before["v4"])
              == int(before["legacy_pairs"]))
    total_ok = got == int(before["legacy_pairs"]) + int(before["adds"])
    say("evidence closes on legacy pairs", "yes" if closes else "NO")
    say("associations == legacy + additions", "yes" if total_ok else "NO")

    # 5 - VERIFY: no phantom, and idempotent
    phantom = int(one(sql(f"""select count(*) n from geo.n5_association a
                              where left(a.zip,3)={lit(z3)}
                                and not exists (select 1 from geo.n5_frozen f
                                                 where f.z3={lit(z3)} and f.source_key=a.source_key);""",
                          "phantom"), "n"))
    say("phantom projects (not in frozen slice)", phantom)
    fp1 = one(sql(f"""select md5(string_agg(k, ',' order by k collate "C")) m from
                      (select (source_key||'|'||zip||'|'||evidence::text) k
                         from geo.n5_association where left(zip,3)={lit(z3)}) z;""", "fp1"), "m")
    associate(z3)
    n2 = int(one(sql(f"select count(*) n from geo.n5_association where left(zip,3)={lit(z3)};",
                     "assoc n2"), "n"))
    fp2 = one(sql(f"""select md5(string_agg(k, ',' order by k collate "C")) m from
                      (select (source_key||'|'||zip||'|'||evidence::text) k
                         from geo.n5_association where left(zip,3)={lit(z3)}) z;""", "fp2"), "m")
    say("second-run inserts", n2 - got)
    say("fingerprint identical", "yes" if fp1 == fp2 else "NO")
    say("shard fingerprint", fp1)

    verified = (closes and total_ok and phantom == 0 and n2 == got and fp1 == fp2)
    say("VERIFIED CLEAN", "yes" if verified else "NO")

    # 6 - DISCARD the per-shard disposable working set (boundaries + frozen slice).
    #     geo.n5_geom is deliberately NOT discarded, and NOT because it is a cache. It is
    #     PERMANENT CANONICAL PRODUCT GEOMETRY - the authoritative spatial corpus behind Map 1
    #     address/radius reads. It incidentally enables geometry reuse across shards, but that
    #     does NOT make it disposable. It MUST NOT be reclaimed, truncated, or dropped to
    #     recover disk: reclaiming it deletes the product's spatial corpus.
    sql(f"delete from geo.n5_zcta where z3={lit(z3)};", "drop zcta")
    sql(f"delete from geo.n5_frozen where z3={lit(z3)};", "drop frozen")
    left_z = int(one(sql(f"select count(*) n from geo.n5_zcta where z3={lit(z3)};", "z left"), "n"))
    left_f = int(one(sql(f"select count(*) n from geo.n5_frozen where z3={lit(z3)};", "f left"), "n"))
    say("working set discarded (boundaries / frozen)", f"{left_z} / {left_f} remaining")

    # 7 - DISK
    free, db, wal = disk_free_mb()
    say("db / WAL MB", f"{db:,.0f} / {wal:,.0f}")
    say("free MB (floor %.0f)" % DISK_FLOOR_MB, f"{free:,.0f}")
    disk_ok = free > DISK_FLOOR_MB
    say("disk above floor", "yes" if disk_ok else "NO")

    say("shard seconds", round(time.time() - t_shard, 1))
    detail = {"legacy_pairs": int(before["legacy_pairs"]), "v1": int(before["v1"]),
              "v2": int(before["v2"]), "v3": int(before["v3"]), "v4": int(before["v4"]),
              "additions": int(before["adds"]), "associations": got,
              "projects": int(before["projects"]), "with_geom": int(before["with_geom"]),
              "unstable_projects": int(before["unstable_projects"]),
              "boundaries": nb, "boundary_missing": len(missing),
              "recovery": rec, "fingerprint": fp1,
              "second_run_inserts": n2 - got, "phantom": phantom,
              "free_mb": round(free, 1), "verified": verified, "disk_ok": disk_ok}

    # ADVANCE ONLY IF VERIFIED CLEAN **AND** DISK ABOVE FLOOR. Both, and-not-or.
    if verified and disk_ok:
        sql(f"""update geo.n5_shard set state='done', finished_at=now(),
                       detail={lit(json.dumps(detail))}::jsonb
                 where snapshot_id={lit(SNAPSHOT)} and z3={lit(z3)};""", "mark done")
        say("SHARD RESULT", "DONE")
        return True
    reason = ("NOT_VERIFIED" if not verified else "") + ("+" if not verified and not disk_ok else "") \
             + ("DISK_FLOOR" if not disk_ok else "")
    return halt(z3, reason, detail)


def halt(z3, reason, detail):
    detail = dict(detail)
    detail["halt_reason"] = reason
    sql(f"""update geo.n5_shard set state='halted', finished_at=now(),
                   detail={lit(json.dumps(detail))}::jsonb
             where snapshot_id={lit(SNAPSHOT)} and z3={lit(z3)};""", "mark halted")
    say("SHARD RESULT", f"HALTED - {reason}")
    return False


def parse_shard_list(z3_env, max_shards):
    """Turn the Z3 input into shard identifiers. Pure and side-effect free so the CI
    gate can exercise it without a database.

    "AUTO" -> None, meaning "caller selects the next pending shards".
    Anything else is a COMMA-SEPARATED LIST: "062,063" is two shards, never one shard
    literally named "062,063". That distinction is the whole point of this function -
    when the split was missing, the driver looked up a manifest row for "062,063",
    found none, and crashed with IndexError after the run had already been dispatched.
    """
    if z3_env.strip().upper() == "AUTO":
        return None
    out = []
    for tok in z3_env.split(","):
        t = tok.strip()
        if t and t not in out:
            out.append(t)
    return out[:max_shards]


def _assert_helper_contracts():
    """Fail loudly if an imported helper's RETURN SHAPE changes.

    This repo's CI suite is JS-only (test/*.test.mjs); no workflow runs pytest, so a
    Python regression test here would never execute and would be scaffolding that
    attests to nothing. This check does run - on every shard, before any network or
    write - and it fails closed.

    It exists because rings_to_wkt returns a (wkt, reason) PAIR while the polyline and
    point paths return a bare string. Assigning the pair whole put the literal
    ('MULTIPOLYGON(...)', None) into the SQL and Postgres rejected it with "parse error
    at position 2 within geometry", failing shard 062 after the freeze and boundary
    steps had already succeeded. Shard 520 could not have caught it: its source is a
    polyline, so it never took the rings branch.
    """
    probe = rings_to_wkt([[(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (0.0, 0.0)]], "_contract")
    if not isinstance(probe, tuple) or len(probe) != 2:
        raise SystemExit("STOP: rings_to_wkt no longer returns (wkt, reason); "
                         "the geometry marshalling in fetch_features must be re-checked")
    if not isinstance(paths_to_multilinestring_wkt([[(0.0, 0.0), (1.0, 1.0)]]), str):
        raise SystemExit("STOP: paths_to_multilinestring_wkt no longer returns a bare WKT string")
    if parse_shard_list("062,063", 10) != ["062", "063"]:
        raise SystemExit("STOP: shard-list parsing regressed; 'a,b' must yield two shard ids")
    if parse_shard_list("AUTO", 10) is not None:
        raise SystemExit("STOP: AUTO must not be parsed as a shard id")
    say("helper return-shape contracts", "ok (rings pair, paths string, shard list)")


def main():
    say("mode", "n5-shard (bounded national association build, shard by shard)")
    _assert_helper_contracts()
    say("freeze basis", f"preservation.app_project_identity @ {SNAPSHOT}, record_kind=development")
    snap = sql(f"select sources, projects, pairs, n_rows from geo.n5_snapshot "
               f"where snapshot_id={lit(SNAPSHOT)};", "snap")[0]
    say("baseline sources / projects / pairs",
        f"{snap['sources']} / {snap['projects']:,} / {snap['pairs']:,}")
    say("baseline rows (repeated triples preserved)",
        f"{snap['n_rows']:,}  = pairs + {int(snap['n_rows']) - int(snap['pairs']):,} repeated source_seq")
    free0, db0, wal0 = disk_free_mb()
    say("free MB at start", f"{free0:,.0f}  (floor {DISK_FLOOR_MB:,.0f})")
    if free0 <= DISK_FLOOR_MB:
        raise SystemExit("STOP: free disk is at or below the floor before any shard ran")

    todo = parse_shard_list(Z3_ENV, MAX_SHARDS)
    if todo is None:
        todo = [r["z3"] for r in sql(
            f"""select z3 from geo.n5_shard where snapshot_id={lit(SNAPSHOT)} and state='pending'
                 order by pairs asc, z3 limit {MAX_SHARDS};""", "pick")]
    say("shards this run", f"{len(todo)}: " + ",".join(todo))

    # Refuse an identifier that is not in the manifest BEFORE marking anything running
    # or writing a single row. A malformed id previously reached run_shard and crashed
    # at the manifest lookup; nothing durable was written then either, but failing here
    # makes that a guarantee of the control flow rather than a property of where the
    # first query happened to sit.
    if todo:
        known = {r["z3"] for r in sql(
            f"select z3 from geo.n5_shard where snapshot_id={lit(SNAPSHOT)};", "manifest ids")}
        unknown = [z for z in todo if z not in known]
        if unknown:
            raise SystemExit(f"STOP: shard id(s) not in the {SNAPSHOT} manifest: {unknown}. "
                             f"Nothing was written.")
    if not todo:
        raise SystemExit("STOP: no shards selected")

    done = 0
    for z3 in todo:
        sql(f"update geo.n5_shard set state='running', started_at=now() "
            f"where snapshot_id={lit(SNAPSHOT)} and z3={lit(z3)};", "mark running")
        try:
            ok = run_shard(z3)
        except BaseException as e:
            # Without this the shard stays 'running' forever: neither done nor halted,
            # so a resume skips it and the run reports no failure. A crash is a halt.
            say("SHARD RESULT", f"HALTED - CRASH {type(e).__name__}")
            halt(z3, "CRASH", {"error": f"{type(e).__name__}: {str(e)[:400]}"})
            raise
        if not ok:
            say("", "")
            say("RUN HALTED", "advance requires VERIFIED CLEAN **and** disk above floor")
            return 1
        done += 1
    say("", "")
    say("shards completed this run", done)
    rem = one(sql(f"select count(*) n from geo.n5_shard where snapshot_id={lit(SNAPSHOT)} "
                  f"and state='pending';", "rem"), "n")
    say("shards still pending", rem)
    corpus = sql("select count(*) feats, count(distinct source_key) projects, "
                 "pg_size_pretty(pg_total_relation_size('geo.n5_geom')) sz from geo.n5_geom;",
                 "corpus")[0]
    say("canonical geometry corpus (NOT reclaimable)",
        f"{corpus['feats']} features / {corpus['projects']} projects / {corpus['sz']}")
    say("publisher requests this run", STATS["requests"])
    say("publisher bytes this run", f"{STATS['bytes_in']:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)

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

# SNAPSHOT is REQUIRED and has no default. A default silently selects one eligibility
# universe: once a second snapshot exists, an unset variable would quietly process the old
# one and mark shards done against it. Fail before any freeze/recovery/materialization work.
SNAPSHOT = os.environ.get("SNAPSHOT", "").strip()


def require_snapshot():
    """Refuse to do any work without an explicit SNAPSHOT.

    Enforced HERE and not at module scope: raising on import would break every consumer that
    merely imports this module (tests and tooling do), and the contract is 'fail before
    freeze/recovery/materialization/association work', not 'fail on import'."""
    if not SNAPSHOT:
        raise SystemExit(
            "STOP: SNAPSHOT must be set explicitly - there is no default. Pass the frozen input "
            "snapshot this run processes, e.g. SNAPSHOT=phase1-2026-09-01.")
    return SNAPSHOT
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

    THE `pt` PATH READS THE PROJECT-GLOBAL VERDICT, not the shard-local frozen slice. Canonical
    geometry and association construction must agree: it must be impossible for
    geo.n5_geom to hold MULTI_COORD_UNRESOLVED while this CTE still supplies that project's
    shard-local point(s). This is an EXPECTED SEMANTIC CORRECTION, not the old
    zero-change invariant - a globally multi-coordinate project now contributes NO point here,
    where the shard-local version would have contributed one per distinct in-shard pair.
    Measured before any execution (2026-09-02): for the 13 COMPLETED shards the impact is ZERO
    (they contain 1 PROVEN source_key, globally single-coordinate). For shard 760 it is
    NONZERO - 29 projects are single-coordinate locally but multi-coordinate globally, and
    global multi rises 579 -> 609.

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
pt as (select v.source_key, ST_SetSRID(ST_MakePoint(v.lng, v.lat), {CANON_SRID}) g
         from geo.n5_proven_verdict v
         join proj p on p.source_key = v.source_key
        where v.snapshot_id={lit(SNAPSHOT)} and v.verdict='ELIGIBLE' and p.treatment='PROVEN'),
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

def assert_frozen_input_present():
    """The frozen INPUT baseline must exist as ROWS, not merely as a declared snapshot id.

    geo.n5_snapshot is a declaration; preservation.app_project_identity is the baseline. They
    can disagree: geo.n5_snapshot carries 'n5-2026-09-02T173042Z', which has ZERO rows in
    preservation.app_project_identity and is referenced by no shard. Validating against the
    declaration alone would let that orphan be published - producing an empty verdict that is
    internally consistent (expected 0 == verdict 0) and would then sweep every canonical
    proven point out of existence as 'absent from the snapshot'.

    So the check is on the INPUT RELATION. An orphan fails here, before a manifest row exists."""
    require_snapshot()
    row = sql(f"""select
        (select count(*) from geo.n5_snapshot where snapshot_id={lit(SNAPSHOT)}) declared,
        (select count(*) from preservation.app_project_identity
          where snapshot_id={lit(SNAPSHOT)} and record_kind='development') input_rows;""",
              "frozen input")[0]
    if int(row["declared"]) == 0:
        raise SystemExit(f"STOP: snapshot {SNAPSHOT} is not declared in geo.n5_snapshot.")
    if int(row["input_rows"]) == 0:
        raise SystemExit(
            f"STOP: snapshot {SNAPSHOT} has ZERO rows in preservation.app_project_identity "
            f"(record_kind='development'). ORPHAN / INPUT BASELINE ABSENT / NOT CONSUMABLE. "
            f"Publishing it would build an empty verdict and sweep the canonical corpus away.")
    return row


def assert_snapshot_consumable():
    """Refuse to run unless THIS run's exact snapshot is published and canonically synced.

    Two distinct gates, because they are two different claims:
      state='READY'           -> the global verdict is complete and safe to READ.
      canonical_synced_at set -> the global canonical-point sweep for that snapshot has run,
                                 so geo.n5_geom's proven corpus matches this eligibility
                                 universe.
    A shard requires BOTH. Consuming a READY-but-unsynced verdict would build associations
    from one universe while canonical geometry still held the previous one.

    THREE claims, not two: the frozen INPUT must also still exist as ROWS. Declaration and
    baseline can disagree - geo.n5_snapshot carries an orphan with zero rows in
    preservation.app_project_identity - and a shard that trusted the declaration alone would
    build associations against a baseline that is not there.

    No MAX(snapshot_id), no 'latest', no fallback, no partial BUILDING read, no FAILED read,
    and no shard-local coordinate fallback (that path no longer exists)."""
    require_snapshot()
    row = sql(f"""select
        (select count(*) from geo.n5_snapshot where snapshot_id={lit(SNAPSHOT)}) input_exists,
        (select count(*) from preservation.app_project_identity
          where snapshot_id={lit(SNAPSHOT)} and record_kind='development') input_rows,
        (select state from geo.n5_verdict_manifest where snapshot_id={lit(SNAPSHOT)}) state,
        (select canonical_synced_at is not null from geo.n5_verdict_manifest
          where snapshot_id={lit(SNAPSHOT)}) synced,
        (select verdict_rows from geo.n5_verdict_manifest where snapshot_id={lit(SNAPSHOT)}) vrows,
        (select expected_source_keys from geo.n5_verdict_manifest
          where snapshot_id={lit(SNAPSHOT)}) expected;""", "snapshot gate")[0]
    if int(row["input_exists"]) == 0:
        raise SystemExit(f"STOP: snapshot {SNAPSHOT} is not present in geo.n5_snapshot. It is "
                         f"not a known frozen input baseline.")
    if int(row["input_rows"]) == 0:
        raise SystemExit(f"STOP: snapshot {SNAPSHOT} is declared but has ZERO rows in "
                         f"preservation.app_project_identity. ORPHAN / INPUT BASELINE ABSENT / "
                         f"NOT CONSUMABLE - the declaration is not the baseline.")
    if row["state"] is None:
        raise SystemExit(f"STOP: no verdict manifest for snapshot {SNAPSHOT}. The global PROVEN "
                         f"verdict has never been built for it.")
    if str(row["state"]) != "READY":
        raise SystemExit(f"STOP: verdict for snapshot {SNAPSHOT} is state={row['state']}, not "
                         f"READY. A BUILDING or FAILED verdict is never consumable.")
    if not row["synced"]:
        raise SystemExit(f"STOP: verdict for snapshot {SNAPSHOT} is READY but its canonical "
                         f"point sweep has not completed (canonical_synced_at is null). "
                         f"Shards may not consume it yet.")
    if row["expected"] is None or int(row["vrows"]) != int(row["expected"]):
        raise SystemExit(f"STOP: verdict manifest for {SNAPSHOT} is internally inconsistent - "
                         f"verdict_rows={row['vrows']} expected_source_keys={row['expected']}.")
    return row


def validate_verdict_completeness():
    """Completeness reconciliation. A snapshot cannot become READY unless this returns clean.

    The authoritative PROVEN population is recomputed from the same snapshot, never taken from
    a prior receipt. 723,449 is evidence from 2026-09-02, not logic."""
    return sql(f"""
with auth as (
  select distinct i.source_key
    from preservation.app_project_identity i
    join geo.n5_accepted_source a on a.registry_id = coalesce(i.registry_id,'(null)')
   where a.treatment='PROVEN' and i.snapshot_id={lit(SNAPSHOT)} and i.record_kind='development'),
v as (select source_key, verdict, ncoord, lat, lng from geo.n5_proven_verdict
       where snapshot_id={lit(SNAPSHOT)})
select (select count(*) from auth) expected_source_keys,
       (select count(*) from v) verdict_rows,
       (select count(distinct source_key) from v) verdict_distinct,
       (select count(*) from (select source_key from auth except select source_key from v) t) missing,
       (select count(*) from (select source_key from v except select source_key from auth) t) extra,
       (select count(*) from v where verdict='ELIGIBLE') eligible_rows,
       (select count(*) from v where verdict<>'ELIGIBLE') rejected_rows,
       (select count(*) from v where verdict='MULTI_COORD_UNRESOLVED') multi_coord,
       (select jsonb_object_agg(verdict, n) from
          (select verdict, count(*) n from v group by verdict) z) reject_counts,
       -- MALFORMED rows must be impossible, not merely unlikely. The table's CHECK enforces
       -- the ELIGIBLE contract, but this migration is not applied yet, so completeness proves
       -- it independently rather than trusting a constraint that may not exist.
       (select count(*) from v
         where (verdict = 'ELIGIBLE'
                and (ncoord is distinct from 1 or lat is null or lng is null))
            or (verdict <> 'ELIGIBLE' and (lat is not null or lng is not null)
                and verdict not in ('NULL_ISLAND','INVALID_COORD'))) malformed,
       (select count(*) from v where verdict not in (
          'ELIGIBLE','NO_REGISTRY_VERDICT','NULL_COORD','NULL_ISLAND',
          'INVALID_COORD','MULTI_COORD_UNRESOLVED')) bad_verdict_value,
       (select md5(string_agg(source_key||'|'||verdict, ',' order by source_key collate "C"))
          from v) fingerprint;""", "verdict completeness")[0]


def global_canonical_sweep_sql():
    """The S1->S2 global canonical sweep. SET-BASED, project-global, order-independent.

    EXECUTED BY EXACTLY ONE CALLER - sync_canonical(), the `sync-canonical` command. Never by
    a shard: shard processing is NOT responsible for snapshot transition, because a project
    that DISAPPEARS from the new PROVEN population is visited by no shard, so its stale pt:1
    would otherwise survive forever as if still eligible.

    Three set operations, each keyed on source_key alone - no z3, no shard order, no
    application-side row loop (723,449 HTTP operations is not an implementation):
      1 ELIGIBLE in S2      -> upsert pt:1 with the S2 coordinate and verdict_snapshot_id=S2.
      2 INELIGIBLE in S2    -> delete its pt:1 and replace its current reject with the S2 reason.
      3 ABSENT from S2      -> delete any proven point whose source_key has no S2 verdict row
                               at all (treatment change, or dropped from the population).
    Every statement is a no-op when already applied, so rerunning converges. RECOVERY geometry
    is never touched: each delete filters provenance='proven_stored_point'.

    PUBLICATION BARRIER: sync_canonical() runs this only after state='READY', and NULLs
    canonical_synced_at before the first statement executes. Until that timestamp is (re)set,
    assert_snapshot_consumable() refuses the snapshot, so no shard can observe a half-swept
    corpus. The statements need not share one transaction - the barrier is canonical_synced_at,
    which is why invalidation precedes mutation rather than following it."""
    return [
        (f"""insert into geo.n5_geom (source_key, registry_id, feature_id, outcome, geom,
                                      invalid_reason, first_z3, provenance, verdict_snapshot_id)
             select v.source_key, coalesce(v.registry_id,'(null)'), 'pt:1', 1,
                    ST_SetSRID(ST_MakePoint(v.lng, v.lat), {CANON_SRID}), null, null,
                    'proven_stored_point', {lit(SNAPSHOT)}
               from geo.n5_proven_verdict v
              where v.snapshot_id={lit(SNAPSHOT)} and v.verdict='ELIGIBLE'
             on conflict (source_key, feature_id) do update
                set geom = excluded.geom, registry_id = excluded.registry_id,
                    verdict_snapshot_id = excluded.verdict_snapshot_id, recovered_at = now();""",
         "sweep upsert eligible"),
        (f"""delete from geo.n5_geom g using geo.n5_proven_verdict v
              where v.snapshot_id={lit(SNAPSHOT)} and v.verdict<>'ELIGIBLE'
                and g.source_key=v.source_key and g.feature_id='pt:1'
                and g.provenance='proven_stored_point';""", "sweep delete ineligible"),
        (f"""delete from geo.n5_geom g
              where g.provenance='proven_stored_point' and g.feature_id='pt:1'
                and not exists (select 1 from geo.n5_proven_verdict v
                                 where v.snapshot_id={lit(SNAPSHOT)} and v.source_key=g.source_key);""",
         "sweep delete absent"),
        (f"""insert into geo.n5_point_reject (source_key, registry_id, lat, lng, reason,
                                              observed_in_z3, verdict_snapshot_id)
             select v.source_key, v.registry_id, v.lat, v.lng, v.verdict, null, {lit(SNAPSHOT)}
               from geo.n5_proven_verdict v
              where v.snapshot_id={lit(SNAPSHOT)} and v.verdict<>'ELIGIBLE'
             on conflict (source_key) do update
                set reason=excluded.reason, registry_id=excluded.registry_id,
                    lat=excluded.lat, lng=excluded.lng,
                    verdict_snapshot_id=excluded.verdict_snapshot_id, rejected_at=now();""",
         "sweep reject sync"),
        (f"""delete from geo.n5_point_reject r using geo.n5_proven_verdict v
              where v.snapshot_id={lit(SNAPSHOT)} and v.verdict='ELIGIBLE'
                and r.source_key=v.source_key;""", "sweep reject clear"),
        # 4  ABSENT from S2 -> drop the stale reject too. Without this a project that left the
        #    PROVEN population keeps asserting a CURRENT reason forever, and post-sweep reject
        #    set equality (rejected-not-ineligible) could never reach zero.
        (f"""delete from geo.n5_point_reject r
              where not exists (select 1 from geo.n5_proven_verdict v
                                 where v.snapshot_id={lit(SNAPSHOT)} and v.source_key=r.source_key);""",
         "sweep reject drop absent"),
    ]


def refresh_proven_verdict_sql():
    """Rebuild the PROJECT-GLOBAL PROVEN verdict from the authoritative frozen baseline.

    AUTHORITATIVE SOURCE: preservation.app_project_identity, filtered to the run snapshot and
    record_kind='development', joined to geo.n5_accepted_source for the registry verdict. This
    is the relation that yields the corrected 723,449 PROVEN source_key population. Global
    multiplicity is NOT derived from ZIP3-local geo.n5_frozen, and NOT from app_projects page
    rows (3.21 rows per project - a page-materialization count, not project grain).

    NOT RUN AUTOMATICALLY, AND NOT BY A SHARD. Its only caller is publish_verdict(), the
    `publish-verdict` command, which an operator invokes deliberately: this is a full pass
    over a 1,125 MB table - see REMAINING APPLY GATES in PR #1016.

    Coordinate pairs are DISTINCT OBSERVED pairs: both values non-null on the SAME row, so a
    latitude from one row can never be paired with a longitude from another."""
    return f"""
delete from geo.n5_proven_verdict where snapshot_id={lit(SNAPSHOT)};
insert into geo.n5_proven_verdict (snapshot_id, source_key, registry_id, ncoord, lat, lng, verdict)
with src as (
  select i.source_key, coalesce(i.registry_id,'(null)') registry_id, i.lat, i.lng
    from preservation.app_project_identity i
   where i.snapshot_id={lit(SNAPSHOT)} and i.record_kind='development'),
verdict_reg as (select registry_id from geo.n5_accepted_source where treatment='PROVEN'),
proven as (select distinct s.source_key, s.registry_id from src s
            where exists (select 1 from verdict_reg v where v.registry_id = s.registry_id)),
pairs as (select distinct source_key, lat, lng from src
           where lat is not null and lng is not null),
cnt as (select p.source_key, (select count(*) from pairs q where q.source_key=p.source_key) ncoord
          from proven p),
sel as (select pr.source_key, pr.lat, pr.lng
          from pairs pr join cnt c on c.source_key=pr.source_key and c.ncoord=1)
select {lit(SNAPSHOT)}, p.source_key, p.registry_id, c.ncoord, sl.lat, sl.lng,
       case when c.ncoord > 1                            then 'MULTI_COORD_UNRESOLVED'
            when c.ncoord = 0                            then 'NULL_COORD'
            when sl.lat not between -90 and 90
              or sl.lng not between -180 and 180         then 'INVALID_COORD'
            when abs(sl.lat) < 1e-9 and abs(sl.lng) < 1e-9 then 'NULL_ISLAND'
            else 'ELIGIBLE' end
  from proven p join cnt c using (source_key) left join sel sl using (source_key);"""


# ------------------------------------------------- verdict publication pipeline
#
# THE ONLY VALID ORDER. Each arrow is a barrier, not a suggestion:
#
#   BUILDING -> BUILD VERDICT -> VALIDATE -> RECORD COMPLETENESS -> READY
#            -> CANONICAL SWEEP -> VERIFY CANONICAL SETS -> CANONICAL SYNC COMPLETE
#
# Two commands implement it, split exactly where the two claims differ:
#   publish_verdict()  BUILDING .. READY               "the verdict is complete and readable"
#   sync_canonical()   sweep .. canonical_synced_at     "canonical geometry matches that verdict"
# A shard requires BOTH (assert_snapshot_consumable). Nothing else writes either state.


def publish_verdict():
    """BUILDING -> BUILD -> VALIDATE -> RECORD COMPLETENESS -> READY, for THIS snapshot only.

    SET-REPLACEMENT SEMANTICS, snapshot-scoped: every write below is filtered to SNAPSHOT, so
    republishing S1 cannot read, alter or invalidate S2's verdict. There is no truncate.

    FAIL-CLOSED: the manifest is reset to BUILDING with canonical_synced_at NULL as the FIRST
    durable act, so an interrupted publish leaves a snapshot that assert_snapshot_consumable()
    refuses. READY is written once, at the end, in the same statement that records the metrics
    the READY constraint requires - it is never claimed ahead of the evidence for it.

    The verdict rebuild's delete+insert is one HTTP call, but this function does NOT depend on
    that being one transaction: a partially rebuilt verdict fails the completeness check below
    (missing/extra/closure), records FAILED, and never reaches READY. The barrier is the state
    machine, not the transport."""
    require_snapshot()
    assert_frozen_input_present()

    # 1 - BUILDING. Clears every completeness metric and the canonical sync barrier: a stale
    #     READY must never survive a rebuild of the verdict underneath it.
    sql(f"""insert into geo.n5_verdict_manifest
              (snapshot_id, state, expected_source_keys, verdict_rows, eligible_rows,
               reject_counts, fingerprint, started_at, completed_at, canonical_synced_at)
            values ({lit(SNAPSHOT)}, 'BUILDING', null, null, null, null, null, now(), null, null)
            on conflict (snapshot_id) do update
               set state='BUILDING', expected_source_keys=null, verdict_rows=null,
                   eligible_rows=null, reject_counts=null, fingerprint=null,
                   started_at=now(), completed_at=null, canonical_synced_at=null;""",
        "manifest BUILDING")
    say("verdict state", f"BUILDING  ({SNAPSHOT})")

    # 2 - BUILD. Full snapshot-scoped set replacement of the verdict rows.
    sql(refresh_proven_verdict_sql(), "build verdict " + SNAPSHOT)

    # 3 - VALIDATE. Completeness is ENFORCED here, not merely reported.
    v = validate_verdict_completeness()
    for k in ("expected_source_keys", "verdict_rows", "eligible_rows", "rejected_rows",
              "missing", "extra", "multi_coord", "malformed", "bad_verdict_value"):
        say("  " + k, v[k])
    problems = []
    if v["expected_source_keys"] is None or int(v["expected_source_keys"]) == 0:
        problems.append("expected_source_keys is null/zero - the frozen input yielded no "
                        "PROVEN population")
    if int(v["missing"]) != 0:
        problems.append(f"{v['missing']} authoritative source_key(s) have no verdict row")
    if int(v["extra"]) != 0:
        problems.append(f"{v['extra']} verdict row(s) are not in the authoritative population")
    if int(v["verdict_rows"]) != int(v["verdict_distinct"]):
        problems.append(f"verdict rows {v['verdict_rows']} != distinct source_keys "
                        f"{v['verdict_distinct']}")
    if int(v["verdict_rows"]) != int(v["expected_source_keys"] or -1):
        problems.append(f"verdict_rows {v['verdict_rows']} != expected "
                        f"{v['expected_source_keys']}")
    if int(v["eligible_rows"]) + int(v["rejected_rows"]) != int(v["verdict_rows"]):
        problems.append("eligible + rejected does not close on verdict_rows")
    if v["fingerprint"] is None:
        problems.append("fingerprint is null")
    if v["reject_counts"] is None:
        problems.append("reject_counts is null")
    if int(v["malformed"]) != 0:
        problems.append(f"{v['malformed']} verdict row(s) are malformed for their own verdict")
    if int(v["bad_verdict_value"]) != 0:
        problems.append(f"{v['bad_verdict_value']} verdict row(s) carry a value outside the "
                        f"declared vocabulary")
    if problems:
        # FAILED is safe to record: canonical_synced_at is already NULL, so the snapshot stays
        # unconsumable either way. If even this write fails, the row remains BUILDING - also
        # unconsumable. There is no path from here that reaches READY.
        sql(f"""update geo.n5_verdict_manifest set state='FAILED', completed_at=now()
                 where snapshot_id={lit(SNAPSHOT)};""", "manifest FAILED")
        raise SystemExit("STOP: verdict completeness FAILED for " + SNAPSHOT + " - "
                         + "; ".join(problems) + ". State=FAILED, canonical_synced_at NULL, "
                         "no sweep performed.")

    # 4 - RECORD COMPLETENESS **and** transition to READY in ONE statement. Recording the
    #     metrics in a separate earlier statement would leave a window in which they are
    #     durable but the state is not, and the constraint that ties them together is the
    #     only thing keeping "READY" honest.
    sql(f"""update geo.n5_verdict_manifest
               set state='READY', completed_at=now(),
                   expected_source_keys={int(v['expected_source_keys'])},
                   verdict_rows={int(v['verdict_rows'])},
                   eligible_rows={int(v['eligible_rows'])},
                   reject_counts={lit(json.dumps(v['reject_counts']))}::jsonb,
                   fingerprint={lit(v['fingerprint'])}
             where snapshot_id={lit(SNAPSHOT)} and state='BUILDING';""", "manifest READY")
    # READ BACK from the DB and reconcile the STORED metrics against the derivation. A count
    # computed and a count durably written are different facts (CLAUDE.md rule 8): a truncated
    # or garbled jsonb write would otherwise sit under a READY row looking authoritative.
    chk = sql(f"""select state, canonical_synced_at is null unsynced, verdict_rows, fingerprint,
                    (select sum(value::bigint) from jsonb_each_text(reject_counts)) count_sum,
                    coalesce((reject_counts->>'ELIGIBLE')::bigint, 0) stored_eligible
                    from geo.n5_verdict_manifest where snapshot_id={lit(SNAPSHOT)};""",
              "manifest verify")[0]
    if str(chk["state"]) != "READY":
        raise SystemExit(f"STOP: manifest for {SNAPSHOT} did not reach READY (state="
                         f"{chk['state']}). Another writer changed it mid-publish.")
    if int(chk["count_sum"] or -1) != int(v["verdict_rows"]):
        raise SystemExit(f"STOP: stored reason counts for {SNAPSHOT} sum to {chk['count_sum']}, "
                         f"not verdict_rows {v['verdict_rows']}. The written metrics do not "
                         f"reconcile with the derivation.")
    if int(chk["stored_eligible"]) != int(v["eligible_rows"]):
        raise SystemExit(f"STOP: stored ELIGIBLE count {chk['stored_eligible']} != "
                         f"eligible_rows {v['eligible_rows']} for {SNAPSHOT}.")
    if str(chk["fingerprint"]) != str(v["fingerprint"]):
        raise SystemExit(f"STOP: stored fingerprint for {SNAPSHOT} does not match the "
                         f"derivation. The manifest was not written as computed.")
    say("verdict state", "READY  (canonical sweep NOT yet run)")
    say("verdict fingerprint", v["fingerprint"])
    return v


def verify_canonical_geometry_sets():
    """Post-sweep SET EQUALITY between the verdict's ELIGIBLE set and canonical proven points.

    Both directions, plus coordinate equality and snapshot attribution. A one-directional
    check passes while canonical geometry still holds points the new verdict rejects."""
    return sql(f"""
with elig as (select source_key, lat, lng from geo.n5_proven_verdict
               where snapshot_id={lit(SNAPSHOT)} and verdict='ELIGIBLE'),
     -- The slot is claimed by EITHER marker, deliberately: an OR (not an AND) also catches a
     -- recovered row squatting 'pt:1' and a proven row filed under some other feature_id.
     -- Relying on the biconditional CHECK would verify the constraint, not the sweep - and
     -- that constraint is not applied yet.
     can  as (select source_key, feature_id, provenance, geom, verdict_snapshot_id
                from geo.n5_geom
               where provenance='proven_stored_point' or feature_id='pt:1')
select (select count(*) from (select source_key from elig
                              except select source_key from can) t) eligible_not_canonical,
       (select count(*) from (select source_key from can
                              except select source_key from elig) t) canonical_not_eligible,
       (select count(*) from elig e join can c using (source_key)
         where c.geom is null
            or abs(ST_X(c.geom) - e.lng) > 1e-9
            or abs(ST_Y(c.geom) - e.lat) > 1e-9) coord_mismatch,
       (select count(*) from can where feature_id is distinct from 'pt:1') wrong_feature_id,
       (select count(*) from can
         where provenance is distinct from 'proven_stored_point') wrong_provenance,
       (select count(*) from can
         where verdict_snapshot_id is distinct from {lit(SNAPSHOT)}) wrong_snapshot;""",
               "verify geometry sets")[0]


def verify_canonical_reject_sets():
    """Post-sweep SET EQUALITY between the verdict's INELIGIBLE set and the reject ledger.

    Both directions, reason equality, snapshot attribution, and the cross-check that no
    ELIGIBLE project is simultaneously carrying a rejection."""
    return sql(f"""
with inel as (select source_key, verdict from geo.n5_proven_verdict
               where snapshot_id={lit(SNAPSHOT)} and verdict<>'ELIGIBLE'),
     elig as (select source_key from geo.n5_proven_verdict
               where snapshot_id={lit(SNAPSHOT)} and verdict='ELIGIBLE'),
     rej  as (select source_key, reason, verdict_snapshot_id from geo.n5_point_reject)
select (select count(*) from (select source_key from inel
                              except select source_key from rej) t) ineligible_not_rejected,
       (select count(*) from (select source_key from rej
                              except select source_key from inel) t) rejected_not_ineligible,
       (select count(*) from inel i join rej r using (source_key)
         where r.reason is distinct from i.verdict) reason_mismatch,
       (select count(*) from rej
         where verdict_snapshot_id is distinct from {lit(SNAPSHOT)}) wrong_snapshot,
       (select count(*) from elig e join rej r using (source_key)) eligible_still_rejected;""",
               "verify reject sets")[0]


def sync_canonical():
    """CANONICAL SWEEP -> VERIFY CANONICAL SETS -> CANONICAL SYNC COMPLETE.

    THE ONLY WRITER OF canonical_synced_at ANYWHERE. It is set in exactly one statement, at
    the end, only after both set-equality verifications return all zeroes.

    INVALIDATION IS THE FIRST DURABLE ACT of every attempt, before any mutation. The moment
    the corpus starts moving, the previous 'synced' claim is false - so it is retracted first
    rather than left standing while the sweep runs. Deliberately NOT a finally/cleanup path: a
    process killed mid-sweep never reaches finally, and the whole point is that a half-swept
    corpus must not remain marked synced."""
    require_snapshot()
    man = sql(f"""select state, expected_source_keys, verdict_rows
                    from geo.n5_verdict_manifest where snapshot_id={lit(SNAPSHOT)};""",
              "sync manifest")
    if not man:
        raise SystemExit(f"STOP: no verdict manifest for {SNAPSHOT}. Publish the verdict first.")
    man = man[0]
    if str(man["state"]) != "READY":
        raise SystemExit(f"STOP: verdict for {SNAPSHOT} is state={man['state']}, not READY. "
                         f"The canonical sweep may only run against a published verdict.")
    if man["expected_source_keys"] is None or \
            int(man["verdict_rows"]) != int(man["expected_source_keys"]):
        raise SystemExit(f"STOP: manifest for {SNAPSHOT} is internally inconsistent - "
                         f"verdict_rows={man['verdict_rows']} "
                         f"expected={man['expected_source_keys']}.")

    # INVALIDATE FIRST - before a single row of canonical geometry moves.
    sql(f"""update geo.n5_verdict_manifest set canonical_synced_at=null
             where snapshot_id={lit(SNAPSHOT)};""", "sync invalidate")
    say("canonical_synced_at", "NULL (invalidated before sweep)")

    for stmt, tag in global_canonical_sweep_sql():
        sql(stmt, tag)

    g = verify_canonical_geometry_sets()
    r = verify_canonical_reject_sets()
    GEOM_CHECKS = ("eligible_not_canonical", "canonical_not_eligible", "coord_mismatch",
                   "wrong_feature_id", "wrong_provenance", "wrong_snapshot")
    for k in GEOM_CHECKS:
        say("  geometry " + k, g[k])
    for k in ("ineligible_not_rejected", "rejected_not_ineligible", "reason_mismatch",
              "wrong_snapshot", "eligible_still_rejected"):
        say("  reject " + k, r[k])
    bad = [f"geometry.{k}={g[k]}" for k in GEOM_CHECKS if int(g[k]) != 0]
    bad += [f"reject.{k}={r[k]}" for k in
            ("ineligible_not_rejected", "rejected_not_ineligible", "reason_mismatch",
             "wrong_snapshot", "eligible_still_rejected") if int(r[k]) != 0]
    if bad:
        raise SystemExit("HALT: canonical sets do not match the verdict for " + SNAPSHOT
                         + " - " + "; ".join(bad) + ". canonical_synced_at REMAINS NULL, so "
                         "no shard can consume this snapshot. Investigate before retrying.")

    sql(f"""update geo.n5_verdict_manifest set canonical_synced_at = now()
             where snapshot_id={lit(SNAPSHOT)} and state='READY';""", "canonical sync complete")
    done = sql(f"""select canonical_synced_at is not null synced from geo.n5_verdict_manifest
                    where snapshot_id={lit(SNAPSHOT)};""", "sync verify")[0]
    if not done["synced"]:
        raise SystemExit(f"STOP: canonical sync for {SNAPSHOT} did not commit; the snapshot "
                         f"remains unconsumable.")
    say("canonical_synced_at", "SET - shards may now consume " + SNAPSHOT)
    return {"geometry": g, "rejects": r}


def materialize_proven_points(z3):
    """Bring canonical PROVEN geometry and current reject state into line with the GLOBAL verdict.

    OWNERSHIP: a canonical proven_stored_point is owned by source_key, never by z3. Measured
    2026-09-02: 72,856 of 723,449 PROVEN source_keys (10.1%) appear in more than one z3 - up to
    12 shards, 217 page ZIPs. So nothing here is keyed, filtered or deleted by z3.

    ORDER INDEPENDENCE: every write below is a function of (source_key, global verdict) alone.
    The verdict is shard-independent, so shard A and shard B compute the identical action for a
    shared source_key, and each action is idempotent (upsert / delete-if-present). Processing
    A then B therefore leaves exactly the state of B then A.

    JURISDICTION: deliberately absent. There is no authoritative project-level jurisdiction in
    the corpus - preservation.app_project_identity.zip is the ZIP PAGE a project was
    materialized onto (up to 217 per project), not an address ZIP. Validating against it, or
    against 'any ZCTA in the shard', would fabricate a check from the wrong field.
    OUTSIDE_JURISDICTION stays reserved in the vocabulary and is NEVER emitted by v1."""
    # A row-count check is NOT a readiness check: a half-built snapshot has rows > 0 and would
    # pass it. Require the published state instead.
    assert_snapshot_consumable()

    scope = f"""
with slice as (select distinct source_key from geo.n5_frozen
                where z3={lit(z3)} and treatment='PROVEN'),
v as (select vv.* from geo.n5_proven_verdict vv join slice s using (source_key)
       where vv.snapshot_id={lit(SNAPSHOT)})"""

    # ELIGIBLE -> insert, or UPDATE the geometry if the authoritative coordinate changed.
    sql(scope + """
insert into geo.n5_geom (source_key, registry_id, feature_id, outcome, geom,
                         invalid_reason, first_z3, provenance, verdict_snapshot_id)
select v.source_key, coalesce(v.registry_id,'(null)'), 'pt:1', 1,
       ST_SetSRID(ST_MakePoint(v.lng, v.lat), """ + str(CANON_SRID) + f"""),
       null, {lit(z3)}, 'proven_stored_point', {lit(SNAPSHOT)}
  from v where v.verdict='ELIGIBLE'
on conflict (source_key, feature_id) do update
   set geom = excluded.geom, registry_id = excluded.registry_id,
       verdict_snapshot_id = excluded.verdict_snapshot_id, recovered_at = now();""",
        "proven upsert " + z3)

    # INELIGIBLE -> remove any stale canonical point. Scoped to this source_key AND to the
    # proven slot, so RECOVERY geometry is never touched and no other project is affected.
    sql(scope + """
delete from geo.n5_geom g
 using v
 where g.source_key = v.source_key and g.feature_id = 'pt:1'
   and g.provenance = 'proven_stored_point' and v.verdict <> 'ELIGIBLE';""",
        "proven prune " + z3)

    # CURRENT reject state: an eligible project must hold no reject row at all, and an
    # ineligible one holds exactly its current reason. Both directions, so a fixed project
    # stops reporting a stale reason and a newly broken one starts reporting the real one.
    sql(scope + """
delete from geo.n5_point_reject r using v
 where r.source_key = v.source_key and v.verdict = 'ELIGIBLE';""",
        "reject clear " + z3)
    sql(scope + f"""
insert into geo.n5_point_reject (source_key, registry_id, lat, lng, reason,
                                 observed_in_z3, verdict_snapshot_id)
select v.source_key, v.registry_id, v.lat, v.lng, v.verdict, {lit(z3)}, {lit(SNAPSHOT)}
  from v where v.verdict <> 'ELIGIBLE'
on conflict (source_key) do update
   set reason = excluded.reason, registry_id = excluded.registry_id,
       lat = excluded.lat, lng = excluded.lng, observed_in_z3 = excluded.observed_in_z3,
       verdict_snapshot_id = excluded.verdict_snapshot_id, rejected_at = now();""",
        "reject write " + z3)

    return one(sql(scope + """
select (select count(*) from v where verdict='ELIGIBLE') materialized,
       (select count(*) from v where verdict<>'ELIGIBLE') rejected;""",
                   "proven counts " + z3), None)


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
    and the swap is a full scoped replacement, never an append.

    GATED DIRECTLY, not by its caller. build_associations reads geo.n5_proven_verdict for the
    run snapshot, so this function is a consumer of the published verdict in its own right; a
    gate that lives only in run_shard protects nothing if associate() is ever called from a
    repair path, a notebook, or a future driver."""
    assert_snapshot_consumable()
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

    # 0 - SNAPSHOT GATE. Refuse before any freeze/recovery/materialization/association work
    #     unless THIS run's exact snapshot is READY and canonically synchronized.
    assert_snapshot_consumable()

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
              "free_mb": round(free, 1), "verified": verified, "disk_ok": disk_ok,
              # Input snapshot and verdict snapshot are the same identifier in this
              # architecture; recording it proves WHICH eligibility universe produced these
              # associations, without widening 20,170 association rows.
              "verdict_snapshot_id": SNAPSHOT}

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

    # SNAPSHOT GATE BEFORE ANY DURABLE MUTATION, including the shard status flag. Marking a
    # shard 'running' and only then discovering the snapshot is unpublished leaves a shard
    # stranded in 'running' - neither done nor halted - which a resume silently skips while
    # the run reports no failure. run_shard() re-asserts the same gate; this one exists so
    # the refusal happens before the first write rather than after it.
    assert_snapshot_consumable()
    say("snapshot gate", f"{SNAPSHOT} READY and canonically synced")

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


COMMANDS = {
    # ONE entry point per publication act. The order between them is enforced by state, not by
    # documentation: sync-canonical refuses a non-READY verdict, and shards refuse an unsynced
    # one, so running them out of order fails rather than half-publishes.
    "publish-verdict": publish_verdict,   # BUILDING -> BUILD -> VALIDATE -> RECORD -> READY
    "sync-canonical": sync_canonical,     # invalidate -> sweep -> verify sets -> synced
    "shards": main,                       # consume a published+synced snapshot, shard by shard
}


def cli(argv):
    cmd = (argv[1] if len(argv) > 1 else "shards").strip()
    if cmd not in COMMANDS:
        raise SystemExit("STOP: unknown command %r. One of: %s"
                         % (cmd, ", ".join(sorted(COMMANDS))))
    require_snapshot()
    say("command", cmd)
    rc = COMMANDS[cmd]()
    return rc if isinstance(rc, int) else 0


if __name__ == "__main__":
    sys.exit(cli(sys.argv) or 0)

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
    from an earlier shard is a cache HIT and is not refetched.

    CANONICAL DATA - geo.n5_geom is no longer RECOVERY-only. This path writes
    provenance='recovered_authoritative'; the PROVEN materialisation writes
    'proven_stored_point' with feature_id 'pt:1' ('pt:2' and beyond are RESERVED and
    UNDEFINED - no code path emits them). PRESENCE IN THE TABLE IS THEREFORE NO LONGER A
    TREATMENT GATE; `provenance` is. The column is NOT NULL with NO DEFAULT on purpose, so
    a new writer must state which kind of geometry it is writing rather than inheriting one
    by omission. Rows are never refreshed (ON CONFLICT DO NOTHING), so the FIRST acquisition
    is the durable vintage in recovered_at - which is also why deleting rows from this table
    is what would break vintage, not writing to it."""
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
            "select distinct source_key from geo.n5_geom where source_key in ("
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
    # A registry-wide acquisition has no originating shard, and `lit(None)` would write
    # the literal string 'None' into a char(3) column rather than SQL NULL - i.e. a
    # fabricated provenance value that looks like a ZIP3. Emit NULL instead.
    z3sql = lit(z3) if z3 else "null"
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
            rows.append(f"({lit(sk)},{lit(rid)},{lit(oid)},3,null,{lit(reason)},{z3sql},"
                        f"'recovered_authoritative')")
        else:
            # Dollar-quoted, as the pilot loaders do: a polygon WKT runs to tens of
            # thousands of characters and must not be re-escaped per quote.
            rows.append(f"({lit(sk)},{lit(rid)},{lit(oid)},1,"
                        f"ST_GeomFromText($g${wkt}$g$,{CANON_SRID}),null,{z3sql},"
                        f"'recovered_authoritative')")
    # Batch by BYTES, not by row count. 25 rows was a count-only cap, and a single polygon
    # WKT runs to tens of thousands of characters - so 25 dense rings is megabytes and the
    # Management API answers HTTP 413 "request entity too large". That is what halted shard
    # 891 (45 ZIPs / 28,596 boundary vertices) with the batch already assembled.
    #
    # 413 is deliberately NOT retried by sql() - only 429 is - so the shard stopped clean
    # and reverted rather than half-committing. The fix belongs here, in how the statement
    # is sized, not in the retry policy.
    #
    # Row count stays capped too: the byte budget alone would send one enormous statement
    # for many tiny points, and the count cap alone is what just failed. Both, and-not-or.
    _MAX_BYTES = 4_000_000   # well under the observed limit, measured on the real payload
    _MAX_ROWS = 25
    batch, nbytes = [], 0
    def _flush():
        if not batch:
            return
        sql("insert into geo.n5_geom (source_key,registry_id,feature_id,outcome,geom,"
            "invalid_reason,first_z3,provenance) values " + ",".join(batch)
            + " on conflict (source_key,feature_id) do nothing;", "geom ins")
        batch.clear()
    for r in rows:
        rb = len(r.encode("utf-8"))
        # A single row wider than the budget cannot be split - send it alone and let the
        # server be the judge, rather than silently dropping it.
        if batch and (nbytes + rb > _MAX_BYTES or len(batch) >= _MAX_ROWS):
            _flush()
            nbytes = 0
        batch.append(r)
        nbytes += rb
    _flush()
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


def associate(z3):
    q = build_associations(z3) + """
insert into geo.n5_association (source_key, zip, evidence)
select source_key, zip::char(5), ev from (select * from cls union all select * from adds) z
on conflict do nothing;"""
    sql(q, "associate " + z3)


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

    # 3 - RECOVER (cache is cross-shard; hit rate is measured, not assumed)
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

    # 4 - ASSOCIATE
    before = shard_counts(z3)
    associate(z3)
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
    #     geo.n5_geom is deliberately NOT discarded: it is the cross-shard geometry cache.
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
    cache = sql("select count(*) feats, count(distinct source_key) projects, "
                "pg_size_pretty(pg_total_relation_size('geo.n5_geom')) sz from geo.n5_geom;", "cache")[0]
    say("geometry cache", f"{cache['feats']} features / {cache['projects']} projects / {cache['sz']}")
    say("publisher requests this run", STATS["requests"])
    say("publisher bytes this run", f"{STATS['bytes_in']:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)

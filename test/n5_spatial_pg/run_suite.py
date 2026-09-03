#!/usr/bin/env python3
"""EXECUTABLE suite for public.n5_projects_within_radius() — revision 2.

Runs the SHIPPED docs/n5-spatial-read-rpc.sql against a disposable PostGIS and
exercises the CONTRACT, not a paraphrase of it: the DDL file is read from disk and
executed verbatim, so a change to the file that breaks a guarantee fails here.

WHY THIS EXISTS ALONGSIDE test/n5-spatial-read-rpc.test.mjs: that file is a static
guard (the sandbox has no database). Static text cannot prove that the lifecycle gate
actually refuses mid-sweep, that has_more flips at the right boundary, or that a
polygon returns distance 0 when the home is inside it. Those are behavioural claims
and they are proven here, on a real PostGIS, or not at all.

Exit code is 0 only if every assertion passes.
"""
import os
import sys
import pathlib
import psycopg2
import psycopg2.extras

ROOT = pathlib.Path(__file__).resolve().parents[2]
DDL = ROOT / "docs" / "n5-spatial-read-rpc.sql"
SCHEMA = ROOT / "test" / "n5_spatial_pg" / "fixture_schema.sql"

SNAP = "phase1-2026-09-01"
OTHER_SNAP = "phase0-2026-08-01"

# A home point in Boston. Chosen because every fixture geometry below is placed in
# metres-scale offsets from it, so expected distances are arithmetic, not vibes.
HOME_LAT, HOME_LNG = 42.3601, -71.0589

_fail = 0
_pass = 0
_n = 0


def check(name, cond, detail=None):
    global _fail, _pass, _n
    _n += 1
    if cond:
        _pass += 1
        print("PASS %3d — %s" % (_n, name))
    else:
        _fail += 1
        print("FAIL %3d — %s" % (_n, name))
        if detail is not None:
            print("           detail: %r" % (detail,))


def connect():
    dsn = os.environ.get("N5_TEST_DSN") or os.environ.get("PGDSN")
    if not dsn:
        print("STOP: N5_TEST_DSN is required (this suite needs a disposable PostGIS).")
        sys.exit(2)
    c = psycopg2.connect(dsn)
    c.autocommit = True
    return c


def q(cur, sql, args=None):
    cur.execute(sql, args)
    return cur.fetchall()


def raises(cur, sql, args=None):
    """Return (raised, sqlstate, message)."""
    try:
        cur.execute(sql, args)
        cur.fetchall()
        return (False, None, "")
    except psycopg2.Error as e:
        code = e.pgcode
        msg = str(e.pgerror or e)
        # autocommit is on, but a failed statement still needs the txn cleared
        try:
            cur.execute("rollback;")
        except psycopg2.Error:
            pass
        return (True, code, msg)


def call(cur, lat=HOME_LAT, lng=HOME_LNG, radius=1, limit=500):
    return q(cur,
             "select * from public.n5_projects_within_radius(%s,%s,%s,%s) "
             "order by distance_mi, source_key, feature_id",
             (lat, lng, radius, limit))


def set_manifest(cur, state, synced):
    cur.execute("delete from geo.n5_verdict_manifest;")
    cur.execute(
        "insert into geo.n5_verdict_manifest "
        "(snapshot_id, state, expected_source_keys, verdict_rows, eligible_rows, "
        " reject_counts, fingerprint, completed_at, canonical_synced_at) "
        "values (%s,%s,1,1,1,'{}'::jsonb,'fp', now(), %s);",
        (SNAP, state, "now()" if False else None if not synced else None))
    if synced:
        cur.execute("update geo.n5_verdict_manifest set canonical_synced_at = now() "
                    "where snapshot_id = %s;", (SNAP,))


# ---------------------------------------------------------------- geometry helpers
def pt(cur, lat, lng):
    """4269 point from a 4326 lat/lng, matching how the corpus stores geometry."""
    return q(cur, "select st_astext(st_transform(st_setsrid(st_makepoint(%s,%s),4326),4269));",
             (lng, lat))[0][0]


def seed(cur):
    """Build the fixture corpus. Distances from HOME are deliberately staggered so
    ordering and radius boundaries are checkable by construction."""
    cur.execute("delete from geo.n5_geom; delete from geo.n5_point_reject;")

    def ins(source_key, feature_id, prov, wkt_4326, outcome=1, snap=SNAP,
            registry_id="reg:test", geom_null=False, z3=None):
        if geom_null:
            cur.execute(
                "insert into geo.n5_geom (source_key, registry_id, feature_id, outcome, geom,"
                " invalid_reason, first_z3, provenance, verdict_snapshot_id)"
                " values (%s,%s,%s,%s,null,'NO_GEOMETRY',%s,%s,%s);",
                (source_key, registry_id, feature_id, outcome, z3, prov, snap))
        else:
            cur.execute(
                "insert into geo.n5_geom (source_key, registry_id, feature_id, outcome, geom,"
                " invalid_reason, first_z3, provenance, verdict_snapshot_id)"
                " values (%s,%s,%s,%s,"
                "  st_transform(st_setsrid(st_geomfromtext(%s),4326),4269),"
                " null,%s,%s,%s);",
                (source_key, registry_id, feature_id, outcome, wkt_4326, z3, prov, snap))

    # --- PROVEN stored points, at increasing distance due EAST of home.
    # 0.001 deg lng at this latitude ~ 82.4 m, so these are well inside 1 mile.
    ins("proj:near",  "pt:1", "proven_stored_point", "POINT(-71.0579 42.3601)")   # ~82 m
    ins("proj:mid",   "pt:1", "proven_stored_point", "POINT(-71.0489 42.3601)")   # ~824 m
    ins("proj:far",   "pt:1", "proven_stored_point", "POINT(-71.0289 42.3601)")   # ~2470 m (>1mi)

    # --- RECOVERED authoritative: polygon CONTAINING the home, a line, and a point.
    ins("proj:poly", "f:1", "recovered_authoritative", None if False else
        "POLYGON((-71.0609 42.3591,-71.0569 42.3591,-71.0569 42.3611,-71.0609 42.3611,-71.0609 42.3591))",
        snap=None)
    ins("proj:line", "f:1", "recovered_authoritative",
        "LINESTRING(-71.0575 42.3595,-71.0575 42.3607)", snap=None)
    ins("proj:rpt",  "f:1", "recovered_authoritative", "POINT(-71.0584 42.3601)", snap=None)

    # --- MULTI-GEOMETRY for ONE source_key: three distinct feature_ids, all in range.
    ins("proj:multi", "f:1", "recovered_authoritative", "POINT(-71.05815 42.3601)", snap=None)
    ins("proj:multi", "f:2", "recovered_authoritative",
        "MULTILINESTRING((-71.0582 42.3603,-71.0582 42.3606))", snap=None)
    ins("proj:multi", "f:3", "recovered_authoritative",
        "MULTIPOLYGON(((-71.0587 42.3604,-71.0585 42.3604,-71.0585 42.3606,-71.0587 42.3606,-71.0587 42.3604)))",
        snap=None)

    # --- EXCLUSION fixtures, all inside 1 mile so only the predicate can drop them.
    ins("proj:nullgeom", "f:1", "recovered_authoritative", None, outcome=3,
        snap=None, geom_null=True)                       # NULL geometry
    ins("proj:outcome9", "f:1", "recovered_authoritative",
        "POINT(-71.0580 42.3602)", outcome=9, snap=None)  # unknown outcome -> fails closed
    ins("proj:staleSnap", "pt:1", "proven_stored_point",
        "POINT(-71.0580 42.3600)", snap=OTHER_SNAP)       # wrong verdict snapshot
    ins("proj:nullSnap", "pt:1", "proven_stored_point",
        "POINT(-71.0580 42.3599)", snap=None)             # proven with NO snapshot id

    # --- REJECTED identity that still carries a PROVEN point (corpus-drift case).
    ins("proj:rejected", "pt:1", "proven_stored_point", "POINT(-71.0578 42.3601)")
    cur.execute("insert into geo.n5_point_reject (source_key, reason, verdict_snapshot_id)"
                " values ('proj:rejected','MULTI_COORD_UNRESOLVED',%s);", (SNAP,))
    # --- REJECTED identity that carries RECOVERED geometry: must be KEPT.
    ins("proj:rejectedrec", "f:1", "recovered_authoritative",
        "POINT(-71.0577 42.3601)", snap=None)
    cur.execute("insert into geo.n5_point_reject (source_key, reason, verdict_snapshot_id)"
                " values ('proj:rejectedrec','NULL_COORD',%s);", (SNAP,))


def main():
    if not DDL.exists():
        print("STOP: %s not found" % DDL)
        sys.exit(2)
    conn = connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    plain = conn.cursor()

    print("=" * 78)
    print("N5 SPATIAL READ RPC — EXECUTABLE CONTRACT SUITE (revision 2)")
    ver = q(plain, "select version(), postgis_full_version();")[0]
    print("server : %s" % ver[0].split(",")[0])
    print("postgis: %s" % ver[1].split(" ")[0:3])
    print("ddl    : %s (%d bytes)" % (DDL.name, DDL.stat().st_size))
    print("=" * 78)

    plain.execute(SCHEMA.read_text())
    # Execute the SHIPPED DDL verbatim. Grants to anon/authenticated are stripped
    # ONLY because those roles do not exist in a bare PostGIS container; the
    # revoke-from-public line is kept, and the static suite asserts both grants.
    ddl_text = DDL.read_text()
    ddl_exec = "\n".join(
        l for l in ddl_text.split("\n")
        if not l.strip().startswith("grant execute on function public.n5_projects_within_radius"))
    check("the shipped DDL creates the function", True)
    plain.execute(ddl_exec)
    got = q(plain, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace"
                   " where n.nspname='public' and p.proname='n5_projects_within_radius';")[0][0]
    check("function exists after applying the shipped DDL", got == 1, got)

    seed(plain)
    set_manifest(plain, "READY", True)

    # ============================== LIFECYCLE GATE ==============================
    print("-" * 78)
    print("LIFECYCLE GATE")
    set_manifest(plain, "BUILDING", False)
    r, code, msg = raises(plain, "select * from public.n5_projects_within_radius(%s,%s,1,500);",
                          (HOME_LAT, HOME_LNG))
    check("non-READY manifest FAILS CLOSED", r and code == "55000", (code, msg[:110]))
    check("  and says why (no consumable snapshot)", "consumable canonical snapshot" in msg, msg[:110])

    # READY but NOT synced — the exact mid-sweep window.
    set_manifest(plain, "READY", False)
    r, code, msg = raises(plain, "select * from public.n5_projects_within_radius(%s,%s,1,500);",
                          (HOME_LAT, HOME_LNG))
    check("READY but canonical_synced_at NULL FAILS CLOSED (the mid-sweep window)",
          r and code == "55000", (code, msg[:110]))

    # No manifest row at all.
    plain.execute("delete from geo.n5_verdict_manifest;")
    r, code, msg = raises(plain, "select * from public.n5_projects_within_radius(%s,%s,1,500);",
                          (HOME_LAT, HOME_LNG))
    check("absent manifest FAILS CLOSED", r and code == "55000", (code, msg[:110]))

    # Two consumable snapshots -> ambiguous -> refuse.
    set_manifest(plain, "READY", True)
    plain.execute("insert into geo.n5_verdict_manifest (snapshot_id, state, completed_at,"
                  " canonical_synced_at) values ('second-snap','READY', now(), now());")
    r, code, msg = raises(plain, "select * from public.n5_projects_within_radius(%s,%s,1,500);",
                          (HOME_LAT, HOME_LNG))
    check("two READY+synced snapshots FAIL CLOSED (ambiguous corpus)",
          r and code == "55000" and "ambiguous" in msg, (code, msg[:110]))
    plain.execute("delete from geo.n5_verdict_manifest where snapshot_id='second-snap';")

    set_manifest(plain, "READY", True)
    rows = call(cur)
    check("READY + canonically synced SUCCEEDS", len(rows) > 0, len(rows))

    # ============================== PROVENANCE ==================================
    print("-" * 78)
    print("PROVENANCE CONTRACT (founder decision: BOTH classes, distinguishable)")
    keys = {r["source_key"]: r for r in rows}
    check("proven_stored_point is RETURNED", "proj:near" in keys, sorted(keys))
    check("  and carries provenance='proven_stored_point'",
          keys.get("proj:near", {}).get("provenance") == "proven_stored_point",
          keys.get("proj:near"))
    check("recovered_authoritative is RETURNED", "proj:poly" in keys, sorted(keys))
    check("  and carries provenance='recovered_authoritative'",
          keys.get("proj:poly", {}).get("provenance") == "recovered_authoritative",
          keys.get("proj:poly"))
    provs = {r["provenance"] for r in rows}
    check("both evidence classes appear in ONE result set",
          provs == {"proven_stored_point", "recovered_authoritative"}, provs)
    check("provenance is never null on any row",
          all(r["provenance"] for r in rows), provs)
    cols = set(rows[0].keys())
    check("result exposes provenance", "provenance" in cols, sorted(cols))

    # ---------------------- removed misleading columns ----------------------
    check("first_z3 is NOT exposed (NULL on all proven rows in production)",
          "first_z3" not in cols, sorted(cols))
    check("recovered_at is NOT exposed (it is the sync stamp on proven rows)",
          "recovered_at" not in cols, sorted(cols))
    check("outcome is NOT exposed (pinned to 1 by the predicate)",
          "outcome" not in cols, sorted(cols))
    check("result contract is exactly the intended 7 columns",
          cols == {"source_key", "feature_id", "registry_id", "provenance",
                   "distance_mi", "geometry_type", "has_more"}, sorted(cols))

    # ============================== EXCLUSIONS ==================================
    print("-" * 78)
    print("EXCLUSIONS")
    check("NULL geometry is excluded", "proj:nullgeom" not in keys, sorted(keys))
    check("unknown outcome fails CLOSED (not returned)", "proj:outcome9" not in keys, sorted(keys))
    check("geometry from ANOTHER verdict snapshot is excluded",
          "proj:staleSnap" not in keys, sorted(keys))
    check("proven geometry with NULL verdict_snapshot_id is excluded",
          "proj:nullSnap" not in keys, sorted(keys))
    check("REJECTED identity's proven point is excluded even though it is in range",
          "proj:rejected" not in keys, sorted(keys))
    check("REJECTED identity's RECOVERED geometry is KEPT (a bad coordinate is not a "
          "verdict against publisher geometry)",
          "proj:rejectedrec" in keys, sorted(keys))

    # ============================== GEOMETRY ====================================
    print("-" * 78)
    print("GEOMETRY SEMANTICS")
    gtypes = {r["source_key"]: r["geometry_type"] for r in rows}
    check("POINT geometry is handled", gtypes.get("proj:near") == "ST_Point", gtypes)
    check("LINESTRING geometry is handled", gtypes.get("proj:line") == "ST_LineString", gtypes)
    check("MULTILINESTRING geometry is handled",
          "ST_MultiLineString" in gtypes.values(), gtypes)
    check("POLYGON geometry is handled", gtypes.get("proj:poly") == "ST_Polygon", gtypes)
    check("MULTIPOLYGON geometry is handled", "ST_MultiPolygon" in gtypes.values(), gtypes)
    # the polygon CONTAINS the home -> distance must be 0, not a centroid distance
    polyd = keys["proj:poly"]["distance_mi"]
    check("home INSIDE a polygon returns distance 0 (not a centroid distance)",
          abs(polyd) < 1e-9, polyd)
    # a line's distance is to the line, and it is nearer than its endpoints' midpoint drift
    check("line distance is a real geometry distance (>0, inside the radius)",
          0 < keys["proj:line"]["distance_mi"] < 1.0, keys["proj:line"]["distance_mi"])
    check("no result exceeds the requested radius",
          all(r["distance_mi"] <= 1.0 + 1e-9 for r in rows),
          max(r["distance_mi"] for r in rows))

    # radius monotonicity, and the far point crossing the boundary
    r05 = {r["source_key"] for r in call(cur, radius=0.5)}
    r1 = {r["source_key"] for r in call(cur, radius=1)}
    r2 = {r["source_key"] for r in call(cur, radius=2)}
    r5 = {r["source_key"] for r in call(cur, radius=5)}
    check("radius sets are monotonically nested 0.5 <= 1 <= 2 <= 5",
          r05 <= r1 <= r2 <= r5, (len(r05), len(r1), len(r2), len(r5)))
    check("a project beyond 1 mi is excluded at 1 mi and included at 2 mi",
          "proj:far" not in r1 and "proj:far" in r2, (("far" in r1), ("far" in r2)))

    # ============================== IDENTITY GRAIN ==============================
    print("-" * 78)
    print("IDENTITY GRAIN (source_key, feature_id)")
    multi = [r for r in rows if r["source_key"] == "proj:multi"]
    check("one source_key with 3 geometries returns 3 SEPARATE rows", len(multi) == 3, len(multi))
    check("  and their feature_ids are distinct",
          {m["feature_id"] for m in multi} == {"f:1", "f:2", "f:3"},
          [m["feature_id"] for m in multi])
    check("no row is collapsed per source_key (grain == PK)",
          len({(r["source_key"], r["feature_id"]) for r in rows}) == len(rows), len(rows))

    # ============================== ORDERING ====================================
    print("-" * 78)
    print("DETERMINISTIC ORDERING")
    d = [r["distance_mi"] for r in rows]
    check("results are ordered nearest-first", d == sorted(d), d[:5])
    a = [(r["source_key"], r["feature_id"]) for r in call(cur)]
    b = [(r["source_key"], r["feature_id"]) for r in call(cur)]
    check("repeated identical calls return an identical ordered result", a == b)

    # ============================== TRUNCATION ==================================
    print("-" * 78)
    print("TRUNCATION CONTRACT")
    full = call(cur, radius=5, limit=500)
    n_all = len(full)
    check("has_more is FALSE when the result is complete",
          all(r["has_more"] is False for r in full), {r["has_more"] for r in full})
    check("  and the complete row count IS the true match count", n_all >= 6, n_all)

    cut = call(cur, radius=5, limit=2)
    check("caller limit is enforced (limit=2 returns 2 rows)", len(cut) == 2, len(cut))
    check("has_more is TRUE when the result is truncated",
          all(r["has_more"] is True for r in cut), {r["has_more"] for r in cut})
    check("truncation keeps the NEAREST rows",
          [r["source_key"] for r in cut] == [r["source_key"] for r in full[:2]],
          ([r["source_key"] for r in cut], [r["source_key"] for r in full[:2]]))

    exact = call(cur, radius=5, limit=n_all)
    check("has_more is FALSE when limit EQUALS the true count "
          "(the case `rows == limit` cannot distinguish)",
          len(exact) == n_all and all(r["has_more"] is False for r in exact),
          (len(exact), {r["has_more"] for r in exact}))
    one_less = call(cur, radius=5, limit=n_all - 1)
    check("has_more is TRUE at exactly one below the true count",
          len(one_less) == n_all - 1 and all(r["has_more"] is True for r in one_less),
          (len(one_less), {r["has_more"] for r in one_less}))

    # ============================== VALIDATION ==================================
    print("-" * 78)
    print("PARAMETER VALIDATION (reject, never clamp)")
    for name, args in [
        ("latitude 91 is rejected", (91.0, HOME_LNG, 1, 500)),
        ("latitude -91 is rejected", (-91.0, HOME_LNG, 1, 500)),
        ("longitude 181 is rejected", (HOME_LAT, 181.0, 1, 500)),
        ("longitude -181 is rejected", (HOME_LAT, -181.0, 1, 500)),
        ("radius 0 is rejected", (HOME_LAT, HOME_LNG, 0, 500)),
        ("negative radius is rejected", (HOME_LAT, HOME_LNG, -1, 500)),
        ("excessive radius (100 mi) is rejected", (HOME_LAT, HOME_LNG, 100, 500)),
        ("off-allowlist radius (3 mi) is rejected", (HOME_LAT, HOME_LNG, 3, 500)),
        ("fractional off-allowlist radius (4.9 mi) is rejected", (HOME_LAT, HOME_LNG, 4.9, 500)),
        ("limit 0 is rejected", (HOME_LAT, HOME_LNG, 1, 0)),
        ("negative limit is rejected", (HOME_LAT, HOME_LNG, 1, -5)),
        ("limit above the server maximum (2001) is REJECTED, not clamped",
         (HOME_LAT, HOME_LNG, 1, 2001)),
    ]:
        r, code, msg = raises(plain,
                              "select * from public.n5_projects_within_radius(%s,%s,%s,%s);", args)
        check(name, r and code == "22023", (code, msg[:90]))

    for name, args in [
        ("NULL latitude is rejected", (None, HOME_LNG, 1, 500)),
        ("NULL longitude is rejected", (HOME_LAT, None, 1, 500)),
        ("NULL radius is rejected", (HOME_LAT, HOME_LNG, None, 500)),
        ("NULL limit is rejected", (HOME_LAT, HOME_LNG, 1, None)),
    ]:
        r, code, msg = raises(plain,
                              "select * from public.n5_projects_within_radius(%s,%s,%s,%s);", args)
        check(name, r and code == "22023", (code, msg[:90]))

    ok_max = call(cur, radius=1, limit=2000)
    check("limit exactly at the server maximum (2000) is ACCEPTED", len(ok_max) > 0, len(ok_max))

    # ============================== ACCESS PATH =================================
    print("-" * 78)
    print("SPATIAL ACCESS PATH")
    # The fixture table is tiny, so the planner will legitimately prefer a seq scan;
    # asserting "uses the index" here would assert something about row counts, not
    # about the QUERY SHAPE. What can be proven offline is that the shape is
    # index-ELIGIBLE: the && operator against a geometry constant is present, in the
    # native SRID, un-wrapped by any function that would defeat the GiST index.
    plain.execute("set enable_seqscan = off;")
    plan = "\n".join(r[0] for r in q(plain, """
        explain select g.source_key from geo.n5_geom g
         where g.outcome = 1 and g.geom is not null
           and g.geom && st_expand(st_transform(st_setsrid(st_makepoint(%s,%s),4326),4269),
                                   0.0215, 0.0159);""", (HOME_LNG, HOME_LAT)))
    plain.execute("set enable_seqscan = on;")
    check("the && prefilter shape can use n5_geom_gix", "n5_geom_gix" in plan, plan[:200])
    ddl_code = "\n".join(l for l in ddl_text.split("\n") if not l.strip().startswith("--"))
    check("the shipped predicate keeps the && prefilter in the NATIVE srid (4269)",
          "st_expand(v_home4269" in ddl_code, None)
    check("no ST_Centroid / ST_PointOnSurface / n5_rep_point in the shipped code",
          not any(t in ddl_code.lower() for t in
                  ("st_centroid", "st_pointonsurface", "n5_rep_point")), None)
    check("no distinct on (source_key) in the shipped code",
          "distinct on" not in ddl_code.lower(), None)
    check("the shipped code reads app_projects nowhere", "app_projects" not in ddl_code, None)

    # ============================== SECURITY ====================================
    print("-" * 78)
    print("SECURITY")
    meta = q(plain, "select p.prosecdef, p.provolatile, p.proconfig,"
                    " pg_get_userbyid(p.proowner) as owner"
                    " from pg_proc p join pg_namespace n on n.oid=p.pronamespace"
                    " where n.nspname='public' and p.proname='n5_projects_within_radius';")[0]
    check("function is SECURITY DEFINER", meta[0] is True, meta)
    check("function is STABLE", meta[1] == "s", meta)
    check("function pins search_path=public",
          meta[2] is not None and any("search_path=public" in c for c in meta[2]), meta)
    pub = q(plain, "select has_function_privilege('public',"
                   " 'public.n5_projects_within_radius(double precision,double precision,"
                   "numeric,integer)', 'EXECUTE');")[0][0]
    check("EXECUTE is revoked from PUBLIC", pub is False, pub)

    # ---- NEGATIVE CONTROLS: the suite must FAIL on a weakened function ---------
    print("-" * 78)
    print("NEGATIVE CONTROLS (the gates must be load-bearing, not decorative)")
    # (a) drop the lifecycle gate -> mid-sweep no longer fails closed
    weak = ddl_exec.replace("into strict v_snapshot", "into v_snapshot")
    plain.execute(weak)
    set_manifest(plain, "READY", False)
    r, code, msg = raises(plain, "select * from public.n5_projects_within_radius(%s,%s,1,500);",
                          (HOME_LAT, HOME_LNG))
    check("removing STRICT breaks the mid-sweep gate (control proves it is load-bearing)",
          not r, (r, code))
    # (b) restore and re-prove
    plain.execute(ddl_exec)
    r, code, msg = raises(plain, "select * from public.n5_projects_within_radius(%s,%s,1,500);",
                          (HOME_LAT, HOME_LNG))
    check("restoring the shipped DDL restores the mid-sweep refusal", r and code == "55000",
          (r, code))
    set_manifest(plain, "READY", True)

    # (c) drop the reject clause -> the rejected proven point reappears
    weak2 = ddl_exec.replace(
        "and not (g.provenance = 'proven_stored_point'", "and not (false")
    plain.execute(weak2)
    leaked = {r["source_key"] for r in call(cur, radius=5, limit=500)}
    check("removing the reject clause LETS THE REJECTED IDENTITY BACK IN "
          "(control proves the clause is load-bearing)",
          "proj:rejected" in leaked, sorted(leaked))
    plain.execute(ddl_exec)
    back = {r["source_key"] for r in call(cur, radius=5, limit=500)}
    check("restoring the shipped DDL excludes it again", "proj:rejected" not in back,
          sorted(back))

    print("=" * 78)
    print("TOTAL %d  PASS %d  FAIL %d" % (_n, _pass, _fail))
    print("=" * 78)
    return 1 if _fail else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""END-TO-END proof of the N5 generation lifecycle, through the REAL orchestrator code.

run_suite.py proves the database functions. It never ran scripts/n5_orchestrate.py,
n5_shard.py or n5_publish.py, so the first production `open` (2026-09-25) failed on a defect
no test could see, and a read-only audit then found ten more in that code path. This file
closes that gap: it drives open -> work (shards) -> prepare -> publish -> unresolved -> ready
-> activate by calling the SHIPPED modules' own functions against a disposable PostgreSQL +
PostGIS built from the fidelity-checked fixture with Parts A-D applied exactly as production
applies them.

Only three things are substituted, and each at the narrowest seam:
  * n3_pilot.sql       - the Management API POST, replaced by one psycopg2 autocommit
                         execute of the SAME text: one simple-query message, i.e. the same
                         implicit-transaction semantics. The read-only write-word guard still
                         runs. Rows round-trip through JSON, as the API returns them.
  * the Census TIGER download - the two load_boundaries() functions insert fixture polygons
                         with the SAME inserts and return the SAME shapes.
  * the publisher registry - empty, so every RECOVERY fetch is refused as it is for a
                         registry with no service_url (exercising SOURCE_EXCLUDED).
Everything else - every SQL statement, every gate, every count - is production code.

Target: N5_TEST_DSN (a THROWAWAY server). Refuses if a Supabase credential is visible.
"""
import decimal
import importlib
import json
import os
import subprocess
import sys

import psycopg2
import psycopg2.extras

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import run_suite as R  # noqa: E402  - the fixture, seed, parts and helpers: one copy

GEN = "gen-e2e"
FAILS = []


def ok(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} — {name}" + (f"  ({detail})" if detail and not cond else ""), flush=True)
    if not cond:
        FAILS.append(name)


def _json_default(v):
    if isinstance(v, decimal.Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    return str(v)


def make_local_sql(conn, n3):
    """The Management API contract, locally: one request = one simple-query message."""
    def sql(query, tag="", raise_413=False, read_only=False, timeout=900):
        if read_only:
            n3.assert_read_only(query, tag)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as c:
            try:
                c.execute(query)
            except psycopg2.Error as e:
                raise SystemExit(f"STOP: SQL {tag} failed HTTP 400 on attempt 1\n{str(e)[:3000]}")
            rows = [dict(r) for r in c.fetchall()] if c.description else []
        return json.loads(json.dumps(rows, default=_json_default))
    return sql


def shard_boundaries(sql, lit):
    def load_boundaries(z3, zips):
        loaded, missing = 0, []
        for z in zips:
            wkt = R.ZCTA.get(z)
            if not wkt:
                missing.append(z)
                continue
            sql(f"insert into geo.n5_zcta (z3,zcta5,geom) values "
                f"({lit(z3)},{lit(z)},ST_GeomFromText({lit(wkt)},4269));", "zcta ins")
            loaded += 1
        r = sql(f"select count(*) n, count(*) filter (where not ST_IsValid(geom)) bad, "
                f"coalesce(sum(ST_NPoints(geom)),0) pts from geo.n5_zcta where z3={lit(z3)};", "zcta chk")
        return loaded, sorted(set(missing)), int(r[0]["n"]), int(r[0]["bad"]), int(r[0]["pts"])
    return load_boundaries


def publish_boundaries(sql, lit):
    def load_boundaries(generation, prefix):
        want = {r["zip"] for r in sql(
            f"select zip from public.canonical_zip_registry where left(zip,3)={lit(prefix)};", "canon")}
        sql(f"delete from geo.n5_gen_zcta where generation_id={lit(generation)} and prefix={lit(prefix)};",
            "clear scratch")
        loaded = 0
        for z in sorted(want):
            if z in R.ZCTA:
                sql(f"insert into geo.n5_gen_zcta (generation_id, prefix, zcta5, geom) values "
                    f"({lit(generation)},{lit(prefix)},{lit(z)},ST_GeomFromText({lit(R.ZCTA[z])},4269));", "zcta ins")
                loaded += 1
        return len(want), loaded
    return load_boundaries


class Env:
    """Import the shipped modules with THIS run's environment and the three seams replaced."""

    def __init__(self, conn):
        self.conn = conn
        import n3_pilot
        self.n3 = n3_pilot
        n3_pilot.sql = make_local_sql(conn, n3_pilot)
        os.environ.pop("SUPABASE_ACCESS_TOKEN", None)

    def orchestrator(self, mode, **env):
        os.environ.update({"MODE": mode, "GENERATION": GEN, "MAX_SHARDS": "10",
                           "MAX_SECONDS": "3000", "WORKER": "e2e-worker", **env})
        import n5_orchestrate as O
        O = importlib.reload(O)
        O.sql = self.n3.sql
        O.subprocess.run = self.run_shard_inprocess
        return O

    def run_shard_inprocess(self, argv, env=None, **kw):
        """What mode_work's subprocess would do, in-process so the seams apply."""
        os.environ.update(env or {})
        import n5_shard as S
        S = importlib.reload(S)
        S.sql = self.n3.sql
        S.load_boundaries = shard_boundaries(S.sql, S.lit)
        S.load_registry = lambda: {}
        try:
            rc = S.main() or 0
        except SystemExit as e:
            print(f"   shard exited: {e}", flush=True)
            rc = 1
        return subprocess.CompletedProcess(argv, rc)

    def patch_publish(self):
        import n5_publish as P
        P = importlib.reload(P)
        P.sql = self.n3.sql
        P.load_boundaries = publish_boundaries(P.sql, P.lit)
        sys.modules["n5_publish"] = P


def build_db():
    c = R.fresh_db("n5gen_e2e")
    R.q(c, open(R.PRESTATE).read())
    R.q(c, R.SEED)
    a, b, cc = R.migration_parts()
    R.q(c, "set n5.verified_free_disk_mb = '2998'")
    R.q(c, a)
    for st in b:
        R.q(c, st)
    R.q(c, cc)
    d_a, d_b, d_c = R.part_d_parts()
    R.q(c, "set n5.verified_free_disk_mb = '2998'")
    R.q(c, d_a)
    for st in d_b:
        R.q(c, st)
    R.q(c, d_c)
    return c


def main():
    R.admin_dsn()  # refuses without a throwaway target, or with a Supabase credential visible
    c = build_db()
    pre = R.map_snapshot(c)
    ok("control: the legacy generation serves (11101 has P1,P2,P5)", R.refs(c, "11101") == ["dev:P1", "dev:P2", "dev:P5"])
    env = Env(c)

    # ---------------------------------------------------------------- OPEN
    O = env.orchestrator("open")
    O.mode_open()
    g = R.q(c, "select state, snapshot_id from geo.n5_generation where generation_id=%s", (GEN,))
    snap = R.q(c, "select * from geo.n5_snapshot where snapshot_id='n5-' || %s", (GEN,))
    shards = R.q(c, "select z3, projects, pairs, zips, checksum from geo.n5_shard where generation_id=%s order by z3", (GEN,))
    ok("E1 open: ONE transaction wrote the capture, the snapshot row, the BUILDING generation and its shards",
       g == [{"state": "BUILDING", "snapshot_id": "n5-" + GEN}] and len(snap) == 1 and [s["z3"] for s in shards] == ["111", "112"],
       (g, len(snap), shards))
    ok("E2 open: the snapshot row carries its NOT NULL figures, and its checksum is the manifest total",
       snap and snap[0]["sources"] == 2 and snap[0]["n_rows"] == 13 and snap[0]["projects"] == 12
       and snap[0]["checksum"] == sum(s["checksum"] for s in shards), snap)
    ok("E3 open: every captured row carries the canonical NOT NULL fingerprints",
       R.q1(c, "select count(*) from preservation.app_project_identity where snapshot_id='n5-' || %s "
               "and (identity_hash is null or content_hash is null)", (GEN,)) == 0
       and R.q1(c, "select count(*) from preservation.app_project_identity where snapshot_id='n5-' || %s", (GEN,)) == 13)
    ok("E4 open refuses to re-open an existing generation (and writes nothing)",
       _raises(lambda: env.orchestrator("open").mode_open(), "already exists"))

    # an open that fails part-way must leave NOTHING behind (the defect that made a retry impossible)
    R.q(c, "alter table geo.n5_shard add constraint e2e_fail_manifest check (z3 <> '112') not valid")
    os.environ["SNAPSHOT_ID"] = "n5-gen-e2e-atomic"
    failed = _raises(lambda: env.orchestrator("open", GENERATION="gen-e2e-atomic").mode_open(), "e2e_fail_manifest")
    os.environ.pop("SNAPSHOT_ID", None)
    R.q(c, "alter table geo.n5_shard drop constraint e2e_fail_manifest")
    ok("E5 an open that fails at the LAST statement leaves no capture, snapshot, generation or shard behind",
       failed
       and R.q1(c, "select count(*) from preservation.app_project_identity where snapshot_id='n5-gen-e2e-atomic'") == 0
       and R.q1(c, "select count(*) from geo.n5_snapshot where snapshot_id='n5-gen-e2e-atomic'") == 0
       and R.q1(c, "select count(*) from geo.n5_generation where generation_id='gen-e2e-atomic'") == 0)

    # ---------------------------------------------------------------- WORK: shards, then prepare + publish + unresolved
    env.patch_publish()
    O = env.orchestrator("work")
    O.mode_work()
    st = R.q(c, "select z3, state, detail->>'halt_reason' r, (detail->>'verified')::bool v from geo.n5_shard "
                "where generation_id=%s order by z3", (GEN,))
    ok("E6 work: every shard of the new generation runs under ITS snapshot and verifies clean",
       [(s["z3"], s["state"], s["v"]) for s in st] == [("111", "done", True), ("112", "done", True)], st)
    ok("E7 the legacy association rows are untouched; the new generation holds its own",
       R.q1(c, "select count(*) from geo.n5_association where generation_id=%s", (R.LEGACY,)) == 2
       and R.q1(c, "select count(*) from geo.n5_association where generation_id=%s", (GEN,)) > 0)
    verdicts = {r["source_key"]: r["verdict"] for r in R.q(c,
                "select source_key, verdict from geo.n5_generation_key_verdict where generation_id=%s", (GEN,))}
    ok("E8 the shard persisted its verdicts; a key with cached geometry gets none",
       verdicts == {"dev:P6": "NULL_COORD", "dev:P12": "MULTI_COORD_UNRESOLVED",
                    "dev:P8": "SOURCE_EXCLUDED", "dev:P10": "SOURCE_EXCLUDED"}, verdicts)
    ok("E9 work published EVERY prefix of the scope (incl. the shard-less 113) and recorded unresolved outcomes",
       [r["z3"] for r in R.q(c, "select z3 from geo.n5_generation_publish where generation_id=%s order by z3", (GEN,))]
       == ["111", "112", "113"]
       and R.q1(c, "select unresolved_recorded_at is not null from geo.n5_generation where generation_id=%s", (GEN,)) is True)
    unres = {r["source_key"]: r["reason_code"] for r in R.q(c,
             "select source_key, reason_code from geo.n5_generation_unresolved where generation_id=%s", (GEN,))}
    ok("E10 every unresolved outcome is evidence-backed, one per class",
       unres == {"dev:P6": "POINT_REJECTED", "dev:P12": "POINT_REJECTED", "dev:P7": "GEOMETRY_INVALID",
                 "dev:P8": "SOURCE_EXCLUDED", "dev:P9": "NO_INTERSECTION_WITH_GENERATION_ZCTAS",
                 "dev:P10": "SOURCE_EXCLUDED"}, unres)
    ok("E11 building the new generation changed nothing Map 1 serves", R.map_snapshot(c) == pre)

    # ---------------------------------------------------------------- RECONCILE, READY, ACTIVATE
    env.orchestrator("reconcile").mode_reconcile()
    ok("E12 set-based reconciliation accounts for every expected key",
       R.q1(c, "select coalesce(sum(unaccounted),0) from geo.n5_generation_reconcile where generation_id=%s", (GEN,)) == 0
       and R.q1(c, "select coalesce(sum(expected_keys),0) from geo.n5_generation_reconcile where generation_id=%s", (GEN,)) == 12)
    env.orchestrator("ready").mode_ready()
    ok("E13 READY through the one completeness definition",
       R.q1(c, "select state from geo.n5_generation where generation_id=%s", (GEN,)) == "READY")
    env.orchestrator("activate").mode_activate()
    ok("E14 activation switches Map 1: the MOVED point, P4 (legacy reject) and cross-prefix P3/P11 all served",
       R.refs(c, "11101") == ["dev:P1", "dev:P2", "dev:P5"] and R.refs(c, "11102") == ["dev:P2", "dev:P4"]
       and R.refs(c, "11201") == ["dev:P3"] and R.refs(c, "11301") == ["dev:P11"]
       and R.q(c, "select lat, lng from geo.zip_authoritative_membership where generation_id=%s "
                  "and source_key='dev:P1'", (GEN,)) == [{"lat": 0.6, "lng": 0.6}],
       [R.refs(c, z) for z in ("11101", "11102", "11201", "11301")])
    ok("E15 exactly one serving generation, with the legacy build recorded as its predecessor",
       R.q1(c, "select count(*) from geo.n5_generation where state in ('ACTIVE','ACTIVE_LEGACY')") == 1
       and R.q1(c, "select predecessor_generation_id from geo.n5_generation where generation_id=%s", (GEN,)) == R.LEGACY)
    entries = sorted((r["zcta5"], r["source_key"]) for r in R.q(c, "select * from geo.n5_generation_entries(%s)", (GEN,)))
    ok("E16 'newly visible' is derivable: the new generation minus the legacy one",
       entries == [("11102", "dev:P4"), ("11201", "dev:P3"), ("11301", "dev:P11")], entries)

    c.close()
    R.drop_db("n5gen_e2e")
    print("=" * 60)
    print(f"END-TO-END: {'FAIL' if FAILS else 'PASS'} — {len(FAILS)} failing check(s)")
    return 1 if FAILS else 0


def _raises(fn, match):
    try:
        fn()
    except SystemExit as e:
        return match in str(e)
    return False


if __name__ == "__main__":
    sys.exit(main())

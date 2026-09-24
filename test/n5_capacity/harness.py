#!/usr/bin/env python3
"""Behavioural harness for the N5 capacity gate. Driven by test/n5-capacity.test.mjs.

Runs a builder's REAL entry point against a FAKE database, once per capacity scenario, and
reports for each: did it refuse, was the refusal the capacity gate's, how many WRITE
statements reached the database first, and was the network touched. No real database and
no network: n3_pilot.sql is replaced before any builder imports it, and urllib is blocked.

    python3 harness.py <builder>      -> one JSON object {scenario: result}

A write is any statement n3_pilot's own read-only guard classifies as a write. The fake
raises ReachedWrite on the first one, so "writes == 0 and refused by capacity" proves the
gate ran BEFORE the builder's first write, and the ample scenario proves the harness can
see a write at all (a harness that never observed one would pass every refusal vacuously).
"""
import datetime
import json
import os
import sys
import tempfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.normpath(os.path.join(HERE, "..", "..", "scripts"))
sys.path.insert(0, SCRIPTS)
BUILDER = sys.argv[1]

os.environ["SUPABASE_ACCESS_TOKEN"] = "test-token-not-a-secret"
for k in ("DISK_TOTAL_MB", "DISK_FLOOR_MB", "GITHUB_ACTIONS", "GITHUB_REF", "GITHUB_SHA"):
    os.environ.pop(k, None)
os.environ.update({"GENERATION": "g-test", "REGISTRY_ID": "harness-registry", "PREFIX": "840",
                   "MARKER_MODE": "build", "A4_MODE": "index", "MODE": "open", "Z3": "AUTO"})


class ReachedWrite(Exception):
    pass


class NetworkUsed(Exception):
    pass


STATE = {"writes": [], "network": 0, "unknown": [], "gates": 0}


def _no_network(*a, **k):
    STATE["network"] += 1
    raise NetworkUsed("network is blocked in the capacity harness")


urllib.request.urlopen = _no_network

import n3_pilot  # noqa: E402

DB_MIB, WAL_MIB = 11292.0, 1024.0
ROUTES = [
    ("pg_database_size(current_database())/1048576.0) db", [{"db": DB_MIB, "wal": WAL_MIB}]),
    ("name='max_wal_size') mw", [{"mw": 4096, "sk": 2048, "wk": 0, "wal": WAL_MIB}]),
    ("as build_mib", [{"build_mib": 1400.0, "capture_rel_mib": 1453.0,
                       "capture_rel_rows": 3172292, "live_rows": 3115623, "temp_limit_kb": -1}]),
    ("select generation_id, snapshot_id, state from geo.n5_generation",
     [{"generation_id": "g-test", "snapshot_id": "phase1-2026-09-01", "state": "BUILDING"}]),
    ("select 1 from geo.n5_generation", []),
    ("from geo.n5_snapshot", [{"sources": 1, "projects": 1, "pairs": 1, "n_rows": 1}]),
    ("from preservation.app_project_identity where snapshot_id", []),
    ("from geo.n5_accepted_source", [{"treatment": "RECOVERY", "projects": 1, "pairs": 1}]),
    ("pg_total_relation_size('geo.n5_geom') b", [{"b": 1, "rows": 1, "mine": 0}]),
    ("state='running') running", [{"running": 0, "done": 1, "zcta_left": 0, "frozen_left": 0,
                                   "scratch_exists": False, "assoc": 0, "geom": 0}]),
    ("state='done'", [{"z3": "840"}]),
    ("select distinct left(zcta5,3) z3", [{"z3": "840"}]),
    ("from pg_indexes", []),
    ("to_regclass('geo.zcta_boundary')", [{"mib": 840.0}]),
]


TAG_ROUTES = {"pick": [{"z3": "840"}], "manifest ids": [{"z3": "840"}],
              "keys": [{"source_key": "k1"}]}


def fake_sql(query, tag="", *a, **k):
    if n3_pilot._SQL_WRITE_RE.search(query):
        STATE["writes"].append(tag or query[:60])
        raise ReachedWrite(tag or query[:60])
    if tag in TAG_ROUTES:
        return [dict(r) for r in TAG_ROUTES[tag]]
    for needle, rows in ROUTES:
        if needle in query:
            return [dict(r) for r in rows]
    STATE["unknown"].append(tag or query[:80])
    return []


n3_pilot.sql = fake_sql
n3_pilot.http = _no_network

import n5_capacity as C  # noqa: E402

REAL_TRUST = C.check_trusted_source
_REAL_REQUIRE = C.require_capacity


def _counted_require(*a, **k):
    """Counts gates that PASSED. Builders reach the gate as n5_capacity.require_capacity."""
    r = _REAL_REQUIRE(*a, **k)
    STATE["gates"] += 1
    return r


_REAL_OK = C.capacity_ok


def _counted_ok(*a, **k):
    ok, r = _REAL_OK(*a, **k)
    STATE["gates"] += int(bool(ok))
    return ok, r


C.capacity_ok = _counted_ok


C.require_capacity = _counted_require
NOW = datetime.datetime.now(datetime.timezone.utc)


def ts(hours):
    return (NOW + datetime.timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")


def rec(**over):
    r = {"provisioned_disk": {"value": 30, "unit": "GiB"},
         "non_database_usage": {"value": 0, "unit": "MiB"},
         "observed_at": ts(-1), "recorded_by": "harness", "source": "Compute and Disk"}
    r.update(over)
    return json.dumps(r)


SCENARIOS = {
    "ample": rec(),
    "missing": None,
    "malformed": "{not json",
    "unrecorded": json.dumps({"provisioned_disk": {"value": None, "unit": None},
                              "non_database_usage": {"value": None, "unit": None},
                              "observed_at": None, "recorded_by": None, "source": None}),
    "stale": rec(observed_at=ts(-25)),
    "future": rec(observed_at=ts(+2)),
    "insufficient": rec(provisioned_disk={"value": DB_MIB + WAL_MIB + 1000, "unit": "MiB"}),
    "infinity": rec().replace('"value": 30', '"value": Infinity'),
    "nan": rec().replace('"value": 30', '"value": NaN'),
    "wrong_unit": rec(provisioned_disk={"value": 30, "unit": "TB"}),
    "bytes_as_mib": rec(provisioned_disk={"value": 30e9, "unit": "MiB"}),
    "no_provenance": rec(source=""),
    "untrusted_ref": rec(),
}


def run_builder():
    if BUILDER == "shard":
        import n5_shard as m
        return m.main()
    if BUILDER == "shard_advance":
        import n5_shard as m
        ok, _ = m.shard_advance_capacity("840")
        if not ok:
            raise C.CapacityRefused("advance: insufficient (the shard is HALTED, not advanced)")
        return ok
    if BUILDER == "recon_chunk":
        import n5_recon_population as m
        return m.chunk_gate(0, 10)
    if BUILDER == "acquire":
        import n5_acquire_registry as m
        return m.main()
    if BUILDER == "boundary_first":
        import n5_boundary_first as m
        return m.main()
    if BUILDER == "unit_a":
        import n5_unit_a_shadow as m
        return m.main()
    if BUILDER == "a3_markers":
        import n5_a3_markers as m
        return m.main()
    if BUILDER == "a3_clip":
        import n5_a3_clip_stats as m
        return m.main()
    if BUILDER == "a4_index":
        import n5_a4_index as m
        return m.main()
    if BUILDER == "recon":
        import n5_recon_population as m
        return m.main()
    if BUILDER == "verify":
        import n5_verify_snapshot as m
        return m.main()
    if BUILDER == "open":
        import n5_orchestrate as m
        return m.mode_open()
    if BUILDER in ("b3_load", "b3_nvdot"):
        import phase2_b3_geometry as m
        m.sql = fake_sql
        m.full_fingerprint = lambda tag: None      # an expensive READ; not under test
        return m.recover([]) if BUILDER == "b3_load" else m.nvdot_complete()
    if BUILDER == "zcta_reload":
        # The reload's network acquisition precedes its gate, so the GATE is driven
        # directly; test/n5-capacity.test.mjs pins that main() calls it before the first
        # write (build_prepare_sql).
        import phase2_b1_zcta as m
        return m.zcta_capacity_gate(900 * 1048576)
    raise SystemExit(f"unknown builder {BUILDER}")


out = {}
tmp = tempfile.mkdtemp(prefix="n5cap-h-")
for name, text in SCENARIOS.items():
    STATE.update(writes=[], network=0, unknown=[], gates=0)
    path = os.path.join(tmp, name + ".json")
    if text is not None:
        with open(path, "w") as fh:
            fh.write(text)
    C.RECORD_PATH = path
    if name == "untrusted_ref":
        C.check_trusted_source = REAL_TRUST
        os.environ.update(GITHUB_ACTIONS="true", GITHUB_REF="refs/heads/feature-branch")
    else:
        C.check_trusted_source = lambda p, env=None: None   # trust is tested on its own
        for k in ("GITHUB_ACTIONS", "GITHUB_REF"):
            os.environ.pop(k, None)
    r = {"refused": False, "capacity": False, "reason": "", "reached_write": False}
    try:
        run_builder()
    except C.CapacityRefused as e:
        r.update(refused=True, capacity=True, reason=e.reason)
    except ReachedWrite as e:
        r.update(reached_write=True, reason=str(e))
    except NetworkUsed as e:
        r.update(reason="network: " + str(e))
    except SystemExit as e:
        r.update(refused=True, reason=str(e)[:200])
    except Exception as e:  # noqa: BLE001 - reported, never swallowed silently
        r.update(reason=f"{type(e).__name__}: {e}"[:200])
    r.update(writes=len(STATE["writes"]), network=STATE["network"], gates_passed=STATE["gates"])
    out[name] = r
print("HARNESS_JSON " + json.dumps(out))

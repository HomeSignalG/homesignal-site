"""The unattended N5 lifecycle: open when nothing is building, READY + ACTIVATE when complete.

Drives the SHIPPED n5_orchestrate.mode_work with the database stubbed, and pins:
  1. a READY generation left by an earlier tick is activated, and nothing else happens;
  2. more than one READY generation is a hard stop, never a guess;
  3. auto-open refuses (cleanly) on a young newest build, a FAILED newest build, a taken
     name, and too little disk - and opens today's name when none of those hold;
  4. a complete build calls READY then ACTIVATE, in that order, and nothing when incomplete;
  5. a READY refusal stops the tick before ACTIVATE is called;
  6. with AUTO_LIFECYCLE off, or with an explicit GENERATION, none of this happens.
Run: python3 scripts/test_n5_auto_lifecycle.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("SUPABASE_ACCESS_TOKEN", "test")

import n5_orchestrate as o  # noqa: E402

FAILS = []
TODAY = "n5-national-" + time.strftime("%Y-%m-%d", time.gmtime())


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)


def world(ready=(), building=(), newest=None, exists=False, free=10000.0, complete=False,
          ready_raises=False, auto=True, generation="", requeue=False):
    """Stub every database read the auto path makes; record every lifecycle call."""
    log = []

    def fake_sql(query, tag="", **kw):
        if tag == "generations READY":
            return [{"generation_id": g} for g in ready]
        if tag == "discover":
            return [{"generation_id": g} for g in building]
        if tag == "newest":
            return [newest] if newest else []
        if tag == "exists":
            return [{"?column?": 1}] if exists else []
        if tag == "generation snapshot":
            return [{"snapshot_id": "snap"}]
        if tag == "unresolved fresh":
            return [{"ok": complete}]
        if tag == "requeue halted":
            if requeue:  # only the requeue scenarios record it; the rest keep exact logs
                log.append(("requeue", query))
                return [{"z3": "010", "attempts": 1}]
            return []
        raise AssertionError(f"unexpected query tag {tag!r}")

    def fake_ready(gen):
        log.append(("ready", gen))
        if ready_raises:
            raise SystemExit("STOP: INV-1 gap")

    o.sql = fake_sql
    o.say = lambda *a, **k: None
    o.AUTO_LIFECYCLE = auto
    o.GENERATION = generation
    o.MAX_SHARDS = 0
    o.T_START = time.time()
    o.free_disk_mb = lambda: (free, 2048.0)
    o.open_generation = lambda gen: log.append(("open", gen))
    o.publish_pending = lambda gen, budget: log.append(("publish", gen))
    o.shards_unfinished = lambda gen: 0 if complete else 3
    o.unpublished_prefixes = lambda gen: [] if complete else ["100"]
    o.ready = fake_ready
    o.activate = lambda gen: log.append(("activate", gen))
    o.retire_superseded = lambda: log.append(("retire",))
    return log


def old(h, state="ACTIVE"):
    return {"generation_id": "n5-national-x", "state": state, "h": h}


# 1. a READY generation is activated first, and the tick does nothing else
log = world(ready=["g-ready"])
o.mode_work()
check("READY left over -> activated, then keep-two retirement", log == [("activate", "g-ready"), ("retire",)])

# 2. two READY -> hard stop
log = world(ready=["a", "b"])
try:
    o.mode_work()
    check("two READY -> stop", False)
except SystemExit as e:
    check("two READY -> stop", "Refusing to guess" in str(e))
check("two READY -> nothing activated", log == [])

# 3. auto-open refusals are clean no-ops
for name, kw in [("newest build younger than 20 h", dict(newest=old(5.0))),
                 ("newest build FAILED", dict(newest=old(50.0, "FAILED"))),
                 ("today's name taken", dict(newest=old(30.0), exists=True)),
                 ("disk short of floor + reserve", dict(newest=old(30.0),
                                                        free=2048.0 + o.BUILD_RESERVE_MB - 1))]:
    log = world(**kw)
    rc = o.mode_work()
    check(f"no open: {name}", rc == 0 and log == [("retire",)])

# 3b. boundaries: exactly 20 h and exactly floor + reserve both open
log = world(newest=old(o.AUTO_OPEN_MIN_HOURS), free=2048.0 + o.BUILD_RESERVE_MB)
o.mode_work()
check("opens at exactly 20 h and exactly floor + reserve", ("open", TODAY) in log)

# 3c. a normal day opens today's name and starts working it in the same tick
log = world(newest=old(30.0))
o.mode_work()
check("retires first, then opens today's generation", log[:3] == [("retire",), ("open", TODAY), ("publish", TODAY)])
check("a fresh build is not finished in the same tick", ("ready", TODAY) not in log)

# 3d. an empty catalog (no generation at all) still opens
log = world(newest=None)
o.mode_work()
check("opens when no generation exists yet", ("open", TODAY) in log)

# 4. finish: complete -> READY then ACTIVATE; incomplete -> neither
log = world(building=["g1"], complete=True)
o.mode_work()
check("complete build -> READY then ACTIVATE",
      log == [("retire",), ("publish", "g1"), ("ready", "g1"), ("activate", "g1"), ("retire",)])
log = world(building=["g1"], complete=False)
o.mode_work()
check("incomplete build -> no READY, no ACTIVATE", log == [("retire",), ("publish", "g1")])

# 4b. complete but the tick is out of time -> deferred, not rushed
log = world(building=["g1"], complete=True)
o.T_START = time.time() - o.FINISH_START_LIMIT_S - 1
o.mode_work()
check("complete but late in the tick -> deferred", log == [("retire",), ("publish", "g1")])

# 5. READY refusal stops before ACTIVATE
log = world(building=["g1"], complete=True, ready_raises=True)
try:
    o.mode_work()
    check("READY refusal stops the tick", False)
except SystemExit as e:
    check("READY refusal stops the tick", "INV-1" in str(e))
check("READY refusal -> ACTIVATE never called", ("activate", "g1") not in log)

# 6. auto off / explicit GENERATION -> the old behaviour exactly
log = world(auto=False, ready=["g-ready"], newest=old(30.0))
o.mode_work()
check("auto off: no activate, no open, no retirement", log == [])
log = world(auto=False, building=["g1"], complete=True)
o.mode_work()
check("auto off: complete build is NOT finished", log == [("publish", "g1")])
log = world(generation="g-explicit", ready=["g-ready"], complete=True)
o.mode_work()
check("explicit GENERATION: auto path ignored (no retirement either)", log == [("publish", "g-explicit")])

# 6b. halted shards: requeued only on unattended ticks, bounded, scoped to the generation
log = world(building=["g1"], requeue=True)
o.mode_work()
rq = [e for e in log if e[0] == "requeue"]
check("auto tick requeues halted shards before claiming", len(rq) == 1
      and log.index(rq[0]) < log.index(("publish", "g1")))
q = rq[0][1]
check("requeue is bounded by attempts < MAX_SHARD_ATTEMPTS (3)",
      o.MAX_SHARD_ATTEMPTS == 3 and "attempts < 3" in q)
check("requeue touches only halted shards of THIS generation",
      "state='halted'" in q and "generation_id='g1'" in q)
log = world(auto=False, building=["g1"], requeue=True)
o.mode_work()
check("auto off: halted shards are not requeued", not any(e[0] == "requeue" for e in log))
log = world(generation="g-explicit", requeue=True)
o.mode_work()
check("explicit GENERATION: halted shards are not requeued", not any(e[0] == "requeue" for e in log))

# 7. structure: one disk definition, and the gates stay behind heavy(..., verify=)
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "n5_orchestrate.py")).read()
check("free disk comes from n5_shard.disk_free_mb (the shard floor's own formula)",
      "from n5_shard import disk_free_mb, DISK_FLOOR_MB" in src)
check("auto_finish calls ready() before activate()",
      src.index("    ready(gen)\n    activate(gen)") > src.index("def auto_finish"))
wf = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".github", "workflows",
                       "n5-generation.yml")).read()
check("schedule ticks run with AUTO_LIFECYCLE=1",
      "AUTO_LIFECYCLE: ${{ github.event_name == 'schedule' && '1'" in wf)
check("the 2,048 MB floor is not overridden in the workflow", "DISK_FLOOR_MB:" not in wf)

# 8. keep two: the candidate rule is the founder's, and it never reaches a protected capture
rsql = o.RETIRE_CANDIDATES_SQL
check("retires only SUPERSEDED generations (never FAILED, never serving)", "g.state = 'SUPERSEDED'" in rsql)
check("keeps the serving generation's predecessor", "predecessor_generation_id" in rsql)
check("never a protected snapshot", "preservation.protected_snapshot" in rsql)
check("never a snapshot another generation shares", "o.snapshot_id = g.snapshot_id" in rsql)
check("the discard and the snapshot delete both go through heavy(..., verify=)",
      'heavy(f"select geo.n5_generation_discard({lit(gen)}) r;", "discard",\n                  verify=' in src
      and '"retire snapshot", verify=' in src)

# 8b. the candidate list reads ONLY the catalog table. The two "still has rows" probes used to be
# correlated EXISTS subqueries in it; the planner priced them as sequential scans of the 1.8 GB and
# 5.7 GB tables, and for an already-retired generation (no rows) each scan read the whole table.
# Four retired candidates blew the 120 s statement timeout on every tick from 2026-10-05, so no
# Map 1 generation opened for 4 days. The probes are per candidate, with a LITERAL id.
check("candidate list does not touch zip_authoritative_membership (the 2026-10-06 timeout)",
      "zip_authoritative_membership" not in rsql)
check("candidate list does not touch app_project_identity (the 2026-10-06 timeout)",
      "app_project_identity" not in rsql)
check("candidate list reads only the catalog table", "geo.n5_generation g" in rsql)
import importlib  # noqa: E402

o = importlib.reload(o)  # world() above replaced o.retire_superseded with a stub: test the real one
orig = (o.sql, o.heavy, o.say)
rlog, heavy_calls = [], []


def retire_sql(query, tag="", **kw):
    rlog.append((tag, query))
    if tag == "retire candidates":
        return [{"generation_id": "g-old1", "snapshot_id": "s-old1"},
                {"generation_id": "g-old2", "snapshot_id": "s-old2"},
                {"generation_id": "g-live", "snapshot_id": "s-live"}]
    if tag == "retire probe rows":
        return [{"ok": "g-live" in query}]
    if tag == "retire probe snapshot":
        return [{"ok": "s-live" in query}]
    raise AssertionError(f"unexpected query tag {tag!r}")


o.sql = retire_sql
o.heavy = lambda query, tag, verify=None: heavy_calls.append((tag, query))
o.say = lambda *a, **k: None
retired = o.retire_superseded()
o.sql, o.heavy, o.say = orig
probes = [(t, q) for t, q in rlog if t.startswith("retire probe")]
check("already-retired candidates cost only their probes: no discard, no delete for them",
      not any("g-old" in q or "s-old" in q for t, q in heavy_calls))
check("a candidate that still holds rows and a capture IS retired (discard, then snapshot)",
      [t for t, q in heavy_calls] == ["discard", "retire snapshot"]
      and all("g-live" in q or "s-live" in q for t, q in heavy_calls))
check("retire_superseded counts only the generations it actually retired", retired == 1)
check("each candidate is probed once for rows and once for its snapshot (6 probes for 3)",
      len(probes) == 6)
check("every probe keys on a literal id, never on a correlated column",
      all("g.generation_id" not in q and "g.snapshot_id" not in q for t, q in probes)
      and any("'g-old1'" in q for t, q in probes) and any("'s-old2'" in q for t, q in probes))

# 9. publishing refreshes table statistics first and then every ANALYZE_EVERY_PREFIXES prefixes
import importlib, types  # noqa: E402
o = importlib.reload(o)
calls = []
fake_pub = types.ModuleType("n5_publish")
fake_pub.publish_prefix = lambda gen, z3, run_id: calls.append(("publish", z3))
sys.modules["n5_publish"] = fake_pub


def pub_sql(query, tag="", **kw):
    if tag == "analyze":
        calls.append(("analyze",))
        return []
    if tag == "prepared?":
        return [{"publish_prepared_at": "2026-10-01"}]
    if tag == "unresolved stale":
        return [{"s": False}]
    raise AssertionError(f"unexpected query tag {tag!r}")


o.sql = pub_sql
o.say = lambda *a, **k: None
o.shards_unfinished = lambda gen: 0
todo = [f"{i:03d}" for i in range(100, 160)]
state = {"n": 0}
o.unpublished_prefixes = lambda gen: todo if state.__setitem__("n", state["n"] + 1) or state["n"] == 1 else []
o.publish_pending("g1", 10_000)
analyze_at = [i for i, c in enumerate([c for c in calls]) if c == ("analyze",)]
pubs = [c for c in calls if c[0] == "publish"]
check("statistics are refreshed before the FIRST prefix", calls[0] == ("analyze",))
check("statistics are refreshed every 25 prefixes (60 prefixes -> 3 refreshes)",
      len(analyze_at) == 3 and len(pubs) == 60)
check("each refresh lands right before prefixes 1, 26 and 51",
      [calls[i + 1][1] for i in analyze_at] == ["100", "125", "150"])
check("the refresh covers the three tables publish joins",
      all(t in o.PUBLISH_ANALYZE_TABLES for t in ("geo.n5_boundary_membership",
          "geo.zip_authoritative_membership", "geo.zip_authoritative_marker")))

print(f"\n{len(FAILS)} failure(s)")
sys.exit(1 if FAILS else 0)

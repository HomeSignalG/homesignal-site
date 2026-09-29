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
          ready_raises=False, auto=True, generation=""):
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

print(f"\n{len(FAILS)} failure(s)")
sys.exit(1 if FAILS else 0)

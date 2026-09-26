"""heavy(): a gateway-lost response is proven from database state, never re-sent.

Measured 2026-09-26: the Management API gateway cut geo.n5_gen_prepare_publish at 120 s
(HTTP 524) while the database finished and committed. These checks drive the SHIPPED
heavy() with a stubbed sql() and pin the four behaviours that matter:
  1. a normal response is returned unchanged;
  2. a lost response waits for the server-side statement, then passes on a met post-condition;
  3. a lost response whose post-condition is NOT met stops the run;
  4. the write is sent exactly once in every case, and without `verify` a lost response
     stays fatal (the old fail-closed behaviour).
Run: python3 scripts/test_heavy_gateway.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("SUPABASE_ACCESS_TOKEN", "test")

import n3_pilot as n3  # noqa: E402
import n5_orchestrate as o  # noqa: E402
import n5_publish as pub  # noqa: E402
from n3_pilot import SQLGatewayTimeout  # noqa: E402

FAILS = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)


def harness(lose, still_running_polls, verify_ok):
    calls = {"write": 0, "poll": 0, "verify": 0, "flags": []}

    def fake_sql(query, tag="", timeout=900, gateway_unknown=False, read_only=False, **kw):
        if tag == "proven poll":
            assert read_only
            calls["poll"] += 1
            return [{"n": 1 if calls["poll"] <= still_running_polls else 0}]
        if tag.endswith(" verify"):
            assert read_only
            calls["verify"] += 1
            return [{"ok": verify_ok, "state": "X"}]
        calls["write"] += 1
        calls["flags"].append(gateway_unknown)
        assert "/* n5proven:" in query and "statement_timeout" in query
        if lose:
            if not gateway_unknown:
                raise SystemExit("STOP: SQL x failed HTTP 524 on attempt 1")
            raise SQLGatewayTimeout("x: HTTP 524")
        return [{"r": "fine"}]

    n3.sql = fake_sql
    n3.PROVEN_POLL_S = 0
    o.say = lambda *a, **k: None
    return calls


# 1. normal response
c = harness(lose=False, still_running_polls=0, verify_ok=True)
r = o.heavy("select 1;", "t", verify="select true ok;")
check("normal response returned unchanged", r == [{"r": "fine"}])
check("normal response: no poll, no verify", c["poll"] == 0 and c["verify"] == 0)

# 2. lost response, statement still running for 2 polls, post-condition met
c = harness(lose=True, still_running_polls=2, verify_ok=True)
r = o.heavy("select 1;", "t", verify="select true ok;")
check("lost response + met post-condition passes", r is None)
check("waited until the server statement finished", c["poll"] == 3)
check("post-condition read exactly once", c["verify"] == 1)
check("write sent exactly once", c["write"] == 1)
check("gateway_unknown requested when verify given", c["flags"] == [True])

# 3. lost response, post-condition NOT met -> stop
c = harness(lose=True, still_running_polls=0, verify_ok=False)
try:
    o.heavy("select 1;", "t", verify="select false ok;")
    check("unmet post-condition stops", False)
except SystemExit as e:
    check("unmet post-condition stops", "post-condition is NOT met" in str(e))
check("unmet case: write sent exactly once", c["write"] == 1)

# 4. no verify -> old fail-closed behaviour, write once
c = harness(lose=True, still_running_polls=0, verify_ok=True)
try:
    o.heavy("select 1;", "t")
    check("no verify: lost response stays fatal", False)
except SystemExit as e:
    check("no verify: lost response stays fatal", "HTTP 524" in str(e))
check("no verify: gateway_unknown not requested", c["flags"] == [False])
check("no verify: no poll", c["poll"] == 0)

# 5a. the per-prefix PUBLISH call is proven the same way (dense prefix 100, 2026-09-26)
def pub_harness(lose, prev, verify_ok):
    calls = {"write": 0, "verify_sql": None, "flags": []}

    def fake_sql(query, tag="", timeout=900, gateway_unknown=False, read_only=False, **kw):
        if tag.endswith(" before"):
            return [{"completed_at": prev}] if prev else []
        if tag == "proven poll":
            return [{"n": 0}]
        if tag.endswith(" verify"):
            calls["verify_sql"] = query
            return [{"ok": verify_ok}]
        calls["write"] += 1
        calls["flags"].append(gateway_unknown)
        assert "n5_gen_publish_prefix" in query
        if lose:
            raise SQLGatewayTimeout("publish: HTTP 524")
        return [{"r": {"prefix": "100"}}]

    n3.sql = fake_sql
    pub.sql = fake_sql
    pub.load_boundaries = lambda g, p: (10, 10)
    return calls


c = pub_harness(lose=True, prev=None, verify_ok=True)
pub.publish_prefix("gen-x", "100", "run-1")
check("publish: lost response + publish row for this run -> continues", c["write"] == 1)
check("publish: gateway_unknown requested", c["flags"] == [True])
check("publish: verify is scoped to generation, prefix AND run",
      all(x in (c["verify_sql"] or "") for x in ("'gen-x'", "'100'", "'run-1'")))
c = pub_harness(lose=True, prev="2026-09-26 22:00:00+00", verify_ok=True)
pub.publish_prefix("gen-x", "100", "run-1")
check("publish: a re-publish must be stamped AFTER the previous row",
      "completed_at > '2026-09-26 22:00:00+00'" in (c["verify_sql"] or ""))
c = pub_harness(lose=True, prev=None, verify_ok=False)
try:
    pub.publish_prefix("gen-x", "100", "run-1")
    check("publish: lost response + no publish row stops", False)
except SystemExit as e:
    check("publish: lost response + no publish row stops", "post-condition is NOT met" in str(e))
check("publish: never re-sent", c["write"] == 1)

# 5b. the per-prefix publish budget covers the largest prefix, and the job outlives it
import re as _re
check("publish budget >= 90 min (largest prefix ~65 min, measured 2026-09-26)",
      pub.PUBLISH_STATEMENT_TIMEOUT_S >= 5400)
wf = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".github", "workflows",
                       "n5-generation.yml")).read()
tmin = int(_re.search(r"timeout-minutes:\s*(\d+)", wf).group(1))
msec = int(_re.search(r"MAX_SECONDS:\s*'(\d+)'", wf).group(1))
check("job timeout covers MAX_SECONDS plus one full publish budget",
      tmin * 60 >= msec + pub.PUBLISH_STATEMENT_TIMEOUT_S)

# 5. every heavy lifecycle caller supplies a post-condition
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "n5_orchestrate.py")).read()
for fn in ("n5_gen_prepare_publish", "n5_gen_record_unresolved", "n5_generation_mark_ready",
           "n5_generation_activate"):
    needle = f'heavy(f"select geo.{fn}('
    sites = [i for i in range(len(src)) if src.startswith(needle, i)]
    check(f"{fn}: called through heavy() at least once", len(sites) >= 1)
    check(f"{fn}: every heavy() call passes verify=",
          all("verify=" in src[i:src.find("\n\n", i)] for i in sites))
# the gateway cut must never be retried as a write
check("524 is not a write-retry status", 524 not in __import__("n3_pilot").SQL_RETRY_STATUS)

print(f"\n{len(FAILS)} failure(s)")
sys.exit(1 if FAILS else 0)

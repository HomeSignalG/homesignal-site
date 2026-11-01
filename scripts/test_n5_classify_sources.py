"""Map 1 treatment for sources with no geo.n5_accepted_source row (scripts/n5_classify_sources.py).

National source policy (founder, 2026-11-01): adding a source is its registry entry; Map 1 must not
need a hand-written classification row. Pins:
  1. the rule: non-ArcGIS -> PROVEN; ArcGIS with geometry -> RECOVERY; ArcGIS Table -> PROVEN;
     unreadable / error / unknown metadata -> no row (never a guess);
  2. existing rows are never re-classified, and the write is `on conflict do nothing`;
  3. nothing is written while a generation is BUILDING, or when the row read comes back empty;
  4. a dry run writes nothing;
  5. every registry entry is classifiable without a hand edit (known platform; ArcGIS has a service_url);
  6. ADAPTER_FAMILIES names exactly the families the engine adapters stamp;
  7. the orchestrator classifies BEFORE the capture in open_generation.
Run: python3 scripts/test_n5_classify_sources.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import n5_classify_sources as C  # noqa: E402

FAILS = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)


def lit(v):
    return "'" + str(v).replace("'", "''") + "'"


class FakeDB:
    def __init__(self, rows, building=0):
        self.rows = dict(rows)
        self.building = building
        self.writes = []

    def sql(self, q, tag="", read_only=False, **kw):
        if "from geo.n5_accepted_source" in q and q.lstrip().startswith("select"):
            return [{"registry_id": r} for r in self.rows]
        if "from geo.n5_generation" in q:
            return [{"n": self.building}]
        if q.lstrip().startswith("insert into geo.n5_accepted_source"):
            assert not read_only
            m = re.search(r"values \('([^']+)', '([^']+)', 0, 0\) on conflict \(registry_id\) do nothing", q)
            assert m, q
            self.writes.append((m.group(1), m.group(2)))
            self.rows.setdefault(m.group(1), m.group(2))
            return []
        raise AssertionError("unexpected sql: " + q)


META = {
    "https://x/point/0": {"type": "Feature Layer", "geometryType": "esriGeometryPoint"},
    "https://x/multi/0": {"type": "Feature Layer", "geometryType": "esriGeometryMultipoint"},
    "https://x/line/0": {"type": "Feature Layer", "geometryType": "esriGeometryPolyline"},
    "https://x/poly/0": {"type": "Feature Layer", "geometryType": "esriGeometryPolygon"},
    "https://x/table/0": {"type": "Table", "fields": []},
    "https://x/token/0": {"error": {"code": 499, "message": "Token Required"}},
    "https://x/odd/0": {"type": "Feature Layer", "geometryType": "esriGeometrySomethingNew"},
    "https://x/bare/0": {"type": "Feature Layer"},
}


def http(url, params=None, **kw):
    m = META.get(url)
    return (m, None) if m is not None else (None, "URLError timed out")


def arc(url):
    return ("arcgis", {"service_url": url})


# 1. the rule
for plat in C.NON_ARCGIS:
    check(f"1 {plat} -> PROVEN without a metadata read",
          C.derive(plat, {}, lambda *a, **k: (_ for _ in ()).throw(AssertionError("read")))[0] == "PROVEN")
for url, want in [("https://x/point/0", "RECOVERY"), ("https://x/multi/0", "RECOVERY"),
                  ("https://x/line/0", "RECOVERY"), ("https://x/poly/0", "RECOVERY"),
                  ("https://x/table/0", "PROVEN")]:
    check(f"1 arcgis {url.split('/')[3]} -> {want}", C.derive("arcgis", {"service_url": url}, http)[0] == want)
for url in ["https://x/token/0", "https://x/odd/0", "https://x/bare/0", "https://x/down/0"]:
    t, why = C.derive("arcgis", {"service_url": url}, http)
    check(f"1 arcgis {url.split('/')[3]} -> no treatment, with a reason ({why})", t is None and bool(why))
check("1 arcgis with no service_url -> no treatment", C.derive("arcgis", {}, http)[0] is None)
check("1 unknown platform -> no treatment", C.derive("ftp", {}, http)[0] is None)

# 2-4. the writer
reg = {"old": arc("https://x/point/0"), "new-poly": arc("https://x/poly/0"),
       "new-tbl": arc("https://x/table/0"), "new-down": arc("https://x/down/0"),
       "new-soc": ("socrata", {})}
db = FakeDB({"old": "RECOVERY", "(null)": "NOAUTH"})
out = C.classify_unrowed(db.sql, lit, reg, http, say=lambda *a: None)
check("2 new sources written with their derived treatment",
      sorted(db.writes) == sorted([("new-poly", "RECOVERY"), ("new-tbl", "PROVEN"),
                                   ("new-soc", "PROVEN"), ("tdlr-tabs", "PROVEN")]))
check("2 an existing row is not re-classified (old is a point layer that would derive RECOVERY too, and is not asked)",
      db.rows["old"] == "RECOVERY" and not any(w[0] == "old" for w in db.writes))
check("2 an unreadable layer is reported, not written",
      [u["registry_id"] for u in out["unresolved"]] == ["new-down"] and "new-down" not in db.rows)
db2 = FakeDB({"old": "PROVEN"}, building=1)
out2 = C.classify_unrowed(db2.sql, lit, reg, http, say=lambda *a: None)
check("3 nothing written while a generation is BUILDING", db2.writes == [] and out2["skipped"])
db3 = FakeDB({})
out3 = C.classify_unrowed(db3.sql, lit, reg, http, say=lambda *a: None)
check("3 an empty row read is a broken read: nothing written", db3.writes == [] and out3["skipped"])
db4 = FakeDB({"old": "RECOVERY"})
out4 = C.classify_unrowed(db4.sql, lit, reg, http, say=lambda *a: None, dry=True)
check("4 a dry run writes nothing and still reports what it would write",
      db4.writes == [] and len(out4["written"]) == 4)

# 5. every registry entry is classifiable as data
REG = json.load(open(os.path.join(ROOT, "supabase/functions/get-address-report/jurisdiction-registry.json")))
entries = [(plat, e) for plat, lst in REG.items() if not plat.startswith("_") for e in lst]
check(f"5 control: registry read ({len(entries)} entries)", len(entries) > 200)
bad = [e["registry_id"] for plat, e in entries
       if plat not in C.NON_ARCGIS + ("arcgis",) or (plat == "arcgis" and not e.get("service_url"))]
check("5 every entry has a known platform, and every ArcGIS entry a service_url to read", bad == [])

# 6. adapter families
tabs = open(os.path.join(ROOT, "supabase/functions/get-address-report/sources/tdlr-tabs.ts")).read()
m = re.search(r'TABS_SOURCE_FAMILY\s*=\s*"([^"]+)"', tabs)
check("6 ADAPTER_FAMILIES is exactly the families the adapters stamp",
      bool(m) and set(C.ADAPTER_FAMILIES) == {m.group(1)})

# 7. orchestrator wiring
orch = open(os.path.join(HERE, "n5_orchestrate.py")).read()
body = orch[orch.index("def open_generation("):]
body = body[:body.index("\ndef ", 1)]
check("7 open_generation classifies before the capture",
      "classify_sources()" in body and body.index("classify_sources()") < body.index("insert into preservation.app_project_identity"))
check("7 classify mode is a dry run", re.search(r"def mode_classify\(\):.*?dry=True", orch, re.S) is not None)
shard = open(os.path.join(HERE, "n5_shard.py")).read()
check("7 control: the shard still reads the treatment from geo.n5_accepted_source",
      "left join geo.n5_accepted_source a" in shard)

print(f"\n{'FAIL' if FAILS else 'PASS'}: {len(FAILS)} failing")
sys.exit(1 if FAILS else 0)

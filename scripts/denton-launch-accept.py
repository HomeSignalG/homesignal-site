#!/usr/bin/env python3
"""Final acceptance for the 32 Denton ZIP pages. READ ONLY, no network, no database.
Merges: the data audit (denton-launch-audit.py JSON), the production page test (denton-launch-pages.mjs JSON) and the committed evidence file
docs/denton-acceptance-evidence.json, then applies scripts/denton_verdict.py. Anything absent is "not established", never clean.
Usage: denton-launch-accept.py AUDIT.json PAGES.json"""
import csv, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import subprocess
if subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "denton_verdict_selftest.py")], stdout=subprocess.DEVNULL).returncode:
    sys.exit("acceptance-logic self-test failed")
from denton_verdict import verdict, po_box_verdict

audit = json.load(open(sys.argv[1])) if len(sys.argv) > 1 and os.path.exists(sys.argv[1]) else {}
pages = json.load(open(sys.argv[2])) if len(sys.argv) > 2 and os.path.exists(sys.argv[2]) else {}
EVID_FILE = "docs/denton-acceptance-evidence.json"
evid = json.load(open(EVID_FILE)) if os.path.exists(EVID_FILE) else {}
def evidence_ref(check, z):
    ref = (evid.get(check) or {}).get(z)
    return isinstance(ref, str) and len(ref.strip()) >= 8        # a non-trivial, retrievable reference (run id, doc path+anchor, commit)
PO = {r["zip"] for r in csv.DictReader(open("docs/maps-coverage/fix4/no-boundary-zip-classification.csv"))
      if r.get("zip") and "PO_BOX_ZIP" in " ".join(r.values())}
ZIPS = ("75007 75010 75022 75027 75028 75029 75033 75036 75056 75057 75065 75067 75068 75077 76201 76202 76203 76204 76205 76206 "
        "76207 76208 76209 76210 76226 76227 76247 76249 76258 76259 76262 76266").split()

def view(z, v):
    return ((pages.get(z) or {}).get(v)) or {}
def page_facts(z):
    d, m = view(z, "desktop"), view(z, "mobile")
    dm, mm = d.get("map") or {}, m.get("map") or {}
    ok_status = all(((x.get("zip_page") or {}).get("status") == 200 and not x.get("errors") and not x.get("fatal")) for x in (d, m)) and bool(d) and bool(m)
    same = bool(dm) and bool(mm) and dm.get("leaflet_markers") == mm.get("leaflet_markers") and dm.get("sites") == mm.get("sites")
    return dm, mm, ok_status, same

rows, out = [], {}
for z in ZIPS:
    a = ((audit.get("zips") or {}).get(z) or {})
    f = a.get("facts")
    dm, mm, ok_status, same = page_facts(z)
    if z in PO:
        res = po_box_verdict({"declared_po_box": True, "has_boundary": (f or {}).get("has_boundary", None),
                              "map_markers": dm.get("leaflet_markers") if dm.get("loaded") else None,
                              "honest_notice": dm.get("text_has_not_measured") if dm else None,
                              "pages_ok": (ok_status and same) if dm else None})
        kind = "PO Box"
    else:
        f = json.loads(json.dumps(f)) if f else None
        if f is not None:
            ch = f.setdefault("checks", {})
            points = sum(v for k, v in (dm.get("scopes_all") or {}).items() if k.endswith("/point")) if dm else None
            drawn_ok = bool(dm) and dm.get("loaded") and points is not None and dm.get("leaflet_markers") == points
            ch["browser_behavior"] = "complete" if (ok_status and same and drawn_ok) else "incomplete"
            ch["evidence"] = "complete" if (dm and dm.get("no_record_url") == 0 and evidence_ref("evidence", z)) else "incomplete"
            ch["source_coverage"] = "complete" if evidence_ref("source_coverage", z) else "not_run"
            ch["classification"] = "complete" if evidence_ref("classification", z) else "not_run"
        res = verdict(f)
        kind = "geographic"
    state, why, warn = res
    out[z] = {"kind": kind, "verdict": state, "reasons": why, "warnings": warn}
    rows.append(f"| {z} | {kind} | {state} | {'; '.join(why)[:260]} |")
from collections import Counter
c = Counter(v["verdict"] for v in out.values())
print("----- BEGIN DENTON ACCEPTANCE -----")
print("| ZIP | Kind | Verdict | Reasons |\n|---|---|---|---|")
print("\n".join(rows))
print(json.dumps({"counts": dict(c), "zips": out}))
print("----- END DENTON ACCEPTANCE -----")
if os.environ.get("GITHUB_STEP_SUMMARY"):
    open(os.environ["GITHUB_STEP_SUMMARY"], "a").write("## Denton acceptance\n\n" + str(dict(c)) + "\n\n| ZIP | Kind | Verdict | Reasons |\n|---|---|---|---|\n" + "\n".join(rows) + "\n")

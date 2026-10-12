"""Controlled cases the acceptance logic must get right. Run by the audit before it reads anything; exit 1 stops it."""
import copy, sys
from denton_verdict import verdict

CLEAN = {"has_boundary": True, "issues": {}, "members_without_marker": 0,
         "compare": {"match": 5, "mismatch": 0, "publisher_not_found": 0, "nonpoint_unverified": 0, "not_arcgis_unverified": 0,
                     "ambiguous_identity": 0, "comparison_unavailable": 0},
         "eligibility": {"missing": 0, "incomplete": [], "ambiguous_ids": 0},
         "source_coverage_attested": True, "page_test_ok": True}
def with_(**kw):
    f = copy.deepcopy(CLEAN)
    for k, v in kw.items():
        if isinstance(v, dict) and isinstance(f.get(k), dict): f[k].update(v)
        else: f[k] = v
    return f
CASES = [
    ("a fully verified clean ZIP can PASS", CLEAN, "PASS"),
    ("clean but source coverage not attested is UNKNOWN", with_(source_coverage_attested=False), "UNKNOWN"),
    ("zero records, coverage not attested, is UNKNOWN (absence is not evidence)", with_(compare={"match": 0}, eligibility={"missing": 0}, source_coverage_attested=False), "UNKNOWN"),
    ("page test not run is UNKNOWN", with_(page_test_ok=None), "UNKNOWN"),
    ("page test failed is UNKNOWN", with_(page_test_ok=False), "UNKNOWN"),
    ("one unverifiable line/polygon dot blocks PASS", with_(compare={"nonpoint_unverified": 1}), "UNKNOWN"),
    ("one non-ArcGIS dot blocks PASS", with_(compare={"not_arcgis_unverified": 1}), "UNKNOWN"),
    ("an ambiguous source identity blocks PASS", with_(compare={"ambiguous_identity": 1}), "UNKNOWN"),
    ("a failed publisher comparison blocks PASS", with_(compare={"comparison_unavailable": 3}), "UNKNOWN"),
    ("publisher comparison never run is UNKNOWN", with_(compare=None), "UNKNOWN"),
    ("eligibility never run is UNKNOWN", with_(eligibility=None), "UNKNOWN"),
    ("truncated/timed-out eligibility is UNKNOWN, not zero missing", with_(eligibility={"missing": 0, "incomplete": ["denton-county-dev-permits"]}), "UNKNOWN"),
    ("non-unique eligible ids block PASS", with_(eligibility={"ambiguous_ids": 2}), "UNKNOWN"),
    ("a dot outside its polygon FAILS", with_(issues={"outside_polygon": 1}), "FAIL"),
    ("a swapped lng/lat dot FAILS", with_(issues={"lnglat_reversed": 1}), "FAIL"),
    ("a dot that differs from the publisher FAILS", with_(compare={"mismatch": 1}), "FAIL"),
    ("a dot with no publisher record FAILS", with_(compare={"publisher_not_found": 1}), "FAIL"),
    ("a missing eligible record FAILS", with_(eligibility={"missing": 1}), "FAIL"),
    ("a member without a marker FAILS", with_(members_without_marker=1), "FAIL"),
    ("a duplicate marker FAILS", with_(issues={"duplicate_marker_rows": 1}), "FAIL"),
    ("a PO Box ZIP (no boundary) is never decided by map dots", {"has_boundary": False}, "UNKNOWN"),
]
bad = 0
for name, f, want in CASES:
    got = verdict(f)[0]
    ok = got == want
    bad += not ok
    print(("PASS" if ok else "FAIL") + f" — {name} (want {want}, got {got})")
# freshness must not be an input: an old-source ZIP with everything else verified still PASSES
f = with_(); f["newest_source_record"] = "2023-06-09"
ok = verdict(f)[0] == "PASS"; bad += not ok
print(("PASS" if ok else "FAIL") + " — freshness is reported, not a verdict input")
sys.exit(1 if bad else 0)

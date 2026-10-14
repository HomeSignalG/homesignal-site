"""Controlled cases the acceptance logic must get right. Run by the audit before it reads anything; exit 1 stops it."""
import copy, sys
from denton_verdict import verdict, po_box_verdict, REQUIRED_CHECKS

CLEAN = {"has_boundary": True,
         "issues": {"outside_polygon": 0, "lnglat_reversed": 0, "duplicate_marker_rows": 0, "at_centroid": 0},
         "members_without_marker": 0,
         "compare": {"match": 5, "mismatch": 0, "publisher_not_found": 0, "nonpoint_unverified": 0, "nonpoint_off_geometry": 0, "not_arcgis_unverified": 0,
                     "ambiguous_identity": 0, "comparison_unavailable": 0},
         "eligibility": {"missing": 0, "incomplete": [], "unreconcilable": [], "ambiguous_ids": 0},
         "unaudited_source_families": [],
         "checks": {c: "complete" for c in REQUIRED_CHECKS}}
def mod(**kw):
    f = copy.deepcopy(CLEAN)
    for k, v in kw.items():
        if k == "check":
            f["checks"].update(v)
        elif isinstance(v, dict) and isinstance(f.get(k), dict):
            f[k].update(v)
        else:
            f[k] = v
    return f
def drop(path):
    f = copy.deepcopy(CLEAN); d = f
    for p in path[:-1]: d = d[p]
    d.pop(path[-1], None); return f

G = [("a fully evidenced clean ZIP can PASS", CLEAN, "PASS")]
# every required check, in every non-complete state, blocks PASS
for c in REQUIRED_CHECKS:
    for bad in (None, "not_run", "skipped", "errored", "truncated", "incomplete", "complte", True, "COMPLETE"):
        G.append((f"check {c}={bad!r} is UNKNOWN", mod(check={c: bad}), "UNKNOWN"))
    G.append((f"check {c} absent is UNKNOWN", {**copy.deepcopy(CLEAN), "checks": {k: v for k, v in CLEAN["checks"].items() if k != c}}, "UNKNOWN"))
G.append(("checks block missing entirely is UNKNOWN", {k: v for k, v in CLEAN.items() if k != "checks"}, "UNKNOWN"))
# falsely clean counters: absent / null / bool / string / negative are NOT zero
for path in (("issues", "outside_polygon"), ("issues", "lnglat_reversed"), ("issues", "duplicate_marker_rows"), ("members_without_marker",),
             ("compare", "mismatch"), ("compare", "publisher_not_found"), ("compare", "nonpoint_unverified"), ("compare", "nonpoint_off_geometry"), ("compare", "not_arcgis_unverified"),
             ("compare", "ambiguous_identity"), ("compare", "comparison_unavailable"), ("eligibility", "missing"), ("eligibility", "ambiguous_ids")):
    G.append((f"counter {'.'.join(path)} absent is UNKNOWN", drop(path), "UNKNOWN"))
    for bad in (None, False, "0", -1, 0.0):
        f = copy.deepcopy(CLEAN); d = f
        for p in path[:-1]: d = d[p]
        d[path[-1]] = bad
        G.append((f"counter {'.'.join(path)}={bad!r} is UNKNOWN", f, "UNKNOWN"))
G += [
    ("issues block missing is UNKNOWN", {k: v for k, v in CLEAN.items() if k != "issues"}, "UNKNOWN"),
    ("compare block missing is UNKNOWN", {k: v for k, v in CLEAN.items() if k != "compare"}, "UNKNOWN"),
    ("compare block empty is UNKNOWN", mod(compare={}) if False else {**copy.deepcopy(CLEAN), "compare": {}}, "UNKNOWN"),
    ("eligibility block missing is UNKNOWN", {k: v for k, v in CLEAN.items() if k != "eligibility"}, "UNKNOWN"),
    ("zero records but nothing evidenced is UNKNOWN", {"has_boundary": True, "issues": {"outside_polygon": 0, "lnglat_reversed": 0, "duplicate_marker_rows": 0, "at_centroid": 0},
        "members_without_marker": 0, "compare": {"match": 0, "mismatch": 0, "publisher_not_found": 0, "nonpoint_unverified": 0, "nonpoint_off_geometry": 0, "not_arcgis_unverified": 0, "ambiguous_identity": 0, "comparison_unavailable": 0},
        "eligibility": {"missing": 0, "incomplete": [], "unreconcilable": [], "ambiguous_ids": 0}, "unaudited_source_families": [], "checks": {}}, "UNKNOWN"),
    ("unavailable publisher (comparison failed) is UNKNOWN", mod(compare={"comparison_unavailable": 3}), "UNKNOWN"),
    ("one ambiguous PermitID is UNKNOWN", mod(compare={"ambiguous_identity": 1}), "UNKNOWN"),
    ("ambiguous eligible ids are UNKNOWN", mod(eligibility={"ambiguous_ids": 2}), "UNKNOWN"),
    ("incomplete/truncated source response is UNKNOWN", mod(eligibility={"incomplete": ["denton-county-dev-permits"]}), "UNKNOWN"),
    ("registry with a measured 'not testable' reason is UNKNOWN", mod(eligibility={"unreconcilable": ["frisco-active-building-permits: geocoded from address"]}), "UNKNOWN"),
    ("unreconcilable list not reported is UNKNOWN", drop(("eligibility", "unreconcilable")), "UNKNOWN"),
    ("unreconcilable list of wrong type is UNKNOWN", mod(eligibility={"unreconcilable": "frisco"}), "UNKNOWN"),
    ("non-point eligible project missing from serving FAILS (shares the missing counter)", mod(eligibility={"missing": 3}), "FAIL"),
    ("unaudited source family is UNKNOWN", mod(unaudited_source_families=["some-socrata-feed"]), "UNKNOWN"),
    ("unaudited_source_families not reported is UNKNOWN", drop(("unaudited_source_families",)), "UNKNOWN"),
    ("line/polygon dot not geometry-checked is UNKNOWN", mod(compare={"nonpoint_unverified": 1}), "UNKNOWN"),
    ("non-ArcGIS dot not checked is UNKNOWN", mod(compare={"not_arcgis_unverified": 1}), "UNKNOWN"),
    # measured defects FAIL, even when other things are incomplete
    ("dot outside its polygon FAILS", mod(issues={"outside_polygon": 1}), "FAIL"),
    ("swapped lng/lat FAILS", mod(issues={"lnglat_reversed": 1}), "FAIL"),
    ("duplicate marker FAILS", mod(issues={"duplicate_marker_rows": 1}), "FAIL"),
    ("member without marker FAILS", mod(members_without_marker=1), "FAIL"),
    ("publisher mismatch FAILS", mod(compare={"mismatch": 1}), "FAIL"),
    ("line dot off the publisher's own line FAILS", mod(compare={"nonpoint_off_geometry": 1}), "FAIL"),
    ("publisher record not found FAILS", mod(compare={"publisher_not_found": 1}), "FAIL"),
    ("missing eligible record FAILS", mod(eligibility={"missing": 1}), "FAIL"),
    ("a FAIL stays FAIL when checks are also incomplete", mod(eligibility={"missing": 4}, check={"browser_behavior": "not_run"}), "FAIL"),
    # diagnostics are not defects
    ("a point near the centroid is a warning, not a defect", mod(issues={"at_centroid": 3}), "PASS"),
    ("boundaryless ZIP never grades as geographic", {"has_boundary": False}, "UNKNOWN"),
    ("non-dict facts are UNKNOWN", None, "UNKNOWN"),
]
bad = 0
for name, f, want in G:
    got = verdict(f)[0]
    ok = got == want
    bad += not ok
    if not ok: print(f"FAIL — {name} (want {want}, got {got})")
print(f"{len(G) - bad}/{len(G)} geographic cases correct")
w = verdict(mod(issues={"at_centroid": 3}))[2]
ok = len(w) == 1; bad += not ok; print(("PASS" if ok else "FAIL") + " — centroid warning is reported")
# freshness is not an input
f = mod(); f["newest_source_record"] = "2023-06-09"
ok = verdict(f)[0] == "PASS"; bad += not ok; print(("PASS" if ok else "FAIL") + " — freshness is reported, not a verdict input")

PB = {"declared_po_box": True, "has_boundary": False, "map_markers": 0, "honest_notice": True, "pages_ok": True}
P = [("declared PO Box, no markers, honest notice, pages ok -> PASS", PB, "PASS"),
     ("any marker on a PO Box ZIP FAILS", {**PB, "map_markers": 1}, "FAIL"),
     ("8 synthetic dots on a PO Box ZIP FAIL", {**PB, "map_markers": 8}, "FAIL"),
     ("marker count absent -> UNKNOWN", {k: v for k, v in PB.items() if k != "map_markers"}, "UNKNOWN"),
     ("marker count None -> UNKNOWN", {**PB, "map_markers": None}, "UNKNOWN"),
     ("marker count False -> UNKNOWN", {**PB, "map_markers": False}, "UNKNOWN"),
     ("not declared PO Box -> UNKNOWN", {**PB, "declared_po_box": False}, "UNKNOWN"),
     ("declared flag absent -> UNKNOWN", {k: v for k, v in PB.items() if k != "declared_po_box"}, "UNKNOWN"),
     ("a boundary exists -> UNKNOWN", {**PB, "has_boundary": True}, "UNKNOWN"),
     ("honest notice absent -> UNKNOWN", {**PB, "honest_notice": False}, "UNKNOWN"),
     ("pages not ok -> UNKNOWN", {**PB, "pages_ok": None}, "UNKNOWN"),
     ("no facts -> UNKNOWN", None, "UNKNOWN")]
pb = 0
for name, f, want in P:
    got = po_box_verdict(f)[0]
    if got != want: pb += 1; print(f"FAIL — {name} (want {want}, got {got})")
print(f"{len(P) - pb}/{len(P)} PO Box cases correct")
sys.exit(1 if (bad or pb) else 0)

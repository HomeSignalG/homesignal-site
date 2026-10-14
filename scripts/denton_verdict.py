"""Acceptance logic for the Denton launch audit (pure, no I/O) so it can be tested against controlled failure cases.

CONTRACT (checklist step 5).  PASS is reachable ONLY by positive evidence:
  * every REQUIRED check must report status exactly "complete" -- an absent, null, skipped, truncated, errored, unrecognised or misspelt status is
    "not established" and the ZIP is UNKNOWN;
  * every defect COUNTER must be present and a real integer -- a missing, null, boolean or non-numeric counter is "not established", never zero;
  * a ZIP with no records is not clean: it still needs every check, including an attested source-coverage reference;
  * freshness is never an input (reported as a fact only; no universal freshness threshold is applied here).
  FAIL    a measured defect (counter > 0 in a counter that was actually measured), regardless of what else is incomplete.
  UNKNOWN nothing failed but something is not established.
  PASS    nothing failed and every required check is complete.
DIAGNOSTIC WARNINGS (e.g. a point record close to the ZIP centroid) are reported separately and never change the verdict: only the publisher's
own geometry (a measured mismatch) can make such a dot a defect.
PO Box / non-geographic ZIPs have their own path (po_box_verdict): they are judged on honest page behaviour, never on map dots."""

REQUIRED_CHECKS = ("polygon_membership", "unique_identity", "publisher_geometry", "eligibility_reconciliation",
                   "source_coverage", "classification", "browser_behavior", "evidence", "nonpoint_geometry")

def _count(d, key):
    """Return (value, ok). ok is False when the counter is absent/null/boolean/negative/non-integer."""
    v = d.get(key) if isinstance(d, dict) else None
    if isinstance(v, bool) or not isinstance(v, int) or v < 0:
        return None, False
    return v, True

def verdict(f):
    """f: facts for one GEOGRAPHIC ZIP. Returns (state, reasons, warnings)."""
    fail, unk, warn = [], [], []
    if not isinstance(f, dict):
        return "UNKNOWN", ["no facts"], warn
    if not f.get("has_boundary"):
        return "UNKNOWN", ["no canonical boundary: use po_box_verdict for a declared PO Box ZIP"], warn

    # ---- measured defects (each counter must be genuinely measured) ----
    iss = f.get("issues")
    for key, label in (("outside_polygon", "dots outside the ZIP polygon"), ("lnglat_reversed", "dots with swapped lng/lat"),
                       ("duplicate_marker_rows", "duplicate marker rows")):
        n, ok = _count(iss, key)
        if not ok:
            unk.append(f"counter issues.{key} not measured")
        elif n:
            fail.append(f"{n} {label}")
    n, ok = _count(iss, "at_centroid")
    if ok and n:
        warn.append(f"{n} point records within 25 m of the ZIP centroid (diagnostic only; defect only if the publisher's coordinates disagree)")
    n, ok = _count(f, "members_without_marker")
    if not ok: unk.append("counter members_without_marker not measured")
    elif n: fail.append(f"{n} serving members without a marker")
    cmp_ = f.get("compare")
    for key, label in (("mismatch", "dots differ from the publisher's own coordinates"),
                       ("nonpoint_off_geometry", "line/polygon dots not on the publisher's own geometry"),
                       ("publisher_not_found", "dots whose source record the publisher does not return")):
        n, ok = _count(cmp_, key)
        if not ok: unk.append(f"counter compare.{key} not measured")
        elif n: fail.append(f"{n} {label}")
    elig = f.get("eligibility")
    n, ok = _count(elig, "missing")
    if not ok: unk.append("counter eligibility.missing not measured")
    elif n: fail.append(f"{n} eligible source records missing from serving")

    # ---- completion evidence: every required check must positively say "complete" ----
    checks = f.get("checks")
    for name in REQUIRED_CHECKS:
        st = checks.get(name) if isinstance(checks, dict) else None
        if st != "complete":
            unk.append(f"check {name}: {'absent' if st is None else repr(st)} (needs 'complete')")
    for key, label in (("nonpoint_unverified", "line/polygon dots not geometry-checked"),
                       ("not_arcgis_unverified", "dots from non-ArcGIS sources not checked"),
                       ("ambiguous_identity", "dots whose source id is shared by several official features"),
                       ("comparison_unavailable", "dots whose publisher comparison failed to run")):
        n, ok = _count(cmp_, key)
        if not ok: unk.append(f"counter compare.{key} not measured")
        elif n: unk.append(f"{n} {label}")
    inc = (elig or {}).get("incomplete") if isinstance(elig, dict) else None
    if not isinstance(inc, list): unk.append("eligibility.incomplete list not reported")
    elif inc: unk.append("eligible-record reconciliation incomplete for: " + ", ".join(sorted(map(str, inc))))
    unrec = (elig or {}).get("unreconcilable") if isinstance(elig, dict) else None
    if not isinstance(unrec, list): unk.append("eligibility.unreconcilable list not reported")
    elif unrec: unk.append("eligible-record reconciliation not testable (measured reason): " + " | ".join(sorted(map(str, unrec))))
    n, ok = _count(elig, "ambiguous_ids")
    if not ok: unk.append("counter eligibility.ambiguous_ids not measured")
    elif n: unk.append(f"{n} eligible ids are not unique at the publisher")
    ua = f.get("unaudited_source_families")
    if not isinstance(ua, list): unk.append("unaudited_source_families not reported")
    elif ua: unk.append("source families covering this ZIP not audited: " + ", ".join(sorted(map(str, ua))))

    if fail:
        return "FAIL", fail + unk, warn
    if unk:
        return "UNKNOWN", unk, warn
    return "PASS", [], warn

def po_box_verdict(f):
    """Non-geographic acceptance path for a DECLARED PO Box ZIP. f keys: declared_po_box (bool), has_boundary (must be False),
    map_markers (int, from the production page), honest_notice (bool), pages_ok (bool: HTTP 200, no errors, desktop==mobile).
    Fabricated geographic mapping (any marker) is a FAIL; anything not established is UNKNOWN."""
    fail, unk = [], []
    if not isinstance(f, dict): return "UNKNOWN", ["no facts"], []
    if f.get("declared_po_box") is not True: unk.append("not declared PO_BOX_ZIP in the classification record")
    if f.get("has_boundary") is not False: unk.append("boundary status not established as absent")
    n, ok = _count(f, "map_markers")
    if not ok: unk.append("map marker count not measured")
    elif n: fail.append(f"{n} map markers drawn on a non-geographic ZIP")
    if f.get("honest_notice") is not True: unk.append("page does not (or not verifiably) say the ZIP has no mapped area")
    if f.get("pages_ok") is not True: unk.append("live page test not passed (200, no errors, desktop==mobile)")
    if fail: return "FAIL", fail + unk, []
    if unk: return "UNKNOWN", unk, []
    return "PASS", [], []

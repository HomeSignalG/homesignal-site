"""Acceptance logic for the Denton launch audit (pure, no I/O) so it can be tested against controlled failure cases.

THREE-STATE, and PASS is hard to get on purpose:
  FAIL    a measured defect (a dot outside its polygon, a mismatch with the publisher, an eligible record missing from a COMPLETE comparison...)
  UNKNOWN anything not established: an incomplete/failed/truncated comparison, an unverifiable dot, an ambiguous identity, source coverage
          not attested, page behaviour not tested. UNKNOWN is never promoted to PASS.
  PASS    every check ran to completion, found nothing, AND the ZIP's source coverage is attested (docs/denton-source-coverage.json)
          AND the live page test passed. Zero records is not evidence: a ZIP with nothing in it passes only if its coverage is attested.
Freshness is deliberately NOT an input: it is reported as a fact, and no universal freshness threshold is applied here."""

def verdict(f):
    """f: dict of facts for one ZIP. Missing keys count as 'not established'."""
    fail, unk = [], []
    if not f.get("has_boundary"):
        return "UNKNOWN", ["no canonical boundary (PO Box / non-ZCTA): judged by the page behaviour test, never by map dots"]
    iss = f.get("issues") or {}
    for key, label in (("outside_polygon", "dots outside the ZIP polygon"), ("lnglat_reversed", "dots with swapped lng/lat"),
                       ("at_centroid", "dots sitting on the ZIP centroid"), ("duplicate_marker_rows", "duplicate marker rows")):
        if iss.get(key):
            fail.append(f"{iss[key]} {label}")
    if f.get("members_without_marker"):
        fail.append(f"{f['members_without_marker']} serving members without a marker")
    cmp_ = f.get("compare")
    if cmp_ is None:
        unk.append("publisher comparison not run")
    else:
        if cmp_.get("mismatch"):
            fail.append(f"{cmp_['mismatch']} dots differ from the publisher's own coordinates")
        if cmp_.get("publisher_not_found"):
            fail.append(f"{cmp_['publisher_not_found']} dots whose source record the publisher does not return")
        for key, label in (("nonpoint_unverified", "line/polygon dots not geometry-checked"),
                           ("not_arcgis_unverified", "dots from non-ArcGIS sources not checked"),
                           ("ambiguous_identity", "dots whose source id is shared by several official features"),
                           ("comparison_unavailable", "dots whose publisher comparison failed to run")):
            if cmp_.get(key):
                unk.append(f"{cmp_[key]} {label}")
    elig = f.get("eligibility")
    if elig is None:
        unk.append("eligible-record reconciliation not run")
    else:
        if elig.get("missing"):
            fail.append(f"{elig['missing']} eligible source records missing from serving")
        if elig.get("incomplete"):
            unk.append("eligible-record reconciliation incomplete for: " + ", ".join(sorted(elig["incomplete"])))
        if elig.get("ambiguous_ids"):
            unk.append(f"{elig['ambiguous_ids']} eligible ids are not unique at the publisher")
    if not f.get("source_coverage_attested"):
        unk.append("source coverage for this ZIP is not attested")
    if f.get("page_test_ok") is not True:
        unk.append("live page / map behaviour test not passed")
    if fail:
        return "FAIL", fail + unk
    if unk:
        return "UNKNOWN", unk
    return "PASS", []

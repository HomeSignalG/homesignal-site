#!/usr/bin/env python3
"""Emits the steady-state fixture from the SHIPPED modules, so the proof is
reproducible and cannot drift from the code it claims to test.

The sandbox has no egress to Supabase, so the five tests run server-side. What
makes that honest is that every function under test is EXTRACTED from the repo
rather than retyped: the PROVEN adapter out of docs/geo-proven-expected-geometry.sql
and the reconciler out of scripts/n5_reconcile_sql.py. The deployed bodies were
fingerprinted against these renders and matched
(reconcile acbcb54aa197d7779d9f7c8a828c056c, stage1 943f64a22b8b086453612542f53b7d2d).

stdlib only. Writes SQL to stdout; never connects to anything.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
FX = os.environ.get("FIXTURE_SCHEMA", "geo_fx7")

RELS = {"GEOM": f"{FX}.t_geom", "INCOMING": f"{FX}.t_incoming", "BOUND": f"{FX}.t_bound",
        "MEMB": f"{FX}.t_memb", "MARK": f"{FX}.t_mark", "ZCTA": f"{FX}.t_zcta",
        "REGISTRY": f"{FX}.t_registry"}
RULE = {"MIN_LINE_M": 250.0, "MIN_AREA_M2": 1000.0, "D_M": 1000.0, "DTAG": 1000}


def proven_adapter():
    """The PROVEN adapter, lifted verbatim and re-pointed at the fixture."""
    src = open(os.path.join(HERE, "..", "docs", "geo-proven-expected-geometry.sql")).read()
    i = src.index("create or replace function geo.proven_expected_geometry(")
    j = src.index("$fn$;", i) + len("$fn$;")
    body = src[i:j]
    if "revoke" in body:
        raise SystemExit("STOP: slice overran the function")
    return (body
            .replace("function geo.proven_expected_geometry(",
                     f"function {FX}.proven_expected_geometry(")
            .replace("public.app_projects", f"{FX}.t_app_projects")
            .replace("geo.n5_accepted_source", f"{FX}.t_accepted_source"))


def reconciler():
    """The Phase 5 reconciler, rendered from its own module."""
    import n5_reconcile_sql as R
    st1 = R.render(dict(R.STAGES)["geometry"], "_keys", "_run", rels=RELS, rule_params=RULE)
    rest = "\n".join(R.render(s, "_keys", "_run", rels=RELS, rule_params=RULE)
                     for n, s in R.STAGES if n != "geometry")
    return (f"create or replace function {FX}.reconcile_stage1(_keys text[], _run text)\n"
            f"returns void language plpgsql set search_path = {FX}, public as $s1$\nbegin\n"
            + st1 + "\nend $s1$;\n\n"
            f"create or replace function {FX}.reconcile(_keys text[], _run text)\n"
            f"returns void language plpgsql set search_path = {FX}, public as $r$\nbegin\n"
            f"  perform {FX}.reconcile_stage1(_keys, _run);\n" + rest + "\nend $r$;\n")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("adapter", "all"):
        sys.stdout.write(proven_adapter() + "\n\n")
    if what in ("reconciler", "all"):
        sys.stdout.write(reconciler())

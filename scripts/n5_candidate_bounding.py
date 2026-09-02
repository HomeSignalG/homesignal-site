#!/usr/bin/env python3
"""The candidate-bounding invariant for the boundary-first pass, as a checkable rule.

THE RULE: when probing a ZCTA boundary, the candidate set is the ENTIRE geometry
corpus. The only admissible narrowing is (a) the spatial prefilter the GiST index
applies from the boundary's own envelope and (b) the fail-closed eligibility
allowlist `outcome = 1 and geom is not null`.

Membership- or metadata-derived narrowing is forbidden, because it silently rebuilds
the exact defect being measured: `scripts/n5_shard.py::build_associations` joins
geo.n5_geom to `proj` (the shard's frozen slice) rather than to `bnd`, so an addition
can only ever be found for a project the legacy 3-mile method already placed in that
prefix. That is why the association layer sees over-inclusion and is nearly blind to
under-inclusion. Any predicate on zip / z3 / first_z3 / state / county, or any read of
n5_frozen or n5_association, reproduces it — and both look like ordinary performance
work, which is why this is a gate and not a comment.

Comments are stripped before scanning: the pass's own prose necessarily says "ZIP".
stdlib only.
"""

import re

FORBIDDEN_TABLES = ("n5_frozen", "n5_association")
# Word-boundary identifiers. `zcta5` is how the boundary-first pass names a boundary;
# `zip` is how the MEMBERSHIP layer names one, so the two are not interchangeable here.
FORBIDDEN_IDENTS = ("first_z3", "z3", "zip", "state", "county", "coverage")
REQUIRED = ("st_intersects", "outcome", "geom is not null")

# The identifier list alone is NOT sufficient, and finding that out is the reason this
# rule exists: a planted `join proj p on p.source_key = g.source_key` names no forbidden
# table and no forbidden column, yet it is the defect verbatim. The structural signature
# is PROJECT IDENTITY USED AS A PREDICATE. In an admissible boundary-first pass
# `source_key` is only ever selected, grouped, or written - never used to narrow which
# candidates are probed. Matching on the predicate rather than on a CTE name also
# survives a rename, which `proj` would not.
IDENTITY_PREDICATE = re.compile(r"\bsource_key\s*(?:=|<>|!=|\bin\b)|=\s*[a-z_]*\.?source_key\b")


def strip_sql_comments(sql):
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"--[^\n]*", " ", sql)
    return sql


def check_candidate_bounding(sql):
    """Return a list of violation strings. Empty list means the pass is admissible."""
    body = strip_sql_comments(sql).lower()
    out = []
    for t in FORBIDDEN_TABLES:
        if re.search(r"\b" + re.escape(t) + r"\b", body):
            out.append(f"MEMBERSHIP_TABLE:{t}")
    for ident in FORBIDDEN_IDENTS:
        if re.search(r"\b" + re.escape(ident) + r"\b", body):
            out.append(f"MEMBERSHIP_PREDICATE:{ident}")
    if IDENTITY_PREDICATE.search(body):
        out.append("MEMBERSHIP_PREDICATE:source_key_used_as_predicate")
    for r in REQUIRED:
        if r not in body:
            out.append(f"MISSING_REQUIRED:{r}")
    return out


if __name__ == "__main__":
    import json
    import sys
    print(json.dumps(check_candidate_bounding(sys.stdin.read())))

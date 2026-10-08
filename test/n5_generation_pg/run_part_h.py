#!/usr/bin/env python3
"""EXECUTABLE proof for docs/n5-generation-publish-part-h.sql and its rollback.

Part H is the production apply file for Fix 5, the pre-activation proof: the proof table and
two functions (Part D's D14) plus D12's geo.n5_generation_activate, which now refuses a
generation without a passed proof. This proves the file applies to PRODUCTION'S state - where
activate is the pre-Part-H body and the proof objects do not exist - and that the rollback
undoes it.

Builds the database run_suite.py builds (production pre-state + Parts A-D, so activate starts
as Part H's body), then:

  H0  CONTROL: live activate is Part H's, the one that refuses a generation with no proof
  H1  the rollback applies: activate is exactly the pre-Part-H production body (2ccb4d4d...),
      owner/grants/attributes unchanged, and the proof table and its rows are KEPT
  H2  a second rollback is refused and changes nothing
  H3  with the proof objects removed (production has none), Part H applies to the pre-state:
      activate is Part H's, each proof function is its DDL-of-record body, the table has
      row-level security and no visitor grant
  H4  a second Part H is refused and changes nothing

Target: N5_TEST_DSN (a THROWAWAY server), exactly as run_suite.py.
"""
import os
import sys

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_suite as rs  # noqa: E402
import build_part_h as bh  # noqa: E402
import run_part_g_rollback as rg  # noqa: E402  (the same build + file runner)

PART_H = os.path.join(rs.ROOT, "docs", "n5-generation-publish-part-h.sql")
ROLLBACK = os.path.join(rs.ROOT, "docs", "n5-generation-publish-part-h.rollback.sql")
FN = "geo.n5_generation_activate(text,text[])"
q, q1 = rs.q, rs.q1


def md5_of(conn, fn):
    return q1(conn, "select md5(prosrc) from pg_proc where oid = to_regprocedure(%s)", (fn,))


def main():
    rs.admin_dsn()
    s = rs.Suite(None, "part-h")
    _d14, _act, after, bodies = bh.slices()
    before = bh.BEFORE_MD5
    db = "n5gen_part_h"
    conn = rs.fresh_db(db)
    try:
        rg.build(conn)
        attrs0 = q1(conn, rg.ATTRS, (FN,))
        s.ok("H0 control: live activate is Part H's", md5_of(conn, FN) == after, md5_of(conn, FN))
        s.ok("H0 control: Part H's activate refuses a generation with no proof (behaviour: run_suite.py P0)",
             "has no pre-activation proof" in q1(conn, "select prosrc from pg_proc where oid=%s::regprocedure", (FN,)))
        q(conn, "insert into geo.n5_generation_proof (generation_id, baseline_generation_id, run_id, "
                "declared_no_boundary, declared_no_boundary_md5, problems, browser, passed) "
                "values ('gen-kept', null, 'r', '{11199}', 'x', '{}', '{}', false)")

        err = rg.apply_file(conn, ROLLBACK)
        s.ok("H1 rollback applies", err is None, err)
        s.ok("H1 activate is exactly the pre-Part-H production body", md5_of(conn, FN) == before, md5_of(conn, FN))
        s.ok("H1 owner, grants and attributes unchanged", q1(conn, rg.ATTRS, (FN,)) == attrs0)
        s.ok("H1 the proof table and its rows are kept",
             q1(conn, "select count(*) from geo.n5_generation_proof where generation_id='gen-kept'") == 1)
        s.ok("H1 the old activate does not mention the proof",
             "n5_generation_proof" not in q1(conn, "select prosrc from pg_proc where oid=%s::regprocedure", (FN,)))

        err = rg.apply_file(conn, ROLLBACK)
        s.ok("H2 a second rollback is refused", err is not None and "not Part H; refusing" in err, err)
        s.ok("H2 and changes nothing", md5_of(conn, FN) == before)

        # production has no proof objects before Part H
        q(conn, "drop function geo.n5_generation_record_proof(text,text,text[],jsonb)")
        q(conn, "drop function geo.n5_generation_preactivation_problems(text,text,text[])")
        q(conn, "drop table geo.n5_generation_proof")
        err = rg.apply_file(conn, PART_H)
        s.ok("H3 Part H applies to the production pre-state", err is None, err)
        s.ok("H3 activate is Part H's", md5_of(conn, FN) == after, md5_of(conn, FN))
        s.ok("H3 each proof function is its DDL-of-record body",
             md5_of(conn, "geo.n5_generation_preactivation_problems(text,text,text[])") == bodies["n5_generation_preactivation_problems"]
             and md5_of(conn, "geo.n5_generation_record_proof(text,text,text[],jsonb)") == bodies["n5_generation_record_proof"])
        s.ok("H3 the proof table has row-level security and no visitor grant",
             q1(conn, "select relrowsecurity from pg_class where oid='geo.n5_generation_proof'::regclass") is True
             and q1(conn, "select count(*) from information_schema.role_table_grants where table_schema='geo' "
                          "and table_name='n5_generation_proof' and grantee in ('anon','authenticated','PUBLIC')") == 0)
        s.ok("H3 owner, grants and attributes of activate unchanged", q1(conn, rg.ATTRS, (FN,)) == attrs0)

        err = rg.apply_file(conn, PART_H)
        s.ok("H4 a second Part H is refused", err is not None and "refusing" in err, err)
        s.ok("H4 and changes nothing", md5_of(conn, FN) == after)
    finally:
        conn.close()
        rs.drop_db(db)

    fails = s.failed()
    print("\n" + "=" * 60)
    print(f"PART-H: {len(s.results) - len(fails)} PASS / {len(fails)} FAIL")
    for f in fails:
        print(f"FAIL — {f}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

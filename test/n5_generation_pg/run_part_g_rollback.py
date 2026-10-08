#!/usr/bin/env python3
"""EXECUTABLE proof for docs/n5-generation-publish-part-g.rollback.sql.

Part G (applied to production 2026-09-29 23:56Z) added one check to
geo.n5_generation_publish_problems: canonical_zip_status_disagrees_with_boundary. This proves
the rollback that undoes it, and that Part G can be applied again afterwards.

Builds the database run_suite.py builds (the production pre-state, the seed, and PARTS A-D of
the shipped migration, so the function starts as Part G's body), then:

  R0  CONTROL. Live body is Part G's, and a deliberately wrong status row (a ZIP with a
      boundary published as not_measured) is reported by the check. The probe sees the
      defect it exists to catch, so its later silence means something.
  R1  the rollback applies: the body is exactly the pre-Part-G production body, owner, grants
      and attributes are unchanged, the same wrong row is no longer reported, and every other
      check answers exactly as before
  R2  a second rollback is refused (the live body is no longer Part G's) and changes nothing
  R3  Part G applies again on top of the rollback and lands the same body; a second Part G is
      refused

Target: N5_TEST_DSN (a THROWAWAY server), exactly as run_suite.py.
"""
import os
import sys

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_suite as rs  # noqa: E402  (same fixture, seed, migration split and helpers)
import build_part_g as bg  # noqa: E402  (the fingerprints the two files are generated from)

PART_G = os.path.join(rs.ROOT, "docs", "n5-generation-publish-part-g.sql")
ROLLBACK = os.path.join(rs.ROOT, "docs", "n5-generation-publish-part-g.rollback.sql")
FN = "geo.n5_generation_publish_problems(text,text[])"
CHECK = bg.CHECK
ATTRS = ("select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'), "
         "coalesce(array_to_string(p.proconfig, ','), ''), p.prosecdef::text, p.provolatile::text, "
         "p.prorettype::regtype::text, pg_get_function_arguments(p.oid)) "
         "from pg_proc p where p.oid = %s::regprocedure")

q, q1 = rs.q, rs.q1


def after_md5():
    fn, body = bg.slice_d11(open(rs.PART_D).read())
    import hashlib
    return hashlib.md5(body.encode()).hexdigest()


def build(conn):
    q(conn, open(rs.PRESTATE).read())
    q(conn, rs.SEED)
    part_a, part_b, part_c = rs.migration_parts()
    q(conn, "set n5.verified_free_disk_mb = '2998'")
    q(conn, part_a)
    for st in part_b:
        q(conn, st)
    q(conn, part_c)
    d_a, d_b, d_c = rs.part_d_parts()
    q(conn, d_a)
    for st in d_b:
        q(conn, st)
    q(conn, d_c)
    q(conn, "reset n5.verified_free_disk_mb")


def body_md5(conn):
    return q1(conn, "select md5(prosrc) from pg_proc where oid = %s::regprocedure", (FN,))


def apply_file(conn, path):
    """Run a file holding its own begin/commit. Returns None, or the first error line.
    A failed script leaves its explicit transaction aborted, so it is rolled back here."""
    try:
        with conn.cursor() as c:
            c.execute(open(path).read())
    except psycopg2.Error as e:
        with conn.cursor() as c:
            c.execute("rollback")
        return str(e).splitlines()[0]
    return None


def problems(conn, corrupt):
    """publish_problems for the legacy generation, optionally with one wrong status row.
    The row guard refuses writes to a non-BUILDING generation, so the corruption is made with
    triggers off, inside a transaction that is always rolled back."""
    with conn.cursor() as c:
        c.execute("begin")
        try:
            if corrupt:
                c.execute("set local session_replication_role = replica")
                c.execute("update geo.maps_zip_geography_status set status = 'not_measured' "
                          "where generation_id = %s and zip = '11301'", (rs.LEGACY,))
                if c.rowcount != 1:
                    raise RuntimeError(f"corruption touched {c.rowcount} rows, expected 1")
            c.execute("select check_name, n from geo.n5_generation_publish_problems(%s, null) "
                      "order by check_name", (rs.LEGACY,))
            return [tuple(r) for r in c.fetchall()]
        finally:
            c.execute("rollback")


def main():
    rs.admin_dsn()
    s = rs.Suite(None, "part-g-rollback")
    before, after = bg.BEFORE_MD5, after_md5()
    db = "n5gen_partg_rollback"
    conn = rs.fresh_db(db)
    try:
        build(conn)
        attrs0 = q1(conn, ATTRS, (FN,))
        clean0 = problems(conn, False)
        bad0 = problems(conn, True)
        s.ok("R0 control: live body is Part G's", body_md5(conn) == after, body_md5(conn))
        s.ok("R0 control: a boundary ZIP published as not_measured is reported",
                any(c == CHECK and n == 1 for c, n in bad0), bad0)
        s.ok("R0 control: the clean fixture reports no disagreement",
                not any(c == CHECK for c, _ in clean0), clean0)

        err = apply_file(conn, ROLLBACK)
        s.ok("R1 rollback applies", err is None, err)
        s.ok("R1 body is exactly the pre-Part-G production body", body_md5(conn) == before, body_md5(conn))
        s.ok("R1 owner, grants and attributes unchanged", q1(conn, ATTRS, (FN,)) == attrs0, q1(conn, ATTRS, (FN,)))
        bad1 = problems(conn, True)
        s.ok("R1 the wrong row is no longer reported", not any(c == CHECK for c, _ in bad1), bad1)
        s.ok("R1 every other check answers exactly as before",
                [r for r in bad1 if r[0] != CHECK] == [r for r in bad0 if r[0] != CHECK]
                and problems(conn, False) == clean0, (bad0, bad1))

        err = apply_file(conn, ROLLBACK)
        s.ok("R2 a second rollback is refused", err is not None and "not Part G; refusing" in err, err)
        s.ok("R2 and changes nothing", body_md5(conn) == before, body_md5(conn))

        err = apply_file(conn, PART_G)
        s.ok("R3 Part G applies again on top of the rollback", err is None, err)
        s.ok("R3 and lands the same body", body_md5(conn) == after, body_md5(conn))
        s.ok("R3 the check is back", any(c == CHECK for c, _ in problems(conn, True)))
        err = apply_file(conn, PART_G)
        s.ok("R3 a second Part G is refused", err is not None and "refusing" in err, err)
        s.ok("R3 and changes nothing", body_md5(conn) == after, body_md5(conn))
    finally:
        conn.close()
        rs.drop_db(db)

    fails = s.failed()
    print("\n" + "=" * 60)
    print(f"PART-G-ROLLBACK: {len(s.results) - len(fails)} PASS / {len(fails)} FAIL")
    for f in fails:
        print(f"FAIL — {f}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

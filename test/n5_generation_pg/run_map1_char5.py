#!/usr/bin/env python3
"""EXECUTABLE proof for docs/map1-zip-read-char5.sql: Map 1's ZIP read uses the ZIP index.

Builds the database run_suite.py builds (the production pre-state in fixture_prestate.sql, the
seed, and PARTS A-D of the shipped N5 migration), then:

  C0  CONTROL. Before the change, the plans inside public.app_zip_projects_markers compare the
      ZIP key as text on all three serving tables. The capture sees the defect it exists to
      catch, so its later silence means something.
  R0  a drifted body is refused and nothing changes
  R1  the splice applies, and the body fingerprints to the recorded post-state
  R2  owner, grants, SECURITY DEFINER, STABLE, search_path and the 25 s timeout are unchanged
  R3  output is identical: every fixture ZIP, development and facility, authoritative and
      legacy, the invalid-input refusals, and every reader in run_suite.map_snapshot
  R4  no plan inside the function compares a ZIP key as text, and each of the three serving
      tables is read with a char-to-char ZIP comparison (the comparison its key index can
      use). Which index the planner then picks on these few fixture rows is its own choice
      and is printed, not asserted; production's plan is measured in the SQL file's header.
  R5  applying again does nothing; the rollback file restores the pre-state body byte for byte
      with the output unchanged; applying after the rollback lands the same post-state

Then MUTATION: in a fresh database per mutation, one of the five ZIP comparisons is put back
to the text p_zip, and R4 must go red. A mutation that does not change the body SURVIVES.

Target: N5_TEST_DSN (a THROWAWAY server), exactly as run_suite.py.
"""
import json
import os
import re
import sys

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_suite as rs  # noqa: E402  (same fixture, seed, migration split and helpers)

SPLICE = os.path.join(rs.ROOT, "docs", "map1-zip-read-char5.sql")
ROLLBACK = os.path.join(rs.ROOT, "docs", "map1-zip-read-char5.rollback.sql")
FN = "public.app_zip_projects_markers(text,text,boolean)"
PRE_MD5 = "5517dce94b4ed2dd9f6dc12b9c4389a8"
POST_MD5 = "4918783a335244d4a7056b4922120c1c"
TABLES = ("zip_authoritative_membership", "zip_authoritative_marker", "maps_zip_geography_status")
TEXT_COMPARE = re.compile(r"\((?:\w+\.)?(?:zcta5|zip)\)::text")   # the defect: key cast to text
CHAR_COMPARE = re.compile(r"\((?:\w+\.)?(?:zcta5|zip) = ")         # key compared as char(5)
ATTRS = ("select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'), "
         "array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text, "
         "p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid)) "
         "from pg_proc p where p.oid = %s::regprocedure")

q, q1 = rs.q, rs.q1


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


def refusal(conn, sql, args=None):
    """(sqlstate, first line) of an error, or None. The connection is autocommit."""
    try:
        with conn.cursor() as c:
            c.execute(sql, args)
    except psycopg2.Error as e:
        return (e.pgcode, str(e).splitlines()[0])
    return None


def outputs(conn):
    """Everything the function answers on the fixture, plus the refusals, plus map_snapshot."""
    out = {}
    for z in rs.ZIPS:
        for kind in ("development", "facility"):
            for auth in (True, False):
                out[f"{z}/{kind}/{auth}"] = q1(conn, "select public.app_zip_projects_markers(%s,%s,%s)", (z, kind, auth))
    for bad in ("1234", "abcde", "977021", "11101 ", None):
        out[f"refusal/{bad}"] = refusal(conn, "select public.app_zip_projects_markers(%s,'development',true)", (bad,))
    out["refusal/kind"] = refusal(conn, "select public.app_zip_projects_markers('11101','other',true)")
    out["snapshot"] = rs.map_snapshot(conn)
    return json.dumps(out, sort_keys=True, default=str)


def plans_inside(conn):
    """Every plan executed INSIDE the function for each fixture ZIP and kind, as parsed JSON.
    auto_explain logs nested statements at LOG, and client_min_messages=log hands them to the
    client. DISCARD PLANS first: PL/pgSQL keeps its statements' plans across calls, so without
    it the capture would show plans made before the body or the settings changed."""
    for s in ("load 'auto_explain'", "set auto_explain.log_min_duration = 0",
              "set auto_explain.log_nested_statements = on", "set auto_explain.log_format = 'json'",
              "set enable_seqscan = off", "discard plans", "set client_min_messages = log"):
        q(conn, s)
    plans = []
    dec = json.JSONDecoder()
    try:
        for z in rs.ZIPS:
            for kind in ("development", "facility"):
                del conn.notices[:]
                q(conn, "select public.app_zip_projects_markers(%s,%s,true)", (z, kind))
                for n in conn.notices:
                    at = n.find("plan:")
                    start = n.find("{", at) if at >= 0 else -1
                    if start >= 0:
                        plans.append(dec.raw_decode(n[start:])[0])
    finally:
        q(conn, "reset client_min_messages")
        q(conn, "reset enable_seqscan")
        q(conn, "set auto_explain.log_min_duration = -1")
    return plans


def plan_facts(conn, plans):
    """(text comparisons seen, per serving table: compared char-to-char, and whether the key
    sat in an index condition). A Bitmap Index Scan carries only an index name, so indexes
    are mapped to their table."""
    idx_table = {r["idx"]: r["tbl"] for r in q(conn, """
        select ci.relname as idx, ct.relname as tbl from pg_index i
          join pg_class ci on ci.oid = i.indexrelid join pg_class ct on ct.oid = i.indrelid
         where ct.relnamespace = 'geo'::regnamespace""")}
    text_cmp = []
    as_char = {t: False for t in TABLES}
    in_index = {t: False for t in TABLES}
    for p in plans:
        stack = [p["Plan"]]
        while stack:
            node = stack.pop()
            stack.extend(node.get("Plans", []))
            tbl = node.get("Relation Name") or idx_table.get(node.get("Index Name"))
            for key in ("Index Cond", "Filter", "Recheck Cond", "Join Filter", "Hash Cond"):
                cond = node.get(key) or ""
                if TEXT_COMPARE.search(cond):
                    text_cmp.append(f"{tbl}: {key}: {cond}")
                if tbl in as_char and CHAR_COMPARE.search(cond):
                    as_char[tbl] = True
                    if key in ("Index Cond", "Recheck Cond"):
                        in_index[tbl] = True
    return text_cmp, as_char, in_index


def r4(conn):
    plans = plans_inside(conn)
    text_cmp, as_char, in_index = plan_facts(conn, plans)
    ok = len(plans) > 0 and not text_cmp and all(as_char.values())
    return ok, (text_cmp[:3], {"plans": len(plans), "char_compare": as_char, "in_index_cond": in_index})


def run_base():
    s = rs.Suite(None, "map1-char5")
    db = "map1_char5"
    c = rs.fresh_db(db)
    try:
        build(c)
        s.ok("control: the fixture's body is production's pre-state (md5 5517dce9...)", body_md5(c) == PRE_MD5, body_md5(c))

        plans = plans_inside(c)
        text_cmp, _, _ = plan_facts(c, plans)
        on = {t for t in TABLES if any(x.startswith(t + ":") for x in text_cmp)}
        s.ok("C0 CONTROL: before the change the capture sees plans inside the function comparing the "
             "ZIP key as text, on all three serving tables", len(plans) > 0 and on == set(TABLES),
             f"{len(plans)} plans; text compares on {sorted(on)}")

        pre_out = outputs(c)
        attrs_pre = q1(c, ATTRS, (FN,))

        # R0: a drifted body is refused and nothing changes
        with c.cursor() as cur:
            cur.execute("begin")
            cur.execute(f"""do $d$ begin execute replace(pg_get_functiondef('{FN}'::regprocedure),
                            '  v_status   text;', '  v_status   text; -- drift'); end $d$""")
            err = None
            try:
                cur.execute(open(SPLICE).read())
            except psycopg2.Error as e:
                err = str(e).splitlines()[0]
            cur.execute("rollback")
        s.ok("R0 a drifted body is refused, and nothing changed", err is not None and "drifted" in err
             and body_md5(c) == PRE_MD5, err)

        q(c, open(SPLICE).read())
        s.ok("R1 the splice applies; the body fingerprints to the post-state (md5 4918783a...)",
             body_md5(c) == POST_MD5, body_md5(c))
        s.ok("R2 owner, grants, SECURITY DEFINER, STABLE, search_path and the 25 s timeout are unchanged",
             q1(c, ATTRS, (FN,)) == attrs_pre and "statement_timeout=25s" in attrs_pre, q1(c, ATTRS, (FN,)))
        post_out = outputs(c)
        s.ok("R3 output identical: every fixture ZIP x kind x mode, the refusals, and map_snapshot",
             post_out == pre_out)
        ok, detail = r4(c)
        s.ok("R4 no plan inside the function compares a ZIP key as text; all three serving tables "
             "are read with a char-to-char ZIP comparison", ok, detail)
        print(f"INFO — plans captured {detail[1]['plans']}; ZIP in an index condition (planner's "
              f"choice on fixture rows): {detail[1]['in_index_cond']}")

        del c.notices[:]
        q(c, open(SPLICE).read())
        s.ok("R5a applying again does nothing and says so",
             body_md5(c) == POST_MD5 and any("already applied" in n for n in c.notices))
        q(c, open(ROLLBACK).read())
        s.ok("R5b the rollback restores the pre-state body byte for byte, output unchanged",
             body_md5(c) == PRE_MD5 and q1(c, ATTRS, (FN,)) == attrs_pre and outputs(c) == pre_out)
        q(c, open(SPLICE).read())
        s.ok("R5c applying after the rollback lands the same post-state", body_md5(c) == POST_MD5
             and outputs(c) == pre_out and r4(c)[0])
    finally:
        c.close()
        rs.drop_db(db)
    return s


MUTATIONS = [
    ("M1 the status lookup compares the text p_zip", "s.zip = v_zip", 1),
    ("M2 the facility check compares the text p_zip", "mm.zcta5 = v_zip", 1),
    ("M3 the project read compares the text p_zip", "mm.zcta5 = v_zip", 2),
    ("M4 the membership count compares the text p_zip", "mm.zcta5 = v_zip", 3),
    ("M5 the marker read compares the text p_zip", "k.zcta5 = v_zip", 1),
]


def nth_replace(text, needle, repl, n):
    at = -1
    for _ in range(n):
        at = text.find(needle, at + 1)
        if at < 0:
            return text
    return text[:at] + repl + text[at + len(needle):]


def run_mutations():
    survivors = []
    for i, (name, needle, n) in enumerate(MUTATIONS):
        db = f"map1_char5_mut{i}"
        c = rs.fresh_db(db)
        try:
            build(c)
            q(c, open(SPLICE).read())
            before = body_md5(c)
            d = q1(c, "select pg_get_functiondef(%s::regprocedure)", (FN,))
            q(c, nth_replace(d, needle, needle.replace("v_zip", "p_zip"), n))
            if body_md5(c) == before:
                print(f"SURVIVED — {name}  (the mutation did not change the body)")
                survivors.append(name)
                continue
            ok, detail = r4(c)
            print(f"{'SURVIVED' if ok else 'KILLED'} — {name}  (R4: {detail[0][:1]})")
            if ok:
                survivors.append(name)
        finally:
            c.close()
            rs.drop_db(db)
    return survivors


def main():
    rs.admin_dsn()
    base = run_base()
    fails = base.failed()
    print("\n" + "=" * 60)
    print("MUTATION PASS — each reverted comparison must turn R4 red")
    survivors = run_mutations()
    print("\n" + "=" * 60)
    print(f"MAP1-CHAR5: {len(base.results) - len(fails)} PASS / {len(fails)} FAIL · MUTATIONS: "
          f"{len(MUTATIONS) - len(survivors)} killed / {len(survivors)} survived")
    for f in fails:
        print(f"FAIL — {f}")
    for m in survivors:
        print(f"FAIL — mutation survived: {m}")
    return 1 if (fails or survivors) else 0


if __name__ == "__main__":
    sys.exit(main())

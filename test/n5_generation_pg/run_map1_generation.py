#!/usr/bin/env python3
"""EXECUTABLE proof for docs/map1-zip-read-generation.sql: Map 1's ZIP read becomes ONE function
that reads a NAMED generation, so the pre-activation proof can render a candidate through the
exact code residents run, and Map 1 itself is unchanged.

Builds production's current reader (run_map1_pick: md5 371f1fcf...), adds a BUILDING candidate
generation `gen-x` whose rows differ from the serving ones in four known ways, then:

  C0  CONTROL: the reader is the pre-state and the generation read does not exist yet
  R0  refusals, each changing nothing: a drifted reader; a generation read with another body
  R1  the file applies; reader 83f36dcc..., generation read 0c8b9f8f...
  R2  the reader keeps owner, grants, SECURITY DEFINER, STABLE, search_path and timeout; the
      generation read is executable by no visitor role (anon, authenticated, PUBLIC)
  R3  every answer Map 1 gives is byte-identical: every fixture ZIP, both kinds, authoritative
      and legacy, as the owner AND as anon
  R4  the generation read of the SERVING generation equals Map 1's answer on every ZIP and kind
  R5  the generation read of gen-x shows gen-x: dev:P1 gone from 11101, the moved marker, the
      added member in 11201, 11301 not_measured - and Map 1 still shows the serving rows
  R6  a generation that does not exist reads 'unknown'; with NO serving generation Map 1 reads
      'unknown' (as before), never another generation's rows
  R7  the reader names no serving view and no base table any more; the generation read names
      no serving view
  R8  re-applying does nothing; the rollback restores the reader byte for byte (answers equal);
      applying again lands R1

Then MUTATION: in a fresh database per mutation the shipped functions are broken one way after
the apply, and the behavioural checks (R2-R6) must go red.

Target: N5_TEST_DSN (a THROWAWAY server), exactly as run_suite.py.
"""
import json
import os
import sys

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_suite as rs  # noqa: E402
import run_map1_pick as pk  # noqa: E402  (production's current reader)

DOC = os.path.join(rs.ROOT, "docs", "map1-zip-read-generation.sql")
ROLLBACK_DOC = os.path.join(rs.ROOT, "docs", "map1-zip-read-generation.rollback.sql")
MK = "public.app_zip_projects_markers(text,text,boolean)"
AT = "geo.n5_zip_projects_markers_at(text,text,text)"
MK_PRE = "371f1fcfdfaf412b7de1a8a0bd7618ae"
MK_POST = "83f36dcc7babb2db4e75fc136297519f"
AT_MD5 = "0c8b9f8f8496a8ed0315c6c257669ae8"
ATTRS = pk.ATTRS
q, q1 = rs.q, rs.q1
GEN_X = "gen-x"
ZIPS = ("11101", "11102", "11199", "11201", "11301", "99999")
KINDS = ("development", "facility")

# A BUILDING candidate: the serving rows, copied, with four known differences.
SEED_X = f"""
insert into geo.n5_generation (generation_id, snapshot_id, cutoff, state, note)
values ('{GEN_X}', 'snapX', now(), 'BUILDING', 'run_map1_generation fixture');
insert into geo.zip_authoritative_membership (generation_id, zcta5, source_key, lat, lng, point_rule, clip_dim,
                                              feature_count, geom_family, run_id, record_kind)
select '{GEN_X}', zcta5, source_key, lat, lng, point_rule, clip_dim, feature_count, geom_family, 'x', record_kind
  from geo.zip_authoritative_membership where generation_id = geo.n5_serving_generation_id();
insert into geo.zip_authoritative_marker (generation_id, zcta5, source_key, marker_seq, lat, lng, marker_rule, family,
                                          dim, run_id, record_kind)
select '{GEN_X}', zcta5, source_key, marker_seq, lat, lng, marker_rule, family, dim, 'x', record_kind
  from geo.zip_authoritative_marker where generation_id = geo.n5_serving_generation_id();
insert into geo.maps_zip_geography_status (generation_id, zip, status, membership_rows, completed_at, run_id, note)
select '{GEN_X}', zip, status, membership_rows, now(), 'x', note
  from geo.maps_zip_geography_status where generation_id = geo.n5_serving_generation_id();
-- (1) dev:P1 leaves 11101
delete from geo.zip_authoritative_marker where generation_id = '{GEN_X}' and zcta5 = '11101' and source_key = 'dev:P1';
delete from geo.zip_authoritative_membership where generation_id = '{GEN_X}' and zcta5 = '11101' and source_key = 'dev:P1';
-- (2) dev:P2's marker in 11102 moves
update geo.zip_authoritative_marker set lat = 42.5, lng = -71.5
 where generation_id = '{GEN_X}' and zcta5 = '11102' and source_key = 'dev:P2';
-- (3) dev:P2 joins 11201
insert into geo.zip_authoritative_membership (generation_id, zcta5, source_key, lat, lng, point_rule, clip_dim,
                                              feature_count, geom_family, run_id, record_kind)
values ('{GEN_X}', '11201', 'dev:P2', 1.0, 1.0, 'POINT_MIN_XY', 0, 1, 'ST_Point', 'x', 'development');
insert into geo.zip_authoritative_marker (generation_id, zcta5, source_key, marker_seq, lat, lng, marker_rule, family,
                                          dim, run_id, record_kind)
values ('{GEN_X}', '11201', 'dev:P2', 1, 1.0, 1.0, 'POINT_AUTHORITATIVE', 'ST_Point', 0, 'x', 'development');
-- (4) 11301 is not measured in gen-x
update geo.maps_zip_geography_status set status = 'not_measured'
 where generation_id = '{GEN_X}' and zip = '11301';
-- The deferred Unit A invariant: a boundary_complete status declares exactly its membership
-- count, and the boundary membership holds the same rows.
insert into geo.n5_boundary_membership (generation_id, zcta5, source_key, provenance, run_id)
select generation_id, zcta5, source_key, 'fixture', 'x'
  from geo.zip_authoritative_membership where generation_id = '{GEN_X}';
update geo.maps_zip_geography_status s
   set membership_rows = (select count(*) from geo.zip_authoritative_membership m
                           where m.generation_id = s.generation_id and m.zcta5 = s.zip)
 where s.generation_id = '{GEN_X}' and s.status = 'boundary_complete';
"""


def build(conn):
    pk.build(conn)
    pk.apply(conn)
    q(conn, SEED_X)


def md5_of(conn, fn):
    return q1(conn, "select md5(prosrc) from pg_proc where oid = to_regprocedure(%s)", (fn,))


def refusal(conn, sql):
    try:
        with conn.cursor() as c:
            c.execute(sql)
    except psycopg2.Error as e:
        return str(e).splitlines()[0]
    return None


def answers(conn, role=None):
    """Every answer Map 1 gives on the fixture, as canonical JSON text."""
    out = {}
    if role:
        q(conn, f"set role {role}")
    try:
        for z in ZIPS:
            for k in KINDS:
                for auth in (True, False):
                    out[f"{z}|{k}|{auth}"] = q1(conn, "select public.app_zip_projects_markers(%s,%s,%s)::text",
                                                (z, k, auth))
    finally:
        if role:
            q(conn, "reset role")
    return out


def at(conn, gen, z, k="development"):
    return q1(conn, "select geo.n5_zip_projects_markers_at(%s,%s,%s)", (gen, z, k))


def refs(j):
    return sorted(p["project_ref"] for p in (j.get("projects") or []))


def markers(j):
    return sorted((m["project_ref"], m["marker_seq"], m["lat"], m["lng"]) for m in (j.get("markers") or []))


def can_exec(conn, role):
    return q1(conn, "select has_function_privilege(%s, %s::regprocedure, 'execute')", (role, AT))


def behaviour(conn, s, before):
    """R2-R7: everything a mutation must break at least one of."""
    s.ok("R2a the reader keeps owner, grants, SECURITY DEFINER, STABLE, search_path and timeout",
         q1(conn, ATTRS, (MK,)) == before["attrs"], (q1(conn, ATTRS, (MK,)), before["attrs"]))
    s.ok("R2b the generation read is executable by no visitor role (anon, authenticated, PUBLIC)",
         not can_exec(conn, "anon") and not can_exec(conn, "authenticated") and not can_exec(conn, "public"),
         [can_exec(conn, r) for r in ("anon", "authenticated", "public")])
    s.ok("R3a every answer Map 1 gives is byte-identical (owner)", answers(conn) == before["answers"])
    s.ok("R3b every answer Map 1 gives is byte-identical (anon)", answers(conn, "anon") == before["anon"])
    serving = q1(conn, "select geo.n5_serving_generation_id()")
    same = all(q1(conn, "select geo.n5_zip_projects_markers_at(%s,%s,%s) = public.app_zip_projects_markers(%s,%s,true)",
                  (serving, z, k, z, k)) for z in ZIPS for k in KINDS)
    s.ok("R4 the generation read of the serving generation equals Map 1 on every ZIP and kind", same)
    x101, x102, x201, x301 = (at(conn, GEN_X, z) for z in ("11101", "11102", "11201", "11301"))
    s101, s102 = at(conn, serving, "11101"), at(conn, serving, "11102")
    s.ok("R5a gen-x: dev:P1 is gone from 11101 (serving still has it)",
         "dev:P1" not in refs(x101) and "dev:P1" in refs(s101)
         and refs(x101) == [r for r in refs(s101) if r != "dev:P1"], (refs(x101), refs(s101)))
    moved = [m for m in markers(x102) if m[0] == "dev:P2"]
    s.ok("R5b gen-x: dev:P2's moved marker in 11102 reads gen-x's coordinate",
         moved == [("dev:P2", 1, 42.5, -71.5)] and markers(s102) != markers(x102), moved)
    s.ok("R5c gen-x: dev:P2 joins 11201 (serving 11201 has no member)",
         refs(x201) == ["dev:P2"] and refs(at(conn, serving, "11201")) == [], refs(x201))
    s.ok("R5d gen-x: 11301 reads not_measured with no projects",
         x301.get("status") == "not_measured" and x301.get("projects") is None, x301)
    s.ok("R5e Map 1 still shows the serving rows while gen-x exists",
         refs(q1(conn, "select public.app_zip_projects_markers('11101','development',true)")) == refs(s101)
         and "dev:P1" in refs(s101))
    s.ok("R6a a generation that does not exist reads 'unknown' everywhere",
         all(at(conn, "no-such-generation", z).get("status") == "unknown" for z in ZIPS))
    with conn.cursor() as cur:
        cur.execute("begin")
        cur.execute("update geo.n5_generation set state='SUPERSEDED' where state in ('ACTIVE','ACTIVE_LEGACY')")
        cur.execute("select public.app_zip_projects_markers('11101','development',true)->>'status'")
        st = cur.fetchone()[0]
        cur.execute("rollback")
    s.ok("R6b with NO serving generation Map 1 reads 'unknown', never a candidate's rows", st == "unknown", st)
    src = q1(conn, "select prosrc from pg_proc where oid = %s::regprocedure", (MK,))
    at_src = q1(conn, "select prosrc from pg_proc where oid = to_regprocedure(%s)", (AT,)) or ""
    views = ("n5_serving_status", "n5_serving_membership", "n5_serving_marker")
    base = ("zip_authoritative_membership", "zip_authoritative_marker", "maps_zip_geography_status")
    s.ok("R7 the reader names no serving view or base table; the generation read names no serving view",
         not any(v in src for v in views + base)
         and "n5_zip_projects_markers_at(geo.n5_serving_generation_id(), p_zip, p_kind)" in src
         and bool(at_src) and not any(v in at_src for v in views)
         and all(b in at_src for b in base),
         [v for v in views + base if v in src] + [v for v in views if v in at_src])


def snapshot(conn):
    return {"attrs": q1(conn, ATTRS, (MK,)), "answers": answers(conn), "anon": answers(conn, "anon")}


def run_base():
    s = rs.Suite(None, "map1-generation")
    db = "map1_generation"
    c = rs.fresh_db(db)
    try:
        build(c)
        s.ok("C0 CONTROL: the reader is production's pre-state and the generation read does not exist",
             md5_of(c, MK) == MK_PRE and md5_of(c, AT) is None, (md5_of(c, MK), md5_of(c, AT)))
        before = snapshot(c)
        x = at_before = None
        s.ok("C1 CONTROL: gen-x really differs from the serving generation (rows were seeded)",
             q1(c, "select count(*) from geo.zip_authoritative_membership where generation_id=%s", (GEN_X,)) == 9)
        doc = open(DOC).read()

        with c.cursor() as cur:
            cur.execute("begin")
            cur.execute(f"""do $d$ begin execute replace(pg_get_functiondef('{MK}'::regprocedure),
                            '  v_markers  jsonb;', '  v_markers  jsonb; -- drift'); end $d$""")
            err = None
            try:
                cur.execute(doc)
            except psycopg2.Error as e:
                err = str(e).splitlines()[0]
            cur.execute("rollback")
        s.ok("R0a a drifted reader is refused, and nothing changed",
             err is not None and "drifted" in err and md5_of(c, MK) == MK_PRE and md5_of(c, AT) is None, err)
        with c.cursor() as cur:
            cur.execute("begin")
            cur.execute("create function geo.n5_zip_projects_markers_at(p_generation_id text, p_zip text, p_kind text) "
                        "returns jsonb language sql stable as $x$ select '{}'::jsonb $x$")
            err = None
            try:
                cur.execute(doc)
            except psycopg2.Error as e:
                err = str(e).splitlines()[0]
            cur.execute("rollback")
        s.ok("R0b an existing generation read with another body is refused, and nothing changed",
             err is not None and "another body" in err and md5_of(c, MK) == MK_PRE and md5_of(c, AT) is None, err)

        q(c, doc)
        s.ok("R1 the file applies; reader 83f36dcc..., generation read 0c8b9f8f...",
             md5_of(c, MK) == MK_POST and md5_of(c, AT) == AT_MD5, (md5_of(c, MK), md5_of(c, AT)))
        behaviour(c, s, before)

        notices_before = len(c.notices)
        q(c, doc)
        s.ok("R8a re-applying does nothing (says so)",
             md5_of(c, MK) == MK_POST and any("already applied" in n for n in c.notices[notices_before:]))
        q(c, open(ROLLBACK_DOC).read())
        s.ok("R8b the rollback restores the reader byte for byte; answers equal; the generation read is kept",
             md5_of(c, MK) == MK_PRE and md5_of(c, AT) == AT_MD5 and answers(c) == before["answers"]
             and q1(c, ATTRS, (MK,)) == before["attrs"], md5_of(c, MK))
        q(c, doc)
        s.ok("R8c applying again lands R1", md5_of(c, MK) == MK_POST and md5_of(c, AT) == AT_MD5)
    finally:
        c.close()
        rs.drop_db(db)
    return s


MUTATIONS = {
    "N1 the generation read stops filtering markers by generation": f"""
        do $m$ begin execute replace(pg_get_functiondef('{AT}'::regprocedure),
          'k.generation_id = p_generation_id and k.zcta5 = v_zip', 'k.zcta5 = v_zip'); end $m$;""",
    "N2 the generation read takes its status from the serving view": f"""
        do $m$ begin execute replace(pg_get_functiondef('{AT}'::regprocedure),
          'from geo.maps_zip_geography_status s where s.generation_id = p_generation_id and s.zip = v_zip',
          'from geo.n5_serving_status s where s.zip = v_zip'); end $m$;""",
    "N3 Map 1 reads the newest generation instead of the serving one": f"""
        do $m$ begin execute replace(pg_get_functiondef('{MK}'::regprocedure),
          'geo.n5_zip_projects_markers_at(geo.n5_serving_generation_id(), p_zip, p_kind)',
          'geo.n5_zip_projects_markers_at((select generation_id from geo.n5_generation order by opened_at desc limit 1), p_zip, p_kind)'); end $m$;""",
    "N4 a visitor role can execute the generation read": f"grant execute on function {AT} to anon;",
    "N5 the generation read filters membership but not its projects' membership count": f"""
        do $m$ begin execute replace(pg_get_functiondef('{AT}'::regprocedure),
          'select count(*) from geo.zip_authoritative_membership mm where mm.generation_id = p_generation_id and mm.zcta5 = v_zip',
          'select count(*) from geo.zip_authoritative_membership mm where mm.zcta5 = v_zip'); end $m$;""",
}


def run_mutations():
    survivors = []
    for i, (name, sql) in enumerate(MUTATIONS.items()):
        db = f"map1_gen_mut{i}"
        c = rs.fresh_db(db)
        s = rs.Suite(None, name.split()[0])
        try:
            build(c)
            before = snapshot(c)
            q(c, open(DOC).read())
            pre = (md5_of(c, MK), md5_of(c, AT), q1(c, "select proacl::text from pg_proc where oid=to_regprocedure(%s)", (AT,)))
            q(c, sql)
            if (md5_of(c, MK), md5_of(c, AT), q1(c, "select proacl::text from pg_proc where oid=to_regprocedure(%s)", (AT,))) == pre:
                raise RuntimeError("MUTATION DID NOT APPLY")
            behaviour(c, s, before)
            red = s.failed()
        except RuntimeError as e:
            red = []
            print(f"   {e}")
        except Exception as e:
            red = s.failed()[:1] + [f"aborted: {str(e).splitlines()[0]}"]
        finally:
            c.close()
            rs.drop_db(db)
        print(f"{'KILLED' if red else 'SURVIVED'} — {name}  ({red[:2]})")
        if not red:
            survivors.append(name)
    return survivors


def main():
    base = run_base()
    fails = base.failed()
    print("\n" + "=" * 60)
    survivors = run_mutations()
    print("\n" + "=" * 60)
    print(f"MAP1-GENERATION: {len(base.results) - len(fails)} PASS / {len(fails)} FAIL · MUTATIONS: "
          f"{len(MUTATIONS) - len(survivors)} killed / {len(survivors)} survived")
    for f in fails:
        print(f"FAIL — {f}")
    for m in survivors:
        print(f"FAIL — mutation survived: {m}")
    return 1 if (fails or survivors) else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""EXECUTABLE proof for docs/map1-representative-newest.sql: each Map 1 pin and each ZIP-page
project is described by its source_key's NEWEST record, chosen by one shared rule.

Builds the database run_map1_char5.py builds (the production pre-state, the seed, PARTS A-D of
the N5 migration and the char5 splice), turns the ZIP page's reader into production's exact
body (the fixture lacks five comment lines; the result must fingerprint to f10327fe...), then
seeds copies so that the lowest-id row is NOT the newest:
  dev:P1  an OLDER record with the lowest id                (date decides)
  dev:P2  a stale copy (lowest id) and a newer copy, same date (last_seen_at decides)
  dev:P5  an UNDATED row with the lowest id                 (nulls last)
  dev:P3  an older copy with the HIGHEST id                 (control: nothing changes)
  dev:PX  a member with no app_projects row at all          (attributes_missing, unchanged)
A Python oracle, independent of the SQL, states which row is the newest and which the
lowest id.

  C0  CONTROL. Before the change both readers show the LOWEST-ID row on every member, and that
      differs from the newest row on at least 4 pins. So the seed exercises the change.
  R0  refusals, each leaving everything unchanged: PART B before PART A; a drifted reader;
      an existing function with another body; a function anon may execute
  R1  PART A then PART B apply; the rule and both readers fingerprint to the recorded state
  R2  readers keep owner, grants, SECURITY DEFINER, STABLE and every SET clause; the rule is
      an inlinable STABLE sql set-returning function that public/anon/authenticated cannot run
  R3  both readers now show the NEWEST row on every member; every other part of every answer
      (which pins, markers, counts, status, the facility read, the not-measured ZIP, the
      member with no row) is byte-identical; a pin whose newest row is its lowest-id row is
      byte-identical too
  R4  the plans inside both readers read app_projects through an index on (source_key,
      record_kind) with no call to the rule left in the plan (it was inlined), sorted
      newest first
  R5  applying again does nothing; the rollback restores both bodies byte for byte, drops
      the rule and the index, and the answers return to C0's; applying again lands R1's state
  R6  the rollback keeps the rule while another function still calls it

Then MUTATION: in a fresh database per mutation, the file is broken one way and the suite
must go red. A mutation that does not change the file SURVIVES.

THE INGEST HALF. The third reader, public.app_development_projects_for_zips (the Rule D /
project-page read), is owned by homesignal-ingest, a PRIVATE repo this repo's CI cannot read.
When INGEST_ROOT points at an ingest checkout, the same database also proves its migration:
  I0  CONTROL: its previous DDL of record (20260928160000) shows the LOWEST-ID row
  I1  the new migration is refused while the shared rule is missing, and nothing changes
  I2  after this repo's file, it applies; the body fingerprints to its own recorded state;
      only service_role and the owner may run it
  I3  it shows the NEWEST row on every member; everything else it answers is identical
      (which members, attributes_missing, sizes-only and paged modes)
  I4  a drifted live reader is refused, and nothing changes
  I5  no call to the rule is left in its plan (inlined)
  I6  applying again does nothing; re-applying 20260928160000 restores the previous body and
      answers, after which this repo's rollback drops the rule
plus one mutation (the reader keeps its own lowest-id pick, with consistent fingerprints).
homesignal-ingest's check-map1-representative-pg.yml clones this repo and runs it with
REQUIRE_INGEST=1, so there an absent ingest half is a failure, never a skip.

Target: N5_TEST_DSN (a THROWAWAY server), exactly as run_suite.py.
"""
import hashlib
import json
import os
import re
import sys

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_suite as rs  # noqa: E402
import run_map1_char5 as c5  # noqa: E402  (same build, then the char5 splice)

DOC = os.path.join(rs.ROOT, "docs", "map1-representative-newest.sql")
ROLLBACK_DOC = os.path.join(rs.ROOT, "docs", "map1-representative-newest.rollback.sql")
CHAR5 = os.path.join(rs.ROOT, "docs", "map1-zip-read-char5.sql")
MK = "public.app_zip_projects_markers(text,text,boolean)"
AZ = "public.app_authoritative_projects_for_zip(text)"
REP = "public.app_project_representative(text,text)"
MK_PRE, MK_POST = "4918783a335244d4a7056b4922120c1c", "f67816155b6d039afe5220a257ea570c"
AZ_PRE, AZ_POST = "f10327fed96e87285fee43cad667b764", "160a745bd4dd888dcc914172ff92b9d8"
REP_MD5 = "28f6fefb57b2d7fbd64e630caf272fcf"
INDEX = "app_projects_skey_kind_date_idx"
ATTRS = c5.ATTRS
q, q1 = rs.q, rs.q1
MEMBER_ZIPS = ("11101", "11102")

# Production's ZIP-page reader carries five numbered comment lines the fixture's copy lacks.
# Measured 2026-10-02: inserting exactly these turns the fixture body (md5 77e5608c...) into
# production's (4,111 characters, md5 f10327fe...). Asserted below; never trusted.
AZ_COMMENTS = [
    ("  if n_projects <> n_membership then",
     "  -- 1. no authoritative membership silently lost by the descriptive lookup\n"),
    ("  if n_markers <> n_expected_k then", "  -- 2. no marker silently lost\n"),
    ("  select count(*) into n_bad from jsonb_array_elements(v_out) e",
     "  -- 3. every project carries a usable source_key and the fields a card renders\n"),
    ("  select count(*) into n_bad from (\n    select e->>'source_key' sk from",
     "  -- 4. no duplicate project source_key within the ZIP\n"),
    ("  select count(*) into n_bad from (\n    select e->>'source_key' sk, mk",
     "  -- 5. no duplicate (source_key, marker_seq)\n"),
]

# Copies that make the lowest id differ from the newest. ids are fixed so "lowest" is known.
EXTRA = """
insert into public.app_projects (id, source_key, record_kind, zip, name, type, status, stage, submitted_at,
                                 date_kind, source_ref, registry_id, address, developer, scope_text,
                                 source_seq, lat, lng, last_seen_at)
values
 ('00000000-0000-0000-0000-000000000001', 'dev:P1', 'development', '11102', 'Project 1 OLDER RECORD',
  'type', 'approved', 'stage', date '2019-05-01', 'issued', 'https://example.test/1-old', 'reg-pt',
  '1 Main St', 'dev', 'scope', 2, 0.6, 0.6, timestamptz '2026-09-30 00:00Z'),
 ('00000000-0000-0000-0000-000000000002', 'dev:P2', 'development', '11102', 'Project 2',
  'type', 'STALE COPY STATUS', 'stage', date '2026-01-03', 'filed', 'https://example.test/2', 'reg-ok',
  '2 Main St', 'dev', 'scope', 1, null, null, timestamptz '2026-09-01 00:00Z'),
 ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'dev:P2', 'development', '11201', 'Project 2',
  'type', 'LATEST COPY STATUS', 'stage', date '2026-01-03', 'filed', 'https://example.test/2', 'reg-ok',
  '2 Main St', 'dev', 'scope', 1, null, null, timestamptz '2026-10-01 00:00Z'),
 ('00000000-0000-0000-0000-000000000003', 'dev:P5', 'development', '11102', 'Project 5 UNDATED',
  'type', 'filed', 'stage', null, 'filed', 'https://example.test/5-undated', 'reg-pt',
  '5 Main St', 'dev', 'scope', 2, 0.3, 0.3, timestamptz '2026-10-01 00:00Z'),
 ('ffffffff-ffff-ffff-ffff-fffffffffffe', 'dev:P3', 'development', '11201', 'Project 3 OLDER, HIGHEST ID',
  'type', 'approved', 'stage', date '2018-01-01', 'issued', 'https://example.test/3-old', 'reg-pt',
  '3 Main St', 'dev', 'scope', 2, 0.5, 2.5, timestamptz '2026-10-01 00:00Z');
-- Two more members of the live generation: dev:P3 in 11102 (a key whose newest row IS its
-- lowest-id row: nothing may change), and dev:PX in 11101, whose project has no app_projects
-- row (the ZIP page reports attributes_missing; the map leaves it out). The serving tables
-- refuse writes to a generation that is not BUILDING (geo.n5_generation_row_guard), so this
-- throwaway database pauses triggers for these four inserts only.
set session_replication_role = replica;
insert into geo.zip_authoritative_membership (zcta5, source_key, lat, lng, point_rule, clip_dim, feature_count,
                                              geom_family, run_id, generation_id)
  select z, k, la, lo, 'POINT_MIN_XY', 0, 1, 'ST_Point', 'legacy', g.generation_id
    from (values ('11101','dev:PX',0.4::float8,0.4::float8), ('11102','dev:P3',0.5,1.5)) v(z, k, la, lo),
         geo.n5_generation g where g.state in ('ACTIVE', 'ACTIVE_LEGACY');
insert into geo.zip_authoritative_marker (zcta5, source_key, marker_seq, lat, lng, marker_rule, family, dim,
                                          run_id, generation_id)
  select z, k, 1, la, lo, 'POINT_AUTHORITATIVE', 'ST_Point', 0, 'legacy', g.generation_id
    from (values ('11101','dev:PX',0.4::float8,0.4::float8), ('11102','dev:P3',0.5,1.5)) v(z, k, la, lo),
         geo.n5_generation g where g.state in ('ACTIVE', 'ACTIVE_LEGACY');
update geo.maps_zip_geography_status s set membership_rows = s.membership_rows + 1
  from geo.n5_generation g
 where s.zip in ('11101', '11102') and s.generation_id = g.generation_id and g.state in ('ACTIVE', 'ACTIVE_LEGACY');
reset session_replication_role;
"""


def doc_parts(text=None):
    text = text if text is not None else open(DOC).read()
    a = text.index("-- ========================== PART A")
    b = text.index("-- ========================== PART B")
    return text[a:b], text[b:]


def rollback_parts():
    text = open(ROLLBACK_DOC).read()
    b = text.index("-- ========================== PART B'")
    a = text.index("-- ========================== PART A'")
    return text[b:a], text[a:]


def to_production_az(conn):
    fix = q1(conn, "select prosrc from pg_proc where oid = %s::regprocedure", (AZ,))
    prod = fix
    for anchor, comment in AZ_COMMENTS:
        if prod.count(anchor) != 1:
            raise SystemExit(f"STOP: fixture anchor not unique: {anchor!r}")
        prod = prod.replace(anchor, comment + anchor)
    d = q1(conn, "select pg_get_functiondef(%s::regprocedure)", (AZ,))
    if d.count(fix) != 1:
        raise SystemExit("STOP: the fixture body is not unique in its definition")
    q(conn, d.replace(fix, prod))


def build(conn):
    c5.build(conn)
    q(conn, open(CHAR5).read())
    to_production_az(conn)
    q(conn, EXTRA)
    # Production's default ACL: a function created in public is directly executable by anon,
    # authenticated and service_role (not only through PUBLIC). Without this the anon checks
    # would pass because the fixture never granted anything, not because the file revoked it.
    q(conn, "alter default privileges for role postgres in schema public "
            "grant execute on functions to anon, authenticated, service_role")


def md5_of(conn, fn):
    return q1(conn, "select md5(prosrc) from pg_proc where oid = to_regprocedure(%s)", (fn,))


def apply(conn, text=None):
    a, b = doc_parts(text)
    q(conn, a)
    q(conn, b)


def refusal(conn, sql):
    try:
        with conn.cursor() as c:
            c.execute(sql)
    except psycopg2.Error as e:
        return str(e).splitlines()[0]
    return None


def rows_by_key(conn):
    keys = [r["source_key"] for r in q(conn, """
        select distinct source_key from geo.n5_serving_membership where record_kind = 'development'""")]
    rows = q(conn, """select id::text as id, source_key, name, status, submitted_at, last_seen_at, source_seq
                        from public.app_projects
                       where record_kind = 'development' and source_key = any(%s)""", (keys,))
    out = {k: [] for k in keys}
    for r in rows:
        out[r["source_key"]].append(r)
    return out


def newest(rows):
    """THE ORACLE, independent of the SQL: newest submitted_at (undated last), then most
    recently written (unwritten last), then the lowest id (uuid order = hex string order)."""
    def key(r):
        sa, ls = r["submitted_at"], r["last_seen_at"]
        return (sa is None, -sa.toordinal() if sa else 0, ls is None, -ls.timestamp() if ls else 0, r["id"])
    return sorted(rows, key=key)[0] if rows else None


def lowest(rows):
    return min(rows, key=lambda r: r["id"]) if rows else None


def shown(conn):
    """What each reader shows for each member pin: {(reader, zip, source_key): (name, status, date)}."""
    out = {}
    for z in MEMBER_ZIPS:
        mk = q1(conn, "select public.app_zip_projects_markers(%s,'development',true)", (z,))
        for p in mk["projects"]:
            out[("map", z, p["project_ref"])] = (p["name"], p["status"], p["submitted_at"])
        az = q1(conn, "select public.app_authoritative_projects_for_zip(%s)", (z,))
        for p in az:
            if p.get("attributes_missing"):
                continue
            out[("zip_page", z, p["source_key"])] = (p["name"], p["status"], p["submitted_at"])
            out[("zip_page_id", z, p["source_key"])] = p["id"]
    return out


def oracle(conn, pick):
    by_key = rows_by_key(conn)
    out = {}
    members = q(conn, """select zcta5::text as z, source_key from geo.n5_serving_membership
                          where record_kind = 'development' and zcta5 = any(%s)""", (list(MEMBER_ZIPS),))
    for m in members:
        r = pick(by_key.get(m["source_key"], []))
        if r is None:
            continue
        d = r["submitted_at"].isoformat() if r["submitted_at"] else None
        for reader in ("map", "zip_page"):
            out[(reader, m["z"], m["source_key"])] = (r["name"], r["status"], d)
        out[("zip_page_id", m["z"], m["source_key"])] = r["id"]
    return out


def masked(conn):
    """Every answer both readers give, with the fields that come from the descriptive row
    removed. What is left must not move at all."""
    desc = {"name", "type", "type_raw", "status", "submitted_at", "date_kind", "source_ref",
            "registry_id", "impact_score", "impact_dimensions", "id", "community_id", "stage",
            "developer", "size", "investment", "jobs", "lens", "created_at", "facility_env",
            "company_esg", "address", "start_date", "end_date", "scope_text", "parties",
            "provenance", "source_key_basis", "source_seq", "last_seen_at", "record_kind",
            "impact_score"}
    out = {}
    for z in rs.ZIPS:
        for kind in ("development", "facility"):
            for auth in (True, False):
                v = q1(conn, "select public.app_zip_projects_markers(%s,%s,%s)", (z, kind, auth))
                if auth and isinstance(v, dict) and isinstance(v.get("projects"), list):
                    v = dict(v)
                    v["projects"] = sorted(
                        ({k: x for k, x in p.items() if k not in desc} for p in v["projects"]),
                        key=lambda p: json.dumps(p, sort_keys=True))
                out[f"map/{z}/{kind}/{auth}"] = v
        az = q1(conn, "select public.app_authoritative_projects_for_zip(%s)", (z,))
        out[f"zip_page/{z}"] = sorted(
            ({k: x for k, x in p.items() if k not in desc} for p in az),
            key=lambda p: json.dumps(p, sort_keys=True))
    return json.dumps(out, sort_keys=True, default=str)


def unchanged_pins(conn):
    """Answers for pins whose newest row IS the lowest-id row, compared whole."""
    by_key = rows_by_key(conn)
    same = {k for k, rows in by_key.items() if rows and newest(rows)["id"] == lowest(rows)["id"]}
    out = {}
    for z in MEMBER_ZIPS:
        az = q1(conn, "select public.app_authoritative_projects_for_zip(%s)", (z,))
        for p in az:
            if p["source_key"] in same or p.get("attributes_missing"):
                out[(z, p["source_key"])] = json.dumps(p, sort_keys=True)
    return out, same


def plans_inside(conn):
    for s in ("load 'auto_explain'", "set auto_explain.log_min_duration = 0",
              "set auto_explain.log_nested_statements = on", "set auto_explain.log_format = 'json'",
              "set auto_explain.log_verbose = on",
              "set enable_seqscan = off", "discard plans", "set log_min_messages = panic",
              "set client_min_messages = log"):
        q(conn, s)
    plans = []
    dec = json.JSONDecoder()
    try:
        for z in MEMBER_ZIPS:
            for sql in ("select public.app_zip_projects_markers(%s,'development',true)",
                        "select public.app_authoritative_projects_for_zip(%s)"):
                del conn.notices[:]
                q(conn, sql, (z,))
                for n in conn.notices:
                    at = n.find("plan:")
                    start = n.find("{", at) if at >= 0 else -1
                    if start >= 0:
                        plans.append(dec.raw_decode(n[start:])[0])
    finally:
        q(conn, "reset client_min_messages")
        q(conn, "reset log_min_messages")
        q(conn, "reset enable_seqscan")
        q(conn, "set auto_explain.log_min_duration = -1")
    return plans


def r4(conn):
    """(ok, detail): app_projects is read by an index keyed on source_key and record_kind,
    sorted newest first, and no plan node calls the rule (it was inlined)."""
    plans = plans_inside(conn)
    idx_table = {r["idx"]: r["tbl"] for r in q(conn, """
        select ci.relname as idx, ct.relname as tbl from pg_index i
          join pg_class ci on ci.oid = i.indexrelid join pg_class ct on ct.oid = i.indrelid""")}
    function_calls, reads, sorted_newest, indexes = [], 0, 0, set()
    for p in plans:
        stack = [(p["Plan"], None)]
        while stack:
            node, parent = stack.pop()
            for ch in node.get("Plans", []):
                stack.append((ch, node))
            if node.get("Node Type") == "Function Scan" and "app_project_representative" in json.dumps(node):
                function_calls.append(node.get("Function Name"))
            tbl = node.get("Relation Name") or idx_table.get(node.get("Index Name"))
            if tbl == "app_projects" and node.get("Node Type", "").startswith(("Index", "Bitmap")):
                cond = node.get("Index Cond") or node.get("Recheck Cond") or ""
                if "source_key" in cond and "record_kind" in cond:
                    reads += 1
                    indexes.add(node.get("Index Name"))
            keys = " ".join(node.get("Sort Key", []))
            if "submitted_at DESC NULLS LAST" in keys and "last_seen_at DESC NULLS LAST" in keys:
                sorted_newest += 1
    ok = len(plans) > 0 and not function_calls and reads >= 2 and sorted_newest >= 2
    return ok, {"plans": len(plans), "rule_calls_left": function_calls, "keyed_reads": reads,
                "newest_first_sorts": sorted_newest, "indexes": sorted(i for i in indexes if i)}


def base_state(conn):
    return {"mk": md5_of(conn, MK), "az": md5_of(conn, AZ), "rep": md5_of(conn, REP),
            "idx": q1(conn, "select to_regclass(%s) is not null", (f"public.{INDEX}",))}


def run_base():
    s = rs.Suite(None, "map1-representative")
    db = "map1_rep"
    c = rs.fresh_db(db)
    try:
        build(c)
        s.ok("control: both readers fingerprint to production's pre-state (map 4918783a..., ZIP page f10327fe...)",
             md5_of(c, MK) == MK_PRE and md5_of(c, AZ) == AZ_PRE, (md5_of(c, MK), md5_of(c, AZ)))
        pre_state = base_state(c)
        before = shown(c)
        low, new = oracle(c, lowest), oracle(c, newest)
        differ = [k for k in new if k[0] != "zip_page_id" and low.get(k) != new[k]]
        s.ok("C0 CONTROL: before the change every pin shows the LOWEST-ID row, and the newest row "
             "differs on at least 4 pins", before == low and len(differ) >= 4, f"{len(differ)} pins differ")
        masked_before = masked(c)
        same_before, same_keys = unchanged_pins(c)
        attrs_mk, attrs_az = q1(c, ATTRS, (MK,)), q1(c, ATTRS, (AZ,))

        a, b = doc_parts()
        err = refusal(c, b)
        s.ok("R0a PART B before PART A is refused, and nothing changed",
             err is not None and "PART A has not been applied" in err and base_state(c) == pre_state, err)

        q(c, a)
        with c.cursor() as cur:
            cur.execute("begin")
            cur.execute(f"""do $d$ begin execute replace(pg_get_functiondef('{AZ}'::regprocedure),
                            '  v_out        jsonb;', '  v_out        jsonb; -- drift'); end $d$""")
            err = None
            try:
                cur.execute(b)
            except psycopg2.Error as e:
                err = str(e).splitlines()[0]
            cur.execute("rollback")
        s.ok("R0b a drifted reader is refused, and nothing changed",
             err is not None and "drifted" in err and md5_of(c, MK) == MK_PRE and md5_of(c, REP) is None, err)

        for label, ddl, want in (
            ("another body", "create function public.app_project_representative(p_source_key text, p_record_kind text) "
                             "returns setof public.app_projects language sql stable as $x$ select p.* from public.app_projects p "
                             "where p.source_key = p_source_key and p.record_kind = p_record_kind order by p.id limit 1 $x$",
             "different body"),
            ("anon may execute", None, "anon or authenticated can execute")):
            with c.cursor() as cur:
                cur.execute("begin")
                if ddl:
                    cur.execute(ddl)
                else:
                    rep_create = re.search(r"rep_create   constant text := \$fn\$(.*?)\$fn\$;", b, re.S).group(1)
                    cur.execute(rep_create)
                    cur.execute("grant execute on function public.app_project_representative(text,text) to anon")
                err = None
                try:
                    cur.execute(b)
                except psycopg2.Error as e:
                    err = str(e).splitlines()[0]
                cur.execute("rollback")
            s.ok(f"R0c an existing rule with {label} is refused, and nothing changed",
                 err is not None and want in err and md5_of(c, MK) == MK_PRE and md5_of(c, REP) is None, err)

        q(c, b)
        s.ok("R1 PART A then PART B apply; rule 28f6fefb..., map f6781615..., ZIP page 160a745b...",
             md5_of(c, REP) == REP_MD5 and md5_of(c, MK) == MK_POST and md5_of(c, AZ) == AZ_POST,
             base_state(c))
        rep_attrs = q(c, """select l.lanname, p.provolatile, p.prosecdef, p.proisstrict, p.proretset, p.proconfig,
                                   p.prorettype::regtype::text as rt,
                                   has_function_privilege('anon', p.oid, 'execute') as anon,
                                   has_function_privilege('authenticated', p.oid, 'execute') as authd,
                                   has_function_privilege('public', p.oid, 'execute') as pub,
                                   has_function_privilege('postgres', p.oid, 'execute') as pg
                              from pg_proc p join pg_language l on l.oid = p.prolang
                             where p.oid = to_regprocedure(%s)""", (REP,))[0]
        s.ok("R2 the readers keep owner, grants, SECURITY DEFINER, STABLE and every SET clause; the rule is "
             "an inlinable STABLE sql set-returning function that public/anon/authenticated cannot run",
             q1(c, ATTRS, (MK,)) == attrs_mk and q1(c, ATTRS, (AZ,)) == attrs_az
             and "statement_timeout=25s" in attrs_mk
             and rep_attrs["lanname"] == "sql" and rep_attrs["provolatile"] == "s" and not rep_attrs["prosecdef"]
             and not rep_attrs["proisstrict"] and rep_attrs["proretset"] and rep_attrs["proconfig"] is None
             and rep_attrs["rt"] == "app_projects" and not rep_attrs["anon"] and not rep_attrs["authd"]
             and not rep_attrs["pub"] and rep_attrs["pg"], rep_attrs)

        after = shown(c)
        s.ok("R3a both readers now show the NEWEST row on every member pin", after == new,
             [k for k in new if after.get(k) != new[k]][:4])
        s.ok("R3b every other part of every answer is byte-identical (pins, markers, counts, status, "
             "facility, not-measured ZIP, the member with no row)", masked(c) == masked_before)
        same_after, _ = unchanged_pins(c)
        s.ok("R3c the pins whose newest row IS the lowest-id row (dev:P3, and dev:PX with none) are "
             "byte-identical", "dev:P3" in same_keys and same_after == same_before and len(same_after) >= 2,
             f"{len(same_after)} answers compared")

        ok, detail = r4(c)
        s.ok("R4 inside both readers app_projects is read by an index keyed on (source_key, record_kind), "
             "sorted newest first, with no call to the rule left in the plan", ok, detail)
        print(f"INFO — index the planner chose on fixture rows: {detail['indexes']}")

        del c.notices[:]
        q(c, b)
        s.ok("R5a applying PART B again does nothing and says so",
             md5_of(c, MK) == MK_POST and md5_of(c, AZ) == AZ_POST
             and sum("already applied" in n for n in c.notices) == 2)
        rb_b, rb_a = rollback_parts()
        q(c, rb_b)
        q(c, rb_a)
        s.ok("R5b the rollback restores both bodies byte for byte, drops the rule and the index, and "
             "the answers return to C0's",
             base_state(c) == pre_state and q1(c, ATTRS, (MK,)) == attrs_mk and q1(c, ATTRS, (AZ,)) == attrs_az
             and shown(c) == before and masked(c) == masked_before, base_state(c))
        apply(c)
        s.ok("R5c applying after the rollback lands R1's state", base_state(c)["mk"] == MK_POST
             and base_state(c)["az"] == AZ_POST and base_state(c)["rep"] == REP_MD5 and shown(c) == new)

        q(c, """create function public.zz_other_caller(k text) returns text language plpgsql as $f$
                begin return (select name from public.app_project_representative(k, 'development')); end $f$""")
        del c.notices[:]
        q(c, rb_b)
        s.ok("R6 while another function calls the rule, the rollback restores both readers and KEEPS the rule",
             md5_of(c, MK) == MK_PRE and md5_of(c, AZ) == AZ_PRE and md5_of(c, REP) == REP_MD5
             and any("is KEPT" in n for n in c.notices))
    finally:
        c.close()
        rs.drop_db(db)
    return s


ORDER = "order by p.submitted_at desc nulls last, p.last_seen_at desc nulls last, p.id"
MAP_NEW = "               $r$        from public.app_project_representative(mm.source_key, p_kind) p) a on true$r$),"
MAP_OLD = """               $r$        from public.app_projects p
       where p.source_key = mm.source_key
         and p.record_kind = p_kind
       order by p.id asc
       limit 1) a on true$r$),"""
ZIP_NEW = "    left join lateral public.app_project_representative(m.source_key, 'development') a on true$r$))"
ZIP_OLD = """    left join lateral (
      select p.* from public.app_projects p
       where p.source_key = m.source_key and p.record_kind = 'development'
       order by p.id asc limit 1) a on true$r$))"""
SHARED_CHECK = """    if position('order by p.id asc' in src) > 0
       or (length(src) - length(replace(src, 'public.app_project_representative(', '')))
          / length('public.app_project_representative(') <> 1 then"""
# Each mutation is a list of (needle, replacement). The harness then RECOMPUTES the file's own
# fingerprints for the broken rule and readers, so a mutant cannot be caught merely because a
# recorded md5 no longer matches: the behaviour checks have to catch it.
MUTATIONS = [
    ("M1 the rule orders by id (today's pick)", [(ORDER, "order by p.id")]),
    ("M2 undated records sort first", [("p.submitted_at desc nulls last, p.last", "p.submitted_at desc, p.last")]),
    ("M3 the last-written tie-break is dropped", [("p.last_seen_at desc nulls last, ", "")]),
    ("M4 the rule carries a SET clause (not inlined)",
     [("stable\nparallel safe\nas $body$", "stable\nparallel safe\nset search_path = public\nas $body$"),
      ("and p.proretset and p.proconfig is null", "and p.proretset")]),
    ("M5 the map reader keeps its own lowest-id pick",
     [(MAP_NEW, MAP_OLD), (SHARED_CHECK, "    if false then")]),
    ("M6 the ZIP-page reader keeps its own lowest-id pick",
     [(ZIP_NEW, ZIP_OLD), (SHARED_CHECK, "    if false then")]),
    ("M7 the rule is left executable by anon",
     [("execute 'revoke all on function public.app_project_representative(text, text) from anon';", "null;"),
      ("     or (exists (select 1 from pg_roles where rolname = 'anon')\n"
       "         and has_function_privilege('anon', to_regprocedure(rep_fn), 'execute'))\n", "")]),
]


def consistent(conn, text):
    """Rewrite the file's recorded fingerprints to what the (broken) file itself produces."""
    rep_create = re.search(r"rep_create   constant text := \$fn\$(.*?)\$fn\$;", text, re.S).group(1)
    body = re.search(r"as \$body\$(.*?)\$body\$", rep_create, re.S).group(1)
    text = re.sub(r"(rep_md5      constant text := ')[0-9a-f]{32}'",
                  lambda m: m.group(1) + hashlib.md5(body.encode()).hexdigest() + "'", text)
    pairs = re.findall(r"\((\d), (\d), \$n\$(.*?)\$n\$,\s*\$r\$(.*?)\$r\$\)", doc_parts(text)[1], re.S)
    for fn_n, fn, const in (("1", MK, "mk_post      constant text := '"), ("2", AZ, "az_post      constant text := '")):
        src = q1(conn, "select prosrc from pg_proc where oid = %s::regprocedure", (fn,))
        for n_fn, _n, needle, repl in pairs:
            if n_fn == fn_n:
                src = src.replace(needle, repl, 1)
        at = text.index(const) + len(const)
        text = text[:at] + hashlib.md5(src.encode()).hexdigest() + text[at + 32:]
    return text


def mutant_red(c, text):
    """(red, why): the suite's behaviour checks on a database built from a broken file."""
    want = oracle(c, newest)
    try:
        apply(c, consistent(c, text))
    except psycopg2.Error as e:
        return True, f"apply refused: {str(e).splitlines()[0][:100]}"
    got = shown(c)
    if got != want:
        return True, f"a reader does not show the newest row: {[k for k in want if got.get(k) != want[k]][:2]}"
    ok, detail = r4(c)
    if not ok:
        return True, f"R4: {detail}"
    if q1(c, "select has_function_privilege('anon', to_regprocedure(%s), 'execute')", (REP,)):
        return True, "anon can execute the rule"
    return False, "all behaviour checks passed"


INGEST_ROOT = os.environ.get("INGEST_ROOT", "").strip()
REQUIRE_INGEST = os.environ.get("REQUIRE_INGEST", "") == "1"
ING_FN = "public.app_development_projects_for_zips(text[],text,boolean,text,integer)"
ING_PREV_MD5 = "028854397028bdf21912fed84a738886"


def ingest_files():
    mig = os.path.join(INGEST_ROOT, "supabase", "migrations")
    prev = os.path.join(mig, "20260928160000_app_development_projects_for_zips_identity.sql")
    new = sorted(f for f in os.listdir(mig) if f.endswith("_app_development_projects_for_zips_newest.sql"))
    return prev, (os.path.join(mig, new[-1]) if new else None)


def ingest_post_md5(text):
    body = re.search(r"as \$fn\$(.*?)\$fn\$;", text, re.S).group(1)
    return hashlib.md5(body.encode()).hexdigest()


ING_DESC = {"id", "community_id", "name", "type", "type_raw", "address", "status", "date_kind",
            "submitted_at", "source_ref", "source_seq", "record_kind", "registry_id", "source_key_basis"}


def ingest_answers(conn):
    """(newest-row check input, everything-else) for the Rule D reader over every fixture ZIP,
    in all three modes."""
    picks, rest = {}, {}
    full = q1(conn, "select public.app_development_projects_for_zips(%s, 'development')", (list(rs.ZIPS),))
    for z in full["zips"]:
        for p in z["projects"] or []:
            if not p.get("attributes_missing"):
                picks[(z["zip"], p["source_key"])] = p["id"]
        z = dict(z)
        if z["projects"] is not None:
            z["projects"] = [{k: v for k, v in p.items() if k not in ING_DESC} for p in z["projects"]]
        rest[z["zip"]] = z
    rest["generation_id"] = full["generation_id"]
    rest["sizes"] = q1(conn, "select public.app_development_projects_for_zips(%s, 'development', true)",
                       (list(rs.ZIPS),))
    page = q1(conn, "select public.app_development_projects_for_zips(array['11101'], 'development', false, null, 2)")
    rest["page"] = {k: v for k, v in page.items() if k != "zips"}
    rest["page_keys"] = [(p["source_key"], p.get("attributes_missing")) for p in page["zips"][0]["projects"]]
    return picks, json.dumps(rest, sort_keys=True, default=str)


def ingest_want(conn, pick):
    by_key = rows_by_key(conn)
    out = {}
    for m in q(conn, """select zcta5::text as z, source_key from geo.n5_serving_membership
                         where record_kind = 'development'"""):
        r = pick(by_key.get(m["source_key"], []))
        if r is not None:
            out[(m["z"], m["source_key"])] = r["id"]
    return out


def ingest_plan_has_rule_call(conn):
    """(plans captured, Function Scan nodes that call the rule) inside the Rule D reader."""
    for st in ("load 'auto_explain'", "set auto_explain.log_min_duration = 0",
               "set auto_explain.log_nested_statements = on", "set auto_explain.log_format = 'json'",
               "set enable_seqscan = off", "discard plans", "set log_min_messages = panic",
               "set client_min_messages = log"):
        q(conn, st)
    plans = []
    dec = json.JSONDecoder()
    try:
        del conn.notices[:]
        q(conn, "select public.app_development_projects_for_zips(array['11101','11102'], 'development')")
        for n in conn.notices:
            at = n.find("plan:")
            start = n.find("{", at) if at >= 0 else -1
            if start >= 0:
                plans.append(dec.raw_decode(n[start:])[0])
    finally:
        q(conn, "reset client_min_messages")
        q(conn, "reset log_min_messages")
        q(conn, "reset enable_seqscan")
        q(conn, "set auto_explain.log_min_duration = -1")
    calls, keyed = [], 0
    for p in plans:
        stack = [p["Plan"]]
        while stack:
            node = stack.pop()
            stack.extend(node.get("Plans", []))
            if node.get("Node Type") == "Function Scan" and node.get("Function Name") == "app_project_representative":
                calls.append(node.get("Function Name"))
            if node.get("Relation Name") == "app_projects" and "source_key" in (node.get("Index Cond") or ""):
                keyed += 1
    return len(plans), calls, keyed


def run_ingest():
    s = rs.Suite(None, "map1-representative/ingest")
    prev_path, new_path = ingest_files()
    prev, new = open(prev_path).read(), open(new_path).read()
    post = ingest_post_md5(new)
    db = "map1_rep_ing"
    c = rs.fresh_db(db)
    try:
        build(c)
        q(c, prev)
        before_picks, before_rest = ingest_answers(c)
        s.ok("I0 CONTROL: the previous DDL of record (md5 02885439...) shows the LOWEST-ID row",
             md5_of(c, ING_FN) == ING_PREV_MD5 and before_picks == ingest_want(c, lowest)
             and before_picks != ingest_want(c, newest), md5_of(c, ING_FN))
        err = refusal(c, new)
        s.ok("I1 the new migration is refused while the shared rule is missing, and nothing changed",
             err is not None and "does not exist" in err and md5_of(c, ING_FN) == ING_PREV_MD5, err)
        apply(c)
        acl_before = q1(c, ATTRS, (ING_FN,))
        q(c, new)
        s.ok(f"I2 after this repo's file it applies; body md5 {post[:8]}...; owner, grants and SET clauses "
             "unchanged; only service_role and the owner may run it",
             md5_of(c, ING_FN) == post and q1(c, ATTRS, (ING_FN,)) == acl_before
             and not q1(c, "select has_function_privilege('anon', to_regprocedure(%s), 'execute')", (ING_FN,))
             and not q1(c, "select has_function_privilege('authenticated', to_regprocedure(%s), 'execute')", (ING_FN,))
             and q1(c, "select has_function_privilege('service_role', to_regprocedure(%s), 'execute')", (ING_FN,)),
             q1(c, ATTRS, (ING_FN,)))
        after_picks, after_rest = ingest_answers(c)
        s.ok("I3 it shows the NEWEST row on every member; everything else it answers is identical",
             after_picks == ingest_want(c, newest) and after_rest == before_rest,
             [k for k in after_picks if after_picks[k] != ingest_want(c, newest).get(k)][:3])
        with c.cursor() as cur:
            cur.execute("begin")
            cur.execute(f"""do $d$ begin execute replace(pg_get_functiondef('{ING_FN}'::regprocedure),
                            '  v_out jsonb;', '  v_out jsonb; -- drift'); end $d$""")
            err = None
            try:
                cur.execute(new)
            except psycopg2.Error as e:
                err = str(e).splitlines()[0]
            cur.execute("rollback")
        s.ok("I4 a drifted live reader is refused, and nothing changed",
             err is not None and "drifted" in err and md5_of(c, ING_FN) == post, err)
        plans, called, keyed = ingest_plan_has_rule_call(c)
        s.ok("I5 no call to the rule is left in the reader's plan (inlined): app_projects is read by an "
             "index keyed on source_key", plans > 0 and not called and keyed >= 1,
             f"{plans} plans, {len(called)} rule calls, {keyed} keyed reads")
        q(c, new)
        same = md5_of(c, ING_FN) == post
        q(c, prev)
        rb_b, rb_a = rollback_parts()
        q(c, rb_b)
        q(c, rb_a)
        s.ok("I6 applying again does nothing; re-applying 20260928160000 restores the previous body and "
             "answers; this repo's rollback then drops the rule",
             same and md5_of(c, ING_FN) == ING_PREV_MD5 and ingest_answers(c) == (before_picks, before_rest)
             and md5_of(c, REP) is None)
    finally:
        c.close()
        rs.drop_db(db)

    # one mutation: the reader keeps its own lowest-id pick (with a consistent fingerprint)
    lat_new = "          from public.app_project_representative(m.source_key, 'development') p\n"
    lat_old = ("          from public.app_projects p\n         where p.source_key = m.source_key\n"
               "           and p.record_kind = 'development'\n         order by p.id asc\n         limit 1\n")
    mutant = new.replace(lat_new, lat_old, 1)
    mutant = mutant.replace(post, ingest_post_md5(mutant))
    killed = False
    if mutant != new:
        c = rs.fresh_db("map1_rep_ing_mut")
        try:
            build(c)
            q(c, prev)
            apply(c)
            try:
                q(c, mutant)
                killed = ingest_answers(c)[0] != ingest_want(c, newest)
            except psycopg2.Error:
                killed = True
        finally:
            c.close()
            rs.drop_db("map1_rep_ing_mut")
    print(f"{'KILLED' if killed else 'SURVIVED'} — I-M1 the Rule D reader keeps its own lowest-id pick")
    return s, (0 if killed else 1)


def run_mutations():
    survivors = []
    original = open(DOC).read()
    for i, (name, edits) in enumerate(MUTATIONS):
        text = original
        for needle, repl in edits:
            if text.count(needle) != 1:
                text = original
                break
            text = text.replace(needle, repl, 1)
        if text == original:
            print(f"SURVIVED — {name}  (the mutation did not change the file)")
            survivors.append(name)
            continue
        db = f"map1_rep_mut{i}"
        c = rs.fresh_db(db)
        try:
            build(c)
            red, why = mutant_red(c, text)
            print(f"{'KILLED' if red else 'SURVIVED'} — {name}  ({why})")
            if not red:
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
    print("MUTATION PASS — each broken file must turn the suite red")
    survivors = run_mutations()
    ing_fails, ing_survivors, ing_line = [], 0, "INGEST HALF: SKIPPED (INGEST_ROOT not set)"
    if INGEST_ROOT and ingest_files()[1]:
        print("\n" + "=" * 60)
        print("INGEST HALF — public.app_development_projects_for_zips (homesignal-ingest)")
        ing, ing_survivors = run_ingest()
        ing_fails = ing.failed()
        ing_line = (f"INGEST HALF: {len(ing.results) - len(ing_fails)} PASS / {len(ing_fails)} FAIL · "
                    f"MUTATIONS: {1 - ing_survivors} killed / {ing_survivors} survived")
    elif REQUIRE_INGEST:
        ing_fails = ["REQUIRE_INGEST=1 but no ingest checkout with the new migration at INGEST_ROOT"]
        ing_line = "INGEST HALF: REQUIRED AND MISSING"
    print("\n" + "=" * 60)
    print(f"MAP1-REPRESENTATIVE: {len(base.results) - len(fails)} PASS / {len(fails)} FAIL · MUTATIONS: "
          f"{len(MUTATIONS) - len(survivors)} killed / {len(survivors)} survived")
    print(ing_line)
    for f in fails + ing_fails:
        print(f"FAIL — {f}")
    for m in survivors:
        print(f"FAIL — mutation survived: {m}")
    return 1 if (fails or survivors or ing_fails or ing_survivors) else 0


if __name__ == "__main__":
    sys.exit(main())

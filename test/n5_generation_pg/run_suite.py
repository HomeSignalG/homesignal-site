#!/usr/bin/env python3
"""EXECUTABLE proof of the N5 generation publication path (docs/n5-generation-publish.sql).

Runs the SHIPPED migration, verbatim, against a disposable PostgreSQL + PostGIS seeded with
the production pre-state (fixture_prestate.sql: live definitions read back 2026-09-25) and a
test-scale legacy generation. Every numbered test is one of the 17 the repair was required to
prove; G-, A- and V- tests cover the write guard, anon access and view options.

Then MUTATION: each critical invariant is broken on purpose in a fresh database, and the suite
must go red in the test that guards it. A mutation that survives is reported as a failure of
the suite itself — a test that cannot fail proves nothing.

Target: N5_TEST_DSN (an admin connection to a THROWAWAY server; databases are created and
dropped here). Refuses to run if a Supabase credential is visible.
"""
import json
import os
import re
import sys

import psycopg2
import psycopg2.extras

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MIGRATION = os.path.join(ROOT, "docs", "n5-generation-publish.sql")
PRESTATE = os.path.join(HERE, "fixture_prestate.sql")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from n5_candidate_bounding import check_candidate_bounding  # noqa: E402

LEGACY = "legacy-phase1-2026-09-01"
GEN_B = "gen-b"
GEN_C = "gen-c"
ZIPS = ["11101", "11102", "11199", "11201"]


# --------------------------------------------------------------------------- plumbing
def admin_dsn():
    dsn = os.environ.get("N5_TEST_DSN", "").strip()
    if not dsn:
        raise SystemExit("STOP: N5_TEST_DSN is required (a disposable PostgreSQL + PostGIS).")
    if any(os.environ.get(k) for k in ("SUPABASE_DB_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_WRITE_KEY")):
        raise SystemExit("STOP: a Supabase credential is visible; this suite only addresses a throwaway server.")
    return dsn


def with_db(dsn, db):
    parts = [p for p in dsn.split() if not p.startswith("dbname=")]
    return " ".join(parts + [f"dbname={db}"])


def fresh_db(name):
    a = psycopg2.connect(admin_dsn())
    a.autocommit = True
    with a.cursor() as c:
        c.execute(f"drop database if exists {name}")
        c.execute(f"create database {name}")
    a.close()
    conn = psycopg2.connect(with_db(admin_dsn(), name))
    conn.autocommit = True
    return conn


def drop_db(name):
    a = psycopg2.connect(admin_dsn())
    a.autocommit = True
    with a.cursor() as c:
        c.execute(f"drop database if exists {name}")
    a.close()


def q(conn, sql, args=None):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as c:
        c.execute(sql, args)
        return c.fetchall() if c.description else []


def q1(conn, sql, args=None):
    r = q(conn, sql, args)
    return list(r[0].values())[0] if r else None


def raises(conn, sql, args=None, match=None):
    try:
        with conn.cursor() as c:
            c.execute(sql, args)
    except psycopg2.Error as e:
        conn.rollback() if not conn.autocommit else None
        return (match is None) or bool(re.search(match, str(e)))
    return False


def migration_parts():
    text = open(MIGRATION).read()
    a, rest = text.split("-- @@PART_B", 1)
    b, c = rest.split("-- @@PART_C", 1)
    body = "\n".join(l for l in b.splitlines() if not l.strip().startswith("--"))
    stmts = [s.strip() for s in body.split(";") if s.strip()]
    return a, stmts, c


def probe_text():
    """The candidate-bounding probe, sliced from the SHIPPED migration by its markers."""
    text = open(MIGRATION).read()
    m = re.search(r"\[candidate-bounding probe begins\](.*?)--\s*\[candidate-bounding probe ends\]", text, re.S)
    return m.group(1) if m else ""


# --------------------------------------------------------------------------- data
SEED = f"""
insert into public.canonical_zip_registry values ('11101'),('11102'),('11199'),('11201');
insert into public.app_zip_geography_cutover (zip, enabled, production_geography_verified_at)
  values ('11101', true, now());
insert into geo.n5_accepted_source values ('reg-noauth','NOAUTH',1,1), ('reg-ok','RECOVERY',9,9);

insert into public.app_projects (source_key, record_kind, zip, name, type, status, stage, submitted_at,
                                 date_kind, source_ref, registry_id, address, developer, scope_text)
select 'dev:P' || i, 'development', z, 'Project ' || i, 'type', 'filed', 'stage', date '2026-01-01' + i,
       'filed', 'https://example.test/' || i, 'reg-ok', i || ' Main St', 'dev', 'scope'
  from (values (1,'11101'),(2,'11101'),(3,'11102'),(4,'11102'),(5,'11101'),(6,'11101'),
               (7,'11101'),(8,'11201'),(9,'11201'),(10,'11201')) v(i, z);

insert into geo.n5_geom (source_key, registry_id, feature_id, outcome, geom, invalid_reason, provenance, verdict_snapshot_id) values
 ('dev:P1','reg-ok','pt:1',1,ST_SetSRID(ST_MakePoint(0.5,0.5),4269),null,'proven_stored_point','phase1'),
 ('dev:P2','reg-ok','f1',1,ST_GeomFromText('POLYGON((0.8 0.2,1.2 0.2,1.2 0.4,0.8 0.4,0.8 0.2))',4269),null,'recovered_authoritative',null),
 ('dev:P3','reg-ok','pt:1',1,ST_SetSRID(ST_MakePoint(2.5,0.5),4269),null,'proven_stored_point','snapB'),
 ('dev:P4','reg-ok','pt:1',1,ST_SetSRID(ST_MakePoint(1.5,0.5),4269),null,'proven_stored_point','snapB'),
 ('dev:P5','reg-ok','pt:1',1,ST_SetSRID(ST_MakePoint(0.3,0.3),4269),null,'proven_stored_point','phase1'),
 ('dev:P7','reg-ok','bad',3,null,'SELF_INTERSECTION','recovered_authoritative',null),
 ('dev:P9','reg-ok','pt:1',1,ST_SetSRID(ST_MakePoint(10,10),4269),null,'proven_stored_point','snapB');
insert into geo.n5_point_reject (source_key, registry_id, reason, verdict_snapshot_id)
  values ('dev:P6','reg-ok','NULL_COORD','snapB');

-- THE LEGACY GENERATION, in the pre-migration shape production holds today.
insert into geo.n5_generation (generation_id, snapshot_id, cutoff, state, activated_at, note)
  values ('{LEGACY}', 'phase1', '2026-09-01', 'ACTIVE_LEGACY', '2026-09-05', 'fixture legacy');
insert into preservation.app_project_identity (snapshot_id, app_project_id, zip, source_key, source_seq, registry_id, record_kind)
select 'phase1', p.id, p.zip, p.source_key, 1, p.registry_id, 'development'
  from public.app_projects p where p.source_key in ('dev:P1','dev:P2','dev:P5');
insert into geo.n5_boundary_membership (zcta5, source_key, provenance, run_id) values
 ('11101','dev:P1','proven_stored_point','legacy'), ('11101','dev:P2','recovered_authoritative','legacy'),
 ('11102','dev:P2','recovered_authoritative','legacy'), ('11101','dev:P5','proven_stored_point','legacy');
insert into geo.zip_authoritative_membership (zcta5, source_key, lat, lng, point_rule, clip_dim, feature_count, geom_family, run_id, generation_id) values
 ('11101','dev:P1',0.5,0.5,'POINT_MIN_XY',0,1,'ST_Point','legacy','{LEGACY}'),
 ('11101','dev:P2',0.3,0.9,'POLYGON_POINT_ON_SURFACE',2,1,'ST_Polygon','legacy','{LEGACY}'),
 ('11102','dev:P2',0.3,1.1,'POLYGON_POINT_ON_SURFACE',2,1,'ST_Polygon','legacy','{LEGACY}'),
 ('11101','dev:P5',0.3,0.3,'POINT_MIN_XY',0,1,'ST_Point','legacy','{LEGACY}');
insert into geo.zip_authoritative_marker (zcta5, source_key, marker_seq, lat, lng, marker_rule, family, dim, run_id, generation_id) values
 ('11101','dev:P1',1,0.5,0.5,'POINT_AUTHORITATIVE','ST_Point',0,'legacy','{LEGACY}'),
 ('11101','dev:P2',1,0.3,0.9,'POLYGON_COMPONENT_POINT_ON_SURFACE','ST_Polygon',2,'legacy','{LEGACY}'),
 ('11102','dev:P2',1,0.3,1.1,'POLYGON_COMPONENT_POINT_ON_SURFACE','ST_Polygon',2,'legacy','{LEGACY}'),
 ('11101','dev:P5',1,0.3,0.3,'POINT_AUTHORITATIVE','ST_Point',0,'legacy','{LEGACY}');
insert into geo.maps_zip_geography_status (zip, status, membership_rows, completed_at, run_id, generation_id) values
 ('11101','boundary_complete',3,now(),'legacy','{LEGACY}'),
 ('11102','boundary_complete',1,now(),'legacy','{LEGACY}'),
 ('11201','boundary_complete',0,now(),'legacy','{LEGACY}'),
 ('11199','not_measured',0,now(),'legacy','{LEGACY}');
"""

# Candidate B: a fresh snapshot. P5 is NOT in it (INV-2); P3 is stated in 111 but lies in 112 (INV-5);
# P6..P10 exercise every unresolved class, and P10 has no evidence at all (INV-4).
SNAP_B = """
insert into preservation.app_project_identity (snapshot_id, app_project_id, zip, source_key, source_seq, registry_id, record_kind)
select %(snap)s, p.id, p.zip, p.source_key, 1,
       case when p.source_key = 'dev:P8' then 'reg-noauth' else p.registry_id end, 'development'
  from public.app_projects p where p.source_key <> 'dev:P5';
insert into geo.n5_generation (generation_id, snapshot_id, cutoff, state, note)
  values (%(gen)s, %(snap)s, now(), 'BUILDING', 'fixture candidate');
insert into geo.n5_shard (snapshot_id, generation_id, z3, state, checksum)
  values (%(snap)s, %(gen)s, '111', 'done', 0), (%(snap)s, %(gen)s, '112', 'done', 0);
"""

ZCTA = {"11101": "MULTIPOLYGON(((0 0,1 0,1 1,0 1,0 0)))",
        "11102": "MULTIPOLYGON(((1 0,2 0,2 1,1 1,1 0)))",
        "11201": "MULTIPOLYGON(((2 0,3 0,3 1,2 1,2 0)))"}


def load_zcta(conn, gen, prefix):
    n = 0
    for z, wkt in ZCTA.items():
        if z.startswith(prefix):
            q(conn, "insert into geo.n5_gen_zcta (generation_id, prefix, zcta5, geom) "
                    "values (%s,%s,%s,ST_GeomFromText(%s,4269))", (gen, prefix, z, wkt))
            n += 1
    return n


def publish(conn, gen, prefix, declared=None):
    n = load_zcta(conn, gen, prefix)
    return q1(conn, "select geo.n5_gen_publish_prefix(%s,%s,'run-test',%s)",
              (gen, prefix, n if declared is None else declared))


def map_snapshot(conn):
    """Everything a resident-facing reader returns, per ZIP. Compared as canonical JSON."""
    out = {}
    for z in ZIPS:
        out[z] = {
            "markers": q1(conn, "select public.app_zip_projects_markers(%s,'development',true)", (z,)),
            "facility": q1(conn, "select public.app_zip_projects_markers(%s,'facility',true)", (z,)),
            "for_zip": q1(conn, "select public.app_projects_for_zip(%s,'development')", (z,)),
            "state": q1(conn, "select geography_state from public.app_zip_geography_state where zip=%s", (z,)),
            "dc": q1(conn, "select count(*) from public.dc_resident_lineage_ledger where zip=%s", (z,)),
        }
    return json.dumps(out, sort_keys=True, default=str)


def refs(conn, z):
    j = q1(conn, "select public.app_zip_projects_markers(%s,'development',true)", (z,))
    return sorted(p["project_ref"] for p in (j.get("projects") or []))


def gen_fingerprint(conn, gen):
    return q1(conn, """select md5(coalesce(string_agg(t, '|' order by t collate "C"), '')) from (
        select 'm:'||zcta5||':'||source_key||':'||coalesce(lat::text,'')||':'||coalesce(lng::text,'') t
          from geo.zip_authoritative_membership where generation_id=%s
        union all select 'k:'||zcta5||':'||source_key||':'||marker_seq||':'||lat||':'||lng
          from geo.zip_authoritative_marker where generation_id=%s
        union all select 's:'||zip||':'||status||':'||membership_rows
          from geo.maps_zip_geography_status where generation_id=%s
        union all select 'b:'||zcta5||':'||source_key
          from geo.n5_boundary_membership where generation_id=%s) x""", (gen, gen, gen, gen))


# --------------------------------------------------------------------------- the suite
class Suite:
    def __init__(self, conn, label):
        self.conn, self.label, self.results = conn, label, []

    def ok(self, name, cond, detail=""):
        self.results.append((name, bool(cond)))
        print(f"{'PASS' if cond else 'FAIL'} — [{self.label}] {name}" + (f"  ({detail})" if detail and not cond else ""),
              flush=True)

    def failed(self):
        return [n for n, c in self.results if not c]


def run(conn, label, mutate=None):
    s = Suite(conn, label)
    c = conn
    q(c, open(PRESTATE).read())
    q(c, SEED)
    pre = map_snapshot(c)
    s.ok("control: the pre-state serves the legacy generation (11101 has P1,P2,P5)",
         refs(c, "11101") == ["dev:P1", "dev:P2", "dev:P5"], refs(c, "11101"))

    part_a, part_b, part_c = migration_parts()
    q(c, part_a)
    s.ok("15a legacy Map 1 output unchanged after PART A", map_snapshot(c) == pre)
    for st in part_b:
        q(c, st)
    s.ok("15b legacy Map 1 output unchanged after PART B", map_snapshot(c) == pre)
    q(c, part_c)
    s.ok("15c legacy Map 1 output unchanged after PART C (keys swapped, readers spliced)", map_snapshot(c) == pre)
    s.ok("15d every legacy row belongs to the legacy generation (boundary membership included)",
         q1(c, "select count(*) from geo.n5_boundary_membership where generation_id is distinct from %s", (LEGACY,)) == 0
         and q1(c, "select count(*) from geo.zip_authoritative_membership where generation_id is distinct from %s", (LEGACY,)) == 0)
    s.ok("V1 the security_invoker option survived the view splice",
         "security_invoker=true" in (q1(c, "select array_to_string(reloptions, ',') from pg_class where oid='public.dc_resident_lineage_ledger'::regclass") or ""))
    s.ok("V2 no reader outside the lifecycle reads a serving base table (splice complete)",
         q1(c, r"""select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname in ('public') and p.prosrc ~ '(zip_authoritative_membership|zip_authoritative_marker|maps_zip_geography_status)'""") == 0)
    s.ok("V3 the serving-view predicate and the serving function agree",
         q1(c, "select (select geo.n5_serving_generation_id()) = %s", (LEGACY,)) is True)

    if mutate:
        # A mutation that does not apply is indistinguishable from one that survives: prove
        # the definitions actually moved before counting anything.
        defs = ("select md5(string_agg(d, '|' order by d collate \"C\")) from ("
                " select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace"
                "  where n.nspname in ('geo','public') and p.prokind='f'"
                " union all select pg_get_viewdef(c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace"
                "  where n.nspname in ('geo','public') and c.relkind='v'"
                " union all select tgname from pg_trigger where not tgisinternal) x")
        before = q1(c, defs)
        q(c, mutate)
        if q1(c, defs) == before:
            raise RuntimeError("MUTATION DID NOT APPLY - no definition changed")

    # A-tests: anon reaches the resident surfaces with no geo grant
    try:
        q(c, "set role anon")
        st = q1(c, "select count(*) from public.app_zip_geography_state")
        mk = q1(c, "select public.app_zip_projects_markers('11101','development',true)->>'status'")
        q(c, "reset role")
        s.ok("A1 anon still reads app_zip_geography_state and Map 1 through the serving views", st == 4 and mk == "boundary_complete")
    except psycopg2.Error as e:
        q(c, "reset role")
        s.ok("A1 anon still reads app_zip_geography_state and Map 1 through the serving views", False, str(e).splitlines()[0])

    # ---- candidate B
    q(c, SNAP_B, {"gen": GEN_B, "snap": "snapB"})
    s.ok("control: B is BUILDING and A serves", q1(c, "select geo.n5_serving_generation_id()") == LEGACY)

    publish(c, GEN_B, "111")
    s.ok("2a building B (prefix 111 published) does not alter what Map 1 returns", map_snapshot(c) == pre)
    s.ok("9a a partially built B cannot become READY",
         raises(c, "select geo.n5_generation_mark_ready(%s, array['111','112'])", (GEN_B,), r"prefixes_unpublished"))
    s.ok("9b a BUILDING B cannot be activated",
         raises(c, "select geo.n5_generation_activate(%s, array['111','112'])", (GEN_B,), r"not READY"))
    s.ok("9c unresolved accounting refuses while a prefix is unpublished",
         raises(c, "select geo.n5_gen_record_unresolved(%s)", (GEN_B,), r"unpublished"))

    fp_first = gen_fingerprint(c, GEN_B)
    publish(c, GEN_B, "111")
    s.ok("17a re-publishing the same prefix of B is idempotent (fingerprint unchanged)", gen_fingerprint(c, GEN_B) == fp_first)

    publish(c, GEN_B, "112")
    s.ok("2b building B fully does not alter what Map 1 returns", map_snapshot(c) == pre)
    s.ok("13a a publish whose boundaries do not match the loader's declaration refuses",
         raises(c, "select geo.n5_gen_publish_prefix(%s,'111','run-x',99)", (GEN_B,), r"loader declared"))

    s.ok("1  ACTIVE A and candidate B coexist",
         q1(c, "select count(distinct generation_id) from geo.zip_authoritative_membership") == 2)
    s.ok("3  the same (ZIP, source_key) exists in A and in B",
         q1(c, "select count(*) from geo.zip_authoritative_membership where zcta5='11101' and source_key='dev:P1'") == 2)
    s.ok("4  B's boundary work cannot consume a project outside B's frozen expected set (P5)",
         q1(c, "select count(*) from geo.n5_boundary_membership where generation_id=%s and source_key='dev:P5'", (GEN_B,)) == 0
         and q1(c, "select count(*) from geo.zip_authoritative_membership where generation_id=%s and source_key='dev:P5'", (GEN_B,)) == 0)
    s.ok("8a membership and markers of B are generation-scoped and paired",
         q1(c, "select count(*) from geo.zip_authoritative_membership where generation_id=%s", (GEN_B,)) == 5
         and q1(c, """select count(*) from geo.zip_authoritative_membership m where m.generation_id=%s and not exists
                      (select 1 from geo.zip_authoritative_marker k where k.generation_id=m.generation_id
                          and k.zcta5=m.zcta5 and k.source_key=m.source_key)""", (GEN_B,)) == 0)
    s.ok("8b B's status rows cover every canonical ZIP of its prefixes (incl. 11199 not_measured)",
         q1(c, "select string_agg(zip||':'||status||':'||membership_rows, ',' order by zip) from geo.maps_zip_geography_status where generation_id=%s", (GEN_B,))
         == "11101:boundary_complete:2,11102:boundary_complete:2,11199:not_measured:0,11201:boundary_complete:1")

    q1(c, "select geo.n5_gen_record_unresolved(%s)", (GEN_B,))
    got = {r["source_key"]: r["reason_code"] for r in q(c, "select source_key, reason_code from geo.n5_generation_unresolved where generation_id=%s", (GEN_B,))}
    s.ok("7  explicit evidence-backed unresolved outcomes, one per class",
         got == {"dev:P6": "POINT_REJECTED", "dev:P7": "GEOMETRY_INVALID", "dev:P8": "REGISTRY_NOAUTH",
                 "dev:P9": "NO_INTERSECTION_WITH_GENERATION_ZCTAS"}, got)
    s.ok("6  an expected record with neither membership nor evidence (P10) blocks READY",
         raises(c, "select geo.n5_generation_mark_ready(%s, array['111','112'])", (GEN_B,), r"INV-1 violated — 1 of"))
    r111 = q(c, "select * from geo.n5_reconcile_chunk(%s,'111')", (GEN_B,))[0]
    s.ok("5  P3 (stated 111, resolved into 11201) counts RESOLVED for chunk 111",
         (r111["expected_keys"], r111["accounted_resolved"], r111["accounted_unresolved"], r111["unaccounted"]) == (6, 4, 2, 0),
         dict(r111))
    s.ok("6b the declared chunk set must cover every expected key",
         raises(c, "select geo.n5_generation_mark_ready(%s, array['111'])", (GEN_B,), r"expected_keys_outside_declared_chunks"))

    # evidence for P10 arrives through the pipeline (a shard verdict), then accounting is re-run
    q(c, "insert into geo.n5_point_reject (source_key, registry_id, reason, verdict_snapshot_id) values ('dev:P10','reg-ok','MULTI_COORD_UNRESOLVED','snapB')")
    s.ok("7b stale unresolved accounting (older than the last publish) is refused at READY",
         raises(c, "select geo.n5_generation_mark_ready(%s, array['111','112'])", (GEN_B,), r"INV-1|unresolved"))
    q1(c, "select geo.n5_gen_record_unresolved(%s)", (GEN_B,))
    q(c, "select geo.n5_generation_mark_ready(%s, array['111','112'])", (GEN_B,))
    s.ok("control: B is READY and A still serves",
         q1(c, "select state from geo.n5_generation where generation_id=%s", (GEN_B,)) == "READY"
         and map_snapshot(c) == pre)

    fp_a = gen_fingerprint(c, LEGACY)
    q(c, "select geo.n5_generation_activate(%s, array['111','112'])", (GEN_B,))
    s.ok("10 activation switches Map 1 from A to B (P5 gone, P4 and P3 visible)",
         refs(c, "11101") == ["dev:P1", "dev:P2"] and refs(c, "11102") == ["dev:P2", "dev:P4"] and refs(c, "11201") == ["dev:P3"],
         [refs(c, z) for z in ("11101", "11102", "11201")])
    s.ok("10b one serving generation, recorded with its predecessor",
         q1(c, "select count(*) from geo.n5_generation where state in ('ACTIVE','ACTIVE_LEGACY')") == 1
         and q1(c, "select predecessor_generation_id from geo.n5_generation where generation_id=%s", (GEN_B,)) == LEGACY)
    s.ok("11 after activation A is intact (fingerprint unchanged)", gen_fingerprint(c, LEGACY) == fp_a)
    both = q1(c, "select count(*) from geo.zip_authoritative_membership where zcta5='11101'")
    s.ok("14 Map 1 cannot combine A and B (5 rows for 11101 across generations, 2 served, no duplicates)",
         both == 5 and refs(c, "11101") == ["dev:P1", "dev:P2"]
         and q1(c, "select public.app_zip_projects_markers('11101','development',true)->>'marker_count'") == "2"
         and q1(c, "select jsonb_array_length(public.app_authoritative_projects_for_zip('11101'))") == 2, both)
    entries = sorted((r["zcta5"], r["source_key"]) for r in q(c, "select * from geo.n5_generation_entries(%s)", (GEN_B,)))
    s.ok("16 generation B minus A is derivable after activation",
         entries == [("11102", "dev:P4"), ("11201", "dev:P3")], entries)
    s.ok("16b entries are refused for the baseline (no predecessor)",
         raises(c, "select * from geo.n5_generation_entries(%s)", (LEGACY,), r"no predecessor"))
    served_b = map_snapshot(c)

    # ---- the write guard (INV-1 / INV-8 against ANY writer)
    s.ok("G1 a retired-script-style delete of a serving prefix is refused",
         raises(c, "delete from geo.zip_authoritative_membership where left(zcta5,3)='111'", None, r"N5 GUARD"))
    s.ok("G2 a write into the ACTIVE generation is refused",
         raises(c, "update geo.zip_authoritative_marker set lat=lat where generation_id=%s", (GEN_B,), r"N5 GUARD"))
    s.ok("G3 moving a row between generations is refused",
         raises(c, "update geo.maps_zip_geography_status set generation_id='x' where zip='11199'", None, r"N5 GUARD"))
    s.ok("17b an activated generation can never be re-published",
         raises(c, "select geo.n5_gen_publish_prefix(%s,'111','run-y',0)", (GEN_B,), r"not BUILDING"))
    s.ok("G4 the serving generation's predecessor cannot be discarded",
         raises(c, "select geo.n5_generation_discard(%s)", (LEGACY,), r"predecessor"))
    s.ok("G5 the serving generation cannot be discarded",
         raises(c, "select geo.n5_generation_discard(%s)", (GEN_B,), r"only FAILED or SUPERSEDED"))

    # ---- failure (INV-8): a candidate C fails part-way; B keeps serving; C is discarded cleanly
    q(c, SNAP_B.replace("'111', 'done'", "'111', 'done'"), {"gen": GEN_C, "snap": "snapC"})
    publish(c, GEN_C, "111")
    s.ok("13b a partial candidate C leaves Map 1 serving B", map_snapshot(c) == served_b)
    s.ok("13c a partial candidate C cannot become READY",
         raises(c, "select geo.n5_generation_mark_ready(%s, array['111','112'])", (GEN_C,), r"prefixes_unpublished"))
    q(c, "select geo.n5_generation_fail(%s, 'fixture: build failed')", (GEN_C,))
    d = q1(c, "select geo.n5_generation_discard(%s)", (GEN_C,))
    s.ok("13d a FAILED candidate discards only its own rows; A and B untouched",
         q1(c, "select count(*) from geo.zip_authoritative_membership where generation_id=%s", (GEN_C,)) == 0
         and gen_fingerprint(c, LEGACY) == fp_a and map_snapshot(c) == served_b, d)

    # ---- rollback (INV-9)
    q(c, "select geo.n5_generation_rollback(%s, 'fixture rollback')", (LEGACY,))
    s.ok("12 rollback restores A exactly, without rebuilding it",
         map_snapshot(c) == pre and q1(c, "select state from geo.n5_generation where generation_id=%s", (LEGACY,)) == "ACTIVE_LEGACY")
    s.ok("12b rollback forward to B restores B exactly",
         q1(c, "select (geo.n5_generation_rollback(%s, 'fixture forward')).state", (GEN_B,)) == "ACTIVE"
         and map_snapshot(c) == served_b)
    entries2 = sorted((r["zcta5"], r["source_key"]) for r in q(c, "select * from geo.n5_generation_entries(%s)", (GEN_B,)))
    s.ok("17c re-serving B creates no new visibility evidence (entries identical)", entries2 == entries)

    # ---- no serving generation: an empty answer, never a mix
    with c.cursor() as cur:
        cur.execute("begin")
        cur.execute("update geo.n5_generation set state='SUPERSEDED' where state in ('ACTIVE','ACTIVE_LEGACY')")
        cur.execute("select public.app_zip_projects_markers('11101','development',true)->>'status'")
        st = cur.fetchone()[0]
        cur.execute("rollback")
    s.ok("14b with no serving generation Map 1 reports 'unknown', never a mix", st == "unknown", st)

    # ---- the candidate-bounding invariant still holds for the shipped probe (INV-2)
    probe = probe_text()
    s.ok("4b the shipped probe passes the candidate-bounding guard", probe and check_candidate_bounding(probe) == [],
         check_candidate_bounding(probe) if probe else "probe markers not found")
    s.ok("4c the probe reads the generation's candidate relation, never raw geometry",
         "n5_gen_candidate_geom" in probe and not re.search(r"\bgeo\.n5_geom\b", probe))
    return s


# --------------------------------------------------------------------------- mutations
MUTATIONS = {
    "M1 serving views stop filtering on generation": ("14", """
        create or replace view geo.n5_serving_membership as select m.* from geo.zip_authoritative_membership m;
        create or replace view geo.n5_serving_marker as select k.* from geo.zip_authoritative_marker k;"""),
    "M2 reconciliation reverts to the prefix-bounded resolved set": ("5", None),   # filled from the fixture text
    "M3 the candidate set is all resident geometry": ("4", """
        create or replace function geo.n5_gen_candidate_geom(p_generation_id text) returns setof geo.n5_geom
        language sql stable as $$ select g.* from geo.n5_geom g $$;"""),
    "M4 the write guard is removed": ("G1", """
        drop trigger n5_generation_row_guard on geo.zip_authoritative_membership;
        drop trigger n5_generation_row_guard on geo.zip_authoritative_marker;
        drop trigger n5_generation_row_guard on geo.maps_zip_geography_status;
        drop trigger n5_generation_row_guard on geo.n5_boundary_membership;"""),
    "M5 unresolved accounting gains a catch-all": ("6", """
        do $$ begin execute regexp_replace(pg_get_functiondef('geo.n5_gen_record_unresolved(text)'::regprocedure),
          'end as reason_code', 'else ''UNKNOWN'' end as reason_code'); end $$;"""),
    "M6 READY stops checking publication completeness": ("9a", """
        do $$ begin execute regexp_replace(pg_get_functiondef('geo.n5_generation_mark_ready(text,text[])'::regprocedure),
          'for prob in select \\* from geo\\.n5_generation_publish_problems\\(p_generation_id, p_expected_chunks\\) loop.*?end loop;', ''); end $$;"""),
    "M7 activation stops recording the predecessor": ("16", """
        do $$ begin execute replace(pg_get_functiondef('geo.n5_generation_activate(text,text[])'::regprocedure),
          'predecessor_generation_id = coalesce(predecessor_generation_id, prev.generation_id)', 'predecessor_generation_id = predecessor_generation_id'); end $$;"""),
}


def old_reconcile():
    t = open(PRESTATE).read()
    return t[t.index("CREATE OR REPLACE FUNCTION geo.n5_reconcile_chunk"):t.index("-- ---------------------------------------------------------------- LIVE: activate")]


def main():
    db = "n5gen_suite"
    conn = fresh_db(db)
    base = run(conn, "base")
    conn.close()
    drop_db(db)
    fails = base.failed()

    print("\n" + "=" * 60)
    print("MUTATION PASS — each mutation must turn its guarding test red")
    survivors = []
    for i, (name, (test_id, sql)) in enumerate(MUTATIONS.items()):
        if sql is None:
            sql = old_reconcile()
        mdb = f"n5gen_mut{i}"
        mconn = fresh_db(mdb)
        try:
            ms = run(mconn, name.split()[0], mutate=sql)
            red = [n for n in ms.failed() if n.split()[0] == test_id]
        except RuntimeError as e:
            red = []  # did not apply: counted as SURVIVED, never as a kill
            print(f"   {e}")
        except Exception as e:  # a mutation that crashes the suite is still a kill, but say so
            red = [f"suite aborted: {str(e).splitlines()[0]}"]
        mconn.close()
        drop_db(mdb)
        verdict = "KILLED" if red else "SURVIVED"
        print(f"{verdict} — {name}  (guarding test {test_id}: {red[:1]})")
        if not red:
            survivors.append(name)

    print("\n" + "=" * 60)
    print(f"BASE: {len(base.results) - len(fails)} PASS / {len(fails)} FAIL · MUTATIONS: "
          f"{len(MUTATIONS) - len(survivors)} killed / {len(survivors)} survived")
    for f in fails:
        print(f"FAIL — {f}")
    for m in survivors:
        print(f"FAIL — mutation survived: {m}")
    return 1 if (fails or survivors) else 0


if __name__ == "__main__":
    sys.exit(main())

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
PART_D = os.path.join(ROOT, "docs", "n5-generation-publish-part-d.sql")
FIDELITY_SQL = os.path.join(HERE, "fidelity.sql")
FIDELITY_PROD = os.path.join(HERE, "fidelity_production.json")
PRESTATE = os.path.join(HERE, "fixture_prestate.sql")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from n5_candidate_bounding import check_candidate_bounding  # noqa: E402

LEGACY = "legacy-phase1-2026-09-01"
GEN_B = "gen-b"
GEN_C = "gen-c"
ZIPS = ["11101", "11102", "11199", "11201", "11301"]


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
    # dollar-quoted DO blocks (the capacity gate) are one statement each
    blocks = re.findall(r"do \$gate\$.*?\$gate\$;", body, re.S)
    for i, blk in enumerate(blocks):
        body = body.replace(blk, f"@@BLOCK{i}@@;")
    stmts = []
    for st in (x.strip() for x in body.split(";")):
        if not st:
            continue
        m = re.fullmatch(r"@@BLOCK(\d+)@@", st)
        stmts.append(blocks[int(m.group(1))] if m else st)
    return a, stmts, c


def split_nontx(body):
    """Statements of a NON-transactional section: DO blocks kept whole, comments dropped."""
    body = "\n".join(l for l in body.splitlines() if not l.strip().startswith("--"))
    blocks = re.findall(r"do \$gate\$.*?\$gate\$;", body, re.S)
    for i, blk in enumerate(blocks):
        body = body.replace(blk, f"@@BLOCK{i}@@;")
    out = []
    for st in (x.strip() for x in body.split(";")):
        if not st:
            continue
        m = re.fullmatch(r"@@BLOCK(\d+)@@", st)
        out.append(blocks[int(m.group(1))] if m else st)
    return out


def part_d_parts():
    """PART D, split exactly as production applies it: D-A (one transaction, gate first),
    D-B (each statement on its own - CONCURRENTLY), D-C (one transaction)."""
    text = open(PART_D).read()
    a, rest = text.split("-- @@PART_DB", 1)
    b, c = rest.split("-- @@PART_DC", 1)
    return a, split_nontx(b), c


def fidelity(conn):
    body = "\n".join(l for l in open(FIDELITY_SQL).read().splitlines() if not l.startswith("--"))
    return {r["object"]: [r["cols"], r["cons"], r["idx"]] for r in q(conn, body)}


def probe_text():
    """The candidate-bounding probe, sliced from the SHIPPED migration by its markers."""
    text = open(MIGRATION).read()
    m = re.search(r"\[candidate-bounding probe begins\](.*?)--\s*\[candidate-bounding probe ends\]", text, re.S)
    return m.group(1) if m else ""


# --------------------------------------------------------------------------- data
SEED = f"""
-- 11301 sits in prefix 113, which carries NO expected project: the shape of the 40
-- production prefixes (445 ZIPs, 442 serving a measured zero) a shard-only scope would drop.
insert into public.canonical_zip_registry (zip, gold_master_version, workbook_sha256) values
  ('11101','fixture','sha'),('11102','fixture','sha'),('11199','fixture','sha'),('11201','fixture','sha'),('11301','fixture','sha');
-- as in production: enabled-and-verified = exactly the boundary_complete ZIPs; the one
-- not_measured ZIP carries a disabled row.
insert into public.app_zip_geography_cutover (zip, enabled, production_geography_verified_at) values
  ('11101', true, now()), ('11102', true, now()), ('11201', true, now()), ('11301', true, now()),
  ('11199', false, null);
-- treatments are PER REGISTRY, as in production: reg-pt is PROVEN (its projects are placed by
-- their own stored coordinate), reg-ok is RECOVERY (publisher geometry), reg-noauth NOAUTH.
insert into geo.n5_accepted_source values ('reg-noauth','NOAUTH',1,1), ('reg-ok','RECOVERY',9,9), ('reg-pt','PROVEN',9,9);

-- the LIVE project table (the capture reads it). Coordinates are what a NEW snapshot captures.
insert into public.app_projects (source_key, record_kind, zip, name, type, status, stage, submitted_at,
                                 date_kind, source_ref, registry_id, address, developer, scope_text, source_seq, lat, lng)
select 'dev:P' || i, 'development', z, 'Project ' || i, 'type', 'filed', 'stage', date '2026-01-01' + i,
       'filed', 'https://example.test/' || i, reg, i || ' Main St', 'dev', 'scope', seq, la, lo
  from (values
    -- P1 PROVEN, MOVED since phase1 (legacy point 0.5,0.5 -> now 0.6,0.6): B must use the new one
    (1,'11101','reg-pt',1,0.6::float8,0.6::float8),
    (2,'11101','reg-ok',1,null,null),            -- RECOVERY polygon spanning 11101/11102
    (3,'11102','reg-pt',1,0.5,2.5),              -- stated 111, lies in 11201 (INV-5)
    (4,'11102','reg-pt',1,0.5,1.5),              -- REJECTED in phase1, eligible now: B must publish it
    (5,'11101','reg-pt',1,0.3,0.3),              -- not in B's snapshot (INV-2)
    (6,'11101','reg-pt',1,null,null),            -- NULL_COORD now; a STALE legacy point must not resurrect it
    (7,'11101','reg-ok',1,null,null),            -- only quarantined geometry -> GEOMETRY_INVALID
    (8,'11201','reg-ok',1,null,null),            -- registry NOAUTH in B
    (9,'11201','reg-pt',1,10,10),                -- a point outside every ZCTA -> NO_INTERSECTION
    (10,'11201','reg-ok',1,null,null),           -- RECOVERY with no geometry and no verdict yet
    (11,'11201','reg-pt',1,0.5,3.5),             -- stated 112, lies in 11301
    (12,'11101','reg-pt',1,0.2,0.2),             -- two captured rows with DIFFERENT coordinates
    (12,'11101','reg-pt',2,0.25,0.25)            --   -> MULTI_COORD_UNRESOLVED
  ) v(i, z, reg, seq, la, lo);

-- geometry evidence as production holds it: legacy phase1 proven points (P1 at its OLD spot,
-- P5, and P6 whose coordinate has since gone), recovered geometry, one quarantined row.
insert into geo.n5_geom (source_key, registry_id, feature_id, outcome, geom, invalid_reason, provenance, verdict_snapshot_id) values
 ('dev:P1','reg-pt','pt:1',1,ST_SetSRID(ST_MakePoint(0.5,0.5),4269),null,'proven_stored_point','phase1'),
 ('dev:P5','reg-pt','pt:1',1,ST_SetSRID(ST_MakePoint(0.3,0.3),4269),null,'proven_stored_point','phase1'),
 ('dev:P6','reg-pt','pt:1',1,ST_SetSRID(ST_MakePoint(0.7,0.7),4269),null,'proven_stored_point','phase1'),
 ('dev:P2','reg-ok','f1',1,ST_GeomFromText('POLYGON((0.8 0.2,1.2 0.2,1.2 0.4,0.8 0.4,0.8 0.2))',4269),null,'recovered_authoritative',null),
 ('dev:P7','reg-ok','bad',3,null,'SELF_INTERSECTION','recovered_authoritative',null);
-- a LEGACY (snapshot-less) reject: P4 was rejected in phase1. It must not decide B.
insert into geo.n5_point_reject (source_key, registry_id, reason, verdict_snapshot_id)
  values ('dev:P4','reg-pt','NULL_COORD','phase1');

-- THE LEGACY GENERATION, in the pre-migration shape production holds today.
insert into geo.n5_generation (generation_id, snapshot_id, cutoff, state, activated_at, note)
  values ('{LEGACY}', 'phase1', '2026-09-01', 'ACTIVE_LEGACY', '2026-09-05', 'fixture legacy');
insert into preservation.app_project_identity
  (snapshot_id, app_project_id, zip, source_key, source_seq, registry_id, record_kind, lat, lng, identity_hash, content_hash)
select 'phase1', p.id, p.zip, p.source_key, p.source_seq, p.registry_id, 'development',
       case when p.source_key = 'dev:P1' then 0.5 else p.lat end,
       case when p.source_key = 'dev:P1' then 0.5 else p.lng end,
       decode(md5(p.source_key || '|' || p.source_seq), 'hex'), decode(md5(p.source_key || '|c'), 'hex')
  from public.app_projects p where p.source_key in ('dev:P1','dev:P2','dev:P5');
-- the legacy build's association evidence (pre-migration key: no generation)
insert into geo.n5_association (source_key, zip, evidence) values ('dev:P1','11101',1), ('dev:P2','11101',1);
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
 ('11199','not_measured',0,now(),'legacy','{LEGACY}'),
 ('11301','boundary_complete',0,now(),'legacy','{LEGACY}');
"""

# Candidate B: a fresh snapshot CAPTURED FROM THE LIVE TABLE (coordinates included), as
# `open` captures it. P5 is NOT in it (INV-2); P3 is stated in 111 but lies in 112 (INV-5);
# P6..P12 exercise every unresolved class, and P10 has no evidence at all (INV-4).
# Shards are marked done: this suite's subject is publication; the build stage is exercised
# by test/n5_generation_pg/run_lifecycle.py through the real orchestrator.
SNAP_B = """
insert into preservation.app_project_identity
  (snapshot_id, app_project_id, zip, source_key, source_seq, registry_id, record_kind, lat, lng, identity_hash, content_hash)
select %(snap)s, p.id, p.zip, p.source_key, p.source_seq,
       case when p.source_key = 'dev:P8' then 'reg-noauth' else p.registry_id end, 'development', p.lat, p.lng,
       decode(md5(p.source_key || '|' || p.source_seq), 'hex'), decode(md5(p.source_key || '|c'), 'hex')
  from public.app_projects p where p.source_key <> 'dev:P5';
insert into geo.n5_generation (generation_id, snapshot_id, cutoff, state, note)
  values (%(gen)s, %(snap)s, now(), 'BUILDING', 'fixture candidate');
insert into geo.n5_shard (snapshot_id, generation_id, z3, projects, pairs, zips, state, checksum)
  values (%(snap)s, %(gen)s, '111', 0, 0, 0, 'done', 0), (%(snap)s, %(gen)s, '112', 0, 0, 0, 'done', 0);
"""

ZCTA = {"11101": "MULTIPOLYGON(((0 0,1 0,1 1,0 1,0 0)))",
        "11102": "MULTIPOLYGON(((1 0,2 0,2 1,1 1,1 0)))",
        "11201": "MULTIPOLYGON(((2 0,3 0,3 1,2 1,2 0)))",
        "11301": "MULTIPOLYGON(((3 0,4 0,4 1,3 1,3 0)))"}


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


def run(conn, label, mutate=None, suite=None):
    s = suite or Suite(conn, label)
    c = conn
    q(c, open(PRESTATE).read())
    q(c, SEED)
    pre = map_snapshot(c)
    s.ok("control: the pre-state serves the legacy generation (11101 has P1,P2,P5)",
         refs(c, "11101") == ["dev:P1", "dev:P2", "dev:P5"], refs(c, "11101"))

    part_a, part_b, part_c = migration_parts()
    s.ok("K1 PART A refuses with no verified capacity stated, and applies nothing",
         raises(c, part_a, None, r"CAPACITY GATE: n5\.verified_free_disk_mb is unset")
         and q1(c, "select to_regprocedure('geo.n5_serving_generation_id()') is null") is True)
    q(c, "set n5.verified_free_disk_mb = '2997'")
    s.ok("K2 PART A refuses a stated capacity below the 2,048 MB floor + 950 MB peak",
         raises(c, part_a, None, r"need >= 2998"))
    q(c, "set n5.verified_free_disk_mb = '2998'")
    q(c, part_a)
    s.ok("15a legacy Map 1 output unchanged after PART A", map_snapshot(c) == pre)
    q(c, "reset n5.verified_free_disk_mb")
    s.ok("K3 PART B refuses with no verified capacity stated", raises(c, part_b[0], None, r"CAPACITY GATE"))
    q(c, "set n5.verified_free_disk_mb = '2998'")
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

    # FIDELITY: the fixture + Parts A-C must be production's post-C shape EXACTLY (72
    # components: columns, constraints, indexes, and the live function bodies the fixture
    # copies). A looser fixture is how this suite once went green over a lifecycle that
    # could not run in production.
    prod = json.load(open(FIDELITY_PROD))["objects"]
    here = fidelity(c)
    diff = sorted(f"{k}:{['cols','cons','idx'][i]}" for k in prod for i in range(3)
                  if prod[k][i] != here.get(k, [None] * 3)[i])
    s.ok("F1 fixture + Parts A-C fingerprint-equal production's post-C shape (72 components)",
         not diff and len(prod) == 24, diff[:6])

    d_a, d_b, d_c = part_d_parts()
    q(c, "reset n5.verified_free_disk_mb")
    s.ok("KD PART D-A refuses with no verified capacity stated, and applies nothing",
         raises(c, d_a, None, r"CAPACITY GATE") and
         q1(c, "select to_regprocedure('geo.n5_gen_prepare_publish(text)') is null") is True)
    q(c, "set n5.verified_free_disk_mb = '2998'")
    q(c, d_a)
    for st in d_b:
        q(c, st)
    q(c, d_c)
    s.ok("15e legacy Map 1 output unchanged after PART D", map_snapshot(c) == pre)
    s.ok("15f the legacy association rows read as the legacy generation; the key is generation-scoped",
         q1(c, "select count(*) from geo.n5_association where generation_id is distinct from %s", (LEGACY,)) == 0
         and q1(c, "select pg_get_constraintdef(oid) from pg_constraint where conname='n5_association_pkey'")
             == "PRIMARY KEY (generation_id, source_key, zip)"
         and q1(c, "select column_default from information_schema.columns where table_schema='geo' "
                   "and table_name='n5_association' and column_name='generation_id'") is None)

    if mutate:
        # (applied after PART D, so a mutation may target any shipped definition)
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

    # X1: the retired per-ZIP switch no longer changes what a Development page serves
    q(c, "update public.app_zip_geography_cutover set enabled=false where zip='11101'")
    s.ok("X1 disabling a ZIP's cutover row does not change its Development page", map_snapshot(c) == pre)
    q(c, "update public.app_zip_geography_cutover set enabled=true where zip='11101'")

    # A-tests: anon reaches the resident surfaces with no geo grant
    try:
        q(c, "set role anon")
        st = q1(c, "select count(*) from public.app_zip_geography_state")
        mk = q1(c, "select public.app_zip_projects_markers('11101','development',true)->>'status'")
        q(c, "reset role")
        s.ok("A1 anon still reads app_zip_geography_state and Map 1 through the serving views",
             st == len(ZIPS) and mk == "boundary_complete", (st, mk))
    except psycopg2.Error as e:
        q(c, "reset role")
        s.ok("A1 anon still reads app_zip_geography_state and Map 1 through the serving views", False, str(e).splitlines()[0])

    # ---- candidate B
    q(c, SNAP_B, {"gen": GEN_B, "snap": "snapB"})
    s.ok("control: B is BUILDING and A serves", q1(c, "select geo.n5_serving_generation_id()") == LEGACY)

    s.ok("D1 a generation cannot publish before it is prepared (its proven points do not exist yet)",
         raises(c, "select geo.n5_gen_publish_prefix(%s,'111','run-x',0)", (GEN_B,), r"not prepared"))
    prep = q1(c, "select geo.n5_gen_prepare_publish(%s)", (GEN_B,))
    s.ok("D2 preparation applies the phase1 proven-point rule to B's OWN snapshot",
         (prep["proven_points"], prep["null_coord"], prep["multi_coord_unresolved"], prep["recovered_keys"])
         == (5, 1, 1, 2), prep)
    s.ok("D3 the generation's association is generation-scoped: B may hold the same (key, ZIP) as legacy",
         q1(c, "insert into geo.n5_association (generation_id, source_key, zip, evidence) "
               "values (%s,'dev:P1','11101',1) returning 1", (GEN_B,)) == 1)
    s.ok("D4 the legacy build's association evidence is guarded like every other generation's rows",
         raises(c, "update geo.n5_association set evidence=2 where generation_id=%s", (LEGACY,), r"N5 GUARD"))

    publish(c, GEN_B, "111")
    s.ok("D5 re-preparing under a published prefix is refused (its evidence is fixed)",
         raises(c, "select geo.n5_gen_prepare_publish(%s)", (GEN_B,), r"already has published"))
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
    s.ok("S1 a canonical prefix with no shard (113) is in B's scope and blocks READY until published",
         raises(c, "select geo.n5_generation_mark_ready(%s, array['111','112'])", (GEN_B,), r"prefixes_unpublished = 1"))
    publish(c, GEN_B, "113")
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
         q1(c, "select count(*) from geo.zip_authoritative_membership where generation_id=%s", (GEN_B,)) == 6
         and q1(c, """select count(*) from geo.zip_authoritative_membership m where m.generation_id=%s and not exists
                      (select 1 from geo.zip_authoritative_marker k where k.generation_id=m.generation_id
                          and k.zcta5=m.zcta5 and k.source_key=m.source_key)""", (GEN_B,)) == 0)
    s.ok("D6 a point that MOVED since phase1 publishes at B's coordinate, never the legacy one",
         q(c, "select lat, lng from geo.zip_authoritative_membership where generation_id=%s and source_key='dev:P1'", (GEN_B,))
         == [{"lat": 0.6, "lng": 0.6}])
    s.ok("D7 a stale legacy point cannot resurrect a project B's snapshot has no coordinate for (P6)",
         q1(c, "select count(*) from geo.n5_boundary_membership where generation_id=%s and source_key='dev:P6'", (GEN_B,)) == 0)
    s.ok("D8 a legacy reject does not decide B: P4 (rejected in phase1, eligible now) is published",
         q1(c, "select count(*) from geo.zip_authoritative_membership where generation_id=%s and source_key='dev:P4'", (GEN_B,)) == 1)
    s.ok("8b B's status rows cover every canonical ZIP of its prefixes (incl. 11199 not_measured)",
         q1(c, "select string_agg(zip||':'||status||':'||membership_rows, ',' order by zip) from geo.maps_zip_geography_status where generation_id=%s", (GEN_B,))
         == "11101:boundary_complete:2,11102:boundary_complete:2,11199:not_measured:0,11201:boundary_complete:1,11301:boundary_complete:1")

    q1(c, "select geo.n5_gen_record_unresolved(%s)", (GEN_B,))
    got = {r["source_key"]: r["reason_code"] for r in q(c, "select source_key, reason_code from geo.n5_generation_unresolved where generation_id=%s", (GEN_B,))}
    s.ok("7  explicit evidence-backed unresolved outcomes, one per class",
         got == {"dev:P6": "POINT_REJECTED", "dev:P7": "GEOMETRY_INVALID", "dev:P8": "REGISTRY_NOAUTH",
                 "dev:P9": "NO_INTERSECTION_WITH_GENERATION_ZCTAS", "dev:P12": "POINT_REJECTED"}, got)
    s.ok("6  an expected record with neither membership nor evidence (P10) blocks READY",
         raises(c, "select geo.n5_generation_mark_ready(%s, array['111','112'])", (GEN_B,), r"INV-1 violated — 1 of"))
    r111 = q(c, "select * from geo.n5_reconcile_chunk(%s,'111')", (GEN_B,))[0]
    s.ok("5  P3 (stated 111, resolved into 11201) counts RESOLVED for chunk 111",
         (r111["expected_keys"], r111["accounted_resolved"], r111["accounted_unresolved"], r111["unaccounted"]) == (7, 4, 3, 0),
         dict(r111))
    per_chunk = [q(c, "select expected_keys, accounted_resolved, accounted_unresolved, unaccounted "
                      "from geo.n5_reconcile_chunk(%s,%s)", (GEN_B, k))[0] for k in ("111", "112")]
    setb = q(c, "select * from geo.n5_reconcile_chunks(%s, array['111','112'])", (GEN_B,))[0]
    s.ok("5b the set-based reconcile equals the per-chunk definition, chunk for chunk",
         (setb["chunks"], setb["expected_keys"], setb["accounted_resolved"], setb["accounted_unresolved"], setb["unaccounted"])
         == (2, sum(r["expected_keys"] for r in per_chunk), sum(r["accounted_resolved"] for r in per_chunk),
             sum(r["accounted_unresolved"] for r in per_chunk), sum(r["unaccounted"] for r in per_chunk))
         and [dict(r) for r in q(c, "select expected_keys, accounted_resolved, accounted_unresolved, unaccounted "
                                    "from geo.n5_generation_reconcile where generation_id=%s and chunk_key in ('111','112') "
                                    "order by chunk_key", (GEN_B,))] == [dict(r) for r in per_chunk],
         (dict(setb), [dict(r) for r in per_chunk]))
    s.ok("6b the declared chunk set must cover every expected key",
         raises(c, "select geo.n5_generation_mark_ready(%s, array['111'])", (GEN_B,), r"expected_keys_outside_declared_chunks"))

    # evidence for P10 arrives through the pipeline (a shard verdict), then accounting is re-run
    q(c, "insert into geo.n5_generation_key_verdict (generation_id, source_key, registry_id, verdict) "
         "values (%s,'dev:P10','reg-ok','RECOVERY_NOT_RETURNED')", (GEN_B,))
    s.ok("7b stale unresolved accounting (older than the last publish) is refused at READY",
         raises(c, "select geo.n5_generation_mark_ready(%s, array['111','112'])", (GEN_B,), r"INV-1|unresolved"))
    q1(c, "select geo.n5_gen_record_unresolved(%s)", (GEN_B,))
    s.ok("7c a persisted shard verdict becomes an evidence-backed outcome (P10 RECOVERY_NOT_RETURNED)",
         q1(c, "select reason_code from geo.n5_generation_unresolved where generation_id=%s and source_key='dev:P10'", (GEN_B,))
         == "RECOVERY_NOT_RETURNED")

    # C1: a writer that saw BUILDING holds the generation until it commits; READY waits.
    # NOT c.dsn: psycopg2 masks the password there ("password=xxx"), which only works
    # against a trust-auth server. Rebuild it from the admin DSN plus this database's name.
    w = psycopg2.connect(with_db(admin_dsn(), c.get_dsn_parameters()["dbname"]))
    try:
        with w.cursor() as wc:
            wc.execute("insert into geo.zip_authoritative_membership (generation_id, zcta5, source_key, point_rule, "
                       "feature_count, geom_family, run_id) values (%s,'11199','dev:PX','X',1,'X','w')", (GEN_B,))
        q(c, "set lock_timeout = '700ms'")
        s.ok("C1 READY cannot commit while a BUILDING-time write is still open",
             raises(c, "select geo.n5_generation_mark_ready(%s, array['111','112'])", (GEN_B,), r"lock timeout"))
    finally:
        q(c, "reset lock_timeout")
        w.rollback()
        w.close()

    q(c, "select geo.n5_generation_mark_ready(%s, array['111','112'])", (GEN_B,))
    s.ok("G6 recorded unresolved outcomes are frozen once B leaves BUILDING",
         raises(c, "delete from geo.n5_generation_unresolved where generation_id=%s", (GEN_B,), r"N5 GUARD"))
    s.ok("control: B is READY and A still serves",
         q1(c, "select state from geo.n5_generation where generation_id=%s", (GEN_B,)) == "READY"
         and map_snapshot(c) == pre)

    fp_a = gen_fingerprint(c, LEGACY)
    q(c, "select geo.n5_generation_activate(%s, array['111','112'])", (GEN_B,))
    s.ok("10 activation switches Map 1 from A to B (P5 gone, P4 and P3 visible)",
         refs(c, "11101") == ["dev:P1", "dev:P2"] and refs(c, "11102") == ["dev:P2", "dev:P4"]
         and refs(c, "11201") == ["dev:P3"] and refs(c, "11301") == ["dev:P11"],
         [refs(c, z) for z in ("11101", "11102", "11201", "11301")])
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
         entries == [("11102", "dev:P4"), ("11201", "dev:P3"), ("11301", "dev:P11")], entries)
    s.ok("16b entries are refused for the baseline (no predecessor)",
         raises(c, "select * from geo.n5_generation_entries(%s)", (LEGACY,), r"no predecessor"))
    served_b = map_snapshot(c)
    agree = all(
        sorted(p.get("source_key") for p in (q1(c, "select public.app_projects_for_zip(%s,'development')", (z,)) or [])
               if isinstance(p, dict)) == refs(c, z)
        for z in ("11101", "11102", "11201", "11301"))
    s.ok("X2 the Development pages and Map 1 show the same projects for every served ZIP", agree)
    q(c, "delete from public.app_zip_geography_cutover")
    s.ok("X3 with the retired switch emptied, every resident surface is unchanged", map_snapshot(c) == served_b)

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
    q(c, SNAP_B, {"gen": GEN_C, "snap": "snapC"})
    q1(c, "select geo.n5_gen_prepare_publish(%s)", (GEN_C,))
    publish(c, GEN_C, "111")
    s.ok("13b a partial candidate C leaves Map 1 serving B", map_snapshot(c) == served_b)
    s.ok("13c a partial candidate C cannot become READY",
         raises(c, "select geo.n5_generation_mark_ready(%s, array['111','112'])", (GEN_C,), r"prefixes_unpublished"))
    q(c, "select geo.n5_generation_fail(%s, 'fixture: build failed')", (GEN_C,))
    d = q1(c, "select geo.n5_generation_discard(%s)", (GEN_C,))
    s.ok("13d a FAILED candidate discards only its own rows; A and B untouched",
         q1(c, "select count(*) from geo.zip_authoritative_membership where generation_id=%s", (GEN_C,)) == 0
         and q1(c, "select count(*) from geo.n5_gen_proven_point where generation_id=%s", (GEN_C,)) == 0
         and q1(c, "select count(*) from geo.n5_generation_key_verdict where generation_id=%s", (GEN_C,)) == 0
         and q1(c, "select count(*) from geo.n5_gen_proven_point where generation_id=%s", (GEN_B,)) == 5
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
    "M8 the cutover row gates Development again": ("X1", """
        do $m$ begin execute replace(pg_get_functiondef('public.app_projects_for_zip(text,text)'::regprocedure),
          'return public.app_authoritative_projects_for_zip(p_zip);',
          'if exists (select 1 from public.app_zip_geography_cutover c where c.zip = p_zip and c.enabled) then '
          'return public.app_authoritative_projects_for_zip(p_zip); end if; '
          'return jsonb_build_object(''unavailable'', true, ''zip_geography_status'', ''boundary_complete_not_cut_over'', ''projects'', null);'); end $m$;"""),
    "M9 publication scope shrinks to the shards": ("S1", """
        create or replace function geo.n5_generation_publish_scope(p_generation_id text) returns table (z3 char(3))
        language sql stable as $$ select s.z3::char(3) from geo.n5_shard s where s.generation_id = p_generation_id $$;"""),
    "M10 the write guard reads state without locking it": ("C1", """
        do $m$ begin execute replace(pg_get_functiondef('geo.n5_generation_row_guard()'::regprocedure),
          'where g.generation_id = v_gen for share;', 'where g.generation_id = v_gen;'); end $m$;"""),
    "M11 candidate geometry reads the legacy proven points": ("D6", """
        create or replace function geo.n5_gen_candidate_geom(p_generation_id text) returns setof geo.n5_geom
        language sql stable as $$
          select g.* from geo.n5_geom g
           where g.provenance = 'proven_stored_point'
              or exists (select 1 from geo.n5_gen_recovered_key rk
                          where rk.generation_id = p_generation_id and rk.source_key = g.source_key) $$;"""),
    "M12 unresolved accounting ignores the persisted verdicts": ("7", """
        do $m$ begin execute replace(pg_get_functiondef('geo.n5_gen_record_unresolved(text)'::regprocedure),
          'when v.verdict in (''NULL_COORD'',''MULTI_COORD_UNRESOLVED'') then ''POINT_REJECTED''', ''); end $m$;"""),
    "M13 the set-based reconcile bounds RESOLVED by the chunk": ("5b", """
        do $m$ begin execute replace(pg_get_functiondef('geo.n5_reconcile_chunks(text,text[])'::regprocedure),
          'left join n5_rc_res rs on rs.source_key = k.source_key',
          'left join n5_rc_res rs on rs.source_key = k.source_key and exists (select 1 from geo.zip_authoritative_membership mm where mm.generation_id = p_generation_id and mm.source_key = k.source_key and left(mm.zcta5, length(c.k)) = c.k)'); end $m$;"""),
    "M14 publish stops requiring preparation": ("D1", """
        do $m$ begin execute replace(pg_get_functiondef('geo.n5_gen_publish_prefix(text,text,text,integer,double precision,double precision,double precision)'::regprocedure),
          'if g.publish_prepared_at is null then', 'if false then'); end $m$;"""),
    "M15 preparation stops applying the multi-coordinate rule": ("D2", """
        do $m$ begin execute replace(pg_get_functiondef('geo.n5_gen_prepare_publish(text)'::regprocedure),
          'from n5_prep_proven k where k.nc = 1;', 'from n5_prep_proven k where k.nc >= 1;'); end $m$;"""),
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
        ms = None
        try:
            ms = Suite(mconn, name.split()[0])
            run(mconn, name.split()[0], mutate=sql, suite=ms)
            red = [n for n in ms.failed() if n.split()[0] == test_id] or ms.failed()[:1]
        except RuntimeError as e:
            red = []  # did not apply: counted as SURVIVED, never as a kill
            print(f"   {e}")
        except Exception as e:  # a mutation that crashes the suite is still a kill, but say so
            first = (ms.failed()[:1] if ms else [])
            red = first + [f"then aborted: {str(e).splitlines()[0]}"] if first else \
                  [f"aborted before any check failed: {str(e).splitlines()[0]}"]
        mconn.close()
        drop_db(mdb)
        verdict = "KILLED" if red else "SURVIVED"
        caught = "by its guarding test" if red and red[0].split()[0] == test_id else "FIRST by another check"
        print(f"{verdict} — {name}  (guarding test {test_id}; caught {caught}: {red[:2]})")
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

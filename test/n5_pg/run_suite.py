#!/usr/bin/env python3
"""EXECUTABLE PostgreSQL + PostGIS proof for the N5 canonical-geometry migration and the
verdict publication / canonical synchronization lifecycle, at PR #1016.

Every assertion in this file is a DATABASE assertion: it runs the ACTUAL migration file and
the ACTUAL SQL produced by scripts/n5_shard.py against a real PostGIS server, then reads the
result back out of the database. No regex, no source matching, no docstring or message-string
inspection counts here - those live in test/n5-canonical-provenance.test.mjs and are reported
separately.

DISPOSABLE TARGET ONLY. The suite refuses to run if Supabase credentials are present in the
environment, and it DROPs and recreates its schemas on every run. It must never be pointed at
production.

The one substitution: scripts/n5_shard.py talks to the database through n3_pilot.sql(), which
POSTs to the Supabase query endpoint. That function is replaced with a shim that executes the
identical SQL text against the test database and returns rows in the same shape. The SQL under
test is unchanged - only the transport is.
"""
import json
import os
import sys
import traceback

import psycopg2
import psycopg2.extras

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

for _v in ("SUPABASE_ACCESS_TOKEN", "SUPABASE_WRITE_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    if os.environ.get(_v):
        raise SystemExit(f"STOP: {_v} is set. This suite must only ever run against a "
                         f"disposable database. Refusing.")

DSN = os.environ.get("N5_TEST_DSN")
if not DSN:
    raise SystemExit("STOP: set N5_TEST_DSN to the disposable database connection string.")

MIGRATION = os.path.join(ROOT, "docs", "n5-canonical-geometry-provenance.sql")
FIXTURE = os.path.join(ROOT, "test", "n5_pg", "fixture_pre_state.sql")
LEGACY  = os.path.join(ROOT, "test", "n5_pg", "fixture_legacy_seed.sql")

RESULTS = []
GROUP = "?"


def group(g):
    global GROUP
    GROUP = g


def check(num, name, cond, detail=""):
    RESULTS.append((GROUP, num, name, bool(cond), detail))
    print(("PASS" if cond else "FAIL") + f" [{GROUP}] {num:>2}. {name}"
          + (("   << " + str(detail)[:180]) if (detail and not cond) else ""))


def raises(fn, *a, **kw):
    """Return (raised, message). SystemExit is the builder's refusal mechanism."""
    try:
        fn(*a, **kw)
        return False, ""
    except SystemExit as e:
        return True, str(e)
    except Exception as e:                      # a genuine crash is NOT a clean refusal
        return False, f"UNEXPECTED {type(e).__name__}: {e}"


# --------------------------------------------------------------- transport shim

def new_conn(autocommit=False):
    c = psycopg2.connect(DSN)
    c.autocommit = autocommit
    return c


CONN = new_conn()


def shim(query, tag=""):
    """Stand-in for n3_pilot.sql(). One call = one implicit transaction = one round trip,
    matching the Supabase query endpoint, and a failure raises SystemExit exactly as the
    real helper does."""
    try:
        with CONN.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query)
            rows = [dict(r) for r in cur.fetchall()] if cur.description else []
        CONN.commit()
        return rows
    except Exception as e:
        CONN.rollback()
        raise SystemExit(f"STOP: SQL {tag} failed\n{type(e).__name__}: {e}")


def q(sql_text):
    """Direct read for assertions - never routed through the code under test."""
    with CONN.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql_text)
        rows = [dict(r) for r in cur.fetchall()] if cur.description else []
    CONN.commit()
    return rows


def q1(sql_text):
    r = q(sql_text)
    return list(r[0].values())[0] if r else None


def exec_raw(sql_text):
    """Returns (ok, error_text). Used to prove a constraint REJECTS something."""
    try:
        with CONN.cursor() as cur:
            cur.execute(sql_text)
        CONN.commit()
        return True, ""
    except Exception as e:
        CONN.rollback()
        return False, f"{type(e).__name__}: {e}"


import n3_pilot                                                        # noqa: E402
import n5_shard                                                        # noqa: E402

n3_pilot.sql = shim
n5_shard.sql = shim
assert n5_shard.sql is shim, "transport shim not installed"


# --------------------------------------------------------------- environment reset

def apply_script(path_or_text, is_path=True, inject_failure=None):
    """Apply a whole SQL script in ONE autocommit round trip, so the script's own
    begin;/commit; brackets it exactly as a production applier would have to."""
    text = open(path_or_text, encoding="utf-8").read() if is_path else path_or_text
    if inject_failure:
        text = text.replace("\ncommit;", "\n" + inject_failure + "\ncommit;")
    c = new_conn(autocommit=True)
    try:
        with c.cursor() as cur:
            cur.execute(text)
        return True, ""
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
    finally:
        c.close()


def reset(apply_migration=True, pre_geom=None, pre_assoc=None, legacy=False):
    """Destroy and rebuild the disposable schemas. `pre_geom` / `pre_assoc` are seeded
    BEFORE the migration, so the migration is exercised against pre-existing rows."""
    apply_script("drop schema if exists geo cascade; drop schema if exists preservation cascade; "
                 "drop table if exists public.app_projects cascade;", is_path=False)
    ok, err = apply_script(FIXTURE)
    if not ok:
        raise SystemExit("fixture failed: " + err)
    if legacy:
        ok, err = apply_script(LEGACY)
        if not ok:
            raise SystemExit("legacy seed failed: " + err)
    if pre_geom:
        apply_script(pre_geom, is_path=False)
    if pre_assoc:
        apply_script(pre_assoc, is_path=False)
    if apply_migration:
        ok, err = apply_script(MIGRATION)
        if not ok:
            raise SystemExit("migration failed during reset: " + err)
    return True


# --------------------------------------------------------------- fixtures

def L(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def N(v):
    return "null" if v is None else str(v)


def seed_registry(mapping):
    vals = ",".join(f"({L(k)},{L(v)})" for k, v in mapping.items())
    apply_script(f"insert into geo.n5_accepted_source (registry_id,treatment) values {vals} "
                 f"on conflict (registry_id) do update set treatment=excluded.treatment;",
                 is_path=False)


def seed_identity(snapshot, rows, record_kind="development"):
    """rows: (source_key, zip, registry_id, lat, lng, source_seq)"""
    if not rows:
        return
    vals = ",".join(
        f"({L(snapshot)},{L(sk)},{L(zp)},{L(rid)},{N(lat)},{N(lng)},{N(seq)},{L(record_kind)})"
        for sk, zp, rid, lat, lng, seq in rows)
    apply_script("insert into preservation.app_project_identity "
                 "(snapshot_id,source_key,zip,registry_id,lat,lng,source_seq,record_kind) "
                 "values " + vals + ";", is_path=False)


def seed_snapshot(snapshot):
    apply_script(f"insert into geo.n5_snapshot (snapshot_id,sources,projects,pairs,n_rows) "
                 f"values ({L(snapshot)},1,1,1,1) on conflict (snapshot_id) do nothing;",
                 is_path=False)


def use_snapshot(s):
    n5_shard.SNAPSHOT = s


def verdicts():
    return {r["source_key"]: r for r in q(
        f"select source_key, verdict, lat, lng, ncoord from geo.n5_proven_verdict "
        f"where snapshot_id='{n5_shard.SNAPSHOT}';")}


def manifest():
    r = q(f"select * from geo.n5_verdict_manifest where snapshot_id='{n5_shard.SNAPSHOT}';")
    return r[0] if r else None


# =============================================================================
group("MIGRATION")
# =============================================================================

# 1 - the complete migration executes on PostgreSQL/PostGIS.
reset(apply_migration=False)
ok, err = apply_script(MIGRATION)
check(1, "complete migration executes successfully on PostgreSQL/PostGIS", ok, err)

# 3 - association PK becomes (source_key, zip).
pk = q1("""select string_agg(a.attname, ',' order by k.ord)
             from pg_constraint c
             join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
             join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
            where c.conrelid='geo.n5_association'::regclass and c.contype='p';""")
check(3, "association PK is (source_key, zip) and the migration leaves it alone",
      pk == "source_key,zip"
      and "drop constraint if exists n5_association_pkey" not in open(MIGRATION, encoding="utf-8").read(),
      f"got {pk!r}")

# 4 - pre-existing RECOVERY geometry survives untouched and stays UNATTRIBUTED.
#     (Premise updated 2026-09-03: the provenance backfill belongs to the parallel session and
#      is already applied in production, so the migration no longer performs it. What #1016
#      must guarantee is that recovered geometry is preserved and keeps verdict_snapshot_id
#      NULL - which the biconditional then requires of it.)
reset(apply_migration=False, pre_geom="""
insert into geo.n5_geom (source_key,registry_id,feature_id,outcome,geom,first_z3,provenance)
values ('sk-rec-1','r-rec','oid-9',1,ST_SetSRID(ST_MakePoint(-71.1,42.3),4269),'021','recovered_authoritative'),
       ('sk-rec-2','r-rec','oid-8',1,ST_SetSRID(ST_MakePoint(-71.2,42.4),4269),'021','recovered_authoritative');""")
before_n = q1("select count(*) from geo.n5_geom;")
ok4, err4 = apply_script(MIGRATION)
after = q("select source_key, provenance, verdict_snapshot_id, ST_X(geom) x from geo.n5_geom "
          "order by source_key;")
check(4, "pre-existing RECOVERY geometry is preserved and stays unattributed",
      ok4 and before_n == 2 and len(after) == 2
      and all(r["provenance"] == "recovered_authoritative" for r in after)
      and all(r["verdict_snapshot_id"] is None for r in after)
      and abs(after[0]["x"] - (-71.1)) < 1e-9,
      err4 or after)

# 2 - an injected failure rolls back the ENTIRE migration transaction.
reset(apply_migration=False, legacy=True)
ok2, err2 = apply_script(MIGRATION, inject_failure=
                         "do $inj$ begin raise exception 'INJECTED MIGRATION FAILURE'; end $inj$;")
rolled = {
    "manifest_absent": q1("select to_regclass('geo.n5_verdict_manifest') is null;"),
    "verdict_absent": q1("select to_regclass('geo.n5_proven_verdict') is null;"),
    "stage_absent": q1("select to_regclass('geo.n5_association_stage') is null;"),
    "verdict_snapshot_id_absent": q1("""select not exists (select 1 from information_schema.columns
        where table_schema='geo' and table_name='n5_geom' and column_name='verdict_snapshot_id');"""),
    "archive_absent": q1("select to_regclass('geo.n5_point_reject_archive') is null;"),
    "reject_pk_unchanged": q1("""select pg_get_constraintdef(oid) from pg_constraint
        where conrelid='geo.n5_point_reject'::regclass and contype='p';""")
        == 'PRIMARY KEY (source_key, reason)',
    "legacy_rejects_intact": q1("select count(*) from geo.n5_point_reject;") == 2,
    "legacy_points_intact": q1("select count(*) from geo.n5_geom "
                               "where provenance='proven_stored_point';") == 3,
}
check(2, "injected migration failure rolls back the ENTIRE transaction",
      (not ok2) and all(rolled.values()), {"applied": ok2, **rolled})

# rebuild a clean migrated database for the constraint tests
reset()

# 5 - provenance constraints reject invalid combinations.
bad_prov, e5a = exec_raw("""insert into geo.n5_geom
  (source_key,registry_id,feature_id,outcome,geom,first_z3,provenance)
  values ('x1','r','f1',1,ST_SetSRID(ST_MakePoint(-71,42),4269),'021','bogus_value');""")
null_prov, e5b = exec_raw("""insert into geo.n5_geom
  (source_key,registry_id,feature_id,outcome,geom,first_z3)
  values ('x2','r','f2',1,ST_SetSRID(ST_MakePoint(-71,42),4269),'021');""")
good_prov, e5c = exec_raw("""insert into geo.n5_geom
  (source_key,registry_id,feature_id,outcome,geom,first_z3,provenance)
  values ('x3','r','f3',1,ST_SetSRID(ST_MakePoint(-71,42),4269),'021','recovered_authoritative');""")
check(5, "provenance constraints reject invalid combinations",
      (not bad_prov) and (not null_prov) and good_prov,
      {"allowlist": e5a[:70], "not_null": e5b[:70], "valid_rejected": e5c[:70]})

# 6 - verdict_snapshot_id biconditional.
prov_no_vsid, e6a = exec_raw("""insert into geo.n5_geom
  (source_key,registry_id,feature_id,outcome,geom,first_z3,provenance)
  values ('y1','r','pt:1',1,ST_SetSRID(ST_MakePoint(-71,42),4269),'021','proven_stored_point');""")
rec_with_vsid, e6b = exec_raw("""insert into geo.n5_geom
  (source_key,registry_id,feature_id,outcome,geom,first_z3,provenance,verdict_snapshot_id)
  values ('y2','r','f9',1,ST_SetSRID(ST_MakePoint(-71,42),4269),'021','recovered_authoritative','S1');""")
proven_ok, e6c = exec_raw("""insert into geo.n5_geom
  (source_key,registry_id,feature_id,outcome,geom,first_z3,provenance,verdict_snapshot_id)
  values ('y3','r','pt:1',1,ST_SetSRID(ST_MakePoint(-71,42),4269),'021','proven_stored_point','S1');""")
check(6, "verdict_snapshot_id constraints reject invalid combinations",
      (not prov_no_vsid) and (not rec_with_vsid) and proven_ok,
      {"proven_null_vsid": e6a[:70], "recovered_with_vsid": e6b[:70], "valid": e6c[:70]})

# 7 - the pt: namespace reservation.
proven_pt2, e7a = exec_raw("""insert into geo.n5_geom
  (source_key,registry_id,feature_id,outcome,geom,first_z3,provenance,verdict_snapshot_id)
  values ('z1','r','pt:2',1,ST_SetSRID(ST_MakePoint(-71,42),4269),'021','proven_stored_point','S1');""")
rec_squats, e7b = exec_raw("""insert into geo.n5_geom
  (source_key,registry_id,feature_id,outcome,geom,first_z3,provenance)
  values ('z2','r','pt:1',1,ST_SetSRID(ST_MakePoint(-71,42),4269),'021','recovered_authoritative');""")
check(7, "pt:1 namespace constraint works (no pt:2, no recovered squatter)",
      (not proven_pt2) and (not rec_squats), {"pt2": e7a[:70], "squat": e7b[:70]})

# 8 - malformed READY manifest rows are rejected, including NULL verdict_rows.
cases8 = {
    "null_verdict_rows": ("insert into geo.n5_verdict_manifest (snapshot_id,state,"
                          "expected_source_keys,verdict_rows,eligible_rows,reject_counts,"
                          "fingerprint,completed_at) values ('m1','READY',5,null,5,'{}'::jsonb,"
                          "'f',now());"),
    "null_expected": ("insert into geo.n5_verdict_manifest (snapshot_id,state,"
                      "expected_source_keys,verdict_rows,eligible_rows,reject_counts,"
                      "fingerprint,completed_at) values ('m2','READY',null,5,5,'{}'::jsonb,"
                      "'f',now());"),
    "null_eligible": ("insert into geo.n5_verdict_manifest (snapshot_id,state,"
                      "expected_source_keys,verdict_rows,eligible_rows,reject_counts,"
                      "fingerprint,completed_at) values ('m3','READY',5,5,null,'{}'::jsonb,"
                      "'f',now());"),
    "null_reject_counts": ("insert into geo.n5_verdict_manifest (snapshot_id,state,"
                           "expected_source_keys,verdict_rows,eligible_rows,reject_counts,"
                           "fingerprint,completed_at) values ('m4','READY',5,5,5,null,"
                           "'f',now());"),
    "null_completed_at": ("insert into geo.n5_verdict_manifest (snapshot_id,state,"
                          "expected_source_keys,verdict_rows,eligible_rows,reject_counts,"
                          "fingerprint,completed_at) values ('m5','READY',5,5,5,'{}'::jsonb,"
                          "'f',null);"),
    "null_fingerprint": ("insert into geo.n5_verdict_manifest (snapshot_id,state,"
                         "expected_source_keys,verdict_rows,eligible_rows,reject_counts,"
                         "fingerprint,completed_at) values ('m6','READY',5,5,5,'{}'::jsonb,"
                         "null,now());"),
    "counts_disagree": ("insert into geo.n5_verdict_manifest (snapshot_id,state,"
                        "expected_source_keys,verdict_rows,eligible_rows,reject_counts,"
                        "fingerprint,completed_at) values ('m7','READY',5,4,4,'{}'::jsonb,"
                        "'f',now());"),
    "synced_while_building": ("insert into geo.n5_verdict_manifest (snapshot_id,state,"
                              "canonical_synced_at) values ('m8','BUILDING',now());"),
    "bad_state": "insert into geo.n5_verdict_manifest (snapshot_id,state) values ('m9','LIVE');",
}
rejected8 = {k: (not exec_raw(v)[0]) for k, v in cases8.items()}
good8, e8 = exec_raw("insert into geo.n5_verdict_manifest (snapshot_id,state,"
                     "expected_source_keys,verdict_rows,eligible_rows,reject_counts,"
                     "fingerprint,completed_at) values ('m0','READY',5,5,5,'{}'::jsonb,'f',now());")
check(8, "malformed READY manifest rows rejected, incl. NULL verdict_rows",
      all(rejected8.values()) and good8,
      {**{k: ("rejected" if v else "ACCEPTED") for k, v in rejected8.items()},
       "valid_row_accepted": good8, "err": e8[:70]})


# =============================================================================
group("GLOBAL VERDICT")
# =============================================================================
S1, S2 = "snap-S1", "snap-S2"

BASE_ROWS = [
    # source_key,     zip,    registry_id, lat,   lng,    seq
    ("sk-ok",        "02138", "r-proven",  42.0,  -71.0,  1),
    ("sk-multi",     "02139", "r-proven",  42.0,  -71.0,  1),
    ("sk-multi",     "02139", "r-proven",  43.5,  -72.5,  2),
    # THE COORDINATE-PAIR REGRESSION: independent min(lat)/min(lng) would emit (41,-71).
    ("sk-pair",      "02140", "r-proven",  42.0,  -71.0,  1),
    ("sk-pair",      "02140", "r-proven",  41.0,  None,   2),
    ("sk-null",      "02141", "r-proven",  None,  None,   1),
    ("sk-range",     "02142", "r-proven",  999.0, -71.0,  1),
    ("sk-island",    "02143", "r-proven",  0.0,   0.0,    1),
    ("sk-nonproven", "02144", "r-rec",     42.1,  -71.1,  1),
    # one project on THREE page ZIPs with the SAME coordinate -> still one eligible project
    ("sk-dup",       "02145", "r-proven",  42.9,  -71.9,  1),
    ("sk-dup",       "02146", "r-proven",  42.9,  -71.9,  2),
    ("sk-dup",       "02147", "r-proven",  42.9,  -71.9,  3),
]

reset()
seed_registry({"r-proven": "PROVEN", "r-rec": "RECOVERY"})
seed_snapshot(S1)
seed_identity(S1, BASE_ROWS)
use_snapshot(S1)

# ---- 17 / 18 must be proved BEFORE any successful publish exists.
group("PUBLICATION")
use_snapshot("")
r17, m17 = raises(n5_shard.publish_verdict)
check(17, "missing SNAPSHOT fails before any work",
      r17 and "SNAPSHOT must be set explicitly" in m17
      and q1("select count(*) from geo.n5_verdict_manifest;") == 0, m17[:120])

seed_snapshot("orphan-snap")                       # declared, but zero identity rows
use_snapshot("orphan-snap")
r18, m18 = raises(n5_shard.publish_verdict)
check(18, "frozen-input-absent / orphan snapshot fails, no manifest row created",
      r18 and "ORPHAN" in m18
      and q1("select count(*) from geo.n5_verdict_manifest "
             "where snapshot_id='orphan-snap';") == 0, m18[:140])
r18b, m18b = raises(n5_shard.assert_snapshot_consumable)
check(18.1, "an orphan snapshot is also refused at CONSUMPTION, not only at publish",
      r18b and "ORPHAN" in m18b, m18b[:140])

# ---- the successful publish
use_snapshot(S1)
pub_err = ""
try:
    n5_shard.publish_verdict()
    published = True
except SystemExit as e:
    published, pub_err = False, str(e)

group("GLOBAL VERDICT")
V = verdicts()
check(9, "valid globally-single PROVEN project -> ELIGIBLE",
      V.get("sk-ok", {}).get("verdict") == "ELIGIBLE"
      and abs(float(V["sk-ok"]["lat"]) - 42.0) < 1e-12
      and abs(float(V["sk-ok"]["lng"]) - (-71.0)) < 1e-12, V.get("sk-ok"))
check(10, "globally multi-coordinate project -> MULTI_COORD_UNRESOLVED",
      V.get("sk-multi", {}).get("verdict") == "MULTI_COORD_UNRESOLVED"
      and int(V["sk-multi"]["ncoord"]) == 2
      and V["sk-multi"]["lat"] is None, V.get("sk-multi"))
p = V.get("sk-pair", {})
check(11, "same-row derivation never fabricates a pair: A(42,-71)+B(41,NULL) -> (42,-71)",
      p.get("verdict") == "ELIGIBLE" and p.get("lat") is not None
      and abs(float(p["lat"]) - 42.0) < 1e-12 and abs(float(p["lng"]) - (-71.0)) < 1e-12
      and not (abs(float(p["lat"]) - 41.0) < 1e-12), p)
check(12, "NULL coordinate project -> NULL_COORD",
      V.get("sk-null", {}).get("verdict") == "NULL_COORD"
      and int(V["sk-null"]["ncoord"]) == 0, V.get("sk-null"))
check(13, "invalid-range project -> INVALID_COORD",
      V.get("sk-range", {}).get("verdict") == "INVALID_COORD", V.get("sk-range"))
check(14, "null-island project -> NULL_ISLAND",
      V.get("sk-island", {}).get("verdict") == "NULL_ISLAND", V.get("sk-island"))
check(15, "non-PROVEN registry verdict fails closed (absent from the verdict entirely)",
      "sk-nonproven" not in V, sorted(V))
unknown_reg_absent = q1("""select count(*) from geo.n5_proven_verdict v
      where not exists (select 1 from geo.n5_accepted_source a
                         where a.registry_id=v.registry_id and a.treatment='PROVEN');""")
check(15.1, "no verdict row exists for a registry_id without a PROVEN verdict",
      unknown_reg_absent == 0, unknown_reg_absent)
d = V.get("sk-dup", {})
check(16, "one source_key across many page ZIPs with the same coordinate stays ONE eligible project",
      d.get("verdict") == "ELIGIBLE" and int(d["ncoord"]) == 1
      and q1("select count(*) from geo.n5_proven_verdict where source_key='sk-dup' "
             f"and snapshot_id='{S1}';") == 1, d)

# =============================================================================
group("PUBLICATION")
# =============================================================================
m = manifest()
check(24, "successful completeness validation transitions to READY with recorded metrics",
      published and m and m["state"] == "READY" and m["completed_at"] is not None
      and m["expected_source_keys"] == m["verdict_rows"] == 7
      and m["eligible_rows"] == 3 and m["reject_counts"] is not None
      and m["fingerprint"] is not None and m["canonical_synced_at"] is None,
      pub_err or (dict(m) if m else None))
check(21, "READY but canonical-unsynced cannot be consumed",
      raises(n5_shard.assert_snapshot_consumable)[0]
      and "canonical" in raises(n5_shard.assert_snapshot_consumable)[1], "")

apply_script(f"update geo.n5_verdict_manifest set state='BUILDING' where snapshot_id='{S1}';",
             is_path=False)
r19, m19 = raises(n5_shard.assert_snapshot_consumable)
check(19, "BUILDING cannot be consumed", r19 and "BUILDING" in m19, m19[:120])

apply_script(f"update geo.n5_verdict_manifest set state='FAILED' where snapshot_id='{S1}';",
             is_path=False)
r20, m20 = raises(n5_shard.assert_snapshot_consumable)
check(20, "FAILED cannot be consumed", r20 and "FAILED" in m20, m20[:120])
apply_script(f"update geo.n5_verdict_manifest set state='READY' where snapshot_id='{S1}';",
             is_path=False)

use_snapshot("snap-never-existed")
r22, m22 = raises(n5_shard.assert_snapshot_consumable)
check(22, "a wrong / unknown snapshot cannot be consumed",
      r22 and "not present in geo.n5_snapshot" in m22, m22[:120])
use_snapshot(S1)

# 23 - completeness failure prevents READY. The DERIVATION is fault-injected (one key
#      dropped) so the ENFORCEMENT path is what gets exercised.
_real_refresh = n5_shard.refresh_proven_verdict_sql
n5_shard.refresh_proven_verdict_sql = lambda: _real_refresh().replace(
    "where i.snapshot_id=", "where i.source_key <> 'sk-ok' and i.snapshot_id=")
r23, m23 = raises(n5_shard.publish_verdict)
m23row = manifest()
check(23, "completeness failure prevents READY, records FAILED, leaves sync NULL",
      r23 and "completeness FAILED" in m23 and m23row["state"] == "FAILED"
      and m23row["canonical_synced_at"] is None, {"msg": m23[:150], "state": m23row["state"]})
r23b, _ = raises(n5_shard.assert_snapshot_consumable)
check(23.1, "the FAILED snapshot produced by a completeness failure is not consumable", r23b)
n5_shard.refresh_proven_verdict_sql = _real_refresh

# 25 - rebuild uses set-replacement semantics and removes stale verdict rows.
seed_snapshot(S2)
seed_identity(S2, [("sk-other", "07001", "r-proven", 40.7, -74.0, 1)])
use_snapshot(S2)
n5_shard.publish_verdict()
use_snapshot(S1)
apply_script(f"""insert into geo.n5_proven_verdict
    (snapshot_id,source_key,registry_id,ncoord,lat,lng,verdict)
    values ('{S1}','sk-STALE','r-proven',0,null,null,'NULL_COORD');""", is_path=False)
n5_shard.publish_verdict()
check(25, "rebuilding a snapshot is set replacement: stale rows go, other snapshots untouched",
      q1(f"select count(*) from geo.n5_proven_verdict where snapshot_id='{S1}' "
         f"and source_key='sk-STALE';") == 0
      and q1(f"select count(*) from geo.n5_proven_verdict where snapshot_id='{S1}';") == 7
      and q1(f"select count(*) from geo.n5_proven_verdict where snapshot_id='{S2}';") == 1,
      {"s1": q1(f"select count(*) from geo.n5_proven_verdict where snapshot_id='{S1}';"),
       "s2": q1(f"select count(*) from geo.n5_proven_verdict where snapshot_id='{S2}';")})


# =============================================================================
group("SWEEP")
# =============================================================================
SW1 = [
    ("a-elig",       "02138", "r-proven", 42.0, -71.0, 1),
    ("b-move",       "02139", "r-proven", 43.0, -72.0, 1),
    ("c-good2bad",   "02140", "r-proven", 44.0, -73.0, 1),
    ("d-bad2good",   "02141", "r-proven", None, None,  1),
    ("e-multi2one",  "02142", "r-proven", 45.0, -74.0, 1),
    ("e-multi2one",  "02142", "r-proven", 46.0, -75.0, 2),
    ("f-one2multi",  "02143", "r-proven", 47.0, -76.0, 1),
    ("g-gone",       "02144", "r-proven", 48.0, -77.0, 1),
    ("h-prov2rec",   "02145", "r-proven", 49.0, -78.0, 1),
    ("i-reason",     "02146", "r-proven", None, None,  1),
]
SW2 = [
    ("a-elig",       "02138", "r-proven", 42.0, -71.0, 1),
    ("b-move",       "02139", "r-proven", 43.25, -72.25, 1),   # coordinate correction
    ("c-good2bad",   "02140", "r-proven", 999.0, -73.0, 1),    # eligible -> invalid
    ("d-bad2good",   "02141", "r-proven", 50.0, -79.0, 1),     # invalid -> eligible
    ("e-multi2one",  "02142", "r-proven", 45.0, -74.0, 1),     # multi -> single
    ("f-one2multi",  "02143", "r-proven", 47.0, -76.0, 1),     # single -> multi
    ("f-one2multi",  "02143", "r-proven", 47.5, -76.5, 2),
    # g-gone: ABSENT from S2 entirely
    ("h-prov2rec",   "02145", "r-rec",    49.0, -78.0, 1),     # PROVEN -> RECOVERY
    ("i-reason",     "02146", "r-proven", 0.0,  0.0,   1),     # NULL_COORD -> NULL_ISLAND
]

RECOVERED_ROW = """insert into geo.n5_geom
  (source_key,registry_id,feature_id,outcome,geom,first_z3,provenance)
  values ('h-prov2rec','r-rec','oid-77',1,ST_SetSRID(ST_MakePoint(-78.5,49.5),4269),'021',
          'recovered_authoritative') on conflict do nothing;"""


def fresh_s1(sync=False):
    """Reset to a freshly PUBLISHED S1, optionally already canonically synced."""
    reset()
    seed_registry({"r-proven": "PROVEN", "r-rec": "RECOVERY"})
    seed_snapshot(S1)
    seed_identity(S1, SW1)
    apply_script(RECOVERED_ROW, is_path=False)
    use_snapshot(S1)
    n5_shard.publish_verdict()
    if sync:
        n5_shard.sync_canonical()


def sweep_with(extra_sql=None, mid_failure=False):
    """Run sync_canonical with an injected statement, so the REAL verification query sees
    the corruption. Returns (raised, message)."""
    real = n5_shard.global_canonical_sweep_sql
    if mid_failure:
        n5_shard.global_canonical_sweep_sql = lambda: (
            real()[:2] + [("do $x$ begin raise exception 'INJECTED SWEEP FAILURE'; end $x$;",
                           "INJECTED")] + real()[2:])
    elif extra_sql:
        n5_shard.global_canonical_sweep_sql = lambda: real() + [(extra_sql, "INJECTED")]
    try:
        return raises(n5_shard.sync_canonical)
    finally:
        n5_shard.global_canonical_sweep_sql = real


def synced_at():
    return q1(f"select canonical_synced_at from geo.n5_verdict_manifest "
              f"where snapshot_id='{n5_shard.SNAPSHOT}';")


def pt1(sk):
    r = q(f"""select ST_X(geom) x, ST_Y(geom) y, verdict_snapshot_id v, provenance p, feature_id f
                from geo.n5_geom where source_key='{sk}' and feature_id='pt:1';""")
    return r[0] if r else None


def reject(sk):
    r = q(f"select reason, verdict_snapshot_id v from geo.n5_point_reject where source_key='{sk}';")
    return r[0] if r else None


# 26 - the barrier is NULLed BEFORE the first canonical mutation, proved by a probe that
#      reads the manifest from INSIDE the first sweep statement.
fresh_s1(sync=True)
apply_script("create table if not exists public._probe (seen boolean);"
             "delete from public._probe;", is_path=False)
check(26.0, "precondition: the snapshot is currently marked synced", synced_at() is not None)
_real = n5_shard.global_canonical_sweep_sql
n5_shard.global_canonical_sweep_sql = lambda: (
    [(f"insert into public._probe select canonical_synced_at is null "
      f"from geo.n5_verdict_manifest where snapshot_id='{S1}';", "PROBE")] + _real())
n5_shard.sync_canonical()
n5_shard.global_canonical_sweep_sql = _real
check(26, "sweep start NULLs canonical_synced_at BEFORE the first canonical mutation",
      q1("select bool_and(seen) from public._probe;") is True,
      q("select * from public._probe;"))

# 27 / 42 / 43 / 48 / 49 / 53 / 54 - the good S1 state.
fresh_s1(sync=True)
a = pt1("a-elig")
check(27, "eligible project creates pt:1 with the correct coordinate and snapshot",
      a and abs(a["x"] - (-71.0)) < 1e-9 and abs(a["y"] - 42.0) < 1e-9
      and a["v"] == S1 and a["p"] == "proven_stored_point", a)
g = n5_shard.verify_canonical_geometry_sets()
r = n5_shard.verify_canonical_reject_sets()
group("GEOMETRY EQUALITY")
check(42, "ELIGIBLE - canonical = 0 at sync publication", int(g["eligible_not_canonical"]) == 0, g)
check(43, "canonical - ELIGIBLE = 0 at sync publication", int(g["canonical_not_eligible"]) == 0, g)
group("REJECT EQUALITY")
check(48, "INELIGIBLE - reject = 0", int(r["ineligible_not_rejected"]) == 0, r)
check(49, "reject - INELIGIBLE = 0", int(r["rejected_not_ineligible"]) == 0, r)
group("SWEEP")
check(53, "successful reconciliation sets canonical_synced_at", synced_at() is not None)
check(54, "exact READY + synchronized snapshot becomes consumable",
      not raises(n5_shard.assert_snapshot_consumable)[0])

# 55 - re-running the identical sweep is idempotent.
def corpus_fp():
    return (q1("""select md5(string_agg(k, ',' order by k collate "C")) from (
        select source_key||'|'||feature_id||'|'||provenance||'|'||
               coalesce(verdict_snapshot_id,'-')||'|'||coalesce(ST_AsText(geom),'-') k
          from geo.n5_geom) z;"""),
            q1("""select md5(string_agg(k, ',' order by k collate "C")) from (
        select source_key||'|'||reason||'|'||verdict_snapshot_id k
          from geo.n5_point_reject) z;"""))
fp_a = corpus_fp()
n5_shard.sync_canonical()
fp_b = corpus_fp()
check(55, "re-running the identical canonical sweep is idempotent",
      fp_a == fp_b and synced_at() is not None, {"before": fp_a, "after": fp_b})

# 34 needs the recovered sibling to have survived the S1 sweep untouched.
check(34.0, "precondition: recovered_authoritative sibling exists alongside a proven point",
      q1("select count(*) from geo.n5_geom where source_key='h-prov2rec' "
         "and provenance='recovered_authoritative';") == 1)

# ---- S1 -> S2 transition
seed_snapshot(S2)
seed_identity(S2, SW2)
use_snapshot(S2)
n5_shard.publish_verdict()
n5_shard.sync_canonical()

b = pt1("b-move")
check(28, "coordinate correction updates the existing pt:1",
      b and abs(b["x"] - (-72.25)) < 1e-9 and abs(b["y"] - 43.25) < 1e-9 and b["v"] == S2, b)
check(29, "eligible -> invalid removes the stale pt:1 and records the reject",
      pt1("c-good2bad") is None and reject("c-good2bad")
      and reject("c-good2bad")["reason"] == "INVALID_COORD", reject("c-good2bad"))
check(30, "invalid -> eligible removes the stale reject and creates pt:1",
      reject("d-bad2good") is None and pt1("d-bad2good") is not None
      and abs(pt1("d-bad2good")["x"] - (-79.0)) < 1e-9, pt1("d-bad2good"))
check(31, "multi -> single removes the stale MULTI_COORD_UNRESOLVED reject and creates pt:1",
      reject("e-multi2one") is None and pt1("e-multi2one") is not None
      and abs(pt1("e-multi2one")["y"] - 45.0) < 1e-9, reject("e-multi2one"))
check(32, "single -> multi removes the stale pt:1 and creates the current reject",
      pt1("f-one2multi") is None and reject("f-one2multi")
      and reject("f-one2multi")["reason"] == "MULTI_COORD_UNRESOLVED", reject("f-one2multi"))
check(33, "a project ABSENT from S2 loses its stale S1 pt:1",
      pt1("g-gone") is None and reject("g-gone") is None,
      {"pt": pt1("g-gone"), "rej": reject("g-gone")})
check(34, "PROVEN -> RECOVERY removes the stale PROVEN pt:1 and KEEPS recovered geometry",
      pt1("h-prov2rec") is None
      and q1("select count(*) from geo.n5_geom where source_key='h-prov2rec' "
             "and provenance='recovered_authoritative';") == 1,
      q("select feature_id, provenance from geo.n5_geom where source_key='h-prov2rec';"))
check(35, "the current reject reason is replaced correctly across snapshots",
      reject("i-reason") and reject("i-reason")["reason"] == "NULL_ISLAND", reject("i-reason"))
check(36, "the current reject verdict_snapshot_id updates to the current snapshot",
      reject("i-reason") and reject("i-reason")["v"] == S2, reject("i-reason"))
check(56, "S1 -> S2 leaves NO stale S1 PROVEN point",
      q1(f"select count(*) from geo.n5_geom where provenance='proven_stored_point' "
         f"and verdict_snapshot_id <> '{S2}';") == 0)
check(57, "S1 -> S2 current rejects all carry S2 attribution",
      q1(f"select count(*) from geo.n5_point_reject where verdict_snapshot_id <> '{S2}';") == 0)


# =============================================================================
group("SWEEP FAILURE")
# =============================================================================

# 37 / 38 / 39 - a partial sweep leaves the snapshot non-consumable, and a clean rerun converges.
fresh_s1(sync=True)
r37, m37 = sweep_with(mid_failure=True)
check(37, "partial sweep failure leaves canonical_synced_at NULL",
      r37 and "INJECTED SWEEP FAILURE" in m37 and synced_at() is None, m37[:120])
r38, m38 = raises(n5_shard.assert_snapshot_consumable)
check(38, "a partially swept snapshot cannot be consumed",
      r38 and "canonical" in m38, m38[:120])
n5_shard.sync_canonical()
g39 = n5_shard.verify_canonical_geometry_sets()
r39 = n5_shard.verify_canonical_reject_sets()
check(39, "re-running after failure converges correctly",
      synced_at() is not None and all(int(g39[k]) == 0 for k in g39)
      and all(int(r39[k]) == 0 for k in r39)
      and not raises(n5_shard.assert_snapshot_consumable)[0], {"geom": g39, "rej": r39})

CORRUPTIONS = [
    (40, "canonical_synced_at is NOT published if geometry equality fails", "geometry",
     "update geo.n5_geom set geom=ST_SetSRID(ST_MakePoint(0,0),4269) "
     "where source_key='a-elig' and feature_id='pt:1';"),
    (41, "canonical_synced_at is NOT published if reject equality fails", "reject",
     "update geo.n5_point_reject set reason='NULL_COORD' "
     "where reason='MULTI_COORD_UNRESOLVED';"),
    (44, "coordinate mismatch blocks publication", "coord_mismatch",
     "update geo.n5_geom set geom=ST_SetSRID(ST_MakePoint(-1,1),4269) "
     "where source_key='a-elig' and feature_id='pt:1';"),
    (45, "wrong feature_id blocks publication", "wrong_feature_id",
     "alter table geo.n5_geom drop constraint n5_geom_pt_namespace_ck; "
     "update geo.n5_geom set feature_id='pt:9' "
     "where source_key='a-elig' and feature_id='pt:1';"),
    (46, "wrong provenance blocks publication", "wrong_provenance",
     "alter table geo.n5_geom drop constraint n5_geom_pt_namespace_ck; "
     "alter table geo.n5_geom drop constraint n5_geom_verdict_snapshot_ck; "
     "update geo.n5_geom set provenance='recovered_authoritative' "
     "where source_key='a-elig' and feature_id='pt:1';"),
    (47, "wrong verdict_snapshot_id blocks publication", "geometry.wrong_snapshot",
     "update geo.n5_geom set verdict_snapshot_id='WRONG-SNAP' where feature_id='pt:1';"),
    (50, "reason mismatch blocks publication", "reason_mismatch",
     "update geo.n5_point_reject set reason='NULL_COORD' "
     "where reason='MULTI_COORD_UNRESOLVED';"),
    (51, "wrong reject snapshot blocks publication", "reject.wrong_snapshot",
     "update geo.n5_point_reject set verdict_snapshot_id='WRONG-SNAP';"),
    (52, "an ELIGIBLE source_key carrying a stale reject blocks publication",
     "eligible_still_rejected",
     "insert into geo.n5_point_reject (source_key,reason,verdict_snapshot_id) "
     "values ('a-elig','NULL_COORD','snap-S1');"),
]
for num, name, marker, corruption in CORRUPTIONS:
    grp = "GEOMETRY EQUALITY" if num in (40, 44, 45, 46, 47) else (
        "REJECT EQUALITY" if num in (41, 50, 51, 52) else "SWEEP FAILURE")
    fresh_s1(sync=False)
    raised, msg = sweep_with(extra_sql=corruption)
    group(grp)
    check(num, name,
          raised and "HALT: canonical sets do not match" in msg and marker in msg
          and synced_at() is None,
          {"raised": raised, "synced": synced_at(), "msg": msg[:200]})

# =============================================================================
group("RECOVERY CACHE")
# =============================================================================
fresh_s1(sync=True)
probe = ("select distinct source_key from geo.n5_geom "
         "where provenance='recovered_authoritative' and source_key in ('{k}');")
check(58, "an existing proven_stored_point cannot satisfy the RECOVERY cache lookup",
      q1("select count(*) from geo.n5_geom where source_key='a-elig' "
         "and feature_id='pt:1';") == 1
      and len(q(probe.format(k="a-elig"))) == 0)
check(59, "recovered_authoritative geometry CAN satisfy the RECOVERY cache lookup",
      len(q(probe.format(k="h-prov2rec"))) == 1)


# =============================================================================
group("ASSOCIATIONS")
# =============================================================================
Z3 = "021"
BOUNDARIES = """
insert into geo.n5_zcta (z3, zcta5, geom) values
 ('021','02138', ST_Multi(ST_SetSRID(ST_MakeEnvelope(-71.5,41.5,-70.5,42.5),4269))),
 ('021','02139', ST_Multi(ST_SetSRID(ST_MakeEnvelope(-72.5,42.6,-71.6,43.5),4269)))
on conflict do nothing;"""
FROZEN = """
insert into geo.n5_frozen (z3,source_key,zip,source_seq,registry_id,treatment,lat,lng,source_key_basis)
values ('021','a-elig','02138',1,'r-proven','PROVEN',42.0,-71.0,'source_id:case_number'),
       ('021','b-move','02139',1,'r-proven','PROVEN',43.0,-72.0,'source_id:case_number'),
       ('021','n-noauth','02138',1,'r-proven','NOAUTH',null,null,'source_id:case_number');"""


def assoc_rows():
    return [(r["source_key"], r["zip"].strip(), int(r["evidence"])) for r in q(
        "select source_key, zip, evidence from geo.n5_association order by source_key, zip;")]


def assoc_setup(prior_sql=""):
    fresh_s1(sync=True)
    apply_script(BOUNDARIES, is_path=False)
    apply_script(FROZEN, is_path=False)
    apply_script("delete from geo.n5_association;" + prior_sql, is_path=False)


EXPECTED = [("a-elig", "02138", 1), ("b-move", "02139", 1), ("n-noauth", "02138", 2)]

# 60.1 / 62.1 - the two helpers a shard run depends on must RETURN their counters.
#   These are direct calls, not collateral: run_shard() indexes the result of each.
fresh_s1(sync=True)
try:
    mp = n5_shard.materialize_proven_points(Z3)
    mp_err = ""
except BaseException as e:
    mp, mp_err = None, f"{type(e).__name__}: {e!r}"
check(27.1, "materialize_proven_points() returns its materialized/rejected counters",
      isinstance(mp, dict) and "materialized" in mp and "rejected" in mp,
      mp_err or mp)

apply_script(BOUNDARIES, is_path=False)
apply_script(FROZEN, is_path=False)
apply_script("delete from geo.n5_association;", is_path=False)
try:
    n5_shard.stage_associations(Z3)
    rs = n5_shard.reconcile_stage(Z3)
    rs_err = ""
except BaseException as e:
    rs, rs_err = None, f"{type(e).__name__}: {e!r}"
check(62.1, "reconcile_stage() returns its staged/prior counters",
      isinstance(rs, dict) and "staged" in rs and "prior" in rs, rs_err or rs)

# 65 - a direct associate() call refuses an unconsumable snapshot.
assoc_setup()
apply_script(f"update geo.n5_verdict_manifest set canonical_synced_at=null "
             f"where snapshot_id='{S1}';", is_path=False)
r65, m65 = raises(n5_shard.associate, Z3)
check(65, "a direct associate() call refuses an unconsumable snapshot",
      r65 and "canonical" in m65
      and q1("select count(*) from geo.n5_association_stage;") == 0, m65[:130])

# 62 - reconciliation divergence halts BEFORE the swap.
PRIOR = ("insert into geo.n5_association (source_key,zip,evidence) values "
         "('a-elig','02138',2),('zz-old','02138',4);")
assoc_setup(PRIOR)
n5_shard.ALLOW_ASSOCIATION_DELTA = False
before62 = assoc_rows()
r62, m62 = raises(n5_shard.associate, Z3)
check(62, "reconciliation divergence halts before the swap, production untouched",
      r62 and "rebuild changes associations" in m62 and assoc_rows() == before62,
      {"msg": m62[:130], "rows": assoc_rows()})

# 61 - a staging failure leaves the production association fixture unchanged.
assoc_setup(PRIOR)
before61 = assoc_rows()
_real_build = n5_shard.build_associations
n5_shard.build_associations = lambda z: _real_build(z).replace(
    "where not exists (select 1 from legacy l", "where true or not exists (select 1 from legacy l")
r61, m61 = raises(n5_shard.associate, Z3)
n5_shard.build_associations = _real_build
check(61, "staging failure leaves the production association fixture unchanged",
      r61 and assoc_rows() == before61
      and q1(f"select count(*) from geo.n5_association_stage where z3='{Z3}';") == 0,
      {"msg": m61[:130], "rows": assoc_rows()})

# 60 / 64 - evidence replacement 2 -> 1 under (source_key, zip), and an atomic swap.
assoc_setup(PRIOR)
n5_shard.ALLOW_ASSOCIATION_DELTA = True
r60, m60 = raises(n5_shard.associate, Z3)          # guarded: a defect must not abort the suite
rows60 = assoc_rows()
dup_ok, dup_err = exec_raw("insert into geo.n5_association (source_key,zip,evidence) "
                           "values ('a-elig','02138',2);")
check(60, "evidence replacement 2 -> 1 works under (source_key, zip) identity",
      (not r60) and ("a-elig", "02138", 1) in rows60
      and len([r for r in rows60 if r[0] == "a-elig" and r[1] == "02138"]) == 1
      and not dup_ok, {"rows": rows60, "dup_accepted": dup_ok})
check(64, "a successful swap is atomic: production equals the staged set, stage is cleared",
      (not r60) and sorted(rows60) == sorted(EXPECTED)
      and q1(f"select count(*) from geo.n5_association_stage where z3='{Z3}';") == 0, rows60)

# 63 - an injected swap failure rolls the whole swap back.
assoc_setup(PRIOR)
before63 = assoc_rows()
n5_shard.stage_associations(Z3)
staged63 = q1(f"select count(*) from geo.n5_association_stage where z3='{Z3}';")
apply_script("alter table geo.n5_association add constraint tmp_block "
             "check (source_key <> 'b-move') not valid;", is_path=False)
r63, m63 = raises(n5_shard.swap_shard, Z3)
after63 = assoc_rows()
stage_after = q1(f"select count(*) from geo.n5_association_stage where z3='{Z3}';")
apply_script("alter table geo.n5_association drop constraint tmp_block;", is_path=False)
check(63, "an injected swap failure rolls the swap back: prior rows and stage both survive",
      r63 and after63 == before63 and stage_after == staged63,
      {"raised": r63, "before": before63, "after": after63})

# 66 - a successful shard completion records the exact verdict_snapshot_id in detail.
assoc_setup()
apply_script(f"""delete from geo.n5_frozen where z3='{Z3}';
insert into geo.n5_frozen (z3,source_key,zip,source_seq,registry_id,treatment,lat,lng,source_key_basis)
select '{Z3}', i.source_key, i.zip, i.source_seq, coalesce(i.registry_id,'(null)'), a.treatment,
       i.lat, i.lng, null
  from preservation.app_project_identity i
  join geo.n5_accepted_source a on a.registry_id = coalesce(i.registry_id,'(null)')
 where i.snapshot_id='{S1}' and i.record_kind='development' and left(i.zip,3)='{Z3}';""",
             is_path=False)
man66 = q(f"""select count(distinct source_key) projects,
                     count(distinct source_key||'|'||zip) pairs, count(distinct zip) zips,
                     sum(('x'||substr(md5(source_key||'|'||zip||'|'||
                          coalesce(source_seq::text,'')),1,8))::bit(32)::bigint) ck
                from geo.n5_frozen where z3='{Z3}';""")[0]
apply_script(f"""insert into geo.n5_shard (snapshot_id,z3,projects,pairs,zips,checksum,state)
   values ('{S1}','{Z3}',{man66['projects']},{man66['pairs']},{man66['zips']},
           {man66['ck']},'pending')
   on conflict (snapshot_id,z3) do update set projects=excluded.projects,
      pairs=excluded.pairs, zips=excluded.zips, checksum=excluded.checksum, state='pending';""",
             is_path=False)
nb66 = q1(f"select count(*) from geo.n5_zcta where z3='{Z3}';")
# ONLY the two NETWORK-BOUND steps are stubbed - TIGER boundary download and publisher
# recovery. Every SQL statement in run_shard still executes for real.
n5_shard.load_boundaries = lambda z3, zips: (nb66, [], nb66, 0, 40)
n5_shard.recover_shard = lambda z3, registry: []
n5_shard.load_registry = lambda: {}
apply_script("delete from geo.n5_association;", is_path=False)
r66, m66 = raises(n5_shard.run_shard, Z3)
shard_ok = (not r66) and q1(f"select state from geo.n5_shard where snapshot_id='{S1}' "
                            f"and z3='{Z3}';") == 'done'
srow = q(f"select state, detail from geo.n5_shard where snapshot_id='{S1}' and z3='{Z3}';")[0]
check(66, "successful shard completion records the exact verdict_snapshot_id in detail",
      shard_ok and srow["state"] == "done"
      and srow["detail"].get("verdict_snapshot_id") == S1
      and srow["detail"].get("verified") is True,
      {"state": srow["state"], "vsid": (srow["detail"] or {}).get("verdict_snapshot_id"),
       "raised": m66[:150]})


# =============================================================================
group("PRODUCTION PRE-STATE")
# =============================================================================
# The migration is now exercised against a production-FAITHFUL legacy pre-state: provenance
# already present, 3 legacy proven pt:1 points, 1 recovered row, the old reject table shape
# with 2 legacy rows carrying detail.{snapshot,distinct_coords}, association PK already
# (source_key, zip). Receipts for the real corpus: docs/n5-applied-state-of-record.md.

SNAP = "phase1-2026-09-01"

def reject_cols():
    return {r["column_name"] for r in q("""select column_name from information_schema.columns
        where table_schema='geo' and table_name='n5_point_reject';""")}

def con_def(name):
    return q1(f"select pg_get_constraintdef(oid) from pg_constraint where conname='{name}';")

reset(apply_migration=False, legacy=True)
pre_ok = (q1("select count(*) from geo.n5_geom where provenance='proven_stored_point';") == 3
          and q1("select count(*) from geo.n5_point_reject;") == 2
          and con_def('n5_point_reject_pkey') == 'PRIMARY KEY (source_key, reason)')
ok74, err74 = apply_script(MIGRATION)
check(74, "migration SUCCEEDS against a production-faithful legacy pre-state",
      pre_ok and ok74, {"pre_state_ok": pre_ok, "err": err74[:200]})

att = q("""select source_key, verdict_snapshot_id v, provenance p
             from geo.n5_geom order by source_key;""")
check(75, "all legacy proven points are attributed to the snapshot recorded in the data",
      all(r["v"] == SNAP for r in att if r["p"] == "proven_stored_point")
      and len([r for r in att if r["p"] == "proven_stored_point"]) == 3, att)
check(76, "recovered geometry is preserved and keeps verdict_snapshot_id NULL",
      [r["v"] for r in att if r["p"] == "recovered_authoritative"] == [None], att)
check(77, "the biconditional and pt: namespace constraints now exist",
      con_def('n5_geom_verdict_snapshot_ck') is not None
      and con_def('n5_geom_pt_namespace_ck') is not None)
check(78, "reject PK becomes (source_key)",
      con_def('n5_point_reject_pkey') == 'PRIMARY KEY (source_key)',
      con_def('n5_point_reject_pkey'))
check(79, "reject target columns exist and detail is retained",
      {'lat','lng','observed_in_z3','verdict_snapshot_id','detail'} <= reject_cols(),
      sorted(reject_cols()))

arch = q("""select source_key, reason, detail, rejected_at::text ts, archived_snapshot_id asn
              from geo.n5_point_reject_archive order by source_key;""")
check(80, "every legacy reject row is archived with detail and rejected_at preserved",
      len(arch) == 2
      and all(r["detail"] and r["detail"].get("snapshot") == SNAP for r in arch)
      and all(r["ts"].startswith("2026-09-02 23:50:51") for r in arch)
      and all(r["asn"] == SNAP for r in arch), arch)

cur = {r["source_key"]: r for r in q("""select source_key, reason, verdict_snapshot_id v
                                          from geo.n5_point_reject;""")}
check(81, "current-state rejects equal the expected ineligible set with matching reasons",
      set(cur) == {"L-multi", "L-null"}
      and cur["L-multi"]["reason"] == "MULTI_COORD_UNRESOLVED"
      and cur["L-null"]["reason"] == "NULL_COORD", cur)
check(82, "current-state rejects carry the verdict snapshot attribution",
      all(r["v"] == SNAP for r in cur.values())
      and q1("""select attnotnull from pg_attribute
                 where attrelid='geo.n5_point_reject'::regclass
                   and attname='verdict_snapshot_id';""") is True, cur)
check(83, "no ELIGIBLE source_key carries a current reject",
      q1("""select count(*) from geo.n5_point_reject r join geo.n5_geom g
              on g.source_key=r.source_key where g.provenance='proven_stored_point';""") == 0)

# 84 / 85 - rerunning the migration against the corrected post-state is a clean no-op.
ok84, err84 = apply_script(MIGRATION)
check(84, "rerun against the corrected post-state is a safe no-op (state B)", ok84, err84[:200])
check(85, "the archive rerun does not duplicate legacy rows",
      q1("select count(*) from geo.n5_point_reject_archive;") == 2
      and q1("select count(*) from geo.n5_point_reject;") == 2)

# =============================================================================
group("PRE-STATE NEGATIVE CONTROLS")
# =============================================================================
# Each corrupts ONE invariant of an otherwise production-faithful legacy state, and the
# migration must FAIL and roll back rather than silently normalising it.

PRESTATE_CORRUPTIONS = [
    (86, "an extra canonical PROVEN source_key blocks attribution",
     "insert into geo.n5_geom (source_key,registry_id,feature_id,outcome,geom,provenance) "
     "values ('L-ghost','r-proven','pt:1',1,"
     "ST_SetSRID(ST_MakePoint(-70.0,41.0),4269),'proven_stored_point');"),
    (87, "a missing canonical eligible source_key blocks attribution",
     "delete from geo.n5_geom where source_key='L-elig-2';"),
    (88, "a coordinate mismatch blocks attribution",
     "update geo.n5_geom set geom=ST_SetSRID(ST_MakePoint(0.5,0.5),4269) "
     "where source_key='L-elig-1';"),
    (89, "a wrong feature_id blocks attribution",
     "update geo.n5_geom set feature_id='pt:9' where source_key='L-elig-1';"),
    (90, "a duplicate PROVEN geometry for one source_key blocks attribution",
     "insert into geo.n5_geom (source_key,registry_id,feature_id,outcome,geom,provenance) "
     "values ('L-elig-1','r-proven','pt:7',1,"
     "ST_SetSRID(ST_MakePoint(-71.0,42.0),4269),'proven_stored_point');"),
    (91, "recovered geometry squatting the pt: namespace blocks attribution",
     "update geo.n5_geom set feature_id='pt:1' where source_key='L-rec';"),
    (92, "a reject-partition mismatch blocks attribution",
     "delete from geo.n5_point_reject where source_key='L-null';"),
    (93, "a snapshot-attribution mismatch blocks attribution",
     """update geo.n5_point_reject set detail=jsonb_set(detail,'{snapshot}','"other-snap"')
          where source_key='L-null';"""),
    (94, "a reject reason disagreeing with the current rules blocks attribution",
     "update geo.n5_point_reject set reason='NULL_ISLAND' where source_key='L-multi';"),
]
for num, name, corruption in PRESTATE_CORRUPTIONS:
    reset(apply_migration=False, legacy=True)
    cok, cerr = apply_script(corruption, is_path=False)
    okm, errm = apply_script(MIGRATION)
    rolled_back = q1("""select not exists (select 1 from information_schema.columns
        where table_schema='geo' and table_name='n5_geom'
          and column_name='verdict_snapshot_id');""")
    check(num, name, cok and (not okm) and rolled_back,
          {"corruption_applied": cok or cerr[:80], "migration_ok": okm,
           "rolled_back": rolled_back, "err": errm[:160]})

# 95 - the destructive reject step is UNREACHABLE unless the archive is provably complete.
#      Poisoned in STATE A, before the first migration: pre-create the archive holding a row
#      whose PK collides with the live legacy row but whose detail differs, so `on conflict do
#      nothing` cannot copy the real detail and the gate must refuse.
reset(apply_migration=False, legacy=True)
apply_script("""
create table geo.n5_point_reject_archive (
  source_key text not null, registry_id text, reason text not null, detail jsonb,
  rejected_at timestamptz not null, archived_snapshot_id text,
  archived_at timestamptz not null default now(), archived_by text not null,
  constraint n5_point_reject_archive_pkey primary key (source_key, reason, rejected_at));
insert into geo.n5_point_reject_archive
  (source_key,registry_id,reason,detail,rejected_at,archived_snapshot_id,archived_by)
values ('L-multi','r-proven','MULTI_COORD_UNRESOLVED',
        '{"snapshot":"phase1-2026-09-01","distinct_coords":99}'::jsonb,
        '2026-09-02 23:50:51.752805+00','phase1-2026-09-01','poisoned');""", is_path=False)
live_before = q1("select count(*) from geo.n5_point_reject;")
ok95, err95 = apply_script(MIGRATION)
check(95, "the destructive reject rebuild is unreachable when the archive is not provably complete",
      (not ok95) and "archive is NOT provably complete" in err95
      and q1("select count(*) from geo.n5_point_reject;") == live_before
      and q1("""select pg_get_constraintdef(oid) from pg_constraint
                 where conrelid='geo.n5_point_reject'::regclass and contype='p';""")
          == 'PRIMARY KEY (source_key, reason)',
      {"migration_ok": ok95, "live_rows": q1("select count(*) from geo.n5_point_reject;"),
       "err": err95[:200]})

# 96 - a genuinely unrecognised / partially migrated pre-state fails at classification.
reset(apply_migration=False, legacy=True)
apply_script("alter table geo.n5_geom add column verdict_snapshot_id text;", is_path=False)
ok96, err96 = apply_script(MIGRATION)
check(96, "a partially migrated pre-state fails loudly at classification rather than guessing",
      (not ok96) and "PARTIALLY MIGRATED OR UNRECOGNISED PRE-STATE" in err96, err96[:180])


# =============================================================================
# SUMMARY
# =============================================================================
print("")
print("=" * 78)
groups = {}
for g, num, name, ok, _d in RESULTS:
    p, f = groups.get(g, (0, 0))
    groups[g] = (p + (1 if ok else 0), f + (0 if ok else 1))
for g in ("MIGRATION", "GLOBAL VERDICT", "PUBLICATION", "SWEEP", "SWEEP FAILURE",
          "GEOMETRY EQUALITY", "REJECT EQUALITY", "RECOVERY CACHE", "ASSOCIATIONS",
          "PRODUCTION PRE-STATE", "PRE-STATE NEGATIVE CONTROLS"):
    if g in groups:
        p, f = groups[g]
        print(f"{g:<22} PASS {p:>3}   FAIL {f:>3}")
tp = sum(v[0] for v in groups.values())
tf = sum(v[1] for v in groups.values())
print("-" * 78)
print(f"{'TOTAL EXECUTABLE DB':<22} PASS {tp:>3}   FAIL {tf:>3}   ({tp + tf} assertions)")
if tf:
    print("")
    print("FAILURES:")
    for g, num, name, ok, d in RESULTS:
        if not ok:
            print(f"  [{g}] {num}. {name}\n      {d}")
print("=" * 78)
sys.exit(1 if tf else 0)

#!/usr/bin/env python3
"""EXECUTABLE proof for docs/map1-representative-pick.sql: each Map 1 pin, each ZIP-page project
and each Rule D project is described by its source_key's NEWEST record, decided once a day and
stored, so no reader reads a project's copies.

The first version (docs/map1-representative-newest.sql) decided at read time and read every
per-ZIP copy; production has keys with 1,700+ copies, and Map 1 slowed to 20.8 s. Its proof's
fixture had a handful of copies per key, so it could not see that. This proof builds the same
production pre-state (run_map1_representative.build: both readers fingerprint-equal to
production) and adds keys with 1,700 copies:
  dev:H1  1,700 copies of ONE record, same date, written at different times
          (the lowest-id row already shows it: no stored pick, nothing changes)
  dev:H2  two DIFFERENT records with the same date, 800 copies each; the lowest id belongs to
          the record written longer ago (the other record must show)
  dev:H3  one record whose 1,000 copies still state an old status and 3 copies the new one,
          written later; the lowest id is an old-status copy (the new status must show)
plus run_map1_representative's seeds (an older record, a stale copy, an undated row, a key
whose newest row IS its lowest id, and a member with no row). A Python oracle, independent of
the SQL, states which row each key should show.

  C0  CONTROL: before the change every reader shows the LOWEST-ID row, and the oracle differs
      on at least 6 pins, so the seed exercises the change.
  R0  refusals, each leaving everything unchanged: PART B before any refresh; a drifted reader;
      an existing lookup with another body
  R1  PART A, A2, B apply; refresh, lookup and both readers fingerprint to the recorded state;
      the refresh stored exactly the keys whose newest record is not their lowest-id row
  R2  readers keep owner, grants, SECURITY DEFINER, STABLE and every SET clause; the lookup is
      an inlinable STABLE sql set-returning function; neither table nor the refresh nor the
      lookup is readable/executable by public, anon or authenticated; both tables have RLS on
  R3  every reader shows the oracle's row on every member; everything else is byte-identical
  R4  COST: per pin, the readers read at most a few index entries and rows of app_projects,
      never the copies; and no more than before the change, plus one index entry and one row per
      pin whose key has a stored pick. POSITIVE CONTROL: the same measure on the rolled-back
      read-time rule reads more than the 1,700 copies of dev:H1, so the instrument sees the slowdown.
  R5  the plans inside both readers call no function (the lookup was inlined) and read
      app_project_pick by its primary key
  R6  freshness: a newer record arriving shows after the next refresh, not before; a picked row
      that is removed falls back to the lowest-id row and the pin stays; refreshing again with
      no change writes nothing
  R7  applying PART B again does nothing; the rollback restores both readers byte for byte and
      the answers become the lowest-id rows again; applying again lands R1's state
  R8  PART C refuses where pg_cron is missing (this database), naming it

Then MUTATION: in a fresh database per mutation, the file is broken one way, its own
fingerprints are recomputed so only behaviour can catch it, and the suite must go red.

THE INGEST HALF (INGEST_ROOT set): homesignal-ingest's *_app_development_projects_for_zips_pick.sql
  I0  CONTROL: its previous DDL of record (20260928160000) shows the LOWEST-ID row
  I1  refused while the lookup is missing; refused while the lookup is the rolled-back body
  I2  after PARTS A-B it applies; body md5 376d7ee4...; only service_role and the owner run it
  I3  it shows the oracle's row on every member; everything else is identical
  I4  COST: per member it reads at most a few app_projects index entries and rows
  I5  re-applying 20260928160000 restores the previous body and answers
plus one mutation (the reader keeps its own lowest-id pick).
homesignal-ingest's check-map1-representative-pg.yml runs this with REQUIRE_INGEST=1.

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
import run_map1_representative as rep  # noqa: E402  (production pre-state build + shared readers)

DOC = os.path.join(rs.ROOT, "docs", "map1-representative-pick.sql")
ROLLBACK_DOC = os.path.join(rs.ROOT, "docs", "map1-representative-pick.rollback.sql")
MK, AZ, REP = rep.MK, rep.AZ, rep.REP
REFRESH = "public.app_project_pick_refresh(integer,integer)"
MK_PRE, AZ_PRE = rep.MK_PRE, rep.AZ_PRE
MK_POST, AZ_POST = "371f1fcfdfaf412b7de1a8a0bd7618ae", "dc2304ec115550df9946e98085ae7116"
REP_MD5, REP_OLD_MD5 = "2c01f73a567d0dde746481cb4e780510", "28f6fefb57b2d7fbd64e630caf272fcf"
REFRESH_MD5 = "e36b0263e217ab8a36fcb357c4fe027e"
ATTRS = rep.ATTRS
q, q1 = rs.q, rs.q1
MEMBER_ZIPS = rep.MEMBER_ZIPS
FACTS = ("name", "type", "type_raw", "status", "stage", "submitted_at", "date_kind", "source_ref",
         "registry_id", "address", "source_key_basis", "developer", "start_date", "end_date", "scope_text")
HEAVY_COPIES = 1700

# Heavy keys. ids are md5-derived (random-looking) except the few that must be the lowest.
HEAVY = f"""
insert into public.app_projects (id, source_key, record_kind, zip, name, type, status, stage, submitted_at,
                                 date_kind, source_ref, registry_id, address, developer, scope_text,
                                 source_seq, lat, lng, last_seen_at)
select md5('h1-' || c)::uuid, 'dev:H1', 'development', lpad((10000 + c)::text, 5, '0'), 'Highway 1 widening',
       'type', 'approved', 'stage', date '2026-01-01', 'issued', 'https://example.test/h1', 'reg-ok',
       'Hwy 1', 'dev', 'scope', 1, null::float8, null::float8, timestamptz '2026-09-01 00:00Z' + (c || ' minutes')::interval
  from generate_series(1, {HEAVY_COPIES}) c;
insert into public.app_projects (id, source_key, record_kind, zip, name, type, status, stage, submitted_at,
                                 date_kind, source_ref, registry_id, address, developer, scope_text,
                                 source_seq, lat, lng, last_seen_at)
select case when c = 1 then '00000000-0000-0000-0000-0000000000a0'::uuid else md5('h2a-' || c)::uuid end,
       'dev:H2', 'development', lpad((20000 + c)::text, 5, '0'), 'Job 2 FO permit',
       'type', 'issued', 'stage', date '2026-02-02', 'issued', 'https://example.test/h2-fo', 'reg-ok',
       '2 Job St', 'dev', 'scope', 1, null::float8, null::float8, timestamptz '2026-09-01 00:00Z'
  from generate_series(1, 800) c
union all
select md5('h2b-' || c)::uuid, 'dev:H2', 'development', lpad((30000 + c)::text, 5, '0'), 'Job 2 NB permit',
       'type', 'issued', 'stage', date '2026-02-02', 'issued', 'https://example.test/h2-nb', 'reg-ok',
       '2 Job St', 'dev', 'scope', 2, null::float8, null::float8, timestamptz '2026-09-20 00:00Z'
  from generate_series(1, 800) c;
insert into public.app_projects (id, source_key, record_kind, zip, name, type, status, stage, submitted_at,
                                 date_kind, source_ref, registry_id, address, developer, scope_text,
                                 source_seq, lat, lng, last_seen_at)
select case when c = 1 then '00000000-0000-0000-0000-0000000000b0'::uuid else md5('h3-' || c)::uuid end,
       'dev:H3', 'development', lpad((40000 + c)::text, 5, '0'), 'Plaza 3',
       'type', case when c <= 1000 then 'filed' else 'approved' end, 'stage', date '2026-03-03', 'filed',
       'https://example.test/h3', 'reg-ok', '3 Plaza', 'dev', 'scope', 1, null::float8, null::float8,
       case when c <= 1000 then timestamptz '2026-08-01 00:00Z' else timestamptz '2026-09-30 00:00Z' end
  from generate_series(1, 1003) c;
set session_replication_role = replica;
insert into geo.zip_authoritative_membership (zcta5, source_key, lat, lng, point_rule, clip_dim, feature_count,
                                              geom_family, run_id, generation_id)
  select z, k, la, lo, 'POINT_MIN_XY', 0, 1, 'ST_Point', 'legacy', g.generation_id
    from (values ('11102','dev:H1',0.7::float8,0.7::float8), ('11102','dev:H2',0.8,0.8), ('11101','dev:H3',0.9,0.9)) v(z, k, la, lo),
         geo.n5_generation g where g.state in ('ACTIVE', 'ACTIVE_LEGACY');
insert into geo.zip_authoritative_marker (zcta5, source_key, marker_seq, lat, lng, marker_rule, family, dim,
                                          run_id, generation_id)
  select z, k, 1, la, lo, 'POINT_AUTHORITATIVE', 'ST_Point', 0, 'legacy', g.generation_id
    from (values ('11102','dev:H1',0.7::float8,0.7::float8), ('11102','dev:H2',0.8,0.8), ('11101','dev:H3',0.9,0.9)) v(z, k, la, lo),
         geo.n5_generation g where g.state in ('ACTIVE', 'ACTIVE_LEGACY');
update geo.maps_zip_geography_status s
   set membership_rows = s.membership_rows + case when s.zip = '11102' then 2 else 1 end
  from geo.n5_generation g
 where s.zip in ('11101', '11102') and s.generation_id = g.generation_id and g.state in ('ACTIVE', 'ACTIVE_LEGACY');
reset session_replication_role;
-- Production's indexes on app_projects (read 2026-10-02, db-sql run 37033203044). The fixture
-- carries only the primary key, and a cost check on a plan production would never run proves
-- nothing. app_projects_skey_kind_date_idx is the rolled-back version's index, still present.
create index if not exists app_projects_skey_kind_date_idx on public.app_projects using btree (source_key, record_kind, submitted_at desc nulls last);
create index if not exists app_projects_skey_kind_id_idx on public.app_projects using btree (source_key, record_kind, id);
create index if not exists app_projects_source_key_kind_idx on public.app_projects using btree (source_key, record_kind);
create index if not exists app_projects_zip_idx on public.app_projects using btree (zip);
create index if not exists app_projects_zip_kind_date_idx on public.app_projects using btree (zip, record_kind, submitted_at desc nulls last, id);
create unique index if not exists app_projects_zip_source_key_uidx on public.app_projects using btree (zip, source_key, source_seq);
"""

# The rolled-back read-time rule (docs/map1-representative-newest.sql), used as the cost
# positive control and as a mutation.
LOWEST_ID_BODY = """
  select p.*
    from public.app_projects p
   where p.source_key = p_source_key
     and p.record_kind = p_record_kind
   order by p.id
   limit 1
"""
READ_TIME_BODY = """
  select p.*
    from public.app_projects p
   where p.source_key = p_source_key
     and p.record_kind = p_record_kind
   order by p.submitted_at desc nulls last, p.last_seen_at desc nulls last, p.id
   limit 1
"""


def parts(text=None):
    text = text if text is not None else open(DOC).read()
    a = text.index("-- ========================== PART A:")
    a2 = text.index("-- ========================== PART A2:")
    b = text.index("-- ========================== PART B:")
    c = text.index("-- ========================== PART C:")
    return text[a:a2], text[a2:b], text[b:c], text[c:]


def rollback_parts():
    text = open(ROLLBACK_DOC).read()
    b = text.index("-- ========================== PART B'")
    c = text.index("-- ========================== PART C'")
    return text[b:c], text[c:]


def build(conn):
    rep.build(conn)
    q(conn, HEAVY)
    q(conn, "vacuum analyze public.app_projects")  # index-only scans, as on production's table


def md5_of(conn, fn):
    return rep.md5_of(conn, fn)


def apply(conn, text=None):
    a, a2, b, _c = parts(text)
    q(conn, a)
    q(conn, a2)
    q(conn, b)


def refusal(conn, sql):
    return rep.refusal(conn, sql)


def rows_by_key(conn):
    keys = [r["source_key"] for r in q(conn, """
        select distinct source_key from geo.n5_serving_membership where record_kind = 'development'""")]
    rows = q(conn, f"""select id::text as id, source_key, last_seen_at, {", ".join(FACTS)}
                         from public.app_projects
                        where record_kind = 'development' and source_key = any(%s)""", (keys,))
    out = {k: [] for k in keys}
    for r in rows:
        out[r["source_key"]].append(r)
    return out


def picked(rows):
    """THE ORACLE, independent of the SQL. 1. rows with the latest submitted_at (undated last);
    2. group them by the facts they state, take the group written most recently (max
    last_seen_at, unwritten last; ties: the group holding the lower id); 3. the lowest id in
    that group. uuid order = lowercase hex string order."""
    if not rows:
        return None
    dates = [r["submitted_at"] for r in rows]
    top_date = max((d for d in dates if d is not None), default=None)
    top = [r for r in rows if r["submitted_at"] == top_date]
    groups = {}
    for r in top:
        groups.setdefault(tuple(str(r[f]) for f in FACTS), []).append(r)

    def written(g):
        w = [r["last_seen_at"] for r in g if r["last_seen_at"] is not None]
        return max(w) if w else None

    def gkey(g):
        w = written(g)
        return (w is None, -w.timestamp() if w else 0, min(r["id"] for r in g))
    best = sorted(groups.values(), key=gkey)[0]
    return min(best, key=lambda r: r["id"])


def lowest(rows):
    return min(rows, key=lambda r: r["id"]) if rows else None


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


def shown(conn):
    return rep.shown(conn)


def expected_overrides(conn):
    """{(source_key, record_kind): id} for every key (any kind) whose oracle row is not its
    lowest-id row: exactly what the refresh must store."""
    rows = q(conn, f"""select id::text as id, source_key, record_kind, last_seen_at, {", ".join(FACTS)}
                         from public.app_projects where source_key is not null""")
    by = {}
    for r in rows:
        by.setdefault((r["source_key"], r["record_kind"]), []).append(r)
    out = {}
    for k, rs_ in by.items():
        if len(rs_) > 1:
            p, lo = picked(rs_), lowest(rs_)
            if p["id"] != lo["id"]:
                out[k] = p["id"]
    return out


def stored(conn):
    return {(r["source_key"], r["record_kind"]): r["project_id"] for r in q(conn, """
        select source_key, record_kind, project_id::text as project_id from public.app_project_pick""")}


def reads(conn, sql, args=(), setup=None):
    """(index entries read, heap rows fetched) on public.app_projects while one reader call runs,
    from this transaction's own statistics, which count work inside functions too. `setup` runs
    first inside the same transaction (and is rolled back with it)."""
    with conn.cursor() as cur:
        cur.execute("begin")
        if setup:
            cur.execute(setup)
        cur.execute("""select coalesce(sum(pg_stat_get_xact_tuples_returned(i.indexrelid)), 0) from pg_index i
                        where i.indrelid = 'public.app_projects'::regclass""")
        i0 = cur.fetchone()[0]
        cur.execute("""select coalesce(idx_tup_fetch, 0) + coalesce(seq_tup_read, 0) from pg_stat_xact_user_tables
                        where relid = 'public.app_projects'::regclass""")
        t0 = cur.fetchone()[0]
        cur.execute(sql, args)
        cur.fetchall()
        cur.execute("""select coalesce(sum(pg_stat_get_xact_tuples_returned(i.indexrelid)), 0) from pg_index i
                        where i.indrelid = 'public.app_projects'::regclass""")
        i1 = cur.fetchone()[0]
        cur.execute("""select coalesce(idx_tup_fetch, 0) + coalesce(seq_tup_read, 0) from pg_stat_xact_user_tables
                        where relid = 'public.app_projects'::regclass""")
        t1 = cur.fetchone()[0]
        cur.execute("rollback")
    return int(i1 - i0), int(t1 - t0)


def members_of(conn, z):
    return q1(conn, """select count(*) from geo.n5_serving_membership
                        where zcta5 = %s and record_kind = 'development'""", (z,))


# Per pin: the pick-table probe, the ownership check, the lowest-id fallback and the row itself.
PER_PIN_INDEX, PER_PIN_ROWS = 6, 3


def cost(conn):
    """{reader/zip: (index entries, rows, members, within bound)}"""
    out = {}
    for z in MEMBER_ZIPS:
        n = members_of(conn, z)
        for label, sql in (("map", "select public.app_zip_projects_markers(%s,'development',true)"),
                           ("zip_page", "select public.app_authoritative_projects_for_zip(%s)")):
            i, t = reads(conn, sql, (z,))
            out[f"{label}/{z}"] = (i, t, n, i <= PER_PIN_INDEX * n and t <= PER_PIN_ROWS * n)
    return out


def stored_pins(conn, z):
    return q1(conn, """select count(*) from geo.n5_serving_membership mm
                        join public.app_project_pick k on k.source_key = mm.source_key
                                                      and k.record_kind = mm.record_kind
                        where mm.zcta5 = %s and mm.record_kind = 'development'""", (z,))


def beyond_today(conn, before, after):
    """R4c: each reader call reads what it read before the change, plus at most one app_projects
    index entry and one row per pin whose key has a stored pick. {reader/zip: detail} of breaches."""
    bad = {}
    for key, (i1, t1, _n, _ok) in after.items():
        i0, t0 = before[key][0], before[key][1]
        extra = stored_pins(conn, key.split("/")[1])
        if i1 > i0 + extra or t1 > t0 + extra:
            bad[key] = {"before": (i0, t0), "after": (i1, t1), "stored_pins": extra}
    return bad


def plans_ok(conn):
    """(ok, detail): no Function Scan of the lookup in either reader's plan, and the pick table is
    read by its primary key."""
    plans = rep.plans_inside(conn)
    calls, pick_reads = [], 0
    for p in plans:
        stack = [p["Plan"]]
        while stack:
            node = stack.pop()
            stack.extend(node.get("Plans", []))
            if node.get("Node Type") == "Function Scan" and "app_project_representative" in json.dumps(node):
                calls.append(node.get("Function Name"))
            if node.get("Index Name") == "app_project_pick_pkey" or node.get("Relation Name") == "app_project_pick":
                pick_reads += 1
    return len(plans) > 0 and not calls and pick_reads >= 2, {
        "plans": len(plans), "lookup_calls_left": calls, "pick_reads": pick_reads}


def base_state(conn):
    return {"mk": md5_of(conn, MK), "az": md5_of(conn, AZ), "rep": md5_of(conn, REP),
            "refresh": md5_of(conn, REFRESH),
            "pick": q1(conn, "select to_regclass('public.app_project_pick') is not null")}


def privileges(conn):
    return q(conn, """
      select r.rolname,
             has_table_privilege(r.rolname, 'public.app_project_pick', 'select,insert,update,delete') as pick,
             has_table_privilege(r.rolname, 'public.app_project_pick_runs', 'select,insert,update,delete') as runs,
             has_function_privilege(r.rolname, 'public.app_project_pick_refresh(integer,integer)', 'execute') as refresh,
             has_function_privilege(r.rolname, 'public.app_project_representative(text,text)', 'execute') as lookup
        from pg_roles r where r.rolname in ('anon', 'authenticated')
      union all
      select 'public',
             has_table_privilege('public', 'public.app_project_pick', 'select,insert,update,delete'),
             has_table_privilege('public', 'public.app_project_pick_runs', 'select,insert,update,delete'),
             has_function_privilege('public', 'public.app_project_pick_refresh(integer,integer)', 'execute'),
             has_function_privilege('public', 'public.app_project_representative(text,text)', 'execute')""")


def run_base():
    s = rs.Suite(None, "map1-pick")
    db = "map1_pick"
    c = rs.fresh_db(db)
    try:
        build(c)
        s.ok("control: both readers fingerprint to production's pre-state (map 4918783a..., ZIP page f10327fe...)",
             md5_of(c, MK) == MK_PRE and md5_of(c, AZ) == AZ_PRE, (md5_of(c, MK), md5_of(c, AZ)))
        pre_state = base_state(c)
        before = shown(c)
        low, want = oracle(c, lowest), oracle(c, picked)
        differ = sorted({k[2] for k in want if k[0] != "zip_page_id" and low.get(k) != want[k]})
        s.ok("C0 CONTROL: before the change every pin shows the LOWEST-ID row, and the oracle differs on "
             "dev:P1, dev:P2, dev:P5, dev:H2 and dev:H3 (and not on dev:H1, dev:P3)",
             before == low and {"dev:P1", "dev:P2", "dev:P5", "dev:H2", "dev:H3"} <= set(differ)
             and "dev:H1" not in differ and "dev:P3" not in differ, differ)
        masked_before = rep.masked(c)
        attrs_mk, attrs_az = q1(c, ATTRS, (MK,)), q1(c, ATTRS, (AZ,))
        cost_before = cost(c)

        pa, pa2, pb, pc = parts()
        err = refusal(c, pb)
        s.ok("R0a PART B before any refresh is refused, and nothing changed",
             err is not None and "no app_project_pick_refresh() run" in err and base_state(c) == pre_state, err)

        q(c, pa)
        err = refusal(c, pb)
        s.ok("R0b PART B after PART A but before the first refresh is refused",
             err is not None and "no app_project_pick_refresh() run" in err and md5_of(c, MK) == MK_PRE, err)
        res = q1(c, pa2.split("\n", 1)[1])
        with c.cursor() as cur:
            cur.execute("begin")
            cur.execute(f"""do $d$ begin execute replace(pg_get_functiondef('{AZ}'::regprocedure),
                            '  v_out        jsonb;', '  v_out        jsonb; -- drift'); end $d$""")
            err = None
            try:
                cur.execute(pb)
            except psycopg2.Error as e:
                err = str(e).splitlines()[0]
            cur.execute("rollback")
        s.ok("R0c a drifted reader is refused, and nothing changed",
             err is not None and "drifted" in err and md5_of(c, MK) == MK_PRE and md5_of(c, REP) is None, err)
        with c.cursor() as cur:
            cur.execute("begin")
            cur.execute("create function public.app_project_representative(p_source_key text, p_record_kind text) "
                        "returns setof public.app_projects language sql stable as $x$ select p.* from public.app_projects p "
                        "where p.source_key = p_source_key and p.record_kind = p_record_kind order by p.id desc limit 1 $x$")
            err = None
            try:
                cur.execute(pb)
            except psycopg2.Error as e:
                err = str(e).splitlines()[0]
            cur.execute("rollback")
        s.ok("R0d an existing lookup with another body is refused, and nothing changed",
             err is not None and "different body" in err and md5_of(c, MK) == MK_PRE, err)

        overrides_want = expected_overrides(c)
        q(c, pb)
        s.ok("R1a PART A, A2, B apply; refresh e36b0263..., lookup 2c01f73a..., map 371f1fcf..., "
             "ZIP page dc2304ec...",
             base_state(c) == {"mk": MK_POST, "az": AZ_POST, "rep": REP_MD5, "refresh": REFRESH_MD5, "pick": True},
             base_state(c))
        s.ok("R1b the first refresh stored exactly the keys whose newest record is not their lowest-id row "
             "(dev:H1, whose 1,700 copies state one record, stores nothing)",
             stored(c) == overrides_want and ("dev:H1", "development") not in stored(c)
             and res["overrides"] == len(overrides_want) and res["inserted"] == len(overrides_want)
             and q1(c, "select count(*) from public.app_project_pick_runs") == 1,
             {"stored": len(stored(c)), "want": len(overrides_want), "result": res})

        rep_attrs = q(c, """select l.lanname, p.provolatile, p.prosecdef, p.proisstrict, p.proretset, p.proconfig,
                                   p.prorettype::regtype::text as rt
                              from pg_proc p join pg_language l on l.oid = p.prolang
                             where p.oid = to_regprocedure(%s)""", (REP,))[0]
        rls = q1(c, """select bool_and(relrowsecurity) from pg_class
                        where oid in ('public.app_project_pick'::regclass, 'public.app_project_pick_runs'::regclass)""")
        privs = privileges(c)
        s.ok("R2 readers keep owner, grants, SECURITY DEFINER, STABLE and SET clauses; the lookup is an "
             "inlinable STABLE sql set-returning function; RLS is on and public/anon/authenticated can "
             "neither read the tables nor run the refresh or the lookup",
             q1(c, ATTRS, (MK,)) == attrs_mk and q1(c, ATTRS, (AZ,)) == attrs_az
             and "statement_timeout=25s" in attrs_mk
             and rep_attrs["lanname"] == "sql" and rep_attrs["provolatile"] == "s" and not rep_attrs["prosecdef"]
             and not rep_attrs["proisstrict"] and rep_attrs["proretset"] and rep_attrs["proconfig"] is None
             and rep_attrs["rt"] == "app_projects" and rls and len(privs) == 3
             and not any(r["pick"] or r["runs"] or r["refresh"] or r["lookup"] for r in privs),
             {"rep": rep_attrs, "privs": privs, "rls": rls})

        after = shown(c)
        s.ok("R3a every reader shows the oracle's row on every member pin", after == want,
             [k for k in want if after.get(k) != want[k]][:4])
        s.ok("R3b everything else in every answer is byte-identical", rep.masked(c) == masked_before)

        cost_after = cost(c)
        s.ok(f"R4a COST: each reader reads at most {PER_PIN_INDEX} index entries and {PER_PIN_ROWS} rows of "
             "app_projects per pin, never the copies",
             all(v[3] for v in cost_after.values()), {"before": cost_before, "after": cost_after})
        s.ok("R4c COST: each reader reads what it read before the change, plus at most one app_projects "
             "index entry and one row per pin whose key has a stored pick",
             not beyond_today(c, cost_before, cost_after), beyond_today(c, cost_before, cost_after))
        ctl_i, ctl_t = reads(c, "select public.app_zip_projects_markers('11102','development',true)", (),
                             "create or replace function public.app_project_representative(p_source_key text, "
                             "p_record_kind text) returns setof public.app_projects language sql stable parallel safe "
                             f"as $body${READ_TIME_BODY}$body$")
        print(f"INFO — reads per reader call (index entries, rows, pins): before {cost_before}; after {cost_after}")
        print(f"INFO — the rolled-back rule on the 11102 map read: {ctl_i} index entries, {ctl_t} rows")
        s.ok(f"R4b POSITIVE CONTROL: the rolled-back read-time rule reads more than the {HEAVY_COPIES} copies of "
             "dev:H1 on the same map read, far past the bound",
             ctl_i > HEAVY_COPIES and ctl_i > PER_PIN_INDEX * members_of(c, "11102"),
             f"{ctl_i} index entries and {ctl_t} rows for {members_of(c, '11102')} pins")
        md5_after_ctl = md5_of(c, REP)

        ok, detail = plans_ok(c)
        s.ok("R5 inside both readers the lookup was inlined (no function call in the plan) and "
             "app_project_pick is read by its primary key", ok and md5_after_ctl == REP_MD5, detail)

        # R6 freshness. A newer record of dev:P3 (whose newest row was its lowest id) arrives.
        p3_before = shown(c)[("map", "11102", "dev:P3")]
        q(c, """insert into public.app_projects (id, source_key, record_kind, zip, name, type, status, stage,
                    submitted_at, date_kind, source_ref, registry_id, address, developer, scope_text, source_seq,
                    lat, lng, last_seen_at)
                values ('fffffff0-0000-0000-0000-000000000003', 'dev:P3', 'development', '11201',
                    'Project 3 NEWER RECORD', 'type', 'proposed', 'stage', date '2026-09-01', 'filed',
                    'https://example.test/3-new', 'reg-pt', '3 Main St', 'dev', 'scope', 3, null, null,
                    timestamptz '2026-10-02 00:00Z')""")
        stale = shown(c)
        q(c, "select public.app_project_pick_refresh()")
        fresh = shown(c)
        s.ok("R6a a newer record shows after the next refresh, not before",
             stale[("map", "11102", "dev:P3")] == p3_before
             and fresh[("map", "11102", "dev:P3")][0] == "Project 3 NEWER RECORD"
             and fresh == oracle(c, picked), stale[("map", "11102", "dev:P3")])
        pid = q1(c, "select project_id::text from public.app_project_pick where source_key = 'dev:P1'")
        q(c, "delete from public.app_projects where id = %s::uuid", (pid,))
        fell = shown(c)
        s.ok("R6b a picked row that is removed falls back to the lowest-id row; the pin stays",
             fell == oracle(c, picked) and ("map", "11101", "dev:P1") in fell
             and q1(c, "select count(*) from public.app_project_pick where project_id = %s::uuid", (pid,)) == 1,
             fell.get(("map", "11101", "dev:P1")))
        q(c, "select public.app_project_pick_refresh()")
        again = q1(c, "select public.app_project_pick_refresh()")
        s.ok("R6c refreshing with nothing changed writes nothing",
             again["inserted"] == 0 and again["changed"] == 0 and again["deleted"] == 0
             and stored(c) == expected_overrides(c), again)
        whole = stored(c)
        q(c, "delete from public.app_project_pick")
        split = [q1(c, "select public.app_project_pick_refresh(%s, 4)", (i,)) for i in range(4)]
        s.ok("R6d four quarter runs store exactly what one whole run stores, each quarter its own keys",
             stored(c) == whole and sum(r["overrides"] for r in split) == len(whole)
             and all(r["parts"] == 4 for r in split), [r["overrides"] for r in split])
        bad = [refusal(c, f"select public.app_project_pick_refresh({a}, {b})") for a, b in ((4, 4), (-1, 4), (0, 0), (0, 65))]
        s.ok("R6e an invalid part is refused", all(e and "is not valid" in e for e in bad), bad)

        del c.notices[:]
        q(c, pb)
        state_r1 = base_state(c)
        s.ok("R7a applying PART B again does nothing and says so",
             state_r1["mk"] == MK_POST and state_r1["az"] == AZ_POST
             and sum("already applied" in n for n in c.notices) == 2)
        rb_b, rb_c = rollback_parts()
        q(c, rb_b)
        s.ok("R7b the rollback restores both readers byte for byte (owner, grants, SET clauses too) and "
             "every pin shows the lowest-id row again",
             md5_of(c, MK) == MK_PRE and md5_of(c, AZ) == AZ_PRE and q1(c, ATTRS, (MK,)) == attrs_mk
             and q1(c, ATTRS, (AZ,)) == attrs_az and shown(c) == oracle(c, lowest))
        q(c, pb)
        s.ok("R7c applying again after the rollback lands R1's state",
             base_state(c) == state_r1 and shown(c) == oracle(c, picked))

        err = refusal(c, pc)
        s.ok("R8 PART C refuses where pg_cron is missing, naming it (production has pg_cron)",
             err is not None and "pg_cron is not installed" in err, err)
        del c.notices[:]
        q(c, rb_c)
        s.ok("R8b the rollback's PART C' says there is nothing to unschedule here",
             any("nothing to unschedule" in n for n in c.notices), c.notices[-1:] if c.notices else None)
    finally:
        c.close()
        rs.drop_db(db)
    return s


MUTATIONS = [
    ("M1 the lookup ignores the stored pick (today's lowest-id row)",
     [(re.search(r"as \$body\$(.*?)\$body\$", open(DOC).read(), re.S).group(1), LOWEST_ID_BODY)]),
    ("M2 the refresh ignores the date (newest = every row)",
     [("rank() over (order by p.submitted_at desc nulls last) as newest", "1 as newest")]),
    ("M3 the refresh ignores which version was written last",
     [("order by source_key, record_kind, written desc nulls last, first_id collate \"C\"",
       "order by source_key, record_kind, first_id collate \"C\"")]),
    ("M4 the rolled-back read-time rule is back in the lookup",
     [(re.search(r"as \$body\$(.*?)\$body\$", open(DOC).read(), re.S).group(1), READ_TIME_BODY)]),
    ("M5 the lookup carries a SET clause (not inlined)",
     [("stable\nparallel safe\nas $body$", "stable\nparallel safe\nset search_path = public\nas $body$"),
      ("and p.proretset and p.proconfig is null", "and p.proretset")]),
    ("M6 the lookup trusts a stored id that no longer belongs to the key",
     [("""                        join public.app_projects q on q.id = k.project_id
                                                  and q.source_key = k.source_key
                                                  and q.record_kind = k.record_kind
""", "")]),
    ("M11 the lowest-id row is also returned when a pick is stored (two rows per pin)",
     [("""      and not exists (select 1
                        from public.app_project_pick k
                        join public.app_projects q on q.id = k.project_id
                                                  and q.source_key = k.source_key
                                                  and q.record_kind = k.record_kind
                       where k.source_key = p_source_key
                         and k.record_kind = p_record_kind)
""", "")]),
    ("M7 the pick table is left readable by anon",
     [("    execute 'revoke all on table public.app_project_pick from anon';",
       "    execute 'grant select on table public.app_project_pick to anon';")]),
    ("M9 the prefilter ignores status (a key whose copies differ only in status is skipped)",
     [("hashtextextended(row(p.name, p.type, p.type_raw, p.status, p.stage,",
       "hashtextextended(row(p.name, p.type, p.type_raw, p.stage,")]),
    ("M10 a part run deletes the other parts' stored picks",
     [("""     where (hashtext(k.source_key)::bigint % p_parts + p_parts) % p_parts = p_part
       and not exists (select 1 from want w""", """     where not exists (select 1 from want w""")]),
    ("M8 undated records count as newest",
     [("order by p.submitted_at desc nulls last) as newest",
       "order by p.submitted_at desc nulls first) as newest")]),
]


def consistent(conn, text):
    """Rewrite the file's recorded fingerprints to what the (broken) file itself produces, so a
    mutant can only be caught by behaviour."""
    fn = re.search(r"create or replace function public\.app_project_pick_refresh\([^)]*\).*?as \$fn\$(.*?)\$fn\$;",
                   text, re.S).group(1)
    text = text.replace(REFRESH_MD5, hashlib.md5(fn.encode()).hexdigest())
    body = re.search(r"as \$body\$(.*?)\$body\$", text, re.S).group(1)
    text = text.replace(REP_MD5, hashlib.md5(body.encode()).hexdigest())
    pb = parts(text)[2]
    pairs = re.findall(r"\((\d), (\d), \$n\$(.*?)\$n\$,\s*\$r\$(.*?)\$r\$\)", pb, re.S)
    for fn_n, fnname, post in (("1", MK, MK_POST), ("2", AZ, AZ_POST)):
        src = q1(conn, "select prosrc from pg_proc where oid = %s::regprocedure", (fnname,))
        for n_fn, _n, needle, repl in pairs:
            if n_fn == fn_n:
                src = src.replace(needle, repl, 1)
        text = text.replace(post, hashlib.md5(src.encode()).hexdigest())
    return text


def mutant_red(c, text):
    want = oracle(c, picked)
    base = cost(c)
    try:
        apply(c, consistent(c, text))
    except psycopg2.Error as e:
        return True, f"apply refused: {str(e).splitlines()[0][:100]}"
    try:
        got = shown(c)
    except psycopg2.Error as e:
        return True, f"a reader raised: {str(e).splitlines()[0][:100]}"
    if got != want:
        return True, f"a reader does not show the oracle's row: {[k for k in want if got.get(k) != want[k]][:2]}"
    if stored(c) != expected_overrides(c):
        return True, "the stored picks differ from the oracle"
    for i in range(4):
        q(c, "select public.app_project_pick_refresh(%s, 4)", (i,))
    if stored(c) != expected_overrides(c):
        return True, "R6d: four quarter runs store something else than one whole run"
    bad = {k: v for k, v in cost(c).items() if not v[3]}
    if bad:
        return True, f"R4 cost: {bad}"
    over = beyond_today(c, base, cost(c))
    if over:
        return True, f"R4c cost: {over}"
    ok, detail = plans_ok(c)
    if not ok:
        return True, f"R5: {detail}"
    if any(r["pick"] or r["runs"] or r["refresh"] or r["lookup"] for r in privileges(c)):
        return True, "anon/authenticated/public can read or run something"
    pid = q1(c, "select project_id::text from public.app_project_pick where source_key = 'dev:P1'")
    q(c, "delete from public.app_projects where id = %s::uuid", (pid,))
    if ("map", "11101", "dev:P1") not in shown(c):
        return True, "R6b: a removed pick drops the pin"
    return False, "all behaviour checks passed"


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
        db = f"map1_pick_mut{i}"
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


INGEST_ROOT = os.environ.get("INGEST_ROOT", "").strip()
REQUIRE_INGEST = os.environ.get("REQUIRE_INGEST", "") == "1"
ING_FN = rep.ING_FN
ING_PREV_MD5 = rep.ING_PREV_MD5


def ingest_files():
    mig = os.path.join(INGEST_ROOT, "supabase", "migrations")
    prev = os.path.join(mig, "20260928160000_app_development_projects_for_zips_identity.sql")
    new = sorted(f for f in os.listdir(mig) if f.endswith("_app_development_projects_for_zips_pick.sql"))
    return prev, (os.path.join(mig, new[-1]) if new else None)


def ingest_want(conn, pick):
    by_key = rows_by_key(conn)
    out = {}
    for m in q(conn, """select zcta5::text as z, source_key from geo.n5_serving_membership
                         where record_kind = 'development'"""):
        r = pick(by_key.get(m["source_key"], []))
        if r is not None:
            out[(m["z"], m["source_key"])] = r["id"]
    return out


def run_ingest():
    s = rs.Suite(None, "map1-pick/ingest")
    prev_path, new_path = ingest_files()
    prev, new = open(prev_path).read(), open(new_path).read()
    post = rep.ingest_post_md5(new)
    db = "map1_pick_ing"
    c = rs.fresh_db(db)
    try:
        build(c)
        q(c, prev)
        before_picks, before_rest = rep.ingest_answers(c)
        s.ok("I0 CONTROL: the previous DDL of record (md5 02885439...) shows the LOWEST-ID row",
             md5_of(c, ING_FN) == ING_PREV_MD5 and before_picks == ingest_want(c, lowest)
             and before_picks != ingest_want(c, picked), md5_of(c, ING_FN))
        err = refusal(c, new)
        ok1 = err is not None and "does not exist" in err and md5_of(c, ING_FN) == ING_PREV_MD5
        with c.cursor() as cur:
            cur.execute("begin")
            cur.execute("create function public.app_project_representative(p_source_key text, p_record_kind text) "
                        "returns setof public.app_projects language sql stable parallel safe "
                        f"as $body${READ_TIME_BODY.replace(chr(10) + '  ', chr(10) + '  ')}$body$")
            err2 = None
            try:
                cur.execute(new)
            except psycopg2.Error as e:
                err2 = str(e).splitlines()[0]
            cur.execute("rollback")
        s.ok("I1 refused while the lookup is missing, and while it is any other body (here the "
             "rolled-back read-time rule); nothing changed",
             ok1 and err2 is not None and "expected 2c01f73a" in err2 and md5_of(c, ING_FN) == ING_PREV_MD5,
             (err, err2))
        apply(c)
        acl_before = q1(c, ATTRS, (ING_FN,))
        q(c, new)
        s.ok(f"I2 after PARTS A-B it applies; body md5 {post[:8]}...; owner, grants and SET clauses unchanged; "
             "only service_role and the owner may run it",
             post == "376d7ee4c9cb0326d999534f9a092a06" and md5_of(c, ING_FN) == post
             and q1(c, ATTRS, (ING_FN,)) == acl_before
             and not q1(c, "select has_function_privilege('anon', to_regprocedure(%s), 'execute')", (ING_FN,))
             and not q1(c, "select has_function_privilege('authenticated', to_regprocedure(%s), 'execute')", (ING_FN,))
             and q1(c, "select has_function_privilege('service_role', to_regprocedure(%s), 'execute')", (ING_FN,)),
             q1(c, ATTRS, (ING_FN,)))
        after_picks, after_rest = rep.ingest_answers(c)
        want = ingest_want(c, picked)
        s.ok("I3 it shows the oracle's row on every member; everything else it answers is identical",
             after_picks == want and after_rest == before_rest,
             [k for k in after_picks if after_picks[k] != want.get(k)][:3])
        n = q1(c, "select count(*) from geo.n5_serving_membership where record_kind = 'development' and zcta5 in ('11101','11102')")
        i, t = reads(c, "select public.app_development_projects_for_zips(array['11101','11102'], 'development')")
        s.ok(f"I4 COST: at most {PER_PIN_INDEX} app_projects index entries and {PER_PIN_ROWS} rows per member",
             i <= PER_PIN_INDEX * n and t <= PER_PIN_ROWS * n, f"{i} entries, {t} rows, {n} members")
        q(c, prev)
        s.ok("I5 re-applying 20260928160000 restores the previous body and answers",
             md5_of(c, ING_FN) == ING_PREV_MD5 and rep.ingest_answers(c)[0] == ingest_want(c, lowest))
    finally:
        c.close()
        rs.drop_db(db)

    lat_new = "          from public.app_project_representative(m.source_key, 'development') p\n"
    lat_old = ("          from public.app_projects p\n         where p.source_key = m.source_key\n"
               "           and p.record_kind = 'development'\n         order by p.id asc\n         limit 1\n")
    mutant = new.replace(lat_new, lat_old, 1)
    mutant = mutant.replace(post, rep.ingest_post_md5(mutant))
    killed = False
    if mutant != new:
        c = rs.fresh_db("map1_pick_ing_mut")
        try:
            build(c)
            q(c, prev)
            apply(c)
            try:
                q(c, mutant)
                killed = rep.ingest_answers(c)[0] != ingest_want(c, picked)
            except psycopg2.Error:
                killed = True
        finally:
            c.close()
            rs.drop_db("map1_pick_ing_mut")
    print(f"{'KILLED' if killed else 'SURVIVED'} — I-M1 the Rule D reader keeps its own lowest-id pick")
    return s, (0 if killed else 1)


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
        ing_fails = ["REQUIRE_INGEST=1 but no ingest checkout with the pick migration at INGEST_ROOT"]
        ing_line = "INGEST HALF: REQUIRED AND MISSING"
    print("\n" + "=" * 60)
    print(f"MAP1-PICK: {len(base.results) - len(fails)} PASS / {len(fails)} FAIL · MUTATIONS: "
          f"{len(MUTATIONS) - len(survivors)} killed / {len(survivors)} survived")
    print(ing_line)
    for f in fails + ing_fails:
        print(f"FAIL — {f}")
    for m in survivors:
        print(f"FAIL — mutation survived: {m}")
    return 1 if (fails or survivors or ing_fails or ing_survivors) else 0


if __name__ == "__main__":
    sys.exit(main())

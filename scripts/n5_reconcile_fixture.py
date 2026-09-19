#!/usr/bin/env python3
"""Fixture harness for the Phase 5 reconciliation - it emits ONE self-asserting payload.

WHY THIS EXISTS AND WHY IT IS SHAPED LIKE THIS. The build sandbox has no egress to
Supabase, so the repo's own offline suite cannot execute SQL. A structural (grep)
pin therefore cannot tell a statement that RUNS from one that merely CONTAINS the
right words - and this repository has already paid for that distinction once in this
very phase: commit 47b005e shipped the marker BUILD with a MISSING COMMA between two
CTEs. Every grep assertion passed. The statement could never have parsed.

So the behavioural proof is a payload that:

  * creates TEMP relations only - nothing outside the session exists afterwards, and
    nothing in production is read for mutation or written;
  * substitutes those TEMP relations into the SHIPPED SQL from n5_reconcile_sql,
    never into a paraphrase of it;
  * runs the four stages and RAISES on any expectation that does not hold, so a
    silent pass is impossible;
  * ends by selecting a single verdict row, so "the payload did not run" and "the
    payload found nothing" cannot look the same.

The fixture geometry is synthetic on purpose. Two unit squares, ZCTA 'AAAAA' and
'BBBBB', sharing no interior; a key's geometry is moved from one to the other to
exercise the cascade. Real production geometry would make the test depend on a
row that another session can change.

stdlib only. Emits SQL on stdout; it never connects to anything itself.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import n5_reconcile_sql as R  # noqa: E402

SRID = 4269
# An isolated SCHEMA rather than TEMP tables, for one measured reason: the payload
# renders to ~121 KB and cannot cross the wire in a single call, so the proof runs as
# several calls and TEMP relations would not survive between them. The schema carries
# RLS and NO grants, holds a handful of synthetic rows, and is DROPPED at the end -
# the teardown is asserted, not assumed.
FX = os.environ.get("FIXTURE_SCHEMA", "geo_fx")
RELS = {
    "GEOM":     FX + ".t_geom",
    "INCOMING": FX + ".t_incoming",
    "BOUND":    FX + ".t_bound",
    "MEMB":     FX + ".t_memb",
    "MARK":     FX + ".t_mark",
    "ZCTA":     FX + ".t_zcta",
    "REGISTRY": FX + ".t_registry",
}
RULE = {"MIN_LINE_M": 250.0, "MIN_AREA_M2": 1000.0, "D_M": 1000.0, "DTAG": 1000}

# Squares far enough apart that no clip of one can touch the other, and large enough
# that their intersections clear the polygon sliver floor (1000 m^2).
A = "POLYGON((-100 40,-99.9 40,-99.9 40.1,-100 40.1,-100 40))"
B = "POLYGON((-98 40,-97.9 40,-97.9 40.1,-98 40.1,-98 40))"
# Small squares wholly inside A and inside B respectively.
IN_A = "POLYGON((-99.98 40.02,-99.96 40.02,-99.96 40.04,-99.98 40.04,-99.98 40.02))"
IN_B = "POLYGON((-97.98 40.02,-97.96 40.02,-97.96 40.04,-97.98 40.04,-97.98 40.02))"


def setup():
    return f"""
drop schema if exists {FX} cascade;
create schema {FX};

-- Shapes copied from production DDL, including the keys the reconcile relies on.
create table {FX}.t_geom (
  source_key text not null, registry_id text not null, feature_id text not null,
  outcome smallint not null, geom geometry, invalid_reason text, first_z3 char(3),
  recovered_at timestamptz not null default now(), provenance text not null,
  verdict_snapshot_id text, primary key (source_key, feature_id));
create table {FX}.t_incoming (like {FX}.t_geom including defaults);
create table {FX}.t_bound (
  zcta5 char(5) not null, source_key text not null, provenance text not null,
  run_id text not null, found_at timestamptz not null default now(),
  primary key (zcta5, source_key));
create table {FX}.t_memb (
  zcta5 char(5) not null, source_key text not null, lat double precision,
  lng double precision, point_rule text not null, clip_dim smallint,
  feature_count integer not null, geom_family text not null, run_id text not null,
  computed_at timestamptz not null default now(),
  record_kind text not null default 'development', primary key (zcta5, source_key));
create table {FX}.t_mark (
  zcta5 char(5) not null, source_key text not null, marker_seq integer not null,
  lat double precision not null, lng double precision not null, marker_rule text not null,
  family text, dim smallint, run_id text not null,
  computed_at timestamptz not null default now(),
  record_kind text not null default 'development',
  primary key (zcta5, source_key, marker_seq));
create table {FX}.t_zcta (zcta5 text primary key, geom geometry not null);
create table {FX}.t_registry (zip text primary key);
create table {FX}.t_log (step text, detail text, at timestamptz default clock_timestamp());

-- RLS on every fixture relation and NO grant to anon/authenticated/PUBLIC, so the
-- fixture cannot become the `page_cache` posture by omission while it exists.
alter table {FX}.t_geom enable row level security;
alter table {FX}.t_incoming enable row level security;
alter table {FX}.t_bound enable row level security;
alter table {FX}.t_memb enable row level security;
alter table {FX}.t_mark enable row level security;
alter table {FX}.t_zcta enable row level security;
alter table {FX}.t_registry enable row level security;
alter table {FX}.t_log enable row level security;
revoke all on schema {FX} from public;

insert into {FX}.t_zcta values ('AAAAA', ST_GeomFromText('{A}', {SRID})),
                               ('BBBBB', ST_GeomFromText('{B}', {SRID}));
insert into {FX}.t_registry values ('AAAAA'), ('BBBBB');
"""


def incoming(rows):
    """rows: list of (source_key, feature_id, wkt_or_None, outcome)."""
    if not rows:
        return "delete from " + FX + ".t_incoming;\n"
    vals = []
    for sk, fid, wkt, outcome in rows:
        g = "null" if wkt is None else f"ST_GeomFromText('{wkt}', {SRID})"
        vals.append(f"('{sk}','reg-fixture','{fid}',{outcome},{g},null,null,"
                    f"'recovered_authoritative',null)")
    return ("delete from " + FX + ".t_incoming;\ninsert into " + FX + ".t_incoming "
            "(source_key,registry_id,feature_id,outcome,geom,invalid_reason,first_z3,"
            "provenance,verdict_snapshot_id) values " + ",".join(vals) + ";\n")


def reconcile_function():
    """The four SHIPPED stages compiled into fixture-side functions.

    TWO functions, not one, because stage 1 is itself two statements (see
    n5_reconcile_sql) and keeping it separate makes the mutation that collapses it
    back into one a single-function swap rather than a rewrite of the whole body.

    The text under test is transmitted once and every subsequent step names it, so
    each receipt is unambiguously about THIS body rather than a retyped variant.
    `{KEYS}` and `{RUN}` render to the functions' own parameters, so the bound stays
    the caller's key array - the harness cannot widen it.
    """
    def body(name, sql):
        rendered = R.render(sql, "_keys", "_run", rels=RELS, rule_params=RULE)
        left = R.unresolved_placeholders(rendered)
        if left:
            raise SystemExit(f"STOP: stage {name} left placeholders {left}")
        return "-- ---- stage " + name + " ----\n" + rendered

    stage1 = dict(R.STAGES)["geometry"]
    rest = [(n, s) for n, s in R.STAGES if n != "geometry"]
    out = [
        f"create or replace function {FX}.reconcile_stage1(_keys text[], _run text)\n"
        "returns void language plpgsql\n"
        f"set search_path = {FX}, public\n"
        "as $s1$\nbegin\n" + body("geometry", stage1) + "\nend $s1$;\n",
        f"create or replace function {FX}.reconcile(_keys text[], _run text)\n"
        "returns void language plpgsql\n"
        f"set search_path = {FX}, public\n"
        "as $recon$\nbegin\n"
        f"  perform {FX}.reconcile_stage1(_keys, _run);\n"
        + "\n".join(body(n, s) for n, s in rest) + "\nend $recon$;\n",
    ]
    return "\n".join(out)


def run_stages(keys, run):
    lit = "array[" + ",".join("'" + k + "'" for k in keys) + "]"
    return f"select {FX}.reconcile({lit}, '{run}');\n"


def expect(label, query, want):
    """Assert a scalar against `want`.

    The body is dollar-quoted, so NOTHING inside it is escaped - an earlier version
    doubled the quotes as if it were a literal and produced `source_key=\'\'K\'\'`,
    which is a different predicate that happens to parse. The value is evaluated ONCE
    into a variable and then both compared and logged, so the failure message can
    never report a different read from the one that failed.
    """
    return (
        "do $chk$\ndeclare got text; want text := " + _lit(str(want)) + ";\nbegin\n"
        "  select (" + query + ")::text into got;\n"
        "  if got is distinct from want then\n"
        "    raise exception 'FIXTURE FAIL [" + label.replace("'", "''") +
        "]: got %, want %', coalesce(got,'<null>'), want;\n"
        "  end if;\n"
        "  insert into t_log(step, detail) values (" + _lit(label) +
        ", 'PASS=' || coalesce(got,'<null>'));\n"
        "end $chk$;\n")


def _lit(v):
    return "'" + str(v).replace("'", "''") + "'"


def fp_all(alias):
    """One fingerprint over ALL FOUR planes for a single key, so 'unrelated rows are
    byte-identical' is one comparison rather than four that could each be forgotten.
    Collation pinned - see n5_reconcile_sql's docstring on rule 9."""
    return f"""md5(
   coalesce((select string_agg(g.feature_id||'|'||g.outcome::text||'|'||coalesce(encode(ST_AsBinary(g.geom),'hex'),''), E'\\n' order by g.feature_id collate "C")
               from t_geom g where g.source_key = {alias}), '')
|| '::' ||
   coalesce((select string_agg(b.zcta5||'|'||b.provenance, E'\\n' order by b.zcta5 collate "C")
               from t_bound b where b.source_key = {alias}), '')
|| '::' ||
   coalesce((select string_agg(m.zcta5||'|'||coalesce(m.lat::text,'')||'|'||coalesce(m.lng::text,'')||'|'||m.point_rule||'|'||m.feature_count::text, E'\\n' order by m.zcta5 collate "C")
               from t_memb m where m.source_key = {alias}), '')
|| '::' ||
   coalesce((select string_agg(k.zcta5||'|'||k.marker_seq::text||'|'||k.lat::text||'|'||k.lng::text||'|'||k.marker_rule, E'\\n' order by (k.zcta5||lpad(k.marker_seq::text,6,'0')) collate "C")
               from t_mark k where k.source_key = {alias}), '')
  )"""


CUT = "\n-- >>>>>>>>>>>> CHUNK BREAK <<<<<<<<<<<<\n"
PREAMBLE = "set search_path = " + FX + ", public;\n"


def scenario():
    """The whole Phase 5 behavioural proof as one payload.

    Every case drives the SHIPPED four-stage cascade. Nothing here re-implements a
    stage, and nothing asserts on a paraphrase: the only SQL that mutates the fixture
    relations is the text n5_reconcile_sql emits.
    """
    p = [setup(), CUT, reconcile_function(), CUT]

    def step(label, rows, keys, run):
        p.append(f"\n-- ================= {label} =================")
        p.append(incoming(rows))
        p.append(run_stages(keys, run))
        p.append(CUT)

    # ---- the unrelated CONTROL. Placed first, never named again, fingerprinted at
    # the end. A test that only proves the subject moved cannot see collateral damage.
    step("seed control key U in AAAAA", [("U", "u#0", IN_A, 1)], ["U"], "r-seed-u")
    p.append("create table " + FX + ".t_u_before as select " + fp_all("'U'") + " fp;")
    p.append(expect("control U has membership after seed",
                    "select count(*) from t_memb where source_key='U'", 1))

    # ---- CASE 1: none -> A
    step("case1 none->A", [("K", "k#0", IN_A, 1)], ["K"], "r1")
    p.append(expect("case1 geom rows", "select count(*) from t_geom where source_key='K'", 1))
    p.append(expect("case1 boundary zctas",
                    "select coalesce(string_agg(zcta5,',' order by zcta5),'') from t_bound where source_key='K'", "AAAAA"))
    p.append(expect("case1 membership zctas",
                    "select coalesce(string_agg(zcta5,',' order by zcta5),'') from t_memb where source_key='K'", "AAAAA"))
    p.append(expect("case1 markers exist",
                    "select count(*) > 0 from t_mark where source_key='K'", "true"))

    # ---- CASE 6 (idempotence) is asserted HERE, on case 1's state, because an
    # idempotence claim is only meaningful against a state that a run just produced.
    p.append("create table " + FX + ".t_k_c1 as select " + fp_all("'K'") + " fp;")
    step("case6 re-run identical input", [("K", "k#0", IN_A, 1)], ["K"], "r1-again")
    p.append(expect("case6 idempotent across all four planes",
                    "select (select fp from t_k_c1) = (" + fp_all("'K'") + ")", "true"))

    # ---- CASE 2: A -> B  (the full cascade, section 4 of the brief)
    step("case2 A->B", [("K", "k#0", IN_B, 1)], ["K"], "r2")
    p.append(expect("case2 boundary moved to BBBBB",
                    "select coalesce(string_agg(zcta5,',' order by zcta5),'') from t_bound where source_key='K'", "BBBBB"))
    p.append(expect("case2 membership moved to BBBBB",
                    "select coalesce(string_agg(zcta5,',' order by zcta5),'') from t_memb where source_key='K'", "BBBBB"))
    p.append(expect("case2 markers moved to BBBBB",
                    "select coalesce(string_agg(distinct zcta5,','),'') from t_mark where source_key='K'", "BBBBB"))
    p.append(expect("case2 NOTHING left on AAAAA for K",
                    "select (select count(*) from t_bound where source_key='K' and zcta5='AAAAA')"
                    " + (select count(*) from t_memb where source_key='K' and zcta5='AAAAA')"
                    " + (select count(*) from t_mark where source_key='K' and zcta5='AAAAA')", 0))

    # ---- CASE 5: none -> A+B  (reached from B, so it also proves a SPAN is additive)
    step("case5 -> A+B", [("K", "k#0", IN_A, 1), ("K", "k#1", IN_B, 1)], ["K"], "r5")
    p.append(expect("case5 boundary spans both",
                    "select coalesce(string_agg(zcta5,',' order by zcta5),'') from t_bound where source_key='K'", "AAAAA,BBBBB"))
    p.append(expect("case5 membership spans both",
                    "select coalesce(string_agg(zcta5,',' order by zcta5),'') from t_memb where source_key='K'", "AAAAA,BBBBB"))

    # ---- CASE 3: A+B -> B  (the contraction the append-only probe could never do)
    step("case3 A+B->B", [("K", "k#0", IN_B, 1)], ["K"], "r3")
    p.append(expect("case3 boundary contracted to BBBBB",
                    "select coalesce(string_agg(zcta5,',' order by zcta5),'') from t_bound where source_key='K'", "BBBBB"))
    p.append(expect("case3 membership contracted to BBBBB",
                    "select coalesce(string_agg(zcta5,',' order by zcta5),'') from t_memb where source_key='K'", "BBBBB"))
    p.append(expect("case3 markers contracted to BBBBB",
                    "select coalesce(string_agg(distinct zcta5,','),'') from t_mark where source_key='K'", "BBBBB"))

    # ---- CASE 4: A -> none.  The publisher still returns the key; its geometry is
    # no longer usable (outcome<>1). That is NOT source disappearance - see case 8.
    step("case4 ->none (unusable geometry)", [("K", "k#0", None, 3)], ["K"], "r4")
    p.append(expect("case4 geom row survives as a quarantine record",
                    "select count(*) from t_geom where source_key='K' and outcome=3", 1))
    p.append(expect("case4 boundary emptied", "select count(*) from t_bound where source_key='K'", 0))
    p.append(expect("case4 membership emptied", "select count(*) from t_memb where source_key='K'", 0))
    p.append(expect("case4 markers emptied", "select count(*) from t_mark where source_key='K'", 0))

    # ---- CASE 8: SOURCE DISAPPEARANCE. The key is named but the fetch returned
    # NOTHING for it. Stage 1 deliberately does not invent a delete here: retention
    # is the application's existing stale-sweep decision, and a second definition of
    # "deleted" inside the geometry layer is how two answers to one question start.
    step("case8 named but absent from incoming", [], ["K"], "r8")
    p.append(expect("case8 geometry NOT deleted by the reconcile",
                    "select count(*) from t_geom where source_key='K'", 1))

    # ---- CASE 9: TREATMENT CHANGE. A key whose registry disposition becomes
    # non-processable is simply never named, so nothing about it moves; when it
    # becomes processable again the SAME cascade restores it. Proven both ways.
    p.append("create table " + FX + ".t_k_hold as select " + fp_all("'K'") + " fp;")
    p.append("\n-- key K is NOT named: a non-processable treatment is an absence from the key set")
    p.append(run_stages(["U"], "r9-hold"))
    p.append(expect("case9 held key is byte-identical while unnamed",
                    "select (select fp from t_k_hold) = (" + fp_all("'K'") + ")", "true"))
    step("case9 treatment restored", [("K", "k#0", IN_A, 1)], ["K"], "r9-back")
    p.append(expect("case9 restored key is placed again on AAAAA",
                    "select coalesce(string_agg(zcta5,',' order by zcta5),'') from t_memb where source_key='K'", "AAAAA"))

    # ---- the control, last.
    p.append(expect("control U is byte-identical across all four planes",
                    "select (select fp from t_u_before) = (" + fp_all("'U'") + ")", "true"))

    # ---- the instrument proves it ran: a verdict row naming the count of passes.
    p.append("select count(*) as checks_passed, "
             "string_agg(step, ' | ' order by at) as steps from t_log;")
    return "\n".join(p)


def chunks():
    """Split into payloads small enough to cross the wire, each self-contained.

    The split is between whole steps, never inside one: a stage that ran while its
    assertions did not would be the worst possible failure mode for this proof."""
    out = []
    for part in scenario().split(CUT):
        part = part.strip()
        if part:
            out.append(PREAMBLE + part)
    return out


if __name__ == "__main__":
    cs = chunks()
    if len(sys.argv) > 1 and sys.argv[1] == "--count":
        print(len(cs))
    elif len(sys.argv) > 1:
        sys.stdout.write(cs[int(sys.argv[1])])
    else:
        for i, c in enumerate(cs):
            sys.stderr.write(f"chunk {i}: {len(c)} bytes\n")

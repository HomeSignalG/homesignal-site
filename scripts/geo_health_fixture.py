#!/usr/bin/env python3
"""Phase 6 observe-only fixture — emits the health proof from the SHIPPED SQL.

Extracts `geo.geography_health_state` verbatim out of docs/geo-health-model.sql
and re-points it at an isolated fixture schema. The state machine is a PURE
FUNCTION of scalars, so every one of the eleven required cases is a scalar call:
the proof touches no plane, no queue, no registry and no production row, and it
cannot dispatch reconciliation because there is nothing in it that could.

A proof against a retyped copy of the state machine would prove nothing about the
file that gets applied, so the text is extracted rather than written twice.

stdlib only. Emits SQL on stdout; never connects to anything.
"""
import os
import re
import sys

FX = os.environ.get("FIXTURE_SCHEMA", "geo_fx6")
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "docs", "geo-health-model.sql")


def state_function():
    """The shipped state machine, re-pointed at the fixture schema."""
    src = open(SRC).read()
    i = src.index("create or replace function geo.geography_health_state(")
    j = src.index("$fn$;", i) + len("$fn$;")
    body = src[i:j]
    if "revoke" in body:
        raise SystemExit("STOP: slice overran into the revoke")
    return body.replace("function geo.geography_health_state(",
                        f"function {FX}.geography_health_state(")


CASES = [
    # label, act, pending, oldest, succ, err, errs, grow, ingest, want
    ("1 empty steady-state queue",            "A", 0,  None,   "T5",  None, 0, 0, True,  "HEALTHY"),
    ("2 one fresh key",                       "A", 1,  "2 min",  "T5",  None, 0, 0, True,  "HEALTHY"),
    ("3 one overdue key (past 4x interval)",  "A", 1,  "90 min", "T5",  None, 0, 0, True,  "WARNING"),
    ("3b one key past the SLA",               "A", 1,  "30 h",   "T5",  None, 0, 0, True,  "CRITICAL"),
    ("4 growing queue, 3 windows",            "A", 40, "5 min",  "T5",  None, 0, 3, True,  "WARNING"),
    ("4b growing queue, 6 windows",           "A", 90, "5 min",  "T5",  None, 0, 6, True,  "CRITICAL"),
    ("5 shrinking queue resets the counter",  "A", 5,  "5 min",  "T5",  None, 0, 0, True,  "HEALTHY"),
    ("6 failed reconciliation once",          "A", 0,  None,   "T5",  "T2", 1, 0, True,  "WARNING"),
    ("6b failed reconciliation three times",  "A", 0,  None,   "T5",  "T2", 3, 0, True,  "CRITICAL"),
    ("A ingest active + geography active",    "A", 0,  None,   "T5",  None, 0, 0, True,  "HEALTHY"),
    ("B ingest active + geography stopped",   "A", 0,  None,   "T3h", None, 0, 0, True,  "CRITICAL"),
    ("B2 ingest active + geography slipping", "A", 0,  None,   "T50", None, 0, 0, True,  "WARNING"),
    ("C ingest quiet + geography quiet",      "A", 0,  None,   "T3h", None, 0, 0, False, "HEALTHY"),
    ("C2 ingest quiet does not excuse aging", "A", 3,  "30 h",   "T3h", None, 0, 0, False, "CRITICAL"),
    ("NOT_ACTIVATED is never HEALTHY",        None,0,  None,   "T5",  None, 0, 0, True,  "NOT_ACTIVATED"),
    ("NOT_ACTIVATED beats a frozen cascade",  None,0,  None,   None,  None, 0, 0, True,  "NOT_ACTIVATED"),
    ("green run, zero keys, work aging",      "A", 12, "26 h",   "T1",  None, 0, 0, True,  "CRITICAL"),
]

_TS = {"A": "2026-09-01 00:00:00+00", "T5": "2026-09-19 11:55:00+00",
       "T2": "2026-09-19 11:58:00+00", "T1": "2026-09-19 11:59:00+00",
       "T50": "2026-09-19 11:10:00+00", "T3h": "2026-09-19 09:00:00+00"}


def _ts(v):
    return "null" if v is None else "timestamptz '" + _TS[v] + "'"


def _iv(v):
    return "null" if v is None else "interval '" + v + "'"


def cases_block():
    """All cases as ONE table-driven check.

    Seventeen near-identical DO blocks were the first form: ~10 KB of wire for
    ~2 KB of information. More importantly a table makes the case matrix READABLE
    as a matrix, so a missing combination is visible rather than buried.
    """
    rows = ",\n    ".join(
        "(" + ", ".join([
            "'" + lbl.replace("'", "''") + "'", _ts(act), str(pend), _iv(old),
            _ts(succ), _ts(err), str(errs), str(grow),
            "true" if ing else "false", "'" + want + "'"]) + ")"
        for (lbl, act, pend, old, succ, err, errs, grow, ing, want) in CASES)
    return (
        "\ndo $cases$\n"
        "declare r record; got text; why text; n int := 0;\n"
        "begin\n"
        "  for r in\n"
        "    select * from (values\n    " + rows + "\n"
        "    ) v(label, act, pending, oldest, succ, err, errs, grow, ingest, want)\n"
        "  loop\n"
        "    select s.state, s.reason into got, why\n"
        f"      from {FX}.geography_health_state(r.act, r.pending, r.oldest, r.succ, r.err,\n"
        "                                       r.errs, r.grow, r.ingest,\n"
        "                                       timestamptz '2026-09-19 12:00:00+00',\n"
        "                                       interval '15 minutes', interval '24 hours') s;\n"
        "    if got is distinct from r.want then\n"
        "      raise exception 'HEALTH FAIL [%]: got % (%), want %', r.label, got, why, r.want;\n"
        "    end if;\n"
        f"    insert into {FX}.t_log(step, detail) values (r.label, got || ': ' || why);\n"
        "    n := n + 1;\n"
        "  end loop;\n"
        "  raise notice 'state-machine cases passed: %', n;\n"
        "end $cases$;\n")


# Argument order of geography_health_state, named so a reader can check the call
# sites against the signature without scrolling: activated_at, pending_keys,
# oldest_pending_age, last_success_at, last_error_at, consecutive_errors,
# queue_growth_windows, ingest_active, now, interval, sla.
NOW = "timestamptz '2026-09-19 12:00:00+00'"
ACT = "timestamptz '2026-09-01 00:00:00+00'"


def call(pending=0, oldest="null", succ="timestamptz '2026-09-19 11:55:00+00'",
         err="null", errs=0, grow=0, ingest="true", act=ACT):
    return (f"{act}, {pending}, {oldest}, {succ}, {err}, {errs}, {grow}, {ingest}, "
            f"{NOW}, interval '15 minutes', interval '24 hours'")


def scenario():
    return "\n".join([
        f"drop schema if exists {FX} cascade;",
        f"create schema {FX};",
        f"create table {FX}.t_log(step text, detail text, at timestamptz default clock_timestamp());",
        f"alter table {FX}.t_log enable row level security;",
        f"revoke all on schema {FX} from public;",
        state_function(),
        cases_block(),
    ])


def registry_cases():
    """§6/§7/§10 — registry-level health, incl. the holds that must not be failures."""
    return f"""
-- Fixture catalogue and queue, shaped like production.
create table {FX}.n5_accepted_source (registry_id text primary key, treatment text not null);
create table {FX}.n5_geom (source_key text primary key, registry_id text not null);
create table {FX}.n5_reconcile_queue (source_key text primary key, enqueued_at timestamptz not null,
                                      claimed_at timestamptz);
alter table {FX}.n5_accepted_source enable row level security;
alter table {FX}.n5_geom enable row level security;
alter table {FX}.n5_reconcile_queue enable row level security;

insert into {FX}.n5_accepted_source values
  ('good-registry','PROVEN'), ('stuck-registry','RECOVERY'), ('idle-registry','PROVEN'),
  ('noauth-registry','NOAUTH');
-- baltimore-city-housing-permits (PENDING_REVIEW) and the six BLOCKED_NO_RECORDS
-- registries have NO catalogue row - that IS what a governance hold looks like in
-- the database, so they are modelled by absence rather than by a flag.
insert into {FX}.n5_geom values
  ('g1','good-registry'), ('s1','stuck-registry'), ('s2','stuck-registry'),
  ('n1','noauth-registry'), ('b1','baltimore-city-housing-permits'),
  ('h1','harris-county-permits');
insert into {FX}.n5_reconcile_queue values
  ('g1', now() - interval '3 minutes', null),
  ('s1', now() - interval '30 hours', null),
  ('s2', now() - interval '29 hours', null),
  ('n1', now() - interval '30 hours', null),
  ('b1', now() - interval '40 hours', null),
  ('h1', now() - interval '40 hours', null);

create or replace view {FX}.v_registry_health
with (security_invoker = true) as
with hold as (select s.registry_id, s.treatment from {FX}.n5_accepted_source s),
q as (
  select k.registry_id, count(*)::int pending_keys,
         max(now() - k.enqueued_at) oldest_pending_age,
         count(*) filter (where k.claimed_at is not null)::int claimed
    from (select q.source_key, q.enqueued_at, q.claimed_at,
                 (select g.registry_id from {FX}.n5_geom g where g.source_key = q.source_key limit 1) registry_id
            from {FX}.n5_reconcile_queue q) k
   group by k.registry_id)
select coalesce(h.registry_id, q.registry_id) as registry_id, h.treatment,
       (h.treatment in ('PROVEN','RECOVERY')) as processable,
       (h.registry_id is null) as governance_hold,
       coalesce(q.pending_keys,0) as pending_keys, q.oldest_pending_age,
       coalesce(q.claimed,0) as claimed_keys,
       case when h.registry_id is null then 'HOLD'
            when h.treatment not in ('PROVEN','RECOVERY') then 'NOT_PROCESSABLE'
            when coalesce(q.pending_keys,0) = 0 then 'IDLE'
            when q.oldest_pending_age > interval '24 hours' then 'CRITICAL'
            when q.oldest_pending_age > interval '1 hour' then 'WARNING'
            else 'WORKING' end as registry_state
  from hold h full outer join q on q.registry_id = h.registry_id;
"""


if __name__ == "__main__":
    out = scenario()
    if len(sys.argv) > 1 and sys.argv[1] == "--registry":
        sys.stdout.write(registry_cases())
    elif len(sys.argv) > 1 and sys.argv[1] == "--fn":
        sys.stdout.write(state_function())
    else:
        # NOT "\n".join(out): scenario() returns a STRING, so joining it emits one
        # character per line and the SQL cannot parse. That defect shipped at
        # dedb7db and was invisible because nothing ever executed this file - no
        # workflow, test or doc referenced it. Fixed 2026-09-20; the state machine
        # itself was sound (17 cases pass).
        sys.stdout.write(out)

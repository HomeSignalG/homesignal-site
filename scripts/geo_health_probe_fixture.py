#!/usr/bin/env python3
"""Behavioural proof for geo.geography_health_probe AND its pipeline_health_tick
integration - not only the pure state function.

The accepted scripts/geo_health_fixture.py exercises geography_health_state, which
is a pure function of scalars. That is necessary and not sufficient: the PROBE
wraps it, and the wrapper had its own precedence. This file drives the real probe
against a real queue, and then drives the REAL integration replacement text (read
out of docs/geo-health-integration-install.sql, never retyped) to prove what the
monitor would actually emit.

Runs against a disposable local PostgreSQL. Touches no production system.
Exit code 0 only if every assertion passes.

Usage: python3 scripts/geo_health_probe_fixture.py ["host=... port=..."]
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
FAILS, CHECKS = [], [0]


def ck(label, got, want):
    CHECKS[0] += 1
    if got != want:
        FAILS.append(f"FAIL {label}: got {got!r}, want {want!r}")
    else:
        print(f"  ok  {label}: {got!r}")


def psql(dsn, sql, quiet=True):
    p = subprocess.run(["psql", dsn, "-v", "ON_ERROR_STOP=1", "-X", "-tA", "-c", sql],
                       capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.strip())
    return p.stdout.strip()


def psql_file(dsn, path):
    p = subprocess.run(["psql", dsn, "-X", "-f", path], capture_output=True, text=True)
    return p.stdout + p.stderr


def core_sql():
    s = open(os.path.join(ROOT, "docs", "geo-work-handoff.sql"), encoding="utf-8").read()
    i = s.index("create table if not exists geo.n5_reconcile_queue")
    return s[i:s.index("commit;", i)]


def integration_repl():
    """The REAL replacement text from the health integration artifact."""
    s = open(os.path.join(ROOT, "docs", "geo-health-integration-install.sql"), encoding="utf-8").read()
    j = s.index("  _repl constant text :="); j = s.index("$r$", j)
    r = s[j + 3: s.index("$r$;", j)]
    if "geography_progression" not in r:
        raise SystemExit("STOP: extraction of the integration replacement failed")
    return r


SCAFFOLD = """
drop schema if exists geo cascade; create schema geo;
drop table if exists public.development_reports;
create table public.development_reports(zip text, refreshed_at timestamptz);
create table geo.n5_accepted_source(registry_id text primary key, treatment text, projects bigint, pairs bigint);
create table geo.n5_geom(source_key text, registry_id text, feature_id text, outcome smallint, geom text, provenance text);
insert into public.development_reports values ('19475', now());
drop table if exists public.pipeline_health_check;
create table public.pipeline_health_check(check_name text primary key, ok boolean,
  alertable boolean, detail text, since timestamptz, updated_at timestamptz);
"""


def main():
    dsn = sys.argv[1] if len(sys.argv) > 1 else "host=localhost port=55432 user=postgres dbname=postgres"
    print("== isolated health-probe fixture ==")
    psql(dsn, SCAFFOLD)
    psql(dsn, core_sql())
    out = psql_file(dsn, os.path.join(ROOT, "docs", "geo-health-model.sql"))
    if "ERROR" in out:
        print(out[-1500:]); raise SystemExit("STOP: health model failed to install")

    def probe():
        return psql(dsn, "select state from geo.geography_health_probe(_record:=false);")

    def set_act(v):
        psql(dsn, f"update geo.geography_activation set activated_at = {v} where singleton;")

    def queue(n):
        psql(dsn, "delete from geo.n5_reconcile_queue;")
        if n:
            psql(dsn, f"insert into geo.n5_reconcile_queue(source_key,reason) "
                      f"select 'k'||g,'project_upsert' from generate_series(1,{n}) g;")

    # --- the precedence matrix -------------------------------------------------
    set_act("null"); queue(1000)
    ck("A never activated, queue under the 200,000 cap", probe(), "NOT_ACTIVATED")
    queue(200001)
    ck("B never activated, queue OVER the cap -> still NOT_ACTIVATED", probe(), "NOT_ACTIVATED")
    ck("B the capped depth is still reported, not discarded",
       "scan cap" in psql(dsn, "select reason from geo.geography_health_probe(_record:=false);"), True)
    set_act("now() - interval '1 day'")
    ck("C ACTIVATED, queue OVER the cap -> CRITICAL (unchanged)", probe(), "CRITICAL")
    queue(0)
    psql(dsn, "insert into geo.n5_reconcile_queue(source_key,reason,enqueued_at) "
              "values ('old','project_upsert', now()-interval '30 hours');")
    ck("D ACTIVATED, one key past the 24h SLA -> CRITICAL (unchanged)", probe(), "CRITICAL")
    # ⚠️ E WAS WRITTEN WRONG FIRST AND THE CONTRACT WAS RIGHT. An ACTIVATED system
    # with live ingest and NO successful reconcile ever is CRITICAL by rule (4)
    # ("ingest is active but reconciliation last succeeded never") - that is the
    # frozen-pipeline signature the model exists to catch. HEALTHY needs a recent
    # success recorded, so the fixture must record one rather than expect the
    # state machine to be lenient.
    queue(1)
    ck("E ACTIVATED + live ingest + never succeeded -> CRITICAL (frozen signature)",
       probe(), "CRITICAL")
    psql(dsn, "insert into geo.geography_progress(component, last_success_at) "
              "values ('reconcile', now()) on conflict (component) do update "
              "set last_success_at = excluded.last_success_at;")
    ck("E2 ACTIVATED, fresh queue, recent success -> HEALTHY", probe(), "HEALTHY")
    ck("F the 200,000 default is unchanged",
       psql(dsn, "select pg_get_function_arguments(p.oid) from pg_proc p "
                 "join pg_namespace n on n.oid=p.pronamespace "
                 "where n.nspname='geo' and p.proname='geography_health_probe';").find("200000") > 0,
       True)

    # --- the REAL pipeline_health_tick integration -----------------------------
    # A miniature tick carrying the artifact's own replacement text verbatim.
    repl = integration_repl()
    tick = ("create or replace function public.fx_tick() returns void language plpgsql as $t$\n"
            "declare _now timestamptz := now();\n begin\n"
            "  create temp table _eval (c_name text, c_ok boolean, c_alertable boolean, c_detail text) on commit drop;\n"
            + repl + "\n on conflict (check_name) do update set ok=excluded.ok,"
            " alertable=excluded.alertable, detail=excluded.detail, updated_at=excluded.updated_at;\n"
            "end $t$;")
    psql(dsn, "set check_function_bodies=on; " + tick)
    ck("G the real integration text compiles inside a tick", True, True)

    set_act("null"); queue(5)
    psql(dsn, "begin; select public.fx_tick(); commit;")
    row = psql(dsn, "select ok::int||'|'||alertable::int||'|'||left(detail,13) from public.pipeline_health_check "
                    "where check_name='geography_progression';")
    ck("H worker OFF -> the monitor emits NOT_ACTIVATED, ok, NOT alertable", row, "1|0|NOT_ACTIVATED")

    set_act("now() - interval '1 day'"); queue(0)
    psql(dsn, "insert into geo.n5_reconcile_queue(source_key,reason,enqueued_at) "
              "values ('old','project_upsert', now()-interval '30 hours');")
    psql(dsn, "begin; select public.fx_tick(); commit;")
    row = psql(dsn, "select ok::int||'|'||alertable::int||'|'||left(detail,8) from public.pipeline_health_check "
                    "where check_name='geography_progression';")
    ck("I a genuine CRITICAL IS alertable", row, "0|1|CRITICAL")

    # the probe failing must not take the whole tick down
    psql(dsn, "alter function geo.geography_health_probe(int,boolean) rename to probe_hidden;")
    psql(dsn, "begin; select public.fx_tick(); commit;")
    row = psql(dsn, "select ok::int||'|'||alertable::int||'|'||left(detail,10) from public.pipeline_health_check "
                    "where check_name='geography_progression';")
    ck("J a missing probe degrades to UNMEASURED, never a pass", row, "1|0|UNMEASURED")
    psql(dsn, "alter function geo.probe_hidden(int,boolean) rename to geography_health_probe;")

    print(f"\n{CHECKS[0]} checks, {len(FAILS)} failures")
    for f in FAILS:
        print(" ", f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())

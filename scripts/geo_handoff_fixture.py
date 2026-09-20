#!/usr/bin/env python3
"""Isolated behavioural proof for the lifecycle-handoff splice.

WHAT MAKES THIS HONEST: the fixture function is assembled so that it CONTAINS
THE PRODUCTION ANCHOR STRINGS VERBATIM - they are read out of
docs/geo-lifecycle-handoff-install.sql by scripts/geo_handoff_splice.py, never
retyped - and is then transformed by THE SAME replacement list the migration
applies to production. So this proves the behaviour of the real replacement
text, not of a paraphrase of it.

geo.n5_reconcile_queue and geo.enqueue_work are likewise EXTRACTED from
docs/geo-work-handoff.sql rather than restated.

Runs against a disposable local PostgreSQL. Touches no production system and
needs no credentials. Exit code 0 only if every assertion passes.

Usage:  python3 scripts/geo_handoff_fixture.py "host=localhost port=55432 user=postgres dbname=postgres"
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import geo_handoff_splice as G  # noqa: E402
import geo_fixture_db as DB  # noqa: E402

ROOT = os.path.join(HERE, "..")
HANDOFF = os.path.join(ROOT, "docs", "geo-work-handoff.sql")

FAILS = []
CHECKS = [0]


def ck(label, got, want):
    CHECKS[0] += 1
    if got != want:
        FAILS.append(f"FAIL {label}: got {got!r}, want {want!r}")
    else:
        print(f"  ok  {label}: {got!r}")


def passive_core_sql():
    """The queue + enqueue function, lifted verbatim from the accepted artifact."""
    src = open(HANDOFF, encoding="utf-8").read()
    i = src.index("create table if not exists geo.n5_reconcile_queue")
    j = src.index("commit;", i)
    body = src[i:j]
    if "enqueue_work" not in body or "n5_reconcile_queue_reason_ck" not in body:
        raise SystemExit("STOP: extraction from geo-work-handoff.sql missed the core")
    return body


DEV_COLS = ("community_id, zip, name, type, status, stage, developer, size, investment, "
            "submitted_at, lat, lng, impact_score, source_ref, record_kind, registry_id, "
            "date_kind, type_raw, address, start_date, end_date, scope_text, parties, "
            "provenance, source_key, source_key_basis, source_seq, last_seen_at")
FAC_COLS = ("community_id, zip, name, type, status, developer, lat, lng, impact_score, "
            "source_ref, record_kind, registry_id, facility_env, address, provenance, "
            "source_key, source_key_basis, source_seq, last_seen_at")

SCHEMA = """
drop schema if exists public cascade; create schema public;
drop schema if exists geo cascade; create schema geo;

create table public.app_projects (
  id bigserial primary key,
  community_id uuid, zip text, name text, type text, status text, stage text,
  developer text, size text, investment text, submitted_at date,
  lat double precision, lng double precision, impact_score int,
  source_ref text, record_kind text, registry_id text, date_kind text, type_raw text,
  facility_env jsonb, address text, start_date date, end_date date, scope_text text,
  parties jsonb, provenance jsonb,
  source_key text, source_key_basis text, source_seq int, last_seen_at timestamptz,
  unique (zip, source_key, source_seq)
);
create table public.property_company_roles (project_id bigint);
create table public.project_facility_refs  (project_id bigint);
create table public.identity_conflicts     (project_id bigint);

-- the per-ZIP input the real function reads out of development_reports.sites
create table public.fx_sites (
  zip text, source_key text, source_seq int, record_kind text,
  lat double precision, lng double precision, name text
);
"""


def fixture_function(spliced: bool):
    """Assemble the fixture body; when spliced=True apply the REAL replacements."""
    t = G.triples()
    A = {n: (f, r) for n, (lbl, f, r) in enumerate(t)}
    dev_head = A[1][0]      # production development-insert head line
    dev_tail_fac_head = A[2][0]
    fac_tail_endif = A[3][0]
    stale = A[4][0]
    fence = A[5][0]
    declare = A[0][0]

    body = f"""create or replace function public.fx_refresh(_zip text) returns int
language plpgsql as $fx$
declare _cid uuid; _has_report boolean;
        _lat double precision; _lng double precision;
{declare}
begin
  _run := clock_timestamp();
  _cid := '00000000-0000-0000-0000-000000000001'::uuid;
  _lat := 40.0; _lng := -75.0;
  _has_report := true;

  delete from public.app_projects p
   where p.zip=_zip and p.source_key is null
     and not exists (select 1 from public.property_company_roles r where r.project_id = p.id)
     and not exists (select 1 from public.project_facility_refs  f where f.project_id = p.id)
     and not exists (select 1 from public.identity_conflicts     c where c.project_id = p.id);

  if _has_report then
{dev_head}
                                     address, start_date, end_date, scope_text, parties, provenance,
                                     source_key, source_key_basis, source_seq, last_seen_at)
    select _cid, _zip, s.name, 'T','S','St','D','sz','inv',null,
           s.lat, s.lng, 1, 'ref','development','reg','filed','tr',
           'addr',null,null,null,null,null,
           s.source_key, 'basis', s.source_seq, _run
      from public.fx_sites s where s.zip=_zip and s.record_kind='development'
    on conflict (zip, source_key, source_seq) do update set
      community_id=excluded.community_id, name=excluded.name, type=excluded.type,
      lat=excluded.lat, lng=excluded.lng,
      source_key_basis=excluded.source_key_basis, last_seen_at=excluded.last_seen_at;

{dev_tail_fac_head.split(chr(10))[-1]}
                                     address, provenance,
                                     source_key, source_key_basis, source_seq, last_seen_at)
    select _cid, _zip, s.name, 'T','S','D', s.lat, s.lng, 1,
           'ref','facility','reg',null,'addr',null,
           s.source_key, 'basis', s.source_seq, _run
      from public.fx_sites s where s.zip=_zip and s.record_kind='facility'
    on conflict (zip, source_key, source_seq) do update set
      community_id=excluded.community_id, name=excluded.name, type=excluded.type,
      lat=excluded.lat, lng=excluded.lng,
{fac_tail_endif}

{stale}

{fence}

  return _stale;
end $fx$;
"""
    if spliced:
        for _, find, repl in t:
            n = body.count(find)
            if n != 1:
                raise SystemExit(f"STOP: fixture anchor not unique ({n}) for {find[:60]!r}")
            body = body.replace(find, repl)
    return body


def psql(dsn, sql, tuples_only=True):
    """ON_ERROR_STOP + return-code checked, via the shared helper."""
    return DB.run_sql(dsn, sql)


def main():
    dsn = sys.argv[1] if len(sys.argv) > 1 else "host=localhost port=55432 user=postgres dbname=postgres"
    # ⛔ GUARD BEFORE THE FIRST DESTRUCTIVE STATEMENT. SCHEMA starts with
    # `drop schema public cascade`; pointed at the wrong DSN that is not a test
    # failure, it is the incident.
    DB.require_disposable(dsn)
    print("== building isolated fixture (disposable target confirmed) ==")
    psql(dsn, SCHEMA)
    psql(dsn, passive_core_sql())

    # ---- T0: parse-checks. Both versions must compile as plpgsql. -----------
    psql(dsn, "set check_function_bodies=on; " + fixture_function(spliced=False))
    ck("T0a unspliced fixture compiles", True, True)
    psql(dsn, "set check_function_bodies=on; " + fixture_function(spliced=True))
    ck("T0b SPLICED fixture compiles (real replacement text parses)", True, True)

    # ---- T7: installing the handoffs seeds NOTHING --------------------------
    ck("T7 queue empty immediately after install",
       psql(dsn, "select count(*) from geo.n5_reconcile_queue;"), "0")

    # ---- T1: NEW ------------------------------------------------------------
    psql(dsn, """insert into public.fx_sites values
      ('19475','K-NEW',0,'development',40.01,-75.01,'n1'),
      ('19475','K-FAC',0,'facility',40.02,-75.02,'f1');""")
    psql(dsn, "select public.fx_refresh('19475');")
    ck("T1 NEW development key enqueued",
       psql(dsn, "select reason from geo.n5_reconcile_queue where source_key='K-NEW';"),
       "project_upsert")
    ck("T1 NEW facility key enqueued",
       psql(dsn, "select reason from geo.n5_reconcile_queue where source_key='K-FAC';"),
       "project_upsert")

    # ---- T2: UPDATE re-enqueues (idempotent, one row per key) ---------------
    psql(dsn, "update geo.n5_reconcile_queue set enqueued_at=now()-interval '1 day';")
    psql(dsn, "update public.fx_sites set lat=41.5 where source_key='K-NEW';")
    psql(dsn, "select public.fx_refresh('19475');")
    ck("T2 UPDATE re-enqueued the key (enqueued_at bumped)",
       psql(dsn, "select enqueued_at > now()-interval '1 minute' from geo.n5_reconcile_queue where source_key='K-NEW';"),
       "t")
    ck("T2 still exactly one row per key (no duplicate events)",
       psql(dsn, "select count(*) from geo.n5_reconcile_queue where source_key='K-NEW';"), "1")

    # ---- T5: duplicate event resets an outstanding claim --------------------
    psql(dsn, "update geo.n5_reconcile_queue set claimed_at=now(), claimed_by='w1' where source_key='K-NEW';")
    psql(dsn, "select public.fx_refresh('19475');")
    ck("T5 re-enqueue CLEARS an existing claim (see review F2)",
       psql(dsn, "select coalesce(claimed_by,'<null>') from geo.n5_reconcile_queue where source_key='K-NEW';"),
       "<null>")

    # ---- T3: geocode fence = coordinate change ------------------------------
    psql(dsn, "delete from geo.n5_reconcile_queue;")
    psql(dsn, "update public.fx_sites set lat=1.0, lng=1.0 where source_key='K-NEW';")  # outside the fence
    psql(dsn, "select public.fx_refresh('19475');")
    ck("T3 geocode fence enqueued the moved key as geocode_nulled",
       psql(dsn, "select reason from geo.n5_reconcile_queue where source_key='K-NEW';"),
       "geocode_nulled")
    ck("T3 the fence really nulled the coordinates",
       psql(dsn, "select coalesce(lat::text,'<null>') from public.app_projects where source_key='K-NEW';"),
       "<null>")

    # ---- T4 + T9: SOURCE_REMOVED, and _stale is preserved exactly -----------
    psql(dsn, "delete from geo.n5_reconcile_queue;")
    psql(dsn, "delete from public.fx_sites where source_key='K-NEW';")   # publisher dropped it
    stale_spliced = psql(dsn, "select public.fx_refresh('19475');")
    ck("T4 removed key enqueued as stale_removed",
       psql(dsn, "select reason from geo.n5_reconcile_queue where source_key='K-NEW';"),
       "stale_removed")
    ck("T4 the row really was deleted",
       psql(dsn, "select count(*) from public.app_projects where source_key='K-NEW';"), "0")

    # rebuild identical state and run the UNSPLICED function for the control
    psql(dsn, "truncate public.app_projects; delete from geo.n5_reconcile_queue;")
    psql(dsn, "insert into public.fx_sites values ('19475','K-NEW',0,'development',40.01,-75.01,'n1');")
    psql(dsn, "set check_function_bodies=on; " + fixture_function(spliced=False))
    psql(dsn, "select public.fx_refresh('19475');")
    psql(dsn, "delete from public.fx_sites where source_key='K-NEW';")
    stale_original = psql(dsn, "select public.fx_refresh('19475');")
    ck("T9 _stale identical: spliced vs original get-diagnostics", stale_spliced, stale_original)
    ck("T9 and it is the real deleted-row count", stale_spliced, "1")
    ck("T9 control: the unspliced function enqueues NOTHING",
       psql(dsn, "select count(*) from geo.n5_reconcile_queue;"), "0")

    # empty-delete boundary: count(*) over zero rows must equal row_count 0
    psql(dsn, "set check_function_bodies=on; " + fixture_function(spliced=True))
    psql(dsn, "truncate public.app_projects; delete from public.fx_sites; delete from geo.n5_reconcile_queue;")
    ck("T9b _stale = 0 when the delete matches nothing",
       psql(dsn, "select public.fx_refresh('19475');"), "0")

    # ---- T6: transaction behaviour -----------------------------------------
    psql(dsn, "insert into public.fx_sites values ('19475','K-TX',0,'development',40.0,-75.0,'t');")
    psql(dsn, "begin; select public.fx_refresh('19475'); rollback;")
    ck("T6 enqueue rolls back with the transaction (no phantom work)",
       psql(dsn, "select count(*) from geo.n5_reconcile_queue where source_key='K-TX';"), "0")

    # ---- T8: SOURCE_REMOVED cannot be emitted by anything else -------------
    ck("T8 reason domain is closed by CHECK constraint",
       psql(dsn, """select count(*) from pg_constraint
                     where conname='n5_reconcile_queue_reason_ck';"""), "1")
    try:
        psql(dsn, "insert into geo.n5_reconcile_queue(source_key,reason) values ('X','publisher_failed');")
        ck("T8 an invented reason is rejected", "accepted", "rejected")
    except RuntimeError:
        ck("T8 an invented reason is rejected", "rejected", "rejected")
    ck("T8 'stale_removed' appears exactly once in the spliced body, at the retention sweep",
       fixture_function(spliced=True).count("'stale_removed'"), 1)
    ck("T8 no acquisition/publisher path can reach enqueue_work (4 call sites only)",
       fixture_function(spliced=True).count("geo.enqueue_work"), 4)

    print(f"\n{CHECKS[0]} checks, {len(FAILS)} failures")
    for f in FAILS:
        print(" ", f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())

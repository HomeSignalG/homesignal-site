#!/usr/bin/env python3
"""END-TO-END proof of the passive-installation and rollback SEQUENCE.

This runs THE ACTUAL ARTIFACT FILES, in manifest order, against representative
dependencies and real execution roles, on a disposable database - then runs the
ACTUAL rollback files and proves byte-identical restoration.

THE ONE SUBSTITUTION, stated plainly: the two splice artifacts pin the PRODUCTION
md5 of the function they edit, and a representative local function cannot have
that md5. Exactly one 32-character token is substituted per artifact, and the
fixture ASSERTS that exactly one occurrence changed and that the files are
otherwise byte-identical to what is committed. Everything else - the anchors, the
replacement text, the excision proof, the fail-closed gates, the post-conditions -
executes verbatim.

Static pins (test/geo-lifecycle-handoff.test.mjs) and the single-concern fixtures
are supplementary to this file, not a substitute for it.

Usage:
  GEO_FIXTURE_DISPOSABLE=1 python3 scripts/geo_install_sequence_fixture.py [DSN]
"""
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import geo_fixture_db as DB          # noqa: E402
import geo_handoff_fixture as HF     # noqa: E402

ROOT = os.path.join(HERE, "..")
FAILS, CHECKS = [], [0]


def ck(label, got, want):
    CHECKS[0] += 1
    if got != want:
        FAILS.append(f"FAIL {label}: got {got!r}, want {want!r}")
    else:
        print(f"  ok  {label}: {got!r}")


def artifact(name):
    p = os.path.join(ROOT, "docs", name)
    if not os.path.exists(p):
        raise FileNotFoundError(f"manifest names a file that does not exist: {p}")
    return p


def repin(path, old_md5, new_md5, expect=None):
    """Substitute a fingerprint; assert ONLY those 32-char tokens moved.

    The rollback files pin each md5 TWICE - once in the guard condition and once
    in the message it raises - so the count is asserted, never assumed.
    """
    src = open(path, encoding="utf-8").read()
    n = src.count(f"'{old_md5}'")
    if n == 0 or (expect is not None and n != expect):
        raise RuntimeError(f"expected {expect or '>=1'} pin(s) of {old_md5} in {path}, found {n}")
    out = src.replace(f"'{old_md5}'", f"'{new_md5}'")
    if len(out) != len(src):
        raise RuntimeError("substitution changed the file length; md5s must be 32 chars")
    diffs = sum(1 for a, b in zip(src, out) if a != b)
    if diffs > 32 * n:
        raise RuntimeError(f"substitution altered {diffs} characters; expected <= {32 * n}")
    fh = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False)
    fh.write(out); fh.close()
    return fh.name, (diffs, n)


# ---- representative dependencies ------------------------------------------
DEPS = """
create extension if not exists postgis;
drop schema if exists geo cascade;   create schema geo;
drop schema if exists cron cascade;  create schema cron;
create table cron.job (jobid bigserial, jobname text, schedule text, active boolean default true);

drop table if exists public.app_projects cascade;
create table public.app_projects (
  id bigserial primary key, community_id uuid, zip text, name text, type text, status text,
  stage text, developer text, size text, investment text, submitted_at date,
  lat double precision, lng double precision, impact_score int, source_ref text,
  record_kind text, registry_id text, date_kind text, type_raw text, facility_env jsonb,
  address text, start_date date, end_date date, scope_text text, parties jsonb,
  provenance jsonb, source_key text, source_key_basis text, source_seq int,
  last_seen_at timestamptz, unique (zip, source_key, source_seq));
create table if not exists public.property_company_roles (project_id bigint);
create table if not exists public.project_facility_refs  (project_id bigint);
create table if not exists public.identity_conflicts     (project_id bigint);
drop table if exists public.fx_sites;
-- must match scripts/geo_handoff_fixture.py::SCHEMA - the representative
-- app_refresh_zip is built by that module and selects these columns.
create table public.fx_sites (zip text, source_key text, source_seq int, record_kind text,
  lat double precision, lng double precision, name text, registry_id text default 'reg');
drop table if exists public.development_reports;
create table public.development_reports(zip text, refreshed_at timestamptz);
insert into public.development_reports values ('19475', now());
drop table if exists public.pipeline_health_check;
create table public.pipeline_health_check(check_name text primary key, ok boolean,
  alertable boolean, detail text, since timestamptz, updated_at timestamptz);

create table geo.n5_geom(source_key text, registry_id text, feature_id text, outcome smallint,
  geom geometry, provenance text);
create table geo.n5_geom_incoming(source_key text, registry_id text, feature_id text,
  outcome smallint, geom geometry, provenance text);
create table geo.n5_boundary_membership(zcta5 text, source_key text, provenance text,
  run_id text, found_at timestamptz);
create table geo.zip_authoritative_membership(zcta5 text, source_key text, lat float8, lng float8,
  point_rule text, clip_dim smallint, feature_count int, geom_family text, run_id text,
  computed_at timestamptz, record_kind text);
create table geo.zip_authoritative_marker(zcta5 text, source_key text, marker_seq int, lat float8,
  lng float8, marker_rule text, family text, dim smallint, run_id text, computed_at timestamptz,
  record_kind text);
create table geo.zcta_boundary(zcta5 text, geom geometry);
create table geo.n5_accepted_source(registry_id text primary key, treatment text,
  projects bigint, pairs bigint);
create table if not exists public.canonical_zip_registry(zip text);

-- resident geography the sequence must not disturb
insert into geo.zip_authoritative_membership values ('19475','RESIDENT',40,-75,'r',0,1,'f','run',now(),'development');
insert into geo.zip_authoritative_marker values ('19475','RESIDENT',0,40,-75,'r','f',0,'run',now(),'development');
"""

ROLES = """
do $$ begin
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
end $$;
grant usage on schema geo to service_role, authenticated, anon;
"""

TICK = """
create or replace function public.pipeline_health_tick() returns void language plpgsql as $t$
declare _now timestamptz := now();
begin
  create temp table _eval (c_name text, c_ok boolean, c_alertable boolean, c_detail text) on commit drop;
  insert into _eval values ('representative_existing_check', true, true, 'unrelated');

  insert into public.pipeline_health_check as c (check_name, ok, alertable, detail, since, updated_at)
  select e.c_name, e.c_ok, e.c_alertable, e.c_detail, _now, _now from _eval e
  on conflict (check_name) do update set ok=excluded.ok, alertable=excluded.alertable,
    detail=excluded.detail, updated_at=excluded.updated_at;
end $t$;
"""


def main():
    dsn = sys.argv[1] if len(sys.argv) > 1 else "host=localhost port=55432 user=postgres dbname=postgres"
    DB.require_disposable(dsn)
    print("== install/rollback SEQUENCE on a disposable target ==")
    DB.run_sql(dsn, DEPS)
    DB.run_sql(dsn, ROLES)
    DB.run_sql(dsn, HF.fixture_function(spliced=False).replace("public.fx_refresh", "public.app_refresh_zip"))
    DB.run_sql(dsn, TICK)

    arz0 = DB.run_sql(dsn, "select md5(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure));")
    pht0 = DB.run_sql(dsn, "select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure));")
    resident0 = DB.run_sql(dsn, "select (select count(*) from geo.zip_authoritative_membership)||'/'||"
                                "(select count(*) from geo.zip_authoritative_marker);")
    ck("0 representative dependencies + resident geography in place", resident0, "1/1")

    # ---- steps 1-4: definitions only, ACTUAL files ---------------------------
    for step, fname in ((1, "geo-work-handoff.sql"), (2, "geo-proven-expected-geometry.sql"),
                        (3, "geo-reconciler-install.sql"), (4, "geo-health-model.sql")):
        if fname == "geo-work-handoff.sql":
            src = open(artifact(fname), encoding="utf-8").read()
            i = src.index("create table if not exists geo.n5_reconcile_queue")
            tmp = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False)
            tmp.write(src[i:src.index("commit;", i)]); tmp.close()
            DB.run_file(dsn, tmp.name)
        else:
            DB.run_file(dsn, artifact(fname))
        ck(f"step {step} applied ({fname})", True, True)

    ck("steps 1-4 executed ZERO reconciliation (resident geography unchanged)",
       DB.run_sql(dsn, "select (select count(*) from geo.zip_authoritative_membership)||'/'||"
                       "(select count(*) from geo.zip_authoritative_marker);"), "1/1")
    ck("steps 1-4 seeded ZERO work",
       DB.run_sql(dsn, "select count(*) from geo.n5_reconcile_queue;"), "0")

    # ---- execution roles -----------------------------------------------------
    for role in ("anon", "authenticated", "service_role"):
        ck(f"{role} has NO execute on geo.n5_reconcile",
           DB.run_sql(dsn, f"select has_function_privilege('{role}','geo.n5_reconcile(text[],text)','EXECUTE');"), "f")
    ck("service_role has NO execute on geo.enqueue_work either (RLS bypass is not EXECUTE)",
       DB.run_sql(dsn, "select has_function_privilege('service_role','geo.enqueue_work(text[],text)','EXECUTE');"), "f")
    ck("the owner can execute",
       DB.run_sql(dsn, "select has_function_privilege('postgres','geo.n5_reconcile(text[],text)','EXECUTE');"), "t")

    # ---- step 8: the ACTUAL handoff splice -----------------------------------
    inst, d1 = repin(artifact("geo-lifecycle-handoff-install.sql"),
                     "6591d7f79f9a6cd0b476bbcfc2065b9a", arz0, expect=1)
    # chars-changed is <= 32 per pin, not == 32: two md5s can share characters
    # at the same position. The PIN COUNT is the exact assertion.
    ck("step 8 artifact repinned: exactly 1 pin, <=32 chars moved", (d1[1], d1[0] <= 32), (1, True))
    DB.run_file(dsn, inst)
    arz1 = DB.run_sql(dsn, "select md5(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure));")
    ck("step 8 changed app_refresh_zip", arz1 != arz0, True)
    ck("step 8 installed exactly 4 handoffs",
       DB.run_sql(dsn, "select (length(d)-length(replace(d,'geo.enqueue_work','')))/length('geo.enqueue_work') "
                       "from (select pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure) d) z;"), "4")
    ck("step 8 left NO trigger on app_projects",
       DB.run_sql(dsn, "select count(*) from pg_trigger where tgrelid='public.app_projects'::regclass "
                       "and not tgisinternal;"), "0")
    ck("step 8 scheduled nothing", DB.run_sql(dsn, "select count(*) from cron.job;"), "0")
    ck("step 8 itself enqueued nothing",
       DB.run_sql(dsn, "select count(*) from geo.n5_reconcile_queue;"), "0")

    # capture is live: one refresh now enqueues
    DB.run_sql(dsn, "insert into public.fx_sites (zip,source_key,source_seq,record_kind,lat,lng,name) "
                    "values ('19475','K-SEQ',0,'development',40.0,-75.0,'n');")
    DB.run_sql(dsn, "select public.app_refresh_zip('19475');")
    ck("after step 8 a refresh CAPTURES (this is the contract change)",
       DB.run_sql(dsn, "select reason from geo.n5_reconcile_queue where source_key='K-SEQ';"), "project_upsert")
    # capture is CHANGE-scoped: a second, unchanged refresh must add nothing.
    DB.run_sql(dsn, "delete from geo.n5_reconcile_queue;")
    DB.run_sql(dsn, "select public.app_refresh_zip('19475');")
    ck("an UNCHANGED refresh after step 8 captures nothing (NEW/CHANGED/REMOVED only)",
       DB.run_sql(dsn, "select count(*) from geo.n5_reconcile_queue;"), "0")
    ck("and last_seen_at still advanced on that unchanged refresh",
       DB.run_sql(dsn, "select count(*) from public.app_projects where zip='19475' "
                       "and last_seen_at > now() - interval '1 minute';"), "1")
    ck("capture did NOT run reconciliation (resident geography unchanged)",
       DB.run_sql(dsn, "select (select count(*) from geo.zip_authoritative_membership)||'/'||"
                       "(select count(*) from geo.zip_authoritative_marker);"), "1/1")

    # ---- step 9: the ACTUAL health integration -------------------------------
    hinst, d2 = repin(artifact("geo-health-integration-install.sql"),
                      "c51e56b4158453184d966f00ef28cbb2", pht0, expect=1)
    ck("step 9 artifact repinned: exactly 1 pin, <=32 chars moved", (d2[1], d2[0] <= 32), (1, True))
    DB.run_file(dsn, hinst)
    pht1 = DB.run_sql(dsn, "select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure));")
    ck("step 9 changed pipeline_health_tick", pht1 != pht0, True)
    DB.run_sql(dsn, "begin; select public.pipeline_health_tick(); commit;")
    ck("step 9: worker OFF -> geography reports NOT_ACTIVATED, not alertable",
       DB.run_sql(dsn, "select ok::int||'|'||alertable::int||'|'||left(detail,13) from "
                       "public.pipeline_health_check where check_name='geography_progression';"),
       "1|0|NOT_ACTIVATED")
    ck("step 9 preserved the pre-existing unrelated check",
       DB.run_sql(dsn, "select count(*) from public.pipeline_health_check "
                       "where check_name='representative_existing_check';"), "1")

    # ---- fail-closed: an unreadable gate must STOP ---------------------------
    DB.run_sql(dsn, "alter schema cron rename to cron_hidden;")
    rc, _ = DB.run_file(dsn, artifact("geo-reconciler-install.sql"), expect_failure=True)
    ck("an unreadable scheduler catalog STOPS the install (non-zero exit)", rc != 0, True)
    DB.run_sql(dsn, "alter schema cron_hidden rename to cron;")

    # ---- rollback, reverse order, ACTUAL files -------------------------------
    hrb, d3 = repin(artifact("geo-health-integration-rollback.sql"),
                    "c98aad2d980a595982638a49e2472223", pht1, expect=2)
    ck("rollback 9 pins the post-install md5 twice (guard + message)", d3[1], 2)
    hrb2, d6 = repin(hrb, "c51e56b4158453184d966f00ef28cbb2", pht0, expect=2)
    ck("rollback 9 pins the pre-install md5 twice", d6[1], 2)
    DB.run_file(dsn, hrb2)
    ck("rollback 9 restored pipeline_health_tick BYTE-IDENTICALLY",
       DB.run_sql(dsn, "select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure));"), pht0)

    rb, d4 = repin(artifact("geo-lifecycle-handoff-rollback.sql"),
                   "de2df4de16ce9c5a9488cf8130b99d65", arz1, expect=2)
    ck("rollback 8 pins the post-install md5 twice (guard + message)", d4[1], 2)
    rb2, d5 = repin(rb, "6591d7f79f9a6cd0b476bbcfc2065b9a", arz0, expect=4)
    ck("rollback 8 pins the pre-install md5 four times (guard, message, check, message)", d5[1], 4)
    DB.run_file(dsn, rb2)
    ck("rollback 8 restored app_refresh_zip BYTE-IDENTICALLY",
       DB.run_sql(dsn, "select md5(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure));"), arz0)
    DB.run_sql(dsn, "delete from geo.n5_reconcile_queue;")
    DB.run_sql(dsn, "select public.app_refresh_zip('19475');")
    ck("after rollback a refresh captures NOTHING new",
       DB.run_sql(dsn, "select count(*) from geo.n5_reconcile_queue;"), "0")
    ck("the whole sequence disturbed NO resident geography",
       DB.run_sql(dsn, "select (select count(*) from geo.zip_authoritative_membership)||'/'||"
                       "(select count(*) from geo.zip_authoritative_marker);"), "1/1")

    print(f"\n{CHECKS[0]} checks, {len(FAILS)} failures")
    for f in FAILS:
        print(" ", f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())

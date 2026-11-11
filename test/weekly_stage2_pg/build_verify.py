#!/usr/bin/env python3
"""Build the READ-ONLY production verification queries for the queue-only release:

  docs/weekly-verify-after-1.sql   after docs/weekly-1-base.sql alone (also the recheck immediately before file 2)
  docs/weekly-verify-after-2.sql   after docs/weekly-2-topic-queue.sql as well

Each is one SELECT. It describes every object in schema public whose name is in the weekly namespace (tables, columns,
indexes, sequences, constraints, triggers, policies, functions with md5 of their bodies, and what anon / authenticated /
PUBLIC can reach) as a list of text items, and compares that list with the EXPECTED list embedded in the file. The expected
list is not typed by hand: it is the same description taken on a disposable Postgres after applying the release files, with
Supabase's default privileges emulated (new tables, sequences and functions in public are granted to anon, authenticated
and service_role), so a missing revoke shows here before it shows in production.

The queries print object names, definitions, checksums and COUNTS. They select no row of any table (only count(*)), no
e-mail address and no secret, because the workflow that runs them (db-read.yml) prints the result to a public log.

  python3 build_verify.py --write     rebuild both files from the disposable database named by PG* (it is wiped)
  python3 build_verify.py --check     fail if the committed files differ, then run the controls:
                                        after-1 passes on file 1 alone and fails once file 2 is there
                                        after-2 passes on files 1+2 and fails on file 1 alone
                                        after-2 fails on: a grant to anon, a replaced function body, a function that calls
                                        out, an inserted row, a dropped trigger, row security switched off, an extra table
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DOCS = os.path.join(ROOT, "docs")
FILE1, FILE2 = os.path.join(DOCS, "weekly-1-base.sql"), os.path.join(DOCS, "weekly-2-topic-queue.sql")
OUT = {1: os.path.join(DOCS, "weekly-verify-after-1.sql"), 2: os.path.join(DOCS, "weekly-verify-after-2.sql")}

# Supabase's own default privileges for objects created in public by postgres (CLAUDE.md, "A revoke from public on a
# Supabase function is not a lock"). Emulated so the expected access is measured under the same starting grants.
SUPABASE_DEFAULTS = """
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
"""

# One description of the weekly namespace, used to take the expected list AND inside the production query.
ACTUAL = r"""
  select 'table|' || c.relname || '|rls=' || c.relrowsecurity || '|force=' || c.relforcerowsecurity || '|owner=' || pg_get_userbyid(c.relowner) as item
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'weekly\_%'
  union all
  select 'other-relation|' || c.relkind::text || '|' || c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind not in ('r', 'i', 'S') and c.relname like 'weekly\_%'
  union all
  select 'sequence|' || c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'weekly\_%'
  union all
  select 'column|' || c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|notnull=' || a.attnotnull
         || '|default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || '|generated=' || a.attgenerated::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'weekly\_%'
  union all
  select 'index|' || i.indexname || '|' || i.indexdef from pg_indexes i where i.schemaname = 'public' and i.tablename like 'weekly\_%'
  union all
  select 'constraint|' || c.relname || '|' || k.conname || '|' || pg_get_constraintdef(k.oid)
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'weekly\_%'
  union all
  select 'trigger|' || c.relname || '|' || t.tgname || '|enabled=' || t.tgenabled::text || '|' || pg_get_triggerdef(t.oid)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal and c.relname like 'weekly\_%'
  union all
  select 'policy|' || p.tablename || '|' || p.policyname || '|' || p.cmd || '|' || array_to_string(p.roles, ',')
    from pg_policies p where p.schemaname = 'public' and p.tablename like 'weekly\_%'
  union all
  select 'function|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|returns=' || pg_get_function_result(p.oid)
         || '|lang=' || l.lanname || '|definer=' || p.prosecdef || '|volatility=' || p.provolatile::text
         || '|config=' || coalesce(array_to_string(p.proconfig, ','), '') || '|owner=' || pg_get_userbyid(p.proowner) || '|body_md5=' || md5(p.prosrc)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.proname ~ '^(weekly_|hs_weekly_|_wk_)'
  union all
  -- what a visitor role can reach, PUBLIC grants included (has_*_privilege counts them)
  select 'access|table|' || c.relname || '|' || r.role || '|' || coalesce((select string_agg(pr, ',' order by pr)
           from unnest(array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) pr where has_table_privilege(r.role, c.oid, pr)), 'none')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join (values ('anon'), ('authenticated')) r(role)
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'weekly\_%'
  union all
  select 'access|sequence|' || c.relname || '|' || r.role || '|' || coalesce((select string_agg(pr, ',' order by pr)
           from unnest(array['SELECT', 'UPDATE', 'USAGE']) pr where has_sequence_privilege(r.role, c.oid, pr)), 'none')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join (values ('anon'), ('authenticated')) r(role)
    where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'weekly\_%'
  union all
  select 'access|function|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || r.role || '|'
         || case when has_function_privilege(r.role, p.oid, 'EXECUTE') then 'EXECUTE' else 'none' end
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join (values ('anon'), ('authenticated')) r(role)
    where n.nspname = 'public' and p.proname ~ '^(weekly_|hs_weekly_|_wk_)'
"""

QUERY = r"""-- Tab 20 · Weekly Report: READ-ONLY PRODUCTION VERIFICATION, %(title)s.
-- GENERATED by test/weekly_stage2_pg/build_verify.py from a disposable database the release files were applied to
-- (Supabase default privileges emulated). Do not edit by hand.
--
-- One SELECT. It changes nothing. It prints object names, definitions, checksums and COUNTS. It reads no row of any
-- table (count(*) only), no e-mail address and no secret.
--
-- Read "verdict": 'pass' means the weekly objects in production are exactly the expected ones (same definitions, same
-- function bodies, same access for anon and authenticated), every weekly table is empty, nothing reachable by a visitor,
-- every definer function pins its search path, every admin function still checks the admin list, and no weekly function
-- calls out, reads a secret or touches storage. Anything else lists what is missing or unexpected.
-- (the expected items are plain string literals: standard_conforming_strings must be on, which the query checks)
with expected(item) as (
  select unnest(%(expected)s)
), actual(item) as (%(actual)s), fns as (
  select p.proname, p.prosecdef, p.proconfig, p.prosrc, p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ~ '^(weekly_|hs_weekly_|_wk_)'
), tabs as (
  select c.relname, c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'weekly\_%%'
), chk as (
  select
    (select coalesce(jsonb_agg(e.item order by e.item), '[]'::jsonb) from expected e where not exists (select 1 from actual a where a.item = e.item)) as missing,
    (select coalesce(jsonb_agg(a.item order by a.item), '[]'::jsonb) from actual a where not exists (select 1 from expected e where e.item = a.item)) as unexpected,
    (select count(*) from expected) as expected_items, (select count(*) from actual) as actual_items,
    -- every weekly table must be empty: nothing was inserted by applying the files
    (select coalesce(jsonb_object_agg(t.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%%I', t.relname), false, true, '')))[1]::text::bigint), '{}'::jsonb) from tabs t) as row_counts,
    (select coalesce(jsonb_agg(a.item order by a.item), '[]'::jsonb) from actual a where a.item like 'access|%%|anon|%%' and a.item not like '%%|none') as anon_can_reach,
    (select coalesce(jsonb_agg(a.item order by a.item), '[]'::jsonb) from actual a where a.item like 'access|%%|authenticated|%%' and a.item not like '%%|none') as authenticated_can_reach,
    (select coalesce(jsonb_agg(t.relname order by t.relname), '[]'::jsonb) from tabs t join pg_class c on c.oid = t.oid where not c.relrowsecurity) as tables_without_row_security,
    (select coalesce(jsonb_agg(f.proname order by f.proname), '[]'::jsonb) from fns f
      where f.prosecdef and not exists (select 1 from unnest(coalesce(f.proconfig, '{}')) s where s like 'search_path=%%')) as definer_without_search_path,
    (select coalesce(jsonb_agg(f.proname order by f.proname), '[]'::jsonb) from fns f where f.proname like 'hs\_weekly\_%%' and f.prosrc not like '%%_hs_is_admin()%%') as admin_functions_without_admin_check,
    (select coalesce(jsonb_agg(f.proname order by f.proname), '[]'::jsonb) from fns f where f.proname like 'hs\_weekly\_%%' and not f.prosecdef) as admin_functions_not_definer,
    (select coalesce(jsonb_agg(f.proname order by f.proname), '[]'::jsonb) from fns f
      where f.prosrc ~* '(net\.http|pg_net|http_post|http_get|vault\.|decrypted_secrets|storage\.|api\.github|dblink)') as functions_that_call_out_or_read_secrets,
    -- informational: the migration runner's own ledger (not part of files 1 and 2)
    jsonb_build_object('migration_runs', to_regclass('public.migration_runs') is not null, 'migration_totp_used', to_regclass('public.migration_totp_used') is not null,
                       'migration_state', to_regprocedure('public.migration_state(text)') is not null) as runner_ledger_present,
    -- still true before file 2 is applied
    (to_regprocedure('public._hs_is_admin()') is not null and to_regclass('public.alert_topic_catalog') is not null
      and exists (select 1 from pg_constraint c where c.conrelid = to_regclass('public.alert_topic_catalog') and c.contype in ('p', 'u')
        and (select array_agg(a.attname::text order by a.attname::text) from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) = array['stream', 'topic'])) as prerequisites_still_present
)
select jsonb_pretty(jsonb_build_object(
  'checked_at', now(), 'check', '%(title)s',
  'expected_items', k.expected_items, 'actual_items', k.actual_items, 'missing', k.missing, 'unexpected', k.unexpected,
  'row_counts', k.row_counts, 'anon_can_reach', k.anon_can_reach, 'authenticated_can_reach', k.authenticated_can_reach,
  'tables_without_row_security', k.tables_without_row_security, 'definer_without_search_path', k.definer_without_search_path,
  'admin_functions_without_admin_check', k.admin_functions_without_admin_check, 'admin_functions_not_definer', k.admin_functions_not_definer,
  'functions_that_call_out_or_read_secrets', k.functions_that_call_out_or_read_secrets,
  'runner_ledger_present', k.runner_ledger_present, 'prerequisites_still_present', k.prerequisites_still_present,
  'verdict', case when k.missing = '[]'::jsonb and k.unexpected = '[]'::jsonb and k.expected_items = k.actual_items
      and not exists (select 1 from jsonb_each_text(k.row_counts) r where r.value <> '0')
      and k.anon_can_reach = '[]'::jsonb and k.tables_without_row_security = '[]'::jsonb and k.definer_without_search_path = '[]'::jsonb
      and k.admin_functions_without_admin_check = '[]'::jsonb and k.admin_functions_not_definer = '[]'::jsonb
      and k.functions_that_call_out_or_read_secrets = '[]'::jsonb and k.prerequisites_still_present
      and current_setting('standard_conforming_strings') = 'on'
    then 'pass' else 'fail: see missing, unexpected and the lists above' end)) as verification
from chk k;
"""
TITLES = {1: "after docs/weekly-1-base.sql (and before docs/weekly-2-topic-queue.sql)", 2: "after docs/weekly-2-topic-queue.sql (queue-only release complete)"}


def psql(*args, check=True, stdin=None):
    r = subprocess.run(["psql", "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", *args], capture_output=True, text=True, input=stdin)
    if check and r.returncode:
        sys.exit("psql failed: " + r.stderr[-2000:])
    return r


def reset():
    psql("-c", "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade; "
               "drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;")
    psql("-f", os.path.join(HERE, "fixture.sql"))
    psql("-c", SUPABASE_DEFAULTS)


def state():
    out = psql("-c", "select coalesce(jsonb_agg(item order by item), '[]')::text from (" + ACTUAL + ") s").stdout
    return json.loads(out)


def arr(items):
    return "array[\n    " + ",\n    ".join("'%s'" % i.replace("'", "''") for i in items) + "]::text[]"


def build(n, items):
    assert items, "nothing to expect?"
    return QUERY % {"title": TITLES[n], "expected": arr(items), "actual": ACTUAL.rstrip() + "\n"}


def verdict(path):
    o = json.loads(psql("-f", path).stdout)
    return o["verdict"], o


def main():
    mode = sys.argv[1]
    reset()
    psql("-f", FILE1)
    s1 = state()
    psql("-f", FILE2)
    s2 = state()
    text = {1: build(1, s1), 2: build(2, s2)}
    if mode == "--write":
        for n in (1, 2):
            open(OUT[n], "w").write(text[n])
            print("wrote", os.path.relpath(OUT[n], ROOT), "(%d expected items)" % len(s1 if n == 1 else s2))
        return
    for n in (1, 2):
        if open(OUT[n]).read() != text[n]:
            sys.exit("FAIL: %s is not what the release files produce; run build_verify.py --write" % os.path.relpath(OUT[n], ROOT))

    def want(label, path, ok, show=None):
        v, o = verdict(path)
        if (v == "pass") != ok:
            sys.exit("FAIL: %s: verdict %r (missing %s, unexpected %s)" % (label, v, o["missing"][:3], o["unexpected"][:3]))
        if show and not o[show]:
            sys.exit("FAIL: %s: the %s list is empty, so that check did not see it" % (label, show))
        print("  verify: %s -> %s" % (label, "pass" if ok else "fail, as it must"))

    # database now holds files 1+2 (applied once). Applying both again must not move anything.
    psql("-f", FILE1)
    psql("-f", FILE2)
    want("after-2 on files 1+2, applied twice", OUT[2], True)
    want("after-1 once file 2 is there", OUT[1], False)
    reset()
    psql("-f", FILE1)
    want("after-1 on file 1 alone", OUT[1], True)
    want("after-2 on file 1 alone", OUT[2], False)
    controls = [
        ("a table granted to anon", "grant select on public.weekly_topic_leads to anon", "anon_can_reach"),
        ("a function granted to PUBLIC", "grant execute on function public.hs_weekly_topic_queue(uuid) to public", "anon_can_reach"),
        ("a replaced function body", "create or replace function public.weekly_sha256(t text) returns text language sql immutable strict parallel safe as $f$ select 'x'::text $f$", "unexpected"),
        ("a weekly function that calls out", "create function public.weekly_ping() returns bigint language sql as $f$ select net.http_post('https://example.invalid', '{}'::jsonb, '{}'::jsonb, 1000) $f$", "functions_that_call_out_or_read_secrets"),
        ("an inserted row", "insert into public.weekly_runs (kind, topic, requested_by) values ('angles', 'Air Quality', 'control')", None),
        ("a dropped trigger", "drop trigger weekly_topic_leads_guard on public.weekly_topic_leads", "missing"),
        ("row security switched off", "alter table public.weekly_editions disable row level security", "tables_without_row_security"),
        ("an extra weekly table", "create table public.weekly_extra (id int)", "unexpected"),
        ("an admin function without its admin check", None, "admin_functions_without_admin_check"),
        ("a definer function with no pinned search path", "alter function public.hs_weekly_topic_queue(uuid) reset search_path", "definer_without_search_path"),
    ]
    for label, sql, show in controls:
        reset()
        psql("-f", FILE1)
        psql("-f", FILE2)
        if sql is None:
            src = psql("-c", "select pg_get_functiondef('public.hs_weekly_edition_close(uuid,text)'::regprocedure)").stdout
            assert "_hs_is_admin()" in src
            sql = src.replace("_hs_is_admin()", "current_user")
        r = psql("-c", sql, check=False)
        if r.returncode:
            sys.exit("FAIL: control %r could not be set up: %s" % (label, r.stderr[-400:]))
        want("after-2 with " + label, OUT[2], False, show)
    reset()
    psql("-f", FILE1)
    psql("-f", FILE2)


if __name__ == "__main__":
    main()

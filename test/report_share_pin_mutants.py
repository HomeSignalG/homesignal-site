#!/usr/bin/env python3
"""Mutations of the INPUTS that test/report-share-structure.test.mjs (and the one pin added to
test/report-snapshot-structure.test.mjs) read. Each MUST turn the NAMED pin red: a pin that never fails is not a pin, and a
mutation that trips some other pin proves nothing about this one.

Run:  python3 test/report_share_pin_mutants.py
Nothing in the repository is edited. For each mutation a SHADOW tree is built in a temporary directory: every directory the
pins scan is a symlink to the real one, except along the path to the file being mutated, which is rebuilt with that one file
replaced by its mutated copy. The test file itself is a real COPY inside the shadow tree (it finds its root from its own
location), so it reads the mutated tree and the repository stays byte-identical. The unmutated shadow must pass first (the
control: a shadow that cannot pass would make every kill meaningless). An anchor that does not match exactly the stated number of times is a harness
failure, never a pass. Exit 1 if a mutation survives, turns the wrong pin red, or the harness fails.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARE_TEST = 'test/report-share-structure.test.mjs'
SNAP_TEST = 'test/report-snapshot-structure.test.mjs'
TOP = ['docs', 'test', '.github', 'supabase', 'lib', 'scripts', 'partials', 'bluesky']

SQL = 'docs/report-share.sql'
MOD = 'supabase/functions/_shared/report-share.ts'
SUITE = 'test/report_share_pg/suite.sql'
MUT = 'test/report_share_pg/mutate.py'
RUN = 'test/report_share_pg/run.sh'
WF = '.github/workflows/report-snapshot-suite.yml'
MODMUT = 'test/report_share_module_mutants.py'

# anchors in the SQL
APPEND = "\n-- ROLLBACK (this file only;"       # statements are appended just before the rollback footer (still code, still scanned)
ROLLBACK_MARK = "-- ROLLBACK (this file only;"
GUARD_EXPIRY = "       and new.expires_at is not distinct from old.expires_at then\n"
RESOLVE_REVOKED = "  elsif s.revoked_at is not null then\n    return query select 'REVOKED'::text, null::uuid;\n"
RESOLVE_EXPIRED = "  elsif s.expires_at is not null and s.expires_at <= now() then\n    return query select 'EXPIRED'::text, null::uuid;\n"
EVENT_INSERT_CREATED = "  insert into public.report_share_event (share_id, kind) values (v_id, 'created');\n"


def appended(stmt):
    """Insert a statement just before the rollback footer."""
    return (ROLLBACK_MARK, stmt + "\n" + ROLLBACK_MARK, 1)


# name: (the test that must fail, {path: edits} or ADD file, [pin ids that must turn red])
M = {}


def mut(name, test, files, pins):
    M[name] = (test, files, pins)


# ---- 0. located -----------------------------------------------------------------------------------------------------
mut('sql_comment_swallows_a_message', SHARE_TEST, {SQL: [("raise exception 'report_share may only be revoked, once (% refused)', tg_op;", "raise exception 'report_share -- may only be revoked, once (% refused)', tg_op;", 1)]}, ['0c'])
mut('table_not_found', SHARE_TEST, {SQL: [("create table if not exists public.report_share_event (", "create table if not exists public.report_share_events (", 1)]}, ['0b'])
# ---- 1. the token is never stored; the identity is the writer's ---------------------------------------------------------------
mut('plaintext_token_column', SHARE_TEST, {SQL: [("  token_sha256 text        not null,\n", "  token_sha256 text        not null,\n  token        text,\n", 1)]}, ['1', '2b'])
mut('hash_not_unique', SHARE_TEST, {SQL: [("  constraint report_share_hash_unique           unique (token_sha256),\n", "", 1)]}, ['1b'])
mut('hash_shape_loosened', SHARE_TEST, {SQL: [("'^[0-9a-f]{64}$'", "'^[0-9a-f]+$'", 1)]}, ['1b'])
mut('share_id_has_a_default', SHARE_TEST, {SQL: [("  share_id     uuid        primary key,\n", "  share_id     uuid        primary key default gen_random_uuid(),\n", 1)]}, ['1c'])
mut('writer_takes_an_id', SHARE_TEST, {SQL: [("p_expires_at timestamptz default null)\nreturns uuid", "p_expires_at timestamptz default null, p_share_id uuid default null)\nreturns uuid", 1)]}, ['1d', '1e'])
mut('writer_defaults_the_expiry', SHARE_TEST, {SQL: [("values (v_id, p_report, p_token_sha256, p_expires_at);", "values (v_id, p_report, p_token_sha256, coalesce(p_expires_at, now() + interval '30 days'));", 1)]}, ['1f'])
# ---- 2. nothing that could identify a client, an owner or a visitor ------------------------------------------------------------
mut('event_gets_free_text', SHARE_TEST, {SQL: [("  kind     text        not null,\n", "  kind     text        not null,\n  note     text,\n", 1)]}, ['2', '2c'])
mut('share_gets_an_owner', SHARE_TEST, {SQL: [("  revoked_at   timestamptz,\n", "  revoked_at   timestamptz,\n  owner_id     uuid,\n", 1)]}, ['1', '2b'])
mut('event_kind_open', SHARE_TEST, {SQL: [("check (kind in ('created', 'revoked'))", "check (kind in ('created', 'revoked', 'viewed'))", 1)]}, ['2c'])
# ---- 3. one writer for each thing ---------------------------------------------------------------------------------------------------
mut('second_insert_of_a_share', SHARE_TEST, {SQL: [appended("insert into public.report_share (share_id, report_id, token_sha256) select gen_random_uuid(), report_id, token_sha256 from public.report_share where false;")]}, ['3'])
mut('second_update_of_a_share', SHARE_TEST, {SQL: [appended("update public.report_share set expires_at = null where false;")]}, ['3b'])
mut('third_event_insert', SHARE_TEST, {SQL: [appended("insert into public.report_share_event (share_id, kind) select share_id, 'created' from public.report_share where false;")]}, ['3c'])
mut('a_delete_statement', SHARE_TEST, {SQL: [appended("delete from public.report_share where false;")]}, ['3d'])
mut('revoke_does_not_lock_the_row', SHARE_TEST, {SQL: [("where share_id = p_share for update;", "where share_id = p_share;", 1)]}, ['3e'])
mut('revoke_of_unknown_is_quiet', SHARE_TEST, {SQL: [("    raise exception 'report_share: no such share' using errcode = '23503';\n", "    return false;\n", 1)]}, ['3e'])
mut('a_function_calls_another', SHARE_TEST, {SQL: [(EVENT_INSERT_CREATED, EVENT_INSERT_CREATED + "  perform now();\n", 1)]}, ['3f'])
# ---- 4. the guard --------------------------------------------------------------------------------------------------------------------
mut('guard_lets_the_expiry_move', SHARE_TEST, {SQL: [(GUARD_EXPIRY, "       then\n", 1)]}, ['4'])
mut('guard_allows_a_second_revoke', SHARE_TEST, {SQL: [("    if old.revoked_at is null and new.revoked_at is not null\n", "    if new.revoked_at is not null\n", 1)]}, ['4'])
mut('event_guard_can_return', SHARE_TEST, {SQL: [("  raise exception 'report_share_event is append-only (% refused)', tg_op;\n", "  if tg_op = 'DELETE' then return old; end if;\n  raise exception 'report_share_event is append-only (% refused)', tg_op;\n", 1)]}, ['4b'])
mut('share_truncate_trigger_dropped', SHARE_TEST, {SQL: [("create or replace trigger report_share_no_truncate\n  before truncate on public.report_share\n  for each statement execute function public.report_share_guard();\n", "", 1)]}, ['4c'])
mut('event_row_trigger_dropped', SHARE_TEST, {SQL: [("create or replace trigger report_share_event_no_change\n  before update or delete on public.report_share_event\n  for each row execute function public.report_share_event_immutable();\n", "", 1)]}, ['4c', '9b'])
# ---- 5. what the tables refer to ------------------------------------------------------------------------------------------------------
mut('reference_cascades', SHARE_TEST, {SQL: [("references public.report_snapshot (report_id),\n", "references public.report_snapshot (report_id) on delete cascade,\n", 1)]}, ['5'])
mut('a_third_reference', SHARE_TEST, {SQL: [("  revoked_at   timestamptz,\n", "  revoked_at   timestamptz,\n  parent_id    uuid references public.report_share (share_id),\n", 1)]}, ['1', '5'])
# ---- 6. resolve is the one decision -------------------------------------------------------------------------------------------------------
mut('resolve_is_volatile', SHARE_TEST, {SQL: [("language plpgsql stable security definer set search_path = public, pg_temp", "language plpgsql security definer set search_path = public, pg_temp", 1)]}, ['6'])
mut('resolve_returns_a_body', SHARE_TEST, {SQL: [("returns table (status text, report_id uuid)", "returns table (status text, report_id uuid, body text)", 1)]}, ['6'])
mut('resolve_writes_the_audit_log', SHARE_TEST, {SQL: [("    return query select 'ACTIVE'::text, s.report_id;\n", "    insert into public.report_share_event (share_id, kind) values (s.share_id, 'created');\n    return query select 'ACTIVE'::text, s.report_id;\n", 1)]}, ['6b', '3c'])
mut('expired_beats_revoked', SHARE_TEST, {SQL: [(RESOLVE_REVOKED + RESOLVE_EXPIRED, RESOLVE_EXPIRED + RESOLVE_REVOKED, 1)]}, ['6c'])
mut('expiry_boundary_exclusive', SHARE_TEST, {SQL: [("s.expires_at <= now() then", "s.expires_at < now() then", 1)]}, ['6c'])
mut('a_fifth_status', SHARE_TEST, {SQL: [("  else\n    return query select 'ACTIVE'::text, s.report_id;\n", "  elsif s.share_id is null then\n    return query select 'PENDING'::text, null::uuid;\n  else\n    return query select 'ACTIVE'::text, s.report_id;\n", 1)]}, ['6c', '6d'])
mut('report_for_a_dead_link', SHARE_TEST, {SQL: [("return query select 'REVOKED'::text, null::uuid;", "return query select 'REVOKED'::text, s.report_id;", 1)]}, ['6d'])
mut('hash_is_normalised', SHARE_TEST, {SQL: [("where token_sha256 = p_token_sha256;\n  if not found", "where token_sha256 = lower(p_token_sha256);\n  if not found", 1)]}, ['6e'])
# ---- 7. this file reaches into nothing it depends on ---------------------------------------------------------------------------------------
mut('reads_the_snapshot', SHARE_TEST, {SQL: [appended("select count(*) from public.report_snapshot;")]}, ['7'])
mut('calls_the_snapshot_writer', SHARE_TEST, {SQL: [appended("select public.report_snapshot_issue('{}', '', '', '{}');")]}, ['7', '10c'])
mut('names_the_private_layer', SHARE_TEST, {SQL: [appended("select public.report_private_context_read('00000000-0000-4000-8000-000000000000');")]}, ['7b'])
mut('alters_the_snapshot', SHARE_TEST, {SQL: [appended("alter table public.report_snapshot add column owner_id uuid;")]}, ['7', '7c'])
mut('arms_a_schedule', SHARE_TEST, {SQL: [appended("select cron.schedule('x', '* * * * *', 'select 1');")]}, ['7d'])
mut('a_city_literal', SHARE_TEST, {SQL: [appended("select 'nyc';")]}, ['7e'])
# ---- 8. lock-down ----------------------------------------------------------------------------------------------------------------------
mut('no_rls_on_events', SHARE_TEST, {SQL: [("alter table public.report_share_event enable row level security;\n", "", 1)]}, ['8'])
mut('table_privileges_not_revoked', SHARE_TEST, {SQL: [("revoke all on public.report_share       from public, anon, authenticated, service_role;\n", "", 1)]}, ['8'])
mut('service_role_can_insert', SHARE_TEST, {SQL: [appended("grant insert on public.report_share to service_role;")]}, ['8b'])
mut('anon_can_read_events', SHARE_TEST, {SQL: [("grant select on public.report_share_event to service_role;\n", "grant select on public.report_share_event to service_role, anon;\n", 1)]}, ['8b'])
mut('lock_loop_matches_the_wrong_prefix', SHARE_TEST, {SQL: [("like 'report\\_share\\_%'", "like 'report\\_snapshot\\_%'", 1)]}, ['8c'])
mut('a_second_function_grant', SHARE_TEST, {SQL: [appended("grant execute on function public.report_share_resolve(text) to authenticated;")]}, ['8c'])
mut('revoke_not_security_definer', SHARE_TEST, {SQL: [("create or replace function public.report_share_revoke(p_share uuid)\nreturns boolean\nlanguage plpgsql security definer set search_path = public, pg_temp", "create or replace function public.report_share_revoke(p_share uuid)\nreturns boolean\nlanguage plpgsql set search_path = public, pg_temp", 1)]}, ['8d'])
# ---- 9. additive, reversible ------------------------------------------------------------------------------------------------------------------
mut('precondition_removed', SHARE_TEST, {SQL: [("    raise exception 'report_share: apply docs/report-snapshot.sql first (a share points at a stored report)';\n", "    null;\n", 1)]}, ['9'])
mut('table_not_idempotent', SHARE_TEST, {SQL: [("create table if not exists public.report_share_event (", "create table public.report_share_event (", 1)]}, ['9b', '0b'])
mut('rollback_forgets_the_tables', SHARE_TEST, {SQL: [("-- drop table if exists public.report_share_event, public.report_share;\n", "", 1)]}, ['9c'])
# ---- 10. NO CALLER -------------------------------------------------------------------------------------------------------------------------------
mut('a_script_creates_a_share', SHARE_TEST, {'scripts/_pin_probe.mjs': "const r = await rpc('report_share_create', {});\n"}, ['10'])
mut('a_script_imports_the_module', SHARE_TEST, {'scripts/_pin_probe.mjs': "import { newShareToken } from '../supabase/functions/_shared/report-share.ts';\n"}, ['10b'])
mut('the_module_calls_the_snapshot_writer', SHARE_TEST, {MOD: [("export async function hashShareToken", "const _x = 'issueSnapshot';\n\nexport async function hashShareToken", 1)]}, ['10c'])
# ---- 11. the module does three things and nothing else ------------------------------------------------------------------------------------------------
mut('module_imports_something', SHARE_TEST, {MOD: [("/** Bytes of randomness in a token", "import { sha256Hex } from './report-snapshot.ts';\n\n/** Bytes of randomness in a token", 1)]}, ['11'])
mut('module_makes_a_request', SHARE_TEST, {MOD: [("export async function hashShareToken", "export const probe = () => fetch('x');\n\nexport async function hashShareToken", 1)]}, ['11b', '11d'])
mut('module_builds_a_url', SHARE_TEST, {MOD: [("export async function hashShareToken", "export const shareUrl = (t: string) => 'https://example.invalid/s#' + t;\n\nexport async function hashShareToken", 1)]}, ['11c', '11d'])
mut('module_takes_an_address', SHARE_TEST, {MOD: [("export function isWellFormedToken(token: unknown)", "export function isWellFormedToken(token: unknown, address?: string)", 1)]}, ['11c'])
mut('module_exports_a_helper', SHARE_TEST, {MOD: [("function toBase64Url(", "export function toBase64Url(", 1)]}, ['11d'])
mut('module_uses_math_random', SHARE_TEST, {MOD: [("  crypto.getRandomValues(bytes);", "  crypto.getRandomValues(bytes);\n  void Math.random();", 1)]}, ['11e'])
mut('module_names_the_snapshot_in_a_comment', SHARE_TEST, {MOD: [("// This file does three things", "// It never touches report_snapshot.\n// This file does three things", 1)]}, ['11f'])
# ---- 12. the amended guard on the snapshot -------------------------------------------------------------------------------------------------------------------
mut('snapshot_allow_list_loses_the_share_file', SHARE_TEST, {SNAP_TEST: [("const SHARE_SQL = 'docs/report-share.sql';", "const SHARE_SQL = 'docs/nothing.sql';", 1)]}, ['12'])
mut('share_sql_reads_the_snapshot', SNAP_TEST, {SQL: [appended("select count(*) from public.report_snapshot;")]}, ['3d'])
mut('share_sql_names_the_snapshot_twice', SNAP_TEST, {SQL: [appended("comment_free_probe public.report_snapshot (report_id);")]}, ['3d'])
mut('another_file_names_the_snapshot', SNAP_TEST, {'scripts/_pin_probe.mjs': "const q = 'select * from report_snapshot';\n"}, ['3'])
# ---- 13. the suite, its mutations and its workflow are real and wired -------------------------------------------------------------------------------------------
mut('suite_loses_its_checks', SHARE_TEST, {SUITE: [("pg_temp._ck('C0", "pg_temp._xk('C0", None)]}, ['13'])
mut('mutations_duplicated', SHARE_TEST, {MUT: [("    'hash_not_unique': [", "    'plaintext_token_column': [", 1)]}, ['13b', '13c'])
mut('an_audit_mutation_removed', SHARE_TEST, {MUT: [("    'truncate_allowed': [", "    'truncate_is_allowed_x': [", 1)]}, ['13c'])
mut('harness_accepts_a_crash', SHARE_TEST, {RUN: [("CRASHED", "BROKEN", None)]}, ['13d'])
mut('suite_stops_giving_roles_their_privileges', SHARE_TEST, {SUITE: [("alter role service_role bypassrls;", "select 1;", 1)]}, ['13e'])
mut('suite_setup_can_crash', SHARE_TEST, {SUITE: [("create function pg_temp._share(", "create function pg_temp._shared(", 1)]}, ['13f'])
mut('workflow_drops_the_step', SHARE_TEST, {WF: [("bash test/report_share_pg/run.sh", "bash test/report_share_pg/skipped.sh", None)]}, ['13g'])
mut('module_mutants_shrink', SHARE_TEST, {MODMUT: [("    'weak_rng': [", "    'weak_rng': (", 1), ("    'rng_not_called': [", "    'rng_not_called': (", 1), ("    'half_the_bytes_random': [", "    'half_the_bytes_random': (", 1), ("    'short_token_16_bytes': [", "    'short_token_16_bytes': (", 1)]}, ['13h'])


def edit(text, edits, name):
    for old, new, count in edits:
        found = text.count(old)
        if count is not None and found != count:
            raise SystemExit('HARNESS %s — anchor matched %d time(s), expected %d: %r' % (name, found, count, old[:70]))
        if found == 0:
            raise SystemExit('HARNESS %s — anchor not found: %r' % (name, old[:70]))
        if old == new:
            raise SystemExit('HARNESS %s — the mutation changes nothing' % name)
        text = text.replace(old, new)
    return text


def shadow(dst, overrides):
    """Build the shadow tree: symlinks everywhere except along the paths in `overrides` (path -> full text)."""
    chain = set()
    for path in overrides:
        parts = Path(path).parts
        for i in range(1, len(parts)):
            chain.add(str(Path(*parts[:i])))

    def build(rel):
        src, out = ROOT / rel, dst / rel
        out.mkdir(parents=True, exist_ok=True)
        existing = set(os.listdir(src)) if src.exists() else set()
        for child in sorted(existing):
            crel = str(Path(rel) / child)
            if crel in overrides:
                continue
            if crel in chain:
                build(crel)
            else:
                os.symlink(src / child, out / child)
        for path, text in overrides.items():
            if str(Path(path).parent) == rel:
                (dst / path).write_text(text)

    for top in TOP:
        if top in chain or any(p.startswith(top + '/') for p in overrides):
            build(top)
        else:
            os.symlink(ROOT / top, dst / top)
    for f in os.listdir(ROOT):
        if re.search(r'\.(html|js|mjs|ts)$', f) and (ROOT / f).is_file() and f not in overrides:
            os.symlink(ROOT / f, dst / f)


def run_in(dst, test):
    r = subprocess.run(['node', test], cwd=dst, capture_output=True, text=True)
    failed = []
    for line in r.stdout.splitlines():
        m = re.match(r'FAIL — ([0-9a-z-]+):', line)
        if m:
            failed.append(m.group(1))
    return r.returncode, failed, r.stdout


def main():
    status = 0
    # the always-real copies of the two test files: they find their root from their own location
    real_tests = {t: (ROOT / t).read_text() for t in (SHARE_TEST, SNAP_TEST)}
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp) / 'control'
        base.mkdir()
        shadow(base, dict(real_tests))
        for t in (SHARE_TEST, SNAP_TEST):
            rc, failed, out = run_in(base, t)
            direct = subprocess.run(['node', t], cwd=ROOT, capture_output=True, text=True)
            if rc != 0 or direct.returncode != 0 or out != direct.stdout:
                print('HARNESS — the UNMUTATED shadow tree does not behave exactly like the repository for ' + t + ' (exit %d, failed %s)' % (rc, failed))
                return 2
        print('CONTROL — the unmutated shadow tree gives byte-identical results to the repository for both test files')
        for name, (test, files, pins) in M.items():
            work = Path(tmp) / name
            work.mkdir()
            overrides = dict(real_tests)
            for path, spec in files.items():
                if isinstance(spec, str):          # a new file
                    overrides[path] = spec
                else:
                    overrides[path] = edit(overrides.get(path, (ROOT / path).read_text()), spec, name)
            shadow(work, overrides)
            rc, failed, _ = run_in(work, test)
            missing = [p for p in pins if p not in failed]
            if rc == 0:
                print('SURVIVED %s — no pin turned red' % name); status = 1
            elif missing:
                print('WRONGPIN %s — expected %s to fail, but only %s did' % (name, ','.join(pins), ','.join(failed))); status = 1
            else:
                print('KILLED   %s — pin(s) %s turned red%s' % (name, ','.join(pins), '' if set(failed) == set(pins) else ' (also ' + ','.join(sorted(set(failed) - set(pins))) + ')'))
    total = len(M)
    print('%d mutation(s) of the pins' % total)
    return status


if __name__ == '__main__':
    sys.exit(main())

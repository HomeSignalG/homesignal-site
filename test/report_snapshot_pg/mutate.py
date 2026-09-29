#!/usr/bin/env python3
"""Prohibited mutations of docs/report-snapshot.sql. Each MUST fail the suite.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently
fail to apply (a mutation that does not apply is indistinguishable from one that survives).
"""
import sys

HASH_LINE = "  constraint report_snapshot_hash_matches_body check (content_hash = encode(sha256(convert_to(body, 'UTF8')), 'hex')),\n"
FN_HEAD = "  p_property_key   text default null\n) returns table"
INSERT = ("  insert into public.report_snapshot as s (content_hash, report_version, property_key, inputs, body)\n"
          "  values (p_content_hash, p_report_version, p_property_key, p_inputs, p_body)\n")
GRANT = "grant select on public.report_snapshot to service_role;"

MUTATIONS = {
    # ---- what the hash means -----------------------------------------------------------------
    # the table trusts whatever hash the caller sends
    'no_hash_check': [(HASH_LINE, "", 1)],
    # an upper-case hash verifies (a hash is compared case-insensitively)
    'hash_compared_case_insensitively': [("check (content_hash = encode(sha256(", "check (lower(content_hash) = encode(sha256(", 1)],
    # the hash is over the NORMALISED jsonb text, not the stored bytes: a delivered body with its own
    # key order or spacing can never verify
    'hash_over_jsonb_text': [("sha256(convert_to(body, 'UTF8'))", "sha256(convert_to(body::jsonb::text, 'UTF8'))", 1)],
    # the writer stores a normalised copy of the body instead of the bytes it was given
    'stores_normalised_body': [(
        "values (p_content_hash, p_report_version, p_property_key, p_inputs, p_body)",
        "values (p_content_hash, p_report_version, p_property_key, p_inputs, p_body::jsonb::text)", 1)],
    # the size is counted in characters
    'size_in_characters': [("generated always as (octet_length(body)) stored", "generated always as (char_length(body)) stored", 1)],
    # ---- what is accepted --------------------------------------------------------------------
    'no_body_object_check': [("  constraint report_snapshot_body_is_object    check (jsonb_typeof(body::jsonb) = 'object'),\n", "", 1)],
    'no_version_check': [("  constraint report_snapshot_version_named     check (btrim(report_version) <> ''),\n", "", 1)],
    'no_inputs_check': [("  constraint report_snapshot_inputs_object     check (jsonb_typeof(inputs) = 'object'),\n", "", 1)],
    'no_key_check': [(",\n  constraint report_snapshot_key_named         check (property_key is null or btrim(property_key) <> '')\n);",
                      "\n);", 1)],
    # ---- identity ----------------------------------------------------------------------------
    # every snapshot gets the same id
    'constant_id': [("primary key default gen_random_uuid()", "primary key default '00000000-0000-4000-8000-000000000000'::uuid", 1)],
    # ids are no longer a key (duplicates possible)
    'no_primary_key': [("uuid        primary key default gen_random_uuid()", "uuid        default gen_random_uuid()", 1)],
    # the caller may choose the id
    'caller_chooses_id': [
        (FN_HEAD, "  p_property_key   text default null,\n  p_report_id      uuid default null\n) returns table", 1),
        (INSERT, "  insert into public.report_snapshot as s (report_id, content_hash, report_version, property_key, inputs, body)\n"
                 "  values (coalesce(p_report_id, gen_random_uuid()), p_content_hash, p_report_version, p_property_key, p_inputs, p_body)\n", 1)],
    # ---- immutability ------------------------------------------------------------------------
    'no_update_delete_trigger': [(
        "create or replace trigger report_snapshot_no_update_delete\n  before update or delete on public.report_snapshot\n"
        "  for each row execute function public.report_snapshot_immutable();", "select 1;", 1)],
    'no_truncate_trigger': [(
        "create or replace trigger report_snapshot_no_truncate\n  before truncate on public.report_snapshot\n"
        "  for each statement execute function public.report_snapshot_immutable();", "select 1;", 1)],
    # ---- lock-down ---------------------------------------------------------------------------
    'no_rls': [("alter table public.report_snapshot enable row level security;", "select 1;", 1)],
    'table_default_grants': [("revoke all on public.report_snapshot from public, anon, authenticated, service_role;", "select 1;", 1)],
    'anon_can_read': [(GRANT, "grant select on public.report_snapshot to service_role, anon;", 1)],
    'authenticated_can_read': [(GRANT, "grant select on public.report_snapshot to service_role, authenticated;", 1)],
    'service_role_can_insert': [(GRANT, "grant select, insert on public.report_snapshot to service_role;", 1)],
    'service_role_all': [(GRANT, "grant all on public.report_snapshot to service_role;", 1)],
    'functions_unlocked': [(
        "execute format('revoke all on function %s from public, anon, authenticated', f.sig);",
        "execute format('select 1 /* %s */', f.sig);", 1)],
    'writer_not_security_definer': [("language sql\nsecurity definer\nset search_path = public, pg_temp\nas $$",
                                     "language sql\nset search_path = public, pg_temp\nas $$", 1)],
    'writer_search_path_unpinned': [("language sql\nsecurity definer\nset search_path = public, pg_temp\nas $$",
                                     "language sql\nsecurity definer\nas $$", 1)],
}


def main():
    if len(sys.argv) == 2 and sys.argv[1] == '--list':
        print('\n'.join(MUTATIONS))
        return 0
    if len(sys.argv) != 3 or sys.argv[1] not in MUTATIONS:
        sys.stderr.write('usage: mutate.py --list | NAME FILE\n')
        return 2
    text = open(sys.argv[2]).read()
    for old, new, count in MUTATIONS[sys.argv[1]]:
        if text.count(old) != count:
            sys.stderr.write('anchor for %s matched %d time(s), expected %d\n' % (sys.argv[1], text.count(old), count))
            return 2
        text = text.replace(old, new)
    sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())

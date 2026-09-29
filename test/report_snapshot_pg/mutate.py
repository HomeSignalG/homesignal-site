#!/usr/bin/env python3
"""Prohibited mutations of docs/report-snapshot.sql. Each MUST fail the suite.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently
fail to apply (a mutation that does not apply is indistinguishable from one that survives).
Mutations named upgrade_* break the UPGRADE of the Order F table and are judged by run.sh's
upgrade stage, not by the suite.
"""
import sys

HASH_LINE = "  constraint report_snapshot_hash_matches_body  check (content_hash = encode(sha256(convert_to(body, 'UTF8')), 'hex')),\n"
FN_HEAD = "  p_private        jsonb default null\n) returns table"
V_ID = "  v_id  uuid := gen_random_uuid();"
INSERT = ("  insert into public.report_snapshot as s (report_id, content_hash, report_version, private_context_id, engine_inputs, body)\n"
          "  values (v_id, p_content_hash, p_report_version, v_ctx, p_engine_inputs, p_body)\n"
          "  returning s.generated_at into v_at;\n")
GRANT = "grant select on public.report_snapshot to service_role;"
WRITER_HEAD = "language plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$"
TRIGGER = ("create or replace trigger report_snapshot_no_private_values\n  before insert on public.report_snapshot\n"
           "  for each row execute function public.report_snapshot_no_private_values();")
FK_TABLE = "  private_context_id uuid        references public.report_private_context (context_id),\n"
FK_UPGRADE = "add column private_context_id uuid references public.report_private_context (context_id);"
ENGINE_COL = "  engine_inputs      jsonb       not null,\n"
NORM = "regexp_replace(lower(coalesce(t, '')), '[[:space:],.]+', ' ', 'g')"
PURGED_GUARD = ("  if c.state <> 'active' then\n"
                "    raise exception 'report_snapshot: a snapshot cannot be issued against a purged private context' using errcode = '55000';\n  end if;\n")
SWALLOWED_INSERT = (
    "  begin\n"
    "    insert into public.report_snapshot as s (report_id, content_hash, report_version, private_context_id, engine_inputs, body)\n"
    "    values (v_id, p_content_hash, p_report_version, v_ctx, p_engine_inputs, p_body)\n"
    "    returning s.generated_at into v_at;\n"
    "  exception when others then\n"
    "    v_at := now();\n"
    "  end;\n")
UPGRADE_GUARD = ("    if exists (select 1 from public.report_snapshot) then\n"
                 "      raise exception 'report_snapshot: the Order F shape holds stored reports; refusing to drop its address-bearing columns. Nothing was changed.';\n"
                 "    end if;\n")
UPGRADE_ENGINE = ("  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'report_snapshot' and column_name = 'engine_inputs') then\n"
                  "    alter table public.report_snapshot add column engine_inputs jsonb not null;\n  end if;\n")
UPGRADE_CK = ("  if not exists (select 1 from pg_constraint where conrelid = 'public.report_snapshot'::regclass and conname = 'report_snapshot_engine_inputs_object') then\n"
              "    alter table public.report_snapshot add constraint report_snapshot_engine_inputs_object check (jsonb_typeof(engine_inputs) = 'object');\n  end if;\n")

MUTATIONS = {
    # ---- what the hash means -----------------------------------------------------------------
    'no_hash_check': [(HASH_LINE, "", 1)],
    'hash_compared_case_insensitively': [("check (content_hash = encode(sha256(", "check (lower(content_hash) = encode(sha256(", 1)],
    'hash_over_jsonb_text': [("sha256(convert_to(body, 'UTF8'))", "sha256(convert_to(body::jsonb::text, 'UTF8'))", 1)],
    'stores_normalised_body': [("values (v_id, p_content_hash, p_report_version, v_ctx, p_engine_inputs, p_body)",
                                "values (v_id, p_content_hash, p_report_version, v_ctx, p_engine_inputs, p_body::jsonb::text)", 1)],
    'size_in_characters': [("generated always as (octet_length(body)) stored", "generated always as (char_length(body)) stored", 1)],
    # ---- what is accepted --------------------------------------------------------------------
    'no_body_object_check': [("  constraint report_snapshot_body_is_object     check (jsonb_typeof(body::jsonb) = 'object'),\n", "", 1)],
    'no_version_check': [("  constraint report_snapshot_version_named      check (btrim(report_version) <> ''),\n", "", 1)],
    'no_engine_inputs_check': [(",\n  constraint report_snapshot_engine_inputs_object check (jsonb_typeof(engine_inputs) = 'object')\n);", "\n);", 1),
                               (UPGRADE_CK, "", 1)],
    # ---- identity ----------------------------------------------------------------------------
    'constant_id': [(V_ID, "  v_id  uuid := '00000000-0000-4000-8000-000000000000'::uuid;", 1)],
    'no_primary_key': [("  report_id          uuid        primary key,", "  report_id          uuid,", 1)],
    'caller_chooses_id': [(FN_HEAD, "  p_private        jsonb default null,\n  p_report_id      uuid default null\n) returns table", 1),
                          (V_ID, "  v_id  uuid := coalesce(p_report_id, gen_random_uuid());", 1)],
    'table_gets_an_id_default': [("  report_id          uuid        primary key,", "  report_id          uuid        primary key default gen_random_uuid(),", 1),
                                 ("  alter table public.report_snapshot alter column report_id drop default;\n", "", 1)],
    # ---- the privacy boundary: what the permanent table can hold -------------------------------
    'table_keeps_a_property_key_column': [(ENGINE_COL, "  property_key       text,\n" + ENGINE_COL, 1),
                                          ("    alter table public.report_snapshot drop column if exists property_key;\n", "", 1)],
    'table_keeps_an_inputs_column': [(ENGINE_COL, "  inputs             jsonb,\n" + ENGINE_COL, 1),
                                     ("    alter table public.report_snapshot drop column if exists inputs;\n", "", 1)],
    'no_reference_to_the_private_context': [(FK_TABLE, "  private_context_id uuid,\n", 1),
                                            (FK_UPGRADE, "add column private_context_id uuid;", 1)],
    'reference_cascades_on_delete': [(FK_TABLE, "  private_context_id uuid        references public.report_private_context (context_id) on delete cascade,\n", 1),
                                     (FK_UPGRADE, "add column private_context_id uuid references public.report_private_context (context_id) on delete cascade;", 1)],
    # ---- the privacy boundary: the containment trigger ------------------------------------------
    'containment_trigger_dropped': [(TRIGGER, "select 1;", 1)],
    'containment_ignores_the_address': [("      ('address', c.address),\n", "", 1)],
    'containment_ignores_the_normalized_address': [("      ('normalized_address', c.normalized_address),\n", "", 1)],
    'containment_ignores_the_label': [("      ('label', c.label),\n", "", 1)],
    'containment_ignores_property_keys': [("    union all select 'property_key', k from unnest(coalesce(c.property_keys, '{}'::text[])) as k\n", "", 1)],
    'containment_ignores_the_latitude': [("      ('latitude', case when scale(c.latitude) >= 5 then c.latitude::text end),\n", "", 1)],
    'containment_ignores_the_longitude': [("      ('longitude', case when scale(c.longitude) >= 5 then c.longitude::text end)) as t (f, v)",
                                           "      ('longitude', null::text)) as t (f, v)", 1)],
    'containment_ignores_the_body': [("position(v in hay_body) > 0 or ", "", 1)],
    'containment_ignores_engine_inputs': [(" or position(v in hay_in) > 0", "", 1)],
    'containment_is_case_sensitive': [(NORM, "regexp_replace(coalesce(t, ''), '[[:space:],.]+', ' ', 'g')", 1)],
    'containment_is_whitespace_sensitive': [(NORM, "lower(coalesce(t, ''))", 1)],
    'containment_scans_coarse_coordinates': [("scale(c.latitude) >= 5", "scale(c.latitude) >= 0", 1), ("scale(c.longitude) >= 5", "scale(c.longitude) >= 0", 1)],
    'containment_scans_two_character_values': [("length(v) >= 3", "length(v) >= 0", 1)],
    'containment_accepts_a_purged_context': [(PURGED_GUARD, "", 1)],
    'containment_message_leaks_the_value': [("contains the private context''s %', f\n", "contains the private context''s % (%)', f, v\n", 1)],
    # ---- the writer -----------------------------------------------------------------------------------
    'writer_ignores_the_private_context': [("  if p_private is not null then", "  if false then", 1)],
    'writer_opens_the_wrong_need': [("public.report_private_context_create(p_private, 'report', v_id::text)", "public.report_private_context_create(p_private, 'follow', v_id::text)", 1)],
    'writer_need_is_not_tied_to_the_report': [("public.report_private_context_create(p_private, 'report', v_id::text)", "public.report_private_context_create(p_private, 'report', 'x')", 1)],
    'writer_swallows_the_refusal': [(INSERT, SWALLOWED_INSERT, 1)],
    'writer_not_security_definer': [(WRITER_HEAD, "language plpgsql\nset search_path = public, pg_temp\nas $$", 1)],
    'writer_search_path_unpinned': [(WRITER_HEAD, "language plpgsql\nsecurity definer\nas $$", 1)],
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
    'functions_unlocked': [("execute format('revoke all on function %s from public, anon, authenticated', f.sig);",
                            "execute format('select 1 /* %s */', f.sig);", 1)],
    # ---- the upgrade of the Order F table (judged by run.sh's upgrade stage) ------------------------------
    # the guard is the deliberate protection; a NOT NULL column with no default is an accidental second one, so it is removed too
    'upgrade_drops_a_table_holding_reports': [(UPGRADE_GUARD, "", 1),
                                              ("    alter table public.report_snapshot add column engine_inputs jsonb not null;", "    alter table public.report_snapshot add column engine_inputs jsonb not null default '{}'::jsonb;", 1)],
    'upgrade_keeps_the_inputs_column': [("    alter table public.report_snapshot drop column if exists inputs;\n", "", 1)],
    'upgrade_keeps_the_property_key_column': [("    alter table public.report_snapshot drop column if exists property_key;\n", "", 1)],
    'upgrade_skips_the_engine_inputs_column': [(UPGRADE_ENGINE, "", 1)],
    'upgrade_skips_the_engine_inputs_constraint': [(UPGRADE_CK, "", 1)],
    'upgrade_skips_the_context_reference': [(FK_UPGRADE, "add column private_context_id uuid;", 1)],
    'upgrade_keeps_the_old_writer': [("drop function if exists public.report_snapshot_issue(text, text, text, jsonb, text);\n", "", 1)],
    'upgrade_keeps_the_id_default': [("  alter table public.report_snapshot alter column report_id drop default;\n", "", 1)],
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
        if old == new:
            sys.stderr.write('mutation %s changes nothing\n' % sys.argv[1])
            return 2
        text = text.replace(old, new)
    sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""Prohibited mutations of docs/official-documents-map-gate.sql. Each must fail at least one suite check.

  python3 mutate.py --list
  python3 mutate.py NAME FILE > mutated.sql
"""
import sys

M = {
    # G3 off in the current set: official documents reach the resolvers with the gate closed
    "current_view_ignores_gate": (
        "where public.dc_source_map_admitted(o.source_key, o.distribution_key)\n  and (",
        "where true\n  and ("),
    # G3 off in the history path only
    "history_path_ignores_gate": (
        "       and public.dc_source_map_admitted(o.source_key, o.distribution_key);$b$;",
        "       and (public.dc_source_map_admitted(o.source_key, o.distribution_key) or true);$b$;"),
    # an ungated source treated as gated-and-closed: Atlas vanishes
    "ungated_source_closed": ("    else true end\n$fn$;", "    else false end\n$fn$;"),
    # a gate with no decision reads open
    "no_decision_is_open": ("order by d.decision_id desc limit 1), false)", "order by d.decision_id desc limit 1), true)"),
    # the incremental mode keeps only the newest run, like a whole release
    "incremental_newest_only": (
        "        and r.source_contract->>'release_mode' = 'incremental'\n",
        "        and false\n"),
    # supersession ignored
    "supersedes_ignored": ("and s.raw_payload->'supersedes' ? o.home_signal_observation_id::text",
                           "and false"),
    # the classifier trusts the checker without the site
    "confirmed_without_site": (
        "               or coalesce(p_payload->'checker'->>'site_identified', '') <> 'true' then",
        "               or false then"),
    # the classifier trusts the checker without its evidence
    "confirmed_without_evidence": (
        "        if coalesce(p_payload->'checker'->>'checker_version', '') = ''\n"
        "           or coalesce(p_payload->'passage'->>'quote', '') = ''\n"
        "           or coalesce(p_payload->'passage'->>'document_sha256', '') !~ '^[a-f0-9]{64}$'\n"
        "           or coalesce(p_payload->'passage'->>'page', '') !~ '^[1-9][0-9]*$' then\n",
        "        if false then\n"),
    # NOT_A_PROJECT read as NON_DC (an entity for a zoning definition)
    "not_a_project_is_non_dc": ("elsif v_conf = 'NON_DC' then", "elsif v_conf in ('NON_DC', 'NOT_A_PROJECT') then"),
    # the reader returns withdrawn actions too
    "reader_returns_withdrawn": ("     and x->>'state' = 'open'\n", "     and true\n"),
    # the reader ignores the gate (reads every observation, not the current set)
    "reader_ignores_gate": (
        "    join public.dc_current_observation c on c.home_signal_observation_id = eo.home_signal_observation_id\n   cross join lateral jsonb_array_elements",
        "    join public.dc_source_observation c on c.home_signal_observation_id = eo.home_signal_observation_id\n   cross join lateral jsonb_array_elements"),
    # the kill switch closes no gate
    "kill_switch_closes_nothing": (
        "    values ('G3_MAP_ADMISSION', g.scope, false, p_actor, 'exposure-off-1', p_reason);",
        "    values ('G3_MAP_ADMISSION', g.scope, true, p_actor, 'exposure-off-1', p_reason);"),
    # the restore can run twice
    "restore_twice": ("if exists (select 1 from public.official_document_gate_decision r where r.reverses = p_decision_id) then",
                      "if false then"),
    # the site address of a document is not read: an alteration becomes a second pin
    "no_document_site_address": ("        return query select public.dc_normalize_street(p_native_address->>'street'),\n                            nullif(upper(btrim(p_native_address->>'state')), ''),\n                            nullif(left(btrim(coalesce(p_native_address->>'postalCode', '')), 5), ''),\n                            'OFFICIAL_DOC_STATED_SITE_ADDRESS'::text;",
                                 "        return query select null::text, null::text, null::text, 'OFFICIAL_DOC_STATED_SITE_ADDRESS'::text;"),
}


# Prohibited mutations of docs/official-documents-contract.sql.
CM = {
    # the mode always counts in the fingerprint: every existing contract moves
    "fingerprint_always": ("|| case when new.release_mode = 'incremental' then 'release_mode=incremental|' else '' end$b$;",
                           "|| case when true then 'release_mode=incremental|' else '' end$b$;"),
    # the mode always lands in the snapshot: every whole-release snapshot changes shape
    "snapshot_always": ("      || case when s.release_mode = 'incremental'\n", "      || case when true\n"),
    # changing the mode does not bump the contract version
    "no_version_bump": ("            or (new.release_mode                 is distinct from old.release_mode);$b$;",
                        "            or (false and new.release_mode                 is distinct from old.release_mode);$b$;"),
    # registered ACTIVE
    "registered_active": ("'SOURCE_RECORD_NOT_SEEN', null, 'NOT_ACTIVE', 'incremental')",
                          "'SOURCE_RECORD_NOT_SEEN', '0 * * * *', 'ACTIVE', 'incremental')"),
    # registered as a whole release
    "registered_whole": ("'SOURCE_RECORD_NOT_SEEN', null, 'NOT_ACTIVE', 'incremental')",
                         "'SOURCE_RECORD_NOT_SEEN', null, 'NOT_ACTIVE', 'whole')"),
}


def main():
    if sys.argv[1] == "--list":
        print("\n".join(M))
        return
    if sys.argv[1] == "--contract-list":
        print("\n".join(CM))
        return
    table = M
    if sys.argv[1] == "--contract":
        table = CM
        sys.argv = sys.argv[1:]
    name, path = sys.argv[1], sys.argv[2]
    a, b = table[name]
    src = open(path).read()
    if src.count(a) != 1:
        sys.exit(f"anchor for {name} appears {src.count(a)} times")
    sys.stdout.write(src.replace(a, b))


if __name__ == "__main__":
    main()

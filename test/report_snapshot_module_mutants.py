#!/usr/bin/env python3
"""Prohibited mutations of supabase/functions/_shared/report-snapshot.ts. Each MUST make
test/report-snapshot.test.mjs exit non-zero.

Run:  python3 test/report_snapshot_module_mutants.py
It edits the module in place, runs the test, and ALWAYS restores the original (even on error or ^C).
An anchor that does not match exactly once is a harness failure, never a pass. Exit 1 if any mutation
survives. (Manual: CI runs the node tests, not this loop.)
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / 'supabase/functions/_shared/report-snapshot.ts'
TEST = ROOT / 'test/report-snapshot.test.mjs'

MUTATIONS = {
    # ---- the boundary the module itself enforces ------------------------------------------------------
    'subject_relative_rule_matches_nothing': [("export const SUBJECT_RELATIVE_KEY =\n  /^(distance|dist)(_|$)|^(east|north|south|west)_(mi|km|m|ft)$|^bearing|^(miles|km|meters|feet)_(from|away)/i;",
                                               "export const SUBJECT_RELATIVE_KEY = /^\\b$^/;")],
    'subject_relative_check_skipped': [("    if (leaked.length) {", "    if (false) {")],
    'subject_relative_check_always_on': [("  if (privateContext !== null) {\n    const leaked", "  if (true) {\n    const leaked")],
    'walk_does_not_descend_into_arrays': [("    value.forEach((v, i) => subjectRelativeKeys(v, path + '[' + i + ']', out));", "    /* arrays are not walked */")],
    'private_context_not_forwarded': [("    p_private: privateContext,", "    p_private: null,")],
    'private_values_copied_into_the_body': [("  const body = snapshotBodyOf(intelligence);", "  const body = snapshotBodyOf({ ...intelligence, buyer: privateContext });")],
    'private_values_copied_into_the_engine_inputs': [("    p_engine_inputs: opts.engineInputs,", "    p_engine_inputs: { ...opts.engineInputs, address: privateContext && privateContext.address },")],
    'envelope_returns_the_private_values': [("    private_context_id: contextId as string | null,", "    private_context_id: contextId as string | null,\n    private: privateContext,")],
    'module_reads_another_private_field': [("typeof privateContext.address !== 'string' || !privateContext.address.trim()", "typeof privateContext.address !== 'string' || !privateContext.address.trim() || !privateContext.label")],
    # ---- input validation ------------------------------------------------------------------------------
    'blank_address_accepted': [("typeof privateContext.address !== 'string' || !privateContext.address.trim()", "false")],
    'array_private_context_accepted': [("!isObject(privateContext) ||", "false ||")],
    'empty_version_accepted': [("typeof opts.reportVersion !== 'string' || !opts.reportVersion.trim()", "false")],
    'array_engine_inputs_accepted': [("if (!isObject(opts.engineInputs))", "if (false)")],
    # ---- identity and hash -------------------------------------------------------------------------------
    'identity_slot_not_excluded': [("['report_id', 'generated_at', 'content_hash', 'private_context_id']", "['report_id', 'generated_at', 'content_hash']")],
    'hash_over_a_different_text': [("const contentHash = await sha256Hex(body);", "const contentHash = await sha256Hex(body + ' ');")],
    'module_mints_a_report_id': [("  const reportId = row.report_id;", "  const reportId = crypto.randomUUID();")],
    # ---- fail closed ---------------------------------------------------------------------------------------
    'database_error_ignored': [("  if (error) throw new Error('issueSnapshot: the snapshot was not stored: ' + error.message);", "  void error;")],
    'several_rows_accepted': [("(data.length === 1 ? data[0] : null)", "(data.length >= 1 ? data[0] : null)")],
    'malformed_report_id_accepted': [("typeof reportId !== 'string' || !UUID_V4.test(reportId)", "typeof reportId !== 'string'")],
    'missing_time_accepted': [("typeof generatedAt !== 'string' || Number.isNaN(Date.parse(generatedAt))", "false")],
    'unconfirmed_private_context_accepted': [("privateContext !== null ? (typeof contextId !== 'string' || !UUID_V4.test(contextId)) : contextId !== null", "false")],
    'unrequested_private_context_accepted': [("privateContext !== null ? (typeof contextId !== 'string' || !UUID_V4.test(contextId)) : contextId !== null",
                                              "privateContext !== null ? (typeof contextId !== 'string' || !UUID_V4.test(contextId)) : false")],
    'envelope_check_always_true': [("  return (await sha256Hex(JSON.stringify(envelope.report))) === envelope.content_hash;", "  return true;")],
}


def run():
    r = subprocess.run(['node', str(TEST)], cwd=ROOT, capture_output=True, text=True)
    return r.returncode


def main():
    original = MODULE.read_text()
    if run() != 0:
        print('HARNESS — the unmutated module does not pass its test')
        return 2
    survived = harness = 0
    try:
        for name, edits in MUTATIONS.items():
            text = original
            for old, new in edits:
                if text.count(old) != 1:
                    print('HARNESS  %s — anchor matched %d time(s), expected 1' % (name, text.count(old)))
                    harness += 1
                    break
                text = text.replace(old, new)
            else:
                MODULE.write_text(text)
                if run() != 0:
                    print('KILLED   ' + name)
                else:
                    print('SURVIVED %s — the module test cannot see this regression' % name)
                    survived += 1
    finally:
        MODULE.write_text(original)
    print('%d mutation(s), %d survived, %d harness failure(s)' % (len(MUTATIONS), survived, harness))
    return 1 if (survived or harness) else 0


if __name__ == '__main__':
    sys.exit(main())

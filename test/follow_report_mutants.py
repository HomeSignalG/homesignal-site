#!/usr/bin/env python3
"""Prohibited mutations of Changes Since Report and Follow (Development Activity plan "Watch This Property"; contract §6 gate 4).
Each MUST make at least one of

    test/changes-since-report.test.mjs
    test/follow-development-report.test.mjs
    test/follow-development-report-structure.test.mjs
    test/report-private-context-structure.test.mjs, test/report-snapshot-structure.test.mjs, test/dev-change-reportable-structure.test.mjs
        (the three older guards this feature narrowed or must not trip: the private layer, the snapshot table, the raw event table)

exit non-zero (the OFFLINE suites). The mutations in ROUNDTRIP_ONLY are the ones only the end-to-end proof on a real Postgres can
see, so they are run only with --roundtrip, which also needs the disposable-database environment test/changes_since_report_pg/run.sh
requires (PGHOST, PGDATABASE naming a disposable database, PGUSER, ...).

    python3 test/follow_report_mutants.py                 # every offline mutation
    python3 test/follow_report_mutants.py name [name ...]
    python3 test/follow_report_mutants.py --roundtrip     # also runs the round trip against any mutant the offline suites missed
    python3 test/follow_report_mutants.py --roundtrip-only name [name ...]   # skip the offline suites: does the round trip ALONE catch it?

The round trip is `bash test/changes_since_report_pg/run.sh` unless FOLLOW_ROUNDTRIP_CMD is set (a shell command, for a database
reachable only as another operating-system user).

It edits files in place, runs the suites, and ALWAYS restores the originals (even on error or ^C). An anchor that does not match
exactly once is a harness failure, never a pass. Exit 1 if any mutation survives, 2 on a harness fault.
(Manual, like national_report_mutants.py: CI runs the node tests and the round trip, not this loop.)
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSR = 'supabase/functions/_shared/changes-since-report.ts'
CHG = 'supabase/functions/_shared/change-reads.ts'
GATE = 'supabase/functions/_shared/admin-gate.ts'
REST = 'supabase/functions/_shared/service-rest.ts'
MOD = 'supabase/functions/_shared/national-report.ts'
HAN = 'supabase/functions/follow-development-report/handler.ts'
DAT = 'supabase/functions/follow-development-report/data.ts'
CFG = 'supabase/config.toml'
DEP = '.github/workflows/deploy-edge-functions.yml'
RSW = '.github/workflows/report-snapshot-suite.yml'
RUN = 'test/changes_since_report_pg/run.sh'
TESTS = ['test/changes-since-report.test.mjs', 'test/follow-development-report.test.mjs', 'test/follow-development-report-structure.test.mjs',
         'test/report-private-context-structure.test.mjs', 'test/report-snapshot-structure.test.mjs', 'test/dev-change-reportable-structure.test.mjs']
ROUNDTRIP = os.environ.get('FOLLOW_ROUNDTRIP_CMD') or 'bash test/changes_since_report_pg/run.sh'

M = {}
ROUNDTRIP_ONLY = set()


def m(name, file, old, new, rt=False):
    M[name] = [(file, old, new)]
    if rt:
        ROUNDTRIP_ONLY.add(name)


# ---- the boundary in time ---------------------------------------------------------------------------------------------------------
m('boundary_is_observed_at', CSR, "const written = instant(e.created_at);", "const written = instant(e.observed_at);")
m('overlap_removed', CSR, "export const SINCE_REPORT_OVERLAP_MS = 10 * 60 * 1000;", "export const SINCE_REPORT_OVERLAP_MS = 0;")
m('overlap_without_dedupe', CSR, " && !shown.has(observed + '|' + e.event_type);", ";")
m('dedupe_ignores_event_type', CSR, "!shown.has(observed + '|' + e.event_type)", "!shown.has(observed + '|')")
m('written_in_the_future_shown', CSR, "return written > lower && written <= upper && observed <= upper", "return written > lower && observed <= upper")
m('observed_in_the_future_shown', CSR, "&& observed <= upper && !shown", "&& !shown")
m('boundary_inclusive_below', CSR, "return written > lower && written <= upper", "return written >= lower - 10 * 60 * 1000 && written <= upper")
m('read_instant_is_the_issue_time', CSR, "return new Date(Date.parse(generatedAt) - SINCE_REPORT_OVERLAP_MS).toISOString();", "return new Date(Date.parse(generatedAt)).toISOString();")
# ---- what counts as a change: the shared rule, applied -----------------------------------------------------------------------------------
m('reader_skips_the_shared_rule', CSR, "const found = selectDetectedChanges(led, events, keep as (e: ReportableEvent) => boolean);", "const found = materialEvents(events, keep as (e: ReportableEvent) => boolean);")
m('reader_ignores_materiality', CSR, "const found = selectDetectedChanges(led, events, keep as (e: ReportableEvent) => boolean);", "const found = isChangeReady(led) ? events.filter(keep as (e: ReportableEvent) => boolean) : [];")
m('not_change_ready_uncounted', CSR, "excluded.not_change_ready++;", "void 0;")
m('change_entries_reordered', CSR, "return x < y ? 1 : x > y ? -1 : a.project_id < b.project_id ? -1 : 1;", "return x < y ? -1 : x > y ? 1 : a.project_id < b.project_id ? -1 : 1;")
m('latest_is_oldest', CSR, "latest.set(p.project_id, String(found[0].observed_at));", "latest.set(p.project_id, String(found[found.length - 1].observed_at));")
m('changes_not_from_the_shared_entry', CSR, "return { ...detectedChangeEntries([e])[0], recorded_at: e.created_at, source_retrieved_before_report: retrievedBefore };", "return { event_type: e.event_type, detected_at: e.observed_at, recorded_at: e.created_at, source_retrieved_before_report: retrievedBefore };")
m('recorded_at_is_the_source_instant', CSR, "recorded_at: e.created_at,", "recorded_at: e.observed_at,")
m('retrieved_flag_inverted', CSR, "const retrievedBefore = instant(e.observed_at) <= issued;", "const retrievedBefore = instant(e.observed_at) > issued;")
m('retrieved_flag_exclusive_at_the_issue_instant', CSR, "const retrievedBefore = instant(e.observed_at) <= issued;", "const retrievedBefore = instant(e.observed_at) < issued;")
m('retrieved_flag_never_set', CSR, "const retrievedBefore = instant(e.observed_at) <= issued;", "const retrievedBefore = false;")
m('recorded_limitation_dropped', CSR, "if (recordedAfterReport) limitations.push({ ...RECORDED_AFTER_REPORT });", "void 0;")
m('recorded_limitation_always', CSR, "if (recordedAfterReport) limitations.push({ ...RECORDED_AFTER_REPORT });", "limitations.push({ ...RECORDED_AFTER_REPORT });")
m('recorded_limitation_never_triggered', CSR, "if (retrievedBefore) recordedAfterReport = true;", "void 0;")
m('event_time_unchecked', CSR, "if (!Number.isFinite(instant(e.created_at)) || !Number.isFinite(instant(e.observed_at))) throw new EventRowUnreadable('a ledger event has an unreadable time');", "void 0;")
m('detected_change_unvalidated', CSR, "if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.event_type !== 'string'\n      || typeof c.detected_at !== 'string' || !Number.isFinite(Date.parse(c.detected_at))) {", "if (false) {")
m('detected_change_instant_unchecked', CSR, "|| typeof c.detected_at !== 'string' || !Number.isFinite(Date.parse(c.detected_at))) {", "|| false) {")
m('detected_changes_not_a_list_accepted', CSR, "if (!Array.isArray(raw)) throw new ReportUnreadable('a project\\'s detected changes are not a list');", "if (!Array.isArray(raw)) return [];")
m('content_hash_not_the_stored_one', CSR, "content_hash: report.content_hash }", "content_hash: 'x' }")
# ---- rights, limitations, health --------------------------------------------------------------------------------------------------------
m('since_rights_gate_off', CSR, "if (!grant && view === 'customer') {", "if (false) {")
m('since_attribution_dropped', CSR, "attribution: grant ? (grant.attribution || null) : null }", "attribution: null }")
m('since_internal_hold_unlabelled', CSR, "...(view === 'internal' ? { rights: grant ? 'CLEARED' : 'HOLD' } : {}),", "")
m('new_projects_limitation_dropped', CSR, "const limitations = [{ ...NEW_PROJECTS_NOT_COVERED }];", "const limitations: Array<{ code: string; text: string }> = [];")
m('sources_not_included_dropped', CSR, "if (Object.keys(excluded.no_rights).length > 0) limitations.push({ ...SOURCES_NOT_INCLUDED_SINCE });", "void 0;")
m('since_health_ignored', CSR, "if (sourcesNotFullyRead(input.health, familiesInAnswer)) limitations.push", "if (false) limitations.push")
m('since_health_counts_every_family', CSR, "if (family) familiesInAnswer.add(family);", "familiesInAnswer.add(family);\n    for (const h of input.health) familiesInAnswer.add(h.registry_id);")
m('since_view_unchecked', CSR, "if (view !== 'customer' && view !== 'internal') throw new Error('changesSinceReport: view must be customer or internal');", "void 0;")
m('since_registry_unvalidated', CSR, "const rights = validateRights(input.rights);", "const rights = input.rights as ReturnType<typeof validateRights>;")
m('through_is_the_issue_time', CSR, "through: now.toISOString(),", "through: parsed.generated_at,")
# ---- reading the stored report: fail closed ------------------------------------------------------------------------------------------
m('unparseable_body_is_no_changes', CSR, "catch { throw new ReportUnreadable('body is not JSON'); }", "catch { body = { product: PRODUCT_NAME, projects: [] }; }")
m('foreign_product_accepted', CSR, "|| body.product !== PRODUCT_NAME) throw", "|| false) throw")
m('project_list_optional', CSR, "if (!Array.isArray(body.projects)) throw new ReportUnreadable('no project list');", "body.projects = Array.isArray(body.projects) ? body.projects : [];")
m('duplicate_project_accepted', CSR, "if (seen.has(p.project_id)) throw new ReportUnreadable('a project appears twice');", "void 0;")
m('project_without_identity_accepted', CSR, "|| typeof p.project_id !== 'string' || !p.project_id) throw", "|| false) throw")
m('issue_time_unchecked', CSR, "if (!Number.isFinite(Date.parse(stored.generated_at))) throw new ReportUnreadable('no issue time');", "void 0;")
# ---- the function: who may ask, what may be asked ----------------------------------------------------------------------------------------
m('follow_gate_removed', HAN, "const denied = await authorizeAdmin(req, deps);\n    if (denied) return denied;", "")
m('follow_unknown_fields_ignored', HAN, "if (unknown.length) return reply(", "if (false) return reply(")
m('follow_action_unchecked', HAN, "if (!ACTIONS.includes(action)) return reply(", "if (false) return reply(")
m('report_id_not_a_uuid', HAN, "typeof b.report_id === 'string' && UUID.test(b.report_id) ?", "typeof b.report_id === 'string' && b.report_id.length > 0 ?")
m('follow_id_not_a_uuid', HAN, "if (typeof b.follow_id !== 'string' || !UUID.test(b.follow_id)) return reply(", "if (typeof b.follow_id !== 'string') return reply(")
m('unfollow_without_id_allowed', HAN, "(action === 'follow' || action === 'unfollow') && !followId) return reply(", "action === 'follow' && !followId) return reply(")
m('follow_without_id_allowed', HAN, "(action === 'follow' || action === 'unfollow') && !followId) return reply(", "action === 'unfollow' && !followId) return reply(")
m('report_id_not_lowercased', HAN, "UUID.test(b.report_id) ? b.report_id.toLowerCase() : null", "UUID.test(b.report_id) ? b.report_id : null")
m('follow_id_not_lowercased', HAN, "followId = b.follow_id.toLowerCase();", "followId = b.follow_id;")
m('view_default_internal', HAN, "(b.view === undefined ? 'customer' : b.view)", "(b.view === undefined ? 'internal' : b.view)")
m('view_unchecked', HAN, "if (view !== 'customer' && view !== 'internal') return reply(", "if (false) return reply(")
m('missing_report_is_empty', HAN, "if (!stored) return reply(req, { error: 'report_not_found' }, 404);", "if (!stored) return reply(req, { status: 'OK', result: null });")
m('purged_context_reopened', HAN, "if (opened === 'CONTEXT_PURGED') return reply(req, { status: 'CONTEXT_PURGED', report_id: reportId });", "void 0;")
m('no_context_follows_anyway', HAN, "if (!ctx.private_context_id) return reply(req, { status: 'NO_PRIVATE_CONTEXT', report_id: reportId });", "void 0;")
m('context_id_in_the_response', HAN, "return reply(req, { status: 'FOLLOWING', report_id: reportId, follow_id: followId });", "return reply(req, { status: 'FOLLOWING', report_id: reportId, follow_id: followId, context: ctx.private_context_id });")
m('changes_branch_reads_the_context', HAN, "const stored = await deps.report(reportId);", "const stored = await deps.report(reportId); await deps.reportContext(reportId);")
m('follow_id_taken_from_the_report', HAN, "const opened = await deps.openFollow(ctx.private_context_id, followId!);", "const opened = await deps.openFollow(ctx.private_context_id, reportId);")
m('unfollow_closes_another_id', HAN, "await deps.closeFollow(ctx.private_context_id, followId!);", "await deps.closeFollow(ctx.private_context_id, reportId);")
m('follow_reads_the_body', HAN, "const ctx = await deps.reportContext(reportId);", "const ctx = await deps.reportContext(reportId); await deps.report(reportId);")
m('missing_context_is_no_context', HAN, "if (!ctx) return reply(req, { error: 'report_not_found' }, 404);", "if (!ctx) return reply(req, { status: 'NO_PRIVATE_CONTEXT', report_id: reportId });")
m('clock_read_twice', HAN, "now: asked,", "now: deps.now(),")
m('clock_read_after_the_reads', HAN, "const asked = deps.now();\n", "")
m('options_preflight_removed', HAN, "if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });", "void 0;")
m('families_unsorted', HAN, "filter((f): f is string => !!f))].sort();", "filter((f): f is string => !!f))];")
m('event_row_unreadable_is_500', HAN, "if (e instanceof DataUnavailable || e instanceof EventRowUnreadable) return reply(req, { error: 'data_unavailable' }, 502);", "if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);")
m('rights_not_validated_by_handler', HAN, "const rights = validateRights(deps.rights);", "const rights = deps.rights as ReturnType<typeof validateRights>;")
m('events_asked_from_the_issue_time', HAN, "deps.eventsWrittenSince(keys, writtenSinceInstant(stored.generated_at))", "deps.eventsWrittenSince(keys, stored.generated_at)")
m('events_asked_without_overlap_helper', HAN, "writtenSinceInstant(stored.generated_at)", "new Date(Date.parse(stored.generated_at)).toISOString()")
m('data_failure_returns_no_changes', HAN, "if (e instanceof DataUnavailable || e instanceof EventRowUnreadable) return reply(req, { error: 'data_unavailable' }, 502);", "if (e instanceof DataUnavailable || e instanceof EventRowUnreadable) return reply(req, { status: 'OK', result: { changed: [] } });")
m('unreadable_report_returns_no_changes', HAN, "if (e instanceof ReportUnreadable) return reply(req, { error: 'report_unreadable' }, 422);", "if (e instanceof ReportUnreadable) return reply(req, { status: 'OK', result: { changed: [] } });")
m('error_message_echoed', HAN, "return reply(req, { error: 'internal' }, 500); // never the message", "return reply(req, { error: String((e as any)?.message) }, 500);")
m('capability_hides_the_write', HAN, "writes: ['a follow need on a report\\'s private context (follow, unfollow)'],", "writes: [],")
m('capability_claims_no_private_read_false', HAN, "reads_private_context: false,", "reads_private_context: true,")
m('handler_logs_the_report', HAN, "const reportId = typeof b.report_id === 'string'", "console.log(b); const reportId = typeof b.report_id === 'string'")
m('empty_ledger_read_skipped', HAN, "keys.length ? deps.ledger(keys) : Promise.resolve([] as LedgerProject[]),", "Promise.resolve([] as LedgerProject[]),")
# ---- the data layer ----------------------------------------------------------------------------------------------------------------------
m('open_wrong_kind', DAT, "rpc('report_private_context_need_open', { p_context: contextId, p_kind: 'follow', p_ref: followId })", "rpc('report_private_context_need_open', { p_context: contextId, p_kind: 'report', p_ref: followId })")
m('close_wrong_kind', DAT, "rpc('report_private_context_need_close', { p_context: contextId, p_kind: 'follow', p_ref: followId })", "rpc('report_private_context_need_close', { p_context: contextId, p_kind: 'report', p_ref: followId })")
m('open_closes_the_report_need', DAT, "rpc('report_private_context_need_open', { p_context: contextId, p_kind: 'follow', p_ref: followId })", "rpc('report_private_context_need_close', { p_context: contextId, p_kind: 'follow', p_ref: followId })")
m('purge_is_an_outage', DAT, "if (j && j.code === '55000') return 'CONTEXT_PURGED';", "void 0;")
m('any_refusal_is_purged', DAT, "if (j && j.code === '55000') return 'CONTEXT_PURGED';", "return 'CONTEXT_PURGED';")
m('close_failure_ignored', DAT, "if (!r.ok) throw new DataUnavailable('http ' + r.status);\n    },\n  };", "void r;\n    },\n  };")
m('report_id_unvalidated_in_data', DAT, "async report(reportId): Promise<StoredReport | null> {\n      if (!UUID.test(reportId)) throw new DataUnavailable('report id');", "async report(reportId): Promise<StoredReport | null> {")
m('report_selects_everything', DAT, "report_snapshot?select=report_id,content_hash,report_version,generated_at,body&report_id=eq.", "report_snapshot?select=*&report_id=eq.")
m('changes_read_selects_the_handle', DAT, "report_snapshot?select=report_id,content_hash,report_version,generated_at,body&report_id=eq.", "report_snapshot?select=report_id,content_hash,report_version,generated_at,private_context_id,body&report_id=eq.")
m('context_read_selects_the_body', DAT, "report_snapshot?select=private_context_id&report_id=eq.", "report_snapshot?select=private_context_id,body&report_id=eq.")
m('context_id_unvalidated_in_data', DAT, "async reportContext(reportId): Promise<ReportContextRow | null> {\n      if (!UUID.test(reportId)) throw new DataUnavailable('report id');", "async reportContext(reportId): Promise<ReportContextRow | null> {")
m('private_read_function_called', DAT, "rpc('report_private_context_need_open',", "rpc('report_private_context_read',")
m('data_offers_to_mint_ids', DAT, "now?: () => Date };", "now?: () => Date; newId?: () => string };")
m('data_reads_the_environment', DAT, "export type Config =", "const _k = (globalThis as any).Deno?.env?.get('X'); void _k;\nexport type Config =")
m('data_writes_a_table', DAT, "ledger: reads.ledger,", "ledger: async (k) => { await rest('dev_change_project', { method: 'PATCH' } as any); return reads.ledger(k); },")
# ---- the shared reads --------------------------------------------------------------------------------------------------------------------
m('written_since_filters_observed', CHG, "',created_at&material=eq.true&created_at=gt.'", "',created_at&material=eq.true&observed_at=gt.'")
m('written_since_drops_created_at', CHG, "',created_at&material=eq.true&created_at=gt.'", "'&material=eq.true&created_at=gt.'")
m('written_since_is_inclusive_of_all', CHG, "&created_at=gt.' + encodeURIComponent(sinceIso)", "&created_at=gt.' + encodeURIComponent('1970-01-01T00:00:00Z')")
m('ledger_drops_change_ready', CHG, "const cols = 'identity_key,registry_id,comparable,change_ready,", "const cols = 'identity_key,registry_id,comparable,")
m('written_since_reads_raw_events', CHG, "rest('dev_change_event_reportable?select=' + EVENT_COLUMNS + ',created_at&material=eq.true&created_at=gt.'", "rest('dev_change_event?select=' + EVENT_COLUMNS + ',created_at&material=eq.true&created_at=gt.'")
m('written_since_reads_rights_class', CHG, "EVENT_COLUMNS + ',created_at&material=eq.true&created_at=gt.'", "EVENT_COLUMNS + ',rights_class,created_at&material=eq.true&created_at=gt.'")
m('written_since_asks_for_every_event', CHG, "',created_at&material=eq.true&created_at=gt.'", "',created_at&created_at=gt.'")
m('written_since_asks_for_non_material_only', CHG, "&material=eq.true&created_at=gt.'", "&material=eq.false&created_at=gt.'")
# ---- the older guards this feature had to narrow: each must still refuse a SECOND consumer ----------------------------------------------
m('handler_names_the_private_layer', HAN, "const UUID = /^", "const _layer = 'report_private_context'; void _layer;\nconst UUID = /^")
m('data_names_a_third_private_function', DAT, "const UUID = /^", "const _purge = 'report_private_context_purge'; void _purge;\nconst UUID = /^")
m('data_names_the_read_function', DAT, "const UUID = /^", "const _read = 'report_private_context_read'; void _read;\nconst UUID = /^")
m('handler_names_the_snapshot_table', HAN, "const UUID = /^", "const _t = 'report_snapshot'; void _t;\nconst UUID = /^")
m('reader_names_the_snapshot_table', CSR, "const instant = (s: unknown)", "const _t = 'report_snapshot'; void _t;\nconst instant = (s: unknown)")
m('snapshot_read_selects_the_inputs', DAT, "generated_at,body&report_id=eq.", "generated_at,body,engine_inputs&report_id=eq.")
m('snapshot_reader_gets_a_write_verb', DAT, "async function rpc(fn: string, args: Record<string, string>): Promise<Response> {", "const _w = { method: 'PATCH' }; void _w;\n  async function rpc(fn: string, args: Record<string, string>): Promise<Response> {")
m('raw_event_table_named_in_a_comment', CHG, "The ledger's raw event table is never named here,", "The raw public.dev_change_event table is never named here,")
# ---- config, deploy, CI ------------------------------------------------------------------------------------------------------------------
m('follow_jwt_off', CFG, "[functions.follow-development-report]\nverify_jwt = true", "[functions.follow-development-report]\nverify_jwt = false")
m('follow_deploy_exempts_it', DEP, 'if [ "$FN" = "get-address-report" ]; then', 'if [ "$FN" = "get-address-report" ] || [ "$FN" = "follow-development-report" ]; then')
m('follow_roundtrip_dropped_from_workflow', RSW, "bash test/changes_since_report_pg/run.sh 2>&1", "echo skipped 2>&1")
m('follow_workflow_ignores_the_ledger_sql_on_prs', RSW, "      - 'docs/dev-change-ledger.sql'\n      - '.github/workflows/report-snapshot-suite.yml'\n  push:", "      - '.github/workflows/report-snapshot-suite.yml'\n  push:")
m('follow_workflow_ignores_the_ledger_sql_on_push', RSW, "      - 'docs/dev-change-ledger.sql'\n      - '.github/workflows/report-snapshot-suite.yml'\n  workflow_dispatch:", "      - '.github/workflows/report-snapshot-suite.yml'\n  workflow_dispatch:")
m('follow_workflow_ignores_the_reader_on_prs', RSW, "      - 'supabase/functions/_shared/changes-since-report.ts'\n      - 'supabase/functions/_shared/change-reads.ts'\n      - 'supabase/functions/_shared/service-rest.ts'\n      - 'supabase/functions/_shared/admin-gate.ts'\n      - 'supabase/functions/follow-development-report/**'\n      - 'docs/dev-change-reportable.sql'\n      - 'docs/dev-change-ledger.sql'\n      - '.github/workflows/report-snapshot-suite.yml'\n  push:",
  "      - 'docs/dev-change-ledger.sql'\n      - '.github/workflows/report-snapshot-suite.yml'\n  push:")
m('follow_roundtrip_runs_on_any_database', RUN, "case \"$PGDATABASE\" in *disposable*) ;; *) echo \"ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')\"; exit 1;; esac", "true")
m('follow_roundtrip_uses_a_copy_of_the_sql', RUN, 'apply "$root/docs/dev-change-reportable.sql"', 'apply "$here/reportable-copy.sql"')
m('follow_roundtrip_setup_failure_is_silent', RUN, '|| { echo "FAIL — $1 did not apply:"; echo "$out"; exit 3; }', '|| true')
m('follow_roundtrip_skips_the_ledger_fixture', RUN, 'apply "$root/test/dev_change_ledger_pg/fixture.sql"\n', '')
m('follow_roundtrip_standin_forgets_bypassrls', 'test/changes_since_report_pg/standins.sql', "alter role service_role bypassrls;\n", "")
m('follow_roundtrip_accepts_a_credential', RUN, 'if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi', 'true')


def run_tests():
    for t in TESTS:
        r = subprocess.run(['node', str(ROOT / t)], cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            return False, t
    return True, None


def run_roundtrip():
    r = subprocess.run(ROUNDTRIP, cwd=ROOT, capture_output=True, text=True, shell=True)
    return r.returncode == 0


def main():
    args = sys.argv[1:]
    rt_only = '--roundtrip-only' in args
    with_rt = '--roundtrip' in args or rt_only
    only = set(a for a in args if not a.startswith('--'))
    unknown = only - set(M)
    if unknown:
        print('HARNESS — unknown mutation(s): ' + ', '.join(sorted(unknown)))
        return 2
    ok, which = (True, None) if rt_only else run_tests()
    if not ok:
        print('HARNESS — the unmutated tree does not pass ' + which)
        return 2
    if with_rt and not run_roundtrip():
        print('HARNESS — the unmutated tree does not pass the round trip')
        return 2
    survived, harness, skipped = [], [], []
    names = [k for k in M if not only or k in only]
    for name in names:
        if name in ROUNDTRIP_ONLY and not with_rt:
            print('skipped  %-44s needs --roundtrip' % name); skipped.append(name)
            continue
        originals = {}
        try:
            applied = True
            for (file, old, new) in M[name]:
                p = ROOT / file
                originals.setdefault(file, p.read_text())
                text = p.read_text()
                if text.count(old) != 1:
                    print('HARNESS  %-44s anchor matched %d times in %s' % (name, text.count(old), file))
                    harness.append(name); applied = False; break
                p.write_text(text.replace(old, new))
            if not applied:
                continue
            passed, which = (True, None) if rt_only else run_tests()
            if not passed:
                print('killed   %-44s by %s' % (name, which.split('/')[-1]))
            elif with_rt and not run_roundtrip():
                print('killed   %-44s by the round trip%s' % (name, '' if rt_only else ' (offline suites missed it)'))
            else:
                print('SURVIVED %s' % name); survived.append(name)
        finally:
            for file, text in originals.items():
                (ROOT / file).write_text(text)
    ok, which = (True, None) if rt_only else run_tests()
    if not ok:
        print('HARNESS — the tree does not pass after restoring: ' + which)
        return 2
    ran = len(names) - len(skipped)
    print('\n%d mutations run (%d skipped), %d killed, %d survived, %d harness faults' % (ran, len(skipped), ran - len(survived) - len(harness), len(survived), len(harness)))
    if survived:
        print('SURVIVORS: ' + ', '.join(survived))
    return 1 if (survived or harness) else 0


if __name__ == '__main__':
    sys.exit(main())

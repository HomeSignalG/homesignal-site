#!/usr/bin/env python3
"""Prohibited mutations of saved reports (Development Activity build step 6). Each MUST make one of

    test/saved-reports-function.test.mjs                (the report function's list/open actions and its data layer, offline)
    test/saved-reports-structure.test.mjs               (the SQL's shape, the branch's reach, the page's rules)
    test/development-activity-reports.test.mjs          (the customer page, source-level contract)
    test/development-activity-reports.browser.test.mjs  (the customer page in Chromium, against the REAL report function handler)
    test/trial_report_pg/run.sh                         (the real handler and data layer against the real SQL, in a disposable Postgres)

exit non-zero. It edits one file in place, runs the suites, and ALWAYS restores it, even on error or ^C. An anchor that does not match
exactly once is a harness fault, never a pass. Exit 0 if every mutation was killed, 1 if any survived, 2 on a harness fault.
The Postgres suite needs PGHOST and a PGDATABASE whose name contains "disposable" (its own guard refuses anything else).
(Manual, like the other mutation loops: CI runs the tests, not this loop.)

    PGHOST=/var/run/postgresql PGDATABASE=trial_disposable PGUSER=postgres python3 test/development_activity_saved_reports_mutants.py [name ...]
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SQLF = 'docs/saved-reports.sql'
HAND = 'supabase/functions/get-development-activity-report/handler.ts'
DATA = 'supabase/functions/get-development-activity-report/data.ts'
SUBJ = 'supabase/functions/_shared/private-subject.ts'   # build step 8: the one shared reader of a stored report's address and label
READS = 'supabase/functions/_shared/evaluation-reads.ts'
GATE = 'supabase/functions/_shared/admin-gate.ts'
PAGE = 'development-activity-reports.html'
FNT = 'test/saved-reports-function.test.mjs'
STR = 'test/saved-reports-structure.test.mjs'
SRC = 'test/development-activity-reports.test.mjs'
BRO = 'test/development-activity-reports.browser.test.mjs'
PG = 'test/trial_report_pg/run.sh'
M = {}


def m(name, old, new, tests, f):
    assert name not in M, name
    M[name] = (f, old, new, list(tests))


# ---- the SQL: another brokerage's report must never open, and standing is the one the report function uses ------------------------------------
m('open_ignores_the_brokerage', "     and (e.status = 'complete' or (e.status = 'active' and (e.expires_at is null or e.expires_at > now())))\n$$;\n\n-- ---- 3.",
  "     and true\n$$;\n\n-- ---- 3.", [PG, STR], SQLF)
m('open_without_the_id', "   where s.report_id = p_report_id\n", "   where true\n", [PG, STR], SQLF)
m('list_serves_revoked_trials', "   where e.status = 'complete' or (e.status = 'active' and (e.expires_at is null or e.expires_at > now()))\n   order by",
  "   where true\n   order by", [PG], SQLF)
m('list_serves_expired_trials', "(e.status = 'active' and (e.expires_at is null or e.expires_at > now()))\n   order by", "(e.status = 'active')\n   order by", [PG], SQLF)
m('list_oldest_first', "order by c.ordinal desc", "order by c.ordinal asc", [PG], SQLF)
m('list_carries_the_text', "select s.report_id, c.ordinal, s.generated_at, s.private_context_id\n    from public.brokerage_membership_of(p_user_id) r\n    join public.evaluation e on e.brokerage_id = r.brokerage_id\n    join public.evaluation_credit c on c.evaluation_id = e.evaluation_id\n    join public.report_snapshot s on s.report_id = c.report_id\n   where e.status",
  "select s.report_id, c.ordinal, s.generated_at, s.private_context_id\n    from public.brokerage_membership_of(p_user_id) r\n    join public.evaluation e on e.brokerage_id = r.brokerage_id\n    join public.evaluation_credit c on c.evaluation_id = e.evaluation_id\n    join public.report_snapshot s on s.report_id = c.report_id\n   where s.body is not null and e.status", [STR], SQLF)
m('volatile_list', "returns table (report_id uuid, number integer, generated_at timestamptz, private_context_id uuid)\nlanguage sql stable", "returns table (report_id uuid, number integer, generated_at timestamptz, private_context_id uuid)\nlanguage sql volatile", [STR, PG], SQLF)
m('list_open_to_authenticated', "grant execute on function public.evaluation_reports_of(uuid)       to service_role;",
  "grant execute on function public.evaluation_reports_of(uuid)       to service_role, authenticated;", [STR, PG], SQLF)
m('open_open_to_anon', "grant execute on function public.evaluation_report_open(uuid, uuid) to service_role;",
  "grant execute on function public.evaluation_report_open(uuid, uuid) to service_role, anon;", [STR, PG], SQLF)

# ---- the shared module: the id asked for is the id returned; one row; a stored text -----------------------------------------------------------
m('other_id_accepted', " || r.report_id.toLowerCase() !== reportId.toLowerCase()", "", [FNT], READS)
m('second_row_accepted', "if (data.length !== 1 || !r || typeof r.report_id", "if (!r || typeof r.report_id", [FNT], READS)
m('missing_body_accepted', " || typeof r.body !== 'string') {", ") {", [FNT], READS)
m('malformed_id_asked_of_the_database', "      if (!UUID.test(reportId)) return null;\n      const { data, error } = await rpc('evaluation_report_open'", "      const { data, error } = await rpc('evaluation_report_open'", [FNT], READS)
m('database_error_called_not_found', "      if (error) throw new DataUnavailable('evaluation_report_open');", "      if (error) return null;", [FNT, PG], READS)
m('list_unbounded', " || data.length > 1000) throw new DataUnavailable('shape');\n      return data.map(savedRow);", ") throw new DataUnavailable('shape');\n      return data.map(savedRow);", [FNT], READS)
m('list_error_called_empty', "      if (error) throw new DataUnavailable('evaluation_reports_of');", "      if (error) return [];", [FNT], READS)

# ---- the data layer: the address is shown only while the private layer keeps it ---------------------------------------------------------------
m('purged_address_shown', "if (!c || c.state !== 'active') return null;", "if (!c) return null;", [FNT, PG], SUBJ)
m('unreadable_layer_called_no_address', "    if (error || !Array.isArray(data)) throw new DataUnavailable('private context');\n    const c = data.length === 1 ? data[0] : null;\n    if (!c || c.state !== 'active') return null;",
  "    if (error || !Array.isArray(data)) return null;\n    const c = data.length === 1 ? data[0] : null;\n    if (!c || c.state !== 'active') return null;", [FNT], SUBJ)

# ---- the report function: who may ask, what is called, what is charged ------------------------------------------------------------------------
m('admin_may_list', "      if (!trial) return reply(req, { error: 'forbidden' }, 403);\n      try {\n        if (b.action === 'list')",
  "      try {\n        if (b.action === 'list')", [FNT, PG], HAND)
m('unknown_action_accepted', "      if (b.action !== 'list' && b.action !== 'open') return reply(req, { error: 'invalid_request', detail: 'action' }, 400);\n", '', [FNT], HAND)
m('extra_field_accepted', "      const extra = Object.keys(b).filter((k) => !allowed.includes(k));\n      if (extra.length) return reply(req, { error: 'invalid_request', detail: 'unknown field: ' + extra[0] }, 400);\n", '', [FNT], HAND)
m('open_id_unchecked', "if (typeof b.report_id !== 'string' || !UUID.test(b.report_id)) return reply(req, { error: 'invalid_request', detail: 'report_id' }, 400);\n", '', [FNT], HAND)
m('not_found_called_forbidden', "if (!opened) return reply(req, { error: 'not_found' }, 404);", "if (!opened) return reply(req, { error: 'forbidden' }, 403);", [FNT, BRO, PG], HAND)
m('reopen_says_charged', "address: subject.address, client_label: subject.label, header, charged: false,", "address: subject.address, client_label: subject.label, header, charged: true,", [FNT, STR, PG], HAND)
m('reopen_not_marked', "stored: true, reopened: true,", "stored: true,", [FNT, BRO], HAND)
m('stored_text_unparsed_called_ok', "try { stored = JSON.parse(opened.body); } catch { throw new DataUnavailable('stored report'); }", "try { stored = JSON.parse(opened.body); } catch { stored = {}; }", [FNT], HAND)
m('complete_trial_may_make_reports', "    if (trial && trial.complete) return reply(req, { error: 'evaluation_complete', trial: trialSummary(trial.trial) }, 403);\n", '', [FNT, PG], HAND)
m('complete_trial_refused_saved', "    if (b.action !== undefined) {\n      if (b.action !== 'list'", "    if (trial && trial.complete) return reply(req, { error: 'evaluation_complete', trial: trialSummary(trial.trial) }, 403);\n    if (b.action !== undefined) {\n      if (b.action !== 'list'", [FNT, STR, PG], HAND)
m('list_reaches_the_issue_rule', "          const rows = await deps.savedReports(trial.userId);", "          const rows = await deps.savedReports(trial.userId); await deps.issue(trial.userId, 'k', {});", [FNT, STR], HAND)

# ---- the gate: a used-up trial gets through to the handler, an ended one does not -------------------------------------------------------------
m('gate_refuses_complete', "  if (standing !== 'active' && standing !== 'complete') return reply(req, { error: 'forbidden' }, 403);", "  if (standing !== 'active') return reply(req, { error: 'forbidden' }, 403);", [FNT, STR, PG], GATE)
m('gate_lets_ended_through', "  if (standing !== 'active' && standing !== 'complete') return reply(req, { error: 'forbidden' }, 403);\n", '', [FNT, PG], GATE)
m('gate_never_says_complete', "complete: standing === 'complete' };", "complete: false };", [FNT, PG, STR], GATE)

# ---- the customer page ------------------------------------------------------------------------------------------------------------------------
m('card_for_everyone', "showSaved(a === 'trial' || a === 'complete');", "showSaved(true);", [SRC, BRO, STR], PAGE)
m('card_survives_sign_out', "access = null; role = null; attempt = null; showTeam(false); showSaved(false);", "access = null; role = null; attempt = null; showTeam(false);", [SRC, BRO], PAGE)
m('card_survives_a_new_person', "role = null; showTeam(false); showSaved(false); showProfile(false); // another person", "role = null; showTeam(false); showProfile(false); // another person", [SRC, BRO], PAGE)
m('list_kept_in_storage', "    var list = $('saved-list');\n    list.textContent = '';", "    var list = $('saved-list'); try { sessionStorage.setItem('saved', JSON.stringify(body.reports)); } catch (e) {}\n    list.textContent = '';", [SRC, BRO, STR], PAGE)
m('late_list_shown', "    var r = await post(REPORT_FN, { action: 'list' });\n    if (!session || !session.user || session.user.id !== forUser) return; // the person changed while the answer was on its way\n", "    var r = await post(REPORT_FN, { action: 'list' });\n", [SRC, BRO], PAGE)
m('open_sends_the_address', "post(REPORT_FN, { action: 'open', report_id: reportId })", "post(REPORT_FN, { action: 'open', report_id: reportId, address: $('addr').value })", [SRC, BRO, STR], PAGE)
m('open_sends_a_key', "post(REPORT_FN, { action: 'open', report_id: reportId })", "post(REPORT_FN, { action: 'open', report_id: reportId, idempotency_key: crypto.randomUUID() })", [SRC, BRO, STR], PAGE)
m('open_note_hidden', " Opening it did not use a free report.", "", [SRC, BRO, STR], PAGE)
m('purged_address_blank', "(typeof rep.address === 'string' && rep.address ? rep.address : 'address no longer kept')", "(typeof rep.address === 'string' ? rep.address : '')", [BRO], PAGE)
m('new_report_not_listed', "if (body.stored === true) { savedFresh = false; showSaved(true); }", "if (body.stored === true) { }", [BRO], PAGE)
m('open_while_making', "    if (opening || busy || !session || !session.user) return;", "    if (!session || !session.user) return;", [SRC], PAGE)


def run(tests):
    for t in tests:
        if t.endswith('.sh'):
            if not os.environ.get('PGHOST') or 'disposable' not in os.environ.get('PGDATABASE', ''):
                return None, t, 'PGHOST / a disposable PGDATABASE are not set'
            cmd = ['bash', str(ROOT / t)]
        else:
            cmd = ['node', '--experimental-strip-types', str(ROOT / t)]
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=900)
        out = r.stdout + r.stderr
        if 'SyntaxError' in out:
            return None, t, 'SyntaxError'
        if r.returncode != 0:
            first = next((ln for ln in out.splitlines() if ln.startswith('FAIL')), 'exit %d' % r.returncode)
            return False, t, first[:150]
    return True, None, None


def main():
    only = set(sys.argv[1:])
    if only - set(M):
        print('HARNESS — unknown mutation(s): ' + ', '.join(sorted(only - set(M))))
        return 2
    passed, which, line = run([FNT, STR, SRC, BRO, PG])
    if not passed:
        print('HARNESS — the unmutated tree does not pass %s (%s)' % (which, line))
        return 2
    originals = {f: (ROOT / f).read_text() for f in {v[0] for v in M.values()}}
    survived, harness = [], []
    names = [k for k in M if not only or k in only]
    try:
        for name in names:
            f, old, new, tests = M[name]
            original = originals[f]
            if original.count(old) != 1:
                print('HARNESS  %-38s anchor matched %d times' % (name, original.count(old)))
                harness.append(name)
                continue
            (ROOT / f).write_text(original.replace(old, new))
            passed, which, line = run(tests)
            (ROOT / f).write_text(original)
            if passed is None:
                print('HARNESS  %-38s %s' % (name, line))
                harness.append(name)
            elif passed:
                print('SURVIVED %-38s' % name)
                survived.append(name)
            else:
                print('killed   %-38s by %s: %s' % (name, Path(which).name, line))
    finally:
        for f, original in originals.items():
            (ROOT / f).write_text(original)
    print('\n%d mutation(s): %d killed, %d survived, %d harness fault(s)' % (len(names), len(names) - len(survived) - len(harness), len(survived), len(harness)))
    return 2 if harness else (1 if survived else 0)


if __name__ == '__main__':
    sys.exit(main())

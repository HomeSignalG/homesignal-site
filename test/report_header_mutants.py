#!/usr/bin/env python3
"""Prohibited mutations of the report header (Development Activity build step 7). Each MUST make one of

    test/national-report-function.test.mjs              (the report function's handler and data layer, offline: header on every trial report)
    test/saved-reports-function.test.mjs                (the list/open actions and the private-layer reader, offline)
    test/report-header-structure.test.mjs               (the SQL's shape, the one module that reaches it, nothing stores a name, the page's rules)
    test/development-activity-reports.test.mjs          (the customer page, source-level contract)
    test/development-activity-reports.browser.test.mjs  (the customer page in Chromium, against the REAL report function handler)
    test/trial_report_pg/run.sh                         (the real handler and data layer against the real SQL, in a disposable Postgres)

exit non-zero. It edits one file in place, runs the suites, and ALWAYS restores it, even on error or ^C. An anchor that does not match
exactly once is a harness fault, never a pass. A mutation may be several (old, new) pairs in ONE file; each must match exactly once.
Exit 0 if every mutation was killed, 1 if any survived, 2 on a harness fault.
The Postgres suite needs PGHOST and a PGDATABASE whose name contains "disposable" (its own guard refuses anything else).
(Manual, like the other mutation loops: CI runs the tests, not this loop.)

    PGHOST=/var/run/postgresql PGDATABASE=trial_disposable PGUSER=postgres python3 test/report_header_mutants.py [name ...]
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SQLF = 'docs/report-header.sql'
HAND = 'supabase/functions/get-development-activity-report/handler.ts'
DATA = 'supabase/functions/get-development-activity-report/data.ts'
SUBJ = 'supabase/functions/_shared/private-subject.ts'   # build step 8: the one shared reader of a stored report's address and label
READS = 'supabase/functions/_shared/evaluation-reads.ts'
PAGE = 'development-activity-reports.html'
NRF = 'test/national-report-function.test.mjs'
FNT = 'test/saved-reports-function.test.mjs'
HST = 'test/report-header-structure.test.mjs'
SRC = 'test/development-activity-reports.test.mjs'
BRO = 'test/development-activity-reports.browser.test.mjs'
PG = 'test/trial_report_pg/run.sh'
BS = chr(92)  # a backslash-u written out here would be turned into a character by the tools that write this file
U = lambda h: BS + 'u' + h
M = {}


def m(name, old, new, tests, f):
    assert name not in M, name
    M[name] = (f, [(old, new)], list(tests))


def mm(name, pairs, tests, f):
    assert name not in M, name
    M[name] = (f, list(pairs), list(tests))


# ---- the SQL: only the caller's own membership, only a name, read-only, system-only -----------------------------------------------------------
m('sql_ignores_membership', "from public.brokerage_membership_of(p_user_id) r\n    join public.brokerage_account a on a.id = r.brokerage_id",
  "from (select id as brokerage_id from public.brokerage_account) r\n    join public.brokerage_account a on a.id = r.brokerage_id", [PG, HST], SQLF)
m('sql_reads_the_email', "u.raw_user_meta_data ->> 'full_name'", "u.email", [PG, HST], SQLF)
m('sql_every_user_joined', "left join auth.users u on u.id = p_user_id", "left join auth.users u on true", [PG, HST], SQLF)
m('sql_volatile', "language sql stable security definer", "language sql volatile security definer", [PG, HST], SQLF)
m('sql_no_pinned_search_path', "language sql stable security definer set search_path = public, pg_temp", "language sql stable security definer", [HST], SQLF)
m('sql_open_to_authenticated', "grant execute on function public.report_header_of(uuid) to service_role;", "grant execute on function public.report_header_of(uuid) to service_role, authenticated;", [PG, HST], SQLF)
m('sql_open_to_anon', "grant execute on function public.report_header_of(uuid) to service_role;", "grant execute on function public.report_header_of(uuid) to service_role, anon;", [PG, HST], SQLF)

# ---- the shared module: the one place a name is made safe to print, and a header that cannot be read is a fault -------------------------------
m('clean_misses_direction_controls', U('2028') + '-' + U('202e'), U('2028') + '-' + U('2029'), [NRF], READS)
m('clean_keeps_runs_of_spaces', "replace(/" + BS + "s+/g, ' ').trim();\n  return s &&", "trim();\n  return s &&", [NRF], READS)
m('clean_truncates', "return s && Array.from(s).length <= max ? s : null;", "return s ? Array.from(s).slice(0, max).join('') : null;", [NRF, HST], READS)
m('agent_limit_raised', "AGENT_NAME_MAX = 80", "AGENT_NAME_MAX = 120", [NRF, HST], READS)
m('header_error_called_empty', "if (error) throw new DataUnavailable('report_header_of');", "if (error) return { brokerage: null, agent: null };", [NRF, HST], READS)
m('header_two_rows_accepted', "if (!Array.isArray(data) || data.length > 1) throw new DataUnavailable('shape');\n      if (data.length === 0) return { brokerage: null, agent: null };",
  "if (!Array.isArray(data)) throw new DataUnavailable('shape');\n      if (data.length === 0) return { brokerage: null, agent: null };", [NRF, HST], READS)
m('header_names_unchecked', "if (!r || !text(r.brokerage_name) || !text(r.agent_name)) throw new DataUnavailable('shape');", "if (!r) throw new DataUnavailable('shape');", [NRF], READS)

# ---- the data layer ---------------------------------------------------------------------------------------------------------------------------
m('label_uncleaned', "label: cleanDisplayName(c.label, labelMax)", "label: typeof c.label === 'string' ? c.label : null", [FNT, HST], SUBJ)
m('header_stubbed', "headerOf: evaluation.reportHeader,", "headerOf: async () => ({ brokerage: null, agent: null }),", [PG, HST], DATA)

# ---- the handler: on every trial report, read before the charge, never in what is stored, never for an admin ----------------------------------
m('header_not_sent', "          ...trialInfo,\n          ...headerInfo,\n", "          ...trialInfo,\n", [NRF, HST], HAND)
m('header_not_on_replay', "credit, charged: false, replayed: true, ...used, ...headerInfo,", "credit, charged: false, replayed: true, ...used,", [NRF, HST], HAND)
m('header_not_on_stored', "credit, charged: true, replayed: false, ...used, ...headerInfo,", "credit, charged: true, replayed: false, ...used,", [NRF, PG, HST], HAND)
m('header_for_an_admin', "const headerInfo = trial ? { header: await deps.headerOf(trial.userId) } : {};", "const headerInfo = { header: await deps.headerOf(trial ? trial.userId : '') };", [NRF], HAND)
m('header_failure_called_empty', "const headerInfo = trial ? { header: await deps.headerOf(trial.userId) } : {};",
  "const headerInfo = trial ? { header: await deps.headerOf(trial.userId).catch(() => ({ brokerage: null, agent: null })) } : {};", [NRF], HAND)
mm('header_read_after_the_charge', [
  ("const headerInfo = trial ? { header: await deps.headerOf(trial.userId) } : {};", "let headerInfo: Record<string, unknown> = {};"),
  ("      const used = c.allotment === 'paid'\n", "      headerInfo = trial ? { header: await deps.headerOf(trial.userId) } : {};\n      const used = c.allotment === 'paid'\n")], [NRF, HST], HAND)
m('open_without_header', "address: subject.address, client_label: subject.label, header, charged: false,", "address: subject.address, client_label: subject.label, charged: false,", [FNT, PG, BRO, HST], HAND)
m('open_without_label', "address: subject.address, client_label: subject.label, header, charged: false,", "address: subject.address, client_label: null, header, charged: false,", [PG, BRO], HAND)
m('open_header_unread', "        const header = await deps.headerOf(trial.userId);\n", "        const header = { brokerage: null, agent: null };\n", [FNT, PG, HST], HAND)
m('list_carries_the_label', "address: (await deps.subjectOf(r.private_context_id)).address,", "address: (await deps.subjectOf(r.private_context_id)).address, client_label: (await deps.subjectOf(r.private_context_id)).label,", [FNT, PG], HAND)

# ---- the customer page ------------------------------------------------------------------------------------------------------------------------
m('page_header_not_shown_on_make', "{ subject: address, label: field('label'), brokerage: hd.brokerage, agent: hd.agent, live:", "{ subject: address, label: field('label'), live:", [SRC, BRO, HST], PAGE)
m('page_header_not_shown_on_reopen', "label: typeof body.client_label === 'string' ? body.client_label : '',\n      brokerage: hd.brokerage, agent: hd.agent, live: canShare", "label: typeof body.client_label === 'string' ? body.client_label : '',\n      live: canShare", [BRO, HST], PAGE)
m('page_label_not_sent', "    if (clientLabel) payload.label = clientLabel;\n", "", [BRO, HST], PAGE)
m('page_name_kept_in_storage', "      $('agent-name').value = name;\n      profileSay(name ?", "      $('agent-name').value = name; try { sessionStorage.setItem('hs-agent-name', name); } catch (e) {}\n      profileSay(name ?", [BRO, HST], PAGE)
m('page_name_saved_unclean', "var name = ($('agent-name').value || '').replace(/" + BS + "s+/g, ' ').trim();", "var name = ($('agent-name').value || '');", [BRO], PAGE)
m('page_overlong_name_sent', "    if (name.length > 80) { profileSay('Use 80 characters or fewer.', true); return; }\n", "", [BRO], PAGE)
m('page_save_sets_more_than_the_name', "client.auth.updateUser({ data: { full_name: name } })", "client.auth.updateUser({ data: { full_name: name, role: 'owner' } })", [BRO, HST], PAGE)
m('page_card_for_everyone', "showProfile(a === 'trial' || a === 'complete');", "showProfile(true);", [BRO, HST], PAGE)
m('page_card_survives_sign_out', "attempt = null; showTeam(false); showSaved(false); showProfile(false);", "attempt = null; showTeam(false); showSaved(false);", [BRO, HST], PAGE)
m('page_card_survives_a_new_person', "showSaved(false); showProfile(false); hideBilling(); hideShare(); hideWatch(); // another person", "showSaved(false); hideBilling(); hideShare(); hideWatch(); // another person", [BRO, HST], PAGE)
m('page_typing_overwritten', "if (was) $('agent-name').value = ownName();", "$('agent-name').value = ownName();", [BRO], PAGE)
m('page_late_save_shown', "    if (!session || !session.user || session.user.id !== forUser) return; // the person changed while the answer was on its way\n    if (res && !res.error) {",
  "    if (res && !res.error) {", [BRO], PAGE)
m('page_failed_save_called_saved', "    if (res && !res.error) {\n      $('agent-name').value = name;", "    if (res) {\n      $('agent-name').value = name;", [BRO], PAGE)


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
    passed, which, line = run([NRF, FNT, HST, SRC, BRO, PG])
    if not passed:
        print('HARNESS — the unmutated tree does not pass %s (%s)' % (which, line))
        return 2
    originals = {f: (ROOT / f).read_text() for f in {v[0] for v in M.values()}}
    survived, harness = [], []
    names = [k for k in M if not only or k in only]
    try:
        for name in names:
            f, pairs, tests = M[name]
            original = originals[f]
            mutated, fault = original, None
            for old, new in pairs:
                if mutated.count(old) != 1:
                    fault = 'anchor matched %d times: %r' % (mutated.count(old), old[:60])
                    break
                mutated = mutated.replace(old, new)
            if fault is None and mutated == original:
                fault = 'the mutation changes nothing'
            if fault:
                print('HARNESS  %-38s %s' % (name, fault))
                harness.append(name)
                continue
            (ROOT / f).write_text(mutated)
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

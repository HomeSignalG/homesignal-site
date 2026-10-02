#!/usr/bin/env python3
"""Prohibited mutations of creating a brokerage's trial (Development Activity build step 5d). Each MUST make one of

    test/development-activity-review.test.mjs           (the review page, source-level contract)
    test/development-activity-review.browser.test.mjs   (the review page in Chromium, against the REAL trial function handler)
    test/development-activity-trial-function.test.mjs   (the trial function, offline, with its real data layer)
    test/single-customer-generation-path.test.mjs       (P4/P5i/P5j: who may name the trial function, and create stays admin-only)
    test/development-activity-reports.browser.test.mjs  (the customer page opens the exact link the function makes)
    test/evaluation-entitlement-structure.test.mjs      (§4: the shared module names exactly the database functions it calls)

exit non-zero. It edits one file in place, runs the suites, and ALWAYS restores it, even on error or ^C. An anchor that does not match
exactly once is a harness fault, never a pass. Exit 0 if every mutation was killed, 1 if any survived, 2 on a harness fault.
(Manual, like the other mutation loops: CI runs the node tests, not this loop.)

    python3 test/development_activity_trial_create_mutants.py [name ...]
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = 'development-activity-review.html'
FN = 'supabase/functions/development-activity-trial/handler.ts'
READS = 'supabase/functions/_shared/evaluation-reads.ts'
SRC = 'test/development-activity-review.test.mjs'
BRO = 'test/development-activity-review.browser.test.mjs'
FNT = 'test/development-activity-trial-function.test.mjs'
GEN = 'test/single-customer-generation-path.test.mjs'
RBRO = 'test/development-activity-reports.browser.test.mjs'
ESTR = 'test/evaluation-entitlement-structure.test.mjs'
M = {}


def m(name, old, new, tests, f):
    assert name not in M, name
    M[name] = (f, old, new, list(tests))


# ---- the function: an admin's act, every field checked, the answer is the link and nothing else ------------------------------------------
m('create_open_to_everyone', "        if (!who.admin) return reply(req, { error: 'forbidden' }, 403);\n", '', [FNT, GEN], FN)
m('fields_read_before_the_admin_check',
  "        if (!who.admin) return reply(req, { error: 'forbidden' }, 403);\n        const wanted = trialRequest(body as Record<string, unknown>, deps.now());\n",
  "        const wanted = trialRequest(body as Record<string, unknown>, deps.now());\n        if (!who.admin) return reply(req, { error: 'forbidden' }, 403);\n", [FNT, GEN], FN)
m('name_not_trimmed', "body.brokerage_name.trim() : ''", "body.brokerage_name : ''", [FNT], FN)
m('name_length_unchecked', ' || name.length > NAME_MAX', '', [FNT], FN)
m('control_characters_allowed', ' || /[\\u0000-\\u001f\\u007f]/.test(name)', '', [FNT], FN)
m('negative_seats_allowed', '(seats as number) >= 0', '(seats as number) >= -1000', [FNT], FN)
m('seats_as_text_allowed', 'Number.isInteger(seats)', 'Number.isInteger(Number(seats))', [FNT], FN)
m('days_unbounded', '(days as number) <= DAYS_MAX', '(days as number) <= 100000', [FNT], FN)
m('seat_limit_invented', 'seatLimit: seats === undefined || seats === null ? null :', 'seatLimit: seats === undefined || seats === null ? 5 :', [FNT], FN)
m('end_date_invented', 'expiresAt: days === undefined || days === null ? null :',
  'expiresAt: days === undefined || days === null ? new Date(now.getTime() + 30 * DAY_MS).toISOString() :', [FNT], FN)
m('raw_token_in_the_answer', '          invite_link: made.invite_link, invite_expires_at: made.invite_expires_at,',
  "          invite_link: made.invite_link, invite_expires_at: made.invite_expires_at, invite_token: made.invite_link.split('#invite=')[1],", [FNT], FN)
m('refusal_called_unavailable', "          if (e instanceof TrialRejected) return reply(req, { error: 'rejected' }, 422);\n", '', [FNT, BRO], FN)

# ---- the shared module: the one form of the link, and what reaches the database -----------------------------------------------------------------
m('link_in_the_query_string', "  return INVITE_PAGE + '#invite=' + token;", "  return INVITE_PAGE + '?invite=' + token;", [FNT, RBRO], READS)
m('link_to_another_host', "export const INVITE_PAGE = 'https://homesignal.net/development-activity-reports.html';",
  "export const INVITE_PAGE = 'https://homesignal.org/development-activity-reports.html';", [FNT, RBRO], READS)
m('malformed_token_made_into_a_link', '  if (!INVITE_TOKEN.test(token)) throw new DataUnavailable(\'shape\');\n  return INVITE_PAGE', '  return INVITE_PAGE', [FNT], READS)
m('invite_lifetime_set_here', "p_seat_limit: t.seatLimit, p_expires_at: t.expiresAt });", "p_seat_limit: t.seatLimit, p_expires_at: t.expiresAt, p_invite_ttl: '90 days' });", [FNT], READS)
m('database_refusal_called_unavailable', "      if (error) throw new TrialRejected('refused');", "      if (error) throw new DataUnavailable('refused');", [FNT], READS)
m('second_database_function_called', "      const { data, error } = await rpc('evaluation_create', {",
  "      await rpc('evaluation_invite_mint', { p_evaluation_id: null, p_role: 'agent' }).catch(() => null);\n      const { data, error } = await rpc('evaluation_create', {", [ESTR], READS)
m('two_rows_accepted', "      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');\n      const r = data[0];\n      if (!r || typeof r.owner_token",
  "      if (!Array.isArray(data) || data.length === 0) throw new DataUnavailable('shape');\n      const r = data[0];\n      if (!r || typeof r.owner_token", [FNT], READS)

# ---- the review page: shows the function's answer once, keeps it nowhere, says plainly what happened ---------------------------------------------
m('page_builds_the_link', "      $('tlink').value = link;", "      $('tlink').value = 'https://homesignal.net/development-activity-reports.html#invite=' + link.split('#invite=')[1];", [SRC, GEN], PAGE)
m('link_kept_in_storage', "      $('tlink').value = link;", "      $('tlink').value = link; try { sessionStorage.setItem('owner-link', link); } catch (e) {}", [SRC, BRO], PAGE)
m('link_survives_sign_out', "      $('tresult').hidden = true; $('tlink').value = ''; $('tnote').textContent = '';\n    }", "\n    }", [SRC, BRO], PAGE)
m('lost_answer_called_a_failure', '      tsay(UNKNOWN, true);\n      return;', "      tsay('The database refused to create this trial. Nothing was created.', true);\n      return;", [SRC, BRO], PAGE)
m('blank_seats_sent_as_zero', '    if (seats !== null) payload.seat_limit = seats;', '    payload.seat_limit = seats || 0;', [SRC, BRO], PAGE)
m('second_press_while_in_flight', '    if (creating) return;\n    var name', '    var name', [SRC], PAGE)
m('form_kept_after_creating', "      $('tname').value = ''; $('tseats').value = ''; $('tdays').value = '';\n", '', [BRO], PAGE)
m('waiting_trial_forgotten_after_sign_in', '      if (pendingTrial) { pendingTrial = false; createTrial(); }\n', '', [BRO], PAGE)
m('page_asks_for_another_action', "    var payload = { action: 'create', brokerage_name: name };", "    var payload = { action: 'status', brokerage_name: name };", [SRC, GEN], PAGE)
m('public_key_instead_of_the_admin_token', "'Authorization': 'Bearer ' + session.access_token, 'apikey': SB_ANON },\n        body: JSON.stringify(payload)",
  "'Authorization': 'Bearer ' + SB_ANON, 'apikey': SB_ANON },\n        body: JSON.stringify(payload)", [SRC, BRO], PAGE)
m('words_disagree_with_the_function', 'up to 120 characters, on one line', 'up to 200 characters, on one line', [SRC], PAGE)
m('copy_copies_nothing', "    var v = $('tlink').value;\n    if (!v) return;", "    var v = $('tlink').value;\n    if (v) return;", [BRO], PAGE)
m('unknown_shown_as_success', "    tsay(trialMessage(httpStatus, body) || UNKNOWN, true);", "    tsay(trialMessage(httpStatus, body) || 'Trial created.', false);", [SRC, BRO], PAGE)


def run(tests):
    for t in tests:
        r = subprocess.run(['node', str(ROOT / t)], cwd=ROOT, capture_output=True, text=True, timeout=600)
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
    passed, which, line = run([SRC, BRO, FNT, GEN, RBRO, ESTR])
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

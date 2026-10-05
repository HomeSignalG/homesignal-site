#!/usr/bin/env python3
"""Prohibited mutations of the customer page and the trial function (Development Activity build step 5c). Each MUST make one of

    test/development-activity-reports.test.mjs          (the page, source-level contract)
    test/development-activity-reports.browser.test.mjs  (the page in Chromium, against the real handlers' responses)
    test/development-activity-trial-function.test.mjs   (the trial function, offline, with its real data layer)

exit non-zero. It edits one file in place, runs the suites, and ALWAYS restores it, even on error or ^C. An anchor that does not match
exactly once is a harness fault, never a pass. Exit 0 if every mutation was killed, 1 if any survived, 2 on a harness fault.
(Manual, like the other mutation loops: CI runs the node tests, not this loop.)

    python3 test/development_activity_reports_mutants.py [name ...]
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = 'development-activity-reports.html'
FN = 'supabase/functions/development-activity-trial/handler.ts'
READS = 'supabase/functions/_shared/evaluation-reads.ts'
GATE = 'supabase/functions/_shared/admin-gate.ts'
SRC = 'test/development-activity-reports.test.mjs'
BRO = 'test/development-activity-reports.browser.test.mjs'
FNT = 'test/development-activity-trial-function.test.mjs'
GEN = 'test/single-customer-generation-path.test.mjs'
M = {}


def m(name, old, new, tests=(SRC, BRO), f=PAGE):
    assert name not in M, name
    M[name] = (f, old, new, list(tests))


# ---- the page: reached only by invite, customer view only, keys only the signed-in person's ---------------------------------------------
m('indexable', '<meta name="robots" content="noindex, nofollow">', '<meta name="robots" content="index, follow">')
m('sends_a_referrer', '<meta name="referrer" content="no-referrer">\n', '')
m('no_account_creation', 'shouldCreateUser:true', 'shouldCreateUser:false')
m('anon_key_only_no_user_token', "'Authorization': 'Bearer ' + session.access_token", "'Authorization': 'Bearer ' + SB_ANON")
m('asks_for_the_internal_view', "var payload = { address: address, view: 'customer' };", "var payload = { address: address, view: 'customer' }; payload.view = 'inter' + 'nal';")
m('sends_a_radius', "var payload = { address: address, view: 'customer' };", "var payload = { address: address, view: 'customer', radius_mi: 1 };")
m('reads_a_table', "    var payload = { address: address, view: 'customer' };\n", "    var payload = { address: address, view: 'customer' }; client.from('app_projects').select('id').limit(1);\n")
m('second_endpoint', "  var TRIAL_FN = SB_URL + '/functions/v1/development-activity-trial';",
  "  var TRIAL_FN = SB_URL + '/functions/v1/development-activity-trial'; fetch('https://example.com/beacon').catch(function(){});")
m('remembers_the_address', "    var payload = { address: address, view: 'customer' };\n",
  "    var payload = { address: address, view: 'customer' }; try { localStorage.setItem('da-addr', address); } catch (e) {}\n")

# ---- the invite --------------------------------------------------------------------------------------------------------------------------------
m('invite_from_the_query_string', "var m = /(?:^#|&)invite=([^&]+)/.exec(location.hash || '');", "var m = /(?:^\\?|&)invite=([^&]+)/.exec(location.search || '');")
m('invite_left_in_the_address_bar', "    if (m) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }\n", '')
m('invite_kept_after_use', '      invite = null; store(null);\n', '      invite = null;\n', [BRO])
m('invite_redeemed_on_every_auth_event', '      if (session.user && session.user.id !== was) {\n', '      if (session.user) {\n', [BRO])
m('unusable_invite_unexplained', "    invite_unusable: 'That invite link cannot be used: it may have expired, been used by someone else, or been withdrawn.',\n", '', [BRO])
m('malformed_invite_sent', '    if (INVITE.test(fromHash)) { store(fromHash); return fromHash; }', '    if (fromHash) { store(fromHash); return fromHash; }', [SRC])

# ---- the report request's key ------------------------------------------------------------------------------------------------------------------
m('new_key_every_press', '    if (!attempt || attempt.address !== address) attempt = { key: newKey(), address: address };',
  '    attempt = { key: newKey(), address: address };')
m('key_kept_after_an_answer', '    attempt = null; // the server answered: this request is finished\n', '', [BRO])
m('key_sent_for_an_admin', "    if (access !== 'admin') payload.idempotency_key = attempt.key;", '    payload.idempotency_key = attempt.key;')
m('key_not_random', "    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();\n",
  "    return '00000000-0000-4000-8000-' + String(Date.now()).slice(-12).padStart(12, '0');\n")

# ---- what the person is told -------------------------------------------------------------------------------------------------------------------
m('reports_offered_to_everyone', "    $('go').disabled = busy || !canMake();", "    $('go').disabled = busy;")
m('count_not_updated_after_a_report', "      showTrial(body.trial.status === 'complete' ? 'complete' : 'trial', body.trial, '');\n", '', [BRO])
m('charge_decided_on_the_page', '    if (body.charged === true) return', '    if (body.report && body.report.projects && body.report.projects.length > 0) return')
m('no_data_ingested_unexplained', "    if (c && c.reason === 'NO_DATA_INGESTED') return 'This report did not use ' + oneOf() + ': No data ingested.';\n", '', [BRO])
m('replay_called_a_new_charge', "    if (body.replayed === true) return 'This is the report you already made for this address. It did not use another ' + (paid ? 'report' : 'free report') + '.';\n", '', [BRO])
m('trial_used_up_unexplained', "    if (httpStatus === 403 && body.error === 'evaluation_complete') return freeLimit === null ? \"All of your brokerage's free reports are used.\" : \"All \" + freeLimit + \" of your brokerage's free reports are used.\";\n", '', [SRC])
m('prints_the_raw_code', '    if (!ok) { say(messageFor(r.status, body), true); return; }',
  '    if (!ok) { say(String(body.error || body.status || r.status), true); return; }')

# ---- the trial function -------------------------------------------------------------------------------------------------------------------------
m('fn_body_read_before_the_gate', "    // who is asking, settled before anything they sent is read\n    const who = await authorizeSignedIn(req, deps);\n    if (who instanceof Response) return who;\n\n    const body = await readBounded(req);\n",
  "    const body = await readBounded(req);\n    const who = await authorizeSignedIn(req, deps);\n    if (who instanceof Response) return who;\n\n", [FNT, GEN], FN)
m('fn_admin_not_reported', "  const access = admin ? 'admin' : standing", "  const access = false ? 'admin' : standing", [FNT, BRO], FN)
m('fn_used_up_reported_active', "standing === 'active' ? 'trial' : standing;", "standing === 'ended' ? 'ended' : 'trial';", [FNT, BRO], FN)
m('fn_long_token_reaches_the_database', '        if (typeof token !== \'string\' || token.length > 100) return', '        if (typeof token !== \'string\') return', [FNT], FN)
m('fn_seat_limit_unnamed', "          if (e instanceof SeatLimitReached) return reply(req, { error: 'seat_limit_reached' }, 409);\n", '', [FNT], FN)
m('fn_trial_read_before_joining', "        let joined: Redeemed;\n", "        await deps.trialOf(who.userId);\n        let joined: Redeemed;\n", [FNT], FN)
m('reads_ids_leak', "      return { role: r.role, replayed: r.replayed };", '      return r;', [FNT], READS)
m('reads_outage_called_unusable', "        throw new DataUnavailable('evaluation_invite_redeem');", "        throw new InviteUnusable('evaluation_invite_redeem');", [FNT], READS)
m('reads_no_shape_check', "      if (!r || (r.role !== 'owner' && r.role !== 'agent') || typeof r.replayed !== 'boolean') throw new DataUnavailable('shape');\n", '', [FNT], READS)
m('gate_expiry_ignored', "  if (t.status === 'active' && !t.expired) return 'active';", "  if (t.status === 'active') return 'active';", [FNT], GATE)


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
    passed, which, line = run([SRC, BRO, FNT])
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

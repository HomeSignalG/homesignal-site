#!/usr/bin/env python3
"""Prohibited mutations of the private review page (development-activity-review.html, build step 4). Each MUST make one of

    test/development-activity-review.test.mjs          (source-level contract)
    test/development-activity-review.browser.test.mjs  (the page in Chromium, against the real handler's responses)

exit non-zero. It edits the page in place, runs the suites, and ALWAYS restores it, even on error or ^C. An anchor that does not match
exactly once is a harness fault, never a pass. Exit 0 if every mutation was killed, 1 if any survived, 2 on a harness fault.
(Manual, like the other mutation loops: CI runs the node tests, not this loop.)

    python3 test/development_activity_review_mutants.py [name ...]
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = 'development-activity-review.html'
SRC = 'test/development-activity-review.test.mjs'
BRO = 'test/development-activity-review.browser.test.mjs'
M = {}


def m(name, old, new, tests=(SRC, BRO)):
    assert name not in M, name
    M[name] = (old, new, list(tests))


m('indexable', '<meta name="robots" content="noindex, nofollow">', '<meta name="robots" content="index, follow">')
m('creates_accounts', 'shouldCreateUser:false', 'shouldCreateUser:true')
m('anon_key_only_no_user_token', "'Authorization': 'Bearer ' + session.access_token", "'Authorization': 'Bearer ' + SB_ANON")
m('sends_a_radius', 'body: JSON.stringify({ address: address, view: view })', 'body: JSON.stringify({ address: address, view: view, radius_mi: 1 })')
m('sends_the_label', 'body: JSON.stringify({ address: address, view: view })', "body: JSON.stringify({ address: address, view: view, label: field('label') })")
m('remembers_the_address', "    var view = viewChoice();\n", "    var view = viewChoice(); try { localStorage.setItem('da-addr', address); } catch (e) {}\n")
m('reads_a_table', "    var view = viewChoice();\n", "    var view = viewChoice(); client.from('app_projects').select('id').limit(1);\n")
m('no_resume_after_sign_in', '      if (pending) { pending = false; run(); }\n', '', [BRO])
m('calls_while_signed_out', "    if (!session) { pending = true; say('Sign in to make a report.', false); openAuth(); return; }\n", '', [BRO])
m('prints_the_raw_code', "    if (!ok) { say(messageFor(httpStatus, body), true); return; }",
  "    if (!ok) { say(String((body && (body.error || body.status)) || httpStatus), true); return; }")
m('admin_refusal_unexplained', "    if (httpStatus === 403) return 'This account is not on the HomeSignal admin list, so it cannot make reports here.';\n", '', [BRO])
m('zip_not_named', "'That address is in ZIP ' + (typeof body.zip === 'string' && /^\\d{5}$/.test(body.zip) ? body.zip : '(unknown)') + ', which HomeSignal does not cover yet.'",
  "'That address is not covered yet.'", [BRO])
m('no_page_side_address_check', "    if (address.length < 8 || address.indexOf(' ') < 0) { say('Enter a full street address with the city and state.', true); $('addr').focus(); return; }\n", '', [BRO])
m('header_fields_dropped', "    var opts = { subject: address, label: field('label'), brokerage: field('brokerage'), agent: field('agent') };",
  "    var opts = { subject: address };", [BRO])
m('report_not_drawn_by_the_view', "    if (!V || !V.mount($('report'), body, opts))", "    if (!V || !($('report').textContent = JSON.stringify(body.report.sections)))")
m('wrong_view_sent', "  function viewChoice(){ var v=document.querySelector('input[name=\"view\"]:checked'); return v ? v.value : 'internal'; }",
  "  function viewChoice(){ return 'internal'; }", [BRO])
m('second_endpoint', "  var FN = SB_URL + '/functions/v1/get-development-activity-report';",
  "  var FN = SB_URL + '/functions/v1/get-development-activity-report'; fetch('https://example.com/beacon').catch(function(){});")


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
    p = ROOT / PAGE
    original = p.read_text()
    passed, which, line = run([SRC, BRO])
    if not passed:
        print('HARNESS — the unmutated page does not pass %s (%s)' % (which, line))
        return 2
    survived, harness = [], []
    names = [k for k in M if not only or k in only]
    try:
        for name in names:
            old, new, tests = M[name]
            if original.count(old) != 1:
                print('HARNESS  %-32s anchor matched %d times' % (name, original.count(old)))
                harness.append(name)
                continue
            p.write_text(original.replace(old, new))
            passed, which, line = run(tests)
            p.write_text(original)
            if passed is None:
                print('HARNESS  %-32s %s' % (name, line))
                harness.append(name)
            elif passed:
                print('SURVIVED %-32s' % name)
                survived.append(name)
            else:
                print('killed   %-32s by %s: %s' % (name, Path(which).name, line))
    finally:
        p.write_text(original)
    print('\n%d mutation(s): %d killed, %d survived, %d harness fault(s)' % (len(names), len(names) - len(survived) - len(harness), len(survived), len(harness)))
    return 2 if harness else (1 if survived else 0)


if __name__ == '__main__':
    sys.exit(main())

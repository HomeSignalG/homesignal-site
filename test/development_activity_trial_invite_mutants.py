#!/usr/bin/env python3
"""Prohibited mutations of an owner inviting agents (Development Activity build step 5e). Each MUST make one of

    test/development-activity-trial-function.test.mjs   (the trial function, offline, with its real data layer)
    test/development-activity-reports.test.mjs          (the customer page, source-level contract)
    test/development-activity-reports.browser.test.mjs  (the customer page in Chromium, against the REAL trial function handler)
    test/evaluation-entitlement-structure.test.mjs      (4-mint: the one mint call is an AGENT invite with the person as ACTOR)
    test/trial_report_pg/run.sh                         (the real handler and data layer against the real SQL, in a disposable Postgres)

exit non-zero. It edits one file in place, runs the suites, and ALWAYS restores it, even on error or ^C. An anchor that does not match
exactly once is a harness fault, never a pass. Exit 0 if every mutation was killed, 1 if any survived, 2 on a harness fault.
The Postgres suite needs PGHOST and a PGDATABASE whose name contains "disposable" (its own guard refuses anything else).
(Manual, like the other mutation loops: CI runs the tests, not this loop.)

    PGHOST=/var/run/postgresql PGDATABASE=trial_disposable PGUSER=postgres python3 test/development_activity_trial_invite_mutants.py [name ...]

Not listed, because it cannot be killed and says why: removing the token check after the mint (`!INVITE_TOKEN.test(r.token)`) is
equivalent — inviteLink() refuses the same tokens with the same DataUnavailable — so the link can never carry a malformed token either way.
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FN = 'supabase/functions/development-activity-trial/handler.ts'
READS = 'supabase/functions/_shared/evaluation-reads.ts'
PAGE = 'development-activity-reports.html'
FNT = 'test/development-activity-trial-function.test.mjs'
SRC = 'test/development-activity-reports.test.mjs'
BRO = 'test/development-activity-reports.browser.test.mjs'
ESTR = 'test/evaluation-entitlement-structure.test.mjs'
PG = 'test/trial_report_pg/run.sh'
M = {}


def m(name, old, new, tests, f):
    assert name not in M, name
    M[name] = (f, old, new, list(tests))


# ---- the function: an active trial, the database decides who is an owner, the answer is the link and nothing else ----------------------------
m('invite_without_a_trial', "        if (!trial) return reply(req, { error: 'forbidden' }, 403);\n        if (trialStanding(trial) !== 'active')",
  "        if (trialStanding(trial ?? { status: 'active', credits_used: 0, credits_remaining: 20, expired: false }) !== 'active')", [FNT, PG], FN)
m('invite_on_an_ended_trial', "        if (trialStanding(trial) !== 'active') return reply(req, { error: 'trial_not_active' }, 409);\n", '', [FNT, PG], FN)
m('refusal_called_unavailable', "          if (e instanceof NotEntitled) return reply(req, { error: 'not_owner' }, 403);\n", '', [FNT, PG], FN)
m('refusal_called_no_trial', "return reply(req, { error: 'not_owner' }, 403);", "return reply(req, { error: 'forbidden' }, 403);", [FNT, BRO, PG], FN)
m('raw_token_in_the_answer', "        return reply(req, { status: 'OK', invite_link: made.invite_link, invite_expires_at: made.invite_expires_at });",
  "        return reply(req, { status: 'OK', invite_link: made.invite_link, invite_expires_at: made.invite_expires_at, token: made.invite_link.split('#invite=')[1] });", [FNT, PG], FN)
m('handler_re_decides_the_owner', '          made = await deps.inviteAgent(who.userId);',
  "          if ((await deps.roleOf(who.userId)) !== 'owner') return reply(req, { error: 'not_owner' }, 403);\n          made = await deps.inviteAgent(who.userId);", [FNT], FN)
m('role_invented', "role: trial ? await deps.roleOf(userId) : null", "role: trial ? 'owner' : null", [FNT, BRO, PG], FN)
m('role_read_without_a_trial', "role: trial ? await deps.roleOf(userId) : null", "role: await deps.roleOf(userId)", [FNT], FN)

# ---- the shared module: an AGENT invite, the person as ACTOR, the database's refusal named, no id out ----------------------------------------
m('mint_without_the_actor', "p_role: 'agent', p_actor: userId });", "p_role: 'agent' });", [ESTR, FNT, PG], READS)
m('mint_an_owner', "p_role: 'agent', p_actor: userId });", "p_role: 'owner', p_actor: userId });", [ESTR, FNT, PG], READS)
m('database_refusal_called_unavailable', "        if (error.message === 'NOT_ENTITLED') throw new NotEntitled('refused');\n", '', [FNT, PG], READS)
m('no_trial_called_unavailable', "      if (usage.data.length === 0) throw new NotEntitled('no trial');\n", '', [FNT], READS)
m('evaluation_id_unchecked', " || typeof t.evaluation_id !== 'string' || !UUID.test(t.evaluation_id)", '', [FNT], READS)
m('expiry_unchecked', "!INVITE_TOKEN.test(r.token) || !isTime(r.expires_at)) throw", "!INVITE_TOKEN.test(r.token)) throw", [FNT], READS)
m('two_mint_rows_accepted', "      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');\n      const r = data[0];\n      if (!r || typeof r.token",
  "      if (!Array.isArray(data) || data.length === 0) throw new DataUnavailable('shape');\n      const r = data[0];\n      if (!r || typeof r.token", [FNT], READS)
m('any_role_accepted', "      if (data.length !== 1 || !r || (r.role !== 'owner' && r.role !== 'agent')) throw new DataUnavailable('shape');\n      return r.role;",
  "      if (data.length !== 1 || !r) throw new DataUnavailable('shape');\n      return r.role;", [FNT], READS)
m('unreadable_role_called_none', "      if (error) throw new DataUnavailable('brokerage_membership_of');", '      if (error) return null;', [FNT], READS)

# ---- the customer page: offered to an owner of an active trial only; the server's link, once, kept nowhere -------------------------------------
m('card_for_every_member', "showTeam(a === 'trial' && role === 'owner');", "showTeam(a === 'trial');", [SRC, BRO], PAGE)
m('card_for_an_ended_trial', "showTeam(a === 'trial' && role === 'owner');", "showTeam(role === 'owner');", [SRC, BRO], PAGE)
m('role_set_by_the_page', "{ role = st.body.role; await present(st.body.access, st.body.trial, ''); }", "{ role = 'owner'; await present(st.body.access, st.body.trial, ''); }", [SRC, BRO], PAGE)
m('card_survives_sign_out', '      access = null; role = null; attempt = null; showTeam(false);', '      access = null; role = null; attempt = null;', [SRC, BRO], PAGE)
m('card_survives_a_new_person', '        role = null; showTeam(false); showSaved(false); showProfile(false); // another person', '        showSaved(false); showProfile(false); // another person', [SRC, BRO], PAGE)
m('hiding_keeps_the_link', "    if (!on) { $('minted').hidden = true; $('invite-link').value = ''; $('invite-note').textContent = ''; teamSay('', false); }\n", '', [SRC, BRO], PAGE)
m('link_shape_unchecked', "/^https:\\/\\/homesignal\\.net\\/development-activity-reports\\.html#invite=hse1_[0-9a-f]{64}$/.test(link)", 'link', [SRC], PAGE)
m('late_answer_shown', "    if (!session || !session.user || session.user.id !== forUser) { showTeam(false); return; }\n", '', [SRC], PAGE)
m('link_kept_in_storage', "      $('invite-link').value = link;", "      $('invite-link').value = link; try { sessionStorage.setItem('agent-link', link); } catch (e) {}", [SRC, BRO], PAGE)
m('page_sends_a_role', "await post(TRIAL_FN, { action: 'invite' });", "await post(TRIAL_FN, { action: 'invite', role: 'owner' });", [SRC, BRO], PAGE)
m('raw_code_shown', '    teamSay(inviteMessage(r.status, body), true);', "    teamSay(String(body.error || r.status), true);", [SRC, BRO], PAGE)
m('button_stays_off_after_an_answer', "    if (!session || !session.user || session.user.id !== forUser) { showTeam(false); return; }\n    $('mint').disabled = false;\n",
  "    if (!session || !session.user || session.user.id !== forUser) { showTeam(false); return; }\n", [BRO], PAGE)
m('no_second_look_after_a_refusal', '    if (r.status === 403 || r.status === 409) loadTrial();\n', '', [BRO], PAGE)
m('note_hides_that_it_is_once', ' HomeSignal shows this link only this once.', '', [SRC, BRO], PAGE)
m('copy_copies_nothing', "    var v = $('invite-link').value;\n    if (!v) return;", "    var v = $('invite-link').value;\n    if (v) return;", [BRO], PAGE)


def run(tests):
    for t in tests:
        if t.endswith('.sh'):
            if not os.environ.get('PGHOST') or 'disposable' not in os.environ.get('PGDATABASE', ''):
                return None, t, 'PGHOST / a disposable PGDATABASE are not set'
            cmd = ['bash', str(ROOT / t)]
        else:
            cmd = ['node', str(ROOT / t)]
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
    passed, which, line = run([FNT, SRC, BRO, ESTR, PG])
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

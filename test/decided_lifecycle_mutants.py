#!/usr/bin/env python3
"""Prohibited mutations of the `Decided` lifecycle rule (2026-10-01; CLAUDE.md §7.05).
Each MUST make test/decided-lifecycle-parity.test.mjs exit non-zero.

    python3 test/decided_lifecycle_mutants.py                 # every mutation
    python3 test/decided_lifecycle_mutants.py name [name ...]

It edits files in place, runs the suite, and ALWAYS restores the originals (even on error or ^C). An anchor that does not match
exactly once is a harness failure, never a pass: a mutation that did not apply cannot be told from one the suite survived. Run it
from a copy of the tree if other work is open in this one. Exit 1 if any mutation survives, 2 on a harness fault.
(Manual, like follow_report_mutants.py: CI runs the node test, not this loop.)
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PT = 'lib/project-type.js'
TP = 'lib/templates.js'
N5 = 'lib/n5-radius.js'
MAP = 'lib/map.js'
TESTS = ['test/decided-lifecycle-parity.test.mjs']

M = {}


def m(name, file, old, new):
    M[name] = [(file, old, new)]


LK = "(s === 'proposed' || s === 'decided') ? 'proposed'\n         : (s === 'approved') ? 'approved'\n         : (s === 'operating' || s === 'active' || s === 'built') ? 'operating'"
# ---- the canonical vocabulary --------------------------------------------------------------------------------------------------
m('lifecycle_key_decided_is_unknown', PT, LK, LK.replace("(s === 'proposed' || s === 'decided')", "(s === 'proposed')"))
m('lifecycle_key_decided_is_approved', PT, LK, LK.replace("(s === 'proposed' || s === 'decided')", "(s === 'proposed')").replace("(s === 'approved')", "(s === 'approved' || s === 'decided')"))
m('lifecycle_key_decided_is_operating', PT, LK, LK.replace("(s === 'proposed' || s === 'decided')", "(s === 'proposed')").replace("(s === 'operating' ||", "(s === 'operating' || s === 'decided' ||"))
m('lifecycle_keys_gain_a_fifth', PT, "const LIFECYCLE_KEYS = ['proposed', 'approved', 'operating', 'unknown'];", "const LIFECYCLE_KEYS = ['proposed', 'approved', 'operating', 'unknown', 'decided'];")
# ---- the card bar --------------------------------------------------------------------------------------------------------------
SK = "return (s === 'proposed' || s === 'decided') ? 'proposed'"
m('status_key_drops_decided', TP, SK, "return (s === 'proposed') ? 'proposed'")
m('status_key_decided_is_operating', TP, SK, "return (s === 'proposed') ? 'proposed'\n      : s === 'decided' ? 'operating'")
# ---- Map 1 ZIP mode ------------------------------------------------------------------------------------------------------------
m('n5_decided_is_unknown', N5, "if (s === 'decided') return 'proposed';", "if (s === 'decided') return 'unknown';")
m('n5_decided_is_approved', N5, "if (s === 'decided') return 'proposed';", "if (s === 'decided') return 'approved';")
# ---- browsing is not eligibility -----------------------------------------------------------------------------------------------
m('active_count_admits_decided', MAP,
  "if (String(it.status == null ? '' : it.status).trim().toLowerCase() === 'decided') return false;", "")
m('decision_moves_the_pin', MAP,
  "const k = LC.lifecycleKey(item && item.status);\n    return Object.assign({ k: k, c: STATUS_TIERS[k].hex }, STATUS_TIERS[k]);",
  "const k = (item && item.decision) ? 'unknown' : LC.lifecycleKey(item && item.status);\n    return Object.assign({ k: k, c: STATUS_TIERS[k].hex }, STATUS_TIERS[k]);")


def run_tests():
    env = dict(os.environ)
    env['PATH'] = '/opt/node22/bin:' + env.get('PATH', '')
    bad = []
    for t in TESTS:
        r = subprocess.run(['node', t], cwd=ROOT, env=env, capture_output=True, text=True)
        if r.returncode != 0:
            bad.append(t)
    return bad


def apply(edits):
    saved = {}
    try:
        for f, old, new in edits:
            p = ROOT / f
            if f not in saved:
                saved[f] = p.read_text()
            s = p.read_text()
            if s.count(old) != 1:
                raise RuntimeError('anchor must match exactly once in %s, matched %d: %r' % (f, s.count(old), old[:70]))
            p.write_text(s.replace(old, new))
    except Exception:
        for f, s in saved.items():
            (ROOT / f).write_text(s)
        raise
    return saved


def main():
    names = sys.argv[1:] or list(M)
    unknown = [n for n in names if n not in M]
    if unknown:
        print('unknown mutation(s): ' + ', '.join(unknown))
        return 2
    base = run_tests()
    if base:
        print('HARNESS FAULT: the unmutated tree already fails: ' + ', '.join(base))
        return 2
    survived = []
    for n in names:
        saved = {}
        try:
            saved = apply(M[n])
            bad = run_tests()
        except Exception as e:
            print('HARNESS FAULT in %s: %s' % (n, e))
            return 2
        finally:
            for f, s in saved.items():
                (ROOT / f).write_text(s)
        if bad:
            print('killed   %-36s by %s' % (n, ', '.join(b.split('/')[-1] for b in bad)))
        else:
            print('SURVIVED %s' % n)
            survived.append(n)
    after = run_tests()
    if after:
        print('HARNESS FAULT: the tree does not pass after restoring')
        return 2
    print('\n%d mutations, %d killed, %d survived; tree restored and green' % (len(names), len(names) - len(survived), len(survived)))
    return 1 if survived else 0


if __name__ == '__main__':
    sys.exit(main())

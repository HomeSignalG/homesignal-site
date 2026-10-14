#!/usr/bin/env python3
"""Prohibited weakenings of the recovery -> notification chain. Each MUST make test/recovery-notification-safety.test.mjs exit non-zero.
Works on COPIES in a scratch directory (feeds the test through RNS_* env overrides); it never edits a repo file.
An anchor that does not match exactly once is a harness fault (exit 2); a mutation that changes nothing is a harness fault.
Exit 0 if every mutation was killed and the clean control passed, 1 if any survived.   python3 test/recovery-notification-safety_mutants.py
"""
import os, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEST = ROOT / 'test/recovery-notification-safety.test.mjs'
SHARED = ROOT / 'supabase/functions/_shared'
REC = ROOT / 'docs/dev-change-recovery.sql'
REP = ROOT / 'docs/dev-change-reportable.sql'

# name -> (file key, [(old, new)])
MUTATIONS = {
    'view-drops-is_baseline': ('rec', [('where not r.baseline and not e.is_baseline;', 'where not r.baseline;')]),
    'view-drops-run-rule': ('rec', [('where not r.baseline and not e.is_baseline;', 'where not e.is_baseline;')]),
    'writer-recovered-is-material': ('rec', [("not (_baseline or rc.identity_key is not null),\\n         (_baseline", "not _baseline,\\n         (_baseline")]),
    'live-view-wide-open': ('rep', [('where not r.baseline;', 'where true;')]),
    'consumer-ignores-material': ('shared:national-report.ts', [('.filter((e) => e.material === true && keep(e))', '.filter((e) => keep(e))')]),
    'watch-never-offers-first_detected': ('shared:property-watch.ts', [("['first_detected', 'status_changed', 'source_record_updated']", "['status_changed', 'source_record_updated']")]),
    'email-loses-new-record-line': ('shared:watch-email.ts', [("'New official record'", "'Official status changed'")]),
}

def fault(msg):
    print('HARNESS FAULT:', msg); sys.exit(2)

def run(env_extra):
    env = dict(os.environ, **env_extra)
    p = subprocess.run(['node', str(TEST)], env=env, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr

def main():
    only = set(sys.argv[1:])
    code, out = run({})
    if code != 0:
        print(out[-1500:]); fault('the clean control did not pass')
    print('control (unmutated): exit 0')
    survived = []
    for name, (key, pairs) in MUTATIONS.items():
        if only and name not in only: continue
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            shared = td / '_shared'; shutil.copytree(SHARED, shared)
            rec = td / 'rec.sql'; shutil.copy(REC, rec)
            rep = td / 'rep.sql'; shutil.copy(REP, rep)
            target = {'rec': rec, 'rep': rep}.get(key) or shared / key.split(':', 1)[1]
            t = target.read_text()
            for old, new in pairs:
                if t.count(old) != 1: fault(f'{name}: anchor appears {t.count(old)} times in {target.name}')
                t = t.replace(old, new)
            if t == target.read_text(): fault(f'{name}: mutation changed nothing')
            target.write_text(t)
            code, out = run({'RNS_SHARED': str(shared), 'RNS_RECOVERY_SQL': str(rec), 'RNS_REPORTABLE_SQL': str(rep)})
            fails = [l for l in out.splitlines() if l.startswith('FAIL')]
            status = 'KILLED' if code != 0 else 'SURVIVED'
            print(f'{status:9} {name}  (exit {code}, {len(fails)} FAIL line(s){"; first: " + fails[0][:90] if fails else ""})')
            if code == 0: survived.append(name)
    print(f'\n{len(MUTATIONS) - len(survived)} killed, {len(survived)} survived')
    sys.exit(1 if survived else 0)

main()

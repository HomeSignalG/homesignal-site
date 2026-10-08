#!/usr/bin/env python3
"""Mutation test of the Phase A comparator: each mutant below breaks one detection class in
scripts/dc_phase_a_proof.py; test_compare.py must FAIL on every one (exit code), and pass on the
clean file. Run: python3 test/dc_phase_a_proof/mutate.py"""
import os, shutil, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'scripts', 'dc_phase_a_proof.py')
TEST = os.path.join(ROOT, 'test', 'dc_phase_a_proof', 'test_compare.py')

MUTANTS = {
    'M01_row_diff_always_zero': ("    return sum(((ca - cb) + (cb - ca)).values())", "    return 0"),
    'M02_multiplicity_lost': ("    ca, cb = Counter(a), Counter(b)", "    ca, cb = Counter(set(a)), Counter(set(b))"),
    'M03_fingerprint_constant': ("    return hashlib.md5('\\n'.join(sorted('\\x1f'.join(r) for r in rows)).encode()).hexdigest()", "    return 'x'"),
    'M04_moved_never_counted': ("if fa[k][1] != fb[k][1]", "if False"),
    'M05_zip_changed_never_counted': ("if fa[k][0] != fb[k][0]", "if False"),
    'M06_no_minted_normalization': ("    if not m:\n        return rows", "    return rows"),
    'M07_is_zero_ignores_map1_moves': ("or r['moved'] or r['zip_changed']", "or False"),
    'M08_is_zero_ignores_row_diff': ("if r['row_diff'] != 0 or r['fp'][0] != r['fp'][1]:", "if False:"),
    'M09_control_always_matches': ("        if cur != want:\n            return False", "        pass"),
    'M10_gate_ignores_admission': ("if kv.get('ATLAS_ADMITTED') != 'f':", "if False:"),
    'M11_gate_ignores_evidence_leak': ("if kv.get('ATLAS_EVIDENCE_ROWS') != '0':", "if False:"),
    'M12_gate_drops_control': ("if kv.get('EPOCH_EVIDENCE_ROWS', '0') == '0':", "if False:"),
    'M13_identity_sum_drops_links': ("for p in ('entities', 'links', 'decisions')", "for p in ('entities', 'decisions')"),
}


def run_tests():
    return subprocess.run([sys.executable, TEST], capture_output=True, text=True).returncode


def main():
    orig = open(SRC).read()
    if run_tests() != 0:
        print('FAIL: the clean comparator does not pass its own tests'); return 1
    killed, survived = 0, []
    bak = SRC + '.bak'
    shutil.copy(SRC, bak)
    try:
        for name, (old, new) in MUTANTS.items():
            if orig.count(old) != 1:
                print(f'FAIL: mutant {name} anchor found {orig.count(old)} times (must be 1)'); return 1
            open(SRC, 'w').write(orig.replace(old, new))
            rc = run_tests()
            if rc != 0:
                killed += 1; print(f'  killed   {name}')
            else:
                survived.append(name); print(f'  SURVIVED {name}')
    finally:
        shutil.move(bak, SRC)
    if run_tests() != 0:
        print('FAIL: restored comparator no longer passes'); return 1
    print(f'MUTATIONS = {killed}/{len(MUTANTS)} KILLED')
    return 0 if not survived else 1


if __name__ == '__main__':
    sys.exit(main())

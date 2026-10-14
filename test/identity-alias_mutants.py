#!/usr/bin/env python3
"""Prohibited weakenings of the compound-identity rule. Each MUST make at least one of the three identity suites exit non-zero:
    test/identity-alias-parity.test.mjs   test/identity-alias-legacy-keys.test.mjs   scripts/test_identity_aliases.py (+ the CI checker it runs)
Works on a COPY of the needed tree in a scratch directory; it never edits a repo file. An anchor that does not match exactly once is
a harness fault (exit 2), and so is a mutation that changes nothing. Exit 0 = clean control passed and every mutation was killed.
    python3 test/identity-alias_mutants.py [mutation-name ...]

Each name states the weakening in plain words; several are the exact failure modes the design document warns about
(docs/denton-permit-identity-design-2026-10-14.md section 6): primary aliased, duplicates not folded, renumbering undetected,
fetch and connector disagreeing, the engine never loading the file.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COPY = [  # relative paths copied into the scratch tree
    'supabase/functions/get-address-report',
    'scripts',
    'fixtures',
    'test/identity-alias-parity.test.mjs',
    'test/identity-alias-legacy-keys.test.mjs',
    'test/fixtures/identity-aliases',
]
SUITES = [
    ['node', 'test/identity-alias-legacy-keys.test.mjs'],
    ['node', 'test/identity-alias-parity.test.mjs'],
    ['python3', '-I', 'scripts/test_identity_aliases.py'],
    ['python3', '-I', 'scripts/check_identity_aliases.py'],
]
TS = 'supabase/functions/get-address-report/sources/identity-aliases.ts'
ARC = 'supabase/functions/get-address-report/sources/arcgis.ts'
IDX = 'supabase/functions/get-address-report/index.ts'
IA = 'scripts/identity_aliases.py'
SH = 'scripts/n5_shard.py'
CK = 'scripts/check_identity_aliases.py'

M = {
    # --- TypeScript rule
    'ts-alias-applied-to-a-rekeyed-id': (TS, 'if (typeof alias !== "string" || !alias.startsWith(base + "#")) return base;', 'if (typeof alias !== "string") return base;'),
    'ts-file-of-another-registry-accepted': (TS, 'if (file.registry_id !== entry.registry_id) {', 'if (false) {'),
    'ts-file-of-another-column-accepted': (TS, 'if (typeof cn !== "string" || cn !== file.id_field) {', 'if (false) {'),
    'ts-unloaded-file-is-silent': (TS, 'if (!file) return { ok: false, reason: `identity_aliases_file ${name} is declared but not loaded by the engine` };', 'if (!file) return null;'),
    'ts-identity-fields-and-aliases-coexist': (TS, 'if (entry.identity_fields?.length) {', 'if (false) {'),
    'ts-objectid-not-trimmed': (TS, 'const oid = String(raw).trim();', 'const oid = String(raw);'),
    # --- connector wiring
    'arcgis-call-site-ignores-the-verdict': (ARC, 'recordIdentity(row, entry, caseNo, title, aliasVerdict, report)', 'recordIdentity(row, entry, caseNo, title, null, report)'),
    'arcgis-never-resolves-the-file': (ARC, 'const aliasVerdict = aliasFileFor(entry, deps.identityAliases);', 'const aliasVerdict = null as AliasVerdict | null;'),
    'arcgis-counter-never-increments': (ARC, 'report.identity_alias_applied++;', 'void 0;'),
    'arcgis-ladder-order-changed': (ARC, 'const base = identityFromFields(row, entry.identity_fields) ?? caseNo ?? rowId(row) ?? title;', 'const base = caseNo ?? identityFromFields(row, entry.identity_fields) ?? rowId(row) ?? title;'),
    'engine-never-passes-the-files': (IDX, 'identityAliases: IDENTITY_ALIAS_FILES,', ''),
    # --- Python rule / generator
    'py-primary-gets-an-alias': (IA, 'group_out[oid] = ident if not reps else f"{ident}#{oid}"', 'group_out[oid] = f"{ident}#{oid}"'),
    'py-highest-oid-keeps-legacy': (IA, 'members.sort(key=lambda t: t[0])', 'members.sort(key=lambda t: -t[0])'),
    'py-duplicates-not-folded': (IA, 'return _comparable_attrs(a.get("attrs"), oid_field, ignore_fields) == _comparable_attrs(b.get("attrs"), oid_field, ignore_fields)', 'return False'),
    'py-attribute-differences-ignored': (IA, 'return _comparable_attrs(a.get("attrs"), oid_field, ignore_fields) == _comparable_attrs(b.get("attrs"), oid_field, ignore_fields)', 'return True'),
    'py-distance-ignored': (IA, 'if haversine_m(float(a["x"]), float(a["y"]), float(b["x"]), float(b["y"])) > tol_m:', 'if False:'),
    'py-missing-point-counts-as-duplicate': (IA, 'if a.get("x") is None or a.get("y") is None or b.get("x") is None or b.get("y") is None:\n        return False', 'if a.get("x") is None or a.get("y") is None or b.get("x") is None or b.get("y") is None:\n        return True'),
    'py-fingerprint-order-dependent': (IA, 'total += row_hash32(f"{oid}|{ident}")', 'total = total * 31 + row_hash32(f"{oid}|{ident}")'),
    'py-fingerprint-ignores-identity': (IA, 'total += row_hash32(f"{oid}|{ident}")', 'total += row_hash32(f"{oid}")'),
    'py-stale-alias-applied': (IA, 'return a if isinstance(a, str) and a.startswith(base + "#") else base', 'return a if isinstance(a, str) else base'),
    'py-renumbering-swap-undetected': (IA, '> DUPLICATE_M):\n            moved.append', '> 1e12):\n            moved.append'),
    'py-handedit-undetected': (IA, 'if scan.get("alias_fingerprint") != fingerprint(al.items()):', 'if False:'),
    'py-duplicate-oid-accepted': (IA, 'if oid in seen_oids:', 'if False:'),
    # --- shard fetcher
    'shard-ignores-the-file-routing': (SH, 'routed = ia.source_identity(echo.strip(), attrs.get(oid_field), alias_file) if alias_file else echo.strip()', 'routed = echo.strip()'),
    'shard-asks-for-the-alias-string': (SH, 'want = sorted({alias_rev[c][0] if c in alias_rev else c for c in cases})', 'want = sorted(cases)'),
    'shard-omits-objectid-from-outfields': (SH, '"outFields": f"{ident},{oid_field}" if oid_field else ident,', '"outFields": ident,'),
    'shard-fetches-under-legacy-keys-when-file-unusable': (SH, 'if alias_problem:\n        return {"status": "EXCLUDED", "reason": alias_problem}', 'if False:\n        pass'),
    # --- CI checker
    'check-believes-every-file-is-loaded': [(CK, 'loaded = set(re.findall(r\'^\\s*"([^"]+\\.json)"\\s*:\', idx_text, re.M))', 'loaded = set(files)'),
                                           (CK, 'imported = set(re.findall(r\'^import\\s+\\w+\\s+from\\s+"\\./([^"]+\\.json)"\\s+with\\s+\\{\\s*type:\\s*"json"\\s*\\}\', idx_text, re.M))', 'imported = set(files)')],
    'check-skips-orphan-files': (CK, 'if f not in named:', 'if False:'),
    'check-ignores-a-missing-engine-import': (CK, 'if not re.search(r\'import\\s*\\{\\s*IDENTITY_ALIAS_FILES', 'if False and not re.search(r\'import\\s*\\{\\s*IDENTITY_ALIAS_FILES'),
    'check-ignores-engine-not-passing-the-files': (CK, 'or "identityAliases: IDENTITY_ALIAS_FILES" not in t:', ':'),
}


def fault(msg):
    print('HARNESS FAULT:', msg)
    sys.exit(2)


def run_suites(cwd):
    worst, tails = 0, []
    for cmd in SUITES:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=dict(os.environ, SUPABASE_ACCESS_TOKEN='x'))
        if p.returncode:
            worst = p.returncode
            fl = [l for l in (p.stdout + p.stderr).splitlines() if l.startswith('FAIL')]
            tails.append(f'{cmd[-1]}: {len(fl)} FAIL' + (f' (first: {fl[0][:90]})' if fl else ' (crash: ' + (p.stderr or p.stdout)[-120:].replace('\n', ' ') + ')'))
    return worst, tails


def scratch():
    td = Path(tempfile.mkdtemp())
    for rel in COPY:
        src, dst = ROOT / rel, td / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns('dist', 'node_modules', '__pycache__'))
        else:
            shutil.copy(src, dst)
    return td


def main():
    only = set(sys.argv[1:])
    td = scratch()
    try:
        code, tails = run_suites(td)
        if code:
            print('\n'.join(tails))
            fault('the clean control did not pass')
        print('control (unmutated): all four suites pass')
    finally:
        shutil.rmtree(td, ignore_errors=True)
    survived = []
    for name, spec in M.items():
        if only and name not in only:
            continue
        td = scratch()
        try:
            for rel, old, new in (spec if isinstance(spec, list) else [spec]):
                f = td / rel
                t = f.read_text()
                if t.count(old) != 1:
                    fault(f'{name}: anchor appears {t.count(old)} times in {rel}')
                nt = t.replace(old, new)
                if nt == t:
                    fault(f'{name}: mutation changed nothing')
                f.write_text(nt)
            code, tails = run_suites(td)
        finally:
            shutil.rmtree(td, ignore_errors=True)
        print(f'{"KILLED" if code else "SURVIVED":9} {name}  {"; ".join(tails)[:230]}')
        if not code:
            survived.append(name)
    print(f'\n{len(M) - len(survived) if not only else "-"} killed, {len(survived)} survived')
    sys.exit(1 if survived else 0)


main()

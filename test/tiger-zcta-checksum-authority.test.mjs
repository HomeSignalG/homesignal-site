// Step 4 — one TIGER/Line ZCTA archive identity.
// Run: node test/tiger-zcta-checksum-authority.test.mjs
//
// PARKED. This suite pins the authority module and that every acquirer compares
// against it. It does not download Census, load polygons, apply DDL, or activate
// a generation.
//
// Founder lock 2026-09-27: Do not unlist ~1,005 map pages just because they have
// plants and no new construction. 'Nothing is being built' is a valid answer.
// Those pages stay listed. This was the old Unit 1 idea; it is rejected.
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

let fails = 0;
const ok = (c, name, ev) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (c || ev === undefined ? '' : '\n        ' + ev));
  if (!c) fails++;
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const pyCommentsOff = (src) => src.replace(/^\s*#.*$/gm, '');
const lockHaystack = (src) => pyCommentsOff(src).replace(/\s+/g, ' ');

const LOCK = "Do not unlist ~1,005 map pages just because they have plants and no new construction. 'Nothing is being built' is a valid answer. Those pages stay listed. This was the old Unit 1 idea; it is rejected.";
const PIN = 'e87129634eefe8719ef06ce4cfdf6588520be2e359360e590aaae90e4afb1911';
const URL = 'https://www2.census.gov/geo/tiger/TIGER2025/ZCTA520/tl_2025_us_zcta520.zip';

const auth = read('scripts/tiger_zcta_authority.py');
const authPy = pyCommentsOff(auth);
const b1 = read('scripts/phase2_b1_zcta.py');
const n3 = read('scripts/n3_pilot.py');
const n5 = read('scripts/n5_shard.py');
const stats = read('scripts/n5_zcta_stats.py');
const n2a = read('scripts/n2a_classify.py');

const scriptsPy = readdirSync(join(root, 'scripts'))
  .filter((n) => n.endsWith('.py'))
  .map((n) => ({ n, src: read('scripts/' + n), py: pyCommentsOff(read('scripts/' + n)) }));

ok(/PARKED as the checksum authority/.test(auth),
  '0a the authority file is parked — it is not an apply script');
ok(!/urllib|psycopg|supabase|http\.client|socket\./.test(authPy),
  '0b the authority module does no I/O, no network, no database');
ok(/does not\s+activate an N5 generation/.test(auth)
   && !/n5_generation_activate/.test(authPy)
   && !/geo\.n5_gen_publish/.test(authPy),
  '0c it does not activate a generation (the negation is the pin; no activate-function call)');
ok(lockHaystack(auth).includes(LOCK.replace(/\s+/g, ' ')),
  '0d the founder lock is quoted in the authority file');
ok(/does not touch `indexable`/.test(auth),
  '0e it names that it does not touch indexable');
ok(!/\bindexable\s*=/.test(authPy),
  '0f it does not assign indexable');

ok(new RegExp('TIGER_SHA256\\s*=\\s*"' + PIN + '"').test(authPy),
  '1a the sha256 assignment is this archive');
ok(authPy.includes('TIGER_URL') && auth.includes(URL),
  '1b the URL is the TIGER2025 national ZCTA520 zip');
ok(/TIGER_VINTAGE\s*=\s*"TIGER\/Line 2025 \(2020 Census ZCTA delineation\)"/.test(authPy),
  '1c the vintage string matches production source_vintage');
ok(/EXPECTED_NATIONAL_FEATURES\s*=\s*33791/.test(authPy),
  '1d the feature count is 33,791');
ok(/def refuse_unless_pinned\(/.test(authPy),
  '1e refuse_unless_pinned is the one comparison');

const shaAssignFiles = scriptsPy.filter((f) => /TIGER_SHA256\s*=/.test(f.py));
ok(shaAssignFiles.length === 1 && shaAssignFiles[0].n === 'tiger_zcta_authority.py',
  '2a TIGER_SHA256 is assigned in exactly one script',
  shaAssignFiles.map((f) => f.n).join(','));

const urlAssignFiles = scriptsPy.filter((f) => /TIGER_URL\s*=/.test(f.py));
ok(urlAssignFiles.length === 1 && urlAssignFiles[0].n === 'tiger_zcta_authority.py',
  '2b TIGER_URL is assigned in exactly one script',
  urlAssignFiles.map((f) => f.n).join(','));

const vintageAssign = scriptsPy.filter((f) => /TIGER_VINTAGE\s*=/.test(f.py));
ok(vintageAssign.length === 1 && vintageAssign[0].n === 'tiger_zcta_authority.py',
  '2c TIGER_VINTAGE is assigned in exactly one script',
  vintageAssign.map((f) => f.n).join(','));

const callers = [
  ['phase2_b1_zcta.py', b1, 'B1 production loader'],
  ['n3_pilot.py', n3, 'N3 acquirer'],
  ['n5_shard.py', n5, 'N5 shard acquirer'],
  ['n5_zcta_stats.py', stats, 'N5 geometry measurement'],
  ['n2a_classify.py', n2a, 'N2A step 0'],
];
for (const [file, src, label] of callers) {
  const py = pyCommentsOff(src);
  ok(/refuse_unless_pinned\(/.test(py),
    '3 ' + label + ' (' + file + ') calls refuse_unless_pinned');
}

ok(/from tiger_zcta_authority import/.test(pyCommentsOff(b1)),
  '4a B1 imports the authority');
ok(/from tiger_zcta_authority import/.test(pyCommentsOff(n3)),
  '4b N3 imports the authority');
ok(/from tiger_zcta_authority import/.test(pyCommentsOff(n2a)),
  '4c N2A imports the authority');
ok(/from tiger_zcta_authority import/.test(pyCommentsOff(stats)),
  '4d n5_zcta_stats imports the authority');
ok(/refuse_unless_pinned/.test(pyCommentsOff(n5)) && /EXPECTED_NATIONAL_FEATURES/.test(pyCommentsOff(n5)),
  '4e n5_shard uses refuse_unless_pinned and the authority feature count');

ok(/if mode == "load":\s*refuse_unless_pinned\(expect_sha\)/.test(pyCommentsOff(b1)),
  '5a B1 load refuses unless the dispatcher-recorded sha is the authority pin');
ok(/data, sha = acquire\(\)\s*refuse_unless_pinned\(sha\)/.test(pyCommentsOff(b1)),
  '5b B1 validate and load both refuse a downloaded archive that is not the pin');
ok(!/EXPECTED_NATIONAL_FEATURES\s*=\s*33791/.test(pyCommentsOff(b1)),
  '5c B1 no longer re-types the feature count');

const py = spawnSync('python3', ['-c', `
import sys
sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))})
from tiger_zcta_authority import refuse_unless_pinned, TIGER_SHA256, TIGER_URL, EXPECTED_NATIONAL_FEATURES
assert TIGER_SHA256 == ${JSON.stringify(PIN)}
assert TIGER_URL == ${JSON.stringify(URL)}
assert EXPECTED_NATIONAL_FEATURES == 33791
assert refuse_unless_pinned(TIGER_SHA256) == TIGER_SHA256
try:
    refuse_unless_pinned('deadbeef' + '0' * 56)
    raise SystemExit('unpinned sha was accepted')
except SystemExit as e:
    if 'unpinned sha was accepted' in str(e):
        raise
    if 'authority' not in str(e) or ${JSON.stringify(PIN)} not in str(e):
        raise SystemExit('refusal text missing authority pin: %s' % e)
print('BEHAVIOR_OK')
`], { encoding: 'utf8' });
ok(py.status === 0 && /BEHAVIOR_OK/.test(py.stdout || ''),
  '6 refuse_unless_pinned accepts the pin and refuses any other sha',
  (py.stderr || py.stdout || '').slice(0, 500));

const mutated = spawnSync('python3', ['-c', `
import sys, pathlib
sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))})
src = pathlib.Path(${JSON.stringify(join(root, 'scripts/tiger_zcta_authority.py'))}).read_text()
# The assignment must exist for this mutation to be a real edit.
assert 'TIGER_SHA256 = "${PIN}"' in src
print('MUTATION_TARGET_PRESENT')
`], { encoding: 'utf8' });
ok(mutated.status === 0 && /MUTATION_TARGET_PRESENT/.test(mutated.stdout || ''),
  '7 the assignment this suite pins is present (mutation target is real)');

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);

// The IndexNow byte proof must describe the bytes that are DEPLOYED, i.e. the artifact AFTER the brand overlay.
//
// Runs 38782500923 and 38804507687 (2026-10-15) both failed at "Verify the new build is live" and submitted nothing:
// page_semantics hashes a page when it is generated, scripts/brand_stage.py then rewrites it for the Jody identity,
// so the live bytes could never equal the stored hash. This test runs the REAL overlay and the REAL live check.
//
//   R1  positive control: WITHOUT the rehash, the live check refuses the overlaid page (the defect, reproduced)
//   R2  WITH the rehash, the same live check accepts it
//   R3  the rehash changes only the expected hashes: same sampled paths, same submit set, same state hash
//   R4  a sampled page missing from the artifact fails loudly (never a skipped check)
//   R5  a path that escapes the artifact directory is refused
//   R6  the workflow runs it after the overlay, before the publish decision and the upload
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(root, 'scripts');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };
const run = (args) => spawnSync('python3', args, { encoding: 'utf8' });

const KEY = 'a1b2c3d4-e5f6-4789-abcd-0123456789ab';
const PAGE = '<!doctype html><html><head><title>HomeSignal</title><link rel="canonical" href="https://homesignal.net/community/10501/"></head><body>HomeSignal alerts at homesignal.net</body></html>';

const dir = mkdtempSync(join(tmpdir(), 'rehash-'));
const site = join(dir, '_site');
mkdirSync(join(site, 'community', '10501'), { recursive: true });
writeFileSync(join(site, 'community', '10501', 'index.html'), PAGE);

// the delta as the generator writes it: hashed over the PRE-overlay bytes
const pre = JSON.parse(run(['-c', `import hashlib,json;print(json.dumps(hashlib.sha256(${JSON.stringify(PAGE)}.encode()).hexdigest()[:32]))`]).stdout);
const delta = { candidate_state_hash: 'S', submit: ['/community/10501/'], verify: { present: { '/community/10501/': pre }, absent: [] } };
const deltaPath = join(dir, 'delta.json');
writeFileSync(deltaPath, JSON.stringify(delta));

// the real overlay
const ov = run([join(SCRIPTS, 'brand_stage.py'), '--dir', site, '--identity', 'jody']);
ok(ov.status === 0, `the real brand overlay ran (exit ${ov.status})`);
const live = readFileSync(join(site, 'community', '10501', 'index.html'), 'utf8');
ok(live !== PAGE && live.includes('jodytracks.com'), 'the overlay rewrote the page (so the generation-time hash is stale)');

// the real live check, with a fake site that serves the deployed files
const CHECK = (deltaFile) => `
import sys, json, hashlib; sys.path.insert(0, ${JSON.stringify(SCRIPTS)}); import indexnow as ix
delta = json.load(open(${JSON.stringify(deltaFile)}))
body = open(${JSON.stringify(join(site, 'community', '10501', 'index.html'))}, 'rb').read()
def get(url):
    if 'indexnow.txt' in url: return 200, ${JSON.stringify(KEY)}.encode()
    if 'page-state.json' in url: return 200, json.dumps({'state_hash': 'S'}).encode()
    return 200, body
print(json.dumps(ix._verify_once(delta, ${JSON.stringify(KEY)}, get)))`;
const before = JSON.parse(run(['-c', CHECK(deltaPath)]).stdout.trim());
ok(typeof before === 'string' && /not serving this build's bytes/.test(before), `R1 without the rehash the live check refuses the overlaid page: ${before}`);

const rh = run([join(SCRIPTS, 'page_semantics.py'), 'rehash-verify', '--delta', deltaPath, '--dir', site]);
ok(rh.status === 0, `rehash-verify ran (exit ${rh.status}): ${rh.stdout.trim()}`);
const after = JSON.parse(run(['-c', CHECK(deltaPath)]).stdout.trim());
ok(after === null, `R2 with the rehash the same live check accepts the page (${after})`);

const d2 = JSON.parse(readFileSync(deltaPath, 'utf8'));
ok(JSON.stringify(Object.keys(d2.verify.present)) === JSON.stringify(['/community/10501/']) &&
   JSON.stringify(d2.submit) === JSON.stringify(delta.submit) && d2.candidate_state_hash === 'S' &&
   JSON.stringify(d2.verify.absent) === '[]' && d2.verify.present['/community/10501/'] !== pre,
   'R3 only the expected hash changed; paths, submit set and state hash are untouched');

// R4 / R5
const miss = join(dir, 'miss.json');
writeFileSync(miss, JSON.stringify({ verify: { present: { '/community/99999/': 'x' }, absent: [] } }));
const m = run([join(SCRIPTS, 'page_semantics.py'), 'rehash-verify', '--delta', miss, '--dir', site]);
ok(m.status !== 0 && /not in the artifact/.test(m.stderr), 'R4 a sampled page missing from the artifact fails loudly');
const esc = join(dir, 'esc.json');
writeFileSync(esc, JSON.stringify({ verify: { present: { '/../delta.json': 'x' }, absent: [] } }));
const e = run([join(SCRIPTS, 'page_semantics.py'), 'rehash-verify', '--delta', esc, '--dir', site]);
ok(e.status !== 0 && /escapes the artifact/.test(e.stderr), 'R5 a path that escapes the artifact is refused');

// R6 workflow order
const WF = readFileSync(join(root, '.github', 'workflows', 'pages.yml'), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const at = (s) => WF.indexOf(s);
const iOverlay = at('scripts/brand_stage.py --dir _site'), iRe = at('page_semantics.py rehash-verify'), iDecide = at('page_semantics.py decide'), iUp = at('upload-pages-artifact');
ok(iOverlay > 0 && iRe > iOverlay && iDecide > iRe && iUp > iRe, 'R6 the workflow rehashes after the overlay, before the publish decision and the upload');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

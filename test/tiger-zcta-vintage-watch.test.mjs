// Step 5 — Census TIGER/ZCTA vintage watch (parked, dispatch-only).
// Run: node test/tiger-zcta-vintage-watch.test.mjs
//
// PARKED. Pins the watch module, its offline verdicts, and that the workflow
// has no schedule. It does not download Census, load polygons, apply DDL, or
// activate a generation.
//
// Founder lock 2026-09-27: Do not unlist ~1,005 map pages just because they have
// plants and no new construction. 'Nothing is being built' is a valid answer.
// Those pages stay listed. This was the old Unit 1 idea; it is rejected.
import { readFileSync, mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

let fails = 0;
const ok = (c, name, ev) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (c || ev === undefined ? '' : '\n        ' + ev));
  if (!c) fails++;
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const pyCommentsOff = (src) => src.replace(/^\s*#.*$/gm, '');
const lockHaystack = (src) => pyCommentsOff(src).replace(/\s+/g, ' ');
const ymlCommentsOff = (src) => src.replace(/^\s*#.*$/gm, '');

const LOCK = "Do not unlist ~1,005 map pages just because they have plants and no new construction. 'Nothing is being built' is a valid answer. Those pages stay listed. This was the old Unit 1 idea; it is rejected.";
const PIN = 'e87129634eefe8719ef06ce4cfdf6588520be2e359360e590aaae90e4afb1911';
const URL = 'https://www2.census.gov/geo/tiger/TIGER2025/ZCTA520/tl_2025_us_zcta520.zip';
const VINTAGE = 'TIGER/Line 2025 (2020 Census ZCTA delineation)';

const watch = read('scripts/tiger_zcta_vintage_watch.py');
const watchPy = pyCommentsOff(watch);
const wf = read('.github/workflows/tiger-zcta-vintage-watch.yml');
const wfPy = ymlCommentsOff(wf);
const fx = (n) => join(root, 'test/fixtures/tiger-vintage', n);

const STUB = [
  'TIGER_URL = ' + JSON.stringify(URL),
  'TIGER_SHA256 = ' + JSON.stringify(PIN),
  'TIGER_VINTAGE = ' + JSON.stringify(VINTAGE),
  '',
].join('\n');

function runWatch(args, { withAuthority = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tiger-watch-'));
  copyFileSync(join(root, 'scripts/tiger_zcta_vintage_watch.py'), join(dir, 'tiger_zcta_vintage_watch.py'));
  if (withAuthority) writeFileSync(join(dir, 'tiger_zcta_authority.py'), STUB);
  return spawnSync('python3', [join(dir, 'tiger_zcta_vintage_watch.py'), ...args], { encoding: 'utf8' });
}

ok(/PARKED as the vintage watch/.test(watch),
  '0a the watch file is parked — it is not a loader');
ok(!/psycopg|supabase/.test(watchPy),
  '0b the watch does not talk to the database');
ok(/does not\s+activate an N5 generation/.test(watch)
   && !/n5_generation_activate/.test(watchPy)
   && !/geo\.n5_gen_publish/.test(watchPy),
  '0c it does not activate a generation');
ok(lockHaystack(watch).includes(LOCK.replace(/\s+/g, ' ')),
  '0d the founder lock is quoted in the watch file');
ok(/does not touch `indexable`/.test(watch),
  '0e it names that it does not touch indexable');
ok(!/\bindexable\s*=/.test(watchPy),
  '0f it does not assign indexable');

ok(/from tiger_zcta_authority import/.test(watchPy),
  '1a the watch imports the checksum authority — it does not carry a second pin');
ok(!/TIGER_SHA256\s*=/.test(watchPy),
  '1b the watch does not assign TIGER_SHA256');
ok(!/TIGER_URL\s*=/.test(watchPy),
  '1c the watch does not assign TIGER_URL');
ok(!/TIGER_VINTAGE\s*=/.test(watchPy),
  '1d the watch does not assign TIGER_VINTAGE');
ok(/The watch compares; it does not carry a second pin/.test(watch),
  '1e missing authority is a STOP, not a fallback pin');

ok(/RANGE_BYTES\s*=\s*64/.test(watchPy),
  '2a live zip probe is 64 bytes');
ok(/headers\["Range"\]/.test(watchPy),
  '2b live zip probe sends a Range header');
ok(!/urlopen\(.*TIGER_URL/.test(watchPy) || /range_bytes/.test(watchPy),
  '2c the zip is never fetched without a range');

ok(/workflow_dispatch/.test(wf),
  '3a the workflow is dispatchable');
ok(!/^\s*schedule\s*:/m.test(wfPy),
  '3b the workflow has no schedule — a new cron is gated');
ok(!/pull_request/.test(wfPy),
  '3c the workflow does not run on pull_request');
ok(!/secrets\./.test(wf),
  '3d the workflow holds no secret');
ok(/python3 scripts\/tiger_zcta_vintage_watch\.py/.test(wfPy),
  '3e dispatch runs the watch, not a loader');
ok(!/\bphase2_b1_zcta\b/.test(wfPy) && !/\bn5_orchestrate\b/.test(wfPy),
  '3f dispatch does not load polygons or orchestrate a generation');

const current = runWatch([
  '--offline',
  '--index-html', fx('index-through-2025.html'),
  '--zcta-dir-html', fx('zcta520-listed.html'),
  '--head-ok',
]);
ok(current.status === 0 && /verdict PINNED_CURRENT/.test(current.stdout || ''),
  '4a pinned year, listed archive, live range → PINNED_CURRENT (exit 0)',
  (current.stderr || current.stdout || '').slice(0, 400));
ok(/year_count 20/.test(current.stdout || ''),
  '4b the year index is uncapped — 2006–2025 is 20 years, not extract_max 12',
  (current.stdout || '').slice(0, 400));
ok(/load no/.test(current.stdout || '') && /activate no/.test(current.stdout || ''),
  '4c even a current pin prints load no / activate no');

const newer = runWatch([
  '--offline',
  '--index-html', fx('index-with-2026.html'),
  '--zcta-dir-html', fx('zcta520-listed.html'),
  '--head-ok',
]);
ok(newer.status === 1 && /verdict NEWER_VINTAGE_PRESENT:2026/.test(newer.stdout || ''),
  '5a TIGER2026 on the index is a failed watch (report), never a load',
  (newer.stderr || newer.stdout || '').slice(0, 400));
ok(/do not load/.test(newer.stdout || ''),
  '5b the newer-vintage note forbids loading');

const missing = runWatch([
  '--offline',
  '--index-html', fx('index-through-2025.html'),
  '--zcta-dir-html', fx('zcta520-missing.html'),
  '--head-ok',
]);
ok(missing.status === 1 && /verdict PINNED_ARCHIVE_MISSING/.test(missing.stdout || ''),
  '6a a listed year whose zip is gone is PINNED_ARCHIVE_MISSING',
  (missing.stderr || missing.stdout || '').slice(0, 400));

const unreachable = runWatch([
  '--offline',
  '--index-html', fx('index-through-2025.html'),
  '--zcta-dir-html', fx('zcta520-listed.html'),
]);
ok(unreachable.status === 1 && /verdict PINNED_ARCHIVE_UNREACHABLE/.test(unreachable.stdout || ''),
  '6b listed zip with a failed range probe is PINNED_ARCHIVE_UNREACHABLE',
  (unreachable.stderr || unreachable.stdout || '').slice(0, 400));

const noAuth = runWatch([
  '--offline',
  '--index-html', fx('index-through-2025.html'),
  '--zcta-dir-html', fx('zcta520-listed.html'),
  '--head-ok',
], { withAuthority: false });
ok(noAuth.status === 1 && /does not carry a second pin/.test((noAuth.stderr || '') + (noAuth.stdout || '')),
  '7 missing authority STOPs rather than inventing a pin',
  ((noAuth.stderr || '') + (noAuth.stdout || '')).slice(0, 400));

const liveImport = spawnSync('python3', ['-c', `
import sys
sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))})
import tiger_zcta_vintage_watch as w
years = w.years_from_listing(open(${JSON.stringify(fx('index-through-2025.html'))}).read())
assert years[0] == 2006 and years[-1] == 2025 and len(years) == 20
years26 = w.years_from_listing(open(${JSON.stringify(fx('index-with-2026.html'))}).read())
assert 2026 in years26 and len(years26) == 21
assert w.pinned_year(${JSON.stringify(URL)}) == 2025
assert w.archive_name(${JSON.stringify(URL)}) == 'tl_2025_us_zcta520.zip'
assert w.archive_listed(open(${JSON.stringify(fx('zcta520-listed.html'))}).read(), 'tl_2025_us_zcta520.zip')
assert not w.archive_listed(open(${JSON.stringify(fx('zcta520-missing.html'))}).read(), 'tl_2025_us_zcta520.zip')
code, rc = w.verdict(pin_year=2025, years=years, listed=True, head_ok=True)
assert (code, rc) == ('PINNED_CURRENT', 0)
code, rc = w.verdict(pin_year=2025, years=years26, listed=True, head_ok=True)
assert code.startswith('NEWER_VINTAGE_PRESENT') and rc == 1
print('PURE_OK')
`], { encoding: 'utf8' });
ok(liveImport.status === 0 && /PURE_OK/.test(liveImport.stdout || ''),
  '8 pure listing helpers agree with the offline fixtures',
  (liveImport.stderr || liveImport.stdout || '').slice(0, 500));

ok(/NEWER_VINTAGE_PRESENT/.test(watchPy) && /PINNED_CURRENT/.test(watchPy),
  '9 the assignment this suite pins is present (mutation target is real)');

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);

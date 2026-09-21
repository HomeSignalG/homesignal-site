// The Upcoming Meetings window — ONE decision, THREE call sites, two languages.
//
// THE DEFECT THIS PINS. `meetings.meeting_date` is semantically a DATE, not an instant:
// measured 2026-09-13 over all 2,574 upcoming meetings, 1,475 sit at exactly 06:00:00Z and
// 1,005 at exactly 07:00:00Z — midnight MDT and midnight MST/PDT, a date stored in the
// body's own local zone (2,480 / 2,574 = 96.3%; lib/dashboard-aggregate.js has the receipt).
// Comparing that against `new Date().toISOString()` therefore dropped a meeting from
// "upcoming" at LOCAL MIDNIGHT ON THE DAY IT HAPPENS — a 9 AM council meeting was gone from
// the tile before anyone woke up, and the tile could only ever show LATER days. Measured
// against production 2026-09-21: 347 of 12,722 canonical ZIP pages (4,742 -> 5,089), and 27
// of Utah's 310 (207 -> 234).
//
// WHY THREE CALL SITES ARE PINNED TOGETHER: meetings() serves community.html,
// meetingsForZips() serves the dashboard, and scripts/gen_zip_pages.py builds the static
// /community/<zip>/ documents a crawler and a first-load visitor actually see. If the JS
// and the Python disagree, the served page and the live page disagree about the same ZIP.
//
// ⚠️ EVERY STRUCTURAL CHECK READS A COMMENT-STRIPPED COPY. The fix's own comments quote the
// retired `new Date().toISOString()` expression verbatim as the dated record, so a pin that
// searched raw source would match the comment and pass while the code regressed. The
// stripper is asserted in BOTH directions below before it is trusted.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataSrc = readFileSync(join(root, 'lib/data.js'), 'utf8');
const pySrc = readFileSync(join(root, 'scripts/gen_zip_pages.py'), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

// ---------------------------------------------------------------- comment strippers ----
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripPy = (s) => s.replace(/^\s*#.*$/gm, '');

// §0 the strippers themselves, both directions — an over-eager stripper would delete the
// live code and make every later check vacuously pass.
ok(stripJs("// x = new Date().toISOString()\nconst a = 1;").includes('const a = 1'),
   '§0a JS stripper KEEPS live code');
ok(!stripJs("// x = new Date().toISOString()\nconst a = 1;").includes('toISOString'),
   '§0b JS stripper REMOVES a commented expression');
ok(stripPy("# c = now_iso\nx = 1\n").includes('x = 1'), '§0c PY stripper KEEPS live code');
ok(!stripPy("# c = now_iso\nx = 1\n").includes('now_iso'), '§0d PY stripper REMOVES a comment');
// control: the real files are not emptied by stripping
ok(stripJs(dataSrc).length > dataSrc.length * 0.4, '§0e stripped data.js is still substantial');
ok(stripPy(pySrc).length > pySrc.length * 0.4, '§0f stripped gen_zip_pages.py is still substantial');

// ------------------------------------------------------------- the function itself ----
const win = { HS: {}, HS_CONFIG: { DATA_SOURCE: 'seed', DEFAULT_ZIP: '84302' } };
globalThis.window = win;
new Function('window', dataSrc)(win);
const cutoff = win.HS.upcomingCutoffIso;

ok(typeof cutoff === 'function', '§1a HS.upcomingCutoffIso is exported');
// Local parts in, local calendar date out. Constructed with new Date(y,m,d,...) so the
// assertion is independent of the runner's zone.
ok(cutoff(new Date(2026, 8, 21, 9, 30)) === '2026-09-21T00:00:00.000Z',
   '§1b 9:30 AM local -> that local calendar date at 00:00Z');
ok(cutoff(new Date(2026, 8, 21, 23, 59)) === '2026-09-21T00:00:00.000Z',
   '§1c 11:59 PM local -> the SAME date (never rolls forward)');
ok(cutoff(new Date(2026, 0, 5, 0, 0)) === '2026-01-05T00:00:00.000Z',
   '§1d zero-pads month and day');

// ------------------------------------------------------- the window it actually opens ----
// The production stamps: 06:00:00Z is midnight MDT, 07:00:00Z midnight MST/PDT, 04:00:00Z
// midnight EDT — the easternmost US local midnight, i.e. the EARLIEST stamp a meeting dated
// today can carry. If the cutoff ever exceeds that, a same-day meeting vanishes.
const admits = (c, stamp) => Date.parse(stamp) >= Date.parse(c);
for (const h of [0, 6, 9, 12, 17, 23]) {
  const c = cutoff(new Date(2026, 8, 21, h, 0));
  ok(admits(c, '2026-09-21T04:00:00+00:00') && admits(c, '2026-09-21T06:00:00+00:00')
     && admits(c, '2026-09-21T07:00:00+00:00'),
     `§2 at ${String(h).padStart(2, '0')}:00 local, a meeting dated TODAY is still upcoming (EDT/MDT/MST stamps)`);
}
const c21 = cutoff(new Date(2026, 8, 21, 12, 0));
ok(!admits(c21, '2026-09-20T06:00:00+00:00'), '§2g yesterday is NOT upcoming');
ok(!admits(c21, '2020-01-02T06:00:00+00:00'), '§2h a 2020 archive row is NOT upcoming');
ok(admits(c21, '2026-09-22T06:00:00+00:00'), '§2i tomorrow is upcoming');
ok(admits(c21, '2026-09-21T23:00:00+00:00'), '§2j a stated evening time today is upcoming');

// -------------------------------------------------------------- JS call sites (2 of 3) ----
const js = stripJs(dataSrc);
const jsWindows = js.match(/\.gte\(\s*'meeting_date'[^)]*\)/g) || [];
ok(jsWindows.length === 2, `§3a exactly 2 JS meeting windows (found ${jsWindows.length})`);
ok(jsWindows.every((w) => w.includes('upcomingCutoffIso')),
   '§3b BOTH JS call sites use the shared boundary');
ok(!/\.gte\(\s*'meeting_date'\s*,\s*new Date\(\)/.test(js),
   '§3c no JS call site compares meeting_date against a raw instant');

// ------------------------------------------------------------ Python call site (3 of 3) ----
const py = stripPy(pySrc);
ok(/def meeting_cutoff\(now_iso\):/.test(py), '§4a gen_zip_pages defines meeting_cutoff');
ok(/meeting_date=gte\.\{urllib\.parse\.quote\(meeting_cutoff\(now_iso\)\)\}/.test(py),
   '§4b the build-time FETCH uses meeting_cutoff');
ok(/>=\s*meeting_cutoff\(now_iso\)/.test(py), '§4c the build-time ASSERTION uses meeting_cutoff');
ok(!/meeting_date=gte\.\{urllib\.parse\.quote\(now_iso\)\}/.test(py),
   '§4d the build-time fetch no longer sends a full timestamp');
ok(!/\(m\.get\("meeting_date"\) or ""\) >= now_iso/.test(py),
   '§4e the build-time assertion no longer compares against a full timestamp');

// The Python half's real behaviour, run through the shipped module.
const pyOut = execFileSync('python3', ['-c', [
  'import sys; sys.path.insert(0, "scripts")',
  'from gen_zip_pages import meeting_cutoff as mc',
  'n = "2026-09-21T14:23:00"',
  'print(mc(n))',
  'print("2026-09-21T06:00:00+00:00" >= mc(n))',
  'print("2026-09-20T06:00:00+00:00" >= mc(n))',
].join('\n')], { cwd: root, encoding: 'utf8' }).trim().split('\n');
ok(pyOut[0] === '2026-09-21', '§5a meeting_cutoff returns the calendar date only');
ok(pyOut[1] === 'True', '§5b string compare KEEPS a meeting dated today');
ok(pyOut[2] === 'False', '§5c string compare DROPS yesterday');

// ------------------------------------------------------------------ the two halves agree ----
ok(cutoff(new Date(2026, 8, 21, 14, 23)).slice(0, 10) === pyOut[0],
   '§6 JS and Python resolve the SAME calendar-date boundary');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);

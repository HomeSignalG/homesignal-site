// scripts/build-home-report-preview.mjs --check MUST be read-only against the tracked homepage preview, pass or fail.
// Records the tracked asset's sha256 and mtime before and after each run, and proves: check passes on the committed asset (exit 0),
// FAILS on a tampered copy (exit 1) without touching either file, and the normal build still works (written to --out, never the tracked file).
// ENVIRONMENT NOTE: the preview is rendered with the machine's fonts (Inter where installed), so a runner without them cannot reproduce the
// COMMITTED pixels. This suite therefore proves the tool's behaviour against a baseline rendered in THIS environment, and proves read-only-ness against
// the tracked asset without requiring that --check passes on it here. "Does the committed image match the current renderer" is answered by running
// `node scripts/build-home-report-preview.mjs --check` on a machine with the same fonts as the one that built it (documented in the PR and the doc).
// Needs playwright and Python Pillow (the build tool's own dependencies); it fails loudly rather than skipping when they are missing.
// Run: node test/home-report-preview-check.browser.test.mjs
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, statSync, mkdtempSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The build script needs playwright. Importing it here also makes scripts/run-unit-tests.mjs classify this as a BROWSER suite (it reads each file for a
// playwright import), so it runs in the `browser` job, which installs playwright and Pillow, and never in the offline required gate.
await import('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(root, 'scripts', 'build-home-report-preview.mjs');
const TRACKED = join(root, 'assets', 'home-development-activity-report-preview.webp');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + String(detail).slice(0, 600)); } };
const snap = (f) => ({ sha: createHash('sha256').update(readFileSync(f)).digest('hex'), mtime: statSync(f).mtimeMs, size: statSync(f).size });
const run = (...a) => spawnSync('node', [SCRIPT, ...a], { encoding: 'utf8', cwd: root, timeout: 180000 });
const same = (a, b) => a.sha === b.sha && a.mtime === b.mtime;

const dir = mkdtempSync(join(tmpdir(), 'preview-check-'));
const t0 = snap(TRACKED);
const py = (code, ...args) => execFileSync('python3', ['-I', '-c', code, ...args], { encoding: 'utf8' });

// 1. the normal build still works (to --out, never the tracked file); this render is the BASELINE for the rest of the suite
const base = join(dir, 'baseline.webp');
const r0 = run('--out', base);
ok(r0.status === 0 && existsSync(base), '1 the normal build writes the requested file (exit 0)', r0.stdout + r0.stderr);
ok(py('import sys\nfrom PIL import Image\nprint("%d" % Image.open(sys.argv[1]).size[0])', base).trim() === '1448', '2 the regenerated preview is 1448 px wide');
ok(same(t0, snap(TRACKED)), '3 the normal build with --out never touched the tracked asset');

// 2. --check against the baseline: PASS, and the tracked asset is untouched
const r1 = run('--check', '--against', base);
ok(r1.status === 0 && /PASS/.test(r1.stdout), '4 --check passes against a baseline rendered in this environment (exit 0, PASS printed)', r1.stdout + r1.stderr);

// 3. --check on the TRACKED asset: read-only, whatever the verdict (fonts differ between machines, so the verdict itself is environment-dependent here)
const r2 = run('--check');
ok((r2.status === 0 && /PASS/.test(r2.stdout)) || (r2.status === 1 && /FAIL/.test(r2.stdout)), '5 --check on the tracked asset returns a meaningful PASS/FAIL with a matching exit status', r2.stdout + r2.stderr);
ok(same(t0, snap(TRACKED)), '6 --check left the tracked asset byte-identical with an unchanged mtime (verdict: ' + (r2.stdout.trim().split('\n').pop() || '').slice(0, 60) + ')');

// 4. tampered copies of the BASELINE: --check must FAIL (exit 1) without modifying the tracked asset or the file it compared against
const TAMPER = 'import sys\nfrom PIL import Image, ImageDraw\nim=Image.open(sys.argv[1]).convert("RGB")\nImageDraw.Draw(im).rectangle(tuple(int(v) for v in sys.argv[3:7]),fill=(255,255,255))\nim.save(sys.argv[2],"WEBP",quality=88)';
// text anchors found in the baseline itself (first dark pixel in a column band and below a row), so the boxes always land on real glyphs whatever the fonts
const ANCHOR = 'import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert("L"); x0,x1,y0=int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4])\nfor y in range(y0,im.height):\n  for x in range(x0,x1):\n    if im.getpixel((x,y))<110: print(x,y); sys.exit(0)\nprint("0 0")';
const [qx, qy] = py(ANCHOR, base, '780', '1400', '470').trim().split(' ').map(Number);   // first dark pixel of the first Quality-of-Life sentence
const [hx, hy] = py(ANCHOR, base, '470', '780', '420').trim().split(' ').map(Number);    // first dark pixel of the STAGE column label (header row) region
const LOCAL = [
  ['one letter of the STAGE column label', [hx - 1, hy - 3, hx + 9, hy + 13]],
  ['one letter of a Quality-of-Life sentence', [qx - 1, qy - 3, qx + 9, qy + 13]],
  ['one word of a Quality-of-Life sentence', [qx + 200, qy - 3, qx + 228, qy + 13]],
  ['the tail of a Quality-of-Life sentence', [qx + 150, qy - 3, qx + 330, qy + 15]],
];
const baseBefore = snap(base);
for (const [label, box] of LOCAL) {
  const f = join(dir, 'local-' + box.join('-') + '.webp');
  py(TAMPER, base, f, ...box.map(String));
  const r = run('--check', '--against', f);
  const mean = Number((/mean (\d+\.\d+)/.exec(r.stdout) || [])[1]);
  ok(r.status === 1 && /FAIL (tile|\d+ strongly)/.test(r.stdout) && !/whole-image mean/.test(r.stdout) && mean < 1.0,
    '7 --check FAILS on a localized edit (' + label + ') through the tile / strong-pixel checks, while the whole-image mean stays under 1.0 (' + mean + ')', r.stdout + r.stderr);
}
ok(same(t0, snap(TRACKED)) && same(baseBefore, snap(base)), '8 the tracked asset and the baseline are untouched after the localized-edit runs');

// 5. a gross change and a size mismatch also FAIL
const bad = join(dir, 'tampered.webp');
py('import sys\nfrom PIL import Image, ImageOps\nim=Image.open(sys.argv[1]).convert("RGB")\nbox=(0,0,im.width,im.height//2)\nim.paste(ImageOps.invert(im.crop(box)),box)\nim.save(sys.argv[2],"WEBP",quality=88)', base, bad);
const rb = run('--check', '--against', bad);
ok(rb.status === 1 && /FAIL/.test(rb.stdout), '9 --check FAILS (exit 1) when half the image is inverted', rb.stdout + rb.stderr);
const small = join(dir, 'small.webp');
py('import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert("RGB").resize((200,100)).save(sys.argv[2],"WEBP")', base, small);
const rs = run('--check', '--against', small);
ok(rs.status === 1 && /FAIL size/.test(rs.stdout), '10 --check FAILS on a dimension mismatch', rs.stdout + rs.stderr);

// 6. --check ignores --out: asking it to "write" there must not create the file; the tracked asset is still untouched
const never = join(dir, 'never.webp');
const rn = run('--check', '--against', base, '--out', never);
ok(rn.status === 0 && !existsSync(never), '11 --check never writes --out (file not created)', rn.stdout + rn.stderr);
ok(same(t0, snap(TRACKED)), '12 the tracked asset is still untouched after every run in this suite');

// 7. structure: in check mode the only write target is the temp candidate; the local checks are wired
const src = readFileSync(SCRIPT, 'utf8');
ok(/const target = CHECK \? join\(dir, 'candidate\.webp'\) : OUT;/.test(src), '13 the render target is the temp candidate whenever --check is set');
ok(/CHECK_TILE_TOLERANCE/.test(src) && /CHECK_STRONG_PIXELS/.test(src) && /bad\.append\('tile at/.test(src), '14 the localized (tile and strong-pixel) checks are wired into --check');
ok((src.match(/\bOUT\b/g) || []).length === 2, '15 OUT is referenced only where it is declared and chosen as the non-check target', (src.match(/\bOUT\b/g) || []).length);

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);

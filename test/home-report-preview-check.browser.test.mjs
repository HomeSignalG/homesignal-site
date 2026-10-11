// scripts/build-home-report-preview.mjs --check MUST be read-only against the tracked homepage preview, pass or fail.
// Records the tracked asset's sha256 and mtime before and after each run, and proves: check passes on the committed asset (exit 0),
// FAILS on a tampered copy (exit 1) without touching either file, and the normal build still works (written to --out, never the tracked file).
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

// 1. check on the committed asset: PASS, exit 0, tracked file untouched
const r1 = run('--check');
ok(r1.status === 0 && /PASS/.test(r1.stdout), '1 --check passes on the committed preview (exit 0, PASS printed)', r1.stdout + r1.stderr);
ok(same(t0, snap(TRACKED)), '2 --check left the tracked asset byte-identical with an unchanged mtime');

// 2. a tampered copy: --check must FAIL (exit 1), and must not modify the tracked file or the tampered copy
const bad = join(dir, 'tampered.webp');
copyFileSync(TRACKED, bad);
execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image, ImageOps\nim=Image.open(sys.argv[1]).convert("RGB")\nbox=(0,0,im.width,im.height//2)\nim.paste(ImageOps.invert(im.crop(box)),box)\nim.save(sys.argv[1],"WEBP",quality=88)', bad]);
const badBefore = snap(bad);
const r2 = run('--check', '--against', bad);
ok(r2.status === 1 && /FAIL/.test(r2.stdout), '3 --check FAILS (exit 1, FAIL printed) when the compared image differs', r2.stdout + r2.stderr);
ok(same(t0, snap(TRACKED)), '4 a failing --check still left the tracked asset untouched');
ok(same(badBefore, snap(bad)), '5 a failing --check did not rewrite the file it compared against');

// 2b. LOCALIZED edits: a one-letter label change, a changed word and a changed sentence barely move a whole-image average (each reads < 1.0 mean, which the
// first version of --check would have PASSED). Each must FAIL, and the failure must come from the LOCAL checks (a tile or strong pixels), not the mean.
const LOCAL = [
  ['one letter of the STAGE column label', [562, 438, 572, 454]],
  ['one letter of a Quality-of-Life sentence', [842, 512, 852, 528]],
  ['one word of a Quality-of-Life sentence', [1262, 540, 1290, 558]],
  ['the tail of a Quality-of-Life sentence', [1000, 572, 1180, 590]],
];
for (const [label, box] of LOCAL) {
  const f = join(dir, 'local-' + box.join('-') + '.webp');
  execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image, ImageDraw\nim=Image.open(sys.argv[1]).convert("RGB")\nImageDraw.Draw(im).rectangle(tuple(int(v) for v in sys.argv[3:7]),fill=(255,255,255))\nim.save(sys.argv[2],"WEBP",quality=88)', TRACKED, f, ...box.map(String)]);
  const r = run('--check', '--against', f);
  const mean = Number((/mean (\d+\.\d+)/.exec(r.stdout) || [])[1]);
  ok(r.status === 1 && /FAIL (tile|\d+ strongly)/.test(r.stdout) && !/whole-image mean/.test(r.stdout) && mean < 1.0,
    '4b --check FAILS on a localized edit (' + label + ') through the tile / strong-pixel checks, while the whole-image mean stays under 1.0 (' + mean + ')', r.stdout + r.stderr);
}
ok(same(t0, snap(TRACKED)), '4c the tracked asset is untouched after the localized-edit runs');

// 3. a size mismatch is a FAIL too, not a crash-and-pass
const small = join(dir, 'small.webp');
execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert("RGB").resize((200,100)).save(sys.argv[2],"WEBP")', TRACKED, small]);
const r3 = run('--check', '--against', small);
ok(r3.status === 1 && /FAIL size/.test(r3.stdout), '6 --check FAILS on a dimension mismatch', r3.stdout + r3.stderr);

// 4. --check ignores --out: asking it to "write" there must not create the file
const never = join(dir, 'never.webp');
const r4 = run('--check', '--out', never);
ok(r4.status === 0 && !existsSync(never), '7 --check never writes --out (file not created)', r4.stdout + r4.stderr);
ok(same(t0, snap(TRACKED)), '8 the tracked asset is still untouched after all check runs');

// 5. the normal build still works: writes to --out, 1448 wide, matches the committed preview, and the tracked file is not touched
const out = join(dir, 'regen.webp');
const r5 = run('--out', out);
ok(r5.status === 0 && existsSync(out), '9 the normal build writes the requested file (exit 0)', r5.stdout + r5.stderr);
const dims = existsSync(out) ? execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image\nprint("%dx%d" % Image.open(sys.argv[1]).size)', out], { encoding: 'utf8' }).trim() : '';
ok(dims === '1448x1241', '10 the regenerated preview is 1448x1241', dims);
const r6 = run('--check', '--against', out);
ok(r6.status === 0 && /PASS/.test(r6.stdout), '11 the regenerated file passes --check against a fresh render', r6.stdout + r6.stderr);
ok(same(t0, snap(TRACKED)), '12 the tracked asset was never touched by the regeneration test');

// 6. structure: in check mode the only write target is the temp candidate
const src = readFileSync(SCRIPT, 'utf8');
ok(/const target = CHECK \? join\(dir, 'candidate\.webp'\) : OUT;/.test(src), '13 the render target is the temp candidate whenever --check is set');
ok(/CHECK_TILE_TOLERANCE/.test(src) && /CHECK_STRONG_PIXELS/.test(src) && /bad\.append\('tile at/.test(src), '15 the localized (tile and strong-pixel) checks are wired into --check');
ok((src.match(/\bOUT\b/g) || []).length === 2, '14 OUT is referenced only where it is declared and chosen as the non-check target', (src.match(/\bOUT\b/g) || []).length);

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);

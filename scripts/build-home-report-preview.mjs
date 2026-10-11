// BUILDS assets/home-development-activity-report-preview.webp, the homepage's Development Activity report preview.
//
// THE PREVIEW IS THE REAL REPORT, NOT A DRAWING OF IT. Every pixel of the report comes from lib/da-report-view.js (the one presentation
// authority) mounted over a response made by the real request handler (supabase/functions/get-development-activity-report/handler.ts),
// which runs the real assemble(). What this script writes by hand is only the WORLD the engine reads (a few generic sample rows) and the
// "Illustrative sample" caption. It decides no Type, Stage, impact wording, ordering or distance; the engine and the view do.
// Re-run it whenever lib/da-report-view.js changes the table, or the sample property changes:
//   node scripts/build-home-report-preview.mjs            (writes the asset; needs playwright and Python Pillow)
//   node scripts/build-home-report-preview.mjs --check    (READ-ONLY: renders into a temp dir, compares the decoded pixels with the committed asset,
//                                                          prints PASS/FAIL, exits 0/1; the tracked asset is never opened for writing, pass or fail)
//   options: --out <file>      where the normal build writes (default: the tracked asset; ignored by --check)
//            --against <file>  what --check compares with (default: the tracked asset)
//   --check fails on ANY of: size mismatch; whole-image mean > CHECK_TOLERANCE; any 16x16 tile whose mean difference > CHECK_TILE_TOLERANCE; more than
//   CHECK_STRONG_PIXELS strongly different pixels. The last two are LOCAL checks: one changed label or sentence barely moves a whole-image mean.
// Output is a PNG in the scratch dir, then converted to webp by Python Pillow (the repo has no image dependency; this is a build-time tool only).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { wire, FAM_A, FAM_B, RIGHTS_AB, row, proj } from '../test/lib/da-report-view-world.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRACKED = join(root, 'assets', 'home-development-activity-report-preview.webp');
const CHECK = process.argv.includes('--check');
const argOf = (f) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const OUT = argOf('--out') || TRACKED;          // only the normal build ever writes here, and never in --check mode
const AGAINST = argOf('--against') || TRACKED;
const CHECK_TOLERANCE = 1.0;        // whole-image mean absolute difference per channel
const CHECK_TILE = 16;               // px; the localized check looks at 16x16 tiles
const CHECK_TILE_TOLERANCE = 3.0;    // no single tile may differ by more than this mean (a changed word/label lands well above it)
const CHECK_STRONG_DELTA = 96;       // a pixel counts as "strongly different" when any channel moves by more than this
const CHECK_STRONG_PIXELS = 12;      // ...and no more than this many may (a re-render of the same page gives 0)
const SAMPLE_ADDRESS = '1234 Sample Street';
const W = 1448; // intrinsic width kept from the asset it replaces, so the homepage layout and its 60/40 column do not move

// THE SAMPLE WORLD: generic, unmistakably-sample entries. No real agency record, project, developer or address.
const world = {
  rows: [row('s-1', 0.3, FAM_A), row('s-2', 0.4, FAM_B), row('s-3', 0.45, FAM_A), row('s-4', 0.7, FAM_B)],
  projects: [
    proj('s-1', FAM_A, { name: 'Sample Residential Development', type: 'Residential', status: 'Approved', stage: 'Advertised', date_kind: 'issued', submitted_at: '2026-09-24' }),
    proj('s-2', FAM_B, { name: 'Sample Commercial Center', type: 'Commercial', status: 'Proposed', date_kind: 'filed', submitted_at: '2026-09-10' }),
    proj('s-3', FAM_A, { name: 'Sample Road Improvement', type: 'Roads', status: 'Approved', stage: 'Permit Issued', date_kind: 'issued', submitted_at: '2026-09-18' }),
    proj('s-4', FAM_B, { name: 'Sample Industrial Facility', type: 'Industrial', status: 'Proposed', date_kind: 'filed', submitted_at: '2026-08-30' }),
  ],
  ledger: [], events: [], health: [],
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const HARNESS = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<link rel="stylesheet" href="/app.css"><script src="/lib/da-report-view.js"></script>'
  + '<style>body{background:#fff;margin:0}#frame{width:1040px;margin:0 auto;padding:28px 36px 32px;box-sizing:border-box}'
  + '.da-rv{border:0!important;box-shadow:none!important;border-radius:0!important}.pv-cap{font:12.5px/1.45 system-ui,sans-serif;color:#555;margin:0 0 14px}</style></head>'
  + '<body><div id="frame"><p class="pv-cap" id="cap"></p><main id="host"></main></div></body></html>';

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/__preview.html') { res.writeHead(200, { 'content-type': 'text/html' }).end(HARNESS); return; }
  const p = normalize(join(root, decodeURIComponent(url)));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(await readFile(p)); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const resp = await wire(world, { rights: RIGHTS_AB, address: SAMPLE_ADDRESS });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1120, height: 1400 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.route('**/*', (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
const dir = mkdtempSync(join(tmpdir(), 'home-preview-'));
const png = join(dir, 'preview.png');
await page.goto(base + '/__preview.html', { waitUntil: 'load' });
await page.evaluate(([r, s]) => {
  document.getElementById('cap').textContent = 'Illustrative sample. The property, projects, distances and dates below are sample entries, not records for a real address. In a real report every project links to its official source.';
  window.HS.daReportView.mount(document.getElementById('host'), r, { subject: s });
}, [resp, SAMPLE_ADDRESS]);
// The two regions of the REAL rendered report that carry the message, stitched in reading order: the page header (what the report is
// and for which property) and the Nearby Development table (Development | Stage | Quality-of-Life Impact). Each is a pixel crop of the
// live render; nothing is redrawn or reworded, and the report's own briefing, filters, map and evidence sections are simply not in frame.
const regions = await page.evaluate(() => {
  const top = (el) => el.getBoundingClientRect().top + window.scrollY;
  const table = document.querySelector('#host table');
  const sect = table.closest('section') || table.parentElement;
  const firstH2 = document.querySelector('#host h2');   // "Type and stage": the header block ends just above it's briefing, so cut at the header rule
  const rule = document.querySelector('#host header, #host .da-rv-head');
  return { headEnd: rule ? top(rule) + rule.getBoundingClientRect().height : null, sectTop: top(sect), tableBottom: top(table) + table.getBoundingClientRect().height, firstH2: top(firstH2) };
});
console.log(JSON.stringify(regions));
const HEAD_END = regions.headEnd || 250;
const clipA = { x: 40, y: 0, width: 1040, height: HEAD_END + 6 };
const clipB = { x: 40, y: regions.sectTop + 40, width: 1040, height: regions.tableBottom - regions.sectTop - 40 + 8 };
const pa = join(dir, 'a.png'), pb = join(dir, 'b.png');
await page.screenshot({ path: pa, fullPage: true, clip: clipA });
await page.screenshot({ path: pb, fullPage: true, clip: clipB });
execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
a = Image.open(sys.argv[1]).convert('RGB'); b = Image.open(sys.argv[2]).convert('RGB')
gap = 30
out = Image.new('RGB', (a.width, a.height + gap + b.height), 'white')
out.paste(a, (0, 0)); out.paste(b, (0, a.height + gap)); out.save(sys.argv[3])
`, pa, pb, png]);
await browser.close(); server.close();
writeFileSync(join(dir, 'resp.json'), JSON.stringify(resp, null, 1));
console.log('rendered', png);
if (process.argv.includes('--png-only')) process.exit(0);
const target = CHECK ? join(dir, 'candidate.webp') : OUT;   // check mode renders ONLY into the temp dir
execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w = ${W}; h = round(im.height * w / im.width)
im = im.resize((w, h), Image.LANCZOS)
im.save(sys.argv[2], 'WEBP', quality=88, method=6)
print(w, h)
`, png, target], { stdio: 'inherit' });
if (CHECK) {
  // Read the committed file only; compare decoded pixels. Exit 0 = the committed preview matches what the current renderer produces.
  let verdict = '';
  try {
    verdict = execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image, ImageChops, ImageStat
a = Image.open(sys.argv[1]).convert('RGB'); b = Image.open(sys.argv[2]).convert('RGB')
if a.size != b.size:
    print('FAIL size %s vs %s' % (a.size, b.size)); sys.exit(1)
d = ImageChops.difference(a, b)
mean = sum(ImageStat.Stat(d).mean) / 3
# LOCAL checks: a changed label or sentence barely moves the whole-image mean, so look at small tiles and at strongly different pixels too.
T = ${CHECK_TILE}
worst, wxy = 0.0, (0, 0)
for y in range(0, d.height, T):
    for x in range(0, d.width, T):
        m = sum(ImageStat.Stat(d.crop((x, y, min(x + T, d.width), min(y + T, d.height)))).mean) / 3
        if m > worst: worst, wxy = m, (x, y)
g = d.convert('L').point(lambda v: 255 if v > ${CHECK_STRONG_DELTA} else 0)
strong = g.histogram()[255]
tol, ttol, stol = float(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5])
bad = []
if mean > tol: bad.append('whole-image mean %.3f > %.1f' % (mean, tol))
if worst > ttol: bad.append('tile at x=%d,y=%d differs by %.2f > %.1f' % (wxy[0], wxy[1], worst, ttol))
if strong > stol: bad.append('%d strongly different pixels > %d' % (strong, stol))
print(('FAIL ' + '; '.join(bad) if bad else 'PASS') + ' [mean %.3f, worst %dpx tile %.2f, strong pixels %d]' % (mean, T, worst, strong))
sys.exit(1 if bad else 0)
`, AGAINST, target, String(CHECK_TOLERANCE), String(CHECK_TILE_TOLERANCE), String(CHECK_STRONG_PIXELS)], { encoding: 'utf8' });
    console.log(verdict.trim()); process.exit(0);
  } catch (e) { console.log(((e.stdout || '') + (e.stderr || '') || String(e)).trim()); process.exit(1); }
}

// BUILDS the homepage's "Example property report" preview: assets/home-report-example-{desktop,mobile}.webp + data/home-showcase/preview-receipt.json.
//
// WHAT IT IS: the REAL report for 3999 Touraine Dr, Frisco, TX 75034 (report snapshot eaf8c17c-..., generated 2026-10-12), rendered by the one presentation
// authority lib/da-report-view.js over the report body stored in data/home-showcase/touraine-75034-report-body.json. That file is the stored body BYTE FOR BYTE
// (md5 below equals md5(body) read from the stored-report table). This script invents no project, stage, date, distance or impact sentence, and decides no
// Type or impact: the view does. What it chooses by hand is ONLY which four rows to keep (one per kind) and the caption saying so.
//
//   node scripts/build-home-showcase-preview.mjs           writes the two webp files and the receipt (needs playwright + Python Pillow)
//   node scripts/build-home-showcase-preview.mjs --check   READ-ONLY: re-renders into a temp dir and compares the RENDERED TEXT with the committed receipt
//                                                           (font-independent), and the committed webp sizes. Exits 0/1. Never writes a tracked file.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(root, 'data/home-showcase/touraine-75034-report-body.json');
const RECEIPT = join(root, 'data/home-showcase/preview-receipt.json');
const ASSET = { desktop: join(root, 'assets/home-report-example-desktop.webp'), mobile: join(root, 'assets/home-report-example-mobile.webp') };
const CHECK = process.argv.includes('--check');

export const FIXTURE_MD5 = '0cf8f5d321b5fbf4849f380362bb9ba4';   // md5 of the stored report body for report eaf8c17c-1063-4b72-9467-dbf0e1a13909, read from production 2026-10-12
export const SUBJECT = '3999 Touraine Dr, Frisco, TX 75034';
// One record per kind, so the four different considerations are visible. Chosen by project_id; the view still renders each row in full.
export const KEEP = [
  'arcgis:frisco-active-building-permits:B25-02756',   // Residential, permitted
  'arcgis:frisco-active-building-permits:B25-03418',   // Commercial (a single-address site, not one of the five Wellness Way permits), permitted
  'arcgis:frisco-active-building-permits:B26-01529',   // Civic & public (school), permitted
  'arcgis:txdot-projects-info-all:091824314',          // Roads & infrastructure, proposed / under review
];
const CAPTION = 'Example property report · real records, as of Oct 12, 2026. Showing 4 of the report’s 9 official records, one of each kind. In the full report each record links to its official source.';
const FRAMES = { desktop: { w: 700, vw: 700 }, mobile: { w: 344, vw: 344 } };   // CSS px; deviceScaleFactor 2 => intrinsic 1400 / 688 wide

const body = readFileSync(FIXTURE);
if (createHash('md5').update(body).digest('hex') !== FIXTURE_MD5) { console.error('FAIL fixture md5 differs from the production snapshot'); process.exit(1); }
const report = JSON.parse(body.toString('utf8'));
const projectsById = new Map(report.projects.map((p) => [p.project_id, p]));
for (const id of KEEP) if (!projectsById.has(id)) { console.error('FAIL kept project missing from the report: ' + id); process.exit(1); }

const browser = await chromium.launch();
const dir = mkdtempSync(join(tmpdir(), 'home-showcase-'));
const out = { fixture_md5: FIXTURE_MD5, subject: SUBJECT, caption: CAPTION, report_counts: { records: report.projects.length }, kept: KEEP, frames: {} };

for (const [name, f] of Object.entries(FRAMES)) {
  const ctx = await browser.newContext({ viewport: { width: f.vw, height: 1400 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route('**/*', (r) => (r.request().url().startsWith('file://') ? r.continue() : r.abort()));
  await page.setContent('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="stylesheet" href="file://' + root + '/app.css"><style>body{background:#fff;margin:0}#frame{width:' + f.w + 'px;box-sizing:border-box;padding:14px 16px 16px}'
    + '.da-rv{border:0!important;box-shadow:none!important;border-radius:0!important;padding:0!important}.pv-cap{font:12px/1.4 Inter,system-ui,sans-serif;color:#44504a;margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #dfe5e1}</style></head>'
    + '<body><div id="frame"><p class="pv-cap" id="cap"></p><main id="host"></main></div></body></html>');
  await page.addScriptTag({ path: join(root, 'lib/da-report-view.js') });
  const r = await page.evaluate(([rep, subject, keep, caption]) => {
    document.getElementById('cap').textContent = caption;
    const ok = window.HS.daReportView.mount(document.getElementById('host'), { status: 'OK', coverage_state: rep.coverage.state, report: rep, render: {} }, { subject });
    const host = document.getElementById('host');
    // Keep the rows asked for; identify a row by the record's own address text, which the view prints in the name.
    const wanted = keep.map((id) => rep.projects.find((p) => p.project_id === id));
    const rows = [...host.querySelectorAll('table tbody tr')];
    const kept = [];
    rows.forEach((tr) => {
      const name = tr.querySelector('.da-rv-name').textContent;
      const hit = wanted.some((p) => p.name === name);
      if (hit) { kept.push(tr); } else { tr.remove(); }
    });
    // Keep the briefing's FIRST line (the counts) and drop the rest; remove the "Map N" references (no map is in frame).
    host.querySelectorAll('[data-da-briefing] li:not(:first-child)').forEach((li) => li.remove());
    host.querySelectorAll('.da-rv-sub').forEach((s) => { s.innerHTML = s.innerHTML.replace(/\s*·\s*Map \d+/, '').replace(/^Map \d+$/, ''); if (!s.textContent.trim()) s.remove(); });
    // A link inside a still image cannot be clicked, so the "Official source" link line is left out of the picture (the caption says where to find it).
    host.querySelectorAll('.da-rv-sub--src').forEach((s) => s.remove());
    const top = (el) => el.getBoundingClientRect().top + window.scrollY;
    const brief = host.querySelector('[data-da-briefing]');
    const table = host.querySelector('table');
    const head = host.querySelector('header, .da-rv-head');
    return { ok, rows: kept.length, briefBottom: top(brief) + brief.getBoundingClientRect().height, tableTop: top(table.closest('.da-rv-tablewrap')), tableBottom: top(table) + table.getBoundingClientRect().height, headTop: head ? top(head) : 0, text: [document.getElementById('cap'), head, brief, table].map((e) => (e ? e.innerText : '')).join(' ') };
  }, [report, SUBJECT, KEEP, CAPTION]);
  if (!r.ok || r.rows !== KEEP.length) { console.error('FAIL ' + name + ': view mounted=' + r.ok + ' rows=' + r.rows); await browser.close(); process.exit(1); }
  // Stitch: caption + header + briefing line, then the table. Nothing between them (the chip filters / paragraph) is in frame.
  const shot = async (clip, file) => page.screenshot({ path: file, fullPage: true, clip });
  const pa = join(dir, name + '-a.png'), pb = join(dir, name + '-b.png');
  await shot({ x: 0, y: 0, width: f.w, height: Math.ceil(r.briefBottom) + 6 }, pa);
  await shot({ x: 0, y: Math.floor(r.tableTop) - 2, width: f.w, height: Math.ceil(r.tableBottom - r.tableTop) + 14 }, pb);
  const png = join(dir, name + '.png');
  execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\na=Image.open(sys.argv[1]).convert("RGB");b=Image.open(sys.argv[2]).convert("RGB")\ngap=24\no=Image.new("RGB",(a.width,a.height+gap+b.height),"white");o.paste(a,(0,0));o.paste(b,(0,a.height+gap));o.save(sys.argv[3])', pa, pb, png]);
  const target = CHECK ? join(dir, name + '.webp') : ASSET[name];
  const size = execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert("RGB");im.save(sys.argv[2],"WEBP",quality=90,method=6);print(im.width,im.height)', png, target], { encoding: 'utf8' }).trim().split(' ').map(Number);
  out.frames[name] = { width: size[0], height: size[1], text: r.text.replace(/\s+/g, ' ').trim() };
  await ctx.close();
}
await browser.close();

if (CHECK) {
  const committed = JSON.parse(readFileSync(RECEIPT, 'utf8'));
  const sizes = (f) => execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\nprint(*Image.open(sys.argv[1]).size)', f], { encoding: 'utf8' }).trim().split(' ').map(Number);
  const bad = [];
  for (const name of Object.keys(FRAMES)) {
    if (committed.frames[name].text !== out.frames[name].text) bad.push(name + ': rendered text differs from the committed receipt');
    const [w, h] = sizes(ASSET[name]);
    if (w !== committed.frames[name].width || h !== committed.frames[name].height) bad.push(name + ': committed webp is ' + w + 'x' + h + ', receipt says ' + committed.frames[name].width + 'x' + committed.frames[name].height);
    if (w !== out.frames[name].width) bad.push(name + ': width differs from a fresh render');
  }
  if (JSON.stringify(committed.kept) !== JSON.stringify(out.kept) || committed.fixture_md5 !== out.fixture_md5) bad.push('kept rows or fixture md5 differ');
  console.log(bad.length ? 'FAIL ' + bad.join('; ') : 'PASS rendered text, kept rows, fixture md5 and webp sizes match the committed receipt');
  process.exit(bad.length ? 1 : 0);
}
writeFileSync(RECEIPT, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ desktop: out.frames.desktop, mobile: out.frames.mobile }, (k, v) => (k === 'text' ? v.slice(0, 80) + '…' : v), 1));

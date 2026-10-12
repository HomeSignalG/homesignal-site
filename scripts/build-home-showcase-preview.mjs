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
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
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
// CSS px; deviceScaleFactor 2 => intrinsic 1600 / 688 wide. The report view stacks each record below 760px of ITS OWN width (lib/da-report-view.js STACK_AT), so the
// desktop frame must be wide enough for the real four-column table (800 - 32 padding = 768 >= 760); the mobile frame is the view's own stacked form of the same four fields.
const FRAMES = { desktop: { w: 800, vw: 800, layout: 'four-column' }, mobile: { w: 344, vw: 344, layout: 'stacked' } };

const body = readFileSync(FIXTURE);
if (createHash('md5').update(body).digest('hex') !== FIXTURE_MD5) { console.error('FAIL fixture md5 differs from the production snapshot'); process.exit(1); }
const report = JSON.parse(body.toString('utf8'));
const projectsById = new Map(report.projects.map((p) => [p.project_id, p]));
for (const id of KEEP) if (!projectsById.has(id)) { console.error('FAIL kept project missing from the report: ' + id); process.exit(1); }

const browser = await chromium.launch();
const dir = mkdtempSync(join(tmpdir(), 'home-showcase-'));
const freshThumb = {};
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
    const kept = [], identity = [], problems = [];
    // A row is kept only if its printed name matches exactly ONE report project AND that project is one of the wanted ids; a name shared by two projects is refused.
    rows.forEach((tr) => {
      const name = tr.querySelector('.da-rv-name').textContent;
      const owners = rep.projects.filter((p) => p.name === name);
      const hit = owners.length === 1 && wanted.some((p) => p.project_id === owners[0].project_id);
      if (owners.length !== 1 && wanted.some((p) => p.name === name)) problems.push('kept name is shared by ' + owners.length + ' projects: ' + name);
      if (hit) { kept.push(tr); identity.push({ project_id: owners[0].project_id, name, type: tr.getAttribute('data-da-type'), stage: tr.getAttribute('data-da-stage'), stage_text: tr.querySelector('.da-rv-td--stage').innerText.replace(/\s+/g, ' ').replace(/^Stage: /, '').trim() }); } else { tr.remove(); }
    });
    identity.forEach((i) => { const p = rep.projects.find((q) => q.project_id === i.project_id); if (p.type.key !== i.type) problems.push('type mismatch for ' + i.project_id); });
    // Keep the briefing's FIRST line (the counts) and drop the rest; remove the "Map N" references (no map is in frame).
    host.querySelectorAll('[data-da-briefing] li:not(:first-child)').forEach((li) => li.remove());
    host.querySelectorAll('.da-rv-sub').forEach((s) => { s.innerHTML = s.innerHTML.replace(/\s*·\s*Map \d+/, '').replace(/^Map \d+$/, ''); if (!s.textContent.trim()) s.remove(); });
    // A link inside a still image cannot be clicked, so the "Official source" link line is left out of the picture (the caption says where to find it).
    host.querySelectorAll('.da-rv-sub--src').forEach((s) => s.remove());
    const top = (el) => el.getBoundingClientRect().top + window.scrollY;
    const brief = host.querySelector('[data-da-briefing]');
    const table = host.querySelector('table');
    const head = host.querySelector('header, .da-rv-head');
    // Layout truth: four visible columns (one header cell per column, laid out side by side) or the view's stacked form; no horizontal overflow; no clipped cell text.
    const ths = [...host.querySelectorAll('table thead th')].map((th) => ({ t: th.textContent.trim(), w: th.getBoundingClientRect().width, x: Math.round(th.getBoundingClientRect().left) }));
    const sideBySide = ths.length === 4 && ths.every((t) => t.w > 20) && new Set(ths.map((t) => t.x)).size === 4;
    const frameEl = document.getElementById('frame');
    const clipped = [...host.querySelectorAll('td, th[scope=row]')].filter((c) => c.scrollWidth > c.clientWidth + 1).length;
    const overflow = Math.max(frameEl.scrollWidth - frameEl.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { problems, identity, headers: ths.map((t) => t.t), layout: sideBySide ? 'four-column' : 'stacked', clipped, overflow, ok, rows: kept.length, briefBottom: top(brief) + brief.getBoundingClientRect().height, tableTop: top(table.closest('.da-rv-tablewrap')), tableBottom: top(table) + table.getBoundingClientRect().height, headTop: head ? top(head) : 0, text: [document.getElementById('cap'), head, brief, table].map((e) => (e ? e.innerText : '')).join(' ') };
  }, [report, SUBJECT, KEEP, CAPTION]);
  if (!r.ok || r.rows !== KEEP.length) { console.error('FAIL ' + name + ': view mounted=' + r.ok + ' rows=' + r.rows); await browser.close(); process.exit(1); }
  const lay = [];
  if (r.problems.length) lay.push(...r.problems);
  if (r.layout !== f.layout) lay.push(name + ': layout is ' + r.layout + ', expected ' + f.layout);
  if (r.headers.join('|') !== 'Development|Stage|Quality-of-Life Impact|Supporting Evidence') lay.push(name + ': column headings are ' + r.headers.join('|'));
  if (r.clipped) lay.push(name + ': ' + r.clipped + ' cell(s) have clipped text'); if (r.overflow > 0) lay.push(name + ': horizontal overflow of ' + r.overflow + 'px');
  if (lay.length) { console.error('FAIL ' + lay.join('; ')); await browser.close(); process.exit(1); }
  // Stitch: caption + header + briefing line, then the table. Nothing between them (the chip filters / paragraph) is in frame.
  const shot = async (clip, file) => page.screenshot({ path: file, fullPage: true, clip });
  const pa = join(dir, name + '-a.png'), pb = join(dir, name + '-b.png');
  await shot({ x: 0, y: 0, width: f.w, height: Math.ceil(r.briefBottom) + 6 }, pa);
  await shot({ x: 0, y: Math.floor(r.tableTop) - 2, width: f.w, height: Math.ceil(r.tableBottom - r.tableTop) + 14 }, pb);
  const png = join(dir, name + '.png');
  execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\na=Image.open(sys.argv[1]).convert("RGB");b=Image.open(sys.argv[2]).convert("RGB")\ngap=24\no=Image.new("RGB",(a.width,a.height+gap+b.height),"white");o.paste(a,(0,0));o.paste(b,(0,a.height+gap));o.save(sys.argv[3])', pa, pb, png]);
  const target = CHECK ? join(dir, name + '.webp') : ASSET[name];
  const size = execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert("RGB");im.save(sys.argv[2],"WEBP",quality=90,method=6);print(im.width,im.height)', png, target], { encoding: 'utf8' }).trim().split(' ').map(Number);
  const thumb = (file) => execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert("L");w=96;h=max(1,round(im.height*w/im.width));print(w,h,*Image.open(sys.argv[1]).convert("L").resize((w,h),Image.LANCZOS).tobytes())', file], { encoding: 'utf8' });
  out.frames[name] = { width: size[0], height: size[1], layout: r.layout, headers: r.headers, rows: r.identity, text: r.text.replace(/\s+/g, ' ').trim() };
  freshThumb[name] = thumb(target);
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
    // The committed IMAGE must be the one the receipt describes (a regenerated receipt with an old image, or the reverse, cannot pass) ...
    const sha = createHash('sha256').update(readFileSync(ASSET[name])).digest('hex');
    if (sha !== committed.frames[name].asset_sha256) bad.push(name + ': committed webp sha256 ' + sha.slice(0, 12) + ' is not the receipt\'s ' + String(committed.frames[name].asset_sha256).slice(0, 12));
    // ... and must LOOK like a fresh render of the current view (96px-wide grayscale layout thumbnail, mean absolute difference; heights must match).
    const tn = (f) => execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert("L");w=96;h=max(1,round(im.height*w/im.width));print(w,h,*im.resize((w,h),Image.LANCZOS).tobytes())', f], { encoding: 'utf8' }).trim().split(' ').map(Number);
    const a = tn(ASSET[name]), b = freshThumb[name].trim().split(' ').map(Number);
    if (a[1] !== b[1]) bad.push(name + ': committed image layout height differs from a fresh render (' + a[1] + ' vs ' + b[1] + ')');
    else { let d = 0; for (let i = 2; i < a.length; i++) d += Math.abs(a[i] - b[i]); d /= (a.length - 2); if (d > 6) bad.push(name + ': committed image differs from a fresh render (mean thumbnail difference ' + d.toFixed(1) + ' > 6)'); }
    if (JSON.stringify(committed.frames[name].rows) !== JSON.stringify(out.frames[name].rows) || committed.frames[name].layout !== out.frames[name].layout) bad.push(name + ': kept-row identities or layout differ from the receipt');
  }
  // the homepage must reference the assets at their real size and the receipt's version of them
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  for (const name of Object.keys(FRAMES)) {
    const fr = committed.frames[name], file = 'assets/home-report-example-' + name + '.webp';
    if (!html.includes(file) || !new RegExp(file.replace(/[.]/g, '\\.') + '[^>]*?(?:width="' + fr.width + '"[^>]*height="' + fr.height + '")', 's').test(html)) bad.push('index.html does not reference ' + file + ' at ' + fr.width + 'x' + fr.height);
  }
  if (JSON.stringify(committed.kept) !== JSON.stringify(out.kept) || committed.fixture_md5 !== out.fixture_md5) bad.push('kept rows or fixture md5 differ');
  console.log(bad.length ? 'FAIL ' + bad.join('; ') : 'PASS rendered text, kept rows, fixture md5 and webp sizes match the committed receipt');
  process.exit(bad.length ? 1 : 0);
}
for (const name of Object.keys(FRAMES)) out.frames[name].asset_sha256 = createHash('sha256').update(readFileSync(ASSET[name])).digest('hex');
writeFileSync(RECEIPT, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ desktop: out.frames.desktop, mobile: out.frames.mobile }, (k, v) => (k === 'text' ? v.slice(0, 80) + '…' : v), 1));

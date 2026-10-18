// THE SHARED LAYOUT SYSTEM, MEASURED IN A REAL BROWSER at 390 / 768 / 1024 / 1440 / 1920px.
// Run: node test/layout-system.browser.test.mjs
//
// For each page: (a) the logo's left edge IS the content's left edge, (b) the content is never wider than its tier
// (reading 1180 / workspace 1440 / full-bleed unrestricted), (c) the side gutter is clamp(16px, 4vw, 40px) wherever the tier
// is not yet capped, (d) the page never scrolls sideways. Nothing leaves the machine: every non-local request is aborted, so the
// pages render their chrome and their empty states (the alignment does not depend on data).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('   detail: ' + JSON.stringify(detail).slice(0, 500)); } };
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = createServer(async (q, r) => { try { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const b = await readFile(join(root, p)); r.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); r.end(b); } catch { r.writeHead(404); r.end('nf'); } }).listen(0);
const base = `http://localhost:${srv.address().port}/`;

const WIDTHS = [390, 768, 1024, 1440, 1920];
const gutter = (w) => Math.min(40, Math.max(16, w * 0.04));
// [page, tier, the tier's content width (null = unrestricted)]
const PAGES = [
  ['index.html', 'reading', 1180], ['about.html', 'reading', 1180], ['how-it-works.html', 'reading', 1180], ['terms.html', 'reading', 1180],
  ['contact.html', 'reading', 1180], ['alerts.html', 'reading', 1180], ['reports.html', 'reading', 1180], ['properties.html', 'reading', 1180],
  ['dashboard.html', 'reading', 1180], ['development.html', 'reading', 1180], ['development-activity.html', 'reading', 1180],
  ['community.html?zip=84302', 'reading', 1180],
  ['development-activity-reports.html', 'workspace', 1440],
  ['development-activity-review.html', 'reading', 1180], ['shared-report.html', 'reading', 1180],
  ['homesignalmap.html?zip=84302', 'full', null],
];
const browser = await chromium.launch();
for (const [pg, tier, tierW] of PAGES) {
  const bad = [];
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await page.route((u) => !u.href.startsWith(base.slice(0, -1)), (r) => r.abort());
    await page.goto(base + pg, { waitUntil: 'load' }).catch(() => {});
    await page.waitForSelector('.page, .home-index, main.wrap, .wrap', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const left = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { l: r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), r: r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) }; };
      const logo = document.querySelector('.hs-brand, .sb-brand');
      const cont = document.querySelector('.page, .home-index > section, main.wrap, .wrap');
      const title = document.querySelector('header.top h1');
      return { logo: logo ? logo.getBoundingClientRect().left : null, cont: cont ? left(cont) : null, title: title ? title.getBoundingClientRect().left : null, over: document.documentElement.scrollWidth - innerWidth };
    });
    const g = gutter(w);
    const cw = m.cont ? m.cont.r - m.cont.l : null;
    const want = tierW == null ? w - 2 * g : Math.min(tierW, w - 2 * g);
    if (m.over > 0) bad.push(`${w}: scrolls sideways by ${m.over}px`);
    if (!m.cont) bad.push(`${w}: no container found`);
    else {
      if (m.logo != null && Math.abs(m.logo - m.cont.l) > 0.75) bad.push(`${w}: logo ${m.logo} != content ${m.cont.l}`);
      if (m.title != null && Math.abs(m.title - m.cont.l) > 0.75) bad.push(`${w}: page title ${m.title} != content ${m.cont.l}`);
      if (Math.abs(cw - want) > 1.5) bad.push(`${w}: content ${cw} wide, the ${tier} tier wants ${want}`);
    }
    await ctx.close();
  }
  ok(bad.length === 0, `${pg} (${tier}): logo, title and content share one left edge, the content is the ${tier} width, no sideways scroll at ${WIDTHS.join('/')}`, bad);
}
await browser.close(); srv.close();
console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL PASS');
process.exit(fails ? 1 : 0);

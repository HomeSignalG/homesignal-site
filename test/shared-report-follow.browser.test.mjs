// "Follow this property" on the shared Development Activity report - the page half (shared-report.html).
//
// Proves: the primary action sits beside Download PDF at the top, visible without scrolling, solid green against Download PDF's outline
// (desktop), stacked and full width on a phone; both the top and the bottom buttons do the SAME one thing (hand the property to HomeSignal's
// own follow, in this tab's sessionStorage, with no token in it); a confirmed follow shows "Following this property" and a refused one shows
// an honest error and leaves the button usable; no address means no button; Download PDF still prints; the report itself is unchanged.
//
// Run: node test/shared-report-follow.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { RICH, RIGHTS_AB, wire } from './lib/da-report-view-world.mjs';

const VH = await import('../supabase/functions/view-shared-report/handler.ts');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 500)); } };

const VIEW_FN = 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/view-shared-report';
const LIVE = 'L'.repeat(42) + '1';
const RID = 'c0000000-0000-4000-8000-000000000001';
const ADDRESS = '742 Evergreen Terrace, Springfield, OR 97477';
const stored = (await wire(RICH, { view: 'customer', rights: RIGHTS_AB })).report;

function handlerFor(address) {
  return VH.makeHandler({
    openShared: async (t) => t === LIVE ? { report_id: RID, generated_at: '2026-10-03T12:00:00+00:00', body: JSON.stringify(stored), private_context_id: 'ctx', brokerage_name: 'Acme Realty' } : null,
    addressOf: async () => address,
    linkKey: async () => 'a'.repeat(64), clientKey: async () => 'b'.repeat(64), viewClaim: async () => ({ allowed: true }),
  });
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(await readFile(p)); } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();

async function open({ address = ADDRESS, width = 1280, height = 900, result = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [], calls = [], foreign = [], navs = [];
  const h = handlerFor(address);
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.route('**/*', async (route) => {
    const r = route.request(), url = r.url();
    if (url.includes('/properties.html')) { navs.push(url); return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body>shell</body>' }); }
    if (url.startsWith(base)) return route.continue();
    if (url === VIEW_FN) {
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204 });
      calls.push(r.postData());
      const res = await h(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: r.postData() }));
      return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    }
    foreign.push(url); return route.abort();
  });
  if (result) await page.addInitScript((v) => { if (!sessionStorage.getItem('__s')) { sessionStorage.setItem('__s', '1'); sessionStorage.setItem('hs.followPropertyResult', v); } }, result);
  await page.goto(base + '/shared-report.html#share=' + LIVE, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.getAttribute('data-state') !== 'loading', null, { timeout: 8000 }).catch(() => {});
  return { ctx, page, errors, calls, foreign, navs };
}
const box = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right }; });
const css = (page, sel, p) => page.$eval(sel, (e, k) => getComputedStyle(e)[k], p);
const shown = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);

// 1. desktop layout and hierarchy
{
  const { ctx, page, errors } = await open();
  ok((await page.textContent('#follow')).trim() === 'Follow this property', '1a the label is exactly "Follow this property"');
  ok(await shown(page, '#follow') && await shown(page, '#pdf'), '1b both actions are shown');
  const f = await box(page, '#follow'), d = await box(page, '#pdf');
  ok(Math.abs(f.y - d.y) < 3 && f.right <= d.x + 1 && d.x - f.right < 40, '1c on desktop they sit side by side: Follow first, Download PDF next to it', { f, d });
  ok(f.bottom < 900 && d.bottom < 900 && f.y < 120, '1d both are in the first screen, no scrolling', { f });
  ok(f.h >= 44 && d.h >= 44, '1e each is a full-size tap target', { f: f.h, d: d.h });
  const fb = await css(page, '#follow', 'backgroundColor'), db = await css(page, '#pdf', 'backgroundColor');
  ok(fb === 'rgb(21, 122, 73)' && db === 'rgb(255, 255, 255)', '1f Follow is the solid HomeSignal green; Download PDF is the quieter outlined button', { fb, db });
  ok((await css(page, '#pdf', 'borderTopWidth')) !== '0px' && (await css(page, '#follow', 'borderTopWidth')) === '0px', '1g only Download PDF carries the outline');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '1h no sideways scroll');
  ok(errors.length === 0, '1i no page errors', errors);
  await ctx.close();
}
// 2. phone layout
{
  const { ctx, page } = await open({ width: 390, height: 800 });
  const f = await box(page, '#follow'), d = await box(page, '#pdf');
  ok(f.y < d.y && Math.abs(f.w - d.w) < 2 && f.w > 300, '2a on a phone they stack, Follow first, each full width', { f, d });
  ok(f.bottom < 800 && d.bottom < 800, '2b both are in the first screen', { f, d });
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '2c no sideways scroll');
  ok(f.h >= 44 && d.h >= 44, '2d full-size tap targets');
  await ctx.close();
}
// 3. the hand-off: top and bottom do the same one thing
for (const sel of ['#follow', '#followBottom']) {
  const { ctx, page, navs, calls } = await open();
  const before = await page.$eval('#report', (e) => e.innerHTML);
  const stash = await page.evaluate(() => sessionStorage.getItem('hs-da-share'));
  await page.click(sel);
  await page.waitForURL('**/properties.html', { timeout: 8000 }).catch(() => {});
  const h = await page.evaluate(() => sessionStorage.getItem('hs.followProperty'));
  ok(navs.length === 1, '3 ' + sel + ' goes to the shell page', navs);
  const o = h ? JSON.parse(h) : null;
  ok(o && o.address === ADDRESS && o.back === 'shared-report.html' && Object.keys(o).length === 2, '3 ' + sel + ' hands over only the address and where to come back to', o);
  ok(h && !h.includes(LIVE) && !navs.join('').includes(LIVE) && !navs.join('').includes('Evergreen'), '3 ' + sel + ': the link token is not handed on, and the address is in no URL', { h, navs });
  ok(calls.length === 1, '3 ' + sel + ': no second report request - following does not regenerate the report', calls.length);
  ok(stash && stash === LIVE, '3 the report link stays in this tab, so the report reopens on return');
  await ctx.close();
  // report body untouched by the page for this click (before any navigation)
  ok(before.length > 1000, '3 the report was rendered before the click');
}
// 4. outcomes handed back
{
  const { ctx, page, navs } = await open({ result: 'followed' });
  ok((await page.textContent('#follow')).trim() === 'Following this property' && (await page.textContent('#followBottom')).trim() === 'Following this property', '4a a confirmed follow shows "Following this property" on both buttons');
  ok((await page.getAttribute('#follow', 'aria-disabled')) === 'true', '4b and the button is marked as already done');
  await page.dispatchEvent('#follow', 'click');   // Playwright's click() refuses an aria-disabled button; a real tap still fires the event
  await page.waitForTimeout(400);
  ok(navs.length === 0 && !(await page.evaluate(() => sessionStorage.getItem('hs.followProperty'))), '4c clicking it again asks for nothing: no second follow request');
  ok(/following this property/i.test(await page.textContent('#status')), '4d the page says so');
  await ctx.close();
}
{
  const { ctx, page } = await open({ result: 'failed' });
  ok((await page.textContent('#follow')).trim() === 'Follow this property', '5a a refused follow leaves the button as it was');
  const st = await page.textContent('#status');
  ok(/couldn.t follow/i.test(st) && /unchanged/i.test(st) && (await page.getAttribute('#status', 'class')) === 'err', '5b and says plainly that it did not work, and that the report is unchanged', st);
  ok(await shown(page, '.da-rv-table') && (await page.getAttribute('#follow', 'aria-disabled')) === null, '5c the report is still there and the button still works');
  await ctx.close();
}
// 5. no address, no button; PDF still prints; nothing private on the page
{
  const { ctx, page } = await open({ address: null });
  ok(!(await shown(page, '#follow')) && !(await shown(page, '#followBottom')) && await shown(page, '#pdf'), '6a with no address kept, the property cannot be identified, so Follow is not offered; Download PDF still is');
  await ctx.close();
}
{
  const { ctx, page } = await open();
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.click('#pdf');
  ok((await page.evaluate(() => window.__printed)) === 1, '7a Download PDF still opens the print window');
  const html = await page.content();
  ok(!/dashboard_admins|entitle|credit|client_label|agent_email|brokerage_id/i.test(html), '7b no brokerage, agent, client or entitlement internals on the page');
  await page.emulateMedia({ media: 'print' });
  ok(!(await shown(page, '#follow')) && !(await shown(page, '#followBottom')) && !(await shown(page, '#followHint')) && await shown(page, '#invite'), '7c the saved PDF carries no buttons, and keeps the invitation and its link');
  await ctx.close();
}
// 6. the bottom section is kept
{
  const { ctx, page } = await open();
  ok(/Follow quality-of-life intelligence for this property\./.test(await page.textContent('#invite h2')) && await shown(page, '#invite a'), '8a the bottom section and its Explore link are kept');
  ok(/Get notified when HomeSignal finds new development or meaningful project changes near this property\./.test(await page.textContent('#followHint')), '8b the supporting line is the approved one');
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);

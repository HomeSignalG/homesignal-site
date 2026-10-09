// THE CLIENT'S PAGE (shared-report.html), in Chromium - Development Activity build step 8. Offline: a local server serves the repo, and the
// project's function is the REAL view-shared-report handler on a fake link table. What is proved here is the PAGE: that a client who
// opens a private link sees the report, the brokerage and the street address and nothing of the agent; that the token leaves the address bar
// at once and goes to the server only in a POST body; that every link that opens nothing gets ONE message; that a failure is said in plain
// words and can be retried; that "Download PDF" is the browser's print window and the paper holds only the report; and that the page works
// on a phone. Whether a link is usable is the database's (test/report_share_delivery_pg); the handler's own rules are
// test/share-link-functions.test.mjs.
// Run: node test/shared-report-page.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { RICH, RIGHTS_AB, wire } from './lib/da-report-view-world.mjs';

const VH = await import('../supabase/functions/view-shared-report/handler.ts');
const Svc = await import('../supabase/functions/_shared/service-rest.ts');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0, total = 0;
const ok = (c, name, detail) => {
  total++;
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 600)); }
};

const PAGE = '/shared-report.html';
const VIEW_FN = 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/view-shared-report';
const LIVE = 'L'.repeat(42) + '1', REVOKED = 'R'.repeat(43), EXPIRED = 'E'.repeat(43), UNKNOWN = 'U'.repeat(43);
const RID = 'c0000000-0000-4000-8000-000000000001';
const ADDRESS = '742 Evergreen Terrace, Springfield, OR 97477';
const stored = (await wire(RICH, { view: 'customer', rights: RIGHTS_AB })).report;

function world({ address = ADDRESS, brokerage = 'Acme Realty' } = {}) {
  const w = { opened: [], down: false, address, brokerage };
  w.handler = VH.makeHandler({
    openShared: async (t) => {
      w.opened.push(t);
      if (w.down) throw new Svc.DataUnavailable('x');
      if (t !== LIVE) return null; // unknown, revoked and expired links open nothing, and the handler cannot tell which
      return { report_id: RID, generated_at: '2026-10-03T12:00:00+00:00', body: JSON.stringify(stored), private_context_id: 'ctx', brokerage_name: w.brokerage };
    },
    addressOf: async () => w.address,
    // the client-link rate limit (audit item D): never in the way of these page tests
    linkKey: async () => 'a'.repeat(64),
    clientKey: async () => 'b'.repeat(64),
    viewClaim: async () => ({ allowed: true }),
  });
  return w;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const p = normalize(join(root, decodeURIComponent(url)));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(await readFile(p)); }
  catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();

async function open({ w = world(), hash = '#share=' + LIVE, width = 1280, height = 900, failFetch = () => false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [], calls = [], foreign = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.route('**/*', async (route) => {
    const r = route.request(), url = r.url();
    if (url.startsWith(base)) return route.continue();
    if (url === VIEW_FN) {
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204 });
      const body = r.postData() ? JSON.parse(r.postData()) : null;
      calls.push({ body, headers: r.headers(), method: r.method() });
      if (failFetch()) return route.abort();
      const res = await w.handler(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: r.postData() }));
      return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text(), headers: { 'cache-control': res.headers.get('cache-control') || '' } });
    }
    foreign.push(url); return route.abort();
  });
  await page.goto(base + PAGE + hash, { waitUntil: 'load' });
  return { ctx, page, errors, calls, foreign, w };
}
const stateOf = (page) => page.evaluate(() => document.body.getAttribute('data-state'));
const settled = (page) => page.waitForFunction(() => document.body.getAttribute('data-state') !== 'loading', null, { timeout: 8000 }).catch(() => {});
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);

// ---- 1. a live link --------------------------------------------------------------------------------------------------------------------------------
{
  const { ctx, page, errors, calls, foreign } = await open();
  await settled(page);
  ok((await stateOf(page)) === 'report', '1a a live link shows the report');
  ok((await page.evaluate(() => location.hash)) === '' && !(await page.evaluate(() => location.href)).includes(LIVE), '1b the token is removed from the address bar as soon as it is read');
  ok(calls.length === 1 && calls[0].method === 'POST' && JSON.stringify(calls[0].body) === JSON.stringify({ token: LIVE }), '1c ONE request, a POST, carrying the token in its body and nothing else', calls.map((c) => c.body));
  ok(!calls[0].headers.referer && !JSON.stringify(calls).replace(JSON.stringify(calls[0].body), '').includes(LIVE), '1d the request sends no referrer, and the token is in no URL or header');
  const addr = await text(page, '.da-rv-addr');
  ok(addr === ADDRESS, '1e the client sees the street address (founder, 2026-10-03)', addr);
  const who = await text(page, '.da-rv-who');
  ok(who === 'Acme Realty', '1f and the brokerage\'s name - and no individual', who);
  ok((await page.$$('.da-rv-label')).length === 0 && !(await page.content()).includes('client_label'), '1g no client label is shown or even present: the function never sends one');
  ok((await page.$$('.da-rv-actions')).length === 0 && (await page.$$('.da-rv-act')).length === 0, '1h the report\'s own action bar (Compare, Watch, Share, PDF) is left out for a client');
  ok((await page.$$('.da-rv-table tbody tr')).length > 0 && /Search radius 0\.5 mile/.test(await text(page, '.da-rv-meta')), '1i it is the full report: the records table, and the half-mile radius in the header');
  ok(await visible(page, '#pdf') && (await text(page, '#rid')) === 'Report ID ' + RID, '1j the Download PDF button and the permanent report id are shown');
  ok(/private link/.test(await text(page, '#private')) && /six months/.test(await text(page, '#private')) && /withdraw it at any time/.test(await text(page, '#private')), '1k the page tells the client the link is private, how long it lasts and that the brokerage can withdraw it');
  ok((await page.$$('#invite')).length === 1 && await visible(page, '#invite') && (await text(page, '#invite h2')) === 'Follow quality-of-life intelligence for this property.' && (await page.getAttribute('#invite a', 'href')) === 'https://homesignal.net/' && (await text(page, '#invite a')).startsWith('Explore HomeSignal'), '1j2 the invitation is shown once, with the approved heading and a link to https://homesignal.net/');
  ok(await page.evaluate(() => { const i = document.getElementById('invite'); const r = document.getElementById('report'); const p = document.getElementById('private'); return !!(r.compareDocumentPosition(i) & 4) && !!(p.compareDocumentPosition(i) & 4) && !r.contains(i) && /Brokerage|Acme/.test(r.textContent); }), '1j3 it sits after the report and the privacy note, outside the report, and the brokerage is still in the report');
  ok(!(await text(page, 'body')).includes('Sign in') && (await page.$$('input')).length === 0, '1l there is no sign-in and no form: a client needs no account');
  await page.evaluate(() => { window.__prints = 0; window.print = function(){ window.__prints++; }; });
  await page.click('#pdf');
  ok((await page.evaluate(() => window.__prints)) === 1, '1m Download PDF opens the browser\'s print window (no PDF is made on a server)');
  ok(errors.length === 0 && foreign.length === 0, '1n no page error (the content security policy blocked nothing), nothing foreign fetched', { errors, foreign });
  ok(!(await page.title()).includes(ADDRESS) && (await page.title()) === 'HomeSignal — Development Activity report', '1o the tab title carries no address (it would name the PDF file and sit in browser history)');
  await ctx.close();
}

// ---- 2. a reload still works; the token is kept for this tab only ------------------------------------------------------------------------------------
{
  const { ctx, page, calls } = await open();
  await settled(page);
  await page.reload({ waitUntil: 'load' });
  await settled(page);
  ok((await stateOf(page)) === 'report' && calls.length === 2, '2a after a reload the report is shown again (the token is kept for this tab only)', calls.length);
  const kept = await page.evaluate(() => ({ local: JSON.stringify(localStorage), session: Object.keys(sessionStorage) }));
  ok(kept.local === '{}' && JSON.stringify(kept.session) === JSON.stringify(['hs-da-share']), '2b nothing is kept in localStorage; the one session entry is the tab\'s own copy of the token', kept);
  await ctx.close();
  const fresh = await open({ hash: '' });
  await settled(fresh.page);
  ok((await stateOf(fresh.page)) === 'missing' && fresh.calls.length === 0, '2c a new tab with no link in it asks the client to open their link, and calls nothing', fresh.calls.length);
  await fresh.ctx.close();
}

// ---- 3. every link that opens nothing is ONE message -------------------------------------------------------------------------------------------------------
{
  const seen = [];
  for (const t of [UNKNOWN, REVOKED, EXPIRED]) {
    const { ctx, page, calls } = await open({ hash: '#share=' + t });
    await settled(page);
    seen.push({ state: await stateOf(page), html: await page.$eval('#gone', (e) => e.innerHTML), status: await text(page, '#status'), report: (await page.$$('.da-rv')).length, calls: calls.length });
    await ctx.close();
  }
  ok(seen.every((s) => s.state === 'dead' && s.report === 0 && s.calls === 1) && new Set(seen.map((s) => s.html + '|' + s.status)).size === 1, '3a an unknown, a withdrawn and an expired link get the very same page, byte for byte: the client learns nothing about whether a link ever existed', seen.map((s) => s.state));
  const g = await open({ hash: '#share=' + UNKNOWN });
  await settled(g.page);
  ok(/doesn.t open a report/.test(await text(g.page, '#gone h1')) && /withdrawn/.test(await text(g.page, '#gone')) && /expired/.test(await text(g.page, '#gone')) && /Ask the person who sent it/.test(await text(g.page, '#gone')), '3b the message says it may have been withdrawn or expired and who to ask');
  ok(!(await visible(g.page, '#pdf')) && !(await visible(g.page, '#private')) && !(await visible(g.page, '#rid')), '3c a dead link shows no PDF button, no report id and no privacy note');
  ok(!(await visible(g.page, '#invite')), '3c3 a dead link shows no invitation');
  ok(!(await visible(g.page, '#gone button')), '3c2 and no "Try again" button: retrying a withdrawn or expired link cannot help');
  await g.ctx.close();
  const m = await open({ hash: '#share=short' });
  await settled(m.page);
  ok((await stateOf(m.page)) === 'missing' && m.calls.length === 0, '3d a link whose token is the wrong shape is not sent to the server at all');
  await m.ctx.close();
}

// ---- 4. failures are said in plain words and can be retried ---------------------------------------------------------------------------------------------------
{
  const w = world(); w.down = true;
  const { ctx, page, calls } = await open({ w });
  await settled(page);
  ok((await stateOf(page)) === 'error' && /couldn.t be loaded just now/.test(await text(page, '#gone h1')) && /Nothing is wrong with your link/.test(await text(page, '#gone')), '4a a service that cannot be reached says so, and says the link is not at fault');
  w.down = false;
  await page.click('#gone button');
  await settled(page);
  ok((await stateOf(page)) === 'report' && calls.length === 2 && (await visible(page, '.da-rv')), '4b "Try again" reads the link again and shows the report');
  await ctx.close();
  let fail = true;
  const n = await open({ failFetch: () => fail });
  await settled(n.page);
  ok((await stateOf(n.page)) === 'error', '4c a request that never gets an answer is the same "could not be loaded", never "this link is dead"');
  fail = false;
  await n.page.click('#gone button');
  await settled(n.page);
  ok((await stateOf(n.page)) === 'report', '4d and retrying works once the connection is back');
  await n.ctx.close();
}

// ---- 5. the address the private layer no longer keeps -------------------------------------------------------------------------------------------------
{
  const w = world({ address: null });
  const { ctx, page } = await open({ w });
  await settled(page);
  const addr = await text(page, '.da-rv-addr');
  ok((await stateOf(page)) === 'report' && !addr.includes('Evergreen') && addr.length > 0, '5a once the address has been purged the report still opens, with the report\'s own words where the address was', addr);
  await ctx.close();
}

// ---- 6. print: only the report goes on the paper ---------------------------------------------------------------------------------------------------------------
{
  const { ctx, page } = await open();
  await settled(page);
  await page.emulateMedia({ media: 'print' });
  const p = await page.evaluate(() => {
    const shown = (sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; };
    return { report: shown('#report .da-rv'), head: shown('header.top'), pdf: shown('#pdf'), status: shown('#status'), privateNote: shown('#private'), rid: shown('#rid'), notice: shown('#gone'), cards: shown('.da-rv-table tbody tr'), filters: shown('.da-rv-sec--filters'), bg: getComputedStyle(document.body).backgroundColor };
  });
  ok(p.report && p.cards && p.rid && !p.head && !p.pdf && !p.status && !p.privateNote && !p.notice && !p.filters && p.bg === 'rgb(255, 255, 255)', '6a on paper: the report and its id, on white; no header, no button, no status line, no privacy note, no filter chips', p);
  ok(await visible(page, '#invite'), '6a2 the invitation prints, so a saved PDF carries it');
  const links = await page.evaluate(() => { const a = [...document.querySelectorAll('.da-rv a[href^="http"]')]; return a.length ? getComputedStyle(a[0], '::after').content : 'none'; });
  ok(links === 'none' || /^" \(http/.test(links), '6b each official link prints its address after it, so the paper copy still leads to the record', links);
  await ctx.close();
}

// ---- 7. a phone --------------------------------------------------------------------------------------------------------------------------------------------------
{
  const { ctx, page } = await open({ width: 390, height: 844 });
  await settled(page);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(await visible(page, '#invite a') && (await page.$eval('#invite a', (a) => a.getBoundingClientRect().height)) >= 44, '7a2 on a phone the link is visible and a full-size tap target');
  ok((await stateOf(page)) === 'report' && wide <= 0, '7a on a 390 px screen the report is shown and the page does not scroll sideways', wide);
  await ctx.close();
  const d = await open({ hash: '#share=' + UNKNOWN, width: 390, height: 844 });
  await settled(d.page);
  ok((await d.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, '7b and so is the message for a link that opens nothing');
  await d.ctx.close();
}

// ---- 8. layout: a comfortable reading width on a large desktop, and clear section headings (layout refinement) ----------------------------------------
{
  const { ctx, page } = await open({ width: 1920, height: 1000 });
  await settled(page);
  const m = await page.evaluate(() => {
    const rv = document.querySelector('.da-rv').getBoundingClientRect(), h = getComputedStyle(document.querySelector('.da-rv-h2')), addr = getComputedStyle(document.querySelector('.da-rv-addr'));
    return { w: Math.round(rv.width), h2: parseFloat(h.fontSize), weight: Number(h.fontWeight), upper: h.textTransform, addr: parseFloat(addr.fontSize) };
  });
  ok(m.w >= 1000 && m.w <= 1120, '8a on a 1920 px screen the report is a comfortable 1000-1120 px column (it was 928 px)', m);
  ok(m.h2 >= 20 && m.weight >= 600 && m.upper === 'none', '8b a section heading is at least 20 px, semibold and not small uppercase', m);
  ok(m.addr > m.h2, '8c the property address is the strongest element, larger than any section heading', m);
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n' + (total - fails) + ' passed, ' + fails + ' failed of ' + total);
process.exit(fails ? 1 : 0);

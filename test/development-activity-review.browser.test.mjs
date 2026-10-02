// THE PRIVATE REVIEW PAGE (development-activity-review.html), driven in a real browser — build step 4 of
// docs/development-activity-build-steps-100526.md.
//
// The page is admin-only and unreachable from CI without an allow-listed account, so this suite stands in for the two things outside
// it: the supabase-js sign-in (a stub served at the CDN URL, so no request leaves the machine) and the report function (its answers
// are the REAL request handler's output for the shared fixture world, test/lib/da-report-view-world.mjs). What it proves:
//   * signed out, "Make report" asks for sign-in and calls nothing; after sign-in the waiting report is made without a second click;
//   * signed in, it calls the one function, once, with the user's own token and only { address, view }, and draws the report with
//     the header fields typed on the page;
//   * every non-report answer (not an admin, address not found, ZIP not covered, data unavailable, a refused address) is a plain
//     sentence and no report;
//   * a short address is refused on the page without a call; the report fits a 390 px screen; nothing else is fetched.
// Run: node test/development-activity-review.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { RICH, RIGHTS_SHIPPED, wire } from './lib/da-report-view-world.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0, total = 0;
const ok = (c, name, detail) => {
  total++;
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 600)); }
};

const PAGE = '/development-activity-review.html';
const FN = 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-development-activity-report';
const ADDRESS = '20 N Main St, Brigham City, UT 84302';
const W_INTERNAL = await wire(RICH, { view: 'internal' });
const W_CUSTOMER = await wire(RICH, { rights: RIGHTS_SHIPPED });
const W_CLEARED = await wire(RICH); // a customer view with sources cleared: what a trial report looks like once permissions arrive

// supabase-js stand-in. window.__sb.session is the signed-in session, or null; verifyOtp signs in and tells every listener.
const SB_STUB = (signedIn) => `
window.__sb = { session: ${signedIn ? "{ access_token: 'TEST-TOKEN', user: { email: 'founder@example.com' } }" : 'null'}, listeners: [], otp: 0 };
window.supabase = { createClient: function () { return { auth: {
  getSession: function () { return Promise.resolve({ data: { session: window.__sb.session } }); },
  onAuthStateChange: function (cb) { window.__sb.listeners.push(cb); return { data: { subscription: { unsubscribe: function () {} } } }; },
  signInWithOtp: function () { window.__sb.otp++; return Promise.resolve({ error: null }); },
  verifyOtp: function () { window.__sb.session = { access_token: 'TEST-TOKEN', user: { email: 'founder@example.com' } };
    window.__sb.listeners.forEach(function (cb) { cb('SIGNED_IN', window.__sb.session); }); return Promise.resolve({ error: null }); },
  signOut: function () { window.__sb.session = null; window.__sb.listeners.forEach(function (cb) { cb('SIGNED_OUT', null); }); return Promise.resolve({}); }
} }; } };`;

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

/** Opens the page. reply(body) decides the function's answer: [httpStatus, json]. Records every call and every other request. */
async function open({ signedIn = true, width = 1280, height = 900, reply = () => [200, W_INTERNAL] } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [], calls = [], foreign = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.route('**/*', async (route) => {
    const r = route.request(), url = r.url();
    if (url.startsWith(base)) return route.continue();
    if (url.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: SB_STUB(signedIn) });
    if (url === FN) {
      const body = r.postData() ? JSON.parse(r.postData()) : null;
      calls.push({ method: r.method(), auth: r.headers().authorization || null, apikey: r.headers().apikey || null, body });
      const [status, json] = reply(body);
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    }
    foreign.push(url); return route.abort();
  });
  await page.goto(base + PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sb && window.__sb.listeners.length > 0);
  return { ctx, page, errors, calls, foreign };
}
const status = (page) => page.$eval('#status', (e) => ({ text: e.textContent.trim(), error: e.classList.contains('err') }));
const sections = (page) => page.$$eval('#report .da-rv-sec', (s) => s.map((e) => e.getAttribute('aria-label')));
async function make(page, address = ADDRESS) {
  await page.fill('#addr', address);
  await page.click('#go');
}
const settle = (page) => page.waitForFunction(() => !document.getElementById('go').disabled && !/Making the report/.test(document.getElementById('status').textContent));

// ---- 1. signed out: sign in first, then the waiting report is made ----------------------------------------------------------------------
{
  const { ctx, page, errors, calls, foreign } = await open({ signedIn: false });
  ok(/Sign in/.test(await page.textContent('#who')), '1a signed out, the page offers Sign in');
  await make(page);
  ok(await page.$eval('#auth-overlay', (e) => getComputedStyle(e).display === 'flex') && calls.length === 0,
    '1b "Make report" while signed out opens the sign-in and calls nothing', calls.length);
  await page.fill('#auth-email', 'founder@example.com');
  await page.click('#auth-submit');
  await page.waitForSelector('#auth-code', { state: 'visible' });
  await page.fill('#auth-code', '123456');
  await page.click('#auth-submit');
  // bounded and caught: if the waiting report is never made, 1c must fail BY NAME, not crash the suite on a timeout
  await page.waitForFunction(() => document.querySelectorAll('#report .da-rv-sec').length > 0, null, { timeout: 8000 }).catch(() => {});
  ok(calls.length === 1 && calls[0].auth === 'Bearer TEST-TOKEN', '1c after the code is accepted, the waiting report is made once, with the new token, without a second click', calls);
  ok(/Signed in as founder@example\.com/.test(await page.textContent('#who')), '1d the page says who is signed in');
  ok(errors.length === 0 && foreign.length === 0, '1e no page error, and nothing fetched but the page, its libraries, the sign-in stand-in and the function', { errors, foreign });
  await ctx.close();
}

// ---- 2. signed in: one call, the user's token, only { address, view }; the report and its header ---------------------------------------
{
  const { ctx, page, errors, calls, foreign } = await open();
  await page.fill('#label', 'Smith buyers');
  await page.fill('#brokerage', 'ABC Realty');
  await page.fill('#agent', 'Pat Agent');
  await make(page);
  await settle(page);
  ok(calls.length === 1 && calls[0].method === 'POST' && calls[0].auth === 'Bearer TEST-TOKEN' && /^eyJ/.test(calls[0].apikey || ''),
    '2a one POST to the report function, carrying the signed-in user\'s own token and the public browser key', calls.map((c) => ({ ...c, apikey: (c.apikey || '').slice(0, 6) })));
  ok(JSON.stringify(calls[0].body) === JSON.stringify({ address: ADDRESS, view: 'internal' }),
    '2b it sends only the address and the view (no radius: a report is always 0.5 mile; the label, brokerage and agent stay on the page)', calls[0].body);
  const secs = await sections(page);
  ok(secs[0] === 'What Changed Around This Property' && secs.includes('Development Activity Map') && secs.includes('Permitted / Under Construction') && secs[secs.length - 1] === 'Official evidence & coverage',
    '2c the report is drawn by the shared view, in the plan\'s order', secs);
  const head = await page.$eval('#report .da-rv-head', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  ok(head.includes(ADDRESS) && head.includes('Smith buyers') && head.includes('ABC Realty · Pat Agent'), '2d the header carries the typed address, client label, brokerage and agent', head);
  const st = await status(page);
  ok(!st.error && st.text === 'Report ready: ' + W_INTERNAL.report.projects.length + ' official records within 0.5 miles.', '2e the status line counts the report\'s official records', st);
  ok(/Internal view/.test(await page.textContent('#viewnote')), '2f the internal view says it includes records a paying customer would not see');
  ok(W_INTERNAL.credit.reason === 'INTERNAL_VIEW' && /^The internal view is never charged\./.test(await page.textContent('#creditnote')) && await page.isVisible('#creditnote'),
    '2f2 and that it is never charged (the function\'s credit rule said so)', await page.textContent('#creditnote'));
  await page.click('#report .da-rv-chip[data-da-filter="stage"][data-da-value="proposed"]');
  const hidden = await page.$$eval('#report .da-rv-sec--approved .da-rv-card', (c) => c.filter((e) => e.hasAttribute('hidden')).length);
  ok(hidden > 0, '2g the filters work on this page (the view\'s own controls are wired up)', hidden);
  ok(errors.length === 0 && foreign.length === 0, '2h no page error and no other request', { errors, foreign });
  await ctx.close();
}

// ---- 3. the customer view -----------------------------------------------------------------------------------------------------------------
{
  const { ctx, page, calls } = await open({ reply: (b) => [200, b && b.view === 'customer' ? W_CUSTOMER : W_INTERNAL] });
  await page.check('input[name="view"][value="customer"]');
  await make(page);
  await settle(page);
  ok(calls[0].body.view === 'customer', '3a choosing the customer view asks the function for it', calls[0].body);
  ok(JSON.stringify(await sections(page)) === JSON.stringify(['No data ingested', 'Official evidence & coverage']) && /Customer view/.test(await page.textContent('#viewnote')),
    '3b with nothing cleared, the customer view says "No data ingested" over the coverage notice, and the page says which view it is', await sections(page));
  ok(W_CUSTOMER.credit.uses_report === false && (await page.textContent('#creditnote')) === 'For a trial customer, this report would not use a free report: No data ingested.',
    '3c the founder sees that today\'s customer report would not use a free report, and why (ruling R5)', await page.textContent('#creditnote'));
  await ctx.close();
}
{
  const { ctx, page } = await open({ reply: (b) => [200, b && b.view === 'customer' ? W_CLEARED : W_INTERNAL] });
  await page.check('input[name="view"][value="customer"]');
  await make(page);
  await settle(page);
  ok(W_CLEARED.credit.uses_report === true && (await page.textContent('#creditnote')) === 'For a trial customer, this report would use one of the 20 free reports (development shown).'
    && !(await sections(page)).includes('No data ingested'), '3d once a source is cleared, a report that shows development would use one free report, and has no outcome notice', await page.textContent('#creditnote'));
  await ctx.close();
}

// ---- 4. every answer that is not a report is a plain sentence -------------------------------------------------------------------------------
{
  const cases = [
    ['not an admin', [403, { error: 'forbidden' }], /not on the HomeSignal admin list/],
    ['address not found', [200, { status: 'ADDRESS_NOT_RESOLVED', report: null, stored: false }], /could not be found/],
    ['ZIP not covered', [200, { status: 'OUTSIDE_COVERAGE', zip: '99999', report: null, stored: false }], /ZIP 99999, which HomeSignal does not cover yet/],
    ['records unavailable', [502, { error: 'data_unavailable' }], /records could not be read just now/],
    ['geocoder down', [502, { error: 'geocoder_unavailable' }], /address lookup service could not be reached/],
    ['address refused', [400, { error: 'invalid_request', detail: 'address' }], /full street address/],
    ['server error', [500, { error: 'internal' }], /Something went wrong/],
  ];
  for (const [name, answer, want] of cases) {
    const { ctx, page } = await open({ reply: () => answer });
    await make(page);
    await settle(page);
    const st = await status(page);
    const raw = /forbidden|ADDRESS_NOT_RESOLVED|OUTSIDE_COVERAGE|data_unavailable|geocoder_unavailable|invalid_request|internal\b/.test(st.text);
    ok(st.error && want.test(st.text) && !raw && (await sections(page)).length === 0, '4 ' + name + ': "' + st.text + '", no raw code, no report', st);
    await ctx.close();
  }
}

// ---- 5. a short address is refused on the page; a phone-width screen fits ---------------------------------------------------------------------
{
  const { ctx, page, calls } = await open();
  await make(page, '84302');
  ok(calls.length === 0 && /full street address/.test((await status(page)).text), '5a a ZIP alone is refused on the page, before any call', calls.length);
  await ctx.close();
  const phone = await open({ width: 390, height: 800 });
  await make(phone.page);
  await settle(phone.page);
  const over = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 0 && (await sections(phone.page)).length > 5, '5b at 390 px the page and the report fit the screen (no sideways scroll)', over);
  await phone.ctx.close();
}

await browser.close();
server.close();
console.log('\n' + (total - fails) + ' passed, ' + fails + ' failed of ' + total);
process.exit(fails ? 1 : 0);

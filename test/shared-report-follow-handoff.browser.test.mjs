// "Follow this property" - the shell half (shell.js: HS.followProperty and the hand-off from a shared report).
//
// Drives the REAL shell on a real page (properties.html) with a stub Supabase client whose app_properties enforces the same unique key
// production does, and proves: a signed-in visitor's hand-off saves ONE Address through the one writer (savePlaceRow) and is sent back to
// the report with 'followed'; a repeat is the same success and not a second row; a signed-out visitor is sent to the existing sign-in and
// nothing is saved or kept; a hand-off with a return target that is not a bare file name does nothing; a failed lookup saves nothing and
// reports 'failed'. No report, credit, share link or subscription write is made by this path other than the existing area follow.
//
// Run: node test/shared-report-follow-handoff.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 400)); } };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(await readFile(p)); }
  catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();

const ADDRESS = '742 Evergreen Terrace, Springfield, OR 97477';

const STUB = `
window.__db = { properties: [], inserts: 0, seq: 0, rpcs: [], tables: [], fnCalls: [] };
window.__fold = function (a) { return String(a == null ? '' : a).toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\\s+/g, ' ').trim(); };
function key(r) { return [r.user_id, window.__fold(r.address), r.zip == null ? '' : r.zip, window.__fold(r.input_address == null ? r.address : r.input_address)].join('|'); }
window.supabase = { createClient: function () {
  function table(name) {
    var filters = {}, pending = null, mode = null, api = {};
    window.__db.tables.push(name);
    ['order','limit','in','contains','gte','lte','not','or','filter','range'].forEach(function (m) { api[m] = function () { return api; }; });
    api.select = function () { return api; };
    api.eq = function (c, v) { filters[c] = v; return api; };
    api.match = function (o) { Object.keys(o).forEach(function (k) { filters[k] = o[k]; }); return api; };
    api.insert = function (row) { mode = 'insert'; pending = row; return api; };
    api.upsert = function (row) { mode = 'other'; pending = row; return api; };
    api.update = function (row) { mode = 'other'; pending = row; return api; };
    api.delete = function () { mode = 'other'; return api; };
    function settle() {
      if (mode === 'insert' && name === 'app_properties') {
        window.__db.inserts++; if (window.__rec) window.__rec('i', '');
        var row = Object.assign({}, pending);
        if (window.__db.properties.some(function (r) { return key(r) === key(row); })) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "app_properties_user_place_key"' } };
        row.id = 'p' + (++window.__db.seq); row.created_at = new Date(Date.now() + window.__db.seq).toISOString();
        window.__db.properties.push(row); if (window.__rec) window.__rec('r', JSON.stringify(row)); return { data: row, error: null };
      }
      if (mode) return { data: [], error: null };
      var src = name === 'app_properties' ? window.__db.properties : [];
      return { data: src.filter(function (r) { return Object.keys(filters).every(function (k) { return String(r[k]) === String(filters[k]); }); }), error: null };
    }
    api.single = function () { var r = settle(); if (r.error) return Promise.resolve(r); var d = Array.isArray(r.data) ? r.data[0] : r.data; return Promise.resolve({ data: d || null, error: d ? null : { code: 'PGRST116', message: 'no rows' } }); };
    api.maybeSingle = function () { var r = settle(); var d = Array.isArray(r.data) ? r.data[0] : r.data; return Promise.resolve({ data: d || null, error: r.error || null }); };
    api.then = function (res) { return Promise.resolve(settle()).then(res); };
    return api;
  }
  return {
    from: table,
    rpc: function (n) { window.__db.rpcs.push(n); return Promise.resolve({ data: null, error: null }); },
    functions: { invoke: function (fn, opts) {
      window.__db.fnCalls.push(fn);
      if (fn !== 'geocode-address') return Promise.resolve({ data: null, error: null });
      if (window.__geocodeDown) return Promise.resolve({ data: null, error: { message: 'down' } });
      var street = String((opts && opts.body && opts.body.address) || '').split(',')[0].trim().toUpperCase();
      return Promise.resolve({ data: { match: { matchedAddress: street + ', SPRINGFIELD, OR, 97477', lat: 44.0462, lng: -123.0220, zip: '97477', city: 'SPRINGFIELD', state: 'OR' } }, error: null });
    } },
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: window.__signedIn ? { user: { id: 'user-A', email: 'a@example.com' } } : null } }); },
      signInWithOtp: function () { return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    }
  };
} };`;

async function run({ signedIn, handoff, geocodeDown = false, pre = null }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [], saved = []; let inserts = 0;
  await page.exposeFunction('__rec', (k, v) => { if (k === 'i') inserts++; else saved.push(JSON.parse(v)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('/shared-report.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>report</title><body>report</body>' });
    if (url.startsWith(base)) return route.continue();
    if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
    if (url.includes('/rest/v1/') || url.includes('/auth/v1/') || url.includes('/functions/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.abort();
  });
  await page.addInitScript(([s, g, h]) => {
    window.__signedIn = s; window.__geocodeDown = g;
    try { if (h !== null && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('hs.followProperty', h); sessionStorage.setItem('__seeded', '1'); } } catch (e) {}
  }, [signedIn, geocodeDown, handoff === null ? null : (typeof handoff === 'string' ? handoff : JSON.stringify(handoff))]);
  const nav = page.waitForURL('**/shared-report.html', { timeout: 15000 }).then(() => true).catch(() => false);
  await page.goto(base + '/properties.html', { waitUntil: 'domcontentloaded' });
  const returned = signedIn && handoff ? await nav : false;
  if (!returned) await page.waitForFunction(() => window.HS && window.HS.state && window.__db, null, { timeout: 15000 }).catch(() => {});
  if (!returned) await page.waitForTimeout(1200);
  const out = await page.evaluate(() => ({
    url: location.pathname,
    result: sessionStorage.getItem('hs.followPropertyResult'),
    handoffLeft: sessionStorage.getItem('hs.followProperty'),
    authOpen: !!document.querySelector('#authModal.open, #authModal.show, #authModal:not(.hidden)') && getComputedStyle(document.getElementById('authModal') || document.body).display !== 'none',
  })).catch(() => null);
  if (out) { out.rows = saved.map((r) => ({ address: r.address, input: r.input_address, zip: r.zip })); out.inserts = inserts; }
  await ctx.close();
  return { returned, out, errors };
}

const H = { address: ADDRESS, back: 'shared-report.html' };

// A - signed in: one Address saved by the existing writer, sent back with 'followed'
{
  const r = await run({ signedIn: true, handoff: H });
  ok(r.returned, 'A signed-in visitor is sent back to the report', r.out);
  ok(r.out && r.out.result === 'followed', 'A the outcome handed back is "followed"', r.out);
  ok(r.out && r.out.handoffLeft === null, 'A the hand-off is removed as soon as it is read', r.out);
  ok(r.out && r.out.rows && r.out.rows.length === 1 && r.out.rows[0].zip === '97477' && r.out.rows[0].input === ADDRESS, 'A exactly ONE saved Address, carrying the typed line (the existing identity rule)', r.out);
  ok(r.errors.length === 0, 'A no page errors', r.errors);
}
// B - idempotent: the second follow of the same property is the same success and no second row
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('/shared-report.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body>report</body>' });
    if (url.startsWith(base)) return route.continue();
    if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
    if (url.includes('/rest/v1/') || url.includes('/auth/v1/') || url.includes('/functions/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.abort();
  });
  await page.addInitScript(() => { window.__signedIn = true; });
  await page.goto(base + '/properties.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HS && typeof window.HS.followProperty === 'function' && window.HS.state && window.HS.state.session, null, { timeout: 15000 });
  const two = await page.evaluate(async (a) => {
    const x = await window.HS.followProperty(a), y = await window.HS.followProperty(a);
    return { x, y, rows: window.__db.properties.length, inserts: window.__db.inserts };
  }, ADDRESS);
  ok(two.x.ok && !two.x.existed && two.y.ok && two.y.existed, 'B the second follow is the same success, reported as already followed', two);
  ok(two.rows === 1, 'B still ONE row: the database key, not the page, makes it idempotent', two);
  const seen = await page.evaluate(() => ({ tables: Array.from(new Set(window.__db.tables)), fns: Array.from(new Set(window.__db.fnCalls)) }));
  ok(!seen.tables.some((t) => /report|credit|share|brokerage|entitle/i.test(t)) && seen.fns.every((f) => f === 'geocode-address'), 'B it touches no report, credit, share or brokerage table and calls only the address lookup', seen);
  const bad = await page.evaluate(async () => [await window.HS.followProperty(''), await window.HS.followProperty('x'.repeat(300))]);
  ok(bad.every((b) => !b.ok && b.reason === 'invalid'), 'B an unreadable or oversize address follows nothing', bad);
  await ctx.close();
}
// C - signed out: the existing sign-in opens; nothing saved; nothing left behind to fire on a later sign-in
{
  const r = await run({ signedIn: false, handoff: H });
  ok(!r.returned && r.out && r.out.rows.length === 0 && r.out.inserts === 0, 'C signed out: nothing is saved', r.out);
  ok(r.out && r.out.handoffLeft === null, 'C and the hand-off is not left in storage for a later, unrelated sign-in', r.out);
  ok(r.out && r.out.authOpen === true, 'C the existing sign-in is opened', r.out);
}
// D - a return target that is not a bare file name is refused outright
for (const back of ['https://evil.example/x.html', '../x.html', '//evil.example/a.html', 'javascript:alert(1)', 'a/b.html', '']) {
  const r = await run({ signedIn: true, handoff: { address: ADDRESS, back } });
  ok(!r.returned && r.out && r.out.rows.length === 0 && r.out.url === '/properties.html', 'D back=' + JSON.stringify(back) + ' does nothing and saves nothing', r.out);
}
// E - a lookup that fails saves nothing and says so
{
  const r = await run({ signedIn: true, handoff: H, geocodeDown: true });
  ok(r.returned && r.out && r.out.result === 'failed' && r.out.rows.length === 0, 'E a failed lookup saves nothing and reports "failed"', r.out);
}
// F - malformed hand-offs do nothing
for (const h of ['not json', '{"address":"x","back":"shared-report.html"}', JSON.stringify({ back: 'shared-report.html' })]) {
  const r = await run({ signedIn: true, handoff: h });
  ok(!r.returned && r.out && r.out.rows.length === 0, 'F malformed hand-off ' + h.slice(0, 20) + ' does nothing', r.out);
}

await browser.close(); server.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);

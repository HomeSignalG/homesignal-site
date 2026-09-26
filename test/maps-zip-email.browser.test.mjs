// "What is changing in my zip code?" — the Map 1 sign-up, driven in a real browser.
//
// A Bluesky visitor lands on Map 1 signed OUT, taps the button, types their email and the
// 6-digit code, and must end up subscribed WITHOUT the page navigating away (the verify
// branch used to send them to location.pathname, dropping ?zip= and the utm_* tags). The
// Supabase client is a fake that records every call, so the test asserts WHAT the page
// sent — the ZIP community, the maps topic, alert consent only, the Bluesky first touch —
// and in WHICH ORDER (the follow before the selection, so onboarding cannot trap a new
// resident).
// Run: node test/maps-zip-email.browser.test.mjs   (needs playwright; reported in CI's browser job)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fulfillZipModeReport } from './lib/zip-mode-rpc-mock.mjs';
const require = createRequire(import.meta.url);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const TOPIC = 'What is changing in my zip code?';
const ZIP_ROW = [{ zip: '97702', home_lat: 44.02, home_lng: -121.30, counts: { facilities: 0 },
  refreshed_at: '2026-09-01T00:00:00Z', paywall: false, facilities_unavailable: false, sites: [] }];

// A fake supabase-js v2: a chainable query builder over an in-memory store, OTP auth, and
// an rpc() that records its arguments. Every call lands in window.__fake.log, in order.
const FAKE_SUPABASE = `
(function(){
  var F = window.__fake = window.__fake || { log: [], follows: [], subscribed: false,
    session: null, rpcArgs: null };
  try { var pre = JSON.parse(sessionStorage.getItem('__fake_state') || 'null');
        if (pre) { F.session = pre.session; F.subscribed = pre.subscribed; F.follows = pre.follows || []; } } catch (e) {}
  var COMMUNITIES = [
    { id: 'zip-97702', name: 'Bend (97702)', level: 'zip', zip_codes: ['97702'], parent_id: 'county-deschutes', government_topics: [] },
    { id: 'county-deschutes', name: 'Deschutes County', level: 'county', zip_codes: ['97701','97702'], parent_id: null, government_topics: ['County Commission & county business'] }
  ];
  function rowsFor(q) {
    var t = q.table, f = q.filters;
    var eq = function(c){ var m = f.filter(function(x){ return x[0]==='eq' && x[1]===c; })[0]; return m ? m[2] : undefined; };
    if (t === 'communities') {
      var cz = f.filter(function(x){ return x[0]==='contains'; })[0];
      if (cz) return COMMUNITIES.filter(function(c){ return cz[2].every(function(z){ return c.zip_codes.indexOf(z) > -1; }); });
      var id = eq('id'); return COMMUNITIES.filter(function(c){ return c.id === id; });
    }
    if (t === 'app_community_meta') return [{ zip: eq('zip') || '97702', name: 'Bend', state: 'OR', data_quality: 'pass' }];
    if (t === 'app_follows') return F.follows.map(function(z){ return { target_id: z, target_type: 'community' }; });
    if (t === 'my_alert_subscriptions') {
      if (!F.subscribed) return [];
      var rows = [{ community_id: 'zip-97702', zip_code: '97702', stream: 'maps', topic: ${JSON.stringify(TOPIC)},
                    origin: 'explicit', sort_order: 1, subscribed: true }];
      var cid = eq('community_id'), st = eq('stream');
      return rows.filter(function(r){ return (!cid || r.community_id === cid) && (!st || r.stream === st); });
    }
    return [];
  }
  function builder(table) {
    var q = { table: table, filters: [], op: 'select', row: null };
    var b = {};
    ['select','order','limit','range','in','neq','gte','lte','lt','gt','is','or','not','single','maybeSingle']
      .forEach(function(m){ b[m] = function(){ return b; }; });
    b.eq = function(c, v){ q.filters.push(['eq', c, v]); return b; };
    b.contains = function(c, v){ q.filters.push(['contains', c, v]); return b; };
    b.match = function(o){ Object.keys(o).forEach(function(k){ q.filters.push(['eq', k, o[k]]); }); return b; };
    b.insert = function(row){ q.op = 'insert'; q.row = row; return b; };
    b.upsert = function(row){ q.op = 'upsert'; q.row = row; return b; };
    b.update = function(row){ q.op = 'update'; q.row = row; return b; };
    b.delete = function(){ q.op = 'delete'; return b; };
    b.then = function(res, rej){
      F.log.push({ kind: q.op, table: table, filters: q.filters, row: q.row });
      var out;
      if (q.op === 'insert' && table === 'app_follows') {
        var z = q.row && q.row.target_id;
        if (F.follows.indexOf(z) > -1) out = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        else { F.follows.push(z); out = { data: [q.row], error: null }; }
      } else if (q.op !== 'select') { out = { data: [], error: null }; }
      else out = { data: rowsFor(q), error: null };
      return Promise.resolve(out).then(res, rej);
    };
    return b;
  }
  var client = {
    from: function(t){ return builder(t); },
    rpc: function(name, args){
      F.log.push({ kind: 'rpc', name: name, args: args });
      if (name === 'enable_area_email_alerts') { F.rpcArgs = args; F.subscribed = true; return Promise.resolve({ data: 'u-row', error: null }); }
      // Map 1's own ZIP read: an honest, boundary-complete ZIP with nothing on it.
      if (name === 'app_zip_projects_markers') return Promise.resolve({ data: { zip: (args && args.p_zip) || '97702',
        mode: 'authoritative', status: 'boundary_complete', projects: [], markers: [] }, error: null });
      return Promise.resolve({ data: [], error: null });
    },
    functions: { invoke: function(){ return Promise.resolve({ data: null, error: null }); } },
    auth: {
      getSession: function(){ return Promise.resolve({ data: { session: F.session } }); },
      getUser: function(){ return Promise.resolve({ data: { user: F.session && F.session.user } }); },
      onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
      signInWithOtp: function(o){ F.log.push({ kind: 'otp', email: o.email }); return Promise.resolve({ data: {}, error: null }); },
      verifyOtp: function(o){
        F.log.push({ kind: 'verify', email: o.email });
        F.session = { access_token: 'fake', user: { id: 'auth-user-1', email: o.email } };
        return Promise.resolve({ data: { session: F.session, user: F.session.user }, error: null });
      },
      signOut: function(){ F.session = null; return Promise.resolve({ error: null }); }
    }
  };
  window.supabase = { createClient: function(){ return client; } };
})();`;

const browser = await chromium.launch();
const pageErrors = [];
const routeHandler = async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  const J = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('/rpc/zip_mode_report_sites')) return fulfillZipModeReport(route, () => ZIP_ROW);
  if (url.includes('/rest/v1/development_reports')) return J(ZIP_ROW);
  if (url.includes('/rest/v1/') || url.includes('/functions/v1/')) return J([]);
  if (url.includes('leaflet@1.9.4/dist/leaflet.js') || url.includes('leaflet@1.9.4/dist/leaflet.css')) {
    const css = url.endsWith('.css');
    let local = null;
    try { local = require.resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch (e) { local = null; }
    if (!local) return route.continue();
    return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript',
      body: await readFile(local, 'utf8') });
  }
  if (url.includes('@supabase/supabase-js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_SUPABASE });
  if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200,
    contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript', body: '' });
  if (url.includes('tile.openstreetmap') || url.includes('arcgisonline')) return route.fulfill({ status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  return J({});
};

async function open(path, preState) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  if (preState) {
    await ctx.addInitScript((s) => { try { sessionStorage.setItem('__fake_state', JSON.stringify(s)); } catch (e) {} }, preState);
  }
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
  await page.route('**/*', r => routeHandler(r));
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('zipmode')
    && document.getElementById('zipEmailBtn'), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  return { ctx, page };
}

// ═══════ 1. A Bluesky visitor, signed OUT, taps the button and signs up in place ═══════
const LANDING = '/homesignalmap.html?zip=97702&utm_source=bluesky&utm_medium=social&utm_campaign=maps';
{
  const { ctx, page } = await open(LANDING);
  const btn = page.locator('#zipEmailBtn');
  ok(await btn.isVisible(), '1a the button is visible on the Map 1 ZIP page');
  ok((await btn.textContent()).trim() === TOPIC, "1b it reads the founder's wording, word for word");
  const note = (await page.locator('#zipEmailNote').textContent()).trim();
  ok(/^We'll email you when HomeSignal posts about what's changing in this ZIP code\./.test(note),
    '1c the consent line is shown next to the button', note);
  if (process.env.MAPS_EMAIL_SCREENSHOT_BEFORE) {
    await page.screenshot({ path: process.env.MAPS_EMAIL_SCREENSHOT_BEFORE, clip: { x: 0, y: 0, width: 1280, height: 560 } }).catch(() => {});
  }

  await btn.click();
  await page.waitForSelector('#authModal', { state: 'visible', timeout: 5000 }).catch(() => {});
  ok(await page.locator('#authEmail').isVisible(), '1d signed out, the tap opens the 6-digit sign-in');
  await page.fill('#authEmail', 'resident@example.com');
  await page.click('#authSubmitBtn');
  await page.waitForSelector('#authCode', { state: 'visible', timeout: 5000 });
  await page.fill('#authCode', '123456');
  await page.click('#authSubmitBtn');
  await page.waitForFunction(() => (document.getElementById('zipEmailBtn').textContent || '').indexOf('signed up') > -1,
    null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);   // past the verify branch's 700 ms close-and-decide

  const F = await page.evaluate(() => window.__fake);
  const rpc = F.log.filter(e => e.kind === 'rpc' && e.name === 'enable_area_email_alerts');
  ok(rpc.length === 1, '1e the sign-up RESUMED after the code: enable_area_email_alerts called once', rpc.length);
  const a = F.rpcArgs || {};
  ok(a.p_community_id === 'zip-97702' && a.p_zip_code === '97702',
    "1f filed on the ZIP's own community, never the county", a);
  ok(JSON.stringify(a.p_topics) === JSON.stringify({ maps: [TOPIC] }), '1g the selection is the one maps topic', a.p_topics);
  ok(a.p_marketing_consent === false, '1h alert consent ONLY (p_marketing_consent false)', a.p_marketing_consent);
  ok(a.p_email === 'resident@example.com' && a.p_consent_version === '2026-09-25'
     && a.p_marketing_consent_copy === note, '1i the recorded consent copy IS the sentence that was shown', a);
  ok(a.p_referral_source === 'bluesky' && a.p_referral_campaign === 'maps',
    '1j the Bluesky first touch travels with the sign-up', [a.p_referral_source, a.p_referral_campaign]);
  const iFollow = F.log.findIndex(e => e.kind === 'insert' && e.table === 'app_follows'
    && e.row && e.row.target_id === '97702' && e.row.target_type === 'community');
  const iRpc = F.log.findIndex(e => e.kind === 'rpc' && e.name === 'enable_area_email_alerts');
  ok(iFollow > -1 && iFollow < iRpc, '1k the ZIP is saved to My Places BEFORE the selection', { iFollow, iRpc });
  ok(!F.log.some(e => e.kind === 'rpc' && /subscribe_area_defaults|signup_complete/.test(e.name)),
    '1l nothing is written on the county identity (no floor, no reconcile-to-exact signup)');
  ok(page.url() === base + LANDING, '1m the page did NOT navigate: ?zip= and utm_* are intact', page.url());
  ok((await btn.textContent()).includes("You're signed up") && await btn.isDisabled(),
    '1n the button now says the resident is signed up', await btn.textContent());
  const onb = page.locator('#onboardingOverlay');
  ok(!(await onb.count()) || !(await onb.isVisible()), '1o the first-time setup screen did not trap the new resident');
  ok(!(await page.locator('#authModal').isVisible()), '1p the sign-in closed itself');
  if (process.env.MAPS_EMAIL_SCREENSHOT) {
    await page.screenshot({ path: process.env.MAPS_EMAIL_SCREENSHOT, clip: { x: 0, y: 0, width: 1280, height: 560 } }).catch(() => {});
  }
  await ctx.close();
}

// ═══════ 2. Already subscribed: the button says so on load (read from the canonical view) ═══════
{
  const { ctx, page } = await open('/homesignalmap.html?zip=97702',
    { session: { access_token: 'fake', user: { id: 'auth-user-1', email: 'resident@example.com' } },
      subscribed: true, follows: ['97702'] });
  await page.waitForFunction(() => (document.getElementById('zipEmailBtn').textContent || '').indexOf('signed up') > -1,
    null, { timeout: 8000 }).catch(() => {});
  ok((await page.locator('#zipEmailBtn').textContent()).includes("You're signed up"),
    '2a a subscribed resident sees the signed-up state on load');
  await ctx.close();
}

// ═══════ 3. Signed in but not subscribed: one tap, no sign-in ═══════
{
  const { ctx, page } = await open('/homesignalmap.html?zip=97702',
    { session: { access_token: 'fake', user: { id: 'auth-user-1', email: 'resident@example.com' } },
      subscribed: false, follows: ['97702'] });
  await page.click('#zipEmailBtn');
  await page.waitForFunction(() => (document.getElementById('zipEmailBtn').textContent || '').indexOf('signed up') > -1,
    null, { timeout: 8000 }).catch(() => {});
  const F = await page.evaluate(() => window.__fake);
  ok(!F.log.some(e => e.kind === 'otp'), '3a a signed-in resident is not asked to sign in again');
  ok(F.log.filter(e => e.kind === 'rpc' && e.name === 'enable_area_email_alerts').length === 1,
    '3b one tap writes the selection once');
  ok(F.log.some(e => e.kind === 'insert' && e.table === 'app_follows'),
    '3c an already-followed ZIP is re-saved idempotently (a duplicate follow is success, not an error)');
  ok((await page.locator('#zipEmailBtn').textContent()).includes("You're signed up"), '3d and the button confirms it');
  ok(!(await page.locator('#zipEmailMsg').textContent()).trim(), '3e with no error shown');
  await ctx.close();
}

// ═══════ 4. The Place-page embed never shows it ═══════
{
  const { ctx, page } = await open('/homesignalmap.html?zip=97702&embed=1');
  ok(!(await page.locator('#zipEmailBtn').isVisible()), '4a the button is hidden inside a Place-page embed');
  await ctx.close();
}

ok(!pageErrors.length, 'no uncaught page errors', pageErrors);
await browser.close(); server.close();
console.log('========================================================================');
if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
console.log('ALL PASS');

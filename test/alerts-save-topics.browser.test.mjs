// The Alerts page's "Save alerts", signed OUT, driven in a real browser.
//
// The MAPS confirmation email links "Sign up for those alerts" to alerts.html?zip=<ZIP>. A
// resident who opens it signed out (say, on their phone) ticks a topic, presses Save, types
// their email and the 6-digit code — and the save must then FINISH, on that ZIP, without the
// page navigating away. Before the fix, Save opened the sign-in with nothing to resume: a
// verified code sent them to location.pathname, dropping ?zip= and the topics they had
// ticked, so they had to start again, possibly on a different ZIP.
//
// The Supabase client is a fake that records every call, so the test asserts WHAT was sent.
// Run: node test/alerts-save-topics.browser.test.mjs   (needs playwright; CI's browser job)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

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

const COUNTY_TOPIC = 'County Commission & county business';

// A fake supabase-js v2: a chainable query builder over a tiny store, OTP auth, and an rpc()
// that records its arguments. Every call lands in window.__fake.log, in order.
const FAKE_SUPABASE = `
(function(){
  var F = window.__fake = window.__fake || { log: [], session: null, signup: null };
  var COMMUNITIES = [
    { id: 'zip-97702', name: 'Bend (97702)', level: 'zip', zip_codes: ['97702'], parent_id: 'county-deschutes', government_topics: [] },
    { id: 'county-deschutes', name: 'Deschutes County', level: 'county', zip_codes: ['97701','97702'], parent_id: null,
      government_topics: [${JSON.stringify(COUNTY_TOPIC)}] }
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
    return [];
  }
  function builder(table) {
    var q = { table: table, filters: [], op: 'select', row: null };
    var b = {};
    ['select','order','limit','range','in','neq','gte','lte','lt','gt','is','or','not','single','maybeSingle','ilike','like','filter','textSearch']
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
      var out = q.op === 'select' ? { data: rowsFor(q), error: null } : { data: [], error: null };
      return Promise.resolve(out).then(res, rej);
    };
    return b;
  }
  var client = {
    from: function(t){ return builder(t); },
    rpc: function(name, args){
      F.log.push({ kind: 'rpc', name: name, args: args });
      if (name === 'signup_complete') { F.signup = args; return Promise.resolve({ data: 'u-row', error: null }); }
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
  if (url.includes('@supabase/supabase-js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_SUPABASE });
  if (url.includes('/rest/v1/') || url.includes('/functions/v1/')) return J([]);
  if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200,
    contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript', body: '' });
  return J({});
};

const LANDING = '/alerts.html?zip=97702';
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
await page.route('**/*', r => routeHandler(r));
await page.goto(base + LANDING, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.HS && HS.openTopics && document.querySelector('.tcat'), null, { timeout: 30000 });
await page.waitForTimeout(500);

// 1. Signed out, the Government Notices picker opens on this ZIP's own topics.
await page.locator('.tcat').first().click();
await page.waitForSelector('#topicsModal.show', { timeout: 5000 }).catch(() => {});
const chip = page.locator('#tmGrid .tchip', { hasText: COUNTY_TOPIC });
ok(await chip.count() === 1, "1a signed out, the picker lists this ZIP's county topic", await page.locator('#tmGrid').textContent());
ok((await page.locator('#tmEmail').textContent()).trim() === 'sign in to save', '1b it says "sign in to save"');
await chip.click();

// 2. Save asks for the 6-digit sign-in.
await page.getByRole('button', { name: 'Save alerts' }).click();
await page.waitForSelector('#authModal.show', { timeout: 5000 }).catch(() => {});
ok(await page.locator('#authEmail').isVisible(), '2a Save, signed out, opens the 6-digit sign-in');
// On TOP of the picker that asked for it: whatever sits at the centre of its button is the button.
const onTop = await page.evaluate(() => {
  const b = document.getElementById('authSubmitBtn').getBoundingClientRect();
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return !!hit && !!hit.closest('#authModal');
});
ok(onTop, '2a2 the sign-in is on top of the picker, so it can be clicked');
let F = await page.evaluate(() => window.__fake);
ok(!F.log.some(e => e.kind === 'rpc' && e.name === 'signup_complete'), '2b nothing is saved before the sign-in');
await page.fill('#authEmail', 'resident@example.com');
await page.click('#authSubmitBtn');
await page.waitForSelector('#authCode', { state: 'visible', timeout: 5000 });
await page.fill('#authCode', '123456');
await page.click('#authSubmitBtn');
await page.waitForFunction(() => window.__fake && window.__fake.signup, null, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1200);   // past the verify branch's 700 ms close-and-decide

// 3. The save FINISHED after the code, on 97702, with what was ticked, and the page stayed.
F = await page.evaluate(() => window.__fake);
const saves = F.log.filter(e => e.kind === 'rpc' && e.name === 'signup_complete');
ok(saves.length === 1, '3a the save resumed after the code: signup_complete called once', saves.length);
const a = F.signup || {};
ok(a.p_zip_code === '97702' && a.p_community_id === 'county-deschutes',
  "3b it saved for 97702, on the ZIP's government community (the county)", a);
ok(Array.isArray(a.p_subscriptions) && a.p_subscriptions.some(s => s.topic === COUNTY_TOPIC),
  '3c with the topic that was ticked before signing in', a.p_subscriptions);
ok(a.p_email === 'resident@example.com', '3d as the account that just signed in', a.p_email);
ok(page.url() === base + LANDING, '3e the page did NOT navigate: ?zip= is intact', page.url());
ok(await page.locator('#tmDone').isVisible()
   && /You'll be alerted about 1 government notices topic/.test(await page.locator('#tmDoneMsg').textContent()),
  '3f the picker says the alerts were saved', await page.locator('#tmDoneMsg').textContent());
ok(!(await page.locator('#authModal').isVisible()), '3g the sign-in closed itself');
const iVerify = F.log.findIndex(e => e.kind === 'verify');
const iSave = F.log.findIndex(e => e.kind === 'rpc' && e.name === 'signup_complete');
ok(iVerify > -1 && iSave > iVerify, '3h the save happened after the code was verified, never before', { iVerify, iSave });
ok(pageErrors.length === 0, '3i no page errors', pageErrors);

await ctx.close();
await browser.close();
server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);

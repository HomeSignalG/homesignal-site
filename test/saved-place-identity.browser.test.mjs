// FIX 17 — BROWSER PROOF that a saved place has ONE identity.
//
// The stub Supabase client below is backed by an in-memory app_properties that enforces
// THE SAME unique key production does:
//     user_id | fold(address) | coalesce(zip,'') | fold(coalesce(input_address, address))
// with fold mirroring public.hs_premium_fold_address (upper, drop non-alphanumerics,
// collapse whitespace). A conflict is returned as PostgREST returns it — code 23505 —
// so the client code under test meets the real failure it will meet in production.
//
// The geocode stub reproduces the MEASURED Census behaviour: it STRIPS the secondary unit
// designator (APT/UNIT/STE/#) from matchedAddress, exactly as ten live probes showed
// (350 5TH AVE APT 101 / APT 102 / UNIT 101 / #101 all return '350 5TH AVE, ...'). That is
// what makes §G a real test of the unit decision rather than a restatement of it.
//
// Run: node test/saved-place-identity.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 300)); }
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

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('cdn.jsdelivr.net')) {
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
  }
  if (url.includes('/rest/v1/') || url.includes('/auth/v1/') || url.includes('/functions/v1/')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  }
  return route.abort();
});

const STUB = `
window.__db = { properties: [], follows: [], inserts: 0, seq: 0, user: 'user-A' };
window.__fold = function (a) {
  return String(a == null ? '' : a).toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\\s+/g, ' ').trim();
};
function placeKey(r) {
  return [r.user_id, window.__fold(r.address), (r.zip == null ? '' : r.zip),
          window.__fold(r.input_address == null ? r.address : r.input_address)].join('|');
}
window.supabase = { createClient: function () {
  function table(name) {
    var filters = {}, pending = null, mode = null;
    var api = {};
    ['order','limit','in','contains','gte','lte','not','or','filter','range'].forEach(function (m) {
      api[m] = function () { return api; };
    });
    api.select = function () { return api; };
    api.eq = function (c, v) { filters[c] = v; return api; };
    api.match = function (o) { Object.keys(o).forEach(function (k) { filters[k] = o[k]; }); return api; };
    api.insert = function (row) { mode = 'insert'; pending = row; return api; };
    api.update = function (row) { mode = 'update'; pending = row; return api; };
    api.delete = function () { mode = 'delete'; return api; };
    function rows() {
      var src = name === 'app_properties' ? window.__db.properties
              : name === 'app_follows' ? window.__db.follows : [];
      return src.filter(function (r) {
        return Object.keys(filters).every(function (k) { return String(r[k]) === String(filters[k]); });
      });
    }
    function settle() {
      if (mode === 'insert' && name === 'app_properties') {
        window.__db.inserts++;
        var row = Object.assign({}, pending);
        // THE UNIQUE INDEX, enforced exactly as production enforces it.
        if (window.__db.properties.some(function (r) { return placeKey(r) === placeKey(row); })) {
          return { data: null, error: { code: '23505',
            message: 'duplicate key value violates unique constraint "app_properties_user_place_key"' } };
        }
        row.id = 'p' + (++window.__db.seq);
        row.created_at = new Date(Date.now() + window.__db.seq).toISOString();
        window.__db.properties.push(row);
        return { data: row, error: null };
      }
      if (mode === 'insert' && name === 'app_follows') {
        window.__db.follows.push(Object.assign({}, pending)); return { data: pending, error: null };
      }
      if (mode === 'delete') {
        var keep = [], gone = [];
        var src = name === 'app_properties' ? window.__db.properties : window.__db.follows;
        src.forEach(function (r) {
          (Object.keys(filters).every(function (k) { return String(r[k]) === String(filters[k]); })
            ? gone : keep).push(r);
        });
        if (name === 'app_properties') window.__db.properties = keep; else window.__db.follows = keep;
        return { data: gone, error: null };
      }
      var f = rows();
      return { data: f, error: null };
    }
    api.single = function () { var r = settle();
      if (r.error) return Promise.resolve(r);
      var d = Array.isArray(r.data) ? r.data[0] : r.data;
      return Promise.resolve({ data: d || null, error: d ? null : { code: 'PGRST116', message: 'no rows' } }); };
    api.maybeSingle = function () { var r = settle();
      var d = Array.isArray(r.data) ? r.data[0] : r.data;
      return Promise.resolve({ data: d || null, error: r.error || null }); };
    api.then = function (res) { return Promise.resolve(settle()).then(res); };
    return api;
  }
  return {
    from: table,
    rpc: function () { return Promise.resolve({ data: null, error: null }); },
    functions: { invoke: function (fnName, opts) {
      if (fnName !== 'geocode-address') return Promise.resolve({ data: null, error: null });
      var q = String((opts && opts.body && opts.body.address) || '');
      // MEASURED CENSUS BEHAVIOUR: the secondary unit designator is DROPPED.
      var street = q.split(',')[0]
        .replace(/\\s+(APT|UNIT|STE|SUITE|#)\\s*[\\w-]+\\s*$/i, '').trim().toUpperCase();
      return Promise.resolve({ data: { match: {
        matchedAddress: street + ', HORSESHOE BAY, TX, 78657',
        lat: 30.55101, lng: -98.35745, zip: '78657', city: 'HORSESHOE BAY', state: 'TX'
      } }, error: null });
    } },
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: {
        user: { id: window.__db.user, email: 'a@example.com' } } } }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    }
  };
} };`;

await page.goto(base + '/properties.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.HS && typeof window.HS.saveHome === 'function', { timeout: 20000 });
await page.waitForFunction(() => window.HS.state && window.HS.state.session, { timeout: 20000 });

// Neutralise the post-save reload so assertions can run; everything else is the real path.
await page.addInitScript(() => {});
await page.evaluate(() => { window.__reloads = 0; window.location.reload = () => { window.__reloads++; }; });

const reset = () => page.evaluate(() => {
  window.__db.properties = []; window.__db.follows = [];
  window.__db.inserts = 0; window.__db.seq = 0; window.__db.user = 'user-A';
  window.HS.state.properties = [];
});
// Drive the REAL flow: type -> confirm (findHome) -> save.
const save = (addr) => page.evaluate(async (a) => {
  document.getElementById('homeAddr').value = a;
  await window.HS.findHome();
  await window.HS.saveHome();
  return { rows: window.__db.properties.length, inserts: window.__db.inserts };
}, addr);
const count = () => page.evaluate(() => ({
  rows: window.__db.properties.length, inserts: window.__db.inserts,
  follows: window.__db.follows.length,
  addrs: window.__db.properties.map(r => r.address + '|' + (r.input_address || '')),
}));

// ───────────────────────────────── A — FIRST SAVE ──────────────────────────────────────
await reset();
await save('96 ISLAND DR, HORSESHOE BAY, TX 78657');
let s = await count();
ok(s.rows === 1, 'A first save -> exactly one saved property', s);
ok(s.addrs[0].split('|')[1] !== '', 'A the typed line is stored as input_address', s.addrs);

// ───────────────────────────── B — IDENTICAL REPEAT ────────────────────────────────────
await save('96 ISLAND DR, HORSESHOE BAY, TX 78657');
s = await count();
ok(s.rows === 1, 'B identical repeat -> still one saved property', s);
ok(s.inserts === 2, 'B the second save really did reach the database (not skipped client-side)', s);

// ─────────────────────── C — RAPID DOUBLE-CLICK ON THE REAL BUTTON ─────────────────────
await reset();
const dbl = await page.evaluate(async () => {
  document.getElementById('homeAddr').value = '96 ISLAND DR, HORSESHOE BAY, TX 78657';
  await window.HS.findHome();
  const btn = document.getElementById('homeSaveBtn');
  btn.click(); btn.click(); btn.click();      // three clicks inside the in-flight window
  const disabledAtClickTime = btn.disabled;
  await new Promise(r => setTimeout(r, 400));
  return { rows: window.__db.properties.length, inserts: window.__db.inserts, disabledAtClickTime };
});
ok(dbl.rows === 1, 'C rapid triple-click -> one saved property', dbl);
ok(dbl.inserts === 1, 'C only ONE insert left the browser — the in-flight guard held', dbl);
ok(dbl.disabledAtClickTime === true, 'C the Save button was disabled while in flight', dbl);

// ──────────────── D — PARALLEL CLIENTS (two tabs: no shared in-flight flag) ─────────────
// The guard cannot help here by construction, so this is the test that the DATABASE is
// the integrity mechanism. Both calls are issued before either resolves.
await reset();
const par = await page.evaluate(async () => {
  document.getElementById('homeAddr').value = '96 ISLAND DR, HORSESHOE BAY, TX 78657';
  await window.HS.findHome();
  const row = {
    user_id: window.HS.state.session.user.id,
    address: '96 ISLAND DR', city: 'HORSESHOE BAY', state: 'TX', zip: '78657',
    lat: 30.55101, lng: -98.35745, label: 'home',
    input_address: '96 ISLAND DR, HORSESHOE BAY, TX 78657'
  };
  const sb = window.HS.sb();
  const [a, b] = await Promise.all([
    sb.from('app_properties').insert(row).select().single(),
    sb.from('app_properties').insert(row).select().single()
  ]);
  return { rows: window.__db.properties.length, inserts: window.__db.inserts,
           codes: [a.error && a.error.code, b.error && b.error.code] };
});
ok(par.rows === 1, 'D two parallel saves of one identity -> one saved property', par);
ok(par.inserts === 2 && par.codes.filter(c => c === '23505').length === 1,
  'D both reached the database; exactly one was refused 23505', par);

// ──────────────────────────── E — TWO DIFFERENT USERS ──────────────────────────────────
await reset();
await save('96 ISLAND DR, HORSESHOE BAY, TX 78657');
await page.evaluate(() => { window.__db.user = 'user-B'; window.HS.state.session.user.id = 'user-B'; });
await save('96 ISLAND DR, HORSESHOE BAY, TX 78657');
s = await count();
ok(s.rows === 2, 'E two users saving the same physical property -> a record each', s);
await page.evaluate(() => { window.__db.user = 'user-A'; window.HS.state.session.user.id = 'user-A'; });

// ──────────────────────── F — FORMATTING VARIANT OF THE SAME TYPED LINE ────────────────
await reset();
await save('96 ISLAND DR, HORSESHOE BAY, TX 78657');
await save('96  island dr., horseshoe bay, tx 78657');
s = await count();
ok(s.rows === 1, 'F case/punctuation/whitespace variant folds to the same identity', s);

// ───────────────────── G — DISTINCT UNIT (the Fix 17 unit decision) ─────────────────────
// Census returns the SAME matchedAddress for both, so this passes ONLY because the typed
// line is part of the identity. Under a key over the Census line alone these two collapse.
await reset();
await save('96 ISLAND DR APT 101, HORSESHOE BAY, TX 78657');
await save('96 ISLAND DR APT 102, HORSESHOE BAY, TX 78657');
s = await count();
ok(s.rows === 2, 'G two legitimate units in one building -> two saved properties', s);
// Defensive: a crash here would hide every later section (an instrument must not die mid-run).
ok(s.addrs.length === 2 && s.addrs[0].split('|')[0] === s.addrs[1].split('|')[0],
  'G ...and the geocoder really did hand back one identical street line', s.addrs);
await save('96 ISLAND DR APT 101, HORSESHOE BAY, TX 78657');
s = await count();
ok(s.rows === 2, 'G re-saving unit 101 is still idempotent', s);

// ───────────────────── H — REMOVE LEAVES NO GHOST AND NO DANGLING WATCH ────────────────
await reset();
await save('96 ISLAND DR, HORSESHOE BAY, TX 78657');
const removed = await page.evaluate(async () => {
  const id = window.__db.properties[0].id;
  window.__db.follows.push({ user_id: window.HS.state.session.user.id, target_type: 'property', target_id: id });
  window.__db.follows.push({ user_id: window.HS.state.session.user.id, target_type: 'community', target_id: '78657' });
  window.__db.follows.push({ user_id: window.HS.state.session.user.id, target_type: 'project', target_id: 'proj-1' });
  const okRes = await window.HS.removeAddress(id);
  return { okRes, rows: window.__db.properties.length,
           follows: window.__db.follows.map(f => f.target_type) };
});
ok(removed.okRes === true && removed.rows === 0, 'H remove deletes the saved property', removed);
ok(!removed.follows.includes('property'), 'H the property watch goes with it — no dangling row', removed);
ok(removed.follows.includes('community') && removed.follows.includes('project'),
  'H the ZIP follow and the followed project are untouched', removed);

// ─────────────────── I/J — MY PLACES RENDERS ONE CARD; VIEWING UNCHANGED ───────────────
await reset();
await save('96 ISLAND DR, HORSESHOE BAY, TX 78657');
await save('96 ISLAND DR, HORSESHOE BAY, TX 78657');
const view = await page.evaluate(async () => {
  const before = { zip: window.HS.state.zip, myZip: localStorage.getItem('myZip') };
  window.HS.state.properties = window.__db.properties.slice();
  return { before, after: { zip: window.HS.state.zip, myZip: localStorage.getItem('myZip') },
           places: window.HS.state.properties.length };
});
ok(view.places === 1, 'I one saved-place identity -> one entry for My Places / Dashboard / Switch', view);
ok(view.before.zip === view.after.zip && view.before.myZip === view.after.myZip,
  'J saving/deduping did not move the viewed geography (Fix 6)', view);

ok(pageErrors.length === 0, 'no page errors', pageErrors);

await browser.close();
server.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);

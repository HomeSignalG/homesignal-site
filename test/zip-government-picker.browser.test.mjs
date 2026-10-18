// SEVERAL GOVERNMENTS ON ONE ZIP — the topic picker, driven in a real browser (option 3, 2026-10-18).
//
// ZIP 98466 is covered by Pierce County and, by land, University Place (63%, no source yet),
// Fircrest and Tacoma (11%). The picker must show one heading per government with its land
// share, file a Tacoma pick on TACOMA's community (delivery matches per community), keep the
// county pick on the county, and clear only Tacoma when every Tacoma topic is unticked.
// The Supabase client is a fake that records every call. Run: node test/zip-government-picker.browser.test.mjs
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


const ROOT = '00000000-0000-0000-0000-0000000000c1', TAC = '00000000-0000-0000-0000-0000000000a1';
const FAKE_SUPABASE = `
(function(){
  var F = window.__fake = window.__fake || { log: [] };
  F.session = { access_token: 'fake', user: { id: 'auth-user-1', email: 'res@example.com' } };
  var ROOT = '${ROOT}', TAC = '${TAC}';
  var COMMUNITIES = [
    { id: 'zip-98466', name: 'University Place (98466)', level: 'zip', zip_codes: ['98466'], parent_id: ROOT, government_topics: [] },
    { id: ROOT, name: 'Pierce County', level: 'county', zip_codes: ['98466'], parent_id: null,
      government_topics: ['County Commission & county business', 'Elections & voting'] }
  ];
  var BODIES = [
    { body_kind: 'county', community_id: ROOT, name: 'Pierce County', census_place_geoid: null, area_share: 0, measured: true, has_source: true, sort_key: 0 },
    { body_kind: 'city', community_id: null, name: 'University Place', census_place_geoid: '5373465', area_share: 0.6312, measured: true, has_source: false, sort_key: 1 },
    { body_kind: 'city', community_id: TAC, name: 'Tacoma', census_place_geoid: '5370000', area_share: 0.1142, measured: true, has_source: true, sort_key: 2 }
  ];
  var TOPICS = [];
  ['notices','meetings'].forEach(function(st){
    ['County Commission & county business','Elections & voting'].forEach(function(t, i){
      TOPICS.push({ community_id: ROOT, body_kind: 'county', name: 'Pierce County', stream: st, topic: t, sort_key: 0, topic_order: i + 1 });
    });
  });
  TOPICS.push({ community_id: TAC, body_kind: 'city', name: 'Tacoma', stream: 'notices', topic: 'City government (Tacoma)', sort_key: 2, topic_order: 1 });
  TOPICS.push({ community_id: TAC, body_kind: 'city', name: 'Tacoma', stream: 'meetings', topic: 'Elections & voting', sort_key: 2, topic_order: 6 });
  function rowsFor(q) {
    var t = q.table, f = q.filters;
    var eq = function(c){ var m = f.filter(function(x){ return x[0]==='eq' && x[1]===c; })[0]; return m ? m[2] : undefined; };
    if (t === 'communities') {
      var cz = f.filter(function(x){ return x[0]==='contains'; })[0];
      if (cz) return COMMUNITIES.filter(function(c){ return cz[2].every(function(z){ return c.zip_codes.indexOf(z) > -1; }); });
      var id = eq('id'); return COMMUNITIES.filter(function(c){ return c.id === id; });
    }
    if (t === 'app_community_meta') return [{ zip: '98466', name: 'University Place', state: 'WA', data_quality: 'pass' }];
    // a saved place, so a signed-in resident is not sent through onboarding
    if (t === 'app_properties') return [{ id: 'p1', user_id: 'auth-user-1', zip: '98466', label: 'Home', address: '1 Test St, University Place, WA 98466' }];
    return [];
  }
  function builder(table) {
    var q = { table: table, filters: [], op: 'select', row: null };
    var b = {};
    ['select','order','limit','range','in','neq','gte','lte','lt','gt','is','or','not','single','maybeSingle','ilike','like','filter','textSearch','overlaps']
      .forEach(function(m){ b[m] = function(){ return b; }; });
    b.eq = function(c, v){ q.filters.push(['eq', c, v]); return b; };
    b.contains = function(c, v){ q.filters.push(['contains', c, v]); return b; };
    b.match = function(o){ Object.keys(o).forEach(function(k){ q.filters.push(['eq', k, o[k]]); }); return b; };
    b.insert = function(row){ q.op = 'insert'; q.row = row; return b; };
    b.upsert = function(row){ q.op = 'upsert'; q.row = row; return b; };
    b.update = function(row){ q.op = 'update'; q.row = row; return b; };
    b.delete = function(){ q.op = 'delete'; return b; };
    b.then = function(res, rej){
      var out = q.op === 'select' ? { data: rowsFor(q), error: null } : { data: [], error: null };
      return Promise.resolve(out).then(res, rej);
    };
    return b;
  }
  var client = {
    from: function(t){ return builder(t); },
    rpc: function(name, args){
      F.log.push({ kind: 'rpc', name: name, args: args });
      if (name === 'zip_government_bodies') return Promise.resolve({ data: BODIES, error: null });
      if (name === 'zip_government_topics') return Promise.resolve({ data: TOPICS, error: null });
      if (name === 'signup_complete') return Promise.resolve({ data: 'u-row', error: null });
      if (name === 'clear_alert_selection') return Promise.resolve({ data: 1, error: null });
      return Promise.resolve({ data: [], error: null });
    },
    functions: { invoke: function(){ return Promise.resolve({ data: null, error: null }); } },
    auth: {
      getSession: function(){ return Promise.resolve({ data: { session: F.session } }); },
      getUser: function(){ return Promise.resolve({ data: { user: F.session && F.session.user } }); },
      onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
      signInWithOtp: function(){ return Promise.resolve({ data: {}, error: null }); },
      verifyOtp: function(){ return Promise.resolve({ data: { session: F.session, user: F.session.user }, error: null }); },
      signOut: function(){ return Promise.resolve({ error: null }); }
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

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
await page.route('**/*', r => routeHandler(r));
await page.goto(base + '/alerts.html?zip=98466', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.HS && HS.openTopics && document.querySelector('.tcat'), null, { timeout: 30000 });
await page.waitForTimeout(500);
const saves = async () => (await page.evaluate(() => window.__fake.log)).filter(e => e.kind === 'rpc' && (e.name === 'signup_complete' || e.name === 'clear_alert_selection'));

// 1. Upcoming Meetings picker: one heading per government, with land share.
await page.evaluate(() => HS.openTopics('meetings'));
await page.waitForSelector('#topicsModal.show', { timeout: 5000 }).catch(() => {});
const heads = await page.locator('#tmGrid .tgov b').allTextContents();
ok(JSON.stringify(heads) === JSON.stringify(['Pierce County', 'University Place', 'Tacoma']), '1a one heading per government, county first', heads);
const notes = await page.locator('#tmGrid .tgov span').allTextContents();
ok(/63% of this ZIP's land/.test(notes[1]) && /not reading this city's meetings yet/.test(notes[1]), '1b University Place: its land share and an honest "not reading yet"', notes);
ok(/11% of this ZIP's land/.test(notes[2]), '1c Tacoma: its land share', notes);
ok(await page.locator('#tmGrid .tchip').count() === 3, '1d chips: 2 county + 1 Tacoma, none for University Place');

// 2. Tick the county's "Elections & voting" and Tacoma's "Elections & voting", save.
await page.locator('#tmGrid .tchip[data-key="Elections & voting"]').click();
await page.locator(`#tmGrid .tchip[data-key="${TAC}|Elections & voting"]`).click();
await page.getByRole('button', { name: 'Save alerts' }).click();
await page.waitForTimeout(1200);
let S = await saves();
const toRoot = S.filter(e => e.name === 'signup_complete' && e.args.p_community_id === ROOT);
const toTac = S.filter(e => e.name === 'signup_complete' && e.args.p_community_id === TAC);
ok(toRoot.length === 1 && JSON.stringify(toRoot[0].args.p_topics.meetings) === '["Elections & voting"]', '2a the county pick is filed on Pierce County', toRoot.map(e => e.args.p_topics));
ok(toTac.length === 1 && JSON.stringify(toTac[0].args.p_topics) === '{"notices":[],"meetings":["Elections & voting"]}', "2b the Tacoma pick is filed on Tacoma's own community", toTac.map(e => e.args.p_topics));
ok(toTac.length === 1 && toTac[0].args.p_zip_code === '98466', '2c on this ZIP');

// 3. Reopen, untick the Tacoma topic, save: only Tacoma is cleared, the county is saved as before.
await page.evaluate(() => HS.openTopics('meetings'));
await page.waitForTimeout(300);
ok(await page.locator(`#tmGrid .tchip.on[data-key="${TAC}|Elections & voting"]`).count() === 1, '3a the Tacoma pick shows as picked under Tacoma');
await page.locator(`#tmGrid .tchip[data-key="${TAC}|Elections & voting"]`).click();
const before = (await saves()).length;
await page.getByRole('button', { name: 'Save alerts' }).click();
await page.waitForTimeout(1200);
S = (await saves()).slice(before);
ok(S.some(e => e.name === 'clear_alert_selection' && e.args.p_community_id === TAC), '3b Tacoma is cleared', S);
ok(!S.some(e => e.name === 'clear_alert_selection' && e.args.p_community_id === ROOT), '3c the county is never cleared');
ok(S.some(e => e.name === 'signup_complete' && e.args.p_community_id === ROOT), '3d the county pick is saved again');
ok(pageErrors.length === 0, '4 no page errors', pageErrors);

await ctx.close();
await browser.close();
server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);

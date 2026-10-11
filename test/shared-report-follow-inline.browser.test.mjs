// "Follow this property" on a client's shared report, INLINE, in Chromium. The report page (shared-report.html) has no sign-in and no follow
// code of its own: a click opens follow-embed.html in a same-origin frame, which runs HomeSignal's OWN sign-in and add-an-address steps
// (shell.js HS.openHome -> HS.saveHome -> savePlaceRow) and reports only a status. This proves: nothing opens or loads before the click; the
// report stays readable; the address step is one line with Confirm / Change; top and bottom buttons share ONE state and path; the follow is
// one app_properties row for the visitor with nothing from the brokerage/agent/client; the report is not re-fetched (no regeneration, no
// credit); a repeat follow is the idempotent "existing" result; and the page believes only its own frame.
// The Supabase client is a fake that records every call.   Run: node test/shared-report-follow-inline.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { RICH, RIGHTS_AB, wire } from './lib/da-report-view-world.mjs';

const VH = await import('../supabase/functions/view-shared-report/handler.ts');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 600)); } };

const VIEW_FN = 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/view-shared-report';
const LIVE = 'L'.repeat(42) + '1', RID = 'c0000000-0000-4000-8000-000000000001';
const ADDRESS = '742 Evergreen Terrace, Springfield, OR 97477';
const BROKERAGE = 'Acme Realty';
const stored = (await wire(RICH, { view: 'customer', rights: RIGHTS_AB })).report;
let viewCalls = 0;
const handler = VH.makeHandler({
  openShared: async (t) => { viewCalls++; return t === LIVE ? { report_id: RID, generated_at: '2026-10-03T12:00:00+00:00', body: JSON.stringify(stored), private_context_id: 'ctx', brokerage_name: BROKERAGE } : null; },
  addressOf: async () => ADDRESS, linkKey: async () => 'a'.repeat(64), clientKey: async () => 'b'.repeat(64), viewClaim: async () => ({ allowed: true }),
});

const FAKE = `
(function(){
  var F = window.__fake = { log: [], session: null };
  try { var s = localStorage.getItem('fakeSignedIn'); if (s) F.session = { access_token: 'fake', user: { id: 'visitor-1', email: s } }; } catch (e) {}
  var STORE = 'fakeProps';
  function props(){ try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (e) { return []; } }
  function save(p){ localStorage.setItem(STORE, JSON.stringify(p)); }
  var COMM = [{ id: 'zip-97477', name: 'Springfield (97477)', level: 'zip', zip_codes: ['97477'], parent_id: null, government_topics: [] }];
  function builder(table){
    var q = { table: table, filters: [], op: 'select', row: null, one: false }, b = {};
    ['select','order','limit','range','in','neq','gte','lte','lt','gt','is','or','not','ilike','like','filter','textSearch'].forEach(function(m){ b[m] = function(){ return b; }; });
    b.eq = function(c, v){ q.filters.push([c, v]); return b; };
    b.contains = function(){ return b; };
    b.single = function(){ q.one = true; return b; };
    b.maybeSingle = function(){ q.one = true; return b; };
    b.insert = function(r){ q.op = 'insert'; q.row = r; return b; };
    b.update = function(r){ q.op = 'update'; q.row = r; return b; };
    b.upsert = function(r){ q.op = 'upsert'; q.row = r; return b; };
    b.delete = function(){ q.op = 'delete'; return b; };
    b.then = function(res, rej){
      F.log.push({ kind: q.op, table: table, row: q.row });
      var out = { data: q.one ? null : [], error: null };
      if (table === 'app_properties') {
        var p = props();
        if (q.op === 'insert') {
          if (p.some(function(x){ return x.user_id === q.row.user_id && x.address === q.row.address; })) out = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "app_properties_user_place_key"' } };
          else { var row = Object.assign({ id: 'prop-' + (p.length + 1) }, q.row); p.push(row); save(p); out = { data: row, error: null }; }
        } else if (q.op === 'select') {
          var m = p.filter(function(x){ return q.filters.every(function(f){ return x[f[0]] === f[1]; }); });
          out = { data: q.one ? (m[0] || null) : m, error: null };
        }
      } else if (table === 'communities' && q.op === 'select') out = { data: q.one ? COMM[0] : COMM, error: null };
      return Promise.resolve(out).then(res, rej);
    };
    return b;
  }
  var client = {
    from: builder,
    rpc: function(name, args){ F.log.push({ kind: 'rpc', name: name, args: args }); return Promise.resolve({ data: [], error: null }); },
    functions: { invoke: function(name, o){
      F.log.push({ kind: 'fn', name: name });
      if (name === 'geocode-address') return Promise.resolve({ data: { match: { matchedAddress: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', lat: 44.05, lng: -123.02, zip: '97477', city: 'SPRINGFIELD', state: 'OR' } }, error: null });
      return Promise.resolve({ data: null, error: null }); } },
    auth: {
      getSession: function(){ return Promise.resolve({ data: { session: F.session } }); },
      getUser: function(){ return Promise.resolve({ data: { user: F.session && F.session.user } }); },
      onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
      signInWithOtp: function(o){ F.log.push({ kind: 'otp' }); return Promise.resolve({ data: {}, error: null }); },
      verifyOtp: function(o){ F.log.push({ kind: 'verify' }); F.session = { access_token: 'fake', user: { id: 'visitor-1', email: o.email } }; return Promise.resolve({ data: { session: F.session, user: F.session.user }, error: null }); },
      signOut: function(){ F.session = null; return Promise.resolve({ error: null }); }
    }
  };
  window.supabase = { createClient: function(){ return client; } };
})();`;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(await readFile(p)); } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();

async function open({ signedIn = false, props = null, width = 1280 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript(([s, pr]) => { try { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); if (s) localStorage.setItem('fakeSignedIn', s); if (pr) localStorage.setItem('fakeProps', pr); } } catch (e) {} }, [signedIn ? 'visitor@example.com' : '', props]);
  const page = await ctx.newPage();
  const errors = [], requested = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('request', (r) => requested.push(r.url()));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('@supabase/supabase-js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE });
    if (url === VIEW_FN) {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
      const res = await handler(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: route.request().postData() }));
      return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    }
    if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto(base + '/shared-report.html#share=' + LIVE, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.getAttribute('data-state') === 'report', null, { timeout: 8000 });
  return { ctx, page, errors, requested };
}
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
const frameOf = async (page) => { const h = await page.waitForSelector('#followPanel iframe', { timeout: 8000 }); return h.contentFrame(); };
const fake = (fr) => fr.evaluate(() => window.__fake);

// ---- 1. before any click -----------------------------------------------------------------------------------------------------------------------
{
  const { ctx, page, errors, requested } = await open();
  ok((await page.$$('iframe')).length === 0 && !requested.some((u) => u.includes('follow-embed')), '1a nothing loads while the report is read: no frame, no request for the follow page');
  ok(!(await vis(page, '#followPanel')) && !(await vis(page, '#authModal')), '1b no panel, no pop-up, no sign-in prompt on page load');
  ok(await vis(page, '.da-rv-addr') && await vis(page, '#follow') && await vis(page, '#follow2'), '1c the report is fully readable and both Follow buttons are there');

  // ---- 2. signed out: click the TOP button ---------------------------------------------------------------------------------------------------
  await page.click('#follow');
  const fr = await frameOf(page);
  const src = await page.$eval('#followPanel iframe', (i) => i.getAttribute('src'));
  ok(src === 'follow-embed.html#address=' + encodeURIComponent(ADDRESS), '2a the click opens one frame on the same-origin follow page, the address in the fragment only', src);
  ok((await page.$$('#followPanel iframe')).length === 1 && await page.evaluate(() => document.getElementById('followTop').contains(document.getElementById('followPanel'))), '2b the panel opens right under the top button, in the page');
  await fr.waitForSelector('#authModal.show #authEmail', { timeout: 8000 });
  ok(await vis(page, '.da-rv-addr') && await vis(page, '.da-rv-table'), '2c the report stays on the page and readable behind the open panel');
  const pos = await fr.evaluate(() => getComputedStyle(document.querySelector('#authModal')).position);
  ok(pos === 'static', '2d the sign-in sits inline in the page (not a fixed pop-up)', pos);
  await fr.fill('#authEmail', 'visitor@example.com'); await fr.click('#authSubmitBtn');
  await fr.waitForSelector('#authCode', { state: 'visible', timeout: 5000 });
  await fr.fill('#authCode', '123456'); await fr.click('#authSubmitBtn');

  // ---- 3. the address step is ONE line with Confirm / Change ---------------------------------------------------------------------------------
  await fr.waitForSelector('#homeConfirm:not(.hidden)', { timeout: 10000 });
  const conf = await fr.evaluate(() => ({
    line: document.getElementById('homeMatched').textContent,
    save: document.getElementById('homeSaveBtn').textContent.trim(),
    back: document.querySelector('#homeConfirm button.mbtn:not(#homeSaveBtn)').textContent.trim(),
    head: !!document.querySelector('#homeModal .mhead') && getComputedStyle(document.querySelector('#homeModal .mhead')).display !== 'none',
    h: document.getElementById('homeConfirm').getBoundingClientRect().height,
  }));
  ok(conf.line === '742 EVERGREEN TER, SPRINGFIELD, OR, 97477' && conf.save === 'Confirm' && conf.back === 'Change', '3a the resolved property is shown once with Confirm / Change', conf);
  ok(!conf.head && conf.h < 130, '3b it is a compact line, not a second form (no extra heading, short block)', conf);
  await fr.click('#homeConfirm button.mbtn:not(#homeSaveBtn)');
  ok(await fr.evaluate(() => document.getElementById('homeAddr').value) === ADDRESS, '3c Change returns to the address, pre-filled, not blank');
  await fr.click('#homeForm button.mbtn'); await fr.waitForSelector('#homeConfirm:not(.hidden)');

  // ---- 4. Confirm: one follow, both buttons flip, nothing re-fetched -------------------------------------------------------------------------
  const viewBefore = viewCalls, urlBefore = page.url();
  await fr.click('#homeSaveBtn');
  await page.waitForFunction(() => document.getElementById('follow').classList.contains('done'), null, { timeout: 10000 });
  const t1 = await page.$eval('#follow', (a) => a.textContent.trim()), t2 = await page.$eval('#follow2', (a) => a.textContent.trim());
  ok(t1 === 'Following this property ✓' && t2 === 'Following this property ✓', '4a both the top and bottom buttons now read "Following this property"', [t1, t2]);
  ok((await page.$$('#followPanel iframe')).length === 0 && !(await vis(page, '#followPanel')), '4b the panel closes and the frame is gone');
  ok(viewCalls === viewBefore && page.url() === urlBefore, '4c the report was not fetched again and the page did not navigate (no regeneration, no credit)');
  ok(await page.$eval('#followStatus', (e) => e.textContent) === 'Following this property.', '4d the state is announced to assistive technology');
  const dbg = await page.evaluate(() => JSON.parse(localStorage.getItem('fakeProps') || '[]'));
  ok(dbg.length === 1 && dbg[0].user_id === 'visitor-1' && dbg[0].zip === '97477' && dbg[0].label === 'home', '4e exactly one app_properties row, the visitor\'s own', dbg);
  const blob = JSON.stringify(dbg) + JSON.stringify(await page.evaluate(() => null));
  ok(!blob.includes(BROKERAGE) && !blob.includes(LIVE) && !blob.includes(RID), '4f nothing from the brokerage, the link or the report went into the follow', Object.keys(dbg[0] || {}));
  ok(errors.length === 0, '4g no page errors', errors);
  await ctx.close();
}

// ---- 5. signed in, BOTTOM button, same path and the idempotent repeat ----------------------------------------------------------------------------
{
  const { ctx, page, errors } = await open({ signedIn: true });
  await page.click('#follow2');
  const fr = await frameOf(page);
  ok(await page.evaluate(() => document.getElementById('followBottom').contains(document.getElementById('followPanel'))), '5a the bottom button opens the SAME panel, under itself');
  await fr.waitForSelector('#homeConfirm:not(.hidden)', { timeout: 10000 });
  ok(!(await fr.evaluate(() => document.getElementById('authModal').classList.contains('show'))), '5b already signed in: straight to the one-line confirmation, no sign-in again');
  await page.evaluate(() => window.postMessage({ hsFollow: true, type: 'following' }, '*'));
  await page.waitForTimeout(150);
  ok(!(await page.$eval('#follow', (a) => a.classList.contains('done'))), '5c a message that does not come from the page\'s own frame is ignored');
  await fr.click('#homeSaveBtn');
  await page.waitForFunction(() => document.getElementById('follow').classList.contains('done'), null, { timeout: 10000 });
  ok(await page.$eval('#follow', (a) => a.textContent.trim()) === 'Following this property ✓', '5d confirming from the bottom flips the top button too: one shared state');
  const props = await page.evaluate(() => localStorage.getItem('fakeProps'));
  await ctx.close();

  // a second visit by someone who already follows it: the same writer reports the existing row
  const again = await open({ signedIn: true, props });
  await again.page.click('#follow');
  const f2 = await frameOf(again.page);
  await f2.waitForSelector('#homeConfirm:not(.hidden)', { timeout: 10000 });
  await f2.click('#homeSaveBtn');
  await again.page.waitForFunction(() => document.getElementById('follow').classList.contains('done'), null, { timeout: 10000 });
  const rows = await again.page.evaluate(() => JSON.parse(localStorage.getItem('fakeProps')));
  ok(rows.length === 1, '5e following again is idempotent: still one row, and the button still ends at "Following this property"', rows.length);
  ok(errors.length === 0 && again.errors.length === 0, '5f no page errors', [errors, again.errors]);
  await again.ctx.close();
}

// ---- 6. Close, and a phone ----------------------------------------------------------------------------------------------------------------------
{
  const { ctx, page } = await open({ width: 390 });
  await page.click('#follow');
  await frameOf(page);
  await page.click('#followClose');
  ok((await page.$$('#followPanel iframe')).length === 0 && !(await vis(page, '#followPanel')) && await vis(page, '.da-rv-addr'), '6a Close removes the frame and leaves the report as it was');
  await page.click('#follow');
  await frameOf(page);
  const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, pw: document.getElementById('followPanel').getBoundingClientRect().width }));
  ok(m.over <= 0 && m.pw <= 390, '6b on a phone the open panel fits the screen with no sideways scroll', m);
  await ctx.close();
}

await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);

// FOUNDER NAVIGATION PLAN v3 (2026-09-30) — the rendered proof, signed in.
// Run: node test/navigation-v3.browser.test.mjs
//
// The offline suites (nav-identity, landing, public-zip-contract, navigation-place-identity)
// read the markup. This one reads what a browser does with it, in the one state the plan
// changes most: a REAL signed-in resident with a saved Address. Under #281 that resident was
// bounced from index.html to dashboard.html, so no browser test had ever seen them on
// Explore. It proves:
//   1. the logo and Explore lead to index.html, and a signed-in resident with a saved
//      Address STAYS there (no dashboard bounce), with Explore lit;
//   2. the homepage preview reads the sample ZIP its caption names, never the resident's;
//   3. every page lights the item of the section it belongs to (the v3 matrix);
//   4. My Places shows "What's Changed" and "Alert Settings" above the place list;
//   5. the five support links sit in the sidebar footer, in order, without overflow at
//      1280px and at 390px;
//   6. privacy.html#terms lands on the Terms heading even though the page body is injected
//      after load, and tapping Terms from the open phone drawer on privacy.html closes it;
//   7. Enterprise is linked but still noindex.
//
// NO NETWORK. The supabase-js CDN request is fulfilled locally with a stub whose session is
// real (not demo) and whose app_properties read returns one saved Address. Every other read
// resolves empty. Each table read is recorded, so the preview's ZIP is asserted from the
// query the page actually made rather than from what it rendered.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP navigation-v3.browser.test.mjs — playwright not installed');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (d !== undefined) console.log('           detail: ' + JSON.stringify(d).slice(0, 400)); }
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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const UID = 'nav-v3-test-user';
// The saved Address deliberately sits OUTSIDE the sample ZIP (78617), so a preview built
// from the resident's own area would query a different ZIP and §2 would see it.
const SAVED = { id: 'nav-v3-prop', user_id: UID, address: '20 N MAIN ST', zip: '84302',
                lat: 41.5102, lng: -112.0155, created_at: '2026-09-01T00:00:00Z' };

const STUB = `
window.__navCalls = [];
window.supabase = { createClient: function () {
  function table(name) {
    var call = { table: name, eq: [] };
    window.__navCalls.push(call);
    var api = {};
    ['select','insert','update','upsert','delete','neq','in','is','or','not','gt','gte',
     'lt','lte','like','ilike','contains','overlaps','order','limit','range','filter','match']
      .forEach(function (m) { api[m] = function () { return api; }; });
    api.eq = function (col, val) { call.eq.push([col, val]); return api; };
    var rows = name === 'app_properties' ? [${JSON.stringify(SAVED)}] : [];
    var settled = { data: rows, error: null };
    api.single = function () { return Promise.resolve({ data: null, error: { code: 'PGRST116' } }); };
    api.maybeSingle = function () { return Promise.resolve({ data: null, error: null }); };
    api.then = function (res, rej) { return Promise.resolve(settled).then(res, rej); };
    return api;
  }
  return {
    from: table,
    rpc: function () { return Promise.resolve({ data: null, error: null }); },
    functions: { invoke: function () { return Promise.resolve({ data: null, error: null }); } },
    auth: {
      getSession: function () {
        return Promise.resolve({ data: { session: { user: { id: '${UID}', email: 'nav@example.com' } } } });
      },
      signOut: function () { return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    }
  };
} };`;

const browser = await chromium.launch();

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  // hs:accountUid must equal the stub's user id: ensureAccountScope() clears every
  // account-scoped key on an account CHANGE and would otherwise wipe the fixture.
  await page.addInitScript((uid) => {
    try {
      localStorage.setItem('hs:accountUid', JSON.stringify(uid));
      localStorage.setItem('hs:myCommunities', JSON.stringify([{ zip: '84302', name: 'Brigham City', state: 'UT' }]));
    } catch (e) { /* a blocked context fails the assertions loudly, not here */ }
  }, UID);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('cdn.jsdelivr.net') && /supabase/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
    }
    // Map libraries and anything else: answered empty, never fetched. The nav matrix only
    // reads the shell, which does not depend on them.
    if (url.includes('cdn.jsdelivr.net')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    }
    return route.abort();
  });
  return { ctx, page, errors };
}

const waitReady = (page) => page.waitForFunction(() => window.HS && window.HS.ready, null, { timeout: 30000 })
  .then(() => page.evaluate(() => window.HS.ready));

const chrome = (page) => page.evaluate(() => {
  const links = [...document.querySelectorAll('#hs-nav a')];
  return {
    path: location.pathname,
    tokens: links.map((a) => a.getAttribute('data-nav')),
    hrefs: links.map((a) => a.getAttribute('href')),
    labels: links.map((a) => a.textContent.replace(/\s+/g, ' ').trim()),
    lit: links.filter((a) => a.classList.contains('on')).map((a) => a.getAttribute('data-nav')),
    logo: (document.querySelector('#hs-side .logo') || {}).getAttribute
      ? document.querySelector('#hs-side .logo').getAttribute('href') : null,
    session: !!(window.HS.state.session && !window.HS.state.session.demo),
    active: window.HS.state.activeProperty ? window.HS.state.activeProperty.id : null
  };
});

// A redirect fired after load destroys the execution context mid-read. Retrying after the
// next load turns that into an ordinary FAIL naming the page the resident landed on, instead
// of a crash that hides every later section.
async function settledChrome(page) {
  for (let i = 0; i < 4; i++) {
    try {
      await page.waitForTimeout(400);
      await page.waitForLoadState('domcontentloaded');
      await waitReady(page);
      return await chrome(page);
    } catch (e) {
      if (!/context was destroyed|navigation/i.test(String(e))) throw e;
    }
  }
  return chrome(page);
}

const D = await newPage({ width: 1280, height: 900 });

// ═══ 1. Signed in with a saved Address, index.html stays Explore ═══
console.log('--- 1. index.html keeps a signed-in resident on Explore ---');
await D.page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
let c = await settledChrome(D.page);   // any location.replace would have fired by now
ok(c.session, '1 the stub session is a real, signed-in session (positive control)', c);
ok(c.active === SAVED.id, '1 ...with the saved Address as the active property (positive control)', c.active);
ok(c.path === '/index.html', '1 the resident STAYS on index.html — no dashboard bounce (plan v3)', c.path);
ok(c.tokens.join('|') === 'explore|props|enterprise', '1 the sidebar is Explore, My Places, Enterprise', c.tokens);
ok(c.labels.join('|') === '◈ Explore|⌂ My Places|▦ Enterprise', '1 ...with those labels', c.labels);
ok(JSON.stringify(c.hrefs) === JSON.stringify(['index.html', 'properties.html', 'development-activity.html']),
  '1 ...and plain section hrefs (none ZIP-stamped)', c.hrefs);
ok(c.logo === 'index.html', '1 the logo leads to index.html', c.logo);
ok(JSON.stringify(c.lit) === JSON.stringify(['explore']), '1 Explore is the one lit item', c.lit);

// ═══ 2. The preview reads the sample ZIP its caption names ═══
console.log('--- 2. the homepage preview is the Del Valle sample ---');
const changeReads = await D.page.evaluate(() => (window.__navCalls || [])
  .filter((x) => x.table === 'app_changes')
  .map((x) => (x.eq.find((e) => e[0] === 'zip') || [null, null])[1]));
const sampleZip = await D.page.evaluate(() => window.HS_CONFIG.DEFAULT_ZIP);
ok(sampleZip === '78617', '2 the sample ZIP is 78617 (positive control)', sampleZip);
ok(changeReads.length > 0, '2 the homepage made at least one app_changes read (the instrument ran)', changeReads);
ok(changeReads.every((z) => z === sampleZip),
  '2 every app_changes read is for the sample ZIP, never the resident’s ' + SAVED.zip, changeReads);
ok(!changeReads.includes(SAVED.zip), '2 ...the saved Address ZIP was not queried for the preview', changeReads);

// The logo click from another page lands back on Explore, and stays.
await D.page.goto(base + '/properties.html', { waitUntil: 'domcontentloaded' });
await waitReady(D.page);
await Promise.all([
  D.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
  D.page.click('#hs-side .logo')
]);
c = await settledChrome(D.page);
ok(c.path === '/index.html' && JSON.stringify(c.lit) === JSON.stringify(['explore']),
  '2 clicking the logo from My Places lands on Explore and stays there', c);

// ═══ 3. The active-item matrix ═══
console.log('--- 3. every page lights the section it belongs to ---');
const MATRIX = [
  ['/index.html', ['explore']],
  ['/community.html?zip=78617', ['explore']],
  ['/homesignalmap.html?zip=78617', ['explore']],
  ['/development.html?zip=78617', ['explore']],
  ['/properties.html', ['props']],
  ['/dashboard.html', ['props']],
  ['/alerts.html?zip=78617', ['props']],
  ['/reports.html', ['props']],
  ['/property.html?id=' + SAVED.id, ['props']],
  ['/development-activity.html', ['enterprise']],
  ['/how-it-works.html', []],
  ['/about.html', []],
  ['/contact.html', []],
  ['/privacy.html', []]
];
for (const [path, want] of MATRIX) {
  await D.page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await D.page.waitForFunction(() => !!document.querySelector('#hs-nav a'), null, { timeout: 30000 });
  const got = await chrome(D.page);
  ok(got.tokens.join('|') === 'explore|props|enterprise' && JSON.stringify(got.lit) === JSON.stringify(want),
    '3 ' + path + ' lights ' + (want.length ? want.join(',') : 'nothing'), { lit: got.lit, tokens: got.tokens });
}

// ═══ 4. My Places carries What's Changed and Alert Settings ═══
console.log('--- 4. My Places secondary row ---');
await D.page.goto(base + '/properties.html', { waitUntil: 'domcontentloaded' });
await waitReady(D.page);
const row = await D.page.evaluate(() => {
  const r = document.getElementById('plSecondary');
  const grid = document.getElementById('propGrid');
  const strip = document.getElementById('propStrip');
  const links = r ? [...r.querySelectorAll('a')] : [];
  const vis = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
  return {
    exists: !!r, visible: vis(r),
    labels: links.map((a) => a.textContent.replace(/\s+/g, ' ').trim()),
    hrefs: links.map((a) => a.getAttribute('href')),
    beforeGrid: !!(r && grid && (r.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING)),
    beforeStrip: !!(r && strip && (r.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING)),
    inSlot: !!(r && r.closest('#hs-slot'))
  };
});
ok(row.exists && row.visible && row.inSlot, '4 the secondary row renders inside the page', row);
ok(row.labels.join('|') === "What's Changed →|Alert Settings →", "4 ...labelled What's Changed and Alert Settings", row.labels);
ok(JSON.stringify(row.hrefs) === JSON.stringify(['dashboard.html', 'alerts.html']), '4 ...linking the Dashboard and Alerts pages', row.hrefs);
ok(row.beforeStrip && row.beforeGrid, '4 ...above the place summary and the place list', row);

// ═══ 5. The support footer ═══
console.log('--- 5. support links in the sidebar footer ---');
const readFooter = (page) => page.evaluate(() => {
  const side = document.getElementById('hs-side');
  const links = [...side.querySelectorAll('.sidefoot a')];
  const sb = side.getBoundingClientRect();
  return {
    labels: links.map((a) => a.textContent.trim()),
    hrefs: links.map((a) => a.getAttribute('href')),
    lit: links.filter((a) => a.hasAttribute('data-nav') || a.classList.contains('on')).length,
    inNav: side.querySelectorAll('nav .sidefoot, .sidefoot nav').length,
    rows: [...side.querySelectorAll('.sidefoot')].map((f) => {
      const ls = [...f.querySelectorAll('a')].map((a) => a.getBoundingClientRect());
      return { lines: new Set(ls.map((r) => Math.round(r.top))).size };
    }),
    overflowX: side.scrollWidth > side.clientWidth + 1,
    outside: links.filter((a) => { const r = a.getBoundingClientRect(); return r.left < sb.left - 0.5 || r.right > sb.right + 0.5; })
      .map((a) => a.textContent.trim()),
    linkHeights: links.map((a) => Math.round(a.getBoundingClientRect().height))
  };
});
const EXPECT_LABELS = ['How It Works', 'About', 'Contact', 'Privacy', 'Terms'];
const EXPECT_HREFS = ['how-it-works.html', 'about.html', 'contact.html', 'privacy.html', 'privacy.html#terms'];
await D.page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
await waitReady(D.page);
let f = await readFooter(D.page);
ok(JSON.stringify(f.labels) === JSON.stringify(EXPECT_LABELS), '5 1280px: five support links, in order', f.labels);
ok(JSON.stringify(f.hrefs) === JSON.stringify(EXPECT_HREFS), '5 1280px: ...to the five support pages (Terms is privacy.html#terms)', f.hrefs);
ok(f.lit === 0 && f.inNav === 0, '5 1280px: support links carry no data-nav and sit outside the primary <nav>', f);
ok(!f.overflowX && f.outside.length === 0, '5 1280px: nothing overflows the sidebar', f);
ok(f.rows.every((r) => r.lines === 1), '5 1280px: each footer row is one line', f.rows);
ok(Math.max(...f.linkHeights) <= Math.min(...f.linkHeights) + 1, '5 1280px: no single link wraps', f.linkHeights);

const M = await newPage({ width: 390, height: 844 });
await M.page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
await waitReady(M.page);
// The sidebar is off-canvas below 900px; open it the way the menu button does.
await M.page.evaluate(() => document.getElementById('hs-side').classList.add('open'));
await M.page.waitForTimeout(350);
f = await readFooter(M.page);
const pageOverflow = await M.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
ok(JSON.stringify(f.labels) === JSON.stringify(EXPECT_LABELS), '5 390px: the same five links, in order', f.labels);
ok(!f.overflowX && f.outside.length === 0, '5 390px: nothing overflows the open sidebar', f);
ok(f.rows.every((r) => r.lines === 1), '5 390px: each footer row is one line', f.rows);
ok(!pageOverflow, '5 390px: the page does not scroll sideways');

// ═══ 6. privacy.html#terms lands on Terms ═══
console.log('--- 6. Terms anchor ---');
const terms = async (page) => {
  await page.goto(base + '/privacy.html#terms', { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const h = document.getElementById('terms');
    const r = h ? h.getBoundingClientRect() : null;
    return { exists: !!h, text: h ? h.textContent.trim() : null, top: r ? Math.round(r.top) : null,
             vh: window.innerHeight, scrollY: Math.round(window.scrollY) };
  });
};
let t = await terms(D.page);
ok(t.exists && t.text === 'Terms of Use', '6 privacy.html has the Terms of Use heading (positive control)', t);
ok(t.scrollY > 0 && t.top >= 0 && t.top < t.vh, '6 1280px: #terms opens scrolled to the Terms heading', t);
t = await terms(M.page);
ok(t.top >= 0 && t.top < t.vh && t.scrollY > 0, '6 390px: ...and on a phone', t);

// On privacy.html the Terms link stays on the same document, so no page load closes the
// phone drawer. Tap it from the open drawer, both from the top of the page and when the URL
// already ends in #terms (no hashchange fires then), and the drawer must close on Terms.
// about:blank first: going to privacy.html#terms from privacy.html#terms is a jump within
// the page, not a load, so the previous case's drawer state would carry over.
const termsFromDrawer = async (page, start) => {
  await page.goto('about:blank');
  await page.goto(base + start, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => window.HS.toggleMenu());
  await page.waitForTimeout(350);
  const before = await page.evaluate(() => document.getElementById('hs-side').classList.contains('open'));
  let clickError = null;
  try {
    await page.click('#hs-side .sidefoot a[href="privacy.html#terms"]', { timeout: 5000 });
  } catch (e) { clickError = String(e).split('\n')[0]; }
  await page.waitForTimeout(400);
  return page.evaluate(([b, ce]) => {
    const h = document.getElementById('terms');
    const r = h.getBoundingClientRect();
    return { openBefore: b, clickError: ce, sideOpen: document.getElementById('hs-side').classList.contains('open'),
             backdrop: document.getElementById('sidebackdrop').classList.contains('show'),
             hash: location.hash, path: location.pathname, top: Math.round(r.top), vh: window.innerHeight };
  }, [before, clickError]);
};
for (const start of ['/privacy.html', '/privacy.html#terms']) {
  const d = await termsFromDrawer(M.page, start);
  ok(d.openBefore && !d.clickError, '6 390px ' + start + ': the drawer was open and Terms was tapped (positive control)', d);
  ok(!d.sideOpen && !d.backdrop, '6 390px ' + start + ': tapping Terms closes the drawer', d);
  ok(d.path === '/privacy.html' && d.hash === '#terms' && d.top >= 0 && d.top < d.vh,
    '6 390px ' + start + ': ...and shows the Terms heading', d);
}

// ═══ 7. Enterprise is linked, still noindex ═══
console.log('--- 7. Enterprise stays noindex ---');
await D.page.goto(base + '/development-activity.html', { waitUntil: 'domcontentloaded' });
await waitReady(D.page);
const ent = await D.page.evaluate(() => ({
  robots: (document.querySelector('meta[name="robots"]') || {}).content || '',
  lit: [...document.querySelectorAll('#hs-nav a.on')].map((a) => a.getAttribute('data-nav'))
}));
ok(/noindex/.test(ent.robots), '7 development-activity.html is still noindex', ent.robots);
ok(JSON.stringify(ent.lit) === JSON.stringify(['enterprise']), '7 ...and lights Enterprise', ent.lit);

ok(D.errors.filter((e) => !/\bL is not defined|maplibregl|THREE\b/.test(e)).length === 0,
  'no uncaught page errors outside the stubbed map libraries', D.errors);

await browser.close();
server.close();
console.log(fails ? '\nFAILED ' + fails : '\nAll navigation v3 browser checks passed');
process.exit(fails ? 1 : 0);

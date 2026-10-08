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
//   2. on a return visit, when the viewed ZIP is the resident's own, the homepage's sample
//      still reads the sample ZIP its heading names (78657), never the resident's;
//   3. every page lights the item of the section it belongs to (the active-item matrix);
//   4. My Places shows "What's Changed" and "Alert Settings" above the place list;
//   5. the five support links sit in the ONE shared footer, in order, without overflow at
//      1280px and at 390px;
//   6. privacy.html#terms lands on the Terms heading, clear of the sticky header, even
//      though the page body is injected after load; it jumps when the page appears, not
//      after the account reads; and tapping the footer's Terms on privacy.html lands there;
//   7. Enterprise is linked and listed.
//
// THE SIDEBAR BECAME A HORIZONTAL HEADER (founder, Revised Index Design, 2026-09-30, audited
// against a later main than plan v3). Same three items; the support links moved to one shared
// footer; property.html and reports.html moved into the Explore group; the bell and the old
// homepage story preview are gone, so §2 now reads the homepage's sample list instead.
//
// NO NETWORK. The supabase-js CDN request is fulfilled locally with a stub whose session is
// real (not demo) and whose app_properties read returns one saved Address. Every other read
// resolves empty. Each table read is recorded, so the preview's ZIP is asserted from the
// query the page actually made rather than from what it rendered.
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
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
    // The stack names the caller, so §2 can tell the preview's read (index.html) from the
    // bell's (shell.js), which reads the resident's own ZIP on the same page.
    var call = { table: name, eq: [], stack: String(new Error().stack || '') };
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
    // window.__navDelay (set per context) delays every table read, so §6 can hold the
    // account reads open the way a slow connection does.
    api.then = function (res, rej) {
      var d = window.__navDelay || 0;
      var wait = d ? new Promise(function (r) { setTimeout(r, d); }) : Promise.resolve();
      return wait.then(function () { return settled; }).then(res, rej);
    };
    return api;
  }
  return {
    from: table,
    // Recorded with the caller's stack, so §2 can name the page that asked.
    rpc: function (fn, args) {
      (window.__navRpcs = window.__navRpcs || []).push({ fn: fn, args: args || {}, stack: String(new Error().stack || '') });
      return Promise.resolve({ data: fn === 'app_projects_for_zip' ? [] : null, error: null });
    },
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

async function newPage(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  if (opts.delay) await page.addInitScript((d) => { window.__navDelay = d; }, opts.delay);
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
  // Primary items carry data-nav. The Explore dropdown's three entries (founder, 2026-10-02)
  // carry none; §8 reads them on their own.
  const links = [...document.querySelectorAll('#hs-nav a[data-nav]')];
  return {
    path: location.pathname,
    tokens: links.map((a) => a.getAttribute('data-nav')),
    hrefs: links.map((a) => a.getAttribute('href')),
    labels: links.map((a) => a.textContent.replace(/\s+/g, ' ').trim()),
    lit: links.filter((a) => a.classList.contains('on')).map((a) => a.getAttribute('data-nav')),
    logo: (document.querySelector('#hs-top .hs-brand') || {}).getAttribute
      ? document.querySelector('#hs-top .hs-brand').getAttribute('href') : null,
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
ok(c.tokens.join('|') === 'explore|props|enterprise', '1 the primary nav is Explore, My Places, Enterprise', c.tokens);
ok(c.labels.join('|') === 'Explore|My Places|Enterprise', '1 ...with those labels (text only, no icons)', c.labels);
ok(JSON.stringify(c.hrefs) === JSON.stringify(['index.html', 'properties.html', 'development-activity.html']),
  '1 ...and plain section hrefs (none ZIP-stamped)', c.hrefs);
ok(c.logo === 'index.html', '1 the logo leads to index.html', c.logo);
ok(JSON.stringify(c.lit) === JSON.stringify(['explore']), '1 Explore is the one lit item', c.lit);

// ═══ 2. The homepage's sample reads the sample ZIP its heading names ═══
// Measured on a RETURN visit. On the first load nothing has stored the resident's ZIP yet,
// so the viewed ZIP falls back to the default; the first boot's follow sync stores
// hs:myZip = 84302, so on the second load the viewed ZIP is the resident's own, which is
// exactly the case a sample must ignore. The sample's ZIP is fixed (78657) by the founder's
// Revised Index Design: its list read and its map iframe both name it.
console.log('--- 2. the homepage sample is 78657 ---');
await D.page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
await waitReady(D.page);
await D.page.waitForFunction(() => (window.__navRpcs || []).some((x) => x.fn === 'app_projects_for_zip'), null, { timeout: 15000 }).catch(() => {});
const reads = await D.page.evaluate(() => (window.__navRpcs || [])
  .filter((x) => x.fn === 'app_projects_for_zip')
  .map((x) => ({ zip: x.args.p_zip, kind: x.args.p_kind, from: /\/index\.html:\d+/.test(x.stack) ? 'index.html' : 'other' })));
const view = await D.page.evaluate(() => ({ viewed: window.HS.state.zip, frame: document.getElementById('homeMapFrame').getAttribute('src') }));
ok(view.viewed === SAVED.zip,
  '2 on the return visit the viewed ZIP is the resident’s own ' + SAVED.zip + ' (positive control)', view);
ok(reads.length === 1 && reads[0].zip === '78657' && reads[0].kind === 'development',
  '2 the homepage made exactly one development read, for the sample ZIP 78657, not the resident’s ' + SAVED.zip, reads);
ok(view.frame === 'homesignalmap.html?embed=1&preview=1&zip=78657', '2 the sample map names 78657 too', view.frame);

// The logo click from another page lands back on Explore, and stays.
await D.page.goto(base + '/properties.html', { waitUntil: 'domcontentloaded' });
await waitReady(D.page);
await Promise.all([
  D.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
  D.page.click('#hs-top .hs-brand')
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
  ['/reports.html', ['explore']],
  ['/property.html?id=' + SAVED.id, ['explore']],
  ['/properties.html', ['props']],
  ['/dashboard.html', ['props']],
  ['/alerts.html?zip=78617', ['props']],
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
console.log('--- 5. support links in the one shared footer ---');
const readFooter = (page) => page.evaluate(() => {
  const foot = document.getElementById('hs-footer');
  const links = foot ? [...foot.querySelectorAll('a')] : [];
  const fb = foot ? foot.getBoundingClientRect() : { left: 0, right: 0 };
  return {
    footers: document.querySelectorAll('footer').length,
    labels: links.map((a) => a.textContent.trim()),
    hrefs: links.map((a) => a.getAttribute('href')),
    lit: links.filter((a) => a.hasAttribute('data-nav') || a.classList.contains('on')).length,
    inNav: links.filter((a) => a.closest('#hs-nav')).length,
    lines: new Set(links.map((a) => Math.round(a.getBoundingClientRect().top))).size,
    belowSlot: !!(foot && (document.getElementById('hs-slot').compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING)),
    overflowX: foot ? foot.scrollWidth > foot.clientWidth + 1 : true,
    outside: links.filter((a) => { const r = a.getBoundingClientRect(); return r.left < fb.left - 0.5 || r.right > fb.right + 0.5; })
      .map((a) => a.textContent.trim()),
    linkHeights: links.map((a) => Math.round(a.getBoundingClientRect().height))
  };
});
const EXPECT_LABELS = ['How It Works', 'About', 'Contact', 'Privacy', 'Terms'];
const EXPECT_HREFS = ['how-it-works.html', 'about.html', 'contact.html', 'privacy.html', 'privacy.html#terms'];
await D.page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
await waitReady(D.page);
let f = await readFooter(D.page);
ok(f.footers === 1 && f.belowSlot, '5 1280px: exactly one footer, below the page content', f);
ok(JSON.stringify(f.labels) === JSON.stringify(EXPECT_LABELS), '5 1280px: five support links, in order', f.labels);
ok(JSON.stringify(f.hrefs) === JSON.stringify(EXPECT_HREFS), '5 1280px: ...to the five support pages (Terms is privacy.html#terms)', f.hrefs);
ok(f.lit === 0 && f.inNav === 0, '5 1280px: support links carry no data-nav and sit outside the primary <nav>', f);
ok(!f.overflowX && f.outside.length === 0, '5 1280px: nothing overflows the footer', f);
ok(f.lines === 1, '5 1280px: the footer is one line', f.lines);
ok(Math.max(...f.linkHeights) <= Math.min(...f.linkHeights) + 1, '5 1280px: no single link wraps', f.linkHeights);

const M = await newPage({ width: 390, height: 844 });
await M.page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
await waitReady(M.page);
f = await readFooter(M.page);
const pageOverflow = await M.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
ok(JSON.stringify(f.labels) === JSON.stringify(EXPECT_LABELS), '5 390px: the same five links, in order', f.labels);
ok(!f.overflowX && f.outside.length === 0, '5 390px: nothing overflows the footer', f);
ok(Math.max(...f.linkHeights) <= Math.min(...f.linkHeights) + 1 && Math.min(...f.linkHeights) >= 44, '5 390px: no single link wraps, and each is a 44px target', f.linkHeights);
ok(!pageOverflow, '5 390px: the page does not scroll sideways');

// ═══ 6. privacy.html#terms lands on Terms ═══
// "Lands on Terms" means the Terms of Use heading is on screen and NOT under the sticky
// header (72px). Checked with elementFromPoint at the heading's
// centre, at the phone sizes where a plain jump leaves it covered (360x640, 375x667, 390x664,
// 844x390 landscape) and at sizes where the page bottom happens to hide the problem.
console.log('--- 6. Terms anchor ---');
const termsView = (page) => page.evaluate(() => {
  const h = document.getElementById('terms');
  const bar = document.getElementById('hs-top');
  if (!h) return { exists: false };
  const r = h.getBoundingClientRect();
  const b = bar ? bar.getBoundingClientRect() : { bottom: 0 };
  const hit = document.elementFromPoint(Math.min(r.left + 20, window.innerWidth - 1), r.top + r.height / 2);
  return { exists: true, text: h.textContent.trim(), headTop: Math.round(r.top), headBottom: Math.round(r.bottom),
           barBottom: Math.round(b.bottom), hitInTerms: !!(hit && h.contains(hit)), vh: window.innerHeight,
           scrollY: Math.round(window.scrollY), path: location.pathname, hash: location.hash,
           ready: window.__rd === undefined ? null : window.__rd };
});
const clearOfBar = (v) => v.exists && v.hitInTerms && v.headTop >= v.barBottom && v.headBottom <= v.vh;
const loadTerms = async (page) => {
  await page.goto('about:blank');
  await page.goto(base + '/privacy.html#terms', { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForTimeout(300);
  return termsView(page);
};
let t = await loadTerms(D.page);
ok(t.exists && t.text === 'Terms of Use', '6 privacy.html has the Terms of Use heading (positive control)', t);
ok(t.scrollY > 0 && clearOfBar(t), '6 1280px: #terms opens on the Terms heading, clear of the header', t);
t = await loadTerms(M.page);
ok(t.scrollY > 0 && clearOfBar(t), '6 390x844: ...and on a tall phone', t);
const SMALL = [{ width: 360, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 664 }, { width: 844, height: 390 }];
const smallPages = [];
for (const vp of SMALL) {
  const P = await newPage(vp);
  smallPages.push(P);
  t = await loadTerms(P.page);
  ok(t.barBottom > 0, '6 ' + vp.width + 'x' + vp.height + ': the sticky header is measured (positive control)', t);
  ok(clearOfBar(t), '6 ' + vp.width + 'x' + vp.height + ': the Terms heading is not under the header', t);
}

// On privacy.html the footer's Terms link stays on the same document, so it is a jump within
// the page. Tap it from the top of the page and when the URL already ends in #terms (no
// hashchange fires then): it must land on Terms, clear of the header, with the compact menu
// closed. about:blank first: going to privacy.html#terms from privacy.html#terms is a jump
// within the page, not a load.
const tapTermsInFooter = async (page) => {
  let clickError = null;
  try {
    await page.click('#hs-footer a[href="privacy.html#terms"]', { timeout: 5000 });
  } catch (e) { clickError = String(e).split('\n')[0]; }
  await page.waitForTimeout(400);
  const v = await termsView(page);
  const d = await page.evaluate(() => ({ menuOpen: document.getElementById('hs-top').classList.contains('menu-open') }));
  return { clickError, ...d, ...v };
};
const FOOTER_TAP = [['390x844', M.page], ['375x667', smallPages[1].page]];
for (const [label, page] of FOOTER_TAP) {
  for (const start of ['/privacy.html', '/privacy.html#terms']) {
    await page.goto('about:blank');
    await page.goto(base + start, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const d = await tapTermsInFooter(page);
    const tag = '6 ' + label + ' ' + start + ': ';
    ok(!d.clickError, tag + 'the footer\'s Terms was tapped (positive control)', d);
    ok(!d.menuOpen && d.path === '/privacy.html' && d.hash === '#terms' && clearOfBar(d), tag + 'it lands on the Terms heading, clear of the header', d);
  }
}

// A signed-in resident on a slow connection. The account reads that come before HS.ready
// take seconds here (every table read is delayed). The page is on screen long before that,
// so the jump to Terms must happen when the page appears, not when the reads finish, and a
// reader who has scrolled since must not be pulled back. The footer's Terms must also work
// before the reads finish.
const SLOW = await newPage({ width: 375, height: 667 }, { delay: 700 });
const markReady = (page) => page.evaluate(() => { window.__rd = false; window.HS.ready.then(() => { window.__rd = true; }); });
await SLOW.page.goto(base + '/privacy.html#terms', { waitUntil: 'domcontentloaded' });
await markReady(SLOW.page);
await SLOW.page.waitForFunction(() => !!document.getElementById('terms'), null, { timeout: 30000 });
await SLOW.page.waitForTimeout(150);
let s1 = await termsView(SLOW.page);
ok(s1.ready === false, '6 slow sign-in: the account reads are still pending when the page appears (positive control)', s1);
ok(s1.scrollY > 0 && clearOfBar(s1), '6 slow sign-in: the page is already on the Terms heading, before the reads finish', s1);
await SLOW.page.mouse.move(187, 400);
await SLOW.page.mouse.wheel(0, -180);
await SLOW.page.waitForTimeout(400);
const userY = await SLOW.page.evaluate(() => Math.round(window.scrollY));
ok(Math.abs(userY - s1.scrollY) > 20, '6 slow sign-in: the reader scrolled away from Terms (positive control)', { from: s1.scrollY, to: userY });
await waitReady(SLOW.page);
await SLOW.page.waitForTimeout(400);
const s2 = await termsView(SLOW.page);
ok(s2.ready === true && Math.abs(s2.scrollY - userY) <= 2,
  '6 slow sign-in: when the reads finish, the page stays where the reader scrolled', { userY, after: s2.scrollY, ready: s2.ready });

await SLOW.page.goto('about:blank');
await SLOW.page.goto(base + '/privacy.html', { waitUntil: 'domcontentloaded' });
await markReady(SLOW.page);
await SLOW.page.waitForSelector('#hs-footer a[href="privacy.html#terms"]', { timeout: 30000 });
await SLOW.page.evaluate(() => window.scrollTo(0, 0));
const sd = await tapTermsInFooter(SLOW.page);
ok(!sd.clickError && sd.ready === false,
  '6 slow sign-in: the footer\'s Terms was tapped before the reads finished (positive control)', sd);
ok(sd.hash === '#terms' && clearOfBar(sd), '6 slow sign-in: it lands on Terms without waiting for the reads', sd);

// ═══ 7. Enterprise is linked and listed (founder, 2026-10-02: commerce buttons hidden) ═══
console.log('--- 7. Enterprise is index, follow ---');
await D.page.goto(base + '/development-activity.html', { waitUntil: 'domcontentloaded' });
await waitReady(D.page);
const ent = await D.page.evaluate(() => ({
  robots: (document.querySelector('meta[name="robots"]') || {}).content || '',
  lit: [...document.querySelectorAll('#hs-nav a.on')].map((a) => a.getAttribute('data-nav'))
}));
ok(ent.robots === 'index, follow', '7 development-activity.html is index, follow (listed 2026-10-02, buttons hidden)', ent.robots);
ok(JSON.stringify(ent.lit) === JSON.stringify(['enterprise']), '7 ...and lights Enterprise', ent.lit);

// ═══ 8. The Explore dropdown (founder, 2026-10-02) ═══
// "Quality of Life Impact" (development.html), "Development Map" (homesignalmap.html) and
// "Activity" (community.html), under Explore in the header. Wide: hovering Explore opens it
// ("if you hover over explore the drop down should be obvious"); the chevron beside Explore
// opens it too, and then an entry, Escape or a click outside closes it. The current page's
// entry is marked, and every entry carries the viewed ZIP. Compact: the Menu panel lists the
// three under Explore. The mouse is parked away from the header before every "closed" check,
// because hovering is itself a way to open it.
console.log('--- 8. the Explore dropdown ---');
const dropdown = (page) => page.evaluate(() => {
  const sub = document.getElementById('hs-explore-sub');
  const links = sub ? [...sub.querySelectorAll('a')] : [];
  const r = sub ? sub.getBoundingClientRect() : null;
  const btn = document.getElementById('hs-explore-toggle');
  const svg = btn && btn.querySelector('svg');
  const sr = svg ? svg.getBoundingClientRect() : { width: 0, height: 0 };
  const br = btn ? btn.getBoundingClientRect() : { width: 0, height: 0 };
  return {
    open: !!sub && getComputedStyle(sub).display !== 'none' && r.height > 0,
    labels: links.map((a) => a.textContent.trim()),
    hrefs: links.map((a) => a.getAttribute('href')),
    navs: links.map((a) => a.getAttribute('data-nav')),
    current: links.filter((a) => getComputedStyle(a).fontWeight === '600').map((a) => a.getAttribute('data-sub')),
    caret: !!btn && getComputedStyle(btn).display !== 'none',
    chevron: Math.round(sr.width) + 'x' + Math.round(sr.height),
    button: Math.round(br.width) + 'x' + Math.round(br.height),
    expanded: btn ? btn.getAttribute('aria-expanded') : null,
    focusOnCaret: document.activeElement === btn,
    lit: [...document.querySelectorAll('#hs-nav a.on')].map((a) => a.getAttribute('data-nav')),
  };
});
const away = () => D.page.mouse.move(640, 700);
const zipOf = (h) => ((h || '').match(/[?&]zip=(\d{5})/) || [])[1] || null;
for (const [path, want] of [['/development.html?zip=78617', 'qol'], ['/homesignalmap.html?zip=78617', 'map'], ['/community.html?zip=78617', 'activity']]) {
  await away();
  await D.page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await waitReady(D.page);
  await D.page.waitForSelector('#hs-explore-toggle', { state: 'attached', timeout: 30000 });
  let d = await dropdown(D.page);
  ok(!d.open && d.caret && d.expanded === 'false', '8 ' + path + ': the dropdown starts closed, with its chevron beside Explore', d);
  ok(d.chevron === '18x18' && d.button === '30x44', '8 ' + path + ': ...an 18px chevron on a 30x44 button, big enough to see and to tap', d);
  await D.page.hover('#hs-nav a[data-nav="explore"]');
  d = await dropdown(D.page);
  ok(d.open, '8 ' + path + ': hovering Explore opens it', d);
  ok(d.labels.join('|') === 'Quality of Life Impact|Development Map|Activity', '8 ' + path + ': ...listing the three pages by their names', d.labels);
  ok(d.hrefs.map((h) => h.split('?')[0]).join('|') === 'development.html|homesignalmap.html|community.html'
     && d.hrefs.every((h) => zipOf(h) === '78617'),
    '8 ' + path + ': ...each opening its page for the viewed ZIP 78617', d.hrefs);
  ok(d.navs.every((n) => n === null) && JSON.stringify(d.lit) === JSON.stringify(['explore']),
    '8 ' + path + ': ...without lighting any section but Explore', d);
  ok(JSON.stringify(d.current) === JSON.stringify([want]), '8 ' + path + ': ...and marks "' + want + '" as the current page', d.current);
  await D.page.hover('#hs-explore-sub a[data-sub="activity"]');
  d = await dropdown(D.page);
  ok(d.open, '8 ' + path + ': ...and stays open while the pointer moves down into it', d);
  await away();
  d = await dropdown(D.page);
  ok(!d.open, '8 ' + path + ': moving the pointer away closes it', d);
}
// Following an entry lands on that page, for the same ZIP.
await away();
await D.page.goto(base + '/development.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitReady(D.page);
await D.page.waitForSelector('#hs-explore-toggle', { state: 'attached', timeout: 30000 });
await D.page.hover('#hs-nav a[data-nav="explore"]');
await Promise.all([D.page.waitForURL(/community\.html\?zip=78617/, { timeout: 30000 }), D.page.click('#hs-explore-sub a[data-sub="activity"]')]);
ok(/\/community\.html\?zip=78617$/.test(new URL(D.page.url()).pathname + new URL(D.page.url()).search),
  '8 clicking Activity opens the ZIP page for the same ZIP', D.page.url());
// The chevron opens it without hovering (touch, keyboard) and closes it again; Escape and a
// click outside close it too.
await waitReady(D.page);
await D.page.waitForSelector('#hs-explore-toggle', { state: 'attached', timeout: 30000 });
await D.page.click('#hs-explore-toggle');
await away();
let dd = await dropdown(D.page);
ok(dd.open && dd.expanded === 'true', '8 the chevron opens it, and it stays open after the pointer leaves', dd);
await D.page.click('#hs-explore-toggle');
await away();
dd = await dropdown(D.page);
ok(!dd.open && dd.expanded === 'false', '8 the chevron closes it again', dd);
await D.page.click('#hs-explore-toggle');
await away();
await D.page.keyboard.press('Escape');
dd = await dropdown(D.page);
ok(!dd.open && dd.expanded === 'false' && dd.focusOnCaret, '8 Escape closes it and returns focus to the chevron', dd);
await D.page.click('#hs-explore-toggle');
await D.page.mouse.click(640, 700);
dd = await dropdown(D.page);
ok(!dd.open && dd.expanded === 'false', '8 a click outside closes it', dd);
// Off Explore it works the same, with no entry marked current.
for (const path of ['/properties.html', '/index.html']) {
  await away();
  await D.page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await waitReady(D.page);
  await D.page.waitForSelector('#hs-explore-toggle', { state: 'attached', timeout: 30000 });
  dd = await dropdown(D.page);
  ok(!dd.open && dd.caret, '8 ' + path + ': the dropdown starts closed', dd);
  await D.page.hover('#hs-nav a[data-nav="explore"]');
  dd = await dropdown(D.page);
  ok(dd.open && dd.current.length === 0 && dd.labels.length === 3, '8 ' + path + ': hovering Explore opens it, with no entry marked current', dd);
}
await away();
// Compact: the Menu panel lists the three pages under Explore, with no chevron. Measured on
// the ZIP page: Map 1 at 390px already scrolls sideways by 29px with the menu closed (its
// view switcher, the same on main), which is not this menu's to fix.
{
  const M = await newPage({ width: 390, height: 844 });
  await M.page.goto(base + '/community.html?zip=78617', { waitUntil: 'domcontentloaded' });
  await waitReady(M.page);
  await M.page.waitForSelector('#hs-menubtn', { timeout: 30000 });
  await M.page.click('#hs-menubtn');
  const m = await M.page.evaluate(() => {
    const v = (e) => !!(e && e.offsetParent !== null);
    return {
      items: [...document.querySelectorAll('#hs-nav a')].filter(v).map((a) => a.textContent.trim()),
      caret: v(document.getElementById('hs-explore-toggle')),
      current: [...document.querySelectorAll('#hs-explore-sub a')].filter((a) => getComputedStyle(a).fontWeight === '600').map((a) => a.getAttribute('data-sub')),
      minH: Math.min(...[...document.querySelectorAll('#hs-nav a')].filter(v).map((a) => a.getBoundingClientRect().height)),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  ok(m.items.join('|') === 'Explore|Quality of Life Impact|Development Map|Activity|My Places|Enterprise|Enterprise overview|My reports',
    '8 phone: the Menu panel lists the three pages under Explore', m.items);
  ok(!m.caret && JSON.stringify(m.current) === JSON.stringify(['activity']) && m.minH >= 44 && m.overflow === 0,
    '8 phone: no chevron, the current page marked, 44px targets, no sideways scroll', m);
  await M.ctx.close();
}

// ═══ 9. The Enterprise dropdown: "My reports" (founder, 2026-10-05) ═══
// An agent had no way back to development-activity-reports.html: no page linked it. Enterprise now
// opens a menu of "Enterprise overview" and "My reports", built like Explore's (hover, chevron,
// Escape, click outside). The Explore and Enterprise menus are independent.
console.log('--- 9. the Enterprise dropdown ---');
await away();
await D.page.goto(base + '/development.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitReady(D.page);
await D.page.waitForSelector('#hs-enterprise-toggle', { state: 'attached', timeout: 30000 });
const entDrop = () => D.page.evaluate(() => {
  const sub = document.getElementById('hs-enterprise-sub');
  const r = sub.getBoundingClientRect();
  const btn = document.getElementById('hs-enterprise-toggle');
  const ex = document.getElementById('hs-explore-sub');
  return {
    open: getComputedStyle(sub).display !== 'none' && r.height > 0,
    exploreOpen: getComputedStyle(ex).display !== 'none' && ex.getBoundingClientRect().height > 0,
    labels: [...sub.querySelectorAll('a')].map((a) => a.textContent.trim()),
    hrefs: [...sub.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    expanded: btn.getAttribute('aria-expanded'),
    focusOnCaret: document.activeElement === btn,
    offscreen: r.right > window.innerWidth,
  };
});
let e9 = await entDrop();
ok(!e9.open && e9.expanded === 'false', '9 the Enterprise dropdown starts closed', e9);
await D.page.hover('#hs-nav a[data-nav="enterprise"]');
e9 = await entDrop();
ok(e9.open && !e9.exploreOpen, '9 hovering Enterprise opens it, and not the Explore menu', e9);
ok(e9.labels.join('|') === 'Enterprise overview|My reports'
   && e9.hrefs.join('|') === 'development-activity.html|development-activity-reports.html',
  '9 ...listing Enterprise overview and My reports, "My reports" opening development-activity-reports.html', e9);
ok(!e9.offscreen, '9 ...and the menu fits inside the window', e9);
await away();
await D.page.click('#hs-enterprise-toggle');
e9 = await entDrop();
ok(e9.open && e9.expanded === 'true', '9 the chevron opens it too (touch and keyboard)', e9);
await D.page.keyboard.press('Escape');
await away();
e9 = await entDrop();
ok(!e9.open && e9.focusOnCaret, '9 Escape closes it and returns focus to the chevron', e9);
await D.page.click('#hs-enterprise-toggle');
await D.page.mouse.click(40, 600);
await away();
e9 = await entDrop();
ok(!e9.open, '9 a click outside closes it', e9);
await D.page.click('#hs-enterprise-toggle');
await Promise.all([D.page.waitForURL(/development-activity-reports\.html/, { timeout: 30000 }).catch(() => null),
  D.page.click('#hs-enterprise-sub a[data-sub="reports"]')]);
ok(/development-activity-reports\.html/.test(D.page.url()), '9 choosing "My reports" opens the reports page', D.page.url());

ok(D.errors.filter((e) => !/\bL is not defined|maplibregl|THREE\b/.test(e)).length === 0,
  'no uncaught page errors outside the stubbed map libraries', D.errors);

await browser.close();
server.close();
console.log(fails ? '\nFAILED ' + fails : '\nAll navigation v3 browser checks passed');
process.exit(fails ? 1 : 0);

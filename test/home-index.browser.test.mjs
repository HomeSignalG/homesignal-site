// THE REVISED HOMEPAGE, IN A REAL BROWSER (founder, Revised Index Design, 2026-09-30).
// Run: node test/home-index.browser.test.mjs
//
// What it proves, each against the shipped page with no network (test/lib/home-index-harness.mjs):
//   1. Signed out, the homepage stays put, shows the approved header and ONE footer, and the
//      old sidebar / Viewing chip / Place adds / bell are gone.
//   2. The sample map is Map 1 itself: the preview iframe is pointer-locked, out of the tab
//      order, auto-sized to its document, and shows STATUS / PROJECT TYPE / REGULATORY RECORDS
//      and the map key with no scrollbar inside the frame, at a 430 / 400 / 340 px canvas.
//   3. The three records are HS.data.projects' first three, labelled by lib/project-type.js.
//   4. A search leaves for the Development Map (founder, 2026-10-04) and the homepage keeps
//      showing only its static example. (Items 4-6 and 11 of the first version, which proved
//      the inline results, retired with that behavior.)
//   7. The compact header (1023px and narrower) and its Menu panel.
//   8. Signed in, the avatar replaces Sign in and the page still stays put.
//   9. Map 1's own embed hides the site header and footer; preview=1 needs embed=1.
//  10. The tab's viewed ZIP is never written by the embedded map.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP home-index.browser.test.mjs — playwright not installed');
  process.exit(0);
}
import { serve, open, PROJECTS_78657 } from './lib/home-index-harness.mjs';

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (d !== undefined) console.log('           detail: ' + JSON.stringify(d).slice(0, 500)); }
};

const ADDR_OK = '1 Hi Circle North, Horseshoe Bay, TX 78657';
const ADDR_SLOW = '2 Slow Lane, Horseshoe Bay, TX 78657';
const ADDR_NOMATCH = '1 Nowhere Lane, Atlantis';
const ADDR_OUTAGE = '99 Outage Rd, Austin TX';
const ADDR_BADPOINT = '7 Bad Point Rd, Austin TX';
const MATCH = { matchedAddress: '1 HI CIRCLE N, HORSESHOE BAY, TX, 78657', lat: 30.54, lng: -98.37, zip: '78657', city: 'HORSESHOE BAY', state: 'TX' };
const STUB = {
  projects: { '78657': PROJECTS_78657, '78702': [], '78601': [{ id: 'z1', name: 'Slow ZIP record', type: 'Commercial', status: 'Proposed' }] },
  failProjects: ['78701'],
  meta: { '78657': { zip: '78657', name: 'Horseshoe Bay', state: 'TX' }, '78601': { zip: '78601', name: 'Slowtown', state: 'TX' } },
  delayRpc: { '78601': 1500 }, delayTable: { '78601': 1500 },
  geocode: {
    [ADDR_OK]: MATCH,
    [ADDR_SLOW]: { matchedAddress: '2 SLOW LN, HORSESHOE BAY, TX, 78657', lat: 30.5, lng: -98.3, zip: '78657' },
    [ADDR_OUTAGE]: 'OUTAGE',
    [ADDR_BADPOINT]: { matchedAddress: '7 BAD POINT RD', lat: 999, lng: -97.7, zip: '78701' }
  },
  delayGeocode: { [ADDR_SLOW]: 1500 }
};

const { srv, base } = await serve();
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const frameInfo = (page) => page.evaluate(() => {
  const f = document.getElementById('homeMapFrame');
  const wrap = document.getElementById('homeMapWrap');
  let d = null; try { d = f.contentDocument; } catch (e) {}
  const q = (sel) => (d ? d.querySelector(sel) : null);
  const rowsVisible = ['#stageLegHd', '#shapeLegHd', '#regLegHd', '#mapkey', '#mapkeyShapes', '#mapkeyReg', '#mapkeyNote', '.leaflet-container']
    .map((sel) => {
      const e = q(sel);
      if (!e) return sel + ':missing';
      const r = e.getBoundingClientRect();
      const visible = r.height > 0 && getComputedStyle(e).display !== 'none' && r.bottom <= f.getBoundingClientRect().height + 1;
      return visible ? null : sel + ':hidden(' + Math.round(r.bottom) + ')';
    }).filter(Boolean);
  const maprow = q('.maprow');
  return {
    src: f.getAttribute('src'), title: f.title, tabindex: f.getAttribute('tabindex'), loading: f.getAttribute('loading'),
    sample: wrap.classList.contains('is-sample'), pointer: getComputedStyle(f).pointerEvents,
    height: Math.round(f.getBoundingClientRect().height),
    docHeight: d ? Math.ceil(d.documentElement.scrollHeight) : null,
    docUrl: d ? String(d.location.href) : null,
    preview: d ? d.documentElement.classList.contains('hs-preview') : null,
    embed: d ? d.documentElement.classList.contains('hs-embed') : null,
    canvas: q('.map-frame') ? Math.round(q('.map-frame').getBoundingClientRect().height) : null,
    panelScroll: maprow ? maprow.scrollHeight - maprow.clientHeight : null,
    headings: ['#stageLegHd', '#shapeLegHd', '#regLegHd'].map((s) => (q(s) || {}).innerText || ''),
    chips: d ? d.querySelectorAll('#mapkey label, #mapkeyShapes label, #mapkeyReg label').length : 0,
    rowsNotVisible: rowsVisible
  };
});
const waitForMap = (page, re) => page.waitForFunction((src) => {
  const f = document.getElementById('homeMapFrame');
  let d = null; try { d = f.contentDocument; } catch (e) { return false; }
  return !!(d && new RegExp(src).test(String(d.location.href)) && d.querySelector('.leaflet-container')
    && d.querySelectorAll('#mapkeyShapes label').length > 0);
}, re.source, { timeout: 30000 });
const ui = (page) => page.evaluate(() => {
  const vis = (id) => { const e = document.getElementById(id); return !!(e && !e.hidden && e.offsetParent !== null); };
  return {
    path: location.pathname, search: location.search, hash: location.hash, histLen: history.length,
    heading: document.getElementById('homeResultsHeading').textContent,
    sub: vis('homeResultsSub') ? document.getElementById('homeResultsSub').textContent : null,
    cta: vis('homeMapCta') ? document.getElementById('homeMapCta').textContent : null,
    ctaHref: document.getElementById('homeMapCta').getAttribute('href'),
    seeAll: vis('homeSeeAll'), seeAllHref: document.getElementById('homeSeeAll').getAttribute('href'),
    records: vis('homeRecords'), recordsHeading: document.getElementById('homeRecordsHeading').textContent,
    names: [...document.querySelectorAll('.home-index__record .home-index__record-name')].map((e) => e.textContent),
    note: (document.querySelector('.home-index__records-note') || {}).textContent || null,
    full: document.getElementById('homeResultsGrid').classList.contains('home-index__results-grid--full'),
    err: vis('homeSearchErr') ? document.getElementById('homeSearchErr').textContent : null,
    busy: document.getElementById('homeSearchBtn').disabled, ariaBusy: document.getElementById('homeSearchBtn').getAttribute('aria-busy'),
    active: document.activeElement && document.activeElement.id,
    viewZip: sessionStorage.getItem('hs:viewZip'),
    storage: Object.keys(localStorage).filter((k) => k.indexOf('hs:') === 0).sort().map((k) => k + '=' + localStorage.getItem(k)),
    locModalShown: getComputedStyle(document.getElementById('locModal')).display !== 'none',
    invokes: window.__invokes.length,
    coveredReads: window.__tables.filter((t) => t.table === 'app_community_meta' && t.select === 'zip').length,
    writes: window.__tables.filter((t) => t.insert || ['app_follows', 'app_properties', 'users', 'user_subscriptions'].includes(t.table)).map((t) => t.table)
  };
});
async function search(page, q) {
  await page.fill('#homeQuery', q);
  await page.press('#homeQuery', 'Enter');
}

// ─────────────────────────────────────────────────────────────── 1–3: the initial page ──
console.log('--- 1. signed out: stays on Explore; the approved header and ONE footer ---');
{
  const { ctx, page, errors } = await open(browser, base, '/index.html', { stub: STUB });
  await page.waitForTimeout(800);
  const h = await page.evaluate(() => {
    const vis = (e) => !!(e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden');
    const head = document.getElementById('hs-top');
    return {
      path: location.pathname,
      nav: [...head.querySelectorAll('.hs-nav a')].filter(vis).map((a) => a.textContent.trim() + (a.classList.contains('on') ? '*' : '') + (a.getAttribute('aria-current') ? '[' + a.getAttribute('aria-current') + ']' : '')),
      logoHref: head.querySelector('.hs-brand').getAttribute('href'),
      share: vis(document.getElementById('hs-share')), signin: vis(document.getElementById('hs-signin')),
      avatar: vis(document.getElementById('hs-avatar')), menu: vis(document.getElementById('hs-menubtn')),
      oneLine: Math.round(head.getBoundingClientRect().height),
      gone: ['hs-side', 'locLabel', 'hsAddAddress', 'hsAddZip', 'hs-bell-badge', 'sidebackdrop'].filter((id) => document.getElementById(id)),
      bell: !!document.querySelector('[aria-label="Notifications"]'),
      footers: document.querySelectorAll('footer').length,
      footLinks: [...document.querySelectorAll('#hs-footer a')].map((a) => a.textContent + '=' + a.getAttribute('href')),
      footerBelowSlot: document.getElementById('hs-slot').compareDocumentPosition(document.getElementById('hs-footer')) & Node.DOCUMENT_POSITION_FOLLOWING,
      enterpriseLinks: [...document.querySelectorAll('a[href="development-activity.html"]')].map((a) => a.textContent.trim()),
      h1: document.querySelector('.home-index__title').textContent,
      h1Lines: Math.round(document.querySelector('.home-index__title').getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector('.home-index__title')).lineHeight)),
      searchRow: (() => { const i = document.getElementById('homeQuery').getBoundingClientRect(), b = document.getElementById('homeSearchBtn').getBoundingClientRect(); return Math.abs(i.top - b.top) < 2; })(),
      btnW: Math.round(document.getElementById('homeSearchBtn').getBoundingClientRect().width),
      img: (() => { const i = document.querySelector('.home-index__report-preview'); return i ? i.getAttribute('src') + '|' + i.complete + '|' + i.naturalWidth : null; })()
    };
  });
  ok(h.path === '/index.html', '1 the homepage does not redirect', h.path);
  ok(JSON.stringify(h.nav) === JSON.stringify(['Explore*[page]', 'My Places', 'Enterprise']), '1 primary nav is Explore (active, aria-current="page"), My Places, Enterprise', h.nav);
  ok(h.logoHref === 'index.html', '1 the logo returns to index.html');
  ok(h.share && h.signin && !h.avatar && !h.menu, '1 Share and Sign in show; no avatar, no Menu button at 1440px', h);
  ok(h.oneLine === 72, '1 the header is one 72px line', h.oneLine);
  ok(h.gone.length === 0 && !h.bell, '1 no sidebar, Viewing chip, Place adds, bell or backdrop', h.gone);
  ok(h.footers === 1 && JSON.stringify(h.footLinks) === JSON.stringify(['How It Works=how-it-works.html', 'About=about.html', 'Contact=contact.html', 'Privacy=privacy.html', 'Terms of Service=terms.html', 'Refund Policy=refund-policy.html']),
    '1 exactly one footer: How It Works / About / Contact / Privacy / Terms of Service / Refund Policy', h);
  ok(!!h.footerBelowSlot, '1 the footer renders below the page content');
  ok(JSON.stringify(h.enterpriseLinks) === JSON.stringify(['Enterprise', 'Enterprise overview', 'Explore Enterprise →']), '1 the Enterprise message appears once (header item, its dropdown\'s overview entry + hero card; no bottom banner)', h.enterpriseLinks);
  ok(h.h1 === 'See what’s changing around a property.' && h.h1Lines === 2, '1 H1 copy, in two lines at 1440px', h);
  ok(h.searchRow && h.btnW === 136, '1 input and 136px Search button on one row', h);
  ok(/home-development-activity-report-preview\.webp\|true\|1448$/.test(h.img || ''), '1 the approved report preview loads (1448px wide)', h.img);

  console.log('--- 2. the sample map is Map 1 in preview mode ---');
  await waitForMap(page, /homesignalmap\.html\?embed=1&preview=1&zip=78657/);
  await page.waitForTimeout(600);
  const f = await frameInfo(page);
  ok(f.src === 'homesignalmap.html?embed=1&preview=1&zip=78657', '2 initial src is exactly the preview shape', f.src);
  ok(f.loading === 'lazy' && f.tabindex === '-1' && f.title === 'Sample HomeSignal development map', '2 lazy, tabindex -1, meaningful title', f);
  ok(f.sample && f.pointer === 'none', '2 the sample is pointer-locked', f.pointer);
  ok(f.preview === true && f.embed === true, '2 the frame document is in embed + preview mode', f);
  ok(Math.abs(f.height - f.docHeight) <= 1 && f.height > 600, '2 the iframe is auto-sized to its document (no fixed height)', f);
  ok(f.canvas === 430, '2 the preview map canvas is 430px at 1440px', f.canvas);
  ok(f.panelScroll === 0, '2 the filter panel has no internal scrollbar', f.panelScroll);
  ok(JSON.stringify(f.headings) === JSON.stringify(['STATUS', 'PROJECT TYPE', 'REGULATORY RECORDS']) && f.chips >= 12,
    '2 STATUS / PROJECT TYPE / REGULATORY RECORDS with their controls', f);
  ok(f.rowsNotVisible.length === 0, '2 every filter group, the map key and the map canvas are inside the visible frame', f.rowsNotVisible);
  const focusable = await page.evaluate(() => { const f = document.getElementById('homeMapFrame'); f.focus(); return document.activeElement === f; });
  ok(!focusable || (await page.evaluate(() => document.getElementById('homeMapFrame').tabIndex)) === -1, '2 the sample is out of the tab order');

  console.log('--- 3. the records are HS.data.projects\' first three, canonically labelled ---');
  const r = await page.evaluate((rows) => ({
    cards: [...document.querySelectorAll('.home-index__record')].map((c) => ({
      name: c.querySelector('.home-index__record-name').textContent,
      href: c.querySelector('.home-index__record-name').getAttribute('href'),
      badges: [...c.querySelectorAll('.home-index__badge')].map((b) => b.textContent),
      source: (c.querySelector('.home-index__record-meta a') || {}).href || null
    })),
    expected: rows.slice(0, 3).map((p) => [HS.canonicalProjectType(p), HS.canonicalLifecycle(p)].filter(Boolean).map((x) => x.label))
  }), PROJECTS_78657);
  ok(r.cards.length === 3 && JSON.stringify(r.cards.map((c) => c.name)) === JSON.stringify(PROJECTS_78657.slice(0, 3).map((p) => p.name)),
    '3 exactly three cards, in the order the read returned', r.cards.map((c) => c.name));
  ok(JSON.stringify(r.cards.map((c) => c.badges)) === JSON.stringify(r.expected), '3 Type and lifecycle badges are lib/project-type.js\'s labels', r);
  ok(r.cards.every((c, i) => c.href === 'development.html?id=' + PROJECTS_78657[i].id && c.source === PROJECTS_78657[i].source_ref),
    '3 each card links its project page and its official record', r.cards);
  const s1 = await ui(page);
  ok(s1.recordsHeading === 'Recent development records in 78657' && s1.seeAllHref === 'development.html?zip=78657' && s1.ctaHref === 'homesignalmap.html?zip=78657' && s1.cta === 'Explore this ZIP →',
    '3 sample heading, "Explore this ZIP →" and "See all development →" point at 78657', s1);
  ok(s1.viewZip === null, '10 the sample map did not write the tab\'s viewed ZIP', s1.viewZip);
  ok(s1.storage.length === 0 || s1.storage.every((k) => !/myZip|myCommunities|follows|activeProp/.test(k)), '3 loading the homepage saved no place', s1.storage);

  // ───────────────────────────────────────────────────────── 4: a search leaves for Map 1 ──
  // (founder, 2026-10-04.) The homepage no longer shows results of its own: the sample stays a
  // sample, and a search goes to the Development Map. The ZIP and address hand-off details are
  // test/home-zip-or-address.browser.test.mjs; this checks the homepage itself is left alone.
  console.log('--- 4. a search never turns the sample into results; it leaves for Map 1 ---');
  const before = await ui(page);
  let went = null;
  await page.route('**/homesignalmap.html?zip=*', (route) => { if (route.request().frame() !== page.mainFrame()) return route.fallback(); went = new URL(route.request().url()).search; return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>map</title>' }); });
  await search(page, '78657');
  await page.waitForFunction(() => location.pathname === '/homesignalmap.html', null, { timeout: 8000 }).catch(() => {});
  ok(went === '?zip=78657', '4 a ZIP search opens homesignalmap.html?zip=78657', went);
  ok(before.heading === 'See an example: 78657 · Horseshoe Bay, Texas' && before.sub === null && before.records, '4 before it, the homepage still shows only the static example', before);

  ok(errors.length === 0, '1–4 no page or console errors across load and a search', errors);
  await ctx.close();
}

// ──────────────────────────────────────── 4b: an address arriving from a buyer's shared report ──
// (founder, 2026-10-09: "link to the full address".) The shared report's invitation links to /#address=<encoded>. The fragment is
// read once, removed from the address bar, and the address goes through the SAME search a typed address does.
console.log('--- 4b. #address= is searched once, taken out of the URL, and handed over in sessionStorage ---');
{
  const ADDR = '742 Evergreen Terrace, Springfield, OR 97477';
  const { ctx, page, errors } = await open(browser, base, '/index.html#address=' + encodeURIComponent(ADDR), { stub: STUB, waitReady: false });
  await page.route('**/homesignalmap.html', (route) => { if (route.request().frame() !== page.mainFrame()) return route.fallback(); return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>map</title>' }); });
  await page.waitForFunction(() => location.pathname === '/homesignalmap.html', null, { timeout: 8000 }).catch(() => {});
  const arrived = await page.evaluate(() => ({ path: location.pathname, url: location.href, handed: sessionStorage.getItem('hs.homeSearchAddress') }));
  ok(arrived.path === '/homesignalmap.html' && arrived.handed === ADDR, '4b the address from the fragment is searched: Map 1 opens with the address handed over in sessionStorage', arrived);
  ok(!/address|Evergreen|%20/.test(arrived.url), '4b and it is in no URL on the way (the hand-off is sessionStorage, never a query or fragment)', arrived.url);
  await page.goBack().catch(() => {});
  await page.waitForFunction(() => location.pathname === '/index.html', null, { timeout: 8000 }).catch(() => {});
  const back = await page.evaluate(() => location.href);
  ok(/\/index\.html$/.test(back) && !/address/.test(back), '4b Back returns to the plain home page: the fragment was removed from the history entry, so the search does not run again', back);
  ok(errors.length === 0, '4b no page or console errors', errors);
  await ctx.close();
}
{
  for (const frag of ['#address=abc', '#address=78657', '#address=%E0%A4%A', '#other=1 Main Street Springfield OR']) {
    const { ctx, page } = await open(browser, base, '/index.html' + frag, { stub: STUB });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({ path: location.pathname, box: document.getElementById('homeQuery').value, handed: sessionStorage.getItem('hs.homeSearchAddress') }));
    ok(r.path === '/index.html' && r.box === '' && r.handed === null, '4b ' + frag + ' is not a plausible street address: the page stays as it is and searches nothing', r);
    await ctx.close();
  }
}

// ─────────────────────────────────────────────────────────────── 2b: canvas by width ──
console.log('--- 2b. the preview canvas follows the host breakpoint; no internal scroll at any width ---');
for (const [w, h, want, live] of [[1280, 900, 430, 760], [1024, 768, 430, 760], [768, 1024, 400, 700], [390, 844, 340, 660]]) {
  const { ctx, page, errors } = await open(browser, base, '/index.html', { stub: STUB, width: w, height: h });
  await page.evaluate(() => document.getElementById('homeExploreResults').scrollIntoView());
  await waitForMap(page, /preview=1/);
  await page.waitForTimeout(600);
  const f = await frameInfo(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(f.canvas === want && f.panelScroll === 0 && Math.abs(f.height - f.docHeight) <= 1 && f.rowsNotVisible.length === 0,
    '2b ' + w + 'x' + h + ': canvas ' + want + 'px, every filter group visible, no internal scroll, auto height', f);
  ok(overflow === 0, '2b ' + w + 'x' + h + ': no horizontal overflow', overflow);
  ok(errors.length === 0, '2b ' + w + 'x' + h + ': no errors', errors);
  await ctx.close();
}

// ──────────────────────────────────────────────────────────────── 7: compact header ──
// The panel holds the three primary items, with the Explore dropdown's three pages (founder,
// 2026-10-02) listed under Explore.
console.log('--- 7. compact header: logo, Share, Sign in, Menu; the panel holds the three items ---');
for (const [w, h] of [[390, 844], [768, 1024]]) {
  const { ctx, page, errors } = await open(browser, base, '/index.html', { stub: STUB, width: w, height: h });
  const vis = () => page.evaluate(() => {
    const v = (e) => !!(e && e.offsetParent !== null);
    return {
      logo: v(document.querySelector('.hs-brand')), share: v(document.getElementById('hs-share')),
      signin: v(document.getElementById('hs-signin')), menu: v(document.getElementById('hs-menubtn')),
      menuSize: (() => { const r = document.getElementById('hs-menubtn').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })(),
      nav: [...document.querySelectorAll('#hs-nav a')].filter(v).map((a) => a.textContent.trim()),
      expanded: document.getElementById('hs-menubtn').getAttribute('aria-expanded'),
      linkH: Math.min(...[...document.querySelectorAll('#hs-nav a')].map((a) => a.getBoundingClientRect().height || 99)),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  const c0 = await vis();
  ok(c0.logo && c0.share && c0.signin && c0.menu && c0.menuSize === '44x44' && c0.nav.length === 0, '7 ' + w + 'px: logo, Share, Sign in and a 44×44 Menu; nav closed', c0);
  await page.click('#hs-menubtn');
  const c1 = await vis();
  ok(JSON.stringify(c1.nav) === JSON.stringify(['Explore', 'Quality of Life Impact', 'Development Map', 'Activity', 'My Places', 'Enterprise', 'Enterprise overview', 'My reports']) && c1.expanded === 'true' && c1.linkH >= 44,
    '7 ' + w + 'px: the panel holds Explore (with its three pages under it), My Places, Enterprise (with its two pages under it) (44px targets)', c1);
  await page.keyboard.press('Escape');
  const c2 = await vis();
  ok(c2.nav.length === 0 && c2.expanded === 'false', '7 ' + w + 'px: Escape closes it', c2);
  await page.click('#hs-menubtn');
  await page.mouse.click(Math.round(w / 2), Math.round(h - 40));
  const c3 = await vis();
  ok(c3.nav.length === 0, '7 ' + w + 'px: a click outside closes it', c3);
  await page.click('#hs-menubtn');
  await page.evaluate(() => document.querySelector('#hs-nav a[data-nav="props"]').addEventListener('click', (e) => e.preventDefault(), { once: true }));
  await page.click('#hs-nav a[data-nav="props"]');
  const c4 = await vis();
  ok(c4.nav.length === 0, '7 ' + w + 'px: a nav click closes it', c4);
  ok(c0.overflow === 0, '7 ' + w + 'px: no horizontal overflow', c0.overflow);
  ok(errors.length === 0, '7 ' + w + 'px: no errors', errors);
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────── 8: signed in ──
console.log('--- 8. signed in with a saved Address: avatar, and Explore still stays put ---');
{
  const { ctx, page, errors } = await open(browser, base, '/index.html', { stub: Object.assign({}, STUB, {
    session: { user: { id: 'u1', email: 'res@example.com' }, access_token: 't' },
    properties: [{ id: 'h1', user_id: 'u1', address: '1 HI CIRCLE N', city: 'Horseshoe Bay', state: 'TX', zip: '78657', lat: 30.54, lng: -98.37, label: 'home' }]
  }) });
  await page.waitForTimeout(1200);
  const s = await page.evaluate(() => ({
    path: location.pathname,
    avatar: document.getElementById('hs-avatar').offsetParent !== null, avatarText: document.getElementById('hs-avatar').textContent,
    signin: document.getElementById('hs-signin').offsetParent !== null,
    onboarding: !document.getElementById('onboardingOverlay').hidden
  }));
  ok(s.path === '/index.html', '8 a signed-in resident with a saved Address stays on Explore', s.path);
  ok(s.avatar && !s.signin && s.avatarText === 'RE', '8 the account avatar replaces Sign in (never both)', s);
  ok(errors.length === 0, '8 no errors', errors);
  await ctx.close();
}

// ────────────────────────────────────────────────────── 9: Map 1's own embed and full page ──
console.log('--- 9. Map 1 embed hides the site chrome; preview needs embed ---');
{
  const { ctx, page } = await open(browser, base, '/homesignalmap.html?embed=1&zip=78657', { stub: STUB });
  const e = await page.evaluate(() => ({
    header: getComputedStyle(document.getElementById('hs-top')).display, footer: getComputedStyle(document.getElementById('hs-footer')).display,
    preview: document.documentElement.classList.contains('hs-preview')
  }));
  ok(e.header === 'none' && e.footer === 'none' && !e.preview, '9 the plain embed shows no site header or footer, and is not a preview', e);
  await ctx.close();
  const { ctx: c2, page: p2 } = await open(browser, base, '/homesignalmap.html?preview=1&zip=78657', { stub: STUB });
  const f = await p2.evaluate(() => ({
    preview: document.documentElement.classList.contains('hs-preview'), embed: document.documentElement.classList.contains('hs-embed'),
    header: getComputedStyle(document.getElementById('hs-top')).display, footers: document.querySelectorAll('footer').length,
    active: (document.querySelector('#hs-nav a.on') || {}).textContent
  }));
  ok(!f.preview && !f.embed && f.header !== 'none' && f.footers === 1 && f.active === 'Explore', '9 full-page Map 1 ignores preview=1 and keeps the header, footer and Explore', f);
  await c2.close();
}

await browser.close();
srv.close();
console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL PASS');
process.exit(fails ? 1 : 0);

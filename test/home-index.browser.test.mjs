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
//   4. A ZIP search stays on index.html, turns the map into the normal interactive embed,
//      rewrites both ZIP links, never asks HS.data.isCovered, and writes nothing.
//   5. An address search uses HS.resolveAddress once, loads the 2-mile address embed full
//      width, hides the ZIP-only column and links, and saves nothing; a failure says so and
//      leaves the page as it was.
//   6. A slow answer for an earlier search never overwrites a newer one.
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
  ok(h.footers === 1 && JSON.stringify(h.footLinks) === JSON.stringify(['How It Works=how-it-works.html', 'About=about.html', 'Contact=contact.html', 'Privacy=privacy.html', 'Terms=privacy.html#terms']),
    '1 exactly one footer: How It Works / About / Contact / Privacy / Terms', h);
  ok(!!h.footerBelowSlot, '1 the footer renders below the page content');
  ok(JSON.stringify(h.enterpriseLinks) === JSON.stringify(['Enterprise', 'Explore Enterprise →']), '1 the Enterprise message appears once (header item + hero card; no bottom banner)', h.enterpriseLinks);
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

  // ───────────────────────────────────────────────────────────────── 4: ZIP search ──
  console.log('--- 4. ZIP search: stays on index.html, read-only ---');
  const before = await ui(page);
  await search(page, '78657');
  await waitForMap(page, /homesignalmap\.html\?embed=1&zip=78657$/);
  await page.waitForTimeout(500);
  const z = await ui(page), zf = await frameInfo(page);
  ok(z.path === '/index.html' && z.search === '' && z.hash === '' && z.histLen === before.histLen, '4 still index.html, no query, no history entry', z);
  ok(zf.src === 'homesignalmap.html?embed=1&zip=78657' && !zf.sample && zf.tabindex === null && zf.pointer === 'auto' && zf.preview === false,
    '4 the map is the normal interactive embed (no preview, no lock, tabbable)', zf);
  ok(zf.title === 'Development map for ZIP 78657', '4 iframe title names the ZIP', zf.title);
  ok(zf.height === 760, '4 live map height is 760px at 1440px', zf.height);
  ok(z.heading === '78657 · Horseshoe Bay, TX', '4 heading is <ZIP> · <place>', z.heading);
  ok(z.cta === 'Open full development map →' && z.ctaHref === 'homesignalmap.html?zip=78657' && z.seeAll && z.seeAllHref === 'development.html?zip=78657',
    '4 "Open full development map →" and "See all development →" point at the searched ZIP', z);
  ok(z.records && z.names.length === 3, '4 the ZIP list is shown', z.names);
  ok(z.active === 'homeResultsHeading', '4 focus moves to the results heading', z.active);
  ok(z.coveredReads === 0, '4 HS.data.isCovered is never asked', z.coveredReads);
  ok(!z.locModalShown && z.writes.length === 0 && JSON.stringify(z.storage) === JSON.stringify(before.storage) && z.viewZip === null,
    '4 no follow, save, subscribe, coverage form, storage write or viewed-ZIP write', z);

  console.log('--- 4b. a ZIP whose list cannot be read, and one with no records ---');
  await search(page, '78701');
  await page.waitForFunction(() => /78701/.test(document.getElementById('homeMapFrame').getAttribute('src')));
  await page.waitForTimeout(400);
  const zf2 = await ui(page);
  ok(zf2.heading === 'ZIP 78701', '4b no place row: the heading is "ZIP <zip>"', zf2.heading);
  ok(zf2.note === 'Recent development list unavailable right now.' && zf2.names.length === 0, '4b an incomplete read shows the unavailable copy, never a 0', zf2);
  await search(page, '78702');
  await page.waitForTimeout(400);
  const zf3 = await ui(page);
  ok(zf3.note === 'No local permit/planning records to list here.', '4b a complete, empty read says so', zf3.note);

  // ─────────────────────────────────────────────────────────────── 5: address search ──
  console.log('--- 5. address search ---');
  const invokesBefore = (await ui(page)).invokes;
  await search(page, ADDR_OK);
  await waitForMap(page, /homesignalmap\.html\?embed=1&lat=30\.54&lng=-98\.37&radius=2$/);
  await page.waitForTimeout(400);
  const a = await ui(page), af = await frameInfo(page);
  const invoked = await page.evaluate(() => window.__invokes.slice(-1)[0]);
  ok(a.invokes === invokesBefore + 1 && invoked.fn === 'geocode-address' && invoked.address === ADDR_OK, '5 one geocode-address call, with the typed address', invoked);
  ok(af.src === 'homesignalmap.html?embed=1&lat=30.54&lng=-98.37&radius=2' && !af.sample && af.pointer === 'auto', '5 the 2-mile address embed, interactive', af.src);
  ok(af.title === 'Development within 2 miles of ' + MATCH.matchedAddress, '5 iframe title names the confirmed address', af.title);
  ok(a.heading === MATCH.matchedAddress && a.sub === 'Development within 2 miles of this address.', '5 heading is the confirmed address, with the exact subline', a);
  ok(!a.records && !a.seeAll && a.cta === null && a.ctaHref === null && a.seeAllHref === null && a.full,
    '5 full width; the ZIP list, "See all", and the full-map link are hidden, with no stale ZIP href', a);
  ok(a.writes.length === 0 && a.viewZip === null && JSON.stringify(a.storage) === JSON.stringify(before.storage) && a.path === '/index.html' && a.histLen === before.histLen,
    '5 nothing saved, no history entry', a);

  console.log('--- 5b. failures keep the page as it was; short input is caught before the geocoder ---');
  const kept = { src: af.src, heading: a.heading };
  for (const [addr, msg, label] of [
    [ADDR_NOMATCH, "We couldn't confirm that address against U.S. Census records — try a different spelling, or add the city or ZIP.", 'no_match'],
    [ADDR_OUTAGE, "The address service couldn't be reached — please try again in a minute.", 'unavailable'],
    [ADDR_BADPOINT, "We couldn't confirm a valid location for that address — try again or enter your ZIP code instead.", 'invalid_coords']
  ]) {
    await search(page, addr);
    await page.waitForFunction(() => !document.getElementById('homeSearchErr').hidden, null, { timeout: 10000 });
    const e = await ui(page), ef = await frameInfo(page);
    ok(e.err === msg && ef.src === kept.src && e.heading === kept.heading && !e.busy && e.ariaBusy === 'false',
      '5b ' + label + ': its message under the box; map, heading and links unchanged', { err: e.err, src: ef.src, heading: e.heading });
  }
  const nInv = (await ui(page)).invokes;
  await search(page, 'abc');
  const sh = await ui(page);
  ok(sh.err === 'Enter a 5-digit ZIP code, or a street address with its city or ZIP.' && sh.invokes === nInv, '5b too-short input: validation copy, no geocoder call', sh);

  console.log('--- 5c. mode switch: address -> ZIP brings back the ZIP column and links ---');
  await search(page, '78657');
  await waitForMap(page, /homesignalmap\.html\?embed=1&zip=78657$/);
  await page.waitForTimeout(300);
  const back = await ui(page);
  ok(back.records && back.seeAll && back.cta === 'Open full development map →' && back.ctaHref === 'homesignalmap.html?zip=78657'
     && back.seeAllHref === 'development.html?zip=78657' && !back.full && back.sub === null && back.err === null,
    '5c ZIP after address: list, both links (searched ZIP), half-width map, no subline, no error', back);

  // ───────────────────────────────────────────────────────────────────── 6: races ──
  console.log('--- 6. a slow earlier search never overwrites a newer one ---');
  await search(page, '78601');          // community + projects answers delayed 1.5 s
  await search(page, '78657');
  await page.waitForTimeout(2200);
  const race = await ui(page), racef = await frameInfo(page);
  ok(race.heading === '78657 · Horseshoe Bay, TX' && racef.src === 'homesignalmap.html?embed=1&zip=78657'
     && JSON.stringify(race.names) === JSON.stringify(PROJECTS_78657.slice(0, 3).map((p) => p.name)) && race.ctaHref === 'homesignalmap.html?zip=78657',
    '6 ZIP A (slow) then ZIP B: B\'s heading, map, records and links stand', race);
  await search(page, ADDR_SLOW);       // the resolver answers after 1.5 s
  const busy = await ui(page);
  ok(busy.busy && busy.ariaBusy === 'true', '6 the Search button is busy while the address resolves', busy);
  await page.evaluate(() => { document.getElementById('homeQuery').value = '78657'; document.getElementById('homeSearch').requestSubmit(); });
  await page.waitForTimeout(2200);
  const race2 = await ui(page), race2f = await frameInfo(page);
  ok(race2f.src === 'homesignalmap.html?embed=1&zip=78657' && race2.heading === '78657 · Horseshoe Bay, TX' && race2.records && !race2.full && !race2.busy,
    '6 a stale address answer does not replace the newer ZIP result', race2);

  ok(errors.length === 0, '1–6 no page or console errors across load and repeated searches', errors);
  await ctx.close();
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
  await search(page, '78657');
  await waitForMap(page, /embed=1&zip=78657$/);
  const lf = await frameInfo(page);
  ok(lf.height === live, '2b ' + w + 'x' + h + ': live map height ' + live + 'px', lf.height);
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
  ok(JSON.stringify(c1.nav) === JSON.stringify(['Explore', 'Quality of Life Impact', 'Development Map', 'Activity', 'My Places', 'Enterprise']) && c1.expanded === 'true' && c1.linkH >= 44,
    '7 ' + w + 'px: the panel holds Explore (with its three pages under it), My Places, Enterprise (44px targets)', c1);
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

// ─────────────────────────────────────────────────────────────── 11: reduced motion ──
console.log('--- 11. the results scroll is smooth, or instant under prefers-reduced-motion ---');
for (const [mode, want] of [['no-preference', 'smooth'], ['reduce', 'auto']]) {
  const { ctx, page } = await open(browser, base, '/index.html', { stub: STUB, reducedMotion: mode });
  await page.evaluate(() => {
    window.__scrolls = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (o) { window.__scrolls.push(o && o.behavior); return orig.call(this, o); };
  });
  await search(page, '78657');
  const got = await page.evaluate(() => window.__scrolls.slice(-1)[0]);
  ok(got === want, '11 ' + mode + ': scroll behavior ' + want, got);
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL PASS');
process.exit(fails ? 1 : 0);

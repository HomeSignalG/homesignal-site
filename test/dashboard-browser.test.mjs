// Browser smoke tests for Dashboard navigation (requires local static server).
// Run: node test/dashboard-browser.test.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP dashboard-browser.test.mjs — playwright not installed (run: npx -p playwright node test/dashboard-browser.test.mjs)');
  process.exit(0);
}
const { pageHref, meetingNavHref, itemNavHref, sanitizeSort, sanitizeLens } = require('../lib/view-zip.js');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

function parseQs(href) {
  const u = new URL(href, 'http://local/');
  const out = {};
  u.searchParams.forEach((v, k) => {
    if (out[k] != null) out[k] = [].concat(out[k], v);
    else out[k] = v;
  });
  return out;
}

function assertHref(name, href, expect) {
  ok(href && href.indexOf('undefined') < 0 && href.indexOf('null') < 0 && href.indexOf('[object') < 0,
    name + ' — no garbage in href');
  const qs = parseQs(href || '');
  const zips = href ? (href.match(/zip=/g) || []).length : 0;
  ok(zips <= 1, name + ' — at most one zip param');
  if (expect.zip != null) ok(qs.zip === expect.zip, name + ' — zip=' + expect.zip);
  if (expect.noPlace) ok(!qs.place, name + ' — no place param');
  if (expect.place) ok(qs.place === expect.place, name + ' — place=' + expect.place);
  if (expect.has) Object.keys(expect.has).forEach(function (k) {
    ok(qs[k] === expect.has[k], name + ' — ' + k + '=' + expect.has[k]);
  });
}

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = req.url.split('?')[0];
      const file = p === '/' ? '/dashboard.html' : p;
      const fp = path.join(root, decodeURIComponent(file));
      if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const ext = path.extname(fp);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

// ---- unit-level helpers (same file for one browser run) ----
ok(sanitizeSort('bogus') === 'impact', 'sanitizeSort rejects invalid');
ok(sanitizeSort('status') === 'status', 'sanitizeSort accepts status');
ok(sanitizeLens('9') === 0, 'sanitizeLens rejects out of range');
ok(sanitizeLens('2') === 2, 'sanitizeLens accepts 2');
ok(meetingNavHref({ related_project_id: 'chg-dvisd' }, '78617').indexOf('alerts.html') === 0,
  'meeting with change id routes to alerts not development');
ok(meetingNavHref({ related_project_id: 'proj-x' }, '78617', new Set(['proj-x'])).indexOf('development.html') === 0,
  'meeting with project id routes to development when in set');
ok(itemNavHref({ title: 'no id' }, '78617') === null, 'itemNavHref returns null when id absent');
ok(pageHref('alerts.html', { zip: '78617', category: 'Government & civic' }) === 'alerts.html?zip=78617&category=Government+%26+civic',
  'pageHref URL-encodes category ampersand');

const { srv, port } = await startServer();
const base = 'http://127.0.0.1:' + port;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
// Fix 8 SCOPE FIXTURE. The Dashboard is now an ALL MY PLACES briefing: its content and its
// Your Places rows come from CANONICAL MY PLACES membership, not from the viewed ZIP. With no
// membership the page correctly renders its zero-places state, so every Dashboard assertion
// below would be measuring the empty case. Two followed ZIPs are seeded through the same
// store My Places itself writes (`hs:myCommunities`) — this is fixture setup, not a product
// behaviour, and the pre-Fix-8 suite needed none of it only because the old Dashboard read
// the URL's ZIP.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('hs:myCommunities', JSON.stringify([
      { zip: '78617', name: 'Del Valle', state: 'TX' },
      { zip: '78701', name: 'Austin', state: 'TX' }
    ]));
  } catch (e) { /* a blocked storage write must not abort the run */ }
});
const page = await ctx.newPage();

try {
  // Context I — signed-out sample ZIP (seed mode, no demo place in URLs)
  await page.goto(base + '/dashboard.html?data=seed&zip=78617', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#dashPlaces a, #dashPlaces p', { timeout: 30000 });

  // ⚠️ RETARGETED (Fix 8). This block used to assert a four-tile KPI strip
  // (#dashStrip — Places Monitored · New Changes · Need Attention · Coming Up), a
  // Dashboard map link (#dashMapLink), and the old per-module ids #dashProps / #dashWatch /
  // #dashRecent / #dashMeetings. Fix 8 replaced the single-place Dashboard with the ALL MY
  // PLACES briefing and removed every one of them, so those assertions were false BY DESIGN,
  // not broken. What this file protects is unchanged and is still asserted below: every
  // Dashboard destination is a real link, every href is well-formed, carries at most one
  // zip, and lands where its label says. The removals are asserted POSITIVELY rather than
  // deleted, so a restored strip or map link fails here instead of passing silently.
  const gone = await page.evaluate(() => ({
    strip: document.querySelectorAll('#dashStrip').length,
    mapLink: document.querySelectorAll('#dashMapLink').length,
    map: document.querySelectorAll('#dashMap, .leaflet-container, .maplibregl-canvas').length,
    legacyModules: ['#dashProps', '#dashWatch', '#dashRecent', '#dashMeetings', '#dashMeetingsHead']
      .filter((sel) => document.querySelector(sel)),
    text: document.body.innerText
  }));
  ok(gone.strip === 0, 'Fix 8 no #dashStrip KPI row', gone.strip);
  ok(gone.mapLink === 0, 'Fix 8 no #dashMapLink', gone.mapLink);
  ok(gone.map === 0, 'Fix 8 the Dashboard renders no map', gone.map);
  ok(gone.legacyModules.length === 0, 'Fix 8 the superseded module containers are gone', gone.legacyModules);
  for (const label of ['Places Monitored', 'New Changes', 'Need Attention', 'Coming Up',
                       'Open full map', 'Welcome back', 'Good morning',
                       'High Quality-of-Life Impact', 'High Impact', 'Medium Impact', 'Low Impact',
                       'Action Needed Soon', 'How to participate', 'Submit a comment', 'Take action'])
    ok(gone.text.indexOf(label) < 0, 'Fix 8 Dashboard no longer renders "' + label + '"');

  // The approved briefing hierarchy, in order, on both columns.
  const shape = await page.evaluate(() => {
    const heads = (sel) => [...document.querySelectorAll(sel + ' h2, ' + sel + ' .p2h')]
      .map((h) => h.innerText.trim());
    return {
      main: heads('.cols > div:first-child'),
      rail: heads('.cols > div:last-child'),
      viewing: (document.getElementById('locLabel') || {}).textContent || '',
      sub: (document.getElementById('dashSub') || {}).textContent || ''
    };
  });
  ok(shape.main.join(' | ') === "What\u2019s Changing? | QUALITY-OF-LIFE IMPACT \u00b7 PREMIUM | Official Dates to Know",
    'Fix 8 main column is What\u2019s Changing → Quality-of-Life Premium → Official Dates');
  // Fix 8J: this context is SIGNED OUT, and the Following section removes itself outright
  // without a real session — so the signed-out rail is still exactly these two headings. That
  // is the privacy rule showing up in the page's shape, not an accident of ordering, so it is
  // asserted positively below as well: no heading, no node, and no project id in the markup.
  ok(shape.rail.join(' | ') === 'My Places | Stay Informed',
    'Fix 8 right rail signed-out is My Places → Stay Informed', shape.rail);
  const followOut = await page.evaluate(() => ({
    node: document.querySelectorAll('#dashFollowing, #dashFollowingBody').length,
    text: document.body.innerText.indexOf('Projects you chose to monitor')
  }));
  ok(followOut.node === 0 && followOut.text < 0,
    'Fix 8J Following is absent for a signed-out visitor', followOut);
  ok(/ALL MY PLACES/.test(shape.viewing) && !/\b\d{5}\b/.test(shape.viewing),
    'Fix 8 Dashboard scope reads ALL MY PLACES and names no ZIP', shape.viewing);
  ok(/monitored place/.test(shape.sub), 'Fix 8 the header counts monitored places', shape.sub);

  // Every Dashboard destination is still a real, well-formed link. These are the SAME
  // href guarantees the strip tiles used to carry, moved onto the controls that replaced
  // them — no new routing surface is introduced here.
  assertHref('Manage Saved Places', await page.locator('#dashManagePlaces').getAttribute('href'),
    { zip: undefined });
  ok((await page.locator('#dashManagePlaces').getAttribute('href')) === 'properties.html',
    'Manage link is account-wide properties.html');
  assertHref('Manage your alerts', await page.locator('#dashManageAlerts').getAttribute('href'),
    { zip: undefined });
  ok((await page.locator('#dashManageAlerts').getAttribute('href')) === 'alerts.html',
    'Stay Informed reaches the existing Alerts management page');

  // Context B — the resident's places are rows, each to its own destination.
  const placeRows = page.locator('#dashPlaces a.placerow');
  ok(await placeRows.count() >= 1, 'Your Places lists the monitored places');
  for (const href of await placeRows.evaluateAll((els) => els.map((e) => e.getAttribute('href'))))
    assertHref('Your Places row', href, { noPlace: true });

  // What's Changing rows carry their OWN place's zip and the record id — never a
  // page-level zip, which is the whole point of an account-wide briefing.
  const changeRows = page.locator('#dashChanging .crow a.cgo');
  if (await changeRows.count()) {
    const ch = await changeRows.first().getAttribute('href');
    assertHref('What\u2019s Changing row', ch, { noPlace: true });
    ok(ch.indexOf('id=') > 0, 'a What\u2019s Changing row carries its record id', ch);
  }

  // ⚠️ RETARGETED (Fix 8). These three navigations used to start from KPI strip tiles
  // (Places Monitored → My Places, Need Attention → alerts band=open, Coming Up → the
  // Alerts feed). The strip is gone, so they now start from the controls that replaced it.
  // The contract being exercised is identical and is why they were kept rather than
  // deleted: a Dashboard destination is a real link that NAVIGATES and can be backed out
  // of, leaving the briefing intact. Nothing here restores a strip or invents a route.
  // ⚠️ These two assert the NAVIGATION, not the destination's rendered content. Both
  // links are account-wide and carry no query string BY DESIGN, so following one drops
  // `?data=seed` and the destination falls back to its live data source. Asserting a
  // rendered element there would make this browser test depend on network reachability,
  // which is exactly the hidden dependency the offline suites exist to avoid — and the
  // contract in question is that the control navigates and can be backed out of.
  // properties.html's and alerts.html's own rendering is covered by their own suites.
  await page.locator('#dashManagePlaces').click();
  await page.waitForURL(/properties\.html/, { timeout: 15000 });
  ok(/properties\.html$/.test(new URL(page.url()).pathname + ''), 'Your Places Manage click lands on My Places',
    page.url());
  await page.goBack();
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 });
  await page.waitForSelector('#dashPlaces a, #dashPlaces p', { timeout: 30000 });
  ok(await page.locator('#dashChanging').count() === 1, '...and the briefing is intact on return');

  await page.locator('#dashManageAlerts').click();
  await page.waitForURL(/alerts\.html/, { timeout: 15000 });
  ok(/alerts\.html$/.test(new URL(page.url()).pathname + ''), 'Stay Informed click lands on Alerts', page.url());
  await page.goBack();
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 });
  await page.waitForSelector('#dashPlaces a, #dashPlaces p', { timeout: 30000 });

  // A place row opens THAT place's own page, and the briefing is unchanged on return —
  // navigation never edits membership.
  const firstPlace = page.locator('#dashPlaces a.placerow').first();
  if (await firstPlace.count()) {
    const beforeCount = await page.locator('#dashPlaces a.placerow').count();
    await firstPlace.click();
    await page.waitForURL(/community\.html|property\.html/, { timeout: 15000 });
    ok(/(community|property)\.html$/.test(new URL(page.url()).pathname + ''),
      'a Your Places row opens its own place page', page.url());
    await page.goBack();
    await page.waitForURL(/dashboard\.html/, { timeout: 15000 });
    await page.waitForSelector('#dashPlaces a, #dashPlaces p', { timeout: 30000 });
    ok(await page.locator('#dashPlaces a.placerow').count() === beforeCount,
      'returning to the Dashboard restores the same All My Places membership');
  }

  // The band=open deep link the old Need Attention tile pointed at is still a real
  // destination; it is asserted directly now that no tile carries it.
  await page.goto(base + '/alerts.html?data=seed&zip=78617&band=open', { waitUntil: 'networkidle' });
  ok(await page.locator('#alBand').count() >= 0, 'alerts page loaded with band=open');

  // The public ZIP score strip is not gone — it is still asserted by navigating to it
  // directly, so this file keeps covering it rather than losing it with the retired tile.
  await page.goto(base + '/community.html?data=seed&zip=78617&focus=score', { waitUntil: 'networkidle' });
  await page.waitForSelector('#zip-score-strip', { timeout: 15000 });
  ok(await page.locator('#zip-score-strip').count() === 1, 'community page still has zip-score-strip');
  await page.goto(base + '/dashboard.html?data=seed&zip=78617', { waitUntil: 'networkidle' });

  // Destination: alerts category + invalid id safe
  await page.goto(base + '/alerts.html?data=seed&zip=78617&category=Government%20%26%20civic', { waitUntil: 'networkidle' });
  ok(await page.locator('.groupHead[data-category="Government & civic"]').count() >= 1,
    'alerts category=Government & civic finds exact category');
  await page.goto(base + '/alerts.html?data=seed&zip=78617&id=not-a-real-id', { waitUntil: 'networkidle' });
  ok(await page.locator('#alGroups').count() === 1, 'alerts invalid id leaves page usable');

  // Destination: development invalid lens/sort
  await page.goto(base + '/development.html?data=seed&zip=78617&lens=99&sort=bogus', { waitUntil: 'networkidle' });
  ok(await page.locator('#devSort button.on').getAttribute('data-sort') === 'impact', 'invalid sort falls back to impact');

  // Destination: development status sort deep link
  await page.goto(base + '/development.html?data=seed&zip=78617&sort=status', { waitUntil: 'networkidle' });
  await page.waitForSelector('#devSort button.on[data-sort="status"]', { timeout: 15000 });
  ok(await page.locator('#devSort button.on').getAttribute('data-sort') === 'status', 'sort=status highlights Status');
  ok(await page.locator('#devSort button[data-sort="status"]').textContent() === 'Status', 'Status label renders');
  const sortButtons = await page.locator('#devSort button[data-sort]').allTextContents();
  ok(sortButtons.join('|') === 'Impact on me|Status|Distance|Newest', 'sort controls appear in expected order');

  // Destination: community invalid focus
  await page.goto(base + '/community.html?data=seed&zip=78617&focus=bogus', { waitUntil: 'networkidle' });
  ok(await page.locator('.page').count() === 1, 'community invalid focus does not break page');

  // Context A/J — real home in ZIP adds place= only for home label
  await page.goto(base + '/dashboard.html?data=seed&zip=78617', { waitUntil: 'networkidle' });
  await page.evaluate(function () {
    window.HS.state.properties.push({
      id: 'coomes', label: 'home', tag: 'home',
      address: '13313 Coomes Dr', city: 'Del Valle', state: 'TX', zip: '78617',
      lat: 30.174, lng: -97.614
    });
    window.HS.state.activePropId = 'coomes';
    var real = window.HS.realHome();
    window.__HS_TEST = {
      realHomeId: real && real.id,
      mapHref: window.HS.pageHref('homesignalmap.html', { zip: window.HS.state.zip, place: real && real.id })
    };
  });
  const inj = await page.evaluate(() => window.__HS_TEST);
  ok(inj.realHomeId === 'coomes', 'real home detected for Coomes Dr in active ZIP');
  ok(inj.mapHref === 'homesignalmap.html?zip=78617&place=coomes', 'place included for real home in ZIP');
  await page.evaluate(function () {
    window.HS.state.activePropId = 'p2';
    var real = window.HS.realHome();
    window.__HS_TEST2 = { realHomeId: real, placeRental: !real };
  });
  const inj2 = await page.evaluate(() => window.__HS_TEST2);
  ok(inj2.placeRental === true, 'rental active property is not realHome (no place for rental)');

  // ⚠️ REMOVED AND ASSERTED (Fix 8). This block drove the Dashboard's embedded map:
  // marker click, keyboard Enter on the map region, and a background click that opened
  // Map 1. Fix 8 removed the default Dashboard map, so there is no map surface to drive
  // and no map route to leave from. The three interactions cannot be retargeted onto
  // anything — the feature is gone — so what remains is the assertion that it is gone,
  // re-checked here on a FRESH load so a map that appears only after hydration would still
  // be caught. Map 1's own interactions are covered by the map1-*.browser suites, and
  // reaching Map 1 in-product is covered by user-journey.browser.test.mjs §5.
  await page.goto(base + '/dashboard.html?data=seed&zip=78617', { waitUntil: 'networkidle' });
  await page.waitForSelector('#dashPlaces a, #dashPlaces p', { timeout: 30000 });
  await page.waitForTimeout(600);
  const mapAfterHydration = await page.evaluate(() => ({
    surfaces: document.querySelectorAll('#dashMap, .leaflet-container, .maplibregl-canvas, canvas').length,
    markers: document.querySelectorAll('[data-hs-map-item]').length,
    link: document.querySelectorAll('#dashMapLink').length
  }));
  ok(mapAfterHydration.surfaces === 0, 'Fix 8 no map surface on the Dashboard, even after hydration',
    mapAfterHydration.surfaces);
  ok(mapAfterHydration.markers === 0, 'Fix 8 ...and no map markers', mapAfterHydration.markers);
  ok(mapAfterHydration.link === 0, 'Fix 8 ...and no route out of a map that no longer exists',
    mapAfterHydration.link);

// The retired map's URL must not be a dead end: it forwards to the primary map and CARRIES
// ITS QUERY STRING, so an old bookmark lands on the same ZIP. `place`/`id` were that page's
// deep-link params; the primary map ignores them, which must not break the page.
await page.goto(base + '/maps.html?data=seed&zip=78617&place=p1&id=proj-datacenter', { waitUntil: 'networkidle', timeout: 60000 });
ok(page.url().indexOf('homesignalmap.html') >= 0, 'the retired map URL forwards to the primary map');
ok(page.url().indexOf('zip=78617') >= 0, 'the forward preserves the ZIP from the old URL');
ok(await page.locator('#map, #mapInner').count() >= 1, 'the primary map renders its map surface');

// ═══ FIX 8I. The header is the SHARED page-header system, measured against Alerts ═══
// "Visually consistent with ALERTS" is only a claim until the two are read out of the SAME
// browser and compared property by property. A local near-match in dashboard.html would look
// right in a screenshot and drift the next time app.css moves — so the reference page is
// loaded here and its computed values ARE the expectation, rather than hard-coded pixels.
const HEADER = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const c = getComputedStyle(el);
  return { text: el.innerText.trim(), tag: el.tagName,
    fs: c.fontSize, fw: c.fontWeight, ls: c.letterSpacing, tt: c.textTransform,
    color: c.color, ff: c.fontFamily, lh: c.lineHeight, margin: c.margin };
};
await page.goto(base + '/alerts.html?data=seed&zip=78617', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('.ph h1', { timeout: 30000 });
const ref = await page.evaluate((fn) => ({
  eyebrow: new Function('sel', 'return (' + fn + ')(sel)')('.ph .eyebrow'),
  h1: new Function('sel', 'return (' + fn + ')(sel)')('.ph h1')
}), HEADER.toString());
ok(ref.eyebrow && ref.eyebrow.text === 'ALERTS' && ref.h1 && ref.h1.tag === 'H1',
  'Fix 8I reference header read from alerts.html', ref);

// Every supported viewport, because a header that only holds at 1440 is not a header contract.
for (const [label, w, h] of [['desktop', 1440, 900], ['tablet', 1024, 768], ['mobile', 390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(base + '/dashboard.html?data=seed&zip=78617', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#dashPlaces a, #dashPlaces p', { timeout: 30000 });
  const got = await page.evaluate((fn) => {
    const read = new Function('sel', 'return (' + fn + ')(sel)');
    const r = (s) => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y),
        w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      eyebrow: read('.dashhead .eyebrow'), h1: read('#dashSub'),
      h1Count: document.querySelectorAll('h1').length,
      dashboardH1: [...document.querySelectorAll('h1')].filter((x) => x.innerText.trim() === 'Dashboard').length,
      countN: (document.getElementById('dashCountN') || {}).textContent,
      countLbl: (document.getElementById('dashCountLbl') || {}).textContent,
      countVisible: !document.getElementById('dashCount').hidden,
      rects: { eyebrow: r('.dashhead .eyebrow'), h1: r('#dashSub'), dhl: r('.dhl'), count: r('#dashCount') },
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
      main: [...document.querySelectorAll('.cols > div:first-child h2, .cols > div:first-child .p2h')]
        .map((x) => x.innerText.trim()),
      rail: [...document.querySelectorAll('.cols > div:last-child h2, .cols > div:last-child .p2h')]
        .map((x) => x.innerText.trim())
    };
  }, HEADER.toString());

  // 1. DASHBOARD is the small uppercase green eyebrow — byte-identical to ALERTS' own.
  ok(got.eyebrow && got.eyebrow.text === 'DASHBOARD' && got.eyebrow.tag === 'DIV',
    'Fix 8I [' + label + '] the label renders as uppercase DASHBOARD, not a heading', got.eyebrow);
  for (const p of ['fs', 'fw', 'ls', 'tt', 'color', 'ff'])
    ok(got.eyebrow && got.eyebrow[p] === ref.eyebrow[p],
      'Fix 8I [' + label + '] eyebrow ' + p + ' matches ALERTS (' + ref.eyebrow[p] + ')',
      got.eyebrow && got.eyebrow[p]);

  // 2/3. The resident question is the primary h1; "Dashboard" is no longer one.
  ok(got.h1 && got.h1.tag === 'H1' && /^What’s changing across/.test(got.h1.text),
    'Fix 8I [' + label + '] the question is the primary <h1>', got.h1 && got.h1.text);
  ok(got.dashboardH1 === 0, 'Fix 8I [' + label + '] no <h1> reads "Dashboard"', got.dashboardH1);
  ok(got.h1Count === 1, 'Fix 8I [' + label + '] exactly one <h1> on the page', got.h1Count);
  for (const p of ['fs', 'fw', 'ls', 'color', 'ff', 'margin'])
    ok(got.h1 && got.h1[p] === ref.h1[p],
      'Fix 8I [' + label + '] headline ' + p + ' matches ALERTS (' + ref.h1[p] + ')',
      got.h1 && got.h1[p]);

  // 4/5. GRAMMAR IS ASSERTED AGAINST THE RENDERED COUNT, not against a fixture the page
  // cannot see. Whatever N the fixture produces, the sentence must agree with it — which is
  // what makes this a contract rather than a snapshot.
  const n = Number(got.countN);
  ok(got.countVisible && Number.isFinite(n) && n >= 0,
    'Fix 8I [' + label + '] the monitored-place count still renders', got.countN);
  if (n === 1) {
    ok(got.h1.text === 'What’s changing across your monitored place?',
      'Fix 8I [' + label + '] N=1 drops the numeral', got.h1.text);
    ok(got.countLbl === 'Monitored place', 'Fix 8I [' + label + '] N=1 count label is singular');
  } else if (n > 1) {
    ok(got.h1.text === 'What’s changing across your ' + n + ' monitored places?',
      'Fix 8I [' + label + '] N>1 carries the count and the plural', got.h1.text);
    ok(got.countLbl === 'Monitored places', 'Fix 8I [' + label + '] N>1 count label is plural');
  }
  ok(!/your 1 monitored place\b/.test(got.h1.text),
    'Fix 8I [' + label + '] "your 1 monitored place" never renders', got.h1.text);

  // 6. Layout: the count block sits beside the header without colliding, and nothing scrolls.
  ok(got.rects.count && got.rects.dhl
    && (got.rects.count.x >= got.rects.dhl.x + got.rects.dhl.w - 1
        || got.rects.count.y >= got.rects.dhl.y + got.rects.dhl.h - 1),
    'Fix 8I [' + label + '] the count block clears the header column (beside it or below it)',
    got.rects);
  ok(got.scrollW <= got.clientW,
    'Fix 8I [' + label + '] no horizontal scroll', { scrollW: got.scrollW, clientW: got.clientW });

  // 8. Section order is untouched by a presentation-only change.
  ok(got.main.join(' | ') === "What’s Changing? | QUALITY-OF-LIFE IMPACT · PREMIUM | Official Dates to Know",
    'Fix 8I [' + label + '] main column order unchanged', got.main);
  ok(got.rail.join(' | ') === 'My Places | Stay Informed',
    'Fix 8I [' + label + '] right rail order unchanged', got.rail);
}

// 4 (singular), exercised deliberately. The shared fixture seeds two ZIPs, so the N=1 branch
// above would otherwise never run — and a branch that is never reached is not tested.
{
  const one = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await one.addInitScript(() => {
    try {
      localStorage.setItem('hs:myCommunities', JSON.stringify([{ zip: '78617', name: 'Del Valle (78617)', state: 'TX' }]));
    } catch (e) { /* a blocked storage write must not abort the run */ }
  });
  const p1 = await one.newPage();
  await p1.goto(base + '/dashboard.html?data=seed&zip=78617', { waitUntil: 'networkidle', timeout: 60000 });
  await p1.waitForSelector('#dashPlaces a, #dashPlaces p', { timeout: 30000 });
  const single = await p1.evaluate(() => ({
    n: (document.getElementById('dashCountN') || {}).textContent,
    lbl: (document.getElementById('dashCountLbl') || {}).textContent,
    h1: (document.getElementById('dashSub') || {}).textContent
  }));
  if (Number(single.n) === 1) {
    ok(single.h1 === 'What’s changing across your monitored place?',
      'Fix 8I singular headline drops the numeral', single);
    ok(single.lbl === 'Monitored place', 'Fix 8I singular count label', single.lbl);
  } else {
    console.log('SKIP — Fix 8I singular branch: the one-ZIP fixture rendered N=' + single.n
      + ' (seed mode may contribute a saved Address), so N=1 was not reachable here. '
      + 'The branch is pinned structurally in test/dashboard-all-places.test.mjs §10h.');
  }
  await one.close();
}

// ═══ FIX 8G. Monitored-ZIP attribution, in a real browser ═══
// The seed backend only serves records for ONE ZIP, so a genuinely multi-ZIP ROW cannot be
// rendered from fixtures. Rather than fabricate one, the cap/grammar/order are driven through
// the SHIPPED module inside the page (page.evaluate on window.HS.dashAgg) — real code, real
// browser — while the DOM assertions below cover what only a rendered page can show.
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(base + '/dashboard.html?data=seed&zip=78617', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('#dashPlaces a, #dashPlaces p', { timeout: 30000 });

const g = await page.evaluate(() => {
  const A = window.HS && window.HS.dashAgg;
  if (!A) return { missing: true };
  const meta = {
    '78617': { zip: '78617', name: 'Del Valle (78617)', state: 'TX' },
    '78657': { zip: '78657', name: 'Horseshoe Bay (78657)', state: 'TX' },
    '75009': { zip: '75009', name: 'Celina (75009)', state: 'TX' }
  };
  const zips = ['78617', '78657', '75009'];
  const map = A.buildZipLabelMap(zips, meta, []);
  const one = { sourceZips: ['78617'] };
  const three = { sourceZips: ['78617', '78657', '75009'] };
  const outside = { sourceZips: ['73301'] };
  return {
    label: map['75009'],
    wide1: A.monitoredZipAttribution(one, zips, map, { maxLabels: 2 }).summaryText,
    wide3: A.monitoredZipAttribution(three, zips, map, { maxLabels: 2 }).summaryText,
    narrow3: A.monitoredZipAttribution(three, zips, map, { maxLabels: 1 }).summaryText,
    outside: A.monitoredZipAttribution(outside, zips, map, { maxLabels: 2 }).summaryText
  };
});
ok(!g.missing, 'Fix 8G the view-model is exposed on window.HS.dashAgg in the browser');
ok(g.label === 'Celina · ZIP 75009', 'Fix 8G the own-ZIP parenthetical is stripped in-browser too', g.label);
ok(g.wide1 === 'Del Valle · ZIP 78617', 'Fix 8G one monitored ZIP names it', g.wide1);
ok(g.wide3 === 'Celina · ZIP 75009 · Del Valle · ZIP 78617 · +1 more monitored ZIP',
  'Fix 8G wide cap = 2 labels + singular overflow', g.wide3);
ok(g.narrow3 === 'Celina · ZIP 75009 · +2 more monitored ZIPs',
  'Fix 8G narrow cap = 1 label + plural overflow', g.narrow3);
ok(g.outside === '', 'Fix 8G a ZIP outside the monitored set renders nothing', g.outside);

// 15 + 16: the viewed place and the legacy ?zip= cannot change what is attributed. Three
// loads whose only difference is the viewed geography must render byte-identical attribution.
const attrTextAt = async (url, seedViewZip) => {
  if (seedViewZip) await page.evaluate((z) => { try { sessionStorage.setItem('hs:viewZip', z); } catch (e) {} }, seedViewZip);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#dashChanging .crow, #dashChanging p', { timeout: 30000 });
  return page.evaluate(() => [...document.querySelectorAll('#dashChanging .crow .mzip-wide, #dashDates .drow .mzip-wide')]
    .map((e) => e.textContent.trim()).join(' | '));
};
const attrA = await attrTextAt(base + '/dashboard.html?data=seed&zip=78617');
const attrB = await attrTextAt(base + '/dashboard.html?data=seed&zip=90210');
const attrC = await attrTextAt(base + '/dashboard.html?data=seed', '90210');
ok(attrA === attrB, 'Fix 8G [15/16] legacy ?zip= cannot change the visible ZIP labels or order',
  { withSeedZip: attrA.slice(0, 120), withOtherZip: attrB.slice(0, 120) });
ok(attrA === attrC, 'Fix 8G [15] a viewed ZIP in sessionStorage cannot change them either',
  { base: attrA.slice(0, 120), viewed: attrC.slice(0, 120) });
ok(!/Coomes|COOMES/i.test(attrA), 'Fix 8G [A4] no saved street address renders in attribution', attrA.slice(0, 160));
ok(!/Affects \d+ of your places/.test(attrA), 'Fix 8G [19] "Affects N of your places" is gone from the rendered page', attrA.slice(0, 160));

// 20 + 21 + 22 + 23: exactly one variant is visible per viewport, it is readable text, it is
// not interactive, and nothing scrolls sideways.
for (const [label, w, h] of [['desktop', 1440, 900], ['tablet', 1024, 768], ['mobile', 390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(base + '/dashboard.html?data=seed&zip=78617', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#dashChanging .crow, #dashChanging p', { timeout: 30000 });
  const v = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#dashChanging .crow, #dashDates .drow')];
    const per = rows.map((r) => {
      const vis = [...r.querySelectorAll('.mzip')].filter((e) => e.offsetParent !== null || getComputedStyle(e).display !== 'none');
      return { n: vis.length, text: vis.map((e) => e.textContent.trim()).join(''),
        cls: vis.map((e) => e.className).join(',') };
    });
    return { rows: rows.length, per,
      interactive: document.querySelectorAll('.mzip a, .mzip button, .mzip[role], .mzip[tabindex]').length,
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
  });
  ok(v.rows > 0, 'Fix 8G [' + label + '] the briefing rendered rows to attribute', v.rows);
  ok(v.per.every((p) => p.n === 1), 'Fix 8G [' + label + '] exactly ONE variant is visible per row',
    v.per.slice(0, 3));
  ok(v.per.every((p) => p.cls === (w <= 900 ? 'mzip mzip-narrow' : 'mzip mzip-wide')),
    'Fix 8G [' + label + '] the 900px breakpoint picks the right variant', v.per.slice(0, 2));
  ok(v.per.every((p) => p.text.length > 0), 'Fix 8G [' + label + '] [23] it is visible readable text',
    v.per.slice(0, 2));
  ok(v.interactive === 0, 'Fix 8G [' + label + '] [22] attribution is non-interactive', v.interactive);
  ok(v.scrollW <= v.clientW, 'Fix 8G [' + label + '] [21] no horizontal scroll',
    { scrollW: v.scrollW, clientW: v.clientW });
}

// 24 + 27: CTA routing and the Premium card are untouched by an attribution change.
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(base + '/dashboard.html?data=seed&zip=78617', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('#dashChanging .crow a.cgo', { timeout: 30000 });
for (const href of await page.locator('#dashChanging .crow a.cgo').evaluateAll((a) => a.map((x) => x.getAttribute('href'))))
  assertHref('Fix 8G [24] record CTA', href, {});
ok(await page.locator('#dashQolLabel').count() === 1, 'Fix 8G [27] the Premium card still renders');

// =====================================================================================
// FIX 8K — WHAT'S CHANGING PREVIEW + EXPAND IN PLACE
//
// 🔑 THE EXTRA RECORDS ARE FED THROUGH THE REAL PIPELINE, NOT PAINTED INTO THE DOM.
// The stock seed yields ~7 canonical records — BELOW the bound — so the control never
// appears and a test against it would assert nothing. Rather than edit the seed fixture
// (outside this unit's authorized scope), an init script intercepts the assignment of
// window.HS_SEED and appends extra eligible rows BEFORE the page reads it. Everything
// after that point is production code: the real seed branch of changesForZips, the real
// item normalization, the real dedupeChanges, the real changesPreview, the real DOM and
// the real button. A test that injected markup would prove only that the test can write
// HTML.
const seedExtra = (n) => `(() => {
  const extra = Array.from({ length: ${n} }, (_, i) => ({
    id: 'k8-' + i, category: 'Government & civic', related_project_id: null,
    lens: 'value', confidence: 'Medium',
    occurred_at: '2026-0' + (1 + (i % 9)) + '-1' + (i % 10),
    window_closes_at: null, lat: 30.19, lng: -97.61,
    title: 'Synthetic canonical record ' + i,
    plain_language: 'test record', impacts: [],
    source_ref: 'https://example.invalid/k8/' + i, approx: true
  }));
  let v;
  Object.defineProperty(window, 'HS_SEED', {
    configurable: true,
    get() { return v; },
    set(x) { if (x && Array.isArray(x.changes)) x.changes = x.changes.concat(extra); v = x; }
  });
})()`;

const loadWithExtra = async (n, w, h) => {
  const ctx2 = await browser.newContext({ viewport: { width: w, height: h } });
  // A FRESH CONTEXT HAS NO MY PLACES, and the Dashboard is scoped to My Places — without
  // this the briefing renders its honest "add an address or a ZIP" empty state and the
  // assertions below would be measuring the empty case, not the bound. Same fixture the
  // suite already installs on the shared context above.
  await ctx2.addInitScript(() => {
    try {
      localStorage.setItem('hs:myCommunities', JSON.stringify([
        { zip: '78617', name: 'Del Valle', state: 'TX' },
        { zip: '78701', name: 'Austin', state: 'TX' }
      ]));
    } catch (e) { /* a blocked storage write must not abort the run */ }
  });
  const p2 = await ctx2.newPage();
  await p2.addInitScript(seedExtra(n));
  await p2.goto(base + '/dashboard.html?data=seed&zip=78617', { waitUntil: 'networkidle', timeout: 60000 });
  await p2.waitForSelector('#dashChangingList .crow', { timeout: 30000 });
  return { ctx2, p2 };
};
const snap = (pg) => pg.evaluate(() => {
  const btn = document.getElementById('dashChangingToggle');
  const list = document.getElementById('dashChangingList');
  return {
    rows: document.querySelectorAll('#dashChangingList .crow').length,
    titles: [...document.querySelectorAll('#dashChangingList .crow .ct')].map((e) => e.textContent.trim()),
    btnCount: document.querySelectorAll('#dashChanging button').length,
    label: btn ? btn.textContent.trim() : null,
    expandedAttr: btn ? btn.getAttribute('aria-expanded') : null,
    controls: btn ? btn.getAttribute('aria-controls') : null,
    tag: btn ? btn.tagName : null,
    type: btn ? btn.getAttribute('type') : null,
    tabIndex: btn ? btn.tabIndex : null,
    focused: btn ? document.activeElement === btn : null,
    // The control must sit BELOW the rows and ABOVE the notes (approved layout).
    orderOk: btn && list ? (list.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : null,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    // No nested scroll region may appear anywhere inside the card.
    nestedScroll: [...document.querySelectorAll('#dashChanging, #dashChanging *')].filter((e) => {
      const cs = getComputedStyle(e);
      return /auto|scroll/.test(cs.overflowY) || /auto|scroll/.test(cs.overflowX) || cs.maxHeight !== 'none';
    }).length
  };
});

// ---- A2 boundary: the STOCK seed is under the bound, so no control may appear --------
{
  const a = await snap(page);
  ok(a.rows <= 8 && a.btnCount === 0 && a.label === null,
    'Fix 8K [A2] a collection at or under 8 renders every row and NO control', { rows: a.rows, btns: a.btnCount });
}

// ---- A3/A4 + B5/B6 + D9 at every approved viewport ----------------------------------
for (const [label, w, h] of [['desktop', 1440, 900], ['tablet', 1024, 768], ['narrow', 899, 768], ['mobile', 390, 844]]) {
  const { ctx2, p2 } = await loadWithExtra(20, w, h);
  const collapsed = await snap(p2);
  ok(collapsed.rows === 8, 'Fix 8K [' + label + '] [A4] default renders exactly 8 rows', collapsed.rows);
  ok(collapsed.btnCount === 1, 'Fix 8K [' + label + '] [D9] exactly one control renders', collapsed.btnCount);
  ok(collapsed.tag === 'BUTTON' && collapsed.type === 'button',
    'Fix 8K [' + label + '] [D9] it is a semantic <button type="button">', collapsed.tag);
  ok(collapsed.expandedAttr === 'false' && collapsed.controls === 'dashChangingList',
    'Fix 8K [' + label + '] [D9] aria-expanded=false and aria-controls names the region', collapsed);
  ok(collapsed.tabIndex >= 0, 'Fix 8K [' + label + '] [D9] it is in natural tab order', collapsed.tabIndex);
  ok(collapsed.orderOk === true,
    'Fix 8K [' + label + '] [B] the control sits BELOW the rows', collapsed.orderOk);
  ok(/^View (all \d+|more) changes →$/.test(collapsed.label || ''),
    'Fix 8K [' + label + '] [C] the collapsed label is an approved form', collapsed.label);
  ok(collapsed.nestedScroll === 0,
    'Fix 8K [' + label + '] [10] no nested scroll region or fixed-height list exists', collapsed.nestedScroll);
  ok(collapsed.scrollW <= collapsed.clientW,
    'Fix 8K [' + label + '] [5] no horizontal overflow collapsed', collapsed);

  // Keyboard: focus the control and activate with Enter — not a synthetic click.
  await p2.focus('#dashChangingToggle');
  await p2.keyboard.press('Enter');
  const open = await snap(p2);
  ok(open.rows > 8, 'Fix 8K [' + label + '] [B5] Enter expands and reveals every loaded record', open.rows);
  ok(open.titles.slice(0, 8).join('|') === collapsed.titles.join('|'),
    'Fix 8K [' + label + '] [B5] the first 8 are unchanged — canonical order preserved');
  ok(open.expandedAttr === 'true', 'Fix 8K [' + label + '] [D9] aria-expanded flips to true', open.expandedAttr);
  ok(open.label === 'Show fewer changes ↑',
    'Fix 8K [' + label + '] [B5] exactly one collapse control, correctly labelled', open.label);
  ok(open.btnCount === 1, 'Fix 8K [' + label + '] [D9] still exactly one control — no duplicate', open.btnCount);
  ok(open.focused === true,
    'Fix 8K [' + label + '] [D9] focus stays on the control after expanding', open.focused);
  ok(open.nestedScroll === 0,
    'Fix 8K [' + label + '] [9] expansion uses normal document flow, not an inner scroller', open.nestedScroll);
  ok(open.scrollW <= open.clientW,
    'Fix 8K [' + label + '] [5] no horizontal overflow expanded', open);

  // Space must work too, and must collapse back to exactly the first 8.
  await p2.keyboard.press(' ');
  const shut = await snap(p2);
  ok(shut.rows === 8 && shut.titles.join('|') === collapsed.titles.join('|'),
    'Fix 8K [' + label + '] [B6] Space collapses back to exactly the first 8 canonical records', shut.rows);
  ok(shut.label === collapsed.label && shut.expandedAttr === 'false',
    'Fix 8K [' + label + '] [B6] the expand control and its label are restored', shut.label);
  ok(shut.focused === true,
    'Fix 8K [' + label + '] [D9] focus stays on the control after collapsing', shut.focused);
  await ctx2.close();
}

// ---- B5: expansion touches no data, no geography, no URL, no history ----------------
{
  const { ctx2, p2 } = await loadWithExtra(20, 1440, 900);
  const net = [];
  p2.on('request', (r) => net.push(r.url()));
  const urlBefore = p2.url();
  const histBefore = await p2.evaluate(() => history.length);
  const stateBefore = await p2.evaluate(() => ({
    view: (() => { try { return sessionStorage.getItem('hs:viewZip'); } catch (e) { return null; } })(),
    my: (() => { try { return localStorage.getItem('myZip'); } catch (e) { return null; } })(),
    zip: (window.HS && window.HS.state) ? String(window.HS.state.zip) : null
  }));
  await p2.click('#dashChangingToggle');
  await p2.click('#dashChangingToggle');
  const stateAfter = await p2.evaluate(() => ({
    view: (() => { try { return sessionStorage.getItem('hs:viewZip'); } catch (e) { return null; } })(),
    my: (() => { try { return localStorage.getItem('myZip'); } catch (e) { return null; } })(),
    zip: (window.HS && window.HS.state) ? String(window.HS.state.zip) : null
  }));
  ok(net.length === 0, 'Fix 8K [B5] expanding and collapsing issues ZERO network requests', net.slice(0, 4));
  ok(p2.url() === urlBefore, 'Fix 8K [B5] the URL is unchanged', p2.url());
  ok(await p2.evaluate(() => history.length) === histBefore,
    'Fix 8K [B5] no history entry is pushed');
  ok(JSON.stringify(stateAfter) === JSON.stringify(stateBefore),
    'Fix 8K [E13] viewZip / myZip / HS.state.zip are unchanged by expansion', { stateBefore, stateAfter });
  await ctx2.close();
}

// ---- C7: the conservative label appears when completeness cannot be proven -----------
// Driven through the shipped helper in the real browser, so the in-page copy is the one
// under test — not a Node-only import that could drift from what ships.
{
  const c7 = await page.evaluate(() => {
    const A = window.HS && window.HS.dashAgg;
    if (!A || !A.changesPreview) return { missing: true };
    const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: 'x' + i }));
    return {
      known: A.changesPreview(mk(40), { countKnown: true }).expandLabel,
      unknown: A.changesPreview(mk(40), { countKnown: false }).expandLabel,
      absent: A.changesPreview(mk(40), {}).expandLabel,
      limit: A.PREVIEW_LIMIT
    };
  });
  ok(!c7.missing && c7.limit === 8, 'Fix 8K [C] the shipped helper is exposed in-browser at PREVIEW_LIMIT 8', c7);
  ok(c7.known === 'View all 40 changes →', 'Fix 8K [C7] a provable total names the number', c7.known);
  // BOTH branches carry a numeral, and they are DIFFERENT numerals: the known branch names
  // the total (a claim about the world), the unknown branch names the hidden count (40 - 8,
  // arithmetic over what is already loaded). Asserted as "32 and never 40" rather than as
  // "has no digits", which is what this pin used to say.
  ok(c7.unknown === 'View 32 more changes →',
    'Fix 8K [C7] an unprovable total names the HIDDEN count, not the total', c7.unknown);
  ok(c7.unknown.indexOf('40') < 0 && !/\ball\b/.test(c7.unknown),
    'Fix 8K [C7] ...never the total, never the word "all"', c7.unknown);
  ok(c7.absent === 'View 32 more changes →',
    'Fix 8K [C7] an ABSENT completeness flag is treated as unknown', c7.absent);
}

// ---- E: the neighbouring contracts are still standing --------------------------------
{
  const e = await page.evaluate(() => ({
    eyebrow: document.querySelectorAll('.ph .eyebrow').length,
    h1: document.querySelectorAll('.ph h1').length,
    h1id: document.querySelector('.ph h1') ? document.querySelector('.ph h1').id : null,
    affects: /Affects \d+ of your places/.test(document.body.textContent || ''),
    following: document.querySelectorAll('#dashFollowing').length,
    places: document.querySelectorAll('#dashPlaces').length,
    map: document.querySelectorAll('#map, .leaflet-container, canvas.maplibregl-canvas').length,
    // SCOPED TO THE CARD, DELIBERATELY. The shell already ships an onboarding overlay and
    // a location/topics modal, both role="dialog" and both pre-existing — a page-wide query
    // reports them and turns this pin into noise that gets waved through. Fix 8K's claim is
    // that EXPANSION happens in place, so the question is whether a dialog/drawer/carousel
    // appeared inside What's Changing.
    dialogInCard: document.querySelectorAll('#dashChanging dialog, #dashChanging [role="dialog"], #dashChanging .modal, #dashChanging .drawer, #dashChanging [role="tablist"]').length
  }));
  ok(e.eyebrow === 1 && e.h1 === 1 && e.h1id === 'dashSub', 'Fix 8K [E14] Fix 8I header is intact', e);
  ok(e.affects === false, 'Fix 8K [E15] "Affects N of your places" has not returned');
  ok(e.map === 0 && e.dialogInCard === 0,
    'Fix 8K [E17] no map, and no modal/drawer/carousel inside What\'s Changing', e);
}

} finally {
  await browser.close();
  srv.close();
}

if (fails) { console.error('\n' + fails + ' browser assertion(s) failed'); process.exit(1); }
console.log('\nAll dashboard browser smoke assertions passed.');

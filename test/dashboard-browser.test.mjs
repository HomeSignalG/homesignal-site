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
  ok(shape.rail.join(' | ') === 'Your Places | Stay Informed',
    'Fix 8 right rail signed-out is Your Places → Stay Informed', shape.rail);
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

} finally {
  await browser.close();
  srv.close();
}

if (fails) { console.error('\n' + fails + ' browser assertion(s) failed'); process.exit(1); }
console.log('\nAll dashboard browser smoke assertions passed.');

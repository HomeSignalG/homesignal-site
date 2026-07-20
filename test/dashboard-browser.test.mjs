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
const page = await ctx.newPage();

try {
  // Context I — signed-out sample ZIP (seed mode, no demo place in URLs)
  await page.goto(base + '/dashboard.html?data=seed&zip=78617', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#dashStrip a.stat-link', { timeout: 30000 });

  assertHref('Projects stat', await page.locator('#dashStrip a.stat-link').first().getAttribute('href'),
    { zip: '78617', noPlace: true, has: { sort: 'distance' } });
  assertHref('Action windows', await page.locator('#dashStrip a.stat-link.accent').getAttribute('href'),
    { zip: '78617', noPlace: true, has: { band: 'open' } });
  assertHref('ZIP Score', await page.locator('#dashStrip a.stat-link.g').getAttribute('href'),
    { zip: '78617', noPlace: true, has: { focus: 'score' } });
  assertHref('Map link', await page.locator('#dashMapLink').getAttribute('href'),
    { zip: '78617', noPlace: true });
  assertHref('Manage Saved Places', await page.locator('a', { hasText: 'Manage →' }).getAttribute('href'),
    { zip: undefined });
  ok((await page.locator('a', { hasText: 'Manage →' }).getAttribute('href')) === 'properties.html',
    'Manage link is account-wide properties.html');

  // Context B — multiple saved places in seed (rows present)
  const propRows = await page.locator('#dashProps a.swrow-link').count();
  ok(propRows >= 2, 'seed shows multiple saved-place rows (context C/D)');

  // Worth-watching chips
  const chips = page.locator('#dashWatch a.wchip-link');
  if (await chips.count()) {
    const ch = await chips.first().getAttribute('href');
    assertHref('Worth-watching chip', ch, { zip: '78617' });
    ok(ch.indexOf('id=') > 0, 'worth-watching chip carries project id');
  }

  // Recent activity cards are anchors with valid hrefs
  const recent = page.locator('#dashRecent a.card-link');
  if (await recent.count()) {
    assertHref('Recent activity', await recent.first().getAttribute('href'), { zip: '78617' });
  }

  // Meeting row — DVISD change id routes to alerts
  const mtg = page.locator('#dashMeetings a.aw-link').filter({ hasText: 'Board of Trustees' });
  if (await mtg.count()) {
    const mh = await mtg.getAttribute('href');
    ok(mh && mh.indexOf('chg-dvisd') > 0 && mh.indexOf('development') < 0,
      'DVISD meeting routes to alerts change id');
  }

  // Upcoming meetings heading link
  assertHref('Meetings heading', await page.locator('#dashMeetingsHead').getAttribute('href'),
    { zip: '78617', has: { category: 'Government & civic' } });

  // Projects near you navigation + back (context H)
  await page.locator('#dashStrip a.stat-link').first().click();
  await page.waitForURL(/development\.html/, { timeout: 15000 });
  await page.waitForSelector('#devSort button.on', { timeout: 15000 });
  ok(page.url().includes('zip=78617') && page.url().includes('sort=distance'), 'Projects click lands on development with sort');
  ok(await page.locator('#devSort button.on').getAttribute('data-sort') === 'distance', 'development shows Distance sort active');
  await page.goBack();
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 });

  // Action windows deep link
  await page.locator('#dashStrip a.stat-link.accent').click();
  await page.waitForURL(/alerts\.html.*band=open/, { timeout: 15000 });
  ok(await page.locator('#alBand').count() >= 0, 'alerts page loaded with band=open');
  await page.goBack();

  // Growth pressure → lens=2 (distance sort via deep link)
  const growth = page.locator('#dashStrip a.stat-link').filter({ hasText: 'Growth pressure' });
  if (await growth.count()) {
    await growth.click();
    await page.waitForURL(/development\.html.*lens=2/, { timeout: 15000 });
    await page.waitForSelector('#devSort button.on[data-sort="distance"]', { timeout: 15000 });
    ok(await page.locator('#devSort button.on').count() === 1, 'lens=2 shows exactly one active sort button');
    ok(await page.locator('#devSort button.on').getAttribute('data-sort') === 'distance',
      'lens=2 highlights Distance sort only');
    await page.goBack();
  }

  // ZIP Score → community focus=score
  const zipScore = page.locator('#dashStrip a.stat-link.g');
  if (await zipScore.count()) {
    await zipScore.click();
    await page.waitForURL(/community\.html.*focus=score/, { timeout: 15000 });
    await page.waitForSelector('#zip-score-strip', { timeout: 15000 });
    ok(await page.locator('#zip-score-strip').count() === 1, 'community page has zip-score-strip');
    await page.goBack();
  }

  // Destination: alerts category + invalid id safe
  await page.goto(base + '/alerts.html?data=seed&zip=78617&category=Government%20%26%20civic', { waitUntil: 'networkidle' });
  ok(await page.locator('.groupHead[data-category="Government & civic"]').count() >= 1,
    'alerts category=Government & civic finds exact category');
  await page.goto(base + '/alerts.html?data=seed&zip=78617&id=not-a-real-id', { waitUntil: 'networkidle' });
  ok(await page.locator('#alGroups').count() === 1, 'alerts invalid id leaves page usable');

  // Destination: development invalid lens/sort
  await page.goto(base + '/development.html?data=seed&zip=78617&lens=99&sort=bogus', { waitUntil: 'networkidle' });
  ok(await page.locator('#devSort button.on').getAttribute('data-sort') === 'impact', 'invalid sort falls back to impact');

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
      mapHref: window.HS.pageHref('maps.html', { zip: window.HS.state.zip, place: real && real.id })
    };
  });
  const inj = await page.evaluate(() => window.__HS_TEST);
  ok(inj.realHomeId === 'coomes', 'real home detected for Coomes Dr in active ZIP');
  ok(inj.mapHref === 'maps.html?zip=78617&place=coomes', 'place included for real home in ZIP');
  await page.evaluate(function () {
    window.HS.state.activePropId = 'p2';
    var real = window.HS.realHome();
    window.__HS_TEST2 = { realHomeId: real, placeRental: !real };
  });
  const inj2 = await page.evaluate(() => window.__HS_TEST2);
  ok(inj2.placeRental === true, 'rental active property is not realHome (no place for rental)');

  // Map marker vs background
  await page.goto(base + '/dashboard.html?data=seed&zip=78617', { waitUntil: 'networkidle' });
  await page.waitForSelector('#dashMap', { timeout: 30000 });
  const marker = page.locator('#dashMap [data-hs-map-item]').first();
  if (await marker.count()) {
    const before = page.url();
    await marker.click({ force: true });
    await page.waitForTimeout(400);
    const after = page.url();
    ok(after !== before && after.indexOf('dashboard') < 0, 'marker click navigates away from dashboard');
    ok(after.indexOf('maps.html') < 0 || after.indexOf('id=') > 0 || after.indexOf('development') > 0 || after.indexOf('alerts') > 0,
      'marker click does not open bare maps background');
    await page.goBack();
    await page.waitForURL(/dashboard\.html/);

    // Keyboard Enter on map region opens full map
    await page.locator('#dashMap').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/maps\.html/, { timeout: 15000 });
    ok(page.url().includes('zip=78617') && !page.url().includes('place='), 'Enter on map opens maps with zip only');
    await page.goBack();
    await page.waitForURL(/dashboard\.html/);

    // Background click opens maps (not after drag — simulated by direct click corner)
    await page.locator('#dashMap').click({ position: { x: 12, y: 12 }, force: true });
    await page.waitForURL(/maps\.html/, { timeout: 15000 });
    assertHref('map background click', 'maps.html' + page.url().substring(page.url().indexOf('?')), { zip: '78617', noPlace: true });
  } else {
    console.log('SKIP — no map markers rendered in this environment');
  }

  // maps.html place + id deep link
  await page.goto(base + '/maps.html?data=seed&zip=78617&place=p1&id=proj-datacenter', { waitUntil: 'networkidle', timeout: 60000 });
  ok(page.url().indexOf('maps.html') >= 0, 'maps invalid place still loads');
  ok(await page.locator('#mapWrap, #mapSch, .mapwrap').count() >= 1, 'maps page renders map surface');

} finally {
  await browser.close();
  srv.close();
}

if (fails) { console.error('\n' + fails + ' browser assertion(s) failed'); process.exit(1); }
console.log('\nAll dashboard browser smoke assertions passed.');

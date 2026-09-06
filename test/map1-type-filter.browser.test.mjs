// MAP 1 — THE TYPE TOGGLE, DRIVEN AS A RESIDENT DRIVES IT (real browser, real Leaflet).
//
// test/map1-type-filter.test.mjs proves the wiring EXISTS by reading the shipped file. That is
// necessary and not sufficient: wiring can be present and still filter the wrong thing, filter
// only the view it was clicked in, or leave a blank map with no explanation. This clicks the
// real chips on the real page and counts the markers that actually disappear.
//
// Every network call is answered from fixtures — no geocoder, no get-address-report, no
// Supabase. Leaflet is the REAL pinned build, because marker add/remove is the thing under test.
//
// Run: node test/map1-type-filter.browser.test.mjs
// `playwright`, not `playwright-core`, and the filename ends `.browser.test.mjs`, both
// deliberately. scripts/run-unit-tests.mjs discovers *.test.mjs and classifies a suite as
// browser-backed by READING it for an import of exactly 'playwright' — so this combination is
// what puts the file in the reported `browser` CI job (which installs playwright + chromium)
// and keeps it OUT of the required offline job (which has neither). A `.browser.mjs` name, as
// its sibling map1-address-radius.browser.mjs uses, is discovered by nothing and run by no
// workflow: a suite no runner references produces success-shaped silence.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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

// ── FIXTURE ─────────────────────────────────────────────────────────────────────────────────
// ZIP mode has TWO site sources and they are not interchangeable — a fixture that ignores the
// split silently renders nothing (it did, on this suite's first run). HS.zipAuthMergeSites
// DROPS every cached-report site that is `scope:'point'` + `relevance:'development'`, because
// authoritative whole-ZIP geography replaced that set. So:
//   * FACILITIES come from the cached development_reports row (the EPA national floor), and
//     must NOT carry relevance:'development' or the merge discards them too;
//   * DEVELOPMENT comes from the app_zip_projects_markers RPC and is hydrated by
//     HS.zipAuthSiteFromMarker, which is also where the Residential qualification gate runs —
//     hence the deliberately qualifying subdivision/apartment names below.
//
// Spread across FOUR type categories and THREE lifecycle stages on purpose, so a type toggle
// is shown to cut ACROSS stages rather than coinciding with one:
//   industrial 3 (proposed + approved + operating) · residential 2 · datacenter 1 · facility 2
const PROJECTS = [
  { project_ref: 'p-i1', name: 'HILLTOP MANUFACTURING PLANT', type: 'Industrial',  status: 'Proposed',
    registry_id: 'demo-src', source_ref: 'https://example.gov/rec/i1', submitted_at: '2026-01-05', date_kind: 'filed' },
  { project_ref: 'p-i2', name: 'EASTSIDE WAREHOUSE EXPANSION', type: 'Industrial', status: 'Approved',
    registry_id: 'demo-src', source_ref: 'https://example.gov/rec/i2', submitted_at: '2026-02-05', date_kind: 'filed' },
  { project_ref: 'p-i3', name: 'RIVER ROAD FABRICATION WORKS', type: 'Industrial', status: 'Completed',
    registry_id: 'demo-src', source_ref: 'https://example.gov/rec/i3', submitted_at: '2025-03-05', date_kind: 'filed' },
  { project_ref: 'p-r1', name: 'PIONEER CROSSING EAST RESIDENTIAL SUBDIVISION PHASE 2', type: 'Residential',
    status: 'Approved', registry_id: 'demo-src', source_ref: 'https://example.gov/rec/r1', submitted_at: '2026-04-05', date_kind: 'filed' },
  { project_ref: 'p-r2', name: 'NEW CONSTRUCTION 40 UNIT APARTMENT BUILDING', type: 'Residential',
    status: 'Proposed', registry_id: 'demo-src', source_ref: 'https://example.gov/rec/r2', submitted_at: '2026-05-05', date_kind: 'filed' },
  { project_ref: 'p-d1', name: 'DEL VALLE DATA CENTER CAMPUS', type: 'Data Center', status: 'Approved',
    registry_id: 'demo-src', source_ref: 'https://example.gov/rec/d1', submitted_at: '2026-06-05', date_kind: 'filed' }
];
const MARKERS = PROJECTS.map((p, i) => ({
  project_ref: p.project_ref, marker_seq: 1, lat: 30.171 + i * 0.001, lng: -97.612, marker_rule: 'POINT_AUTHORITATIVE'
}));
const ZIP_AUTH = { status: 'boundary_complete', projects: PROJECTS, markers: MARKERS };
// Facilities: cached-report sites with NO relevance:'development', so the merge keeps them.
const FACILITIES = [
  { scope: 'point', label: 'ACME PLATING CO', registry_id: '110000111111',
    url: 'https://echo.epa.gov/detailed-facility-report?fid=110000111111', lat: 30.1770, lng: -97.6140, e: 0.05, n: 0.03 },
  { scope: 'point', label: 'DEL VALLE READY MIX', registry_id: '110000222222',
    url: 'https://echo.epa.gov/detailed-facility-report?fid=110000222222', lat: 30.1780, lng: -97.6150, e: 0.06, n: 0.04 }
];
const EXPECT = { industrial: 3, residential: 2, datacenter: 1, facility: 2 };
const TOTAL = Object.values(EXPECT).reduce((a, b) => a + b, 0);
const ZIP_ROW = [{ zip: '78617', home_lat: 30.1745, home_lng: -97.6134,
  counts: { facilities: 2 }, refreshed_at: '2026-09-01T00:00:00Z',
  paywall: false, facilities_unavailable: false, sites: FACILITIES }];

// Let playwright resolve its own browser (what the CI job's `npx playwright install` provides),
// and fall back to a sandbox's pre-installed Chromium. A hardcoded path is not portable between
// the two, and a launch failure here must be loud rather than a skip.
const browser = await (async () => {
  if (process.env.HS_CHROMIUM) return chromium.launch({ executablePath: process.env.HS_CHROMIUM });
  try { return await chromium.launch(); }
  catch { return chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }); }
})();
const page = await (await browser.newContext()).newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('/rest/v1/development_reports'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ZIP_ROW) });
  // Must be matched BEFORE the generic /rest/v1/ catch-all — an rpc URL contains it too, and
  // answering the authoritative call with [] reads as "this ZIP was never measured", which
  // renders zero pins and looks exactly like a broken fixture.
  if (url.includes('/rpc/app_zip_projects_markers'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ZIP_AUTH) });
  if (url.includes('/rest/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  if (url.includes('leaflet@1.9.4/dist/leaflet.js'))
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(join(root, 'node_modules/leaflet/dist/leaflet.js'), 'utf8') });
  if (url.includes('leaflet@1.9.4/dist/leaflet.css'))
    return route.fulfill({ status: 200, contentType: 'text/css', body: await readFile(join(root, 'node_modules/leaflet/dist/leaflet.css'), 'utf8') });
  // supabase-js is unused on this page's DATA path (every read here is stubbed above), but the
  // shell still constructs a client for analytics — an empty stub leaves window.supabase
  // undefined and the page throws on `.from`, which would sit in the error assertion below and
  // read as a product defect. Same minimal shim the address+radius suite uses.
  if (url.includes('cdn.jsdelivr.net'))
    return route.fulfill({ status: 200, contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript',
      body: url.endsWith('.css') ? '' : 'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(){return q;},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};' });
  if (url.includes('tile.openstreetmap'))
    return route.fulfill({ status: 200, contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES) && window.__HS_SITES.length > 0, { timeout: 20000 });
await page.waitForFunction(() => window.__HS_VERIFY && window.__HS_VERIFY.visibleMarkers > 0, { timeout: 20000 });

// Markers actually attached to the Leaflet layer — the DOM, not our own bookkeeping.
const onMap = () => page.evaluate(() => document.querySelectorAll('#map .leaflet-marker-icon').length);
const chips = () => page.$$('#mapkeyShapes span.sh');
const chipByLabel = async (t) => (await page.$$('#mapkeyShapes span.sh'))
  .reduce(async (accP, el) => (await accP) || ((await el.textContent()).trim() === t ? el : null), Promise.resolve(null));

// ══ 1. THE CHIPS ARE CONTROLS ══════════════════════════════════════════════════════════════
const cs = await chips();
ok(cs.length === 8, '1: eight Type chips render (got ' + cs.length + ')');
const roles = await page.$$eval('#mapkeyShapes span.sh', els => els.map(e => ({
  role: e.getAttribute('role'), tab: e.tabIndex, pressed: e.getAttribute('aria-pressed'), t: e.textContent.trim() })));
ok(roles.every(r => r.role === 'button'), '1: every Type chip is role="button"');
ok(roles.every(r => r.tab === 0), '1: every Type chip is keyboard-focusable');
ok(roles.every(r => r.pressed === 'true'), '1: every Type chip starts ON (default-visible)', roles);

const base0 = await onMap();
ok(base0 === TOTAL, '1: all ' + TOTAL + ' fixture pins are on the map to begin with (got ' + base0 + ')');

// ══ 2. ONE CHIP HIDES EXACTLY ITS OWN CATEGORY, ACROSS EVERY LIFECYCLE STAGE ═══════════════
for (const [label, key] of [['Industrial', 'industrial'], ['Residential', 'residential'],
                            ['Data center', 'datacenter'], ['Regulated facility', 'facility']]) {
  const before = await onMap();
  const chip = await chipByLabel(label);
  await chip.click();
  const after = await onMap();
  ok(before - after === EXPECT[key],
    '2: "' + label + '" off removes exactly ' + EXPECT[key] + ' pin(s) (removed ' + (before - after) + ')');
  ok((await chip.getAttribute('aria-pressed')) === 'false', '2: "' + label + '" reports aria-pressed=false');
  ok((await chip.getAttribute('class')).includes('off'), '2: "' + label + '" shows the .off appearance');
  await chip.click();
  ok((await onMap()) === before, '2: "' + label + '" back on restores every pin');
}
// Industrial spans proposed/approved/operating in the fixture, so the count above proves the
// TYPE dimension cut across stages rather than shadowing a single stage chip.

// ══ 3. THE TWO ROWS COMPOSE (stage AND type), THEY DO NOT OVERRIDE ════════════════════════
await (await chipByLabel('Industrial')).click();                 // -3 (all three stages)
await page.click('#mapkey span:has-text("Approved")');           // -RES A, -DC A (industrial already gone)
const both = await onMap();
ok(both === TOTAL - EXPECT.industrial - 2, '3: stage AND type compose — expected ' +
  (TOTAL - EXPECT.industrial - 2) + ', got ' + both);
await page.click('#mapkey span:has-text("Approved")');
await (await chipByLabel('Industrial')).click();
ok((await onMap()) === TOTAL, '3: both rows restored -> full population');

// ══ 4. KEYBOARD OPERATION ═════════════════════════════════════════════════════════════════
const kb = await chipByLabel('Residential');
await kb.focus();
await page.keyboard.press('Enter');
ok((await onMap()) === TOTAL - EXPECT.residential, '4: Enter on a focused chip toggles it');
await page.keyboard.press(' ');
ok((await onMap()) === TOTAL, '4: Space toggles it back');

// ══ 5. EVERY TYPE OFF -> BLANK MAP THAT SAYS WHY ══════════════════════════════════════════
ok(await page.isHidden('#mapkeyEmpty'), '5: the empty-state note is hidden while pins show');
for (const el of await chips()) await el.click();
ok((await onMap()) === 0, '5: switching every Type off empties the map');
ok(await page.isVisible('#mapkeyEmpty'), '5: ...and the page SAYS the pins were switched off');
const vs = await page.evaluate(() => window.__HS_VERIFY);
ok(vs.visibleMarkers === 0 && vs.mapMarkers === TOTAL,
  '5: __HS_VERIFY separates "hidden by the resident" from "no records"', vs);
for (const el of await chips()) await el.click();
ok((await onMap()) === TOTAL && await page.isHidden('#mapkeyEmpty'), '5: all back on -> note hides, pins return');

// ══ 6. THE FILTER FOLLOWS THE RESIDENT INTO THE 3D SATELLITE VIEW ═════════════════════════
await (await chipByLabel('Industrial')).click();
await page.click('#viewSeg button[data-v="gl"]');
await page.waitForTimeout(800);
const glState = await page.evaluate(() => (window.__HS_VERIFY || {}).typeFilter || {});
ok(glState.industrial === false, '6: the type filter survives the view switch', glState);
await page.click('#viewSeg button[data-v="2d"]');
await (await chipByLabel('Industrial')).click();

ok(pageErrors.length === 0, '7: no uncaught page errors', pageErrors);

await browser.close();
server.close();
console.log('\n' + (fails ? fails + ' FAILED' : 'map1-type-filter.browser: all checks passed'));
process.exit(fails ? 1 : 0);

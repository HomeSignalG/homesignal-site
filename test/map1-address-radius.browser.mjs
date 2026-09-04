// MAP 1 ADDRESS + RADIUS — the USER FLOW, driven through the real page in a real browser.
//
// The offline suite proves the rules; this proves the product: a resident types an address,
// sees their home, picks a radius, and gets canonical project markers they can click — and
// the entire-ZIP mode still works exactly as before.
//
// Every network call is intercepted and answered from fixtures, so this touches NO production
// service: not the geocoder, not get-address-report, not the N5 RPC, not app_projects. The
// fixture VALUES for the positive control are the ones production already returned in the
// end-to-end proof (readiness doc section 19); they are verification controls, and nothing in
// the page knows them.
//
// Run: node test/map1-address-radius.browser.mjs
import { chromium } from 'playwright-core';
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

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
const GEO = { match: { matchedAddress: '2200 CALDWELL LN, DEL VALLE, TX, 78617',
  lat: 30.215054966235, lng: -97.53885104845, zip: '78617', city: 'DEL VALLE', state: 'TX' } };
// what the report engine returns: facilities + one area notice + its OWN development point
// (which address mode must replace with canonical results).
const REPORT = {
  address: '2200 CALDWELL LN, DEL VALLE, TX 78617',
  home: { lat: 30.99, lng: -97.99 },              // deliberately WRONG: the geocoder's point must win
  counts: { facilities: 2, development: 1, proposed: 1 },
  sites: [
    { scope: 'point', label: 'ACME PLATING CO', registry_id: '110000123456', layer: 'industrial',
      url: 'https://echo.epa.gov/detailed-facility-report?fid=110000123456',
      lat: 30.2160, lng: -97.5400, e: 0.3, n: 0.06, src: 'EPA FRS' },
    { scope: 'point', label: 'DEL VALLE READY MIX', registry_id: '110000987654', layer: 'industrial',
      url: 'https://echo.epa.gov/detailed-facility-report?fid=110000987654',
      lat: 30.2100, lng: -97.5350, e: 0.2, n: -0.35, src: 'EPA FRS' },
    { scope: 'point', relevance: 'development', label: 'ENGINE DEV POINT — must not render',
      record_url: 'https://example.gov/engine/1', bucket: 'proposed', type: 'proposed', e: 0.1, n: 0.1 },
    { scope: 'area', relevance: 'development', label: 'Travis County rezoning hearing',
      record_url: 'https://example.gov/area/1', bucket: 'proposed', type: 'proposed',
      meeting_date: '2026-10-01', src: 'Travis County' }
  ]
};
const RPC_ROWS = {
  1: [
    { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2021-0320D', feature_id: 'pt:1',
      registry_id: 'austin-site-plan-cases', provenance: 'proven_stored_point',
      distance_mi: 0.021017590124, geometry_type: 'ST_Point',
      marker_lat: 30.21520, marker_lng: -97.53910, has_more: false },
    { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2020-0236D', feature_id: 'pt:1',
      registry_id: 'austin-site-plan-cases', provenance: 'proven_stored_point',
      distance_mi: 0.278213114517, geometry_type: 'ST_Point',
      marker_lat: 30.21890, marker_lng: -97.54020, has_more: false }
  ],
  2: [
    { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2021-0320D', feature_id: 'pt:1',
      registry_id: 'austin-site-plan-cases', provenance: 'proven_stored_point',
      distance_mi: 0.021017590124, geometry_type: 'ST_Point',
      marker_lat: 30.21520, marker_lng: -97.53910, has_more: false },
    { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2020-0236D', feature_id: 'pt:1',
      registry_id: 'austin-site-plan-cases', provenance: 'proven_stored_point',
      distance_mi: 0.278213114517, geometry_type: 'ST_Point',
      marker_lat: 30.21890, marker_lng: -97.54020, has_more: false },
    // a recovered polygon: its marker sits well away from its nearest edge, so the page must
    // show 0.9 mi (the RPC's true distance) and not the distance to the pin.
    { source_key: 'arcgis:txdot-projects-info-all:99001', feature_id: 'f:7',
      registry_id: 'txdot-projects-info-all', provenance: 'recovered_authoritative',
      distance_mi: 0.9, geometry_type: 'ST_MultiPolygon',
      marker_lat: 30.23500, marker_lng: -97.51500, has_more: true }
  ]
};
const PROJECTS = [
  { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2021-0320D', name: 'Caldwell Lane',
    type: 'Industrial', status: 'Approved', registry_id: 'austin-site-plan-cases',
    source_ref: 'https://abc.austintexas.gov/web/permit/public-search-other?t_selected_folderrsn=12774743',
    submitted_at: '2021-09-07', date_kind: 'filed', impact_score: 55, impact_dimensions: null },
  { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2020-0236D', name: 'Riverside Resort',
    type: 'unclassified', status: 'Proposed', registry_id: 'austin-site-plan-cases',
    source_ref: 'https://abc.austintexas.gov/web/permit/public-search-other?t_selected_folderrsn=12487869',
    submitted_at: '2020-06-11', date_kind: 'filed', impact_score: 72, impact_dimensions: null },
  { source_key: 'arcgis:txdot-projects-info-all:99001', name: 'SH 71 corridor improvements',
    type: 'Infrastructure', status: 'Proposed', registry_id: 'txdot-projects-info-all',
    source_ref: 'https://www.txdot.gov/projects/99001', submitted_at: '2025-03-04',
    date_kind: 'filed', impact_score: null, impact_dimensions: null }
];
const ZIP_ROW = [{ zip: '78617', home_lat: 30.1745, home_lng: -97.6134,
  counts: { facilities: 1, development: 1 }, refreshed_at: '2026-09-01T00:00:00Z',
  paywall: false, facilities_unavailable: false,
  sites: [
    { scope: 'point', label: 'ZIP-ONLY FACILITY', registry_id: '110000555555',
      url: 'https://echo.epa.gov/x', lat: 30.1750, lng: -97.6140, e: 0.05, n: 0.03 },
    { scope: 'area', relevance: 'development', label: 'ZIP-ONLY county notice',
      record_url: 'https://example.gov/zip/1', bucket: 'proposed', type: 'proposed' }
  ] }];

const browser = await chromium.launch({ executablePath: process.env.HS_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const calls = [];
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));

await page.route('**/*', async (route) => {
  const url = route.request().url();
  const post = () => { try { return JSON.parse(route.request().postData() || '{}'); } catch { return {}; } };
  if (url.startsWith(base)) return route.continue();
  if (url.includes('/functions/v1/geocode-address')) {
    calls.push({ kind: 'geocode', body: post() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GEO) });
  }
  if (url.includes('/rpc/n5_projects_within_radius')) {
    const b = post();
    calls.push({ kind: 'rpc', body: b });
    const rows = RPC_ROWS[b.p_radius_mi] || [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  }
  if (url.includes('/functions/v1/get-address-report')) {
    calls.push({ kind: 'report', body: post() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REPORT) });
  }
  if (url.includes('/rest/v1/app_projects')) {
    calls.push({ kind: 'hydrate', url });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROJECTS) });
  }
  if (url.includes('/rest/v1/development_reports')) {
    calls.push({ kind: 'zipcache', url });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ZIP_ROW) });
  }
  if (url.includes('/rest/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  // The sandbox has no outbound network, so the page's CDN assets are served from the local
  // node_modules copy of the SAME pinned version. Leaflet is real, because the map rendering is
  // exactly what this proof is about; supabase-js is unused on this page's data path and is
  // stubbed. Tiles are answered with a transparent pixel — imagery is cosmetic here.
  if (url.includes('leaflet@1.9.4/dist/leaflet.js')) {
    return route.fulfill({ status: 200, contentType: 'text/javascript',
      body: await readFile(join(root, 'node_modules/leaflet/dist/leaflet.js'), 'utf8') });
  }
  if (url.includes('leaflet@1.9.4/dist/leaflet.css')) {
    return route.fulfill({ status: 200, contentType: 'text/css',
      body: await readFile(join(root, 'node_modules/leaflet/dist/leaflet.css'), 'utf8') });
  }
  if (url.includes('cdn.jsdelivr.net')) {
    const kind = url.endsWith('.css') ? 'text/css' : 'text/javascript';
    return route.fulfill({ status: 200, contentType: kind, body: kind === 'text/css' ? '' : 'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};' });
  }
  if (url.includes('tile.openstreetmap')) {
    return route.fulfill({ status: 200, contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

const sites = () => page.evaluate(() => (window.__HS_SITES || []).map(s => ({
  label: s.label, scope: s.scope, relevance: s.relevance, lat: s.lat, lng: s.lng,
  distance_mi: s.distance_mi, registry_id: s.registry_id, n5: s.n5_feature_id || null })));

// ══════════════ 1. ZIP MODE still returns the ENTIRE ZIP ══════════════
await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES) && window.__HS_SITES.length > 0, { timeout: 20000 });
let s = await sites();
ok(calls.some(c => c.kind === 'zipcache'), 'ZIP mode reads the cached entire-ZIP report');
ok(!calls.some(c => c.kind === 'rpc'), 'ZIP mode makes NO N5 radius call');
ok(s.some(x => x.label === 'ZIP-ONLY FACILITY') && s.some(x => x.label === 'ZIP-ONLY county notice'),
  'ZIP mode renders the ZIP population', s.map(x => x.label));
const zipCaption = await page.textContent('#withinLbl');
ok(/Across ZIP/.test(zipCaption || ''), 'ZIP mode is captioned as the whole ZIP: ' + zipCaption);

// ══════════════ 2. ADDRESS MODE — home, ring, canonical markers ══════════════
calls.length = 0;
// A resident picks a radius and searches. NOTE: CUR_RADIUS is shared between the modes, so
// arriving from a ZIP page carries whatever radius zipFitRadius chose for that ZIP - the
// button row and the "Within X of" caption both show it, so it is visible, not silent.
await page.click('#radSel button[data-r="1"]');
await page.fill('#addr', '2200 Caldwell Ln, Del Valle, TX 78617');
await page.click('#go');
await page.waitForFunction(() => (window.__HS_SITES || []).some(s => s.n5_feature_id), { timeout: 20000 })
  .catch(async () => {
    console.log('   [diag] status: ' + await page.textContent('#status').catch(() => '?'));
    console.log('   [diag] calls : ' + JSON.stringify(calls.map(c => c.kind)));
    console.log('   [diag] errors: ' + JSON.stringify(pageErrors.slice(0, 3)));
    console.log('   [diag] sites : ' + await page.evaluate(() => JSON.stringify((window.__HS_SITES || []).map(x => x.label))));
  });
s = await sites();
const geoCall = calls.find(c => c.kind === 'geocode');
const rpcCall = calls.find(c => c.kind === 'rpc');
ok(!!geoCall && geoCall.body.address === '2200 Caldwell Ln, Del Valle, TX 78617',
  'B — the address is sent to the existing production geocoder');
ok(!!rpcCall && rpcCall.body.p_lat === GEO.match.lat && rpcCall.body.p_lng === GEO.match.lng,
  'C — the geocoder\'s EXACT lat/lng are the RPC arguments', rpcCall && rpcCall.body);
ok(rpcCall.body.p_radius_mi === 1 && rpcCall.body.p_limit === 500,
  'D — the selected radius and a bounded page size are sent', rpcCall.body);
ok(calls.some(c => c.kind === 'hydrate' && /source_key=in\./.test(c.url)),
  'H — hydration queries app_projects by source_key');
const n5 = s.filter(x => x.n5);
ok(n5.length === 2, 'address mode renders the canonical results', n5.length);
ok(n5.every(x => x.registry_id === undefined), 'Q — no canonical result carries a registry_id (never a facility)');
ok(n5.find(x => x.label === 'Caldwell Lane').lat === 30.21520,
  'E — the marker is the RPC\'s marker_lat', n5.map(x => x.lat));
ok(!s.some(x => x.label === 'ENGINE DEV POINT — must not render'),
  'the engine\'s own development point is replaced by canonical results');
ok(s.filter(x => x.registry_id).length === 2, 'Q — both EPA facilities survive untouched');
ok(s.some(x => x.label === 'Travis County rezoning hearing' && x.distance_mi === undefined),
  'P — the area notice survives and carries no radius distance');
const homeUsed = await page.evaluate(() => window.__HS_HOME || null);
ok(await page.locator('.homepin').count() === 1, 'the HOME marker is drawn for a searched address');
const ring = await page.evaluate(() => document.querySelectorAll('#mapInner path.leaflet-interactive').length);
ok(ring >= 1, 'the radius ring is drawn (' + ring + ' vector layers)');
const fresh = await page.textContent('#freshLine');
ok(/2 canonical projects within 1 mi/.test(fresh || ''), '12 — the honest count is stated: ' + fresh);

// MARKER CLICK -> the existing Map 1 dossier popup. Every non-home marker is tried in turn,
// because the facility pins and the canonical project pins are the same marker class - which is
// itself the point: canonical results enter the SAME renderer, not a parallel one. The first
// click landed on an EPA facility whose popup read "Facility - operating now", exactly as it
// should; what must also be true is that a canonical project opens its own dossier.
// The page keeps every drawn site marker in `siteMarkers` ({m, s, bucket}); opening the one
// whose site is a canonical result drives Leaflet's real popup for that marker.
const opened = await page.evaluate(() => {
  const hit = (window.siteMarkers || []).find(x => x && x.s && x.s.n5_feature_id);
  if (!hit) return { found: false, total: (window.siteMarkers || []).length };
  hit.m.openPopup();
  return { found: true, label: hit.s.label, total: window.siteMarkers.length };
});
ok(opened.found, 'a canonical result is drawn as a real map marker', opened);
await page.waitForSelector('.leaflet-popup-content', { timeout: 5000 }).catch(() => {});
const popup = (await page.textContent('.leaflet-popup-content').catch(() => '')) || '';
ok(/Caldwell Lane|Riverside Resort/.test(popup),
  'clicking a canonical marker opens the existing Map 1 dossier popup', popup.slice(0, 120));
ok(/mi from home|at this address/.test(popup), 'the popup carries a distance: ' + popup.slice(0, 100));
ok(!/Facility · operating now/.test(popup),
  'Q — a canonical project is NOT labelled as an EPA facility: ' + popup.slice(0, 100));

// ══════════════ 3. RADIUS CHANGE re-queries and repopulates ══════════════
calls.length = 0;
await page.click('#radSel button[data-r="2"]');
await page.waitForFunction(() => (window.__HS_SITES || []).filter(s => s.n5_feature_id).length === 3, { timeout: 20000 });
const rpc2 = calls.find(c => c.kind === 'rpc');
ok(!!rpc2 && rpc2.body.p_radius_mi === 2, 'the new radius is sent to the RPC', rpc2 && rpc2.body);
s = await sites();
const polyRow = s.find(x => x.n5 === 'f:7');
ok(!!polyRow && polyRow.distance_mi === 0.9, 'G — the polygon keeps the RPC\'s distance');
const polyShown = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#propList .rec, #apprList .rec, #builtList .rec')];
  const r = rows.find(el => /SH 71 corridor/.test(el.textContent || ''));
  return r ? r.textContent : '';
});
ok(/0\.9 mi away/.test(polyShown), 'G — the page SHOWS 0.9 mi (the true distance), not the distance to its pin: ' + polyShown.slice(0, 80));
const fresh2 = await page.textContent('#freshLine');
ok(/more canonical project geometry exists within 2 mi/.test(fresh2 || ''),
  'K — has_more is surfaced, not silently treated as complete: ' + fresh2);
const disabled = await page.evaluate(() => [...document.querySelectorAll('#radSel button')]
  .filter(b => b.disabled).map(b => b.getAttribute('data-r')));
ok(JSON.stringify(disabled) === '["3","10","20"]',
  'D — address mode offers only the radii the RPC accepts', disabled);

// ══════════════ 4. BACK TO ZIP MODE — the entire-ZIP population returns ══════════════
calls.length = 0;
await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES) && window.__HS_SITES.length > 0, { timeout: 20000 });
s = await sites();
ok(s.some(x => x.label === 'ZIP-ONLY FACILITY'), 'ZIP mode repopulates from the ZIP cache');
ok(!s.some(x => x.n5), 'N — no address-radius result leaks into ZIP mode', s.map(x => x.label));
ok(!calls.some(c => c.kind === 'rpc'), 'N — returning to ZIP mode makes no N5 call');
const zipFresh = await page.textContent('#freshLine');
ok(!/canonical project/.test(zipFresh || ''), 'N — the address-radius note does not survive into ZIP mode: ' + zipFresh);

await browser.close();
server.close();
console.log('\nTOTAL PASS/FAIL — fails: ' + fails);
process.exit(fails ? 1 : 0);

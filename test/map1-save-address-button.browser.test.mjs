// MAP 1 — "Save this address to My Places" appears after an address search resolves, and
// opens the shell's one add-an-address flow with that address. Driven in a real browser;
// every network call is answered from fixtures.
//
// Run: node test/map1-save-address-button.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fulfillZipModeReport } from './lib/zip-mode-rpc-mock.mjs';
const require = createRequire(import.meta.url);

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
const REPORT = { address: '2200 CALDWELL LN, DEL VALLE, TX 78617', home: { lat: 30.99, lng: -97.99 },
  counts: { facilities: 1 }, sites: [
    { scope: 'point', label: 'ACME PLATING CO', registry_id: '110000123456', layer: 'industrial',
      url: 'https://echo.epa.gov/detailed-facility-report?fid=110000123456',
      lat: 30.2160, lng: -97.5400, src: 'EPA FRS' }] };
const N5ROW = { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2021-0320D', feature_id: 'pt:1',
  provenance: 'proven_stored_point', distance_mi: 0.2, geometry_type: 'ST_Point',
  marker_lat: 30.21520, marker_lng: -97.53980, has_more: false };
const PROJECTS = [{ source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2021-0320D',
  name: 'Caldwell Lane', type: 'Industrial', status: 'Approved', registry_id: 'austin-site-plan-cases',
  source_ref: 'https://abc.austintexas.gov/web/permit/public-search-other?t_selected_folderrsn=12774743',
  submitted_at: '2021-09-07', date_kind: 'filed', impact_score: 55, impact_dimensions: null }];
const ZIP_ROW = [{ zip: '78617', home_lat: 30.1745, home_lng: -97.6134, counts: { facilities: 1 },
  refreshed_at: '2026-09-01T00:00:00Z', paywall: false, facilities_unavailable: false, sites: [
    { scope: 'point', label: 'ZIP-ONLY FACILITY', registry_id: '110000555555',
      url: 'https://echo.epa.gov/x', lat: 30.1750, lng: -97.6140 }] }];
const ZIP_AUTH = { zip: '78617', mode: 'authoritative', status: 'boundary_complete',
  projects: [{ project_ref: 'p1', name: 'Del Valle logistics center', type: 'Industrial',
    status: 'Proposed', registry_id: 'austin-site-plan-cases', source_ref: 'https://example.gov/rec/p1',
    submitted_at: '2026-01-15', date_kind: 'filed', type_raw: 'Commercial - New Construction' }],
  markers: [{ project_ref: 'p1', lat: 30.1620, lng: -97.6600, marker_rule: 'POINT', marker_seq: 0 }] };

const browser = await chromium.launch();
const pageErrors = [];
// Every geocode call is COUNTED, because "did not run an empty search" is a claim about a
// request that must not exist — and an absent request is indistinguishable from a broken
// test unless the same counter also proves the real searches DID fire.
let geocodeCalls = [];
const routeHandler = async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  const J = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('/functions/v1/geocode-address')) {
    try { geocodeCalls.push(JSON.parse(route.request().postData() || '{}').address); } catch { geocodeCalls.push(null); }
    return J(GEO);
  }
  if (url.includes('/rpc/n5_projects_within_radius')) return J([N5ROW]);
  if (url.includes('/rpc/app_zip_projects_markers')) return J(ZIP_AUTH);
  if (url.includes('/functions/v1/get-address-report')) return J(REPORT);
  if (url.includes('/rest/v1/app_projects')) return J(PROJECTS);
  if (url.includes('/rpc/zip_mode_report_sites')) return fulfillZipModeReport(route, () => ZIP_ROW);
  if (url.includes('/rest/v1/development_reports')) return J(ZIP_ROW);
  if (url.includes('/rest/v1/')) return J([]);
  if (url.includes('leaflet@1.9.4/dist/leaflet.js') || url.includes('leaflet@1.9.4/dist/leaflet.css')) {
    const css = url.endsWith('.css');
    let local = null;
    try { local = require.resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch (e) { local = null; }
    if (!local) return route.continue();
    return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript',
      body: await readFile(local, 'utf8') });
  }
  if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200,
    contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript',
    body: url.endsWith('.css') ? '' : 'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(){return Promise.resolve({data:[],error:null});},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};' });
  if (url.includes('tile.openstreetmap')) return route.fulfill({ status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  return J({});
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
await page.route('**/*', r => routeHandler(r));

const waitZip = () => page.waitForFunction(
  () => Array.isArray(window.__HS_SITES) && !(window.__HS_SITES || []).some(s => s.n5_feature_id)
        && document.getElementById('results')
        && getComputedStyle(document.getElementById('results')).display !== 'none',
  null, { timeout: 30000 });
const waitAddr = () => page.waitForFunction(
  () => (window.__HS_SITES || []).some(s => s.n5_feature_id), null, { timeout: 30000 });

await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitZip(); await page.waitForTimeout(400);
const vis = () => page.evaluate(() => {
  const w = document.getElementById('saveAddr'), b = document.getElementById('saveAddrBtn');
  return { exists: !!(w && b), shown: !!(w && b && getComputedStyle(w).display !== 'none' && b.offsetParent !== null),
           text: b ? b.textContent.trim() : null };
});

// 1. ZIP mode: the control exists in the page but is not offered.
const z = await vis();
ok(z.exists, '1a the save control is in the page', z);
ok(!z.shown, '1b it is NOT offered in ZIP mode', z);

// 2. An address search that resolves offers it, with the approved label.
await page.fill('#addr', '2200 Caldwell Ln, Del Valle, TX 78617');
await page.click('#go');
await waitAddr(); await page.waitForTimeout(400);
const a = await vis(); 
ok(a.shown, '2a after a resolved address search the button is offered', a);
ok(a.text === 'Save this address to My Places', '2b with the exact label', a.text);

// 3. Clicking it opens the shell's add-an-address flow with the resolved address, saving nothing itself.
await page.evaluate(() => { window.__openHomeCalls = []; window.HS.openHome = function (x) { window.__openHomeCalls.push(x); }; });
await page.click('#saveAddrBtn');
const calls = await page.evaluate(() => window.__openHomeCalls);
ok(calls.length === 1 && /2200 CALDWELL LN/i.test(calls[0]), '3a click calls HS.openHome once with the resolved address', calls);

// 4. A new search hides it until that search resolves; a failed search leaves it hidden.
geocodeCalls = [];
const prev = routeHandler;
await page.unroute('**/*');
await page.route('**/*', async (route) => {
  if (route.request().url().includes('/functions/v1/geocode-address'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ match: null }) });
  return prev(route);
});
await page.fill('#addr', 'zzzz nowhere');
await page.click('#go');
await page.waitForTimeout(800);
const f = await vis();
ok(!f.shown, '4a a search that finds nothing does not offer the button', f);

ok(pageErrors.length === 0, '5 no page errors', pageErrors);
await browser.close(); server.close();
if (fails) { console.error('\n' + fails + ' failed'); process.exit(1); }
console.log('\nAll map1-save-address-button assertions passed.');

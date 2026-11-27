// MAP 1 — ZIP CODE SEARCH (founder, 2026-11-26)
// (harness copied from) MAP 1 — THE ZIP OUTLINE ON EVERY MAP (founder, 2026-11-09). Harness copied from map1-state-cleanup.
// (old header:) MAP 1 — STATE CLEANUP SITES, driven the way a resident drives them (founder decision 2026-10-21).
// A state cleanup site is its own layer with its own switch under Regulatory records. It is drawn
// whatever the Status/Type chips say, it is hidden only by its own switch, it never counts as an
// EPA facility, and a site the server does not place inside the ZIP is never drawn.
// The cleanup rows are the real Florida DEP shape (public.map1_state_cleanup_zip_members, local
// PostGIS run 2026-10-21), re-placed inside this fixture ZIP.
//
// Run: node test/map1-state-cleanup.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fulfillZipModeReport } from './lib/zip-mode-rpc-mock.mjs';
const require = createRequire(import.meta.url);

let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!c) fails++;
};

const REPO = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = createServer(async (q, s) => {
  const p = normalize(join(REPO, decodeURIComponent(q.url.split('?')[0])));
  try { const __body = await readFile(p); s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/plain' }); s.end(__body); }
  catch { s.writeHead(404); s.end('nope'); }
});
await new Promise(r => srv.listen(8851, '127.0.0.1', r));
const base = 'http://127.0.0.1:8851';

const DUAL = { e: 1.482, n: 1.664, lat: 38.94932, lng: -77.36519,
  src: 'EPA FRS · registry 110071955663', type: 'built', label: 'CORESITE - VA1 DATA CENTER',
  layer: 'datacenter', scope: 'point', registry_id: '110071955663',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110071955663' };
const PLAIN_FAC = { e: 1.82, n: 2.361, lat: 38.95942, lng: -77.35889,
  src: 'EPA FRS · registry 110072041130', type: 'built', label: 'ANDURIL INDUSTRIES, INC',
  layer: 'industrial', scope: 'point', registry_id: '110072041130',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110072041130' };
const DC_PROJECT = { e: 1.515, n: 1.756, lat: 38.95065, lng: -77.36458, type: 'approved',
  label: 'Pennhurst Data Centers', layer: 'development', scope: 'point', use_type: 'Data Center',
  type_raw: 'Data Center', relevance: 'development', bucket: 'approved',
  jurisdiction: 'Fairfax County Land Development Services', geo_precision: 'point',
  record_url: 'https://plus.fairfaxcounty.gov/x', source_id: 'arcgis:fairfax:P-1' };
const ZIP_ROW = { '20171': [{ zip: '20171', home_lat: 38.9506, home_lng: -77.3645,
  counts: { facilities: 2, development: 1 }, sites: [DUAL, PLAIN_FAC, DC_PROJECT],
  refreshed_at: '2026-09-06T00:00:00Z', facilities_unavailable: false }] };
const COMMUNITIES = { '52638': [{ name: 'Middletown (52638)', level: 'zip', county: 'Des Moines', state: 'Iowa' }],
  '19475': [{ name: 'Spring City (19475)', level: 'zip', county: 'Chester', state: 'PA' }], '20171': [{ name: 'Herndon (20171)', level: 'zip', county: 'Fairfax', state: 'VA' }],
  '07001': [{ name: 'Avenel (07001)', level: 'zip', county: 'Middlesex', state: 'New Jersey' }],
  '85083': [{ name: 'Phoenix (85083)', level: 'zip', county: 'Maricopa', state: 'Arizona' }],
  '64166': [{ name: 'Kansas City (64166)', level: 'zip', county: 'Clay', state: 'Missouri' }],
  '48854': [{ name: 'Mason (48854)', level: 'zip', county: 'Ingham', state: 'Michigan' }] };
for (const z of Object.keys(COMMUNITIES)) COMMUNITIES[z].forEach(r => { r.zip_codes = [z]; });
// Production invariant (N5 Fix 3, D11): a ZIP WITH a polygon is never reported not_measured, so its
// serving read is boundary_complete (here with zero projects). A ZIP WITHOUT one is not_measured.
const POLYGON_ZIPS = ['52638', '85083', '64166', '98684', '19475', '07001', '48854'];
COMMUNITIES['96799'] = [{ name: 'Pago Pago (96799)', level: 'zip', county: 'Eastern', state: 'American Samoa', zip_codes: ['96799'] }];
const DELAY = {};          // zip -> ms the communities answer is held back (stale-response test)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ZIP_AUTH = { '20171': { zip: '20171', mode: 'development', status: 'boundary_complete',
  projects: [{ source_key: 'arcgis:fairfax:P-1', project_ref: 'arcgis:fairfax:P-1',
    name: 'Pennhurst Data Centers', type: 'Data Center', status: 'Approved',
    registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/x',
    submitted_at: '2026-01-04', date_kind: 'filed', impact_score: null, impact_dimensions: null }],
  markers: [{ project_ref: 'arcgis:fairfax:P-1', lat: 38.95065, lng: -77.36458,
    marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] } };
const CLEANUP_MEMBER = { lat: 38.9541, lng: -77.3612, city: 'FORT LAUDERDALE', name: 'CITGO (FORMER)', state: 'FL',
  agency: 'Florida DEP', source: 'fl_dep_cleanup', status: 'ACTIVE', address: '1500 E LAS OLAS BLVD',
  category: 'PETRO', site_key: '89287788', program_id: '8839695',
  record_url: 'https://prodenv.dep.state.fl.us/DepNexus/public/electronic-documents/8839695/facility!search',
  zip_membership: 'member', source_loaded_at: '2026-10-21T07:00:09+00:00',
  checked_at: '2026-10-22T10:20:00.16563+00:00', record_url_sites: 2 };
// A second DEP case filed at the SAME point under the same facility page (2026-10-22): one pin.
const CLEANUP_SAME = Object.assign({}, CLEANUP_MEMBER, { site_key: '89287790', name: 'CITGO TANK FARM', category: 'OTHCU' });
const CLEANUP_OUTSIDE = Object.assign({}, CLEANUP_MEMBER, { site_key: '89282856', name: 'SONY PROFESSIONAL PRODUCTS CO',
  lat: 38.9551, lng: -77.3601, zip_membership: 'outside' });
const CLEANUP = { '20171': { zip: '20171', status: 'complete', sites: [CLEANUP_MEMBER, CLEANUP_SAME, CLEANUP_OUTSIDE] } };
const ADDR_TEXT = '13313 Coomes Dr, Del Valle, TX';
const ADDR_ZIP = '20170';
const ADDR_HOME = { lat: 38.9506, lng: -77.3645 };
const ADDR_DUAL = Object.assign({}, DUAL, { e: 0.22, n: 0.18, lat: 38.95321, lng: -77.36040 });
const ADDR_FAC = Object.assign({}, PLAIN_FAC, { e: 0.30, n: 0.42, lat: 38.95669, lng: -77.35891 });
const N5_ROWS = [];
const N5_PROJECTS = [];
const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.HS_CHROME) launchOpts.executablePath = process.env.HS_CHROME;
const browser = await chromium.launch(launchOpts);
const page = await (await browser.newContext()).newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
const zipOf = (url) => (url.match(/(?:zip=eq\.|%7B)(\d{5})/) || [])[1] || null;

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('/functions/v1/geocode-address'))
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ match: { lat: ADDR_HOME.lat, lng: ADDR_HOME.lng, matchedAddress: ADDR_TEXT, zip: ADDR_ZIP } }) });
  if (url.includes('/functions/v1/get-address-report'))
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ address: ADDR_TEXT, counts: { facilities: 2 },
        sites: [ADDR_DUAL, ADDR_FAC], refreshed_at: '2026-09-06T00:00:00Z', facilities_unavailable: false }) });
  if (url.includes('/rpc/n5_projects_within_radius'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(N5_ROWS) });
  if (url.includes('/rest/v1/app_projects'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(N5_PROJECTS) });
  if (url.includes('/rpc/app_zip_projects_markers')) {
    let z = '';
    try { z = String(JSON.parse(route.request().postData() || '{}').p_zip || ''); } catch (e) { z = ''; }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(ZIP_AUTH[z] || (POLYGON_ZIPS.includes(z)
        ? { zip: z, mode: 'development', status: 'boundary_complete', projects: [], markers: [] }
        : { zip: z, mode: 'development', status: 'not_measured', projects: null, markers: null })) });
  }
  if (url.includes('/rpc/map1_state_cleanup_zip_members')) {
    let z = '';
    try { z = String(JSON.parse(route.request().postData() || '{}').p_zip || ''); } catch (e) { z = ''; }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(CLEANUP[z] || { zip: z, status: 'not_measured', sites: [] }) });
  }
  if (url.includes('/rpc/map1_state_cleanup_near'))
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'complete', sites: [Object.assign({}, CLEANUP_MEMBER, { zip_membership: undefined })] }) });
  if (url.includes('/rpc/zip_mode_report_sites')) return fulfillZipModeReport(route, (z) => ZIP_ROW[z] || []);
  if (url.includes('/rest/v1/development_reports'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ZIP_ROW[zipOf(url)] || []) });
  if (url.includes('/rest/v1/app_community_meta') && /zip=like\./.test(url)) {
    const pre = (url.match(/zip=like\.(\d+)\*/) || [])[1] || '';
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(Object.keys(COMMUNITIES).filter(z => z.startsWith(pre)).sort().map(z => ({ zip: z }))) });
  }
  if (url.includes('/rest/v1/communities') && url.includes('zip_codes=ov.')) {
    const zs = decodeURIComponent((url.match(/zip_codes=ov\.(%7B[^&]*%7D)/) || [])[1] || '').replace(/[{}]/g, '').split(',');
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(zs.flatMap(z => COMMUNITIES[z] || [])) });
  }
  if (url.includes('/rest/v1/communities')) {
    const z = zipOf(url); if (DELAY[z]) await sleep(DELAY[z]);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COMMUNITIES[z] || []) });
  }
  if (url.includes('/rest/v1/') || url.includes('/rpc/'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  if (url.includes('leaflet@1.9.4/dist/leaflet.js') || url.includes('leaflet@1.9.4/dist/leaflet.css')) {
    const css = url.endsWith('.css');
    let local = null;
    try { local = require.resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch (e) { local = null; }
    if (!local) return route.continue();
    return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript', body: await readFile(local, 'utf8') });
  }
  if (url.includes('cdn.jsdelivr.net')) {
    const kind = url.endsWith('.css') ? 'text/css' : 'text/javascript';
    return route.fulfill({ status: 200, contentType: kind, body: kind === 'text/css' ? '' :
      'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(n,a){if(n==="app_zcta_boundary"){window.__ZCTA_CALLS=(window.__ZCTA_CALLS||[]).concat([a&&a.p_zip]);var z=a&&a.p_zip;var PZ={"98684":[-122.52,45.63],"07001":[-74.27,40.58],"85083":[-112.16,33.74],"64166":[-94.52,39.32],"48854":[-84.46,42.58],"19475":[-75.57,40.18]};var sq=function(x,y){return[[[x-0.03,y-0.02],[x+0.03,y-0.02],[x+0.03,y+0.02],[x-0.03,y+0.02],[x-0.03,y-0.02]]];};if(PZ[z])return Promise.resolve({data:{zip:z,status:"boundary_complete",srid:4326,geometry:{type:"Polygon",coordinates:sq(PZ[z][0],PZ[z][1])}},error:null});if(z==="52638")return Promise.resolve({data:{zip:z,status:"boundary_complete",srid:4326,geometry:{type:"Polygon",coordinates:sq(-91.0,40.8)}},error:null});if(z==="20171")return Promise.resolve({data:{zip:z,status:"boundary_complete",srid:4326,geometry:{type:"Polygon",coordinates:sq(-77.3645,38.9506)}},error:null});if(z==="20170")return Promise.resolve({data:{zip:z,status:"boundary_complete",srid:4326,geometry:{type:"MultiPolygon",coordinates:[sq(-77.38,38.97)]}},error:null});return Promise.resolve({data:{zip:z,status:"not_measured",geometry:null},error:null});}return Promise.resolve({data:null,error:null});},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};' });
  }
  if (url.includes('tile.openstreetmap'))
    return route.fulfill({ status: 200, contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});




const st = () => page.evaluate(() => ({
  sites: (window.__HS_SITES || []).length,
  resultsShown: getComputedStyle(document.getElementById('results')).display !== 'none',
  h1: document.querySelector('.head h1').textContent,
  status: document.getElementById('status').textContent,
  center: window.__HS_VERIFY && window.__HS_VERIFY.zipBoundary,
  sugg: null }));
async function load(path) {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(700);
}
const geocodeCalls = [];
page.on('request', r => { if (r.url().includes('geocode-address')) geocodeCalls.push(r.url()); });

await load('/development-map.html?zip=20171');
let o = await st();
ok(o.sites > 0 && /Herndon/.test(o.h1), '1: starting place (20171) shows its records', JSON.stringify(o));

const submitEnter = () => page.evaluate(() => document.getElementById('form').requestSubmit());
const waitBoundary = (z) => page.waitForFunction((zz) => window.__HS_VERIFY && window.__HS_VERIFY.zipBoundary === zz, z, { timeout: 15000 }).catch(() => {});
const note = () => page.evaluate(() => { var n = document.getElementById('zipNote'); return n && !n.hidden ? n.textContent : null; });
const suggList = () => page.evaluate(() => { var b = document.getElementById('zipSuggest'); return b && !b.hidden ? Array.from(b.querySelectorAll('button')).map(x => x.textContent) : null; });
async function typeZip(v) {
  await page.fill('#addr', v);
  await page.waitForFunction(() => { var b = document.getElementById('zipSuggest'); return b && !b.hidden; }, null, { timeout: 5000 }).catch(() => {});
}

// 2. type-ahead from three digits; ZIPs stay strings (leading zero kept)
await typeZip('526');
ok(JSON.stringify(await suggList()) === JSON.stringify(['52638 — Middletown, IA']), '2: "526" suggests "52638 — Middletown, IA"', JSON.stringify(await suggList()));
await typeZip('070');
ok(JSON.stringify(await suggList()) === JSON.stringify(['07001 — Avenel, NJ']), '2b: "070" suggests 07001 with its leading zero', JSON.stringify(await suggList()));
await page.fill('#addr', '52');
await page.waitForTimeout(300);
ok(await suggList() === null, '2c: two digits offer nothing');

// 3. Enter locates the ZIP, never calls the address geocoder, and clears the old place
await typeZip('52638');
await submitEnter();
await waitBoundary('52638'); await page.waitForTimeout(500);
o = await st();
ok(geocodeCalls.length === 0, '3: a ZIP never goes to the address geocoder', String(geocodeCalls.length));
ok(o.center === '52638' && /Middletown/.test(o.h1) && !/Herndon/.test(o.h1) && o.sites === 0, '3b: 52638 outline drawn, heading names Middletown, zero records, old place gone', JSON.stringify(o));
const pins = await page.evaluate(() => document.querySelectorAll('#map .leaflet-marker-icon, #map .leaflet-marker-pane > *').length);
ok(pins === 0, '3c: no old pins on the map', String(pins));

ok(!/no mapped area/.test(o.status) && !/no mapped area/.test(await page.evaluate(() => document.body.innerText)),
  '3d: a ZIP WITH a polygon never shows the "no mapped area" line');

// 4. the search icon (the real click) and a suggestion click both work
await typeZip('85083');
await page.click('#go');
await waitBoundary('85083'); await page.waitForTimeout(400);
o = await st();
ok(o.center === '85083' && /Phoenix/.test(o.h1), '4: the search-icon click loads 85083', JSON.stringify(o));
await typeZip('20171');
await page.click('#zipSuggest button');
await page.waitForFunction(() => (window.__HS_SITES || []).length > 0, null, { timeout: 15000 }).catch(() => {});
o = await st();
ok(o.sites > 0 && /Herndon/.test(o.h1) && o.center === '20171', '4b: clicking a suggestion loads that ZIP', JSON.stringify(o));

// 5. rapid switching: a slow first search never overwrites a faster second one
DELAY['64166'] = 1500;
await page.fill('#addr', '64166'); await submitEnter();
await page.fill('#addr', '19475'); await submitEnter();
await waitBoundary('19475'); await page.waitForTimeout(2200);
o = await st();
ok(o.center === '19475' && /Spring City/.test(o.h1) && !/Kansas City/.test(o.h1), '5: the late 64166 answer is discarded; 19475 stays', JSON.stringify(o));
const calls = await page.evaluate(() => window.__ZCTA_CALLS || []);
ok(calls.lastIndexOf('19475') > calls.lastIndexOf('64166') || !calls.includes('64166'), '5b: 64166 never drew over 19475', JSON.stringify(calls.slice(-4)));
delete DELAY['64166'];

// 6. no community row, but a polygon: the ZIP is located and the empty state is honest
await page.fill('#addr', '98684'); await submitEnter();
await waitBoundary('98684'); await page.waitForTimeout(500);
o = await st();
ok(o.center === '98684' && o.h1 === 'Development in ZIP 98684' && o.sites === 0 && /no development records for ZIP 98684/.test(await note() || ''),
  '6: polygon-only ZIP: heading "Development in ZIP 98684", outline, empty state', JSON.stringify(o) + ' ' + await note());

// 7. no community row and no polygon: "no measured boundary", nothing from the previous ZIP
await page.fill('#addr', '99999'); await submitEnter();
await page.waitForTimeout(900);
o = await st();
ok(o.center === null && o.h1 === 'Development in ZIP 99999' && o.sites === 0 && !o.resultsShown && /no measured boundary/.test(await note() || ''),
  '7: no polygon: heading, "no measured boundary", no outline, no stale records', JSON.stringify(o) + ' ' + await note());

// 8. invalid input: a clear message and nothing stale left (4 digits, 6 digits, 00000)
for (const [v, re] of [['5263', /five digits.*has 4/], ['526381', /five digits.*has 6/], ['00000', /not a ZIP code/]]) {
  await page.fill('#addr', '20171'); await submitEnter(); await page.waitForTimeout(700);
  await page.fill('#addr', v); await submitEnter(); await page.waitForTimeout(500);
  o = await st();
  ok(!o.resultsShown && o.sites === 0 && o.center === null && !/Herndon/.test(o.h1) && re.test(o.status), '8: "' + v + '" gives a clear message and clears the old place', JSON.stringify(o));
}
ok(geocodeCalls.length === 0, '8b: invalid ZIPs never reach the address geocoder', String(geocodeCalls.length));

// 9. ZIP -> address -> ZIP
await page.fill('#addr', ADDR_TEXT); await submitEnter(); await page.waitForTimeout(2000);
o = await st();
ok(geocodeCalls.length === 1 && o.sites > 0, '9: an address still geocodes and renders', JSON.stringify(o));
await page.fill('#addr', '07001'); await submitEnter();
await waitBoundary('07001'); await page.waitForTimeout(500);
o = await st();
ok(o.center === '07001' && /Avenel/.test(o.h1) && o.sites === 0 && geocodeCalls.length === 1, '9b: address -> ZIP shows only 07001 (leading zero kept), no address records', JSON.stringify(o));
await page.fill('#addr', '48854'); await submitEnter(); await waitBoundary('48854');
o = await st();
ok(o.center === '48854' && /Mason/.test(o.h1), '9c: ZIP -> ZIP (48854)', JSON.stringify(o));

// 9d. the "no mapped area" line is for a ZIP WITHOUT a polygon (a ZIP page, no Census area)
await page.fill('#addr', '96799'); await submitEnter(); await page.waitForTimeout(1000);
const bodyText = await page.evaluate(() => document.body.innerText);
o = await st();
ok(o.center === null && /no mapped area/.test(bodyText), '9d: a ZIP without a polygon shows "no mapped area" and draws no outline', JSON.stringify(o));
ok(!/no mapped area/.test(await (async () => { await page.fill('#addr', '07001'); await submitEnter(); await waitBoundary('07001'); await page.waitForTimeout(400); return page.evaluate(() => document.body.innerText); })()),
  '9e: switching to a polygon ZIP removes that line');

// 10. address no-match clears old results (the original defect)
await page.route('**/functions/v1/geocode-address', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"match":null}' }));
await page.fill('#addr', 'nowhere at all'); await submitEnter(); await page.waitForTimeout(1200);
o = await st();
ok(!o.resultsShown && o.sites === 0 && /couldn't find that address/.test(o.status), '10: address no-match leaves no stale results', JSON.stringify(o));

// 11. layout: the suggestion list and the search icon, desktop and phone
for (const [w, h, label] of [[1280, 900, 'desktop 1280'], [375, 800, 'phone 375']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(base + '/development-map.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await typeZip('526');
  const g = await page.evaluate(() => {
    var b = document.querySelector('#zipSuggest button'), go = document.getElementById('go');
    var rb = b && b.getBoundingClientRect(), rg = go.getBoundingClientRect();
    return { sw: rb ? rb.right : null, sh: rb ? rb.height : null, gr: rg.right, gl: rg.left, gw: rg.width,
      overflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  ok(g.sw !== null && g.sw <= w && g.sh >= 44 && g.gl >= 0 && g.gr <= w && g.gw >= 40 && !g.overflow, '11: ' + label + ': suggestion inside the viewport (>=44px tall), icon visible, no sideways scroll', JSON.stringify(g));
}

ok(pageErrors.length === 0, '12: no page errors', pageErrors.join(' | '));
await browser.close(); srv.close();
console.log(fails ? fails + ' FAILED' : 'map1-zip-search: all checks passed');
process.exit(fails ? 1 : 0);

// MAP 1 — A REVIEWED DEVELOPMENT PAGE AS ONE POINT (2026-11-12). Harness copied from map1-zip-outline.
// The build's development/map-index.json names one approved approximate location per published page; Map 1
// draws it as one marker that a resident can select, whose popup says it is approximate (not a site or a
// boundary) and links the project page. It is not a record: no count, list or filter includes it.
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
  try { const body = await readFile(p); s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/plain' }); s.end(body); }
  catch { s.writeHead(404); s.end('nope'); }
});
await new Promise(r => srv.listen(8847, '127.0.0.1', r));
const base = 'http://127.0.0.1:8847';

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
const COMMUNITIES = { '20171': [{ name: 'Herndon (20171)', level: 'zip', county: 'Fairfax', state: 'VA' }] };
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
const window_calls = [];
const PT = { path: '/development/va/herndon-campus/', name: 'Herndon campus <test>', lat: 38.9520, lng: -77.3600,
  basis: 'Placed from the agency\u2019s written directions to the site.' };
let MAP_INDEX = { schema: 'development-map-index/1', zips: { '20171': [PT] } };
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
const zipOf = (url) => (url.match(/(?:zip=eq\.|%7B)(\d{5})/) || [])[1] || null;

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base + '/development/map-index.json')) {
    window_calls.push(url);
    return MAP_INDEX ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MAP_INDEX) })
                     : route.fulfill({ status: 404, body: 'nope' });
  }
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
      body: JSON.stringify(ZIP_AUTH[z] || { zip: z, mode: 'development', status: 'not_measured', projects: null, markers: null }) });
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
  if (url.includes('/rest/v1/communities'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COMMUNITIES[zipOf(url)] || []) });
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
      'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(n,a){if(n==="app_zcta_boundary"){window.__ZCTA_CALLS=(window.__ZCTA_CALLS||[]).concat([a&&a.p_zip]);var z=a&&a.p_zip;var sq=function(x,y){return[[[x-0.03,y-0.02],[x+0.03,y-0.02],[x+0.03,y+0.02],[x-0.03,y+0.02],[x-0.03,y-0.02]]];};if(z==="20171")return Promise.resolve({data:{zip:z,status:"boundary_complete",srid:4326,geometry:{type:"Polygon",coordinates:sq(-77.3645,38.9506)}},error:null});if(z==="20170")return Promise.resolve({data:{zip:z,status:"boundary_complete",srid:4326,geometry:{type:"MultiPolygon",coordinates:[sq(-77.38,38.97)]}},error:null});return Promise.resolve({data:{zip:z,status:"not_measured",geometry:null},error:null});}return Promise.resolve({data:null,error:null});},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};' });
  }
  if (url.includes('tile.openstreetmap'))
    return route.fulfill({ status: 200, contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});




async function load(path) {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(900);
}
const pins = () => page.evaluate(() => document.querySelectorAll('#map .rv-pin').length);

// 1. the full ZIP map, signed out: one marker, selectable, popup qualified, links the page
await load('/homesignalmap.html?zip=20171');
ok(window_calls.length >= 1, '1: Map 1 asks for development/map-index.json', JSON.stringify(window_calls));
ok(await pins() === 1, '1b: one reviewed-project marker is drawn', String(await pins()));
const before = await page.evaluate(() => ({ sites: window.__HS_SITES.length, kpi: (document.getElementById('kDev') || {}).textContent || '' }));
await page.click('#map .rv-pin');
await page.waitForSelector('#map .leaflet-popup-content', { timeout: 5000 }).catch(() => {});
const pop = await page.evaluate(() => (document.querySelector('#map .leaflet-popup-content') || {}).innerHTML || '');
ok(/Herndon campus &lt;test&gt;/.test(pop), '1c: selecting it opens its popup, name escaped', pop.slice(0, 200));
ok(/Approximate location: one point placed from the records\. It is not a surveyed site or a project boundary\./.test(pop),
  '1d: the popup says approximate, not a site or a boundary');
const href = await page.evaluate(() => { const a = document.querySelector('#map .leaflet-popup-content a.rv-link'); return a ? a.getAttribute('href') : null; });
ok(href === '/development/va/herndon-campus/', '1e: the popup links the project page', String(href));
const title = await page.evaluate(() => { const m = document.querySelector('#map .leaflet-marker-icon .rv-pin'); return m ? m.closest('.leaflet-marker-icon').getAttribute('title') : null; });
ok(/approximate location, reviewed development page/.test(String(title)), '1f: the marker has a text title for keyboard and screen readers', String(title));
const sitesNow = await page.evaluate(() => window.__HS_SITES.length);
ok(sitesNow === before.sites && !(await page.evaluate(() => window.__HS_SITES.some((s) => /herndon campus/i.test(String(s.label || s.name || ''))))),
  '1g: the point is not added to the records the page counts', JSON.stringify({ before, sitesNow }));

// 2. another ZIP: no marker
await load('/homesignalmap.html?zip=99999');
ok(await pins() === 0, '2: a ZIP the index does not name draws no marker');

// 3. the ZIP-page embed draws it too
await load('/homesignalmap.html?embed=1&zip=20171');
ok(await pins() === 1, '3: the ZIP embed draws it');

// 4. no index file (404): nothing, and no error
MAP_INDEX = null;
await load('/homesignalmap.html?zip=20171');
ok(await pins() === 0, '4: a missing index draws nothing');

ok(pageErrors.length === 0, '5: no page errors', pageErrors.join(' | '));
await browser.close(); srv.close();
console.log(fails ? fails + ' FAILED' : 'map1-reviewed-project: all checks passed');
process.exit(fails ? 1 : 0);

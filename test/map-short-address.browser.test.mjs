// THE SHORT MAP ADDRESS (founder, 2026-10-22): Map 1 shows /map/<zip> in the address bar.
//
// Proves, in a real browser, against the shipped homesignalmap.html + shell.js:
//   1. /homesignalmap.html?zip=<zip>&utm_* is shown as /map/<zip>?utm_* , the page still renders the
//      ZIP's records, and nothing it loads afterwards resolves under /map/ (the <base href="/">);
//   2. a filter click keeps /map/<zip> and adds its own parameter;
//   3. RELOADING that address goes /map/<zip> -> 301 /map/<zip>/, which IS the map for that ZIP
//      (scripts/gen_zip_pages.py MapTemplate, 2026-10-22), with its filters and no second hop;
//   4. an embed, an address search and a lat/lng point keep their own address;
//   5. the readers that ask "which ZIP does this URL name" read the path (HS.urlZip etc.).
// Run: node test/map-short-address.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mapRoute } from './lib/serve-page.mjs';
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
const served = [];
const srv = createServer(async (q, s) => {
  const path = q.url.split('?')[0];
  served.push(path);
  const mr = mapRoute(q.url);          // 301 /map/<zip> -> /map/<zip>/ -> the generated forward, like GitHub Pages
  if (mr) { s.writeHead(mr.status, mr.headers); s.end(mr.body); return; }
  const p = normalize(join(REPO, decodeURIComponent(path)));
  let body;
  try { body = await readFile(p); } catch { s.writeHead(404); s.end('nope'); return; }
  s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/plain' }); s.end(body);
});
await new Promise(r => srv.listen(8831, '127.0.0.1', r));
const base = 'http://127.0.0.1:8831';

// ── production records ──────────────────────────────────────────────────────────────
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

const ZIP_AUTH = { '20173': {
  zip: '20173', mode: 'development', status: 'boundary_complete',
  projects: [{ source_key: 'arcgis:fairfax:P-1', project_ref: 'arcgis:fairfax:P-1',
    name: 'Pennhurst Data Centers', type: 'Data Center', status: 'Approved',
    registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/x',
    submitted_at: '2026-01-04', date_kind: 'filed', impact_score: null, impact_dimensions: null }],
  markers: [{ project_ref: 'arcgis:fairfax:P-1', lat: 38.95065, lng: -77.36458,
    marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] },
  '20171': { zip: '20171', mode: 'development', status: 'boundary_complete',
  projects: [{ source_key: 'arcgis:fairfax:P-1', project_ref: 'arcgis:fairfax:P-1',
    name: 'Pennhurst Data Centers', type: 'Data Center', status: 'Approved',
    registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/x',
    submitted_at: '2026-01-04', date_kind: 'filed', impact_score: null, impact_dimensions: null }],
  markers: [{ project_ref: 'arcgis:fairfax:P-1', lat: 38.95065, lng: -77.36458,
    marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] } };
// 20172 is the PRODUCT-TRUTH control: a ZIP with no records at all. "Turn a type back on to
// show records" must NOT appear there — it would promise records that do not exist.
const ZIP_ROW = {
  '20171': [{ zip: '20171', home_lat: 38.9506, home_lng: -77.3645,
    counts: { facilities: 2, development: 1 }, sites: [DUAL, PLAIN_FAC, DC_PROJECT],
    refreshed_at: '2026-09-06T00:00:00Z', facilities_unavailable: false }],
  '20172': [{ zip: '20172', home_lat: 38.9506, home_lng: -77.3645,
    counts: { facilities: 0, development: 0 }, sites: [],
    refreshed_at: '2026-09-06T00:00:00Z', facilities_unavailable: false }],
  // 20173 is the PREDICATE control: records exist, but NOT ONE of them is regulatory. It
  // is the only shape that tells "every Type chip is off" apart from "every category key
  // is off" — with the Type row empty and the regulatory switch ON, this ZIP's map is
  // genuinely blank while the regulatory key is still true. A note keyed on
  // allCategoriesOff() would stay silent over that blank map.
  '20173': [{ zip: '20173', home_lat: 38.9506, home_lng: -77.3645,
    counts: { facilities: 0, development: 1 }, sites: [DC_PROJECT],
    refreshed_at: '2026-09-06T00:00:00Z', facilities_unavailable: false }]
};
const COMMUNITIES = {
  '20171': [{ name: 'Herndon (20171)', level: 'zip', county: 'Fairfax', state: 'VA' }],
  '20172': [{ name: 'Herndon (20172)', level: 'zip', county: 'Fairfax', state: 'VA' }],
  '20173': [{ name: 'Herndon (20173)', level: 'zip', county: 'Fairfax', state: 'VA' }]
};

const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.HS_CHROME) launchOpts.executablePath = process.env.HS_CHROME;
const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
const zipOf = (url) => (url.match(/(?:zip=eq\.|%7B)(\d{5})/) || [])[1] || null;

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('/rpc/app_zip_projects_markers')) {
    let z = '';
    try { z = String(JSON.parse(route.request().postData() || '{}').p_zip || ''); } catch (e) { z = ''; }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(ZIP_AUTH[z] || { zip: z, mode: 'development', status: 'not_measured', projects: null, markers: null }) });
  }
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
      'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(){return Promise.resolve({data:null,error:null});},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};' });
  }
  if (url.includes('tile.openstreetmap'))
    return route.fulfill({ status: 200, contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

const wait = async () => {
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 }).catch(() => ok(false, 'the map page finished loading'));
  await page.waitForTimeout(600);
};
const pins = () => page.evaluate(() => document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)').length);
const here = () => { const u = new URL(page.url()); return u.pathname + u.search; };

// ── 1 ────────────────────────────────────────────────────────────────────────────────────
await page.goto(base + '/homesignalmap.html?zip=20171&utm_source=bluesky&utm_campaign=maps', { waitUntil: 'domcontentloaded' });
await wait();
ok(here() === '/map/20171?utm_source=bluesky&utm_campaign=maps', '1a the address bar reads /map/20171 with the campaign tags kept', here());
ok((await pins()) === 3, '1b the ZIP\'s three records render', await pins());
ok(await page.evaluate(() => document.baseURI === location.origin + '/'), '1c the page resolves relative addresses from the site root');
const underMap = served.filter(p => p.startsWith('/map/'));
ok(underMap.length === 0, '1d nothing the page loaded was requested under /map/', underMap.join(','));
const r1 = await page.evaluate(() => ({ urlZip: HS.urlZip(), kind: HS.zipCoveragePageKind(location.pathname),
  zipPage: HS.isZipPagePath(location.pathname), family: HS.pageFamily ? HS.pageFamily(location.pathname) : 'n/a', stateZip: HS.state && HS.state.zip }));
ok(r1.urlZip === '20171', '1e HS.urlZip() reads the ZIP from the path', r1.urlZip);
ok(r1.kind === 'map' && r1.zipPage === true, '1f /map/<zip> is a map page and a ZIP page', JSON.stringify(r1));
ok(r1.family === 'map', '1g analytics counts it as the map page', r1.family);
ok(String(r1.stateZip) === '20171', '1h the viewed ZIP is 20171', r1.stateZip);

// ── 2 ────────────────────────────────────────────────────────────────────────────────────
await page.evaluate(() => { const c = document.querySelector('#mapkeyShapes .typechip[data-cat="industrial"]'); if (c) c.click(); });
await page.waitForTimeout(300);
const u2 = new URL(page.url());
ok(u2.pathname === '/map/20171' && u2.searchParams.has('types'), '2 a filter click keeps /map/20171 and records its own parameter', here());

// ── 3 ────────────────────────────────────────────────────────────────────────────────────
const typesBefore = u2.searchParams.get('types');
served.length = 0;
await page.reload({ waitUntil: 'domcontentloaded' });
await wait();
const u3 = new URL(page.url());
ok(u3.pathname === '/map/20171/', '3a a reload lands on the map document /map/20171/', here());
ok(u3.searchParams.get('types') === typesBefore && u3.searchParams.get('utm_source') === 'bluesky' && !u3.searchParams.has('zip'),
  '3b with the same filters and tags, and no ?zip=', here());
ok(served.includes('/map/20171') && served.includes('/map/20171/') && !served.includes('/homesignalmap.html')
  && served.some(p => /^\/map1\/page\.[0-9a-f]{8}\.js$/.test(p)),
  '3c through the 301 to the map document and its shared runtime, never homesignalmap.html', served.filter(p => /map/.test(p)).join(','));
const off = await page.evaluate(() => { const c = document.querySelector('#mapkeyShapes .typechip[data-cat="industrial"] input'); return c ? !c.checked : null; });
ok(off === true, '3d the Type filter the visitor set is still off after the reload');
ok((await pins()) > 0, '3e records still render', await pins());

// ── 4 ────────────────────────────────────────────────────────────────────────────────────
for (const [q, why] of [['?zip=20171&embed=1', 'an embed'], ['?zip=20171&addr=1+Main+St', 'an address search'], ['?zip=20171&lat=38.95&lng=-77.36', 'a lat/lng point']]) {
  await page.goto(base + '/homesignalmap.html' + q, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  ok(new URL(page.url()).pathname === '/homesignalmap.html', '4 ' + why + ' keeps its own address', here());
}

ok(pageErrors.length === 0, '5 no page errors', pageErrors.join(' | '));
await browser.close(); srv.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);

// MAP 1 — THE FOUR LIST COLUMNS FOLLOW THE STATUS, PROJECT TYPE AND REGULATORY FILTERS (2026-11-15).
//
// The founder found ZIP 78521 with only Proposed + Data center + Roads & infrastructure checked
// while the Completed / Approved / Lifecycle unknown columns still listed every record, EPA
// industrial sites included. Before this change the columns were drawn once at load from the
// unfiltered rows; only the map followed the chips. Now renderLists() draws them through the
// same siteVisible() the map uses, and applyFilter() calls it on every chip change.
//
// Harness and fixtures copied from map1-regulatory-toggle.browser.test.mjs (verbatim production
// rows, ZIP 20171).
//
// Run: node test/map1-lists-follow-filters.browser.test.mjs
// Run: node test/map1-regulatory-toggle.browser.test.mjs
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
await new Promise(r => srv.listen(8823, '127.0.0.1', r));
const base = 'http://127.0.0.1:8823';

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
// The ZIP-authoritative project set. It is NOT optional scaffolding: zipAuthMergeSites
// drops a point-scope report site that no authoritative project claims, so without this
// route the plain data-centre PROJECT never reaches the map and the suite would be
// measuring a two-record population while claiming three.
const ZIP_AUTH = { '20171': { zip: '20171', mode: 'development', status: 'boundary_complete',
  projects: [{ source_key: 'arcgis:fairfax:P-1', project_ref: 'arcgis:fairfax:P-1',
    name: 'Pennhurst Data Centers', type: 'Data Center', status: 'Approved',
    registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/x',
    submitted_at: '2026-01-04', date_kind: 'filed', impact_score: null, impact_dimensions: null }],
  markers: [{ project_ref: 'arcgis:fairfax:P-1', lat: 38.95065, lng: -77.36458,
    marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] } };

// ── ADDRESS-MODE FIXTURES ─────────────────────────────────────────────────────────
// The resident's journey in the bug report was ADDRESS mode, not ZIP mode, and the two
// differ in the 3D painter: address mode applies a radius cull that ZIP mode does not.
// Same three production records, re-placed inside the 1-mile default radius so the cull
// keeps them; e/n are what siteEN reads in address mode, and the lat/lng agree with them.
const ADDR_TEXT = '13313 Coomes Dr, Del Valle, TX';
const ADDR_HOME = { lat: 38.9506, lng: -77.3645 };
const ADDR_DUAL = Object.assign({}, DUAL, { e: 0.22, n: 0.18, lat: 38.95321, lng: -77.36040 });
const ADDR_FAC = Object.assign({}, PLAIN_FAC, { e: 0.30, n: 0.42, lat: 38.95669, lng: -77.35891 });
// The project reaches address mode only through the canonical N5 radius RPC — n5MergeSites
// drops the report engine's own development points on purpose, so mocking it into `sites`
// would prove nothing about the path production uses.
const N5_ROWS = [{ source_key: 'arcgis:fairfax:P-1', feature_id: 'f1', distance_mi: 0.39,
  marker_lat: 38.95495, marker_lng: -77.35984, provenance: 'source_point',
  geometry_type: 'Point', registry_id: 'fairfax-active-site-construction', has_more: false }];
const N5_PROJECTS = [{ source_key: 'arcgis:fairfax:P-1', name: 'Pennhurst Data Centers',
  type: 'Data Center', status: 'Approved', source_ref: 'https://plus.fairfaxcounty.gov/x',
  registry_id: 'fairfax-active-site-construction', submitted_at: '2026-01-04',
  date_kind: 'filed', impact_score: null, impact_dimensions: null }];

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
      body: JSON.stringify({ match: { lat: ADDR_HOME.lat, lng: ADDR_HOME.lng, matchedAddress: ADDR_TEXT } }) });
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

await page.goto(base + '/homesignalmap.html?zip=20171', { waitUntil: 'domcontentloaded' });

const lists = () => page.evaluate(() => {
  const t = (id) => ((document.getElementById(id) || {}).textContent || '');
  return { built: t('builtList'), unknown: t('unknownList'), appr: t('apprList'), prop: t('propList') };
});
const typeBox = (cat) => '#mapkeyShapes .typechip[data-cat="' + cat + '"] input';
const stageBox = (id) => '#mapkey .stagechip[data-stage-id="' + id + '"] input';
// The resident clicks the CHIP (a <label> wrapping the box); the label forwards the click.
const click = async (sel) => { await page.click(sel.replace(/ input$/, '')); await page.waitForTimeout(250); };
const pinCount = () => page.evaluate(() => document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)').length);

await page.waitForSelector('#unknownList .rec', { timeout: 30000 });
await page.waitForSelector('#mapkeyShapes .typechip[data-cat]', { timeout: 30000 });
await page.waitForTimeout(400);

// 0. All filters on: every record listed, as before.
{
  const l = await lists();
  ok(/ANDURIL/.test(l.unknown) && /CORESITE/.test(l.unknown), '0: both EPA records listed under Lifecycle unknown', JSON.stringify(l).slice(0, 200));
  ok(/Pennhurst/.test(l.appr), '0b: the approved data-centre project is listed under Approved');
  ok(!/hidden by your/.test(l.unknown + l.appr), '0c: no "hidden" note while nothing is filtered');
}

// 1. Turn OFF the Industrial type: the industrial EPA record leaves the list, as its pin leaves the map.
const cats = await page.evaluate(() => Array.from(document.querySelectorAll('#mapkeyShapes .typechip[data-cat]')).map(c => c.getAttribute('data-cat')));
ok(cats.includes('industrial') && cats.includes('datacenter'), '1-pre: type chips carry data-cat industrial and datacenter', cats.join(','));
const pins0 = await pinCount();
await click(typeBox('industrial'));
{
  const l = await lists();
  ok(!/ANDURIL/.test(l.unknown), '1: Industrial off -> ANDURIL (industrial) is no longer listed', l.unknown.slice(0, 200));
  ok(/CORESITE/.test(l.unknown), '1b: ...the data-centre EPA record is still listed');
  ok(/1 record here is hidden by your Project Type or Regulatory filters\./.test(l.unknown), '1c: the column says one record is hidden by the type filter', l.unknown.slice(0, 300));
  ok((await pinCount()) === pins0 - 1, '1d: the map dropped exactly one pin too', pins0 + ' -> ' + (await pinCount()));
}

// 2. Turn OFF the Approved status: the Approved column says why it is empty, not "Nothing approved".
await click(stageBox('approved'));
{
  const l = await lists();
  ok(!/Pennhurst/.test(l.appr), '2: Approved off -> Pennhurst is not listed', l.appr);
  ok(/1 record here is hidden by your Status filter\. Check “Approved” above to list it\./.test(l.appr), '2b: the column names the Status filter', l.appr);
  ok(!/Nothing approved on record/.test(l.appr), '2c: it never claims nothing is approved here');
}

// 3. Turn both back on: the lists return to the full set.
await click(stageBox('approved'));
await click(typeBox('industrial'));
{
  const l = await lists();
  ok(/ANDURIL/.test(l.unknown) && /Pennhurst/.test(l.appr), '3: re-checking restores both rows', JSON.stringify(l).slice(0, 200));
  ok(!/hidden by your/.test(l.unknown + l.appr), '3b: and no hidden note remains');
}

// 4. Data center only: the industrial EPA record is hidden; the two data-centre records stay.
for (const c of cats) if (c !== 'datacenter') {
  const on = await page.evaluate((s) => document.querySelector(s).checked, typeBox(c));
  if (on) await click(typeBox(c));
}
{
  const l = await lists();
  ok(!/ANDURIL/.test(l.unknown) && /CORESITE/.test(l.unknown) && /Pennhurst/.test(l.appr),
    '4: Data center only -> lists hold exactly the data-centre records', JSON.stringify(l).slice(0, 300));
}

// 5. The list hook agrees with the map: every listed row is a drawn record.
{
  const st = await page.evaluate(() => window.__HS_LISTS || null);
  ok(st && Array.isArray(st.unknownList) && st.unknownList.length === 1 && st.apprList.length === 1,
    '5: __HS_LISTS reports the listed rows (1 unknown, 1 approved)', JSON.stringify(st));
}

ok(pageErrors.length === 0, '6: no uncaught page errors', JSON.stringify(pageErrors));
await browser.close();
srv.close();
if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('map1-lists-follow-filters: all checks passed');

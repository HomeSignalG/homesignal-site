// MAP 1 — STATE CLEANUP SITES, driven the way a resident drives them (founder decision 2026-10-21).
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
  try { s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/plain' }); s.end(await readFile(p)); }
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
      'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(){return Promise.resolve({data:null,error:null});},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};' });
  }
  if (url.includes('tile.openstreetmap'))
    return route.fulfill({ status: 200, contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});


const cleanupMarkers = () => page.evaluate(() =>
  document.querySelectorAll('#map .leaflet-marker-icon [title^="State cleanup site"]').length);
const allMarkers = () => page.evaluate(() =>
  document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)').length);
async function load(qs) {
  // Each step starts from the default filters (the page remembers chip state per viewer).
  try { await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }); } catch (e) {}
  await page.goto(base + '/homesignalmap.html?zip=20171' + (qs || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(600);
}

await load('');
const st = await page.evaluate(() => window.__HS_STATE_CLEANUP);
ok(st && st.status === 'complete' && st.sites === 3 && st.pins === 2, '0: the reader was asked and answered; counts are of sites (3), two pins', JSON.stringify(st));
ok(await cleanupMarkers() === 1, '1: the two ZIP members at one point are ONE pin (the outside site is not drawn)', await cleanupMarkers());
const total0 = await allMarkers();
ok(total0 === 4, '1b: three project/facility markers plus one cleanup marker', total0);
const tile = await page.evaluate(() => document.getElementById('cFac').textContent.trim());
ok(tile === '2', '2: the Regulated facilities tile still counts only the two EPA facilities', tile);
const band = await page.evaluate(() => ({ hidden: document.getElementById('cleanupBand').hidden,
  text: document.getElementById('cleanupList').textContent }));
ok(!band.hidden && /CITGO/.test(band.text) && !/SONY/.test(band.text), '3: the cleanup band lists the member only', JSON.stringify(band));
ok(/Petroleum · Florida DEP status: Active/.test(band.text), '3b: in DEP\u2019s words', band.text);
ok(/CITGO TANK FARM/.test(band.text) && (band.text.match(/facility documents \(2 cleanup sites here\)/g) || []).length === 2,
  '3d: the band lists BOTH sites at the shared point, each saying its link covers 2', band.text);
const unknown = await page.evaluate(() => document.getElementById('unknownList').textContent);
ok(!/CITGO/.test(unknown), '3c: not listed as an EPA facility or a project');
const chip = await page.evaluate(() => { const b = document.getElementById('cleanupToggleBox');
  const c = document.getElementById('cleanupToggle');
  return b && c ? { checked: b.checked, inRegRow: !!c.closest('#mapkeyReg'), text: (c.querySelector('.t') || {}).textContent } : null; });
ok(chip && chip.checked && chip.inRegRow && chip.text === 'State cleanup sites', '4: the switch is in the Regulatory records row, on', JSON.stringify(chip));

// Type chips all off: projects and facilities go, the cleanup site stays.
await page.evaluate(() => { document.querySelectorAll('#mapkeyShapes .typechip input').forEach((b) => { if (b.checked) b.click(); }); });
await page.waitForTimeout(300);
ok(await cleanupMarkers() === 1, '5: no Type ticked — the cleanup site is still drawn');
// Status chips all off: still drawn.
await page.evaluate(() => { document.querySelectorAll('#mapkey .stagechip input').forEach((b) => { if (b.checked) b.click(); }); });
await page.waitForTimeout(300);
ok(await cleanupMarkers() === 1, '6: no Status ticked — the cleanup site is still drawn');
// Regulatory facilities off: still drawn.
await load('');
await page.click('#regToggle'); await page.waitForTimeout(300);
ok(await cleanupMarkers() === 1, '7: Regulatory facilities off — the cleanup site is still drawn');
// Its own switch off: only it goes.
await load('');
const before = await allMarkers();
await page.click('#cleanupToggle'); await page.waitForTimeout(300);
ok(before === 4 && await cleanupMarkers() === 0 && await allMarkers() === before - 1, '8: its own switch hides it and nothing else',
  (await allMarkers()) + ' of ' + before);
ok(/[?&]cleanup=0/.test(page.url()), '8b: the URL records it', page.url());
const typesStill = await page.evaluate(() => Array.from(document.querySelectorAll('#mapkeyShapes .typechip input')).every((b) => b.checked));
ok(typesStill, '8c: the Type chips are untouched');
await load('&cleanup=0');
ok(await cleanupMarkers() === 0, '9: ?cleanup=0 starts it hidden');
// The popup.
await load('');
const popup = await page.evaluate(() => {
  const x = (window.siteMarkers || []).find((m) => m.s && m.s.relevance === 'state_cleanup');
  if (!x) return null; x.m.openPopup();
  const el = document.querySelector('.leaflet-popup-content'); return el ? el.innerHTML : null;
});
ok(popup && /DepNexus/.test(popup) && /not a finding about any owner/.test(popup) && !/ECHO/.test(popup),
  '10: the popup links DEP\u2019s documents, carries the framing, claims nothing EPA', (popup || '').slice(0, 200));
ok(popup && /2 cleanup sites at this location/.test(popup) && /CITGO \(FORMER\)/.test(popup) && /CITGO TANK FARM/.test(popup)
  && /checked Oct 22, 2026/.test(popup), '10b: the one pin\u2019s popup lists both sites and the checked date', (popup || '').slice(0, 300));
ok(pageErrors.length === 0, '11: no page errors', pageErrors.join(' | '));

await browser.close(); srv.close();
console.log(fails ? fails + ' FAILED' : 'map1-state-cleanup: all checks passed');
process.exit(fails ? 1 : 0);

// MAP 1 — THE FACILITY COUNT WHEN EPA DID NOT ANSWER (2026-10-23, Washington audit step 4).
// A stored count above zero is shown with the day it was last confirmed
// (development_reports.facilities_refreshed_at), through HS.facilityCount in lib/templates.js.
// With no confirmed date the tile stays a dash. Harness copied from map1-state-cleanup.
//
// Run: node test/map1-facility-count-dated.browser.test.mjs
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
await new Promise(r => srv.listen(8834, '127.0.0.1', r));
const base = 'http://127.0.0.1:8834';

const DUAL = { e: 1.482, n: 1.664, lat: 38.94932, lng: -77.36519,
  src: 'EPA FRS · registry 110071955663', type: 'built', label: 'CORESITE - VA1 DATA CENTER',
  layer: 'datacenter', scope: 'point', registry_id: '110071955663',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110071955663' };
const PLAIN_FAC = { e: 1.82, n: 2.361, lat: 38.95942, lng: -77.35889,
  src: 'EPA FRS · registry 110072041130', type: 'built', label: 'ANDURIL INDUSTRIES, INC',
  layer: 'industrial', scope: 'point', registry_id: '110072041130',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110072041130' };
// One development_reports row per case; the page reads it through REST and the facility RPC.
const BASE_ROW = { zip: '20171', home_lat: 38.9506, home_lng: -77.3645,
  counts: { facilities: 2 }, sites: [DUAL, PLAIN_FAC], refreshed_at: '2026-10-22T00:00:00Z' };
let ZIP_ROW = {};
const setRow = (extra) => { ZIP_ROW = { '20171': [Object.assign({}, BASE_ROW, extra)] }; };
const COMMUNITIES = { '20171': [{ name: 'Herndon (20171)', level: 'zip', county: 'Fairfax', state: 'VA' }] };
const ZIP_AUTH = { '20171': { zip: '20171', mode: 'development', status: 'boundary_complete', projects: [], markers: [] } };
const CLEANUP = {};
const CLEANUP_MEMBER = {};
const ADDR_TEXT = 'x'; const ADDR_HOME = { lat: 38.9506, lng: -77.3645 };
const ADDR_DUAL = DUAL, ADDR_FAC = PLAIN_FAC;
const N5_ROWS = []; const N5_PROJECTS = [];
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



async function load() {
  try { await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }); } catch (e) {}
  await page.goto(base + '/homesignalmap.html?zip=20171', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  return page.evaluate(() => ({ n: document.getElementById('cFac').textContent.trim(),
    k: document.getElementById('kFac').textContent.trim(),
    note: (document.getElementById('covNote') || {}).textContent || '' }));
}

// 1. EPA answered: the count, the plain label, no outage note.
setRow({ facilities_unavailable: false, facilities_refreshed_at: '2026-10-22T00:00:00Z' });
let r = await load();
ok(r.n === '2' && !/last confirmed/.test(r.k) && !/did not answer/.test(r.note), '1: EPA answered: count 2, plain label', JSON.stringify(r));

// 2. EPA did not answer, stored count confirmed on Sep 14: the count with its date.
setRow({ facilities_unavailable: true, facilities_refreshed_at: '2026-09-14T12:00:00Z' });
r = await load();
ok(r.n === '2', '2a: the stored count is shown, not a dash', r.n);
ok(/last confirmed Sep 14, 2026$/.test(r.k), '2b: the tile says the day it was last confirmed', r.k);
ok(/did not answer/.test(r.note) && /last confirmed on Sep 14, 2026/.test(r.note), '2c: the note names the date', r.note);
ok(!/since 2026-08-09/.test(r.note), '2d: no fixed outage date', r.note);

// 3. EPA did not answer and there is no facility clock: a dash, never a number.
setRow({ facilities_unavailable: true, facilities_refreshed_at: null });
r = await load();
ok(r.n === '\u2014' && !/last confirmed/.test(r.k) && /cannot be confirmed/.test(r.note), '3: no confirmed date: dash and count-unknown note', JSON.stringify(r));

// 4. Back to an answered read on the same page: the label suffix does not linger.
setRow({ facilities_unavailable: false, facilities_refreshed_at: '2026-10-22T00:00:00Z' });
r = await load();
ok(r.n === '2' && !/last confirmed/.test(r.k), '4: label resets', r.k);

ok(pageErrors.length === 0, 'no page errors', pageErrors.join(' | '));
await browser.close(); srv.close();
if (fails) { console.error(fails + ' failure(s)'); process.exit(1); }
console.log('map1-facility-count-dated: all checks passed');

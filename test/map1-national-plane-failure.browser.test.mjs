// MAP 1 — THE NATIONAL PLANE CAN FAIL AND THE MAP MUST STILL WORK, VISIBLY DEGRADED.
//
// The offline suite (test/national-plane-failure-visibility.test.mjs) pins the RULE and
// the page's composition. This one drives the REAL page through each failure mode and
// measures what a resident actually gets — the only test that can prove "Map 1 does not
// crash", because a truth table cannot see a thrown exception in a Promise.all.
//
// WHAT IT MUST SHOW, per failure mode:
//   * the map still renders and the page throws NOTHING (pageerror is fatal here);
//   * the LOCAL records still draw — a national failure may not cost local coverage;
//   * no technical error string reaches the resident;
//   * window.__HS_NATIONAL_PLANE says which failure it was, with ZIP + time + fallback.
// And on a genuine zero: status 'ok', fallback false — NOT the same value as any failure.
//
// Run: node test/map1-national-plane-failure.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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

// A LOCAL record, so every case can prove the local pipeline survives a national failure.
const LOCAL_FAC = { e: 1.8, n: 2.3, lat: 39.0181, lng: -77.4561,
  src: 'EPA FRS · registry 110071955663', type: 'built', label: 'ANDURIL INDUSTRIES, INC',
  layer: 'industrial', scope: 'point', registry_id: '110071955663',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110071955663' };
const ZIP_ROW = [{ zip: '20147', home_lat: 39.0181, home_lng: -77.4561,
  counts: { facilities: 1 }, sites: [LOCAL_FAC], paywall: false,
  refreshed_at: '2026-09-15T00:00:00Z', facilities_unavailable: false }];
// One real eligible national record, shaped exactly as national_dc_zip_members returns it
// (national_dc_for_zip's row shape + the canonical per-row `zip_membership` verdict).
const NATL_OK = [{ source_key: 'osm:way/1188691868', source_name: 'OpenStreetMap',
  source_url: 'https://www.openstreetmap.org/way/1188691868',
  project_name: 'NTT Ashburn VA9 Data Center', developer_or_operator: 'NTT',
  raw_status: 'operational', normalized_status: 'operational', project_type: 'datacenter',
  lat: 39.0205, lng: -77.4602, location_text: null,
  location_precision: 'approximate_campus_area', distance_mi: null,
  last_seen_at: '2026-09-15T00:00:00Z', zip_membership: 'member' }];

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

/** Load ZIP 20147 with the national RPC answering however `natl` says. */
async function load(natl) {
  const page = await (await browser.newContext()).newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/rpc/national_dc_zip_members')) {
      if (natl.abort) return route.abort('connectionrefused');   // network / timeout
      return route.fulfill({ status: natl.status, contentType: natl.ct || 'application/json',
        body: natl.body });
    }
    if (url.includes('/rpc/app_zip_projects_markers'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ zip: '20147', mode: 'development', status: 'boundary_complete',
          projects: [], markers: [] }) });
    if (url.includes('/rpc/zip_mode_report_sites')) return fulfillZipModeReport(route, () => ZIP_ROW);
    if (url.includes('/rest/v1/development_reports'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ZIP_ROW) });
    // ── VENDOR MOCKS, verbatim from the established browser-suite convention
    // (test/map1-regulatory-toggle.browser.test.mjs). The first version of this file
    // answered jsDelivr with `[]`, so supabase-js never defined window.supabase, the
    // page's client was null, and EVERY case — including the two SUCCESS cases — died
    // on `TypeError: Cannot read properties of null (reading 'from')`. That is a
    // harness defect wearing the costume of a product defect: a national-plane bug
    // cannot break the success path, which is exactly what made it identifiable.
    if (url.includes('leaflet@1.9.4/dist/leaflet.js') || url.includes('leaflet@1.9.4/dist/leaflet.css')) {
      const css = url.endsWith('.css');
      let local = null;
      try { local = require.resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch (e) { local = null; }
      if (!local) return route.continue();
      return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript',
        body: await readFile(local, 'utf8') });
    }
    if (url.includes('cdn.jsdelivr.net')) {
      const kind = url.endsWith('.css') ? 'text/css' : 'text/javascript';
      return route.fulfill({ status: 200, contentType: kind, body: kind === 'text/css' ? '' :
        'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(){return Promise.resolve({data:null,error:null});},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};' });
    }
    if (url.includes('tile.openstreetmap'))
      return route.fulfill({ status: 200, contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
    // A PostgREST table read returns an ARRAY. The catch-all used to answer `{}`, which
    // made the page's own `(crows || []).some(...)` over /rest/v1/communities throw —
    // again in every case, success included. Match the real shape.
    if (url.includes('/rest/v1/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + '/homesignalmap.html?zip=20147', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForFunction(() => window.__HS_NATIONAL_PLANE !== undefined, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  const signal = await page.evaluate(() => window.__HS_NATIONAL_PLANE || null);
  const sites = await page.evaluate(() => (window.__HS_SITES || []).length);
  const mapUp = await page.evaluate(() => !!document.querySelector('#map .leaflet-container'));
  const text = await page.evaluate(() => document.body.innerText || '');
  await page.context().close();
  return { signal, sites, mapUp, text, pageErrors };
}

// Any raw technical string a resident must never be shown.
const SCARY = /permission denied|42501|HTTP 5\d\d|\b401\b|\b500\b|TypeError|undefined is not|stack trace/i;

// ⚠️ THE ODbL CREDIT IS NOT THE WORD "OpenStreetMap". Leaflet prints
// "© OpenStreetMap contributors" for the BASEMAP TILES on every load, national plane or
// not — so an assertion on the bare word passes trivially when the credit is present and
// fails trivially when it is absent. It measured the basemap, never this feature. The
// data-centre credit is its own sentence, and that is what these cases must read.
const DC_CREDIT = /Data-centre locations from/;

console.log('\n1. SUCCESS with records — the national plane draws and reports ok');
{
  const r = await load({ status: 200, body: JSON.stringify(NATL_OK) });
  ok(r.pageErrors.length === 0, '1a no page errors', r.pageErrors[0]);
  ok(r.mapUp, '1b map rendered');
  ok(r.signal && r.signal.status === 'ok', '1c status ok', r.signal && r.signal.status);
  ok(r.signal && r.signal.fallback === false, '1d fallback false');
  ok(r.signal && r.signal.records === 1, '1e one national record counted', r.signal && r.signal.records);
  ok(r.sites >= 2, '1f local + national both on the map', r.sites);
  ok(DC_CREDIT.test(r.text), '1g the data-centre ODbL credit is rendered');
  ok(/OpenStreetMap/.test(r.text), '1h ...naming the source the records came from');
}

console.log('\n2. GENUINE ZERO — a successful empty read, and it is NOT a failure');
{
  const r = await load({ status: 200, body: '[]' });
  ok(r.pageErrors.length === 0, '2a no page errors', r.pageErrors[0]);
  ok(r.mapUp, '2b map rendered');
  ok(r.signal && r.signal.status === 'ok', '2c status ok on an empty read');
  ok(r.signal && r.signal.fallback === false, '2d fallback FALSE — the distinction the defect erased');
  ok(r.signal && r.signal.records === 0, '2e zero records');
  ok(!SCARY.test(r.text), '2f no technical warning shown to the resident');
  ok(!DC_CREDIT.test(r.text), '2g no data-centre credit when no record was supplied');
  ok(r.sites >= 1, '2h local records still drawn', r.sites);
}

const FAILURES = [
  ['permission', { status: 401, body: JSON.stringify({ code: '42501', message: 'permission denied for table national_dc_records' }) }, 401],
  ['server',     { status: 500, body: JSON.stringify({ message: 'internal' }) }, 500],
  ['not_deployed', { status: 404, body: JSON.stringify({ message: 'no function' }) }, 404],
  ['network',    { abort: true }, null],
  ['malformed',  { status: 200, body: '<html>proxy blocked</html>', ct: 'text/html' }, 200],
];

for (const [reason, natl, http] of FAILURES) {
  console.log(`\n3. FAILURE — ${reason}`);
  const r = await load(natl);
  ok(r.pageErrors.length === 0, `3a[${reason}] Map 1 did not crash`, r.pageErrors[0]);
  ok(r.mapUp, `3b[${reason}] map still rendered`);
  ok(r.sites >= 1, `3c[${reason}] LOCAL records still drawn — national failure costs no local coverage`, r.sites);
  ok(!SCARY.test(r.text), `3d[${reason}] no raw technical error reached the resident`);
  ok(r.signal && r.signal.status === 'unavailable',
    `3e[${reason}] signal says unavailable`, r.signal && r.signal.status);
  ok(r.signal && r.signal.reason === reason, `3f[${reason}] reason is exact`, r.signal && r.signal.reason);
  ok(r.signal && r.signal.http === http, `3g[${reason}] http carried`, r.signal && String(r.signal.http));
  ok(r.signal && r.signal.fallback === true, `3h[${reason}] fallback TRUE`);
  ok(r.signal && r.signal.plane === 'national_dc', `3i[${reason}] names the plane`);
  ok(r.signal && r.signal.zip === '20147', `3j[${reason}] carries ZIP context`);
  ok(r.signal && !isNaN(Date.parse(r.signal.at)), `3k[${reason}] carries a timestamp`);
  ok(!DC_CREDIT.test(r.text), `3l[${reason}] no data-centre credit for a source that supplied nothing`);
}


console.log('\n4. TRUNCATION — a clipped set is a SUCCESS that is not the whole set');
{
  // The server says so per row (has_more). The page must not infer it from a count.
  const clipped = JSON.stringify([
    Object.assign({}, NATL_OK[0], { has_more: true }),
    Object.assign({}, NATL_OK[0], { source_key: 'osm:way/2', has_more: true }),
  ]);
  const r = await load({ status: 200, body: clipped });
  ok(r.pageErrors.length === 0, '4a no page errors', r.pageErrors[0]);
  ok(r.mapUp, '4b map rendered');
  ok(r.signal && r.signal.status === 'ok', '4c a truncated read still SUCCEEDED');
  ok(r.signal && r.signal.truncated === true, '4d ...and the signal says it was clipped');
  ok(r.signal && r.signal.fallback === false, '4e it is not a fallback — records DID arrive');
  ok(r.sites >= 3, '4f local + both national records still drawn', r.sites);
  ok(!SCARY.test(r.text), '4g no technical warning shown to the resident');

  // ...and a complete read of the same shape must NOT claim truncation.
  const wholeSet = JSON.stringify([Object.assign({}, NATL_OK[0], { has_more: false })]);
  const c = await load({ status: 200, body: wholeSet });
  ok(c.signal && c.signal.truncated === false, '4h a complete read reports truncated false');
  ok(c.signal && c.signal.status === r.signal.status,
    '4i both are `ok` — status alone cannot separate them, which is why truncated exists');
}

console.log('\n5. ADVERSARIAL — a 200 carrying an ARRAY of WRONG-SHAPED rows');
{
  // Classified as an array, so it passes the classifier and reaches the page. A null entry
  // used to throw inside the .map(), take the outer catch, and lose the ZIP's LOCAL records
  // with it. Nothing here carries a source_url, so nothing may be drawn either way.
  const junk = JSON.stringify([
    { nonsense: 1 }, { project_name: 'Ghost Data Center', lat: 39.02, lng: -77.46 },
    { source_key: 'x', project_name: 'No URL DC', lat: 39.02, lng: -77.46, source_url: '' },
    null, 42, 'string',
  ]);
  const r = await load({ status: 200, body: junk });
  ok(r.pageErrors.length === 0, '5a page did not crash on wrong-shaped rows', r.pageErrors[0]);
  ok(r.mapUp, '5b map still rendered');
  ok(!/Ghost Data Center|No URL DC/.test(r.text), '5c NO FABRICATED RECORD IS RENDERED');
  ok(r.sites === 1, '5d the ZIP keeps its real LOCAL record — a junk national payload costs it nothing', r.sites);
  ok(!DC_CREDIT.test(r.text), '5e nothing sourced, so nothing credited');
}

await browser.close();
srv.close();
console.log(`\n${fails ? `FAILED: ${fails}` : 'ALL PASS'} — Map 1 national plane failure behaviour`);
if (fails) process.exit(1);

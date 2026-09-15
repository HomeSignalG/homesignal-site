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
// One real eligible national record, shaped exactly as national_dc_for_zip returns it.
const NATL_OK = [{ source_key: 'osm:way/1188691868', source_name: 'OpenStreetMap',
  source_url: 'https://www.openstreetmap.org/way/1188691868',
  project_name: 'NTT Ashburn VA9 Data Center', developer_or_operator: 'NTT',
  raw_status: 'operational', normalized_status: 'operational', project_type: 'datacenter',
  lat: 39.0205, lng: -77.4602, location_text: null,
  location_precision: 'approximate_campus_area', distance_mi: 1.21,
  last_seen_at: '2026-09-15T00:00:00Z' }];

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

/** Load ZIP 20147 with the national RPC answering however `natl` says. */
async function load(natl) {
  const page = await (await browser.newContext()).newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/rpc/national_dc_for_zip')) {
      if (natl.abort) return route.abort('connectionrefused');   // network / timeout
      return route.fulfill({ status: natl.status, contentType: natl.ct || 'application/json',
        body: natl.body });
    }
    if (url.includes('/rpc/app_zip_projects_markers'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ zip: '20147', mode: 'development', status: 'boundary_complete',
          projects: [], markers: [] }) });
    if (url.includes('/rest/v1/development_reports'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ZIP_ROW) });
    if (url.includes('supabase.co') || url.includes('jsdelivr') || url.includes('tile.'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
  await page.goto(base + '/homesignalmap.html?zip=20147', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__HS_NATIONAL_PLANE !== undefined, { timeout: 20000 })
    .catch(() => {});
  const signal = await page.evaluate(() => window.__HS_NATIONAL_PLANE || null);
  const sites = await page.evaluate(() => (window.__HS_SITES || []).length);
  const mapUp = await page.evaluate(() => !!document.querySelector('#map .leaflet-container'));
  const text = await page.evaluate(() => document.body.innerText || '');
  await page.context().close();
  return { signal, sites, mapUp, text, pageErrors };
}

// Any raw technical string a resident must never be shown.
const SCARY = /permission denied|42501|HTTP 5\d\d|\b401\b|\b500\b|TypeError|undefined is not|stack trace/i;

console.log('\n1. SUCCESS with records — the national plane draws and reports ok');
{
  const r = await load({ status: 200, body: JSON.stringify(NATL_OK) });
  ok(r.pageErrors.length === 0, '1a no page errors', r.pageErrors[0]);
  ok(r.mapUp, '1b map rendered');
  ok(r.signal && r.signal.status === 'ok', '1c status ok', r.signal && r.signal.status);
  ok(r.signal && r.signal.fallback === false, '1d fallback false');
  ok(r.signal && r.signal.records === 1, '1e one national record counted', r.signal && r.signal.records);
  ok(r.sites >= 2, '1f local + national both on the map', r.sites);
  ok(/OpenStreetMap/.test(r.text), '1g ODbL attribution rendered');
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
  ok(!/OpenStreetMap/.test(r.text), '2g no ODbL credit when no record was supplied');
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
  ok(!/OpenStreetMap/.test(r.text), `3l[${reason}] no ODbL credit for a source that supplied nothing`);
}

await browser.close();
srv.close();
console.log(`\n${fails ? `FAILED: ${fails}` : 'ALL PASS'} — Map 1 national plane failure behaviour`);
if (fails) process.exit(1);

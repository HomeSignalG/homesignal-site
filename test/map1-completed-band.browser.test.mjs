// Map 1's first band, rendered: the heading names only what the list beneath it is (2026-11-09).
// The "operating" bucket holds two different claims: permits/cases an agency marked complete, and
// data centers their own source lists as operating (HS.isSourceOwnRecord). One band can hold both:
// ZIP 23150 on 2026-11-09 had 13 source-listed operating data centers and 3 completed agency records.
// A heading is a claim about every row under it, so:
//   agency records only (or empty) -> "Completed (agency record)"
//   data-center listings only      -> "Operating (source listing)"
//   both                           -> "Completed or listed as operating"
// The data-center rows are the REAL production rows for 23150 (test/fixtures/map1-dc-zip-sample-2026-09-27.json).
// WORDING ONLY: which records are in the band, the pins, counts and filters are unchanged (checked below).
// Screenshots of each case are written to $HS_SHOT_DIR when it is set.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fulfillZipModeReport, rpcZip } from './lib/zip-mode-rpc-mock.mjs';
const require = createRequire(import.meta.url);

let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra).slice(0, 300) + ']' : ''));
  if (!c) fails++;
};

const REPO = process.cwd();
const FIX = JSON.parse(readFileSync(join(REPO, 'test/fixtures/map1-dc-zip-sample-2026-09-27.json'), 'utf8'));
const DC_23150 = FIX.rows.filter((r) => r.zip === '23150').map((r) => { const o = Object.assign({}, r); delete o.zip; return o; });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = createServer(async (q, s) => {
  const p = normalize(join(REPO, decodeURIComponent(q.url.split('?')[0])));
  try { const body = await readFile(p); s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/plain' }); s.end(body); }
  catch { s.writeHead(404); s.end('nope'); }
});
await new Promise(r => srv.listen(8851, '127.0.0.1', r));
const base = 'http://127.0.0.1:8851';

// One agency-completed record (its own source states Operating), at a point inside the 23150 frame.
const AGENCY = { projects: [{ source_key: 'arcgis:henrico:C-1', project_ref: 'arcgis:henrico:C-1',
  name: 'Elko Road Warehouse Addition', type: 'Industrial', status: 'Operating',
  registry_id: 'henrico-building-permits', source_ref: 'https://henrico.example.gov/c1',
  submitted_at: '2026-06-01', date_kind: 'filed', impact_score: null, impact_dimensions: null }],
  markers: [{ project_ref: 'arcgis:henrico:C-1', lat: 37.505, lng: -77.255, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] };
const NONE = { projects: [], markers: [] };

const CASES = {
  agency: { dc: [], dev: AGENCY },
  datacenters: { dc: DC_23150, dev: NONE },
  mixed: { dc: DC_23150, dev: AGENCY },
  empty: { dc: DC_23150.filter((r) => r.map_status !== 'Operating'), dev: NONE }
};

const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.HS_CHROME) launchOpts.executablePath = process.env.HS_CHROME;
const browser = await chromium.launch(launchOpts);

async function open(name, query) {
  const c = CASES[name], zip = '23150';
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/rpc/map1_dc_zip_members'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rpcZip(route) === zip || !rpcZip(route) ? c.dc : []) });
    if (url.includes('/rpc/app_zip_projects_markers'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(Object.assign({ zip, mode: 'development', status: 'boundary_complete' }, c.dev)) });
    const zrow = [{ zip, home_lat: 37.50, home_lng: -77.25, counts: { development: c.dev.projects.length }, sites: [],
      paywall: false, refreshed_at: '2026-11-09T00:00:00Z', facilities_unavailable: false }];
    if (url.includes('/rpc/zip_mode_report_sites')) return fulfillZipModeReport(route, () => zrow);
    if (url.includes('/rest/v1/development_reports'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(zrow) });
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
    if (url.includes('tile.openstreetmap') || url.includes('arcgisonline'))
      return route.fulfill({ status: 200, contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
    if (url.includes('/rest/v1/') || url.includes('/rpc/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + '/homesignalmap.html?zip=' + zip + (query || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(700);
  return { page, pageErrors };
}

const band = (page) => page.evaluate(() => ({
  h: (document.getElementById('builtHead') || {}).textContent || '',
  s: (document.getElementById('builtSub') || {}).textContent || '',
  list: (document.getElementById('builtList') || {}).innerText || ''
}));
const pinTitles = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)'))
    .map(m => { const s = m.querySelector('[title]'); return s ? s.getAttribute('title') : ''; }));
const chip0 = (page) => page.evaluate(() => {
  const c = document.querySelector('#mapkey .stagechip[data-stage-id="operating_now"]');
  return c ? { label: c.innerText.trim(), name: c.getAttribute('aria-label') || '' } : null;
});
async function shot(page, name) {
  if (!process.env.HS_SHOT_DIR) return;
  const el = await page.$('#builtHead');
  if (el) await el.evaluate((n) => { n.scrollIntoView(); window.scrollBy(0, -160); });
  const box = await page.evaluate(() => {
    const h = document.getElementById('builtHead'), l = document.getElementById('builtList');
    const a = h.getBoundingClientRect(), b = l.getBoundingClientRect();
    return { x: Math.max(0, a.left - 8), y: Math.max(0, a.top - 8), width: Math.max(a.width, b.width) + 16, height: Math.min(560, b.bottom - a.top + 16) };
  });
  await page.screenshot({ path: join(process.env.HS_SHOT_DIR, 'band-' + name + '.png'), clip: box });
}

console.log('\n1. agency-completed records only');
{
  const { page, pageErrors } = await open('agency');
  const b = await band(page);
  ok(b.h === 'Completed (agency record)', '1a heading', b.h);
  ok(/agency marked complete/.test(b.s) && /does not confirm a building is occupied or a business is open/.test(b.s) && !/data center/i.test(b.s), '1b subtitle', b.s);
  // List rows carry name, kind, source and record link, not a stage word: the heading is what says what they are.
  ok(/Elko Road Warehouse Addition/.test(b.list) && /henrico-building-permits/.test(b.list), '1c the agency record is listed with its source', b.list);
  const t = await pinTitles(page);
  ok(t.some((x) => /Completed/.test(x)) && !t.some((x) => /Operating now/i.test(x)), '1d the pin hover says Completed, never "Operating now"', t);
  ok(pageErrors.length === 0, '1e no page errors', pageErrors[0]);
  await shot(page, 'agency');
  await page.context().close();
}

console.log('\n2. source-listed operating data centers only (real 23150 rows)');
{
  const { page, pageErrors } = await open('datacenters');
  const b = await band(page);
  ok(b.h === 'Operating (source listing)', '2a heading', b.h);
  ok(/source lists as operating/.test(b.s) && /Jody does not verify it/.test(b.s) && !/agency/.test(b.s), '2b subtitle names the source\'s claim and no agency', b.s);
  ok(/QTS Richmond 1 DC1/.test(b.list) && !/Completed/.test(b.list), '2c the data centers are listed with their source, nothing calls them completed', b.list.slice(0, 200));
  const t = await pinTitles(page);
  ok(t.filter((x) => x === 'Operating (source listing) data center').length === 13 && !t.some((x) => /Completed|Operating now/.test(x)),
     '2d the 13 operating data-center pins hover "Operating (source listing) data center"', t);
  ok(pageErrors.length === 0, '2e no page errors', pageErrors[0]);
  await shot(page, 'datacenters');
  await page.context().close();
}

console.log('\n3. mixed band: both kinds');
{
  const { page, pageErrors } = await open('mixed');
  const b = await band(page);
  ok(b.h === 'Completed or listed as operating', '3a heading is true of every row beneath it', b.h);
  ok(/agency marked complete, and data centers their source lists as operating/.test(b.s) &&
     /does not confirm a building is occupied or a business is open/.test(b.s) && /Jody does not verify it/.test(b.s), '3b subtitle names both kinds and what neither proves', b.s);
  ok(/Elko Road Warehouse Addition/.test(b.list) && /QTS Richmond 1 DC1/.test(b.list), '3c both kinds are listed in the one band', b.list.slice(0, 300));
  const th = await pinTitles(page);
  ok(th.includes('Completed industrial') && th.filter((x) => x === 'Operating (source listing) data center').length === 13,
     '3c2 each pin hover keeps its own word: "Completed industrial" and "Operating (source listing) data center"', th);
  const c = await chip0(page);
  ok(c && /Completed or listed as operating/.test(c.label), '3d the Stage chip covering both kinds of pin says so', c);
  const all = (await pinTitles(page)).length;
  await page.evaluate(() => document.querySelector('#mapkey .stagechip[data-stage-id="operating_now"]').click());
  const off = (await pinTitles(page)).length;
  ok(all - off === 14, `3e the chip (stable id operating_now) still filters exactly the same 14 pins (13 + 1): ${all} -> ${off}`);
  ok(/stages=/.test(await page.evaluate(() => location.search)) && !/operating_now/.test(await page.evaluate(() => location.search)),
     '3f the shared link carries the stable id, unchanged');
  ok(pageErrors.length === 0, '3g no page errors', pageErrors[0]);
  await page.evaluate(() => document.querySelector('#mapkey .stagechip[data-stage-id="operating_now"]').click());
  await page.waitForTimeout(300);
  await shot(page, 'mixed');
  await page.context().close();
}

console.log('\n4. a shared link that turned the chip off still reads');
{
  const { page } = await open('mixed', '&stages=approved,proposed,lifecycle_unknown');
  const c = await page.evaluate(() => { const x = document.querySelector('#mapkey .stagechip[data-stage-id="operating_now"] input'); return x ? x.checked : null; });
  ok(c === false, '4a ?stages= without operating_now still unchecks that chip');
  await page.context().close();
}

console.log('\n5. empty band');
{
  const { page, pageErrors } = await open('empty');
  const b = await band(page);
  ok(b.h === 'Completed (agency record)', '5a heading keeps the default', b.h);
  ok(/No completed agency records or source-listed operating data centers in Jody for this area\. This does not mean nothing operates here\./.test(b.list),
     '5b the empty message speaks for both kinds and refuses "nothing operates"', b.list);
  ok(pageErrors.length === 0, '5c no page errors', pageErrors[0]);
  await shot(page, 'empty');
  await page.context().close();
}

await browser.close();
srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nmap1 completed band: heading true of every row in all four cases.');
process.exit(fails ? 1 : 0);

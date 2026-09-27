// MAP 1 — DATA-CENTRE PINS DRAW AS DATA CENTRES, IN THEIR OWN LIFECYCLE, ON THE REAL PAGE.
//
// The offline suite (test/map1-dc-site-shape.test.mjs) proves the mapping on the resolver.
// This drives homesignalmap.html itself, with public.map1_dc_zip_members answering the REAL
// production rows of the deterministic ZIP sample (test/fixtures/map1-dc-zip-sample-2026-09-27.json,
// fingerprinted against production), and reads what a resident gets: each pin's own words
// (its title — "Proposed data center"), the PROJECT TYPE and STATUS filters, and the four lists.
//
// Before 2026-09-27 every one of these pins read "Other project · lifecycle unknown", sat in
// the Lifecycle-unknown list with a blank name, and vanished when a resident chose Data center.
//
// Run: node test/map1-dc-type-lifecycle.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fulfillZipModeReport, rpcZip } from './lib/zip-mode-rpc-mock.mjs';
const require = createRequire(import.meta.url);

let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : ''));
  if (!c) fails++;
};

const REPO = process.cwd();
const FIX = JSON.parse(readFileSync(join(REPO, 'test/fixtures/map1-dc-zip-sample-2026-09-27.json'), 'utf8'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = createServer(async (q, s) => {
  const p = normalize(join(REPO, decodeURIComponent(q.url.split('?')[0])));
  try { s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/plain' }); s.end(await readFile(p)); }
  catch { s.writeHead(404); s.end('nope'); }
});
await new Promise(r => srv.listen(8849, '127.0.0.1', r));
const base = 'http://127.0.0.1:8849';

const rowsFor = (zip) => FIX.rows.filter((r) => r.zip === zip).map((r) => { const o = Object.assign({}, r); delete o.zip; return o; });
const HOME = { '20187': [38.72, -77.75], '23150': [37.50, -77.25] };
// No local records at all, so every pin on the map is a data-centre row from the one contract.
const zipRow = (zip) => [{ zip, home_lat: HOME[zip][0], home_lng: HOME[zip][1], counts: {}, sites: [],
  paywall: false, refreshed_at: '2026-09-27T00:00:00Z', facilities_unavailable: false }];

const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.HS_CHROME) launchOpts.executablePath = process.env.HS_CHROME;
const browser = await chromium.launch(launchOpts);

async function open(zip) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/rpc/map1_dc_zip_members'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rowsFor(rpcZip(route) || zip)) });
    // Whole-ZIP geography is COMPLETE (so the one contract is admitted), with no local development.
    if (url.includes('/rpc/app_zip_projects_markers'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ zip, mode: 'development', status: 'boundary_complete', projects: [], markers: [] }) });
    if (url.includes('/rpc/zip_mode_report_sites')) return fulfillZipModeReport(route, () => zipRow(zip));
    if (url.includes('/rest/v1/development_reports'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(zipRow(zip)) });
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
    if (url.includes('/rest/v1/') || url.includes('/rpc/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + '/homesignalmap.html?zip=' + zip, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  return { page, pageErrors };
}

// Visible pins, by the words the pin itself carries (its title), which come from the same two
// signals as its shape and colour (markerTitle: resolver legendLabel + lifecycle stage).
const titles = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)'))
    .map(m => { const s = m.querySelector('[title]'); return s ? s.getAttribute('title') : ''; }));
const count = (list) => list.reduce((o, t) => { o[t] = (o[t] || 0) + 1; return o; }, {});
const clickType = (page, id) => page.evaluate((want) => {
  const c = document.querySelector('#mapkeyShapes .typechip[data-type-id="' + want + '"]'); if (c) c.click();
}, id);
const clickStage = (page, id) => page.evaluate((want) => {
  const c = document.querySelector('#mapkey .stagechip[data-stage-id="' + want + '"]'); if (c) c.click();
}, id);
const listText = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return el ? el.innerText : null; }, id);
const WORD = { Operating: 'Operating data center', Approved: 'Approved data center', Proposed: 'Proposed data center' };
const expectTitles = (zip) => count(FIX.rows.filter((r) => r.zip === zip).map((r) => WORD[r.map_status]));
const BAD = /other project|lifecycle unknown/i;

console.log('\n1. ZIP 20187 — all three lifecycles on one page');
{
  const { page, pageErrors } = await open('20187');
  ok(pageErrors.length === 0, '1a no page errors', pageErrors[0]);
  const sites = await page.evaluate(() => (window.__HS_SITES || []).map((s) => {
    const mk = window.__HS_RESOLVE_TRACKER(s);
    return { name: s.label, basis: s.publication_basis, type: mk.typeKey, life: mk.lifecycle, shape: mk.shape };
  }));
  ok(sites.length === 4, '1b the four contract rows reached the map', sites.length);
  const byName = Object.fromEntries(sites.map((s) => [s.name, s.type + '/' + s.life + '/' + s.shape]));
  ok(JSON.stringify(byName, Object.keys(byName).sort()) === JSON.stringify({
    'Blackwell Road Data Center (Warrenton)': 'datacenter/approved/octagon',
    'CyrusOne Vint Hill Campus': 'datacenter/proposed/octagon',
    'OVH US East Vint Hill': 'datacenter/operating/octagon',
    'Vint Hill Corners': 'datacenter/proposed/octagon' }, Object.keys(byName).sort()),
    '1c each pin, by name: Data center octagon in its map_status lifecycle (canonical AND OSM rows)', byName);
  const t0 = await titles(page);
  ok(JSON.stringify(count(t0), Object.keys(count(t0)).sort()) === JSON.stringify(expectTitles('20187'), Object.keys(count(t0)).sort())
     && t0.length === 4, '1d the pins say it: 1 Operating, 1 Approved, 2 Proposed data center', count(t0));
  ok(!t0.some((t) => BAD.test(t)), '1e no pin reads Other project or lifecycle unknown', t0);

  // PROJECT TYPE — the Data center chip owns these pins; the Other project chip does not.
  await clickType(page, 'other_project');
  ok((await titles(page)).length === 4, '1f Other project OFF leaves all four data centres on the map');
  await clickType(page, 'other_project');
  await clickType(page, 'data_center');
  ok((await titles(page)).length === 0, '1g Data center OFF removes all four');
  await clickType(page, 'data_center');
  ok((await titles(page)).length === 4, '1h Data center back ON restores all four');

  // STATUS — each pin answers to its own stage chip, and none to Lifecycle unknown.
  await clickStage(page, 'lifecycle_unknown');
  ok((await titles(page)).length === 4, '1i Lifecycle unknown OFF removes nothing — none of them is unknown');
  await clickStage(page, 'lifecycle_unknown');
  await clickStage(page, 'proposed');
  const tp = await titles(page);
  ok(tp.length === 2 && !tp.some((t) => /Proposed/.test(t)), '1j Proposed OFF removes exactly the two proposed pins', tp);
  await clickStage(page, 'proposed');
  await clickStage(page, 'approved');
  ok((await titles(page)).length === 3, '1k Approved OFF removes exactly the approved pin');
  await clickStage(page, 'approved');
  await clickStage(page, 'operating_now');
  ok((await titles(page)).length === 3, '1l Operating OFF removes exactly the operating pin');
  await clickStage(page, 'operating_now');

  // THE LISTS — each record in its own lifecycle list, by name; the unknown list holds none.
  const prop = await listText(page, 'propList'), appr = await listText(page, 'apprList');
  const built = await listText(page, 'builtList'), unk = await listText(page, 'unknownList');
  ok(/CyrusOne Vint Hill Campus/.test(prop) && /Vint Hill Corners/.test(prop), '1m the Proposed list names both proposed campuses');
  ok(/Blackwell Road Data Center/.test(appr), '1n the Approved list names Blackwell Road');
  ok(/OVH US East Vint Hill/.test(built), '1o the Operating list names OVH US East Vint Hill');
  // Exactly the empty state. (Matching the names alone passed on the old mapping too, because the
  // unknown list then held these four rows with BLANK names.)
  ok(String(unk || '').trim() === 'Nothing on record here without a stated lifecycle.',
    '1p the Lifecycle unknown list is empty — none of them sits there', unk);
  await page.context().close();
}

console.log('\n2. ZIP 23150 — twenty rows, OSM compatibility and canonical together');
{
  const { page, pageErrors } = await open('23150');
  ok(pageErrors.length === 0, '2a no page errors', pageErrors[0]);
  const t = await titles(page);
  const want = expectTitles('23150');
  ok(t.length === FIX.rows.filter((r) => r.zip === '23150').length
     && JSON.stringify(count(t), Object.keys(want).sort()) === JSON.stringify(want, Object.keys(want).sort()),
    '2b every pin reads its own lifecycle and "data center", in the proportions map_status gives', { got: count(t), want });
  ok(!t.some((x) => BAD.test(x)), '2c no pin reads Other project or lifecycle unknown');
  await clickType(page, 'data_center');
  ok((await titles(page)).length === 0, '2d Data center OFF removes every one of them');
  await page.context().close();
}

await browser.close();
srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);

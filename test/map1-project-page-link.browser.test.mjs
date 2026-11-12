// Map 1 links a record to its project page (/project/...) only when the build published one
// (lib/project-page-link.js reads /community/<zip>/projects/pages.json, written by
// scripts/gen_zip_pages.py project_page_index). Drives homesignalmap.html in Chromium:
//   1. index present: the list row and the pin popup link to the page; the data-centre rows
//      (real production rows for 23150) keep no project link and say their link is third-party
//   2. index answered late: the list row's slot is filled when it lands
//   3. no index (404) or an unsafe path in it: no project link, nothing breaks
// Run: node test/map1-project-page-link.browser.test.mjs
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
  try { const __body = await readFile(p); s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/plain' }); s.end(__body); }
  catch { s.writeHead(404); s.end('nope'); }
});
await new Promise(r => srv.listen(8857, '127.0.0.1', r));
const base = 'http://127.0.0.1:8857';

// One agency-completed record (its own source states Operating), at a point inside the 23150 frame.
const PATH = '/project/henrico-building-permits/c-1-1a2b3c4d/';
const AGENCY = { projects: [{ source_key: 'arcgis:henrico:C-1', project_ref: 'arcgis:henrico:C-1',
  name: 'Elko Road Warehouse Addition', type: 'Industrial', status: 'Approved',
  registry_id: 'henrico-building-permits', source_ref: 'https://henrico.example.gov/c1',
  submitted_at: '2026-06-01', date_kind: 'filed', impact_score: null, impact_dimensions: null }],
  markers: [{ project_ref: 'arcgis:henrico:C-1', lat: 37.505, lng: -77.255, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] };
const IDX = { v: 1, zip: '23150', pages: { 'arcgis:henrico:C-1': PATH } };
const asked = [];
const CASES = {
  unlisted: { dc: [], dev: AGENCY, index: IDX, listed: false },
  linked: { dc: DC_23150, dev: AGENCY, index: IDX },
  late: { dc: [], dev: AGENCY, index: IDX, delayMs: 2500 },
  missing: { dc: [], dev: AGENCY, index: 404 },
  unsafe: { dc: [], dev: AGENCY, index: { v: 1, zip: '23150', pages: { 'arcgis:henrico:C-1': 'https://evil.example/x' } } },
};

const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.HS_CHROME) launchOpts.executablePath = process.env.HS_CHROME;
const browser = await chromium.launch(launchOpts);

async function open(name) {
  const c = CASES[name], zip = '23150';
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 200)); });
  asked.length = 0;
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('/lib/generated/project-page-zips.json')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ v: 1, zips: c.listed === false ? [] : ['23150'] }) });
    }
    if (url.includes('/community/23150/projects/pages.json')) {
      asked.push(url);
      if (c.index === 404) return route.fulfill({ status: 404, body: 'nope' });
      if (c.delayMs) await new Promise((r) => setTimeout(r, c.delayMs));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c.index) });
    }
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
  await page.goto(base + '/homesignalmap.html?zip=' + zip, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(700);
  return { page, pageErrors };
}
const listHtml = (page) => page.evaluate(() => (document.getElementById('apprList') || {}).innerHTML || '');
const popupFor = async (page, re) => {
  const ok2 = await page.evaluate((src) => {
    const rx = new RegExp(src);
    document.querySelectorAll('.leaflet-popup').forEach((n) => n.remove());
    const icon = Array.from(document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)'))
      .find((m) => { const s = m.querySelector('[title]'); return s && rx.test(s.getAttribute('title')); });
    if (!icon) return false;
    icon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return true;
  }, re.source);
  if (!ok2) return null;
  await page.waitForTimeout(250);
  return page.evaluate(() => { const p = document.querySelector('.leaflet-popup-content'); return p ? p.innerHTML : ''; });
};

console.log('\n1. index present');
{
  const { page, pageErrors } = await open('linked');
  const l = await listHtml(page);
  ok(l.includes(`<a class="pplink" href="${PATH}">Project page →</a>`), '1a the list row links to the project page', l.slice(0, 400));
  ok(l.includes('https://henrico.example.gov/c1'), '1b and keeps its official record link');
  const p = await popupFor(page, /^Approved industrial$/);
  ok(p && p.includes(`href="${PATH}"`) && p.includes('Project page'), '1c the pin popup links to the project page', p);
  const dc = await popupFor(page, /data center$/);
  ok(dc && !dc.includes('pplink'), '1d a data-centre pin (no project page) gets no project link', dc);
  ok(dc && /\(third-party\)/.test(dc) && !/Official record/.test(dc), '1e and its link says it is third-party, not an official record', dc);
  ok(pageErrors.length === 0, '1f no page errors', pageErrors[0]);
  if (process.env.HS_SHOT_DIR) await page.screenshot({ path: join(process.env.HS_SHOT_DIR, 'map1-project-link.png') });
  await page.context().close();
}

console.log('\n2. index answered after the list was drawn');
{
  const { page, pageErrors } = await open('late');
  await page.waitForTimeout(3200);
  const l = await listHtml(page);
  ok(l.includes(`href="${PATH}"`) && !l.includes('ppslot'), '2a the waiting slot is filled when the index lands', l.slice(0, 400));
  ok(pageErrors.length === 0, '2b no page errors', pageErrors[0]);
  await page.context().close();
}

console.log('\n2b. a ZIP the list does not name');
{
  const { page, pageErrors } = await open('unlisted');
  await page.waitForTimeout(500);
  ok(asked.length === 0, '2b the per-ZIP index is never requested', asked);
  ok(!(await listHtml(page)).includes('pplink') && pageErrors.length === 0, '2b no link, no error', pageErrors[0]);
  await page.context().close();
}

for (const name of ['missing', 'unsafe']) {
  console.log(`\n3. ${name} index`);
  const { page, pageErrors } = await open(name);
  await page.waitForTimeout(500);
  const l = await listHtml(page);
  ok(!l.includes('pplink') && l.includes('https://henrico.example.gov/c1'), `3 ${name}: no project link; the official record link stays`, l.slice(0, 300));
  ok(!l.includes('evil.example'), `3 ${name}: an unsafe path is never drawn`);
  // 'missing' answers 404 on purpose (list and index disagree), so the browser's own
  // "Failed to load resource" line is expected there; a script error never is.
  const errs = name === 'missing' ? pageErrors.filter((e) => !/Failed to load resource/.test(e)) : pageErrors;
  ok(errs.length === 0, `3 ${name}: no page errors`, errs[0]);
  await page.context().close();
}

await browser.close();
srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);

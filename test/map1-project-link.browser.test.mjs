// MAP 1 PROJECT LINK — /map/<zip>/?project=<key> opens the project and its panel, on the real page.
//
// homesignalmap.html runs in Chromium with public.map1_dc_zip_members answering the REAL production rows of the
// deterministic sample (test/fixtures/map1-dc-zip-sample-2026-09-27.json). public.map1_project_locate and
// public.map1_project_documents are stubbed with the shapes docs/map1-project-link.sql returns.
//
// Run: node test/map1-project-link.browser.test.mjs
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
await new Promise(r => srv.listen(8851, '127.0.0.1', r));
const base = 'http://127.0.0.1:8851';

const rowsFor = (zip) => FIX.rows.filter((r) => r.zip === zip).map((r) => { const o = Object.assign({}, r); delete o.zip; return o; });
const HOME = { '20187': [38.72, -77.75], '23150': [37.50, -77.25] };
const zipRow = (zip) => [{ zip, home_lat: HOME[zip][0], home_lng: HOME[zip][1], counts: {}, sites: [],
  paywall: false, refreshed_at: '2026-09-27T00:00:00Z', facilities_unavailable: false }];

// The proposed CyrusOne Vint Hill entry on 20187 (a canonical row of the fixture).
const VINT = FIX.rows.find((r) => r.zip === '20187' && r.map_status === 'Proposed');
const KEY = 'dcrec:compute_atlas|facilities|cyrusone-vint-hill';
const DOC = { map_key: VINT.source_key, project_key: KEY, document_id: '00000000-0000-0000-0000-000000000001',
  url: 'https://www.fauquiercounty.gov/rezoning-application.pdf', title: 'Rezoning application',
  publisher: 'Fauquier County', doc_kind: 'application', doc_date: '2024-03-02', doc_date_label: 'Application filed',
  supports: 'The site and the use applied for.', approved_at: '2026-11-12T00:00:00Z' };

const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.HS_CHROME) launchOpts.executablePath = process.env.HS_CHROME;
const browser = await chromium.launch(launchOpts);

async function open(path, { locate, locateStatus = 200, dcStatus = 200, docs = [DOC], docsFail = false, viewport = { width: 1280, height: 900 } } = {}) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const pageErrors = [], calls = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/rpc/map1_project_locate')) {
      calls.push(JSON.parse(route.request().postData() || '{}'));
      if (locateStatus !== 200) return route.fulfill({ status: locateStatus, contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.map1_project_locate' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(locate) });
    }
    if (url.includes('/rpc/map1_project_documents')) {
      if (docsFail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(docs) });
    }
    if (url.includes('/rpc/map1_dc_zip_members') && dcStatus !== 200)
      return route.fulfill({ status: dcStatus, contentType: 'application/json', body: '{"message":"boom"}' });
    if (url.includes('/rpc/map1_dc_zip_members'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rowsFor(rpcZip(route))) });
    if (url.includes('/rpc/app_zip_projects_markers')) {
      const zip = rpcZip(route);
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ zip, mode: 'development', status: 'boundary_complete', projects: [], markers: [] }) });
    }
    if (url.includes('/rpc/zip_mode_report_sites')) return fulfillZipModeReport(route, () => zipRow(rpcZip(route)));
    if (url.includes('/rest/v1/development_reports')) {
      const m = /zip=eq\.(\d{5})/.exec(url);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(zipRow(m ? m[1] : '20187')) });
    }
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
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(900);
  return { page, pageErrors, calls };
}
const panel = (page) => page.evaluate(() => {
  const el = document.getElementById('projPanel');
  return el ? { hidden: el.hidden, text: el.innerText, html: el.innerHTML } : null;
});
const found = (zip) => ({ key: KEY, kind: 'dcrec', state: 'found', map_key: VINT.source_key, zips: [zip], zip });
const enc = encodeURIComponent(KEY);

console.log('\n1. the link opens the project, its popup and its panel (desktop)');
{
  const { page, pageErrors, calls } = await open('/homesignalmap.html?zip=20187&project=' + enc, { locate: found('20187') });
  ok(pageErrors.length === 0, '1a no page errors', pageErrors[0]);
  ok(calls.length === 1 && calls[0].p_key === KEY && calls[0].p_zip === '20187', '1b the key is looked up once, with the ZIP', calls);
  const focus = await page.evaluate(() => window.__HS_PROJECT_FOCUS || null);
  ok(focus && focus.mapKey === VINT.source_key && focus.zip === '20187', '1c the project was selected', focus);
  const popup = await page.evaluate(() => { const p = document.querySelector('.leaflet-popup-content'); return p ? p.innerText : null; });
  ok(popup && popup.includes(VINT.project_name), '1d its popup is open', popup);
  const p = await panel(page);
  ok(p && !p.hidden, '1e the panel is open');
  ok(p && p.text.includes(VINT.project_name) && p.text.includes('Vint Hill, VA') && p.text.includes('ZIP 20187'), '1f name and location');
  ok(p && /Status on JODY/.test(p.text) && /Proposed/.test(p.text), '1g the status Map 1 publishes');
  ok(p && p.text.includes('Rezoning application') && p.html.includes('https://www.fauquiercounty.gov/rezoning-application.pdf'), '1h the approved document');
  ok(p && p.text.includes('Application filed') && p.text.includes('Source last observed'), '1i each date is labelled with what it is');
  ok(p && p.text.includes('third-party directory'), '1j the map\'s own source says what it is');
  const url = await page.evaluate(() => location.pathname + location.search);
  ok(url === '/map/20187?project=' + enc, '1k the address bar keeps the link as it came (no filter added)', url);
  const center = await page.evaluate(() => window.__HS_PROJECT_FOCUS && document.querySelector('#map') ? true : false);
  ok(center, '1l map present');
}

console.log('\n2. a project the reader\'s filters hide is still opened, without changing the link');
{
  const { page } = await open('/homesignalmap.html?zip=20187&stages=operating&project=' + enc, { locate: found('20187') });
  const vis = await page.evaluate((name) => Array.from(document.querySelectorAll('#map .leaflet-marker-icon [title]'))
    .map((m) => m.getAttribute('title')), VINT.project_name);
  ok(vis.some((t) => /Proposed/i.test(t)), '2a the proposed pin is drawn although the link\'s page had only Operating on', vis);
  const url = await page.evaluate(() => location.search);
  ok(url.includes('stages=operating') && !url.includes('proposed'), '2b the address bar was not rewritten with filters', url);
  const p = await panel(page);
  ok(p && !p.hidden && p.text.includes(VINT.project_name), '2c the panel is open');
}

console.log('\n3. a project now drawn on another ZIP opens there');
{
  const OTHER = FIX.rows.find((r) => r.zip === '23150' && r.publication_basis === 'canonical');
  const locate = { key: KEY, kind: 'dcrec', state: 'found', map_key: OTHER.source_key, zips: ['23150'], zip: '23150' };
  const { page } = await open('/homesignalmap.html?zip=20187&project=' + enc, { locate, docs: [] });
  const url = await page.evaluate(() => location.pathname + location.search);
  ok(url === '/map/23150?project=' + enc, '3a the address bar names the ZIP that draws it now', url);
  const p = await panel(page);
  ok(p && !p.hidden && p.text.includes(OTHER.project_name), '3b that project\'s panel is open', p && p.text.slice(0, 80));
}

console.log('\n4. a key the map does not draw says so (and never shows a different project)');
{
  const { page } = await open('/homesignalmap.html?zip=20187&project=' + enc,
    { locate: { key: KEY, kind: 'dcrec', state: 'not_on_map', map_key: VINT.source_key, zips: [], zip: null } });
  const p = await panel(page);
  ok(p && !p.hidden && /not on JODY's map right now/.test(p.text), '4a the panel says the project is not on the map', p && p.text);
  const focus = await page.evaluate(() => window.__HS_PROJECT_FOCUS || null);
  ok(!focus, '4b nothing was selected');
}

console.log('\n5. documents that cannot be read are not shown as "none"');
{
  const { page } = await open('/homesignalmap.html?zip=20187&project=' + enc, { locate: found('20187'), docsFail: true });
  const p = await panel(page);
  ok(p && /could not be loaded/.test(p.text) && !/No official government document/.test(p.text), '5a a failed read is named', p && p.text);
}

console.log('\n6. phone width, and "Details & documents" from any pin');
{
  const { page, pageErrors } = await open('/homesignalmap.html?zip=20187&project=' + enc, { locate: found('20187'), viewport: { width: 390, height: 844 } });
  ok(pageErrors.length === 0, '6a no page errors');
  const geo = await page.evaluate(() => {
    const el = document.getElementById('projPanel'); const r = el.getBoundingClientRect();
    return { w: r.width, right: r.right, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, hidden: el.hidden };
  });
  ok(!geo.hidden && geo.right <= geo.vw + 1 && geo.sw <= geo.vw + 1, '6b the panel fits the phone width, no sideways scroll', geo);
  // Open another pin's popup and press its button.
  const other = FIX.rows.find((r) => r.zip === '20187' && r.map_status === 'Approved');
  const opened = await page.evaluate((key) => {
    const x = (window.siteMarkers || []).find((m) => m.s && m.s.source_key === key);
    if (!x) return 'no marker';
    x.m.openPopup();
    const bs = Array.from(document.querySelectorAll('.leaflet-popup-content [data-pp-key]'));
    const b = bs.find((e) => e.getAttribute('data-pp-key') === key);
    if (!b) return 'no button: ' + bs.map((e) => e.getAttribute('data-pp-key')).join(',');
    b.click(); return true;
  }, other.source_key);
  await page.waitForTimeout(400);
  const p = await panel(page);
  ok(opened === true && p && p.text.includes(other.project_name), '6c "Details & documents" opens that pin\'s panel', [opened, p && p.text.slice(0, 60)]);
  await page.evaluate(() => document.querySelector('#projPanel [data-pp="close"]').click());
  const after = await panel(page);
  ok(after && after.hidden, '6d the panel closes');
}

console.log('\n8. a lookup that cannot be read never says the project is absent');
{
  const { page } = await open('/homesignalmap.html?zip=20187&project=' + enc, { locate: null, locateStatus: 404 });
  const p = await panel(page);
  ok(p && !p.hidden && /could not be looked up just now/.test(p.text), '8a the panel says the lookup failed', p && p.text);
  ok(p && !/not on JODY's map/.test(p.text), '8b and never that the project is not on the map');
  const sites = await page.evaluate(() => (window.__HS_SITES || []).length);
  ok(sites > 0, '8c the ZIP map itself still loads', sites);
}
{
  // a stub or changed function answering without a state is not an answer either
  const { page } = await open('/homesignalmap.html?zip=20187&project=' + enc, { locate: { ok: true } });
  const p = await panel(page);
  ok(p && /could not be looked up just now/.test(p.text), '8d an answer with no state is treated as unavailable', p && p.text);
}

console.log('\n9. found by the lookup, but the map data failed: "could not be shown", not "not on the map"');
{
  const { page } = await open('/homesignalmap.html?zip=20187&project=' + enc, { locate: found('20187'), dcStatus: 500 });
  const p = await panel(page);
  ok(p && !p.hidden && /could not be shown just now/.test(p.text) && !/not on JODY's map/.test(p.text), '9a', p && p.text);
}

console.log('\n10. a link to the old key of a merged project, after it moved from Proposed to Approved');
{
  const APPR = FIX.rows.find((r) => r.zip === '20187' && r.map_status === 'Approved');
  const locate = { key: KEY, kind: 'dcrec', state: 'found', map_key: APPR.source_key, zips: ['20187'], zip: '20187' };
  const { page } = await open('/homesignalmap.html?zip=20187&stages=proposed&project=' + enc, { locate, docs: [] });
  const focus = await page.evaluate(() => window.__HS_PROJECT_FOCUS || null);
  ok(focus && focus.mapKey === APPR.source_key, '10a the same link opens the project under its current map key', focus);
  const p = await panel(page);
  ok(p && /Approved/.test(p.text) && p.text.includes(APPR.project_name), '10b and shows its current status, although the reader had only Proposed on', p && p.text.slice(0, 120));
}

console.log('\n7. a page with no ?project= is unchanged');
{
  const { page, calls } = await open('/homesignalmap.html?zip=20187', { locate: found('20187') });
  ok(calls.length === 0, '7a no lookup is made');
  const p = await panel(page);
  ok(p && p.hidden, '7b no panel opens by itself');
}

await browser.close(); srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);

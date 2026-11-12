// MAP 1 — THE DATA-CENTRE FRESHNESS NOTICE, ON THE REAL PAGE (lib/dc-freshness.js).
//
// Drives homesignalmap.html with the production data-centre rows of the fixed ZIP sample and with
// public.dc_source_freshness answering the values read from production on 2026-11-12: Compute Atlas
// edition November 5, last successful read November 6, newest attempt November 12 FETCH_FAILED.
// The offline half is test/dc-freshness.test.mjs; the SQL half test/dc_source_freshness_pg.
//
// Run: node test/map1-dc-freshness.browser.test.mjs
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
await new Promise(r => srv.listen(8853, '127.0.0.1', r));
const base = 'http://127.0.0.1:8853';

const rowsFor = (zip) => FIX.rows.filter((r) => r.zip === zip).map((r) => { const o = Object.assign({}, r); delete o.zip; return o; });
const HOME = { '20187': [38.72, -77.75], '23150': [37.50, -77.25], '01852': [42.63, -71.30] };
// No local records at all, so every pin on the map is a data-centre row from the one contract.
// The cached report's counters are planted at 999: they describe the report's own radius set,
// so the page must drop them and count what it draws (section 3).
const zipRow = (zip) => [{ zip, home_lat: HOME[zip][0], home_lng: HOME[zip][1],
  counts: { proposed_active: 999, proposed: 999, development: 999 }, sites: [],
  paywall: false, refreshed_at: '2026-09-27T00:00:00Z', facilities_unavailable: false }];

let freshCalls = 0;
const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.HS_CHROME) launchOpts.executablePath = process.env.HS_CHROME;
const browser = await chromium.launch(launchOpts);

async function open(zip, fresh, opts) {
  opts = opts || {};
  const page = await (await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } })).newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/rpc/dc_source_freshness')) { freshCalls++; return route.fulfill(fresh); }
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
  await page.goto(base + '/homesignalmap.html?' + (opts.embed ? 'embed=1&' : '') + 'zip=' + zip, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  return { page, pageErrors };
}


const ROWS = [
  { source_key: 'compute_atlas', source_name: 'Compute Atlas (Edward Kubiak)', publisher_edition_at: '2026-11-05T18:24:03.746+00:00',
    last_success_at: '2026-11-06T09:45:05.255227+00:00', last_attempt_at: '2026-11-12T09:44:17.109168+00:00', last_attempt_state: 'FETCH_FAILED' },
  { source_key: 'epoch_ai', source_name: 'Epoch AI', publisher_edition_at: null, last_success_at: '2026-11-12T10:16:26.708644+00:00',
    last_attempt_at: '2026-11-12T10:16:27.38218+00:00', last_attempt_state: 'SUCCESS_COMPLETE' }
];
const GOOD = { status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) };
// Every pin's popup text, opened the way a resident opens it (hover).
const popups = async (page) => {
  const n = await page.locator('#map .leaflet-marker-icon:not(.homepin)').count();
  const out = [];
  for (let i = 0; i < n; i++) {
    await page.locator('#map .leaflet-marker-icon:not(.homepin)').nth(i).dispatchEvent('mouseover');
    await page.waitForTimeout(120);
    out.push(await page.evaluate(() => { const c = document.querySelector('.leaflet-popup-content'); return c ? c.innerText : ''; }));
  }
  return out;
};
const text = (page) => page.evaluate(() => { const el = document.getElementById('dcFresh'); return el ? el.innerText : null; });

console.log('\n1. ZIP 20187 — Compute Atlas pins on the page, its newest read failed');
{
  const { page, pageErrors } = await open('20187', GOOD);
  await page.waitForFunction(() => { const el = document.getElementById('dcFresh'); return el && el.querySelector('[data-dc-freshness]'); }, null, { timeout: 15000 }).catch(() => {});
  ok(pageErrors.length === 0, '1a no page errors', pageErrors[0]);
  const t = (await text(page)) || '';
  ok(t.includes('Data-center records here may be out of date'), '1b the notice is visible and says the records may be out of date', t.slice(0, 200));
  ok(t.includes("Publisher's edition date: November 5, 2026"), "1c the publisher's edition date");
  ok(t.includes('Our last successful read: November 6, 2026'), '1d our last successful read');
  ok(t.includes("Our most recent read attempt: November 12, 2026, did not complete: the publisher's file could not be downloaded. The records shown are from the November 6, 2026 read."), '1e our most recent attempt and its outcome');
  ok(t.includes('They do not mean that each facility was individually checked on either date.'), '1f it says the dates are not per-facility checks');
  ok(!t.includes('Epoch AI'), '1g a source with no record on this page is not listed');
  const vis = await page.evaluate(() => { const el = document.querySelector('#dcFresh [data-dc-freshness]'); if (!el) return null; const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, over: document.documentElement.scrollWidth > window.innerWidth }; });
  ok(vis && vis.w > 200 && vis.h > 40 && !vis.over, '1h it has a real box and does not widen the page', vis);
  const pins = await page.evaluate(() => document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)').length);
  ok(pins === 4, '1i the four data-centre pins are still drawn (the last good snapshot is still served)', pins);
  // the pin popup carries the same facts
  const pops = await popups(page);
  const LINE = 'Publisher\u2019s edition date: November 5, 2026. Our last successful read: November 6, 2026. Our most recent read attempt (November 12, 2026) did not complete. This facility was not individually checked on either date.';
  const atlas = pops.filter((t) => t.includes('Compute Atlas (Edward Kubiak)'));
  ok(atlas.length >= 2 && atlas.every((t) => t.includes(LINE)), '1j every Compute Atlas pin popup opened carries the line', atlas.length);
  const others = pops.filter((t) => t && !t.includes('Compute Atlas (Edward Kubiak)'));
  ok(others.every((t) => !/edition date/.test(t)), '1k a pin from a source with no acquisition row carries no such line', others.length);
  await page.context().close();
}

console.log('\n1m. a phone');
{
  const { page } = await open('20187', GOOD, { viewport: { width: 390, height: 800 } });
  await page.waitForFunction(() => document.querySelector('#dcFresh [data-dc-freshness]'), null, { timeout: 15000 }).catch(() => {});
  const v = await page.evaluate(() => { const el = document.querySelector('#dcFresh [data-dc-freshness]'); if (!el) return null; const r = el.getBoundingClientRect(); return { w: r.width, over: document.documentElement.scrollWidth > window.innerWidth }; });
  ok(v && v.w > 200 && v.w <= 390 && !v.over, '1m at 390px the notice fits and the page does not scroll sideways', v);
  await page.context().close();
}

console.log('\n1n. the embedded map (ZIP page preview size)');
{
  const { page, pageErrors } = await open('20187', GOOD, { embed: true, viewport: { width: 868, height: 400 } });
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => ({ disp: getComputedStyle(document.getElementById('dcFresh')).display,
    sh: document.documentElement.scrollHeight, ih: window.innerHeight }));
  ok(st.disp === 'none' && st.sh <= st.ih && pageErrors.length === 0, '1n the block below the map is not drawn in the embed and the frame does not grow', st);
  const pe = (await popups(page)).find((t) => t.includes('Compute Atlas (Edward Kubiak)')) || null;
  ok(pe && pe.includes('Our last successful read: November 6, 2026') && pe.includes('not individually checked'), '1o the embedded map\'s pin popup carries the line', pe);
  await page.context().close();
}

console.log('\n2. the reader is missing (SQL not applied) or fails');
for (const [name, resp] of [['404 (function not found)', { status: 404, contentType: 'application/json', body: '{"code":"PGRST202"}' }],
                            ['500', { status: 500, contentType: 'application/json', body: '{}' }],
                            ['a non-array body', { status: 200, contentType: 'application/json', body: '{"message":"x"}' }]]) {
  const { page, pageErrors } = await open('20187', resp);
  await page.waitForTimeout(800);
  const t = await text(page);
  const pins = await page.evaluate(() => document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)').length);
  const anyLine = (await popups(page)).some((t) => /edition date/.test(t));
  ok(anyLine === false, '2 ' + name + ': no popup carries a freshness line');
  ok(t !== null && t.trim() === '' && pageErrors.length === 0 && pins === 4, '2 ' + name + ': no notice, no error, pins unchanged', { t, pins, e: pageErrors[0] });
  await page.context().close();
}

console.log('\n3. ZIP 01852 — only OpenStreetMap records (no acquisition row): nothing is claimed');
{
  const { page } = await open('01852', GOOD);
  await page.waitForTimeout(800);
  const t = await text(page);
  ok(t !== null && t.trim() === '', '3a no notice for a source the reader does not report', t);
  await page.context().close();
}

await browser.close(); srv.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);

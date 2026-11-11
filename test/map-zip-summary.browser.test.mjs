// Chromium half of test/map-zip-summary.test.mjs: on a full staged site, the static ZIP summary renders once,
// under the map, visible after the runtime mounts; a failed data read leaves it standing; the map still draws.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright';
import { fulfillZipModeReport } from './lib/zip-mode-rpc-mock.mjs';
import { root, makeDocs, manifest, build } from './lib/map-zip-summary-fixture.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };
const docs = makeDocs();
  const site = mkdtempSync(join(tmpdir(), 'mzs-site-'));
  execFileSync('python3', ['scripts/stage_site.py', '--src', '.', '--out', site], { cwd: root, stdio: 'pipe' });
  const B = build(docs, manifest('pilot'), { out: site });
  ok(B.r.status === 0, 'full-site build succeeds');
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const srv = createServer(async (q, s) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    let p = normalize(join(site, u));
    if (u.endsWith('/')) p = join(p, 'index.html');
    try { const b = await readFile(p); s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); s.end(b); }
    catch { s.writeHead(404); s.end('nope'); }
  });
  await new Promise((r) => srv.listen(8849, '127.0.0.1', r));
  const base = 'http://127.0.0.1:8849';
  const launch = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.HS_CHROME) launch.executablePath = process.env.HS_CHROME;
  const browser = await chromium.launch(launch);
  const STUB = 'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(){return Promise.resolve({data:null,error:null});},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};';
  async function open(path, fail) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes('leaflet@1.9.4/dist/leaflet.')) {
        const css = url.endsWith('.css');
        let local = null;
        try { local = createRequire(import.meta.url).resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch (e) { local = null; }
        if (local) return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript', body: await readFile(local, 'utf8') });
      }
      if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript', body: url.endsWith('.css') ? '' : STUB });
      if (fail && url.includes('supabase.co')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"down"}' });
      // A minimal real-shaped ZIP report, so the map draws (render() runs only once a report arrives).
      const ROW = { zip: path.split('/')[2], home_lat: 42.37, home_lng: -72.52, counts: { facilities: 1, development: 0 },
        sites: [{ e: 1.8, n: 2.3, lat: 42.37, lng: -72.52, src: 'EPA FRS · registry 110000000001', type: 'built',
          label: 'TEST FACILITY', layer: 'industrial', scope: 'point', registry_id: '110000000001',
          record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110000000001' }], paywall: false, refreshed_at: '2026-09-28T00:00:00Z', facilities_unavailable: false };
      if (url.includes('/rest/v1/development_reports')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([ROW]) });
      if (url.includes('/rpc/zip_mode_report_sites')) return fulfillZipModeReport(route, () => [ROW]);
      if (url.includes('/rpc/app_zip_projects_markers')) return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ zip: ROW.zip, mode: 'development', status: 'boundary_complete', projects: [], markers: [] }) });
      if (url.includes('tile.openstreetmap')) return route.fulfill({ status: 200, contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
      if (url.includes('supabase.co')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return route.fulfill({ status: 204, body: '' });
    });
    await page.goto(base + path, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('hs-slot') && document.getElementById('results'), null, { timeout: 20000 }).catch(() => {});
    if (!fail) await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    return { page, errs };
  }
  const { page, errs } = await open('/map/01002/');
  const st = await page.evaluate(() => {
    const s = document.querySelectorAll('#hs-map-zip-summary');
    const el = s[0], r = document.getElementById('results');
    return { n: s.length, visible: !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none',
      afterResults: !!(el && r && r.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
      mapRendered: !!document.querySelector('#map .leaflet-container'),
      countSentences: (document.body.innerText.match(/distinct development projects/g) || []).length,
      robots: document.getElementById('robots-meta') && document.getElementById('robots-meta').content,
      dbg: { L: typeof window.L, sites: Array.isArray(window.__HS_SITES), map: (document.getElementById('map') || {}).outerHTML ? document.getElementById('map').outerHTML.slice(0, 200) : 'none' } };
  });
  ok(st.n === 1, 'browser: exactly one summary after JS');
  ok(st.visible, 'browser: visible in the ZIP state (hs-map-state does not hide it)');
  ok(st.afterResults, 'browser: moved under the map results, like the About block');
  ok(st.mapRendered, 'browser: the map container still renders' + (st.mapRendered ? '' : ' ' + JSON.stringify(st.dbg)));
  ok(st.countSentences === 1, `browser: the count sentence appears once (${st.countSentences})`);
  ok(st.robots === 'index, follow', 'browser: still index, follow');
  ok(errs.length === 0, `browser: no page errors (${errs.slice(0, 2)})`);
  const f = await open('/map/01002/', true);
  const fs2 = await f.page.evaluate(() => ({ n: document.querySelectorAll('#hs-map-zip-summary').length,
    txt: (document.getElementById('hs-map-zip-summary') || {}).innerText || '' }));
  ok(fs2.n === 1 && fs2.txt.includes('HomeSignal counts 3'), 'browser, data reads FAIL: the build-time summary still stands (a read failure is not an empty ZIP)');
  const c = await open('/map/01003/');
  ok(await c.page.evaluate(() => document.querySelectorAll('#hs-map-zip-summary').length === 0), 'browser: control has no summary');
  const ctlMap = await c.page.evaluate(() => !!document.querySelector('#map .leaflet-container'));
  ok(ctlMap === st.mapRendered, `browser: map drawing is the same with and without the summary (treated ${st.mapRendered}, control ${ctlMap})`);
  await browser.close();
  srv.close();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

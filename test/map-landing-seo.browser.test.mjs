// The built JODY artifact in a real browser: the Development Map landing page stays index-eligible, and every other
// state of that document (ZIP, street address, lat/lng, embed, a homepage hand-off) goes to noindex. Companion to
// test/map-landing-seo.test.mjs (the artifact's files). Run: node test/map-landing-seo.browser.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fulfillZipModeReport } from './lib/zip-mode-rpc-mock.mjs';
import { buildJodyArtifact, robotsOf } from './lib/jody-artifact.mjs';

let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined && !c ? '  [' + extra + ']' : ''));
  if (!c) fails++;
};
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const out = buildJodyArtifact();
const mapDocs = walk(join(out, 'map')).filter((f) => f.endsWith('index.html'));

// ── B. the artifact in a browser ───────────────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = createServer(async (q, s) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  let p = normalize(join(out, u));
  if (u.endsWith('/')) p = join(p, 'index.html');
  try { const b = await readFile(p); s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); s.end(b); }
  catch { s.writeHead(404); s.end('nope'); }
});
await new Promise((r) => srv.listen(8847, '127.0.0.1', r));
const base = 'http://127.0.0.1:8847';
const launch = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.HS_CHROME) launch.executablePath = process.env.HS_CHROME;
const browser = await chromium.launch(launch);
const STUB = 'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(){return Promise.resolve({data:null,error:null});},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};';

async function open(path, { handoff, zipRow, zipAuth, docAs } = {}) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  if (handoff) await page.addInitScript((a) => { try { sessionStorage.setItem('hs.homeSearchAddress', a); } catch (e) {} }, handoff);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (docAs && url === base + docAs.path) return route.fulfill({ status: 200, contentType: 'text/html', body: docAs.body });
    if (url.startsWith(base)) return route.continue();
    if (url.includes('leaflet@1.9.4/dist/leaflet.')) {
      const css = url.endsWith('.css');
      let local = null;
      try { local = createRequire(import.meta.url).resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch (e) { local = null; }
      if (local) return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript', body: await readFile(local, 'utf8') });
    }
    if (url.includes('cdn.jsdelivr.net')) {
      const css = url.endsWith('.css');
      return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript', body: css ? '' : STUB });
    }
    const J = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (zipRow) {
      if (url.includes('/rest/v1/app_community_meta')) return J([{ indexable: true, zip: zipRow.zip }]);
      if (url.includes('/rest/v1/development_reports')) return J([zipRow]);
      if (url.includes('/rpc/zip_mode_report_sites')) return fulfillZipModeReport(route, () => [zipRow]);
      if (url.includes('/rpc/app_zip_projects_markers')) return J(zipAuth);
    }
    if (url.includes('/rest/v1/') || url.includes('/rpc/') || url.includes('/functions/v1/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  return page;
}
const robotsNow = (page) => page.evaluate(() => document.getElementById('robots-meta').getAttribute('content'));
const aboutState = (page) => page.evaluate(() => {
  const el = document.getElementById('hs-map-about');
  if (!el) return { present: false };
  const b = el.getBoundingClientRect();
  return { present: true, visible: getComputedStyle(el).display !== 'none' && b.height > 0, inSlot: !!el.closest('#hs-slot') };
});

// B1. the landing page: index, the copy is visible under the map, nothing flipped it
{
  const page = await open('/homesignalmap.html');
  await page.waitForFunction(() => document.querySelector('#hs-slot #hs-map-about'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const a = await aboutState(page);
  ok(await robotsNow(page) === 'index, follow', 'B1 landing, after the runtime ran: robots is still "index, follow"');
  ok(a.present && a.visible && a.inSlot, 'B2 landing: the About copy is visible and was placed under the map', JSON.stringify(a));
  ok(await page.evaluate(() => document.querySelectorAll('h1').length) === 1, 'B3 landing: still exactly one <h1> after the copy is placed');
  ok(await page.evaluate(() => !!document.getElementById('addr') && !!document.getElementById('map')), 'B4 landing: the address search and the map are still there');
  ok(await page.evaluate(() => document.documentElement.classList.contains('hs-map-state')) === false, 'B5 landing: not marked as a non-landing state');
  await page.context().close();
}
// B2. every non-landing state is noindex, and the copy is not shown there
for (const [label, path, opts] of [
  ['a ZIP route (?zip=)', '/homesignalmap.html?zip=98335'],
  ['a street-address route (?addr=)', '/homesignalmap.html?addr=' + encodeURIComponent('4700 Point Fosdick Dr NW, Gig Harbor, WA 98335')],
  ['a lat/lng point', '/homesignalmap.html?lat=47.3&lng=-122.6'],
  ['an embed', '/homesignalmap.html?embed=1&preview=1&zip=98335'],
  ['a typed address handed over from the homepage (no query string at all)', '/homesignalmap.html', { handoff: '123 Main St, Anywhere, UT 84302' }],
]) {
  const page = await open(path, opts);
  await page.waitForFunction(() => document.querySelector('#hs-slot'), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const a = await aboutState(page);
  ok(await robotsNow(page) === 'noindex, nofollow', `B6 ${label}: robots is "noindex, nofollow" after load`, await robotsNow(page));
  ok(!a.present || !a.visible, `B7 ${label}: the landing copy is not shown`, JSON.stringify(a));
  await page.context().close();
}
// B3. the noindex is in place immediately for the URL routes, before the runtime has had a chance to run
{
  const page = await open('/homesignalmap.html?addr=' + encodeURIComponent('1 Private Way, Somewhere, WA 98335'));
  ok(await robotsNow(page) === 'noindex, nofollow', 'B8 address route: noindex is set at DOMContentLoaded, before any data call returns');
  await page.context().close();
}
// B4. the landing document can never be promoted by a ZIP's own evidence; a per-ZIP /map/<zip>/ document still is.
// Fixtures are the ones test/place-context-map-fits-frame.browser.test.mjs uses (ZIP 78617, one sourced project). The
// generated /map/<zip>/ document of an index-eligible fixture ZIP is served AT /map/78617/, so the same runtime reads the
// same evidence in both documents and only the document differs.
if (!(() => { try { createRequire(import.meta.url).resolve('leaflet/dist/leaflet.js'); return true; } catch { return false; } })()) {
  console.log('SKIP — B10..B12 need the leaflet@1.9.4 npm package (CI installs it)');
} else {
  const Z = '78617';
  const idxZip = mapDocs.map((f) => f.match(/map\/(\d{5})\/index\.html$/)[1])
    .find((z) => robotsOf(readFileSync(join(out, 'map', z, 'index.html'), 'utf8'))[0] === 'index, follow');
  const PROJECT = { e: 0.1, n: 0.1, lat: 30.1745, lng: -97.6134, type: 'approved', scope: 'point', layer: 'development',
    relevance: 'development', geo_precision: 'point', label: 'Pearce Lane', use_type: 'Commercial', type_raw: 'Site Plan',
    source_id: 'arcgis:travis:P-1', record_url: 'https://example.gov/x' };
  const zipRow = { zip: Z, home_lat: 30.1745, home_lng: -97.6134, counts: { facilities: 0, development: 1 },
    sites: [PROJECT], refreshed_at: '2026-09-12T00:00:00Z', facilities_unavailable: false };
  const zipAuth = { zip: Z, mode: 'development', status: 'boundary_complete',
    projects: [{ source_key: 'arcgis:travis:P-1', project_ref: 'arcgis:travis:P-1', name: 'Pearce Lane', type: 'Commercial', status: 'Approved',
      registry_id: 'austin-site-plan-cases', source_ref: 'https://example.gov/x', submitted_at: '2026-05-01', date_kind: 'filed',
      impact_score: null, impact_dimensions: null }],
    markers: [{ project_ref: 'arcgis:travis:P-1', lat: 30.1745, lng: -97.6134, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] };
  const doc = readFileSync(join(out, 'map', idxZip, 'index.html'), 'utf8');
  const own = await open(`/map/${Z}/`, { zipRow, zipAuth, docAs: { path: `/map/${Z}/`, body: doc } });
  await own.waitForFunction(() => Array.isArray(window.__HS_SITES) && window.__HS_SITES.length > 0, null, { timeout: 30000 }).catch(() => {});
  await own.waitForTimeout(1500);
  ok(await own.evaluate(() => (window.__HS_SITES || []).length) > 0, 'B10 control: the per-ZIP document rendered the mocked evidence');
  ok(await robotsNow(own) === 'index, follow', 'B11 control: that per-ZIP document ends "index, follow" (its own evidence rules are intact)', await robotsNow(own));
  await own.context().close();
  const landing = await open(`/homesignalmap.html?zip=${Z}`, { zipRow, zipAuth });
  await landing.waitForFunction(() => Array.isArray(window.__HS_SITES) && window.__HS_SITES.length > 0, null, { timeout: 30000 }).catch(() => {});
  await landing.waitForTimeout(1500);
  ok(await landing.evaluate(() => (window.__HS_SITES || []).length) > 0, 'B12 control: the same evidence reached the landing document and rendered content');
  ok(await robotsNow(landing) === 'noindex, nofollow', 'B13 the same ZIP evidence does NOT promote the landing document (its canonical is the landing page)', await robotsNow(landing));
  await landing.context().close();
}
await browser.close();
srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nAll map landing SEO browser assertions passed.');
process.exit(fails ? 1 : 0);

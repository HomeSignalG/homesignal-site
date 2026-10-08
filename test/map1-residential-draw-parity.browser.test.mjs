// MAP 1 RESIDENTIAL — every record the ZIP-mode builder qualifies is DRAWN (2026-09-27).
//
// The real homesignalmap.html in a real browser, fed one ZIP whose Residential records qualify
// on their CLASS FIELD (`type_raw`) alone, in every lifecycle slice. Before the fix the builder
// qualified them and the draw-time check in render() removed them, because it read `type_raw`
// off a site that carries the class as `permit_class`. This asserts, per slice, that the
// markers on the Leaflet map equal what the shipped builder assigns - counted off the page's
// own drawn markers, never off a re-derivation.
//
// Run: node test/map1-residential-draw-parity.browser.test.mjs
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
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;

const ZIP = '76226';
let n = 0;
const P = (o) => {
  n++;
  const ref = 'arcgis:test:R-' + n;
  return Object.assign({ source_key: ref, project_ref: ref, type: 'Residential',
    source_ref: 'https://example.gov/permit/' + n, submitted_at: '2026-08-0' + ((n % 9) + 1),
    date_kind: 'filed', impact_score: null, impact_dimensions: null }, o);
};
// Each record's ONLY development evidence is its class field; the name is an address.
const CLASS_QUALIFIED = [
  P({ status: 'Approved', registry_id: 'denton-county-dev-permits', type_raw: 'HOUSE', name: '1234 OAK ST' }),
  P({ status: 'Proposed', registry_id: 'miami-building-permits', type_raw: 'New Construction', name: '2 NW 5 AVE' }),
  P({ status: 'Operating', registry_id: 'x', type_raw: 'NEW SFR', name: '9 PINE CT' }),
  P({ status: 'On file', registry_id: 'x', type_raw: 'Preliminary Plat', name: '44 CEDAR LN' })
];
// Controls: qualified by its name (drawn before and after), routine (never built), and another Type.
const NAME_QUALIFIED = P({ status: 'Operating', registry_id: 'x', type_raw: 'Residential',
  name: 'NEW CONSTRUCTION SINGLE FAMILY 7 ELM' });
const ROUTINE = P({ status: 'Approved', registry_id: 'overland-park-building-permits', type_raw: 'Deck', name: '3 BIRCH' });
const COMMERCIAL = P({ status: 'Approved', registry_id: 'x', type: 'Commercial', type_raw: 'Commercial', name: 'Shop' });
const PROJECTS = CLASS_QUALIFIED.concat([NAME_QUALIFIED, ROUTINE, COMMERCIAL]);
const MARKERS = [];
PROJECTS.forEach((p, i) => MARKERS.push({ project_ref: p.project_ref, lat: 33.10 + i * 0.002, lng: -96.90 - i * 0.002,
  marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }));
// A second marker on the first project: the marker grain must survive too.
MARKERS.push({ project_ref: CLASS_QUALIFIED[0].project_ref, lat: 33.12, lng: -96.93,
  marker_rule: 'LINE_MERGED_COMPONENT_1', marker_seq: 1 });
const AUTH = { zip: ZIP, mode: 'development', status: 'boundary_complete', projects: PROJECTS, markers: MARKERS };
const ROW = [{ zip: ZIP, home_lat: 33.11, home_lng: -96.91, counts: { facilities: 0, development: 0 }, sites: [],
  refreshed_at: '2026-09-27T00:00:00Z', facilities_unavailable: false }];

const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.HS_CHROME) launchOpts.executablePath = process.env.HS_CHROME;
const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('/rpc/app_zip_projects_markers')) {
    let z = '';
    try { z = String(JSON.parse(route.request().postData() || '{}').p_zip || ''); } catch (e) { z = ''; }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(z === ZIP ? AUTH : { zip: z, mode: 'development', status: 'not_measured', projects: null, markers: null }) });
  }
  if (url.includes('/rpc/zip_mode_report_sites')) return fulfillZipModeReport(route, (z) => (z === ZIP ? ROW : []));
  if (url.includes('/rest/v1/development_reports'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(url.includes(ZIP) ? ROW : []) });
  if (url.includes('/rest/v1/communities'))
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ name: 'Frisco (76226)', level: 'zip', county: 'Denton', state: 'TX' }]) });
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

await page.goto(base + '/homesignalmap.html?zip=' + ZIP, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__HS_VERIFY && Array.isArray(window.__HS_SITES) && Array.isArray(window.siteMarkers),
  null, { timeout: 30000 });
await page.waitForTimeout(600);

const got = await page.evaluate((refs) => {
  const HS = window.HS;
  const SL = ['proposed', 'approved', 'operating', 'unknown'];
  const drawn = Object.fromEntries(SL.map((k) => [k, 0]));
  const drawnRefs = {};
  let commercialDrawn = 0;
  (window.siteMarkers || []).forEach((x) => {
    if (!x || !x.m || !x.m._map || !x.s || x.s.zip_authoritative !== true) return;
    if (x.mk && x.mk.typeKey === 'commercial') commercialDrawn++;
    if (!x.mk || x.mk.typeKey !== 'residential') return;
    drawn[SL.indexOf(x.bucket) === -1 ? 'unknown' : x.bucket]++;
    drawnRefs[x.s.zip_project_ref] = (drawnRefs[x.s.zip_project_ref] || 0) + 1;
  });
  // CONTROL, in the page's own context: the same rendered sites through the draw-time check
  // with the builder's recorded evidence removed - the page before the fix.
  const sites = (window.__HS_SITES || []).filter((s) => s && s.zip_authoritative === true);
  const isRes = (s) => HS.resolveTrackerMarker(s).typeKey === 'residential';
  const pre = HS.residentialQualifySites(sites.map((s) => { const c = Object.assign({}, s); delete c.residential_evidence; return c; }))
    .filter(isRes).length;
  const v = window.__HS_VERIFY || {};
  return { drawn, drawnRefs, commercialDrawn, pre, qualifiedRes: sites.filter(isRes).length,
           allTypesOff: v.allTypesOff, stagesOn: v.stagesOn || [],
           rails: ['apprList', 'propList'].map((id) => Array.from(document.querySelectorAll('#' + id + ' .rec'))
             .map((el) => el.getAttribute('data-ref'))) };
}, PROJECTS.map((p) => p.project_ref));

ok(got.allTypesOff === false && got.stagesOn.length === 4, 'setup: default filters — every Type and all four stages on',
   got.stagesOn.join(','));
// 1 Approved (2 markers) · 1 Proposed · 2 Operating (class + name) · 1 unknown.
ok(got.drawn.approved === 2, 'approved: both markers of the class-qualified record are drawn', got.drawn.approved);
ok(got.drawn.proposed === 1, 'proposed: the class-qualified record is drawn', got.drawn.proposed);
ok(got.drawn.operating === 2, 'operating: the class-qualified record and the name-qualified control are drawn', got.drawn.operating);
ok(got.drawn.unknown === 1, 'lifecycle unknown: the class-qualified record is drawn', got.drawn.unknown);
for (const p of CLASS_QUALIFIED) {
  ok(!!got.drawnRefs[p.project_ref], 'drawn: ' + p.registry_id + ' / ' + p.type_raw + ' / ' + p.status);
}
ok(got.qualifiedRes === 6, 'qualified (the rendered set) = drawn: 6 Residential markers', got.qualifiedRes);
ok(!got.drawnRefs[ROUTINE.project_ref], 'the routine Deck permit is still not drawn');
ok(got.commercialDrawn === 1, 'the Commercial control is drawn, untouched');
ok(got.pre === 1, 'CONTROL: before the fix only the name-qualified record of the 6 survived the draw-time check', got.pre);
// Rail rows carry the page's own railKey ('ref:' + project ref), homesignalmap.html railKey().
ok(got.rails[0].indexOf('ref:' + CLASS_QUALIFIED[0].project_ref) !== -1
   && got.rails[1].indexOf('ref:' + CLASS_QUALIFIED[1].project_ref) !== -1,
   'the Approved and Proposed rails list the class-qualified records');
ok(pageErrors.length === 0, 'no uncaught page errors', pageErrors.join(' | '));

await browser.close();
srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);

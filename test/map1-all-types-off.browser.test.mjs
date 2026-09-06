// MAP 1 — ALL TYPE FILTERS OFF: the map explains itself instead of going silently blank.
//
// SCOPE. Type filtering already exists (#1056). This suite proves ONLY the remaining gap:
// with every Type chip off, the map is empty and nothing tells the resident why — which is
// indistinguishable from a ZIP with no coverage. It also pins the #1056 contract this change
// must not disturb, because the cheapest way to break dual identity is to touch the filter
// path while "just adding a message".
//
// It drives the REAL shipped architecture — HS.getCategoryFilters / setCategoryFilter /
// allCategoriesOff / categoryVisible out of lib/map.js, and the chips clicked the way a
// resident clicks them. Nothing here reimplements or stubs a filter model.
//
// The three fixture records are VERBATIM production `development_reports` site objects
// (ZIP 20171, pulled 2026-09-06), the same ones test/map1-dual-identity.browser.test.mjs uses.
//
// Run: node test/map1-all-types-off.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
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
await new Promise(r => srv.listen(8814, '127.0.0.1', r));
const base = 'http://127.0.0.1:8814';

// ── production records ──────────────────────────────────────────────────────────────
const DUAL = { e: 1.482, n: 1.664, lat: 38.94932, lng: -77.36519,
  src: 'EPA FRS · registry 110071955663', type: 'built', label: 'CORESITE - VA1 DATA CENTER',
  layer: 'datacenter', scope: 'point', registry_id: '110071955663',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110071955663' };
const PLAIN_FAC = { e: 1.82, n: 2.361, lat: 38.95942, lng: -77.35889,
  src: 'EPA FRS · registry 110072041130', type: 'built', label: 'ANDURIL INDUSTRIES, INC',
  layer: 'industrial', scope: 'point', registry_id: '110072041130',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110072041130' };
const DC_PROJECT = { e: 1.515, n: 1.756, lat: 38.95065, lng: -77.36458, type: 'approved',
  label: 'Pennhurst Data Centers', layer: 'development', scope: 'point', use_type: 'Data Center',
  type_raw: 'Data Center', relevance: 'development', bucket: 'approved',
  jurisdiction: 'Fairfax County Land Development Services', geo_precision: 'point',
  record_url: 'https://plus.fairfaxcounty.gov/x', source_id: 'arcgis:fairfax:P-1' };

const ZIP_AUTH = { '20171': { zip: '20171', mode: 'development', status: 'boundary_complete',
  projects: [{ source_key: 'arcgis:fairfax:P-1', project_ref: 'arcgis:fairfax:P-1',
    name: 'Pennhurst Data Centers', type: 'Data Center', status: 'Approved',
    registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/x',
    submitted_at: '2026-01-04', date_kind: 'filed', impact_score: null, impact_dimensions: null }],
  markers: [{ project_ref: 'arcgis:fairfax:P-1', lat: 38.95065, lng: -77.36458,
    marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] } };
// 20172 is the PRODUCT-TRUTH control: a ZIP with no records at all. "Turn a type back on to
// show records" must NOT appear there — it would promise records that do not exist.
const ZIP_ROW = {
  '20171': [{ zip: '20171', home_lat: 38.9506, home_lng: -77.3645,
    counts: { facilities: 2, development: 1 }, sites: [DUAL, PLAIN_FAC, DC_PROJECT],
    refreshed_at: '2026-09-06T00:00:00Z', facilities_unavailable: false }],
  '20172': [{ zip: '20172', home_lat: 38.9506, home_lng: -77.3645,
    counts: { facilities: 0, development: 0 }, sites: [],
    refreshed_at: '2026-09-06T00:00:00Z', facilities_unavailable: false }]
};
const COMMUNITIES = {
  '20171': [{ name: 'Herndon (20171)', level: 'zip', county: 'Fairfax', state: 'VA' }],
  '20172': [{ name: 'Herndon (20172)', level: 'zip', county: 'Fairfax', state: 'VA' }]
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
const zipOf = (url) => (url.match(/(?:zip=eq\.|%7B)(\d{5})/) || [])[1] || null;

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('/rpc/app_zip_projects_markers')) {
    let z = '';
    try { z = String(JSON.parse(route.request().postData() || '{}').p_zip || ''); } catch (e) { z = ''; }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(ZIP_AUTH[z] || { zip: z, mode: 'development', status: 'not_measured', projects: null, markers: null }) });
  }
  if (url.includes('/rest/v1/development_reports'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ZIP_ROW[zipOf(url)] || []) });
  if (url.includes('/rest/v1/communities'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COMMUNITIES[zipOf(url)] || []) });
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

const load = async (zip) => {
  await page.goto(base + '/homesignalmap.html?zip=' + zip, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(600);
};
// A resident sets types by CLICKING the chips — never by poking filter state directly.
const setTypes = (keys) => page.evaluate((want) => {
  Array.from(document.querySelectorAll('#mapkeyShapes span.sh[data-cat]')).forEach((r) => {
    const on = r.getAttribute('aria-pressed') === 'true';
    const should = want.indexOf(r.getAttribute('data-cat')) !== -1;
    if (on !== should) r.click();
  });
}, keys);
const allKeys = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#mapkeyShapes span.sh[data-cat]')).map(r => r.getAttribute('data-cat')));
const noteShown = () => page.evaluate(() => {
  const el = document.getElementById('mapkeyEmpty');
  return !!el && !el.hidden && el.offsetParent !== null;
});
const pins = () => page.evaluate(() =>
  document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)').length);
const verify = () => page.evaluate(() => window.__HS_VERIFY);

await load('20171');
const KEYS = await allKeys();
ok(KEYS.length === 8, 'setup: 8 Type chips carry data-cat', KEYS.join(','));
ok((await pins()) === 3, 'setup: the three production records render', await pins());

// ── 1-3. THE NOTE STAYS HIDDEN WHILE ANY TYPE IS ON ──────────────────────────────────
ok(!(await noteShown()), '1: all Types on  -> no all-off note');
await setTypes(KEYS.filter(k => k !== 'industrial'));
ok(!(await noteShown()), '2: ONE Type off  -> no all-off note');
await setTypes(['facility']);
ok(!(await noteShown()), '3: seven of eight Types off -> still no all-off note');
ok((await pins()) > 0, '3: ...and records are still on the map', await pins());

// ── 4. EVERY TYPE OFF -> EMPTY MAP THAT SAYS WHY ─────────────────────────────────────
await setTypes([]);
ok((await pins()) === 0, '4: all Types off -> zero eligible records rendered');
ok(await noteShown(), '4: ...and the note is visible');
const v4 = await verify();
ok(v4.allTypesOff === true && v4.visibleMarkers === 0 && v4.mapMarkers === 3,
  '4: __HS_VERIFY separates "resident hid everything" from "no records"',
  JSON.stringify({ allTypesOff: v4.allTypesOff, visible: v4.visibleMarkers, total: v4.mapMarkers }));
const txt = await page.textContent('#mapkeyEmpty');
ok(/type/i.test(txt) && /hidden/i.test(txt), '4: the note names the control the resident must use', txt.trim());

// ── 5. RE-ENABLE ONE TYPE -> NOTE GONE, RECORDS BACK ─────────────────────────────────
await setTypes(['residential']);
ok(!(await noteShown()), '5: re-enabling one Type hides the note immediately');
await setTypes(['facility']);
ok((await pins()) === 2 && !(await noteShown()),
  '5: ...and the eligible records return', await pins());

// ── 6. DUAL IDENTITY — THE #1056 CONTRACT, UNCHANGED ─────────────────────────────────
// CORESITE - VA1 DATA CENTER carries categories ['datacenter','facility'] and must survive
// either qualifying category staying on.
const labels = () => page.evaluate(() => (window.__HS_SITES || [])
  .filter(s => window.__HS_RESOLVE_TRACKER && window.__HS_CATEGORY_FILTERS &&
    (window.HS.markerCategories(window.__HS_RESOLVE_TRACKER(s))
      .some(k => window.__HS_CATEGORY_FILTERS[k])))
  .map(s => s.label));
await setTypes(['facility']);                       // Data center OFF, Regulated facility ON
ok((await labels()).indexOf('CORESITE - VA1 DATA CENTER') !== -1,
  '6: dual record VISIBLE with Data center OFF + Regulated facility ON');
await setTypes(['datacenter']);                     // Regulated facility OFF, Data center ON
ok((await labels()).indexOf('CORESITE - VA1 DATA CENTER') !== -1,
  '6: dual record VISIBLE with Regulated facility OFF + Data center ON');
await setTypes(KEYS.filter(k => k !== 'datacenter' && k !== 'facility'));   // both OFF
ok((await labels()).indexOf('CORESITE - VA1 DATA CENTER') === -1,
  '6: dual record HIDDEN only when BOTH of its categories are off');
ok(!(await noteShown()), '6: ...and that is not an all-off state, so no note');
const v6 = await verify();
ok(v6.dualIdentityMarkers === 1, '6: still exactly ONE dual-identity marker object', v6.dualIdentityMarkers);

// ── 7. STAGE x TYPE STILL COMPOSES ───────────────────────────────────────────────────
await setTypes(KEYS);
const before = await pins();
await page.click('#mapkey span:has-text("Approved")');      // hides the approved DC project
const afterStage = await pins();
ok(afterStage === before - 1, '7: a Stage chip still filters independently of Type',
  before + ' -> ' + afterStage);
await setTypes([]);                                          // now ALSO all types off
ok((await pins()) === 0 && await noteShown(), '7: Stage off + all Types off -> note still correct');
await setTypes(KEYS);
await page.click('#mapkey span:has-text("Approved")');       // restore stage
ok((await pins()) === before && !(await noteShown()), '7: both dimensions restored', await pins());

// ── 8. PERSISTENCE (sessionStorage) SURVIVES A RELOAD, AND SO DOES THE NOTE ──────────
await setTypes([]);
await load('20171');
const persisted = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#mapkeyShapes span.sh[data-cat]'))
    .every(r => r.getAttribute('aria-pressed') === 'false'));
ok(persisted, '8: every Type chip is still OFF after a reload (sessionStorage preserved)');
ok((await pins()) === 0 && await noteShown(), '8: ...and the note is shown on load, not only on click');

// ── 9. PRODUCT TRUTH — a ZIP with NO records must not be told to turn a type back on ──
await load('20172');
const v9 = await verify();
ok(v9.allTypesOff === true, '9: control — the all-off filter state carried into the empty ZIP');
ok(v9.mapMarkers === 0, '9: control — that ZIP genuinely has no records', v9.mapMarkers);
ok(!(await noteShown()),
  '9: the note is NOT shown where there are no records to reveal (no promise of absent data)');

// reset so a later suite in the same browser profile starts clean
await load('20171');
await setTypes(KEYS);
ok(pageErrors.length === 0, '10: no uncaught page errors', pageErrors.join(' | '));

await browser.close();
srv.close();
console.log('\n' + (fails ? fails + ' FAILED' : 'map1-all-types-off: all checks passed'));
process.exit(fails ? 1 : 0);

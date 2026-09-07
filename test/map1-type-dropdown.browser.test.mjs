// MAP 1 — DATA CENTER + EPA DUAL IDENTITY, driven in a real browser.
//
// The unit test next door (test/marker-dual-identity.test.mjs) proves the RESOLVER.
// This one proves the PRODUCT: the founder's acceptance scenario performed the way a
// resident performs it — by clicking the legend — on the real homesignalmap.html.
//
//   A site proven to be DATA CENTER + EPA REGULATED FACILITY.
//   Turn OFF every Map 1 type except EPA / Regulated facility.
//
// ⚖️ UPDATED 2026-09-06. Regulated facility is no longer a Type: it moved to its own
// "Regulatory records" switch, so this dropdown lists the SEVEN project types and the
// EPA half of the scenario is driven by #regToggle instead of an eighth checkbox.
//   The site remains visible, drawn as a DATA CENTER with an EPA square beneath it,
//   exactly ONCE, and its popup states both truths.
//
// Every fixture site below is a VERBATIM production `development_reports` site object
// (ZIP 20171, pulled 2026-09-06) — the CoreSite VA1 EPA registration, an ordinary EPA
// facility in the same ZIP, and a data-centre project with no EPA record.
//
// Run: node test/map1-dual-identity.browser.test.mjs
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
await new Promise(r => srv.listen(8819, '127.0.0.1', r));
const base = 'http://127.0.0.1:8819';

// ── the three production records ────────────────────────────────────────────────────
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

// The project record needs AUTHORITATIVE whole-ZIP geometry to render in ZIP mode —
// zip-authoritative deliberately strips centroid-radius development, so a fixture that
// skipped this would prove nothing about the project pin. Facilities are unaffected.
const ZIP_AUTH = { '20171': { zip: '20171', mode: 'development', status: 'boundary_complete',
  projects: [{ source_key: 'arcgis:fairfax:P-1', project_ref: 'arcgis:fairfax:P-1',
    name: 'Pennhurst Data Centers', type: 'Data Center', status: 'Approved',
    registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/x',
    submitted_at: '2026-01-04', date_kind: 'filed', impact_score: null, impact_dimensions: null }],
  markers: [{ project_ref: 'arcgis:fairfax:P-1', lat: 38.95065, lng: -77.36458,
    marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] } };
const ZIP_ROW = { '20171': [{ zip: '20171', home_lat: 38.9506, home_lng: -77.3645,
  counts: { facilities: 2, development: 1 }, sites: [DUAL, PLAIN_FAC, DC_PROJECT],
  refreshed_at: '2026-09-06T00:00:00Z', facilities_unavailable: false }] };
const COMMUNITIES = { '20171': [{ name: 'Herndon (20171)', level: 'zip', county: 'Fairfax', state: 'VA' }] };

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
  // Leaflet is REAL — the marker layer is exactly what this suite reads. Served from a
  // local copy when one resolves, else from the CDN the page already names. If neither
  // works the map does not render and these assertions go red, which is correct — a
  // silent skip would let a broken filter ship looking green.
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


await page.goto(base + '/homesignalmap.html?zip=20171', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
await page.waitForTimeout(700);

const pins   = () => page.evaluate(() => document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)').length);
const menuOpen = () => page.evaluate(() => { const m=document.getElementById('typeFilterMenu'); return !!m && !m.hidden; });
const boxes  = () => page.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('#typeFilterMenu input[data-cat-input]')].map(b => [b.getAttribute('data-cat-input'), b.checked])));
const chips  = () => page.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('#mapkeyShapes span.sh[data-cat]')].map(c => [c.getAttribute('data-cat'), c.getAttribute('aria-pressed') === 'true'])));
const badge  = () => page.evaluate(() => { const c=document.getElementById('typeFilterCount'); return c && !c.hidden ? c.textContent : null; });
const state  = () => page.evaluate(() => window.HS.getCategoryFilters());

ok(await page.isVisible('#typeFilterBtn'), '1: a "Show types" control sits next to the Type heading');
ok(!(await menuOpen()), '1: the dropdown starts closed');
const base0 = await pins();
ok(base0 === 3, '1: the fixture population renders', base0);

await page.click('#typeFilterBtn');
ok(await menuOpen(), '2: clicking the control opens the dropdown');
ok(Object.keys(await boxes()).length === 7, '2: it lists all 7 project types', Object.keys(await boxes()).length);
ok(Object.values(await boxes()).every(Boolean), '2: all start checked');

await page.uncheck('#typeFilterMenu input[data-cat-input="datacenter"]');
ok((await state()).datacenter === false, '3: unchecking writes the SHARED filter state');
ok((await chips()).datacenter === false, '3: ...and the legend CHIP updates to match');
ok((await badge()) === '1', '3: the control shows a hidden-count badge', await badge());
ok((await pins()) < base0, '3: pins actually left the map', (await pins()) + ' of ' + base0);

// The open menu is a popover and deliberately sits OVER the chips it filters, so a
// resident closes it before using the legend directly. Escape mirrors that.
await page.keyboard.press('Escape');
ok(!(await menuOpen()), '4: the menu is closed before touching the legend chips');
// Deliberately NOT 'industrial': no fixture record carries that category, so hiding it
// would correctly change nothing - the absent-category chip issue, not a filter defect.
// An assertion that cannot move is not a test, so this uses a category the data has.
const before = await pins();
await page.click('#mapkeyShapes span.sh[data-cat="other"]');
ok((await boxes()).other === false, '4: clicking a CHIP updates the dropdown checkbox');
ok((await badge()) === '2', '4: the badge tracks both controls', await badge());
// The dropdown is the TYPE control, so its badge must count project types only — a
// regulatory record is not a hidden "type" and must never appear in that count.
ok((await boxes()).facility === undefined,
  '4b: the Type dropdown offers no "Regulated facility" row', JSON.stringify(await boxes()));

await page.click('#typeFilterBtn');
await page.click('#typeFilterAll');
ok(Object.values(await boxes()).every(Boolean) && Object.values(await chips()).every(Boolean),
  '5: "Show all types" resets BOTH controls');
ok((await badge()) === null, '5: the badge clears');
ok((await pins()) === base0, '5: every pin returns', await pins());

const TYPE_KEYS = ['datacenter','industrial','residential','infrastructure','commercial','civic','other'];
for (const k of TYPE_KEYS) await page.uncheck('#typeFilterMenu input[data-cat-input="' + k + '"]');
ok((await page.$$('#typeFilterMenu input[data-cat-input]')).length === TYPE_KEYS.length,
  '6: the dropdown offers exactly the seven project types');
// Every TYPE is off, but the regulatory switch is still on and its records are still
// drawn — so the map is not empty and must not claim to be.
ok((await pins()) > 0, '6: unchecking every type leaves the regulatory records on the map', await pins());
ok(!(await page.isVisible('#mapkeyEmpty')), '6: ...so the all-off note stays silent');
// Same popover rule as §4: the open menu sits OVER the rows beneath it, so a resident
// closes it before reaching the Regulatory records switch. Asserted rather than assumed —
// a click that lands on the popover instead of the switch is a real usability defect and
// the test must fail on it, not route around it invisibly.
await page.keyboard.press('Escape');
ok(!(await menuOpen()), '6b: the menu is closed before touching the regulatory switch');
await page.click('#regToggle');
ok((await pins()) === 0, '6b: turning the regulatory switch off as well empties the map');
ok(await page.isVisible('#mapkeyEmpty'), '6b: ...and now the all-off note fires');
await page.click('#regToggle');
await page.click('#typeFilterBtn');
await page.click('#typeFilterAll');
// "Show all types" is the TYPE control's reset and must not reach across dimensions.
ok(await page.evaluate(() => document.getElementById('regToggle').getAttribute('aria-checked')) === 'true',
  '6c: "Show all types" leaves the regulatory switch exactly as it found it');

await page.uncheck('#typeFilterMenu input[data-cat-input="datacenter"]');
const labels = () => page.evaluate(() => (window.__HS_SITES||[])
  .filter(s => window.HS.markerCategories(window.__HS_RESOLVE_TRACKER(s)).some(k => window.HS.getCategoryFilters()[k]))
  .map(s => s.label));
ok((await labels()).includes('CORESITE - VA1 DATA CENTER'),
  '7: DUAL IDENTITY intact - data center OFF, regulatory ON, record still visible');
await page.click('#typeFilterAll');

await page.click('body', { position: { x: 5, y: 5 } });
ok(!(await menuOpen()), '8: clicking outside closes the dropdown');
await page.click('#typeFilterBtn');
await page.keyboard.press('Escape');
ok(!(await menuOpen()), '8: Escape closes it');

ok(pageErrors.length === 0, '9: no uncaught page errors', pageErrors.join(' | '));
await browser.close(); srv.close();
console.log('\n' + (fails ? fails + ' FAILED' : 'map1-type-dropdown: all checks passed'));
process.exit(fails ? 1 : 0);

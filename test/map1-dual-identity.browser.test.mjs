// MAP 1 — DATA CENTER + EPA DUAL IDENTITY, driven in a real browser.
//
// The unit test next door (test/marker-dual-identity.test.mjs) proves the RESOLVER.
// This one proves the PRODUCT: the founder's acceptance scenario performed the way a
// resident performs it — by clicking the legend — on the real homesignalmap.html.
//
//   A site proven to be DATA CENTER + EPA REGULATED FACILITY.
//   Turn OFF every Map 1 type except EPA / Regulated facility.
//
// ⚖️ UPDATED 2026-09-06. Regulated facility left the Type row for its own "Regulatory
// records" switch and the subordinate purple square became a lower-right purple R badge.
// The CONTRACT under test is unchanged — one record, two memberships, one marker, primary
// identity Data center — so only the control that is clicked and the badge that is read
// have moved. `setReg` drives the switch; `readMarkers` reports the badge letter.
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
await new Promise(r => srv.listen(8811, '127.0.0.1', r));
const base = 'http://127.0.0.1:8811';

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
await page.waitForTimeout(600);

// A rendered marker, described by what a resident can actually see.
const readMarkers = () => page.evaluate(() => {
  return Array.from(document.querySelectorAll('#map .leaflet-marker-icon')).map(el => {
    const svg = el.querySelector('svg');
    const html = svg ? svg.outerHTML : '';
    const poly = (html.match(/<polygon/g) || []).length;
    const pts = (html.match(/points="([^"]+)"/) || [])[1] || '';
    return {
      home: el.classList.contains('homepin'),
      primaryPoints: pts.trim().split(/\s+/).filter(Boolean).length,
      polygons: poly,
      rects: (html.match(/<rect/g) || []).length,
      purple: /#7d148c/i.test(html),
      // The regulatory BADGE, read off the painted markup: a purple rect carrying a
      // white capital R. `rects` alone cannot say that — a capsule primary is a rect too.
      rBadge: /#7d148c/i.test(html) && />R<\/text>/.test(html)
    };
  }).filter(m => !m.home);
});
// Turn the type rows on/off exactly the way a resident does: by clicking them.
const setTypes = (on) => page.evaluate((keys) => {
  const rows = Array.from(document.querySelectorAll('#mapkeyShapes span.sh[data-cat]'));
  rows.forEach(r => {
    const want = keys.indexOf(r.getAttribute('data-cat')) !== -1;
    const isOn = r.getAttribute('aria-pressed') === 'true';
    if (want !== isOn) r.click();
  });
  return rows.map(r => r.getAttribute('data-cat') + '=' + r.getAttribute('aria-pressed'));
}, on);
// The regulatory dimension is ONE switch in its own row — clicked, like everything else.
const setReg = (want) => page.evaluate((on) => {
  const t = document.getElementById('regToggle');
  if (t && (t.getAttribute('aria-checked') === 'true') !== on) t.click();
}, want);

// ── 0. the surface exists and is honest before anything is clicked ─────────────────
const rowKeys = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#mapkeyShapes span.sh[data-cat]')).map(r => r.getAttribute('data-cat')));
ok(rowKeys.includes('datacenter') && !rowKeys.includes('facility'),
  '0a: the TYPE row exposes Data center and NOT Regulated facility', rowKeys.join(','));
ok(await page.evaluate(() => !!document.getElementById('regToggle')),
  '0a2: …and regulatory records have their own switch instead');
const before = await readMarkers();
ok(before.length === 3, '0b: all three production records render with every filter on', before.length);

// THE OCTAGON IS 8 POINTS, THE SQUARE IS A <rect> — read from the DOM, not from our model.
const dualMk = before.filter(m => m.primaryPoints === 8 && m.rBadge);
ok(dualMk.length === 1,
  '1: the dual-identity record draws ONE marker: an octagon primary with a purple R badge', dualMk.length);
ok(before.filter(m => m.rects === 1 && m.polygons === 0 && !m.rBadge).length === 1,
  '2: a regulatory-only location still draws a plain purple square — unchanged', 'ANDURIL INDUSTRIES');
ok(before.filter(m => m.primaryPoints === 8 && m.rects === 0).length === 1,
  '3: the ordinary data-centre project draws a bare octagon — no EPA signal invented');

// ── 4. THE FOUNDER'S ACCEPTANCE TEST — every type OFF, regulatory ON ──────────────
await setTypes([]); await setReg(true);
await page.waitForTimeout(250);
const epaOnly = await readMarkers();
const epaOnlyDual = epaOnly.filter(m => m.primaryPoints === 8 && m.rBadge);
ok(epaOnly.length === 2, '4a: EPA-only → exactly the two records with EPA membership remain', epaOnly.length);
ok(epaOnlyDual.length === 1,
  '4b: ALL TYPES OFF + REGULATORY ON → the data centre is STILL VISIBLE, STILL an octagon, STILL carrying its R badge, exactly ONCE');
ok(epaOnly.filter(m => m.primaryPoints === 8 && m.rects === 0).length === 0,
  '4c: …and the data-centre PROJECT (no EPA record) is correctly hidden');

// ── 5. The mirror case — Data Center only, regulatory OFF ────────────────────────
// This is where the two dimensions come apart, and it is the whole point of the split:
// the PROJECT is not hidden by the regulatory switch, only its regulatory annotation is.
await setTypes(['datacenter']); await setReg(false);
await page.waitForTimeout(250);
const dcOnly = await readMarkers();
ok(dcOnly.length === 2, '5a: Data center only → the dual record and the DC project', dcOnly.length);
ok(dcOnly.filter(m => m.primaryPoints === 8).length === 2,
  '5b: DC ON / regulatory OFF → the regulated data centre is STILL DRAWN, still an octagon');
ok(dcOnly.filter(m => m.rBadge).length === 0,
  '5b2: …and the R badge is gone — the switch hides the annotation, never the project');
ok(dcOnly.filter(m => m.rects === 1 && m.polygons === 0).length === 0,
  '5c: …and the regulatory-only location is correctly hidden');
// The switch is reversible and does not disturb the Type row it sits under.
await setReg(true);
await page.waitForTimeout(250);
ok((await readMarkers()).filter(m => m.rBadge).length === 1,
  '5d: turning it back on repaints the badge on the already-drawn pin');
ok(await page.evaluate(() => Array.from(document.querySelectorAll('#mapkeyShapes span.sh[data-cat]'))
     .filter(r => r.getAttribute('aria-pressed') === 'true').map(r => r.getAttribute('data-cat')).join(',')) === 'datacenter',
  '5e: …and every Type chip is exactly where the resident left it');

// ── 6. Both on / both off ─────────────────────────────────────────────────────────
await setTypes(['datacenter']); await setReg(true);
await page.waitForTimeout(250);
const bothOn = await readMarkers();
ok(bothOn.length === 3 && bothOn.filter(m => m.primaryPoints === 8 && m.rBadge).length === 1,
  '6a: BOTH ON → the dual record appears ONCE, not once per matching filter', bothOn.length);

await setTypes([]); await setReg(false);
await page.waitForTimeout(250);
ok((await readMarkers()).length === 0, '6b: BOTH OFF → not visible');

// ── 7. One underlying record, and the page says so ────────────────────────────────
await setTypes([]); await setReg(true);
await page.waitForTimeout(250);
const v = await page.evaluate(() => window.__HS_VERIFY);
ok(v.dualIdentityMarkers === 1,
  '7a: the page reports exactly ONE dual-identity marker object — dual membership never created a second record', v.dualIdentityMarkers);
ok(v.visibleMarkers === 2, '7b: the visible count under regulatory-only is 2 underlying records, not 3', v.visibleMarkers);

// ── 8. The popup carries both truths, identity first ──────────────────────────────
const popup = await page.evaluate(() => {
  const HS = window.HS;
  const site = (window.__HS_SITES || []).filter(s => /CORESITE/.test(s.label || ''))[0];
  return site ? window.__HS_KIND(site) : '';
});
ok(/Data center/.test(popup) && /Regulated facility/.test(popup)
   && popup.indexOf('Data center') < popup.indexOf('Regulated facility'),
  '8a: the popup states BOTH truths, Data center first', popup);
ok(!/pollut|contamin|hazard|danger|toxic|violation/i.test(popup),
  '8b: the EPA signal is a regulatory fact in the popup, never a claim of harm');
const plainPopup = await page.evaluate(() => {
  const site = (window.__HS_SITES || []).filter(s => /ANDURIL/.test(s.label || ''))[0];
  return site ? window.__HS_KIND(site) : '';
});
ok(/Facility/.test(plainPopup) && !/Data center/.test(plainPopup),
  '8c: an ordinary EPA facility popup is unchanged and claims no data centre', plainPopup);

// ── 9. Geography untouched ────────────────────────────────────────────────────────
const coords = await page.evaluate(() => (window.__HS_SITES || []).map(s => [s.label, s.lat, s.lng]));
ok(coords.some(c => /CORESITE/.test(c[0]) && c[1] === 38.94932 && c[2] === -77.36519),
  '9: the dual record renders at its own filed coordinate — nothing was moved to make two symbols fit');

ok(pageErrors.length === 0, '10: no fatal client error across the whole matrix', pageErrors.join(' | '));

console.log('='.repeat(78));
console.log('FAILS: ' + fails);
console.log('='.repeat(78));
await browser.close();
srv.close();
process.exit(fails ? 1 : 0);

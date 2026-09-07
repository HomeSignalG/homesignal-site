// MAP 1 — THE REGULATORY RECORDS ROW, DRIVEN THE WAY A RESIDENT DRIVES IT.
//
// ⚖️ FOUNDER RULING 2026-09-06. "Regulated facility" is not a Project Type and not a
// Status. It is regulatory CONTEXT that overlaps with both, so Map 1 grew a THIRD legend
// row with one on/off switch, and the marker language changed to match: a purple badge
// carrying a white capital R, overlaid on the LOWER-RIGHT corner of the project marker,
// never a replacement for the Type symbol.
//
// test/marker-regulatory-badge.test.mjs pins the MODEL. This suite pins what actually
// reaches the screen — the three rows in order, the switch's copy, and the founder's
// "must NOT change / gray out / strike through / hide / reset" list, measured against the
// rendered chips rather than against filter state (the styling is where a "does not
// change Stage or Type" promise gets broken without any state moving).
//
// The three fixture records are VERBATIM production `development_reports` site objects
// (ZIP 20171, pulled 2026-09-06) — the same rows the dual-identity suites use.
//
// Run: node test/map1-regulatory-toggle.browser.test.mjs
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
await new Promise(r => srv.listen(8817, '127.0.0.1', r));
const base = 'http://127.0.0.1:8817';

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
const ZIP_ROW = { '20171': [{ zip: '20171', home_lat: 38.9506, home_lng: -77.3645,
  counts: { facilities: 2, development: 1 }, sites: [DUAL, PLAIN_FAC, DC_PROJECT],
  refreshed_at: '2026-09-06T00:00:00Z', facilities_unavailable: false }] };
const COMMUNITIES = { '20171': [{ name: 'Herndon (20171)', level: 'zip', county: 'Fairfax', state: 'VA' }] };
// The ZIP-authoritative project set. It is NOT optional scaffolding: zipAuthMergeSites
// drops a point-scope report site that no authoritative project claims, so without this
// route the plain data-centre PROJECT never reaches the map and the suite would be
// measuring a two-record population while claiming three.
const ZIP_AUTH = { '20171': { zip: '20171', mode: 'development', status: 'boundary_complete',
  projects: [{ source_key: 'arcgis:fairfax:P-1', project_ref: 'arcgis:fairfax:P-1',
    name: 'Pennhurst Data Centers', type: 'Data Center', status: 'Approved',
    registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/x',
    submitted_at: '2026-01-04', date_kind: 'filed', impact_score: null, impact_dimensions: null }],
  markers: [{ project_ref: 'arcgis:fairfax:P-1', lat: 38.95065, lng: -77.36458,
    marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] } };

// ── ADDRESS-MODE FIXTURES ─────────────────────────────────────────────────────────
// The resident's journey in the bug report was ADDRESS mode, not ZIP mode, and the two
// differ in the 3D painter: address mode applies a radius cull that ZIP mode does not.
// Same three production records, re-placed inside the 1-mile default radius so the cull
// keeps them; e/n are what siteEN reads in address mode, and the lat/lng agree with them.
const ADDR_TEXT = '13313 Coomes Dr, Del Valle, TX';
const ADDR_HOME = { lat: 38.9506, lng: -77.3645 };
const ADDR_DUAL = Object.assign({}, DUAL, { e: 0.22, n: 0.18, lat: 38.95321, lng: -77.36040 });
const ADDR_FAC = Object.assign({}, PLAIN_FAC, { e: 0.30, n: 0.42, lat: 38.95669, lng: -77.35891 });
// The project reaches address mode only through the canonical N5 radius RPC — n5MergeSites
// drops the report engine's own development points on purpose, so mocking it into `sites`
// would prove nothing about the path production uses.
const N5_ROWS = [{ source_key: 'arcgis:fairfax:P-1', feature_id: 'f1', distance_mi: 0.39,
  marker_lat: 38.95495, marker_lng: -77.35984, provenance: 'source_point',
  geometry_type: 'Point', registry_id: 'fairfax-active-site-construction', has_more: false }];
const N5_PROJECTS = [{ source_key: 'arcgis:fairfax:P-1', name: 'Pennhurst Data Centers',
  type: 'Data Center', status: 'Approved', source_ref: 'https://plus.fairfaxcounty.gov/x',
  registry_id: 'fairfax-active-site-construction', submitted_at: '2026-01-04',
  date_kind: 'filed', impact_score: null, impact_dimensions: null }];

const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.HS_CHROME) launchOpts.executablePath = process.env.HS_CHROME;
const browser = await chromium.launch(launchOpts);
const page = await (await browser.newContext()).newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
const zipOf = (url) => (url.match(/(?:zip=eq\.|%7B)(\d{5})/) || [])[1] || null;

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('/functions/v1/geocode-address'))
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ match: { lat: ADDR_HOME.lat, lng: ADDR_HOME.lng, matchedAddress: ADDR_TEXT } }) });
  if (url.includes('/functions/v1/get-address-report'))
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ address: ADDR_TEXT, counts: { facilities: 2 },
        sites: [ADDR_DUAL, ADDR_FAC], refreshed_at: '2026-09-06T00:00:00Z', facilities_unavailable: false }) });
  if (url.includes('/rpc/n5_projects_within_radius'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(N5_ROWS) });
  if (url.includes('/rest/v1/app_projects'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(N5_PROJECTS) });
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

await page.goto(base + '/homesignalmap.html?zip=20171', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
await page.waitForTimeout(600);

// The regulatory control is a CHECKBOX CHIP now, so its state is the checkbox's, not an
// aria-checked attribute on a switch. Reported as the same 'true'/'false' strings so every
// assertion below reads unchanged.
const regState = () => page.evaluate(() => {
  const b = document.getElementById('regToggleBox');
  return b ? String(b.checked) : null;
});
const clickReg = async () => { await page.click('#regToggle'); await page.waitForTimeout(200); };
// Every rendered marker, described by what a resident can see.
const markers = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)')).map((el) => {
    const html = (el.querySelector('svg') || {}).outerHTML || '';
    const rect = html.match(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)"/);
    return {
      polygons: (html.match(/<polygon/g) || []).length,
      purple: /#7d148c/i.test(html),
      rBadge: />R<\/text>/.test(html) && /#7d148c/i.test(html),
      badgeX: rect ? Number(rect[1]) : null,
      badgeY: rect ? Number(rect[2]) : null,
      badgeW: rect ? Number(rect[3]) : null
    };
  }));
// The Stage and Type rows as a resident SEES them: pressed state AND the styling that
// would gray out or strike through a chip. This is the founder's "must NOT" list.
const rowsLook = () => page.evaluate(() => {
  const read = (sel) => Array.from(document.querySelectorAll(sel)).map((r) => {
    const cs = getComputedStyle(r);
    const t = r.querySelector('.t');
    return [
      (r.getAttribute('data-cat') || (r.textContent || '').trim().slice(0, 14)),
      String(!!(r.querySelector('input') || {}).checked),
      cs.opacity,
      cs.display === 'none' ? 'hidden' : 'shown',
      t ? getComputedStyle(t).textDecorationLine : 'none'
    ].join('|');
  });
  return { stage: read('#mapkey .stagechip'), type: read('#mapkeyShapes .typechip') };
});

// ── 1. THREE ROWS, IN ORDER, AND THE THIRD IS NOT A TYPE ──────────────────────────
const headings = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.maplegend-wrap .mapkey-hd')).map(h => h.textContent.trim().replace(/\s+/g, ' ')));
// ⚖️ THE HEADINGS WERE RENAMED BY THE FILTER-PANEL HIERARCHY UNIT: "Stage — pin color"
// and "Type — pin shape" folded the map's ENCODING into the section NAME, which is why the
// same encoding then had to be repeated in a paragraph below. The encoding now lives once,
// in the map key; the headings name the dimension a customer is filtering on. Read from
// `textContent`, so the third is still the registry's own `HS.REGULATORY_LEGEND.heading` —
// the uppercase treatment is CSS (asserted separately below), never a retyped data value.
ok(headings[0] === 'STATUS', '1: section 1 is STATUS', headings[0]);
ok(headings[1] === 'PROJECT TYPE', '1b: section 2 is PROJECT TYPE', headings[1]);
ok(headings[2] === 'Regulatory records', '1c: section 3 is the registry heading', headings[2]);
// The rendered label is what a customer scans, and it must read as the third of three
// peers — same treatment, same case — not as a differently-styled outlier.
const hdStyle = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.maplegend-wrap .mapkey-hd')).map((h) => {
    const cs = getComputedStyle(h);
    return { tt: cs.textTransform, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) };
  }));
ok(hdStyle.length === 3 && hdStyle.every(h => h.tt === 'uppercase'),
  '1c2: all three headings render uppercase — REGULATORY RECORDS included',
  JSON.stringify(hdStyle));
// THE HIERARCHY ITSELF, MEASURED. A heading that does not outrank the chip labels beneath
// it is not a heading, and this is the one property a copy change can silently undo.
const chipStyle = await page.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('#mapkeyShapes .typechip .t'));
  const nt = getComputedStyle(document.getElementById('mapkeyNote'));
  return { chip: parseFloat(cs.fontSize), chipW: Number(cs.fontWeight),
           key: parseFloat(nt.fontSize), keyW: Number(nt.fontWeight) };
});
ok(hdStyle.every(h => h.size > chipStyle.chip && h.weight > chipStyle.chipW),
  '1c3: every section heading outranks the filter labels below it',
  JSON.stringify({ hd: hdStyle[0], ...chipStyle }));
ok(hdStyle.every(h => h.size > chipStyle.key),
  '1c4: ...and the map key is subordinate to all three', JSON.stringify(chipStyle));
const typeLabels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#mapkeyShapes .typechip .t')).map(t => t.textContent.trim()));
ok(typeLabels.length === 7 && !typeLabels.some(l => /regulated facility/i.test(l)),
  '1d: the Type row is the seven project types and offers no "Regulated facility"', typeLabels.join(' / '));
// Reads `.stagechip .t` because the Stage chip is a <label> wrapping a real checkbox, not a
// <span> toggle — the row became a multi-select checkbox group (test/map1-stage-filter-chips
// .browser.test.mjs). The CLAIM below is unchanged; only the element it hangs on moved.
const stageLabels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#mapkey .stagechip .t')).map(t => t.textContent.trim()));
ok(stageLabels.length === 4 && !stageLabels.some(l => /regulated facility/i.test(l)),
  '1e: the Stage row is the four stages and offers no "Regulated facility"', stageLabels.join(' / '));

// ── 2. THE CONTROL AND ITS COPY ───────────────────────────────────────────────────
// ⚖️ THE SWITCH IS GONE. It is a checked filter chip, the same control the Stage and Type
// rows use, so that one rule — "checked categories are shown on the map" — covers all
// three rows. These two assertions changed with it; §2c-§6c below are untouched.
const regCtl = await page.evaluate(() => {
  const chip = document.getElementById('regToggle');
  const box = document.getElementById('regToggleBox');
  return { tag: chip && chip.tagName, box: box && box.tagName + ':' + box.type,
           inside: !!(chip && box && chip.contains(box)),
           role: chip && chip.getAttribute('role'),
           sw: !!document.querySelector('.regtog, #regToggle .sw'),
           name: box && box.getAttribute('aria-label') };
});
ok(regCtl.tag === 'LABEL' && regCtl.box === 'INPUT:checkbox' && regCtl.inside,
  '2: the control is a checkbox chip — a real <input type=checkbox> inside its label', JSON.stringify(regCtl));
ok(!regCtl.sw && regCtl.role !== 'switch',
  '2a: NO on/off switch remains — not hidden beside it, gone', JSON.stringify(regCtl));
ok((await page.textContent('#regToggle')).includes('Regulatory facilities'),
  '2b: the chip is labelled "Regulatory facilities" — the checkmark carries the "Show"',
  (await page.textContent('#regToggle')).trim());
ok(regCtl.name === 'Regulatory facilities, shown on map',
  '2b2: ...and its accessible name states the map effect in words', regCtl.name);
// ⚖️ THE SECOND PURPLE-R EXPLANATION IS GONE (founder ruling, filter-panel hierarchy unit).
// `HS.REGULATORY_LEGEND.helper` opened with "Purple R = environmental regulatory record",
// which the map key at the foot of the panel already says — one explanation written twice,
// which is exactly what that unit removed. The STRING is untouched in lib/map.js and still
// carries its verbatim + anti-editorialising pins in test/marker-regulatory-badge.test.mjs;
// what is asserted here is that the PANEL renders the explanation once and only once.
const regHelp = await page.evaluate(() => ({
  el: !!document.getElementById('mapkeyRegHelp'),
  cls: document.querySelectorAll('.mapkey-reghelp').length,
  purpleR: (document.querySelector('.maplegend-wrap').innerText.match(/Purple R =/g) || []).length,
  epa: /Includes EPA and linked state/.test(document.querySelector('.maplegend-wrap').innerText) }));
ok(!regHelp.el && regHelp.cls === 0 && !regHelp.epa,
  '2c: the duplicated regulatory helper line is gone from the panel', JSON.stringify(regHelp));
ok(regHelp.purpleR === 1,
  '2c2: ...so "Purple R =" is explained exactly once, in the map key', regHelp.purpleR);
ok(await page.evaluate(() => !!document.querySelector('#regToggle svg text')),
  '2d: the chip shows the same purple R the map draws');
ok(await regState() === 'true', '2e: it starts CHECKED — a record is never hidden by default');

// THE PURPLE R SURVIVES THE UNCHECKED STATE. It explains what the RECORD is, so it is not
// a state signal and must never be dimmed or dropped when the overlay is hidden.
await clickReg();
const rWhenOff = await page.evaluate(() => {
  const ic = document.querySelector('#regToggle .ic');
  return { svg: !!(ic && ic.querySelector('svg text')), opacity: ic ? getComputedStyle(ic).opacity : null };
});
ok(rWhenOff.svg && Number(rWhenOff.opacity) === 1,
  '2f: the purple R is still there, full strength, while UNCHECKED', JSON.stringify(rWhenOff));
await clickReg();
ok(await regState() === 'true', '2g: ...and restored for the rest of the suite');

// ── 3. THE BADGE IS AN OVERLAY IN THE LOWER-RIGHT CORNER ──────────────────────────
const on = await markers();
ok(on.length === 3, '3: the three production records render', on.length);
const dual = on.filter(m => m.polygons === 1 && m.rBadge);
ok(dual.length === 1, '3b: the regulated data centre keeps its octagon AND gains the R badge', dual.length);
ok(dual[0].badgeX > 7 && dual[0].badgeY > 7,
  '3c: the badge sits in the LOWER-RIGHT corner of a 14px pin',
  dual[0].badgeX + ',' + dual[0].badgeY);
ok(dual[0].badgeW < 14 * 0.8, '3d: …and is visually secondary to the project marker',
  dual[0].badgeW + ' < ' + (14 * 0.8));
ok(on.filter(m => m.purple && m.polygons === 0 && !m.rBadge).length === 1,
  '3e: a regulatory-only location draws a standalone purple square');
ok(on.filter(m => m.polygons === 1 && !m.purple).length === 1,
  '3f: a project with no regulatory record gets no purple at all — nothing is invented');

// ── 4. THE SWITCH OWNS THE BADGE AND THE REGULATORY-ONLY LOCATIONS, AND NOTHING ELSE ─
const lookBefore = await rowsLook();
await clickReg();
ok(await regState() === 'false', '4: clicking the switch turns it off');
const off = await markers();
ok(off.length === 2, '4b: OFF -> the regulatory-only location is hidden', off.length);
ok(off.filter(m => m.rBadge).length === 0, '4c: OFF -> no R badge is painted anywhere');
ok(off.filter(m => m.polygons === 1).length === 2,
  '4d: OFF -> BOTH data centres are still drawn — the project is never hidden by this switch', off.length);
// The founder's list, measured against the rendered rows: nothing about Stage or Type may
// change, gray out, strike through, hide or reset.
const lookAfter = await rowsLook();
ok(JSON.stringify(lookAfter.stage) === JSON.stringify(lookBefore.stage),
  '4e: the Stage row is pixel-for-pixel unchanged — same state, opacity, decoration, visibility');
ok(JSON.stringify(lookAfter.type) === JSON.stringify(lookBefore.type),
  '4f: the Type row is pixel-for-pixel unchanged too', lookAfter.type.join(' ; '));
ok(lookAfter.type.every(r => r.split('|')[1] === 'true' && r.split('|')[4] === 'none'),
  '4g: …every Type chip is still pressed, and none is struck through');

// ── 5. IT IS REVERSIBLE, AND THE BADGE COMES BACK ON THE ALREADY-DRAWN PIN ────────
await clickReg();
ok(await regState() === 'true', '5: clicking again turns it back on');
const back = await markers();
ok(back.length === 3 && back.filter(m => m.rBadge).length === 1,
  '5b: the badge is repainted on the pin that is already on the map', back.filter(m => m.rBadge).length);
ok(JSON.stringify(await rowsLook()) === JSON.stringify(lookBefore),
  '5c: …and the other two rows are still untouched');

// ── 5d. 3D AERIAL PAINTS THE SAME COLOURS THE 2D PINS DO ──────────────────────────
// Production 3D aerial used to colour every building from the lifecycle bucket, so
// an EPA-only location became a green "Operating now" block while the legend still
// said "Purple R = regulatory record". Colour now comes from site3DPaint → mk.color.
// The jsdelivr mock in this file does not serve three.js, so this path is the
// Canvas-2D aerial fallback — the same paint function the WebGL path uses.
await page.click('#viewSeg button[data-v="3d"]');
await page.waitForFunction(
  () => Array.isArray(window.__HS_AERIAL_PAINT) && window.__HS_AERIAL_PAINT.length >= 3,
  null, { timeout: 25000 });
const aerialInfo = await page.evaluate(() => {
  const paints = window.__HS_AERIAL_PAINT || [];
  const find = (re) => paints.find((r) => re.test(r.label || '')) || null;
  return {
    n: paints.length,
    facility: (window.HS && HS.REGULATORY_LEGEND && HS.REGULATORY_LEGEND.color) || null,
    approved: (window.HS && HS.LIFECYCLE_HEX && HS.LIFECYCLE_HEX.approved) || null,
    operating: (window.HS && HS.LIFECYCLE_HEX && HS.LIFECYCLE_HEX.operating) || null,
    anduril: find(/ANDURIL/),
    coresite: find(/CORESITE/),
    penn: find(/Pennhurst/)
  };
});
ok(aerialInfo.n >= 3, '5d: 3D aerial painted the three fixture records', aerialInfo.n);
ok(aerialInfo.anduril && String(aerialInfo.anduril.color).toLowerCase() === String(aerialInfo.facility).toLowerCase()
    && aerialInfo.anduril.signal === false,
  '5e: an EPA-only location is purple on 3D aerial, not operating-green — and has no R (the R is dual-identity)',
  JSON.stringify(aerialInfo.anduril) + ' facility=' + aerialInfo.facility);
ok(aerialInfo.penn && String(aerialInfo.penn.color).toLowerCase() === String(aerialInfo.approved).toLowerCase()
    && aerialInfo.penn.signal === false,
  '5f: a project with no regulatory record keeps its status colour',
  JSON.stringify(aerialInfo.penn));
ok(aerialInfo.coresite && aerialInfo.coresite.signal === true
    && String(aerialInfo.coresite.color).toLowerCase() === String(aerialInfo.operating).toLowerCase(),
  '5g: a dual-identity data centre keeps its status colour and carries the purple R',
  JSON.stringify(aerialInfo.coresite));
// ── 5h. THE SWITCH OWNS THE 3D BLOCKS TOO ────────────────────────────────────────
// §4b-§4g proved this for the 2D pins. The 3D aerial is a SECOND renderer of the same
// filter, so proving the colour there without proving the toggle there would leave the
// half a resident actually complained about unasserted: OFF must remove the EPA-only
// BLOCK, keep the project block, drop the R — and still touch neither chip row.
const look3DBefore = await rowsLook();
await clickReg();
await page.waitForFunction(
  () => Array.isArray(window.__HS_AERIAL_PAINT) && window.__HS_AERIAL_PAINT.length === 2,
  null, { timeout: 25000 });
const aerialOff = await page.evaluate(() => (window.__HS_AERIAL_PAINT || []).map(
  (r) => ({ label: r.label, color: r.color, signal: r.signal })));
ok(aerialOff.length === 2 && !aerialOff.some((r) => /ANDURIL/.test(r.label || '')),
  '5h: OFF -> the regulatory-only BLOCK is gone from 3D aerial, not merely uncoloured',
  JSON.stringify(aerialOff.map((r) => r.label)));
ok(aerialOff.filter((r) => r.signal).length === 0,
  '5i: OFF -> no purple R rides on any 3D block');
ok(aerialOff.filter((r) => /CORESITE|Pennhurst/.test(r.label || '')).length === 2
   && aerialOff.every((r) => String(r.color).toLowerCase() !== String(aerialInfo.facility).toLowerCase()),
  '5j: OFF -> both project blocks are still drawn, in their status colours — a project is never hidden by this switch',
  JSON.stringify(aerialOff));
ok(JSON.stringify(await rowsLook()) === JSON.stringify(look3DBefore),
  '5k: …and turning it off from the 3D view still moves neither the Stage nor the Type row');
await clickReg();
await page.waitForFunction(
  () => Array.isArray(window.__HS_AERIAL_PAINT) && window.__HS_AERIAL_PAINT.length === 3,
  null, { timeout: 25000 });
ok((await page.evaluate(() => (window.__HS_AERIAL_PAINT || []).filter((r) => r.signal).length)) === 1,
  '5l: ON again -> the R comes back on the dual-identity block, and the purple block returns');

const shotDir = process.env.HS_SCREENSHOT_DIR;
if (shotDir) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shotDir, 'map1_3d_aerial_regulatory_purple.png'), fullPage: false });
}
await page.click('#viewSeg button[data-v="2d"]');
await page.waitForTimeout(300);
if (shotDir) {
  await page.screenshot({ path: join(shotDir, 'map1_2d_regulatory_purple.png'), fullPage: false });
}

// ── 6. THE OTHER DIRECTION — Stage and Type never move the regulatory switch ──────
await page.click('#mapkey span:has-text("Approved")');
await page.waitForTimeout(150);
ok(await regState() === 'true', '6: clicking a Stage chip does not touch the regulatory switch');
await page.click('#mapkeyShapes .typechip[data-cat="datacenter"]');
await page.waitForTimeout(150);
ok(await regState() === 'true', '6b: clicking a Type chip does not touch it either');
// …and Stage still composes with the badge: hiding a stage hides the pin, badge and all.
ok((await markers()).every(m => !m.rBadge || m.polygons === 1),
  '6c: a badge only ever exists on a pin that is itself visible');

// ── 6d. ADDRESS MODE — THE JOURNEY IN THE BUG REPORT ─────────────────────────────
// The screenshot that opened this was ZIP 78617 -> search an address -> 3D aerial, which
// is ADDRESS mode. It is a different geographic path (radius cull, N5 development, no ZIP
// frame), so proving the paint in ZIP mode alone would leave the reported view unproven.
// §6 and §6b left a Stage chip and a Type chip switched OFF. Restore them, or this
// section would measure a filtered population and read as a paint failure.
await page.click('#mapkey span:has-text("Approved")');
await page.click('#mapkeyShapes .typechip[data-cat="datacenter"]');
await page.waitForTimeout(150);
await page.click('#viewSeg button[data-v="2d"]');
await page.fill('#addr', ADDR_TEXT);
await page.click('#go');
await page.waitForFunction((label) => {
  const s = window.__HS_SITES || [];
  return !window.__HS_ZIP_MODE_ONLY && s.length >= 3 && s.some((r) => /Pennhurst/.test(String(r.label || '')));
}, ADDR_TEXT, { timeout: 30000 });
await page.click('#viewSeg button[data-v="3d"]');
await page.waitForFunction(
  () => Array.isArray(window.__HS_AERIAL_PAINT) && window.__HS_AERIAL_PAINT.length >= 3,
  null, { timeout: 25000 });
const addrPaint = await page.evaluate(() => (window.__HS_AERIAL_PAINT || []).map(
  (r) => ({ label: r.label, color: String(r.color).toLowerCase(), signal: r.signal })));
const facHex = String(aerialInfo.facility).toLowerCase();
const find2 = (re) => addrPaint.find((r) => re.test(r.label || '')) || null;
ok(addrPaint.length >= 3, '6d: address mode 3D aerial painted the three records', addrPaint.length);
ok(find2(/ANDURIL/) && find2(/ANDURIL/).color === facHex && find2(/ANDURIL/).signal === false,
  '6e: address mode — the EPA-only building is purple, the same as 2D, and carries no R',
  JSON.stringify(find2(/ANDURIL/)));
ok(find2(/Pennhurst/) && find2(/Pennhurst/).color === String(aerialInfo.approved).toLowerCase(),
  '6f: address mode — a nearby project keeps its status colour', JSON.stringify(find2(/Pennhurst/)));
ok(find2(/CORESITE/) && find2(/CORESITE/).signal === true
   && find2(/CORESITE/).color === String(aerialInfo.operating).toLowerCase(),
  '6g: address mode — the dual-identity data centre keeps status colour plus the purple R',
  JSON.stringify(find2(/CORESITE/)));
await clickReg();
await page.waitForFunction(
  () => Array.isArray(window.__HS_AERIAL_PAINT) && window.__HS_AERIAL_PAINT.length === 2,
  null, { timeout: 25000 });
const addrOff = await page.evaluate(() => (window.__HS_AERIAL_PAINT || []).map(
  (r) => ({ label: r.label, color: String(r.color).toLowerCase(), signal: r.signal })));
ok(!addrOff.some((r) => /ANDURIL/.test(r.label || '')) && addrOff.length === 2
   && addrOff.filter((r) => r.signal).length === 0,
  '6h: address mode — regulatory OFF removes the purple building and every R, and keeps both projects',
  JSON.stringify(addrOff));
await clickReg();

ok(pageErrors.length === 0, '7: no uncaught page errors', pageErrors.join(' | '));

await browser.close();
srv.close();
console.log('\n' + (fails ? fails + ' FAILED' : 'map1-regulatory-toggle: all checks passed'));
process.exit(fails ? 1 : 0);

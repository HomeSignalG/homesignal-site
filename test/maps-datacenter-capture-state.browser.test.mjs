// MAPS · DATA CENTER THEME — THE CAPTURE STATE, MEASURED IN A REAL BROWSER.
//
// scripts/maps-social-image.mjs opens Map 1 in the shipped embed mode, puts the PROJECT TYPE
// row into a Data-center-only state THROUGH THE REAL CONTROLS, and clips the shutter to the
// Map 1 product card at 1200x630. Every one of those is a GEOMETRY and BEHAVIOUR claim that a
// structural grep cannot settle — the CSS and the control wiring are each correct in
// isolation and can still be wrong together (exactly the shape of the 2026-09-15 embed
// overflow defect). So this suite drives the real page and measures what a capture would get.
//
// It needs no network: the repo is served locally, Leaflet comes from node_modules, and every
// Supabase read is fulfilled from fixtures. Nothing here fabricates a social image — it
// measures the page the capture photographs.
//
// Run: node test/maps-datacenter-capture-state.browser.test.mjs
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
await new Promise((r) => srv.listen(8837, '127.0.0.1', r));
const base = 'http://127.0.0.1:8837';

// THE TARGET, shaped exactly as production shapes it. `type` is the PROJECT type
// ('Development' — a broad bucket) and the data centre is stated only in the NAME, which is
// the real Kansas City candidate's shape and the commonest one in the corpus.
const DC = {
  source_key: 'arcgis:kcmo-development-cases:CD-CPC-2026-00142',
  project_ref: 'arcgis:kcmo-development-cases:CD-CPC-2026-00142',
  name: 'RBC Data Center Campus Major Amendment', type: 'Development', status: 'Proposed',
  registry_id: 'kcmo-development-cases', source_ref: 'https://data.kcmo.org/',
  submitted_at: '2026-09-09', date_kind: 'filed', impact_score: null, impact_dimensions: null,
};
// THE CONTROL. A Residential project that must DISAPPEAR when Data center is isolated — a
// filter that removes nothing proves nothing about the filter.
const RES = {
  source_key: 'arcgis:kcmo-development-cases:R-1', project_ref: 'arcgis:kcmo-development-cases:R-1',
  name: 'Elm Street Subdivision Phase 2', type: 'Residential', status: 'Approved',
  registry_id: 'kcmo-development-cases', source_ref: 'https://data.kcmo.org/r1',
  submitted_at: '2026-09-01', date_kind: 'filed', impact_score: null, impact_dimensions: null,
};
const ZIP = '64155';
const ZIP_AUTH = { [ZIP]: { zip: ZIP, mode: 'development', status: 'boundary_complete',
  projects: [DC, RES],
  markers: [
    { project_ref: DC.project_ref, lat: 39.3201689806401, lng: -94.5762390223065, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 },
    { project_ref: RES.project_ref, lat: 39.3221689806401, lng: -94.5792390223065, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 },
  ] } };
// A real regulated facility, so the REGULATORY RECORDS row has something to be about.
const FACILITY = { e: 0.3, n: 0.4, lat: 39.3180, lng: -94.5740, type: 'built', scope: 'point',
  layer: 'industrial', label: 'NORTHLAND WASTE OIL SERVICE', registry_id: '110005079495',
  src: 'EPA FRS · registry 110005079495',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110005079495' };
const ZIP_ROW = { [ZIP]: [{ zip: ZIP, home_lat: 39.3201, home_lng: -94.5762,
  counts: { facilities: 1, development: 2 }, sites: [FACILITY],
  refreshed_at: '2026-09-14T00:00:00Z', facilities_unavailable: false }] };
const COMMUNITIES = { [ZIP]: [{ name: 'Kansas City (64155)', level: 'zip', county: 'Clay', state: 'MO' }] };

const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.HS_CHROME) launchOpts.executablePath = process.env.HS_CHROME;
const browser = await chromium.launch(launchOpts);

async function open(width, height, embed) {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  const zipOf = (u) => (u.match(/(?:zip=eq\.|%7B)(\d{5})/) || [])[1] || null;
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('leaflet@1.9.4/dist/leaflet.js') || url.includes('leaflet@1.9.4/dist/leaflet.css')) {
      const css = url.endsWith('.css');
      let local = null;
      try { local = require.resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch (e) { local = null; }
      if (!local) return route.continue();
      return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript',
        body: await readFile(local, 'utf8') });
    }
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
    if (url.includes('/rest/v1/') || url.includes('/rpc/') || url.includes('/functions/v1/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
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
  await page.goto(base + '/homesignalmap.html?' + (embed ? 'embed=1&' : '') + 'zip=' + ZIP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForFunction((k) => (window.siteMarkers || []).some((x) => x && x.s
    && (x.s.zip_project_ref || x.s.source_id) === k), DC.project_ref, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  return page;
}

// ═══ 1. MAP 1 ITSELF CALLS THIS PROJECT A DATA CENTER ════════════════════════════════
// The dashboard filter and the page must agree, and their resolver INPUTS differ in shape:
// the dashboard passes {type, type_raw, name} from the candidate's evidence, while a ZIP-mode
// site carries the LIFECYCLE in `type`, the project type in `use_type` and the name in
// `label`. Same verdict from both, or the theme and the map are describing different sets.
const page = await open(1200, 630, true);
const pageVerdict = await page.evaluate((k) => {
  const hit = (window.siteMarkers || []).find((x) => x && x.s && (x.s.zip_project_ref || x.s.source_id) === k);
  if (!hit) return { found: false };
  const m = window.HS.resolveMarker(hit.s);
  return { found: true, typeKey: m.typeKey, categories: m.categories, shape: m.shape,
           shapeRule: m.shapeRule, legend: m.legendLabel };
}, DC.project_ref);
ok(pageVerdict.found, '1: the target project is drawn on the ZIP page');
ok(pageVerdict.typeKey === 'datacenter',
  '1: Map 1 classifies it as Data center on the page', pageVerdict.typeKey);
ok(Array.isArray(pageVerdict.categories) && pageVerdict.categories.indexOf('datacenter') > -1,
  '1: its FILTER MEMBERSHIP includes datacenter, so the Data center chip shows it');
ok(pageVerdict.legend === 'Data center', '1: it carries the Data center legend label', pageVerdict.legend);

// ═══ 2. THE FILTER, THROUGH THE REAL CONTROLS ════════════════════════════════════════
// This is byte-for-byte the manoeuvre scripts/maps-social-image.mjs performs.
const filterState = await page.evaluate((wantKey) => {
  const chips = Array.from(document.querySelectorAll('#mapkeyShapes .typechip'));
  const read = () => { const o = {}; for (const c of chips) { const b = c.querySelector('.chipbox');
    o[c.getAttribute('data-cat')] = !!(b && b.checked); } return o; };
  const before = read();
  for (const c of chips) {
    const key = c.getAttribute('data-cat'); const box = c.querySelector('.chipbox');
    if (!box) continue;
    const want = key === wantKey;
    if (box.checked !== want) { box.checked = want; box.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  return { before, after: read(), chipCount: chips.length };
}, 'datacenter');
await page.waitForTimeout(500);

ok(filterState.chipCount >= 6, '2: Map 1 rendered its PROJECT TYPE controls', filterState.chipCount);
ok(filterState.after.datacenter === true, '2: the Data center control ends up SELECTED');
const othersOn = Object.keys(filterState.after).filter((k) => k !== 'datacenter' && filterState.after[k]);
ok(othersOn.length === 0, '2: every other PROJECT TYPE is deselected', othersOn.join(',') || 'none');

// ⚠️ `window.siteMarkers` IS NOT THE VISIBLE SET, and assuming it was is the defect this
// check found. Map 1's applyFilter() keeps every marker in that array and only adds it to or
// removes it from the Leaflet layer group — so membership of `siteMarkers` is identical
// before and after filtering. ON THE MAP is `m._map`, which Leaflet nulls on removeLayer.
const vis = await page.evaluate(() => (window.siteMarkers || []).map((x) => ({
  ref: x && x.s && (x.s.zip_project_ref || x.s.source_id),
  inArray: true,
  onMap: !!(x && x.m && x.m._map),
})).filter((r) => r.ref));
const byRef = Object.fromEntries(vis.map((r) => [r.ref, r]));
ok(byRef[DC.project_ref] && byRef[DC.project_ref].onMap === true,
  '2: the DATA CENTER project is still ON THE MAP after filtering');
ok(byRef[RES.project_ref] && byRef[RES.project_ref].onMap === false,
  '2: CONTROL — the Residential project is OFF the map, so the filter really filtered');
ok(byRef[RES.project_ref] && byRef[RES.project_ref].inArray === true,
  '2: …and it is STILL IN window.siteMarkers — array membership is not visibility');

// ═══ 3. THE CARD FITS 1200x630, WITH ITS CONTROLS IN FRAME ══════════════════════════
const geo = await page.evaluate(() => {
  const se = document.scrollingElement;
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height),
             w: Math.round(b.width), display: cs.display }; };
  const inFrame = (x) => !!x && x.h > 0 && x.top >= 0 && x.bottom <= window.innerHeight + 1;
  const hd = (txt) => { const e = Array.from(document.querySelectorAll('.mapkey-hd'))
    .find((n) => (n.textContent || '').trim().toUpperCase() === txt); return e ? r('#' + e.id) : null; };
  return {
    docOverflow: se.scrollHeight - se.clientHeight,
    card: r('.card.mapcard'),
    cap: r('.card.mapcard .map-cap'),
    capText: (document.querySelector('.card.mapcard .map-cap') || {}).textContent || '',
    statusIn: inFrame(hd('STATUS')), typeIn: inFrame(hd('PROJECT TYPE')), regIn: inFrame(hd('REGULATORY RECORDS')),
    keyIn: inFrame(r('#mapkeyNote')), mapIn: inFrame(r('.card.mapcard .map-frame')),
    mapH: (r('.card.mapcard .map-frame') || {}).h,
    sidebar: r('#hs-side'), head: r('.wrap>.head'),
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
});
ok(geo.docOverflow <= 0, '3: the embed document does NOT overflow its frame', geo.docOverflow);
ok(geo.card && geo.card.w === 1200 && geo.card.h === 630,
  '3: the Map 1 product card is exactly the 1200x630 image frame',
  geo.card ? geo.card.w + 'x' + geo.card.h : 'absent');
ok(geo.statusIn, '3: STATUS is inside the capture frame');
ok(geo.typeIn, '3: PROJECT TYPE is inside the capture frame');
ok(geo.regIn, '3: REGULATORY RECORDS is inside the capture frame');
ok(geo.keyIn, '3: the "how to read the map" key is inside the capture frame');
ok(geo.mapIn && geo.mapH >= 200, '3: a usable amount of the MAP is inside the frame', geo.mapH);
// The card header names the PLACE and its ZIP ("Development across Kansas City (64155) …").
// The assertion is on the ZIP digits, not on a literal "ZIP " prefix — an earlier version
// required the prefix and failed against the better, place-naming header the page ships.
ok(geo.capText.includes(ZIP) && /development/i.test(geo.capText),
  '3: the card names the place and ZIP it is showing', geo.capText.trim());

// ── chrome a social capture must not contain ───────────────────────────────────────────
ok(!geo.sidebar || geo.sidebar.display === 'none', '3: the global sidebar is not in the capture');
ok(!geo.head || geo.head.display === 'none', '3: the address search form is not in the capture');

// ═══ 4. THE POPUP AND THE TARGET ════════════════════════════════════════════════════
const popup = await page.evaluate((k) => {
  const hit = (window.siteMarkers || []).find((x) => x && x.s && (x.s.zip_project_ref || x.s.source_id) === k);
  if (!hit) return { ok: false };
  hit.m.openPopup();
  const el = document.querySelector('.leaflet-popup-content');
  return { ok: !!el, text: (el ? el.innerText : '').trim().slice(0, 160) };
}, DC.project_ref);
ok(popup.ok, '4: the EXACT project\'s own Map 1 popup opens');
ok(/RBC Data Center Campus/i.test(popup.text),
  '4: the popup names the exact project, so a reader can identify the target', popup.text.split('\n')[0]);

// ═══ 5. COUNTERFACTUAL — full-page Map 1 is UNCHANGED ═══════════════════════════════
// Fitting the frame is an EMBED rule. If this suite could pass while Map 1's own page shrank,
// it would be licensing a regression instead of pinning a capture.
const full = await open(1280, 900, false);
const fullGeo = await full.evaluate(() => {
  const e = document.querySelector('.map-frame');
  return e ? Math.round(e.getBoundingClientRect().height) : null;
});
ok(fullGeo === 600, '5: full-page Map 1 still has its 600px map frame', fullGeo);

await browser.close();
srv.close();
console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);

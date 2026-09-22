// THE PLACE CONTEXT MAP FITS ITS FRAME — the filter panel cannot be scrolled out of it.
//
// MEASURED DEFECT (reported 2026-09-15 from a live ZIP page, ?zip=78617): a resident
// clicked the map's zoom control and the STATUS / PROJECT TYPE / REGULATORY panel
// vanished. Nothing hid it and no filter state changed — the embed DOCUMENT scrolled.
//
// `.map-frame` is a hard 600px and the panel is 288px tall at desktop widths (412px at
// 390px wide), so the embed document stood 957px tall inside its 520px iframe: 437px of
// overflow on every embed. The panel sits ABOVE the map, so the panel was the half that
// left. Leaflet focuses its own container on any interaction, the browser scrolls that
// 600px container into view, and scrollTop went 0 -> 343 — exactly `.map-frame`'s offset.
// Zoom-OUT did not bring it back, and the next click re-hid it.
//
// So this suite measures the GEOMETRY a resident is subject to, not the CSS text: it
// drives the two things they actually did (a zoom click, a marker click) and asserts the
// panel is still on screen afterwards. A structural grep would have passed against the
// defect, because every rule it would have read was already correct — the 600px map and
// the 520px frame are each fine alone and wrong together.
//
// §5 is the counterfactual that keeps this honest: the FULL page must still carry its
// 600px map. Fitting the frame is an embed rule, not a shrink of Map 1.
//
// Fixture records are the same shape the sibling map1-* suites use.
// Run: node test/place-context-map-fits-frame.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { readFileSync } from 'node:fs';
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
await new Promise(r => srv.listen(8831, '127.0.0.1', r));
const base = 'http://127.0.0.1:8831';

const PROJECT = { e: 0.1, n: 0.1, lat: 30.1745, lng: -97.6134, type: 'approved', scope: 'point',
  layer: 'development', relevance: 'development', geo_precision: 'point', label: 'Pearce Lane',
  use_type: 'Commercial', type_raw: 'Site Plan', source_id: 'arcgis:travis:P-1',
  record_url: 'https://example.gov/x' };
const FACILITY = { e: 0.3, n: 0.4, lat: 30.1805, lng: -97.6202, type: 'built', scope: 'point',
  layer: 'industrial', label: 'FRANKS WASTE OIL SERVICE', registry_id: '110005079495',
  src: 'EPA FRS · registry 110005079495',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110005079495' };
const ZIP_ROW = { '78617': [{ zip: '78617', home_lat: 30.1745, home_lng: -97.6134,
  counts: { facilities: 1, development: 1 }, sites: [PROJECT, FACILITY],
  refreshed_at: '2026-09-12T00:00:00Z', facilities_unavailable: false }] };
const COMMUNITIES = { '78617': [{ name: 'Del Valle (78617)', level: 'zip', county: 'Travis', state: 'TX' }] };
const ZIP_AUTH = { '78617': { zip: '78617', mode: 'development', status: 'boundary_complete',
  projects: [{ source_key: 'arcgis:travis:P-1', project_ref: 'arcgis:travis:P-1', name: 'Pearce Lane',
    type: 'Commercial', status: 'Approved', registry_id: 'austin-site-plan-cases',
    source_ref: 'https://example.gov/x', submitted_at: '2026-05-01', date_kind: 'filed',
    impact_score: null, impact_dimensions: null }],
  markers: [{ project_ref: 'arcgis:travis:P-1', lat: 30.1745, lng: -97.6134,
    marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] } };

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
    if (url.includes('/rpc/zip_mode_report_sites')) return fulfillZipModeReport(route, (z) => ZIP_ROW[z] || []);
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
  await page.goto(base + '/homesignalmap.html?' + (embed ? 'embed=1&' : '') + 'zip=78617', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(700);
  return page;
}

// What a resident can see, and what the document can do.
const geometry = (page) => page.evaluate(() => {
  const se = document.scrollingElement;
  const seen = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return { present: false };
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { present: true, onScreen: b.bottom > 0 && b.top < innerHeight && cs.display !== 'none'
      && cs.visibility !== 'hidden', h: Math.round(b.height), display: cs.display };
  };
  const leaflet = document.querySelector('#map .leaflet-container');
  return {
    docOverflow: se.scrollHeight - se.clientHeight,
    scrollTop: Math.round(se.scrollTop),
    status: seen('#stageLegHd'), type: seen('#shapeLegHd'), reg: seen('#regLegHd'),
    panel: seen('.maplegend-wrap'), mapFrame: seen('.map-frame'),
    chips: { status: document.querySelectorAll('#mapkey .stagechip').length,
             type: document.querySelectorAll('#mapkeyShapes .typechip').length,
             reg: document.querySelectorAll('#mapkeyReg input').length },
    leafletH: leaflet ? Math.round(leaflet.getBoundingClientRect().height) : null,
    markers: document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)').length
  };
});

// ── 1. THE EMBED DOCUMENT DOES NOT OVERFLOW ITS FRAME ─────────────────────────────
// 520px is the height the defect was reported at; 720px is the height the hosts pass
// today. Both are asserted, because the fix must not depend on the host's number.
for (const [w, h] of [[868, 520], [868, 720], [358, 620]]) {
  const page = await open(w, h, true);
  const g = await geometry(page);
  ok(g.docOverflow === 0, '1 embed ' + w + 'x' + h + ' — the card fits the frame, nothing to scroll',
    'overflow=' + g.docOverflow + 'px');
  ok(g.leafletH !== null && g.leafletH >= 150,
    '1b ...and the map still gets a real canvas, not a sliver', g.leafletH + 'px');
  await page.context().close();
}

// ── 2. THE RESIDENT'S OWN ACTIONS: A ZOOM CLICK, THEN A MARKER CLICK ──────────────
// This is the reported bug, driven. Before the fix: scrollTop 0 -> 343 and all three
// headings left the frame on the FIRST zoom click.
{
  const page = await open(868, 520, true);
  const before = await geometry(page);
  ok(before.status.onScreen && before.type.onScreen && before.reg.onScreen,
    '2 all three panel headings are on screen when the embed loads');
  await page.click('.leaflet-control-zoom-in');
  await page.waitForTimeout(700);
  const zoomed = await geometry(page);
  ok(zoomed.scrollTop === 0, '2a a zoom-IN click does not scroll the embed document',
    'scrollTop=' + zoomed.scrollTop);
  ok(zoomed.status.onScreen && zoomed.type.onScreen && zoomed.reg.onScreen,
    '2b ...and STATUS / PROJECT TYPE / REGULATORY are all still on screen',
    'status=' + zoomed.status.onScreen + ' type=' + zoomed.type.onScreen + ' reg=' + zoomed.reg.onScreen);
  await page.click('.leaflet-control-zoom-out');
  await page.waitForTimeout(500);
  const out = await geometry(page);
  ok(out.scrollTop === 0 && out.status.onScreen, '2c a zoom-OUT click keeps them too',
    'scrollTop=' + out.scrollTop);
  const marker = await page.$('#map .leaflet-marker-icon:not(.homepin)');
  ok(!!marker, '2d there is a real marker to click');
  if (marker) { await marker.click({ force: true }); await page.waitForTimeout(600); }
  const clicked = await geometry(page);
  ok(clicked.scrollTop === 0, '2e clicking a marker (the popup in the report) does not scroll it either',
    'scrollTop=' + clicked.scrollTop);
  ok(clicked.status.onScreen && clicked.type.onScreen && clicked.reg.onScreen,
    '2f ...and the panel survives that too');
  // The controls are not merely present — they are the real ones, with their chips.
  ok(clicked.chips.status === 4 && clicked.chips.type === 7 && clicked.chips.reg === 1,
    '2g the panel still carries its 4 status / 7 type / 1 regulatory controls',
    JSON.stringify(clicked.chips));
  await page.context().close();
}

// ── 3. THE PANEL IS NEVER HIDDEN TO MAKE ROOM ─────────────────────────────────────
// place-context-map.test.mjs pins this in the CSS TEXT. Here it is measured on the
// rendered embed, which is the claim that matters: fitting the frame must not have been
// bought by display:none.
{
  const page = await open(868, 520, true);
  const g = await geometry(page);
  ok(g.panel.present && g.panel.display !== 'none' && g.panel.h > 0,
    '3 the filter panel is rendered, not hidden', 'display=' + g.panel.display + ' h=' + g.panel.h);
  await page.context().close();
}

// ── 4. BOTH HOSTS GIVE THE FRAME ENOUGH ROOM ──────────────────────────────────────
// The panel needs 288px at desktop widths, so a 320px frame could only ever have shown
// the panel and a 32px strip of map. The floor is pinned so a silent revert to 320 fails.
const HEIGHT = /height:clamp\((\d+)px,\s*58vw,\s*(\d+)px\)/;
for (const [file, what] of [['lib/community-page.js', 'the ZIP host'], ['property.html', 'the Address host']]) {
  const src = readFileSync(join(REPO, file), 'utf8');
  const m = src.match(HEIGHT);
  ok(!!m, '4 ' + what + ' sizes the context-map iframe with a clamp', m ? m[0] : 'NO MATCH');
  ok(!!m && Number(m[1]) >= 520, '4a ...whose floor leaves room for the panel and a map',
    m ? m[1] + 'px' : 'n/a');
  ok(!!m && Number(m[2]) >= Number(m[1]), '4b ...and whose ceiling is not below its floor',
    m ? m[1] + '..' + m[2] : 'n/a');
}

// ── 5. COUNTERFACTUAL: THE FULL PAGE IS NOT AN EMBED ──────────────────────────────
// If fitting the frame had been written as a global rule, Map 1's own page would have
// lost its 600px map. It did not.
{
  const page = await open(1280, 900, false);
  const g = await geometry(page);
  ok(g.mapFrame.h === 600, '5 full-page Map 1 keeps its 600px map frame', g.mapFrame.h + 'px');
  ok(g.docOverflow > 0, '5a ...and the full page still scrolls as a page (it is not frame-locked)',
    'overflow=' + g.docOverflow + 'px');
  const html = await page.evaluate(() => document.documentElement.className);
  ok(!/hs-embed/.test(html), '5b ...with no hs-embed class, so none of the embed rules applied', html || '(none)');
  await page.context().close();
}

await browser.close();
srv.close();
console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
process.exit(fails ? 1 : 0);

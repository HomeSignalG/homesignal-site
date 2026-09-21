// MAPS · DATA CENTER THEME — THE CAPTURE STATE, MEASURED IN A REAL BROWSER.
//
// scripts/maps-social-image.mjs opens Map 1 in the shipped embed mode, puts ALL THREE of its
// filter dimensions into the founder-specified state — every STATUS control on, Data center
// the only PROJECT TYPE, the REGULATORY overlay OFF — and clips the shutter to the Map 1
// product card at 1200x630. Every one of those is a GEOMETRY and BEHAVIOUR claim that a
// structural grep cannot settle: the CSS and the control wiring are each correct in isolation
// and can still be wrong together. So this suite drives the real page and measures what a
// capture would get.
//
// ⚠️ IT CALLS THE PRODUCTION HELPER, IT DOES NOT RE-TYPE IT. The previous version of this file
// carried its own copy of the filter manoeuvre in §2 — so it went on passing while production
// set one dimension of three and published whatever the other two happened to be. A test that
// reimplements the thing it is testing measures the test. `lib/maps-capture-policy.js` is
// injected here exactly as the capture job injects it, and every assertion below runs
// `HS.mapsDcCaptureApplyPolicy` / `HS.mapsDcCaptureVerifyAtShutter` — the shipped functions.
//
// ⚠️ IT STARTS FROM DELIBERATELY WRONG CONTROLS. A suite that begins at the page's all-on
// default would pass with a no-op implementation: three of the four things the policy must do
// are already true there. §0 turns a status OFF, turns two unrelated types ON and leaves
// Regulatory ON before the policy is ever called.
//
// It needs no network: the repo is served locally, Leaflet comes from node_modules, and every
// Supabase read is fulfilled from fixtures. Nothing here fabricates a social image — it
// measures the page the capture photographs.
//
// Run: node test/maps-datacenter-capture-state.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readFile as rf } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!c) fails++;
};

const REPO = process.cwd();
const POLICY_SRC = readFileSync(new URL('../lib/maps-capture-policy.js', import.meta.url), 'utf8');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = createServer(async (q, s) => {
  const p = normalize(join(REPO, decodeURIComponent(q.url.split('?')[0])));
  try { s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/plain' }); s.end(await readFile(p)); }
  catch { s.writeHead(404); s.end('nope'); }
});
await new Promise((r) => srv.listen(8837, '127.0.0.1', r));
const base = 'http://127.0.0.1:8837';

// ── THE FIXTURE POPULATION ─────────────────────────────────────────────────────────────
// Four records, because the policy makes four different claims and a fixture that carried
// only the target would let every exclusion assertion pass vacuously.
//
// THE TARGET. `type` is the PROJECT type ('Development' — a broad bucket) and the data centre
// is stated only in the NAME, which is the real Kansas City candidate's shape and the
// commonest one in the corpus.
const DC = {
  source_key: 'arcgis:kcmo-development-cases:CD-CPC-2026-00142',
  project_ref: 'arcgis:kcmo-development-cases:CD-CPC-2026-00142',
  name: 'RBC Data Center Campus Major Amendment', type: 'Development', status: 'Proposed',
  registry_id: 'kcmo-development-cases', source_ref: 'https://data.kcmo.org/',
  submitted_at: '2026-09-09', date_kind: 'filed', impact_score: null, impact_dimensions: null,
};
// A NON-DATA-CENTRE DEVELOPMENT that must DISAPPEAR when Data center is isolated. A filter
// that removes nothing proves nothing about the filter.
const RES = {
  source_key: 'arcgis:kcmo-development-cases:R-1', project_ref: 'arcgis:kcmo-development-cases:R-1',
  name: 'Elm Street Subdivision Phase 2', type: 'Residential', status: 'Approved',
  registry_id: 'kcmo-development-cases', source_ref: 'https://data.kcmo.org/r1',
  submitted_at: '2026-09-01', date_kind: 'filed', impact_score: null, impact_dimensions: null,
};
// A LIFECYCLE-UNKNOWN development, so "every STATUS control on" is a claim with something
// riding on it: with `unknown` off this record leaves the map, and the policy must put it back.
const UNK = {
  source_key: 'arcgis:kcmo-development-cases:DC-2', project_ref: 'arcgis:kcmo-development-cases:DC-2',
  name: 'Northland Data Center Shell Building', type: 'Development', status: null,
  registry_id: 'kcmo-development-cases', source_ref: 'https://data.kcmo.org/dc2',
  submitted_at: '2026-08-20', date_kind: 'filed', impact_score: null, impact_dimensions: null,
};
const ZIP = '64155';
const ZIP_AUTH = { [ZIP]: { zip: ZIP, mode: 'development', status: 'boundary_complete',
  projects: [DC, RES, UNK],
  markers: [
    { project_ref: DC.project_ref, lat: 39.3201689806401, lng: -94.5762390223065, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 },
    { project_ref: RES.project_ref, lat: 39.3221689806401, lng: -94.5792390223065, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 },
    { project_ref: UNK.project_ref, lat: 39.3191689806401, lng: -94.5752390223065, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 },
  ] } };
// A REGULATORY-ONLY facility: no classifiable class field, so HS.resolveMarker gives it
// `categories: ['facility']` alone — no Type membership at all. It must never be on a Data
// Center card, in either regulatory switch state.
const FAC_ONLY = { e: 0.3, n: 0.4, lat: 39.3180, lng: -94.5740, type: 'built', scope: 'point',
  label: 'UNCLASSIFIED FRS SITE', registry_id: '110005079495',
  src: 'EPA FRS · registry 110005079495',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110005079495' };
// A DUAL-IDENTITY DATA CENTRE (`categories: ['datacenter','facility']`, octagon + purple R).
// It must STAY — it is a data centre — while its R follows the overlay's off state. This is
// the one fixture that can tell "the overlay was turned off" apart from "the record was hidden".
const FAC_DC = { e: 0.2, n: 0.25, lat: 39.3210, lng: -94.5770, type: 'built', scope: 'point',
  layer: 'datacenter', label: 'NORTHLAND DATA HALL 3', registry_id: '110005079496',
  src: 'EPA FRS · registry 110005079496',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110005079496' };
const ZIP_ROW = { [ZIP]: [{ zip: ZIP, home_lat: 39.3201, home_lng: -94.5762,
  counts: { facilities: 2, development: 3 }, sites: [FAC_ONLY, FAC_DC],
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
        body: await rf(local, 'utf8') });
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
  // THE PRODUCTION POLICY MODULE, injected the way scripts/maps-social-image.mjs injects it.
  await page.addScriptTag({ content: POLICY_SRC });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForFunction((k) => (window.siteMarkers || []).some((x) => x && x.s
    && (x.s.zip_project_ref || x.s.source_id) === k), DC.project_ref, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  return page;
}

const onMapByRef = (page) => page.evaluate(() => Object.fromEntries(
  (window.siteMarkers || []).map((x) => [
    (x && x.s && (x.s.zip_project_ref || x.s.source_id || x.s.registry_id)) || '?',
    !!(x && x.m && x.m._map),
  ])));

const page = await open(1200, 630, true);

// ═══ 0. START FROM DELIBERATELY WRONG CONTROLS ═════════════════════════════════════════
// Through the page's OWN controls, so this is a state a resident could genuinely be in — and
// so a no-op policy implementation cannot pass anything below.
const wrong = await page.evaluate(() => {
  const set = (sel, want) => {
    const b = document.querySelector(sel);
    if (!b) return null;
    if (b.checked !== want) { b.checked = want; b.dispatchEvent(new Event('change', { bubbles: true })); }
    return b.checked;
  };
  set('#mapkey .stagechip[data-stage="unknown"] .stagebox', false);      // a STATUS off
  set('#mapkeyShapes .typechip[data-cat="residential"] .chipbox', true);  // unrelated types on
  set('#mapkeyShapes .typechip[data-cat="industrial"] .chipbox', true);
  set('#mapkeyShapes .typechip[data-cat="datacenter"] .chipbox', true);
  set('#regToggleBox', true);                                            // REGULATORY on
  return window.HS.mapsDcCaptureReadControls();
});
await page.waitForTimeout(400);
ok(wrong.statuses.unknown === false, '0a: the run starts with a STATUS control OFF');
ok(wrong.types.residential === true && wrong.types.industrial === true,
  '0b: …and with unrelated PROJECT TYPES ON');
ok(wrong.regulatory === true, '0c: …and with REGULATORY facilities ON — the Mesa defect, reproduced');

// ═══ 1. MAP 1 ITSELF CALLS THIS PROJECT A DATA CENTER ════════════════════════════════
// The dashboard filter and the page must agree, and their resolver INPUTS differ in shape:
// the dashboard passes {type, type_raw, name} from the candidate's evidence, while a ZIP-mode
// site carries the LIFECYCLE in `type`, the project type in `use_type` and the name in `label`.
const pageVerdict = await page.evaluate((k) => {
  const hit = (window.siteMarkers || []).find((x) => x && x.s && (x.s.zip_project_ref || x.s.source_id) === k);
  if (!hit) return { found: false };
  const m = window.HS.resolveMarker(hit.s);
  return { found: true, typeKey: m.typeKey, categories: m.categories, legend: m.legendLabel };
}, DC.project_ref);
ok(pageVerdict.found, '1a: the target project is drawn on the ZIP page');
ok(pageVerdict.typeKey === 'datacenter', '1b: Map 1 classifies it as Data center', pageVerdict.typeKey);
ok(Array.isArray(pageVerdict.categories) && pageVerdict.categories.indexOf('datacenter') > -1,
  '1c: its FILTER MEMBERSHIP includes datacenter, so the Data center chip shows it');
// The fixture must contain the things the exclusions are about, or every exclusion below
// passes vacuously. This is that denominator.
const fixtureShapes = await page.evaluate(() => {
  const cats = (s) => (window.HS.markerCategories(window.HS.resolveTrackerMarker
    ? window.HS.resolveTrackerMarker(s, function (x) { return x.registry_id; }) : s) || []);
  const byLabel = {};
  for (const x of (window.siteMarkers || [])) {
    const s = x && x.s; if (!s) continue;
    byLabel[(s.label || s.title || '').slice(0, 40)] = cats(s);
  }
  return byLabel;
});
const shapeOf = (frag) => Object.entries(fixtureShapes).find(([k]) => k.includes(frag));
ok((shapeOf('Elm Street') || [, []])[1].join(',') === 'residential',
  '1d: the fixture carries a NON-data-centre development', JSON.stringify(shapeOf('Elm Street')));
ok((shapeOf('UNCLASSIFIED') || [, []])[1].join(',') === 'facility',
  '1e: …a REGULATORY-ONLY record (no Type membership at all)', JSON.stringify(shapeOf('UNCLASSIFIED')));
ok((shapeOf('NORTHLAND DATA HALL') || [, []])[1].sort().join(',') === 'datacenter,facility',
  '1f: …and a DUAL-IDENTITY data centre', JSON.stringify(shapeOf('NORTHLAND DATA HALL')));

// ═══ 2. THE PRODUCTION POLICY, APPLIED THROUGH THE REAL CONTROLS ═════════════════════
const applied = await page.evaluate((k) => window.HS.mapsDcCaptureApplyPolicy({ targetKey: k }), DC.project_ref);
ok(applied.ok === true, '2a: the SHIPPED policy applies cleanly', applied.reason || '');
ok(applied.applied && Object.values(applied.applied.statuses).every((v) => v === true),
  '2b: every STATUS control ends up ON', JSON.stringify(applied.applied && applied.applied.statuses));
const typesOn = Object.entries((applied.applied || {}).types || {}).filter(([, v]) => v).map(([k]) => k);
ok(typesOn.join(',') === 'datacenter', '2c: Data center is the ONLY PROJECT TYPE on', typesOn.join(',') || 'none');
ok(applied.applied && applied.applied.regulatory === false, '2d: REGULATORY facilities ends up OFF');
ok(applied.dispatched && applied.dispatched.statuses + applied.dispatched.types + applied.dispatched.regulatory >= 4,
  '2e: …and it got there by dispatching real change events',
  JSON.stringify(applied.dispatched));

// ═══ 2R. THE RENDERED MAP, NOT THE CHECKBOXES ════════════════════════════════════════
// ⚠️ `window.siteMarkers` IS NOT THE VISIBLE SET — applyFilter() leaves every marker in that
// array and only adds it to / removes it from the Leaflet layer group. ON THE MAP is `m._map`,
// which Leaflet nulls on removeLayer, and that is what every count here reads.
const vis = await onMapByRef(page);
ok(vis[DC.project_ref] === true, '2f: the TARGET data centre is on the map after filtering');
ok(vis[UNK.project_ref] === true,
  '2g: the LIFECYCLE-UNKNOWN data centre is on the map — "every status on" did real work');
ok(vis[RES.project_ref] === false, '2h: CONTROL — the Residential development is OFF the map');
ok(vis['110005079495'] === false, '2i: the REGULATORY-ONLY record is OFF the map');
ok(vis['110005079496'] === true,
  '2j: the DUAL-IDENTITY data centre STAYS — regulatory off hides the badge, never the project');
ok(applied.rendered.non_datacenter_development_on_map === 0
  && applied.rendered.regulatory_only_on_map === 0
  && applied.rendered.regulatory_badges_drawn === 0
  && applied.rendered.target_on_map === true,
  '2k: the production helper MEASURES all of that', JSON.stringify(applied.rendered));
ok(applied.rendered.dual_identity_target === false,
  '2l: …and reports the target is not itself dual-identity here');
// The badge is read off the DRAWN ELEMENT, so this is about pixels-as-markup, not the switch.
const badge = await page.evaluate(() => {
  const hit = (window.siteMarkers || []).find((x) => x && x.s && x.s.registry_id === '110005079496');
  const mk = hit && (hit.mk || hit.s);
  const el = hit && hit.m && hit.m.getElement ? hit.m.getElement() : null;
  return { hasSignal: !!(mk && mk.signal), sigColor: mk && mk.signal && mk.signal.color,
           painted: !!(el && mk && mk.signal && (el.innerHTML || '').indexOf(mk.signal.color) > -1) };
});
ok(badge.hasSignal === true, '2m: the dual-identity record DOES carry a regulatory signal', badge.sigColor);
ok(badge.painted === false, '2n: …and its purple R is NOT painted while the overlay is off');

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
    capText: (document.querySelector('.card.mapcard .map-cap') || {}).textContent || '',
    statusIn: inFrame(hd('STATUS')), typeIn: inFrame(hd('PROJECT TYPE')), regIn: inFrame(hd('REGULATORY RECORDS')),
    keyIn: inFrame(r('#mapkeyNote')), mapIn: inFrame(r('.card.mapcard .map-frame')),
    mapH: (r('.card.mapcard .map-frame') || {}).h,
    sidebar: r('#hs-side'), head: r('.wrap>.head'),
  };
});
ok(geo.docOverflow <= 0, '3a: the embed document does NOT overflow its frame', geo.docOverflow);
ok(geo.card && geo.card.w === 1200 && geo.card.h === 630,
  '3b: the Map 1 product card is exactly the 1200x630 image frame',
  geo.card ? geo.card.w + 'x' + geo.card.h : 'absent');
ok(geo.statusIn && geo.typeIn && geo.regIn && geo.keyIn,
  '3c: STATUS, PROJECT TYPE, REGULATORY RECORDS and the map key are all inside the frame');
ok(geo.mapIn && geo.mapH >= 200, '3d: a usable amount of the MAP is inside the frame', geo.mapH);
ok(geo.capText.includes(ZIP) && /development/i.test(geo.capText),
  '3e: the card names the place and ZIP it is showing', geo.capText.trim());
ok(!geo.sidebar || geo.sidebar.display === 'none', '3f: the global sidebar is not in the capture');
ok(!geo.head || geo.head.display === 'none', '3g: the address search form is not in the capture');

// ═══ 4. FRAMING AND THE POPUP DO NOT RESET THE STATE — CHECKED AT THE SHUTTER ════════
// This is the capture's real sequence: apply the policy, THEN setView, THEN openPopup, THEN
// re-verify. Both of those re-enter the page, which is exactly why the verification is
// repeated rather than trusted from §2.
const popup = await page.evaluate((k) => {
  const hit = (window.siteMarkers || []).find((x) => x && x.s && (x.s.zip_project_ref || x.s.source_id) === k);
  if (!hit) return { ok: false };
  const map = hit.m && hit.m._map;
  map.setView([hit.s.lat, hit.s.lng], 15, { animate: false });
  hit.m.openPopup();
  const el = document.querySelector('.leaflet-popup-content');
  return { ok: !!el, text: (el ? el.innerText : '').trim().slice(0, 160) };
}, DC.project_ref);
ok(popup.ok, '4a: the EXACT project\'s own Map 1 popup opens');
ok(/RBC Data Center Campus/i.test(popup.text),
  '4b: the popup names the exact project, so a reader can identify the target', popup.text.split('\n')[0]);
const shutter = await page.evaluate((k) => window.HS.mapsDcCaptureVerifyAtShutter(k), DC.project_ref);
ok(shutter.ok === true, '4c: the SHIPPED shutter check passes AFTER framing and the popup', shutter.reason || '');
const record = await page.evaluate(([a, v]) => window.HS.mapsDcCapturePolicyRecord(a, v), [applied, shutter]);
const recVerdict = await page.evaluate((r) => window.HS.mapsDcCapturePolicyEvidence({ capture_policy: r }), record);
ok(recVerdict.ok === true, '4d: the assembled evidence record satisfies the SHIPPED validator',
  (recVerdict.problems || []).join('; '));
ok(record.policy === 'dc-map-state@1', '4e: …and it names the policy version', record.policy);

// ═══ 5. A REDRAW THAT RESETS THE CONTROLS IS CAUGHT AT THE SHUTTER ═══════════════════
// The load-bearing proof for §4c: if nothing could move the controls between apply and
// shutter, that check would be scaffolding. Here a control is moved the way a stray handler
// would move it, and the shutter check must refuse.
const afterReset = await page.evaluate(() => {
  const b = document.getElementById('regToggleBox');
  b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true }));
  return window.HS.mapsDcCaptureReadControls().regulatory;
});
await page.waitForTimeout(300);
const shutter2 = await page.evaluate((k) => window.HS.mapsDcCaptureVerifyAtShutter(k), DC.project_ref);
ok(afterReset === true, '5a: a stray change turned REGULATORY back on');
ok(shutter2.ok === false && /REGULATORY/i.test(shutter2.reason || ''),
  '5b: the shutter check REFUSES — so §4c is load-bearing, not scaffolding', shutter2.reason);

// ═══ 6. FAIL CLOSED — A HANDLER THAT DOES NOT TAKE ═══════════════════════════════════
// The checkbox is replaced with a listener-free clone, so `.checked` still changes and the
// page's applyFilter never runs. The CONTROL reads compliant; the MAP does not. Only a check
// that measures the rendered layer can see this, which is the whole reason it exists.
const p2 = await open(1200, 630, true);
const neutered = await p2.evaluate(async () => {
  const box = document.getElementById('regToggleBox');
  box.replaceWith(box.cloneNode(true));                 // same DOM, no listeners
  const r = await window.HS.mapsDcCaptureApplyPolicy({ targetKey: null });
  return { applyOk: r.ok, reg: r.applied && r.applied.regulatory, rendered: r.rendered, reason: r.reason };
});
ok(neutered.reg === false, '6a: the dead control still READS as compliant — metadata alone would pass');
const shutter3 = await p2.evaluate((k) => window.HS.mapsDcCaptureVerifyAtShutter(k), DC.project_ref);
ok(shutter3.ok === false && /badge/i.test(shutter3.reason || ''),
  '6b: the RENDERED check catches it — badges are still drawn', shutter3.reason);

// ═══ 7. FAIL CLOSED — A MISSING CONTROL ══════════════════════════════════════════════
const p3 = await open(1200, 630, true);
const missing = await p3.evaluate(async () => {
  document.getElementById('regToggleBox').remove();
  return window.HS.mapsDcCaptureApplyPolicy({ targetKey: null });
});
ok(missing.ok === false && /not ready|regulatory controls/i.test(missing.reason || ''),
  '7a: a missing REGULATORY control refuses the capture', missing.reason);
const dupd = await p3.evaluate(async () => {
  const chips = document.querySelectorAll('#mapkey .stagechip');
  chips[0].parentNode.appendChild(chips[0].cloneNode(true));   // a duplicated STATUS control
  return window.HS.mapsDcCaptureApplyPolicy({ targetKey: null });
});
ok(dupd.ok === false, '7b: a DUPLICATED control refuses the capture too', dupd.reason);

// ═══ 8. FAIL CLOSED — THE TARGET IS NOT ON THE MAP ═══════════════════════════════════
const p4 = await open(1200, 630, true);
const gone = await p4.evaluate((k) => window.HS.mapsDcCaptureApplyPolicy({ targetKey: k }), RES.project_ref);
ok(gone.ok === false && /NOT shown|no marker/i.test(gone.reason || ''),
  '8a: a target the policy filters out refuses the capture rather than photographing the map without it',
  gone.reason);

// ═══ 9. IDEMPOTENCE — A SECOND RUN IS A NO-OP ════════════════════════════════════════
const p5 = await open(1200, 630, true);
const r1 = await p5.evaluate((k) => window.HS.mapsDcCaptureApplyPolicy({ targetKey: k }), DC.project_ref);
const r2 = await p5.evaluate((k) => window.HS.mapsDcCaptureApplyPolicy({ targetKey: k }), DC.project_ref);
ok(r1.ok && r2.ok, '9a: both runs succeed');
ok(JSON.stringify(r1.applied) === JSON.stringify(r2.applied),
  '9b: the second run reaches the identical control state');
ok(r2.dispatched.statuses + r2.dispatched.types + r2.dispatched.regulatory === 0,
  '9c: …and dispatches ZERO change events — a re-run cannot churn the map',
  JSON.stringify(r2.dispatched));

// ═══ 10. COUNTERFACTUAL — full-page Map 1 is UNCHANGED ══════════════════════════════
// Fitting the frame is an EMBED rule. If this suite could pass while Map 1's own page shrank,
// it would be licensing a regression instead of pinning a capture.
const full = await open(1280, 900, false);
const fullGeo = await full.evaluate(() => {
  const e = document.querySelector('.map-frame');
  return e ? Math.round(e.getBoundingClientRect().height) : null;
});
ok(fullGeo === 600, '10a: full-page Map 1 still has its 600px map frame', fullGeo);
// …and a resident's own page is NOT left in the capture state by anything this module does.
const residentDefaults = await full.evaluate(() => window.HS.mapsDcCaptureReadControls());
ok(Object.values(residentDefaults.statuses).every((v) => v === true)
  && Object.values(residentDefaults.types).every((v) => v === true)
  && residentDefaults.regulatory === true,
  '10b: a freshly opened resident page still shows every control ON — no default was changed',
  JSON.stringify(residentDefaults));

await browser.close();
srv.close();
console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);

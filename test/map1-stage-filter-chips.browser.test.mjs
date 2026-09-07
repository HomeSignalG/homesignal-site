// MAP 1 — STAGE IS A MULTI-SELECT CHECKBOX FILTER: "checked statuses are shown on the map".
//
// SCOPE. This suite proves the STATUS/STAGE row and nothing else. The Type row and the
// Regulatory switch are asserted only as CONTROLS — that this change did not move them —
// because the cheapest way to break a working dimension is to touch the shared filter path
// while rebuilding a neighbouring row. Every earlier Map 1 suite pins the same lesson.
//
// WHAT CHANGED AND WHY A TEST. The row used to be four role="button" chips carrying
// aria-pressed, an `.off` class, a strike-through label and a dimmed dot — i.e. a toggle
// that read as "deleted / disabled" rather than as "not selected", with the on/off state
// re-implemented in ARIA rather than taken from the platform. It is now four real
// <input type=checkbox> controls inside their labels. The three facts that must not
// regress, and which a comment cannot enforce:
//
//   1. SEMANTICS COME FROM THE PLATFORM — a real checkbox, so Tab reaches it and Space
//      toggles it with no keydown handler of our own.
//   2. STATE IS NEVER COLOUR ALONE — the check mark is a shape plus a glyph, and the
//      accessible name says "shown on map" / "hidden from map" in words.
//   3. ZERO SELECTED IS A LEGAL STATE — the map empties, says so, and does NOT silently
//      re-check everything.
//
// It drives the REAL shipped page: the chips are clicked the way a resident clicks them,
// and visibility is read off the rendered Leaflet layer. Nothing here reimplements a
// filter model.
//
// The production records are VERBATIM `development_reports` site objects (ZIP 20171,
// pulled 2026-09-06) — the same fixtures test/map1-all-types-off.browser.test.mjs uses —
// extended with one record per lifecycle bucket, which is the shape this row needs.
//
// Run: node test/map1-stage-filter-chips.browser.test.mjs
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

// ── ONE RECORD PER LIFECYCLE BUCKET ─────────────────────────────────────────────────
// The four stages have to arrive through the TWO paths the page actually has, or the suite
// would be testing a shape production never produces:
//   * `operating` rides in on the cached report as an EPA facility — the national floor,
//     which HS.zipAuthMergeSites deliberately KEEPS (scope point, relevance NOT development).
//   * `approved` / `proposed` / `unknown` come from the AUTHORITATIVE whole-ZIP payload
//     (app_zip_projects_markers). In ZIP mode the merge drops the report's own development
//     points on purpose — centroid-radius development may not be presented as a whole-ZIP
//     claim — so a development record can only reach the map this way.
// Their lifecycle is derived by HS.n5BucketFromStatus from each project's own `status`;
// 'On file' is unmapped there and resolves to `unknown`, which is exactly the FIRST-CLASS
// legended state the fourth chip exists for.
//
// ⚠️ NONE of them is Residential, deliberately: Rule 5 drops unqualified residential records
// before they become sites, and a stage suite must not be able to fail for that reason.
const OPERATING = { e: 1.482, n: 1.664, lat: 38.94932, lng: -77.36519,
  src: 'EPA FRS · registry 110071955663', type: 'built', label: 'CORESITE - VA1 DATA CENTER',
  layer: 'datacenter', scope: 'point', registry_id: '110071955663',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110071955663' };

const PROJECTS = [
  { source_key: 'arcgis:fairfax:P-1', project_ref: 'arcgis:fairfax:P-1',
    name: 'Pennhurst Data Centers', type: 'Data Center', status: 'Approved',
    registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/x',
    submitted_at: '2026-01-04', date_kind: 'filed', impact_score: null, impact_dimensions: null },
  { source_key: 'arcgis:fairfax:P-2', project_ref: 'arcgis:fairfax:P-2',
    name: 'Sunrise Valley Mixed Use', type: 'Commercial', status: 'Proposed',
    registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/y',
    submitted_at: '2026-02-10', date_kind: 'filed', impact_score: null, impact_dimensions: null },
  { source_key: 'arcgis:fairfax:P-3', project_ref: 'arcgis:fairfax:P-3',
    name: 'Herndon Parkway Utility Corridor', type: 'Infrastructure', status: 'On file',
    registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/z',
    submitted_at: '2026-03-01', date_kind: 'filed', impact_score: null, impact_dimensions: null }
];
const ZIP_AUTH = { '20171': { zip: '20171', mode: 'development', status: 'boundary_complete',
  projects: PROJECTS,
  markers: [
    { project_ref: 'arcgis:fairfax:P-1', lat: 38.95065, lng: -77.36458, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 },
    { project_ref: 'arcgis:fairfax:P-2', lat: 38.95320, lng: -77.36220, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 },
    { project_ref: 'arcgis:fairfax:P-3', lat: 38.95580, lng: -77.36010, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }
  ] } };

const ZIP_ROW = { '20171': [{ zip: '20171', home_lat: 38.9506, home_lng: -77.3645,
  counts: { facilities: 1, development: 3 }, sites: [OPERATING],
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

const load = async (qs) => {
  await page.goto(base + '/homesignalmap.html?zip=20171' + (qs || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(600);
};
const chips = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#mapkey .stagechip')).map((c) => {
    const box = c.querySelector('input.stagebox');
    const cs = getComputedStyle(c.querySelector('.t'));
    return { id: c.getAttribute('data-stage-id'), key: c.getAttribute('data-stage'),
      label: c.querySelector('.t').textContent.trim(),
      checked: !!(box && box.checked), tag: box ? box.tagName + ':' + box.type : null,
      name: box ? box.getAttribute('aria-label') : null,
      dot: !!c.querySelector('span.dot'),
      dotBg: c.querySelector('span.dot') ? c.querySelector('span.dot').style.background : '',
      strike: cs.textDecorationLine, labelOpacity: getComputedStyle(c).opacity,
      h: Math.round(c.getBoundingClientRect().height) };
  }));
// A resident toggles a stage by CLICKING its chip — never by writing filter state.
const clickStage = (id) => page.evaluate((want) => {
  const c = document.querySelector('#mapkey .stagechip[data-stage-id="' + want + '"]');
  if (c) c.click();
}, id);
const pins = () => page.evaluate(() =>
  document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)').length);
const verify = () => page.evaluate(() => window.__HS_VERIFY);
const emptyNote = () => page.evaluate(() => {
  const el = document.getElementById('mapkeyStageEmpty');
  return { shown: !!el && !el.hidden && el.offsetParent !== null, text: el ? el.textContent.trim() : '' };
});
const stagesParam = () => page.evaluate(() => new URL(location.href).searchParams.get('stages'));

// ── 0. SETUP / DEFAULT STATE ────────────────────────────────────────────────────────
await load();
const C0 = await chips();
ok(C0.length === 4, '0: the row is four Stage chips', C0.map(c => c.id).join(','));
ok(C0.map(c => c.id).join(',') === 'operating_now,approved,proposed,lifecycle_unknown',
  '0: stable status IDS, in lifecycle order', C0.map(c => c.id).join(','));
ok(C0.map(c => c.label).join(' | ') === 'Operating now | Approved | Proposed | Lifecycle unknown',
  '0: the four founder-specified labels', C0.map(c => c.label).join(' | '));
ok(C0.every(c => c.checked), '0: DEFAULT — all four are checked');
ok((await pins()) === 4, '0: ...and all four lifecycle categories are on the map', await pins());
ok(!(await emptyNote()).shown, '0: no empty-state note while anything is selected');

// ── 1. NATIVE CHECKBOX SEMANTICS, NOT RE-IMPLEMENTED ARIA ───────────────────────────
ok(C0.every(c => c.tag === 'INPUT:checkbox'), '1: every chip is a REAL <input type=checkbox>',
  C0.map(c => c.tag).join(','));
const grp = await page.evaluate(() => {
  const g = document.getElementById('mapkey');
  const help = document.getElementById(g.getAttribute('aria-describedby') || '');
  const hd = document.getElementById(g.getAttribute('aria-labelledby') || '');
  return { role: g.getAttribute('role'), help: help ? help.textContent.trim() : null,
    hd: hd ? hd.textContent.trim() : null };
});
ok(grp.role === 'group' && /Stage/.test(grp.hd || ''),
  '1: the four are a labelled group', JSON.stringify(grp));
ok(grp.help === 'Checked statuses are shown on the map.',
  '1: the governing rule is programmatically associated with the group', grp.help);
// The accessible name states INCLUSION in words, so the state never rests on the tick alone.
ok(C0[0].name === 'Operating now status, shown on map',
  '1: accessible name says what checked MEANS', C0[0].name);

// ── 2. UNCHECKING ONE STAGE REMOVES ONLY THAT STAGE ─────────────────────────────────
await clickStage('proposed');
const C2 = await chips();
ok(C2.filter(c => !c.checked).map(c => c.id).join(',') === 'proposed',
  '2: clicking Proposed unchecks ONLY Proposed', C2.filter(c => !c.checked).map(c => c.id).join(','));
ok((await pins()) === 3, '2: ...and removes exactly its one pin', await pins());
ok(C2.find(c => c.id === 'proposed').name === 'Proposed status, hidden from map',
  '2: the accessible name follows the state', C2.find(c => c.id === 'proposed').name);
// The dot is the PIN-COLOUR LEGEND and stays legible whether or not the stage is shown.
const off = C2.find(c => c.id === 'proposed');
ok(off.dot && /rgb|#/.test(off.dotBg), '2: an unchecked chip KEEPS its colour dot', off.dotBg);
ok(off.strike === 'none', '2: ...and is NOT struck through', off.strike);
ok(Number(off.labelOpacity) >= 0.9, '2: ...and is not dimmed to look disabled', off.labelOpacity);

// ── 3. CLICKING AGAIN RESTORES IT ───────────────────────────────────────────────────
await clickStage('proposed');
ok((await chips()).every(c => c.checked), '3: clicking again re-checks Proposed');
ok((await pins()) === 4, '3: ...and its pin comes back', await pins());

// ── 4. ANY COMBINATION — the dimension is genuinely multi-select ─────────────────────
await clickStage('approved'); await clickStage('lifecycle_unknown');
const C4 = await chips();
ok(C4.filter(c => c.checked).map(c => c.id).join(',') === 'operating_now,proposed',
  '4: two stages remain selected simultaneously', C4.filter(c => c.checked).map(c => c.id).join(','));
ok((await pins()) === 2, '4: ...and exactly their two pins are drawn', await pins());

// ── 5. KEYBOARD — Space toggles the focused chip, and focus is visible ───────────────
await page.evaluate(() => document.querySelector('#mapkey .stagechip[data-stage-id="approved"] input').focus());
const focused = await page.evaluate(() => {
  const el = document.activeElement;
  return { isBox: el && el.classList.contains('stagebox'),
    ring: getComputedStyle(el.closest('.stagechip')).outlineStyle };
});
ok(focused.isBox, '5: the checkbox is focusable');
await page.keyboard.press('Space');
ok((await chips()).find(c => c.id === 'approved').checked, '5: Space toggles the focused stage');
ok((await pins()) === 3, '5: ...and the map follows immediately, with no Apply step', await pins());

// ── 6. ZERO SELECTED IS A LEGAL STATE ───────────────────────────────────────────────
for (const id of ['operating_now', 'approved', 'proposed']) await clickStage(id);
const C6 = await chips();
ok(C6.every(c => !c.checked), '6: all four can be unchecked');
ok((await pins()) === 0, '6: ZERO project pins are shown', await pins());
const note = await emptyNote();
ok(note.shown, '6: ...and a non-blocking note appears');
ok(/No project statuses are selected\./.test(note.text), '6: the note states the cause', note.text);
ok(/Select all statuses\./.test(note.text), '6: ...and carries a visible action', note.text);
const v6 = await verify();
ok(v6.allStagesOff === true && v6.visibleMarkers === 0 && v6.mapMarkers === 4,
  '6: __HS_VERIFY separates "resident deselected everything" from "no records"',
  JSON.stringify({ off: v6.allStagesOff, visible: v6.visibleMarkers, total: v6.mapMarkers }));

// ── 7. THE ACTION RESTORES ALL FOUR ─────────────────────────────────────────────────
await page.click('#stageSelectAll');
ok((await chips()).every(c => c.checked), '7: "Select all statuses" re-checks all four');
ok((await pins()) === 4, '7: ...and every pin returns', await pins());
ok(!(await emptyNote()).shown, '7: ...and the note goes away');

// ── 8. THE CHOICE SURVIVES A VIEW SWITCH AND A REFRESH ──────────────────────────────
await clickStage('proposed');
const beforeView = await stagesParam();
ok(beforeView === 'operating_now,approved,lifecycle_unknown',
  '8: the URL carries the selection as stable IDs', beforeView);
await page.evaluate(() => document.querySelector('#viewSeg button[data-v="3d"]').click());
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#viewSeg button[data-v="2d"]').click());
await page.waitForTimeout(400);
const C8 = await chips();
ok(C8.filter(c => c.checked).map(c => c.id).join(',') === 'operating_now,approved,lifecycle_unknown',
  '8: the selection survives a 2D -> 3D -> 2D round trip', C8.filter(c => c.checked).map(c => c.id).join(','));
ok((await pins()) === 3, '8: ...and the map still honours it', await pins());

// A refresh is the URL doing its job — this is the same page loaded fresh from the link.
await load('&stages=operating_now,proposed');
const C8b = await chips();
ok(C8b.filter(c => c.checked).map(c => c.id).join(',') === 'operating_now,proposed',
  '8b: ?stages= is applied on load', C8b.filter(c => c.checked).map(c => c.id).join(','));
ok((await pins()) === 2, '8b: ...before the first paint, so no pins flash in and out', await pins());

// ABSENT vs EMPTY. The one bug this reader can have: no ?stages= means "nothing expressed"
// (all on), while an empty ?stages= means "the resident deselected everything" (none on).
await load('&stages=');
ok((await chips()).every(c => !c.checked) && (await pins()) === 0,
  '8c: an EMPTY ?stages= is honoured as none-selected, not reset to all');
await load();
ok((await chips()).every(c => c.checked), '8d: NO ?stages= falls back to the all-on default');
// A stale or hand-edited link degrades to what it does name, rather than to everything.
await load('&stages=approved,not_a_stage');
ok((await chips()).filter(c => c.checked).map(c => c.id).join(',') === 'approved',
  '8e: an unrecognised id is dropped, not treated as a match',
  (await chips()).filter(c => c.checked).map(c => c.id).join(','));

// ── 9. CONTROLS — the neighbouring dimensions did not move ──────────────────────────
await load();
const nb = await page.evaluate(() => ({
  typeChips: document.querySelectorAll('#mapkeyShapes span.sh[data-cat]').length,
  typePressed: document.querySelectorAll('#mapkeyShapes span.sh[aria-pressed="true"]').length,
  reg: document.getElementById('regToggle') ? document.getElementById('regToggle').getAttribute('aria-checked') : null,
  stageHasSvg: !!document.querySelector('#mapkey svg'),
  stageDots: document.querySelectorAll('#mapkey span.dot').length
}));
ok(nb.typeChips === 7 && nb.typePressed === 7,
  '9: the seven Type chips are untouched and still aria-pressed toggles', JSON.stringify(nb));
ok(nb.reg === 'true', '9: the Regulatory switch is untouched and still fail-open', nb.reg);
// The two rules the page's own live verifier enforces, re-asserted here on the rebuilt row.
ok(nb.stageDots === 4 && !nb.stageHasSvg,
  '9: the Stage row still carries colour DOTS and no marker shapes', JSON.stringify(nb));
const trackerFails = await page.evaluate(() =>
  (window.__HS_TRACKER_MARKER_VERIFY ? window.__HS_TRACKER_MARKER_VERIFY() : ['verifier missing']));
ok(Array.isArray(trackerFails) && trackerFails.length === 0,
  '9: the page\'s own marker/legend verifier still passes', JSON.stringify(trackerFails).slice(0, 300));

ok(pageErrors.length === 0, 'no uncaught page errors', pageErrors.join(' | '));

await browser.close();
srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nmap1 stage filter chips: multi-select checkboxes, '
  + 'state in words not colour, zero-selected honoured, and the URL round-trips.');
process.exit(fails ? 1 : 0);

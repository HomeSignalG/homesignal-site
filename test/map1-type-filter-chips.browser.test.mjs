// MAP 1 — TYPE IS A MULTI-SELECT CHECKBOX FILTER: "checked types are shown on the map".
//
// The Type row was seven role="button" chips carrying aria-pressed, PLUS a "Show types"
// dropdown that was a second view of the same state. Both are gone: the row is now the
// same checkbox chip the Stage row uses, so one sentence — "checked categories are shown
// on the map" — is true of every filter on the page.
//
// WHAT THIS SUITE EXISTS TO PROVE, beyond "the chips render":
//   1. AND LOGIC. A project pin needs its Stage AND its Type checked. Unchecking Data
//      center must hide an APPROVED data centre even while Approved is checked.
//   2. TOGGLING ONE TYPE MOVES ONLY THAT TYPE. Measured per type off the rendered
//      markers' own titles, not off filter state.
//   3. ZERO SELECTED IS LEGAL. No project pins, no silent re-enable, and a note that
//      reports the CONTROL rather than promising records.
//   4. THE URL IS THE STATE. ?types= initialises, updates on toggle, survives a reload,
//      and absent/empty/unknown are three different things.
//   5. REGULATORY STAYS INDEPENDENT. Its overlay is not governed by the Type predicate.
//
// Fixtures are the same production `development_reports` / app_zip_projects_markers
// shapes the other Map 1 suites use. Residential is deliberately not among them: Rule 5
// drops unqualified residential records before they become sites, and a Type suite must
// not be able to fail for that reason.
//
// Run: node test/map1-type-filter-chips.browser.test.mjs
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

// ── FIXTURES: four project types across two stages, plus one EPA facility ───────────
const FACILITY = { e: 1.482, n: 1.664, lat: 38.94932, lng: -77.36519,
  src: 'EPA FRS · registry 110071955663', type: 'built', label: 'CORESITE - VA1 DATA CENTER',
  layer: 'industrial', scope: 'point', registry_id: '110071955663',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110071955663' };

const mk = (n, ref, name, type, status) => ({
  source_key: ref, project_ref: ref, name: name, type: type, status: status,
  registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/' + n,
  submitted_at: '2026-01-0' + n, date_kind: 'filed', impact_score: null, impact_dimensions: null });
const PROJECTS = [
  mk(1, 'p:dc',    'Pennhurst Data Centers',      'Data Center',    'Approved'),
  mk(2, 'p:ind',   'Herndon Foundry Expansion',   'Industrial',     'Approved'),
  mk(3, 'p:comm',  'Sunrise Valley Mixed Use',    'Commercial',     'Proposed'),
  mk(4, 'p:infra', 'Parkway Utility Corridor',    'Infrastructure', 'Approved')
];
const ZIP_AUTH = { '20171': { zip: '20171', mode: 'development', status: 'boundary_complete',
  projects: PROJECTS,
  markers: PROJECTS.map((p, i) => ({ project_ref: p.project_ref, lat: 38.9500 + i * 0.002,
    lng: -77.3650 + i * 0.002, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 })) } };
const ZIP_ROW = { '20171': [{ zip: '20171', home_lat: 38.9506, home_lng: -77.3645,
  counts: { facilities: 1, development: 4 }, sites: [FACILITY],
  refreshed_at: '2026-09-07T00:00:00Z', facilities_unavailable: false }] };
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
  Array.from(document.querySelectorAll('#mapkeyShapes .typechip')).map((c) => {
    const box = c.querySelector('input');
    const ic = c.querySelector('.ic');
    return { key: c.getAttribute('data-cat'), id: c.getAttribute('data-type-id'),
      label: c.querySelector('.t').textContent.trim(), checked: !!(box && box.checked),
      tag: box ? box.tagName + ':' + box.type : null, name: box ? box.getAttribute('aria-label') : null,
      shapeSvg: !!(ic && ic.querySelector('svg')), shapeOpacity: ic ? getComputedStyle(ic).opacity : null,
      tick: getComputedStyle(c.querySelector('.ck'), '::after').content,
      tickVisible: getComputedStyle(c.querySelector('.ck')).color,
      strike: getComputedStyle(c.querySelector('.t')).textDecorationLine,
      chipOpacity: getComputedStyle(c).opacity, h: Math.round(c.getBoundingClientRect().height) };
  }));
// A resident toggles a type by CLICKING its chip.
const clickType = (id) => page.evaluate((want) => {
  const c = document.querySelector('#mapkeyShapes .typechip[data-type-id="' + want + '"]');
  if (c) c.click();
}, id);
const clickStage = (id) => page.evaluate((want) => {
  const c = document.querySelector('#mapkey .stagechip[data-stage-id="' + want + '"]');
  if (c) c.click();
}, id);
const setReg = (on) => page.evaluate((want) => {
  const b = document.getElementById('regToggleBox');
  if (b && b.checked !== want) b.click();
}, on);
// Visible pins, named by what the resident can actually read off each marker.
const visible = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)'))
    .map(m => { const s = m.querySelector('[title]'); return (s ? s.getAttribute('title') : '').toLowerCase(); }));
const has = (list, re) => list.filter(t => re.test(t)).length;
const typesParam = () => page.evaluate(() => new URL(location.href).searchParams.get('types'));
const noteShown = () => page.evaluate(() => {
  const el = document.getElementById('mapkeyEmpty');
  return { shown: !!el && !el.hidden && el.offsetParent !== null, text: el ? el.textContent.trim().replace(/\s+/g, ' ') : '' };
});

// ── 0. SEVEN CHIPS, ALL CHECKED, SHAPES PRESENT ─────────────────────────────────────
await load();
const C0 = await chips();
ok(C0.length === 7, '0: the Type row is seven chips', C0.map(c => c.key).join(','));
ok(C0.map(c => c.id).join(',') === 'data_center,industrial,residential,roads_infrastructure,commercial,civic_public,other_project',
  '0: stable Type IDS, in registry order', C0.map(c => c.id).join(','));
ok(C0.map(c => c.label).join(' | ') === 'Data center | Industrial | Residential | Roads & infrastructure | Commercial | Civic & public | Other project',
  '0: the seven project-type labels', C0.map(c => c.label).join(' | '));
ok(C0.every(c => c.checked), '0: DEFAULT — all seven are checked');
ok(C0.every(c => c.tag === 'INPUT:checkbox'), '0: each is a REAL <input type=checkbox>');
ok(C0.every(c => c.shapeSvg), '0: each carries its pin-shape icon');
ok(C0[0].name === 'Data center projects, shown on map', '0: accessible name states the map effect', C0[0].name);
const grp = await page.evaluate(() => {
  const g = document.getElementById('mapkeyShapes');
  const h = document.getElementById(g.getAttribute('aria-describedby') || '');
  return { role: g.getAttribute('role'), name: g.getAttribute('aria-label'), help: h ? h.textContent.trim() : null };
});
ok(grp.role === 'group' && grp.name === 'Project type filters', '0: labelled group', JSON.stringify(grp));
ok(grp.help === 'Checked types are shown on the map.', '0: the governing rule is attached to the group', grp.help);

// ── 1. THE DROPDOWN IS GONE ─────────────────────────────────────────────────────────
const legacy = await page.evaluate(() => ({
  btn: !!document.querySelector('#typeFilterBtn'), menu: !!document.querySelector('#typeFilterMenu'),
  showTypes: /Show types/i.test(document.body.innerText), sh: document.querySelectorAll('#mapkeyShapes span.sh').length }));
ok(!legacy.btn && !legacy.menu && !legacy.showTypes && legacy.sh === 0,
  '1: no "Show types" dropdown survives anywhere', JSON.stringify(legacy));

// ── 2. TOGGLING ONE TYPE MOVES ONLY THAT TYPE ───────────────────────────────────────
const V0 = await visible();
ok(has(V0, /data center/) === 1 && has(V0, /industrial/) === 1 && has(V0, /commercial/) === 1
   && has(V0, /regulated facility/) === 1,
  '2: setup — one pin per project type, plus the EPA facility on its own', V0.join(' / '));
await clickType('data_center');
const V1 = await visible();
ok(has(V1, /data center/) === 0, '2: unchecking Data center removes the Data center pin');
ok(has(V1, /industrial/) === 1 && has(V1, /commercial/) === 1,
  '2: ...and moves NOTHING else', V1.join(' / '));
ok((await chips()).filter(c => !c.checked).map(c => c.id).join(',') === 'data_center',
  '2: exactly one chip is unchecked');
await clickType('data_center');
ok(has(await visible(), /data center/) === 1, '3: re-checking restores it');

await clickType('industrial');
const V2 = await visible();
ok(has(V2, /industrial/) === 0 && has(V2, /data center/) === 1 && has(V2, /commercial/) === 1,
  '3b: unchecking Industrial removes only Industrial', V2.join(' / '));
await clickType('industrial');

// ── 4. UNSELECTED LOOKS UNSELECTED, NOT DELETED ─────────────────────────────────────
await clickType('commercial');
const off = (await chips()).find(c => c.id === 'commercial');
const on = (await chips()).find(c => c.id === 'data_center');
ok(off.shapeSvg && Number(off.shapeOpacity) === 1, '4: an unchecked chip KEEPS its pin shape at full strength', off.shapeOpacity);
ok(off.strike === 'none', '4: ...is not struck through', off.strike);
ok(Number(off.chipOpacity) >= 0.9, '4: ...and is not dimmed to look disabled', off.chipOpacity);
ok(off.tick === on.tick, '4: the tick box is the same size in both states — no reflow', off.tick);
ok(off.tickVisible !== on.tickVisible, '4: ...but only the checked one paints its checkmark',
  off.tickVisible + ' vs ' + on.tickVisible);
ok(off.name === 'Commercial projects, hidden from map', '4: the accessible name follows the state', off.name);
await clickType('commercial');

// ── 5. AND LOGIC WITH STAGE ─────────────────────────────────────────────────────────
// Approved is checked and Data center is NOT: an approved data centre must stay hidden.
await clickStage('proposed'); await clickStage('lifecycle_unknown'); await clickStage('operating_now');
const VS = await visible();
ok(has(VS, /commercial/) === 0, '5: Stage alone filters — the PROPOSED commercial pin is gone');
ok(has(VS, /data center/) === 1 && has(VS, /industrial/) === 1,
  '5: ...and the approved pins remain', VS.join(' / '));
await clickType('data_center');
const VA = await visible();
ok(has(VA, /data center/) === 0,
  '5: AND LOGIC — Approved checked + Data center unchecked -> the approved data centre is HIDDEN', VA.join(' / '));
ok(has(VA, /industrial/) === 1, '5: ...while the approved industrial pin is untouched');
await clickType('data_center');
await clickStage('proposed'); await clickStage('lifecycle_unknown'); await clickStage('operating_now');
ok((await chips()).every(c => c.checked), '5: both dimensions restored');

// ── 6. ZERO TYPES SELECTED ──────────────────────────────────────────────────────────
for (const c of await chips()) await clickType(c.id);
ok((await chips()).every(c => !c.checked), '6: all seven can be unchecked');
const V6 = await visible();
ok(has(V6, /data center/) + has(V6, /industrial/) + has(V6, /commercial/) === 0,
  '6: no normal project pins remain', V6.join(' / '));
const n6 = await noteShown();
ok(n6.shown && /No project types are selected\./.test(n6.text), '6: a non-blocking note states the cause', n6.text);
ok(/Select all types\./.test(n6.text), '6: ...and carries a visible action', n6.text);
ok((await chips()).every(c => !c.checked), '6: nothing was silently re-enabled');

// ── 7. REGULATORY IS INDEPENDENT OF TYPE ────────────────────────────────────────────
ok(await page.evaluate(() => !!document.getElementById('regToggleBox').checked),
  '7: the Regulatory chip is untouched by every Type going off');
ok((await visible()).length > 0,
  '7: ...and the regulatory overlay is STILL DRAWN with no project type selected', (await visible()).join(' / '));
await setReg(false);
ok((await visible()).length === 0, '7: with regulatory off as well, the map is genuinely empty');
await setReg(true);

// ── 8. "Select all types" RESTORES ALL SEVEN ────────────────────────────────────────
await page.click('#typeSelectAll');
ok((await chips()).every(c => c.checked), '8: the action re-checks all seven');
ok(!(await noteShown()).shown, '8: ...and the note goes away');
ok(has(await visible(), /data center/) === 1, '8: ...and the pins return');

// ── 9. THE URL IS THE STATE ─────────────────────────────────────────────────────────
await clickType('industrial');
ok((await typesParam()) === 'data_center,residential,roads_infrastructure,commercial,civic_public,other_project',
  '9: ?types= carries the selection as stable IDs', await typesParam());
await load('&types=data_center,commercial');
const C9 = await chips();
ok(C9.filter(c => c.checked).map(c => c.id).join(',') === 'data_center,commercial',
  '9b: ?types= initialises state on load', C9.filter(c => c.checked).map(c => c.id).join(','));
const V9 = await visible();
ok(has(V9, /industrial/) === 0 && has(V9, /commercial/) === 1,
  '9b: ...and the map honours it before the first paint', V9.join(' / '));
await load('&types=');
ok((await chips()).every(c => !c.checked) && (await noteShown()).shown,
  '9c: an EMPTY ?types= is honoured as none-selected, distinct from the default');
await load('&types=commercial,not_a_type');
ok((await chips()).filter(c => c.checked).map(c => c.id).join(',') === 'commercial',
  '9d: an unrecognised id is dropped, not treated as a match');
// A stale ?stages= link must keep working beside the new parameter.
await load('&stages=approved&types=data_center');
const both = await page.evaluate(() => ({
  stages: Array.from(document.querySelectorAll('#mapkey .stagechip')).filter(c => c.querySelector('input').checked).map(c => c.getAttribute('data-stage-id')),
  types: Array.from(document.querySelectorAll('#mapkeyShapes .typechip')).filter(c => c.querySelector('input').checked).map(c => c.getAttribute('data-type-id')) }));
ok(both.stages.join(',') === 'approved' && both.types.join(',') === 'data_center',
  '9e: ?stages= and ?types= are read together, and the existing stages contract is unbroken', JSON.stringify(both));

// ── 10. REGULATORY URL STATE ────────────────────────────────────────────────────────
await load();
ok(await page.evaluate(() => !!document.getElementById('regToggleBox').checked),
  '10: no ?regulatory= -> the fail-open default (checked)');
await setReg(false);
ok((await page.evaluate(() => new URL(location.href).searchParams.get('regulatory'))) === '0',
  '10: unchecking writes regulatory=0');
await load('&regulatory=0');
ok(!(await page.evaluate(() => !!document.getElementById('regToggleBox').checked)),
  '10b: regulatory=0 initialises hidden');
await load('&regulatory=1');
ok(await page.evaluate(() => !!document.getElementById('regToggleBox').checked),
  '10c: regulatory=1 initialises shown');
await load('&regulatory=banana');
ok(await page.evaluate(() => !!document.getElementById('regToggleBox').checked),
  '10d: an unparseable value fails SAFE to the documented default');

// ── 11. HISTORY ─────────────────────────────────────────────────────────────────────
// Filter clicks use replaceState on purpose, so they add no entries. What must hold is
// that arriving at a URL through history restores the state that URL describes.
await load('&types=data_center');
await page.goto(base + '/homesignalmap.html?zip=20171&types=commercial', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
await page.waitForTimeout(600);
await page.goBack({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
await page.waitForTimeout(700);
ok((await chips()).filter(c => c.checked).map(c => c.id).join(',') === 'data_center',
  '11: Back restores the Type state its URL describes', (await chips()).filter(c => c.checked).map(c => c.id).join(','));
await page.goForward({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
await page.waitForTimeout(700);
ok((await chips()).filter(c => c.checked).map(c => c.id).join(',') === 'commercial',
  '11b: Forward restores the other one', (await chips()).filter(c => c.checked).map(c => c.id).join(','));

// ── 12. KEYBOARD AND TOUCH ──────────────────────────────────────────────────────────
// ⚠️ ESTABLISH THE STATE EXPLICITLY. Type selection persists in sessionStorage, so a bare
// load() inherits whatever the previous section left — which is correct behaviour (a bare
// load means "no ?types= was expressed", so the stored choice stands, and
// map1-all-types-off pins exactly that). A keyboard assertion must not depend on it.
await load('&types=data_center,industrial,residential,roads_infrastructure,commercial,civic_public,other_project');
ok((await chips()).every(c => c.checked), '12: setup — all seven checked before the keyboard test');
await page.evaluate(() => document.querySelector('#mapkeyShapes .typechip[data-type-id="industrial"] input').focus());
const foc = await page.evaluate(() => {
  const el = document.activeElement;
  return { isBox: !!(el && el.classList.contains('chipbox')),
    ring: getComputedStyle(el.closest('.typechip')).outlineStyle + ' ' + getComputedStyle(el.closest('.typechip')).outlineWidth };
});
ok(foc.isBox, '12: the Type checkbox is focusable by Tab order');
ok(/solid/.test(foc.ring), '12: ...with a visible focus indicator', foc.ring);
await page.keyboard.press('Space');
ok((await chips()).find(c => c.id === 'industrial').checked === false, '12: Space toggles the focused Type');
ok(has(await visible(), /industrial/) === 0, '12: ...and the map follows immediately, with no Apply step');
await page.keyboard.press('Space');
ok((await chips()).find(c => c.id === 'industrial').checked === true, '12: Space toggles it back');
const touch = await page.evaluate(() => {
  const c = document.querySelector('#mapkeyShapes .typechip');
  return { desktopH: Math.round(c.getBoundingClientRect().height),
           coarse: (() => { try { return matchMedia('(pointer:coarse)').matches; } catch (e) { return null; } })() };
});
ok(touch.desktopH >= 28, '12: the desktop chip is a usable target', touch.desktopH + 'px');

// ── 13. NO APPLY CONTROL, AND NO PAGE ERRORS ────────────────────────────────────────
ok(await page.evaluate(() => !/\b(Apply|Save changes|Confirm)\b/.test(document.body.innerText)),
  '13: no Apply / Save / Confirm control exists');
ok(pageErrors.length === 0, '13: no uncaught page errors', pageErrors.join(' | '));

await browser.close();
srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nmap1 type filter chips: seven checkbox chips, AND logic with Stage, '
  + 'zero-selected honoured, regulatory independent, and the URL round-trips.');
process.exit(fails ? 1 : 0);

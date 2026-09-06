// MAP 1 — THE TWO MODES A HOMEOWNER HAS TO BE ABLE TO TELL APART, driven in a real browser.
//
// Map 1 answers two different questions with the same canvas, and they are NOT two views of
// one dataset:
//
//   ENTIRE ZIP   — every development record inside the actual ZIP/ZCTA geography. No centre,
//                  no radius, no centroid. Where that geography does not exist yet, the page
//                  says "not measured yet" rather than substituting a circle.
//   NEAR HOME    — a geocoded street address plus a radius the resident chose.
//
// A resident who cannot tell which one they are looking at will read a ½-mile answer as a
// whole-ZIP answer, or the reverse. This suite asserts the SIGNALS that keep the two apart,
// and the one control that makes the pair usable at all: the route BACK from near-home to the
// whole ZIP. Without it, searching an address is a one-way door out of the ZIP view.
//
// Every network call is intercepted and answered from fixtures — no production service is
// touched. The ZIP payload is a `boundary_complete` authoritative read, so the ZIP half runs
// against the MEASURED state rather than the honest-empty one.
//
// Run: node test/map1-two-modes.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
const GEO = { match: { matchedAddress: '2200 CALDWELL LN, DEL VALLE, TX, 78617',
  lat: 30.215054966235, lng: -97.53885104845, zip: '78617', city: 'DEL VALLE', state: 'TX' } };
const REPORT = { address: '2200 CALDWELL LN, DEL VALLE, TX 78617', home: { lat: 30.99, lng: -97.99 },
  counts: { facilities: 1 }, sites: [
    { scope: 'point', label: 'ACME PLATING CO', registry_id: '110000123456', layer: 'industrial',
      url: 'https://echo.epa.gov/detailed-facility-report?fid=110000123456',
      lat: 30.2160, lng: -97.5400, src: 'EPA FRS' } ] };
const N5ROW = { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2021-0320D', feature_id: 'pt:1',
  provenance: 'proven_stored_point', distance_mi: 0.2, geometry_type: 'ST_Point',
  marker_lat: 30.21520, marker_lng: -97.53980, has_more: false };
const RPC_ROWS = { 0.5: [N5ROW], 1: [N5ROW], 2: [N5ROW], 5: [N5ROW] };
const PROJECTS = [{ source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2021-0320D',
  name: 'Caldwell Lane', type: 'Industrial', status: 'Approved', registry_id: 'austin-site-plan-cases',
  source_ref: 'https://abc.austintexas.gov/web/permit/public-search-other?t_selected_folderrsn=12774743',
  submitted_at: '2021-09-07', date_kind: 'filed', impact_score: 55, impact_dimensions: null }];
const ZIP_ROW = [{ zip: '78617', home_lat: 30.1745, home_lng: -97.6134, counts: { facilities: 1 },
  refreshed_at: '2026-09-01T00:00:00Z', paywall: false, facilities_unavailable: false, sites: [
    { scope: 'point', label: 'ZIP-ONLY FACILITY', registry_id: '110000555555',
      url: 'https://echo.epa.gov/x', lat: 30.1750, lng: -97.6140 }] }];
// A COMPLETE authoritative whole-ZIP read: two projects, one of them drawn as two markers
// (the LINE_MERGED grain), so the ZIP half exercises the measured state rather than an empty one.
const ZIP_AUTH = { zip: '78617', mode: 'authoritative', status: 'boundary_complete',
  projects: [
    { project_ref: 'p1', name: 'Del Valle logistics center', type: 'Industrial', status: 'Proposed',
      registry_id: 'austin-site-plan-cases', source_ref: 'https://example.gov/rec/p1',
      submitted_at: '2026-01-15', date_kind: 'filed', type_raw: 'Commercial - New Construction' },
    { project_ref: 'p2', name: 'FM 973 widening', type: 'Infrastructure', status: 'Approved',
      registry_id: 'txdot-projects-info-all', source_ref: 'https://example.gov/rec/p2',
      submitted_at: '2025-11-02', date_kind: 'filed', type_raw: 'Roadway' }],
  markers: [
    { project_ref: 'p1', lat: 30.1620, lng: -97.6600, marker_rule: 'POINT', marker_seq: 0 },
    { project_ref: 'p2', lat: 30.2050, lng: -97.5700, marker_rule: 'LINE_MERGED_COMPONENT_1', marker_seq: 0 },
    { project_ref: 'p2', lat: 30.1900, lng: -97.6400, marker_rule: 'LINE_MERGED_COMPONENT_2', marker_seq: 1 }] };
// The SAME ZIP with no authoritative geography. Proves the honest not-measured wording, which
// is what stops "0" from being read as "nothing is happening here".
const ZIP_AUTH_NOT_MEASURED = { zip: '78617', mode: 'authoritative', status: 'not_measured',
  projects: null, markers: null };
// AND the third state, which is the one an em-dash must NOT swallow: the ZIP was measured
// across its whole boundary and genuinely holds nothing. `null` is not `[]` — that
// distinction is rule 1 of lib/zip-authoritative.js and it has to survive to the screen.
const ZIP_AUTH_MEASURED_ZERO = { zip: '78617', mode: 'authoritative', status: 'boundary_complete',
  projects: [], markers: [] };
let AUTH = ZIP_AUTH;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));

const routeHandler = async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  const J = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('/functions/v1/geocode-address')) return J(GEO);
  if (url.includes('/rpc/n5_projects_within_radius')) {
    const b = JSON.parse(route.request().postData() || '{}');
    return J(RPC_ROWS[b.p_radius_mi] || []);
  }
  if (url.includes('/rpc/app_zip_projects_markers')) return J(AUTH);
  if (url.includes('/functions/v1/get-address-report')) return J(REPORT);
  if (url.includes('/rest/v1/app_projects')) return J(PROJECTS);
  if (url.includes('/rest/v1/development_reports')) return J(ZIP_ROW);
  if (url.includes('/rest/v1/')) return J([]);
  // Leaflet is REAL — this suite reads the marker layer and the home pin. Served from a
  // local copy WHEN ONE RESOLVES, else from the CDN the page already names. The repo has no
  // package.json, and CI installs playwright ALONE into a scratch dir outside the checkout,
  // so `node_modules/leaflet` does not exist on the runner: a hardcoded path throws ENOENT
  // inside the route handler, which kills the run before a single assertion prints. Same
  // resolve-or-continue shape as test/map1-dual-identity.browser.test.mjs.
  if (url.includes('leaflet@1.9.4/dist/leaflet.js') || url.includes('leaflet@1.9.4/dist/leaflet.css')) {
    const css = url.endsWith('.css');
    let local = null;
    try { local = require.resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch (e) { local = null; }
    if (!local) return route.continue();
    return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript',
      body: await readFile(local, 'utf8') });
  }
  if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200,
    contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript',
    body: url.endsWith('.css') ? '' : 'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(){return Promise.resolve({data:[],error:null});},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};' });
  if (url.includes('tile.openstreetmap')) return route.fulfill({ status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  return J({});
};
await page.route('**/*', route => routeHandler(route));

// Everything a resident can read or click that says WHICH MODE they are in.
const screen = () => page.evaluate(() => {
  const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };
  const shown = (s) => { const e = document.querySelector(s); if (!e) return null;
    const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
  return {
    heading: t('#withinLbl'), scopeLine: t('#rAddr'), mapCap: t('.map-cap'),
    h1: t('.head h1'), eyebrow: t('#eyebrow'), sub: t('.sub'), hint: t('.hint'),
    kDev: t('#kDev'), kFac: t('#kFac'), freshLine: t('#freshLine'),
    radiusShown: shown('#radSel'), fromHomeShown: shown('#homeViewBtn'),
    backShown: shown('#backZip'), backText: t('#backZip'),
    homePins: document.querySelectorAll('.homepin').length,
    cDev: t('#cDev'), addrInput: (document.getElementById('addr') || {}).value,
    n5: (window.__HS_SITES || []).filter(s => s.n5_feature_id).length,
    dev: (window.__HS_SITES || []).filter(s => s.scope === 'point' && s.relevance === 'development').length,
    url: location.search
  };
});
const waitZip = () => page.waitForFunction(
  () => Array.isArray(window.__HS_SITES) && !(window.__HS_SITES || []).some(s => s.n5_feature_id)
        && document.getElementById('results') && getComputedStyle(document.getElementById('results')).display !== 'none',
  null, { timeout: 30000 });
const waitAddr = () => page.waitForFunction(
  () => (window.__HS_SITES || []).some(s => s.n5_feature_id), null, { timeout: 30000 });

// ══════════════ 1. ENTIRE ZIP — say ALL, and say it is a boundary, not a circle ══════════════
await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitZip(); await page.waitForTimeout(600);
let z = await screen();
ok(/^All development across ZIP 78617$/.test(z.heading || ''),
  '1a the heading states the ENTIRE ZIP: "All development across ZIP <zip>"', z.heading);
ok(/78617/.test(z.h1 || '') && /Development overview/i.test(z.eyebrow || ''),
  '1a2 the page H1 names the ZIP and the kicker calls it an overview', { h1: z.h1, eyebrow: z.eyebrow });
ok(/across ZIP 78617/i.test(z.sub || ''), '1a3 the standfirst is scoped to the ZIP', z.sub);
ok(/whole ZIP boundary, not a radius around its centre/i.test(z.scopeLine || ''),
  '1b the scope line rules out the centroid-and-radius reading in words', z.scopeLine);
ok(/^All development across/i.test(z.mapCap || ''),
  '1c the MAP caption says the same thing as the heading', z.mapCap);
ok(/across this ZIP/i.test(z.kDev || ''), '1d the development counter is scoped to the ZIP', z.kDev);
ok(/^Nearby regulated facilities$/i.test(z.kFac || ''),
  '1e the facility counter still says NEARBY — it is not a whole-ZIP claim', z.kFac);
ok(z.dev === 3, '1f all three authoritative markers are drawn', z.dev);
ok(/2 projects across the whole of ZIP 78617/.test(z.freshLine || ''),
  '1g the count is stated as PROJECTS across the whole ZIP, not markers', z.freshLine);
ok(/^\d+$/.test((z.cDev || '').trim()),
  '1h a MEASURED ZIP prints a real development number', z.cDev);

// The three affordances that would imply a centre. None may exist in ZIP mode.
ok(z.radiusShown === false, '2a no radius control in ZIP mode');
ok(z.fromHomeShown === false, '2b no "From home" 3D camera in ZIP mode (there is no home)');
ok(z.homePins === 0, '2c no HOME pin in ZIP mode');
ok(z.backShown === false, '2d no "back to the ZIP" control while already in the ZIP view');

// ══════════════ 3. NEAR HOME — name the radius AND the address, in one sentence ══════════════
await page.fill('#addr', '2200 Caldwell Ln, Del Valle, TX 78617');
await page.click('#go');
await waitAddr(); await page.waitForTimeout(600);
let a = await screen();
ok(/^Showing development within .+ of$/.test(a.heading || ''),
  '3a the heading names the radius and points at the address below it', a.heading);
ok(/2200 CALDWELL LN/.test(a.scopeLine || ''), '3b the address is the stated centre', a.scopeLine);
ok(/of this address/i.test(a.mapCap || ''),
  '3c the map caption names the radius and the address, never "this home"', a.mapCap);
ok(a.radiusShown === true, '3d the radius control is available in address mode');
ok(a.homePins === 1, '3e HOME is pinned at the geocoded address');
ok(!/across ZIP/i.test(a.heading || ''), '3f whole-ZIP wording does not leak into address mode', a.heading);
// THE LARGEST TYPE ON THE PAGE HAS TO AGREE WITH THE RESULTS UNDER IT. Arriving here from a
// ZIP view once left the H1 reading "ZIP 78617" over near-home results — the single most
// likely way a resident answers "which view am I in?" wrongly.
ok(!/ZIP 78617/.test(a.h1 || ''), '3g the H1 no longer makes a whole-ZIP claim', a.h1);
ok(/around this address/i.test(a.h1 || ''), '3h ...it names the address view', a.h1);
ok(/Near-home view/i.test(a.eyebrow || ''), '3i the kicker names the mode', a.eyebrow);
ok(!/across ZIP/i.test(a.sub || ''), '3j the standfirst drops the whole-ZIP claim too', a.sub);
ok(/go back to the whole ZIP/i.test(a.hint || ''),
  '3k the hint points at the way back, which is on screen here', a.hint);

// ══════════════ 4. THE WAY BACK — address mode must not be a one-way door ══════════════
ok(a.backShown === true, '4a a way back to the whole ZIP is offered', a.backText);
ok(/^← Back to all development in ZIP 78617$/.test(a.backText || ''),
  '4b ...and it names the ZIP it returns to', a.backText);

// ══════════════ 5. THE RADIUS CONTROL CHANGES THE STATED SCOPE ══════════════
await page.click('#radSel button[data-r="5"]');
await waitAddr(); await page.waitForTimeout(900);
let a5 = await screen();
ok(/within 5 miles of$/.test(a5.heading || ''), '5a the heading states the NEW radius', a5.heading);
ok(/within 5 miles of this address/i.test(a5.mapCap || ''),
  '5b the map caption restates the new radius too — no stale number survives', a5.mapCap);
ok(/^← Back to all development in ZIP 78617$/.test(a5.backText || ''),
  '5c the way back survives a radius change', a5.backText);

// ══════════════ 6. THE ROUND TRIP, through the page itself ══════════════
await page.click('#backZip');
await waitZip(); await page.waitForTimeout(600);
let b = await screen();
ok(/^All development across ZIP 78617$/.test(b.heading || ''), '6a the whole-ZIP view is restored', b.heading);
ok(b.n5 === 0, '6b no address-radius result survives into the ZIP view', b.n5);
ok(b.homePins === 0 && b.radiusShown === false && b.fromHomeShown === false,
  '6c every address-mode affordance is withdrawn again',
  { homePins: b.homePins, radius: b.radiusShown, fromHome: b.fromHomeShown });
ok(b.backShown === false, '6d the way-back control hides itself once it has been used', b.backShown);
ok(/[?&]zip=78617/.test(b.url || '') && !/[?&]addr=/.test(b.url || ''),
  '6e the URL follows the view, so a refresh or a shared link lands on the whole ZIP', b.url);
ok(b.dev === 3, '6f the whole-ZIP development set is back on the map', b.dev);
// AUTHORIZED CHANGE D — RETURNING CLEARS ADDRESS STATE, it does not merely re-render over it.
ok((b.addrInput || '') === '',
  '6g the searched address is cleared, so no address state survives the return', b.addrInput);
ok(!/canonical project|within \d/.test(b.freshLine || ''),
  '6h no address-radius coverage note survives the return', b.freshLine);
ok(/78617/.test(b.h1 || '') && /Development overview/i.test(b.eyebrow || '')
   && /across ZIP 78617/i.test(b.sub || ''),
  '6g the H1, kicker and standfirst all return to the whole-ZIP wording',
  { h1: b.h1, eyebrow: b.eyebrow });

// ══════════════ 7. A ZIP NOBODY HAS MEASURED SAYS SO — "0" is never left to speak for itself ══════════════
AUTH = ZIP_AUTH_NOT_MEASURED;
await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitZip(); await page.waitForTimeout(600);
let nm = await screen();
ok(/is not measured yet/i.test(nm.freshLine || ''),
  '7a a ZIP with no authoritative geography says "not measured yet"', nm.freshLine);
ok(/will not estimate it from a circle around the ZIP centre/i.test(nm.freshLine || ''),
  '7b ...and says explicitly that it will not be estimated from a circle', nm.freshLine);
ok(/Enter your street address/i.test(nm.freshLine || ''),
  '7c ...and offers the address view, which is the one thing that still works there', nm.freshLine);
ok(nm.dev === 0, '7d nothing is drawn as development for an unmeasured ZIP', nm.dev);
ok(/^All development across ZIP 78617$/.test(nm.heading || ''),
  '7e the heading is unchanged — the SCOPE claim is honest either way', nm.heading);
// AUTHORIZED CHANGE A. The page discards the cached report's radius-derived development on an
// unmeasured ZIP rather than passing it off as whole-ZIP, so the surviving count is 0 because
// it was thrown away. Printing "0" beside "not measured yet" asserts a measured zero.
ok((nm.cDev || '').trim() === '\u2014',
  '7f the development counter shows UNKNOWN, not an authoritative 0', nm.cDev);

// ══════════════ 10. MEASURED ZERO IS A DIFFERENT FACT, AND MUST STAY DIFFERENT ══════════════
// The paired control for 7f: a blanket em-dash would satisfy it while destroying every ZIP
// that was really measured and really holds nothing. `null` is not `[]` (zip-authoritative
// rule 1), and the two have to be distinguishable on screen, not just in the payload.
AUTH = ZIP_AUTH_MEASURED_ZERO;
await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitZip(); await page.waitForTimeout(600);
const mz = await screen();
ok((mz.cDev || '').trim() === '0',
  '10a a MEASURED ZIP holding nothing prints a real 0 — the em dash is not blanket', mz.cDev);
ok(/No qualifying development records across ZIP 78617/.test(mz.freshLine || ''),
  '10b ...and says it is a measurement of the whole ZIP, not an empty search', mz.freshLine);
ok(!/not measured yet/i.test(mz.freshLine || ''),
  '10c ...and is never described as unmeasured', mz.freshLine);
ok(mz.dev === 0, '10d nothing is drawn, which is the honest answer here', mz.dev);
ok(/^All development across ZIP 78617$/.test(mz.heading || ''),
  '10e the scope claim is the same in all three ZIP states', mz.heading);

// ══════════════ 8. A DIRECT ADDRESS VISIT OFFERS NO BACK LINK IT CANNOT HONOUR ══════════════
// A FRESH CONTEXT, not another goto(): the page's boot deliberately reuses a ZIP the resident
// has already viewed (HS.hasViewedZipContext), which is stored per browser profile. Reusing
// this context would silently re-enter ZIP mode and the assertion would be measuring the wrong
// thing — the first version of this check did exactly that and reported a false defect.
const fresh = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const p2 = await fresh.newPage();
const freshErrors = [];
p2.on('pageerror', e => freshErrors.push(String(e).slice(0, 200)));
await p2.route('**/*', route => routeHandler(route));
await p2.goto(base + '/homesignalmap.html', { waitUntil: 'domcontentloaded' });
await p2.waitForSelector('#addr');
const enteredZipMode = await p2.evaluate(() => document.body.classList.contains('zipmode'));
await p2.fill('#addr', '2200 Caldwell Ln, Del Valle, TX 78617');
await p2.click('#go');
await p2.waitForFunction(() => (window.__HS_SITES || []).some(s => s.n5_feature_id), null, { timeout: 30000 });
await p2.waitForTimeout(600);
const d = await p2.evaluate(() => { const e = document.getElementById('backZip');
  const cs = e ? getComputedStyle(e) : null;
  return { shown: !!cs && cs.display !== 'none' && cs.visibility !== 'hidden',
           text: e ? e.textContent.trim() : null }; });
ok(enteredZipMode === false, '8a the control case really is a first visit with no ZIP view', enteredZipMode);
ok(d.shown === false,
  '8b a resident who never saw a ZIP view is not offered a "back" to one', d.text);
const hint2 = await p2.evaluate(() => { const e = document.querySelector('.hint'); return e ? e.textContent.trim() : null; });
ok(!/go back to the whole ZIP/i.test(hint2 || ''),
  '8c ...and the hint does not point at a control that is not on screen', hint2);

ok(pageErrors.concat(freshErrors).length === 0,
  '9 the whole two-mode journey ran with no fatal client error', pageErrors.concat(freshErrors));

console.log('='.repeat(72));
console.log(fails ? 'FAILS: ' + fails : 'ALL PASS');
await browser.close();
server.close();
if (fails) process.exit(1);

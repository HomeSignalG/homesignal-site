// THE USER JOURNEY THROUGH THE APP AROUND MAP 1 — driven in a real browser.
//
// Every earlier gate tested the MAP. None tested the app around it, which is how two
// founder-visible defects reached production on 2026-09-04:
//
//   D1  homesignalmap.html declared <body data-nav="dev">, so the sidebar highlighted
//       "Development & Impact" while the resident was on Maps, and Maps never lit up
//       anywhere. Clicking Maps from Alerts looked like it bounced back to Development.
//   D2  the global location control printed the SAVED HOME on every page regardless of
//       what the page was showing, so a Del Valle home read "Your home · 13313 COOMES DR"
//       beside a Denver map at ?zip=80210 — two locations, nothing saying which was current.
//
// Nothing here touches production: the static site is served locally and every outbound
// request is answered from fixtures. The fixtures are shaped like production's answers;
// the assertions are about NAVIGATION and LOCATION STATE, not about data values.
//
// Run: node test/user-journey.browser.test.mjs
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};
const info = (k, v) => console.log('   · ' + k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));

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

// ── fixtures ────────────────────────────────────────────────────────────────────────────
const GEO = { match: { matchedAddress: '2200 CALDWELL LN, DEL VALLE, TX, 78617',
  lat: 30.215054966235, lng: -97.53885104845, zip: '78617', city: 'DEL VALLE', state: 'TX' } };
const REPORT = {
  address: '2200 CALDWELL LN, DEL VALLE, TX 78617',
  home: { lat: 30.2150, lng: -97.5388 },
  counts: { facilities: 1 },
  sites: [{ scope: 'point', label: 'ACME PLATING CO', registry_id: '110000123456',
            url: 'https://echo.epa.gov/x', lat: 30.2160, lng: -97.5400, e: 0.3, n: 0.06, src: 'EPA FRS' }]
};
const RPC_RADIUS = [{ source_key: 'socrata:austin:SP-1', feature_id: 'pt:1',
  registry_id: 'austin-site-plan-cases', provenance: 'proven_stored_point',
  distance_mi: 0.02, geometry_type: 'ST_Point', marker_lat: 30.2152, marker_lng: -97.5391, has_more: false }];
const PROJECTS = [
  { source_key: 'socrata:austin:SP-1', name: 'Caldwell Lane', type: 'Industrial', status: 'Approved',
    registry_id: 'austin-site-plan-cases', source_ref: 'https://abc.austintexas.gov/x',
    submitted_at: '2021-09-07', date_kind: 'filed', impact_score: null, impact_dimensions: null },
  { source_key: 'arcgis:denver:D-1', name: 'Denver mixed-use block', type: 'Commercial', status: 'Proposed',
    registry_id: 'denver-cases', source_ref: 'https://example.gov/denver/1',
    submitted_at: '2026-01-04', date_kind: 'filed', impact_score: null, impact_dimensions: null }
];
// authoritative whole-ZIP membership, per ZIP (the shape app_zip_projects_markers returns)
const ZIP_AUTH = {
  '78617': { zip: '78617', mode: 'development', status: 'boundary_complete',
    projects: [PROJECTS[0]],
    markers: [{ project_ref: 'socrata:austin:SP-1', lat: 30.2152, lng: -97.5391,
                marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] },
  '80210': { zip: '80210', mode: 'development', status: 'boundary_complete',
    projects: [PROJECTS[1]],
    markers: [{ project_ref: 'arcgis:denver:D-1', lat: 39.6800, lng: -104.9600,
                marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] }
};
ZIP_AUTH['78617'].projects[0].project_ref = 'socrata:austin:SP-1';
ZIP_AUTH['80210'].projects[0].project_ref = 'arcgis:denver:D-1';
// A FACILITIES-ONLY ZIP: its whole-ZIP geography IS measured and holds no development, while
// the EPA layer still has facilities near it. This is the state that used to say "Showing
// EPA-registered facilities for this ZIP" - the page's strongest whole-ZIP facility claim,
// on exactly the pages where facilities are all there is.
ZIP_AUTH['84334'] = { zip: '84334', mode: 'development', status: 'boundary_complete',
  projects: [], markers: [] };
const ZIP_ROW = {
  '78617': [{ zip: '78617', home_lat: 30.1745, home_lng: -97.6134, counts: { facilities: 1 },
    refreshed_at: '2026-09-01T00:00:00Z', paywall: false, facilities_unavailable: false,
    sites: [{ scope: 'point', label: 'ZIP FACILITY', registry_id: '110000555555',
              url: 'https://echo.epa.gov/y', lat: 30.1750, lng: -97.6140, e: 0.05, n: 0.03 }] }],
  '84334': [{ zip: '84334', home_lat: 41.7166, home_lng: -112.1500, counts: { facilities: 6 },
    refreshed_at: '2026-09-01T00:00:00Z', paywall: false, facilities_unavailable: false,
    sites: [{ scope: 'point', label: 'RIVERSIDE GRAIN CO', registry_id: '110000888888',
              url: 'https://echo.epa.gov/w', lat: 41.7180, lng: -112.1520, e: 0.1, n: 0.1 }] }],
  '80210': [{ zip: '80210', home_lat: 39.6796, home_lng: -104.9611, counts: { facilities: 1 },
    refreshed_at: '2026-09-01T00:00:00Z', paywall: false, facilities_unavailable: false,
    sites: [{ scope: 'point', label: 'DENVER FACILITY', registry_id: '110000777777',
              url: 'https://echo.epa.gov/z', lat: 39.6800, lng: -104.9620, e: 0.05, n: 0.03 }] }]
};
const COMMUNITIES = {
  '78617': [{ name: 'Del Valle (78617)', level: 'zip', county: 'Travis', state: 'TX' }],
  '80210': [{ name: 'Denver (80210)', level: 'zip', county: 'Denver', state: 'CO' }]
};
// The founder's real saved home: a REAL home (not the seeded demo persona), in Del Valle.
const SAVED_HOME = { id: 'h1', label: 'Your home', tag: 'Your home', address: '13313 COOMES DR',
  city: 'Del Valle', state: 'TX', zip: '78617', lat: 30.1760, lng: -97.6098 };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));

const zipOf = (url) => (url.match(/(?:zip=eq\.|%7B)(\d{5})/) || [])[1] || null;

await page.route('**/*', async (route) => {
  const url = route.request().url();
  const post = () => { try { return JSON.parse(route.request().postData() || '{}'); } catch { return {}; } };
  if (url.startsWith(base)) return route.continue();
  if (url.includes('/functions/v1/geocode-address'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GEO) });
  if (url.includes('/functions/v1/get-address-report'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REPORT) });
  if (url.includes('/rpc/n5_projects_within_radius'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RPC_RADIUS) });
  if (url.includes('/rpc/app_zip_projects_markers')) {
    const z = String(post().p_zip || '');
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(ZIP_AUTH[z] || { zip: z, mode: 'development', status: 'not_measured', projects: null, markers: null }) });
  }
  if (url.includes('/rest/v1/development_reports'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ZIP_ROW[zipOf(url)] || []) });
  if (url.includes('/rest/v1/communities'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COMMUNITIES[zipOf(url)] || []) });
  if (url.includes('/rest/v1/app_projects'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROJECTS) });
  if (url.includes('/rest/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  // Leaflet is REAL here — the HOME pin and the marker layer are what several of these
  // assertions read. Served from a local copy when node can resolve one (the sandbox has
  // no egress), and otherwise fetched from the CDN the page already names (CI runners have
  // network but no leaflet install). If neither works the map simply fails to render and
  // the assertions go red, which is the correct outcome — never a silent skip.
  if (url.includes('leaflet@1.9.4/dist/leaflet.js') || url.includes('leaflet@1.9.4/dist/leaflet.css')) {
    const css = url.endsWith('.css');
    let local = null;
    try { local = require.resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch (e) { local = null; }
    if (!local) return route.continue();
    return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript',
      body: await readFile(local, 'utf8') });
  }
  if (url.includes('cdn.jsdelivr.net')) {
    const kind = url.endsWith('.css') ? 'text/css' : 'text/javascript';
    return route.fulfill({ status: 200, contentType: kind, body: kind === 'text/css' ? '' : 'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(){return Promise.resolve({data:null,error:null});},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};' });
  }
  if (url.includes('tile.openstreetmap'))
    return route.fulfill({ status: 200, contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

// What the shared chrome is telling the resident, right now.
const chrome = () => page.evaluate(() => {
  const on = [].slice.call(document.querySelectorAll('.nav a.on'));
  const el = document.getElementById('locLabel');
  return {
    activeTokens: on.map(a => a.getAttribute('data-nav')),
    activeLabels: on.map(a => a.textContent.trim().replace(/\s+/g, ' ')),
    locLabel: el ? el.textContent.trim() : null,
    kDev: (document.getElementById('kDev') || {}).textContent || null,
    kFac: (document.getElementById('kFac') || {}).textContent || null,
    totalTileShown: (() => { const t = document.getElementById('ccTot');
      return !!t && getComputedStyle(t).display !== 'none'; })(),
    covNote: (document.getElementById('covNote') || {}).textContent || '',
    mapCap: (document.querySelector('.map-cap') || {}).textContent || '',
    hero: (document.querySelector('.sub') || {}).textContent || '',
    facMarkers: (window.__HS_SITES || []).filter(x => x.scope === 'point' && x.relevance !== 'development').length,
    devMarkers: (window.__HS_SITES || []).filter(x => x.scope === 'point' && x.relevance === 'development').length,
    locTitle: (() => { const w = el && el.closest('.loc'); return w ? (w.getAttribute('title') || '') : ''; })(),
    savedHome: (window.HS && HS.state && HS.state.activeProperty)
      ? { address: HS.state.activeProperty.address, zip: HS.state.activeProperty.zip } : null,
    path: location.pathname, search: location.search
  };
});
const waitShell = () => page.waitForFunction(() => !!document.querySelector('.nav a'), null, { timeout: 30000 });
// Sign-in state cannot be created offline, so the REAL saved home is installed directly into
// the shipped state and repainted through the shipped path (HS.setViewLabel -> paintTopbar).
const installSavedHome = (home) => page.evaluate((h) => {
  HS.state.properties = [h];
  HS.state.activePropId = h.id;
  // Repaint through the SHIPPED path only (setViewLabel -> paintTopbar): nudge the label
  // to a different value and back, so nothing here reimplements what the chrome does.
  const cur = HS.state.viewLabel, precise = HS.state.viewLabelPrecise;
  HS.setViewLabel(cur + ' ·', { precise: precise });
  HS.setViewLabel(cur, { precise: precise });
}, home);

console.log('='.repeat(78));
console.log('USER JOURNEY — navigation identity + location context');
console.log('='.repeat(78));

// ═══ 1. Development & Impact identifies itself ═══
await page.goto(base + '/development.html?data=seed&zip=78617', { waitUntil: 'domcontentloaded' });
await waitShell();
let c = await chrome();
info('development.html', c.activeTokens);
ok(c.activeTokens.length === 1, '1 development.html highlights exactly one sidebar item', c.activeLabels);
ok(c.activeTokens[0] === 'dev', '1 ...and it is Development & Impact', c.activeTokens);
ok(c.activeTokens.indexOf('maps') < 0, '1 Maps is NOT active on Development & Impact', c.activeTokens);

// ═══ 2. Map 1 identifies itself ═══
await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitShell();
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
c = await chrome();
info('homesignalmap.html', c.activeTokens);
ok(c.activeTokens.length === 1, '2 Map 1 highlights exactly one sidebar item', c.activeLabels);
ok(c.activeTokens[0] === 'maps', '2 ...and it is Maps', c.activeTokens);
ok(c.activeTokens.indexOf('dev') < 0, '2 Development & Impact is NOT active on Map 1', c.activeTokens);

// ═══ 6. ...while the proven ZIP contract is untouched ═══
let z = await page.evaluate(() => ({
  within: (document.getElementById('withinLbl') || {}).textContent,
  radiusVisible: (() => { const e = document.getElementById('radSel'); if (!e) return false;
    const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; })(),
  homePins: document.querySelectorAll('.homepin').length,
  devPoints: (window.__HS_SITES || []).filter(s => s.scope === 'point' && s.relevance === 'development').length,
  authoritative: (window.__HS_SITES || []).filter(s => s.zip_authoritative).length,
  distances: (window.__HS_SITES || []).filter(s => s.distance_mi != null).length
}));
info('ZIP 78617 map state', z);
ok(/across ZIP 78617/i.test(z.within || ''), '6 ZIP mode still says it is showing the whole ZIP', z.within);
ok(z.radiusVisible === false, '6 no address-radius control in ZIP mode');
ok(z.homePins === 0, '6 no HOME pin in ZIP mode');
ok(z.devPoints > 0 && z.devPoints === z.authoritative,
  '6 every ZIP development point is authoritative whole-ZIP geometry', z);
ok(z.distances === 0, '6 no radius distance is attached in ZIP mode', z.distances);

// ═══ 3/4/5. Reaching Maps from other sections ═══
for (const [origin, label] of [['alerts.html', '3 Alerts'], ['development.html', '4 Development & Impact'],
                               ['dashboard.html', '5 Dashboard']]) {
  await page.goto(base + '/' + origin + '?data=seed&zip=78617', { waitUntil: 'domcontentloaded' });
  await waitShell();
  const href = await page.getAttribute('.nav a[data-nav="maps"]', 'href');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    page.click('.nav a[data-nav="maps"]')
  ]);
  await waitShell();
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 }).catch(() => {});
  c = await chrome();
  info(label + ' -> Maps', { href, landed: c.path + c.search, active: c.activeTokens });
  ok(/^homesignalmap\.html/.test(href || ''), label + ' -> the Maps entry points at Map 1', href);
  ok(/\/homesignalmap\.html$/.test(c.path), label + ' -> lands on Map 1', c.path);
  ok(c.activeTokens.length === 1 && c.activeTokens[0] === 'maps',
    label + ' -> Maps is the active item after the page settles', c.activeTokens);
  ok(c.activeTokens.indexOf('dev') < 0, label + ' -> Development & Impact is NOT active', c.activeTokens);
}

// ═══ 7. A saved home in Del Valle, a map of Denver ═══
// The founder's exact repro. The saved home must survive, and must NOT be presented as
// the geography on screen.
await page.goto(base + '/homesignalmap.html?zip=80210', { waitUntil: 'domcontentloaded' });
await waitShell();
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
await installSavedHome(SAVED_HOME);
await page.waitForTimeout(300);
c = await chrome();
info('ZIP 80210 with a Del Valle saved home', { loc: c.locLabel, saved: c.savedHome, title: c.locTitle });
ok(c.locLabel && c.locLabel.indexOf('13313 COOMES DR') < 0,
  '7 the Del Valle home is NOT presented as the current geography on a Denver ZIP', c.locLabel);
ok(/^Viewing ·/.test(c.locLabel || ''), '7 the control names the CURRENT VIEW', c.locLabel);
ok(/80210/.test(c.locLabel || ''), '7 ...and names the ZIP on screen', c.locLabel);
ok(!!(c.savedHome && c.savedHome.address === '13313 COOMES DR'),
  '7 the saved home is still saved (unchanged, still the active property)', c.savedHome);
ok(/13313 COOMES DR/.test(c.locTitle || ''),
  '7 ...and is still named in the switcher tooltip, one tap away', c.locTitle);
ok(c.activeTokens.length === 1 && c.activeTokens[0] === 'maps', '7 Maps is still the active item');

// ═══ 7b. POSITIVE CONTROL — on the home's own ZIP it is still "Your home" ═══
await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitShell();
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
await installSavedHome(SAVED_HOME);
await page.waitForTimeout(300);
c = await chrome();
info('ZIP 78617 with the same saved home', c.locLabel);
ok(/^Your home · 13313 COOMES DR/.test(c.locLabel || ''),
  '7b on the home\'s OWN ZIP the control still says "Your home"', c.locLabel);

// ═══ 8. Address mode still reaches the established experience ═══
await page.fill('#addr', '2200 CALDWELL LN, DEL VALLE, TX 78617');
await page.click('#go');
await page.waitForFunction(() => (window.__HS_SITES || []).some(s => s.n5_feature_id), null, { timeout: 60000 });
await page.waitForTimeout(500);
let a = await page.evaluate(() => ({
  within: (document.getElementById('withinLbl') || {}).textContent,
  radiusVisible: (() => { const e = document.getElementById('radSel'); if (!e) return false;
    const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; })(),
  homePins: document.querySelectorAll('.homepin').length,
  canonical: (window.__HS_SITES || []).filter(s => s.n5_feature_id).length
}));
c = await chrome();
info('address mode', { ...a, loc: c.locLabel });
ok(/within/i.test(a.within || ''), '8 address mode states the radius', a.within);
ok(a.radiusVisible === true, '8 the radius control is available in address mode');
ok(a.homePins === 1, '8 HOME is pinned at the geocoded address');
ok(a.canonical > 0, '8 canonical radius results render', a.canonical);
ok(/CALDWELL/i.test(c.locLabel || ''), '8 the current view follows the searched address', c.locLabel);

// ═══ 9. ZIP -> address -> ZIP: the label follows the active view, nothing stale ═══
await page.goto(base + '/homesignalmap.html?zip=80210', { waitUntil: 'domcontentloaded' });
await waitShell();
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
await installSavedHome(SAVED_HOME);
await page.waitForTimeout(300);
c = await chrome();
const back = await page.evaluate(() => ({
  within: (document.getElementById('withinLbl') || {}).textContent,
  homePins: document.querySelectorAll('.homepin').length,
  stale: (window.__HS_SITES || []).filter(s => s.n5_feature_id).length
}));
info('back to ZIP 80210', { loc: c.locLabel, ...back });
ok(/80210/.test(c.locLabel || '') && !/CALDWELL/i.test(c.locLabel || ''),
  '9 returning to a ZIP drops the address from the current view', c.locLabel);
ok(/across ZIP 80210/i.test(back.within || ''), '9 ...and the page is back in whole-ZIP mode', back.within);
ok(back.stale === 0, '9 no address-radius result survives into ZIP mode', back.stale);
ok(back.homePins === 0, '9 no HOME pin in ZIP mode');
ok(!!(c.savedHome && c.savedHome.address === '13313 COOMES DR'),
  '9 the saved home survived the whole journey', c.savedHome);

// ═══ 10. F1 — TWO SCOPES ON ONE SCREEN, NAMED SEPARATELY ═══
// Development is measured across the whole ZIP. Facilities are an EPA query AROUND the ZIP:
// measured 2026-09-05 over the 50 ZIPs that have authoritative boundaries, 269 of 610
// facilities shown sat outside the ZIP whose page showed them, and the search circle covered
// 52.5% of the ZIP on average. So the page may never describe facilities as being in, for or
// across the ZIP, and may not add the two sets into one total.
const WHOLE_ZIP_FACILITY_CLAIM = /(facilit\w*[^.]{0,80}\b(?:for|in|across)\s+(?:this|the)\s+ZIP)|((?:for|in|across)\s+(?:this|the)\s+ZIP[^.]{0,80}\bfacilit)/i;

console.log('\n10. F1 — ZIP mode names its two geographic scopes');
await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitShell();
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
await page.waitForTimeout(500);
c = await chrome();
const zc = await page.evaluate(() => ({ dev: (document.getElementById('cDev')||{}).textContent,
  fac: (document.getElementById('cFac')||{}).textContent }));
info('ZIP scope copy', { kDev: c.kDev, kFac: c.kFac, totalTileShown: c.totalTileShown, mapCap: c.mapCap, counts: zc });
ok(/across this ZIP/i.test(c.kDev || ''), '10a development is described as ACROSS this ZIP', c.kDev);
ok(/^Nearby regulated facilities$/i.test((c.kFac || '').trim()),
  '10b facilities are described as NEARBY, not as a ZIP measurement', c.kFac);
ok(!WHOLE_ZIP_FACILITY_CLAIM.test(c.kFac + ' ' + c.covNote + ' ' + c.mapCap + ' ' + c.hero),
  '10c no ZIP-mode string claims facilities are for/in/across this ZIP',
  { kFac: c.kFac, covNote: c.covNote, mapCap: c.mapCap, hero: c.hero });
ok(c.totalTileShown === false,
  '10d ZIP mode shows NO combined total (whole-ZIP development + nearby facilities is not a number)');
ok(/nearby facilities for context/i.test(c.mapCap || ''),
  '10e the map caption says the two marker classes have different scopes', c.mapCap);
ok(c.devMarkers > 0, '10f development markers still render in ZIP mode', c.devMarkers);
ok(c.facMarkers > 0, '10g facility markers still render in ZIP mode', c.facMarkers);
// Both counters must still RENDER a number - this change touched labels and one tile's
// visibility, never a count. (Their VALUES are proven against the drawn sets by the
// market-readiness gate's A8/A9, and against production by the live proof.)
ok(/^\d+$/.test((zc.dev || '').trim()), '10h the development counter still renders a number', zc.dev);
ok(/^\d+$/.test((zc.fac || '').trim()) && Number(zc.fac) > 0,
  '10i the facility counter still renders its count', zc.fac);

// ═══ 11. F1 — the facilities-only state ═══
await page.goto(base + '/homesignalmap.html?zip=84334', { waitUntil: 'domcontentloaded' });
await waitShell();
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
await page.waitForTimeout(700);
c = await chrome();
info('facilities-only ZIP 84334', { covNote: c.covNote, kFac: c.kFac });
ok(/Nearby EPA-registered facilities are shown for additional local context/i.test(c.covNote || ''),
  '11a the facilities-only note is the truthful contextual wording', c.covNote);
ok(!/Showing EPA-registered facilities for this ZIP/i.test(c.covNote || ''),
  '11b the false whole-ZIP sentence is gone', c.covNote);
ok(!WHOLE_ZIP_FACILITY_CLAIM.test(c.covNote || ''),
  '11c ...and nothing in it claims those facilities are the ZIP’s', c.covNote);
ok(c.totalTileShown === false, '11d still no combined total on a facilities-only ZIP');

// ═══ 12. F1 — address mode is a different contract and keeps its own labels ═══
await page.goto(base + '/homesignalmap.html', { waitUntil: 'domcontentloaded' });
await waitShell();
await page.fill('#addr', '2200 CALDWELL LN, DEL VALLE, TX 78617');
await page.click('#go');
await page.waitForFunction(() => (window.__HS_SITES || []).some(s => s.n5_feature_id), null, { timeout: 60000 });
await page.waitForTimeout(500);
c = await chrome();
const am = await page.evaluate(() => ({
  within: (document.getElementById('withinLbl') || {}).textContent,
  radiusVisible: (() => { const e = document.getElementById('radSel'); if (!e) return false;
    const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; })(),
  homePins: document.querySelectorAll('.homepin').length,
  canonical: (window.__HS_SITES || []).filter(s => s.n5_feature_id).length
}));
info('address mode after the ZIP change', { ...am, kDev: c.kDev, kFac: c.kFac, totalTileShown: c.totalTileShown });
ok(/within/i.test(am.within || ''), '12a address mode still states its radius', am.within);
ok(am.radiusVisible && am.homePins === 1 && am.canonical > 0,
  '12b HOME, the radius control and canonical radius results are untouched', am);
ok(c.totalTileShown === true,
  '12c address mode KEEPS its total — every class in it shares one radius contract');
ok(!/across this ZIP/i.test(c.kDev || ''), '12d no ZIP-mode scope copy leaks into address mode', c.kDev);

ok(pageErrors.length === 0, 'no fatal client error across the journey', pageErrors.slice(0, 3));

console.log('='.repeat(78));
console.log('FAILS: ' + fails);
console.log('='.repeat(78));
await browser.close();
server.close();
process.exit(fails ? 1 : 0);

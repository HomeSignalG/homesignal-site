// MAP 1 — THE HERO MUST NAME THE MODE THE RESULTS ARE IN, driven in a real browser.
//
// #1070 moved the heading pair, the map caption, the counters and the way back to
// address-mode wording. It did not move the HERO. Measured on main (e053819) with this
// suite's own fixtures: searching an address from a ZIP view rendered
//
//     kicker  "Development overview"
//     H1      "ZIP 78617"
//     results "Showing development within 2 miles of / 2200 CALDWELL LN, DEL VALLE, TX 78617"
//
// A resident reads top-down, so the largest and first thing on the page was still making the
// whole-ZIP claim over near-home results — the one state the founder's decision names
// explicitly: "Do not retain a ZIP-wide H1 or standfirst while address-radius results are
// shown."
//
// loadZip() has always restored all four for the ZIP view. This suite pins the OTHER
// direction, and pins that the return trip still restores them — a one-directional switch is
// how this defect existed at all.
//
// Every network call is answered from fixtures; no production service is touched.
//
// Run: node test/map1-mode-identity.browser.test.mjs
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
      lat: 30.2160, lng: -97.5400, src: 'EPA FRS' }] };
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
const ZIP_AUTH = { zip: '78617', mode: 'authoritative', status: 'boundary_complete',
  projects: [{ project_ref: 'p1', name: 'Del Valle logistics center', type: 'Industrial',
    status: 'Proposed', registry_id: 'austin-site-plan-cases', source_ref: 'https://example.gov/rec/p1',
    submitted_at: '2026-01-15', date_kind: 'filed', type_raw: 'Commercial - New Construction' }],
  markers: [{ project_ref: 'p1', lat: 30.1620, lng: -97.6600, marker_rule: 'POINT', marker_seq: 0 }] };

const browser = await chromium.launch();
const pageErrors = [];
const routeHandler = async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  const J = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('/functions/v1/geocode-address')) return J(GEO);
  if (url.includes('/rpc/n5_projects_within_radius')) {
    const b = JSON.parse(route.request().postData() || '{}');
    return J(RPC_ROWS[b.p_radius_mi] || []);
  }
  if (url.includes('/rpc/app_zip_projects_markers')) return J(ZIP_AUTH);
  if (url.includes('/functions/v1/get-address-report')) return J(REPORT);
  if (url.includes('/rest/v1/app_projects')) return J(PROJECTS);
  if (url.includes('/rest/v1/development_reports')) return J(ZIP_ROW);
  if (url.includes('/rest/v1/')) return J([]);
  // Leaflet is REAL. Served from a local copy WHEN ONE RESOLVES, else from the CDN the page
  // already names. The repo has no package.json and CI installs playwright ALONE into a
  // scratch dir outside the checkout, so a hardcoded node_modules path throws ENOENT inside
  // the route handler and kills the run before a single assertion prints.
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

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
await page.route('**/*', r => routeHandler(r));

// The four surfaces a resident meets BEFORE the results card, plus the results heading they
// have to agree with.
const hero = (p) => p.evaluate(() => {
  const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };
  return { kicker: t('#eyebrow'), h1: t('.head h1'), sub: t('.sub'), title: document.title,
           heading: t('#withinLbl'), scopeLine: t('#rAddr') };
});
const waitZip = () => page.waitForFunction(
  () => Array.isArray(window.__HS_SITES) && !(window.__HS_SITES || []).some(s => s.n5_feature_id)
        && document.getElementById('results')
        && getComputedStyle(document.getElementById('results')).display !== 'none',
  null, { timeout: 30000 });
const waitAddr = (p) => p.waitForFunction(
  () => (window.__HS_SITES || []).some(s => s.n5_feature_id), null, { timeout: 30000 });

// ══════════════ 1. ZIP MODE — the hero names the ZIP, and that is correct here ══════════════
await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitZip(); await page.waitForTimeout(600);
const z = await hero(page);
ok(/Development overview/i.test(z.kicker || ''), '1a ZIP mode kicker names the overview', z.kicker);
ok(/78617/.test(z.h1 || ''), '1b ZIP mode H1 names the ZIP', z.h1);
ok(/See what is changing in your zip code/i.test(z.sub || ''),
  '1c ZIP mode standfirst is the ZIP-mode line', z.sub);
ok(/All development across/i.test(z.heading || ''), '1d ...and the results heading agrees', z.heading);

// ══════════════ 2. ADDRESS MODE — the hero must stop making the whole-ZIP claim ══════════════
await page.fill('#addr', '2200 Caldwell Ln, Del Valle, TX 78617');
await page.click('#go');
await waitAddr(page); await page.waitForTimeout(600);
const a = await hero(page);
ok(/Showing development within/i.test(a.heading || ''),
  '2a the results are address-radius results (the precondition for the rest)', a.heading);
ok(/CALDWELL/i.test(a.scopeLine || ''), '2b ...centred on the matched address', a.scopeLine);
// THE DEFECT THIS SUITE EXISTS FOR — all four were ZIP-scoped here on main.
ok(!/ZIP 78617/.test(a.h1 || ''), '2c the H1 no longer makes the whole-ZIP claim', a.h1);
ok(/around this address/i.test(a.h1 || ''), '2d ...it names the address view', a.h1);
ok(!/Development overview/i.test(a.kicker || ''), '2e the kicker is no longer the ZIP overview', a.kicker);
ok(/Near-home view/i.test(a.kicker || ''), '2f ...it names the near-home mode', a.kicker);
// The ZIP standfirst no longer carries the ZIP NUMBER, so "does it say 'across ZIP'" would pass
// on both modes and discriminate nothing. What the mode switch owes the resident is that the
// address hero is not the ZIP hero, so that is what is asserted — with the old claim kept beside it.
ok(!/across ZIP/i.test(a.sub || ''), '2g the standfirst drops the whole-ZIP claim', a.sub);
ok(!/See what is changing in your zip code/i.test(a.sub || ''),
  '2g2 ...and is no longer the ZIP-mode standfirst at all', a.sub);
ok(!/ZIP 78617/.test(a.title || ''), '2h the document title follows the mode too', a.title);
// The hero must not claim a RADIUS either — the radius is stated once, where it is true, and a
// second copy in the hero would go stale the moment the resident changes it.
ok(!/\b(½|1|2|3|5|10|20)\s*mile/i.test(a.h1 || ''),
  '2i the H1 states the MODE, not a radius that would go stale on the next click', a.h1);

// ══════════════ 3. A RADIUS CHANGE MUST NOT UNDO IT ══════════════
await page.click('#radSel button[data-r="5"]');
await waitAddr(page); await page.waitForTimeout(900);
const r5 = await hero(page);
ok(/within 5 miles of$/.test(r5.heading || ''), '3a the radius change took effect', r5.heading);
ok(/around this address/i.test(r5.h1 || '') && /Near-home view/i.test(r5.kicker || ''),
  '3b the hero still names the address view after it', { h1: r5.h1, kicker: r5.kicker });

// ══════════════ 4. THE SWITCH RUNS BOTH WAYS ══════════════
// A one-directional switch is exactly how this defect existed, so the return trip is asserted
// rather than assumed. Clicking the anchor INSIDE #backZip, which is what a resident clicks.
await page.click('#backZip a');
await waitZip(); await page.waitForTimeout(600);
const b = await hero(page);
ok(/Development overview/i.test(b.kicker || ''), '4a returning restores the ZIP kicker', b.kicker);
ok(/78617/.test(b.h1 || ''), '4b ...the ZIP H1', b.h1);
ok(/See what is changing in your zip code/i.test(b.sub || ''), '4c ...and the ZIP standfirst', b.sub);
ok(/All development across/i.test(b.heading || ''), '4d ...over whole-ZIP results', b.heading);

// ══════════════ 5. A DIRECT ADDRESS VISIT ALSO GETS ADDRESS-MODE IDENTITY ══════════════
// A FRESH CONTEXT, not another goto(): the page's boot deliberately reuses a ZIP the resident
// has already viewed (HS.hasViewedZipContext), which is stored per browser profile, so reusing
// this context would silently re-enter ZIP mode and measure the wrong thing.
const fresh = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const p2 = await fresh.newPage();
p2.on('pageerror', e => pageErrors.push('fresh: ' + String(e).slice(0, 200)));
await p2.route('**/*', r => routeHandler(r));
await p2.goto(base + '/homesignalmap.html', { waitUntil: 'domcontentloaded' });
await p2.waitForSelector('#addr');
ok((await p2.evaluate(() => document.body.classList.contains('zipmode'))) === false,
  '5a the control case really is a first visit with no ZIP view');
await p2.fill('#addr', '2200 Caldwell Ln, Del Valle, TX 78617');
await p2.click('#go');
await waitAddr(p2); await p2.waitForTimeout(600);
const d = await hero(p2);
ok(/around this address/i.test(d.h1 || '') && /Near-home view/i.test(d.kicker || ''),
  '5b a direct address search gets the same address-mode identity', { h1: d.h1, kicker: d.kicker });

ok(pageErrors.length === 0, '6 the whole journey ran with no fatal client error', pageErrors);

console.log('='.repeat(72));
console.log(fails ? 'FAILS: ' + fails : 'ALL PASS');
await browser.close();
server.close();
if (fails) process.exit(1);

// MAP 1 — THE TWO MODES MUST BE UNMISTAKABLE (first-launch standard).
//
// Map 1 shows a homeowner two completely different geographies through one screen:
//
//   ENTIRE ZIP     every development record across the real ZIP/ZCTA geography
//   NEAR HOME      a geocoded street address plus a radius the resident picked
//
// They share a canvas, a legend, a counts row and a search box. The ONLY thing that tells a
// resident which one they are looking at is the wording — so the wording is a launch gate, and
// this suite drives the SHIPPED page in a real browser to prove it, rather than reading the
// source for strings.
//
// Nothing here touches data logic. Every assertion is about what a person can read on screen
// and what they can click; the qualification, geography and count contracts are pinned by
// test/residential-total-qualification.test.mjs, test/zip-authoritative.test.mjs and
// scripts/verify-map1-card-grain.mjs and are deliberately not re-litigated here.
//
// Screenshots for the founder's review land in test/__screens__/ when SHOTS=1.
//
// Run: node test/map1-mode-clarity.browser.test.mjs   (SHOTS=1 to write PNGs)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!c) fails++;
};

const REPO = process.cwd();
const SHOTS = process.env.SHOTS === '1';
const SHOTDIR = join(REPO, 'test', '__screens__');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = createServer(async (q, s) => {
  const p = normalize(join(REPO, decodeURIComponent(q.url.split('?')[0])));
  try { s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/plain' }); s.end(await readFile(p)); }
  catch { s.writeHead(404); s.end('nope'); }
});
await new Promise(r => srv.listen(8817, '127.0.0.1', r));
const base = 'http://127.0.0.1:8817';

// ── fixtures: one covered ZIP with a real project, one genuinely not-measured ZIP ─────────
const PROJECT = { e: 0.4, n: 0.3, lat: 30.1745, lng: -97.6134, type: 'approved',
  label: 'Stassney Lane Townhomes', layer: 'development', scope: 'point',
  use_type: 'Residential', type_raw: 'MF', relevance: 'development', bucket: 'approved',
  jurisdiction: 'City of Austin', geo_precision: 'point',
  record_url: 'https://abc.austintexas.gov/case/1', source_id: 'socrata:austin:SP-1' };
const FACILITY = { e: 1.1, n: 0.8, lat: 30.18, lng: -97.60, type: 'built',
  src: 'EPA FRS · registry 110000000001', label: 'ACME PLATING', layer: 'industrial',
  scope: 'point', registry_id: '110000000001',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110000000001' };

const ZIP_AUTH = {
  '78617': { zip: '78617', mode: 'development', status: 'boundary_complete',
    projects: [{ source_key: 'socrata:austin:SP-1', project_ref: 'socrata:austin:SP-1',
      name: 'Stassney Lane Townhomes', type: 'MF', status: 'Approved',
      registry_id: 'austin-site-plan-cases', source_ref: 'https://abc.austintexas.gov/case/1',
      submitted_at: '2026-02-10', date_kind: 'filed', impact_score: null, impact_dimensions: null }],
    markers: [{ project_ref: 'socrata:austin:SP-1', lat: 30.1745, lng: -97.6134,
      marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] }
  // 01004 is deliberately absent -> the RPC's not_measured shape, below.
};
const ZIP_ROW = {
  '78617': [{ zip: '78617', home_lat: 30.1745, home_lng: -97.6134,
    counts: { facilities: 1, development: 1 }, sites: [PROJECT, FACILITY],
    refreshed_at: '2026-09-06T00:00:00Z', facilities_unavailable: false }],
  '01004': []   // no cached row AND no authoritative geography: the genuine not-measured state
};
const COMMUNITIES = {
  '78617': [{ name: 'Del Valle (78617)', level: 'zip', county: 'Travis', state: 'TX' }],
  '01004': [{ name: 'Amherst (01004)', level: 'zip', county: 'Hampshire', state: 'MA' }]
};
const ADDRESS = '2200 Caldwell Ln, Del Valle, TX 78617';

// PW_CHROMIUM lets a sandbox whose pre-installed Chromium build does not match the local
// Playwright package point at it directly. Unset in CI, where `npx playwright install` has run.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
if (process.env.DEBUG_NET) { page.on('console', m => console.log('CONSOLE', m.type(), m.text().slice(0,200))); page.on('request', r => { if(!r.url().startsWith(base)) console.log('REQ', r.method(), r.url().slice(0,160)); }); }
const zipOf = (url) => (url.match(/(?:zip=eq\.|%7B)(\d{5})/) || [])[1] || null;
let lastReportBody = null;

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('/functions/v1/geocode-address'))
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ match: { lat: 30.1745, lng: -97.6134, matchedAddress: ADDRESS } }) });
  if (url.includes('/functions/v1/get-address-report')) {
    try { lastReportBody = JSON.parse(route.request().postData() || '{}'); } catch (e) { lastReportBody = null; }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ address: ADDRESS, home: { lat: 30.1745, lng: -97.6134 },
        counts: { facilities: 1, development: 1 }, sites: [PROJECT, FACILITY], paywall: false }) });
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

// The page ships a strict CSP with no 'unsafe-eval', and Playwright's waitForFunction polls
// through `new Function`. Polling from Node with evaluate() asks the same question without
// asking the page to eval a string - and it means this suite runs against the REAL shipped
// CSP rather than a relaxed one.
const waitUntil = async (fn, label, ms = 30000) => {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for: ' + label);
    await page.waitForTimeout(150);
  }
};

// ── what a person can actually read ──────────────────────────────────────────────────────
const text = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el && el.offsetParent !== null ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
}, sel);
const visible = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return !!el && !el.hidden && el.offsetParent !== null;
}, sel);
const radiusStops = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#radSel button'))
    .filter(b => !b.hidden && b.offsetParent !== null)
    .map(b => b.getAttribute('data-r')));
const shot = async (name) => {
  if (!SHOTS) return;
  await mkdir(SHOTDIR, { recursive: true });
  await page.screenshot({ path: join(SHOTDIR, name + '.png'), fullPage: false });
};

const loadZip = async (zip) => {
  await page.goto(base + '/homesignalmap.html?zip=' + zip, { waitUntil: 'domcontentloaded' });
  await waitUntil(() => Array.isArray(window.__HS_SITES) || /not measured/i.test(
    (document.getElementById('status') || {}).textContent || ''), 'the ZIP view to settle');
  await page.waitForTimeout(700);
};

// ═══ 0. COLD LOAD — the page before it knows a place ══════════════════════════════════════
// No ?zip= and no ?addr=: neither live path has run, so the visitor is reading the static
// markup. That markup used to promise "Box Elder County addresses only, for now" on a
// national footprint. It must now claim neither one county nor the whole country.
await page.goto(base + '/homesignalmap.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
const cold = [await text('#eyebrow'), await text('.head h1'), await text('.sub'),
              await text('.hint'),
              await page.evaluate(() => (document.getElementById('addr') || {}).placeholder || '')
             ].join(' | ');
ok(!/Box Elder|Brigham City/i.test(cold),
  '0a: the cold-load hero names no single county — it does not know one yet', JSON.stringify(cold));
ok(!/nationwide|all 50 states|every county|anywhere in the/i.test(cold),
  '0b: …and does not replace that with a promise of nationwide coverage', JSON.stringify(cold));
ok(/varies by county/i.test(await text('.hint') || ''),
  '0c: it says coverage varies, which is what is actually true', JSON.stringify(await text('.hint')));
await shot('0-cold-load');

// ═══ 1. ENTIRE ZIP VIEW ═══════════════════════════════════════════════════════════════════
await loadZip('78617');
await shot('1-zip-mode');
const zipH2 = await text('#withinLbl');
const zipSub = await text('#rAddr');
ok(zipH2 === 'All development across ZIP 78617',
  '1a: the ZIP heading states the WHOLE ZIP, in the launch wording', JSON.stringify(zipH2));
ok(/entire ZIP 78617/i.test(zipSub || '') && /not just projects near one address/i.test(zipSub || ''),
  '1b: …and the line under it rules out the near-home reading', JSON.stringify(zipSub));
const cap = await text('.map-cap') || '';
ok(/across .*78617/i.test(cap) && /nearby facilities for context/i.test(cap),
  '1c: the caption names the same ZIP AND separates the nearby facilities layer', JSON.stringify(cap));
ok(/across this ZIP/i.test(await text('#kDev') || ''),
  '1d: the development counter says which geography it counts', JSON.stringify(await text('#kDev')));
// A ZIP-wide view has no home and therefore no radius to choose.
ok((await radiusStops()).length === 0, '1e: no radius control in ZIP mode — there is no home to measure from');
ok(!(await visible('#backZip')), '1f: no "back to the ZIP" button when already on the ZIP');
ok((await page.evaluate(() => (window.__HS_SITES || []).some(s => s.distance_mi != null))) === false,
  '1g: no ZIP-mode record carries a distance — distance belongs to the near-home mode');

// ═══ 2. NOT MEASURED is not ZERO ══════════════════════════════════════════════════════════
await loadZip('01004');
await shot('2-not-measured');
const note = await text('#status');
ok(/not measured/i.test(note || ''), '2a: an unmeasured ZIP SAYS it is not measured', JSON.stringify(note));
ok(/will not estimate|not estimate/i.test(note || ''),
  '2b: …and says it will not estimate from a circle around the ZIP centre');
ok(/street address/i.test(note || ''), '2c: …and offers the resident the near-home mode instead');
ok(!/^0\b/.test(note || '') && !/no (permit|planning|development) records/i.test(note || ''),
  '2d: it never states a finding of zero it did not make');
// The card itself must not contradict the note. render() never runs on this path, so the
// card used to keep its ADDRESS-MODE defaults - "Within 1 mile of / -" over four zeros
// labelled "nearby" - which reads as a near-home finding on a ZIP nobody measured, from a
// radius nobody chose. There is no cached report row here, so none of those four numbers
// was ever counted.
ok(!(await visible('.counts')),
  '2e: no counters on an unmeasured ZIP — nothing was counted, so nothing is shown');
const nmHead = await text('#withinLbl') || '';
ok(!/within/i.test(nmHead) && /01004/.test(nmHead),
  '2f: the heading names the ZIP and never a radius', JSON.stringify(nmHead));
ok(!/\bmile\b/i.test(((await text('#withinLbl')) || '') + ' ' + ((await text('#rAddr')) || '')),
  '2g: nothing on the card implies a distance from a home');

// ═══ 3. NEAR-HOME ADDRESS VIEW ════════════════════════════════════════════════════════════
await loadZip('78617');
await page.fill('#addr', ADDRESS);
await page.click('#go');
await waitUntil(() => /Caldwell/.test((document.getElementById('rAddr') || {}).textContent || ''),
  'the address view to render');
await page.waitForTimeout(500);
await shot('3-address-mode');
const addrH2 = await text('#withinLbl');
ok(/^Showing development within .+ of$/.test(addrH2 || ''),
  '3a: the heading names WHAT is shown and the radius', JSON.stringify(addrH2));
const shownR = (addrH2 || '').match(/within ([\d.]+|½) (mile|miles)/);
ok(!!shownR && lastReportBody
   && String(lastReportBody.radius_mi) === (shownR[1] === '½' ? '0.5' : shownR[1]),
  '3b: the radius on the heading is the radius actually queried — never a stale label',
  JSON.stringify({ heading: shownR && shownR[0], queried: lastReportBody && lastReportBody.radius_mi }));
ok((await text('#rAddr')) === ADDRESS, '3c: …and the centre is the address the resident typed');
ok(lastReportBody && lastReportBody.address === ADDRESS && lastReportBody.zip === undefined,
  '3d: the request sends the ADDRESS and no zip — the two geographies never mix',
  JSON.stringify(lastReportBody && { address: !!lastReportBody.address, zip: lastReportBody.zip }));
ok(/around this home/i.test(await text('.map-cap') || ''),
  '3e: the map caption switches to the near-home wording', JSON.stringify(await text('.map-cap')));
// The HERO must follow the mode too. Searching an address from a ZIP page used to leave
// "Del Valle (78617)" over "…across ZIP 78617" directly above a card reading "within 2 miles
// of 2200 Caldwell Ln" - two contradictory scope claims on one screen.
const aHero = ((await text('.head h1')) || '') + ' | ' + ((await text('.sub')) || '');
ok(!/across ZIP/i.test(aHero) && !/\(78617\)/.test(aHero),
  '3f: the hero stops claiming the whole ZIP once a home is the centre', JSON.stringify(aHero));
ok(/around your home/i.test(await text('.head h1') || ''),
  '3g: …and says whose home the view is about', JSON.stringify(await text('.head h1')));
// 78617 is the designated demo ZIP, so a signed-out search that lands in it used to be
// captioned "Del Valle (Sample Zip Code)" — a real address search, labelled a demo.
ok(!/Sample Zip Code/i.test(await text('#locLabel') || ''),
  '3h: a searched address is never captioned as the sample ZIP', JSON.stringify(await text('#locLabel')));

// ═══ 4. THE RADIUS CONTROL ════════════════════════════════════════════════════════════════
const stops = await radiusStops();
ok(JSON.stringify(stops) === JSON.stringify(['0.5', '1', '2', '5']),
  '4a: exactly the four radii the address mode supports are offered', JSON.stringify(stops));
// The search opened at 2 mi (snapped from ZIP mode's provisional 3), so clicking 2 would
// prove nothing. Half a mile is a real change, in the direction a homeowner cares about.
const beforeR = lastReportBody && lastReportBody.radius_mi;
await page.click('#radSel button[data-r="0.5"]');
await waitUntil(() => /within ½ mile of/i.test(
  (document.getElementById('withinLbl') || {}).textContent || ''), 'the half-mile heading');
ok(beforeR === 2 && /½ mile/.test(await text('#withinLbl') || ''),
  '4b: changing the radius restates it in the heading',
  JSON.stringify({ before: beforeR, after: await text('#withinLbl') }));
ok(lastReportBody && lastReportBody.radius_mi === 0.5,
  '4c: …and the new radius is what was actually queried', JSON.stringify(lastReportBody && lastReportBody.radius_mi));
await shot('4-radius-2mi');

// ═══ 5. THE WAY BACK ══════════════════════════════════════════════════════════════════════
ok(await visible('#backZip'), '5a: address mode offers a way back to the whole ZIP');
const backLabel = await text('#backZip');
ok(/Back to all development in ZIP 78617/.test(backLabel || ''),
  '5b: …and it names the ZIP, so the destination is not a guess', JSON.stringify(backLabel));
await page.click('#backZip');
await waitUntil(() => /^All development across ZIP/.test(
  (document.getElementById('withinLbl') || {}).textContent || ''), 'the return to ZIP mode');
await page.waitForTimeout(400);
ok((await text('#withinLbl')) === 'All development across ZIP 78617', '5c: it returns to the whole-ZIP view');
ok((await radiusStops()).length === 0, '5d: …and the radius control goes away with the home');
const bHero = ((await text('.head h1')) || '') + ' | ' + ((await text('.sub')) || '');
ok(/across ZIP 78617/i.test(bHero),
  '5d2: …and the hero goes back to the whole-ZIP claim with it', JSON.stringify(bHero));
ok(/[?&]zip=78617/.test(page.url()) && !/addr=/.test(page.url()),
  '5e: the address bar agrees with the view, so refresh and Back behave', page.url());
await shot('5-back-to-zip');

// ═══ 6. EVERY RECORD REACHES ITS OFFICIAL SOURCE ══════════════════════════════════════════
const unsourced = await page.evaluate(() =>
  (window.__HS_SITES || []).filter(s => !(s.record_url || s.url)).length);
ok(unsourced === 0, '6a: every rendered record carries its official record link', unsourced + ' without one');
const rail = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('.rec'));
  return { rows: rows.length,
           links: rows.reduce((n, r) => n + r.querySelectorAll('a[href]').length, 0),
           http: rows.reduce((n, r) => n + r.querySelectorAll('a[href^="http"]').length, 0) };
});
ok(rail.rows > 0, '6b: the rails list the records', JSON.stringify(rail));
ok(rail.links > 0, '6c: …and every row offers a route to the official record',
  JSON.stringify(rail));

ok(pageErrors.length === 0, '7: no uncaught page errors across the whole journey', pageErrors.join(' | ') || 'none');

await browser.close(); srv.close();
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);

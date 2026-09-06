// MAP 1 — THE TWO MODES MUST NEVER BE CONFUSABLE (first-launch standard).
//
// Map 1 shows development in exactly two geographies and a homeowner has to be able to tell,
// without help, which one is on screen:
//
//   ENTIRE ZIP     the whole ZIP/ZCTA boundary. No centre point, no centroid, no radius, no
//                  fixed-radius proxy anywhere in the retrieval OR the wording.
//   NEAR HOME      a geocoded street address + a radius the resident picked.
//
// WHAT THIS SUITE EXISTS TO STOP (all four measured in the browser on the shipped page,
// 2026-09-06, before the change this suite pins):
//   1. There was NO way back from address mode to the whole-ZIP view except editing the URL.
//   2. An address search launched from a ZIP page left the hero making a whole-ZIP claim
//      ("What's built and what's proposed across ZIP 20171") above a 2-mile circle. Two
//      contradictory scope claims on one screen.
//   3. The ZIP heading read "Across ZIP 20171" — which a homeowner reads as "projects around
//      here", i.e. the same thing address mode says.
//   4. The address heading read "Within 2 miles of" — a fragment that never said what was
//      being counted.
//
// AND THE ONE IT EXISTS TO STOP US "FIXING" TOO HARD: "All development across ZIP X" is a
// COMPLETENESS claim. It may only appear when the authoritative read came back complete. On a
// not-measured ZIP it must not appear, and the entire-ZIP sentence must not appear either —
// otherwise a page that measured nothing tells a resident it measured everything.
//
// It drives the REAL shipped page over stubbed network I/O; nothing here reimplements the
// page's logic. Fixtures are production-shaped `development_reports` site objects (ZIP 20171),
// the same ones test/map1-dual-identity.browser.test.mjs uses.
//
// Run: node test/map1-two-modes.browser.test.mjs
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
await new Promise(r => srv.listen(8837, '127.0.0.1', r));
const base = 'http://127.0.0.1:8837';

const FAC = { e: 1.82, n: 2.361, lat: 38.95942, lng: -77.35889,
  src: 'EPA FRS · registry 110072041130', type: 'built', label: 'ANDURIL INDUSTRIES, INC',
  layer: 'industrial', scope: 'point', registry_id: '110072041130',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110072041130' };
const DC_PROJECT = { e: 1.515, n: 1.756, lat: 38.95065, lng: -77.36458, type: 'approved',
  label: 'Pennhurst Data Centers', layer: 'development', scope: 'point', use_type: 'Data Center',
  type_raw: 'Data Center', relevance: 'development', bucket: 'approved',
  jurisdiction: 'Fairfax County Land Development Services', geo_precision: 'point',
  record_url: 'https://plus.fairfaxcounty.gov/x', source_id: 'arcgis:fairfax:P-1' };

// 20171 complete WITH a record · 20172 complete with ZERO records (a measured zero) ·
// 20173 absent here, so the route default answers 'not_measured'.
const ZIP_AUTH = {
  '20171': { zip: '20171', mode: 'development', status: 'boundary_complete',
    projects: [{ source_key: 'arcgis:fairfax:P-1', project_ref: 'arcgis:fairfax:P-1',
      name: 'Pennhurst Data Centers', type: 'Data Center', status: 'Approved',
      registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/x',
      submitted_at: '2026-01-04', date_kind: 'filed', impact_score: null, impact_dimensions: null }],
    markers: [{ project_ref: 'arcgis:fairfax:P-1', lat: 38.95065, lng: -77.36458,
      marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] },
  '20172': { zip: '20172', mode: 'development', status: 'boundary_complete', projects: [], markers: [] }
};
const row = (zip, sites, dev) => [{ zip, home_lat: 38.9506, home_lng: -77.3645,
  counts: { facilities: 1, development: dev }, sites, refreshed_at: '2026-09-06T00:00:00Z',
  facilities_unavailable: false }];
const ZIP_ROW = { '20171': row('20171', [FAC, DC_PROJECT], 1), '20172': row('20172', [FAC], 0),
                  '20173': row('20173', [FAC], 0) };
const COMMUNITIES = {
  '20171': [{ name: 'Herndon (20171)', level: 'zip', county: 'Fairfax', state: 'VA' }],
  '20172': [{ name: 'Herndon (20172)', level: 'zip', county: 'Fairfax', state: 'VA' }],
  '20173': [{ name: 'Herndon (20173)', level: 'zip', county: 'Fairfax', state: 'VA' }]
};
const ADDRESS = '2400 MONROE ST, HERNDON, VA, 20171';

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
const zipOf = (u) => (u.match(/(?:zip=eq\.|%7B)(\d{5})/) || [])[1] || null;

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  const J = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('/functions/v1/geocode-address'))
    return J({ match: { lat: 38.9506, lng: -77.3645, matchedAddress: ADDRESS } });
  if (url.includes('/functions/v1/get-address-report'))
    return J({ address: ADDRESS, home: { lat: 38.9506, lng: -77.3645 },
      counts: { facilities: 1 }, sites: [FAC], facilities_unavailable: false });
  if (url.includes('/rpc/n5_projects_within_radius'))
    return J([{ source_key: 'arcgis:fairfax:P-1', feature_id: '0', marker_lat: 38.95065,
      marker_lng: -77.36458, distance_mi: 0.42, geom_kind: 'point' }]);
  if (url.includes('/rpc/app_zip_projects_markers')) {
    let z = ''; try { z = String(JSON.parse(route.request().postData() || '{}').p_zip || ''); } catch (e) { z = ''; }
    return J(ZIP_AUTH[z] || { zip: z, mode: 'development', status: 'not_measured', projects: null, markers: null });
  }
  if (url.includes('/rest/v1/development_reports')) return J(ZIP_ROW[zipOf(url)] || []);
  if (url.includes('/rest/v1/communities')) return J(COMMUNITIES[zipOf(url)] || []);
  if (url.includes('/rest/v1/app_projects'))
    return J([{ source_key: 'arcgis:fairfax:P-1', name: 'Pennhurst Data Centers', type: 'Data Center',
      status: 'Approved', source_ref: 'https://plus.fairfaxcounty.gov/x',
      registry_id: 'fairfax-active-site-construction', submitted_at: '2026-01-04', date_kind: 'filed',
      impact_score: null, impact_dimensions: null }]);
  if (url.includes('/rest/v1/') || url.includes('/rpc/')) return J([]);
  if (url.includes('leaflet@1.9.4/dist/leaflet.js') || url.includes('leaflet@1.9.4/dist/leaflet.css')) {
    const css = url.endsWith('.css');
    let local = null;
    try { local = require.resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch (e) { local = null; }
    if (!local) return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript', body: '' });
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

const txt = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : ''; }, sel);
const heroText = () => page.evaluate(() => {
  const q = (s) => { const e = document.querySelector(s); return e ? e.textContent : ''; };
  return [q('.head h1'), q('#eyebrow'), q('.sub'), q('.hint'), q('.map-cap')].join(' ⏐ ');
});
const backBtn = () => page.evaluate(() => {
  const e = document.getElementById('backZipBtn');
  return e ? { present: true, hidden: !!e.hidden, text: e.textContent.trim(), zip: e.getAttribute('data-zip') }
           : { present: false };
});
const radiusVisible = () => page.evaluate(() => {
  const e = document.getElementById('radSel'); return !!e && e.offsetParent !== null;
});
const loadZip = async (zip) => {
  await page.goto(base + '/homesignalmap.html?zip=' + zip, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
  await page.waitForTimeout(900);
};
const search = async (a) => { await page.fill('#addr', a); await page.click('#go'); await page.waitForTimeout(2500); };
const setRadius = async (r) => { await page.click('#radSel button[data-r="' + r + '"]'); await page.waitForTimeout(2500); };

// ── 1. ENTIRE-ZIP MODE SAYS SO, IN THE REQUIRED WORDS ────────────────────────────────
await loadZip('20171');
const zipHead = await txt('#withinLbl');
ok(zipHead === 'All development across ZIP 20171',
  '1: ZIP mode heading is the required label, verbatim', JSON.stringify(zipHead));
ok(/entire ZIP/i.test(await txt('#scopeNote')),
  '1: ...and one plain-words line says it is the ENTIRE ZIP', JSON.stringify(await txt('#scopeNote')));
ok(!/only projects close to one address/i.test('') && /not only projects close to one address/i.test(await txt('#scopeNote')),
  '1: ...and distinguishes it from "projects near me"');

// ── 2. NO RADIUS SEMANTICS ANYWHERE IN ZIP MODE ──────────────────────────────────────
// The permanent invariant: ZIP mode must never use OR IMPLY a centre point or a radius.
ok((await radiusVisible()) === false, '2: the radius control is not offered in ZIP mode');
const zipCard = await page.evaluate(() => document.querySelector('.card.read').innerText);
ok(!/\bmile\b/i.test(zipCard) && !/\bradius\b/i.test(zipCard) && !/centre|center/i.test(zipCard),
  '2: ZIP mode says no "mile", no "radius", no "centre" in the results card',
  JSON.stringify(zipCard.replace(/\s+/g, ' ').slice(0, 120)));
ok((await backBtn()).hidden === true,
  '2: the back-to-ZIP control is hidden in ZIP mode (it would point at this page)');

// ── 3. NEAR-HOME MODE SAYS SO, IN THE REQUIRED WORDS ─────────────────────────────────
await search('2400 Monroe St, Herndon, VA 20171');
ok((await txt('#withinLbl')) === 'Showing development within 2 miles of',
  '3: address heading names WHAT and HOW FAR', JSON.stringify(await txt('#withinLbl')));
ok((await txt('#rAddr')) === ADDRESS,
  '3: ...and the next line is the address the geocoder matched', await txt('#rAddr'));
ok(/not the whole ZIP/i.test(await txt('#scopeNote')),
  '3: ...and the plain-words line says it is NOT the whole ZIP', JSON.stringify(await txt('#scopeNote')));

// ── 4. THE HERO STOPS MAKING A WHOLE-ZIP CLAIM ───────────────────────────────────────
const hero = await heroText();
ok(!/across ZIP 20171/i.test(hero),
  '4: no "across ZIP 20171" survives anywhere in the hero once a radius is on screen',
  JSON.stringify(hero.slice(0, 160)));
ok(!/Box Elder/i.test(hero),
  '4: ...and the hero is not the Box-Elder-only static copy either');

// ── 5. THE WAY BACK EXISTS, AND IT IS THE ONE THE BRIEF NAMES ────────────────────────
let b = await backBtn();
ok(b.present && !b.hidden, '5: the back-to-ZIP control is offered in address mode');
ok(b.text === '← Back to all development in ZIP 20171',
  '5: ...with the required wording', JSON.stringify(b.text));
ok(b.zip === '20171', '5: ...pointing at the ZIP the searched address is in', b.zip);

// ── 6. IT ACTUALLY RETURNS TO THE WHOLE-ZIP VIEW, URL AND ALL ────────────────────────
await page.click('#backZipBtn');
await page.waitForTimeout(2500);
ok((await txt('#withinLbl')) === 'All development across ZIP 20171',
  '6: clicking it restores the entire-ZIP view', JSON.stringify(await txt('#withinLbl')));
ok((await backBtn()).hidden === true, '6: ...and the control hides itself again');
ok(/[?&]zip=20171/.test(page.url()), '6: ...and the URL matches what is on screen', page.url());
ok(!/across ZIP/.test(await txt('#scopeNote')) && /entire ZIP/i.test(await txt('#scopeNote')),
  '6: ...and the entire-ZIP sentence is back');
ok((await radiusVisible()) === false, '6: ...and the radius control is gone again');

// ── 7. THE RADIUS THE RESIDENT PICKS IS THE RADIUS THE PAGE CLAIMS ───────────────────
await search('2400 Monroe St, Herndon, VA 20171');
await setRadius('0.5');
ok((await txt('#withinLbl')) === 'Showing development within ½ mile of',
  '7: changing the radius changes the claim', JSON.stringify(await txt('#withinLbl')));
ok(/½-mile circle/.test(await txt('#scopeNote')),
  '7: ...and the plain-words line agrees with it', JSON.stringify(await txt('#scopeNote')));
ok(/½ mile of the address you search/.test(await heroText()),
  '7: ...and so does the hero — one radius, stated the same way everywhere');
await setRadius('5');
ok((await txt('#withinLbl')) === 'Showing development within 5 miles of'
   && /5-mile circle/.test(await txt('#scopeNote')),
  '7: ...at every stop', JSON.stringify(await txt('#withinLbl')));

// ── 8. A MEASURED ZERO IS NOT A NOT-MEASURED ZIP ─────────────────────────────────────
await loadZip('20172');
ok((await txt('#withinLbl')) === 'All development across ZIP 20172',
  '8: a MEASURED ZERO still earns the completeness heading', JSON.stringify(await txt('#withinLbl')));
ok(/entire ZIP/i.test(await txt('#scopeNote')), '8: ...and the entire-ZIP sentence');
ok(/measurement of the whole ZIP, not an empty search/i.test(await txt('#freshLine')),
  '8: ...and says the zero was measured', JSON.stringify(await txt('#freshLine')));

await loadZip('20173');
ok((await txt('#withinLbl')) === 'Development across ZIP 20173',
  '8: a NOT-MEASURED ZIP does not claim "All"', JSON.stringify(await txt('#withinLbl')));
ok((await txt('#scopeNote')) === '',
  '8: ...and withholds the entire-ZIP sentence rather than asserting it',
  JSON.stringify(await txt('#scopeNote')));
ok(/not measured yet/i.test(await txt('#freshLine')),
  '8: ...while still saying plainly that it is not measured', JSON.stringify(await txt('#freshLine')));
// The invariant in its sharpest form: a ZIP centre may be MENTIONED on this page exactly once,
// and only inside the sentence refusing to use one. Any second occurrence is the page starting
// to describe whole-ZIP development with a point.
const _fresh = await txt('#freshLine');
const _centre = (_fresh.match(/centre|center/gi) || []).length;
ok(_centre === 1 && /will not estimate it from a circle around the ZIP centre/i.test(_fresh),
  '8: ...and the only mention of a ZIP centre is the refusal to use one',
  JSON.stringify({ mentions: _centre }));

// ── 9. NO PAGE ERRORS ────────────────────────────────────────────────────────────────
ok(pageErrors.length === 0, '9: no uncaught page errors across every transition',
  JSON.stringify(pageErrors));

await browser.close(); srv.close();
console.log(fails ? '\n' + fails + ' FAILING' : '\nall green');
process.exit(fails ? 1 : 0);

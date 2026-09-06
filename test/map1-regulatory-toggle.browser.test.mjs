// MAP 1 — THE REGULATORY RECORDS ROW, DRIVEN THE WAY A RESIDENT DRIVES IT.
//
// ⚖️ FOUNDER RULING 2026-09-06. "Regulated facility" is not a Project Type and not a
// Status. It is regulatory CONTEXT that overlaps with both, so Map 1 grew a THIRD legend
// row with one on/off switch, and the marker language changed to match: a purple badge
// carrying a white capital R, overlaid on the LOWER-RIGHT corner of the project marker,
// never a replacement for the Type symbol.
//
// test/marker-regulatory-badge.test.mjs pins the MODEL. This suite pins what actually
// reaches the screen — the three rows in order, the switch's copy, and the founder's
// "must NOT change / gray out / strike through / hide / reset" list, measured against the
// rendered chips rather than against filter state (the styling is where a "does not
// change Stage or Type" promise gets broken without any state moving).
//
// The three fixture records are VERBATIM production `development_reports` site objects
// (ZIP 20171, pulled 2026-09-06) — the same rows the dual-identity suites use.
//
// Run: node test/map1-regulatory-toggle.browser.test.mjs
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

const DUAL = { e: 1.482, n: 1.664, lat: 38.94932, lng: -77.36519,
  src: 'EPA FRS · registry 110071955663', type: 'built', label: 'CORESITE - VA1 DATA CENTER',
  layer: 'datacenter', scope: 'point', registry_id: '110071955663',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110071955663' };
const PLAIN_FAC = { e: 1.82, n: 2.361, lat: 38.95942, lng: -77.35889,
  src: 'EPA FRS · registry 110072041130', type: 'built', label: 'ANDURIL INDUSTRIES, INC',
  layer: 'industrial', scope: 'point', registry_id: '110072041130',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110072041130' };
const DC_PROJECT = { e: 1.515, n: 1.756, lat: 38.95065, lng: -77.36458, type: 'approved',
  label: 'Pennhurst Data Centers', layer: 'development', scope: 'point', use_type: 'Data Center',
  type_raw: 'Data Center', relevance: 'development', bucket: 'approved',
  jurisdiction: 'Fairfax County Land Development Services', geo_precision: 'point',
  record_url: 'https://plus.fairfaxcounty.gov/x', source_id: 'arcgis:fairfax:P-1' };
const ZIP_ROW = { '20171': [{ zip: '20171', home_lat: 38.9506, home_lng: -77.3645,
  counts: { facilities: 2, development: 1 }, sites: [DUAL, PLAIN_FAC, DC_PROJECT],
  refreshed_at: '2026-09-06T00:00:00Z', facilities_unavailable: false }] };
const COMMUNITIES = { '20171': [{ name: 'Herndon (20171)', level: 'zip', county: 'Fairfax', state: 'VA' }] };
// The ZIP-authoritative project set. It is NOT optional scaffolding: zipAuthMergeSites
// drops a point-scope report site that no authoritative project claims, so without this
// route the plain data-centre PROJECT never reaches the map and the suite would be
// measuring a two-record population while claiming three.
const ZIP_AUTH = { '20171': { zip: '20171', mode: 'development', status: 'boundary_complete',
  projects: [{ source_key: 'arcgis:fairfax:P-1', project_ref: 'arcgis:fairfax:P-1',
    name: 'Pennhurst Data Centers', type: 'Data Center', status: 'Approved',
    registry_id: 'fairfax-active-site-construction', source_ref: 'https://plus.fairfaxcounty.gov/x',
    submitted_at: '2026-01-04', date_kind: 'filed', impact_score: null, impact_dimensions: null }],
  markers: [{ project_ref: 'arcgis:fairfax:P-1', lat: 38.95065, lng: -77.36458,
    marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 }] } };

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
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

await page.goto(base + '/homesignalmap.html?zip=20171', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 30000 });
await page.waitForTimeout(600);

const regState = () => page.evaluate(() => {
  const t = document.getElementById('regToggle');
  return t ? t.getAttribute('aria-checked') : null;
});
const clickReg = async () => { await page.click('#regToggle'); await page.waitForTimeout(200); };
// Every rendered marker, described by what a resident can see.
const markers = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#map .leaflet-marker-icon:not(.homepin)')).map((el) => {
    const html = (el.querySelector('svg') || {}).outerHTML || '';
    const rect = html.match(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)"/);
    return {
      polygons: (html.match(/<polygon/g) || []).length,
      purple: /#7d148c/i.test(html),
      rBadge: />R<\/text>/.test(html) && /#7d148c/i.test(html),
      badgeX: rect ? Number(rect[1]) : null,
      badgeY: rect ? Number(rect[2]) : null,
      badgeW: rect ? Number(rect[3]) : null
    };
  }));
// The Stage and Type rows as a resident SEES them: pressed state AND the styling that
// would gray out or strike through a chip. This is the founder's "must NOT" list.
const rowsLook = () => page.evaluate(() => {
  const read = (sel) => Array.from(document.querySelectorAll(sel)).map((r) => {
    const cs = getComputedStyle(r);
    const t = r.querySelector('.t');
    return [
      (r.getAttribute('data-cat') || (r.textContent || '').trim().slice(0, 14)),
      r.getAttribute('aria-pressed'),
      cs.opacity,
      cs.display === 'none' ? 'hidden' : 'shown',
      t ? getComputedStyle(t).textDecorationLine : 'none'
    ].join('|');
  });
  return { stage: read('#mapkey span'), type: read('#mapkeyShapes span.sh') };
});

// ── 1. THREE ROWS, IN ORDER, AND THE THIRD IS NOT A TYPE ──────────────────────────
const headings = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.maplegend-wrap .mapkey-hd')).map(h => h.textContent.trim().replace(/\s+/g, ' ')));
ok(/^Stage/.test(headings[0]), '1: row 1 is Stage — pin color', headings[0]);
ok(/^Type/.test(headings[1]), '1b: row 2 is Type — pin shape', headings[1]);
ok(headings[2] === 'Regulatory records', '1c: row 3 is Regulatory records', headings[2]);
const typeLabels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#mapkeyShapes span.sh .t')).map(t => t.textContent.trim()));
ok(typeLabels.length === 7 && !typeLabels.some(l => /regulated facility/i.test(l)),
  '1d: the Type row is the seven project types and offers no "Regulated facility"', typeLabels.join(' / '));
const stageLabels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#mapkey span .t')).map(t => t.textContent.trim()));
ok(stageLabels.length === 4 && !stageLabels.some(l => /regulated facility/i.test(l)),
  '1e: the Stage row is the four stages and offers no "Regulated facility"', stageLabels.join(' / '));

// ── 2. THE CONTROL AND ITS COPY ───────────────────────────────────────────────────
ok(await page.evaluate(() => document.getElementById('regToggle').getAttribute('role')) === 'switch',
  '2: the control is a real on/off switch, exposed as one');
ok((await page.textContent('#regToggle')).includes('Show regulatory facilities'),
  '2b: the switch is labelled "Show regulatory facilities"', (await page.textContent('#regToggle')).trim());
const helper = (await page.textContent('#mapkeyRegHelp')).trim();
ok(helper === 'Purple R = environmental regulatory record. Includes EPA and linked state, '
            + 'local, tribal, and federal records.', '2c: the helper text is the founder copy, verbatim', helper);
ok(await page.evaluate(() => !!document.querySelector('#regToggle svg text')),
  '2d: the switch shows the same purple R the map draws');
ok(await regState() === 'true', '2e: it starts ON — a record is never hidden by default');

// ── 3. THE BADGE IS AN OVERLAY IN THE LOWER-RIGHT CORNER ──────────────────────────
const on = await markers();
ok(on.length === 3, '3: the three production records render', on.length);
const dual = on.filter(m => m.polygons === 1 && m.rBadge);
ok(dual.length === 1, '3b: the regulated data centre keeps its octagon AND gains the R badge', dual.length);
ok(dual[0].badgeX > 7 && dual[0].badgeY > 7,
  '3c: the badge sits in the LOWER-RIGHT corner of a 14px pin',
  dual[0].badgeX + ',' + dual[0].badgeY);
ok(dual[0].badgeW < 14 * 0.8, '3d: …and is visually secondary to the project marker',
  dual[0].badgeW + ' < ' + (14 * 0.8));
ok(on.filter(m => m.purple && m.polygons === 0 && !m.rBadge).length === 1,
  '3e: a regulatory-only location draws a standalone purple square');
ok(on.filter(m => m.polygons === 1 && !m.purple).length === 1,
  '3f: a project with no regulatory record gets no purple at all — nothing is invented');

// ── 4. THE SWITCH OWNS THE BADGE AND THE REGULATORY-ONLY LOCATIONS, AND NOTHING ELSE ─
const lookBefore = await rowsLook();
await clickReg();
ok(await regState() === 'false', '4: clicking the switch turns it off');
const off = await markers();
ok(off.length === 2, '4b: OFF -> the regulatory-only location is hidden', off.length);
ok(off.filter(m => m.rBadge).length === 0, '4c: OFF -> no R badge is painted anywhere');
ok(off.filter(m => m.polygons === 1).length === 2,
  '4d: OFF -> BOTH data centres are still drawn — the project is never hidden by this switch', off.length);
// The founder's list, measured against the rendered rows: nothing about Stage or Type may
// change, gray out, strike through, hide or reset.
const lookAfter = await rowsLook();
ok(JSON.stringify(lookAfter.stage) === JSON.stringify(lookBefore.stage),
  '4e: the Stage row is pixel-for-pixel unchanged — same state, opacity, decoration, visibility');
ok(JSON.stringify(lookAfter.type) === JSON.stringify(lookBefore.type),
  '4f: the Type row is pixel-for-pixel unchanged too', lookAfter.type.join(' ; '));
ok(lookAfter.type.every(r => r.split('|')[1] === 'true' && r.split('|')[4] === 'none'),
  '4g: …every Type chip is still pressed, and none is struck through');

// ── 5. IT IS REVERSIBLE, AND THE BADGE COMES BACK ON THE ALREADY-DRAWN PIN ────────
await clickReg();
ok(await regState() === 'true', '5: clicking again turns it back on');
const back = await markers();
ok(back.length === 3 && back.filter(m => m.rBadge).length === 1,
  '5b: the badge is repainted on the pin that is already on the map', back.filter(m => m.rBadge).length);
ok(JSON.stringify(await rowsLook()) === JSON.stringify(lookBefore),
  '5c: …and the other two rows are still untouched');

// ── 6. THE OTHER DIRECTION — Stage and Type never move the regulatory switch ──────
await page.click('#mapkey span:has-text("Approved")');
await page.waitForTimeout(150);
ok(await regState() === 'true', '6: clicking a Stage chip does not touch the regulatory switch');
await page.click('#mapkeyShapes span.sh[data-cat="datacenter"]');
await page.waitForTimeout(150);
ok(await regState() === 'true', '6b: clicking a Type chip does not touch it either');
// …and Stage still composes with the badge: hiding a stage hides the pin, badge and all.
ok((await markers()).every(m => !m.rBadge || m.polygons === 1),
  '6c: a badge only ever exists on a pin that is itself visible');

ok(pageErrors.length === 0, '7: no uncaught page errors', pageErrors.join(' | '));

await browser.close();
srv.close();
console.log('\n' + (fails ? fails + ' FAILED' : 'map1-regulatory-toggle: all checks passed'));
process.exit(fails ? 1 : 0);

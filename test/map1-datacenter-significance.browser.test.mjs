// MAP 1 — DATA CENTER SIGNIFICANCE, read off the real page.
//
// THE RESIDENT TEST, and the only one that matters: a 285,282 SF ground-up data hall
// and a data-centre SIGN PERMIT must no longer say the same thing.
//
// Every fixture is VERBATIM production text (app_projects, 2026-09-06). The records are
// served through the authoritative ZIP path — the flagship surface — so this proves the
// permit class survives the RPC → zipAuthSiteFromMarker → marker → popup chain.
//
// Run: node test/map1-datacenter-significance.browser.test.mjs
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
await new Promise(r => srv.listen(8813, '127.0.0.1', r));
const base = 'http://127.0.0.1:8813';

// The three real records, one per significance state.
const P = [
  { ref: 'mesa', name: 'Commercial/Industrial Projects New ground up 285,282 SF unlimited area data hall building with type II-B construction. G',
    type: 'Commercial', type_raw: 'Commercial/Industrial Projects', status: 'Approved', lat: 33.4200, lng: -111.7300 },
  { ref: 'qts', name: 'QTS DATA CENTER',
    type: 'Development', type_raw: 'SIGN  PERMIT', status: 'Proposed', lat: 33.4520, lng: -112.0600 },
  { ref: 'sanjose', name: 'Data Center 123  GREAT OAKS BL  , SAN JOSE CA 95119',
    type: 'Industrial', type_raw: 'Data Center', status: 'Operating', lat: 33.4400, lng: -112.0400 }
];
const ZIP_AUTH = { '85006': { zip: '85006', mode: 'development', status: 'boundary_complete',
  projects: P.map(p => ({ source_key: 'k:' + p.ref, project_ref: p.ref, name: p.name, type: p.type,
    type_raw: p.type_raw, status: p.status, registry_id: 'phoenix-building-permits',
    source_ref: 'https://example.gov/' + p.ref, submitted_at: '2026-01-04', date_kind: 'filed',
    impact_score: null, impact_dimensions: null })),
  markers: P.map((p, i) => ({ project_ref: p.ref, lat: p.lat, lng: p.lng,
    marker_rule: 'POINT_AUTHORITATIVE', marker_seq: i })) } };
const ZIP_ROW = { '85006': [{ zip: '85006', home_lat: 33.4520, home_lng: -112.0600,
  counts: { facilities: 0, development: 3 }, sites: [], refreshed_at: '2026-09-06T00:00:00Z',
  facilities_unavailable: false }] };
const COMMUNITIES = { '85006': [{ name: 'Phoenix (85006)', level: 'zip', county: 'Maricopa', state: 'AZ' }] };

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

await page.goto(base + '/homesignalmap.html?zip=85006', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES) && window.__HS_SITES.length > 0, null, { timeout: 30000 });
await page.waitForTimeout(600);

// What a resident actually reads: the popup's subheader line, via the page's own labeller.
const read = () => page.evaluate(() => (window.__HS_SITES || []).map(s => ({
  label: (s.label || '').slice(0, 60),
  kind: window.__HS_KIND(s),
  shape: window.__HS_RESOLVE_TRACKER(s).shape,
  category: window.__HS_RESOLVE_TRACKER(s).categoryKey
})));
const rows = await read();
const by = (frag) => rows.filter(r => r.label.indexOf(frag) !== -1)[0];

ok(rows.length === 3, '0: all three production records render on the authoritative ZIP path', rows.length);

const mesa = by('New ground up 285,282 SF');
const qts = by('QTS DATA CENTER');
const sj = by('Data Center 123');
ok(!!mesa && !!qts && !!sj, '0b: each of the three is present');

// ── THE PRODUCT PROBLEM, BEFORE AND AFTER ───────────────────────────────────────
// BEFORE this unit all three read the same: their lifecycle stage and nothing else.
ok(/Major development/.test(mesa.kind),
  '1: the 285,282 SF ground-up data hall now reads MAJOR DEVELOPMENT', mesa.kind);
ok(/Ancillary work/.test(qts.kind),
  '2: the data-centre SIGN PERMIT now reads ANCILLARY WORK', qts.kind);
// Stated so it cannot pass on the stage words alone: BOTH must carry a significance
// phrase, and the two phrases must differ. Under a mutation that drops the significance
// line these read "Approved / permitted" and "Proposed / hearing" — already different,
// which is exactly why "!==" was not enough to prove anything.
const SIG_RE = /(Major development|Ancillary work|Significance not stated)/;
const mesaSig = (mesa.kind.match(SIG_RE) || [])[1];
const qtsSig = (qts.kind.match(SIG_RE) || [])[1];
ok(!!mesaSig && !!qtsSig && mesaSig !== qtsSig,
  '3: THE ACCEPTANCE TEST — the ground-up build and the sign permit now carry DIFFERENT significance',
  mesaSig + ' vs ' + qtsSig);
ok(/Significance not stated/.test(sj.kind),
  '4: a record stating no activity says so — the resident is never left to infer "minor"', sj.kind);

// ── The stage is still there: significance ADDS, it does not replace ─────────────
ok(/Approved \/ permitted/.test(mesa.kind) && /Proposed \/ hearing/.test(qts.kind),
  '5: each still carries its lifecycle stage — significance is a second dimension, not a swap');

// ── TYPE AND SYMBOL UNCHANGED ───────────────────────────────────────────────────
ok(mesa.category === 'datacenter' && qts.category === 'datacenter' && sj.category === 'datacenter',
  '6: all three are still Data center');
ok(mesa.shape === 'octagon' && qts.shape === 'octagon' && sj.shape === 'octagon',
  '7: …and all three still draw the same octagon — significance never changes the symbol');

// ── The rendered marker count is unchanged: no record was split or duplicated ────
const v = await page.evaluate(() => window.__HS_VERIFY);
ok(v.mapMarkers === 3 && v.visibleMarkers === 3,
  '8: three records, three markers — significance created no new pins', v.mapMarkers + '/' + v.visibleMarkers);

// ── Geography untouched ─────────────────────────────────────────────────────────
const coords = await page.evaluate(() => (window.__HS_SITES || []).map(s => [s.label.slice(0, 20), s.lat, s.lng]));
ok(coords.some(c => c[1] === 33.42 && c[2] === -111.73),
  '9: each record renders at its own authoritative coordinate — nothing moved');

ok(pageErrors.length === 0, '10: no fatal client error', pageErrors.join(' | '));

console.log('='.repeat(78));
console.log('FAILS: ' + fails);
console.log('='.repeat(78));
await browser.close();
srv.close();
process.exit(fails ? 1 : 0);

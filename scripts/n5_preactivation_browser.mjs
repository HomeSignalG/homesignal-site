// n5_preactivation_browser.mjs — the BROWSER half of the N5 pre-activation proof (Fix 5).
//
// Before a READY generation may replace the one serving Map 1, the orchestrator
// (scripts/n5_orchestrate.py `prove`) reads, for a sample of ZIPs, the answer Map 1 would give
// under EACH generation — geo.n5_zip_projects_markers_at(<generation>, zip, 'development'), the
// one function public.app_zip_projects_markers itself calls for the serving generation
// (docs/map1-zip-read-generation.sql) — and hands both to this script. For every ZIP and both
// generations it opens the real homesignalmap.html in Chromium, answers the page's own
// app_zip_projects_markers request with that generation's answer, and compares what the page
// rendered (window.__HS_SITES, the ZIP-authoritative sites) with what the shipped builder
// (lib/zip-authoritative.js, run here in Node) says that answer contains.
//
// A ZIP passes when, under BOTH generations, the page rendered exactly the sites the answer
// holds, and the page's own difference between the two equals the answers' difference. Every
// other data plane (data centres, facilities, the cached report) is answered EMPTY and
// identically on both sides, so nothing but the generation can make the two renders differ.
//
// Input  (--input FILE): {candidate_generation_id, baseline_generation_id,
//                         zips: [{zip, home_lat, home_lng, candidate: <payload>, baseline: <payload>}]}
// Output (--out FILE, and the last stdout line): {candidate_generation_id, baseline_generation_id,
//          passed, zips_checked, mismatches, differing_zips, zips: [...per-ZIP summary...]}
// The page is served from this checkout on 127.0.0.1; nothing here reads production.
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

globalThis.window = globalThis.window || globalThis;
for (const f of ['lib/project-type.js', 'lib/map.js', 'lib/residential-qualify.js', 'lib/n5-radius.js', 'lib/zip-authoritative.js']) {
  (0, eval)(readFileSync(join(REPO, f), 'utf8'));
}
const HS = globalThis.window.HS;

// The page's own record-URL gate (homesignalmap.html sourced()).
const sourced = (s) => !!(s && ((s.url && String(s.url).trim()) || (s.record_url && String(s.record_url).trim())));
const siteKey = (s) => [s.zip_project_ref, s.zip_marker_seq, s.lat, s.lng].join('|');

/** The sites the shipped builder makes from one answer, as sorted keys. */
export function expectedKeys(payload) {
  return HS.zipAuthSitesFrom(payload).filter(sourced).map(siteKey).sort();
}

function diff(a, b) {
  const nb = new Map();
  b.forEach((k) => nb.set(k, (nb.get(k) || 0) + 1));
  const out = [];
  a.forEach((k) => { const n = nb.get(k) || 0; if (n) nb.set(k, n - 1); else out.push(k); });
  return out;
}
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
               '.svg': 'image/svg+xml', '.png': 'image/png' };

async function serve() {
  const srv = createServer(async (q, s) => {
    const p = normalize(join(REPO, decodeURIComponent(q.url.split('?')[0])));
    if (!p.startsWith(REPO)) { s.writeHead(403); return s.end(); }
    try { s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/plain' }); s.end(await readFile(p)); }
    catch { s.writeHead(404); s.end('nope'); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, base: 'http://127.0.0.1:' + srv.address().port };
}

const STUB_SUPABASE = 'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(){return Promise.resolve({data:null,error:null});},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** Render one ZIP under one answer; return the ZIP-authoritative sites the page rendered. */
async function render(browser, base, z, payload, markersRpc) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  let served = 0;
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const report = [{ zip: z.zip, home_lat: z.home_lat, home_lng: z.home_lng, counts: {}, sites: [],
                    paywall: false, refreshed_at: '2026-01-01T00:00:00Z', facilities_unavailable: false }];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    const body = route.request().postData() || '';
    if (url.includes('/rpc/' + markersRpc)) {
      if (/"development"/.test(body)) { served++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }); }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ zip: z.zip, mode: 'facility', status: payload && payload.status, projects: [], markers: [] }) });
    }
    if (url.includes('/rpc/zip_mode_report_sites'))
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ zip: z.zip, status: 'complete', sites: [], facility_counts: { member: 0, outside: 0, not_measured: 0, no_coordinates: 0 } }) });
    if (url.includes('/rest/v1/development_reports'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) });
    if (url.includes('leaflet@') && (url.endsWith('leaflet.js') || url.endsWith('leaflet.css'))) {
      const css = url.endsWith('.css');
      let local = null;
      try { local = require.resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch { local = null; }
      if (local) return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript', body: await readFile(local, 'utf8') });
      return route.continue();
    }
    if (url.includes('cdn.jsdelivr.net/npm/@supabase'))
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_SUPABASE });
    if (/tile|arcgisonline|openstreetmap/.test(url))
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (url.includes('/rest/v1/') || url.includes('/rpc/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  try {
    await page.goto(base + '/homesignalmap.html?zip=' + encodeURIComponent(z.zip), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 90000 });
    await page.waitForTimeout(500);
    const rendered = await page.evaluate(() => (window.__HS_SITES || [])
      .filter((s) => s && s.zip_authoritative === true)
      .map((s) => [s.zip_project_ref, s.zip_marker_seq, s.lat, s.lng].join('|')));
    return { rendered: rendered.sort(), served, errors };
  } catch (e) {
    return { rendered: null, served, errors: errors.concat(String(e && e.message).slice(0, 200)) };
  } finally {
    await ctx.close();
  }
}

/** Compare every sample ZIP. `tamper(zip, side, payload)` (tests only) alters what the PAGE is
 *  served while the expectation is still taken from the input, so a test can prove a wrong
 *  render is caught. `markersRpc` (tests only) is the RPC name the page's request is matched on. */
export async function runParity(input, { browser, tamper, markersRpc = 'app_zip_projects_markers' } = {}) {
  const { srv, base } = await serve();
  const out = { candidate_generation_id: input.candidate_generation_id,
                baseline_generation_id: input.baseline_generation_id,
                zips_checked: 0, mismatches: 0, differing_zips: 0, zips: [] };
  try {
    for (const z of input.zips || []) {
      const rec = { zip: z.zip };
      const sides = {};
      for (const side of ['candidate', 'baseline']) {
        const payload = z[side];
        const expected = expectedKeys(payload);
        const toPage = tamper ? tamper(z.zip, side, JSON.parse(JSON.stringify(payload))) : payload;
        const r = await render(browser, base, z, toPage, markersRpc);
        sides[side] = { expected, rendered: r.rendered };
        rec[side] = { status: payload && payload.status, expected: expected.length,
                      rendered: r.rendered ? r.rendered.length : null, served: r.served,
                      equal: !!r.rendered && r.served > 0 && sameList(expected, r.rendered),
                      errors: r.errors.slice(0, 3) };
      }
      const c = sides.candidate, b = sides.baseline;
      const loaded = c.rendered && b.rendered && rec.candidate.served > 0 && rec.baseline.served > 0;
      if (loaded) {
        const pageAdded = diff(c.rendered, b.rendered), pageGone = diff(b.rendered, c.rendered);
        const dbAdded = diff(c.expected, b.expected), dbGone = diff(b.expected, c.expected);
        rec.added = dbAdded.length; rec.removed = dbGone.length;
        rec.diff_equal = sameList(pageAdded.sort(), dbAdded.sort()) && sameList(pageGone.sort(), dbGone.sort());
        if (dbAdded.length || dbGone.length) out.differing_zips++;
        out.zips_checked++;
      }
      rec.ok = !!loaded && rec.candidate.equal && rec.baseline.equal && rec.diff_equal;
      if (!rec.ok) out.mismatches++;
      out.zips.push(rec);
    }
  } finally {
    srv.close();
  }
  out.passed = out.mismatches === 0 && out.zips_checked > 0 && out.zips_checked === (input.zips || []).length;
  return out;
}

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const inPath = arg('--input'), outPath = arg('--out');
  if (!inPath) { console.error('usage: node scripts/n5_preactivation_browser.mjs --input FILE [--out FILE]'); process.exit(2); }
  const input = JSON.parse(readFileSync(inPath, 'utf8'));
  const { chromium } = await import('playwright');
  const opts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.HS_CHROME) opts.executablePath = process.env.HS_CHROME;
  const browser = await chromium.launch(opts);
  let res;
  try { res = await runParity(input, { browser }); } finally { await browser.close(); }
  for (const z of res.zips) {
    console.log(`${z.ok ? 'PASS' : 'FAIL'} — ${z.zip}: candidate ${z.candidate.rendered}/${z.candidate.expected}`
      + ` · serving ${z.baseline.rendered}/${z.baseline.expected} · +${z.added ?? '?'} -${z.removed ?? '?'}`
      + (z.ok ? '' : `  ${JSON.stringify({ c: z.candidate.errors, b: z.baseline.errors, diff_equal: z.diff_equal })}`));
  }
  const summary = { ...res, zips: res.zips.map(({ zip, ok, added, removed }) => ({ zip, ok, added, removed })) };
  if (outPath) writeFileSync(outPath, JSON.stringify(summary));
  console.log(JSON.stringify({ passed: res.passed, zips_checked: res.zips_checked, mismatches: res.mismatches,
                               differing_zips: res.differing_zips }));
  process.exit(res.passed ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(2); });
}

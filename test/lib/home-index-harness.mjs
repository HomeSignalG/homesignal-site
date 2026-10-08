// Browser-suite harness for the homepage and the shared header (test/home-index.browser.test.mjs,
// test/navigation-v3.browser.test.mjs). Serves this checkout, answers every network call from
// fixtures, and opens a page. NO NETWORK: supabase-js is replaced by a stub whose answers each
// test chooses (projects per ZIP, community rows, geocoder matches, delays, failures), and
// Map 1's own fetches (app_zip_projects_markers, zip_mode_report_sites, development_reports) are
// answered at the route level. Leaflet is served from the local npm copy CI installs beside
// playwright. This file does not import playwright: the suites that use it do, which is how
// scripts/run-unit-tests.mjs classifies them as browser suites.
import { createServer } from 'node:http';
import { readFile } from './serve-page.mjs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png' };
export async function serve() {
  const srv = createServer(async (q, s) => {
    const p = normalize(join(REPO, decodeURIComponent(q.url.split('?')[0])));
    try { s.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'text/plain' }); s.end(await readFile(p)); }
    catch { s.writeHead(404); s.end('nope'); }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { srv, base: 'http://127.0.0.1:' + srv.address().port };
}

export const PROJECTS_78657 = [
  { id: 'p1', source_key: 'k1', name: 'Horseshoe Bay Resort Marina Expansion', type: 'Commercial', status: 'Proposed', stage: 'Site plan under review', source_ref: 'https://example.gov/p1', submitted_at: '2026-09-10', lat: 30.54, lng: -98.37 },
  { id: 'p2', source_key: 'k2', name: 'FM 2147 Bridge Replacement', type: 'Roads & Infrastructure', status: 'Approved', stage: 'Contract awarded', source_ref: 'https://example.gov/p2', submitted_at: '2026-08-20', lat: 30.55, lng: -98.36 },
  { id: 'p3', source_key: 'k3', name: 'Applehead Island Townhomes', type: 'Residential', status: 'Operating', source_ref: 'https://example.gov/p3', submitted_at: '2026-07-02', lat: 30.53, lng: -98.38 },
  { id: 'p4', source_key: 'k4', name: 'Fourth record', type: 'Commercial', status: 'Proposed', source_ref: 'https://example.gov/p4', submitted_at: '2026-06-01', lat: 30.53, lng: -98.39 }
];
const ZIP_AUTH = (zip) => zip === '78657' ? { zip, mode: 'development', status: 'boundary_complete',
  projects: PROJECTS_78657.map(p => ({ source_key: p.source_key, project_ref: p.source_key, name: p.name, type: p.type, status: p.status, registry_id: 'x', source_ref: p.source_ref, submitted_at: p.submitted_at, date_kind: 'filed' })),
  markers: PROJECTS_78657.map((p, i) => ({ project_ref: p.source_key, lat: p.lat, lng: p.lng, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0 })) }
  : { zip, mode: 'development', status: 'boundary_complete', projects: [], markers: [] };

export function supabaseStub(opts = {}) {
  return `
window.__invokes = []; window.__rpcs = []; window.__tables = [];
window.supabase = { createClient: function () {
  var OPTS = ${JSON.stringify(opts)};
  function table(name) {
    var call = { table: name, eq: [] }; window.__tables.push(call);
    var api = {};
    ['update','upsert','delete','neq','in','is','or','not','gt','gte','lt','lte','like','ilike','contains','overlaps','order','limit','range','filter','match']
      .forEach(function (m) { api[m] = function () { return api; }; });
    api.select = function (cols) { call.select = cols == null ? '' : String(cols); return api; };
    api.insert = function (rows) { call.insert = rows; return api; };
    api.eq = function (c, v) { call.eq.push([c, v]); return api; };
    api.single = function () { return Promise.resolve({ data: null, error: { code: 'PGRST116' } }); };
    api.maybeSingle = function () { return Promise.resolve({ data: null, error: null }); };
    api.then = function (res, rej) {
      var rows = [];
      var z = (call.eq.find(function (e) { return e[0] === 'zip'; }) || [])[1];
      if (name === 'app_community_meta' && OPTS.meta && OPTS.meta[z]) rows = [OPTS.meta[z]];
      if (name === 'app_properties' && !call.insert && OPTS.properties) rows = OPTS.properties;
      var p = Promise.resolve({ data: rows, error: null });
      var d = OPTS.delayTable && OPTS.delayTable[z];
      if (d) p = new Promise(function (r) { setTimeout(function () { r({ data: rows, error: null }); }, d); });
      return p.then(res, rej);
    };
    return api;
  }
  return {
    from: table,
    rpc: function (fn, args) {
      window.__rpcs.push({ fn: fn, args: args });
      if (fn === 'app_projects_for_zip' && args && args.p_kind === 'development') {
        var z = args.p_zip; var rows = (OPTS.projects && OPTS.projects[z]) || [];
        if (OPTS.failProjects && OPTS.failProjects.indexOf(z) >= 0) return Promise.resolve({ data: null, error: { message: 'boom' } });
        var d = OPTS.delayRpc && OPTS.delayRpc[z];
        return new Promise(function (r) { setTimeout(function () { r({ data: rows, error: null }); }, d || 0); });
      }
      return Promise.resolve({ data: null, error: null });
    },
    functions: { invoke: function (fn, o) {
      var a = o && o.body && o.body.address; window.__invokes.push({ fn: fn, address: a });
      var g = (OPTS.geocode || {})[a];
      var d = (OPTS.delayGeocode || {})[a] || 0;
      return new Promise(function (r) { setTimeout(function () {
        if (g === 'OUTAGE') r({ data: null, error: { message: 'geocoder_unavailable' } });
        else r({ data: { match: g || null }, error: null });
      }, d); });
    } },
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: OPTS.session || null } }); },
      signOut: function () { return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    }
  };
} };`;
}

export async function open(browser, base, path, { width = 1440, height = 1000, stub = {}, reducedMotion, waitReady = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reducedMotion || 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('leaflet@1.9.4/dist/leaflet')) {
      // A local copy where one is installed (a sandbox without egress); otherwise the CDN,
      // exactly as test/place-context-map-fits-frame.browser.test.mjs does on CI.
      const css = url.endsWith('.css');
      let local = null;
      try { local = require.resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch (e) { local = null; }
      if (!local) return route.continue();
      return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript', body: await readFile(local, 'utf8') });
    }
    if (url.includes('cdn.jsdelivr.net') && /supabase/.test(url)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: supabaseStub(stub) });
    if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript', body: '' });
    if (url.includes('/rpc/app_zip_projects_markers')) {
      let z = ''; try { z = String(JSON.parse(route.request().postData() || '{}').p_zip || ''); } catch (e) {}
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ZIP_AUTH(z)) });
    }
    if (url.includes('/rpc/zip_mode_report_sites')) {
      let z = ''; try { z = String(JSON.parse(route.request().postData() || '{}').p_zip || ''); } catch (e) {}
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ zip: z, status: 'complete', sites: [], facility_counts: { member: 0, outside: 0, not_measured: 0, no_coordinates: 0 } }) });
    }
    if (url.includes('/rest/v1/development_reports')) {
      const z = (url.match(/zip=eq\.(\d{5})/) || [])[1];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(z ? [{ zip: z, home_lat: 30.54, home_lng: -98.37, counts: {}, refreshed_at: '2026-09-30T00:00:00Z' }] : []) });
    }
    if (url.includes('tile.openstreetmap') || url.includes('arcgisonline'))
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
    if (url.includes('/rest/v1/') || url.includes('/rpc/') || url.includes('/functions/v1/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  if (waitReady) {
    await page.waitForFunction(() => window.HS && window.HS.ready, null, { timeout: 30000 });
    await page.evaluate(() => window.HS.ready);
  }
  return { ctx, page, errors };
}

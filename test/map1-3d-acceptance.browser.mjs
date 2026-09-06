// MAP 1 — 3D CROSS-BROWSER ACCEPTANCE MATRIX.
//
// THE PASS CONDITION, and it is the only one:
//   On every browser, selecting a 3D view either (A) loads successfully, or (B) returns the
//   resident automatically to a functioning 2D Leaflet map with the approved browser-neutral
//   notice. NEVER a black panel. "Never a black panel" is MEASURED, not asserted: the map
//   frame is screenshotted and rejected if it is essentially uniform panel background.
//
// Run one browser at a time (the operator supplies the engine — this repo's sandbox can only
// obtain Chromium, so Gecko and WebKit rows must be run where those binaries exist):
//   BROWSER=chromium node test/map1-3d-acceptance.browser.mjs
//   BROWSER=firefox  node test/map1-3d-acceptance.browser.mjs
//   BROWSER=webkit   node test/map1-3d-acceptance.browser.mjs          # Safari engine
//   BROWSER=webkit  DEVICE=mobile node test/map1-3d-acceptance.browser.mjs   # mobile Safari
//   BROWSER=chromium DEVICE=mobile node test/map1-3d-acceptance.browser.mjs  # mobile Chrome
//
// Brave runs the Chromium engine, so the chromium rows cover its rendering. What Brave (or
// any browser) can change is whether a WebGL context is granted — which is exactly what the
// `webgl-blocked` scenario simulates, deterministically, on every engine.
//
// Network is stubbed by default so the matrix is deterministic and touches no production
// service. LIVE=1 uses the real CDNs and tile hosts instead, for a final on-network pass.
import { chromium, firefox, webkit, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = process.env.BROWSER || 'chromium';
const MOBILE = process.env.DEVICE === 'mobile';
const LIVE = process.env.LIVE === '1';
const VENDOR = process.env.VENDOR_DIR || '';   // optional local copies of the CDN bundles
const LAUNCHER = { chromium, firefox, webkit }[ENGINE];
if (!LAUNCHER) { console.error('BROWSER must be chromium | firefox | webkit'); process.exit(2); }

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png' };
const server = createServer((req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root) || !existsSync(p) || !statSync(p).isFile()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

// A visible stand-in tile: any non-background colour proves imagery reached the canvas/DOM.
const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHUlEQVQoU2NkYGD4z0AEYBxVSFJ' +
  'IGDWMYdQwhlHDGEYNAwCJggQBpJgTfQAAAABJRU5ErkJggg==', 'base64');

// A production-shaped cached report row (columns exactly as public.development_reports).
const mkSite = (e, n, lat, lng, type, label, scope) => ({
  e, n, lat, lng, src: 'Box Elder County', url: 'https://example.gov/record/1',
  type, label, layer: 'industrial', scope, approx: scope === 'area',
  decided: false, rel_rule: 'category:planning', relevance: 'development' });
const mkRow = (home) => ({
  zip: '84302', home_lat: home ? 41.5079 : null, home_lng: home ? -112.0152 : null,
  counts: { civic: 8, approved: 13, proposed: 53, operating: 13, facilities: 22, development: 79 },
  sites: [ mkSite(0.18, 0, 41.5079, -112.0152, 'proposed', 'Public Hearing Notice', 'area'),
           mkSite(0.4, 0.3, 41.512, -112.010, 'operating', 'Acme Plant', 'point'),
           mkSite(-0.5, -0.2, 41.503, -112.021, 'approved', 'New Subdivision', 'point') ],
  paywall: false, refreshed_at: new Date().toISOString(), facilities_unavailable: false });

const APPROVED = '3D view isn’t available on this device or browser right now. '
               + 'You’ve been returned to the 2D map.';

const browser = await LAUNCHER.launch();

// Is the frame essentially one flat colour? That is the defect this whole change exists to
// prevent, so it is measured from real rendered pixels rather than inferred from the DOM.
async function frameIsFlat(page) {
  const el = await page.$('.map-frame');
  const png = await el.screenshot();
  // Count distinct coarse colours across the PNG bytes. A real map (imagery, markers,
  // controls, or a notice strip over a map) is never a single flat field.
  const uniq = new Set();
  for (let i = 0; i < png.length - 3; i += 997) uniq.add(png[i] + ',' + png[i + 1] + ',' + png[i + 2]);
  return { flat: uniq.size < 6, distinct: uniq.size };
}

async function scenario(name, opts) {
  const ctx = await browser.newContext(
    MOBILE ? { ...devices[ENGINE === 'webkit' ? 'iPhone 13' : 'Pixel 7'] } : { viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  if (opts.blockWebGL) {
    await page.addInitScript(() => {
      const G = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (t, o) {
        return /webgl/i.test(t) ? null : G.call(this, t, o);
      };
    });
  }
  if (!LIVE) {
    await page.route('**://cdn.jsdelivr.net/**', (rt) => {
      const u = rt.request().url();
      const local = (rel, ct) => {
        if (!VENDOR) return null;
        const f = join(VENDOR, rel);
        return existsSync(f) ? rt.fulfill({ status: 200, contentType: ct, body: readFileSync(f) }) : null;
      };
      if (opts.blockCDN && /three/.test(u)) return rt.abort();
      if (/three\.min\.js/.test(u)) return local('three-0.132.2/build/three.min.js', 'text/javascript') || rt.continue();
      if (/maplibre-gl\.js/.test(u)) return local('maplibre-gl-4.7.1/dist/maplibre-gl.js', 'text/javascript') || rt.continue();
      if (/leaflet\.js/.test(u)) return local('leaflet-1.9.4/dist/leaflet.js', 'text/javascript') || rt.continue();
      if (/leaflet\.css/.test(u)) return local('leaflet-1.9.4/dist/leaflet.css', 'text/css') || rt.continue();
      if (/maplibre-gl\.css/.test(u)) return local('maplibre-gl-4.7.1/dist/maplibre-gl.css', 'text/css') || rt.continue();
      if (/supabase-js/.test(u)) return rt.fulfill({ status: 200, contentType: 'text/javascript',
        body: 'window.supabase={createClient:()=>({from:()=>({select:()=>({eq:()=>({order:()=>Promise.resolve({data:[],error:null})})})}),rpc:()=>Promise.resolve({data:null,error:null})})};' });
      return rt.fulfill({ status: 200, contentType: 'text/javascript', body: '/*stub*/' });
    });
    await page.route('**://*.supabase.co/**', (rt) => {
      const u = rt.request().url();
      if (/development_reports/.test(u)) return rt.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([mkRow(!opts.noHome)]) });
      if (/app_community_meta/.test(u)) return rt.fulfill({ status: 200, contentType: 'application/json', body: '[{"indexable":true}]' });
      if (/communities/.test(u)) return rt.fulfill({ status: 200, contentType: 'application/json',
        body: '[{"name":"Brigham City","level":"city","county":"Box Elder","state":"Utah"}]' });
      return rt.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    });
    for (const host of ['**://server.arcgisonline.com/**', '**://elevation-tiles-prod.s3.amazonaws.com/**',
                        '**://*.tile.openstreetmap.org/**'])
      await page.route(host, (rt) => rt.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  }

  await page.goto(base + '/homesignalmap.html?zip=84302', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);

  for (const [v, viewName] of [['3d', '3D aerial'], ['gl', '3D satellite']]) {
    await page.evaluate((v) => document.querySelector(`#viewSeg button[data-v="${v}"]`).click(), v);
    await page.waitForTimeout(6500);
    const st = await page.evaluate(() => {
      const m = document.getElementById('mapMsg');
      const host = document.querySelector('#viewSeg button.on').getAttribute('data-v');
      const panel = host === 'gl' ? 'mapgl' : host === '3d' ? 'map3d' : null;
      return {
        active: host,
        notice: m.hidden ? null : (m.querySelector('.mm-t') || {}).textContent,
        noticeIsStrip: m.classList.contains('mm-bar'),
        map2dShown: getComputedStyle(document.getElementById('map')).display !== 'none',
        leafletTiles: document.querySelectorAll('#map img.leaflet-tile').length,
        leafletPane: !!document.querySelector('#map .leaflet-container'),
        glCanvas: !!document.querySelector('#mapgl canvas'),
        glChrome: document.querySelectorAll('#mapgl .maplibregl-ctrl').length,
        threeCanvas: !!document.querySelector('#map3d canvas'),
        panel,
      };
    });
    const flat = await frameIsFlat(page);
    const label = `[${ENGINE}${MOBILE ? '/mobile' : ''}] ${name} · ${viewName}`;

    // OUTCOME A — the 3D view loaded.
    const loadedA = st.active === v && (v === 'gl' ? (st.glCanvas && st.glChrome > 0) : st.threeCanvas);
    // OUTCOME B — returned to a FUNCTIONING 2D map, with the approved neutral notice.
    const loadedB = st.active === '2d' && st.map2dShown && st.leafletPane
                    && st.notice === APPROVED && st.noticeIsStrip;

    ok(loadedA || loadedB, `${label} — 3D loaded OR graceful return to 2D`, st);
    ok(!flat.flat, `${label} — the map frame is NEVER a flat/black panel`, flat);
    if (loadedB) {
      // 2D must remain USABLE after a failed 3D selection, not merely visible.
      const usable = await page.evaluate(() => {
        const c = document.querySelector('#map .leaflet-container');
        if (!c) return { ok: false, why: 'no leaflet container' };
        const r = c.getBoundingClientRect();
        return { ok: r.width > 200 && r.height > 200, w: Math.round(r.width), h: Math.round(r.height),
                 panes: document.querySelectorAll('#map .leaflet-pane').length };
      });
      ok(usable.ok && usable.panes > 0, `${label} — 2D map remains usable after the failed 3D selection`, usable);
      ok(!/brave|shields|fingerprint|settings/i.test(st.notice || ''),
        `${label} — the notice names no browser and no setting`, st.notice);
    }
    // Return to 2D between views so each scenario step starts clean.
    await page.evaluate(() => document.querySelector('#viewSeg button[data-v="2d"]').click());
    await page.waitForTimeout(500);
  }
  await ctx.close();
}

console.log(`\n=== 3D ACCEPTANCE — engine=${ENGINE} device=${MOBILE ? 'mobile' : 'desktop'} network=${LIVE ? 'live' : 'stubbed'} ===\n`);
await scenario('webgl available', {});
await scenario('webgl blocked', { blockWebGL: true });
await scenario('report has no home point', { noHome: true });
await scenario('3D library blocked', { blockCDN: true });
await browser.close();
server.close();
console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);

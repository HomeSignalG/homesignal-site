// verify-map-markers.mjs — unit + live browser checks that marker renderers use
// HS.resolveMarker (actual DOM/SVG geometry and color, not resolver-only).
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { surfaceBanner } from './lib/surface-banner.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_BASE = (process.env.SITE_BASE || 'http://localhost:8765').replace(/\/$/, '');
const MAPS_PATH = process.env.MAPS_PATH || '/maps.html';
const DASH_PATH = process.env.DASH_PATH || '/dashboard.html';
const TRACKER_PATH = process.env.TRACKER_PATH || '/homesignalmap.html';
const target = SITE_BASE + MAPS_PATH;

function runUnit() {
  const res = spawnSync(process.execPath, [join(root, 'test/map-markers.test.mjs')], { stdio: 'inherit', cwd: root });
  if (res.status !== 0) process.exit(res.status || 1);
}

function startServer() {
  if (process.env.SITE_BASE) return null;
  const proc = spawn(process.execPath, ['-m', 'http.server', '8765'], { cwd: root, stdio: 'ignore' });
  return proc;
}

async function waitForServer(url, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok || res.status === 404) return;
    } catch (_) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Local server did not become ready at ' + url);
}

async function gotoWithRetry(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  } catch (e) {
    if (!String(e && e.message).includes('Timeout')) throw e;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
}

async function verifyMaps(page, fails) {
  await gotoWithRetry(page, target);
  await page.waitForFunction(
    () => window.__HS_MAP && Array.isArray(window.__HS_MAP.items) && typeof window.__HS_MARKER_DOM_VERIFY === 'function',
    { timeout: 30000 }
  );

  const focusDom = await page.evaluate(() => window.__HS_MARKER_DOM_VERIFY('#mapSch'));
  if (focusDom.length) fails.push('Focus/schematic DOM: ' + JSON.stringify(focusDom));

  await page.click('[data-mode="street"]');
  await page.waitForTimeout(2000);
  const streetDom = await page.evaluate(() => window.__HS_MARKER_DOM_VERIFY('#mapgl'));
  if (streetDom.length) fails.push('Street/MapLibre DOM: ' + JSON.stringify(streetDom));

  await page.click('[data-mode="satellite"]');
  await page.waitForTimeout(2500);
  const satDom = await page.evaluate(() => window.__HS_MARKER_DOM_VERIFY('#mapgl'));
  if (satDom.length) fails.push('Satellite/MapLibre DOM: ' + JSON.stringify(satDom));

  const fixtureSummary = await page.evaluate(() => {
    const FIXTURES = [
      { type: 'Industrial', status: 'Proposed' },
      { type: 'Data Center', status: 'Approved' },
      { type: 'Residential', status: 'Active' },
      { type: 'Industrial', status: 'Operating', _facility: true }
    ];
    return FIXTURES.map((it) => {
      const m = window.__HS_RESOLVE(it);
      return { type: it.type, facility: !!it._facility, shape: m.shape, color: m.color };
    });
  });
  console.log('Fixture resolver summary:', JSON.stringify(fixtureSummary, null, 2));
}

async function verifyLeafletRing(browser, fails) {
  // Regression guard for the radius ring on the tile maps. The ring is a Leaflet
  // VECTOR OVERLAY (an <svg> in a map pane); a broad `.mapwrap svg{width:100%}` rule
  // once collapsed that overlay to 0x0 with overflow:hidden, silently CLIPPING the ring
  // (it existed in the DOM but never painted, while HTML marker pins were unaffected).
  // Headless Chromium uses WebGL -> the MapLibre canvas path, which can't regress this;
  // block MapLibre so the page falls back to Leaflet and we actually exercise it.
  const page = await browser.newPage();
  await page.route(/maplibre-gl@.*\.js/i, (r) => r.abort());
  try {
    await gotoWithRetry(page, target);
    // The overlay <svg> only exists once Leaflet draws a vector layer (the ring).
    await page.waitForSelector('#maplf .leaflet-overlay-pane svg', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const res = await page.evaluate(() => {
      const glShown = (() => { const g = document.getElementById('mapgl'); return !!(g && getComputedStyle(g).display !== 'none'); })();
      const svg = document.querySelector('#maplf .leaflet-overlay-pane svg');
      if (!svg) return { err: 'no-overlay-svg', glShown };
      const r = svg.getBoundingClientRect();
      return { glShown, svgW: Math.round(r.width), svgH: Math.round(r.height),
        ringPaths: document.querySelectorAll('#maplf .leaflet-overlay-pane path').length };
    });
    if (res.glShown) {
      fails.push('Leaflet ring check did not reach the Leaflet fallback (WebGL still active): ' + JSON.stringify(res));
    } else if (res.err) {
      fails.push('Leaflet ring: ' + res.err);
    } else if (!(res.svgW > 0 && res.svgH > 0)) {
      fails.push('Leaflet overlay SVG collapsed to ' + res.svgW + 'x' + res.svgH +
        ' — the radius ring is clipped and will not paint (see app.css .mapwrap svg rule).');
    } else if (res.ringPaths < 1) {
      fails.push('Leaflet radius-ring path missing: ' + JSON.stringify(res));
    } else {
      console.log('Leaflet ring OK: overlay svg ' + res.svgW + 'x' + res.svgH + ', ' + res.ringPaths + ' overlay path(s).');
    }
  } finally {
    await page.close();
  }
}

async function verifyDashboard(page, fails) {
  await gotoWithRetry(page, SITE_BASE + DASH_PATH);
  await page.waitForFunction(() => typeof window.HS !== 'undefined' && !!document.getElementById('dashMap'), { timeout: 25000 });
  await page.waitForTimeout(3000);
  const dash = await page.evaluate(() => {
    const fails = [];
    const mapEl = document.getElementById('dashMap');
    if (!mapEl) return [{ err: 'missing-dashMap' }];
    const svgs = mapEl.querySelectorAll('svg');
    const markers = mapEl.querySelectorAll('.maplibregl-marker svg, .leaflet-marker-icon svg, g.hspin svg');
    const pins = markers.length ? markers : svgs;
    if (!pins.length) return [{ err: 'dashboard-no-markers' }];
    // WAS: "at least one marker must be a triangle". That asserted a DATA condition — the
    // triangle is the `industrial` category, so the check failed whenever the dashboard's live
    // items happened to contain none, and it was red daily. The rendering claim it was reaching
    // for (the polygon path emits the right vertex count) is deterministic and now lives in
    // test/maps-category-contract.test.mjs §12c, where it always runs.
    // What IS invariant here: every rendered pin must carry real geometry. A blank marker is a
    // genuine rendering regression; an absent category is not.
    const shapes = { polygon: 0, rect: 0, circle: 0, none: 0 };
    pins.forEach((svg) => {
      const html = svg.outerHTML || '';
      if (/<polygon\b/.test(html)) shapes.polygon++;
      else if (/<rect\b/.test(html)) shapes.rect++;
      else if (/<circle\b/.test(html)) shapes.circle++;
      else shapes.none++;
    });
    if (shapes.none) fails.push({ err: 'dashboard-marker-without-geometry', shapes });
    // Reported either way, so a shift in the rendered mix is visible rather than silent.
    fails.push({ info: 'dashboard-shape-histogram', shapes });
    // Matches lib/map.js with ANY cache key. It used to hard-code ?v=20260720b, which
    // silently became an assertion that the file was STALE — the key is content-derived
    // now and changes with every edit, so pinning one value would fail on the next fix.
    const mapJs = Array.from(document.scripts).some((s) => /lib\/map\.js(\?|$)/.test(s.src || ''));
    if (!mapJs) fails.push({ err: 'dashboard-stale-mapjs-cache-bust' });
    return fails;
  });
  const dashInfo = dash.filter((d) => d.info);
  const dashFails = dash.filter((d) => !d.info);
  if (dashInfo.length) console.log('Dashboard: ' + JSON.stringify(dashInfo));
  if (dashFails.length) fails.push('Dashboard: ' + JSON.stringify(dashFails));
}

async function verifyTracker(page, fails) {
  await gotoWithRetry(page, SITE_BASE + TRACKER_PATH);
  await page.waitForFunction(() => typeof window.__HS_TRACKER_MARKER_VERIFY === 'function', { timeout: 20000 });
  const trackerFails = await page.evaluate(() => window.__HS_TRACKER_MARKER_VERIFY());
  if (trackerFails.length) fails.push('Tracker: ' + JSON.stringify(trackerFails));
}

async function main() {
  surfaceBanner('verify-map-markers');
  console.log('=== map-markers unit tests ===');
  runUnit();

  const server = startServer();
  if (server) {
    console.log('Starting local static server on :8765 …');
    await waitForServer(SITE_BASE + '/');
  }

  console.log('\n=== map-markers browser verify: ' + SITE_BASE + ' ===');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const fails = [];

  try {
    await verifyMaps(page, fails);
    await verifyLeafletRing(browser, fails);
    await verifyDashboard(page, fails);
    await verifyTracker(page, fails);
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  if (fails.length) {
    console.error('\nVERIFY FAILED:\n' + fails.join('\n'));
    process.exit(1);
  }
  console.log('\nmap-markers browser verification passed (Focus, Street, Satellite, Leaflet radius ring, Dashboard, Tracker legend).');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});

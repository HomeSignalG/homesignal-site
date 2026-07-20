// verify-map-markers.mjs — unit + live browser checks that marker renderers use
// HS.resolveMarker (actual DOM/SVG geometry and color, not resolver-only).
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
    let sawTriangle = false;
    pins.forEach((svg) => {
      const html = svg.outerHTML || '';
      if (html.indexOf('points=') !== -1) {
        const m = html.match(/points="([^"]+)"/);
        if (m && m[1].trim().split(/\s+/).filter(Boolean).length === 3) sawTriangle = true;
      }
    });
    if (!sawTriangle) fails.push({ err: 'dashboard-no-triangle-marker' });
    const mapJs = Array.from(document.scripts).some((s) => /lib\/map\.js\?v=20260720b/.test(s.src || ''));
    if (!mapJs) fails.push({ err: 'dashboard-stale-mapjs-cache-bust' });
    return fails;
  });
  if (dash.length) fails.push('Dashboard: ' + JSON.stringify(dash));
}

async function verifyTracker(page, fails) {
  await gotoWithRetry(page, SITE_BASE + TRACKER_PATH);
  await page.waitForFunction(() => typeof window.__HS_TRACKER_MARKER_VERIFY === 'function', { timeout: 20000 });
  const trackerFails = await page.evaluate(() => window.__HS_TRACKER_MARKER_VERIFY());
  if (trackerFails.length) fails.push('Tracker: ' + JSON.stringify(trackerFails));
}

async function main() {
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
  console.log('\nmap-markers browser verification passed (Focus, Street, Satellite, Dashboard, Tracker legend).');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});

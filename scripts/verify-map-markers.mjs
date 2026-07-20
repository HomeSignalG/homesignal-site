// verify-map-markers.mjs — live browser check that every maps.html renderer path
// uses HS.resolveMarker (pin DOM matches resolver; no industrial→square regression).
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const MAPS_PATH = process.env.MAPS_PATH || '/maps.html';
const target = SITE_BASE + MAPS_PATH;

function runUnit() {
  const res = spawnSync(process.execPath, [join(root, 'test/map-markers.test.mjs')], { stdio: 'inherit', cwd: root });
  if (res.status !== 0) process.exit(res.status || 1);
}

async function gotoWithRetry(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    if (!String(e && e.message).includes('Timeout')) throw e;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  }
}

async function main() {
  console.log('=== map-markers unit tests ===');
  runUnit();

  console.log('\n=== map-markers browser verify: ' + target + ' ===');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const fails = [];

  try {
    await gotoWithRetry(page, target);
    await page.waitForFunction(
      () => window.__HS_MAP && Array.isArray(window.__HS_MAP.items) && typeof window.__HS_MARKER_VERIFY === 'function',
      { timeout: 25000 }
    );

    const focusFails = await page.evaluate(() => window.__HS_MARKER_VERIFY());
    if (focusFails.length) fails.push('Focus/schematic: ' + JSON.stringify(focusFails));

    // Street (Leaflet) — same resolver via pinEl after mode switch.
    await page.click('[data-mode="street"]');
    await page.waitForTimeout(1500);
    const streetFails = await page.evaluate(() => window.__HS_MARKER_VERIFY());
    if (streetFails.length) fails.push('Street/Leaflet: ' + JSON.stringify(streetFails));

    // Satellite (MapLibre).
    await page.click('[data-mode="satellite"]');
    await page.waitForTimeout(2000);
    const satFails = await page.evaluate(() => window.__HS_MARKER_VERIFY());
    if (satFails.length) fails.push('Satellite/MapLibre: ' + JSON.stringify(satFails));

    const sample = await page.evaluate(() => {
      const items = window.__HS_MAP.items || [];
      return items.slice(0, 8).map(function (it) {
        const m = window.__HS_RESOLVE(it);
        return { id: it.id, type: it.type, facility: !!it._facility, shape: m.shape, color: m.color };
      });
    });
    console.log('Sample resolved markers:', JSON.stringify(sample, null, 2));
  } finally {
    await browser.close();
  }

  if (fails.length) {
    console.error('\nVERIFY FAILED:\n' + fails.join('\n'));
    process.exit(1);
  }
  console.log('\nmap-markers browser verification passed (Focus, Street, Satellite).');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});

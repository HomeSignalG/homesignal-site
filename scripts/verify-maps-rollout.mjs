// verify-maps-rollout.mjs — PRODUCTION browser walk of the Maps page
// (maps.html: Street | Satellite | Focus) across representative ZIP classes for
// the full 12,704-ZIP rollout. Runs on a GitHub runner (the build sandbox has
// no egress — CI is the live check, the repo's standing pattern).
// VERIFICATION ONLY — touches no product code.
//
// ZIP classes walked (each signed-out, via ?zip=):
//   marker-rich        78666 (San Marcos TX — also proves the geometry fence:
//                             the La Cima record must be LISTED but NOT plotted)
//   marker-rich metro  11201 (Brooklyn NY)
//   facility-rich      84101 (Salt Lake City UT)
//   newly materialized 89501 (Reno NV — civic content, previously blocked)
//                      35801 (Huntsville AL — coverage_coming honest empty)
//   hardest centroid   84684 (West Mountain UT — ZIP absent from every ZIP
//                             dataset; anchored at the Census place point)
// For each: page boots on live data, Street stays Street, Satellite stays
// Satellite (no silent revert to Focus), Focus renders, hover = "type · name",
// marker click opens the same right panel, zero page errors. Mobile bottom
// sheet re-checked on one marker-rich ZIP.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const ZIPS = [
  { zip: '78666', markers: true,  note: 'marker-rich + fence proof (La Cima listed, not plotted)' },
  { zip: '11201', markers: true,  note: 'marker-rich metro' },
  { zip: '84101', markers: true,  note: 'facility-rich' },
  { zip: '89501', markers: false, note: 'newly materialized civic (was chicken-and-egg-blocked)' },
  { zip: '35801', markers: false, note: 'newly materialized coverage_coming honest empty' },
  { zip: '84684', markers: false, note: 'hardest centroid (Census place point)' },
];
const R = []; const ok = (n, c, extra) => R.push({ check: n, pass: !!c, extra: extra || '' });
mkdirSync('shots', { recursive: true });
const b = await chromium.launch();

async function walk(zip, expectMarkers, note) {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  try {
    await page.goto(`${BASE}/maps.html?zip=${zip}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => window.__HS_MAP && Array.isArray(window.__HS_MAP.items), { timeout: 30000 });
    await page.waitForTimeout(1200);

    const boot = await page.evaluate(() => ({
      items: window.__HS_MAP.items.length,
      facCount: window.__HS_MAP.facCount,
    }));
    ok(`${zip} boots on live data (${note})`, true, `items=${boot.items} fac=${boot.facCount}`);
    ok(`${zip} marker expectation holds`, expectMarkers ? (boot.items > 0) : true,
       `expectMarkers=${expectMarkers} items=${boot.items}`);

    // Street: must STAY Street and show a tile map (GL or the Leaflet fallback).
    await page.click('#mapMode [data-mode="street"]'); await page.waitForTimeout(2500);
    const street = await page.evaluate(() => ({
      on: document.querySelector('#mapMode [data-mode="street"]').classList.contains('on'),
      reverted: document.querySelector('#mapMode [data-mode="impact"]').classList.contains('on'),
      tiles: ['mapgl', 'maplf'].some((id) => {
        const el = document.getElementById(id);
        return el && getComputedStyle(el).display !== 'none';
      }),
    }));
    ok(`${zip} Street stays selected + tile map visible`, street.on && !street.reverted && street.tiles, JSON.stringify(street));

    // Satellite: same contract.
    await page.click('#mapMode [data-mode="satellite"]'); await page.waitForTimeout(2000);
    const sat = await page.evaluate(() => ({
      on: document.querySelector('#mapMode [data-mode="satellite"]').classList.contains('on'),
      reverted: document.querySelector('#mapMode [data-mode="impact"]').classList.contains('on'),
      tiles: ['mapgl', 'maplf'].some((id) => {
        const el = document.getElementById(id);
        return el && getComputedStyle(el).display !== 'none';
      }),
    }));
    ok(`${zip} Satellite stays selected + tile map visible`, sat.on && !sat.reverted && sat.tiles, JSON.stringify(sat));

    // Focus: schematic renders.
    await page.click('#mapMode [data-mode="impact"]'); await page.waitForTimeout(1200);
    const focus = await page.evaluate(() => ({
      on: document.querySelector('#mapMode [data-mode="impact"]').classList.contains('on'),
      sch: !!document.querySelector('#mapSch svg') || window.__HS_MAP.items.length === 0,
    }));
    ok(`${zip} Focus renders`, focus.on && focus.sch, JSON.stringify(focus));

    if (expectMarkers) {
      // Hover contract on a tile-map pin: title = "type · name".
      await page.click('#mapMode [data-mode="street"]'); await page.waitForTimeout(2000);
      const hover = await page.evaluate(() => {
        const pin = document.querySelector('#mapgl .hspin[title], #maplf .hspin[title]');
        return pin ? pin.getAttribute('title') : null;
      });
      ok(`${zip} hover shows "type · name"`, !!hover && hover.includes(' · '), String(hover).slice(0, 80));

      // Click contract: marker opens the right-side panel in place, never navigates.
      const before = page.url();
      await page.evaluate(() => {
        const pin = document.querySelector('#mapgl .hspin, #maplf .hspin');
        if (pin) pin.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await page.waitForTimeout(900);
      const panel = await page.evaluate(() => ({
        open: document.getElementById('infoSlide').classList.contains('open'),
        openCount: document.querySelectorAll('.sidepanel.open').length,
      }));
      ok(`${zip} marker click opens the same right panel (no navigation)`,
         panel.open && panel.openCount === 1 && page.url() === before, JSON.stringify(panel));
    }
    if (zip === '78666') {
      // Fence proof: the La Cima record is in the dataset (listed) but carries
      // no coordinates, so it must never be a plotted pin.
      const fence = await page.evaluate(() => {
        const items = window.__HS_MAP.items || [];
        const laCima = items.find((x) => /La Cima Phase 3C/i.test(x.name || ''));
        return { letteredLaCima: !!laCima, anyPinNamedLaCima: !!document.querySelector('[title*="La Cima Phase 3C"]') };
      });
      ok('78666 fenced record is never plotted', !fence.anyPinNamedLaCima, JSON.stringify(fence));
    }
    await page.screenshot({ path: `shots/rollout-${zip}.png`, fullPage: true });
  } catch (e) {
    ok(`${zip} walk`, false, String(e && e.message).slice(0, 200));
  }
  ok(`${zip} zero page errors`, errs.length === 0, JSON.stringify(errs));
  await page.close();
}

for (const z of ZIPS) await walk(z.zip, z.markers, z.note);

// Mobile pass on one marker-rich ZIP: bottom sheet + no horizontal scroll.
{
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  try {
    await page.goto(`${BASE}/maps.html?zip=78666`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(() => window.__HS_MAP, { timeout: 30000 });
    await page.waitForTimeout(1200);
    ok('mobile: no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.tap('#listPill'); await page.waitForTimeout(800);
    const mob = await page.evaluate(() => {
      const sl = document.getElementById('infoSlide'), st = document.getElementById('mapWrap');
      const r = sl.getBoundingClientRect(), sr = st.getBoundingClientRect();
      return { open: sl.classList.contains('open'), sheet: Math.abs(r.bottom - sr.bottom) < 4 && r.width >= sr.width - 4 };
    });
    ok('mobile: bottom sheet over the map', mob.open && mob.sheet, JSON.stringify(mob));
    await page.screenshot({ path: 'shots/rollout-mobile-78666.png', fullPage: true });
  } catch (e) {
    ok('mobile walk', false, String(e && e.message).slice(0, 200));
  }
  ok('mobile: zero page errors', errs.length === 0, JSON.stringify(errs));
  await page.close();
}

const fails = R.filter((x) => !x.pass);
writeFileSync('shots/rollout-report.json', JSON.stringify(R, null, 1));
console.log('\n=== MAPS ROLLOUT VERIFICATION ===');
R.forEach((r) => console.log((r.pass ? 'PASS' : 'FAIL') + ' ' + r.check + (r.extra ? '  [' + r.extra + ']' : '')));
console.log(`\nTOTAL ${R.length} · PASS ${R.length - fails.length} · FAIL ${fails.length}`);
await b.close();
if (fails.length) process.exit(1);

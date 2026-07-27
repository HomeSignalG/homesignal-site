#!/usr/bin/env node
// Browser proof of the ICON PIPELINE the rest layer now depends on.
//
// The MapLibre rest layer draws a `symbol` per record, and its icons are generated
// locally at runtime: HS.markerSVG -> SVG data URI -> Image -> canvas -> getImageData
// -> glMap.addImage. Every step of that chain is browser-only, so no node assertion can
// reach it — and it is the one genuinely new mechanism in the fix. If any link breaks
// (a shape markerSVG cannot draw, a tainted canvas, a decode failure) the rest layer
// silently loses its markers, which is a worse failure than the circle bug it replaced.
//
// So this drives a REAL Chromium and asserts, per canonical symbol:
//   * the SVG decodes (no `img.onerror`),
//   * getImageData does NOT throw — a data: URI is same-origin and must not taint the
//     canvas (if it ever did, addImage would throw and the layer would render nothing),
//   * the raster is the 44x44 the layer registers at pixelRatio 2,
//   * it actually contains the record's STATUS colour (not a blank or black bitmap),
//   * and the shapes are geometrically DISTINCT from one another — a pipeline that
//     rasterized every symbol to the same blob would pass a naive "it drew something"
//     check while reproducing exactly the bug this fix removes.
//
// Run: node test/maps-rest-icon-raster.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP maps-rest-icon-raster — playwright not installed');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const STATUS_HEX = '#c47a1a';          // the canonical "Proposed" orange
const mapjs = readFileSync(join(root, 'lib/map.js'), 'utf8');
const browser = await chromium.launch({ headless: true });
let results;
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: 'window.HS = {};' });
  await page.addScriptTag({ content: mapjs });
  results = await page.evaluate(async (hex) => {
    const HS = window.HS, px = 44, out = [];
    for (const cat of Object.values(HS.CATEGORY_REGISTRY)) {
      const svg = HS.markerSVG(cat.symbol, hex, '', px);
      const r = await new Promise((done) => {
        const img = new Image(px, px);
        img.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = px; cv.height = px;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, px, px);
          try {
            // The exact call maps.html hands to glMap.addImage.
            const d = ctx.getImageData(0, 0, px, px);
            let opaque = 0, onColour = 0;
            for (let i = 0; i < d.data.length; i += 4) {
              if (d.data[i + 3] <= 200) continue;
              opaque++;
              // the fill, allowing for antialiasing against the white stroke
              if (d.data[i] > 180 && d.data[i + 1] > 90 && d.data[i + 1] < 160 && d.data[i + 2] < 80) onColour++;
            }
            done({ w: d.width, h: d.height, opaque, onColour });
          } catch (e) { done({ tainted: String(e.message) }); }
        };
        img.onerror = () => done({ decodeFailed: true });
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
      out.push(Object.assign({ symbol: cat.symbol, iconId: HS.restIconId(cat.symbol, hex) }, r));
    }
    return out;
  }, STATUS_HEX);
} finally {
  await browser.close();
}

console.log('\n-- every canonical symbol rasterizes into a real MapLibre image --');
check('one raster per canonical category', results.length === 8, String(results.length));
for (const r of results) {
  check(`${r.symbol}: SVG decodes in the browser`, !r.decodeFailed);
  check(`${r.symbol}: getImageData does not taint (data: URI is same-origin)`, !r.tainted, r.tainted);
  check(`${r.symbol}: raster is 44x44 (pixelRatio 2 of the 22px drawn size)`, r.w === 44 && r.h === 44,
    `${r.w}x${r.h}`);
  check(`${r.symbol}: the bitmap is not blank`, r.opaque > 200, 'opaque px=' + r.opaque);
  check(`${r.symbol}: it carries the record's STATUS colour`, r.onColour > 100, 'on-colour px=' + r.onColour);
}

console.log('\n-- the shapes are DISTINCT rasters, not one blob eight times --');
{
  // If every symbol rasterized identically the layer would draw one shape for everything —
  // the exact failure this fix exists to remove — while every check above still passed.
  const areas = results.filter((r) => !r.tainted && !r.decodeFailed).map((r) => r.opaque);
  const distinct = new Set(areas).size;
  check('each symbol covers a different pixel area', distinct === areas.length,
    results.map((r) => `${r.symbol}:${r.opaque}`).join(' '));
  const facility = results.find((r) => r.symbol === 'square');
  const datacenter = results.find((r) => r.symbol === 'octagon');
  check('the regulated-facility square and the data-center octagon rasterize differently',
    facility && datacenter && facility.opaque !== datacenter.opaque,
    `square=${facility && facility.opaque} octagon=${datacenter && datacenter.opaque}`);
}

console.log('\n-- icon ids stay unique per (shape, colour) --');
{
  const ids = results.map((r) => r.iconId);
  check('no two symbols share an icon id', new Set(ids).size === ids.length, ids.join(', '));
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll maps-rest-icon-raster checks passed.');

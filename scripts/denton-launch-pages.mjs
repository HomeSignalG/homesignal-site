// Denton launch audit, live-page half. READ ONLY: loads public pages, writes nothing.
// For each of the 32 ZIPs on desktop and mobile: the ZIP page and the Map 1 page.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.SITE_BASE || 'https://homesignal.net';
const ZIPS = '75007 75010 75022 75027 75028 75029 75033 75036 75056 75057 75065 75067 75068 75077 76201 76202 76203 76204 76205 76206 76207 76208 76209 76210 76226 76227 76247 76249 76258 76259 76262 76266'.split(' ');
if (ZIPS.length !== 32) throw new Error('ZIP list is not 32');
const VIEWS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };
const out = {};
const browser = await chromium.launch();
for (const z of ZIPS) {
  out[z] = {};
  for (const [vn, vp] of Object.entries(VIEWS)) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: vn === 'mobile' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
    const r = { errors: errs };
    try {
      const resp = await page.goto(`${BASE}/community/${z}/`, { waitUntil: 'networkidle', timeout: 60000 });
      r.zip_page = {
        status: resp && resp.status(), title: await page.title(),
        h1: await page.evaluate(() => (document.querySelector('h1') || {}).innerText || ''),
        mentions_zip: await page.evaluate(zz => (document.body.innerText || '').includes(zz), z),
        overflow_x: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      };
      await page.goto(`${BASE}/homesignalmap.html?zip=${z}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // wait until the page has written its site list (a property setter fires once per load)
      let n = -1;
      for (let i = 0; i < 40 && n < 0; i++) { await page.waitForTimeout(1500); n = await page.evaluate(() => Array.isArray(window.__HS_SITES) ? window.__HS_SITES.length : -1); }
      r.map = await page.evaluate(() => {
        const s = window.__HS_SITES || [];
        const dev = s.filter(x => x && x.relevance === 'development');
        const pick = x => ({ name: x.name || x.label || x.title, lat: x.lat, lng: x.lng, status: x.status || x.bucket, scope: x.scope, url: x.record_url || x.url || null });
        return {
          sites: s.length, development: dev.length, facility: s.length - dev.length,
          no_coords: dev.filter(x => x.lat == null || x.lng == null).length,
          scopes_all: s.reduce((o, x) => { const k = (x && (x.relevance || 'none')) + '/' + (x && (x.scope || 'none')); o[k] = (o[k] || 0) + 1; return o; }, {}),
          scopes: dev.reduce((o, x) => { o[x.scope || 'none'] = (o[x.scope || 'none'] || 0) + 1; return o; }, {}),
          no_record_url: dev.filter(x => !(x.record_url || x.url)).length,
          sample: dev.slice(0, 5).map(pick),
          // every area-scope (jurisdiction-level) record, by source identity, so what a fix removes from the map is provable
          area_sites: s.filter(x => x && x.scope === 'area').map(x => ({ rel: x.relevance || null, reg: x.source_registry_id || null, sid: x.source_id || x.case_number || null,
            name: (x.name || x.label || x.title || '').slice(0, 90), url: x.record_url || x.url || null, type: x.type || null, status: x.status || null })),
          point_sites: s.filter(x => x && x.scope === 'point').length,
          counters: Object.fromEntries(['cFac', 'cDev', 'cOpen', 'cTot'].map(id => [id, (document.getElementById(id) || {}).textContent ?? null])),
          lists: Object.fromEntries(['builtList', 'unknownList', 'apprList', 'propList'].map(id => {
            const el = document.getElementById(id);
            const rows = el ? [...el.children] : [];
            return [id, { rows: rows.length, first: rows.slice(0, 3).map(r => (r.innerText || '').replace(/\s+/g, ' ').slice(0, 110)) }];
          })),
          text_has_not_measured: /not measured yet|no mapped area|could not be read|couldn.t load/i.test(document.body.innerText || ''),
          leaflet_markers: document.querySelectorAll('.leaflet-marker-icon, .leaflet-interactive').length,
        };
      });
      r.map.loaded = n >= 0;
      // click-through: open the first marker and see whether a record link appears
      const mk = page.locator('.leaflet-marker-icon').first();
      if (await mk.count()) {
        try { await mk.click({ timeout: 4000 }); await page.waitForTimeout(600);
          r.map.popup_link = await page.evaluate(() => { const a = document.querySelector('.leaflet-popup a[href]'); return a ? a.href : null; });
        } catch (e) { r.map.popup_error = String(e).slice(0, 120); }
      }
    } catch (e) { r.fatal = String(e).slice(0, 300); }
    out[z][vn] = r;
    await ctx.close();
  }
  console.error('[pages]', z, JSON.stringify(out[z].desktop.map || out[z].desktop.fatal).slice(0, 160));
}
await browser.close();
if (process.env.OUT_PAGES) fs.writeFileSync(process.env.OUT_PAGES, JSON.stringify(out));
console.log('----- BEGIN DENTON PAGES JSON -----');
console.log(JSON.stringify(out));
console.log('----- END DENTON PAGES JSON -----');

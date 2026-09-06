// THROWAWAY DIAGNOSTIC — not a gate, not a verifier. Read-only against production.
//
// verify-map1-zip-states reports dev=0/fac=0 for 01001, 01009 and 08005 while 01004 renders.
// Its read cannot tell "the page never populated __HS_SITES" from "the ZIP genuinely has
// nothing", because it does `window.__HS_SITES || []` after swallowing its own timeout. This
// script exists to recover exactly that distinction and the reason behind it, and nothing else.
import { chromium } from 'playwright';

const BASE = process.env.SITE_BASE || 'https://homesignal.net';
const ZIPS = ['08005', '01001', '01004', '01009'];   // 01004 is the one that still renders

const browser = await chromium.launch();
console.log('DIAGNOSTIC — Map 1 ZIP render, against ' + BASE + '\n');

for (const zip of ZIPS) {
  const ctx  = await browser.newContext();          // fresh context per ZIP: no shared cache/state
  const page = await ctx.newPage();
  const errors = [], failed = [], sbCalls = [];

  page.on('pageerror', e => errors.push('UNCAUGHT: ' + (e && e.message ? e.message : String(e))));
  page.on('console',   m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 300)); });
  page.on('requestfailed', r => failed.push(r.failure()?.errorText + ' ' + r.url().split('?')[0]));
  page.on('response', async r => {
    const u = r.url();
    if (r.status() >= 400) failed.push('HTTP ' + r.status() + ' ' + u.split('?')[0]);
    // Supabase traffic: path + status only, never headers (the anon key rides in a header).
    if (u.includes('supabase.co')) sbCalls.push(r.status() + ' ' + u.replace(/^https:\/\/[^/]+/, '').split('?')[0]);
  });

  await page.goto(`${BASE}/homesignalmap.html?zip=${zip}`, { waitUntil: 'domcontentloaded' });

  // Sample over time: separates "never populated" from "populated late". The verifier reads at
  // ~3s, so a value appearing at 8s or 15s would mean the page is fine and the gate is too eager.
  const samples = [];
  for (const t of [3000, 5000, 7000]) {
    await page.waitForTimeout(t === 3000 ? 3000 : 2000);
    samples.push(await page.evaluate(() => {
      const s = window.__HS_SITES;
      return { at: null, type: typeof s, isArr: Array.isArray(s), len: Array.isArray(s) ? s.length : null };
    }));
  }

  const probe = await page.evaluate(() => ({
    hasHS:        typeof window.HS,
    zipAuthNote:  typeof (window.HS && window.HS.zipAuthNote),
    zipAuthOut:   typeof (window.HS && window.HS.zipAuthOutcome),
    mapLib:       typeof (window.HS && window.HS.CATEGORY_REGISTRY),
    sbClient:     typeof window.hsClient,
    mapSites:     typeof window.MAP_SITES,
    // what the resident would actually see, not just the verifier's global
    markers:      document.querySelectorAll('#map .leaflet-marker-icon').length,
    noteText:     (document.getElementById('scopeNote')?.textContent || '').slice(0, 120),
    freshLine:    (document.querySelector('.fresh')?.textContent || '').slice(0, 120),
    devCount:     (document.getElementById('cDev')?.textContent || '').trim(),
    facCount:     (document.getElementById('cFac')?.textContent || '').trim(),
  }));

  console.log(`── ${zip}`);
  console.log('   __HS_SITES @3s/5s/7s : ' + samples.map(s => s.type === 'undefined' ? 'undefined' : `array(${s.len})`).join('  ->  '));
  console.log('   rendered markers      : ' + probe.markers);
  console.log('   counters dev/fac      : ' + JSON.stringify(probe.devCount) + ' / ' + JSON.stringify(probe.facCount));
  console.log('   globals               : HS=' + probe.hasHS + ' zipAuthNote=' + probe.zipAuthNote +
              ' zipAuthOutcome=' + probe.zipAuthOut + ' categoryRegistry=' + probe.mapLib +
              ' hsClient=' + probe.sbClient + ' MAP_SITES=' + probe.mapSites);
  console.log('   scopeNote             : ' + JSON.stringify(probe.noteText));
  console.log('   freshness line        : ' + JSON.stringify(probe.freshLine));
  console.log('   supabase calls        : ' + (sbCalls.length ? sbCalls.join(' | ') : '(none)'));
  console.log('   failed requests       : ' + (failed.length ? failed.join(' | ') : '(none)'));
  console.log('   js errors             : ' + (errors.length ? '\n     - ' + errors.join('\n     - ') : '(none)'));
  console.log('');

  await ctx.close();
}
await browser.close();
console.log('DIAGNOSTIC COMPLETE — read-only, nothing written.');

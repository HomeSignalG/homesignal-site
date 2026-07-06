// Faithful render check for the 84336 development page (buckets a/b/c).
// Runs on the GitHub Actions runner (open egress): loads the REAL homesignalmap.html against the
// LIVE Supabase anon endpoint + real OSM tiles, waits for the resolved anchor + notices + parcel
// polygons to render, then (1) screenshots the full page and (2) prints a structured assertion of
// every honesty label so we can confirm nothing is faked or dropped. No stubs, no fixtures.
import { chromium } from 'playwright';
import fs from 'fs';

const ZIP = process.env.VERIFY_ZIP || '84336';
const URL = process.env.VERIFY_URL || ('http://localhost:8080/homesignalmap.html?zip=' + ZIP);
const OUT_PNG = 'verify/dev-tracker-' + ZIP + '.png';
const OUT_JSON = 'verify/dev-tracker-' + ZIP + '-assertions.json';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 2400 } });
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });

// Wait for the live-data-driven sections to populate (tolerant — each section is independent).
async function tryWait(sel, ms = 30000) { try { await page.waitForSelector(sel, { timeout: ms }); return true; } catch { return false; } }
await tryWait('#dtAnchorBody .dt-title');
await tryWait('#dtAnchorBody .dt-parcel');
await tryWait('#dtBucketC .rec');
await tryWait('#mapInner path.leaflet-interactive', 20000);
// let tiles + polygon fit settle
await page.waitForTimeout(3500);

const A = await page.evaluate(() => {
  const q = s => document.querySelector(s);
  const qa = s => Array.from(document.querySelectorAll(s));
  const txt = s => (q(s)?.textContent || '').trim();
  const vis = s => { const el = q(s); return !!el && getComputedStyle(el).display !== 'none'; };
  const flags = qa('#dtAnchorBody .dt-flag').map(f => f.textContent.trim());
  return {
    anchor_visible: vis('#dtAnchor'),
    title: txt('#dtAnchorBody .dt-title'),
    straddle: txt('#dtAnchorBody .dt-straddle'),
    status_tracks: qa('#dtAnchorBody .dt-track').map(t => ({
      k: (t.querySelector('.k')?.textContent || '').trim(),
      v: (t.querySelector('.v')?.textContent || '').trim(),
    })),
    unresolved_count: qa('#dtAnchorBody .dt-unresolved').length,
    aliases: qa('#dtAnchorBody .dt-alias .nm').map(n => n.textContent.trim()),
    warn_chips: qa('#dtAnchorBody .dt-chip.warn').map(c => c.textContent.trim()),
    parcels_rendered: qa('#dtAnchorBody .dt-parcel').length,
    adjacency_flags: flags.filter(f => /adjacency/i.test(f)).length,
    straddle_flags: flags.filter(f => /straddle/i.test(f)).length,
    bucket_b_empty_state: /class="empty"/.test(q('#dtBucketB')?.innerHTML || ''),
    bucket_b_recs: qa('#dtBucketB .rec').length,
    bucket_c_recs: qa('#dtBucketC .rec').length,
    county_wide_badges: qa('#dtBucketC .dt-badge').length,
    parcel_polygons_on_map: qa('#mapInner path.leaflet-interactive').length,
    parcel_caption_visible: vis('#parcelCaption'),
  };
});

fs.mkdirSync('verify', { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify({ zip: ZIP, url: URL, at: new Date().toISOString(), assertions: A, consoleErrors }, null, 2));
await page.screenshot({ path: OUT_PNG, fullPage: true });
await browser.close();

console.log('ASSERTIONS_JSON_START');
console.log(JSON.stringify(A, null, 2));
console.log('ASSERTIONS_JSON_END');
if (consoleErrors.length) { console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors, null, 2)); }
console.log('Screenshot:', OUT_PNG);

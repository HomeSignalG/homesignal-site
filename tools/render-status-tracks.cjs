// LIVE end-to-end render check (runs on a GitHub Actions runner, which has open
// egress to Supabase). Loads the real page over http://localhost, lets the page's
// own inline JS fetch LIVE Supabase with the embedded public anon key (NO interception,
// NO CSP bypass — the page's real Content-Security-Policy stays enforced), synchronizes
// on the actual network responses (which proves the live hit and gives the row counts),
// lets the page render, then writes the screenshot + a proof JSON into ./_render_out/
// for the workflow to commit & push (clean retrieval, no base64). No secrets — the anon
// key is already public in the page. Uses ONLY Node-side Playwright APIs (waitForResponse
// / element.screenshot); no page.evaluate / waitForFunction, so nothing here needs the
// page's CSP to allow 'unsafe-eval'.
const { chromium } = require('playwright');
const fs = require('fs');

const OUT = '_render_out';
const PAGES = [
  { file: 'box-elder.html',     name: 'box-elder' },
  { file: 'eagle-mountain.html', name: 'eagle-mountain' },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const proof = {};
  for (const pg of PAGES) {
    const context = await browser.newContext({ viewport: { width: 900, height: 1400 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    console.log(`\n===== RENDER ${pg.name} =====`);

    const trackP = page.waitForResponse(r => r.url().includes('/rest/v1/v_community_status_tracks'), { timeout: 25000 }).catch(() => null);
    const itemP  = page.waitForResponse(r => r.url().includes('/rest/v1/v_community_status_items'),  { timeout: 25000 }).catch(() => null);

    await page.goto(`http://localhost:8080/${pg.file}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const [tR, iR] = await Promise.all([trackP, itemP]);

    const p = { tracks_status: null, tracks_rows: null, items_status: null, items_rows: null };
    if (tR) { p.tracks_status = tR.status(); try { const j = await tR.json(); p.tracks_rows = Array.isArray(j) ? j.length : null; } catch {} }
    if (iR) { p.items_status  = iR.status();  try { const j = await iR.json(); p.items_rows  = Array.isArray(j) ? j.length  : null; } catch {} }
    proof[pg.name] = p;
    console.log(`LIVE_NET_PROOF ${pg.name}: ${JSON.stringify(p)}`);

    // give the page's own inline render a moment to write the DOM after the fetch resolves
    await page.waitForTimeout(1500);

    const el = await page.$('#status-track-section');
    const buf = await el.screenshot({ type: 'jpeg', quality: 72 });
    fs.writeFileSync(`${OUT}/${pg.name}.jpg`, buf);
    console.log(`WROTE ${OUT}/${pg.name}.jpg  ${buf.length} bytes`);
    await context.close();
  }
  fs.writeFileSync(`${OUT}/proof.json`, JSON.stringify(proof, null, 2));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

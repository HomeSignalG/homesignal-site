// LIVE end-to-end render check (runs on a GitHub Actions runner, which has open
// egress to Supabase). Loads the real page over http://localhost, lets the page's
// own JS fetch LIVE Supabase with the embedded anon key (NO interception), waits for
// the status-tracks panel to populate, captures the network response status as proof
// the live hit happened, screenshots the section, and emits it as base64 chunks in
// the job log for retrieval. No secrets used — the anon key is already public in the page.
const { chromium } = require('playwright');
const fs = require('fs');

const PAGES = [
  { file: 'box-elder.html',     name: 'box-elder' },
  { file: 'eagle-mountain.html', name: 'eagle-mountain' },
];

(async () => {
  const browser = await chromium.launch();
  for (const pg of PAGES) {
    const page = await browser.newPage({ viewport: { width: 900, height: 1400 }, deviceScaleFactor: 1 });
    const netProof = [];
    page.on('response', res => {
      const u = res.url();
      if (u.includes('/rest/v1/v_community_status_tracks') || u.includes('/rest/v1/v_community_status_items')) {
        netProof.push({ view: u.includes('tracks') ? 'tracks' : 'items', status: res.status(), url: u.split('?')[0] });
      }
    });
    console.log(`\n===== RENDER ${pg.name} =====`);
    await page.goto(`http://localhost:8080/${pg.file}`, { waitUntil: 'domcontentloaded' });
    let ok = true;
    try {
      await page.waitForFunction(() => {
        const g = document.getElementById('status-tracks');
        return g && !g.querySelector('.loading') && g.children.length > 0;
      }, { timeout: 30000 });
    } catch (e) { ok = false; console.log('WAIT TIMEOUT:', String(e)); }

    const readout = await page.evaluate(() => [...document.querySelectorAll('#status-tracks .track-card')].map(c => ({
      title: c.querySelector('.track-title')?.textContent,
      badge: c.querySelector('.track-head .conf-badge')?.textContent?.trim(),
      empty: !!c.querySelector('.track-empty'),
      directItems: c.querySelectorAll(':scope > .trk-item').length,
      moreItems: c.querySelectorAll('.track-more .trk-item').length,
      firstBadge: c.querySelector('.trk-item .conf-badge')?.textContent?.trim(),
      firstSource: c.querySelector('.trk-item .trk-meta')?.textContent?.trim()?.slice(0, 60),
    })));
    console.log(`LIVE_NET_PROOF ${pg.name}: ${JSON.stringify(netProof)}`);
    console.log(`RENDER_READOUT ${pg.name}: ${JSON.stringify(readout)}`);

    const el = await page.$('#status-track-section');
    const buf = await el.screenshot({ type: 'jpeg', quality: 55 });
    const b64 = buf.toString('base64');
    fs.writeFileSync(`/tmp/${pg.name}.jpg`, buf);
    console.log(`IMG_BYTES ${pg.name}: ${buf.length}  B64_LEN: ${b64.length}`);
    console.log(`===B64_BEGIN ${pg.name}===`);
    for (let i = 0; i < b64.length; i += 4000) console.log(b64.slice(i, i + 4000));
    console.log(`===B64_END ${pg.name}===`);
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

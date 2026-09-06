// FORENSIC: the exact browser boundary at which a dense authoritative ZIP fails.
//
// Not "payload size" by correlation - the actual stage. Captures, per ZIP: when the RPC
// request starts, whether it fails at the network layer (and with what error), the HTTP
// status, the response body's real byte length, whether JSON.parse succeeds, and only then
// the page-side conversion accounting.
import { chromium } from 'playwright';

const BASE = process.env.SITE_BASE || 'https://homesignal.net';
const ZIPS = (process.env.PROBE_ZIPS || '28456,30033,20148,28451').split(',').map(s => s.trim()).filter(Boolean);
const RPC = '/rpc/app_zip_projects_markers';

const browser = await chromium.launch();
console.log('MAP 1 DENSE-TRANSPORT BOUNDARY FORENSICS — ' + BASE + '\n');

for (const zip of ZIPS) {
  const page = await browser.newPage();
  const ev = { started: null, finished: null, status: null, bytes: null, parseOk: null,
               failed: null, failText: null, errBody: null };

  page.on('request', (r) => { if (r.url().includes(RPC)) ev.started = Date.now(); });
  page.on('requestfailed', (r) => {
    if (r.url().includes(RPC)) {
      ev.failed = true;
      ev.failText = (r.failure() && r.failure().errorText) || 'unknown';
      ev.finished = Date.now();
    }
  });
  page.on('response', async (res) => {
    if (!res.url().includes(RPC)) return;
    ev.status = res.status();
    try {
      const t = await res.text();          // proves the BODY actually arrived
      ev.bytes = t.length;
      ev.finished = Date.now();
      try { JSON.parse(t); ev.parseOk = true; }
      catch (e) { ev.parseOk = false; ev.errBody = String(e).slice(0, 160); }
      if (res.status() !== 200) ev.errBody = t.slice(0, 300);
    } catch (e) {
      ev.bytes = -1; ev.parseOk = false; ev.errBody = 'body read threw: ' + String(e).slice(0, 200);
      ev.finished = Date.now();
    }
  });

  const t0 = Date.now();
  await page.goto(`${BASE}/homesignalmap.html?zip=${zip}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__HS_SITES !== undefined, { timeout: 90000 }).catch(() => {});
  let prev = -1, stable = 0;
  for (let i = 0; i < 60 && stable < 3; i++) {
    await page.waitForTimeout(1000);
    const n = await page.evaluate(() => (window.__HS_SITES || []).length);
    stable = (n === prev) ? stable + 1 : 0; prev = n;
  }

  const pageState = await page.evaluate(() => {
    const live = window.__HS_SITES || [];
    const txt = document.body.innerText || '';
    return {
      total: live.length,
      authoritative: live.filter(s => s && s.zip_authoritative === true).length,
      couldNotRead: /could not be read/i.test(txt),
      notMeasured:  /not measured yet/i.test(txt),
      wholeZip:     /whole of ZIP|whole ZIP/i.test(txt),
    };
  });

  const ms = (ev.started && ev.finished) ? (ev.finished - ev.started) : null;
  console.log(`── ${zip}`);
  console.log(`   rpc network      failed=${ev.failed ? 'YES (' + ev.failText + ')' : 'no'}`);
  console.log(`   rpc http status  ${ev.status}`);
  console.log(`   body bytes       ${ev.bytes}`);
  console.log(`   rpc wall ms      ${ms}`);
  console.log(`   JSON.parse ok    ${ev.parseOk}`);
  if (ev.errBody) console.log(`   error body       ${ev.errBody}`);
  console.log(`   page total/auth  ${pageState.total} / ${pageState.authoritative}`);
  console.log(`   says could-not-read=${pageState.couldNotRead} not-measured=${pageState.notMeasured} whole-ZIP=${pageState.wholeZip}`);
  console.log(`   page wall ms     ${Date.now() - t0}`);
  console.log('');
  await page.close();
}
await browser.close();

// TEMPORARY DIAGNOSTIC v2 — Map 1 intermittent empty render. READ-ONLY.
//
// v1 sampled __HS_SITES at fixed points (1/3/5/10s) and never reproduced the failure, but it
// could not see a TRANSIENT value between samples — and the verifier's own timings imply it
// saw __HS_SITES defined-and-empty within ~100ms, which v1's first sample would have missed.
//
// v2 removes the sampling question entirely: it installs a property SETTER before any page
// script runs, so EVERY assignment to __HS_SITES is recorded with a timestamp, its shape, and
// the line that assigned it. Nothing can slip between samples because there are no samples.
//
// It also drives the page BOTH ways and compares:
//   verifier — ONE page, sequential goto per ZIP, replicating verify-map1-zip-states exactly
//   fresh    — a new context per load (what v1 did)
// so the difference between v1's result and the verifier's is measured rather than assumed.
//
// Writes nothing, anywhere. Production is untouched; the page's outer .catch() is patched only
// in this browser's copy, fail-closed on a missing anchor.
import { chromium } from 'playwright';

const BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const ZIPS = (process.env.ZIPS || '01001,01009,01004,94128').split(',').map(s => s.trim());
const REPS = parseInt(process.env.REPS || '3', 10);

const ANCHOR = `      .catch(function(){
        if(!currentReq(token)) return;
        window.__HS_SITES = [];`;
const PATCH = `      .catch(function(__e){
        try{ console.warn('HSCATCH ' + (__e && (__e.stack || __e.message || __e))); }catch(_){}
        if(!currentReq(token)) return;
        window.__HS_SITES = [];`;

// Records every write to __HS_SITES. Installed before the page's own scripts.
const TRACE = () => {
  window.__HS_TRACE = [];
  let v;
  Object.defineProperty(window, '__HS_SITES', {
    configurable: true,
    get() { return v; },
    set(x) {
      v = x;
      try {
        window.__HS_TRACE.push({
          t: Math.round(performance.now()),
          arr: Array.isArray(x),
          n: Array.isArray(x) ? x.length : null,
          dev: Array.isArray(x) ? x.filter(s => s && s.relevance === 'development').length : null,
          fac: Array.isArray(x) ? x.filter(s => s && s.relevance !== 'development').length : null,
          from: ((new Error()).stack || '').split('\n').slice(2, 3).join('').trim().slice(0, 90),
        });
      } catch (_) {}
    },
  });
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const rows = [];

async function wire(page) {
  await page.addInitScript(TRACE);
  await page.route('**/homesignalmap.html*', async (route) => {
    const resp = await route.fetch();
    const body = await resp.text();
    if (body.indexOf(ANCHOR) < 0) {
      console.error('FATAL: instrument anchor missing in production HTML — aborting');
      process.exit(2);
    }
    return route.fulfill({ response: resp, body: body.replace(ANCHOR, PATCH) });
  });
}

// Exactly what verify-map1-zip-states does, then record what IT would have measured.
async function driveLikeVerifier(page, zip, mode) {
  const warns = [], failed = [];
  const onC = (m) => { if (m.text().startsWith('HSCATCH')) warns.push(m.text().slice(0, 200)); };
  const onF = (r) => failed.push(((r.failure() || {}).errorText || '?') + ' ' + r.url().slice(-40));
  page.on('console', onC); page.on('requestfailed', onF);

  await page.goto(`${BASE}/homesignalmap.html?zip=${zip}`, { waitUntil: 'domcontentloaded' });
  const tWait0 = Date.now();
  await page.waitForFunction(() => window.__HS_SITES !== undefined, { timeout: 60000 }).catch(() => {});
  const waitedMs = Date.now() - tWait0;
  await page.waitForTimeout(3000);                       // the verifier's fixed 3s
  const asVerifier = await page.evaluate(() => {
    const s = window.__HS_SITES || [];
    return { dev: s.filter(x => x && x.relevance === 'development').length,
             fac: s.filter(x => x && x.relevance !== 'development').length };
  });
  await page.waitForTimeout(9000);                        // then let it fully settle
  const settled = await page.evaluate(() => {
    const s = window.__HS_SITES || [];
    return { dev: s.filter(x => x && x.relevance === 'development').length,
             fac: s.filter(x => x && x.relevance !== 'development').length };
  });
  const trace = await page.evaluate(() => window.__HS_TRACE || []);
  page.off('console', onC); page.off('requestfailed', onF);
  rows.push({ mode, zip, waitedMs, asVerifier, settled, trace, warns, failed });
}

// MODE 1 — one page, sequential, exactly as the verifier drives it
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await wire(page);
  for (let r = 0; r < REPS; r++) for (const zip of ZIPS) await driveLikeVerifier(page, zip, 'verifier');
  await ctx.close();
}
// MODE 2 — fresh context per load
for (let r = 0; r < REPS; r++) for (const zip of ZIPS) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await wire(page);
  await driveLikeVerifier(page, zip, 'fresh');
  await ctx.close();
}
await browser.close();

console.log(`\nMap 1 empty-render diagnostic v2 — ${BASE} — ${ZIPS.join(',')} x${REPS} x2 modes\n`);
const tally = {};
for (const r of rows) {
  const key = r.mode + ' ' + r.zip;
  tally[key] = tally[key] || { pass: 0, fail: 0 };
  const verdict = (r.asVerifier.dev > 0 || r.asVerifier.fac > 0) ? 'pass' : 'fail';
  tally[key][verdict]++;
  console.log(`${r.mode.padEnd(8)} ${r.zip} waitFn=${String(r.waitedMs).padStart(5)}ms `
    + `| AS-VERIFIER dev/fac ${r.asVerifier.dev}/${r.asVerifier.fac} ${verdict === 'fail' ? '<<< EMPTY' : ''}`
    + ` | settled ${r.settled.dev}/${r.settled.fac}`);
  console.log(`         writes to __HS_SITES: ${r.trace.length
    ? r.trace.map(w => `t=${w.t}ms ${w.arr ? `[${w.n}] dev=${w.dev} fac=${w.fac}` : 'NON-ARRAY'}`).join('  ->  ')
    : 'NONE'}`);
  for (const w of r.trace) if (w.from) console.log(`             from ${w.from}`);
  for (const w of r.warns) console.log(`         ${w}`);
  for (const f of r.failed) console.log(`         REQFAIL ${f}`);
}
console.log('\n── tally (what the verifier WOULD have recorded) ──');
for (const k of Object.keys(tally).sort())
  console.log(`  ${k}: ${tally[k].pass} pass / ${tally[k].fail} EMPTY`);

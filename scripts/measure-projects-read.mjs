// Measure the projects() read — the BEFORE/AFTER number for the maps-uncap change.
//
// WHY A SEPARATE INSTRUMENT. `spot-check-shell.mjs` answers a yes/no question at a fixed
// settle deadline ("was `.strip` there at 6,500 ms?"). That cannot report a DURATION, and
// on a ZIP that lands near the deadline two runs of the identical build disagree — which
// is exactly what happened on 57104. A threshold cannot measure a change whose whole
// point is a number, so this reads the number directly.
//
// TWO MEASUREMENTS, BOTH ON THE LIVE SITE AS AN ORDINARY VISITOR:
//
//   1. PAGE — `community.html?zip=<zip>`, timed with waitForSelector('.strip') rather than
//      a fixed wait. `.strip` is the score rail, which community.html renders only AFTER
//      projects + facilities + changes + meetings have all resolved (it is built in the one
//      `page.innerHTML = …` assignment that follows those four awaits), so its appearance
//      is the honest "the resident can see the page" moment. A timeout is reported as a
//      timeout, never as a number.
//
//   2. DATA A/B — both read paths, in the same live browser, against the same live DB,
//      with the same public anon key, alternating so drift hits both equally:
//        NEW  HS.rpcAllRows(zip, kind)        — one `app_projects_for_zip` payload
//        OLD  HS.fetchAllPages(<the exact pre-change query>) — 1,000-row range windows
//      `fetchAllPages` is still exported and still correct, so the OLD path is the SHIPPED
//      helper, not a reimplementation of it. This is what makes the comparison honest:
//      the "before" number is measured, not remembered from a prior deploy.
//
// Read-only: no write, no RPC other than the read, nothing persisted. Exits 0 even when a
// page times out — a slow page is a finding, not a broken instrument. Exit 2 only if the
// harness itself could not run (no ZIPs, browser launch failure).
//
//   ZIPS="57104,28468,84302" REPS=3 node scripts/measure-projects-read.mjs
import { appendFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SITE_BASE = process.env.SITE_BASE || 'https://homesignal.net';
const ZIPS = (process.env.ZIPS || '57104,28468,84302').split(',').map(s => s.trim()).filter(Boolean);
const REPS = Math.max(1, parseInt(process.env.REPS || '3', 10));
const PAGE_TIMEOUT_MS = Math.max(30000, parseInt(process.env.PAGE_TIMEOUT_MS || '180000', 10));
// A light ZIP whose page loads fast — it is only the HOST for the in-page A/B, never the
// subject of it. The A/B queries whatever ZIP is under test regardless of what is on screen.
const HOST_ZIP = process.env.HOST_ZIP || '84302';
if (!ZIPS.length) { console.error('Set ZIPS="12345,…"'); process.exit(2); }

const browser = await chromium.launch();

// ── 1. PAGE: time to the score rail, one fresh context per rep (no warm cache) ────────
const pageRows = [];
for (const zip of ZIPS) {
  for (let rep = 1; rep <= REPS; rep++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
    let ms = null, outcome = '';
    try {
      await page.goto(`${SITE_BASE}/community.html?zip=${zip}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const t0 = Date.now();
      await page.waitForSelector('.strip', { timeout: PAGE_TIMEOUT_MS });
      ms = Date.now() - t0;
      outcome = 'rendered';
    } catch (e) {
      // Distinguish "still loading past the deadline" from "the page reported it cannot
      // load" — the honest can't-load state is a DIFFERENT defect from slowness.
      const text = await page.evaluate(() => (document.body.innerText || '').trim()).catch(() => '');
      outcome = /can.?t load|couldn.?t load/i.test(text) ? 'LOAD-ERROR state'
        : /coverage[^.]*coming|isn.?t covered yet/i.test(text) ? 'coverage-coming (no rail by design)'
        : `TIMEOUT >${PAGE_TIMEOUT_MS}ms`;
    }
    pageRows.push({ zip, rep, ms, outcome, err: errors[0] || '' });
    console.log(`page ${zip} rep${rep}: ${ms === null ? outcome : ms + ' ms'}${errors.length ? ' JSERR ' + errors[0].slice(0, 70) : ''}`);
    await ctx.close();
  }
}

// ── 2. DATA A/B: NEW rpc vs OLD range windows, alternating, in one live page ──────────
const ctx = await browser.newContext();
const host = await ctx.newPage();
await host.goto(`${SITE_BASE}/community.html?zip=${HOST_ZIP}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await host.waitForSelector('.strip', { timeout: 120000 }).catch(() => {});
const ready = await host.evaluate(() => !!(window.HS && window.HS.rpcAllRows && window.HS.fetchAllPages && window.supabase));
if (!ready) { console.error('host page did not expose HS.rpcAllRows / HS.fetchAllPages / supabase'); await browser.close(); process.exit(2); }

const abRows = [];
for (const zip of ZIPS) {
  for (let rep = 1; rep <= REPS; rep++) {
    const out = await host.evaluate(async ({ zip }) => {
      const cfg = window.HS_CONFIG;
      const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      const time = async (fn) => {
        const t0 = performance.now();
        let res, err = '';
        try { res = await fn(); } catch (e) { err = String(e).slice(0, 90); res = { rows: [], complete: false }; }
        return { ms: Math.round(performance.now() - t0), n: (res.rows || []).length, complete: !!res.complete, err };
      };
      // NEW first, then OLD, on every rep — same order each time so neither path gets a
      // systematically colder or warmer server-side cache than the other.
      const rpc = await time(() => window.HS.rpcAllRows(zip, 'development'));
      const paged = await time(() => window.HS.fetchAllPages(() => sb.from('app_projects').select('*')
        .eq('zip', zip).eq('record_kind', 'development')
        .order('submitted_at', { ascending: false, nullsFirst: false }).order('id')));
      return { rpc, paged };
    }, { zip });
    abRows.push({ zip, rep, ...out });
    console.log(`data ${zip} rep${rep}: RPC ${out.rpc.ms} ms / ${out.rpc.n} rows (complete=${out.rpc.complete})`
      + `  |  PAGED ${out.paged.ms} ms / ${out.paged.n} rows (complete=${out.paged.complete})`
      + (out.rpc.n !== out.paged.n ? `  ⚠ ROW-COUNT MISMATCH` : ''));
  }
}
await browser.close();

const med = (xs) => { const s = xs.filter(x => typeof x === 'number').sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const summary = [
  '### 1. Page render — time from DOM ready to the score rail (`.strip`)',
  '',
  '| ZIP | rep | ms to rail | outcome | first JS error |',
  '|---|---|---|---|---|',
  ...pageRows.map(r => `| ${r.zip} | ${r.rep} | ${r.ms === null ? '—' : r.ms} | ${r.outcome} | ${r.err.slice(0, 60)} |`),
  '',
  '| ZIP | median ms to rail | rendered / attempts |',
  '|---|---|---|',
  ...ZIPS.map(z => {
    const rs = pageRows.filter(r => r.zip === z);
    return `| ${z} | ${med(rs.map(r => r.ms)) ?? '—'} | ${rs.filter(r => r.ms !== null).length} / ${rs.length} |`;
  }),
  '',
  '### 2. Data path A/B — NEW single-payload RPC vs OLD 1,000-row range windows',
  '',
  '| ZIP | rep | NEW rpc ms | OLD paged ms | rows (rpc / paged) | complete (rpc / paged) |',
  '|---|---|---|---|---|---|',
  ...abRows.map(r => `| ${r.zip} | ${r.rep} | ${r.rpc.ms} | ${r.paged.ms} | ${r.rpc.n} / ${r.paged.n}${r.rpc.n !== r.paged.n ? ' ⚠' : ''} | ${r.rpc.complete} / ${r.paged.complete} |`),
  '',
  '| ZIP | median NEW ms | median OLD ms | delta (NEW − OLD) |',
  '|---|---|---|---|',
  ...ZIPS.map(z => {
    const rs = abRows.filter(r => r.zip === z);
    const a = med(rs.map(r => r.rpc.ms)), b = med(rs.map(r => r.paged.ms));
    return `| ${z} | ${a} | ${b} | ${a - b > 0 ? '+' : ''}${a - b} |`;
  }),
].join('\n');
console.log('\n' + summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## projects() read measurement\n\n${summary}\n`);

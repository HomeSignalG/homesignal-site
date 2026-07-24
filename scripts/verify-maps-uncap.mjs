// verify-maps-uncap.mjs — Phase 4 of the Maps uncap: PROOF, with evidence, that
// every qualifying development record and facility is reachable from maps.html
// and that no silent truncation remains — plus payload / fetch / render
// measurements for a typical ZIP and the densest ZIP.
//
// Runs on a GitHub runner (egress works there; the build sandbox has none —
// CI is the live check, the repo's standing pattern). The BRANCH's page code is
// served locally (SITE_BASE=http://localhost:8765) against LIVE Supabase data.
//
// HARD checks per ZIP:
//   * __HS_MAP.complete === true (no partial windowed read rendered)
//   * __HS_MAP.devTotal === live app_projects development count (REST count=exact)
//   * __HS_MAP.facTotal === live app_projects facility count
//     -> together these prove the page holds EVERY materialized record, which
//        Phase 3's DB parity check proved equals the uncapped cache truth.
//   * lettered set stays a presentation aid: 0 < items.length <= 16
//   * sidebar completeness: "All records on file" enumerates to exactly
//     visibleTotal rows, and the LAST row (the deepest tail record — one the old
//     LIMIT 48 could never surface) opens the detail panel on click.
//   * GL rest layer carries the full remainder (restCount identity) after
//     switching to the Satellite view.
// MEASURED (reported, and budget-gated where noted):
//   * app_projects REST payload bytes + fetch ms (per ZIP)
//   * nav -> __HS_MAP ready ms; full sidebar enumeration ms; JS heap
//   * BUDGET (hard): dense-ZIP payload < 8 MB, ready < 20 s on the runner.
//
// Env: SITE_BASE (required, e.g. http://localhost:8765), ZIPS (default
// "85234,55407,44127" = typical / dense / densest-cached).

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const SITE_BASE = (process.env.SITE_BASE || '').replace(/\/$/, '');
if (!SITE_BASE) { console.error('SITE_BASE required'); process.exit(2); }
const ZIPS = (process.env.ZIPS || '85234,55407,44127').split(',').map(s => s.trim()).filter(Boolean);

// Supabase URL + anon key from the shipped config (public by design).
const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const SB_URL = (cfg.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1];
const SB_KEY = (cfg.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1];
if (!SB_URL || !SB_KEY) { console.error('config.js: SUPABASE_URL/ANON_KEY not found'); process.exit(2); }

async function liveCount(zip, kind) {
  const r = await fetch(`${SB_URL}/rest/v1/app_projects?zip=eq.${zip}&record_kind=eq.${kind}&select=id`, {
    method: 'HEAD',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact', Range: '0-0' },
  });
  const cr = r.headers.get('content-range') || '';
  const m = cr.match(/\/(\d+)$/);
  if (!m) throw new Error(`count=exact failed for ${zip}/${kind}: ${r.status} ${cr}`);
  return parseInt(m[1], 10);
}

const fails = [];
const report = [];
const hard = (zip, name, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} — [${zip}] ${name}${extra ? ' (' + extra + ')' : ''}`);
  if (!cond) fails.push(`[${zip}] ${name}${extra ? ' (' + extra + ')' : ''}`);
};

const browser = await chromium.launch();
for (const zip of ZIPS) {
  console.log(`\n=== ZIP ${zip} ===`);
  const devDB = await liveCount(zip, 'development');
  const facDB = await liveCount(zip, 'facility');
  console.log(`  live app_projects: development=${devDB} facility=${facDB}`);

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const rest = [];   // app_projects REST requests: bytes + ms
  page.on('requestfinished', async (req) => {
    if (!req.url().includes('/rest/v1/app_projects')) return;
    try {
      const resp = await req.response();
      const body = resp ? await resp.body() : null;
      const t = req.timing();
      rest.push({ bytes: body ? body.length : 0,
                  ms: t && t.responseEnd > 0 ? Math.round(t.responseEnd) : null });
    } catch (_e) { /* measurement only */ }
  });

  const t0 = Date.now();
  await page.goto(`${SITE_BASE}/maps.html?zip=${zip}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__HS_MAP && Array.isArray(window.__HS_MAP.items), { timeout: 30000 });
  const readyMs = Date.now() - t0;
  await page.waitForTimeout(800);   // let the last REST responses settle into `rest`

  const snap = await page.evaluate(() => {
    const m = window.__HS_MAP;
    return { items: m.items.length, devTotal: m.devTotal, facTotal: m.facTotal,
             visibleTotal: m.visibleTotal, restFacTotal: m.restFacTotal,
             complete: m.complete,
             heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
  });

  // ── the completeness HARD checks ──────────────────────────────────────────
  hard(zip, 'clean complete read (no partial rendered)', snap.complete === true);
  hard(zip, `page holds EVERY development record (devTotal ${snap.devTotal} == DB ${devDB})`, snap.devTotal === devDB);
  hard(zip, `page holds EVERY facility (facTotal ${snap.facTotal} == DB ${facDB})`, snap.facTotal === facDB);
  hard(zip, 'lettered set is a presentation aid (0 < n <= 16)', snap.items > 0 && snap.items <= 16, 'n=' + snap.items);

  // ── sidebar: enumerate the COMPLETE list, then open the deepest tail record ──
  let enumMs = null, rows = null, tailOpened = null;
  const hasMore = await page.$('#allRecMore');
  if (snap.visibleTotal > snap.items) {
    hard(zip, '"All records on file" section present', !!hasMore);
    if (hasMore) {
      const tEnum = Date.now();
      // Click until the button hides (chunked append, 200/click).
      for (let guard = 0; guard < 60; guard++) {
        const visible = await page.evaluate(() => {
          const b = document.getElementById('allRecMore');
          return !!b && b.style.display !== 'none';
        });
        if (!visible) break;
        await page.evaluate(() => document.getElementById('allRecMore').click());
      }
      enumMs = Date.now() - tEnum;
      rows = await page.evaluate(() => document.querySelectorAll('#allRecList [data-all]').length);
      hard(zip, `sidebar enumerates the complete set (${rows} rows == visibleTotal ${snap.visibleTotal})`,
           rows === snap.visibleTotal);
      // The DEEPEST tail record — unreachable under LIMIT 48 — must open its detail panel.
      tailOpened = await page.evaluate(() => {
        const all = document.querySelectorAll('#allRecList [data-all]');
        const last = all[all.length - 1];
        if (!last) return false;
        last.click();
        return !!document.getElementById('infoBack');
      });
      hard(zip, 'deepest tail record opens its detail panel', tailOpened === true);
    }
  } else {
    console.log(`  ~ visibleTotal ${snap.visibleTotal} <= lettered ${snap.items} — no overflow section expected`);
    hard(zip, 'no overflow section on a small ZIP', !hasMore || snap.visibleTotal <= snap.items);
  }

  // ── GL rest layer identity (switch to Satellite; Focus/schematic is default) ──
  await page.evaluate(() => document.querySelector('#mapMode [data-mode="satellite"]').click());
  let glRest = null;
  try {
    await page.waitForFunction(() => typeof window.__HS_MAP.restCount === 'number', { timeout: 25000 });
    glRest = await page.evaluate(() => ({ restCount: window.__HS_MAP.restCount }));
    // identity: rest = (visible minus lettered non-facility items with ids) + rest facilities
    const expected = await page.evaluate(() => {
      const m = window.__HS_MAP;
      return m.visibleTotal - m.items.filter(x => !x._facility && x.id != null).length + m.restFacTotal;
    });
    hard(zip, `GL rest layer carries the full remainder (${glRest.restCount} == ${expected})`,
         glRest.restCount === expected);
  } catch (e) {
    // A runner without WebGL degrades to the schematic — the rest layer then rides
    // the Leaflet/list surfaces; record it rather than fake a pass.
    const degraded = await page.evaluate(() => window.__HS_GL && window.__HS_GL.failed);
    if (degraded) console.log('  ~ WebGL unavailable on runner — GL rest-layer identity not exercised (degraded to schematic; list/LF checks above still prove completeness)');
    else hard(zip, 'GL rest layer populated', false, String(e && e.message).slice(0, 120));
  }

  const payloadBytes = rest.reduce((a, r) => a + r.bytes, 0);
  const fetchMs = rest.reduce((a, r) => a + (r.ms || 0), 0);
  const row = { zip, devDB, facDB, readyMs, enumMs, rows, heapMB: snap.heapMB,
                payloadKB: Math.round(payloadBytes / 1024), fetchMs, restReqs: rest.length };
  report.push(row);
  console.log('  MEASURE ' + JSON.stringify(row));

  // Perf budget — hard-gated on the densest ZIPs so a regression fails CI loudly.
  hard(zip, 'payload budget (< 8 MB app_projects total)', payloadBytes < 8 * 1024 * 1024,
       Math.round(payloadBytes / 1024) + ' KB');
  hard(zip, 'ready budget (< 20 s to __HS_MAP on runner)', readyMs < 20000, readyMs + ' ms');

  await page.screenshot({ path: `shots/uncap-${zip}.png`, fullPage: false }).catch(() => {});
  await page.close();
}
await browser.close();

console.log('\n=== MEASUREMENT SUMMARY ===');
for (const r of report) console.log(JSON.stringify(r));

if (fails.length) {
  console.error(`\n${fails.length} HARD check(s) failed:`);
  for (const f of fails) console.error('  FAIL — ' + f);
  process.exit(1);
}
console.log('\nAll hard checks passed — every qualifying record is reachable from Maps.');

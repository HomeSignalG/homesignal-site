// verify-communities.mjs — live end-to-end check of the NEW-layout community page.
//
// WHY THIS EXISTS: the build sandbox has no network egress to Supabase / homesignal.net,
// so the go-live can only be verified by data + code inspection, never an actual browser
// load. This script closes that gap by running where egress works — GitHub Actions — and
// driving the REAL site with a headless browser.
//
// The site was switched to the new layout (community.html reads the app_* tables via the
// public anon key + RLS and the data-quality gate). INDEX-ONLY-UTAH is the current policy,
// so this asserts, live:
//   1. Every Utah community page (app_community_meta.state='UT') renders REAL, sourced
//      content (the pass state — stat strip + record cards) and is INDEXABLE
//      (<meta name=robots> = index) — that's the advertised set.
//   2. A sample of NON-Utah pages renders WITHOUT error (coverage-coming or not-covered)
//      and is NOINDEXED — nothing outside Utah is advertised until its data is accurate.
//   3. Anti-fabrication: every "View public record" link on a Utah page is a real http URL.
//
// Config via env: SITE_BASE (default https://homesignal.net), SAMPLE (cap Utah ZIPs for a
// quick smoke run), CONCURRENCY (default 8).

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// ── Single source of truth for the anon key + URL: read them out of config.js (the ONE
//    place the app config lives now). Format: `SUPABASE_URL: 'https://…'`. ──
const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const grab = (name) => {
  const m = cfg.match(new RegExp(`${name}\\s*:\\s*'([^']+)'`));
  if (!m) throw new Error(`Could not read ${name} from config.js`);
  return m[1];
};
const SUPABASE_URL = grab('SUPABASE_URL');
const SUPABASE_ANON_KEY = grab('SUPABASE_ANON_KEY');
const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const SAMPLE = process.env.SAMPLE ? parseInt(process.env.SAMPLE, 10) : 0;
const CONCURRENCY = Math.max(1, process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 8);

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase read failed (${path}): ${res.status} ${await res.text()}`);
  return res.json();
}

// Read the rendered community page state: which gate branch rendered, whether it's
// indexable, the H1, and the record links (for the anti-fabrication check).
async function readPage(page, zip) {
  const target = `${SITE_BASE}/community.html?zip=${zip}`;
  await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
  // The loader renders into #commPage after the async data reads resolve. Wait for content.
  await page.waitForFunction(() => {
    const p = document.getElementById('commPage');
    return !!(p && p.textContent && p.textContent.trim().length > 0);
  }, { timeout: 15000 });
  return page.evaluate(() => {
    const p = document.getElementById('commPage');
    const robots = (document.getElementById('robots-meta') || {}).getAttribute
      ? document.getElementById('robots-meta').getAttribute('content') : '';
    const txt = p.textContent || '';
    const h1 = (p.querySelector('h1') || {}).textContent || '';
    const isPass = !!p.querySelector('.strip');                      // pass renders the stat strip
    const isCoverage = /Coverage coming/i.test(txt);
    const isNotCovered = /isn.?t covered yet/i.test(txt);
    const recordLinks = [...p.querySelectorAll('a')]
      .filter(a => /public record/i.test(a.textContent || ''))
      .map(a => a.getAttribute('href') || '');
    return { robots: robots || '', h1, isPass, isCoverage, isNotCovered, recordLinks };
  });
}

const indexable = (r) => /(^|[^n])index/i.test(r) && !/noindex/i.test(r);

async function main() {
  // 1) The advertised set: every Utah community page.
  let utah = await rest(`app_community_meta?select=zip,name,state,data_quality&state=eq.UT&order=zip.asc`);
  if (SAMPLE > 0) utah = utah.slice(0, SAMPLE);
  // 2) A sample of non-Utah pages that MUST stay noindexed: some modeled coverage-coming
  //    (in app_community_meta) + a few well-known modeled ZIPs that were never materialized.
  const nonUtMeta = await rest(`app_community_meta?select=zip,state,data_quality&state=neq.UT&limit=6`);
  const nonUtSample = ['78701', '60601', '98101', '02138']; // modeled elsewhere; no app_* row → not-covered
  const nonUt = [...nonUtMeta.map(r => r.zip), ...nonUtSample];

  console.log(`Verifying ${utah.length} Utah page(s) + ${nonUt.length} non-Utah page(s) against ${SITE_BASE}`);

  const browser = await chromium.launch();
  const fails = [];

  // --- Utah pages: must be pass + indexable + sourced ---
  let cursor = 0;
  async function utahWorker() {
    const page = await browser.newPage();
    for (;;) {
      const i = cursor++;
      if (i >= utah.length) break;
      const row = utah[i];
      try {
        const st = await readPage(page, row.zip);
        if (!st.isPass) {
          fails.push(`UT ${row.zip} (${row.name}): expected a PASS page (real records) but got ${st.isCoverage ? 'coverage-coming' : st.isNotCovered ? 'not-covered' : 'an unrecognized state'}`);
        } else if (!indexable(st.robots)) {
          fails.push(`UT ${row.zip} (${row.name}): Utah pass page is NOT indexable (robots="${st.robots}")`);
        } else if (!st.h1.includes(row.zip)) {
          fails.push(`UT ${row.zip} (${row.name}): rendered H1 "${st.h1}" does not contain the ZIP`);
        } else {
          const bad = st.recordLinks.filter(h => !/^https?:\/\//i.test(h));
          if (bad.length) fails.push(`UT ${row.zip} (${row.name}): ${bad.length} "public record" link(s) without a real http URL (anti-fabrication)`);
          else console.log(`  ✓ UT ${row.zip} → ${row.name} · pass · indexable · ${st.recordLinks.length} record link(s)`);
        }
      } catch (e) {
        fails.push(`UT ${row.zip} (${row.name}): ${e.message.split('\n')[0]}`);
      }
    }
    await page.close();
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, utah.length || 1) }, () => utahWorker()));

  // --- Non-Utah pages: must render (no crash) AND be noindexed ---
  for (const zip of nonUt) {
    const page = await browser.newPage();
    try {
      const st = await readPage(page, zip);
      if (indexable(st.robots)) {
        fails.push(`non-UT ${zip}: page is INDEXABLE but only Utah may be indexed (robots="${st.robots}")`);
      } else if (!(st.isPass || st.isCoverage || st.isNotCovered)) {
        fails.push(`non-UT ${zip}: page rendered an unrecognized state (possible error)`);
      } else {
        console.log(`  ✓ non-UT ${zip} → noindex · ${st.isPass ? 'pass(hidden)' : st.isCoverage ? 'coverage-coming' : 'not-covered'}`);
      }
    } catch (e) {
      fails.push(`non-UT ${zip}: ${e.message.split('\n')[0]}`);
    }
    await page.close();
  }

  await browser.close();

  const summary = [
    `# Community page verification (new layout · index-only-Utah)`,
    ``,
    `- Site: ${SITE_BASE}`,
    `- Utah pages checked: **${utah.length}** (must be pass + indexable)`,
    `- Non-Utah pages checked: **${nonUt.length}** (must be noindexed)`,
    `- Failed: **${fails.length}**`,
    ...(fails.length ? [``, `## Failures`, ...fails.map((f) => `- ${f}`)] : [``, `All Utah pages render real records and are indexable; all sampled non-Utah pages are noindexed. ✓`]),
  ].join('\n');
  console.log('\n' + summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

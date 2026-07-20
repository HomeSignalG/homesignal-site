// verify-communities.mjs — live end-to-end check of the NEW-layout community page.
//
// WHY THIS EXISTS: the build sandbox has no network egress to Supabase / homesignal.net,
// so the go-live can only be verified by data + code inspection, never an actual browser
// load. This script closes that gap by running where egress works — GitHub Actions — and
// driving the REAL site with a headless browser.
//
// The site was switched to the new layout (community.html reads the app_* tables via the
// public anon key + RLS and the data-quality gate). The NATIONWIDE SUBSTANCE GATE is the
// current policy (PLAN.md §11, founder-approved threshold c): the materializer stamps
// app_community_meta.indexable = pass AND (dev-backed OR >=3 facilities), and this
// asserts, live, for EVERY materialized page in any state:
//   1. indexable=true  ⇒ the page renders REAL, sourced content (stat strip + record
//      cards) AND <meta name=robots> = index — that's the advertised set.
//   2. indexable=false ⇒ robots = noindex (pass-but-thin AND coverage-coming both), and
//      a sample of never-materialized ZIPs renders without error, noindexed.
//   3. Anti-fabrication: every "View public record" link is a real http URL.
//
// Config via env: SITE_BASE (default https://homesignal.net), SAMPLE (cap walked ZIPs for
// a quick smoke run), CONCURRENCY (default 8).

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

// A single transient Playwright nav timeout among thousands of materialized pages must
// not fail the whole run — retry once at a longer budget before giving up (mirrors the
// same guard in verify-development.mjs).
async function gotoWithRetry(page, target) {
  try {
    await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    if (!String(e && e.message).includes('Timeout')) throw e;
    console.log(`  ~ nav timeout, retrying once: ${target}`);
    await page.goto(target, { waitUntil: 'networkidle', timeout: 45000 });
  }
}

// Read the rendered community page state: which gate branch rendered, whether it's
// indexable, the H1, and the record links (for the anti-fabrication check).
async function readPage(page, zip) {
  const target = `${SITE_BASE}/community.html?zip=${zip}`;
  await gotoWithRetry(page, target);
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
  // NATIONWIDE SUBSTANCE GATE (PLAN.md §11, founder-approved threshold c): every
  // materialized page is verified against its materializer-stamped `indexable` flag —
  // pass AND (dev-backed OR >=3 facilities), ONE rule computed in SQL and read by the
  // pages, the sitemap generator, and this verifier. Assertions:
  //   indexable=true  ⇒ page renders real records AND robots=index
  //   indexable=false ⇒ robots=noindex (pass-but-thin AND coverage-coming both prove it)
  // KEYSET-paginated: PostgREST caps un-paginated reads at 1,000 rows — a bare
  // limit=100000 silently truncated the walk once WA pushed the meta table past 1,000
  // (the 99xxx ZIPs were never checked). zip=gt.<last> pages cover every row.
  let walked = [];
  for (let last = ''; ;) {
    const page = await rest(`app_community_meta?select=zip,name,state,data_quality,indexable&order=zip.asc&limit=1000` + (last ? `&zip=gt.${encodeURIComponent(last)}` : ''));
    walked.push(...page);
    if (page.length < 1000) break;
    last = page[page.length - 1].zip;
  }
  if (SAMPLE > 0) walked = walked.slice(0, SAMPLE);
  // A sample of modeled-but-never-materialized ZIPs (no app_* row): must render the
  // honest not-covered state and stay noindexed. DERIVED DYNAMICALLY (not hardcoded)
  // so it never needs a manual swap when a state opens — a hardcoded list silently
  // rots the moment its ZIP materializes (44113 broke this the day Ohio opened; 97201
  // the day Oregon did). We pull modeled level=zip ZIPs and keep the first few that
  // have NO app_community_meta row, confirmed against the same meta set we just walked.
  const materializedZips = new Set();
  {
    let mlast = '';
    for (;;) {
      const page = await rest(`app_community_meta?select=zip&order=zip.asc&limit=1000` + (mlast ? `&zip=gt.${encodeURIComponent(mlast)}` : ''));
      if (!page.length) break;
      for (const r of page) materializedZips.add(r.zip);
      mlast = page[page.length - 1].zip;
    }
  }
  const nonUt = [];
  {
    // One page of modeled ZIP rows is plenty to find a handful with no meta row.
    const rows = await rest(`communities?select=zip_codes&level=eq.zip&order=id.asc&limit=4000`);
    for (const row of rows) {
      for (const z of (row.zip_codes || [])) {
        if (/^\d{5}$/.test(z) && !materializedZips.has(z) && !nonUt.includes(z)) { nonUt.push(z); break; }
      }
      if (nonUt.length >= 4) break;
    }
  }
  if (!nonUt.length) console.log('  (no unmaterialized modeled ZIP found to sample — every modeled ZIP is materialized)');

  console.log(`Verifying ${walked.length} materialized page(s) + ${nonUt.length} unmaterialized page(s) against ${SITE_BASE}`);

  const browser = await chromium.launch();
  const fails = [];

  // --- Materialized pages: substance flag drives BOTH assertions ---
  let cursor = 0;
  async function walkWorker() {
    const page = await browser.newPage();
    for (;;) {
      const i = cursor++;
      if (i >= walked.length) break;
      const row = walked[i];
      try {
        const st = await readPage(page, row.zip);
        const tag = `${row.state} ${row.zip} (${row.name})`;
        if (row.data_quality === 'wired_silent') {
          // wired_silent (feed-coverage truth): feeds are wired but nothing produced
          // in the window — the full page renders with honest per-tab empty states,
          // and it is NEVER indexed (only derived 'pass' pages can be).
          if (row.indexable) fails.push(`${tag}: wired_silent row has indexable=true (materializer bug)`);
          else if (indexable(st.robots)) fails.push(`${tag}: wired_silent page is INDEXABLE (robots="${st.robots}")`);
          else console.log(`  ✓ ${tag} · wired_silent · noindex`);
        } else if (row.data_quality !== 'pass') {
          // coverage_coming: honest coverage page, never indexed (flag must be false too).
          if (st.isPass) fails.push(`${tag}: meta says coverage_coming but the page rendered a PASS state`);
          else if (row.indexable) fails.push(`${tag}: coverage_coming row has indexable=true (materializer bug)`);
          else if (indexable(st.robots)) fails.push(`${tag}: coverage-coming page is INDEXABLE (robots="${st.robots}")`);
          else console.log(`  ✓ ${tag} · coverage-coming · noindex`);
        } else if (!st.isPass) {
          fails.push(`${tag}: expected a PASS page (real records) but got ${st.isCoverage ? 'coverage-coming' : st.isNotCovered ? 'not-covered' : 'an unrecognized state'}`);
        } else if (row.indexable && !indexable(st.robots)) {
          fails.push(`${tag}: substance-flagged page is NOT indexable (robots="${st.robots}")`);
        } else if (!row.indexable && indexable(st.robots)) {
          fails.push(`${tag}: pass-but-thin page is INDEXABLE (robots="${st.robots}") — must stay noindex`);
        } else if (!st.h1.includes(row.zip)) {
          fails.push(`${tag}: rendered H1 "${st.h1}" does not contain the ZIP`);
        } else {
          const bad = st.recordLinks.filter(h => !/^https?:\/\//i.test(h));
          if (bad.length) fails.push(`${tag}: ${bad.length} "public record" link(s) without a real http URL (anti-fabrication)`);
          else console.log(`  ✓ ${tag} · pass · ${row.indexable ? 'indexable' : 'thin/noindex'} · ${st.recordLinks.length} record link(s)`);
        }
      } catch (e) {
        fails.push(`${row.state} ${row.zip} (${row.name}): ${e.message.split('\n')[0]}`);
      }
    }
    await page.close();
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, walked.length || 1) }, () => walkWorker()));

  // --- Unmaterialized pages: must render (no crash) AND be noindexed ---
  for (const zip of nonUt) {
    const page = await browser.newPage();
    try {
      const st = await readPage(page, zip);
      if (indexable(st.robots)) {
        fails.push(`unmaterialized ${zip}: page is INDEXABLE but has no substance flag (robots="${st.robots}")`);
      } else if (!(st.isPass || st.isCoverage || st.isNotCovered)) {
        fails.push(`unmaterialized ${zip}: page rendered an unrecognized state (possible error)`);
      } else {
        console.log(`  ✓ unmaterialized ${zip} → noindex · ${st.isPass ? 'pass(hidden)' : st.isCoverage ? 'coverage-coming' : 'not-covered'}`);
      }
    } catch (e) {
      fails.push(`unmaterialized ${zip}: ${e.message.split('\n')[0]}`);
    }
    await page.close();
  }

  await browser.close();

  const nIdx = walked.filter((r) => r.indexable).length;
  const summary = [
    `# Community page verification (nationwide substance gate)`,
    ``,
    `- Site: ${SITE_BASE}`,
    `- Materialized pages checked: **${walked.length}** (${nIdx} substance-flagged ⇒ must be indexable; rest ⇒ noindex)`,
    `- Unmaterialized pages checked: **${nonUt.length}** (must be noindexed)`,
    `- Failed: **${fails.length}**`,
    ...(fails.length ? [``, `## Failures`, ...fails.map((f) => `- ${f}`)] : [``, `Every substance-flagged page renders real records and is indexable; every thin/empty/unmaterialized page is noindexed. ✓`]),
  ].join('\n');
  console.log('\n' + summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

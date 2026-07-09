// verify-communities.mjs — automated, live end-to-end check of every community page.
//
// WHY THIS EXISTS: the build sandbox has no network egress to Supabase / homesignal.net,
// so a community build can only be verified by data + code inspection, never an actual
// browser load (see docs/community-build-source-of-truth.md §13.8/§13.9 "not eyeballed
// live"). This script closes that gap by running where egress works — GitHub Actions —
// and driving the REAL site with a headless browser. It is fully zero-touch: it reads the
// live `communities` table, so every newly-added community is covered with no code change.
//
// WHAT IT ASSERTS, per ZIP that any community covers:
//   1. community.html?zip=<zip> resolves to the MOST-SPECIFIC community the DB says
//      contains that ZIP (mirrors community.html LEVEL_RANK: zip > city > county), i.e.
//      the rendered <#comm-title> equals that community's name.
//   2. The page actually renders a subscribable topic set (the government/topics UI).
// A mismatch or a broken page fails the run and is listed in the job summary.
//
// Config via env: SITE_BASE (default https://homesignal.net), COUNTY (optional filter,
// e.g. "Salt Lake" to scope a run), SAMPLE (optional integer cap for a quick smoke run).

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// ── Single source of truth for the anon key + URL: read them out of community.html so the
//    key never gets duplicated/forked (it's the PUBLIC anon key, already shipped there). ──
const html = readFileSync(new URL('../community.html', import.meta.url), 'utf8');
const grab = (name) => {
  const m = html.match(new RegExp(`const ${name}\\s*=\\s*'([^']+)'`));
  if (!m) throw new Error(`Could not read ${name} from community.html`);
  return m[1];
};
const SUPABASE_URL = grab('SUPABASE_URL');
const SUPABASE_ANON_KEY = grab('SUPABASE_ANON_KEY');
const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const COUNTY = process.env.COUNTY || '';
const SAMPLE = process.env.SAMPLE ? parseInt(process.env.SAMPLE, 10) : 0;

// community.html:1065 — the resolution ranking we must mirror exactly.
const LEVEL_RANK = { neighborhood: 4, zip: 3, city: 2, county: 1 };

// community.html:1470-1472 (applyCommunity) — the H1 pairs name + ZIP (ZIP-first for a
// county) unless the community's own name already carries the ZIP. Mirror exactly, or
// every city/zip-level page — which is most of them — false-fails on a correct render.
function expectedTitle(want, zip) {
  if (zip && want.name.indexOf(zip) === -1) {
    return want.level === 'county' ? `${zip} · ${want.name}` : `${want.name} · ${zip}`;
  }
  return want.name;
}

async function loadCommunities() {
  // PostgREST caps a single read at 1000 rows (the Supabase default max-rows). The table is
  // now several thousand rows, so we MUST page through it with Range headers — a single fetch
  // silently truncated to the first 1000-by-name, which made every alphabetically-late ZIP
  // page (Westland, Ypsilanti, Zeeland, …) invisible and produced false "resolved zip !=
  // expected county" failures. Page until a short page comes back.
  const base = `${SUPABASE_URL}/rest/v1/communities?select=id,name,county,level,zip_codes,slug,government_topics&order=name.asc,id.asc`;
  const PAGE = 1000;
  let rows = [];
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    const res = await fetch(base, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Range: `${from}-${to}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) throw new Error(`Supabase communities read failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows = rows.concat(page);
    if (page.length < PAGE) break; // last page
  }
  if (COUNTY) rows = rows.filter((r) => (r.county || '').toLowerCase() === COUNTY.toLowerCase() ||
    // county not selected above (kept select tight); fall back to name/slug contains
    (r.name || '').toLowerCase().includes(COUNTY.toLowerCase()));
  return rows;
}

// For each ZIP, the community community.html WOULD resolve to (most-specific-live).
function expectedByZip(rows) {
  const byZip = new Map();
  for (const r of rows) for (const z of r.zip_codes || []) {
    if (!byZip.has(z)) byZip.set(z, []);
    byZip.get(z).push(r);
  }
  const expected = new Map();
  for (const [z, list] of byZip) {
    list.sort((a, b) =>
      (LEVEL_RANK[b.level] || 0) - (LEVEL_RANK[a.level] || 0) ||
      (a.zip_codes || []).length - (b.zip_codes || []).length);
    expected.set(z, list[0]); // rank desc, then fewest ZIPs — matches community.html:1089
  }
  return expected;
}

async function main() {
  const rows = await loadCommunities();
  const expected = expectedByZip(rows);
  let zips = [...expected.keys()].sort();
  if (SAMPLE > 0) zips = zips.slice(0, SAMPLE);
  console.log(`Verifying ${zips.length} ZIP(s) against ${SITE_BASE} (from ${rows.length} communities)`);

  const browser = await chromium.launch();
  const fails = [];
  // Bounded concurrency: a pool of reused pages pulls ZIPs off a shared cursor. The check is
  // network-bound (each ZIP is a page load + Supabase reads), so sequential ran ~1 ZIP/sec —
  // a national corpus (10k+ ZIPs) approached the 6h job cap. N workers cut wall-clock ~Nx
  // with IDENTICAL assertions. Override with CONCURRENCY (default 8).
  const CONCURRENCY = Math.max(1, process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 8);
  let cursor = 0;
  async function checkOne(page, zip) {
    const want = expected.get(zip);
    const target = `${SITE_BASE}/community.html?zip=${zip}`;
    try {
      await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
      // Wait until resolveCommunity()/applyCommunity() has stamped the title AND loaded the
      // universal topic set into the global `cats` state (community.html:1114/1135).
      await page.waitForFunction(() => {
        const t = document.getElementById('comm-title');
        return !!(t && t.textContent && t.textContent.trim().length > 0 &&
          typeof cats !== 'undefined' && cats.news && cats.news.items && cats.news.items.length > 0);
      }, { timeout: 15000 });
      // Read the resolved runtime state directly (deterministic; no modal/consent-overlay
      // click flakiness). `cats.meetings.items` is the cascaded government topic set
      // (community.html:1131); `cats.news.items` is the universal set (1135).
      const st = await page.evaluate(() => ({
        title: (document.getElementById('comm-title') || {}).textContent?.trim() || '',
        name: (typeof COMMUNITY !== 'undefined' && COMMUNITY) ? COMMUNITY.name : null,
        universal: (typeof cats !== 'undefined' && cats.news && cats.news.items) ? cats.news.items.length : 0,
        gov: (typeof cats !== 'undefined' && cats.meetings && cats.meetings.items) ? cats.meetings.items.length : 0,
      }));
      const wantTitle = expectedTitle(want, zip);
      if (st.title !== wantTitle || st.name !== want.name) {
        // The core correctness gate: did ?zip= resolve to the most-specific community?
        fails.push(`ZIP ${zip}: resolved "${st.title || st.name}" != expected most-specific "${wantTitle}" (${want.level})`);
      } else if (st.universal < 1) {
        // Universal topics are community-agnostic and always present — 0 means the page's
        // subscribe flow failed to initialize (a real breakage), not an empty-but-valid tile.
        fails.push(`ZIP ${zip} (${want.name}): resolved but subscribe flow rendered no topics (JS init failed)`);
      } else {
        // gov=0 is VALID (empty government tile until feeds exist) — report, don't fail.
        console.log(`  ✓ ${zip} → ${want.name} (${want.level}) · gov ${st.gov} · universal ${st.universal}`);
      }
      // Local-first baseline guard (zero-touch, applies to every ZIP that renders sections):
      //   1. the "Local to <place>" section must render ABOVE "Regional & global";
      //   2. the Local section must NOT contain universal cards (data-cat emerging/global) —
      //      i.e. the news catch-all de-dilution is holding.
      // Best-effort: if the feed hasn't rendered sections (slow/empty page), skip — only a real
      // wrong-ordering or a leaked universal card fails the run.
      const feed = await page.evaluate(() => {
        const f = document.getElementById('alert-feed');
        if (!f) return null;
        const secs = [...f.querySelectorAll('.feed-section .feed-section-head')].map(h => h.textContent.trim());
        const localIdx = secs.findIndex(t => /^Local to /.test(t));
        const globalIdx = secs.findIndex(t => /^Regional & global/.test(t));
        const localSec = [...f.querySelectorAll('.feed-section')]
          .find(s => /^Local to /.test((s.querySelector('.feed-section-head') || {}).textContent || ''));
        const localHasUniversal = localSec
          ? !!localSec.querySelector('.alert-card[data-cat="emerging"], .alert-card[data-cat="global"]') : false;
        return { localIdx, globalIdx, localHasUniversal };
      });
      if (feed && feed.localIdx > -1 && feed.globalIdx > -1 && feed.localIdx > feed.globalIdx) {
        fails.push(`ZIP ${zip} (${want.name}): "Regional & global" rendered ABOVE "Local to …" (local-first broken)`);
      }
      if (feed && feed.localHasUniversal) {
        fails.push(`ZIP ${zip} (${want.name}): universal (emerging/global) card inside the Local section (news de-dilution broken)`);
      }
    } catch (e) {
      fails.push(`ZIP ${zip} (${want.name}): ${e.message.split('\n')[0]}`);
    }
  }
  async function worker() {
    const page = await browser.newPage();
    for (;;) {
      const i = cursor++;
      if (i >= zips.length) break;
      await checkOne(page, zips[i]);
    }
    await page.close();
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, zips.length || 1) }, () => worker()));
  await browser.close();

  const summary = [
    `# Community page verification`,
    ``,
    `- Site: ${SITE_BASE}`,
    `- ZIPs checked: **${zips.length}**`,
    `- Passed: **${zips.length - fails.length}**`,
    `- Failed: **${fails.length}**`,
    ...(fails.length ? [``, `## Failures`, ...fails.map((f) => `- ${f}`)] : [``, `All pages resolved most-specific and render topics. ✓`]),
  ].join('\n');
  console.log('\n' + summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

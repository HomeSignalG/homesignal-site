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

async function loadCommunities() {
  const url = `${SUPABASE_URL}/rest/v1/communities?select=id,name,county,level,zip_codes,slug,government_topics&order=name`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase communities read failed: ${res.status} ${await res.text()}`);
  let rows = await res.json();
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
  const page = await browser.newPage();
  const fails = [];
  for (const zip of zips) {
    const want = expected.get(zip);
    const target = `${SITE_BASE}/community.html?zip=${zip}`;
    try {
      await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
      // Wait until the async resolveCommunity()/applyCommunity() has stamped the title.
      await page.waitForFunction(() => {
        const t = document.getElementById('comm-title');
        return t && t.textContent && t.textContent.trim().length > 0;
      }, { timeout: 15000 });
      const title = (await page.locator('#comm-title').textContent() || '').trim();
      // Topic/subscribe UI present (government + universal tiles render checkboxes/options).
      const hasTopics = await page.locator('input[type="checkbox"], .topic, [data-topic]').count();
      if (title !== want.name) {
        fails.push(`ZIP ${zip}: title "${title}" != expected most-specific "${want.name}" (${want.level})`);
      } else if (!hasTopics) {
        fails.push(`ZIP ${zip} (${want.name}): resolved but no subscribable topics rendered`);
      } else {
        console.log(`  ✓ ${zip} → ${want.name} (${want.level})`);
      }
    } catch (e) {
      fails.push(`ZIP ${zip} (${want.name}): ${e.message.split('\n')[0]}`);
    }
  }
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

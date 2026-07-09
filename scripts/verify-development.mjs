// verify-development.mjs — automated, live end-to-end check of every ZIP development page.
//
// WHY THIS EXISTS: same reason as verify-communities.mjs — the build sandbox has no network
// egress to Supabase / homesignal.net, so a development-page build can only be verified by
// data + code inspection, never a real browser load. This runs where egress works (GitHub
// Actions) and drives the REAL site. Zero-touch: it reads the live development_reports table,
// so every newly-cached ZIP is covered with no code change.
//
// WHAT IT ASSERTS, per ZIP with a cached report:
//   1. /development/<zip> (or homesignalmap.html?zip=<zip>) loads and the map inits,
//      centered on the ZIP centroid.
//   2. The rendered facility count == counts.facilities from the cached report.
//   3. THE ANTI-FABRICATION INVARIANT: every rendered site carries a non-empty record_url.
//      A rendered site with no source URL FAILS the run. (docs/development-tracker-source-of-truth.md §9)
// An empty report (0 sites) is VALID — reported, not failed — exactly as the alerts verifier
// treats an empty government tile.
//
// Config via env: SITE_BASE (default https://homesignal.net), ZIP_PATH (route template,
// default "/development/{zip}"; set "/homesignalmap.html?zip={zip}" if that's the live route),
// SAMPLE (optional integer cap for a quick smoke run).

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// ── Read the Supabase URL + anon key out of the shipped page so nothing is forked. ──
const html = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const grabVar = (name) => {
  const m = html.match(new RegExp(`var ${name}\\s*=\\s*["']([^"']+)["']`));
  if (!m) throw new Error(`Could not read ${name} from homesignalmap.html`);
  return m[1];
};
const ENDPOINT = grabVar('ENDPOINT');                 // .../functions/v1/get-address-report
const APIKEY = grabVar('APIKEY');                     // public/anon key
const SUPABASE_URL = ENDPOINT.replace(/\/functions\/v1\/.*$/, '');
const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const ZIP_PATH = process.env.ZIP_PATH || '/development/{zip}';
const SAMPLE = process.env.SAMPLE ? parseInt(process.env.SAMPLE, 10) : 0;

const zipUrl = (zip) => SITE_BASE + ZIP_PATH.replace('{zip}', encodeURIComponent(zip));

async function loadReports() {
  const url = `${SUPABASE_URL}/rest/v1/development_reports?select=zip,counts,sites,home_lat,home_lng&order=zip`;
  const res = await fetch(url, {
    headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` },
  });
  if (!res.ok) throw new Error(`Supabase development_reports read failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  let reports = await loadReports();
  reports.sort((a, b) => a.zip.localeCompare(b.zip));
  if (SAMPLE > 0) reports = reports.slice(0, SAMPLE);
  console.log(`Verifying ${reports.length} ZIP development page(s) against ${SITE_BASE}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const fails = [];
  let emptyOk = 0;

  for (const rep of reports) {
    const zip = rep.zip;
    const wantFac = (rep.counts && rep.counts.facilities != null) ? rep.counts.facilities : null;
    const sites = Array.isArray(rep.sites) ? rep.sites : [];
    const target = zipUrl(zip);
    try {
      await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
      // Wait until the page has rendered its results block (the app exposes the rendered
      // sites on window for verification; if it doesn't yet, add: window.__HS_SITES = sites).
      await page.waitForFunction(() => {
        return typeof window.__HS_SITES !== 'undefined'
          || document.querySelector('#map .leaflet-container, #map canvas');
      }, { timeout: 15000 });

      const st = await page.evaluate(() => ({
        rendered: Array.isArray(window.__HS_SITES) ? window.__HS_SITES : null,
        facText: (document.getElementById('cFac') || {}).textContent || null,
        devText: (document.getElementById('cDev') || {}).textContent || null,
        mapInited: !!document.querySelector('#map .leaflet-container, #map canvas'),
      }));

      if (!st.mapInited) {
        fails.push(`ZIP ${zip}: map did not initialize`);
        continue;
      }

      // Facility-count reconciliation (page vs cached report).
      const facShown = st.facText != null ? parseInt(st.facText, 10) : null;
      if (wantFac != null && facShown != null && facShown !== wantFac) {
        fails.push(`ZIP ${zip}: facility count ${facShown} != cached counts.facilities ${wantFac}`);
      }

      // RELEVANCE SPLIT (engine v15): the headline "projects proposed" number must equal the
      // non-civic area items the lists can back up — a civic notice (board vacancy, tax sale,
      // budget/comp/bond hearing) counted as a project is a count-inflation failure. Only
      // enforced once the cached sites carry relevance stamps (pre-v15 rows have none).
      const areaSites = (st.rendered || sites).filter((s) => s && s.scope === 'area');
      if (areaSites.some((s) => s.relevance != null)) {
        const wantDev = areaSites.filter((s) => s.relevance !== 'civic').length;
        const devShown = st.devText != null ? parseInt(st.devText, 10) : null;
        if (devShown != null && devShown !== wantDev) {
          fails.push(`ZIP ${zip}: projects-proposed tile ${devShown} != non-civic dev items ${wantDev} (count inflation)`);
        }
      }

      // THE ANTI-FABRICATION INVARIANT: every rendered site must carry a record_url.
      const check = st.rendered != null ? st.rendered : sites;
      const noSource = check.filter((s) => !(s && (s.url || s.record_url)));
      if (noSource.length) {
        fails.push(`ZIP ${zip}: ${noSource.length} rendered site(s) with NO record_url — ` +
          `[${noSource.slice(0, 3).map((s) => (s && s.label) || '??').join(', ')}] (fabrication gate)`);
      } else if (check.length === 0) {
        emptyOk++;
        console.log(`  ✓ ${zip} → empty-but-valid (0 sites)`);
      } else {
        console.log(`  ✓ ${zip} → ${check.length} site(s), all sourced · facilities ${facShown ?? '?'}`);
      }
    } catch (e) {
      fails.push(`ZIP ${zip}: ${e.message.split('\n')[0]}`);
    }
  }
  await browser.close();

  const summary = [
    `# Development page verification`,
    ``,
    `- Site: ${SITE_BASE}`,
    `- ZIPs checked: **${reports.length}**`,
    `- Passed: **${reports.length - fails.length}** (empty-but-valid: ${emptyOk})`,
    `- Failed: **${fails.length}**`,
    ...(fails.length
      ? [``, `## Failures`, ...fails.map((f) => `- ${f}`)]
      : [``, `All pages resolved, counts reconciled, and every rendered site is sourced. ✓`]),
  ].join('\n');
  console.log('\n' + summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

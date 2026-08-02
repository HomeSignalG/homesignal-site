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
import {
  assertZip,
  summarizeSourceReports,
} from './lib/verify-dev-helpers.mjs';

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
// How many dev-bearing ZIPs to also drive through the LIVE engine for the source run report
// (records ingested per source, records excluded + why, unmapped statuses, geocode failures).
const RUN_REPORT_SAMPLE = process.env.RUN_REPORT_SAMPLE ? parseInt(process.env.RUN_REPORT_SAMPLE, 10) : 3;

// ── TIME BUDGET (2026-08-02) ────────────────────────────────────────────────────────────────
// This job walks EVERY cached development_reports row — 12,722 today — through ONE Playwright
// page, serially, at ~1.37 s each. Measured full runs: 4.17 / 3.56 / 4.83 / 3.71 / 3.90 h. The
// workflow cap is now 330 min, and runtime is LINEAR in cached ZIPs, so the cap is reached at
// ~15,700 — roughly one state's build away.
//
// The failure mode is the dangerous one: a run killed at the cap uploads NO report, so it
// presents as a MISSING result rather than a partial one. That is exactly how verify-geocodes
// hid 11 consecutive dead runs. This budget converts that into "checked 9,000 of 12,722, here is
// the report, here is what was skipped" — the repo's no-silent-caps rule applied to itself.
// It does not make the job faster; bounding the runtime is a separate change (a worker pool),
// and `waitUntil: 'networkidle'` must move to `domcontentloaded` first — see QUEUE.md.
const TIME_BUDGET_MS = process.env.TIME_BUDGET_MS
  ? parseInt(process.env.TIME_BUDGET_MS, 10)
  : 4.5 * 60 * 60 * 1000;                       // 4.5 h, inside the workflow's 330-min cap
const STARTED_AT = Date.now();
const budgetSpent = () => Date.now() - STARTED_AT >= TIME_BUDGET_MS;

// The per-ZIP assertions themselves live in ./lib/verify-dev-helpers.mjs as the pure
// `assertZip(zip, rep, isIndexable, st)` — pure so the race guard below can replay them
// against a freshly-read cache row, and so test/verify-development-race-guard.test.mjs can
// drive the SHIPPED predicate rather than a copy of it.

async function loadReports() {
  // KEYSET-paginated: one unbounded select of every row's `sites` jsonb started timing out
  // (57014) once the cache passed ~800 ZIPs, and even OFFSET pages re-scan all prior rows
  // (O(offset) per page) — under concurrent verifier load a late page timed out too.
  // zip=gt.<last> is O(1) per page on the zip index. Transient-retried.
  // ADAPTIVE page size: page cost is dominated by row SIZE, not count — a dense-metro row
  // can carry thousands of `sites` (Minneapolis 55401 ≈ 2,568), so even a 40-row page can
  // blow the statement timeout by itself. On a failed page, halve the size (floor 5) and
  // retry; the size recovers upward after clean pages.
  const rows = [];
  let step = 40;
  let last = '';
  let clean = 0;
  let floorRetries = 0;
  for (;;) {
    const url = `${SUPABASE_URL}/rest/v1/development_reports?select=zip,counts,sites,home_lat,home_lng&order=zip.asc&limit=${step}` +
      (last ? `&zip=gt.${encodeURIComponent(last)}` : '');
    const res = await fetch(url, {
      headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` },
    });
    if (!res.ok) {
      const body = await res.text();
      if (step > 1) { step = Math.max(1, Math.floor(step / 2)); clean = 0; continue; }
      floorRetries++;
      if (floorRetries > 3) throw new Error(`Supabase development_reports read failed at floor page size: ${res.status} ${body}`);
      await new Promise((r) => setTimeout(r, 2500 * floorRetries));
      continue;
    }
    // A 200 can still arrive TRUNCATED: these rows carry the whole `sites` array (up to ~19.6 MB
    // each), so a large page can drop mid-stream and res.json() throws "Unterminated string in
    // JSON". That killed the 2026-08-02 scheduled run in 4 minutes. The ladder above already
    // knows how to react to "page too big" — it just never saw this signal, because it only
    // covered !res.ok. Route a body failure down the same path.
    let page;
    try {
      page = await res.json();
    } catch (e) {
      if (step > 1) { step = Math.max(1, Math.floor(step / 2)); clean = 0; continue; }
      floorRetries++;
      if (floorRetries > 3) throw new Error(`Supabase development_reports body unreadable at floor page size: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2500 * floorRetries));
      continue;
    }
    floorRetries = 0;
    rows.push(...page);
    if (page.length < step) break;
    last = page[page.length - 1].zip;
    if (++clean >= 3 && step < 40) { step = Math.min(40, step * 2); clean = 0; }
  }
  return rows;
}

/** res.json() that cannot take the run down. A Supabase 200 can arrive TRUNCATED when the row
 *  carries a multi-MB `sites` array, and an unguarded parse throws past every retry path — the
 *  2026-08-02 class of failure. Callers that already degrade gracefully on !res.ok get the same
 *  fallback here, so a torn body behaves like an unavailable read rather than a crash. */
async function jsonOr(res, fallback, what) {
  try {
    return await res.json();
  } catch (e) {
    console.log(`  [warn] ${what}: response body unreadable (${e.message}) — treating as unavailable`);
    return fallback;
  }
}

// NATIONWIDE SUBSTANCE GATE (PLAN.md §11, founder-approved threshold c): the advertised
// set is the ZIPs whose materializer-stamped app_community_meta.indexable is true —
// pass AND (dev-backed OR >=3 facilities), ONE rule computed in SQL and read everywhere.
// A tracker page is indexable ONLY for one of these ZIPs when it rendered content;
// everything else (thin, empty, coverage-coming, unmaterialized states) stays noindex.
async function loadIndexableZips() {
  // KEYSET-paginated: PostgREST caps un-paginated reads at 1,000 rows — a bare
  // limit=100000 silently truncated the advertised set once it passed 1,000 indexable
  // ZIPs (WA's 99xxx pages read as flag=false and false-failed the gate assertion).
  const zips = new Set();
  for (let last = ''; ;) {
    const url = `${SUPABASE_URL}/rest/v1/app_community_meta?select=zip&indexable=is.true&order=zip.asc&limit=1000` + (last ? `&zip=gt.${encodeURIComponent(last)}` : '');
    const res = await fetch(url, { headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` } });
    if (!res.ok) return zips;
    const page = await jsonOr(res, null, 'app_community_meta indexable page');
    if (!Array.isArray(page)) return zips;   // torn body → return what we have, same as !res.ok
    for (const r of page) zips.add(r.zip);
    if (page.length < 1000) break;
    last = page[page.length - 1].zip;
  }
  return zips;
}

// ── SINGLE-ZIP LIVE READ (the race guard's evidence) ──────────────────────────────────
// Reads ONE ZIP's cached report row + its stamped substance flag as of NOW, the same two
// reads the page itself makes. Used only on the recheck path, so the happy walk pays nothing.
async function readZipState(zip) {
  const hdr = { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` };
  const q = encodeURIComponent(zip);
  const [rr, mr] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/development_reports?zip=eq.${q}&select=zip,counts,sites,home_lat,home_lng,refreshed_at&limit=1`, { headers: hdr }),
    fetch(`${SUPABASE_URL}/rest/v1/app_community_meta?zip=eq.${q}&select=indexable&limit=1`, { headers: hdr }),
  ]);
  if (!rr.ok) return null;
  const rows = await jsonOr(rr, null, `development_reports zip=${zip}`);
  if (!Array.isArray(rows) || !rows.length) return null;
  let indexable = false;
  if (mr.ok) {
    const m = await jsonOr(mr, null, `app_community_meta zip=${zip}`);
    indexable = !!(Array.isArray(m) && m[0] && m[0].indexable === true);
  }
  return { rep: rows[0], indexable };
}

// Property dossier rows (gap-analysis §4.5) — zero-touch: every cached address is verified.
async function loadPropertyReports() {
  const url = `${SUPABASE_URL}/rest/v1/property_reports?select=address,zip,counts,sites,sources_checked&order=address`;
  const res = await fetch(url, {
    headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` },
  });
  if (!res.ok) return [];   // table not present yet → nothing to verify (not a failure)
  return jsonOr(res, [], 'property_reports');
}

// Navigation with ONE retry on timeout. At full-walk scale (5,900+ page loads) a
// single transient goto timeout is statistically guaranteed eventually and must not
// fail the whole run; a page that times out TWICE in a row is a real failure.
async function gotoWithRetry(page, target) {
  try {
    await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    if (!String(e && e.message).includes('Timeout')) throw e;
    console.log(`  ~ nav timeout, retrying once: ${target}`);
    await page.goto(target, { waitUntil: 'networkidle', timeout: 45000 });
  }
}

// Load a ZIP page and read back everything the assertions need. Split out of the walk so
// the race guard can re-drive the exact same page load against a freshly-read cache row.
async function renderZipPage(page, zip) {
  await gotoWithRetry(page, zipUrl(zip));
  // Wait until the page has rendered its results block (the app exposes the rendered
  // sites on window for verification; if it doesn't yet, add: window.__HS_SITES = sites).
  await page.waitForFunction(() => {
    return typeof window.__HS_SITES !== 'undefined'
      || document.querySelector('#map .leaflet-container, #map canvas');
  }, { timeout: 15000 });

  return page.evaluate(() => {
    const sites = Array.isArray(window.__HS_SITES) ? window.__HS_SITES : null;
    // LABEL↔COLOUR AGREEMENT (regression guard for the 12,000-page mislabel): the label a
    // resident reads and the dot's colour must both derive from the record's lifecycle stage.
    // Compute both in-page and flag any development point where they disagree — e.g. an orange
    // "proposed" dot whose subheader says "operating now", or a green recorded subdivision
    // labelled "Permitted construction". Falls back to no-op if the page didn't expose the hook.
    const OK = { built: ['operating now', 'built', 'recorded'], approved: ['approved'], proposed: ['proposed'] };
    const mislabeled = [];
    if (sites && typeof window.__HS_KIND === 'function' && window.__HS_COLORS) {
      for (const s of sites) {
        if (!s || s.relevance !== 'development' || s.scope !== 'point') continue;
        const kind = String(window.__HS_KIND(s) || '').toLowerCase();
        const colorBucket = s.type === 'built' ? 'built' : (s.type === 'approved' ? 'approved' : 'proposed');
        const allow = OK[colorBucket] || [];
        if (!allow.some((w) => kind.includes(w))) mislabeled.push(`${s.label || '??'} [${s.type}]→"${window.__HS_KIND(s)}"`);
      }
    }
    const rm = document.getElementById('robots-meta');
    return {
      rendered: sites,
      facText: (document.getElementById('cFac') || {}).textContent || null,
      mapInited: !!document.querySelector('#map .leaflet-container, #map canvas'),
      mislabeled,
      shell: !!document.querySelector('.side, .nav'),                 // new left-sidebar shell present
      robots: rm ? (rm.getAttribute('content') || '') : '',
    };
  });
}

async function main() {
  let reports = await loadReports();
  reports.sort((a, b) => a.zip.localeCompare(b.zip));
  if (SAMPLE > 0) reports = reports.slice(0, SAMPLE);
  const indexableZips = await loadIndexableZips();
  console.log(`Verifying ${reports.length} ZIP development page(s) against ${SITE_BASE} (${indexableZips.size} ZIPs indexable under the substance gate)`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const fails = [];
  let emptyOk = 0;

  let raceHealed = 0;
  let skippedForBudget = [];
  for (const [idx, rep] of reports.entries()) {
    if (budgetSpent()) { skippedForBudget = reports.slice(idx).map((r) => r.zip); break; }
    const zip = rep.zip;
    try {
      let st = await renderZipPage(page, zip);
      let res = assertZip(zip, rep, indexableZips.has(zip), st);

      // ── RACE GUARD (the whole 2026-07-24→28 red streak) ────────────────────────────
      // The reads above are a SNAPSHOT taken at run start, but the walk takes ~3h and the
      // pg_cron job `dev-reports-rolling-refresh` (dev_refresh_tick, every 15 min) rewrites
      // ~800 development_reports rows/hour — 2,400+ of the 12,722 rows change underneath a
      // single run, and `app-content-refresh` restamps app_community_meta.indexable hourly.
      // A page loaded at T+2h therefore renders a row the snapshot has never seen, and the
      // count/robots assertions compare live against stale. That is not a page defect, so on
      // ANY mismatch we re-read THAT ZIP's row + flag live and replay the same assertions.
      // We read the row on both sides of the reload and accept the page if it matches EITHER
      // committed state — the page must have rendered a real row, just not necessarily the
      // one we sampled. A genuine defect matches neither and still fails.
      if (res.fails.length) {
        const before = await readZipState(zip);
        st = await renderZipPage(page, zip);
        const after = await readZipState(zip);
        const seen = [];
        for (const cand of [before, after]) {
          if (!cand) continue;
          if (seen.includes(cand.rep.refreshed_at)) continue;
          seen.push(cand.rep.refreshed_at);
          const again = assertZip(zip, cand.rep, cand.indexable, st);
          if (!again.fails.length) { res = again; break; }
          res = again;                       // keep the freshest verdict for the report
        }
        if (!res.fails.length) {
          raceHealed++;
          console.log(`  ~ ${zip} → re-checked against the live row after a mid-run refresh; consistent`);
        }
      }

      if (res.fails.length) {
        fails.push(...res.fails);
      } else if (res.check.length === 0) {
        emptyOk++;
        console.log(`  ✓ ${zip} → empty-but-valid (0 sites)`);
      } else {
        console.log(`  ✓ ${zip} → ${res.check.length} site(s), all sourced · facilities ${res.facShown ?? '?'}`);
      }
    } catch (e) {
      fails.push(`ZIP ${zip}: ${e.message.split('\n')[0]}`);
    }
  }
  if (raceHealed) console.log(`\n${raceHealed} ZIP(s) re-checked against a mid-run cache refresh and found consistent.`);

  // ── Task 6 — SOURCE RUN REPORT ──────────────────────────────────────────────────────────
  // Drive a few dev-bearing ZIPs through the LIVE engine and surface its per-source run report:
  // records ingested per source, records excluded and WHY (by status), unmapped statuses, and
  // geocode failures. These live only in the engine response (not the cache), so we fetch them.
  // The engine also gates unmapped statuses out of `sites`, so any unmapped_statuses here is a
  // registry gap to fix, not a rendered defect. Bounded by RUN_REPORT_SAMPLE to keep CI light.
  const devZips = reports.filter((r) => r.counts && ((r.counts.development || 0) > 0)).slice(0, RUN_REPORT_SAMPLE);
  if (devZips.length) console.log(`\nSource run report (${devZips.length} ZIP(s) via the live engine):`);
  for (const r of devZips) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: APIKEY, Authorization: `Bearer ${APIKEY}` },
        body: JSON.stringify({ zip: r.zip, lat: r.home_lat, lng: r.home_lng }),
      });
      if (!res.ok) { fails.push(`RUN-REPORT ${r.zip}: engine HTTP ${res.status}`); continue; }
      const j = await res.json();
      const quarantined = j.tabs_quarantined || j.quarantined || [];
      if (quarantined.length) {
        console.log(`  · ${r.zip} quarantined: ${quarantined.length} record(s) [${quarantined.slice(0, 2).map((q) => q.project_no || q.reason || '?').join(', ')}]`);
      }
      for (const rep of summarizeSourceReports(j)) {
        const excl = (rep.excluded_by_status || []).reduce((n, e) => n + (e.count || 0), 0);
        console.log(`  · ${r.zip} ${rep.registry_id} (${rep.family}): fetched ${rep.fetched}, emitted ${rep.emitted}, ` +
          `excluded ${excl}, unmapped ${(rep.unmapped_statuses || []).length}, ` +
          `geocode-fail ${rep.geocode_failures || 0}, no-url ${rep.no_record_url || 0}`);
        // NON-FAILING: a registry key that matched only after case-folding. The record IS
        // published (a case-only difference is the same value), but the publisher changed
        // the spelling — surfaced so the drift is visible instead of silently absorbed.
        if ((rep.case_insensitive_matches || []).length)
          console.log(`    case-insensitive match(es) — ${rep.case_insensitive_matches
            .map((c) => `${c.field} "${c.value}" → registry key "${c.matched_key}" (${c.count})`).join(', ')}` +
            ` [live value differs only in case; update the registry map to match]`);
        if ((rep.unmapped_statuses || []).length)
          fails.push(`RUN-REPORT ${r.zip} ${rep.registry_id}: unmapped status(es) reached the engine — ` +
            `${rep.unmapped_statuses.map((u) => `${u.status}(${u.count}${u.sample ? `, e.g. ${u.sample}` : ''})`).join(', ')} (add to registry status_to_bucket)`);
        if ((rep.no_record_url || 0) > 0)
          fails.push(`RUN-REPORT ${r.zip} ${rep.registry_id}: ${rep.no_record_url} record(s) with no derivable record_url`);
      }
    } catch (e) {
      fails.push(`RUN-REPORT ${r.zip}: ${e.message.split('\n')[0]}`);
    }
  }
  // ── PROPERTY PAGES (gap-analysis §4.5) ────────────────────────────────────────────
  // For every cached property_reports row, drive the live ?addr= page and assert:
  //   1. every rendered item carries a record link (the site anti-fabrication gate);
  //   2. every rendered entity link carries ≥2 evidence record_urls — a connection is
  //      a fact about two records, not an inference;
  //   3. the "Also checked" line renders ONLY sources the ENGINE reported checked-empty
  //      in the cache row — the page never invents a negative.
  const zipFailCount = fails.length;
  let props = await loadPropertyReports();
  if (SAMPLE > 0) props = props.slice(0, SAMPLE);
  console.log(`\nVerifying ${props.length} property page(s) against ${SITE_BASE}`);
  for (const row of props) {
    const target = `${SITE_BASE}/homesignalmap.html?addr=${encodeURIComponent(row.address)}`;
    try {
      await gotoWithRetry(page, target);
      await page.waitForFunction(() => Array.isArray(window.__HS_PROP), { timeout: 15000 });
      const st = await page.evaluate(() => ({
        rendered: window.__HS_PROP,
        linkAnchors: Array.from(document.querySelectorAll('.entlink')).map((el) => ({
          text: el.textContent.slice(0, 80),
          anchors: el.querySelectorAll('a').length,
        })),
        // connection map (if drawn) must be a rendering OF the evidence: every edge
        // label must reappear verbatim in "The records behind each connection".
        mapEdgeLabels: Array.from(document.querySelectorAll('.entmap [data-edge]'))
          .map((el) => el.getAttribute('data-edge')),
        evidenceText: Array.from(document.querySelectorAll('.entlink'))
          .map((el) => el.textContent).join('\n'),
        alsoChecked: (document.querySelector('.alsochecked') || {}).textContent || '',
      }));
      const noSource = (st.rendered || []).filter((s) => !(s && (s.url || s.record_url)));
      if (noSource.length) {
        fails.push(`ADDR ${row.address}: ${noSource.length} rendered record(s) with NO record link (fabrication gate)`);
      }
      const weakLinks = st.linkAnchors.filter((l) => l.anchors < 2);
      for (const l of weakLinks) {
        fails.push(`ADDR ${row.address}: entity link with <2 evidence record_urls — "${l.text}…" (§4.5 invariant)`);
      }
      // The connection map is rendered FROM the evidence — an edge whose label has no
      // matching evidence line means the map asserts a connection the records don't.
      for (const lbl of st.mapEdgeLabels) {
        if (!st.evidenceText.includes(lbl)) {
          fails.push(`ADDR ${row.address}: map edge "${lbl}" has no matching evidence line (map must be rendered from entity_links evidence)`);
        }
      }
      if (st.alsoChecked) {
        const allowed = (row.sources_checked || []).map((c) => c.src);
        if (!allowed.length) {
          fails.push(`ADDR ${row.address}: "Also checked" rendered but the cache row reports no checked-empty source`);
        } else {
          const missing = allowed.filter((srcName) => !st.alsoChecked.includes(srcName));
          const bodyText = st.alsoChecked.replace(/^Also checked:\s*/i, '');
          // every rendered token must trace to a row-reported source (page never adds one)
          const extra = bodyText.split('·').map((t) => t.trim()).filter((t) => t && !allowed.some((srcName) => t.startsWith(srcName)));
          if (extra.length) fails.push(`ADDR ${row.address}: "Also checked" shows source(s) not reported by the engine: ${extra.join(' | ')}`);
          if (missing.length) fails.push(`ADDR ${row.address}: engine-reported checked-empty source(s) not rendered: ${missing.join(', ')}`);
        }
      }
      const mine = fails.filter((f) => f.startsWith(`ADDR ${row.address}:`)).length;
      if (!mine) console.log(`  ✓ ${row.address} → ${(st.rendered || []).length} record(s), all sourced · ${st.linkAnchors.length} entity link(s), all ≥2 evidence`);
    } catch (e) {
      fails.push(`ADDR ${row.address}: ${e.message.split('\n')[0]}`);
    }
  }
  const propFails = fails.length - zipFailCount;
  await browser.close();

  // A truncated walk must NOT exit 0, and the summary's own Failed count must agree with the exit
  // code. "Ran out of time" and "everything passed" have to be distinguishable from the outside,
  // or the next reader treats a partial sweep as a full one.
  if (skippedForBudget.length) fails.push(`TIME BUDGET: ${skippedForBudget.length} ZIP(s) never checked — run is incomplete`);

  const summary = [
    `# Development page verification`,
    ``,
    `- Site: ${SITE_BASE}`,
    `- ZIPs checked: **${reports.length - skippedForBudget.length}** of ${reports.length}`,
    ...(skippedForBudget.length
      ? [`- ⚠️ **TIME BUDGET SPENT after ${Math.round((Date.now() - STARTED_AT) / 60000)} min — `
         + `${skippedForBudget.length} ZIP(s) NOT CHECKED**, first skipped: `
         + `${skippedForBudget.slice(0, 5).join(', ')}${skippedForBudget.length > 5 ? ' …' : ''}. `
         + `This run is INCOMPLETE and says so; it is not a pass over the full cache.`]
      : []),
    `- Property pages checked: **${props.length}**`,
    `- Passed: **${reports.length + props.length - fails.length}** (empty-but-valid: ${emptyOk})`,
    ...(raceHealed ? [`- Re-checked after a mid-run cache refresh and found consistent: **${raceHealed}**`] : []),
    `- Failed: **${fails.length}**${propFails ? ` (${propFails} property-page)` : ''}`,
    ...(fails.length
      ? [``, `## Failures`, ...fails.map((f) => `- ${f}`)]
      : skippedForBudget.length
      ? [``, `No failures among the pages that WERE checked — but the walk was truncated, so this is ` +
          `not a clean bill for the cache. Re-run, or bound the runtime (QUEUE.md).`]
      : [``, `All pages resolved; every rendered record is sourced with a valid official record_url; ` +
          `no jurisdiction-scope record is rendered as a precise point; every development record buckets to ` +
          `built/approved/proposed; counts.{proposed,approved,operating,comment_open} each === their rendered ` +
          `array (Task 5); the source run report shows 0 unmapped statuses / 0 missing record_urls; and every ` +
          `entity link carries ≥2 evidence records. ✓`]),
  ].join('\n');
  console.log('\n' + summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

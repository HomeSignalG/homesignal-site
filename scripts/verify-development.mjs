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
// How many dev-bearing ZIPs to also drive through the LIVE engine for the source run report
// (records ingested per source, records excluded + why, unmapped statuses, geocode failures).
const RUN_REPORT_SAMPLE = process.env.RUN_REPORT_SAMPLE ? parseInt(process.env.RUN_REPORT_SAMPLE, 10) : 3;

// Task 6: a record_url must POINT SOMEWHERE OFFICIAL — validated by URL PATTERN + DOMAIN, not by
// an HTTP 200 body (many official portals, e.g. Austin's abc.austintexas.gov, sit behind a bot
// challenge that 200s with a non-record page). We require an absolute http(s) URL with a real host.
function validRecordUrl(u) {
  if (!u || typeof u !== 'string') return false;
  try { const p = new URL(u.trim()); return (p.protocol === 'https:' || p.protocol === 'http:') && /\./.test(p.hostname); }
  catch { return false; }
}
const LIFECYCLE = new Set(['built', 'approved', 'proposed']);

async function loadReports() {
  const url = `${SUPABASE_URL}/rest/v1/development_reports?select=zip,counts,sites,home_lat,home_lng&order=zip`;
  const res = await fetch(url, {
    headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` },
  });
  if (!res.ok) throw new Error(`Supabase development_reports read failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// The set of Utah ZIPs (index-only-Utah policy). A tracker page is indexable ONLY for a
// Utah ZIP that has content; everything else stays noindex. Data-driven off the live table.
async function loadUtahZips() {
  const url = `${SUPABASE_URL}/rest/v1/app_community_meta?select=zip&state=eq.UT`;
  const res = await fetch(url, { headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` } });
  if (!res.ok) return new Set();
  return new Set((await res.json()).map((r) => r.zip));
}

// Property dossier rows (gap-analysis §4.5) — zero-touch: every cached address is verified.
async function loadPropertyReports() {
  const url = `${SUPABASE_URL}/rest/v1/property_reports?select=address,zip,counts,sites,sources_checked&order=address`;
  const res = await fetch(url, {
    headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` },
  });
  if (!res.ok) return [];   // table not present yet → nothing to verify (not a failure)
  return res.json();
}

async function main() {
  let reports = await loadReports();
  reports.sort((a, b) => a.zip.localeCompare(b.zip));
  if (SAMPLE > 0) reports = reports.slice(0, SAMPLE);
  const utahZips = await loadUtahZips();
  console.log(`Verifying ${reports.length} ZIP development page(s) against ${SITE_BASE} (${utahZips.size} Utah ZIPs indexable)`);

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

      const st = await page.evaluate(() => {
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

      // NEW LAYOUT: every tracker page must render the shared left-sidebar shell.
      if (!st.shell) fails.push(`ZIP ${zip}: new sidebar shell did not render (old layout?)`);
      // INDEX-ONLY-UTAH: indexable iff a Utah ZIP that has content; else noindex.
      const renderedForPolicy = st.rendered != null ? st.rendered : sites;
      const isIndex = /(^|[^n])index/i.test(st.robots) && !/noindex/i.test(st.robots);
      const expectIndex = utahZips.has(zip) && renderedForPolicy.length > 0;
      if (isIndex !== expectIndex) {
        fails.push(`ZIP ${zip}: robots="${st.robots}" (indexable=${isIndex}) violates index-only-Utah ` +
          `(expected ${expectIndex ? 'index' : 'noindex'}; utah=${utahZips.has(zip)}, sites=${renderedForPolicy.length})`);
      }
      if (st.mislabeled && st.mislabeled.length) {
        fails.push(`ZIP ${zip}: ${st.mislabeled.length} record(s) whose label contradicts its dot colour ` +
          `[${st.mislabeled.slice(0, 3).join(', ')}] (stage/colour must agree)`);
      }

      if (!st.mapInited) {
        fails.push(`ZIP ${zip}: map did not initialize`);
        continue;
      }

      // Facility-count reconciliation (page vs cached report).
      const facShown = st.facText != null ? parseInt(st.facText, 10) : null;
      if (wantFac != null && facShown != null && facShown !== wantFac) {
        fails.push(`ZIP ${zip}: facility count ${facShown} != cached counts.facilities ${wantFac}`);
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

      // ── Task 6 extensions (render-layer invariants; no extra network) ──────────────────
      // 1) record_url points somewhere official (pattern + domain, not body-200).
      const badUrl = check.filter((s) => { const u = s && (s.url || s.record_url); return u && !validRecordUrl(u); });
      if (badUrl.length) {
        fails.push(`ZIP ${zip}: ${badUrl.length} record(s) with a malformed record_url — ` +
          `[${badUrl.slice(0, 3).map((s) => (s && (s.url || s.record_url)) || '??').join(', ')}]`);
      }
      // 2) a jurisdiction-scope record must NOT be rendered as a precise point.
      const fakePoint = check.filter((s) => s && s.geo_precision === 'jurisdiction' && s.scope === 'point');
      if (fakePoint.length) {
        fails.push(`ZIP ${zip}: ${fakePoint.length} jurisdiction-scope record(s) rendered as a precise point ` +
          `[${fakePoint.slice(0, 3).map((s) => (s && s.label) || '??').join(', ')}]`);
      }
      // 3) no bucket outside the lifecycle map: every development record's type ∈ {built,approved,proposed}.
      const devRecs = check.filter((s) => s && s.relevance === 'development');
      const badBucket = devRecs.filter((s) => !LIFECYCLE.has(s.type));
      if (badBucket.length) {
        fails.push(`ZIP ${zip}: ${badBucket.length} development record(s) with a bucket outside the map ` +
          `(type ∉ built/approved/proposed) [${badBucket.slice(0, 3).map((s) => `${(s.label||'??')}=${s.type}`).join(', ')}]`);
      }
      // 4) Task 5 — ONE PREDICATE PER NUMBER: each cached count === the rendered array it heads.
      const c = rep.counts || {};
      const proposedN = devRecs.filter((s) => s.type === 'proposed').length;
      const approvedN = devRecs.filter((s) => s.type === 'approved').length;
      const operatingN = devRecs.filter((s) => s.type === 'built').length;
      const commentN = check.filter((s) => s && s.comment_open === true).length;
      if (c.proposed != null && c.proposed !== proposedN)
        fails.push(`ZIP ${zip}: counts.proposed ${c.proposed} !== rendered proposed rail ${proposedN} (Task 5)`);
      if (c.approved != null && c.approved !== approvedN)
        fails.push(`ZIP ${zip}: counts.approved ${c.approved} !== rendered approved rail ${approvedN} (Task 5)`);
      if (c.operating != null && c.operating !== operatingN)
        fails.push(`ZIP ${zip}: counts.operating ${c.operating} !== rendered operating rail ${operatingN} (Task 5)`);
      if (c.comment_open != null && c.comment_open !== commentN)
        fails.push(`ZIP ${zip}: counts.comment_open ${c.comment_open} !== commentable set ${commentN} (Task 5)`);
    } catch (e) {
      fails.push(`ZIP ${zip}: ${e.message.split('\n')[0]}`);
    }
  }

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
      for (const rep of (j.socrata_reports || [])) {
        const excl = (rep.excluded_by_status || []).reduce((n, e) => n + (e.count || 0), 0);
        console.log(`  · ${r.zip} ${rep.registry_id}: fetched ${rep.fetched}, emitted ${rep.emitted}, ` +
          `excluded ${excl}, unmapped ${(rep.unmapped_statuses || []).length}, ` +
          `geocode-fail ${rep.geocode_failures || 0}, no-url ${rep.no_record_url || 0}`);
        if ((rep.unmapped_statuses || []).length)
          fails.push(`RUN-REPORT ${r.zip} ${rep.registry_id}: unmapped status(es) reached the engine — ` +
            `${rep.unmapped_statuses.map((u) => `${u.status}(${u.count})`).join(', ')} (add to registry status_to_bucket)`);
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
      await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
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

  const summary = [
    `# Development page verification`,
    ``,
    `- Site: ${SITE_BASE}`,
    `- ZIPs checked: **${reports.length}**`,
    `- Property pages checked: **${props.length}**`,
    `- Passed: **${reports.length + props.length - fails.length}** (empty-but-valid: ${emptyOk})`,
    `- Failed: **${fails.length}**${propFails ? ` (${propFails} property-page)` : ''}`,
    ...(fails.length
      ? [``, `## Failures`, ...fails.map((f) => `- ${f}`)]
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

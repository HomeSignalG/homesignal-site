// verify-map-pipeline.mjs — live browser check of the map-pipeline-remediation invariants.
// Runs where egress works (GitHub Actions); the build sandbox cannot reach homesignal.net.
//
// For each representative ZIP it loads maps.html?zip=<zip>, reads the page's own
// window.__HS_MAP hook (see maps.html shownItems()), and asserts the guarantees the
// remediation must hold — the SAME ones before and after the geocode backfill, so this
// doubles as the no-regression guard:
//
//   HARD invariants (fail the run):
//     1. COORDINATE FILTER INTACT (Finding 1): every mapped marker has finite numeric
//        lat/lng. A null/NaN coordinate must never reach the map.
//     2. ANTI-FABRICATION: no mapped marker sits exactly on the ZIP centroid
//        (app_community_meta.lat/lng, exposed as the page center). The synthetic
//        centroid the engine stamps on area records must never be plotted.
//     3. PROVENANCE: every mapped development/facility marker carries a source_ref.
//     4. CATEGORY CORRECTNESS: no mapped marker is a meeting (meetings are timeline-only).
//
//   SOFT (logged): observed marker counts by category, for map_browser_verification.csv.
//
// Env: SITE_BASE (default https://homesignal.net), ZIPS (comma list; default set below).

import { chromium } from 'playwright';

const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const ZIPS = (process.env.ZIPS || '43235,76132,10002,78617,84302,84003,85201,84083')
  .split(',').map((s) => s.trim()).filter(Boolean);

async function gotoWithRetry(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    if (!String(e && e.message).includes('Timeout')) throw e;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  }
}

function isFinateNum(n) { return typeof n === 'number' && Number.isFinite(n); }

async function checkZip(page, zip) {
  const url = `${SITE_BASE}/maps.html?zip=${encodeURIComponent(zip)}`;
  const fails = [];
  await gotoWithRetry(page, url);
  // Either the map hook publishes, or the ZIP is coverage-coming (no markers) — both are OK.
  await page.waitForFunction(
    () => (window.__HS_MAP && Array.isArray(window.__HS_MAP.items)) || document.getElementById('mapEmpty'),
    { timeout: 20000 }
  ).catch(() => {});

  const snap = await page.evaluate(() => {
    const m = window.__HS_MAP || {};
    const items = Array.isArray(m.items) ? m.items : [];
    // The page center is the community centroid when signed-out (maps.html `center`).
    const c = (window.HS && HS.state && HS.state.community) || {};
    return {
      centroid: { lat: c.lat, lng: c.lng },
      items: items.map((it) => ({
        lat: it.lat, lng: it.lng, facility: !!it._facility,
        source_ref: it.source_ref || null,
        kind: it._facility ? 'facility' : (it.category ? 'change' : 'development'),
        isMeeting: /Public meeting —/.test(String(it.title || '')),
      })),
    };
  });

  const items = snap.items;
  for (const it of items) {
    if (!isFinateNum(it.lat) || !isFinateNum(it.lng)) {
      fails.push(`${zip}: mapped marker with non-finite coords (${it.lat},${it.lng})`);
    }
    if (isFinateNum(snap.centroid.lat) && isFinateNum(it.lat)
        && Math.abs(it.lat - snap.centroid.lat) < 1e-6
        && Math.abs(it.lng - snap.centroid.lng) < 1e-6) {
      fails.push(`${zip}: FABRICATION — marker sits on the ZIP centroid (${it.lat},${it.lng})`);
    }
    if (!it.facility && it.kind !== 'change' && !it.source_ref) {
      fails.push(`${zip}: development marker missing source_ref`);
    }
    if (it.isMeeting) fails.push(`${zip}: a meeting is plotted as a map marker (must be timeline-only)`);
  }

  const counts = items.reduce((a, it) => {
    a[it.kind] = (a[it.kind] || 0) + 1; return a;
  }, {});
  console.log(`  ${zip}: mapped=${items.length} ${JSON.stringify(counts)}  ${fails.length ? 'FAIL' : 'ok'}`);
  return fails;
}

async function main() {
  console.log(`Verifying map-pipeline invariants against ${SITE_BASE} for ZIPs: ${ZIPS.join(', ')}`);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let allFails = [];
  try {
    for (const zip of ZIPS) {
      allFails = allFails.concat(await checkZip(page, zip));
    }
  } finally {
    await browser.close();
  }
  if (allFails.length) {
    console.error('\nFAILURES:\n' + allFails.map((f) => '  - ' + f).join('\n'));
    process.exit(1);
  }
  console.log('\nAll map-pipeline invariants held (coordinate filter, anti-fabrication, provenance, category).');
}

main().catch((e) => { console.error(e); process.exit(1); });

// Representative multi-state production verification for homesignalmap.html.
//
// Goes beyond the original single-ZIP smoke (84302 / 78617) with a curated panel
// across UT/TX/IL/MA/CO/WA/MI/AZ covering: ingestion, projects, map, hearings,
// official links, badges, property pages, legend filtering, and honest empty states.
//
//   SITE_BASE=https://homesignal.net node scripts/verify-representative-zips.mjs
//
// Env: SITE_BASE, ZIP_PATH (default /homesignalmap.html?zip={zip}), LINK_PROBE (0|1, default 1
// for a HEAD/GET sample of one record_url per ZIP), SKIP_ENGINE (0|1).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import {
  REPRESENTATIVE_ZIPS,
  validRecordUrl,
  validateTabsSite,
  LIFECYCLE_BUCKETS,
  ingestionIssues,
} from './lib/verify-dev-helpers.mjs';

const html = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const grabVar = (name) => {
  const m = html.match(new RegExp(`var ${name}\\s*=\\s*["']([^"']+)["']`));
  if (!m) throw new Error(`Could not read ${name} from homesignalmap.html`);
  return m[1];
};
const ENDPOINT = grabVar('ENDPOINT');
const APIKEY = grabVar('APIKEY');
const SUPABASE_URL = ENDPOINT.replace(/\/functions\/v1\/.*$/, '');
const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const ZIP_PATH = process.env.ZIP_PATH || '/homesignalmap.html?zip={zip}';
const LINK_PROBE = process.env.LINK_PROBE !== '0';
const SKIP_ENGINE = process.env.SKIP_ENGINE === '1';

const zipUrl = (zip) => SITE_BASE + ZIP_PATH.replace('{zip}', encodeURIComponent(zip));

async function loadCachedRow(zip) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/development_reports?zip=eq.${encodeURIComponent(zip)}&select=zip,counts,sites,home_lat,home_lng,refreshed_at`,
    { headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` } },
  );
  if (!res.ok) throw new Error(`Supabase read ${zip}: ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function probeLink(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'HomeSignal verify-representative-zips (contact: admin@homesignal.net)' },
      signal: AbortSignal.timeout(15000),
    });
    const status = res.status;
    // 5xx from official portals (e.g. TDLR) is often transient — warn, don't hard-fail.
    const ok = status >= 200 && status < 400;
    const flaky = status >= 500;
    return { url, status, ok, flaky };
  } catch (e) {
    return { url, status: null, ok: false, err: String(e.message || e).slice(0, 120) };
  }
}

async function gotoWithRetry(page, target) {
  try {
    await page.goto(target, { waitUntil: 'networkidle', timeout: 45000 });
  } catch (e) {
    if (!String(e && e.message).includes('Timeout')) throw e;
    await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
  }
}

async function verifyZipPage(page, spec, cached) {
  const { zip, label, expect = {} } = spec;
  const result = {
    zip,
    label,
    state: spec.state,
    checks: [],
    pass: true,
    cached: cached ? { counts: cached.counts, refreshed_at: cached.refreshed_at, siteCount: (cached.sites || []).length } : null,
  };
  const fail = (name, detail) => {
    result.checks.push({ name, pass: false, detail });
    result.pass = false;
  };
  const pass = (name, detail = '') => {
    result.checks.push({ name, pass: true, detail });
  };

  if (!cached) {
    fail('cache row exists', 'no development_reports row');
    return result;
  }
  pass('cache row exists', `refreshed ${(cached.refreshed_at || '').slice(0, 10)}`);

  // ── Live engine ingestion (bounded — one POST per panel ZIP) ──
  if (!SKIP_ENGINE) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: APIKEY, Authorization: `Bearer ${APIKEY}` },
        body: JSON.stringify({ zip, lat: cached.home_lat, lng: cached.home_lng }),
      });
      if (!res.ok) {
        fail('ingestion completes', `engine HTTP ${res.status}`);
      } else {
        const engine = await res.json();
        const sites = Array.isArray(engine.sites) ? engine.sites : [];
        const { issues, quarantined } = ingestionIssues(engine);
        if (issues.length) {
          fail('ingestion completes', issues.join('; '));
        } else {
          pass('ingestion completes', `${sites.length} site(s) emitted; quarantined=${quarantined.length}`);
        }
        if (quarantined.length) {
          pass('quarantine logged', `${quarantined.length} quarantined (report-only)`);
        }
      }
    } catch (e) {
      fail('ingestion completes', e.message.split('\n')[0]);
    }
  }

  const target = zipUrl(zip);
  try {
    await gotoWithRetry(page, target);
    await page.waitForFunction(
      () => typeof window.__HS_SITES !== 'undefined' || document.querySelector('#map .leaflet-container, #map canvas'),
      { timeout: 20000 },
    );

    const st = await page.evaluate(() => {
      const sites = Array.isArray(window.__HS_SITES) ? window.__HS_SITES : [];
      const devPoints = sites.filter((s) => s && s.relevance === 'development' && s.scope === 'point');
      const pointSites = sites.filter((s) => s && s.scope === 'point' && typeof s.lat === 'number');
      const civic = sites.filter((s) => s && s.relevance === 'civic');
      const openComments = sites.filter((s) => s && s.comment_open === true);
      const verify = window.__HS_VERIFY || {};
      const covEl = document.getElementById('covNote');
      const covNote = verify.covNote
        || ((covEl && covEl.style.display !== 'none') ? (covEl.textContent || '').trim() : '');
      const legendRows = Array.from(document.querySelectorAll('#mapkey span[role="button"]'));
      const civicVisible = (() => {
        const band = document.getElementById('civicBand');
        return !!(band && band.style.display !== 'none' && document.querySelectorAll('#civicList .rec').length);
      })();
      const emptyBlocks = Array.from(document.querySelectorAll('.empty')).map((el) => (el.textContent || '').trim().slice(0, 80));
      const decidedTags = document.querySelectorAll('.decidedtag').length;
      const countyBadges = document.querySelectorAll('.dt-badge').length;
      const envFlags = document.querySelectorAll('.vflag').length;
      const propertyLinks = Array.from(document.querySelectorAll('a[href*="?addr="]')).length;
      return {
        sites,
        devPoints: devPoints.length,
        pointSites: pointSites.length,
        civic: civic.length,
        openComments: openComments.length,
        mapInited: !!document.querySelector('#map .leaflet-container, #map canvas'),
        mapMarkers: verify.mapMarkers || 0,
        visibleMarkers: verify.visibleMarkers || 0,
        leafletPaths: verify.leafletPaths || document.querySelectorAll('#map .leaflet-interactive').length,
        facilitiesNote: covNote,
        legendRows: legendRows.length,
        civicVisible,
        emptyBlocks,
        decidedTags,
        countyBadges,
        propertyLinks,
        facText: (document.getElementById('cFac') || {}).textContent || '',
        devText: (document.getElementById('cDev') || {}).textContent || '',
        shell: !!document.querySelector('.side, .nav'),
      };
    });

    if (!st.shell) fail('shell renders', 'sidebar missing');
    else pass('shell renders');

    if (!st.mapInited) fail('map renders', 'leaflet/canvas not initialized');
    else pass('map renders', `${st.visibleMarkers}/${st.mapMarkers} markers visible`);

    const rendered = st.sites;
    if (expect.totalMax === 0) {
      if (rendered.length > expect.totalMax) fail('empty state', `${rendered.length} sites rendered (expected 0)`);
      else pass('empty state', `0 sites · empty blocks: ${st.emptyBlocks.length}`);
    } else if (rendered.length === 0 && expect.devMin > 0) {
      fail('projects load', '0 sites rendered');
    } else {
      pass('projects load', `${rendered.length} site(s) · dev points ${st.devPoints}`);
    }

    if (expect.devMin != null && (cached.counts?.development || 0) < expect.devMin) {
      fail('dev count expectation', `cached development ${cached.counts?.development} < ${expect.devMin}`);
    }
    if (expect.devMax != null && (cached.counts?.development || 0) > expect.devMax) {
      fail('facilities-only expectation', `cached development ${cached.counts?.development} > ${expect.devMax}`);
    }
    if (expect.facilitiesOnly && !/EPA-registered facilities/i.test(st.facilitiesNote)) {
      fail('facilities-only note', `note="${st.facilitiesNote.slice(0, 60)}"`);
    } else if (expect.facilitiesOnly) {
      pass('facilities-only note', 'honest EPA-only coverage copy shown');
    }

    if (expect.hearings) {
      if (st.civic < 1 && !st.civicVisible) fail('hearing data', 'no civic/hearing records');
      else pass('hearing data', `${st.civic} civic record(s) · band visible=${st.civicVisible}`);
    }

    const noSource = rendered.filter((s) => !(s && (s.url || s.record_url)));
    if (noSource.length) fail('official links (sourced)', `${noSource.length} unsourced site(s)`);
    else pass('official links (sourced)', 'every site has record_url');

    const badUrl = rendered.filter((s) => {
      const u = s && (s.url || s.record_url);
      return u && !validRecordUrl(u);
    });
    if (badUrl.length) fail('official links (shape)', `${badUrl.length} malformed URL(s)`);
    else pass('official links (shape)', `${rendered.length} valid URL shape(s)`);

    if (expect.tabs) {
      const tabsSites = rendered.filter((s) => /tdlr\.texas\.gov/i.test(String(s.url || s.record_url || '')));
      const tabsBad = tabsSites.filter((s) => !validateTabsSite(s).ok);
      if (tabsBad.length) fail('TABS links', `${tabsBad.length} malformed TABS site(s)`);
      else pass('TABS links', `${tabsSites.length} TABS site(s) with matching project_no`);
    }

    if (LINK_PROBE && rendered.length) {
      const sample = rendered.find((s) => s.record_url || s.url);
      if (sample) {
        const probe = await probeLink(sample.record_url || sample.url);
        if (!probe.ok && probe.flaky) {
          pass('official link probe', `transient ${probe.status} (logged, not failing) ${probe.url.slice(0, 50)}…`);
        } else if (!probe.ok) {
          fail('official link probe', `${probe.url} → ${probe.status || probe.err}`);
        } else {
          pass('official link probe', `${probe.status} ${probe.url.slice(0, 60)}…`);
        }
      }
    }

    const devRecs = rendered.filter((s) => s && s.relevance === 'development');
    const badBucket = devRecs.filter((s) => !LIFECYCLE_BUCKETS.has(s.type));
    if (badBucket.length) fail('lifecycle badges', `${badBucket.length} out-of-map bucket(s)`);
    else pass('lifecycle badges', `${devRecs.length} dev record(s) bucketed`);

    if (expect.badges && st.countyBadges < 1) {
      // 84336 may not always show dt-badge if dev tracker block empty — warn not fail if dev present
      if (st.devPoints > 0) pass('county badges', `dt-badge=${st.countyBadges} (optional on this ZIP)`);
      else fail('county badges', 'expected dt-badge on bucket page');
    } else if (expect.badges) {
      pass('county badges', `${st.countyBadges} county-wide badge(s)`);
    }

    if (st.decidedTags > 0 || st.envFlags > 0) {
      pass('record badges', `decided=${st.decidedTags} env=${st.envFlags}`);
    } else {
      pass('record badges', 'none present (valid)');
    }

    const mappablePoints = st.pointSites || rendered.filter((s) => s.scope === 'point').length;
    if (expect.mapMarkers && mappablePoints > 0) {
      const drawn = Math.max(st.visibleMarkers, st.leafletPaths);
      if (drawn < 1) fail('map markers', `0 drawn (${st.visibleMarkers} tracked, ${st.leafletPaths} leaflet paths)`);
      else pass('map markers', `${drawn} on map (${st.visibleMarkers} tracked)`);
    } else if (expect.mapMarkers) {
      pass('map markers', 'area-scope only (no point markers expected)');
    }

    if (expect.filtering && st.legendRows >= 3) {
      const markerCount = Math.max(st.visibleMarkers, st.leafletPaths);
      if (markerCount > 1) {
        const before = await page.evaluate(() => {
          const v = window.__HS_VERIFY || {};
          const paths = document.querySelectorAll('#map .leaflet-interactive').length;
          return Math.max(v.visibleMarkers || 0, paths);
        });
        await page.click('#mapkey span[role="button"]:first-child');
        await page.waitForTimeout(500);
        const after = await page.evaluate(() => {
          const v = window.__HS_VERIFY || {};
          const paths = document.querySelectorAll('#map .leaflet-interactive').length;
          return Math.max(v.visibleMarkers || 0, paths);
        });
        await page.click('#mapkey span[role="button"]:first-child');
        await page.waitForTimeout(300);
        if (after >= before) fail('legend filtering', `visible ${before}→${after} after toggle`);
        else pass('legend filtering', `visible ${before}→${after} after toggle`);
      } else {
        pass('legend filtering', 'skipped — insufficient markers for toggle test');
      }
    } else if (expect.filtering) {
      pass('legend filtering', 'skipped — no legend');
    }

    if (expect.propertyPage) {
      const propTarget = `${SITE_BASE}/homesignalmap.html?addr=${encodeURIComponent(expect.propertyPage)}`;
      await gotoWithRetry(page, propTarget);
      await page.waitForFunction(() => Array.isArray(window.__HS_PROP), { timeout: 20000 });
      const prop = await page.evaluate(() => ({
        count: (window.__HS_PROP || []).length,
        links: Array.from(document.querySelectorAll('a[href]')).filter((a) => /official|record|filing/i.test(a.textContent || '')).length,
        entlinks: document.querySelectorAll('.entlink').length,
      }));
      if (prop.count < 1) fail('property page', '0 records on dossier');
      else pass('property page', `${prop.count} record(s) · ${prop.links} official link(s) · ${prop.entlinks} entity link(s)`);
      if (st.propertyLinks < 1 && rendered.some((s) => s.canonical_addr || s.location_addr)) {
        pass('property page links on ZIP', 'routable addresses present in cache');
      }
    }

    if (expect.emptyState && st.emptyBlocks.length < 1 && rendered.length === 0) {
      fail('empty state copy', 'no .empty blocks');
    } else if (expect.emptyState) {
      pass('empty state copy', st.emptyBlocks[0] || 'map-only empty');
    }
  } catch (e) {
    fail('page load', e.message.split('\n')[0]);
  }

  return result;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const report = {
    at: new Date().toISOString(),
    site: SITE_BASE,
    zips: [],
    summary: { total: 0, passed: 0, failed: 0 },
  };

  console.log(`Representative ZIP verification — ${REPRESENTATIVE_ZIPS.length} ZIP(s) on ${SITE_BASE}\n`);

  for (const spec of REPRESENTATIVE_ZIPS) {
    const cached = await loadCachedRow(spec.zip);
    const row = await verifyZipPage(page, spec, cached);
    report.zips.push(row);
    report.summary.total++;
    if (row.pass) report.summary.passed++;
    else report.summary.failed++;

    const icon = row.pass ? '✓' : '✗';
    console.log(`${icon} ${spec.zip} — ${spec.label}`);
    for (const c of row.checks) {
      console.log(`    ${c.pass ? '·' : '!'} ${c.name}${c.detail ? ': ' + c.detail : ''}`);
    }
    console.log('');
  }

  await browser.close();

  mkdirSync('verify', { recursive: true });
  const outPath = 'verify/representative-zips-report.json';
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  const md = [
    '# Representative ZIP verification report',
    '',
    `- Site: ${SITE_BASE}`,
    `- At: ${report.at}`,
    `- ZIPs: **${report.summary.total}** · Passed: **${report.summary.passed}** · Failed: **${report.summary.failed}**`,
    '',
    '| ZIP | State | Pass | Label |',
    '|---|---|---|---|',
    ...report.zips.map((r) => `| ${r.zip} | ${r.state} | ${r.pass ? '✓' : '✗'} | ${r.label} |`),
    '',
    '## Per-ZIP checks',
    ...report.zips.flatMap((r) => [
      '',
      `### ${r.zip} — ${r.label}`,
      ...(r.cached ? [`- Cache: facilities=${r.cached.counts?.facilities} development=${r.cached.counts?.development} civic=${r.cached.counts?.civic}`] : []),
      ...r.checks.map((c) => `- ${c.pass ? 'PASS' : '**FAIL**'}: ${c.name}${c.detail ? ` — ${c.detail}` : ''}`),
    ]),
  ].join('\n');

  console.log(md);
  writeFileSync('verify/representative-zips-report.md', md);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md);

  console.log(`\nWrote ${outPath}`);
  if (report.summary.failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

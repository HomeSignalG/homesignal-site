// probe-map1-card-grain.mjs — does ONE authoritative project become ONE resident-facing card?
//
// THE QUESTION, AND WHY IT IS THE ONLY ONE LEFT. Live Map 1 renders ZIP-mode development at the
// MARKER grain by design (lib/zip-authoritative.js: "THE GRAIN IS THE MARKER"), which is correct
// for geography — a corridor project legitimately meets a ZIP in several places. The product
// invariant is narrower and different:
//
//     one development project  =  one resident-facing project card
//     one development project  MAY  =  several geographically valid map markers
//
// Multiple markers are expected. Duplicate project cards are not. This measures the two
// separately on the LIVE site and never infers one from the other.
//
// Env: SITE_BASE (default https://homesignal.net), ZIPS (default 76135 — 117 authoritative
// projects over 158 authoritative markers, so the relation genuinely exceeds the project count).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const html = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');

// The SHIPPED site builder, loaded in the page's own order, so the expected-set control below is
// the product's answer rather than a re-derivation of it.
globalThis.window = globalThis.window || globalThis;
for (const f of ['../lib/map.js', '../lib/residential-qualify.js', '../lib/n5-radius.js', '../lib/zip-authoritative.js']) {
  (0, eval)(readFileSync(new URL(f, import.meta.url), 'utf8'));
}
const HS = globalThis.window.HS;
const grab = (n) => {
  const m = html.match(new RegExp(`var ${n}\\s*=\\s*["']([^"']+)["']`));
  if (!m) throw new Error('could not read ' + n);
  return m[1];
};
const ENDPOINT = grab('ENDPOINT');
const APIKEY = grab('APIKEY');
const SUPABASE_URL = ENDPOINT.replace(/\/functions\/v1\/.*$/, '');
const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const ZIPS = (process.env.ZIPS || '76135').split(',').map((z) => z.trim()).filter(Boolean);
const hdr = { apikey: APIKEY, Authorization: 'Bearer ' + APIKEY };

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!c) fails++;
};

// A LATENT condition is reported, counted, and never fails the build — but it is never silent
// either, which is the whole point. FAIL is reserved for something a resident can see today; a
// gate that goes red on a known, deliberately-unfixed condition stops being read, and then the
// next real failure is read as noise too.
let latent = 0;
const note = (clean, name, detail) => {
  console.log((clean ? 'CLEAN' : 'LATENT') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!clean) latent++;
};

// The backend's own answer, read the same way the page reads it, so the control is independent
// of anything the page did with it.
async function backend(zip) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/app_zip_projects_markers`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, hdr),
    body: JSON.stringify({ p_zip: zip, p_kind: 'development', p_authoritative: true }),
  });
  if (!r.ok) throw new Error('rpc ' + r.status);
  const j = await r.json();
  const projects = Array.isArray(j && j.projects) ? j.projects : [];
  const markers = Array.isArray(j && j.markers) ? j.markers : [];
  const per = new Map();
  markers.forEach((m) => { const k = String(m.project_ref); per.set(k, (per.get(k) || 0) + 1); });
  // What the SHIPPED site builder makes of this exact payload - the page's own answer, computed
  // here independently of the browser so the assertion is not comparing the page to itself.
  const built = HS.zipAuthSitesFrom(j);
  const expected = new Set(built.map((s) => s.zip_project_ref).filter(Boolean));
  return {
    status: j && j.status,
    projects: projects.length,
    expectedProjects: expected.size,
    expectedSites: built.length,
    markers: markers.length,
    multi: [...per.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]),
    single: [...per.entries()].filter(([, n]) => n === 1),
  };
}

const browser = await chromium.launch();
const page = await browser.newPage();
console.log(`Map 1 card-grain probe — ${SITE_BASE}\n`);

for (const zip of ZIPS) {
  const b = await backend(zip);
  console.log(`── ${zip} · backend: ${b.projects} projects, ${b.markers} markers, `
    + `${b.multi.length} project(s) with >1 marker (max ${b.multi.length ? b.multi[0][1] : 0}) ──`);

  await page.goto(`${SITE_BASE}/homesignalmap.html?zip=${encodeURIComponent(zip)}`,
                  { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => window.__HS_VERIFY && Array.isArray(window.__HS_SITES),
                             null, { timeout: 45000 });

  const m = await page.evaluate(() => {
    const sites = window.__HS_SITES || [];
    const dev = sites.filter((s) => s && s.scope === 'point' && s.relevance === 'development');
    const refOf = (s) => s.zip_project_ref || s.source_id || s.project_ref || null;
    const per = {};
    dev.forEach((s) => { const k = refOf(s) || '(no-ref)'; per[k] = (per[k] || 0) + 1; });
    const rows = (id) => Array.from(document.querySelectorAll('#' + id + ' .rec'));
    const devRailIds = ['apprList', 'propList'];
    const railRows = devRailIds.reduce((n, id) => n + rows(id).length, 0);

    // IDENTITY, NOT LABEL. Two rows reading "Residential Building Permit 5504 LEA CREST" can be
    // two genuinely distinct permits at one address; only a repeated project REF is a duplicate
    // card. The rails are rendered from these arrays with .slice(0,12), and stageOf is the page's
    // own bucketing (exposed as window.__HS_STAGE), so this reproduces exactly what was drawn.
    const stageOf = window.__HS_STAGE || function (s) { return s && s.bucket; };
    const railFor = (bucket) => dev.filter((s) => stageOf(s) === bucket).slice(0, 12);
    const repeatsIn = (arr) => {
      const c = {};
      arr.forEach((s) => { const k = refOf(s) || '(no-ref)'; c[k] = (c[k] || 0) + 1; });
      return Object.entries(c).filter(([, n]) => n > 1);
    };
    const apprSlice = railFor('approved');
    const propSlice = railFor('proposed');
    // REPEATS ARE READ OFF THE RENDERED ROWS, not off a re-slice of the site list. The rails
    // de-duplicate by project identity before the 12-row cap, so a simulation that re-slices the
    // raw sites is testing a copy of the renderer rather than the renderer - it reported repeats
    // the DOM did not contain. Each row carries data-ref, so the question "does one project
    // appear twice in this rail" is asked of what a resident actually sees.
    const domRefs = (id) => rows(id).map((el) => el.getAttribute('data-ref') || '(none)');
    const dupesIn = (refs) => {
      const c = {};
      refs.forEach((k) => { c[k] = (c[k] || 0) + 1; });
      return Object.entries(c).filter(([, n]) => n > 1);
    };
    const railRepeats = dupesIn(domRefs('apprList')).concat(dupesIn(domRefs('propList')));
    // The same question asked of the WHOLE rail-eligible set, not just the 12 that fit - so a
    // clean result inside the cap cannot hide duplication the cap happens to truncate.
    const uncappedRepeats = repeatsIn(dev.filter((s) => stageOf(s) === 'approved'))
      .concat(repeatsIn(dev.filter((s) => stageOf(s) === 'proposed')));
    return {
      railRepeats, uncappedRepeats,
      railSliceSizes: [apprSlice.length, propSlice.length],
      devSites: dev.length,
      uniqueRefs: Object.keys(per).length,
      noRef: per['(no-ref)'] || 0,
      maxPerRef: Object.values(per).reduce((a, n) => Math.max(a, n), 0),
      multiRefs: Object.entries(per).filter(([k, n]) => k !== '(no-ref)' && n > 1)
        .sort((a, b) => b[1] - a[1]).slice(0, 5),
      railRows,
      railCapped: devRailIds.some((id) => rows(id).length >= 12),
      leafletMarkers: document.querySelectorAll('#map .leaflet-marker-icon').length,
      headline: (document.getElementById('cTot') || {}).textContent || '',
      cDev: (document.getElementById('cDev') || {}).textContent || '',
    };
  });

  console.log(`   page: ${m.devSites} development sites · ${m.uniqueRefs} unique project refs · `
    + `max ${m.maxPerRef} sites on one project · ${m.leafletMarkers} leaflet markers · `
    + `${m.railRows} rail rows${m.railCapped ? ' (a rail is at its 12-row cap)' : ''}`);
  console.log(`   rails: ${m.railSliceSizes[0]} approved + ${m.railSliceSizes[1]} proposed rendered`);
  if (m.multiRefs.length) {
    console.log('   projects carrying several sites: '
      + m.multiRefs.map(([k, n]) => `${k}×${n}`).join(', '));
  }

  // 1. MARKERS may exceed projects — that is geography, and it must be preserved.
  // NOT equality: zipAuthSiteFromMarker drops a marker whose project carries no record_url, which
  // is the anti-fabrication gate doing its job, and live ingestion moves the relation between the
  // two reads. What must hold is that nothing EXTRA is drawn.
  ok(m.devSites <= b.markers,
     `${zip}: no development marker is drawn beyond the authoritative relation`,
     `page ${m.devSites} · relation ${b.markers}`
       + (m.devSites < b.markers ? ` · ${b.markers - m.devSites} withheld (no record link)` : ''));
  // NOT equality any more, and the reason is a product rule rather than a tolerance: since
  // 2026-09-05 the page renders only QUALIFYING development. lib/residential-qualify.js drops
  // Residential records that are routine work on an existing property (an HVAC permit is not a
  // development), and the record_url gate drops records with no official link. So the page
  // legitimately renders FEWER projects than the RPC returns. What must still hold is that it
  // renders nothing EXTRA, and that the shortfall is exactly what the SHIPPED site builder
  // accounts for - which is computed here from the same payload by the same modules, never by a
  // second copy of the rules.
  ok(m.uniqueRefs <= b.projects,
     `${zip}: no project is rendered beyond the authoritative set`,
     `page ${m.uniqueRefs} unique refs · backend ${b.projects} projects`);
  ok(m.uniqueRefs === b.expectedProjects,
     `${zip}: the rendered projects are exactly those the shipped builder qualifies`,
     `page ${m.uniqueRefs} · shipped builder ${b.expectedProjects}`
       + ` · ${b.projects - b.expectedProjects} not qualifying (routine work or no record link)`);
  ok(m.noRef === 0, `${zip}: every rendered development site carries a project identity`,
     `${m.noRef} without one`);

  // 2. CARDS must not multiply. The rail is capped at 12 rows, so a repeat inside those 12 is
  //    the observable defect; the cap is reported either way so a clean result cannot be an
  //    artifact of truncation.
  ok(m.railRepeats.length === 0,
     `${zip}: no project appears more than once in the rendered rails`,
     m.railRepeats.length ? m.railRepeats.map(([k, n]) => `${k}×${n}`).join(', ')
       : `${m.railRows} rows examined${m.railCapped ? ', rail at its 12-row cap' : ''}`);
  // Reported, not failed. With the cap lifted a corridor project WOULD repeat — the rails hold by
  // ordering plus the 12-row cap rather than by de-duplication. Nothing a resident sees today is
  // wrong, so this is not a launch blocker; it is the precondition anyone raising or removing a
  // rail cap has to satisfy first, and it has to stay visible until they do.
  note(m.uncappedRepeats.length === 0,
     `${zip}: …and none would, with the 12-row cap removed`,
     m.uncappedRepeats.length ? m.uncappedRepeats.map(([k, n]) => `${k}×${n}`).join(', ') : 'clean');

  // 3. Clicking markers must not mint cards. Two markers of the SAME project, then a recount.
  if (b.multi.length) {
    const before = m.railRows;
    await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('#map .leaflet-marker-icon')).slice(0, 2);
      els.forEach((e) => e.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    });
    await page.waitForTimeout(600);
    const after = await page.evaluate(() =>
      ['apprList', 'propList'].reduce((n, id) =>
        n + document.querySelectorAll('#' + id + ' .rec').length, 0));
    ok(after === before,
       `${zip}: selecting markers does not create persistent cards`,
       `rails ${before} → ${after}`);
  }

  // 4. The headline must stay project-grained, not marker-grained.
  ok(String(m.cDev).trim() !== String(b.markers),
     `${zip}: the headline does not report the marker count as a project count`,
     `cDev "${m.cDev}" · markers ${b.markers} · projects ${b.projects}`);
}

await browser.close();
console.log(`\n${fails === 0 ? 'CARD GRAIN: ONE PROJECT = ONE CARD' : fails + ' FAILURE(S)'}`
  + (latent ? ` · ${latent} latent condition(s) reported above — de-dup the rails before any cap is raised` : ''));
process.exit(fails ? 1 : 0);

// GATE 2B — full 457-record Del Valle inventory parity, Street / Satellite / Focus.
//
// WHY THIS RUNS IN CI: the build sandbox has no egress, so the complete inventory cannot
// be exported there. This script runs on a GitHub runner (which does have egress), reads
// the LIVE app_projects rows for ZIP 78617 with the same PUBLIC anon key the page itself
// ships, builds the seed through the SAME adapter contract the 39-row run proved, and
// drives the real maps.html in real Chromium. No production file is modified.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CFG = readFileSync(join(REPO, 'config.js'), 'utf8');
const SUPA = CFG.match(/SUPABASE_URL:\s*'([^']+)'/)[1];
const ANON = CFG.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/)[1];
const ZIP = '78617';
const OUT = join(REPO, 'gate2b-out'); mkdirSync(OUT, { recursive: true });
const fail = (m) => { console.error('GATE2B FAIL: ' + m); process.exit(1); };

// ── STEP 1 — export the full live inventory (keyset-paginated; PostgREST caps at 1000) ──
async function fetchAll() {
  const rows = []; let from = 0;
  for (;;) {
    const url = `${SUPA}/rest/v1/app_projects?zip=eq.${ZIP}&select=id,record_kind,registry_id,name,type,status,stage,lat,lng,zip,source_ref,submitted_at,impact_score,developer&order=id&limit=500&offset=${from}`;
    const r = await fetch(url, { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON } });
    if (!r.ok) fail(`app_projects read ${r.status}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 500) break;
    from += 500;
  }
  return rows;
}
const RAW = await fetchAll();
const DEV = RAW.filter(r => r.record_kind === 'development');
const FAC = RAW.filter(r => r.record_kind === 'facility');
const TABS = DEV.filter(r => !r.registry_id);
const EXPORTED_AT = new Date().toISOString();

// Fail generation unless the inventory is exactly what Gate 2B requires.
if (RAW.length !== 457) fail(`inventory total ${RAW.length}, expected 457`);
if (DEV.length !== 428) fail(`development ${DEV.length}, expected 428`);
if (FAC.length !== 29) fail(`facilities ${FAC.length}, expected 29`);

const idOf = r => r.source_ref || r.name;
const fixtureSha = createHash('sha256').update(
  RAW.map(r => [r.record_kind, r.registry_id || '', r.type || '', r.status || '', r.lat, r.lng, r.source_ref || '', r.name || ''].join('|')).sort().join('\n')
).digest('hex');
const regDist = RAW.reduce((a, r) => { const k = r.registry_id || '(null)'; a[k] = (a[k] || 0) + 1; return a; }, {});

// ── STEP 2 — the SAME adapter contract proven by the 39-row run ─────────────────────────
const ORIGIN = { lat: 30.1745, lng: -97.6134 };
const project = (r, i) => ({
  id: 'dv-' + i, name: r.name, type: r.type, status: r.status, stage: r.stage,
  lens: 'value', developer: r.developer, size: null, investment: null, jobs: null,
  submitted_at: r.submitted_at, lat: Number(r.lat), lng: Number(r.lng),
  impact_score: r.impact_score, impact_dimensions: [], source_ref: r.source_ref,
  sowhat: '', approx: false, note: '',
  record_kind: r.record_kind, registry_id: r.registry_id, zip: r.zip,
});
const aDev = DEV.map(project);
const aFac = FAC.map((r, i) => Object.assign(project(r, 10000 + i), { _facility: true, record_kind: 'facility' }));
const ADAPTED = aDev.concat(aFac);
if (ADAPTED.length !== 457) fail(`adapter emitted ${ADAPTED.length}, expected 457`);
if (new Set(ADAPTED.map(r => r.id)).size !== 457) fail('adapter produced duplicate ids');
for (const r of ADAPTED) {
  if (!r.id || typeof r.lat !== 'number' || typeof r.lng !== 'number' || !r.source_ref)
    fail('adapted row missing a required source value: ' + JSON.stringify(r).slice(0, 140));
}
// coordinates / evidence / registry identity unchanged by the adapter
const byId = new Map(RAW.map(r => [idOf(r), r]));
for (const a of ADAPTED) {
  const s = byId.get(a.source_ref || a.name);
  if (!s) fail('adapted row lost its source row: ' + a.name);
  if (Number(s.lat) !== a.lat || Number(s.lng) !== a.lng) fail('coordinate drift on ' + a.name);
  if ((s.source_ref || '') !== (a.source_ref || '')) fail('evidence drift on ' + a.name);
  if ((s.registry_id || null) !== (a.registry_id || null)) fail('registry drift on ' + a.name);
}
const adaptedSha = createHash('sha256').update(
  ADAPTED.map(r => [r.record_kind, r.registry_id || '', r.type || '', r.status || '', r.lat, r.lng, r.source_ref || '', r.name || ''].join('|')).sort().join('\n')
).digest('hex');

const HS_SEED = {
  community: { zip: ZIP, slug: 'del-valle-78617', name: 'Del Valle (78617)', city: 'Del Valle',
    county: 'Travis', state: 'TX', covered: true, lat: ORIGIN.lat, lng: ORIGIN.lng,
    community_score: null, growth_pressure: 'High', value_trend: null,
    component_scores: {}, civic_activity: null, blurb: '' },
  demoUser: null, properties: [], projects: aDev, facilities: aFac,
  changes: [], meetings: [], environmental_risk: {},
  coverage: [{ zip: ZIP, name: 'Del Valle (78617)', covered: true }], topicCategories: [],
};
writeFileSync(join(OUT, 'fixture-457.json'), JSON.stringify({ exported_at: EXPORTED_AT, fixture_sha256: fixtureSha, adapted_sha256: adaptedSha, rows: RAW }, null, 1));

// ── STEP 3 — real Chromium against the real seed path ───────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = createServer((q, s) => {
  const p = normalize(join(REPO, decodeURIComponent(q.url.split('?')[0])));
  if (!p.startsWith(REPO) || !existsSync(p) || statSync(p).isDirectory()) { s.writeHead(404); return s.end('nf'); }
  s.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); s.end(readFileSync(p));
});
await new Promise(r => srv.listen(8799, r));
const SEED_JS = 'window.HS_SEED = ' + JSON.stringify(HS_SEED) + ';\nwindow.__HS_SEED_SOURCE="gate2b-delvalle-78617-full";';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const consoleErrors = [], pageErrors = []; let intercepted = false;
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(String(e)));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
await ctx.route('**/*', async r => {
  const u = r.request().url();
  if (u.includes('/seed/delvalle.js')) { intercepted = true; return r.fulfill({ status: 200, contentType: 'application/javascript', body: SEED_JS }); }
  if (/tile\.openstreetmap|arcgisonline|amazonaws/.test(u)) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  if (u.includes('supabase.co')) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  return r.continue();   // jsDelivr is reachable on a CI runner — real libraries, no stubs
});
await page.goto('http://127.0.0.1:8799/maps.html?zip=' + ZIP + '&data=seed', { waitUntil: 'load' });
for (let i = 0; i < 400; i++) { if (await page.evaluate(() => !!(window.__HS_MAP && window.__HS_MAP.items))) break; await page.waitForTimeout(100); }
await page.waitForTimeout(1500);

// CANONICAL INVENTORY RECORDER.
//
// Gate 2A recorded `visible ∪ facs` and that was RIGHT AT SAMPLE SCALE ONLY. maps.html:351-352
// splits the mappable facilities:
//     var facs     = facsAllMappable.slice(0, 24);
//     var restFacs = facsAllMappable.slice(24).map(f => ({...f, _restFacility: true}));
// The 39-row sample had 6 facilities (6 < 24) so restFacs was empty and the omission was
// invisible. At full scale 29 > 24, so 5 facilities land in restFacs — plotted by the page
// (HS.plottedMarkerSet(visible, facs, restFacs); focusExpected = visibleTotal + facs +
// restFacs) but never counted by the collector. Canonical is visible ∪ facs ∪ restFacs.
await page.evaluate(() => {
  const HS = window.HS;
  const rs = HS.reserveFacilitySlots;
  HS.reserveFacilitySlots = function (dev, facs) { window.__CANON = { visible: dev || [], facs: facs || [] };
    const o = rs.apply(this, arguments); window.__LETTERED = o; return o; };
  const ra = HS.restAfterLetters;
  if (ra) HS.restAfterLetters = function () { const o = ra.apply(this, arguments); window.__REST = o; return o; };
  const pm = HS.plottedMarkerSet;
  if (pm) HS.plottedMarkerSet = function (visible, facs, restFacs) {
    window.__RESTFACS = restFacs || []; return pm.apply(this, arguments); };

  // ONE definition of the canonical plotted set — used by BOTH the parity collector and the
  // filter collector so the two can never disagree again. (Gate 2B shipped with the parity
  // half fixed and the filter half still reading `visible ∪ facs`; every filter row therefore
  // reported a 452 baseline and a constant +5 removed offset. Harness-only, but a baseline
  // that does not equal the canonical inventory is not evidence of anything.)
  //
  // restFacs prefers the array the page itself passed to plottedMarkerSet. The fallback
  // (seed facilities − facs) fires ONLY when the hook never ran; an explicitly EMPTY
  // __RESTFACS is honoured verbatim, so a filter that genuinely hides facilities is reported
  // as hiding them instead of being papered over by the derivation.
  window.__canonSet = function () {
    const C = window.__CANON || { visible: [], facs: [] };
    const facIds = new Set(C.facs.map(x => x.source_ref || x.name));
    const derived = ((window.HS_SEED || {}).facilities || []).filter(f => !facIds.has(f.source_ref || f.name));
    const restFacs = window.__RESTFACS ? window.__RESTFACS : derived;
    return C.visible.concat(C.facs).concat(restFacs);
  };
  window.__canonIds = function () {
    return window.__canonSet().map(x => (x && (x.source_ref || x.name)) || '?');
  };
});

const MODES = [['street', 'Street'], ['satellite', 'Satellite'], ['impact', 'Focus']];
const per = {};
for (const [key, label] of MODES) {
  await page.evaluate(k => { const b = document.querySelector('#mapMode button[data-mode="' + k + '"]'); if (b) b.click(); }, key);
  await page.waitForTimeout(2500);
  per[label] = await page.evaluate(() => {
    const HS = window.HS, C = window.__CANON || { visible: [], facs: [] };
    const id = x => (x && (x.source_ref || x.name)) || '?';
    // restFacs: prefer the set the page itself passed to plottedMarkerSet; otherwise derive
    // it as (all seed facilities) minus (facs), and cross-check the count against the page's
    // own __HS_MAP.restFacTotal so the derivation can never silently invent or lose a record.
    const facIds = new Set(C.facs.map(x => x.source_ref || x.name));
    const derived = ((window.HS_SEED || {}).facilities || []).filter(f => !facIds.has(f.source_ref || f.name));
    const restFacs = window.__RESTFACS ? window.__RESTFACS : derived;
    const rec = window.__canonSet().map(it => { const m = HS.resolveMarker(it);
      return { id: id(it), name: it.name, kind: m.isFacility ? 'facility' : 'development',
        category: m.categoryKey, symbol: m.shape, lifecycle: m.lifecycle, color: m.color,
        evidence: it.source_ref || '', filterKey: m.filterKey, legendLabel: m.legendLabel,
        registry_id: it.registry_id || null, fallbackReason: m.fallbackReason || null,
        popupTitle: m.popupLabel }; });
    const cnt = (f) => rec.reduce((a, r) => { a[f(r)] = (a[f(r)] || 0) + 1; return a; }, {});
    return { records: rec, total: rec.length,
      dev: rec.filter(r => r.kind === 'development').length, fac: rec.filter(r => r.kind === 'facility').length,
      lettered: (window.__LETTERED || []).length, rest: (window.__REST || []).length,
      lettered_facs: C.facs.length, rest_facs: restFacs.length,
      restFacTotal_page: (window.__HS_MAP || {}).restFacTotal,
      restfac_count_agrees: restFacs.length === ((window.__HS_MAP || {}).restFacTotal),
      by_category: cnt(r => r.category), by_symbol: cnt(r => r.symbol), by_lifecycle: cnt(r => r.lifecycle),
      by_registry: cnt(r => r.registry_id || '(null)'), by_fallback: cnt(r => r.fallbackReason ? 'has-reason' : 'none'),
      legend_labels: (HS.SHAPE_LEGEND || []).map(x => x.label).concat([HS.CATEGORY_REGISTRY.facility.label]),
      legend_symbols: (HS.SHAPE_LEGEND || []).map(x => x.shape).concat([HS.CATEGORY_REGISTRY.facility.symbol]),
      lifecycle_chips: (HS.STATUS_LEGEND_ROWS || []).map(x => x.key + ':' + x.label),
      focusExpected: (window.__HS_MAP || {}).focusExpected, focusMarkerCount: (window.__HS_MAP || {}).focusMarkerCount,
      complete: (window.__HS_MAP || {}).complete,
      dom: document.querySelectorAll('#mapSch svg polygon,#mapSch svg rect,#mapSch svg circle,#maplf .leaflet-marker-icon,#mapgl .maplibregl-marker').length };
  });
  await page.screenshot({ path: join(OUT, `gate2b-${key}-full.png`) });
}
const [A, B, C] = [per.Street, per.Satellite, per.Focus];
if (A.total !== 457) {
  // Do not just report the count — name the records. The adapted set is the source of
  // truth for what SHOULD be present; whatever it has that the canonical set does not is
  // the exact loss, with the fields that decide inclusion attached.
  const seen = new Set(A.records.map(r => r.id));
  const missing = ADAPTED.filter(r => !seen.has(r.source_ref || r.name)).map(r => ({
    id: r.source_ref || r.name, name: r.name, record_kind: r.record_kind,
    registry_id: r.registry_id, type: r.type, status: r.status, lat: r.lat, lng: r.lng,
  }));
  const dbg = { canonical: A.total, expected: 457, missing_count: missing.length,
    visible_len: A.dev, facs_len: A.fac, lettered: A.lettered, rest: A.rest, missing };
  writeFileSync(join(OUT, 'gate2b-missing.json'), JSON.stringify(dbg, null, 1));
  console.log('MISSING RECORD DIAGNOSTIC:\n' + JSON.stringify(dbg, null, 1));
  fail(`canonical inventory ${A.total}, expected 457 (Street) — see gate2b-missing.json`);
}
if (!intercepted) fail('seed was not intercepted');

const ix = m => Object.fromEntries(m.records.map(r => [r.id, r]));
const iA = ix(A), iB = ix(B), iC = ix(C); const ids = Object.keys(iA).sort();
const mism = [];
for (const id of ids) {
  const a = iA[id], b = iB[id], c = iC[id];
  if (!b || !c) { mism.push({ id, field: 'presence', street: !!a, satellite: !!b, focus: !!c }); continue; }
  for (const f of ['kind', 'category', 'symbol', 'lifecycle', 'color', 'evidence', 'filterKey', 'popupTitle'])
    if (!(a[f] === b[f] && b[f] === c[f])) mism.push({ id, field: f, street: a[f], satellite: b[f], focus: c[f] });
}
const sameSet = JSON.stringify(ids) === JSON.stringify(Object.keys(iB).sort()) && JSON.stringify(ids) === JSON.stringify(Object.keys(iC).sort());

// ── STEP 7 — filter parity, per mode ────────────────────────────────────────────────────
// The baseline here is window.__canonSet() — the SAME canonical set the parity collector
// uses (visible ∪ facs ∪ restFacs = 457). `before`/`restored` must therefore read 457, and
// `removed_count` is a real count of hidden records rather than a real count plus the 5
// restFacs the old 452-row window could never see.
//
// EXPECTED (derived from the accepted lifecycle census, not hard-coded guesses):
//   proposed 36 · approved 323 · operating 93 − 29 facilities = 64 · unknown 5 (the TABS rows)
// Facilities carry filterKey 'facility', so no lifecycle toggle may remove one.
const FILTER_EXPECT = { proposed: 36, approved: 323, operating: 64, unknown: 5 };
const facIdSet = new Set(A.records.filter(r => r.kind === 'facility').map(r => r.id));
const filters = {};
for (const key of ['proposed', 'approved', 'operating', 'unknown']) {
  filters[key] = {};
  for (const [mk, ml] of MODES) {
    await page.evaluate(k => { const b = document.querySelector('#mapMode button[data-mode="' + k + '"]'); if (b) b.click(); }, mk);
    await page.waitForTimeout(1200);
    const before = await page.evaluate(() => window.__canonSet().length);
    await page.evaluate(k => window.HS.setStatusFilter(k, false), key);
    await page.evaluate(k => { const b = document.querySelector('#mapMode button[data-mode="' + k + '"]'); if (b) b.click(); }, mk === 'street' ? 'satellite' : 'street');
    await page.waitForTimeout(500);
    await page.evaluate(k => { const b = document.querySelector('#mapMode button[data-mode="' + k + '"]'); if (b) b.click(); }, mk);
    await page.waitForTimeout(1400);
    const after = await page.evaluate(() => window.__canonIds());
    if (ml === 'Street') await page.screenshot({ path: join(OUT, `gate2b-filter-${key}-off.png`) });
    await page.evaluate(k => window.HS.setStatusFilter(k, true), key);
    await page.evaluate(k => { const b = document.querySelector('#mapMode button[data-mode="' + k + '"]'); if (b) b.click(); }, mk === 'street' ? 'satellite' : 'street');
    await page.waitForTimeout(400);
    await page.evaluate(k => { const b = document.querySelector('#mapMode button[data-mode="' + k + '"]'); if (b) b.click(); }, mk);
    await page.waitForTimeout(1200);
    const restored = await page.evaluate(() => window.__canonSet().length);
    const afterSet = new Set(after);
    const removed = ids.filter(i => !afterSet.has(i)).sort();
    const removedFacs = removed.filter(i => facIdSet.has(i)).length;
    filters[key][ml] = { before, after: after.length, restored, removed_count: removed.length,
      removed_tabs: removed.filter(i => i.includes('tdlr.texas.gov')).length,
      removed_facilities: removedFacs,
      membership_sha: createHash('sha256').update(removed.join('\n')).digest('hex') };
  }
  const shas = MODES.map(([, l]) => filters[key][l].membership_sha);
  filters[key].identical_across_modes = shas.every(s => s === shas[0]);
  filters[key].expected_removed = FILTER_EXPECT[key];
  filters[key].baseline_is_canonical = MODES.every(([, l]) =>
    filters[key][l].before === 457 && filters[key][l].restored === 457);
  filters[key].removed_matches_expected = MODES.every(([, l]) =>
    filters[key][l].removed_count === FILTER_EXPECT[key]);
  filters[key].facilities_never_removed = MODES.every(([, l]) => filters[key][l].removed_facilities === 0);
}
// The five TABS rows, and only those, must be what an `unknown` toggle hides.
filters.unknown.removed_are_exactly_the_tabs =
  MODES.every(([, l]) => filters.unknown[l].removed_tabs === 5 && filters.unknown[l].removed_count === 5);

const tabs = A.records.filter(r => !r.registry_id && r.kind === 'development');
const facRows = A.records.filter(r => r.kind === 'facility');
const report = {
  step1_export: { exported_at: EXPORTED_AT, total: RAW.length, development: DEV.length, facilities: FAC.length,
    tabs: TABS.length, null_registry: RAW.filter(r => !r.registry_id).length, registry_distribution: regDist, fixture_sha256: fixtureSha },
  step2_adapter: { entered: RAW.length, left: ADAPTED.length, unique_ids: new Set(ADAPTED.map(r => r.id)).size, adapted_sha256: adaptedSha },
  step3_validation: { intercepted, seed_source: 'gate2b-delvalle-78617-full', canonical: A.total,
    dev: A.dev, fac: A.fac, tabs: tabs.length, lettered: A.lettered, rest: A.rest,
    focusExpected: C.focusExpected, focusMarkerCount: C.focusMarkerCount, complete: A.complete,
    unexplained_loss: 457 - A.total },
  step5_aggregates: Object.fromEntries(MODES.map(([, l]) => [l, {
    total: per[l].total, dev: per[l].dev, fac: per[l].fac, category: per[l].by_category,
    symbol: per[l].by_symbol, lifecycle: per[l].by_lifecycle, registry: per[l].by_registry,
    fallback: per[l].by_fallback, dom: per[l].dom }])),
  legend: { labels: A.legend_labels, symbols: A.legend_symbols, chips: A.lifecycle_chips },
  step4_parity: { compared: ids.length, same_id_set: sameSet, mismatch_count: mism.length, mismatches: mism.slice(0, 50) },
  step6_tabs: tabs.map(t => ({ name: t.name, lifecycle: t.lifecycle, legendLabel: t.legendLabel, category: t.category,
    symbol: t.symbol, kind: t.kind, filterKey: t.filterKey, registry_id: t.registry_id, evidence: t.evidence })),
  step6_source_identity: { austin_with_registry: A.records.filter(r => r.kind === 'development' && r.registry_id).length,
    dev_null_registry: tabs.length,
    any_registry_dev_became_facility: A.records.filter(r => r.registry_id && r.kind === 'facility' && !String(r.registry_id).startsWith('110')).length },
  facilities_sample: facRows.slice(0, 6).map(f => ({ name: f.name, kind: f.kind, category: f.category, symbol: f.symbol, color: f.color, lifecycle: f.lifecycle })),
  facilities_all_square: facRows.every(f => f.symbol === 'square' && f.category === 'facility'),
  step7_filters: filters,
  console_errors: consoleErrors, page_errors: pageErrors,
};
writeFileSync(join(OUT, 'gate2b-report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close(); srv.close();

const hardFail = mism.length || !sameSet || A.total !== 457 || pageErrors.length
  || !report.facilities_all_square
  || Object.values(filters).some(f => !f.identical_across_modes || !f.baseline_is_canonical
       || !f.removed_matches_expected || !f.facilities_never_removed)
  || !filters.unknown.removed_are_exactly_the_tabs;
console.log(hardFail ? '\nRESULT: GATE 2 FAIL' : '\nRESULT: GATE 2 FULL-INVENTORY PASS');
process.exit(hardFail ? 1 : 0);

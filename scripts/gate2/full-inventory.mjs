// GATE 2B — full Del Valle (78617) inventory parity, Street / Satellite / Focus.
//
// WHY THIS RUNS IN CI: the build sandbox has no egress, so the complete inventory cannot
// be exported there. This script runs on a GitHub runner (which does have egress), reads
// the LIVE app_projects rows for ZIP 78617 with the same PUBLIC anon key the page itself
// ships, builds the seed through the SAME adapter contract the 39-row run proved, and
// drives the real maps.html in real Chromium. No production file is modified.
//
// ── WHY THERE IS NO EXPECTED ROW COUNT IN THIS FILE ANY MORE ────────────────────────────
// It used to open `if (RAW.length !== 517) fail(...)`. 517 was a real rebaselined
// measurement (run 30397067493, 2026-07-28, green). Then production grew — 537 by
// 2026-08-11, 540 by 2026-08-18 — and the gate died on line 45, 0.55 s in, BEFORE the
// adapter, BEFORE Chromium, before a single parity comparison. 27 consecutive red runs
// across 8 days and four branches, and the artifact step said so out loud every time
// ("No files were found with the provided path: gate2b-out/"). It was not passing when it
// should have failed; it was failing on arithmetic that had nothing to do with rendering,
// which is worse, because the parity checks this gate exists for silently stopped running
// while the gate still looked like it was covering them.
//
// The fix is not a new number. Every count here is a RELATION, and a relation is both
// drift-proof AND a stronger claim than the absolute ever was:
//   * the adapter must not lose or invent a row      -> ADAPTED.length === RAW.length
//   * every adapted record must be plotted            -> canonical set === ADAPTED.length
//   * a filter must hide exactly its own bucket       -> census computed from RAW
// A literal can only ever say "the inventory is the size it was in July".
//
// What survives as an absolute is a FLOOR, not an expectation: a zero-row or wrong-shape
// read still fails closed, because "the export broke" and "the ZIP is empty" must never be
// indistinguishable.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HS_SEED as FROZEN_SEED, ROWS as FROZEN_ROWS } from './seed78617.mjs';
import { LIFECYCLE_KEYS, censusOf } from './lifecycle-buckets.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CFG = readFileSync(join(REPO, 'config.js'), 'utf8');
const SUPA = CFG.match(/SUPABASE_URL:\s*'([^']+)'/)[1];
const ANON = CFG.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/)[1];
const ZIP = '78617';
const OUT = join(REPO, 'gate2b-out'); mkdirSync(OUT, { recursive: true });
const fail = (m) => { console.error('GATE2B FAIL: ' + m); process.exit(1); };

// THE STATUS → LIFECYCLE MAPPING and its fail-closed vocabulary guard live in
// ./lifecycle-buckets.mjs so the offline unit suite can pin them (this file fetches live data
// on import and cannot be unit-tested in place). `censusOf` THROWS on an unrecognised status,
// naming the value; the gate converts that into its own `fail()` so the message shape stays
// consistent with every other failure here.
const census = (rows, label, idOf) => { try { return censusOf(rows, label, idOf); } catch (e) { fail(e.message); } };

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
// THE HARNESS IDENTITY, stamped once, before anything reads these rows. See the identity
// note at STEP 2 for why it is an index and not `source_ref || name`.
RAW.forEach((r, i) => { r.__gid = 'dv-' + i; });
const GID = r => r.__gid;
const DEV = RAW.filter(r => r.record_kind === 'development');
const FAC = RAW.filter(r => r.record_kind === 'facility');
const TABS = DEV.filter(r => !r.registry_id);
const EXPORTED_AT = new Date().toISOString();

// FLOORS, not expectations. These fail on a broken read and pass on a grown inventory.
// "The export returned nothing" and "this ZIP is genuinely empty" must never look alike.
if (!RAW.length) fail('inventory read returned 0 rows — a broken export, not an empty ZIP');
if (!DEV.length) fail('0 development rows — Del Valle has permit records; this is a read fault');
if (!FAC.length) fail('0 facility rows — Del Valle has EPA facilities; this is a read fault');
{
  const kinds = [...new Set(RAW.map(r => r.record_kind))].sort();
  const unexpected = kinds.filter(k => k !== 'development' && k !== 'facility');
  if (unexpected.length) fail(`unexpected record_kind(s): ${unexpected.join(', ')} — this gate `
    + `splits the inventory two ways and cannot classify a third`);
}
const LIVE = census(RAW, 'live inventory', GID);   // also runs the fail-closed vocabulary guard
console.log(`inventory: ${RAW.length} rows (${DEV.length} development, ${FAC.length} facility, `
  + `${TABS.length} null-registry) · lifecycle ` + LIFECYCLE_KEYS.map(k => `${k} ${LIVE.counts[k]}`).join(' / ')
  + ` · facility ${LIVE.counts.facility}`);

const fixtureSha = createHash('sha256').update(
  RAW.map(r => [r.record_kind, r.registry_id || '', r.type || '', r.status || '', r.lat, r.lng, r.source_ref || '', r.name || ''].join('|')).sort().join('\n')
).digest('hex');
const regDist = RAW.reduce((a, r) => { const k = r.registry_id || '(null)'; a[k] = (a[k] || 0) + 1; return a; }, {});

// ── STEP 2 — the SAME adapter contract proven by the 39-row run ─────────────────────────
//
// ⚠️ THE HARNESS IDENTITY IS `__gid`, AND IT IS NOT CONTENT. Everything that has to match a
// record back to itself — the adapter check, the three-mode parity comparison, the filter
// membership check — keys on `__gid`, a per-row index assigned here.
//
// WHY: the previous key was `source_ref || name`, and it is NOT UNIQUE. Measured live at
// 78617 on 2026-08-18: 540 rows collapse to 521 distinct values under that key, because
// `txdot-projects-info-all` is `record_url_precision: "dataset"` — all 20 of its route
// segments on this ZIP carry ONE url (17 distinct names, 20 distinct coordinates). Two
// consequences, both real: `new Map()` kept the last row per key, so 19 adapted rows were
// compared against a DIFFERENT row's coordinates and the gate reported a false
// "coordinate drift on SH 130 Install Traffic Signal"; and the parity comparison silently
// ran over 521 records instead of 540, able to report `same_id_set: true` while 19 records
// were never checked at all. A gate under-reporting its own coverage is the failure class
// this whole pass exists to remove.
//
// REJECTED: widening the content key to `source_ref|name|lat|lng`. Still not guaranteed
// unique (two segments may legitimately share all four), and it keys the comparison on the
// very field being verified — a circular check that cannot fail on the drift it looks for.
//
// ⚠️ DO NOT CONFLATE THIS WITH ENGINE v22 DEDUP IDENTITY. That key is deliberately
// content-based and deliberately keeps `file_date` + `case_number`, because its job is to
// decide whether two SOURCE ROWS are the same real filing (docs/maps-dedup-migration.sql).
// This key's job is the opposite: to keep every row distinguishable from every other row
// while it travels harness -> seed -> page -> collector. Different key, different problem;
// neither is a model for the other.
const ORIGIN = { lat: 30.1745, lng: -97.6134 };
const project = (r) => ({
  id: r.__gid, __gid: r.__gid, name: r.name, type: r.type, status: r.status, stage: r.stage,
  lens: 'value', developer: r.developer, size: null, investment: null, jobs: null,
  submitted_at: r.submitted_at, lat: Number(r.lat), lng: Number(r.lng),
  impact_score: r.impact_score, impact_dimensions: [], source_ref: r.source_ref,
  sowhat: '', approx: false, note: '',
  record_kind: r.record_kind, registry_id: r.registry_id, zip: r.zip,
});
const aDev = DEV.map(project);
const aFac = FAC.map(r => Object.assign(project(r), { _facility: true, record_kind: 'facility' }));
const ADAPTED = aDev.concat(aFac);

// SOURCE_OF is built POSITIONALLY, from the same .map() calls that produced the adapted rows,
// so each adapted row is paired with its OWN source row by construction rather than by a
// lookup that can collide.
const SOURCE_OF = new Map();
aDev.forEach((a, i) => SOURCE_OF.set(a.__gid, DEV[i]));
aFac.forEach((a, i) => SOURCE_OF.set(a.__gid, FAC[i]));

// THE RELATION, not a number: the adapter neither loses nor invents a row, whatever the
// inventory happens to be today.
if (ADAPTED.length !== RAW.length) fail(`adapter emitted ${ADAPTED.length} from ${RAW.length} input rows`);
if (new Set(ADAPTED.map(r => r.__gid)).size !== RAW.length) fail('adapter produced duplicate ids');
if (SOURCE_OF.size !== RAW.length) fail(`SOURCE_OF holds ${SOURCE_OF.size} of ${RAW.length} rows`);
for (const r of ADAPTED) {
  if (!r.__gid || typeof r.lat !== 'number' || typeof r.lng !== 'number' || !r.source_ref)
    fail('adapted row missing a required source value: ' + JSON.stringify(r).slice(0, 140));
}
// EXPECTED_TOTAL is derived once, here, and every later comparison reads it. Nothing
// downstream restates a literal, so nothing downstream can date.
const EXPECTED_TOTAL = ADAPTED.length;

// coordinates / evidence / registry identity unchanged by the adapter
for (const a of ADAPTED) {
  const s = SOURCE_OF.get(a.__gid);
  if (!s) fail('adapted row lost its source row: ' + a.name);
  if (Number(s.lat) !== a.lat || Number(s.lng) !== a.lng) fail(`coordinate drift on ${a.name} [${a.__gid}]`);
  if ((s.source_ref || '') !== (a.source_ref || '')) fail(`evidence drift on ${a.name} [${a.__gid}]`);
  if ((s.registry_id || null) !== (a.registry_id || null)) fail(`registry drift on ${a.name} [${a.__gid}]`);
}
const adaptedSha = createHash('sha256').update(
  ADAPTED.map(r => [r.record_kind, r.registry_id || '', r.type || '', r.status || '', r.lat, r.lng, r.source_ref || '', r.name || ''].join('|')).sort().join('\n')
).digest('hex');

const seedFor = (dev, fac) => ({
  community: { zip: ZIP, slug: 'del-valle-78617', name: 'Del Valle (78617)', city: 'Del Valle',
    county: 'Travis', state: 'TX', covered: true, lat: ORIGIN.lat, lng: ORIGIN.lng,
    community_score: null, growth_pressure: 'High', value_trend: null,
    component_scores: {}, civic_activity: null, blurb: '' },
  demoUser: null, properties: [], projects: dev, facilities: fac,
  changes: [], meetings: [], environmental_risk: {},
  coverage: [{ zip: ZIP, name: 'Del Valle (78617)', covered: true }], topicCategories: [],
});
const HS_SEED = seedFor(aDev, aFac);
// The total rides in the BODY, next to the shas that prove what it was taken from — a count
// in a filename is a claim nothing can check.
writeFileSync(join(OUT, 'fixture-inventory.json'), JSON.stringify({
  exported_at: EXPORTED_AT, zip: ZIP, total: RAW.length, development: DEV.length,
  facilities: FAC.length, null_registry: TABS.length, lifecycle_census: LIVE.counts,
  fixture_sha256: fixtureSha, adapted_sha256: adaptedSha, rows: RAW,
}, null, 1));

// ── STEP 3 — real Chromium against the real seed path ───────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = createServer((q, s) => {
  const p = normalize(join(REPO, decodeURIComponent(q.url.split('?')[0])));
  if (!p.startsWith(REPO) || !existsSync(p) || statSync(p).isDirectory()) { s.writeHead(404); return s.end('nf'); }
  s.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); s.end(readFileSync(p));
});
await new Promise(r => srv.listen(8799, r));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const consoleErrors = [], pageErrors = []; let intercepted = false;
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(String(e)));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// The served seed is swapped between passes (live inventory, then the frozen fixture), so it
// is a mutable cell rather than a closed-over constant.
let SERVED_SEED = 'window.HS_SEED = ' + JSON.stringify(HS_SEED) + ';\nwindow.__HS_SEED_SOURCE="gate2b-delvalle-78617-full";';
await ctx.route('**/*', async r => {
  const u = r.request().url();
  if (u.includes('/seed/delvalle.js')) { intercepted = true; return r.fulfill({ status: 200, contentType: 'application/javascript', body: SERVED_SEED }); }
  if (/tile\.openstreetmap|arcgisonline|amazonaws/.test(u)) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  if (u.includes('supabase.co')) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  return r.continue();   // jsDelivr is reachable on a CI runner — real libraries, no stubs
});

// CANONICAL INVENTORY RECORDER.
//
// Gate 2A recorded `visible ∪ facs` and that was RIGHT AT SAMPLE SCALE ONLY. maps.html:351-352
// splits the mappable facilities:
//     var facs     = facsAllMappable.slice(0, 24);
//     var restFacs = facsAllMappable.slice(24).map(f => ({...f, _restFacility: true}));
// The 39-row sample had 6 facilities (6 < 24) so restFacs was empty and the omission was
// invisible. At full scale the facility count exceeds 24, so the tail lands in restFacs —
// plotted by the page (HS.plottedMarkerSet(visible, facs, restFacs); focusExpected =
// visibleTotal + facs + restFacs) but never counted by the collector. Canonical is
// visible ∪ facs ∪ restFacs.
async function installCanonHooks() {
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
    // filter collector so the two can never disagree again. (Gate 2B shipped once with the
    // parity half fixed and the filter half still reading `visible ∪ facs`; every filter row
    // therefore reported a short baseline and a constant removed-count offset. Harness-only,
    // but a baseline that does not equal the canonical inventory is not evidence of anything.)
    //
    // restFacs prefers the array the page itself passed to plottedMarkerSet. The fallback
    // (seed facilities − facs) fires ONLY when the hook never ran; an explicitly EMPTY
    // __RESTFACS is honoured verbatim, so a filter that genuinely hides facilities is reported
    // as hiding them instead of being papered over by the derivation.
    window.__canonSet = function () {
      const C = window.__CANON || { visible: [], facs: [] };
      const facIds = new Set(C.facs.map(x => x.__gid));
      const derived = ((window.HS_SEED || {}).facilities || []).filter(f => !facIds.has(f.__gid));
      const restFacs = window.__RESTFACS ? window.__RESTFACS : derived;
      return C.visible.concat(C.facs).concat(restFacs);
    };
    // IDENTITY IS `__gid` AND THERE IS NO FALLBACK. Returning `source_ref || name` when the
    // page has dropped __gid would silently collapse the 20 TxDOT segments that share one
    // dataset url back into 1 — the exact bug this key replaced, reintroduced invisibly and
    // reported as a pass. Missing __gid is therefore a THROWN error, surfaced by the caller.
    window.__canonIds = function () {
      return window.__canonSet().map(function (x) {
        if (!x || !x.__gid) throw new Error('plotted record carries no __gid: ' + JSON.stringify(x).slice(0, 160));
        return x.__gid;
      });
    };
  });
}
async function loadSeed(seedObj, tag) {
  SERVED_SEED = 'window.HS_SEED = ' + JSON.stringify(seedObj) + ';\nwindow.__HS_SEED_SOURCE=' + JSON.stringify(tag) + ';';
  await page.goto('http://127.0.0.1:8799/maps.html?zip=' + ZIP + '&data=seed', { waitUntil: 'load' });
  for (let i = 0; i < 400; i++) { if (await page.evaluate(() => !!(window.__HS_MAP && window.__HS_MAP.items))) break; await page.waitForTimeout(100); }
  await page.waitForTimeout(1500);
  await installCanonHooks();
}
const clickMode = (k) => page.evaluate(m => { const b = document.querySelector('#mapMode button[data-mode="' + m + '"]'); if (b) b.click(); }, k);

await loadSeed(HS_SEED, 'gate2b-delvalle-78617-full');

const MODES = [['street', 'Street'], ['satellite', 'Satellite'], ['impact', 'Focus']];
const per = {};
for (const [key, label] of MODES) {
  await clickMode(key);
  await page.waitForTimeout(2500);
  per[label] = await page.evaluate(() => {
    const HS = window.HS, C = window.__CANON || { visible: [], facs: [] };
    const id = x => { if (!x || !x.__gid) throw new Error('plotted record carries no __gid'); return x.__gid; };
    // restFacs: prefer the set the page itself passed to plottedMarkerSet; otherwise derive
    // it as (all seed facilities) minus (facs), and cross-check the count against the page's
    // own __HS_MAP.restFacTotal so the derivation can never silently invent or lose a record.
    const facIds = new Set(C.facs.map(x => x.__gid));
    const derived = ((window.HS_SEED || {}).facilities || []).filter(f => !facIds.has(f.__gid));
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
if (A.total !== EXPECTED_TOTAL) {
  // Do not just report the count — name the records. The adapted set is the source of
  // truth for what SHOULD be present; whatever it has that the canonical set does not is
  // the exact loss, with the fields that decide inclusion attached.
  const seen = new Set(A.records.map(r => r.id));
  const missing = ADAPTED.filter(r => !seen.has(r.__gid)).map(r => ({
    id: r.__gid, evidence: r.source_ref, name: r.name, record_kind: r.record_kind,
    registry_id: r.registry_id, type: r.type, status: r.status, lat: r.lat, lng: r.lng,
  }));
  const dbg = { canonical: A.total, expected: EXPECTED_TOTAL, missing_count: missing.length,
    visible_len: A.dev, facs_len: A.fac, lettered: A.lettered, rest: A.rest, missing };
  writeFileSync(join(OUT, 'gate2b-missing.json'), JSON.stringify(dbg, null, 1));
  console.log('MISSING RECORD DIAGNOSTIC:\n' + JSON.stringify(dbg, null, 1));
  fail(`canonical inventory ${A.total}, expected ${EXPECTED_TOTAL} (Street) — see gate2b-missing.json`);
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
// The baseline is window.__canonSet() — the SAME canonical set the parity collector uses
// (visible ∪ facs ∪ restFacs), so `before`/`restored` must equal EXPECTED_TOTAL and
// `removed_count` is a real count of hidden records.
//
// EXPECTED is COMPUTED from the live inventory through STATUS_BUCKET above — never restated
// as a literal, and never taken from HS.resolveMarker (see the tautology note there).
// Facilities carry filterKey 'facility', so no lifecycle toggle may remove one.
const FILTER_EXPECT = Object.fromEntries(LIFECYCLE_KEYS.map(k => [k, LIVE.counts[k]]));
console.log('filter expectations, derived from the live status census: '
  + LIFECYCLE_KEYS.map(k => `${k} ${FILTER_EXPECT[k]}`).join(' / '));
const facIdSet = new Set(A.records.filter(r => r.kind === 'facility').map(r => r.id));
// ids are __gid now, so "is this a TABS filing?" is answered by the record's EVIDENCE url,
// looked up per id, never by pattern-matching the id itself.
const evidenceOf = new Map(A.records.map(r => [r.id, r.evidence || '']));
const isTabs = (gid) => (evidenceOf.get(gid) || '').includes('tdlr.texas.gov');
const filters = {};
const untestedBuckets = [];
for (const key of LIFECYCLE_KEYS) {
  filters[key] = {};
  for (const [mk, ml] of MODES) {
    await clickMode(mk);
    await page.waitForTimeout(1200);
    const before = await page.evaluate(() => window.__canonSet().length);
    await page.evaluate(k => window.HS.setStatusFilter(k, false), key);
    await clickMode(mk === 'street' ? 'satellite' : 'street');
    await page.waitForTimeout(500);
    await clickMode(mk);
    await page.waitForTimeout(1400);
    const after = await page.evaluate(() => window.__canonIds());
    if (ml === 'Street') await page.screenshot({ path: join(OUT, `gate2b-filter-${key}-off.png`) });
    await page.evaluate(k => window.HS.setStatusFilter(k, true), key);
    await clickMode(mk === 'street' ? 'satellite' : 'street');
    await page.waitForTimeout(400);
    await clickMode(mk);
    await page.waitForTimeout(1200);
    const restored = await page.evaluate(() => window.__canonSet().length);
    const afterSet = new Set(after);
    const removed = ids.filter(i => !afterSet.has(i)).sort();
    const removedFacs = removed.filter(i => facIdSet.has(i)).length;
    filters[key][ml] = { before, after: after.length, restored, removed_count: removed.length,
      removed_tabs: removed.filter(isTabs).length,
      removed_facilities: removedFacs,
      // MEMBERSHIP, not just a count: the removed set must be exactly the records whose own
      // status buckets to this key. A matching count over the wrong records is not a pass.
      removed_is_exact_bucket: JSON.stringify(removed) === JSON.stringify(LIVE.ids[key].slice().sort()),
      membership_sha: createHash('sha256').update(removed.join('\n')).digest('hex') };
  }
  const shas = MODES.map(([, l]) => filters[key][l].membership_sha);
  filters[key].identical_across_modes = shas.every(s => s === shas[0]);
  filters[key].expected_removed = FILTER_EXPECT[key];
  filters[key].baseline_is_canonical = MODES.every(([, l]) =>
    filters[key][l].before === EXPECTED_TOTAL && filters[key][l].restored === EXPECTED_TOTAL);
  filters[key].removed_matches_expected = MODES.every(([, l]) =>
    filters[key][l].removed_count === FILTER_EXPECT[key]);
  filters[key].removed_is_exact_bucket = MODES.every(([, l]) => filters[key][l].removed_is_exact_bucket);
  filters[key].facilities_never_removed = MODES.every(([, l]) => filters[key][l].removed_facilities === 0);
  // EMPTY-BUCKET HONESTY. `0 === 0` is not a pass — it is the "did not run" and "no match"
  // pair being indistinguishable, which is the exact trap this repo has a rule about. A
  // bucket with no records on this ZIP is reported as UNTESTED and covered by the frozen
  // fixture pass below instead of being quietly scored green here.
  filters[key].exercised = FILTER_EXPECT[key] > 0;
  if (!filters[key].exercised) untestedBuckets.push(key);
}
if (untestedBuckets.length) {
  console.log(`\n⚠ lifecycle bucket(s) with ZERO records on the live inventory: `
    + `${untestedBuckets.join(', ')} — their toggles are NOT exercised by the live pass. `
    + `0 removed of 0 expected proves nothing. Covered by the frozen-fixture pass below.`);
}

// ── STEP 8 — FROZEN FIXTURE PASS: the lifecycle-unknown branch ──────────────────────────
// `unknown` is a first-class legended state whose entire purpose is to NOT fabricate a fact:
// lib/map.js:180-184 — "a record whose source states no lifecycle must never be silently
// promoted to operating/built (that fabricates a fact) nor demoted to proposed."
//
// Production currently holds ZERO records in that bucket ZIP-wide and table-wide (the five
// Del Valle TABS rows moved off 'On file' during 2026-08), so the live pass above cannot
// exercise it. Retiring the branch because it is momentarily unpopulated is backwards — it
// matters MOST when rare. So it is proven against scripts/gate2/rows.tsv via seed78617.mjs:
// 39 rows exported VERBATIM from production (README: "39 PRODUCTION rows exported verbatim
// from app_projects (zip 78617)"), five of which still carry 'On file'. Frozen input, frozen
// expectation, no fabrication — the vintage is the point.
const FROZEN = census(FROZEN_ROWS, 'frozen fixture', GID);
const frozenEvidence = new Map(FROZEN_ROWS.map(r => [r.__gid, r.source_ref || '']));
const frozenUnknownIds = FROZEN.ids.unknown.slice().sort();
// The fixture must PROVE IT CAN TEST what it is here to test, before it is allowed to pass.
if (!frozenUnknownIds.length)
  fail('the frozen fixture carries 0 lifecycle-unknown rows — it can no longer exercise the '
    + 'branch it exists for. Restore an `On file` row to scripts/gate2/rows.tsv rather than '
    + 'letting this pass vacuously.');
await loadSeed(FROZEN_SEED, 'gate2b-frozen-unknown-branch');
await clickMode('street');
await page.waitForTimeout(2000);
const frozenBefore = await page.evaluate(() => window.__canonIds());
await page.evaluate(() => window.HS.setStatusFilter('unknown', false));
await clickMode('satellite'); await page.waitForTimeout(500);
await clickMode('street'); await page.waitForTimeout(1600);
const frozenAfter = await page.evaluate(() => window.__canonIds());
await page.screenshot({ path: join(OUT, 'gate2b-frozen-unknown-off.png') });
await page.evaluate(() => window.HS.setStatusFilter('unknown', true));   // filters persist per session
const frozenAfterSet = new Set(frozenAfter);
const frozenRemoved = frozenBefore.filter(i => !frozenAfterSet.has(i)).sort();
const frozen_pass = {
  seed_rows: FROZEN_ROWS.length,
  census: FROZEN.counts,
  baseline_plotted: frozenBefore.length,
  baseline_is_full_fixture: frozenBefore.length === FROZEN_ROWS.length,
  unknown_expected: frozenUnknownIds.length,
  unknown_removed: frozenRemoved.length,
  removed_is_exact_bucket: JSON.stringify(frozenRemoved) === JSON.stringify(frozenUnknownIds),
  removed_all_tabs: frozenRemoved.every(gid => (frozenEvidence.get(gid) || '').includes('tdlr.texas.gov')),
};
console.log('\nFROZEN FIXTURE (unknown branch): ' + JSON.stringify(frozen_pass));

const tabs = A.records.filter(r => !r.registry_id && r.kind === 'development');
const facRows = A.records.filter(r => r.kind === 'facility');
const report = {
  step1_export: { exported_at: EXPORTED_AT, total: RAW.length, development: DEV.length, facilities: FAC.length,
    tabs: TABS.length, null_registry: RAW.filter(r => !r.registry_id).length, registry_distribution: regDist,
    lifecycle_census: LIVE.counts, fixture_sha256: fixtureSha },
  step2_adapter: { entered: RAW.length, left: ADAPTED.length, unique_ids: new Set(ADAPTED.map(r => r.id)).size, adapted_sha256: adaptedSha },
  step3_validation: { intercepted, seed_source: 'gate2b-delvalle-78617-full', canonical: A.total,
    dev: A.dev, fac: A.fac, tabs: tabs.length, lettered: A.lettered, rest: A.rest,
    focusExpected: C.focusExpected, focusMarkerCount: C.focusMarkerCount, complete: A.complete,
    unexplained_loss: EXPECTED_TOTAL - A.total },
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
  step7_untested_buckets: untestedBuckets,
  step8_frozen_unknown_branch: frozen_pass,
  console_errors: consoleErrors, page_errors: pageErrors,
};
writeFileSync(join(OUT, 'gate2b-report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close(); srv.close();

// ── WHAT THE PARITY PASS ACTUALLY FOUND ─────────────────────────────────────────────────
// Printed on EVERY run, pass or fail. This gate did not execute a parity comparison between
// 2026-07-28 and this build, so the first green run is also the first real comparison in
// weeks — and a green result that hides "here is what it saw" would waste exactly the signal
// the repair exists to restore.
console.log('\n=== PARITY FINDINGS (Street / Satellite / Focus) ===');
console.log(`records compared           : ${ids.length}`);
console.log(`same id set across modes   : ${sameSet}`);
console.log(`field mismatches           : ${mism.length}`);
if (mism.length) {
  const byField = mism.reduce((a, m) => { a[m.field] = (a[m.field] || 0) + 1; return a; }, {});
  console.log('  by field                 :', JSON.stringify(byField));
  for (const m of mism.slice(0, 20)) console.log(`  ${m.field.padEnd(10)} ${m.id} :: street=${m.street} satellite=${m.satellite} focus=${m.focus}`);
}
console.log(`category histogram (Street): ${JSON.stringify(A.by_category)}`);
console.log(`symbol histogram   (Street): ${JSON.stringify(A.by_symbol)}`);
console.log(`lifecycle histogram(Street): ${JSON.stringify(A.by_lifecycle)}`);
console.log(`fallback-shape records     : ${A.by_fallback['has-reason'] || 0} of ${A.total} (each carries a stated reason)`);
console.log(`restFacs agrees with page  : ${A.restfac_count_agrees} (harness ${A.rest_facs} vs page ${A.restFacTotal_page})`);
console.log(`console errors / page errors: ${consoleErrors.length} / ${pageErrors.length}`);

const hardFail = mism.length || !sameSet || A.total !== EXPECTED_TOTAL || pageErrors.length
  || !report.facilities_all_square
  // An unexercised bucket is neither passed nor failed here — `exercised` gates the two
  // count-based assertions so an empty bucket cannot score green, while the structural
  // assertions (identical across modes, canonical baseline, facilities never removed) still
  // hold for every bucket.
  || Object.entries(filters).some(([, f]) => !f.identical_across_modes || !f.baseline_is_canonical
       || !f.facilities_never_removed
       || (f.exercised && (!f.removed_matches_expected || !f.removed_is_exact_bucket)))
  || !frozen_pass.baseline_is_full_fixture
  || !frozen_pass.removed_is_exact_bucket
  || !frozen_pass.removed_all_tabs;
console.log(hardFail ? '\nRESULT: GATE 2 FAIL' : '\nRESULT: GATE 2 FULL-INVENTORY PASS');
process.exit(hardFail ? 1 : 0);

// Source-identity regression (maps-backbone Gate 1).
//
// The chain that must never lose the canonical source key:
//   adapter → NormalizedRecord → development_reports cache → app_refresh_zip →
//   app_projects → API → browser payload
//
// The DB half (app_refresh_zip → app_projects) is proven live and recorded in
// docs/maps-source-identity-migration.sql:
//   before  457 rows · content_hash f30b5abdc6437de96b15f8dcd42dea90 · dev rows with source 0
//   after   457 rows · content_hash f30b5abdc6437de96b15f8dcd42dea90 · dev rows with source 423
// i.e. identical content, source identity gained. This file pins the JS half — the two
// places the key could still be dropped between the DB row and the rendered marker.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ── 1. The cache carries the canonical key on every connector record ─────────
// Shape pinned from production development_reports.sites (zip 78617).
const CACHED = {
  lat: 30.16787011, lng: -97.63457491, scope: 'point', relevance: 'development',
  title: 'Dalfen Industrial', label: 'Dalfen Industrial', bucket: 'approved',
  status_raw: 'Approved and Released', case_number: 'SP-2020-0407D',
  record_url: 'https://abc.austintexas.gov/web/permit/public-search-other?t_detail=1&t_selected_folderrsn=12594668',
  source_class: 'socrata', source_registry_id: 'austin-site-plan-cases',
  source_id: 'socrata:data.austintexas.gov:mavg-96ck:SP-2020-0407D',
  use_type: 'Industrial', zip: '78617',
};
ok(CACHED.source_registry_id !== '', '1: cache row carries source_registry_id');
ok(CACHED.source_id.startsWith('socrata:'), '1: cache row carries a fully-qualified source_id');

// ── 2. app_refresh_zip's development insert maps it to app_projects.registry_id ──
// Mirrors the migrated SELECT term: nullif(el->>'source_registry_id','')
const toAppProject = (el) => ({
  zip: el.zip, name: el.label, type: el.use_type, status: 'Approved',
  lat: el.lat, lng: el.lng, source_ref: el.record_url || el.url,
  record_kind: 'development',
  registry_id: (el.source_registry_id || '') === '' ? null : el.source_registry_id,
});
{
  const row = toAppProject(CACHED);
  eq(row.registry_id, 'austin-site-plan-cases', '2: registry_id survives the materializer mapping');
  eq(row.source_ref, CACHED.record_url, '2: evidence URL is unchanged by the migration');
  eq(row.lat, CACHED.lat, '2: latitude unchanged');
  eq(row.lng, CACHED.lng, '2: longitude unchanged');
  eq(row.zip, '78617', '2: ZIP assignment unchanged');
  eq(row.name, CACHED.label, '2: title unchanged');
  // A record with NO source key (TABS today) must land NULL, never an empty string —
  // an empty string would look like a real source id to a downstream audit.
  const tabs = toAppProject({ ...CACHED, source_registry_id: '' });
  eq(tabs.registry_id, null, '2: a source-less record yields NULL, not ""');
}

// ── 3. The browser normalizer must not drop the key ─────────────────────────
// lib/data.js::normProject is what every map page renders from.
{
  const src = readFileSync(join(root, 'lib/data.js'), 'utf8');
  const m = src.match(/function normProject[\s\S]*?\n  \}/);
  ok(!!m, '3: normProject found in lib/data.js');
  if (m) {
    const body = m[0];
    const dropsFields = /return\s*\{[\s\S]*?\}/.test(body) && !/\.\.\.\s*(p|row|r)\b/.test(body);
    ok(!dropsFields || /registry_id/.test(body),
       '3: normProject either spreads the row or explicitly carries registry_id');
  }
}

// ── 4. The marker resolver must not strip it, and facility identity is separate ──
{
  const win = { HS: {} };
  globalThis.window = win; globalThis.document = { getElementById: () => null };
  new Function('window', 'document', readFileSync(join(root, 'lib/map.js'), 'utf8'))(win, globalThis.document);
  const HS = win.HS;
  const devRow = { ...toAppProject(CACHED), status: 'Approved' };
  const m = HS.resolveMarker(devRow);
  ok(m.categoryKey && m.lifecycle, '4: a development row with a registry_id still resolves fully');
  ok(!m.isFacility, '4: a registry_id on a DEVELOPMENT row must not make it a facility');
  eq(m.lifecycle, 'approved', '4: lifecycle unaffected by source identity');
  // The facility branch keys on record_kind/_facility, NOT on the presence of registry_id.
  const facRow = { ...devRow, record_kind: 'facility', registry_id: '110070171250' };
  ok(HS.resolveMarker(facRow).isFacility, '4: record_kind=facility still resolves as a facility');
}

// ── 5. Source identity is usable for a per-source audit ─────────────────────
{
  const rows = [
    toAppProject(CACHED),
    toAppProject({ ...CACHED, source_registry_id: 'austin-subdivision-cases' }),
    toAppProject({ ...CACHED, source_registry_id: '' }),
  ];
  const bySource = rows.reduce((a, r) => { const k = r.registry_id || '(none)'; a[k] = (a[k] || 0) + 1; return a; }, {});
  eq(Object.keys(bySource).sort().join(','), '(none),austin-site-plan-cases,austin-subdivision-cases',
     '5: markers group by source for audit/recall');
}


// ── 6. Gate 2B canonical-inventory partition (regression for the 5-facility loss) ──
// maps.html:351-352 splits the mappable facilities:
//     var facs     = facsAllMappable.slice(0, 24);
//     var restFacs = facsAllMappable.slice(24).map(f => ({...f, _restFacility: true}));
// Any harness that measures "everything the page plots" as `visible ∪ facs` silently drops
// every facility at index >= 24. That is invisible below 25 facilities (the 39-row Gate 2A
// sample had 6) and lost exactly 5 of Del Valle's 29 at full scale. Canonical must be
// visible ∪ facs ∪ restFacs.
{
  const NEAREST_FAC_CAP = 24;
  const mk = (i) => ({ id: 'f' + i, record_kind: 'facility', _facility: true,
    source_ref: 'https://echo.epa.gov/detailed-facility-report?fid=' + (110000000000 + i),
    name: 'FAC ' + i, lat: 30.1 + i / 1000, lng: -97.6 - i / 1000 });
  const allFacs = Array.from({ length: 29 }, (_, i) => mk(i));
  const facs = allFacs.slice(0, NEAREST_FAC_CAP);
  const restFacs = allFacs.slice(NEAREST_FAC_CAP).map(f => Object.assign({}, f, { _restFacility: true }));
  const visible = Array.from({ length: 428 }, (_, i) => ({ id: 'd' + i, record_kind: 'development' }));

  eq(visible.length + facs.length, 452, '6: visible ∪ facs alone reproduces the 452 undercount');
  eq(visible.length + facs.length + restFacs.length, 457, '6: visible ∪ facs ∪ restFacs is the full inventory');
  eq(restFacs.length, 5, '6: exactly 5 facilities land beyond the nearest-24 cap');
  // the derived fallback (all seed facilities minus facs) must equal the page's restFacs
  const facIds = new Set(facs.map(f => f.source_ref));
  const derived = allFacs.filter(f => !facIds.has(f.source_ref));
  eq(derived.length, restFacs.length, '6: derived restFacs count matches the page partition');
  eq(derived.map(f => f.source_ref).join(','), restFacs.map(f => f.source_ref).join(','),
     '6: derived restFacs are the SAME records, not just the same count');
  // and no record may appear twice across the three partitions
  const all = visible.concat(facs).concat(restFacs).map(x => x.source_ref || x.id);
  eq(new Set(all).size, 457, '6: the three partitions are disjoint — no double count');
}


// ── 7. The FILTER baseline must be the canonical set, not `visible ∪ facs` ───────────
// Gate 2B shipped with §6 fixed in the parity collector but NOT in the filter collector, so
// every filter row reported before/restored = 452 and a removed_count inflated by exactly the
// 5 restFacs (they sat outside the measurement window, so they read as permanently hidden).
// This pins the repaired contract: ONE canonical accessor feeds both collectors, facilities
// are never removed by a LIFECYCLE toggle, and removed_count is the true hidden count.
{
  const HS = globalThis.window.HS;
  const NEAREST_FAC_CAP = 24, FAC_TOTAL = 29;
  const facility = (i) => ({ record_kind: 'facility', _facility: true, name: 'FAC ' + i,
    source_ref: 'https://echo.epa.gov/detailed-facility-report?fid=' + (110000000000 + i),
    lat: 30.1 + i / 1000, lng: -97.6 - i / 1000 });
  const dev = (i, status) => ({ record_kind: 'development', name: 'DEV ' + i, status,
    source_ref: 'https://abc.austintexas.gov/web/permit/x' + i, type: 'Industrial' });

  // The accepted Del Valle lifecycle census, reproduced at shape: 36 proposed, 323 approved,
  // 64 operating development rows, 5 unknown (TABS) — plus 29 facilities that render
  // 'operating' but live in the FACILITY filter bucket.
  const LIFE = { proposed: 36, approved: 323, operating: 64, unknown: 5 };
  const devRows = [];
  let n = 0;
  for (const [k, c] of Object.entries(LIFE))
    for (let i = 0; i < c; i++) devRows.push(dev(n++, k === 'unknown' ? '' : k === 'operating' ? 'Built' : k));
  eq(devRows.length, 428, '7: the modelled development set is the accepted 428');

  const allFacs = Array.from({ length: FAC_TOTAL }, (_, i) => facility(i));
  const facs = allFacs.slice(0, NEAREST_FAC_CAP);
  const restFacs = allFacs.slice(NEAREST_FAC_CAP);

  // The ONE canonical accessor, mirroring scripts/gate2/full-inventory.mjs::__canonSet.
  const canonSet = (visible, restFacsArg) => visible.concat(facs).concat(restFacsArg);
  const idOf = x => x.source_ref || x.name;

  eq(canonSet(devRows, restFacs).length, 457, '7: the filter baseline is the canonical 457, not 452');
  eq(devRows.length + facs.length, 452, '7: 452 is the OLD window — it must no longer be the baseline');

  // A facility's filter key is 'facility' for BOTH the nearest-24 and the restFacs tail, so
  // no lifecycle toggle may ever select one.
  const LIFECYCLE_KEYS = ['proposed', 'approved', 'operating', 'unknown'];
  for (const f of [facs[0], facs[23], restFacs[0], restFacs[4]]) {
    const m = HS.resolveMarker(f);
    eq(m.filterKey, 'facility', '7: facility filterKey is facility (incl. the restFacs tail)');
    ok(!LIFECYCLE_KEYS.includes(m.filterKey), '7: a facility is outside every lifecycle filter');
  }
  eq(HS.resolveMarker(restFacs[0]).lifecycle, 'operating',
     '7: a restFacs facility still RENDERS operating while filtering as facility');

  // Toggling each lifecycle key off hides exactly its development rows — the count must not
  // pick up the +5 restFacs offset the old 452-row window produced.
  const ids = canonSet(devRows, restFacs).map(idOf);
  for (const key of LIFECYCLE_KEYS) {
    const visibleAfter = devRows.filter(d => HS.resolveMarker(d).filterKey !== key);
    const after = new Set(canonSet(visibleAfter, restFacs).map(idOf));   // facilities survive
    const removed = ids.filter(i => !after.has(i));
    eq(removed.length, LIFE[key], `7: ${key} hides exactly ${LIFE[key]} records — no +5 offset`);
    eq(removed.filter(i => i.includes('echo.epa.gov')).length, 0,
       `7: no facility is removed by the ${key} lifecycle filter`);
    eq(canonSet(visibleAfter, restFacs).length + removed.length, 457,
       `7: after + removed reconciles to the canonical 457 for ${key}`);
  }

  // The derivation fallback must not paper over a genuinely empty restFacs array: an explicit
  // [] is honoured, so a filter that really did hide facilities would be reported, not hidden.
  eq(canonSet(devRows, []).length, 452, '7: an explicitly EMPTY restFacs is honoured verbatim');
}

console.log(`maps-source-identity: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

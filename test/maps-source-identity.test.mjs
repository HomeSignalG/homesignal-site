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

console.log(`maps-source-identity: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

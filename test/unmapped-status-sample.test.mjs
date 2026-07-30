// Offline regression checks for the UNMAPPED-STATUS flag on both permit connectors
// (sources/arcgis.ts + sources/socrata.ts). No network: the real connector modules are
// imported and driven with a stubbed fetch.
//
// WHY THIS EXISTS. An unmapped status is the ONE soft-fail that DROPS a record — the
// connector cannot bucket it, so it `continue`s and the row never reaches the page. It was
// counted in `report.unmapped_statuses` but carried no record identity, so the flag said
// "3 records vanished" without naming one. The 2026-07-29 TX/UT sweep found 6 such records
// live (fort-worth-development-permits 'Corrections Submitted', fort-worth-zoning-cases
// 'Approved as amended', provo-planning-applications 'Administrative Approval' /
// 'Approved w/ Conditions' / 'Zoning Board') and none had ever surfaced, because
// verify-development samples only RUN_REPORT_SAMPLE ZIPs (3) out of thousands.
//
// The assertions pin, on BOTH connectors:
//   • an unmapped status excludes the record (never silently emitted with a wrong bucket),
//   • it is counted AND carries `sample` = the first case/permit number seen with that value,
//   • a MAPPED status is untouched (no behavior change on the happy path),
//   • an unmapped TYPE stays non-fatal — the record is still emitted, `use_type` is
//     "unclassified". Type must NEVER gain drop semantics.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

// The connectors are TypeScript. Node >= 22.18 strips types on import, so these checks run
// the SHIPPED code rather than a copy of it. On an older runtime fail loudly instead of
// silently skipping — a green run must mean the assertions actually executed.
const ARCGIS = join(root, 'supabase/functions/get-address-report/sources/arcgis.ts');
const SOCRATA = join(root, 'supabase/functions/get-address-report/sources/socrata.ts');
let arcgisForZip, socrataForZip;
try {
  ({ arcgisForZip } = await import(ARCGIS));
  ({ socrataForZip } = await import(SOCRATA));
} catch (err) {
  console.log('FAIL — import connector sources (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

const COMMUNITIES = [{ state: 'TX', county: 'Tarrant' }];

// ── ArcGIS ──────────────────────────────────────────────────────────────────────
// Two rows: one mapped status, one unmapped. Only the mapped row may be emitted.
const ARCGIS_ENTRY = {
  registry_id: 'test-arcgis-unmapped',
  platform: 'arcgis',
  service_url: 'https://example.invalid/arcgis/rest/services/Test/MapServer/0',
  jurisdiction: 'Test City',
  coverage: [{ state: 'TX', county: 'Tarrant' }],
  column_map: {
    title: 'NAME', status_raw: 'STATUS', type_source: 'USE',
    file_date: 'FILED', case_number: 'CASENO', record_url: 'URL',
    lat: '__lat', lng: '__lng', zip: 'ZIP',
  },
  type_map: { Shop: 'Commercial' },
  status_to_bucket: { proposed: ['Pending'], approved: [], operating: [], exclude: [] },
  record_url_precision: 'record',
};
const ARCGIS_FEATURES = [
  { attributes: { NAME: 'Mapped job', STATUS: 'Pending', USE: 'Shop', FILED: 1772668800000, CASENO: 'OK-001', URL: 'https://example.invalid/r/OK-001', ZIP: '76110' }, geometry: { x: -97.33, y: 32.71 } },
  { attributes: { NAME: 'Dropped job', STATUS: 'Corrections Submitted', USE: 'Shop', FILED: 1772668800000, CASENO: 'BAD-042', URL: 'https://example.invalid/r/BAD-042', ZIP: '76110' }, geometry: { x: -97.34, y: 32.72 } },
  { attributes: { NAME: 'Dropped job two', STATUS: 'Corrections Submitted', USE: 'Shop', FILED: 1772668800000, CASENO: 'BAD-043', URL: 'https://example.invalid/r/BAD-043', ZIP: '76110' }, geometry: { x: -97.35, y: 32.73 } },
  { attributes: { NAME: 'Unmapped type', STATUS: 'Pending', USE: 'Zeppelin Hangar', FILED: 1772668800000, CASENO: 'TYPE-001', URL: 'https://example.invalid/r/TYPE-001', ZIP: '76110' }, geometry: { x: -97.36, y: 32.74 } },
];
const arcgisFetch = async (url) => {
  const u = String(url);
  // Layer metadata probe → advertise a point layer; data query → the features above.
  if (!u.includes('/query')) {
    return new Response(JSON.stringify({ geometryType: 'esriGeometryPoint', fields: [], maxRecordCount: 1000 }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('resultOffset=1000') || u.includes('resultOffset=2000')) {
    return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ geometryType: 'esriGeometryPoint', features: ARCGIS_FEATURES }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const aRes = await arcgisForZip('76110', COMMUNITIES, [ARCGIS_ENTRY], { fetch: arcgisFetch });
const aRep = (aRes.reports || [])[0];
ok(!!aRep, 'arcgis: a run report was produced');
const aCases = (aRes.sites || []).map((r) => r.case_number).sort();
ok(JSON.stringify(aCases) === JSON.stringify(['OK-001', 'TYPE-001']),
  'arcgis: only the MAPPED-status rows are emitted — the unmapped-status rows are dropped',
  'got ' + JSON.stringify(aCases));
const aUnmapped = (aRep?.unmapped_statuses || []).find((u) => u.status === 'Corrections Submitted');
ok(!!aUnmapped, 'arcgis: the unmapped status is flagged in unmapped_statuses');
ok(aUnmapped?.count === 2, 'arcgis: the flag counts every dropped record (2)', 'got ' + aUnmapped?.count);
ok(aUnmapped?.sample === 'BAD-042',
  'arcgis: the flag carries the FIRST case number seen — a human can look the record up',
  'got ' + JSON.stringify(aUnmapped?.sample));
const aTypeRow = (aRes.sites || []).find((r) => r.case_number === 'TYPE-001');
ok(aTypeRow?.use_type === 'unclassified',
  'arcgis: an unmapped TYPE is still EMITTED as unclassified — type never drops a record',
  'got ' + JSON.stringify(aTypeRow?.use_type));

// ── Socrata ─────────────────────────────────────────────────────────────────────
const SOCRATA_ENTRY = {
  registry_id: 'test-socrata-unmapped',
  platform: 'socrata',
  domain: 'example.invalid',
  dataset_id: 'aaaa-bbbb',
  jurisdiction: 'Test City',
  coverage: [{ state: 'TX', county: 'Tarrant' }],
  column_map: {
    title: 'name', status_raw: 'status', type_source: 'use',
    file_date: 'filed', case_number: 'caseno', record_url: 'url',
    lat: 'latitude', lng: 'longitude', zip: 'zip',
  },
  type_map: { Shop: 'Commercial' },
  status_to_bucket: { proposed: ['Pending'], approved: [], operating: [], exclude: [] },
  record_url_precision: 'record',
};
const SOCRATA_ROWS = [
  { name: 'Mapped job', status: 'Pending', use: 'Shop', filed: '2026-03-05', caseno: 'S-OK-001', url: 'https://example.invalid/s/OK-001', zip: '76110', latitude: '32.71', longitude: '-97.33' },
  { name: 'Dropped job', status: 'Zoning Board', use: 'Shop', filed: '2026-03-05', caseno: 'S-BAD-042', url: 'https://example.invalid/s/BAD-042', zip: '76110', latitude: '32.72', longitude: '-97.34' },
];
const socrataFetch = async (url) => {
  const u = String(url);
  if (u.includes('$offset=1000') || u.includes('$offset=2000')) {
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify(SOCRATA_ROWS), { status: 200, headers: { 'content-type': 'application/json' } });
};

const sRes = await socrataForZip('76110', COMMUNITIES, [SOCRATA_ENTRY], { fetch: socrataFetch });
const sRep = (sRes.reports || [])[0];
ok(!!sRep, 'socrata: a run report was produced');
const sCases = (sRes.sites || []).map((r) => r.case_number).sort();
ok(JSON.stringify(sCases) === JSON.stringify(['S-OK-001']),
  'socrata: only the MAPPED-status row is emitted — the unmapped-status row is dropped',
  'got ' + JSON.stringify(sCases));
const sUnmapped = (sRep?.unmapped_statuses || []).find((u) => u.status === 'Zoning Board');
ok(!!sUnmapped, 'socrata: the unmapped status is flagged in unmapped_statuses');
ok(sUnmapped?.count === 1, 'socrata: the flag counts the dropped record (1)', 'got ' + sUnmapped?.count);
ok(sUnmapped?.sample === 'S-BAD-042',
  'socrata: the flag carries the case number of the dropped record',
  'got ' + JSON.stringify(sUnmapped?.sample));

if (fails) {
  console.log(`\n${fails} unmapped-status assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll unmapped-status flag assertions passed.');

// Offline regression checks for the `mt-mdt-stip-lines` registry entry
// (Montana DOT STIP "Lines (2026)", gis.mtmdt.us MDTGIS/State_Transportation_Improvement_Program/1).
// No network: the SHIPPED connector (sources/arcgis.ts) is driven over a REAL captured
// query response (fixtures/mdt-stip/lines-sample.json, pg_net request 11556, outSR=4326).
//
// WHY THIS EXISTS. Statewide entry (coverage [{state:'MT'}], the udot/txdot shape), and
// Williston ND sits in the Bakken corridor near the MT line — the Camden-NJ analog. The
// gate must hold BOTH ways: MDT records ride MT pages only, and a Williston ND ZIP never
// even FETCHES the layer. The sibling "STIP Points (2026)" layer 0 carries 5 features and
// is deliberately NOT wired (logged in _receipts), so exactly ONE MDT entry may exist.
// Live receipts (SCOPE vocab summing 275 exactly, FFY distribution, org-name check,
// edge-probe 3/3): jurisdiction-registry `_receipts` + QUEUE.md "DOT RECON BATCH".
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const SRC = join(root, 'supabase/functions/get-address-report/sources/arcgis.ts');
let arcgisForZip, coverageMatches;
try {
  ({ arcgisForZip, coverageMatches } = await import(SRC));
} catch (err) {
  console.log('FAIL — import sources/arcgis.ts (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const ENTRY = REG.arcgis.find((e) => e.registry_id === 'mt-mdt-stip-lines');
ok(!!ENTRY, 'jurisdiction-registry carries mt-mdt-stip-lines');

// ── 1. Entry shape ───────────────────────────────────────────────────────────────
ok(ENTRY.service_url === 'https://gis.mtmdt.us/server/rest/services/MDTGIS/State_Transportation_Improvement_Program/MapServer/1',
  'service_url is the STIP Lines layer on MDT\'s own server');
ok(ENTRY.coverage.length === 1 && ENTRY.coverage[0].state === 'MT' && !ENTRY.coverage[0].county,
  'coverage is exactly [{state: MT}] — statewide, no county');
ok(ENTRY.spatial_zip_radius_mi === 3, 'ZIP scoping is spatial at the engine-standard 3 mi');
ok(JSON.stringify(ENTRY.column_map.title) === JSON.stringify(['SIGNED_ROUTE', 'PROJECT_NAME']),
  'title is SIGNED_ROUTE + PROJECT_NAME (measured 275/275 populated; internal ROUTE codes rejected)');
ok(!('file_date' in ENTRY.column_map),
  'file_date is DELIBERATELY ABSENT — FFY_YEAR is a forecast program year (founder rider)');
ok(ENTRY.status_const === 'Programmed'
    && ENTRY.status_to_bucket.proposed.length === 1 && ENTRY.status_to_bucket.proposed[0] === 'Programmed'
    && ENTRY.status_to_bucket.approved.length === 0 && ENTRY.status_to_bucket.operating.length === 0,
  'STIP shape: status_const Programmed → proposed only (nj-stip/mndot-stip fleet)');
ok(ENTRY.record_url_precision === 'dataset', 'record_url is dataset-precision (no per-record URL column)');
ok(!('return_centroid' in ENTRY), 'return_centroid is NOT set (classic MapServer; polyline rides featurePoint)');
ok(!('recency_days' in ENTRY), 'no recency_days — the layer has no real date column to window on');
{
  const vals = Object.keys(ENTRY.type_map);
  ok(vals.length === 26, `type_map carries all 26 verbatim SCOPE values (got ${vals.length})`);
  ok(Object.values(ENTRY.type_map).every((v) => v === 'Utility'),
    'every SCOPE value maps to Utility (statewide-DOT fleet)');
  ok(Object.hasOwn(ENTRY.type_map, '510 - ENVIRONMENTAL') && Object.hasOwn(ENTRY.type_map, '510-ENVIRONMENTAL'),
    "both upstream '510' spelling variants kept verbatim");
  ok(Object.hasOwn(ENTRY.type_map, '30 - RECONSTRUCTION - WITH ADDED CAPACITY'),
    "the upstream '30 -' variant of '130 -' kept verbatim, never 'corrected'");
}
{
  const all = ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft']
    .flatMap((p) => REG[p] || [])
    .filter((e) => (e.jurisdiction || '').includes('Montana Department of Transportation')
      || (e.service_url || '').includes('gis.mtmdt.us'));
  ok(all.length === 1, `exactly ONE MDT entry exists in the whole registry (got ${all.length})`);
}

// ── 2. Drive the SHIPPED connector over the real captured response ───────────────
const FIXTURE = JSON.parse(readFileSync(join(root, 'fixtures/mdt-stip/lines-sample.json'), 'utf8'));
const BILLINGS_CENTROID = { lat: 45.7833, lng: -108.5007 };  // 59101 Billings MT
const WILLISTON_CENTROID = { lat: 48.1470, lng: -103.6180 }; // 58801 Williston ND

function stubFetch(calls) {
  let served = false;
  return async (url) => {
    calls.push(String(url));
    const body = served ? { features: [] } : FIXTURE;
    served = true;
    return { ok: true, status: 200, json: async () => body };
  };
}

{
  const calls = [];
  const { sites, reports } = await arcgisForZip(
    '59101',
    [{ state: 'MT', county: 'Yellowstone' }],
    [ENTRY],
    { fetch: stubFetch(calls), zipCentroid: BILLINGS_CENTROID },
  );
  ok(sites.length === 3, `all 3 fixture features emitted (got ${sites.length})`);
  ok(sites.every((s) => s.record_url === ENTRY.dataset_url && s.record_url_precision === 'dataset'),
    'every record carries the dataset-precision record_url (anti-fabrication gate)');
  ok(sites.every((s) => typeof s.lat === 'number' && typeof s.lng === 'number' && s.scope === 'point'),
    'every polyline is pinned from its OWN geometry via the featurePoint midpoint');
  ok(sites.every((s) => s.lat > 44.3 && s.lat < 49.1 && s.lng > -116.2 && s.lng < -104),
    'pins land inside Montana, not another jurisdiction');
  ok(sites.every((s) => s.bucket === 'proposed'), 'every STIP row lands in the proposed bucket (Programmed)');
  ok(sites.every((s) => s.use_type === 'Utility'), 'every fixture SCOPE maps to Utility, 0 unclassified');
  ok(sites.every((s) => s.case_number), 'every record carries its UPN as case_number');
  ok(sites.every((s) => s.file_date == null), 'no record fabricates a file_date (forecast years never become dates)');
  ok(sites.some((s) => s.title.includes('VANDALIA REST AREA REHAB') && s.title.includes('US-2')),
    'titles join SIGNED_ROUTE + PROJECT_NAME');
  ok(sites.every((s) => s.source_registry_id === 'mt-mdt-stip-lines'
      && s.jurisdiction === 'Montana Department of Transportation'),
    'records are stamped with the MDT registry id + jurisdiction');
  ok(reports[0].unmapped_statuses.length === 0 && reports[0].blank_status === 0,
    'run report shows no unmapped or blank statuses (status_const)');
  ok(calls.length > 0 && calls[0].includes('geometryType=esriGeometryEnvelope'),
    'the query scopes by spatial envelope (no ZIP column exists)');
  ok(calls[0].includes('outSR=4326'), 'geometry is requested in WGS84');
  ok(!calls[0].includes('returnCentroid'), 'returnCentroid is NEVER sent');
  ok(calls[0].includes('outFields=OBJECTID%2CUPN'),
    'outFields is projected to the mapped columns, not "*"');
}

// ── 3. Coverage gate, both directions — Williston ND is the control ──────────────
ok(coverageMatches(ENTRY.coverage, [{ state: 'MT', county: 'Yellowstone' }]), 'gate ALLOWS MT/Yellowstone');
ok(coverageMatches(ENTRY.coverage, [{ state: 'MT', county: 'Missoula' }]), 'gate ALLOWS MT/Missoula (statewide)');
ok(!coverageMatches(ENTRY.coverage, [{ state: 'ND', county: 'Williams' }]), 'gate BLOCKS ND/Williams');
ok(!coverageMatches(ENTRY.coverage, [{ state: 'WY', county: 'Campbell' }]), 'gate BLOCKS WY');
{
  const calls = [];
  const { sites } = await arcgisForZip(
    '58801',
    [{ state: 'ND', county: 'Williams' }],
    [ENTRY],
    { fetch: stubFetch(calls), zipCentroid: WILLISTON_CENTROID },
  );
  ok(sites.length === 0 && calls.length === 0,
    'Williston ND (58801) emits nothing AND never fetches the layer');
}

console.log(fails ? `\n${fails} mdt-stip-connector assertion(s) FAILED.` : '\nAll mdt-stip-connector assertions passed.');
process.exit(fails ? 1 : 0);

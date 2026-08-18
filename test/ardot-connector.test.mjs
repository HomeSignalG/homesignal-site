// Offline regression checks for the ARDOT pair — `ar-ardot-job-status-points` (layer 2) +
// `ar-ardot-job-status-lines` (layer 3) on gis.ardot.gov ProgramManagement/Job_Status_Web_Application.
// No network: the SHIPPED connector (sources/arcgis.ts) and the SHIPPED yields hook
// (sources/yields.ts) are driven over REAL captured responses (fixtures/ardot/*.json,
// pg_net 13087-13090, outSR=4326).
//
// WHY THIS EXISTS. Statewide pair (coverage [{state:'AR'}]) with Memphis TN across the
// Mississippi River as the control. Beyond the standard gate, this file pins the
// founder-approved overlap resolution END TO END on real records: Job_No 012289 genuinely
// exists as TWO point sites (layer 2) AND a line segment (layer 3) — the yields hook must
// leave exactly the Lines record. The status codes are verbatim "01"/"02"/"03" with the
// publisher's own decode (ARDOT web map Arcade expr: 01=Scheduled, 02=Under Construction,
// 03=Completed) receipted in the registry `_receipts`.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const ARC = join(root, 'supabase/functions/get-address-report/sources/arcgis.ts');
const YLD = join(root, 'supabase/functions/get-address-report/sources/yields.ts');
let arcgisForZip, coverageMatches, applyYields, buildYieldsMap;
try {
  ({ arcgisForZip, coverageMatches } = await import(ARC));
  ({ applyYields, buildYieldsMap } = await import(YLD));
} catch (err) {
  console.log('FAIL — import shipped modules (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const POINTS = REG.arcgis.find((e) => e.registry_id === 'ar-ardot-job-status-points');
const LINES = REG.arcgis.find((e) => e.registry_id === 'ar-ardot-job-status-lines');
ok(!!POINTS && !!LINES, 'jurisdiction-registry carries both ARDOT entries');

// ── 1. Entry shape — both entries, and the yield declaration ─────────────────────
const SVC = 'https://gis.ardot.gov/referenced/rest/services/ProgramManagement/Job_Status_Web_Application/MapServer/';
ok(POINTS.service_url === SVC + '2' && LINES.service_url === SVC + '3',
  'service_urls are layers 2 (points) and 3 (lines) on ARDOT\'s own server');
ok(POINTS.yields_to === 'ar-ardot-job-status-lines' && !('yields_to' in LINES),
  'POINTS yields_to LINES; LINES yields to nothing (one-directional)');
for (const e of [POINTS, LINES]) {
  const id = e.registry_id;
  ok(e.coverage.length === 1 && e.coverage[0].state === 'AR' && !e.coverage[0].county, `${id}: coverage exactly [{state: AR}]`);
  const s2b = e.status_to_bucket;
  ok(JSON.stringify(s2b) === JSON.stringify({ proposed: ['01'], approved: ['02'], operating: ['03'], exclude: [] }),
    `${id}: 01 Scheduled→proposed, 02 Under Construction→approved, 03 Completed→operating (publisher decode receipted)`);
  ok(e.extra_where === 'Map_Show = 1', `${id}: scope follows ARDOT's own display curation (Map_Show = 1)`);
  ok(e.column_map.file_date === 'Letting_Date', `${id}: file_date is Letting_Date (real event; PCPM_Let_Date is a forecast, rejected)`);
  ok(e.column_map.title === 'Job_Name' && e.column_map.case_number === 'Job_No', `${id}: title Job_Name, case_number Job_No`);
  ok(Object.keys(e.type_map).length === 20 && Object.values(e.type_map).every((v) => v === 'Utility'),
    `${id}: 20 named PCPM_Type_Work_Desc values → Utility (12 live nulls stay unclassified, never guessed)`);
  ok(e.record_url_precision === 'dataset' && e.dataset_url.includes('/portal/apps/dashboards/'),
    `${id}: dataset-precision record_url is the public ARDOT Job Status dashboard`);
  ok(!('return_centroid' in e), `${id}: return_centroid never set`);
}
{
  const all = ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft']
    .flatMap((p) => REG[p] || [])
    .filter((e) => (e.service_url || '').includes('gis.ardot.gov'));
  ok(all.length === 2, `exactly TWO ARDOT entries exist registry-wide (got ${all.length})`);
}

// ── 2. Drive the SHIPPED connector over the real captures ────────────────────────
const LITTLE_ROCK = { lat: 34.7465, lng: -92.2896 };  // 72201 Little Rock AR
const MEMPHIS = { lat: 35.1495, lng: -90.0490 };      // 38103 Memphis TN
const FIX = (n) => JSON.parse(readFileSync(join(root, `fixtures/ardot/${n}.json`), 'utf8'));

function stubFetch(calls, fixture) {
  let served = false;
  return async (url) => {
    calls.push(String(url));
    const body = served ? { features: [] } : fixture;
    served = true;
    return { ok: true, status: 200, json: async () => body };
  };
}

{
  const calls = [];
  const { sites, reports } = await arcgisForZip(
    '72201', [{ state: 'AR', county: 'Pulaski' }], [POINTS],
    { fetch: stubFetch(calls, FIX('points-sample')), zipCentroid: LITTLE_ROCK },
  );
  ok(sites.length === 3, `points: all 3 fixture features emitted (got ${sites.length})`);
  const buckets = sites.map((s) => s.bucket).sort();
  ok(JSON.stringify(buckets) === JSON.stringify(['operating', 'operating', 'proposed']),
    'points: statuses bucket exactly [operating×2 (03), proposed (01)] — never guessed', JSON.stringify(buckets));
  const scheduled = sites.find((s) => s.bucket === 'proposed');
  ok(scheduled && scheduled.file_date == null,
    'points: the Scheduled (01) row has NULL Letting_Date and emits NO file_date (absence stays absent)');
  ok(sites.filter((s) => s.bucket === 'operating').every((s) => s.file_date),
    'points: the Completed rows carry their real letting dates');
  ok(sites.every((s) => s.use_type === 'Utility' && s.case_number && s.scope === 'point'
      && s.lat > 33 && s.lat < 36.6 && s.lng > -94.7 && s.lng < -89.6),
    'points: Utility, Job_No stamped, pinned from own geometry inside Arkansas');
  ok(sites.every((s) => s.record_url === POINTS.dataset_url && s.record_url_precision === 'dataset'),
    'points: every record carries the dashboard record_url (anti-fabrication gate)');
  ok(reports[0].unmapped_statuses.length === 0 && reports[0].blank_status === 0, 'points: clean status report');
  ok(calls[0].includes('Map_Show') && calls[0].includes('outSR=4326')
      && calls[0].includes('outFields=OBJECTID%2CJob_No') && !calls[0].includes('returnCentroid'),
    'points: Map_Show filter + WGS84 + projected outFields ride in the live query');
}
{
  const calls = [];
  const { sites } = await arcgisForZip(
    '72201', [{ state: 'AR', county: 'Pulaski' }], [LINES],
    { fetch: stubFetch(calls, FIX('lines-sample')), zipCentroid: LITTLE_ROCK },
  );
  ok(sites.length === 3 && sites.every((s) => s.scope === 'point'
      && s.lat > 33 && s.lat < 36.6 && s.lng > -94.7 && s.lng < -89.6),
    'lines: all 3 polylines pinned via featurePoint midpoint inside Arkansas');
  ok(sites.filter((s) => s.bucket === 'proposed').length === 1
      && sites.filter((s) => s.bucket === 'operating').length === 2,
    'lines: buckets are [proposed (01), operating×2 (03)]');
}

// ── 3. The overlap resolution END TO END on real records ─────────────────────────
{
  // Job_No 012289 is a REAL dual-representation job: two point sites in layer 2 and a line
  // in layer 3 (captured live). Run BOTH entries through the shipped connector, then the
  // shipped hook with the registry-built map — exactly the assembly's own order.
  const YIELDS = buildYieldsMap(REG);
  const pOut = await arcgisForZip('72201', [{ state: 'AR', county: 'Pulaski' }], [POINTS],
    { fetch: stubFetch([], FIX('points-overlap-sample')), zipCentroid: LITTLE_ROCK });
  const lOut = await arcgisForZip('72201', [{ state: 'AR', county: 'Pulaski' }], [LINES],
    { fetch: stubFetch([], FIX('lines-overlap-sample')), zipCentroid: LITTLE_ROCK });
  ok(pOut.sites.length === 2 && lOut.sites.length === 2,
    'overlap fixtures: 2 point rows of 012289 + 2 line rows (012274, 012289) emitted pre-hook');
  const resolved = applyYields([...pOut.sites, ...lOut.sites], YIELDS);
  const j289 = resolved.filter((s) => s.case_number === '012289');
  ok(j289.length === 1 && j289[0].source_registry_id === 'ar-ardot-job-status-lines',
    'REQUIRED CASE 1: the dual-representation job survives as exactly ONE record — the Lines one (both point sites dropped)');
  ok(resolved.some((s) => s.case_number === '012274' && s.source_registry_id === 'ar-ardot-job-status-lines'),
    'the lines-only job rides through untouched');
  // REQUIRED CASE 3 with real records: the Lines fetch returned nothing this cycle.
  const outage = applyYields([...pOut.sites], YIELDS);
  ok(outage.length === 2,
    'REQUIRED CASE 3: with NO Lines records in the assembly, both point records of 012289 survive — an outage degrades to dual-source absence, never silent point-job loss');
}

// ── 4. Coverage gate, both directions — Memphis TN is the control ────────────────
for (const e of [POINTS, LINES]) {
  ok(coverageMatches(e.coverage, [{ state: 'AR', county: 'Pulaski' }]), `${e.registry_id}: gate ALLOWS AR`);
  ok(!coverageMatches(e.coverage, [{ state: 'TN', county: 'Shelby' }]), `${e.registry_id}: gate BLOCKS TN/Shelby`);
}
{
  const calls = [];
  const { sites } = await arcgisForZip(
    '38103', [{ state: 'TN', county: 'Shelby' }], [POINTS, LINES],
    { fetch: stubFetch(calls, FIX('points-sample')), zipCentroid: MEMPHIS },
  );
  ok(sites.length === 0 && calls.length === 0,
    'Memphis TN (38103, across the river) emits nothing AND never fetches either layer');
}

console.log(fails ? `\n${fails} ardot-connector assertion(s) FAILED.` : '\nAll ardot-connector assertions passed.');
process.exit(fails ? 1 : 0);

// Offline regression checks for the seven `sd-stip-*` registry entries
// (SDDOT approved-STIP register, dotgis.sd.gov STIP/DOT_STIP_Approved layers 0/1/2/3/4/6/9).
// No network: the SHIPPED connector (sources/arcgis.ts) is driven over REAL captured query
// responses (fixtures/sd-stip/*.json, pg_net requests 11557/11558, outSR=4326).
//
// WHY THIS EXISTS. Statewide entries (coverage [{state:'SD'}]) with Bismarck ND as the
// cross-border control. Three facts pinned here beyond the standard gate:
//   • the LAYER SET is the config — L19 "Local Structure Projects" (48 of its 53 PCNs are
//     a subset of L0 Structures — the Houston-subset class), L5/L20 (tiny), L7/L8/L21
//     (Developmental STIP 2030-2033, a forecast program) are deliberately NOT wired;
//   • region-wide rows carry geometry {x:"NaN",y:"NaN"} (STRINGS) — finite2 must fail them
//     CLOSED to a coordinate-less area record, never a fabricated pin;
//   • no file_date exists anywhere (LettingDate/ReadyDate are forecasts — founder rider).
// Live receipts (per-layer counts, 646-PCN partition proof, edge-probe 3/3):
// jurisdiction-registry `_receipts` + QUEUE.md "DOT RECON BATCH".
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
const IDS = ['sd-stip-structures', 'sd-stip-safety-points', 'sd-stip-construction-reconstruction',
  'sd-stip-resurfacing', 'sd-stip-pavement-preservation', 'sd-stip-safety-lines', 'sd-stip-railroad-crossings'];
const LAYER_OF = { 'sd-stip-structures': 0, 'sd-stip-safety-points': 1, 'sd-stip-construction-reconstruction': 2,
  'sd-stip-resurfacing': 3, 'sd-stip-pavement-preservation': 4, 'sd-stip-safety-lines': 6, 'sd-stip-railroad-crossings': 9 };
const BASE = 'https://dotgis.sd.gov/spearfishformation/rest/services/STIP/DOT_STIP_Approved/MapServer/';

const ENTRIES = IDS.map((id) => REG.arcgis.find((e) => e.registry_id === id));
ok(ENTRIES.every(Boolean), 'jurisdiction-registry carries all seven sd-stip entries');

// ── 1. Common shape across all seven ─────────────────────────────────────────────
for (const e of ENTRIES) {
  if (!e) continue;
  const id = e.registry_id;
  ok(e.service_url === BASE + LAYER_OF[id], `${id}: service_url is DOT_STIP_Approved layer ${LAYER_OF[id]}`);
  ok(e.coverage.length === 1 && e.coverage[0].state === 'SD' && !e.coverage[0].county, `${id}: coverage exactly [{state: SD}]`);
  ok(e.status_const === 'Programmed' && e.status_to_bucket.proposed[0] === 'Programmed'
      && e.status_to_bucket.approved.length === 0 && e.status_to_bucket.operating.length === 0,
    `${id}: STIP shape — Programmed → proposed only`);
  ok(e.use_type_const === 'Utility' && !('type_map' in e),
    `${id}: use_type_const Utility (ImproveDesc is free-text prose — the Douglas-NV class)`);
  ok(!('file_date' in e.column_map) && !('recency_days' in e),
    `${id}: no file_date, no recency — LettingDate/ReadyDate are forecasts (founder rider)`);
  ok(JSON.stringify(e.column_map.title) === JSON.stringify(['LocDesc', 'ImproveDesc']),
    `${id}: title is LocDesc + ImproveDesc (measured 140/140 LocDesc population)`);
  ok(e.record_url_precision === 'dataset' && !('return_centroid' in e) && e.spatial_zip_radius_mi === 3,
    `${id}: dataset precision, no returnCentroid, 3-mi spatial scope`);
}
{
  const all = ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft']
    .flatMap((p) => REG[p] || [])
    .filter((e) => (e.service_url || '').includes('dotgis.sd.gov'));
  ok(all.length === 7, `exactly SEVEN SDDOT entries exist registry-wide (got ${all.length})`);
  // The dropped layers must never be wired without a fresh founder decision: L19 is the
  // Houston-subset class (48/53 PCNs ⊂ L0), L7/L8/L21 are the Developmental 2030-2033
  // forecast program, L5/L20 are below threshold — all logged in _receipts.
  const wiredLayers = all.map((e) => Number(e.service_url.split('/').pop()));
  for (const dropped of [5, 7, 8, 12, 18, 19, 20, 21]) {
    ok(!wiredLayers.includes(dropped), `dropped layer ${dropped} stays un-wired (receipted decision)`);
  }
}

// ── 2. Drive the SHIPPED connector — polyline layer over the real capture ────────
const SIOUX_FALLS = { lat: 43.5446, lng: -96.7311 };  // 57104 Sioux Falls SD
const BISMARCK = { lat: 46.8083, lng: -100.7837 };    // 58501 Bismarck ND
const L2_FIXTURE = JSON.parse(readFileSync(join(root, 'fixtures/sd-stip/construction-reconstruction-sample.json'), 'utf8'));
const L0_FIXTURE = JSON.parse(readFileSync(join(root, 'fixtures/sd-stip/structures-sample.json'), 'utf8'));

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
  const entry = ENTRIES[2]; // construction-reconstruction (polyline)
  const calls = [];
  const { sites, reports } = await arcgisForZip(
    '57104', [{ state: 'SD', county: 'Minnehaha' }], [entry],
    { fetch: stubFetch(calls, L2_FIXTURE), zipCentroid: SIOUX_FALLS },
  );
  ok(sites.length === 3, `L2: all 3 fixture polylines emitted (got ${sites.length})`);
  ok(sites.every((s) => typeof s.lat === 'number' && typeof s.lng === 'number' && s.scope === 'point'),
    'L2: every polyline pinned from its OWN geometry (featurePoint midpoint)');
  ok(sites.every((s) => s.lat > 42.4 && s.lat < 46 && s.lng > -104.1 && s.lng < -96.4),
    'L2: pins land inside South Dakota');
  ok(sites.every((s) => s.bucket === 'proposed' && s.use_type === 'Utility' && s.file_date == null),
    'L2: proposed bucket, Utility, no fabricated file_date');
  ok(sites.some((s) => s.title.includes('US18') && s.title.includes('Grading, Interim Surfacing')),
    'L2: titles join LocDesc + ImproveDesc');
  ok(sites.every((s) => s.record_url === entry.dataset_url && s.case_number),
    'L2: dataset-precision record_url + PCN case_number on every record');
  ok(reports[0].unmapped_statuses.length === 0 && reports[0].blank_status === 0, 'L2: clean status report');
  ok(calls[0].includes('outSR=4326') && calls[0].includes('geometryType=esriGeometryEnvelope')
      && calls[0].includes('outFields=OBJECTID%2CProjectCtrlNbr') && !calls[0].includes('returnCentroid'),
    'L2: envelope + WGS84 + projected outFields, no returnCentroid');
}

// ── 3. The NaN-geometry row fails CLOSED — never a fabricated pin ────────────────
{
  const entry = ENTRIES[0]; // structures (point layer)
  const calls = [];
  const { sites } = await arcgisForZip(
    '57104', [{ state: 'SD', county: 'Minnehaha' }], [entry],
    { fetch: stubFetch(calls, L0_FIXTURE), zipCentroid: SIOUX_FALLS },
  );
  ok(sites.length === 3, `L0: all 3 fixture features emitted, including the region-wide row (got ${sites.length})`);
  const nan = sites.find((s) => (s.title || '').includes('Various Locations Throughout the Rapid City Region'));
  ok(!!nan && nan.lat == null && nan.lng == null && nan.scope === 'area',
    'L0: the {x:"NaN",y:"NaN"} region-wide row emits COORDINATE-LESS (area scope) — finite2 fails it closed');
  const pinned = sites.filter((s) => s !== nan);
  ok(pinned.length === 2 && pinned.every((s) => s.scope === 'point'
      && s.lat > 42.4 && s.lat < 46 && s.lng > -104.1 && s.lng < -96.4),
    'L0: the 2 real-geometry structures pin inside South Dakota');
  ok(sites.every((s) => s.record_url === entry.dataset_url),
    'L0: every record — pinned or area — carries the dataset record_url');
}

// ── 4. Coverage gate, both directions — Bismarck ND is the control ───────────────
for (const e of ENTRIES) {
  if (!e) continue;
  ok(coverageMatches(e.coverage, [{ state: 'SD', county: 'Minnehaha' }]), `${e.registry_id}: gate ALLOWS SD`);
  ok(!coverageMatches(e.coverage, [{ state: 'ND', county: 'Burleigh' }]), `${e.registry_id}: gate BLOCKS ND`);
}
{
  const calls = [];
  const { sites } = await arcgisForZip(
    '58501', [{ state: 'ND', county: 'Burleigh' }], ENTRIES,
    { fetch: stubFetch(calls, L2_FIXTURE), zipCentroid: BISMARCK },
  );
  ok(sites.length === 0 && calls.length === 0,
    'Bismarck ND (58501) emits nothing AND never fetches ANY of the seven layers');
}

console.log(fails ? `\n${fails} sd-stip-connector assertion(s) FAILED.` : '\nAll sd-stip-connector assertions passed.');
process.exit(fails ? 1 : 0);

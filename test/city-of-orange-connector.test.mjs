// Offline regression checks for the `city-of-orange-active-planning-projects` registry entry
// (City of Orange, CA — Active_Planning_Projects_view FeatureServer layer 0).
// No network: the SHIPPED connector (sources/arcgis.ts) is driven over a REAL captured
// response (fixtures/city-of-orange/active-planning-projects-sample.json).
//
// WHY THIS EXISTS. This layer is the THINNEST wired to date — four fields total
// (OBJECTID, PermitType, CreatedDate, GlobalID). There is no status column, no address, no
// case number and no per-record URL, so three things that are normally incidental become
// load-bearing and are pinned here:
//
//   • `status_const` must stay SELF-DESCRIBING. The layer publishes no status at all, so the
//     constant is the only thing a resident sees for lifecycle. An opaque code here would be
//     the San Jose "30" / Berkeley "PP" class.
//   • `CreatedDate` is an esriFieldTypeString, NOT a date type. `recency_days` emits a
//     `DATE '<cutoff>'` literal, so setting it would compare a DATE against a string — the
//     Anaheim standing answer. This entry deliberately carries NO recency window (it is a
//     self-limiting 177-row ACTIVE register, the Frisco precedent), and the test fails if one
//     is ever added as `recency_days`.
//   • the type vocabulary was enumerated to EXHAUSTION. An earlier groupBy body truncated at
//     175 of 177 rows and hid two values (`Tentative Tract Map`, `Zone Change`); an unlisted
//     include_types value is never fetched at all, so the miss would have been silent.
//
// Live receipts (vocabulary sums exactly to 177; 160 typed-and-dated; newest 2026-05-20) are
// in docs/source-registry.md "CA MUNICIPAL-TIER PASS #2 — ORANGE".
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
const ENTRY = REG.arcgis.find((e) => e.registry_id === 'city-of-orange-active-planning-projects');
ok(!!ENTRY, 'jurisdiction-registry carries city-of-orange-active-planning-projects');

// The closed six-value use_type vocabulary (lib/map.js TYPE_EXACT). An off-vocabulary value
// misses the exact table and falls through to keyword guessing.
const USE_TYPES = new Set(['Residential', 'Commercial', 'Industrial', 'Utility', 'Civic/Public', 'Development']);

// ── 1. Entry shape ───────────────────────────────────────────────────────────────
ok(ENTRY.service_url.endsWith('/Active_Planning_Projects_view/FeatureServer/0'),
  "service_url is the city's own Active_Planning_Projects_view layer 0");
ok(ENTRY.coverage.length === 1 && ENTRY.coverage[0].state === 'CA' && ENTRY.coverage[0].county === 'Orange',
  'coverage is exactly [{CA, Orange}]');
ok(ENTRY.spatial_zip_radius_mi === 3,
  'ZIP scoping is spatial at the engine-standard 3 mi (the layer publishes no ZIP column)');
ok(ENTRY.record_url_precision === 'dataset',
  'record_url is dataset-precision — the layer publishes no per-record URL column');
ok(ENTRY.dataset_url.startsWith('https://'), 'dataset_url is absolute https');
ok(!('record_url' in ENTRY.column_map),
  'no record_url column is mapped — templating one from an id would be guessing');
ok(ENTRY.column_map.lat === '__lat' && ENTRY.column_map.lng === '__lng',
  "coordinates come from the feature's OWN point geometry (__lat/__lng). The layer has no "
  + 'lat/lng attribute columns, so omitting this emits records with NO coordinates — which is '
  + 'exactly what this test caught before the first deploy');

// ── 2. The string-date trap — recency must NEVER ride recency_days here ───────────
ok(!('recency_days' in ENTRY),
  'NO recency_days: CreatedDate is esriFieldTypeString and recency_days emits a DATE literal '
  + '(the Anaheim standing answer). A window here would have to be a string compare in extra_where.');
ok(ENTRY.column_map.file_date === 'CreatedDate', 'file_date reads CreatedDate');

// ── 3. Type vocabulary — exhaustively enumerated, every value mapped ──────────────
{
  const inc = ENTRY.include_types;
  ok(inc.length === 8, `include_types carries all 8 non-blank live values (got ${inc.length})`);
  ok(inc.includes('Tentative Tract Map') && inc.includes('Zone Change'),
    'the two values a TRUNCATED groupBy body hid are present — an unlisted include_types value '
    + 'is never fetched, so that miss would have been silent');
  ok(inc.every((t) => t in ENTRY.type_map),
    'every whitelisted value has a type_map line (a whitelisted-but-unmapped value renders unclassified)');
  ok(Object.values(ENTRY.type_map).every((v) => USE_TYPES.has(v)),
    'every mapped use_type is one of the six canonical values',
    JSON.stringify([...new Set(Object.values(ENTRY.type_map))]));
  ok(!inc.includes('') && !inc.some((t) => t.trim() === ''),
    'the 17 blank-PermitType rows are NOT whitelisted — they fail closed (they are also the '
    + 'same 17 rows carrying no CreatedDate)');
}

// ── 4. Status is a self-describing CONSTANT, not an opaque code ───────────────────
{
  const s2b = ENTRY.status_to_bucket;
  ok(ENTRY.status_const === 'Active planning project',
    'status_const is a self-describing phrase, never an opaque code');
  ok(s2b.proposed.length === 1 && s2b.proposed[0] === ENTRY.status_const,
    'the constant is bucketed exactly once, as proposed');
  ok(s2b.approved.length === 0 && s2b.operating.length === 0 && s2b.exclude.length === 0,
    'no other bucket is populated — the layer states no other lifecycle');
  ok(!/^[A-Z0-9]{1,4}$/.test(ENTRY.status_const),
    'the constant is not a short code (the San Jose "30" / Berkeley "PP" class)');
}

// ── 5. Drive the SHIPPED connector over the real captured response ────────────────
const FIXTURE = JSON.parse(readFileSync(join(root, 'fixtures/city-of-orange/active-planning-projects-sample.json'), 'utf8'));
const ORANGE_CENTROID = { lat: 33.7879, lng: -117.8531 };
// The captured response carries `exceededTransferLimit: true` (it is page 1 of a larger set),
// so the stub must serve it ONCE and then an empty page — exactly as the live server does.
// A stub that re-serves the same page forever makes the connector page to its 20,000 cap.
function stubFetch(calls) {
  let served = false;
  return async (url) => {
    calls.push(String(url));
    const body = served ? { ...FIXTURE, exceededTransferLimit: false, features: [] } : FIXTURE;
    served = true;
    return { ok: true, status: 200, json: async () => body };
  };
}

{
  const calls = [];
  const { sites, reports } = await arcgisForZip(
    '92866',
    [{ state: 'CA', county: 'Orange' }],
    [ENTRY],
    { fetch: stubFetch(calls), zipCentroid: ORANGE_CENTROID },
  );
  ok(sites.length === 3, `all 3 fixture features emitted (got ${sites.length})`);
  ok(sites.every((s) => s.record_url === ENTRY.dataset_url && s.record_url_precision === 'dataset'),
    'every record carries the dataset-precision record_url (the anti-fabrication gate)');
  ok(sites.every((s) => typeof s.lat === 'number' && typeof s.lng === 'number' && s.scope === 'point'),
    'every record is pinned from its own geometry');
  ok(sites.every((s) => s.lat > 33.5 && s.lat < 34.1 && s.lng > -118.2 && s.lng < -117.5),
    'pins land in Orange County CA — not Orange City FLORIDA, the owner-name lookalike this '
    + 'source was nearly confused with');
  ok(sites.every((s) => USE_TYPES.has(s.use_type)),
    'no record emits use_type "unclassified"',
    JSON.stringify(sites.map((s) => s.use_type)));
  ok(sites.every((s) => s.source_registry_id === 'city-of-orange-active-planning-projects'),
    'records are stamped with the City of Orange registry id');
  ok(sites.every((s) => s.file_date),
    'every record carries its filing date (the undated rows are excluded at source)');
  ok(sites.every((s) => s.bucket === 'proposed'),
    'every record buckets as proposed via the status constant');
  ok(reports[0].unmapped_statuses.length === 0 && reports[0].blank_status === 0,
    'run report shows no unmapped or blank statuses');
  ok(calls.length > 0 && calls[0].includes('geometryType=esriGeometryEnvelope'),
    'the query scopes by spatial envelope (no ZIP column exists to filter on)');
  ok(calls[0].includes('outSR=4326'),
    'geometry is requested in WGS84 — the layer stores wkid 102646 (CA State Plane), so '
    + 'without this the pins would be unusable projected coordinates');
  ok(!calls[0].includes('returnCentroid'),
    'returnCentroid is NEVER sent — this is a point layer (opt-in per entry, never derived)');
  ok(!/\bDATE\s*'/.test(calls[0]),
    'no DATE literal reaches the wire — CreatedDate is a string column');
}

// ── 6. Coverage gate, both directions ────────────────────────────────────────────
ok(coverageMatches(ENTRY.coverage, [{ state: 'CA', county: 'Orange' }]), 'gate ALLOWS CA/Orange');
ok(!coverageMatches(ENTRY.coverage, [{ state: 'CA', county: 'Los Angeles' }]), 'gate BLOCKS CA/Los Angeles');
ok(!coverageMatches(ENTRY.coverage, [{ state: 'FL', county: 'Volusia' }]),
  'gate BLOCKS FL/Volusia — the county containing Orange City, FLORIDA');
ok(!coverageMatches(ENTRY.coverage, [{ state: 'FL', county: 'Orange' }]),
  'gate BLOCKS FL/Orange — a SAME-NAMED county in another state, which is exactly the trap '
  + 'the GISOrangeCity account presented during recon');
{
  // Not just "emits nothing" — it must never FETCH for an out-of-coverage ZIP.
  const calls = [];
  const { sites } = await arcgisForZip(
    '32763',
    [{ state: 'FL', county: 'Volusia' }],
    [ENTRY],
    { fetch: stubFetch(calls), zipCentroid: { lat: 28.9005, lng: -81.2989 } },
  );
  ok(sites.length === 0 && calls.length === 0,
    'an Orange City FLORIDA ZIP emits nothing AND never fetches the layer');
}

console.log(fails ? `\n${fails} city-of-orange assertion(s) FAILED.` : '\nAll city-of-orange assertions passed.');
process.exit(fails ? 1 : 0);

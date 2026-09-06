// Offline regression checks for the `phoenix-building-permits` registry entry
// (City of Phoenix Planning & Development, Planning_Permit MapServer layer 1).
// No network: the SHIPPED connector (sources/arcgis.ts) is imported and driven over a
// REAL captured query response (fixtures/phoenix/planning-permit-layer1-sample.json).
//
// WHY THIS EXISTS. Phoenix is the widest vocabulary wired so far — 238 verbatim
// PER_TYPE_DESC values over 70,791 rows — and the failure mode that vocabulary invites is
// silent: a value missing from `type_map` does not error, it emits `use_type:"unclassified"`
// and the record renders as a generic circle. These assertions pin the two facts that a
// green run must mean:
//   • every value the live layer publishes is in `type_map`, and every mapped value is one
//     of the canonical use_types (an off-vocabulary value would miss lib/map.js's
//     closed TYPE_EXACT table and fall through to keyword guessing);
//   • the coverage gate holds BOTH ways — Phoenix records ride AZ/Maricopa pages and no
//     other, and a non-Maricopa ZIP never even fetches the layer.
// Live receipts for the vocabularies (status sums to 70,791; type sums to 70,791) are in
// docs/source-registry.md "PHOENIX BUILDING PERMITS".
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
const ENTRY = REG.arcgis.find((e) => e.registry_id === 'phoenix-building-permits');
ok(!!ENTRY, 'jurisdiction-registry carries phoenix-building-permits');

// ── 1. Entry shape — the config the live engine reads ────────────────────────────
ok(ENTRY.service_url === 'https://maps.phoenix.gov/pub/rest/services/Public/Planning_Permit/MapServer/1',
  'service_url is the city\'s own Planning_Permit MapServer layer 1');
ok(ENTRY.coverage.length === 1 && ENTRY.coverage[0].state === 'AZ' && ENTRY.coverage[0].county === 'Maricopa',
  'coverage is exactly [{AZ, Maricopa}]');
ok(ENTRY.spatial_zip_radius_mi === 3,
  'ZIP scoping is spatial (the layer publishes no ZIP column) at the engine-standard 3 mi');
ok(ENTRY.column_map.lat === '__lat' && ENTRY.column_map.lng === '__lng',
  'coordinates come from the feature\'s OWN point geometry (__lat/__lng), never a column default');
ok(ENTRY.record_url_precision === 'dataset',
  'record_url is dataset-precision — Phoenix publishes no per-record permit URL');
ok(ENTRY.dataset_url.startsWith('https://'), 'dataset_url is absolute https');

// ── 2. Status vocabulary — all four live values bucketed, none in two buckets ─────
{
  const s2b = ENTRY.status_to_bucket;
  const all = [...s2b.proposed, ...s2b.approved, ...s2b.operating, ...s2b.exclude];
  ok(all.length === 4 && new Set(all).size === 4, 'all 4 live PERMIT_STAT values bucketed exactly once');
  ok(s2b.proposed.includes('OPEN') && s2b.operating.includes('DONE'), 'OPEN → proposed, DONE → operating');
  ok(s2b.exclude.includes('EXPR') && s2b.exclude.includes('VOID'), 'EXPR + VOID excluded');
}

// ── 3. Type vocabulary — complete, and inside the canonical closed set ───────────
// The closed use_type vocabulary = lib/map.js::TYPE_EXACT. 'other project' is the TERMINAL
// neutral (engine constant NON_QUALIFYING_COMMERCIAL_USE_TYPE): it resolves through
// TYPE_EXACT like the rest, and is the one member that deliberately does NOT continue into
// keyword/name inference — which is precisely the property this assertion exists to protect.
const USE_TYPES = new Set(['Industrial', 'Development', 'Residential', 'Utility', 'Commercial',
  'Civic/Public', 'other project']);
{
  const vals = Object.keys(ENTRY.type_map);
  ok(vals.length === 238, `type_map carries all 238 live PER_TYPE_DESC values (got ${vals.length})`);
  const bad = Object.entries(ENTRY.type_map).filter(([, v]) => !USE_TYPES.has(v));
  ok(bad.length === 0, 'every mapped value is one of the canonical use_types',
    JSON.stringify(bad.slice(0, 5)));
  // The vocabulary carries two upstream quirks that must survive verbatim — a
  // double-space and a mid-word space. Normalising either would silently unclassify them.
  ok(Object.hasOwn(ENTRY.type_map, 'SIGN  PERMIT'), "'SIGN  PERMIT' kept verbatim (double space, 3,685 rows)");
  ok(Object.hasOwn(ENTRY.type_map, 'UTILITY TRENCHING CI VIL PERMIT'),
    "'UTILITY TRENCHING CI VIL PERMIT' kept verbatim (upstream typo, 622 rows)");
}

// ── 4. Drive the SHIPPED connector over a real captured response ─────────────────
const FIXTURE = JSON.parse(readFileSync(join(root, 'fixtures/phoenix/planning-permit-layer1-sample.json'), 'utf8'));
const PHX_CENTROID = { lat: 33.4511, lng: -112.0774 };   // 85003, zipcodes v3.0.0

function stubFetch(calls) {
  let served = false;
  return async (url, init) => {
    calls.push(String(url));
    const body = served ? { features: [] } : FIXTURE;
    served = true;
    return { ok: true, status: 200, json: async () => body };
  };
}

{
  const calls = [];
  const { sites, reports } = await arcgisForZip(
    '85003',
    [{ state: 'AZ', county: 'Maricopa' }],
    [ENTRY],
    { fetch: stubFetch(calls), zipCentroid: PHX_CENTROID },
  );
  ok(sites.length === 3, `all 3 fixture features emitted (got ${sites.length})`);
  ok(sites.every((s) => s.record_url === ENTRY.dataset_url && s.record_url_precision === 'dataset'),
    'every record carries the dataset-precision record_url (anti-fabrication gate)');
  ok(sites.every((s) => typeof s.lat === 'number' && typeof s.lng === 'number' && s.scope === 'point'),
    'every record is pinned from its own geometry');
  ok(sites.every((s) => s.lat > 33 && s.lat < 34 && s.lng > -113 && s.lng < -111),
    'pins land in Phoenix, not another jurisdiction');
  ok(sites.every((s) => USE_TYPES.has(s.use_type)),
    'no record emits use_type "unclassified"',
    JSON.stringify(sites.map((s) => s.use_type)));
  ok(sites.every((s) => s.source_registry_id === 'phoenix-building-permits' && s.jurisdiction === 'City of Phoenix'),
    'records are stamped with the Phoenix registry id + jurisdiction');
  ok(sites.every((s) => s.case_number && s.file_date),
    'every record carries its permit number and filing date');
  ok(reports[0].unmapped_statuses.length === 0 && reports[0].blank_status === 0,
    'run report shows no unmapped or blank statuses');
  // The layer has no ZIP attribute, so scoping MUST ride the spatial envelope params.
  ok(calls.length > 0 && calls[0].includes('geometryType=esriGeometryEnvelope'),
    'the query scopes by spatial envelope (no ZIP column exists to filter on)');
  ok(calls[0].includes('outSR=4326'), 'geometry is requested in WGS84');
  ok(!calls[0].includes('returnCentroid'),
    'returnCentroid is NEVER sent — this is a point layer (a polyline layer hard-rejects it)');
  ok(calls[0].includes('outFields=OBJECTID'),
    'outFields is projected to the mapped columns (dense-metro CPU guard), not "*"');
}

// ── 5. Coverage gate, both directions ────────────────────────────────────────────
ok(coverageMatches(ENTRY.coverage, [{ state: 'AZ', county: 'Maricopa' }]), 'gate ALLOWS AZ/Maricopa');
ok(!coverageMatches(ENTRY.coverage, [{ state: 'AZ', county: 'Pima' }]), 'gate BLOCKS AZ/Pima (Tucson)');
ok(!coverageMatches(ENTRY.coverage, [{ state: 'AZ', county: 'Pinal' }]), 'gate BLOCKS AZ/Pinal');
ok(!coverageMatches(ENTRY.coverage, [{ state: 'TX', county: 'Maricopa' }]), 'gate BLOCKS a same-named county in another state');
{
  // Not just "emits nothing" — it must never FETCH for an out-of-coverage ZIP.
  const calls = [];
  const { sites } = await arcgisForZip(
    '85701',
    [{ state: 'AZ', county: 'Pima' }],
    [ENTRY],
    { fetch: stubFetch(calls), zipCentroid: { lat: 32.2226, lng: -110.9747 } },
  );
  ok(sites.length === 0 && calls.length === 0,
    'a Pima (Tucson) ZIP emits nothing AND never fetches the Phoenix layer');
}

console.log(fails ? `\n${fails} phoenix-connector assertion(s) FAILED.` : '\nAll phoenix-connector assertions passed.');
process.exit(fails ? 1 : 0);

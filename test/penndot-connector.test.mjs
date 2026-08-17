// Offline regression checks for the `penndot-transportation-projects` registry entry
// (PennDOT One Map opendata, transportationprojectspoints/MapServer/0).
// No network: the SHIPPED connector (sources/arcgis.ts) is imported and driven over a
// REAL captured query response (fixtures/penndot/points-sample.json, recon-fetch run
// 32047475605 target pa4-points-full-sample).
//
// WHY THIS EXISTS. This is a STATEWIDE entry (coverage [{state:'PA'}] with no county —
// the udot/txdot shape), and Camden NJ sits directly across the Delaware River from
// Philadelphia — the Council Bluffs analog. The gate must hold BOTH ways: PennDOT
// records ride PA pages and no other, and a Camden NJ ZIP never even FETCHES the layer.
// The sibling Lines layer carries the SAME projects (identical PROJECT_ID heads on the
// identical where clause — recon round 3), so exactly ONE PennDOT entry may ever exist;
// asserted below. Live receipts (vocab sums, populations): jurisdiction-registry
// `_receipts` + QUEUE.md "PENNDOT STATEWIDE RECON".
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
const ENTRY = REG.arcgis.find((e) => e.registry_id === 'penndot-transportation-projects');
ok(!!ENTRY, 'jurisdiction-registry carries penndot-transportation-projects');

// ── 1. Entry shape — the config the live engine reads ────────────────────────────
ok(ENTRY.service_url === 'https://gis.penndot.pa.gov/gis/rest/services/opendata/transportationprojectspoints/MapServer/0',
  'service_url is the POINTS layer on PennDOT\'s own server');
ok(ENTRY.coverage.length === 1 && ENTRY.coverage[0].state === 'PA' && !ENTRY.coverage[0].county,
  'coverage is exactly [{state: PA}] — statewide, no county (the udot/txdot shape)');
ok(ENTRY.spatial_zip_radius_mi === 3,
  'ZIP scoping is spatial at the engine-standard 3 mi (the layer publishes no ZIP column)');
ok(ENTRY.column_map.lat === '__lat' && ENTRY.column_map.lng === '__lng',
  'coordinates come from the feature\'s OWN point geometry, never a column default');
ok(ENTRY.column_map.title === 'PROJECT_SHORT_NARRATIVE',
  'title is PROJECT_SHORT_NARRATIVE (founder rider 1: 99.94% populated + legible, vs the source-truncated 25-char PROJECT_TITLE)');
ok(ENTRY.column_map.file_date === 'PROJECT_CREATION_DATE',
  'file_date is PROJECT_CREATION_DATE (real date type, 100% in scope; LET/NTP are yyyymmdd STRINGS and future-dated = forecasts, rejected)');
ok(ENTRY.record_url_precision === 'dataset',
  'record_url is dataset-precision — no per-record URL column exists in the schema');
ok(!('return_centroid' in ENTRY),
  'return_centroid is NOT set — this is a point layer');
// The Lines layer carries the SAME projects (id-overlap receipt) — a second PennDOT
// entry would double-emit every project across two source_registry_ids, uncatchable
// by exact-identity dedup.
{
  const all = ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft']
    .flatMap((p) => REG[p] || [])
    .filter((e) => (e.jurisdiction || '').includes('Pennsylvania Department of Transportation')
      || (e.service_url || '').includes('gis.penndot'));
  ok(all.length === 1, `exactly ONE PennDOT entry exists in the whole registry (got ${all.length})`);
}

// ── 2. Status buckets — the publisher's own stage labels, fleet-consistent ───────
{
  const s2b = ENTRY.status_to_bucket;
  const all = [...s2b.proposed, ...s2b.approved, ...s2b.operating, ...s2b.exclude];
  ok(all.length === 3 && new Set(all).size === 3,
    'exactly the 3 in-scope PROJECT_STAGE values bucketed, each exactly once');
  ok(s2b.approved.length === 1 && s2b.approved[0] === 'UNDER CONSTRUCTION',
    'UNDER CONSTRUCTION → approved (rider 2: matches udot "Under Construction" and txdot "Construction")');
  ok(s2b.proposed.includes('IN DEVELOPMENT') && s2b.proposed.includes('FUTURE DEVELOPMENT'),
    'IN DEVELOPMENT + FUTURE DEVELOPMENT → proposed');
  ok(/PROJECT_STAGE IN \('IN DEVELOPMENT','UNDER CONSTRUCTION','FUTURE DEVELOPMENT'\)/.test(ENTRY.extra_where),
    'extra_where excludes COMPLETED (112,478) and N/A (58,278 — Candidate/Incomplete wishlist) AT SOURCE');
}

// ── 3. Type vocabulary — complete over the scoped layer, inside the closed set ───
const USE_TYPES = new Set(['Industrial', 'Development', 'Residential', 'Utility', 'Commercial', 'Civic/Public']);
{
  const vals = Object.keys(ENTRY.type_map);
  ok(vals.length === 70, `type_map carries 70 mapped values of the 79 live in-scope IMPROVEMENT_TYPEs (got ${vals.length})`);
  const bad = Object.entries(ENTRY.type_map).filter(([, v]) => !USE_TYPES.has(v));
  ok(bad.length === 0, 'every mapped value is one of the six canonical use_types', JSON.stringify(bad.slice(0, 5)));
  ok(Object.hasOwn(ENTRY.type_map, 'New  Roadway'),
    "'New  Roadway' kept verbatim (upstream double space, 108 rows)");
  // The 9 admin/non-physical values are DELIBERATELY unmapped → unclassified, logged.
  for (const v of ['Miscellaneous', 'Transportation Study', 'Research', 'Administration', 'Planning']) {
    ok(!Object.hasOwn(ENTRY.type_map, v), `'${v}' deliberately unmapped (admin/non-physical — never inferred)`);
  }
}

// ── 4. Drive the SHIPPED connector over the real captured response ───────────────
const FIXTURE = JSON.parse(readFileSync(join(root, 'fixtures/penndot/points-sample.json'), 'utf8'));
const PHL_CENTROID = { lat: 39.9526, lng: -75.1652 };   // 19103 Philadelphia
const CAMDEN_CENTROID = { lat: 39.9368, lng: -75.1066 }; // 08102 Camden NJ

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
    '19103',
    [{ state: 'PA', county: 'Philadelphia' }],
    [ENTRY],
    { fetch: stubFetch(calls), zipCentroid: PHL_CENTROID },
  );
  ok(sites.length === 3, `all 3 fixture features emitted (got ${sites.length})`);
  ok(sites.every((s) => s.record_url === ENTRY.dataset_url && s.record_url_precision === 'dataset'),
    'every record carries the dataset-precision record_url (anti-fabrication gate)');
  ok(sites.every((s) => typeof s.lat === 'number' && typeof s.lng === 'number' && s.scope === 'point'),
    'every record is pinned from its own geometry');
  ok(sites.every((s) => s.lat > 39 && s.lat < 43 && s.lng > -81 && s.lng < -74),
    'pins land inside Pennsylvania, not another jurisdiction');
  // Fixture row 1 is IMPROVEMENT_TYPE 'Miscellaneous' — a value that is PRESENT but
  // deliberately unmapped must emit 'unclassified' (the unmapped-vs-empty distinction),
  // while the two physical classes map to Utility. Pins the deliberate-unmapped design.
  {
    const kinds = sites.map((s) => s.use_type).sort();
    ok(JSON.stringify(kinds) === JSON.stringify(['Utility', 'Utility', 'unclassified']),
      "use_types are exactly [Utility, Utility, unclassified] — 'Miscellaneous' stays unclassified, never inferred",
      JSON.stringify(kinds));
  }
  ok(sites.every((s) => s.source_registry_id === 'penndot-transportation-projects'
      && s.jurisdiction === 'Pennsylvania Department of Transportation'),
    'records are stamped with the PennDOT registry id + jurisdiction');
  ok(sites.every((s) => s.case_number && s.file_date),
    'every record carries its PROJECT_ID and creation date');
  ok(sites.every((s) => s.bucket === 'proposed'),
    'all 3 fixture rows (stage IN DEVELOPMENT) land in the proposed bucket');
  ok(sites.every((s) => s.title && s.title.length > 25),
    'titles are the full narrative sentences, not the 25-char source truncation');
  ok(reports[0].unmapped_statuses.length === 0 && reports[0].blank_status === 0,
    'run report shows no unmapped or blank statuses');
  ok(calls.length > 0 && calls[0].includes('geometryType=esriGeometryEnvelope'),
    'the query scopes by spatial envelope (no ZIP column exists to filter on)');
  ok(calls[0].includes('outSR=4326'), 'geometry is requested in WGS84');
  ok(!calls[0].includes('returnCentroid'), 'returnCentroid is NEVER sent (point layer)');
  ok(calls[0].includes('PROJECT_STAGE+IN') && calls[0].includes('FUTURE+DEVELOPMENT'),
    'extra_where rides in the live query — COMPLETED/N-A rows are never fetched');
  ok(calls[0].includes('outFields=OBJECTID%2CPROJECT_ID'),
    'outFields is projected to the mapped columns (the ~90-column MPMS row is the wide-row CPU-hazard class), not "*"');
}

// ── 5. Coverage gate, both directions — Camden NJ is the Council Bluffs analog ───
ok(coverageMatches(ENTRY.coverage, [{ state: 'PA', county: 'Philadelphia' }]), 'gate ALLOWS PA/Philadelphia');
ok(coverageMatches(ENTRY.coverage, [{ state: 'PA', county: 'Allegheny' }]), 'gate ALLOWS PA/Allegheny (statewide)');
ok(!coverageMatches(ENTRY.coverage, [{ state: 'NJ', county: 'Camden' }]), 'gate BLOCKS NJ/Camden');
ok(!coverageMatches(ENTRY.coverage, [{ state: 'NY', county: 'Kings' }]), 'gate BLOCKS NY');
{
  // Not just "emits nothing" — a Camden NJ ZIP must never FETCH the PennDOT layer.
  const calls = [];
  const { sites } = await arcgisForZip(
    '08102',
    [{ state: 'NJ', county: 'Camden' }],
    [ENTRY],
    { fetch: stubFetch(calls), zipCentroid: CAMDEN_CENTROID },
  );
  ok(sites.length === 0 && calls.length === 0,
    'Camden NJ (08102, across the river from Philadelphia) emits nothing AND never fetches the layer');
}

console.log(fails ? `\n${fails} penndot-connector assertion(s) FAILED.` : '\nAll penndot-connector assertions passed.');
process.exit(fails ? 1 : 0);

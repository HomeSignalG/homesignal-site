// Case-insensitive status_to_bucket + type_map lookup — the DENVER regression.
//
// WHAT BROKE. Both registry lookups were exact-after-trim. Denver's residential permit
// layer reads its status AND its use_type from the same column (`CLASS`), and the live layer
// now publishes that column UPPERCASE ('NEW BUILDING') while the registry map carries the
// mixed-case spelling ('New Building') it was wired from. Exact lookup therefore treated a
// case change as a brand-new value: fail-closed dropped EVERY row, and the page went from
// hundreds of permits to zero with nothing failing — the drop is a silent `continue`.
//
// A case-only difference is the SAME value. This suite pins that the SHIPPED connectors
// (sources/arcgis.ts, driven end to end here) now:
//   • emit records for the CURRENT uppercase live values — the acceptance criterion;
//   • still prefer an EXACT key when one exists;
//   • NOTE a case-only match on the run report (`case_insensitive_matches`) instead of
//     absorbing it silently — suppressing the signal would suppress exactly this drift;
//   • still fail closed on a genuinely unmapped value (the guard is normalization, not
//     leniency);
//   • quarantine — never crash the whole report — when a map has an unresolvable collision.
// The collision census over the live registry lives in test/registry-map-collisions.test.mjs.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const ARCGIS = join(root, 'supabase/functions/get-address-report/sources/arcgis.ts');
const SOCRATA = join(root, 'supabase/functions/get-address-report/sources/socrata.ts');
let arcgisForZip, resolveNormalized, buildBucketLookup, buildTypeLookup, normKey;
try {
  ({ arcgisForZip } = await import(ARCGIS));
  ({ resolveNormalized, buildBucketLookup, buildTypeLookup, normKey } = await import(SOCRATA));
} catch (err) {
  console.log('FAIL — import the shipped connectors (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const DENVER = REG.arcgis.find((e) => e.registry_id === 'denver-residential-construction-permits');
ok(!!DENVER, 'registry carries denver-residential-construction-permits');
// The registry is wired from the mixed-case spelling; that is the whole premise.
ok(DENVER.status_to_bucket.approved.includes('New Building') &&
   !DENVER.status_to_bucket.approved.includes('NEW BUILDING'),
  "registry map holds 'New Building' and NOT the uppercase spelling the layer now returns");
ok(DENVER.column_map.status_raw === 'CLASS' && DENVER.column_map.type_source === 'CLASS',
  'CLASS drives BOTH status and use_type — one case flip breaks both lookups');

// ── helpers: drive the shipped arcgis connector over a synthetic layer response ───
const DENVER_CENTROID = { lat: 39.7392, lng: -104.9903 };   // 80202, zipcodes v3.0.0
const CO_DENVER = [{ state: 'CO', county: 'Denver' }];

function feature(cls, i) {
  return {
    attributes: {
      OBJECTID: i, CLASS: cls, ADDRESS: `${100 + i} SAMPLE ST`,
      DATE_ISSUED: '2026-07-20', PERMIT_NUM: `2026-BLDG-${1000 + i}`,
    },
    geometry: { x: -104.99 + i * 0.001, y: 39.74 + i * 0.001 },
  };
}
function stubFetch(features, calls = []) {
  let served = false;
  return async (url) => {
    calls.push(String(url));
    const body = served ? { features: [] } : { features };
    served = true;
    return { ok: true, status: 200, json: async () => body };
  };
}
async function runDenver(classes) {
  const calls = [];
  const { sites, reports } = await arcgisForZip(
    '80202', CO_DENVER, [DENVER],
    { fetch: stubFetch(classes.map(feature), calls), zipCentroid: DENVER_CENTROID },
  );
  return { sites, report: reports[0], calls };
}

// ── 1. ACCEPTANCE — the current UPPERCASE live values emit records ────────────────
{
  const { sites, report } = await runDenver(['NEW BUILDING', 'ADDITION', 'NEW BUILDING']);
  ok(sites.length === 3,
    `all 3 uppercase-CLASS rows emit (got ${sites.length}) — the Denver acceptance criterion`);
  ok(report.unmapped_statuses.length === 0,
    'none of them lands in unmapped_statuses', JSON.stringify(report.unmapped_statuses));
  ok(sites.every((s) => s.bucket === 'approved'),
    'each is bucketed approved, matching the mixed-case registry key');
  ok(sites.every((s) => s.use_type === 'Residential'),
    'use_type resolves too — type_map has the same case exposure',
    JSON.stringify(sites.map((s) => s.use_type)));
  ok(sites.every((s) => s.record_url && typeof s.lat === 'number' && typeof s.lng === 'number'),
    'records keep a record_url and their own point (anti-fabrication gate unaffected)');

  // The NON-FAILING note — per entry, per value, with the registry key it matched.
  const notes = report.case_insensitive_matches;
  ok(Array.isArray(notes) && notes.length === 4,
    `case_insensitive_matches carries 4 notes (2 status values + 2 type values), got ${notes && notes.length}`,
    JSON.stringify(notes));
  const nb = notes.find((n) => n.field === 'status' && n.value === 'NEW BUILDING');
  ok(!!nb && nb.matched_key === 'New Building' && nb.count === 2,
    "status note: 'NEW BUILDING' → matched key 'New Building', count 2", JSON.stringify(nb));
  const tb = notes.find((n) => n.field === 'type' && n.value === 'NEW BUILDING');
  ok(!!tb && tb.matched_key === 'New Building' && tb.count === 2,
    "type note: 'NEW BUILDING' → matched key 'New Building', count 2", JSON.stringify(tb));
  ok(notes.every((n) => n.count > 0), 'every note carries a record count, not just a flag');
}

// ── 2. The pre-existing exact path is unchanged, and emits NO note ────────────────
{
  const { sites, report } = await runDenver(['New Building', 'Addition']);
  ok(sites.length === 2 && sites.every((s) => s.bucket === 'approved' && s.use_type === 'Residential'),
    'the mixed-case (exact) values still emit exactly as before');
  ok(report.case_insensitive_matches.length === 0,
    'an exact match emits NO case-fold note — the note means drift, so it must stay quiet otherwise',
    JSON.stringify(report.case_insensitive_matches));
}

// ── 3. Still fails closed on a value that is genuinely not in the map ─────────────
{
  const { sites, report } = await runDenver(['NEW BUILDING', 'Demolition Permit']);
  ok(sites.length === 1, 'only the case-variant row emits; the unknown value is still dropped');
  ok(report.unmapped_statuses.length === 1 && report.unmapped_statuses[0].status === 'Demolition Permit',
    "'Demolition Permit' is FLAGGED as unmapped, verbatim — normalization is not leniency",
    JSON.stringify(report.unmapped_statuses));
}

// ── 4. Whitespace: both sides trimmed, as before (and noted only when case differs) ─
{
  const { sites, report } = await runDenver(['  New Building  ', ' NEW BUILDING ']);
  ok(sites.length === 2, 'padded values still resolve (the pre-existing trim, both sides)');
  const notes = report.case_insensitive_matches.filter((n) => n.field === 'status');
  ok(notes.length === 1 && notes[0].value === 'NEW BUILDING',
    'the trimmed exact match is silent; only the case-different one is noted',
    JSON.stringify(notes));
}

// ── 5. An unresolvable collision quarantines ONE entry — it never crashes the page ─
{
  const broken = JSON.parse(JSON.stringify(DENVER));
  broken.status_to_bucket.exclude = ['NEW BUILDING'];     // same normalized key, different bucket
  const calls = [];
  let threw = null;
  let out = null;
  try {
    out = await arcgisForZip('80202', CO_DENVER, [broken],
      { fetch: stubFetch([feature('New Building', 1)], calls), zipCentroid: DENVER_CENTROID });
  } catch (err) { threw = err; }
  ok(threw === null, 'a colliding map does NOT throw out of the connector', threw && threw.message);
  ok(out && out.sites.length === 0, 'the offending entry emits nothing (fail closed)');
  ok(out && out.reports[0].quarantined.some((q) => /registry map collision/.test(q.reason)),
    'the run report quarantines it with an explicit "registry map collision" reason',
    JSON.stringify(out && out.reports[0].quarantined));
  ok(calls.length === 0, 'and it never even fetches — the map is rejected before the query');
}

// ── 6. Unit-level: the shared resolver contract ───────────────────────────────────
{
  const lk = buildBucketLookup({ approved: ['Issued', 'Final  Inspection'], exclude: ['Void'] }, 'unit');
  const a = resolveNormalized(lk, 'Issued');
  ok(a.value === 'approved' && a.caseInsensitive === false, 'exact hit: caseInsensitive false');
  const b = resolveNormalized(lk, 'ISSUED');
  ok(b.value === 'approved' && b.caseInsensitive === true && b.matchedKey === 'Issued',
    'folded hit: caseInsensitive true, matchedKey is the registry spelling');
  const c = resolveNormalized(lk, 'Withdrawn');
  ok(c.value === undefined && c.matchedKey === null, 'miss: undefined value, null matchedKey');
  const d = resolveNormalized(lk, 'final  inspection');
  ok(d.value === 'approved' && d.caseInsensitive === true,
    'an interior double space is preserved by normalization — only case + outer trim change');
  const e = resolveNormalized(lk, 'final inspection');
  ok(e.value === undefined,
    'a SINGLE-space spelling is still a miss — normalization never collapses interior whitespace');
  ok(normKey(' Mixed Case ') === 'mixed case' && normKey(null) === '' && normKey(undefined) === '',
    'normKey trims + lowercases and is null-safe');
  ok(buildTypeLookup(undefined, 'unit') === null, 'buildTypeLookup returns null when no type_map is declared');
}

console.log(fails ? `\n${fails} case-insensitive-map-lookup assertion(s) FAILED.` : '\nAll case-insensitive-map-lookup assertions passed.');
process.exit(fails ? 1 : 0);

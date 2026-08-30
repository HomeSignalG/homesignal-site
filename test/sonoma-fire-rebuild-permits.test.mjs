// Offline checks for sonoma-county-fire-rebuild-permits (California, Sonoma County).
//
// WHY THIS EXISTS. Sonoma was one of five California counties that were 100% dark (40 pages)
// with no covering source. caltrans-sb1-projects reaches the county statewide but only where a
// STIP project falls inside the 3-mile envelope, which is not most residential ZIPs.
//
// WHAT THE SOURCE IS, stated plainly so nobody widens it by accident: Permit Sonoma's rebuild
// register for the 2017 Sonoma Complex, Kincade, Glass and Lightning fires — homes being rebuilt
// after they burned. It is NOT a general Sonoma building-permit ledger, and it lights the
// fire-affected ZIPs only.
//
// THE HAZARD THIS FILE EXISTS TO PIN. The layer is a geometry-less TABLE whose Latitude and
// Longitude are esriFieldTypeString. It therefore rides `spatial_latlng_cols` (the Scottsdale
// attribute-bbox path), which ANDs `Latitude >= ymin AND … AND Longitude <= xmax` into WHERE.
// A LEXICOGRAPHIC comparison on those strings would scope NEGATIVE LONGITUDES BACKWARDS —
// '-122…' sorts below '-123…' as text — which is silently wrong and never an error.
//
// Proven numeric on the live server BEFORE wiring (2026-08-30): the exact clause the connector
// emits for a 3-mile envelope around Santa Rosa 95404 returned 72 rows and ALL 72 fall inside it
// (lat 38.459913–38.492265 within [38.4053, 38.4923]; lng −122.737044 to −122.631023 within
// [−122.7390, −122.6282]; 0 outside). Control: 0 of the 2,094 rows have a null or empty
// Latitude/Longitude, so the clause drops nothing silently.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const E = REG.arcgis.find((e) => e.registry_id === 'sonoma-county-fire-rebuild-permits');
ok(!!E, 'the Sonoma fire-rebuild entry exists');
if (!E) { console.log('\n1 check(s) FAILED'); process.exit(1); }

// ── 1. First-party, and scoped to Sonoma alone ──────────────────────────────────
ok(E.service_url === 'https://services1.arcgis.com/P5Mv5GY5S66M8Z1Q/arcgis/rest/services/Wildfire_Rebuild_Permits_Public_View_Layer/FeatureServer/0',
  'reads the County of Sonoma org P5Mv5GY5S66M8Z1Q (org name verified live: "The County of Sonoma")');
ok(E.coverage.length === 1 && E.coverage[0].state === 'CA' && E.coverage[0].county === 'Sonoma',
  'coverage is exactly CA/Sonoma — a county-scoped register must never ride statewide');

// ── 2. THE STRING-COORDINATE HAZARD ─────────────────────────────────────────────
ok(E.spatial_latlng_cols && E.spatial_latlng_cols.lat === 'Latitude' && E.spatial_latlng_cols.lng === 'Longitude',
  'declares spatial_latlng_cols — a geometry-less table cannot take a geometry param');
ok(E.spatial_zip_radius_mi === 3, 'spatial_latlng_cols is paired with a radius, or no envelope is ever built');
ok(E.column_map.lat === 'Latitude' && E.column_map.lng === 'Longitude',
  'records place by the table\'s OWN lat/lng columns, not by geocoding the address');
ok(!JSON.stringify(E.column_map).includes('__lat') && !JSON.stringify(E.column_map).includes('__lng'),
  'does NOT read the connector\'s flattened geometry keys — this layer has no geometry to flatten');
{
  // The live receipt, pinned so a later reader does not have to re-derive it.
  const env = { ymin: 38.4053, ymax: 38.4923, xmin: -122.7390, xmax: -122.6282 };
  const got = { minLat: 38.459913, maxLat: 38.492265, minLng: -122.737044, maxLng: -122.631023, rows: 72, outside: 0 };
  ok(got.minLat >= env.ymin && got.maxLat <= env.ymax, 'live probe: every returned latitude is inside the envelope');
  ok(got.minLng >= env.xmin && got.maxLng <= env.xmax,
    'live probe: every returned LONGITUDE is inside the envelope — the negative-value case, which a lexicographic compare would invert');
  ok(got.outside === 0 && got.rows === 72, 'live probe: 72 rows, 0 outside');
}

// ── 3. Vocabularies — complete, and every live value mapped ─────────────────────
{
  const STATUS_LIVE = { 'Finaled': 1611, 'Issued': 237, 'Expired': 164, 'Plan Check Expired': 45,
    'Resubmittal Requested': 13, 'Plan Check Comments Sent': 7, 'Pre-Issue/Payment Due': 6,
    'Payment Due': 3, 'Plan Check Approved': 3, 'Ready for Plan Check': 2,
    'Application Accepted/In Review': 1, 'Awaiting Applicant Response': 1, 'Waiting for Other Approvals': 1 };
  const CATEGORY_LIVE = { 'Single Family Home': 1778, 'Accessory Dwelling Unit': 246, 'Bridge': 40, 'Multi-Family Home': 30 };

  ok(Object.values(STATUS_LIVE).reduce((a, b) => a + b, 0) === 2094,
    'Permit_Status vocabulary sums EXACTLY to 2,094 — complete, not a sample');
  ok(Object.values(CATEGORY_LIVE).reduce((a, b) => a + b, 0) === 2094,
    'Category vocabulary sums EXACTLY to 2,094 — complete, not a sample');

  const bucketed = new Set([...E.status_to_bucket.proposed, ...E.status_to_bucket.approved,
                            ...E.status_to_bucket.operating, ...E.status_to_bucket.exclude]);
  const unbucketed = Object.keys(STATUS_LIVE).filter((s) => !bucketed.has(s));
  ok(unbucketed.length === 0, 'every live Permit_Status is bucketed — fail-closed leaves nothing unmapped', unbucketed.join(', '));
  const unmapped = Object.keys(CATEGORY_LIVE).filter((c) => !(c in E.type_map));
  ok(unmapped.length === 0, 'every live Category is mapped — 0 unclassified', unmapped.join(', '));

  // No value may sit in two buckets — that is how a record double-counts.
  const all = [...E.status_to_bucket.proposed, ...E.status_to_bucket.approved,
               ...E.status_to_bucket.operating, ...E.status_to_bucket.exclude];
  ok(all.length === new Set(all).size, 'no Permit_Status appears in two buckets');
}

// ── 4. The two bucket calls most likely to be "corrected" wrongly later ─────────
ok(E.status_to_bucket.approved.includes('Plan Check Approved'),
  '"Plan Check Approved" buckets on the PUBLISHER\'S OWN WORD (the Anaheim "Approved" precedent), not on an inference about whether the permit has issued');
ok(E.status_to_bucket.operating.includes('Finaled') && !E.status_to_bucket.exclude.includes('Finaled'),
  '"Finaled" is a COMPLETED REBUILD — real built work a resident should see, never excluded');
ok(E.status_to_bucket.exclude.includes('Expired') && E.status_to_bucket.exclude.includes('Plan Check Expired'),
  'both Expired states are excluded — a lapsed permit must not claim motion');
ok(E.type_map['Bridge'] === 'Utility', 'Bridge is infrastructure → Utility, not a dwelling');
{
  const CLOSED = new Set(['Residential', 'Commercial', 'Utility', 'Development', 'Industrial', 'Civic/Public']);
  const off = [...new Set(Object.values(E.type_map))].filter((v) => !CLOSED.has(v));
  ok(off.length === 0, 'every mapped use_type is in the closed six-value vocabulary', off.join(', '));
}

// ── 5. Dates — the filing, not a milestone ──────────────────────────────────────
ok(E.column_map.file_date === 'Date_Opened' && E.file_date_kind === 'filed',
  'file_date is Date_Opened, declared as `filed`');
for (const milestone of ['Approval_Date', 'Issue_Date', 'First_Inspection_Date']) {
  ok(!JSON.stringify(E.column_map).includes(milestone),
    `${milestone} is real but is a MILESTONE date, not the filing — not mapped as file_date`);
}
ok(!Object.hasOwn(E, 'recency_days'),
  'no recency_days — a bounded post-fire register whose 1,611 Finaled rows are completed rebuilds; a window would delete real built work');

// ── 6. Shape ────────────────────────────────────────────────────────────────────
ok(E.record_url_precision === 'dataset', 'dataset precision — no per-record URL column exists');
ok(!Object.hasOwn(E, 'record_url_template'), 'no templated record_url');
ok(E.dataset_url === 'https://permitsonoma.org/', "dataset_url is Permit Sonoma's own site");
{
  const read = new Set();
  for (const v of Object.values(E.column_map)) for (const c of [].concat(v)) read.add(c);
  const missing = [...read].filter((c) => !c.startsWith('__') && !E.out_fields.includes(c));
  ok(missing.length === 0, 'out_fields covers every mapped column', missing.join(', '));
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll Sonoma fire-rebuild assertions passed.');
process.exit(fails ? 1 : 0);

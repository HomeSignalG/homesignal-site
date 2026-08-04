// GEOCODE GEOFENCE — driven through EVERY shipped connector, in BOTH directions.
//
// WHY THIS EXISTS. CLAUDE.md §8 lists the fence among "the five rules that never bend", yet
// it was implemented in only TWO of five connectors: arcgis.ts and socrata.ts each carried
// their own copy (socrata's named GEOCODE_FENCE_MI_GEO/milesBetweenGeo, commented "kept in
// lockstep"), while ckan.ts, carto.ts and csv.ts geocoded with NO fence at all.
//
// The live defect that exposed it (2026-08-04, first ckan entry that ever geocoded):
//   allegheny-county-asbestos-permits · ZIP 15202 · "294 UNION AVENUE"
//   cached lat 42.993118 / lng -74.398022, geo_precision "address", scope "point"
//   matched_address "295 UNION AVE EXD, JOHNSTOWN, NY, 12095"
// Wrong state, wrong ZIP, ~300 mi from Pittsburgh — a fabricated marker on a live page.
//
// These checks are DRIVEN, not argued: each connector is imported and executed with a mocked
// fetch + a mocked geocoder, and the emitted record is inspected. A connector that loses the
// fence fails here.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'supabase/functions/get-address-report/sources');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

// The connectors are TypeScript. Node >= 22.18 strips types on import, so these checks run the
// SHIPPED code rather than a copy. On an older runtime fail loudly — a green run must mean the
// assertions actually executed (CLAUDE.md: "an instrument must prove it ran").
let ckanForZip, socrataForZip, arcgisForZip, cartoForZip, csvForZip, _clearCsvCache, fenceGeocode, GEOCODE_FENCE_MI;
try {
  ({ ckanForZip } = await import(join(SRC, 'ckan.ts')));
  ({ socrataForZip } = await import(join(SRC, 'socrata.ts')));
  ({ arcgisForZip } = await import(join(SRC, 'arcgis.ts')));
  ({ cartoForZip } = await import(join(SRC, 'carto.ts')));
  ({ csvForZip, _clearCsvCache } = await import(join(SRC, 'csv.ts')));
  ({ fenceGeocode, GEOCODE_FENCE_MI } = await import(join(SRC, 'geo-fence.ts')));
} catch (err) {
  console.log('FAIL — import connectors (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

// ── the two geocoder outcomes every connector is driven with ───────────────────────────
// FILED ZIP is 15202 (Pittsburgh). The centroid is Pittsburgh's.
const PGH = { lat: 40.5012, lng: -80.0686 };            // 15202 centroid
// The REAL bad match from production: another state, another ZIP, ~300 mi away.
const BAD = { lat: 42.993118, lng: -74.398022, matched_address: '295 UNION AVE EXD, JOHNSTOWN, NY, 12095', match_type: 'range' };
// A correct match: same ZIP, on top of the centroid.
const GOOD = { lat: 40.5019, lng: -80.0671, matched_address: '294 UNION AVE, PITTSBURGH, PA, 15202', match_type: 'exact' };

const geocoder = (hit) => async () => hit;

const COVER_PA = [{ state: 'PA', county: 'Allegheny' }];

// ── 0. the shared helper itself ────────────────────────────────────────────────────────
ok(GEOCODE_FENCE_MI === 25, 'shared fence radius is 25 mi (unchanged from arcgis/socrata)');
ok(fenceGeocode(BAD, '15202', PGH).ok === false, 'helper rejects the real Johnstown NY match');
ok(fenceGeocode(GOOD, '15202', PGH).ok === true, 'helper accepts a correct in-ZIP match');
ok(fenceGeocode(BAD, '15202', null).ok === false,
  'ZIP-mismatch half works with NO centroid (the half that caught the live defect)');
ok(fenceGeocode({ ...GOOD, matched_address: null }, '15202', PGH).ok === true,
  'a geocoder that states no ZIP fails OPEN on the ZIP half (cannot prove it wrong)');
ok(fenceGeocode({ ...BAD, matched_address: null }, '15202', PGH).ok === false,
  '…but the distance half still rejects it — the two halves are independent');

// ── per-connector drivers ──────────────────────────────────────────────────────────────
const jsonFetch = (body) => (async () => new Response(JSON.stringify(body), { status: 200 }));
const textFetch = (body) => (async () => new Response(body, { status: 200 }));

const COMMON = {
  jurisdiction: 'Allegheny County Health Department',
  coverage: COVER_PA,
  type_map: { PAA: 'Development' },
  status_to_bucket: { approved: ['Active - Issued'] },
};
const ROW = { permit_number: 'PAA1', facility_name: '294 UNION AVENUE', status: 'Active - Issued', project_type: 'PAA', permit_issue_date: '2026-06-01', s_address: '294 UNION AVENUE', zip_code: '15202' };
const CM = { title: 'facility_name', status_raw: 'status', type_source: 'project_type', file_date: 'permit_issue_date', address: 's_address', zip: 'zip_code', case_number: 'permit_number' };

async function driveCkan(hit) {
  const entry = { ...COMMON, registry_id: 'fence-ckan', platform: 'ckan', base_url: 'https://data.wprdc.org', resource_id: 'r1', dataset_url: 'https://data.wprdc.org/dataset/x', column_map: CM };
  return ckanForZip('15202', COVER_PA, [entry], { fetch: jsonFetch({ success: true, result: { records: [ROW] } }), geocode: geocoder(hit), zipCentroid: PGH });
}
async function driveSocrata(hit) {
  const entry = { ...COMMON, registry_id: 'fence-socrata', platform: 'socrata', domain: 'data.x.gov', dataset_id: 'aaaa-bbbb', dataset_url: 'https://data.x.gov/d/aaaa-bbbb', column_map: CM };
  return socrataForZip('15202', COVER_PA, [entry], { fetch: jsonFetch([ROW]), geocode: geocoder(hit), zipCentroid: PGH });
}
async function driveArcgis(hit) {
  const entry = { ...COMMON, registry_id: 'fence-arcgis', platform: 'arcgis', service_url: 'https://x.gov/arcgis/rest/services/P/MapServer/0', dataset_url: 'https://x.gov/p', column_map: CM };
  return arcgisForZip('15202', COVER_PA, [entry], { fetch: jsonFetch({ features: [{ attributes: ROW }] }), geocode: geocoder(hit), zipCentroid: PGH });
}
async function driveCarto(hit) {
  const entry = { ...COMMON, registry_id: 'fence-carto', platform: 'carto', sql_url: 'https://phl.carto.com/api/v2/sql', table: 't', dataset_url: 'https://phl.carto.com/api/v2/sql?q=1', column_map: CM, geom_col: 'the_geom' };
  return cartoForZip('15202', COVER_PA, [entry], { fetch: jsonFetch({ rows: [ROW] }), geocode: geocoder(hit), zipCentroid: PGH });
}
async function driveCsv(hit) {
  _clearCsvCache();
  const hdr = Object.keys(ROW).join(',');
  const val = Object.values(ROW).join(',');
  const entry = { ...COMMON, registry_id: 'fence-csv', platform: 'csv', url: 'https://x.gov/a.csv', dataset_url: 'https://x.gov/a', column_map: CM };
  return csvForZip('15202', COVER_PA, [entry], { fetch: textFetch(hdr + '\n' + val + '\n'), geocode: geocoder(hit), zipCentroid: PGH });
}

const DRIVERS = [['ckan', driveCkan], ['socrata', driveSocrata], ['arcgis', driveArcgis], ['carto', driveCarto], ['csv', driveCsv]];

for (const [name, drive] of DRIVERS) {
  // ── direction 1: a WRONG-STATE match is REJECTED ───────────────────────────────────
  let bad;
  try { bad = await drive(BAD); } catch (e) { ok(false, `${name}: drove connector with the bad match`, e.message); continue; }
  const b = bad.sites[0];
  ok(!!b, `${name}: the record is still EMITTED after a fenced geocode (no content loss)`,
    JSON.stringify(bad.reports?.[0] ?? {}).slice(0, 300));
  if (b) {
    ok(b.lat == null && b.lng == null, `${name}: fenced geocode NULLS the coordinates`, `lat=${b.lat} lng=${b.lng}`);
    ok(b.scope === 'area', `${name}: fenced record demoted to area scope`, `scope=${b.scope}`);
    ok(b.geo_precision === 'jurisdiction', `${name}: fenced record is jurisdiction precision`, `geo=${b.geo_precision}`);
    ok(!!b.record_url, `${name}: fenced record keeps its record_url (still listed)`);
  }
  const q = JSON.stringify(bad.reports?.[0]?.quarantined ?? []);
  ok(q.includes('geofence'), `${name}: the rejection is quarantined with a geofence reason`, q.slice(0, 300));

  // ── direction 2: a CORRECT match PASSES ────────────────────────────────────────────
  let good;
  try { good = await drive(GOOD); } catch (e) { ok(false, `${name}: drove connector with the good match`, e.message); continue; }
  const g = good.sites[0];
  ok(!!g, `${name}: a correct match still emits a record`);
  if (g) {
    ok(g.lat === GOOD.lat && g.lng === GOOD.lng, `${name}: a correct match KEEPS its coordinates`, `lat=${g.lat} lng=${g.lng}`);
    ok(g.scope === 'point', `${name}: a correct match stays point scope`, `scope=${g.scope}`);
    ok(g.geo_precision === 'address', `${name}: a correct match stays address precision`, `geo=${g.geo_precision}`);
  }
  const qg = JSON.stringify(good.reports?.[0]?.quarantined ?? []);
  ok(!qg.includes('geofence'), `${name}: a correct match is NOT quarantined`, qg.slice(0, 200));
}

// ── the guard: a SIXTH connector cannot ship without the fence ─────────────────────────
// Same shape as connector-option-surface.test.mjs. Any sources/*.ts that reaches deps.geocode
// MUST route the result through the shared fence. This is what stops the divergence recurring.
const EXEMPT = new Set(['geo-fence.ts', 'geo-input.ts', 'geo-input.test.ts', 'tdlr-tabs.ts', 'tceq-cr.ts']);
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts') && !EXEMPT.has(f));
let geocoders = 0;
for (const f of files) {
  const src = readFileSync(join(SRC, f), 'utf8');
  if (!/deps\.geocode\(/.test(src)) continue;      // connector does not geocode → nothing to fence
  geocoders++;
  ok(/fenceGeocode\(/.test(src), `GUARD: ${f} geocodes and routes through fenceGeocode()`,
    'a connector that geocodes without the shared fence can publish a fabricated marker');
  ok(!/(const|let|var|function)\s+(GEOCODE_FENCE_MI_GEO|milesBetweenGeo)\b/.test(src),
    `GUARD: ${f} DEFINES no private fence copy (a mention in a comment is fine)`);
}
ok(geocoders === 5, `GUARD: all 5 geocoding connectors were actually checked (found ${geocoders})`,
  'if this drops, a connector stopped geocoding or the file list changed — re-read before trusting a green run');

console.log(fails === 0 ? '\nAll geocode-fence assertions passed.' : `\n${fails} geocode-fence assertion(s) FAILED.`);
process.exit(fails === 0 ? 0 : 1);

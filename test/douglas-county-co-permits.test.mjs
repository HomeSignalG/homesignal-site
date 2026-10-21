// Douglas County CO permits (2026-10-21), driven through the SHIPPED connector: no network.
//
// Why: 14 Douglas County ZIP pages had no Map 1 dots. The county publishes every permit it issues in
// unincorporated Douglas County as one geometry-less table, All_Permits_View (286,337 rows, newest
// 2026-10-18), found in its own DCAT catalog (dcdata-dougco.opendata.arcgis.com). Each row carries a
// native ZIP and the publisher's own point as TEXT in LOCATION, "(39.537744, -104.965045)". The new
// opt-in `latlng_text_col` reads that text; a row without it falls back to the address geocode as before.
//
// What a resident sees, measured live 2026-10-21 in the connector's own scope (APPLIED_DATE in the last
// 365 days, PERMIT_JOB_TYPE Building or Demolition; groupBy SCOPE_OF_WORK x CONSTRUCTION_CATEGORY, pg_net
// request 17538): 2,785 permits. New homes ("New Residential", "New Multi-Family") are drawn as
// Residential; alterations, additions and accessory work on existing homes are not (the 2026-09-06
// Residential rule, as for Columbus 2026-10-21).
// Run: node scripts/run-unit-tests.mjs   (or: node test/douglas-county-co-permits.test.mjs)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = join(root, 'supabase/functions/get-address-report');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

global.window = { HS: {} };
global.document = { addEventListener() {}, createElement() { return { style: {} }; }, querySelector() { return null; } };
for (const f of ['lib/project-type.js', 'lib/map.js', 'lib/residential-qualify.js']) {
  (0, eval)(readFileSync(join(root, f), 'utf8'));
}
const HS = global.window.HS;
let arcgisForZip, parseLatLngText;
try { ({ arcgisForZip, parseLatLngText } = await import(join(fn, 'sources/arcgis.ts'))); }
catch (err) { console.log('FAIL — import sources/arcgis.ts (needs Node >= 22.18 type stripping)\n     ' + err.message); process.exit(1); }
const registry = JSON.parse(readFileSync(join(fn, 'jurisdiction-registry.json'), 'utf8'));
const E = registry.arcgis.find((e) => e && e.registry_id === 'douglas-county-co-permits');

// [count, SCOPE_OF_WORK, CONSTRUCTION_CATEGORY], verbatim from the live layer (2026-10-21).
const MEASURED = [
  [7, 'Addition', 'Accessory Use'], [136, 'Alteration', 'Accessory Use'], [664, 'New', 'Accessory Use'],
  [1, 'Addition', 'Commercial'], [128, 'Alteration', 'Commercial'], [95, 'New', 'Commercial'],
  [1, 'Alteration', 'Multi-Family'], [100, 'New', 'Multi-Family'],
  [43, 'Addition', 'Residential'], [1125, 'Alteration', 'Residential'], [447, 'New', 'Residential'],
  [38, '', ''], // Demolition: no scope, no category
];

console.log('\n1) the registry entry');
ok(!!E, 'douglas-county-co-permits exists');
if (!E) { console.log('\n1 check(s) FAILED'); process.exit(1); }
ok(E.coverage.length === 1 && E.coverage[0].state === 'CO' && E.coverage[0].county === 'Douglas', 'coverage is exactly CO/Douglas');
ok(E.extra_where === "PERMIT_JOB_TYPE IN ('Building','Demolition')", 'trade permits (Mechanical, Electrical, Roofing) and driveways are dropped at source');
ok(MEASURED.reduce((s, r) => s + r[0], 0) === 2785, 'the measured scope sums to 2,785');
const combos = MEASURED.filter((r) => r[1]).map((r) => r[1] + ' ' + r[2]);
const unmapped = combos.filter((c) => !E.type_map[c]);
ok(unmapped.length === 0, 'every measured scope + category is mapped', unmapped.join(', '));
for (const cat of ['Residential', 'Multi-Family', 'Accessory Use', 'Commercial', 'Other']) {
  for (const sc of ['New', 'Addition', 'Alteration']) {
    ok(E.type_map[sc + ' ' + cat] === (cat === 'Commercial' ? 'Commercial' : cat === 'Other' ? 'Development' : 'Residential'),
      `"${sc} ${cat}" maps to its class`);
  }
}
ok(E.use_type_const === 'Development', 'a demolition (no scope, no category) is Development');
ok(JSON.stringify(E.status_to_bucket) === JSON.stringify({ approved: ['ISSUED'], operating: ['COMP'] }),
  'the two live statuses: ISSUED is approved, COMP (completed) is operating');
ok(E.latlng_text_col === 'LOCATION' && E.out_fields.includes('LOCATION'), 'LOCATION is fetched and read as the point');
ok(E.column_map.zip === 'ORIGINAL_ZIP' && E.out_fields.includes('ORIGINAL_ZIP'), 'the native ZIP scopes the query');
const read = new Set();
for (const v of Object.values(E.column_map)) for (const c of [].concat(v)) read.add(c);
const missing = [...read].filter((c) => !E.out_fields.includes(c));
ok(missing.length === 0, 'out_fields covers every mapped column', missing.join(', '));
ok(E.commercial_work_evidence?.column === 'SCOPE_OF_WORK', 'Commercial needs work evidence from SCOPE_OF_WORK');

console.log('\n2) parseLatLngText');
ok(JSON.stringify(parseLatLngText('(39.537744, -104.965045)')) === JSON.stringify({ lat: 39.537744, lng: -104.965045 }), 'the county format parses');
ok(JSON.stringify(parseLatLngText('39.5,-104.9')) === JSON.stringify({ lat: 39.5, lng: -104.9 }), 'without brackets too');
for (const bad of ['', '   ', null, undefined, 39.5, '(39.5)', '(39.5, -104.9, 3)', '(abc, def)', '(95, -104)', '(39, -200)', 'POINT(-104.9 39.5)']) {
  ok(parseLatLngText(bad) === null, `rejects ${JSON.stringify(bad)}`);
}

console.log('\n3) the shipped connector over Douglas-shaped rows (a table: no geometry)');
const day = Date.UTC(2026, 8, 1);
const row = (id, job, scope, cat, desc, status, loc) => ({
  attributes: { PERMIT_NUMBER: id, PERMIT_JOB_TYPE: job, SCOPE_OF_WORK: scope, CONSTRUCTION_CATEGORY: cat, DESCRIPTION: desc,
                STATUS_CURRENT: status, APPLIED_DATE: day, ISSUED_DATE: day, ORIGINAL_ADDRESS_1: id + ' MAIN ST',
                ORIGINAL_CITY: 'PARKER', ORIGINAL_STATE: 'CO', ORIGINAL_ZIP: '80134', LOCATION: loc },
});
const FEATURES = [
  row('h1', 'Building', 'New', 'Residential', 'RS - Stock', 'ISSUED', '(39.563988, -104.688075)'),
  row('m1', 'Building', 'New', 'Multi-Family', 'MF - Townhouse', 'ISSUED', '(39.483963, -105.050132)'),
  row('b1', 'Building', 'Alteration', 'Residential', 'RS - Basement', 'COMP', '(39.448622, -104.770377)'),
  row('d1', 'Building', 'New', 'Accessory Use', 'AU - Deck', 'COMP', '(39.549441, -104.96493)'),
  row('c1', 'Building', 'Alteration', 'Commercial', 'CM - Tenant Improvement', 'ISSUED', '(39.534948, -105.01127)'),
  row('x1', 'Demolition', '', '', 'House and Foundation', 'COMP', '(39.40, -104.80)'),
  row('n1', 'Building', 'New', 'Residential', 'RS - Custom', 'ISSUED', ''),
];
let urls = [];
const geocodeCalls = [];
const deps = {
  fetch: async (url) => { urls.push(String(url));
    return { ok: true, status: 200, json: async () => (urls.length === 1 ? { features: FEATURES, exceededTransferLimit: false } : { features: [] }) }; },
  geocode: async (input) => { geocodeCalls.push(input); return null; },
};
const { sites } = await arcgisForZip('80134', [{ state: 'CO', county: 'Douglas' }], [E], deps);
const by = Object.fromEntries(sites.map((s) => [s.case_number, s]));
ok(sites.length === 7, 'all seven rows emitted', 'emitted ' + sites.length);
ok(by.h1?.lat === 39.563988 && by.h1?.lng === -104.688075 && by.h1?.geo_precision === 'point',
  "a row is pinned on the publisher's own LOCATION point", JSON.stringify([by.h1?.lat, by.h1?.lng, by.h1?.geo_precision]));
ok(geocodeCalls.length === 1 && geocodeCalls[0].startsWith('n1 MAIN ST'), 'only the row with a blank LOCATION goes to the geocoder', JSON.stringify(geocodeCalls));
ok(by.n1?.lat == null && by.n1?.scope === 'area', 'a failed geocode leaves it unpinned, never guessed');
ok(by.h1?.use_type === 'Residential' && by.m1?.use_type === 'Residential', 'new homes are typed Residential');
ok(by.x1?.use_type === 'Development', 'a demolition is Development');
ok(by.c1?.use_type === 'Commercial', 'Commercial + Alteration → Commercial (work evidence present)');
ok(by.h1?.bucket === 'approved' && by.b1?.bucket === 'operating', 'ISSUED → approved, COMP → operating');
const q = decodeURIComponent(urls[0] || '').replace(/\+/g, ' ');
ok(/PERMIT_JOB_TYPE IN \('Building','Demolition'\)/.test(q) && /ORIGINAL_ZIP/.test(q), 'the query filters the job type and scopes by the native ZIP', q.slice(0, 300));

console.log('\n4) the Residential rule');
const drawn = (s) => !HS.residentialGateAtConstruction(s, { type_raw: s.type_raw, name: s.title, registry_id: E.registry_id });
ok(drawn(by.h1) && drawn(by.m1), 'new homes and townhouses are drawn', JSON.stringify([by.h1?.type_raw, by.m1?.type_raw]));
ok(!drawn(by.b1), 'a basement finish on an existing home is not drawn');
ok(!drawn(by.d1), 'a deck is not drawn');

console.log('\n5) what Map 1 draws for the measured year');
let visible = 0, newHomes = 0;
for (const [n, scope, cat] of MEASURED) {
  let use = scope ? E.type_map[scope + ' ' + cat] : E.use_type_const;
  if (use === 'Commercial' && !E.commercial_work_evidence.qualifying.includes(scope)) use = 'other project';
  const tr = scope ? scope + ' ' + cat : null;
  const site = { use_type: use, relevance: 'development', title: 'x', label: 'x', bucket: 'approved', lat: 39.5, lng: -104.9 };
  const drop = HS.residentialGateAtConstruction(site, { type_raw: tr, name: 'x', registry_id: E.registry_id });
  if (!drop) visible += n;
  if (!drop && HS.resolveTrackerMarker(site).typeKey === 'residential') newHomes += n;
}
ok(newHomes === 547, '547 new homes (447 single-family + 100 multi-family) are drawn as Residential', String(newHomes));
ok(visible === 809, '809 of 2,785 permits are drawn (Residential 547, Commercial 224, demolitions 38)', String(visible));

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll Douglas County CO assertions passed.');
process.exit(fails ? 1 : 0);

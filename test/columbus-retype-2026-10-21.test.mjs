// Columbus OH permits typed by building class (2026-10-21), driven through the SHIPPED code: no network.
//
// Before: type_source was B1_PER_SUB_TYPE (the WORK: Structural / Demolition ...) and every value
// mapped to "Development", so all Columbus pins read "Other project" (15,445 of 15,445 measured
// 2026-10-20). Now the Type comes from GENERAL_TYPE (the building class) and the 2026-08-03 work
// whitelist moved, unchanged, into extra_where (the Portland pattern, §7.12c).
//
// What a resident sees, measured live 2026-10-21 in the connector's own scope (ISSUED_DT in the last
// 365 days, the five work types; groupBy GENERAL_TYPE x B1_PER_CATEGORY, pg_net request 16596):
// 15,535 permits. The 1,366 new homes (1,2,3 Family / Multi Family - New Structure) are drawn as
// Residential; repair and alteration work on existing homes is not drawn (the 2026-09-06 Residential
// rule, confirmed for Columbus by the founder 2026-10-21). The shared rule learns one phrase,
// ' family new structure '; bare ' new structure ' was measured and refused (it matches free-text
// porch coverings and outbuildings elsewhere).
// Run: node scripts/run-unit-tests.mjs   (or: node test/columbus-retype-2026-10-21.test.mjs)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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
const { arcgisForZip } = await import(join(fn, 'sources/arcgis.ts'));
const registry = JSON.parse(readFileSync(join(fn, 'jurisdiction-registry.json'), 'utf8'));
const E = registry.arcgis.find((e) => e && e.registry_id === 'columbus-building-permits');

// [count, GENERAL_TYPE, B1_PER_CATEGORY], verbatim from the live layer (2026-10-21).
const MEASURED = [
  [8582, '1,2,3 Family - Other', 'Roof, Siding, Windows, Doors'], [1165, '1,2,3 Family - Other', 'Alteration'],
  [1074, '1,2,3 Family - New Structure', 'New Structure'], [1017, 'Commercial - Other', 'Alteration'],
  [931, 'Multi Family - Other', 'Roof, Siding, Windows, Doors'], [580, '1,2,3 Family - Other', 'Perimeter Drainage Tile'],
  [292, 'Multi Family - New Structure', 'New Structure'], [290, '1,2,3 Family - Other', 'Deck, Patio'],
  [271, 'Multi Family - Other', 'Alteration'], [265, 'Commercial - Other', 'Roof'],
  [202, '1,2,3 Family - Other', 'Damage'], [154, '1,2,3 Family - Other', 'Addition'],
  [139, 'Commercial - New Structure', 'New Structure'], [125, 'Multi Family - Other', 'Damage'],
  [73, 'Commercial - Demolition', 'NA'], [66, '1,2,3 Family - Demolition', 'Dwelling'],
  [59, 'Commercial - Other', 'Damage'], [39, 'Multi Family - Other', 'Deck, Patio'],
  [39, '1,2,3 Family - Other', 'Garage-Accessory'], [37, '1,2,3 Family - Other', 'Swimming Pool'],
  [33, 'Commercial - Other', 'Addition'], [29, 'Commercial - Other', 'Windows, Doors'],
  [16, 'Multi Family - Other', 'Swimming Pool'], [12, 'Commercial - Other', 'Foundation'],
  [11, 'Commercial - Other', 'Parking Lot'], [10, 'Commercial - Other', 'Siding'],
  [7, 'Multi Family - Demolition', 'NA'], [4, '1,2,3 Family - Other', 'Fence, Retaining Wall'],
  [4, 'Commercial - Other', 'Fence, Retaining Wall'], [3, 'Multi Family - Other', 'Foundation'],
  [2, 'Multi Family - Other', 'Addition'], [2, 'Multi Family - Other', 'Fence, Retaining Wall'],
  [1, 'Multi Family - Other', 'Parking Lot'], [1, 'Commercial - Other', 'Deck, Patio'],
];

console.log('\n1) the registry entry');
ok(E.column_map.type_source === 'GENERAL_TYPE', 'type_source is GENERAL_TYPE (the building class)');
ok(!E.include_types, 'no include_types (it would filter the building-class column)');
ok(!E.observed_types_unreviewed, 'no type baseline left over from the work column');
ok(E.extra_where === "B1_PER_SUB_TYPE IN ('Structural','New Construction','Major Alteration','Demolition','Addition')",
  'the 2026-08-03 work whitelist is unchanged, now in extra_where');
const generalTypes = [...new Set(MEASURED.map((r) => r[1]))];
const unmapped = generalTypes.filter((g) => !E.type_map[g]);
ok(unmapped.length === 0, 'every measured GENERAL_TYPE value is mapped', unmapped.join(', '));
ok(generalTypes.every((g) => E.type_map[g] === (g.startsWith('Commercial') ? 'Commercial' : 'Residential')),
  'Family classes are Residential, Commercial classes are Commercial');
ok(E.column_map.title.includes('B1_PER_CATEGORY') && E.out_fields.includes('B1_PER_CATEGORY'),
  'the work category is fetched and is part of the title the Residential rule reads');
ok(E.commercial_work_evidence?.column === 'B1_PER_CATEGORY'
   && !E.commercial_work_evidence.qualifying.includes('Roof'), 'Commercial needs work evidence; a reroof is not it');
ok(MEASURED.reduce((s, r) => s + r[0], 0) === 15535, 'the measured scope sums to 15,535');

console.log('\n2) the shipped connector over Columbus-shaped rows');
const day = Date.UTC(2026, 8, 1);
const row = (id, g, c) => ({
  attributes: { GENERAL_TYPE: g, B1_PER_CATEGORY: c, B1_PER_SUB_TYPE: 'Structural', PERMIT_STATUS: 'Permit Issued',
                ISSUED_DT: day, SITE_ADDRESS: id + ' N HIGH ST', B1_SITUS_ZIP: '43215', B1_ALT_ID: id,
                ACA_URL: 'https://portal.columbus.gov/permits/' + id },
  geometry: { x: -83.0, y: 39.96 },
});
const FEATURES = [
  row('h1', '1,2,3 Family - New Structure', 'New Structure'),
  row('m1', 'Multi Family - New Structure', 'New Structure'),
  row('r1', '1,2,3 Family - Other', 'Roof, Siding, Windows, Doors'),
  row('c1', 'Commercial - Other', 'Alteration'),
  row('c2', 'Commercial - Other', 'Roof'),
];
let urls = [];
const deps = {
  fetch: async (url) => { urls.push(String(url));
    return { ok: true, status: 200, json: async () => (urls.length === 1 ? { features: FEATURES, exceededTransferLimit: false } : { features: [] }) }; },
  zipCentroid: { lat: 39.96, lng: -83.0 },
};
const { sites } = await arcgisForZip('43215', [{ state: 'OH', county: 'Franklin' }], [E], deps);
const by = Object.fromEntries(sites.map((s) => [s.case_number, s]));
ok(sites.length === 5, 'all five rows emitted', 'emitted ' + sites.length);
ok(by.h1?.use_type === 'Residential' && by.m1?.use_type === 'Residential' && by.r1?.use_type === 'Residential',
  'home permits are typed Residential');
ok(by.c1?.use_type === 'Commercial', 'Commercial + Alteration → Commercial');
ok(by.c2?.use_type === 'other project', 'Commercial + Roof → Other project, never Commercial');
const q = decodeURIComponent(urls[0] || '').replace(/\+/g, ' ');
ok(/B1_PER_SUB_TYPE IN \(/.test(q) && !/GENERAL_TYPE IN/.test(q), 'the query filters the work column, never the building class');
const project = (s) => ({ type_raw: s.type_raw ?? s.title, name: s.title, registry_id: E.registry_id });
const drawn = (s) => !HS.residentialGateAtConstruction(s, { type_raw: s.type_raw, name: s.title, registry_id: E.registry_id });
ok(drawn(by.h1) && drawn(by.m1), 'new homes are drawn through the Residential gate',
  JSON.stringify([by.h1?.type_raw, by.h1?.title, HS.residentialActivity(project(by.h1))]));
ok(!drawn(by.r1), 'a reroof on an existing home is not drawn');

console.log('\n3) the shared phrase, both directions');
const v = (type_raw, name, registry_id) => HS.residentialActivity({ type_raw, name, registry_id }).verdict;
ok(v('1,2,3 Family - New Structure', '1,2,3 Family - New Structure New Structure', E.registry_id) === 'DEVELOPMENT',
  '"1,2,3 Family - New Structure" qualifies');
ok(v('Multi Family - New Structure', 'Multi Family - New Structure New Structure', E.registry_id) === 'DEVELOPMENT',
  '"Multi Family - New Structure" qualifies');
// Real production strings that contain "new structure" in free text and must NOT qualify (2026-10-21).
ok(v('ADD', 'ADD The scope of work involves constructing a new structure measuring 12 feet by', 'montgomery-county-residential-permits') !== 'DEVELOPMENT',
  'Montgomery MD "constructing a new structure measuring 12 feet" does not qualify');
ok(v('RES', 'ADD Screened Covering -Prep and install necessary footings for new structure', 'memphis-dpd-building-permits') !== 'DEVELOPMENT',
  'Memphis "footings for new structure" does not qualify');
ok(v('1,2,3 Family - Other', '1,2,3 Family - Other Alteration', E.registry_id) === 'ROUTINE', 'an alteration is ROUTINE');
const sql = execFileSync(process.execPath, [join(root, 'scripts/residential-qualify-sql.mjs')], { encoding: 'utf8' });
ok(/\|family new structure\)/.test(sql), 'the generated SQL twin carries the same phrase');

console.log('\n4) what Map 1 draws for the measured year');
let all = 0, visible = 0, newHomes = 0;
for (const [n, g, c] of MEASURED) {
  all += n;
  let use = E.type_map[g];
  if (use === 'Commercial' && !E.commercial_work_evidence.qualifying.includes(c)) use = 'other project';
  const site = { use_type: use, relevance: 'development', title: g + ' ' + c, label: g + ' ' + c, bucket: 'approved', lat: 39.96, lng: -83 };
  const drop = HS.residentialGateAtConstruction(site, { type_raw: g, name: g + ' ' + c, registry_id: E.registry_id });
  if (!drop) visible += n;
  if (!drop && HS.resolveTrackerMarker(site).typeKey === 'residential') newHomes += n;
}
ok(newHomes === 1366, 'all 1,366 new homes are drawn as Residential', String(newHomes));
ok(visible === 3019, '3,019 of 15,535 Columbus permits stay visible (Residential 1,366, Commercial 1,201, Other project 452)', String(visible));

console.log(fails ? `\n${fails} assertion(s) FAILED.` : '\nAll Columbus re-type checks passed.');
process.exit(fails ? 1 : 0);

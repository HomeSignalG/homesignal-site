// Cleveland OH permits typed by building class (2026-10-22), driven through the SHIPPED code: no network.
//
// Before: type_source was PERMIT_SUBTYPE alone. Its plurality value, 'Building Permits' (57% of the
// year), names no class, so 10,787 of 14,301 in-scope permits drew as "Other project". The class sits
// in PERMIT_CATEGORY ('Residential Building', 'Commercial Electrical', ...). The Type key is now
// PERMIT_SUBTYPE + PERMIT_TYPE + PERMIT_CATEGORY, and the subtype whitelist moved into extra_where.
//
// PERMIT_TYPE sits in the middle on purpose. The older labelling files a home permit as subtype
// 'Residential', category 'New', whatever the work ('Residential / New / Alteration' is 451 rows).
// A key reading 'Residential New' or 'New Residential' is, to the shared Residential rule, a new-home
// statement. 'Residential Building Permit New' is not, so the rule decides on the job description.
//
// What a resident sees, measured live 2026-10-22 in the connector's own scope (ISSUE_DATE in the last
// 365 days, the extra_where; 15 pg_net pages, 14,301 rows, 14,301 distinct OBJECTIDs): the 79 new homes
// are drawn as Residential, repair / trade / board-up / fence permits on homes are hidden (the
// 2026-09-06 Residential rule; the founder's 'hide repairs' ruling for Columbus, 2026-10-21).
// Run: node scripts/run-unit-tests.mjs   (or: node test/cleveland-retype-2026-10-22.test.mjs)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

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
const E = registry.arcgis.find((e) => e && e.registry_id === 'cleveland-issued-building-permits');

// [count, PERMIT_SUBTYPE, PERMIT_TYPE, PERMIT_CATEGORY, JOB_DESCRIPTION], from the live layer.
const BP = 'Building Permits', CP = 'Construction Project', R = 'Residential', C = 'Commercial', P = 'Building Permit';
const MEASURED = [
  [1550, BP, CP, 'Residential Electrical', ''], [1427, BP, CP, 'Residential Plumbing', ''],
  [1383, BP, CP, 'Residential HVAC', ''], [1135, BP, CP, 'Residential Building', 'Exterior only remodel'],
  [1085, BP, CP, 'Residential Building', 'Add or change existing construction elements'],
  [870, R, P, 'Board-ups', 'Board-Up'], [716, BP, CP, 'Commercial Electrical', ''],
  [539, BP, CP, 'Commercial HVAC', ''], [471, BP, CP, 'Residential Building', 'Interior/Exterior Remodel'],
  [451, R, P, 'New', 'Alteration'], [371, BP, CP, 'Commercial Plumbing', ''],
  [337, R, P, 'HVAC and Refrigeration', ''], [321, R, P, 'Plumbing', ''],
  [282, BP, CP, 'Residential Building', 'Demolition'], [218, C, P, 'New', 'Alteration'],
  [216, C, P, 'Board-ups', 'Board-Up'], [210, BP, CP, 'Residential Building', 'Residential Fences'],
  [191, BP, CP, 'Residential Building', 'Interior Only Remodel'], [190, BP, CP, 'Residential Building', 'Correct Violations'],
  [179, BP, CP, 'Commercial Building', 'Interior Only Remodel'], [137, 'Install Permits', CP, 'Elevator Dumbwaiter', ''],
  [136, BP, CP, 'Commercial Building', 'Commercial Signs'], [118, R, P, 'Electrical', 'Meter Base Inspection'],
  [114, C, P, 'HVAC and Refrigeration', ''], [104, BP, CP, 'Commercial Building', 'Add or change existing construction elements'],
  [101, BP, CP, 'Residential Building', 'Residential Garage'], [96, R, P, 'Electrical', 'Alterations'],
  [94, BP, CP, 'Commercial Building', 'Exterior only remodel'], [81, C, P, 'Electrical', 'Alterations'],
  [79, R, P, 'New', 'Fence-Garage-Deck-Pool'], [73, C, P, 'Plumbing', ''],
  [67, BP, CP, 'Commercial Building', 'Tent-Stage'], [67, R, P, 'New', 'Correct Violation'],
  [63, C, P, 'New', 'Sign'], [57, BP, CP, 'Commercial Building', 'Interior/Exterior Remodel'],
  [52, BP, CP, 'Commercial Building', 'Demolition'], [49, BP, CP, 'Residential Building', 'New Building'],
  [46, R, P, 'New', 'Demolition'], [37, BP, CP, 'Commercial Building', 'Establish existing use with no work'],
  [35, C, P, 'New', 'Change Use'], [34, BP, CP, 'Commercial Building', 'Change of use with no work'],
  [30, R, P, 'Electrical', 'Service Upgrade'], [30, R, P, 'New', 'New Construction'],
  [28, R, P, 'Electrical', 'Rewiring'], [25, BP, CP, 'Commercial Building', 'Temporary Special Event'],
  [25, C, P, 'New', 'New Construction'], [24, BP, CP, 'Commercial Building', 'Correct Violations'],
  [24, BP, CP, 'Commercial Building', 'New Building'], [22, C, P, 'Electrical', 'Meter Base Inspection'],
  [21, C, P, 'New', 'Establish Use'], [20, BP, CP, 'Residential Building', 'Foundation'],
  [19, BP, CP, 'Residential Building', 'Residential Deck'], [19, C, P, 'New', 'Demolition'],
  [17, BP, CP, 'Commercial Building', 'Commercial Fences'], [15, BP, CP, 'Residential Building', 'Change of use with no work'],
  [14, C, P, 'New', 'Addition'], [14, C, P, 'New', 'Correct Violation'],
  [13, BP, CP, 'Residential Building', 'Establish existing use with no work'], [13, C, P, 'New', 'Fence'],
  [13, R, P, 'New', 'Addition'], [13, R, P, 'New', 'Change Use'],
  [11, BP, CP, 'Residential Building', 'Addition to an existing building'], [10, R, P, 'Electrical', 'New Construction'],
  [9, C, P, 'Electrical', 'Rewiring'], [9, R, P, 'Electrical', 'Correct Violation'],
  [8, BP, CP, 'Commercial Building', 'Addition to an existing building'], [8, BP, CP, 'Commercial Building', 'Site Work Only'],
  [8, C, P, 'Electrical', 'New Construction'], [7, C, P, 'Electrical', 'Service Upgrade'],
  [7, R, P, 'Electrical', 'Repairs to Existing Electrical Fixtures'], [6, R, P, 'Board-ups', ''],
  [5, C, P, 'New', 'Site Development'], [5, C, P, 'New', 'Tent-Stage'],
  [3, C, P, 'Electrical', 'Repairs to Existing Electrical Fixtures'], [3, C, P, 'Electrical', 'Temporary Lighting or Power Installation/MISC.'],
  [3, R, P, 'New', 'Establish Use'], [2, BP, CP, 'Commercial Building', 'Foundation'],
  [2, C, P, 'Electrical', 'Correct Violation'], [2, C, P, 'Electrical', 'Power Wiring and/or HVAC Temp Control Installations'],
  [2, C, P, 'Electrical', 'Signs'], [2, C, P, 'Electrical', 'Temporary Power'],
  [2, 'Install Permits', CP, 'Escalator Moving Walk', ''], [1, BP, CP, 'Commercial Building', 'Residential Garage'],
  [1, C, P, 'New', 'Foundation Only'], [1, C, P, 'New', 'Temporary Use Special Event'],
  [1, 'Fire Permits', CP, 'Fire Suppression Systems', ''], [1, R, P, 'Board-ups', 'Search Warrant Board-Up'],
  [1, R, P, 'New', 'Lot Split'],
];

console.log('\n1) the measured table is the database table');
const lines = MEASURED.map((r) => r.join('|')).sort();      // ASCII only, so code-unit order = collate "C"
ok(MEASURED.length === 88, '88 (subtype, type, category, job) groups', String(MEASURED.length));
ok(MEASURED.reduce((s, r) => s + r[0], 0) === 14301, 'they sum to 14,301 permits');
ok(createHash('md5').update(lines.join('\n')).digest('hex') === '044acbe556c1b98f4916148cd8f90703',
  'md5 equals the one computed in the database (sorted collate "C")');

console.log('\n2) the registry entry');
const keys = [...new Set(MEASURED.map((r) => [r[1], r[2], r[3]].join(' ')))];
ok(JSON.stringify(E.column_map.type_source) === JSON.stringify(['PERMIT_SUBTYPE', 'PERMIT_TYPE', 'PERMIT_CATEGORY']),
  'type_source is subtype + permit type + category');
ok(keys.length === 21 && keys.every((k) => E.type_map[k]) && Object.keys(E.type_map).length === 21,
  'every one of the 21 measured keys is mapped, and nothing else is', keys.filter((k) => !E.type_map[k]).join(', '));
ok(!E.include_types && !E.observed_types_unreviewed, 'no include_types (it cannot filter a joined key)');
ok(/PERMIT_SUBTYPE IN \('Building Permits','Commercial','Install Permits','Residential','Fire Permits'\)/.test(E.extra_where),
  'the subtype whitelist is unchanged, now in extra_where');
// Terminal neutral, not the generic 'Development': a generic Type falls through to the name rules,
// which read "Commercial Electrical" in the title and drew 1,626 trade permits as Commercial.
ok(Object.entries(E.type_map).every(([k, v]) => !/(Electrical|HVAC|Plumbing)/.test(k) || !k.includes('Commercial') || v === 'other project'),
  'commercial trade permits are typed "other project" (terminal), never Commercial or the generic Development');
const residentialRule = (tr) => HS.residentialActivity({ type_raw: tr, name: '', registry_id: E.registry_id }).verdict;
ok(keys.every((k) => residentialRule(k) !== 'DEVELOPMENT'),
  'no type key reads as a new-home statement by itself', keys.filter((k) => residentialRule(k) === 'DEVELOPMENT').join(', '));
ok(residentialRule('Residential New') === 'DEVELOPMENT', '(control: "Residential New" alone would read as one)');

console.log('\n3) the shipped connector over all 88 measured shapes');
const FEATURES = MEASURED.map((r, i) => ({
  attributes: { PERMIT_SUBTYPE: r[1], PERMIT_TYPE: r[2], PERMIT_CATEGORY: r[3] || null, JOB_DESCRIPTION: r[4] || null,
                ISSUE_DATE: Date.UTC(2026, 8, 1), PRIMARY_ADDRESS: (1000 + i) + ' EUCLID AVE', PERMIT_ID: 'B26-' + i,
                LAT: 41.5, LON: -81.68, ACCELA_CITIZEN_ACCESS_URL: 'https://aca-prod.accela.com/CLEVELAND/' + i },
  geometry: { x: -81.68, y: 41.5 },
}));
let urls = [];
const deps = {
  fetch: async (url) => { urls.push(String(url));
    return { ok: true, status: 200, json: async () => (urls.length === 1 ? { features: FEATURES, exceededTransferLimit: false } : { features: [] }) }; },
  zipCentroid: { lat: 41.5, lng: -81.68 },
};
const { sites } = await arcgisForZip('44115', [{ state: 'OH', county: 'Cuyahoga' }], [E], deps);
ok(sites.length === 88, 'all 88 shapes emitted', 'emitted ' + sites.length);
const q = decodeURIComponent(urls[0] || '').replace(/\+/g, ' ');
ok(/PERMIT_SUBTYPE IN \(/.test(q) && !/PERMIT_CATEGORY IN/.test(q), 'the query filters the subtype, never the joined key');
const byId = Object.fromEntries(sites.map((s) => [s.case_number, s]));
ok(sites.every((s) => s.use_type !== 'unclassified'), 'nothing comes back unclassified');

console.log('\n4) what Map 1 draws for the measured year');
const tally = { Residential: 0, Commercial: 0, 'Other project': 0, hidden: 0 };
const newHomes = [];
MEASURED.forEach((r, i) => {
  const s = byId['B26-' + i];
  if (!s) return;
  const drop = HS.residentialGateAtConstruction(s, { type_raw: s.type_raw, name: s.title, registry_id: E.registry_id });
  if (drop) { tally.hidden += r[0]; return; }
  const k = HS.resolveTrackerMarker(s).typeKey;
  const label = k === 'residential' ? 'Residential' : k === 'commercial' ? 'Commercial' : 'Other project';
  tally[label] += r[0];
  if (label === 'Residential') newHomes.push(r[3] + ' / ' + r[4]);
});
ok(tally.Residential === 79, '79 new homes are drawn as Residential (49 New Building + 30 New Construction)',
  String(tally.Residential) + ' ' + newHomes.join('; '));
ok(JSON.stringify(newHomes.sort()) === JSON.stringify(['New / New Construction', 'Residential Building / New Building']),
  'and nothing else is: no alteration, violation or trade permit counts as a home', newHomes.join('; '));
ok(tally.Commercial === 739, '739 Commercial', String(tally.Commercial));
ok(tally['Other project'] === 2874, '2,874 Other project', String(tally['Other project']));
ok(tally.hidden === 10609, '10,609 repair, trade, board-up and fence permits on homes hidden', String(tally.hidden));
ok(tally.Residential + tally.Commercial + tally['Other project'] + tally.hidden === 14301, 'the four sum to 14,301');

console.log(fails ? `\n${fails} assertion(s) FAILED.` : '\nAll Cleveland re-type checks passed.');
process.exit(fails ? 1 : 0);

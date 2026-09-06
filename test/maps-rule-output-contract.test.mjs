#!/usr/bin/env node
// Validates the ACTUAL OUTPUT of the classification rules against CATEGORY_REGISTRY.
//
// WHY THIS EXISTS: test/maps-category-contract.test.mjs asserts symbol uniqueness over the
// REGISTRY DEFINITIONS and passed 172/172 while production shipped a real defect — the
// data-center rule in both KEYWORD_RULES and NAME_RULES hardcoded `shape: 'square'`, which
// is the symbol `facility` owns. So a data-center project rendered identically to a
// Regulated facility, and the legend (which is GENERATED from the registry) said octagon
// while the map drew a square. The registry was self-consistent; the rules had drifted
// away from it, and nothing compared the two.
//
// This suite closes that gap by driving the real classifier and asserting, for every
// produced marker:
//   1. typeKey is a real CATEGORY_REGISTRY key,
//   2. shape === registry symbol for that key,
//   3. legendLabel === registry label for that key,
//   4. no two distinct categories render the same symbol (uniqueness on OUTPUT),
//   5. the legend rows the page renders cover exactly what the rules can emit.
//
// It is deliberately OUTPUT-based, not source-text-based: some rule literals are corrected
// downstream, and a source-text scan would report false drift for those. What ships is what
// the classifier returns, so that is what is asserted.
//
// ANTI-FABRICATION: this suite never asserts that a record MUST be classified. A record
// whose source states no type and whose name yields no keyword is expected to resolve to
// `other` / "Other project" — that is the honest outcome, and the corpus below includes
// such inputs precisely to lock that in.
//
// Run: node test/maps-rule-output-contract.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

global.window = {};
window.HS = {};
await import(join(root, 'lib/map.js'));
const HS = window.HS;
const REG = HS.CATEGORY_REGISTRY;

// Inputs chosen to exercise every rule phase: exact source type, layer fallback, keyword
// phase, and the name-enrichment phase over a generic source type.
const CORPUS = [
  // [label, record, expected category key]
  ['exact type: data center',      { name: 'X', type: 'data center' },                     'datacenter'],
  ['keyword: hyperscale campus',   { name: 'Hyperscale campus', type: 'Development' },     'datacenter'],
  ['keyword: server farm',         { name: 'Server farm build', type: 'unclassified' },    'datacenter'],
  ['exact type: industrial',       { name: 'X', type: 'industrial' },                      'industrial'],
  ['keyword: warehouse',           { name: 'Granite Warehouse', type: 'unclassified' },    'industrial'],
  ['exact type: residential',      { name: 'X', type: 'residential' },                     'residential'],
  ['keyword: subdivision',         { name: 'Stoney Ridge subdivision', type: 'Development' }, 'residential'],
  ['exact type: commercial',       { name: 'X', type: 'commercial' },                      'commercial'],
  ['keyword: hotel',               { name: 'Airport Hotel Center', type: 'unclassified' }, 'commercial'],
  ['exact type: infrastructure',   { name: 'X', type: 'infrastructure' },                  'infrastructure'],
  ['keyword: wastewater plant',    { name: 'Wastewater treatment plant', type: 'Development' }, 'infrastructure'],
  ['exact type: civic/public',     { name: 'X', type: 'civic/public' },                    'civic'],
  ['keyword: school',              { name: 'Del Valle High School', type: 'unclassified' }, 'civic'],
  // Honest-absence cases — MUST stay 'other'. Forcing these into a category would be
  // exactly the fabrication the prime directive forbids.
  ['unclassified, opaque name',    { name: 'AU01469E (BERRY)', type: 'unclassified' },     'other'],
  ['unclassified, no name signal', { name: 'Caldwell Lane', type: 'unclassified' },        'other'],
  ['source type Development only', { name: 'COTA Land', type: 'Development' },             'other'],
];

console.log('\n-- every rule output agrees with CATEGORY_REGISTRY --');

const emitted = new Map();   // typeKey -> shape actually rendered
for (const [label, rec, expectKey] of CORPUS) {
  const r = HS.classifyProjectType({ ...rec, title: rec.name, use_type: rec.type }) || {};
  const reg = REG[r.typeKey];
  check(`${label}: typeKey is a real registry key`, !!reg, String(r.typeKey));
  if (!reg) continue;
  check(`${label}: shape matches registry symbol (${reg.symbol})`,
    r.shape === reg.symbol, `rule=${r.shape} registry=${reg.symbol}`);
  check(`${label}: legendLabel matches registry label`,
    r.legendLabel === reg.label, `rule="${r.legendLabel}" registry="${reg.label}"`);
  check(`${label}: classifies as ${expectKey}`, r.typeKey === expectKey, String(r.typeKey));
  emitted.set(r.typeKey, r.shape);
}

console.log('\n-- symbol uniqueness holds on OUTPUT, not just definitions --');
{
  const shapes = [...emitted.values()];
  const dupes = shapes.filter((s, i) => shapes.indexOf(s) !== i);
  check('no two emitted categories share a symbol', dupes.length === 0,
    `duplicate symbols: ${[...new Set(dupes)].join(', ')}`);

  // The specific regression: a data-center project must never render the facility symbol.
  const dc = HS.classifyProjectType({ name: 'Hyperscale data center', title: '', type: 'Development', use_type: 'Development' });
  check('data center renders the registry octagon', dc.shape === REG.datacenter.symbol
    && dc.shape === 'octagon', `got ${dc.shape}`);
  check('data center is DISTINCT from the Regulated-facility square',
    dc.shape !== REG.facility.symbol, `dc=${dc.shape} facility=${REG.facility.symbol}`);
  check('Regulated facility still owns the square', REG.facility.symbol === 'square');
}

console.log('\n-- the rendered legend covers exactly what the rules can emit --');
{
  const rows = (HS.markerRegistry && HS.markerRegistry.shapeLegend) || [];
  const legendShapes = new Set(rows.map((r) => r.shape));
  const legendLabels = new Set(rows.map((r) => r.label));
  check('legend is non-empty', rows.length > 0);
  for (const [key, shape] of emitted) {
    if (REG[key].isFacility) continue;             // facility has its own status-legend row
    check(`legend carries the ${key} symbol (${shape})`, legendShapes.has(shape));
    check(`legend carries the ${key} label`, legendLabels.has(REG[key].label));
  }
  // No legend row may advertise a symbol the registry does not define.
  const regSymbols = new Set(Object.values(REG).map((c) => c.symbol));
  check('no legend row shows a symbol absent from the registry',
    [...legendShapes].every((s) => regSymbols.has(s)),
    [...legendShapes].filter((s) => !regSymbols.has(s)).join(', '));
}

console.log('\n-- anti-fabrication: unclassifiable records stay unclassified --');
{
  const honest = CORPUS.filter(([, , k]) => k === 'other');
  for (const [label, rec] of honest) {
    const r = HS.classifyProjectType({ ...rec, title: rec.name, use_type: rec.type }) || {};
    check(`${label}: renders the honest "Other project" symbol`,
      r.typeKey === 'other' && r.shape === REG.other.symbol && r.legendLabel === 'Other project',
      `${r.typeKey}/${r.shape}`);
  }
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll maps-rule-output-contract checks passed.');

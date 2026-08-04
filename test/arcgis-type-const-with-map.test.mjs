// Drives the SHIPPED arcgis connector to pin the unmapped-vs-empty distinction — no network.
//
// THE RULING (founder, 2026-08-03). `use_type_const` and `type_map` may now be set TOGETHER,
// because they answer different questions:
//   • type_map      — the publisher STATED a value; we classify it. Not in the map ⇒ WE chose not
//                     to classify it ⇒ `unclassified`.
//   • use_type_const — the publisher stated NOTHING. Honest absence, not a mapping gap. The permit
//                     is still real (located, dated, filed), so it renders under the generic
//                     member rather than as a missing classification.
// Collapsing those two would undo the ruling, so the constant fills ONLY on an EMPTY value.
//
// WHY THE CODE NEEDED CHANGING AT ALL: the connector previously QUARANTINED any entry setting both,
// and could never have matched an empty-string type_map key regardless —
//   const typeHit = typeLookup && typeSrcVal ? resolveNormalized(...) : null;
// `typeSrcVal` is "" for a blank column and "" is FALSY, so the lookup was never attempted. The
// guard was relaxed to restore the behaviour the code's own comment already described.
//
// The case: adams-county-building-permits, 21,506 rows with a blank `BuildingUse`.
// Run: node scripts/run-unit-tests.mjs   (or: node test/arcgis-type-const-with-map.test.mjs)
//
// GENERIC — the NON-TERMINAL members of the closed use_type set (lib/map.js::TYPE_EXACT maps
// both to cat('other')). A constant stands in for a value the publisher never gave, so it must
// stay refinable by the downstream keyword rules; a terminal category there would be a guess
// that fixes the pin SHAPE on no evidence.
const GENERIC = ['Development', 'unclassified'];
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const SRC = join(root, 'supabase/functions/get-address-report/sources/arcgis.ts');
let arcgisForZip;
try { ({ arcgisForZip } = await import(SRC)); }
catch (err) { console.log('FAIL — import sources/arcgis.ts (needs Node >= 22.18 type stripping)\n     ' + err.message); process.exit(1); }
ok(typeof arcgisForZip === 'function', 'sources/arcgis.ts exports arcgisForZip — the shipped code is under test');

const COMMUNITIES = [{ state: 'CO', county: 'Adams' }];
const FEATURES = [
  { attributes: { T: 'Residential', ADDR: '1 A ST', ID: 'r1', ST: 'Permit Issued', D: '2026-01-02' }, geometry: { x: -104.9, y: 39.8 } },
  { attributes: { T: '',            ADDR: '2 B ST', ID: 'e1', ST: 'Permit Issued', D: '2026-01-02' }, geometry: { x: -104.9, y: 39.8 } },
  { attributes: { T: '   ',         ADDR: '3 C ST', ID: 'e2', ST: 'Permit Issued', D: '2026-01-02' }, geometry: { x: -104.9, y: 39.8 } },
  { attributes: { T: 'Warehouse',   ADDR: '4 D ST', ID: 'u1', ST: 'Permit Issued', D: '2026-01-02' }, geometry: { x: -104.9, y: 39.8 } },
];
const baseEntry = {
  registry_id: 'fixture', platform: 'arcgis',
  service_url: 'https://example.test/arcgis/rest/services/X/FeatureServer/0',
  dataset_url: 'https://example.test/record',
  coverage: [{ state: 'CO', county: 'Adams' }],
  column_map: { title: 'ADDR', address: 'ADDR', case_number: 'ID', status_raw: 'ST', type_source: 'T', file_date: 'D', zip: 'Z', lat: '__lat', lng: '__lng' },
  zip_where_template: "1=1",
  status_to_bucket: { approved: ['Permit Issued'], proposed: [], operating: [], exclude: [] },
};
let page = 0;
const deps = {
  fetch: async () => {
    const body = page++ === 0 ? { features: FEATURES, exceededTransferLimit: false } : { features: [] };
    return { ok: true, status: 200, json: async () => body };
  },
};
const run = async (entry) => {
  page = 0;
  const { sites, reports } = await arcgisForZip('80229', COMMUNITIES, [{ ...baseEntry, ...entry }], deps);
  return { byCase: Object.fromEntries(sites.map((s) => [s.case_number, s.use_type])), report: reports[0] };
};

console.log('\n1) BOTH SET — the ruling. Mapped wins; EMPTY takes the constant; PRESENT-BUT-UNMAPPED does not.');
{
  const { byCase, report } = await run({ type_map: { Residential: 'Residential' }, use_type_const: 'Development' });
  ok(report.quarantined.length === 0, 'both set is no longer a config error — the entry is NOT quarantined',
    JSON.stringify(report.quarantined));
  ok(report.emitted === 4, 'all four rows emitted', `emitted=${report.emitted}`);
  ok(byCase.r1 === 'Residential', 'a MAPPED value still wins over the constant');
  ok(byCase.e1 === 'Development', 'an EMPTY value takes the constant (publisher stated nothing)');
  ok(byCase.e2 === 'Development', 'a WHITESPACE-ONLY value is empty too (the connector trims)');
  ok(byCase.u1 === 'unclassified',
    'a PRESENT-BUT-UNMAPPED value falls through to unclassified — the distinction survives',
    `got ${byCase.u1}`);
}

console.log('\n2) ONLY use_type_const — 9 live entries. Behaviour must be byte-for-byte unchanged.');
{
  const { byCase } = await run({ use_type_const: 'Development' });
  ok(byCase.r1 === 'Development' && byCase.e1 === 'Development' && byCase.u1 === 'Development',
    'with NO type_map the constant applies to every row, present or empty, exactly as before',
    JSON.stringify(byCase));
}

console.log('\n3) ONLY type_map — 130 live entries. Behaviour must be byte-for-byte unchanged.');
{
  const { byCase } = await run({ type_map: { Residential: 'Residential' } });
  ok(byCase.r1 === 'Residential', 'mapped value maps');
  ok(byCase.e1 === 'unclassified' && byCase.u1 === 'unclassified',
    'with no constant, BOTH empty and unmapped remain unclassified — unchanged',
    JSON.stringify(byCase));
}

console.log('\n4) the registry itself — every entry that sets both is deliberate and receipted');
{
  const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
  const ent = [];
  (function walk(o) {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') { if (o.registry_id) ent.push(o); Object.values(o).forEach(walk); }
  })(reg);
  const both = ent.filter((e) => e.use_type_const && e.type_map);
  // Deliberately NOT a count. The pairing was ruled legitimate (founder, 2026-08-03: an empty
  // publisher field is honest absence, kept under a generic label), so pinning the number would
  // fail on the next honest use of it — as it did on centre-county-pa-building-permits the very
  // next day. What must hold is the PROPERTY, on every entry that pairs them.
  ok(both.length >= 1, 'at least one entry exercises the pairing', String(both.length));
  for (const e of both) {
    // A constant is for honest absence. An entry with a type_map but no BLANK values in the source
    // gains nothing from one — so a pairing must be a deliberate, receipted decision.
    ok(/empt|blank|stated nothing/i.test(e._receipts || ''),
      `${e.registry_id}: the pairing is explained in the entry's own receipts`);
    ok(GENERIC.includes(e.use_type_const),
      `${e.registry_id}: the constant is a GENERIC bucket (${GENERIC.join('/')}), never a terminal guess`,
      String(e.use_type_const));
  }
}

console.log(fails ? `\n${fails} check(s) FAILED` : `\nAll checks passed.`);
process.exit(fails ? 1 : 0);

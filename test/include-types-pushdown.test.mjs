// Offline tests for the 2026-08-03 CONNECTOR-PARITY fixes — no network.
//
// THREE MECHANISMS, one root cause: an option that means different things (or nothing) in
// different connectors is a silent-wrong-output generator.
//
//   1. include_types in arcgis + socrata. It was csv-ONLY and SILENTLY IGNORED elsewhere, while
//      seven entries carried it — each mirroring its own type_map, so each plainly meant it as a
//      drop-filter. Because an unmapped TYPE does not fail closed the way an unmapped STATUS does
//      (`typeHit?.value || use_type_const || "unclassified"`), those rows published anyway:
//      measured live, columbus 40,469/42,067 (96.2%), cincinnati 7,856/10,842 (72.5%),
//      nashville 3,561/9,025, portland 177/2,329 — ~52,000 records beyond intent.
//   2. recency_expr in arcgis. socrata gained it after the nyc-dob defect; arcgis had NO fallback,
//      so a STRING date column could only be windowed with a hardcoded year (worcester's
//      `LIKE '%/2025'`), which goes blind every January.
//   3. recency_expr in ckan. Its default clause is a STRING comparison — the nyc lexicographic
//      trap, unfired. Closed before it costs anything rather than after.
//
// The filter is pushed down INTO THE QUERY, not applied post-fetch, so a max_rows cap can never
// bind on rows the whitelist would have removed. And a whitelist that CANNOT be expressed (array
// type_source) fails CLOSED — publishing everything there would recreate the original defect in
// new code.
// Run: node scripts/run-unit-tests.mjs   (or: node test/include-types-pushdown.test.mjs)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? '\n     ' + detail : ''}`); }
};
const SRC = new URL('../supabase/functions/get-address-report/sources/', import.meta.url);
const read = (f) => readFileSync(new URL(f, SRC), 'utf8');

const arcgis = read('arcgis.ts');
const socrata = read('socrata.ts');
const ckan = read('ckan.ts');
const csv = read('csv.ts');

console.log('1) include_types is now implemented in arcgis AND socrata (parity with csv)');
ok('arcgis declares include_types', /\n  include_types\?: string\[\];/.test(arcgis));
ok('socrata declares include_types', /\n  include_types\?: string\[\];/.test(socrata));
ok('arcgis has an includeTypesClause builder', /export function includeTypesClause\(entry: ArcgisRegistryEntry\)/.test(arcgis));
ok('socrata has an includeTypesClause builder', /export function includeTypesClause\(entry: SocrataRegistryEntry\)/.test(socrata));
ok('csv still implements it at parse time (unchanged)', /entry\.include_types \? new Set/.test(csv));

console.log('\n2) it is PUSHED DOWN into the query, not filtered after the fetch');
{
  // Post-fetch filtering would let a max_rows cap bind on rows the whitelist removes — silently
  // costing whitelisted records, which is a subtler version of the bug being fixed.
  ok('arcgis buildWhere pushes the type clause', /const typeClause = includeTypesClause\(entry\);\n  if \(typeClause\) clauses\.push\(typeClause\);/.test(arcgis));
  ok('socrata buildWhere pushes the type clause', /const typeClause = includeTypesClause\(entry\);\n  if \(typeClause\) clauses\.push\(typeClause\);/.test(socrata));
}

console.log('\n3) FAIL-CLOSED — a whitelist that cannot be expressed skips the entry, never publishes all');
{
  for (const [name, src] of [['arcgis', arcgis], ['socrata', socrata]]) {
    ok(`${name} quarantines include_types with a non-single type_source`,
      /include_types\?\.length && !soleTypeCol\(entry\)/.test(src) && /cannot filter, entry skipped/.test(src));
  }
  ok('both expose soleTypeCol so the array case is explicit',
    /export function soleTypeCol\(entry: ArcgisRegistryEntry\)/.test(arcgis)
    && /export function soleTypeCol\(entry: SocrataRegistryEntry\)/.test(socrata));
}

console.log('\n4) SQL quoting — publisher strings are verbatim, quotes escaped');
{
  for (const [name, src] of [['arcgis', arcgis], ['socrata', socrata]]) {
    ok(`${name} escapes single quotes in whitelist values`, /replaceAll\("'", "''"\)/.test(src));
  }
}

console.log('\n5) recency_expr parity — arcgis and ckan gain the socrata escape hatch');
ok('arcgis declares recency_expr', /\n  recency_expr\?: string;/.test(arcgis));
ok('ckan declares recency_expr', /\n  recency_expr\?: string;/.test(ckan));
for (const [name, src] of [['arcgis', arcgis], ['socrata', socrata], ['ckan', ckan]]) {
  ok(`${name} substitutes {cutoff} and {cutoff_compact} at REQUEST time (the window rolls)`,
    /replaceAll\("\{cutoff_compact\}", cutoff\.replaceAll\("-", ""\)\)/.test(src)
    && /replaceAll\("\{cutoff\}", cutoff\)/.test(src));
  ok(`${name} falls back to its default clause when recency_expr is absent`,
    /if \(entry\.recency_expr && entry\.recency_expr\.trim\(\)\) \{[\s\S]{0,400}?\} else \{/.test(src));
}

console.log('\n6) BEHAVIOURAL — the clause the connectors would actually emit');
{
  // Reimplements the shipped builder's contract over real entry shapes. Kept in step with the
  // source by checks 1–4 above, which assert against the shipped text.
  const clause = (entry) => {
    const list = entry.include_types;
    if (!list || !list.length) return null;
    const ts = entry.column_map.type_source;
    const col = !ts ? null : Array.isArray(ts) ? (ts.length === 1 ? String(ts[0]) : null) : String(ts);
    if (!col) return null;
    return `${col} IN (${list.map((v) => `'${String(v).trim().replaceAll("'", "''")}'`).join(',')})`;
  };
  ok('single column → a real IN list',
    clause({ include_types: ['Building', 'Wrecking'], column_map: { type_source: 'permittypemapped' } })
      === "permittypemapped IN ('Building','Wrecking')");
  ok("a value containing an apostrophe is escaped, not broken",
    clause({ include_types: ["Owner's Permit"], column_map: { type_source: 'T' } })
      === "T IN ('Owner''s Permit')");
  ok('a 1-element array type_source is still a single column',
    clause({ include_types: ['A'], column_map: { type_source: ['ONE'] } }) === "ONE IN ('A')");
  ok('a MULTI-column array yields no clause (→ the fail-closed quarantine)',
    clause({ include_types: ['A'], column_map: { type_source: ['A', 'B'] } }) === null);
  ok('no include_types → no clause at all (every existing entry is untouched)',
    clause({ column_map: { type_source: 'T' } }) === null);
  ok('an EMPTY include_types array does not emit `IN ()`',
    clause({ include_types: [], column_map: { type_source: 'T' } }) === null);
}

console.log('\n7) SELF-TEST — the structural detectors can fail');
{
  const stripped = arcgis.replace(/const typeClause = includeTypesClause\(entry\);\n  if \(typeClause\) clauses\.push\(typeClause\);/, '');
  ok('detector would FLAG a build that stopped pushing the clause down',
    !/const typeClause = includeTypesClause\(entry\);\n  if \(typeClause\) clauses\.push\(typeClause\);/.test(stripped));
  const unguarded = arcgis.replace(/include_types\?\.length && !soleTypeCol\(entry\)/, 'false');
  ok('detector would FLAG a build that dropped the fail-closed guard',
    !/include_types\?\.length && !soleTypeCol\(entry\)/.test(unguarded));
}

console.log(fail ? `\n${fail} check(s) FAILED` : `\nAll ${pass} include_types / recency_expr checks passed.`);
process.exit(fail ? 1 : 0);

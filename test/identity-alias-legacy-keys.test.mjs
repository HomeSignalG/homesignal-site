// LEGACY-KEY PRESERVATION: adding identity_aliases_file support must not change ANY source_id the connector already emits.
// Run: node test/identity-alias-legacy-keys.test.mjs
//
// WHAT IS COMPARED. Every committed ArcGIS fixture of REAL captured publisher responses (14 of them, 12 registry entries) is
// driven through the SHIPPED connector (sources/arcgis.ts -> arcgisForZip) and the resulting source_id list is compared with
// test/fixtures/identity-aliases/legacy-source-ids.golden.json. The golden was produced by the connector on origin/main
// BEFORE this change (same driver, IA_SOURCES_DIR pointing at a checkout of that commit); it is data, not a recomputation,
// so a change that alters a key cannot also "fix" the expectation by accident.
//
// HOW TO REGENERATE (only if a fixture or registry entry legitimately changes, never to absorb a key change):
//   git archive origin/main supabase/functions/get-address-report | tar -x -C /tmp/old
//   IA_SOURCES_DIR=/tmp/old/supabase/functions/get-address-report/sources IA_GOLDEN_WRITE=1 node test/identity-alias-legacy-keys.test.mjs
//
// A SECOND population is covered too: an entry that does NOT opt in, fed rows that WOULD be aliased if it did (a reused
// PermitID with a file loaded in deps), must still emit the bare id for every row - the option is per-entry and default-off.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.IA_SOURCES_DIR || join(root, 'supabase/functions/get-address-report/sources');
const GOLDEN = join(root, 'test/fixtures/identity-aliases/legacy-source-ids.golden.json');
const WRITE = process.env.IA_GOLDEN_WRITE === '1';
let n = 0, fails = 0;
const ok = (c, name, detail) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (!c && detail ? '\n     ' + detail : '')); if (!c) fails++; };

const { arcgisForZip } = await import(pathToFileURL(join(SRC, 'arcgis.ts')).href);
const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8')).arcgis;
const byId = (id) => REG.find((e) => e.registry_id === id);

// (fixture, registry entry) - the pairing the existing connector suites already use
const CASES = [
  ['fixtures/city-of-orange/active-planning-projects-sample.json', 'city-of-orange-active-planning-projects'],
  ['fixtures/mdt-stip/lines-sample.json', 'mt-mdt-stip-lines'],
  ['fixtures/phoenix/planning-permit-layer1-sample.json', 'phoenix-building-permits'],
  ['fixtures/kytc-syp/louisville-current-plan.json', 'kytc-syp-highway-plan'],
  ['fixtures/sd-stip/structures-sample.json', 'sd-stip-structures'],
  ['fixtures/sd-stip/construction-reconstruction-sample.json', 'sd-stip-construction-reconstruction'],
  ['fixtures/penndot/points-sample.json', 'penndot-transportation-projects'],
  ['fixtures/el-paso/new-residential-sample.json', 'el-paso-new-residential-permits'],
  ['fixtures/madison/planning-projects-sample.json', 'madison-planning-projects'],
  ['fixtures/ardot/points-sample.json', 'ar-ardot-job-status-points'],
  ['fixtures/ardot/points-overlap-sample.json', 'ar-ardot-job-status-points'],
  ['fixtures/ardot/lines-sample.json', 'ar-ardot-job-status-lines'],
  ['fixtures/ardot/lines-overlap-sample.json', 'ar-ardot-job-status-lines'],
  ['fixtures/bismarck/building-permit-main-sample.json', 'bismarck-building-permits'],
];

async function idsFor(fixturePath, entry, deps = {}) {
  const fx = JSON.parse(readFileSync(join(root, fixturePath), 'utf8'));
  const pt = (fx.features || []).map((f) => f.geometry).find((g) => g && Number.isFinite(g.x) && Number.isFinite(g.y));
  const centroid = pt ? { lat: pt.y, lng: pt.x } : { lat: 40, lng: -100 };
  // the fixture answers the FIRST page only; a later page is empty (a mock that repeats it would page until the row cap)
  const f = async (u) => {
    const first = new URL(String(u)).searchParams.get('resultOffset') === '0';
    const body = first ? { ...fx, exceededTransferLimit: false } : { features: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const comm = [{ state: entry.coverage[0].state, county: entry.coverage[0].county }];
  const { sites } = await arcgisForZip('00000', comm, [entry], { fetch: f, zipCentroid: centroid, ...deps });
  return sites.map((s) => s.source_id);
}

const got = {};
for (const [fx, id] of CASES) {
  const e = byId(id);
  if (!e) { ok(false, `registry carries ${id}`); continue; }
  got[`${fx}|${id}`] = await idsFor(fx, e);
}

if (WRITE) {
  writeFileSync(GOLDEN, JSON.stringify({ _note: 'source_ids emitted by the connector on origin/main BEFORE identity_aliases_file existed. Data, not a recomputation.', cases: got }, null, 1) + '\n');
  console.log('golden written: ' + Object.keys(got).length + ' cases, ' + Object.values(got).reduce((a, v) => a + v.length, 0) + ' source_ids');
  process.exit(0);
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')).cases;
ok(Object.keys(golden).length === CASES.length, `golden carries all ${CASES.length} fixture/entry cases`, Object.keys(golden).length);
let total = 0;
for (const [fx, id] of CASES) {
  const k = `${fx}|${id}`;
  const a = got[k], b = golden[k];
  total += (b || []).length;
  ok(Array.isArray(b) && b.length > 0, `${k}: golden is non-empty (a zero here would make the comparison vacuous)`, b && b.length);
  ok(JSON.stringify(a) === JSON.stringify(b), `${k}: ${b ? b.length : '?'} source_ids identical to the pre-change connector`,
    JSON.stringify(a) + '\n     vs ' + JSON.stringify(b));
}
ok(total >= 40, `controls: ${total} legacy source_ids compared in total`, total);

// default-off: a loaded alias file is IGNORED by an entry that does not name it.
// The madison fixture carries no OBJECTID, so one is ADDED in memory to the copy fed to the connector; the same copy WITH the
// opt-in is the positive control (it must alias), which is what makes the "ignored" result mean something.
{
  const e = byId('madison-planning-projects');
  const fx = JSON.parse(readFileSync(join(root, 'fixtures/madison/planning-projects-sample.json'), 'utf8'));
  fx.features.forEach((f, i) => { f.attributes.OBJECTID = 9000 + i; });
  const caseCol = e.column_map.case_number;
  const first = String(fx.features[0].attributes[caseCol]);
  const aliasFile = { version: 1, registry_id: e.registry_id, id_field: caseCol, oid_field: 'OBJECTID', aliases: { '9000': first + '#9000' }, scan: {} };
  const run = async (entry) => {
    const f = async (u) => new Response(JSON.stringify(new URL(String(u)).searchParams.get('resultOffset') === '0' ? fx : { features: [] }), { status: 200 });
    const c = fx.features.map((x) => x.geometry).find((g) => g && Number.isFinite(g.x));
    return (await arcgisForZip('00000', [{ state: e.coverage[0].state, county: e.coverage[0].county }], [entry],
      { fetch: f, zipCentroid: { lat: c.y, lng: c.x }, identityAliases: { 'madison.json': aliasFile } })).sites.map((s) => s.source_id);
  };
  const plain = await run(e);
  const opted = await run({ ...e, identity_aliases_file: 'madison.json' });
  ok(plain.length > 0 && plain.includes(`arcgis:${e.registry_id}:${first}`) && !plain.some((s) => s.includes('#')),
    'an entry that does not declare identity_aliases_file ignores a loaded alias file (default-off, per entry)', JSON.stringify(plain));
  ok(opted.includes(`arcgis:${e.registry_id}:${first}#9000`),
    'control: the same file WITH the opt-in does alias that record (so the ignore above could have failed)', JSON.stringify(opted));
  ok(JSON.stringify(plain) === JSON.stringify(golden['fixtures/madison/planning-projects-sample.json|madison-planning-projects']),
    'and the default-off keys equal the pre-change golden');
}

console.log(`\n${fails ? 'FAILED' : 'ALL PASSED'} (${n} checks)`);
process.exit(fails ? 1 : 0);

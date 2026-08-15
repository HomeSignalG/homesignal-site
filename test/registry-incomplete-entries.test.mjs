// Offline pin on the live-metric exclusion criteria — no network, no DB.
//
// THE PROBLEM THIS RETIRES (2026-08-15): the "10 incomplete registry entries" that gate the
// Live-page metric were HAND-MAINTAINED in QUEUE.md and restated inline in every query. Nothing
// enforced them. scripts/compute-incomplete-registry.mjs is now the one computation; this suite
// pins the CRITERIA (not the current list — pinning the list would recreate transcription).
//
// The near-miss that fixed the written definition: read naively ("complete on both type_map and
// status_to_bucket", old QUEUE.md wording), the status half wrongly flags the four socrata
// status_const entries (east-baton-rouge / marin-county / buffalo / prince-georges), whose
// all-empty status_to_bucket is the CORRECT idiom — socrata's status_const IS the bucket
// (test/status-const-must-be-mapped.test.mjs documents the connector asymmetry). The criteria
// therefore carry an explicit socrata clause, and this suite proves it.
//
// Run: node scripts/run-unit-tests.mjs   (or: node test/registry-incomplete-entries.test.mjs)
import { readFileSync } from 'node:fs';
import { hasUseType, hasStatus, computeIncomplete, REGISTRY_PATH }
  from '../scripts/compute-incomplete-registry.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? '\n     ' + detail : ''}`); }
};

const reg = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
const computed = computeIncomplete(reg);
const total = Object.values(reg).filter(Array.isArray)
  .reduce((n, a) => n + a.filter(e => e && typeof e === 'object' && e.registry_id).length, 0);

console.log('1) positive control — the computation ran over real data');
ok('registry parsed with a plausible entry count', total >= 150, `saw ${total}`);
ok('computed list is non-empty (a sudden zero would mean the criteria stopped seeing the registry)',
  computed.length >= 1, `computed ${computed.length}`);
ok('every computed id exists exactly once in the registry',
  computed.every(c => Object.values(reg).filter(Array.isArray)
    .flat().filter(e => e && e.registry_id === c.registry_id).length === 1));

console.log('2) criteria — the type half');
const stripped = { registry_id: 'x', status_to_bucket: { approved: ['Issued'] } };
ok('an entry with NEITHER type_map NOR use_type_const is flagged',
  !hasUseType(stripped) && computeIncomplete({ arcgis: [stripped] }).length === 1);
ok('type_map alone satisfies the type half', hasUseType({ registry_id: 'x', type_map: { A: 'Development' } }));
ok('use_type_const alone satisfies the type half', hasUseType({ registry_id: 'x', use_type_const: 'Utility' }));

console.log('3) criteria — the status half, INCLUDING the socrata asymmetry');
const socrataConst = { registry_id: 'x', type_map: { A: 'Development' }, status_const: 'approved',
  status_to_bucket: { proposed: [], approved: [], operating: [], exclude: [] } };
ok('socrata: status_const with all-empty buckets is COMPLETE (the shipped idiom)',
  hasStatus(socrataConst, 'socrata') && computeIncomplete({ socrata: [socrataConst] }).length === 0);
ok('arcgis: the SAME shape is NOT complete (arcgis const is a raw value needing a map)',
  !hasStatus(socrataConst, 'arcgis'));
ok('any family: a non-empty status_to_bucket is complete',
  hasStatus({ registry_id: 'x', status_to_bucket: { approved: ['Issued'] } }, 'arcgis'));
ok('an entry with a type_map but NO status mechanism is flagged',
  computeIncomplete({ arcgis: [{ registry_id: 'x', type_map: { A: 'Development' } }] })
    .some(e => e.reason.includes('no status mechanism')));

console.log('4) the four real socrata status_const entries stay OFF the list');
for (const id of ['east-baton-rouge-building-permits', 'marin-county-building-permits',
                  'buffalo-building-permits', 'prince-georges-county-permits']) {
  const inReg = (reg.socrata || []).some(e => e && e.registry_id === id);
  ok(`${id} present in registry and NOT computed incomplete`,
    inReg && !computed.some(c => c.registry_id === id));
}

console.log('5) SELF-TEST — the detector can fail');
ok('a both-halves-missing entry yields BOTH reasons',
  computeIncomplete({ arcgis: [{ registry_id: 'x' }] })[0].reason.split(';').length === 2);
ok('a fully complete entry yields nothing',
  computeIncomplete({ arcgis: [{ registry_id: 'x', use_type_const: 'Utility',
    status_to_bucket: { approved: ['Issued'] } }] }).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

#!/usr/bin/env node
// A RECORD WHOSE OWN WORDS BUILD A DATA CENTRE IS A DATA CENTRE (founder decision 1, 2026-11-13).
//
// The commercial gate (get-address-report/sources/commercial-eligibility.ts) writes the terminal
// type "other project" when a permit's only Commercial evidence was the property's occupancy.
// That gate was right about Commercial and said nothing about a description that states the
// work builds a data centre, so Memphis permit COM-ACC-25-000051 ("Building a Data Center -
// Phase 1") drew as "Other project" on ZIPs 38118 and 38132.
//
// The rule now: explicit data-centre wording outranks the terminal state ONLY when the same
// words state building-scope work, and never when they name equipment inside an existing data
// centre. Facility use is separate from work type, lifecycle and permit status, so this test
// also pins that the lifecycle a record shows never moves with its Type.
//
// Every Memphis string below is the stored app_projects.name, read from production on
// 2026-11-13 (db-read, the Memphis DPD registry, record_kind development).
//
// Run: node test/datacenter-build-scope.test.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

global.window = { HS: {}, sessionStorage: { getItem() { return null; }, setItem() {} } };
await import(join(root, 'lib/templates.js'));
await import(join(root, 'lib/project-type.js'));
await import(join(root, 'lib/map.js'));
const HS = window.HS;

// Map 1 ZIP mode's shape (zipAuthSiteFromMarker): use_type = app_projects.type, type = bucket.
const zipSite = (useType, name, bucket) => ({ scope: 'point', relevance: 'development',
  bucket, type: bucket, use_type: useType, label: name });
const typeOf = (useType, name) => HS.resolveMarker(zipSite(useType, name, 'approved')).typeKey;
const zipPageType = (type, name) => (HS.canonicalProjectType({ type, name }) || {}).typeKey;

const MEMPHIS = {
  phase1: 'ACC Project: Building a Data Center - Phase 1\nThe first phase of the data center project focuses on the initial deployme',
  racking: 'ACC Installing data center containment racking for Oppidan Data Center Facility located at 3900 S. Mendenhall Road, Memp',
  phase3: 'ALT Interior scope of work for Phase III of a new data center.',
  hall: 'ADD PEMB & Foundation additions and Data Hall structures only - no MEP or other interior alterations.',
  alt: 'ALT Main building data center alterations',
  install: 'NEW Install data centers. This will include a new service that will power 20 transformers (3,250kva)  that supplies powe',
};

console.log('\n-- 1. the terminal "other project" no longer hides a data-centre BUILD --');
check('COM-ACC-25-000051 "Building a Data Center - Phase 1" is a Data center on Map 1',
  typeOf('other project', MEMPHIS.phase1) === 'datacenter', typeOf('other project', MEMPHIS.phase1));
check('...and on the ZIP page (canonicalProjectType gives the same answer)',
  zipPageType('other project', MEMPHIS.phase1) === 'datacenter');

console.log('\n-- 2. work INSIDE an existing data centre stays terminal (no new development) --');
check('COM-ACC-24-000023 containment racking stays Other project',
  typeOf('other project', MEMPHIS.racking) === 'other');
for (const nm of ['IRON MOUNTAIN DATA CENTER - PUMP', 'New generator yard at existing data center',
                  'Data center phase 2 UPS and cabling', 'Fire alarm upgrade, new data hall building']) {
  check(`terminal + equipment wording stays Other project: "${nm}"`, typeOf('other project', nm) === 'other');
}
check('terminal + a data-centre mention with no build wording stays Other project',
  typeOf('other project', 'Tenant finish at the data center') === 'other');

console.log('\n-- 3. the guards still win over the exception --');
check('"serving a data center" power work is not a data centre, even with build words',
  typeOf('other project', 'NEW 132 kV substation to serve the data center campus') === 'other');
check('a street name is not a data centre',
  typeOf('other project', 'Data Center Dr new office building') === 'other');

console.log('\n-- 4. records that were already data centres are unchanged --');
for (const k of ['phase3', 'hall', 'alt', 'install']) {
  check(`Commercial-typed Memphis permit still a Data center: ${k}`, typeOf('Commercial', MEMPHIS[k]) === 'datacenter');
}

console.log('\n-- 5. compute vocabulary needs a named physical facility --');
check('"super-compute facility" is a Data center',
  typeOf('commercial', 'gas-fired power plant and super-compute facility') === 'datacenter');
check('"Supercomputer facility" is a Data center', typeOf('commercial', 'Supercomputer facility') === 'datacenter');
check('"HPC center" is a Data center', typeOf('commercial', 'New HPC center') === 'datacenter');
for (const nm of ['AI factory', 'Compute capacity upgrade', 'Computer store remodel', 'Super computer repair shop',
                  'GPU cluster', 'Office for a computing company']) {
  check(`"${nm}" is NOT a Data center`, typeOf('commercial', nm) !== 'datacenter');
}

console.log('\n-- 5b. a standalone power plant is never a data centre (founder, 2026-11-13) --');
// SHARED FIXTURE: homesignal-ingest #1119 copies the accepted and refused phrases of §5 and §5b.
// Move or rename them only together with that session.
const POWER_NOT_DC = [
  'Air quality standard permit for gas turbines to serve the super-compute facility',
  'Combustion turbines to power the data center',
  'Gas turbine generators powering the data center campus',
  'Standard permit: electric generating units for the supercomputer facility',
  'Air permit, 15 natural gas turbines, SpaceX Starbase super-compute facility',
  'Power plant serving the data center',
  'Substation to serve the data center',
  'Natural gas power plant',
];
const POWER_DC = [
  'gas-fired power plant and super-compute facility',   // a combined project: the compute facility is joined to it
  'AT&T - OAKTON DATA CENTER GENERATOR POWER',          // backup power AT a data centre, no serving words
];
for (const t of ['energy', 'industrial', 'commercial']) {
  for (const nm of POWER_NOT_DC) check(`${t}: "${nm}" is NOT a Data center`, typeOf(t, nm) !== 'datacenter');
  for (const nm of POWER_DC) check(`${t}: "${nm}" is a Data center`, typeOf(t, nm) === 'datacenter');
}

console.log('\n-- 6. Type never moves the lifecycle --');
// The page path (HS.resolveTrackerMarker), with the record's own status, exactly as Map 1 draws it.
const lifecycleOf = (name, status, bucket) =>
  HS.resolveTrackerMarker({ scope: 'point', relevance: 'development', bucket, type: bucket,
    use_type: 'other project', status, label: name }, () => '').lifecycle;
for (const [status, bucket] of [['Proposed', 'proposed'], ['Approved', 'approved'], ['Operating', 'operating']]) {
  const before = lifecycleOf('IRON MOUNTAIN DATA CENTER - PUMP', status, bucket);
  const after = lifecycleOf(MEMPHIS.phase1, status, bucket);
  check(`${status}: the lifecycle is the record's own and is the same whatever the Type`,
    before === after && after === bucket, `${before} / ${after}`);
}

console.log('\n-- 7. the production apply file carries the DDL of record unchanged --');
{
  const { execFileSync } = await import('node:child_process');
  let fresh = true;
  try { execFileSync(process.execPath, [join(root, 'scripts/gen-dc-type-sql.mjs'), '--check'], { stdio: 'pipe' }); }
  catch (e) { fresh = false; }
  check('the SQL copy is generated from lib/project-type.js and is current (scripts/gen-dc-type-sql.mjs --check)', fresh);
  const { readFileSync } = await import('node:fs');
  const rec = readFileSync(join(root, 'docs/fix28-datacenter-zip-membership.sql'), 'utf8');
  const app = readFileSync(join(root, 'docs/dc-build-scope-apply-2026-11-13.sql'), 'utf8');
  const fn = (t) => { const i = t.indexOf('create or replace function public.map_site_is_datacenter_type');
    return i < 0 ? null : t.slice(i, t.indexOf('$function$;', i) + 11); };
  check('the apply file\'s function is byte-identical to docs/fix28-datacenter-zip-membership.sql',
    fn(rec) && fn(rec) === fn(app));
  check('the apply file runs in one transaction with a post-check',
    /^begin;/m.test(app) && /raise exception/.test(app) && /^commit;/m.test(app));
}

console.log(failures ? `\n${failures} FAILING` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

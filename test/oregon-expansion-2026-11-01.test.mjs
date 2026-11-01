// Offline checks for the five Oregon sources wired 2026-11-01 (NWMLS Oregon expansion).
// Each pin is a rule the receipts depend on: right state and county, PII never read,
// noise types filtered at source, and statuses that do not claim an outcome the source does not state.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : '')); if (!c) fails++; };
const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const get = (id) => REG.arcgis.find((e) => e.registry_id === id);
const IDS = ['tigard-or-active-building-permits', 'tigard-or-active-planning-cases', 'beaverton-or-site-development-permits',
  'portland-neighborhood-contact-applications', 'eugene-or-current-capital-projects'];
const E = Object.fromEntries(IDS.map((id) => [id, get(id)]));
ok(IDS.every((id) => E[id]), 'all five entries exist exactly in the arcgis list');

// 1. Oregon only, on each city's own host
for (const id of IDS) {
  const e = E[id];
  ok(e.coverage.length > 0 && e.coverage.every((c) => c.state === 'OR' && c.county), `${id}: coverage is Oregon counties only`);
  ok(Array.isArray(e.out_fields) && e.out_fields.length > 0, `${id}: projects named fields (out_fields)`);
}
ok(E['tigard-or-active-building-permits'].service_url.startsWith('https://svr.tigardmaps.com/'), 'Tigard reads the city\'s own server');
ok(E['eugene-or-current-capital-projects'].coverage.every((c) => c.county === 'Lane'), 'Eugene is Lane County only');

// 2. Personal data is never read
const PII = { 'tigard-or-active-building-permits': ['APPNAME'], 'tigard-or-active-planning-cases': ['APPNAME'],
  'portland-neighborhood-contact-applications': ['applicant', 'phone', 'email', 'meeting_notes'],
  'eugene-or-current-capital-projects': ['CONTACT', 'PHONE'] };
for (const [id, cols] of Object.entries(PII)) for (const c of cols) {
  const e = E[id];
  ok(!e.out_fields.includes(c) && !JSON.stringify(e.column_map).includes('"' + c + '"'), `${id}: ${c} is not read`);
}

// 3. Noise filtered at source
ok(/'SDCOMM','SDSUB'/.test(E['beaverton-or-site-development-permits'].extra_where)
  && !/FRUT|COBUT|SDGA|'ST'/.test(E['beaverton-or-site-development-permits'].extra_where),
  'Beaverton reads only SDCOMM and SDSUB (no utility, street, grading rows, whose names are often a person)');
const tb = E['tigard-or-active-building-permits'].extra_where;
ok(!/Electrical|Mechanical|Plumbing|Fire Protection|Renewable|Site Work/.test(tb), 'Tigard building reads no trade permits');
const tp = E['tigard-or-active-planning-cases'].extra_where;
ok(!/Tree Removal|Temporary Use|Home Business/.test(tp), 'Tigard planning reads no tree, temporary-use or home-business cases');

// 4. Statuses never claim an outcome the source does not state
ok(E['tigard-or-active-planning-cases'].status_to_bucket.exclude.includes('Decision Issued')
  && !E['tigard-or-active-planning-cases'].status_to_bucket.approved.length, "Tigard 'Decision Issued' (outcome unstated) is excluded, never approved");
for (const id of IDS) ok(!(E[id].status_to_bucket.operating || []).length, `${id}: nothing is claimed built (operating is empty)`);
ok(E['portland-neighborhood-contact-applications'].use_type_const === 'Development'
  && !E['portland-neighborhood-contact-applications'].type_map, 'Portland notices: type is the honest generic Development');

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);

// Illinois pre-launch fix (2026-10-20), driven through the SHIPPED code — no network.
//
//   A date in year 2100 or later is a placeholder whatever its kind (sources/date-sanity.ts).
//   Measured on app_projects 2026-10-20: 6 development rows nationally carried one, all City of
//   Champaign IL special use permit 1669-01-01-SU (Effective_ 9999-09-09, kind `decided`), on 6 ZIP
//   pages. The latest real far-future date was `scheduled` 2050-10-02, so real long-range plans stay.
// Run: node scripts/run-unit-tests.mjs   (or: node test/illinois-prelaunch-2026-10-20.test.mjs)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = join(root, 'supabase/functions/get-address-report');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const { refuseFutureFilingDates, PLACEHOLDER_YEAR_FROM } = await import(join(fn, 'sources/date-sanity.ts'));

console.log('\n1) placeholder years are withheld for every date kind');
const out = refuseFutureFilingDates([
  { case_number: '1669-01-01-SU', file_date: '9999-09-09', file_date_kind: 'decided' }, // Champaign, real row
  { case_number: 'p-sched', file_date: '2100-01-01', file_date_kind: 'scheduled' },
  { case_number: 'p-hear', file_date: '2199-09-09', file_date_kind: 'hearing' },
  { case_number: 'p-none', file_date: '2100-10-10' },
  { case_number: 'plan2050', file_date: '2050-10-02', file_date_kind: 'scheduled' },    // real long-range plan
  { case_number: 'dec2029', file_date: '2029-01-23', file_date_kind: 'decided' },       // real far decided
  { case_number: 'last', file_date: '2099-12-31', file_date_kind: 'estimated' },
  { case_number: 'bend', file_date: '2033-10-20', file_date_kind: 'issued' },           // existing rule
  { case_number: 'undated', file_date: null, file_date_kind: 'decided' },
], '2026-10-20');
const o = Object.fromEntries(out.map((r) => [r.case_number, r]));
ok(PLACEHOLDER_YEAR_FROM === '2100-01-01', 'the placeholder horizon is 2100-01-01');
ok(o['1669-01-01-SU'].file_date === null && o['1669-01-01-SU'].file_date_refused === '9999-09-09',
  'Champaign SUP 1669-01-01-SU keeps the record, loses 9999-09-09');
ok(o['p-sched'].file_date === null && o['p-hear'].file_date === null && o['p-none'].file_date === null,
  'scheduled, hearing and kind-less placeholder dates are withheld too');
ok(o.plan2050.file_date === '2050-10-02' && o.dec2029.file_date === '2029-01-23' && o.last.file_date === '2099-12-31',
  'real far-future dates below 2100 are untouched');
ok(o.bend.file_date === null && o.bend.file_date_refused === '2033-10-20', 'the filed/issued rule still holds');
ok(o.undated.file_date === null && !('file_date_refused' in o.undated), 'an undated record is unchanged');
ok(Object.keys(o['1669-01-01-SU']).sort().join() === 'case_number,file_date,file_date_kind,file_date_refused',
  'no other field is added or removed');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);

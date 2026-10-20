// Massachusetts pre-launch fix (2026-10-20), driven through the SHIPPED code — no network.
//
// A date more than 20 years ahead is a publisher's "not set" placeholder, whatever its kind
// (sources/date-sanity.ts, PLACEHOLDER_HORIZON_DAYS). Measured on app_projects 2026-10-20: real
// schedules end at 2042-07-07; 341 MassDOT design projects carried ScheduledAdDate 2050-10-01/02 on
// 537 of 627 Massachusetts ZIP pages; one Champaign IL special-use permit carried decided 9999.
// The record stays, only the date is withheld. No source is named in the rule.
// Run: node scripts/run-unit-tests.mjs   (or: node test/massachusetts-prelaunch-2026-10-20.test.mjs)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = join(root, 'supabase/functions/get-address-report');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const ds = await import(join(fn, 'sources/date-sanity.ts'));
const { refuseFutureFilingDates, PLACEHOLDER_HORIZON_DAYS, latestPlausibleScheduledDay } = ds;
const today = '2026-10-20';

ok(PLACEHOLDER_HORIZON_DAYS === 7305, 'the horizon is 20 years (7,305 days)');
ok(latestPlausibleScheduledDay(today) === '2046-10-20', 'the latest acceptable scheduled day is 2046-10-20');
ok(latestPlausibleScheduledDay(today) > '2042-07-07', 'the latest real schedule measured nationally (2042-07-07) stays inside it');
ok(latestPlausibleScheduledDay(today) < '2050-10-01', 'the MassDOT placeholder (2050-10-01) falls outside it');

const out = refuseFutureFilingDates([
  { case_number: '609402', file_date: '2050-10-02', file_date_kind: 'scheduled' },   // MassDOT, real shape
  { case_number: '613818', file_date: '2050-10-01', file_date_kind: 'scheduled' },
  { case_number: 'chm', file_date: '9999-12-31', file_date_kind: 'decided' },         // Champaign IL shape
  { case_number: 'wsdot', file_date: '2042-07-07', file_date_kind: 'scheduled' },     // longest real schedule
  { case_number: 'nh', file_date: '2040-01-01', file_date_kind: 'scheduled' },
  { case_number: 'stip', file_date: '2028-06-01', file_date_kind: 'scheduled' },
  { case_number: 'est', file_date: '2031-05-01', file_date_kind: 'estimated' },
  { case_number: 'hr', file_date: '2026-11-15', file_date_kind: 'hearing' },
  { case_number: 'edge', file_date: '2046-10-20', file_date_kind: 'scheduled' },      // exactly on the horizon
  { case_number: 'edge1', file_date: '2046-10-21', file_date_kind: 'scheduled' },     // one day past it
  { case_number: 'nokind', file_date: '2050-10-02' },                                 // no kind declared
  { case_number: 'BP20-877', file_date: '2033-10-20', file_date_kind: 'issued' },     // filing rule unchanged
  { case_number: 'undated', file_date: null, file_date_kind: 'scheduled' },
], today);
const o = Object.fromEntries(out.map((r) => [r.case_number, r]));
ok(o['609402'].file_date === null && o['609402'].file_date_refused === '2050-10-02', 'MassDOT 2050-10-02 placeholder refused, kept as file_date_refused');
ok(o['613818'].file_date === null && o['613818'].case_number === '613818', 'MassDOT 2050-10-01 placeholder refused, record kept');
ok(o.chm.file_date === null && o.chm.file_date_refused === '9999-12-31', 'a decided 9999 sentinel is refused');
ok(o.wsdot.file_date === '2042-07-07' && o.nh.file_date === '2040-01-01', 'real long-range schedules (2040, 2042) are kept');
ok(o.stip.file_date === '2028-06-01' && o.est.file_date === '2031-05-01' && o.hr.file_date === '2026-11-15',
  'near scheduled / estimated / hearing dates are untouched');
ok(o.edge.file_date === '2046-10-20' && o.edge1.file_date === null, 'the boundary is inclusive: day 7,305 kept, day 7,306 refused');
ok(o.nokind.file_date === null, 'a record with no declared kind is held to the placeholder horizon');
ok(o['BP20-877'].file_date === null && o['BP20-877'].file_date_refused === '2033-10-20', 'the filed/issued rule (today + 1) is unchanged');
ok(o.undated.file_date === null && !('file_date_refused' in o.undated), 'an undated record is untouched');
ok(out.length === 13, 'no record is dropped');

const src = readFileSync(join(fn, 'sources/date-sanity.ts'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/massdot|champaign|2050|9999/i.test(src), 'the rule names no source and no sentinel value (code, comments stripped)');
const idx = readFileSync(join(fn, 'index.ts'), 'utf8');
ok(/refuseFutureFilingDates\(\[\.\.\.tabsSites, \.\.\.socrataSites, \.\.\.arcgisSites, \.\.\.ckanSites, \.\.\.csvSites, \.\.\.cartoSites\], today\)/.test(idx),
  'index.ts still applies it to every permit connector');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);

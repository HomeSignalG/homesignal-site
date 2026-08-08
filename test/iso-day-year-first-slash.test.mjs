// Regression: isoDay() must parse the YEAR-FIRST slash date form, and must not change any
// value it already parsed.
//
// WHY. `isoDay()` accepted `YYYY-MM-DD`, `M/D/YYYY`, epoch ms and 13-digit epoch strings — but
// not `YYYY/MM/DD`. Two live ArcGIS sources publish exactly that, as STRING columns, and every
// row was silently dropped to `file_date: null`: virginia-beach-building-permits (`IssueDate`,
// 14,109 records / 9 pages) and anaheim-land-use-cases (`Application_Received`, 796 / 7). The
// registry declared the right column in both cases, so nothing looked wrong anywhere — the
// config-vs-table divergence pass is what surfaced it (docs/accuracy-audit-2026-08.md §G2, §H1).
//
// Live receipts behind the two cases (pg_net, 2026-08-08):
//   virginia-beach … /0/query?outFields=IssueDate,ApplicationDate,FinalDate
//     → {"IssueDate":"2023/01/03","ApplicationDate":"2023/01/01","FinalDate":"2023/04/27"}
//   anaheim … /0/query?outFields=Application_Received,City_Council_Date
//     → {"Application_Received":"2008/08/19","City_Council_Date":" "}
//
// The check drives the SHIPPED source (arcgis.ts and socrata.ts each carry their own copy —
// ckan/csv/carto use `new Date()`, which already accepts the form).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'supabase/functions/get-address-report/sources');

// Extract the real isoDay body from each connector rather than restating it, so the test cannot
// drift away from what ships.
function loadIsoDay(file) {
  const src = readFileSync(join(srcDir, file), 'utf8');
  const start = src.indexOf('function isoDay(');
  if (start < 0) throw new Error(`${file}: isoDay not found`);
  let depth = 0, i = src.indexOf('{', start), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const body = src.slice(start, end)
    .replace(/:\s*unknown/g, '').replace(/:\s*string \| null/g, '');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return isoDay;`)();
}

const CASES = [
  // the form that was dropped — the whole point of the change
  ['2023/01/03', '2023-01-03'],
  ['2008/08/19', '2008-08-19'],
  ['2024/7/4', '2024-07-04'],          // unpadded month/day still normalizes
  ['2023/04/27 00:00:00', '2023-04-27'],
  // everything that already worked must be byte-identical
  ['2026-08-08', '2026-08-08'],
  ['2026-08-08T13:45:00Z', '2026-08-08'],
  ['7/4/2024', '2024-07-04'],
  ['12/31/1999', '1999-12-31'],
  // and non-dates must still be null, not a guess
  [' ', null],
  ['', null],
  ['JUNE', null],
  ['2011', null],                       // loudoun's YEAR_ISSUED: a year is not a date
  [null, null],
];

const failures = [];
for (const file of ['arcgis.ts', 'socrata.ts']) {
  const isoDay = loadIsoDay(file);
  for (const [input, expected] of CASES) {
    const got = isoDay(input);
    if (got !== expected) {
      failures.push(`${file}: isoDay(${JSON.stringify(input)}) → ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    }
  }
}

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log(`isoDay: ${CASES.length} cases × 2 connectors — year-first slash dates parse, every prior form unchanged.`);

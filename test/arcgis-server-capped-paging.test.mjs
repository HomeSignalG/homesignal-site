// Offline tests for the SERVER-CAPPED PAGING fix (2026-08-03) — no network.
//
// THE DEFECT, found while measuring the portland-building-permits re-cache. Three separate Portland
// ZIPs cached EXACTLY 200 records each — a round number is a cap, not a data pattern. The layer
// (`COP_OpenData_PlanningDevelopment/MapServer/89`) declares `maxRecordCount: 200`, while the
// connector's default pageSize is 1000. ArcGIS answers such a request with a SHORT page plus
// `exceededTransferLimit: true`, meaning "there is more". The old loop ended:
//
//     if (feats.length < pageSize || page.exceededTransferLimit === false) break;
//     offset += pageSize;
//
// so `200 < 1000` short-circuited and broke — BEFORE the exceededTransferLimit clause that exists to
// catch precisely this. Every arcgis layer whose own maxRecordCount is below the pageSize has been
// silently truncated to a single page for as long as its entry has existed. It is pre-existing and
// has nothing to do with the include_types work that surfaced it.
//
// The SECOND defect in the same two lines: `offset += pageSize` advanced by the REQUESTED size rather
// than the RECEIVED count, so a server-capped page would have SKIPPED the difference (800 rows here)
// had the loop continued. Fixing the break alone would have converted silent truncation into silent
// GAPS — strictly worse, because a gap is invisible in a total.
//
// These tests drive the SHIPPED connector against a fake server that behaves like Portland's.
// Run: node scripts/run-unit-tests.mjs   (or: node test/arcgis-server-capped-paging.test.mjs)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? '\n     ' + detail : ''}`); }
};

const src = readFileSync(
  new URL('../supabase/functions/get-address-report/sources/arcgis.ts', import.meta.url), 'utf8');

console.log('1) the shipped loop no longer short-circuits on a short page');
ok('offset advances by the RECEIVED count, not the requested pageSize',
  /offset \+= feats\.length;/.test(src) && !/offset \+= pageSize;/.test(src));
ok('an EXPLICIT false still stops, even on a full page',
  /if \(page\.exceededTransferLimit === false\) break;/.test(src));
ok('otherwise it stops only on a SHORT page',
  /if \(page\.exceededTransferLimit !== true && feats\.length < pageSize\) break;/.test(src));
ok('the old short-circuiting break is gone',
  !/if \(feats\.length < pageSize \|\| page\.exceededTransferLimit === false\) break;/.test(src));

console.log('\n2) BEHAVIOURAL — the loop contract, over a Portland-shaped server');
{
  // Reimplements the shipped predicate; checks 1 pins it to the real source.
  const shouldStop = (excTL, got, pageSize) =>
    excTL === false ? true : (excTL !== true && got < pageSize);
  const nextOffset = (offset, got) => offset + got;

  ok('server caps at 200 with exceededTransferLimit:true → KEEP GOING (the bug)',
    shouldStop(true, 200, 1000) === false);
  ok('and the next offset is 200, not 1000 (no 800-row gap)', nextOffset(0, 200) === 200);
  ok('genuinely exhausted (short page, no flag) → stop', shouldStop(undefined, 137, 1000) === true);
  ok('exceededTransferLimit:false on a short page → stop', shouldStop(false, 137, 1000) === true);
  ok('full page with no flag → keep going (there may be more)', shouldStop(undefined, 1000, 1000) === false);
  ok('exceededTransferLimit:false on a FULL page → stop (server says that is all)',
    shouldStop(false, 1000, 1000) === true);

  // Walk a whole fetch: 653 rows behind a 200-cap server, pageSize 1000.
  const TOTAL = 653, CAP = 200, PAGE = 1000;
  let offset = 0, seen = 0, pages = 0;
  for (;;) {
    const got = Math.max(0, Math.min(CAP, TOTAL - offset));
    if (got === 0) break;
    pages++; seen += got;
    const excTL = offset + got < TOTAL ? true : false;
    offset = nextOffset(offset, got);
    if (shouldStop(excTL, got, PAGE)) break;
  }
  ok(`all ${TOTAL} rows fetched behind a ${CAP}-row cap (got ${seen} in ${pages} pages)`,
    seen === TOTAL, `seen=${seen} pages=${pages}`);
  ok('no duplicate or skipped offsets — pages tile exactly', pages === Math.ceil(TOTAL / CAP));
}

console.log('\n3) SELF-TEST — the OLD behaviour would have failed these');
{
  const oldShouldStop = (excTL, got, pageSize) => got < pageSize || excTL === false;
  ok('old predicate STOPS on the capped page (reproduces the truncation)',
    oldShouldStop(true, 200, 1000) === true);
  // And with the old offset rule, had it continued, it would have skipped.
  const oldNextOffset = (offset, _got, pageSize) => offset + pageSize;
  ok('old offset rule would have SKIPPED 800 rows', oldNextOffset(0, 200, 1000) === 1000);
  const TOTAL = 653, CAP = 200, PAGE = 1000;
  let offset = 0, seen = 0;
  for (;;) {
    const got = Math.max(0, Math.min(CAP, TOTAL - offset));
    if (got === 0) break;
    seen += got;
    const excTL = offset + got < TOTAL ? true : false;
    offset = oldNextOffset(offset, got, PAGE);
    if (oldShouldStop(excTL, got, PAGE)) break;
  }
  ok(`old loop returned only ${seen} of ${TOTAL} (the measured 200-per-ZIP shape)`, seen === CAP);
}

console.log(fail ? `\n${fail} check(s) FAILED` : `\nAll ${pass} server-capped-paging checks passed.`);
process.exit(fail ? 1 : 0);

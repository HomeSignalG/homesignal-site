// Pins the dev-backed ZIP metric in scripts/source-monitor.mjs.
//
// WHAT WENT WRONG (2026-08-26): devBackedSnapshot() paged app_projects over PostgREST under
// `for (let page = 0; page < 100; page++)` with `limit=1000` — a hard 100,000-row cap against a
// 3,092,322-row table, with no `order=`. It truncated at ~3% on every run, returned an unstable
// slice, and reported the partial number as if it were the whole table. The nightly metric read
// 472 / 478 / 477 / 3154 / 480 / 3501 / 3444 / 478 with no production change; the true value was
// 10,039.
//
// WHY THIS IS A SOURCE-TEXT TEST: devBackedSnapshot() is module-private and its only real work is
// a network call the offline suite cannot make. The invariant that actually failed is structural —
// "the monitor must not count distinct ZIPs by walking a capped page loop" — and that IS readable
// from the source. This test fails if the walk comes back, and fails if the RPC call goes away.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'scripts/source-monitor.mjs'), 'utf8');

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log(`PASS — ${msg}`); } else { console.log(`FAIL — ${msg}`); failures++; }
}

// The body of devBackedSnapshot(), isolated so an unrelated paging loop elsewhere in the monitor
// (there are legitimate ones) cannot make this test pass or fail by accident.
const start = SRC.indexOf('async function devBackedSnapshot()');
ok(start > -1, 'devBackedSnapshot() still exists in scripts/source-monitor.mjs');
const body = SRC.slice(start, SRC.indexOf('\n}\n', start) + 3);

ok(/rpc\/app_dev_backed_zip_count/.test(body),
  'it measures through the app_dev_backed_zip_count RPC — a loose index scan the DB can finish, '
  + 'not a client-side walk');

ok(/method:\s*'POST'/.test(body),
  "the RPC is invoked with POST (PostgREST rejects a GET body on a function call)");

ok(!/offset=/.test(body) && !/for\s*\(\s*let\s+page/.test(body),
  'NO client-side pagination remains — this is the exact defect: a capped page loop cannot '
  + 'distinguish "the whole table" from "the first 3% of it"');

ok(!/new Set\(\)/.test(body),
  'no client-side distinct-ZIP Set — distinctness is computed in the database, over every row');

ok(/dev_backed_zips/.test(body),
  'it reads the RPC\'s dev_backed_zips field by name, so a shape change surfaces as null rather '
  + 'than as a plausible number');

ok(/Number\.isInteger\(n\)\s*\?\s*n\s*:\s*null/.test(body),
  'FAILS CLOSED on a non-integer: a malformed response returns null, never 0 — a zero here would '
  + 'read as "every page went dark"');

ok(/if\s*\(!r\.ok\)\s*return null/.test(body),
  'FAILS CLOSED on a non-200: an unreachable DB returns null, not a small count');

// The label rename is load-bearing, not cosmetic: every historical "Dev-backed ZIPs snapshot"
// value came from the truncated walk. Comparing an exact count against one would print a ~+9,500
// overnight delta that is purely the instrument being repaired.
ok(/Dev-backed ZIP pages \\\(exact\\\): \\\*\\\*\(\\d\+\)\\\*\\\*/.test(SRC),
  'the previous-run regex matches ONLY the new "(exact)" label, so no delta is ever computed '
  + 'across the fix');

// The old label survives in exactly one place — the comment explaining why it was retired. That
// is documentation, not output, so the assertion is scoped to non-comment lines rather than to the
// whole file; a blanket check would have to be deleted to keep the explanation, which is backwards.
const codeLines = SRC.split('\n').filter((l) => !l.trimStart().startsWith('//'));
ok(!codeLines.some((l) => l.includes('Dev-backed ZIPs snapshot')),
  'the old label is neither emitted nor matched anywhere outside a comment — one label per '
  + 'measurement method, or the history lies');

if (failures) {
  console.log(`\n${failures} assertion(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll dev-backed snapshot assertions passed.');

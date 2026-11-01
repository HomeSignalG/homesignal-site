// Before/after record counts (release gate item 2). Run: node test/lifecycle-before-after.test.mjs
//
// The collector reads production on a runner; this pins the offline half: the slices, the query shape, and the
// report's arithmetic on a synthetic counts file whose rows are real stored (source, status) values read from
// production on 2026-11-01 (ZIP prefix 78).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prefixBounds, sliceSql, buildReport, afterColumn } from '../scripts/lifecycle-before-after.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (c, name, detail) => {
  if (c) console.log('PASS — ' + name);
  else { failures++; console.error('FAIL — ' + name + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
};

// 1. Slices cover every 2-digit prefix exactly once, in order, with no gap.
const b = prefixBounds();
ok(b.length === 100 && b[0][0] === '00' && b[99][1] === '9:', '1a: 100 slices from 00 to 9:', [b[0], b[99]]);
ok(b.every((x, i) => i === 0 || x[0] === b[i - 1][1]), '1b: each slice starts where the previous ended (no gap, no overlap)');
ok('99999' >= '99' && '99999' < '9:', '1c: the last slice includes 99999');

// 2. The query is a read: a single SELECT, development rows, a bounded ZIP range, nothing else.
const q = sliceSql('78', '79');
ok(/^select /.test(q) && !/;|insert|update|delete|drop|alter|create|grant/i.test(q), '2a: one plain SELECT', q);
ok(q.includes("record_kind = 'development'") && q.includes("zip >= '78' and zip < '79'"), '2b: development rows in one ZIP range');
let threw = false; try { sliceSql("78' or 1=1--", '79'); } catch { threw = true; }
ok(threw, '2c: bounds other than two digits are refused');

// 3. The report on a synthetic counts file.
const real = [
  ['austin-zoning-cases', 'Closed', 'Operating', 46550],
  ['austin-zoning-cases', 'Withdrawn', 'Decided', 5722],
  ['austin-zoning-cases', 'In Review', 'Proposed', 1051],
  ['austin-zoning-cases', 'Approved', 'Approved', 4355],
  ['austin-subdivision-cases', 'Subdivision Recorded', 'Operating', 1971],
  ['txdot-projects-info-all', 'Construction', 'Approved', 1164],
  ['tdlr-tabs', 'Review Complete', 'Active', 2],
  ['austin-zoning-cases', 'A status no audit row has', 'Proposed', 7],
];
const slices = prefixBounds().map(([lo, hi]) => ({ lo, hi, rows: lo === '78' ? real : [] }));
const counts = { kind: 'lifecycle-before-after-counts', started: 's', finished: 'f', unit: 'zip_page_placement', zip_pages_registry: 12744, slices };
const out = buildReport(counts);
const total = real.reduce((s, r) => s + r[3], 0);
ok(out.total === total, '3a: every placement counted', [out.total, total]);
ok(out.md.includes('Reconciles exactly'), '3b: the report states its reconciliation');
const line = (reg, stage) => out.csv.split('\n').find((l) => l.startsWith(reg + ',') && l.includes(',' + stage + ','));
ok(/,operating,unknown,undetermined,receipt,/.test(line('austin-zoning-cases', 'Closed') || ''), '3c: D5 — Austin zoning Closed moves Operating → unknown, awaiting a receipt', line('austin-zoning-cases', 'Closed'));
ok(/,proposed,per_record,inactive,/.test(line('austin-zoning-cases', 'Withdrawn') || ''), '3d: a withdrawn case is inactive; its column comes from the record history', line('austin-zoning-cases', 'Withdrawn'));
ok(/,operating,approved,active,/.test(line('austin-subdivision-cases', 'Subdivision Recorded') || ''), '3e: a recorded plat moves Operating → Approved', line('austin-subdivision-cases', 'Subdivision Recorded'));
ok(/,unmatched,unmatched,unmatched,/.test(line('austin-zoning-cases', 'A status no audit row has') || ''), '3f: a stored status the audit lacks is reported, never guessed');
ok(out.md.includes('A status no audit row has'), '3g: unmatched statuses are listed in the report');
let bad = false; try { buildReport({ ...counts, slices: slices.slice(0, 99) }); } catch { bad = true; }
ok(bad, '3h: a counts file missing a slice is refused (a partial count is never reported as complete)');
ok(afterColumn(null) === 'unmatched' && afterColumn({ proposed_column: 'operating or unknown' }) === 'per_record', '3i: only the four columns are taken as an after-column');

// 4. The workflow: dispatch-only, read-only endpoint, results pushed by a job that holds no secret.
const wf = readFileSync(join(root, '.github/workflows/lifecycle-before-after.yml'), 'utf8');
ok(/on:\s*\n\s*workflow_dispatch:/.test(wf) && !/schedule:|pull_request|push:/.test(wf.split('jobs:')[0]), '4a: dispatch only');
ok(wf.includes('scripts/lifecycle-before-after.mjs collect') && !/database\/query"|db-sql/.test(wf), '4b: the collector uses the read-only path only');
const pushJob = wf.slice(wf.indexOf('  publish:'));
ok(pushJob.length > 100 && !/secrets\.PROD_/.test(pushJob), '4c: the job that pushes holds no production secret');
ok(/guard_bot_push\.sh/.test(pushJob), '4d: the push is guarded');

if (failures) { console.error('\n' + failures + ' FAILURE(S)'); process.exit(1); }
console.log('\nALL PASS');

#!/usr/bin/env node
// Run every test/*.test.mjs and test/*.test.ts in deterministic order. Used by
// unit-tests CI and local verification — new regression files are picked up
// automatically. .test.ts is accepted because the connector fixture suites are
// TypeScript (typed registry entries); node >=22.6 strips their types natively,
// the same mechanism the .test.mjs suites already rely on to import sources/*.ts.
//
// MODES (added 2026-08-05, the CI-gate split):
//   (no flag)   every suite — what a human runs locally, unchanged behaviour
//   --offline   every suite EXCEPT the browser-backed ones. This is the REQUIRED
//               CI check: no playwright install, no browser download, no network.
//   --browser   ONLY the browser-backed suites. Reported, not required.
//   --min-files=N  fail if fewer than N files were selected.
//
// Why a floor rather than an exact count: the risk being guarded against is a
// suite that SHRINKS — a glob that stops matching, a rename, a directory that
// silently empties — passing as green because zero failures is indistinguishable
// from zero tests. That is the vacuous-invariant shape: a denominator of zero is
// not a pass. Growth is normal and must not need a workflow edit, so the gate is
// a minimum, printed alongside the actual count on every run.
//
// Browser suites are detected by READING each file for a playwright import, not
// from a hardcoded list. A list drifts: add a browser suite, forget the list, and
// the required job starts running a browser test without a browser — which is the
// silent-skip failure this repo already fixed once. Detection is self-maintaining.
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testDir = join(root, 'test');
const argv = process.argv.slice(2);
const offlineOnly = argv.includes('--offline');
const browserOnly = argv.includes('--browser');
if (offlineOnly && browserOnly) {
  console.error('--offline and --browser are mutually exclusive');
  process.exit(1);
}
const minArg = argv.find((a) => a.startsWith('--min-files='));
const minFiles = minArg ? Number(minArg.split('=')[1]) : 0;
if (minArg && !Number.isFinite(minFiles)) {
  console.error('--min-files needs a number, got: ' + minArg);
  process.exit(1);
}

const PLAYWRIGHT = /(?:from|import\(|require\()\s*['"]playwright['"]/;
const isBrowserSuite = (f) => PLAYWRIGHT.test(readFileSync(join(testDir, f), 'utf8'));

const allFiles = readdirSync(testDir)
  .filter((f) => f.endsWith('.test.mjs') || f.endsWith('.test.ts'))
  .sort();

if (!allFiles.length) {
  console.error('No test/*.test.{mjs,ts} files found');
  process.exit(1);
}

const browserFiles = allFiles.filter(isBrowserSuite);
const offlineFiles = allFiles.filter((f) => !browserFiles.includes(f));
const files = offlineOnly ? offlineFiles : browserOnly ? browserFiles : allFiles;
const mode = offlineOnly ? 'offline' : browserOnly ? 'browser' : 'all';

console.log(
  `mode=${mode} · selected ${files.length} of ${allFiles.length} suite(s) ` +
  `(${offlineFiles.length} offline, ${browserFiles.length} browser-backed)`
);

if (!files.length) {
  console.error(`No suites selected in mode=${mode} — a filter that matches nothing is a defect, not a pass`);
  process.exit(1);
}
if (files.length < minFiles) {
  console.error(
    `SUITE SHRANK: ${files.length} file(s) selected in mode=${mode}, floor is ${minFiles}. ` +
    'Either a suite was deleted or the discovery glob stopped matching. ' +
    'Zero failures over a shrunken suite is not a pass.'
  );
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const path = join(testDir, file);
  console.log('\n=== ' + file + ' ===');
  const res = spawnSync(process.execPath, [path], { stdio: 'inherit', cwd: root });
  if (res.status !== 0) failed++;
}

if (failed) {
  console.error('\n' + failed + ' test file(s) failed');
  process.exit(1);
}
console.log('\nAll ' + files.length + ' unit test file(s) passed (mode=' + mode + ').');

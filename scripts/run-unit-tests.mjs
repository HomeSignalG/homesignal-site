#!/usr/bin/env node
// Run every test/*.test.mjs and test/*.test.ts in deterministic order. Used by
// unit-tests CI and local verification — new regression files are picked up
// automatically. .test.ts is accepted because the connector fixture suites are
// TypeScript (typed registry entries); node >=22.6 strips their types natively,
// the same mechanism the .test.mjs suites already rely on to import sources/*.ts.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testDir = join(root, 'test');
const files = readdirSync(testDir)
  .filter((f) => f.endsWith('.test.mjs') || f.endsWith('.test.ts'))
  .sort();

if (!files.length) {
  console.error('No test/*.test.{mjs,ts} files found');
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
console.log('\nAll ' + files.length + ' unit test file(s) passed.');

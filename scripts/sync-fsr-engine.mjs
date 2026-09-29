#!/usr/bin/env node
// One report engine for the Development Activity report (legacy slug: future-surroundings).
//
// The engine is lib/nyc-v1-report.js (assembly) and lib/nyc-v1-soda.js (the NYC Open Data
// queries). The page loads them from lib/. The edge function runs the SAME files: this script
// puts a byte-for-byte copy under the function's own directory, because that is the only
// layout the Supabase deploy is known to bundle. get-address-report already deploys
// multi-file source from its own directory through .github/workflows/deploy-edge-functions.yml.
//
//   node scripts/sync-fsr-engine.mjs           write the copies
//   node scripts/sync-fsr-engine.mjs --check   exit 1 if a copy is not exactly what would be written
//
// The copy is a build artifact, not a second implementation. Change lib/, run this, commit
// both. test/fsr-engine-one-source.test.mjs fails the required `unit` check if they differ,
// and if the function grows report logic of its own.
//
// Why not import ../../../lib/ from the function directly (measured 2026-09-29, Supabase CLI
// 2.118 against a local mock of the Management API, no project contacted): with --use-api the
// CLI does upload a file imported from outside supabase/functions (as `lib/<file>`), so that
// route looks viable. Whether the server bundles it was not exercised, and the workflow's
// default route bundles with Docker, which this could not run. The first real deploy of this
// function (U13) is the place to prove it and, if it works, delete this copy.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = 'supabase/functions/get-future-surroundings-report/engine';
export const FILES = ['nyc-v1-report.js', 'nyc-v1-soda.js'];

export const header = (name) =>
  '// GENERATED FILE. Do not edit it.\n' +
  '// It is lib/' + name + ' copied byte for byte under this header, so the edge function and\n' +
  '// the page run one report engine. Change lib/' + name + ', then run\n' +
  '//   node scripts/sync-fsr-engine.mjs\n' +
  '// test/fsr-engine-one-source.test.mjs fails if this copy is stale.\n';

export function expected(name) {
  return header(name) + readFileSync(join(root, 'lib', name), 'utf8');
}

export function targetPath(name) {
  return join(root, OUT_DIR, name);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const name of FILES) {
    const want = expected(name);
    let have = null;
    try { have = readFileSync(targetPath(name), 'utf8'); } catch (_e) { /* missing */ }
    if (have === want) { console.log('current  ' + OUT_DIR + '/' + name); continue; }
    stale++;
    if (check) { console.log('STALE    ' + OUT_DIR + '/' + name + (have === null ? ' (missing)' : '')); continue; }
    mkdirSync(dirname(targetPath(name)), { recursive: true });
    writeFileSync(targetPath(name), want);
    console.log('wrote    ' + OUT_DIR + '/' + name);
  }
  if (check && stale) {
    console.error('\n' + stale + ' engine copy(ies) differ from lib/. Run: node scripts/sync-fsr-engine.mjs');
    process.exit(1);
  }
}

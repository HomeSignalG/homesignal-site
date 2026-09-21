#!/usr/bin/env node
// STEP 2A ISOLATION GATE.
//
// Step 2A installs three evidence-staging tables -- dc_source, dc_acquisition_run,
// dc_source_observation -- that NO resident-facing surface may read. They hold what a publisher
// asserted, not what HomeSignal believes; they carry no canonical entity identity, no lifecycle
// resolution and no geography, so a page reading them would be presenting raw source assertions
// as HomeSignal's answer. That is the shortcut this repo's "ONE CANONICAL TRUTH PATH" rule
// forbids, and it is easiest to commit in the week the tables are new and empty.
//
// The gate FAILS if any resident-facing file names one of those objects.
//
// ⚠️ IT MUST PROVE IT RAN. A gate that silently scans zero files is indistinguishable from a
// clean repo, so the scan prints its own file count and REFUSES a suspiciously small one.
//
// ⚠️ `national_dc_source_key_unique` (docs/national-dc-plane.sql) contains the substring
// "dc_source". The pattern is token-bounded precisely so that a substring match cannot
// manufacture a violation -- an over-flagging gate is how a real violation gets waved through.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// The objects Step 2A installs. Token-bounded: a preceding or following [A-Za-z0-9_] is NOT a hit.
const FORBIDDEN = ['dc_source_observation', 'dc_acquisition_run', 'dc_source'];
const PATTERN = new RegExp(`(^|[^A-Za-z0-9_])(${FORBIDDEN.join('|')})([^A-Za-z0-9_]|$)`);

// Resident-facing, or built into something a resident loads.
const SCAN_DIRS = ['lib', 'partials', 'supabase/functions', 'scripts'];
const SCAN_EXT = new Set(['.html', '.js', '.mjs', '.ts', '.py', '.json', '.css']);
const SKIP_DIR = new Set(['node_modules', '.git', 'test', 'docs', 'fixtures', 'dist', 'community']);
const SELF = 'scripts/check-dc-step2a-isolation.mjs';
// The one legitimate reason a scanned path may name these objects: it is the gate itself.
const ALLOW = new Set([SELF]);
// A floor derived from the repo's actual shape, not a round number: the scan covers the root
// pages plus lib/ plus the edge functions, and if it ever drops near zero the gate is broken.
const MIN_FILES = 80;

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p, out); continue; }
    if (SCAN_EXT.has(e.name.slice(e.name.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

function targets() {
  const files = [];
  // every root-level page / script that ships
  for (const e of readdirSync(ROOT, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const ext = e.name.slice(e.name.lastIndexOf('.'));
    if (SCAN_EXT.has(ext)) files.push(join(ROOT, e.name));
  }
  for (const d of SCAN_DIRS) {
    const full = join(ROOT, d);
    try { if (statSync(full).isDirectory()) walk(full, files); } catch { /* absent dir */ }
  }
  return files.map((f) => relative(ROOT, f).split(sep).join('/')).sort();
}

function scan(paths, readFile) {
  const hits = [];
  for (const rel of paths) {
    if (ALLOW.has(rel)) continue;
    let text;
    try { text = readFile(rel); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      const m = PATTERN.exec(line);
      if (m) hits.push({ file: rel, line: i + 1, object: m[2], text: line.trim().slice(0, 140) });
    });
  }
  return hits;
}

function selfTest() {
  // The gate must FAIL on a planted violation and PASS on the lookalike it must not flag.
  const planted = {
    'lib/fake-page.js': "const r = await sb.from('dc_source_observation').select('*');",
    'lib/fake-two.js': 'select * from public.dc_acquisition_run where 1=1',
    'lib/fake-three.js': "from('dc_source')",
  };
  const lookalike = {
    'docs-like/national.sql': 'constraint national_dc_source_key_unique unique (dc_source_key)',
    'lib/unrelated.js': 'const mydc_sourceish = 1; // adc_source_observationx',
  };
  const read = (rel) => (planted[rel] ?? lookalike[rel] ?? '');
  const bad = scan(Object.keys(planted), read);
  const ok = scan(Object.keys(lookalike), read);
  let fails = 0;
  if (bad.length !== 3) { console.error(`SELF-TEST FAIL: planted violations detected ${bad.length}/3`); fails++; }
  if (ok.length !== 0) { console.error(`SELF-TEST FAIL: ${ok.length} false positive(s): ${JSON.stringify(ok)}`); fails++; }
  if (fails) { console.error('SELF-TEST FAILED -- the gate cannot be trusted'); process.exit(1); }
  console.log('SELF-TEST PASS: 3/3 planted violations caught, 0 false positives on the '
    + 'national_dc_source_key_unique lookalike');
}

if (process.argv.includes('--self-test')) { selfTest(); process.exit(0); }

const paths = targets();
console.log(`scanned ${paths.length} resident-facing file(s) across `
  + `[root pages] + ${SCAN_DIRS.join(', ')}`);
if (paths.length < MIN_FILES) {
  console.error(`REFUSED: only ${paths.length} file(s) scanned, expected >= ${MIN_FILES}. `
    + 'A gate that scans nothing reports clean; treat this as a broken instrument, not a pass.');
  process.exit(1);
}

const hits = scan(paths, (rel) => readFileSync(join(ROOT, rel), 'utf8'));
if (hits.length) {
  console.error(`\nFAIL: ${hits.length} resident-facing reference(s) to Step 2A evidence tables.`);
  console.error('Step 2A is source evidence, not resident truth. A page must read the canonical');
  console.error('result owner, never a publisher assertion.\n');
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.object}]  ${h.text}`);
  process.exit(1);
}
console.log(`PASS: 0 references to ${FORBIDDEN.join(', ')} in any scanned file.`);

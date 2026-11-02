#!/usr/bin/env node
// Emits supabase/functions/_shared/residential-qualify.generated.js: the CANONICAL residential qualification rule
// (lib/residential-qualify.js, Map 1's Residential gate and the founder's 2026-09-05 / 2026-09-06 rulings), byte for byte, under a header.
//
// WHY A GENERATED COPY. The national report engine (_shared/national-report.ts, national-6 relevance) asks the SAME question Map 1 asks of a
// residential record ("is this new residential development, routine work on an existing home, or not established?"), and CLAUDE.md forbids a
// second copy of the residential rules. An edge function bundles only its own tree, so the authority is copied in mechanically, exactly as
// scripts/gen-project-type-module.mjs copies the Type authority. test/report-quality-national6.test.mjs fails the moment the copy differs.
//
// The one line of header code: lib/residential-qualify.js writes to `window.HS`. Deno has no `window`, so the header binds a module-scoped
// `window` to the real one when it exists and to `globalThis` otherwise. The authority below the marker is untouched.
//
// Usage:
//   node scripts/gen-residential-qualify-module.mjs          write the file
//   node scripts/gen-residential-qualify-module.mjs --check  exit 1 if the file on disk is not what this would write
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'lib/residential-qualify.js';
const OUT = 'supabase/functions/_shared/residential-qualify.generated.js';

export const HEADER_LINES = [
  '// GENERATED FILE — DO NOT EDIT. Source of truth: lib/residential-qualify.js.',
  '// Regenerate with: node scripts/gen-residential-qualify-module.mjs',
  '// Everything below the marker line is lib/residential-qualify.js, byte for byte.',
  '// test/report-quality-national6.test.mjs fails when it is not.',
  "const window = (typeof globalThis.window !== 'undefined') ? globalThis.window : globalThis;",
];
export const MARKER = '// ==== BEGIN lib/residential-qualify.js (verbatim) ====';
export function build(source) { return HEADER_LINES.join('\n') + '\n' + MARKER + '\n' + source; }

const wanted = build(readFileSync(join(root, SRC), 'utf8'));
if (process.argv.includes('--check')) {
  let onDisk = null;
  try { onDisk = readFileSync(join(root, OUT), 'utf8'); } catch { /* missing */ }
  if (onDisk !== wanted) { console.error(`${OUT} is not what ${SRC} generates. Run: node scripts/gen-residential-qualify-module.mjs`); process.exit(1); }
  console.log(`${OUT} matches ${SRC}`);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(join(root, OUT), wanted);
  console.log(`wrote ${OUT} (${wanted.length} chars) from ${SRC}`);
}

#!/usr/bin/env node
// Emits supabase/functions/_shared/project-type.generated.js: the CANONICAL development Type and
// lifecycle authority (lib/project-type.js), byte for byte, under a header.
//
// WHY A GENERATED COPY AND NOT A SECOND IMPLEMENTATION. The national report engine runs in an edge
// function. lib/project-type.js is the one place that decides what kind of development a record is
// and what its canonical lifecycle is, and CLAUDE.md forbids deciding either anywhere else. An edge
// function's deploy bundles only its own tree, and no function imports from outside it today, so the
// authority has to be present inside that tree. A copy that is MECHANICALLY produced from the
// authority and proven identical to it by test/national-report-structure.test.mjs is not a second
// decision path: there is nothing to edit in it, and CI fails the moment it differs.
//
// Usage:
//   node scripts/gen-project-type-module.mjs          write the file
//   node scripts/gen-project-type-module.mjs --check  exit 1 if the file on disk is not what this would write
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'lib/project-type.js';
const OUT = 'supabase/functions/_shared/project-type.generated.js';

export const HEADER_LINES = [
  '// GENERATED FILE — DO NOT EDIT. Source of truth: lib/project-type.js.',
  '// Regenerate with: node scripts/gen-project-type-module.mjs',
  '// Everything below the marker line is lib/project-type.js, byte for byte.',
  '// test/national-report-structure.test.mjs fails when it is not.',
];
export const MARKER = '// ==== BEGIN lib/project-type.js (verbatim) ====';

export function build(source) {
  return HEADER_LINES.join('\n') + '\n' + MARKER + '\n' + source;
}

const source = readFileSync(join(root, SRC), 'utf8');
const wanted = build(source);

if (process.argv.includes('--check')) {
  let onDisk = null;
  try { onDisk = readFileSync(join(root, OUT), 'utf8'); } catch { /* missing */ }
  if (onDisk !== wanted) {
    console.error(`${OUT} is not what ${SRC} generates. Run: node scripts/gen-project-type-module.mjs`);
    process.exit(1);
  }
  console.log(`${OUT} matches ${SRC}`);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(join(root, OUT), wanted);
  console.log(`wrote ${OUT} (${wanted.length} chars) from ${SRC}`);
}

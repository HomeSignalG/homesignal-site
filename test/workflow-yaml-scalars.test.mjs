// Workflow YAML — a step name containing ": " silently unregisters the workflow.
//
// The defect this pins is real and cost a merge: a step named
//   - name: B3 probe (read-only): source cardinality, CRS, payload size
// is not a string in YAML. A plain (unquoted) scalar cannot contain a colon
// followed by a space, so the parser reads it as a nested mapping key and the
// whole file fails to load. GitHub's response is not an error anywhere visible —
// it simply stops registering the workflow, and the dispatch API answers
// "Workflow does not have 'workflow_dispatch' trigger" for a file whose
// workflow_dispatch block is plainly there. The unit suite was green throughout,
// because nothing in it had ever looked at a workflow file.
//
// This is deliberately narrow: it checks the one construct that produced a
// success-shaped silence, across every committed workflow, rather than trying to
// be a YAML validator without a YAML parser.
//
// Run: node test/workflow-yaml-scalars.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, '.github', 'workflows');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

// A plain scalar is one that does not open with a quote. Inside quotes the colon
// is ordinary text, which is exactly the fix.
const OFFENDER = /^\s*(?:-\s*)?[A-Za-z0-9_-]+:\s+(?!['"|>&*])(.*: .*)$/;

function offendingLines(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return;                 // comments are not scalars
    const m = line.match(OFFENDER);
    if (!m) return;
    // A ' #' opens a comment on a plain scalar, and a comment's colon is text.
    const value = m[1].replace(/\s+#.*$/, '').trim();
    if (!/: /.test(value)) return;
    if (/^\$\{\{/.test(value)) return;              // ${{ ... }} expressions
    if (/^[{[]/.test(value)) return;                 // flow mapping / sequence
    if (/^https?:\/\//.test(value)) return;         // a URL's colon has no space after it
    out.push({ n: i + 1, line: line.trim() });
  });
  return out;
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
ok(files.length > 0, `found workflow files to check (${files.length})`);

let total = 0;
for (const f of files) {
  const bad = offendingLines(fs.readFileSync(path.join(dir, f), 'utf8'));
  total += bad.length;
  if (bad.length) {
    console.log(`  ${f}:`);
    bad.forEach((b) => console.log(`    line ${b.n}: ${b.line}`));
  }
}
ok(total === 0, `no unquoted YAML scalar contains ": " across ${files.length} workflow files`);

// The check is load-bearing, not scaffolding: it must FAIL on the exact line that
// caused the outage, and PASS once that line is quoted.
const broke = '      - name: B3 probe (read-only): source cardinality, CRS, payload size';
const fixed = "      - name: 'B3 probe (read-only): source cardinality, CRS, payload size'";
ok(offendingLines(broke).length === 1, 'the guard rejects the real defect line');
ok(offendingLines(fixed).length === 0, 'the guard accepts the quoted fix');
ok(offendingLines('        run: python3 scripts/x.py').length === 0, 'an ordinary run: line is not flagged');
// Over-flagging is how a gate becomes noise, so the three real shapes that a first
// draft wrongly rejected are pinned here too, verbatim from this repo's workflows.
ok(offendingLines('      issues: write       # its only write: the report issue').length === 0,
   'a colon inside a trailing comment is not flagged');
ok(offendingLines('    timeout-minutes: 5          # bounded: verify-geocodes burned 11 runs').length === 0,
   'a colon inside a comment on a numeric value is not flagged');
ok(offendingLines("        with: { node-version: '22' }").length === 0,
   'a flow mapping is not flagged');
ok(offendingLines("        if: ${{ github.event.inputs.mode == 'load' }}").length === 0,
   'a ${{ }} expression is not flagged');

console.log(fails === 0 ? '\nAll workflow-YAML scalar assertions passed.'
                        : `\n${fails} assertion(s) FAILED.`);
process.exit(fails === 0 ? 0 : 1);

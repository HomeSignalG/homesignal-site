// N5 shard-list parsing — regression guard, executed by the REQUIRED offline CI gate.
//
// The defect this guards against actually shipped. `Z3="062,063"` was passed to the
// driver on 2026-09-02 and interpreted as ONE shard literally named "062,063": the
// run logged `shards this run 1: 062,063`, found no manifest row for that id, and
// crashed with IndexError (run 33667890989). No durable state was written, but a
// dispatched national-build run was lost.
//
// It shipped because the fix was written, committed, and then discarded by a
// `git reset --hard origin/main` before a later commit — and PR #1008's description
// claimed the parsing had shipped when the merged tree did not contain it. A claim in
// a PR body is not a control; this file is.
//
// Why this is a .test.mjs that shells out to python3 rather than a python test: this
// repository's executed gate is `node scripts/run-unit-tests.mjs --offline`, which
// auto-discovers test/*.test.mjs. No workflow runs pytest, so a Python test here would
// never execute and would attest to nothing — the exact vacuous-invariant shape the
// runner's own --min-files floor exists to prevent.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Call the SHIPPED function, not a re-implementation of it. A copy of the parsing
// rules here would pass forever while the driver drifted.
const parse = (z3, max) => {
  const out = execFileSync('python3', [
    '-c',
    [
      'import sys, json',
      'sys.path.insert(0, sys.argv[1])',
      'from n5_shard import parse_shard_list',
      'print(json.dumps(parse_shard_list(sys.argv[2], int(sys.argv[3]))))',
    ].join('\n'),
    join(root, 'scripts'),
    z3,
    String(max),
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
};

let fails = 0;
const ok = (cond, name) => {
  if (!cond) { fails++; console.error('FAIL ' + name); } else { console.log('ok   ' + name); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), `${name} -> ${JSON.stringify(a)}`);

// The defect itself: two ids, never one literal.
eq(parse('062,063', 10), ['062', '063'], 'comma-separated input yields TWO shard ids');
ok(!parse('062,063', 10).includes('062,063'), 'the literal "062,063" is never a shard id');

// A single shard still works — this is how 520 and 062 were run.
eq(parse('062', 10), ['062'], 'a single id stays a single id');

// AUTO must stay a sentinel, not become a shard called "AUTO".
eq(parse('AUTO', 10), null, 'AUTO yields the pending-selection sentinel');
eq(parse('auto', 10), null, 'AUTO is case-insensitive');
eq(parse('  AUTO  ', 10), null, 'AUTO tolerates surrounding whitespace');

// Malformed input must not produce junk identifiers.
eq(parse(' 062 , 063 ', 10), ['062', '063'], 'whitespace around ids is stripped');
eq(parse('062,,063', 10), ['062', '063'], 'empty segments are dropped');
eq(parse('062,063,062', 10), ['062', '063'], 'duplicate ids are collapsed');
eq(parse('', 10), [], 'empty input selects nothing rather than a blank id');
eq(parse(',', 10), [], 'a bare comma selects nothing');

// MAX_SHARDS is a real bound on the list, not just on AUTO selection.
eq(parse('062,063,687', 2), ['062', '063'], 'max_shards truncates an explicit list');
eq(parse('062,063', 0), [], 'max_shards=0 selects nothing');

console.log(fails === 0 ? '\nn5 shard-list parsing: all checks passed'
                        : `\nn5 shard-list parsing: ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);

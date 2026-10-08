// QUEUE.md's ENTIRE JOB, per CLAUDE.md, is that it "must never drift from reality".
// It drifted twice, about itself, and both were found only because someone went looking:
//
//   · Fix 28 read "APPLIED TO THE DATABASE, PR OPEN … NOT MERGED, NOT DEPLOYED" for four days
//     after merging as c2273e8 (#1240). A pre-launch audit believed it and wrote up
//     "the repo and production describe different systems" as a launch-blocking risk.
//     The risk was not real; the stale entry was.
//   · "DATA CENTER TYPE ON MAPS … (branch, not merged)" outlived b8adc02 (#1221) the same way.
//
// "Keep the queue current" was already the instruction, in CLAUDE.md, in bold. An instruction
// is not a control. This is the control, and it is deliberately NARROW: it catches exactly the
// shape that occurred — an entry whose HEADING still claims in-flight state while the very
// files that entry cites are sitting on the branch.
//
// Scoped to the HEADING on purpose. A heading is where an entry declares its state; the body
// legitimately discusses being unmerged in the past tense, and a body scan would fire on the
// retraction text that records the drift.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

const q = readFileSync(join(root, 'QUEUE.md'), 'utf8');
const IN_FLIGHT = /🟡|PR OPEN|NOT MERGED|not merged|branch, not merged|NOT DEPLOYED/;
// Paths an entry cites. Restricted to the two trees that only exist once work has LANDED.
const PATH_RE = /\b((?:docs|test|lib|scripts)\/[A-Za-z0-9._\/-]+\.(?:sql|mjs|js|py|psv|json))\b/g;

const lines = q.split('\n');
const entries = [];
let cur = null;
for (const line of lines) {
  if (/^###\s/.test(line)) { cur = { heading: line, body: [] }; entries.push(cur); }
  else if (cur) cur.body.push(line);
}
ok(entries.length > 10, `QUEUE.md parsed into ${entries.length} entries (control: the scan has something to read)`);

const claimed = entries.filter((e) => IN_FLIGHT.test(e.heading));
const violations = [];
for (const e of claimed) {
  const cited = [...e.body.join('\n').matchAll(PATH_RE)].map((m) => m[1]);
  for (const f of new Set(cited)) {
    if (existsSync(join(root, f))) violations.push(`${e.heading.trim()}  ⟶  cites ${f}, which IS in the tree`);
  }
}
ok(violations.length === 0,
   violations.length
     ? `an entry still claims in-flight state while its own files have landed:\n    ${violations.join('\n    ')}`
     : `no entry claims in-flight state while citing files that have landed (${claimed.length} in-flight heading(s) checked)`);

// ---- the two historical cases, pinned by name so a revert is caught -------------------
ok(!/###.*FIX 28.*(PR OPEN|NOT MERGED)/i.test(q),
   'Fix 28 no longer claims PR OPEN / NOT MERGED in its heading');
ok(/`c2273e8`/.test(q) && /#1240/.test(q),
   '...and records the merge SHA and PR that settled it');
ok(!/###.*octagon now draws \(branch, not merged\)/.test(q),
   'the octagon entry no longer claims branch-not-merged in its heading');
ok(/`b8adc02`/.test(q) && /#1221/.test(q),
   '...and records ITS merge SHA and PR too');

// ---- the detector must be able to FIRE, or its zero means nothing --------------------
{
  const synthetic = { heading: '### 2026-01-01 — 🟡 SOMETHING: PR OPEN', body: ['see `docs/fix28-datacenter-zip-membership.sql`'] };
  const cited = [...synthetic.body.join('\n').matchAll(PATH_RE)].map((m) => m[1]);
  ok(IN_FLIGHT.test(synthetic.heading) && cited.length === 1 && existsSync(join(root, cited[0])),
     'CONTROL: the detector fires on a synthetic in-flight entry citing a landed file');
}
{
  const merged = { heading: '### 2026-01-01 — ✅ SOMETHING: MERGED', body: ['see `docs/fix28-datacenter-zip-membership.sql`'] };
  ok(!IN_FLIGHT.test(merged.heading),
     'CONTROL: ...and does NOT fire on the same body under a merged heading (no over-flagging)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

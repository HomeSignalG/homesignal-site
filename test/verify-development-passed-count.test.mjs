// The verify-development summary must never report a NEGATIVE "Passed" count.
//
// The old expression subtracted a count of failure MESSAGES from a count of PAGES:
//   reports.length + props.length - fails.length
// One page routinely emits several messages (assertZip alone can push shell +
// robots-substance + mislabeled for one ZIP), so on an unhealthy run the figure went
// negative. CLAUDE.md §5 records it doing exactly that, alongside the 28,263-failure run.
//
// This pins the REPLACEMENT's arithmetic against the real message shapes the producers emit.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

const src = readFileSync(join(root, 'scripts', 'verify-development.mjs'), 'utf8');

// ---- 1. the defective expression is gone --------------------------------------------------
// SCOPED TO EXECUTABLE CODE, deliberately. The fix's own comment QUOTES the old expression in
// order to explain why it was wrong, so a whole-file search finds it and the pin fails over
// its own documentation — CLAUDE.md's "a pin that names the string it forbids cannot also
// search the whole file for it". Strip comments first and assert against the statements.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
ok(!/reports\.length \+ props\.length - fails\.length/.test(code),
   'the message-minus-page expression is gone from the executable summary');
ok(/reports\.length \+ props\.length - fails\.length/.test(src),
   '...while the comment still records what it was and why it was wrong (control: the strip works)');
ok(/Math\.max\(0,/.test(src) && /passedPages/.test(src),
   'Passed is computed from a clamped page count');

// ---- 2. re-implement the shipped key fn and drive it with REAL message shapes --------------
const failedPageKey = (msg) => {
  let m = /^ZIP (\S+?):/.exec(msg);       if (m) return `zip:${m[1]}`;
  m = /^RUN-REPORT (\S+?)[: ]/.exec(msg); if (m) return `zip:${m[1]}`;
  m = /^ADDR (.+?):/.exec(msg);           if (m) return `addr:${m[1]}`;
  return null;
};
// Verbatim shapes from scripts/lib/verify-dev-helpers.mjs and verify-development.mjs.
const fails = [
  'ZIP 19350: new sidebar shell did not render (old layout?)',
  'ZIP 19350: robots="index, follow" (indexable=true) violates the substance gate (expected noindex; flag=true, sites=0)',
  'ZIP 19350: 3 record(s) whose label contradicts its dot colour [a, b, c] (stage/colour must agree)',
  'RUN-REPORT 19350: engine HTTP 500',
  'RUN-REPORT 19390 austin-zoning-cases: 2 record(s) with no derivable record_url',
  'ADDR 2200 CALDWELL LN, DEL VALLE, TX 78617: 1 rendered record(s) with NO record link (fabrication gate)',
  'ADDR 2200 CALDWELL LN, DEL VALLE, TX 78617: entity link with <2 evidence record_urls — "x…" (§4.5 invariant)',
  'TIME BUDGET: 40 ZIP(s) never checked — run is incomplete',
];
const failedPages = new Set(fails.map(failedPageKey).filter(Boolean)).size;
ok(failedPages === 3,
   `8 messages collapse to 3 distinct failed pages (19350, 19390, the address) — got ${failedPages}`);
ok(failedPageKey(fails[0]) === failedPageKey(fails[3]),
   'a ZIP failing BOTH the page phase and the run-report phase counts once, not twice');
ok(failedPageKey('TIME BUDGET: 40 ZIP(s) never checked — run is incomplete') === null,
   'TIME BUDGET names no page and is excluded — the clock running out never costs a page');

// ---- 3. THE REGRESSION ITSELF: the reported shape can no longer go negative ----------------
{
  const reports = 2, props = 1;                 // 3 pages checked
  const oldValue = reports + props - fails.length;   // the shipped bug: 3 - 8
  const newValue = Math.max(0, (reports + props) - failedPages);
  ok(oldValue < 0, `the OLD expression is negative on this input (${oldValue}) — the defect is real`);
  ok(newValue === 0, `the NEW expression is 0, not negative (${newValue})`);
}
{
  // A healthy run must still report the honest number, not a clamped zero.
  const reports = 100, props = 5;
  ok(Math.max(0, (reports + props) - 3) === 102, 'a healthy run still reports 102 of 105 passing');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

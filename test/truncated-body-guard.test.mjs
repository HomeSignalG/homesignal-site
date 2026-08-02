// Offline guard against the 2026-08-02 failure CLASS — no network, no DB.
//
// THE CLASS: Supabase rows in development_reports / property_reports carry their whole `sites`
// array, and the largest is ~19.6 MB. A large read can drop mid-stream, so the response arrives
// with status 200 and a TRUNCATED body, and an unguarded `await res.json()` throws
// "Unexpected end of JSON input" / "Unterminated string in JSON".
//
// It took down THREE scheduled verifiers, and it was invisible for as long as those jobs were
// being cancelled at the 6h cap before they ever reached the parse:
//   • verify-geocodes.mjs:179     — died in 1m39s, run 30762637599
//   • verify-development.mjs:82   — died in ~4min, scheduled run 2026-08-02
//   • verify-representative-zips  — same unguarded shape on a single-row read
//
// Every one of those scripts already had a retry ladder that knew how to react to "page too
// big" — it just only ever covered `!res.ok`. This suite pins the rule that a torn BODY is the
// same signal as a rejected REQUEST, so a future edit cannot quietly reintroduce it.
// Run: node scripts/run-unit-tests.mjs   (or: node test/truncated-body-guard.test.mjs)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? '\n     ' + detail : ''}`); }
};

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── 1. Every .json() on a `sites`-bearing read must sit inside a try, or route through a
// guarded helper. Asserted structurally against the SHIPPED sources, not a copy.
const FILES = [
  'scripts/verify-development.mjs',
  'scripts/verify-geocodes.mjs',
  'scripts/verify-representative-zips.mjs',
];

/** Is the `.json()` on this line lexically inside a try block? Brace-depth tracking, not a
 *  line window — the first version of this test used ±4 lines and produced three FALSE
 *  POSITIVES on calls that were correctly wrapped at function level. A guard that cries wolf
 *  gets deleted, so it has to be right. */
function unguardedJsonCalls(src, file) {
  const lines = src.split('\n');
  const offenders = [];
  let depth = 0;
  const tryDepths = [];                        // depth at which each open try-block started
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const code = ln.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    // A `.json()` on this line is guarded iff some try block is currently open.
    if (/await\s+\w+\.json\(\)/.test(code) && tryDepths.length === 0) {
      offenders.push(`${file}:${i + 1}  ${ln.trim()}`);
    }
    const opensTry = /\btry\s*\{/.test(code);
    for (const ch of code) {
      if (ch === '{') { depth++; if (opensTry && tryDepths[tryDepths.length - 1] !== depth) tryDepths.push(depth); }
      else if (ch === '}') { if (tryDepths[tryDepths.length - 1] === depth) tryDepths.pop(); depth--; }
    }
  }
  return offenders;
}

for (const f of FILES) {
  const offenders = unguardedJsonCalls(read(f), f);
  ok(`${f}: every await *.json() is inside a try/catch`,
    offenders.length === 0,
    offenders.join('\n     '));
}

// ── 1b. SELF-TEST — prove the detector can actually FAIL. A guard that has never fired is
// indistinguishable from a guard that cannot fire (CLAUDE.md: "an instrument must prove it ran
// before its silence counts as evidence"). Feed it both shapes and require the right verdict.
const UNGUARDED_FIXTURE = `
async function load(res) {
  if (!res.ok) return [];
  const page = await res.json();
  return page;
}`;
const GUARDED_FIXTURE = `
async function load(res) {
  if (!res.ok) return [];
  try {
    const page = await res.json();
    return page;
  } catch { return []; }
}`;
ok('1b.detector FLAGS an unguarded await res.json()',
  unguardedJsonCalls(UNGUARDED_FIXTURE, 'fixture').length === 1,
  JSON.stringify(unguardedJsonCalls(UNGUARDED_FIXTURE, 'fixture')));
ok('1b.detector PASSES a guarded await res.json()',
  unguardedJsonCalls(GUARDED_FIXTURE, 'fixture').length === 0,
  JSON.stringify(unguardedJsonCalls(GUARDED_FIXTURE, 'fixture')));

// ── 2. The reaction must be to SHRINK the page, not merely to log. The paged readers must
// halve `step` on a body failure exactly as they do on !res.ok — otherwise a torn body on a
// huge page retries forever at the same size.
for (const f of ['scripts/verify-development.mjs', 'scripts/verify-geocodes.mjs']) {
  const src = read(f);
  // The catch block that follows the paged parse must contain the halving expression.
  const m = src.match(/catch\s*\([^)]*\)\s*\{[\s\S]{0,400}?\}/g) || [];
  ok(`${f}: a body failure halves the page size (same ladder as !res.ok)`,
    m.some((blk) => /step\s*=\s*Math\.max\(1,\s*Math\.floor\(step\s*\/\s*2\)\)/.test(blk)),
    'no catch block halves `step`');
}

// ── 3. A torn body must never be mistaken for an EMPTY result. That is the dangerous shape:
// "0 rows" reads as a clean, healthy cache. The paged readers must not `break` or return []
// straight out of the catch.
for (const f of ['scripts/verify-development.mjs', 'scripts/verify-geocodes.mjs']) {
  const src = read(f);
  const blocks = (src.match(/catch\s*\([^)]*\)\s*\{[\s\S]{0,400}?\n    \}/g) || []).join('\n');
  ok(`${f}: no catch turns a torn body into an empty/complete result`,
    !/catch[\s\S]{0,200}?\breturn\s+rows\b/.test(src) && !/catch[\s\S]{0,200}?\bbreak\b/.test(blocks),
    'a catch returns the accumulated rows or breaks the loop — truncation would read as "done"');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

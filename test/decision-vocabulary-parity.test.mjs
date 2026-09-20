// test/decision-vocabulary-parity.test.mjs
//
// ONE CONTRACT, TWO COPIES, AND THIS IS THE GATE BETWEEN THEM.
//
// The decision-history authority is sources/decision.ts — a TypeScript module the engine
// imports. The browser cannot import it, so lib/map.js carries the page half: the same
// vocabulary, the same predicate, the same sentences. Two copies of one contract with no
// gate between them is exactly how they drift, and this repo has paid for that shape
// before (the meetings enrolment gate, where "widen both together" was an instruction for
// months and an instruction is not a control).
//
// So the two are DRIVEN, not read. Every assertion below calls both implementations with
// the same input and compares the answers — a comment that says they agree would go stale
// the first time one of them changed.
//
// Run: node test/decision-vocabulary-parity.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const E = await import(join(root, 'supabase/functions/get-address-report/sources/decision.ts'));

// Load the page half the way a browser does: evaluate the shipped file against a window.
const g = globalThis;
const prevWindow = g.window;
g.window = { HS: {} };
// lib/map.js hangs off window.HS and reads HS.statusHex from lib/templates.js when it is
// loaded first; both are plain scripts, so `new Function` is the faithful load.
new Function(readFileSync(join(root, 'lib/templates.js'), 'utf8')).call(g);
new Function(readFileSync(join(root, 'lib/map.js'), 'utf8')).call(g);
const P = g.window.HS;
if (prevWindow === undefined) delete g.window; else g.window = prevWindow;

ok(!!P && typeof P.isActiveUndecided === 'function',
  'lib/map.js loaded and exposes the decision authority (control — without this every check below is vacuous)');

// ── the vocabulary ───────────────────────────────────────────────────────────────
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(same(E.DECISION_OUTCOMES.slice(), P.DECISION_OUTCOMES),
  `outcome vocabulary matches: ${JSON.stringify(P.DECISION_OUTCOMES)}`,
  `engine ${JSON.stringify(E.DECISION_OUTCOMES)} vs page ${JSON.stringify(P.DECISION_OUTCOMES)}`);
ok(same(E.DECISION_LABELS, P.DECISION_LABELS),
  'resident-facing outcome LABELS match — the page must not invent a different word for a refusal',
  `engine ${JSON.stringify(E.DECISION_LABELS)} vs page ${JSON.stringify(P.DECISION_LABELS)}`);
ok(same(E.DECISION_EVIDENCE_LEVELS.slice(), P.DECISION_EVIDENCE_LEVELS),
  'evidence levels match');
ok(E.PROPOSED_INCLUDES_HISTORY_NOTE === P.PROPOSED_INCLUDES_HISTORY_NOTE,
  'the mixed-category disclosure is one sentence, not two');

// ── sourceCanReportDenial, over every level plus the junk cases ──────────────────
for (const lvl of [...E.DECISION_EVIDENCE_LEVELS, '', 'nonsense', null, undefined]) {
  ok(E.sourceCanReportDenial(lvl) === P.sourceCanReportDenial(lvl),
    `sourceCanReportDenial agrees on ${JSON.stringify(lvl)} (${E.sourceCanReportDenial(lvl)})`);
}

// ── isActiveUndecided, over the shapes each caller really passes ─────────────────
const dec = E.decisionFor({ bucket: 'denied', statusRaw: 'Denied', decisionDate: '2024-03-12',
  recordUrl: 'https://example.gov/c/1', urlPrecision: 'record' });
const ROWS = [
  { type: 'proposed' },
  { type: 'approved' },
  { type: 'built' },
  { bucket: 'proposed' },
  { status: 'Proposed' },
  { status: 'Decided' },
  { status: 'decided' },
  { type: 'proposed', decided: true },
  { type: 'proposed', decided: 'true' },
  { type: 'proposed', decision: dec },
  { type: 'proposed', decision: { outcome: 'withdrawn', source_url: 'u' } },
  // an unsourced or malformed decision object must be treated the same by both
  { type: 'proposed', decision: { outcome: 'denied' } },
  { type: 'proposed', decision: { outcome: 'nonsense', source_url: 'u' } },
  { type: 'proposed', decision: {} },
  {},
  null,
];
let mismatch = 0;
for (const r of ROWS) {
  const a = E.isActiveUndecided(r), b = P.isActiveUndecided(r);
  if (a !== b) { mismatch++; console.log(`     MISMATCH ${JSON.stringify(r)} engine=${a} page=${b}`); }
}
ok(mismatch === 0, `isActiveUndecided agrees on all ${ROWS.length} row shapes`);
// A predicate that answered the same for everything would also score zero mismatches.
ok(ROWS.some((r) => E.isActiveUndecided(r)) && ROWS.some((r) => !E.isActiveUndecided(r)),
  'and the fixture set genuinely splits — both answers occur, so the agreement is not vacuous');

// ── the sentences, which are what a resident actually reads ──────────────────────
const SUBJECTS = [null, '', 'Conditional-use application', 'Subdivision application'];
const DECS = [
  dec,
  E.decisionFor({ bucket: 'denied', statusRaw: 'Denied', decisionDate: null, recordUrl: 'u' }),
  E.decisionFor({ bucket: 'withdrawn', statusRaw: 'Withdrawn', decisionDate: '2023-11-01', recordUrl: 'u' }),
  E.decisionFor({ bucket: 'denied', statusRaw: 'Denied', decisionDate: null, recordUrl: 'u', basis: 'title_text' }),
  null,
];
let noteMismatch = 0;
for (const d of DECS) for (const s of SUBJECTS) {
  const a = E.decisionNotation(d, s), b = P.decisionNotation(d, s);
  if (a !== b) { noteMismatch++; console.log(`     MISMATCH notation\n       engine: ${a}\n       page:   ${b}`); }
}
ok(noteMismatch === 0, `decisionNotation agrees on all ${DECS.length * SUBJECTS.length} combinations`);

let lineMismatch = 0;
for (const d of DECS) for (const lvl of E.DECISION_EVIDENCE_LEVELS) {
  const a = E.currentStatusLine(d, lvl), b = P.currentStatusLine(d, lvl);
  if (a !== b) { lineMismatch++; console.log(`     MISMATCH line (${lvl})\n       engine: ${a}\n       page:   ${b}`); }
}
ok(lineMismatch === 0, `currentStatusLine agrees on all ${DECS.length * E.DECISION_EVIDENCE_LEVELS.length} combinations`);

// ── the page's own extras, which have no engine twin and so are pinned here ──────
ok(P.decisionOf({ decision: dec }) === dec, 'HS.decisionOf returns a well-formed decision');
ok(P.decisionOf({ decision: { outcome: 'denied' } }) === null,
  'HS.decisionOf refuses an UNSOURCED decision — the page never renders a notation with nothing to link to');
ok(P.decisionOf({ decision: { outcome: 'sideways', source_url: 'u' } }) === null,
  'HS.decisionOf refuses an outcome outside the vocabulary');
ok(P.decisionOf({}) === null && P.decisionOf(null) === null, 'and no decision is not a decision');
ok(P.activeUndecidedCount([{ type: 'proposed' }, { type: 'proposed', decision: dec }, { type: 'approved' }]) === 1,
  'HS.activeUndecidedCount counts only the live proposal — the browsing rail holds 2, the count says 1');
ok(P.proposedRailNote([{ type: 'proposed' }]) === '',
  'the mixed-category disclosure is silent when the rail holds no decided record');
ok(P.proposedRailNote([{ type: 'proposed' }, { type: 'proposed', decision: dec }]) === P.PROPOSED_INCLUDES_HISTORY_NOTE,
  'and appears the moment one is present');

// ── the pin must not move. A decision ANNOTATES a marker; it never re-buckets one ──
{
  const base = { type: 'Data center', use_type: 'Data center', status: 'Proposed', label: 'X' };
  const a = P.resolveMarker(base);
  const b = P.resolveMarker({ ...base, decision: dec, decision_evidence: 'decision' });
  ok(a.shape === b.shape && a.color === b.color && a.filterKey === b.filterKey
     && JSON.stringify(a.categories) === JSON.stringify(b.categories) && a.lifecycle === b.lifecycle,
    'a decided record keeps its Proposed shape, colour, filter bucket and categories — the decision is text, never the pin',
    `${JSON.stringify({ shape: a.shape, color: a.color, filterKey: a.filterKey })} vs ${JSON.stringify({ shape: b.shape, color: b.color, filterKey: b.filterKey })}`);
  ok(b.decision === dec && b.isActiveUndecided === false,
    'and the marker carries the decision plane so every surface reads one resolved answer');
  ok(a.isActiveUndecided === true, 'while the undecided twin stays eligible (control)');
}

// ── the structural pin: statusTier must never learn to read a decision ───────────
{
  const src = readFileSync(join(root, 'lib/map.js'), 'utf8');
  const i = src.indexOf('function statusTier(item)');
  ok(i > 0, 'statusTier found in lib/map.js (control)');
  const body = src.slice(i, src.indexOf('\n  }', i));
  ok(!/decision|decided/i.test(body),
    'statusTier reads NO decision field — the moment it does, a denied application leaves the '
    + 'Proposed rail a resident searches, which is the defect this whole unit replaced');
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll decision-vocabulary parity checks passed.');
process.exit(fails ? 1 : 0);

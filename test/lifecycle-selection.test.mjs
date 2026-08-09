// Pins the removal of the last two hidden dependencies on the lifecycle-only
// impact_score (2026-08-09):
//   * which record a surface FEATURES  (was max(impact_score))
//   * how the development list SORTS   (was order by impact_score desc, key 'impact')
// Both now read sourced fields only. The numeric score stays suppressed.
// Run: node --test test/lifecycle-selection.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/impact.js');
await import('../lib/view-zip.js');
const HS = global.window.HS;

// ── featured selection ──────────────────────────────────────────────────────
test('the featured record is the most recently filed, never the highest score', () => {
  // impact_score is deliberately INVERTED against submitted_at here: if the old rule
  // survived anywhere, it would pick the oldest record.
  const projects = [
    { id: 'a', name: 'Oldest but top score',  submitted_at: '2024-01-01', impact_score: 99 },
    { id: 'b', name: 'Newest, lowest score',  submitted_at: '2026-07-24', impact_score: 1 },
    { id: 'c', name: 'Middle',                submitted_at: '2025-05-05', impact_score: 72 }
  ];
  assert.strictEqual(HS.featuredProject(projects).id, 'b', 'newest filing wins');
  // and the score genuinely plays no part: strip it and nothing moves
  const scoreless = projects.map(p => ({ id: p.id, name: p.name, submitted_at: p.submitted_at }));
  assert.strictEqual(HS.featuredProject(scoreless).id, 'b');
});

test('featured selection is deterministic and safe on missing dates', () => {
  const undated = [{ id: 'z' }, { id: 'a' }, { id: 'm' }];
  assert.strictEqual(HS.featuredProject(undated).id, 'a', 'all undated -> stable id order');
  // a dated record always beats an undated one
  assert.strictEqual(HS.featuredProject([{ id: 'z', submitted_at: '2020-01-01' }, { id: 'a' }]).id, 'z');
  // same date -> id decides, and repeat calls agree
  const tie = [{ id: 'b', submitted_at: '2026-01-01' }, { id: 'a', submitted_at: '2026-01-01' }];
  assert.strictEqual(HS.featuredProject(tie).id, 'a');
  assert.strictEqual(HS.featuredProject(tie).id, HS.featuredProject(tie.slice().reverse()).id,
    'input order does not change the winner');
  // empty / rubbish input -> null, so the caller renders an honest empty state
  for (const bad of [[], null, undefined, 'nope', [null, undefined]]) {
    assert.strictEqual(HS.featuredProject(bad), null, JSON.stringify(bad));
  }
});

test('no surface still selects a record by impact_score', () => {
  const reports = readFileSync(new URL('../reports.html', import.meta.url), 'utf8');
  // the only permitted mention is the historical note explaining what was removed
  const live = reports.split('\n').filter(l => /impact_score/.test(l) && !/^\s*\/\//.test(l.trim()));
  assert.deepStrictEqual(live, [], 'reports.html has no live impact_score read:\n' + live.join('\n'));
  assert.doesNotMatch(reports, /flagship\s*=/, 'the flagship variable is gone');
  assert.match(reports, /HS\.featuredProject\(projects\)/, 'it uses the shared rule');
  assert.match(reports, /Recent Development/, 'the label states what the rule establishes');
  // comment lines are excluded: the note explaining what was removed quotes the string
  const liveModel = reports.split('\n')
    .filter(l => /HomeSignal impact model/.test(l) && !/^\s*\/\//.test(l.trim()));
  assert.deepStrictEqual(liveModel, [], 'no model is claimed in rendered output');
});

// ── lifecycle sort ──────────────────────────────────────────────────────────
test('the sort key is lifecycle, with the old names kept as aliases', () => {
  assert.strictEqual(HS.sanitizeSort('lifecycle'), 'lifecycle');
  assert.strictEqual(HS.sanitizeSort('stage'), 'lifecycle');
  // legacy deep links must keep working rather than 404 into a default
  assert.strictEqual(HS.sanitizeSort('impact'), 'lifecycle', '?sort=impact still resolves');
  assert.strictEqual(HS.sanitizeSort('status'), 'lifecycle', '?sort=status still resolves');
  assert.strictEqual(HS.sanitizeSort('distance'), 'distance');
  assert.strictEqual(HS.sanitizeSort('newest'), 'newest');
  for (const junk of ['', null, undefined, 'score', 'impact_score', '__proto__']) {
    assert.strictEqual(HS.sanitizeSort(junk), 'lifecycle', 'junk falls back: ' + junk);
  }
});

test('lifecycle ordering is explicit, deterministic, and score-free', () => {
  const rank = HS.devStatusSortRank;
  // the documented order, asserted as a strictly non-decreasing sequence
  const order = ['Proposed', 'On file', 'Decided', 'Approved', 'Active', 'Operating', 'Built'];
  const ranks = order.map(s => rank({ status: s }));
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i] >= ranks[i - 1], order[i - 1] + ' -> ' + order[i] + ' must not go backwards');
  }
  assert.strictEqual(rank({ status: 'Proposed' }), 0);
  assert.strictEqual(rank({ status: 'On file' }), 0, 'unstated lifecycle sorts with the earliest');
  assert.strictEqual(rank({ status: 'Approved' }), 2);
  assert.strictEqual(rank({ status: 'Operating' }), 4);
  assert.ok(rank({ status: 'Proposed' }) < rank({ status: 'Operating' }), 'earliest first');
  // a Proposed record whose STAGE says review sub-ranks after plain Proposed
  assert.strictEqual(rank({ status: 'Proposed', stage: 'In Review' }), 1);
  assert.ok(rank({ status: 'Proposed', stage: 'In Review' }) > rank({ status: 'Proposed' }));

  // the score is not consulted: a wildly different score cannot move a record
  assert.strictEqual(rank({ status: 'Proposed', impact_score: 1 }),
                     rank({ status: 'Proposed', impact_score: 99 }));
  assert.strictEqual(rank({ status: 'Operating', impact_score: 100 }), 4);
});

test('unknown or missing lifecycle values sort last without throwing', () => {
  const rank = HS.devStatusSortRank;
  for (const bad of [{}, { status: null }, { status: '' }, { status: 'Zorp' }, { status: 42 }, null, undefined]) {
    const r = rank(bad);
    assert.strictEqual(typeof r, 'number', 'numeric rank for ' + JSON.stringify(bad));
    assert.ok(!isNaN(r));
    assert.strictEqual(r, 5, 'unrecognised sorts last, never silently ranked as a real stage');
  }
  assert.strictEqual(rank({ status: 'Operating' }) < rank({}), true, 'known beats unknown');
});

test('a full sort is stable and reproducible', () => {
  const rows = [
    { id: '1', status: 'Operating' }, { id: '2', status: 'Proposed' },
    { id: '3', status: 'Approved' },  { id: '4', status: 'Proposed' },
    { id: '5', status: 'Zorp' },      { id: '6', status: 'Proposed', stage: 'In Review' }
  ];
  const run = () => rows.slice().sort((a, b) => HS.devStatusSortRank(a) - HS.devStatusSortRank(b))
    .map(r => r.id).join('');
  assert.strictEqual(run(), '246315');
  assert.strictEqual(run(), run(), 'repeatable');
});

test('development.html sorts on lifecycle and never on the score', () => {
  const page = readFileSync(new URL('../development.html', import.meta.url), 'utf8');
  // impact_score may survive ONLY inside the suppression gate (the table cell that is
  // rendered when showScore is true). Any other live read is a regression.
  const live = page.split('\n')
    .filter(l => /impact_score/.test(l) && !/^\s*\/\//.test(l.trim()));
  const ungated = live.filter(l => !/showScore \?/.test(l));
  assert.deepStrictEqual(ungated, [], 'no ungated impact_score read remains:\n' + ungated.join('\n'));
  assert.doesNotMatch(page, /sort\([^)]*impact_score/, 'no sort comparator reads the score');
  assert.match(page, /seg\('lifecycle','Lifecycle stage'\)/, 'one lifecycle control');
  assert.doesNotMatch(page, /seg\('impact'/, "the 'impact' button is gone");
  const liveLabel = page.split('\n')
    .filter(l => /Impact on me/.test(l) && !/^\s*\/\//.test(l.trim()));
  assert.deepStrictEqual(liveLabel, [], 'the "Impact on me" label is gone from rendered output');
});

// ── card copy ───────────────────────────────────────────────────────────────
test('a summary that only repeats the lens line is dropped', () => {
  const dup = { type: 'Development', status: 'Proposed',
                sowhat: 'Development · proposed', sowhat_factual: true };
  assert.strictEqual(HS.tpl.summaryAddsNothing(dup), true);
});

test('a summary carrying any further fact is kept', () => {
  const keep = [
    { type: 'industrial', status: 'Active', sowhat_factual: true,
      sowhat: 'industrial · active · 112,000 sq ft · $14,700,000 — Neuralink' },
    { type: 'industrial', status: 'Active', sowhat_factual: false,
      sowhat: 'New 3-story building with offices, machine shop and cleanroom.' },
    { type: 'Development', status: 'Proposed', sowhat_factual: true,
      sowhat: 'Development · proposed — Landco LLC' }
  ];
  for (const p of keep) {
    assert.strictEqual(HS.tpl.summaryAddsNothing(p), false, p.sowhat);
  }
  // and a missing summary is never "redundant" — there is nothing to drop
  assert.strictEqual(HS.tpl.summaryAddsNothing({ sowhat_factual: true }), false);
  assert.strictEqual(HS.tpl.summaryAddsNothing(null), false);
});

test('the maps card only drops the caption through that helper', () => {
  const page = readFileSync(new URL('../maps.html', import.meta.url), 'utf8');
  assert.match(page, /HS\.tpl\.summaryAddsNothing\(it\)\s*\?\s*''/, 'guarded, not deleted');
});

// ── conservative head nouns ─────────────────────────────────────────────────
test('activity categories take a neutral head noun, inventing nothing', () => {
  const say = p => HS.projectImpact(p);
  assert.match(say({ type: 'research', status: 'Active' }), /An operating research facility/);
  assert.doesNotMatch(say({ type: 'research', status: 'Active' }), /research development/);
  // a slashed pair quotes the first word rather than gluing both together
  assert.match(say({ type: 'Civic/Public', status: 'Proposed' }), /A proposed civic project/);
  assert.doesNotMatch(say({ type: 'Civic/Public', status: 'Proposed' }), /civic public/);
  // nothing is promoted to a specific building type the source never named
  for (const t of ['research', 'Civic/Public', 'industrial', 'commercial']) {
    assert.doesNotMatch(say({ type: t, status: 'Proposed' }),
      /laborator|factory|data center|school|hospital/i, t);
  }
  // the categories that already read correctly are untouched
  assert.match(say({ type: 'industrial', status: 'Proposed' }), /A proposed industrial development/);
  assert.match(say({ type: 'Commercial', status: 'Approved' }), /An approved commercial development/);
});

test('every real 78617 type produces clean copy', () => {
  // the complete distinct vocabulary for the pilot ZIP, measured 2026-08-09
  const types = ['unclassified', 'Commercial', 'Residential', 'Development', 'Utility',
                 'industrial', 'Civic/Public', 'Industrial', 'energy', 'logistics',
                 'commercial', 'animal-facility', 'research'];
  for (const type of types) {
    for (const rec of [{ type, status: 'Proposed' },
                       { type, status: 'Operating', record_kind: 'facility' }]) {
      const s = HS.projectImpact(rec);
      assert.doesNotMatch(s, /\bA (a|e|i|o)[a-z]/, 'article: ' + s);
      assert.doesNotMatch(s, /\bAn [bcdfgjklmnpqrstvwxyz]/, 'article: ' + s);
      assert.doesNotMatch(s, /facility facility|development development|project project/, s);
      assert.doesNotMatch(s, /\s{2,}/, 'double space: ' + s);
      assert.match(s, /^[A-Z].*\.$/, s);
    }
  }
});

// ── the score stays suppressed ──────────────────────────────────────────────
test('the lifecycle-only numeric score is still not displayable', () => {
  assert.strictEqual(HS.impactScoreDisplayable(), false);
  assert.strictEqual(HS.impactScoreValue(72), '');
  assert.strictEqual(HS.tpl.impactScoreLine({ impact_score: 72 }), '');
  assert.strictEqual(HS.impactScoreRaw(72), '72 | High', 'computation still preserved');
});

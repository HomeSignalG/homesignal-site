// Pins HS.recentChanges (lib/map-events.js) — the "What's Changed" derivation behind
// the maps.html view toggle. Every assertion is an ANTI-FABRICATION gate: a
// change entry may exist only when a record carries a real in-window date, and
// the badge vocabulary never exceeds what the data can prove (no APPROVED /
// CONSTRUCTION without status-transition history).
// Run: node --test test/recent-changes.test.mjs
import test from 'node:test';
import assert from 'node:assert';

global.window = { HS: {} };
await import('../lib/templates.js');   // fmtDate
await import('../lib/map-events.js');
const HS = global.window.HS;

const NOW = '2026-07-18T12:00:00Z';
const d = n => new Date(Date.parse(NOW) - n * 86400000).toISOString().slice(0, 10);
const run = (p, c, m) => HS.recentChanges(p || [], c || [], m || [], { days: 30, now: NOW });

test('recent-changes derivation is evidence-gated', () => {
  // NEW: only from a real in-window filing date
  let r = run([{ id: 'p1', submitted_at: d(5) }]);
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0].badges, ['NEW']);
  assert.match(r[0].lines[0], /^Filed with the county /, 'NEW is labeled as the filing date, not "added"');
  assert.strictEqual(run([{ id: 'p2', submitted_at: d(40) }]).length, 0, 'out-of-window filing -> no entry');
  assert.strictEqual(run([{ id: 'p3' }]).length, 0, 'no filing date -> NEVER "NEW"');
  assert.strictEqual(run([{ id: 'p4', submitted_at: d(-3) }]).length, 0, 'future-dated filing -> not claimed');

  // HEARING: only an UPCOMING matched hearing
  r = run([{ id: 'p5', submitted_at: d(90) }], [], [{ related_project_id: 'p5', starts_at: d(-10) }]);
  assert.deepStrictEqual(r[0] && r[0].badges, ['HEARING'], 'old filing + future hearing -> HEARING only');
  assert.strictEqual(run([{ id: 'p6' }], [], [{ related_project_id: 'p6', starts_at: d(4) }]).length, 0,
    'a PAST hearing never creates a change entry');
  // both: NEW + HEARING on one entry
  r = run([{ id: 'p7', submitted_at: d(2) }], [], [{ related_project_id: 'p7', starts_at: d(-6) }]);
  assert.deepStrictEqual(r[0].badges, ['NEW', 'HEARING']);

  // UPDATE: only a real recorded notice in-window; quiet excluded; window line only while open
  r = run([], [{ id: 'c1', occurred_at: d(3), window_closes_at: d(-1) }]);
  assert.deepStrictEqual(r[0].badges, ['UPDATE']);
  assert.match(r[0].lines[0], /^Recorded /);
  assert.match(r[0].lines[1], /^Comment window closes /);
  r = run([], [{ id: 'c2', occurred_at: d(3), window_closes_at: d(2) }]);
  assert.strictEqual(r[0].lines.length, 1, 'a CLOSED window is not offered as open');
  assert.strictEqual(run([], [{ id: 'c3', occurred_at: d(3), quiet: true }]).length, 0, 'quiet records excluded');
  assert.strictEqual(run([], [{ id: 'c4', occurred_at: d(45) }]).length, 0, 'out-of-window notice excluded');
  assert.strictEqual(run([], [{ id: 'c5' }]).length, 0, 'no recorded date -> no entry');

  // vocabulary: APPROVED/CONSTRUCTION can never appear (no transition history exists)
  const big = run(
    [{ id: 'p8', submitted_at: d(1), status: 'Approved' }, { id: 'p9', submitted_at: d(2), status: 'Active' }],
    [{ id: 'c6', occurred_at: d(1) }],
    [{ related_project_id: 'p8', starts_at: d(-2) }]);
  const vocab = new Set(big.flatMap(e => e.badges));
  assert.ok([...vocab].every(b => ['NEW', 'HEARING', 'UPDATE'].includes(b)),
    'badge vocabulary is exactly NEW/HEARING/UPDATE — a status alone never claims a transition');

  // ordering: actionable hearings first (soonest first), then newest
  const ord = run(
    [{ id: 'a', submitted_at: d(9) }, { id: 'b', submitted_at: d(1) }, { id: 'h', submitted_at: d(20) }],
    [], [{ related_project_id: 'h', starts_at: d(-5) }]);
  assert.strictEqual(ord[0].id, 'h', 'hearing entry sorts first');
  assert.strictEqual(ord[1].id, 'b', 'then newest filing');

  console.log('All what’s-changed gates hold.');
});

test('recent-changes dedupes by source identity, not title; folds related changes', () => {
  const changes = [
    { id: 'm1', title: 'Public meeting — Commissioners Court Voting Session', occurred_at: d(0), window_closes_at: d(-1),
      source_ref: 'https://portal.example/events/101' },
    { id: 'm2', title: 'Public meeting — Commissioners Court Voting Session', occurred_at: d(0), window_closes_at: d(-3),
      source_ref: 'https://portal.example/events/102' },
    { id: 'm3', title: 'Public meeting — Commissioners Court Work Session', occurred_at: d(0), window_closes_at: d(-5),
      source_ref: 'https://portal.example/events/201' }
  ];
  const r = run([], changes);
  assert.strictEqual(r.length, 3, 'separate meeting occurrences stay separate cards');
  const voting = r.filter((e) => /voting session/i.test(e.item.title));
  assert.strictEqual(voting.length, 2, 'two distinct voting-session occurrences');

  const folded = run(
    [{ id: 'p1', submitted_at: d(2) }],
    [{ id: 'c1', related_project_id: 'p1', occurred_at: d(1), title: 'County notice', source_ref: 'https://n/1' }]);
  assert.strictEqual(folded.length, 1, 'related change folds into its project');
  assert.ok(folded[0].badges.includes('NEW') && folded[0].badges.includes('UPDATE'));
});

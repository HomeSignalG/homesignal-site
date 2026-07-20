// Event identity + normalization backbone (lib/map-events.js).
// Run: node --test test/map-events.test.mjs
import test from 'node:test';
import assert from 'node:assert';

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map-events.js');
const HS = global.window.HS;

const NOW = '2026-07-18T12:00:00Z';
const d = (n) => new Date(Date.parse(NOW) - n * 86400000).toISOString().slice(0, 10);

test('sourceRecordId prefers official URL over row id', () => {
  assert.strictEqual(HS.sourceRecordId({ id: 'x', source_ref: 'https://a/b' }), 'https://a/b');
  assert.strictEqual(HS.sourceRecordId({ id: 'x' }), 'x');
});

test('canonicalEventId uses dedupe_key and source_ref', () => {
  assert.strictEqual(HS.canonicalEventId({ dedupe_key: 'abc' }), 'dedupe:abc');
  assert.strictEqual(HS.canonicalEventId({ source_ref: 'https://evt/1' }), 'src:https://evt/1');
});

test('same source_ref dedupes; separate occurrences with same title stay separate', () => {
  const changes = [
    { id: 'c1', title: 'Public meeting — Commissioners Court Voting Session', occurred_at: d(1),
      source_ref: 'https://portal.example/events/101', window_closes_at: d(-1) },
    { id: 'c2', title: 'Public meeting — Commissioners Court Voting Session', occurred_at: d(1),
      source_ref: 'https://portal.example/events/102', window_closes_at: d(-3) },
    { id: 'c3', title: 'Public meeting — Commissioners Court Voting Session', occurred_at: d(1),
      source_ref: 'https://portal.example/events/101', window_closes_at: d(-1) }
  ];
  const r = HS.recentChanges([], changes, [], { days: 30, now: NOW });
  assert.strictEqual(r.length, 2, 'identical source_ref collapses; different URLs stay separate');
  assert.strictEqual(r._counts.rawChangeRecords, 3);
  assert.strictEqual(r._counts.displayCards, 2);
  assert.strictEqual(r._counts.uniqueEvents, 2);
});

test('same-title meetings on different dates remain separate', () => {
  const changes = [
    { id: 'a', title: 'Public meeting — Board', occurred_at: d(2), source_ref: 'https://x/a', window_closes_at: d(-10) },
    { id: 'b', title: 'Public meeting — Board', occurred_at: d(2), source_ref: 'https://x/b', window_closes_at: d(-20) }
  ];
  const r = HS.recentChanges([], changes, [], { days: 30, now: NOW });
  assert.strictEqual(r.length, 2);
});

test('normalizeMapItem disambiguates title with close date', () => {
  const n = HS.normalizeMapItem({
    id: '1', title: 'Public meeting — Court', window_closes_at: '2026-08-01'
  }, 'change');
  assert.match(n.title, /Aug/);
  assert.ok(n.eventId);
  assert.ok(n.seriesId);
});

test('recentChangesCountLine explains raw vs display counts', () => {
  const changes = [
    { id: 'c1', occurred_at: d(1), source_ref: 'https://a/1' },
    { id: 'c2', occurred_at: d(1), source_ref: 'https://a/2' },
    { id: 'c3', occurred_at: d(1), source_ref: 'https://a/1' }
  ];
  const r = HS.recentChanges([], changes, [], { days: 30, now: NOW });
  const line = HS.recentChangesCountLine(r, 'Del Valle', 30);
  assert.match(line, /2 upcoming/);
  assert.match(line, /3 recorded/);
});

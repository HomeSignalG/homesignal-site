// An unreachable entry is NOT a clean entry.
//
// The drift check reported `unreachable: 3` in its section header and named nobody. Every other
// finding class prints its registry_id; unreachables were only counted. For those 3 entries
// "could not be read" was indistinguishable from "read and found nothing wrong" in every
// downstream consumer — so a green nightly run stayed compatible with 3 entries never having
// been read at all. That is the exact failure the drift check exists to prevent, reproduced
// inside the drift check.
//
// These assertions pin the naming, not the counting: a count that goes up is not the fix.

import test from 'node:test';
import assert from 'node:assert/strict';
import { unreachableRows } from '../scripts/lib/status-drift.mjs';

// Shape mirrors what statusDomainDrift() pushes, including the two DISTINCT failure paths that
// were previously collapsed into one unlabelled flag.
const DRIFT = [
  { registry_id: 'clean-entry', family: 'socrata', field: 'status', unreachable: false, inWindow: [], outWindow: [] },
  {
    registry_id: 'shelby-county-building-permits',
    family: 'opendatasoft',
    field: 'status',
    unreachable: true,
    unreachableReason: 'in-window status read returned null (opendatasoft reader could not resolve a status domain)',
  },
  {
    registry_id: 'some-arcgis-entry',
    family: 'arcgis',
    field: 'STATUS',
    unreachable: true,
    unreachableReason: 'arcgis returnDistinctValues confirmation returned null — groupBy counts cannot be trusted verbatim without it',
  },
  // Defensive: an unreachable pushed without a reason must still be NAMED, never dropped.
  { registry_id: 'reasonless-entry', unreachable: true },
];

test('every unreachable entry is named, and clean entries are not', () => {
  const rows = unreachableRows(DRIFT);
  assert.equal(rows.length, 3, 'all three unreachables surface');
  const ids = rows.map((r) => r.registry_id);
  assert.ok(ids.includes('shelby-county-building-permits'));
  assert.ok(ids.includes('some-arcgis-entry'));
  assert.ok(ids.includes('reasonless-entry'));
  assert.ok(!ids.includes('clean-entry'), 'a reachable entry is never listed as unreachable');
});

test('the two distinct failure paths keep distinct reasons', () => {
  const rows = unreachableRows(DRIFT);
  const shelby = rows.find((r) => r.registry_id === 'shelby-county-building-permits');
  const arc = rows.find((r) => r.registry_id === 'some-arcgis-entry');
  assert.match(shelby.reason, /returned null/);
  assert.match(arc.reason, /returnDistinctValues/);
  assert.notEqual(shelby.reason, arc.reason,
    'the read-failed and confirmation-failed paths must not collapse into one message');
});

test('a missing reason is REPORTED, not silently blanked', () => {
  const rows = unreachableRows(DRIFT);
  const r = rows.find((x) => x.registry_id === 'reasonless-entry');
  assert.equal(r.reason, 'reader returned null; no reason captured');
  assert.notEqual(r.reason.trim(), '', 'an empty cell would read as "nothing wrong here"');
  assert.equal(r.family, '—');
  assert.equal(r.field, '—');
});

test('no unreachables yields no rows — the count and the table agree', () => {
  assert.deepEqual(unreachableRows([{ registry_id: 'a', unreachable: false }]), []);
  assert.deepEqual(unreachableRows([]), []);
  assert.deepEqual(unreachableRows(null), []);
});

test('the naming is what changed — a count alone would have passed the old code', () => {
  // The pre-fix report had exactly this information available and printed only its length.
  const rows = unreachableRows(DRIFT);
  assert.equal(rows.length, DRIFT.filter((d) => d.unreachable).length,
    'count still agrees with the table');
  for (const r of rows) {
    assert.ok(r.registry_id, 'every row carries an identity, which the count never did');
    assert.ok(r.reason && r.reason.length > 10, 'every row carries an actionable reason');
  }
});

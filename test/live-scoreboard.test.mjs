// The scoreboard's job is to rank work. Its failure mode is ranking work that cannot be done —
// which is exactly what happened when blank workbook research rows read as "needs completing"
// instead of "never wired". These assertions pin the three-state distinction and the blockers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entryCompleteness, coversZip, scoreStates, rankRegistryWork, rankDiscoveryWork,
  isFloorSource, LIVE_THRESHOLD,
} from '../scripts/lib/live-scoreboard-core.mjs';

const zips = (state, n, county = 'X') =>
  Array.from({ length: n }, (_, i) => ({ zip: `${state}${i}`, state, county }));

test('BOTH maps are required — one alone is not complete', () => {
  assert.equal(entryCompleteness({ status_to_bucket: { approved: ['Issued'] }, type_map: { A: 'Residential' } }).complete, true);
  assert.deepEqual(entryCompleteness({ status_to_bucket: { approved: ['Issued'] } }).missing, ['type_map']);
  assert.deepEqual(entryCompleteness({ type_map: { A: 'Residential' } }).missing, ['status_to_bucket']);
  assert.deepEqual(entryCompleteness({}).missing.sort(), ['status_to_bucket', 'type_map']);
});

test('an empty map is INCOMPLETE, not complete-by-existing', () => {
  // proposed:[] with every other bucket empty is the San Diego pre-fix shape.
  assert.equal(entryCompleteness({ status_to_bucket: { proposed: [] }, type_map: {} }).complete, false);
});

test('status_const satisfies COLOR — the Detroit issuance-ledger precedent', () => {
  const e = { status_const: 'approved', type_map: { A: 'Residential' } };
  assert.equal(entryCompleteness(e).complete, true,
    'an entry with no status column is correctly wired, not broken');
});

test('EPA-FRS is tracked but never counts toward Live (row 272)', () => {
  assert.ok(isFloorSource('epa-frs'));
  const entries = [{ registry_id: 'epa-frs', coverage: [{ state: 'NH' }], status_to_bucket: { a: ['x'] }, type_map: { t: 'u' } }];
  const [nh] = scoreStates(entries, zips('NH', 10));
  assert.equal(nh.covered_complete, 0, 'the facilities floor must not make a state Live');
  assert.equal(nh.live, false);
});

test('statewide coverage (no county) covers every ZIP in the state; county-scoped does not', () => {
  const statewide = { registry_id: 's', coverage: [{ state: 'DE' }] };
  const scoped = { registry_id: 'c', coverage: [{ state: 'DE', county: 'Kent' }] };
  assert.ok(coversZip(statewide, { state: 'DE', county: 'Kent' }));
  assert.ok(coversZip(statewide, { state: 'DE', county: 'Sussex' }));
  assert.ok(coversZip(scoped, { state: 'DE', county: 'Kent' }));
  assert.equal(coversZip(scoped, { state: 'DE', county: 'Sussex' }), false);
});

test('90% is the threshold, measured on ZIP PAGES', () => {
  const e = { registry_id: 'x', coverage: [{ state: 'ZZ', county: 'A' }], status_to_bucket: { a: ['x'] }, type_map: { t: 'u' } };
  const pages = [...zips('ZZ', 9, 'A'), ...zips('ZZ', 1, 'B')];   // 9 of 10 covered
  const [s] = scoreStates([e], pages);
  assert.equal(s.zip_pages, 10);
  assert.equal(s.covered_complete, 9);
  assert.ok(Math.abs(s.pct_complete - 0.9) < 1e-9);
  assert.equal(s.live, true, '90% exactly must qualify, not just above it');
  assert.equal(LIVE_THRESHOLD, 0.9);
});

test('convertible_by_completion isolates what a pure registry fix would win', () => {
  const done = { registry_id: 'a', coverage: [{ state: 'ZZ', county: 'A' }], status_to_bucket: { a: ['x'] }, type_map: { t: 'u' } };
  const half = { registry_id: 'b', coverage: [{ state: 'ZZ', county: 'B' }], status_to_bucket: { a: ['x'] } };
  const [s] = scoreStates([done, half], [...zips('ZZ', 5, 'A'), ...zips('ZZ', 7, 'B')]);
  assert.equal(s.covered_complete, 5);
  assert.equal(s.covered_any, 12);
  assert.equal(s.convertible_by_completion, 7, 'the 7 pages an additive fix alone would convert');
});

test('THE CORE FIX — a NOT_WIRED row can never enter the registry-work list', () => {
  const wired = [{ registry_id: 'wired-incomplete', platform: 'arcgis', coverage: [{ state: 'ZZ' }], status_to_bucket: { a: ['x'] } }];
  const research = [{ registry_id: 'WIDSPS-WI-BP', platform: 'Web Portal', research_status: 'Needs Connector', coverage: [{ state: 'WI' }] }];
  const work = rankRegistryWork(wired, zips('ZZ', 4));
  assert.equal(work.length, 1);
  assert.equal(work[0].registry_id, 'wired-incomplete');
  assert.deepEqual(work[0].missing, ['type_map']);
  assert.ok(!work.some((w) => w.registry_id === 'WIDSPS-WI-BP'),
    'research rows are a different list — this is the distinction that was got wrong');
  assert.ok(work.every((w) => w.state === 'WIRED_INCOMPLETE'));
});

test('discovery list flags blockers, and a blocked row never outranks ready work', () => {
  const research = [
    { registry_id: 'NJ-STATEWIDE-BP', platform: 'socrata', coverage: [{ state: 'NJ' }], has_geography: false },
    { registry_id: 'DE-STATEWIDE-BP', platform: 'arcgis', coverage: [{ state: 'DE' }], stale_since: '2024' },
    { registry_id: 'WIDSPS-WI-BP', platform: 'Web Portal', coverage: [{ state: 'WI' }], research_status: 'Needs Connector' },
    { registry_id: 'GOOD-ZZ-BP', platform: 'socrata', coverage: [{ state: 'ZZ' }] },
  ];
  const pages = [...zips('NJ', 359), ...zips('DE', 68), ...zips('WI', 211), ...zips('ZZ', 5)];
  const list = rankDiscoveryWork(research, pages);

  // NJ has 359 pages — by page count alone it would top the list. It must not.
  assert.equal(list[0].registry_id, 'GOOD-ZZ-BP', 'only 5 pages, but it is the only ACTIONABLE row');
  assert.equal(list[0].ready, true);

  const nj = list.find((r) => r.registry_id === 'NJ-STATEWIDE-BP');
  assert.deepEqual(nj.blockers, ['NO_GEOGRAPHY (no ZIP, point or address)']);
  assert.equal(nj.ready, false);
  assert.equal(nj.zip_pages_potential, 359, 'the prize is still reported honestly');

  assert.match(list.find((r) => r.registry_id === 'DE-STATEWIDE-BP').blockers[0], /STALE \(newest 2024\)/);
  assert.match(list.find((r) => r.registry_id === 'WIDSPS-WI-BP').blockers[0], /NEW_CONNECTOR_FAMILY/);
  assert.ok(list.every((r) => r.state === 'NOT_WIRED'));
});

test('an already-wired id is not re-listed as discovery work', () => {
  const list = rankDiscoveryWork(
    [{ registry_id: 'dup', coverage: [{ state: 'ZZ' }] }], zips('ZZ', 3), new Set(['dup']));
  assert.deepEqual(list, []);
});

test('uncovered counties rank largest-first, and counties_needed stops at 90%', async () => {
  const { rankUncoveredCounties } = await import('../scripts/lib/live-scoreboard-core.mjs');
  // 100 pages: 60 already covered by a complete entry, 40 spread over four uncovered counties.
  const done = { registry_id: 'ok', coverage: [{ state: 'CO', county: 'Denver' }], status_to_bucket: { a: ['x'] }, type_map: { t: 'u' } };
  const pages = [
    ...zips('CO', 60, 'Denver'),
    ...zips('CO', 20, 'ElPaso'), ...zips('CO', 12, 'Larimer'),
    ...zips('CO', 5, 'Weld'), ...zips('CO', 3, 'Boulder'),
  ];
  const [co] = rankUncoveredCounties([done], pages);
  assert.equal(co.zip_pages, 100);
  assert.equal(co.covered_complete, 60);
  assert.equal(co.to_reach_90, 30, 'needs 90 covered, has 60');
  assert.deepEqual(co.counties.map((c) => c.county), ['ElPaso', 'Larimer', 'Weld', 'Boulder'],
    'largest-first');
  assert.equal(co.counties_needed, 2, 'ElPaso 20 + Larimer 12 = 32 >= 30; stop there');
});

test('a state already at 90% is not listed as county work', async () => {
  const { rankUncoveredCounties } = await import('../scripts/lib/live-scoreboard-core.mjs');
  const done = { registry_id: 'ok', coverage: [{ state: 'ZZ', county: 'A' }], status_to_bucket: { a: ['x'] }, type_map: { t: 'u' } };
  const out = rankUncoveredCounties([done], [...zips('ZZ', 95, 'A'), ...zips('ZZ', 5, 'B')]);
  assert.deepEqual(out, [], 'Live states drop off the work list entirely');
});

test('aggregate-by-design is its own blocker — periods are not permits', async () => {
  const { rankDiscoveryWork } = await import('../scripts/lib/live-scoreboard-core.mjs');
  const [d] = rankDiscoveryWork(
    [{ registry_id: 'douglas-co-building-permits', platform: 'arcgis',
       coverage: [{ state: 'CO', county: 'Douglas' }], aggregate_only: true }],
    zips('CO', 14, 'Douglas'));
  assert.deepEqual(d.blockers, ['AGGREGATE_NOT_PER_RECORD (periods, not permits)']);
  assert.equal(d.ready, false, 'a live 200-OK first-party source that cannot be pinned is not ready');
  assert.equal(d.zip_pages_potential, 14);
});

test('a terminal entry leaves the work list but is still reported and still not Live', async () => {
  const m = await import('../scripts/lib/live-scoreboard-core.mjs');
  const term = { registry_id: 'clark-county-active-projects', platform: 'arcgis',
    coverage: [{ state: 'NV', county: 'Clark' }], status_to_bucket: { a: ['x'] },
    vocab_terminal: 'Rule 5: free-text type field (capital-projects descriptions)' };
  const pages = zips('NV', 76, 'Clark');
  assert.deepEqual(m.rankRegistryWork([term], pages), [], 'never ranked — it cannot be completed');
  const [t] = m.listTerminal([term]);
  assert.equal(t.registry_id, 'clark-county-active-projects');
  assert.match(t.reason, /Rule 5/);
  const [nv] = m.scoreStates([term], pages);
  assert.equal(nv.covered_complete, 0, 'terminal is still INCOMPLETE — the pins are unclassified');
});

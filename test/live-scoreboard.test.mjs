// The scoreboard's job is to rank work. Its failure mode is ranking work that cannot be done —
// which is exactly what happened when blank workbook research rows read as "needs completing"
// instead of "never wired". These assertions pin the three-state distinction and the blockers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  entryCompleteness, coversZip, scoreStates, rankRegistryWork, rankDiscoveryWork,
  isFloorSource, LIVE_THRESHOLD,
} from '../scripts/lib/live-scoreboard-core.mjs';

// `src` is the list of registry ids that actually LANDED on that ZIP's cached page. Defaulting
// it to [] rather than "whatever the gate says" is the whole point of the record-based fix.
const zips = (state, n, county = 'X', src = []) =>
  Array.from({ length: n }, (_, i) => ({ zip: `${state}${i}`, state, county, source_ids: [...src] }));

test('BOTH maps are required — one alone is not complete', () => {
  assert.equal(entryCompleteness({ status_to_bucket: { proposed: [], approved: ['Issued'], operating: [], exclude: [] }, type_map: { A: 'Residential' } }).complete, true);
  assert.deepEqual(entryCompleteness({ status_to_bucket: { proposed: [], approved: ['Issued'], operating: [], exclude: [] } }).missing, ['type_map']);
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
  const entries = [{ registry_id: 'epa-frs', coverage: [{ state: 'NH' }], status_to_bucket: { proposed: [], approved: ['x'], operating: [], exclude: [] }, type_map: { t: 'u' } }];
  const [nh] = scoreStates(entries, zips('NH', 10, 'X', ['epa-frs']));
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
  const e = { registry_id: 'x', coverage: [{ state: 'ZZ', county: 'A' }], status_to_bucket: { proposed: [], approved: ['x'], operating: [], exclude: [] }, type_map: { t: 'u' } };
  const pages = [...zips('ZZ', 9, 'A', ['x']), ...zips('ZZ', 1, 'B')];   // 9 of 10 carry a record
  const [s] = scoreStates([e], pages);
  assert.equal(s.zip_pages, 10);
  assert.equal(s.covered_complete, 9);
  assert.ok(Math.abs(s.pct_complete - 0.9) < 1e-9);
  assert.equal(s.live, true, '90% exactly must qualify, not just above it');
  assert.equal(LIVE_THRESHOLD, 0.9);
});

test('THE ROW-429 FIX — a declared county with NO records landing is NOT Live', () => {
  // The entry is complete and its coverage declares the whole state, so the GATE reads 100%.
  // Not one record reaches a page. Before this fix the state read Live on nothing at all.
  const e = { registry_id: 'declared-but-dark', coverage: [{ state: 'ZZ' }],
    status_to_bucket: { proposed: [], approved: ['x'], operating: [], exclude: [] }, type_map: { t: 'u' } };
  const [s] = scoreStates([e], zips('ZZ', 20));
  assert.equal(s.covered_gate, 20, 'the gate still says every page is covered');
  assert.equal(s.pct_gate, 1);
  assert.equal(s.covered_records, 0, 'but nothing landed');
  assert.equal(s.live, false, 'records decide, not the gate');
  assert.equal(s.gate_overstatement, 20, 'and the gap is reported, not hidden');
});

test('the UT shape — gate says Live, records say 35%, records win', () => {
  const e = { registry_id: 'udot-active-projects', coverage: [{ state: 'UT' }],
    status_to_bucket: { proposed: [], approved: ['x'], operating: [], exclude: [] }, type_map: { t: 'u' } };
  const pages = [...zips('UT', 109, 'A', ['udot-active-projects']), ...zips('UT', 201, 'B')];
  const [ut] = scoreStates([e], pages);
  assert.equal(ut.zip_pages, 310);
  assert.equal(ut.covered_gate, 310);
  assert.equal(ut.covered_records, 109);
  assert.ok(Math.abs(ut.pct_records - 109 / 310) < 1e-9);
  assert.equal(ut.live, false, 'UT is 35% on records and must not read Live');
});

test('a record from an INCOMPLETE entry counts as any-source, never as Live', () => {
  const half = { registry_id: 'no-type', coverage: [{ state: 'ZZ' }], status_to_bucket: { proposed: [], approved: ['x'], operating: [], exclude: [] } };
  const [s] = scoreStates([half], zips('ZZ', 10, 'A', ['no-type']));
  assert.equal(s.covered_records, 0, 'unclassified pins are not coverage');
  assert.equal(s.covered_any, 10);
  assert.equal(s.convertible_by_completion, 10, 'a pure vocabulary fix would convert all ten');
  assert.equal(s.live, false);
});

test('records_observed is returned so the runner can refuse a wrong zero', () => {
  const e = { registry_id: 'x', coverage: [{ state: 'ZZ' }], status_to_bucket: { proposed: [], approved: ['x'], operating: [], exclude: [] }, type_map: { t: 'u' } };
  const [none] = scoreStates([e], zips('ZZ', 5));
  assert.equal(none.records_observed, 0,
    'zero observations must be visible — an upstream fetch failure and a genuinely dark state '
    + 'produce identical percentages, so the count is what tells them apart');
  const [some] = scoreStates([e], [...zips('ZZ', 2, 'A', ['x']), ...zips('ZZ', 3, 'A')]);
  assert.equal(some.records_observed, 2);
});

test('convertible_by_completion isolates what a pure registry fix would win', () => {
  const done = { registry_id: 'a', coverage: [{ state: 'ZZ', county: 'A' }], status_to_bucket: { proposed: [], approved: ['x'], operating: [], exclude: [] }, type_map: { t: 'u' } };
  const half = { registry_id: 'b', coverage: [{ state: 'ZZ', county: 'B' }], status_to_bucket: { proposed: [], approved: ['x'], operating: [], exclude: [] } };
  const [s] = scoreStates([done, half], [...zips('ZZ', 5, 'A', ['a']), ...zips('ZZ', 7, 'B', ['b'])]);
  assert.equal(s.covered_complete, 5);
  assert.equal(s.covered_any, 12);
  assert.equal(s.convertible_by_completion, 7, 'the 7 pages an additive fix alone would convert');
});

test('THE CORE FIX — a NOT_WIRED row can never enter the registry-work list', () => {
  const wired = [{ registry_id: 'wired-incomplete', platform: 'arcgis', coverage: [{ state: 'ZZ' }], status_to_bucket: { proposed: [], approved: ['x'], operating: [], exclude: [] } }];
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
  const done = { registry_id: 'ok', coverage: [{ state: 'CO', county: 'Denver' }], status_to_bucket: { proposed: [], approved: ['x'], operating: [], exclude: [] }, type_map: { t: 'u' } };
  const pages = [
    ...zips('CO', 60, 'Denver', ['ok']),
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
  const done = { registry_id: 'ok', coverage: [{ state: 'ZZ', county: 'A' }], status_to_bucket: { proposed: [], approved: ['x'], operating: [], exclude: [] }, type_map: { t: 'u' } };
  const out = rankUncoveredCounties([done], [...zips('ZZ', 95, 'A', ['ok']), ...zips('ZZ', 5, 'B')]);
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
    coverage: [{ state: 'NV', county: 'Clark' }], status_to_bucket: { proposed: [], approved: ['x'], operating: [], exclude: [] },
    vocab_terminal: 'Rule 5: free-text type field (capital-projects descriptions)' };
  const pages = zips('NV', 76, 'Clark', ['clark-county-active-projects']);
  assert.deepEqual(m.rankRegistryWork([term], pages), [], 'never ranked — it cannot be completed');
  const [t] = m.listTerminal([term]);
  assert.equal(t.registry_id, 'clark-county-active-projects');
  assert.match(t.reason, /Rule 5/);
  const [nv] = m.scoreStates([term], pages);
  assert.equal(nv.covered_complete, 0, 'terminal is still INCOMPLETE — the pins are unclassified');
});

test('ROW 264 — all four bucket KEYS must be present; a missing key is PARTIAL', async () => {
  const m = await import('../scripts/lib/live-scoreboard-core.mjs');
  const full = { proposed: [], approved: ['Recorded'], operating: [], exclude: [] };
  assert.equal(m.entryCompleteness({ status_to_bucket: full, type_map: { A: 'Residential' } }).complete, true,
    'one populated bucket + all four keys is COMPLETE — settled on the Del Valle pilot, where '
    + 'austin-site-plan-cases has no operating stage yet TX is the reference Live state');
  assert.deepEqual(
    m.entryCompleteness({ status_to_bucket: { approved: ['Recorded'] }, type_map: { A: 'x' } }).missing,
    ['status_to_bucket'],
    'omitting a key is not the same as declaring it empty: [] claims "no such stage", absence claims nothing');
  assert.deepEqual(m.REQUIRED_BUCKETS, ['proposed', 'approved', 'operating', 'exclude']);
  // status_const carries the whole vocabulary, so it has no buckets to declare (Detroit).
  assert.equal(m.entryCompleteness({ status_const: 'approved', type_map: { A: 'x' } }).complete, true);
});


// ── The RPC page size must be ONE constant, used for BOTH the request and the loop terminator.
// 2026-08-02: it was the literal 5000 twice. p_limit=5000 returns all 4,286 ZIPs in one page at
// 14,350 ms measured — past PostgREST's statement timeout — so source-monitor died in ~19s on
// HTTP 500 / 57014 every night. At 1000 the same call is 1,522 ms.
//
// The dangerous repair is the half one: lower the request but leave `page.length < 5000` and the
// loop breaks after the first page, ranking on 1,000 of 4,286 ZIPs. That is a WRONG scoreboard
// that looks right — strictly worse than the timeout, because the timeout was loud.
test('dev_zip_source_ids paging uses one shared constant, never a literal', () => {
  const src = readFileSync(new URL('../scripts/live-scoreboard.mjs', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  assert.match(code, /const ZIP_SOURCE_PAGE = \d+;/, 'page size must be a named constant');
  assert.match(code, /p_limit:\s*ZIP_SOURCE_PAGE/, 'the request must use the constant');
  assert.match(code, /page\.length\s*<\s*ZIP_SOURCE_PAGE/, 'the loop terminator must use the same constant');

  // No bare numeric page size may survive in either position — that is how they drift apart.
  assert.doesNotMatch(code, /p_limit:\s*\d+/, 'p_limit must not be a numeric literal');
  assert.doesNotMatch(code, /page\.length\s*<\s*\d+/, 'the terminator must not be a numeric literal');

  // And it must stay under the measured timeout ceiling: 1000 → 1.5s, 5000 → 14.3s (fails).
  const size = Number(code.match(/const ZIP_SOURCE_PAGE = (\d+);/)[1]);
  assert.ok(size > 0 && size <= 2000, `ZIP_SOURCE_PAGE=${size} risks the statement timeout (5000 measured at 14,350 ms)`);

  // The communities read has the SAME shape (URL limit + terminator) and the same hazard.
  assert.match(code, /const COMMUNITIES_PAGE = \d+;/);
  assert.match(code, /limit=\$\{COMMUNITIES_PAGE\}/, 'the communities URL limit must use the constant');
  assert.match(code, /page\.length\s*<\s*COMMUNITIES_PAGE/, 'its terminator must use the same constant');
  assert.doesNotMatch(code, /limit=\d+/, 'no paged read may hard-code its URL limit');
});

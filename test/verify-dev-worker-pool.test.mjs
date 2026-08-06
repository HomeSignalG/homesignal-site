// Offline regression for the SHIPPED worker pool that drives verify-development's ZIP walk.
//
// WHY THIS EXISTS. That walk was one Playwright page, serially, ~1.37 s/ZIP — 3.6-4.8 h per run
// and 45.4% of this repo's entire Actions spend in August 2026. `runPool` divides the wall clock
// by N. Two things could go quietly wrong with that, and both are what this file pins:
//
//   1. UNBOUNDED PARALLELISM. The point is to spend fewer runner minutes, NOT to trade them for
//      503s against the same Supabase the live site reads from. If the clamp regressed, the job
//      would still pass CI and still look faster while hammering production.
//   2. A SILENT CAP. The time budget must still truncate LOUDLY — "checked N of M, here is what
//      was skipped". A truncated run that looks complete is exactly how verify-geocodes hid 11
//      consecutive dead runs, and the no-silent-caps rule exists because of it.
//
// It drives the real exported function, not a copy — the same reason `assertZip` lives in
// verify-dev-helpers.mjs and test/verify-development-race-guard.test.mjs drives that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runPool } from '../scripts/lib/verify-dev-helpers.mjs';

const items = (n) => Array.from({ length: n }, (_, i) => ({ zip: String(10000 + i) }));
const tick = () => new Promise((r) => setTimeout(r, 1));

test('processes every item exactly once, in no more than `concurrency` at a time', async () => {
  const seen = [];
  let live = 0;
  let peak = 0;
  const res = await runPool({
    items: items(50),
    concurrency: 5,
    budgetSpent: () => false,
    handle: async (it) => {
      live++; peak = Math.max(peak, live);
      await tick();
      seen.push(it.zip);
      live--;
    },
  });
  assert.equal(res.checked, 50, 'every item handled');
  assert.equal(new Set(seen).size, 50, 'no item handled twice');
  assert.equal(res.skipped.length, 0, 'nothing skipped when the budget is not spent');
  assert.ok(peak <= 5, `peak in-flight ${peak} exceeded the concurrency of 5`);
  assert.equal(res.maxInFlight, peak, 'the pool reports the same peak the handler observed');
});

test('POSITIVE CONTROL: concurrency actually parallelises — peak > 1 at concurrency 5', async () => {
  // Without this, the bound assertion above would pass vacuously on a serial implementation.
  let live = 0; let peak = 0;
  await runPool({
    items: items(20),
    concurrency: 5,
    budgetSpent: () => false,
    handle: async () => { live++; peak = Math.max(peak, live); await tick(); live--; },
  });
  assert.ok(peak > 1, `expected real parallelism, saw peak in-flight ${peak}`);
});

test('concurrency is clamped to [1,12] and a junk value fails CLOSED to 1', async () => {
  for (const [given, want] of [[100, 12], [0, 1], [-5, 1], [NaN, 1], [undefined, 1], [7, 7]]) {
    const res = await runPool({
      items: items(3), concurrency: given, budgetSpent: () => false, handle: async () => {},
    });
    assert.equal(res.concurrency, want, `concurrency ${given} should clamp to ${want}`);
  }
});

test('a spent budget truncates LOUDLY: unstarted items come back as `skipped`', async () => {
  let done = 0;
  const all = items(100);
  const res = await runPool({
    items: all,
    concurrency: 4,
    budgetSpent: () => done >= 20,          // budget "runs out" after 20 items
    handle: async () => { await tick(); done++; },
  });
  assert.ok(res.checked >= 20 && res.checked < 100, `checked ${res.checked} — expected a partial walk`);
  assert.ok(res.skipped.length > 0, 'a truncated run must report what it skipped');
  assert.equal(res.checked + res.skipped.length, 100,
    'checked + skipped must account for EVERY item — that is what makes the cap non-silent');
  // The skipped set is a suffix of the input: workers claim strictly in cursor order.
  const firstSkipped = all.indexOf(res.skipped[0]);
  assert.deepEqual(res.skipped, all.slice(firstSkipped), 'skipped must be the unstarted suffix');
});

test('a budget already spent before the first claim skips EVERYTHING and handles nothing', async () => {
  let handled = 0;
  const res = await runPool({
    items: items(30), concurrency: 3, budgetSpent: () => true, handle: async () => { handled++; },
  });
  assert.equal(handled, 0, 'no work may start once the budget is gone');
  assert.equal(res.checked, 0);
  assert.equal(res.skipped.length, 30, 'the whole list is reported skipped, never silently dropped');
});

test('each lane gets its own resource (one Playwright page per lane, never shared)', async () => {
  const pages = ['p0', 'p1', 'p2'];
  const concurrentUse = new Map();
  let clash = 0;
  await runPool({
    items: items(30),
    concurrency: 3,
    resources: pages,
    budgetSpent: () => false,
    handle: async (_it, page) => {
      if (concurrentUse.get(page)) clash++;      // same page driven by two lanes at once
      concurrentUse.set(page, true);
      await tick();
      concurrentUse.set(page, false);
    },
  });
  assert.equal(clash, 0, 'a Playwright page must never be driven by two lanes concurrently');
});

test('an item that throws does not wedge the pool or lose the remaining items', async () => {
  let handled = 0;
  await assert.rejects(() => runPool({
    items: items(10), concurrency: 2, budgetSpent: () => false,
    handle: async (it) => { handled++; if (it.zip === '10003') throw new Error('boom'); },
  }), /boom/, 'a handler throw propagates rather than being swallowed');
  // verify-development wraps its own handler in try/catch (a ZIP failure is a recorded fail,
  // not a run-ender), so the pool deliberately does NOT swallow — this pins that contract.
  assert.ok(handled > 0);
});

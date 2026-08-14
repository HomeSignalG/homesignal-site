// The rolling refresh must schedule on "when did we last TRY", not "when did we last SUCCEED".
//
// WHY THIS EXISTS. `dev_refresh_fire_batch` ordered its batch by `refreshed_at asc`, and
// `refreshed_at` only advances when `dev_refresh_collect` actually writes the row. Every guard in
// that function can refuse a write. A refused row therefore keeps its sort key, returns to the
// front of the queue on the next tick, and is re-fired forever without ever yielding its place.
//
// Scheduling by an OUTCOME the row does not control makes one row's inability to be written into
// every other row's problem. Measured on production 2026-08-14, the 419 rows that had been fired
// but not written sat at average rank 193 of 12,722 under the old key and average rank 11,977
// under the new one — and the 449-row EPA outage-repair cohort behind them recorded ZERO retries
// across 16 hours while the cron ran successfully every 15 minutes.
//
// CI has no database, so the SQL half is pinned against the SQL OF RECORD
// (docs/dev-refresh-fair-ordering.sql); the applied live body was verified separately by
// pg_get_functiondef (ordering replaced, claim/cooldown/inflight all intact). The FAIRNESS half
// below is a scheduling simulation over the same predicate the SQL implements — it fails against
// the old key and passes against the new one, so it is a real discriminator, not a restatement.
//
// Run: node test/dev-refresh-fair-ordering.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/dev-refresh-fair-ordering.sql'), 'utf8');

let fails = 0;
const ok = (cond, name, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (!cond && detail ? '\n     ' + detail : ''));
  if (!cond) fails++;
};

// ── the SQL of record ─────────────────────────────────────────────────────────────────────────
ok(/order by greatest\(refreshed_at, last_refresh_attempt_at\) asc nulls first/.test(sql),
  'the batch is ordered by the last TOUCH (greatest of write and attempt)');
ok(/pg_get_functiondef/.test(sql),
  'the live definition is READ, not retyped');
ok(/hits <> 1 then\s*\n\s*raise exception/.test(sql),
  'the ordering anchor must appear EXACTLY once or the migration raises');
ok(/raise notice 'fair ordering already applied/.test(sql),
  'idempotent — re-applying is a no-op');
// greatest(), not bare last_refresh_attempt_at: a row written by another path (the manual
// outage-repair batches) advances refreshed_at only, and must still go to the back.
ok(/greatest\(\)/.test(sql) && /outage-repair/.test(sql),
  'the doc records WHY greatest() rather than plain last_refresh_attempt_at');
// The fix must not quietly change the rest of the batching contract.
for (const [needle, label] of [
  ['Batch size', 'batch size'],
  ['cooldown', 'cooldown'],
  ['for update skip locked', 'the row claim'],
]) {
  ok(sql.includes(needle), `the doc states that ${label} is unchanged`);
}

// ══ FAIRNESS SIMULATION ═══════════════════════════════════════════════════════════════════════
// Some rows are permanently un-writable (every guard refuses them); the rest write normally.
// Run the scheduler for N ticks under each sort key and count how many DISTINCT rows got a turn.
//
// THE STUCK SET MUST BE BIG ENOUGH TO FILL THE BATCH, or the defect does not reproduce — which is
// the real precondition too, not a trick to make the test fail. A row is eligible again once the
// cooldown lapses (20 min, i.e. every 2nd 15-min tick), so saturating a batch of B needs about
// 2B permanently-refused rows. Production had 419 refused-but-fired rows against a batch of 250.
// The first version of this test used ONE stuck row against a batch of 2 and reported "no
// starvation" under the OLD key — a passing test that proved nothing, because the scenario could
// not exhibit the bug it was written to catch.
const COOLDOWN_MIN = 20, BATCH = 2, TICK_MIN = 15;
const STUCK = ['s1', 's2', 's3', 's4'];          // 2x BATCH -> can fill every batch
const WRITABLE = ['a', 'b', 'c', 'd', 'e'];

// Turns are counted over the STEADY STATE (second half of the run) only. The opening ticks are a
// transient: every row starts equally stale, so the first few batches are decided by the tie-break
// rather than by the policy, and counting them lets a starving scheduler look fair. The question
// that matters is what the queue does once it has settled.
function simulate(sortKey, ticks = 60) {
  // All rows equally stale at t=0, so the sort key is the ONLY thing deciding who runs.
  const rows = [...STUCK, ...WRITABLE].map((id) => ({
    id, refreshed_at: 0, last_refresh_attempt_at: null,
  }));
  const fired = new Map(rows.map((r) => [r.id, 0]));
  const settledAt = Math.floor(ticks / 2) * TICK_MIN;
  for (let t = 0; t <= ticks * TICK_MIN; t += TICK_MIN) {
    const eligible = rows.filter((r) =>
      r.last_refresh_attempt_at === null || r.last_refresh_attempt_at < t - COOLDOWN_MIN);
    eligible.sort((x, y) => sortKey(x) - sortKey(y) || (x.id < y.id ? -1 : 1));
    for (const r of eligible.slice(0, BATCH)) {
      r.last_refresh_attempt_at = t;                       // the claim stamps EVERY fire
      if (t >= settledAt) fired.set(r.id, fired.get(r.id) + 1);
      if (!STUCK.includes(r.id)) r.refreshed_at = t;       // write succeeds -> refreshed_at advances
      // STUCK: write refused, refreshed_at deliberately left alone
    }
  }
  return fired;
}

const keyOld = (r) => r.refreshed_at;
const keyNew = (r) => Math.max(r.refreshed_at, r.last_refresh_attempt_at ?? r.refreshed_at);

const stuckFires = (m) => STUCK.reduce((n, id) => n + m.get(id), 0);

{
  const old = simulate(keyOld);
  const starved = WRITABLE.filter((id) => old.get(id) === 0);
  ok(starved.length === WRITABLE.length,
    'OLD key STARVES: NOT ONE writable row ever gets a turn (this is the defect)',
    `starved=${starved.join(',') || 'none'} of ${WRITABLE.join(',')}`);
  ok(stuckFires(old) > 20,
    'OLD key spends the entire budget re-firing rows it can never write',
    `stuck fired ${stuckFires(old)}x total`);
}

{
  const fresh = simulate(keyNew);
  const starved = [...fresh.entries()].filter(([, n]) => n === 0);
  ok(starved.length === 0,
    'NEW key: EVERY row gets a turn — no starvation',
    `starved=${starved.map(([id]) => id).join(',')}`);
  // A BOUNDED ratio, not exact parity: the cooldown quantises eligibility (a row frees up every
  // 2nd tick), so perfect equality is not achievable and demanding it would be a test that only
  // ever passes by luck. What matters is that no row can be crowded out — bound the disparity.
  const counts = [...fresh.values()];
  const ratio = Math.max(...counts) / Math.min(...counts);
  ok(ratio <= 1.5,
    'NEW key: turns are shared within a bounded ratio (no row is crowded out)',
    `ratio=${ratio.toFixed(2)} counts=${JSON.stringify([...fresh.entries()])}`);
  const worstStuck = Math.max(...STUCK.map((id) => fresh.get(id)));
  ok(worstStuck <= Math.min(...counts) + 1,
    'NEW key: an un-writable row gets no MORE turns than anyone else',
    `worstStuck=${worstStuck} min=${Math.min(...counts)}`);
}

// Fairness must not become ABANDONMENT: a source that recovers has to be able to heal the row on
// its next turn, so the refused rows must still be retried, just without monopolising.
{
  const fresh = simulate(keyNew);
  ok(STUCK.every((id) => fresh.get(id) > 0),
    'NEW key: every un-writable row is still retried each cycle (fair, not abandoned)',
    `stuck counts=${JSON.stringify(STUCK.map((id) => [id, fresh.get(id)]))}`);
}

console.log(fails ? `\n${fails} check(s) failed` : '\nAll fair-ordering checks passed');
process.exit(fails ? 1 : 0);

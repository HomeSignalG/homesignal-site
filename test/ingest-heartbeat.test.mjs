// Self-test for the EXTERNAL ingest heartbeat alarm — BOTH directions, as required.
//
// The two failures this suite exists to prevent are opposite and equally bad:
//   • it does not fire when ingest is dead   -> we repeat 2026-08-18..23 (115h dark, no alarm)
//   • it fires on a healthy cadence          -> a nightly false page, which is how a real one
//                                               gets ignored later
// Run: node scripts/run-unit-tests.mjs   (or: node test/ingest-heartbeat.test.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateHeartbeat, HEARTBEAT_THRESHOLD_HOURS, HEARTBEAT_CADENCE_HOURS }
  from '../scripts/lib/ingest-heartbeat.mjs';

const NOW = new Date('2026-08-23T16:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

test('DOES NOT FIRE on a healthy cadence — the false-page direction', () => {
  // A 4h cron lands somewhere in 0..4h old under normal operation.
  for (const h of [0, 0.5, 1, 2, 3, 3.9, 4]) {
    const r = evaluateHeartbeat({ now: NOW, latestFinished: hoursAgo(h) });
    assert.equal(r.ok, true, `${h}h old should be healthy, got: ${r.reason}`);
    assert.equal(r.state, 'OK');
  }
});

test('ONE dropped fire does NOT page — 4h cron, 6h threshold', () => {
  // A single missed cron puts the heartbeat at ~8h... which DOES exceed 6h. Pin the real
  // behaviour rather than the comfortable one: at this threshold a single miss pages, and that is
  // the founder-set trade. 5h (a late fire) still passes.
  assert.equal(evaluateHeartbeat({ now: NOW, latestFinished: hoursAgo(5) }).ok, true,
    'a late-but-delivered fire must not page');
  assert.equal(evaluateHeartbeat({ now: NOW, latestFinished: hoursAgo(8) }).ok, false,
    'a fully missed cycle is past the founder-set 6h threshold and pages');
});

test('FIRES when the heartbeat goes stale — the missed-outage direction', () => {
  for (const h of [6.1, 12, 24, 115.7]) {
    const r = evaluateHeartbeat({ now: NOW, latestFinished: hoursAgo(h) });
    assert.equal(r.ok, false, `${h}h old must alarm`);
    assert.equal(r.state, 'STALE');
    assert.match(r.reason, /no successful ingest run for/);
  }
});

test('THE REAL OUTAGE would have fired — 2026-08-18 20:04Z to 2026-08-23', () => {
  // The exact case that went undetected for ~115h. Evaluated at the FIRST threshold crossing:
  // 2026-08-19 02:04Z, i.e. ~110 hours before anyone noticed.
  const lastRun = '2026-08-18T20:04:00Z';
  const firstCross = new Date(Date.parse(lastRun) + (HEARTBEAT_THRESHOLD_HOURS + 0.1) * 3_600_000);
  const r = evaluateHeartbeat({ now: firstCross, latestFinished: lastRun });
  assert.equal(r.ok, false, 'the alarm must fire ~6h in, not 115h in');
  assert.ok(r.ageHours > HEARTBEAT_THRESHOLD_HOURS && r.ageHours < 7,
    `should fire just past the threshold, fired at ${r.ageHours}h`);
});

test('EMPTY is an alarm, not a pass — fail closed', () => {
  // The dangerous shape is `if (row && tooOld) fail`, which passes on an empty table. On the day
  // the table is created it IS empty, and during the outage it did not exist at all.
  for (const v of [null, undefined, '']) {
    const r = evaluateHeartbeat({ now: NOW, latestFinished: v });
    assert.equal(r.ok, false, `${JSON.stringify(v)} must alarm`);
    assert.equal(r.state, 'NO_HEARTBEAT');
  }
});

test('an UNPARSEABLE timestamp alarms rather than silently passing', () => {
  // NaN comparisons are all false, so a naive `age > threshold` would read as healthy forever.
  const r = evaluateHeartbeat({ now: NOW, latestFinished: 'not-a-date' });
  assert.equal(r.ok, false);
  assert.equal(r.state, 'UNREADABLE');
});

test('a FUTURE heartbeat alarms — it would otherwise mask a real outage', () => {
  const r = evaluateHeartbeat({ now: NOW, latestFinished: hoursAgo(-5) });
  assert.equal(r.ok, false);
  assert.equal(r.state, 'FUTURE');
  // ...but a few seconds of ordinary skew is not an incident.
  assert.equal(evaluateHeartbeat({ now: NOW, latestFinished: hoursAgo(-0.01) }).ok, true);
});

test('the threshold is the founder-set value and sits above the cron cadence', () => {
  assert.equal(HEARTBEAT_CADENCE_HOURS, 4);
  assert.equal(HEARTBEAT_THRESHOLD_HOURS, 6, 'founder-set: "no successful run in 6h" against a 4h cron');
  assert.ok(HEARTBEAT_THRESHOLD_HOURS > HEARTBEAT_CADENCE_HOURS,
    'a threshold at or below the cadence pages on every normal cycle');
});

test('NO CREDENTIAL BEYOND THE ANON KEY may enter the detection path', () => {
  // The whole point of this design. A PAT here would re-create the dependency that was dead
  // (HTTP 401) throughout the outage — a watchdog blind exactly when it was needed.
  const runner = readFileSync(new URL('../scripts/check-ingest-heartbeat-external.mjs', import.meta.url), 'utf8');
  const wf = readFileSync(new URL('../.github/workflows/check-ingest-heartbeat-external.yml', import.meta.url), 'utf8');
  for (const [name, src] of [['runner', runner], ['workflow', wf]]) {
    assert.doesNotMatch(src, /GH_PAT|GITHUB_TOKEN|PERSONAL_ACCESS|github_actions_pat/i,
      `${name} must not reference any GitHub credential`);
    assert.doesNotMatch(src, /api\.github\.com/,
      `${name} must not call the GitHub API — the ingest repo is private and that needs a PAT`);
    assert.doesNotMatch(src, /SERVICE_ROLE|WRITE_KEY/i,
      `${name} must never hold a write credential`);
  }
  assert.match(runner, /SUPABASE_ANON_KEY/, 'the reader uses the public anon key');
});

test('the workflow runs on a schedule and is not silently skippable', () => {
  const wf = readFileSync(new URL('../.github/workflows/check-ingest-heartbeat-external.yml', import.meta.url), 'utf8');
  assert.match(wf, /schedule:/, 'must be scheduled — that is the only reason it exists');
  assert.match(wf, /workflow_dispatch:/, 'must be manually testable');
  assert.doesNotMatch(wf, /continue-on-error:\s*true/,
    'a silent failure here is indistinguishable from a pass, in the one job whose job is to be loud');
});

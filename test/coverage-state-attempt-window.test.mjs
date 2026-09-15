// Offline pin for the 2026-09-15 recent-attempt-window correction — no network, no DB.
//
// THE DEFECT: `failed_ingest` and `temporarily_unavailable` both required an attempt
// within 48h to mean "still being actively retried". A ZIP failing that clause fell
// through to `stale_data`, whose documented meaning is "refreshed_at >72h old, NO recent
// failed-attempt evidence".
//
// 48h was correct for the scheduler the ladder was written against: 250 rows/tick every
// 15 min = 24,000 attempts/day, a full 12,722-ZIP sweep in ~16.7h against a 24h SLA, so
// 48h was ~2x the sweep. THE SCHEDULER LATER CHANGED AND THE CLASSIFICATION DID NOT
// FOLLOW — cron jobid 14 became `*/2 * * * *` -> `dev_refresh_tick(8, 20)`, i.e.
// 8 x 30 = 240 attempts/hour, a 53.0h sweep. 53.0h > 48h, so for ~5 hours of every sweep
// a healthy, on-schedule ZIP had no attempt inside the window and was named `stale_data`.
//
// Measured in production 2026-09-15 before the fix: never_attempted 0, attempted <=24h
// 5,760, <=48h 11,520, oldest attempt 53.03h. All 25 `stale_data` ZIPs sat in a
// 48.00h..51.94h band with ZERO outside it, and 25 of 25 carried
// last_refresh_attempt_at > refreshed_at — every one HAD the retry evidence the state
// claims is absent. The scheduler was healthy; the boundary was wrong.
//
// THE RULE THIS PINS: the recent-attempt window must be >= the sweep period the
// scheduler implies, or healthy ZIPs are misclassified BY CONSTRUCTION. §1 demonstrates
// the defect with the old constant and the fix with the new one, in the same test, so
// the correction is proven load-bearing rather than merely present.
// Run: node scripts/run-unit-tests.mjs   (or: node test/coverage-state-attempt-window.test.mjs)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? '\n     ' + detail : ''}`); }
};

const MODEL = read('docs/coverage-state-model.sql');
const MIGRATION = read('docs/coverage-state-recent-attempt-window.sql');
const VERIFIER = read('scripts/verify-coverage-state.mjs');

// ── 0. The ladder as a pure function, parameterised by the window. ───────────────
// Mirrors the freshness branches of docs/coverage-state-model.sql in CASE order.
// `windowH` is the ONLY knob, so a difference in outcome is attributable to it alone.
const H = 3600000, D = 86400000;
function classify({ hasReport = true, successAgeH, attemptAgeH }, windowH) {
  if (!hasReport) return 'unsupported_source';
  const now = Date.now();
  const refreshed_at = now - successAgeH * H;
  const last_attempt = attemptAgeH === null ? null : now - attemptAgeH * H;
  const attemptNewer = last_attempt !== null && last_attempt > refreshed_at;
  const attemptRecent = last_attempt !== null && last_attempt >= now - windowH * H;
  if (refreshed_at < now - 7 * D && attemptNewer && attemptRecent) return 'failed_ingest';
  if (refreshed_at < now - 72 * H && attemptNewer && attemptRecent) return 'temporarily_unavailable';
  if (refreshed_at < now - 72 * H) return 'stale_data';
  return 'fresh';                       // the content branches are out of scope here
}

// ── 1. THE DEFECT AND THE FIX, ON THE SAME ROW. ──────────────────────────────────
// A real production row: 20764, attempt 51.80h old, last success 4.34 days ago, being
// retried. Mid-sweep on a 53h sweep — the healthiest possible shape for a ZIP that has
// not been reached yet this pass.
const midSweep = { successAgeH: 4.34 * 24, attemptAgeH: 51.80 };
ok('1. the OLD 48h window misclassified a mid-sweep ZIP as stale_data (the defect)',
   classify(midSweep, 48) === 'stale_data', classify(midSweep, 48));
ok('1b. the NEW 72h window classifies the same row as temporarily_unavailable (the fix)',
   classify(midSweep, 72) === 'temporarily_unavailable', classify(midSweep, 72));

// 22035: attempt 50.03h, last success 23.55 DAYS. Chronically failing while being
// retried — it was hiding in stale_data, a state that denies retry evidence exists.
const chronic = { successAgeH: 23.55 * 24, attemptAgeH: 50.03 };
ok('1c. the OLD window hid a 23-day chronic failure inside stale_data',
   classify(chronic, 48) === 'stale_data', classify(chronic, 48));
ok('1d. the NEW window names it failed_ingest — the correction SHARPENS the instrument',
   classify(chronic, 72) === 'failed_ingest', classify(chronic, 72));

// ── 2. THE BACKSTOP IS UNTOUCHED — widening the window cannot hide a broken ZIP. ──
// The 7-day bound is measured from refreshed_at (the last GOOD write) and no window
// value can move a row across it. This is what makes the change safe rather than a
// relaxation: every rescued row lands in a state that is still gated.
for (const wh of [48, 72, 96, 240]) {
  ok(`2. a >7d-stale retried ZIP is failed_ingest at every window (${wh}h)`,
     classify({ successAgeH: 20 * 24, attemptAgeH: 1 }, wh) === 'failed_ingest');
}
ok('2b. a fresh ZIP is never a freshness state',
   classify({ successAgeH: 1, attemptAgeH: 0.5 }, 72) === 'fresh');

// ── 3. `stale_data` MUST STAY REACHABLE, or the fix would be a deletion. ─────────
// Genuine abandonment — an attempt older than the window, i.e. MORE than one full sweep
// missed — still reports stale_data. A window so wide that nothing can ever be stale
// would silence the state instead of correcting it.
ok('3. a ZIP whose attempt predates the window is still stale_data (abandonment)',
   classify({ successAgeH: 10 * 24, attemptAgeH: 80 }, 72) === 'stale_data');
ok('3b. a ZIP never attempted at all is still stale_data',
   classify({ successAgeH: 10 * 24, attemptAgeH: null }, 72) === 'stale_data');
// The attempt-is-OLDER-than-the-success case: nothing is being retried, so the ladder
// must not claim it is. (In production this is the shape of a row whose last attempt
// SUCCEEDED, then went stale without a further attempt.)
ok('3c. an attempt older than the last success is not retry evidence',
   classify({ successAgeH: 100, attemptAgeH: 120 }, 72) === 'stale_data');

// ── 4. THE ARITHMETIC THAT CHOSE 72, pinned so the reasoning is not lost. ────────
// sweep = zips / (batch * fires_per_hour). Production cron jobid 14, measured
// 2026-09-15: `*/2 * * * *` -> dev_refresh_tick(8, 20), 12,722 canonical ZIPs.
const sweepHours = (zips, batch, everyMin) => zips / (batch * (60 / everyMin));
const PROD_SWEEP = sweepHours(12722, 8, 2);
ok('4. the production cron contract implies a ~53h sweep',
   Math.abs(PROD_SWEEP - 53.0) < 0.1, `computed ${PROD_SWEEP.toFixed(2)}h`);
ok('4b. the OLD 48h window was SHORTER than that sweep — the defect, as arithmetic',
   48 < PROD_SWEEP);
ok('4c. the NEW 72h window covers it, with headroom for retries and jitter',
   72 >= PROD_SWEEP, `headroom ${(72 - PROD_SWEEP).toFixed(2)}h`);
// The old scheduler is why 48h was once right — recorded so nobody reads the original
// constant as careless.
ok('4d. under the ORIGINAL scheduler (250 per 15 min) 48h really did cover the sweep',
   48 >= sweepHours(12722, 250, 15), `${sweepHours(12722, 250, 15).toFixed(2)}h`);

// ── 5. THE SQL OF RECORD CARRIES THE NEW WINDOW, IN BOTH BRANCHES. ──────────────
const ladder = MODEL.slice(MODEL.indexOf('create or replace view'));
const attemptClauses = ladder.match(/last_refresh_attempt_at\s*>=\s*now\(\)\s*-\s*interval\s*'(\d+)\s*hours'/g) || [];
ok('5. the model SQL has exactly two recent-attempt clauses', attemptClauses.length === 2,
   `found ${attemptClauses.length}`);
ok('5b. BOTH are 72h — a half-applied widening is its own defect',
   attemptClauses.every(c => /'72 hours'/.test(c)), attemptClauses.join(' | '));
ok('5c. no 48h window survives anywhere in the model SQL',
   !/interval\s*'48\s*hours'/.test(MODEL));
// The refreshed_at staleness thresholds are NOT what this change touches. If one of them
// moved, the scope claim ("nothing else moves") would be false.
ok('5d. the 7-day chronic threshold is untouched',
   (ladder.match(/interval\s*'7 days'/g) || []).length === 1);
ok('5e. the two refreshed_at 72h staleness clauses are untouched',
   (ladder.match(/r\.refreshed_at\s*<\s*now\(\)\s*-\s*interval\s*'72 hours'/g) || []).length === 2);

// ── 6. THE MIGRATION IS EXECUTABLE AND FAILS CLOSED. ────────────────────────────
// A parked migration that is mostly comments is not a migration (the Phase 1B lesson).
const exec = MIGRATION.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
ok('6. the migration actually replaces the view (executable, not a comment)',
   /create\s+or\s+replace\s+view\s+public\.app_coverage_states/.test(exec));
ok('6a. it RESTATES security_invoker — a bare replace drops it, which is an escalation',
   /with\s*\(\s*security_invoker\s*=\s*true\s*\)/.test(exec));
ok('6b. it asserts security_invoker survived, rather than assuming it',
   /security_invoker=true'\s*=\s*any/.test(exec) && /INVARIANT \(a\) FAILED/.test(exec));
ok('6c. it restates the anon read grant', /grant select on public\.app_coverage_states to anon/.test(exec));
ok('6d. every source relation is schema-qualified',
   ['app_community_meta', 'development_reports', 'app_projects', 'app_changes']
     .every(t => new RegExp(`public\\.${t}`).test(exec)));
ok('6e. it asserts the 48h window is GONE, not merely that 72h is present',
   /INVARIANT \(b\) FAILED[^']*48h window remain/.test(exec));
ok('6f. it lowercases the viewdef before matching — casing must not defeat the guard',
   /lower\(pg_get_viewdef/.test(exec));
// Unit 2's rule re-asserted: this file rewrites the whole ladder, so it could silently
// undo the EPA/core split.
ok('6g. it re-asserts that the CORE ladder reads no EPA term',
   /INVARIANT \(c\) FAILED/.test(exec) && /facilities_only/.test(exec));

// ── 7. THE COUPLING IS ENFORCED, NOT COMMENTED. ─────────────────────────────────
// The defect was a constant that silently stopped matching the scheduler. A comment
// saying "keep these in sync" is what failed the first time, so both halves assert.
ok('7. the migration checks the window against the live cron row',
   /cron\.job/.test(exec) && /INVARIANT \(d\) FAILED/.test(exec));
// Written as the ARITHMETIC, not as the string `dev_refresh_tick` — an assertion that
// merely finds the job name would still pass if the sweep computation were deleted.
ok('7a. ... and computes the sweep from batch size and fire frequency',
   /_zips::numeric\s*\/\s*\(_batch::numeric\s*\*\s*\(60\.0\s*\/\s*_every_min\)\)/.test(exec));
// "did not run" and "found nothing" must never look alike: an unreadable/unparseable
// cron row warns loudly instead of silently passing.
ok('7b. an unevaluated cron check is reported, never silently skipped',
   (exec.match(/NOT EVALUATED/g) || []).length >= 3);
ok('7c. the verifier asserts the window covers the OBSERVED sweep, daily',
   /RECENT_ATTEMPT_WINDOW_H/.test(VERIFIER)
   && /ok\(`coverage-pass: recent-attempt window/.test(VERIFIER));
const vWindow = (VERIFIER.match(/const RECENT_ATTEMPT_WINDOW_H\s*=\s*(\d+)/) || [])[1];
ok('7d. the verifier constant equals the SQL window — the two halves cannot drift',
   vWindow === '72', `verifier=${vWindow} sql=72`);
ok('7e. a universe with no attempt timestamps is reported UNVERIFIED, not passed',
   /window coverage UNVERIFIED/.test(VERIFIER));
// The band is what distinguishes the boundary defect from genuine abandonment in the log.
ok('7f. a stale_data failure prints the attempt-age band and the retried count',
   /INFO stale_data:/.test(VERIFIER) && /attempt NEWER than their last success/.test(VERIFIER));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

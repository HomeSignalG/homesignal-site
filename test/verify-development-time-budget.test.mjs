// Offline structural suite for the verify-development TIME BUDGET (2026-08-02) — no network.
//
// THE CLASS IT CLOSES. The job walks every cached development_reports row (12,722 today) through
// one Playwright page, serially, at ~1.37 s each; measured full runs 3.56–4.83 h. Runtime is
// LINEAR in cached ZIPs, so the workflow cap is reached at ~15,700 — about one state's build away.
// A run killed at the cap uploads NO report, so it presents as a MISSING result rather than a
// partial one; that is exactly how verify-geocodes hid 11 consecutive dead runs.
//
// The budget does not make the job faster. It makes an incomplete run SAY it is incomplete —
// the repo's own no-silent-caps rule turned on the instrument itself. This suite pins the three
// properties that make that true, asserted against the SHIPPED script so an edit cannot quietly
// restore the silent shape.
// Run: node scripts/run-unit-tests.mjs   (or: node test/verify-development-time-budget.test.mjs)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? '\n     ' + detail : ''}`); }
};

const src = readFileSync(new URL('../scripts/verify-development.mjs', import.meta.url), 'utf8');

console.log('1) the budget exists, is env-tunable, and sits inside the workflow cap');
ok('TIME_BUDGET_MS is declared and overridable', /const TIME_BUDGET_MS = process\.env\.TIME_BUDGET_MS/.test(src));
ok('default is 4.5 h', /4\.5 \* 60 \* 60 \* 1000/.test(src));
{
  // The workflow's own cap must be LARGER than the script's budget, or the script never gets to
  // write its report — the exact failure the budget exists to prevent.
  const wf = readFileSync(new URL('../.github/workflows/verify-development.yml', import.meta.url), 'utf8');
  const cap = Number((wf.match(/timeout-minutes:\s*(\d+)/) || [])[1]);
  ok(`workflow cap (${cap} min) exceeds the 270-min budget`, cap > 270, `cap=${cap}`);
}

console.log('\n2) the walk STOPS on the budget and remembers what it skipped');
ok('the ZIP loop checks the budget', /if \(budgetSpent\(\)\)/.test(src));
ok('skipped ZIPs are captured, not just counted', /skippedForBudget = reports\.slice\(idx\)\.map/.test(src));

console.log('\n3) an incomplete run cannot read as a clean pass');
ok('the summary reports checked-of-total, not a bare total',
  /ZIPs checked: \*\*\$\{reports\.length - skippedForBudget\.length\}\*\* of \$\{reports\.length\}/.test(src));
ok('a truncation warning names how many were skipped AND some of them',
  /TIME BUDGET SPENT/.test(src) && /skippedForBudget\.slice\(0, 5\)\.join/.test(src));
ok('the all-clear line is suppressed when the walk was truncated',
  /: skippedForBudget\.length\s*\n\s*\? \[``, `No failures among the pages that WERE checked/.test(src));
ok('a truncated run is pushed onto fails, so it EXITS NON-ZERO',
  /if \(skippedForBudget\.length\) fails\.push\(`TIME BUDGET:/.test(src));

{
  // Ordering matters: the failure must be recorded BEFORE the summary is built, or the summary
  // prints "Failed: 0" while the process exits 1 — two instruments disagreeing about one run.
  const pushIdx = src.indexOf('fails.push(`TIME BUDGET:');
  const summaryIdx = src.indexOf('const summary = [');
  ok('the budget failure is recorded BEFORE the summary is built (counts match the exit code)',
    pushIdx > 0 && summaryIdx > 0 && pushIdx < summaryIdx, `push@${pushIdx} summary@${summaryIdx}`);
}

console.log('\n4) SELF-TEST — the detectors can fail');
{
  // Feed each structural check the pre-budget shape and require the WRONG verdict, so a green run
  // here proves the assertions are doing work rather than matching anything.
  const preBudget = src
    .replace(/if \(budgetSpent\(\)\) \{[^\n]*\n/, '')
    .replace(/if \(skippedForBudget\.length\) fails\.push\(`TIME BUDGET:[^\n]*\n/, '');
  ok('detector would FLAG a script with no budget check in the loop', !/if \(budgetSpent\(\)\)/.test(preBudget));
  ok('detector would FLAG a script that does not fail on truncation',
    !/if \(skippedForBudget\.length\) fails\.push\(`TIME BUDGET:/.test(preBudget));
}

console.log(fail ? `\n${fail} check(s) FAILED` : `\nAll ${pass} time-budget checks passed.`);
process.exit(fail ? 1 : 0);

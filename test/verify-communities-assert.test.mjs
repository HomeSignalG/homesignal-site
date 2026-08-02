// Offline suite for the verify-communities RACE GUARD — no network, no browser, no DB.
//
// WHY THIS EXISTS. The guard shipped 2026-08-02 inside the walker loop, where its only branch
// needed a live REST round-trip to reach. Its first production run then reported:
//     - Rows re-read after a mid-walk materializer change: 0
// i.e. the guard had NEVER FIRED. A green run therefore proved the PAGES were correct and said
// nothing at all about the guard — and a guard that has never fired is indistinguishable from a
// guard that cannot fire (CLAUDE.md: "an instrument must prove it ran before its silence counts as
// evidence"). The comparison was extracted into a pure core so both outcomes can be driven here.
//
// The two that matter are opposites, and BOTH must hold or the guard is worthless:
//   • the flag really changed mid-walk  -> re-check against the fresh row, do NOT fail;
//   • the flag did not change           -> STILL FAIL. A re-read must never become the way a real
//                                          defect gets dismissed.
// Run: node scripts/run-unit-tests.mjs   (or: node test/verify-communities-assert.test.mjs)
import { assertCommunityRow, indexable } from '../scripts/lib/verify-communities-assert.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const INDEX = 'index, follow';
const NOINDEX = 'noindex, nofollow';

const row = (over = {}) => ({ zip: '97212', name: 'Portland (97212)', state: 'OR', data_quality: 'pass', indexable: true, ...over });
const page = (over = {}) => ({ robots: INDEX, isPass: true, isCoverage: false, isNotCovered: false, h1: 'Portland 97212', recordLinks: ['https://example.gov/rec/1'], ...over });

// A fetchFresh that records whether it was called at all.
function fresh(value) { let calls = 0; return { fn: async () => { calls++; return value; }, calls: () => calls }; }

async function main() {
  console.log('0) the robots helper');
  ok('index, follow => indexable', indexable(INDEX) === true);
  ok('noindex, nofollow => NOT indexable', indexable(NOINDEX) === false);

  console.log('\n1) THE GUARD FIRES — the flag really changed mid-walk (the Portland case)');
  {
    // Snapshot said indexable=true; the page noindexed; the CURRENT row says false. Page is right.
    const f = fresh({ data_quality: 'pass', indexable: false });
    const r = await assertCommunityRow(row({ indexable: true }), page({ robots: NOINDEX }), f.fn);
    ok('no failure — the page matched the CURRENT flag', r.fails.length === 0, r.fails.join(' | '));
    ok('reRead reported', r.reRead === true);
    ok('the substitution is logged, not silent', r.notes.some((n) => /meta changed mid-walk/.test(n)), JSON.stringify(r.notes));
    ok('the note names both transitions', r.notes.some((n) => /indexable true -> false/.test(n)));
    ok('fetchFresh was called exactly once', f.calls() === 1);
  }
  {
    // The OTHER direction: snapshot false, page indexed, current row says true. (97232.)
    const f = fresh({ data_quality: 'pass', indexable: true });
    const r = await assertCommunityRow(row({ indexable: false }), page({ robots: INDEX }), f.fn);
    ok('opposite direction also clears', r.fails.length === 0 && r.reRead === true, r.fails.join(' | '));
  }

  console.log('\n2) THE GUARD DOES NOT EXCUSE A REAL DEFECT — flag unchanged, still fails');
  {
    // The re-read returns the SAME values: the page genuinely contradicts the current flag.
    const f = fresh({ data_quality: 'pass', indexable: true });
    const r = await assertCommunityRow(row({ indexable: true }), page({ robots: NOINDEX }), f.fn);
    ok('still FAILS', r.fails.length === 1, JSON.stringify(r.fails));
    ok('fails with the substance-gate message', /substance-flagged page is NOT indexable/.test(r.fails[0] || ''), r.fails[0]);
    ok('reRead NOT reported (nothing changed)', r.reRead === false);
    ok('fetchFresh was consulted', f.calls() === 1);
  }
  {
    // Thin page that indexes anyway, flag unchanged -> must stay a failure.
    const f = fresh({ data_quality: 'pass', indexable: false });
    const r = await assertCommunityRow(row({ indexable: false }), page({ robots: INDEX }), f.fn);
    ok('pass-but-thin indexable page still FAILS', /must stay noindex/.test(r.fails[0] || ''), JSON.stringify(r.fails));
  }
  {
    // fetchFresh unavailable (null row back) must NOT swallow the failure.
    const f = fresh(null);
    const r = await assertCommunityRow(row({ indexable: true }), page({ robots: NOINDEX }), f.fn);
    ok('an unreadable re-read fails closed', r.fails.length === 1 && r.reRead === false, JSON.stringify(r.fails));
  }

  console.log('\n3) THE GUARD IS NARROW — it is not consulted when there is no disagreement');
  {
    const f = fresh({ data_quality: 'pass', indexable: false });
    const r = await assertCommunityRow(row({ indexable: true }), page({ robots: INDEX }), f.fn);
    ok('agreeing row+page: no re-read, no failure', f.calls() === 0 && r.fails.length === 0 && r.reRead === false);
  }
  {
    // A coverage_coming row never reaches the guard (its branch is a different gate).
    const f = fresh({ data_quality: 'pass', indexable: true });
    const r = await assertCommunityRow(row({ data_quality: 'coverage_coming', indexable: false }),
      page({ robots: NOINDEX, isPass: false, isCoverage: true }), f.fn);
    ok('coverage_coming row: guard not consulted', f.calls() === 0);
    ok('coverage_coming + noindex passes', r.fails.length === 0, JSON.stringify(r.fails));
  }

  console.log('\n4) THE OTHER GATES SURVIVED THE EXTRACTION (they moved file, not meaning)');
  {
    const r = await assertCommunityRow(row({ data_quality: 'coverage_coming', indexable: false }), page({ isPass: true }), null);
    ok('coverage_coming row rendering a PASS state fails', /rendered a PASS state/.test(r.fails[0] || ''), JSON.stringify(r.fails));
  }
  {
    const r = await assertCommunityRow(row({ data_quality: 'coverage_coming', indexable: true }),
      page({ robots: NOINDEX, isPass: false, isCoverage: true }), null);
    ok('coverage_coming with indexable=true is a materializer bug', /indexable=true \(materializer bug\)/.test(r.fails[0] || ''), JSON.stringify(r.fails));
  }
  {
    const r = await assertCommunityRow(row(), page({ isPass: false, isCoverage: true }), null);
    ok('pass row rendering coverage-coming fails', /expected a PASS page/.test(r.fails[0] || ''), JSON.stringify(r.fails));
  }
  {
    const r = await assertCommunityRow(row(), page({ h1: 'Somewhere Else' }), null);
    ok('H1 must contain the ZIP', /does not contain the ZIP/.test(r.fails[0] || ''), JSON.stringify(r.fails));
  }
  {
    const r = await assertCommunityRow(row(), page({ recordLinks: ['/relative/not-a-url'] }), null);
    ok('anti-fabrication: a non-http record link fails', /without a real http URL/.test(r.fails[0] || ''), JSON.stringify(r.fails));
  }
  {
    const r = await assertCommunityRow(row(), page(), null);
    ok('a fully healthy page produces no failure', r.fails.length === 0 && r.notes.length === 1, JSON.stringify(r));
  }

  console.log(fail ? `\n${fail} check(s) FAILED` : `\nAll ${pass} race-guard checks passed.`);
  process.exit(fail ? 1 : 0);
}

await main();

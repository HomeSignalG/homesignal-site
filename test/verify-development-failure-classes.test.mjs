// verify-development has been RED on main for weeks at 28,263 failures, and CLAUDE.md §5
// records that "only its DELTA is informative". A permanently red check is one nobody reads,
// which is how the next real regression arrives unnoticed.
//
// This file pins the three failure CLASSES that were the bulk of that number. All three were
// defects in the INSTRUMENT, not the product — each one reporting a page that was behaving
// correctly as a failure — and each fix makes the check stronger rather than quieter:
//
//   A  5,656 ZIPs  parseInt('—') -> NaN, and NaN !== anything, so every page that
//                  honestly rendered UNKNOWN for a refused EPA read failed a count check.
//   B  4,293 ZIPs  'operating' and 'built' are ONE bucket; two call sites tested 'built'
//                  alone, so every operating record read as un-railed AND as mislabelled.
//   C  12,722 ZIPs the cached counts were compared against the RENDERED population, which
//                  the page deliberately merges and re-filters after the engine counted.
import { assertZip, lifecycleRail, LIFECYCLE_BUCKETS } from '../scripts/lib/verify-dev-helpers.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };
const has = (fails, re) => fails.some((f) => re.test(f));

// A development site in the shape the engine caches.
const dev = (type, extra = {}) => ({
  relevance: 'development', scope: 'point', type,
  label: 'X', url: 'https://example.gov/r/1', ...extra,
});
// The page state the verifier scrapes. Defaults are the healthy shape.
const state = (extra = {}) => ({
  shell: true, mapInited: true, robots: 'index, follow', mislabeled: [],
  facText: '3', rendered: null, ...extra,
});

// ---- CLASS B: one vocabulary, and it lives in one place -------------------------------
ok(lifecycleRail({ type: 'built' }) === 'built' && lifecycleRail({ type: 'operating' }) === 'built',
   'B: built and operating are ONE rail — the collapse n5BucketFromStatus performs');
ok(lifecycleRail({ type: 'approved' }) === 'approved' && lifecycleRail({ type: 'proposed' }) === 'proposed',
   'B: approved and proposed are themselves');
ok(lifecycleRail({ type: 'OPERATING ' }) === 'built', 'B: the value is trimmed and case-folded');
ok(lifecycleRail({ type: 'zzz' }) === null && lifecycleRail({}) === null,
   'B: an unrecognised or absent value belongs to NO rail — it is never forced into proposed');
ok(LIFECYCLE_BUCKETS.has('built') && LIFECYCLE_BUCKETS.has('operating'),
   'B: ...and that agrees with LIFECYCLE_BUCKETS, which had it right all along (control)');

// The in-page copy cannot import, so pin that the stale ternary is gone and the shared
// vocabulary is stated there too.
const vd = readFileSync(join(root, 'scripts', 'verify-development.mjs'), 'utf8');
const vdCode = vd.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
ok(!/s\.type === 'built' \? 'built' : \(s\.type === 'approved' \? 'approved' : 'proposed'\)/.test(vdCode),
   'B: the stale built-only ternary is gone from the in-page mislabel check');
ok(/raw === 'built' \|\| raw === 'operating'/.test(vdCode),
   'B: the in-page check now treats operating as an operating record');
ok(/facilities_unavailable/.test(vdCode),
   'A: the reader FETCHES the flag it now asserts on (an assertion on an unfetched column is vacuous)');

// ---- CLASS A: UNKNOWN is a third state, checked in BOTH directions ---------------------
const repFac = (n, unavailable) => ({
  counts: { facilities: n, proposed: 0, approved: 0, operating: 0 },
  sites: [], facilities_unavailable: unavailable,
});
{
  // The exact production shape: EPA refused, page shows the em-dash, row still holds the
  // preserved count. THIS IS THE PAGE BEHAVING CORRECTLY.
  const f = assertZip('01253', repFac(0, true), false, state({ facText: '—', rendered: [] })).fails;
  ok(!has(f, /facility count/), 'A: a refused read rendering — is NOT reported as a count mismatch');
  ok(!has(f, /NaN/), 'A: and the word NaN never reaches a failure message');
}
{
  const f = assertZip('01253', repFac(40, false), false, state({ facText: '—', rendered: [] })).fails;
  ok(has(f, /facilities_unavailable=false/),
     'A: a page showing — when the read SUCCEEDED is caught — it would be hiding a real count');
}
{
  const f = assertZip('01253', repFac(40, true), false, state({ facText: '40', rendered: [] })).fails;
  ok(has(f, /facilities_unavailable=true/),
     'A: a page showing a NUMBER when the read was REFUSED is caught — asserting a withheld fact');
}
{
  const f = assertZip('01253', repFac(7, false), false, state({ facText: 'n/a', rendered: [] })).fails;
  ok(has(f, /READ failure/) && has(f, /nothing about counts\.facilities was verified/),
     'A: an unparseable counter says the READER broke, not that the product is wrong');
  ok(!has(f, /!= cached counts\.facilities/),
     'A: ...and does NOT also emit a count comparison, which is the shape that got misfiled');
}
{
  const f = assertZip('01253', repFac(7, false), false, state({ facText: '3', rendered: [] })).fails;
  ok(has(f, /facility count 3 != cached counts\.facilities 7/),
     'A: a GENUINELY wrong number still fails — the class kept its teeth');
}

// ---- CLASS C: counts reconcile against the population they summarise -------------------
{
  // Engine cached 2 proposed / 1 approved / 3 operating. Note the operating records carry
  // BOTH spellings, and one is area-scope: counts.* spans every scope, which is precisely
  // what the scope-filtered query got wrong when measuring this.
  const rep = {
    counts: { proposed: 2, approved: 1, operating: 3, facilities: 0 },
    facilities_unavailable: false,
    sites: [
      dev('proposed'), dev('proposed'),
      dev('approved'),
      dev('built'), dev('operating'), dev('operating', { scope: 'area' }),
    ],
  };
  // The page renders something LEGITIMATELY DIFFERENT: residential qualification dropped one
  // proposed record, and zipAuthMergeSites folded in an authoritative marker typed 'operating'.
  const rendered = [dev('proposed'), dev('approved'), dev('built'), dev('operating'), dev('operating')];
  const f = assertZip('78617', rep, false, state({ facText: '0', rendered })).fails;
  ok(!has(f, /Task 5/),
     'C: counts reconcile against the cached sites even though the rendered set differs by design');
  ok(!has(f, /UNRECOGNISED/), 'C: both operating spellings are recognised lifecycle values');
}
{
  // An ENGINE regression — counts disagreeing with the sites they summarise — must still fail.
  const rep = {
    counts: { proposed: 9, approved: 1, operating: 1, facilities: 0 },
    facilities_unavailable: false,
    sites: [dev('proposed'), dev('approved'), dev('operating')],
  };
  const f = assertZip('78617', rep, false, state({ facText: '0', rendered: rep.sites })).fails;
  ok(has(f, /counts\.proposed 9 !== rendered proposed rail 1 \(Task 5\)/),
     'C: a real engine miscount STILL fails — this is not a relaxation');
}
{
  // And the operating rail is no longer structurally unsatisfiable.
  const rep = {
    counts: { proposed: 0, approved: 0, operating: 2, facilities: 0 },
    facilities_unavailable: false,
    sites: [dev('operating'), dev('built')],
  };
  const f = assertZip('78617', rep, false, state({ facText: '0', rendered: rep.sites })).fails;
  ok(!has(f, /counts\.operating/),
     'C: counts.operating 2 is satisfied by one `operating` + one `built` — it used to read 0');
}

// ---- the unrelated assertions are untouched -------------------------------------------
{
  const rep = { counts: { facilities: 0 }, facilities_unavailable: false,
                sites: [{ relevance: 'development', scope: 'point', type: 'proposed', label: 'No URL' }] };
  const f = assertZip('78617', rep, false, state({ facText: '0', rendered: rep.sites })).fails;
  ok(has(f, /fabrication gate/), 'the anti-fabrication gate still fires on a site with no record_url');
}
{
  const f = assertZip('78617', { counts: {}, sites: [] }, false, state({ shell: false, rendered: [] })).fails;
  ok(has(f, /sidebar shell did not render/), 'the shell check still fires');
}

// ---- CLASS C, the product's own receipt ------------------------------------------------
// The strongest evidence that counts.* never described the rendered set is in the PAGE, which
// DELETES three of those keys in ZIP mode before rendering, saying why:
//
//   "The cached report's development counters describe ITS centroid-radius development set,
//    which no longer renders in ZIP mode - authoritative whole-ZIP geography replaced it.
//    Leaving them makes the headline tile contradict the map the resident is looking at
//    (measured live on 78617: the tile read 48 while 55 were drawn)."
//
// So the verifier was asserting an equality the product had already measured as false and
// deliberately removed. Pinned because the day the page stops deleting them, the reasoning
// behind reconciling counts against rep.sites needs re-reading.
const mapPage = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
ok(/delete zipCounts\.development; delete zipCounts\.proposed; delete zipCounts\.comment_open;/.test(mapPage),
   'C: the page still DELETES the cached development counters in ZIP mode (its own repudiation)');
ok(/facUnavailable:!!row\.facilities_unavailable/.test(mapPage),
   'A: the page derives facUnavailable from the same column the verifier now reads');

// ---- CLASS D: the report must be able to hand back what it found ----------------------
// The 2026-09-15 run wrote a 3433k step summary against GitHub's 1024k cap, so the WHOLE
// summary was discarded — headline counts included. A run that found 28,263 failures handed
// back nothing readable. That is the same failure class as a check that cannot fail.
ok(/SUMMARY_FAIL_CAP\s*=\s*\d+/.test(vdCode) && /SUMMARY_BYTE_CAP\s*=\s*\d+/.test(vdCode),
   'D: the summary is bounded by BOTH a line cap and a byte cap');
ok(Number((vdCode.match(/SUMMARY_BYTE_CAP\s*=\s*(\d+)\s*\*\s*1024/) || [])[1]) * 1024 <= 1024 * 1024,
   'D: ...and the byte cap is inside GitHub\'s own 1024k limit');
ok(/for \(const f of fails\)\s*console\.log\(`- \$\{f\}`\)/.test(vdCode),
   'D: the LOG loop iterates `fails` ITSELF — the cap trims the summary, never the record');
ok(!/for \(const f of fails\.(slice|filter)\b/.test(vdCode),
   'D: ...and the log loop is not sliced or filtered on its way out');
ok(/## Failures by class/.test(vd) && /classTable\(fails\)/.test(vdCode),
   'D: failures are grouped by CLASS, so a run diff shows which class moved');
ok(/facility counter is unparseable/.test(vdCode) && /cached-count-vs-sites/.test(vdCode),
   'D: the classifier names the classes this change fixed, so their disappearance is visible');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Regression guard for the 2026-07-24 → 07-28 verify-development red streak.
//
// WHAT WENT WRONG: verify-development.mjs snapshots all 12,722 `development_reports`
// rows (and the `app_community_meta.indexable` set) once at run start, then walks the
// live pages for ~3 hours. Meanwhile pg_cron `dev-reports-rolling-refresh`
// (`dev_refresh_tick`, every 15 min, first fired 2026-07-24 01:00 UTC) rewrites ~800
// rows/hour and `app-content-refresh` restamps the indexable flag hourly. 2,403 rows
// changed under the 2026-07-27 16:00 main run; 3,278 under the 21:11 branch run. So the
// verifier compared a STALE cached row against a page that had rendered a FRESHER one
// and reported real, correct pages as defects.
//
// The fix is a race guard in the walk: on any mismatch, re-read that ZIP's row + flag
// live, reload the page, and accept it if it matches EITHER committed state. This file
// drives the SHIPPED predicate (`assertZip`, exported from scripts/lib/verify-dev-helpers.mjs)
// over the three real incident cases and proves both directions:
//   · a stale row fails, the fresh row passes  → the guard heals it (no false red)
//   · a genuine defect fails against BOTH rows → the guard never masks it (no false green)
//
// Run: node test/verify-development-race-guard.test.mjs
import { assertZip } from '../scripts/lib/verify-dev-helpers.mjs';

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const has = (res, needle) => res.fails.some((f) => f.includes(needle));

// A rendered page state, as scripts/verify-development.mjs::renderZipPage returns it.
const pageState = (over = {}) => ({
  rendered: [],
  facText: '0',
  mapInited: true,
  mislabeled: [],
  shell: true,
  robots: 'noindex, nofollow',
  ...over,
});
const devSite = (type, label) => ({
  relevance: 'development', type, scope: 'point', label,
  record_url: 'https://maps.udot.utah.gov/projects/' + encodeURIComponent(label),
});
const facSite = (n) => ({
  relevance: 'facility', scope: 'point', label: 'EPA FRS facility ' + n,
  record_url: 'https://ordsext.epa.gov/FLA/www3/frs/' + n,
});

// ── CASE 1 — ZIP 84531 (Mexican Hat UT). Reported: "counts.operating 0 !== rendered
// operating rail 1". The row was refreshed at 21:45:00Z, 33 min after the run started;
// the live row now reads counts.operating = 1 with exactly 1 built development site.
{
  // indexable=true + content rendered → the page correctly serves index, follow.
  const st = pageState({ rendered: [devSite('built', 'US-163 resurfacing')], facText: '0', robots: 'index, follow' });
  const stale = { zip: '84531', counts: { facilities: 0, proposed: 0, approved: 0, operating: 0 }, sites: [] };
  const fresh = { zip: '84531', counts: { facilities: 0, proposed: 0, approved: 0, operating: 1 }, sites: [] };

  const a = assertZip('84531', stale, true, st);
  ok(has(a, 'counts.operating 0 !== rendered operating rail 1'),
    '84531 — stale snapshot reproduces the reported Task-5 operating mismatch');

  const b = assertZip('84531', fresh, true, st);
  ok(b.fails.length === 0, '84531 — the same page against the FRESH row is clean (race, not a defect)');
}

// ── CASE 2 — ZIP 99707 (Fairbanks AK). Reported: "facility count 40 != cached
// counts.facilities 32". The row was refreshed at 22:30:00Z, mid-run; the live row now
// reads counts.facilities = 40 over 40 facility sites.
{
  const forty = Array.from({ length: 40 }, (_, i) => facSite(i));
  const st = pageState({ rendered: forty, facText: '40', robots: 'index, follow' });
  const stale = { zip: '99707', counts: { facilities: 32, proposed: 0, approved: 0, operating: 0 }, sites: [] };
  const fresh = { zip: '99707', counts: { facilities: 40, proposed: 0, approved: 0, operating: 0 }, sites: [] };

  const a = assertZip('99707', stale, true, st);
  ok(has(a, 'facility count 40 != cached counts.facilities 32'),
    '99707 — stale snapshot reproduces the reported facility-count mismatch');

  const b = assertZip('99707', fresh, true, st);
  ok(b.fails.length === 0, '99707 — the same page against the FRESH row is clean (race, not a defect)');
}

// ── CASE 3 — the ten AZ/UT substance-gate reports (85641/85704/85735/85742/85746/85748/
// 85749/85750/84664/84711). Every one is `indexable = true` in the DB; they were stamped
// at 22:02:57 / 22:03:03Z, ~50 min AFTER the run snapshotted the indexable set, so the
// page correctly rendered "index, follow" against a flag the verifier had never read.
{
  const sites = Array.from({ length: 318 }, (_, i) => devSite('approved', 'Tucson permit ' + i));
  const st = pageState({ rendered: sites, facText: '2', robots: 'index, follow' });
  const row = { zip: '85748', counts: { facilities: 2, proposed: 0, approved: 318, operating: 0 }, sites: [] };

  const a = assertZip('85748', row, false, st);
  ok(has(a, 'violates the substance gate') && has(a, 'flag=false, sites=318'),
    '85748 — the stale indexable snapshot reproduces the reported substance-gate violation');

  const b = assertZip('85748', row, true, st);
  ok(b.fails.length === 0, '85748 — the same page against the FRESH indexable flag is clean');

  // …and the gate still bites in the other direction: flag true but nothing rendered.
  const thin = assertZip('85748', { zip: '85748', counts: {}, sites: [] }, true,
    pageState({ rendered: [], robots: 'index, follow' }));
  ok(has(thin, 'expected noindex'), 'substance gate still fails an indexable page that rendered no content');
}

// ── CASE 4 — the guard must NEVER mask a real defect. A rendered site with no record_url
// is the anti-fabrication invariant (development-tracker-source-of-truth §9): it fails
// against every candidate row, because no cache refresh can make it acceptable.
{
  const st = pageState({ rendered: [{ relevance: 'development', type: 'approved', scope: 'point', label: 'unsourced project' }], facText: '0' });
  for (const [name, row] of [
    ['stale', { zip: '84531', counts: { facilities: 0, approved: 0 }, sites: [] }],
    ['fresh', { zip: '84531', counts: { facilities: 0, approved: 1 }, sites: [] }],
  ]) {
    const r = assertZip('84531', row, true, st);
    ok(has(r, 'NO record_url') && has(r, 'fabrication gate'),
      `fabrication gate still fires against the ${name} row (a refresh can never heal it)`);
  }
}

// ── CASE 5 — a genuine count defect survives the guard: the page renders 5 approved
// records but NEITHER committed row says 5, so both candidates fail and the run stays red.
{
  const st = pageState({ rendered: Array.from({ length: 5 }, (_, i) => devSite('approved', 'permit ' + i)), facText: '0' });
  const before = { zip: '60602', counts: { facilities: 0, proposed: 0, approved: 3, operating: 0 }, sites: [] };
  const after = { zip: '60602', counts: { facilities: 0, proposed: 0, approved: 4, operating: 0 }, sites: [] };
  ok(assertZip('60602', before, true, st).fails.length > 0 && assertZip('60602', after, true, st).fails.length > 0,
    'a rail that matches NO committed row still fails against both candidates');
}

// ── CASE 6 — the predicate is pure: same inputs, same verdict, no hidden state. That is
// what makes replaying it against a second row a valid proof rather than a retry-until-green.
{
  const st = pageState({ rendered: [devSite('proposed', 'x')], facText: '0' });
  const row = { zip: '84302', counts: { facilities: 0, proposed: 0, approved: 0, operating: 0 }, sites: [] };
  const one = JSON.stringify(assertZip('84302', row, true, st).fails);
  const two = JSON.stringify(assertZip('84302', row, true, st).fails);
  ok(one === two && one.includes('counts.proposed 0 !== rendered proposed rail 1'),
    'assertZip is pure — replaying it yields the identical verdict');
}

// ── CASE 7 — a map that never initialized short-circuits and is NOT a count problem.
{
  const r = assertZip('84302', { zip: '84302', counts: { facilities: 5 } }, false, pageState({ mapInited: false }));
  ok(has(r, 'map did not initialize') && r.check.length === 0,
    'a dead map short-circuits before the count assertions');
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll checks passed.');
process.exit(fails ? 1 : 0);

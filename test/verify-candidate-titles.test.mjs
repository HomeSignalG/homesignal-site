// L2 title verification scoring tests (offline).
// Run: node test/verify-candidate-titles.test.mjs

import {
  DEFAULT_BOARD_PATTERN,
  GRANICUS_DEFAULT_EXCLUDE_PATTERN,
  GRANICUS_DEFAULT_PATTERN,
  inferFeedVendor,
  resolveVerificationPatterns,
  scoreMeetingTitles,
} from '../scripts/gov-feeds/verify-candidate-titles.mjs';

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

const wakeMixedTitles = [
  { title: 'Regular Meeting July 6 2026 2:00 PM - FINAL - Jul 06, 2026' },
  { title: 'Public Safety Committee July 6 2026 10:00 AM - Final - Jul 06, 2026' },
  { title: 'Education Committee June 22 2026 1:00 PM - Meeting Held Virtually - FINAL - Jun 22, 2026' },
  { title: 'Regular Meeting June 15, 2026 2:00 PM - Final - Jun 15, 2026' },
  { title: 'Work Session June 8 2026  2:30PM - FINAL - Jun 08, 2026' },
  { title: 'Special Called Meeting June 8 2026 12:30PM - FINAL - Jun 08, 2026' },
  { title: 'Budget Work Session May 21 2026 9:00 AM - FINAL - May 21, 2026' },
  { title: 'FY27 Budget Vote - Jun 01, 2026' },
  { title: 'Board of Commissioners on 2024-11-04 5:00 PM - Regular Meeting - Nov 04, 2024' },
];

const douglasMixedTitles = [
  { title: 'Board of County Commissioners - Supplemental - Jul 16, 2026' },
  { title: 'Board of County Commissioners  - Jul 16, 2026' },
  { title: 'Planning Commission - Jul 14, 2026' },
  { title: 'Regional Transportation Commission - Supplemental - Jul 13, 2026' },
  { title: 'Airport Advisory Committee - Jul 07, 2026' },
];

const legistarTitles = [
  { title: 'Clark County Board of Commissioners on 2026-07-21 9:00 AM - Jul 21, 2026' },
  { title: 'Clark County Planning Commission on 2026-07-21 7:00 PM - Jul 21, 2026' },
  { title: 'Clark County Zoning Commission  on 2026-07-22 9:00 AM - Jul 22, 2026' },
];

ok(inferFeedVendor('https://wake.granicus.com/ViewPublisherRSS.php?view_id=18') === 'granicus',
  'inferFeedVendor detects granicus');
ok(inferFeedVendor('https://wake.legistar.com/Calendar.aspx') === 'legistar',
  'inferFeedVendor detects legistar');
ok(inferFeedVendor('') === '', 'inferFeedVendor empty for missing source');

const wakePatterns = resolveVerificationPatterns({ feedVendor: 'granicus' });
ok(wakePatterns.patternUsed === GRANICUS_DEFAULT_PATTERN,
  'Granicus uses extended default pattern when --pattern omitted');
ok(wakePatterns.excludePatternUsed === GRANICUS_DEFAULT_EXCLUDE_PATTERN,
  'Granicus uses Committee exclusion when --exclude-pattern omitted');

const legistarPatterns = resolveVerificationPatterns({ feedVendor: 'legistar' });
ok(legistarPatterns.patternUsed === DEFAULT_BOARD_PATTERN,
  'non-Granicus keeps legacy default pattern');
ok(legistarPatterns.excludePatternUsed === null,
  'non-Granicus has no default exclusion');

const customPatterns = resolveVerificationPatterns({
  feedVendor: 'granicus',
  patternArg: 'Custom Board',
  excludePatternArg: 'Advisory',
});
ok(customPatterns.patternUsed === 'Custom Board',
  'explicit --pattern overrides Granicus default pattern');
ok(customPatterns.excludePatternUsed === 'Advisory',
  'explicit --exclude-pattern overrides Granicus default exclusion');

const wakeOldDefault = scoreMeetingTitles(wakeMixedTitles, {
  pattern: DEFAULT_BOARD_PATTERN,
  excludePattern: null,
});
ok(wakeOldDefault.matched === 1 && wakeOldDefault.ratio === 1 / 9,
  'Wake mixed publisher fails legacy default pattern (regression baseline)');

const wakeScored = scoreMeetingTitles(wakeMixedTitles, {
  pattern: GRANICUS_DEFAULT_PATTERN,
  excludePattern: GRANICUS_DEFAULT_EXCLUDE_PATTERN,
});
ok(wakeScored.excluded === 2, 'Wake excludes two Committee titles from denominator');
ok(wakeScored.scored === 7, 'Wake scores seven non-committee titles');
ok(wakeScored.matched === 7, 'Wake matches all scored board-session titles');
ok(wakeScored.pass === true, 'Wake mixed publisher passes Granicus L2 scoring');
ok(wakeScored.ratio >= 0.8, 'Wake ratio meets 0.8 threshold');

const douglasScored = scoreMeetingTitles(douglasMixedTitles, {
  pattern: GRANICUS_DEFAULT_PATTERN,
  excludePattern: GRANICUS_DEFAULT_EXCLUDE_PATTERN,
});
ok(douglasScored.excluded === 1, 'Douglas excludes one Committee title');
ok(douglasScored.scored === 4, 'Douglas scores four non-committee titles');
ok(douglasScored.matched === 4, 'Douglas matches all scored commission/board titles');
ok(douglasScored.pass === true, 'Douglas mixed publisher passes Granicus L2 scoring');

const legistarScored = scoreMeetingTitles(legistarTitles, {
  pattern: DEFAULT_BOARD_PATTERN,
  excludePattern: null,
});
ok(legistarScored.excluded === 0, 'Legistar has no automatic committee exclusion');
ok(legistarScored.scored === 3, 'Legistar scores all titles');
ok(legistarScored.matched === 3, 'Legistar matches all commission titles on default pattern');
ok(legistarScored.pass === true, 'existing Legistar county passes unchanged default scoring');

const committeeOnly = scoreMeetingTitles(
  [{ title: 'Public Safety Committee July 6 2026' }, { title: 'Education Committee June 22 2026' }],
  { pattern: GRANICUS_DEFAULT_PATTERN, excludePattern: GRANICUS_DEFAULT_EXCLUDE_PATTERN },
);
ok(committeeOnly.excluded === 2, 'committee exclusion removes all committee rows');
ok(committeeOnly.scored === 0, 'committee-only set scores zero rows');
ok(committeeOnly.pass === false, 'committee-only set fails when scored is zero');

const councilNotCommittee = scoreMeetingTitles(
  [{ title: 'Regional Transportation Council - Jul 13, 2026' }],
  { pattern: GRANICUS_DEFAULT_PATTERN, excludePattern: GRANICUS_DEFAULT_EXCLUDE_PATTERN },
);
ok(councilNotCommittee.excluded === 0, 'Council body is not excluded by Committee filter');
ok(councilNotCommittee.matched === 1, 'Council body still matches board pattern');

const disableExclude = resolveVerificationPatterns({
  feedVendor: 'granicus',
  excludePatternArg: '',
});
ok(disableExclude.excludePatternUsed === null,
  'empty --exclude-pattern disables exclusion on Granicus feeds');

const disableExcludeScore = scoreMeetingTitles(wakeMixedTitles, {
  pattern: GRANICUS_DEFAULT_PATTERN,
  excludePattern: disableExclude.excludePatternUsed,
});
ok(disableExcludeScore.excluded === 0, 'disabled exclusion keeps all titles in denominator');
ok(disableExcludeScore.scored === 9, 'disabled exclusion scores all nine titles');
ok(disableExcludeScore.matched === 7, 'disabled exclusion still matches seven board-session titles');

process.exit(fails ? 1 : 0);

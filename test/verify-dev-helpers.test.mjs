// Unit tests for scripts/lib/verify-dev-helpers.mjs
import {
  validRecordUrl,
  validateTabsSite,
  TABS_URL_RE,
  ingestionIssues,
  REPRESENTATIVE_ZIPS,
} from '../scripts/lib/verify-dev-helpers.mjs';

let failed = 0;
function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('ok:', msg);
  }
}

ok(validRecordUrl('https://www.tdlr.texas.gov/TABS/Projects/TABS2023006449'), 'accepts https TABS url');
ok(!validRecordUrl('ftp://bad.example/x'), 'rejects non-http');
ok(!validRecordUrl('not-a-url'), 'rejects garbage');

const tabsGood = {
  project_no: 'TABS2023006449',
  record_url: 'https://www.tdlr.texas.gov/TABS/Projects/TABS2023006449',
};
ok(validateTabsSite(tabsGood).ok, 'TABS project_no matches url suffix');
ok(TABS_URL_RE.test(tabsGood.record_url), 'TABS_URL_RE matches canonical url');

const tabsBad = {
  project_no: 'TABS2023006449',
  record_url: 'https://www.tdlr.texas.gov/TABS/Projects/TABS2023999999',
};
ok(!validateTabsSite(tabsBad).ok, 'TABS mismatch fails');

ok(validateTabsSite({ record_url: 'https://echo.epa.gov/x' }).skip, 'non-TABS skips');

const engine = {
  socrata_reports: [{
    registry_id: 'chicago-building-permits',
    unmapped_statuses: [{ status: 'MYSTERY', count: 2 }],
    no_record_url: 0,
  }],
  tabs_quarantined: [{ project_no: 'TABS000', reason: '404' }],
};
const ing = ingestionIssues(engine);
ok(ing.issues.length === 1, 'ingestionIssues surfaces unmapped status');
ok(ing.quarantined.length === 1, 'ingestionIssues carries quarantine');

const zips = new Set(REPRESENTATIVE_ZIPS.map((z) => z.zip));
ok(zips.size === REPRESENTATIVE_ZIPS.length, 'representative ZIP list has no dupes');
ok(zips.has('84302') && zips.has('78617'), 'panel includes original validation ZIPs');
ok([...zips].filter((z) => z.startsWith('8') || z.startsWith('0') || z.startsWith('4') || z.startsWith('9')).length >= 8,
  'panel spans multiple state prefixes');

if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAll verify-dev-helpers tests passed.');

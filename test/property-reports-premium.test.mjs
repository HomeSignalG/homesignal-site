// PROPERTY REPORTS IS A PREMIUM ACQUISITION SURFACE, NOT A SECOND WAITLIST.
// Run: node test/property-reports-premium.test.mjs
//
// WHY THIS FILE EXISTS. reports.html used to dead-end on "in progress / check back soon".
// The conversion reuses HomeSignal's existing Premium waitlist (HS.openModal('premiumModal')
// → HS.submitWaitlist → hs_premium_waitlist_join). A second form, table, or dashboard
// source on this page is the defect this pin exists to catch.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const require = createRequire(import.meta.url);
const W = require('../lib/premium-waitlist.js');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1');

const reports = read('reports.html');
const reportsCode = strip(reports);
const community = read('lib/community-page.js');
const shell = read('shell.js');
const acq = read('acquisition.html');

ok(/PROPERTY REPORTS · PREMIUM/.test(reports), '1a frozen eyebrow');
ok(/<h1>Property reports are coming soon<\/h1>/.test(reports), '1b frozen heading');
ok(/Get a detailed report for this property, including property intelligence and nearby changes that may affect the property\./.test(reports), '1c frozen explainer');
ok(/>Get Premium access →</.test(reports), '1d frozen CTA');
ok(/id="repIdentity"/.test(reports) && /ident\.textContent = line/.test(reportsCode),
  '1e resolved Address identity is painted from `from`, not a default geography');
ok(/repBackBtn/.test(reports) && /Back to property/.test(reports),
  '1f Back to property is kept');

ok(/onclick="HS\.openModal\('premiumModal'\)"/.test(reports),
  '2a Property Reports CTA is HS.openModal(\'premiumModal\')');
ok((community.match(/HS\.openModal\(\\?'premiumModal\\?'\)/g) || []).length === 3,
  '2b Community Profile still opens that same modal (three callers, unchanged)');
ok(/Get Premium access →/.test(community) && /Community Profile · Premium/.test(community),
  '2c Community Profile copy is untouched');

ok(/HS\.submitWaitlist/.test(shell) && /hs_premium_waitlist_join/.test(read('lib/premium-waitlist.js')),
  '3a one waitlist write path remains: submitWaitlist → hs_premium_waitlist_join');
ok(!/hs_premium_waitlist_join|submitWaitlist|premiumEmail/.test(reportsCode),
  '3b reports.html does not call the RPC or host a form of its own');
ok(/rpc\('hs_premium_waitlist'\)/.test(acq) && /canonical app_premium_waitlist/.test(acq),
  '3c Acquisition Dashboard still reads the one canonical table');

ok(/source:\s*location\.pathname \+ \(location\.search \|\| ''\)/.test(shell),
  '4a production source convention is still the page URL (path + query)');
ok(/zip:\s*W\.zipFromLocation\(location\)/.test(shell),
  '4b production ZIP convention is still zipFromLocation, not a second field');
ok(/W\.normalizeZip\(from\.zip\)/.test(reportsCode) && /origZip\(loc\) \|\| z/.test(reportsCode),
  '4c Property Reports supplies the resolved Address ZIP as zipFromLocation fallback');
ok(!/myZip|viewZip|DEFAULT_ZIP|activeProperty/.test(reportsCode),
  '4d it does not read myZip, viewZip, DEFAULT_ZIP or activeProperty');
ok(W.normalizeZip('78617') === '78617' && W.normalizeZip('Del Valle') === null,
  '4e ZIP still has to be a real 5-digit value — unparseable stays absent');

ok(/if\s*\(!res\.ok\)/.test(shell) && shell.indexOf("$('premiumDone').classList.remove('hidden')") > shell.indexOf('if (!res.ok)'),
  '5 success still displays only after the shared handler confirms the write');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
process.exit(fails ? 1 : 0);

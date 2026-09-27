// Step 3 pin: unsupported prediction claims stay on the consumer site and
// do not enter a sold-report surface. Run: node test/corporate-output-unsupported-predictions.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) {
    fails++;
    if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail));
  }
};

const evidence = read('docs/corporate-output-unsupported-predictions-2026-09-27.md');
const reports = read('reports.html');
const addrReport = read('supabase/functions/get-address-report/index.ts');
const property = read('property.html');
const impact = read('lib/impact.js');
const templates = read('lib/templates.js');

const families = [
  'value_outlook',
  'insurance_outlook',
  'Quality of Life Impact Score',
  'HS.projectImpact',
  'Effect at this address',
  'How it impacts you'
];

ok(existsSync(join(root, 'docs/corporate-output-unsupported-predictions-2026-09-27.md')),
  '1 Step 3 evidence file is in Git');
for (const family of families) {
  ok(evidence.includes(family) && /EXCLUDE/.test(evidence),
    '1b evidence names ' + family + ' as EXCLUDE');
}
ok(/They remain on the consumer site/.test(evidence) || /stay on the consumer site/i.test(evidence),
  '1c consumer site is left in place');
ok(/paid Future Surroundings Report was not started/.test(evidence),
  '1d paid report was not started');

ok(/Effect at this address/.test(property),
  '2a consumer property.html still has Effect at this address');
ok(/value_outlook/.test(property) && /insurance_outlook/.test(property),
  '2b consumer property.html still paints outlook vitals');
ok(/Quality of Life Impact Score/.test(templates),
  '2c consumer templates still brand the QoL score');
ok(/Nearby homeowners may feel/.test(impact) && /If approved/.test(impact),
  '2d consumer projectImpact still writes heuristic forecasts');

ok(!/value_outlook/.test(reports) && !/insurance_outlook/.test(reports),
  '3a reports.html does not paint outlook fields');
ok(!/Effect at this address/.test(reports),
  '3b reports.html does not use Effect at this address');
ok(!/Quality of Life Impact Score/.test(reports) && !/projectImpact/.test(reports),
  '3c reports.html does not brand QoL or call projectImpact');
ok(/Property reports are coming soon/.test(reports),
  '3d reports.html is still the waitlist, not a generator');

ok(!/value_outlook/.test(addrReport) && !/insurance_outlook/.test(addrReport),
  '4a get-address-report has no outlook fields');
ok(!/sowhat/.test(addrReport) && !/Effect at this address/.test(addrReport),
  '4b get-address-report has no sowhat / Effect-at-address fields');
ok(!/impact_score/.test(addrReport),
  '4c get-address-report has no impact_score field');

const missingTemplate = [
  'future-surroundings-report.html',
  'corporate-report.html',
  'lib/corporate-report.js'
].every((f) => !existsSync(join(root, f)));
ok(missingTemplate, '5 no corporate report template file exists yet');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
process.exit(fails ? 1 : 0);

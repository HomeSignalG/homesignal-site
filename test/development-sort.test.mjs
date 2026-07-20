// Development page sort helpers — status lifecycle rank + sanitizeSort whitelist.
// Run: node test/development-sort.test.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { sanitizeSort, devStatusSortRank } = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

ok(sanitizeSort('status') === 'status', 'sanitizeSort accepts status');
ok(sanitizeSort('impact') === 'impact', 'sanitizeSort keeps impact default');
ok(sanitizeSort('bogus') === 'impact', 'sanitizeSort rejects invalid sort');

ok(devStatusSortRank({ status: 'Proposed', stage: 'Concept' }) === 0, 'early Proposed ranks first');
ok(devStatusSortRank({ status: 'Proposed', stage: 'Under review' }) === 1, 'Proposed + review stage sub-ranks');
ok(devStatusSortRank({ status: 'Decided' }) === 1, 'Decided ranks after Proposed');
ok(devStatusSortRank({ status: 'Approved' }) === 2, 'Approved ranks third');
ok(devStatusSortRank({ status: 'Active', stage: 'Under construction' }) === 3, 'Active ranks as Construction');
ok(devStatusSortRank({ status: 'Operating' }) === 4, 'Operating ranks as Completed');
ok(devStatusSortRank({ status: 'Built' }) === 4, 'Built ranks with Operating');

const ordered = [
  { name: 'done', status: 'Operating' },
  { name: 'build', status: 'Active' },
  { name: 'appr', status: 'Approved' },
  { name: 'rev', status: 'Proposed', stage: 'In review' },
  { name: 'prop', status: 'Proposed', stage: 'Concept' }
].slice().sort(function (a, b) { return devStatusSortRank(a) - devStatusSortRank(b); });
ok(ordered.map(function (x) { return x.name; }).join(',') === 'prop,rev,appr,build,done',
  'status sort orders earliest lifecycle to latest');

const devHtml = fs.readFileSync(new URL('../development.html', import.meta.url), 'utf8');
ok(/seg\('status','Status'\)/.test(devHtml), 'development.html exposes Status sort control');
ok(/state2\.sort === 'status'/.test(devHtml), 'development.html sorts by status key');
ok(devHtml.indexOf("seg('impact','Impact on me')") < devHtml.indexOf("seg('status','Status')"),
  'Status appears after Impact on me');
ok(devHtml.indexOf("seg('status','Status')") < devHtml.indexOf("seg('distance','Distance')"),
  'Status appears before Distance');

const shell = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
ok(/devStatusSortRank/.test(shell), 'shell.js exposes devStatusSortRank');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll development-sort assertions passed.');

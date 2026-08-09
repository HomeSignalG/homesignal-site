// Development page sort helpers — lifecycle rank + sanitizeSort alias map.
//
// UPDATED 2026-08-09. This suite pinned the OLD two-control contract: a 'status' key
// alongside an 'impact' key that ordered by app_projects.impact_score — a lifecycle
// constant, so it produced the SAME earliest-first ordering under a name that claimed a
// calculation which does not exist. The two keys are now folded onto one canonical
// 'lifecycle' key reading devStatusSortRank(); 'impact'/'status'/'stage' survive as
// aliases so existing deep links keep resolving. The RANKING assertions below are
// unchanged — that logic never read the score and still doesn't.
// Run: node test/development-sort.test.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { sanitizeSort, devStatusSortRank } = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

ok(sanitizeSort('lifecycle') === 'lifecycle', 'sanitizeSort accepts the canonical key');
ok(sanitizeSort('stage') === 'lifecycle', 'sanitizeSort accepts stage as an alias');
ok(sanitizeSort('status') === 'lifecycle', 'legacy ?sort=status resolves to lifecycle');
ok(sanitizeSort('impact') === 'lifecycle', 'legacy ?sort=impact resolves to lifecycle');
ok(sanitizeSort('bogus') === 'lifecycle', 'sanitizeSort rejects invalid sort');
ok(sanitizeSort('__proto__') === 'lifecycle', 'sanitizeSort is prototype-safe');

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
ok(/seg\('lifecycle','Lifecycle stage'\)/.test(devHtml), 'development.html exposes one Lifecycle control');
ok(!/seg\('impact'/.test(devHtml), "the 'impact' control is gone");
ok(!/seg\('status','Status'\)/.test(devHtml), 'the duplicate Status control is gone');
ok(devHtml.indexOf("seg('lifecycle','Lifecycle stage')") < devHtml.indexOf("seg('distance','Distance')"),
  'Lifecycle appears before Distance');
// The sorted() comparator must rank by lifecycle and must not read the score. Checked
// on the extracted function body with comment lines stripped, so a historical note
// naming impact_score cannot pass or fail this.
const sortedBody = (devHtml.match(/function sorted\(\)[\s\S]*?\n    \}/) || [''])[0]
  .split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
ok(sortedBody.length > 0, 'sorted() located in development.html');
ok(/devStatusSortRank/.test(sortedBody), 'sorted() ranks by lifecycle');
ok(!/impact_score/.test(sortedBody), 'sorted() never reads impact_score');

const shell = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
ok(/devStatusSortRank/.test(shell), 'shell.js exposes devStatusSortRank');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll development-sort assertions passed.');

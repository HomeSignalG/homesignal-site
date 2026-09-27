// Founder 2026-09-27: do not unlist ~1,005 map pages just because they have
// plants and no new construction. "Nothing is being built" is a valid answer.
// Those pages stay listed. The old Unit 1 idea is rejected.
//
// This file is the product pin. It does not need a database. It fails if the
// live rule, the parked Unit 1 file, or the sitemap/map readers drop the
// facility limb.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const failures = [];
const ok = (name, cond) => {
  if (cond) console.log(`PASS — ${name}`);
  else { console.log(`FAIL — ${name}`); failures.push(name); }
};

const listed = ({ nd, ndp, nc, nf, nfc }) =>
  (nd + nf + nc) > 0 && (ndp > 0 || nfc >= 3);
const rejectedUnlist = ({ nd, ndp, nc }) => (nd + nc) > 0 && ndp > 0;

const plantsOnly = { nd: 0, ndp: 0, nc: 0, nf: 40, nfc: 40 };
ok('1. plants + no construction stays listed', listed(plantsOnly) === true);
ok('1b. the rejected Unit 1 rule would have dropped it (control)',
   rejectedUnlist(plantsOnly) === false);
ok('1c. a core-backed ZIP stays listed if EPA is down',
   listed({ nd: 5, ndp: 5, nc: 0, nf: 0, nfc: 0 }) === true);
ok('1d. empty on both planes stays unlisted (not a new threshold)',
   listed({ nd: 0, ndp: 0, nc: 0, nf: 0, nfc: 0 }) === false);

const unit1 = read('docs/epa-decouple-phase2-unit1-core-completion-markers.sql');
const unit1Exec = unit1.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const raiseAt = unit1Exec.indexOf("raise exception 'PHASE 2 UNIT 1 IS REJECTED");
const firstChange = unit1Exec.search(/\b(alter|update|create|insert|delete|drop|execute)\b/i);
ok('2. Unit 1 SQL refuses to run', raiseAt >= 0);
ok('2b. ...before any statement that could change rows or functions',
   raiseAt >= 0 && firstChange > raiseAt);

const va = (unit1Exec.match(/va\s+text := ([\s\S]*?);\n\s*kb\s+text/) || [])[1] || '';
ok('3. if the raise were deleted, the splice still KEEPS _nfc >= 3 on indexable',
   /\(_ndp > 0 or _nfc >= 3\)/.test(va));
ok('3b. ...and does not install the rejected unlist as the replacement',
   !/\(\(_nd\+_nc\)>0 and _ndp > 0\)/.test(va));
ok('3c. verify fails closed if the facility limb is lost',
   /plant-only pages must stay listed/.test(unit1Exec));

const snapshots = [
  'docs/app-content-materialize.sql',
  'docs/app-refresh-zip-local-news-migration.sql',
  'docs/app-refresh-zip-live-snapshot-2026-07-24.sql',
];
for (const rel of snapshots) {
  ok(`4. ${rel} still documents _ndp > 0 OR _nfc >= 3`,
     /_ndp > 0 or _nfc >= 3/i.test(read(rel)));
}

const map = read('homesignalmap.html');
ok('5. Map 1 still reads the substance gate as pass AND (dev-backed OR >=3 facilities)',
   /dev-backed OR >=3 facilities/.test(map)
   && /app_community_meta\?select=indexable/.test(map));

const sitemap = read('scripts/gen_sitemap.py');
ok('6. sitemap generator still advertises pass AND (>=1 development OR >=3 facilities)',
   />=1[\s\S]*development[\s\S]*OR >=3 facility/.test(sitemap)
   && /indexable=is\.true/.test(sitemap));

console.log(`\n${failures.length ? `FAILED: ${failures.length}` : 'ALL PASS'} — facilities-only pages stay listed`);
if (failures.length) process.exit(1);

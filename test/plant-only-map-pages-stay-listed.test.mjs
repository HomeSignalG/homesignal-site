// Plant-only Map 1 pages stay listed. "Nothing is being built" is a valid advertised
// answer. The old Unit 1 idea of dropping ~1,005 pages that have EPA plants and no
// parcel-precise new construction is rejected (2026-09-27).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const unit1 = readFileSync(join(root, 'docs/epa-decouple-phase2-unit1-core-completion-markers.sql'), 'utf8');
const exec = unit1.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const sitemap = readFileSync(join(root, 'scripts/gen_sitemap.py'), 'utf8');
const refreshSnaps = [
  'docs/app-refresh-zip-local-news-migration.sql',
  'docs/app-refresh-zip-gin-containment-migration.sql',
  'docs/app-refresh-zip-live-snapshot-2026-07-24.sql',
].map((f) => readFileSync(join(root, f), 'utf8'));

let fails = 0;
const ok = (name, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

const listed = ({ nd, ndp, nc, nf, nfc }) => (nd + nf + nc) > 0 && (ndp > 0 || nfc >= 3);
const plantsOnly = { nd: 0, ndp: 0, nc: 0, nf: 40, nfc: 40 };

ok('a ZIP with plants and no new construction stays listed', listed(plantsOnly) === true);
ok('Unit 1 SQL of record keeps the listing limb in the replacement value',
  /va\s+text :=[\s\S]*?\(_ndp > 0 or _nfc >= 3\)/.test(exec));
ok('Unit 1 SQL of record does not splice the rejected unlist expression into indexable',
  (() => {
    const m = exec.match(/va\s+text := ([\s\S]*?);\n\s*kb\s+text/);
    return !!m && !/\(\(_nd\+_nc\)>0 and _ndp > 0\)/.test(m[1]);
  })());
ok('Unit 1 verify fails closed if the plant limb is removed',
  /plant-only pages lost the indexable facility limb/.test(exec));
ok('every parked app_refresh_zip snapshot still lists on _nfc >= 3',
  refreshSnaps.length === 3 && refreshSnaps.every((s) => /_ndp > 0 or _nfc >= 3/.test(s)));
ok('the sitemap generator still advertises the indexable set (so a listing limb drop would unlist)',
  /indexable=is\.true/.test(sitemap) && /app_community_meta\.indexable/.test(sitemap));

console.log(`\n${fails ? `FAILED: ${fails}` : 'ALL PASS'} — plant-only map pages stay listed`);
if (fails) process.exit(1);

// ONE LEAFLET VERSION, EVERYWHERE IT IS NAMED.
// Run: node test/leaflet-version-pin.test.mjs
//
// The pages load Leaflet from jsDelivr at an exact version (`leaflet@X.Y.Z`). The browser
// suites prefer a LOCAL copy when one resolves, and two workflows install that copy with
// their own hard-coded version (`npm install ... leaflet@X.Y.Z` in unit-tests.yml and
// da-report-mutants.yml, added in #1653). Three places, one fact, no check tying them
// together: if the pages moved to a new Leaflet and a workflow did not, the browser suites
// would keep passing against the OLD library while residents ran the new one, and nothing
// would say so.
//
// This reads every file that names a version and requires that there is exactly ONE
// distinct version, and that the page, the two workflows and the browser suites are all
// among the files read (so an empty or mis-scoped scan cannot pass).
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('      ', typeof detail === 'string' ? detail : JSON.stringify(detail)); } };

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const self = relative(root, fileURLToPath(import.meta.url)).split(sep).join('/');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'docs', 'dist']);
const EXT = /\.(html|js|mjs|ts|py|yml|yaml)$/;

const found = new Map(); // relative path -> Set of versions
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name)); continue; }
    if (!EXT.test(e.name)) continue;
    const rel = relative(root, join(dir, e.name)).split(sep).join('/');
    if (rel === self) continue; // this file names the pattern, not a version
    const versions = new Set([...readFileSync(join(dir, e.name), 'utf8').matchAll(/leaflet@(\d+\.\d+\.\d+)/g)].map((m) => m[1]));
    if (versions.size) found.set(rel, versions);
  }
};
walk(root);

const all = new Set([...found.values()].flatMap((s) => [...s]));
const where = (v) => [...found].filter(([, s]) => s.has(v)).map(([f]) => f);

ok(found.size >= 20, 'the scan reads the files that name a Leaflet version (positive control: at least 20 of them)', found.size);
for (const must of ['homesignalmap.html', 'lib/map.js', '.github/workflows/unit-tests.yml', '.github/workflows/da-report-mutants.yml']) {
  ok(found.has(must), `${must} is among the files read`);
}
ok(all.size === 1, 'exactly ONE Leaflet version is named across the whole tree', Object.fromEntries([...all].map((v) => [v, where(v).slice(0, 6)])));

const pageVersion = [...(found.get('homesignalmap.html') || [])];
ok(pageVersion.length === 1, 'the map page names exactly one version', pageVersion);
for (const wf of ['.github/workflows/unit-tests.yml', '.github/workflows/da-report-mutants.yml']) {
  const v = [...(found.get(wf) || [])];
  ok(v.length === 1 && v[0] === pageVersion[0], `${wf} installs the version the map page loads`, { workflow: v, page: pageVersion });
}

console.log('\n' + (fails ? fails + ' failed' : 'all passed') + ' (' + found.size + ' files name a Leaflet version: ' + [...all].join(', ') + ')');
process.exit(fails ? 1 : 0);

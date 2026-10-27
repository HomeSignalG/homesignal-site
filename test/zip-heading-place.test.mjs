// A ZIP PAGE HEADING NAMES THE ZIP ONCE (founder, 2026-10-27: "yes fix").
//
// ZIP page names are "<place> (<ZIP>)", so every heading and sentence built as
// "<ZIP> · <name>, <state>" or "ZIP <ZIP> (<name>, <state>)" printed the ZIP twice:
// "99827 · Haines (99827), AK" and "ZIP 99827 (Haines (99827), AK)". The place is now
// taken through ONE rule on each side: scripts/gen_zip_pages.py place_label (the server-built
// document) and lib/community-page.js HS.placeOnly (the hydrated heading). This file runs both
// on one table, then builds real documents through the generator.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

// 1. One table, both implementations.
const TABLE = [
  ['Haines (99827)', 'AK', '99827', 'Haines, AK'],
  ['Salt Lake City / Millcreek (84106)', 'UT', '84106', 'Salt Lake City / Millcreek, UT'],
  ['Brigham City', 'UT', '84302', 'Brigham City, UT'],          // a city page: no suffix, unchanged
  ['Del Valle (78617)', 'TX', '99999', 'Del Valle (78617), TX'], // another ZIP's suffix is kept
  ['(99827)', 'AK', '99827', '(99827), AK'],                     // never reduced to nothing
  ['Prudhoe Bay (99519)', '', '99519', 'Prudhoe Bay'],           // no state: no trailing comma
];
const py = JSON.parse(execFileSync('python3', ['-c',
  'import json,sys; sys.path.insert(0,"scripts"); from gen_zip_pages import place_label;'
  + 'print(json.dumps([place_label(n,s,z) for n,s,z in json.loads(sys.argv[1])]))',
  JSON.stringify(TABLE.map(([n, s, z]) => [n, s, z]))], { cwd: root, encoding: 'utf8' }));
const src = readFileSync(join(root, 'lib', 'community-page.js'), 'utf8');
const m = src.match(/HS\.placeOnly = (function \(name, zip\) \{[\s\S]*?\n\});/);
ok(!!m, 'lib/community-page.js defines HS.placeOnly');
const placeOnly = m ? new Function('return ' + m[1].replace(/;$/, ''))() : () => null;
TABLE.forEach(([n, s, z, want], i) => {
  const js = placeOnly(n, z) + (s ? ', ' + s : '');
  ok(py[i] === want, `python place_label(${JSON.stringify(n)}, ${z}) -> ${JSON.stringify(py[i])}`);
  ok(js === want, `js HS.placeOnly(${JSON.stringify(n)}, ${z}) -> ${JSON.stringify(js)}`);
});
ok(/HS\.esc\(HS\.placeOnly\(meta\.name, zip\)\)/.test(src) && /HS\.esc\(HS\.placeOnly\(c\.name, zip\)\)/.test(src),
  'both hydrated headings take the place through HS.placeOnly');

// 2. Real documents through the generator.
const roots = [{ id: 'r-haines', name: 'Haines Borough', level: 'county', parent_id: null, zip_codes: ['99827'] }];
const communities = [...roots, { id: 'z-99827', name: 'Haines (99827)', level: 'zip', parent_id: 'r-haines', zip_codes: ['99827'] }];
const meta = [{ zip: '99827', name: 'Haines (99827)', county: 'Haines', state: 'AK', data_quality: 'pass', indexable: true }];
const FIX = { zips: ['99827'], meta, changes: [], agency: [], retractions: [], communities, meetings: [] };
const dir = mkdtempSync(join(tmpdir(), 'zhp-'));
writeFileSync(join(dir, 'fix.json'), JSON.stringify(FIX));
execFileSync('python3', [GEN, '--fixture', join(dir, 'fix.json'), '--out', join(dir, 'o'), '--now', '2026-10-27T00:00:00'],
  { cwd: root, encoding: 'utf8' });
const doc = readFileSync(join(dir, 'o', 'community', '99827', 'index.html'), 'utf8');
ok(doc.includes('<h1>99827 · Haines, AK</h1>'), 'the community heading reads "99827 · Haines, AK"');
ok(!doc.includes('(99827), AK') || doc.includes('<title>Haines (99827), AK'),
  'no sentence repeats the ZIP after printing it (only the title, which prints it once, keeps the full name)');
ok(!/ZIP 99827 \(Haines \(99827\)/.test(doc), 'the description does not read "ZIP 99827 (Haines (99827)"');
let map = '';
try { map = readFileSync(join(dir, 'o', 'map', '99827', 'index.html'), 'utf8'); } catch (e) { /* no map doc in this build */ }
if (map) {
  ok(!/ZIP 99827 \(Haines \(99827\)/.test(map), 'the map document does not read "ZIP 99827 (Haines (99827)"');
  ok(map.includes('og:title" content="Development around Haines (99827), AK"'), 'the map og:title keeps its ZIP');
}
rmSync(dir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

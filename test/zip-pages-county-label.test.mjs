// A ZIP PAGE NAMES ITS COUNTY-EQUIVALENT AS ITSELF, NEVER "<short name> County".
//
// gen_zip_pages.py used to append " County" to the short `county` join key. Measured
// 2026-10-26 on production: Haines (99827) read "in Haines County" (Alaska has boroughs),
// Baltimore city pages read "in Baltimore County" (a different government), and the
// sibling block grouped Baltimore city and Baltimore County ZIPs together because both
// carry county = "Baltimore". 41 roots (all Alaska, Louisiana parishes, Baltimore city,
// St. Louis city, Fairfax city, Virginia Beach city, Carson City) were affected.
// This fixture builds those shapes through the real generator.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

const roots = [
  { id: 'r-bcity', name: 'Baltimore city', level: 'county', parent_id: null, zip_codes: ['21201', '21202'] },
  { id: 'r-bcnty', name: 'Baltimore County', level: 'county', parent_id: null, zip_codes: ['21204', '21208'] },
  { id: 'r-haines', name: 'Haines Borough', level: 'county', parent_id: null, zip_codes: ['99827'] },
  { id: 'r-caddo', name: 'Caddo Parish', level: 'county', parent_id: null, zip_codes: ['71101'] },
];
const zipRow = (z, name, rootId) => ({ id: `z-${z}`, name, level: 'zip', parent_id: rootId, zip_codes: [z] });
const communities = [
  ...roots,
  zipRow('21201', 'Baltimore (21201)', 'r-bcity'), zipRow('21202', 'Baltimore (21202)', 'r-bcity'),
  zipRow('21204', 'Towson (21204)', 'r-bcnty'), zipRow('21208', 'Pikesville (21208)', 'r-bcnty'),
  zipRow('99827', 'Haines (99827)', 'r-haines'), zipRow('71101', 'Shreveport (71101)', 'r-caddo'),
  // no root at all: falls back to "<county> County"
  { id: 'z-01001', name: 'Agawam (01001)', level: 'zip', parent_id: null, zip_codes: ['01001'] },
];
const m = (zip, name, county, state) => ({ zip, name, county, state, data_quality: 'pass', indexable: true });
const meta = [
  m('21201', 'Baltimore (21201)', 'Baltimore', 'MD'), m('21202', 'Baltimore (21202)', 'Baltimore', 'MD'),
  m('21204', 'Towson (21204)', 'Baltimore', 'MD'), m('21208', 'Pikesville (21208)', 'Baltimore', 'MD'),
  m('99827', 'Haines (99827)', 'Haines', 'AK'), m('71101', 'Shreveport (71101)', 'Caddo', 'LA'),
  m('01001', 'Agawam (01001)', 'Hampden', 'MA'),
];
const ALL = meta.map((x) => x.zip);
const FIX = { zips: ALL, meta, changes: [], agency: [], retractions: [], communities, meetings: [] };

const dir = mkdtempSync(join(tmpdir(), 'cl-'));
const fixPath = join(dir, 'fix.json');
writeFileSync(fixPath, JSON.stringify(FIX));
execFileSync('python3', [GEN, '--fixture', fixPath, '--out', join(dir, 'o'), '--now', '2026-10-26T00:00:00'],
  { cwd: root, encoding: 'utf8' });
const doc = (z) => readFileSync(join(dir, 'o', 'community', z, 'index.html'), 'utf8');

ok(doc('99827').includes('in Haines Borough') && !doc('99827').includes('Haines County'), '99827 says Haines Borough, never Haines County');
ok(doc('71101').includes('in Caddo Parish') && !doc('71101').includes('Caddo County'), '71101 says Caddo Parish');
ok(doc('21201').includes('in Baltimore city') && !doc('21201').includes('Baltimore County'), 'a Baltimore city page never says Baltimore County');
ok(doc('21204').includes('in Baltimore County'), 'a Baltimore County page says Baltimore County');
ok(doc('01001').includes('in Hampden County'), 'no resolvable root falls back to "<county> County"');

const sibs = (z) => [...doc(z).matchAll(/href="\/community\/(\d{5})\/"/g)].map((x) => x[1]).filter((x) => x !== z);
ok(sibs('21201').includes('21202') && !sibs('21201').some((x) => x === '21204' || x === '21208'),
   'Baltimore city siblings are Baltimore city ZIPs only');
ok(sibs('21204').includes('21208') && !sibs('21204').some((x) => x === '21201' || x === '21202'),
   'Baltimore County siblings are Baltimore County ZIPs only');
ok(doc('21201').includes('More ZIP codes in Baltimore city, MD'), 'the sibling heading names Baltimore city');

rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

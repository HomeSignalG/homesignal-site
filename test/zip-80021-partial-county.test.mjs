// ZIP 80021 spans Jefferson and Broomfield counties; its sources are Jefferson County's only (founder, 2026-11-26).
// Runs the SHIPPED generator on a synthetic two-ZIP county and checks BOTH corrected statements, that the data
// is untouched (meetings and notices still listed), and that another ZIP in the same county keeps the generic wording.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('PASS —', n); } else { fail++; console.error('FAIL —', n, d || ''); } };

const fx = {
  zips: ['80021', '80022'],
  meta: ['80021', '80022'].map((z) => ({ zip: z, name: `${z === '80021' ? 'Broomfield' : 'Commerce City'} (${z})`, county: 'Jefferson', state: 'CO', data_quality: 'pass', indexable: true })),
  communities: [
    { id: 'county-j', parent_id: null, level: 'county', zip_codes: [], name: 'Jefferson County' },
    { id: 'zip-80021', parent_id: 'county-j', level: 'zip', zip_codes: ['80021'], name: 'Broomfield (80021)' },
    { id: 'zip-80022', parent_id: 'county-j', level: 'zip', zip_codes: ['80022'], name: 'Commerce City (80022)' },
  ],
  changes: ['80021', '80022'].flatMap((z) => [0, 1, 2].map((i) => ({ zip: z, community_id: 'county-j', category: 'Government & civic',
    title: `Planning Commission ${i}`, source_ref: `https://jeffco.example/${z}/${i}`, occurred_at: '2026-09-01' }))),
  agency: [], retractions: [],
  meetings: [{ community_id: 'county-j', title: 'Board of Adjustment', meeting_date: '2026-09-20T14:00:00',
    category: 'County Commission & county business', source_url: 'https://pub-jeffco.example/m1', id: 'm1' }],
};
const dir = mkdtempSync(join(tmpdir(), 'z80021-'));
try {
  writeFileSync(join(dir, 'fx.json'), JSON.stringify(fx));
  execFileSync('python3', [join(root, 'scripts/gen_zip_pages.py'), '--fixture', join(dir, 'fx.json'), '--out', join(dir, 'out'),
    '--now', '2026-09-04T00:00:00'], { encoding: 'utf8', stdio: 'pipe' });
  const doc = (z) => readFileSync(join(dir, 'out', 'community', z, 'index.html'), 'utf8');
  const a = doc('80021'), b = doc('80022');
  const DISC = 'ZIP 80021 spans Jefferson and Broomfield counties. The government notices and meetings currently shown are from Jefferson County and may not cover the entire ZIP code.';

  // 1. introduction
  ok('80021 carries the approved disclosure, word for word', a.includes(DISC));
  ok('80021 no longer says the records "apply to the whole of" the ZIP', !/apply to the whole of/.test(a));
  ok('80021 intro does not say the ZIP is "in Jefferson County"', !/for ZIP 80021 in Jefferson County/.test(a) && !/ZIP 80021 in Jefferson County/.test(a.replace(DISC, '')));
  // 2. sibling heading
  ok('80021 sibling heading is "Other ZIP codes with Jefferson County coverage"', a.includes('<h2>Other ZIP codes with Jefferson County coverage</h2>'));
  ok('80021 no longer headed "More ZIP codes in Jefferson County, CO"', !a.includes('More ZIP codes in Jefferson County'));
  ok('the sibling list still links the other ZIP', a.includes('href="/community/80022/"'));
  // 3. data and title preserved
  ok('page title keeps the postal city "Broomfield (80021), CO"', /<title>Broomfield \(80021\), CO/.test(a));
  ok('the sourced meeting and all three notices are still listed',
    a.includes('Board of Adjustment') && ['0', '1', '2'].every((i) => a.includes(`Planning Commission ${i}`)));
  ok('no Broomfield or Westminster government section is invented', !/Westminster/.test(a) && !/Broomfield (City|County) (Council|government)/i.test(a));
  // other ZIPs unchanged
  ok('another ZIP in the same county keeps the generic intro', /apply to the whole of ZIP 80022 in Jefferson County/.test(b));
  ok('another ZIP in the same county keeps the generic sibling heading', b.includes('<h2>More ZIP codes in Jefferson County, CO</h2>'));
  ok('the disclosure appears on no other ZIP', !b.includes('spans Jefferson and Broomfield'));
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

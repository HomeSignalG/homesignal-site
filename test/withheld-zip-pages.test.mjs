// WITHHELD ZIP PAGES — the list itself (offline). The behaviour is pinned by
// test/withheld-zip-pages.browser.test.mjs; this file pins WHICH ZIPs and that every reader
// reads the one list.
//
// The list holds two groups. The 47 decommissioned ZIPs were COMPUTED from the Fix 4 record (class
// DECOMMISSIONED_IN_DATASET), never typed. The unverified ZIPs (84684, 84685; founder, 2026-10-03) are
// described one by one under "unverified", and are NOT claimed retired, invalid, decommissioned or
// active. zips + restored must equal the two groups exactly, so a hand edit that drops or adds a ZIP
// fails here. The founder puts a ZIP back by MOVING it from "zips" to "restored".
//
// Run: node test/withheld-zip-pages.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 300)); }
};

const doc = JSON.parse(readFileSync(join(root, 'lib', 'withheld-zip-pages.json'), 'utf8'));
const zips = doc.zips, restored = doc.restored;

// §1 shape
ok(Array.isArray(zips) && Array.isArray(restored), '1a zips and restored are both lists');
ok(zips.every((z) => /^\d{5}$/.test(z)) && restored.every((z) => /^\d{5}$/.test(z)), '1b every entry is a 5-digit ZIP string');
ok(JSON.stringify(zips) === JSON.stringify([...new Set(zips)].sort()), '1c zips are sorted and unique');
ok(!restored.some((z) => zips.includes(z)), '1d no ZIP is both withheld and restored');
ok(zips.length > 0, '1e the list is not empty (an empty list would quietly put every page back)');

// §2 provenance: the Fix 4 record, recomputed here
const csvPath = join(root, doc.source);
const raw = readFileSync(csvPath);
ok(createHash('md5').update(raw).digest('hex') === doc.source_md5, '2a the source record is the one the list was computed from', doc.source_md5);
const lines = raw.toString('utf8').trim().split('\n');
const head = lines[0].split(',');
const iZip = head.indexOf('zip'), iClass = head.indexOf('class');
const cls = lines.slice(1).map((l) => l.split(',')).filter((r) => r[iClass] === doc.source_class).map((r) => r[iZip]).sort();
ok(cls.length === 47, '2b the source class holds 47 ZIPs', cls.length);
const unverified = doc.unverified || {};
const unverifiedZips = Object.keys(unverified).sort();
ok(JSON.stringify([...zips, ...restored].sort()) === JSON.stringify([...cls, ...unverifiedZips].sort()),
  '2c withheld + restored = the decommissioned class + the unverified ZIPs exactly (nothing typed by hand)');
ok(unverifiedZips.every((z) => !cls.includes(z)), '2d no unverified ZIP is in the decommissioned class');
ok(zips.length === cls.length + unverifiedZips.length, '2e the 47 decommissioned ZIPs are all still withheld, none dropped');

// §2f UNVERIFIED ZIPs 84684 and 84685 (founder, 2026-10-03). The metadata is pinned whole: a changed
// word in the notes, a flag flipped, or a claim that the ZIP is retired fails here.
const NOTES = (label) => `USPS lookup could not be performed on 2026-10-03. ZIP is absent from zipcodes 3.0.0 and Census 2010/2020 ZCTA datasets. Registry label '${label}' is unsourced and must not be treated as a confirmed ZIP locality. No geographic, civic, electoral, demographic, or map data may be derived. Re-audit only after USPS or USPS City State Product verification.`;
const WANT = {
  '84684': { zip_code: '84684', zip_status: 'unverified', zip_type: 'unknown', is_indexable: false, is_in_sitemap: false, page_action: 'REDIRECT_TO_SEARCH_OR_404', notes: NOTES('West Mountain') },
  '84685': { zip_code: '84685', zip_status: 'unverified', zip_type: 'unknown', is_indexable: false, is_in_sitemap: false, page_action: 'REDIRECT_TO_SEARCH_OR_404', notes: NOTES('Woodland Hills (84685)') },
};
ok(JSON.stringify(unverifiedZips) === '["84684","84685"]', '2f exactly 84684 and 84685 are listed as unverified', unverifiedZips);
ok(zips.includes('84684') && zips.includes('84685'), '2g both are on the withheld list every reader uses');
ok(JSON.stringify(unverified) === JSON.stringify(WANT), '2h the audit metadata is exactly the founder-approved record', unverified);
ok(!restored.includes('84684') && !restored.includes('84685'), '2i neither is restored');
const claims = /\b(retired|decommissioned|invalid|active)\b/i;
ok(unverifiedZips.every((z) => !claims.test(unverified[z].notes)), '2j the per-ZIP notes claim neither retired, decommissioned, invalid nor active');
ok(/^Existence not established/.test(doc.unverified_reason || '') && /Not classified as invalid, retired, decommissioned or geographic\./.test(doc.unverified_reason),
  '2j2 the group reason says existence is not established and disclaims every classification');
ok(doc.unverified_source_class === 'NOT_IN_ZIP_DATASET' && lines.slice(1).map((l) => l.split(',')).filter((r) => r[iClass] === 'NOT_IN_ZIP_DATASET').map((r) => r[iZip]).sort().join() === '84684,84685',
  '2k the Fix 4 record puts exactly these two in NOT_IN_ZIP_DATASET (not in the decommissioned class)');
ok(!zips.includes('84651') && !zips.includes('84653'), '2l the neighbouring real ZIPs 84651 and 84653 are NOT withheld');

// §3 one list, every reader
const shell = readFileSync(join(root, 'shell.js'), 'utf8');
ok(shell.includes("HS.WITHHELD_ZIPS_URL = 'lib/withheld-zip-pages.json'"), '3a shell.js reads lib/withheld-zip-pages.json');
const gen = readFileSync(join(root, 'scripts', 'gen_zip_pages.py'), 'utf8');
ok(/"lib", "withheld-zip-pages.json"/.test(gen) && /zips = \[z for z in zips if z not in withheld\]/.test(gen),
  '3b the page build reads the same list and drops those ZIPs');
const smg = readFileSync(join(root, 'scripts', 'gen_sitemap.py'), 'utf8');
ok(/"lib", "withheld-zip-pages.json"/.test(smg) && /index_zips -= withheld_zips\(\)/.test(smg),
  '3c the committed-sitemap generator reads the same list and drops those ZIPs');
const staged = execFileSync('python3', ['-c',
  'import sys; sys.path.insert(0, "scripts"); import stage_site; print("\\n".join(stage_site.staged_paths(".")))'],
  { cwd: root, encoding: 'utf8' }).split('\n');
ok(staged.includes('lib/withheld-zip-pages.json'), '3d the Pages artifact ships the list (shell.js fetches it)');
// 3e/3f: the sitemap generator reads these two ZIPs from the list, and the committed sitemap.xml lists neither
const wz = execFileSync('python3', ['-c',
  'import sys; sys.path.insert(0, "scripts"); import gen_sitemap; print(",".join(sorted(gen_sitemap.withheld_zips())))'],
  { cwd: root, encoding: 'utf8' }).trim().split(',');
ok(wz.includes('84684') && wz.includes('84685') && wz.length === zips.length, '3e gen_sitemap.withheld_zips() returns both unverified ZIPs (and the whole list)', wz.length);
const committedSitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
ok(!/zip=8468[45]\b/.test(committedSitemap) && !/\/community\/8468[45]\//.test(committedSitemap),
  '3f the committed sitemap.xml lists neither ZIP, as community.html, homesignalmap.html or /community/<zip>/');
ok(zips.every((z) => !committedSitemap.includes('zip=' + z)), '3g the committed sitemap lists no withheld ZIP at all');

// §4 the live verifiers' verdict (scripts/lib/withheld-zips-live.mjs)
const live = await import('../scripts/lib/withheld-zips-live.mjs');
const J = live.judgeWithheld;
ok(J('10048', true, { withheld: '10048', robots: 'noindex, nofollow' }).length === 0, '4a a withheld ZIP showing its noindex notice passes');
ok(J('10048', true, { withheld: null, robots: 'noindex' }).length === 1, '4b a withheld ZIP that still draws its page fails');
ok(J('10048', true, { withheld: '10048', robots: 'index, follow' }).length === 1, '4c a withheld ZIP whose notice is indexable fails');
ok(J('01001', false, { withheld: '01001', robots: 'noindex' }).length === 1, '4d a ZIP not on the list that shows the notice fails');
ok(J('01001', false, { withheld: null, robots: 'index' }).length === 0, '4e a ZIP not on the list that draws normally is left to the usual checks');
const realFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => ({ status: 404, ok: false });
  const a = await live.loadDeployedWithheld('https://x.test');
  ok(a.zips.size === 0, '4f a list the site does not serve yet means nothing is withheld on that deploy');
  globalThis.fetch = async () => ({ status: 500, ok: false });
  let threw = false; try { await live.loadDeployedWithheld('https://x.test'); } catch (e) { threw = true; }
  ok(threw, '4g any other read failure stops the check rather than passing it');
  globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => doc });
  const c = await live.loadDeployedWithheld('https://x.test');
  ok(c.zips.size === zips.length && c.zips.has('10048'), '4h a served list is read whole');
} finally { globalThis.fetch = realFetch; }

// §5 city and project pages: a withheld ZIP leaves their lists, and a city that COUNTS one stops
// the build. Pages run 36942358791 (2026-10-02) stopped on exactly this: the Brooklyn city page
// listed 11240 (withheld, held in the plane), and the build refuses a city naming a ZIP it did
// not write.
{
  const { mkdtempSync, writeFileSync, readFileSync: rf, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const W = '10048';
  const FIX = join(root, 'test', 'fixtures', 'city-pages');
  const runWith = (mutate) => {
    const dir = mkdtempSync(join(tmpdir(), 'whz-city-'));
    const fx = JSON.parse(rf(join(FIX, 'zip-pages.json'), 'utf8'));
    const plane = JSON.parse(rf(join(FIX, 'development_seo_plane.json'), 'utf8'));
    fx.zips = [...fx.zips, W].sort();
    fx.meta = (fx.meta || []).concat([{ zip: W, name: 'New York (10048)', county: 'New York', state: 'NY',
      data_quality: 'pass', indexable: true }]);
    mutate(plane);
    writeFileSync(join(dir, 'zip-pages.json'), JSON.stringify(fx));
    writeFileSync(join(dir, 'development_seo_plane.json'), JSON.stringify(plane));
    const out = join(dir, 'site');
    const r = spawnSync('python3', [join(root, 'scripts', 'gen_zip_pages.py'), '--fixture', join(dir, 'zip-pages.json'),
      '--out', out, '--now', '2026-09-28T00:00:00'], { encoding: 'utf8' });
    return { r, out, dir, rmSync };
  };
  // 5a: the city lists the withheld ZIP as a held ZIP (the Brooklyn shape) → the build succeeds
  const a = runWith((pl) => { const c = pl.cities['ma/amherst']; c.zips = [...c.zips, W]; c.held_zips = [...c.held_zips, W]; });
  ok(a.r.status === 0, '5a a city listing a withheld ZIP as held still builds', (a.r.stderr || a.r.stdout).slice(-300));
  if (a.r.status === 0) {
    const city = rf(join(a.out, 'city', 'ma', 'amherst', 'index.html'), 'utf8');
    ok(!city.includes(`/community/${W}/`) && !city.includes(W), '5b the city page does not link or name the withheld ZIP');
    ok(city.includes('/community/01004/'), '5c control: the city page still links its other held ZIP');
    ok(!existsSync(join(a.out, 'community', W)), '5d and no document was written for it');
  }
  a.rmSync(a.dir, { recursive: true, force: true });
  // 5e: a city that COUNTS a withheld ZIP as Rule D stops the build, naming it
  const b = runWith((pl) => {
    const c = pl.cities['ma/amherst']; c.zips = [...c.zips, W]; c.rule_d_zips = [...c.rule_d_zips, W];
    pl.zips[W] = JSON.parse(JSON.stringify(pl.zips['01002']));
  });
  ok(b.r.status !== 0 && /counts withheld ZIP\(s\) \['10048'\] as Rule D/.test(b.r.stdout + b.r.stderr),
    '5e a city counting a withheld ZIP as Rule D stops the build and names it', (b.r.stdout + b.r.stderr).slice(-300));
  b.rmSync(b.dir, { recursive: true, force: true });
}

console.log('FAILS: ' + fails);
process.exit(fails ? 1 : 0);

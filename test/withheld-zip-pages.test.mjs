// WITHHELD ZIP PAGES — the list itself (offline). The behaviour is pinned by
// test/withheld-zip-pages.browser.test.mjs; this file pins WHICH ZIPs and that every reader
// reads the one list.
//
// The list was COMPUTED from the Fix 4 record (class DECOMMISSIONED_IN_DATASET), never typed:
// zips + restored must equal that class exactly, so a hand edit that drops or adds a ZIP fails
// here. The founder puts a ZIP back by MOVING it from "zips" to "restored".
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
ok(JSON.stringify([...zips, ...restored].sort()) === JSON.stringify(cls),
  '2c withheld + restored = the decommissioned class exactly (nothing typed by hand)');

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

console.log('FAILS: ' + fails);
process.exit(fails ? 1 : 0);

// The committed sitemap.xml's STATIC half must equal scripts/gen_sitemap.py STATIC.
//
// WHY THIS EXISTS (2026-10-22, founder "remove deploy key"). `.github/workflows/sitemap.yml`
// regenerated sitemap.xml every day and pushed it to main with a deploy key. It is deleted: the
// build (gen_zip_pages.py::reconcile_sitemap) throws away both `?zip=` halves of the committed
// file (pages run 39735853225: -11702 community, -11657 development, i.e. all of them), so the
// daily commit changed nothing that is served. But the 8 static URLs ARE served as committed, and
// that workflow was the only thing that copied a STATIC edit into the file (#1555 and #1743 both
// reached production that way). Without it a STATIC edit would silently go nowhere, so this test
// fails until the committed file agrees, and the fix is offline and one command:
//     python3 scripts/gen_sitemap.py --static-only
//
// Run: node test/sitemap-static-half.test.mjs   (discovered by scripts/run-unit-tests.mjs)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail !== undefined ? '\n     ' + String(detail).slice(0, 800) : ''));
  if (!c) fails++;
};

// The generator's own answer, read by importing it (not by parsing its source).
const py = (code, cwd = ROOT) => spawnSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, 'scripts'))}); ${code}`],
  { cwd, encoding: 'utf8' });
const gen = py('import json, gen_sitemap as g; print(json.dumps({"base": g.BASE, "static": g.STATIC}))');
if (gen.status !== 0) { console.log('FAIL — could not import scripts/gen_sitemap.py\n' + gen.stderr); process.exit(1); }
const { base, static: STATIC } = JSON.parse(gen.stdout);
const expected = STATIC.map(([loc, freq, pri]) => ({ loc: base + loc, freq, pri }));

// Every <url> block, in file order, with its position relative to the first `?zip=` block.
export function staticHalf(xml) {
  const blocks = [...xml.matchAll(/<url>\s*<loc>([^<]*)<\/loc>\s*<changefreq>([^<]*)<\/changefreq>\s*<priority>([^<]*)<\/priority>\s*<\/url>/g)]
    .map((m) => ({ loc: m[1], freq: m[2], pri: m[3] }));
  const firstZip = blocks.findIndex((b) => b.loc.includes('?zip='));
  const stat = blocks.filter((b) => !b.loc.includes('?zip='));
  const afterZip = firstZip >= 0 && blocks.slice(firstZip).some((b) => !b.loc.includes('?zip='));
  return { all: blocks.length, zip: blocks.length - stat.length, stat, afterZip };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. The committed file agrees with STATIC ─────────────────────────────────────────────────
const committed = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
const h = staticHalf(committed);
ok(expected.length >= 8 && h.zip > 1000, `1a control: STATIC has ${expected.length} entries and the committed file ${h.zip} ?zip= URLs (the parse read real data)`);
ok(same(h.stat, expected) && !h.afterZip,
  '1b the committed sitemap.xml static half equals gen_sitemap.py STATIC (same URLs, changefreq, priority, order, all before the ?zip= half). '
  + 'If this fails after a STATIC edit, run: python3 scripts/gen_sitemap.py --static-only', JSON.stringify({ committed: h.stat, expected }));

// ── 2. The comparison fails on each kind of drift (in-memory) ────────────────────────────────
const dropTerms = committed.replace(/  <url>\n    <loc>[^<]*\/terms\.html<\/loc>[\s\S]*?<\/url>\n/, '');
ok(dropTerms !== committed && !same(staticHalf(dropTerms).stat, expected), '2a a STATIC entry missing from the file is caught');
const added = committed.replace('</urlset>', '  <url>\n    <loc>https://homesignal.net/new.html</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>\n</urlset>');
const ha = staticHalf(added);
ok(!same(ha.stat, expected) && ha.afterZip, '2b a static URL the generator does not list is caught (and one placed after the ?zip= half is noticed)');
const repri = committed.replace('<loc>https://homesignal.net/about.html</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>',
  '<loc>https://homesignal.net/about.html</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.9</priority>');
ok(repri !== committed && !same(staticHalf(repri).stat, expected), '2c a changed priority is caught');

// ── 3. --static-only repairs it offline, keeps the ?zip= half byte for byte, and is a no-op on a clean file
const tmp = mkdtempSync(join(tmpdir(), 'sitemap-static-'));
const runStatic = (content) => {
  writeFileSync(join(tmp, 'sitemap.xml'), content);
  // urlopen is replaced with a function that raises: the mode must make no network call.
  const r = py('import urllib.request; urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("network call")); '
    + 'import gen_sitemap as g; sys.argv = ["gen_sitemap.py", "--static-only"]; g.main()', tmp);
  return { r, out: readFileSync(join(tmp, 'sitemap.xml'), 'utf8') };
};
try {
  let x = runStatic(committed);
  ok(x.r.status === 0 && x.out === committed, '3a on the committed file it changes nothing (byte-identical) and makes no network call', x.r.stdout + x.r.stderr);
  for (const [label, broken] of [['a missing entry', dropTerms], ['an extra static URL', added], ['a changed priority', repri]]) {
    x = runStatic(broken);
    ok(x.r.status === 0 && x.out === committed, `3b it restores the committed bytes exactly from ${label}`, x.r.stdout + x.r.stderr);
  }
  const zipBefore = committed.match(/[ \t]*<url>\s*<loc>[^<]*\?zip=[\s\S]*?<\/url>\n/g).join('');
  ok(zipBefore.length > 100000 && runStatic(dropTerms).out.includes(zipBefore), '3c the ?zip= half is carried through untouched, in order');
  x = runStatic(committed.replace('</urlset>', '<!-- stray -->\n</urlset>'));
  ok(x.r.status !== 0 && x.out === committed.replace('</urlset>', '<!-- stray -->\n</urlset>'),
    '3d anything but <url> blocks inside <urlset> is refused and the file is left as it was (nothing is dropped silently)', x.r.stdout + x.r.stderr);
  x = runStatic('<?xml version="1.0"?>\n<nothing/>\n');
  ok(x.r.status !== 0, '3e a file with no <urlset> is refused');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL PASS');

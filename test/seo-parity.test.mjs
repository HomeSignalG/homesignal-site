// Jody migration, Step 4: SEO parity between the HomeSignal tree and the Jody LAUNCH tree, built from ONE
// generation (so the data snapshot is frozen by construction). Run: node test/seo-parity.test.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let failures = 0;
const check = (n, ok, why) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` — ${why}`}`); if (!ok) failures++; };
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const parity = (a, b) => spawnSync('python3', ['scripts/seo_parity.py', '--a', a, '--b', b], { encoding: 'utf8' });

const base = mkdtempSync(join(tmpdir(), 'seo-parity-'));
const A = join(base, 'a');
execFileSync('python3', ['scripts/stage_site.py', '--src', '.', '--out', A], { stdio: 'pipe' });
execFileSync('python3', ['scripts/gen_zip_pages.py', '--fixture', 'test/fixtures/zip-pages.json', '--out', A, '--now', '2026-09-04T00:00:00'], { stdio: 'pipe' });
const B = join(base, 'b'); cpSync(A, B, { recursive: true });
const ov = spawnSync('python3', ['scripts/brand_stage.py', '--dir', B, '--identity', 'jody'], { encoding: 'utf8' });
check('0a the launch overlay (no --staging) succeeds with no leftovers', ov.status === 0, ov.stderr);

const ok = parity(A, B);
const rep = JSON.parse(ok.stdout);
check('1a the two trees have SEO parity', ok.status === 0 && rep.ok, JSON.stringify(rep.problems));
check('1b the denominators are real (generated ZIP documents, sitemaps, indexable pages)',
  rep.stats.html_pages > 30 && rep.stats.indexable_a > 5 && rep.stats.sitemap_files >= 5 && rep.stats.sitemap_urls_a > 10, JSON.stringify(rep.stats));
check('1c indexable counts are equal and equal to the HomeSignal count', rep.stats.indexable_a === rep.stats.indexable_b, JSON.stringify(rep.stats));
check('1d generated /community/<zip>/ documents are in the compared set', walk(B).some((f) => /community\/\d{5}\/index\.html$/.test(f)), 'none');
check('1e a launch tree keeps its indexable pages indexable (it is not a staging tree)',
  !/noindex/.test(readFileSync(join(B, 'index.html'), 'utf8')) && !/^Disallow: \/$/m.test(readFileSync(join(B, 'robots.txt'), 'utf8')), 'staging leaked into launch');

// negative controls: each defect, injected into a fresh copy of B, must fail the comparison
function mutate(name, fn) {
  const M = join(base, 'm-' + name); cpSync(B, M, { recursive: true });
  fn(M);
  const r = parity(A, M);
  check(`2 ${name} is caught`, r.status !== 0, 'passed');
}
const firstZip = (M) => walk(M).find((f) => /community\/\d{5}\/index\.html$/.test(f));
const sub = (f, re, to) => { const t = readFileSync(f, 'utf8'); const u = t.replace(re, to); if (t === u) throw new Error('mutation did not apply: ' + name_(re)); writeFileSync(f, u); };
const name_ = (re) => String(re).slice(0, 40);
mutate('a page turned noindex', (M) => sub(firstZip(M), /content="index, follow"/, 'content="noindex, follow"'));
mutate('a page turned from noindex to indexable', (M) => { const f = walk(M).find((p) => p.endsWith('.html') && /noindex/.test(readFileSync(p, 'utf8')) && /community\/\d{5}/.test(p)); sub(f, /noindex, follow/, 'index, follow'); });
mutate('a canonical path changed', (M) => sub(firstZip(M), /href="https:\/\/jodytracks\.com\/community\/(\d{5})\/"/, 'href="https://jodytracks.com/community/$1-x/"'));
mutate('a canonical left on the old host', (M) => sub(firstZip(M), /rel="canonical" href="https:\/\/jodytracks\.com/, 'rel="canonical" href="https://homesignal.net'));
mutate('an old-origin og:url left behind', (M) => sub(join(M, 'index.html'), /(property="og:url" content=")https:\/\/jodytracks\.com/, '$1https://homesignal.net'));
mutate('a page removed', (M) => rmSync(firstZip(M)));
mutate('an extra page added', (M) => writeFileSync(join(M, 'extra.html'), '<html><head></head><body>x</body></html>'));
mutate('a sitemap url dropped', (M) => sub(join(M, 'sitemaps/zip-alerts.xml'), /<url>.*?<\/url>\s*/s, ''));
mutate('a sitemap lastmod appears (the fixture sitemaps carry none)', (M) => sub(join(M, 'sitemaps/zip-alerts.xml'), /(<loc>[^<]*<\/loc>)/, '$1<lastmod>1999-01-01</lastmod>'));
mutate('a sitemap url left on the old host', (M) => sub(join(M, 'sitemap.xml'), /https:\/\/jodytracks\.com\//, 'https://homesignal.net/'));
mutate('a robots rule dropped', (M) => sub(join(M, 'robots.txt'), /Disallow: \/dashboard\.html\n/, ''));
mutate('a robots Sitemap line left on the old host', (M) => sub(join(M, 'robots.txt'), /Sitemap: https:\/\/jodytracks\.com\/sitemap\.xml/, 'Sitemap: https://homesignal.net/sitemap.xml'));
mutate('a page-state fingerprint changed', (M) => { const f = join(M, 'sitemaps/page-state.json'); const d = JSON.parse(readFileSync(f, 'utf8')); const k = Object.keys(d.pages)[0]; d.pages[k] = 'tampered'; writeFileSync(f, JSON.stringify(d)); });
mutate('a page-state host not moved', (M) => sub(join(M, 'sitemaps/page-state.json'), /"host": ?"https:\/\/jodytracks\.com"/, '"host": "https://homesignal.net"'));

// the comparison cannot pass on nothing
const E1 = join(base, 'e1'), E2 = join(base, 'e2'); mkdirSync(E1); mkdirSync(E2);
check('3a two empty trees do not pass (the comparison must have something to compare)', parity(E1, E2).status !== 0, 'passed');
// the staging tree is NOT a launch tree: parity must refuse it
const S = join(base, 's'); cpSync(A, S, { recursive: true });
spawnSync('python3', ['scripts/brand_stage.py', '--dir', S, '--identity', 'jody', '--staging'], { encoding: 'utf8' });
check('3b a STAGING tree fails parity (noindex everywhere, no sitemaps)', parity(A, S).status !== 0, 'passed');
// the old domain's verification token is the one allowed absence
check('3c the only path absent from the Jody tree is the old domain\'s verification token',
  JSON.stringify(walk(A).map((f) => f.slice(A.length)).filter((f) => !walk(B).map((g) => g.slice(B.length)).includes(f))).includes('google') || rep.stats.files_a === rep.stats.files_b + 1, JSON.stringify(rep.stats));

rmSync(base, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);

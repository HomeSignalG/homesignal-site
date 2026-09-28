// Gates for the generated city Development pages (SEO plan steps 9 and 10).
//
// Runs the SHIPPED generator and the SHIPPED Type/lifecycle adapter over a fixture, so the
// checks cannot drift from production the way a re-implementation would. Pinned:
//   1. a city page exists only for a city the plane qualified, is indexable, and is in the sitemap
//   2. the Type and lifecycle mix come from lib/project-type.js and sum to the project count
//   3. a held ZIP is named and never counted; the sentences say how many ZIPs were counted
//   4. City -> ZIP -> project links are real crawlable HTML, and a ZIP page links up only
//      to a city page that exists
//   5. source text is escaped; the page ships no script
//   6. an inconsistent plane fails the build instead of publishing a page nobody can vouch for
//   7. identical input produces byte-identical output
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAuthority, annotateCity, TYPE_NOT_STATED } from '../scripts/annotate-dev-seo-ssr.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
const FIXDIR = join(root, 'test', 'fixtures', 'city-pages');
const FIX = join(FIXDIR, 'zip-pages.json');
const PLANE = JSON.parse(readFileSync(join(FIXDIR, 'development_seo_plane.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://homesignal.net/</loc>
  </url>
</urlset>
`;

function build(fixture = FIX) {
  const out = mkdtempSync(join(tmpdir(), 'city-'));
  writeFileSync(join(out, 'sitemap.xml'), SITEMAP);
  execFileSync('python3', [GEN, '--fixture', fixture, '--out', out, '--now', '2026-09-28T00:00:00'],
    { encoding: 'utf8' });
  return out;
}
function buildWithPlane(plane) {
  const dir = mkdtempSync(join(tmpdir(), 'cityfix-'));
  writeFileSync(join(dir, 'zip-pages.json'), readFileSync(FIX, 'utf8'));
  writeFileSync(join(dir, 'development_seo_plane.json'), JSON.stringify(plane));
  const out = mkdtempSync(join(tmpdir(), 'city-'));
  return spawnSync('python3', [GEN, '--fixture', join(dir, 'zip-pages.json'), '--out', out,
    '--now', '2026-09-28T00:00:00'], { encoding: 'utf8' });
}

const out = build();
const cityFile = join(out, 'city', 'ma', 'amherst', 'index.html');
const city = readFileSync(cityFile, 'utf8');
const man = JSON.parse(readFileSync(join(out, 'zip-pages-manifest.json'), 'utf8'));
const sm = readFileSync(join(out, 'sitemap.xml'), 'utf8');

// ---- 1. existence, robots, canonical, sitemap ----------------------------------------
ok(existsSync(cityFile), 'the qualified city has a page at /city/ma/amherst/');
ok(!existsSync(join(out, 'city', 'ma', 'belchertown')), 'a one-ZIP town gets no city page');
ok(/<meta name="robots" content="index, follow">/.test(city), 'the city page is indexable');
ok(city.includes('<link rel="canonical" href="https://homesignal.net/city/ma/amherst/">'),
   'the city page is self-canonical');
ok(/<title>Development in Amherst, MA — 7 projects on record \| HomeSignal<\/title>/.test(city),
   'the title names the city, state and project count');
ok(JSON.stringify(man.city_pages) === JSON.stringify(['/city/ma/amherst/']),
   'the manifest records exactly the city pages written');
ok(sm.includes('<loc>https://homesignal.net/city/ma/amherst/</loc>'), 'the sitemap advertises the city page');
ok((sm.match(/\/city\//g) || []).length === 1, 'the sitemap advertises no other city URL');

// ---- 2. Type / lifecycle mix through the one authority ---------------------------------
const HS = loadAuthority();
const annotated = annotateCity(HS, PLANE.cities['ma/amherst']);
ok(annotated.facts === undefined, 'raw facts are not carried past the adapter');
const sum = (mix) => mix.reduce((a, x) => a + x.n, 0);
ok(sum(annotated.type_mix) === 7 && sum(annotated.lifecycle_mix) === 7,
   'both mixes sum to the city project count');
const res = annotated.type_mix.find((x) => x.label === 'Residential');
ok(res && res.n === 3, 'a generic "Development" record is typed from its name by lib/project-type.js');
ok(/<li>Residential <span class="quiet">3<\/span><\/li>/.test(city), 'the page renders that mix');
ok(/<li>Operating \/ built <span class="quiet">1<\/span><\/li>/.test(city),
   'lifecycle labels are the authority\'s own words');
const blank = annotateCity(HS, { facts: [['Other project', 'x', 'Proposed', 1]] });
ok(blank.type_mix.length === 1 && blank.type_mix[0].label !== '', 'every fact lands in a Type bucket');
ok(typeof TYPE_NOT_STATED === 'string' && TYPE_NOT_STATED.length > 0, 'an ungiven Type has an honest bucket');

// ---- 3. held ZIPs ----------------------------------------------------------------------
ok(city.includes('across 2 of the 3 ZIP codes named Amherst'), 'the lead says how many ZIPs were counted');
ok(/Amherst \(01004\)<\/a> <span class="quiet">not yet measured — not counted<\/span>/.test(city),
   'the held ZIP is named and marked not counted');

// ---- 4. links ----------------------------------------------------------------------------
for (const z of ['01002', '01003', '01004']) {
  ok(city.includes(`<a href="/community/${z}/">`), `city page links down to ZIP ${z}`);
  const zp = readFileSync(join(out, 'community', z, 'index.html'), 'utf8');
  ok(zp.includes('<a href="/city/ma/amherst/">Development across Amherst, MA</a>'),
     `ZIP ${z} links up to its city page`);
}
for (const z of ['01007', '01009']) {
  const zp = readFileSync(join(out, 'community', z, 'index.html'), 'utf8');
  ok(!zp.includes('class="zcity"'), `ZIP ${z} links to no city page that does not exist`);
}
ok(/<a href="https:\/\/permits\.example\.gov\/r\/1" rel="nofollow noopener">Olympia Place Apartments<\/a>/.test(city),
   'each project links to its official source record');
const z1 = readFileSync(join(out, 'community', '01002', 'index.html'), 'utf8');
ok(z1.indexOf('<nav class="zsec">') < z1.indexOf('<nav class="zcity"'),
   'the up-link does not steal the first <nav class="zsec"> the live proof reads');

// ---- 5. escaping, no script ------------------------------------------------------------
ok(!city.includes('<script>alert(1)</script>'), 'a hostile project name is escaped');
ok(city.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'and still shown as text');
ok(!/<script[\s>]/i.test(city), 'the city page ships no script');
ok(city.includes("script-src 'none'"), 'and its CSP refuses scripts');

// ---- 6. an inconsistent plane fails the build ------------------------------------------
{
  const bad = JSON.parse(JSON.stringify(PLANE));
  bad.cities['ma/amherst'].rule_d_zips = ['01002', '01004'];
  const r = buildWithPlane(bad);
  ok(r.status !== 0 && /counts 01004 as Rule D/.test(r.stderr + r.stdout),
     'a city naming a non-Rule-D ZIP as Rule D fails the build');
}
{
  const bad = JSON.parse(JSON.stringify(PLANE));
  bad.cities['ma/amherst'].meaningful_entity_count = 9;
  const r = buildWithPlane(bad);
  ok(r.status !== 0 && /mix covers 7 projects, count says 9/.test(r.stderr + r.stdout),
     'a count the facts do not add up to fails the build');
}
{
  const bad = JSON.parse(JSON.stringify(PLANE));
  bad.cities['ma/amherst'].rule_d_zips = ['01002'];
  const r = buildWithPlane(bad);
  ok(r.status !== 0 && /producer's bar was not met/.test(r.stderr + r.stdout),
     'a city with one Rule D ZIP fails the build');
}
{
  // Production requires the section: a plane without it would silently remove every city page.
  const noCities = JSON.parse(JSON.stringify(PLANE));
  delete noCities.cities;
  const dir = mkdtempSync(join(tmpdir(), 'nocity-'));
  const p = join(dir, 'plane.json');
  writeFileSync(p, JSON.stringify(noCities));
  const py = `import sys, datetime; sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))})
import gen_zip_pages as g
g.load_dev_plane(${JSON.stringify(p)}, required=True, cities_out={},
                 now=datetime.datetime(2026, 9, 28, 1, tzinfo=datetime.timezone.utc))
print("LOADED")`;
  const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  ok(r.status !== 0 && /no cities section/.test(r.stderr + r.stdout),
     'a production plane without a cities section fails the build');
}

// ---- 6b. the published form: cities in their own file, from the same run ----------------
function buildSplit(cityDocPatch = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'citysplit-'));
  writeFileSync(join(dir, 'zip-pages.json'), readFileSync(FIX, 'utf8'));
  const { cities, ...zipPlane } = JSON.parse(JSON.stringify(PLANE));
  writeFileSync(join(dir, 'development_seo_plane.json'), JSON.stringify(zipPlane));
  writeFileSync(join(dir, 'development_seo_cities.json'), JSON.stringify({
    version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at,
    cities, ...cityDocPatch }));
  const o = mkdtempSync(join(tmpdir(), 'city-'));
  const r = spawnSync('python3', [GEN, '--fixture', join(dir, 'zip-pages.json'), '--out', o,
    '--now', '2026-09-28T00:00:00'], { encoding: 'utf8' });
  return { r, o };
}
{
  const { r, o } = buildSplit();
  ok(r.status === 0 && readFileSync(join(o, 'city', 'ma', 'amherst', 'index.html'), 'utf8') === city,
     'a separate cities file from the same run builds the identical city page');
}
{
  const { r } = buildSplit({ generated_at: '2026-09-27T00:00:00Z' });
  ok(r.status !== 0 && /does not match the plane/.test(r.stderr + r.stdout),
     'a cities file from a different run fails the build');
}

// ---- 7. determinism --------------------------------------------------------------------
const again = readFileSync(join(build(), 'city', 'ma', 'amherst', 'index.html'), 'utf8');
ok(again === city, 'two builds of the same input write byte-identical city pages');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

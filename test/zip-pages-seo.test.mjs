// Gates for the generated canonical ZIP documents (Alerts SEO unit).
//
// These run the SHIPPED generator over a fixture, so they cannot drift from production the
// way a re-implementation would. Four things are pinned, each of which would be invisible
// at runtime if it broke:
//   1. no point/radius/address symbol may enter the Alerts render path (6d9ce37 invariant)
//   2. source-controlled text may never inject markup
//   3. robots is decided at build time, and weather can never carry a page over Rule F
//   4. identical input produces byte-identical output
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
const FIX = join(root, 'test', 'fixtures', 'zip-pages.json');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

const STAGED_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://homesignal.net/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://homesignal.net/community.html?zip=01001</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://homesignal.net/community.html?zip=01002</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://homesignal.net/homesignalmap.html?zip=01002</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>
`;

function build() {
  const out = mkdtempSync(join(tmpdir(), 'zp-'));
  // Stage a sitemap the way the Pages build does (rsync of the committed site), so the
  // in-artifact reconciliation runs over a realistic file rather than the empty-file path.
  writeFileSync(join(out, 'sitemap.xml'), STAGED_SITEMAP);
  execFileSync('python3', [GEN, '--fixture', FIX, '--out', out, '--now', '2026-09-04T00:00:00'],
    { encoding: 'utf8' });
  return out;
}
const read = (out, zip) => readFileSync(join(out, 'community', zip, 'index.html'), 'utf8');

// ---- 1. NO-POINT / NO-RADIUS GATE ------------------------------------------------------
// A ZIP page represents the whole ZIP geography. If any of these appear in the generator,
// eligibility has started depending on a point and the certified invariant is broken.
const gen = readFileSync(GEN, 'utf8');
const code = gen.split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))          // prose may NAME them; code may not
  .join('\n')
  .replace(/"""[\s\S]*?"""/g, '');                        // nor may the module docstring
for (const banned of ['zip_centroids', 'distance_mi', 'withDistance', 'homeFor',
                      'app_projects', 'centroid', 'radius', 'nearest', 'home_lat', 'home_lng']) {
  ok(!code.includes(banned), `generator code contains no "${banned}"`);
}
ok(/_lat\b/.test(code) === false && /_lng\b/.test(code) === false,
   'generator code contains no _lat/_lng');
ok(gen.includes('app_changes.zip') || gen.includes('"app_changes"') || gen.includes('app_changes'),
   'generator reads app_changes (ZIP-keyed applicability)');
ok(gen.includes('parent_id'), 'generator walks the jurisdiction chain for meetings');

// ---- 2. SECURITY ------------------------------------------------------------------------
const out1 = build();
const hostile = read(out1, '99999');
ok(!hostile.includes('<script>alert(1)</script>'), 'script-like community name is escaped');
ok(!hostile.includes('<img src=x onerror=alert(1)>'), 'script-like alert title is escaped');
ok(hostile.includes('&lt;img src=x onerror=alert(1)&gt;'), '...and appears in escaped form');
ok(!hostile.includes('href="javascript:'), 'javascript: URL is never emitted as an href');
ok(hostile.includes('a=1&amp;b=2'), 'ampersand in a URL is escaped');
ok(hostile.includes('&quot;'), 'double quotes are escaped');
ok((hostile.match(/<script/g) || []).length === (hostile.match(/<script src="/g) || []).length,
   'every <script in the document is a src= tag — no inline script was injected');

// ---- 3. ROBOTS / RULE F -----------------------------------------------------------------
const a = read(out1, '01001'), wxOnly = read(out1, '01002'), devFail = read(out1, '07010');
ok(a.includes('<meta name="robots" content="index, follow"'), 'Rule F pass ships index, follow');
ok(wxOnly.includes('<meta name="robots" content="noindex, follow"'),
   'weather-only page ships noindex, follow — weather never carries Rule F');
ok(wxOnly.includes('Wind advisory'), '...while weather is still DISPLAYED');
ok(devFail.includes('<meta name="robots" content="index, follow"'),
   'Alerts PASS + development FAIL is indexable — page-purpose separation');
ok(!a.includes('RETRACTED'), 'an actively retracted Local News item is excluded');
ok(a.includes('rel="canonical" href="https://homesignal.net/community/01001/"'), 'canonical is the ZIP path');
ok(a.includes('<h1>01001 · Agawam (01001), MA</h1>'), 'ZIP-specific H1 in the initial HTML');
ok(a.includes('<title>Agawam (01001), MA'), 'ZIP-specific title in the initial HTML');
ok(/<meta name="description" content="[^"]{40,}"/.test(a), 'ZIP-specific meta description');
ok(a.includes('data-zip="01001"'), 'document declares its ZIP identity for hydration');
ok(a.includes('Town approves new library'), 'actual Alerts content is in the initial HTML');
// two different ZIPs must differ in all three identity fields
const b = read(out1, '07010');
for (const [re, what] of [[/<link rel="canonical" href="([^"]+)"/, 'canonical'],
                          [/<title>([^<]+)<\/title>/, 'title'], [/<h1>([^<]+)<\/h1>/, 'H1']]) {
  ok(re.exec(a)[1] !== re.exec(b)[1], `two ZIPs have different ${what}`);
}

// ---- 4. DETERMINISM + REGISTRY ----------------------------------------------------------
const out2 = build();
ok(read(out2, '01001') === a && read(out2, '99999') === hostile,
   'identical input produces byte-identical output');
const man = JSON.parse(readFileSync(join(out1, 'zip-pages-manifest.json'), 'utf8'));
ok(man.documents === 5, 'a document exists for EVERY canonical ZIP, pass or fail');
ok(man.rule_f_pass === 3 && man.rule_f_fail === 2, 'manifest pass/fail matches Rule F');
ok(!existsSync(join(out1, 'community', '80249')), 'no document for the removed 80249 drift ZIP');
rmSync(out2, { recursive: true, force: true });

// ---- 5. UPCOMING MEETINGS follow the SHIPPED read, not a second definition ---------------
// Sibling-exclusion and the forward-date window are what stop a ZIP page asserting another
// town's council meeting, or a 2020 meeting, as "upcoming" — and Rule F counts these rows,
// so a wrong one both misinforms a resident and buys an index slot.
ok(a.includes('Agawam City Council'), "this ZIP's own city council renders");
ok(!a.includes('Springfield City Council'),
   'a sibling town\'s council on the shared county root is EXCLUDED (Provo/Alpine rule)');
ok(!a.includes('Past meeting must never appear'),
   'a past-dated meeting never renders under "Upcoming public meetings"');
ok(/3 upcoming meetings|2 upcoming meetings/.test(a) === true,
   'the meta description counts the meetings actually rendered');

// ---- 6. LOCAL NEWS is represented on the page that is qualified by it --------------------
// d4392d7 measured the mismatch: local news counted toward Rule F while community.html
// never rendered it. Both halves are asserted — the generated document AND the shared
// runtime that hydrates it.
ok(/<h2>Local news<\/h2>/.test(a), 'the generated document renders a Local news section');
ok(a.includes('School budget debated'), '...carrying the real local-news item');
const runtime = readFileSync(join(root, 'lib', 'community-page.js'), 'utf8');
ok(/HS\.data\.news\(/.test(runtime), 'the hydrated page READS local news');
ok(/Local news/.test(runtime), '...and renders a Local news section too');

// ---- 7. PAGE-PURPOSE SEPARATION — all four states, from the fixture ----------------------
// The community document's robots is decided by Rule F ALONE. The development/facility flag
// (app_community_meta.indexable) still governs homesignalmap.html and must not leak here.
const st = (zip) => read(out1, zip).includes('content="index, follow"');
ok(st('01001') === true,  'A  Alerts PASS + development PASS  -> index, follow');
ok(st('07010') === true,  'B  Alerts PASS + development FAIL  -> index, follow (Alerts alone qualifies)');
ok(st('01002') === false, 'C  Alerts FAIL + development PASS  -> noindex (development cannot carry it)');
ok(st('02543') === false, 'D  Alerts FAIL + development FAIL  -> noindex');
ok(read(out1, '01002').includes('content="noindex, follow"'), 'a failing page is noindex, FOLLOW');

// ---- 8. SITEMAP RECONCILIATION ----------------------------------------------------------
const sm = readFileSync(join(out1, 'sitemap.xml'), 'utf8');
const smZips = [...sm.matchAll(/<loc>[^<]*\/community\/(\d{5})\/<\/loc>/g)].map((m) => m[1]).sort();
ok(!/community\.html\?zip=/.test(sm), 'the legacy community.html?zip= URL is gone from the artifact sitemap');
ok(JSON.stringify(smZips) === JSON.stringify(man.indexable_zips),
   'the sitemap advertises EXACTLY the Rule F pass set');
ok(man.sitemap_community_urls === man.rule_f_pass, 'manifest reconciles sitemap count with Rule F pass');
ok(sm.includes('homesignalmap.html?zip=01002'),
   'the development half of the sitemap is untouched (page-purpose separation)');
ok(sm.includes('<loc>https://homesignal.net/</loc>'), 'static URLs survive the rewrite');

// ---- 9. INITIAL-HTML CONTRACT extras ----------------------------------------------------
ok(/Compiled from official public records on <time datetime="2026-09-04">/.test(a),
   'the document is honestly dated with the build day');
ok(a.includes('href="/homesignalmap.html?zip=01001"') && a.includes('href="/"'),
   'the initial HTML carries usable internal links');
ok(!a.includes('href="/community.html?zip='),
   'the canonical document never links to the legacy URL it canonicalises away from');
ok(read(out1, '02543').includes('No government notices on file for this ZIP yet.'),
   'an honest-empty page still names every section and says so truthfully');


rmSync(out1, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

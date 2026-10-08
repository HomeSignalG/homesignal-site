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
import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
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
ok(wxOnly.includes('<meta name="robots" content="index, follow"'),
   'Alerts-fail + Rule D pass ships index, follow — Development qualifies');
ok(wxOnly.includes('Wind advisory'), '...while weather is still DISPLAYED (and still does not count for Rule F)');
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
ok(man.rule_d_pass === 1, 'manifest records the one Rule D passer (01002)');
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

// ---- 7. INDEX = Rule F OR Rule D --------------------------------------------------------
// app_community_meta.indexable still governs homesignalmap.html and is NOT Rule D.
// Rule D is the compact Development SEO plane: ≥3 publishable entities in the HTML.
const st = (zip) => read(out1, zip).includes('content="index, follow"');
ok(st('01001') === true,  'A  Alerts PASS + development flag PASS  -> index, follow');
ok(st('07010') === true,  'B  Alerts PASS + development flag FAIL  -> index, follow (Alerts alone qualifies)');
ok(st('01002') === true,  'C  Alerts FAIL + Rule D PASS  -> index (Development qualifies)');
ok(st('02543') === false, 'D  Alerts FAIL + Rule D FAIL  -> noindex');
ok(read(out1, '02543').includes('content="noindex, follow"'), 'a failing page is noindex, FOLLOW');
ok(/<h2>Development<\/h2>/.test(wxOnly), 'Rule D page renders Development in the initial HTML');
ok(wxOnly.includes('Traffic safety improvements on Route 9 at Old Farm Road'),
   '...carrying a real official Development name');
{
  const genSrc = readFileSync(GEN, 'utf8');
  const adapterSrc = readFileSync(join(root, 'scripts', 'annotate-dev-seo-ssr.mjs'), 'utf8');
  ok(genSrc.includes('annotate-dev-seo-ssr.mjs'), 'generator invokes the project-type.js adapter');
  ok(genSrc.includes('type_label') && genSrc.includes('lifecycle_label'),
     'generator renders labels from the adapter, not ingest-classified strings');
  ok(!/LIFECYCLE_LABELS|canonicalTypeLabel|function lifecycleKey/.test(genSrc),
     'generator does not copy project-type.js rules');
  ok(adapterSrc.includes('const typeInfo = HS.canonicalProjectType(row)')
     && adapterSrc.includes('const lifecycle = HS.canonicalLifecycle(row)'),
     'adapter uses HS.canonicalProjectType(row) and HS.canonicalLifecycle(row)');
  ok(!/classifyProjectType\(row\)/.test(
        adapterSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
     'adapter does not render HS.classifyProjectType(row)');
  ok(!adapterSrc.includes('canonicalProjectType({ type: row.type, name: row.name })'),
     'adapter does not project the row down to { type, name }');
  ok(!/const CATEGORY_REGISTRY|const TYPE_EXACT|const KEYWORD_RULES/.test(adapterSrc),
     'adapter does not redeclare the classifier');
}
ok(wxOnly.includes('Proposed') && wxOnly.includes('Operating / built'),
   'SSR lifecycle labels come from lib/project-type.js (Proposed + Operating / built)');
ok(!wxOnly.includes('No qualifying records on file yet'),
   'Rule-D-only metadata does not describe the page as empty');
ok(!/<h2>Development<\/h2>/.test(read(out1, '02543')),
   'a ZIP absent from the plane gets no invented Development section');

// ---- 8. SITEMAP RECONCILIATION ----------------------------------------------------------
const sm = readFileSync(join(out1, 'sitemap.xml'), 'utf8');
const smZips = [...sm.matchAll(/<loc>[^<]*\/community\/(\d{5})\/<\/loc>/g)].map((m) => m[1]).sort();
ok(!/community\.html\?zip=/.test(sm), 'the legacy community.html?zip= URL is gone from the artifact sitemap');
ok(JSON.stringify(smZips) === JSON.stringify(man.indexable_zips),
   'the sitemap advertises EXACTLY the index-eligible set (Rule F OR Rule D)');
ok(man.sitemap_community_urls === man.rule_f_pass + man.rule_d_pass,
   'manifest reconciles sitemap count with Rule F ∪ Rule D');
ok(smZips.includes('01002'), 'a Rule-D-only ZIP is advertised');
ok(!smZips.includes('02543'), 'a ZIP that fails both rules is not advertised');
// REVERSED 2026-09-19, deliberately. This used to assert the development half was
// "untouched (page-purpose separation)". Measured against production that day: every
// homesignalmap.html?zip= URL serves a byte-identical document (Pages ignores the query
// string), ships `noindex, nofollow`, and canonicalises to the ZIP-less URL — so the
// sitemap was advertising 11,718 noindex duplicates of one page, 59% of its entries.
// A sitemap entry contradicting its own URL's robots value is the one thing this
// generator's docstring forbids; the rule had only ever been checked on the community
// half. Restoring the advertisement means making those URLs real documents, not
// reverting this line.
ok(!/homesignalmap\.html\?zip=/.test(sm),
   'the noindex development URLs are dropped from the artifact sitemap');
ok(man.sitemap_dev_urls_removed === 1,
   'the manifest records how many development URLs were dropped (fixture stages 1)');
ok(sm.includes('<loc>https://homesignal.net/</loc>'), 'static URLs survive the rewrite');

// ---- 8b. SHARING + STRUCTURED DATA ------------------------------------------------------
// Added 2026-09-19. The homepage carried Open Graph and these documents did not, so every
// shared link rendered bare on the 8,180 pages the service spreads through.
const ogPage = read(out1, '01001');          // Rule F PASS
const noIdx  = read(out1, '02543');          // both rules FAIL
for (const [tag, want] of [
  ['og:type', 'website'], ['og:site_name', 'HomeSignal'], ['og:locale', 'en_US'],
]) {
  ok(ogPage.includes(`<meta property="${tag}" content="${want}">`), `${tag} is ${want}`);
}
ok(/<meta property="og:title" content="Agawam \(01001\), MA/.test(ogPage),
   'og:title carries the ZIP-specific title');
ok(ogPage.includes('<meta property="og:url" content="https://homesignal.net/community/01001/">'),
   'og:url is this document\'s own canonical URL');
ok(ogPage.includes('<meta property="og:image" content="https://homesignal.net/og-default.png">'),
   'og:image is ABSOLUTE — social crawlers do not resolve relative URLs or read <base>');
ok(ogPage.includes('<meta name="twitter:card" content="summary_large_image">'),
   'twitter:card is declared');
// A noindex page is still SHARED by residents, so it carries the tags too.
ok(/<meta property="og:title" content="Woods Hole \(02543\), MA/.test(noIdx),
   'a noindex page still carries Open Graph — robots governs crawling, not sharing');

// ---- 9. INITIAL-HTML CONTRACT extras ----------------------------------------------------
ok(/Compiled from official public records on <time datetime="2026-09-04">/.test(a),
   'the document is honestly dated with the build day');
ok(a.includes('href="/homesignalmap.html?zip=01001"') && a.includes('href="/"'),
   'the initial HTML carries usable internal links');
ok(!a.includes('href="/community.html?zip='),
   'the canonical document never links to the legacy URL it canonicalises away from');
ok(read(out1, '02543').includes('No government notices on file for this ZIP yet.'),
   'an honest-empty page still names every section and says so truthfully');


// ---- 10. MISSING PLANE: fixtures may, production must not --------------------------------
{
  const outNo = mkdtempSync(join(tmpdir(), 'zp-noplane-'));
  writeFileSync(join(outNo, 'sitemap.xml'), STAGED_SITEMAP);
  execFileSync('python3', [
    GEN, '--fixture', FIX, '--out', outNo, '--now', '2026-09-04T00:00:00',
    '--dev-plane', join(outNo, 'does-not-exist.json'),
    '--allow-missing-dev-plane',
  ], { encoding: 'utf8' });
  const wxNo = read(outNo, '01002');
  ok(wxNo.includes('content="noindex, follow"'),
     'fixture may explicitly exercise no-plane: Alerts-fail ZIP returns to noindex');
  ok(!/<h2>Development<\/h2>/.test(wxNo),
     '...and invents no Development section');
  rmSync(outNo, { recursive: true, force: true });
}
{
  const py = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('g', ${JSON.stringify(GEN)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
try:
    g.load_dev_plane(${JSON.stringify(join(root, 'does-not-exist-rule-d.json'))}, required=True)
    print('UNEXPECTED_OK')
    sys.exit(2)
except SystemExit as e:
    print(e)
`;
  let out = '';
  try {
    out = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
  } catch (e) {
    out = String((e.stdout || '') + (e.stderr || e.message || ''));
  }
  ok(/Rule D plane missing/.test(out) && !/UNEXPECTED_OK/.test(out),
     'production load_dev_plane HARD-FAILS on a missing plane (does not return {})',
     out.slice(0, 240));
}
{
  const stale = join(tmpdir(), `stale-plane-${Date.now()}.json`);
  writeFileSync(stale, JSON.stringify({
    version: '1.0.0', rule: 'D', threshold: 3, identity: 'base_project_key',
    generated_at: '2020-01-01T00:00:00Z', lock_n: 0, eligible_n: 0, held_n: 0,
    zips: {},
  }));
  const py = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('g', ${JSON.stringify(GEN)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
try:
    g.load_dev_plane(${JSON.stringify(stale)}, required=True)
    print('UNEXPECTED_OK')
    sys.exit(2)
except SystemExit as e:
    print(e)
`;
  let out = '';
  try {
    out = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
  } catch (e) {
    out = String((e.stdout || '') + (e.stderr || e.message || ''));
  }
  ok(/Rule D plane is stale/.test(out) && !/UNEXPECTED_OK/.test(out),
     'production load_dev_plane HARD-FAILS on a stale generated_at',
     out.slice(0, 240));
}
ok(/RULE_D_PLANE_MAX_AGE_HOURS = 36/.test(gen),
   'production freshness window is a named constant');
ok(/refusing to silently drop/.test(gen),
   'stale/missing plane errors name the silent-noindex failure');
ok(/--allow-missing-dev-plane is fixture-only/.test(gen),
   'the no-plane escape is refused outside --fixture');
{
  const pages = readFileSync(join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
  ok(/Fetch the published Rule D plane/.test(pages),
     'Pages fetches the published Rule D plane before gen_zip_pages');
  ok(/email-assets\/seo\/development-seo-plane\.json/.test(pages),
     'Pages fetch URL is the public Storage current object');
  ok(/age > 36/.test(pages) && /could not fetch the published Rule D plane/.test(pages),
     'Pages hard-fails a missing or stale (>36h) fetch');
  ok(/cron: '40 6 \* \* \*'/.test(pages),
     'Pages schedule remains 06:40 UTC');
}

// The Type annotation is a build byproduct. It must never be left in the repo tree
// (data/ in production, test/fixtures/ here), where it could be committed.
{
  const fixDir = join(root, 'test', 'fixtures');
  const strays = readdirSync(fixDir).filter((f) => f.endsWith('.ssr.json'));
  ok(strays.length === 0, `no annotated plane is left beside its input (found: ${strays.join(', ') || 'none'})`);
  ok(/tempfile\.mkstemp\(/.test(gen) && /os\.remove\(annotated\)/.test(gen),
     'the annotated plane is written to a temp file and removed after reading');
}

rmSync(out1, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

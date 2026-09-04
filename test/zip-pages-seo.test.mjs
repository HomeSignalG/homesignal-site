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
import { readFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
const FIX = join(root, 'test', 'fixtures', 'zip-pages.json');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

function build() {
  const out = mkdtempSync(join(tmpdir(), 'zp-'));
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
ok(man.documents === 4, 'a document exists for EVERY canonical ZIP, pass or fail');
ok(man.rule_f_pass === 3 && man.rule_f_fail === 1, 'manifest pass/fail matches Rule F');
ok(!existsSync(join(out1, 'community', '80249')), 'no document for the removed 80249 drift ZIP');
rmSync(out1, { recursive: true, force: true });
rmSync(out2, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

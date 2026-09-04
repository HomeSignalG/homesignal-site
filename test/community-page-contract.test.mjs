// THE HYDRATION CONTRACT for the community ZIP page.
//
// The generated document at /community/<zip>/ decides robots, canonical, title and H1 at
// BUILD time. JavaScript may enhance the page; it may never reverse that decision, and it
// may never delete Alerts content the crawler was just served. Those are runtime
// properties, so the browser-backed proof lives in scripts/prove-zip-pages.mjs — but a
// browser suite only runs where a browser exists, and the failure mode here is a one-line
// edit to a shared runtime. These offline assertions read the shipped source so a
// regression fails in the REQUIRED offline CI check, not only in the optional browser one.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rt = readFileSync(join(root, 'lib', 'community-page.js'), 'utf8');
const legacy = readFileSync(join(root, 'community.html'), 'utf8');
const notFound = readFileSync(join(root, '404.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

// ---- ONE shared implementation (CLAUDE.md §0) -------------------------------------------
ok(/<script src="lib\/community-page\.js"><\/script>/.test(legacy),
   'community.html loads the ONE shared runtime rather than carrying its own copy');
ok(!/HS\.onReady\(async function/.test(legacy),
   'community.html no longer inlines a second implementation of the page');

// ---- robots is build-time authoritative --------------------------------------------------
ok(!/setIndexable/.test(rt), 'the runtime has no setIndexable() — robots is not a JS decision');
ok(!/robots-meta/.test(rt), 'the runtime never touches the robots meta element');
ok(!/setAttribute\(\s*['"]content['"]/.test(rt), 'the runtime never rewrites a meta content attribute');
ok(/meta name="robots" content="noindex, nofollow"/.test(legacy),
   'the legacy query-string page is permanently noindex — it cannot compete with the canonical path');

// ---- one canonical identity --------------------------------------------------------------
ok(/rel = 'canonical'/.test(rt) && /'\/community\/' \+ encodeURIComponent\(zip\)/.test(rt),
   'the legacy page points its canonical AT the canonical ZIP path');
ok(/!document\.querySelector\('link\[rel="canonical"\]'\)/.test(rt),
   '...and never overwrites the self-referencing canonical the generated document ships');
ok(/\/community\/(\d\{5\}|<zip>)?/.test(rt) || /\/community\//.test(rt),
   'the canonical path shape is /community/<zip>/');
ok(/^\s*var m = window\.location\.pathname\.match\(\/\^\\\/community\\\/\(\\d\{5\}\)\\\/\?\$\/\);/m.test(notFound)
   || /\/\^\\\/community/.test(notFound),
   '404.html forwards a pretty /community/<zip>/ path (pre-deployment compatibility)');

// ---- hydration may not delete crawlable content -------------------------------------------
// A ZIP can be Alerts-PASS while data_quality is 'coverage_coming' (529 such ZIPs measured
// 2026-09-04). Those branches render coverage copy only, so the build-time Alerts block has
// to survive them, or JS deletes exactly the content the page was indexed for.
const notCovered = rt.slice(rt.indexOf('if (!status) {'), rt.indexOf('var c = meta;'));
ok(!/dropSsr\(\);/.test(notCovered),
   'the not-covered and coverage-coming branches KEEP the build-time Alerts block');
ok(/keepSsrAbove\(\);/.test(notCovered), '...explicitly, via keepSsrAbove()');
ok((rt.match(/dropSsr\(\);/g) || []).length === 1,
   'the SSR block is dropped exactly once — on the branch that re-renders the same Alerts populations');
const full = rt.slice(rt.indexOf('var c = meta;'));
for (const [re, what] of [[/HS\.data\.changes\(/, 'government notices'], [/HS\.data\.meetings\(/, 'upcoming meetings'],
                          [/HS\.data\.news\(/, 'local news']]) {
  ok(re.test(full), `the branch that drops the SSR block re-renders ${what}`);
}

// ---- ZIP geography, not a point ------------------------------------------------------------
ok(/document\.body\.dataset\.zip/.test(rt),
   'the generated document identifies itself by ZIP, not by an address or a point');
ok(/home && home\.sample/.test(rt),
   'the fictional demo home is still refused as a measuring point (anti-fabrication)');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

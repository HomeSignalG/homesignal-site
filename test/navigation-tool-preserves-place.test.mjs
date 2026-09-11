// FIX 6 / GATE 2 — TOOL NAVIGATION PRESERVES THE VIEWED PLACE.
//
// A tool-navigation action may change TOOL state. It may not change PLACE state.
// Gate 1 stopped account hydration from stealing the viewed ZIP; this is the defence
// in depth: every ZIP-scoped page re-asserts the viewed place through ONE shared
// helper before it fetches, and every route between tools carries that ZIP.
//
// Structural assertions run on a COMMENT-STRIPPED copy — the fix's own comments name
// the helpers and pages they describe, and an "absence" proven by a comment is not a
// proof (see test/my-places-contract.test.mjs for the three that already went green
// that way in this repo).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { navHref, pageHref, resolveViewedZip, ZIP_NAV_PAGES } = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 200) : ''));
  if (!c) fails++;
};
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const shell = strip(read('shell.js'));
const shellHtml = strip(read('partials/shell.html'));
const VIEWED = '84301';

console.log('--- the ZIP-scoped page set ---');
for (const p of ['dashboard.html', 'alerts.html', 'development.html', 'homesignalmap.html', 'community.html'])
  ok(ZIP_NAV_PAGES.indexOf(p) >= 0, 'ZIP_NAV_PAGES includes ' + p);
// My Places is the ACCOUNT-WIDE manager of every Address and ZIP. Scoping it to one ZIP
// would hide the rest of the resident's places behind the place they happen to be viewing.
ok(ZIP_NAV_PAGES.indexOf('properties.html') < 0,
  'properties.html (My Places) stays account-wide — NOT silently added to ZIP_NAV_PAGES');
ok(ZIP_NAV_PAGES.length === 5, 'ZIP_NAV_PAGES is exactly those five', ZIP_NAV_PAGES);

console.log('--- moving between tools keeps 84301 ---');
// 84301 Dashboard -> Alerts -> Development -> Map 1 : the tool changes, the place does not.
for (const dest of ['dashboard.html', 'alerts.html', 'development.html', 'homesignalmap.html'])
  ok(navHref(dest, VIEWED) === dest + '?zip=' + VIEWED,
    'tool nav to ' + dest + ' carries the viewed ZIP');
ok(navHref('development.html', VIEWED).indexOf('78617') < 0,
  'tool nav never substitutes the sample ZIP for the viewed one');
ok(pageHref('alerts.html', { zip: VIEWED, band: 'open' }) === 'alerts.html?zip=' + VIEWED + '&band=open',
  'deep-link params ride along with the preserved ZIP');

console.log('--- the shared re-assertion helper (no per-page geography rules) ---');
ok(/HS\.ensureViewedZip = function/.test(shell), 'shell.js defines the shared ensureViewedZip');
const ensure = (shell.match(/HS\.ensureViewedZip = function[\s\S]*?\n  \};/) || [''])[0];
ok(ensure.length > 100, 'ensureViewedZip body found for contract pins', ensure.length);
ok(/HS\.parseZipParam\(location\.search\)/.test(ensure),
  'ensureViewedZip reads ?zip= from the page URL');
ok(/HS\.resolveViewedZip\(/.test(ensure),
  'ensureViewedZip falls back through the DOCUMENTED resolver, not a private rule');
ok(/defaultZip: CFG\.DEFAULT_ZIP/.test(ensure),
  'its last resort is the documented default, not the first followed ZIP');
ok(!/_serverFollowZips/.test(ensure) && !/followedCommunities/.test(ensure),
  'ensureViewedZip never consults the follow list for geography',
  (ensure.match(/.{0,50}(_serverFollowZips|followedCommunities).{0,50}/) || [])[0]);

// Every ZIP-scoped tool page must call it BEFORE it reads S.zip, or the re-assertion
// lands after the fetch it was meant to protect.
for (const f of ['alerts.html', 'dashboard.html', 'development.html']) {
  const src = strip(read(f));
  const call = src.indexOf('HS.ensureViewedZip(');
  const firstRead = src.search(/HS\.data\.[a-z]+\(S\.zip/);
  ok(call > 0, f + ' calls the shared ensureViewedZip');
  ok(firstRead > 0 && call < firstRead,
    f + ' re-asserts the viewed ZIP BEFORE its first ZIP-scoped fetch', { call, firstRead });
}
// The canonical ZIP document keeps its restore, but as the BACKUP it was meant to be —
// routed through the shared helper rather than a fourth copy of the same rule.
const cpage = strip(read('lib/community-page.js'));
ok(/HS\.ensureViewedZip\(document\.body\.dataset\.zip\)/.test(cpage),
  'community page runtime resolves through the shared helper, passing its path-based ZIP');
ok(!/new URLSearchParams\(location\.search\)\.get\('zip'\)\s*\|\|\s*document\.body\.dataset\.zip/.test(cpage),
  'the page-local ZIP rule it used to own is gone (one implementation, not five)');
// A path-based ZIP must rank WITH ?zip=, never below myZip — otherwise the canonical
// /community/01034/ document would render a visitor's saved area instead of its subject.
ok(/pageZip && \/\^\\d\{5\}\$\/\.test\(String\(pageZip\)\)/.test(ensure),
  'a page-declared (path-based) ZIP is accepted as explicit URL identity');
ok(resolveViewedZip({ urlZip: '01034', myZip: '84301', defaultZip: '78617' }) === '01034',
  'explicit page/URL ZIP outranks a saved myZip (the canonical document renders itself)');

console.log('--- the bell carries the viewed place ---');
ok(!/location\.href='alerts\.html'/.test(shellHtml),
  'the bell no longer routes to a bare, ZIP-less alerts.html',
  (shellHtml.match(/.{0,60}location\.href='alerts\.html'.{0,20}/) || [])[0]);
ok(/aria-label="Notifications"[^>]*onclick="HS\.navTo\('alerts\.html'\)"/.test(shellHtml),
  'the bell routes through the shared navigator');
ok(!/\?zip='\s*\+/.test(shellHtml),
  'the partial hand-builds no ?zip= string that could go stale at inject time');
const navTo = (shell.match(/HS\.navTo = function[\s\S]*?\n  \};/) || [''])[0];
ok(/HS\.navHref\(page, state\.zip\)/.test(navTo),
  'HS.navTo resolves through HS.navHref at click time — always the CURRENT viewed ZIP');

console.log('--- sidebar links are stamped from the viewed ZIP, not a follow ---');
const paint = (shell.match(/function paintNavHrefs\(\)[\s\S]*?\n  \}/) || [''])[0];
ok(/const zip = state\.zip;/.test(paint), 'paintNavHrefs stamps from state.zip');
ok(!/_serverFollowZips/.test(paint) && !/myZip/.test(paint),
  'paintNavHrefs never stamps a follow-list or saved-area ZIP over the viewed one');
ok(/HS\.ZIP_NAV_PAGES\.indexOf\(base\) < 0/.test(paint),
  'only ZIP-scoped pages are stamped (My Places keeps its account-wide link)');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll Gate 2 tool-navigation assertions passed.');

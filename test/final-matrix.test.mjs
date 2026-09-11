// THE FINAL FUNCTIONALITY MATRIX — the classifications, frozen.
//
// WHY THIS FILE EXISTS. Phases 2-8 each pinned the surface they touched: Alerts, Development,
// the public ZIP, navigation identity, My Places, the cache key. What none of them pins is the
// SHAPE OF THE WHOLE — which rows shipped, which are deliberately absent, and which are
// leftovers that were measured and left alone on purpose. That distinction is the first thing
// a later session loses. A deferred feature and a forgotten one look identical in a codebase;
// so do a recorded leftover and an oversight. This file is what makes them different.
//
// It is a CLASSIFICATION pin, not a capability pin. It does not restate what the eight
// existing pins already assert — it asserts that the DEFERRED rows are still absent and the
// LEFTOVER rows are still exactly as measured, because those are the two classes with no
// other guard and the two a well-meaning future edit would "fix".
//
// THREE SCOPE RULES, all load-bearing:
//   1. It does NOT assert #zip-health-authed is absent anywhere — A-022 is authorized in
//      lib/community-page.js for a signed-in non-demo session. The GATE is what matters.
//   2. It does NOT ban the word "Export" on homesignalmap.html — #propExport IS A-016.
//   3. It does NOT re-pin the four-item chrome, the stubs or Map 1's identity in detail;
//      test/nav-identity.test.mjs and test/public-zip-contract.test.mjs own those. It pins
//      only the one fact those files cannot: that the PAGES behind the folded entries still
//      exist, so "folded" can never quietly become "deleted".
//
// Every check runs on a COMMENT-STRIPPED copy — several files here carry long comments that
// name the very strings being forbidden.
import fs from 'node:fs';
let fails = 0;
const ok = (c, name, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
  + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 220) : '')); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const has  = (f) => fs.existsSync(new URL('../' + f, import.meta.url));
// ⚠️ The block-comment strip must not fire inside a URL: homesignalmap.html's CSP carries
// `https://*.tile.openstreetmap.org`, whose `/*` opened a phantom comment swallowing 2,297
// bytes of that file's head — so an absence-pin over the CSP or the head scripts passed by
// reading nothing. Requiring the opener not to follow `:` or `/` keeps every real comment.
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1');

const shellJs = strip(read('shell.js'));
const cp      = strip(read('lib/community-page.js'));
const map     = strip(read('homesignalmap.html'));
const dev     = strip(read('development.html'));
const alerts  = strip(read('alerts.html'));
const props   = strip(read('properties.html'));
const dash    = strip(read('dashboard.html'));
const idxRaw  = read('index.html');

// ── SHIPPED: only the fact the other pins cannot carry — the pages still exist ───────────
// "Folded out of the sidebar" and "deleted" are one edit apart and look the same in a nav
// diff. Every page that LOST its chrome entry is asserted present here.
for (const f of ['today.html', 'reports.html', 'maps.html', 'homesignalmap.html',
                 'community.html', 'development.html', 'properties.html', 'alerts.html',
                 'dashboard.html', 'property.html'])
  ok(has(f), 'SHIPPED the ' + f + ' page still exists — retired means redirected, never deleted');
ok(/HS\.ZIP_NAV_PAGES = \['dashboard\.html', 'alerts\.html', 'development\.html', 'homesignalmap\.html', 'community\.html'\];/.test(shellJs),
  'SHIPPED A-020/A-021 ZIP_NAV_PAGES dropped ONLY today.html');
ok(read('lib/view-zip.js').includes("var ZIP_NAV_PAGES = ['dashboard.html', 'alerts.html', 'development.html', 'homesignalmap.html', 'community.html'];"),
  'SHIPPED ...and lib/view-zip.js carries the byte-identical literal');
ok(/HS\.MAP_PAGES = \['homesignalmap\.html'\];/.test(shellJs), 'SHIPPED A-021 Map 1 is still in MAP_PAGES');
ok(/var authedZipHealth = \(sess && !sess\.demo\)/.test(cp), 'SHIPPED A-022 the ZIP-health gate is on a real non-demo session');
ok((cp.match(/robots-meta|name="robots"/g) || []).length === 0,
  'SHIPPED A-017 the runtime renderer still writes no robots directive');

// ── DEFERRED: absence is the contract, and absence has no other guard ────────────────────
// DF-001 / A-013 — bulk import
for (const [f, body] of [['properties.html', props], ['dashboard.html', dash]])
  ok(!/\b(bulk import|paste a list|import zips?|mass.add|\.csv|upload a file)\b/i.test(body),
    'DEFERRED DF-001/A-013 no bulk importer on ' + f, (body.match(/.{0,40}(bulk|import|paste).{0,40}/i) || [])[0]);
// DF-002 — alerts export
for (const bad of [/\bexport\b/i, /\bdownload\b/i, /\bcsv\b/i, /\bpdf\b/i])
  ok(!bad.test(alerts), 'DEFERRED DF-002 alerts.html has no ' + bad.source, (alerts.match(bad) || [])[0]);
// DF-003 — triage. state.dismissed stays DECLARED and UNWIRED: exactly two token
// occurrences, both on the one declaration line. A third means something started reading it.
for (const bad of [/\bdismiss/i, /\bsnooze/i, /\bunread\b/i, /mark as read/i])
  ok(!bad.test(alerts), 'DEFERRED DF-003 alerts.html has no ' + bad.source + ' control', (alerts.match(bad) || [])[0]);
ok(/dismissed: new Set\(LS\.get\('dismissed', \[\]\)\),/.test(shellJs),
  'DEFERRED DF-003 shell.js still DECLARES state.dismissed');
ok((shellJs.match(/dismissed/g) || []).length === 2,
  'DEFERRED DF-003 ...and the token appears exactly twice — both on that line, so nothing reads it',
  (shellJs.match(/dismissed/g) || []).length);
// DF-004 / A-011 — per-Place monitoring
for (const [f, body] of [['properties.html', props], ['alerts.html', alerts], ['dashboard.html', dash]])
  ok(!/\b(quiet hours?|cadence|manage monitoring|per-place|notification schedule)\b/i.test(body),
    'DEFERRED DF-004/A-011 no per-Place monitoring controls on ' + f);
// DF-005 — Map Watch completion
ok(/wb\.textContent = "Watch requests aren't live yet";/.test(map),
  'DEFERRED DF-005 #propWatch still says the request is not live');
ok(!/from\('app_watches'\)|toggleFollow\([^)]*'watch'/.test(map),
  'DEFERRED DF-005 ...and no watch data model was wired');
// A-023's three controls must stay three DIFFERENT things.
ok(read('property.html').includes("HS.toggleFollow(this,\\'property\\'"), 'SHIPPED A-023 "Watch this property" is LIVE');
ok(dev.includes("HS.toggleFollow(this,\\'project\\'"), 'SHIPPED A-023 project follow is LIVE');
ok(/Add to My Places to follow/.test(dev) && /Following in My Places/.test(dev),
  'SHIPPED A-023 project follow copy names My Places');
ok(/id='propWatch'>Watch this address</.test(map), 'SHIPPED A-023 ...and the map Watch is a third, still-stubbed control');

// ── LEFTOVERS: measured, recorded, and deliberately NOT closed ───────────────────────────
// Each of these is the kind of thing a later session "tidies up" in good faith. Pinning
// them makes closing one a DELIBERATE act with a failing test attached, not a drive-by.
ok(/if \(await HS\.data\.isCovered\(z\)\) location\.href = 'community\.html\?zip=' \+ z;/.test(idxRaw),
  'LEFTOVER 1 index.html homeFind() still routes to community.html?zip=');
ok(/HS\.shareUrlOverride = HS_CONFIG\.BASE_URL \+ '\/community\.html\?zip=' \+ zip;/.test(cp),
  'LEFTOVER 2 HS.shareUrlOverride is still the community.html?zip= URL');
ok(!/hs-resolve\.js/.test(map + dev + alerts + props + dash + idxRaw + read('community.html')),
  'LEFTOVER 3 hs-resolve.js is still unwired on every page');
ok(/\^\\\/community\\\/\(\\d\{5\}\)/.test(read('404.html')), 'LEFTOVER 4 the 404 pretty-routes are KEEP');
ok(/Available for whole-ZIP view/.test(map), 'LEFTOVER 5 the disabled-radius tooltip still points at the whole-ZIP view');
ok(/HS\.N5_RADII = \[0\.5, 1, 2, 5\];/.test(read('lib/n5-radius.js'))
   && /var RADIUS_STOPS = \[0\.5,1,2,3,5,10,20\];/.test(map),
  'LEFTOVER 5 ...seven UI stops against four RPC stops, unreconciled');
ok(/meetings\.find\(function\(x\)\{return x\.related_project_id===projectId;\}\) \|\| meetings\[0\];/.test(dev),
  'LEFTOVER 6 HS.addToCalendar still falls back to meetings[0]');
ok(!/development\.html/.test(map), 'LEFTOVER 7 map→list is still 0');
ok(/HS\.navHref\('homesignalmap\.html', S\.zip\)/.test(dev), 'LEFTOVER 7 ...and list→map is still the one direction that exists');
ok(!/sampleBtn/.test(map), 'LEFTOVER 7 #sampleBtn is still absent');
ok(!/repPreview|impact model|updated today/.test(strip(read('reports.html'))),
  'LEFTOVER 8 the reports preview document was not ported into the stub');
ok(/This page is MAPS\./.test(read('homesignalmap.html')) && /<body data-nav="dev">/.test(read('homesignalmap.html')),
  'LEFTOVER 10 the stale "This page is MAPS" narration sits above the correct data-nav="dev" — recorded, not edited');

console.log(fails ? '\nFAILED ' + fails : '\nAll final-matrix checks passed');
process.exit(fails ? 1 : 0);

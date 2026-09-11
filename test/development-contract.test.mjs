// DEVELOPMENT — the A-008 / A-016 / A-023 contract, frozen.
//
// WHY THIS FILE EXISTS. Phase 6 is "verify and preserve": Development, Map 1, the HTML
// snapshot, the ICS, live Project Follow and the deliberately-unfinished Map Watch stub are
// all already repository truth. A contract whose only requirement is "change nothing" erodes
// silently — nothing fails when the Export blob quietly becomes text/csv, when the Watch stub
// is relabelled as if it worked, when the three unsupported radius stops are deleted to
// "reconcile" them with the RPC's four, when Maps is folded out of nav, or when Map 1 grows a
// link back into the list. This file is the thing that fails.
//
// SCOPE NOTE, deliberate: this does NOT ban the word "Export" on homesignalmap.html. #propExport
// IS A-016 — the sanctioned single-address evidence snapshot. What is pinned is WHAT it
// produces (text/html, one address), never whether the word appears. Applying the Alerts-style
// export ban here would fail on the feature it is supposed to protect.
//
// Every check runs on a COMMENT-STRIPPED copy. Assertions in this repo have already gone green
// off a code comment naming the very string they forbid.
import fs from 'node:fs';
let fails = 0;
const ok = (c, name, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
  + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 220) : '')); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// ⚠️ The block-comment strip must not fire inside a URL: homesignalmap.html's CSP carries
// `https://*.tile.openstreetmap.org`, whose `/*` opened a phantom comment swallowing 2,297
// bytes of that file's head — so an absence-pin over the CSP or the head scripts passed by
// reading nothing. Requiring the opener not to follow `:` or `/` keeps every real comment.
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1');

const map   = strip(read('homesignalmap.html'));
const dev   = strip(read('development.html'));
const legacy= strip(read('maps.html'));
const dash  = strip(read('dashboard.html'));
const n5    = strip(read('lib/n5-radius.js'));
const shellHtml = strip(read('partials/shell.html'));
const shellJs   = strip(read('shell.js'));

// ---- A-008: TWO surviving surfaces, both reachable, Maps still in nav ----
for (const f of ['homesignalmap.html', 'development.html', 'maps.html'])
  ok(fs.existsSync(new URL('../' + f, import.meta.url)), 'A-008 ' + f + ' still exists');
ok(/href="development\.html"\s+data-nav="dev"/.test(shellHtml), 'A-008 Development is in the nav');
// ⚠️ RETARGETED IN PHASE 8, ONE LINE, AND THE DEVELOPMENT CONTRACT IS UNCHANGED IN
// SUBSTANCE. This line used to read `A-008 Maps is STILL in the nav — not folded`, which
// was a true statement about the Phase 6 CHROME, not about Development's capability.
// A-021 authorized folding Maps out of the sidebar, so that sentence is now false BY
// DESIGN — and the thing it was really protecting (Map 1 continues to exist and stay
// reachable) is asserted below and by the `still exists` / ZIP_NAV_PAGES lines around it.
// Everything else in this file is byte-identical to Phase 6.
ok(!/href="homesignalmap\.html"/.test(shellHtml),
  'A-021 Maps is NO LONGER a sidebar item — folded under Development',
  (shellHtml.match(/.{0,40}homesignalmap\.html.{0,40}/) || [])[0]);
ok(/<body data-nav="dev"/.test(map),
  'A-021 ...and Map 1 declares "dev", so visiting it lights Development');
ok(/HS\.MAP_PAGES = \['homesignalmap\.html'\];/.test(shellJs),
  'A-008 Map 1 is still in MAP_PAGES — the PAGE was not retired, only its sidebar entry');
for (const p of ['development.html', 'homesignalmap.html'])
  ok(new RegExp("'" + p + "'").test(shellJs), 'A-008 ZIP_NAV_PAGES still carries ' + p);

// ---- A-008: maps.html is a REDIRECT that carries the query string ----
ok(/window\.location\.replace\('\/homesignalmap\.html' \+ q\)/.test(legacy),
  'A-008 maps.html replaces to /homesignalmap.html');
ok(/var q = window\.location\.search \|\| '';/.test(legacy),
  'A-008 ...carrying the query string, so ?zip= survives the forward');

// ---- A-008: Dashboard keeps the compact snapshot, NOT Map 1 ----
ok(/>Development Overview</.test(dash), 'A-008 the Dashboard heading is exactly "Development Overview"');
ok(!/What's Changing Around You/.test(dash), 'A-008 "What\'s Changing Around You" is gone as a module name');
ok(/id="dashMap"/.test(dash), 'A-008 the compact #dashMap preview is present');
ok(/Open full map/.test(dash) && /homesignalmap\.html/.test(dash), 'A-008 "Open full map →" routes into Map 1');
for (const ctl of ['id="viewSeg"', 'id="radSel"', 'stagechip', 'typechip', 'regchip'])
  ok(!dash.includes(ctl), 'A-008 Map 1 control ' + ctl + ' is NOT on Dashboard');

// ---- A-008: the radius contract — THREE facts that must all stay true together ----
{
  const seg = (map.match(/<div class="radsel" id="radSel">([\s\S]*?)<\/div>/) || [])[1] || '';
  const stops = [...seg.matchAll(/data-r="([\d.]+)"/g)].map(m => m[1]);
  ok(stops.join(',') === '0.5,1,2,3,5,10,20',
    'A-008 (a) #radSel still offers all SEVEN stops', stops);
}
ok(/var RADIUS_STOPS = \[0\.5,1,2,3,5,10,20\];/.test(map),
  'A-008 (a) RADIUS_STOPS matches the seven buttons');
ok(/HS\.N5_RADII = \[0\.5, 1, 2, 5\];/.test(n5),
  'A-008 (b) the address-mode RPC set is still the FOUR stops — 3/10/20 were NOT added to it');
ok(/var allowed = ZIP_MODE \|\| HS\.N5_RADII\.indexOf\(r\) >= 0;/.test(map),
  'A-008 (b) address mode disables any stop the RPC will not accept');
ok(/function snapRadiusForAddress\(\)/.test(map) && /if\(Math\.abs\(r - CUR_RADIUS\) < Math\.abs\(best - CUR_RADIUS\)\) best = r;/.test(map),
  'A-008 (b) ...and an unsupported radius SNAPS to the nearest supported one');
ok(/body\.zipmode \.radsel\{display:none\}/.test(map),
  'A-008 (c) ZIP mode HIDES the radius control — a ZIP is not a circle around a point');
ok(/if\(!CUR_ADDRESS\) return;/.test(map),
  'A-008 (c) ...and the handler is inert without an address-derived home, as the belt to that braces');

// ---- A-008: three filter families, not one and not four ----
for (const fam of ['stagechip', 'typechip', 'regchip'])
  ok(map.includes(fam), 'A-008 Map 1 keeps the ' + fam + ' filter family');

// ---- A-008: map -> list stays 0 (list -> map is the one direction that exists) ----
ok(!/development\.html/.test(map),
  'A-008 Map 1 carries NO link back into the development list — the one-way gap is preserved',
  (map.match(/.{0,40}development\.html.{0,40}/) || [])[0]);
ok(/See it on the map/.test(dev) && /homesignalmap\.html/.test(dev),
  'A-008 list -> map ("See it on the map") is the direction that DOES exist');

// ---- A-016: the HTML snapshot is HTML, one address, and is NOT renamed ----
ok(/id='propExport'>Export</.test(map), 'A-016 the snapshot button is labelled exactly "Export"');
ok(/new Blob\(\[html\], \{ type:"text\/html" \}\)/.test(map),
  'A-016 the artifact is a text/html Blob');
ok(/a\.download = "property-" \+ String\(row\.address\)/.test(map) && /\+ "\.html";/.test(map),
  'A-016 ...downloaded as property-<address>.html — ONE address, not the corpus');
ok(!/text\/csv/.test(map) && !/\.csv/.test(map),
  'A-016 Map 1 produces no CSV artifact of any kind', (map.match(/.{0,30}csv.{0,30}/i) || [])[0]);
ok(!/text\/csv/.test(dev) && !/\.csv/.test(dev),
  'A-016 development.html produces no CSV artifact either', (dev.match(/.{0,30}csv.{0,30}/i) || [])[0]);

// ---- A-016: the ICS, and the fallback that is a LEFTOVER rather than a fix ----
ok(/Add hearing to calendar/.test(dev), 'A-016 "Add hearing to calendar" is present');
ok(/'data:text\/calendar;charset=utf-8,'/.test(dev), 'A-016 ...and emits a data:text/calendar payload');
ok(/meetings\.find\(function\(x\)\{return x\.related_project_id===projectId;\}\) \|\| meetings\[0\];/.test(dev),
  'A-016 the meetings[0] fallback is UNCHANGED — recorded as a leftover, deliberately not rewritten');
ok(/id="devDataBtn"/.test(dev) && /Table view/.test(dev),
  'A-016 "Table view" is an in-page toggle');

// ---- A-023: Follow is live, Watch is a stub, and they are different things ----
ok(dev.includes("HS.toggleFollow(this,\\'project\\'"),
  'A-023 project follow is LIVE on development.html via toggleFollow');
ok(/Add to My Places to follow/.test(dev) && /Following in My Places/.test(dev),
  'A-023 project-follow copy is the My Places contract');
ok(/HS\.isFollowing && HS\.isFollowing\('project'/.test(dev),
  'A-023 the button reads persisted follow state before paint');
ok(!/Follow this project/.test(dev),
  'A-023 the misleading "Follow this project" label is gone from development.html');
ok(/id='propWatch'>Watch this address</.test(map),
  'A-023 the map Watch control still reads "Watch this address"');
ok(/wb\.textContent = "Watch requests aren't live yet";/.test(map),
  'A-023 ...and clicking it still says the request is NOT live — the stub is preserved, not completed');
ok(/HS\.requireAuth\('watch'\)/.test(map),
  'A-023 ...behind requireAuth, and writing nothing');
ok(!/toggleFollow\([^)]*'watch'/.test(map) && !/from\('app_watches'\)/.test(map),
  'A-023 no watch data model was wired');

console.log(fails ? '\nFAILED ' + fails : '\nAll development-contract checks passed');
process.exit(fails ? 1 : 0);

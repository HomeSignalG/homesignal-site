// FIX 6 / GATE 3 — THE VIEWING CONTROL SWITCHES PLACE, ON THE CURRENT TOOL.
//
// The Viewing control answers "where am I looking?". It lists BOTH saved-place types
// from their two EXISTING stores and must never merge them:
//     Address  -> app_properties
//     ZIP Code -> app_follows / myCommunities
// Selecting either changes PLACE and keeps the TOOL, via a real URL-changing navigation
// so Back/Forward have something to restore.
//
// SCOPE NOTE, so this file is not mistaken for a bigger claim than it makes. The menu,
// its two sections, both "+ Add" actions and HS.switchZip shipped earlier (#1161/#1170)
// and are pinned by test/my-places-contract.test.mjs. What Fix 6 adds is the ACTIVE-
// CONTEXT half: a ZIP-only Place must not keep a foreign Address as the app's active
// address. Assertions below that restate shipped behaviour are REGRESSION pins on the
// navigation contract, not new features.
//
// Structural pins run on a COMMENT-STRIPPED copy (this repo has shipped assertions that
// went green off a comment naming the string they banned).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { navHref, pageHref } = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 200) : ''));
  if (!c) fails++;
};
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const shell = strip(read('shell.js'));
const fn = (name) => (shell.match(new RegExp(name + '[\\s\\S]*?\\n  \\};')) || [''])[0];

console.log('--- switching place stays on the current tool, and changes the URL ---');
const switchZip = fn('HS\\.switchZip = function');
const switchProp = fn('HS\\.switchProperty = function');
ok(switchZip.length > 100 && switchProp.length > 100, 'both switchers found for contract pins');
ok(/focusHref\(zip\)/.test(switchZip) && /focusHref\(zip\)/.test(switchProp),
  'both switchers navigate via focusHref (current tool + selected ZIP)');
const focusHref = (shell.match(/function focusHref\(zip\)[\s\S]*?\n  \}/) || [''])[0];
ok(/currentShellPage\(\)/.test(focusHref),
  'focusHref stays on the CURRENT tool page — switching place does not change tool');
ok(/HS\.navHref\(/.test(focusHref) && !/\?zip='\s*\+/.test(focusHref),
  'focusHref builds the URL with the shared helper, never a hand-built ?zip=');
// Start on Alerts - 84301, pick Celina 75009: still Alerts, now 75009.
ok(navHref('alerts.html', '75009') === 'alerts.html?zip=75009',
  'Alerts - 84301 -> select 75009 => still Alerts, now 75009');
ok(navHref('development.html', '84301') === 'development.html?zip=84301',
  'Development - 75009 -> select 84301 => still Development, now 84301');
// A URL-less reload cannot restore place on Back/Forward — the history gate depends on this.
ok(/location\.href = focusHref\(zip\);/.test(switchZip),
  'a ZIP switch is a real URL navigation, not a bare location.reload()');
ok(!/location\.reload\(\)/.test(switchZip),
  'switchZip never reloads without updating ?zip=',
  (switchZip.match(/.{0,50}location\.reload\(\).{0,30}/) || [])[0]);

console.log('--- ZIP-only selection needs no Address and clears a foreign one ---');
ok(/clearActivePropIfForeign\(zip\)/.test(switchZip),
  'switchZip clears a conflicting active-Address context');
const clearFn = (shell.match(/function clearActivePropIfForeign\(zip\)[\s\S]*?\n  \}/) || [''])[0];
ok(/state\.activePropId = null/.test(clearFn) && /LS\.set\('activeProp', null\)/.test(clearFn),
  'it clears BOTH the in-memory pointer and hs:activeProp');
ok(/String\(cur\.zip\) !== String\(zip\)/.test(clearFn),
  'it clears ONLY when the active Address is foreign to the selected ZIP');
// The row must survive: this is a context change, not a deletion (A-012 owns removal).
ok(!/from\('app_properties'\)/.test(clearFn) && !/delete\(\)/.test(clearFn),
  'clearing the active context never deletes the saved Address row');
ok(!/from\('app_properties'\)/.test(switchZip),
  'a ZIP-only Place never writes or removes an Address row');
ok(!/addHome|openHome|geocode/i.test(switchZip),
  'selecting a followed ZIP never opens the Address flow — no address is invented',
  (switchZip.match(/addHome|openHome|geocode/i) || [])[0]);
// ZIP -> Address: the correct property becomes active and the URL follows THAT property.
ok(/HS\.selectProperty\(id\)/.test(switchProp),
  'selecting an Address establishes the active-property identity');
ok(/const zip = p && \/\^\\d\{5\}\$\/\.test\(String\(p\.zip\)\) \? String\(p\.zip\) : null;/.test(switchProp),
  'the URL ZIP comes from THAT property, so place and property agree');

console.log('--- the distance/home anchor is never a foreign Address (existing guard, pinned) ---');
// Verified rather than assumed: lib/data.js::homeFor already anchors only on a home IN
// the fetched ZIP, and every data function routes through it. Fix 6 pins that instead of
// adding a second helper that would duplicate it.
global.window = { HS_CONFIG: { DATA_SOURCE: 'supabase' }, HS: {} };
require('../lib/data.js');
const homeFor = global.window.HS.homeFor;
const celina = { id: 'p1', zip: '75009', lat: 33.3, lng: -96.8 };
ok(typeof homeFor === 'function', 'HS.homeFor is the shared anchor gate');
ok(homeFor('84301', celina) === null,
  'a Celina Address is NOT the anchor for an 84301 fetch (no "near home" from 75009)');
ok(homeFor('75009', celina) === celina,
  'the same Address IS the anchor on its own ZIP (the gate is not blanket-deny)');
ok(homeFor('84301', null) === null, 'no Address -> no anchor, never a guessed one');
const data = strip(read('lib/data.js'));
for (const f of ['projects', 'facilities', 'changes', 'news', 'meetings'])
  ok(new RegExp('async ' + f + '\\(zip, home\\)[\\s\\S]{0,400}?home = homeFor\\(zip, home\\)').test(data),
    'HS.data.' + f + '() routes its home anchor through homeFor');

console.log('--- the two stores stay separate ---');
const switcher = fn('HS\\.openSwitcher = function');
ok(/state\.properties/.test(switcher) && /followedCommunities/.test(switcher),
  'the menu reads Addresses and followed ZIP Codes from their two stores');
ok(/Addresses \(/.test(switcher) && /ZIP Codes \(/.test(switcher),
  'they are listed as two labeled sections, not one blended list');
ok(/HS\.switchProperty\(/.test(switcher) && /HS\.switchZip\(/.test(switcher),
  'each type is selected by its OWN switcher');
// An Address inside a followed ZIP is a legitimate pair of saved places, not a duplicate.
ok(!/dedup|uniq|filter\(function \(z\) \{ return !addresses/.test(switcher),
  'an Address and a ZIP sharing geography are not de-duplicated away');
ok(/z\.name \|\| \('ZIP ' \+ z\.zip\)/.test(switcher),
  'ZIP rows show locality metadata when present, never a hard-coded city name');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll Gate 3 viewing-switch assertions passed.');

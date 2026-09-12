// P0 — THE ADDRESS DOSSIER OWNS GEOGRAPHY FOR TOOL NAVIGATION.
//
// PRODUCTION FAIL (founder-observed): open property.html?id=<Coomes> — 13313 COOMES DR,
// Del Valle, TX 78617 — click Alerts, and land on alerts.html?zip=78657 (Horseshoe Bay).
//
// ROOT CAUSE: property.html resolved the Address, called HS.selectProperty(p.id) (which
// writes activePropId ONLY) and HS.setViewLabel(...), and never set HS.state.zip to p.zip.
// The sidebar, the bell (HS.navTo) and paintNavHrefs all stamp from HS.state.zip, so tool
// chrome carried whatever leftover session geography the tab happened to hold. The page
// already knew this for Map 1 — it omits data-znav "because the app's ACTIVE zip is not
// necessarily this Address's zip" — and its own tool chrome had the same defect.
//
// WHY THE BEHAVIOURAL HALF IS MUTATION-SENSITIVE. The exits are computed with the SHIPPED
// navHref from the ZIP the dossier actually establishes, and whether it establishes one is
// read from property.html's real source. Delete the write and every exit below falls back
// to the leftover ZIP and these assertions go red — which is the point: a pin that cannot
// notice the fix being removed is not a pin.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { navHref, ZIP_NAV_PAGES } = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 200) : ''));
  if (!c) fails++;
};
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const prop = strip(read('property.html'));

// The founder's exact reproduction.
const COOMES = { id: 'prop-coomes', address: '13313 COOMES DR', city: 'Del Valle', state: 'TX', zip: '78617' };
const LEFTOVER = '78657';   // Horseshoe Bay — the stale session ZIP the tab carried

console.log('--- the dossier establishes the viewed ZIP from the Address ---');
// Read the SHIPPED behaviour out of the page rather than restating it.
const writesViewedZip = /HS\.state\.zip = String\(p\.zip\)/.test(prop);
ok(writesViewedZip,
  'property.html sets the viewed ZIP from p.zip (selectProperty only writes activePropId)');
ok(/\/\^\\d\{5\}\$\/\.test\(String\(p\.zip\)\)/.test(prop),
  'the write is guarded on a real 5-digit ZIP — a missing/odd zip never becomes geography');

// Model the shell contract: state.zip is what paintNavHrefs / HS.navTo stamp from.
const viewedZip = writesViewedZip ? COOMES.zip : LEFTOVER;
ok(viewedZip === '78617',
  'after dossier boot the viewed ZIP is 78617, not the leftover session geography', viewedZip);

console.log('--- every exit from the dossier carries the ADDRESS\'s ZIP ---');
// Sidebar tools + the bell all resolve through navHref(page, state.zip).
const exits = {
  'sidebar Alerts':      navHref('alerts.html', viewedZip),
  'sidebar Development': navHref('development.html', viewedZip),
  'sidebar Dashboard':   navHref('dashboard.html', viewedZip),
  'bell (HS.navTo)':     navHref('alerts.html', viewedZip),
  'All projects →':      navHref('development.html', COOMES.zip)
};
for (const [name, href] of Object.entries(exits)) {
  ok(/\?zip=78617$/.test(href), name + ' carries ?zip=78617', href);
  ok(href.indexOf(LEFTOVER) < 0, name + ' does NOT carry the leftover ' + LEFTOVER, href);
}
// The acceptance criterion, stated once as a single assertion.
ok(Object.values(exits).every(h => h.endsWith('?zip=78617')),
  'ACCEPTANCE: tool navigation from an Address dossier cannot open a different ZIP',
  exits);

console.log('--- the in-page links, in the page itself ---');
ok(/HS\.navHref\('development\.html', p\.zip\)/.test(prop),
  '"All projects →" builds its href with navHref + the ADDRESS ZIP (was a bare development.html)');
ok(!/<a href="development\.html">/.test(prop),
  'no bare, ZIP-less development.html link survives on the dossier',
  (prop.match(/.{0,40}<a href="development\.html">.{0,20}/) || [])[0]);
// Pre-existing and correct — must not regress.
ok(/HS\.navHref\('homesignalmap\.html', p\.zip\)/.test(prop),
  'Map 1 "Open in Development →" still uses navHref with the ADDRESS ZIP (unregressed)');
ok(!/\?zip='\s*\+/.test(prop),
  'the dossier hand-builds no ?zip= string — every link goes through the shared helper');

console.log('--- the boundaries this fix must not cross ---');
// The dossier is addressed by ?id=. Adding it to ZIP_NAV_PAGES would let the shell re-stamp
// its own URL with the app ZIP, which is the defect wearing a different hat.
ok(ZIP_NAV_PAGES.indexOf('property.html') < 0,
  'property.html is NOT in ZIP_NAV_PAGES — the dossier is addressed by ?id=');
ok(ZIP_NAV_PAGES.indexOf('properties.html') < 0,
  'My Places stays account-wide (existing pin, unchanged by this fix)');
// Viewing a dossier is not a re-homing: NAV-01's saved-area rule still holds.
ok(!/LS\.set\('myZip'/.test(prop) && !/myZip/.test(prop),
  'the dossier never writes myZip — it sets the VIEWED zip only',
  (prop.match(/.{0,50}myZip.{0,30}/) || [])[0]);
// Alerts stays area-scoped; this fix routes geography, it does not invent per-address Alerts.
ok(!/alerts\.html\?[^"']*addr=/.test(prop) && !/alerts\.html\?[^"']*id=/.test(prop),
  'no per-address Alerts route was invented — Alerts stays area-scoped');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll address-dossier geography assertions passed.');

// THE VIEWED PLACE IS DECLARED BY THE ROUTE, NEVER INFERRED — Map 1 + Alerts + the ZIP hub.
//
// WHY THIS FILE EXISTS. The Viewing control answers "which of my Places am I looking at".
// Before the ZIP-Place declaration it answered it by guessing: account hydration elects any
// saved Address inside the viewed ZIP as the active property, and the chip printed that
// address on every page whose ZIP matched — so /community.html?zip=78617 read
// "Viewing · 13313 COOMES DR" (founder-observed on production, 2026-09-15) and the ZIP Place
// could not be named at all while an address sat inside it. The 2026-09-04 gate had fixed
// only the OTHER-ZIP case.
//
// The rule is now: an explicit route/page declaration outranks the saved-address default.
// This file RUNS the live shell functions rather than matching strings around them, so an
// edit that keeps the vocabulary but drops the behaviour cannot go green.
import fs from 'node:fs';

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 240) : ''));
  if (!c) fails++;
};

const shell  = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
const cpage  = fs.readFileSync(new URL('../lib/community-page.js', import.meta.url), 'utf8');
const alerts = fs.readFileSync(new URL('../alerts.html', import.meta.url), 'utf8');
const map1   = fs.readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');

const SAVED = { id: 'h1', address: '13313 COOMES DR', city: 'Del Valle', state: 'TX', zip: '78617' };

// ─────────────────────────────────────────────────────────── the live chip, executed ────
// paintTopbar is the ONE painter of the chip. Extracted whole and run against a stubbed
// shell, so these assertions describe what a resident sees, not what the source says.
const paintFn = (shell.match(/  function paintTopbar\(\) \{[\s\S]*?\n  \}\n/) || [''])[0];
ok(paintFn.length > 400, 'live paintTopbar body extracted from shell.js', paintFn.length);

function chip(opts) {
  const nodes = {
    locLabel: { textContent: '', closest: () => wrap },
    'hs-avatar': { textContent: '', style: {} },
    'hs-signin': { style: {} }
  };
  const wrap = { title: '' };
  const state = {
    activeProperty: opts.home || null,
    zip: String(opts.zip),
    viewLabel: opts.viewLabel || '',
    viewLabelPrecise: !!opts.precise,
    viewPlaceType: opts.placeType || '',
    session: null
  };
  const HS = { isSample: () => false, homeAddressLine: (p) => p.address + ', ' + p.city + ', ' + p.state + ' ' + p.zip };
  const LS = { get: (k, d) => (k === 'myZip' ? (opts.myZip || null) : d) };
  const $ = (id) => nodes[id] || null;
  const viewedLabel = () => state.viewLabel || ('ZIP ' + state.zip);
  const paintNavHrefs = () => {};
  new Function('HS', 'state', 'LS', '$', 'viewedLabel', 'paintNavHrefs', 'window',
    paintFn + '\npaintTopbar();')(HS, state, LS, $, viewedLabel, paintNavHrefs, { HS_SEED: null });
  return { label: nodes.locLabel.textContent, title: wrap.title };
}

console.log('--- 1. saved address in the SAME ZIP as the route ZIP ---');
const same = chip({ home: SAVED, zip: '78617', placeType: 'zip', viewLabel: 'Del Valle (78617)' });
ok(same.label.indexOf('13313 COOMES DR') < 0,
  'a declared ZIP Place is NOT overridden by an address inside it', same.label);
ok(same.label === 'Viewing · Del Valle (78617)', 'the chip names the ZIP Place', same.label);
ok(/13313 COOMES DR/.test(same.title),
  'the saved address is still named in the switcher tooltip — saved, active, one tap away', same.title);

console.log('--- 2. saved address in a DIFFERENT ZIP (the 2026-09-04 case, still fixed) ---');
const other = chip({ home: SAVED, zip: '80210', placeType: 'zip', viewLabel: 'Denver (80210)' });
ok(other.label === 'Viewing · Denver (80210)', 'the chip names the viewed ZIP, not the far address', other.label);
const otherNoDecl = chip({ home: SAVED, zip: '80210', viewLabel: 'Denver (80210)' });
ok(otherNoDecl.label.indexOf('13313 COOMES DR') < 0,
  '...and it stays fixed even with NO declaration — the cross-ZIP gate is independent', otherNoDecl.label);

console.log('--- 3. NO saved address ---');
ok(chip({ home: null, zip: '78617', placeType: 'zip', viewLabel: 'Del Valle (78617)' }).label
   === 'Viewing · Del Valle (78617)', 'declared ZIP Place, no address: the ZIP');
ok(chip({ home: null, zip: '78617' }).label === 'Viewing · ZIP 78617',
  'no address and no metadata: the bare ZIP, never a guess');

console.log('--- 4. A ROUTE THAT DECLARES NOTHING keeps the saved-address default ---');
// The regression this file must prevent in the OTHER direction: the fix must not take the
// address away from tools reached with no ZIP in the route, where "your area" IS its area.
const undeclared = chip({ home: SAVED, zip: '78617', myZip: '78617' });
ok(undeclared.label === 'Viewing · 13313 COOMES DR',
  'no declaration + address in the viewed ZIP -> still the address (unchanged behaviour)', undeclared.label);

console.log('--- 5. NAVIGATION: ZIP -> address -> ZIP is deterministic ---');
// Map 1 is the only in-page Place transition in the app. Drives the LIVE setViewPlaceType.
const setFn = (shell.match(/  HS\.setViewPlaceType = function \(type(?:, id)?\) \{[\s\S]*?\n  \};/) || [''])[0];
ok(setFn.length > 80, 'live setViewPlaceType body extracted', setFn.length);
const navState = { viewPlaceType: '', viewPlaceId: null };
const trail = [];
// Each leg is a separate call into the LIVE setter, and `repaints` proves the chip is
// actually re-rendered on every leg — a setter that stored the value but stopped
// repainting would leave the previous Place on screen with the state looking correct.
let repaints = 0;
const drive = new Function('HS', 'state', 'paintTopbar', 'type',
  setFn + '\nHS.setViewPlaceType(type);\nreturn state.viewPlaceType;');
['zip', 'address', 'zip'].forEach((t) => {
  trail.push(drive({}, navState, () => { repaints++; }, t));
});
ok(JSON.stringify(trail) === '["zip","address","zip"]',
  'ZIP -> address -> ZIP transitions exactly, with no sticky state', trail);
ok(repaints === 3, 'every leg repaints the chip', repaints);
ok(chip({ home: SAVED, zip: '78617', placeType: 'address', precise: true, viewLabel: '2200 CALDWELL LN' }).label
   === 'Viewing · 2200 CALDWELL LN',
  'mid-trail, the searched address is the Place — a stale ZIP declaration cannot suppress it');
ok(chip({ home: SAVED, zip: '78617', placeType: 'zip', viewLabel: 'Del Valle (78617)' }).label
   === 'Viewing · Del Valle (78617)', 'and back on the ZIP, the ZIP Place again');

console.log('--- 6. the declaration can never LEAK across a page load ---');
ok(/viewPlaceType: '',/.test(shell), 'state initialises viewPlaceType to the empty string');
ok(!/(LS|SS)\.set\(\s*['"]viewPlaceType/.test(shell),
  'it is NEVER persisted to localStorage or sessionStorage — a page load cannot inherit it');
ok(!/viewPlaceType/.test(cpage.replace("HS.setViewPlaceType('zip')", '')),
  'no page reads or writes the raw state field — the declaration goes through the shared API');

console.log('--- 7. ROUTE-LEVEL declaration is EXPLICIT-ONLY, and shared ---');
const decl = (shell.match(/  HS\.declareRouteZipPlace = function \(pageZip\) \{[\s\S]*?\n  \};/) || [''])[0];
ok(decl.length > 100, 'HS.declareRouteZipPlace exists in the shell', decl.length);
ok(/HS\.parseZipParam/.test(decl) && /pageZip/.test(decl),
  'it resolves ?zip= and a page-declared PATH zip — the same contract as ensureViewedZip');
ok(/if \(explicit\) HS\.setViewPlaceType\('zip'\);/.test(decl),
  'it declares ONLY when the route is explicit, so an undeclared route keeps its default');

console.log('--- 8. ALERTS declares before its first await ---');
ok(/HS\.declareRouteZipPlace\(\);/.test(alerts), 'alerts.html declares the route ZIP Place');
const aDecl = alerts.indexOf('HS.declareRouteZipPlace()');
const aAwait = alerts.indexOf('await HS.data.community');
ok(aDecl > 0 && aAwait > 0 && aDecl < aAwait,
  'it declares BEFORE the first await, so the chip is correct on first paint', { aDecl, aAwait });
ok(/HS\.setViewLabel\(String\(c\.name\)\.indexOf\(String\(S\.zip\)\) >= 0/.test(alerts),
  'and upgrades the bare ZIP to the locality name once metadata lands, like the ZIP hub');

console.log('--- 9. MAP 1 declares at boot, and only for an EXPLICIT route ZIP ---');
const bDecl = map1.indexOf('HS.declareRouteZipPlace(z)');
const bFallback = map1.indexOf('HS.hasViewedZipContext');
const bLoad = map1.indexOf('loadZip(z); loadDevTracker(z);');
ok(bDecl > 0 && bLoad > 0 && bDecl < bLoad, 'Map 1 declares before loadZip issues any fetch', { bDecl, bLoad });
ok(bDecl > 0 && bFallback > 0 && bDecl < bFallback,
  'it declares BEFORE the shell-context fallback, so only an explicit route ZIP declares',
  { bDecl, bFallback });
const loadZipBody = (map1.match(/  function loadZip\(zip\)\{[\s\S]*?\n  \}\n/) || [''])[0];
ok(loadZipBody.length > 200 && loadZipBody.indexOf('setViewPlaceType') < 0,
  'loadZip() itself NEVER declares — it also serves the undeclared fallback', loadZipBody.length);
const runBody = (map1.match(/  function run\(address\)\{[\s\S]*?snapRadiusForAddress\(\)/) || [''])[0];
ok(/HS\.setViewPlaceType\('address'\)/.test(runBody),
  'an in-page address search retires the ZIP declaration it replaces');
ok(/HS\.setViewPlaceType\('address'\);\n      loadProperty/.test(map1),
  'the ?addr= route declares an Address Place');

console.log('--- 10. THE ADDRESS DOSSIER declares WHICH Address it shows ---');
const prop = fs.readFileSync(new URL('../property.html', import.meta.url), 'utf8');
ok(/HS\.setViewPlaceType\('address', p\.id\)/.test(prop),
  'property.html declares the Address Place BY ID, so the switcher tick can find it');
const pDecl = prop.indexOf("HS.setViewPlaceType('address', p.id)");
const pLabel = prop.indexOf("HS.setViewLabel(p.address, { precise: true })");
ok(pDecl > 0 && pLabel > 0 && pLabel < pDecl,
  'it sits with the precise label — one place states this page identity', { pLabel, pDecl });
ok(!/setViewPlaceType\('address',/.test(map1),
  'Map 1 never declares an id: a searched address is not a saved Place');

console.log(fails ? '\n' + fails + ' FAILED' : '\nAll viewed-Place declaration assertions passed.');
process.exit(fails ? 1 : 0);

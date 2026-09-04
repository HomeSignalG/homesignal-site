// NAV-01 / NAV-02 regression — viewed ZIP survives shell navigation (lib/view-zip.js +
// shell.js contracts) and map cross-links preserve context. Run: node test/navigation-zip.test.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {
  parseZipParam,
  parseZipFromAddress,
  resolveViewedZip,
  navHref,
  pageHref,
  hasViewedZipContext,
  ZIP_NAV_PAGES,
  MAP_PAGES
} = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const DEF = '78617';

// --- pure resolution (lib/view-zip.js) ---
ok(parseZipParam('?zip=84101') === '84101', 'parseZipParam reads ?zip=84101');
ok(parseZipParam('?zip=abc') === null, 'parseZipParam rejects non-5-digit');
ok(parseZipFromAddress('2200 CALDWELL LN, DEL VALLE, TX 78617') === '78617',
  'parseZipFromAddress reads ZIP from geocoded address');
ok(parseZipFromAddress('10600 RESEARCH BLVD, AUSTIN, TX, 78759') === '78759',
  'parseZipFromAddress reads trailing ZIP, not a 5-digit house number');
ok(parseZipFromAddress('10600 RESEARCH BLVD, AUSTIN, TX, 78759') !== '10600',
  'parseZipFromAddress does not return house number as ZIP');
ok(parseZipFromAddress('no zip here') === null,
  'parseZipFromAddress returns null when address has no ZIP');
ok(resolveViewedZip({ urlZip: '84101', sessionViewZip: '60601', defaultZip: DEF }) === '84101',
  'community.html?zip=84101 → URL zip wins (Maps navigation preserves 84101)');
ok(resolveViewedZip({ sessionViewZip: '84101', defaultZip: DEF }) === '84101',
  'signed-out session viewZip 84101 does not fall back to 78617');
ok(resolveViewedZip({ myZip: '90210', sessionViewZip: '84101', defaultZip: DEF }) === '90210',
  'saved myZip wins over session viewZip when URL has no ?zip=');
ok(resolveViewedZip({ urlZip: '84101', myZip: '90210', defaultZip: DEF }) === '84101',
  'explicit ?zip=84101 wins for this page load even when myZip is saved');
ok(resolveViewedZip({ defaultZip: DEF }) === DEF,
  'default remains 78617 when no viewed or saved ZIP exists');
ok(navHref('alerts.html', '84101') === 'alerts.html?zip=84101',
  'navHref carries zip on a nav link');
ok(navHref('homesignalmap.html', '84101') === 'homesignalmap.html?zip=84101',
  'navHref carries zip on Development tracker link');
ok(navHref('homesignalmap.html', null) === 'homesignalmap.html',
  'missing ZIP → bare page (graceful fallback, no invented zip)');
ok(navHref('homesignalmap.html', 'abc') === 'homesignalmap.html',
  'invalid ZIP → bare page');
ok(navHref('homesignalmap.html', '84101').indexOf('78617') === -1,
  'navHref does not substitute the sample ZIP when a different ZIP is passed');
ok(navHref('homesignalmap.html', DEF) === 'homesignalmap.html?zip=78617',
  'navHref encodes an explicitly passed default ZIP');
ok(pageHref('alerts.html', { zip: '84101', band: 'open' }) === 'alerts.html?zip=84101&band=open',
  'pageHref preserves zip + deep-link params');

// --- ONE map (the second map was retired 2026-09-04) ---
ok(navHref('homesignalmap.html', '90210') === 'homesignalmap.html?zip=90210',
  'the primary map preserves ZIP');
ok(MAP_PAGES.length === 1 && MAP_PAGES[0] === 'homesignalmap.html',
  'MAP_PAGES lists exactly ONE map experience');
ok(MAP_PAGES.indexOf('maps.html') < 0 && ZIP_NAV_PAGES.indexOf('maps.html') < 0,
  'the retired map is in neither page list');
ok(ZIP_NAV_PAGES.indexOf('homesignalmap.html') >= 0,
  'ZIP_NAV_PAGES includes homesignalmap.html for cross-link stamping');

// --- tracker boot: no sample ZIP without browsing context ---
ok(hasViewedZipContext({ urlZip: '84101' }), 'URL zip counts as viewed context');
ok(hasViewedZipContext({ sessionViewZip: '84101' }), 'session viewZip counts as viewed context');
ok(hasViewedZipContext({ myZip: '90210' }), 'saved myZip counts as viewed context');
ok(!hasViewedZipContext({ defaultZip: DEF }), 'bare default is not viewed context');

// --- shell.js wiring contracts ---
const shell = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
ok(/sessionStorage\.setItem\('hs:' \+ k/.test(shell) || /SS\.set\('viewZip'/.test(shell),
  'shell.js persists session viewZip');
ok(/resolveViewedZip/.test(shell), 'shell.js calls resolveViewedZip at boot');
ok(/Object\.defineProperty\(state,\s*'zip'/.test(shell),
  'shell.js zip is a setter (community deep link + repaint)');
ok(/function paintNavHrefs/.test(shell), 'shell.js defines paintNavHrefs');
ok(/paintNavHrefs\(\)/.test(shell), 'shell.js calls paintNavHrefs from topbar');
ok(ZIP_NAV_PAGES.indexOf('homesignalmap.html') >= 0 && ZIP_NAV_PAGES.indexOf('development.html') >= 0,
  'ZIP_NAV_PAGES includes the map and Development');
// Carried over from test/maps-zip-preservation.test.mjs, which was retired with the second
// map: this is the only assertion in the suite pinning the SHARED location flow, and it is
// about shell.js, not about the retired page.
ok(/const z = \$\('locZip'\); z\.value = ''/.test(shell),
  'shell.js openLoc still blanks #locZip by default — the shared flow is unchanged');
ok(/data-znav/.test(shell), 'shell.js stamps in-page links via data-znav');
ok(/LS\.set\('myZip',\s*zip\)/.test(shell),
  'followCommunity still writes myZip (saved area unchanged by view-only browse)');
ok(/SS\.set\('viewZip'/.test(shell), 'viewZip stored in sessionStorage (not myZip)');
ok(!/LS\.set\('myZip'/.test(shell.match(/function captureUrlViewZip[\s\S]*?return z;\s*}/)?.[0] || 'x'),
  'captureUrlViewZip does not write myZip');
ok(/hasViewedZipContext/.test(shell), 'shell.js exposes hasViewedZipContext');
ok(/HS\.pageHref/.test(shell), 'shell.js exposes pageHref');
ok(/parseZipFromAddress/.test(shell), 'shell.js exposes parseZipFromAddress');

// --- page contracts: cross-links + "See it on the map" ---
const mapsHtml = fs.readFileSync(new URL('../maps.html', import.meta.url), 'utf8');
const devMapHtml = fs.readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const devPage = fs.readFileSync(new URL('../development.html', import.meta.url), 'utf8');
const dash = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const today = fs.readFileSync(new URL('../today.html', import.meta.url), 'utf8');
const howItWorks = fs.readFileSync(new URL('../how-it-works.html', import.meta.url), 'utf8');
// The community page runtime was extracted from community.html's inline block into
// lib/community-page.js (Alerts SEO unit) so the generated /community/<zip>/ documents
// and the legacy page share ONE implementation. These assertions follow the code; they
// are unchanged in substance.
const comm = fs.readFileSync(new URL('../lib/community-page.js', import.meta.url), 'utf8');

// The retired map is a redirect stub, and the primary map no longer advertises it.
ok(/location\.replace\('\/homesignalmap\.html'/.test(mapsHtml) && !/<template id="hs-content">/.test(mapsHtml),
  'the retired map is a redirect stub to the primary map, not a second map experience');
ok(!/data-znav="maps\.html"/.test(devMapHtml) && !/href="maps\.html"/.test(devMapHtml),
  'the primary map no longer cross-links to the retired map');
ok(/hasViewedZipContext/.test(devMapHtml),
  'homesignalmap boot reuses shell ZIP context (no sample auto-load)');
ok(/HS\.navHref\('homesignalmap\.html',\s*S\.zip\)/.test(devPage),
  'development.html "See it on the map" uses HS.navHref with active ZIP');
ok(/data-znav="homesignalmap\.html"/.test(dash),
  'dashboard map links use data-znav');
ok(/nav\('homesignalmap\.html',\s*mapCtx\(\)\)/.test(dash),
  'dashboard map click preserves ZIP via pageHref/navHref');
ok(/data-znav="homesignalmap\.html"/.test(today),
  'today.html Map link uses data-znav');
// No active runtime entry point may still send a resident to the retired map.
[['development.html', devPage], ['dashboard.html', dash], ['today.html', today],
 ['partials/shell.html', fs.readFileSync(new URL('../partials/shell.html', import.meta.url), 'utf8')],
 ['lib/onboarding.js', fs.readFileSync(new URL('../lib/onboarding.js', import.meta.url), 'utf8')]
].forEach(function (pair) {
  ok(!/href="maps\.html"|'maps\.html'|"maps\.html"/.test(pair[1]),
    pair[0] + ' no longer routes anyone to the retired map');
});
ok(/parseZipFromAddress/.test(devMapHtml) && /HS\.state\.zip\s*=\s*addrZip/.test(devMapHtml),
  'homesignalmap address search syncs App-map ZIP from geocoded address');
ok(/data-znav="homesignalmap\.html"/.test(howItWorks),
  'how-it-works.html development map link preserves viewed ZIP via data-znav');
ok(/View Development Map/.test(comm),
  'community page runtime has View Development Map link');
ok(/HS\.navHref\('homesignalmap\.html',\s*zip\)/.test(comm),
  'community page runtime View Development Map uses HS.navHref with current zip');
ok(/data-znav="homesignalmap\.html"/.test(comm),
  'community page runtime View Development Map carries data-znav for ZIP stamping');
ok(!/homesignalmap\.html\?zip=78617/.test(comm),
  'community page runtime does not hardcode sample ZIP in development map link');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll navigation-zip assertions passed.');

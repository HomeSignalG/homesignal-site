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
ok(navHref('maps.html', '84101') === 'maps.html?zip=84101',
  'navHref carries zip on Maps link');
ok(navHref('homesignalmap.html', '84101') === 'homesignalmap.html?zip=84101',
  'navHref carries zip on Development tracker link');
ok(navHref('maps.html', null) === 'maps.html',
  'missing ZIP → bare maps.html (graceful fallback, no invented zip)');
ok(navHref('maps.html', 'abc') === 'maps.html',
  'invalid ZIP → bare maps.html');
ok(navHref('maps.html', '84101').indexOf('78617') === -1,
  'navHref does not substitute the sample ZIP when a different ZIP is passed');
ok(navHref('maps.html', DEF) === 'maps.html?zip=78617',
  'navHref encodes an explicitly passed default ZIP');

// --- map cross-navigation (maps.html ↔ homesignalmap.html) ---
ok(navHref('homesignalmap.html', '90210') === 'homesignalmap.html?zip=90210',
  'maps.html → homesignalmap.html preserves ZIP');
ok(navHref('maps.html', '90210') === 'maps.html?zip=90210',
  'homesignalmap.html → maps.html preserves ZIP');
ok(MAP_PAGES.indexOf('maps.html') >= 0 && MAP_PAGES.indexOf('homesignalmap.html') >= 0,
  'MAP_PAGES lists both map experiences');
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
ok(ZIP_NAV_PAGES.indexOf('maps.html') >= 0 && ZIP_NAV_PAGES.indexOf('development.html') >= 0,
  'ZIP_NAV_PAGES includes Maps and Development');
ok(/data-znav/.test(shell), 'shell.js stamps in-page links via data-znav');
ok(/LS\.set\('myZip',\s*zip\)/.test(shell),
  'followCommunity still writes myZip (saved area unchanged by view-only browse)');
ok(/SS\.set\('viewZip'/.test(shell), 'viewZip stored in sessionStorage (not myZip)');
ok(!/LS\.set\('myZip'/.test(shell.match(/function captureUrlViewZip[\s\S]*?return z;\s*}/)?.[0] || 'x'),
  'captureUrlViewZip does not write myZip');
ok(/hasViewedZipContext/.test(shell), 'shell.js exposes hasViewedZipContext');
ok(/parseZipFromAddress/.test(shell), 'shell.js exposes parseZipFromAddress');

// --- page contracts: cross-links + "See it on the map" ---
const mapsHtml = fs.readFileSync(new URL('../maps.html', import.meta.url), 'utf8');
const devMapHtml = fs.readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const devPage = fs.readFileSync(new URL('../development.html', import.meta.url), 'utf8');
const dash = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const today = fs.readFileSync(new URL('../today.html', import.meta.url), 'utf8');
const howItWorks = fs.readFileSync(new URL('../how-it-works.html', import.meta.url), 'utf8');

ok(/data-znav="homesignalmap\.html"/.test(mapsHtml),
  'maps.html cross-link targets homesignalmap.html with data-znav');
ok(/data-znav="maps\.html"/.test(devMapHtml),
  'homesignalmap.html cross-link targets maps.html with data-znav');
ok(/hasViewedZipContext/.test(devMapHtml),
  'homesignalmap boot reuses shell ZIP context (no sample auto-load)');
ok(/HS\.navHref\('maps\.html',\s*S\.zip\)/.test(devPage),
  'development.html "See it on the map" uses HS.navHref with active ZIP');
ok(!/location\.href='maps\.html'/.test(devPage),
  'development.html does not hardcode bare maps.html');
ok(/data-znav="maps\.html"/.test(dash),
  'dashboard map links use data-znav');
ok(/HS\.navHref\('maps\.html',\s*S\.zip\)/.test(dash),
  'dashboard map click uses HS.navHref with active ZIP');
ok(/data-znav="maps\.html"/.test(today),
  'today.html Map link uses data-znav');
ok(/parseZipFromAddress/.test(devMapHtml) && /HS\.state\.zip\s*=\s*addrZip/.test(devMapHtml),
  'homesignalmap address search syncs App-map ZIP from geocoded address');
ok(/data-znav="homesignalmap\.html"/.test(howItWorks),
  'how-it-works.html development map link preserves viewed ZIP via data-znav');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll navigation-zip assertions passed.');
